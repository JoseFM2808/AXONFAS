"""Tests de los agentes y de las reglas que los rodean (ADR-004, ADR-005, ADR-016). Sin GPU: LLM de mentira.

    py -m unittest discover -s tests/agents -v
"""
import json
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from agents import advisor, clinical, coach, safety, soap  # noqa: E402
from agents.llm import FakeLLM, LLMError, parse_json  # noqa: E402
from agents.turn import DEMO_CTX, DEMO_LLM, run_text_turn, run_turn  # noqa: E402

ENV = {"rom_min": 60, "rom_max": 110, "max_reps": 10}
CUR = {"rom_target": 90, "reps": 7, "rest_seconds": 60}


def prop(param, old, new, reason="motivo"):
    return {"param": param, "old": old, "new": new, "reason": reason}


class BrokenLLM:
    def chat(self, *_a, **_k):
        raise LLMError("sin conexión")


class SafetyTest(unittest.TestCase):
    def test_frases_de_alarma_detienen_sin_importar_tildes(self):
        for text in ["Me estoy mareando", "siento un DOLOR AGUDO en la rodilla", "perdí la fuerza en la pierna",
                     "me duele el pecho", "creo que me desmayo", "no puedo respirar bien"]:
            self.assertIsNotNone(safety.red_flag(text), text)
        for text in ["Me dio un pinchazo en la ingle", "estoy un poco cansado", "todo bien"]:
            self.assertIsNone(safety.red_flag(text), text)

    def test_frases_de_alarma_nuevas(self):
        for text in ["Siento una pérdida de fuerza súbita", "me duele muchísimo", "tengo un dolor punzante", "me siento muy débil",
                     "se me durmió la pierna", "se me dobló la rodilla", "no puedo mover la pierna", "me duele mucho",
                     "tengo hormigueo en el pie"]:
            self.assertIsNotNone(safety.red_flag(text), text)
        for text in ["Me dio un pinchazo en la ingle", "estoy un poco cansado", "todo bien", "me duele un poco la rodilla",
                     "siento la pierna cansada"]:
            self.assertIsNone(safety.red_flag(text), text)

    def test_frase_nueva_detiene_sin_consultar_al_llm(self):
        llm = FakeLLM(default='{"action": "none", "reason": "x"}')
        out = run_turn(llm, "se me durmió la pierna", DEMO_CTX)
        self.assertEqual(out["decision"]["outcome"], "session_stopped")
        self.assertEqual(llm.calls, [])

    def test_dentro_del_sobre_se_aplica(self):
        d = safety.validate(prop("rom_target", 90, 70), ENV, CUR)
        self.assertEqual((d["outcome"], d["within_envelope"]), ("applied", True))

    def test_fuera_del_sobre_se_escala_y_nunca_se_aplica(self):
        for p in [prop("rom_target", 90, 130), prop("rom_target", 90, 40), prop("reps", 7, 12)]:
            d = safety.validate(p, ENV, CUR)
            self.assertEqual(d["outcome"], "escalated_to_therapist", p)
            self.assertFalse(d["within_envelope"])

    def test_propuestas_invalidas_se_rechazan(self):
        cases = [{"param": "rom_target", "new": 70}, prop("dosis_medicamento", 0, 1), prop("rom_target", 90, "setenta"),
                 prop("rom_target", 85, 70), prop("rom_target", 90, 70, reason=" "), prop("rom_target", 90, True)]
        for p in cases:
            d = safety.validate(p, ENV, CUR)
            self.assertEqual(d["outcome"], "rejected", p)
        self.assertEqual(safety.validate(prop("rom_target", 90, 70), {}, CUR)["outcome"], "rejected", "sin sobre no hay ajuste (I-3)")

    def test_rango_sin_limites_del_fisioterapeuta_se_rechaza(self):
        for env in [{"max_reps": 10}, {"rom_min": 60}, {"rom_min": 110, "rom_max": 60, "max_reps": 10}]:
            self.assertEqual(safety.validate(prop("rom_target", 90, 70), env, CUR)["outcome"], "rejected", env)
        self.assertEqual(safety.validate(prop("reps", 7, 5), {"rom_min": 60, "rom_max": 110}, CUR)["outcome"], "rejected")
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 90), {"max_reps": 10}, CUR)["outcome"], "applied")

    def test_sobre_de_staging_se_traduce(self):
        base = {"trunk_margin": 15, "valgus_margin": 10, "max_reps": 10}
        self.assertEqual(safety.agent_envelope(base), {**base, "pain_stop": True})
        self.assertEqual(safety.agent_envelope({**base, "rom_min": 60, "rom_max": 110}), {**base, "rom_min": 60, "rom_max": 110, "pain_stop": True})
        self.assertEqual(safety.agent_envelope({}), {})
        self.assertEqual(safety.agent_envelope(None), {})
        self.assertNotIn("max_reps", safety.agent_envelope({"max_reps": True}))
        # El caso del hallazgo 4: sin rom_min / rom_max en el sobre de Staging, el rango no se ajusta.
        self.assertEqual(safety.validate(prop("rom_target", 90, 70), safety.agent_envelope(base), CUR)["outcome"], "rejected")

    def test_tras_una_molestia_solo_se_baja_la_exigencia(self):
        d = safety.validate(prop("rom_target", 90, 110), ENV, CUR, "me molesta la rodilla")
        self.assertEqual((d["outcome"], d["within_envelope"]), ("escalated_to_therapist", True))
        self.assertEqual(safety.validate(prop("reps", 7, 9), ENV, CUR, "estoy cansado")["outcome"], "escalated_to_therapist")
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 30), ENV, CUR, "me cuesta")["outcome"], "escalated_to_therapist")
        self.assertEqual(safety.validate(prop("rom_target", 90, 70), ENV, CUR, "me molesta")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 90), ENV, CUR, "estoy cansado")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rom_target", 90, 110), ENV, CUR, "todo bien")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rom_target", 90, 110), ENV, CUR)["outcome"], "applied")

    def test_clasificar_sintomas(self):
        for text, kind, category in [("me mareo", "red_flag", "red_flag"), ("me duele mucho y me molesta", "red_flag", "red_flag"),
                                     ("me molesta la rodilla", "discomfort", "pain"), ("Calambre", "discomfort", "cramp"),
                                     ("Cansancio", "discomfort", "fatigue"), ("siento rigidez", "discomfort", "stiffness"),
                                     ("estoy incómodo", "discomfort", "other")]:
            found = safety.classify_symptom(text)
            self.assertEqual((found["kind"], found["category"]), (kind, category), text)
        self.assertIsNone(safety.classify_symptom("todo bien"))
        self.assertEqual(set(safety.DISCOMFORT), set(safety.DISCOMFORT_CATEGORY))

    def test_reduccion_determinista(self):
        def red(env=ENV, **cur):
            return safety.reduce_demand(env, {**CUR, **cur})
        p = red()
        self.assertEqual((p["param"], p["old"], p["new"]), ("rom_target", 90, 80))
        self.assertEqual(red(rom_target=65)["new"], 60)
        p = red(rom_target=60)
        self.assertEqual((p["param"], p["old"], p["new"]), ("reps", 7, 4))
        self.assertIsNone(red(rom_target=60, reps=1))
        self.assertIsNone(safety.reduce_demand({}, CUR))
        p = safety.reduce_demand(safety.agent_envelope({"trunk_margin": 15, "valgus_margin": 10, "max_reps": 10}), CUR)
        self.assertEqual((p["param"], p["old"], p["new"]), ("reps", 7, 4), "sin rango no se toca el rango")
        self.assertEqual(red(rom_target=120)["new"], 110)
        for rom in range(10, 145, 5):
            p = red(rom_target=rom)
            if p:
                self.assertEqual(safety.validate(p, ENV, {**CUR, "rom_target": rom}, "molestia")["outcome"], "applied", rom)

    def test_tras_una_molestia_el_sistema_baja_la_exigencia_solo(self):
        d = clinical.propose(BrokenLLM(), "me molesta la rodilla", DEMO_CTX)
        self.assertEqual((d["outcome"], d["source"], d["proposal"]["new"], d["llm_outcome"]), ("applied", "rules", 80, "rejected"))
        self.assertTrue(d["within_envelope"])
        d = clinical.propose(FakeLLM(default='{"action": "none", "reason": "x"}'), "estoy cansado", DEMO_CTX)
        self.assertEqual((d["outcome"], d["source"]), ("applied", "rules"))
        llm = FakeLLM(default='{"action":"adjust","param":"rom_target","old":90,"new":110,"reason":"x"}')
        d = clinical.propose(llm, "me molesta un poco", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["old"], d["proposal"]["new"], d["source"], d["llm_outcome"], d["llm_proposal"]["new"]),
                         ("applied", 90, 80, "rules", "escalated_to_therapist", 110))
        d = clinical.propose(DEMO_LLM, "Me dio un pinchazo en la ingle", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["new"], d["source"]), ("applied", 70, "llm"))
        d = clinical.propose(DEMO_LLM, "estoy cansado", DEMO_CTX)
        self.assertEqual((d["proposal"]["param"], d["proposal"]["new"], d["source"]), ("rest_seconds", 90, "llm"))
        d = clinical.propose(BrokenLLM(), "todo bien", DEMO_CTX)
        self.assertEqual(d["outcome"], "rejected")
        self.assertNotIn("paused", d)
        d = clinical.propose(BrokenLLM(), "me molesta", {**DEMO_CTX, "envelope": {}})
        self.assertTrue(d["paused"])
        self.assertNotEqual(d["outcome"], "applied")

    def test_turno_devuelve_el_registro_de_molestia(self):
        out = run_turn(BrokenLLM(), "me molesta la rodilla", DEMO_CTX)
        self.assertEqual(out["symptom"], {"kind": "discomfort", "category": "pain", "text": "me molesta la rodilla",
                                          "action": "demand_lowered", "adjustment": {"param": "rom_target", "old": 90, "new": 80}})
        self.assertEqual(run_turn(BrokenLLM(), "me estoy mareando", DEMO_CTX)["symptom"]["action"], "session_stopped")
        self.assertIsNone(run_turn(BrokenLLM(), "todo bien", DEMO_CTX)["symptom"])
        self.assertEqual(len(run_turn(BrokenLLM(), "me molesta " + "x" * 300, DEMO_CTX)["symptom"]["text"]), 200)
        paused = run_turn(BrokenLLM(), "me molesta", {**DEMO_CTX, "envelope": {}})
        self.assertEqual(paused["symptom"]["action"], "paused")
        self.assertIn("pausa", paused["reply"])

    def test_la_frase_de_pausa_no_trae_cifras(self):
        text = coach.template({"paused": True, "outcome": "rejected"})
        self.assertIn("pausa", text)
        self.assertEqual(coach.numbers(text), set())

    def test_applied_solo_con_within_envelope(self):
        """Regla de integridad de 03: outcome = 'applied' ⇒ within_envelope = true, para cualquier valor."""
        for new in range(0, 200, 5):
            d = safety.validate(prop("rom_target", 90, new), ENV, CUR)
            if d["outcome"] == "applied":
                self.assertTrue(d["within_envelope"])
                self.assertTrue(60 <= new <= 110)


class SlowLLM:
    def __init__(self, seconds, text='{"action":"adjust","param":"rom_target","old":90,"new":70,"reason":"x"}'):
        self.seconds, self.text, self.calls = seconds, text, []

    def chat(self, messages, **_):
        self.calls.append(messages)
        time.sleep(self.seconds)
        return {"text": self.text, "ms": round(self.seconds * 1000), "completion_tokens": None, "prompt_tokens": None}


SCREEN = {"rom_target", "reps"}          # lo que aplica index.html?plan= (ADR-033)


class TextTurnTest(unittest.TestCase):
    """Turno de texto del paciente (ADR-033): reglas primero, agente clínico con tiempo límite, siempre molestia declarada."""

    def test_parametro_que_la_pantalla_no_aplica_se_rechaza(self):
        d = safety.validate(prop("rest_seconds", 60, 90), ENV, CUR, "me molesta", allowed=SCREEN)
        self.assertEqual((d["outcome"], d["within_envelope"]), ("rejected", False))
        self.assertIn("rest_seconds", d["note"])
        self.assertEqual(safety.validate(prop("rest_seconds", 60, 90), ENV, CUR, "me molesta")["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rom_target", 90, 80), ENV, CUR, "me molesta", allowed=SCREEN)["outcome"], "applied")

    def test_molestia_declarada_cierra_la_puerta_a_subir_aunque_el_texto_no_la_nombre(self):
        env = {"rom_min": 60, "rom_max": 120, "max_reps": 10}
        up = prop("rom_target", 90, 100)
        d = safety.validate(up, env, CUR, "la rodilla no va bien", discomfort_reported=True)
        self.assertEqual((d["outcome"], d["within_envelope"]), ("escalated_to_therapist", True))
        self.assertEqual(safety.validate(up, env, CUR, "la rodilla no va bien")["outcome"], "applied")

    def test_en_el_turno_sin_valor_actual_no_se_ajusta(self):
        # El LLM no puede inventar el 'old': en el turno, un parámetro sin valor en pantalla no se toca (auditoría ADR-033).
        d = safety.validate(prop("reps", 7, 5), ENV, {"rom_target": 90}, "me molesta", allowed=SCREEN)
        self.assertEqual((d["outcome"], d["within_envelope"]), ("rejected", False))
        self.assertEqual(safety.validate(prop("reps", 7, 5), ENV, {"rom_target": 90}, "me molesta")["outcome"], "applied",
                         "fuera del turno se mantiene el comportamiento anterior")

    def test_un_turno_vencido_no_llama_despues_al_llm(self):
        import threading
        from concurrent.futures import ThreadPoolExecutor
        pool, gate = ThreadPoolExecutor(max_workers=1), threading.Event()
        pool.submit(gate.wait)                                  # el único hilo está ocupado
        clin = FakeLLM(default='{"action":"none","reason":"x"}')
        out = run_text_turn(clin, None, "la rodilla no va bien", DEMO_CTX, monitored=True, allowed=SCREEN,
                            clinical_timeout_s=0.1, executor=pool)
        gate.set()
        pool.shutdown(wait=True)
        self.assertEqual((out["ai"]["error"], out["ai"]["decided_by"]), ("timeout", "rules"))
        self.assertEqual(clin.calls, [], "la tarea vencida se cancela y no gasta cupo de Token Factory")

    def test_accion_del_registro_de_molestia(self):
        self.assertEqual(safety.symptom_action({"outcome": "applied", "proposal": prop("reps", 7, 4)}),
                         ("demand_lowered", {"param": "reps", "old": 7, "new": 4}))
        self.assertEqual(safety.symptom_action({"outcome": "rejected", "proposal": prop("reps", 7, 4)}), ("paused", None))
        self.assertEqual(safety.symptom_action({"red_flag": "me mareo", "outcome": "session_stopped"}), ("session_stopped", None))

    def test_propuesta_de_descanso_la_reemplazan_las_reglas(self):
        llm = FakeLLM(default='{"action":"adjust","param":"rest_seconds","old":60,"new":90,"reason":"x"}')
        d = clinical.propose(llm, "la rodilla no va bien", DEMO_CTX, discomfort_reported=True, allowed=SCREEN)
        self.assertEqual((d["source"], d["proposal"]["param"], d["llm_outcome"], d["outcome"]), ("rules", "rom_target", "rejected", "applied"))

    def test_propuesta_que_sube_sin_palabra_de_molestia_la_reemplazan_las_reglas(self):
        env = {**DEMO_CTX, "envelope": {"rom_min": 60, "rom_max": 120, "max_reps": 10}}
        llm = FakeLLM(default='{"action":"adjust","param":"rom_target","old":90,"new":100,"reason":"x"}')
        d = clinical.propose(llm, "la rodilla no va bien", env, discomfort_reported=True, allowed=SCREEN)
        self.assertEqual((d["source"], d["proposal"]["new"], d["outcome"], d["llm_outcome"]), ("rules", 80, "applied", "escalated_to_therapist"))

    def test_el_mensaje_al_llm_dice_que_solo_baje_y_que_parametros_puede_tocar(self):
        llm = FakeLLM(default='{"action":"none","reason":"x"}')
        clinical.propose(llm, "la rodilla no va bien", DEMO_CTX, discomfort_reported=True, allowed=SCREEN)
        content = llm.calls[0][-1]["content"]
        self.assertIn("solo puedes bajar", content)
        self.assertIn('"parametros_que_puedes_ajustar":["reps","rom_target"]', content)
        llm = FakeLLM(default='{"action":"none","reason":"x"}')
        clinical.propose(llm, "todo bien", DEMO_CTX)
        self.assertNotIn("solo puedes bajar", llm.calls[0][-1]["content"])
        self.assertNotIn("parametros_que_puedes_ajustar", llm.calls[0][-1]["content"])

    def test_alarma_no_llama_a_ningun_llm(self):
        clin, coach_llm = FakeLLM(default="{}"), FakeLLM(default="hola")
        out = run_text_turn(clin, coach_llm, "me mareo", DEMO_CTX, monitored=True, allowed=SCREEN, provider="P", model="M")
        self.assertEqual((clin.calls, coach_llm.calls), ([], []))
        self.assertEqual((out["decision"]["outcome"], out["reply"]), ("session_stopped", coach.STOP_TEXT))
        self.assertEqual((out["ai"]["skipped"], out["ai"]["decided_by"], out["ai"]["provider"]), ("red_flag", "rules", None))

    def test_llm_lento_decide_el_motor_de_reglas_sin_pasarse_del_tiempo(self):
        t0 = time.perf_counter()
        out = run_text_turn(SlowLLM(0.5), None, "la rodilla no va bien", DEMO_CTX, monitored=True, allowed=SCREEN,
                            clinical_timeout_s=0.1, provider="P", model="M")
        self.assertLess(time.perf_counter() - t0, 0.45)
        self.assertLess(out["timings_ms"]["total"], 1000)
        d = out["decision"]
        self.assertEqual((out["ai"]["decided_by"], out["ai"]["error"], out["ai"]["llm_answered"]), ("rules", "timeout", False))
        self.assertEqual((d["proposal"]["param"], d["proposal"]["old"], d["proposal"]["new"], d["outcome"], d["llm_outcome"]),
                         ("rom_target", 90, 80, "applied", "timeout"))

    def test_sin_sesion_monitoreada_no_se_consulta_al_agente_clinico(self):
        clin = FakeLLM(default='{"action":"adjust","param":"reps","old":7,"new":3,"reason":"x"}')
        out = run_text_turn(clin, None, "la rodilla no va bien", {**DEMO_CTX, "envelope": {}}, monitored=False, allowed=SCREEN)
        self.assertEqual(clin.calls, [])
        self.assertTrue(out["decision"]["paused"])
        self.assertEqual((out["reply"], out["ai"]["skipped"]), (coach.PAUSE_TEXT, "guided"))

    def test_llm_bueno_propone_y_las_reglas_validan(self):
        clin = FakeLLM(default='{"action":"adjust","param":"rom_target","old":90,"new":70,"reason":"molestia"}')
        out = run_text_turn(clin, None, "la rodilla no va bien", DEMO_CTX, monitored=True, allowed=SCREEN, provider="P", model="M")
        self.assertEqual((out["ai"]["decided_by"], out["decision"]["outcome"], out["ai"]["llm_answered"], out["ai"]["model"]),
                         ("llm", "applied", True, "M"))
        self.assertIn("70", out["reply"])
        self.assertNotIn("raw", out["decision"])
        self.assertIsNone(out["ai"]["error"])

    def test_llm_roto_decide_el_motor_de_reglas_y_lo_dice(self):
        out = run_text_turn(BrokenLLM(), None, "la rodilla no va bien", DEMO_CTX, monitored=True, allowed=SCREEN)
        self.assertEqual((out["ai"]["decided_by"], out["ai"]["error"], out["decision"]["proposal"]["new"]), ("rules", "llm_error", 80))

    def test_la_frase_sale_del_agente_conversacional_si_no_inventa_cifras(self):
        clin = FakeLLM(default='{"action":"adjust","param":"rom_target","old":90,"new":70,"reason":"x"}')
        out = run_text_turn(clin, FakeLLM(default="Tranquilo, baja hasta 70 grados."), "la rodilla no va bien", DEMO_CTX,
                            monitored=True, allowed=SCREEN, provider="P", model="M")
        self.assertEqual((out["reply_source"], out["ai"]["phrased_by"]), ("llm", "llm"))
        out = run_text_turn(clin, FakeLLM(default="Baja hasta 99 grados."), "la rodilla no va bien", DEMO_CTX,
                            monitored=True, allowed=SCREEN)
        self.assertEqual((out["reply_source"], out["ai"]["phrased_by"]), ("template", "rules"))


class TurnTimesTest(unittest.TestCase):
    """El conversacional no se come al clínico: solo entra si el clínico fue rápido (ADR-033)."""
    OK = '{"action":"adjust","param":"rom_target","old":90,"new":70,"reason":"x"}'

    def run_turn_with(self, clinical, talker, **kw):
        return run_text_turn(clinical, talker, "la rodilla no va bien", DEMO_CTX, monitored=True, allowed=SCREEN,
                             provider="P", model="M", **kw)

    def test_clinico_lento_no_pide_la_frase_al_conversacional(self):
        talker = FakeLLM(default="Baja hasta 70 grados.")
        out = self.run_turn_with(SlowLLM(0.3, self.OK), talker, coach_if_under_s=0.1)
        self.assertEqual(talker.calls, [])
        self.assertEqual((out["ai"]["phrased_by"], out["ai"]["decided_by"], out["decision"]["outcome"]), ("rules", "llm", "applied"))

    def test_clinico_rapido_si_pide_la_frase(self):
        talker = FakeLLM(default="Baja hasta 70 grados.")
        out = self.run_turn_with(FakeLLM(default=self.OK), talker, coach_if_under_s=6)
        self.assertEqual(len(talker.calls), 1)
        self.assertEqual(out["ai"]["phrased_by"], "llm")

    def test_un_presupuesto_grande_no_alarga_la_espera_del_clinico(self):
        t0 = time.perf_counter()
        out = self.run_turn_with(SlowLLM(0.5, self.OK), None, clinical_timeout_s=0.2, budget_s=10)
        self.assertLess(time.perf_counter() - t0, 0.4)
        self.assertEqual(out["ai"]["error"], "timeout")

    def test_el_presupuesto_chico_si_acorta_la_espera(self):
        t0 = time.perf_counter()
        self.run_turn_with(SlowLLM(0.5, self.OK), None, clinical_timeout_s=12, budget_s=0.2)
        self.assertLess(time.perf_counter() - t0, 0.4)

    def test_sin_clinico_en_guiados_el_conversacional_siempre_se_pide(self):
        talker = FakeLLM(default="Hacemos una pausa.")
        run_text_turn(None, talker, "la rodilla no va bien", {**DEMO_CTX, "envelope": {}}, monitored=False, allowed=SCREEN, coach_if_under_s=0.001)
        self.assertEqual(len(talker.calls), 1)


class DeterministicRulesTest(unittest.TestCase):
    """Reglas deterministas más firmes (ADR-004, ADR-021): alarmas nuevas, negación solo para la categoría, validate estricto."""
    NEW_ALARMS = ["me mareé", "tengo mareos", "me maree mucho", "me falta el aire", "me quedo sin aire", "presión en el pecho",
                  "siento opresión en el pecho", "me aprieta el pecho", "dolor de cabeza fuerte", "veo borroso", "veo doble",
                  "se me nubla la vista", "tengo palpitaciones", "el corazón me late muy rápido", "tengo taquicardia",
                  "se me tuerce la boca y tengo la cara torcida", "no puedo hablar bien", "me caí", "me caí al pararme",
                  "casi me caigo", "no me caí", "estoy sangrando", "me sangra la encía", "se me hinchó la rodilla de golpe",
                  "tengo sudor frío", "sentí un crack", "sentí un chasquido", "me duele muchísimo"]
    QUIET = ["me molesta la rodilla", "estoy cansado", "me duele un poco", "me cuesta pararme", "calambre", "la rodilla no va bien",
             "tengo la cara roja de calor", "me dio un pinchazo en la ingle", "estoy un poco cansado", "todo bien"]

    def test_alarmas_nuevas_detienen_sin_llamar_a_ningun_llm(self):
        for text in self.NEW_ALARMS:
            self.assertIsNotNone(safety.red_flag(text), text)
            clinical_llm, talker = FakeLLM(default="{}"), FakeLLM(default="hola")
            out = run_text_turn(clinical_llm, talker, text, DEMO_CTX, monitored=True, allowed=SCREEN)
            self.assertEqual((clinical_llm.calls, talker.calls), ([], []), text)
            self.assertEqual(out["decision"]["outcome"], "session_stopped", text)
            self.assertEqual(out["reply"], coach.STOP_TEXT)

    def test_lo_que_no_es_alarma_sigue_sin_detener(self):
        for text in self.QUIET:
            self.assertIsNone(safety.red_flag(text), text)

    def test_la_negacion_solo_cambia_la_categoria(self):
        cat = lambda t: safety.classify_symptom(t)["category"]
        self.assertEqual(cat("no me duele, pero estoy cansado"), "fatigue")
        self.assertEqual(cat("sin dolor"), "other")
        self.assertEqual(cat("ya no me duele"), "other")
        self.assertEqual(cat("nada de dolor"), "other")
        self.assertEqual(cat("no puedo, me duele"), "pain", "la negación no cruza la coma")
        self.assertEqual(cat("me duele la rodilla"), "pain")
        self.assertEqual(safety.classify_symptom("no me mareo")["kind"], "red_flag", "la alarma gana aun negada")
        self.assertIsNone(safety.classify_symptom("todo bien"))
        self.assertTrue(safety.discomfort("no me duele"), "la regla de no subir la exigencia sigue cerrada")
        d = safety.validate(prop("rom_target", 90, 100), {"rom_min": 60, "rom_max": 120, "max_reps": 10}, CUR, "no me duele")
        self.assertEqual(d["outcome"], "escalated_to_therapist")

    def test_validate_rechaza_repeticiones_no_enteras_y_valores_no_finitos(self):
        self.assertEqual(safety.validate(prop("reps", 7, 4.5), ENV, CUR)["outcome"], "rejected")
        self.assertEqual(safety.validate(prop("reps", 7, 4.0), ENV, CUR)["outcome"], "applied")
        self.assertEqual(safety.validate(prop("rom_target", 90, 72.5), ENV, CUR)["outcome"], "applied", "el rango sí admite decimales")
        for bad in (float("nan"), float("inf"), float("-inf"), 10 ** 400):
            d = safety.validate(prop("rom_target", 90, bad), ENV, CUR)
            self.assertEqual((d["outcome"], d["within_envelope"]), ("rejected", False), bad)
        parsed = parse_json('{"action": "adjust", "param": "rom_target", "old": 90, "new": NaN, "reason": "x"}')
        self.assertEqual(safety.validate({k: parsed[k] for k in ("param", "old", "new", "reason")}, ENV, CUR)["outcome"], "rejected")

    def test_la_frase_no_receta_ni_diagnostica(self):
        decision = {"outcome": "applied", "proposal": prop("rom_target", 90, 70)}
        said = coach.reply(FakeLLM(default="Tómate un ibuprofeno y baja hasta 70 grados."), "me molesta", decision)
        self.assertEqual(said["source"], "template")
        said = coach.reply(FakeLLM(default="Parece una tendinitis, baja hasta 70 grados."), "me molesta", decision)
        self.assertEqual(said["source"], "template")
        said = coach.reply(FakeLLM(default="Seguimos con calma, baja hasta 70 grados."), "me molesta", decision)
        self.assertEqual((said["source"], said["text"]), ("llm", "Seguimos con calma, baja hasta 70 grados."))

    def test_el_resumen_no_nombra_medicamentos_ni_diagnosticos(self):
        sug = [{"title": "Revisar el plan", "detail": "Encaja", "because": "perfil", "priority": 1}]
        bad = advisor.summarize(FakeLLM(default="Parece una tendinitis, revisa el plan."), None, sug, [])
        self.assertEqual((bad["source"], bad["text"]), ("rejected", None))
        self.assertIn("medicamentos o diagnósticos", bad["reason"])
        self.assertEqual(advisor.summarize(FakeLLM(default="Revisa primero el plan."), None, sug, [])["source"], "llm")


class SoapPrivacyTest(unittest.TestCase):
    def test_el_llm_no_ve_los_datos_personales_de_la_nota(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 5, "reps_target": 10,
                   "end_reason": "completed", "events": [], "decisions": [], "utterances": ["me llamo Ana"],
                   "symptom_reports": [{"category": "pain", "text": "mi correo es ana@x.com y me molesta", "action": "paused", "in_session": True}]}
        llm = FakeLLM(default='{"A": "Tolera bien.", "P": "Mantener."}')
        out = soap.draft(llm, session)
        sent = json.dumps(llm.calls, ensure_ascii=False)
        self.assertNotIn("Ana", sent)
        self.assertNotIn("ana@x.com", sent)
        self.assertIn("[nombre]", sent)
        self.assertIn("Ana", out["soap"]["S"], "la plantilla interna no cambia")


class NumbersTest(unittest.TestCase):
    def test_cifras_en_digitos_sin_normalizacion_rota(self):
        for text, expected in [("10", {"10"}), ("100", {"100"}), ("1", {"1"}), ("10,50", {"10.5"}), ("88.0", {"88"}), ("0", {"0"})]:
            self.assertEqual(coach.numbers(text), expected, text)
        self.assertNotEqual(coach.numbers("100"), coach.numbers("10"))

    def test_cifras_en_letras(self):
        for text, expected in [("veinte repeticiones", {"20"}), ("treinta y cinco grados", {"35"}), ("cien", {"100"}),
                               ("ciento veinte", {"120"}), ("Veintidós", {"22"}), ("una serie y un descanso", set()),
                               ("treinta y uno", {"31"}), ("dos mil", {"2000"})]:
            self.assertEqual(coach.numbers(text), expected, text)

    def test_la_frase_rechaza_cifras_de_mas(self):
        decision = {"outcome": "applied", "proposal": prop("reps", 7, 10)}
        for text, source in [("Haz 100 repeticiones más.", "template"), ("Haz veinte repeticiones más.", "template"),
                             ("Haz 10 repeticiones más, tranquilo.", "llm")]:
            self.assertEqual(coach.reply(FakeLLM(default=text), "me cuesta", decision)["source"], source, text)

    def test_soap_rechaza_cifras_en_letras_o_de_mas(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 10, "reps_target": 10,
                   "end_reason": "completed", "events": [], "rom_mean": 88.5, "decisions": [], "utterances": []}
        for a, p in [("Completó 100 repeticiones.", "Mantener."), ("Bien.", "Subir a quince repeticiones.")]:
            out = soap.draft(FakeLLM(default=json.dumps({"A": a, "P": p})), session)
            self.assertEqual(out["source"], "template", (a, p))

    def test_resumen_rechaza_cifras_inventadas(self):
        out = advisor.summarize(FakeLLM(default="Revisa las 100 repeticiones."), None, [{"title": "t", "detail": "Hizo 10 repeticiones"}], [])
        self.assertEqual(out["source"], "rejected")


class AgentsTest(unittest.TestCase):
    def test_agente_clinico_valida_lo_que_propone_el_llm(self):
        d = clinical.propose(DEMO_LLM, "Me dio un pinchazo en la ingle", DEMO_CTX)
        self.assertEqual((d["outcome"], d["proposal"]["new"]), ("applied", 70))
        d = clinical.propose(DEMO_LLM, "quiero ir más rápido", DEMO_CTX)
        self.assertEqual(d["outcome"], "escalated_to_therapist", "el LLM pide 130°, fuera del sobre")

    def test_respuesta_rota_o_sin_llm_no_cambia_nada(self):
        for llm in [FakeLLM(default="no sé"), FakeLLM(default='{"action": "borrar"}'), BrokenLLM()]:
            d = clinical.propose(llm, "algo", DEMO_CTX)
            self.assertEqual(d["outcome"], "rejected")
            self.assertIsNone(d["proposal"])

    def test_json_entre_texto(self):
        self.assertEqual(parse_json('Claro:\n```json\n{"action": "none"}\n```'), {"action": "none"})
        self.assertIsNone(parse_json("[1, 2]"))

    def test_la_frase_no_inventa_numeros(self):
        decision = {"outcome": "applied", "proposal": prop("rom_target", 90, 70)}
        good = coach.reply(FakeLLM(default="Tranquilo, ahora baja solo hasta 70 grados."), "pinchazo", decision)
        self.assertEqual(good["source"], "llm")
        bad = coach.reply(FakeLLM(default="Baja hasta 45 grados y haz 20 repeticiones."), "pinchazo", decision)
        self.assertEqual((bad["source"], bad["text"]), ("template", coach.template(decision)))
        json_reply = coach.reply(FakeLLM(default='{"action": "none"}'), "pinchazo", decision)
        self.assertEqual(json_reply["source"], "template")

    def test_alarma_detiene_sin_consultar_al_llm(self):
        llm = FakeLLM(default='{"action": "none", "reason": "x"}')
        out = run_turn(llm, "me estoy mareando mucho", DEMO_CTX)
        self.assertEqual(out["decision"]["outcome"], "session_stopped")
        self.assertEqual(out["decision"]["end_reason"], "pain_stop")
        self.assertEqual(llm.calls, [], "I-7: el agente no intenta resolverlo")
        self.assertEqual(out["reply"], coach.STOP_TEXT)

    def test_turno_completo_con_el_llm_de_mentira(self):
        out = run_turn(DEMO_LLM, "Me dio un pinchazo en la ingle", DEMO_CTX)
        self.assertEqual(out["decision"]["outcome"], "applied")
        self.assertIn("70 grados", out["reply"])

    def test_soap_sin_meta_no_escribe_none(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 4, "reps_target": None,
                   "end_reason": "completed", "events": [], "decisions": [], "utterances": []}
        o = soap.draft(None, session)["soap"]["O"]
        self.assertIn("4 repeticiones", o)
        self.assertNotIn("None", o)

    def test_soap_es_borrador_y_no_inventa_cifras(self):
        session = {"exercise_name": "Sentarse y pararse", "ended_at": "2026-10-15T10:00:00Z", "reps_done": 10, "reps_target": 10,
                   "end_reason": "completed", "events": [{"type": "trunk_flexion"}, {"type": "knee_valgus"}], "rom_mean": 88.5,
                   "decisions": [{"outcome": "applied", "proposal": prop("rom_target", 90, 70)}],
                   "utterances": ["Me dio un pinchazo en la ingle"]}
        ok = soap.draft(FakeLLM(default='{"A": "Tolera el ejercicio con compensaciones leves.", "P": "Mantener 10 repeticiones."}'), session)
        self.assertEqual((ok["status"], ok["reviewed_by"], ok["source"]), ("draft", None, "llm"))
        self.assertIn("10 de 10", ok["soap"]["O"])
        invented = soap.draft(FakeLLM(default='{"A": "Mejoró un 35 %.", "P": "Subir a 15 repeticiones."}'), session)
        self.assertEqual(invented["source"], "template", "35 y 15 no están en los datos: I-6")
        self.assertEqual(soap.draft(None, session)["source"], "template")


class EnglishReplyTest(unittest.TestCase):
    """La frase del turno sale en el idioma de la interfaz (I-22, ADR-032) y sin cifras ni medicinas inventadas."""
    DECISION = {"outcome": "applied", "proposal": prop("rom_target", 90, 70)}
    TR = staticmethod(lambda s: "Understood. So it does not bother you, only go down to 70 degrees. If the pain increases, tap Pain and we stop."
                      if "70" in s else s)

    def test_cifra_en_letras_en_ingles_vuelve_a_la_plantilla(self):
        said = coach.reply(FakeLLM(default="Only go down to seventy degrees."), "my knee hurts", self.DECISION, lang="en", translate=self.TR)
        self.assertEqual(said["source"], "template")
        self.assertTrue(said["text"].startswith("Understood."))

    def test_frase_en_ingles_con_la_cifra_correcta_pasa(self):
        llm = FakeLLM(default="Okay, only go down to 70 degrees.")
        said = coach.reply(llm, "my knee hurts", self.DECISION, lang="en", translate=self.TR)
        self.assertEqual((said["source"], said["text"]), ("llm", "Okay, only go down to 70 degrees."))
        self.assertIn("inglés", llm.calls[0][0]["content"])

    def test_frase_en_otro_idioma_vuelve_a_la_plantilla(self):
        # Con la interfaz en inglés, una frase del LLM en español no llega al paciente, y al revés (I-22).
        said = coach.reply(FakeLLM(default="Entendido, bajamos un poco la exigencia. Si duele más, toca Dolor y paramos."),
                           "my knee hurts", self.DECISION, lang="en", translate=self.TR)
        self.assertEqual(said["source"], "template")
        self.assertTrue(said["text"].startswith("Understood."))
        said = coach.reply(FakeLLM(default="Okay, let's only go down to 70 degrees and rest if you need it."),
                           "me duele la rodilla", self.DECISION, lang="es")
        self.assertEqual(said["source"], "template")
        said = coach.reply(FakeLLM(default="Entendido: baja solo hasta 70 grados y avísame si duele."),
                           "me duele la rodilla", self.DECISION, lang="es")
        self.assertEqual(said["source"], "llm")

    def test_vetos_de_medicinas_y_diagnosticos_en_ingles(self):
        said = coach.reply(FakeLLM(default="Take an ibuprofen and only go down to 70 degrees."), "my knee hurts", self.DECISION,
                           lang="en", translate=self.TR)
        self.assertEqual(said["source"], "template")
        bad = advisor.summarize(FakeLLM(default="It looks like tendonitis."), None,
                                [{"title": "Review the plan", "detail": "Fits", "because": "profile", "priority": 1}], [], "en")
        self.assertEqual((bad["source"], bad["text"]), ("rejected", None))

    def test_turno_en_ingles_sin_llm_responde_en_ingles(self):
        out = run_text_turn(None, None, "my knee hurts", DEMO_CTX, monitored=True, allowed=SCREEN, lang="en", translate=lambda s: "EN " + s)
        self.assertTrue(out["reply"].startswith("EN "), out["reply"])
        stop = run_text_turn(FakeLLM(default="{}"), FakeLLM(default="hi"), "I feel dizzy", DEMO_CTX, monitored=True, allowed=SCREEN,
                             lang="en", translate=lambda s: "We are stopping the session.")
        self.assertEqual((stop["decision"]["outcome"], stop["reply"]), ("session_stopped", "We are stopping the session."))


if __name__ == "__main__":
    unittest.main()
