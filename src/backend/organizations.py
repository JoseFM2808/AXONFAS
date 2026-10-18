"""AXONFAS · Nivel 3: organizaciones, licencias y conexión con la historia clínica (TD-102, ADR-026). Sin estado.

Una organización (clínica u hospital) contrata un plan con un número de licencias de profesional. Su administrador de
empresa invita profesionales por correo (cada invitación activa ocupa una licencia), ve cuántas usa y cuántos pacientes
tiene cada profesional, y configura la dirección FHIR de su historia clínica electrónica. Nunca ve datos clínicos
(mismo criterio que I-14): ni sesiones, ni notas, ni molestias, ni nombres de pacientes; solo conteos.

Planes y cupos son valores de partida para Staging, sin precio: el modelo de negocio todavía se valida (04 · Anexo).
Funciones puras: la API de Staging guarda y lee; aquí se valida y se resume.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

PLANS = {
    "clinic": {"label": "Clínica pequeña", "seats": 5, "patients_per_seat": 30},
    "network": {"label": "Red hospitalaria", "seats": 50, "patients_per_seat": 40},
}
NAME_MAX = 80
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
# Una dirección FHIR nunca lleva credenciales: esas van al entorno del servidor cuando exista la integración (TD-20).
SECRET_KEYS = {"token", "password", "secret", "api_key", "apikey", "client_secret", "authorization"}


class OrgError(ValueError):
    """Dato inválido: la API lo devuelve como 400 con este mensaje."""


def clean_name(value) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OrgError("Falta el nombre de la organización.")
    name = " ".join(value.split())
    if len(name) > NAME_MAX:
        raise OrgError(f"El nombre admite hasta {NAME_MAX} caracteres.")
    return name


def clean_plan(value) -> str:
    if value not in PLANS:
        raise OrgError(f"Plan desconocido. Opciones: {', '.join(PLANS)}.")
    return value


def clean_email(value) -> str:
    if not isinstance(value, str) or not EMAIL_RE.match(value.strip()):
        raise OrgError("Correo inválido.")
    return value.strip().lower()


def clean_ehr(data) -> dict:
    """{fhir_base_url, enabled} → validado. HTTPS, sin usuario ni clave en la URL, sin consulta ni fragmento."""
    if not isinstance(data, dict):
        raise OrgError("Configuración de historia clínica inválida.")
    if SECRET_KEYS & {str(k).lower() for k in data}:
        raise OrgError("No se guardan credenciales de la historia clínica aquí.")
    url = data.get("fhir_base_url")
    enabled = data.get("enabled", False)
    if not isinstance(enabled, bool):
        raise OrgError("`enabled` tiene que ser verdadero o falso.")
    if url in (None, ""):
        if enabled:
            raise OrgError("Para activar la conexión hace falta la dirección FHIR.")
        return {"fhir_base_url": None, "enabled": False}
    if not isinstance(url, str) or len(url) > 300:
        raise OrgError("Dirección FHIR inválida.")
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise OrgError("La dirección FHIR tiene que ser https://.")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise OrgError("La dirección FHIR no lleva usuario, clave, consulta ni fragmento.")
    return {"fhir_base_url": url.strip().rstrip("/"), "enabled": enabled}


def seats(org: dict, licenses: list[dict]) -> dict:
    plan = PLANS[org["plan"]]
    used = sum(1 for lic in licenses if lic.get("status") == "active")
    return {"total": plan["seats"], "used": used, "free": max(0, plan["seats"] - used)}


def check_invite(org: dict, licenses: list[dict], email: str) -> str:
    """Valida una invitación de profesional: correo, que no esté ya activo y que quede licencia libre."""
    email = clean_email(email)
    if any(lic.get("status") == "active" and lic.get("email") == email for lic in licenses):
        raise OrgError("Ese profesional ya tiene una licencia activa.")
    if seats(org, licenses)["free"] == 0:
        raise OrgError("No quedan licencias libres en el plan. Libera una o cambia de plan.")
    return email


def summary(org: dict, licenses: list[dict], patients_by_therapist: dict[int, int]) -> dict:
    """Panel de empresa: plan, licencias y pacientes por profesional. Solo conteos; ningún dato clínico."""
    plan = PLANS[org["plan"]]
    s = seats(org, licenses)
    pros = []
    for lic in sorted(licenses, key=lambda x: (x.get("status") != "active", x.get("email") or "")):
        tid = lic.get("therapist_id")
        pros.append({"license_id": lic["id"], "email": lic.get("email"), "status": lic.get("status"),
                     "linked": tid is not None, "patients": patients_by_therapist.get(tid, 0) if tid is not None else 0})
    patients = sum(p["patients"] for p in pros if p["status"] == "active")
    capacity = s["total"] * plan["patients_per_seat"]
    return {
        "organization": {"id": org["id"], "name": org["name"], "plan": org["plan"], "plan_label": plan["label"]},
        "seats": s,
        "patients": {"total": patients, "capacity": capacity, "over": patients > capacity},
        "professionals": pros,
        "ehr": {"fhir_base_url": org.get("ehr_fhir_base_url"), "enabled": bool(org.get("ehr_enabled"))},
    }
