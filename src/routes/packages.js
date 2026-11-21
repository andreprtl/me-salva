// Agendamento recorrente (v1.2): prévia do pacote com conflitos e sugestões, criação com um PIX só para o
// pacote inteiro, consulta e confirmação do pagamento. O cancelamento (só esta sessão ou "esta e as próximas")
// fica em routes/appointments.js, junto do cancelamento das sessões avulsas.
//
// Regras:
//   - o primeiro horário sai da lista normal de horários (próximas 2 semanas); as outras datas repetem o mesmo
//     horário nos dias da semana escolhidos, por 4, 8 ou 12 semanas;
//   - cada sessão continua sendo uma linha de appointments, com o próprio valor e o próprio pagamento: o preço
//     (inclusive a vaga social) é calculado sessão por sessão, como num agendamento avulso, e o limite semanal de
//     vagas sociais do profissional continua valendo, porque a vaga social é uma propriedade do horário (slots.js);
//   - o paciente paga um PIX só, com o total; não há desconto de pacote (o modelo de negócio não muda);
//   - os horários ficam reservados por 15 minutos até o pagamento, como no agendamento avulso.
import { requireRole } from '../guards.js';
import { HttpError } from '../http.js';
import { nowSP, addDays, toMinutes, weekday, whenText } from '../time.js';
import { quote } from '../pricing.js';
import { findSlot } from '../slots.js';
import { occurrences, planPackage, overlaps, SUGGEST_DAYS } from '../recurrence.js';
import { pixCode, randomId } from '../security.js';
import { int, oneOf, stamp, bad } from '../validate.js';
import { RECURRENCE } from '../../public/js/shared/data.js';
import { HOLD_MIN } from './appointments.js';

// Segunda primeiro: [0, 3, 1] → [1, 3, 0].
const mondayFirst = (a, b) => ((a + 6) % 7) - ((b + 6) % 7);
// 'AAAA-MM-DDTHH:MM' → 'DD/MM'.
const dm = (start) => `${start.slice(8, 10)}/${start.slice(5, 7)}`;

export default function packageRoutes(r, { db, svc }) {
  // Lê e confere o padrão do pacote: profissional, primeiro horário, dias da semana e número de semanas.
  // O dia do primeiro horário sempre faz parte dos dias escolhidos.
  function pattern(src) {
    const p = svc.getPro(int(src.pro_id, 'o profissional', { min: 1 }));
    if (!p || p.status !== 'verified') throw new HttpError(404, 'Profissional não encontrado.');
    const start = stamp(src.start);
    const raw = Array.isArray(src.weekdays) ? src.weekdays : String(src.weekdays ?? '').split(',').filter((x) => x !== '');
    const days = raw.map(Number);
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad('Escolha dias da semana válidos.');
    const weekdays = [...new Set([...days, weekday(start.slice(0, 10))])].sort(mondayFirst);
    if (weekdays.length > RECURRENCE.maxDays) throw bad(`Escolha no máximo ${RECURRENCE.maxDays} dias por semana.`);
    const weeks = Number(src.weeks);
    if (!RECURRENCE.weeks.includes(weeks)) throw bad(`Escolha a duração do pacote: ${RECURRENCE.weeks.join(', ').replace(/, (\d+)$/, ' ou $1')} semanas.`);
    if (!findSlot(svc.slotsFor(p), start)) throw bad('Esse horário não está disponível. Escolha outro.');
    const dates = occurrences({ start, weekdays, weeks });
    return { p, start, weekdays, weeks, dates };
  }

  // Horários do profissional de hoje até alguns dias depois da última data (para as sugestões), numa lista só.
  function horizon(p, dates) {
    const now = nowSP();
    const days = (toMinutes(dates.at(-1).slice(0, 10)) - toMinutes(now.slice(0, 10))) / 1440 + 1 + SUGGEST_DAYS;
    return svc.slotsFor(p, { now, days }).flatMap((d) => d.items);
  }
  // Sessões que o paciente já tem no período (com qualquer profissional).
  const busyFor = (userId, dates) => svc.patientBusy(userId, nowSP().slice(0, 10), addDays(dates.at(-1).slice(0, 10), SUGGEST_DAYS));

  // Prévia: cada data do pacote com o valor, os conflitos e a sugestão de horário livre mais próximo.
  // GET /api/pros/:id/recurrence?start=AAAA-MM-DDTHH:MM&weekdays=1,3&weeks=8
  r.get('/api/pros/:id/recurrence', requireRole('patient'), (req) => {
    const { p, start, weekdays, weeks, dates } = pattern({ ...req.query, pro_id: req.params.id });
    const plus = req.user.plan === 'plus';
    const price = (slot) => quote({ pro: p, social: slot.social, plus });
    const items = planPackage({ dates, slots: horizon(p, dates), busy: busyFor(req.user.id, dates) }).map((it) => ({
      start: it.start, ok: it.ok, reason: it.reason,
      social: Boolean(it.slot?.social), quote: it.slot ? price(it.slot) : null,
      suggestion: it.suggestion ? { start: it.suggestion.start, social: it.suggestion.social, quote: price(it.suggestion) } : null,
    }));
    return { pro_id: p.id, start, weekdays, weeks, time: start.slice(11, 16), items };
  });

  // Cria o pacote com as sessões escolhidas na prévia (as datas que ficaram e as sugestões aceitas) e o PIX do total.
  // O servidor confere de novo cada horário e recalcula cada preço: o navegador não escolhe valores.
  r.post('/api/packages', requireRole('patient'), (req) => {
    const b = req.body;
    const { p, start, weekdays, weeks, dates } = pattern(b);
    const modality = oneOf(b.modality, p.modalities, 'a modalidade');
    const raw = Array.isArray(b.sessions) ? b.sessions : [];
    const starts = [...new Set(raw.map(stamp))].sort();
    if (starts.length !== raw.length) throw bad('Há sessões repetidas no pacote.');
    if (starts.length < 2) throw bad('Um pacote precisa de pelo menos 2 sessões.');
    if (starts.length > dates.length) throw bad('O pacote tem mais sessões do que o período escolhido comporta.');
    const lo = addDays(dates[0].slice(0, 10), -SUGGEST_DAYS);
    const hi = addDays(dates.at(-1).slice(0, 10), SUGGEST_DAYS) + 'T99';
    const slots = new Map(horizon(p, dates).map((s) => [s.start, s]));
    const busy = busyFor(req.user.id, dates);
    starts.forEach((s, i) => {
      const slot = slots.get(s);
      if (!slot || s < lo || s > hi) throw bad(`O horário de ${whenText(s)} não está disponível. Revise o pacote.`);
      if (slot.taken) throw new HttpError(409, `O horário de ${whenText(s)} acabou de ser reservado por outra pessoa. Revise o pacote.`);
      if (busy.some((x) => overlaps(x, s))) throw bad(`Você já tem uma sessão perto de ${whenText(s)}. Revise o pacote.`);
      if (i > 0 && overlaps(starts[i - 1], s)) throw bad('Duas sessões do pacote ficaram no mesmo horário. Revise o pacote.');
    });

    const plus = req.user.plan === 'plus';
    const items = starts.map((s) => ({ start: s, social: slots.get(s).social, q: quote({ pro: p, social: slots.get(s).social, plus }) }));
    const total = items.reduce((t, it) => t + it.q.amount, 0);
    const expires = Date.now() + HOLD_MIN * 60000;
    const id = db.tx(() => {
      const pkgId = db.run(`INSERT INTO packages(patient_id, pro_id, weekdays, time, weeks, modality, amount, status, expires_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      req.user.id, p.id, JSON.stringify(weekdays), start.slice(11, 16), weeks, modality, total, expires).lastInsertRowid;
      for (const it of items) {
        let apptId;
        try {
          apptId = db.run(`INSERT INTO appointments(patient_id, pro_id, package_id, start, modality, social, base_price, amount, fee, pro_amount, status, expires_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?)`,
          req.user.id, p.id, pkgId, it.start, modality, it.social ? 1 : 0, it.q.base, it.q.amount, it.q.fee, it.q.pro_amount, expires).lastInsertRowid;
        } catch (e) {
          // O índice único appt_slot barra duas pessoas reservando o mesmo horário ao mesmo tempo.
          if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `O horário de ${whenText(it.start)} acabou de ser reservado por outra pessoa. Revise o pacote.`);
          throw e;
        }
        db.run(`INSERT INTO payments(user_id, appointment_id, package_id, kind, method, amount, fee, pro_amount, status)
                VALUES (?, ?, ?, 'session', 'pix', ?, ?, ?, 'pending')`, req.user.id, apptId, pkgId, it.q.amount, it.q.fee, it.q.pro_amount);
      }
      const txid = `MSP${pkgId}${randomId(4)}`.replace(/[^A-Za-z0-9]/g, '');
      db.run('UPDATE packages SET pix_code = ? WHERE id = ?', pixCode({ amountCents: total, txid }), pkgId);
      // Funil (v1.3): um pacote conta como uma reserva (ref_id = pacote), não uma por sessão.
      svc.track('booking_created', { user_id: req.user.id, pro_id: p.id, ref_id: pkgId });
      return pkgId;
    });
    return { package_id: id, ...detail(id, req.user), hold_minutes: HOLD_MIN };
  });

  // Pacote do próprio paciente ou profissional; para os demais, 404.
  function own(req) {
    svc.expirePending();
    const pk = db.get('SELECT * FROM packages WHERE id = ?', Number(req.params.id));
    if (!pk || (pk.patient_id !== req.user.id && pk.pro_id !== req.user.id)) throw new HttpError(404, 'Pacote não encontrado.');
    return pk;
  }
  // Pacote com todas as sessões. O código PIX só vai para o paciente que paga.
  function detail(id, user) {
    const pk = db.get('SELECT * FROM packages WHERE id = ?', id);
    const items = db.all(`SELECT a.id, a.start, a.modality, a.social, a.base_price, a.amount, a.fee, a.pro_amount, a.status, a.room, a.patient_id, a.pro_id,
                                 (SELECT id FROM reviews r WHERE r.appointment_id = a.id) AS review_id,
                                 (SELECT rating FROM reviews r WHERE r.appointment_id = a.id) AS review_rating
                          FROM appointments a WHERE a.package_id = ? ORDER BY a.start`, id)
      .map((a) => ({ ...a, social: Boolean(a.social), room_open: svc.roomOpen(a) }));
    const view = svc.packageView(pk);
    return { package: { ...view, pix_code: user.id === pk.patient_id ? pk.pix_code : undefined }, items, now: nowSP() };
  }

  r.get('/api/packages/:id', requireRole('patient', 'pro'), (req) => detail(own(req).id, req.user));

  // Simula a confirmação do PIX do pacote: todas as sessões ficam confirmadas de uma vez.
  r.post('/api/packages/:id/pix-simulate', requireRole('patient'), (req) => {
    const pk = own(req);
    if (pk.patient_id !== req.user.id) throw new HttpError(404, 'Pacote não encontrado.');
    if (pk.status === 'expired') throw bad('O prazo de pagamento terminou e os horários foram liberados. Monte o pacote de novo.');
    if (pk.status !== 'pending') throw bad('Este pacote não está aguardando pagamento.');
    confirmPackage(pk.id);
    return detail(pk.id, req.user);
  });

  // Pagamento aprovado: confirma as sessões, cria as salas de vídeo, manda um aviso só no chat (não um por sessão)
  // e uma notificação para cada lado. Os lembretes de 24 h e 1 h (reminders.js) valem para cada sessão do pacote.
  function confirmPackage(id) {
    db.tx(() => {
      const pk = db.get('SELECT * FROM packages WHERE id = ?', id);
      const appts = db.all("SELECT * FROM appointments WHERE package_id = ? AND status = 'pending_payment' ORDER BY start", id);
      db.run("UPDATE payments SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE package_id = ? AND status = 'pending'", id);
      for (const a of appts) db.run("UPDATE appointments SET status = 'confirmed', expires_at = NULL, room = ? WHERE id = ?", 'MeSalva-' + randomId(9), a.id);
      db.run("UPDATE packages SET status = 'paid', expires_at = NULL, paid_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", id);
      svc.track('payment_confirmed', { user_id: pk.patient_id, pro_id: pk.pro_id, ref_id: id });
      const v = svc.packageView(pk);
      const [first, last] = [appts[0], appts.at(-1)];
      const where = pk.modality === 'online' ? 'online, pela sala segura da plataforma' : 'presencial';
      // Sessões que ficaram num horário alternativo (sugestão aceita) são citadas uma a uma.
      const moved = appts.filter((a) => a.start.slice(11, 16) !== pk.time || !v.weekdays.includes(weekday(a.start.slice(0, 10))));
      let body = `Pacote confirmado: ${appts.length} sessões (${v.label}), de ${dm(first.start)} a ${dm(last.start)}, ${where}.`;
      if (moved.length) body += ` ${moved.length === 1 ? 'Uma sessão ficou' : `${moved.length} sessões ficaram`} em outro horário: ${moved.map((a) => whenText(a.start)).join('; ')}.`;
      svc.pushMessage({ patient_id: pk.patient_id, pro_id: pk.pro_id, kind: 'system', body });
      const social = appts.filter((a) => a.social).length;
      const modal = pk.modality === 'online' ? 'online' : 'presencial';
      svc.notify(pk.patient_id, { kind: 'confirmed', title: 'Pacote confirmado', body: `Suas ${appts.length} sessões com ${v.pro_name} estão confirmadas (${v.label}, a partir de ${whenText(first.start)}).`, screen: 'pacote', param: String(id) });
      svc.notify(pk.pro_id, { kind: 'confirmed', title: 'Novo pacote confirmado', body: `${v.patient_name} marcou ${appts.length} sessões (${v.label}, ${modal}${social ? `, ${social} em vaga social` : ''}).`, screen: 'proagenda' });
    });
  }
}
