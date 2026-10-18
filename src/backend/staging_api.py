"""API de Staging de AXONFAS: cuentas de demostración de fisioterapeuta y paciente, planes, sesiones y vista en vivo.

ADR-012 y ADR-013. La sirve serve.py en el mismo origen que el prototipo (rutas /api/...). Solo biblioteca estándar.

- Datos en SQLite fuera del repo y de Drive (por defecto ~/.axonfas/staging.sqlite3). Solo datos sintéticos o del
  equipo con consentimiento (ADR-010).
- Cuentas de demostración, sin contraseñas: cada dispositivo recibe un token bearer aleatorio. NO es autenticación de
  Producción (TD-41).
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

import fhir  # noqa: E402
import organizations  # noqa: E402 — Nivel 3: organizaciones y licencias (ADR-026) — export FHIR R4; vive junto a este módulo (serve.py y los tests ponen src/backend en sys.path)
from agents import coach, safety  # noqa: E402
from agents.safety import PARAMS  # noqa: E402 — límites fijos del rango, para no duplicar números

SCHEMA = """
CREATE TABLE IF NOT EXISTS therapist (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patient (
  id INTEGER PRIMARY KEY, therapist_id INTEGER NOT NULL REFERENCES therapist(id),
  alias TEXT NOT NULL, birth_year INTEGER, consent_given INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT UNIQUE, joined_at TEXT, created_at TEXT NOT NULL, profile TEXT);
CREATE TABLE IF NOT EXISTS token (
  token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('therapist', 'patient', 'admin', 'user', 'org', 'guest')),
  subject_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT,
  role TEXT NOT NULL DEFAULT 'pending' CHECK (role IN ('admin', 'therapist', 'patient', 'pending')),
  therapist_id INTEGER REFERENCES therapist(id), patient_id INTEGER REFERENCES patient(id),
  disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS plan_exercise (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id), exercise_id TEXT NOT NULL,
  sets INTEGER NOT NULL, reps INTEGER NOT NULL, hold_seconds INTEGER NOT NULL, per_week INTEGER NOT NULL,
  safety_envelope TEXT NOT NULL, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  rest_min_seconds INTEGER, rest_max_seconds INTEGER,
  range_goal TEXT);                    -- JSON {target, limit, unit} del seguimiento con cámara (ADR-025)
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id), exercise_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('monitored', 'guided')),
  source TEXT NOT NULL CHECK (source IN ('camera', 'demo', 'guided')),
  started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('completed', 'pain_stop', 'envelope_breach', 'user_quit')),
  reps_done INTEGER NOT NULL, baseline TEXT, reps TEXT, pain_reported INTEGER NOT NULL DEFAULT 0,
  pain_score INTEGER CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10), pain_scored_at TEXT,
  no_camera INTEGER NOT NULL DEFAULT 0,  -- 1 = sin cámara: sin métricas cinemáticas ni detección postural (TD-111)
  no_camera_reason TEXT CHECK (no_camera_reason IS NULL OR no_camera_reason IN ('declined', 'denied', 'unavailable', 'guided_view')));
CREATE TABLE IF NOT EXISTS compensation_event (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES session(id), rep INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('trunk_flexion', 'knee_valgus')), side TEXT, value REAL, peak REAL,
  threshold REAL, severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 3), alert_latency_ms INTEGER);
CREATE TABLE IF NOT EXISTS clinical_report (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL UNIQUE REFERENCES session(id),
  soap_draft TEXT NOT NULL,            -- JSON {S, O, A, P}
  facts TEXT NOT NULL,                 -- JSON: los datos que la nota puede citar (soap.facts)
  source TEXT NOT NULL CHECK (source IN ('template', 'llm')),
  created_at TEXT NOT NULL,
  reviewed_by INTEGER REFERENCES therapist(id), reviewed_at TEXT,
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)));
CREATE TABLE IF NOT EXISTS symptom_report (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id),
  session_id INTEGER REFERENCES session(id), exercise_id TEXT, reported_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('red_flag', 'discomfort')),
  category TEXT NOT NULL CHECK (category IN ('red_flag', 'pain', 'cramp', 'fatigue', 'stiffness', 'other')),
  text TEXT CHECK (text IS NULL OR length(text) <= 200),
  action TEXT NOT NULL CHECK (action IN ('session_stopped', 'demand_lowered', 'paused', 'logged')),
  adjustment TEXT,                     -- JSON {param, old, new} solo con demand_lowered
  source TEXT NOT NULL CHECK (source IN ('patient_form', 'voice_turn')));
CREATE INDEX IF NOT EXISTS idx_symptom_patient ON symptom_report(patient_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_patient_therapist ON patient(therapist_id);
CREATE INDEX IF NOT EXISTS idx_session_patient ON session(patient_id, ended_at);
CREATE TABLE IF NOT EXISTS guest (                  -- invitado sin registro (TD-106, ADR-028)
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_run (               -- demo pública: solo números, solo los ve el Administrador (TD-108)
  id INTEGER PRIMARY KEY, guest_id INTEGER REFERENCES guest(id),
  source TEXT NOT NULL CHECK (source IN ('demo', 'camera')), exercise_id TEXT NOT NULL,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('completed', 'pain_stop', 'envelope_breach', 'user_quit')),
  reps_done INTEGER NOT NULL, calibration_reps INTEGER NOT NULL, duration_s INTEGER,
  trunk_events INTEGER NOT NULL DEFAULT 0, valgus_events INTEGER NOT NULL DEFAULT 0,
  low_confidence_reps INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_demo_run_created ON demo_run(created_at);
CREATE TABLE IF NOT EXISTS organization (           -- Nivel 3, empresa (ADR-026)
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL CHECK (plan IN ('clinic', 'network')),
  admin_email TEXT NOT NULL UNIQUE, ehr_fhir_base_url TEXT, ehr_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS org_license (
  id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organization(id), email TEXT NOT NULL,
  therapist_id INTEGER REFERENCES therapist(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')), created_at TEXT NOT NULL, revoked_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_active_email ON org_license(email) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_license_org ON org_license(organization_id);
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
# Opciones rápidas del formulario de molestia (symptom-form.js) y su categoría. Dato de salud: solo Staging (ADR-010).
SYMPTOM_OPTIONS = {"pain_mild": "pain", "fatigue": "fatigue", "cramp": "cramp", "stiffness": "stiffness", "red_flag": "red_flag"}
# Descanso entre series (ADR-022): una RECOMENDACIÓN del fisioterapeuta, no un límite ni parte del sobre. Sin dato, 60 s
# como valor de partida, no clínico (TD-87). Los límites son los fijos de `rest_seconds` del agente.
REST_DEFAULT_SECONDS = 60
REST_LIMITS = (PARAMS["rest_seconds"]["min"], PARAMS["rest_seconds"]["max"])
MAX_BODY = 256 * 1024
# Meta de recorrido por ejercicio de la galería (ADR-025): límites fijos por unidad de la medida de tracker.js. Son de
# forma, no clínicos: el valor lo elige el fisioterapeuta.
RANGE_GOAL_BOUNDS = {"°": (1.0, 180.0), "cm": (0.5, 50.0), "%": (1.0, 200.0)}
# EVA al terminar (ADR-025): desde 7/10 el panel lo marca como dolor alto. Valor de partida, no clínico (TD-104).
PAIN_HIGH = 7
# Sesión sin cámara (TD-110/111): por qué no hubo cámara. guided_view = la vista guiada de siempre (paciente.html).
NO_CAMERA_REASONS = {"declined", "denied", "unavailable", "guided_view"}
# Demo pública (TD-108): tope de resultados anónimos por hora, contra el abuso. Valor de partida.
DEMO_RUNS_PER_HOUR = 500
DEFAULT_TRACKER = Path(__file__).resolve().parents[1] / "frontend" / "validation-prototype" / "tracker.js"


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code    # code = 'auth_required' abre el muro (TD-107)


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


def load_tracking(path: Path) -> dict[str, dict]:
    """{id: {metric, mode, dir, unit}} leído de SPECS y METRICS de tracker.js, la fuente única del seguimiento (ADR-014).
    Con esto se valida la meta de recorrido del plan (ADR-025) sin duplicar qué mide cada ejercicio."""
    text = path.read_text(encoding="utf-8")
    units = dict(re.findall(r"(\w+): \{ label: '[^']+', unit: '([^']+)'", text))
    found = re.findall(r"'([a-z0-9-]+)': \{ metric: '(\w+)',(?: combine: '\w+',)? mode: '(reps|hold|manual)'(?:, dir: (-?\d+))?", text)
    if not found:
        raise ValueError(f"no se encontraron SPECS en {path}")
    return {ex: {"metric": metric, "mode": mode, "dir": int(d or 0), "unit": units.get(metric)} for ex, metric, mode, d in found}


def clean_range_goal(raw, track: dict | None, monitoring: str) -> dict:
    """Meta de recorrido del plan (ADR-025), en la unidad de la medida del ejercicio. En repeticiones, `target` es el
    recorrido pedido desde la posición inicial y `limit` el máximo; en sostenes, el valor a sostener y hasta dónde llegar.
    El límite siempre queda más allá de la meta en el sentido del esfuerzo."""
    if monitoring == "auto":
        raise ApiError(400, "Sentarse y pararse usa el sobre de seguridad (rom_min y rom_max), no una meta de recorrido.")
    if not track or track["mode"] == "manual" or track["unit"] not in RANGE_GOAL_BOUNDS:
        raise ApiError(400, "La cámara no mide el recorrido de ese ejercicio: no lleva meta de recorrido.")
    if not isinstance(raw, dict):
        raise ApiError(400, "'range_goal' debe ser un objeto {target, limit}.")
    lo, hi = RANGE_GOAL_BOUNDS[track["unit"]]
    values = []
    for key in ("target", "limit"):
        v = raw.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ApiError(400, f"'range_goal.{key}' debe ser un número entre {lo:g} y {hi:g} {track['unit']}.")
        values.append(round(float(v), 1))
    target, limit = values
    beyond = limit < target if track["mode"] == "hold" and track["dir"] < 0 else limit > target
    if not beyond:
        raise ApiError(400, "El límite tiene que ir más allá de la meta, en el sentido del ejercicio.")
    return {"target": target, "limit": limit, "unit": track["unit"]}


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
def compute_metrics(plan: list[dict], sessions: list[dict], events: list[dict], now: datetime | None = None,
                    symptoms: list[dict] | None = None) -> dict:
    """Indicadores descriptivos (no son resultados clínicos):
    - adherence: por ejercicio del plan, sesiones completadas en 7 días / sesiones por semana indicadas (tope 1).
    - quality: en sesiones monitoreadas, fracción de repeticiones de ejercicio sin compensación.
    - quality_trend: promedio de las 3 últimas sesiones monitoreadas menos el de las 3 primeras (con 4 o más).
    - rom: flexión media de rodilla en las repeticiones de ejercicio, primera y última sesión monitoreada.
    - camera_*: por ejercicio del plan, en las sesiones con conteo de cámara, el recorrido medio por repetición (en la
      unidad de su medida) y el sostén medio, de la primera y la última sesión (TD-49).
    - pain_stops_30d: sesiones detenidas por dolor en 30 días (bandera roja para el fisioterapeuta).
    - discomfort_30d y red_flags_30d: molestias que reportó el paciente en 30 días (todas, y las que fueron alarma).
    - pain_*: dolor que marcó el paciente al terminar cada sesión (EVA 0-10, ADR-025): el último, la serie y cuántas
      sesiones de 30 días llegaron a PAIN_HIGH.
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
                "hold": round(sum(holds) / len(holds), 1) if holds else None,
                "over_limit": sum(1 for r in reps if r.get("overLimit") is True)})
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
    recent_symptoms = [x for x in symptoms or [] if parse_iso(x["reported_at"]) >= month_ago]
    scored = [{"session_id": s["id"], "exercise_id": s["exercise_id"], "ended_at": s["ended_at"], "score": s["pain_score"]}
              for s in sorted(sessions, key=lambda s: s["ended_at"]) if s.get("pain_score") is not None]
    mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    trend = (round(mean([q["clean"] for q in quality[-3:]]) - mean([q["clean"] for q in quality[:3]]), 3)
             if len(quality) >= 4 else None)
    return {
        "adherence": mean(ratios), "per_exercise": per_exercise,
        "quality": quality[-1]["clean"] if quality else None, "quality_series": quality[-20:], "quality_trend": trend,
        "rom_first": rom[0]["knee"] if rom else None, "rom_last": rom[-1]["knee"] if rom else None, "rom_series": rom[-20:],
        "pain_stops_30d": sum(1 for s in sessions if s["end_reason"] == "pain_stop" and parse_iso(s["ended_at"]) >= month_ago),
        "discomfort_30d": sum(1 for x in recent_symptoms),
        "red_flags_30d": sum(1 for x in recent_symptoms if x["kind"] == "red_flag"),
        "pain_last": scored[-1] if scored else None, "pain_series": scored[-20:],
        "pain_high_30d": sum(1 for x in scored if x["score"] >= PAIN_HIGH and parse_iso(x["ended_at"]) >= month_ago),
        "sessions_total": len(sessions), "last_session_at": max((s["ended_at"] for s in sessions), default=None),
    }


# Campos por repetición que se guardan: los del motor de reglas (sentarse y pararse) y los del conteo con cámara de
# la galería (TD-49: recorrido máximo, sostén, duración y lado; ADR-025: si pasó el límite del plan). Todo lo demás se
# descarta.
REP_NUMBERS = ("kneeRom", "peakTrunk", "peakValgusL", "peakValgusR", "lowConfidenceRatio", "peak", "holdSec", "seconds")
REP_FLAGS = ("calibration", "romReached", "holdOk", "overLimit")
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
    def __init__(self, db_path: str | Path, catalog: dict[str, str], names: dict[str, str] | None = None,
                 tracking: dict[str, dict] | None = None):
        if str(db_path) != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(SCHEMA)
        if "profile" not in {r["name"] for r in self.db.execute("PRAGMA table_info(patient)")}:
            self.db.execute("ALTER TABLE patient ADD COLUMN profile TEXT")    # bases creadas antes de ADR-017
        token_sql = self.db.execute("SELECT sql FROM sqlite_master WHERE name = 'token'").fetchone()["sql"]
        if "'guest'" not in token_sql:                     # bases creadas antes de ADR-019 (admin) o de ADR-026/027
            with self.db:
                self.db.executescript("""
                  CREATE TABLE token_new (token TEXT PRIMARY KEY,
                    role TEXT NOT NULL CHECK (role IN ('therapist', 'patient', 'admin', 'user', 'org', 'guest')),
                    subject_id INTEGER NOT NULL, created_at TEXT NOT NULL);
                  INSERT INTO token_new SELECT token, role, subject_id, created_at FROM token;
                  DROP TABLE token;
                  ALTER TABLE token_new RENAME TO token;""")
        self.jwks = google_auth.Jwks()
        plan_columns = {r["name"] for r in self.db.execute("PRAGMA table_info(plan_exercise)")}
        for column in ("rest_min_seconds", "rest_max_seconds"):
            if column not in plan_columns:
                self.db.execute(f"ALTER TABLE plan_exercise ADD COLUMN {column} INTEGER")      # bases anteriores a ADR-022
        if "range_goal" not in plan_columns:
            self.db.execute("ALTER TABLE plan_exercise ADD COLUMN range_goal TEXT")              # bases anteriores a ADR-025
        if "pain_score" not in {r["name"] for r in self.db.execute("PRAGMA table_info(session)")}:
            self.db.execute("ALTER TABLE session ADD COLUMN pain_score INTEGER "
                            "CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10)")
            self.db.execute("ALTER TABLE session ADD COLUMN pain_scored_at TEXT")
        if "no_camera" not in {r["name"] for r in self.db.execute("PRAGMA table_info(session)")}:     # bases anteriores a TD-111
            with self.db:
                self.db.execute("ALTER TABLE session ADD COLUMN no_camera INTEGER NOT NULL DEFAULT 0")
                self.db.execute("ALTER TABLE session ADD COLUMN no_camera_reason TEXT CHECK (no_camera_reason IS NULL OR "
                                "no_camera_reason IN ('declined', 'denied', 'unavailable', 'guided_view'))")
                self.db.execute("UPDATE session SET no_camera = 1, no_camera_reason = 'guided_view' WHERE source = 'guided'")
        self.lock = threading.RLock()
        self.catalog = catalog
        self.names = names or {}
        self.tracking = tracking if tracking is not None else (load_tracking(DEFAULT_TRACKER) if DEFAULT_TRACKER.exists() else {})
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
            ("POST", r"/api/sessions/(\d+)/report", self.create_report, "therapist"),
            ("GET", r"/api/sessions/(\d+)/report", self.get_report, "therapist"),
            ("POST", r"/api/sessions/(\d+)/report/approve", self.approve_report, "therapist"),
            ("GET", r"/api/sessions/(\d+)/fhir", self.session_fhir, "therapist"),
            ("GET", r"/api/sessions/(\d+)/fhir/document", self.session_fhir_document, "therapist"),
            ("GET", r"/api/ai/status", self.ai_status, "therapist"),
            ("POST", r"/api/join", self.join, None),
            ("POST", r"/api/auth/guest", self.auth_guest, None),
            ("POST", r"/api/demo/runs", self.demo_run, None),
            ("GET", r"/api/admin/demo-runs", self.admin_demo_runs, "admin"),
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
            ("GET", r"/api/admin/orgs", self.admin_orgs, "admin"),
            ("POST", r"/api/admin/orgs", self.admin_create_org, "admin"),
            ("GET", r"/api/org/summary", self.org_summary, "org"),
            ("POST", r"/api/org/licenses", self.org_invite, "org"),
            ("POST", r"/api/org/licenses/(\d+)/revoke", self.org_revoke, "org"),
            ("PUT", r"/api/org/ehr", self.org_ehr, "org"),
            ("GET", r"/api/me", self.patient_me, "patient"),
            ("POST", r"/api/sessions", self.create_session, "patient"),
            ("PUT", r"/api/sessions/(\d+)/pain", self.score_pain, "patient"),
            ("POST", r"/api/live", self.publish_live, "patient"),
            ("GET", r"/api/me/stream", self.live_stream_for_patient, "patient"),
            ("PUT", r"/api/me/profile", self.set_my_profile, "patient"),
            ("POST", r"/api/me/discomfort", self.report_discomfort, "patient"),
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
                        subject = self._auth(headers, role, method) if role else None
                    return fn(subject, data, *[int(g) for g in match.groups()])
            if any(re.fullmatch(p, path) for _, p, _, _ in self.routes):
                raise ApiError(405, "Método no permitido.")
            raise ApiError(404, "No existe esa ruta.")
        except ApiError as err:
            return err.status, {"error": err.message, **({"code": err.code} if err.code else {})}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return 400, {"error": "JSON inválido."}
        except sqlite3.Error:
            return 500, {"error": "Error interno de la base de Staging."}

    def _auth(self, headers, role: str, method: str = "GET") -> int:
        value = (headers.get("Authorization") or "").strip()
        if not value.startswith("Bearer "):
            raise ApiError(401, "Falta el token. Vuelve a entrar.")
        with self.lock:
            row = self.db.execute("SELECT role, subject_id FROM token WHERE token = ?", (value[7:].strip(),)).fetchone()
        if not row:
            raise ApiError(401, "El token no es válido. Vuelve a entrar.")
        if row["role"] == "guest" and role != "guest":
            # Invitado (TD-106): mira la interfaz clínica de muestra, solo lectura. Lo permanente pide cuenta (TD-107).
            if role == "therapist" and method == "GET":
                return self._guest_sandbox()
            raise ApiError(401, "Para esto necesitas una cuenta: crea la tuya o entra con Google.", code="auth_required")
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
    def _num_or_none(data: dict, key: str) -> float | None:
        """Número finito de un evento, o None si falta. Cualquier otra cosa (texto, bool, dict) es un 400, no un 500."""
        value = data.get(key)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ApiError(400, f"'{key}' de un evento debe ser un número.")
        return float(value)

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
                 "safety_envelope": json.loads(r["safety_envelope"]), "notes": r["notes"], "since": r["created_at"],
                 "range_goal": json.loads(r["range_goal"]) if r["range_goal"] else None,
                 "rest": ({"min": r["rest_min_seconds"], "max": r["rest_max_seconds"], "default": False}
                          if r["rest_min_seconds"] is not None and r["rest_max_seconds"] is not None
                          else {"min": REST_DEFAULT_SECONDS, "max": REST_DEFAULT_SECONDS, "default": True})} for r in rows]

    @staticmethod
    def _patient_public(row: sqlite3.Row) -> dict:
        return {"id": row["id"], "alias": row["alias"], "birth_year": row["birth_year"],
                "consent_given": bool(row["consent_given"]), "joined_at": row["joined_at"],
                "invite_code": None if row["joined_at"] else row["invite_code"],
                "profile": json.loads(row["profile"]) if row["profile"] else None}

    def _sessions(self, patient_id: int, limit: int = 200) -> list[dict]:
        rows = self.db.execute("SELECT * FROM session WHERE patient_id = ? ORDER BY ended_at DESC LIMIT ?", (patient_id, limit))
        return [dict(r) for r in rows]

    def _symptoms(self, patient_id: int, limit: int = 200) -> list[dict]:
        rows = self.db.execute("SELECT id, session_id, exercise_id, reported_at, kind, category, text, action, adjustment "
                               "FROM symptom_report WHERE patient_id = ? ORDER BY id DESC LIMIT ?", (patient_id, limit))
        return [{**dict(r), "adjustment": json.loads(r["adjustment"]) if r["adjustment"] else None} for r in rows]

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
                metrics = compute_metrics(self._plan(p["id"]), sessions, self._events([s["id"] for s in sessions]),
                                          symptoms=self._symptoms(p["id"]))
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
            symptoms = self._symptoms(patient_id)
        with self.lock:
            marks = ",".join("?" * len(sessions[:30]))
            reports = {r["session_id"]: r["reviewed_by"] for r in self.db.execute(
                f"SELECT session_id, reviewed_by FROM clinical_report WHERE session_id IN ({marks})", [x["id"] for x in sessions[:30]])}
        for s in sessions:
            s["report_status"] = None if s["id"] not in reports else ("final" if reports[s["id"]] is not None else "draft")
            s["reps"] = json.loads(s["reps"] or "[]")
            s["baseline"] = json.loads(s["baseline"]) if s["baseline"] else None
        metrics = compute_metrics(plan, [{**s, "reps": json.dumps(s["reps"])} for s in sessions], events, symptoms=symptoms)
        return 200, {"patient": self._patient_public(p), "plan": plan, "sessions": sessions[:30], "events": events[:60],
                     "symptoms": symptoms[:30], "metrics": metrics, "live": self.hub.last(("therapist", patient_id))}

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
                if "rom_min" in env or "rom_max" in env:      # rango de rodilla para los ajustes del agente (ADR-021)
                    if env.get("rom_min") is None or env.get("rom_max") is None:
                        raise ApiError(400, "Indica rom_min y rom_max juntos.")
                    lo, hi = PARAMS["rom_target"]["min"], PARAMS["rom_target"]["max"]
                    rom_min, rom_max = self._int(env, "rom_min", lo, hi), self._int(env, "rom_max", lo, hi)
                    if rom_min >= rom_max:
                        raise ApiError(400, "rom_min debe ser menor que rom_max.")
                    envelope.update(rom_min=rom_min, rom_max=rom_max)
            rest_min, rest_max = item.get("rest_min_seconds"), item.get("rest_max_seconds")
            if rest_min is not None or rest_max is not None:      # recomendación de descanso; vale para todo ejercicio
                lo, hi = REST_LIMITS
                rest_min = self._int(item, "rest_min_seconds", lo, hi) if rest_min is not None else None
                rest_max = self._int(item, "rest_max_seconds", lo, hi) if rest_max is not None else None
                rest_min, rest_max = (rest_min if rest_min is not None else rest_max), (rest_max if rest_max is not None else rest_min)
                if rest_min > rest_max:
                    raise ApiError(400, "El descanso mínimo no puede ser mayor que el máximo.")
            goal = None                                           # meta de recorrido con cámara, opcional (ADR-025)
            if item.get("range_goal") is not None:
                goal = clean_range_goal(item["range_goal"], self.tracking.get(ex_id), self.catalog[ex_id])
            clean.append((ex_id, self._int(item, "sets", 1, 10), self._int(item, "reps", 1, 50),
                          self._int(item, "hold_seconds", 0, 120, 0), self._int(item, "per_week", 1, 7),
                          json.dumps(envelope), self._text(item, "notes", 300, required=False), rest_min, rest_max,
                          json.dumps(goal) if goal else None))
        with self.lock, self.db:
            self._own_patient(therapist_id, patient_id)
            self.db.execute("UPDATE plan_exercise SET active = 0 WHERE patient_id = ?", (patient_id,))
            for row in clean:
                self.db.execute("INSERT INTO plan_exercise (patient_id, exercise_id, sets, reps, hold_seconds, per_week, "
                                "safety_envelope, notes, rest_min_seconds, rest_max_seconds, range_goal, created_at) "
                                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                (patient_id, *row, now_iso()))
            plan = self._plan(patient_id)
        self.hub.publish(("patient", patient_id), {"kind": "plan_updated", "at": now_iso()})
        return 200, {"plan": plan}

    def new_invite(self, therapist_id, _data, patient_id):
        with self.lock, self.db:
            self._own_patient(therapist_id, patient_id)
            code = self._new_code()
            self.db.execute("UPDATE patient SET invite_code = ?, joined_at = NULL, consent_given = 0 WHERE id = ?",
                            (code, patient_id))
            # Un código nuevo corta los dispositivos anteriores (TD-41). TD-85: el consentimiento se vuelve a pedir al afiliarse.
            revoked = self.db.execute("DELETE FROM token WHERE role = 'patient' AND subject_id = ?", (patient_id,)).rowcount
        return 200, {"invite_code": code, "revoked_devices": revoked}

    # ------------------------------------------------------------------ nota SOAP de la sesión (TD-09, ADR-008)
    def _own_session(self, therapist_id: int, session_id: int) -> sqlite3.Row:
        row = self.db.execute("SELECT s.* FROM session s JOIN patient p ON p.id = s.patient_id "
                              "WHERE s.id = ? AND p.therapist_id = ?", (session_id, therapist_id)).fetchone()
        if not row:
            raise ApiError(404, "No existe esa sesión en tu lista.")                # I-10: ni siquiera confirma que existe
        return row

    def _plan_item_at(self, patient_id: int, exercise_id: str, ended_at: str) -> dict | None:
        """El ejercicio del plan vigente cuando terminó la sesión (los planes viejos quedan con active = 0 y sirven igual)."""
        rows = self.db.execute("SELECT * FROM plan_exercise WHERE patient_id = ? AND exercise_id = ? ORDER BY id DESC",
                               (patient_id, exercise_id)).fetchall()
        end = parse_iso(ended_at)
        for r in rows:
            if parse_iso(r["created_at"]) <= end:
                return dict(r)
        # La hora la pone el dispositivo del paciente: con el reloj atrasado, la sesión "termina" antes del plan. Como no se
        # registra sesión sin plan (I-9), se toma el plan más antiguo de ese ejercicio en vez de dejar la meta vacía.
        return dict(rows[-1]) if rows else None

    def _report_input(self, row: sqlite3.Row) -> dict:
        """Entrada de `soap.facts` armada solo con datos guardados de la sesión (I-6). Staging todavía no guarda
        `agent_decision` ni `voice_turn` (TD-61): la nota los recibe vacíos."""
        item = self._plan_item_at(row["patient_id"], row["exercise_id"], row["ended_at"])
        target = None
        if item:
            if row["mode"] == "monitored":
                target = json.loads(item["safety_envelope"]).get("max_reps")
            else:
                target = item["sets"] * item["reps"]
        reps = [r for r in json.loads(row["reps"] or "[]") if not r.get("calibration")]
        knees = [r["kneeRom"] for r in reps if isinstance(r.get("kneeRom"), (int, float))]
        events = self.db.execute("SELECT type FROM compensation_event WHERE session_id = ? ORDER BY id", (row["id"],)).fetchall()
        # Molestias unidas a la sesión, y las del paciente sin sesión del mismo día (UTC): quedan "fuera de la sesión".
        day = parse_iso(row["ended_at"]).astimezone(timezone.utc).date().isoformat()
        symptoms = [{"category": x["category"], "text": x["text"], "action": x["action"], "in_session": x["session_id"] is not None}
                    for x in reversed(self._symptoms(row["patient_id"]))
                    if x["session_id"] == row["id"] or (x["session_id"] is None and x["reported_at"][:10] == day)]
        return {"id": row["id"], "patient_id": row["patient_id"], "monitored": row["mode"] == "monitored",
                "exercise_id": row["exercise_id"], "exercise_name": self.names.get(row["exercise_id"], row["exercise_id"]),
                "started_at": row["started_at"], "ended_at": row["ended_at"], "reps_done": row["reps_done"],
                "reps_target": target, "end_reason": row["end_reason"], "events": [{"type": e["type"]} for e in events],
                "rom_mean": round(sum(knees) / len(knees), 1) if knees else None,
                "pain_reported": bool(row["pain_reported"]), "pain_score": row["pain_score"], "decisions": [], "utterances": [],
                "no_camera": bool(row["no_camera"]),
                "symptom_reports": symptoms}

    def _report_public(self, session_id: int) -> dict:
        r = self.db.execute("SELECT c.*, t.name AS reviewer FROM clinical_report c LEFT JOIN therapist t ON t.id = c.reviewed_by "
                            "WHERE c.session_id = ?", (session_id,)).fetchone()
        return {"report": {"session_id": session_id, "status": "draft" if r["reviewed_by"] is None else "final",
                           "source": r["source"], "soap": json.loads(r["soap_draft"]), "facts": json.loads(r["facts"]),
                           "created_at": r["created_at"], "reviewed_by": r["reviewed_by"], "reviewed_by_name": r["reviewer"],
                           "reviewed_at": r["reviewed_at"]}}

    def create_report(self, therapist_id, _data, session_id):
        """Borrador SOAP: plantilla determinista, y el LLM solo si hay GPU conectada (y sin inventar cifras, I-6)."""
        with self.lock:
            row = self._own_session(therapist_id, session_id)
            if self.db.execute("SELECT 1 FROM clinical_report WHERE session_id = ?", (session_id,)).fetchone():
                return 200, self._report_public(session_id)
            entry = self._report_input(row)
        from agents import soap
        llm = self._llm() if self.ai_status(therapist_id, {})[1]["available"] else None
        draft = soap.draft(llm, entry)
        with self.lock, self.db:
            created = self.db.execute("INSERT OR IGNORE INTO clinical_report (session_id, soap_draft, facts, source, created_at) "
                                      "VALUES (?, ?, ?, ?, ?)", (session_id, json.dumps(draft["soap"], ensure_ascii=False),
                                                                 json.dumps(draft["facts"], ensure_ascii=False), draft["source"],
                                                                 now_iso())).rowcount
            out = self._report_public(session_id)
        return (201 if created else 200), out

    def session_fhir(self, therapist_id, _data, session_id):
        """Observation FHIR R4 de la sesión: `preliminary` mientras la nota es borrador y `final` cuando está firmada.
        Se genera al pedirla y no se guarda ni escribe nada."""
        from agents import soap
        with self.lock:
            row = self._own_session(therapist_id, session_id)
            entry = self._report_input(row)
            has_report = self.db.execute("SELECT 1 FROM clinical_report WHERE session_id = ?", (session_id,)).fetchone()
            report = self._report_public(session_id)["report"] if has_report else None
            patient = self.db.execute("SELECT id, alias FROM patient WHERE id = ?", (row["patient_id"],)).fetchone()
        return 200, fhir.observation(entry, soap.facts(entry), report, {"id": patient["id"], "alias": patient["alias"]})

    def session_fhir_document(self, therapist_id, _data, session_id):
        """Nota SOAP como Bundle FHIR R4 de tipo `document` (TD-103): `preliminary` hasta la firma. Con licencia de una
        organización (Nivel 3), su `Organization` va como custodio. Se genera al pedirla; no se envía a ninguna parte."""
        from agents import soap
        with self.lock:
            row = self._own_session(therapist_id, session_id)
            if not self.db.execute("SELECT 1 FROM clinical_report WHERE session_id = ?", (session_id,)).fetchone():
                raise ApiError(404, "Todavía no hay nota SOAP para esta sesión.")
            entry = self._report_input(row)
            report = self._report_public(session_id)["report"]
            patient = self.db.execute("SELECT id, alias FROM patient WHERE id = ?", (row["patient_id"],)).fetchone()
            org = self._org_of_therapist(therapist_id)
        return 200, fhir.document(entry, soap.facts(entry), report, {"id": patient["id"], "alias": patient["alias"]},
                                  {"id": org["id"], "name": org["name"]} if org else None)

    def get_report(self, therapist_id, _data, session_id):
        with self.lock:
            self._own_session(therapist_id, session_id)
            if not self.db.execute("SELECT 1 FROM clinical_report WHERE session_id = ?", (session_id,)).fetchone():
                raise ApiError(404, "Todavía no hay borrador para esta sesión.")
            return 200, self._report_public(session_id)

    def approve_report(self, therapist_id, data, session_id):
        """Firma la nota. Solo A y P se pueden completar: S y O son datos de la BD (I-6). Una vez firmada, no se toca (I-8)."""
        edits = {k: self._text(data, k, 1000, required=False) for k in ("A", "P")}
        with self.lock, self.db:
            self._own_session(therapist_id, session_id)
            r = self.db.execute("SELECT * FROM clinical_report WHERE session_id = ?", (session_id,)).fetchone()
            if not r:
                raise ApiError(404, "Todavía no hay borrador para esta sesión.")
            if r["reviewed_by"] is not None:
                raise ApiError(409, "La nota ya está firmada.")
            soap_note = json.loads(r["soap_draft"])
            soap_note.update({k: v for k, v in edits.items() if v})
            self.db.execute("UPDATE clinical_report SET soap_draft = ?, reviewed_by = ?, reviewed_at = ? WHERE session_id = ?",
                            (json.dumps(soap_note, ensure_ascii=False), therapist_id, now_iso(), session_id))
            return 200, self._report_public(session_id)

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
        org = self.db.execute("SELECT id FROM organization WHERE admin_email = ?", (user["email"],)).fetchone()
        if org:                                          # administración de una organización (Nivel 3, ADR-026)
            return {"role": "org", "token": self._token("org", org["id"])}
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
            self._link_license(user["email"], user["therapist_id"])
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
                self._link_license(user["email"], cur.lastrowid)
                token = self._token("therapist", cur.lastrowid)
            return 201, {"role": "therapist", "token": token, "therapist": {"id": cur.lastrowid, "name": name}}
        if role == "patient":
            status, body = self._join(data, user_id=user_id)
            return status, {"role": "patient", **body}
        raise ApiError(400, "Elige 'therapist' o 'patient'.")

    def auth_me(self, who, _data):
        out = {"role": who["role"]}
        if who["role"] == "guest":
            return 200, {**out, "user": None}
        with self.lock:
            if who["role"] in ("admin", "user"):
                row = self.db.execute("SELECT * FROM app_user WHERE id = ?", (who["subject_id"],)).fetchone()
            elif who["role"] == "org":
                org = self._org(who["subject_id"])
                out["organization"] = {"id": org["id"], "name": org["name"]}
                row = self.db.execute("SELECT * FROM app_user WHERE email = ? ORDER BY last_login_at DESC",
                                      (org["admin_email"],)).fetchone()
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
                "organizations": q("SELECT COUNT(*) FROM organization"),
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
                    self._link_license(user["email"], cur.lastrowid)
                self.db.execute("UPDATE app_user SET role = ? WHERE id = ?", (role, user_id))
                self._revoke(user)                       # la próxima vez entra con el rol nuevo
            user = self.db.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return 200, {"user": self._user_public(user)}

    # ------------------------------------------------------------------ invitado y demo pública (ADR-028)
    def auth_guest(self, _subject, _data):
        """Entrar como invitado (TD-106): sin registro ni datos personales. Ve la galería y una interfaz clínica de muestra
        con datos sintéticos, solo lectura; lo permanente o clínico pide crear una cuenta (TD-107)."""
        with self.lock, self.db:
            cur = self.db.execute("INSERT INTO guest (created_at) VALUES (?)", (now_iso(),))
            token = self._token("guest", cur.lastrowid)
        return 201, {"role": "guest", "token": token}

    def _guest_sandbox(self) -> int:
        """Consultorio de muestra compartido por todos los invitados (solo lectura): un fisioterapeuta, un paciente con
        seudónimo, su plan y tres sesiones sintéticas (ADR-010). Se crea una vez y se reutiliza."""
        with self.lock:
            row = self.db.execute("SELECT value FROM app_meta WHERE key = 'guest_sandbox'").fetchone()
            if row and self.db.execute("SELECT 1 FROM therapist WHERE id = ?", (int(row["value"]),)).fetchone():
                return int(row["value"])
            from agents import soap
            now = datetime.now(timezone.utc)
            at = lambda days, minutes=0: (now - timedelta(days=days, minutes=minutes)).isoformat()  # noqa: E731
            with self.db:
                tid = self.db.execute("INSERT INTO therapist (name, created_at) VALUES (?, ?)",
                                      ("Muestra para invitados (datos sintéticos)", at(10))).lastrowid
                pid = self.db.execute("INSERT INTO patient (therapist_id, alias, consent_given, joined_at, created_at) "
                                      "VALUES (?, 'Paciente de muestra', 1, ?, ?)", (tid, at(9), at(10))).lastrowid
                plan = [("sit-to-stand", 1, 10, 0, 3, json.dumps({"trunk_margin": 15, "valgus_margin": 10, "max_reps": 10})),
                        ("half-squat", 2, 8, 0, 3, json.dumps({}))]
                for ex_id, sets, reps, hold, per_week, env in plan:
                    if ex_id in self.catalog:
                        self.db.execute("INSERT INTO plan_exercise (patient_id, exercise_id, sets, reps, hold_seconds, per_week, "
                                        "safety_envelope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                        (pid, ex_id, sets, reps, hold, per_week, env, at(9)))
                monitored = [{"index": i, "calibration": i <= 3, "kneeRom": 88.0 + (i % 3), "peakTrunk": 28.0 + (i == 5) * 20,
                              "peakValgusL": 3.0 + (i == 7) * 14, "peakValgusR": 2.5, "romReached": i > 3} for i in range(1, 11)]
                s1 = self.db.execute(
                    "INSERT INTO session (patient_id, exercise_id, mode, source, started_at, ended_at, end_reason, reps_done, reps, "
                    "pain_score) VALUES (?, 'sit-to-stand', 'monitored', 'demo', ?, ?, 'completed', 10, ?, 2)",
                    (pid, at(3, 6), at(3), json.dumps(monitored))).lastrowid
                self.db.executemany("INSERT INTO compensation_event (session_id, rep, type, side, value, peak, threshold, severity, "
                                    "alert_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                    [(s1, 5, "trunk_flexion", None, 44.0, 48.0, 43.0, 1, 38),
                                     (s1, 7, "knee_valgus", "left", 14.0, 17.0, 13.0, 1, 41)])
                camera = [{"index": i, "side": None, "peak": 52.0 + i % 4, "seconds": 3.1} for i in range(1, 17)]
                self.db.execute("INSERT INTO session (patient_id, exercise_id, mode, source, started_at, ended_at, end_reason, "
                                "reps_done, reps, pain_score) VALUES (?, 'half-squat', 'guided', 'camera', ?, ?, 'completed', 16, ?, 3)",
                                (pid, at(1, 9), at(1), json.dumps(camera)))
                self.db.execute("INSERT INTO session (patient_id, exercise_id, mode, source, started_at, ended_at, end_reason, "
                                "reps_done, reps, no_camera, no_camera_reason) VALUES (?, 'half-squat', 'guided', 'guided', ?, ?, "
                                "'completed', 16, '[]', 1, 'declined')", (pid, at(0, 70), at(0, 60)))
                self.db.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('guest_sandbox', ?)", (str(tid),))
                draft = soap.draft(None, self._report_input(self.db.execute("SELECT * FROM session WHERE id = ?", (s1,)).fetchone()))
                self.db.execute("INSERT INTO clinical_report (session_id, soap_draft, facts, source, created_at) VALUES (?, ?, ?, ?, ?)",
                                (s1, json.dumps(draft["soap"], ensure_ascii=False), json.dumps(draft["facts"], ensure_ascii=False),
                                 draft["source"], at(2)))
            return tid

    def demo_run(self, _subject, data):
        """Resultado de la demo pública del Prototipo (TD-108): solo números, sin video, puntos ni datos personales. Quien
        lo manda no puede leerlo después; solo lo ve el Administrador. Con tope por hora contra el abuso."""
        source = data.get("source")
        if source not in ("demo", "camera"):
            raise ApiError(400, "'source' debe ser demo o camera.")
        if data.get("exercise_id") != "sit-to-stand":
            raise ApiError(400, "La demo pública es solo de sentarse y pararse.")
        end_reason = data.get("end_reason")
        if end_reason not in END_REASONS:
            raise ApiError(400, "'end_reason' no es válido.")
        row = (source, "sit-to-stand", end_reason, self._int(data, "reps_done", 0, 50), self._int(data, "calibration_reps", 0, 10),
               self._int(data, "duration_s", 0, 7200, 0) or None, self._int(data, "trunk_events", 0, 50, 0),
               self._int(data, "valgus_events", 0, 100, 0), self._int(data, "low_confidence_reps", 0, 50, 0))
        hour = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with self.lock, self.db:
            if self.db.execute("SELECT COUNT(*) FROM demo_run WHERE created_at >= ?", (hour,)).fetchone()[0] >= DEMO_RUNS_PER_HOUR:
                raise ApiError(429, "Demasiadas demos en la última hora. Intenta más tarde.")
            self.db.execute("INSERT INTO demo_run (source, exercise_id, end_reason, reps_done, calibration_reps, duration_s, "
                            "trunk_events, valgus_events, low_confidence_reps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (*row, now_iso()))
        return 202, {"ok": True}

    def admin_demo_runs(self, _admin_id, _data):
        week = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        with self.lock:
            q = lambda sql, *a: self.db.execute(sql, a).fetchone()[0]  # noqa: E731
            by_source = {r["source"]: r["n"] for r in self.db.execute("SELECT source, COUNT(*) AS n FROM demo_run GROUP BY source")}
            by_end = {r["end_reason"]: r["n"] for r in self.db.execute("SELECT end_reason, COUNT(*) AS n FROM demo_run GROUP BY end_reason")}
            recent = [dict(r) for r in self.db.execute(
                "SELECT id, source, end_reason, reps_done, calibration_reps, duration_s, trunk_events, valgus_events, "
                "low_confidence_reps, created_at FROM demo_run ORDER BY id DESC LIMIT 30")]
            return 200, {"total": q("SELECT COUNT(*) FROM demo_run"), "last_7d": q("SELECT COUNT(*) FROM demo_run WHERE created_at >= ?", week),
                         "by_source": by_source, "by_end_reason": by_end,
                         "avg_reps": q("SELECT ROUND(AVG(reps_done), 1) FROM demo_run"),
                         "with_trunk_events": q("SELECT COUNT(*) FROM demo_run WHERE trunk_events > 0"),
                         "with_valgus_events": q("SELECT COUNT(*) FROM demo_run WHERE valgus_events > 0"),
                         "guests": q("SELECT COUNT(*) FROM guest"), "recent": recent}

    # ------------------------------------------------------------------ Nivel 3: organizaciones (ADR-026)
    def _org(self, org_id: int) -> sqlite3.Row:
        org = self.db.execute("SELECT * FROM organization WHERE id = ?", (org_id,)).fetchone()
        if not org:
            raise ApiError(404, "No existe esa organización.")
        return org

    def _org_of_therapist(self, therapist_id: int):
        return self.db.execute("SELECT o.* FROM organization o JOIN org_license l ON l.organization_id = o.id "
                               "WHERE l.therapist_id = ? AND l.status = 'active'", (therapist_id,)).fetchone()

    def _link_license(self, email: str, therapist_id) -> None:
        """Una licencia activa invitada a este correo queda vinculada a su fisioterapeuta."""
        if therapist_id:
            self.db.execute("UPDATE org_license SET therapist_id = ? WHERE email = ? AND status = 'active' "
                            "AND therapist_id IS NULL", (therapist_id, email.lower()))

    def _org_summary(self, org) -> dict:
        """Solo plan, licencias y conteos de pacientes por profesional: ningún dato clínico (I-19)."""
        licenses = [dict(r) for r in self.db.execute("SELECT * FROM org_license WHERE organization_id = ? ORDER BY id",
                                                      (org["id"],))]
        ids = [lic["therapist_id"] for lic in licenses if lic["therapist_id"] is not None]
        counts = {}
        if ids:
            marks = ",".join("?" * len(ids))
            counts = {r["therapist_id"]: r["n"] for r in self.db.execute(
                f"SELECT therapist_id, COUNT(*) AS n FROM patient WHERE therapist_id IN ({marks}) GROUP BY therapist_id", ids)}
        return organizations.summary(dict(org), licenses, counts)

    def admin_orgs(self, _admin_id, _data):
        with self.lock:
            orgs = self.db.execute("SELECT * FROM organization ORDER BY id").fetchall()
            return 200, {"organizations": [{**self._org_summary(o), "admin_email": o["admin_email"]} for o in orgs]}

    def admin_create_org(self, _admin_id, data):
        try:
            name = organizations.clean_name(data.get("name"))
            plan = organizations.clean_plan(data.get("plan"))
            admin_email = organizations.clean_email(data.get("admin_email"))
        except organizations.OrgError as err:
            raise ApiError(400, str(err))
        if admin_email in settings.admin_emails():
            raise ApiError(400, "Ese correo es de un Administrador maestro; usa otro para la organización.")
        with self.lock, self.db:
            if self.db.execute("SELECT 1 FROM organization WHERE admin_email = ?", (admin_email,)).fetchone():
                raise ApiError(409, "Ese correo ya administra otra organización.")
            cur = self.db.execute("INSERT INTO organization (name, plan, admin_email, created_at) VALUES (?, ?, ?, ?)",
                                  (name, plan, admin_email, now_iso()))
            for user in self.db.execute("SELECT * FROM app_user WHERE email = ?", (admin_email,)).fetchall():
                self._revoke(user)                       # la próxima vez entra como organización
            org = self._org(cur.lastrowid)
            return 201, {**self._org_summary(org), "admin_email": admin_email}

    def org_summary(self, org_id, _data):
        with self.lock:
            return 200, self._org_summary(self._org(org_id))

    def org_invite(self, org_id, data):
        with self.lock, self.db:
            org = self._org(org_id)
            licenses = [dict(r) for r in self.db.execute("SELECT * FROM org_license WHERE organization_id = ?", (org_id,))]
            try:
                email = organizations.check_invite(dict(org), licenses, data.get("email"))
            except organizations.OrgError as err:
                raise ApiError(400, str(err))
            if self.db.execute("SELECT 1 FROM org_license WHERE email = ? AND status = 'active'", (email,)).fetchone():
                raise ApiError(409, "Ese profesional ya tiene una licencia activa en otra organización.")
            user = self.db.execute("SELECT therapist_id FROM app_user WHERE email = ? AND therapist_id IS NOT NULL",
                                   (email,)).fetchone()
            self.db.execute("INSERT INTO org_license (organization_id, email, therapist_id, status, created_at) "
                            "VALUES (?, ?, ?, 'active', ?)", (org_id, email, user["therapist_id"] if user else None, now_iso()))
            return 201, self._org_summary(org)

    def org_revoke(self, org_id, _data, license_id):
        """Libera una licencia. El fisioterapeuta y sus pacientes siguen igual; la organización deja de contarlo."""
        with self.lock, self.db:
            org = self._org(org_id)
            lic = self.db.execute("SELECT * FROM org_license WHERE id = ? AND organization_id = ?",
                                  (license_id, org_id)).fetchone()
            if not lic:
                raise ApiError(404, "No existe esa licencia.")
            if lic["status"] != "revoked":
                self.db.execute("UPDATE org_license SET status = 'revoked', revoked_at = ? WHERE id = ?", (now_iso(), license_id))
            return 200, self._org_summary(org)

    def org_ehr(self, org_id, data):
        try:
            ehr = organizations.clean_ehr(data)
        except organizations.OrgError as err:
            raise ApiError(400, str(err))
        with self.lock, self.db:
            self._org(org_id)
            self.db.execute("UPDATE organization SET ehr_fhir_base_url = ?, ehr_enabled = ? WHERE id = ?",
                            (ehr["fhir_base_url"], int(ehr["enabled"]), org_id))
            return 200, self._org_summary(self._org(org_id))

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
            sessions = self._sessions(patient_id, 200)
        done, history = defaultdict(int), defaultdict(list)
        now = datetime.now(timezone.utc)
        week_ago, fortnight = now - timedelta(days=7), now - timedelta(days=14)
        for s in sessions:
            if s["end_reason"] != "completed":
                continue
            if parse_iso(s["ended_at"]) >= week_ago:
                done[s["exercise_id"]] += 1
            if parse_iso(s["ended_at"]) >= fortnight:     # el día de hoy lo calcula care-plan.js con la hora local
                history[s["exercise_id"]].append(s["ended_at"])
        return 200, {"patient": {"id": p["id"], "alias": p["alias"], "consent_given": bool(p["consent_given"]),
                                 "profile": json.loads(p["profile"]) if p["profile"] else None},
                     "therapist": {"name": therapist["name"]},
                     "plan": [{**item, "done_7d": done[item["exercise_id"]], "history": sorted(history[item["exercise_id"]])}
                              for item in plan]}

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
        # Sin cámara (TD-110/111): la bandera la pone el servidor según `source`, nunca el cliente; el motivo es opcional.
        no_camera = source == "guided"
        reason = data.get("no_camera_reason")
        no_camera_reason = (reason if reason in NO_CAMERA_REASONS else "guided_view") if no_camera else None
        if no_camera and (data.get("events") or any(isinstance(r, dict) and r.get("peak") is not None for r in data.get("reps") or [])):
            raise ApiError(400, "Una sesión sin cámara no lleva métricas cinemáticas ni eventos.")
        reps = data.get("reps") or []
        events = data.get("events") or []
        if not isinstance(reps, list) or len(reps) > 100 or not isinstance(events, list) or len(events) > 200:
            raise ApiError(400, "'reps' o 'events' tienen un formato inválido.")
        reps = [clean_rep(r) for r in reps if isinstance(r, dict)]
        symptom_ids = data.get("symptom_report_ids") or []
        if (not isinstance(symptom_ids, list) or len(symptom_ids) > 20
                or not all(isinstance(i, int) and not isinstance(i, bool) for i in symptom_ids)):
            raise ApiError(400, "'symptom_report_ids' debe ser una lista de hasta 20 números.")
        clean_events = []
        for e in events:
            if not isinstance(e, dict) or e.get("type") not in EVENT_TYPES:
                raise ApiError(400, "Un evento tiene un tipo inválido.")
            latency = e.get("alertLatencyMs")
            clean_events.append((self._int(e, "rep", 0, 500), e["type"], e.get("side") if e.get("side") in ("left", "right") else None,
                                 self._num_or_none(e, "value"), self._num_or_none(e, "peak"), self._num_or_none(e, "threshold"),
                                 self._int(e, "severity", 1, 3), latency if isinstance(latency, int) and not isinstance(latency, bool)
                                 and 0 <= latency <= 60000 else None))
        with self.lock, self.db:
            p = self.db.execute("SELECT consent_given FROM patient WHERE id = ?", (patient_id,)).fetchone()
            if not p or not p["consent_given"]:
                raise ApiError(403, "Sin consentimiento no se registran sesiones.")          # I-3
            if not self.db.execute("SELECT 1 FROM plan_exercise WHERE patient_id = ? AND exercise_id = ? AND active = 1",
                                   (patient_id, ex_id)).fetchone():
                raise ApiError(409, "Ese ejercicio no está en tu plan.")                  # I-9: sin sobre no hay sesión
            cur = self.db.execute("INSERT INTO session (patient_id, exercise_id, mode, source, started_at, ended_at, end_reason, "
                                  "reps_done, baseline, reps, pain_reported, no_camera, no_camera_reason) "
                                  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                  (patient_id, ex_id, mode, source, started.isoformat(), ended.isoformat(), end_reason, reps_done,
                                   json.dumps(data.get("baseline")) if isinstance(data.get("baseline"), dict) else None,
                                   json.dumps(reps), 1 if end_reason == "pain_stop" else 0, int(no_camera), no_camera_reason))
            self.db.executemany("INSERT INTO compensation_event (session_id, rep, type, side, value, peak, threshold, severity, "
                                "alert_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                [(cur.lastrowid, *e) for e in clean_events])
            if symptom_ids:       # por id y no por hora: el reloj del dispositivo puede estar corrido (TD-79)
                marks = ",".join("?" * len(symptom_ids))
                self.db.execute(f"UPDATE symptom_report SET session_id = ? WHERE id IN ({marks}) AND patient_id = ? "
                                "AND session_id IS NULL", (cur.lastrowid, *symptom_ids, patient_id))
        self.hub.publish(("therapist", patient_id), {"kind": "session_saved", "session_id": cur.lastrowid, "exercise_id": ex_id,
                                                     "end_reason": end_reason, "no_camera": no_camera, "at": now_iso()})
        return 201, {"session_id": cur.lastrowid, "no_camera": no_camera}

    def score_pain(self, patient_id, data, session_id):
        """EVA 0-10 que el paciente marca al terminar una sesión (ADR-025, TD-100). Una vez por sesión: es lo que sintió al
        terminar, no una lectura que se corrige después. Lo ve el fisioterapeuta; no decide nada clínico ni lo lee la IA."""
        score = data.get("score")
        if isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 10:
            raise ApiError(400, "'score' debe ser un número entero de 0 a 10.")
        with self.lock, self.db:
            row = self.db.execute("SELECT id, exercise_id, pain_score FROM session WHERE id = ? AND patient_id = ?",
                                  (session_id, patient_id)).fetchone()
            if not row:
                raise ApiError(404, "No existe esa sesión.")
            if row["pain_score"] is not None:
                raise ApiError(409, "Ya marcaste el dolor de esta sesión.")
            at = now_iso()
            self.db.execute("UPDATE session SET pain_score = ?, pain_scored_at = ? WHERE id = ?", (score, at, session_id))
        high = score >= PAIN_HIGH
        self.hub.publish(("therapist", patient_id), {"kind": "pain_scored", "session_id": session_id,
                                                     "exercise_id": row["exercise_id"], "score": score, "high": high, "at": at})
        message = ("Es un dolor alto: no repitas el ejercicio hoy y avísale a tu fisioterapeuta. Si es un dolor fuerte, te "
                   "mareas o pierdes fuerza, busca atención." if high else "Gracias: tu fisioterapeuta verá cómo terminaste.")
        return 200, {"session_id": session_id, "pain_score": score, "high": high, "message": message}

    # ------------------------------------------------------------------ molestias del paciente (ADR-021)
    def _assess_symptom(self, patient_id: int, exercise_id: str | None, option: str | None, text: str | None,
                        in_session: bool, current: dict) -> dict:
        """Decisión determinista, sin LLM, sobre una molestia. La reutilizará el turno de voz (TD-61, source 'voice_turn').
        Devuelve {kind, category, text, action, adjustment}."""
        found = safety.classify_symptom(text)
        if option == "red_flag" or (found and found["kind"] == "red_flag"):
            kind, category, action, adjustment = "red_flag", "red_flag", "session_stopped", None
        else:
            kind = "discomfort"
            category = SYMPTOM_OPTIONS.get(option) or (found["category"] if found else "other")
            action, adjustment = "logged", None
            if in_session:
                item = next((i for i in self._plan(patient_id) if i["exercise_id"] == exercise_id), None)
                proposal = None
                if item and item["safety_envelope"]:          # ejercicio monitoreado: hay sobre que acota el ajuste
                    proposal = safety.reduce_demand(safety.agent_envelope(item["safety_envelope"]), current)
                if proposal:
                    action, adjustment = "demand_lowered", {k: proposal[k] for k in ("param", "old", "new")}
                else:
                    action = "paused"                         # guiado, sin sobre o sin qué bajar: pausa y aviso
        return {"kind": kind, "category": category, "text": text, "action": action, "adjustment": adjustment}

    def _save_symptom(self, patient_id: int, exercise_id: str | None, record: dict, source: str) -> dict:
        with self.lock, self.db:
            at = now_iso()
            cur = self.db.execute(
                "INSERT INTO symptom_report (patient_id, exercise_id, reported_at, kind, category, text, action, adjustment, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (patient_id, exercise_id, at, record["kind"], record["category"], record["text"], record["action"],
                 json.dumps(record["adjustment"]) if record["adjustment"] else None, source))
        report = {"id": cur.lastrowid, "session_id": None, "exercise_id": exercise_id, "reported_at": at, "kind": record["kind"],
                  "category": record["category"], "text": record["text"], "action": record["action"],
                  "adjustment": record["adjustment"]}
        self.hub.publish(("therapist", patient_id), {"kind": "symptom_reported", "id": cur.lastrowid, "exercise_id": exercise_id,
                                                     "category": record["category"], "symptom_kind": record["kind"],
                                                     "action": record["action"], "text": record["text"],
                                                     "adjustment": record["adjustment"], "at": at})
        return report

    def report_discomfort(self, patient_id, data):
        """El paciente avisa de una molestia con el formulario, sin GPU (ADR-021). Se registra, se avisa al fisioterapeuta y,
        en sesión, solo se baja la exigencia dentro del sobre; una alarma detiene la sesión (I-7)."""
        text = self._text(data, "text", 200, required=False)
        option = data.get("option")
        if option is not None and (not isinstance(option, str) or option not in SYMPTOM_OPTIONS):
            raise ApiError(400, "Esa opción no existe.")
        if not text and not option:
            raise ApiError(400, "Cuéntanos qué sientes: elige una opción o escribe una frase.")
        exercise_id = data.get("exercise_id")
        if exercise_id is not None and (not isinstance(exercise_id, str) or exercise_id not in self.catalog):
            raise ApiError(400, "Ese ejercicio no está en el catálogo.")     # un id que no es texto daba 500 al consultar
        current = {}
        raw = data.get("current")
        for key, lo, hi in (("rom_target", 10, 140), ("reps", 1, 50)):
            v = raw.get(key) if isinstance(raw, dict) else None
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi:
                current[key] = v
        with self.lock:
            p = self.db.execute("SELECT consent_given FROM patient WHERE id = ?", (patient_id,)).fetchone()
            if not p or not p["consent_given"]:
                raise ApiError(403, "Sin consentimiento no se registran molestias.")          # dato de salud, igual que las sesiones
            if exercise_id is not None and not self.db.execute(
                    "SELECT 1 FROM plan_exercise WHERE patient_id = ? AND exercise_id = ? AND active = 1", (patient_id, exercise_id)).fetchone():
                raise ApiError(409, "Ese ejercicio no está en tu plan.")
            record = self._assess_symptom(patient_id, exercise_id, option, text, data.get("in_session") is True, current)
        report = self._save_symptom(patient_id, exercise_id, record, "patient_form")
        action, adjustment = record["action"], record["adjustment"]
        message = {"session_stopped": coach.STOP_TEXT, "paused": coach.PAUSE_TEXT,
                   "demand_lowered": coach.template({"outcome": "applied", "proposal": adjustment}) if adjustment else coach.PAUSE_TEXT,
                   "logged": "Gracias: se lo avisamos a tu fisioterapeuta. Si empeora, no hagas el ejercicio y consúltale."}[action]
        return 201, {"report": report, "action": action, "adjustment": adjustment, "stop": action == "session_stopped",
                     "message": message}

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
