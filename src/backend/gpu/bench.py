"""AXONFAS · benchmark de sesiones concurrentes en 1× MI300X (TD-08, ADR-006).

Simula N pacientes a la vez. Cada sesión, cada ~`--every` segundos, hace un turno del bucle lento, alternando:
    clinical → el agente clínico propone un ajuste (LLM con JSON) y el motor de reglas lo valida
    voice    → turno de voz completo: Whisper (3 s de audio) → agente clínico → frase → TTS
y mide la latencia de cada uno. Sube N (1, 2, 4, …) mientras el p95 cumpla los objetivos.

El bucle rápido (alertas de compensación) hoy corre en el navegador, no en la GPU: el lifter 3D todavía no se eligió
(TD-05). Por eso este benchmark mide el bucle lento, que es el que comparte la GPU entre sesiones.

    python -m gpu.bench --levels 1,2,4,8,16,32,64 --duration 60
    python -m gpu.bench --report results/bench.json     → tabla Markdown y gráfico SVG
"""
from __future__ import annotations

import argparse
import json
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RESULTS = Path(__file__).resolve().parent.parent / "results"


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (k - lo), 1)


def run_level(n: int, duration: float, ops: dict, every: float = 8.0, seed: int = 7) -> dict:
    """N sesiones durante `duration` s. `ops` = {nombre: función sin argumentos que devuelve ms o lanza error}."""
    names = list(ops)
    lat: dict[str, list[float]] = {k: [] for k in names}
    errors: dict[str, int] = {k: 0 for k in names}
    lock = threading.Lock()
    stop_at = time.perf_counter() + duration

    def session(i: int) -> None:
        rnd = random.Random(seed + i)
        time.sleep(rnd.uniform(0, every))                    # las sesiones no empiezan todas a la vez
        k = i % len(names)
        while time.perf_counter() < stop_at:
            name = names[k % len(names)]
            k += 1
            t0 = time.perf_counter()
            try:
                ops[name]()
                ms = (time.perf_counter() - t0) * 1000
                with lock:
                    lat[name].append(ms)
            except Exception:  # noqa: BLE001 — un error cuenta, no corta el benchmark
                with lock:
                    errors[name] += 1
            time.sleep(max(0.0, every * rnd.uniform(0.8, 1.2) - (time.perf_counter() - t0)))

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(session, range(n)))
    wall = time.perf_counter() - t0
    return {"sessions": n, "duration_s": round(wall, 1),
            "ops": {k: {"count": len(lat[k]), "errors": errors[k], "p50_ms": percentile(lat[k], 50),
                        "p95_ms": percentile(lat[k], 95), "max_ms": round(max(lat[k]), 1) if lat[k] else None}
                    for k in names}}


def meets(level: dict, slo: dict) -> bool:
    for name, limit in slo.items():
        op = level["ops"].get(name)
        if not op or op["count"] == 0 or op["errors"] > 0.02 * max(op["count"], 1) or (op["p95_ms"] or 1e9) > limit:
            return False
    return True


def sweep(levels: list[int], duration: float, ops: dict, slo: dict, every: float = 8.0, log=print) -> dict:
    out = {"slo_p95_ms": slo, "every_s": every, "levels": [], "max_sessions_within_slo": 0}
    misses = 0
    for n in levels:
        res = run_level(n, duration, ops, every)
        res["within_slo"] = meets(res, slo)
        out["levels"].append(res)
        log(json.dumps(res, ensure_ascii=False))
        if res["within_slo"]:
            out["max_sessions_within_slo"] = n
            misses = 0
        else:
            misses += 1
            if misses >= 2:
                break                                          # dos niveles seguidos fuera del objetivo: no vale seguir
    return out


def real_ops() -> dict:
    """Operaciones contra el LLM y el servidor de voz reales (por el túnel o dentro del contenedor)."""
    from agents import clinical
    from agents.llm import OpenAICompatible
    from agents.turn import DEMO_CTX, run_turn
    from agents.voice import VoiceClient

    llm = OpenAICompatible(timeout=60)
    voice = VoiceClient(timeout=60)
    sample = voice.tts("Me dio un pinchazo en la ingle, ¿puedo bajar menos?")["wav"]   # el audio de entrada, hecho una vez

    def clinical_op() -> None:
        d = clinical.propose(llm, "Siento la rodilla un poco cansada", DEMO_CTX)
        if d.get("llm_ms") is None:
            raise RuntimeError(d.get("note"))

    def voice_op() -> None:
        r = run_turn(llm, "", DEMO_CTX, voice=voice, audio=sample)
        if "tts_error" in r:
            raise RuntimeError(r["tts_error"])

    return {"clinical": clinical_op, "voice": voice_op}


def report(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = ["| Sesiones | clínico p50 | clínico p95 | voz p50 | voz p95 | errores | dentro del objetivo |", "|---|---|---|---|---|---|---|"]
    for lv in data["levels"]:
        c, v = lv["ops"].get("clinical", {}), lv["ops"].get("voice", {})
        err = sum(o.get("errors", 0) for o in lv["ops"].values())
        rows.append(f"| {lv['sessions']} | {c.get('p50_ms')} | {c.get('p95_ms')} | {v.get('p50_ms')} | {v.get('p95_ms')} | {err} | {'sí' if lv['within_slo'] else 'no'} |")
    md = "\n".join(rows) + f"\n\nMáximo de sesiones dentro del objetivo: **{data['max_sessions_within_slo']}** (p95: {data['slo_p95_ms']})\n"
    (path.with_suffix(".md")).write_text(md, encoding="utf-8")
    (path.with_suffix(".svg")).write_text(svg_chart(data), encoding="utf-8")
    return md


def svg_chart(data: dict, w: int = 720, h: int = 360) -> str:
    """Latencia p95 por número de sesiones (eje x logarítmico en base 2), una línea por operación."""
    import math
    levels = data["levels"]
    if not levels:
        return "<svg xmlns='http://www.w3.org/2000/svg'/>"
    xs = [math.log2(lv["sessions"]) for lv in levels]
    ys = [o["p95_ms"] for lv in levels for o in lv["ops"].values() if o["p95_ms"]]
    ymax = max(ys + list(data["slo_p95_ms"].values())) * 1.1
    pad, colors = 48, {"clinical": "#0A6A9E", "voice": "#B9372D"}
    X = lambda x: pad + (x - min(xs)) / max(1e-9, max(xs) - min(xs)) * (w - 2 * pad)
    Y = lambda y: h - pad - y / ymax * (h - 2 * pad)
    parts = [f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {h}' font-family='sans-serif' font-size='12'>",
             f"<rect width='{w}' height='{h}' fill='#FFFFFF'/>",
             f"<line x1='{pad}' y1='{h - pad}' x2='{w - pad}' y2='{h - pad}' stroke='#536770'/>",
             f"<line x1='{pad}' y1='{pad}' x2='{pad}' y2='{h - pad}' stroke='#536770'/>"]
    for name, limit in data["slo_p95_ms"].items():
        parts.append(f"<line x1='{pad}' y1='{Y(limit):.0f}' x2='{w - pad}' y2='{Y(limit):.0f}' stroke='{colors.get(name, '#333')}' stroke-dasharray='4 4'/>")
    for name, color in colors.items():
        pts = [(X(math.log2(lv['sessions'])), Y(lv['ops'][name]['p95_ms'])) for lv in levels if lv["ops"].get(name, {}).get("p95_ms")]
        if pts:
            parts.append(f"<polyline fill='none' stroke='{color}' stroke-width='2' points='{' '.join(f'{x:.0f},{y:.0f}' for x, y in pts)}'/>")
            parts.append(f"<text x='{pts[-1][0] + 4:.0f}' y='{pts[-1][1]:.0f}' fill='{color}'>{name} p95</text>")
    for lv in levels:
        parts.append(f"<text x='{X(math.log2(lv['sessions'])):.0f}' y='{h - pad + 16}' text-anchor='middle'>{lv['sessions']}</text>")
    parts.append(f"<text x='{w / 2:.0f}' y='{h - 8}' text-anchor='middle'>sesiones concurrentes en 1× MI300X</text>")
    parts.append(f"<text x='12' y='{pad - 12}'>ms (p95; líneas punteadas = objetivo)</text></svg>")
    return "".join(parts)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Benchmark de sesiones concurrentes de AXONFAS (datos sintéticos).")
    p.add_argument("--levels", default="1,2,4,8,16,32,64")
    p.add_argument("--duration", type=float, default=60.0, help="segundos por nivel")
    p.add_argument("--every", type=float, default=8.0, help="segundos entre turnos de una sesión")
    p.add_argument("--slo-clinical", type=float, default=2000.0, help="p95 máximo del agente clínico (ms)")
    p.add_argument("--slo-voice", type=float, default=4000.0, help="p95 máximo del turno de voz completo (ms)")
    p.add_argument("--report", type=Path, help="solo genera la tabla y el gráfico de un resultado guardado")
    args = p.parse_args(argv)
    if args.report:
        print(report(args.report))
        return 0
    levels = [int(x) for x in args.levels.split(",") if x.strip()]
    result = sweep(levels, args.duration, real_ops(), {"clinical": args.slo_clinical, "voice": args.slo_voice}, args.every)
    result["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "bench.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
