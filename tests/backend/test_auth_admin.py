"""Tests del inicio de sesión con Google, los roles y el Administrador maestro (ADR-019). Sin red: se firma con una
clave RSA de prueba y se reemplazan las claves públicas de Google.

    py -m unittest discover -s tests/backend -v
"""
import base64
import hashlib
import json
import os
import random
import sys
import time
import unittest
from pathlib import Path

os.environ["AXONFAS_ENV_FILE"] = str(Path(__file__).with_name("no-existe.env"))   # nada del archivo local del owner
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
import google_auth  # noqa: E402
from staging_api import StagingApi, load_catalog  # noqa: E402

CATALOG = load_catalog(ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js")
CLIENT_ID = "test-client.apps.googleusercontent.com"
ADMIN = "equipo@axonfas.test"


def _prime(bits, rnd):
    while True:
        n = rnd.getrandbits(bits) | (1 << (bits - 1)) | 1
        d, s = n - 1, 0
        while d % 2 == 0:
            d //= 2
            s += 1
        for _ in range(20):
            a = rnd.randrange(2, n - 2)
            x = pow(a, d, n)
            if x in (1, n - 1):
                continue
            for _ in range(s - 1):
                x = pow(x, 2, n)
                if x == n - 1:
                    break
            else:
                break
        else:
            return n


RND = random.Random(2026)
P, Q = _prime(512, RND), _prime(512, RND)
N, E = P * Q, 65537
D = pow(E, -1, (P - 1) * (Q - 1))
K = (N.bit_length() + 7) // 8


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign(claims: dict, kid="k1", alg="RS256", tamper=False) -> str:
    head = b64(json.dumps({"alg": alg, "kid": kid, "typ": "JWT"}).encode())
    body = b64(json.dumps(claims).encode())
    t = google_auth.SHA256_PREFIX + hashlib.sha256(f"{head}.{body}".encode()).digest()
    em = b"\x00\x01" + b"\xff" * (K - len(t) - 3) + b"\x00" + t
    sig = pow(int.from_bytes(em, "big"), D, N).to_bytes(K, "big")
    if tamper:
        sig = bytes([sig[0] ^ 1]) + sig[1:]
    return f"{head}.{body}.{b64(sig)}"


def claims(email="ana@clinica.test", sub="g-1", **over):
    now = int(time.time())
    c = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": sub, "email": email, "email_verified": True,
         "name": "Ana Prueba", "iat": now, "exp": now + 3600}
    c.update(over)
    return c


JWKS = json.dumps({"keys": [{"kty": "RSA", "kid": "k1", "alg": "RS256", "n": b64(N.to_bytes(K, "big")), "e": b64(E.to_bytes(3, "big"))}]}).encode()


class Client:
    def __init__(self, api, token=None):
        self.api, self.token = api, token

    def call(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        return self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")


class VerifyTest(unittest.TestCase):
    def setUp(self):
        self.jwks = google_auth.Jwks(fetch=lambda url: (JWKS, 3600))

    def test_token_valido(self):
        out = google_auth.verify_id_token(sign(claims()), CLIENT_ID, self.jwks)
        self.assertEqual(out["email"], "ana@clinica.test")

    def test_rechazos(self):
        cases = {
            "firma alterada": sign(claims(), tamper=True),
            "otra aplicación": sign(claims(aud="otra.apps.googleusercontent.com")),
            "vencido": sign(claims(exp=int(time.time()) - 600)),
            "correo sin verificar": sign(claims(email_verified=False)),
            "otro emisor": sign(claims(iss="https://evil.test")),
            "algoritmo none": sign(claims(), alg="none"),
            "clave desconocida": sign(claims(), kid="k9"),
            "no es JWT": "abc.def",
        }
        for name, token in cases.items():
            with self.assertRaises(google_auth.AuthError, msg=name):
                google_auth.verify_id_token(token, CLIENT_ID, self.jwks)
        with self.assertRaises(google_auth.AuthError):
            google_auth.verify_id_token(sign(claims()), "", self.jwks)


class AuthAdminTest(unittest.TestCase):
    def setUp(self):
        for k in ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY", "AXONFAS_LLM_KEY"):
            os.environ.pop(k, None)
        os.environ.update(GOOGLE_CLIENT_ID=CLIENT_ID, AXONFAS_ADMIN_EMAILS=f"{ADMIN}, otro@axonfas.test", AXONFAS_DEMO_ACCOUNTS="1")
        self.api = StagingApi(":memory:", CATALOG)
        self.api.jwks = google_auth.Jwks(fetch=lambda url: (JWKS, 3600))

    def tearDown(self):
        for k in ("GOOGLE_CLIENT_ID", "AXONFAS_ADMIN_EMAILS", "AXONFAS_DEMO_ACCOUNTS"):
            os.environ.pop(k, None)

    def login(self, **kw):
        return Client(self.api).call("POST", "/api/auth/google", {"credential": sign(claims(**kw))})

    def test_config_publica(self):
        status, body = Client(self.api).call("GET", "/api/auth/config")
        self.assertEqual((status, body["google_client_id"], body["demo_accounts"], body["ai_provider"]), (200, CLIENT_ID, True, None))

    def test_cuenta_nueva_elige_fisioterapeuta_y_luego_entra_directo(self):
        status, body = self.login()
        self.assertEqual((status, body["role"], body["user"]["role"]), (200, "user", "pending"))
        user = Client(self.api, body["token"])
        self.assertEqual(user.call("GET", "/api/therapists/me")[0], 403, "sin rol todavía no ve pacientes")
        status, chosen = user.call("POST", "/api/auth/role", {"role": "therapist"})
        self.assertEqual((status, chosen["role"]), (201, "therapist"))
        self.assertEqual(Client(self.api, chosen["token"]).call("GET", "/api/therapists/me")[0], 200)
        self.assertEqual(user.call("POST", "/api/auth/role", {"role": "therapist"})[0], 409, "no se elige dos veces")
        again = self.login()[1]
        self.assertEqual(again["role"], "therapist", "la segunda vez entra con su rol")
        status, me = Client(self.api, again["token"]).call("GET", "/api/auth/me")
        self.assertEqual((status, me["role"], me["user"]["email"]), (200, "therapist", "ana@clinica.test"))

    def test_paciente_con_google_se_afilia_con_el_codigo_y_consentimiento(self):
        doctor = Client(self.api, Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Demo"})[1]["token"])
        code = doctor.call("POST", "/api/patients", {"alias": "Paciente A"})[1]["patient"]["invite_code"]
        user = Client(self.api, self.login(email="paciente@correo.test", sub="g-2")[1]["token"])
        self.assertEqual(user.call("POST", "/api/auth/role", {"role": "patient", "code": code})[0], 400, "sin consentimiento no")
        status, body = user.call("POST", "/api/auth/role", {"role": "patient", "code": code, "consent": True})
        self.assertEqual((status, body["role"], body["patient"]["alias"]), (201, "patient", "Paciente A"))
        self.assertEqual(Client(self.api, body["token"]).call("GET", "/api/me")[0], 200)

    def test_administrador_maestro_sale_solo_del_entorno(self):
        status, body = self.login(email=ADMIN.upper(), sub="g-admin")
        self.assertEqual((status, body["role"]), (200, "admin"), "el correo no distingue mayúsculas")
        admin = Client(self.api, body["token"])
        status, overview = admin.call("GET", "/api/admin/overview")
        self.assertEqual(status, 200)
        self.assertEqual(overview["config"]["admins_configured"], 2)
        self.assertNotIn(ADMIN, json.dumps(overview["config"]), "la vista no reparte la lista de administradores")
        other = self.login(email="x@clinica.test", sub="g-3")[1]
        self.assertEqual(Client(self.api, other["token"]).call("GET", "/api/admin/overview")[0], 403)
        doctor = Client(self.api, Client(self.api).call("POST", "/api/therapists", {"name": "Lic."})[1]["token"])
        self.assertEqual(doctor.call("GET", "/api/admin/users")[0], 403)
        users = admin.call("GET", "/api/admin/users")[1]["users"]
        me = next(u for u in users if u["role"] == "admin")
        target = next(u for u in users if u["email"] == "x@clinica.test")
        self.assertEqual(admin.call("PUT", f"/api/admin/users/{me['id']}", {"disabled": True})[0], 400, "no se toca a sí mismo")
        self.assertEqual(admin.call("PUT", f"/api/admin/users/{target['id']}", {"role": "admin"})[0], 400)
        status, out = admin.call("PUT", f"/api/admin/users/{target['id']}", {"role": "therapist"})
        self.assertEqual((status, out["user"]["role"]), (200, "therapist"))
        self.assertEqual(Client(self.api, other["token"]).call("GET", "/api/auth/me")[0], 401, "el token viejo se revoca")
        self.assertEqual(self.login(email="x@clinica.test", sub="g-3")[1]["role"], "therapist")
        self.assertEqual(admin.call("PUT", f"/api/admin/users/{target['id']}", {"disabled": True})[0], 200)
        self.assertEqual(self.login(email="x@clinica.test", sub="g-3")[0], 403, "cuenta desactivada")
        os.environ["AXONFAS_ADMIN_EMAILS"] = "otro@axonfas.test"
        self.assertEqual(self.login(email=ADMIN, sub="g-admin")[1]["role"], "user", "si sale de la lista, deja de ser admin")

    def test_ia_sin_proveedor_y_cuentas_de_demostracion_apagadas(self):
        admin = Client(self.api, self.login(email=ADMIN, sub="g-admin")[1]["token"])
        status, ai = admin.call("GET", "/api/admin/ai")
        self.assertEqual((status, ai["status"]["available"]), (200, False))
        self.assertIn("AMD_TOKENFACTORY_API_KEY", ai["missing"])
        self.assertEqual(admin.call("POST", "/api/admin/ai/test", {})[0], 503)
        os.environ["AXONFAS_DEMO_ACCOUNTS"] = "0"
        self.assertEqual(Client(self.api).call("POST", "/api/therapists", {"name": "X"})[0], 403)
        self.assertEqual(Client(self.api).call("POST", "/api/join", {"code": "ABCDEF", "consent": True})[0], 403)

    def test_cerrar_sesion_y_tokens_rotos(self):
        token = self.login()[1]["token"]
        c = Client(self.api, token)
        self.assertEqual(c.call("POST", "/api/auth/logout", {})[0], 200)
        self.assertEqual(c.call("GET", "/api/auth/me")[0], 401)
        self.assertEqual(Client(self.api).call("POST", "/api/auth/google", {"credential": "x.y.z"})[0], 401)
        self.assertEqual(Client(self.api).call("POST", "/api/auth/google", {})[0], 400)

    def test_base_vieja_gana_el_rol_admin_en_tokens(self):
        import sqlite3
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "vieja.sqlite3"
            con = sqlite3.connect(db)
            con.executescript("""CREATE TABLE token (token TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('therapist', 'patient')),
                                 subject_id INTEGER NOT NULL, created_at TEXT NOT NULL);
                                 INSERT INTO token VALUES ('t1', 'therapist', 1, '2026-10-01');""")
            con.commit()
            con.close()
            api = StagingApi(db, CATALOG)
            api.db.execute("INSERT INTO token VALUES ('t2', 'admin', 1, '2026-10-17')")
            self.assertEqual(api.db.execute("SELECT COUNT(*) FROM token").fetchone()[0], 2, "conserva los tokens viejos")
            api.db.close()


if __name__ == "__main__":
    unittest.main()
