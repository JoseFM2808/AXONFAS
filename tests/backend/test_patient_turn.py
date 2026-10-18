"""Tests del turno de texto del paciente con el agente clínico (ADR-033): POST /api/me/turn. Solo datos sintéticos y sin
red real: el LLM es un FakeLLM o un servidor local con la forma de AMD Token Factory.

    py -m unittest discover -s tests/backend -v
"""
import json
import os
import sqlite3
import sys
import tempfile
import time

# Hermético: ningún test de este archivo lee el archivo local de claves del owner (settings.load_env_file lo respeta).
os.environ["AXONFAS_ENV_FILE"] = os.path.join(tempfile.gettempdir(), "axonfas-sin-env-para-tests")
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from staging_api import SCHEMA, StagingApi  # noqa: E402
from test_staging_api import CATALOG, Client  # noqa: E402
from fake_tokenfactory import KEY, FakeTokenFactory  # noqa: E402
from agents import coach, providers  # noqa: E402
from agents.llm import LLMError  # noqa: E402
from agents.llm import FakeLLM  # noqa: E402

ENV = ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY", "AMD_TOKENFACTORY_MODEL", "AXONFAS_LLM_KEY", "AXONFAS_LLM_URL",
       "AXONFAS_LLM_MODEL")
SIT = {"exercise_id": "sit-to-stand", "sets": 1, "reps": 10, "per_week": 3,
       "safety_envelope": {"rom_min": 60, "rom_max": 110, "max_reps": 10}}
CUR = {"rom_target": 90, "reps": 7}
ADJ_ROM = '{"action":"adjust","param":"rom_target","old":90,"new":70,"reason":"molestia"}'


class Tagged(FakeLLM):
    """FakeLLM que dice de qué proveedor y modelo habla, como el cliente real."""
    model, label = "Modelo-Falso", "AMD Token Factory"


class Slow(Tagged):
    def chat(self, messages, **kw):
        time.sleep(2)
        return super().chat(messages, **kw)


def llm_pair(clinical_text, coach_text="Baja a 99 grados.", clinical_cls=Tagged):
    """(fábrica para api._llm, FakeLLM clínico, FakeLLM conversacional). El conversacional trae una cifra que no está en
    la decisión, así que la frase vuelve a la plantilla (I-6) salvo que el test pida otra cosa."""
    clinical, talker = clinical_cls(default=clinical_text), Tagged(default=coach_text)
    return (lambda purpose="x", **_: clinical if purpose == "clinical-turn" else talker), clinical, talker


class PatientTurnTest(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in ENV}
        providers._model_cache.clear()
        self.api = StagingApi(":memory:", CATALOG)
        self.api.names = {"sit-to-stand": "Sentarse y pararse", "calf-raises": "Elevación de talones"}
        self.api.TURN_MIN_GAP_S = 0
        self.doctor = Client(self.api, Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})[1]["token"])
        _, body = self.doctor.call("POST", "/api/patients", {"alias": "Paciente A", "birth_year": 1950})
        self.patient_id, code = body["patient"]["id"], body["patient"]["invite_code"]
        self.patient = Client(self.api, Client(self.api).call("POST", "/api/join", {"code": code, "consent": True})[1]["token"])
        self.plan(SIT)

    def tearDown(self):
        self.api._pool.shutdown(wait=False)
        self.api.db.close()
        for k, v in self.saved.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)

    def plan(self, *items, patient_id=None):
        return self.doctor.call("PUT", f"/api/patients/{patient_id or self.patient_id}/plan", {"exercises": list(items)})

    def turn(self, **body):
        return self.patient.call("POST", "/api/me/turn", {"exercise_id": "sit-to-stand", "text": "la rodilla no va bien",
                                                          "in_session": True, "current": CUR, **body})

    def use_ai(self, clinical_text=ADJ_ROM, coach_text="Baja a 99 grados.", **kw):
        self.api.ai_status = lambda *_: (200, {"available": True, "provider": "AMD Token Factory"})
        make, clinical, talker = llm_pair(clinical_text, coach_text, **kw)
        self.api._llm = make
        return clinical, talker

    def rows(self, sql, *args):
        return [dict(r) for r in self.api.db.execute(sql, args)]

    # ------------------------------------------------------------------ reglas, alarma y IA
    def test_sin_ia_es_la_via_de_reglas(self):
        _, old = self.patient.call("POST", "/api/me/discomfort", {"exercise_id": "sit-to-stand", "text": "me molesta la rodilla",
                                                                  "in_session": True, "current": CUR})
        status, new = self.turn(text="me molesta la rodilla")
        self.assertEqual(status, 201)
        for key in ("action", "adjustment", "message", "stop"):
            self.assertEqual(new[key], old[key], key)
        self.assertEqual(new["adjustment"], {"param": "rom_target", "old": 90, "new": 80})
        ai = new["ai"]
        self.assertEqual((ai["decided_by"], ai["provider"], ai["model"], ai["llm_answered"], ai["skipped"]),
                         ("rules", None, None, False, "no_provider"))
        self.assertEqual(self.rows("SELECT source FROM symptom_report WHERE id = ?", new["report"]["id"])[0]["source"], "voice_turn")
        d = self.rows("SELECT agent, outcome, within_envelope FROM agent_decision")
        self.assertEqual(d, [{"agent": "rules", "outcome": "applied", "within_envelope": 1}])
        self.assertEqual((new["decision"]["agent"], new["decision"]["outcome"]), ("rules", "applied"))

    def test_alarma_se_decide_sin_pedir_ningun_llm(self):
        self.api.ai_status = lambda *_: self.fail("la alarma no consulta el estado de la IA")
        self.api._llm = lambda *a, **k: self.fail("la alarma no debe pedir un LLM (I-1, I-7)")
        status, body = self.turn(text="me mareo")
        self.assertEqual((status, body["stop"], body["action"], body["message"]), (201, True, "session_stopped", coach.STOP_TEXT))
        self.assertIsNone(body["decision"])
        self.assertEqual((body["ai"]["skipped"], body["ai"]["decided_by"]), ("red_flag", "rules"))
        self.assertEqual(self.rows("SELECT * FROM agent_decision"), [])
        self.assertEqual(self.rows("SELECT kind, action FROM symptom_report"), [{"kind": "red_flag", "action": "session_stopped"}])
        self.assertEqual(self.turn(text="todo bien", option="red_flag")[1]["action"], "session_stopped")

    def test_ia_valida_baja_dentro_del_sobre(self):
        clinical, talker = self.use_ai()
        status, body = self.turn()
        self.assertEqual(status, 201)
        self.assertEqual(body["adjustment"], {"param": "rom_target", "old": 90, "new": 70})
        self.assertEqual((body["decision"]["agent"], body["decision"]["outcome"], body["decision"]["within_envelope"]),
                         ("clinical", "applied", True))
        ai = body["ai"]
        self.assertEqual((ai["decided_by"], ai["llm_answered"], ai["provider"], ai["model"], ai["error"]),
                         ("llm", True, "AMD Token Factory", "Modelo-Falso", None))
        self.assertEqual((len(clinical.calls), len(talker.calls)), (1, 1), "una llamada clínica y una conversacional por turno")
        self.assertIn("70", body["message"])
        row = self.rows("SELECT agent, ai_model, llm_outcome FROM agent_decision")[0]
        self.assertEqual(row, {"agent": "clinical", "ai_model": "Modelo-Falso", "llm_outcome": None})
        t = self.rows("SELECT action, ai_provider, ai_model, reply_source FROM voice_turn")[0]
        self.assertEqual(t, {"action": "demand_lowered", "ai_provider": "AMD Token Factory", "ai_model": "Modelo-Falso",
                             "reply_source": "template"})

    def test_la_frase_puede_salir_del_agente_conversacional(self):
        self.use_ai(coach_text="Tranquilo, baja hasta 70 grados.")
        body = self.turn()[1]
        self.assertEqual((body["message"], body["ai"]["phrased_by"]), ("Tranquilo, baja hasta 70 grados.", "llm"))
        self.assertEqual(self.rows("SELECT reply_source FROM voice_turn")[0]["reply_source"], "llm")

    def test_ia_fuera_del_sobre_o_subiendo_la_reemplazan_las_reglas(self):
        for outside in ('{"action":"adjust","param":"rom_target","old":90,"new":130,"reason":"x"}',
                        '{"action":"adjust","param":"rom_target","old":90,"new":100,"reason":"x"}'):
            self.api.db.execute("DELETE FROM agent_decision")
            self.use_ai(outside)
            body = self.turn()[1]
            self.assertEqual(body["adjustment"], {"param": "rom_target", "old": 90, "new": 80}, outside)
            self.assertEqual(body["decision"]["agent"], "rules")
            self.assertEqual(body["ai"]["decided_by"], "rules")
            self.assertTrue(body["ai"]["llm_answered"])
            row = self.rows("SELECT agent, outcome, within_envelope, llm_outcome, llm_proposal FROM agent_decision")[0]
            self.assertEqual((row["agent"], row["outcome"], row["within_envelope"], row["llm_outcome"]),
                             ("rules", "applied", 1, "escalated_to_therapist"))
            self.assertIn(str(json.loads(row["llm_proposal"])["new"]), outside)
        self.assertEqual(self.rows("SELECT COUNT(*) AS n FROM agent_decision WHERE outcome = 'applied' AND within_envelope = 0")[0]["n"], 0)

    def test_rest_seconds_no_se_aplica_y_no_viene_del_navegador(self):
        self.use_ai('{"action":"adjust","param":"rest_seconds","old":60,"new":90,"reason":"cansancio"}')
        body = self.turn()[1]
        self.assertEqual(body["adjustment"], {"param": "rom_target", "old": 90, "new": 80}, "la baja es de las reglas")
        row = self.rows("SELECT current, llm_outcome, llm_proposal FROM agent_decision")[0]
        self.assertEqual(json.loads(row["current"])["rest_seconds"], 60)
        self.assertEqual((row["llm_outcome"], json.loads(row["llm_proposal"])["param"]), ("rejected", "rest_seconds"))
        self.plan({**SIT, "rest_min_seconds": 45, "rest_max_seconds": 90})
        self.turn(current={**CUR, "rest_seconds": 170})
        last = self.rows("SELECT current FROM agent_decision ORDER BY id DESC")[0]
        self.assertEqual(json.loads(last["current"])["rest_seconds"], 45, "el descanso sale del plan aunque el navegador mande otro")

    def test_current_del_navegador_se_valida(self):
        clinical, _ = self.use_ai('{"action":"none","reason":"x"}')
        cases = [({"rom_target": "90", "reps": 99}, '{"rest_seconds":60}'),            # texto y por encima de max_reps
                 ({"rom_target": 90.4, "reps": 7.0}, '{"rom_target":90,"reps":7,"rest_seconds":60}'),
                 ({"rom_target": True, "reps": float("nan")}, '{"rest_seconds":60}'),
                 ({"rom_target": 500, "reps": 0}, '{"rest_seconds":60}')]
        for i, (current, expected) in enumerate(cases):
            self.assertEqual(self.turn(current=current)[0], 201)
            self.assertIn('"valores_actuales":' + expected, clinical.calls[i][-1]["content"], current)

    def test_si_la_ia_no_responde_a_tiempo_deciden_las_reglas(self):
        self.use_ai(clinical_cls=Slow)
        self.api.TURN_BUDGET_S = 0.6
        t0 = time.perf_counter()
        status, body = self.turn()
        self.assertEqual(status, 201)
        self.assertLess(time.perf_counter() - t0, 1.5)
        self.assertEqual(body["adjustment"], {"param": "rom_target", "old": 90, "new": 80})
        self.assertEqual((body["ai"]["error"], body["ai"]["decided_by"], body["ai"]["llm_answered"]), ("timeout", "rules", False))
        self.assertEqual(self.rows("SELECT llm_outcome FROM agent_decision")[0]["llm_outcome"], "timeout")

    def test_limite_de_uso_por_paciente_sigue_respondiendo_con_reglas(self):
        self.api.TURN_MIN_GAP_S = 3
        clinical, _ = self.use_ai()
        first, second = self.turn()[1], self.turn()[1]
        self.assertEqual((first["ai"]["decided_by"], first["ai"]["skipped"]), ("llm", None))
        self.assertEqual((second["ai"]["skipped"], second["ai"]["decided_by"], second["ai"]["provider"]), ("rate_limited", "rules", None))
        self.assertEqual(second["adjustment"], {"param": "rom_target", "old": 90, "new": 80})
        self.assertEqual(len(clinical.calls), 1)
        self.api.TURN_MIN_GAP_S, self.api.TURN_MAX_PER_HOUR = 0, 1
        self.assertEqual(self.turn()[1]["ai"]["skipped"], "rate_limited", "20 por hora (aquí 1)")

    def test_limite_de_turnos_a_la_vez(self):
        self.use_ai()
        for _ in range(self.api.TURN_MAX_PARALLEL):
            self.assertTrue(self.api._turn_slots.acquire(blocking=False))
        body = self.turn()[1]
        self.assertEqual((body["ai"]["skipped"], body["ai"]["decided_by"]), ("busy", "rules"))
        for _ in range(self.api.TURN_MAX_PARALLEL):
            self.api._turn_slots.release()
        self.assertEqual(self.turn()[1]["ai"]["decided_by"], "llm", "el lugar se libera")

    def test_ejercicio_guiado_no_consulta_al_agente_clinico(self):
        self.plan({"exercise_id": "calf-raises", "sets": 2, "reps": 10, "per_week": 6})
        clinical, _ = self.use_ai('{"action":"adjust","param":"reps","old":7,"new":3,"reason":"x"}')
        status, body = self.turn(exercise_id="calf-raises", current={})
        self.assertEqual((status, body["action"], body["decision"], body["ai"]["skipped"]), (201, "paused", None, "guided"))
        self.assertEqual(clinical.calls, [])
        self.assertEqual(body["message"], coach.PAUSE_TEXT)
        self.assertEqual(self.rows("SELECT * FROM agent_decision"), [])

    def test_entrada_y_permisos(self):
        self.assertEqual(self.turn(text="")[0], 400)
        self.assertEqual(self.turn(text="x" * 201)[0], 400)
        self.assertEqual(self.turn(text=5)[0], 400)
        self.assertEqual(self.turn(in_session=False)[0], 400)
        self.assertEqual(self.turn(option="x")[0], 400)
        self.assertEqual(self.turn(exercise_id={"a": 1})[0], 400)
        self.assertEqual(self.turn(exercise_id="no-existe")[0], 400)
        self.assertEqual(self.turn(exercise_id="calf-raises")[0], 409, "fuera del plan activo (I-9)")
        self.assertEqual(self.doctor.call("POST", "/api/me/turn", {"exercise_id": "sit-to-stand", "text": "x", "in_session": True})[0], 403)
        self.assertEqual(Client(self.api).call("POST", "/api/me/turn", {})[0], 401)
        self.api.db.execute("UPDATE patient SET consent_given = 0")
        self.assertEqual(self.turn()[0], 403)

    # ------------------------------------------------------------------ idioma, invitado y cadena de modelos (ADR-030/031/032)
    def turn_in(self, lang, **body):
        payload = {"exercise_id": "sit-to-stand", "text": "la rodilla no va bien", "in_session": True, "current": CUR, **body}
        token = self.patient.token
        status, out = self.api.handle("POST", "/api/me/turn", {"Authorization": f"Bearer {token}", "Accept-Language": lang},
                                      json.dumps(payload).encode())
        return status, out

    def test_el_turno_responde_en_el_idioma_de_la_interfaz(self):
        status, body = self.turn_in("en", text="my knee hurts")
        self.assertEqual(status, 201)
        self.assertEqual(body["message"], "Understood. So it does not bother you, only go down to 80 degrees. "
                                          "If the pain increases, tap Pain and we stop.")
        self.assertEqual(self.turn_in("es", text="me molesta")[1]["message"].split(".")[0], "Entendido")
        status, alarm = self.turn_in("en", text="I feel dizzy")
        self.assertEqual((alarm["stop"], alarm["message"]),
                         (True, "We are stopping the session. If the discomfort continues, contact your physiotherapist."))
        self.assertEqual(self.rows("SELECT reply FROM voice_turn ORDER BY id DESC")[0]["reply"], alarm["message"], "se guarda lo que vio el paciente")

    def test_en_ingles_el_conversacional_redacta_en_ingles_y_la_base_esta_en_ingles(self):
        clinical, talker = self.use_ai(coach_text="Okay, only go down to 70 degrees.")
        status, body = self.turn_in("en", text="my knee hurts")
        self.assertEqual((body["message"], body["ai"]["phrased_by"]), ("Okay, only go down to 70 degrees.", "llm"))
        self.assertIn("inglés", talker.calls[0][0]["content"])
        self.assertIn("only go down to 70 degrees", talker.calls[0][-1]["content"])
        self.assertNotIn("baja solo hasta", talker.calls[0][-1]["content"])

    def test_el_invitado_no_puede_usar_el_turno_ni_pide_ningun_llm(self):
        self.api.ai_status = lambda *_: self.fail("el invitado no consulta la IA")
        self.api._llm = lambda *a, **k: self.fail("el invitado no pide un LLM (I-21)")
        _, guest = Client(self.api).call("POST", "/api/auth/guest", {})
        status, body = Client(self.api, guest["token"]).call("POST", "/api/me/turn", {"exercise_id": "sit-to-stand", "text": "me molesta",
                                                                                       "in_session": True})
        self.assertEqual((status, body["code"]), (401, "auth_required"))

    def test_si_responde_la_alternativa_la_pantalla_y_la_base_dicen_ese_modelo(self):
        class Bad:
            model, timeout = "DeepSeek-V4-Flash", 30.0

            def chat(self, *a, **k):
                raise LLMError("se pasó del tiempo")

        class Gemma(Tagged):
            model, timeout = "Gemma-4-31B-IT", 30.0

        gemma = Gemma(default=ADJ_ROM)
        self.api.ai_status = lambda *_: (200, {"available": True, "provider": "AMD Token Factory"})
        self.api._llm = lambda purpose="x", **k: providers.MeteredLLM([Bad(), gemma], "tokenfactory", purpose, "AMD Token Factory",
                                                                      k.get("budget_s"))
        body = self.turn()[1]
        self.assertEqual((body["ai"]["decided_by"], body["ai"]["model"]), ("llm", "Gemma-4-31B-IT"))
        self.assertEqual(self.rows("SELECT ai_model FROM agent_decision")[0]["ai_model"], "Gemma-4-31B-IT")
        self.assertEqual(self.rows("SELECT ai_model FROM voice_turn")[0]["ai_model"], "Gemma-4-31B-IT")

    # ------------------------------------------------------------------ privacidad antes de la IA (ADR-034)
    def test_los_datos_personales_no_llegan_al_llm_y_lo_guardado_es_lo_filtrado(self):
        clinical, talker = self.use_ai()
        plain = self.turn(text="me molesta la rodilla")[1]
        self.api._turn_log.clear()
        body = self.turn(text="me llamo Ana, mi cel 987654321, me molesta la rodilla")[1]
        sent = json.dumps(clinical.calls[-1] + talker.calls[-1], ensure_ascii=False)
        for secret in ("Ana", "987654321"):
            self.assertNotIn(secret, sent)
        self.assertIn("[nombre]", sent)
        self.assertEqual(body["privacy"], {"redactions": 2})
        self.assertEqual((body["action"], body["adjustment"]), (plain["action"], plain["adjustment"]), "la decisión es la misma")
        saved = "me llamo [nombre], mi cel [teléfono], me molesta la rodilla"
        row = self.rows("SELECT transcript, redactions FROM voice_turn WHERE id = ?", body["turn"]["id"])[0]
        self.assertEqual((row["transcript"], row["redactions"]), (saved, 2))
        self.assertEqual(self.rows("SELECT text FROM symptom_report WHERE id = ?", body["report"]["id"])[0]["text"], saved)
        self.assertEqual(body["report"]["text"], saved)
        self.assertEqual(plain["privacy"], {"redactions": 0})

    def test_la_alarma_se_lee_del_texto_original_y_se_guarda_filtrada(self):
        self.api._llm = lambda *a, **k: self.fail("la alarma no debe pedir un LLM")
        body = self.turn(text="me llamo Ana y me mareo")[1]
        self.assertEqual((body["action"], body["stop"]), ("session_stopped", True))
        self.assertEqual(self.rows("SELECT transcript FROM voice_turn")[0]["transcript"], "me llamo [nombre] y me mareo")
        self.assertEqual(self.rows("SELECT text FROM symptom_report")[0]["text"], "me llamo [nombre] y me mareo")

    def test_me_cai_detiene_sin_llm_y_una_molestia_negada_baja_la_exigencia_con_categoria_other(self):
        self.api.ai_status = lambda *_: self.fail("la alarma no consulta el estado de la IA")
        self.api._llm = lambda *a, **k: self.fail("la alarma no debe pedir un LLM")
        body = self.turn(text="me caí al pararme")[1]
        self.assertEqual((body["action"], body["stop"], body["ai"]["skipped"]), ("session_stopped", True, "red_flag"))
        self.use_ai('{"action":"none","reason":"x"}')
        body = self.turn(text="sin dolor")[1]
        self.assertEqual((body["action"], body["report"]["category"]), ("demand_lowered", "other"), "decisión 5: todo turno es molestia")

    def test_el_formulario_sin_turno_tambien_guarda_el_texto_filtrado(self):
        status, body = self.patient.call("POST", "/api/me/discomfort", {"exercise_id": "sit-to-stand", "in_session": True,
                                                                        "current": CUR, "text": "escríbeme a ana@correo.com, me molesta"})
        self.assertEqual(status, 201)
        self.assertEqual(body["report"]["text"], "escríbeme a [correo], me molesta")
        self.assertEqual(self.rows("SELECT text FROM symptom_report")[0]["text"], "escríbeme a [correo], me molesta")
        self.assertEqual(body["action"], "demand_lowered", "la clasificación y la decisión no cambian")

    def test_el_resumen_del_fisioterapeuta_no_manda_el_telefono_de_la_nota_del_perfil(self):
        self.api.ai_status = lambda *_: (200, {"available": True})
        llm = Tagged(default="Revisa primero el rango.")
        self.api._llm = lambda *a, **k: llm
        self.patient.call("PUT", "/api/me/profile", {"limitations": [], "pain_areas": [], "note": "llamar al 987654321 antes"})
        status, _ = self.doctor.call("POST", f"/api/patients/{self.patient_id}/advice", {"suggestions": [
            {"title": "Revisar el plan", "detail": "Encaja con el perfil.", "because": "Perfil", "priority": 1}]})
        self.assertEqual(status, 200)
        sent = json.dumps(llm.calls, ensure_ascii=False)
        self.assertNotIn("987654321", sent)
        self.assertIn("llamar al [teléfono] antes", sent)

    def test_base_con_el_turno_anterior_a_la_privacidad_gana_la_columna(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "old.sqlite3"
            old = sqlite3.connect(path)
            old.executescript(SCHEMA.replace(",\n  redactions INTEGER NOT NULL DEFAULT 0);", ");")
                              .replace("   -- datos personales ocultados en el texto guardado (ADR-034)", ""))
            old.commit()
            self.assertNotIn("redactions", {r[1] for r in old.execute("PRAGMA table_info(voice_turn)")})
            old.close()
            api = StagingApi(path, CATALOG)
            try:
                self.assertIn("redactions", {r["name"] for r in api.db.execute("PRAGMA table_info(voice_turn)")})
            finally:
                api.db.close()

    def test_la_nota_soap_no_manda_al_llm_los_datos_personales_de_filas_viejas(self):
        self.api.db.execute("INSERT INTO symptom_report (patient_id, exercise_id, reported_at, kind, category, text, action, source) "
                            "VALUES (?, 'sit-to-stand', ?, 'discomfort', 'pain', 'me llamo Ana, me molesta', 'paused', 'patient_form')",
                            (self.patient_id, datetime.now(timezone.utc).isoformat()))
        _, saved = self.session(symptom_report_ids=[1])
        sid = saved["session_id"]
        self.api.ai_status = lambda *_: (200, {"available": True})
        llm = Tagged(default='{"A": "Tolera bien.", "P": "Mantener la dosis."}')
        self.api._llm = lambda *a, **k: llm
        status, rep = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertEqual(status, 201)
        self.assertNotIn("Ana", json.dumps(llm.calls, ensure_ascii=False))
        self.assertIn("Ana", rep["report"]["soap"]["S"], "la plantilla, que es interna, no cambia")

    # ------------------------------------------------------------------ tiempos ajustables y estado de la IA (ADR-033)
    def test_los_tiempos_se_ajustan_por_entorno_y_se_acotan(self):
        names = ("AXONFAS_TURN_CLINICAL_S", "AXONFAS_TURN_COACH_S", "AXONFAS_TURN_BUDGET_S")
        saved = {k: os.environ.pop(k, None) for k in names}
        self.addCleanup(lambda: [os.environ.__setitem__(k, v) if v is not None else os.environ.pop(k, None) for k, v in saved.items()])
        default = StagingApi(":memory:", CATALOG)
        self.assertEqual((default.TURN_CLINICAL_S, default.TURN_COACH_S, default.TURN_BUDGET_S, default.TURN_COACH_IF_UNDER_S), (12.0, 5.0, 18.0, 6.0))
        os.environ["AXONFAS_TURN_CLINICAL_S"] = "9"
        self.assertEqual(StagingApi(":memory:", CATALOG).TURN_CLINICAL_S, 9)
        os.environ["AXONFAS_TURN_CLINICAL_S"] = "abc"
        self.assertEqual(StagingApi(":memory:", CATALOG).TURN_CLINICAL_S, 12)
        os.environ["AXONFAS_TURN_CLINICAL_S"] = "99"
        raised = StagingApi(":memory:", CATALOG)
        self.assertEqual((raised.TURN_CLINICAL_S, raised.TURN_BUDGET_S), (20, 21), "el presupuesto siempre deja 1 s más que el clínico")
        os.environ.update(AXONFAS_TURN_CLINICAL_S="1", AXONFAS_TURN_COACH_S="99", AXONFAS_TURN_BUDGET_S="500")
        low = StagingApi(":memory:", CATALOG)
        self.assertEqual((low.TURN_CLINICAL_S, low.TURN_COACH_S, low.TURN_BUDGET_S), (4, 8, 30))

    def test_me_trae_el_asistente_y_cuanto_esperar_sin_tocar_la_red(self):
        from agents import providers as prov
        real = prov.status
        prov.status = lambda *a, **k: self.fail("/api/me no consulta al proveedor")
        self.addCleanup(lambda: setattr(prov, "status", real))
        status, me = self.patient.call("GET", "/api/me")
        self.assertEqual((status, me["assistant"]["wait_s"], me["assistant"]["available"]), (200, 25, False))
        os.environ.update(AMD_TOKENFACTORY_BASE_URL="http://127.0.0.1:9/v1", AMD_TOKENFACTORY_API_KEY="k")
        self.api._ai.update(checked=time.time(), available=True, provider="AMD Token Factory", reason=None)
        me = self.patient.call("GET", "/api/me")[1]
        self.assertEqual((me["assistant"]["available"], me["assistant"]["provider"]), (True, "AMD Token Factory"))

    def test_el_estado_de_la_ia_no_bloquea_en_caliente(self):
        from agents import providers as prov
        calls = []
        real = prov.status
        prov.status = lambda timeout=5.0: (calls.append(1), time.sleep(0.3), {"available": True, "provider": "AMD Token Factory", "reason": None})[2]
        self.addCleanup(lambda: setattr(prov, "status", real))
        os.environ.update(AMD_TOKENFACTORY_BASE_URL="http://127.0.0.1:9/v1", AMD_TOKENFACTORY_API_KEY="k")
        self.api.ai_status(1, {})                              # en frío: espera la consulta
        self.assertEqual(len(calls), 1)
        self.api.ai_status(1, {})                              # tibio y reciente: no consulta
        self.assertEqual(len(calls), 1)
        self.api._ai["checked"] = time.time() - 40
        self.api._ai["available"] = False
        t0 = time.perf_counter()
        _, now = self.api.ai_status(1, {})
        self.assertFalse(now["available"], "devuelve el valor guardado al instante")
        self.assertLess(time.perf_counter() - t0, 0.5)
        for t in __import__("threading").enumerate():
            if t.name == "axonfas-ai-status":
                t.join(2)
        self.assertEqual(len(calls), 2, "y lo refresca en segundo plano")
        self.assertTrue(self.api.ai_status(1, {})[1]["available"])
        self.api._ai["checked"] = time.time() - 700            # demasiado viejo: vuelve a esperar
        self.api.ai_status(1, {})
        self.assertEqual(len(calls), 3)
        warm = self.api.warm_ai()
        self.assertIsNotNone(warm)
        warm.join(2)

    def test_con_la_ia_lenta_de_5_s_responde_el_asistente(self):
        fake = FakeTokenFactory()
        fake.delay = 1.2
        self.addCleanup(fake.close)
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=fake.url, AMD_TOKENFACTORY_API_KEY=KEY, AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash")
        self.api._ai.update(checked=time.time(), available=True, provider="AMD Token Factory", reason=None)
        body = self.turn()[1]
        self.assertEqual((body["ai"]["decided_by"], body["ai"]["error"]), ("llm", None))
        self.assertGreaterEqual(body["ai"]["clinical_ms"], 1000)

    # ------------------------------------------------------------------ Token Factory de mentira, de punta a punta
    def test_con_un_servidor_con_la_forma_de_token_factory(self):
        fake = FakeTokenFactory()
        self.addCleanup(fake.close)
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=fake.url, AMD_TOKENFACTORY_API_KEY=KEY, AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash")
        self.api._ai["checked"] = 0
        before = providers.usage()["by_purpose"].get("clinical-turn", 0)
        status, body = self.turn()
        self.assertEqual(status, 201)
        ai = body["ai"]
        self.assertEqual((ai["provider"], ai["model"], ai["decided_by"]), ("AMD Token Factory", "DeepSeek-V4-Flash", "llm"))
        self.assertIsInstance(ai["clinical_ms"], int)
        self.assertEqual(body["adjustment"], {"param": "rom_target", "old": 90, "new": 70})
        content = json.dumps(fake.seen)
        self.assertNotIn("Paciente A", content, "el alias no viaja al proveedor")
        self.assertNotIn("1950", content, "el año de nacimiento tampoco")
        self.assertIn("la rodilla no va bien", content)
        self.assertGreaterEqual(providers.usage()["by_purpose"]["clinical-turn"], before + 1)
        self.assertGreaterEqual(providers.usage()["by_purpose"]["coach-turn"], 1)

    def test_si_token_factory_limita_el_uso_responde_rapido_con_reglas(self):
        fake = FakeTokenFactory()
        fake.busy = 50
        self.addCleanup(fake.close)
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=fake.url, AMD_TOKENFACTORY_API_KEY=KEY, AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash")
        self.api._ai.update(checked=time.time(), available=True, provider="AMD Token Factory", reason=None)
        t0 = time.perf_counter()
        status, body = self.turn()
        self.assertEqual(status, 201)
        self.assertLess(time.perf_counter() - t0, 2.0, "sin esperas de Retry-After")
        self.assertEqual((body["ai"]["decided_by"], body["ai"]["error"]), ("rules", "llm_error"))
        self.assertEqual(body["adjustment"], {"param": "rom_target", "old": 90, "new": 80})

    def test_token_factory_caido_no_da_error_al_paciente(self):
        fake = FakeTokenFactory()
        self.addCleanup(fake.close)
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=fake.url, AMD_TOKENFACTORY_API_KEY=KEY, AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash")
        self.api._ai.update(checked=time.time(), available=True, provider="AMD Token Factory", reason=None)
        fake.close()
        status, body = self.turn()
        self.assertEqual((status, body["ai"]["decided_by"], body["adjustment"]["new"]), (201, "rules", 80))

    # ------------------------------------------------------------------ esquema, sesión, nota y panel
    def test_base_anterior_gana_las_tablas_del_turno(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "old.sqlite3"
            old = sqlite3.connect(path)
            old.executescript(SCHEMA.split("-- Turno de texto")[0])        # el esquema de antes: sin las dos tablas
            old.commit()
            old.close()
            api = StagingApi(path, CATALOG)
            try:
                for table in ("voice_turn", "agent_decision"):
                    self.assertTrue(list(api.db.execute(f"PRAGMA table_info({table})")), table)
            finally:
                api.db.close()

    def test_applied_exige_within_envelope_en_la_base(self):
        turn_id = self.turn()[1]["turn"]["id"]
        with self.assertRaises(sqlite3.IntegrityError):
            self.api.db.execute("INSERT INTO agent_decision (patient_id, voice_turn_id, created_at, agent, proposal, within_envelope, outcome) "
                                "VALUES (?, ?, 'x', 'rules', '{}', 0, 'applied')", (self.patient_id, turn_id))

    def session(self, **over):
        now = datetime.now(timezone.utc)
        body = {"exercise_id": "sit-to-stand", "mode": "monitored", "source": "demo", "started_at": (now - timedelta(minutes=3)).isoformat(),
                "ended_at": now.isoformat(), "end_reason": "completed", "reps_done": 5, "events": [],
                "reps": [{"index": i, "kneeRom": 90.0} for i in range(1, 6)]}
        body.update(over)
        return self.patient.call("POST", "/api/sessions", body)

    def test_el_turno_se_une_a_la_sesion_por_id(self):
        self.use_ai()
        turn = self.turn()[1]["turn"]
        _, body = self.doctor.call("POST", "/api/patients", {"alias": "Paciente B"})
        other = Client(self.api, Client(self.api).call("POST", "/api/join", {"code": body["patient"]["invite_code"], "consent": True})[1]["token"])
        self.plan(SIT, patient_id=body["patient"]["id"])
        other_turn = other.call("POST", "/api/me/turn", {"exercise_id": "sit-to-stand", "text": "me molesta", "in_session": True,
                                                         "current": CUR})[1]["turn"]["id"]
        self.assertEqual(self.session(voice_turn_ids=["a"])[0], 400)
        self.assertEqual(self.session(voice_turn_ids=list(range(21)))[0], 400)
        status, saved = self.session(voice_turn_ids=[turn["id"], other_turn], symptom_report_ids=[])
        self.assertEqual(status, 201)
        sid = saved["session_id"]
        self.assertEqual(self.rows("SELECT session_id FROM voice_turn WHERE id = ?", turn["id"])[0]["session_id"], sid)
        self.assertEqual(self.rows("SELECT session_id FROM agent_decision WHERE voice_turn_id = ?", turn["id"])[0]["session_id"], sid)
        self.assertIsNone(self.rows("SELECT session_id FROM voice_turn WHERE id = ?", other_turn)[0]["session_id"],
                          "el turno de otro paciente no se une")
        self.assertEqual(self.session(voice_turn_ids=[turn["id"]])[0], 201)
        self.assertEqual(self.rows("SELECT session_id FROM voice_turn WHERE id = ?", turn["id"])[0]["session_id"], sid,
                         "uno ya unido no se mueve")

    def test_la_nota_soap_lleva_las_decisiones_y_las_frases_sin_repetir(self):
        self.use_ai()
        turn = self.turn(text="la rodilla no va bien")[1]
        self.use_ai('{"action":"none","reason":"x"}')
        quiet = self.turn(text="siento raro el muslo")[1]
        _, saved = self.session(voice_turn_ids=[turn["turn"]["id"], quiet["turn"]["id"]],
                                symptom_report_ids=[turn["report"]["id"]])
        sid = saved["session_id"]
        self.api.ai_status = lambda *_: (200, {"available": False})
        status, report = self.doctor.call("POST", f"/api/sessions/{sid}/report")
        self.assertEqual(status, 201)
        facts, soap = report["report"]["facts"], report["report"]["soap"]
        self.assertEqual(facts["ajustes_del_agente"][0], {"param": "rom_target", "old": 90, "new": 70, "por": "agente clínico"})
        self.assertEqual(facts["ajustes_del_agente"][1], {"param": "rom_target", "old": 90, "new": 80, "por": "motor de reglas"})
        self.assertIn("rom_target 90 → 70 (agente clínico)", soap["O"])
        self.assertIn("rom_target 90 → 80 (motor de reglas)", soap["O"])
        self.assertNotIn("reason", json.dumps(facts))
        self.assertEqual(facts["lo_que_dijo_el_paciente"], ["siento raro el muslo"],
                         "la frase que ya es una molestia de la sesión no se repite en la S")
        self.assertEqual(soap["S"].count("la rodilla no va bien"), 1)

    def test_el_fisioterapeuta_ve_decisiones_y_turnos_solo_de_sus_pacientes(self):
        self.use_ai()
        self.turn()
        self.turn(text="me mareo")
        detail = self.doctor.call("GET", f"/api/patients/{self.patient_id}")[1]
        d = detail["decisions"][0]
        self.assertEqual((d["agent"], d["outcome"], d["ai_model"], d["proposal"]["new"], d["turn"]["transcript"]),
                         ("clinical", "applied", "Modelo-Falso", 70, "la rodilla no va bien"))
        self.assertEqual([t["action"] for t in detail["turns"]], ["session_stopped", "demand_lowered"])
        self.assertEqual([t["has_decision"] for t in detail["turns"]], [False, True])
        self.assertEqual(len(detail["decisions"]), 1, "la alarma no es una decisión del agente")
        _, other = Client(self.api).call("POST", "/api/therapists", {"name": "Otra"})
        self.assertEqual(Client(self.api, other["token"]).call("GET", f"/api/patients/{self.patient_id}")[0], 404, "I-10")

    def test_propuesta_sin_valor_actual_se_rechaza_y_se_atribuye_al_agente(self):
        # Sin valores en pantalla (antes de calibrar) el LLM no puede inventar el 'old'; las reglas no tienen qué bajar y
        # pausan. La fila de la decisión es del agente clínico, que fue quien propuso (TD-34).
        self.use_ai('{"action":"adjust","param":"reps","old":7,"new":5,"reason":"molestia"}')
        status, body = self.turn(current={})
        self.assertEqual((status, body["action"], body["adjustment"]), (201, "paused", None))
        self.assertEqual((body["decision"]["agent"], body["decision"]["outcome"]), ("clinical", "rejected"))
        self.assertEqual(self.rows("SELECT agent, outcome FROM agent_decision"), [{"agent": "clinical", "outcome": "rejected"}])

    def test_el_fisioterapeuta_recibe_el_turno_en_vivo(self):
        self.use_ai()
        q = self.api.hub.subscribe(("therapist", self.patient_id))
        self.turn()
        kinds = []
        while not q.empty():
            kinds.append(q.get_nowait())
        turn = next(m for m in kinds if m["kind"] == "agent_turn")
        self.assertEqual((turn["action"], turn["decided_by"], turn["model"], turn["outcome"]), ("demand_lowered", "llm", "Modelo-Falso", "applied"))
        self.assertTrue(any(m["kind"] == "symptom_reported" for m in kinds))


if __name__ == "__main__":
    unittest.main()
