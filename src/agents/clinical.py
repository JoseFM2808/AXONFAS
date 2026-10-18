"""AXONFAS · agente clínico (bucle lento, ADR-004/005/007).

Lee lo que dijo el paciente y cómo van las repeticiones, y puede proponer UN ajuste {param, old, new, reason}. No aplica
nada: la propuesta pasa por safety.validate(), que es determinista. Si el LLM falla o responde algo inválido, no hay
cambio y queda registrado. Ante una molestia del paciente, si el LLM no propone una baja válida, la propone el motor de
reglas (safety.reduce_demand) dentro del sobre; sin nada que bajar se pausa y se avisa (ADR-021).
"""
from __future__ import annotations

import json

from . import safety
from .llm import LLMError, parse_json

SYSTEM = """Eres el agente clínico de AXONFAS, fisioterapia en casa supervisada por una clínica.
Respondes SOLO con un objeto JSON, sin texto alrededor.

Puedes proponer como máximo UN ajuste de la sesión, y solo de estos parámetros:
- "rom_target": rango de movimiento pedido, en grados.
- "reps": repeticiones que faltan en la serie.
- "rest_seconds": descanso entre series, en segundos.

Formato si propones un ajuste:
{"action": "adjust", "param": "...", "old": <valor actual>, "new": <valor nuevo>, "reason": "<motivo breve en español, máximo 12 palabras>"}
Formato si no hace falta cambiar nada:
{"action": "none", "reason": "<motivo breve en español>"}

Reglas:
- No diagnosticas ni recetas. Solo ajustas la sesión para que sea segura y tolerable.
- Ante una molestia leve (por ejemplo, un pinchazo), baja la exigencia: menos rango o menos repeticiones.
- "old" debe ser exactamente el valor actual que te doy.
- Respeta el sobre de seguridad del fisioterapeuta; el motor de reglas rechaza lo que salga de él.
- Nunca inventes datos del paciente."""


def build_messages(utterance: str, ctx: dict, *, discomfort_reported: bool = False, allowed: set[str] | None = None) -> list[dict]:
    context = {
        "ejercicio": ctx.get("exercise_name") or ctx.get("exercise_id"),
        "valores_actuales": ctx.get("current", {}),
        "sobre_de_seguridad": ctx.get("envelope", {}),
        "ultimas_repeticiones": ctx.get("recent_reps", [])[-5:],
    }
    if allowed is not None:                                 # lo que la pantalla del paciente sabe aplicar (ADR-025)
        context["parametros_que_puedes_ajustar"] = sorted(allowed)
    user = f"Contexto de la sesión:\n{json.dumps(context, ensure_ascii=False, separators=(",", ":"))}\n\nEl paciente dijo: «{utterance}»"
    if discomfort_reported:
        user += "\n\nEl paciente avisó una molestia: solo puedes bajar la exigencia."
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def propose(llm, utterance: str, ctx: dict, *, discomfort_reported: bool = False, allowed: set[str] | None = None) -> dict:
    """Pide una propuesta al LLM y la valida; ante una molestia, el motor de reglas respalda al LLM (ADR-021).
    `discomfort_reported` marca el turno del formulario «Tengo una molestia» aunque el texto no traiga una palabra de
    molestia, y `allowed` limita los parámetros a los que la pantalla puede aplicar (ADR-025).
    Devuelve la decisión (forma de `agent_decision`) más tiempos y texto crudo."""
    return _protect(_ask(llm, utterance, ctx, discomfort_reported, allowed), utterance, ctx, discomfort_reported, allowed)


def rules_only(utterance: str, ctx: dict, *, discomfort_reported: bool = False, allowed: set[str] | None = None,
               why: str = "sin IA: decide el motor de reglas") -> dict:
    """La misma decisión sin consultar a ningún LLM: el respaldo de reglas de `_protect` sobre una respuesta vacía."""
    base = {"proposal": None, "within_envelope": False, "outcome": "rejected", "note": why, "action": "none", "llm_ms": None}
    return _protect(base, utterance, ctx, discomfort_reported, allowed)


def _protect(decision: dict, utterance: str, ctx: dict, discomfort_reported: bool = False, allowed: set[str] | None = None) -> dict:
    """Con molestia, la exigencia nunca queda igual si el sobre permite bajarla, haya respondido bien o mal el LLM."""
    if not (safety.discomfort(utterance) or discomfort_reported):
        return {**decision, "source": "llm"}
    if decision.get("outcome") == "applied":              # el LLM propuso una baja válida
        return {**decision, "source": "llm"}
    envelope, current = ctx.get("envelope") or {}, ctx.get("current") or {}
    fallback = safety.reduce_demand(envelope, current)
    if fallback is None:                                    # no hay qué bajar: se pausa y se avisa
        return {**decision, "paused": True, "source": "rules"}
    return {**safety.validate(fallback, envelope, current, utterance, allowed=allowed, discomfort_reported=discomfort_reported),
            "action": "adjust", "source": "rules",
            "llm_outcome": decision.get("outcome"), "llm_proposal": decision.get("proposal"),
            "llm_ms": decision.get("llm_ms"), "raw": decision.get("raw")}


def _ask(llm, utterance: str, ctx: dict, discomfort_reported: bool = False, allowed: set[str] | None = None) -> dict:
    try:
        reply = llm.chat(build_messages(utterance, ctx, discomfort_reported=discomfort_reported, allowed=allowed),
                         json_mode=True, max_tokens=160)
    except LLMError as err:
        return {"proposal": None, "within_envelope": False, "outcome": "rejected", "note": f"sin respuesta del LLM: {err}",
                "action": "none", "llm_ms": None, "raw": None}
    data = parse_json(reply["text"])
    base = {"llm_ms": reply["ms"], "raw": reply["text"]}
    if not data or data.get("action") not in ("adjust", "none"):
        return {**base, "proposal": None, "within_envelope": False, "outcome": "rejected", "action": "none",
                "note": "el LLM no devolvió un JSON válido: no se cambia nada"}
    if data["action"] == "none":
        return {**base, "proposal": None, "within_envelope": True, "outcome": "none", "action": "none",
                "note": str(data.get("reason") or "sin cambios")}
    proposal = {k: data.get(k) for k in ("param", "old", "new", "reason")}
    decision = safety.validate(proposal, ctx.get("envelope") or {}, ctx.get("current") or {}, utterance, allowed=allowed,
                               discomfort_reported=discomfort_reported)
    return {**base, **decision, "action": "adjust"}
