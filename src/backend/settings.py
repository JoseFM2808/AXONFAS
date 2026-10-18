"""AXONFAS · configuración del servidor (ADR-018/019/020).

Todo sale de variables de entorno. En una PC de desarrollo también se leen de un archivo local, fuera del repo y de
Drive, que llena el owner (nunca se versiona ni se pega en un chat):
    ~/.axonfas/axonfas.env         (o la ruta de AXONFAS_ENV_FILE)
con líneas KEY=valor. Las variables del entorno real ganan sobre las del archivo. Plantilla: config/.env.staging.example.
"""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ENV_FILE = Path.home() / ".axonfas" / "axonfas.env"
_loaded = False


def load_env_file(path: str | Path | None = None) -> Path | None:
    """Carga KEY=valor de un archivo local sin pisar lo que ya está en el entorno. Devuelve la ruta si existía."""
    global _loaded
    p = Path(path or os.environ.get("AXONFAS_ENV_FILE") or DEFAULT_ENV_FILE)
    _loaded = True
    if not p.is_file():
        return None
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
    return p


def get(key: str, default: str = "") -> str:
    if not _loaded:
        load_env_file()
    return os.environ.get(key, default).strip()


def flag(key: str, default: bool) -> bool:
    value = get(key, "")
    return default if value == "" else value.lower() in ("1", "true", "yes", "si", "sí", "on")


def csv(key: str) -> list[str]:
    return [x.strip() for x in get(key).split(",") if x.strip()]


def admin_emails() -> set[str]:
    """Correos del Administrador maestro (el equipo). Solo en el entorno, nunca en el repo (ADR-019)."""
    return {x.lower() for x in csv("AXONFAS_ADMIN_EMAILS")}


def google_client_id() -> str:
    """ID de cliente OAuth de Google (tipo «Aplicación web»). Es público: va al navegador. Sin él, no hay botón de Google."""
    return get("GOOGLE_CLIENT_ID")


def demo_accounts() -> bool:
    """Cuentas de demostración sin contraseña (ADR-012). Encendidas en local; en un despliegue público se apagan con 0."""
    return flag("AXONFAS_DEMO_ACCOUNTS", True)


def cors_origins() -> list[str]:
    """Orígenes que pueden llamar a la API desde otro dominio (por ejemplo, la web en Vercel). Vacío = solo el mismo."""
    return csv("AXONFAS_CORS_ORIGINS")
