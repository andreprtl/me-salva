// Painel de métricas (v1.3): cálculos com um conjunto pequeno de dados conhecidos, eventos do funil gravados
// pelas rotas, acesso só da administração, CSV e a coerência dos dados de demonstração.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo, DEMO_PASSWORD } from '../src/seed.js';
import { computeMetrics, metricsCsv, funnel, periodRange } from '../src/metrics.js';
import { createEvents } from '../src/events.js';

/* ---------------- cálculos com dados conhecidos ---------------- */
// Agora fixo: sexta-feira, 20/11/2026, 12:00. Período de 30 dias: de 22/10 até agora; o anterior, de 22/09 a 21/10.
const NOW = '2026-11-20T12:00';

function smallDb() {
  const db = openDb(':memory:');
  const user = (role, name, plan = 'free') => db.run("INSERT INTO users(role, name, email, pass_hash, plan) VALUES (?, ?, ?, 'x', ?)", role, name, `${name}@t.app`, plan).lastInsertRowid;
  const pro = (name, extra) => {
    const id = user('pro', name);
    db.run(`INSERT INTO pros(user_id, area, title, reg, approach, approach_short, price, is_new, supervisor, social_price, social_weekly, status)
            VALUES (?, 'psicologo', 'Psicóloga', 'CRP 0', 'TCC', 'TCC', ?, ?, ?, ?, ?, 'verified')`, id, extra.price, extra.is_new || 0, extra.supervisor || null, extra.social_price || null, extra.social_weekly || 0);
    return id;
  };
  const A = pro('ana', { price: 10000 });
  // B é recém-formada com vaga social fixa às segundas, 08:00 (a primeira entrada da semana).
  const B = pro('bia', { price: 9000, is_new: 1, supervisor: 'Supervisora', social_price: 5000, social_weekly: 1 });
  for (const wd of [1, 3]) db.run("INSERT INTO availability(pro_id, weekday, hour) VALUES (?, ?, '08:00')", B, wd);
  db.run("INSERT INTO pros(user_id, area, title, reg, approach, approach_short, price, status) VALUES (?, 'psicologo', 'Psicólogo', 'CRP 1', 'TCC', 'TCC', 8000, 'pending')", user('pro', 'pendente'));
  const [P1, P2, P3, P4] = [user('patient', 'p1', 'plus'), user('patient', 'p2'), user('patient', 'p3'), user('patient', 'p4')];
  // Cadastros: P1 em 25/10 (22:30 em São Paulo = 01:30 UTC do dia seguinte), P2 e P3 em 03/11; P4 na semana atual.
  db.run("UPDATE users SET created_at = '2026-10-26T01:30:00Z' WHERE id = ?", P1);
  for (const id of [P2, P3]) db.run("UPDATE users SET created_at = '2026-11-03T13:00:00Z' WHERE id = ?", id);
  db.run("UPDATE users SET created_at = '2026-11-17T13:00:00Z' WHERE id = ?", P4);
  const pkg = db.run("INSERT INTO packages(patient_id, pro_id, weekdays, time, weeks, modality, amount, status) VALUES (?, ?, '[1,3]', '08:00', 4, 'online', 5000, 'paid')", P2, B).lastInsertRowid;
  const appt = (patient, proId, start, status, { amount, fee, social = 0, base = amount, package_id = null }) => db.run(
    `INSERT INTO appointments(patient_id, pro_id, package_id, start, modality, social, base_price, amount, fee, pro_amount, status)
     VALUES (?, ?, ?, ?, 'online', ?, ?, ?, ?, ?, ?)`, patient, proId, package_id, start, social, base, amount, fee, amount - fee, status).lastInsertRowid;
  const a1 = appt(P1, A, '2026-11-02T10:00', 'done', { amount: 10000, fee: 1200 });
  appt(P1, A, '2026-11-09T10:00', 'done', { amount: 9000, fee: 200, base: 10000 }); // com o desconto do Me Salva+
  const a3 = appt(P2, B, '2026-11-16T08:00', 'done', { amount: 5000, fee: 600, social: 1, package_id: pkg });
  appt(P3, A, '2026-11-11T10:00', 'no_show', { amount: 10000, fee: 1200 });
  appt(P3, A, '2026-11-12T10:00', 'cancelled', { amount: 10000, fee: 1200 }); // cancelada: não conta
  appt(P3, A, '2026-10-01T10:00', 'done', { amount: 10000, fee: 1200 }); // período anterior
  appt(P3, A, '2026-09-15T10:00', 'done', { amount: 10000, fee: 1200 }); // antes dos dois períodos: só mostra que há histórico
  appt(P1, A, '2026-11-23T10:00', 'confirmed', { amount: 10000, fee: 1200 }); // futura: não conta
  for (const [paid, uid] of [['2026-11-05T15:00:00Z', P1], ['2026-10-05T15:00:00Z', P1]]) {
    db.run("INSERT INTO payments(user_id, kind, method, amount, fee, status, paid_at) VALUES (?, 'plus', 'card', 1990, 1990, 'paid', ?)", uid, paid);
  }
  db.run("INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, created_at) VALUES (?, ?, ?, 5, '2026-11-02T22:00:00Z')", a1, P1, A);
  db.run("INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, created_at) VALUES (?, ?, ?, 4, '2026-11-16T20:00:00Z')", a3, P2, B);
  db.run("INSERT INTO reviews(patient_id, pro_id, rating, created_at) VALUES (?, ?, 3, '2026-09-01T20:00:00Z')", P3, A); // fora do período
  const ev = createEvents(db);
  const t = (kind, uid, at) => ev.track(kind, { user_id: uid, at });
  // P1 passa por todos os passos; P2 para no perfil; P3 reservou ANTES de começar a triagem (não conta como passo)
  // e só começou; P4 nunca começou a triagem (fora da coorte).
  ['triage_started', 'triage_done', 'profile_view', 'booking_created', 'payment_confirmed', 'session_done'].forEach((k, i) => t(k, P1, `2026-10-25T10:0${i}`));
  ['triage_started', 'triage_done', 'profile_view'].forEach((k, i) => t(k, P2, `2026-11-10T09:0${i}`));
  t('booking_created', P3, '2026-10-23T10:00');
  t('triage_started', P3, '2026-10-24T10:00');
  t('profile_view', P4, '2026-11-01T10:00');
  t('booking_created', P4, '2026-11-01T10:05');
  t('triage_started', P2, '2026-09-30T10:00'); // período anterior: fica fora da coorte
  return db;
}

test('métricas: receita, valor transacionado, ticket e ativos do período (dados conhecidos)', () => {
  const m = computeMetrics(smallDb(), { now: NOW, days: 30 });
  assert.deepEqual(m.period, { days: 30, label: '30 dias', from: '2026-10-22', to: '2026-11-20', prev_from: '2026-09-22' });
  const k = m.kpis;
  // 3 sessões realizadas (R$ 100 + R$ 90 + R$ 50) e uma mensalidade do Me Salva+ de R$ 19,90.
  assert.equal(k.sessions, 3);
  assert.equal(k.gmv_sessions, 24000);
  assert.equal(k.gmv, 25990);
  // 12% das sessões (R$ 12 + R$ 2 com o desconto do Me Salva+ + R$ 6) + R$ 19,90 da assinatura.
  assert.equal(k.revenue_sessions, 2000);
  assert.equal(k.revenue_plus, 1990);
  assert.equal(k.revenue, 3990);
  assert.equal(k.ticket, 8000);
  assert.equal(k.patients_active, 2);
  assert.equal(k.pros_active, 2);
  assert.equal(k.pros_verified, 2);
  assert.equal(k.pros_pending, 1);
  assert.equal(k.plus_subscribers, 1);
  assert.equal(k.plus_pct, 50);
  assert.equal(k.social_sessions, 1);
  assert.equal(k.no_show, 1);
  // Período anterior: uma sessão de R$ 100 e uma mensalidade.
  assert.equal(m.prev.sessions, 1);
  assert.equal(m.prev.gmv, 11990);
  assert.equal(m.prev.revenue, 3190);
  // Sem sessões desde o começo do período anterior (aqui, 180 dias), não há comparação.
  assert.equal(computeMetrics(smallDb(), { now: NOW, days: 180 }).prev, null);
});

test('métricas: funil por coorte, na ordem dos passos, com a conversão de cada passo', () => {
  const r = periodRange(NOW, 30);
  const f = funnel(smallDb(), r.from, r.to);
  assert.deepEqual(f.map((s) => s.users), [3, 2, 2, 1, 1, 1]);
  assert.deepEqual(f.map((s) => s.of_prev), [100, 67, 100, 50, 100, 100]);
  assert.deepEqual(f.map((s) => s.of_first), [100, 67, 67, 33, 33, 33]);
});

test('métricas: retenção, vagas sociais, qualidade e semanas', () => {
  const m = computeMetrics(smallDb(), { now: NOW, days: 30 });
  assert.deepEqual(m.retention, { active: 2, two_plus: 1, two_plus_pct: 50, package: 1, package_pct: 50 });
  // Segundas às 08:00 que já passaram no período: 26/10, 02/11, 09/11 e 16/11. Só a de 16/11 teve sessão.
  assert.deepEqual(m.social, { pros: 1, offered: 4, used: 1, occupancy_pct: 25, sessions: 1, share_pct: 33, savings: 4000 });
  assert.deepEqual(m.quality, { reviews: 2, avg: 4.5, distribution: [1, 1, 0, 0, 0], no_show: 1, no_show_pct: 25 });
  // 26 semanas completas, de segunda a domingo; a semana atual (16/11) fica de fora.
  assert.equal(m.weekly.length, 26);
  assert.equal(m.weekly.at(-1).week, '2026-11-09');
  assert.equal(m.weekly[0].week, '2026-05-18');
  const w = Object.fromEntries(m.weekly.map((x) => [x.week, x]));
  assert.deepEqual(w['2026-11-09'], { week: '2026-11-09', sessions: 1, social: 0, no_show: 1, gmv: 9000, revenue: 200, signups: 0 });
  assert.deepEqual(w['2026-11-02'], { week: '2026-11-02', sessions: 1, social: 0, no_show: 0, gmv: 11990, revenue: 3190, signups: 2 });
  assert.equal(w['2026-10-19'].signups, 1, 'cadastro de domingo à noite em São Paulo fica na semana de domingo');
  assert.equal(m.weekly.reduce((t, x) => t + x.signups, 0), 3, 'P4 se cadastrou na semana atual');
});

test('métricas: CSV em português (separador ;, vírgula decimal, BOM) e aviso de dados de demonstração', () => {
  const csv = metricsCsv(computeMetrics(smallDb(), { now: NOW, days: 30 }));
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /DADOS DE DEMONSTRAÇÃO/);
  assert.match(csv, /\r\nValor transacionado \(R\$\);259,90;119,90\r\n/);
  assert.match(csv, /\r\nReceita da plataforma \(R\$\);39,90;31,90\r\n/);
  assert.match(csv, /\r\nComeçaram a triagem;3;100;100\r\n/);
  assert.match(csv, /\r\n09\/11\/2026;1;0;1;90,00;2,00;0\r\n/);
});

test('eventos: repetir o mesmo perfil ou a triagem em 30 minutos conta uma vez', () => {
  const db = openDb(':memory:');
  const add = (role, name) => db.run('INSERT INTO users(role, name, email, pass_hash) VALUES (?, ?, ?, ?)', role, name, `${name}@t.app`, 'x').lastInsertRowid;
  const uid = add('patient', 'x');
  const [p7, p8] = [add('pro', 'p7'), add('pro', 'p8')];
  const ev = createEvents(db);
  assert.equal(ev.track('profile_view', { user_id: uid, pro_id: p7, at: '2026-11-20T10:00' }), true);
  assert.equal(ev.track('profile_view', { user_id: uid, pro_id: p7, at: '2026-11-20T10:20' }), false);
  assert.equal(ev.track('profile_view', { user_id: uid, pro_id: p8, at: '2026-11-20T10:20' }), true, 'outro profissional conta');
  assert.equal(ev.track('profile_view', { user_id: uid, pro_id: p7, at: '2026-11-20T10:51' }), true, 'depois de 30 minutos conta de novo');
  assert.equal(ev.track('booking_created', { user_id: uid, pro_id: p7, ref_id: 1 }), true);
  assert.equal(ev.track('booking_created', { user_id: uid, pro_id: p7, ref_id: 2 }), true, 'reservas sempre contam');
  assert.throws(() => ev.track('qualquer', { user_id: uid }));
});

/* ---------------- API e dados de demonstração ---------------- */
let server; let base; let dir; let db;
const config = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, production: false };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-metricas-'));
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
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, disposition: res.headers.get('content-disposition'), data: type.includes('json') ? await res.json() : await res.text() };
  };
}
async function login(email) {
  const c = client();
  const r = await c('/api/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}
const idOf = (email) => db.get('SELECT id FROM users WHERE email = ?', email).id;
const lastEvent = (uid) => db.get('SELECT * FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 1', uid);

test('eventos: as rotas gravam os passos do funil, sem dados sensíveis', async () => {
  // A tabela só tem tipo, horário e identificadores internos.
  assert.deepEqual(db.all('PRAGMA table_info(events)').map((c) => c.name), ['id', 'kind', 'user_id', 'pro_id', 'ref_id', 'at']);
  const reg = client();
  const email = `funil.${Date.now()}@teste.app`;
  const r = await reg('/api/auth/register', { method: 'POST', body: { role: 'patient', name: 'Paciente Funil', email, password: 'senha-forte-123', bairro: 'Mooca', consent: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const uid = idOf(email);
  assert.equal((await reg('/api/events', { method: 'POST', body: { kind: 'triage_started' } })).data.recorded, true);
  assert.equal((await reg('/api/events', { method: 'POST', body: { kind: 'triage_started' } })).data.recorded, false, 'reabrir a triagem não duplica');
  assert.equal((await reg('/api/events', { method: 'POST', body: { kind: 'session_done' } })).status, 400, 'o navegador não inventa passos do servidor');
  await reg('/api/triage', { method: 'POST', body: { answers: { para: 'eu', motivos: ['ansiedade'], tempo: 'medio', antes: 'nao', modal: 'online', orc: 120, hor: ['Noite'] } } });
  assert.equal(lastEvent(uid).kind, 'triage_done');
  const fid = idOf('fernanda.alves@demo.mesalva.app');
  await reg(`/api/pros/${fid}`);
  assert.deepEqual([lastEvent(uid).kind, lastEvent(uid).pro_id], ['profile_view', fid]);
  // Reserva, pagamento, sessão realizada e avaliação.
  const slots = (await reg(`/api/pros/${fid}/slots`)).data.days.flatMap((d) => d.items).filter((s) => !s.taken);
  const made = await reg('/api/appointments', { method: 'POST', body: { pro_id: fid, start: slots[0].start, modality: 'online', method: 'pix' } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.deepEqual([lastEvent(uid).kind, lastEvent(uid).ref_id], ['booking_created', made.data.appointment_id]);
  await reg(`/api/payments/${made.data.payment.id}/pix-simulate`, { method: 'POST' });
  assert.equal(lastEvent(uid).kind, 'payment_confirmed');
  await reg(`/api/appointments/${made.data.appointment_id}/finish`, { method: 'POST' });
  assert.equal(lastEvent(uid).kind, 'session_done');
  await reg(`/api/appointments/${made.data.appointment_id}/review`, { method: 'POST', body: { rating: 5, tags: [], text: '' } });
  assert.equal(lastEvent(uid).kind, 'review_sent');
  // Na exportação de dados (LGPD) aparecem só o tipo e o horário.
  const exp = await reg('/api/me/export');
  assert.deepEqual(Object.keys(exp.data.eventos_de_uso[0]), ['kind', 'at']);
  // Excluir a conta tira o vínculo: os eventos ficam sem pessoa.
  const n = db.get('SELECT COUNT(*) n FROM events WHERE user_id = ?', uid).n;
  assert.ok(n >= 7);
  assert.equal((await reg('/api/me', { method: 'DELETE', body: { confirm: 'EXCLUIR' } })).status, 200);
  assert.equal(db.get('SELECT COUNT(*) n FROM events WHERE user_id = ?', uid).n, 0);
});

test('painel de métricas: só a administração, períodos válidos e CSV para baixar', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  assert.equal((await mariana('/api/admin/metrics')).status, 403);
  assert.equal((await mariana('/api/admin/metrics/export')).status, 403);
  assert.equal((await mariana('/api/events', { method: 'POST', body: { kind: 'triage_started' } })).status, 200);
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  assert.equal((await rafael('/api/events', { method: 'POST', body: { kind: 'triage_started' } })).status, 403, 'só pacientes');
  const admin = await login('admin@demo.mesalva.app');
  for (const days of [30, 90, 180]) {
    const r = await admin(`/api/admin/metrics?days=${days}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.period.days, days);
    assert.equal(r.data.funnel.length, 6);
    assert.equal(r.data.weekly.length, 26);
  }
  assert.equal((await admin('/api/admin/metrics?days=7')).status, 400);
  const csv = await admin('/api/admin/metrics/export?days=90');
  assert.equal(csv.status, 200);
  assert.match(csv.type, /^text\/csv/);
  assert.match(csv.disposition, /attachment; filename="me-salva-metricas-90d-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.match(csv.data, /Funil \(quem começou a triagem no período\)/);
});

test('dados de demonstração: números coerentes com as hipóteses do contexto, e "Restaurar" recria tudo', () => {
  const sdb = openDb(':memory:');
  seedDemo(sdb, {});
  const m = computeMetrics(sdb, { days: 30 });
  const k = m.kpis;
  // Hipóteses do PIPE: sessão média perto de R$ 95 e cerca de 8% dos pacientes no Me Salva+.
  assert.ok(k.ticket >= 9000 && k.ticket <= 10500, `ticket médio de R$ ${k.ticket / 100}`);
  assert.ok(k.plus_pct >= 5 && k.plus_pct <= 12, `${k.plus_pct}% dos pacientes ativos no Me Salva+`);
  // Crescimento moderado: as 4 últimas semanas têm entre 1,2 e 2,2 vezes as sessões das 4 primeiras.
  const avg = (list) => list.reduce((s, x) => s + x, 0) / list.length;
  const w = m.weekly.map((x) => x.sessions);
  const growth = avg(w.slice(-4)) / avg(w.slice(0, 4));
  assert.ok(growth >= 1.2 && growth <= 2.2, `crescimento de ${growth.toFixed(2)}x`);
  assert.ok(w.every((n) => n > 0), 'nenhuma semana vazia');
  // Funil plausível: começa com gente, nunca cresce de um passo para o outro e nenhum passo perde mais de 60%.
  assert.ok(m.funnel[0].users >= 15);
  assert.ok(m.funnel.every((f, i) => !i || (f.users <= m.funnel[i - 1].users && f.of_prev >= 40)), JSON.stringify(m.funnel));
  assert.ok(m.retention.two_plus_pct >= 50 && m.retention.package >= 1, JSON.stringify(m.retention));
  assert.ok(m.social.occupancy_pct >= 50 && m.social.sessions > 0, JSON.stringify(m.social));
  assert.ok(m.quality.no_show_pct <= 8 && m.quality.avg >= 4.5, JSON.stringify(m.quality));
  // "Restaurar dados de demonstração" recria as cenas da v1.1 (notificações), da v1.2 (pacote) e da v1.3 (métricas).
  sdb.run("DELETE FROM events");
  seedDemo(sdb, { reset: true });
  const mid = sdb.get("SELECT id FROM users WHERE email = 'mariana@demo.mesalva.app'").id;
  assert.ok(sdb.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', mid).n >= 1);
  assert.equal(sdb.get("SELECT COUNT(*) n FROM packages WHERE patient_id = ? AND status = 'paid'", mid).n, 1);
  const again = computeMetrics(sdb, { days: 30 }).kpis;
  assert.ok(sdb.get('SELECT COUNT(*) n FROM events').n > 1000);
  assert.ok(Math.abs(again.sessions - k.sessions) <= 2 && again.plus_subscribers === k.plus_subscribers, 'os mesmos números depois de restaurar');
});
