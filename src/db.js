// Banco de dados SQLite embutido no Node (node:sqlite). Nenhuma instalação extra.
// Valores em dinheiro são inteiros em centavos; listas (temas, público, modalidades) são texto JSON.
import { DatabaseSync } from 'node:sqlite';

// Esquema completo. CREATE TABLE IF NOT EXISTS permite rodar a cada inicialização sem apagar dados.
// O índice único appt_slot impede duas reservas ativas no mesmo horário do mesmo profissional.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('patient','pro','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  bairro TEXT NOT NULL DEFAULT 'Bela Vista',
  address TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','plus')),
  plan_since TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pros(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  title TEXT NOT NULL,
  reg TEXT NOT NULL,
  approach TEXT NOT NULL,
  approach_short TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',
  audience TEXT NOT NULL DEFAULT '[]',
  modalities TEXT NOT NULL DEFAULT '["online"]',
  price INTEGER NOT NULL,
  years INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#2F7D69',
  is_new INTEGER NOT NULL DEFAULT 0,
  supervisor TEXT,
  social_price INTEGER,
  social_weekly INTEGER NOT NULL DEFAULT 0,
  auto_fill INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
  verified_at TEXT
);
CREATE TABLE IF NOT EXISTS availability(
  pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  hour TEXT NOT NULL,
  PRIMARY KEY(pro_id, weekday, hour)
);
CREATE TABLE IF NOT EXISTS appointments(
  id INTEGER PRIMARY KEY,
  patient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start TEXT NOT NULL,                 -- horário local de São Paulo, 'AAAA-MM-DDTHH:MM'
  modality TEXT NOT NULL CHECK(modality IN ('online','presencial')),
  social INTEGER NOT NULL DEFAULT 0,
  base_price INTEGER NOT NULL,         -- centavos
  amount INTEGER NOT NULL,             -- pago pelo paciente
  fee INTEGER NOT NULL,                -- fica com a plataforma
  pro_amount INTEGER NOT NULL,         -- repassado ao profissional
  status TEXT NOT NULL CHECK(status IN ('pending_payment','confirmed','done','no_show','cancelled')),
  room TEXT,
  expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS appt_slot ON appointments(pro_id, start)
  WHERE status IN ('pending_payment','confirmed','done','no_show');
CREATE INDEX IF NOT EXISTS appt_patient ON appointments(patient_id, start);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('session','plus')),
  method TEXT NOT NULL CHECK(method IN ('pix','card')),
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  pro_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending','paid','refunded','expired','failed')),
  pix_code TEXT,
  card_last4 TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER,                   -- nulo em mensagens automáticas do sistema
  kind TEXT NOT NULL CHECK(kind IN ('text','audio','system')),
  body TEXT NOT NULL DEFAULT '',
  audio TEXT,                          -- data URL do áudio gravado
  duration INTEGER,
  read_by_patient INTEGER NOT NULL DEFAULT 0,
  read_by_pro INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS msg_conv ON messages(patient_id, pro_id, id);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER UNIQUE REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',
  text TEXT NOT NULL DEFAULT '',
  author_label TEXT NOT NULL DEFAULT 'Anônimo',
  modality TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS rev_pro ON reviews(pro_id, created_at);
CREATE TABLE IF NOT EXISTS triages(
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  answers TEXT NOT NULL,
  needs TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  iv TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL,   -- AES-256-GCM
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

// Abre o banco e devolve uma interface pequena: all/get/run com parâmetros '?', exec e tx (transação).
// As consultas preparadas ficam em cache para não serem recompiladas a cada chamada.
export function openDb(file) {
  const db = new DatabaseSync(file);
  // Liga as chaves estrangeiras: ON DELETE CASCADE e SET NULL passam a valer.
  db.exec('PRAGMA foreign_keys = ON;');
  // WAL permite leituras enquanto uma escrita está em andamento.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const cache = new Map();
  const st = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    raw: db,
    all: (sql, ...p) => st(sql).all(...p),
    get: (sql, ...p) => st(sql).get(...p),
    run: (sql, ...p) => st(sql).run(...p),
    exec: (sql) => db.exec(sql),
    // Executa fn numa transação: se der erro no meio, nada é gravado.
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close: () => db.close(),
  };
}

// Converte texto JSON guardado no banco, com valor padrão se estiver vazio ou inválido.
export const json = (s, fallback = []) => { try { return JSON.parse(s); } catch { return fallback; } };
