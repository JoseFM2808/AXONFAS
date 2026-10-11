# .ai-context/

Arquitectura viva de AXONFAS para agentes de IA (Claude Code y otros). Se va a versionar en un repo **público**.

| Archivo | Contenido |
|---|---|
| `llms.txt` | Índice para LLMs (formato llmstxt.org) |
| `01-logic.md` | Dos bucles, flujo de una repetición, cadena de compensación, turno de voz, invariantes |
| `02-architecture.md` | Tecnologías, tesis "toda la clínica en una GPU", componentes, agentes, carpetas, entornos |
| `03-database.md` | ER, diccionario de datos y reglas de integridad (PostgreSQL) |
| `04-decisions-adr.md` | ADR-001 en adelante + anexo del modelo de negocio |
| `05-tech-debt.md` | Pendientes `TD-NN` con prioridad P1/P2/P3 y fecha límite |
| `06-api-mcp.md` | Interfaces previstas, contratos JSON ya fijados y estado de MCP |

**Qué entra aquí**: solo arquitectura técnica y decisiones formales.
**Qué no entra**: actas, acuerdos del equipo, conversaciones de aprendizaje, datos de pacientes (ni siquiera
sintéticos), secretos. Lo privado va en `docs/meetings/`, que no se versiona.

Después de cada cambio técnico: actualizar las pestañas afectadas y ejecutar desde la carpeta del proyecto
`py ../.claude/context-sync/context_sync.py` hasta que no quede ningún `FAIL`.

Panel publicado (las seis pestañas en una página): https://claude.ai/artifact/9mXdndf1iqyp85yJuHf7Kv. Se regenera con
`py src/frontend/context-panel/build_panel.py` y se republica siempre en esa misma URL.
