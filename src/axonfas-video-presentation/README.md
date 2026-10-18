# AXONFAS · video de presentación

Video animado de ~74 s generado solo con código: **Remotion 4 (React + TypeScript)** para la imagen y **Kokoro-82M**
(TTS local y abierto, Apache-2.0, el mismo de ADR-016) para la voz en off. Todo lo visible y audible está en **inglés**.
Sin imágenes de terceros: figuras, mapa muscular, diagramas y logo son SVG dibujados aquí, con los colores de
`docs/design-system/tokens.css` (HUD Biónico).

## Guion

Las 4 fases y su voz en off salen del documento estratégico *Investigacion_y_Guion_Video_AXONFAS* (Google Docs,
sección 5) y viven en [`script/voiceover.json`](script/voiceover.json), la única fuente: los subtítulos y el TTS leen
de ahí.

| Fase | Base del guion | Qué se ve |
|---|---|---|
| 1 · The Problem | 0:00–0:15 | Rehabilitación tradicional en gris: sensores con cables, notas a mano, "?°". Barrido cian hacia la interfaz limpia |
| 2 · The Capture | 0:15–0:35 | Logo de AXONFAS; HUD de la cámara con el esqueleto de sentarse y pararse, contador, ángulos de rodilla y tronco, mapa muscular con carga **estimada**; una repetición con valgo de rodilla: alerta del motor de reglas y guía de corrección del gemelo digital |
| 3 · The Brain | 0:35–0:50 | Arquitectura real: navegador (MediaPipe 2D, `engine.js`, triaje del Nivel 1) → solo coordenadas → API de Staging → `clinical.py`, `coach.py` y `soap.py` dentro del sobre del fisioterapeuta → AMD Token Factory; nota SOAP como documento FHIR R4 firmada por el fisioterapeuta. La pila de la MI300X va punteada: lista, todavía no corre |
| 4 · The Impact | 0:50–1:10 | Pantalla dividida (panel del fisioterapeuta con datos sintéticos y la nota que pasa de borrador a firmada; paciente en su sesión guiada con voz situacional) y revelación del logo en vidrio |

Cada fase dura lo que su audio, con un mínimo igual a su duración base. Con la voz actual: 15 + 20 + 18.8 + 20 s.

**Cambio respecto del documento (fase 3).** La frase original decía que los agentes de IA procesan la lógica del
movimiento y que "edge GPU clusters" dan la baja latencia. Eso contradice ADR-004 (las alertas son solo del motor de
reglas), ADR-018 (hoy la IA corre en AMD Token Factory) y TD-34 (no atribuir nada a la MI300X mientras no corra). Se
cambió por tres frases que dicen lo mismo sin contradecir los ADRs; la original queda en `original` dentro del JSON. Las
fases 1, 2 y 4 se usan tal cual.

## Dónde vive cada cosa

El código está en el repo, pero lo pesado **nunca va en Google Drive**: `video.py` copia el proyecto (y `tokens.css`) a
un workdir y trabaja ahí.

| Qué | Dónde |
|---|---|
| Código (este directorio) | `src/axonfas-video-presentation/` en el repo |
| `node_modules`, venv del TTS, modelo Kokoro (~355 MB), audio y `.mp4` | `%USERPROFILE%\.axonfas\video-presentation\` (cambia con `AXONFAS_VIDEO_WORKDIR`) |
| Voz generada | `<workdir>\public\voiceover\*.wav` + `manifest.json` (no se versiona) |
| Video exportado | `<workdir>\out\axonfas.mp4` (no se versiona) |

```
src/axonfas-video-presentation/
├── video.py              # CLI: setup, voice-setup, voice, check, studio, still, render, all, where
├── script/voiceover.json # guion: fases, frases, pronunciación (say) y tiempos base
├── tts/narrate.py        # TTS en inglés: Kokoro (ONNX, CPU) o, sin Kokoro, las voces de Windows (SAPI)
├── tts/requirements.txt  # kokoro-onnx fijado
├── tools/stills.mjs      # varios fotogramas a PNG con un solo bundle
├── src/                  # Remotion: Root, Video, timeline, ui, figure, bodymap y scenes/ (una escena por fase)
├── package.json, package-lock.json, tsconfig.json, remotion.config.ts
```

## Requisitos (Windows 11)

- **Node 22** (probado con 22.21.1) y npm 11.
- **Python 3.13** con el lanzador `py` (el alias `python` no existe en este equipo).
- Conexión a internet la primera vez: npm, el modelo Kokoro (GitHub), Chrome Headless Shell (lo baja Remotion en el
  primer render) y las fuentes Space Grotesk, Outfit y JetBrains Mono (Google Fonts, al renderizar).
- Nada más: Remotion trae su propio ffmpeg. Ninguna API pide clave.

## Comandos

Desde esta carpeta (`src\axonfas-video-presentation`):

```bash
py video.py setup
```

Copia el proyecto al workdir e instala las dependencias de Node (`npm ci`).

```bash
py video.py voice-setup
```

Una vez: crea el venv del TTS, instala `kokoro-onnx` y baja `kokoro-v1.0.onnx` y `voices-v1.0.bin` (se verifican con
SHA-256).

```bash
py video.py voice
```

Genera la voz en off (voz `af_heart`). Opciones: `--voice am_michael`, `--speed 0.95`, `--backend sapi` (voces de
Windows, sin descargar nada). Sin voz generada el video sale mudo, con la duración base del guion.

```bash
py video.py check
```

TypeScript sin errores (`tsc --noEmit`).

```bash
py video.py studio
```

Abre Remotion Studio en el navegador para revisar escena por escena.

```bash
py video.py still 120 900 1500 2150
```

Exporta esos fotogramas a `<workdir>\out\frame-N.png`.

```bash
py video.py render --preview
```

Prueba corta: los primeros 10 s a 960 × 540 en `<workdir>\out\axonfas-preview.mp4`.

```bash
py video.py render
```

Video final: 1920 × 1080, 30 fps, H.264 (CRF 18) con audio AAC, en `<workdir>\out\axonfas.mp4`. Con `--out` se elige
otra ruta y con `--frames 450-1049` se exporta un tramo.

```bash
py video.py all
```

`setup` + `voice` + `render` de una vez.

## Cómo cambiar algo

- **Texto o voz:** edita `script/voiceover.json` (`text` es el subtítulo; `say`, lo que pronuncia el TTS: así
  "AXONFAS" suena "Axonfas" y "FHIR", "fire") y corre `py video.py voice` y `py video.py render`.
- **Colores:** solo en `docs/design-system/tokens.css`; las escenas usan `var(--…)` a través de `C` en `src/ui.tsx`.
- **Escenas:** `src/scenes/Problem.tsx`, `Capture.tsx`, `Brain.tsx` e `Impact.tsx`. La figura de sentarse y pararse
  (`src/figure.tsx`) es un esqueleto 3D con ángulos anatómicos y cámara en tres cuartos, como `guide-figure.js`; el
  mapa muscular (`src/bodymap.tsx`) es un dibujo propio con los tokens `--muscle-*`.

## Reglas que el video respeta

- La IA hoy corre en **AMD Token Factory** (DeepSeek-V4-Flash, ADR-018). La pila de la MI300X (vLLM, Whisper, Kokoro,
  lifter 3D; ADR-016) se muestra como "ready, not live yet" (TD-34).
- El video de la cámara nunca sale del navegador; al servidor llegan solo coordenadas 2D (ADR-003, I-4).
- Las alertas las emite solo el motor de reglas determinista (ADR-004); los agentes proponen dentro del sobre del
  fisioterapeuta (ADR-005). La nota SOAP es borrador hasta que la firma el fisioterapeuta (I-8).
- La carga muscular se rotula como estimación educativa, no como medición (ADR-013). Todos los datos que aparecen son
  sintéticos (ADR-010).
- Licencia: Remotion es gratis para personas y equipos pequeños; una empresa grande necesita licencia comercial.
