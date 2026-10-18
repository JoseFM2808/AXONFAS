# 04 · Decisiones (ADRs)

> Proyecto: **AXONFAS** · Actualizado: 2026-10-17
> Solo decisiones formales, técnicas o de negocio con impacto técnico. Nada de conversaciones exploratorias.
> Formato: `ADR-NNN` consecutivo · fecha · estado (Propuesta | Aceptada | Reemplazada) · contexto → decisión → consecuencias.

| ADR | Fecha | Estado | Decisión |
|---|---|---|---|
| 001 | 2026-09-28 | Aceptada | Nombre definitivo del proyecto: AXONFAS |
| 002 | 2026-09-28 | Aceptada | Pivot de B2C a B2B2C: se vende a clínicas, el paciente lo usa gratis |
| 003 | 2026-09-28 | Aceptada | El video no sale de casa: el navegador envía solo coordenadas 2D |
| 004 | 2026-09-28 | Aceptada | Dos bucles: reglas deterministas para seguridad y LLM para adaptar la sesión |
| 005 | 2026-09-28 | Aceptada | Sobre de seguridad definido por el terapeuta en cada `plan_exercise` |
| 006 | 2026-09-28 | Aceptada (ajustada por ADR-018) | Todos los modelos en 1× MI300X con vLLM + PyTorch en ROCm |
| 007 | 2026-09-28 | Aceptada | De 5 agentes LLM a 3 agentes + 1 motor de reglas + 1 servicio de pose |
| 008 | 2026-09-28 | Aceptada | Salida clínica en FHIR R4 (Observation) + borrador SOAP |
| 009 | 2026-09-28 | Aceptada | Alcance del demo: 1 ejercicio y 2 compensaciones |
| 010 | 2026-09-28 | Aceptada | Todo el hackathon vive en Staging con datos sintéticos |
| 011 | 2026-10-11 | Aceptada | Galería de ejercicios desde fuentes documentadas; solo sentarse-pararse con monitoreo automático |
| 012 | 2026-10-11 | Aceptada | Cuentas de demostración de fisioterapeuta y paciente en Staging, con API local y SQLite fuera del repo |
| 013 | 2026-10-11 | Aceptada | Vista corporal 2D en vivo con carga muscular estimada; el modelo 3D anatómico queda para la nube |
| 014 | 2026-10-11 | Aceptada | Seguimiento con cámara y conteo para los 24 ejercicios de la galería, sin alertas |
| 015 | 2026-10-11 | Aceptada | Preparar la cámara antes de cada sesión y no evaluar lo que no se ve bien |
| 016 | 2026-10-15 | Aceptada | Pila de la GPU lista para correr: modelos, acceso por túnel y ciclo del droplet |
| 017 | 2026-10-15 | Aceptada | Sugerencias por rol, perfil del paciente y accesibilidad WCAG 2.2 AA |
| 018 | 2026-10-17 | Aceptada | La IA sale de AMD Token Factory (regla del hackathon); el vLLM propio en MI300X queda como alternativa |
| 019 | 2026-10-17 | Aceptada | Inicio de sesión con Google, roles y Administrador maestro definido por el entorno |
| 020 | 2026-10-17 | Aceptada | Despliegue: web estática en Vercel y servidor completo en la nube de AMD con Docker y HTTPS |
| 021 | 2026-10-17 | Aceptada | Ante una molestia, el sistema baja la exigencia, la registra y avisa al fisioterapeuta |
| 022 | 2026-10-17 | Aceptada | Descanso entre series como recomendación del fisioterapeuta, no como límite |
| 023 | 2026-10-17 | Aceptada (ajustada por ADR-028) | Nivel 1: descargo médico y triaje de banderas rojas antes de las rutinas de autogestión |
| 024 | 2026-10-17 | Aceptada | El valgo se mide en un marco de la pelvis normalizado por el ancho de cadera |
| 025 | 2026-10-17 | Aceptada | Nivel 2: meta de recorrido por paciente, plan del día y dolor al terminar (EVA) |
| 026 | 2026-10-18 | Aceptada | Nivel 3: organizaciones con planes de licencias y un panel de empresa sin datos clínicos |
| 027 | 2026-10-17 | Aceptada | Video de presentación generado con código: Remotion y voz local con Kokoro |
| 028 | 2026-10-18 | Aceptada | Invitado sin registro, muro de autenticación diferido y demo pública con datos solo para el Administrador |
| 029 | 2026-10-18 | Aceptada | Tutorial "Mira y sigue" antes de la cámara y rutina sin cámara marcada en la base |

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

## ADR-014 · Seguimiento con cámara y conteo en todos los ejercicios de la galería — Aceptada

- **Fecha:** 2026-10-11
- **Contexto:** el owner probó la galería y solo veía imágenes de referencia: la cámara se usaba únicamente en sentarse y
  pararse (ADR-009, ADR-011). Pidió ver su seguimiento corporal y contar repeticiones en todos los ejercicios.
- **Decisión:** `tracker.js` define, para cada uno de los 24 ejercicios, una medida tomada de la pose de MediaPipe (un
  ángulo, una distancia o un tiempo sostenido) y la cuenta en uno de tres modos. **Repeticiones:** ida y vuelta desde la
  posición inicial, que se toma cuando la persona se queda quieta 1 s. **Sostén:** tiempo dentro de una condición, como
  el pie levantado. **Manual:** para lo que la cámara no ve (abdomen, escápulas); la persona marca el sostén y la cámara
  confirma que sigue en posición. `seguimiento.html` muestra el esqueleto, el valor junto a la articulación, el contador
  grande, el mapa muscular según el avance y la tabla de repeticiones. **No emite alertas de compensación:** el motor
  de reglas y sus alertas siguen siendo solo de sentarse y pararse (ADR-004, ADR-009). En modo paciente sigue la dosis
  del plan y le manda al fisioterapeuta el esqueleto (15 puntos, ahora con brazos y orejas), la medida y el avance. La
  sesión se guarda como `mode = 'guided'` y `source = 'camera'`.
- **Consecuencias:**
  - El cumplimiento de todo el plan puede venir de repeticiones contadas por la cámara.
  - 14 de los 24 ejercicios se siguen de forma aproximada (acostados, de perfil o con profundidad estimada), y la
    página lo avisa.
  - Medidas y umbrales son valores de partida: validarlos es TD-48.
  - La calidad se sigue midiendo solo en sesiones monitoreadas.
  - Los estilos del escenario de cámara pasan a `hud.css`, compartidos por `index.html` y `seguimiento.html`.

## ADR-015 · Preparar la cámara antes de cada sesión y no evaluar lo que no se ve bien — Aceptada

- **Fecha:** 2026-10-11
- **Contexto:** el owner pidió que la cámara pida una posición desde la que el movimiento se vea completo, con
  alternativas, y advirtió que la posición cambia qué tan bien se ven las medidas. Desde una mala posición, una medida
  puede dar falsas alarmas: por ejemplo, el valgo de rodilla de lado o la flexión del tronco de frente, que es
  profundidad y la cámara solo la estima.
- **Decisión:** antes de cada sesión con cámara (Prototipo y seguimiento de la galería) hay un paso de preparación
  (`camera-setup.js`).
  - Ofrece tres posiciones (en diagonal, de frente, de lado), con la calidad esperada de cada medida según el plano en
    que se mueve, y recomienda la mejor.
  - Con la cámara encendida revisa en vivo que se vea lo necesario, la distancia y el ángulo real (por el ancho
    aparente de hombros y cadera). La sesión empieza cuando todo se mantiene bien 1,5 s, o cuando la persona lo pide.
  - En sentarse y pararse, las compensaciones "poco confiables" desde la posición real no disparan alertas, y la
    lectura dice "no se evalúa desde esta cámara".
  - La posición viaja en el canal en vivo, y el fisioterapeuta ve desde dónde se mide y qué queda menos confiable.
- **Consecuencias:**
  - Menos falsas alarmas.
  - Una mala posición no se puede ignorar: se pide corregirla o se avisa que ciertas medidas no cuentan.
  - Las calidades por plano y los umbrales del ángulo son valores de partida: validarlos con cámara real es TD-57.

## ADR-016 · Pila de la GPU lista para correr: modelos, acceso por túnel y un script para el ciclo del droplet — Aceptada

- **Fecha:** 2026-10-15
- **Contexto:** la cuenta de AMD Developer Cloud está lista, pero la MI300X espera la aprobación de AMD (TD-04). El owner
  pidió que, cuando llegue el acceso, solo haya que correr el programa. Cada hora de GPU cuesta USD 1.99 y el puerto de
  vLLM de la imagen Quick Start queda público si no se protege.
- **Decisión:**
  - **Modelos** (todos con licencia que permite uso comercial):
    - Qwen2.5-7B-Instruct (Apache-2.0) en vLLM, con el 45 % de la memoria de la GPU.
    - Whisper large-v3-turbo (MIT) para pasar voz a texto.
    - Kokoro-82M (Apache-2.0) para la voz en español.
    - Whisper y Kokoro corren en PyTorch sobre ROCm, en el contenedor `rocm` de la imagen vLLM Quick Start, en `atl1`.
    - El lifter 3D sigue pendiente (TD-05).
  - **Dependencias:** se instalan con un archivo de restricciones que congela torch, transformers y numpy de la imagen,
    para que pip nunca cambie el PyTorch de ROCm.
  - **Acceso:**
    - vLLM (puerto 8000) y el servidor de voz (8001) solo se usan por un túnel SSH.
    - Escuchan en localhost o en la IP interna del contenedor, y piden una clave que se genera y queda en el droplet.
    - Un firewall de la nube (`axonfas-fw`, por la etiqueta `axonfas`) deja entrar solo SSH.
  - **Agentes** (`src/agents/`, solo biblioteca estándar):
    - Las frases de alarma y la validación contra el sobre son deterministas y van antes y después del LLM.
    - La frase para el paciente y la nota SOAP descartan todo texto del LLM que traiga números que no están en los datos.
  - **Operación:**
    - `src/backend/cloud/axonfas-cloud.ps1` cubre el ciclo: `check`, `up`, `deploy`, `tunnel`, `smoke`, `bench`,
      `fetch` y `down`.
    - `up` y `down` piden `-Yes`; `up` no crea nada si la cuenta no tiene la MI300X habilitada.
    - Lo que corre en la GPU vive en `src/backend/gpu/`: `bootstrap.sh`, `voice_server.py`, `smoke.py` y `bench.py`.
- **Consecuencias:**
  - El día del acceso, la secuencia es `up -Yes` → `deploy` → `bench` → `down -Yes`.
  - Los agentes, el sobre y la conexión HTTP están probados sin GPU (18 tests).
  - Lo que solo se sabe con la GPU queda para ese día: que los modelos quepan, los tiempos y que Kokoro instale bien
    sobre la imagen.
  - El benchmark mide el bucle lento: el bucle rápido sigue en el navegador hasta elegir el lifter (TD-05).

## ADR-017 · Sugerencias por rol, perfil del paciente y accesibilidad WCAG 2.2 AA — Aceptada

- **Fecha:** 2026-10-15
- **Contexto:** el owner pidió tres cosas:
  - una interfaz simétrica y sin desbordes;
  - sugerencias "de IA" según el rol: para el usuario, sobre cómo usar mejor la plataforma; desde el perfil del
    paciente, dirigidas al fisioterapeuta, con cambios en el plan que tengan en cuenta sus limitaciones físicas;
  - accesibilidad web.

  Hay dos reglas que no se pueden romper: la IA nunca decide sobre la seguridad ni cambia el plan (ADR-004, ADR-005), y
  ningún texto puede atribuirle a la IA lo que no hace (TD-34). La GPU todavía no está conectada (TD-04).
- **Decisión:**
  - **Sugerencias deterministas y explicables** (`suggestions.js`, navegador y Node). Cada una dice el dato que la
    origina ("Por qué: …").
    - `forUser`: consejos de uso para el paciente o visitante (qué hacer hoy, cámara, técnica, accesibilidad). Nunca
      cambian dosis; lo clínico remite al fisioterapeuta.
    - `forTherapist`: a partir del perfil y los datos del paciente: cambio de ejercicio por uno que encaje, bajar
      dosis ante dolor, menos veces por semana si no cumple (solo con más de 7 días en el plan), agregar un ejercicio
      ante alertas repetidas y precauciones.
    - Son propuestas: "Revisar en el plan" abre el editor con el cambio marcado y solo se aplica si el fisioterapeuta
      guarda.
  - **IA solo para resumir** (`agents/advisor.py`). Si la GPU está conectada, el fisioterapeuta puede pedir un resumen
    de esas sugerencias. Se descarta si trae cifras que no están en los datos, si nombra ejercicios que no están en el
    plan ni en las sugerencias, o si es largo. Sin GPU, la interfaz lo dice y no muestra el botón.
  - **Perfil del paciente** (`patient.profile`, JSON). Solo opciones cerradas (9 limitaciones y 5 zonas con dolor),
    más una nota de hasta 200 caracteres. Lo completa el paciente o el fisioterapeuta. Cada ejercicio declara qué exige
    (`NEEDS`: suelo, rodillas, de pie, equilibrio, banda, brazo y zonas que carga).
  - **Accesibilidad WCAG 2.2 AA en las cinco páginas:**
    - "Saltar al contenido", una sola región principal y tablas con scroll enfocables y con nombre.
    - Estados y avisos anunciados (`role="status"`, `aria-live`) y foco visible con contraste.
    - Mapa muscular operable con teclado, objetivos táctiles de 40 px y textos que no se salen de su caja.
    - Movimiento reducido para los adornos y bordes en alto contraste de Windows.
    - Tokens nuevos `--alert-ink` (texto rojo con 5,3:1 o más), `--alert-strong` (botón de detener con 5,5:1) y
      `--focus`.
  - **Simetría:** las tarjetas de una fila y los indicadores comparten filas con `subgrid`. Las celdas de las tablas se
    ajustan en vez de forzar un scroll lateral.
- **Consecuencias:**
  - axe-core 4.10 (WCAG 2.2 A/AA y buenas prácticas) da 0 violaciones en las cinco páginas, en escritorio y en celular.
  - Falta probar con lectores de pantalla reales (TD-66).
  - Las reglas de encaje y las sugerencias son valores de partida que se validan con fisioterapeutas (TD-65).
  - El perfil es un dato de salud: solo en Staging, con seudónimo y consentimiento (ADR-010); entra en la revisión de
    protección de datos (TD-14).

## ADR-018 · La IA sale de AMD Token Factory — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:** las reglas del hackathon (comunicadas por el owner) piden usar **exclusivamente** la API de AMD de
  Token Factory (https://notebooks.amd.com/tokenfactory): un catálogo de modelos hospedado por AMD, sin facturación ni
  tarjeta. La MI300X propia (ADR-006, ADR-016) sigue sin aprobarse (TD-04).
- **Decisión:**
  - `src/agents/providers.py` elige el proveedor, siempre de AMD:
    1. **AMD Token Factory**, con `AMD_TOKENFACTORY_BASE_URL`, `AMD_TOKENFACTORY_API_KEY` y `AMD_TOKENFACTORY_MODEL`
       (vacío = el primero de `GET /models`).
    2. **vLLM propio en una MI300X**, si algún día se aprueba (ADR-016).
    3. **Sin IA** si no hay ninguno: la interfaz lo dice y siguen las reglas (TD-34). Nunca se usa otro proveedor.
  - **Contrato:** API compatible con OpenAI (`/chat/completions`, `/models`). Como la documentación está detrás del
    inicio de sesión de AMD, el cliente es configurable y, si el servicio no acepta `response_format`, repite la
    llamada sin él y rescata el JSON del texto.
  - **Contador de uso:** cada llamada queda registrada (llamadas, errores, tokens, tiempo y propósito) y la ve el
    Administrador.
  - **La clave nunca entra al repo:** va en variables de entorno, en `~/.axonfas/axonfas.env` en la PC o en
    `config/.env.web` en el droplet.
- **Consecuencias:**
  - Los tres agentes, el resumen para el fisioterapeuta (ADR-017) y la prueba de la vista de control usan Token
    Factory en cuanto haya clave, sin cambiar código.
  - El benchmark de sesiones concurrentes en una MI300X (TD-08) queda como trabajo opcional.
  - ADR-006 se ajusta: la tesis "toda la clínica en una GPU" se mantiene para Producción. Para el hackathon, la IA
    corre en la infraestructura hospedada de AMD.

## ADR-019 · Inicio de sesión con Google, roles y Administrador maestro — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:** para el despliegue público hacen falta cuentas reales (las de demostración no tienen contraseña) y una
  vista de control para el equipo.
- **Decisión:**
  - **Google Identity Services en el navegador:** entrega un ID token, que el servidor verifica con la biblioteca
    estándar (`google_auth.py`). Revisa:
    - la firma RS256 contra las claves públicas de Google (en caché según `Cache-Control`);
    - el emisor, que el destinatario sea nuestro `GOOGLE_CLIENT_ID` y la vigencia, con 60 s de tolerancia;
    - que el correo esté verificado.

    No se usa el client secret.
  - **Roles** (tabla `app_user`):
    - **Administrador:** solo si el correo está en `AXONFAS_ADMIN_EMAILS`. Se da y se quita en cada inicio de sesión;
      nunca desde la interfaz.
    - **Fisioterapeuta.**
    - **Paciente:** se afilia con el código y el consentimiento, igual que antes.
    - **Pendiente:** cuenta nueva que todavía elige su rol.
  - **Vista del Administrador** (`admin.html`):
    - conteos, configuración con lo que falta, estado del catálogo de Token Factory, uso y una prueba del modelo;
    - cuentas: dejar como pendiente o fisioterapeuta y desactivar, lo que revoca sus tokens.
    - No muestra datos clínicos.
  - **Cuentas de demostración:** siguen, pero se apagan con `AXONFAS_DEMO_ACCOUNTS=0`. Así un despliegue público solo
    acepta Google.
- **Consecuencias:**
  - El servidor guarda correo y nombre de quien entra con Google: datos personales del equipo y de los jueces. Viven
    solo en la base de Staging, fuera del repo; el paciente sigue con seudónimo.
  - Los tokens siguen siendo bearer, guardados en el navegador. Para Producción falta expiración y revocación (TD-41).
  - Falta limitar los intentos de inicio de sesión (TD-73).

## ADR-020 · Despliegue en Vercel y en la nube de AMD — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:** hace falta una URL pública para los jueces (TD-23). El servidor tiene estado: SQLite, canal en vivo con
  Server-Sent Events y sesiones. Eso no cabe en funciones sin estado como las de Vercel.
- **Decisión:**
  - **Nube de AMD (servidor completo):** un droplet pequeño sin GPU (`s-1vcpu-1gb`, unos USD 0,009 por hora) con
    Docker Compose:
    - `config/deploy/Dockerfile`: Python 3.13 slim, sin dependencias, usuario sin privilegios y la base en un volumen;
    - Caddy, con HTTPS automático (lo exigen Google y la cámara) y sin acumular el canal en vivo.

    Sin dominio propio se usa `<ip>.sslip.io`. Lo maneja `axonfas-cloud.ps1` (`web-up -Yes`, `web-deploy`,
    `web-down -Yes`, que respalda la base antes de destruir). `serve.py --cloud` escucha en `$PORT`.
  - **Vercel (opcional, solo la web):** `vercel.json` en la raíz y `config/deploy/vercel-build.mjs`, que copia la web
    pública y escribe `config.js` con `AXONFAS_API_BASE`.
    - La web llama a la API del droplet; el servidor acepta ese origen con `AXONFAS_CORS_ORIGINS`.
    - Lleva cabeceras de seguridad, con la cámara permitida solo en el propio sitio.
  - **No hay `next.config.js`:** el proyecto no usa Next.js. La web es HTML estático y `vercel.json` cubre lo que haría
    falta.
  - Se agrega `vercel.json` a los archivos permitidos en la raíz (Vercel lo exige ahí).
- **Consecuencias:**
  - Una sola URL con todo en la nube de AMD, o la web en Vercel y la API en AMD.
  - Crear el droplet gasta créditos: pide `-Yes` y el visto bueno del owner.
  - La imagen se compiló y se probó en local con Docker: web, API, volumen, usuario sin privilegios y healthcheck (TD-72).

## ADR-021 · Ante una molestia, el sistema baja la exigencia, la registra y avisa al fisioterapeuta — Aceptada

- **Fecha:** 2026-10-17 (propuesta y aceptada el mismo día, con la ampliación del equipo).
- **Contexto:** con ADR-005, un ajuste que cabía en el sobre se aplicaba siempre. Si el paciente decía "me molesta" y el
  LLM proponía subir el rango o las repeticiones dentro del sobre, el ajuste se aplicaba. Además:
  - el sobre que guarda la API de Staging no tenía `rom_min` ni `rom_max`;
  - sin GPU, el paciente no tenía cómo avisar de una molestia;
  - el fisioterapeuta no se enteraba.
- **Decisión:**
  - **Regla de dirección.** `safety.validate` recibe lo que dijo el paciente. Si trae una palabra de molestia
    (`DISCOMFORT`) y la propuesta sube la exigencia (`LESS_DEMAND`), el resultado es `escalated_to_therapist` con
    `within_envelope = true`. Cada parámetro necesita su límite: `rom_target` exige `rom_min` y `rom_max`, y `reps`
    exige `max_reps` (I-3).
  - **Reducción determinista** (`safety.reduce_demand`): primero el rango, 10° menos hacia `rom_min`; si no se puede, las
    repeticiones × 0,7, nunca más que `max_reps`. Siempre dentro del sobre: pasa por `validate` antes de usarse. Nunca
    toca el descanso (ADR-022).
  - **Respaldo del agente.** Con molestia, si el LLM no propone una baja válida (falla, no propone o propone subir), la
    baja la propone el motor de reglas. La decisión lleva `source: "rules"` y guarda `llm_outcome` y `llm_proposal`.
    Sin límites o sin nada que bajar: pausa y aviso (`paused: true`).
  - **Registro y aviso.** Toda molestia se guarda en `symptom_report`, le llega en vivo al fisioterapeuta
    (`symptom_reported`), cuenta en "Molestias 30 días" (`discomfort_30d`, `red_flags_30d`), genera una sugerencia para
    revisar la dosis que nunca se aplica sola (I-13) y entra en la S de la nota SOAP.
  - **Vía sin GPU.** El formulario "Tengo una molestia" (`symptom-form.js`) llama a `POST /api/me/discomfort`, que decide
    con las mismas reglas, sin LLM.
  - **Las alarmas no cambian.** Dolor agudo, mareo o pérdida de fuerza detienen la sesión sin consultar al LLM (I-7);
    en la clasificación, la alarma gana siempre.
  - Es más restrictiva que ADR-005 y no lo reemplaza.
- **Consecuencias:**
  - Con una molestia, la exigencia nunca queda igual si el sobre permite bajarla.
  - El escalado deja de ser el camino principal: una propuesta del LLM que sube la exigencia ya no pausa el ejercicio;
    se baja con reglas y se avisa.
  - Los valores 10° y × 0,7 son de partida, no clínicos (TD-87). Las palabras y categorías se validan con
    fisioterapeutas (TD-80).
  - La molestia es un dato de salud: solo Staging, seudónimo y consentimiento (ADR-010).
  - Invariante I-16 en [01](01-logic.md).

## ADR-022 · Descanso entre series como recomendación del fisioterapeuta, no como límite — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:** TD-81 preguntaba si `rest_seconds` debía tener un límite del fisioterapeuta en el sobre. Un descanso más
  largo nunca es inseguro, y el paciente necesita poder seguir cuando esté listo.
- **Decisión:**
  - El fisioterapeuta recomienda un descanso por ejercicio en el plan: `rest_min_seconds` y `rest_max_seconds`
    (10–180 s). Si da uno solo, el otro toma el mismo valor; mínimo mayor que máximo → 400.
  - No forma parte de `safety_envelope`. Vale para todo ejercicio, monitoreado o no.
  - Sin valor se sugiere 60 s (`REST_DEFAULT_SECONDS` en `catalog.js` y en la API), un valor de partida y no clínico.
    Todo texto lo dice.
  - El paciente ve una cuenta regresiva (`rest-timer.js`) al terminar una serie y tras una pausa por molestia. Puede
    saltarla o sumar 30 s. Nunca bloquea el siguiente paso.
  - El agente: el `current.rest_seconds` que reciba con TD-61 será `rest.min`; se valida solo con los límites fijos
    10–180; tras una molestia solo puede subirlo (`LESS_DEMAND`). Un `rest_seconds` aplicado cambia la cuenta de esa
    sesión, nunca el plan. La reducción determinista de ADR-021 nunca lo usa.
- **Consecuencias:**
  - Resuelve TD-81 sin extender el contrato del sobre.
  - El valor de 60 s se valida con fisioterapeutas (TD-87).

## ADR-023 · Nivel 1: descargo médico y triaje de banderas rojas antes de la autogestión — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:**
  - El estudio de tele-rehabilitación que trajo el owner (2026-10-17) separa AXONFAS en niveles. En el Nivel 1, la
    autogestión sin prescripción, el riesgo es que alguien con una patología grave haga ejercicio por su cuenta y que el
    software parezca un dispositivo médico sin certificar.
  - Las guías de fisioterapia descartan esas patologías con banderas rojas antes de indicar ejercicio.
  - Hasta hoy, la galería, el seguimiento y el Prototipo solo tenían un aviso de "no es un dispositivo médico".
- **Decisión:**
  - Toda página de autogestión carga `triage.js` con `data-gate="self-care"`: hoy son `galeria.html`, `seguimiento.html`
    e `index.html`.
  - Sin un triaje vigente, el contenido se oculta hasta aceptar el descargo y responder las 8 banderas rojas.
  - Una bandera roja, ya confirmada, bloquea esas páginas 24 h en el equipo y recomienda urgencias o una consulta. Sin
    banderas, el triaje vale 7 días.
  - Las banderas amarillas son opcionales y solo cambian el tono.
  - Reglas fijas, sin IA (I-17). Las respuestas no salen del navegador ni se guardan: solo el resultado, su vencimiento
    y el tono, en `localStorage` (`axonfas.triage`).
  - Exentos: el modo paciente con su plan (Nivel 2: su fisioterapeuta ya lo evaluó) y las cuentas de fisioterapeuta o
    Administrador.
- **Consecuencias:**
  - Una pantalla más antes de la galería y del Prototipo sin cuenta. Los jueces del hackathon la pasan en menos de un
    minuto respondiendo que no.
  - Es una puerta del lado del cliente: borrar el almacenamiento la reinicia. Orienta y protege, pero no es un control
    de acceso; para eso hacen falta cuentas reales (TD-41).
  - Las preguntas, el texto y las vigencias se validan con fisioterapeutas y en la revisión regulatoria (TD-98, TD-13).
  - Cambiar las preguntas exige subir `VERSION`.
  - No amplía el alcance clínico de ADR-009: no agrega ejercicios ni compensaciones.

## ADR-024 · El valgo se mide en un marco de la pelvis normalizado por el ancho de cadera — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:**
  - El estudio de tele-rehabilitación señala el punto débil de medir el valgo con una sola cámara: es un ángulo del plano
    frontal dentro de un movimiento sagital, y la profundidad estimada acumula error (paralaje).
  - Recomienda normalizar el esqueleto con el punto medio de las caderas como origen y el ancho de cadera (puntos 23 y
    24) como escala.
  - El proxy anterior (TD-28) ya era un cociente, así que no le afectaban la estatura ni la distancia. Pero medía en el
    marco de la cámara: con la persona en diagonal, el desplazamiento medial se achicaba por el coseno del giro, y la
    preparación de la cámara recomienda justamente la diagonal (ADR-015).
- **Decisión:**
  - `engine.js` normaliza cada frame con `normalizeSkeleton`: origen en el punto medio de las caderas, giro alrededor
    de la vertical anulado y escala = ancho de cadera.
  - El valgo (`frontalValgus`) es el desplazamiento medial de la rodilla contra la tibia proyectada en el plano frontal
    de la pelvis.
  - El giro sale de la profundidad de las caderas. Para que su ruido no entre en el valgo, la sesión lo suaviza
    (`yawSmoothing = 0.15`) y lo limita a ±45° (`maxYawCorrectionDeg`); de espaldas se toma el mismo plano frontal.
  - `computeAngles` devuelve además `pelvisYaw`, `rawPelvisYaw` y `hipWidth`.
  - `valgusProxy` queda exportado solo para comparar en los tests.
  - `synthetic.js` acepta `yawDeg` para generar sesiones con la cámara en diagonal.
- **Consecuencias:**
  - A 30° de giro, el valgo coincide con el de frente (antes perdía 1,4° de 10,4°), y el demo girado da las mismas
    alertas.
  - Los márgenes y líneas base siguen en grados, y la línea base es la de cada paciente (I-5), así que el umbral no
    cambia de significado.
  - Cambiar la escala o el origen no mejora un cociente que ya era invariante; lo que corrige errores es anular el giro.
    Con giros mayores a 45° el valgo sigue siendo poco confiable, y ADR-015 lo apaga desde 62°.
  - La validez contra un sistema con marcadores sigue pendiente (TD-16, TD-57).

## ADR-025 · Nivel 2: meta de recorrido por paciente, plan del día y dolor al terminar — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:**
  - El Nivel 2 del estudio de tele-rehabilitación es la terapia guiada por el plan del fisioterapeuta.
  - Hasta hoy, el fisioterapeuta solo fijaba límites de movimiento en sentarse y pararse (sobre con `rom_min` y
    `rom_max`, ADR-005 y ADR-021). En los 23 ejercicios de la galería, la cámara usaba el recorrido de `SPECS`, igual
    para todos los pacientes (TD-99).
  - El paciente veía todo su plan cada día, sin saber qué le tocaba hoy.
  - El fisioterapeuta no sabía cómo terminaba cada sesión: solo veía las detenciones por dolor y las molestias que el
    paciente reportaba (TD-100).
- **Decisión:**
  - **Meta de recorrido (TD-99):**
    - Cada ejercicio de la galería que la cámara mide (modo de repeticiones o de sostén) puede llevar en el plan un
      `range_goal = {target, limit, unit}`, en la unidad de su medida.
    - En repeticiones, `target` reemplaza el recorrido pedido (`delta`). En sostenes, reemplaza el valor a sostener
      (`threshold`).
    - `limit` va más allá de la meta en el sentido del esfuerzo (más bajo en la postura en tándem).
    - La API valida contra `SPECS` de `tracker.js`, leído por `load_tracking`, con límites de forma por unidad: 1–180°,
      0,5–50 cm y 1–200 %.
    - Rechaza la meta en sentarse y pararse (usa su sobre) y en los ejercicios manuales (la cámara no los ve).
    - La meta no es el sobre: va en su propia columna y los guiados siguen sin sobre (I-9).
    - `tracker.withGoal` la aplica solo en modo paciente.
    - Pasar el límite no es una alerta (I-12): la repetición cuenta igual y queda marcada con `overLimit`. La pantalla y
      la voz dicen "Hasta ahí basta", y el panel muestra cuántas pasaron el límite.
  - **Plan de Cuidados del día (TD-100):**
    - `care-plan.js` decide con reglas fijas, sin IA, qué toca hoy en la hora local del paciente. Usa `per_week` y las
      sesiones completadas de los últimos 14 días (`history` en `GET /api/me`).
    - La semana va de lunes a domingo. Hecho hoy → "hecho". Frecuencia cumplida → "cumplido".
    - Si no, toca cuando pasaron `floor(7 / per_week)` días desde la última vez, o cuando lo que falta ya no entra en los
      días que quedan de la semana. Si no toca, "descanso" con el día en que vuelve a tocar.
    - `paciente.html` muestra primero "Hoy toca". El resto queda plegado y se puede hacer igual: es una agenda, no un
      bloqueo.
  - **Dolor al terminar (TD-100):**
    - Después de guardar cada sesión (vista guiada, seguimiento con cámara y sentarse y pararse), el paciente puede
      marcar una EVA de 0 a 10 (`pain-scale.js`). Es opcional.
    - `PUT /api/sessions/{id}/pain` la guarda una sola vez en `session.pain_score` y avisa en vivo (`pain_scored`).
    - El panel muestra el KPI "Dolor al terminar (EVA)", la columna en el historial y el aviso en vivo. La nota SOAP
      (S) y la Observation FHIR la incluyen.
    - Desde 7/10 (`PAIN_HIGH`), el panel lo marca como alto y el paciente recibe un texto fijo: no repetir hoy y avisar.
      No detiene nada, no cambia el plan y el LLM no lo lee para decidir (I-1, I-13).
- **Consecuencias:**
  - El fisioterapeuta adapta el recorrido de la galería a cada paciente, igual que el sobre de sentarse y pararse.
  - Las metas, la separación entre sesiones y el umbral de dolor alto son valores de partida, no clínicos: se validan
    con fisioterapeutas (TD-104).
  - La EVA es lo que el paciente marca al terminar; no reemplaza "Dolor: detener" ni el formulario de molestias, que
    siguen siendo el camino ante dolor agudo, mareo o pérdida de fuerza (I-7).
  - Una meta guardada en el plan solo cambia el seguimiento en modo paciente; la galería abierta sigue con `SPECS`.
  - No amplía el alcance clínico de ADR-009: no agrega ejercicios ni compensaciones, y el seguimiento sigue sin alertar.

## ADR-026 · Nivel 3: organizaciones con planes de licencias y un panel de empresa sin datos clínicos — Aceptada

- **Fecha:** 2026-10-18
- **Contexto:**
  - El estudio de tele-rehabilitación (2026-10-17) propone un tercer perfil, la empresa: cadenas de clínicas u
    hospitales que contratan un plan, gestionan las licencias de sus profesionales y conectan su historia clínica
    electrónica con HL7 FHIR.
  - ADR-002 ya vende a clínicas, pero el modelo de Staging tiene "una sola clínica implícita" (03) y no hay manera de
    contar licencias ni de ubicar a un profesional en una organización.
- **Decisión:**
  - Tablas `organization` y `org_license` en Staging. Reglas puras en `src/backend/organizations.py`: dos planes sin
    precio ("Clínica pequeña", 5 licencias; "Red hospitalaria", 50), una licencia activa por correo en todo el sistema,
    liberar sin tocar al profesional ni a sus pacientes, y la dirección FHIR solo https y sin credenciales.
  - El Administrador maestro crea la organización con un correo de administración (`POST /api/admin/orgs`). Esa cuenta
    de Google recibe un token `org` (sujeto = la organización) y entra a `empresa.html`. Tiene prioridad sobre otro rol
    de la misma cuenta, salvo el Administrador maestro.
  - La administración invita profesionales por correo. La licencia se vincula al fisioterapeuta cuando entra con Google
    con ese correo y elige ese rol, o cuando el Administrador lo deja como fisioterapeuta.
  - El panel de empresa solo devuelve plan, licencias y cuántos pacientes atiende cada profesional (I-19).
  - Con licencia activa, la nota SOAP como documento FHIR lleva a la organización como custodio (TD-103). En Staging no
    se envía nada a la historia clínica: solo se guarda la dirección (TD-20).
  - El token gana los roles `org` y `guest` (este último, reservado para TD-106). Las bases anteriores reconstruyen la
    tabla `token` al arrancar, como en ADR-019.
- **Consecuencias:**
  - Amplía ADR-002 con un perfil de empresa, pero no cambia el producto clínico ni el alcance de ADR-009.
  - Planes, cupos y la regla de una licencia por correo son valores de partida. Facturación, precios y la asignación de
    pacientes entre profesionales de una misma organización quedan en TD-105.
  - Antes de Producción hace falta autenticación real para las cuentas de empresa (TD-41) y la revisión de protección de
    datos de los correos de los profesionales (TD-14).

## ADR-027 · Video de presentación generado con código: Remotion y voz local con Kokoro — Aceptada

- **Fecha:** 2026-10-17
- **Contexto:**
  - La entrega de lablab pide un video demo (TD-11). El owner quiere un video animado, todo en inglés, hecho con código y
    con el guion del documento estratégico *Investigacion_y_Guion_Video_AXONFAS* (4 fases: The Problem, The Capture, The
    Brain, The Impact).
  - El repo es público y vive en Google Drive: las dependencias pesadas no pueden ir en Drive (como en Mi-puestito), el
    audio y el video no se versionan (ADR-003, `.gitignore`) y no se pueden usar imágenes de terceros.
  - La frase de la fase 3 del documento atribuía la lógica del movimiento a la IA y la latencia a "edge GPU clusters",
    lo que contradice ADR-004, ADR-018 y TD-34.
- **Decisión:**
  - **Remotion 4** (React + TypeScript, versiones fijadas) en `src/axonfas-video-presentation/`: emula el HUD del
    prototipo con SVG propio y los tokens de `docs/design-system/tokens.css`, que se copian al compilar (no se duplican).
  - **Voz en off con Kokoro-82M** (Apache-2.0, el TTS de ADR-016) en ONNX sobre la CPU con `kokoro-onnx`: local, sin
    claves. Si no está instalado, las voces en inglés de Windows (SAPI). Cada escena dura lo que su audio, con la duración
    base del guion como mínimo.
  - Un solo guion, `script/voiceover.json`, para los subtítulos y el TTS. La fase 3 se reescribe en tres frases
    alineadas con los ADRs; la original queda en el JSON.
  - `video.py` (solo biblioteca estándar) copia el proyecto a `~/.axonfas/video-presentation`, fuera de Drive y del
    repo, y ahí instala, narra y renderiza. El modelo se verifica con SHA-256.
- **Consecuencias:**
  - Node y Remotion entran al repo solo para el video; el producto sigue sin build de frontend.
  - El primer render baja Chrome Headless Shell y usa Google Fonts: necesita internet.
  - Remotion es gratis para personas y equipos pequeños; una empresa grande necesitaría licencia comercial (TD-112).
  - Cambiar el guion obliga a correr `py video.py voice` y `py video.py render` de nuevo.

## ADR-028 · Invitado sin registro, muro de autenticación diferido y demo pública con datos solo para el Administrador — Aceptada

- **Fecha:** 2026-10-18
- **Contexto:**
  - El owner pide equilibrar la captación (B2C) con la seguridad de los datos.
  - La demo inicial queda abierta para cualquiera, y lo que genere solo lo ve el Administrador.
  - Un invitado explora sin registrarse, y la cuenta se exige recién ante algo permanente o clínico.
  - Hasta hoy, sin cuenta no había nada que ver del lado clínico. El triaje (ADR-023) tapaba la galería y el Prototipo
    enteros, incluso el demo sintético, que no es ejercicio.
- **Decisión:**
  - Token `guest` (`POST /api/auth/guest`), sin datos personales.
  - Con el token `guest`, las lecturas de fisioterapeuta (GET) se resuelven contra un consultorio de muestra compartido,
    creado una vez con datos sintéticos. Cualquier otra ruta responde 401 `auth_required`.
  - `auth-wall.js` muestra la barra del invitado y el diálogo del muro. `api-client.js` lo dispara ante `auth_required`,
    y las páginas lo piden antes con `AxonWall.require(motivo)`.
  - Sin cuenta, el seguimiento libre es una vista previa de una serie.
  - La demo pública manda a `demo_run` solo números anónimos, con una casilla visible para no compartir y un tope de 500
    por hora. Solo los lee `GET /api/admin/demo-runs`.
  - El triaje de ADR-023 se pide donde se hace ejercicio: el seguimiento libre entero y la cámara del Prototipo
    (`AxonTriage.ensure()`). La galería y el demo sintético quedan sin triaje.
- **Consecuencias:**
  - Ajusta ADR-023 en dónde se pide el triaje, no en qué pregunta ni en qué bloquea.
  - Una persona sin cuenta ya no hace la rutina libre completa: la vista previa termina tras la primera serie.
  - El consultorio de muestra cuenta en los totales del Administrador, y `guest` y `demo_run` crecen sin borrado: lo
    resuelve TD-114.
  - La vista previa de una serie y el tope por hora son valores de partida (TD-113).

## ADR-029 · Tutorial "Mira y sigue" antes de la cámara y rutina sin cámara marcada en la base — Aceptada

- **Fecha:** 2026-10-18
- **Contexto:**
  - Sobre todo en celular, la persona necesita ver el ejercicio antes de intentarlo con la cámara.
  - Quien no quiere o no puede usar la cámara no debe quedar bloqueado. Antes, un permiso negado dejaba el seguimiento
    parado.
  - El fisioterapeuta tiene que saber cuándo una sesión no tuvo medición.
- **Decisión:**
  - La primera vez que se usa la cámara con un ejercicio en ese equipo, va antes el tutorial con la figura de referencia
    en grande (`practice.js`, `seguimiento.js`).
  - Si la cámara falla o no se permite (`pose-camera.js` avisa el motivo con `onFail`), o si la persona elige "Hacer sin
    cámara", la rutina sigue con la guía en grande y un conteo manual.
  - Se guarda como sesión guiada. El servidor marca `session.no_camera = 1` con su motivo siempre que
    `source = 'guided'` (I-20) y rechaza métricas cinemáticas o eventos en esa sesión.
  - El panel, la nota SOAP (O) y la Observation FHIR (`camera-used: false`) lo dicen con el mismo texto fijo.
- **Consecuencias:**
  - La vista guiada de `paciente.html`, que ya era sin cámara, queda marcada igual (`guided_view`), también en las bases
    anteriores.
  - Una sesión sin cámara cuenta para el cumplimiento, pero no para la calidad ni para el recorrido medio, que salen de la
    cámara. Si debe contar igual que una con cámara se valida con fisioterapeutas (TD-113).
  - No cambia el alcance de ADR-009 ni agrega alertas: sin cámara no hay detección postural.

---

## Anexo · Modelo de negocio acordado (hipótesis a validar, no es un ADR)

- **EE. UU.**: las clínicas pueden cobrar a Medicare por monitoreo terapéutico remoto (RTM). Desde 2026 existen códigos para 2–15 días de datos (98985) y para 10–19 min de gestión (98979). AXONFAS genera exactamente esos datos. Riesgo: RTM exige un dispositivo médico reconocido por la FDA, así que es un segundo paso, no el primero. (Códigos verificados el 2026-10-06 en el Physician Fee Schedule 2026 de CMS: 98985 es el suministro del dispositivo musculoesquelético de 2 a 15 días en 30, y 98979 los primeros 10 minutos de gestión al mes. No se pueden facturar en el mismo mes junto con los códigos de 16–30 días y de 20 minutos.)
- **Perú / LatAm**: suscripción por clínica o por paciente activo. El valor es que un terapeuta supervisa más pacientes en casa y documenta menos.
- **Precio**: no definido. Se valida con entrevistas a 3–5 fisioterapeutas antes de fijarlo.
