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
EVENT = {"trunk_flexion": "flexión de tronco", "knee_valgus": "valgo de rodilla"}


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
        "ajustes_del_agente": [d.get("proposal") for d in session.get("decisions") or [] if d.get("outcome") == "applied"],
        "lo_que_dijo_el_paciente": session.get("utterances") or [],
    }


def template(f: dict) -> dict:
    comp = ", ".join(f"{k}: {v}" for k, v in f["compensaciones"].items()) or "ninguna"
    s = ("Refiere: " + "; ".join(f["lo_que_dijo_el_paciente"])) if f["lo_que_dijo_el_paciente"] else "Sin comentarios del paciente."
    if f["dolor_reportado"]:
        s += " Reportó dolor."
    o = (f"{f['ejercicio']}, {f['fecha']}: {f['repeticiones_hechas']} de {f['repeticiones_indicadas']} repeticiones, "
         f"sesión {f['fin']}. Compensaciones: {comp}.")
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
        allowed = numbers(json.dumps(f, ensure_ascii=False))
        if all(isinstance(out.get(k), str) and out[k].strip() and numbers(out[k]) <= allowed for k in ("A", "P")):
            note["A"], note["P"] = out["A"].strip(), out["P"].strip()
            source = "llm"
    return {"status": "draft", "reviewed_by": None, "source": source, "soap": note, "facts": f}
