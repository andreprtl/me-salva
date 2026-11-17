// Canal em tempo real com Server-Sent Events (SSE), sem dependências.
// Cada aba aberta mantém uma conexão GET /api/stream; o servidor guarda essas conexões por usuário
// e empurra eventos (mensagem nova, "digitando…", "visto", notificação, contadores) só para quem deve recebê-los.
//
// Regra de segurança: o destinatário de um evento é sempre um id de usuário decidido pelo servidor
// (a partir do banco), nunca um valor enviado pelo navegador. Uma conexão só recebe eventos do próprio usuário.
import { parseCookies } from './http.js';
import { sha256 } from './security.js';
import { COOKIE } from './guards.js';

// Cabeçalhos do fluxo SSE. X-Accel-Buffering desliga o acúmulo de dados em proxies (como o do Render).
const HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// Cria o distribuidor de eventos.
//   heartbeatMs: intervalo do sinal de vida (25 s), que também mantém proxies sem cortar a conexão;
//   maxPerUser: máximo de abas conectadas por usuário (a mais antiga é fechada quando passa disso).
export function createHub({ db, heartbeatMs = 25000, maxPerUser = 8 } = {}) {
  const byUser = new Map(); // id do usuário → Set de conexões { res, userId, tokenHash }

  // Escreve um evento no formato SSE: "event: nome" + "data: JSON" + linha em branco.
  function write(c, event, data) {
    if (c.res.writableEnded || c.res.destroyed) return;
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
  }

  function remove(c) {
    const set = byUser.get(c.userId);
    if (!set) return;
    set.delete(c);
    if (!set.size) byUser.delete(c.userId);
  }

  // Abre o fluxo para o usuário logado. O hash do token de sessão fica guardado para que a conexão
  // seja encerrada quando a pessoa sai, exclui a conta ou a sessão vence.
  function connect(req, res, user) {
    const token = parseCookies(req.headers.cookie)[COOKIE] || '';
    const c = { res, userId: user.id, tokenHash: sha256(token) };
    res.writeHead(200, HEADERS);
    // retry: o navegador tenta reconectar sozinho 3 s depois de uma queda.
    res.write('retry: 3000\n\n');
    let set = byUser.get(user.id);
    if (!set) { set = new Set(); byUser.set(user.id, set); }
    set.add(c);
    // Limite de abas por usuário: fecha a conexão mais antiga.
    if (set.size > maxPerUser) end([...set][0]);
    req.on('close', () => remove(c));
    return c;
  }

  function end(c) { remove(c); if (!c.res.writableEnded) c.res.end(); }

  // Envia um evento a todas as abas de um usuário (nada acontece se ele não estiver conectado).
  function send(userId, event, data) {
    const set = byUser.get(userId);
    if (set) for (const c of set) write(c, event, data);
  }

  // Fecha as conexões que satisfazem um critério.
  function dropWhere(test) {
    for (const set of [...byUser.values()]) for (const c of [...set]) if (test(c)) end(c);
  }

  // Sinal de vida: a cada 25 s confere se a sessão de cada conexão ainda vale e manda um "ping".
  // Sessão apagada (saída, exclusão da conta, restauração dos dados) ou vencida encerra a conexão.
  const timer = setInterval(() => {
    const now = Date.now();
    dropWhere((c) => {
      const s = db.get('SELECT expires_at FROM sessions WHERE token_hash = ?', c.tokenHash);
      return !s || s.expires_at < now;
    });
    for (const set of byUser.values()) for (const c of set) write(c, 'ping', { t: now });
  }, heartbeatMs);
  timer.unref(); // não impede o processo (ou os testes) de terminar

  return {
    connect,
    send,
    // Envia só para uma conexão (usado no evento de boas-vindas).
    sendTo: write,
    dropToken: (tokenHash) => dropWhere((c) => c.tokenHash === tokenHash),
    dropUser: (userId) => dropWhere((c) => c.userId === userId),
    dropAll: () => dropWhere(() => true),
    // Número de conexões abertas (de um usuário ou no total), útil em testes e diagnóstico.
    count: (userId) => (userId ? byUser.get(userId)?.size || 0 : [...byUser.values()].reduce((n, s) => n + s.size, 0)),
    close() { clearInterval(timer); dropWhere(() => true); },
  };
}
