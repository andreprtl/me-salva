// Área do profissional: painel, perfil, disponibilidade, vagas sociais e prontuário criptografado.
import { requireRole } from '../guards.js';
import { HttpError } from '../http.js';
import { nowSP, addDays, weekday, toMinutes } from '../time.js';
import { encrypt, decrypt } from '../security.js';
import { str, int, listOf, oneOf, bad } from '../validate.js';
import { PRICING, TOPICS, AUDIENCES, BAIRRO_NAMES } from '../../public/js/shared/data.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const HOURS = Array.from({ length: 15 }, (_, i) => String(7 + i).padStart(2, '0') + ':00'); // 07:00 a 21:00

export default function proRoutes(r, { db, svc, notesKey }) {
  const onlyPro = requireRole('pro');

  // Painel: sessões do mês, ocupação dos últimos 6 meses, finanças, avaliações e atendimentos de hoje.
  r.get('/api/pro/dashboard', onlyPro, (req) => {
    const id = req.user.id;
    const now = nowSP();
    const today = now.slice(0, 10);
    const month = today.slice(0, 7);
    const pro = svc.getPro(id);
    const appts = db.all(`SELECT a.*, pt.name AS patient_name FROM appointments a LEFT JOIN users pt ON pt.id = a.patient_id
                          WHERE a.pro_id = ? AND a.status IN ('confirmed','done','no_show') ORDER BY a.start`, id);
    const inMonth = (m) => appts.filter((a) => a.start.startsWith(m));
    const [y, mo] = month.split('-').map(Number);
    // 'AAAA-MM' de N meses atrás.
    const monthKey = (back) => { const d = new Date(Date.UTC(y, mo - 1 - back, 1)); return d.toISOString().slice(0, 7); };
    const prev = monthKey(1);

    // Ocupação: horários usados ÷ horários oferecidos (pela disponibilidade semanal atual), até hoje.
    const template = svc.template(id);
    const perWeekday = Array(7).fill(0);
    template.forEach((t) => { perWeekday[t.weekday] += 1; });
    const occupancy = [5, 4, 3, 2, 1, 0].map((back) => {
      const key = monthKey(back);
      let capacity = 0;
      for (let day = key + '-01'; day.startsWith(key) && day <= today; day = addDays(day, 1)) capacity += perWeekday[weekday(day)];
      const used = inMonth(key).filter((a) => a.start.slice(0, 10) <= today).length;
      const [, mm] = key.split('-').map(Number);
      return { month: MONTHS[mm - 1], key, used, capacity, pct: capacity ? Math.min(100, Math.round(used / capacity * 100)) : 0 };
    });

    // Finanças do mês: bruto (valor de tabela), comissão e líquido recebido pelo profissional.
    const done = inMonth(month).filter((a) => a.status === 'done');
    const gross = done.reduce((s, a) => s + a.base_price, 0);
    const net = done.reduce((s, a) => s + a.pro_amount, 0);
    const social = inMonth(month).filter((a) => a.social && a.status !== 'no_show');
    const rating = db.get('SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE pro_id = ?', id);
    const todayList = appts.filter((a) => a.start.startsWith(today) && a.status === 'confirmed')
      .map((a) => ({ id: a.id, start: a.start, patient_id: a.patient_id, patient_name: a.patient_name || 'Conta excluída', modality: a.modality, social: Boolean(a.social), room_open: svc.roomOpen(a, now) }));
    const upcoming = appts.filter((a) => a.status === 'confirmed' && toMinutes(a.start) >= toMinutes(now)).length;

    return {
      pro, now,
      sessions_month: inMonth(month).filter((a) => a.status !== 'no_show').length,
      // Comparação justa: mesmo intervalo de dias do mês anterior.
      sessions_prev: inMonth(prev).filter((a) => a.status !== 'no_show' && a.start.slice(8, 10) <= today.slice(8, 10)).length,
      no_show_month: inMonth(month).filter((a) => a.status === 'no_show').length,
      upcoming,
      occupancy,
      finance: { gross, fee: gross - net, net, done: done.length },
      social: { count: social.length, net: social.reduce((s, a) => s + a.pro_amount, 0) },
      rating: { avg: rating.avg ? Math.round(rating.avg * 10) / 10 : 0, count: rating.n },
      today: todayList,
      social_estimate: pro.social_price ? { sessions: pro.social_weekly * 4, net: Math.round(pro.social_weekly * 4 * pro.social_price * (1 - PRICING.commission)) } : null,
    };
  });

  // Perfil editável, disponibilidade semanal e lista de horários possíveis.
  r.get('/api/pro/profile', onlyPro, (req) => ({ pro: svc.getPro(req.user.id), availability: svc.template(req.user.id), hours: HOURS }));

  // Atualiza o perfil; campos ausentes mantêm o valor atual.
  r.put('/api/pro/profile', onlyPro, (req) => {
    const b = req.body;
    const cur = svc.getPro(req.user.id);
    const isNew = b.is_new !== undefined ? Boolean(b.is_new) : cur.is_new;
    const fields = {
      title: str(b.title ?? cur.title, 'o título profissional', { min: 3, max: 60 }),
      approach: str(b.approach ?? cur.approach, 'a abordagem', { min: 2, max: 80 }),
      approach_short: str(b.approach_short ?? cur.approach_short, 'a abordagem resumida', { min: 2, max: 30 }),
      topics: JSON.stringify(listOf(b.topics ?? cur.topics, TOPICS, 'os temas', { min: 1 })),
      audience: JSON.stringify(listOf(b.audience ?? cur.audience, AUDIENCES, 'o público atendido', { min: 1 })),
      modalities: JSON.stringify(listOf(b.modalities ?? cur.modalities, ['online', 'presencial'], 'a modalidade', { min: 1 })),
      price: int(b.price !== undefined ? b.price : cur.price / 100, 'o valor da sessão', { min: 40, max: 1000 }) * 100,
      years: int(b.years ?? cur.years, 'os anos de experiência', { min: 0, max: 60 }),
      bio: str(b.bio ?? cur.bio, 'a apresentação', { min: 20, max: 800 }),
      is_new: isNew ? 1 : 0,
      supervisor: isNew ? str(b.supervisor ?? cur.supervisor ?? '', 'o supervisor clínico', { min: 5, max: 120 }) : null,
    };
    const bairro = b.bairro !== undefined ? oneOf(b.bairro, BAIRRO_NAMES, 'o bairro') : cur.bairro;
    db.tx(() => {
      db.run(`UPDATE pros SET title=?, approach=?, approach_short=?, topics=?, audience=?, modalities=?, price=?, years=?, bio=?, is_new=?, supervisor=? WHERE user_id=?`,
        fields.title, fields.approach, fields.approach_short, fields.topics, fields.audience, fields.modalities, fields.price, fields.years, fields.bio, fields.is_new, fields.supervisor, req.user.id);
      db.run('UPDATE users SET bairro = ? WHERE id = ?', bairro, req.user.id);
    });
    return { pro: svc.getPro(req.user.id) };
  });

  // Substitui a disponibilidade semanal inteira pelos horários marcados na tela.
  r.put('/api/pro/availability', onlyPro, (req) => {
    const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
    if (slots.length > 7 * HOURS.length) throw bad('Horários demais.');
    const clean = slots.map((s) => ({ weekday: int(s.weekday, 'o dia da semana', { min: 0, max: 6 }), hour: oneOf(s.hour, HOURS, 'o horário') }));
    db.tx(() => {
      db.run('DELETE FROM availability WHERE pro_id = ?', req.user.id);
      for (const s of clean) db.run('INSERT OR IGNORE INTO availability(pro_id, weekday, hour) VALUES (?, ?, ?)', req.user.id, s.weekday, s.hour);
    });
    return { availability: svc.template(req.user.id) };
  });

  // Vagas sociais: valor (R$ 40 a R$ 80, abaixo do valor normal), quantidade por semana e preenchimento automático.
  r.put('/api/pro/social', onlyPro, (req) => {
    const cur = svc.getPro(req.user.id);
    if (!cur.is_new || !cur.supervisor) throw bad('Vagas sociais são para profissionais recém-formados com supervisor clínico cadastrado no perfil.');
    const price = int(req.body.social_price, 'o valor da vaga social', { min: PRICING.minSocial / 100, max: PRICING.maxSocial / 100 }) * 100;
    if (price >= cur.price) throw bad('O valor da vaga social precisa ser menor que o valor da sua sessão.');
    const weekly = int(req.body.social_weekly, 'as vagas por semana', { min: 0, max: 12 });
    db.run('UPDATE pros SET social_price = ?, social_weekly = ?, auto_fill = ? WHERE user_id = ?', price, weekly, req.body.auto_fill ? 1 : 0, req.user.id);
    return { pro: svc.getPro(req.user.id) };
  });

  // Pacientes do profissional, com número de sessões, a última e a próxima.
  r.get('/api/pro/patients', onlyPro, (req) => ({
    patients: db.all(`SELECT u.id, u.name, COUNT(a.id) AS sessions, MAX(CASE WHEN a.status = 'done' THEN a.start END) AS last_session,
                             MIN(CASE WHEN a.status = 'confirmed' THEN a.start END) AS next_session
                      FROM appointments a JOIN users u ON u.id = a.patient_id
                      WHERE a.pro_id = ? AND a.status IN ('confirmed','done','no_show')
                      GROUP BY u.id ORDER BY COALESCE(next_session, last_session) DESC`, req.user.id),
  }));

  // O prontuário só existe para pacientes que têm ou tiveram sessão com o profissional.
  const linked = (proId, patientId) => db.get("SELECT u.id, u.name FROM appointments a JOIN users u ON u.id = a.patient_id WHERE a.pro_id = ? AND a.patient_id = ? AND a.status IN ('confirmed','done','no_show') LIMIT 1", proId, patientId);

  // Prontuário: cada nota é criptografada com AES-256-GCM e todo acesso fica registrado.
  r.get('/api/pro/patients/:pid/notes', onlyPro, (req) => {
    const pid = Number(req.params.pid);
    const pt = linked(req.user.id, pid);
    if (!pt) throw new HttpError(404, 'Paciente não encontrado na sua agenda.');
    svc.audit(req.user.id, 'notes.read', String(pid));
    const notes = db.all('SELECT * FROM notes WHERE pro_id = ? AND patient_id = ? ORDER BY id DESC', req.user.id, pid)
      .map((n) => ({ id: n.id, created_at: n.created_at, text: decrypt(notesKey, n) }));
    const history = db.all("SELECT id, start, modality, status, social FROM appointments WHERE pro_id = ? AND patient_id = ? AND status IN ('confirmed','done','no_show') ORDER BY start DESC LIMIT 20", req.user.id, pid);
    return { patient: pt, notes, history };
  });

  r.post('/api/pro/patients/:pid/notes', onlyPro, (req) => {
    const pid = Number(req.params.pid);
    if (!linked(req.user.id, pid)) throw new HttpError(404, 'Paciente não encontrado na sua agenda.');
    const enc = encrypt(notesKey, str(req.body.text, 'a anotação', { min: 2, max: 5000 }));
    db.run('INSERT INTO notes(pro_id, patient_id, iv, tag, data) VALUES (?, ?, ?, ?, ?)', req.user.id, pid, enc.iv, enc.tag, enc.data);
    svc.audit(req.user.id, 'notes.write', String(pid));
    return { ok: true };
  });
}
