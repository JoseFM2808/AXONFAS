"""AXONFAS · export FHIR R4 de una sesión como `Observation` (TD-10, ADR-008). Solo biblioteca estándar y sin estado.

Es una función pura y determinista: no lee la hora ni la base; todo sale de los datos que recibe. Una nota sin firmar sale
como `preliminary`; firmada por un fisioterapeuta, como `final` (I-8). El paciente va solo por su seudónimo (ADR-010):
nunca el año de nacimiento ni el nombre del fisioterapeuta.

Los sistemas de código cuelgan de `https://axonfas.example/fhir/...`. `.example` es un dominio reservado: es Staging y no se
finge un sistema terminológico real. No se inventan códigos LOINC; un validador avisará de que esos sistemas no están
definidos (aviso, no error). Las unidades son UCUM.
"""
from __future__ import annotations

BASE = "https://axonfas.example/fhir"
UCUM = "http://unitsofmeasure.org"
CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category"

END_REASONS = {"completed": "Sesión completada", "pain_stop": "Detenida por dolor", "user_quit": "Terminada por el paciente",
               "envelope_breach": "Detenida por salir del sobre de seguridad"}
EVENT_COMPONENTS = {"trunk_flexion": ("trunk-flexion-events", "Eventos de flexión de tronco"),
                    "knee_valgus": ("knee-valgus-events", "Eventos de valgo de rodilla")}


def _component(code: str, text: str, **value) -> dict:
    return {"code": {"coding": [{"system": f"{BASE}/metric", "code": code, "display": text}], "text": text}, **value}


def _quantity(value, unit: str, ucum: str) -> dict:
    return {"valueQuantity": {"value": value, "unit": unit, "system": UCUM, "code": ucum}}


def observation(session: dict, facts: dict, report: dict | None, patient: dict) -> dict:
    """Observation de una sesión.

    - session: id, exercise_id, started_at, ended_at, reps_done, end_reason, events [{type}], monitored (bool).
    - facts: lo que devuelve `agents.soap.facts` (nombre del ejercicio, repeticiones indicadas, rom medio, dolor).
    - report: {soap, created_at, reviewed_by, reviewed_at} o None si todavía no hay nota.
    - patient: {id, alias}.
    """
    name = facts.get("ejercicio") or session["exercise_id"]
    signed = bool(report) and report.get("reviewed_by") is not None
    comps = [_component("reps-done", "Repeticiones hechas", **_quantity(session["reps_done"], "repeticiones", "{repetitions}"))]
    if facts.get("repeticiones_indicadas") is not None:
        comps.append(_component("reps-target", "Repeticiones indicadas", **_quantity(facts["repeticiones_indicadas"], "repeticiones", "{repetitions}")))
    if facts.get("rom_medio_grados") is not None:
        comps.append(_component("knee-flexion-mean", "Flexión media de rodilla", **_quantity(facts["rom_medio_grados"], "°", "deg")))
    if session.get("monitored"):                    # solo con monitoreo un 0 significa "ninguna"; sin él no se afirma nada
        counts = {}
        for e in session.get("events") or []:
            counts[e.get("type")] = counts.get(e.get("type"), 0) + 1
        for kind, (code, text) in EVENT_COMPONENTS.items():
            comps.append(_component(code, text, **_quantity(counts.get(kind, 0), "eventos", "{events}")))
    reason = session.get("end_reason")
    if reason:
        label = END_REASONS.get(reason, reason)
        comps.append(_component("end-reason", "Motivo de fin de la sesión", valueCodeableConcept={
            "coding": [{"system": f"{BASE}/end-reason", "code": reason, "display": label}], "text": label}))
    comps.append(_component("pain-reported", "Dolor reportado", valueBoolean=bool(facts.get("dolor_reportado"))))

    obs = {
        "resourceType": "Observation",
        "id": f"axonfas-session-{session['id']}",
        "meta": {"tag": [{"system": f"{BASE}/tag", "code": "staging-synthetic", "display": "Staging: datos sintéticos"}]},
        "identifier": [{"system": f"{BASE}/session", "value": str(session["id"])}],
        "status": "final" if signed else "preliminary",
        "category": [{"coding": [{"system": CATEGORY_SYSTEM, "code": "activity", "display": "Activity"}]}],
        "code": {"coding": [{"system": f"{BASE}/exercise", "code": session["exercise_id"], "display": name}],
                 "text": f"Sesión de ejercicio terapéutico: {name}"},
        "subject": {"identifier": {"system": f"{BASE}/patient-pseudonym", "value": f"p{patient['id']}"}, "display": patient["alias"]},
        "effectivePeriod": {"start": session["started_at"], "end": session["ended_at"]},
        "issued": (report or {}).get("reviewed_at") or (report or {}).get("created_at") or session["ended_at"],
        "component": comps,
    }
    if signed:
        obs["performer"] = [{"identifier": {"system": f"{BASE}/therapist", "value": f"t{report['reviewed_by']}"}}]
    if report:
        soap = report.get("soap") or {}
        obs["note"] = [{"text": " ".join(f"{k}: {soap[k]}" for k in ("S", "O", "A", "P") if soap.get(k))}]
    return obs
