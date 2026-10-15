# Agentes

Los tres agentes LLM de AXONFAS (ADR-007) y las reglas deterministas que los rodean (ADR-004, ADR-005, ADR-016). Solo
biblioteca estándar de Python: corren igual en esta PC (con un LLM de mentira) que en la GPU.

| Archivo | Qué hace |
|---|---|
| `safety.py` | Frases de alarma (detienen la sesión sin LLM) y validación de cada propuesta contra el sobre del fisioterapeuta |
| `clinical.py` | Agente clínico: propone un ajuste `{param, old, new, reason}` en JSON; `safety.validate` decide |
| `coach.py` | Agente conversacional: la frase que escucha el paciente; si el LLM inventa un número, plantilla |
| `soap.py` | Agente de reporte: borrador de nota SOAP; cifras solo de los datos, siempre borrador |
| `turn.py` | Turno de voz completo (voz → texto → alarma → agente → sobre → frase → voz) |
| `llm.py`, `voice.py` | Clientes del LLM (vLLM, API de OpenAI) y del servidor de voz, más un LLM de mentira |

Demo sin GPU, desde `src/`:

```bash
py -m agents.turn --fake --text "Me dio un pinchazo en la ingle"
```

Contra la GPU (con `axonfas-cloud.ps1 tunnel` abierto y `$env:AXONFAS_LLM_KEY` cargado con `axonfas-cloud.ps1 key`):

```bash
py -m agents.turn --text "Me dio un pinchazo en la ingle" --voice --save respuesta.wav
```

Ningún agente emite alertas de seguridad ni modifica el `safety_envelope`. Tests: `py -m unittest discover -s tests/agents`.
