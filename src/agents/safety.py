"""AXONFAS · reglas deterministas que rodean a los agentes LLM (ADR-004, ADR-005).

Nada de este módulo usa un LLM:
- red_flag(): detecta en lo que dice el paciente dolor agudo, mareo o pérdida de fuerza súbita. Si aparece, la sesión se
  detiene y el agente no se consulta (I-7).
- validate(): decide si una propuesta del agente {param, old, new, reason} cabe en el sobre del fisioterapeuta. Solo
  `applied` con `within_envelope = True` (I-2); fuera del sobre se pausa y se escala al terapeuta.
"""
from __future__ import annotations

import re
import unicodedata

# Parámetros que el agente puede proponer y sus límites fijos (además de los del sobre).
PARAMS = {
    "rom_target": {"unit": "deg", "min": 10, "max": 140},      # rango pedido; el sobre lo acota con rom_min / rom_max
    "reps": {"unit": "reps", "min": 1, "max": 50},              # repeticiones restantes de la serie; tope max_reps
    "rest_seconds": {"unit": "s", "min": 10, "max": 180},      # descanso entre series
}

# Frases de alarma (sin tildes, en minúsculas). Ante la duda, detener: un falso positivo solo corta una sesión.
RED_FLAGS = [
    r"dolor (muy )?(agudo|fuerte|intenso|insoportable)",
    r"\bmare(o|ad[oa]|a|ando)\b|\bme mareo\b|todo me da vueltas",
    r"(perd[i]|pierdo|perdiendo) (la )?fuerza|se me (fue|va) la fuerza|debilidad (repentina|subita)|no siento (la|el|las|los) ",
    r"desmay",
    r"dolor (en el|de) pecho|me duele el pecho",
    r"no puedo respirar|falta de aire|me ahogo",
    r"\bcrujio\b|algo se rompio|escuche un (crack|chasquido)",
]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in text if unicodedata.category(c) != "Mn").lower()


def red_flag(text: str) -> str | None:
    """La frase de alarma que aparece en `text`, o None. Determinista: no depende del LLM."""
    t = normalize(text)
    for pattern in RED_FLAGS:
        m = re.search(pattern, t)
        if m:
            return m.group(0)
    return None


def envelope_limits(envelope: dict, param: str) -> tuple[float, float]:
    """Límites del parámetro según los fijos y el sobre del fisioterapeuta."""
    base = PARAMS[param]
    lo, hi = float(base["min"]), float(base["max"])
    if param == "rom_target":
        if isinstance(envelope.get("rom_min"), (int, float)):
            lo = max(lo, float(envelope["rom_min"]))
        if isinstance(envelope.get("rom_max"), (int, float)):
            hi = min(hi, float(envelope["rom_max"]))
    elif param == "reps" and isinstance(envelope.get("max_reps"), (int, float)):
        hi = min(hi, float(envelope["max_reps"]))
    return lo, hi


def validate(proposal: dict, envelope: dict, current: dict) -> dict:
    """Decisión del motor de reglas sobre una propuesta del agente, con la forma de `agent_decision`.

    - Forma inválida, parámetro desconocido o `old` que no coincide con el valor actual → `rejected`.
    - Valor nuevo fuera del sobre → `escalated_to_therapist` (se pausa el ejercicio).
    - Dentro del sobre → `applied`.
    """
    decision = {"proposal": proposal, "within_envelope": False, "outcome": "rejected", "note": ""}
    if not envelope:
        decision["note"] = "sin sobre de seguridad no se ajusta nada (I-3)"
        return decision
    if not isinstance(proposal, dict) or not {"param", "old", "new", "reason"} <= set(proposal):
        decision["note"] = "la propuesta no tiene la forma {param, old, new, reason}"
        return decision
    param = proposal["param"]
    if param not in PARAMS:
        decision["note"] = f"parámetro no permitido: {param!r}"
        return decision
    new = proposal["new"]
    if isinstance(new, bool) or not isinstance(new, (int, float)):
        decision["note"] = "el valor nuevo no es un número"
        return decision
    if param in current and proposal["old"] != current[param]:
        decision["note"] = f"'old' ({proposal['old']}) no coincide con el valor actual ({current[param]})"
        return decision
    if not str(proposal.get("reason") or "").strip():
        decision["note"] = "la propuesta no explica el motivo"
        return decision
    lo, hi = envelope_limits(envelope, param)
    if lo <= float(new) <= hi:
        decision.update(within_envelope=True, outcome="applied", note=f"dentro del sobre [{lo:g}, {hi:g}]")
    else:
        decision.update(outcome="escalated_to_therapist",
                        note=f"fuera del sobre [{lo:g}, {hi:g}]: se pausa el ejercicio y lo revisa el fisioterapeuta")
    return decision
