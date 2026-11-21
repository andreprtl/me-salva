// Testes da publicação (v2.0): o que muda quando o Me Salva roda no Render, atrás de um proxy e em HTTPS.
// Cobre a rota de verificação de saúde (/api/health), o cookie Secure e o HSTS, o IP real usado no limite de
// tentativas, os cabeçalhos do canal em tempo real e o servidor subindo do zero com a pasta de dados vazia,
// que é o que acontece no plano gratuito do Render a cada reinício (o disco é apagado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed.js';
import { clientIp } from '../src/http.js';
import { config as envConfig } from '../src/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const base = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, heartbeatMs: 25000 };
const MARIANA = { email: 'mariana@demo.mesalva.app', password: 'demo1234' };
let dir; let db; let notesKey;
let dev; let prod; // duas instâncias: como no computador (sem proxy) e como no Render (produção, atrás do proxy)
const running = [];

async function start(config, database = db) {
  const app = createApp({ db: database, config, notesKey });
  const server = createServer(app);
  await new Promise((ok) => server.listen(0, ok));
  running.push({ server, app });
  return `http://localhost:${server.address().port}`;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-deploy-'));
  db = openDb(join(dir, 'test.db'));
  notesKey = randomBytes(32);
  seedDemo(db, { notesKey });
  dev = await start({ ...base, production: false, trustProxy: false });
  prod = await start({ ...base, production: true, trustProxy: true });
});
after(() => {
  for (const { server, app } of running) { app.close(); server.close(); }
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const login = (url, body, headers = {}) => fetch(url + '/api/auth/login', {
  method: 'POST',
  headers: { 'x-ms-client': 'web', 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('GET /api/health responde sem login, sem cookie e só com a versão; HEAD também', async () => {
  const res = await fetch(prod + '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('set-cookie'), null);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['ok', 'version']);
  assert.equal(body.ok, true);
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  const head = await fetch(prod + '/api/health', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await fetch(prod + '/api/health', { method: 'POST', headers: { 'x-ms-client': 'web' } })).status, 405);
});

test('GET /api/health responde 503 se o banco não responde', async () => {
  const broken = openDb(join(dir, 'quebrado.db'));
  const url = await start({ ...base, production: false, trustProxy: false }, broken);
  broken.close();
  const res = await fetch(url + '/api/health');
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
});

test('em produção (HTTPS no Render): cookie de sessão com Secure, HSTS nas respostas e saída com Secure', async () => {
  const res = await login(prod, MARIANA, { 'cf-connecting-ip': '203.0.113.10' });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /; Secure/);
  assert.match(res.headers.get('strict-transport-security') || '', /^max-age=\d{7,}/);
  assert.ok((await fetch(prod + '/')).headers.get('strict-transport-security'), 'HSTS também nas páginas');
  const out = await fetch(prod + '/api/auth/logout', { method: 'POST', headers: { 'x-ms-client': 'web', cookie: cookie.split(';')[0] } });
  const cleared = out.headers.get('set-cookie');
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /; Secure/);
});

test('no computador (http://localhost, sem proxy): sem Secure e sem HSTS, mesmo se o pedido disser que é HTTPS', async () => {
  const res = await login(dev, MARIANA, { 'x-forwarded-proto': 'https' });
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.headers.get('set-cookie'), /Secure/);
  assert.equal(res.headers.get('strict-transport-security'), null);
});

test('IP real: CF-Connecting-IP primeiro, depois o primeiro IP válido do X-Forwarded-For; sem proxy, o da conexão', () => {
  const req = (headers, remoteAddress = '10.0.0.5') => ({ headers, socket: { remoteAddress } });
  assert.equal(clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 10.0.0.2' }), true), '203.0.113.7');
  assert.equal(clientIp(req({ 'x-forwarded-for': '198.51.100.1, 10.0.0.2' }), true), '198.51.100.1');
  assert.equal(clientIp(req({ 'x-forwarded-for': 'qualquer-coisa, 198.51.100.1' }), true), '198.51.100.1');
  assert.equal(clientIp(req({ 'cf-connecting-ip': 'não é um IP', 'x-forwarded-for': '198.51.100.1' }), true), '198.51.100.1');
  assert.equal(clientIp(req({ 'cf-connecting-ip': '2001:db8::1' }), true), '2001:db8::1');
  assert.equal(clientIp(req({}, '::ffff:10.1.2.3'), true), '10.1.2.3');
  // Sem proxy confiável, os cabeçalhos são ignorados: qualquer um poderia inventá-los.
  assert.equal(clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }, '::ffff:127.0.0.1'), false), '127.0.0.1');
});

test('limite de tentativas: só senha errada conta, por IP real; muitas entradas certas do mesmo IP não bloqueiam', async () => {
  const sala = { 'cf-connecting-ip': '203.0.113.20' }; // a turma inteira sai pelo mesmo IP da rede da faculdade
  for (let i = 1; i <= 20; i++) assert.equal((await login(prod, MARIANA, sala)).status, 200, `entrada certa nº ${i}`);
  for (let i = 1; i <= 12; i++) assert.equal((await login(prod, { ...MARIANA, password: 'errada' }, sala)).status, 401, `erro nº ${i}`);
  assert.equal((await login(prod, MARIANA, sala)).status, 429, 'depois de 12 senhas erradas, o IP espera 5 minutos');
  // Inventar um X-Forwarded-For não escapa: o IP vem da Cloudflare.
  assert.equal((await login(prod, MARIANA, { ...sala, 'x-forwarded-for': '198.51.100.99' })).status, 429);
  // Outro IP entra normalmente.
  assert.equal((await login(prod, MARIANA, { 'cf-connecting-ip': '203.0.113.21' })).status, 200);
});

test('canal em tempo real atravessa o proxy: cabeçalhos sem buffer, primeiro byte na hora e sinal de vida abaixo de 100 s', async () => {
  const res = await login(dev, { email: 'fernanda.alves@demo.mesalva.app', password: 'demo1234' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const ac = new AbortController();
  const stream = await fetch(dev + '/api/stream', { headers: { cookie }, signal: ac.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  assert.match(stream.headers.get('cache-control'), /no-transform/); // a Cloudflare não comprime nem segura o fluxo
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');
  const { value } = await stream.body.getReader().read();
  assert.match(new TextDecoder().decode(value), /retry: 3000/);
  ac.abort();
  // A Cloudflare corta conexões paradas por 100 s; o sinal de vida precisa vir bem antes.
  assert.ok(envConfig.heartbeatMs <= 60000, `sinal de vida a cada ${envConfig.heartbeatMs} ms`);
});

// Sobe o server.js de verdade, como o Render faz (npm start), com a pasta de dados indicada.
function boot(dataDir) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, NODE_ENV: 'production', DEMO_MODE: 'true', NOTES_KEY: 'frase-de-teste-gerada-pelo-render', PUSH: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('o servidor não subiu em 15 s:\n' + log)); }, 15000);
    const onData = (chunk) => {
      log += chunk;
      const m = log.match(/rodando em http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]), log: () => log }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`o servidor saiu com código ${code}:\n${log}`)); });
  });
}
const headers = (url) => new Promise((ok, fail) => get(url, (res) => { res.resume(); ok({ status: res.statusCode, headers: res.headers }); }).on('error', fail));

test('disco apagado (reinício no Render gratuito): o servidor recria banco e dados de demonstração e para limpo com SIGTERM', async () => {
  const data = join(tmpdir(), `mesalva-disco-${randomBytes(4).toString('hex')}`); // a pasta nem existe
  let child = null;
  try {
    for (const rodada of [1, 2]) {
      assert.equal(existsSync(data), false, `rodada ${rodada}: começa sem a pasta de dados`);
      const started = await boot(data);
      child = started.child;
      const { port, log } = started;
      const url = `http://localhost:${port}`;
      assert.match(log(), /dados de demonstração criados/);
      const h = await headers(url + '/api/health');
      assert.equal(h.status, 200);
      // O proxy do Render reaproveita conexões por até 120 s: o Node precisa mantê-las abertas pelo menos isso.
      assert.match(h.headers['keep-alive'] || '', /timeout=(1[2-9]\d|[2-9]\d\d)/);
      assert.equal((await login(url, MARIANA)).status, 200, `rodada ${rodada}: conta demo funciona`);
      const exit = new Promise((ok) => child.on('exit', (code, signal) => ok({ code, signal })));
      child.kill('SIGTERM');
      assert.deepEqual(await exit, { code: 0, signal: null }, 'parada limpa');
      child = null;
      assert.ok(existsSync(join(data, 'mesalva.db')));
      rmSync(data, { recursive: true, force: true }); // o Render apaga o disco antes do próximo início
    }
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL'); // uma conferência falhou com o servidor no ar
    rmSync(data, { recursive: true, force: true });
  }
});
