# AXONFAS

Fisioterapia en casa supervisada por la clínica. El paciente hace sus ejercicios frente a la cámara del navegador,
AXONFAS detecta en el momento cuándo compensa con otro segmento del cuerpo y un agente clínico adapta la sesión
dentro de los límites que fijó su fisioterapeuta. Al terminar, el terapeuta recibe un borrador de nota SOAP y un
reporte FHIR R4. Se vende a clínicas; el paciente lo usa gratis.

La IA sale de **AMD Token Factory**, la API de modelos hospedada por AMD (regla del hackathon, ADR-018). La tesis de
producto es correr toda la parte pesada (pose 3D, LLM y voz) en **una sola GPU AMD Instinct MI300X** con ROCm; esa
pila ya está lista para encenderse (ADR-016).

> **Estado: Staging.** Proyecto para el AMD Developer Hackathon: ACT III en lablab.ai, pista Health and Wellbeing
> (12–18 de octubre de 2026). Solo datos sintéticos. No es un dispositivo médico ni sustituye la evaluación de un
> profesional.

| | Estado |
|---|---|
| Lógica, arquitectura, BD y ADRs | ✅ diseñados ([`.ai-context/`](.ai-context/llms.txt)) |
| Bucle rápido de seguridad (< 250 ms) | ⏳ hackathon |
| Benchmark de sesiones concurrentes en 1× MI300X | ⏳ hackathon |
| Galería de 24 ejercicios con fuentes (AAOS, NHS, CDC STEADI) | ✅ prototipo |
| Cuentas de fisioterapeuta y paciente, plan, indicadores y vista en vivo (red local) | ✅ prototipo (Staging) |
| Agentes y pila de la GPU (ADR-016): lista para correr, sin GPU todavía | ⏳ hackathon |
| Sugerencias por rol, perfil del paciente y accesibilidad WCAG 2.2 AA (ADR-017) | ✅ prototipo |
| Nota SOAP (borrador y firma) y export FHIR R4 desde el panel, en Staging local | ✅ prototipo (falta validar con el validador de HL7) |
| Aviso de molestias del paciente: baja la exigencia con reglas, registra y avisa al fisioterapeuta, sin GPU (ADR-021) | ✅ prototipo (Staging) |
| Descanso recomendado entre series, que se puede saltar o alargar (ADR-022) | ✅ prototipo |
| Panel del fisioterapeuta en la nube | ⏳ hackathon |
| IA con AMD Token Factory (agentes, resumen para el fisioterapeuta) | ✅ verificado con la clave del equipo |
| Inicio de sesión con Google, roles y Administrador maestro | ✅ verificado con el Administrador real |
| Despliegue en la nube de AMD (Docker + HTTPS) y web en Vercel | ✅ listo para publicar ([`config/deploy/`](config/deploy/README.md), TD-71) |

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
datos, decisiones (ADRs, hasta el ADR-022 aceptado) y pendientes. Los agentes de IA empiezan por [`CLAUDE.md`](CLAUDE.md).

## Licencias

El código de AXONFAS se publica con licencia MIT ([LICENSE](LICENSE), desde el 2026-10-18; la regla de la entrega pide
que sea compatible con MIT). Estas son las licencias de lo que usa el proyecto (según la ficha de cada modelo o
proyecto, revisado 2026-10-17; pendiente de confirmar en las fichas oficiales, TD-26):

| Componente | Para qué | Licencia | Dónde |
|---|---|---|---|
| Qwen2.5-7B-Instruct | LLM de los 3 agentes | Apache-2.0 | `src/backend/gpu/bootstrap.sh` (`MODEL=`) |
| Whisper large-v3-turbo (`openai/whisper-large-v3-turbo`) | Voz a texto | MIT | `src/backend/gpu/voice_server.py` |
| Kokoro-82M (`hexgrad/Kokoro-82M`) y su paquete `kokoro` | Texto a voz | Apache-2.0 | `voice_server.py`, `requirements-gpu.txt` |
| vLLM | Servidor del LLM | Apache-2.0 | Imagen del droplet (ADR-016) |
| PyTorch | Inferencia en ROCm | BSD-3-Clause | Imagen del droplet |
| Transformers (Hugging Face) | Carga de Whisper | Apache-2.0 | `voice_server.py` |
| FastAPI, Uvicorn, soundfile | Servidor de voz | MIT, BSD-3-Clause, BSD-3-Clause | `requirements-gpu.txt` |
| MediaPipe Tasks Vision 1.1.0 y el modelo `pose_landmarker_full` | Pose 2D en el navegador | Apache-2.0 | `src/frontend/validation-prototype/pose-camera.js` |
| react-body-highlighter (polígonos del mapa muscular) | Mapa muscular | MIT | `body-map-data.js` |
| qrcode-generator 1.4.4 | QR para afiliar y abrir en otro equipo | MIT | `share.js`, `doctor.html`, `index.html` |
| Space Grotesk, Outfit y JetBrains Mono (Google Fonts) | Tipografía | SIL OFL-1.1 | `<head>` de las páginas |
| espeak-ng | Fonemas del TTS en español; se instala con `apt` dentro del contenedor de la GPU y no se distribuye con el repo | **GPL-3.0** (decisión documentada: se deja así, TD-83) | `bootstrap.sh` |
| Lifter 2D a 3D | Pose 3D | Por elegir (TD-05; licencias de pesos en TD-29) | - |

Los ejercicios citan AAOS OrthoInfo, NHS WWL y CDC STEADI; las descripciones y las figuras son propias (ADR-011).

## Seguridad y privacidad

Nunca subas llaves, archivos `.env` reales, datos de pacientes ni grabaciones de video o audio. El `.gitignore` ya
los excluye; las plantillas de `config/` no llevan valores.
