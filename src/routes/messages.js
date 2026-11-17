// Chat entre paciente e profissional: texto, áudio gravado, avisos automáticos, "digitando…" e "visto".
// As mensagens novas chegam ao outro lado em tempo real pelo canal /api/stream (veja realtime.js).
import { requireRole, requireUser } from '../guards.js';
import { HttpError } from '../http.js';
import { str, int, bad } from '../validate.js';
import { messageView as view } from '../services.js';

const MAX_AUDIO = 1_500_000; // ~1,5 MB em base64 (cerca de 1 minuto)
// Intervalo mínimo entre dois avisos de "digitando…" da mesma pessoa na mesma conversa.
const TYPING_GAP_MS = 1000;

export default function messageRoutes(r, { db, svc, hub }) {
  // Último aviso de "digitando…" por par remetente→conversa, para não repassar avisos repetidos.
  const lastTyping = new Map();

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

  // Mensagens de uma conversa, já marcadas como lidas. ?after=ID traz só as novas: a interface usa isso quando
  // chega o aviso de mensagem nova pelo canal em tempo real e, se o canal cair, a cada 3 s.
  // Quando algo é marcado como lido, a outra pessoa recebe o evento 'read' e vê o "visto" nas mensagens dela.
  r.get('/api/conversations/:otherId', requireRole('patient', 'pro'), (req) => {
    const c = pair(req);
    const after = Number(req.query.after) || 0;
    const readCol = req.user.role === 'patient' ? 'read_by_patient' : 'read_by_pro';
    const marked = db.run(`UPDATE messages SET ${readCol} = 1 WHERE patient_id = ? AND pro_id = ? AND ${readCol} = 0`, c.patient_id, c.pro_id).changes;
    const msgs = db.all('SELECT * FROM messages WHERE patient_id = ? AND pro_id = ? AND id > ? ORDER BY id LIMIT 300', c.patient_id, c.pro_id, after);
    if (marked) {
      const upTo = db.get('SELECT MAX(id) n FROM messages WHERE patient_id = ? AND pro_id = ?', c.patient_id, c.pro_id).n;
      hub.send(c.other.id, 'read', { conversation: req.user.id, upTo });
      svc.sendCounts(req.user.id); // as outras abas de quem leu também zeram o contador
    }
    return { other: c.other, me: req.user.id, messages: msgs.map(view) };
  });

  // "Digitando…": avisa só a outra pessoa da conversa. A conversa é validada como no envio de mensagens.
  r.post('/api/conversations/:otherId/typing', requireRole('patient', 'pro'), (req) => {
    const c = pair(req);
    const key = `${req.user.id}:${c.other.id}`;
    const now = Date.now();
    if (now - (lastTyping.get(key) || 0) >= TYPING_GAP_MS) {
      lastTyping.set(key, now);
      if (lastTyping.size > 5000) lastTyping.clear(); // limpeza simples para a memória não crescer sem limite
      hub.send(c.other.id, 'typing', { conversation: req.user.id });
    }
    return { ok: true };
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
