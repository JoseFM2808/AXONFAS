"""AXONFAS · verificación del inicio de sesión con Google (ADR-019). Solo biblioteca estándar.

El navegador obtiene un ID token (JWT firmado con RS256) con Google Identity Services y lo manda a POST /api/auth/google.
Aquí se verifica en el servidor, sin confiar en el navegador:
  - firma RS256 con las claves públicas de Google (JWKS, en caché según Cache-Control);
  - emisor accounts.google.com, destinatario = nuestro GOOGLE_CLIENT_ID, vigencia (exp/iat con 60 s de tolerancia);
  - correo verificado.
No se usa el client secret: el flujo de ID token no lo necesita.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import threading
import time
import urllib.request

GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
SKEW = 60
# DigestInfo de SHA-256 para PKCS#1 v1.5 (RFC 8017, §9.2)
SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


class AuthError(Exception):
    pass


def b64url(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def rs256_ok(n: int, e: int, signing_input: bytes, signature: bytes) -> bool:
    """Verificación RSASSA-PKCS1-v1_5 con SHA-256, en tiempo constante al comparar."""
    k = (n.bit_length() + 7) // 8
    if len(signature) != k:
        return False
    s = int.from_bytes(signature, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = SHA256_PREFIX + hashlib.sha256(signing_input).digest()
    if k < len(t) + 11:
        return False
    expected = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return hmac.compare_digest(em, expected)


class Jwks:
    """Claves públicas de Google en caché. `fetch(url) -> (bytes, cache_seconds)` se reemplaza en los tests."""

    def __init__(self, url: str = GOOGLE_JWKS, fetch=None):
        self.url = url
        self.fetch = fetch or self._fetch
        self.keys: dict[str, tuple[int, int]] = {}
        self.until = 0.0
        self.lock = threading.Lock()

    @staticmethod
    def _fetch(url: str) -> tuple[bytes, int]:
        with urllib.request.urlopen(url, timeout=10) as resp:
            cc = resp.headers.get("Cache-Control", "")
            m = re.search(r"max-age=(\d+)", cc)
            return resp.read(), int(m.group(1)) if m else 3600

    def key(self, kid: str) -> tuple[int, int]:
        with self.lock:
            if kid not in self.keys or time.time() > self.until:
                try:
                    raw, ttl = self.fetch(self.url)
                    data = json.loads(raw)
                except Exception as err:  # noqa: BLE001
                    raise AuthError(f"no se pudieron leer las claves de Google: {err}") from err
                self.keys = {k["kid"]: (int.from_bytes(b64url(k["n"]), "big"), int.from_bytes(b64url(k["e"]), "big"))
                             for k in data.get("keys", []) if k.get("kty") == "RSA" and k.get("kid")}
                self.until = time.time() + max(60, min(ttl, 86400))
            if kid not in self.keys:
                raise AuthError("el token está firmado con una clave que Google no publica")
            return self.keys[kid]


def verify_id_token(token: str, client_id: str, jwks: Jwks, now: float | None = None) -> dict:
    """Las afirmaciones del ID token si es válido para `client_id`; si no, AuthError con el motivo."""
    if not client_id:
        raise AuthError("falta GOOGLE_CLIENT_ID en el servidor")
    parts = (token or "").split(".")
    if len(parts) != 3:
        raise AuthError("el token no tiene forma de JWT")
    try:
        header = json.loads(b64url(parts[0]))
        claims = json.loads(b64url(parts[1]))
        signature = b64url(parts[2])
    except (ValueError, json.JSONDecodeError) as err:
        raise AuthError("el token está dañado") from err
    if header.get("alg") != "RS256":
        raise AuthError("algoritmo de firma no permitido")
    n, e = jwks.key(str(header.get("kid")))
    if not rs256_ok(n, e, f"{parts[0]}.{parts[1]}".encode(), signature):
        raise AuthError("la firma del token no es válida")
    now = time.time() if now is None else now
    if claims.get("iss") not in ISSUERS:
        raise AuthError("el token no lo emitió Google")
    aud = claims.get("aud")
    if aud != client_id and not (isinstance(aud, list) and client_id in aud):
        raise AuthError("el token es para otra aplicación")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - SKEW:
        raise AuthError("el token venció: vuelve a iniciar sesión")
    if isinstance(claims.get("iat"), (int, float)) and claims["iat"] > now + SKEW:
        raise AuthError("el token tiene una fecha futura")
    if not claims.get("sub"):
        raise AuthError("el token no identifica a la cuenta")
    if not claims.get("email") or claims.get("email_verified") not in (True, "true"):
        raise AuthError("la cuenta de Google no tiene un correo verificado")
    return claims
