// Agendamento, pagamento simulado (PIX e cartão), sala de vídeo, encerramento e avaliação.
import { requireUser, requireRole } from '../guards.js';
import { HttpError } from '../http.js';
import { nowSP, toMinutes } from '../time.js';
import { quote } from '../pricing.js';
import { findSlot } from '../slots.js';
import { pixCode, luhn, randomId } from '../security.js';
import { int, oneOf, str, stamp, listOf, bad } from '../validate.js';

// Minutos que um horário fica reservado aguardando o pagamento.
const HOLD_MIN = 15;
// Destaques que o paciente pode marcar na avaliação.
export const REVIEW_TAGS = ['Acolhimento', 'Pontualidade', 'Me senti ouvido(a)', 'Explicações claras', 'Boa conexão de vídeo', 'Indicaria'];

// 'AAAA-MM-DDTHH:MM' → 'DD/MM/AAAA às HH:MM' (usado nas mensagens automáticas).
const fmtDay = (start) => {
  const [y, m, d] = start.slice(0, 10).split('-');
  return `${d}/${m}/${y} às ${start.slice(11)}`;
};

export default function appointmentRoutes(r, { db, config, svc }) {
  const getAppt = (id) => db.get('SELECT * FROM appointments WHERE id = ?', id);
  // Só o paciente e o profissional da sessão podem vê-la; para os demais, a resposta é 404.
  const mustOwn = (req, a) => {
    if (!a || (a.patient_id !== req.user.id && a.pro_id !== req.user.id)) throw new HttpError(404, 'Agendamento não encontrado.');
  };

  // Pagamento aprovado: marca como pago, confirma a sessão, cria a sala de vídeo e avisa os dois no chat.
  function confirm(paymentId) {
    db.tx(() => {
      const pay = db.get('SELECT * FROM payments WHERE id = ?', paymentId);
      const a = getAppt(pay.appointment_id);
      db.run("UPDATE payments SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", pay.id);
      db.run("UPDATE appointments SET status = 'confirmed', expires_at = NULL, room = ? WHERE id = ?", 'MeSalva-' + randomId(9), a.id);
      const where = a.modality === 'online' ? 'online, pela sala segura da plataforma' : 'presencial';
      svc.pushMessage({ patient_id: a.patient_id, pro_id: a.pro_id, kind: 'system', body: `Sessão confirmada para ${fmtDay(a.start)} (${where}).` });
    });
  }

  // Sessões do paciente ou do profissional, com nomes, avaliação e último pagamento de cada uma.
  function listFor(user) {
    svc.expirePending();
    const field = user.role === 'pro' ? 'a.pro_id' : 'a.patient_id';
    return db.all(`SELECT a.*, pu.name AS pro_name, pt.name AS patient_name, p.title AS pro_title, p.color AS pro_color, pu.bairro AS pro_bairro,
                          (SELECT id FROM reviews r WHERE r.appointment_id = a.id) AS review_id,
                          (SELECT rating FROM reviews r WHERE r.appointment_id = a.id) AS review_rating,
                          (SELECT id FROM payments y WHERE y.appointment_id = a.id ORDER BY y.id DESC LIMIT 1) AS payment_id
                   FROM appointments a JOIN users pu ON pu.id = a.pro_id JOIN pros p ON p.user_id = a.pro_id
                   LEFT JOIN users pt ON pt.id = a.patient_id
                   WHERE ${field} = ? AND a.status <> 'cancelled' ORDER BY a.start`, user.id)
      .map((a) => ({ ...a, patient_name: a.patient_name || 'Conta excluída', room_open: svc.roomOpen(a) }));
  }

  // Separa as próximas (confirmadas ou aguardando pagamento) das anteriores.
  r.get('/api/appointments', requireRole('patient', 'pro'), (req) => {
    const now = nowSP();
    const all = listFor(req.user);
    return {
      now,
      upcoming: all.filter((a) => ['confirmed', 'pending_payment'].includes(a.status) && toMinutes(a.start) >= toMinutes(now) - 60),
      past: all.filter((a) => !(['confirmed', 'pending_payment'].includes(a.status) && toMinutes(a.start) >= toMinutes(now) - 60)).reverse(),
    };
  });

  r.get('/api/appointments/:id', requireUser, (req) => {
    const a = listFor(req.user).find((x) => x.id === Number(req.params.id));
    if (!a) throw new HttpError(404, 'Agendamento não encontrado.');
    return { appointment: a };
  });

  // Cria a reserva e a cobrança. O horário fica guardado por 15 minutos até o pagamento.
  r.post('/api/appointments', requireRole('patient'), (req) => {
    const b = req.body;
    const p = svc.getPro(int(b.pro_id, 'o profissional', { min: 1 }));
    if (!p || p.status !== 'verified') throw new HttpError(404, 'Profissional não encontrado.');
    const start = stamp(b.start);
    const modality = oneOf(b.modality, p.modalities, 'a modalidade');
    const method = oneOf(b.method, ['pix', 'card'], 'a forma de pagamento');
    // O servidor recalcula os horários: o navegador não consegue inventar um horário nem um preço.
    const slot = findSlot(svc.slotsFor(p), start);
    if (!slot) throw bad('Esse horário não está disponível. Escolha outro.');
    if (slot.taken) throw new HttpError(409, 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');
    // Preço calculado no servidor, com vaga social e desconto do Me Salva+ incluídos.
    const qt = quote({ pro: p, social: slot.social, plus: req.user.plan === 'plus' });
    const ids = db.tx(() => {
      let apptId;
      try {
        apptId = db.run(`INSERT INTO appointments(patient_id, pro_id, start, modality, social, base_price, amount, fee, pro_amount, status, expires_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?)`,
        req.user.id, p.id, start, modality, slot.social ? 1 : 0, qt.base, qt.amount, qt.fee, qt.pro_amount, Date.now() + HOLD_MIN * 60000).lastInsertRowid;
      } catch (e) {
        // O índice único appt_slot barra duas pessoas reservando o mesmo horário ao mesmo tempo.
        if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');
        throw e;
      }
      const txid = `MS${apptId}${randomId(4)}`.replace(/[^A-Za-z0-9]/g, '');
      const payId = db.run(`INSERT INTO payments(user_id, appointment_id, kind, method, amount, fee, pro_amount, status, pix_code)
                            VALUES (?, ?, 'session', ?, ?, ?, ?, 'pending', ?)`,
      req.user.id, apptId, method, qt.amount, qt.fee, qt.pro_amount, method === 'pix' ? pixCode({ amountCents: qt.amount, txid }) : null).lastInsertRowid;
      return { apptId, payId };
    });
    return { appointment_id: ids.apptId, payment: db.get('SELECT * FROM payments WHERE id = ?', ids.payId), hold_minutes: HOLD_MIN };
  });

  // Pagamento do próprio usuário (404 para os de outras pessoas).
  const ownPayment = (req) => {
    svc.expirePending();
    const pay = db.get('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
    if (!pay || pay.user_id !== req.user.id) throw new HttpError(404, 'Pagamento não encontrado.');
    return pay;
  };
  const payView = (id) => {
    const pay = db.get('SELECT * FROM payments WHERE id = ?', id);
    const a = pay.appointment_id ? getAppt(pay.appointment_id) : null;
    return { payment: pay, appointment: a ? { ...a, pro_name: db.get('SELECT name FROM users WHERE id = ?', a.pro_id)?.name } : null };
  };

  r.get('/api/payments/:id', requireUser, (req) => payView(ownPayment(req).id));

  // Simula a confirmação do banco (no mundo real, viria de um webhook do provedor de PIX).
  r.post('/api/payments/:id/pix-simulate', requireUser, (req) => {
    const pay = ownPayment(req);
    if (pay.status === 'expired') throw bad('O prazo de pagamento terminou e o horário foi liberado. Faça um novo agendamento.');
    if (pay.status !== 'pending' || pay.method !== 'pix') throw bad('Este pagamento não está aguardando PIX.');
    confirm(pay.id);
    return payView(pay.id);
  });

  // Cartão simulado: aprova números válidos; o cartão de teste 4000 0000 0000 0002 é recusado.
  r.post('/api/payments/:id/card', requireUser, (req) => {
    const pay = ownPayment(req);
    if (pay.status === 'expired') throw bad('O prazo de pagamento terminou e o horário foi liberado. Faça um novo agendamento.');
    if (pay.status !== 'pending') throw bad('Este pagamento já foi processado.');
    const c = req.body.card || {};
    const number = String(c.number || '').replace(/\D/g, '');
    str(c.name, 'o nome impresso no cartão', { min: 3, max: 60 });
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(c.exp || ''))) throw bad('Informe a validade no formato MM/AA.');
    if (!/^\d{3,4}$/.test(String(c.cvv || ''))) throw bad('Informe o código de segurança (CVV) com 3 ou 4 dígitos.');
    if (!luhn(number)) throw bad('Número de cartão inválido. No ambiente de teste, use 4242 4242 4242 4242.');
    if (number === '4000000000000002') {
      db.run("UPDATE payments SET status = 'failed' WHERE id = ?", pay.id);
      db.run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", pay.appointment_id);
      throw new HttpError(402, 'Pagamento recusado pelo emissor do cartão. O horário foi liberado; tente de novo com outro cartão.');
    }
    db.run("UPDATE payments SET method = 'card', card_last4 = ? WHERE id = ?", number.slice(-4), pay.id);
    confirm(pay.id);
    return payView(pay.id);
  });

  // Cancelamento: paciente até 24 h antes (com reembolso); profissional a qualquer momento.
  r.post('/api/appointments/:id/cancel', requireRole('patient', 'pro'), (req) => {
    const a = getAppt(Number(req.params.id));
    mustOwn(req, a);
    if (!['confirmed', 'pending_payment'].includes(a.status)) throw bad('Esta sessão não pode mais ser cancelada.');
    const hoursLeft = (toMinutes(a.start) - toMinutes(nowSP())) / 60;
    if (req.user.role === 'patient' && a.status === 'confirmed' && hoursLeft < 24) {
      throw bad('Cancelamentos pelo paciente são aceitos até 24 horas antes. Fale com o profissional pelo chat.');
    }
    db.tx(() => {
      db.run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", a.id);
      db.run("UPDATE payments SET status = CASE status WHEN 'paid' THEN 'refunded' ELSE 'expired' END WHERE appointment_id = ? AND status IN ('paid','pending')", a.id);
      if (a.status === 'confirmed') {
        svc.pushMessage({ patient_id: a.patient_id, pro_id: a.pro_id, kind: 'system',
          body: `Sessão de ${fmtDay(a.start)} cancelada pelo ${req.user.role === 'pro' ? 'profissional' : 'paciente'}. O valor pago será devolvido.` });
      }
    });
    return { ok: true };
  });

  // Link da sala de vídeo (Jitsi), liberado só para os dois participantes e no horário certo.
  r.get('/api/appointments/:id/room', requireUser, (req) => {
    const a = getAppt(Number(req.params.id));
    mustOwn(req, a);
    if (a.modality !== 'online') throw bad('Esta sessão é presencial.');
    if (!svc.roomOpen(a)) throw bad('A sala abre 15 minutos antes do horário da sessão.');
    const other = req.user.id === a.pro_id ? db.get('SELECT id, name FROM users WHERE id = ?', a.patient_id) : svc.getPro(a.pro_id);
    svc.audit(req.user.id, 'room.join', String(a.id));
    return { url: config.videoBaseUrl + a.room, appointment: a, other: other ? { id: other.id, name: other.name, title: other.title || 'Paciente', color: other.color || '#3E8E7E' } : null };
  });

  // Encerra a sessão (status done), o que libera a avaliação pelo paciente.
  r.post('/api/appointments/:id/finish', requireUser, (req) => {
    const a = getAppt(Number(req.params.id));
    mustOwn(req, a);
    if (a.status === 'done') return { appointment: a };
    if (a.status !== 'confirmed') throw bad('Só é possível encerrar sessões confirmadas.');
    if (!config.demoMode && toMinutes(nowSP()) < toMinutes(a.start)) throw bad('A sessão ainda não começou.');
    db.run("UPDATE appointments SET status = 'done' WHERE id = ?", a.id);
    return { appointment: getAppt(a.id) };
  });

  // O profissional registra que o paciente faltou.
  r.post('/api/appointments/:id/no-show', requireRole('pro'), (req) => {
    const a = getAppt(Number(req.params.id));
    mustOwn(req, a);
    if (a.status !== 'confirmed') throw bad('Só é possível registrar falta em sessões confirmadas.');
    if (!config.demoMode && toMinutes(nowSP()) < toMinutes(a.start)) throw bad('A sessão ainda não começou.');
    db.run("UPDATE appointments SET status = 'no_show' WHERE id = ?", a.id);
    return { ok: true };
  });

  // Avaliação: só quem fez a sessão pela plataforma, uma vez por sessão.
  r.post('/api/appointments/:id/review', requireRole('patient'), (req) => {
    const a = getAppt(Number(req.params.id));
    if (!a || a.patient_id !== req.user.id) throw new HttpError(404, 'Agendamento não encontrado.');
    if (a.status !== 'done') throw bad('A avaliação fica disponível depois que a sessão é realizada.');
    if (db.get('SELECT 1 FROM reviews WHERE appointment_id = ?', a.id)) throw bad('Você já avaliou esta sessão.');
    const rating = int(req.body.rating, 'a nota', { min: 1, max: 5 });
    const tags = listOf(req.body.tags, REVIEW_TAGS, 'os destaques');
    const text = str(req.body.text, 'o comentário', { optional: true, max: 600 });
    const parts = req.user.name.trim().split(/\s+/);
    // O autor aparece como 'Mariana S.' ou 'Anônimo', nunca com o nome completo.
    const label = req.body.anonymous ? 'Anônimo' : `${parts[0]}${parts.length > 1 ? ' ' + parts[parts.length - 1][0] + '.' : ''}`;
    db.run('INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, tags, text, author_label, modality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      a.id, req.user.id, a.pro_id, rating, JSON.stringify(tags), text, label, a.modality);
    return { ok: true, pro: svc.getPro(a.pro_id) };
  });

  r.get('/api/review-tags', () => ({ tags: REVIEW_TAGS }));
}

