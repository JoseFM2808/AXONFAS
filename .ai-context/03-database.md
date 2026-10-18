# 03 · Base de datos

> Proyecto: **AXONFAS** · Motor: PostgreSQL · Entorno actual: **Staging** · Actualizado: 2026-10-17
> Estado de implementación: modelo diseñado, sin migraciones todavía. En Staging solo hay pacientes ficticios ([ADR-010](04-decisions-adr.md)).

## Diagrama entidad-relación

```mermaid
erDiagram
    CLINIC ||--o{ THERAPIST : emplea
    CLINIC ||--o{ PATIENT : atiende
    THERAPIST ||--o{ CARE_PLAN : prescribe
    PATIENT ||--o{ CARE_PLAN : recibe
    CARE_PLAN ||--o{ PLAN_EXERCISE : incluye
    EXERCISE ||--o{ PLAN_EXERCISE : se_usa_en
    PATIENT ||--o{ SESSION : realiza
    CARE_PLAN ||--o{ SESSION : guia
    SESSION ||--o{ REP_METRIC : registra
    SESSION ||--o{ COMPENSATION_EVENT : detecta
    REP_METRIC ||--o{ COMPENSATION_EVENT : ocurre_en
    SESSION ||--o{ VOICE_TURN : contiene
    PATIENT ||--o{ SYMPTOM_REPORT : reporta
    SESSION ||--o{ SYMPTOM_REPORT : incluye
    SESSION ||--o{ AGENT_DECISION : genera
    SESSION ||--o| CLINICAL_REPORT : produce
    THERAPIST ||--o{ CLINICAL_REPORT : revisa
    PATIENT ||--o{ MONITORING_PERIOD : acumula
    MONITORING_PERIOD ||--o{ SESSION : cuenta

    CLINIC {
        uuid id PK
        text name
        text country
    }
    THERAPIST {
        uuid id PK
        uuid clinic_id FK
        text full_name
        text license_number
    }
    PATIENT {
        uuid id PK
        uuid clinic_id FK
        text pseudonym
        int birth_year
        boolean consent_given
    }
    EXERCISE {
        uuid id PK
        text code
        text name
        text target_joint
    }
    CARE_PLAN {
        uuid id PK
        uuid patient_id FK
        uuid therapist_id FK
        text condition_note
        date start_date
        date end_date
        text status
    }
    PLAN_EXERCISE {
        uuid id PK
        uuid care_plan_id FK
        uuid exercise_id FK
        int sets
        int reps
        jsonb safety_envelope
    }
    SESSION {
        uuid id PK
        uuid patient_id FK
        uuid care_plan_id FK
        uuid monitoring_period_id FK
        timestamptz started_at
        timestamptz ended_at
        jsonb baseline
        text end_reason
    }
    REP_METRIC {
        uuid id PK
        uuid session_id FK
        uuid plan_exercise_id FK
        int rep_index
        numeric rom_deg
        numeric trunk_flex_deg
        numeric valgus_deg
        numeric symmetry_pct
        numeric tremor_index
    }
    COMPENSATION_EVENT {
        uuid id PK
        uuid session_id FK
        uuid rep_metric_id FK
        text type
        smallint severity
        int alert_latency_ms
    }
    VOICE_TURN {
        uuid id PK
        uuid session_id FK
        text speaker
        text transcript
        smallint pain_score
    }
    AGENT_DECISION {
        uuid id PK
        uuid session_id FK
        text agent
        jsonb proposal
        boolean within_envelope
        text outcome
        text rationale
    }
    CLINICAL_REPORT {
        uuid id PK
        uuid session_id FK
        text soap_draft
        jsonb fhir_bundle
        uuid reviewed_by FK
        timestamptz reviewed_at
    }
    SYMPTOM_REPORT {
        uuid id PK
        uuid patient_id FK
        uuid session_id FK
        timestamptz reported_at
        text kind
        text category
        text text
        text action
        jsonb adjustment
        text source
    }
    MONITORING_PERIOD {
        uuid id PK
        uuid patient_id FK
        date period_start
        date period_end
        int days_with_data
        int therapist_minutes
    }
```

## Diccionario de datos (campos clave)

| Tabla | Campo | Tipo | Significado |
|---|---|---|---|
| `patient` | `pseudonym` | text | Alias. En Staging nunca se guarda nombre real |
| `patient` | `consent_given` | boolean | Sin consentimiento no se puede crear `session` |
| `plan_exercise` | `safety_envelope` | jsonb | Límites que fija el terapeuta: `{rom_min, rom_max, max_reps, max_trunk_flex, pain_stop}`. El LLM no puede salir de aquí. En Staging se guarda otra forma (ver "Staging local") y `safety.agent_envelope` la traduce. |
| `session` | `baseline` | jsonb | Valores de las 3 reps de calibración; base para detectar compensación |
| `session` | `end_reason` | text | `completed`, `pain_stop`, `envelope_breach`, `user_quit` |
| `rep_metric` | `rom_deg` | numeric | Rango de movimiento de la articulación objetivo en esa repetición |
| `rep_metric` | `symmetry_pct` | numeric | Diferencia izquierda/derecha en % |
| `rep_metric` | `tremor_index` | numeric | Variación de alta frecuencia de la trayectoria (proxy de fatiga, no diagnóstico) |
| `compensation_event` | `type` | text | `trunk_flexion`, `knee_valgus`, `heel_lift`, `pelvic_rotation`, `asymmetry` |
| `compensation_event` | `alert_latency_ms` | int | Tiempo desde el frame hasta la alerta. Es la métrica del benchmark AMD |
| `voice_turn` | `pain_score` | smallint | 0–10 si el paciente lo menciona; null si no |
| `agent_decision` | `proposal` | jsonb | `{param, old, new, reason}` propuesto por el LLM |
| `agent_decision` | `within_envelope` | boolean | Resultado de validar contra `safety_envelope` |
| `agent_decision` | `outcome` | text | `applied`, `rejected`, `escalated_to_therapist`. Sin propuesta del agente no hay fila; una frase de alarma termina la sesión (`end_reason = 'pain_stop'`) y tampoco es una decisión del agente (ADR-016) |
| `agent_decision` | `agent` | text | Quién propuso. Además de los agentes, `rules` cuando, ante una molestia, la baja la propone el motor de reglas porque el LLM no propuso una válida (ADR-021). En el código de hoy es `source` (`llm` o `rules`) |
| `symptom_report` | `kind` / `action` | text | `kind`: `red_flag` o `discomfort`. `action`: `session_stopped`, `demand_lowered`, `paused` o `logged`. Dato de salud (ADR-021) |
| `plan_exercise` | `rest_min_seconds` / `rest_max_seconds` | int | Descanso entre series recomendado, 10–180 s. Es una recomendación, no forma parte de `safety_envelope` (ADR-022) |
| `clinical_report` | `reviewed_by` | uuid | Terapeuta que aprobó el borrador. Sin revisión, el reporte es borrador |
| `monitoring_period` | `days_with_data` | int | Días con sesión en la ventana de 30 días. Alimenta la facturación RTM |
| `monitoring_period` | `therapist_minutes` | int | Minutos que el terapeuta dedicó a revisar. También cuenta para RTM |

## Reglas de integridad

- `session.monitoring_period_id` debe apuntar a un periodo del mismo `patient_id`.
- `compensation_event.rep_metric_id` debe pertenecer a la misma `session_id`.
- `agent_decision.outcome = 'applied'` solo si `within_envelope = true`.
- `clinical_report.fhir_bundle` solo se exporta fuera de Staging si `reviewed_by` no es null.

## Staging local: SQLite de las cuentas de demostración (ADR-012)

`src/backend/staging_api.py` guarda un subconjunto del modelo anterior en SQLite, en `~/.axonfas/staging.sqlite3`, fuera
del repo y de Drive. Solo datos sintéticos o del equipo con consentimiento (ADR-010).

| Tabla SQLite | Equivale a | Diferencia con el modelo PostgreSQL |
|---|---|---|
| `therapist` | `THERAPIST` | Sin `clinic_id` ni `license_number`: una sola clínica implícita |
| `patient` | `PATIENT` | Agrega `invite_code` (6 caracteres, un solo uso) y `joined_at`; `consent_given` lo marca el propio paciente al afiliarse y vuelve a 0 con un código nuevo (TD-85). `profile` (JSON, ADR-017): `{limitations: [no_floor, no_kneel, no_standing, balance, walking_aid, arm_limited, no_band, low_vision, hearing], pain_areas: [knee, hip, back, neck, shoulder], note (≤ 200), updated_at}`; solo opciones cerradas; dato de salud: Staging, seudónimo y consentimiento. Las bases anteriores ganan la columna al arrancar |
| `token` | — | Tokens bearer (`role` = `therapist`, `patient`, `admin` o `user` para una cuenta de Google que todavía elige rol). Las bases anteriores se migran solas al arrancar. No existe en Producción (TD-41). Un código de afiliación nuevo borra los tokens del paciente |
| `app_user` | — | Cuentas de Google (ADR-019): `google_sub` (único), `email`, `name`, `role` (`admin`, `therapist`, `patient`, `pending`), `therapist_id` o `patient_id` vinculados, `disabled`, `created_at`, `last_login_at`. Datos personales de quien entra (equipo y jueces): solo en la base de Staging, fuera del repo; el paciente sigue con seudónimo |
| `plan_exercise` | `CARE_PLAN` + `PLAN_EXERCISE` | El plan se aplana por paciente: `exercise_id` del catálogo, `sets`, `reps`, `hold_seconds`, `per_week`, `safety_envelope` (JSON `{trunk_margin, valgus_margin, max_reps, rom_min?, rom_max?}` solo en monitoreados; `rom_min` y `rom_max` van juntos, entre 10 y 140, con `rom_min < rom_max`. Para el agente, `safety.agent_envelope` copia solo esas claves numéricas y agrega `pain_stop: true`; sin `rom_min`/`rom_max` el agente no puede ajustar el rango. `trunk_margin` es un margen sobre la línea base, no el `max_trunk_flex` absoluto del modelo PostgreSQL), `notes`, `active`, `rest_min_seconds` y `rest_max_seconds` (descanso recomendado, opcionales; si viene uno solo, el otro toma el mismo valor; las bases anteriores ganan las columnas al arrancar, ADR-022) |
| `session` | `SESSION` + `REP_METRIC` | `mode` (`monitored`/`guided`), `source` (`camera`/`demo`/`guided`), `reps_done`; las métricas por repetición van como JSON en `reps`: en sentarse y pararse monitoreado, `kneeRom`, `peakTrunk`, `peakValgusL/R`, `romReached`, `lowConfidenceRatio` y `calibration`; en el conteo con cámara de la galería (TD-49), `peak` (recorrido máximo desde la posición inicial, en la unidad de la medida), `holdSec`, `holdOk`, `seconds` y `side` (`L`, `R`, `+`, `-`). Se guardan solo esos campos y con tipos válidos; el resto se descarta |
| `compensation_event` | `COMPENSATION_EVENT` | Agrega `side`, `value`, `peak` y `threshold`; `rep` es el índice de la repetición |
| `clinical_report` | `CLINICAL_REPORT` | Una por sesión (`session_id` UNIQUE). `soap_draft` es JSON `{S, O, A, P}`; agrega `facts` (JSON con los datos que la nota puede citar, de `soap.facts`), `source` (`template` o `llm`) y `created_at`. `reviewed_by` y `reviewed_at` van juntos (CHECK): sin ellos es borrador. No guarda `fhir_bundle`: la Observation se genera al pedirla. Las bases anteriores ganan la tabla al arrancar (`CREATE TABLE IF NOT EXISTS`) |
| `symptom_report` | `SYMPTOM_REPORT` (nueva; parte de lo que hoy sería `VOICE_TURN`) | Molestias que avisa el paciente: `patient_id`, `session_id` (se une al guardar la sesión, por id), `exercise_id`, `reported_at`, `kind`, `category` (`red_flag`, `pain`, `cramp`, `fatigue`, `stiffness`, `other`), `text` (≤ 200), `action`, `adjustment` (JSON `{param, old, new}` solo con `demand_lowered`) y `source` (`patient_form` o `voice_turn`). Dato de salud: Staging, seudónimo y consentimiento. Las bases anteriores ganan la tabla al arrancar |

Reglas que aplica la API:

- Una sesión solo se registra si el paciente dio su consentimiento y el ejercicio está en su plan activo (I-3, I-9).
- `mode = 'monitored'` solo para ejercicios con monitoreo automático en el catálogo.
- Combinaciones que se usan: `monitored` + `camera`/`demo` (sentarse y pararse con alertas), `guided` + `camera`
  (seguimiento con conteo de la galería, ADR-014) y `guided` + `guided` (sin cámara; el paciente marca las series).
- Guardar un plan desactiva el anterior (`active = 0`) en vez de borrarlo, así el historial no pierde referencias.
- Los indicadores (01 · Lógica) se calculan al consultar; no se guardan.
- Los números de cada evento (`value`, `peak`, `threshold`) tienen que ser números finitos o faltar; si no, 400.
  `alertLatencyMs` fuera de 0–60000 se guarda vacío.
- La nota SOAP solo cambia mientras es borrador: firmar guarda A y P (S y O no se editan) y una nota firmada no se
  vuelve a firmar.
- La meta de la nota sale del plan vigente al terminar la sesión; si el reloj del dispositivo quedó antes que el plan,
  se usa el plan más antiguo de ese ejercicio.
- Una molestia solo se registra con consentimiento (403 sin él). Si trae un ejercicio, tiene que estar en el plan
  activo (409). Su decisión es determinista y nunca sale del sobre.
- `symptom_report_ids` de otro paciente o ya unidos a una sesión se ignoran sin error.
- Un código de afiliación nuevo pone `consent_given = 0` (TD-85).
