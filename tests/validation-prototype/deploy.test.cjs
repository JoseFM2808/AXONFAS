// Tests de la preparación del despliegue (ADR-020) y de las páginas de cuentas (ADR-019).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'src', 'frontend', 'validation-prototype');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('vercel.json arma la web estática con el script del repo y cabeceras de seguridad', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.buildCommand, 'node config/deploy/vercel-build.mjs');
  assert.equal(v.outputDirectory, '.vercel-out');
  const all = JSON.stringify(v.headers);
  for (const h of ['X-Content-Type-Options', 'Permissions-Policy', 'Strict-Transport-Security']) assert.ok(all.includes(h), h);
  assert.ok(all.includes('camera=(self)'), 'la cámara sigue permitida en el propio sitio');
  assert.ok(read('.gitignore').includes('.vercel-out/'));
});

test('la compilación copia solo la web pública y escribe la dirección de la API', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'axonfas-vercel-'));
  execFileSync(process.execPath, [path.join(ROOT, 'config', 'deploy', 'vercel-build.mjs'), out],
    { env: { ...process.env, AXONFAS_API_BASE: 'https://203-0-113-7.sslip.io/' }, stdio: 'pipe' });
  for (const f of ['index.html', 'login.html', 'admin.html', 'api-client.js', 'docs/design-system/tokens.css']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} falta en la salida`);
  }
  for (const f of ['serve.py', 'lanzar-prototipo.cmd', 'preview.html']) assert.ok(!fs.existsSync(path.join(out, f)), `${f} no debe publicarse`);
  assert.match(fs.readFileSync(path.join(out, 'config.js'), 'utf8'), /"apiBase":"https:\/\/203-0-113-7\.sslip\.io"/);
  assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, 'config', 'deploy', 'vercel-build.mjs'), out],
    { env: { ...process.env, AXONFAS_API_BASE: 'http://inseguro.test' }, stdio: 'pipe' }), 'una API sin HTTPS se rechaza');
  fs.rmSync(out, { recursive: true, force: true });
});

test('Docker y Caddy para la nube de AMD, sin secretos en el repo', () => {
  const docker = read('config', 'deploy', 'Dockerfile');
  assert.ok(docker.includes('--cloud') && docker.includes('USER axonfas') && docker.includes('VOLUME ["/data"]'));
  const compose = read('config', 'deploy', 'docker-compose.yml');
  assert.ok(compose.includes('../.env.web') && compose.includes('caddy'));
  assert.ok(read('config', 'deploy', 'Caddyfile').includes('flush_interval -1'), 'el canal en vivo no se acumula en el proxy');
  const env = read('config', '.env.web.example');
  for (const k of ['GOOGLE_CLIENT_ID', 'AXONFAS_ADMIN_EMAILS', 'AMD_TOKENFACTORY_BASE_URL', 'AMD_TOKENFACTORY_API_KEY',
    'AMD_TOKENFACTORY_MODEL', 'AXONFAS_DEMO_ACCOUNTS', 'AXONFAS_CORS_ORIGINS', 'AXONFAS_DOMAIN']) {
    assert.match(env, new RegExp(`^${k}=`, 'm'), `${k} falta en la plantilla`);
  }
  for (const line of env.split('\n').filter((l) => /^(GOOGLE_CLIENT_ID|AXONFAS_ADMIN_EMAILS|AMD_TOKENFACTORY_API_KEY)=/.test(l))) {
    assert.match(line, /=$/, `la plantilla no lleva valores: ${line}`);
  }
  const ignore = read('.gitignore');
  assert.ok(ignore.includes('.env.*') && ignore.includes('!config/.env.*.example'), 'config/.env.web no se versiona');
});

test('páginas de cuentas: configuración antes del cliente, accesibles y con IA solo de AMD', () => {
  for (const page of ['index.html', 'galeria.html', 'seguimiento.html', 'doctor.html', 'paciente.html', 'login.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(WEB, page), 'utf8');
    const at = (f) => html.indexOf(`<script src="${f}"></script>`);
    assert.ok(at('config.js') > 0 && at('config.js') < at('api-client.js'), `${page}: config.js antes de api-client.js`);
    assert.ok(html.includes('class="skip-link"') && (html.match(/<main\b/g) || []).length === 1, `${page}: salto y <main>`);
  }
  const login = fs.readFileSync(path.join(WEB, 'login.js'), 'utf8');
  assert.ok(login.includes('https://accounts.google.com/gsi/client'), 'Google Identity Services');
  const providers = read('src', 'agents', 'providers.py');
  assert.ok(providers.includes('AMD_TOKENFACTORY_BASE_URL') && !/openai\.com|anthropic|googleapis\.com\/v1beta/i.test(providers),
    'la IA solo sale de AMD (Token Factory o vLLM propio)');
});
