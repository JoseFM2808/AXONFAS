# CLAUDE.md · AXONFAS

Este proyecto hereda las reglas del workspace en `../CLAUDE.md`. La principal: tras cada cambio técnico hay que
actualizar `.ai-context/` (pestañas 01–06) y ejecutar `py ../.claude/context-sync/context_sync.py` hasta que no
quede ningún `FAIL`. Empieza siempre por `.ai-context/llms.txt`.

## Reglas específicas del proyecto

### Seguridad del paciente (no negociables)

- **El LLM nunca está en el camino de una alerta de seguridad (ADR-004).** Las alertas las emite solo el motor de
  reglas determinista, con un objetivo < 250 ms medido en `compensation_event.alert_latency_ms`.
- **Ningún ajuste sale del `safety_envelope` (ADR-005).** El agente propone `{param, old, new, reason}` y el motor de
  reglas valida. `outcome = 'applied'` exige `within_envelope = true`. Sin sobre configurado no se inicia sesión.
- **Dolor agudo, mareo o pérdida de fuerza súbita detienen la sesión.** El agente no intenta resolverlo.
- **La nota SOAP solo usa campos de la BD.** El LLM no inventa cifras. El reporte es borrador hasta que lo firma un
  terapeuta (`reviewed_by`).
- Todas las invariantes están en `.ai-context/01-logic.md` §Invariantes. No contradigas un ADR Aceptado sin proponer
  otro que lo reemplace.

### Datos y privacidad

- **Staging es el único entorno (ADR-010).** Solo datos sintéticos o del propio equipo con consentimiento. Nada de
  datos reales de pacientes, ni en `data/`, ni en tests, ni en prompts. Producción está bloqueada por TD-12 a TD-16.
- **El video no sale de casa (ADR-003).** Al servidor solo llegan coordenadas 2D y el audio de voz. No guardes ni
  versiones grabaciones de video o audio.
- El repo será público: sin secretos, sin `.env` reales (solo `config/.env.*.example`), sin actas (`docs/meetings/` no
  se versiona) y sin nombres reales de pacientes, terapeutas o clínicas.

### Alcance y stack

- **Demo = 1 ejercicio (sentarse-pararse) y 2 compensaciones (flexión de tronco y valgo de rodilla), ADR-009.** Ampliar
  el alcance requiere un ADR nuevo; lo demás va a `05-tech-debt.md`.
- Cómputo: 1× AMD Instinct MI300X en AMD Developer Cloud, con vLLM y PyTorch sobre ROCm (ADR-006). No
  elijas dependencias de GPU que solo existan para CUDA: todo tiene que correr sobre ROCm.
- Arquitectura: 3 agentes LLM (clínico, conversacional, reporte) + 1 motor de reglas + 1 servicio de pose (ADR-007).
  Carpetas: `src/frontend/`, `src/backend/`, `src/agents/` (detalle en `.ai-context/02-architecture.md`).
- Identificadores de código y BD en inglés (como en `03-database.md`); documentación en español.
- Escribe siempre el nombre completo **AXONFAS**, nunca "Axon" a secas (ADR-001).

### Nube AMD (cuesta dinero)

- Se maneja con `doctl --api-url https://api.devcloud.amd.com` (detalle en `.ai-context/02-architecture.md`). El token lo
  configura el owner en su terminal; nunca lo pidas, lo escribas ni lo guardes en el repo.
- Crear un droplet o un snapshot gasta créditos: pide el visto bueno del owner cada vez. Etiqueta todo con `axonfas`.
- Un droplet apagado sigue cobrando: al terminar la jornada, snapshot y destruir.

### Estructura

- Archivos raíz permitidos: `README.md`, `CLAUDE.md`, `.gitignore` y `.gitattributes`. Repo público:
  https://github.com/JoseFM2808/AXONFAS (rama `main`); antes de cada push, revisar que no haya secretos ni datos personales.
  Carpetas raíz: `.ai-context/`, `docs/`, `data/`, `notebooks/`, `src/`, `tests/`, `config/` (estructura de
  `_Plantilla Proyecto IA`).
- **Publicación directa autorizada por el owner (2026-10-11):** tras un cambio verificado (tests en verde, sync sin FAIL
  y revisión de secretos y datos personales), haz commit y `git push origin main` sin pedir confirmación, y avisa qué se
  publicó. El remoto usa `https://JoseFM2808@github.com/...`: Git Credential Manager publica como JoseFM2808 solo en este
  repo. Verifica cada push con `git ls-remote` antes de darlo por hecho.
- Nada de `rm` / `mv` sin aprobación explícita del owner.

### Entorno local

- Windows: usa el lanzador `py` (el alias `python` no existe).
- Puertos ocupados por otras apps del owner: 8765 (Mi Puestito), 8750 (CoreAlpha), 8123 (preview). Usa otros.

## Comandos

```bash
py ../.claude/context-sync/context_sync.py     # después de cada cambio técnico, desde esta carpeta
py src/frontend/context-panel/build_panel.py   # regenera el panel de contexto desde .ai-context/
node --test "tests/validation-prototype/*.test.cjs"   # motor, catálogo, carga estimada y seguimiento (TD-28, ADR-011/013/014)
py -m unittest discover -s tests/backend              # API de Staging: cuentas, planes, sesiones, en vivo (ADR-012)
```

Cuentas de demostración (ADR-012): `doctor.html` (fisioterapeuta) y `paciente.html`, servidas por `serve.py`. Sin
contraseñas y solo datos de prueba con seudónimo; la base vive en `~/.axonfas/staging.sqlite3`, nunca en el repo. La
galería sale de `catalog.js`: todo ejercicio nuevo cita una fuente pública (URL https), su dosis y sus precauciones, con
descripción propia (no copiar textos de la fuente). Solo `monitoring: 'auto'` si el motor de reglas lo vigila (ADR-009).
Todo ejercicio nuevo necesita además su entrada en `SPECS` de `tracker.js` (seguimiento con cámara, ADR-014; un test lo
exige). El seguimiento solo cuenta: nunca emite alertas de compensación (I-12).
La carga muscular del mapa es una estimación educativa: nunca se presenta como medición ni diagnóstico (ADR-013).

El prototipo de validación (`src/frontend/validation-prototype/`) se abre con doble clic en `index.html` o con
`py src/frontend/validation-prototype/serve.py`, que lo publica en la red local (HTTP 8091 para este equipo, HTTPS 8443
con certificado autofirmado y QR para otros equipos; `--local-only` lo deja solo en este equipo). El certificado vive en
`~/.axonfas/certs` y nunca entra al repo. Script de lanzamiento con doble clic: `src/frontend/validation-prototype/lanzar-prototipo.cmd`.
Sus umbrales son valores de partida, no clínicos. La UI sigue el design system de `docs/design-system/` (HUD Biónico):
los tokens viven **solo** en `docs/design-system/tokens.css`; no los copies en el HTML. La vista tiene que seguir
funcionando en celular (375 px) además de escritorio, y ningún texto puede atribuir el prototipo a la GPU, a ROCm o a la
IA mientras no lo use (TD-34).

Si cambia alguna pestaña, regenera el panel y vuelve a publicar
`src/frontend/context-panel/dist/axonfas-panel.html` en la **misma** URL de artifact, sin crear uno nuevo:
https://claude.ai/artifact/9mXdndf1iqyp85yJuHf7Kv

Los comandos de build, tests y benchmark se añaden aquí cuando exista el código.
