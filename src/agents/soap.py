"""AXONFAS · agente de reporte: borrador de nota SOAP (ADR-008, I-6, I-8).

La nota solo usa datos de la sesión. Las cifras las pone una plantilla determinista; el LLM puede redactar la valoración
(A) y el plan (P), pero si su texto trae un número que no está en los datos, se descarta y queda la plantilla. Siempre
sale como borrador: `reviewed_by` vacío hasta que un fisioterapeuta lo firma.
"""
from __future__ import annotations

import json

from .coach import numbers
from .llm import LLMError, parse_json

END = {"completed": "completada", "pain_stop": "detenida por dolor", "user_quit": "terminada por el paciente",
       "envelope_breach": "detenida por salir del sobre de seguridad"}
SYMPTOM = {"pain": "dolor o molestia", "cramp": "calambre", "fatigue": "cansancio", "stiffness": "rigidez",
           "other": "otra molestia", "red_flag": "señal de alarma"}
SYMPTOM_ACTION = {"session_stopped": "se detuvo la sesión", "demand_lowered": "se bajó la exigencia",
                  "paused": "se hizo una pausa", "logged": "quedó registrada"}
EVENT = {"trunk_flexion": "flexión de tronco", "knee_valgus": "valgo de rodilla"}


# Sesión hecha sin cámara (TD-111): la nota lo dice en O, con este texto fijo, en lugar de "Compensaciones: ninguna".
NO_CAMERA_NOTE = "Sesión completada sin cámara. No se registraron métricas cinemáticas ni detección de fallos posturales."


def facts(session: dict) -> dict:
    """Solo lo que la nota puede citar, sacado de la sesión."""
    events = session.get("events") or []
    count: dict[str, int] = {}
    for e in events:
        count[e.get("type")] = count.get(e.get("type"), 0) + 1
    return {
        "ejercicio": session.get("exercise_name") or session.get("exercise_id"),
        "fecha": (session.get("ended_at") or "")[:10],
        "repeticiones_hechas": session.get("reps_done"),
        "repeticiones_indicadas": session.get("reps_target"),
        "fin": END.get(session.get("end_reason"), session.get("end_reason")),
        "compensaciones": {EVENT.get(k, k): v for k, v in count.items()},
        "rom_medio_grados": session.get("rom_mean"),
        "dolor_reportado": bool(session.get("pain_reported")),
        "dolor_al_terminar_eva": session.get("pain_score"),          # 0-10 que marcó el paciente (ADR-025); None sin dato
        "sin_camara": bool(session.get("no_camera")),                 # TD-111: sin métricas ni detección postural
        "ajustes_del_agente": [d.get("proposal") for d in session.get("decisions") or [] if d.get("outcome") == "applied"],
        "lo_que_dijo_el_paciente": session.get("utterances") or [],
        # Sin horas: añadirían cifras citables a I-6. Los textos son lo que escribió el paciente.
        "molestias": [{"categoria": SYMPTOM.get(x.get("category"), "otra molestia"), "texto": x.get("text"),
                       "accion": SYMPTOM_ACTION.get(x.get("action"), "quedó registrada"), "en_la_sesion": bool(x.get("in_session"))}
                      for x in session.get("symptom_reports") or []],
    }


def template(f: dict) -> dict:
    comp = ", ".join(f"{k}: {v}" for k, v in f["compensaciones"].items()) or "ninguna"
    s = ("Refiere: " + "; ".join(f["lo_que_dijo_el_paciente"])) if f["lo_que_dijo_el_paciente"] else "Sin comentarios del paciente."
    if f["dolor_reportado"]:
        s += " Reportó dolor."
    if f.get("dolor_al_terminar_eva") is not None:
        s += f" Dolor al terminar (EVA): {f['dolor_al_terminar_eva']}/10."
    if f["molestias"]:
        items = []
        for m in f["molestias"]:
            parts = ([f"«{m['texto']}»"] if m["texto"] else []) + ([] if m["en_la_sesion"] else ["fuera de la sesión"]) + [m["accion"]]
            items.append(f"{m['categoria']} ({'; '.join(parts)})")
        s += " Molestias reportadas: " + "; ".join(items) + "."
    done = (f"{f['repeticiones_hechas']} repeticiones" if f["repeticiones_indicadas"] is None    # sin meta no se escribe "de None"
            else f"{f['repeticiones_hechas']} de {f['repeticiones_indicadas']} repeticiones")
    o = f"{f['ejercicio']}, {f['fecha']}: {done}, sesión {f['fin']}. " + (NO_CAMERA_NOTE if f.get("sin_camara")
                                                                         else f"Compensaciones: {comp}.")
    if f["rom_medio_grados"] is not None:
        o += f" Flexión media de rodilla: {f['rom_medio_grados']}°."
    if f["ajustes_del_agente"]:
        o += " Ajustes aplicados dentro del sobre: " + "; ".join(
            f"{a['param']} {a['old']} → {a['new']}" for a in f["ajustes_del_agente"]) + "."
    a = "Pendiente de valoración del fisioterapeuta."
    p = "Revisar la técnica y decidir si se mantiene la dosis."
    return {"S": s, "O": o, "A": a, "P": p}


def draft(llm, session: dict) -> dict:
    """Borrador SOAP. S y O siempre de la plantilla; A y P del LLM solo si no inventa cifras."""
    f = facts(session)
    note = template(f)
    source = "template"
    if llm is not None:
        messages = [
            {"role": "system", "content": "Eres el agente de reporte de AXONFAS. Con los datos dados, redacta en español "
                                          "la Valoración (A) y el Plan (P) de una nota SOAP, en una o dos frases cada una. "
                                          "No diagnostiques. No uses ningún número que no esté en los datos. Responde solo "
                                          'con JSON: {"A": "...", "P": "..."}'},
            {"role": "user", "content": json.dumps(f, ensure_ascii=False)},
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
    return {"status": "draft", "reviewed_by": None, "source": source, "soap": note, "facts": f}
