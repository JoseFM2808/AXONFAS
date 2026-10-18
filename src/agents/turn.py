"""AXONFAS · orquestador de un turno de voz (01 · Lógica, "Turno de voz").

voz → texto (Whisper) → alarma determinista → agente clínico → motor de reglas → frase para el paciente → voz (TTS).
Con una frase de alarma la sesión se detiene sin consultar al LLM (I-7).

Demo sin GPU:      py -m agents.turn --fake --text "Me dio un pinchazo en la ingle"
Medir la IA:       py -m agents.turn --measure 10 --with-coach   (en la terminal del owner, con su clave en el entorno)
Contra la GPU:     py -m agents.turn --text "Me dio un pinchazo en la ingle" --voice --save respuesta.wav
(desde src/, con el túnel abierto por `axonfas-cloud.ps1 tunnel` y AXONFAS_LLM_KEY en el entorno)
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
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
    out["symptom"] = safety.symptom_record(utterance, decision)     # Staging lo guarda con source voice_turn (ADR-025)
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


_POOL: ThreadPoolExecutor | None = None


def _default_pool() -> ThreadPoolExecutor:
    global _POOL
    if _POOL is None:
        _POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="axonfas-turn")
    return _POOL


def run_text_turn(clinical_llm, coach_llm, text: str, ctx: dict, *, monitored: bool, allowed: set[str] | None,
                  budget_s: float = 18.0, clinical_timeout_s: float = 12.0, coach_timeout_s: float = 5.0,
                  coach_if_under_s: float = 6.0, executor=None, provider: str | None = None, model: str | None = None) -> dict:
    """Turno de texto del paciente en Staging (ADR-025). El texto viene del formulario «Tengo una molestia», así que
    siempre cuenta como molestia declarada: el agente solo puede bajar la exigencia, y solo parámetros de `allowed`.

    Orden fijo: 1) alarma por reglas, sin consultar a ningún LLM (I-7); 2) agente clínico solo si la sesión está
    monitoreada (tiene sobre) y hay LLM, con tiempo límite; 3) sin respuesta a tiempo o sin LLM, deciden las reglas;
    4) frase del agente conversacional con lo que sobra del presupuesto, y solo si el clínico no tardó más de
    `coach_if_under_s` (el conversacional nunca acorta al clínico). El hilo que se pasa del tiempo se abandona.
    Devuelve {decision, reply, reply_source, ai, timings_ms}; nunca el texto crudo del LLM."""
    t0 = time.perf_counter()
    executor = executor or _default_pool()
    left = lambda: budget_s - (time.perf_counter() - t0)
    flag = safety.red_flag(text)
    error = None
    clinical_called = False
    if flag:
        decision = {"red_flag": flag, "proposal": None, "within_envelope": False, "outcome": "session_stopped",
                    "end_reason": "pain_stop", "note": "frase de alarma: se detiene la sesión sin consultar al LLM (I-7)",
                    "source": "rules"}
    elif monitored and clinical_llm is not None:
        clinical_called = True
        future = executor.submit(clinical.propose, clinical_llm, text, ctx, discomfort_reported=True, allowed=allowed)
        try:
            decision = future.result(timeout=min(clinical_timeout_s, budget_s))
        except FutureTimeout:
            future.cancel()                                # si todavía esperaba un hilo libre, ya no llama al LLM
            error = "timeout"
            decision = clinical.rules_only(text, ctx, discomfort_reported=True, allowed=allowed, why="la IA no respondió a tiempo")
            decision["llm_outcome"] = "timeout"
        except Exception:                                  # un fallo del agente nunca llega al paciente: deciden las reglas
            error = "llm_error"
            decision = clinical.rules_only(text, ctx, discomfort_reported=True, allowed=allowed, why="la IA falló")
            decision["llm_outcome"] = "llm_error"
        else:
            if decision.get("llm_ms") is None:             # el LLM no contestó (LLMError dentro del agente)
                error = "llm_error"
                decision["llm_outcome"] = "llm_error"
    else:
        decision = clinical.rules_only(text, ctx, discomfort_reported=True, allowed=allowed,
                                       why="ejercicio sin sobre de seguridad" if not monitored else "sin IA: decide el motor de reglas")
    decision.pop("raw", None)
    clinical_ms = decision.get("llm_ms")
    reply_llm = None if flag else coach_llm
    said = None
    slow = clinical_ms is not None and clinical_ms > coach_if_under_s * 1000      # el clínico ya gastó la espera razonable
    if reply_llm is not None and error is None and not slow and left() >= 1.0:       # si el proveedor falló, no se vuelve a esperar
        future = executor.submit(coach.reply, reply_llm, text, decision)
        try:
            said = future.result(timeout=min(coach_timeout_s, left()))
        except FutureTimeout:
            future.cancel()
            error = error or "timeout"
        except Exception:
            error = error or "llm_error"
    if said is None:
        said = {"text": coach.template(decision), "source": "template", "llm_ms": None}
    called = clinical_called or (reply_llm is not None)
    ai = {"provider": provider if called else None, "model": model if called else None, "clinical_ms": clinical_ms,
          "coach_ms": said.get("llm_ms"), "decided_by": decision.get("source") or "rules",
          "phrased_by": "llm" if said["source"] == "llm" else "rules", "llm_answered": clinical_ms is not None,
          "skipped": "red_flag" if flag else (None if monitored else "guided"), "error": error}
    return {"decision": decision, "reply": said["text"], "reply_source": said["source"], "ai": ai,
            "timings_ms": {"total": round((time.perf_counter() - t0) * 1000)}}


MEASURE_TEXTS = ["me molesta la rodilla", "estoy cansado", "la rodilla no va bien", "siento un pinchazo en la ingle",
                 "me cuesta pararme", "tengo una molestia en el muslo"]
MEASURE_MAX = 20                                       # tope por el cupo de la clave del equipo (TD-108)


def _percentiles(values: list[float]) -> dict | None:
    if not values:
        return None
    vs = sorted(values)
    p95 = statistics.quantiles(vs, n=20, method="inclusive")[18] if len(vs) >= 2 else vs[0]
    return {"p50": round(statistics.median(vs)), "p95": round(p95), "max": round(vs[-1])}


def _clamp(value: float, lo: float, hi: float) -> int:
    return int(min(hi, max(lo, math.ceil(value))))


def measure(n: int, *, with_coach: bool = False, gap: float = 3.0, save: bool = False, out=None) -> int:
    """Mide la latencia del turno contra el proveedor configurado y sugiere los tiempos (`AXONFAS_TURN_*`). Frases
    sintéticas fijas. Imprime JSON sin la clave ni la dirección; sin proveedor, dice qué variables faltan (sin valores)."""
    out = out or sys.stdout
    from . import llm as llm_module, providers
    if not providers.config():
        json.dump({"error": "sin proveedor de IA", "missing": providers.missing()}, out, ensure_ascii=False, indent=2)
        out.write("\n")
        return 2
    client = providers.client("measure", timeout=20, retries_429=0)
    clinical_ms: list[float] = []
    coach_ms: list[float] = []
    tokens: list[int] = []
    counts = {"ok": 0, "errors": 0, "http_429": 0, "valid_json": 0, "applied": 0}
    for i in range(n):
        if i and gap > 0:
            time.sleep(gap)                            # no gastar el cupo de la clave del equipo de golpe
        text = MEASURE_TEXTS[i % len(MEASURE_TEXTS)]
        before = providers.usage()
        decision = clinical.propose(client, text, DEMO_CTX, discomfort_reported=True, allowed={"rom_target", "reps"})
        after = providers.usage()
        if decision.get("llm_ms") is None:
            counts["errors"] += 1
            # La nota final puede ser la del motor de reglas (respaldo de ADR-021): el 429 se lee del contador de uso.
            counts["http_429"] += after["errors"] > before["errors"] and "429" in str(after.get("last_error") or "")
            continue
        counts["ok"] += 1
        clinical_ms.append(decision["llm_ms"])
        tokens.append((after["completion_tokens"] or 0) - (before["completion_tokens"] or 0))
        # JSON inválido = el LLM no dio propuesta ni "none": con respaldo de reglas, su resultado queda en llm_outcome.
        llm_outcome = decision.get("llm_outcome", decision.get("outcome")) if decision.get("source") == "rules" else decision.get("outcome")
        llm_proposal = (decision.get("llm_proposal", decision.get("proposal")) if decision.get("source") == "rules"
                        else decision.get("proposal"))
        counts["valid_json"] += not (llm_outcome == "rejected" and llm_proposal is None)
        counts["applied"] += decision.get("source") == "llm" and decision.get("outcome") == "applied"
        if with_coach:
            said = coach.reply(client, text, decision)
            if said.get("llm_ms") is not None:
                coach_ms.append(said["llm_ms"])
    clin, talk = _percentiles(clinical_ms), _percentiles(coach_ms)
    suggested_clinical = _clamp(clin["p95"] / 1000 * 1.5, 8, 15) if clin else 12
    suggested_coach = _clamp(talk["p95"] / 1000 * 1.5, 2, 8) if talk else 5
    result = {"provider": client.label, "model": client.model, "n": n, **counts,
              "json_mode_fallback": client.inner.url in llm_module._NO_JSON_MODE,
              "clinical_ms": clin, "coach_ms": talk,
              "completion_tokens_p95": _percentiles(tokens)["p95"] if tokens else None,
              "suggested": {"TURN_CLINICAL_S": suggested_clinical, "TURN_COACH_S": suggested_coach,
                            "TURN_BUDGET_S": suggested_clinical + suggested_coach + 1}}
    json.dump(result, out, ensure_ascii=False, indent=2)
    out.write("\n")
    if save:
        target = Path.home() / ".axonfas" / "results" / "turn-latency.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Un turno de voz de AXONFAS (datos sintéticos).")
    p.add_argument("--text", default="Me dio un pinchazo en la ingle")
    p.add_argument("--audio", type=Path, help="WAV con la voz del paciente (en vez de --text)")
    p.add_argument("--fake", action="store_true", help="LLM de mentira, sin GPU")
    p.add_argument("--voice", action="store_true", help="usa el servidor de voz de la GPU (Whisper y TTS)")
    p.add_argument("--save", type=Path, help="guarda la respuesta hablada en este WAV")
    p.add_argument("--measure", type=int, metavar="N", help=f"mide la latencia con N turnos sintéticos (1 a {MEASURE_MAX}); gasta cupo")
    p.add_argument("--with-coach", action="store_true", help="con --measure: mide también al agente conversacional")
    p.add_argument("--gap", type=float, default=3.0, help="con --measure: segundos entre llamadas")
    p.add_argument("--save-measure", action="store_true", help="con --measure: guarda el resultado en ~/.axonfas/results/")
    args = p.parse_args(argv)
    if args.measure is not None:
        if not 1 <= args.measure <= MEASURE_MAX:
            print(f"--measure: máximo {MEASURE_MAX} (cuida el cupo de la clave del equipo).", file=sys.stderr)
            return 2
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
        import settings                                          # ~/.axonfas/axonfas.env (ADR-018)
        settings.load_env_file()
        return measure(args.measure, with_coach=args.with_coach, gap=args.gap, save=args.save_measure)
    if args.fake:
        llm = DEMO_LLM
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
        import settings                                          # ~/.axonfas/axonfas.env (ADR-018)
        settings.load_env_file()
        from . import providers
        llm = providers.client("cli") or OpenAICompatible()
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
