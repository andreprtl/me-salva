// Configuração lida de variáveis de ambiente (veja .env.example).
// Todas têm valor padrão, então o projeto roda sem nenhum arquivo .env.
import { resolve } from 'node:path';

const env = process.env;

export const config = {
  // Porta HTTP; serviços como o Render definem PORT automaticamente.
  port: Number(env.PORT) || 3000,
  // Pasta onde ficam o banco (mesalva.db) e a chave do prontuário (notes.key).
  dataDir: resolve(env.DATA_DIR || './data'),
  // Em produção o cookie de sessão é marcado como Secure (só HTTPS).
  production: env.NODE_ENV === 'production',
  // Modo demonstração: libera a sala de vídeo em qualquer horário do dia da sessão
  // e mostra o botão "Restaurar dados de demonstração" para o administrador.
  demoMode: (env.DEMO_MODE ?? 'true') !== 'false',
  // Chave de 32 bytes (hex) para criptografar o prontuário. Se ausente, é gerada em data/notes.key.
  notesKey: env.NOTES_KEY || null,
  // Endereço base das salas de vídeo (Jitsi Meet público por padrão).
  videoBaseUrl: env.VIDEO_BASE_URL || 'https://meet.jit.si/',
  // Validade do login, em dias.
  sessionDays: 7,
};
