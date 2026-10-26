// Núcleo da interface: estado, chamadas à API, navegação entre telas, ícones e utilidades.
//
// Como uma tela funciona: cada arquivo em screens/ chama screen(nome, { load, view, after, ... }).
//   load(p)     busca os dados na API (o resultado fica em t.d até a tela ser recarregada);
//   view(p, d)  devolve o HTML da tela como texto;
//   after(p, d) roda depois de desenhar (foco, timers, câmera);
//   nav: item do menu destacado · tabs: mostra as abas no celular · width: largura · bare: sem menu.
// Os botões chamam funções de A pelo atributo data-a; formulários usam F (data-f) e campos usam I (data-i).

// Atalho para querySelector.
export const $ = (s, el = document) => el.querySelector(s);
// Escapa texto antes de colocá-lo no HTML. Todo dado vindo da API passa por esc() para evitar injeção de código.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Estado global: usuário logado, dados de referência, pilha de telas, camada aberta, chamada em andamento e não lidas.
export const S = { user: null, meta: null, stack: [], dir: '', layer: null, call: null, unread: 0 };
export const SCREENS = {};   // nome → { load, view, after, nav, tabs, width }
export const A = {};         // ações de clique (data-a)
export const F = {};         // envios de formulário (data-f)
export const I = {};         // digitação/alteração (data-i)
export const LAYERS = {};    // camadas sobrepostas (folhas e menus)
export const screen = (name, def) => { SCREENS[name] = def; };

/* ---------------- API ---------------- */
// Chama a API do servidor. Envia o cabeçalho x-ms-client (proteção CSRF) e transforma respostas de erro
// em exceções com a mensagem do servidor. Se a sessão expirou (401), volta para a tela de entrada.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'x-ms-client': 'web', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || 'Não foi possível concluir a ação.');
    err.status = res.status;
    if (res.status === 401 && S.user) { S.user = null; resetTo('entrada'); }
    throw err;
  }
  return data;
}

// Executa uma ação assíncrona mostrando o erro como aviso e travando o botão enquanto roda.
export async function run(fn, el) {
  if (el) el.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'err'); return undefined; } finally { if (el && el.isConnected) el.disabled = false; }
}

/* ---------------- navegação ---------------- */
// Navegação em pilha: go empilha, back desempilha, tab e resetTo recomeçam a pilha, replace troca a tela atual.
export const top = () => S.stack[S.stack.length - 1];
export function go(n, p) { S.stack.push({ n, p }); S.dir = 'fwd'; render(); }
export function back() { if (S.stack.length > 1) { S.stack.pop(); S.dir = 'bk'; const t = top(); t.d = undefined; render(); } }
export function tab(n, p) { S.layer = null; S.stack = [{ n, p }]; S.dir = ''; render(); }
export function replace(n, p) { S.stack[S.stack.length - 1] = { n, p }; render(); }
export function resetTo(n, p) { S.layer = null; S.stack = [{ n, p }]; S.dir = ''; render(); }
export function refresh() { const t = top(); if (t) { t.d = undefined; render(); } }
export const homeOf = (u) => (u?.role === 'pro' ? 'painel' : u?.role === 'admin' ? 'admin' : 'home');

// Timers e ganchos da tela atual, cancelados automaticamente ao trocar de tela.
const timers = new Set();
export function every(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; }
export function later(fn, ms) { const id = setTimeout(fn, ms); timers.add(id); return id; }
const clearScreenTimers = () => { timers.forEach((id) => { clearInterval(id); clearTimeout(id); }); timers.clear(); };
const leaveHooks = new Set();
export const onLeave = (fn) => leaveHooks.add(fn);

let seq = 0;
// Desenha a tela do topo da pilha: carrega os dados (se preciso), pinta o menu e o conteúdo e roda after().
// O contador seq descarta respostas de telas que o usuário já deixou.
export async function render() {
  const mySeq = ++seq;
  clearScreenTimers();
  leaveHooks.forEach((fn) => { try { fn(); } catch { /* ignora */ } });
  leaveHooks.clear();
  const t = top();
  const def = SCREENS[t.n] || SCREENS.entrada;
  if (def.load && t.d === undefined) {
    paintShell(t, def);
    $('#screen').innerHTML = `<div class="loading" role="status"><span class="spin"></span><span>Carregando…</span></div>`;
    try {
      const d = await def.load(t.p);
      if (mySeq !== seq) return;
      t.d = d;
    } catch (e) {
      if (mySeq !== seq) return;
      $('#screen').innerHTML = `<div class="loading"><div class="empty">${ic('info')}<div>${esc(e.message)}</div><button class="btn btn-ghost btn-sm" data-a="retry">Tentar de novo</button></div></div>`;
      return;
    }
  }
  paintShell(t, def);
  const el = $('#screen');
  el.className = 'screen' + (def.width ? ' ' + def.width : '') + (S.dir ? ' ' + S.dir : '');
  el.innerHTML = def.view(t.p, t.d);
  S.dir = '';
  if (def.after) def.after(t.p, t.d);
  renderLayer();
}
A.retry = () => refresh();
A.back = () => back();
A.go = (el) => go(el.dataset.v, el.dataset.p !== undefined ? parseParam(el.dataset.p) : undefined);
A.tab = (el) => tab(el.dataset.v);
const parseParam = (v) => (/^\d+$/.test(v) ? Number(v) : v);

/* ---------------- casca: barra lateral e abas ---------------- */
// Menu de cada perfil: [tela, ícone, rótulo no computador, rótulo curto nas abas do celular (null = fora das abas)].
const NAV = {
  patient: [['home', 'home', 'Início', 'Início'], ['areas', 'search', 'Buscar profissionais', 'Buscar'], ['agenda', 'cal', 'Minha agenda', 'Agenda'], ['chats', 'chat', 'Mensagens', 'Mensagens'], ['planos', 'crown', 'Planos', null], ['config', 'sliders', 'Configurações', 'Config.']],
  pro: [['painel', 'chart', 'Painel', 'Painel'], ['proagenda', 'cal', 'Agenda', 'Agenda'], ['horarios', 'clock', 'Horários e vagas sociais', 'Horários'], ['chats', 'chat', 'Mensagens', 'Mensagens'], ['properfil', 'user', 'Meu perfil', null], ['config', 'sliders', 'Configurações', 'Config.']],
  admin: [['admin', 'shield', 'Administração', 'Admin'], ['config', 'sliders', 'Configurações', 'Config.']],
};
// Desenha a barra lateral (computador) e as abas inferiores (celular) conforme o perfil.
function paintShell(t, def) {
  const shell = $('#shell');
  const bare = !S.user || Boolean(def.bare);
  shell.classList.toggle('bare', bare);
  const tb = $('#tabbar');
  if (bare) { tb.hidden = true; tb.innerHTML = ''; $('#side').innerHTML = ''; return; }
  const items = NAV[S.user.role] || [];
  const cur = def.nav || t.n;
  const badge = (n) => (n === 'chats' && S.unread ? `<span class="count-b">${S.unread}</span>` : '');
  const pro = S.user.pro;
  $('#side').innerHTML = `<button class="side-logo" data-a="tab" data-v="${homeOf(S.user)}" aria-label="Início">${wordmark(24)}${S.user.role === 'pro' ? '<span class="tag teal" style="margin-left:4px">Pro</span>' : ''}</button>
    <div class="side-nav">${items.map(([n, i, l]) => `<button class="nav ${cur === n ? 'on' : ''}" data-a="tab" data-v="${n}" ${cur === n ? 'aria-current="page"' : ''}>${ic(i)}${l}${badge(n)}</button>`).join('')}</div>
    ${S.user.role === 'patient' ? `<div class="side-nav"><div class="side-label">Atalhos</div><button class="nav" data-a="tri">${ic('sparkle')}Triagem gratuita</button><button class="nav" data-a="short" data-v="social">${ic('heart')}Vagas sociais</button></div>` : ''}
    <div class="side-foot">
      <button class="crisis" data-a="crise">${ic('lifebuoy')}<div><b>Precisa de ajuda agora?</b><span>CVV 188, 24 horas</span></div></button>
      <button class="side-user" data-a="tab" data-v="config"><span class="me-av" style="cursor:inherit">${esc(initials(S.user.name))}</span><div class="grow"><b>${esc(S.user.name)}</b><span>${S.user.role === 'pro' ? (pro?.status === 'verified' ? 'Registro verificado' : 'Aguardando verificação') : S.user.role === 'admin' ? 'Administração' : S.user.plan === 'plus' ? 'Me Salva+' : 'Plano gratuito'}</span></div></button>
    </div>`;
  if (def.tabs) {
    tb.hidden = false;
    tb.innerHTML = items.filter((x) => x[3]).map(([n, i, , short]) => `<button class="tab ${cur === n ? 'on' : ''}" data-a="tab" data-v="${n}" ${cur === n ? 'aria-current="page"' : ''}>${ic(i)}${short}${n === 'chats' && S.unread ? `<span class="badge" style="right:6px">${S.unread}</span>` : ''}</button>`).join('');
  } else { tb.hidden = true; tb.innerHTML = ''; }
}
export function repaintShell() { const t = top(); if (t) paintShell(t, SCREENS[t.n] || {}); }

/* ---------------- camadas ---------------- */
// Camadas: folhas e menus sobrepostos à tela (confirmação, filtros, ajuda imediata, carregando).
export function openLayer(type, data = {}) { S.layer = { type, ...data }; renderLayer(); }
export function closeLayer() { S.layer = null; renderLayer(); }
export function renderLayer() {
  const L = $('#layer');
  if (!S.layer) { L.className = 'layer'; L.innerHTML = ''; return; }
  L.className = 'layer open';
  L.innerHTML = (LAYERS[S.layer.type] || (() => ''))(S.layer);
  const first = L.querySelector('[autofocus]');
  if (first) first.focus();
}
A.close = () => closeLayer();
LAYERS.processing = (l) => `<div class="scrim"></div><div class="center-load"><div class="load-card"><span class="spin"></span>${esc(l.text || 'Processando…')}</div></div>`;
LAYERS.confirm = (l) => `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-label="${esc(l.title)}">
  <div class="h2">${esc(l.title)}</div><p class="muted" style="margin:0">${esc(l.text)}</p>
  ${l.input ? `<div class="field"><label for="confirmIn">${esc(l.input)}</label><input class="input" id="confirmIn" autocomplete="off" autofocus></div>` : ''}
  <div class="grid2"><button class="btn btn-ghost" data-a="close">Voltar</button><button class="btn ${l.danger ? 'btn-primary' : 'btn-primary'}" data-a="confirmOk" style="${l.danger ? 'background:var(--danger);color:#fff' : ''}">${esc(l.ok || 'Confirmar')}</button></div></div>`;
let confirmFn = null;
// Pede confirmação antes de uma ação; fn recebe o texto digitado, quando há campo.
export function confirmSheet(opts, fn) { confirmFn = fn; openLayer('confirm', opts); }
A.confirmOk = (el) => { const v = $('#confirmIn')?.value; const fn = confirmFn; run(async () => { await fn(v); }, el); };

/* ---------------- aviso rápido ---------------- */
let toastT;
// Aviso rápido no rodapé; erros ficam um pouco mais na tela.
export function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = kind === 'err' ? 'var(--danger)' : '';
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 4200 : 2800);
}

/* ---------------- formatação ---------------- */
// Formatação. Valores chegam da API em centavos.
export const brl = (c) => {
  const v = (c || 0) / 100;
  return Number.isInteger(v) ? 'R$ ' + v.toLocaleString('pt-BR') : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
export const brl2 = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const nota = (n) => Number(n || 0).toFixed(1).replace('.', ',');
export const km = (d) => String(d).replace('.', ',') + ' km';
export const initials = (n) => String(n || '?').replace(/^(Dra?\.)\s*/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DOWL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
export const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const spFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// Mesmo cálculo de src/time.js: horário de São Paulo como 'AAAA-MM-DDTHH:MM'.
export function nowSP() { const p = Object.fromEntries(spFmt.formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
const dayParts = (day) => day.split('-').map(Number);
export const weekdayOf = (day) => { const [y, m, d] = dayParts(day); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const addDays = (day, n) => { const [y, m, d] = dayParts(day); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// 'Hoje', 'Amanhã', 'Ontem' ou 'Seg, 12 out'.
export function dayLabel(day) {
  const today = nowSP().slice(0, 10);
  if (day === today) return 'Hoje';
  if (day === addDays(today, 1)) return 'Amanhã';
  if (day === addDays(today, -1)) return 'Ontem';
  const [, m, d] = dayParts(day);
  return `${DOW[weekdayOf(day)]}, ${d} ${MES[m - 1]}`;
}
export const when = (start) => `${dayLabel(start.slice(0, 10))}, ${start.slice(11, 16)}`;
export const dateBox = (start) => { const [, m, d] = dayParts(start.slice(0, 10)); return `<div class="datebox"><b>${d}</b><span>${MES[m - 1]}</span></div>`; };
// Hora curta das mensagens: hora, 'ontem', dia da semana ou data.
export function msgTime(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diff = (Date.now() - d.getTime()) / 86400000;
  if (diff < 2) return 'ontem';
  if (diff < 7) return DOW[d.getDay()].toLowerCase();
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/* ---------------- ícones e marca ---------------- */
// Ícones em SVG (traço, 24×24), desenhados com ic(nome).
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h11"/>',
  chat: '<path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-5 4V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z"/>',
  filter: '<path d="M3 5h18l-7 8.2V19l-4 2v-7.8z"/>',
  star: '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.4l-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  verified: '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.2 2.5 2.5 4.8-5"/>',
  pin: '<path d="M12 21.5s-7-6.1-7-12a7 7 0 0 1 14 0c0 5.9-7 12-7 12z"/><circle cx="12" cy="9.5" r="2.5"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 10.5 6-3.5v10l-6-3.5"/>',
  videoOff: '<path d="M16 16v1.5A2.5 2.5 0 0 1 13.5 20h-9A2.5 2.5 0 0 1 2 17.5v-9A2.5 2.5 0 0 1 4.5 6H6M10 6h3.5A2.5 2.5 0 0 1 16 8.5V12l6-3.5v10l-3-1.8M2 2l20 20"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  micOff: '<path d="M15 9.3V5.5a3 3 0 0 0-5.7-1.3M9 9v2.5a3 3 0 0 0 5 2.2M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.2 5.6M12 18v3.5M2 2l20 20"/>',
  send: '<path d="M21.5 2.5 10.5 13.5M21.5 2.5 14.5 21.5l-4-8-8-4z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  phoneOff: '<path d="M10.7 13.3a15.4 15.4 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 4.2 2 2 0 0 1 5.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.9 9.7M22 2 2 22"/>',
  shield: '<path d="M12 22s8-4 8-10V5.2L12 2 4 5.2V12c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  sparkle: '<path d="M12 3l1.8 5.4L19.5 10l-5.7 1.7L12 17l-1.8-5.3L4.5 10l5.7-1.6z"/><path d="M19 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 13.6a6.5 6.5 0 0 1 3.5 6.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  map: '<path d="M9 4 3 6.2v13.8l6-2.2 6 2.2 6-2.2V4l-6 2.2z"/><path d="M9 4v13.8M15 6.2V20"/>',
  list: '<path d="M8.5 6H21M8.5 12H21M8.5 18H21M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>',
  pix: '<path d="M12 2.8 21.2 12 12 21.2 2.8 12z"/><path d="M7.5 7.3 12 11.8l4.5-4.5M7.5 16.7 12 12.2l4.5 4.5"/>',
  bell: '<path d="M6 8.5a6 6 0 0 1 12 0c0 7 3 8.5 3 8.5H3s3-1.5 3-8.5M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  puzzle: '<path d="M19.4 13a2.5 2.5 0 1 0 0-5H18V5a1 1 0 0 0-1-1h-3v1.5a2.5 2.5 0 1 1-5 0V4H6a1 1 0 0 0-1 1v3h1.5a2.5 2.5 0 1 1 0 5H5v6a1 1 0 0 0 1 1h3v-1.5a2.5 2.5 0 1 1 5 0V20h3a1 1 0 0 0 1-1v-6z"/>',
  brain: '<path d="M9.5 3.5A3 3 0 0 0 6.6 6 3.2 3.2 0 0 0 4.5 11a3.2 3.2 0 0 0 1.4 5.3A3 3 0 0 0 9.5 20.5h1v-17zM14.5 3.5A3 3 0 0 1 17.4 6a3.2 3.2 0 0 1 2.1 5 3.2 3.2 0 0 1-1.4 5.3 3 3 0 0 1-3.6 4.2h-1v-17z"/>',
  pill: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>',
  couch: '<path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2zM5 18v2M19 18v2"/>',
  hand: '<path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10V4.5a1.5 1.5 0 0 0-3 0V10M12 10V5.5a1.5 1.5 0 0 0-3 0V12M9 12V8.5a1.5 1.5 0 0 0-3 0v6.5a7 7 0 0 0 7 7h.5a6.5 6.5 0 0 0 6.5-6.5V11a1.5 1.5 0 0 0-3 0"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.8"/><path d="m5.6 5.6 3.7 3.7M14.7 14.7l3.7 3.7M14.7 9.3l3.7-3.7M5.6 18.4l3.7-3.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  crown: '<path d="M3 7.5 7.5 12 12 5l4.5 7L21 7.5 19 19H5z"/>',
  file: '<path d="M14 2.5H6.5A2 2 0 0 0 4.5 4.5v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13.5h10L18 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
  child: '<circle cx="12" cy="5.5" r="2.8"/><path d="M8 21v-5.5L6 10.5h12L16 15.5V21M12 15.5V21"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l-4-4 4-4M6 12h10"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 12.5h18"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/>',
};
export const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

// Logo do grupo: cabeça com engrenagens amparada por duas mãos.
export function logoMark(size = 64) {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
<path d="M33 7c-8.5 0-14.5 6-14.5 13.8 0 4.4 1.8 7.4 3.5 9.5v6.2h13l.8-4h3.8c2 0 3-1.1 3-3v-3.4l2.6-1.1-2.7-4.6C42.5 12.8 38.6 7 33 7z" fill="currentColor"/>
<g fill="none" stroke="var(--mark-cut,var(--bg))" stroke-width="2"><circle cx="29" cy="18" r="3.4" stroke-dasharray="2.2 1.4"/><circle cx="36.5" cy="24" r="2.8" stroke-dasharray="1.8 1.3"/></g>
<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 26c1 9 5.5 16 12.5 20.5l4 3.5v8.5"/><path d="M14 32c1.4 5.5 4.6 9.6 9.2 12.3"/><path d="M56 26c-1 9-5.5 16-12.5 20.5l-4 3.5v8.5"/><path d="M50 32c-1.4 5.5-4.6 9.6-9.2 12.3"/></g></svg>`;
}
export const wordmark = (s = 54) => `<div class="logo-lock">${logoMark(s * 1.45)}<div class="word" style="font-size:${s}px">ME<span style="font-size:${s * 0.65}px">SALVA</span></div></div>`;
export const avatar = (name, color = '#2F7D69', s = 48) => `<span class="av" style="width:${s}px;height:${s}px;background:${esc(color)};font-size:${Math.round(s * 0.36)}px">${esc(initials(name))}</span>`;
// Cinco estrelas preenchidas conforme a nota arredondada.
export function stars(n) { let h = ''; for (let i = 1; i <= 5; i++) h += ic('star', 'fill' + (i <= Math.round(n) ? '' : ' off')); return `<span class="stars" aria-label="${nota(n)} de 5">${h}</span>`; }
export const backBtn = () => `<button class="icon-btn" data-a="back" aria-label="Voltar">${ic('chevL')}</button>`;
export const areaName = (id) => S.meta?.areas.find((a) => a.id === id)?.nome || 'Todos os profissionais';
export const chipCheck = (name, value, label, checked) => `<label class="chip-check"><input type="checkbox" name="${esc(name)}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
export const toggle = (action, on, label, extra = '') => `<button class="toggle ${on ? 'on' : ''}" data-a="${action}" ${extra} role="switch" aria-checked="${Boolean(on)}" aria-label="${esc(label)}"></button>`;

// Baixa um arquivo gerado no navegador (usado na exportação de dados).
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast('Selecione o texto e copie manualmente.'); }
}

/* ---------------- tema ---------------- */
// Tema escuro: classe 'dark' no <html>, lembrada no navegador (theme.js aplica antes de desenhar a página).
export function setTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('ms-theme', dark ? 'dark' : 'light'); } catch { /* sem armazenamento */ }
}
export const isDark = () => document.documentElement.classList.contains('dark');
