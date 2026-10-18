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


if __name__ == "__main__":
    unittest.main()
