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
import { sha256 } from '../src/security.js';
import { addDays, todaySP } from '../src/time.js';

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
async function freshLogin(email) {
  const api = client();
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: 'demo1234' } });
  assert.equal(r.status, 200, `login de ${email}`);
  api.user = r.data.user;
  return api;
}
// Reaproveita o login de cada conta entre os testes (o servidor limita 12 entradas por IP a cada 5 minutos).
const logged = new Map();
async function login(email) {
  if (!logged.has(email)) logged.set(email, await freshLogin(email));
  return logged.get(email);
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
    assert.deepEqual(echo.data.message, got.data.message, 'as outras abas de quem enviou recebem a mesma mensagem');
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
  const a = await freshLogin('mariana@demo.mesalva.app');
  const sa = stream(a);
  await sa.waitFor('ping');
  // Logo depois de um sinal de vida, para provar que a saída fecha o canal na hora (antes do próximo sinal, em 300 ms).
  await a('/api/auth/logout', { method: 'POST' });
  await until(() => sa.closed, 120);

  const b = await freshLogin('fernanda.alves@demo.mesalva.app');
  const sb = stream(b);
  await sb.waitFor('hello');
  await sb.waitFor('ping'); // sinal de vida (300 ms neste teste)
  // Sessão apagada por outro caminho (por exemplo, vencida e limpa): o próximo sinal de vida fecha o canal.
  db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(b.cookie().split('=')[1]));
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

test('notificações: confirmação, cancelamento e avaliação chegam na hora a quem deve saber', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const fernanda = await login('fernanda.alves@demo.mesalva.app');
  const sm = stream(mariana); const sr = stream(rafael); const sf = stream(fernanda);
  try {
    await Promise.all([sm.waitFor('hello'), sr.waitFor('hello'), sf.waitFor('hello')]);
    // Reserva com mais de 24 h de antecedência (para a paciente poder cancelar depois).
    const slots = await mariana(`/api/pros/${rafael.user.id}/slots`);
    const slot = slots.data.days.filter((d) => d.date >= addDays(todaySP(), 3)).flatMap((d) => d.items).find((s) => !s.taken);
    assert.ok(slot, 'deveria haver horário livre depois de amanhã');
    const booking = await mariana('/api/appointments', { method: 'POST', body: { pro_id: rafael.user.id, start: slot.start, modality: 'online', method: 'pix' } });
    await mariana(`/api/payments/${booking.data.payment.id}/pix-simulate`, { method: 'POST' });

    const toPro = await sr.waitFor('notification', (d) => d.notification.kind === 'confirmed');
    assert.equal(toPro.data.notification.title, 'Nova sessão confirmada');
    assert.match(toPro.data.notification.body, /^Mariana Souza marcou /);
    assert.equal(toPro.data.notification.screen, 'proagenda');
    const toPatient = await sm.waitFor('notification', (d) => d.notification.kind === 'confirmed');
    assert.match(toPatient.data.notification.body, /^Sua sessão com Rafael Nunes é /);
    await sr.waitFor('counts', (d) => d.notifications >= 1);

    // A paciente cancela: só o profissional é avisado.
    await mariana(`/api/appointments/${booking.data.appointment_id}/cancel`, { method: 'POST' });
    const cancel = await sr.waitFor('notification', (d) => d.notification.kind === 'cancelled');
    assert.match(cancel.data.notification.body, /^Mariana Souza cancelou a sessão de /);
    await sleep(100);
    assert.ok(!sm.events.some((e) => e.event === 'notification' && e.data.notification.kind === 'cancelled'), 'quem cancelou não recebe aviso');

    // Avaliação depois da sessão: a profissional recebe a nota.
    const list = await mariana('/api/appointments');
    const online = list.data.upcoming.find((a) => a.pro_id === fernanda.user.id && a.status === 'confirmed');
    await mariana(`/api/appointments/${online.id}/finish`, { method: 'POST' });
    await mariana(`/api/appointments/${online.id}/review`, { method: 'POST', body: { rating: 5, tags: [], anonymous: false } });
    const rev = await sf.waitFor('notification', (d) => d.notification.kind === 'review');
    assert.equal(rev.data.notification.body, 'Mariana S. avaliou a sessão com 5 estrelas.');

    // Isolamento: o Rafael não recebeu a avaliação da Fernanda.
    await sleep(100);
    assert.ok(!sr.events.some((e) => e.event === 'notification' && e.data.notification.kind === 'review'));
  } finally { sm.close(); sr.close(); sf.close(); }
});

test('notificações: mensagens da mesma conversa viram um aviso só, sem o texto; abrir a conversa resolve o aviso', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const fernanda = await login('fernanda.alves@demo.mesalva.app');
  const sm = stream(mariana);
  try {
    await sm.waitFor('hello');
    const mId = mariana.user.id; const fId = fernanda.user.id;
    await mariana(`/api/conversations/${fId}`); // começa sem mensagens não lidas dessa conversa
    await fernanda(`/api/conversations/${mId}`, { method: 'POST', body: { kind: 'text', body: 'Texto sigiloso 1' } });
    await fernanda(`/api/conversations/${mId}`, { method: 'POST', body: { kind: 'text', body: 'Texto sigiloso 2' } });
    await sm.waitFor('notification', (d) => d.notification.body === 'Fernanda Alves enviou 2 mensagens.');

    const list = await mariana('/api/notifications');
    const chatNotes = list.data.notifications.filter((n) => n.kind === 'message' && n.param === String(fId) && !n.read);
    assert.equal(chatNotes.length, 1, 'um aviso por conversa, não um por mensagem');
    assert.equal(chatNotes[0].screen, 'chat');
    assert.ok(!JSON.stringify(list.data).includes('sigiloso'), 'o texto da mensagem não vai para a notificação');

    const before = list.data.unread;
    await mariana(`/api/conversations/${fId}`);
    const after2 = await mariana('/api/notifications');
    assert.equal(after2.data.unread, before - 1);
    assert.ok(after2.data.notifications.find((n) => n.id === chatNotes[0].id).read);
  } finally { sm.close(); }
});

test('notificações: marcar uma, marcar todas e ninguém mexe na notificação de outra pessoa', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const fernanda = await login('fernanda.alves@demo.mesalva.app');
  await fernanda(`/api/conversations/${mariana.user.id}`, { method: 'POST', body: { kind: 'text', body: 'Até já!' } });
  const list = await mariana('/api/notifications');
  const mine = list.data.notifications.find((n) => !n.read);
  assert.ok(mine, 'a Mariana tem pelo menos uma notificação não lida');

  const other = await rafael(`/api/notifications/${mine.id}/read`, { method: 'POST' });
  assert.equal(other.status, 404, 'notificação de outra pessoa não existe para quem pergunta');
  assert.equal((await mariana('/api/notifications')).data.notifications.find((n) => n.id === mine.id).read, false);

  const one = await mariana(`/api/notifications/${mine.id}/read`, { method: 'POST' });
  assert.equal(one.status, 200);
  assert.equal(one.data.unread, list.data.unread - 1);
  const all = await mariana('/api/notifications/read-all', { method: 'POST' });
  assert.equal(all.data.unread, 0);
  assert.equal((await mariana('/api/unread')).data.notifications, 0);
  assert.equal((await mariana('/api/me')).data.user.notifications, 0);
});

test('notificações: aprovar o registro avisa o profissional na hora', async () => {
  const bea = await login('beatriz.campos@demo.mesalva.app');
  const admin = await login('admin@demo.mesalva.app');
  const sb = stream(bea);
  try {
    await sb.waitFor('hello');
    await admin(`/api/admin/pros/${bea.user.id}/verify`, { method: 'POST', body: { decision: 'verified' } });
    const n = await sb.waitFor('notification', (d) => d.notification.kind === 'verified');
    assert.equal(n.data.notification.title, 'Registro aprovado');
    assert.equal(n.data.notification.screen, 'painel');
  } finally { sb.close(); }
});

// Cria uma sessão direto no banco (para testar os lembretes com horários fixos).
function addAppt(patientId, proId, start, status = 'confirmed', modality = 'online') {
  return db.run(`INSERT INTO appointments(patient_id, pro_id, start, modality, social, base_price, amount, fee, pro_amount, status, room)
                 VALUES (?, ?, ?, ?, 0, 9000, 9000, 1080, 7920, ?, 'MeSalva-teste')`, patientId, proId, start, modality, status).lastInsertRowid;
}

test('lembretes: 24 h e 1 h antes, uma vez só, com aviso no chat e notificação em tempo real para os dois', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const { reminders } = app.ctx;
  const mId = mariana.user.id; const rId = rafael.user.id;
  const appt = addAppt(mId, rId, '2030-01-10T10:00');
  const cancelled = addAppt(mId, rId, '2030-01-10T11:00', 'cancelled');
  const pending = addAppt(mId, rId, '2030-01-10T12:00', 'pending_payment');
  const mine = (sent) => sent.filter((s) => [appt, cancelled, pending].includes(s.appointment_id));
  const sm = stream(mariana); const sr = stream(rafael);
  try {
    await Promise.all([sm.waitFor('hello'), sr.waitFor('hello')]);
    assert.deepEqual(mine(reminders.run({ now: '2030-01-09T09:30' })), [], 'faltando mais de 24 h, nada');
    assert.deepEqual(mine(reminders.run({ now: '2030-01-09T10:30' })), [{ appointment_id: appt, kind: '24h' }]);
    assert.deepEqual(mine(reminders.run({ now: '2030-01-09T10:31' })), [], 'o de 24 h não se repete');
    assert.deepEqual(mine(reminders.run({ now: '2030-01-10T09:00' })), [{ appointment_id: appt, kind: '1h' }]);
    assert.deepEqual(mine(reminders.run({ now: '2030-01-10T09:30' })), [], 'o de 1 h não se repete');

    // Chegaram em tempo real para a paciente e para o profissional.
    const toPatient = await sm.waitFor('notification', (d) => d.notification.kind === 'reminder' && d.notification.body.includes('10/01'));
    assert.equal(toPatient.data.notification.body, 'Sua sessão com Rafael Nunes é amanhã (10/01) às 10:00 (online).');
    const toPro = await sr.waitFor('notification', (d) => d.notification.kind === 'reminder' && d.notification.body.includes('hoje (10/01)'));
    assert.equal(toPro.data.notification.body, 'Sessão com Mariana Souza hoje (10/01) às 10:00 (online).');
    await sm.waitFor('message', (d) => d.conversation === rId && d.message.body.startsWith('Lembrete: a sessão é hoje (10/01) às 10:00'));

    // No banco: dois avisos no chat e dois registros de lembrete para a sessão; nada para a cancelada e a pendente.
    const chat = db.all("SELECT body FROM messages WHERE patient_id = ? AND pro_id = ? AND kind = 'system' AND body LIKE 'Lembrete:%10/01%'", mId, rId);
    assert.equal(chat.length, 2);
    assert.equal(db.get('SELECT COUNT(*) n FROM reminders WHERE appointment_id = ?', appt).n, 2);
    assert.equal(db.get('SELECT COUNT(*) n FROM reminders WHERE appointment_id IN (?, ?)', cancelled, pending).n, 0);
  } finally { sm.close(); sr.close(); }
});

test('lembretes: quem marca em cima da hora recebe só o de 1 h', () => {
  const mId = db.get("SELECT id FROM users WHERE email = 'mariana@demo.mesalva.app'").id;
  const pro = db.get("SELECT id FROM users WHERE email = 'bruno.correa@exemplo.mesalva.app'").id;
  const appt = addAppt(mId, pro, '2030-02-01T18:00');
  const sent = app.ctx.reminders.run({ now: '2030-02-01T17:10' }).filter((s) => s.appointment_id === appt);
  assert.deepEqual(sent, [{ appointment_id: appt, kind: '1h' }]);
  assert.equal(db.get("SELECT COUNT(*) n FROM reminders WHERE appointment_id = ? AND kind = '24h'", appt).n, 0);
});

test('lembretes: o botão da demonstração antecipa o de 1 h, não duplica e é só da administração', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const admin = await login('admin@demo.mesalva.app');
  const pro = db.get("SELECT id FROM users WHERE email = 'pedro.henrique.castro@exemplo.mesalva.app'").id;
  // Daqui a 2h30 (minuto ímpar para não colidir com os horários cheios dos dados de demonstração).
  const { nowSP, toMinutes, fromMinutes } = await import('../src/time.js');
  const start = fromMinutes(toMinutes(nowSP()) + 150).slice(0, 15) + '7';
  const appt = addAppt(mariana.user.id, pro, start);
  app.ctx.reminders.run(); // a conferência normal manda só o de 24 h
  assert.equal(db.get("SELECT COUNT(*) n FROM reminders WHERE appointment_id = ? AND kind = '1h'", appt).n, 0);

  assert.equal((await mariana('/api/admin/reminders/run', { method: 'POST' })).status, 403);
  const first = await admin('/api/admin/reminders/run', { method: 'POST' });
  assert.equal(first.status, 200);
  assert.ok(first.data.sent >= 1);
  await admin('/api/admin/reminders/run', { method: 'POST' });
  assert.equal(db.get("SELECT COUNT(*) n FROM reminders WHERE appointment_id = ? AND kind = '1h'", appt).n, 1, 'apertar de novo não duplica');
});
