"""Tests de la API de Staging (ADR-012, ADR-013). Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
from staging_api import StagingApi, Stream, compute_metrics, load_catalog  # noqa: E402

CATALOG = load_catalog(ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js")


class Client:
    """Llama a la API como lo haría el navegador."""

    def __init__(self, api, token=None):
        self.api, self.token = api, token

    def call(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        result = self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")
        return result if isinstance(result, Stream) else result


def iso(dt):
    return dt.isoformat()


class StagingApiTest(unittest.TestCase):
    def setUp(self):
        self.api = StagingApi(":memory:", CATALOG)
        status, body = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})
        self.assertEqual(status, 201)
        self.doctor = Client(self.api, body["token"])
        status, body = self.doctor.call("POST", "/api/patients", {"alias": "Paciente A", "birth_year": 1950})
        self.assertEqual(status, 201)
        self.patient_id, self.code = body["patient"]["id"], body["patient"]["invite_code"]

    def join(self, consent=True):
        return Client(self.api).call("POST", "/api/join", {"code": self.code.lower(), "consent": consent})

    def plan(self, *items):
        return self.doctor.call("PUT", f"/api/patients/{self.patient_id}/plan", {"exercises": list(items)})

    def session(self, patient, **over):
        now = datetime.now(timezone.utc)
        body = {"exercise_id": "sit-to-stand", "mode": "monitored", "source": "demo", "started_at": iso(now - timedelta(minutes=3)),
                "ended_at": iso(now), "end_reason": "completed", "reps_done": 5,
                "reps": [{"index": i, "calibration": i <= 3, "kneeRom": 90.0} for i in range(1, 6)],
                "events": [{"rep": 5, "type": "trunk_flexion", "value": 50, "peak": 52, "threshold": 45, "severity": 2}]}
        body.update(over)
        return patient.call("POST", "/api/sessions", body)

    def test_catalogo_leido_desde_catalog_js(self):
        self.assertEqual(CATALOG["sit-to-stand"], "auto")
        self.assertEqual(sum(1 for m in CATALOG.values() if m == "auto"), 1, "solo sentarse-pararse se monitorea (ADR-009)")
        self.assertGreaterEqual(len(CATALOG), 20)

    def test_afiliacion_exige_consentimiento_y_el_codigo_es_de_un_solo_uso(self):
        self.assertEqual(self.join(consent=False)[0], 400)
        status, body = self.join()
        self.assertEqual(status, 201)
        self.assertEqual(body["therapist"]["name"], "Lic. Demo")
        self.assertEqual(self.join()[0], 404, "el código no se puede reutilizar")

    def test_sin_token_o_con_rol_equivocado(self):
        self.assertEqual(Client(self.api).call("GET", "/api/therapists/me")[0], 401)
        self.assertEqual(Client(self.api, "falso").call("GET", "/api/therapists/me")[0], 401)
        patient = Client(self.api, self.join()[1]["token"])
        self.assertEqual(patient.call("GET", "/api/therapists/me")[0], 403)

    def test_un_fisioterapeuta_no_ve_pacientes_ajenos(self):
        _, other = Client(self.api).call("POST", "/api/therapists", {"name": "Otra"})
        other = Client(self.api, other["token"])
        self.assertEqual(other.call("GET", f"/api/patients/{self.patient_id}")[0], 404)
        self.assertEqual(other.call("PUT", f"/api/patients/{self.patient_id}/plan", {"exercises": []})[0], 404)

    def test_plan_valida_catalogo_y_sobre(self):
        self.assertEqual(self.plan({"exercise_id": "no-existe", "sets": 1, "reps": 1, "per_week": 1})[0], 400)
        status, body = self.plan(
            {"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3, "safety_envelope": {"trunk_margin": 12}},
            {"exercise_id": "calf-raises", "sets": 2, "reps": 10, "per_week": 6})
        self.assertEqual(status, 200)
        envelope = body["plan"][0]["safety_envelope"]
        self.assertEqual(envelope, {"trunk_margin": 12, "valgus_margin": 10, "max_reps": 10})
        self.assertEqual(body["plan"][1]["safety_envelope"], {}, "los guiados no llevan sobre de cámara")

    def test_sesion_requiere_plan_y_consentimiento(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.assertEqual(self.session(patient)[0], 409, "sin plan para ese ejercicio no hay sesión")
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3})
        status, body = self.session(patient)
        self.assertEqual(status, 201)
        self.assertEqual(self.session(patient, mode="monitored", exercise_id="calf-raises")[0], 400,
                         "un ejercicio guiado no puede venir como monitoreado")

    def test_indicadores_de_cumplimiento_y_efectividad(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 2})
        self.session(patient)
        self.session(patient, events=[], end_reason="pain_stop")
        _, detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")
        m = detail["metrics"]
        self.assertEqual(m["per_exercise"][0]["done_7d"], 1, "solo cuentan las completadas")
        self.assertEqual(m["adherence"], 0.5)
        self.assertEqual(m["pain_stops_30d"], 1)
        self.assertEqual(m["quality"], 1.0, "la última sesión no tuvo compensaciones")
        self.assertEqual(m["quality_series"][0]["clean"], 0.5, "1 de 2 repeticiones de ejercicio con compensación")
        self.assertEqual(len(detail["events"]), 1)

    def test_tendencia_de_calidad_necesita_cuatro_sesiones(self):
        now = datetime.now(timezone.utc)
        plan = [{"exercise_id": "sit-to-stand", "per_week": 3}]
        sessions = []
        for i, clean in enumerate([0.5, 0.5, 0.5, 1.0, 1.0, 1.0]):
            reps = [{"index": 4 + j, "calibration": False, "kneeRom": 90} for j in range(2)]
            sessions.append({"id": i, "exercise_id": "sit-to-stand", "mode": "monitored", "end_reason": "completed",
                             "ended_at": iso(now - timedelta(days=6 - i)), "reps": json.dumps(reps)})
        events = [{"session_id": i, "rep": 4} for i in range(3)]
        m = compute_metrics(plan, sessions, events, now)
        self.assertEqual(m["quality_trend"], 0.5)
        self.assertEqual(m["adherence"], 1.0)

    def test_canal_en_vivo_solo_lleva_datos_permitidos(self):
        patient = Client(self.api, self.join()[1]["token"])
        stream = self.doctor.call("GET", f"/api/patients/{self.patient_id}/live")
        self.assertIsInstance(stream, Stream)
        q = self.api.hub.subscribe(stream.channel)
        status, body = patient.call("POST", "/api/live", {
            "exercise_id": "sit-to-stand", "angles": {"knee": 88.123, "trunk": 20, "foto": 1},
            "points": {"25": [0.5, 0.6], "99": [0, 0], "26": "x"}, "video": "data:...", "phase": "exercising"})
        self.assertEqual(status, 202)
        frame = q.get_nowait()
        self.assertEqual(frame["angles"], {"knee": 88.1, "trunk": 20.0})
        self.assertEqual(frame["points"], {"25": [0.5, 0.6]})
        self.assertNotIn("video", frame)

    def test_seguimiento_de_la_galeria_en_vivo_y_sesion_con_conteo(self):
        """ADR-014: un ejercicio guiado se puede hacer con la cámara (conteo, sin alertas) y queda como guided + camera."""
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "standing-row", "sets": 3, "reps": 8, "per_week": 3})
        stream = self.doctor.call("GET", f"/api/patients/{self.patient_id}/live")
        q = self.api.hub.subscribe(stream.channel)
        patient.call("POST", "/api/live", {
            "exercise_id": "standing-row", "source": "camera", "phase": "tracking", "reps_done": 4, "reps_total": 24,
            "progress": 1.7, "metric": {"label": "Flexión de codo", "value": 92.46, "unit": "°", "extra": "x"},
            "points": {"13": [0.4, 0.5], "15": [0.42, 0.6]}, "view": "diagonal"})
        frame = q.get_nowait()
        self.assertEqual(frame["view"], "diagonal", "desde dónde mira la cámara (ADR-015)")
        self.assertEqual(frame["progress"], 1.0, "el avance se recorta a 0-1")
        self.assertEqual(frame["metric"], {"label": "Flexión de codo", "value": 92.5, "unit": "°"})
        self.assertEqual(set(frame["points"]), {"13", "15"}, "codos y muñecas viajan para los ejercicios de brazo")
        patient.call("POST", "/api/live", {"exercise_id": "standing-row", "metric": {"label": "x", "value": 1, "unit": "kg"},
                                           "view": "arriba"})
        bad = q.get_nowait()
        self.assertNotIn("metric", bad, "solo unidades conocidas")
        self.assertNotIn("view", bad, "solo vistas conocidas")
        status, _ = self.session(patient, exercise_id="standing-row", mode="guided", source="camera", reps=[], events=[],
                                 reps_done=24)
        self.assertEqual(status, 201)
        _, detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")
        self.assertEqual(detail["metrics"]["per_exercise"][0]["done_7d"], 1, "cuenta para el cumplimiento")
        self.assertIsNone(detail["metrics"]["quality"], "sin alertas no hay indicador de calidad")

    def test_senalar_un_musculo_llega_al_paciente(self):
        patient = Client(self.api, self.join()[1]["token"])
        stream = patient.call("GET", "/api/me/stream")
        q = self.api.hub.subscribe(stream.channel)
        status, body = self.doctor.call("POST", f"/api/patients/{self.patient_id}/highlight",
                                        {"muscle": "quadriceps", "note": "Este es el que trabajas"})
        self.assertEqual(status, 202)
        msg = q.get_nowait()
        self.assertEqual((msg["kind"], msg["muscle"], msg["from"]), ("highlight", "quadriceps", "Lic. Demo"))


if __name__ == "__main__":
    unittest.main()
