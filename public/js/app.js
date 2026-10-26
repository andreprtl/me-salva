// Inicialização da interface: carrega a sessão, liga os eventos e abre a primeira tela.
import { S, A, F, I, api, render, resetTo, tab, homeOf, top, repaintShell, closeLayer, toast } from './core.js';
import './screens/common.js';
import './screens/patient.js';
import './screens/pro.js';

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

// Contador de mensagens não lidas.
setInterval(async () => {
  if (!S.user || S.user.role === 'admin' || document.hidden) return;
  try { const r = await api('/api/unread'); if (r.count !== S.unread) { S.unread = r.count; repaintShell(); } } catch { /* offline */ }
}, 15000);

// Recarrega a página (botão 'Tentar de novo' sem script inline, que a CSP bloquearia).
A.reload = () => location.reload();

// Abertura: carrega os dados de referência e a sessão; quem já está logado vai direto para sua tela inicial.
async function boot() {
  try {
    const [meta, me] = await Promise.all([api('/api/meta'), api('/api/me')]);
    S.meta = meta;
    S.user = me.user;
    S.unread = me.user?.unread || 0;
    if (S.user) tab(homeOf(S.user)); else resetTo('entrada');
  } catch (e) {
    document.getElementById('screen').innerHTML = `<div class="loading"><div class="empty"><div>Não foi possível conectar ao servidor do Me Salva.</div><button class="btn btn-primary btn-sm" data-a="reload">Tentar de novo</button></div></div>`;
    toast(e.message, 'err');
  }
}
boot();
