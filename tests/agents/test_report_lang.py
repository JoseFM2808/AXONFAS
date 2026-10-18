"""Nota SOAP y resumen con IA en inglés (TD-116, ADR-030): mismos datos, otros textos; el LLM no inventa cifras en ningún
idioma (I-6) y el resumen nombra solo ejercicios que vienen al caso, en español o en inglés (ADR-017). Sin GPU ni red.

    py -m unittest discover -s tests/agents
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from agents import advisor, soap  # noqa: E402
from agents.llm import FakeLLM  # noqa: E402

SESSION = {"exercise_name": "Sit-to-stand", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 8, "reps_target": 10,
           "end_reason": "pain_stop", "events": [{"type": "trunk_flexion"}, {"type": "knee_valgus"}, {"type": "knee_valgus"}],
           "rom_mean": 88.5, "pain_reported": True, "pain_score": 6,
           "decisions": [{"outcome": "applied", "proposal": {"param": "rom_target", "old": 90, "new": 70}}],
           "utterances": ["my knee hurts a bit"],
           "symptom_reports": [{"category": "pain", "text": "sore knee", "action": "demand_lowered", "in_session": True},
                               {"category": "cramp", "text": None, "action": "logged", "in_session": False}]}


class SoapLangTest(unittest.TestCase):
    def test_plantilla_en_ingles_con_las_mismas_cifras(self):
        es, en = soap.draft(None, SESSION, "es"), soap.draft(None, SESSION, "en")
        self.assertEqual((es["lang"], en["lang"]), ("es", "en"))
        self.assertEqual(set(es["facts"]), set(en["facts"]), "las claves de facts no cambian con el idioma")
        o = en["soap"]["O"]
        self.assertIn("8 of 10 repetitions", o)
        self.assertIn("session stopped because of pain", o)
        self.assertIn("trunk flexion: 1, knee valgus: 2", o)
        self.assertIn("Mean knee flexion: 88.5°", o)
        self.assertIn("Adjustments applied within the envelope: rom_target 90 → 70", o)
        s = en["soap"]["S"]
        self.assertTrue(s.startswith("Reports: my knee hurts a bit"), s)
        self.assertIn("Pain at the end (VAS): 6/10", s)
        self.assertIn("pain or discomfort (“sore knee”; the demand was lowered)", s)
        self.assertIn("cramp (outside the session; it was logged)", s)
        for k in ("S", "O"):
            self.assertEqual(re.findall(r"\d+(?:\.\d+)?", es["soap"][k]), re.findall(r"\d+(?:\.\d+)?", en["soap"][k]), k)
        self.assertNotRegex(" ".join(en["soap"].values()), r"[áéíóúñ¿]", "nada en español en la nota en inglés")

    def test_sin_camara_y_sin_meta(self):
        o = soap.draft(None, {**SESSION, "no_camera": True, "reps_target": None, "events": [], "rom_mean": None,
                              "decisions": []}, "en")["soap"]["O"]
        self.assertIn(soap.NO_CAMERA_NOTES["en"], o)
        self.assertIn("8 repetitions", o)
        self.assertNotIn("None", o)

    def test_idioma_desconocido_cae_al_espanol(self):
        self.assertEqual(soap.draft(None, SESSION, "fr")["lang"], "es")
        self.assertIn("8 de 10 repeticiones", soap.draft(None, SESSION, "fr")["soap"]["O"])

    def test_el_llm_redacta_en_ingles_y_tampoco_inventa_cifras(self):
        llm = FakeLLM(default='{"A": "Tolerates the exercise with mild compensations.", "P": "Keep 10 repetitions."}')
        ok = soap.draft(llm, SESSION, "en")
        self.assertEqual(ok["source"], "llm")
        self.assertIn("inglés", llm.calls[0][0]["content"])
        invented = soap.draft(FakeLLM(default='{"A": "Improved by 35 %.", "P": "Go up to 15 repetitions."}'), SESSION, "en")
        self.assertEqual(invented["source"], "template", "35 y 15 no están en los datos: I-6")
        self.assertEqual(invented["soap"]["A"], soap.TEXT["en"]["A"])


class AdvisorLangTest(unittest.TestCase):
    def test_pide_el_resumen_en_el_idioma_de_la_interfaz(self):
        for lang, word in (("es", "español"), ("en", "inglés")):
            llm = FakeLLM(default="Review the hip bridge first.")
            advisor.summarize(llm, None, [{"title": "Hip bridge", "detail": "", "because": "", "priority": 1}], ["Hip bridge"], lang)
            self.assertIn(f"Escribe en {word}", llm.calls[0][0]["content"])

    def test_nombres_en_los_dos_idiomas(self):
        catalog = ["Puente de cadera", "Hip bridge", "Apoyo en un pie", "One-leg stand"]
        known = ["Puente de cadera", "Hip bridge"]
        self.assertEqual(advisor.mentions_unknown("Review the hip bridge first.", known, catalog), [])
        self.assertEqual(advisor.mentions_unknown("Add the one-leg stand.", known, catalog), ["One-leg stand"])
        self.assertEqual(advisor.mentions_unknown("Agrega apoyo en un pie.", known, catalog), ["Apoyo en un pie"])


class DecisionAuthorLangTest(unittest.TestCase):
    def test_quien_propuso_el_ajuste_sale_en_el_idioma_de_la_nota(self):
        session = {"exercise_name": "Sit to stand", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 5, "reps_target": 10,
                   "end_reason": "completed", "events": [], "utterances": [], "symptom_reports": [],
                   "decisions": [{"agent": "rules", "outcome": "applied",
                                  "proposal": {"param": "rom_target", "old": 90, "new": 80, "reason": "x"}}]}
        self.assertIn("rom_target 90 → 80 (motor de reglas)", soap.draft(None, session, "es")["soap"]["O"])
        self.assertIn("rom_target 90 → 80 (rules engine)", soap.draft(None, session, "en")["soap"]["O"])
        self.assertNotIn("reason", soap.facts(session, "en")["ajustes_del_agente"][0])


if __name__ == "__main__":
    unittest.main()
