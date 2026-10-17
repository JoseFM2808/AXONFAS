"""Tests del export FHIR R4 (TD-10). Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(ROOT / "src"))
import fhir  # noqa: E402
from agents import soap  # noqa: E402

THERAPIST_NAME = "Lic. Sintética Prueba"
SESSION = {"id": 7, "exercise_id": "sit-to-stand", "exercise_name": "Sentarse y pararse", "monitored": True,
           "started_at": "2026-10-17T10:00:00+00:00", "ended_at": "2026-10-17T10:03:00+00:00", "reps_done": 5,
           "reps_target": 10, "end_reason": "completed", "events": [{"type": "trunk_flexion"}], "rom_mean": 90.0,
           "pain_reported": False, "decisions": [], "utterances": []}
PATIENT = {"id": 1, "alias": "Paciente A", "birth_year": 1950}
SIGNED = {"soap": {"S": "Sin comentarios.", "O": "5 de 10.", "A": "Tolera bien.", "P": "Mantener."},
          "created_at": "2026-10-17T11:00:00+00:00", "reviewed_by": 1, "reviewed_at": "2026-10-17T12:00:00+00:00",
          "reviewed_by_name": THERAPIST_NAME}


def build(session=SESSION, report=None):
    return fhir.observation(session, soap.facts(session), report, PATIENT)


class FhirTest(unittest.TestCase):
    def test_estructura_minima(self):
        obs = build()
        self.assertEqual(obs["resourceType"], "Observation")
        self.assertEqual(obs["status"], "preliminary")
        self.assertEqual(obs["code"]["coding"][0]["code"], "sit-to-stand")
        self.assertEqual(obs["subject"]["identifier"]["value"], "p1")
        self.assertNotIn("reference", obs["subject"])
        self.assertLessEqual(obs["effectivePeriod"]["start"], obs["effectivePeriod"]["end"])
        self.assertNotIn("performer", obs)
        self.assertNotIn("note", obs)

    def test_componentes_con_unidades_ucum(self):
        obs = build()
        by_code = {c["code"]["coding"][0]["code"]: c for c in obs["component"]}
        for c in obs["component"]:
            self.assertTrue(c["code"]["coding"][0]["system"] and c["code"]["coding"][0]["code"])
            self.assertEqual(sum(1 for k in c if k.startswith("value")), 1, c)
            if "valueQuantity" in c:
                self.assertEqual(c["valueQuantity"]["system"], "http://unitsofmeasure.org")
                self.assertIn(c["valueQuantity"]["code"], {"{repetitions}", "deg", "{events}"})
        self.assertEqual(by_code["reps-done"]["valueQuantity"]["value"], 5)
        self.assertEqual(by_code["reps-target"]["valueQuantity"]["value"], 10)
        self.assertEqual(by_code["knee-flexion-mean"]["valueQuantity"]["value"], 90.0)
        self.assertEqual(by_code["trunk-flexion-events"]["valueQuantity"]["value"], 1)
        self.assertEqual(by_code["knee-valgus-events"]["valueQuantity"]["value"], 0)
        self.assertEqual(by_code["end-reason"]["valueCodeableConcept"]["coding"][0]["code"], "completed")
        self.assertIs(by_code["pain-reported"]["valueBoolean"], False)

    def test_sin_dato_no_hay_componente(self):
        bare = {**SESSION, "rom_mean": None, "reps_target": None, "monitored": False}
        codes = {c["code"]["coding"][0]["code"] for c in build(bare)["component"]}
        self.assertNotIn("knee-flexion-mean", codes)
        self.assertNotIn("reps-target", codes)
        self.assertNotIn("trunk-flexion-events", codes)

    def test_firmada_es_final(self):
        obs = build(report=SIGNED)
        self.assertEqual(obs["status"], "final")
        self.assertEqual(obs["issued"], "2026-10-17T12:00:00+00:00")
        self.assertEqual(obs["performer"][0]["identifier"]["value"], "t1")
        self.assertTrue(obs["note"][0]["text"].startswith("S: "))

    def test_borrador_con_nota_sigue_preliminary(self):
        draft = {**SIGNED, "reviewed_by": None, "reviewed_at": None}
        obs = build(report=draft)
        self.assertEqual((obs["status"], obs["issued"]), ("preliminary", "2026-10-17T11:00:00+00:00"))
        self.assertNotIn("performer", obs)
        self.assertIn("note", obs)

    def test_determinista_y_sin_datos_personales(self):
        first = json.dumps(build(report=SIGNED), sort_keys=True, ensure_ascii=False)
        self.assertEqual(first, json.dumps(build(report=SIGNED), sort_keys=True, ensure_ascii=False))
        self.assertNotIn("birth_year", first)
        self.assertNotIn("1950", first)
        self.assertNotIn(THERAPIST_NAME, first)


if __name__ == "__main__":
    unittest.main()
