# Agentes (planificado)

Tres agentes LLM servidos con vLLM sobre ROCm (ADR-007). Todavía sin código. Aquí van el orquestador, los prompts y
los esquemas de salida; nunca llaves.

| Agente | Cuándo actúa | Qué produce |
|---|---|---|
| Clínico | Cada N repeticiones o ante un evento de compensación | Propuesta `{param, old, new, reason}` que valida el motor de reglas |
| Conversacional | Cuando el paciente habla (STT → LLM → TTS) | Respuesta por voz; detiene la sesión ante dolor agudo, mareo o pérdida de fuerza súbita |
| Reporte | Al final de la sesión | Borrador de nota SOAP solo con campos de la BD |

Ningún agente emite alertas de seguridad ni modifica el `safety_envelope` (ADR-004, ADR-005).
