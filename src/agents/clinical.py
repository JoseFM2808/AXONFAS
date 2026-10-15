"""AXONFAS · agente clínico (bucle lento, ADR-004/005/007).

Lee lo que dijo el paciente y cómo van las repeticiones, y puede proponer UN ajuste {param, old, new, reason}. No aplica
nada: la propuesta pasa por safety.validate(), que es determinista. Si el LLM falla o responde algo inválido, no hay
cambio y queda registrado.
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
{"action": "adjust", "param": "...", "old": <valor actual>, "new": <valor nuevo>, "reason": "<motivo breve en español>"}
Formato si no hace falta cambiar nada:
{"action": "none", "reason": "<motivo breve en español>"}

Reglas:
- No diagnosticas ni recetas. Solo ajustas la sesión para que sea segura y tolerable.
- Ante una molestia leve (por ejemplo, un pinchazo), baja la exigencia: menos rango o menos repeticiones.
- "old" debe ser exactamente el valor actual que te doy.
- Respeta el sobre de seguridad del fisioterapeuta; el motor de reglas rechaza lo que salga de él.
- Nunca inventes datos del paciente."""


def build_messages(utterance: str, ctx: dict) -> list[dict]:
    context = {
        "ejercicio": ctx.get("exercise_name") or ctx.get("exercise_id"),
        "valores_actuales": ctx.get("current", {}),
        "sobre_de_seguridad": ctx.get("envelope", {}),
        "ultimas_repeticiones": ctx.get("recent_reps", [])[-5:],
    }
    user = f"Contexto de la sesión:\n{json.dumps(context, ensure_ascii=False)}\n\nEl paciente dijo: «{utterance}»"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def propose(llm, utterance: str, ctx: dict) -> dict:
    """Pide una propuesta al LLM y la valida. Devuelve la decisión (forma de `agent_decision`) más tiempos y texto crudo."""
    try:
        reply = llm.chat(build_messages(utterance, ctx), json_mode=True, max_tokens=160)
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
    decision = safety.validate(proposal, ctx.get("envelope") or {}, ctx.get("current") or {})
    return {**base, **decision, "action": "adjust"}
