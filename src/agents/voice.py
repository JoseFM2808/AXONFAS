"""AXONFAS · cliente del servidor de voz de la GPU (voice_server.py): voz → texto y texto → voz.

Solo biblioteca estándar. La dirección y la clave salen de variables de entorno:
    AXONFAS_VOICE_URL (por defecto http://127.0.0.1:8001, el túnel SSH hacia la GPU)
    AXONFAS_LLM_KEY   (la misma clave que el LLM)
"""
from __future__ import annotations

import io
import json
import os
import time
import urllib.error
import urllib.request
import wave


class VoiceError(RuntimeError):
    pass


class VoiceClient:
    def __init__(self, url: str | None = None, key: str | None = None, timeout: float = 30.0):
        self.url = (url or os.environ.get("AXONFAS_VOICE_URL") or "http://127.0.0.1:8001").rstrip("/")
        self.key = key if key is not None else os.environ.get("AXONFAS_LLM_KEY", "")
        self.timeout = timeout

    def _post(self, path: str, body: bytes, content_type: str) -> tuple[bytes, str]:
        headers = {"Content-Type": content_type}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(f"{self.url}{path}", data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.read(), resp.headers.get("Content-Type", "")
        except (urllib.error.URLError, TimeoutError) as err:
            raise VoiceError(f"el servidor de voz no respondió: {err}") from err

    def stt(self, wav: bytes, language: str = "es") -> dict:
        """WAV PCM 16 bits → {text, ms}."""
        t0 = time.perf_counter()
        data, _ = self._post(f"/v1/stt?language={language}", wav, "audio/wav")
        out = json.loads(data)
        out["roundtrip_ms"] = round((time.perf_counter() - t0) * 1000)
        return out

    def tts(self, text: str, voice: str = "ef_dora") -> dict:
        """Texto → {wav (bytes), ms}."""
        t0 = time.perf_counter()
        data, ctype = self._post("/v1/tts", json.dumps({"text": text, "voice": voice}).encode(), "application/json")
        if "audio" not in ctype:
            raise VoiceError(f"el servidor de voz no devolvió audio: {data[:200]!r}")
        return {"wav": data, "ms": round((time.perf_counter() - t0) * 1000), "seconds": wav_seconds(data)}


def wav_seconds(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav)) as w:
        return round(w.getnframes() / float(w.getframerate()), 2)
