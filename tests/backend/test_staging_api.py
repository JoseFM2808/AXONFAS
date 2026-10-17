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
from staging_api import REST_DEFAULT_SECONDS, SYMPTOM_OPTIONS, StagingApi, Stream, compute_metrics, load_catalog  # noqa: E402
from agents import coach  # noqa: E402

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

    def test_sobre_con_rango_de_rodilla(self):
        def put(env):
            return self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3, "safety_envelope": env})
        status, body = put({"rom_min": 60, "rom_max": 110})
        self.assertEqual(status, 200)
        self.assertEqual(body["plan"][0]["safety_envelope"],
                         {"trunk_margin": 15, "valgus_margin": 10, "max_reps": 10, "rom_min": 60, "rom_max": 110})
        for env in [{"rom_min": 60}, {"rom_max": 110}, {"rom_min": 110, "rom_max": 60}, {"rom_min": 5, "rom_max": 110}]:
            self.assertEqual(put(env)[0], 400, env)

    def test_descanso_recomendado_en_el_plan(self):
        def put(**rest):
            return self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3, **rest})
        status, body = put()
        self.assertEqual((status, body["plan"][0]["rest"]), (200, {"min": 60, "max": 60, "default": True}))
        envelope = body["plan"][0]["safety_envelope"]
        status, body = put(rest_min_seconds=45, rest_max_seconds=90)
        self.assertEqual(body["plan"][0]["rest"], {"min": 45, "max": 90, "default": False})
        self.assertEqual(put(rest_min_seconds=30)[1]["plan"][0]["rest"], {"min": 30, "max": 30, "default": False})
        self.assertEqual(put(rest_min_seconds=90, rest_max_seconds=45)[0], 400)
        self.assertEqual(put(rest_min_seconds=5)[0], 400)
        self.assertEqual(put(rest_max_seconds=181)[0], 400)
        self.assertEqual(put(rest_min_seconds=True)[0], 400)
        self.assertEqual(put(rest_min_seconds=45)[1]["plan"][0]["safety_envelope"], envelope, "el descanso no toca el sobre")
        guided = self.plan({"exercise_id": "calf-raises", "sets": 2, "reps": 10, "per_week": 6, "rest_min_seconds": 20})
        self.assertEqual(guided[1]["plan"][0]["rest"]["min"], 20, "vale también para ejercicios guiados")

    def test_descanso_por_defecto_coincide_con_el_catalogo(self):
        import re
        text = (ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js").read_text(encoding="utf-8")
        self.assertEqual(int(re.search(r"REST_DEFAULT_SECONDS = (\d+)", text).group(1)), REST_DEFAULT_SECONDS)

    def test_base_anterior_al_descanso_arranca_con_el_valor_por_defecto(self):
        import sqlite3
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "old.sqlite3"
            old = sqlite3.connect(path)
            old.executescript("""
              CREATE TABLE therapist (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
              CREATE TABLE patient (id INTEGER PRIMARY KEY, therapist_id INTEGER NOT NULL, alias TEXT NOT NULL, birth_year INTEGER,
                consent_given INTEGER NOT NULL DEFAULT 0, invite_code TEXT UNIQUE, joined_at TEXT, created_at TEXT NOT NULL, profile TEXT);
              CREATE TABLE plan_exercise (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, exercise_id TEXT NOT NULL,
                sets INTEGER NOT NULL, reps INTEGER NOT NULL, hold_seconds INTEGER NOT NULL, per_week INTEGER NOT NULL,
                safety_envelope TEXT NOT NULL, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
              INSERT INTO therapist VALUES (1, 'Lic. Vieja', '2026-10-01T00:00:00+00:00');
              INSERT INTO patient VALUES (1, 1, 'Paciente Viejo', NULL, 1, NULL, '2026-10-01T00:00:00+00:00', '2026-10-01T00:00:00+00:00', NULL);
              INSERT INTO plan_exercise VALUES (1, 1, 'calf-raises', 2, 10, 0, 6, '{}', NULL, 1, '2026-10-01T00:00:00+00:00');
            """)
            old.commit()
            old.close()
            api = StagingApi(path, CATALOG)
            try:
                self.assertEqual(api._plan(1)[0]["rest"], {"min": 60, "max": 60, "default": True})
                self.assertEqual(api.db.execute("SELECT COUNT(*) FROM symptom_report").fetchone()[0], 0)
            finally:
                api.db.close()

    def test_sesion_requiere_plan_y_consentimiento(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.assertEqual(self.session(patient)[0], 409, "sin plan para ese ejercicio no hay sesión")
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3})
        status, body = self.session(patient)
        self.assertEqual(status, 201)
        self.assertEqual(self.session(patient, mode="monitored", exercise_id="calf-raises")[0], 400,
                         "un ejercicio guiado no puede venir como monitoreado")

    def test_eventos_con_numeros_invalidos_no_rompen_la_api(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3})
        base = {"rep": 5, "type": "trunk_flexion", "severity": 2}
        for bad in [{"value": {"x": 1}}, {"peak": "52"}, {"threshold": True}, {"value": float("inf")}]:
            self.assertEqual(self.session(patient, events=[{**base, **bad}])[0], 400, bad)
        self.assertEqual(self.session(patient, events=[{**base, "value": None}])[0], 201)
        status, body = self.session(patient, events=[{**base, "value": 50, "alertLatencyMs": -5}])
        self.assertEqual(status, 201)
        row = self.api.db.execute("SELECT * FROM compensation_event WHERE session_id = ?", (body["session_id"],)).fetchone()
        self.assertIsNone(row["alert_latency_ms"])
        status, body = self.session(patient, events=[{**base, "alertLatencyMs": 120}])
        row = self.api.db.execute("SELECT * FROM compensation_event WHERE session_id = ?", (body["session_id"],)).fetchone()
        self.assertEqual(row["alert_latency_ms"], 120)

    def test_codigo_nuevo_pide_consentimiento_otra_vez(self):
        self.join()
        detail = lambda: self.doctor.call("GET", f"/api/patients/{self.patient_id}")[1]["patient"]
        self.assertTrue(detail()["consent_given"])
        self.assertEqual(self.doctor.call("POST", f"/api/patients/{self.patient_id}/invite")[0], 200)
        p = detail()
        self.assertEqual((p["consent_given"], p["joined_at"]), (False, None))
        self.assertTrue(p["invite_code"])
        self.code = p["invite_code"]
        self.assertEqual(self.join(consent=False)[0], 400)
        self.assertFalse(detail()["consent_given"])
        self.assertEqual(self.join()[0], 201)
        self.assertTrue(detail()["consent_given"])

    def test_codigo_nuevo_revoca_los_tokens_del_paciente(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.assertEqual(patient.call("GET", "/api/me")[0], 200)
        status, body = self.doctor.call("POST", f"/api/patients/{self.patient_id}/invite")
        self.assertEqual((status, body["revoked_devices"]), (200, 1))
        self.assertEqual(patient.call("GET", "/api/me")[0], 401)
        self.assertEqual(self.doctor.call("GET", "/api/therapists/me")[0], 200)

    # ------------------------------------------------------------------ nota SOAP (TD-09)
    def monitored_session(self):
        """Paciente afiliado, plan sentarse-pararse y una sesión monitoreada; devuelve (paciente, id de la sesión)."""
        self.api.names = {"sit-to-stand": "Sentarse y pararse", "calf-raises": "Elevación de talones"}
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3})
        status, body = self.session(patient)
        self.assertEqual(status, 201)
        return patient, body["session_id"]

    def test_borrador_soap_sin_gpu_usa_la_plantilla(self):
        _, sid = self.monitored_session()
        status, body = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertEqual(status, 201)
        r = body["report"]
        self.assertEqual((r["status"], r["source"], r["reviewed_by"]), ("draft", "template", None))
        self.assertIn("5 de 10", r["soap"]["O"])
        self.assertIn("flexión de tronco: 1", r["soap"]["O"])
        self.assertIn("Flexión media de rodilla: 90.0°", r["soap"]["O"])
        status, again = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertEqual(status, 200)
        self.assertEqual(again["report"]["created_at"], r["created_at"])
        status, got = self.doctor.call("GET", f"/api/sessions/{sid}/report")
        self.assertEqual((status, got["report"]["soap"]), (200, r["soap"]))

    def test_aprobar_firma_y_no_se_puede_volver_a_firmar(self):
        _, sid = self.monitored_session()
        _, created = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        status, body = self.doctor.call("POST", f"/api/sessions/{sid}/report/approve", {"A": "Tolera bien."})
        self.assertEqual(status, 200)
        r = body["report"]
        _, me = self.doctor.call("GET", "/api/therapists/me")
        self.assertEqual((r["status"], r["reviewed_by"], r["soap"]["A"]), ("final", me["therapist"]["id"], "Tolera bien."))
        self.assertEqual((r["soap"]["S"], r["soap"]["O"]), (created["report"]["soap"]["S"], created["report"]["soap"]["O"]))
        self.assertIsNotNone(r["reviewed_at"])
        self.assertEqual(self.doctor.call("POST", f"/api/sessions/{sid}/report/approve", {"A": "Otra."})[0], 409)
        _, detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")
        self.assertEqual(detail["sessions"][0]["report_status"], "final")

    def test_reporte_de_otro_fisioterapeuta_no_existe(self):
        patient, sid = self.monitored_session()
        self.doctor.call("POST", f"/api/sessions/{sid}/report")
        _, other = Client(self.api).call("POST", "/api/therapists", {"name": "Otra"})
        other = Client(self.api, other["token"])
        for method, suffix in [("POST", "/report"), ("GET", "/report"), ("POST", "/report/approve"), ("GET", "/fhir")]:
            self.assertEqual(other.call(method, f"/api/sessions/{sid}{suffix}")[0], 404, (method, suffix))
        self.assertEqual(patient.call("GET", f"/api/sessions/{sid}/report")[0], 403)
        status, body = self.doctor.call("GET", f"/api/sessions/{sid + 100}/report")
        self.assertEqual(status, 404)

    def test_sin_borrador_no_hay_que_leer_ni_aprobar(self):
        _, sid = self.monitored_session()
        self.assertEqual(self.doctor.call("GET", f"/api/sessions/{sid}/report")[0], 404)
        self.assertEqual(self.doctor.call("POST", f"/api/sessions/{sid}/report/approve", {})[0], 404)
        _, detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")
        self.assertIsNone(detail["sessions"][0]["report_status"])

    def test_borrador_con_ia_descarta_cifras_inventadas(self):
        from agents.llm import FakeLLM
        self.api.ai_status = lambda *_: (200, {"available": True})
        patient, first = self.monitored_session()
        second = self.session(patient)[1]["session_id"]
        for sid, text, expected in [(first, '{"A": "Mejoró un 35 %.", "P": "Mantener."}', "template"),
                                    (second, '{"A": "Completó 5 repeticiones.", "P": "Mantener la dosis."}', "llm")]:
            self.api._llm = lambda t=text: FakeLLM(default=t)
            status, body = self.doctor.call("POST", f"/api/sessions/{sid}/report")
            self.assertEqual((status, body["report"]["source"]), (201, expected), text)

    def test_export_fhir_por_api(self):
        _, sid = self.monitored_session()
        status, obs = self.doctor.call("GET", f"/api/sessions/{sid}/fhir")
        self.assertEqual((status, obs["resourceType"], obs["status"]), (200, "Observation", "preliminary"))
        self.assertEqual(obs["subject"]["identifier"]["value"], f"p{self.patient_id}")
        self.assertNotIn("birth_year", json.dumps(obs))
        self.assertIsNone(self.api.db.execute("SELECT 1 FROM clinical_report").fetchone(), "pedir el FHIR no escribe nada")
        self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertEqual(self.doctor.call("GET", f"/api/sessions/{sid}/fhir")[1]["status"], "preliminary")
        self.doctor.call("POST", f"/api/sessions/{sid}/report/approve", {"A": "Tolera bien."})
        _, final = self.doctor.call("GET", f"/api/sessions/{sid}/fhir")
        self.assertEqual(final["status"], "final")
        self.assertTrue(final["note"][0]["text"].startswith("S: "))
        _, other = Client(self.api).call("POST", "/api/therapists", {"name": "Otra"})
        self.assertEqual(Client(self.api, other["token"]).call("GET", f"/api/sessions/{sid}/fhir")[0], 404)

    def test_borrador_de_sesion_guiada(self):
        self.api.names = {"calf-raises": "Elevación de talones"}
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "calf-raises", "sets": 2, "reps": 10, "per_week": 6})
        status, body = self.session(patient, exercise_id="calf-raises", mode="guided", source="guided", reps_done=20, events=[], reps=[])
        self.assertEqual(status, 201)
        _, report = self.doctor.call("POST", f"/api/sessions/{body['session_id']}/report")
        self.assertIn("20 de 20", report["report"]["soap"]["O"])

    def test_borrador_con_reloj_del_paciente_atrasado(self):
        """La hora la pone el dispositivo: si la sesión "termina" antes de crear el plan, la meta sale igual del plan."""
        self.api.names = {"sit-to-stand": "Sentarse y pararse"}
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3})
        past = datetime.now(timezone.utc) - timedelta(days=2)
        status, body = self.session(patient, started_at=iso(past - timedelta(minutes=3)), ended_at=iso(past))
        self.assertEqual(status, 201)
        _, report = self.doctor.call("POST", f"/api/sessions/{body['session_id']}/report")
        self.assertIn("5 de 10", report["report"]["soap"]["O"])
        self.assertNotIn("None", report["report"]["soap"]["O"])

    # ------------------------------------------------------------------ molestias del paciente (ADR-018)
    def symptom(self, patient, **body):
        return patient.call("POST", "/api/me/discomfort", body)

    def detail(self):
        return self.doctor.call("GET", f"/api/patients/{self.patient_id}")[1]

    def test_molestia_se_registra_y_avisa_al_fisioterapeuta(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "calf-raises", "sets": 2, "reps": 10, "per_week": 6})
        q = self.api.hub.subscribe(("therapist", self.patient_id))
        status, body = self.symptom(patient, exercise_id="calf-raises", option="fatigue", text="Estoy cansado", in_session=True)
        self.assertEqual((status, body["action"], body["adjustment"], body["stop"]), (201, "paused", None, False))
        msg = q.get_nowait()
        self.assertEqual((msg["kind"], msg["category"]), ("symptom_reported", "fatigue"))
        d = self.detail()
        self.assertEqual(len(d["symptoms"]), 1)
        self.assertEqual(d["metrics"]["discomfort_30d"], 1)

    def test_alarma_desde_el_formulario_detiene(self):
        patient = Client(self.api, self.join()[1]["token"])
        status, body = self.symptom(patient, option="pain_mild", text="me mareo", in_session=True)
        self.assertEqual((status, body["report"]["kind"], body["action"], body["stop"]), (201, "red_flag", "session_stopped", True))
        self.assertEqual(body["message"], coach.STOP_TEXT)
        self.assertEqual(self.symptom(patient, option="red_flag")[1]["action"], "session_stopped")
        self.assertEqual(self.detail()["metrics"]["red_flags_30d"], 2)

    def test_molestia_en_sentarse_y_pararse_baja_la_exigencia(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3,
                   "safety_envelope": {"rom_min": 60, "rom_max": 110}})
        ask = dict(exercise_id="sit-to-stand", text="me molesta la rodilla", in_session=True)
        _, body = self.symptom(patient, current={"rom_target": 90, "reps": 7}, **ask)
        self.assertEqual((body["action"], body["adjustment"]), ("demand_lowered", {"param": "rom_target", "old": 90, "new": 80}))
        self.assertIn("80", body["message"])
        self.assertEqual(self.symptom(patient, **ask)[1]["action"], "paused", "sin current no hay qué bajar")
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3})
        _, body = self.symptom(patient, current={"rom_target": 90, "reps": 7}, **ask)
        self.assertEqual(body["adjustment"], {"param": "reps", "old": 7, "new": 4}, "sin rango en el sobre no se toca el rango")

    def test_molestia_fuera_de_sesion_solo_se_registra(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3,
                   "safety_envelope": {"rom_min": 60, "rom_max": 110}})
        _, body = self.symptom(patient, exercise_id="sit-to-stand", option="cramp", in_session=False, current={"rom_target": 90})
        self.assertEqual((body["action"], body["adjustment"]), ("logged", None))

    def test_molestia_valida_la_entrada(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.assertEqual(self.symptom(patient, text="x" * 201)[0], 400)
        self.assertEqual(self.symptom(patient, in_session=False)[0], 400)
        self.assertEqual(self.symptom(patient, option="x")[0], 400)
        # Tipos equivocados: 400, nunca 500 ni una excepción sin capturar.
        for bad in [{"option": ["fatigue"]}, {"option": {"a": 1}}, {"option": "fatigue", "exercise_id": {"a": 1}},
                    {"option": "fatigue", "exercise_id": ["sit-to-stand"]}, {"option": "fatigue", "exercise_id": "no-existe"}]:
            self.assertEqual(self.symptom(patient, **bad)[0], 400, bad)
        self.assertEqual(self.symptom(patient, option="fatigue", exercise_id="calf-raises")[0], 409)
        self.assertEqual(self.symptom(self.doctor, option="fatigue")[0], 403)
        self.assertEqual(self.symptom(Client(self.api), option="fatigue")[0], 401)
        self.doctor.call("POST", f"/api/patients/{self.patient_id}/invite")
        self.assertEqual(self.symptom(patient, option="fatigue")[0], 401)

    def test_molestia_sin_consentimiento_no_se_registra(self):
        patient = Client(self.api, self.join()[1]["token"])
        self.api.db.execute("UPDATE patient SET consent_given = 0")
        self.assertEqual(self.symptom(patient, option="fatigue")[0], 403)

    def test_molestia_se_une_a_la_sesion_y_va_a_la_nota(self):
        patient, _ = self.monitored_session()
        _, mine = self.symptom(patient, exercise_id="sit-to-stand", option="fatigue", text="Estoy cansado", in_session=True)
        other_id = self.api.db.execute("INSERT INTO patient (therapist_id, alias, created_at) VALUES (1, 'Otro', 'x')").lastrowid
        foreign = self.api.db.execute("INSERT INTO symptom_report (patient_id, reported_at, kind, category, action, source) "
                                      "VALUES (?, '2026-10-17T10:00:00+00:00', 'discomfort', 'pain', 'logged', 'patient_form')",
                                      (other_id,)).lastrowid
        status, body = self.session(patient, symptom_report_ids=[mine["report"]["id"], foreign, 9999])
        self.assertEqual(status, 201)
        sid = body["session_id"]
        rows = {r["id"]: r["session_id"] for r in self.api.db.execute("SELECT id, session_id FROM symptom_report")}
        self.assertEqual(rows[mine["report"]["id"]], sid)
        self.assertIsNone(rows[foreign], "el reporte de otro paciente no se une")
        _, report = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertIn("cansancio", report["report"]["soap"]["S"])
        self.assertIn("«Estoy cansado»", report["report"]["soap"]["S"])
        self.assertEqual(self.session(patient, symptom_report_ids="1")[0], 400)

    def test_molestia_del_dia_sin_sesion_entra_como_fuera_de_la_sesion(self):
        patient, sid = self.monitored_session()
        self.symptom(patient, option="pain_mild", in_session=False)
        _, report = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertIn("fuera de la sesión", report["report"]["soap"]["S"])

    def test_indicador_de_molestias_ignora_lo_de_hace_31_dias(self):
        now = datetime.now(timezone.utc)
        old = {"reported_at": iso(now - timedelta(days=31)), "kind": "red_flag"}
        new = {"reported_at": iso(now - timedelta(days=2)), "kind": "discomfort"}
        m = compute_metrics([], [], [], now, symptoms=[old, new])
        self.assertEqual((m["discomfort_30d"], m["red_flags_30d"]), (1, 0))

    def test_opciones_del_formulario_coinciden(self):
        src = (ROOT / "src" / "frontend" / "validation-prototype" / "symptom-form.js")
        import re
        ids = re.findall(r"id: '([a-z_]+)'", src.read_text(encoding="utf-8").split("const OPTIONS = [")[1].split("];")[0])
        self.assertEqual(set(ids), set(SYMPTOM_OPTIONS))

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

    def test_conteo_con_camara_guarda_cada_repeticion_y_da_efectividad(self):
        """TD-49: recorrido máximo y sostén por repetición, para indicadores en todos los ejercicios."""
        patient = Client(self.api, self.join()[1]["token"])
        self.plan({"exercise_id": "hip-abduction", "sets": 1, "reps": 3, "hold_seconds": 5, "per_week": 3})
        now = datetime.now(timezone.utc)
        for i, peaks in enumerate([[20.0, 22.0], [30.0, 32.0, 34.0]]):
            reps = [{"index": k + 1, "side": "L", "peak": p, "holdSec": 5.2, "holdOk": True, "seconds": 7.1,
                     "video": "data:...", "nota": "x"} for k, p in enumerate(peaks)]
            reps.append({"index": "9", "peak": "mucho", "holdSec": float("nan"), "side": "arriba", "holdOk": 1})
            status, _ = self.session(patient, exercise_id="hip-abduction", mode="guided", source="camera", events=[],
                                     reps=reps, reps_done=len(peaks), started_at=iso(now - timedelta(days=2 - i, minutes=5)),
                                     ended_at=iso(now - timedelta(days=2 - i)))
            self.assertEqual(status, 201)
        _, detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")
        stored = detail["sessions"][0]["reps"]
        self.assertEqual(stored[0], {"index": 1, "side": "L", "peak": 30.0, "holdSec": 5.2, "holdOk": True, "seconds": 7.1})
        self.assertEqual(stored[-1], {}, "lo que no es un número, un lado o una marca válida no se guarda")
        ex = detail["metrics"]["per_exercise"][0]
        self.assertEqual((ex["camera_first"]["peak"], ex["camera_last"]["peak"], ex["camera_sessions"]), (21.0, 32.0, 2))
        self.assertEqual(ex["camera_last"]["hold"], 5.2)
        self.assertIsNone(detail["metrics"]["rom_last"], "el recorrido de rodilla sigue siendo solo de sesiones monitoreadas")

    def test_perfil_del_paciente_lo_ve_el_fisioterapeuta(self):
        """ADR-017: limitaciones y zonas con dolor, solo opciones cerradas; el fisioterapeuta recibe el aviso en vivo."""
        patient = Client(self.api, self.join()[1]["token"])
        q = self.api.hub.subscribe(("therapist", self.patient_id))
        status, body = patient.call("PUT", "/api/me/profile", {"limitations": ["no_floor", "balance", "no_floor"],
                                                               "pain_areas": ["knee"], "note": "  " + "x" * 300})
        self.assertEqual(status, 200)
        self.assertEqual(body["profile"]["limitations"], ["balance", "no_floor"])
        self.assertEqual(len(body["profile"]["note"]), 200)
        self.assertEqual(q.get_nowait()["kind"], "profile_updated")
        _, detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")
        self.assertEqual(detail["patient"]["profile"]["pain_areas"], ["knee"])
        self.assertEqual(patient.call("GET", "/api/me")[1]["patient"]["profile"]["limitations"], ["balance", "no_floor"])
        self.assertEqual(patient.call("PUT", "/api/me/profile", {"limitations": ["diagnostico"]})[0], 400)
        self.assertEqual(patient.call("PUT", "/api/me/profile", {"limitations": "no_floor"})[0], 400)
        status, body = self.doctor.call("PUT", f"/api/patients/{self.patient_id}/profile", {"limitations": ["walking_aid"]})
        self.assertEqual((status, body["profile"]["limitations"]), (200, ["walking_aid"]))
        _, other = Client(self.api).call("POST", "/api/therapists", {"name": "Otra"})
        self.assertEqual(Client(self.api, other["token"]).call("PUT", f"/api/patients/{self.patient_id}/profile", {})[0], 404)

    def test_resumen_con_ia_solo_si_hay_gpu_y_sin_inventar(self):
        sys.path.insert(0, str(ROOT / "src"))
        from agents.llm import FakeLLM
        suggestions = [{"title": "Cambiar Puente de cadera por Rotación de tronco sentado", "detail": "Encaja con su perfil.",
                        "because": "Se hace en el suelo.", "priority": 1}]
        self.assertEqual(self.doctor.call("POST", f"/api/patients/{self.patient_id}/advice", {"suggestions": suggestions})[0], 503,
                         "sin GPU conectada no hay IA")
        self.assertFalse(self.doctor.call("GET", "/api/ai/status")[1]["available"])
        self.api.names = {"hip-bridge": "Puente de cadera", "seated-trunk-rotation": "Rotación de tronco sentado",
                          "one-leg-stand": "Apoyo en un pie"}
        self.api.ai_status = lambda *_: (200, {"available": True})
        replies = {"good": "Primero revisa el puente de cadera: se hace en el suelo y conviene la rotación de tronco sentado.",
                   "numbers": "Bájale a 4 repeticiones el puente de cadera.",
                   "unknown": "Agrega Apoyo en un pie para el equilibrio."}
        for case, expected in [("good", "llm"), ("numbers", "rejected"), ("unknown", "rejected")]:
            self.api._llm = lambda c=case: FakeLLM(default=replies[c])
            status, out = self.doctor.call("POST", f"/api/patients/{self.patient_id}/advice", {"suggestions": suggestions})
            self.assertEqual((status, out["source"]), (200, expected), case)
        self.assertEqual(self.doctor.call("POST", f"/api/patients/{self.patient_id}/advice", {"suggestions": []})[0], 400)

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
