"""Modelos de Token Factory en orden de preferencia con respaldo (ADR-031): si uno falla, responde el siguiente.
Sin red: clientes de mentira.

    py -m unittest discover -s tests/agents -v
"""
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents import providers  # noqa: E402
from agents.llm import LLMError  # noqa: E402


class Fake:
    def __init__(self, model, fail=False):
        self.model, self.fail, self.calls = model, fail, 0

    def chat(self, messages, **kwargs):
        self.calls += 1
        if self.fail:
            raise LLMError("se pasó del tiempo")
        return {"text": f"hola desde {self.model}", "ms": 5, "prompt_tokens": 3, "completion_tokens": 2}


class FallbackTest(unittest.TestCase):
    def test_lista_en_orden_de_preferencia(self):
        self.assertEqual(providers.model_list({"model": " DeepSeek-V4-Flash , Gemma-4-31B-IT,"}),
                         ["DeepSeek-V4-Flash", "Gemma-4-31B-IT"])
        self.assertEqual(providers.model_list({"model": ""}), [])

    def test_responde_el_principal_si_anda(self):
        a, b = Fake("DeepSeek-V4-Flash"), Fake("Gemma-4-31B-IT")
        llm = providers.MeteredLLM([a, b], "tokenfactory", "test")
        out = llm.chat([{"role": "user", "content": "x"}])
        self.assertEqual((out["model"], llm.model, a.calls, b.calls), ("DeepSeek-V4-Flash", "DeepSeek-V4-Flash", 1, 0))

    def test_si_el_principal_falla_responde_la_alternativa(self):
        a, b = Fake("DeepSeek-V4-Flash", fail=True), Fake("Gemma-4-31B-IT")
        llm = providers.MeteredLLM([a, b], "tokenfactory", "test")
        out = llm.chat([{"role": "user", "content": "x"}])
        self.assertEqual((out["model"], llm.model), ("Gemma-4-31B-IT", "Gemma-4-31B-IT"))
        self.assertIn("DeepSeek-V4-Flash", providers.usage()["last_error"])
        self.assertGreaterEqual(providers.usage()["by_model"].get("Gemma-4-31B-IT", 0), 1)

    def test_si_todos_fallan_se_avisa(self):
        llm = providers.MeteredLLM([Fake("a", fail=True), Fake("b", fail=True)], "tokenfactory", "test")
        with self.assertRaises(LLMError):
            llm.chat([{"role": "user", "content": "x"}])

    def test_el_cliente_arma_la_cadena_desde_el_entorno(self):
        old = {k: os.environ.get(k) for k in ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY", "AMD_TOKENFACTORY_MODEL")}
        os.environ.update(AMD_TOKENFACTORY_BASE_URL="https://tf.example/v1", AMD_TOKENFACTORY_API_KEY="prueba",
                          AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash,Gemma-4-31B-IT")
        try:
            llm = providers.client("test")
            self.assertEqual([c.model for c in llm.chain], ["DeepSeek-V4-Flash", "Gemma-4-31B-IT"])
            self.assertEqual(llm.model, "DeepSeek-V4-Flash")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
