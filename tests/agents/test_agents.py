"""Tests de los agentes y de las reglas que los rodean (ADR-004, ADR-005, ADR-016). Sin GPU: LLM de mentira.

    py -m unittest discover -s tests/agents -v
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents import clinical, coach, safety, soap  # noqa: E402
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

    def test_applied_solo_con_within_envelope(self):
        """Regla de integridad de 03: outcome = 'applied' ⇒ within_envelope = true, para cualquier valor."""
        for new in range(0, 200, 5):
            d = safety.validate(prop("rom_target", 90, new), ENV, CUR)
            if d["outcome"] == "applied":
                self.assertTrue(d["within_envelope"])
                self.assertTrue(60 <= new <= 110)


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

    def test_soap_es_borrador_y_no_inventa_cifras(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 10, "reps_target": 10,
                   "end_reason": "completed", "events": [{"type": "trunk_flexion"}, {"type": "knee_valgus"}], "rom_mean": 88.5,
                   "decisions": [{"outcome": "applied", "proposal": prop("rom_target", 90, 70)}],
                   "utterances": ["Me dio un pinchazo en la ingle"]}
        ok = soap.draft(FakeLLM(default='{"A": "Tolera el ejercicio con dos compensaciones.", "P": "Mantener 10 repeticiones."}'), session)
        self.assertEqual((ok["status"], ok["reviewed_by"], ok["source"]), ("draft", None, "llm"))
        self.assertIn("10 de 10", ok["soap"]["O"])
        invented = soap.draft(FakeLLM(default='{"A": "Mejoró un 35 %.", "P": "Subir a 15 repeticiones."}'), session)
        self.assertEqual(invented["source"], "template", "35 y 15 no están en los datos: I-6")
        self.assertEqual(soap.draft(None, session)["source"], "template")


if __name__ == "__main__":
    unittest.main()
