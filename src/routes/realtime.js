// Canal em tempo real: GET /api/stream abre um fluxo Server-Sent Events para o usuário logado.
// O navegador abre um EventSource por aba; a sessão vem do cookie, como nas outras rotas.
import { requireUser } from '../guards.js';

export default function realtimeRoutes(r, { svc, hub }) {
  r.get('/api/stream', requireUser, (req, res) => {
    const c = hub.connect(req, res, req.user);
    // Boas-vindas com os contadores atuais: a aba sincroniza o menu logo ao conectar (ou reconectar).
    hub.sendTo(c, 'hello', svc.counts(req.user.id));
  });
}
