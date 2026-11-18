// Testes do Web Push (v1.2): criptografia do aviso (conferida com o exemplo da RFC 8291), assinatura VAPID
// (RFC 8292), lista de serviços aceitos, inscrição pela API e entrega de uma notificação a um aparelho
// (com um serviço de push falso, que só registra o pedido).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createECDH, createDecipheriv, hkdfSync, createPublicKey, verify } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed.js';
import { createPush, encryptPayload, vapidAuth, allowedEndpoint, generateVapidKeys, loadVapidKeys, b64u, fromB64u } from '../src/push.js';

let server; let base; let dir; let db; let app;
const sent = [];
let reply = 201;
const config = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, production: false, heartbeatMs: 25000 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-push-'));
  db = openDb(join(dir, 'test.db'));
  const notesKey = randomBytes(32);
  seedDemo(db, { notesKey });
  // Serviço de push falso: guarda o pedido e responde como o serviço real (201 = entregue).
  const push = createPush({ db, config, send: async (url, headers, body) => { sent.push({ url, headers, body }); return { status: reply }; } });
  app = createApp({ db, config, notesKey, push });
  server = createServer(app);
  await new Promise((ok) => server.listen(0, ok));
  base = `http://localhost:${server.address().port}`;
});
after(() => { app.close(); server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-ms-client': 'web', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}
async function login(email) {
  const api = client();
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: 'demo1234' } });
  assert.equal(r.status, 200);
  api.user = r.data.user;
  return api;
}
// Um "aparelho": par de chaves P-256 e segredo de autenticação, como o navegador cria ao se inscrever.
function device(endpoint) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, sub: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}
// Abre a mensagem como o navegador faria (RFC 8291 do lado de quem recebe).
function decrypt(body, dev) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const shared = dev.ecdh.computeSecret(asPublic);
  const uaPublic = dev.ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync('sha256', shared, fromB64u(dev.sub.keys.auth), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain.at(-1), 2, 'delimitador do último registro');
  return plain.subarray(0, -1).toString();
}
const waitFor = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 20)); } return fn(); };

test('Web Push: criptografia igual ao exemplo da RFC 8291 (apêndice A)', () => {
  const body = encryptPayload('When I grow up, I want to be a watermelon', {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, { salt: fromB64u('DGv6ra1nlYgDCS1FRnbzlw'), asPrivate: fromB64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  // E, com chaves e sal aleatórios, o aparelho consegue abrir a mensagem.
  const dev = device('https://fcm.googleapis.com/fcm/send/x');
  assert.equal(decrypt(encryptPayload('{"title":"Olá"}', dev.sub.keys), dev), '{"title":"Olá"}');
});

test('Web Push: assinatura VAPID (JWT ES256) válida, com destino, validade de até 24 h e contato', () => {
  const keys = generateVapidKeys();
  assert.equal(fromB64u(keys.publicKey).length, 65);
  const now = Date.now();
  const h = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, { subject: 'https://github.com/andreprtl/me-salva', now });
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [hd, cl, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(fromB64u(hd)), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(fromB64u(cl));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://github.com/andreprtl/me-salva');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600);
  const pub = fromB64u(keys.publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${hd}.${cl}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(sig)));
  // As chaves geradas ficam em data/vapid.json, só para o dono do arquivo, e são reaproveitadas.
  const k1 = loadVapidKeys({ dataDir: dir });
  assert.equal(statSync(join(dir, 'vapid.json')).mode & 0o077, 0);
  assert.deepEqual(loadVapidKeys({ dataDir: dir }), k1);
  assert.ok(existsSync(join(dir, 'vapid.json')));
});

test('Web Push: o servidor só envia para serviços de push conhecidos (sem SSRF)', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QGx', 'https://wns2-par02p.notify.windows.com/w/?token=1']) assert.ok(allowedEndpoint(ok), ok);
  for (const no of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x',
    'https://evilfcm.googleapis.com.br/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'nada']) assert.ok(!allowedEndpoint(no), no);
});

test('Web Push: inscrição pela API, troca de conta no mesmo aparelho e desinscrição só da própria', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const key = await mariana('/api/push/key');
  assert.equal(key.status, 200);
  assert.equal(fromB64u(key.data.key).length, 65);
  assert.equal((await client()('/api/push/key')).status, 401);

  const dev = device('https://fcm.googleapis.com/fcm/send/aparelho-1');
  assert.equal((await mariana('/api/push/subscribe', { method: 'POST', body: { ...dev.sub, endpoint: 'https://evil.com/x' } })).status, 400);
  assert.equal((await mariana('/api/push/subscribe', { method: 'POST', body: { ...dev.sub, keys: { p256dh: 'abc', auth: dev.sub.keys.auth } } })).status, 400);
  assert.equal((await mariana('/api/push/subscribe', { method: 'POST', body: dev.sub })).status, 200);
  assert.equal((await mariana('/api/push/subscribe', { method: 'POST', body: dev.sub })).status, 200, 'repetir não duplica');
  assert.equal(db.get('SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint = ?', dev.sub.endpoint).n, 1);

  // Outra pessoa entra no mesmo aparelho: a inscrição passa para ela.
  const fernanda = await login('fernanda.alves@demo.mesalva.app');
  await fernanda('/api/push/subscribe', { method: 'POST', body: dev.sub });
  assert.equal(db.get('SELECT user_id FROM push_subscriptions WHERE endpoint = ?', dev.sub.endpoint).user_id, fernanda.user.id);
  // A Mariana não consegue desinscrever o aparelho que agora é da Fernanda.
  assert.equal((await mariana('/api/push/unsubscribe', { method: 'POST', body: { endpoint: dev.sub.endpoint } })).data.removed, 0);
  assert.equal((await fernanda('/api/push/unsubscribe', { method: 'POST', body: { endpoint: dev.sub.endpoint } })).data.removed, 1);
});

test('Web Push: a notificação chega criptografada ao aparelho de quem recebe, sem o texto da mensagem', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const fernanda = await login('fernanda.alves@demo.mesalva.app');
  const dev = device('https://fcm.googleapis.com/fcm/send/celular-da-fernanda');
  await fernanda('/api/push/subscribe', { method: 'POST', body: dev.sub });
  sent.length = 0;
  await mariana(`/api/conversations/${fernanda.user.id}`, { method: 'POST', body: { kind: 'text', body: 'Texto sigiloso sobre a terapia' } });
  const req = await waitFor(() => sent.find((s) => s.url === dev.sub.endpoint));
  assert.ok(req, 'o serviço de push recebeu o pedido');
  assert.equal(sent.filter((s) => s.url === dev.sub.endpoint).length, 1, 'só o aparelho de quem recebe');
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.match(req.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.ok(Number(req.headers.TTL) > 0);
  assert.ok(!req.body.toString('latin1').includes('Nova mensagem'), 'o corpo vai criptografado');
  const n = JSON.parse(decrypt(req.body, dev));
  assert.equal(n.title, 'Nova mensagem');
  assert.match(n.body, /^Mariana Souza enviou/);
  assert.equal(n.screen, 'chat');
  assert.ok(!JSON.stringify(n).includes('sigiloso'), 'o texto da mensagem nunca vai no aviso');

  // O serviço avisa que a inscrição não existe mais (410): ela é apagada.
  reply = 410;
  await mariana(`/api/conversations/${fernanda.user.id}`, { method: 'POST', body: { kind: 'text', body: 'Oi de novo' } });
  await waitFor(() => !db.get('SELECT 1 FROM push_subscriptions WHERE endpoint = ?', dev.sub.endpoint));
  assert.equal(db.get('SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint = ?', dev.sub.endpoint).n, 0);
  reply = 201;

  // A exportação dos dados (LGPD) mostra os aparelhos com avisos, sem as chaves.
  await fernanda('/api/push/subscribe', { method: 'POST', body: dev.sub });
  const exp = await fernanda('/api/me/export');
  assert.deepEqual(exp.data.aparelhos_com_avisos.map((a) => a.servico), ['fcm.googleapis.com']);
  assert.ok(!JSON.stringify(exp.data).includes(dev.sub.keys.auth));
});
