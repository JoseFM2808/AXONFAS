"""Sirve el prototipo de validación (TD-28) en la red local para probarlo desde otros equipos (TD-33).

    py src/frontend/validation-prototype/serve.py                  HTTP 8091 + HTTPS 8443 en todas las interfaces
    py src/frontend/validation-prototype/serve.py --http-port 9091 --https-port 9443
    py src/frontend/validation-prototype/serve.py --local-only     solo este equipo (127.0.0.1)

- Este equipo abre http://localhost:8091: localhost cuenta como origen seguro y la cámara funciona.
- Los otros equipos de la red abren https://<IP>:8443 (el QR de la página apunta ahí). Los navegadores solo dan la
  cámara en HTTPS, así que se usa un certificado autofirmado: la primera vez hay que aceptar el aviso de seguridad.
- El certificado y su llave se guardan fuera del proyecto y de Google Drive (~/.axonfas/certs) y nunca van al repo.
  Se generan con el openssl que trae Git for Windows y se rehacen si cambia la IP.
- /lan.json le dice a la página las direcciones para armar el QR. Solo se sirven los archivos de esta carpeta.
Solo biblioteca estándar (Python 3.11+). Úsalo en redes de confianza (casa, oficina), no en wifi pública.

En la nube (ADR-020) corre detrás de un proxy con HTTPS (Caddy en config/deploy/):
    py src/frontend/validation-prototype/serve.py --cloud      escucha en 0.0.0.0:$PORT (8091), sin HTTPS propio ni QR
La configuración y los secretos salen del entorno o de ~/.axonfas/axonfas.env (src/backend/settings.py).
"""
from __future__ import annotations

import argparse
import functools
import ipaddress
import json
import os
import posixpath
import queue
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "backend"))
from staging_api import StagingApi, Stream, load_catalog, load_names, load_names_en, load_tracking  # noqa: E402  (API de Staging: cuentas, planes, en vivo)
import settings  # noqa: E402  (variables de entorno y ~/.axonfas/axonfas.env, ADR-018/019/020)

DEFAULT_DB = Path.home() / ".axonfas" / "staging.sqlite3"   # fuera del repo y de Drive (ADR-012)
DESIGN_DIR = HERE.parents[2] / "docs" / "design-system"    # index.html enlaza ../../../docs/design-system/tokens.css
DESIGN_PREFIX = "/docs/design-system/"
CERT_DIR = Path.home() / ".axonfas" / "certs"
GIT_OPENSSL = [Path(r"C:\Program Files\Git\usr\bin\openssl.exe"), Path(r"C:\Program Files\Git\mingw64\bin\openssl.exe")]


def lan_ip() -> str | None:
    """IP de la interfaz que sale a la red (la de la ruta por defecto); no envía ningún paquete."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
        except OSError:
            return None
    return None if ipaddress.ip_address(ip).is_loopback else ip


def find_openssl() -> str | None:
    """Primero el de Git (conocido); otros openssl del PATH pueden venir de instaladores con configuración rota."""
    return next((str(p) for p in GIT_OPENSSL if p.is_file()), None) or shutil.which("openssl")


def ensure_cert(ip: str) -> tuple[Path, Path] | None:
    """Certificado autofirmado para localhost y la IP de la red. Lo reutiliza mientras la IP no cambie."""
    cert, key, stamp = CERT_DIR / "axonfas-lan.crt", CERT_DIR / "axonfas-lan.key", CERT_DIR / "axonfas-lan.ip"
    if cert.is_file() and key.is_file() and stamp.is_file() and stamp.read_text().strip() == ip:
        return cert, key
    openssl = find_openssl()
    if not openssl:
        return None
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    conf = CERT_DIR / "openssl-min.cnf"                    # config propia: no depende de OPENSSL_CONF del sistema
    conf.write_text("[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = AXONFAS prototipo local\n", encoding="ascii")
    cmd = [openssl, "req", "-config", str(conf), "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "30",
           "-keyout", str(key), "-out", str(cert), "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}"]
    env = {k: v for k, v in os.environ.items() if k != "OPENSSL_CONF"}
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)
    if result.returncode != 0:
        print(f"No se pudo crear el certificado: {result.stderr.strip()[:300]}", file=sys.stderr)
        return None
    stamp.write_text(ip)
    return cert, key


class Handler(SimpleHTTPRequestHandler):
    """Archivos de esta carpeta, sin listar directorios, más /lan.json con las direcciones para el QR y el design
    system del proyecto en /docs/design-system/ (fuente única de tokens, TD-35)."""
    lan_info: dict = {}
    api: StagingApi | None = None
    cors: list[str] = []

    def _cors_headers(self) -> None:
        """La web en otro dominio (por ejemplo Vercel) puede llamar a la API si su origen está en AXONFAS_CORS_ORIGINS."""
        origin = self.headers.get("Origin")
        if origin and origin in self.cors:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept-Language")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")

    def do_OPTIONS(self):
        self.send_response(204 if self.path.startswith("/api/") else 404)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ------------------------------------------------------------------ API de Staging (/api/...)
    def _api(self, method: str):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 256 * 1024:
            self.send_error(413, "Demasiado grande")
            return
        body = self.rfile.read(length) if length else b""
        result = self.api.handle(method, self.path, self.headers, body)
        if isinstance(result, Stream):
            self._stream(result)
            return
        status, payload = result
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def _sse(self, message: dict):
        self.wfile.write(b"data: " + json.dumps(message, ensure_ascii=False).encode("utf-8") + b"\n\n")
        self.wfile.flush()

    def _stream(self, stream: Stream):
        """Server-Sent Events: el cliente lee con fetch (lleva el token en la cabecera, nunca en la URL)."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")                  # que un proxy no acumule los eventos
        self._cors_headers()
        self.end_headers()
        q = self.api.hub.subscribe(stream.channel)
        try:
            self._sse(stream.hello)
            while True:
                try:
                    message = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")         # mantiene viva la conexión y detecta cierres
                    self.wfile.flush()
                    continue
                self._sse(message)
        except OSError:                                      # el navegador cerró la pestaña o perdió la red
            pass
        finally:
            self.api.hub.unsubscribe(stream.channel, q)
            self.close_connection = True

    def do_POST(self):
        if self.path.startswith("/api/") and self.api:
            self._api("POST")
        else:
            self.send_error(405, "Método no permitido")

    def do_PUT(self):
        if self.path.startswith("/api/") and self.api:
            self._api("PUT")
        else:
            self.send_error(405, "Método no permitido")

    def translate_path(self, path):
        clean = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
        if clean.startswith(DESIGN_PREFIX):
            rel = posixpath.normpath(clean[len(DESIGN_PREFIX):])
            if rel.startswith(("..", "/")) or rel == ".":
                return str(HERE / "__fuera_de_alcance__")         # no existe: 404
            return str(DESIGN_DIR.joinpath(*rel.split("/")))
        return super().translate_path(path)

    def do_GET(self):
        if self.path.startswith("/api/") and self.api:
            self._api("GET")
            return
        if self.path.split("?", 1)[0] == "/lan.json":
            body = json.dumps(self.lan_info).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404, "No encontrado")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def serve(server: ThreadingHTTPServer) -> threading.Thread:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--http-port", type=int, default=8091)
    ap.add_argument("--https-port", type=int, default=8443)
    ap.add_argument("--local-only", action="store_true", help="escucha solo en 127.0.0.1 (sin red local ni QR)")
    ap.add_argument("--db", default=None, help="base SQLite (fuera del repo); también AXONFAS_DB")
    ap.add_argument("--cloud", action="store_true", help="nube: 0.0.0.0:$PORT, sin HTTPS propio ni QR (lo pone el proxy)")
    args = ap.parse_args()
    env_file = settings.load_env_file()
    db = args.db or settings.get("AXONFAS_DB") or str(DEFAULT_DB)
    Handler.api = StagingApi(db, load_catalog(HERE / "catalog.js"), load_names(HERE / "catalog.js"), load_tracking(HERE / "tracker.js"),
                             names_en=load_names_en(HERE / "i18n" / "catalog.en.js"))
    Handler.api.warm_ai()          # el estado de la IA queda tibio: el primer turno no espera la consulta al catálogo
    Handler.cors = settings.cors_origins()
    if args.cloud:
        args.http_port = int(settings.get("PORT") or args.http_port)

    ip = None if (args.local_only or args.cloud) else lan_ip()
    bind = "127.0.0.1" if args.local_only else "0.0.0.0"
    handler = functools.partial(Handler, directory=str(HERE))
    info = {"ip": ip, "local": f"http://localhost:{args.http_port}/", "lan_http": None, "lan_https": None}

    try:
        http_server = ThreadingHTTPServer((bind, args.http_port), handler)
    except OSError as err:
        print(f"El puerto {args.http_port} está ocupado ({err}). Cierra el otro servidor o usa --http-port.", file=sys.stderr)
        return 1
    servers = [http_server]
    if ip:
        info["lan_http"] = f"http://{ip}:{args.http_port}/"
        pair = ensure_cert(ip)
        if pair:
            try:
                https_server = ThreadingHTTPServer((bind, args.https_port), handler)
            except OSError as err:
                print(f"El puerto {args.https_port} está ocupado ({err}); sigo solo con HTTP.", file=sys.stderr)
            else:
                ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                ctx.load_cert_chain(certfile=str(pair[0]), keyfile=str(pair[1]))
                https_server.socket = ctx.wrap_socket(https_server.socket, server_side=True)
                servers.append(https_server)
                info["lan_https"] = f"https://{ip}:{args.https_port}/"
        else:
            print("Sin openssl no hay HTTPS: en otros equipos funcionará el demo, pero no la cámara.", file=sys.stderr)
    Handler.lan_info = info

    print("AXONFAS · prototipo de validación (Staging, solo validación)")
    print(f"  Este equipo:        {info['local']}")
    if info["lan_https"]:
        print(f"  Otros equipos:      {info['lan_https']}   (cámara; aceptar el aviso del certificado)")
    if info["lan_http"]:
        print(f"  Otros, sin cámara:  {info['lan_http']}   (solo demo)")
    print(f"  Base de datos:      {db}")
    print(f"  Configuración:      {env_file or 'variables de entorno'} · Google: {'sí' if settings.google_client_id() else 'falta GOOGLE_CLIENT_ID'}"
          f" · cuentas de demostración: {'sí' if settings.demo_accounts() else 'no'}")
    if not args.local_only:
        print("  Si Windows pregunta, permite Python en redes privadas. Ctrl+C para detener.")
    for s in servers:
        serve(s)
    try:
        while True:                                          # en Windows, Ctrl+C solo interrumpe esperas cortas
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nDetenido.")
    finally:
        for s in servers:
            s.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
