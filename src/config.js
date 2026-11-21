// Configuração lida de variáveis de ambiente (veja .env.example).
// Todas têm valor padrão, então o projeto roda sem nenhum arquivo .env.
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Versão do app (do package.json): aparece em Configurações e entra na versão do service worker.
export const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const env = process.env;

export const config = {
  // Porta HTTP; serviços como o Render definem PORT automaticamente. PORT=0 escolhe uma porta livre (usado nos testes).
  port: env.PORT ? Number(env.PORT) : 3000,
  // Pasta onde ficam o banco (mesalva.db) e a chave do prontuário (notes.key).
  dataDir: resolve(env.DATA_DIR || './data'),
  // Em produção o cookie de sessão é marcado como Secure (só HTTPS) e as respostas levam HSTS.
  production: env.NODE_ENV === 'production',
  // Atrás de um proxy (v2.0): acredita nos cabeçalhos que o proxy do Render e a Cloudflare põem no pedido
  // (CF-Connecting-IP, X-Forwarded-For e X-Forwarded-Proto). Ligado em produção; TRUST_PROXY=false desliga.
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY !== 'false' : env.NODE_ENV === 'production',
  // Modo demonstração: libera a sala de vídeo em qualquer horário do dia da sessão
  // e mostra o botão "Restaurar dados de demonstração" para o administrador.
  demoMode: (env.DEMO_MODE ?? 'true') !== 'false',
  // Chave de 32 bytes (hex) para criptografar o prontuário. Se ausente, é gerada em data/notes.key.
  notesKey: env.NOTES_KEY || null,
  // Endereço base das salas de vídeo (Jitsi Meet público por padrão).
  videoBaseUrl: env.VIDEO_BASE_URL || 'https://meet.jit.si/',
  // Validade do login, em dias.
  sessionDays: 7,
  // Sinal de vida do canal em tempo real (/api/stream), em milissegundos.
  heartbeatMs: 25000,
  // Web Push (v1.2): avisos no celular com o app fechado. PUSH=off desliga o envio.
  push: env.PUSH !== 'off',
  // Chaves VAPID em base64url. Sem elas, um par é gerado uma vez em data/vapid.json.
  vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: env.VAPID_PRIVATE_KEY || null,
  // Contato enviado aos serviços de push junto com as chaves (endereço https: ou mailto:).
  vapidSubject: env.VAPID_SUBJECT || 'https://github.com/andreprtl/me-salva',
};
