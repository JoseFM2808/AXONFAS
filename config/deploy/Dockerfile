# AXONFAS · servidor completo (web + API de Staging + canal en vivo) para la nube de AMD (ADR-020).
# Construir desde la raíz del repo:  docker build -f config/deploy/Dockerfile -t axonfas .
# Solo biblioteca estándar de Python: no hay pip install. La base SQLite vive en el volumen /data.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AXONFAS_DB=/data/staging.sqlite3 \
    PORT=8091

WORKDIR /app
COPY src/backend /app/src/backend
COPY src/agents /app/src/agents
COPY src/frontend/validation-prototype /app/src/frontend/validation-prototype
COPY docs/design-system /app/docs/design-system

RUN useradd --system --uid 10001 --home /data axonfas && mkdir -p /data && chown axonfas /data
USER axonfas
VOLUME ["/data"]
EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/api/auth/config', timeout=4)"

CMD ["python", "src/frontend/validation-prototype/serve.py", "--cloud"]
