// Teste de integração: sobe a API com um banco temporário e percorre o fluxo principal.
// Cada teste chama as rotas como o navegador faria, com cookie de sessão e o cabeçalho x-ms-client.
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

let server; let base; let dir; let db;
const config = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, production: false };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-'));
  db = openDb(join(dir, 'test.db'));
  const notesKey = randomBytes(32);
  seedDemo(db, { notesKey });
  server = createServer(createApp({ db, config, notesKey }));
  await new Promise((ok) => server.listen(0, ok));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

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

test('rejeita escrita sem o cabeçalho do site (proteção CSRF)', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('fluxo do paciente: triagem, agendamento, pagamento PIX, chat, sessão e avaliação', async () => {
  const api = client();
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'mariana@demo.mesalva.app', password: 'demo1234' } });
  assert.equal(login.status, 200);

  const tri = await api('/api/triage', { method: 'POST', body: { answers: { para: 'filho', idade: '4-6', sinais: ['Pouco contato visual'], diag: 'sim', suporte: 'muito', modal: 'presencial', orc: 60, hor: ['Manhã'] } } });
  assert.equal(tri.status, 200);
  const top = tri.data.results[0];
  assert.equal(top.pro.name, 'Rafael Nunes');

  const slots = await api(`/api/pros/${top.pro.id}/slots`);
  const slot = slots.data.days.flatMap((d) => d.items).find((s) => !s.taken && s.social);
  assert.ok(slot, 'deveria haver uma vaga social livre');

  const booking = await api('/api/appointments', { method: 'POST', body: { pro_id: top.pro.id, start: slot.start, modality: 'presencial', method: 'pix' } });
  assert.equal(booking.status, 200);
  assert.equal(booking.data.payment.amount, 4500);
  assert.match(booking.data.payment.pix_code, /^000201/);

  const dup = await api('/api/appointments', { method: 'POST', body: { pro_id: top.pro.id, start: slot.start, modality: 'presencial', method: 'pix' } });
  assert.equal(dup.status, 409, 'o mesmo horário não pode ser reservado duas vezes');

  const paid = await api(`/api/payments/${booking.data.payment.id}/pix-simulate`, { method: 'POST' });
  assert.equal(paid.data.appointment.status, 'confirmed');
  assert.equal(paid.data.payment.fee + paid.data.payment.pro_amount, 4500);

  const conv = await api(`/api/conversations/${top.pro.id}`);
  assert.ok(conv.data.messages.some((m) => m.kind === 'system' && m.body.includes('Sessão confirmada')));
  const sent = await api(`/api/conversations/${top.pro.id}`, { method: 'POST', body: { kind: 'text', body: 'Olá!' } });
  assert.equal(sent.data.message.body, 'Olá!');

  const list = await api('/api/appointments');
  const online = list.data.upcoming.find((a) => a.modality === 'online' && a.room_open);
  assert.ok(online, 'a sessão online de hoje deveria estar com a sala aberta');
  const room = await api(`/api/appointments/${online.id}/room`);
  assert.match(room.data.url, /^https:\/\/meet\.jit\.si\/MeSalva-/);
  await api(`/api/appointments/${online.id}/finish`, { method: 'POST' });
  const review = await api(`/api/appointments/${online.id}/review`, { method: 'POST', body: { rating: 5, tags: ['Acolhimento'], text: 'Ótima sessão', anonymous: true } });
  assert.equal(review.status, 200);
  const again = await api(`/api/appointments/${online.id}/review`, { method: 'POST', body: { rating: 4 } });
  assert.equal(again.status, 400, 'uma avaliação por sessão');
});

test('profissional: painel, vagas sociais e prontuário criptografado', async () => {
  const api = client();
  await api('/api/auth/login', { method: 'POST', body: { email: 'rafael.nunes@demo.mesalva.app', password: 'demo1234' } });
  const dash = await api('/api/pro/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.data.occupancy.length, 6);
  const bad = await api('/api/pro/social', { method: 'PUT', body: { social_price: 20, social_weekly: 4, auto_fill: true } });
  assert.equal(bad.status, 400, 'valor abaixo do mínimo de R$ 40');
  const ok = await api('/api/pro/social', { method: 'PUT', body: { social_price: 50, social_weekly: 5, auto_fill: true } });
  assert.equal(ok.data.pro.social_price, 5000);
  const patient = dash.data.today[0].patient_id;
  await api(`/api/pro/patients/${patient}/notes`, { method: 'POST', body: { text: 'Evolução: pediu ajuda com frase completa.' } });
  const notes = await api(`/api/pro/patients/${patient}/notes`);
  assert.ok(notes.data.notes.some((n) => n.text.includes('frase completa')));
  const raw = db.get('SELECT data FROM notes ORDER BY id DESC LIMIT 1');
  assert.ok(!Buffer.from(raw.data, 'base64').toString('utf8').includes('frase completa'), 'o texto fica criptografado no banco');
});

test('cadastro de profissional fica pendente até o administrador aprovar', async () => {
  const pro = client();
  const reg = await pro('/api/auth/register', { method: 'POST', body: {
    role: 'pro', name: 'Teste Profissional', email: 'novo@teste.com', password: 'senha12345', bairro: 'Centro', consent: true,
    pro: { area: 'psicologo', reg: 'CRP 06/999999', title: 'Psicólogo', approach: 'TCC', topics: ['Ansiedade'], audience: ['Adultos'], modalities: ['online'], price: 90, years: 2, bio: 'Atendo adultos com ansiedade usando TCC.' },
  } });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.pro.status, 'pending');
  const anon = client();
  const before = await anon('/api/pros');
  assert.ok(!before.data.pros.some((p) => p.name === 'Teste Profissional'));
  const admin = client();
  await admin('/api/auth/login', { method: 'POST', body: { email: 'admin@demo.mesalva.app', password: 'demo1234' } });
  const ov = await admin('/api/admin/overview');
  const pending = ov.data.pending.find((p) => p.name === 'Teste Profissional');
  await admin(`/api/admin/pros/${pending.id}/verify`, { method: 'POST', body: { decision: 'verified' } });
  const afterList = await anon('/api/pros');
  assert.ok(afterList.data.pros.some((p) => p.name === 'Teste Profissional'));
});

test('LGPD: exportação e exclusão da conta', async () => {
  const api = client();
  await api('/api/auth/register', { method: 'POST', body: { role: 'patient', name: 'Pessoa Teste', email: 'lgpd@teste.com', password: 'senha12345', bairro: 'Mooca', consent: true } });
  const exp = await api('/api/me/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.conta.email, 'lgpd@teste.com');
  const del = await api('/api/me', { method: 'DELETE', body: { confirm: 'EXCLUIR' } });
  assert.equal(del.status, 200);
  assert.equal(db.get("SELECT COUNT(*) n FROM users WHERE email = 'lgpd@teste.com'").n, 0);
});
