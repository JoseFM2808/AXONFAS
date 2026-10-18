"""El proveedor de IA de AMD (ADR-018) contra un servidor de mentira con la forma de una API compatible con OpenAI
(catálogo GET /models y POST /chat/completions). Sin red.

    py -m unittest discover -s tests/agents -v
"""
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents import clinical, providers  # noqa: E402
from agents.llm import LLMError  # noqa: E402
from agents.turn import DEMO_CTX  # noqa: E402

KEY = "clave-de-prueba"
ENV = ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY", "AMD_TOKENFACTORY_MODEL", "AXONFAS_LLM_KEY", "AXONFAS_LLM_URL",
       "AXONFAS_LLM_MODEL")


class Catalog(BaseHTTPRequestHandler):
    seen: list = []
    busy = 0                                               # cuántos 429 quedan por devolver

    def log_message(self, *_):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _ok(self):
        return self.headers.get("Authorization") == f"Bearer {KEY}"

    def do_GET(self):
        if not self._ok():
            return self._send(401, {"error": "bad key"})
        self._send(200, {"object": "list", "data": [{"id": "MinerU2.5-Pro"}, {"id": "Qwen3.8-Flash"}, {"id": "DeepSeek-V4-Flash"}]})

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Catalog.seen.append(req)
        if not self._ok():
            return self._send(401, {"error": "bad key"})
        if Catalog.busy:
            Catalog.busy -= 1
            return self._send(429, {"error": "rate limited"})
        if "response_format" in req:                     # como un servicio que no acepta el modo JSON
            return self._send(400, {"error": "response_format not supported"})
        text = ('Claro: {"action": "adjust", "param": "rest_seconds", "old": 60, "new": 90, "reason": "cansancio"}'
                if "cansada" in req["messages"][-1]["content"] else "Listo.")
        self._send(200, {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 50, "completion_tokens": 9}})


class ProvidersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Catalog)
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/v1"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in ENV}
        providers._model_cache.clear()

    def tearDown(self):
        for k, v in self.saved.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)

    def test_sin_configuracion_no_hay_ia_y_dice_que_falta(self):
        self.assertIsNone(providers.config())
        self.assertIsNone(providers.client())
        st = providers.status()
        self.assertFalse(st["available"])
        self.assertEqual(providers.missing(), ["AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY"])

    def test_token_factory_primero_y_modelo_del_catalogo(self):
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=self.url + "/", AMD_TOKENFACTORY_API_KEY=KEY, AXONFAS_LLM_KEY="otra")
        cfg = providers.config()
        self.assertEqual((cfg["name"], cfg["url"]), ("tokenfactory", self.url))
        st = providers.status()
        self.assertEqual((st["available"], st["provider"], st["model"]), (True, "AMD Token Factory", "Qwen3.8-Flash"),
                         "el modelo de OCR del catálogo no se elige para conversar")
        self.assertEqual(providers.client("admin-test", timeout=5).model, "Qwen3.8-Flash")
        self.assertNotIn(KEY, json.dumps(st), "el estado nunca muestra la clave")
        os.environ["AMD_TOKENFACTORY_MODEL"] = "No-Existe"
        self.assertFalse(providers.status()["available"])

    def test_agente_clinico_por_token_factory_con_reintento_sin_modo_json_y_uso_contado(self):
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=self.url, AMD_TOKENFACTORY_API_KEY=KEY, AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash")
        before = providers.usage()["calls"]
        llm = providers.client("clinical", timeout=5)
        d = clinical.propose(llm, "Siento la rodilla cansada", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["new"]), ("applied", 90), "el JSON se rescata del texto")
        self.assertTrue(any("response_format" in r for r in Catalog.seen) and "response_format" not in Catalog.seen[-1])
        u = providers.usage()
        self.assertEqual(u["calls"], before + 1)
        self.assertGreaterEqual(u["by_purpose"]["clinical"], 1)
        self.assertGreaterEqual(u["completion_tokens"], 9)

    def test_limite_de_la_clave_compartida_espera_y_reintenta(self):
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=self.url, AMD_TOKENFACTORY_API_KEY=KEY, AMD_TOKENFACTORY_MODEL="DeepSeek-V4-Flash")
        llm = providers.client("admin-test", timeout=5)
        llm.inner.MAX_WAIT_429 = 0.01
        Catalog.busy = 2
        self.assertEqual(llm.chat([{"role": "user", "content": "hola"}])["text"], "Listo.")
        Catalog.busy = 3
        with self.assertRaises(LLMError):
            llm.chat([{"role": "user", "content": "hola"}])
        Catalog.busy = 0

    def test_clave_equivocada_cuenta_como_error(self):
        os.environ.update(AMD_TOKENFACTORY_BASE_URL=self.url, AMD_TOKENFACTORY_API_KEY="mala", AMD_TOKENFACTORY_MODEL="X")
        self.assertFalse(providers.status()["available"])
        errors = providers.usage()["errors"]
        with self.assertRaises(LLMError):
            providers.client("admin-test").chat([{"role": "user", "content": "hola"}])
        self.assertEqual(providers.usage()["errors"], errors + 1)

    def test_vllm_propio_si_no_hay_token_factory(self):
        os.environ.update(AXONFAS_LLM_KEY="k", AXONFAS_LLM_URL="http://127.0.0.1:9/v1")
        self.assertEqual(providers.config()["name"], "vllm")


if __name__ == "__main__":
    unittest.main()
