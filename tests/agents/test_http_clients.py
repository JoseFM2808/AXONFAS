"""Los clientes HTTP de los agentes contra servidores de mentira con la misma forma que vLLM y voice_server.py.

Comprueba la conexión (clave, JSON, WAV) sin GPU, para que el día de la nube solo falte la GPU.
    py -m unittest discover -s tests/agents -v
"""
import io
import json
import sys
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents.llm import LLMError, OpenAICompatible  # noqa: E402
from agents.turn import DEMO_CTX, run_turn  # noqa: E402
from agents.voice import VoiceClient, VoiceError  # noqa: E402

KEY = "clave-de-prueba"


def tiny_wav(seconds=0.5, rate=24000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


class Fake(BaseHTTPRequestHandler):
    seen: list = []

    def log_message(self, *_):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, {"stt": True, "tts": True})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        Fake.seen.append((self.path, self.headers.get("Content-Type")))
        if self.headers.get("Authorization") != f"Bearer {KEY}":
            return self._send(401, {"detail": "clave inválida"})
        if self.path == "/v1/chat/completions":
            req = json.loads(body)
            if req.get("response_format", {}).get("type") == "json_object":
                text = '{"action": "adjust", "param": "rom_target", "old": 90, "new": 70, "reason": "molestia leve"}'
            else:
                text = "Entendido, baja solo hasta 70 grados."
            return self._send(200, {"choices": [{"message": {"content": text}}], "usage": {"completion_tokens": 12}})
        if self.path.startswith("/v1/stt"):
            with wave.open(io.BytesIO(body)) as w:
                assert w.getsampwidth() == 2
            return self._send(200, {"text": "Me dio un pinchazo en la ingle", "ms": 5})
        if self.path == "/v1/tts":
            assert json.loads(body)["text"]
            return self._send(200, tiny_wav(), "audio/wav")
        self._send(404, {"detail": "no existe"})


class HttpClientsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_turno_de_voz_completo_por_http(self):
        llm = OpenAICompatible(url=f"{self.url}/v1", key=KEY, timeout=5)
        voice = VoiceClient(url=self.url, key=KEY, timeout=5)
        out = run_turn(llm, "", DEMO_CTX, voice=voice, audio=tiny_wav(rate=16000))
        self.assertEqual(out["utterance"], "Me dio un pinchazo en la ingle")
        self.assertEqual(out["decision"]["outcome"], "applied")
        self.assertEqual(out["reply_source"], "llm")
        self.assertEqual(out["reply_audio_seconds"], 0.5)
        self.assertIn(("/v1/stt?language=es", "audio/wav"), Fake.seen)

    def test_clave_equivocada_o_servidor_caido(self):
        with self.assertRaises(LLMError):
            OpenAICompatible(url=f"{self.url}/v1", key="otra", timeout=5).chat([{"role": "user", "content": "hola"}])
        with self.assertRaises(VoiceError):
            VoiceClient(url="http://127.0.0.1:9", key=KEY, timeout=2).tts("hola")


if __name__ == "__main__":
    unittest.main()
