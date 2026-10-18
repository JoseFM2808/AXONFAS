"""Tests de la nota SOAP como documento FHIR R4 (TD-103, ADR-008). Solo datos sintéticos.

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

SESSION = {"id": 7, "exercise_id": "sit-to-stand", "exercise_name": "Sentarse y pararse", "monitored": True,
           "started_at": "2026-10-17T10:00:00+00:00", "ended_at": "2026-10-17T10:03:00+00:00", "reps_done": 5,
           "reps_target": 10, "end_reason": "completed", "events": [{"type": "knee_valgus"}], "rom_mean": 90.0,
           "pain_reported": False, "decisions": [], "utterances": []}
PATIENT = {"id": 1, "alias": "Paciente A", "birth_year": 1950}
THERAPIST_NAME = "Lic. Sintética Prueba"
DRAFT = {"soap": {"S": "Sin molestias <ninguna>.", "O": "5 de 10.", "A": "Tolera bien.", "P": "Mantener."},
         "created_at": "2026-10-17T11:00:00+00:00", "reviewed_by": None, "reviewed_at": None}
SIGNED = {**DRAFT, "reviewed_by": 3, "reviewed_at": "2026-10-17T12:00:00+00:00", "reviewed_by_name": THERAPIST_NAME}


def build(report=DRAFT, organization=None):
    return fhir.document(SESSION, soap.facts(SESSION), report, PATIENT, organization)


def resources(bundle):
    return {e["resource"]["resourceType"]: e for e in bundle["entry"]}


class FhirDocumentTest(unittest.TestCase):
    def test_sin_nota_no_hay_documento(self):
        self.assertIsNone(build(report=None))

    def test_bundle_document_con_composition_primero(self):
        b = build()
        self.assertEqual((b["resourceType"], b["type"]), ("Bundle", "document"))
        self.assertTrue(b["identifier"]["value"] and b["timestamp"])          # bdl-9 y bdl-10
        self.assertEqual(b["entry"][0]["resource"]["resourceType"], "Composition")  # bdl-11
        urls = [e["fullUrl"] for e in b["entry"]]
        self.assertEqual(len(urls), len(set(urls)))
        self.assertTrue(all(u.startswith("urn:uuid:") for u in urls))

    def test_las_referencias_resuelven_dentro_del_bundle(self):
        b = build(report=SIGNED, organization={"id": 2, "name": "Clínica Demo"})
        urls = {e["fullUrl"] for e in b["entry"]}
        refs = []

        def walk(x):
            if isinstance(x, dict):
                if "reference" in x:
                    refs.append(x["reference"])
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(b)
        self.assertTrue(refs)
        self.assertTrue(set(refs) <= urls, set(refs) - urls)

    def test_secciones_soap_con_loinc_y_narrativa_escapada(self):
        comp = build()["entry"][0]["resource"]
        self.assertEqual(comp["type"]["coding"][0], {"system": "http://loinc.org", "code": "11506-3", "display": "Progress note"})
        codes = [s["code"]["coding"][0]["code"] for s in comp["section"]]
        self.assertEqual(codes, ["61150-9", "61149-1", "51848-0", "18776-5"])
        subj = comp["section"][0]["text"]
        self.assertEqual(subj["status"], "generated")
        self.assertIn("&lt;ninguna&gt;", subj["div"])
        self.assertTrue(subj["div"].startswith('<div xmlns="http://www.w3.org/1999/xhtml">'))
        objective = comp["section"][1]
        self.assertEqual(objective["entry"][0]["reference"], resources(build())["Observation"]["fullUrl"])

    def test_borrador_preliminary_con_autor_device_y_sin_practitioner(self):
        b = build()
        comp = b["entry"][0]["resource"]
        res = resources(b)
        self.assertEqual(comp["status"], "preliminary")
        self.assertEqual(comp["author"], [{"reference": res["Device"]["fullUrl"]}])
        self.assertNotIn("attester", comp)
        self.assertNotIn("Practitioner", res)
        self.assertEqual(res["Observation"]["resource"]["status"], "preliminary")

    def test_firmada_final_con_attester_legal(self):
        b = build(report=SIGNED)
        comp = b["entry"][0]["resource"]
        res = resources(b)
        prac = res["Practitioner"]
        self.assertEqual(comp["status"], "final")
        self.assertEqual(comp["attester"], [{"mode": "legal", "time": "2026-10-17T12:00:00+00:00",
                                              "party": {"reference": prac["fullUrl"]}}])
        self.assertEqual(comp["author"][0]["reference"], prac["fullUrl"])
        self.assertEqual(prac["resource"]["identifier"][0]["value"], "t3")
        self.assertEqual(res["Observation"]["resource"]["performer"], [{"reference": prac["fullUrl"]}])
        self.assertEqual(b["timestamp"], "2026-10-17T12:00:00+00:00")

    def test_organizacion_del_nivel_3_como_custodio(self):
        b = build(organization={"id": 2, "name": "Clínica Demo"})
        res = resources(b)
        self.assertEqual(b["entry"][0]["resource"]["custodian"]["reference"], res["Organization"]["fullUrl"])
        self.assertNotIn("Organization", resources(build()))

    def test_determinista_y_sin_datos_personales(self):
        first = json.dumps(build(report=SIGNED), sort_keys=True, ensure_ascii=False)
        self.assertEqual(first, json.dumps(build(report=SIGNED), sort_keys=True, ensure_ascii=False))
        for leak in ("birth_year", "1950", THERAPIST_NAME):
            self.assertNotIn(leak, first)
        pat = resources(build())["Patient"]["resource"]
        self.assertNotIn("name", pat)
        self.assertNotIn("birthDate", pat)


if __name__ == "__main__":
    unittest.main()
