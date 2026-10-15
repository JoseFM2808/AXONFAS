"""AXONFAS · agente conversacional: la frase corta que el paciente escucha (ADR-007).

La frase dice lo que el motor de reglas decidió, nunca otra cosa. El LLM solo la hace más natural; si su versión trae un
número que no está en la decisión, o es demasiado larga, se usa la plantilla.
"""
from __future__ import annotations

import re

from .llm import LLMError

STOP_TEXT = "Detenemos la sesión. Si el malestar sigue, contacta a tu fisioterapeuta."
PARAM_TEXT = {"rom_target": "baja solo hasta {new} grados", "reps": "hagamos {new} repeticiones más",
              "rest_seconds": "descansa {new} segundos entre series"}
NUM = re.compile(r"\d+(?:[.,]\d+)?")


def template(decision: dict) -> str:
    if decision.get("red_flag"):
        return STOP_TEXT
    outcome = decision.get("outcome")
    proposal = decision.get("proposal") or {}
    if outcome == "applied":
        new = proposal.get("new")
        new = int(new) if isinstance(new, float) and new.is_integer() else new
        what = PARAM_TEXT.get(proposal.get("param"), "ajustamos tu sesión").format(new=new)
        return f"Entendido. Para que no moleste, {what}. Si el dolor aumenta, toca Dolor y paramos."
    if outcome == "escalated_to_therapist":
        return "Pausamos este ejercicio y se lo avisamos a tu fisioterapeuta. Descansa un momento."
    return "Entendido. Seguimos igual; si algo te molesta, dímelo o toca Dolor para parar."


def numbers(text: str) -> set[str]:
    return {n.replace(",", ".").rstrip("0").rstrip(".") for n in NUM.findall(text or "")}


def reply(llm, utterance: str, decision: dict) -> dict:
    """Frase para el paciente (≤ 30 palabras). Con alarma o sin LLM, la plantilla fija."""
    base = template(decision)
    if decision.get("red_flag") or llm is None:
        return {"text": base, "source": "template", "llm_ms": None}
    messages = [
        {"role": "system", "content": "Eres la voz de AXONFAS. Reescribe el mensaje en español, cálido y claro, en una "
                                      "o dos frases y máximo 30 palabras. No agregues información, consejos médicos "
                                      "ni números nuevos. Responde solo con la frase."},
        {"role": "user", "content": f"El paciente dijo: «{utterance}». Mensaje a reescribir: «{base}»"},
    ]
    try:
        out = llm.chat(messages, max_tokens=80, temperature=0.4)
    except LLMError:
        return {"text": base, "source": "template", "llm_ms": None}
    text = (out["text"] or "").strip().strip("«»\"")
    ok = bool(text) and not text.startswith("{") and len(text.split()) <= 30 and numbers(text) <= numbers(base)
    return {"text": text if ok else base, "source": "llm" if ok else "template", "llm_ms": out["ms"]}
