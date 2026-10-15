"""AXONFAS · servidor de voz en la GPU (ADR-006, ADR-016): Whisper (voz → texto) y Kokoro (texto → voz), en PyTorch sobre ROCm.

Corre dentro del contenedor `rocm` del droplet, junto a vLLM, y solo se usa por el túnel SSH (bootstrap.sh):
    AXONFAS_LLM_KEY=... python -m uvicorn gpu.voice_server:app --host 127.0.0.1 --port 8001

Endpoints (todos piden `Authorization: Bearer <clave>` salvo /health):
    GET  /health      → modelos cargados, GPU y memoria
    POST /v1/stt      → cuerpo WAV PCM 16 bits; ?language=es → {"text", "ms", "audio_seconds"}
    POST /v1/tts      → {"text", "voice"} → audio/wav 24 kHz
Solo audio de voz y texto: nunca video (ADR-003). No guarda nada en disco.
"""
from __future__ import annotations

import io
import os
import threading
import time
import wave
from contextlib import asynccontextmanager

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request, Response

KEY = os.environ.get("AXONFAS_LLM_KEY", "")
STT_MODEL = os.environ.get("AXONFAS_STT_MODEL", "openai/whisper-large-v3-turbo")
TTS_LANG = os.environ.get("AXONFAS_TTS_LANG", "e")          # 'e' = español en Kokoro
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"     # en ROCm, PyTorch también llama "cuda" a la GPU AMD
STATE: dict = {"stt": None, "tts": None, "errors": {}, "load_s": {}}
LOCKS = {"stt": threading.Lock(), "tts": threading.Lock()}  # un pedido a la vez por modelo: la cola es parte de lo que se mide


def load_models() -> None:
    t0 = time.perf_counter()
    try:
        from transformers import pipeline
        STATE["stt"] = pipeline("automatic-speech-recognition", model=STT_MODEL, torch_dtype=torch.float16, device=DEVICE)
        STATE["load_s"]["stt"] = round(time.perf_counter() - t0, 1)
    except Exception as err:  # noqa: BLE001 — el servidor arranca igual y /health dice qué falló
        STATE["errors"]["stt"] = repr(err)
    t0 = time.perf_counter()
    try:
        from kokoro import KPipeline
        try:
            STATE["tts"] = KPipeline(lang_code=TTS_LANG, repo_id="hexgrad/Kokoro-82M", device=DEVICE)
        except TypeError:  # versiones sin `device`
            STATE["tts"] = KPipeline(lang_code=TTS_LANG)
        STATE["load_s"]["tts"] = round(time.perf_counter() - t0, 1)
    except Exception as err:  # noqa: BLE001
        STATE["errors"]["tts"] = repr(err)


@asynccontextmanager
async def lifespan(_app):
    load_models()
    yield


app = FastAPI(title="AXONFAS voice", lifespan=lifespan)


def check_key(request: Request) -> None:
    if KEY and request.headers.get("authorization") != f"Bearer {KEY}":
        raise HTTPException(status_code=401, detail="clave inválida")


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2:
            raise HTTPException(status_code=400, detail="se espera WAV PCM de 16 bits")
        rate, channels = w.getframerate(), w.getnchannels()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm, rate


def resample(x: np.ndarray, src: int, dst: int = 16000) -> np.ndarray:
    if src == dst or len(x) == 0:
        return x
    n = int(round(len(x) * dst / src))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def to_wav(audio: np.ndarray, rate: int = 24000) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@app.get("/health")
def health() -> dict:
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    mem = None
    if torch.cuda.is_available():
        free, total = torch.cuda.mem_get_info()
        mem = {"used_gb": round((total - free) / 1e9, 1), "total_gb": round(total / 1e9, 1)}
    return {"device": DEVICE, "gpu": gpu, "memory": mem, "stt": STATE["stt"] is not None, "tts": STATE["tts"] is not None,
            "stt_model": STT_MODEL, "load_s": STATE["load_s"], "errors": STATE["errors"]}


@app.post("/v1/stt")
async def stt(request: Request, language: str = "es") -> dict:
    check_key(request)
    if STATE["stt"] is None:
        raise HTTPException(status_code=503, detail=f"Whisper no está cargado: {STATE['errors'].get('stt')}")
    audio, rate = read_wav(await request.body())
    audio = resample(audio, rate)
    t0 = time.perf_counter()
    with LOCKS["stt"]:
        out = STATE["stt"]({"raw": audio, "sampling_rate": 16000},
                           generate_kwargs={"language": language, "task": "transcribe"})
    return {"text": (out.get("text") or "").strip(), "ms": round((time.perf_counter() - t0) * 1000),
            "audio_seconds": round(len(audio) / 16000, 2)}


@app.post("/v1/tts")
async def tts(request: Request) -> Response:
    check_key(request)
    if STATE["tts"] is None:
        raise HTTPException(status_code=503, detail=f"Kokoro no está cargado: {STATE['errors'].get('tts')}")
    body = await request.json()
    text = str(body.get("text") or "").strip()[:600]
    if not text:
        raise HTTPException(status_code=400, detail="falta el texto")
    voice = str(body.get("voice") or "ef_dora")
    t0 = time.perf_counter()
    with LOCKS["tts"]:
        chunks = []
        for _gs, _ps, audio in STATE["tts"](text, voice=voice):
            if audio is not None:
                chunks.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
    if not chunks:
        raise HTTPException(status_code=500, detail="Kokoro no generó audio")
    wav = to_wav(np.concatenate(chunks).astype(np.float32))
    return Response(content=wav, media_type="audio/wav", headers={"X-Synth-Ms": str(round((time.perf_counter() - t0) * 1000))})
