// Segurança: senhas (scrypt), tokens de sessão, criptografia do prontuário (AES-256-GCM),
// limite de tentativas e utilidades do pagamento simulado (código PIX e validação de cartão).
import { scryptSync, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Gera 'scrypt$sal$hash'. O sal aleatório faz senhas iguais terem hashes diferentes.
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
// Recalcula o hash com o mesmo sal e compara em tempo constante (evita ataques que medem o tempo de resposta).
export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, got);
}

// Token de sessão aleatório. Vai no cookie; no banco fica só o SHA-256 dele.
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomId = (n = 9) => randomBytes(n).toString('base64url');

// A chave do prontuário vem de NOTES_KEY ou é criada uma vez em data/notes.key.
export function loadNotesKey(config) {
  if (config.notesKey) {
    // Aceita 64 caracteres hexadecimais ou qualquer frase longa (derivada com SHA-256).
    return /^[0-9a-f]{64}$/i.test(config.notesKey) ? Buffer.from(config.notesKey, 'hex') : createHash('sha256').update(config.notesKey).digest();
  }
  mkdirSync(config.dataDir, { recursive: true });
  const file = join(config.dataDir, 'notes.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
}

// Criptografa um texto. Cada nota tem IV próprio, e a tag GCM detecta qualquer alteração no dado guardado.
export function encrypt(key, text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
// Decifra uma nota; lança erro se a chave estiver errada ou o conteúdo tiver sido adulterado.
export function decrypt(key, { iv, tag, data }) {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// Limite simples de tentativas por IP (login e cadastro).
export function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}

// Código PIX "copia e cola" no formato BR Code (EMV), com CRC16 válido. Chave fictícia.
export function pixCode({ amountCents, txid }) {
  const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
  const account = f('00', 'br.gov.bcb.pix') + f('01', 'pix@mesalva.app');
  let payload = f('00', '01') + f('26', account) + f('52', '0000') + f('53', '986') +
    f('54', (amountCents / 100).toFixed(2)) + f('58', 'BR') + f('59', 'ME SALVA TECNOLOGIA') +
    f('60', 'SAO PAULO') + f('62', f('05', txid.slice(0, 25))) + '6304';
  let crc = 0xffff;
  for (const ch of Buffer.from(payload, 'utf8')) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return payload + crc.toString(16).toUpperCase().padStart(4, '0');
}

// Verificação de número de cartão (algoritmo de Luhn), usada no pagamento simulado.
export function luhn(num) {
  const s = String(num).replace(/\D/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
