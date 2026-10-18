# WorkFlow de revisión UI/UX · AXONFAS

Procedimiento de auditoría que se siguió el 2026-10-18 (ADR-033, TD-119) y que se repite antes de cada entrega o cambio
grande de interfaz. Principios: Modern Web Guidance (diseño responsivo, jerarquía visual y accesibilidad WCAG 2.2 AA).

| # | Paso | Qué se revisa | Cómo se verifica |
|---|---|---|---|
| 1 | Inventario | Las 8 páginas (index, galería, seguimiento, fisioterapeuta, paciente, login, admin, empresa) y los componentes compartidos de `hud.css` | Lista de páginas y componentes |
| 2 | Navegación | Cabecera y menú: tamaño estable con hover, foco y página actual (borde, padding y peso de letra iguales en todos los estados), sin cortes de línea ni scroll horizontal, y la misma posición en todas las páginas | Medir el alto de la cabecera y los bordes del menú en cada página, a 375, 768 y 1280 px |
| 3 | Tarjetas y overflow | Grilla de tarjetas de ejercicio (galería y plan): anchos mínimos, figura, mapa y botones dentro de la tarjeta; una tarjeta entra entera en un celular | Que `scrollWidth` no supere `clientWidth` en ninguna página; alto de cada tarjeta menor que la pantalla menos la cabecera, a 320, 375, 768 y 1280 px |
| 4 | Cámara | Contenedor de video y canvas: relación de aspecto real, `object-fit` sin recortar a la persona, canvas del mismo tamaño que el video, espejo y cámara vertical en celular | Cámara simulada 16:9, 4:3 y 9:16; esqueleto encima del cuerpo; consola sin errores con y sin persona a la vista |
| 5 | Contexto Demo vs. Plataforma | Aviso y color que dicen en qué entorno estás: invitado o sin cuenta (demo) frente a cuenta clínica | Revisión visual en cada página según el rol |
| 6 | Home y flujo | Claridad del inicio: qué hacer primero según quién eres | Recorrido de una persona nueva |
| 7 | Accesibilidad | WCAG 2.2 AA: foco visible, objetivos táctiles de al menos 24 px, contraste y nombres accesibles | axe-core en cada página, en los dos idiomas, en escritorio y celular |
| 8 | Regresión | Tests de las tres suites, sync de contexto y prueba visual | Todo en verde, commit y push |
| 9 | Fase 2 (consulta) | Lo que necesita una decisión de producto o diseño | Lista para el owner en `05-tech-debt.md` |

## Resultado de la ronda del 2026-10-18

| Paso | Hallazgo | Arreglo |
|---|---|---|
| 2 | El menú cambiaba de lugar entre páginas (borde izquierdo de 522 a 676 px); en celular la cabecera medía 160–229 px | Cabecera en grilla, `scrollbar-gutter: stable`; 72 px en escritorio y 100 px en celular, igual en las 8 páginas |
| 3 | En celular las tarjetas medían 920–1.100 px | Figura y mapa lado a lado y botones en una fila: 568–664 px |
| 4 | Cuadro 16:9 fijo; canvas de 1280×720 si el video no informaba su tamaño; `camera-setup.js` fallaba en cada frame sin nadie a la vista | Canvas y cuadro con el tamaño real, ajuste al girar el celular; parámetro `now` en lugar de `t` |
| 5 | Nada distinguía la demo de la plataforma clínica | `env-banner.js`: Demo pública (ámbar) y Plataforma clínica (verde) |
| 6 | El inicio es el Prototipo de la cámara, sin orientación | Queda para decisión del owner: TD-120 |
| 7 | — | axe-core sin violaciones en escritorio, celular, es y en |
| 9 | Home, nombres del menú, densidad de tarjetas en escritorio, colores del entorno | TD-120, TD-121, TD-122, TD-123 |
