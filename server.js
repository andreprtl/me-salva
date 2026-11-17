// Ponto de entrada do servidor (`npm start`).
// Abre o banco SQLite em data/, carrega a chave do prontuário, cria os dados de demonstração
// se o banco estiver vazio, liga a conferência de lembretes (a cada minuto) e começa a atender em http://localhost:PORT.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './src/config.js';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { loadNotesKey } from './src/security.js';
import { seedDemo, DEMO_PASSWORD } from './src/seed.js';

// Garante que a pasta de dados exista antes de abrir o banco.
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(join(config.dataDir, 'mesalva.db'));
const notesKey = loadNotesKey(config);

// Primeira execução: popula o banco com profissionais, pacientes e histórico fictícios.
if (db.get('SELECT COUNT(*) n FROM users').n === 0) {
  seedDemo(db, { notesKey });
  console.log(`Banco vazio: dados de demonstração criados (senha das contas demo: ${DEMO_PASSWORD}).`);
}

// createApp devolve a função (req, res) que trata cada requisição HTTP.
const app = createApp({ db, config, notesKey });
const server = createServer(app);
// Lembretes de sessão 24 h e 1 h antes: confere agora e depois a cada minuto.
const stopReminders = app.ctx.reminders.start();
server.listen(config.port, () => {
  console.log(`Me Salva rodando em http://localhost:${config.port}`);
  if (config.demoMode) console.log('Modo demonstração ativo (DEMO_MODE=true).');
});

// Encerramento limpo (Ctrl+C ou parada do serviço): para os lembretes, fecha as conexões em tempo real, o servidor e o banco.
const stop = () => { stopReminders(); app.close(); server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
