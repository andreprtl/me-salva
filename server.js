// Ponto de entrada do servidor (`npm start`).
// Abre o banco SQLite em data/, carrega a chave do prontuário, cria os dados de demonstração
// se o banco estiver vazio e começa a atender em http://localhost:PORT.
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
const server = createServer(createApp({ db, config, notesKey }));
server.listen(config.port, () => {
  console.log(`Me Salva rodando em http://localhost:${config.port}`);
  if (config.demoMode) console.log('Modo demonstração ativo (DEMO_MODE=true).');
});

// Encerramento limpo (Ctrl+C ou parada do serviço): fecha o servidor e o banco.
const stop = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
