// Inicialização da interface: carrega a sessão, liga os eventos, abre o canal em tempo real e a primeira tela.
// Desde a v1.2 também registra o service worker (app instalável) e atende os atalhos do app (/?tela=...).
import { S, A, F, I, api, render, resetTo, tab, homeOf, top, closeLayer, openLayer, toast } from './core.js';
import { startLive, setCounts } from './realtime.js';
import { registerServiceWorker, syncPush } from './pwa.js';
import { openTarget, notifyOn } from './screens/notifications.js';
import './screens/common.js';
import './screens/patient.js';
import './screens/pro.js';
import './screens/metrics.js';

// Delegação de eventos: botões usam data-a, formulários data-f e campos data-i.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-f]');
  if (!form) return;
  e.preventDefault();
  F[form.dataset.f]?.(form, e);
});
const onField = (e) => { const k = e.target.dataset?.i; if (k && I[k]) I[k](e.target, e); };
document.addEventListener('input', onField);
document.addEventListener('change', (e) => { if (e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onField(e); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.layer && S.layer.type !== 'processing') closeLayer(); });

// Redesenha ao cruzar o limite entre celular e computador (layouts diferentes).
matchMedia('(min-width: 960px)').addEventListener('change', () => { if (top()) { const t = top(); if (t.n !== 'sessao') render(); } });

// Reserva dos contadores: com o canal em tempo real aberto, eles chegam pelo evento 'counts';
// se o canal cair, a interface volta a perguntar a cada 15 segundos.
setInterval(async () => {
  if (!S.user || S.user.role === 'admin' || document.hidden || S.live) return;
  try { const r = await api('/api/unread'); setCounts({ messages: r.count, notifications: r.notifications }); } catch { /* offline */ }
}, 15000);

// Recarrega a página (botão 'Tentar de novo' sem script inline, que a CSP bloquearia).
A.reload = () => location.reload();

// Atalhos do app instalado (manifest.webmanifest) e toque num aviso do sistema com o app fechado chegam como
// /?tela=agenda ou /?tela=chat&p=12&n=40 (n = notificação a marcar como lida). O endereço volta a ser '/'.
function startParams() {
  const q = new URLSearchParams(location.search);
  if (!q.has('tela')) return null;
  history.replaceState(null, '', '/');
  return { screen: q.get('tela'), param: q.get('p'), id: Number(q.get('n')) || null };
}
// Telas que um atalho pode abrir, por perfil (outras ficam na tela inicial).
const START_SCREENS = {
  patient: ['home', 'areas', 'agenda', 'chats', 'planos', 'config', 'chat', 'perfil', 'pacote'],
  pro: ['painel', 'proagenda', 'horarios', 'chats', 'properfil', 'config', 'chat', 'perfil'],
  admin: ['admin', 'metricas', 'config'],
};
function openStart(st) {
  if (st.screen === 'crise') { openLayer('crise'); return; }
  if (!S.user) return;
  const screen = st.screen === 'agenda' && S.user.role === 'pro' ? 'proagenda' : st.screen;
  if (st.id) api(`/api/notifications/${st.id}/read`, { method: 'POST' }).then((r) => setCounts({ notifications: r.unread })).catch(() => {});
  if ((START_SCREENS[S.user.role] || []).includes(screen)) openTarget({ screen, param: st.param });
}

// Abertura: carrega os dados de referência e a sessão; quem já está logado vai direto para sua tela inicial.
async function boot() {
  const start = startParams();
  try {
    const [meta, me] = await Promise.all([api('/api/meta'), api('/api/me')]);
    S.meta = meta;
    S.user = me.user;
    S.unread = me.user?.unread || 0;
    S.notif = me.user?.notifications || 0;
    if (S.user) { startLive(); tab(homeOf(S.user)); } else resetTo('entrada');
    if (start) openStart(start);
    // App instalável: service worker e, com os avisos ligados neste aparelho, a inscrição do Web Push.
    registerServiceWorker().then(() => { if (S.user && notifyOn()) syncPush(); });
  } catch (e) {
    document.getElementById('screen').innerHTML = `<div class="loading"><div class="empty"><div>Não foi possível conectar ao servidor do Me Salva.</div><button class="btn btn-primary btn-sm" data-a="reload">Tentar de novo</button></div></div>`;
    toast(e.message, 'err');
  }
}
boot();
