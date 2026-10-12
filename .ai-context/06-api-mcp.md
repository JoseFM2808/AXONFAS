# 06 · API y MCP

> Proyecto: **AXONFAS** · Entorno actual: **Staging** · Actualizado: 2026-10-11
> Estado de implementación: existe la **API de Staging** local (sección siguiente, ADR-012/013), servida por `serve.py`.
> El gateway de la nube (FastAPI + WebSocket en AMD) sigue siendo un plan: sus interfaces previstas y los contratos ya
> fijados van después. Se deducen de [01 · Lógica](01-logic.md), [02 · Arquitectura](02-architecture.md) y
> [03 · Base de datos](03-database.md).

## API de Staging (local, ADR-012)

Código: `src/backend/staging_api.py`; tests: `tests/backend/test_staging_api.py`. JSON en el mismo origen que el prototipo.
Autenticación de demostración: `Authorization: Bearer <token>`, que devuelven `POST /api/therapists` y `POST /api/join`.
Errores: `{"error": "mensaje en español"}` con 400 (datos inválidos), 401 (sin token o token inválido), 403 (rol
equivocado o sin consentimiento), 404 (no existe o no es tuyo, I-10), 409 (ejercicio fuera del plan, I-9) o 413.

| Método y ruta | Rol | Cuerpo → respuesta |
|---|---|---|
| `POST /api/therapists` | — | `{name}` → 201 `{token, therapist}` |
| `GET /api/therapists/me` | fisioterapeuta | → `{therapist, patients: [{id, alias, birth_year, consent_given, joined_at, invite_code, plan_size, metrics, live}]}` |
| `POST /api/patients` | fisioterapeuta | `{alias, birth_year?}` → 201 `{patient}` con `invite_code` |
| `GET /api/patients/{id}` | fisioterapeuta | → `{patient, plan, sessions (30), events (60), metrics, live}` |
| `PUT /api/patients/{id}/plan` | fisioterapeuta | `{exercises: [{exercise_id, sets, reps, hold_seconds, per_week, safety_envelope?, notes?}]}` → `{plan}`; reemplaza el plan activo |
| `POST /api/patients/{id}/invite` | fisioterapeuta | → `{invite_code}` nuevo |
| `POST /api/patients/{id}/highlight` | fisioterapeuta | `{muscle?, exercise_id?, note?}` → 202 `{delivered_to}` |
| `GET /api/patients/{id}/live` | fisioterapeuta | Server-Sent Events con lo que publica ese paciente |
| `POST /api/join` | — | `{code, consent: true}` → 201 `{token, patient, therapist}`; el código deja de servir |
| `GET /api/me` | paciente | → `{patient, therapist, plan: [... , done_7d]}` |
| `POST /api/sessions` | paciente | `{exercise_id, mode, source, started_at, ended_at, end_reason, reps_done, baseline?, reps?, events?}` → 201 `{session_id}` |
| `POST /api/live` | paciente | marco en vivo (abajo) → 202 `{delivered_to}` |
| `GET /api/me/stream` | paciente | Server-Sent Events con los señalamientos (`highlight`) y `plan_updated` |

**Marco en vivo** (`POST /api/live`; el servidor descarta todo campo que no esté en esta lista, I-11):
`{exercise_id, source, phase, posture, reps_done, reps_total, angles: {knee, trunk, valgusL, valgusR, confidence},
progress, metric: {label, value, unit}, view, points: {"0"|"7"|"8"|"11"|"12"|"13"|"14"|"15"|"16"|"23"|"24"|"25"|"26"|"27"|"28":
[x, y]}, mirror, event?, ended?}`.
- `points` son coordenadas normalizadas de imagen (0–1): nariz, orejas, hombros, codos, muñecas, caderas, rodillas y
  tobillos.
- `view` (`front`, `diagonal` o `side`): desde dónde mira la cámara según la preparación (ADR-015).
- `progress` (0–1, se recorta) y `metric` (`unit` = `°`, `cm` o `%`; `label` hasta 60 caracteres) los manda el
  seguimiento de la galería (ADR-014). En ese caso `phase` es `setup` mientras toma la posición inicial y `tracking`
  durante el conteo.
- Al fisioterapeuta le llega con `kind: "frame"`; además recibe `kind: "session_saved"` cuando el paciente guarda una
  sesión. Una sesión con conteo de cámara se guarda con `mode: "guided"` y `source: "camera"`.

**Mensajes al paciente:** `{kind: "highlight", muscle?, exercise_id?, note?, from, at}` y `{kind: "plan_updated"}`.

## Interfaces previstas

| Interfaz | Entre | Entra | Sale | Pendiente |
|---|---|---|---|---|
| WebSocket de sesión | Navegador del paciente ↔ gateway FastAPI | Coordenadas 2D por frame (33 puntos de MediaPipe) y audio de voz en streaming. Nunca video (ADR-003) | Alertas del bucle rápido (color + frase corta pregrabada), audio TTS, metas nuevas en pantalla | TD-07 |
| API del panel | Panel del fisioterapeuta ↔ backend | Sobre de seguridad por `plan_exercise`, aprobación del borrador SOAP | Sesiones, métricas por repetición, eventos de compensación, decisiones del agente, borrador SOAP | TD-09 |
| Export clínico | Backend → sistemas externos | `clinical_report` revisado | `Observation` FHIR R4 + PDF. Fuera de Staging, solo si `reviewed_by` no es null | TD-10 |
| LLM | Orquestador ↔ vLLM | Prompt con contexto de la sesión | Propuesta estructurada o texto para voz / SOAP | Interna, no se expone |

## Contratos ya fijados

Vienen del modelo de datos y no cambian sin actualizar [03 · Base de datos](03-database.md).

**Propuesta del agente** (`agent_decision.proposal`): `{param, old, new, reason}`. El motor de reglas la valida contra el
`safety_envelope` y guarda `within_envelope` (boolean) y `outcome` (`applied` | `rejected` | `escalated_to_therapist`).
`applied` solo es posible con `within_envelope = true`.

**Sobre de seguridad** (`plan_exercise.safety_envelope`): `{rom_min, rom_max, max_reps, max_trunk_flex, pain_stop}`.
Lo escribe solo el panel del terapeuta; el agente lo lee y nunca lo modifica. Tipos y unidades exactas se fijan al
validar el sobre con fisioterapeutas (TD-06).

**Evento de compensación** (`compensation_event`): `type` (`trunk_flexion` | `knee_valgus` | `heel_lift` |
`pelvic_rotation` | `asymmetry`), `severity` (1–3), repetición donde ocurrió y `alert_latency_ms`. El demo solo emite
`trunk_flexion` y `knee_valgus` (ADR-009).

**Fin de sesión** (`session.end_reason`): `completed` | `pain_stop` | `envelope_breach` | `user_quit`.

El prototipo de validación (TD-28) ya produce eventos con esta forma en memoria, sin guardarlos ni enviarlos:
`{type, side, rep, value, peak, threshold, severity, alertLatencyMs}`.

## MCP

**N/A por ahora.** Los tres agentes LLM se comunican dentro del orquestador y no hay ningún consumidor externo que
necesite herramientas MCP. Si más adelante se expone algo (por ejemplo, consultas del panel para un asistente del
terapeuta), sus herramientas y esquemas se documentan en esta sección.
