"""AXONFAS · cliente del LLM servido con vLLM (API compatible con OpenAI) y un LLM de mentira para tests y demos.

Solo biblioteca estándar. La dirección y la clave salen de variables de entorno, nunca del repo:
    AXONFAS_LLM_URL   (por defecto http://127.0.0.1:8000/v1, el túnel SSH hacia la GPU)
    AXONFAS_LLM_KEY   (la clave que genera bootstrap.sh en la GPU)
    AXONFAS_LLM_MODEL (por defecto axonfas-llm, el nombre con el que vLLM sirve el modelo)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


class LLMError(RuntimeError):
    pass


class OpenAICompatible:
    """Chat con un servidor compatible con OpenAI (vLLM). `json_mode` pide una respuesta JSON válida."""

    def __init__(self, url: str | None = None, key: str | None = None, model: str | None = None, timeout: float = 30.0):
        self.url = (url or os.environ.get("AXONFAS_LLM_URL") or "http://127.0.0.1:8000/v1").rstrip("/")
        self.key = key if key is not None else os.environ.get("AXONFAS_LLM_KEY", "")
        self.model = model or os.environ.get("AXONFAS_LLM_MODEL", "axonfas-llm")
        self.timeout = timeout

    def chat(self, messages: list[dict], *, json_mode: bool = False, max_tokens: int = 256, temperature: float = 0.2) -> dict:
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Content-Type": "application/json"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        t0 = time.perf_counter()
        try:
            data = self._post(body, headers)
        except urllib.error.HTTPError as err:
            # Algunos servicios (por ejemplo, un catálogo hospedado) no aceptan response_format: se repite sin él y
            # parse_json() rescata el JSON del texto.
            if json_mode and err.code in (400, 422):
                body.pop("response_format", None)
                try:
                    data = self._post(body, headers)
                except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err2:
                    raise LLMError(f"el LLM no respondió: {err2}") from err2
            else:
                raise LLMError(f"el LLM respondió {err.code}: {err.reason}") from err
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            raise LLMError(f"el LLM no respondió: {err}") from err
        ms = round((time.perf_counter() - t0) * 1000)
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as err:
            raise LLMError("respuesta del LLM sin contenido") from err
        usage = data.get("usage") or {}
        return {"text": text, "ms": ms, "completion_tokens": usage.get("completion_tokens"), "prompt_tokens": usage.get("prompt_tokens")}

    def _post(self, body: dict, headers: dict) -> dict:
        req = urllib.request.Request(f"{self.url}/chat/completions", data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read())

    def models(self) -> list[str]:
        """IDs del catálogo de modelos (GET /models). Sirve para comprobar la clave y elegir modelo."""
        headers = {"Authorization": f"Bearer {self.key}"} if self.key else {}
        req = urllib.request.Request(f"{self.url}/models", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=min(self.timeout, 10)) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as err:
            raise LLMError(f"el catálogo respondió {err.code}: {err.reason}") from err
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            raise LLMError(f"sin respuesta del catálogo: {err}") from err
        items = data.get("data") if isinstance(data, dict) else data
        return [m.get("id") for m in (items or []) if isinstance(m, dict) and m.get("id")]


class FakeLLM:
    """LLM de mentira: devuelve respuestas fijas según palabras clave. Sirve para tests y para la demo sin GPU."""

    def __init__(self, replies: dict[str, str] | None = None, default: str = "{}"):
        self.replies = replies or {}
        self.default = default
        self.calls: list[list[dict]] = []

    def chat(self, messages: list[dict], **_) -> dict:
        self.calls.append(messages)
        last = messages[-1]["content"].lower() if messages else ""
        for key, reply in self.replies.items():
            if key in last:
                return {"text": reply, "ms": 1, "completion_tokens": None, "prompt_tokens": None}
        return {"text": self.default, "ms": 1, "completion_tokens": None, "prompt_tokens": None}


def parse_json(text: str) -> dict | None:
    """El primer objeto JSON del texto, aunque venga rodeado de prosa o de ```json."""
    text = (text or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None
