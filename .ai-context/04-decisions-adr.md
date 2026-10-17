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

---

## Anexo · Modelo de negocio acordado (hipótesis a validar, no es un ADR)

- **EE. UU.**: las clínicas pueden cobrar a Medicare por monitoreo terapéutico remoto (RTM). Desde 2026 existen códigos para 2–15 días de datos (98985) y para 10–19 min de gestión (98979). AXONFAS genera exactamente esos datos. Riesgo: RTM exige un dispositivo médico reconocido por la FDA, así que es un segundo paso, no el primero. (Códigos verificados el 2026-10-06 en el Physician Fee Schedule 2026 de CMS: 98985 es el suministro del dispositivo musculoesquelético de 2 a 15 días en 30, y 98979 los primeros 10 minutos de gestión al mes. No se pueden facturar en el mismo mes junto con los códigos de 16–30 días y de 20 minutos.)
- **Perú / LatAm**: suscripción por clínica o por paciente activo. El valor es que un terapeuta supervisa más pacientes en casa y documenta menos.
- **Precio**: no definido. Se valida con entrevistas a 3–5 fisioterapeutas antes de fijarlo.
