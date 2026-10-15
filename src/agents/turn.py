"""AXONFAS · orquestador de un turno de voz (01 · Lógica, "Turno de voz").

voz → texto (Whisper) → alarma determinista → agente clínico → motor de reglas → frase para el paciente → voz (TTS).
Con una frase de alarma la sesión se detiene sin consultar al LLM (I-7).

Demo sin GPU:      py -m agents.turn --fake --text "Me dio un pinchazo en la ingle"
Contra la GPU:     py -m agents.turn --text "Me dio un pinchazo en la ingle" --voice --save respuesta.wav
(desde src/, con el túnel abierto por `axonfas-cloud.ps1 tunnel` y AXONFAS_LLM_KEY en el entorno)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import clinical, coach, safety
from .llm import FakeLLM, OpenAICompatible
from .voice import VoiceClient, VoiceError

DEMO_CTX = {
    "exercise_id": "sit-to-stand", "exercise_name": "Sentarse y pararse",
    "current": {"rom_target": 90, "reps": 7, "rest_seconds": 60},
    "envelope": {"rom_min": 60, "rom_max": 110, "max_reps": 10, "max_trunk_flex": 45, "pain_stop": True},
    "recent_reps": [{"index": 4, "kneeRom": 92}, {"index": 5, "kneeRom": 91}, {"index": 6, "kneeRom": 88}],
}

DEMO_LLM = FakeLLM({
    "pinchazo": '{"action": "adjust", "param": "rom_target", "old": 90, "new": 70, '
                '"reason": "molestia leve en la ingle: bajar el rango para que sea tolerable"}',
    "cansad": '{"action": "adjust", "param": "rest_seconds", "old": 60, "new": 90, "reason": "fatiga: más descanso"}',
    "más rápido": '{"action": "adjust", "param": "rom_target", "old": 90, "new": 130, "reason": "pide más exigencia"}',
}, default='{"action": "none", "reason": "sin molestias"}')


def run_turn(llm, utterance: str, ctx: dict, *, voice: VoiceClient | None = None, audio: bytes | None = None,
             tts_voice: str = "ef_dora") -> dict:
    t0 = time.perf_counter()
    out: dict = {"timings_ms": {}}
    if audio is not None and voice is not None:
        stt = voice.stt(audio)
        utterance = stt["text"]
        out["timings_ms"]["stt"] = stt.get("ms")
    out["utterance"] = utterance
    flag = safety.red_flag(utterance)
    if flag:
        decision = {"red_flag": flag, "proposal": None, "within_envelope": False, "outcome": "session_stopped",
                    "end_reason": "pain_stop", "note": "frase de alarma: se detiene la sesión sin consultar al LLM (I-7)"}
    else:
        decision = clinical.propose(llm, utterance, ctx)
        out["timings_ms"]["clinical_llm"] = decision.get("llm_ms")
    said = coach.reply(None if flag else llm, utterance, decision)
    out["timings_ms"]["coach_llm"] = said.get("llm_ms")
    out.update(decision=decision, reply=said["text"], reply_source=said["source"])
    if voice is not None:
        try:
            tts = voice.tts(said["text"], voice=tts_voice)
            out["timings_ms"]["tts"] = tts["ms"]
            out["reply_audio_seconds"] = tts["seconds"]
            out["_wav"] = tts["wav"]
        except VoiceError as err:
            out["tts_error"] = str(err)
    out["timings_ms"]["total"] = round((time.perf_counter() - t0) * 1000)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Un turno de voz de AXONFAS (datos sintéticos).")
    p.add_argument("--text", default="Me dio un pinchazo en la ingle")
    p.add_argument("--audio", type=Path, help="WAV con la voz del paciente (en vez de --text)")
    p.add_argument("--fake", action="store_true", help="LLM de mentira, sin GPU")
    p.add_argument("--voice", action="store_true", help="usa el servidor de voz de la GPU (Whisper y TTS)")
    p.add_argument("--save", type=Path, help="guarda la respuesta hablada en este WAV")
    args = p.parse_args(argv)
    llm = DEMO_LLM if args.fake else OpenAICompatible()
    voice = VoiceClient() if (args.voice or args.audio) and not args.fake else None
    audio = args.audio.read_bytes() if args.audio else None
    result = run_turn(llm, args.text, DEMO_CTX, voice=voice, audio=audio)
    wav = result.pop("_wav", None)
    if wav and args.save:
        args.save.write_bytes(wav)
        result["saved"] = str(args.save)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
