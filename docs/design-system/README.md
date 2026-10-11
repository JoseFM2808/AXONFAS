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
idEjercicio, { hold, variant })`, con los mismos colores, grosores y encuadre en todas las páginas. El dibujo es propio:
nunca se copian imágenes de las fuentes (AAOS, NHS, CDC).

**Anatomía**

| Parte | Qué es | Estilo |
| :--- | :--- | :--- |
| Marco (`.fig-stage`) | Lienzo 3:2 con malla táctica y dos esquinas del HUD | `--fig-bg`, `--fig-grid`, borde `--surface-border`, esquinas `--tape` |
| Etiqueta de fase (`.fig-chip`) | `1 · Inicio`, `2 · Movimiento`, `3 · Sostén 5 s` (o `3 · Posición final`), `4 · Vuelta` | `--font-mono` en mayúsculas; el color sigue la fase |
| Vista (`.fig-view`) | De lado, de frente, de espalda, acostado | `--muted`, se oculta en celular |
| Texto (`.fig-cap`) | Qué hacer en esa fase, con el sostén de la dosis del plan | `--font-body` |
| Cuerpo | Segmentos con volumen (trazo y brillo interior), cabeza con el ojo hacia donde mira | Reposo `--fig-body`; lado lejano `--fig-body-far` |
| Lo que se mueve | Los segmentos que trabaja el ejercicio (se declaran por ejercicio en `FOCUS`) | `--fig-active` con brillo `--fig-glow` |
| Pose objetivo | Silueta punteada de la posición a la que hay que llegar | `--fig-ghost` |
| Flecha | Recorrido del punto que más se mueve, con trazo animado | `--fig-active` |
| Anillo del sostén | Se llena alrededor de ese punto mientras se sostiene | `--fig-hold` |
| Suelo y accesorios | Línea del suelo con sombra; silla, mesa, colchoneta; banda elástica punteada | `--fig-floor`, `--fig-prop`, `--fig-band` |

**Color por fase.** Inicio y movimiento: `--fig-active`. Sostén: `--fig-hold`, el mismo ámbar de la cuenta del sostén
sobre el video. Posición final sin sostén: `--fig-done`. Vuelta: `--tape-hover`. El cuerpo en reposo nunca usa un color
semántico, para que lo único que destaque sea lo que hay que mover.

**Encuadre.** Todas las figuras de cuerpo entero usan la misma escala (una persona de pie mide lo mismo en todos los
ejercicios, y una acostada también), y las de medio cuerpo comparten otra. Siempre queda libre la franja superior para
las etiquetas.

**Variantes.** `card` en las tarjetas de la galería, el plan del paciente y el panel del fisioterapeuta. `large` en
las guías: "Cómo se hace", la guía del Prototipo y la vista guiada. `pip`, compacta, va sobre el video del seguimiento y
en el aviso de enseñanza.

**Movimiento.** Se anima solo mientras está a la vista. Con `prefers-reduced-motion` muestra inicio y final lado a lado
(o uno debajo del otro si la persona está acostada), con la pose objetivo y la flecha en el inicio.

**Reglas.**
- No dibujes figuras de ejercicios fuera de este componente.
- No pongas colores en el código: cambia los tokens `--fig-*` en `tokens.css`.
- Todo ejercicio nuevo del catálogo necesita su figura y su `FOCUS`; los tests lo exigen.

