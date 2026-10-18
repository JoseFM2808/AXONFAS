"""AXONFAS · export FHIR R4 de una sesión como `Observation` (TD-10, ADR-008) y de su nota SOAP como documento (TD-103).
Solo biblioteca estándar y sin estado.

Es una función pura y determinista: no lee la hora ni la base; todo sale de los datos que recibe. Una nota sin firmar sale
como `preliminary`; firmada por un fisioterapeuta, como `final` (I-8). El paciente va solo por su seudónimo (ADR-010):
nunca el año de nacimiento ni el nombre del fisioterapeuta.

Los sistemas de código cuelgan de `https://axonfas.example/fhir/...`. `.example` es un dominio reservado: es Staging y no se
finge un sistema terminológico real. No se inventan códigos LOINC; un validador avisará de que esos sistemas no están
definidos (aviso, no error). Las unidades son UCUM.

Idioma (ADR-030, TD-116): los textos legibles (`display`, `text`, títulos y unidades escritas) salen en `lang` ('es' o
'en') y el recurso lo declara en `language`. Los códigos (`code`, `system`, LOINC, UCUM) nunca cambian: son lo que lee
una historia clínica. El texto de la nota SOAP es el que guarda la BD, así que la API pasa el idioma de la nota.

`document` arma la nota SOAP como `Bundle` de tipo `document` para una historia clínica electrónica (HL7 FHIR R4): una
`Composition` con una sección por letra (códigos LOINC reales de nota de evolución y de cada sección), el `Patient` por
seudónimo, el `Practitioner` solo por su identificador y solo si firmó, un `Device` (AXONFAS) como autor del borrador,
la `Observation` de la sesión y, con el Nivel 3 (TD-102), la `Organization` como custodio. Los `fullUrl` son `urn:uuid`
deterministas (uuid5), así que el mismo dato da el mismo documento.
"""
from __future__ import annotations

import html
import uuid

BASE = "https://axonfas.example/fhir"
LOINC = "http://loinc.org"
# Nota de evolución y sus secciones S, O, A y P (códigos LOINC existentes; no se inventan).
NOTE_TYPE = ("11506-3", "Progress note")
SOAP_SECTIONS = (("S", "61150-9", "Subjective Narrative"),
                 ("O", "61149-1", "Objective Narrative"),
                 ("A", "51848-0", "Evaluation note"),
                 ("P", "18776-5", "Plan of care note"))
UCUM = "http://unitsofmeasure.org"
CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category"

LANGS = ("es", "en")
END_REASONS = {
    "es": {"completed": "Sesión completada", "pain_stop": "Detenida por dolor", "user_quit": "Terminada por el paciente",
           "envelope_breach": "Detenida por salir del sobre de seguridad"},
    "en": {"completed": "Session completed", "pain_stop": "Stopped because of pain", "user_quit": "Ended by the patient",
           "envelope_breach": "Stopped for leaving the safety envelope"},
}
EVENT_COMPONENTS = {"trunk_flexion": "trunk-flexion-events", "knee_valgus": "knee-valgus-events"}
# Textos legibles por idioma. Las claves son los códigos de componente, que no cambian.
TEXT = {
    "es": {"reps-done": "Repeticiones hechas", "reps-target": "Repeticiones indicadas", "reps": "repeticiones",
           "knee-flexion-mean": "Flexión media de rodilla", "trunk-flexion-events": "Eventos de flexión de tronco",
           "knee-valgus-events": "Eventos de valgo de rodilla", "events": "eventos", "end-reason": "Motivo de fin de la sesión",
           "pain-reported": "Dolor reportado", "camera-used": "Sesión con cámara", "pain-score-end": "Dolor al terminar (EVA 0-10)",
           "tag": "Staging: datos sintéticos", "session": "Sesión de ejercicio terapéutico: {name}", "note": "Nota SOAP",
           "title": "Nota SOAP · {name}", "empty": "Sin datos.",
           "S": "Subjetivo", "O": "Objetivo", "A": "Evaluación", "P": "Plan"},
    "en": {"reps-done": "Repetitions done", "reps-target": "Repetitions prescribed", "reps": "repetitions",
           "knee-flexion-mean": "Mean knee flexion", "trunk-flexion-events": "Trunk flexion events",
           "knee-valgus-events": "Knee valgus events", "events": "events", "end-reason": "Reason the session ended",
           "pain-reported": "Pain reported", "camera-used": "Session with camera", "pain-score-end": "Pain at the end (VAS 0-10)",
           "tag": "Staging: synthetic data", "session": "Therapeutic exercise session: {name}", "note": "SOAP note",
           "title": "SOAP note · {name}", "empty": "No data.",
           "S": "Subjective", "O": "Objective", "A": "Assessment", "P": "Plan"},
}


def _lang(lang: str | None) -> str:
    return lang if lang in LANGS else "es"


def _component(code: str, text: str, **value) -> dict:
    return {"code": {"coding": [{"system": f"{BASE}/metric", "code": code, "display": text}], "text": text}, **value}


def _quantity(value, unit: str, ucum: str) -> dict:
    return {"valueQuantity": {"value": value, "unit": unit, "system": UCUM, "code": ucum}}


def observation(session: dict, facts: dict, report: dict | None, patient: dict, lang: str = "es") -> dict:
    """Observation de una sesión.

    - session: id, exercise_id, started_at, ended_at, reps_done, end_reason, events [{type}], monitored (bool).
    - facts: lo que devuelve `agents.soap.facts` (nombre del ejercicio, repeticiones indicadas, rom medio, dolor).
    - report: {soap, created_at, reviewed_by, reviewed_at} o None si todavía no hay nota.
    - patient: {id, alias}.
    - lang: idioma de los textos legibles ('es' | 'en'); los códigos no cambian.
    """
    lang = _lang(lang)
    T = TEXT[lang]
    name = facts.get("ejercicio") or session["exercise_id"]
    signed = bool(report) and report.get("reviewed_by") is not None
    comps = [_component("reps-done", T["reps-done"], **_quantity(session["reps_done"], T["reps"], "{repetitions}"))]
    if facts.get("repeticiones_indicadas") is not None:
        comps.append(_component("reps-target", T["reps-target"], **_quantity(facts["repeticiones_indicadas"], T["reps"], "{repetitions}")))
    if facts.get("rom_medio_grados") is not None:
        comps.append(_component("knee-flexion-mean", T["knee-flexion-mean"], **_quantity(facts["rom_medio_grados"], "°", "deg")))
    if session.get("monitored"):                    # solo con monitoreo un 0 significa "ninguna"; sin él no se afirma nada
        counts = {}
        for e in session.get("events") or []:
            counts[e.get("type")] = counts.get(e.get("type"), 0) + 1
        for kind, code in EVENT_COMPONENTS.items():
            comps.append(_component(code, T[code], **_quantity(counts.get(kind, 0), T["events"], "{events}")))
    reason = session.get("end_reason")
    if reason:
        label = END_REASONS[lang].get(reason, reason)
        comps.append(_component("end-reason", T["end-reason"], valueCodeableConcept={
            "coding": [{"system": f"{BASE}/end-reason", "code": reason, "display": label}], "text": label}))
    comps.append(_component("pain-reported", T["pain-reported"], valueBoolean=bool(facts.get("dolor_reportado"))))
    if "no_camera" in session:                       # TD-111: sin cámara no hay métricas cinemáticas ni detección postural
        comps.append(_component("camera-used", T["camera-used"], valueBoolean=not session["no_camera"]))
    if facts.get("dolor_al_terminar_eva") is not None:      # EVA 0-10 que marcó el paciente al terminar (ADR-025)
        comps.append(_component("pain-score-end", T["pain-score-end"], valueInteger=facts["dolor_al_terminar_eva"]))

    obs = {
        "resourceType": "Observation",
        "id": f"axonfas-session-{session['id']}",
        "meta": {"tag": [{"system": f"{BASE}/tag", "code": "staging-synthetic", "display": T["tag"]}]},
        "language": lang,
        "identifier": [{"system": f"{BASE}/session", "value": str(session["id"])}],
        "status": "final" if signed else "preliminary",
        "category": [{"coding": [{"system": CATEGORY_SYSTEM, "code": "activity", "display": "Activity"}]}],
        "code": {"coding": [{"system": f"{BASE}/exercise", "code": session["exercise_id"], "display": name}],
                 "text": T["session"].format(name=name)},
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


def _urn(kind: str, key) -> str:
    return f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'{BASE}/{kind}/{key}')}"


def _narrative(text: str) -> dict:
    return {"status": "generated", "div": f'<div xmlns="http://www.w3.org/1999/xhtml"><p>{html.escape(text)}</p></div>'}


def document(session: dict, facts: dict, report: dict | None, patient: dict, organization: dict | None = None,
             lang: str = "es") -> dict | None:
    """Nota SOAP de una sesión como `Bundle` FHIR R4 de tipo `document` (TD-103). None si la sesión no tiene nota.

    Mismos datos que `observation`, más `organization` opcional ({id, name}) para el Nivel 3. Sin firma, la
    `Composition` es `preliminary` y su autor es el `Device` de AXONFAS; firmada, `final`, con el fisioterapeuta como
    autor y como `attester` legal (I-8). Nunca nombres ni año de nacimiento. `lang` es el idioma de la nota.
    """
    if not report:
        return None
    lang = _lang(lang)
    T = TEXT[lang]
    soap = report.get("soap") or {}
    signed = report.get("reviewed_by") is not None
    name = facts.get("ejercicio") or session["exercise_id"]
    when = report.get("reviewed_at") or report.get("created_at") or session["ended_at"]
    tag = {"tag": [{"system": f"{BASE}/tag", "code": "staging-synthetic", "display": T["tag"]}]}

    patient_url = _urn("patient", patient["id"])
    obs_url = _urn("observation", session["id"])
    device_url = _urn("device", "axonfas")
    comp_url = _urn("composition", session["id"])

    pat = {"resourceType": "Patient", "id": f"p{patient['id']}", "meta": tag,
           "identifier": [{"system": f"{BASE}/patient-pseudonym", "value": f"p{patient['id']}"}]}
    device = {"resourceType": "Device", "id": "axonfas", "meta": tag,
              "deviceName": [{"name": "AXONFAS (Staging)", "type": "user-friendly-name"}]}
    obs = observation(session, facts, report, patient, lang)
    obs["subject"] = {"reference": patient_url, "display": patient["alias"]}

    entries = []
    authors = [{"reference": device_url}]
    comp = {
        "resourceType": "Composition", "id": f"axonfas-note-{session['id']}", "meta": tag, "language": lang,
        "identifier": {"system": f"{BASE}/note", "value": str(session["id"])},
        "status": "final" if signed else "preliminary",
        "type": {"coding": [{"system": LOINC, "code": NOTE_TYPE[0], "display": NOTE_TYPE[1]}], "text": T["note"]},
        "subject": {"reference": patient_url, "display": patient["alias"]},
        "date": when,
        "author": authors,
        "title": T["title"].format(name=name),
        "section": [],
    }
    for key, code, display in SOAP_SECTIONS:
        sec = {"title": T[key], "code": {"coding": [{"system": LOINC, "code": code, "display": display}]},
               "text": _narrative(soap.get(key) or T["empty"])}
        if key == "O":
            sec["entry"] = [{"reference": obs_url}]
        comp["section"].append(sec)

    if signed:
        prac_url = _urn("practitioner", report["reviewed_by"])
        prac = {"resourceType": "Practitioner", "id": f"t{report['reviewed_by']}", "meta": tag,
                "identifier": [{"system": f"{BASE}/therapist", "value": f"t{report['reviewed_by']}"}]}
        comp["author"] = [{"reference": prac_url}, {"reference": device_url}]
        comp["attester"] = [{"mode": "legal", "time": report["reviewed_at"], "party": {"reference": prac_url}}]
        obs["performer"] = [{"reference": prac_url}]
        entries.append({"fullUrl": prac_url, "resource": prac})
    if organization:
        org_url = _urn("organization", organization["id"])
        org = {"resourceType": "Organization", "id": f"o{organization['id']}", "meta": tag,
               "identifier": [{"system": f"{BASE}/organization", "value": f"o{organization['id']}"}],
               "name": organization.get("name") or f"o{organization['id']}"}
        comp["custodian"] = {"reference": org_url}
        entries.append({"fullUrl": org_url, "resource": org})

    return {
        "resourceType": "Bundle", "id": f"axonfas-note-bundle-{session['id']}", "meta": tag, "language": lang,
        "identifier": {"system": f"{BASE}/note-bundle", "value": str(session["id"])},
        "type": "document",
        "timestamp": when,
        "entry": [{"fullUrl": comp_url, "resource": comp}, {"fullUrl": patient_url, "resource": pat},
                  {"fullUrl": device_url, "resource": device}, {"fullUrl": obs_url, "resource": obs}, *entries],
    }
