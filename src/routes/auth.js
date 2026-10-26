// Cadastro, entrada e saída.
import { HttpError } from '../http.js';
import { COOKIE } from '../guards.js';
import { hashPassword, verifyPassword, newToken, sha256, rateLimiter } from '../security.js';
import { str, int, oneOf, listOf, email, password, bad } from '../validate.js';
import { AREAS, BAIRRO_NAMES, TOPICS, AUDIENCES, areaById } from '../../public/js/shared/data.js';

// Cores dos avatares de profissionais novos (escolhidas pelo id).
const COLORS = ['#2F7D69', '#7C5CD6', '#C26B3E', '#3B6EA8', '#A04D78', '#1C8C7C', '#6B7A2E', '#B5462F', '#4E5BA6', '#8A5A2B'];
// Disponibilidade inicial de quem acabou de se cadastrar como profissional: segunda a sexta nesses horários.
const DEFAULT_HOURS = ['09:00', '10:00', '14:00', '15:00', '16:00'];

// Cria a sessão: token aleatório no cookie HttpOnly e só o hash dele no banco.
// Aproveita para apagar sessões vencidas.
export function startSession(db, config, req, res, userId) {
  const token = newToken();
  const maxAge = config.sessionDays * 86400;
  db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  db.run('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
}

// Dados do usuário que podem ir para o navegador (nunca o hash da senha).
export function publicUser(db, svc, u) {
  const base = { id: u.id, role: u.role, name: u.name, email: u.email, bairro: u.bairro, address: u.address, plan: u.plan, plan_since: u.plan_since, is_demo: Boolean(u.is_demo) };
  if (u.role === 'pro') base.pro = svc.getPro(u.id);
  base.unread = svc.unreadCount(u);
  return base;
}

export default function authRoutes(r, { db, config, svc }) {
  // No máximo 12 tentativas de entrada (e 12 de cadastro) a cada 5 minutos por IP.
  const limit = rateLimiter({ max: 12, windowMs: 5 * 60 * 1000 });

  // Cadastro de paciente ou profissional. O profissional começa como 'pending' e só aparece na busca
  // depois que a administração confere o registro no conselho.
  r.post('/api/auth/register', (req, res) => {
    if (!limit('reg:' + req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    const b = req.body;
    const role = oneOf(b.role, ['patient', 'pro'], 'o tipo de conta');
    const name = str(b.name, 'o nome', { min: 3, max: 80 });
    const mail = email(b.email);
    const pass = password(b.password);
    const bairro = oneOf(b.bairro, BAIRRO_NAMES, 'o bairro');
    if (db.get('SELECT 1 FROM users WHERE email = ?', mail)) throw bad('Já existe uma conta com esse e-mail. Use "Entrar".');
    if (b.consent !== true) throw bad('Para criar a conta, aceite os termos de uso e a política de privacidade.');

    let pro = null;
    if (role === 'pro') {
      const p = b.pro || {};
      const area = oneOf(p.area, AREAS.map((a) => a.id), 'a área de atuação');
      const reg = str(p.reg, 'o número de registro', { min: 5, max: 40 }).toUpperCase();
      const conselho = areaById(area).conselho;
      // O registro precisa ser do conselho da área (CRP, CRM ou CREFITO).
      if (!reg.startsWith(conselho)) throw bad(`Para ${areaById(area).nome.toLowerCase()}, informe o registro no ${conselho}, por exemplo ${conselho} 06/123456.`);
      pro = {
        area, reg,
        title: str(p.title, 'o título profissional', { min: 3, max: 60 }),
        approach: str(p.approach, 'a abordagem', { min: 2, max: 80 }),
        approach_short: str(p.approach_short || p.approach, 'a abordagem resumida', { min: 2, max: 30 }).slice(0, 30),
        topics: listOf(p.topics, TOPICS, 'os temas', { min: 1 }),
        audience: listOf(p.audience, AUDIENCES, 'o público atendido', { min: 1 }),
        modalities: listOf(p.modalities, ['online', 'presencial'], 'a modalidade', { min: 1 }),
        price: int(p.price, 'o valor da sessão', { min: 40, max: 1000 }) * 100,
        years: int(p.years ?? 0, 'os anos de experiência', { min: 0, max: 60 }),
        bio: str(p.bio, 'a apresentação', { min: 20, max: 800 }),
        is_new: p.is_new ? 1 : 0,
        supervisor: p.is_new ? str(p.supervisor, 'o supervisor clínico', { min: 5, max: 120 }) : null,
      };
    }

    const id = db.tx(() => {
      const uid = db.run('INSERT INTO users(role, name, email, pass_hash, bairro, address) VALUES (?, ?, ?, ?, ?, ?)',
        role, name, mail, hashPassword(pass), bairro, str(b.address, 'o endereço', { optional: true, max: 160 })).lastInsertRowid;
      if (pro) {
        db.run(`INSERT INTO pros(user_id, area, title, reg, approach, approach_short, topics, audience, modalities, price, years, bio, color, is_new, supervisor, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        uid, pro.area, pro.title, pro.reg, pro.approach, pro.approach_short, JSON.stringify(pro.topics), JSON.stringify(pro.audience),
        JSON.stringify(pro.modalities), pro.price, pro.years, pro.bio, COLORS[uid % COLORS.length], pro.is_new, pro.supervisor);
        for (let wd = 1; wd <= 5; wd++) for (const h of DEFAULT_HOURS) db.run('INSERT INTO availability(pro_id, weekday, hour) VALUES (?, ?, ?)', uid, wd, h);
      }
      return uid;
    });
    svc.audit(id, 'account.create', role);
    startSession(db, config, req, res, id);
    return { user: publicUser(db, svc, db.get('SELECT * FROM users WHERE id = ?', id)) };
  });

  // Entrada com e-mail e senha. A mensagem de erro é a mesma para e-mail inexistente e senha errada.
  r.post('/api/auth/login', (req, res) => {
    if (!limit('login:' + req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    const mail = String(req.body.email || '').trim().toLowerCase();
    const u = db.get('SELECT * FROM users WHERE email = ?', mail);
    if (!u || !verifyPassword(String(req.body.password || ''), u.pass_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.');
    startSession(db, config, req, res, u.id);
    svc.audit(u.id, 'login');
    return { user: publicUser(db, svc, u) };
  });

  // Saída: apaga a sessão do banco e expira o cookie.
  r.post('/api/auth/logout', (req, res) => {
    const token = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`))?.[1];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(decodeURIComponent(token)));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  });

  // Contas de demonstração exibidas na tela de entrada (só no modo demo).
  r.get('/api/demo-accounts', () => {
    if (!config.demoMode) return { accounts: [] };
    const rows = db.all("SELECT u.name, u.email, u.role, p.status FROM users u LEFT JOIN pros p ON p.user_id = u.id WHERE u.is_demo = 1 ORDER BY u.id");
    return { password: 'demo1234', accounts: rows };
  });
}
