// Tempo real na interface: um EventSource por aba ligado a /api/stream (Server-Sent Events).
//
// Eventos que chegam do servidor:
//   hello / counts   contadores de mensagens e notificações não lidas (atualizam o menu);
//   message          mensagem nova numa conversa (das duas pessoas da conversa);
//   typing           a outra pessoa está digitando;
//   read             a outra pessoa abriu a conversa ("visto");
//   notification     notificação nova (ou atualizada) para a central;
//   ping             sinal de vida, a cada 25 s.
// As telas se inscrevem com onLive(evento, função). O evento interno '_open' avisa que o canal (re)conectou,
// para a tela buscar o que possa ter chegado durante a queda.
//
// Reserva: enquanto o canal não está aberto, S.live é false e a interface volta à consulta periódica
// (chat aberto a cada 3 s e contadores a cada 15 s), como na v1.0.
import { S, api, syncBadges } from './core.js';

const EVENTS = ['hello', 'counts', 'message', 'typing', 'read', 'notification', 'ping'];
const listeners = {};
let es = null;            // EventSource atual
let lastBeat = 0;         // último dado recebido (para o vigia)
let retryMs = 3000;       // espera antes de reabrir um canal que o servidor fechou (dobra até 30 s)
let retryT = null;
let watchdog = null;

S.live = false;

// Inscreve uma função num evento. Devolve a função que cancela a inscrição.
export function onLive(event, fn) {
  (listeners[event] ||= new Set()).add(fn);
  return () => listeners[event].delete(fn);
}
function emit(event, data) {
  for (const fn of [...(listeners[event] || [])]) { try { fn(data); } catch (e) { console.error(e); } }
}

// Contadores do menu (mensagens e notificações não lidas).
export function setCounts(c) {
  if (!c) return;
  if (typeof c.messages === 'number') S.unread = c.messages;
  if (typeof c.notifications === 'number') S.notif = c.notifications;
  syncBadges();
}
onLive('hello', setCounts);
onLive('counts', setCounts);

// Abre o canal da aba (se houver alguém logado e o navegador suportar).
export function startLive() {
  if (!S.user || es) return;
  if (!('EventSource' in window)) return; // navegador antigo: fica na consulta periódica
  clearTimeout(retryT);
  es = new EventSource('/api/stream');
  lastBeat = Date.now();
  es.addEventListener('open', () => {
    S.live = true;
    retryMs = 3000;
    lastBeat = Date.now();
    emit('_open');
  });
  for (const name of EVENTS) {
    es.addEventListener(name, (e) => {
      lastBeat = Date.now();
      let data = {};
      try { data = JSON.parse(e.data); } catch { /* evento sem dados */ }
      emit(name, data);
    });
  }
  es.addEventListener('error', () => {
    S.live = false; // a consulta periódica assume até o canal voltar
    // CONNECTING: o próprio navegador tenta de novo em 3 s. CLOSED: o servidor recusou (sessão vencida, servidor
    // reiniciando); confere a sessão e tenta de novo com espera crescente.
    if (es && es.readyState === EventSource.CLOSED) {
      es = null;
      api('/api/unread').then(setCounts).catch(() => {}); // um 401 aqui leva para a tela de entrada
      retryT = setTimeout(() => { if (S.user) startLive(); }, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    }
  });
  // Vigia: sem nenhum dado por 60 s (o servidor manda sinal de vida a cada 25 s), a conexão está morta
  // (por exemplo, o computador dormiu). Fecha e abre de novo.
  clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (es && Date.now() - lastBeat > 60000) { stopLive(); startLive(); }
  }, 15000);
}

// Fecha o canal (ao sair da conta).
export function stopLive() {
  clearTimeout(retryT);
  clearInterval(watchdog);
  if (es) { es.close(); es = null; }
  S.live = false;
}

// Ao voltar para a aba (celular desbloqueado, notebook acordado), reabre o canal se ele caiu.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.user) return;
  if (!es || es.readyState === EventSource.CLOSED) { stopLive(); startLive(); }
});
