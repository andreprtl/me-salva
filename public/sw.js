// Service worker do Me Salva (v1.2): é o que torna o site um app instalável no celular.
//
// O que ele faz:
//   1. Guarda no aparelho a estrutura do app (HTML, CSS, JavaScript, ícones e fontes) num cache com versão.
//      Quando qualquer arquivo de public/ muda, o servidor entrega este arquivo com outra versão, o navegador
//      instala o service worker novo, que baixa tudo de novo e apaga o cache antigo.
//   2. A API (/api/...) vai sempre pela rede e nunca é guardada: agenda, mensagens e pagamentos são dados de
//      saúde e mudam a todo momento. O canal em tempo real (/api/stream) também passa direto.
//   3. Sem internet, abrir o app mostra a página offline, com o botão de ajuda imediata (CVV 188).
//   4. Mostra os avisos do sistema (notificações) e abre a tela certa quando a pessoa toca neles,
//      inclusive os que chegam pelo Web Push com o app fechado.
//
// O servidor (src/pwa.js) troca VERSION e SHELL pelos valores atuais antes de entregar este arquivo.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;

const SHELL_CACHE = `ms-shell-${VERSION}`;
// Fontes do Google Fonts: ficam num cache próprio, que sobrevive às versões (os arquivos de fonte não mudam).
const FONT_CACHE = 'ms-fonts-1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const OFFLINE = '/offline.html';

// Instalação: baixa a estrutura do app. cache: 'reload' ignora o cache HTTP, para não guardar uma cópia velha.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting(); // a versão nova assume sem esperar todas as abas fecharem
  })());
});

// Ativação: apaga os caches de versões anteriores e passa a controlar as abas já abertas.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, FONT_CACHE]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // envios (POST, PUT…) vão direto para a rede
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // API e canal em tempo real: sempre pela rede, sem passar pelo cache.
    if (url.pathname.startsWith('/api/')) return;
    // Abrir o app (navegação): rede primeiro, para pegar a versão mais nova; sem internet, a página offline.
    if (req.mode === 'navigate') {
      event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
      return;
    }
    // Arquivos da estrutura (CSS, JS, ícones): do cache desta versão; o que não estiver lá vem da rede.
    event.respondWith((async () => {
      const hit = await caches.match(req, { cacheName: SHELL_CACHE, ignoreSearch: true });
      return hit || fetch(req);
    })());
    return;
  }

  // Fontes do Google: a folha de estilos é usada do cache e atualizada em segundo plano;
  // os arquivos de fonte, uma vez baixados, vêm sempre do cache.
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(fontFirst(event, req, url.hostname === 'fonts.gstatic.com'));
});

async function fontFirst(event, req, immutable) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    if (!immutable) event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

/* ---------------- avisos do sistema ---------------- */
// Web Push: a mensagem chega criptografada do servidor (src/push.js) mesmo com o app fechado.
// Com uma aba do Me Salva à vista, quem avisa é a própria página (toast); aqui não repete.
self.addEventListener('push', (event) => {
  let n = {};
  try { n = event.data ? event.data.json() : {}; } catch { /* mensagem sem JSON */ }
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === 'visible')) return;
    await show(n);
  })());
});

// Mesmo formato do aviso que a página mostra (public/js/pwa.js, systemNotice). A etiqueta (tag) é igual
// nos dois casos: se o push e a página avisarem o mesmo fato, o sistema mostra um aviso só.
function show(n) {
  return self.registration.showNotification(n.title || 'Me Salva', {
    body: n.body || '',
    tag: n.id ? `ms-${n.id}` : 'ms',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    lang: 'pt-BR',
    data: { id: n.id, screen: n.screen, param: n.param },
  });
}

// Toque no aviso: abre (ou traz para a frente) o app e pede para ele abrir a tela certa.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const n = event.notification.data || {};
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      tab.postMessage({ type: 'ms-open', notification: n });
      return;
    }
    const url = new URL('/', self.location.origin);
    if (n.screen) url.searchParams.set('tela', n.screen);
    if (n.param != null) url.searchParams.set('p', n.param);
    if (n.id) url.searchParams.set('n', n.id);
    await self.clients.openWindow(url.href);
  })());
});
