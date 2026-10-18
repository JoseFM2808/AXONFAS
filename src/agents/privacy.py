"""AXONFAS · filtro determinista de datos personales antes de cualquier LLM (ADR-026, I-19).

El texto libre del paciente (o del perfil) puede traer un correo, un teléfono, un documento, una dirección o su nombre.
Antes de llegar al agente clínico, al conversacional, al resumen o a la nota SOAP, `redact()` los cambia por marcadores
([correo], [enlace], [teléfono], [documento], [dirección], [nombre]). Es solo biblioteca estándar y no usa un LLM.

Orden: las reglas de seguridad (alarma y clasificación) leen el texto ORIGINAL; el filtro corre después y lo que se
guarda y se envía es el texto filtrado. Un falso positivo solo oculta texto: nunca decide nada. No detecta nombres sin
disparador ("me llamo", "mi nombre es", "soy <Nombre>") ni datos escritos con letras (TD-117).
"""
from __future__ import annotations

import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"https?://\S+|www\.\S+", re.I)
# Documento con su disparador (DNI 45678912, pasaporte AB123456): exige al menos un dígito para no tragarse palabras.
DOCUMENT = re.compile(r"\b(?:dni|ruc|ce|pasaporte|documento|carn[eé]t?)\s*(?:n[°º.]?\s*)?(?=[\w-]*\d)[\w-]{5,}\b", re.I)
# Dígitos sueltos o separados por espacios o guiones (+51 987 654 321): se decide abajo si es teléfono o documento.
DIGITS = re.compile(r"(?<![\w])\+?\d[\d\s-]{5,}\d(?!\d)")
LONG_NUMBER = re.compile(r"(?<!\d)\d{6,}(?!\d)")
ADDRESS = re.compile(r"\b(?:calle|av\.?|avenida|jr\.?|jir[oó]n|psje\.?|pasaje|mz\.?|manzana|lote|lt\.?|urb\.?|urbanizaci[oó]n|"
                     r"direcci[oó]n)\s+[^\d,.;]{1,40}?\d{1,5}\b"
                     # Un número seguido de una unidad del ejercicio no es el de una dirección ("la calle me caí 2 veces").
                     r"(?!\s*(?:veces|vez|series?|repeticiones|reps|grados|°|minutos?|min\b|segundos?|seg\b|d[ií]as?|semanas?|"
                     r"meses|horas?|ejercicios?|kilos?|kg\b|pasos|metros|cuadras?|cm\b|%))", re.I)
# Fechas (18-10-2026, 18 10 2026): dato clínico ("desde el..."), no un teléfono.
DATE = re.compile(r"\d{1,2}[\s-]\d{1,2}[\s-](?:\d{2}|\d{4})")
NAME_TRIGGER = re.compile(r"\b(me llamo|mi nombre es|mi apellido es)\s+(\w+)(\s+\w+)?(\s+\w+)?", re.I)
SOY_NAME = re.compile(r"\b([Ss]oy)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?")
# Palabras que cortan un nombre: "me llamo Ana y me mareo" oculta solo "Ana".
STOP = {"y", "e", "o", "u", "que", "pero", "me", "mi", "tengo", "estoy", "porque", "con", "de", "la", "el", "los", "las", "un",
        "una", "no", "si", "se", "es", "soy", "siento", "tambien", "también", "ya", "desde", "cuando", "hoy", "ayer", "en", "al",
        "del", "por", "para", "pero", "aunque", "mientras", "como", "le", "lo", "te", "mucho", "muy", "poco", "algo"}


def redact(text: str) -> tuple[str, int]:
    """(texto con marcadores, cuántos datos se ocultaron). Las cifras de 1 a 4 dígitos ("90 grados", "8 de 10") no se tocan."""
    if not text:
        return text or "", 0
    count = 0

    def sub(pattern, marker, s):
        nonlocal count
        s, n = pattern.subn(marker, s)
        count += n
        return s

    def digits(m):
        nonlocal count
        raw = m.group(0)
        n_digits = sum(c.isdigit() for c in raw)
        if n_digits < 7 or DATE.fullmatch(raw.strip()):
            return raw
        groups = re.findall(r"\d+", raw)
        # Varios números chicos seguidos ("90 100 110 120", "10 10 10 10") son grados o repeticiones, no un teléfono.
        if "+" not in raw and len(groups) > 1 and all(int(g) <= 200 for g in groups):
            return raw
        count += 1
        # Con separadores, signo + o 9 dígitos seguidos (celular de 9 cifras) es un teléfono; si no, un número largo.
        phone = "+" in raw or re.search(r"[\s-]", raw.strip()) or n_digits == 9
        return "[teléfono]" if phone else "[documento]"

    def keeps(word: str) -> bool:
        """Palabra que corta el nombre: de enlace, o de una molestia o alarma (no se borra información clínica)."""
        from .safety import classify_symptom               # sin ciclo: safety no importa este módulo
        w = word.strip()
        return w.lower() in STOP or classify_symptom(w) is not None

    def name(m):
        nonlocal count
        if keeps(m.group(2)):                                # "me llamo la atención": no hay nombre que ocultar
            return m.group(0)
        count += 1
        second, third = m.group(3) or "", m.group(4) or ""
        if second and keeps(second):                         # "Ana y me mareo": el nombre termina antes de la palabra de corte
            keep = second + third
        elif third and keeps(third):                         # "Ana María y": nombre y apellido, hasta la palabra de corte
            keep = third
        else:                                                # hasta tres palabras: nombre, segundo nombre y apellido
            keep = ""
        return f"{m.group(1)} [nombre]{keep}"

    def soy(m):
        nonlocal count
        count += 1
        return f"{m.group(1)} [nombre]"

    text = sub(EMAIL, "[correo]", text)
    text = sub(URL, "[enlace]", text)
    text = sub(DOCUMENT, "[documento]", text)
    text = DIGITS.sub(digits, text)
    text = sub(LONG_NUMBER, "[documento]", text)
    text = sub(ADDRESS, "[dirección]", text)
    text = NAME_TRIGGER.sub(name, text)
    text = SOY_NAME.sub(soy, text)
    return text, count
