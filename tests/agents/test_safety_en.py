"""Frases de alarma y de molestia en inglés (ADR-030): con la interfaz en inglés, el texto libre del paciente tiene que
detener la sesión igual que en español (I-7, I-22). Sin GPU ni red.

    py -m unittest discover -s tests/agents
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from agents import safety  # noqa: E402


class EnglishSafetyTest(unittest.TestCase):
    def test_alarmas_en_ingles_detienen(self):
        for text in ["I feel dizzy", "sharp pain in my knee", "SEVERE PAIN", "I'm losing strength in my leg",
                     "sudden loss of strength", "I feel very weak", "my leg went numb", "tingling in my foot",
                     "my knee gave way", "I can't move my leg", "I think I'm going to faint", "I passed out",
                     "chest pain", "my chest hurts", "I can’t breathe", "short of breath", "something popped",
                     "it hurts so much", "the room is spinning", "lightheaded"]:
            self.assertIsNotNone(safety.red_flag(text), text)
            self.assertEqual(safety.classify_symptom(text)["kind"], "red_flag", text)

    def test_molestias_en_ingles_no_detienen_pero_cuentan(self):
        cases = {"my knee is a bit sore": "pain", "it aches a little": "pain", "slight pain in the hip": "pain",
                 "I got a cramp": "cramp", "I'm tired": "fatigue", "my back feels stiff": "stiffness",
                 "it's uncomfortable": "other"}
        for text, category in cases.items():
            self.assertIsNone(safety.red_flag(text), text)
            found = safety.classify_symptom(text)
            self.assertEqual((found["kind"], found["category"]), ("discomfort", category), text)

    def test_sin_quejas_en_ingles(self):
        for text in ["all good", "feeling great", "done", "I can move fine"]:
            self.assertIsNone(safety.classify_symptom(text), text)

    def test_categorias_cubren_todas_las_palabras(self):
        self.assertEqual(set(safety.DISCOMFORT), set(safety.DISCOMFORT_CATEGORY))


class EnglishNewAlarmsTest(unittest.TestCase):
    """Equivalentes en inglés de las alarmas nuevas en español (merge con ADR-030): ante la duda, detener."""

    def test_alarmas_nuevas_en_ingles(self):
        for text in ["I can't catch my breath", "chest pressure", "I have tightness in my chest", "worst headache of my life",
                     "blurry vision", "I have double vision", "my heart is racing", "my face is drooping", "slurred speech",
                     "I fell", "I fell down the stairs", "I'm bleeding", "it swelled up suddenly", "cold sweat",
                     "I felt a pop", "I felt a crack"]:
            self.assertIsNotNone(safety.red_flag(text), text)

    def test_lo_que_no_es_alarma_sigue_sin_detener(self):
        for text in ["my knee is sore", "I'm tired", "it feels stiff", "my knee hurts a little"]:
            self.assertIsNone(safety.red_flag(text), text)

    def test_la_negacion_en_ingles_solo_cambia_la_categoria(self):
        self.assertEqual(safety.classify_symptom("it doesn't hurt, I'm just tired")["category"], "fatigue")
        self.assertEqual(safety.classify_symptom("no pain")["category"], "other")
        self.assertEqual(safety.classify_symptom("it isn’t sore")["category"], "other")
        self.assertEqual(safety.classify_symptom("I don't feel dizzy")["kind"], "red_flag", "la alarma gana aun negada")
        self.assertTrue(safety.discomfort("no pain"))


if __name__ == "__main__":
    unittest.main()
