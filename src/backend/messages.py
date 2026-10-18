"""AXONFAS · idioma de lo que escribe el servidor (ADR-030, TD-116). Solo biblioteca estándar y sin estado.

La interfaz sale en español o inglés (i18n.js) y `api-client.js` manda ese idioma en `Accept-Language`. El servidor
redacta en ese idioma la nota SOAP (agents/soap.py), el texto de FHIR (fhir.py) y los mensajes de esta tabla: los errores
de la API (`data.error`), los motivos cuando no hay IA y los de un resumen con IA rechazado. Sin cabecera (curl, tests
viejos) o con un idioma que no tenemos, español: es el idioma base del proyecto.

El código sigue escribiendo los mensajes en español (con f-strings donde hace falta) y `tr` los traduce a la salida:
cada clave de `EN` es la plantilla española, con `{nombre}` donde va un dato variable. Un dato que a su vez es un
mensaje conocido (el motivo de Google, el de la IA) también se traduce. Un mensaje que no está en la tabla sale tal cual:
`tests/backend/test_server_lang.py` revisa que todo `ApiError` de `staging_api.py` tenga su traducción.
"""
from __future__ import annotations

import re

LANGS = ("es", "en")
BASE = "es"


def lang_of(value: str | None) -> str:
    """Idioma de una cabecera `Accept-Language` ('en', 'en-US,en;q=0.9', 'es-PE'…): el primero que tengamos según su
    peso `q`; si no hay ninguno, español."""
    tags = []
    for i, part in enumerate((value or "").split(",")):
        bits = part.strip().split(";")
        tag = bits[0].strip().lower().split("-")[0].split("_")[0]
        q = 1.0
        for b in bits[1:]:
            b = b.strip()
            if b.startswith("q="):
                try:
                    q = float(b[2:])
                except ValueError:
                    q = 0.0
        if tag and q > 0:
            tags.append((-q, i, tag))
    for _, _, tag in sorted(tags):
        if tag in LANGS:
            return tag
    return BASE


EN = {
    # ---------------------------------------------------------------- cuerpo, rutas y cuentas
    "El cuerpo de la petición es demasiado grande.": "The request body is too large.",
    "Se esperaba un objeto JSON.": "A JSON object was expected.",
    "JSON inválido.": "Invalid JSON.",
    "Método no permitido.": "Method not allowed.",
    "No existe esa ruta.": "That route does not exist.",
    "Error interno de la base de Staging.": "Internal error in the Staging database.",
    "Falta el token. Vuelve a entrar.": "The token is missing. Log in again.",
    "El token no es válido. Vuelve a entrar.": "The token is not valid. Log in again.",
    "Para esto necesitas una cuenta: crea la tuya o entra con Google.":
        "You need an account for this: create yours or sign in with Google.",
    "Esta acción no corresponde a tu tipo de cuenta.": "This action does not match your account type.",
    "Las cuentas de demostración están apagadas en este servidor: entra con Google.":
        "Demo accounts are turned off on this server: sign in with Google.",
    "Falta el token de Google.": "The Google token is missing.",
    "No se pudo verificar el inicio de sesión con Google: {err}": "The Google sign-in could not be verified: {err}",
    "Esta cuenta está desactivada. Habla con el equipo de AXONFAS.": "This account is disabled. Contact the AXONFAS team.",
    "Cuenta no disponible.": "Account not available.",
    "Esta cuenta ya tiene un rol.": "This account already has a role.",
    "Elige 'therapist' o 'patient'.": "Choose 'therapist' or 'patient'.",
    "No puedes cambiar tu propia cuenta de Administrador.": "You cannot change your own Administrator account.",
    "No existe esa cuenta.": "That account does not exist.",
    "El rol de Administrador se maneja con AXONFAS_ADMIN_EMAILS.": "The Administrator role is managed with AXONFAS_ADMIN_EMAILS.",
    "'disabled' debe ser true o false.": "'disabled' must be true or false.",
    "Desde aquí solo se puede dejar 'pending' o 'therapist'; un paciente se afilia con su código.":
        "From here you can only set 'pending' or 'therapist'; a patient joins with their code.",
    "Los invitados ya usaron la IA muchas veces en la última hora. Prueba más tarde o crea tu cuenta.":
        "Guests have used the AI many times in the last hour. Try again later or create your account.",
    # motivos del muro (staging_api.WALL_REASONS): completan "Para {reason} hace falta una cuenta" / "To {reason} you need…"
    "afiliar a un paciente": "add a patient",
    "cambiar un plan": "change a plan",
    "generar un código de afiliación": "generate a join code",
    "señalarle un ejercicio al paciente": "point out an exercise to the patient",
    "cambiar el perfil del paciente": "change the patient's profile",
    "crear o firmar una nota SOAP": "create or sign a SOAP note",
    "guardar tu progreso": "save your progress",
    "guardar cambios": "save changes",
    # ---------------------------------------------------------------- validación de campos
    "Falta '{key}'.": "'{key}' is missing.",
    "'{key}' debe ser texto de hasta {max_len} caracteres.": "'{key}' must be text of up to {max_len} characters.",
    "'{key}' de un evento debe ser un número.": "An event's '{key}' must be a number.",
    "'{key}' debe ser un número entre {lo} y {hi}.": "'{key}' must be a number between {lo} and {hi}.",
    "'limitations' y 'pain_areas' deben ser listas.": "'limitations' and 'pain_areas' must be lists.",
    "Opciones de perfil desconocidas: {options}.": "Unknown profile options: {options}.",
    "'note' debe ser texto.": "'note' must be text.",
    # ---------------------------------------------------------------- pacientes, plan y sesiones
    "No existe ese paciente en tu lista.": "That patient is not on your list.",
    "No existe esa sesión en tu lista.": "That session is not on your list.",
    "No existe esa sesión.": "That session does not exist.",
    "'exercises' debe ser una lista de hasta 20 ejercicios.": "'exercises' must be a list of up to 20 exercises.",
    "Cada ejercicio debe ser un objeto.": "Each exercise must be an object.",
    "El ejercicio '{ex_id}' no está en el catálogo.": "The exercise '{ex_id}' is not in the catalog.",
    "El ejercicio '{ex_id}' está repetido.": "The exercise '{ex_id}' is repeated.",
    "Indica rom_min y rom_max juntos.": "Give rom_min and rom_max together.",
    "rom_min debe ser menor que rom_max.": "rom_min must be less than rom_max.",
    "El descanso mínimo no puede ser mayor que el máximo.": "The minimum rest cannot be greater than the maximum.",
    "Sentarse y pararse usa el sobre de seguridad (rom_min y rom_max), no una meta de recorrido.":
        "Sit-to-stand uses the safety envelope (rom_min and rom_max), not a range goal.",
    "La cámara no mide el recorrido de ese ejercicio: no lleva meta de recorrido.":
        "The camera does not measure the range of that exercise: it takes no range goal.",
    "'range_goal' debe ser un objeto {target, limit}.": "'range_goal' must be an object {target, limit}.",
    "'range_goal.{key}' debe ser un número entre {lo} y {hi} {unit}.": "'range_goal.{key}' must be a number between {lo} and {hi} {unit}.",
    "El límite tiene que ir más allá de la meta, en el sentido del ejercicio.":
        "The limit has to go beyond the goal, in the direction of the exercise.",
    "Todavía no hay nota SOAP para esta sesión.": "There is no SOAP note for this session yet.",
    "Todavía no hay borrador para esta sesión.": "There is no draft for this session yet.",
    "La nota ya está firmada.": "The note is already signed.",
    "Ese ejercicio no está en el catálogo.": "That exercise is not in the catalog.",
    "Indica un músculo o un ejercicio para señalar.": "Give a muscle or an exercise to highlight.",
    "Para continuar hay que aceptar el consentimiento.": "To continue you have to accept the consent.",
    "Ese código no existe o ya se usó. Pídele uno nuevo a tu fisioterapeuta.":
        "That code does not exist or was already used. Ask your physiotherapist for a new one.",
    "'mode' no corresponde a ese ejercicio.": "'mode' does not match that exercise.",
    "'source' debe ser camera, demo o guided.": "'source' must be camera, demo or guided.",
    "'source' debe ser demo o camera.": "'source' must be demo or camera.",
    "'end_reason' no es válido.": "'end_reason' is not valid.",
    "Fechas inválidas: usa ISO 8601.": "Invalid dates: use ISO 8601.",
    "La sesión termina antes de empezar.": "The session ends before it starts.",
    "Una sesión sin cámara no lleva métricas cinemáticas ni eventos.":
        "A session without a camera carries no kinematic metrics or events.",
    "'reps' o 'events' tienen un formato inválido.": "'reps' or 'events' have an invalid format.",
    "'symptom_report_ids' debe ser una lista de hasta 20 números.": "'symptom_report_ids' must be a list of up to 20 numbers.",
    "Un evento tiene un tipo inválido.": "An event has an invalid type.",
    "Sin consentimiento no se registran sesiones.": "Without consent, sessions are not recorded.",
    "Ese ejercicio no está en tu plan.": "That exercise is not in your plan.",
    "'score' debe ser un número entero de 0 a 10.": "'score' must be a whole number from 0 to 10.",
    "Ya marcaste el dolor de esta sesión.": "You already rated the pain for this session.",
    "Esa opción no existe.": "That option does not exist.",
    "Cuéntanos qué sientes: elige una opción o escribe una frase.": "Tell us how you feel: pick an option or write a sentence.",
    "Sin consentimiento no se registran molestias.": "Without consent, discomfort reports are not recorded.",
    "La demo pública es solo de sentarse y pararse.": "The public demo is sit-to-stand only.",
    "Demasiadas demos en la última hora. Intenta más tarde.": "Too many demos in the last hour. Try again later.",
    # ---------------------------------------------------------------- organizaciones (Nivel 3, organizations.py)
    "No existe esa organización.": "That organization does not exist.",
    "Clínica pequeña": "Small clinic",                                   # organizations.PLANS (etiqueta del plan)
    "Red hospitalaria": "Hospital network",
    "Ese correo es de un Administrador maestro; usa otro para la organización.":
        "That email belongs to a master Administrator; use another one for the organization.",
    "Ese correo ya administra otra organización.": "That email already manages another organization.",
    "Ese profesional ya tiene una licencia activa en otra organización.":
        "That professional already has an active license in another organization.",
    "No existe esa licencia.": "That license does not exist.",
    "Falta el nombre de la organización.": "The organization name is missing.",
    "El nombre admite hasta {n} caracteres.": "The name allows up to {n} characters.",
    "Plan desconocido. Opciones: {plans}.": "Unknown plan. Options: {plans}.",
    "Correo inválido.": "Invalid email.",
    "Configuración de historia clínica inválida.": "Invalid health record configuration.",
    "No se guardan credenciales de la historia clínica aquí.": "Health record credentials are not stored here.",
    "`enabled` tiene que ser verdadero o falso.": "`enabled` has to be true or false.",
    "Para activar la conexión hace falta la dirección FHIR.": "The FHIR address is required to turn on the connection.",
    "Dirección FHIR inválida.": "Invalid FHIR address.",
    "La dirección FHIR tiene que ser https://.": "The FHIR address has to be https://.",
    "La dirección FHIR no lleva usuario, clave, consulta ni fragmento.":
        "The FHIR address carries no user, password, query or fragment.",
    "Ese profesional ya tiene una licencia activa.": "That professional already has an active license.",
    "No quedan licencias libres en el plan. Libera una o cambia de plan.":
        "There are no free licenses left in the plan. Free one or change plans.",
    # ---------------------------------------------------------------- IA de AMD (ADR-017, ADR-018)
    "Sin proveedor de IA: configura AMD Token Factory (AMD_TOKENFACTORY_BASE_URL y AMD_TOKENFACTORY_API_KEY).":
        "No AI provider: configure AMD Token Factory (AMD_TOKENFACTORY_BASE_URL and AMD_TOKENFACTORY_API_KEY).",
    "El modelo de AMD no respondió: {err}": "The AMD model did not respond: {err}",
    "La IA no está conectada: falta configurar AMD Token Factory en el servidor.":
        "The AI is not connected: AMD Token Factory still has to be configured on the server.",
    "'suggestions' debe ser una lista de 1 a 20 sugerencias.": "'suggestions' must be a list of 1 to 20 suggestions.",
    "sin proveedor de IA configurado": "no AI provider configured",
    "sin proveedor: faltan {missing}": "no provider: missing {missing}",
    "el modelo {model} no está en el catálogo": "the model {model} is not in the catalog",
    "el catálogo no devolvió modelos: define AMD_TOKENFACTORY_MODEL": "the catalog returned no models: set AMD_TOKENFACTORY_MODEL",
    "el LLM respondió {code}: {reason}": "the LLM answered {code}: {reason}",
    "el LLM no respondió: {err}": "the LLM did not respond: {err}",
    "respuesta del LLM sin contenido": "LLM response without content",
    "el catálogo respondió {code}: {reason}": "the catalog answered {code}: {reason}",
    "sin respuesta del catálogo: {err}": "no answer from the catalog: {err}",
    "el resumen está vacío o es demasiado largo": "the summary is empty or too long",
    "el resumen trae cifras que no están en los datos": "the summary has figures that are not in the data",
    "el resumen nombra ejercicios que no están en el plan ni en las sugerencias":
        "the summary names exercises that are neither in the plan nor in the suggestions",
    # ---------------------------------------------------------------- turno de texto con el agente clínico (ADR-033)
    "El turno es solo durante una sesión: usa «Tengo una molestia».": "The turn is only during a session: use «I have discomfort».",
    "Falta un ejercicio del catálogo.": "An exercise from the catalog is missing.",
    "'voice_turn_ids' debe ser una lista de hasta 20 números.": "'voice_turn_ids' must be a list of up to 20 numbers.",
    "el resumen nombra medicamentos o diagnósticos": "the summary names medications or diagnoses",
    "dentro del sobre [{lo}, {hi}]": "within the envelope [{lo}, {hi}]",
    "fuera del sobre [{lo}, {hi}]: se pausa el ejercicio y lo revisa el fisioterapeuta":
        "outside the envelope [{lo}, {hi}]: the exercise is paused and the physiotherapist reviews it",
    "tras una molestia solo se baja la exigencia (ADR-021): lo revisa el fisioterapeuta":
        "after discomfort only the demand is lowered (ADR-021): the physiotherapist reviews it",
    "esta pantalla no puede aplicar {param}: no se cambia": "this screen cannot apply {param}: nothing changes",
    "no hay valor actual de {param} en pantalla: no se cambia": "there is no current value of {param} on screen: nothing changes",
    "el valor nuevo no es un número válido": "the new value is not a valid number",
    "las repeticiones deben ser un número entero": "repetitions must be a whole number",
    "la IA no respondió a tiempo": "the AI did not answer in time",
    "la IA falló": "the AI failed",
    "sin IA: decide el motor de reglas": "no AI: the rules engine decides",
    "ejercicio sin sobre de seguridad": "exercise without a safety envelope",
    # ---------------------------------------------------------------- mensajes al paciente (EVA y molestias, ADR-021/025)
    # Seguridad: dicen lo mismo y con la misma fuerza que el español. "Dolor" es el botón 🛑 (en inglés, "Pain: stop").
    "Es un dolor alto: no repitas el ejercicio hoy y avísale a tu fisioterapeuta. Si es un dolor fuerte, te mareas o "
    "pierdes fuerza, busca atención.":
        "That is high pain: do not repeat the exercise today and tell your physiotherapist. If the pain is severe, you feel "
        "dizzy or you lose strength, seek medical care.",
    "Gracias: tu fisioterapeuta verá cómo terminaste.": "Thank you: your physiotherapist will see how you finished.",
    "Gracias: se lo avisamos a tu fisioterapeuta. Si empeora, no hagas el ejercicio y consúltale.":
        "Thank you: we let your physiotherapist know. If it gets worse, do not do the exercise and consult them.",
    "Detenemos la sesión. Si el malestar sigue, contacta a tu fisioterapeuta.":
        "We are stopping the session. If the discomfort continues, contact your physiotherapist.",
    "Hacemos una pausa y se lo avisamos a tu fisioterapeuta. Descansa; si empeora, toca Dolor y paramos.":
        "We are taking a pause and letting your physiotherapist know. Rest; if it gets worse, tap Pain and we stop.",
    "Entendido. Para que no moleste, {what}. Si el dolor aumenta, toca Dolor y paramos.":
        "Understood. So it does not bother you, {what}. If the pain increases, tap Pain and we stop.",
    "baja solo hasta {new} grados": "only go down to {new} degrees",
    "hagamos {new} repeticiones más": "let's do {new} more repetitions",
    "descansa {new} segundos entre series": "rest {new} seconds between sets",
    "ajustamos tu sesión": "we adjust your session",
    # ---------------------------------------------------------------- Google (google_auth.py)
    "no se pudieron leer las claves de Google: {err}": "Google's keys could not be read: {err}",
    "el token está firmado con una clave que Google no publica": "the token is signed with a key Google does not publish",
    "falta GOOGLE_CLIENT_ID en el servidor": "GOOGLE_CLIENT_ID is missing on the server",
    "el token no tiene forma de JWT": "the token is not shaped like a JWT",
    "el token está dañado": "the token is damaged",
    "algoritmo de firma no permitido": "signature algorithm not allowed",
    "la firma del token no es válida": "the token signature is not valid",
    "el token no lo emitió Google": "the token was not issued by Google",
    "el token es para otra aplicación": "the token is for another application",
    "el token venció: vuelve a iniciar sesión": "the token expired: sign in again",
    "el token tiene una fecha futura": "the token has a future date",
    "el token no identifica a la cuenta": "the token does not identify the account",
    "la cuenta de Google no tiene un correo verificado": "the Google account has no verified email",
}

_FIELD = re.compile(r"\{(\w+)\}")


def _pattern(template: str) -> re.Pattern:
    out, last = [], 0
    for m in _FIELD.finditer(template):
        out.append(re.escape(template[last:m.start()]))
        out.append(f"(?P<{m.group(1)}>.+?)")
        last = m.end()
    out.append(re.escape(template[last:]))
    return re.compile("".join(out), re.S)


# Plantillas con datos variables, de la más larga a la más corta (la más específica gana).
_PATTERNS = sorted(((_pattern(es), en) for es, en in EN.items() if _FIELD.search(es)), key=lambda p: -len(p[0].pattern))


def tr(text, lang: str | None) -> str:
    """El mensaje `text` (escrito en español) en `lang`. Sin traducción conocida, sale igual."""
    if not isinstance(text, str) or lang not in LANGS or lang == BASE:
        return text
    if text in EN:
        return EN[text]
    for pattern, en in _PATTERNS:
        m = pattern.fullmatch(text)
        if m:
            return _FIELD.sub(lambda f: tr(m.group(f.group(1)), lang), en)
    return text
