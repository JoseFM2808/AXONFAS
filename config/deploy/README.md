# Despliegue de AXONFAS (ADR-018, ADR-019, ADR-020)

Hay dos formas de publicarlo. Las dos usan solo infraestructura de AMD para la IA (Token Factory):

| Forma | Qué corre dónde | Cuándo |
|---|---|---|
| **A · Todo en la nube de AMD** (recomendada) | Web, API, canal en vivo y base en un droplet pequeño, con HTTPS de Caddy | Una sola URL para los jueces |
| **B · Web en Vercel + API en AMD** | La web estática en Vercel; la API en el droplet de la forma A | Para usar el dominio y la CDN de Vercel |

Todo dato es de prueba (ADR-010). Ningún secreto entra al repo: van en `~/.axonfas/axonfas.env` (tu PC),
`config/.env.web` (el droplet, que git ignora) o las variables del proyecto en Vercel.

## 1 · Credenciales (una sola vez)

1. **AMD Token Factory** (https://notebooks.amd.com/tokenfactory): inicia sesión con tu cuenta del AMD AI Developer
   Program y copia tres datos:
   - la URL base de la API, que según el manual («User Manual») es `https://developer.amd.com.cn/radeon/api/v1`: va
     en `AMD_TOKENFACTORY_BASE_URL`;
   - la clave del equipo (`rc-…`, se muestra cuando todos la canjearon): va en `AMD_TOKENFACTORY_API_KEY`. Los límites
     son por clave y el equipo la comparte; ante un 429 el cliente espera y reintenta dos veces;
   - el id de un modelo del catálogo: va en `AMD_TOKENFACTORY_MODEL`. Sugerido: `DeepSeek-V4-Flash`, que no "piensa"
     por defecto y acepta el modo JSON. Si lo dejas vacío, se usa el primer modelo de chat (nunca el de OCR).
2. **Google** (https://console.cloud.google.com → APIs y servicios → Credenciales):
   - Configura la pantalla de consentimiento (tipo «Externo», en modo de prueba) y agrega como usuarios de prueba a tu
     equipo y a quien vaya a evaluar.
   - Crea un ID de cliente OAuth de tipo **«Aplicación web»**. En **Orígenes de JavaScript autorizados** agrega:
     - `http://localhost:8091` (tu PC);
     - `https://<ip-con-guiones>.sslip.io` o tu dominio (forma A);
     - `https://<tu-proyecto>.vercel.app` (forma B).
   - Copia el **ID de cliente** en `GOOGLE_CLIENT_ID`. Es público; el client secret no se usa.
3. **Administrador maestro:** los correos de Google del equipo, separados por comas, en `AXONFAS_ADMIN_EMAILS`.

Copia `config/.env.web.example` a `~/.axonfas/axonfas.env` y complétalo. Con eso ya funciona en tu PC:

```bash
py src/frontend/validation-prototype/serve.py --local-only
```

Abre `http://localhost:8091/login.html`. Si tu correo está en la lista, entras como Administrador en `admin.html`, y
ahí "Probar el modelo" confirma que Token Factory responde.

## 2 · Forma A: todo en la nube de AMD

Requisitos: `doctl` con un token de escritura en el contexto `amd-write` y la llave `~/.ssh/axonfas_amd` (ver
`src/backend/README.md`). Crear el droplet cuesta unos USD 0,009 por hora hasta destruirlo.

```bash
.\src\backend\cloud\axonfas-cloud.ps1 web-up -Yes
```

Espera 2–3 minutos (cloud-init instala Docker y clona el repo) y agrega a los orígenes de Google el dominio que
imprime (`https://<ip>.sslip.io`). Después:

```bash
.\src\backend\cloud\axonfas-cloud.ps1 web-deploy
```

`web-deploy` hace cuatro cosas:
1. Copia tu `~/.axonfas/axonfas.env` como `config/.env.web` en el droplet, con permisos 600, y le agrega el dominio
   sslip si no pusiste uno.
2. Actualiza el código.
3. Levanta Docker Compose: la API más Caddy con HTTPS.
4. Prueba `https://<dominio>/api/auth/config`.

Para el público, pon `AXONFAS_DEMO_ACCOUNTS=0` y así se entra solo con Google.

Para apagarlo (respalda la base en `~/.axonfas/` antes de destruir):

```bash
.\src\backend\cloud\axonfas-cloud.ps1 web-down -Yes
```

## 3 · Forma B: web en Vercel

1. Importa el repo en Vercel. No elijas framework: `vercel.json` ya define el build
   (`node config/deploy/vercel-build.mjs`) y la carpeta de salida (`.vercel-out`).
2. En el proyecto de Vercel, define `AXONFAS_API_BASE` con la URL HTTPS del droplet de la forma A
   (plantilla en `config/.env.vercel.example`).
3. En el droplet, agrega el dominio de Vercel a `AXONFAS_CORS_ORIGINS` (en tu `axonfas.env`) y repite `web-deploy`.
4. Agrega el dominio de Vercel a los orígenes autorizados del Client ID de Google.

La web de Vercel es estática y no guarda secretos. Las cuentas, el canal en vivo y la IA siguen en el droplet, porque
necesitan estado y conexiones largas que las funciones de Vercel no mantienen.

## Archivos

| Archivo | Para qué |
|---|---|
| `Dockerfile` (+ `Dockerfile.dockerignore`) | Imagen del servidor: Python 3.13 slim, sin dependencias, usuario sin privilegios, base en `/data` |
| `docker-compose.yml` | API + Caddy, con volúmenes para la base y los certificados |
| `Caddyfile` | HTTPS automático y cabeceras de seguridad; no acumula el canal en vivo |
| `cloud-init.yml` | Prepara el droplet: Docker, firewall (22, 80, 443) y el repo |
| `vercel-build.mjs` | Arma `.vercel-out/` con la web pública y `config.js` con la URL de la API |
| `../../vercel.json` | Build y cabeceras de seguridad de Vercel |
| `../.env.web.example`, `../.env.vercel.example` | Plantillas de variables (sin valores) |

No hay `next.config.js` porque el proyecto no usa Next.js: la web es HTML estático.
