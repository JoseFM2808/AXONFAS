# 04 · Decisiones (ADRs)

> Proyecto: **AXONFAS** · Actualizado: 2026-10-18
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
| 023 | 2026-10-17 | Aceptada | Nivel 1: descargo médico y triaje de banderas rojas antes de las rutinas de autogestión |
| 024 | 2026-10-17 | Aceptada | El valgo se mide en un marco de la pelvis normalizado por el ancho de cadera |
| 025 | 2026-10-18 | Aceptada | Turno de texto del paciente con el agente clínico de AMD: reglas primero, tiempo acotado y atribución visible |
| 026 | 2026-10-18 | Aceptada | Filtro determinista de datos personales antes de cualquier LLM; se guarda lo mismo que se envía |

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
  - El agente: el `current.rest_seconds` que recibe en el turno del paciente es `rest.min` (ADR-025; en el demo todavía no se aplica en ninguna pantalla, TD-104); se valida solo con los límites fijos
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

## ADR-025 · Turno de texto del paciente con el agente clínico de AMD, tiempo acotado y atribución visible — Aceptada

- **Fecha:** 2026-10-18
- **Contexto:**
  - El agente clínico con IA de AMD Token Factory solo corría por línea de comandos (`py -m agents.turn`). En el
    producto, la molestia del paciente la resolvían solo las reglas (`POST /api/me/discomfort`, ADR-021) (TD-61).
  - Staging no guardaba `agent_decision` ni `voice_turn`, y la nota SOAP los recibía vacíos (TD-82). Las molestias del
    turno no se guardaban con `source = 'voice_turn'` (TD-88).
  - La regla del hackathon pide que la carga de AMD se vea en el producto, sin atribuirle a la IA lo que no hizo (TD-34).
  - La clave de Token Factory es una por equipo, con límite de uso. Un turno no puede colgar la pantalla del paciente.
- **Decisión:**
  - **Ruta nueva `POST /api/me/turn`**, con texto (sin voz por ahora). El formulario “Tengo una molestia” la usa solo
    durante una sesión y con texto escrito. Fuera de sesión, o solo con una opción, sigue `POST /api/me/discomfort`, que
    no cambia.
  - **Orden fijo.** 1) Reglas siempre (`_assess_symptom`). 2) Una frase u opción de alarma detiene la sesión sin crear
    ningún cliente de LLM y sin consultar el estado de la IA (I-1, I-7). 3) Solo con sobre, IA disponible y cupo, el
    agente clínico propone. 4) `safety.validate` decide. 5) El agente conversacional redacta la frase si queda tiempo.
  - **Todo turno del formulario es una molestia declarada** (`discomfort_reported`): la regla de dirección y el respaldo
    de reglas de ADR-021 rigen aunque el texto no traiga una palabra de molestia. El resultado siempre es
    `demand_lowered` (por el agente o por las reglas), `paused` o `session_stopped`. Nada sube la exigencia.
  - **Solo parámetros que la pantalla aplica** (`allowed`): en `index.html?plan=` son `rom_target` y `reps`. En el turno,
    un parámetro sin valor actual en pantalla tampoco se ajusta: el agente no puede inventar el `old`.
  - **Valor actual (`current`).** `rom_target` y `reps` los manda el navegador (lo que se ve en pantalla) y el servidor
    los acota: `rom_target` 10–140, `reps` entero de 1 a `max_reps`. `rest_seconds` lo pone el servidor con `rest.min`
    del plan (ADR-022) y nunca el navegador; no se aplica en ninguna pantalla (TD-104). Lo único que se aplica es `new`,
    validado contra el sobre guardado en el servidor.
  - **Guiados y seguimiento** (sin sobre): no se consulta al agente clínico (I-3). Deciden las reglas (pausa y descanso
    recomendado). El agente conversacional puede redactar la frase.
  - **Tiempo acotado** (valores del 2026-10-18, de partida hasta medir). Agente clínico hasta 12 s (`TURN_CLINICAL_S`),
    en un grupo de 4 hilos y sin reintentos ante 429. Agente conversacional hasta 5 s (`TURN_COACH_S`) y solo si el
    clínico tardó 6 s o menos (`TURN_COACH_IF_UNDER_S`): nunca le quita tiempo al clínico. 18 s en total en el servidor
    (`TURN_BUDGET_S`). El navegador espera el presupuesto más 7 s (25 s), que le dice `/api/me`. Se ajustan sin tocar
    código con `AXONFAS_TURN_CLINICAL_S`, `AXONFAS_TURN_COACH_S` y `AXONFAS_TURN_BUDGET_S`, y se fijan con datos con
    `py -m agents.turn --measure N` en la terminal del owner. Una tarea vencida se cancela. Sin respuesta a tiempo, o
    con error, deciden las reglas y el paciente no ve un error.
  - **Menos latencia sin tocar la seguridad.** Si el proveedor rechaza `response_format`, se recuerda y no se vuelve a
    mandar (una petición por llamada, no dos). El contexto va en JSON compacto y el motivo en 12 palabras como mucho. El
    estado de la IA se precalienta al arrancar `serve.py` y, ya caliente (menos de 10 min), el turno no lo espera: se
    refresca en segundo plano.
  - **Cupo de Token Factory.** Como mucho una llamada clínica y una conversacional por turno, nunca por frame. Por
    paciente: 3 s entre turnos con IA y 20 por hora. En todo el servidor: 4 turnos con IA a la vez. Pasado el límite,
    responden las reglas (`ai.skipped = rate_limited` o `busy`). Son valores de partida, en memoria (TD-108).
  - **Privacidad.** Al LLM van el ejercicio, el sobre, los valores actuales, hasta 5 repeticiones y el texto
    (≤ 200 caracteres), ya filtrado de datos personales (ADR-026). Nunca el alias, el año de nacimiento ni el nombre del
    fisioterapeuta. Solo Staging (ADR-010).
  - **Registro.** Un `voice_turn` por turno; un `agent_decision` solo si hubo propuesta (del agente o de las reglas); la
    molestia en `symptom_report` con `source = 'voice_turn'`. Se unen a la sesión al guardarla, por id (`voice_turn_ids`).
    No se guarda el texto crudo del LLM. El fisioterapeuta recibe `agent_turn` en vivo y ve “Decisiones del agente”.
  - **Atribución verdadera (TD-34).** La respuesta trae `ai` (proveedor, modelo, latencias, quién decidió y quién
    redactó). La pantalla del paciente dice qué modelo de AMD propuso y en cuánto tiempo, o “Te respondieron las reglas
    de seguridad de AXONFAS.” (texto neutro y verdadero; el motivo exacto queda en el panel del fisioterapeuta). Mientras
    espera, “El asistente de AMD está revisando lo que dijiste…” solo si `/api/me` dice que la IA está disponible; si no,
    “Revisando lo que dijiste con las reglas de seguridad…”. El proveedor y el modelo salen de los datos, nunca de un
    texto fijo.
  - **SOAP.** La nota lee las decisiones aplicadas, con quién las propuso (“agente clínico” o “motor de reglas”), y las
    frases del paciente que no estén ya como molestia. El motivo del LLM no entra en la nota (I-6).
- **Consecuencias:**
  - Los jueces ven la IA de AMD en el producto: modelo y latencia en la pantalla del paciente y en el panel.
  - La vía de reglas sigue igual: sin IA, el turno da la misma acción, el mismo ajuste y la misma frase que
    `/api/me/discomfort`.
  - Es más restrictiva que ADR-005 y ADR-021, y no los reemplaza. Invariante I-18 en [01](01-logic.md).
  - Pendientes: descanso aplicable (TD-104), voz (TD-105), escala de dolor (TD-106), reenvío sin duplicar (TD-107),
    límites persistentes (TD-108), texto libre hacia un servicio externo (TD-109) y decisiones en FHIR (TD-110).

## ADR-026 · Filtro determinista de datos personales antes de cualquier LLM — Aceptada

- **Fecha:** 2026-10-18
- **Contexto:**
  - El texto libre del paciente viaja a AMD Token Factory, un servicio fuera de la máquina (TD-109): en el turno (al
    agente clínico y al conversacional), en el resumen para el fisioterapeuta (la nota del perfil y las sugerencias) y
    en la A y la P del borrador SOAP (molestias y frases).
  - Hasta ahora solo se limitaba a 200 caracteres y no iban el alias ni el año de nacimiento. Un paciente puede escribir
    su correo, su teléfono, su DNI, su dirección o su nombre.
  - El usuario aceptó el envío para el demo pidiendo reforzar las reglas.
- **Decisión:**
  - `src/agents/privacy.py` (`redact`, solo biblioteca estándar y sin LLM) cambia por marcadores: correos (`[correo]`),
    enlaces (`[enlace]`), teléfonos (`[teléfono]`), documentos y números de 6 o más dígitos (`[documento]`), direcciones
    con número (`[dirección]`) y nombres tras “me llamo”, “mi nombre es”, “mi apellido es” o “Soy <Nombre con
    mayúscula>” (`[nombre]`).
  - No toca información clínica: cifras de 1 a 5 dígitos sueltas (“90 grados”, “llevo 20000 pasos”), fechas
    (“18-10-2026”), series de números chicos (“90 100 110 120”), cantidades con unidad tras una calle (“en la calle me
    caí 2 veces”) ni frases hechas (“me llamo la atención”). El nombre termina en una palabra de enlace o de molestia
    (“me llamo Ana Torres duele” → “me llamo [nombre] duele”).
  - **Orden:** las reglas de seguridad (alarma y clasificación) leen el texto **original**; después corre el filtro, y
    todo lo que va a un LLM es el texto **filtrado**.
  - **Se guarda lo filtrado**, lo mismo que se envía: en `symptom_report.text` y `voice_turn.transcript` (con
    `voice_turn.redactions`, cuántos datos se ocultaron). Así hay menos datos personales guardados (ADR-010, TD-91) y el
    fisioterapeuta audita exactamente lo que vio la IA. Las filas anteriores se filtran al armar el mensaje de la nota
    SOAP.
  - Aplica al turno, al formulario “Tengo una molestia” (`/api/me/discomfort`), al resumen del fisioterapeuta y a la nota
    SOAP. La prueba del Administrador (`/api/admin/ai/test`) no lleva datos de pacientes y no se filtra.
  - **Aviso visible** bajo el campo, cuando el asistente está disponible: “Lo revisan las reglas de seguridad de AXONFAS
    y el asistente de AMD. Se envía sin tu nombre; ocultamos correos, teléfonos y documentos.” Tras el turno, si se ocultó
    algo: “Ocultamos N datos personales antes de enviarlo.”
- **Consecuencias:**
  - Un falso positivo solo oculta texto; nunca decide nada ni oculta una alarma (se lee del original).
  - El dato personal original no se guarda.
  - No detecta nombres sin disparador, datos escritos con letras ni un teléfono escrito en grupos de dos cifras; eso
    queda para Producción (TD-117).
  - Invariante I-19 en [01](01-logic.md).

---

## Anexo · Modelo de negocio acordado (hipótesis a validar, no es un ADR)

- **EE. UU.**: las clínicas pueden cobrar a Medicare por monitoreo terapéutico remoto (RTM). Desde 2026 existen códigos para 2–15 días de datos (98985) y para 10–19 min de gestión (98979). AXONFAS genera exactamente esos datos. Riesgo: RTM exige un dispositivo médico reconocido por la FDA, así que es un segundo paso, no el primero. (Códigos verificados el 2026-10-06 en el Physician Fee Schedule 2026 de CMS: 98985 es el suministro del dispositivo musculoesquelético de 2 a 15 días en 30, y 98979 los primeros 10 minutos de gestión al mes. No se pueden facturar en el mismo mes junto con los códigos de 16–30 días y de 20 minutos.)
- **Perú / LatAm**: suscripción por clínica o por paciente activo. El valor es que un terapeuta supervisa más pacientes en casa y documenta menos.
- **Precio**: no definido. Se valida con entrevistas a 3–5 fisioterapeutas antes de fijarlo.
