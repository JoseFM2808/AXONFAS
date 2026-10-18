"""AXONFAS · agente de reporte: borrador de nota SOAP (ADR-008, I-6, I-8).

La nota solo usa datos de la sesión. Las cifras las pone una plantilla determinista; el LLM puede redactar la valoración
(A) y el plan (P), pero si su texto trae un número que no está en los datos, se descarta y queda la plantilla. Siempre
sale como borrador: `reviewed_by` vacío hasta que un fisioterapeuta lo firma.

Idioma (ADR-030, TD-116): la nota sale en el idioma de quien la pide ('es' o 'en'). Solo cambian los textos fijos; las
cifras y lo que escribió el paciente son los mismos datos.
"""
from __future__ import annotations

import json

from . import privacy
from .coach import numbers
from .llm import LLMError, parse_json

# Textos fijos por idioma. Las claves de `facts` no cambian (las guarda la BD y las lee fhir.py): solo sus textos.
LANGS = ("es", "en")
END = {"es": {"completed": "completada", "pain_stop": "detenida por dolor", "user_quit": "terminada por el paciente",
              "envelope_breach": "detenida por salir del sobre de seguridad"},
       "en": {"completed": "completed", "pain_stop": "stopped because of pain", "user_quit": "ended by the patient",
              "envelope_breach": "stopped for leaving the safety envelope"}}
SYMPTOM = {"es": {"pain": "dolor o molestia", "cramp": "calambre", "fatigue": "cansancio", "stiffness": "rigidez",
                  "other": "otra molestia", "red_flag": "señal de alarma"},
           "en": {"pain": "pain or discomfort", "cramp": "cramp", "fatigue": "tiredness", "stiffness": "stiffness",
                  "other": "other discomfort", "red_flag": "warning sign"}}
SYMPTOM_ACTION = {"es": {"session_stopped": "se detuvo la sesión", "demand_lowered": "se bajó la exigencia",
                         "paused": "se hizo una pausa", "logged": "quedó registrada"},
                  "en": {"session_stopped": "the session was stopped", "demand_lowered": "the demand was lowered",
                         "paused": "a pause was taken", "logged": "it was logged"}}
EVENT = {"es": {"trunk_flexion": "flexión de tronco", "knee_valgus": "valgo de rodilla"},
         "en": {"trunk_flexion": "trunk flexion", "knee_valgus": "knee valgus"}}

# Sesión hecha sin cámara (TD-111): la nota lo dice en O, con este texto fijo, en lugar de "Compensaciones: ninguna".
# doctor.js muestra el mismo aviso con 'doctor.nocam' (i18n/clinic.js); un test exige que digan lo mismo en los dos idiomas.
NO_CAMERA_NOTES = {
    "es": "Sesión completada sin cámara. No se registraron métricas cinemáticas ni detección de fallos posturales.",
    "en": "Session completed without a camera. No kinematic metrics or postural fault detection were recorded.",
}
NO_CAMERA_NOTE = NO_CAMERA_NOTES["es"]

TEXT = {
    "es": {"said": "Refiere: ", "no_comments": "Sin comentarios del paciente.", "pain": " Reportó dolor.",
           "eva": " Dolor al terminar (EVA): {v}/10.", "outside": "fuera de la sesión", "symptoms": " Molestias reportadas: ",
           "reps": "{done} repeticiones", "reps_of": "{done} de {target} repeticiones", "session": "sesión",
           "comp": "Compensaciones: {comp}.", "none": "ninguna", "rom": " Flexión media de rodilla: {v}°.",
           "adjust": " Ajustes aplicados dentro del sobre: ", "A": "Pendiente de valoración del fisioterapeuta.",
           "P": "Revisar la técnica y decidir si se mantiene la dosis.", "quote": "«{t}»", "lang": "español"},
    # "lang" = cómo se le pide el idioma al LLM (el prompt del sistema está en español).
    "en": {"said": "Reports: ", "no_comments": "No comments from the patient.", "pain": " Reported pain.",
           "eva": " Pain at the end (VAS): {v}/10.", "outside": "outside the session", "symptoms": " Reported discomfort: ",
           "reps": "{done} repetitions", "reps_of": "{done} of {target} repetitions", "session": "session",
           "comp": "Compensations: {comp}.", "none": "none", "rom": " Mean knee flexion: {v}°.",
           "adjust": " Adjustments applied within the envelope: ", "A": "Pending the physiotherapist's assessment.",
           "P": "Review the technique and decide whether to keep the dose.", "quote": "“{t}”", "lang": "inglés"},
}


AUTHOR = {"es": {"clinical": "agente clínico", "rules": "motor de reglas"},
          "en": {"clinical": "clinical agent", "rules": "rules engine"}}


def _lang(lang: str | None) -> str:
    return lang if lang in LANGS else "es"


def _adjustment(decision: dict, lang: str = "es") -> dict:
    """{param, old, new, por}: sin el motivo, que es texto libre del LLM y no debe sumar cifras citables (I-6)."""
    p = decision.get("proposal") or {}
    out = {k: p.get(k) for k in ("param", "old", "new")}
    if decision.get("agent") in AUTHOR["es"]:
        out["por"] = AUTHOR[_lang(lang)][decision["agent"]]
    return out


def facts(session: dict, lang: str = "es") -> dict:
    """Solo lo que la nota puede citar, sacado de la sesión. Los textos (fin, compensaciones, molestias) van en `lang`."""
    lang = _lang(lang)
    events = session.get("events") or []
    count: dict[str, int] = {}
    for e in events:
        count[e.get("type")] = count.get(e.get("type"), 0) + 1
    return {
        "ejercicio": session.get("exercise_name") or session.get("exercise_id"),
        "fecha": (session.get("ended_at") or "")[:10],
        "repeticiones_hechas": session.get("reps_done"),
        "repeticiones_indicadas": session.get("reps_target"),
        "fin": END[lang].get(session.get("end_reason"), session.get("end_reason")),
        "compensaciones": {EVENT[lang].get(k, k): v for k, v in count.items()},
        "rom_medio_grados": session.get("rom_mean"),
        "dolor_reportado": bool(session.get("pain_reported")),
        "dolor_al_terminar_eva": session.get("pain_score"),          # 0-10 que marcó el paciente (ADR-025); None sin dato
        "sin_camara": bool(session.get("no_camera")),                 # TD-111: sin métricas ni detección postural
        "ajustes_del_agente": [_adjustment(d, lang) for d in session.get("decisions") or [] if d.get("outcome") == "applied"],
        "lo_que_dijo_el_paciente": session.get("utterances") or [],
        # Sin horas: añadirían cifras citables a I-6. Los textos son lo que escribió el paciente.
        "molestias": [{"categoria": SYMPTOM[lang].get(x.get("category"), SYMPTOM[lang]["other"]), "texto": x.get("text"),
                       "accion": SYMPTOM_ACTION[lang].get(x.get("action"), SYMPTOM_ACTION[lang]["logged"]),
                       "en_la_sesion": bool(x.get("in_session"))}
                      for x in session.get("symptom_reports") or []],
    }


def template(f: dict, lang: str = "es") -> dict:
    T = TEXT[_lang(lang)]
    comp = ", ".join(f"{k}: {v}" for k, v in f["compensaciones"].items()) or T["none"]
    s = (T["said"] + "; ".join(f["lo_que_dijo_el_paciente"])) if f["lo_que_dijo_el_paciente"] else T["no_comments"]
    if f["dolor_reportado"]:
        s += T["pain"]
    if f.get("dolor_al_terminar_eva") is not None:
        s += T["eva"].format(v=f["dolor_al_terminar_eva"])
    if f["molestias"]:
        items = []
        for m in f["molestias"]:
            parts = ([T["quote"].format(t=m["texto"])] if m["texto"] else []) + ([] if m["en_la_sesion"] else [T["outside"]]) + [m["accion"]]
            items.append(f"{m['categoria']} ({'; '.join(parts)})")
        s += T["symptoms"] + "; ".join(items) + "."
    done = (T["reps"].format(done=f["repeticiones_hechas"]) if f["repeticiones_indicadas"] is None    # sin meta no se escribe "de None"
            else T["reps_of"].format(done=f["repeticiones_hechas"], target=f["repeticiones_indicadas"]))
    o = f"{f['ejercicio']}, {f['fecha']}: {done}, {T['session']} {f['fin']}. " + (
        NO_CAMERA_NOTES[_lang(lang)] if f.get("sin_camara") else T["comp"].format(comp=comp))
    if f["rom_medio_grados"] is not None:
        o += T["rom"].format(v=f["rom_medio_grados"])
    if f["ajustes_del_agente"]:
        o += T["adjust"] + "; ".join(f"{a['param']} {a['old']} → {a['new']}" + (f" ({a['por']})" if a.get("por") else "")
                                     for a in f["ajustes_del_agente"]) + "."
    return {"S": s, "O": o, "A": T["A"], "P": T["P"]}


def _private(f: dict) -> dict:
    """Los hechos tal como salen hacia el LLM: el texto libre del paciente, sin datos personales (ADR-034). Las filas nuevas
    ya se guardan filtradas; esto cubre las anteriores. La plantilla de la nota no cambia."""
    return {**f, "lo_que_dijo_el_paciente": [privacy.redact(t)[0] for t in f["lo_que_dijo_el_paciente"]],
            "molestias": [{**m, "texto": privacy.redact(m["texto"])[0] if m.get("texto") else m.get("texto")} for m in f["molestias"]]}


def draft(llm, session: dict, lang: str = "es") -> dict:
    """Borrador SOAP en `lang`. S y O siempre de la plantilla; A y P del LLM solo si no inventa cifras."""
    lang = _lang(lang)
    f = facts(session, lang)
    note = template(f, lang)
    source = "template"
    if llm is not None:
        messages = [
            {"role": "system", "content": f"Eres el agente de reporte de AXONFAS. Con los datos dados, redacta en {TEXT[lang]['lang']} "
                                          "la Valoración (A) y el Plan (P) de una nota SOAP, en una o dos frases cada una. "
                                          "No diagnostiques. No uses ningún número que no esté en los datos. Responde solo "
                                          'con JSON: {"A": "...", "P": "..."}'},
            {"role": "user", "content": json.dumps(_private(f), ensure_ascii=False)},
        ]
        try:
            out = parse_json(llm.chat(messages, json_mode=True, max_tokens=220)["text"]) or {}
        except LLMError:
            out = {}
        # La fecha no cuenta como cifra citable: sus partes (año, mes, día) dejarían pasar "quince" o "100" por casualidad.
        allowed = numbers(json.dumps({k: v for k, v in f.items() if k != "fecha"}, ensure_ascii=False))
        if all(isinstance(out.get(k), str) and out[k].strip() and numbers(out[k]) <= allowed for k in ("A", "P")):
            note["A"], note["P"] = out["A"].strip(), out["P"].strip()
            source = "llm"
    return {"status": "draft", "reviewed_by": None, "source": source, "soap": note, "facts": f, "lang": lang}
