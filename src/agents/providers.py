"""AXONFAS · proveedor del LLM: solo infraestructura de AMD (ADR-018).

Orden de preferencia:
  1. AMD Token Factory (catálogo de modelos hospedado por AMD, API compatible con OpenAI):
       AMD_TOKENFACTORY_BASE_URL   p. ej. la URL que muestra la página de Token Factory, terminada en /v1
       AMD_TOKENFACTORY_API_KEY    la clave de la página de Token Factory (secreto: solo en el entorno)
       AMD_TOKENFACTORY_MODEL      un id del catálogo; vacío = el primero que devuelva GET /models
  2. vLLM propio en una MI300X de AMD Developer Cloud (ADR-016): AXONFAS_LLM_URL, AXONFAS_LLM_KEY, AXONFAS_LLM_MODEL.
Sin ninguno, no hay IA: quien llama lo dice en pantalla y sigue con las reglas (TD-34). Nunca se usa otro proveedor.

Cada llamada queda en un contador en memoria (llamadas, errores, tokens y tiempo) que ve el Administrador.
"""
from __future__ import annotations

import os
import threading
import time

from .llm import LLMError, OpenAICompatible

USAGE_LOCK = threading.Lock()
USAGE: dict = {"calls": 0, "errors": 0, "prompt_tokens": 0, "completion_tokens": 0, "ms_total": 0, "last_error": None,
               "last_at": None, "by_purpose": {}}
_model_cache: dict = {}


def _env(key: str) -> str:
    return (os.environ.get(key) or "").strip()


def config() -> dict | None:
    """El proveedor configurado ({name, label, url, key, model}) o None. No revela la clave."""
    if _env("AMD_TOKENFACTORY_BASE_URL") and _env("AMD_TOKENFACTORY_API_KEY"):
        return {"name": "tokenfactory", "label": "AMD Token Factory", "url": _env("AMD_TOKENFACTORY_BASE_URL").rstrip("/"),
                "key": _env("AMD_TOKENFACTORY_API_KEY"), "model": _env("AMD_TOKENFACTORY_MODEL")}
    if _env("AXONFAS_LLM_KEY"):
        return {"name": "vllm", "label": "vLLM en AMD Instinct MI300X", "url": (_env("AXONFAS_LLM_URL") or "http://127.0.0.1:8000/v1").rstrip("/"),
                "key": _env("AXONFAS_LLM_KEY"), "model": _env("AXONFAS_LLM_MODEL") or "axonfas-llm"}
    return None


def missing() -> list[str]:
    """Qué falta para tener IA (para mostrarlo en la vista del Administrador)."""
    if config():
        return []
    return [k for k in ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY") if not _env(k)]


def _pick_model(cfg: dict, timeout: float) -> str:
    if cfg["model"]:
        return cfg["model"]
    cached = _model_cache.get(cfg["url"])
    if cached:
        return cached
    ids = OpenAICompatible(url=cfg["url"], key=cfg["key"], model="-", timeout=timeout).models()
    if not ids:
        raise LLMError("el catálogo no devolvió modelos: define AMD_TOKENFACTORY_MODEL")
    _model_cache[cfg["url"]] = ids[0]
    return ids[0]


class MeteredLLM:
    """El cliente real más el contador de uso. `purpose` agrupa el uso (clinical, coach, soap, advice, admin-test…)."""

    def __init__(self, inner: OpenAICompatible, provider: str, purpose: str = "general"):
        self.inner, self.provider, self.purpose = inner, provider, purpose
        self.model = inner.model

    def chat(self, messages: list[dict], **kwargs) -> dict:
        try:
            out = self.inner.chat(messages, **kwargs)
        except LLMError as err:
            with USAGE_LOCK:
                USAGE["calls"] += 1
                USAGE["errors"] += 1
                USAGE["last_error"] = str(err)[:300]
                USAGE["last_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            raise
        with USAGE_LOCK:
            USAGE["calls"] += 1
            USAGE["prompt_tokens"] += out.get("prompt_tokens") or 0
            USAGE["completion_tokens"] += out.get("completion_tokens") or 0
            USAGE["ms_total"] += out.get("ms") or 0
            USAGE["last_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            USAGE["by_purpose"][self.purpose] = USAGE["by_purpose"].get(self.purpose, 0) + 1
        return out


def client(purpose: str = "general", timeout: float = 30.0) -> MeteredLLM | None:
    """Cliente listo para usar, o None si no hay proveedor configurado."""
    cfg = config()
    if not cfg:
        return None
    model = _pick_model(cfg, timeout)
    return MeteredLLM(OpenAICompatible(url=cfg["url"], key=cfg["key"], model=model, timeout=timeout), cfg["name"], purpose)


def status(timeout: float = 5.0) -> dict:
    """¿Hay IA? Consulta el catálogo (GET /models) del proveedor configurado. Nunca devuelve la clave."""
    cfg = config()
    if not cfg:
        return {"available": False, "provider": None, "model": None, "models": [], "reason": "sin proveedor: faltan " + ", ".join(missing())}
    try:
        ids = OpenAICompatible(url=cfg["url"], key=cfg["key"], model="-", timeout=timeout).models()
    except LLMError as err:
        return {"available": False, "provider": cfg["label"], "model": cfg["model"] or None, "models": [], "reason": str(err)}
    model = cfg["model"] or (ids[0] if ids else None)
    ok = bool(model) and (not ids or model in ids)
    return {"available": ok, "provider": cfg["label"], "model": model, "models": ids[:50],
            "reason": None if ok else f"el modelo {model!r} no está en el catálogo"}


def usage() -> dict:
    with USAGE_LOCK:
        return {**USAGE, "by_purpose": dict(USAGE["by_purpose"])}
