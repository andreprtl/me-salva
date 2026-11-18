// Web Push (v1.2): avisos do sistema no celular mesmo com o app fechado, sem nenhuma dependência.
//
// Como funciona:
//   1. O navegador do paciente cria uma "inscrição" no serviço de push do fabricante (Google, Mozilla, Apple ou
//      Microsoft) e nos manda o endereço dela (endpoint) e duas chaves. Guardamos isso em push_subscriptions.
//   2. Quando uma notificação é criada (services.notify), o servidor criptografa o aviso para aquele aparelho
//      (RFC 8291, aes128gcm) e o entrega ao serviço de push, assinando o pedido com as chaves VAPID do Me Salva
//      (RFC 8292, um JWT ES256). Só o aparelho consegue abrir a mensagem; o serviço do fabricante não lê nada.
//   3. O service worker (public/sw.js) recebe o evento 'push' e mostra o aviso.
//
// Tudo com node:crypto (ECDH P-256, HKDF, AES-128-GCM, ECDSA) e node:https.
// Os avisos seguem a regra da v1.1: nunca levam o texto das mensagens do chat.
import { createECDH, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { request } from 'node:https';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// Serviços de push aceitos. O servidor só faz pedidos para esses endereços: uma inscrição com endereço
// qualquer faria o servidor bater em sites de terceiros (SSRF).
export const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export function allowedEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}

/* ---------------- chaves VAPID ---------------- */
// Par de chaves P-256 que identifica o Me Salva para os serviços de push. Vem de VAPID_PUBLIC_KEY e
// VAPID_PRIVATE_KEY (base64url) ou é gerado uma vez em data/vapid.json. Se as chaves mudarem, as inscrições
// antigas deixam de valer (o app se inscreve de novo sozinho na próxima abertura).
export function generateVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(pub.x), fromB64u(pub.y)])), privateKey: priv.d };
}
export function loadVapidKeys(config = {}) {
  if (config.vapidPublicKey && config.vapidPrivateKey) return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  if (!config.dataDir) return generateVapidKeys(); // testes e scripts: chaves só na memória
  const file = join(config.dataDir, 'vapid.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const keys = generateVapidKeys();
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}
// Chave privada para assinar, montada a partir dos valores em base64url.
function privateKeyObject({ publicKey, privateKey }) {
  const pub = fromB64u(publicKey);
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}

// Cabeçalho Authorization do VAPID: um JWT ES256 com o destino (aud), a validade (exp, até 24 h) e um contato (sub).
export function vapidAuth(endpoint, keys, { subject, now = Date.now(), ttlSec = 12 * 3600 } = {}) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + ttlSec, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/* ---------------- criptografia do aviso (RFC 8291) ---------------- */
// Criptografa payload para uma inscrição { p256dh, auth }. salt e asPrivate só são passados nos testes
// (para conferir com os valores de exemplo da RFC); no uso normal, são aleatórios a cada aviso.
export function encryptPayload(payload, { p256dh, auth }, { salt = randomBytes(16), asPrivate = null } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('Chaves da inscrição inválidas.');
  const ecdh = createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  // Chave de entrada (IKM) misturando o segredo ECDH, o segredo de autenticação e as duas chaves públicas.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  // Chave e número único da mensagem (aes128gcm, RFC 8188).
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // Um registro só: o texto seguido do delimitador 0x02 ("último registro").
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  // Cabeçalho: salt (16) | tamanho do registro (4) | tamanho da chave (1) | chave pública temporária (65).
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}
/* ---------------- envio ---------------- */
// POST HTTPS para o serviço de push. Devolve { status }. Os testes trocam esta função por uma falsa.
function httpsPost(url, headers, body) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'POST', headers: { ...headers, 'Content-Length': body.length }, timeout: 10000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.end(body);
  });
}

// Cria o serviço de Web Push. send pode ser trocado nos testes. As chaves são carregadas só quando usadas.
export function createPush({ db, config = {}, send = httpsPost }) {
  let keys = null;
  const getKeys = () => (keys ||= loadVapidKeys(config));
  const subject = config.vapidSubject || 'https://github.com/andreprtl/me-salva';
  const enabled = config.push !== false;

  // Entrega um aviso a todos os aparelhos inscritos de um usuário. Não bloqueia quem chamou:
  // falhas vão para o log, e inscrições que o serviço diz não existirem mais (404 e 410) são apagadas.
  async function sendTo(userId, n) {
    if (!enabled || !userId) return [];
    const subs = db.all('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', userId);
    if (!subs.length) return [];
    const payload = JSON.stringify({ id: n.id, title: n.title, body: n.body, screen: n.screen, param: n.param, kind: n.kind });
    return Promise.all(subs.map(async (s) => {
      if (!allowedEndpoint(s.endpoint)) return { id: s.id, status: 0 };
      try {
        const res = await send(s.endpoint, {
          TTL: String(24 * 3600),
          Urgency: n.kind === 'reminder' ? 'high' : 'normal',
          // Avisos do mesmo assunto se substituem no serviço de push enquanto o aparelho está desligado.
          Topic: `ms${n.id}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          Authorization: vapidAuth(s.endpoint, getKeys(), { subject }),
        }, encryptPayload(payload, s));
        if (res.status === 404 || res.status === 410) db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
        else if (res.status < 200 || res.status >= 300) console.warn(`Web Push: o serviço respondeu ${res.status}${res.error ? ` (${res.error})` : ''}.`);
        return { id: s.id, status: res.status };
      } catch (e) {
        console.warn('Web Push: falha ao enviar.', e.message);
        return { id: s.id, status: 0 };
      }
    }));
  }

  return { sendTo, publicKey: () => getKeys().publicKey, enabled };
}
