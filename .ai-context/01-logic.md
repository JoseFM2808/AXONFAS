# 01 · Lógica del sistema

> Proyecto: **AXONFAS** · Entorno actual: **Staging** · Actualizado: 2026-10-06
> Estado de implementación: diseño. Solo existe el prototipo de validación del navegador (sección al final); el sistema
> completo todavía no tiene código.

## Idea central

El sistema trabaja con **dos bucles separados**. Esta es la decisión técnica más importante del proyecto, porque de ella depende que sea seguro para un paciente ([ADR-004](04-decisions-adr.md)).

| Bucle | Qué hace | Quién decide | Latencia objetivo |
|---|---|---|---|
| **Rápido (seguridad)** | Detecta una compensación o un ángulo fuera de rango y avisa en el momento | Motor de reglas biomecánicas (determinista) | < 250 ms |
| **Lento (razonamiento)** | Ajusta series, rango y pausas, y responde lo que dice el paciente | Agente clínico (LLM) | 1–2 s |

El LLM **nunca** está en el camino de una alerta de seguridad. Solo puede mover parámetros dentro del **sobre de seguridad** (`safety_envelope`) que el fisioterapeuta definió en el plan de cuidado ([ADR-005](04-decisions-adr.md)).

## Flujo de una repetición

```mermaid
flowchart TD
    A[Cámara del paciente] --> B[Navegador: detector 2D de puntos clave]
    B -->|solo coordenadas, el video no sale de casa| C[Gateway WebSocket]
    C --> D[Elevador 3D en GPU AMD]
    D --> E[Motor biomecánico: ángulos, ROM, simetría]
    E --> F{¿Compensación o ROM fuera del sobre?}
    F -->|Sí| G[Alerta inmediata: color + frase corta pregrabada]
    F -->|No| H[Registrar métrica de repetición]
    G --> I[Evento de compensación]
    H --> J[Agente clínico LLM cada N reps o ante evento]
    I --> J
    J --> K{¿Cambio dentro del sobre del terapeuta?}
    K -->|Sí| L[Aplicar ajuste + explicarlo por voz]
    K -->|No| M[Pausar ejercicio + marcar para revisión del terapeuta]
    L --> N[Registro de decisión del agente]
    M --> N
```

## Detección de cadena de compensación (diferenciador)

Las apps actuales miden **una** articulación contra un umbral. AXONFAS mide **la relación entre segmentos**: cuando el ángulo objetivo mejora pero otro segmento empieza a desviarse, eso es compensación.

Regla base para el demo (sentarse y pararse / sentadilla, [ADR-009](04-decisions-adr.md)):

1. `rodilla_flexión` alcanza el rango pedido **y**
2. `tronco_flexión` sube más de X° respecto a la línea base del paciente **o**
3. `rodilla_valgo` supera Y° **o**
4. `asimetría_carga` izquierda/derecha supera Z%

→ se genera un `compensation_event` con tipo, severidad (1–3) y la repetición donde ocurrió.

Los umbrales X, Y, Z **no se inventan**: se toman de la línea base de calibración del propio paciente (primeras 3 repeticiones) y los ajusta el fisioterapeuta.

## Turno de voz

```mermaid
sequenceDiagram
    participant P as Paciente
    participant W as Navegador
    participant S as STT (Whisper, GPU)
    participant A as Agente clínico (LLM, vLLM)
    participant R as Motor de reglas
    participant T as TTS (GPU)
    P->>W: "Me dio un pinchazo en la ingle"
    W->>S: audio en streaming
    S->>A: texto + contexto de las últimas reps
    A->>R: propuesta: reducir ROM de 90° a 70°
    R-->>A: aprobado (dentro del sobre)
    A->>T: "Entendido, baja solo hasta donde no duela..."
    T->>W: audio
    W->>P: voz + meta nueva en pantalla
    A->>A: guardar agent_decision + dolor reportado
```

## Reglas del agente clínico

- Si el paciente reporta **dolor agudo, mareo o pérdida de fuerza súbita** → detener la sesión y mostrar el mensaje de contactar al profesional. No se intenta "resolverlo".
- El agente propone cambios en formato estructurado: JSON `{param, old, new, reason}` (parámetro, valor anterior, valor nuevo y motivo), el mismo que guarda `agent_decision.proposal`. El motor de reglas los valida contra el sobre. Esquema completo en [06 · API y MCP](06-api-mcp.md).
- Todo cambio queda en `agent_decision` con su motivo, para auditoría del terapeuta.

## Fin de sesión

1. Consolidar métricas por repetición → resumen de sesión.
2. El LLM redacta un borrador de **nota SOAP** con datos reales de la sesión (no inventa cifras: solo usa campos de la BD).
3. Exportar como `Observation` FHIR R4 + PDF ([ADR-008](04-decisions-adr.md)).
4. Sumar el día al periodo de monitoreo (`monitoring_period.days_with_data`) para el modelo de negocio RTM.

## Invariantes

Resumen de lo que el código nunca puede violar. Cada uno sale de las secciones anteriores, de un ADR o de las reglas de integridad de [03 · Base de datos](03-database.md).

| # | Invariante | Origen |
|---|---|---|
| I-1 | El LLM nunca decide ni retrasa una alerta de seguridad: la alerta la emite solo el motor de reglas | ADR-004 |
| I-2 | Ningún ajuste del agente se aplica fuera del `safety_envelope`: `outcome = 'applied'` exige `within_envelope = true` | ADR-005, 03 |
| I-3 | Sin `consent_given` no se crea una sesión, y sin sobre configurado no se inicia | ADR-005, 03 |
| I-4 | El video no sale del navegador: al servidor solo llegan coordenadas 2D (y el audio de voz) | ADR-003 |
| I-5 | Los umbrales de compensación salen de la línea base del paciente (3 reps) y los ajusta el terapeuta | Esta pestaña |
| I-6 | La nota SOAP solo usa campos de la BD; nunca cifras inventadas | Esta pestaña |
| I-7 | Dolor agudo, mareo o pérdida de fuerza súbita detienen la sesión; el agente no intenta resolverlo | Esta pestaña |
| I-8 | Un reporte sin `reviewed_by` es borrador y no se exporta fuera de Staging | ADR-008, 03 |

## Reglas de seguridad de la pista Health and Wellbeing

AXONFAS compite en la pista 2 del AMD Developer Hackathon: ACT III (brief revisado el 2026-10-06). El brief exige que el
producto no presente diagnóstico ni tratamiento autónomo como consejo médico, que haga visible la incertidumbre y que
sepa cuándo una persona debe revisar o tomar el caso. Así responde el diseño a cada punto que pide explicar:

| Lo que pide el brief | Cómo lo resuelve AXONFAS | Origen |
|---|---|---|
| Sin diagnóstico ni tratamiento autónomo | El plan lo prescribe el fisioterapeuta; el agente solo ajusta dentro de su sobre; el reporte es borrador hasta que lo firma | ADR-005, ADR-008 |
| Respuestas incorrectas o sin soporte | El agente solo propone en JSON y el motor de reglas valida; la nota SOAP solo usa campos de la BD | I-2, I-6 |
| Información sensible | El video no sale de casa; pacientes con seudónimo; en Staging solo datos sintéticos | ADR-003, ADR-010 |
| Resultados inciertos | **Pendiente:** mostrar la confianza de la pose y definir qué pasa con los frames de baja confianza | TD-25 |
| Decisiones de alto riesgo | Alertas deterministas fuera del LLM; dolor agudo, mareo o pérdida de fuerza detienen la sesión; un cambio fuera del sobre pausa el ejercicio | I-1, I-7 |
| Revisión humana | `outcome = 'escalated_to_therapist'` marca el caso para el terapeuta, que aprueba la nota SOAP en el panel | ADR-005, TD-09 |

## Prototipo de validación (TD-28)

Versión mínima del bucle rápido que corre solo en el navegador, para validar con fisioterapeutas el ejercicio, las dos
compensaciones y el sobre (TD-06). Código en `src/frontend/validation-prototype/`; tests en `tests/validation-prototype/`.
No usa GPU, LLM ni voz de entrada, y no guarda nada.

| Paso | Regla implementada | Valor de partida (a validar) |
|---|---|---|
| Ángulos | Flexión de rodilla (3D), flexión de tronco contra la vertical y proxy de valgo, con los puntos "world" de MediaPipe en lugar del lifter de ADR-006 | — |
| Repetición | Empieza cuando la rodilla baja del umbral de sentado y termina al volver a sentarse habiendo llegado a estar de pie; si no llegó a pararse, no cuenta | Sentado ≥ 65°, de pie ≤ 25° |
| Línea base | Media de los picos de las 3 primeras repeticiones válidas (I-5). Una repetición con más del 20 % de frames dudosos no sirve para calibrar y se repite | 3 repeticiones |
| Umbrales | Línea base + margen del terapeuta para tronco (X) y valgo (Y); rango pedido = línea base − 10° si el terapeuta no lo fija | X = 15°, Y = 10° |
| Compensación | Solo se evalúa si la repetición alcanzó el rango pedido. Un evento por tipo y lado en cada repetición: la alerta sale en el primer frame que cruza el umbral y el evento guarda el pico | — |
| Severidad | Según cuánto supera el umbral el pico de la repetición | 1 si < 5°, 2 si < 10°, 3 si más |
| Incertidumbre | Si la menor visibilidad de los puntos clave baja del mínimo, el frame no se evalúa, se avisa y la repetición queda marcada (adelanto de TD-25) | 0.6 |
| Fin | `completed` al llegar a las repeticiones pedidas, `pain_stop` con el botón de dolor (I-7), `user_quit` al terminar a mano | 10 repeticiones |

El proxy de valgo mide cuánto se desplaza la rodilla hacia la línea media respecto de la línea cadera-tobillo, solo en el
eje horizontal, y lo expresa en grados contra la longitud de la pierna. Así no le afecta que el muslo apunte a la cámara
al estar sentado, pero necesita ver a la persona de frente o casi.
