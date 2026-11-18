// Central de notificações: painel do sino, abrir a tela certa ao clicar, avisos do sistema (notificação do
// navegador) quando a aba está em segundo plano e o convite gentil para ativá-los.
// As notificações novas chegam pelo canal em tempo real (realtime.js, evento 'notification').
import { S, A, LAYERS, SCREENS, api, run, go, tab, top, refresh, openLayer, closeLayer, renderLayer, toast, esc, ic, ago, toggle } from '../core.js';
import { onLive, setCounts } from '../realtime.js';
import { systemNotice, syncPush, dropPush } from '../pwa.js';

// Ícone de cada tipo de notificação.
const KIND_ICON = { message: 'chat', confirmed: 'check', cancelled: 'x', reminder: 'clock', review: 'star', verified: 'verified', rejected: 'info' };
// Telas do menu: abrem com tab() (recomeçam a navegação); as demais abrem por cima com go().
const TAB_SCREENS = new Set(['home', 'areas', 'agenda', 'chats', 'planos', 'config', 'painel', 'proagenda', 'horarios', 'properfil', 'admin']);

/* ---------------- painel ---------------- */
A.notifs = () => { openLayer('notifs', { items: null }); loadList(); };
// Busca as notificações para o painel aberto.
async function loadList() {
  try {
    const r = await api('/api/notifications');
    if (S.layer?.type !== 'notifs') return;
    S.layer.items = r.notifications;
    S.layer.error = null;
    setCounts({ notifications: r.unread });
    renderLayer();
  } catch (e) {
    if (S.layer?.type === 'notifs') { S.layer.error = e.message; renderLayer(); }
  }
}

const item = (n) => `<button class="np-item ${n.read ? '' : 'is-unread'}" data-a="openNotif" data-v="${n.id}">
  <span class="np-ic k-${esc(n.kind)}">${ic(KIND_ICON[n.kind] || 'bell')}</span>
  <span class="grow"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><em>${ago(n.created_at)}</em></span>
  ${n.read ? '' : '<i class="np-dot"><span class="sr">não lida</span></i>'}</button>`;

LAYERS.notifs = (l) => `<div class="scrim" data-a="close"></div><aside class="npanel" role="dialog" aria-label="Notificações">
  <div class="np-head"><div class="grow"><div class="eyebrow">Central</div><h2 class="h2">Notificações</h2></div>
    <button class="icon-btn plain" data-a="close" aria-label="Fechar" autofocus>${ic('x')}</button></div>
  ${l.items?.some((n) => !n.read) ? `<div class="np-tools"><button class="link" data-a="notifsReadAll">${ic('checks')}Marcar todas como lidas</button></div>` : ''}
  <div class="np-list">${l.error ? `<div class="empty">${ic('info')}<div>${esc(l.error)}</div></div>`
    : !l.items ? '<div class="loading" role="status"><span class="spin"></span><span>Carregando…</span></div>'
      : l.items.length ? l.items.map(item).join('')
        : `<div class="empty">${ic('bell')}<div>Nada por aqui ainda. Lembretes de sessão, mensagens e confirmações aparecem neste lugar.</div></div>`}</div>
  ${notifyInvite('painel')}
</aside>`;

// Clique numa notificação: marca como lida e abre a tela certa.
A.openNotif = (el) => {
  const n = S.layer?.items?.find((x) => x.id === Number(el.dataset.v));
  if (!n) return;
  closeLayer();
  if (!n.read) api(`/api/notifications/${n.id}/read`, { method: 'POST' }).then((r) => setCounts({ notifications: r.unread })).catch(() => {});
  openTarget(n);
};
// Abre a tela de uma notificação (por exemplo, a conversa, a agenda ou o painel).
export function openTarget(n) {
  if (!n.screen || !SCREENS[n.screen]) return;
  const p = n.param == null ? undefined : (/^\d+$/.test(n.param) ? Number(n.param) : n.param);
  if (TAB_SCREENS.has(n.screen)) { tab(n.screen); return; }
  const t = top();
  if (t && t.n === n.screen && t.p === p) refresh(); else go(n.screen, p);
}
A.notifsReadAll = (el) => run(async () => {
  await api('/api/notifications/read-all', { method: 'POST' });
  S.layer?.items?.forEach((n) => { n.read = true; });
  setCounts({ notifications: 0 });
  renderLayer();
}, el);

/* ---------------- notificações chegando em tempo real ---------------- */
onLive('notification', ({ notification: n }) => {
  if (!n) return;
  // Painel aberto: a notificação entra no topo (ou substitui a antiga, quando é uma atualização).
  if (S.layer?.type === 'notifs' && S.layer.items) {
    S.layer.items = [n, ...S.layer.items.filter((x) => x.id !== n.id)];
    renderLayer();
  }
  // Mensagem da conversa que está aberta e à vista: a própria conversa mostra; nada de aviso extra.
  const t = top();
  if (n.kind === 'message' && t?.n === 'chat' && String(t.p) === n.param && !document.hidden) return;
  // Quem acabou de pagar já está vendo a confirmação na tela.
  if (n.kind === 'confirmed' && ['pagamento', 'pix', 'confirmado', 'pixpacote', 'pacote'].includes(t?.n) && !document.hidden) return;
  if (document.hidden) systemNotify(n);
  else if (S.layer?.type !== 'notifs') toast(`${n.title}: ${n.body}`);
});
// Contadores mudaram (por exemplo, a conversa foi lida em outra aba): o painel aberto é atualizado.
let countsT = null;
onLive('counts', () => {
  if (S.layer?.type !== 'notifs' || !S.layer.items) return;
  clearTimeout(countsT);
  countsT = setTimeout(loadList, 300);
});

/* ---------------- avisos do sistema (notificação do navegador) ---------------- */
export const canNotify = () => 'Notification' in window;
// Preferência deste aparelho (a permissão do navegador não pode ser desfeita por código).
export const notifyOn = () => { try { return localStorage.getItem('ms-notify') !== 'off'; } catch { return true; } };
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const asked = () => { try { return localStorage.getItem('ms-notify-asked') === '1'; } catch { return false; } };

// Mostra o aviso do sistema (só com a aba em segundo plano, permissão dada e preferência ligada).
// A etiqueta (tag) é a mesma em todas as abas: o sistema mostra um aviso só, mesmo com várias abas abertas.
// Desde a v1.2 o aviso sai pelo service worker (public/js/pwa.js), o único caminho no Android e no iPhone;
// o toque no aviso volta para cá pela mensagem 'ms-open'.
function systemNotify(n) {
  if (!canNotify() || Notification.permission !== 'granted' || !notifyOn()) return;
  systemNotice(n, () => openFromSystem(n));
}
// Toque num aviso do sistema: marca como lida e abre a tela certa.
function openFromSystem(n) {
  if (n.id) api(`/api/notifications/${n.id}/read`, { method: 'POST' }).then((r) => setCounts({ notifications: r.unread })).catch(() => {});
  if (S.user) openTarget(n);
}
// O service worker avisa que a pessoa tocou num aviso do sistema (com o app já aberto).
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'ms-open' && e.data.notification) openFromSystem(e.data.notification);
});

// Pede a permissão do navegador. Só é chamado por um clique da pessoa, nunca ao abrir a página.
async function askNotify() {
  const p = await Notification.requestPermission();
  remember('ms-notify-asked', '1');
  remember('ms-notify', p === 'granted' ? 'on' : 'off');
  toast(p === 'granted' ? 'Pronto! Os avisos vão aparecer neste aparelho.' : 'Tudo bem. Você pode ativar depois em Configurações.');
  if (p === 'granted') syncPush(); // v1.2: também com o app fechado (Web Push)
  return p;
}

// Convite gentil: aparece no fim do painel do sino e na tela de sessão agendada, enquanto o navegador
// ainda não perguntou. Na tela de sessão agendada, some de vez depois de "Agora não".
export function notifyInvite(where) {
  if (!canNotify() || Notification.permission !== 'default') return '';
  if (where === 'confirmado' && asked()) return '';
  return `<div class="np-invite">${ic('bell')}<div class="grow"><b>Quer receber avisos neste aparelho?</b><span>Lembretes de sessão e mensagens novas aparecem mesmo com o Me Salva em segundo plano.</span></div>
    <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-a="notifyAsk">Ativar avisos</button>${where === 'confirmado' ? '<button class="btn btn-ghost btn-sm" data-a="notifyLater">Agora não</button>' : ''}</div></div>`;
}
A.notifyAsk = (el) => run(async () => { await askNotify(); el.closest('.np-invite')?.remove(); }, el);
A.notifyLater = (el) => { remember('ms-notify-asked', '1'); el.closest('.np-invite')?.remove(); };

// Linha "Avisos do navegador" nas Configurações.
export function notifyRow() {
  const head = (text) => `<div class="li static" id="notifyRow">${ic('bell')}<div class="li-t"><b>Avisos do aparelho</b><span>${text}</span></div>`;
  if (!canNotify()) return head('Este navegador não mostra avisos do sistema. As notificações continuam no sino.') + '</div>';
  if (Notification.permission === 'denied') return head('Bloqueados neste navegador. Para ativar, libere as notificações nas configurações do site.') + '</div>';
  const on = Notification.permission === 'granted' && notifyOn();
  return head(on ? 'Ligados: lembretes e mensagens aparecem mesmo com o Me Salva fechado' : 'Receba lembretes e mensagens mesmo com o Me Salva fechado')
    + toggle('notifyToggle', on, 'Avisos do aparelho') + '</div>';
}
A.notifyToggle = (el) => run(async () => {
  if (Notification.permission === 'default') await askNotify();
  else if (Notification.permission === 'granted') {
    const on = !notifyOn();
    remember('ms-notify', on ? 'on' : 'off');
    if (on) syncPush(); else dropPush();
    toast(on ? 'Avisos ligados neste aparelho.' : 'Avisos desligados neste aparelho.');
  }
  const row = document.getElementById('notifyRow');
  if (row) row.outerHTML = notifyRow();
}, el);
