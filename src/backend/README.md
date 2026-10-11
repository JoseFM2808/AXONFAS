# Backend (planificado)

Servicios que corren en el droplet 1× MI300X (ADR-006). Todavía sin código.

- **Gateway FastAPI + WebSocket:** recibe coordenadas 2D y audio del navegador; devuelve alertas, audio TTS y metas.
- **Servicio de pose:** lifter 2D→3D en PyTorch sobre ROCm (modelo por elegir, TD-05).
- **Motor biomecánico de reglas:** ángulos, ROM, simetría y detección de compensaciones. Determinista, < 250 ms. Es el
  único que emite alertas de seguridad (ADR-004) y el que valida cada propuesta del agente contra el `safety_envelope`.
- **Voz:** Whisper (STT) y TTS sobre ROCm.
- **Datos y export:** PostgreSQL (modelo en `.ai-context/03-database.md`) y export FHIR R4 + PDF (ADR-008).

Contratos: `.ai-context/06-api-mcp.md`.
