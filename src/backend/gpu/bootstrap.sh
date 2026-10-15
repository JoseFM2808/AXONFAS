#!/usr/bin/env bash
# AXONFAS · prepara y arranca todo en el droplet MI300X (ADR-006, ADR-016). Lo lanza `axonfas-cloud.ps1 deploy`.
# Corre en el droplet como root, con el código copiado en /root/axonfas/{agents,gpu}. Idempotente: se puede repetir.
#
#   1. Revisa la GPU y el contenedor `rocm` de la imagen vLLM Quick Start.
#   2. Genera la clave de los servicios (queda solo en el droplet, en /root/axonfas/.api_key).
#   3. Copia el código al contenedor e instala lo justo sin tocar el PyTorch de ROCm.
#   4. Arranca vLLM (puerto 8000) y el servidor de voz (puerto 8001), solo para el túnel SSH.
#   5. Espera a que carguen los modelos y corre la prueba de humo (results/smoke.json).
set -euo pipefail

HERE=/root/axonfas
CONTAINER=${AXONFAS_CONTAINER:-rocm}
MODEL=${AXONFAS_MODEL:-Qwen/Qwen2.5-7B-Instruct}
GPU_SHARE=${AXONFAS_GPU_SHARE:-0.45}      # parte de la memoria para vLLM; el resto queda para Whisper, TTS y el lifter
WORK=/workspace/axonfas
log() { printf '\n[axonfas] %s\n' "$*"; }

log "GPU"
rocm-smi --showproductname --showmeminfo vram || { echo "rocm-smi no respondió: ¿es un droplet con GPU AMD?"; exit 1; }

log "Contenedor '$CONTAINER'"
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "No hay un contenedor '$CONTAINER' corriendo. Contenedores:"; docker ps -a
  echo "Arráncalo (docker start $CONTAINER) o define AXONFAS_CONTAINER con el nombre correcto."; exit 1
fi
NET=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CONTAINER")
if [ "$NET" = "host" ]; then
  BIND=127.0.0.1; TARGET=127.0.0.1           # red del host: los servicios solo escuchan en localhost
else
  BIND=0.0.0.0                               # red propia: escuchan en la IP del contenedor, que no es pública
  TARGET=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")
fi
echo "red=$NET  servicios en $TARGET (túnel SSH hacia ahí)"
echo "$TARGET" > "$HERE/tunnel_host"

log "Clave de los servicios"
if [ ! -s "$HERE/.api_key" ]; then umask 077; openssl rand -hex 24 > "$HERE/.api_key"; fi
KEY=$(cat "$HERE/.api_key")
echo "lista (en $HERE/.api_key; no sale del droplet salvo por 'axonfas-cloud.ps1 key')"

log "Código y dependencias"
docker exec "$CONTAINER" mkdir -p "$WORK/results"
docker cp "$HERE/agents" "$CONTAINER:$WORK/"
docker cp "$HERE/gpu" "$CONTAINER:$WORK/"
docker exec "$CONTAINER" bash -lc 'command -v espeak-ng >/dev/null || (apt-get update -qq && apt-get install -y -qq espeak-ng >/dev/null) || echo "AVISO: sin espeak-ng; el TTS en español puede fallar"'
docker exec "$CONTAINER" bash -lc "cd $WORK && pip freeze | grep -iE '^(torch|torchvision|torchaudio|transformers|numpy|triton)==' > /tmp/axonfas-constraints.txt; cat /tmp/axonfas-constraints.txt; pip install -q -c /tmp/axonfas-constraints.txt -r gpu/requirements-gpu.txt || echo 'AVISO: no se instaló todo; el servidor de voz dirá qué falta en /health'"

log "vLLM ($MODEL)"
if curl -fsS -m 5 -H "Authorization: Bearer $KEY" "http://$TARGET:8000/v1/models" >/dev/null 2>&1; then
  echo "ya estaba corriendo"
else
  docker exec "$CONTAINER" bash -lc "pkill -f 'vllm.entrypoints.openai.api_server' || true"
  docker exec -d -e AXONFAS_LLM_KEY="$KEY" "$CONTAINER" bash -lc "cd $WORK && python -m vllm.entrypoints.openai.api_server \
    --model $MODEL --served-model-name axonfas-llm --host $BIND --port 8000 --dtype float16 \
    --gpu-memory-utilization $GPU_SHARE --max-model-len 8192 --api-key \"\$AXONFAS_LLM_KEY\" > $WORK/vllm.log 2>&1"
fi

log "Servidor de voz (Whisper + Kokoro)"
docker exec "$CONTAINER" bash -lc "pkill -f 'uvicorn gpu.voice_server' || true"
docker exec -d -e AXONFAS_LLM_KEY="$KEY" "$CONTAINER" bash -lc "cd $WORK && python -m uvicorn gpu.voice_server:app --host $BIND --port 8001 > $WORK/voice.log 2>&1"

log "Esperando a que carguen los modelos (la primera vez se descargan: unos minutos)"
for i in $(seq 1 120); do
  LLM_OK=0; VOICE_OK=0
  curl -fsS -m 5 -H "Authorization: Bearer $KEY" "http://$TARGET:8000/v1/models" >/dev/null 2>&1 && LLM_OK=1
  curl -fsS -m 5 "http://$TARGET:8001/health" 2>/dev/null | grep -q '"stt"' && VOICE_OK=1
  if [ "$LLM_OK" = 1 ] && [ "$VOICE_OK" = 1 ]; then break; fi
  if [ $((i % 6)) = 0 ]; then echo "  ${i}0 s: llm=$LLM_OK voz=$VOICE_OK  (logs: docker exec $CONTAINER tail -n 5 $WORK/vllm.log)"; fi
  sleep 10
done
[ "$LLM_OK" = 1 ] || { echo "vLLM no arrancó en 20 min. Últimas líneas:"; docker exec "$CONTAINER" tail -n 40 "$WORK/vllm.log"; exit 1; }
curl -fsS "http://$TARGET:8001/health" || true

log "Prueba de humo"
docker exec -e AXONFAS_LLM_KEY="$KEY" -e AXONFAS_LLM_URL="http://127.0.0.1:8000/v1" -e AXONFAS_VOICE_URL="http://127.0.0.1:8001" \
  "$CONTAINER" bash -lc "cd $WORK && python -m gpu.smoke"
log "Listo. Benchmark: axonfas-cloud.ps1 bench  ·  Al terminar: axonfas-cloud.ps1 down"
