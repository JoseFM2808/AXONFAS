# 04 · Decisiones (ADRs)

> Proyecto: **AXONFAS** · Actualizado: 2026-10-11
> Solo decisiones formales, técnicas o de negocio con impacto técnico. Nada de conversaciones exploratorias.
> Formato: `ADR-NNN` consecutivo · fecha · estado (Propuesta | Aceptada | Reemplazada) · contexto → decisión → consecuencias.

| ADR | Fecha | Estado | Decisión |
|---|---|---|---|
| 001 | 2026-09-28 | Aceptada | Nombre definitivo del proyecto: AXONFAS |
| 002 | 2026-09-28 | Aceptada | Pivot de B2C a B2B2C: se vende a clínicas, el paciente lo usa gratis |
| 003 | 2026-09-28 | Aceptada | El video no sale de casa: el navegador envía solo coordenadas 2D |
| 004 | 2026-09-28 | Aceptada | Dos bucles: reglas deterministas para seguridad y LLM para adaptar la sesión |
| 005 | 2026-09-28 | Aceptada | Sobre de seguridad definido por el terapeuta en cada `plan_exercise` |
| 006 | 2026-09-28 | Aceptada | Todos los modelos en 1× MI300X con vLLM + PyTorch en ROCm |
| 007 | 2026-09-28 | Aceptada | De 5 agentes LLM a 3 agentes + 1 motor de reglas + 1 servicio de pose |
| 008 | 2026-09-28 | Aceptada | Salida clínica en FHIR R4 (Observation) + borrador SOAP |
| 009 | 2026-09-28 | Aceptada | Alcance del demo: 1 ejercicio y 2 compensaciones |
| 010 | 2026-09-28 | Aceptada | Todo el hackathon vive en Staging con datos sintéticos |
| 011 | 2026-10-11 | Aceptada | Galería de ejercicios desde fuentes documentadas; solo sentarse-pararse con monitoreo automático |
| 012 | 2026-10-11 | Aceptada | Cuentas de demostración de fisioterapeuta y paciente en Staging, con API local y SQLite fuera del repo |
| 013 | 2026-10-11 | Aceptada | Vista corporal 2D en vivo con carga muscular estimada; el modelo 3D anatómico queda para la nube |

---

## ADR-001 · Nombre definitivo: AXONFAS — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** Kinexa AI ya existe en el mismo rubro. El equipo elige AXONFAS y no aparecen empresas ni apps con ese nombre exacto.
- **Decisión:** el proyecto se llama **AXONFAS**. Reemplaza a Kinexa AI y a la propuesta Kuyuq AI.
- **Consecuencias:** revisar dominio, GitHub, redes y que ningún equipo lo use en lablab (TD-01). "Axon" es una marca muy usada (Axon Enterprise, Axon AI), así que conviene escribir siempre el nombre completo.

## ADR-002 · Pivot de B2C a B2B2C — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** el mercado B2C ya tiene TRAK, KinesteX, Kemtai y Sword. La clínica sí tiene presupuesto y un incentivo de facturación.
- **Decisión:** se vende a clínicas; el paciente lo usa gratis.
- **Consecuencias:** el producto necesita panel de terapeuta y reportes, no solo la app del paciente (TD-09).

## ADR-003 · El video no sale de casa — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** privacidad de datos de salud y menos ancho de banda.
- **Decisión:** el navegador extrae la pose 2D y envía solo coordenadas; el video nunca se transmite.
- **Consecuencias:** la pose 2D depende del dispositivo; la GPU hace el 3D y todo lo demás. El audio de voz sí viaja al servidor para el STT (ver [01 · Lógica](01-logic.md), invariante I-4).

## ADR-004 · Dos bucles: seguridad determinista y LLM para adaptar — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** un LLM no debe decidir una alerta de seguridad; además es más lento.
- **Decisión:** el bucle rápido (< 250 ms) usa reglas deterministas para las alertas; el bucle lento usa el LLM para adaptar la sesión.
- **Consecuencias:** el LLM solo propone; el motor de reglas valida. La latencia se mide en `alert_latency_ms` (TD-07).

## ADR-005 · Sobre de seguridad definido por el terapeuta — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** humano en el ciclo; reduce riesgo clínico y regulatorio.
- **Decisión:** cada `plan_exercise` lleva un `safety_envelope` que fija el fisioterapeuta.
- **Consecuencias:** sin sobre configurado no se puede iniciar sesión. El agente no puede aplicar cambios fuera del sobre.

## ADR-006 · Todos los modelos en 1× MI300X (vLLM + PyTorch en ROCm) — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** la tesis "toda la clínica en una GPU" es el argumento AMD y define el costo por sesión.
- **Decisión:** LLM, Whisper, TTS y lifter de pose corren juntos en una sola AMD Instinct MI300X, con vLLM y PyTorch sobre ROCm.
- **Consecuencias:** el benchmark de sesiones concurrentes es entregable del hackathon (TD-08). Hay que confirmar que los modelos caben juntos (TD-04).

## ADR-007 · De 5 agentes LLM a 3 agentes + 1 motor + 1 servicio de pose — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** varios de los 5 agentes originales no necesitan un LLM, y cada LLM agrega latencia y riesgo.
- **Decisión:** 3 agentes LLM (clínico, conversacional, reporte) + 1 motor de reglas determinista + 1 servicio de pose. Detalle en [02 · Arquitectura](02-architecture.md).
- **Consecuencias:** menos latencia, menos puntos de falla y más fácil de terminar en una semana. La narrativa "multiagente" se mantiene, pero es honesta.

## ADR-008 · Salida clínica en FHIR R4 + borrador SOAP — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** interoperabilidad y ahorro de tiempo de documentación al terapeuta.
- **Decisión:** cada sesión produce una `Observation` FHIR R4 + PDF y un borrador de nota SOAP.
- **Consecuencias:** el reporte es borrador hasta que el terapeuta lo firma (`clinical_report.reviewed_by`). El export se valida con un validador público (TD-10).

## ADR-009 · Alcance del demo: 1 ejercicio y 2 compensaciones — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** una semana de construcción; mejor una cosa perfecta.
- **Decisión:** el demo cubre **1 ejercicio** (sentarse-pararse) y **2 compensaciones** (flexión de tronco y valgo de rodilla).
- **Consecuencias:** otros ejercicios pasan a tech debt (TD-17).

## ADR-010 · Todo el hackathon vive en Staging con datos sintéticos — Aceptada

- **Fecha:** 2026-09-28
- **Contexto:** no hay validación clínica ni permisos para datos reales.
- **Decisión:** durante el hackathon solo existe Staging, con datos sintéticos o del propio equipo con consentimiento.
- **Consecuencias:** Producción queda bloqueada por los puntos de [05-tech-debt.md](05-tech-debt.md) (TD-12 a TD-16).

## ADR-011 · Galería de ejercicios desde fuentes documentadas — Aceptada

- **Fecha:** 2026-10-11
- **Contexto:** el owner pidió ejercicios reales, de fuentes documentadas, agrupados por temática de salud: rodilla y
  cadera, columna lumbar y cervical, hombro, y equilibrio y caídas. El ADR-009 limita el monitoreo automático a un
  ejercicio.
- **Decisión:** catálogo único en `src/frontend/validation-prototype/catalog.js` con 24 ejercicios. Cada uno trae la
  fuente pública (AAOS OrthoInfo, NHS WWL, CDC STEADI), la dosis que esa fuente indica, músculos, huesos, articulaciones
  y precauciones. Las descripciones son del equipo; no se copia el texto de las fuentes. Solo sentarse-pararse lleva
  monitoreo automático por cámara (coherente con el ADR-009); los demás son guiados (pasos, series y temporizador).
- **Consecuencias:** galería navegable por temática y planes armados desde el mismo catálogo. La API lee los ids del
  mismo archivo. Monitorear más ejercicios sigue siendo TD-17.

## ADR-012 · Cuentas de demostración de fisioterapeuta y paciente en Staging — Aceptada

- **Fecha:** 2026-10-11
- **Contexto:** el owner pidió que el fisioterapeuta afilie pacientes, les envíe ejercicios personalizados y vea su
  cumplimiento y efectividad a partir de las alertas. Hay que construirlo ahora sobre el prototipo, sin nube y sin datos
  reales (ADR-010).
- **Decisión:** API de Staging en Python estándar (`src/backend/staging_api.py`), servida por `serve.py` en el mismo
  origen. SQLite en `~/.axonfas/staging.sqlite3`, fuera del repo y de Drive. Cuentas sin contraseña: el fisioterapeuta se
  crea con su nombre y cada dispositivo recibe un token bearer aleatorio. El paciente se afilia con un código de un solo
  uso (o el QR que lo contiene) y acepta el consentimiento. Sin consentimiento y sin plan para ese ejercicio no se
  registran sesiones. Cada fisioterapeuta ve solo a sus pacientes.
- **Consecuencias:** sirve para demos y para las entrevistas con fisioterapeutas (TD-06). No es autenticación de
  Producción: contraseñas o SSO, verificación de matrícula y expiración de tokens quedan en TD-41. La versión de la nube
  reemplazará SQLite por PostgreSQL con el modelo de [03](03-database.md).

## ADR-013 · Vista corporal 2D en vivo con carga muscular estimada — Aceptada

- **Fecha:** 2026-10-11
- **Contexto:** el owner pidió que el fisioterapeuta vea en tiempo real el estado del cuerpo del paciente (huesos y
  músculos) durante el ejercicio y que sirva para enseñarle qué trabaja. Eligió un mapa 2D ahora y el 3D después, en la
  nube.
- **Decisión:** mapa muscular frontal y posterior con los polígonos de react-body-highlighter (MIT) y un esqueleto en vivo
  con los huesos rotulados. El paciente manda unas 5 veces por segundo ángulos, fase, repeticiones, eventos y 9 puntos 2D
  (nunca video). El servidor los reenvía al fisioterapeuta por Server-Sent Events. La carga muscular es una
  **estimación educativa** a partir de los ángulos, no una medición ni un diagnóstico. El fisioterapeuta puede señalar un
  músculo o un ejercicio, y al paciente le aparece en su pantalla.
- **Consecuencias:** funciona en la red local sin GPU. En la nube, el gateway de AMD hará de relevo en lugar de
  `serve.py`. Validar la estimación de carga es TD-43, y el modelo 3D anatómico es TD-42.

---

## Anexo · Modelo de negocio acordado (hipótesis a validar, no es un ADR)

- **EE. UU.**: las clínicas pueden cobrar a Medicare por monitoreo terapéutico remoto (RTM). Desde 2026 existen códigos para 2–15 días de datos (98985) y para 10–19 min de gestión (98979). AXONFAS genera exactamente esos datos. Riesgo: RTM exige un dispositivo médico reconocido por la FDA, así que es un segundo paso, no el primero. (Códigos verificados el 2026-10-06 en el Physician Fee Schedule 2026 de CMS: 98985 es el suministro del dispositivo musculoesquelético de 2 a 15 días en 30, y 98979 los primeros 10 minutos de gestión al mes. No se pueden facturar en el mismo mes junto con los códigos de 16–30 días y de 20 minutos.)
- **Perú / LatAm**: suscripción por clínica o por paciente activo. El valor es que un terapeuta supervisa más pacientes en casa y documenta menos.
- **Precio**: no definido. Se valida con entrevistas a 3–5 fisioterapeutas antes de fijarlo.
