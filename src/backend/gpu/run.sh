#!/usr/bin/env bash
# AXONFAS · corre un módulo de gpu/ dentro del contenedor con la clave y las direcciones internas, y deja los resultados
# en /root/axonfas/results del droplet (para `axonfas-cloud.ps1 fetch`).
#   bash /root/axonfas/gpu/run.sh smoke
#   bash /root/axonfas/gpu/run.sh bench --levels 1,2,4,8,16,32 --duration 60
set -euo pipefail
HERE=/root/axonfas
CONTAINER=${AXONFAS_CONTAINER:-rocm}
WORK=/workspace/axonfas
MODULE=${1:?uso: run.sh <smoke|bench> [argumentos]}
shift
docker exec -e AXONFAS_LLM_KEY="$(cat "$HERE/.api_key")" -e AXONFAS_LLM_URL="http://127.0.0.1:8000/v1" \
  -e AXONFAS_VOICE_URL="http://127.0.0.1:8001" "$CONTAINER" bash -lc "cd $WORK && python -m gpu.$MODULE $*"
mkdir -p "$HERE/results"
docker cp "$CONTAINER:$WORK/results/." "$HERE/results/"
echo "[axonfas] resultados en $HERE/results"
