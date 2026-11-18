// Web Push (v1.2): chave pública do servidor e inscrição/desinscrição do aparelho. O envio fica em src/push.js.
import { requireUser } from '../guards.js';
import { HttpError } from '../http.js';
import { bad } from '../validate.js';
import { allowedEndpoint, fromB64u } from '../push.js';

// Aparelhos por pessoa: passando disso, a inscrição mais antiga sai.
const MAX_DEVICES = 10;

export default function pushRoutes(r, { db, push }) {
  // Chave pública VAPID, que o navegador usa ao se inscrever no serviço de push.
  r.get('/api/push/key', requireUser, () => {
    if (!push?.enabled) throw new HttpError(404, 'Os avisos com o app fechado estão desligados neste servidor.');
    return { key: push.publicKey() };
  });

  // Guarda (ou atualiza) a inscrição deste aparelho para o usuário logado. Se o aparelho estava inscrito em outra
  // conta (outra pessoa usou o mesmo celular), a inscrição passa para a conta atual: os avisos seguem quem está logado.
  r.post('/api/push/subscribe', requireUser, (req) => {
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || endpoint.length > 1000 || !allowedEndpoint(endpoint)) throw bad('Serviço de avisos não reconhecido.');
    const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh : '';
    const auth = typeof keys?.auth === 'string' ? keys.auth : '';
    const pk = fromB64u(p256dh);
    if (pk.length !== 65 || pk[0] !== 4 || fromB64u(auth).length !== 16) throw bad('Chaves da inscrição inválidas.');
    db.tx(() => {
      db.run(`INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      req.user.id, endpoint, p256dh, auth);
      db.run(`DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
              (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?)`, req.user.id, req.user.id, MAX_DEVICES);
    });
    return { ok: true };
  });

  // Desliga os avisos deste aparelho (ao sair da conta ou ao desligar em Configurações).
  r.post('/api/push/unsubscribe', requireUser, (req) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    return { ok: true, removed: db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.user.id, endpoint).changes };
  });
}
