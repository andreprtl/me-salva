// Testes do tempo real (v1.1): canal SSE, "digitando…", "visto", notificações e lembretes.
// Sobe a API com um banco temporário e abre conexões /api/stream como o navegador faria.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed.js';

let server; let base; let dir; let db; let app;
const config = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, production: false, heartbeatMs: 300 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-rt-'));
  db = openDb(join(dir, 'test.db'));
  const notesKey = randomBytes(32);
  seedDemo(db, { notesKey });
  app = createApp({ db, config, notesKey });
  server = createServer(app);
  await new Promise((ok) => server.listen(0, ok));
  base = `http://localhost:${server.address().port}`;
});
after(() => { app.close(); server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

// Cliente da API com cookie próprio (cada um é uma pessoa diferente).
function client() {
  let cookie = '';
  const call = async (path, { method = 'GET', body } = {}) => {
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
  call.cookie = () => cookie;
  return call;
}
async function login(email) {
  const api = client();
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: 'demo1234' } });
  assert.equal(r.status, 200, `login de ${email}`);
  api.user = r.data.user;
  return api;
}

// Abre /api/stream e junta os eventos recebidos. waitFor espera um evento que satisfaça o critério.
function stream(api) {
  const ac = new AbortController();
  const s = { events: [], status: 0, closed: false, waiters: [] };
  const check = () => {
    s.waiters = s.waiters.filter((w) => {
      const ev = s.events.find((e) => e.event === w.event && w.pred(e.data));
      if (ev) { clearTimeout(w.timer); w.ok(ev); return false; }
      return true;
    });
  };
  s.opened = fetch(base + '/api/stream', { headers: api.cookie() ? { cookie: api.cookie() } : {}, signal: ac.signal }).then((res) => {
    s.status = res.status;
    if (res.status !== 200) { s.closed = true; return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const event = block.match(/^event: (.+)$/m)?.[1];
            const data = block.match(/^data: (.+)$/m)?.[1];
            if (event) s.events.push({ event, data: JSON.parse(data) });
          }
          check();
        }
      } catch { /* conexão encerrada pelo teste */ }
      s.closed = true;
      check();
    })();
  });
  s.waitFor = (event, pred = () => true, ms = 2000) => new Promise((ok, fail) => {
    const w = { event, pred, ok };
    w.timer = setTimeout(() => { s.waiters = s.waiters.filter((x) => x !== w); fail(new Error(`evento ${event} não chegou em ${ms} ms`)); }, ms);
    s.waiters.push(w);
    check();
  });
  s.close = () => ac.abort();
  return s;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Espera até a condição ficar verdadeira (ou falha depois de ms).
async function until(cond, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condição não aconteceu a tempo'); await sleep(20); }
}

test('tempo real: /api/stream exige login', async () => {
  const anon = stream(client());
  await anon.opened;
  assert.equal(anon.status, 401);
});

test('tempo real: mensagem, "digitando…" e "visto" chegam só às duas pessoas da conversa', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const fernanda = await login('fernanda.alves@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const sm = stream(mariana); const sf = stream(fernanda); const sr = stream(rafael);
  try {
    // Ao conectar, cada aba recebe os contadores atuais.
    await Promise.all([sm.waitFor('hello'), sf.waitFor('hello'), sr.waitFor('hello')]);
    const mId = mariana.user.id; const fId = fernanda.user.id;

    // Fernanda escreve para a Mariana: a mensagem chega na hora para a Mariana e para as outras abas da Fernanda.
    const sent = await fernanda(`/api/conversations/${mId}`, { method: 'POST', body: { kind: 'text', body: 'Oi, Mariana! Tudo certo para hoje?' } });
    assert.equal(sent.status, 200);
    const msgId = sent.data.message.id;
    const got = await sm.waitFor('message', (d) => d.message.id === msgId);
    assert.equal(got.data.conversation, fId, 'para a paciente, a conversa é a profissional');
    assert.equal(got.data.message.body, 'Oi, Mariana! Tudo certo para hoje?');
    assert.equal(got.data.message.seen, false);
    const echo = await sf.waitFor('message', (d) => d.message.id === msgId);
    assert.equal(echo.data.conversation, mId, 'para a profissional, a conversa é a paciente');
    const counts = await sm.waitFor('counts', (d) => d.messages >= 1);
    assert.ok(counts.data.messages >= 1, 'o contador de não lidas da Mariana sobe sozinho');

    // "Digitando…" vai só para a outra pessoa.
    assert.equal((await mariana(`/api/conversations/${fId}/typing`, { method: 'POST' })).status, 200);
    const typing = await sf.waitFor('typing');
    assert.equal(typing.data.conversation, mId);

    // A Mariana abre a conversa: a Fernanda recebe o "visto" e a mensagem passa a constar como vista.
    await mariana(`/api/conversations/${fId}`);
    const read = await sf.waitFor('read', (d) => d.conversation === mId);
    assert.ok(read.data.upTo >= msgId);
    await sm.waitFor('counts', (d) => d.messages === 0);
    const conv = await fernanda(`/api/conversations/${mId}`);
    assert.equal(conv.data.messages.find((m) => m.id === msgId).seen, true);

    // Isolamento: o Rafael, logado ao mesmo tempo, não recebeu nada dessa conversa.
    await sleep(150);
    const leaked = sr.events.filter((e) => ['message', 'typing', 'read'].includes(e.event));
    assert.deepEqual(leaked, [], 'um usuário não recebe eventos da conversa de outros');
    assert.ok(!sm.events.some((e) => e.event === 'typing'), 'quem digita não recebe o próprio "digitando…"');
  } finally { sm.close(); sf.close(); sr.close(); }
});

test('tempo real: profissional não manda "digitando…" para quem não é paciente dele', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const sm = stream(mariana);
  try {
    await sm.waitFor('hello');
    const r = await rafael(`/api/conversations/${mariana.user.id}/typing`, { method: 'POST' });
    assert.equal(r.status, 404);
    await sleep(150);
    assert.ok(!sm.events.some((e) => e.event === 'typing'));
  } finally { sm.close(); }
});

test('tempo real: sair da conta fecha o canal; sessão apagada é encerrada no sinal de vida', async () => {
  const a = await login('mariana@demo.mesalva.app');
  const sa = stream(a);
  await sa.waitFor('ping');
  // Logo depois de um sinal de vida, para provar que a saída fecha o canal na hora (antes do próximo sinal, em 300 ms).
  await a('/api/auth/logout', { method: 'POST' });
  await until(() => sa.closed, 120);

  const b = await login('fernanda.alves@demo.mesalva.app');
  const sb = stream(b);
  await sb.waitFor('hello');
  await sb.waitFor('ping'); // sinal de vida (300 ms neste teste)
  db.run('DELETE FROM sessions WHERE user_id = ?', b.user.id); // por exemplo, sessão apagada por outro caminho
  await until(() => sb.closed, 1500);
});

test('banco: avisos em tempo real só saem depois do COMMIT (nada sai de uma transação desfeita)', () => {
  const mem = openDb(':memory:');
  const out = [];
  assert.throws(() => mem.tx(() => { mem.afterCommit(() => out.push('desfeito')); throw new Error('falha no meio'); }));
  mem.tx(() => { mem.afterCommit(() => out.push('gravado')); assert.deepEqual(out, [], 'ainda dentro da transação'); });
  assert.deepEqual(out, ['gravado']);
  mem.afterCommit(() => out.push('fora de transação'));
  assert.deepEqual(out, ['gravado', 'fora de transação']);
  mem.close();
});
