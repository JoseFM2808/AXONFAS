"""Tests del benchmark de sesiones concurrentes (TD-08) con operaciones de mentira: sin GPU.

    py -m unittest discover -s tests/backend -v
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
from gpu import bench  # noqa: E402


class BenchTest(unittest.TestCase):
    def test_percentil(self):
        self.assertEqual(bench.percentile([10, 20, 30, 40, 50], 50), 30)
        self.assertEqual(bench.percentile([10, 20], 95), 19.5)
        self.assertIsNone(bench.percentile([], 95))

    def test_un_nivel_mide_cada_operacion_y_cuenta_errores(self):
        def fail():
            raise RuntimeError("caído")
        res = bench.run_level(3, 0.6, {"ok": lambda: time.sleep(0.01), "bad": fail}, every=0.1)
        self.assertEqual(res["sessions"], 3)
        self.assertGreater(res["ops"]["ok"]["count"], 0)
        self.assertGreaterEqual(res["ops"]["ok"]["p95_ms"], 10)
        self.assertGreater(res["ops"]["bad"]["errors"], 0)
        self.assertFalse(bench.meets(res, {"ok": 1000, "bad": 1000}), "con errores no cumple el objetivo")

    def test_el_barrido_para_cuando_la_latencia_pasa_el_objetivo(self):
        load = {"n": 0}

        def slow_with_load():                      # más sesiones → más espera, como una GPU compartida
            time.sleep(0.004 * load["n"])
        levels = []

        def log(line):
            levels.append(json.loads(line)["sessions"])

        orig = bench.run_level

        def run_level(n, duration, ops, every=8.0, seed=7):
            load["n"] = n
            return orig(n, duration, ops, every, seed)
        bench.run_level = run_level
        try:
            out = bench.sweep([1, 2, 4, 8, 16, 32], 0.4, {"clinical": slow_with_load}, {"clinical": 20}, every=0.05, log=log)
        finally:
            bench.run_level = orig
        self.assertGreaterEqual(out["max_sessions_within_slo"], 2)
        self.assertLess(out["max_sessions_within_slo"], 16)
        self.assertLess(len(levels), 6, "dos niveles fuera del objetivo cortan el barrido")

    def test_reporte_markdown_y_svg(self):
        data = {"slo_p95_ms": {"clinical": 2000, "voice": 4000}, "max_sessions_within_slo": 2, "levels": [
            {"sessions": n, "within_slo": n <= 2, "ops": {"clinical": {"p50_ms": 300 * n, "p95_ms": 500 * n, "errors": 0},
                                                          "voice": {"p50_ms": 900 * n, "p95_ms": 1500 * n, "errors": 0}}}
            for n in (1, 2, 4)]}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bench.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            md = bench.report(path)
            self.assertIn("**2**", md)
            svg = path.with_suffix(".svg").read_text(encoding="utf-8")
            self.assertTrue(svg.startswith("<svg") and "polyline" in svg)


if __name__ == "__main__":
    unittest.main()
