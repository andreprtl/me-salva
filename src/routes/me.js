// Conta do usuário: dados, plano Me Salva+, exportação e exclusão (LGPD).
import { requireUser, requireRole, COOKIE } from '../guards.js';
import { publicUser } from './auth.js';
import { str, oneOf, bad } from '../validate.js';
import { luhn, decrypt } from '../security.js';
import { BAIRRO_NAMES, PRICING } from '../../public/js/shared/data.js';

export default function meRoutes(r, { db, svc, notesKey }) {
  // Usuário logado (ou null). É a primeira chamada da interface ao abrir.
  r.get('/api/me', (req) => ({ user: req.user ? publicUser(db, svc, req.user) : null }));

  // Contador de mensagens não lidas, consultado pela interface a cada 15 segundos.
  r.get('/api/unread', requireUser, (req) => ({ count: svc.unreadCount(req.user) }));

  // Atualiza nome, bairro e endereço; campos ausentes mantêm o valor atual.
  r.patch('/api/me', requireUser, (req) => {
    const b = req.body;
    const name = b.name !== undefined ? str(b.name, 'o nome', { min: 3, max: 80 }) : req.user.name;
    const bairro = b.bairro !== undefined ? oneOf(b.bairro, BAIRRO_NAMES, 'o bairro') : req.user.bairro;
    const address = b.address !== undefined ? str(b.address, 'o endereço', { optional: true, max: 160 }) : req.user.address;
    db.run('UPDATE users SET name = ?, bairro = ?, address = ? WHERE id = ?', name, bairro, address, req.user.id);
    return { user: publicUser(db, svc, db.get('SELECT * FROM users WHERE id = ?', req.user.id)) };
  });

  // Assinatura simulada do Me Salva+ (cartão de teste).
  r.post('/api/me/plan', requireRole('patient'), (req) => {
    const action = oneOf(req.body.action, ['subscribe', 'cancel'], 'a ação');
    if (action === 'subscribe') {
      if (req.user.plan === 'plus') throw bad('Você já assina o Me Salva+.');
      const number = String(req.body.card?.number || '4242424242424242');
      if (!luhn(number)) throw bad('Número de cartão inválido. No ambiente de teste, use 4242 4242 4242 4242.');
      db.tx(() => {
        db.run(`INSERT INTO payments(user_id, kind, method, amount, fee, status, card_last4, paid_at)
                VALUES (?, 'plus', 'card', ?, ?, 'paid', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
        req.user.id, PRICING.plusPrice, PRICING.plusPrice, number.replace(/\D/g, '').slice(-4));
        db.run("UPDATE users SET plan = 'plus', plan_since = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", req.user.id);
      });
    } else {
      db.run("UPDATE users SET plan = 'free', plan_since = NULL WHERE id = ?", req.user.id);
    }
    return { user: publicUser(db, svc, db.get('SELECT * FROM users WHERE id = ?', req.user.id)) };
  });

  // Portabilidade (LGPD, art. 18): tudo o que a plataforma guarda sobre a pessoa.
  r.get('/api/me/export', requireUser, (req, res) => {
    const id = req.user.id;
    const data = {
      gerado_em: new Date().toISOString(),
      conta: db.get('SELECT id, role, name, email, bairro, address, plan, plan_since, created_at FROM users WHERE id = ?', id),
      perfil_profissional: req.user.role === 'pro' ? svc.getPro(id) : undefined,
      triagens: db.all('SELECT answers, needs, created_at FROM triages WHERE user_id = ?', id).map((t) => ({ ...t, answers: JSON.parse(t.answers), needs: JSON.parse(t.needs) })),
      agendamentos: db.all('SELECT id, pro_id, patient_id, start, modality, social, amount, status, created_at FROM appointments WHERE patient_id = ? OR pro_id = ?', id, id),
      pagamentos: db.all('SELECT id, kind, method, amount, status, created_at, paid_at FROM payments WHERE user_id = ?', id),
      mensagens: db.all("SELECT id, patient_id, pro_id, sender_id, kind, body, created_at FROM messages WHERE patient_id = ? OR pro_id = ?", id, id),
      avaliacoes: db.all('SELECT pro_id, rating, tags, text, author_label, created_at FROM reviews WHERE patient_id = ?', id),
      prontuario: req.user.role === 'pro'
        ? db.all('SELECT patient_id, iv, tag, data, created_at FROM notes WHERE pro_id = ?', id).map((n) => ({ patient_id: n.patient_id, created_at: n.created_at, texto: decrypt(notesKey, n) }))
        : undefined,
    };
    svc.audit(id, 'data.export');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="meus-dados-me-salva.json"',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data, null, 2));
  });

  // Exclusão da conta (LGPD, art. 18, VI). Avaliações ficam anônimas para não distorcer as notas.
  r.delete('/api/me', requireUser, (req, res) => {
    if (req.body.confirm !== 'EXCLUIR') throw bad('Digite EXCLUIR para confirmar.');
    if (req.user.role === 'admin') throw bad('A conta de administração não pode ser excluída por aqui.');
    const id = req.user.id;
    db.tx(() => {
      db.run("UPDATE reviews SET author_label = 'Anônimo' WHERE patient_id = ?", id);
      db.run('DELETE FROM users WHERE id = ?', id);
    });
    svc.audit(null, 'account.delete', String(id));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  });
}
