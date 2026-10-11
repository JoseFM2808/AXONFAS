# 06 · API y MCP

> Proyecto: **AXONFAS** · Entorno actual: **Staging** · Actualizado: 2026-10-06
> Estado de implementación: no hay endpoints todavía. Esta pestaña fija las interfaces que ya se deducen de
> [01 · Lógica](01-logic.md), [02 · Arquitectura](02-architecture.md) y [03 · Base de datos](03-database.md).
> Las rutas y los mensajes concretos se documentan aquí cuando se construya el gateway (TD-07, TD-09).

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
