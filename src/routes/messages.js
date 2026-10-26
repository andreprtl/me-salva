// Chat entre paciente e profissional: texto, áudio gravado e avisos automáticos.
import { requireRole, requireUser } from '../guards.js';
import { HttpError } from '../http.js';
import { str, int, bad } from '../validate.js';

const MAX_AUDIO = 1_500_000; // ~1,5 MB em base64 (cerca de 1 minuto)

export default function messageRoutes(r, { db, svc }) {
  // Identifica a conversa (paciente, profissional) a partir de quem está logado.
  function pair(req) {
    const other = Number(req.params.otherId);
    if (req.user.role === 'patient') {
      const p = svc.getPro(other);
      if (!p || p.status !== 'verified') throw new HttpError(404, 'Profissional não encontrado.');
      return { patient_id: req.user.id, pro_id: other, other: { id: p.id, name: p.name, title: p.title, color: p.color } };
    }
    // O profissional só conversa com quem já tem sessão ou conversa com ele.
    const pt = db.get("SELECT id, name FROM users WHERE id = ? AND role = 'patient'", other);
    const linked = pt && db.get(`SELECT 1 FROM appointments WHERE patient_id = ? AND pro_id = ? UNION
                                 SELECT 1 FROM messages WHERE patient_id = ? AND pro_id = ?`, other, req.user.id, other, req.user.id);
    if (!linked) throw new HttpError(404, 'Conversa não encontrada.');
    return { patient_id: other, pro_id: req.user.id, other: { id: pt.id, name: pt.name, title: 'Paciente', color: '#3E8E7E' } };
  }

  // Formato enviado ao navegador; o áudio em si é baixado à parte em /api/messages/:id/audio.
  const view = (m) => ({ id: m.id, sender_id: m.sender_id, kind: m.kind, body: m.body, duration: m.duration, created_at: m.created_at });

  // Conversas com a última mensagem e o número de não lidas, da mais recente para a mais antiga.
  r.get('/api/conversations', requireRole('patient', 'pro'), (req) => {
    const me = req.user;
    const mine = me.role === 'patient' ? 'patient_id' : 'pro_id';
    const theirs = me.role === 'patient' ? 'pro_id' : 'patient_id';
    const readCol = me.role === 'patient' ? 'read_by_patient' : 'read_by_pro';
    const rows = db.all(`SELECT m.${theirs} AS other_id, MAX(m.id) AS last_id, SUM(CASE WHEN m.${readCol} = 0 THEN 1 ELSE 0 END) AS unread
                         FROM messages m WHERE m.${mine} = ? GROUP BY m.${theirs} ORDER BY last_id DESC`, me.id);
    return {
      conversations: rows.map((row) => {
        const last = db.get('SELECT * FROM messages WHERE id = ?', row.last_id);
        const u = db.get('SELECT id, name FROM users WHERE id = ?', row.other_id);
        const p = me.role === 'patient' ? svc.getPro(row.other_id) : null;
        return { other: { id: u.id, name: u.name, title: p?.title || 'Paciente', color: p?.color || '#3E8E7E' }, last: view(last), unread: row.unread };
      }),
    };
  });

  // Mensagens de uma conversa, já marcadas como lidas. ?after=ID traz só as novas (atualização a cada 3 s).
  r.get('/api/conversations/:otherId', requireRole('patient', 'pro'), (req) => {
    const c = pair(req);
    const after = Number(req.query.after) || 0;
    const msgs = db.all('SELECT * FROM messages WHERE patient_id = ? AND pro_id = ? AND id > ? ORDER BY id LIMIT 300', c.patient_id, c.pro_id, after);
    const readCol = req.user.role === 'patient' ? 'read_by_patient' : 'read_by_pro';
    db.run(`UPDATE messages SET ${readCol} = 1 WHERE patient_id = ? AND pro_id = ? AND ${readCol} = 0`, c.patient_id, c.pro_id);
    return { other: c.other, me: req.user.id, messages: msgs.map(view) };
  });

  // Envia texto ou áudio. O áudio chega como data URL em base64 e tem formato e tamanho validados.
  r.post('/api/conversations/:otherId', requireRole('patient', 'pro'), (req) => {
    const c = pair(req);
    const kind = req.body.kind === 'audio' ? 'audio' : 'text';
    let id;
    if (kind === 'text') {
      id = svc.pushMessage({ ...c, sender_id: req.user.id, kind, body: str(req.body.body, 'a mensagem', { max: 2000 }) });
    } else {
      const audio = String(req.body.audio || '');
      if (!/^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/.test(audio)) throw bad('Formato de áudio não reconhecido.');
      if (audio.length > MAX_AUDIO) throw bad('O áudio está longo demais. Grave até 1 minuto.');
      const duration = int(Math.round(Number(req.body.duration) || 1), 'a duração', { min: 1, max: 120 });
      id = svc.pushMessage({ ...c, sender_id: req.user.id, kind, audio, duration });
    }
    return { message: view(db.get('SELECT * FROM messages WHERE id = ?', id)) };
  });

  // Devolve o áudio como arquivo para o player do navegador.
  r.get('/api/messages/:id/audio', requireUser, (req, res) => {
    const m = db.get('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
    if (!m || m.kind !== 'audio' || (m.patient_id !== req.user.id && m.pro_id !== req.user.id)) throw new HttpError(404, 'Áudio não encontrado.');
    const [, mime, b64] = m.audio.match(/^data:([^;,]+)[^,]*,(.*)$/);
    const buf = Buffer.from(b64, 'base64');
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600' });
    res.end(buf);
  });
}
