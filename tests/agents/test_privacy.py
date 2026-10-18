"""Filtro determinista de datos personales antes de la IA (ADR-026, I-19). Sin red.

    py -m unittest discover -s tests/agents -v
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents import safety  # noqa: E402
from agents.privacy import redact  # noqa: E402


class PrivacyTest(unittest.TestCase):
    CASES = [
        ("me molesta la rodilla", "me molesta la rodilla", 0),
        ("escríbeme a ana.p@correo.com", "escríbeme a [correo]", 1),
        ("mi cel es 987 654 321", "mi cel es [teléfono]", 1),
        ("llámame al +51 987-654-321", "llámame al [teléfono]", 1),
        ("mi cel es 987654321", "mi cel es [teléfono]", 1),
        ("DNI 45678912 y me duele", "[documento] y me duele", 1),
        ("mi documento 4567891 y listo", "mi [documento] y listo", 1),
        ("mi número es 4567891234", "mi número es [documento]", 1),
        ("vivo en Av. Los Pinos 345", "vivo en [dirección]", 1),
        ("me llamo Ana y me mareo", "me llamo [nombre] y me mareo", 1),
        ("me llamo Ana María Pérez", "me llamo [nombre]", 1),
        ("mi nombre es Luis, me duele", "mi nombre es [nombre], me duele", 1),
        ("Soy Juan Pérez, me duele", "Soy [nombre], me duele", 1),
        ("soy diabética y me duele", "soy diabética y me duele", 0),
        ("bajé a 90 grados, dolor 8 de 10", "bajé a 90 grados, dolor 8 de 10", 0),
        ("mira www.ejemplo.com", "mira [enlace]", 1),
        ("mira https://ejemplo.com/x?a=1 ahora", "mira [enlace] ahora", 1),
    ]

    def test_tabla_de_casos(self):
        for text, expected, n in self.CASES:
            self.assertEqual(redact(text), (expected, n), text)

    def test_varios_datos_en_una_frase(self):
        out, n = redact("me llamo Ana, mi cel 987654321, escribe a ana@x.com, me molesta la rodilla")
        self.assertEqual(n, 3)
        for secret in ("Ana", "987654321", "ana@x.com"):
            self.assertNotIn(secret, out)
        self.assertIn("me molesta la rodilla", out)

    def test_texto_vacio(self):
        self.assertEqual(redact(""), ("", 0))
        self.assertEqual(redact(None), ("", 0))

    def test_el_filtro_no_borra_una_alarma(self):
        alarms = ["me mareo", "siento un dolor agudo en la rodilla", "perdí la fuerza en la pierna", "me duele el pecho",
                  "no puedo respirar bien", "se me durmió la pierna", "me estoy mareando mucho",
                  "me llamo Ana y me mareo", "mi cel 987654321, tengo dolor fuerte", "soy Juan y perdí la fuerza"]
        for text in alarms:
            self.assertEqual(bool(safety.red_flag(redact(text)[0])), bool(safety.red_flag(text)), text)
            self.assertTrue(safety.red_flag(redact(text)[0]), text)

    def test_no_borra_informacion_clinica(self):
        # Auditoría: fechas, series de números del ejercicio, cantidades tras una calle y frases hechas no son datos personales.
        for text in ["me duele desde el 18-10-2026", "rango 90 100 110 120", "hice 10 10 10 10", "en la calle me caí 2 veces",
                     "lote de 2 ejercicios", "me llamo la atención el dolor", "llevo 20000 pasos"]:
            self.assertEqual(redact(text), (text, 0), text)

    def test_el_nombre_no_se_lleva_la_molestia(self):
        self.assertEqual(redact("me llamo Ana Torres duele"), ("me llamo [nombre] duele", 1))
        self.assertEqual(redact("me llamo Ana María Torres"), ("me llamo [nombre]", 1))
        self.assertEqual(redact("vivo en calle Lima 123, me duele"), ("vivo en [dirección], me duele", 1))
        self.assertEqual(redact("01 234 5678")[0], "[teléfono]")


if __name__ == "__main__":
    unittest.main()
