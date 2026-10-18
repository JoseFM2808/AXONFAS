"""El invitado puede pedir el resumen con IA del paciente de muestra, con tope por hora (ADR-031). Sin red ni LLM.

    py -m unittest discover -s tests/backend -v
"""
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "backend"))
sys.path.insert(0, str(ROOT / "src"))
import staging_api  # noqa: E402
from staging_api import StagingApi, load_catalog  # noqa: E402

CATALOG = load_catalog(ROOT / "src" / "frontend" / "validation-prototype" / "catalog.js")
SUGGESTION = {"title": "Bajar repeticiones", "detail": "Por dolor de rodilla", "because": "regla", "priority": 1}


class Client:
    def __init__(self, api, token=None):
        self.api, self.token = api, token

    def call(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        return self.api.handle(method, path, headers, json.dumps(body).encode() if body is not None else b"")


class GuestAiTest(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in ("AMD_TOKENFACTORY_BASE_URL", "AMD_TOKENFACTORY_API_KEY", "AXONFAS_LLM_KEY")}
        self.api = StagingApi(":memory:", CATALOG)
        self.addCleanup(self.api.db.close)
        _, body = Client(self.api).call("POST", "/api/auth/guest", {})
        self.guest = Client(self.api, body["token"])
        _, me = self.guest.call("GET", "/api/therapists/me")
        self.pid = me["patients"][0]["id"]

    def tearDown(self):
        for k, v in self.saved.items():
            if v is not None:
                os.environ[k] = v

    def test_la_muestra_trae_un_perfil_sintetico_para_las_sugerencias(self):
        _, d = self.guest.call("GET", f"/api/patients/{self.pid}")
        self.assertEqual(d["patient"]["profile"]["pain_areas"], ["knee"])

    def test_el_resumen_con_ia_pasa_el_muro_y_lo_demas_no(self):
        status, body = self.guest.call("POST", f"/api/patients/{self.pid}/advice", {"suggestions": [SUGGESTION]})
        self.assertEqual(status, 503, "sin IA configurada en el test: pasa la autorización y llega al proveedor")
        self.assertNotEqual(body.get("code"), "auth_required")
        self.assertEqual(self.guest.call("POST", f"/api/patients/{self.pid}/highlight", {"muscle": "quads"})[1].get("code"), "auth_required")
        self.assertEqual(self.guest.call("PUT", f"/api/patients/{self.pid}/profile", {})[1].get("code"), "auth_required")

    def test_solo_sobre_la_muestra(self):
        _, t = Client(self.api).call("POST", "/api/therapists", {"name": "Lic. Real de prueba"})
        _, p = Client(self.api, t["token"]).call("POST", "/api/patients", {"alias": "Otro"})
        status, _ = self.guest.call("POST", f"/api/patients/{p['patient']['id']}/advice", {"suggestions": [SUGGESTION]})
        self.assertEqual(status, 404, "un paciente que no es de la muestra no existe para el invitado")

    def test_tope_por_hora_para_todos_los_invitados(self):
        old = staging_api.GUEST_AI_PER_HOUR
        staging_api.GUEST_AI_PER_HOUR = 2
        self.addCleanup(setattr, staging_api, "GUEST_AI_PER_HOUR", old)
        _, other = Client(self.api).call("POST", "/api/auth/guest", {})
        other = Client(self.api, other["token"])
        self.assertEqual(self.guest.call("POST", f"/api/patients/{self.pid}/advice", {"suggestions": [SUGGESTION]})[0], 503)
        self.assertEqual(other.call("POST", f"/api/patients/{self.pid}/advice", {"suggestions": [SUGGESTION]})[0], 503)
        self.assertEqual(self.guest.call("POST", f"/api/patients/{self.pid}/advice", {"suggestions": [SUGGESTION]})[0], 429)


if __name__ == "__main__":
    unittest.main()
