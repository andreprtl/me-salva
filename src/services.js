// Consultas e regras reaproveitadas por várias rotas (criadas uma vez em createApp e passadas como ctx.svc).
import { json } from './db.js';
import { nowSP, toMinutes } from './time.js';
import { buildSlots } from './slots.js';
import { BAIRROS, distanceKm } from '../public/js/shared/data.js';

// Status que ocupam um horário na agenda (uma sessão cancelada libera o horário).
const ACTIVE = "('pending_payment','confirmed','done','no_show')";

export function createServices(db, config) {
  // Reservas aguardando pagamento por mais de 15 minutos liberam o horário.
  function expirePending() {
    const now = Date.now();
    db.run(`UPDATE payments SET status='expired' WHERE status='pending' AND appointment_id IN
            (SELECT id FROM appointments WHERE status='pending_payment' AND expires_at < ?)`, now);
    db.run(`UPDATE appointments SET status='cancelled' WHERE status='pending_payment' AND expires_at < ?`, now);
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
  function pushMessage({ patient_id, pro_id, sender_id = null, kind = 'text', body = '', audio = null, duration = null }) {
    const byPatient = sender_id === patient_id ? 1 : 0;
    const byPro = sender_id === pro_id ? 1 : 0;
    return db.run(`INSERT INTO messages(patient_id, pro_id, sender_id, kind, body, audio, duration, read_by_patient, read_by_pro)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, patient_id, pro_id, sender_id, kind, body, audio, duration, byPatient, byPro).lastInsertRowid;
  }

  // Mensagens não lidas do usuário logado (o número que aparece no menu).
  function unreadCount(user) {
    if (user.role === 'patient') return db.get('SELECT COUNT(*) n FROM messages WHERE patient_id = ? AND read_by_patient = 0', user.id).n;
    if (user.role === 'pro') return db.get('SELECT COUNT(*) n FROM messages WHERE pro_id = ? AND read_by_pro = 0', user.id).n;
    return 0;
  }

  // A sala de vídeo abre 15 min antes e fecha 60 min depois do início (no modo demo, no dia todo).
  function roomOpen(appt, now = nowSP()) {
    if (appt.status !== 'confirmed' || appt.modality !== 'online') return false;
    const diff = toMinutes(now) - toMinutes(appt.start);
    if (config.demoMode) return appt.start.slice(0, 10) <= now.slice(0, 10) && diff <= 24 * 60;
    return diff >= -15 && diff <= 60;
  }

  // Distância aproximada entre o bairro do usuário e o do profissional.
  const distance = (user, pro) => distanceKm(user?.bairro || 'Bela Vista', pro.bairro);

  return { expirePending, getPro, listPros, parsePro, template, slotsFor, audit, pushMessage, unreadCount, roomOpen, distance };
}
