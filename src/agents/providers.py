"""AXONFAS · proveedor del LLM: solo infraestructura de AMD (ADR-018).

Orden de preferencia:
  1. AMD Token Factory (catálogo de modelos hospedado por AMD, API compatible con OpenAI):
       AMD_TOKENFACTORY_BASE_URL   https://developer.amd.com.cn/radeon/api/v1 (la que indica el manual de Token Factory)
       AMD_TOKENFACTORY_API_KEY    la clave del equipo (rc-…) de la página de Token Factory (secreto: solo en el entorno)
       AMD_TOKENFACTORY_MODEL      un id del catálogo, o varios separados por comas en orden de preferencia, p. ej.
                                   "DeepSeek-V4-Flash,Gemma-4-31B-IT": si uno falla o se pasa del tiempo, responde el
                                   siguiente; vacío = el primer modelo de chat de GET /models
  2. vLLM propio en una MI300X de AMD Developer Cloud (ADR-016): AXONFAS_LLM_URL, AXONFAS_LLM_KEY, AXONFAS_LLM_MODEL.
Sin ninguno, no hay IA: quien llama lo dice en pantalla y sigue con las reglas (TD-34). Nunca se usa otro proveedor.

Cada llamada queda en un contador en memoria (llamadas, errores, tokens y tiempo) que ve el Administrador.
"""
from __future__ import annotations

import os
import re
import threading
import time

from .llm import LLMError, OpenAICompatible

USAGE_LOCK = threading.Lock()
USAGE: dict = {"calls": 0, "errors": 0, "prompt_tokens": 0, "completion_tokens": 0, "ms_total": 0, "last_error": None,
               "last_at": None, "by_purpose": {}}
_model_cache: dict = {}
# Con un presupuesto, el modelo principal deja este tiempo a la alternativa, y la alternativa solo se intenta si quedan
# al menos FALLBACK_MIN_S (ADR-033).
FALLBACK_RESERVE_S = 4.0
FALLBACK_MIN_S = 2.0
# El catálogo también trae modelos que no conversan (OCR, embeddings): nunca se eligen solos.
_NOT_CHAT = re.compile(r"mineru|ocr|embed|rerank|whisper|tts", re.I)


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


def chat_models(ids: list[str]) -> list[str]:
    return [i for i in ids if not _NOT_CHAT.search(i)]


def _pick_model(cfg: dict, timeout: float) -> str:
    if model_list(cfg):
        return model_list(cfg)[0]
    cached = _model_cache.get(cfg["url"])
    if cached:
        return cached
    ids = chat_models(OpenAICompatible(url=cfg["url"], key=cfg["key"], model="-", timeout=timeout).models())
    if not ids:
        raise LLMError("el catálogo no devolvió modelos: define AMD_TOKENFACTORY_MODEL")
    _model_cache[cfg["url"]] = ids[0]
    return ids[0]


def model_list(cfg: dict) -> list[str]:
    """Los modelos configurados, en orden de preferencia (el primero es el principal; los demás, alternativas)."""
    return [m.strip() for m in (cfg.get("model") or "").split(",") if m.strip()]


class MeteredLLM:
    """El cliente real más el contador de uso. `purpose` agrupa el uso (clinical, coach, soap, advice, admin-test…).
    Con varios modelos, si uno falla o se pasa del tiempo responde el siguiente; `model` dice cuál respondió.
    `budget_s` (opcional) es el tiempo total de la cadena: el principal deja `FALLBACK_RESERVE_S` para la alternativa,
    y la alternativa solo se intenta si quedan al menos `FALLBACK_MIN_S` (ADR-033). `label` es lo que la pantalla dice
    del proveedor (TD-34)."""

    def __init__(self, inner: OpenAICompatible | list[OpenAICompatible], provider: str, purpose: str = "general",
                 label: str | None = None, budget_s: float | None = None):
        self.chain = inner if isinstance(inner, list) else [inner]
        self.inner, self.provider, self.purpose = self.chain[0], provider, purpose
        self.model = self.inner.model
        self.label = label or provider
        self.budget_s = budget_s

    def chat(self, messages: list[dict], **kwargs) -> dict:
        last = None
        t0 = time.monotonic()
        for idx, inner in enumerate(self.chain):
            if self.budget_s is not None:
                left = self.budget_s - (time.monotonic() - t0)
                if idx > 0 and left < FALLBACK_MIN_S:
                    break                                   # no alcanza para la alternativa: el que llama decide (reglas)
                reserve = FALLBACK_RESERVE_S if idx < len(self.chain) - 1 else 0.0
                inner.timeout = max(1.0, min(inner.timeout, left - reserve))
            try:
                out = inner.chat(messages, **kwargs)
            except LLMError as err:
                last = err
                with USAGE_LOCK:
                    USAGE["calls"] += 1
                    USAGE["errors"] += 1
                    USAGE["last_error"] = f"{inner.model}: {str(err)[:280]}"
                    USAGE["last_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                continue
            self.model = inner.model
            with USAGE_LOCK:
                USAGE["calls"] += 1
                USAGE["prompt_tokens"] += out.get("prompt_tokens") or 0
                USAGE["completion_tokens"] += out.get("completion_tokens") or 0
                USAGE["ms_total"] += out.get("ms") or 0
                USAGE["last_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                USAGE["by_purpose"][self.purpose] = USAGE["by_purpose"].get(self.purpose, 0) + 1
                USAGE.setdefault("by_model", {})[inner.model] = USAGE.setdefault("by_model", {}).get(inner.model, 0) + 1
            return {**out, "model": inner.model}
        raise last or LLMError("sin tiempo para la alternativa")


def client(purpose: str = "general", timeout: float = 30.0, retries_429: int | None = None,
           budget_s: float | None = None, fallback: bool = True) -> MeteredLLM | None:
    """Cliente listo para usar, o None si no hay proveedor configurado. `retries_429=0` no espera ante un límite de uso;
    `budget_s` acota el tiempo de toda la cadena de modelos; `fallback=False` usa solo el modelo principal."""
    cfg = config()
    if not cfg:
        return None
    models = model_list(cfg) or [_pick_model(cfg, timeout)]
    if not fallback:
        models = models[:1]                                  # el conversacional no espera una alternativa (ADR-033)
    return MeteredLLM([OpenAICompatible(url=cfg["url"], key=cfg["key"], model=m, timeout=timeout, retries_429=retries_429)
                       for m in models], cfg["name"], purpose, cfg["label"], budget_s)


def status(timeout: float = 5.0) -> dict:
    """¿Hay IA? Consulta el catálogo (GET /models) del proveedor configurado. Nunca devuelve la clave."""
    cfg = config()
    if not cfg:
        return {"available": False, "provider": None, "model": None, "models": [], "reason": "sin proveedor: faltan " + ", ".join(missing())}
    try:
        ids = OpenAICompatible(url=cfg["url"], key=cfg["key"], model="-", timeout=timeout).models()
    except LLMError as err:
        return {"available": False, "provider": cfg["label"], "model": cfg["model"] or None, "models": [], "reason": str(err)}
    chosen = model_list(cfg) or [m for m in [next(iter(chat_models(ids)), None)] if m]
    missing_ids = [m for m in chosen if ids and m not in ids]
    ok = bool(chosen) and not missing_ids
    return {"available": ok, "provider": cfg["label"], "model": chosen[0] if chosen else None, "fallback": chosen[1:],
            "models": ids[:50], "reason": None if ok else f"el modelo {missing_ids[0]!r} no está en el catálogo"}


def usage() -> dict:
    with USAGE_LOCK:
        return {**USAGE, "by_purpose": dict(USAGE["by_purpose"]), "by_model": dict(USAGE.get("by_model") or {})}
