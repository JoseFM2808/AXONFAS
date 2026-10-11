# Prototipo de validación (TD-28)

Página que corre solo en el navegador, sin GPU ni servidor, para revisar con fisioterapeutas el ejercicio, las dos
compensaciones y el sobre de seguridad antes de construir AXONFAS completo (TD-06). Implementa la regla de compensación
de `.ai-context/01-logic.md` con MediaPipe Pose. No es el producto del hackathon ni un dispositivo médico.

**Privacidad:** el video no sale del equipo y no se guarda nada (ni video, ni imágenes, ni datos en el navegador). Lo único
que se descarga de internet es MediaPipe y su modelo de pose (unos 25 MB la primera vez). "Copiar resumen" copia solo
ángulos y alertas, sin nombres.

## Cómo abrirlo

1. **Doble clic en `index.html`** con Chrome o Edge. Hace falta internet la primera vez.
2. **En la red local, con QR para otros equipos (TD-33).** Doble clic en **`lanzar-prototipo.cmd`** (esta carpeta), o
   desde la carpeta del proyecto:

   ```bash
   py src/frontend/validation-prototype/serve.py
   ```

   - Este equipo entra a http://localhost:8091.
   - En la página aparece **"Probar en otro equipo"**: un QR hacia `https://<IP>:8443` para celulares, tablets o
     laptops conectados a la misma red. Hace falta HTTPS porque los navegadores solo dan la cámara en `localhost` o
     HTTPS. El certificado es autofirmado: la primera vez hay que aceptar el aviso de seguridad.
   - La primera vez, Windows puede preguntar si Python puede usar la red: permitirlo solo en **redes privadas**.
   - El certificado se guarda en `~/.axonfas/certs` (fuera del repo y de Drive) y se rehace si cambia la IP.
   - `--local-only` lo deja solo para este equipo. Usarlo solo en redes de confianza, no en wifi pública. El puerto 8765
     es de Mi Puestito; no usarlo.
3. **"Ver el demo sintético"** muestra el flujo completo sin cámara: 3 repeticiones de calibración, una compensación de
   tronco (repetición 5), un valgo de la rodilla izquierda (7) y una repetición en la que la cámara pierde las rodillas
   (8). Sirve para explicar el sistema antes de que el fisioterapeuta lo pruebe.

## Cómo preparar la prueba con cámara

La página abre con la **guía del ejercicio**: una animación de referencia vista de lado (con movimiento reducido
activado en el sistema, muestra la posición inicial y la final lado a lado), los pasos y dónde va la cámara.

- Cámara a la altura de la cadera, a 2–3 m, de frente o un poco en diagonal. Se tienen que ver el cuerpo entero y los pies.
- Silla sin brazos, brazos cruzados sobre el pecho, buena luz y fondo despejado.
- **Pantalla completa** ayuda a leer desde la silla. Con la voz activada, el sistema anuncia el inicio, cada repetición
  ("Calibración: 2 de 3", "5 de 10"), el fin de la calibración, la última repetición y el final. Si una repetición de
  calibración no se vio bien, lo dice y hay que repetirla.
- Las 3 primeras repeticiones calibran la línea base de esa persona: hacerlas con la técnica normal.
- Las alertas empiezan en la cuarta repetición. "Dolor: detener" corta la sesión en cualquier momento.

## Qué mide

| Medida | Cómo se calcula | Límite conocido |
|---|---|---|
| Flexión de rodilla | 180° menos el ángulo cadera-rodilla-tobillo, en 3D (puntos "world" de MediaPipe) | La profundidad de MediaPipe es aproximada |
| Flexión de tronco | Ángulo entre el tronco (centro de caderas a centro de hombros) y la vertical | Supone la cámara nivelada |
| Valgo de rodilla | Proxy: desplazamiento de la rodilla hacia la línea media respecto de la línea cadera-tobillo, en grados contra la longitud de la pierna | Necesita ver a la persona de frente o casi; no es el ángulo de proyección frontal clásico |
| Confianza | La menor visibilidad entre hombros, caderas, rodillas y tobillos | Por debajo del mínimo, el frame no se evalúa |
| Latencia | Desde que entra el frame hasta que la alerta se pinta en el navegador | No incluye la red ni la GPU de la arquitectura final |

Una repetición va de levantarse (la rodilla baja de 65°) a volver a sentarse habiendo llegado a estar de pie (la rodilla
llegó a 25° o menos). Los márgenes de partida (+15° de tronco y +10° de valgo sobre la línea base) y la escala de severidad
(1 si supera el umbral por menos de 5°, 2 si por menos de 10°, 3 si por más) **no son clínicos**: son lo que hay que
validar.

## Guía para la sesión con fisioterapeutas (TD-06)

Antes: mostrar el demo sintético. Después: que la persona del equipo haga el ejercicio con la cámara y que el
fisioterapeuta mueva los deslizadores mientras mira. En algunas repeticiones hay que compensar a propósito (inclinar más
el tronco, juntar las rodillas): con técnica normal no salta ninguna alerta, y eso es lo correcto. Las notas van a `docs/meetings/` (no se versiona); nunca datos de
pacientes.

1. **Ejercicio:** ¿sentarse-pararse sirve para el demo? ¿Qué variante usarían (altura de silla, brazos, ritmo)?
2. **Compensaciones:** ¿flexión de tronco y valgo de rodilla son las dos más importantes? ¿Cuál falta (talón, rotación
   de pelvis, asimetría)?
3. **Umbrales:** con la persona haciendo el ejercicio, ¿con qué margen la alerta coincide con lo que ellos corregirían?
   Anotar los valores de los deslizadores.
4. **Línea base:** ¿3 repeticiones de calibración bastan? ¿Se recalibra en cada sesión?
5. **Rango pedido:** ¿cómo definen la flexión de rodilla que se exige en cada repetición?
6. **Severidad:** ¿les sirve una escala de 1 a 3? ¿Qué distingue un caso grave?
7. **Mensajes:** ¿las frases cortas ("Tronco más erguido", "Rodilla izquierda hacia afuera") se entienden? ¿Cómo lo
   dirían ellos a un paciente?
8. **Sobre de seguridad:** ¿qué límites fijarían por paciente (rango mínimo y máximo, repeticiones, flexión máxima de
   tronco, dolor que detiene)?
9. **Incertidumbre:** cuando la cámara no ve bien, ¿qué debería hacer el sistema?
10. **Uso real:** ¿lo usarían con pacientes en casa? ¿Con qué tipo de paciente empezarían?

## Páginas (con `serve.py`)

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Validación con fisioterapeutas | Cámara, motor de reglas, guía, avisos y resultados. Con `?plan=sit-to-stand` y una cuenta de paciente entra en **modo paciente**: aplica el sobre del fisioterapeuta, transmite en vivo y guarda la sesión |
| `galeria.html` | Todos | 24 ejercicios documentados por temática, con mapa muscular, huesos, dosis, precauciones y fuente (funciona también con doble clic). Cada tarjeta tiene "Seguir con la cámara" |
| `seguimiento.html` | Todos | Cámara para cualquier ejercicio de la galería (ADR-014): figura de referencia junto al video, esqueleto, el ángulo o la distancia que importa junto a la articulación, contador de repeticiones o de tiempo sostenido legible a 2–3 m, voz y mapa muscular que se enciende con el avance. Si la dosis pide sostener, una cuenta grande baja hasta 0 y la repetición solo vale si no bajaste antes. **No avisa de compensaciones** (eso es solo sentarse y pararse en `index.html`). Con `?plan=1` y una cuenta de paciente sigue la dosis del plan, el fisioterapeuta lo ve en vivo y la sesión se guarda |
| `doctor.html` | Fisioterapeuta | Cuenta de demostración, afiliar pacientes con código o QR, plan desde el catálogo, indicadores de cumplimiento y efectividad, sesión en vivo (mapa muscular estimado, esqueleto con huesos, alertas) y enseñar músculos al paciente |
| `paciente.html` | Paciente | Afiliarse con el código o el QR y aceptar el consentimiento, ver el plan con lo que trabaja cada ejercicio, hacerlo con la cámara (alertas en sentarse y pararse, conteo en los demás) o sin cámara (guiado) y recibir lo que señala su fisioterapeuta |

Demo en un solo equipo: abre `doctor.html` en una pestaña y `paciente.html?code=<código>` en otra; en el modo paciente,
"Ver el demo sintético" transmite una sesión completa sin pararse de la silla. Las cuentas son de prueba: sin
contraseñas y con seudónimos; la base vive en `~/.axonfas/staging.sqlite3`, fuera del repo.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Interfaz y estilos de los componentes. Los tokens (colores, tipografía, geometría) vienen de `docs/design-system/tokens.css`: cámbialos ahí, no aquí. Se adapta a celular: tacómetros debajo del video y botones grandes |
| `preview.html` | Copia vieja de `index.html`, pendiente de borrar con aprobación (TD-37) |
| `lanzar-prototipo.cmd` | Script de lanzamiento: doble clic y arranca `serve.py` desde la carpeta del proyecto |
| `app.js` | Cámara, MediaPipe, dibujo, alertas, voz y tablas |
| `share.js` | Botón "Probar en otro equipo" y QR (usa `/lan.json` de `serve.py`) |
| `serve.py` | Servidor de red local: HTTP 8091 + HTTPS 8443 con certificado autofirmado, y la API de Staging (`src/backend/staging_api.py`) |
| `catalog.js` | Catálogo de 24 ejercicios con fuente, dosis, músculos, huesos y precauciones (ADR-011) |
| `guide-figure.js` | Componente "Figura de referencia" del design system (§4): figura animada de cada ejercicio, dibujo propio, con lo que se mueve resaltado, la pose objetivo, la flecha del recorrido y el sostén. Todas las páginas lo usan con `AxonGuide.render` |
| `tracker.js` | Seguimiento de cada ejercicio (ADR-014): qué medir con la pose, en qué modo contar (repeticiones, sostén o manual) y con qué valores de partida, no clínicos (TD-48). Funciones puras |
| `seguimiento.html`, `seguimiento.js` | Página de seguimiento con la cámara y su modo paciente |
| `body-map.js`, `body-map-data.js` | Mapa muscular 2D y estimación educativa de carga; polígonos de react-body-highlighter (MIT, atribución en el archivo) |
| `hud.css` | Componentes compartidos del design system (cabecera, botones, tarjetas, tablas, mapa, indicadores y el escenario de cámara de `index.html` y `seguimiento.html`) |
| `galeria.html`, `gallery.js` | Galería de ejercicios |
| `doctor.html`, `doctor.js` | Panel del fisioterapeuta |
| `paciente.html`, `patient.js` | Página del paciente y ejercicios guiados |
| `api-client.js`, `patient-link.js`, `teach-toast.js` | Cliente de la API, modo paciente del prototipo y avisos de enseñanza |
| `engine.js` | Motor de reglas: ángulos, repeticiones, línea base, umbrales y eventos. Funciones puras |
| `synthetic.js` | Sesiones sintéticas con la forma de la salida de MediaPipe (demo y tests) |

Tests del motor, del catálogo y del seguimiento, desde la carpeta del proyecto:

```bash
node --test "tests/validation-prototype/*.test.cjs"
```
