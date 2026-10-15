"""AXONFAS · prueba de humo en la GPU (TD-04): ¿caben y responden juntos el LLM, Whisper y el TTS en una MI300X?

Corre dentro del contenedor (bootstrap.sh la lanza al final):
    python -m gpu.smoke            → imprime un JSON y lo guarda en results/smoke.json
Sale con código 1 si el LLM no responde. Solo datos sintéticos.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

from agents.llm import LLMError, OpenAICompatible
from agents.turn import DEMO_CTX, run_turn
from agents.voice import VoiceClient, VoiceError

PHRASE = "Me dio un pinchazo en la ingle"
RESULTS = Path(os.environ.get("AXONFAS_RESULTS", Path(__file__).resolve().parent.parent / "results"))


def rocm_smi() -> dict:
    try:
        out = subprocess.run(["rocm-smi", "--showmeminfo", "vram", "--showproductname", "--json"],
                             capture_output=True, text=True, timeout=20)
        return json.loads(out.stdout) if out.stdout.strip().startswith("{") else {"raw": out.stdout[-2000:]}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as err:
        return {"error": repr(err)}


def voice_health(url: str) -> dict:
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/health", timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as err:  # noqa: BLE001
        return {"error": repr(err)}


def main() -> int:
    report: dict = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "checks": {}}
    llm = OpenAICompatible(timeout=120)
    voice = VoiceClient(timeout=120)
    report["gpu"] = rocm_smi()
    report["voice_health"] = voice_health(voice.url)

    try:
        first = llm.chat([{"role": "user", "content": "Responde solo: listo"}], max_tokens=8)
        t = llm.chat([{"role": "user", "content": "Explica en 3 frases qué es una sentadilla parcial."}], max_tokens=200)
        tps = round(t["completion_tokens"] / (t["ms"] / 1000), 1) if t.get("completion_tokens") else None
        report["checks"]["llm"] = {"ok": True, "first_ms": first["ms"], "ms": t["ms"], "tokens_per_s": tps}
    except LLMError as err:
        report["checks"]["llm"] = {"ok": False, "error": str(err)}

    try:
        spoken = voice.tts(PHRASE)
        heard = voice.stt(spoken["wav"])
        score = SequenceMatcher(None, PHRASE.lower(), heard["text"].lower().strip(" .¡!¿?")).ratio()
        report["checks"]["voice_roundtrip"] = {"ok": score > 0.7, "tts_ms": spoken["ms"], "audio_s": spoken["seconds"],
                                               "stt_ms": heard.get("ms"), "heard": heard["text"], "similarity": round(score, 2)}
        voice_ok = True
    except VoiceError as err:
        report["checks"]["voice_roundtrip"] = {"ok": False, "error": str(err)}
        voice_ok = False

    if report["checks"]["llm"]["ok"]:
        turn = run_turn(llm, PHRASE, DEMO_CTX, voice=voice if voice_ok else None)
        turn.pop("_wav", None)
        report["checks"]["voice_turn"] = {"ok": turn["decision"].get("outcome") in ("applied", "none", "escalated_to_therapist"),
                                          "timings_ms": turn["timings_ms"], "outcome": turn["decision"].get("outcome"),
                                          "proposal": turn["decision"].get("proposal"), "reply": turn["reply"]}
    report["gpu_after"] = rocm_smi()

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0 if report["checks"]["llm"]["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
