// Administração: verificação de registros profissionais, indicadores e dados de demonstração.
import { requireRole } from '../guards.js';
import { HttpError } from '../http.js';
import { nowSP } from '../time.js';
import { oneOf, bad } from '../validate.js';
import { seedDemo } from '../seed.js';

export default function adminRoutes(r, { db, config, svc, notesKey }) {
  const onlyAdmin = requireRole('admin');

  // Indicadores do mês e a fila de profissionais aguardando verificação.
  r.get('/api/admin/overview', onlyAdmin, () => {
    const month = nowSP().slice(0, 7);
    // Atalho para consultas que devolvem um único número.
    const one = (sql, ...p) => db.get(sql, ...p).n ?? 0;
    return {
      month,
      patients: one("SELECT COUNT(*) n FROM users WHERE role = 'patient'"),
      pros_verified: one("SELECT COUNT(*) n FROM pros WHERE status = 'verified'"),
      plus_subscribers: one("SELECT COUNT(*) n FROM users WHERE plan = 'plus'"),
      sessions_month: one("SELECT COUNT(*) n FROM appointments WHERE status IN ('confirmed','done') AND substr(start,1,7) = ?", month),
      social_month: one("SELECT COUNT(*) n FROM appointments WHERE status IN ('confirmed','done') AND social = 1 AND substr(start,1,7) = ?", month),
      gmv_month: one("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status = 'paid' AND kind = 'session' AND substr(paid_at,1,7) = ?", month),
      revenue_month: one("SELECT COALESCE(SUM(fee),0) n FROM payments WHERE status = 'paid' AND substr(paid_at,1,7) = ?", month),
      triages_total: one('SELECT COUNT(*) n FROM triages'),
      pending: svc.listPros("p.status = 'pending'").map((p) => ({ id: p.id, name: p.name, title: p.title, reg: p.reg, area: p.area, bairro: p.bairro, is_new: p.is_new, supervisor: p.supervisor })),
      demo_mode: config.demoMode,
    };
  });

  // No MVP a conferência é manual (consulta ao cadastro público do conselho); na Fase 1 vira automática.
  r.post('/api/admin/pros/:id/verify', onlyAdmin, (req) => {
    const id = Number(req.params.id);
    const decision = oneOf(req.body.decision, ['verified', 'rejected'], 'a decisão');
    const p = db.get('SELECT status FROM pros WHERE user_id = ?', id);
    if (!p) throw new HttpError(404, 'Profissional não encontrado.');
    db.run("UPDATE pros SET status = ?, verified_at = CASE WHEN ? = 'verified' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END WHERE user_id = ?", decision, decision, id);
    svc.audit(req.user.id, 'pro.' + decision, String(id));
    return { ok: true };
  });

  // Apaga tudo e recria os dados fictícios (só no modo demonstração).
  r.post('/api/admin/reset-demo', onlyAdmin, () => {
    if (!config.demoMode) throw bad('Disponível só no modo de demonstração.');
    seedDemo(db, { reset: true, notesKey });
    return { ok: true };
  });
}
