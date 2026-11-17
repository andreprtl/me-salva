// Central de notificações: lista, marcar uma como lida e marcar todas.
// As notificações novas chegam em tempo real pelo canal /api/stream; estas rotas servem para abrir a lista
// e registrar a leitura.
import { requireUser } from '../guards.js';
import { HttpError } from '../http.js';
import { notificationView } from '../services.js';

export default function notificationRoutes(r, { db, svc }) {
  const unread = (userId) => db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n;
  const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

  // As 50 mais recentes, primeiro as não lidas mais novas (uma notificação de mensagem sobe quando é atualizada).
  r.get('/api/notifications', requireUser, (req) => ({
    notifications: db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', req.user.id).map(notificationView),
    unread: unread(req.user.id),
  }));

  // Marca uma notificação como lida. Notificação de outra pessoa responde 404, como se não existisse.
  r.post('/api/notifications/:id/read', requireUser, (req) => {
    const n = db.get('SELECT id, user_id FROM notifications WHERE id = ?', Number(req.params.id));
    if (!n || n.user_id !== req.user.id) throw new HttpError(404, 'Notificação não encontrada.');
    db.run(`UPDATE notifications SET read_at = ${NOW} WHERE id = ? AND read_at IS NULL`, n.id);
    svc.sendCounts(req.user.id);
    return { unread: unread(req.user.id) };
  });

  // "Marcar todas como lidas".
  r.post('/api/notifications/read-all', requireUser, (req) => {
    db.run(`UPDATE notifications SET read_at = ${NOW} WHERE user_id = ? AND read_at IS NULL`, req.user.id);
    svc.sendCounts(req.user.id);
    return { unread: 0 };
  });
}
