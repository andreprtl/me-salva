// Monta a aplicação: rotas da API, sessão do usuário, cabeçalhos de segurança e arquivos do site.
// Caminho de uma requisição: cabeçalhos de segurança → rota da API (ou arquivo estático) → checagem
// de CSRF → leitura do corpo → usuário da sessão → handlers da rota → resposta JSON.
import { fileURLToPath } from 'node:url';
import { createRouter, readJson, sendJson, parseCookies, serveStatic, HttpError } from './http.js';
import { sha256 } from './security.js';
import { COOKIE } from './guards.js';
export { COOKIE, requireUser, requireRole } from './guards.js';
import { createServices } from './services.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import catalogRoutes from './routes/catalog.js';
import appointmentRoutes from './routes/appointments.js';
import messageRoutes from './routes/messages.js';
import proRoutes from './routes/pro.js';
import adminRoutes from './routes/admin.js';

// Content Security Policy: só scripts do próprio site (nenhum script inline), fontes do Google Fonts
// e imagens e áudios locais. Limita o estrago de uma eventual injeção de HTML.
const CSP = [
  "default-src 'self'", "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:", "media-src 'self' blob: data:", "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');

// Recebe o banco, a configuração e a chave do prontuário e devolve o handler HTTP.
// Os testes usam esta mesma função com um banco temporário.
export function createApp({ db, config, notesKey }) {
  const router = createRouter();
  const svc = createServices(db, config);
  const ctx = { db, config, svc, notesKey };
  // Cada arquivo em routes/ registra suas rotas no roteador e recebe o contexto compartilhado (ctx).
  for (const mount of [authRoutes, meRoutes, catalogRoutes, appointmentRoutes, messageRoutes, proRoutes, adminRoutes]) mount(router, ctx);
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));

  // Identifica o usuário pelo cookie de sessão; o token é procurado pelo hash SHA-256 guardado no banco.
  function loadUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db.get(`SELECT u.id, u.role, u.name, u.email, u.bairro, u.address, u.plan, u.plan_since, u.is_demo, s.expires_at
                        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  return async function handle(req, res) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, 'Rota não encontrada.');
        if (m === 'method') throw new HttpError(405, 'Método não permitido.');
        // Proteção contra CSRF: chamadas que alteram dados precisam do cabeçalho do próprio site.
        if (req.method !== 'GET' && req.headers['x-ms-client'] !== 'web') throw new HttpError(403, 'Requisição não autorizada.');
        req.params = m.params;
        req.query = Object.fromEntries(url.searchParams);
        req.body = await readJson(req);
        req.ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        req.secure = req.headers['x-forwarded-proto'] === 'https' || config.production;
        req.user = loadUser(req);
        // Executa os handlers em ordem. Uma guarda que lança erro interrompe; um handler que devolve valor responde com ele em JSON.
        for (const h of m.handlers) {
          const out = await h(req, res, ctx);
          if (res.writableEnded || res.headersSent) return;
          if (out !== undefined) return sendJson(res, 200, out);
        }
        return sendJson(res, 200, { ok: true });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(404, 'Não encontrado.');
      if (serveStatic(publicDir, url.pathname, res)) return;
      serveStatic(publicDir, '/index.html', res); // as rotas da interface são resolvidas no navegador
    // Erros esperados (HttpError) viram mensagens para o usuário; os inesperados vão para o log e recebem uma mensagem genérica.
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (res.headersSent) return res.end();
      sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Algo deu errado no servidor. Tente de novo.' });
    }
  };
}
