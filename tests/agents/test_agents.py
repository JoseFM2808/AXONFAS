"""Tests de los agentes y de las reglas que los rodean (ADR-004, ADR-005, ADR-016). Sin GPU: LLM de mentira.

    py -m unittest discover -s tests/agents -v
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents import advisor, clinical, coach, safety, soap  # noqa: E402
from agents.llm import FakeLLM, LLMError, parse_json  # noqa: E402
from agents.turn import DEMO_CTX, DEMO_LLM, run_turn  # noqa: E402

ENV = {"rom_min": 60, "rom_max": 110, "max_reps": 10}
CUR = {"rom_target": 90, "reps": 7, "rest_seconds": 60}


def prop(param, old, new, reason="motivo"):
    return {"param": param, "old": old, "new": new, "reason": reason}


class BrokenLLM:
    def chat(self, *_a, **_k):
        raise LLMError("sin conexión")


class SafetyTest(unittest.TestCase):
    def test_frases_de_alarma_detienen_sin_importar_tildes(self):
        for text in ["Me estoy mareando", "siento un DOLOR AGUDO en la rodilla", "perdí la fuerza en la pierna",
                     "me duele el pecho", "creo que me desmayo", "no puedo respirar bien"]:
            self.assertIsNotNone(safety.red_flag(text), text)
        for text in ["Me dio un pinchazo en la ingle", "estoy un poco cansado", "todo bien"]:
            self.assertIsNone(safety.red_flag(text), text)

    def test_frases_de_alarma_nuevas(self):
        for text in ["Siento una pérdida de fuerza súbita", "me duele muchísimo", "tengo un dolor punzante", "me siento muy débil",
                     "se me durmió la pierna", "se me dobló la rodilla", "no puedo mover la pierna", "me duele mucho",
                     "tengo hormigueo en el pie"]:
            self.assertIsNotNone(safety.red_flag(text), text)
        for text in ["Me dio un pinchazo en la ingle", "estoy un poco cansado", "todo bien", "me duele un poco la rodilla",
                     "siento la pierna cansada"]:
            self.assertIsNone(safety.red_flag(text), text)

    def test_frase_nueva_detiene_sin_consultar_al_llm(self):
        llm = FakeLLM(default='{"action": "none", "reason": "x"}')
        out = run_turn(llm, "se me durmió la pierna", DEMO_CTX)
        self.assertEqual(out["decision"]["outcome"], "session_stopped")
        self.assertEqual(llm.calls, [])

    def test_dentro_del_sobre_se_aplica(self):
        d = safety.validate(prop("rom_target", 90, 70), ENV, CUR)
        self.assertEqual((d["outcome"], d["within_envelope"]), ("applied", True))

    def test_fuera_del_sobre_se_escala_y_nunca_se_aplica(self):
        for p in [prop("rom_target", 90, 130), prop("rom_target", 90, 40), prop("reps", 7, 12)]:
            d = safety.validate(p, ENV, CUR)
            self.assertEqual(d["outcome"], "escalated_to_therapist", p)
            self.assertFalse(d["within_envelope"])

    def test_propuestas_invalidas_se_rechazan(self):
        cases = [{"param": "rom_target", "new": 70}, prop("dosis_medicamento", 0, 1), prop("rom_target", 90, "setenta"),
                 prop("rom_target", 85, 70), prop("rom_target", 90, 70, reason=" "), prop("rom_target", 90, True)]
        for p in cases:
            d = safety.validate(p, ENV, CUR)
            self.assertEqual(d["outcome"], "rejected", p)
        self.assertEqual(safety.validate(prop("rom_target", 90, 70), {}, CUR)["outcome"], "rejected", "sin sobre no hay ajuste (I-3)")

    def test_rango_sin_limites_del_fisioterapeuta_se_rechaza(self):
        for env in [{"max_reps": 10}, {"rom_min": 60}, {"rom_min": 110, "rom_max": 60, "max_reps": 10}]:
            self.assertEqual(safety.validate(prop("rom_target", 90, 70), env, CUR)["outcome"], "rejected", env)
        self.assertEqual(safety.validate(prop("reps", 7, 5), {"rom_min": 60, "rom_max": 110}, CUR)["outcome"], "rejected")
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 90), {"max_reps": 10}, CUR)["outcome"], "applied")

    def test_sobre_de_staging_se_traduce(self):
        base = {"trunk_margin": 15, "valgus_margin": 10, "max_reps": 10}
        self.assertEqual(safety.agent_envelope(base), {**base, "pain_stop": True})
        self.assertEqual(safety.agent_envelope({**base, "rom_min": 60, "rom_max": 110}), {**base, "rom_min": 60, "rom_max": 110, "pain_stop": True})
        self.assertEqual(safety.agent_envelope({}), {})
        self.assertEqual(safety.agent_envelope(None), {})
        self.assertNotIn("max_reps", safety.agent_envelope({"max_reps": True}))
        # El caso del hallazgo 4: sin rom_min / rom_max en el sobre de Staging, el rango no se ajusta.
        self.assertEqual(safety.validate(prop("rom_target", 90, 70), safety.agent_envelope(base), CUR)["outcome"], "rejected")

    def test_tras_una_molestia_solo_se_baja_la_exigencia(self):
        d = safety.validate(prop("rom_target", 90, 110), ENV, CUR, "me molesta la rodilla")
        self.assertEqual((d["outcome"], d["within_envelope"]), ("escalated_to_therapist", True))
        self.assertEqual(safety.validate(prop("reps", 7, 9), ENV, CUR, "estoy cansado")["outcome"], "escalated_to_therapist")
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 30), ENV, CUR, "me cuesta")["outcome"], "escalated_to_therapist")
        self.assertEqual(safety.validate(prop("rom_target", 90, 70), ENV, CUR, "me molesta")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 90), ENV, CUR, "estoy cansado")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rom_target", 90, 110), ENV, CUR, "todo bien")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rom_target", 90, 110), ENV, CUR)["outcome"], "applied")

    def test_clasificar_sintomas(self):
        for text, kind, category in [("me mareo", "red_flag", "red_flag"), ("me duele mucho y me molesta", "red_flag", "red_flag"),
                                     ("me molesta la rodilla", "discomfort", "pain"), ("Calambre", "discomfort", "cramp"),
                                     ("Cansancio", "discomfort", "fatigue"), ("siento rigidez", "discomfort", "stiffness"),
                                     ("estoy incómodo", "discomfort", "other")]:
            found = safety.classify_symptom(text)
            self.assertEqual((found["kind"], found["category"]), (kind, category), text)
        self.assertIsNone(safety.classify_symptom("todo bien"))
        self.assertEqual(set(safety.DISCOMFORT), set(safety.DISCOMFORT_CATEGORY))

    def test_reduccion_determinista(self):
        def red(env=ENV, **cur):
            return safety.reduce_demand(env, {**CUR, **cur})
        p = red()
        self.assertEqual((p["param"], p["old"], p["new"]), ("rom_target", 90, 80))
        self.assertEqual(red(rom_target=65)["new"], 60)
        p = red(rom_target=60)
        self.assertEqual((p["param"], p["old"], p["new"]), ("reps", 7, 4))
        self.assertIsNone(red(rom_target=60, reps=1))
        self.assertIsNone(safety.reduce_demand({}, CUR))
        p = safety.reduce_demand(safety.agent_envelope({"trunk_margin": 15, "valgus_margin": 10, "max_reps": 10}), CUR)
        self.assertEqual((p["param"], p["old"], p["new"]), ("reps", 7, 4), "sin rango no se toca el rango")
        self.assertEqual(red(rom_target=120)["new"], 110)
        for rom in range(10, 145, 5):
            p = red(rom_target=rom)
            if p:
                self.assertEqual(safety.validate(p, ENV, {**CUR, "rom_target": rom}, "molestia")["outcome"], "applied", rom)

    def test_tras_una_molestia_el_sistema_baja_la_exigencia_solo(self):
        d = clinical.propose(BrokenLLM(), "me molesta la rodilla", DEMO_CTX)
        self.assertEqual((d["outcome"], d["source"], d["proposal"]["new"], d["llm_outcome"]), ("applied", "rules", 80, "rejected"))
        self.assertTrue(d["within_envelope"])
        d = clinical.propose(FakeLLM(default='{"action": "none", "reason": "x"}'), "estoy cansado", DEMO_CTX)
        self.assertEqual((d["outcome"], d["source"]), ("applied", "rules"))
        llm = FakeLLM(default='{"action":"adjust","param":"rom_target","old":90,"new":110,"reason":"x"}')
        d = clinical.propose(llm, "me molesta un poco", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["old"], d["proposal"]["new"], d["source"], d["llm_outcome"], d["llm_proposal"]["new"]),
                         ("applied", 90, 80, "rules", "escalated_to_therapist", 110))
        d = clinical.propose(DEMO_LLM, "Me dio un pinchazo en la ingle", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["new"], d["source"]), ("applied", 70, "llm"))
        d = clinical.propose(DEMO_LLM, "estoy cansado", DEMO_CTX)
        self.assertEqual((d["proposal"]["param"], d["proposal"]["new"], d["source"]), ("rest_seconds", 90, "llm"))
        d = clinical.propose(BrokenLLM(), "todo bien", DEMO_CTX)
        self.assertEqual(d["outcome"], "rejected")
        self.assertNotIn("paused", d)
        d = clinical.propose(BrokenLLM(), "me molesta", {**DEMO_CTX, "envelope": {}})
        self.assertTrue(d["paused"])
        self.assertNotEqual(d["outcome"], "applied")

    def test_turno_devuelve_el_registro_de_molestia(self):
        out = run_turn(BrokenLLM(), "me molesta la rodilla", DEMO_CTX)
        self.assertEqual(out["symptom"], {"kind": "discomfort", "category": "pain", "text": "me molesta la rodilla",
                                          "action": "demand_lowered", "adjustment": {"param": "rom_target", "old": 90, "new": 80}})
        self.assertEqual(run_turn(BrokenLLM(), "me estoy mareando", DEMO_CTX)["symptom"]["action"], "session_stopped")
        self.assertIsNone(run_turn(BrokenLLM(), "todo bien", DEMO_CTX)["symptom"])
        self.assertEqual(len(run_turn(BrokenLLM(), "me molesta " + "x" * 300, DEMO_CTX)["symptom"]["text"]), 200)
        paused = run_turn(BrokenLLM(), "me molesta", {**DEMO_CTX, "envelope": {}})
        self.assertEqual(paused["symptom"]["action"], "paused")
        self.assertIn("pausa", paused["reply"])

    def test_la_frase_de_pausa_no_trae_cifras(self):
        text = coach.template({"paused": True, "outcome": "rejected"})
        self.assertIn("pausa", text)
        self.assertEqual(coach.numbers(text), set())

    def test_applied_solo_con_within_envelope(self):
        """Regla de integridad de 03: outcome = 'applied' ⇒ within_envelope = true, para cualquier valor."""
        for new in range(0, 200, 5):
            d = safety.validate(prop("rom_target", 90, new), ENV, CUR)
            if d["outcome"] == "applied":
                self.assertTrue(d["within_envelope"])
                self.assertTrue(60 <= new <= 110)


class NumbersTest(unittest.TestCase):
    def test_cifras_en_digitos_sin_normalizacion_rota(self):
        for text, expected in [("10", {"10"}), ("100", {"100"}), ("1", {"1"}), ("10,50", {"10.5"}), ("88.0", {"88"}), ("0", {"0"})]:
            self.assertEqual(coach.numbers(text), expected, text)
        self.assertNotEqual(coach.numbers("100"), coach.numbers("10"))

    def test_cifras_en_letras(self):
        for text, expected in [("veinte repeticiones", {"20"}), ("treinta y cinco grados", {"35"}), ("cien", {"100"}),
                               ("ciento veinte", {"120"}), ("Veintidós", {"22"}), ("una serie y un descanso", set()),
                               ("treinta y uno", {"31"}), ("dos mil", {"2000"})]:
            self.assertEqual(coach.numbers(text), expected, text)

    def test_la_frase_rechaza_cifras_de_mas(self):
        decision = {"outcome": "applied", "proposal": prop("reps", 7, 10)}
        for text, source in [("Haz 100 repeticiones más.", "template"), ("Haz veinte repeticiones más.", "template"),
                             ("Haz 10 repeticiones más, tranquilo.", "llm")]:
            self.assertEqual(coach.reply(FakeLLM(default=text), "me cuesta", decision)["source"], source, text)

    def test_soap_rechaza_cifras_en_letras_o_de_mas(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 10, "reps_target": 10,
                   "end_reason": "completed", "events": [], "rom_mean": 88.5, "decisions": [], "utterances": []}
        for a, p in [("Completó 100 repeticiones.", "Mantener."), ("Bien.", "Subir a quince repeticiones.")]:
            out = soap.draft(FakeLLM(default=json.dumps({"A": a, "P": p})), session)
            self.assertEqual(out["source"], "template", (a, p))

    def test_resumen_rechaza_cifras_inventadas(self):
        out = advisor.summarize(FakeLLM(default="Revisa las 100 repeticiones."), None, [{"title": "t", "detail": "Hizo 10 repeticiones"}], [])
        self.assertEqual(out["source"], "rejected")


class AgentsTest(unittest.TestCase):
    def test_agente_clinico_valida_lo_que_propone_el_llm(self):
        d = clinical.propose(DEMO_LLM, "Me dio un pinchazo en la ingle", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["new"]), ("applied", 70))
        d = clinical.propose(DEMO_LLM, "quiero ir más rápido", DEMO_CTX)
        self.assertEqual(d["outcome"], "escalated_to_therapist", "el LLM pide 130°, fuera del sobre")

    def test_respuesta_rota_o_sin_llm_no_cambia_nada(self):
        for llm in [FakeLLM(default="no sé"), FakeLLM(default='{"action": "borrar"}'), BrokenLLM()]:
            d = clinical.propose(llm, "algo", DEMO_CTX)
            self.assertEqual(d["outcome"], "rejected")
            self.assertIsNone(d["proposal"])

    def test_json_entre_texto(self):
        self.assertEqual(parse_json('Claro:\n```json\n{"action": "none"}\n```'), {"action": "none"})
        self.assertIsNone(parse_json("[1, 2]"))

    def test_la_frase_no_inventa_numeros(self):
        decision = {"outcome": "applied", "proposal": prop("rom_target", 90, 70)}
        good = coach.reply(FakeLLM(default="Tranquilo, ahora baja solo hasta 70 grados."), "pinchazo", decision)
        self.assertEqual(good["source"], "llm")
        bad = coach.reply(FakeLLM(default="Baja hasta 45 grados y haz 20 repeticiones."), "pinchazo", decision)
        self.assertEqual((bad["source"], bad["text"]), ("template", coach.template(decision)))
        json_reply = coach.reply(FakeLLM(default='{"action": "none"}'), "pinchazo", decision)
        self.assertEqual(json_reply["source"], "template")

    def test_alarma_detiene_sin_consultar_al_llm(self):
        llm = FakeLLM(default='{"action": "none", "reason": "x"}')
        out = run_turn(llm, "me estoy mareando mucho", DEMO_CTX)
        self.assertEqual(out["decision"]["outcome"], "session_stopped")
        self.assertEqual(out["decision"]["end_reason"], "pain_stop")
        self.assertEqual(llm.calls, [], "I-7: el agente no intenta resolverlo")
        self.assertEqual(out["reply"], coach.STOP_TEXT)

    def test_turno_completo_con_el_llm_de_mentira(self):
        out = run_turn(DEMO_LLM, "Me dio un pinchazo en la ingle", DEMO_CTX)
        self.assertEqual(out["decision"]["outcome"], "applied")
        self.assertIn("70 grados", out["reply"])

    def test_soap_sin_meta_no_escribe_none(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 4, "reps_target": None,
                   "end_reason": "completed", "events": [], "decisions": [], "utterances": []}
        o = soap.draft(None, session)["soap"]["O"]
        self.assertIn("4 repeticiones", o)
        self.assertNotIn("None", o)

    def test_soap_es_borrador_y_no_inventa_cifras(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 10, "reps_target": 10,
                   "end_reason": "completed", "events": [{"type": "trunk_flexion"}, {"type": "knee_valgus"}], "rom_mean": 88.5,
                   "decisions": [{"outcome": "applied", "proposal": prop("rom_target", 90, 70)}],
                   "utterances": ["Me dio un pinchazo en la ingle"]}
        ok = soap.draft(FakeLLM(default='{"A": "Tolera el ejercicio con compensaciones leves.", "P": "Mantener 10 repeticiones."}'), session)
        self.assertEqual((ok["status"], ok["reviewed_by"], ok["source"]), ("draft", None, "llm"))
        self.assertIn("10 de 10", ok["soap"]["O"])
        invented = soap.draft(FakeLLM(default='{"A": "Mejoró un 35 %.", "P": "Subir a 15 repeticiones."}'), session)
        self.assertEqual(invented["source"], "template", "35 y 15 no están en los datos: I-6")
        self.assertEqual(soap.draft(None, session)["source"], "template")


if __name__ == "__main__":
    unittest.main()
