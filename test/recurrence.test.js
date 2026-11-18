// Testes do agendamento recorrente (v1.2): geração das datas, conflitos e sugestões, limite semanal de vagas
// sociais, pagamento do pacote com um PIX só, cancelamento parcial ("só esta" e "esta e as próximas"),
// prazo do PIX, lembretes, permissões e banco antigo. Sobe a API com um banco temporário e os dados de demonstração.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed.js';
import { occurrences, planPackage, nearestFree, socialPerWeek } from '../src/recurrence.js';
import { buildSlots } from '../src/slots.js';
import { addDays, weekday, todaySP, nowSP, toMinutes, fromMinutes } from '../src/time.js';
import { weekdaysText } from '../public/js/shared/data.js';

let server; let base; let dir; let db; let app;
const config = { demoMode: true, videoBaseUrl: 'https://meet.jit.si/', sessionDays: 7, production: false, heartbeatMs: 25000 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesalva-rec-'));
  db = openDb(join(dir, 'test.db'));
  const notesKey = randomBytes(32);
  seedDemo(db, { notesKey });
  app = createApp({ db, config, notesKey });
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
// Um login por conta, reaproveitado entre os testes (o servidor limita as tentativas de entrada por IP).
const logged = new Map();
async function login(email) {
  if (!logged.has(email)) {
    const api = client();
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password: 'demo1234' } });
    assert.equal(r.status, 200, `login de ${email}`);
    api.user = r.data.user;
    logged.set(email, api);
  }
  return logged.get(email);
}
const idOf = (email) => db.get('SELECT id FROM users WHERE email = ?', email).id;
// Próxima terça-feira depois de hoje (o roteiro da demonstração usa "ter e qui às 15:00" a partir dela).
const nextTuesday = () => { const t = todaySP(); return addDays(t, ((2 - weekday(t) + 7) % 7) || 7); };

/* ---------------- regras puras ---------------- */

test('recorrência: datas do pacote repetem o horário nos dias escolhidos, por N semanas, incluindo o primeiro dia', () => {
  const seg = '2026-11-23T08:00'; // segunda-feira
  const d = occurrences({ start: seg, weekdays: [1, 3], weeks: 4 });
  assert.deepEqual(d, ['2026-11-23T08:00', '2026-11-25T08:00', '2026-11-30T08:00', '2026-12-02T08:00',
    '2026-12-07T08:00', '2026-12-09T08:00', '2026-12-14T08:00', '2026-12-16T08:00']);
  // O dia do primeiro horário entra mesmo que não tenha sido marcado; cada dia aparece uma vez por semana.
  const ter = occurrences({ start: '2026-11-24T15:00', weekdays: [4], weeks: 12 });
  assert.equal(ter.length, 24);
  assert.equal(ter[0], '2026-11-24T15:00');
  assert.ok(ter.every((s) => s.endsWith('T15:00') && [2, 4].includes(weekday(s.slice(0, 10)))));
  // Atravessa a virada do ano sem pular nem repetir dias.
  const virada = occurrences({ start: '2026-12-28T10:00', weekdays: [1, 3, 5], weeks: 2 });
  assert.deepEqual(virada, ['2026-12-28T10:00', '2026-12-30T10:00', '2027-01-01T10:00', '2027-01-04T10:00', '2027-01-06T10:00', '2027-01-08T10:00']);
  assert.equal(weekdaysText([5, 1, 3]), 'seg, qua e sex');
  assert.equal(weekdaysText([0, 6]), 'sáb e dom');
});

test('recorrência: conflitos com outra pessoa, com o próprio paciente e fora da agenda, com sugestão do horário mais próximo', () => {
  const s = (start, taken = false, social = false) => ({ start, taken, social });
  const slots = [
    s('2026-12-01T09:00'), s('2026-12-01T10:00', true), s('2026-12-01T11:00'), s('2026-12-01T14:00'),
    s('2026-12-03T10:00'), s('2026-12-03T14:00'),
    s('2026-12-08T10:00'), s('2026-12-08T16:00'),
  ];
  const dates = ['2026-12-01T10:00', '2026-12-03T10:00', '2026-12-05T10:00', '2026-12-08T10:00'];
  const busy = ['2026-12-08T10:30']; // o paciente já tem outra sessão perto das 10:00 do dia 08
  const plan = planPackage({ dates, slots, busy });
  assert.deepEqual(plan.map((p) => [p.ok, p.reason]), [[false, 'taken'], [true, null], [false, 'unavailable'], [false, 'mine']]);
  // Ocupado às 10:00: 09:00 e 11:00 ficam a 1 hora; no empate, vale o mais cedo.
  assert.equal(plan[0].suggestion.start, '2026-12-01T09:00');
  // Dia sem atendimento (sábado 05): o mais próximo é a quinta 03 às 14:00 (a quinta às 10:00 já é do pacote).
  assert.equal(plan[2].suggestion.start, '2026-12-03T14:00');
  // Conflito com o próprio paciente às 10:30: a sugestão não pode bater com ele; vai para as 16:00 do mesmo dia.
  assert.equal(plan[3].suggestion.start, '2026-12-08T16:00');
  // Duas sugestões nunca caem no mesmo horário, e nada a mais de 3 dias de distância é sugerido.
  assert.equal(nearestFree('2026-12-20T10:00', slots, []), null);
  const twice = planPackage({ dates: ['2026-12-01T10:00', '2026-12-01T11:00'], slots: [s('2026-12-01T10:00', true), s('2026-12-01T11:00', true), s('2026-12-01T09:00')] });
  assert.equal(twice[0].suggestion.start, '2026-12-01T09:00');
  assert.equal(twice[1].suggestion, null, 'o único horário livre já foi sugerido para a outra data');
});

test('recorrência: o pacote nunca passa do limite semanal de vagas sociais do profissional', () => {
  // Recém-formado com 2 vagas sociais fixas por semana (as 2 primeiras da semana: seg e ter às 08:00).
  const pro = { is_new: true, supervisor: 'Supervisora (CRP 06/000000)', social_price: 4500, social_weekly: 2, auto_fill: false };
  const template = [1, 2, 3, 4].map((wd) => ({ weekday: wd, hour: '08:00' }));
  const now = '2026-11-22T12:00'; // domingo
  const slots = buildSlots({ pro, template, now, days: 60 }).flatMap((d) => d.items);
  const dates = occurrences({ start: '2026-11-23T08:00', weekdays: [1, 2, 3, 4], weeks: 8 });
  const plan = planPackage({ dates, slots });
  assert.equal(plan.filter((p) => p.ok).length, 32);
  const weeks = socialPerWeek(plan.map((p) => ({ start: p.start, social: p.slot.social })));
  assert.equal(Object.keys(weeks).length, 8);
  assert.ok(Object.values(weeks).every((n) => n === 2), JSON.stringify(weeks));
  // Quarta e quinta saem pelo valor normal, toda semana.
  assert.ok(plan.filter((p) => [3, 4].includes(weekday(p.start.slice(0, 10)))).every((p) => !p.slot.social));
});

/* ---------------- API ---------------- */

test('pacote: prévia com conflito e sugestão, criação com um PIX só e confirmação de todas as sessões', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const rid = idOf('rafael.nunes@demo.mesalva.app');
  const tue = nextTuesday();
  const q = `start=${tue}T15:00&weekdays=2,4&weeks=4`;
  const prev = await mariana(`/api/pros/${rid}/recurrence?${q}`);
  assert.equal(prev.status, 200, JSON.stringify(prev.data));
  assert.deepEqual(prev.data.weekdays, [2, 4]);
  assert.equal(prev.data.items.length, 8);
  // O cenário da demonstração: só a quinta da semana seguinte às 15:00 está ocupada, e a sugestão é 14:00.
  const bad = prev.data.items.filter((i) => !i.ok);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].start, `${addDays(tue, 9)}T15:00`);
  assert.equal(bad[0].reason, 'taken');
  assert.equal(bad[0].suggestion.start, `${addDays(tue, 9)}T14:00`);

  // Paciente escolhe usar a sugestão; o servidor recalcula cada preço.
  const sessions = prev.data.items.map((i) => (i.ok ? i.start : i.suggestion.start));
  const expected = prev.data.items.reduce((t, i) => t + (i.ok ? i.quote.amount : i.suggestion.quote.amount), 0);
  const made = await mariana('/api/packages', { method: 'POST', body: { pro_id: rid, start: `${tue}T15:00`, weekdays: [2, 4], weeks: 4, modality: 'presencial', sessions } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const pk = made.data.package;
  assert.equal(pk.status, 'pending');
  assert.equal(pk.amount, expected);
  assert.equal(pk.label, 'ter e qui, 15:00');
  assert.match(pk.pix_code, /^000201/);
  assert.ok(pk.pix_code.includes((expected / 100).toFixed(2)), 'o PIX leva o valor total do pacote');
  assert.equal(made.data.items.length, 8);
  assert.ok(made.data.items.every((a) => a.status === 'pending_payment'));
  // Cada sessão tem a própria cobrança, todas ligadas ao pacote.
  assert.equal(db.get("SELECT COUNT(*) n FROM payments WHERE package_id = ? AND status = 'pending' AND method = 'pix'", pk.id).n, 8);

  // Os horários ficam reservados: outra família não consegue marcar um deles.
  const carla = await login('carla.mendes@exemplo.mesalva.app');
  const steal = await carla('/api/appointments', { method: 'POST', body: { pro_id: rid, start: sessions[0], modality: 'presencial', method: 'pix' } });
  assert.equal(steal.status, 409);

  const paid = await mariana(`/api/packages/${pk.id}/pix-simulate`, { method: 'POST' });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.package.status, 'paid');
  assert.ok(paid.data.items.every((a) => a.status === 'confirmed' && a.room));
  assert.equal(db.get("SELECT COUNT(*) n FROM payments WHERE package_id = ? AND status = 'paid'", pk.id).n, 8);
  // Um aviso só no chat, com a sessão que ficou em outro horário.
  const chat = await mariana(`/api/conversations/${rid}`);
  const sys = chat.data.messages.filter((m) => m.kind === 'system' && m.body.startsWith('Pacote confirmado: 8 sessões'));
  assert.equal(sys.length, 1);
  assert.match(sys[0].body, /ter e qui, 15:00/);
  assert.match(sys[0].body, /Uma sessão ficou em outro horário: .* às 14:00/);
  // Uma notificação para cada lado (não uma por sessão).
  const nm = await mariana('/api/notifications');
  assert.equal(nm.data.notifications.filter((n) => n.title === 'Pacote confirmado' && n.param === String(pk.id)).length, 1);
  const nr = await rafael('/api/notifications');
  assert.equal(nr.data.notifications.filter((n) => n.title === 'Novo pacote confirmado' && n.body.includes('8 sessões')).length, 1);

  // A agenda traz o resumo do pacote para agrupar as sessões; a do profissional também.
  const ag = await mariana('/api/appointments');
  assert.equal(ag.data.upcoming.filter((a) => a.package_id === pk.id).length, 8);
  assert.equal(ag.data.packages[pk.id].label, 'ter e qui, 15:00');
  assert.equal(ag.data.packages[pk.id].upcoming, 8);
  const pa = await rafael('/api/appointments');
  assert.ok(pa.data.upcoming.some((a) => a.package_id === pk.id));
  assert.equal(pa.data.packages[pk.id].patient_name, 'Mariana Souza');

  // Montar o mesmo pacote de novo: todas as datas batem com as sessões que a Mariana acabou de marcar.
  const again = await mariana(`/api/pros/${rid}/recurrence?${q}`);
  // (A quinta às 15:00 continua sendo de outra família; a Mariana ficou com as 14:00, que não batem com as 15:00.)
  assert.deepEqual(again.data.items.map((i) => i.reason), prev.data.items.map((i) => (i.ok ? 'mine' : 'taken')));
});

test('pacote: vaga social e Me Salva+ calculados sessão por sessão, sem desconto de pacote', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rid = idOf('rafael.nunes@demo.mesalva.app');
  // Segunda às 10:00 é vaga social fixa do Rafael (R$ 45); quarta e sexta às 10:00, valor normal (R$ 90).
  const t = todaySP();
  const mon = addDays(t, ((1 - weekday(t) + 7) % 7) || 7);
  const prev = await mariana(`/api/pros/${rid}/recurrence?start=${mon}T10:00&weekdays=1,3,5&weeks=8`);
  assert.equal(prev.status, 200, JSON.stringify(prev.data));
  for (const it of prev.data.items) {
    const slot = it.ok ? it : it.suggestion;
    if (!slot) continue;
    const isMon = weekday(slot.start.slice(0, 10)) === 1 && slot.start.endsWith('10:00');
    if (isMon) assert.equal(slot.quote.amount, 4500, `${slot.start} é vaga social`);
    else if (!slot.social) assert.equal(slot.quote.amount, 9000);
  }
  // Nenhuma semana passa das 4 vagas sociais fixas do Rafael.
  const perWeek = socialPerWeek(prev.data.items.filter((i) => i.ok).map((i) => ({ start: i.start, social: i.social })));
  assert.ok(Object.values(perWeek).every((n) => n <= 4));
});

test('pacote: cancelar só uma sessão ou esta e as próximas, com reembolso e a regra de 24 h', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const mid = idOf('mariana@demo.mesalva.app');
  const pk = db.get("SELECT id FROM packages WHERE patient_id = ? AND time = '15:00' AND status = 'paid'", mid);
  assert.ok(pk, 'pacote criado no teste anterior');
  const items = () => db.all('SELECT * FROM appointments WHERE package_id = ? ORDER BY start', pk.id);
  const list = items();

  // Só esta: a 2ª sessão é cancelada e reembolsada; as outras continuam.
  const one = await mariana(`/api/appointments/${list[1].id}/cancel`, { method: 'POST', body: {} });
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.deepEqual(items().map((a) => a.status), ['confirmed', 'cancelled', ...Array(6).fill('confirmed')]);
  assert.equal(db.get('SELECT status FROM payments WHERE appointment_id = ?', list[1].id).status, 'refunded');

  // Esta e as próximas, a partir da 5ª: 4 sessões canceladas, um aviso só no chat e uma notificação para o Rafael.
  const before = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', rafael.user.id).n;
  const rest = await mariana(`/api/appointments/${list[4].id}/cancel`, { method: 'POST', body: { following: true } });
  assert.equal(rest.status, 200, JSON.stringify(rest.data));
  assert.equal(rest.data.cancelled, 4);
  assert.deepEqual(items().map((a) => a.status), ['confirmed', 'cancelled', 'confirmed', 'confirmed', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
  assert.equal(db.get("SELECT COUNT(*) n FROM payments WHERE package_id = ? AND status = 'refunded'", pk.id).n, 5);
  assert.equal(db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', rafael.user.id).n, before + 1);
  const note = db.get('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', rafael.user.id);
  assert.match(note.body, /^Mariana Souza cancelou 4 sessões do pacote \(de \d\d\/\d\d a \d\d\/\d\d\)\.$/);
  const sys = db.get("SELECT body FROM messages WHERE patient_id = ? AND pro_id = ? AND kind = 'system' ORDER BY id DESC LIMIT 1", mid, rafael.user.id);
  assert.match(sys.body, /^Pacote: 4 sessões canceladas pelo paciente/);

  // "Esta e as próximas" só vale para sessões de pacote.
  const solo = db.get("SELECT id FROM appointments WHERE patient_id = ? AND package_id IS NULL AND status = 'confirmed' ORDER BY start DESC LIMIT 1", mid);
  const notPkg = await mariana(`/api/appointments/${solo.id}/cancel`, { method: 'POST', body: { following: true } });
  assert.equal(notPkg.status, 400);

  // Regra de 24 h: se a 1ª sessão começa daqui a 5 horas, o paciente não cancela "esta e as próximas"; o profissional pode.
  const soon = items()[0];
  db.run('UPDATE appointments SET start = ? WHERE id = ?', fromMinutes(toMinutes(nowSP()) + 5 * 60), soon.id);
  const late = await mariana(`/api/appointments/${soon.id}/cancel`, { method: 'POST', body: { following: true } });
  assert.equal(late.status, 400);
  assert.match(late.data.error, /24 horas/);
  const byPro = await rafael(`/api/appointments/${soon.id}/cancel`, { method: 'POST', body: { following: true } });
  assert.equal(byPro.status, 200);
  assert.equal(byPro.data.cancelled, 3);
  assert.ok(items().every((a) => a.status === 'cancelled'));
  const toPatient = db.get("SELECT body FROM notifications WHERE user_id = ? AND kind = 'cancelled' ORDER BY id DESC LIMIT 1", mid);
  assert.match(toPatient.body, /^Rafael Nunes cancelou 3 sessões do pacote .* O valor pago será devolvido\.$/);
});

test('pacote: PIX não pago em 15 minutos libera todos os horários; outra pessoa não vê nem paga o pacote', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const carla = await login('carla.mendes@exemplo.mesalva.app');
  const rafael = await login('rafael.nunes@demo.mesalva.app');
  const rid = idOf('rafael.nunes@demo.mesalva.app');
  const tue = nextTuesday();
  const prev = await mariana(`/api/pros/${rid}/recurrence?start=${tue}T16:00&weekdays=2&weeks=4`);
  const sessions = prev.data.items.filter((i) => i.ok).map((i) => i.start);
  assert.ok(sessions.length >= 2);
  const made = await mariana('/api/packages', { method: 'POST', body: { pro_id: rid, start: `${tue}T16:00`, weekdays: [2], weeks: 4, modality: 'online', sessions } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.package_id;

  assert.equal((await carla(`/api/packages/${id}`)).status, 404);
  assert.equal((await carla(`/api/packages/${id}/pix-simulate`, { method: 'POST' })).status, 404, 'só o paciente dono paga');
  const asPro = await rafael(`/api/packages/${id}`);
  assert.equal(asPro.status, 200);
  assert.equal(asPro.data.package.pix_code, undefined, 'o profissional não recebe o código PIX');

  // Passam os 15 minutos.
  db.run('UPDATE packages SET expires_at = ? WHERE id = ?', Date.now() - 1000, id);
  db.run('UPDATE appointments SET expires_at = ? WHERE package_id = ?', Date.now() - 1000, id);
  const late = await mariana(`/api/packages/${id}/pix-simulate`, { method: 'POST' });
  assert.equal(late.status, 400);
  assert.match(late.data.error, /prazo de pagamento terminou/);
  assert.ok(db.all('SELECT status FROM appointments WHERE package_id = ?', id).every((a) => a.status === 'cancelled'));
  assert.ok(db.all('SELECT status FROM payments WHERE package_id = ?', id).every((p) => p.status === 'expired'));
  // Os horários voltaram a ficar livres.
  const again = await carla('/api/appointments', { method: 'POST', body: { pro_id: rid, start: sessions[0], modality: 'online', method: 'pix' } });
  assert.equal(again.status, 200);
});

test('pacote: validação do padrão e das sessões escolhidas', async () => {
  const mariana = await login('mariana@demo.mesalva.app');
  const rid = idOf('rafael.nunes@demo.mesalva.app');
  const tue = nextTuesday();
  const base = { pro_id: rid, start: `${tue}T14:00`, weekdays: [2, 4], weeks: 4, modality: 'presencial' };
  const post = (body) => mariana('/api/packages', { method: 'POST', body });
  assert.equal((await mariana(`/api/pros/${rid}/recurrence?start=${tue}T14:00&weekdays=2&weeks=5`)).status, 400, 'duração fora da lista');
  assert.equal((await mariana(`/api/pros/${rid}/recurrence?start=${tue}T14:00&weekdays=9&weeks=4`)).status, 400, 'dia da semana inválido');
  assert.equal((await mariana(`/api/pros/${rid}/recurrence?start=${tue}T14:00&weekdays=0,1,3,4,5,6&weeks=4`)).status, 400, 'dias demais');
  assert.equal((await mariana(`/api/pros/${rid}/recurrence?start=${tue}T13:00&weekdays=2&weeks=4`)).status, 400, 'primeiro horário fora da agenda');
  assert.equal((await post({ ...base, sessions: [`${tue}T14:00`] })).status, 400, 'pacote de uma sessão só');
  assert.equal((await post({ ...base, sessions: [`${tue}T14:00`, `${tue}T14:00`] })).status, 400, 'sessão repetida');
  assert.equal((await post({ ...base, sessions: [`${tue}T14:00`, `${addDays(tue, 60)}T14:00`] })).status, 400, 'sessão fora do período');
  assert.equal((await post({ ...base, sessions: [`${tue}T14:00`, `${tue}T13:00`] })).status, 400, 'horário que o profissional não atende');
  assert.equal((await post({ ...base, modality: 'outra', sessions: [`${tue}T14:00`, `${addDays(tue, 2)}T14:00`] })).status, 400, 'modalidade');
  const pro = await login('rafael.nunes@demo.mesalva.app');
  assert.equal((await pro('/api/packages', { method: 'POST', body: { ...base, sessions: [`${tue}T14:00`, `${addDays(tue, 2)}T14:00`] } })).status, 403, 'só paciente monta pacote');
});

test('pacote: os lembretes de 24 h e 1 h valem para cada sessão do pacote', () => {
  const mid = idOf('mariana@demo.mesalva.app');
  const a = db.get(`SELECT a.id, a.start FROM appointments a WHERE a.patient_id = ? AND a.package_id IS NOT NULL AND a.status = 'confirmed'
                    AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.appointment_id = a.id) ORDER BY a.start DESC LIMIT 1`, mid);
  assert.ok(a, 'há sessão de pacote sem lembrete');
  const at23h = fromMinutes(toMinutes(a.start) - 23 * 60);
  const sent = app.ctx.reminders.run({ now: at23h });
  assert.ok(sent.some((x) => x.appointment_id === a.id && x.kind === '24h'));
  const at50m = fromMinutes(toMinutes(a.start) - 50);
  assert.ok(app.ctx.reminders.run({ now: at50m }).some((x) => x.appointment_id === a.id && x.kind === '1h'));
  assert.deepEqual(app.ctx.reminders.run({ now: at50m }).filter((x) => x.appointment_id === a.id), [], 'sem repetir');
});

test('dados de demonstração: pacote seg e qua 08:00 da Mariana com o Rafael, com vaga social na segunda', () => {
  const mid = idOf('mariana@demo.mesalva.app');
  const pk = db.get("SELECT * FROM packages WHERE patient_id = ? AND time = '08:00'", mid);
  assert.ok(pk);
  assert.equal(pk.status, 'paid');
  assert.deepEqual(JSON.parse(pk.weekdays), [1, 3]);
  const appts = db.all('SELECT * FROM appointments WHERE package_id = ? ORDER BY start', pk.id);
  assert.ok(appts.length >= 14 && appts.length <= 16);
  assert.ok(appts.some((a) => a.status === 'done') && appts.some((a) => ['confirmed', 'cancelled'].includes(a.status)));
  assert.ok(appts.every((a) => a.social === (weekday(a.start.slice(0, 10)) === 1 ? 1 : 0)), 'segunda social, quarta normal');
});

test('banco antigo (v1.1): ganha as colunas do pacote sem perder dados', () => {
  const file = join(dir, 'antigo.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL);
    CREATE TABLE appointments(id INTEGER PRIMARY KEY, patient_id INTEGER, pro_id INTEGER NOT NULL, start TEXT NOT NULL, modality TEXT NOT NULL,
      social INTEGER NOT NULL DEFAULT 0, base_price INTEGER NOT NULL, amount INTEGER NOT NULL, fee INTEGER NOT NULL, pro_amount INTEGER NOT NULL,
      status TEXT NOT NULL, room TEXT, expires_at INTEGER, created_at TEXT);
    CREATE TABLE payments(id INTEGER PRIMARY KEY, user_id INTEGER, appointment_id INTEGER, kind TEXT NOT NULL, method TEXT NOT NULL, amount INTEGER NOT NULL,
      fee INTEGER NOT NULL DEFAULT 0, pro_amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, pix_code TEXT, card_last4 TEXT, created_at TEXT, paid_at TEXT);
    INSERT INTO users VALUES (1, 'pro', 'Ana', 'ana@x.app', 'h');
    INSERT INTO appointments(id, pro_id, start, modality, base_price, amount, fee, pro_amount, status) VALUES (7, 1, '2026-01-05T10:00', 'online', 9000, 9000, 1080, 7920, 'done');`);
  old.close();
  const migrated = openDb(file);
  assert.ok(migrated.all('PRAGMA table_info(appointments)').some((c) => c.name === 'package_id'));
  assert.ok(migrated.all('PRAGMA table_info(payments)').some((c) => c.name === 'package_id'));
  assert.equal(migrated.get('SELECT amount FROM appointments WHERE id = 7').amount, 9000);
  migrated.close();
  openDb(file).close(); // abrir de novo não tenta criar as colunas outra vez
});
