"""AXONFAS · resumen con IA de las sugerencias para el fisioterapeuta (ADR-017).

Las sugerencias las calculan reglas deterministas (suggestions.js). El LLM solo puede resumirlas en un párrafo para el
fisioterapeuta, priorizando lo urgente. Se descarta su texto si trae números que no están en los datos, si nombra un
ejercicio que no está ni en el plan ni en las sugerencias, o si pasa de 90 palabras. Nunca aplica nada.
"""
from __future__ import annotations

import json

from .coach import MEDICAL, numbers
from .llm import LLMError
from .safety import normalize

SYSTEM = """Eres el asistente de AXONFAS para fisioterapeutas. Te doy el perfil de un paciente y las sugerencias que ya
calcularon las reglas del sistema. Escribe en español un resumen de 2 a 4 frases (máximo 90 palabras) que diga qué
revisar primero y por qué. No agregues sugerencias nuevas, no diagnostiques, no uses números que no estén en los datos y
no nombres ejercicios que no aparezcan en los datos. Responde solo con el resumen."""


def summarize(llm, profile: dict | None, suggestions: list[dict], exercise_names: list[str]) -> dict:
    """{text, source: 'llm'} si el LLM cumple las reglas; si no, {text: None, source: 'rejected' | 'unavailable', reason}."""
    data = {"perfil": profile or {}, "sugerencias": [{k: s.get(k) for k in ("title", "detail", "because", "priority")} for s in suggestions[:12]],
            "ejercicios": exercise_names}
    raw = json.dumps(data, ensure_ascii=False)
    try:
        out = llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": raw}], max_tokens=200, temperature=0.2)
    except LLMError as err:
        return {"text": None, "source": "unavailable", "reason": str(err)}
    text = (out.get("text") or "").strip()
    if not text or len(text.split()) > 90:
        return {"text": None, "source": "rejected", "reason": "el resumen está vacío o es demasiado largo"}
    if MEDICAL.search(normalize(text)):
        return {"text": None, "source": "rejected", "reason": "el resumen nombra medicamentos o diagnósticos"}
    if not numbers(text) <= numbers(raw):
        return {"text": None, "source": "rejected", "reason": "el resumen trae cifras que no están en los datos"}
    return {"text": text, "source": "llm", "ms": out.get("ms")}


def mentions_unknown(text: str, known: list[str], catalog: list[str]) -> list[str]:
    """Ejercicios del catálogo que el texto nombra sin estar en `known` (el plan y las sugerencias)."""
    t = normalize(text)
    return [name for name in catalog if normalize(name) in t and name not in known]
