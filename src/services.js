// Consultas e regras reaproveitadas por várias rotas (criadas uma vez em createApp e passadas como ctx.svc).
// Também é aqui que as gravações viram eventos em tempo real (hub, em realtime.js).
import { json } from './db.js';
import { nowSP, toMinutes } from './time.js';
import { buildSlots } from './slots.js';
import { createEvents } from './events.js';
import { BAIRROS, distanceKm, weekdaysText } from '../public/js/shared/data.js';

// Status que ocupam um horário na agenda (uma sessão cancelada libera o horário).
const ACTIVE = "('pending_payment','confirmed','done','no_show')";

// Formato de uma mensagem enviado ao navegador; o áudio em si é baixado à parte em /api/messages/:id/audio.
// seen ("visto"): a outra pessoa da conversa já abriu a mensagem. Mensagens do sistema não têm visto.
export function messageView(m) {
  const seen = m.kind !== 'system' && Boolean(m.sender_id === m.patient_id ? m.read_by_pro : m.read_by_patient);
  return { id: m.id, sender_id: m.sender_id, kind: m.kind, body: m.body, duration: m.duration, created_at: m.created_at, seen };
}

// Formato de uma notificação enviado ao navegador.
export function notificationView(n) {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, screen: n.screen, param: n.param, read: Boolean(n.read_at), created_at: n.created_at };
}

// hub é o distribuidor de eventos em tempo real; sem ele (scripts e testes de regra), os eventos são ignorados.
// push é o Web Push (v1.2, src/push.js), que leva cada notificação aos aparelhos inscritos, mesmo com o app fechado.
export function createServices(db, config, hub = { send() {} }, push = null) {
  // Reservas aguardando pagamento por mais de 15 minutos liberam o horário (também as sessões de um pacote
  // cujo PIX não foi pago: o pacote inteiro vence junto).
  function expirePending() {
    const now = Date.now();
    db.run(`UPDATE payments SET status='expired' WHERE status='pending' AND appointment_id IN
            (SELECT id FROM appointments WHERE status='pending_payment' AND expires_at < ?)`, now);
    db.run(`UPDATE appointments SET status='cancelled' WHERE status='pending_payment' AND expires_at < ?`, now);
    db.run(`UPDATE packages SET status='expired' WHERE status='pending' AND expires_at < ?`, now);
  }

  // Horários das sessões ativas (aguardando pagamento ou confirmadas) de um paciente entre duas datas,
  // com qualquer profissional. O agendamento recorrente usa isto para não marcar duas sessões ao mesmo tempo.
  const patientBusy = (patientId, fromDay, toDay) => db.all(
    `SELECT start FROM appointments WHERE patient_id = ? AND status IN ('pending_payment','confirmed') AND start >= ? AND start < ?`,
    patientId, fromDay, toDay + 'T99').map((r) => r.start);

  // Resumo de um pacote recorrente para a interface: padrão em texto ('seg e qua, 08:00'), contagens e valores.
  function packageView(pk) {
    if (!pk) return null;
    const weekdays = json(pk.weekdays);
    const c = db.get(`SELECT COUNT(*) total,
                        SUM(status IN ('confirmed','pending_payment')) upcoming, SUM(status = 'done') done,
                        SUM(status = 'no_show') no_show, SUM(status = 'cancelled') cancelled,
                        SUM(CASE WHEN status <> 'cancelled' THEN amount ELSE 0 END) active_amount,
                        MIN(start) first, MAX(start) last
                      FROM appointments WHERE package_id = ?`, pk.id);
    const pro = db.get('SELECT u.name, p.title, p.color FROM users u JOIN pros p ON p.user_id = u.id WHERE u.id = ?', pk.pro_id);
    return {
      id: pk.id, patient_id: pk.patient_id, pro_id: pk.pro_id, weekdays, time: pk.time, weeks: pk.weeks, modality: pk.modality,
      label: `${weekdaysText(weekdays)}, ${pk.time}`, per_week: weekdays.length,
      status: pk.status, amount: pk.amount, expires_at: pk.expires_at, paid_at: pk.paid_at, created_at: pk.created_at,
      pro_name: pro?.name || 'Profissional', pro_title: pro?.title || '', pro_color: pro?.color || '#2F7D69',
      patient_name: pk.patient_id ? db.get('SELECT name FROM users WHERE id = ?', pk.patient_id)?.name || 'Conta excluída' : 'Conta excluída',
      sessions: c.total, upcoming: c.upcoming || 0, done: c.done || 0, no_show: c.no_show || 0, cancelled: c.cancelled || 0,
      active_amount: c.active_amount || 0, first: c.first, last: c.last,
    };
  }

  // Profissional com nota média e número de avaliações calculados a partir da tabela reviews.
  const PRO_SELECT = `SELECT u.id, u.name, u.email, u.bairro, p.*,
      COALESCE(r.avg, 0) AS rating, COALESCE(r.n, 0) AS rating_count
    FROM users u JOIN pros p ON p.user_id = u.id
    LEFT JOIN (SELECT pro_id, AVG(rating) avg, COUNT(*) n FROM reviews GROUP BY pro_id) r ON r.pro_id = u.id`;

  // Converte a linha do banco no objeto usado pela API (listas JSON viram arrays).
  // A vaga social só vale para recém-formados com supervisor cadastrado.
  function parsePro(r) {
    if (!r) return null;
    return {
      id: r.id, name: r.name, bairro: r.bairro, area: r.area, title: r.title, reg: r.reg,
      approach: r.approach, approach_short: r.approach_short,
      topics: json(r.topics), audience: json(r.audience), modalities: json(r.modalities),
      price: r.price, years: r.years, bio: r.bio, color: r.color,
      is_new: Boolean(r.is_new), supervisor: r.supervisor || null,
      social_price: r.is_new && r.supervisor ? r.social_price : null,
      social_weekly: r.social_weekly, auto_fill: Boolean(r.auto_fill),
      status: r.status, rating: Math.round(r.rating * 10) / 10, rating_count: r.rating_count,
      map: BAIRROS[r.bairro] || BAIRROS['Bela Vista'],
    };
  }

  // Um profissional pelo id (qualquer status) ou a lista dos verificados.
  const getPro = (id) => parsePro(db.get(`${PRO_SELECT} WHERE u.id = ?`, id));
  const listPros = (where = "p.status = 'verified'") => db.all(`${PRO_SELECT} WHERE ${where} ORDER BY u.id`).map(parsePro);

  // Disponibilidade semanal (dia da semana + hora) e horários já ocupados a partir de uma data.
  const template = (id) => db.all('SELECT weekday, hour FROM availability WHERE pro_id = ? ORDER BY weekday, hour', id);
  const taken = (id, fromDay) => new Set(db.all(
    `SELECT start FROM appointments WHERE pro_id = ? AND start >= ? AND status IN ${ACTIVE}`, id, fromDay).map((r) => r.start));

  // Horários dos próximos dias de um profissional, já sem as reservas vencidas.
  function slotsFor(pro, { now = nowSP(), days = 14 } = {}) {
    expirePending();
    return buildSlots({ pro, template: template(pro.id), taken: taken(pro.id, now.slice(0, 10)), now, days });
  }

  // Registro de auditoria (entrada, leitura de prontuário, aprovação de registro etc.).
  function audit(userId, action, target) {
    db.run('INSERT INTO audit(user_id, action, target) VALUES (?, ?, ?)', userId ?? null, action, target ?? null);
  }

  // Grava uma mensagem no chat. Quem enviou já a vê como lida; mensagens do sistema (sender_id nulo) chegam não lidas para os dois.
  // Depois de gravada (e da transação confirmada, se houver uma), a mensagem é empurrada em tempo real para os dois lados.
  function pushMessage({ patient_id, pro_id, sender_id = null, kind = 'text', body = '', audio = null, duration = null }) {
    const byPatient = sender_id === patient_id ? 1 : 0;
    const byPro = sender_id === pro_id ? 1 : 0;
    const id = db.run(`INSERT INTO messages(patient_id, pro_id, sender_id, kind, body, audio, duration, read_by_patient, read_by_pro)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, patient_id, pro_id, sender_id, kind, body, audio, duration, byPatient, byPro).lastInsertRowid;
    if (sender_id && kind !== 'system') notifyMessage({ patient_id, pro_id, sender_id });
    db.afterCommit(() => publishMessage(id));
    return id;
  }

  // Notificação de mensagem nova para quem recebeu. Cada conversa tem um aviso só, que volta ao topo como não lido
  // a cada mensagem nova ("Fernanda Alves enviou 3 mensagens."). O texto da mensagem não entra na notificação:
  // o aviso do sistema pode aparecer na tela bloqueada do aparelho, e a conversa é sobre saúde.
  function notifyMessage({ patient_id, pro_id, sender_id }) {
    const toPatient = sender_id === pro_id;
    const to = toPatient ? patient_id : pro_id;
    const readCol = toPatient ? 'read_by_patient' : 'read_by_pro';
    const from = db.get('SELECT name FROM users WHERE id = ?', sender_id)?.name || 'Alguém';
    const n = db.get(`SELECT COUNT(*) n FROM messages WHERE patient_id = ? AND pro_id = ? AND sender_id = ? AND ${readCol} = 0`, patient_id, pro_id, sender_id).n;
    notify(to, {
      kind: 'message', title: 'Nova mensagem', body: n > 1 ? `${from} enviou ${n} mensagens.` : `${from} enviou uma mensagem.`,
      screen: 'chat', param: String(sender_id), ref: `chat:${sender_id}`,
    });
  }

  // Cria uma notificação e a empurra em tempo real para as abas do usuário (depois do COMMIT).
  // Com ref, a notificação do mesmo assunto é reaproveitada: atualiza o texto, volta a ficar não lida e sobe para o topo.
  // Assim a central não acumula um "Nova mensagem" por mensagem de uma conversa que a pessoa já está lendo.
  function notify(userId, { kind, title, body = '', screen = null, param = null, ref = null }) {
    if (!userId) return null;
    let id = ref ? db.get('SELECT id FROM notifications WHERE user_id = ? AND ref = ? ORDER BY id DESC LIMIT 1', userId, ref)?.id : null;
    if (id) {
      db.run("UPDATE notifications SET title = ?, body = ?, read_at = NULL, created_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", title, body, id);
    } else {
      id = db.run('INSERT INTO notifications(user_id, kind, title, body, screen, param, ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
        userId, kind, title, body, screen, param, ref).lastInsertRowid;
    }
    db.afterCommit(() => {
      const row = db.get('SELECT * FROM notifications WHERE id = ?', id);
      if (!row) return;
      hub.send(userId, 'notification', { notification: notificationView(row) });
      sendCounts(userId);
      // Web Push: segue em segundo plano, sem atrasar a resposta de quem causou a notificação.
      push?.sendTo(userId, notificationView(row)).catch((e) => console.warn('Web Push:', e.message));
    });
    return id;
  }

  // Marca como lidas as notificações de mensagem de uma conversa (quando a pessoa abre a conversa).
  const readChatNotifications = (userId, otherId) => db.run(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id = ? AND ref = ? AND read_at IS NULL", userId, `chat:${otherId}`).changes;

  // Evento 'message' para as duas pessoas da conversa (e só para elas). Cada lado recebe o id da conversa
  // do seu ponto de vista: para o paciente, a conversa é o profissional; para o profissional, o paciente.
  function publishMessage(id) {
    const m = db.get('SELECT * FROM messages WHERE id = ?', id);
    if (!m) return;
    const message = messageView(m);
    hub.send(m.patient_id, 'message', { conversation: m.pro_id, message });
    hub.send(m.pro_id, 'message', { conversation: m.patient_id, message });
    sendCounts(m.patient_id);
    sendCounts(m.pro_id);
  }

  // Mensagens não lidas do usuário logado (o número que aparece no menu).
  function unreadCount(user) {
    if (user.role === 'patient') return db.get('SELECT COUNT(*) n FROM messages WHERE patient_id = ? AND read_by_patient = 0', user.id).n;
    if (user.role === 'pro') return db.get('SELECT COUNT(*) n FROM messages WHERE pro_id = ? AND read_by_pro = 0', user.id).n;
    return 0;
  }

  // Contadores do menu: mensagens e notificações não lidas.
  function counts(userId) {
    const u = db.get('SELECT id, role FROM users WHERE id = ?', userId);
    if (!u) return { messages: 0, notifications: 0 };
    return { messages: unreadCount(u), notifications: db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n };
  }
  // Atualiza os contadores em todas as abas do usuário.
  const sendCounts = (userId) => hub.send(userId, 'counts', counts(userId));

  // A sala de vídeo abre 15 min antes e fecha 60 min depois do início (no modo demo, no dia todo).
  function roomOpen(appt, now = nowSP()) {
    if (appt.status !== 'confirmed' || appt.modality !== 'online') return false;
    const diff = toMinutes(now) - toMinutes(appt.start);
    if (config.demoMode) return appt.start.slice(0, 10) <= now.slice(0, 10) && diff <= 24 * 60;
    return diff >= -15 && diff <= 60;
  }

  // Distância aproximada entre o bairro do usuário e o do profissional.
  const distance = (user, pro) => distanceKm(user?.bairro || 'Bela Vista', pro.bairro);

  // Eventos do funil (v1.3, src/events.js): svc.track('triage_done', { user_id }) etc.
  const { track } = createEvents(db);

  return {
    expirePending, getPro, listPros, parsePro, template, slotsFor, audit, pushMessage, unreadCount, counts, sendCounts,
    notify, readChatNotifications, roomOpen, distance, patientBusy, packageView, track,
  };
}
