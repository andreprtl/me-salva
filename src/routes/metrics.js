// Métricas do negócio (v1.3): registro de eventos vindos do navegador e o painel da administração.
import { requireRole } from '../guards.js';
import { oneOf } from '../validate.js';
import { CLIENT_EVENTS } from '../events.js';
import { computeMetrics, metricsCsv, PERIODS } from '../metrics.js';

// Período pedido na URL (?days=30, 90 ou 180); sem nada, 30 dias.
const daysOf = (req) => Number(oneOf(String(req.query.days ?? '30'), Object.keys(PERIODS), 'o período'));

export default function metricsRoutes(r, { db, svc }) {
  const onlyAdmin = requireRole('admin');

  // Eventos que só o navegador conhece (hoje, só "triagem iniciada"). Os outros passos do funil são
  // gravados pelo servidor nas próprias rotas, então não podem ser inventados por aqui.
  r.post('/api/events', requireRole('patient'), (req) => {
    const kind = oneOf(req.body.kind, CLIENT_EVENTS, 'o evento');
    return { ok: true, recorded: svc.track(kind, { user_id: req.user.id }) };
  });

  // Painel de métricas: indicadores do período, funil, retenção, vagas sociais, qualidade e séries semanais.
  r.get('/api/admin/metrics', onlyAdmin, (req) => computeMetrics(db, { days: daysOf(req) }));

  // Os mesmos números numa planilha (CSV com ';' e vírgula decimal, que o Excel e o Google Planilhas abrem direto).
  r.get('/api/admin/metrics/export', onlyAdmin, (req, res) => {
    const m = computeMetrics(db, { days: daysOf(req) });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="me-salva-metricas-${m.period.days}d-${m.period.to}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end(metricsCsv(m));
  });
}
