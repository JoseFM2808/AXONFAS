"""Invitado, muro de autenticación diferido y demo pública (TD-106, TD-107, TD-108, ADR-028). Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(ROOT / "src"))
import staging_api  # noqa: E402
from staging_api import StagingApi, load_catalog  # noqa: E402

CATALOG = load_catalog(ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js")


class Client:
    def __init__(self, api, token=None):
        self.api, self.token = api, token

    def call(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        return self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")


RUN = {"source": "demo", "exercise_id": "sit-to-stand", "end_reason": "completed", "reps_done": 10, "calibration_reps": 3,
       "duration_s": 48, "trunk_events": 1, "valgus_events": 1, "low_confidence_reps": 1}


class GuestTest(unittest.TestCase):
    def setUp(self):
        self.api = StagingApi(":memory:", CATALOG)
        self.addCleanup(self.api.db.close)
        status, body = Client(self.api).call("POST", "/api/auth/guest", {})
        self.assertEqual((status, body["role"]), (201, "guest"))
        self.guest = Client(self.api, body["token"])

    def test_el_invitado_ve_la_interfaz_clinica_de_muestra(self):
        status, me = self.guest.call("GET", "/api/therapists/me")
        self.assertEqual(status, 200)
        self.assertIn("Muestra", me["therapist"]["name"])
        self.assertEqual([p["alias"] for p in me["patients"]], ["Paciente de muestra"])
        pid = me["patients"][0]["id"]
        _, detail = self.guest.call("GET", f"/api/patients/{pid}")
        self.assertEqual(len(detail["sessions"]), 3)
        self.assertEqual(sum(1 for s in detail["sessions"] if s["no_camera"]), 1, "una de las sesiones es sin cámara")
        self.assertEqual(len(detail["events"]), 2)
        monitored = next(s for s in detail["sessions"] if s["mode"] == "monitored")
        self.assertEqual(self.guest.call("GET", f"/api/sessions/{monitored['id']}/report")[0], 200, "la nota de muestra se lee")
        self.assertEqual(self.guest.call("GET", "/api/auth/me")[1], {"role": "guest", "user": None})

    def test_la_muestra_es_una_sola_y_compartida(self):
        _, a = self.guest.call("GET", "/api/therapists/me")
        _, other = Client(self.api).call("POST", "/api/auth/guest", {})
        _, b = Client(self.api, other["token"]).call("GET", "/api/therapists/me")
        self.assertEqual(a["therapist"]["id"], b["therapist"]["id"])
        self.assertEqual(self.api.db.execute("SELECT COUNT(*) FROM therapist").fetchone()[0], 1)

    def test_lo_permanente_o_clinico_pide_cuenta(self):
        _, me = self.guest.call("GET", "/api/therapists/me")
        pid = me["patients"][0]["id"]
        blocked = [("POST", "/api/patients", {"alias": "Otro"}), ("PUT", f"/api/patients/{pid}/plan", {"exercises": []}),
                   ("POST", f"/api/patients/{pid}/invite", {}), ("POST", "/api/sessions", {}), ("GET", "/api/me", None),
                   ("PUT", "/api/me/profile", {}), ("GET", "/api/admin/overview", None), ("GET", "/api/org/summary", None)]
        for method, path, body in blocked:
            status, out = self.guest.call(method, path, body)
            self.assertEqual((status, out.get("code")), (401, "auth_required"), f"{method} {path}")
        detail = self.guest.call("GET", f"/api/patients/{pid}")[1]
        sid = next(s["id"] for s in detail["sessions"] if s["mode"] == "guided" and s["source"] == "camera")
        self.assertEqual(self.guest.call("POST", f"/api/sessions/{sid}/report", {})[1]["code"], "auth_required")

    def test_un_token_sin_rol_de_invitado_no_cambia(self):
        _, t = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})
        doctor = Client(self.api, t["token"])
        self.assertEqual(doctor.call("GET", "/api/me")[0], 403, "un fisioterapeuta sigue recibiendo 403, no el muro")


class DemoRunTest(unittest.TestCase):
    def setUp(self):
        os.environ.pop("AXONFAS_ADMIN_EMAILS", None)
        self.api = StagingApi(":memory:", CATALOG)
        self.addCleanup(self.api.db.close)

    def admin(self):
        uid = self.api.db.execute("INSERT INTO app_user (google_sub, email, role, created_at) VALUES ('g', 'a@x.test', 'admin', 'x')").lastrowid
        return Client(self.api, self.api._token("admin", uid))

    def test_la_demo_publica_guarda_numeros_y_nadie_mas_los_lee(self):
        status, body = Client(self.api).call("POST", "/api/demo/runs", RUN)
        self.assertEqual((status, body), (202, {"ok": True}), "responde sin devolver datos")
        _, guest = Client(self.api).call("POST", "/api/auth/guest", {})
        self.assertEqual(Client(self.api, guest["token"]).call("GET", "/api/admin/demo-runs")[1]["code"], "auth_required")
        self.assertEqual(Client(self.api).call("GET", "/api/admin/demo-runs")[0], 401)
        _, data = self.admin().call("GET", "/api/admin/demo-runs")
        self.assertEqual((data["total"], data["by_source"], data["with_valgus_events"]), (1, {"demo": 1}, 1))
        self.assertEqual(set(data["recent"][0]), {"id", "source", "end_reason", "reps_done", "calibration_reps", "duration_s",
                                                   "trunk_events", "valgus_events", "low_confidence_reps", "created_at"})

    def test_validacion_estricta(self):
        bad = [{**RUN, "source": "video"}, {**RUN, "exercise_id": "half-squat"}, {**RUN, "end_reason": "x"},
               {**RUN, "reps_done": 999}, {**RUN, "reps_done": "diez"}, {**RUN, "trunk_events": -1}]
        for body in bad:
            self.assertEqual(Client(self.api).call("POST", "/api/demo/runs", body)[0], 400, body)
        Client(self.api).call("POST", "/api/demo/runs", {**RUN, "points": [[0.1, 0.2]], "name": "Ana"})
        cols = {r["name"] for r in self.api.db.execute("PRAGMA table_info(demo_run)")}
        self.assertFalse({"points", "name", "video"} & cols, "no hay dónde guardar puntos, nombres ni video")

    def test_tope_por_hora(self):
        old = staging_api.DEMO_RUNS_PER_HOUR
        staging_api.DEMO_RUNS_PER_HOUR = 2
        self.addCleanup(setattr, staging_api, "DEMO_RUNS_PER_HOUR", old)
        for _ in range(2):
            self.assertEqual(Client(self.api).call("POST", "/api/demo/runs", RUN)[0], 202)
        self.assertEqual(Client(self.api).call("POST", "/api/demo/runs", RUN)[0], 429)


if __name__ == "__main__":
    unittest.main()
