"""AXONFAS · reglas deterministas que rodean a los agentes LLM (ADR-004, ADR-005).

Nada de este módulo usa un LLM:
- red_flag(): detecta en lo que dice el paciente dolor agudo, mareo o pérdida de fuerza súbita. Si aparece, la sesión se
  detiene y el agente no se consulta (I-7).
- validate(): decide si una propuesta del agente {param, old, new, reason} cabe en el sobre del fisioterapeuta. Solo
  `applied` con `within_envelope = True` (I-2); fuera del sobre se pausa y se escala al terapeuta. Sin el límite del
  fisioterapeuta para ese parámetro (rom_min y rom_max para el rango, max_reps para las repeticiones) no se ajusta
  nada (I-3). `rest_seconds` es la excepción: el contrato del sobre no tiene descanso y solo rigen los límites fijos.
  Tras una molestia del paciente, solo se acepta bajar la exigencia; lo contrario se escala (ADR-021).
- classify_symptom(), reduce_demand(), symptom_record(): ante una molestia, el motor de reglas baja la exigencia por su
  cuenta, siempre dentro del sobre, y deja el registro que Staging guarda y avisa al fisioterapeuta (ADR-021).
- agent_envelope(): traduce el sobre que guarda la API de Staging al contrato del agente.
"""
from __future__ import annotations

import math
import re
import unicodedata

# Parámetros que el agente puede proponer y sus límites fijos (además de los del sobre: rom_target exige rom_min y
# rom_max, reps exige max_reps; rest_seconds solo tiene los fijos).
PARAMS = {
    "rom_target": {"unit": "deg", "min": 10, "max": 140},      # rango pedido; el sobre lo acota con rom_min / rom_max
    "reps": {"unit": "reps", "min": 1, "max": 50},              # repeticiones restantes de la serie; tope max_reps
    "rest_seconds": {"unit": "s", "min": 10, "max": 180},      # descanso entre series
}

# Frases de alarma (sin tildes, en minúsculas). Ante la duda, detener: un falso positivo solo corta una sesión. Por eso la
# negación no se usa aquí ("no me caí" también detiene) y las frases discutibles quedan para después (TD-127).
RED_FLAGS = [
    r"dolor (muy )?(agudo|fuerte|intenso|insoportable|punzante|terrible|horrible)",
    r"me duele (much[io]simo|demasiado|horrible|un monton|mucho)",
    r"\bmare(o|os|e|ad[oa]s?|a|ando|andome)\b|\bme mareo\b|todo me da vueltas",
    r"(perd[i]|pierdo|perdiendo) (la )?fuerza|se me (fue|va) la fuerza|perdida (subita |repentina )?de (la )?fuerza|fuerza (subita|repentina)",
    r"no siento (la|el|las|los) ",
    r"(me siento|estoy|me noto) (muy )?debil|debilidad",
    r"se me (durmio|adormecio|entumecio|esta durmiendo) (la|el)|adormecid|entumecid|hormigue",
    r"se me (doblo|fue|vencio) la (rodilla|pierna)",
    r"no puedo (mover|sostener|levantar) (la|el|las|los|mi|mis) ",
    r"desmay",
    r"dolor (en el|de) pecho|me duele el pecho",
    r"no puedo respirar|falta de aire|me ahogo|me falta (el )?aire|no me entra (el )?aire|me quedo sin aire",
    r"\bcrujio\b|algo se rompio|escuche un (crack|chasquido)|senti un (crack|chasquido)",
    r"(presion|opresion|apreton) (en el|del) pecho|me aprieta el pecho",
    r"dolor de cabeza (muy )?(fuerte|intenso|horrible|terrible|insoportable)",
    r"(veo|vista) (borros|doble|nublad)|se me nubl(a|o) la vista|veo (todo )?(negro|borroso|doble)",
    r"palpitacion|taquicardia|el corazon (me )?(late|va) (muy )?(rapido|fuerte|raro)",
    r"(cara|boca) (torcida|chueca|dormida)|no puedo hablar|se me traba la lengua",
    # "me cayó bien" (frase hecha) también detiene: falso positivo conocido que se deja así a propósito hasta la
    # revisión con fisioterapeutas (TD-127). No aflojar este patrón sin esa revisión.
    r"\bme (cai|caigo|cayo)\b|me fui al (piso|suelo)",
    r"\bsangr(o|a|ando|ado|e)\b|sangrado|hemorragia",
    r"se me hinch\w*( \w+){0,3} (de golpe|de repente|mucho)|hinchazon (subita|repentina)",
    r"sudor frio",
    r"\bduele (muchisimo|demasiado|horrible|un monton)\b",
    # Inglés (ADR-030): la interfaz también está en inglés y el texto libre tiene que detener igual (I-7, I-22).
    r"\b(severe|sharp|intense|unbearable|stabbing|terrible|horrible|excruciating|acute) pain|pain is (severe|unbearable|terrible|horrible)",
    r"\bit hurts (so much|a lot|really bad|too much|badly|terribly)|\bhurts (really |so )?bad",
    r"\bdizz(y|iness)\b|\blight ?headed|\bvertigo\b|(room|everything) is spinning",
    r"\b(lost|losing|lose) (my |all )?(the )?strength|\bloss of strength|\bweakness\b|\b(i feel|i am|i[’']m|feeling) (very |really |so )?weak\b",
    r"\bnumb(ness)?\b|\btingl(e|ing)\b|pins and needles|\b(can[’']?t|cannot) feel (my|the) |\bwent numb",
    r"\b(knee|leg) (gave way|gave out|buckled)",
    r"\b(can[’']?t|cannot) (move|hold|lift) (my|the) ",
    r"\bfaint|\bpass(ed|ing)? out\b|\bblack(ed|ing)? out\b",
    r"\bchest pain|pain in (my|the) chest|my chest hurts",
    r"\b(can[’']?t|cannot) breathe|\bshort(ness)? of breath|\bout of breath",
    r"something (snapped|popped|broke|tore)|i heard a (crack|pop|snap)",
    # Inglés, equivalentes de las alarmas nuevas en español (merge con ADR-030): mismo criterio, ante la duda detener.
    r"\bcan[’']?t catch my breath|\b(hard|struggling) to breathe",
    r"\bchest (pressure|tightness)|(pressure|tightness) in (my|the) chest|\bmy chest (feels )?tight",
    r"\b(severe|bad|terrible|intense|splitting|worst) headache|\bmy head hurts (so much|a lot|really bad)",
    r"\bblurr(y|ed) vision|\bdouble vision|\bseeing double|\bmy vision (went|is going) (dark|black|blurry)",
    r"\bpalpitation|\bmy heart is (racing|pounding)|\bracing heart|\bheart is beating (so |very |really )?(fast|hard)",
    r"\bface (is )?droop|\bmouth is crooked|\bslurred speech|\bslurring|\b(can[’']?t|cannot) speak",
    r"\bi (fell|fall)\b|\bi[’']?ve fallen|\bfell (down|over)\b|\bhad a fall",
    r"\bbleed(ing)?\b|\bblood\b",
    r"\bswell(ed|ing) up (suddenly|all of a sudden)|\bsudden swelling",
    r"\bcold sweat",
    r"\bi felt a (crack|pop|snap)",
]


# Palabras de molestia (sin tildes). Con una de ellas en lo que dijo el paciente, el agente solo puede bajar la exigencia
# (ADR-021). No son alarmas: no detienen la sesión; solo cierran la puerta a subir la carga.
DISCOMFORT = [r"molest", r"duel", r"dolor", r"pinchaz", r"punzad", r"tiron", r"ardor", r"calambre", r"cansa(d|ncio)", r"fatig",
              r"agotad", r"me cuesta", r"no aguanto", r"rigid", r"incomod",
              # Inglés (ADR-030)
              r"\bsore", r"\bach(e|ing)", r"\bhurt", r"\bpain", r"\bpinch", r"\bburn", r"\bcramp", r"\btired",
              r"\bexhaust", r"\bstiff", r"\buncomfortable|\bdiscomfort"]
# Categoría del registro de molestia según la palabra (mismas claves que DISCOMFORT).
DISCOMFORT_CATEGORY = {r"molest": "pain", r"duel": "pain", r"dolor": "pain", r"pinchaz": "pain", r"punzad": "pain",
                       r"tiron": "pain", r"ardor": "pain", r"calambre": "cramp", r"cansa(d|ncio)": "fatigue",
                       r"fatig": "fatigue", r"agotad": "fatigue", r"me cuesta": "fatigue", r"no aguanto": "fatigue",
                       r"rigid": "stiffness", r"incomod": "other",
                       r"\bsore": "pain", r"\bach(e|ing)": "pain", r"\bhurt": "pain", r"\bpain": "pain", r"\bpinch": "pain",
                       r"\bburn": "pain", r"\bcramp": "cramp", r"\btired": "fatigue", r"\bexhaust": "fatigue",
                       r"\bstiff": "stiffness", r"\buncomfortable|\bdiscomfort": "other"}
# Valores de partida, no clínicos (TD-87): cuánto baja la reducción determinista.
ROM_STEP_DEG = 10
REPS_FACTOR = 0.7
# Signo en que cambia la exigencia al subir el valor: bajar el rango o las repeticiones, o subir el descanso, la baja.
LESS_DEMAND = {"rom_target": -1, "reps": -1, "rest_seconds": +1}


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


def discomfort(text: str | None) -> str | None:
    """La palabra de molestia que aparece en `text`, o None. Determinista, igual que red_flag()."""
    t = normalize(text or "")
    for pattern in DISCOMFORT:
        m = re.search(pattern, t)
        if m:
            return m.group(0)
    return None


# Palabras que niegan una molestia dentro de la misma frase ("no me duele", "sin dolor", "ya no duele", "nada de dolor").
NEGATORS = {"no", "sin", "ningun", "ninguna", "not", "without", "never", "don't", "doesn't", "isn't", "don’t", "doesn’t", "isn’t"}


def _negated(t: str, start: int) -> bool:
    """¿La palabra de molestia que empieza en `start` está negada en las 3 palabras anteriores de su misma frase?"""
    clause = re.split(r"[,.;:!?]", t[:start])[-1]
    words = re.findall(r"[\w'’]+", clause)[-3:]
    return any(w in NEGATORS for w in words) or "nada de" in " ".join(words)


def classify_symptom(text: str | None) -> dict | None:
    """{kind, category, match} de lo que dijo el paciente, o None. La alarma siempre gana sobre la molestia, aun negada
    ("no me mareo" detiene). La negación solo afecta a la categoría guardada de una molestia ("sin dolor" → other); no
    cambia la acción ni `discomfort()`, que sigue cerrando la puerta a subir la exigencia (ADR-021)."""
    flag = red_flag(text or "")
    if flag:
        return {"kind": "red_flag", "category": "red_flag", "match": flag}
    t = normalize(text or "")
    first = None
    for pattern in DISCOMFORT:
        m = re.search(pattern, t)
        if not m:
            continue
        first = first or m
        if not _negated(t, m.start()):
            return {"kind": "discomfort", "category": DISCOMFORT_CATEGORY[pattern], "match": m.group(0)}
    return {"kind": "discomfort", "category": "other", "match": first.group(0)} if first else None


def reduce_demand(envelope: dict, current: dict) -> dict | None:
    """Propuesta {param, old, new, reason} que baja la exigencia dentro del sobre, o None si no hay nada que bajar.

    Primero el rango (−ROM_STEP_DEG hacia rom_min), si no las repeticiones (× REPS_FACTOR, nunca más que max_reps). Nunca
    toca el descanso (es una recomendación, ADR-022) y nunca sale del sobre: pasa por validate() antes de devolverse."""
    envelope, current = envelope or {}, current or {}
    proposal = None
    rom = current.get("rom_target")
    if _number(rom) and _number(envelope.get("rom_min")) and _number(envelope.get("rom_max")) and envelope["rom_min"] < envelope["rom_max"]:
        new = min(envelope["rom_max"], max(envelope["rom_min"], rom - ROM_STEP_DEG))
        if new < rom:
            proposal = {"param": "rom_target", "old": rom, "new": new,
                        "reason": "molestia del paciente: se baja el rango (regla determinista, ADR-021)"}
    reps = current.get("reps")
    if proposal is None and _number(reps) and reps >= 2 and _number(envelope.get("max_reps")):
        new = max(1, min(envelope["max_reps"], math.floor(reps * REPS_FACTOR)))
        if new < reps:
            proposal = {"param": "reps", "old": reps, "new": new,
                        "reason": "molestia del paciente: se bajan las repeticiones (regla determinista, ADR-021)"}
    if proposal is None or validate(proposal, envelope, current, "molestia")["outcome"] != "applied":
        return None
    return proposal


def symptom_action(decision: dict) -> tuple[str, dict | None]:
    """Acción y ajuste que deja la decisión de un turno con molestia: (`session_stopped`, None) con alarma,
    (`demand_lowered`, {param, old, new}) si se aplicó una baja, y (`paused`, None) en cualquier otro caso."""
    if decision.get("red_flag") or decision.get("outcome") == "session_stopped":
        return "session_stopped", None
    p = decision.get("proposal")
    if decision.get("outcome") == "applied" and p:
        return "demand_lowered", {"param": p["param"], "old": p["old"], "new": p["new"]}
    return "paused", None


def symptom_record(text: str | None, decision: dict) -> dict | None:
    """Registro de la molestia de un turno de voz, o None si el paciente no se quejó. Staging lo guarda con source
    'voice_turn' (ADR-033)."""
    found = classify_symptom(text)
    if not found:
        return None
    action, adjustment = ("session_stopped", None) if found["kind"] == "red_flag" else symptom_action(decision)
    return {"kind": found["kind"], "category": found["category"], "text": (text or "").strip()[:200], "action": action,
            "adjustment": adjustment}


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def agent_envelope(staging_envelope: dict | None) -> dict:
    """Sobre de Staging {trunk_margin, valgus_margin, max_reps, rom_min?, rom_max?} → sobre del agente
    {rom_min?, rom_max?, max_reps, trunk_margin, valgus_margin, pain_stop: True}. Vacío si el plan no tiene sobre
    (ejercicio guiado: `validate` rechaza por I-3). No inventa rom_min / rom_max si faltan; pain_stop siempre es True (I-7)."""
    if not staging_envelope:
        return {}
    out = {k: staging_envelope[k] for k in ("rom_min", "rom_max", "max_reps", "trunk_margin", "valgus_margin")
           if _number(staging_envelope.get(k))}
    out["pain_stop"] = True
    return out


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


def validate(proposal: dict, envelope: dict, current: dict, utterance: str | None = None, *, allowed: set[str] | None = None,
             discomfort_reported: bool = False) -> dict:
    """Decisión del motor de reglas sobre una propuesta del agente, con la forma de `agent_decision`.

    - Forma inválida, parámetro desconocido, parámetro que la pantalla no puede aplicar (`allowed`, ADR-033) o `old` que
      no coincide con el valor actual → `rejected`.
    - Valor nuevo fuera del sobre → `escalated_to_therapist` (se pausa el ejercicio).
    - Dentro del sobre → `applied`, salvo que el paciente se haya quejado (`utterance` con palabra de molestia, o
      `discomfort_reported` cuando el turno viene del formulario «Tengo una molestia», ADR-033) y la propuesta suba la
      exigencia: entonces `escalated_to_therapist` (ADR-021). El valor cabe en el sobre, así que `within_envelope` sigue en True.
    """
    decision = {"proposal": proposal, "within_envelope": False, "outcome": "rejected", "note": ""}
    complained = bool(discomfort(utterance)) or discomfort_reported
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
    if allowed is not None and param not in allowed:
        decision["note"] = f"esta pantalla no puede aplicar {param}: no se cambia"
        return decision
    if allowed is not None and param not in current:        # en el turno, sin valor actual no hay con qué comparar 'old'
        decision["note"] = f"no hay valor actual de {param} en pantalla: no se cambia"
        return decision
    if param == "rom_target":
        if not (_number(envelope.get("rom_min")) and _number(envelope.get("rom_max"))):
            decision["note"] = "el sobre no fija rom_min y rom_max: sin límite del fisioterapeuta no se ajusta el rango (I-3)"
            return decision
        if envelope["rom_min"] >= envelope["rom_max"]:
            decision["note"] = "sobre inconsistente: rom_min debe ser menor que rom_max"
            return decision
    elif param == "reps" and not _number(envelope.get("max_reps")):
        decision["note"] = "el sobre no fija max_reps: sin límite del fisioterapeuta no se ajustan las repeticiones (I-3)"
        return decision
    new = proposal["new"]
    if isinstance(new, bool) or not isinstance(new, (int, float)):
        decision["note"] = "el valor nuevo no es un número"
        return decision
    try:
        finite = math.isfinite(float(new))
    except OverflowError:
        finite = False
    if not finite:
        decision["note"] = "el valor nuevo no es un número válido"
        return decision
    if param == "reps" and not float(new).is_integer():
        decision["note"] = "las repeticiones deben ser un número entero"
        return decision
    if param in current and proposal["old"] != current[param]:
        decision["note"] = f"'old' ({proposal['old']}) no coincide con el valor actual ({current[param]})"
        return decision
    if not str(proposal.get("reason") or "").strip():
        decision["note"] = "la propuesta no explica el motivo"
        return decision
    lo, hi = envelope_limits(envelope, param)
    if lo <= float(new) <= hi:
        old = proposal["old"]
        if complained and not _number(old):
            decision["note"] = "tras una molestia 'old' debe ser un número para comparar la exigencia"
            return decision
        if complained and (float(new) - float(old)) * LESS_DEMAND[param] < 0:
            decision.update(within_envelope=True, outcome="escalated_to_therapist",
                            note="tras una molestia solo se baja la exigencia (ADR-021): lo revisa el fisioterapeuta")
            return decision
        decision.update(within_envelope=True, outcome="applied", note=f"dentro del sobre [{lo:g}, {hi:g}]")
    else:
        decision.update(outcome="escalated_to_therapist",
                        note=f"fuera del sobre [{lo:g}, {hi:g}]: se pausa el ejercicio y lo revisa el fisioterapeuta")
    return decision
