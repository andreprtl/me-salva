// App instalável (PWA, v1.2) do lado da página: registra o service worker (public/sw.js), cuida do botão
// "Instalar o app" e do convite discreto na tela inicial, avisa quando a internet cai e mostra os avisos do
// sistema pelo service worker (no Android, um aviso do sistema só aparece por ele).
//
// Como instalar em cada aparelho:
//   Android e computador (Chrome, Edge): o navegador dispara 'beforeinstallprompt'; guardamos o evento e o
//     botão "Instalar o app" abre a janela de instalação do próprio navegador.
//   iPhone e iPad (Safari): não há esse evento; mostramos o passo a passo Compartilhar → Adicionar à Tela de Início.
//   Outros navegadores: indicamos o menu do navegador.
import { S, A, LAYERS, api, openLayer, toast, ic } from './core.js';

let deferredPrompt = null;   // evento guardado para abrir a janela de instalação depois, num clique
let installedNow = false;    // o app acabou de ser instalado nesta visita

// O app está aberto como app instalado (tela cheia, sem a barra do navegador)?
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPhone ou iPad (o iPad recente se apresenta como Mac, mas tem tela de toque).
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Situação da instalação neste aparelho: 'installed' (aberto como app), 'done' (acabou de instalar),
// 'ready' (o navegador oferece a instalação), 'ios' (passo a passo do iPhone) ou 'manual' (pelo menu do navegador).
export function installState() {
  if (isStandalone()) return 'installed';
  if (installedNow) return 'done';
  if (deferredPrompt) return 'ready';
  if (isIOS()) return 'ios';
  return 'manual';
}

/* ---------------- service worker ---------------- */
// Registra o service worker. O navegador só permite em HTTPS ou em http://localhost.
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('Service worker não registrado:', e);
    return null;
  }
}

/* ---------------- instalação ---------------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // nada de janela automática: a instalação só abre quando a pessoa pede
  deferredPrompt = e;
  refreshInstallUI();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installedNow = true;
  refreshInstallUI();
  toast('Pronto! O Me Salva está na tela inicial do seu aparelho.');
});

// Botão "Instalar o app": abre a janela do navegador ou o passo a passo.
A.installApp = async () => {
  const st = installState();
  if (st === 'ready') {
    const e = deferredPrompt;
    deferredPrompt = null;
    e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== 'accepted') toast('Tudo bem. Você pode instalar depois em Configurações.');
    refreshInstallUI();
    return;
  }
  openLayer('install', { st });
};
// "Agora não" no convite da tela inicial: o convite some neste aparelho (o botão continua em Configurações).
A.installLater = (el) => {
  try { localStorage.setItem('ms-install-later', '1'); } catch { /* sem armazenamento */ }
  el.closest('[data-install-slot]')?.replaceChildren();
};
const later = () => { try { return localStorage.getItem('ms-install-later') === '1'; } catch { return false; } };

// Passo a passo de instalação (iPhone ou menu do navegador).
LAYERS.install = (l) => `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-label="Instalar o app">
  <div class="h2">Instalar o Me Salva</div>
  ${l.st === 'ios' ? `<ol class="steps">
      <li><span class="num">1</span><div>No <b>Safari</b>, toque em <b>Compartilhar</b> ${ic('share')} na barra de baixo (ou de cima, no iPad).</div></li>
      <li><span class="num">2</span><div>Role a lista e toque em <b>Adicionar à Tela de Início</b> ${ic('plus')}.</div></li>
      <li><span class="num">3</span><div>Toque em <b>Adicionar</b>. O ícone do Me Salva aparece junto com os outros apps.</div></li>
    </ol>
    <div class="small muted">No iPhone, os avisos com o app fechado só funcionam no app instalado (iOS 16.4 ou mais recente).</div>`
  : `<p class="muted" style="margin:0">Abra o menu do navegador (${ic('menu')} ou ⋮) e escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>. Se a opção não aparecer, o app já pode estar instalado neste aparelho.</p>`}
  <button class="btn btn-primary btn-block" data-a="close" autofocus>Entendi</button></div>`;

// Linha "Instalar o app" em Configurações.
export function installRow() {
  const st = installState();
  const texts = {
    installed: 'Você está usando o app instalado neste aparelho',
    done: 'Instalado. Abra o Me Salva pelo ícone na tela inicial',
    ready: 'Abre em tela cheia, direto da tela inicial, como um aplicativo',
    ios: 'No iPhone: Compartilhar → Adicionar à Tela de Início',
    manual: 'Pelo menu do navegador: Instalar app ou Adicionar à tela inicial',
  };
  const action = st === 'installed' || st === 'done' ? `<span class="pill ok">${ic('check')}instalado</span>` : `<button class="btn btn-ghost btn-sm" data-a="installApp">${st === 'ready' ? 'Instalar' : 'Como instalar'}</button>`;
  return `<div class="li static" id="installRow">${ic('phone')}<div class="li-t"><b>Instalar o app</b><span>${texts[st]}</span></div>${action}</div>`;
}

// Convite discreto na tela inicial (paciente e profissional): só quando dá para instalar com um toque
// ou no iPhone, e some de vez com "Agora não".
export function installInvite() {
  const st = installState();
  if ((st !== 'ready' && st !== 'ios') || later()) return '<div data-install-slot></div>';
  return `<div data-install-slot><div class="install-invite">${ic('phone')}<div class="grow"><b>Tenha o Me Salva na tela inicial</b><span>Abre em tela cheia, como um app, e recebe lembretes de sessão.</span></div>
    <div class="row" style="gap:6px"><button class="btn btn-primary btn-sm" data-a="installApp">Instalar</button><button class="btn btn-ghost btn-sm" data-a="installLater" aria-label="Agora não">Agora não</button></div></div></div>`;
}

// Atualiza o convite e a linha de Configurações quando a situação muda (o evento do navegador chega depois).
function refreshInstallUI() {
  document.querySelectorAll('[data-install-slot]').forEach((el) => { el.outerHTML = installInvite(); });
  const row = document.getElementById('installRow');
  if (row) row.outerHTML = installRow();
}

/* ---------------- avisos do sistema ---------------- */
// Mostra um aviso do sistema. Pelo service worker quando ele existe (obrigatório no Android e no iPhone);
// senão, pela API antiga do navegador. Devolve true se mostrou.
export async function systemNotice(n, onClickFallback) {
  const opts = { body: n.body, tag: `ms-${n.id}`, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', lang: 'pt-BR', data: { id: n.id, screen: n.screen, param: n.param } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg?.active) { await reg.showNotification(n.title, opts); return true; }
  } catch { /* cai para a API antiga */ }
  try {
    const sys = new Notification(n.title, opts);
    sys.onclick = () => { window.focus(); sys.close(); onClickFallback?.(); };
    return true;
  } catch { return false; }
}

/* ---------------- Web Push: avisos com o app fechado ---------------- */
// Com a permissão dada e os avisos ligados, o aparelho se inscreve no serviço de push do navegador e manda a
// inscrição para o servidor (src/push.js), que passa a entregar as notificações mesmo com o app fechado.
// No iPhone, isso só existe no app instalado (iOS 16.4 ou mais recente).
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
// Chave pública em base64url → bytes, como o navegador espera em applicationServerKey.
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
const sameKey = (sub, key) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // navegador antigo: não informa a chave; o servidor confere
  const a = new Uint8Array(k); const b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};
// Garante a inscrição deste aparelho para quem está logado. Chamado ao abrir o app e ao ligar os avisos.
export async function syncPush() {
  try {
    if (!S.user || !pushSupported() || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    // Chaves do servidor trocadas (por exemplo, servidor novo): a inscrição antiga não vale mais.
    if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const j = sub.toJSON();
    await api('/api/push/subscribe', { method: 'POST', body: { endpoint: j.endpoint, keys: j.keys } });
    return true;
  } catch (e) {
    console.warn('Avisos com o app fechado indisponíveis:', e.message);
    return false;
  }
}
// Desliga os avisos deste aparelho (ao sair da conta ou ao desligar em Configurações).
export async function dropPush() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (S.user) await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  } catch { /* nada a desfazer */ }
}

/* ---------------- sem internet ---------------- */
// Faixa no topo quando a conexão cai. A ajuda imediata continua a um toque (o telefone funciona sem internet).
function paintNet() {
  let bar = document.getElementById('netbar');
  if (navigator.onLine) { bar?.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'netbar';
  bar.className = 'netbar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `${ic('wifiOff')}<span class="grow">Sem internet. Suas ações voltam a funcionar quando a conexão voltar.</span><button class="btn btn-sm" data-a="crise">${ic('lifebuoy')}Ajuda: 188</button>`;
  document.body.append(bar);
}
window.addEventListener('offline', paintNet);
window.addEventListener('online', () => { paintNet(); if (S.user) toast('Conexão de volta.'); });
paintNet();
