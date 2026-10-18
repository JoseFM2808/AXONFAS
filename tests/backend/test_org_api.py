"""Tests de la API del Nivel 3 (organizaciones y licencias, ADR-026) y del documento FHIR de la nota SOAP (TD-103).
Sin red: Google se simula con la clave RSA de prueba de test_auth_admin. Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_auth  # noqa: E402
from staging_api import StagingApi, load_catalog  # noqa: E402
from test_auth_admin import ADMIN, CLIENT_ID, JWKS, claims, sign  # noqa: E402  (solo funciones y datos, no sus tests)

CATALOG = load_catalog(ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js")
ORG_ADMIN = "direccion@clinica.test"


class Client:
    def __init__(self, api, token=None):
        self.api, self.token = api, token

    def call(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        return self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")


class OrgApiTest(unittest.TestCase):
    def setUp(self):
        for k in ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY", "AXONFAS_LLM_KEY"):
            os.environ.pop(k, None)
        os.environ.update(GOOGLE_CLIENT_ID=CLIENT_ID, AXONFAS_ADMIN_EMAILS=ADMIN, AXONFAS_DEMO_ACCOUNTS="1")
        self.api = StagingApi(":memory:", CATALOG)
        self.addCleanup(self.api.db.close)
        self.api.jwks = google_auth.Jwks(fetch=lambda url: (JWKS, 3600))
        self.admin = Client(self.api, self.login(ADMIN, "g-admin")["token"])

    def tearDown(self):
        for k in ("GOOGLE_CLIENT_ID", "AXONFAS_ADMIN_EMAILS", "AXONFAS_DEMO_ACCOUNTS"):
            os.environ.pop(k, None)

    def login(self, email, sub):
        status, body = Client(self.api).call("POST", "/api/auth/google", {"credential": sign(claims(email=email, sub=sub))})
        self.assertEqual(status, 200, body)
        return body

    def new_org(self, plan="clinic", email=ORG_ADMIN):
        return self.admin.call("POST", "/api/admin/orgs", {"name": "Clínica Demo", "plan": plan, "admin_email": email})

    def org_client(self):
        self.assertEqual(self.new_org()[0], 201)
        body = self.login(ORG_ADMIN, "g-org")
        self.assertEqual(body["role"], "org")
        return Client(self.api, body["token"])

    def test_el_administrador_crea_organizaciones_y_las_ve(self):
        status, body = self.new_org()
        self.assertEqual(status, 201)
        self.assertEqual((body["organization"]["plan_label"], body["seats"]["total"], body["admin_email"]),
                         ("Clínica pequeña", 5, ORG_ADMIN))
        self.assertEqual(self.new_org()[0], 409, "un correo administra una sola organización")
        self.assertEqual(self.new_org(email=ADMIN)[0], 400, "no con el correo de un Administrador maestro")
        self.assertEqual(self.new_org(plan="gratis", email="x@y.test")[0], 400)
        _, listing = self.admin.call("GET", "/api/admin/orgs")
        self.assertEqual(len(listing["organizations"]), 1)
        self.assertEqual(self.admin.call("GET", "/api/admin/overview")[1]["organizations"], 1)

    def test_la_administracion_entra_con_google_y_ve_su_panel(self):
        org = self.org_client()
        status, me = org.call("GET", "/api/auth/me")
        self.assertEqual((status, me["role"], me["organization"]["name"]), (200, "org", "Clínica Demo"))
        _, s = org.call("GET", "/api/org/summary")
        self.assertEqual(s["seats"], {"total": 5, "used": 0, "free": 5})
        self.assertEqual(org.call("GET", "/api/therapists/me")[0], 403, "no es un fisioterapeuta")
        self.assertEqual(self.admin.call("GET", "/api/org/summary")[0], 403)

    def test_invitar_licencias_y_vincular_al_fisioterapeuta(self):
        org = self.org_client()
        status, s = org.call("POST", "/api/org/licenses", {"email": "Fisio@Clinica.test"})
        self.assertEqual(status, 201)
        self.assertEqual((s["seats"]["used"], s["professionals"][0]["linked"]), (1, False))
        self.assertEqual(org.call("POST", "/api/org/licenses", {"email": "fisio@clinica.test"})[0], 400, "ya activa")
        # El profesional entra con Google con ese correo y elige "Fisioterapeuta": queda vinculado.
        user = Client(self.api, self.login("fisio@clinica.test", "g-fisio")["token"])
        _, chosen = user.call("POST", "/api/auth/role", {"role": "therapist", "name": "Lic. Prueba"})
        doctor = Client(self.api, chosen["token"])
        doctor.call("POST", "/api/patients", {"alias": "Paciente A"})
        doctor.call("POST", "/api/patients", {"alias": "Paciente B"})
        _, s = org.call("GET", "/api/org/summary")
        self.assertEqual((s["professionals"][0]["linked"], s["professionals"][0]["patients"], s["patients"]["total"]), (True, 2, 2))
        text = json.dumps(s, ensure_ascii=False)
        for clinical in ("Paciente A", "alias", "session", "soap", "symptom"):
            self.assertNotIn(clinical, text, "el panel de empresa no muestra datos clínicos (I-19)")

    def test_cupo_del_plan_y_licencia_en_otra_organizacion(self):
        org = self.org_client()
        for i in range(5):
            self.assertEqual(org.call("POST", "/api/org/licenses", {"email": f"p{i}@clinica.test"})[0], 201)
        status, body = org.call("POST", "/api/org/licenses", {"email": "sexto@clinica.test"})
        self.assertEqual(status, 400)
        self.assertIn("licencias libres", body["error"])
        self.new_org(email="red@hospital.test")
        other = Client(self.api, self.login("red@hospital.test", "g-red")["token"])
        self.assertEqual(other.call("POST", "/api/org/licenses", {"email": "p0@clinica.test"})[0], 409)

    def test_liberar_una_licencia(self):
        org = self.org_client()
        _, s = org.call("POST", "/api/org/licenses", {"email": "a@clinica.test"})
        lid = s["professionals"][0]["license_id"]
        status, s = org.call("POST", f"/api/org/licenses/{lid}/revoke", {})
        self.assertEqual((status, s["seats"]["used"], s["professionals"][0]["status"]), (200, 0, "revoked"))
        self.assertEqual(org.call("POST", "/api/org/licenses/999/revoke", {})[0], 404)
        self.assertEqual(org.call("POST", "/api/org/licenses", {"email": "a@clinica.test"})[0], 201, "se puede reinvitar")

    def test_historia_clinica_solo_https_y_sin_credenciales(self):
        org = self.org_client()
        self.assertEqual(org.call("PUT", "/api/org/ehr", {"fhir_base_url": "http://ehr.test/fhir", "enabled": True})[0], 400)
        self.assertEqual(org.call("PUT", "/api/org/ehr", {"fhir_base_url": "https://ehr.test/fhir", "token": "x"})[0], 400)
        status, s = org.call("PUT", "/api/org/ehr", {"fhir_base_url": "https://ehr.test/fhir/", "enabled": True})
        self.assertEqual((status, s["ehr"]), (200, {"fhir_base_url": "https://ehr.test/fhir", "enabled": True}))

    def test_documento_fhir_de_la_nota_soap(self):
        _, t = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})
        doctor = Client(self.api, t["token"])
        _, p = doctor.call("POST", "/api/patients", {"alias": "Paciente A", "birth_year": 1950})
        _, joined = Client(self.api).call("POST", "/api/join", {"code": p["patient"]["invite_code"], "consent": True})
        patient = Client(self.api, joined["token"])
        doctor.call("PUT", f"/api/patients/{p['patient']['id']}/plan",
                    {"exercises": [{"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3}]})
        now = datetime.now(timezone.utc)
        _, s = patient.call("POST", "/api/sessions", {
            "exercise_id": "sit-to-stand", "mode": "monitored", "source": "demo", "started_at": (now - timedelta(minutes=3)).isoformat(),
            "ended_at": now.isoformat(), "end_reason": "completed", "reps_done": 5,
            "reps": [{"index": i, "calibration": i <= 3, "kneeRom": 90.0} for i in range(1, 6)], "events": []})
        sid = s["session_id"]
        self.assertEqual(doctor.call("GET", f"/api/sessions/{sid}/fhir/document")[0], 404, "sin nota no hay documento")
        doctor.call("POST", f"/api/sessions/{sid}/report")
        status, bundle = doctor.call("GET", f"/api/sessions/{sid}/fhir/document")
        self.assertEqual((status, bundle["type"], bundle["entry"][0]["resource"]["status"]), (200, "document", "preliminary"))
        self.assertNotIn("1950", json.dumps(bundle))
        # Con licencia de una organización, la organización va como custodio.
        self.new_org()
        tid = self.api.db.execute("SELECT id FROM therapist WHERE name = 'Lic. Demo'").fetchone()["id"]
        self.api.db.execute("INSERT INTO org_license (organization_id, email, therapist_id, status, created_at) "
                            "VALUES (1, 'demo@clinica.test', ?, 'active', 'x')", (tid,))
        doctor.call("POST", f"/api/sessions/{sid}/report/approve", {"A": "Tolera bien."})
        _, bundle = doctor.call("GET", f"/api/sessions/{sid}/fhir/document")
        comp = bundle["entry"][0]["resource"]
        self.assertEqual(comp["status"], "final")
        self.assertIn("custodian", comp)
        _, other = Client(self.api).call("POST", "/api/therapists", {"name": "Otra"})
        self.assertEqual(Client(self.api, other["token"]).call("GET", f"/api/sessions/{sid}/fhir/document")[0], 404)


class MigrationTest(unittest.TestCase):
    def test_una_base_anterior_gana_los_roles_org_y_guest(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "vieja.sqlite3"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE token (token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN "
                        "('therapist', 'patient', 'admin', 'user')), subject_id INTEGER NOT NULL, created_at TEXT NOT NULL)")
            con.execute("INSERT INTO token VALUES ('t1', 'therapist', 1, 'x')")
            con.commit()
            con.close()
            api = StagingApi(db, CATALOG)
            sql = api.db.execute("SELECT sql FROM sqlite_master WHERE name = 'token'").fetchone()["sql"]
            self.assertIn("'org'", sql)
            self.assertIn("'guest'", sql)
            self.assertEqual(api.db.execute("SELECT role FROM token WHERE token = 't1'").fetchone()["role"], "therapist")
            self.assertTrue(api.db.execute("SELECT 1 FROM sqlite_master WHERE name = 'org_license'").fetchone())
            api.db.close()


if __name__ == "__main__":
    unittest.main()
