/* AXONFAS · configuración pública de la web (ADR-020). En local y en la nube de AMD la API está en el mismo servidor:
 * apiBase vacío. Al desplegar la web en Vercel, config/deploy/vercel-build.mjs reescribe este archivo con la dirección
 * de la API (AXONFAS_API_BASE). Nunca pongas secretos aquí: lo lee cualquiera. */
window.AXONFAS_CONFIG = { apiBase: '' };
