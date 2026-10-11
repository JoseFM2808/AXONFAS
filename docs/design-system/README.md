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

---

## 3. Implementación en Código

El sistema está completamente integrado y funcional en:
- [`src/frontend/validation-prototype/index.html`](file:///j:/Mi%20unidad/03%20Proyectos%20IA/AXONFAS/src/frontend/validation-prototype/index.html) (Entrada oficial del prototipo)

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
