"""Tests del Nivel 3: organizaciones, licencias y conexión con la historia clínica (TD-102). Solo datos sintéticos.

    py -m unittest discover -s tests/backend -v
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
import organizations as O  # noqa: E402

ORG = {"id": 1, "name": "Clínica Demo", "plan": "clinic", "ehr_fhir_base_url": None, "ehr_enabled": 0}


def lic(i, email, status="active", therapist_id=None):
    return {"id": i, "organization_id": 1, "email": email, "status": status, "therapist_id": therapist_id}


class OrganizationsTest(unittest.TestCase):
    def test_nombre_y_plan(self):
        self.assertEqual(O.clean_name("  Clínica   Demo "), "Clínica Demo")
        for bad in ("", "   ", None, 5, "x" * 81):
            with self.assertRaises(O.OrgError):
                O.clean_name(bad)
        self.assertEqual(O.clean_plan("network"), "network")
        with self.assertRaises(O.OrgError):
            O.clean_plan("gratis")

    def test_correo(self):
        self.assertEqual(O.clean_email(" Fisio@Ejemplo.PE "), "fisio@ejemplo.pe")
        for bad in ("sin-arroba", "a@b", "a b@c.pe", None, ["a@b.pe"]):
            with self.assertRaises(O.OrgError):
                O.clean_email(bad)

    def test_licencias_libres_y_ocupadas(self):
        lics = [lic(1, "a@x.pe"), lic(2, "b@x.pe", "revoked"), lic(3, "c@x.pe")]
        self.assertEqual(O.seats(ORG, lics), {"total": 5, "used": 2, "free": 3})

    def test_invitar_exige_licencia_libre_y_no_repetir(self):
        lics = [lic(i, f"p{i}@x.pe") for i in range(1, 5)]
        self.assertEqual(O.check_invite(ORG, lics, "Nuevo@X.pe"), "nuevo@x.pe")
        with self.assertRaises(O.OrgError):
            O.check_invite(ORG, lics, "p1@x.pe")                         # ya activo
        full = lics + [lic(5, "p5@x.pe")]
        with self.assertRaisesRegex(O.OrgError, "licencias libres"):
            O.check_invite(ORG, full, "otro@x.pe")
        self.assertEqual(O.check_invite(ORG, [lic(1, "p1@x.pe", "revoked")], "p1@x.pe"), "p1@x.pe")  # revocada se reinvita

    def test_historia_clinica_solo_https_y_sin_credenciales(self):
        self.assertEqual(O.clean_ehr({"fhir_base_url": "https://ehr.ejemplo.pe/fhir/", "enabled": True}),
                         {"fhir_base_url": "https://ehr.ejemplo.pe/fhir", "enabled": True})
        self.assertEqual(O.clean_ehr({}), {"fhir_base_url": None, "enabled": False})
        for bad in ({"fhir_base_url": "http://ehr.pe/fhir"}, {"fhir_base_url": "https://u:p@ehr.pe/fhir"},
                    {"fhir_base_url": "https://ehr.pe/fhir?key=1"}, {"fhir_base_url": "ftp://ehr.pe"},
                    {"enabled": True}, {"fhir_base_url": "https://ehr.pe", "enabled": "sí"},
                    {"fhir_base_url": "https://ehr.pe", "token": "abc"}, "https://ehr.pe"):
            with self.assertRaises(O.OrgError, msg=str(bad)):
                O.clean_ehr(bad)

    def test_resumen_solo_conteos_sin_datos_clinicos(self):
        lics = [lic(1, "a@x.pe", therapist_id=10), lic(2, "b@x.pe"), lic(3, "c@x.pe", "revoked", therapist_id=11)]
        s = O.summary(ORG, lics, {10: 7, 11: 4})
        self.assertEqual(s["seats"], {"total": 5, "used": 2, "free": 3})
        self.assertEqual(s["patients"], {"total": 7, "capacity": 150, "over": False})
        self.assertEqual([p["email"] for p in s["professionals"]], ["a@x.pe", "b@x.pe", "c@x.pe"])  # activas primero
        self.assertEqual(s["professionals"][1], {"license_id": 2, "email": "b@x.pe", "status": "active", "linked": False, "patients": 0})
        text = json.dumps(s, ensure_ascii=False)
        for clinical in ("session", "soap", "symptom", "alias", "exercise", "pain"):
            self.assertNotIn(clinical, text)

    def test_sobre_capacidad(self):
        s = O.summary(ORG, [lic(1, "a@x.pe", therapist_id=10)], {10: 151})
        self.assertTrue(s["patients"]["over"])


if __name__ == "__main__":
    unittest.main()
