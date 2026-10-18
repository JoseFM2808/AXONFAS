"""AXONFAS · narración en inglés del video (TTS local, sin claves).

Lee `script/voiceover.json` y genera un WAV por frase en `<workdir>/public/voiceover/`, más `manifest.json` con la
duración de cada clip. Remotion arma la línea de tiempo con ese manifiesto: cada escena dura lo que su audio (con un
mínimo igual a la duración base del guion).

Motores:
- `kokoro`: Kokoro-82M (Apache-2.0, el mismo TTS de ADR-016) en ONNX con `kokoro-onnx`, en la CPU. Necesita
  `py video.py voice-setup` (venv y modelo fuera de Google Drive).
- `sapi`: las voces en inglés que trae Windows (System.Speech). Sin instalar nada; menos natural.
- `auto` (por defecto): `kokoro` si está instalado; si no, `sapi`.

El audio generado nunca se versiona (`*.wav` en .gitignore).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "script" / "voiceover.json"
KOKORO_MODEL = "kokoro-v1.0.onnx"
KOKORO_VOICES = "voices-v1.0.bin"


def load_lines(script_path: Path) -> list[dict]:
    data = json.loads(script_path.read_text(encoding="utf-8"))
    clips = []
    for phase in data["phases"]:
        for i, line in enumerate(phase["lines"]):
            clips.append({
                "phase": phase["id"],
                "index": i,
                "text": line["text"],
                "say": line.get("say", line["text"]),
                "file": f"{phase['id']}-{i}.wav",
            })
    return clips


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def kokoro_available(models: Path) -> bool:
    try:
        import kokoro_onnx  # noqa: F401
    except ImportError:
        return False
    return (models / KOKORO_MODEL).is_file() and (models / KOKORO_VOICES).is_file()


def synth_kokoro(clips: list[dict], out: Path, models: Path, voice: str, speed: float) -> str:
    import numpy as np
    from kokoro_onnx import Kokoro

    tts = Kokoro(str(models / KOKORO_MODEL), str(models / KOKORO_VOICES))
    for clip in clips:
        samples, rate = tts.create(clip["say"], voice=voice, speed=speed, lang="en-us")
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(str(out / clip["file"]), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
        print(f"  kokoro · {clip['file']} · {wav_seconds(out / clip['file']):.2f} s")
    return voice


SAPI_PS = r"""
param([string]$Jobs, [string]$Voice, [int]$Rate)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$en = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' }
if (-not $en) { Write-Error 'No English Windows voice installed'; exit 2 }
$pick = $en | Where-Object { $_.VoiceInfo.Name -like "*$Voice*" } | Select-Object -First 1
if (-not $pick) { $pick = $en | Select-Object -First 1 }
$s.SelectVoice($pick.VoiceInfo.Name)
$s.Rate = $Rate
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($job in (Get-Content -Raw -Encoding UTF8 $Jobs | ConvertFrom-Json)) {
  $s.SetOutputToWaveFile($job.path, $fmt)
  $s.Speak($job.say)
}
$s.SetOutputToNull()
Write-Output $pick.VoiceInfo.Name
"""


def synth_sapi(clips: list[dict], out: Path, voice: str, rate: int) -> str:
    if sys.platform != "win32":
        raise SystemExit("El motor 'sapi' solo existe en Windows. Usa --backend kokoro.")
    with tempfile.TemporaryDirectory() as tmp:
        ps1 = Path(tmp) / "sapi.ps1"
        jobs = Path(tmp) / "jobs.json"
        ps1.write_text(SAPI_PS, encoding="utf-8-sig")
        jobs.write_text(json.dumps([{"path": str(out / c["file"]), "say": c["say"]} for c in clips]), encoding="utf-8")
        res = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps1),
             "-Jobs", str(jobs), "-Voice", voice, "-Rate", str(rate)],
            capture_output=True, text=True,
        )
        if res.returncode != 0:
            raise SystemExit(f"SAPI falló: {res.stderr.strip()}")
        used = res.stdout.strip().splitlines()[-1]
    for clip in clips:
        print(f"  sapi · {clip['file']} · {wav_seconds(out / clip['file']):.2f} s")
    return used


def main() -> int:
    ap = argparse.ArgumentParser(description="Genera la voz en off en inglés del video de AXONFAS.")
    ap.add_argument("--out", type=Path, required=True, help="carpeta public/ del workdir de Remotion")
    ap.add_argument("--models", type=Path, required=True, help="carpeta con los archivos del modelo Kokoro")
    ap.add_argument("--script", type=Path, default=SCRIPT)
    ap.add_argument("--backend", choices=["auto", "kokoro", "sapi"], default="auto")
    ap.add_argument("--voice", default=None, help="Kokoro: af_heart (por defecto), am_michael, bf_emma…; SAPI: Zira o David")
    ap.add_argument("--speed", type=float, default=1.0, help="Kokoro: velocidad (1.0 = normal)")
    ap.add_argument("--rate", type=int, default=0, help="SAPI: velocidad de -10 a 10")
    args = ap.parse_args()

    clips = load_lines(args.script)
    out = args.out / "voiceover"
    out.mkdir(parents=True, exist_ok=True)

    backend = args.backend
    if backend == "auto":
        backend = "kokoro" if kokoro_available(args.models) else "sapi"
        print(f"Motor elegido: {backend}")
    if backend == "kokoro":
        if not kokoro_available(args.models):
            raise SystemExit("Kokoro no está listo: corre `py video.py voice-setup` primero.")
        used = synth_kokoro(clips, out, args.models, args.voice or "af_heart", args.speed)
    else:
        used = synth_sapi(clips, out, args.voice or "Zira", args.rate)

    manifest = {
        "backend": backend,
        "voice": used,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "clips": [
            {"phase": c["phase"], "index": c["index"], "file": f"voiceover/{c['file']}",
             "seconds": round(wav_seconds(out / c["file"]), 3)}
            for c in clips
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(c["seconds"] for c in manifest["clips"])
    print(f"{len(clips)} clips · {total:.1f} s de voz · {out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
