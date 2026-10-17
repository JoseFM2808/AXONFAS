"""API de Staging de AXONFAS: cuentas de demostración de fisioterapeuta y paciente, planes, sesiones y vista en vivo.

ADR-012 y ADR-013. La sirve serve.py en el mismo origen que el prototipo (rutas /api/...). Solo biblioteca estándar.

- Datos en SQLite fuera del repo y de Drive (por defecto ~/.axonfas/staging.sqlite3). Solo datos sintéticos o del
  equipo con consentimiento (ADR-010).
- Cuentas de demostración, sin contraseñas: cada dispositivo recibe un token bearer aleatorio. NO es autenticación de
  Producción (TD-38).
- El paciente se afilia con el código que genera su fisioterapeuta y acepta el consentimiento. Sin consentimiento y sin
  plan para ese ejercicio no se registran sesiones (I-3, I-9).
- Un fisioterapeuta solo ve a sus pacientes (I-10). El canal en vivo lleva ángulos, fase, repeticiones, eventos y
  puntos 2D del cuerpo; nunca video ni imágenes (ADR-003, I-11).
"""
from __future__ import annotations

import json
import math
import queue
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # src/, para los agentes (ADR-016/017)
sys.path.insert(0, str(Path(__file__).resolve().parent))       # src/backend, para settings y google_auth

import google_auth  # noqa: E402
import settings  # noqa: E402

SCHEMA = """
CREATE TABLE IF NOT EXISTS therapist (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patient (
  id INTEGER PRIMARY KEY, therapist_id INTEGER NOT NULL REFERENCES therapist(id),
  alias TEXT NOT NULL, birth_year INTEGER, consent_given INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT UNIQUE, joined_at TEXT, created_at TEXT NOT NULL, profile TEXT);
CREATE TABLE IF NOT EXISTS token (
  token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('therapist', 'patient', 'admin', 'user')),
  subject_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT,
  role TEXT NOT NULL DEFAULT 'pending' CHECK (role IN ('admin', 'therapist', 'patient', 'pending')),
  therapist_id INTEGER REFERENCES therapist(id), patient_id INTEGER REFERENCES patient(id),
  disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS plan_exercise (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id), exercise_id TEXT NOT NULL,
  sets INTEGER NOT NULL, reps INTEGER NOT NULL, hold_seconds INTEGER NOT NULL, per_week INTEGER NOT NULL,
  safety_envelope TEXT NOT NULL, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id), exercise_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('monitored', 'guided')),
  source TEXT NOT NULL CHECK (source IN ('camera', 'demo', 'guided')),
  started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('completed', 'pain_stop', 'envelope_breach', 'user_quit')),
  reps_done INTEGER NOT NULL, baseline TEXT, reps TEXT, pain_reported INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS compensation_event (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES session(id), rep INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('trunk_flexion', 'knee_valgus')), side TEXT, value REAL, peak REAL,
  threshold REAL, severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 3), alert_latency_ms INTEGER);
CREATE INDEX IF NOT EXISTS idx_patient_therapist ON patient(therapist_id);
CREATE INDEX IF NOT EXISTS idx_session_patient ON session(patient_id, ended_at);
"""

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"        # sin I, O, 0, 1 para dictarlo sin confusiones
END_REASONS = {"completed", "pain_stop", "envelope_breach", "user_quit"}
EVENT_TYPES = {"trunk_flexion", "knee_valgus"}
# nariz, orejas, hombros, codos, muñecas, caderas, rodillas, tobillos (ADR-013; brazos y orejas para la galería, ADR-014)
LIVE_POINTS = {"0", "7", "8", "11", "12", "13", "14", "15", "16", "23", "24", "25", "26", "27", "28"}
METRIC_UNITS = {"°", "cm", "%"}
# Perfil del paciente (ADR-017): solo opciones cerradas y una nota corta. Los ids son los de suggestions.js.
PROFILE_LIMITS = {"no_floor", "no_kneel", "no_standing", "balance", "walking_aid", "arm_limited", "no_band", "low_vision", "hearing"}
PAIN_AREAS = {"knee", "hip", "back", "neck", "shoulder"}
MAX_BODY = 256 * 1024


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


@dataclass
class Stream:
    """Respuesta que serve.py convierte en Server-Sent Events sobre `channel`."""
    channel: tuple
    hello: dict


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load_names(path: Path) -> dict[str, str]:
    """{id: nombre} de catalog.js, para validar que la IA no nombre ejercicios que no vienen al caso (ADR-017)."""
    return dict(re.findall(r"id: '([a-z0-9-]+)', theme: '[a-z-]+', name: '([^']+)'", path.read_text(encoding="utf-8")))


def clean_profile(data: dict) -> dict:
    limitations = data.get("limitations") or []
    pain = data.get("pain_areas") or []
    if not isinstance(limitations, list) or not isinstance(pain, list):
        raise ApiError(400, "'limitations' y 'pain_areas' deben ser listas.")
    unknown = [x for x in limitations if x not in PROFILE_LIMITS] + [x for x in pain if x not in PAIN_AREAS]
    if unknown:
        raise ApiError(400, f"Opciones de perfil desconocidas: {', '.join(map(str, unknown[:5]))}.")
    note = data.get("note")
    if note is not None and not isinstance(note, str):
        raise ApiError(400, "'note' debe ser texto.")
    note = (note or "").strip()[:200] or None
    return {"limitations": sorted(set(limitations)), "pain_areas": sorted(set(pain)), "note": note, "updated_at": now_iso()}


def load_catalog(path: Path) -> dict[str, str]:
    """{id: 'auto' | 'guided'} leído de catalog.js, la fuente única del catálogo (ADR-011)."""
    text = path.read_text(encoding="utf-8")
    found = re.findall(r"id: '([a-z0-9-]+)', theme: '[a-z-]+'.*?monitoring: '(auto|guided)'", text, re.S)
    if not found:
        raise ValueError(f"no se encontraron ejercicios en {path}")
    return dict(found)


# ------------------------------------------------------------------------------------------------ canal en vivo
class LiveHub:
    """Suscripciones en memoria. ('therapist', id) recibe lo que publica el paciente id; ('patient', id) recibe lo que
    le señala su fisioterapeuta. Si un suscriptor se atrasa, se descartan mensajes en vez de bloquear al paciente."""

    def __init__(self):
        self._lock = threading.Lock()
        self._subs: dict[tuple, list[queue.Queue]] = defaultdict(list)
        self._last: dict[tuple, tuple[float, dict]] = {}

    def subscribe(self, channel: tuple) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self._lock:
            self._subs[channel].append(q)
        return q

    def unsubscribe(self, channel: tuple, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subs.get(channel, []):
                self._subs[channel].remove(q)

    def publish(self, channel: tuple, message: dict) -> int:
        with self._lock:
            self._last[channel] = (time.time(), message)
            targets = list(self._subs.get(channel, []))
        for q in targets:
            try:
                q.put_nowait(message)
            except queue.Full:
                pass
        return len(targets)

    def last(self, channel: tuple, max_age: float = 6.0) -> dict | None:
        with self._lock:
            item = self._last.get(channel)
        return item[1] if item and time.time() - item[0] <= max_age else None


# ------------------------------------------------------------------------------------------------ indicadores
def compute_metrics(plan: list[dict], sessions: list[dict], events: list[dict], now: datetime | None = None) -> dict:
    """Indicadores descriptivos (no son resultados clínicos):
    - adherence: por ejercicio del plan, sesiones completadas en 7 días / sesiones por semana indicadas (tope 1).
    - quality: en sesiones monitoreadas, fracción de repeticiones de ejercicio sin compensación.
    - quality_trend: promedio de las 3 últimas sesiones monitoreadas menos el de las 3 primeras (con 4 o más).
    - rom: flexión media de rodilla en las repeticiones de ejercicio, primera y última sesión monitoreada.
    - camera_*: por ejercicio del plan, en las sesiones con conteo de cámara, el recorrido medio por repetición (en la
      unidad de su medida) y el sostén medio, de la primera y la última sesión (TD-49).
    - pain_stops_30d: sesiones detenidas por dolor en 30 días (bandera roja para el fisioterapeuta).
    """
    now = now or datetime.now(timezone.utc)
    week_ago, month_ago = now - timedelta(days=7), now - timedelta(days=30)
    per_exercise = []
    for item in plan:
        done = sum(1 for s in sessions if s["exercise_id"] == item["exercise_id"] and s["end_reason"] == "completed"
                   and parse_iso(s["ended_at"]) >= week_ago)
        per_exercise.append({"exercise_id": item["exercise_id"], "done_7d": done, "per_week": item["per_week"],
                             "ratio": round(min(1.0, done / item["per_week"]), 3) if item["per_week"] else None})
    ratios = [p["ratio"] for p in per_exercise if p["ratio"] is not None]

    camera: dict[str, list[dict]] = defaultdict(list)
    for s in sorted(sessions, key=lambda s: s["ended_at"]):
        if s["mode"] != "guided" or s.get("source") != "camera":
            continue
        reps = [r for r in json.loads(s["reps"] or "[]") if isinstance(r, dict)]
        peaks = [r["peak"] for r in reps if isinstance(r.get("peak"), (int, float))]
        holds = [r["holdSec"] for r in reps if isinstance(r.get("holdSec"), (int, float))]
        if peaks or holds:
            camera[s["exercise_id"]].append({
                "session_id": s["id"], "ended_at": s["ended_at"], "reps": len(reps),
                "peak": round(sum(peaks) / len(peaks), 1) if peaks else None,
                "hold": round(sum(holds) / len(holds), 1) if holds else None})
    for p in per_exercise:
        series = camera.get(p["exercise_id"], [])
        p.update({"camera_first": series[0] if series else None, "camera_last": series[-1] if series else None,
                  "camera_sessions": len(series), "camera_series": series[-20:]})

    events_by_session: dict[int, set[int]] = defaultdict(set)
    for e in events:
        events_by_session[e["session_id"]].add(e["rep"])
    monitored = sorted((s for s in sessions if s["mode"] == "monitored"), key=lambda s: s["ended_at"])
    quality, rom = [], []
    for s in monitored:
        reps = [r for r in json.loads(s["reps"] or "[]") if not r.get("calibration")]
        if not reps:
            continue
        flagged = sum(1 for r in reps if r.get("index") in events_by_session[s["id"]])
        quality.append({"session_id": s["id"], "ended_at": s["ended_at"], "clean": round(1 - flagged / len(reps), 3)})
        knees = [r["kneeRom"] for r in reps if isinstance(r.get("kneeRom"), (int, float))]
        if knees:
            rom.append({"session_id": s["id"], "ended_at": s["ended_at"], "knee": round(sum(knees) / len(knees), 1)})
    mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    trend = (round(mean([q["clean"] for q in quality[-3:]]) - mean([q["clean"] for q in quality[:3]]), 3)
             if len(quality) >= 4 else None)
    return {
        "adherence": mean(ratios), "per_exercise": per_exercise,
        "quality": quality[-1]["clean"] if quality else None, "quality_series": quality[-20:], "quality_trend": trend,
        "rom_first": rom[0]["knee"] if rom else None, "rom_last": rom[-1]["knee"] if rom else None, "rom_series": rom[-20:],
        "pain_stops_30d": sum(1 for s in sessions if s["end_reason"] == "pain_stop" and parse_iso(s["ended_at"]) >= month_ago),
        "sessions_total": len(sessions), "last_session_at": max((s["ended_at"] for s in sessions), default=None),
    }


# Campos por repetición que se guardan: los del motor de reglas (sentarse y pararse) y los del conteo con cámara de
# la galería (TD-49: recorrido máximo, sostén, duración y lado). Todo lo demás se descarta.
REP_NUMBERS = ("kneeRom", "peakTrunk", "peakValgusL", "peakValgusR", "lowConfidenceRatio", "peak", "holdSec", "seconds")
REP_FLAGS = ("calibration", "romReached", "holdOk")
REP_SIDES = ("L", "R", "+", "-")


def clean_rep(rep: dict) -> dict:
    out = {"index": rep["index"]} if isinstance(rep.get("index"), int) and not isinstance(rep.get("index"), bool) else {}
    for key in REP_FLAGS:
        if isinstance(rep.get(key), bool):
            out[key] = rep[key]
    for key in REP_NUMBERS:
        value = rep.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            out[key] = round(float(value), 2)
    if rep.get("side") in REP_SIDES:
        out["side"] = rep["side"]
    return out


# ------------------------------------------------------------------------------------------------ API
class StagingApi:
    def __init__(self, db_path: str | Path, catalog: dict[str, str], names: dict[str, str] | None = None):
        if str(db_path) != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(SCHEMA)
        if "profile" not in {r["name"] for r in self.db.execute("PRAGMA table_info(patient)")}:
            self.db.execute("ALTER TABLE patient ADD COLUMN profile TEXT")    # bases creadas antes de ADR-017
        token_sql = self.db.execute("SELECT sql FROM sqlite_master WHERE name = 'token'").fetchone()["sql"]
        if "'admin'" not in token_sql:                                        # bases creadas antes de ADR-019
            with self.db:
                self.db.executescript("""
                  CREATE TABLE token_new (token TEXT PRIMARY KEY,
                    role TEXT NOT NULL CHECK (role IN ('therapist', 'patient', 'admin', 'user')),
                    subject_id INTEGER NOT NULL, created_at TEXT NOT NULL);
                  INSERT INTO token_new SELECT token, role, subject_id, created_at FROM token;
                  DROP TABLE token;
                  ALTER TABLE token_new RENAME TO token;""")
        self.jwks = google_auth.Jwks()
        self.lock = threading.RLock()
        self.catalog = catalog
        self.names = names or {}
        self._ai = {"checked": 0.0, "available": False}
        self.hub = LiveHub()
        self.routes = [
            ("POST", r"/api/therapists", self.create_therapist, None),
            ("GET", r"/api/therapists/me", self.therapist_me, "therapist"),
            ("POST", r"/api/patients", self.create_patient, "therapist"),
            ("GET", r"/api/patients/(\d+)", self.patient_detail, "therapist"),
            ("PUT", r"/api/patients/(\d+)/plan", self.set_plan, "therapist"),
            ("POST", r"/api/patients/(\d+)/invite", self.new_invite, "therapist"),
            ("POST", r"/api/patients/(\d+)/highlight", self.highlight, "therapist"),
            ("GET", r"/api/patients/(\d+)/live", self.live_stream_for_therapist, "therapist"),
            ("PUT", r"/api/patients/(\d+)/profile", self.set_patient_profile, "therapist"),
            ("POST", r"/api/patients/(\d+)/advice", self.advice, "therapist"),
            ("GET", r"/api/ai/status", self.ai_status, "therapist"),
            ("POST", r"/api/join", self.join, None),
            ("GET", r"/api/auth/config", self.auth_config, None),
            ("POST", r"/api/auth/google", self.auth_google, None),
            ("POST", r"/api/auth/role", self.auth_role, "user"),
            ("GET", r"/api/auth/me", self.auth_me, "*"),
            ("POST", r"/api/auth/logout", self.auth_logout, "*"),
            ("GET", r"/api/admin/overview", self.admin_overview, "admin"),
            ("GET", r"/api/admin/users", self.admin_users, "admin"),
            ("PUT", r"/api/admin/users/(\d+)", self.admin_update_user, "admin"),
            ("GET", r"/api/admin/ai", self.admin_ai, "admin"),
            ("POST", r"/api/admin/ai/test", self.admin_ai_test, "admin"),
            ("GET", r"/api/me", self.patient_me, "patient"),
            ("POST", r"/api/sessions", self.create_session, "patient"),
            ("POST", r"/api/live", self.publish_live, "patient"),
            ("GET", r"/api/me/stream", self.live_stream_for_patient, "patient"),
            ("PUT", r"/api/me/profile", self.set_my_profile, "patient"),
        ]

    # -------------------------------------------------------------------------------------- utilidades
    def handle(self, method: str, path: str, headers, body: bytes):
        """Devuelve (status, payload) o un Stream. Nunca lanza: los errores salen como (status, {'error': ...})."""
        path = path.split("?", 1)[0].rstrip("/") or "/"
        try:
            for m, pattern, fn, role in self.routes:
                match = re.fullmatch(pattern, path)
                if match and m == method:
                    if len(body or b"") > MAX_BODY:
                        raise ApiError(413, "El cuerpo de la petición es demasiado grande.")
                    data = json.loads(body.decode("utf-8")) if body else {}
                    if not isinstance(data, dict):
                        raise ApiError(400, "Se esperaba un objeto JSON.")
                    if role == "*":
                        subject = self._who(headers)
                    else:
                        subject = self._auth(headers, role) if role else None
                    return fn(subject, data, *[int(g) for g in match.groups()])
            if any(re.fullmatch(p, path) for _, p, _, _ in self.routes):
                raise ApiError(405, "Método no permitido.")
            raise ApiError(404, "No existe esa ruta.")
        except ApiError as err:
            return err.status, {"error": err.message}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return 400, {"error": "JSON inválido."}

    def _auth(self, headers, role: str) -> int:
        value = (headers.get("Authorization") or "").strip()
        if not value.startswith("Bearer "):
            raise ApiError(401, "Falta el token. Vuelve a entrar.")
        with self.lock:
            row = self.db.execute("SELECT role, subject_id FROM token WHERE token = ?", (value[7:].strip(),)).fetchone()
        if not row:
            raise ApiError(401, "El token no es válido. Vuelve a entrar.")
        if row["role"] != role:
            raise ApiError(403, "Esta acción no corresponde a tu tipo de cuenta.")
        return row["subject_id"]

    def _who(self, headers) -> dict:
        """Cualquier token válido: {role, subject_id, token}."""
        value = (headers.get("Authorization") or "").strip()
        if not value.startswith("Bearer "):
            raise ApiError(401, "Falta el token. Vuelve a entrar.")
        with self.lock:
            row = self.db.execute("SELECT token, role, subject_id FROM token WHERE token = ?", (value[7:].strip(),)).fetchone()
        if not row:
            raise ApiError(401, "El token no es válido. Vuelve a entrar.")
        return dict(row)

    def _token(self, role: str, subject_id: int) -> str:
        token = secrets.token_urlsafe(32)
        self.db.execute("INSERT INTO token (token, role, subject_id, created_at) VALUES (?, ?, ?, ?)",
                        (token, role, subject_id, now_iso()))
        return token

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
            if not self.db.execute("SELECT 1 FROM patient WHERE invite_code = ?", (code,)).fetchone():
                return code

    def _own_patient(self, therapist_id: int, patient_id: int) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM patient WHERE id = ? AND therapist_id = ?", (patient_id, therapist_id)).fetchone()
        if not row:
            raise ApiError(404, "No existe ese paciente en tu lista.")             # I-10: ni siquiera confirma que existe
        return row

    @staticmethod
    def _text(data: dict, key: str, max_len: int, required: bool = True) -> str | None:
        value = data.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            if required:
                raise ApiError(400, f"Falta '{key}'.")
            return None
        if not isinstance(value, str) or len(value.strip()) > max_len:
            raise ApiError(400, f"'{key}' debe ser texto de hasta {max_len} caracteres.")
        return value.strip()

    @staticmethod
    def _int(data: dict, key: str, lo: int, hi: int, default: int | None = None) -> int:
        value = data.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
            raise ApiError(400, f"'{key}' debe ser un número entre {lo} y {hi}.")
        return int(value)

    def _plan(self, patient_id: int) -> list[dict]:
        rows = self.db.execute("SELECT * FROM plan_exercise WHERE patient_id = ? AND active = 1 ORDER BY id", (patient_id,))
        return [{"id": r["id"], "exercise_id": r["exercise_id"], "sets": r["sets"], "reps": r["reps"],
                 "hold_seconds": r["hold_seconds"], "per_week": r["per_week"],
                 "safety_envelope": json.loads(r["safety_envelope"]), "notes": r["notes"], "since": r["created_at"]} for r in rows]

    @staticmethod
    def _patient_public(row: sqlite3.Row) -> dict:
        return {"id": row["id"], "alias": row["alias"], "birth_year": row["birth_year"],
                "consent_given": bool(row["consent_given"]), "joined_at": row["joined_at"],
                "invite_code": None if row["joined_at"] else row["invite_code"],
                "profile": json.loads(row["profile"]) if row["profile"] else None}

    def _sessions(self, patient_id: int, limit: int = 200) -> list[dict]:
        rows = self.db.execute("SELECT * FROM session WHERE patient_id = ? ORDER BY ended_at DESC LIMIT ?", (patient_id, limit))
        return [dict(r) for r in rows]

    def _events(self, session_ids: list[int]) -> list[dict]:
        if not session_ids:
            return []
        marks = ",".join("?" * len(session_ids))
        rows = self.db.execute(f"SELECT * FROM compensation_event WHERE session_id IN ({marks}) ORDER BY id DESC", session_ids)
        return [dict(r) for r in rows]

    # -------------------------------------------------------------------------------------- fisioterapeuta
    def create_therapist(self, _subject, data):
        if not settings.demo_accounts():
            raise ApiError(403, "Las cuentas de demostración están apagadas en este servidor: entra con Google.")
        name = self._text(data, "name", 80)
        with self.lock, self.db:
            cur = self.db.execute("INSERT INTO therapist (name, created_at) VALUES (?, ?)", (name, now_iso()))
            token = self._token("therapist", cur.lastrowid)
        return 201, {"token": token, "therapist": {"id": cur.lastrowid, "name": name}}

    def therapist_me(self, therapist_id, _data):
        with self.lock:
            therapist = self.db.execute("SELECT id, name FROM therapist WHERE id = ?", (therapist_id,)).fetchone()
            patients = self.db.execute("SELECT * FROM patient WHERE therapist_id = ? ORDER BY id DESC", (therapist_id,)).fetchall()
            out = []
            for p in patients:
                sessions = self._sessions(p["id"])
                metrics = compute_metrics(self._plan(p["id"]), sessions, self._events([s["id"] for s in sessions]))
                out.append({**self._patient_public(p), "plan_size": len(self._plan(p["id"])), "metrics": metrics,
                            "live": self.hub.last(("therapist", p["id"])) is not None})
        return 200, {"therapist": dict(therapist), "patients": out}

    def create_patient(self, therapist_id, data):
        alias = self._text(data, "alias", 60)
        birth_year = data.get("birth_year")
        if birth_year not in (None, ""):
            birth_year = self._int(data, "birth_year", 1900, datetime.now().year)
        else:
            birth_year = None
        with self.lock, self.db:
            code = self._new_code()
            cur = self.db.execute("INSERT INTO patient (therapist_id, alias, birth_year, invite_code, created_at) "
                                  "VALUES (?, ?, ?, ?, ?)", (therapist_id, alias, birth_year, code, now_iso()))
            row = self.db.execute("SELECT * FROM patient WHERE id = ?", (cur.lastrowid,)).fetchone()
        return 201, {"patient": self._patient_public(row)}

    def patient_detail(self, therapist_id, _data, patient_id):
        with self.lock:
            p = self._own_patient(therapist_id, patient_id)
            plan = self._plan(patient_id)
            sessions = self._sessions(patient_id)
            events = self._events([s["id"] for s in sessions])
        for s in sessions:
            s["reps"] = json.loads(s["reps"] or "[]")
            s["baseline"] = json.loads(s["baseline"]) if s["baseline"] else None
        metrics = compute_metrics(plan, [{**s, "reps": json.dumps(s["reps"])} for s in sessions], events)
        return 200, {"patient": self._patient_public(p), "plan": plan, "sessions": sessions[:30], "events": events[:60],
                     "metrics": metrics, "live": self.hub.last(("therapist", patient_id))}

    def set_plan(self, therapist_id, data, patient_id):
        items = data.get("exercises")
        if not isinstance(items, list) or len(items) > 20:
            raise ApiError(400, "'exercises' debe ser una lista de hasta 20 ejercicios.")
        clean, seen = [], set()
        for item in items:
            if not isinstance(item, dict):
                raise ApiError(400, "Cada ejercicio debe ser un objeto.")
            ex_id = item.get("exercise_id")
            if ex_id not in self.catalog:
                raise ApiError(400, f"El ejercicio '{ex_id}' no está en el catálogo.")
            if ex_id in seen:
                raise ApiError(400, f"El ejercicio '{ex_id}' está repetido.")
            seen.add(ex_id)
            envelope = {}
            if self.catalog[ex_id] == "auto":                    # ADR-005: el sobre lo fija el terapeuta
                env = item.get("safety_envelope") or {}
                envelope = {"trunk_margin": self._int(env, "trunk_margin", 5, 35, 15),
                            "valgus_margin": self._int(env, "valgus_margin", 3, 25, 10),
                            "max_reps": self._int(env, "max_reps", 4, 20, 10)}
            clean.append((ex_id, self._int(item, "sets", 1, 10), self._int(item, "reps", 1, 50),
                          self._int(item, "hold_seconds", 0, 120, 0), self._int(item, "per_week", 1, 7),
                          json.dumps(envelope), self._text(item, "notes", 300, required=False)))
        with self.lock, self.db:
            self._own_patient(therapist_id, patient_id)
            self.db.execute("UPDATE plan_exercise SET active = 0 WHERE patient_id = ?", (patient_id,))
            for row in clean:
                self.db.execute("INSERT INTO plan_exercise (patient_id, exercise_id, sets, reps, hold_seconds, per_week, "
                                "safety_envelope, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                (patient_id, *row, now_iso()))
            plan = self._plan(patient_id)
        self.hub.publish(("patient", patient_id), {"kind": "plan_updated", "at": now_iso()})
        return 200, {"plan": plan}

    def new_invite(self, therapist_id, _data, patient_id):
        with self.lock, self.db:
            self._own_patient(therapist_id, patient_id)
            code = self._new_code()
            self.db.execute("UPDATE patient SET invite_code = ?, joined_at = NULL WHERE id = ?", (code, patient_id))
        return 200, {"invite_code": code}

    # ------------------------------------------------------------------ inicio de sesión con Google (ADR-019)
    def _user_public(self, row) -> dict:
        return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"],
                "therapist_id": row["therapist_id"], "patient_id": row["patient_id"], "disabled": bool(row["disabled"]),
                "created_at": row["created_at"], "last_login_at": row["last_login_at"]}

    def _session_for(self, user) -> dict:
        """Token del rol que la cuenta ya tiene; si todavía no eligió, un token 'user' para elegirlo."""
        role = user["role"]
        if role == "admin":
            return {"role": "admin", "token": self._token("admin", user["id"])}
        if role == "therapist" and user["therapist_id"]:
            return {"role": "therapist", "token": self._token("therapist", user["therapist_id"])}
        if role == "patient" and user["patient_id"]:
            return {"role": "patient", "token": self._token("patient", user["patient_id"])}
        return {"role": "user", "token": self._token("user", user["id"])}

    def auth_config(self, _subject, _data):
        from agents import providers
        cfg = providers.config()
        return 200, {"google_client_id": settings.google_client_id() or None, "demo_accounts": settings.demo_accounts(),
                     "ai_provider": cfg["label"] if cfg else None}

    def auth_google(self, _subject, data):
        credential = data.get("credential")
        if not isinstance(credential, str) or len(credential) > 4096:
            raise ApiError(400, "Falta el token de Google.")
        try:
            claims = google_auth.verify_id_token(credential, settings.google_client_id(), self.jwks)
        except google_auth.AuthError as err:
            raise ApiError(401, f"No se pudo verificar el inicio de sesión con Google: {err}")
        email = str(claims["email"]).lower()
        name = str(claims.get("name") or claims.get("given_name") or email.split("@")[0])[:80]
        is_admin = email in settings.admin_emails()
        with self.lock, self.db:
            user = self.db.execute("SELECT * FROM app_user WHERE google_sub = ?", (claims["sub"],)).fetchone()
            if user is None:
                cur = self.db.execute("INSERT INTO app_user (google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)",
                                      (claims["sub"], email, name, "admin" if is_admin else "pending", now_iso()))
                user = self.db.execute("SELECT * FROM app_user WHERE id = ?", (cur.lastrowid,)).fetchone()
            if user["disabled"]:
                raise ApiError(403, "Esta cuenta está desactivada. Habla con el equipo de AXONFAS.")
            # El rol de Administrador sale solo de AXONFAS_ADMIN_EMAILS: se da y se quita en cada inicio de sesión.
            new_role = "admin" if is_admin else ("pending" if user["role"] == "admin" else user["role"])
            self.db.execute("UPDATE app_user SET email = ?, name = ?, role = ?, last_login_at = ? WHERE id = ?",
                            (email, name, new_role, now_iso(), user["id"]))
            user = self.db.execute("SELECT * FROM app_user WHERE id = ?", (user["id"],)).fetchone()
            session = self._session_for(user)
        return 200, {**session, "user": self._user_public(user)}

    def auth_role(self, user_id, data):
        """Una cuenta de Google nueva elige su rol: fisioterapeuta, o paciente con el código de su fisioterapeuta."""
        role = data.get("role")
        with self.lock:
            user = self.db.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        if not user or user["disabled"]:
            raise ApiError(403, "Cuenta no disponible.")
        if user["role"] != "pending":
            raise ApiError(409, "Esta cuenta ya tiene un rol.")
        if role == "therapist":
            name = self._text(data, "name", 80, required=False) or user["name"]
            with self.lock, self.db:
                cur = self.db.execute("INSERT INTO therapist (name, created_at) VALUES (?, ?)", (name, now_iso()))
                self.db.execute("UPDATE app_user SET role = 'therapist', therapist_id = ? WHERE id = ?", (cur.lastrowid, user_id))
                token = self._token("therapist", cur.lastrowid)
            return 201, {"role": "therapist", "token": token, "therapist": {"id": cur.lastrowid, "name": name}}
        if role == "patient":
            status, body = self._join(data, user_id=user_id)
            return status, {"role": "patient", **body}
        raise ApiError(400, "Elige 'therapist' o 'patient'.")

    def auth_me(self, who, _data):
        out = {"role": who["role"]}
        with self.lock:
            if who["role"] in ("admin", "user"):
                row = self.db.execute("SELECT * FROM app_user WHERE id = ?", (who["subject_id"],)).fetchone()
            else:
                col = "therapist_id" if who["role"] == "therapist" else "patient_id"
                row = self.db.execute(f"SELECT * FROM app_user WHERE {col} = ?", (who["subject_id"],)).fetchone()
        out["user"] = self._user_public(row) if row else None          # None = cuenta de demostración
        return 200, out

    def auth_logout(self, who, _data):
        with self.lock, self.db:
            self.db.execute("DELETE FROM token WHERE token = ?", (who["token"],))
        return 200, {"ok": True}

    # ------------------------------------------------------------------ Administrador maestro (ADR-019)
    def admin_overview(self, _admin_id, _data):
        from agents import providers
        q = lambda sql, *a: self.db.execute(sql, a).fetchone()[0]  # noqa: E731
        week = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        month = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        with self.lock:
            roles = {r["role"]: r["n"] for r in self.db.execute("SELECT role, COUNT(*) AS n FROM app_user GROUP BY role")}
            data = {
                "users": roles, "users_total": sum(roles.values()),
                "therapists": q("SELECT COUNT(*) FROM therapist"),
                "patients": q("SELECT COUNT(*) FROM patient"), "patients_joined": q("SELECT COUNT(*) FROM patient WHERE joined_at IS NOT NULL"),
                "sessions_total": q("SELECT COUNT(*) FROM session"), "sessions_7d": q("SELECT COUNT(*) FROM session WHERE ended_at >= ?", week),
                "pain_stops_30d": q("SELECT COUNT(*) FROM session WHERE end_reason = 'pain_stop' AND ended_at >= ?", month),
                "events_total": q("SELECT COUNT(*) FROM compensation_event"),
            }
        cfg = providers.config()
        data["config"] = {"google_login": bool(settings.google_client_id()), "demo_accounts": settings.demo_accounts(),
                          "admins_configured": len(settings.admin_emails()), "ai_provider": cfg["label"] if cfg else None,
                          "cors_origins": settings.cors_origins()}
        data["ai_usage"] = providers.usage()
        return 200, data

    def admin_users(self, _admin_id, _data):
        with self.lock:
            rows = self.db.execute("SELECT * FROM app_user ORDER BY last_login_at DESC, id DESC LIMIT 500").fetchall()
        return 200, {"users": [self._user_public(r) for r in rows]}

    def admin_update_user(self, admin_id, data, user_id):
        """Cambia el rol (pendiente, fisioterapeuta) o desactiva una cuenta. El rol de Administrador solo sale del entorno."""
        if user_id == admin_id:
            raise ApiError(400, "No puedes cambiar tu propia cuenta de Administrador.")
        with self.lock, self.db:
            user = self.db.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "No existe esa cuenta.")
            if user["role"] == "admin":
                raise ApiError(400, "El rol de Administrador se maneja con AXONFAS_ADMIN_EMAILS.")
            if "disabled" in data:
                if not isinstance(data["disabled"], bool):
                    raise ApiError(400, "'disabled' debe ser true o false.")
                self.db.execute("UPDATE app_user SET disabled = ? WHERE id = ?", (int(data["disabled"]), user_id))
                if data["disabled"]:
                    self._revoke(user)
            if "role" in data:
                role = data["role"]
                if role not in ("pending", "therapist"):
                    raise ApiError(400, "Desde aquí solo se puede dejar 'pending' o 'therapist'; un paciente se afilia con su código.")
                if role == "therapist" and not user["therapist_id"]:
                    cur = self.db.execute("INSERT INTO therapist (name, created_at) VALUES (?, ?)", (user["name"] or user["email"], now_iso()))
                    self.db.execute("UPDATE app_user SET therapist_id = ? WHERE id = ?", (cur.lastrowid, user_id))
                self.db.execute("UPDATE app_user SET role = ? WHERE id = ?", (role, user_id))
                self._revoke(user)                       # la próxima vez entra con el rol nuevo
            user = self.db.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return 200, {"user": self._user_public(user)}

    def _revoke(self, user) -> None:
        self.db.execute("DELETE FROM token WHERE role = 'user' AND subject_id = ?", (user["id"],))
        if user["therapist_id"]:
            self.db.execute("DELETE FROM token WHERE role = 'therapist' AND subject_id = ?", (user["therapist_id"],))
        if user["patient_id"]:
            self.db.execute("DELETE FROM token WHERE role = 'patient' AND subject_id = ?", (user["patient_id"],))

    def admin_ai(self, _admin_id, _data):
        from agents import providers
        return 200, {"status": providers.status(timeout=6), "usage": providers.usage(), "missing": providers.missing()}

    def admin_ai_test(self, _admin_id, data):
        """Una pregunta corta al modelo de AMD, para comprobar la conexión desde la vista de control."""
        prompt = self._text(data, "prompt", 300, required=False) or "Responde en una frase: ¿qué es la fisioterapia en casa?"
        llm = self._llm("admin-test")
        if llm is None:
            raise ApiError(503, "Sin proveedor de IA: configura AMD Token Factory (AMD_TOKENFACTORY_BASE_URL y AMD_TOKENFACTORY_API_KEY).")
        from agents.llm import LLMError
        try:
            out = llm.chat([{"role": "user", "content": prompt}], max_tokens=120, temperature=0.3)
        except LLMError as err:
            raise ApiError(502, f"El modelo de AMD no respondió: {err}")
        return 200, {"model": llm.model, "text": out["text"], "ms": out["ms"], "completion_tokens": out.get("completion_tokens")}

    # ------------------------------------------------------------------ perfil y sugerencias (ADR-017)
    def _save_profile(self, patient_id: int, data: dict) -> dict:
        profile = clean_profile(data)
        with self.lock, self.db:
            self.db.execute("UPDATE patient SET profile = ? WHERE id = ?", (json.dumps(profile), patient_id))
        return profile

    def set_my_profile(self, patient_id, data):
        profile = self._save_profile(patient_id, data)
        self.hub.publish(("therapist", patient_id), {"kind": "profile_updated", "at": now_iso()})
        return 200, {"profile": profile}

    def set_patient_profile(self, therapist_id, data, patient_id):
        with self.lock:
            self._own_patient(therapist_id, patient_id)
        profile = self._save_profile(patient_id, data)
        self.hub.publish(("patient", patient_id), {"kind": "profile_updated", "at": now_iso()})
        return 200, {"profile": profile}

    def _llm(self, purpose: str = "advice"):
        from agents import providers
        return providers.client(purpose, timeout=30)

    def ai_status(self, _therapist_id, _data):
        """¿Hay IA de AMD conectada (Token Factory o vLLM propio)? Se consulta el catálogo como mucho cada 30 s."""
        from agents import providers
        if not providers.config():
            return 200, {"available": False, "provider": None, "reason": "sin proveedor de IA configurado"}
        if time.time() - self._ai["checked"] > 30:
            st = providers.status(timeout=4)
            self._ai.update(checked=time.time(), available=st["available"], provider=st["provider"], reason=st["reason"])
        return 200, {"available": self._ai["available"], "provider": self._ai.get("provider"), "reason": self._ai.get("reason")}

    def advice(self, therapist_id, data, patient_id):
        """Resumen con IA de las sugerencias que ya calcularon las reglas. Sin LLM conectado: 503."""
        items = data.get("suggestions")
        if not isinstance(items, list) or not items or len(items) > 20 or not all(isinstance(s, dict) for s in items):
            raise ApiError(400, "'suggestions' debe ser una lista de 1 a 20 sugerencias.")
        clean = [{k: str(s.get(k) or "")[:400] for k in ("title", "detail", "because")} | {"priority": s.get("priority")}
                 for s in items]
        with self.lock:
            p = self._own_patient(therapist_id, patient_id)
            plan = self._plan(patient_id)
        if not self.ai_status(therapist_id, {})[1]["available"]:
            raise ApiError(503, "La IA no está conectada: falta configurar AMD Token Factory en el servidor.")
        from agents import advisor
        text_all = " ".join(f"{s['title']} {s['detail']}" for s in clean)
        known = [self.names.get(x["exercise_id"], x["exercise_id"]) for x in plan]
        known += [n for n in self.names.values() if n in text_all]
        llm = self._llm()
        if llm is None:
            raise ApiError(503, "La IA no está conectada: falta configurar AMD Token Factory en el servidor.")
        out = advisor.summarize(llm, json.loads(p["profile"]) if p["profile"] else None, clean, known)
        if out.get("text") and advisor.mentions_unknown(out["text"], known, list(self.names.values())):
            out = {"text": None, "source": "rejected", "reason": "el resumen nombra ejercicios que no están en el plan ni en las sugerencias"}
        return 200, out

    def highlight(self, therapist_id, data, patient_id):
        muscle = self._text(data, "muscle", 40, required=False)
        exercise_id = data.get("exercise_id")
        if exercise_id is not None and exercise_id not in self.catalog:
            raise ApiError(400, "Ese ejercicio no está en el catálogo.")
        note = self._text(data, "note", 200, required=False)
        if not (muscle or exercise_id):
            raise ApiError(400, "Indica un músculo o un ejercicio para señalar.")
        with self.lock:
            self._own_patient(therapist_id, patient_id)
            therapist = self.db.execute("SELECT name FROM therapist WHERE id = ?", (therapist_id,)).fetchone()
        delivered = self.hub.publish(("patient", patient_id), {"kind": "highlight", "muscle": muscle, "exercise_id": exercise_id,
                                                               "note": note, "from": therapist["name"], "at": now_iso()})
        return 202, {"delivered_to": delivered}

    def live_stream_for_therapist(self, therapist_id, _data, patient_id):
        with self.lock:
            p = self._own_patient(therapist_id, patient_id)
        return Stream(("therapist", patient_id), {"kind": "hello", "patient": p["alias"],
                                                  "last": self.hub.last(("therapist", patient_id))})

    # -------------------------------------------------------------------------------------- paciente
    def join(self, _subject, data):
        if not settings.demo_accounts():
            raise ApiError(403, "Las cuentas de demostración están apagadas en este servidor: entra con Google.")
        return self._join(data)

    def _join(self, data, user_id: int | None = None):
        code = (self._text(data, "code", 12) or "").upper().replace(" ", "").replace("-", "")
        if data.get("consent") is not True:
            raise ApiError(400, "Para continuar hay que aceptar el consentimiento.")
        with self.lock, self.db:
            p = self.db.execute("SELECT * FROM patient WHERE invite_code = ?", (code,)).fetchone()
            if not p:
                raise ApiError(404, "Ese código no existe o ya se usó. Pídele uno nuevo a tu fisioterapeuta.")
            self.db.execute("UPDATE patient SET consent_given = 1, joined_at = ?, invite_code = NULL WHERE id = ?",
                            (now_iso(), p["id"]))
            token = self._token("patient", p["id"])
            if user_id is not None:
                self.db.execute("UPDATE app_user SET role = 'patient', patient_id = ? WHERE id = ?", (p["id"], user_id))
            therapist = self.db.execute("SELECT name FROM therapist WHERE id = ?", (p["therapist_id"],)).fetchone()
        return 201, {"token": token, "patient": {"id": p["id"], "alias": p["alias"]}, "therapist": {"name": therapist["name"]}}

    def patient_me(self, patient_id, _data):
        with self.lock:
            p = self.db.execute("SELECT * FROM patient WHERE id = ?", (patient_id,)).fetchone()
            therapist = self.db.execute("SELECT name FROM therapist WHERE id = ?", (p["therapist_id"],)).fetchone()
            plan = self._plan(patient_id)
            sessions = self._sessions(patient_id, 50)
        done = defaultdict(int)
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        for s in sessions:
            if s["end_reason"] == "completed" and parse_iso(s["ended_at"]) >= week_ago:
                done[s["exercise_id"]] += 1
        return 200, {"patient": {"id": p["id"], "alias": p["alias"], "consent_given": bool(p["consent_given"]),
                                 "profile": json.loads(p["profile"]) if p["profile"] else None},
                     "therapist": {"name": therapist["name"]},
                     "plan": [{**item, "done_7d": done[item["exercise_id"]]} for item in plan]}

    def create_session(self, patient_id, data):
        ex_id = data.get("exercise_id")
        if ex_id not in self.catalog:
            raise ApiError(400, "Ese ejercicio no está en el catálogo.")
        mode = data.get("mode")
        if mode not in ("monitored", "guided") or (mode == "monitored" and self.catalog[ex_id] != "auto"):
            raise ApiError(400, "'mode' no corresponde a ese ejercicio.")
        source = data.get("source")
        if source not in ("camera", "demo", "guided"):
            raise ApiError(400, "'source' debe ser camera, demo o guided.")
        end_reason = data.get("end_reason")
        if end_reason not in END_REASONS:
            raise ApiError(400, "'end_reason' no es válido.")
        try:
            started, ended = parse_iso(str(data.get("started_at"))), parse_iso(str(data.get("ended_at")))
        except ValueError:
            raise ApiError(400, "Fechas inválidas: usa ISO 8601.")
        if ended < started:
            raise ApiError(400, "La sesión termina antes de empezar.")
        reps_done = self._int(data, "reps_done", 0, 500)
        reps = data.get("reps") or []
        events = data.get("events") or []
        if not isinstance(reps, list) or len(reps) > 100 or not isinstance(events, list) or len(events) > 200:
            raise ApiError(400, "'reps' o 'events' tienen un formato inválido.")
        reps = [clean_rep(r) for r in reps if isinstance(r, dict)]
        clean_events = []
        for e in events:
            if not isinstance(e, dict) or e.get("type") not in EVENT_TYPES:
                raise ApiError(400, "Un evento tiene un tipo inválido.")
            clean_events.append((self._int(e, "rep", 0, 500), e["type"], e.get("side") if e.get("side") in ("left", "right") else None,
                                 e.get("value"), e.get("peak"), e.get("threshold"), self._int(e, "severity", 1, 3),
                                 e.get("alertLatencyMs") if isinstance(e.get("alertLatencyMs"), int) else None))
        with self.lock, self.db:
            p = self.db.execute("SELECT consent_given FROM patient WHERE id = ?", (patient_id,)).fetchone()
            if not p or not p["consent_given"]:
                raise ApiError(403, "Sin consentimiento no se registran sesiones.")          # I-3
            if not self.db.execute("SELECT 1 FROM plan_exercise WHERE patient_id = ? AND exercise_id = ? AND active = 1",
                                   (patient_id, ex_id)).fetchone():
                raise ApiError(409, "Ese ejercicio no está en tu plan.")                  # I-9: sin sobre no hay sesión
            cur = self.db.execute("INSERT INTO session (patient_id, exercise_id, mode, source, started_at, ended_at, end_reason, "
                                  "reps_done, baseline, reps, pain_reported) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                  (patient_id, ex_id, mode, source, started.isoformat(), ended.isoformat(), end_reason, reps_done,
                                   json.dumps(data.get("baseline")) if isinstance(data.get("baseline"), dict) else None,
                                   json.dumps(reps), 1 if end_reason == "pain_stop" else 0))
            self.db.executemany("INSERT INTO compensation_event (session_id, rep, type, side, value, peak, threshold, severity, "
                                "alert_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                [(cur.lastrowid, *e) for e in clean_events])
        self.hub.publish(("therapist", patient_id), {"kind": "session_saved", "session_id": cur.lastrowid, "exercise_id": ex_id,
                                                     "end_reason": end_reason, "at": now_iso()})
        return 201, {"session_id": cur.lastrowid}

    def publish_live(self, patient_id, data):
        frame = {"kind": "frame", "at": now_iso(), "exercise_id": data.get("exercise_id") if data.get("exercise_id") in self.catalog else None}
        for key in ("phase", "posture", "source"):
            if isinstance(data.get(key), str):
                frame[key] = data[key][:40]
        for key in ("reps_done", "reps_total", "rep"):
            if isinstance(data.get(key), int):
                frame[key] = data[key]
        angles = data.get("angles")
        if isinstance(angles, dict):
            frame["angles"] = {k: round(float(v), 1) for k, v in angles.items()
                               if k in ("knee", "trunk", "valgusL", "valgusR", "confidence") and isinstance(v, (int, float))}
        points = data.get("points")
        if isinstance(points, dict):                       # solo coordenadas normalizadas de 9 puntos (I-11)
            frame["points"] = {k: [round(float(v[0]), 4), round(float(v[1]), 4)] for k, v in points.items()
                               if k in LIVE_POINTS and isinstance(v, list) and len(v) == 2
                               and all(isinstance(x, (int, float)) for x in v)}
        if isinstance(data.get("mirror"), bool):
            frame["mirror"] = data["mirror"]
        if data.get("view") in ("front", "diagonal", "side"):  # desde dónde mira la cámara (ADR-015)
            frame["view"] = data["view"]
        progress = data.get("progress")                    # avance del movimiento 0-1 en el seguimiento (ADR-014)
        if isinstance(progress, (int, float)) and not isinstance(progress, bool):
            frame["progress"] = round(min(1.0, max(0.0, float(progress))), 3)
        metric = data.get("metric")
        if (isinstance(metric, dict) and isinstance(metric.get("label"), str) and metric.get("unit") in METRIC_UNITS
                and isinstance(metric.get("value"), (int, float)) and not isinstance(metric.get("value"), bool)):
            frame["metric"] = {"label": metric["label"][:60], "value": round(float(metric["value"]), 1), "unit": metric["unit"]}
        event = data.get("event")
        if isinstance(event, dict) and event.get("type") in EVENT_TYPES:
            frame["event"] = {k: event.get(k) for k in ("type", "side", "rep", "value", "threshold", "severity")}
        if data.get("ended") in END_REASONS:
            frame["ended"] = data["ended"]
        delivered = self.hub.publish(("therapist", patient_id), frame)
        return 202, {"delivered_to": delivered}

    def live_stream_for_patient(self, patient_id, _data):
        return Stream(("patient", patient_id), {"kind": "hello"})
