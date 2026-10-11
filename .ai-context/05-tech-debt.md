# 05 · Deuda técnica y pendientes

> Proyecto: **AXONFAS** · Actualizado: 2026-10-11
> Prioridad: **P1** entregable del hackathon (fecha límite fija) · **P2** bloqueante para pasar a Producción · **P3** mejora futura.
> Cada pendiente tiene un ID único `TD-NN`. Lo resuelto pasa a "Hechos" con fecha; los IDs no se reutilizan.

## El hackathon (fuente: lablab.ai, revisado 2026-10-06)

**AMD Developer Hackathon: ACT III.** Fase online del 12 al 18 de octubre de 2026; fase presencial opcional el 17 y 18 en
Roma, Milán e Imperia (sin viaje ni alojamiento cubiertos). Equipos de 1 a 6 personas.

- **Pista:** 2 · Health and Wellbeing. Sus reglas de seguridad y cómo las cubre AXONFAS están en [01 · Lógica](01-logic.md).
- **Requisito técnico:** una parte importante de la carga tiene que correr en AMD y verse en el producto que evalúan los jueces.
- **Entrega:** título, descripción corta y larga, pista elegida, tags, imagen de portada, video demo, slides, repo
  público en GitHub, prototipo funcionando y URL de la app. Las entregas deben ser "original and MIT-compliant".
- **Criterios:** aplicación de la tecnología, presentación, valor de negocio y originalidad.
- **Premios de socios (opcionales):** además del premio principal, Google pone USD 5,000 para proyectos que usen una
  tecnología suya "elegible", sin decir cuál. AXONFAS ya usa MediaPipe, que es de Google (ver TD-27).
- **Sin publicar todavía:** el cronograma y las fechas de evaluación ("Event Schedule: To be announced").

## Antes del hackathon (hasta el 2026-10-11)

| ID | P | Pendiente | Relación |
|---|---|---|---|
| TD-04 | P1 | Levantar un droplet MI300X con la imagen vLLM Quick Start, por CLI con `doctl` (ver [02](02-architecture.md)), y probar que el LLM, Whisper y el TTS caben juntos. Bloqueado: crear un GPU Droplet exige una tarjeta registrada aunque haya créditos (tutorial de lablab, marzo 2026). Los USD 100 se aplican solos al unirse al AMD AI Developer Program y vencen unos 30 días después (fecha exacta en Billing). Sin tarjeta, pasa al primer día del hackathon | ADR-006, TD-27 |
| TD-05 | P1 | Elegir el modelo lifter 2D→3D: candidatos, licencias de código y pesos, y latencia en [02](02-architecture.md) | ADR-004, ADR-006 |
| TD-06 | P1 | Hablar con al menos 2 fisioterapeutas para validar el ejercicio, las compensaciones y el sobre de seguridad, con el prototipo de TD-28 (mejor después de probar las alertas en TD-32); lo lleva la persona del equipo a cargo de la validación clínica | ADR-005, ADR-009, TD-28 |
| TD-22 | P1 | Registrar `axonfas.ai` o `axonfas.app`, la cuenta u organización `axonfas` en GitHub y `@axonfas` en Instagram (libres el 2026-10-06; registro en curso el 2026-10-08) | ADR-001 |
| TD-27 | P1 | Preguntar a los organizadores en Discord: (1) si los participantes reciben créditos o códigos de AMD Developer Cloud en el kickoff y si igual se exige tarjeta (la respuesta del 2026-10-08 solo cubrió Evolus); (2) si se puede llegar con un prototipo hecho antes del evento, ya que las bases piden entregas "original"; (3) qué tecnologías de Google cuentan para su premio (MediaPipe, o Gemma como LLM); (4) las fechas de evaluación y si la URL del demo debe estar activa todo ese tiempo | TD-04, TD-23, TD-28 |
| TD-32 | P1 | Probar el prototipo con cámara compensando a propósito (más inclinación de tronco, rodilla hacia adentro) para confirmar que las alertas saltan con una persona real; la primera prueba no tuvo compensaciones | TD-28 |
| TD-47 | P1 | Probar con una persona real el seguimiento de la galería (`seguimiento.html`): al menos un ejercicio por modo (sentadilla parcial, apoyo en un pie, activación abdominal) y uno acostado (puente). Hoy está verificado con una figura sintética, no con la cámara | ADR-014, TD-46 |

## Durante el hackathon (2026-10-12 a 2026-10-18)

| ID | P | Pendiente | Relación |
|---|---|---|---|
| TD-07 | P1 | Bucle rápido funcionando con alerta < 250 ms medida en `alert_latency_ms` | ADR-004 |
| TD-08 | P1 | Benchmark de sesiones concurrentes en 1× MI300X (gráfico latencia vs. sesiones) | ADR-006 |
| TD-09 | P1 | Panel del terapeuta: aprobar el borrador SOAP. Ver sesiones, eventos, indicadores y la sesión en vivo ya funciona en Staging (`doctor.html`, ADR-012/013) | ADR-002, ADR-008, ADR-012 |
| TD-10 | P1 | Export FHIR R4 validado con un validador público | ADR-008 |
| TD-11 | P1 | Entrega en lablab: repo público, video demo, slides, imagen de portada, prototipo con URL funcionando, descripciones y tags. Confirmar si se exige app en contenedor (el brief de Evolus lo cita como regla de entrega) | — |
| TD-23 | P1 | URL del demo para los jueces. La evaluación es en línea y probablemente dura hasta mediados de noviembre: Evolus deja sus espacios gratis hasta el 2026-11-15 "so it stays up through judging". La GPU encendida cuesta ~USD 48 al día (más de USD 1,300 si quedara prendida del 18 de octubre al 15 de noviembre) y los créditos dan ~50 h. Propuesta: la URL vive en un hosting barato con un modo "repetición" de una sesión real grabada en la GPU, con latencias medidas, y el modo en vivo se enciende en ventanas avisadas. El droplet se destruye al final de cada jornada | ADR-006, TD-27 |
| TD-24 | P1 | Pitch y demo de la pista 2: mostrar un caso completo y explicar cómo AXONFAS maneja respuestas incorrectas, información sensible, incertidumbre, decisiones de alto riesgo y revisión humana (tabla en [01](01-logic.md)) | ADR-004, ADR-005 |
| TD-25 | P1 | Hacer visible la incertidumbre: mostrar la confianza de los puntos de la pose y definir qué hace el sistema con frames de baja confianza. El prototipo de TD-28 ya lo hace (no evalúa, avisa y marca la repetición); falta llevarlo a la versión del hackathon y validarlo en TD-06 | ADR-004, TD-28 |
| TD-26 | P1 | Licencia MIT en el repo (regla "MIT-compliant") y licencias de los modelos usados en el README | TD-05 |

## Bloqueantes para pasar a Producción

| ID | P | Pendiente | Relación |
|---|---|---|---|
| TD-12 | P2 | Validación clínica con fisioterapeutas y un piloto controlado | ADR-010 |
| TD-13 | P2 | Revisión regulatoria: software como dispositivo médico (FDA en EE. UU., DIGEMID en Perú) | ADR-010 |
| TD-14 | P2 | Cumplimiento de protección de datos (Ley 29733 en Perú; HIPAA si se entra a EE. UU.) | ADR-003, ADR-010 |
| TD-15 | P2 | Consentimiento informado digital y política de retención de datos | ADR-010, 03 |
| TD-16 | P2 | Pruebas de sesgo: distintas contexturas, edades, iluminación y ángulos de cámara | ADR-010 |
| TD-29 | P2 | Pesos del lifter con licencia clara: revisión legal, licencia comercial de los datasets o reentrenar con datos propios o con licencia (ver [02](02-architecture.md)) | TD-05 |
| TD-41 | P2 | Autenticación real antes de Producción: contraseña o SSO, verificación de la matrícula del fisioterapeuta, expiración y revocación de tokens, y no guardarlos en localStorage. Hoy son cuentas de demostración (ADR-012) | ADR-012, TD-14 |
| TD-43 | P2 | Validar con fisioterapeutas o con literatura de electromiografía la estimación de carga muscular de la vista en vivo, antes de mostrarla como algo más que educativa | ADR-013, TD-06 |
| TD-48 | P2 | Validar con fisioterapeutas las medidas y los valores de partida del seguimiento (`SPECS` de `tracker.js`): recorrido pedido, sentido, sostén y lugar de la cámara de cada ejercicio. Empezar por los 14 "aproximados" | ADR-014, TD-06 |

## Mejoras futuras

| ID | P | Pendiente | Relación |
|---|---|---|---|
| TD-17 | P3 | Alertas de compensación en más ejercicios. Desde ADR-014 los 24 de la galería se siguen con la cámara y cuentan repeticiones, pero solo sentarse y pararse tiene reglas de compensación | ADR-009, ADR-011, ADR-014 |
| TD-18 | P3 | Ajuste fino (fine-tuning) del LLM en ROCm con notas SOAP de ejemplo escritas por fisioterapeutas | ADR-006, ADR-008 |
| TD-19 | P3 | Modo offline con pose 3D en el propio dispositivo (Ryzen AI / NPU) para zonas con mala conexión | ADR-003, ADR-006 |
| TD-20 | P3 | Integración con sistemas de historia clínica vía FHIR | ADR-008 |
| TD-21 | P3 | Voz en quechua para pacientes de zonas andinas | — |
| TD-37 | P3 | Borrar `src/frontend/validation-prototype/preview.html`: es una copia vieja de `index.html` (no tiene nada propio, le falta el indicador de fase y falla al iniciar una sesión). Espera la aprobación del owner, porque borrar archivos la requiere | TD-35 |
| TD-42 | P3 | Vista 3D anatómica (huesos y músculos) en la nube, con three.js y un modelo abierto. Revisar licencias: muchos son CC BY-SA, a contrastar con la regla "MIT-compliant" | ADR-013 |
| TD-45 | P3 | Pasar la API de Staging al gateway de la nube: FastAPI, PostgreSQL con el modelo de 03 y WebSocket para el canal en vivo, con el mismo contrato | ADR-012, ADR-006 |
| TD-49 | P3 | Guardar por repetición el recorrido máximo y el sostén de las sesiones con conteo de cámara, para indicadores de efectividad en todos los ejercicios (hoy se guarda solo el total de repeticiones) | ADR-014, ADR-012 |
| TD-50 | P3 | Unificar en un módulo la carga de MediaPipe y el bucle de cámara, hoy repetidos en `app.js` y `seguimiento.js` | ADR-014 |

## Hechos

| ID | Fecha | Pendiente | Resultado |
|---|---|---|---|
| TD-01 | 2026-10-06 | Confirmar disponibilidad de dominio, usuario de GitHub e Instagram | Libres: `axonfas.ai`, `axonfas.app`, `axonfas.com` y `axonfas.health` sin registro (RDAP); `github.com/axonfas` libre y ningún repo con ese nombre; `@axonfas` no existe en Instagram; sin resultados de "AXONFAS" en lablab.ai. Registrarlos es TD-22 |
| TD-03 | 2026-10-06 | Revisar las pistas oficiales y elegir la que encaje | Pistas publicadas: Intelligent Industry, Health and Wellbeing, Reinvent Commerce y Create a New Kind of Experience (más la de Evolus). AXONFAS encaja en Health and Wellbeing. El ajuste del pitch sigue en TD-24 |
| TD-02 | 2026-10-08 | Inscribirse en lablab.ai, Discord y el AMD AI Developer Program | Hecho por el owner |
| TD-28 | 2026-10-08 | Prototipo de validación para fisioterapeutas (solo navegador, sin GPU) | Construido en `src/frontend/validation-prototype/` (9 tests del motor, demo sintético, MediaPipe 1.1.0) y probado por el owner con cámara: detectó 9 repeticiones, la línea base salió estable y no hubo falsas alarmas. Mejoras en TD-30 y TD-31; prueba de alertas con una persona real en TD-32 |
| TD-30 | 2026-10-08 | Guía visual del ejercicio en el prototipo de validación | Guía antes de empezar: animación de referencia de lado, con la cinemática del demo (con movimiento reducido muestra las posiciones inicial y final lado a lado), 4 pasos numerados, qué esperar de la calibración y diagrama de la cámara. Se cierra sola al empezar |
| TD-31 | 2026-10-08 | Avisos de progreso legibles a 2–3 m | Contador grande sobre el video con fase y barra de repeticiones (calibración, hechas, con alerta); carteles grandes con voz al empezar, en cada repetición, al terminar la calibración, en la última y al final; aviso si una repetición de calibración no contó; botón de pantalla completa. Verificado con el demo sintético |
| TD-33 | 2026-10-10 | Probar el prototipo desde otros equipos de la misma red | `serve.py` publica la carpeta del prototipo en HTTP 8091 (este equipo) y HTTPS 8443 con certificado autofirmado (otros equipos, para que la cámara funcione). Botón "Probar en otro equipo" con QR hacia la dirección HTTPS. Verificado: el QR decodifica a la URL correcta, las rutas fuera de la carpeta dan 404 y el demo funciona con el diseño HUD Biónico. El 2026-10-10 se agregó el script de lanzamiento `lanzar-prototipo.cmd` (doble clic), que también aparece en el panel de contexto |
| TD-34 | 2026-10-10 | Textos que atribuían el prototipo a la GPU, ROCm o la IA | Cabecera, insignia del video, título y pie dicen ahora que es un prototipo sin conexión: no usa servidor, GPU ni agente de IA, la pose se estima en el navegador y las alertas salen de reglas fijas |
| TD-35 | 2026-10-10 | Design system copiado en varios lugares | `index.html` ya no copia los tokens: enlaza `docs/design-system/tokens.css`, que funciona con doble clic y con `serve.py` (ruta `/docs/design-system/`, sin salir de esa carpeta). Queda borrar `preview.html` (TD-37) |
| TD-36 | 2026-10-10 | Vista móvil del prototipo | En tablet y celular los tacómetros salen del video a una grilla, la botonera usa botones de 44 px (cámara y "Dolor: detener" a todo el ancho), el video toma la forma de la cámara (vertical en celular) y el demo usa un recuadro cuadrado para que la fase y el contador no tapen la figura. Pantalla completa ahora toma el escenario entero, con la botonera. Verificado a 375 px y 1280 px |
| TD-38 | 2026-10-11 | Galería de ejercicios desde fuentes documentadas | `catalog.js` con 24 ejercicios en rodilla y cadera, columna lumbar y cervical, hombro, y equilibrio y caídas. Cada uno cita AAOS OrthoInfo, NHS WWL o CDC STEADI con su dosis. `galeria.html` filtra por temática y busca por nombre o músculo, con mapa muscular por ejercicio. 4 tests de catálogo |
| TD-39 | 2026-10-11 | Cuentas de fisioterapeuta y paciente | API de Staging (`staging_api.py`, 10 tests): afiliación con código o QR y consentimiento, plan desde el catálogo con sobre de seguridad, sesiones monitoreadas y guiadas, e indicadores de cumplimiento y efectividad. Verificado de punta a punta en el navegador |
| TD-44 | 2026-10-11 | Imagen de referencia propia de cada ejercicio (el owner no sabía cómo hacer la abducción de cadera ni si la hizo bien) | `guide-figure.js`: figura animada de dibujo propio para los 24 ejercicios, con posición inicial, movimiento, sostén con el tiempo de la dosis y vuelta, más silla, mesa, banda o colchoneta. Con movimiento reducido muestra inicio y final. Está junto al video del seguimiento, en "Cómo se hace", en cada tarjeta de la galería y en el plan y la vista guiada del paciente. 5 tests (apoyo en el suelo, ancla fija, manos que no se despegan, una figura por ejercicio). Un video propio queda como mejora opcional |
| TD-51 | 2026-10-11 | "Sostener" no se cumplía: la repetición contaba aunque se bajara al instante (reporte del owner en abducción de cadera) | Con sostén en la dosis, la repetición solo cuenta si la cuenta llega a 0 sin bajar (cortes de menos de 0,4 s toleran el ruido); si no, avisa "sostuviste 2 s de 5 s: no contó". Cuenta grande sobre el video que pasa a "¡Bien! Ahora baja" al llegar a 0, e indicación de cada fase arriba. 2 tests nuevos y prueba en el navegador con una figura sintética (1,5 s no cuenta, 5,8 s sí) |
| TD-46 | 2026-10-11 | Seguimiento corporal y conteo en los ejercicios de la galería (el owner solo veía imágenes de referencia) | `tracker.js` (medida, repeticiones, sostenes y modo manual para los 24 ejercicios, 10 tests) y `seguimiento.html`: esqueleto, valor junto a la articulación, contador legible a 2–3 m, voz, mapa muscular según el avance y tabla de repeticiones. Botón "Seguir con la cámara" en cada tarjeta de la galería y "Empezar con la cámara" en el plan del paciente. En modo paciente, el fisioterapeuta lo ve en vivo y la sesión se guarda. Verificado con una figura sintética, en escritorio y a 375 px. De paso: la sección de resultados de `index.html` desbordaba a 918 px en celular al tener filas, ya corregido (ADR-014) |
| TD-40 | 2026-10-11 | Vista corporal en vivo y enseñanza | Mapa muscular 2D (polígonos MIT) con carga estimada, esqueleto con huesos rotulados, ángulos y alertas en vivo por Server-Sent Events; el fisioterapeuta señala músculos o ejercicios al paciente. Verificado: llegan los marcos, las alertas y las sesiones guardadas |
