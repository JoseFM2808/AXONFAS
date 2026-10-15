# Sistema de Diseño · AXONFAS

> Estado: **Aceptado y Aplicado · HUD Biónico (Sci-Fi / F1 Telemetry)**  
> Proyecto: **AXONFAS** · AMD Developer Hackathon: ACT III (Health & Wellbeing)

El diseño oficial de AXONFAS ha sido seleccionado: **HUD Biónico (Sci-Fi / F1 Telemetry)**. Este sistema combina estética de telemetría de alto rendimiento con los requerimientos clínicos estrictos de supervisión en tiempo real.

---

## 1. Fundamentos del HUD Biónico

1. **Visibilidad a distancia (2 a 3 metros):**
   - Conteo de repeticiones de alta visibilidad (`4.5rem` - `5.2rem`) con resplandor neón (`#00F2FE`).
   - Barra segmentada con estados luminosos: azul translúcido (calibración), cian neón (completadas) y carmesí neón (compensaciones flaggeadas).
2. **Tacómetros Radiales Circulares (SVG Gauges en Tiempo Real):**
   - En lugar de simples cajas de texto, los ángulos biomecánicos se representan mediante tacómetros radiales SVG:
     - **Flexión de Rodilla (ROM):** Arco radial de 0° a 110° con meta clínica automática.
     - **Flexión de Tronco:** Arco radial que pasa dinámicamente a carmesí (`#FF0055`) con efecto glow si excede el umbral del fisioterapeuta.
     - **Valgo Bilateral:** Medidores de desviación de rodilla izquierda y derecha.
     - **Confianza de la Pose:** Medidor porcentual de visibilidad de articulaciones.
3. **Bucle Rápido Determinista (&lt;250 ms, ADR-004):**
   - El banner de alerta inmediata se proyecta en el tercio superior del viewport en carmesí neón con frase corta y metadatos del evento.
4. **Dock de Control de Piloto Flotante:**
   - Botonera integrada para activar cámara, ejecutar el demo sintético, pantalla completa y la parada de emergencia por dolor (Invariante I-7).

---

## 2. Tokens de Diseño Principales

Los tokens residen en [`tokens.css`](file:///j:/Mi%20unidad/03%20Proyectos%20IA/AXONFAS/docs/design-system/tokens.css):

| Token | Valor | Uso |
| :--- | :--- | :--- |
| `--bg` | `#030712` | Fondo galáctico profundo |
| `--tape` | `#00F2FE` | Cian neón principal para telemetría activa |
| `--safe` | `#00FF88` | Verde matrix para técnica correcta |
| `--alert` | `#FF0055` | Carmesí láser para compensaciones y parada por dolor |
| `--hold` | `#FFB800` | Ámbar para avisos leves y calibración |
| `--font-display` | `Space Grotesk` | Títulos y métricas principales |
| `--font-body` | `Outfit` | Textos explicativos |
| `--font-mono` | `JetBrains Mono` | Ángulos tabulares (°), latencias (ms) |
| `--muscle-*` | ver §4 | Estilo de un músculo, el mismo en el mapa muscular y en las figuras |
| `--fig-*` | ver §4 | Figuras de referencia de los ejercicios |

---

## 3. Implementación en Código

El sistema está integrado en todas las páginas del prototipo (`src/frontend/validation-prototype/`): `index.html`,
`galeria.html`, `seguimiento.html`, `doctor.html` y `paciente.html`. Cada una enlaza este `tokens.css` y los
componentes compartidos de `hud.css` (cabecera, botones, tarjetas, tablas, mapa corporal, escenario de cámara y figura
de referencia); en su propio HTML solo queda lo que es único de esa pantalla.

**Fuente única (TD-35):** `index.html` no copia los tokens; enlaza este `tokens.css`
(`../../../docs/design-system/tokens.css`). Cualquier cambio de color, tipografía o geometría se hace aquí y llega solo
al prototipo. `preview.html` es una copia vieja de `index.html`, pendiente de borrar (TD-37).

**Celular y tablet (TD-36):** por debajo de 900 px los tacómetros salen del video a una grilla; por debajo de 640 px la
botonera usa botones de 44 px (cámara y "Dolor: detener" a todo el ancho) y el video toma la forma de la cámara.

### Verificación Local:
El servidor local se arranca con `lanzar-prototipo.cmd` (o `py src/frontend/validation-prototype/serve.py`) y corre en
`http://localhost:8091/`; otros equipos de la red entran con el QR de la página. Al pulsar **"Ver el demo sintético"**:
- El esqueleto cinemático se renderiza en tiempo real en el canvas.
- Los tacómetros radiales SVG giran y se actualizan fluidamente a 60 FPS.
- La tabla de repeticiones registra cada ciclo (calibración y ejercicio).
- La tabla de eventos documenta las compensaciones con su latencia en ms.
- Se genera el resumen para la nota SOAP.

---

## 4. Componente: figura de referencia de un ejercicio (`.fig`)

Es la única forma de mostrar cómo se hace un ejercicio. La dibuja `guide-figure.js` con `AxonGuide.render(contenedor,
idEjercicio, { hold, variant })`, con los mismos colores, trazos y encuadre en todas las páginas. La figura es una
**marioneta muscular en 3D** con el estilo del mapa muscular. Tiene un esqueleto con ángulos anatómicos (cadera, rodilla,
tobillo, hombro, codo, tronco y cuello) y una cámara en tres cuartos por ejercicio. Cada segmento (muslo, pierna, pie,
tronco, brazo, antebrazo, cuello y cabeza) está hecho de polígonos de músculos con los nombres del mapa, y muestra su
perfil, su frente o su espalda según cómo lo ve la cámara. El dibujo es propio: nunca se copian imágenes de las fuentes
(AAOS, NHS, CDC).

**Anatomía**

| Parte | Qué es | Estilo |
| :--- | :--- | :--- |
| Marco (`.fig-stage`) | Lienzo 3:2 con malla táctica y dos esquinas del HUD | `--fig-bg`, `--fig-grid`, borde `--surface-border`, esquinas `--tape` |
| Etiqueta de fase (`.fig-chip`) | `1 · Inicio`, `2 · Movimiento`, `3 · Sostén 5 s` (o `3 · Posición final`), `4 · Vuelta` | `--font-mono` en mayúsculas; el color sigue la fase |
| Vista (`.fig-view`) | De lado, de frente, de espalda, acostado | `--muted`, se oculta en celular |
| Texto (`.fig-cap`) | Qué hacer en esa fase, con el sostén de la dosis del plan | `--font-body` |
| Cuerpo | Silueta sólida de cada segmento con sus músculos encima; cabeza con los ojos hacia donde mira; el lado lejano más tenue | `--muscle`, `--muscle-fill`, `--muscle-edge`, `--muscle-neutral-fill` (los mismos del mapa) |
| Músculos que trabajan | Los del catálogo para ese ejercicio (los mismos que pinta el mapa), en los brazos o piernas que se mueven. Se encienden poco al inicio, suben con el movimiento, quedan al máximo en el sostén y bajan al volver | `--fig-active` con opacidad `--muscle-active-min` + `--muscle-active-range` × esfuerzo y brillo `--fig-glow` |
| Pose objetivo | Halo suave de la parte del cuerpo que se mueve, en la posición a la que hay que llegar | `--fig-ghost` |
| Flecha | Recorrido del punto que más se mueve, con trazo animado | `--fig-active` |
| Anillo del sostén | Se llena alrededor de ese punto mientras se sostiene | `--fig-hold` |
| Profundidad | Lo que está más lejos va detrás y más tenue; lo que apunta a la cámara se acorta | Orden por profundidad, sin colores nuevos |
| Suelo y accesorios | Suelo en perspectiva con sombra; silla, mesa y colchoneta en 3D; banda elástica punteada | `--fig-floor`, `--fig-prop`, `--fig-band` |

**Color por fase.** Los músculos que trabajan van en `--fig-active` al inicio, en el movimiento y en la vuelta; en
`--fig-hold` durante el sostén (el mismo ámbar de la cuenta sobre el video); y en `--fig-done` en la posición final de
un ejercicio sin sostén. La etiqueta de fase sigue los mismos colores (la vuelta, en `--tape-hover`). El resto del cuerpo
nunca usa un color semántico, para que solo destaque lo que trabaja.

**Encuadre.** Todas las figuras de cuerpo entero usan la misma escala (una persona de pie mide lo mismo en todos los
ejercicios, y una acostada también), y las de medio cuerpo comparten otra. Siempre queda libre la franja superior para
las etiquetas.

**Variantes.** `card` en las tarjetas de la galería, el plan del paciente y el panel del fisioterapeuta. `large` en
las guías: "Cómo se hace", la guía del Prototipo y la vista guiada. `pip`, compacta, va sobre el video del seguimiento y
en el aviso de enseñanza.

**Movimiento** (TD-59, como los videos de una red social). Quieta, la figura muestra inicio y final lado a lado (o uno
debajo del otro si la persona está acostada), con la pose objetivo y la flecha en el inicio.
- **Tarjetas** (`card`, `data-play="hover"`): quietas. Se anima solo la que tiene el mouse encima, o la que se toca (en
  el dibujo o en el botón), y **una sola a la vez**: al animar otra, la anterior se detiene. La que se anima lleva el
  borde y el brillo de `--tape`.
- **Dentro del ejercicio** (`large` y `pip`, `data-play="auto"`; o `play: 'auto'` en una tarjeta sola, como la vista
  previa del fisioterapeuta): siempre animada, también con `prefers-reduced-motion`, porque muestra cómo se hace. Se
  pausa sola fuera de la vista.
- **Botón** `.fig-play` bajo el dibujo, junto al texto ("▶ Animar" / "❚❚ Pausa", tipografía mono, `--tape` cuando
  anima): anima o pausa esa figura. La variante `pip` no lo lleva.

**Reglas.**
- No dibujes figuras de ejercicios fuera de este componente.
- No pongas colores en el código: cambia los tokens `--muscle-*` y `--fig-*` en `tokens.css`. El mapa muscular
  (`.bodymap-muscle` en `hud.css`) usa los mismos `--muscle-*`, así que mapa y figura no se pueden desalinear.
- Los músculos de la figura (`SHAPES` en `guide-figure.js`) usan los nombres del mapa (`body-map-data.js`).
- Todo ejercicio nuevo del catálogo necesita su figura y su `FOCUS`, y al menos uno de sus músculos tiene que verse en
  la vista de su figura. Los tests lo exigen.

---

## 5. Componente: preparar la cámara (`.cam-setup` y `.cam-check`)

Antes de cada sesión con cámara (`camera-setup.js`, ADR-015).

- **Tarjetas de posición (`.cam-option`):** una por vista (en diagonal, de frente, de lado). Cada una lleva un diagrama
  visto desde arriba (persona en `--muscle`, cámara y línea de visión en `--tape`), la indicación y la calidad de cada
  medida (`.cam-q`): buena en `--safe`, regular en `--hold` y poco confiable en `--alert`. La recomendada lleva la
  etiqueta "Recomendada" en `--safe`; la elegida, el borde y el brillo de `--tape`.
- **Chequeo en vivo (`.cam-check`):** sobre el video, abajo a la izquierda (a todo el ancho en celular). Muestra una lista
  con ✓ (`--safe`), ✗ (`--alert`) o ! (`--hold`) para cuerpo a la vista, distancia y ángulo, la calidad con la vista
  real, una barra que se llena mientras la posición se mantiene y el botón "Empezar ya".

---

## 6. Componente: sugerencias (`.suggest`) y perfil del paciente (`.profile-form`)

`AxonSuggest.renderList` y `AxonSuggest.renderProfileForm` (`suggestions.js`, ADR-017).

- **Lista de sugerencias:** una sección con título (`h2.suggest-title`), una nota que dice de dónde salen
  ("calculadas con reglas…") y una grilla de tarjetas `.suggest-item`.
  - Cada tarjeta trae el tipo (mono, en mayúsculas), el título, el texto y "Por qué: …" en `--muted`.
  - El borde izquierdo es `--tape` (uso), `--hold` (dosis o precaución) o `--alert` (prioridad alta, también escrita en
    el tipo).
  - El botón va al fondo, así queda alineado en toda la fila. La lista se anuncia con `aria-live="polite"`.
- **Resumen con IA (`.ai-summary`):** borde punteado. Solo aparece si la GPU está conectada; si no, lo dice con texto.
- **Formulario del perfil:** dos `fieldset` con `legend` (limitaciones y zonas con dolor) de casillas de 32 px de alto,
  y una nota con su indicación enlazada (`aria-describedby`). El resultado se anuncia (`role="status"`).
- **Aviso de encaje en las tarjetas (`.fit-note`):** en `--hold`, siempre presente (vacío si encaja), para que todas las
  tarjetas tengan las mismas filas.

## 7. Accesibilidad (WCAG 2.2 AA)

- **Contraste:**
  - Texto en rojo sobre superficies oscuras: `--alert-ink` (5,3:1 o más), nunca `--alert`.
  - Botón de detener: `--alert-strong` con texto blanco (5,5:1).
  - Alerta de severidad 1: texto oscuro sobre `--hold`.
  - El resto de combinaciones del HUD supera 4,5:1.
- **Foco:** anillo blanco de 3 px con halo cian (`--focus`) en todo control. Nunca se quita el `outline` sin dar otro.
- **Estructura:**
  - "Saltar al contenido" como primer elemento; una sola región `<main>`.
  - Tablas con scroll lateral dentro de `.table-wrap` con `tabindex="0"`, `role="region"` y nombre.
  - Líneas de estado con `role="status"`.
- **Teclado:** todo lo que se toca se usa con Tab y Enter: el mapa muscular del fisioterapeuta, las figuras y los
  diálogos.
- **Tamaño:** botones de 40 px de alto o más (2.5.8); los textos largos se cortan dentro de su caja
  (`overflow-wrap`), nunca la desbordan.
- **Movimiento:** con `prefers-reduced-motion` se quitan pulsos y transiciones. Las figuras de los ejercicios siguen
  animadas dentro del ejercicio y tienen pausa.
- **Alto contraste de Windows:** bordes con `CanvasText`.
- **Simetría:** las tarjetas de una fila (`.card-grid > .ex-card`) y los indicadores (`.kpis > .kpi`) usan `subgrid`.
  Una tarjeta nueva debe mantener el mismo número de hijos.

