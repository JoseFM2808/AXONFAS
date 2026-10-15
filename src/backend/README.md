# Backend

- `staging_api.py`: API de Staging local (cuentas de demostración, planes, sesiones, indicadores y canal en vivo;
  ADR-012/013). La sirve `src/frontend/validation-prototype/serve.py`.
- `gpu/`: lo que corre en el droplet 1× MI300X (ADR-006, ADR-016).
  - `bootstrap.sh`: prepara el contenedor `rocm` de la imagen vLLM Quick Start y arranca vLLM (8000) y la voz (8001),
    solo para el túnel SSH. Termina con la prueba de humo.
  - `voice_server.py`: Whisper large-v3-turbo y Kokoro-82M en PyTorch sobre ROCm.
  - `smoke.py`: comprueba que el LLM, Whisper y el TTS responden juntos; deja `results/smoke.json`.
  - `bench.py`: benchmark de sesiones concurrentes (TD-08); deja `results/bench.json`, `.md` y `.svg`.
  - `run.sh`: corre `smoke` o `bench` dentro del contenedor con la clave.
- `cloud/axonfas-cloud.ps1`: el ciclo de una jornada en la GPU con `doctl`.

## Jornada en la GPU (cuando AMD habilite la MI300X)

Una sola vez:

```bash
ssh-keygen -t ed25519 -C axonfas-amd -f "$HOME\.ssh\axonfas_amd"
```

```bash
doctl auth init --context amd-write --api-url https://api.devcloud.amd.com
```

Cada jornada, desde la carpeta del proyecto:

```bash
.\src\backend\cloud\axonfas-cloud.ps1 check
```

```bash
.\src\backend\cloud\axonfas-cloud.ps1 up -Yes
```

```bash
.\src\backend\cloud\axonfas-cloud.ps1 deploy
```

```bash
.\src\backend\cloud\axonfas-cloud.ps1 bench -Levels 1,2,4,8,16,32,64 -Duration 60
```

```bash
.\src\backend\cloud\axonfas-cloud.ps1 down -Yes
```

`up` cobra USD 1.99/h hasta `down`. Los resultados quedan en `~/.axonfas/results/`. Planificado: gateway FastAPI +
WebSocket, lifter 3D (TD-05), PostgreSQL y export FHIR R4 (TD-10). Contratos: `.ai-context/06-api-mcp.md`.
