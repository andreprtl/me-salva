// Testes do app instalável (v1.2): service worker, cache versionado, manifesto, ícones, página offline
// e metas do iPhone. Sobe a aplicação com um banco temporário, como os outros testes de API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createServiceWorker } from '../src/pwa.js';
import { APP_VERSION } from '../src/config.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
let server; let base; let dir; let db; let app;
const config = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, production: false, heartbeatMs: 25000 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-pwa-'));
  db = openDb(join(dir, 'test.db'));
  app = createApp({ db, config, notesKey: randomBytes(32) });
  server = createServer(app);
  await new Promise((ok) => server.listen(0, ok));
  base = `http://localhost:${server.address().port}`;
});
after(() => { app.close(); server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

// Largura e altura de um PNG, lidas do cabeçalho IHDR (bytes 16 a 23).
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const get = async (path) => {
  const res = await fetch(base + path);
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
};

test('service worker: entregue com a versão do app, sem cache HTTP e com a CSP própria', async () => {
  const { res, buf } = await get('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' https:\/\/fonts\.googleapis\.com https:\/\/fonts\.gstatic\.com/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const body = buf.toString();
  assert.ok(!body.includes('__VERSION__') && !body.includes('__SHELL__'), 'as marcas do modelo foram trocadas');
  const version = body.match(/const VERSION = "([^"]+)"/)[1];
  assert.match(version, new RegExp(`^${APP_VERSION.replace(/\./g, '\\.')}-[0-9a-f]{10}$`));
});

test('service worker: a estrutura do app existe, não inclui a API e a API não passa pelo cache', async () => {
  const body = (await get('/sw.js')).buf.toString();
  const shell = JSON.parse(body.match(/const SHELL = (\[.*\]);/)[1]);
  for (const must of ['/offline.html', '/css/styles.css', '/js/app.js', '/js/core.js', '/js/pwa.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/maskable-512.png']) {
    assert.ok(shell.includes(must), `${must} deveria estar no cache`);
  }
  assert.ok(!shell.some((f) => f.startsWith('/api/') || f === '/sw.js' || f.includes('splash-')));
  for (const f of shell) assert.equal((await get(f)).res.status, 200, `${f} existe`);
  // A regra da API vem antes de qualquer resposta do cache.
  assert.match(body, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return;/);
  assert.match(body, /caches\.match\(OFFLINE\)/);
});

test('service worker: qualquer mudança em public/ gera uma versão nova; sem mudança, a mesma', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mesalva-sw-'));
  try {
    cpSync(join(PUBLIC, 'sw.js'), join(tmp, 'sw.js'));
    mkdirSync(join(tmp, 'css'));
    writeFileSync(join(tmp, 'css', 'a.css'), 'body{color:red}');
    writeFileSync(join(tmp, 'index.html'), '<!doctype html>');
    const sw = createServiceWorker({ publicDir: tmp, appVersion: '9.9.9' });
    const v1 = sw.build();
    assert.deepEqual(v1.shell, ['/css/a.css'], 'index.html e o próprio sw.js ficam de fora');
    assert.equal(sw.build().version, v1.version);
    writeFileSync(join(tmp, 'css', 'a.css'), 'body{color:blue}');
    const v2 = sw.build();
    assert.notEqual(v2.version, v1.version);
    assert.match(v2.body, /const VERSION = "9\.9\.9-[0-9a-f]{10}";/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('manifesto: válido para instalar, com ícones PNG 192 e 512, versão maskable e atalhos', async () => {
  const { res, buf } = await get('/manifest.webmanifest');
  assert.match(res.headers.get('content-type'), /manifest\+json/);
  const m = JSON.parse(buf.toString());
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.lang, 'pt-BR');
  assert.equal(m.theme_color, '#1E4D40');
  assert.equal(m.background_color, '#FFF9F3');
  const need = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'], ['192x192', 'maskable']];
  for (const [sizes, purpose] of need) {
    const icon = m.icons.find((i) => i.sizes === sizes && i.purpose === purpose && i.type === 'image/png');
    assert.ok(icon, `ícone ${sizes} ${purpose}`);
    const img = await get(icon.src);
    assert.equal(img.res.status, 200);
    const { w, h } = pngSize(img.buf);
    assert.equal(`${w}x${h}`, sizes, `${icon.src} tem o tamanho declarado`);
  }
  assert.deepEqual(m.shortcuts.map((s) => s.url), ['/?tela=agenda', '/?tela=chats', '/?tela=crise']);
});

test('iPhone: ícone da tela de início, metas e telas de abertura com o tamanho certo para cada aparelho', async () => {
  const html = (await get('/')).buf.toString();
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Me Salva">/);
  assert.match(html, /viewport-fit=cover/);
  const touch = await get('/icons/apple-touch-icon.png');
  assert.deepEqual(pngSize(touch.buf), { w: 180, h: 180 });
  const splashes = [...html.matchAll(/apple-touch-startup-image" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)[^"]*" href="([^"]+)"/g)];
  assert.ok(splashes.length >= 6, 'telas de abertura para os iPhones mais comuns');
  for (const [, dw, dh, ratio, href] of splashes) {
    const img = await get(href);
    assert.equal(img.res.status, 200);
    assert.deepEqual(pngSize(img.buf), { w: dw * ratio, h: dh * ratio }, href);
  }
});

test('página offline: ajuda imediata (CVV 188) sem depender de script, dentro da CSP', async () => {
  const { res, buf } = await get('/offline.html');
  assert.equal(res.status, 200);
  const html = buf.toString();
  assert.match(html, /href="tel:188"/);
  assert.match(html, /href="tel:192"/);
  assert.match(html, /href="\/"[^>]*>Tentar de novo/);
  assert.match(html, /projeto acadêmico/);
  // A CSP bloqueia scripts embutidos: só o theme.js externo é permitido.
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.every(([, attrs, inner]) => /src="\/js\/theme\.js"/.test(attrs) && !inner.trim()));
  assert.doesNotMatch(html, /\son[a-z]+="/, 'sem onclick e afins');
  assert.equal(readFileSync(join(PUBLIC, 'offline.html'), 'utf8'), html);
});
