# 06 · API y MCP

> Proyecto: **AXONFAS** · Entorno actual: **Staging** · Actualizado: 2026-10-18
> Estado de implementación: existe la **API de Staging** local (sección siguiente, ADR-012/013), servida por `serve.py`, con nota SOAP y export FHIR.
> El gateway de la nube (FastAPI + WebSocket en AMD) sigue siendo un plan: sus interfaces previstas y los contratos ya
> fijados van después. Se deducen de [01 · Lógica](01-logic.md), [02 · Arquitectura](02-architecture.md) y
> [03 · Base de datos](03-database.md).

## API de Staging (local, ADR-012)

Código: `src/backend/staging_api.py`; tests: `tests/backend/test_staging_api.py`. JSON en el mismo origen que el prototipo.
Autenticación de demostración: `Authorization: Bearer <token>`, que devuelven `POST /api/therapists` y `POST /api/join`.
Idioma (ADR-032): cada petición puede traer `Accept-Language` (`api-client.js` manda el de la interfaz, `es` o `en`); el
primer idioma nuestro según `q` decide los errores, los mensajes, la nota SOAP y FHIR. Sin cabecera, español.
Errores: `{"error": "mensaje en el idioma de la petición"}` (y `code: "auth_required"` con `reason`, la frase del muro según la ruta, cuando un invitado intenta algo que pide cuenta, ADR-028) con 400 (datos inválidos), 401 (sin token o token inválido), 403 (rol
equivocado o sin consentimiento), 404 (no existe o no es tuyo, I-10), 409 (ejercicio fuera del plan, I-9, o nota ya firmada), 413 o 500 (error interno de la base, con mensaje).

| Método y ruta | Rol | Cuerpo → respuesta |
|---|---|---|
| `POST /api/therapists` | — | `{name}` → 201 `{token, therapist}` |
| `GET /api/therapists/me` | fisioterapeuta | → `{therapist, patients: [{id, alias, birth_year, consent_given, joined_at, invite_code, plan_size, metrics, live}]}`. Cada `metrics` suma `discomfort_30d` y `red_flags_30d` |
| `POST /api/patients` | fisioterapeuta | `{alias, birth_year?}` → 201 `{patient}` con `invite_code` |
| `GET /api/patients/{id}` | fisioterapeuta | → `{patient (con `profile`), plan (cada ítem con `since`, cuándo se indicó, y `rest`: `{min, max, default}`), sessions (30, cada una con `report_status`: `null`, `"draft"` o `"final"`), events (60), symptoms (30: `{id, session_id, exercise_id, reported_at, kind, category, text, action, adjustment}`), decisions (30: `{id, session_id, exercise_id, created_at, agent, proposal, outcome, within_envelope, rationale, llm_outcome, llm_proposal, ai_provider, ai_model, llm_ms, turn: {transcript, reply_source}}`), turns (30: `{id, session_id, exercise_id, created_at, transcript, action, ai_provider, ai_model, ai_skipped, clinical_ms, reply_source, has_decision}`), metrics (con `discomfort_30d` y `red_flags_30d`), live}`. Cada `metrics.per_exercise` suma `camera_first`, `camera_last` (`{session_id, ended_at, reps, peak, hold, over_limit}`), `camera_sessions` y `camera_series` (TD-49, ADR-025). `metrics` suma `pain_last` (`{session_id, exercise_id, ended_at, score}` o null), `pain_series` (20) y `pain_high_30d` (EVA ≥ 7). Cada sesión trae `pain_score` (0–10 o null) y cada ítem del plan `range_goal` |
| `PUT /api/patients/{id}/plan` | fisioterapeuta | `{exercises: [{exercise_id, sets, reps, hold_seconds, per_week, safety_envelope?, notes?, rest_min_seconds?, rest_max_seconds?, range_goal?}]}` → `{plan}`; reemplaza el plan activo. `range_goal` = `{target, limit}` (ADR-025): solo en ejercicios de la galería que la cámara mide (no en sentarse y pararse ni en los manuales), números en 1–180 (°), 0,5–50 (cm) o 1–200 (%) según la medida de `tracker.js`, con `limit` más allá de `target` en el sentido del esfuerzo; si no, 400. Se devuelve con su `unit`. En monitoreados, `safety_envelope` = `{trunk_margin (5–35), valgus_margin (3–25), max_reps (4–20), rom_min?, rom_max?}`: `rom_min` y `rom_max` (10–140) van juntos y `rom_min < rom_max`; si no, 400. `rest_min_seconds` y `rest_max_seconds` (10–180, para todo ejercicio, fuera del sobre, ADR-022): si viene uno solo, el otro toma el mismo valor; mínimo mayor que máximo → 400 |
| `POST /api/patients/{id}/invite` | fisioterapeuta | → `{invite_code, revoked_devices}`: código nuevo; borra los tokens del paciente (tendrá que volver a afiliarse y aceptar el consentimiento) y pone `consent_given = 0` (TD-85) |
| `POST /api/patients/{id}/highlight` | fisioterapeuta | `{muscle?, exercise_id?, note?}` → 202 `{delivered_to}` |
| `GET /api/patients/{id}/live` | fisioterapeuta | Server-Sent Events con lo que publica ese paciente |
| `POST /api/join` | — | `{code, consent: true}` → 201 `{token, patient, therapist}`; el código deja de servir. Con `AXONFAS_DEMO_ACCOUNTS=0` → 403 (se entra con Google) |
| `GET /api/auth/config` | — | → `{google_client_id, demo_accounts, ai_provider}` (público; ADR-019) |
| `POST /api/auth/google` | — | `{credential}` (ID token de Google) → `{role, token, user}`. `role` = `admin` si el correo está en `AXONFAS_ADMIN_EMAILS`; `org` si es el correo de administración de una organización (ADR-026); si no, el rol ya elegido, o `user` si es una cuenta nueva. Vincula la licencia que espera a ese correo si ya es fisioterapeuta. Token inválido → 401; cuenta desactivada → 403 |
| `POST /api/auth/role` | user | `{role: "therapist", name?}` → 201 `{role, token, therapist}`; `{role: "patient", code, consent: true}` → 201 `{role, token, patient, therapist}`; ya con rol → 409 |
| `GET /api/auth/me` | cualquiera | → `{role, user}` (`user` null en cuentas de demostración y en el invitado); con `org`, además `organization: {id, name}` |
| `POST /api/auth/guest` | — | → 201 `{role: "guest", token}`: invitado sin registro (ADR-028). Con ese token, las rutas GET de fisioterapeuta leen el consultorio de muestra (datos sintéticos); cualquier otra → 401 `{error, code: "auth_required", reason}` |
| `POST /api/demo/runs` | — | `{source: "demo" \| "camera", exercise_id: "sit-to-stand", end_reason, reps_done (0–50), calibration_reps (0–10), duration_s?, trunk_events?, valgus_events?, low_confidence_reps?}` → 202 `{ok: true}`, sin devolver datos; otros campos se descartan; datos inválidos → 400; más de 500 en una hora → 429 (ADR-028) |
| `GET /api/admin/demo-runs` | admin | → `{total, last_7d, by_source, by_end_reason, avg_reps, with_trunk_events, with_valgus_events, guests, recent (30)}` |
| `POST /api/auth/logout` | cualquiera | Borra ese token |
| `GET /api/admin/overview` | admin | → conteos (cuentas por rol, fisioterapeutas, pacientes, sesiones, detenciones por dolor), `config` (qué falta, sin la lista de correos) y `ai_usage` |
| `GET /api/admin/users` · `PUT /api/admin/users/{id}` | admin | Lista de cuentas de Google · `{role: "pending" \| "therapist"}` o `{disabled: bool}`; no a sí mismo ni a otro admin; revoca los tokens |
| `GET /api/admin/ai` · `POST /api/admin/ai/test` | admin | Estado del proveedor (catálogo `/models`, modelo en uso, qué variables faltan) y uso · `{prompt?}` → `{model, text, ms}`; sin proveedor → 503 (ADR-018) |
| `GET /api/me` | paciente | → `{patient, therapist, plan: [... , range_goal, done_7d, history], assistant: {available, provider, wait_s}}`. `history`: horas de fin (ISO) de las sesiones completadas de ese ejercicio en 14 días, en orden, para la agenda del día (`care-plan.js`, ADR-025) `assistant` sale del estado guardado de la IA, sin consultar la red; `wait_s` es cuánto espera el navegador un turno (presupuesto del servidor + 7 s, 25 por defecto, ADR-033). |
| `POST /api/sessions` | paciente | `{exercise_id, mode, source, started_at, ended_at, end_reason, reps_done, baseline?, reps?, events?, symptom_report_ids?}` → 201 `{session_id}`. `reps` (hasta 100): campos del motor o del conteo con cámara (`index, side, peak, holdSec, holdOk, seconds, overLimit`, ver [03](03-database.md)); lo demás se descarta. En `events`, `value`, `peak` y `threshold` son números finitos o faltan (si no, 400); `alertLatencyMs` fuera de 0–60000 se guarda vacío. `symptom_report_ids` (hasta 20 enteros) une las molestias a la sesión; los de otro paciente o ya unidos se ignoran. `no_camera_reason?` (`declined`, `denied`, `unavailable`): con `source: "guided"` el servidor marca la sesión sin cámara y responde `{session_id, no_camera: true}`; esa sesión no admite `peak` en `reps` ni `events` (400) (ADR-029). `voice_turn_ids` (hasta 20 enteros) une los turnos y sus decisiones a la sesión (ADR-033); otro tipo → 400. |
| `PUT /api/sessions/{id}/pain` | paciente | `{score}` (entero 0–10) → `{session_id, pain_score, high, message}`: dolor al terminar (EVA, ADR-025). Otro tipo o fuera de rango → 400; sesión de otro paciente o inexistente → 404; ya marcada → 409. `high` = 7 o más; `message` es el texto fijo para el paciente, en su idioma. Avisa `pain_scored` al fisioterapeuta |
| `POST /api/live` | paciente | marco en vivo (abajo) → 202 `{delivered_to}` |
| `GET /api/me/stream` | paciente | Server-Sent Events con los señalamientos (`highlight`), `plan_updated` y `profile_updated` |
| `PUT /api/me/profile` | paciente | `{limitations: [...], pain_areas: [...], note?}` → `{profile}`; ids desconocidos → 400; avisa `profile_updated` al fisioterapeuta (ADR-017) |
| `POST /api/me/discomfort` | paciente | `{exercise_id?, option?, text?, in_session, current?: {rom_target?, reps?}}` → 201 `{report, action, adjustment, stop, message}`. `option` ∈ `pain_mild`, `fatigue`, `cramp`, `stiffness`, `red_flag`; `text` hasta 200. Sin `option` ni `text`, opción desconocida o tipos equivocados → 400; sin consentimiento → 403; ejercicio fuera del plan → 409. Decide con reglas, sin LLM (ADR-021): `session_stopped` (alarma), `demand_lowered` (con `adjustment {param, old, new}`, dentro del sobre), `paused` o `logged`. `message` es la frase para el paciente, en su idioma. Avisa `symptom_reported` al fisioterapeuta. El texto se guarda filtrado de datos personales (ADR-034). |
| `POST /api/me/turn` | paciente | Turno de texto con el agente clínico (ADR-033). `{exercise_id, text (1–200), in_session: true, option?, current?: {rom_target?, reps?}, recent_reps?: [{index, kneeRom, peakTrunk}] (hasta 5)}` → 201 `{report, action, adjustment, stop, message, turn: {id}, decision, ai, privacy: {redactions}}`. El texto se filtra con `privacy.redact` antes de cualquier LLM y se guarda filtrado (ADR-034). `decision` = `{agent: "clinical" \| "rules", outcome, within_envelope, proposal}` o `null` (alarma o pausa sin propuesta). `ai` = `{provider, model, clinical_ms, coach_ms, decided_by: "llm" \| "rules", phrased_by: "llm" \| "rules", llm_answered, skipped: null \| "red_flag" \| "guided" \| "no_provider" \| "unavailable" \| "rate_limited" \| "busy", error: null \| "timeout" \| "llm_error"}`; `provider` y `model` son `null` si no se creó ningún cliente de LLM. Sin texto o de más de 200, `in_session` distinto de `true`, opción o ejercicio inválidos → 400; sin consentimiento → 403; ejercicio fuera del plan → 409. Reglas primero; la alarma no crea ningún cliente de LLM. `current`: `rom_target` 10–140, `reps` de 1 a `max_reps`; `rest_seconds` lo pone el servidor con `rest.min`. Solo se aplican `rom_target` y `reps`, y solo bajas. Agente clínico hasta 12 s y conversacional hasta 5 s (solo si el clínico tardó 6 s o menos); 18 s en total en el servidor, ajustables con `AXONFAS_TURN_*`; sin respuesta a tiempo, con 429 o sin cupo (3 s entre turnos y 20 por hora por paciente; 4 a la vez), deciden las reglas sin error. Guarda `voice_turn`, `agent_decision` (si hubo propuesta) y `symptom_report` con `source = 'voice_turn'`. Avisa `symptom_reported` y `agent_turn` al fisioterapeuta Responde en el idioma de la petición (`Accept-Language`): la plantilla la traduce el servidor y el conversacional redacta en ese idioma. Un invitado recibe 401 `auth_required` (I-21). Con varios modelos, la alternativa vive dentro de los 12 s del clínico. |
| `PUT /api/patients/{id}/profile` | fisioterapeuta | Igual, para completar el perfil tras su evaluación; avisa al paciente |
| `GET /api/ai/status` | fisioterapeuta | → `{available, provider, reason}` (`reason` en el idioma de la petición). `provider` es `AMD Token Factory` o `vLLM en AMD Instinct MI300X`, según `providers.py` (ADR-018, ADR-031); `null` sin proveedor configurado. `doctor.js` elige con esto el texto del resumen con IA y si muestra el botón (TD-118) El estado se guarda: con menos de 10 min responde al instante y lo refresca en segundo plano si tiene más de 30 s (ADR-033). |
| `POST /api/patients/{id}/advice` | fisioterapeuta (o invitado, solo sobre el paciente de muestra; 60 por hora en total → 429, ADR-031) | `{suggestions: [{title, detail, because, priority}]}` (1–20) → `{text, source: 'llm'}` o `{text: null, source: 'rejected', reason}`; sin LLM → 503. Resume, no agrega sugerencias (ADR-017). Escribe en el idioma de la petición y revisa los nombres de ejercicio en los dos catálogos (ADR-032) |
| `POST /api/sessions/{id}/report` | fisioterapeuta | → 201 `{report}` nuevo, o 200 con el que ya existe. `report` = `{session_id, status: "draft" | "final", source: "template" | "llm", soap: {S, O, A, P}, facts, lang: "es" | "en", created_at, reviewed_by, reviewed_by_name, reviewed_at}`. El LLM solo si `/api/ai/status` dice `available` (TD-09). Se redacta en el idioma de la petición; `lang` dice en cuál está (ADR-032) |
| `GET /api/sessions/{id}/report` | fisioterapeuta | → `{report}`; sin borrador → 404. Un borrador de plantilla sin firmar sale redactado en el idioma de la petición (mismos datos, no se guarda); lo firmado y lo que redactó la IA, en su `lang` |
| `POST /api/sessions/{id}/report/approve` | fisioterapeuta | `{A?, P?}` (texto de hasta 1000) → `{report}` con `status: "final"`; S y O no se editan; se firma el texto que se veía, en el idioma de la petición; ya firmada → 409; sin borrador → 404 |
| `GET /api/sessions/{id}/fhir` | fisioterapeuta | → `Observation` FHIR R4 (abajo); no escribe nada (TD-10). Textos en el idioma de la nota (o de la petición si no hay nota) y `language`; los códigos no cambian |
| `GET /api/sessions/{id}/fhir/document` | fisioterapeuta | → la nota SOAP como `Bundle` FHIR R4 de tipo `document` (abajo); sin nota → 404; no escribe nada (TD-103). En el idioma de la nota, con `language` en el `Bundle` y la `Composition` |
| `GET /api/admin/orgs` · `POST /api/admin/orgs` | admin | Organizaciones con su resumen y `admin_email` · `{name, plan: "clinic" \| "network", admin_email}` → 201; correo ya usado → 409; correo de un Administrador maestro o datos inválidos → 400 (ADR-026) |
| `GET /api/org/summary` | org | → `{organization: {id, name, plan, plan_label (en el idioma de la petición)}, seats: {total, used, free}, patients: {total, capacity, over}, professionals: [{license_id, email, status, linked, patients}], ehr: {fhir_base_url, enabled}}`. Sin datos clínicos (I-19) |
| `POST /api/org/licenses` | org | `{email}` → 201 con el resumen; correo inválido, ya activo o sin licencias libres → 400; activo en otra organización → 409 |
| `POST /api/org/licenses/{id}/revoke` | org | → el resumen con esa licencia `revoked`; de otra organización o inexistente → 404 |
| `PUT /api/org/ehr` | org | `{fhir_base_url, enabled}` → el resumen. Solo https, sin usuario, clave, consulta ni fragmento; con `token`, `password` u otra credencial → 400 |

En las cuatro rutas, una sesión de otro fisioterapeuta da 404 (I-10).

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
- Al fisioterapeuta le llega con `kind: "frame"`; además recibe `kind: "symptom_reported"` (`{id, exercise_id, category, symptom_kind, action, text, adjustment, at}`) cuando el paciente avisa de una molestia, `kind: "agent_turn"` (`{turn_id, exercise_id, action, decided_by, provider, model, clinical_ms, outcome, at}`) tras cada turno de texto (ADR-033), `kind: "session_saved"` (con `no_camera`) cuando el paciente guarda una
  sesión y `kind: "pain_scored"` (`{session_id, exercise_id, score, high, at}`) cuando marca el dolor al terminar. Una sesión con conteo de cámara se guarda con `mode: "guided"` y `source: "camera"`.

**Mensajes al paciente:** `{kind: "highlight", muscle?, exercise_id?, note?, from, at}`, `{kind: "plan_updated", at}` y `{kind: "profile_updated", at}` (cuando el fisioterapeuta cambia su perfil). Al fisioterapeuta le llega `{kind: "profile_updated", at}` cuando el paciente cambia el suyo.

**Observation FHIR R4** (`GET /api/sessions/{id}/fhir`, `src/backend/fhir.py`): `resourceType: "Observation"`,
`id: "axonfas-session-<id>"`, `meta.tag` `staging-synthetic`, `identifier` de la sesión, `status` (`preliminary` sin
firma, `final` con `reviewed_by`, I-8), `category` `activity` (sistema de HL7), `code` con el ejercicio, `subject` solo
por seudónimo (`identifier` `p<id>` y el alias; sin `reference`), `effectivePeriod` con inicio y fin, `issued` (firma,
creación del borrador o fin de la sesión), `performer` (`t<id>`, solo si está firmada), `component` y `note` (S, O, A y
P, solo si hay nota).
- `component`: `reps-done` y `reps-target` (`{repetitions}`), `knee-flexion-mean` (`deg`), `trunk-flexion-events` y
  `knee-valgus-events` (`{events}`, solo en monitoreadas), `end-reason` (`valueCodeableConcept`), `pain-reported`
  (`valueBoolean`), `pain-score-end` (`valueInteger`, la EVA 0–10 al terminar, ADR-025) y `camera-used` (`valueBoolean`;
  `false` en una sesión sin cámara, ADR-029). Cantidades en UCUM (`http://unitsofmeasure.org`). Sin dato no hay componente.
- Los sistemas de código propios cuelgan de `https://axonfas.example/fhir/...` (dominio reservado: es Staging). No hay
  códigos LOINC. Nunca van el año de nacimiento ni el nombre del fisioterapeuta.
- `language` (`es` o `en`): los textos legibles (`display`, `text`, unidades escritas) van en el idioma de la nota, o en
  el de la petición si no hay nota; los `code` y `system` nunca cambian (ADR-032).

**Documento FHIR R4 de la nota SOAP** (`GET /api/sessions/{id}/fhir/document`, `fhir.document`): `Bundle` con `type:
"document"`, `identifier` y `timestamp` (firma o creación del borrador). El primer `entry` es la `Composition`:
`status` `preliminary` o `final`, `type` LOINC `11506-3` (Progress note), `subject` al `Patient`, `author` (el `Device`
AXONFAS; con firma, primero el `Practitioner`), `attester` `legal` con la hora de la firma, `custodian` = la
`Organization` si el fisioterapeuta tiene licencia activa, y cuatro `section` con LOINC `61150-9` (S), `61149-1` (O),
`51848-0` (A) y `18776-5` (P), cada una con su narrativa XHTML escapada; la O apunta a la `Observation`. Le siguen el
`Patient` (solo seudónimo `p<id>`, sin nombre ni fecha de nacimiento), el `Device`, la `Observation` (con `subject` y
`performer` por referencia), el `Practitioner` (solo `t<id>` y solo si firmó) y la `Organization` (`o<id>` y su
nombre). `fullUrl` = `urn:uuid` deterministas (uuid5): todas las referencias resuelven dentro del Bundle.

## Servicios de la GPU (ADR-016)

Corren en el droplet MI300X y solo se usan por el túnel SSH (`axonfas-cloud.ps1 tunnel`). Todos piden
`Authorization: Bearer <clave>`; la clave se genera en el droplet y no entra al repo.

| Servicio | Endpoint | Entra | Sale |
|---|---|---|---|
| LLM (vLLM) | `POST :8000/v1/chat/completions` | API de OpenAI; modelo `axonfas-llm` (Qwen2.5-7B-Instruct); `response_format: {type: json_object}` para el agente clínico | `choices[0].message.content`, `usage` |
| Voz | `GET :8001/health` (sin clave) | — | `{device, gpu, memory, stt, tts, stt_model, load_s, errors}` |
| Voz | `POST :8001/v1/stt?language=es` | WAV PCM de 16 bits (cualquier frecuencia; se pasa a 16 kHz) | `{text, ms, audio_seconds}` |
| Voz | `POST :8001/v1/tts` | `{text (≤ 600), voice (por defecto ef_dora)}` | `audio/wav` 24 kHz, cabecera `X-Synth-Ms` |

**Respuesta del agente clínico** (lo que pide el prompt): `{"action": "adjust", "param", "old", "new", "reason"}` o
`{"action": "none", "reason"}`. `param` ∈ `rom_target` (grados), `reps`, `rest_seconds`. La decisión que devuelve
`clinical.propose` suma `within_envelope`, `outcome`, `note` y `source` (`llm` o `rules`), con la forma de `agent_decision`. Ante una molestia sin baja válida del LLM, el motor de reglas propone la baja (`source: "rules"`, con `llm_outcome` y `llm_proposal`) o, sin nada que bajar, agrega `paused: true` (ADR-021). `run_turn` devuelve además `symptom` (`{kind, category, text, action, adjustment}` o `null`). En el turno del paciente, `clinical.propose` recibe `discomfort_reported=True` y `allowed` (los parámetros que la pantalla aplica); el contexto suma `parametros_que_puedes_ajustar` y la línea “solo puedes bajar la exigencia”. `turn.run_text_turn` devuelve `{decision, reply, reply_source, ai, timings_ms}`, nunca el texto crudo del LLM (ADR-033).

**Medir la latencia real** (en la terminal del owner, con su clave en el entorno; desde `src/`):
`py -m agents.turn --measure N [--with-coach] [--gap S] [--save-measure]`, con `N` de 1 a 20 (cuida el cupo) y 3 s entre
llamadas por defecto. Imprime JSON `{provider, model, n, ok, errors, http_429, valid_json, applied, json_mode_fallback,
clinical_ms: {p50, p95, max}, coach_ms, completion_tokens_p95, suggested: {TURN_CLINICAL_S, TURN_COACH_S, TURN_BUDGET_S}}`
sin la clave ni la dirección; `--save-measure` lo guarda en `~/.axonfas/results/turn-latency.json`. Sin proveedor, dice
qué variables faltan (sin valores) y termina con código 2.

## Interfaces previstas

| Interfaz | Entre | Entra | Sale | Pendiente |
|---|---|---|---|---|
| WebSocket de sesión | Navegador del paciente ↔ gateway FastAPI | Coordenadas 2D por frame (33 puntos de MediaPipe) y audio de voz en streaming. Nunca video (ADR-003) | Alertas del bucle rápido (color + frase corta pregrabada), audio TTS, metas nuevas en pantalla | TD-07 |
| API del panel | Panel del fisioterapeuta ↔ backend | Sobre de seguridad por `plan_exercise`, aprobación del borrador SOAP | Sesiones, métricas por repetición, eventos de compensación, decisiones del agente, borrador SOAP | Hecho en Staging (TD-09); en la nube, con TD-45 |
| Export clínico | Backend → sistemas externos | `clinical_report` revisado | `Observation` FHIR R4 + PDF. Fuera de Staging, solo si `reviewed_by` no es null | Observation hecha en Staging; falta el validador de HL7 (TD-10) y el PDF (TD-84) |
| LLM | Orquestador ↔ vLLM | Prompt con contexto de la sesión | Propuesta estructurada o texto para voz / SOAP | Hecho en Staging con texto: `POST /api/me/turn` (ADR-033); falta la voz (TD-120) |

## Contratos ya fijados

Vienen del modelo de datos y no cambian sin actualizar [03 · Base de datos](03-database.md).

**Propuesta del agente** (`agent_decision.proposal`): `{param, old, new, reason}`. El motor de reglas la valida contra el
`safety_envelope` y guarda `within_envelope` (boolean) y `outcome` (`applied` | `rejected` | `escalated_to_therapist`).
`applied` solo es posible con `within_envelope = true`.

**Sobre de seguridad** (`plan_exercise.safety_envelope`): `{rom_min, rom_max, max_reps, max_trunk_flex, pain_stop}`.
Lo escribe solo el panel del terapeuta; el agente lo lee y nunca lo modifica. Tipos y unidades exactas se fijan al
validar el sobre con fisioterapeutas (TD-06).

En Staging el sobre se guarda como `{trunk_margin, valgus_margin, max_reps, rom_min?, rom_max?}` y `safety.agent_envelope` lo pasa al agente como `{rom_min?, rom_max?, max_reps, trunk_margin, valgus_margin, pain_stop: true}`. Sin `rom_min`/`rom_max` el agente no ajusta el rango; tras una molestia solo baja la exigencia (ADR-021).

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
