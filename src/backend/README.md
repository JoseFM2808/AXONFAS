# Backend

- `staging_api.py`: API de Staging local (cuentas de demostración, planes, sesiones, indicadores y canal en vivo;
  ADR-012/013). La sirve `src/frontend/validation-prototype/serve.py`. Incluye el turno de texto del paciente
  (`POST /api/me/turn`, ADR-025), que guarda `voice_turn` y `agent_decision`; el cupo y el tiempo están en las
  constantes `TURN_*` de `StagingApi` (12 s el clínico, 5 s el conversacional, 18 s en total), que se ajustan con
  `AXONFAS_TURN_CLINICAL_S`, `AXONFAS_TURN_COACH_S` y `AXONFAS_TURN_BUDGET_S`. El texto libre pasa por
  `agents/privacy.py` antes de cualquier LLM (ADR-026). Tests sin red en `tests/backend/test_patient_turn.py`, con un servidor de
  mentira con la forma de Token Factory (`tests/backend/fake_tokenfactory.py`).
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
WebSocket, lifter 3D (TD-05), y PostgreSQL. Contratos: `.ai-context/06-api-mcp.md`.

## Validar el export FHIR

`GET /api/sessions/{id}/fhir` (rol fisioterapeuta) devuelve una `Observation` FHIR R4 de la sesión (`src/backend/fhir.py`):
`preliminary` mientras la nota SOAP es borrador y `final` cuando la firmó un fisioterapeuta. Los códigos usan sistemas
propios bajo `https://axonfas.example/fhir/...` (dominio reservado `.example`: es Staging) y unidades UCUM; el paciente va
solo por seudónimo. En el panel, el botón "Descargar Observation FHIR (JSON)" baja el mismo recurso.

Paso manual pendiente (TD-10), solo con datos sintéticos:

1. Descarga la Observation de una sesión sintética desde `doctor.html` (queda como `axonfas-observation-sesion-<id>.json`).
2. Valídala con el validador oficial de HL7: `java -jar validator_cli.jar obs.json -version 4.0.1`
   (`validator_cli.jar` en https://github.com/hapifhir/org.hl7.fhir.core/releases) o pega el JSON en https://validator.fhir.org.
3. Se acepta si no hay **errores**. Los avisos por los sistemas `axonfas.example` sin definición son esperables.
