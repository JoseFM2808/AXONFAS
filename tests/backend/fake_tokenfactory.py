"""Servidor de mentira con la forma de AMD Token Factory (GET /models y POST /chat/completions), solo para tests. Sin red.

No es un test: lo importan los tests de la API de Staging (ADR-033). La clave es de prueba."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "clave-de-prueba"


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeTokenFactory"

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
        self._send(200, {"object": "list", "data": [{"id": "MinerU2.5-Pro"}, {"id": "DeepSeek-V4-Flash"}]})

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        fake = self.server.fake
        with fake.lock:
            fake.seen.append(req)
            busy = fake.busy
            fake.busy = max(0, fake.busy - 1)
        if not self._ok():
            return self._send(401, {"error": "bad key"})
        if busy:
            return self._send(429, {"error": "rate limited"})
        if fake.delay:
            time.sleep(fake.delay)
        if "response_format" in req:                       # como el catálogo hospedado: sin modo JSON
            return self._send(400, {"error": "response_format not supported"})
        system = req["messages"][0]["content"]
        text = fake.clinical if "agente clínico" in system else fake.coach
        self._send(200, {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 50, "completion_tokens": 9}})


class FakeTokenFactory:
    """Arranca el servidor en un puerto libre. `clinical` y `coach` son las respuestas; `busy` cuántos 429 devolver;
    `delay` cuántos segundos tarda; `seen` guarda las peticiones recibidas."""

    def __init__(self, clinical='{"action":"adjust","param":"rom_target","old":90,"new":70,"reason":"molestia"}',
                 coach="Baja a 99 grados."):
        self.clinical, self.coach, self.busy, self.delay = clinical, coach, 0, 0.0
        self.seen: list = []
        self.lock = threading.Lock()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.fake = self
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
