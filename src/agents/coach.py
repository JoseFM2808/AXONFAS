"""AXONFAS · agente conversacional: la frase corta que el paciente escucha (ADR-007).

La frase dice lo que el motor de reglas decidió, nunca otra cosa. El LLM solo la hace más natural; si su versión trae un
número que no está en la decisión, o es demasiado larga, se usa la plantilla.
"""
from __future__ import annotations

import re

from .llm import LLMError
from .safety import normalize

STOP_TEXT = "Detenemos la sesión. Si el malestar sigue, contacta a tu fisioterapeuta."
PAUSE_TEXT = "Hacemos una pausa y se lo avisamos a tu fisioterapeuta. Descansa; si empeora, toca Dolor y paramos."
PARAM_TEXT = {"rom_target": "baja solo hasta {new} grados", "reps": "hagamos {new} repeticiones más",
              "rest_seconds": "descansa {new} segundos entre series"}
NUM = re.compile(r"\d+(?:[.,]\d+)?")
# Medicamentos y diagnósticos: la frase de AXONFAS no receta ni diagnostica. Lista cerrada sobre el texto sin tildes (ADR-004).
MEDICAL = re.compile(r"ibuprofeno|paracetamol|naproxeno|diclofenaco|aspirina|analgesic|antiinflamatori|pastilla|medicament|crema|pomada|"
                     r"infiltracion|diagnostic|tendinitis|desgarro|fractura|esguince|hernia|artrosis|artritis|menisco|ligamento roto|lesion|"
                     # Inglés (ADR-030): la frase en inglés tampoco receta ni diagnostica.
                     r"ibuprofen|acetaminophen|naproxen|diclofenac|aspirin|painkiller|anti-?inflammator|\bpills?\b|medication|medicine|"
                     r"ointment|\bcream\b|injection|diagnos|tendonitis|fracture|sprain|arthritis|arthrosis|meniscus|torn ligament|"
                     r"\binjur(y|ies)\b")
# Cifras escritas con letras en inglés: el filtro de cifras (I-6) solo las reconoce en español, así que en inglés la frase
# que las traiga vuelve a la plantilla (conservador a propósito; TD-135).
EN_NUM = re.compile(r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|"
                    r"seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b")
REPLY_LANG = {"es": "español", "en": "inglés"}
# Palabras de enlace de cada idioma: la frase del LLM tiene que estar en el idioma de la interfaz (I-22). Si trae más
# palabras del otro idioma que del pedido, vuelve la plantilla traducida (conservador a propósito).
LANG_WORDS = {
    "es": re.compile(r"\b(el|la|los|las|de|del|que|y|en|un|una|tu|te|si|no|para|con|por|mas|hasta|hagamos|baja|descansa)\b"),
    "en": re.compile(r"\b(the|a|an|of|and|to|in|your|you|if|we|for|with|let's|lets|more|until|rest|lower|stop)\b"),
}


def in_language(text: str, lang: str) -> bool:
    """¿La frase está en `lang`? Cuenta palabras de enlace de cada idioma sobre el texto sin tildes."""
    t = normalize(text)
    own = len(LANG_WORDS.get(lang, LANG_WORDS["es"]).findall(t))
    other = sum(len(rx.findall(t)) for code, rx in LANG_WORDS.items() if code != lang)
    if lang == "en" and re.search(r"[ñ¿¡]", text.lower()):
        return False
    return own > other


def template(decision: dict) -> str:
    if decision.get("red_flag"):
        return STOP_TEXT
    if decision.get("paused"):
        return PAUSE_TEXT
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


UNITS = {"cero": 0, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
         "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16, "diecisiete": 17,
         "dieciocho": 18, "diecinueve": 19, "veinte": 20, "veintiuno": 21, "veintiun": 21, "veintidos": 22,
         "veintitres": 23, "veinticuatro": 24, "veinticinco": 25, "veintiseis": 26, "veintisiete": 27,
         "veintiocho": 28, "veintinueve": 29}
TENS = {"treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80, "noventa": 90}
HUNDREDS = {"cien": 100, "ciento": 100, "doscientos": 200, "doscientas": 200, "trescientos": 300, "trescientas": 300,
            "cuatrocientos": 400, "cuatrocientas": 400, "quinientos": 500, "quinientas": 500, "seiscientos": 600,
            "seiscientas": 600, "setecientos": 700, "setecientas": 700, "ochocientos": 800, "ochocientas": 800,
            "novecientos": 900, "novecientas": 900}
ONES = {"uno": 1, "un": 1, "una": 1}  # solo cuentan dentro de un compuesto: sueltos son artículos


def _word_numbers(text: str) -> set[str]:
    """Cifras escritas con letras ("treinta y cinco" → "35") en un texto en español."""
    words = re.findall(r"[a-zñ]+", normalize(text))
    found: set[str] = set()
    i = 0
    while i < len(words):
        if words[i] not in UNITS and words[i] not in TENS and words[i] not in HUNDREDS and words[i] != "mil":
            i += 1
            continue
        thousands = total = 0
        last = None  # tipo de la última palabra del compuesto: mil, hundred, tens o unit
        while i < len(words):
            w = words[i]
            if w in HUNDREDS and last in (None, "mil"):
                total += HUNDREDS[w]
                last = "hundred"
            elif w in TENS and last in (None, "mil", "hundred"):
                total += TENS[w]
                last = "tens"
            elif w in UNITS and last in (None, "mil", "hundred"):
                total += UNITS[w]
                last = "unit"
            elif w in ONES and last in ("hundred", "mil"):
                total += ONES[w]
                last = "unit"
            elif w == "y" and last == "tens" and i + 1 < len(words) and (words[i + 1] in ONES or 0 < UNITS.get(words[i + 1], 0) < 10):
                i += 1
                total += ONES.get(words[i]) or UNITS[words[i]]
                last = "unit"
            elif w == "mil" and last in (None, "hundred", "tens", "unit") and not thousands:
                thousands = (total or 1) * 1000
                total = 0
                last = "mil"
            else:
                break
            i += 1
        found.add(str(thousands + total))
    return found


def numbers(text: str) -> set[str]:
    """Cifras de un texto, normalizadas ("10,50" → "10.5", "88.0" → "88"), más las escritas con letras.

    Es el filtro de I-6: lo que no esté en los datos no se dice. Es conservador a propósito: un LLM que escriba "las dos
    piernas" sin que haya un 2 en los datos cae a la plantilla."""
    out = set()
    for n in NUM.findall(text or ""):
        n = n.replace(",", ".")
        if "." in n:
            n = n.rstrip("0").rstrip(".")
        out.add(n)
    return out | _word_numbers(text or "")


def reply(llm, utterance: str, decision: dict, lang: str = "es", translate=None) -> dict:
    """Frase para el paciente (≤ 30 palabras) en `lang`. Con alarma o sin LLM, la plantilla fija. `translate` pasa la
    plantilla (escrita en español) al idioma de la interfaz (messages.tr en el servidor; ADR-032, I-22)."""
    base = translate(template(decision)) if translate else template(decision)
    if decision.get("red_flag") or llm is None:
        return {"text": base, "source": "template", "llm_ms": None}
    messages = [
        {"role": "system", "content": f"Eres la voz de AXONFAS. Reescribe el mensaje en {REPLY_LANG.get(lang, 'español')}, cálido y claro, en una "
                                      "o dos frases y máximo 30 palabras. No agregues información, consejos médicos "
                                      "ni números nuevos. Responde solo con la frase."},
        {"role": "user", "content": f"El paciente dijo: «{utterance}». Mensaje a reescribir: «{base}»"},
    ]
    try:
        out = llm.chat(messages, max_tokens=80, temperature=0.4)
    except LLMError:
        return {"text": base, "source": "template", "llm_ms": None}
    text = (out["text"] or "").strip().strip("«»\"")
    ok = (bool(text) and not text.startswith("{") and len(text.split()) <= 30 and numbers(text) <= numbers(base)
          and not MEDICAL.search(normalize(text)) and not (lang == "en" and EN_NUM.search(normalize(text)))
          and in_language(text, lang))
    return {"text": text if ok else base, "source": "llm" if ok else "template", "llm_ms": out["ms"]}
