# Agentes

Los tres agentes LLM de AXONFAS (ADR-007) y las reglas deterministas que los rodean (ADR-004, ADR-005, ADR-016). Solo
biblioteca estándar de Python: corren igual en esta PC (con un LLM de mentira) que en la GPU.

| Archivo | Qué hace |
|---|---|
| `safety.py` | Frases de alarma (detienen la sesión sin LLM) y validación de cada propuesta contra el sobre del fisioterapeuta |
| `clinical.py` | Agente clínico: propone un ajuste `{param, old, new, reason}` en JSON; `safety.validate` decide |
| `coach.py` | Agente conversacional: la frase que escucha el paciente; si el LLM inventa un número o nombra un medicamento o un diagnóstico (`MEDICAL`), plantilla |
| `privacy.py` | Filtro determinista de datos personales (`redact`) antes de cualquier LLM: correos, enlaces, teléfonos, documentos, direcciones y nombres (ADR-034) |
| `soap.py` | Agente de reporte: borrador de nota SOAP; cifras solo de los datos, siempre borrador |
| `turn.py` | Turno de voz completo (voz → texto → alarma → agente → sobre → frase → voz) y `run_text_turn`, el turno de texto del paciente que usa la API de Staging: alarma sin LLM, agente clínico con tiempo límite y respaldo de reglas (ADR-033) |
| `providers.py` | Proveedor de IA de AMD: Token Factory o vLLM propio, con contador de uso; `retries_429=0` para el turno del paciente (ADR-018, ADR-033). En el turno, la cadena de modelos corre dentro de los 12 s del clínico (ADR-031, ADR-033) |
| `llm.py`, `voice.py` | Clientes del LLM (vLLM, API de OpenAI) y del servidor de voz, más un LLM de mentira |

Demo sin GPU, desde `src/`:

```bash
py -m agents.turn --fake --text "Me dio un pinchazo en la ingle"
```

Contra la GPU (con `axonfas-cloud.ps1 tunnel` abierto y `$env:AXONFAS_LLM_KEY` cargado con `axonfas-cloud.ps1 key`):

```bash
py -m agents.turn --text "Me dio un pinchazo en la ingle" --voice --save respuesta.wav
```

Medir la latencia real del turno contra AMD Token Factory (en la terminal del owner, con su clave en el entorno; no
imprime la clave ni la dirección):

```bash
py -m agents.turn --measure 10 --with-coach
```

Ningún agente emite alertas de seguridad ni modifica el `safety_envelope`. Tests: `py -m unittest discover -s tests/agents`.
