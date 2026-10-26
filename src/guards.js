// Guardas de acesso usadas nas rotas, sempre antes do handler principal.
// Exemplo: r.get('/api/pro/dashboard', requireRole('pro'), handler).
import { HttpError } from './http.js';

// Nome do cookie de sessão (HttpOnly: o JavaScript da página não consegue lê-lo).
export const COOKIE = 'ms_session';

// Exige login (401 se não houver sessão válida).
export const requireUser = (req) => {
  if (!req.user) throw new HttpError(401, 'Entre na sua conta para continuar.');
};

// Exige login e um dos perfis informados: 'patient', 'pro' ou 'admin' (403 se for outro).
export const requireRole = (...roles) => (req) => {
  requireUser(req);
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'Seu perfil não tem acesso a esta função.');
};
