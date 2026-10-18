"""Idioma de lo que escribe el servidor (TD-116, ADR-030): errores, mensajes al paciente, nota SOAP, FHIR y muro del
invitado en el idioma de `Accept-Language`. Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import ast
import json
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(ROOT / "src"))
import messages  # noqa: E402
import staging_api  # noqa: E402
from staging_api import StagingApi, load_catalog, load_names, load_names_en  # noqa: E402
from agents import soap  # noqa: E402

PROTO = ROOT / "src" / "frontend" / "validation-prototype"
CATALOG = load_catalog(PROTO / "catalog.js")
NAMES = load_names(PROTO / "catalog.js")
NAMES_EN = load_names_en(PROTO / "i18n" / "catalog.en.js")


class Client:
    def __init__(self, api, token=None, lang=None):
        self.api, self.token, self.lang = api, token, lang

    def call(self, method, path, body=None, lang=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        if lang or self.lang:
            headers["Accept-Language"] = lang or self.lang
        return self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")


def templates_of(path: Path, calls: set[str]) -> list[str]:
    """Mensajes de `raise X(...)` del archivo, con {x} en lugar de cada dato variable de un f-string."""
    out = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in calls and node.args):
            continue
        arg = node.args[1] if node.func.id == "ApiError" else node.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            out.append(arg.value)
        elif isinstance(arg, ast.JoinedStr):
            out.append("".join(v.value if isinstance(v, ast.Constant) else "X" for v in arg.values))
    return out


class MessagesTest(unittest.TestCase):
    def test_idioma_de_la_cabecera(self):
        cases = {None: "es", "": "es", "en": "en", "en-US,en;q=0.9": "en", "es-PE": "es", "fr-FR,en;q=0.5": "en",
                 "fr": "es", "es;q=0.2,en;q=0.8": "en", "en;q=0,es": "es", "EN-gb": "en"}
        for header, lang in cases.items():
            self.assertEqual(messages.lang_of(header), lang, header)

    def test_todo_error_de_la_api_tiene_traduccion(self):
        backend = ROOT / "src" / "backend"
        found = (templates_of(backend / "staging_api.py", {"ApiError"}) + templates_of(backend / "organizations.py", {"OrgError"})
                 + templates_of(backend / "google_auth.py", {"AuthError"}))
        self.assertGreater(len(found), 100)
        missing = [m for m in found if messages.tr(m, "en") == m]
        self.assertEqual(missing, [], "falta su entrada en messages.EN")
        for reason in {r for _, _, r in staging_api.WALL_REASONS} | {staging_api.wall_reason("GET", "/x")}:
            self.assertNotEqual(messages.tr(reason, "en"), reason)

    def test_plantillas_con_datos_y_motivos_anidados(self):
        self.assertEqual(messages.tr("Falta 'alias'.", "en"), "'alias' is missing.")
        self.assertEqual(messages.tr("'range_goal.target' debe ser un número entre 0 y 90 °.", "en"),
                         "'range_goal.target' must be a number between 0 and 90 °.")
        self.assertEqual(messages.tr("No se pudo verificar el inicio de sesión con Google: el token venció: vuelve a iniciar sesión", "en"),
                         "The Google sign-in could not be verified: the token expired: sign in again")
        self.assertEqual(messages.tr("Entendido. Para que no moleste, baja solo hasta 70 grados. Si el dolor aumenta, toca Dolor y paramos.", "en"),
                         "Understood. So it does not bother you, only go down to 70 degrees. If the pain increases, tap Pain and we stop.")
        self.assertEqual(messages.tr("algo que no está en la tabla", "en"), "algo que no está en la tabla")
        self.assertEqual(messages.tr("Falta 'alias'.", "es"), "Falta 'alias'.")
        self.assertIsNone(messages.tr(None, "en"))


class ServerLangApiTest(unittest.TestCase):
    def setUp(self):
        self.api = StagingApi(":memory:", CATALOG, NAMES, names_en=NAMES_EN)
        self.addCleanup(self.api.db.close)
        # Sin IA aunque este equipo tenga la clave de Token Factory: la nota sale de la plantilla.
        self.api.ai_status = lambda *_: (200, {"available": False})
        _, t = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})
        self.doctor = Client(self.api, t["token"])
        _, p = self.doctor.call("POST", "/api/patients", {"alias": "Paciente A"})
        self.pid = p["patient"]["id"]
        _, j = Client(self.api).call("POST", "/api/join", {"code": p["patient"]["invite_code"], "consent": True})
        self.patient = Client(self.api, j["token"])
        self.doctor.call("PUT", f"/api/patients/{self.pid}/plan", {"exercises": [
            {"exercise_id": "sit-to-stand", "sets": 1, "reps": 5, "per_week": 3},
            {"exercise_id": "half-squat", "sets": 2, "reps": 5, "per_week": 3}]})

    def save(self, **over):
        now = datetime.now(timezone.utc)
        body = {"exercise_id": "sit-to-stand", "mode": "monitored", "source": "demo", "started_at": (now - timedelta(minutes=3)).isoformat(),
                "ended_at": now.isoformat(), "end_reason": "completed", "reps_done": 5,
                "reps": [{"index": i, "calibration": i <= 3, "kneeRom": 90.0} for i in range(1, 6)],
                "events": [{"rep": 5, "type": "trunk_flexion", "value": 50, "peak": 52, "threshold": 45, "severity": 2}]}
        body.update(over)
        status, out = self.patient.call("POST", "/api/sessions", body)
        self.assertEqual(status, 201)
        return out["session_id"]

    def test_errores_en_el_idioma_de_la_cabecera(self):
        self.assertEqual(Client(self.api).call("GET", "/api/therapists/me")[1]["error"], "Falta el token. Vuelve a entrar.")
        self.assertEqual(Client(self.api).call("GET", "/api/therapists/me", lang="en-US,en;q=0.9")[1]["error"],
                         "The token is missing. Log in again.")
        status, body = self.doctor.call("PUT", f"/api/patients/{self.pid}/plan",
                                        {"exercises": [{"exercise_id": "no-existe", "sets": 1, "reps": 5}]}, lang="en")
        self.assertEqual((status, body["error"]), (400, "The exercise 'no-existe' is not in the catalog."))
        self.assertEqual(Client(self.api).call("GET", "/api/nada", lang="en")[1]["error"], "That route does not exist.")
        self.assertEqual(self.api.handle("POST", "/api/join", {"Accept-Language": "en"}, b"{mal")[1]["error"], "Invalid JSON.")

    def test_mensajes_al_paciente_en_su_idioma(self):
        sid = self.save()
        status, body = self.patient.call("PUT", f"/api/sessions/{sid}/pain", {"score": 8}, lang="en")
        self.assertEqual(status, 200)
        self.assertIn("do not repeat the exercise today", body["message"])
        self.assertIn("seek medical care", body["message"], "la misma fuerza que en español (I-7)")
        status, body = self.patient.call("POST", "/api/me/discomfort", {"option": "red_flag"}, lang="en")
        self.assertEqual((status, body["action"]), (201, "session_stopped"))
        self.assertEqual(body["message"], "We are stopping the session. If the discomfort continues, contact your physiotherapist.")

    def test_nota_soap_en_ingles_con_los_mismos_datos(self):
        sid = self.save()
        status, body = self.doctor.call("POST", f"/api/sessions/{sid}/report", {}, lang="en")
        self.assertEqual(status, 201)
        r = body["report"]
        self.assertEqual(r["lang"], "en")
        self.assertTrue(r["soap"]["O"].startswith(f"{NAMES_EN['sit-to-stand']}, "), r["soap"]["O"])
        self.assertIn("5 of 10 repetitions", r["soap"]["O"])
        self.assertIn("trunk flexion: 1", r["soap"]["O"])
        self.assertEqual(r["soap"]["A"], soap.TEXT["en"]["A"])
        row = self.api.db.execute("SELECT lang, input FROM clinical_report WHERE session_id = ?", (sid,)).fetchone()
        self.assertEqual(row["lang"], "en")
        self.assertEqual(json.loads(row["input"])["exercise_id"], "sit-to-stand")
        # Mismas cifras en los dos idiomas (I-6): solo cambian los textos.
        es = self.doctor.call("GET", f"/api/sessions/{sid}/report", lang="es")[1]["report"]
        self.assertEqual(es["lang"], "es")
        self.assertEqual(re.findall(r"\d+", es["soap"]["O"]), re.findall(r"\d+", r["soap"]["O"]))

    def test_borrador_sin_firmar_se_lee_en_el_idioma_de_quien_lo_abre_y_se_firma_lo_que_se_ve(self):
        sid = self.save()
        self.assertEqual(self.doctor.call("POST", f"/api/sessions/{sid}/report", {})[1]["report"]["lang"], "es")
        en = self.doctor.call("GET", f"/api/sessions/{sid}/report", lang="en")[1]["report"]
        self.assertEqual(en["lang"], "en")
        self.assertIn("Compensations:", en["soap"]["O"])
        stored = self.api.db.execute("SELECT soap_draft, lang FROM clinical_report WHERE session_id = ?", (sid,)).fetchone()
        self.assertEqual(stored["lang"], "es", "leer en otro idioma no cambia lo guardado")
        self.assertIn("Compensaciones:", json.loads(stored["soap_draft"])["O"])
        status, signed = self.doctor.call("POST", f"/api/sessions/{sid}/report/approve", {"A": "Good tolerance."}, lang="en")
        self.assertEqual((status, signed["report"]["status"], signed["report"]["lang"]), (200, "final", "en"))
        self.assertEqual(signed["report"]["soap"]["A"], "Good tolerance.")
        # Firmada, no cambia de idioma (I-8).
        again = self.doctor.call("GET", f"/api/sessions/{sid}/report", lang="es")[1]["report"]
        self.assertEqual((again["lang"], again["soap"]), ("en", signed["report"]["soap"]))

    def test_lo_que_redacto_la_ia_queda_en_su_idioma(self):
        from agents.llm import FakeLLM
        sid = self.save()
        self.api.ai_status = lambda *_: (200, {"available": True})
        self.api._llm = lambda *_: FakeLLM(default='{"A": "Tolera el ejercicio.", "P": "Mantener la dosis."}')
        r = self.doctor.call("POST", f"/api/sessions/{sid}/report", {}, lang="es")[1]["report"]
        self.assertEqual(r["source"], "llm")
        en = self.doctor.call("GET", f"/api/sessions/{sid}/report", lang="en")[1]["report"]
        self.assertEqual((en["lang"], en["soap"]["A"]), ("es", "Tolera el ejercicio."))

    def test_sin_camara_dice_el_texto_fijo_del_idioma(self):
        sid = self.save(exercise_id="half-squat", mode="guided", source="guided", reps=[], events=[], reps_done=10)
        o = self.doctor.call("POST", f"/api/sessions/{sid}/report", {}, lang="en")[1]["report"]["soap"]["O"]
        self.assertIn(soap.NO_CAMERA_NOTES["en"], o)
        self.assertNotIn("Compensations", o)
        # doctor.js muestra el mismo aviso con 'doctor.nocam': mismo texto en los dos idiomas.
        clinic = (PROTO / "i18n" / "clinic.js").read_text(encoding="utf-8")
        shown = re.findall(r"'doctor\.nocam': '([^']+)'", clinic)
        self.assertEqual(shown, [soap.NO_CAMERA_NOTES["es"], soap.NO_CAMERA_NOTES["en"]])

    def test_fhir_en_ingles_mantiene_sus_codigos(self):
        sid = self.save()
        _, es = self.doctor.call("GET", f"/api/sessions/{sid}/fhir")
        _, en = self.doctor.call("GET", f"/api/sessions/{sid}/fhir", lang="en")
        self.assertEqual((es["language"], en["language"]), ("es", "en"))
        codes = lambda o: [c["code"]["coding"][0]["code"] for c in o["component"]]  # noqa: E731
        self.assertEqual(codes(es), codes(en))
        self.assertEqual(en["code"]["coding"][0]["code"], "sit-to-stand")
        displays = {c["code"]["coding"][0]["code"]: c["code"]["text"] for c in en["component"]}
        self.assertEqual(displays["reps-done"], "Repetitions done")
        self.assertEqual(displays["trunk-flexion-events"], "Trunk flexion events")
        end = next(c for c in en["component"] if c["code"]["coding"][0]["code"] == "end-reason")["valueCodeableConcept"]
        self.assertEqual((end["coding"][0]["code"], end["text"]), ("completed", "Session completed"))
        self.assertEqual(en["meta"]["tag"][0]["code"], "staging-synthetic")
        self.assertEqual(en["code"]["text"], f"Therapeutic exercise session: {NAMES_EN['sit-to-stand']}")
        # El documento va en el idioma de la nota.
        self.doctor.call("POST", f"/api/sessions/{sid}/report", {}, lang="en")
        _, doc = self.doctor.call("GET", f"/api/sessions/{sid}/fhir/document", lang="en")
        comp = doc["entry"][0]["resource"]
        self.assertEqual((doc["language"], comp["language"]), ("en", "en"))
        self.assertEqual([s["title"] for s in comp["section"]], ["Subjective", "Objective", "Assessment", "Plan"])
        self.assertEqual([s["code"]["coding"][0]["code"] for s in comp["section"]], ["61150-9", "61149-1", "51848-0", "18776-5"])
        self.assertTrue(comp["title"].startswith("SOAP note · "))

    def test_bases_anteriores_ganan_las_columnas_del_idioma(self):
        import sqlite3
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "vieja.sqlite3"
            con = sqlite3.connect(db)
            con.executescript(staging_api.SCHEMA.replace(
                "  lang TEXT NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),   -- idioma en que está escrita la nota (TD-116)\n", "").replace(
                "  input TEXT,                          -- JSON: la entrada de soap.facts al crear la nota (para redactarla en otro idioma)\n", ""))
            self.assertNotIn("lang", {r[1] for r in con.execute("PRAGMA table_info(clinical_report)")})
            con.close()
            api = StagingApi(db, CATALOG)
            cols = {r["name"] for r in api.db.execute("PRAGMA table_info(clinical_report)")}
            api.db.close()
            self.assertTrue({"lang", "input"} <= cols)


class GuestLangTest(unittest.TestCase):
    def setUp(self):
        self.api = StagingApi(":memory:", CATALOG, NAMES, names_en=NAMES_EN)
        self.addCleanup(self.api.db.close)
        _, body = Client(self.api).call("POST", "/api/auth/guest", {})
        self.guest = Client(self.api, body["token"])

    def test_muro_con_motivo_en_el_idioma_de_la_pagina(self):
        status, body = self.guest.call("POST", "/api/patients", {"alias": "X"}, lang="en")
        self.assertEqual((status, body["code"], body["reason"]), (401, "auth_required", "add a patient"))
        self.assertEqual(body["error"], "You need an account for this: create yours or sign in with Google.")
        status, body = self.guest.call("POST", "/api/patients", {"alias": "X"})
        self.assertEqual(body["reason"], "afiliar a un paciente")
        self.assertEqual(self.guest.call("POST", "/api/sessions", {}, lang="en")[1]["reason"], "save your progress")
        self.assertEqual(self.guest.call("POST", "/api/sessions/1/report/approve", {}, lang="en")[1]["reason"],
                         "create or sign a SOAP note")

    def test_consultorio_de_muestra_legible_en_los_dos_idiomas(self):
        _, me = self.guest.call("GET", "/api/therapists/me", lang="en")
        self.assertIn("Guest sample", me["therapist"]["name"])
        self.assertIn("Muestra para invitados", me["therapist"]["name"])
        pid = me["patients"][0]["id"]
        self.assertEqual(me["patients"][0]["alias"], "Paciente de muestra · Sample patient")
        _, detail = self.guest.call("GET", f"/api/patients/{pid}", lang="en")
        sid = next(s["id"] for s in detail["sessions"] if s["exercise_id"] == "sit-to-stand")
        _, rep = self.guest.call("GET", f"/api/sessions/{sid}/report", lang="en")
        self.assertEqual(rep["report"]["lang"], "en", "la nota de muestra se lee en inglés")
        self.assertIn("Compensations:", rep["report"]["soap"]["O"])
        _, rep = self.guest.call("GET", f"/api/sessions/{sid}/report")
        self.assertIn("Compensaciones:", rep["report"]["soap"]["O"])

    def test_muestra_creada_antes_de_td116_se_pone_al_dia(self):
        tid = self.api._guest_sandbox()
        with self.api.db:
            self.api.db.execute("UPDATE therapist SET name = ? WHERE id = ?", (staging_api.GUEST_OLD_NAMES["therapist"], tid))
            self.api.db.execute("UPDATE patient SET alias = ? WHERE therapist_id = ?", (staging_api.GUEST_OLD_NAMES["patient"], tid))
            self.api.db.execute("UPDATE clinical_report SET input = NULL")
        self.api._guest_sandbox()
        self.assertEqual(self.api.db.execute("SELECT name FROM therapist WHERE id = ?", (tid,)).fetchone()[0],
                         staging_api.GUEST_THERAPIST_NAME)
        self.assertEqual(self.api.db.execute("SELECT alias FROM patient WHERE therapist_id = ?", (tid,)).fetchone()[0],
                         staging_api.GUEST_PATIENT_ALIAS)
        self.assertIsNotNone(self.api.db.execute("SELECT input FROM clinical_report").fetchone()[0])


class AdviceLangTest(unittest.TestCase):
    """El resumen con IA con la interfaz en inglés: las sugerencias llegan en inglés y se revisan contra los dos catálogos."""

    def setUp(self):
        from agents.llm import FakeLLM
        self.FakeLLM = FakeLLM
        self.api = StagingApi(":memory:", CATALOG, NAMES, names_en=NAMES_EN)
        self.addCleanup(self.api.db.close)
        _, t = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})
        self.doctor = Client(self.api, t["token"], lang="en")
        _, p = self.doctor.call("POST", "/api/patients", {"alias": "Paciente A"})
        self.pid = p["patient"]["id"]
        self.doctor.call("PUT", f"/api/patients/{self.pid}/plan", {"exercises": [{"exercise_id": "hip-bridge", "sets": 2, "reps": 8}]})
        self.api.ai_status = lambda *_: (200, {"available": True})
        self.suggestions = [{"title": f"Swap {NAMES_EN['hip-bridge']} for {NAMES_EN['seated-trunk-rotation']}",
                             "detail": "Fits the profile.", "because": "It is done on the floor.", "priority": 1}]

    def ask(self, reply):
        llm = self.FakeLLM(default=reply)
        self.api._llm = lambda *_: llm
        status, out = self.doctor.call("POST", f"/api/patients/{self.pid}/advice", {"suggestions": self.suggestions})
        self.assertEqual(status, 200)
        return out, llm

    def test_acepta_un_resumen_valido_en_ingles(self):
        out, llm = self.ask(f"Review the {NAMES_EN['hip-bridge'].lower()} first and consider the {NAMES_EN['seated-trunk-rotation'].lower()}.")
        self.assertEqual(out["source"], "llm", out)
        self.assertIn("inglés", llm.calls[0][0]["content"], "se le pide el resumen en inglés")

    def test_rechaza_un_ejercicio_en_ingles_que_no_viene_al_caso_y_explica_en_ingles(self):
        out, _ = self.ask(f"Add the {NAMES_EN['one-leg-stand'].lower()} for balance.")
        self.assertEqual(out["source"], "rejected")
        self.assertEqual(out["reason"], "the summary names exercises that are neither in the plan nor in the suggestions")
        out, _ = self.ask(f"Agrega {NAMES['one-leg-stand']} para el equilibrio.")
        self.assertEqual(out["source"], "rejected", "el nombre en español tampoco pasa")


if __name__ == "__main__":
    unittest.main()
