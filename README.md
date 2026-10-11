# AXONFAS

Fisioterapia en casa supervisada por la clínica. El paciente hace sus ejercicios frente a la cámara del navegador,
AXONFAS detecta en el momento cuándo compensa con otro segmento del cuerpo y un agente clínico adapta la sesión
dentro de los límites que fijó su fisioterapeuta. Al terminar, el terapeuta recibe un borrador de nota SOAP y un
reporte FHIR R4. Se vende a clínicas; el paciente lo usa gratis.

Toda la parte pesada (pose 3D, LLM, voz) corre junta en **una sola GPU AMD Instinct MI300X** con ROCm.

> **Estado: Staging.** Proyecto para el AMD Developer Hackathon: ACT III en lablab.ai, pista Health and Wellbeing
> (12–18 de octubre de 2026). Solo datos sintéticos. No es un dispositivo médico ni sustituye la evaluación de un
> profesional.

| | Estado |
|---|---|
| Lógica, arquitectura, BD y ADRs | ✅ diseñados ([`.ai-context/`](.ai-context/llms.txt)) |
| Bucle rápido de seguridad (< 250 ms) | ⏳ hackathon |
| Benchmark de sesiones concurrentes en 1× MI300X | ⏳ hackathon |
| Panel del fisioterapeuta + export FHIR R4 | ⏳ hackathon |

## Estructura

```
AXONFAS/
├── .ai-context/           # Docs vivas para LLMs: 01 lógica · 02 arquitectura · 03 BD · 04 ADRs · 05 pendientes · 06 API y MCP (+ llms.txt)
├── docs/
│   ├── design-system/     # Design system "HUD Biónico": tokens.css y reglas de UI
│   └── meetings/          # Actas y acuerdos del equipo (privado, no se versiona)
├── data/
│   ├── raw/               # Datos sintéticos de entrada (no se versiona)
│   ├── processed/         # Datos procesados (no se versiona)
│   └── vector_store/      # Reservado para un índice RAG
├── notebooks/             # Solo experimentos y pruebas de concepto
├── src/
│   ├── agents/            # Orquestador, prompts y los 3 agentes LLM
│   ├── backend/           # Gateway FastAPI + WebSocket, pose 3D, motor de reglas, voz, BD, FHIR
│   └── frontend/          # UI del paciente y panel del fisioterapeuta
├── tests/                 # Motor de reglas, sobre de seguridad, benchmark de latencia, FHIR
├── config/                # Plantillas de entorno sin valores (.env.staging.example, .env.prod.example)
├── CLAUDE.md              # Reglas permanentes para Claude Code; hereda ../CLAUDE.md
└── README.md
```

## Documentación

Todo lo técnico vive en [`.ai-context/`](.ai-context/llms.txt): lógica de los dos bucles, arquitectura, modelo de
datos, decisiones (ADRs) y pendientes. Los agentes de IA empiezan por [`CLAUDE.md`](CLAUDE.md).

## Seguridad y privacidad

Nunca subas llaves, archivos `.env` reales, datos de pacientes ni grabaciones de video o audio. El `.gitignore` ya
los excluye; las plantillas de `config/` no llevan valores.
