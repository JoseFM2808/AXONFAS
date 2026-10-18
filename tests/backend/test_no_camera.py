"""Sesión sin cámara (TD-110, TD-111): la bandera la pone el servidor, la nota SOAP y FHIR lo dicen. Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(ROOT / "src"))
from staging_api import StagingApi, load_catalog  # noqa: E402
from agents import soap  # noqa: E402

CATALOG = load_catalog(ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js")
NOTE = "Sesión completada sin cámara. No se registraron métricas cinemáticas ni detección de fallos posturales."


class Client:
    def __init__(self, api, token=None):
        self.api, self.token = api, token

    def call(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        return self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")


class NoCameraTest(unittest.TestCase):
    def setUp(self):
        self.api = StagingApi(":memory:", CATALOG)
        self.addCleanup(self.api.db.close)
        _, t = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})
        self.doctor = Client(self.api, t["token"])
        _, p = self.doctor.call("POST", "/api/patients", {"alias": "Paciente A"})
        self.pid = p["patient"]["id"]
        _, j = Client(self.api).call("POST", "/api/join", {"code": p["patient"]["invite_code"], "consent": True})
        self.patient = Client(self.api, j["token"])
        self.doctor.call("PUT", f"/api/patients/{self.pid}/plan",
                         {"exercises": [{"exercise_id": "half-squat", "sets": 2, "reps": 5, "per_week": 3}]})

    def save(self, **over):
        now = datetime.now(timezone.utc)
        body = {"exercise_id": "half-squat", "mode": "guided", "source": "guided", "started_at": (now - timedelta(minutes=4)).isoformat(),
                "ended_at": now.isoformat(), "end_reason": "completed", "reps_done": 10}
        body.update(over)
        return self.patient.call("POST", "/api/sessions", body)

    def test_sin_camara_queda_marcada_con_su_motivo(self):
        status, body = self.save(no_camera_reason="denied")
        self.assertEqual((status, body["no_camera"]), (201, True))
        row = self.api.db.execute("SELECT no_camera, no_camera_reason FROM session WHERE id = ?", (body["session_id"],)).fetchone()
        self.assertEqual((row["no_camera"], row["no_camera_reason"]), (1, "denied"))
        _, body = self.save(no_camera_reason="cualquier cosa")
        row = self.api.db.execute("SELECT no_camera_reason FROM session WHERE id = ?", (body["session_id"],)).fetchone()
        self.assertEqual(row["no_camera_reason"], "guided_view", "un motivo desconocido queda como vista guiada")

    def test_la_bandera_no_la_decide_el_cliente(self):
        _, body = self.save(source="camera", no_camera_reason="denied", reps=[{"index": 1, "peak": 40}])
        row = self.api.db.execute("SELECT no_camera, no_camera_reason FROM session WHERE id = ?", (body["session_id"],)).fetchone()
        self.assertEqual((row["no_camera"], row["no_camera_reason"]), (0, None))

    def test_sin_camara_no_admite_metricas_cinematicas(self):
        self.assertEqual(self.save(reps=[{"index": 1, "peak": 35}])[0], 400)

    def test_el_panel_la_nota_soap_y_fhir_lo_dicen(self):
        _, body = self.save(no_camera_reason="declined")
        sid = body["session_id"]
        _, detail = self.doctor.call("GET", f"/api/patients/{self.pid}")
        self.assertEqual(detail["sessions"][0]["no_camera"], 1)
        _, rep = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertIn(NOTE, rep["report"]["soap"]["O"])
        self.assertNotIn("Compensaciones", rep["report"]["soap"]["O"])
        _, obs = self.doctor.call("GET", f"/api/sessions/{sid}/fhir")
        comp = {c["code"]["coding"][0]["code"]: c for c in obs["component"]}
        self.assertIs(comp["camera-used"]["valueBoolean"], False)
        self.assertEqual(soap.NO_CAMERA_NOTE, NOTE)

    def test_una_base_anterior_marca_sus_sesiones_guiadas(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "vieja.sqlite3"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE session (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, exercise_id TEXT NOT NULL, "
                        "mode TEXT NOT NULL, source TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, "
                        "end_reason TEXT NOT NULL, reps_done INTEGER NOT NULL, baseline TEXT, reps TEXT, "
                        "pain_reported INTEGER NOT NULL DEFAULT 0)")
            con.execute("INSERT INTO session VALUES (1, 1, 'half-squat', 'guided', 'guided', 'a', 'b', 'completed', 5, NULL, '[]', 0)")
            con.execute("INSERT INTO session VALUES (2, 1, 'half-squat', 'guided', 'camera', 'a', 'b', 'completed', 5, NULL, '[]', 0)")
            con.commit()
            con.close()
            api = StagingApi(db, CATALOG)
            rows = {r["id"]: (r["no_camera"], r["no_camera_reason"]) for r in api.db.execute("SELECT * FROM session")}
            self.assertEqual(rows, {1: (1, "guided_view"), 2: (0, None)})
            api.db.close()


if __name__ == "__main__":
    unittest.main()
