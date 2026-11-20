// Dados de demonstração. Todas as pessoas e números são fictícios.
// Uso: `npm run seed` apaga o banco e recria os dados; o servidor também roda isto se o banco estiver vazio.
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword, randomId, encrypt, loadNotesKey } from './security.js';
import { nowSP, addDays, weekday, weekStart, toMinutes, fromMinutes, whenText } from './time.js';
import { quote } from './pricing.js';
import { socialKeys } from './slots.js';
import { occurrences, overlaps } from './recurrence.js';
import { weekdaysText } from '../public/js/shared/data.js';

export const DEMO_PASSWORD = 'demo1234';

// Atalhos: H(8, 9) → ['08:00', '09:00']; tpl(dias, horas) → disponibilidade semanal.
const H = (...hs) => hs.map((h) => String(h).padStart(2, '0') + ':00');
const tpl = (days, hours) => days.flatMap((d) => hours.map((h) => ({ weekday: d, hour: h })));
const WEEK = [1, 2, 3, 4, 5];

// Profissionais fictícios. price e social em reais; rating e n são a nota e o número de avaliações desejados.
// demo: true cria uma conta com botão na tela de entrada.
const PROS = [
  { key: 'bruno', name: 'Bruno Corrêa', title: 'Psicólogo', area: 'psicologo', reg: 'CRP 06/148392', approach: 'Terapia Cognitivo-Comportamental', short: 'TCC', topics: ['Ansiedade', 'Estresse no trabalho', 'Autoestima'], audience: ['Adultos', 'Adolescentes'], price: 100, rating: 4.9, n: 60, modal: ['online', 'presencial'], bairro: 'Pinheiros', years: 9, color: '#2F7D69',
    bio: 'Trabalho com adultos e adolescentes que vivem crises de ansiedade, esgotamento e cobrança excessiva. As sessões têm metas claras e exercícios práticos entre um encontro e outro.',
    hours: tpl(WEEK, H(8, 9, 17, 18, 19)),
    reviews: [['Rafaela M.', 5, 'O Bruno me ajudou a entender minhas crises de ansiedade. Saio das sessões com exercícios práticos para a semana.', ['Explicações claras']], ['Anônimo', 5, 'Pontual, acolhedor e muito claro nas explicações.', ['Pontualidade', 'Acolhimento']]] },
  { key: 'fernanda', demo: true, name: 'Fernanda Alves', title: 'Psicóloga', area: 'psicologo', reg: 'CRP 06/139021', approach: 'Psicologia Humanista', short: 'Humanista', topics: ['Luto', 'Relacionamentos', 'Ansiedade'], audience: ['Adultos'], price: 75, rating: 4.8, n: 40, modal: ['online'], bairro: 'Vila Mariana', years: 6, color: '#7C5CD6',
    bio: 'Ofereço um espaço de escuta acolhedor para quem atravessa perdas, términos e mudanças de vida. Atendo exclusivamente online, com horários à noite.',
    hours: tpl(WEEK, H(18, 19, 20)),
    reviews: [['Paula R.', 5, 'Me senti ouvida desde a primeira sessão. Está me ajudando muito no luto pela minha mãe.', ['Me senti ouvido(a)']], ['Anônimo', 4, 'Ótima profissional. A conexão de vídeo oscilou uma vez, mas nada que atrapalhasse.', ['Acolhimento']]] },
  { key: 'caio', name: 'Caio Lima', title: 'Psicólogo', area: 'psicologo', reg: 'CRP 06/155480', approach: 'Análise do Comportamento', short: 'Comportamental', topics: ['TDAH', 'Depressão', 'Procrastinação'], audience: ['Adultos'], price: 80, rating: 4.7, n: 30, modal: ['online', 'presencial'], bairro: 'Santana', years: 5, color: '#C26B3E',
    bio: 'Atendo adultos com TDAH e dificuldades de organização, foco e humor. Construímos juntos rotinas possíveis, sem fórmulas prontas.',
    hours: tpl([1, 3, 5], H(9, 10, 11, 14, 15)),
    reviews: [['Diego S.', 5, 'Finalmente alguém que entende TDAH em adulto. As estratégias de rotina funcionam.', ['Explicações claras', 'Indicaria']]] },
  { key: 'luiz', name: 'Luiz Ricardo Souza', title: 'Psicólogo', area: 'psicologo', reg: 'CRP 06/120377', approach: 'Terapia Sistêmica', short: 'Sistêmica', topics: ['Terapia de casal', 'Família', 'Relacionamentos'], audience: ['Adultos', 'Famílias'], price: 95, rating: 4.5, n: 35, modal: ['presencial', 'online'], bairro: 'Tatuapé', years: 14, color: '#3B6EA8',
    bio: 'Atendo casais e famílias que querem melhorar a comunicação e atravessar conflitos com mais cuidado.',
    hours: tpl([2, 4], H(10, 11, 14, 15, 16, 19)),
    reviews: [['Casal F.', 5, 'Voltamos a conversar sem brigar. Recomendo para casais.', ['Indicaria']]] },
  { key: 'ana', name: 'Dra. Ana Clara Moraes', title: 'Psiquiatra', area: 'psiquiatra', reg: 'CRM-SP 184520', approach: 'Especialista em TDAH', short: 'TDAH', topics: ['TDAH', 'Ansiedade', 'Depressão'], audience: ['Adultos', 'Adolescentes'], price: 220, rating: 4.6, n: 40, modal: ['online', 'presencial'], bairro: 'Moema', years: 11, color: '#A04D78',
    bio: 'Psiquiatra com foco em TDAH em adolescentes e adultos. Consultas de 50 minutos, com retorno em até 30 dias incluso e laudo quando necessário.',
    hours: tpl([1, 2, 4], H(9, 10, 11, 14, 15)),
    reviews: [['Renata C.', 5, 'Consulta detalhada e sem pressa. Explicou cada opção de tratamento para o TDAH.', ['Explicações claras']], ['Marcelo P.', 4, 'Muito competente. O valor é mais alto, mas vale pela atenção.', []]] },
  { key: 'juliana', name: 'Juliana Prado', title: 'Analista do Comportamento', area: 'aba', reg: 'CRP 06/131207', approach: 'ABA – Análise do Comportamento Aplicada', short: 'ABA', topics: ['TEA', 'Comunicação', 'Orientação parental'], audience: ['Crianças', 'Famílias'], price: 110, rating: 4.9, n: 30, modal: ['presencial', 'online'], bairro: 'Butantã', years: 10, color: '#1C8C7C',
    bio: 'Supervisora clínica em ABA. Faço avaliação inicial com VB-MAPP, monto o plano de intervenção com metas mensais e oriento a família para aplicar as estratégias em casa.',
    hours: tpl(WEEK, H(8, 9, 10, 11)),
    reviews: [['Mãe do Theo', 5, 'Em dois meses o Theo passou a pedir as coisas apontando e falando. A orientação para nós, pais, faz toda a diferença.', ['Explicações claras', 'Indicaria']], ['Família A.', 5, 'Plano de intervenção claro, com metas e relatórios mensais.', []]] },
  { key: 'rafael', demo: true, name: 'Rafael Nunes', title: 'Psicólogo · ABA', area: 'aba', reg: 'CRP 06/201884', approach: 'ABA – Análise do Comportamento Aplicada', short: 'ABA', topics: ['TEA', 'Habilidades sociais', 'Rotina', 'Comunicação'], audience: ['Crianças', 'Famílias'], price: 90, social: 45, socialWeekly: 4, autoFill: true, isNew: true, supervisor: 'Juliana Prado (CRP 06/131207), supervisão semanal', rating: 4.8, n: 23, modal: ['presencial', 'online'], bairro: 'Penha', years: 1, color: '#6B7A2E',
    bio: 'Recém-formado e especializando em ABA. Atendo crianças com TEA em casa ou online, sempre com supervisão clínica. Ofereço vagas sociais para famílias que precisam de alta frequência semanal.',
    hours: [...tpl(WEEK, H(8, 9, 10, 14, 15, 16, 17)), ...tpl([6], H(8, 9, 10))],
    reviews: [['Pai da Lara', 5, 'Paciente e carinhoso com a Lara. A vaga social permitiu manter três sessões por semana.', ['Acolhimento', 'Indicaria']], ['Anônimo', 5, 'Mesmo recém-formado, mostra muito preparo. Gostei de saber que há supervisão.', []], ['Família N.', 4, 'Bom trabalho com a rotina em casa.', []]] },
  { key: 'marina', name: 'Marina Okada', title: 'Neuropsicóloga', area: 'neuro', reg: 'CRP 06/118934', approach: 'Avaliação neuropsicológica', short: 'Avaliação', topics: ['TEA', 'TDAH', 'Dificuldade escolar'], audience: ['Crianças', 'Adolescentes', 'Adultos'], price: 180, rating: 4.9, n: 30, modal: ['presencial'], bairro: 'Liberdade', years: 12, color: '#B5462F',
    bio: 'Realizo avaliação neuropsicológica para investigação de TEA e TDAH, com devolutiva para a família e relatório para a escola.',
    hours: tpl([1, 2, 3, 4], H(9, 14)),
    reviews: [['Camila B.', 5, 'Avaliação completa e devolutiva muito bem explicada para a escola.', ['Explicações claras']]] },
  { key: 'pedro', name: 'Pedro Henrique Castro', title: 'Psicanalista', area: 'psicanalista', reg: 'CRP 06/109215', approach: 'Psicanálise', short: 'Psicanálise', topics: ['Angústia', 'Relacionamentos', 'Autoconhecimento'], audience: ['Adultos'], price: 120, rating: 4.7, n: 25, modal: ['online', 'presencial'], bairro: 'Higienópolis', years: 16, color: '#4E5BA6',
    bio: 'Atendimento psicanalítico para adultos, com frequência semanal ou bissemanal.',
    hours: tpl(WEEK, H(7, 8, 20)),
    reviews: [['Anônimo', 5, 'Um espaço de escuta que eu não encontrava há anos.', ['Me senti ouvido(a)']]] },
  { key: 'leticia', name: 'Letícia Barbosa', title: 'Psicóloga infantil', area: 'psicologo', reg: 'CRP 06/199402', approach: 'Ludoterapia', short: 'Ludoterapia', topics: ['Ansiedade infantil', 'TEA', 'Comportamento'], audience: ['Crianças', 'Famílias'], price: 85, social: 50, socialWeekly: 3, isNew: true, supervisor: 'Supervisão quinzenal com psicóloga infantil sênior (CRP 06/087744)', rating: 4.6, n: 18, modal: ['presencial', 'online'], bairro: 'Mooca', years: 2, color: '#8A5A2B',
    bio: 'Atendo crianças de 3 a 12 anos usando o brincar como ferramenta. Dou retorno aos responsáveis a cada mês.',
    hours: tpl([1, 2, 3, 4, 5], H(14, 15, 16)),
    reviews: [['Mãe do Davi', 5, 'O Davi adora as sessões e está mais calmo na escola.', []], ['Anônimo', 4, 'Atenciosa e dá retorno aos pais toda semana.', ['Pontualidade']]] },
  { key: 'thiago', name: 'Dr. Thiago Ferraz', title: 'Psiquiatra infantil', area: 'psiquiatra', reg: 'CRM-SP 162388', approach: 'Psiquiatria da infância e adolescência', short: 'Infantil', topics: ['TEA', 'TDAH', 'Ansiedade infantil'], audience: ['Crianças', 'Adolescentes'], price: 280, rating: 4.8, n: 30, modal: ['online', 'presencial'], bairro: 'Perdizes', years: 13, color: '#2E6F8E',
    bio: 'Psiquiatra da infância e adolescência. Faço diagnóstico de TEA e TDAH e acompanho junto com a equipe terapêutica da criança.',
    hours: tpl([2, 3, 5], H(9, 10, 15, 16)),
    reviews: [['Família S.', 5, 'Explicou o diagnóstico com cuidado e indicou a equipe certa.', ['Explicações claras']]] },
  { key: 'camila', name: 'Camila Rocha', title: 'Terapeuta ocupacional', area: 'to', reg: 'CREFITO-3 21345-TO', approach: 'Integração sensorial', short: 'Int. sensorial', topics: ['TEA', 'Seletividade alimentar', 'Autonomia', 'Integração sensorial'], audience: ['Crianças'], price: 130, rating: 4.8, n: 20, modal: ['presencial'], bairro: 'Santo Amaro', years: 8, color: '#9A3F5C',
    bio: 'Terapeuta ocupacional com formação em integração sensorial. Trabalho alimentação, sono e autonomia de crianças com TEA.',
    hours: tpl([1, 3, 5], H(8, 9, 10, 14)),
    reviews: [['Mãe da Alice', 5, 'A Alice voltou a aceitar novos alimentos e roupas.', []]] },
];

const ADULTS = ['Rafaela Martins', 'Gustavo Lima', 'Paula Ribeiro', 'Diego Santos', 'Bianca Torres', 'Renata Costa', 'Marcelo Pires', 'Camila Barros', 'Lucas Fernandes', 'Aline Moraes', 'Pedro Alves', 'Vanessa Duarte'];
const FAMILIES = ['Carla Mendes', 'Roberto Nogueira', 'Tatiane Oliveira', 'Ricardo Alves', 'Patrícia Gomes', 'Eduardo Ramos', 'Simone Batista', 'Helena Costa'];

// Gerador pseudoaleatório com semente fixa: os dados saem iguais a cada restauração.
function prng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Histórico simulado (v1.3). Em vez de sortear um paciente qualquer para cada horário, o seed simula a jornada
// de cada paciente: cadastro → triagem → perfil visto → reserva → pagamento → sessões no mesmo horário fixo por
// algumas semanas → saída. Assim os números do painel de métricas (src/metrics.js) saem coerentes entre si:
// crescimento moderado, sessão média perto de R$ 95, cerca de 8% dos pacientes no Me Salva+ e um funil plausível.
//
// Como cada profissional entra na simulação: público ('adult' ou 'family'), peso na escolha, sessões por semana,
// intervalo em semanas (1 = toda semana, 4 = uma consulta por mês), duração do acompanhamento em semanas
// [mín, máx] e grow (recém-formados com vagas sociais, cuja procura cresce ao longo dos meses).
const SIM = {
  bruno: { seg: 'adult', w: 5, per: 1, every: 1, weeks: [6, 22] },
  fernanda: { seg: 'adult', w: 4, per: 1, every: 1, weeks: [6, 22] },
  caio: { seg: 'adult', w: 3, per: 1, every: 1, weeks: [6, 20] },
  luiz: { seg: 'adult', w: 2, per: 1, every: 1, weeks: [4, 14] },
  ana: { seg: 'adult', w: 1.5, per: 1, every: 4, weeks: [8, 26] },
  pedro: { seg: 'adult', w: 2, per: 1, every: 1, weeks: [8, 26] },
  marina: { seg: 'family', w: 1.5, per: 1, every: 1, weeks: [4, 4] },
  juliana: { seg: 'family', w: 2, per: 2, every: 1, weeks: [10, 26] },
  rafael: { seg: 'family', w: 4, per: 2, every: 1, weeks: [10, 26], grow: true },
  leticia: { seg: 'family', w: 2, per: 1, every: 1, weeks: [8, 22], grow: true },
  thiago: { seg: 'family', w: 1, per: 1, every: 4, weeks: [8, 26] },
  camila: { seg: 'family', w: 1, per: 1, every: 1, weeks: [8, 20] },
};
// Nomes e sobrenomes para os pacientes gerados (combinações fictícias).
const FIRST = ['Ana', 'Beatriz', 'Bruna', 'Carolina', 'Daniela', 'Fernanda', 'Gabriela', 'Isabela', 'Juliana', 'Larissa', 'Letícia', 'Luana', 'Mariana', 'Natália', 'Priscila', 'Raquel', 'Sabrina', 'Tânia', 'Viviane', 'Yasmin',
  'André', 'Bruno', 'Caio', 'Daniel', 'Eduardo', 'Felipe', 'Gabriel', 'Henrique', 'Igor', 'João', 'Leonardo', 'Mateus', 'Nícolas', 'Otávio', 'Paulo', 'Rodrigo', 'Samuel', 'Thiago', 'Vinícius', 'Wagner'];
const LAST = ['Almeida', 'Araújo', 'Barbosa', 'Cardoso', 'Carvalho', 'Castro', 'Correia', 'Dias', 'Farias', 'Freitas', 'Gomes', 'Lopes', 'Machado', 'Martins', 'Melo', 'Monteiro', 'Moreira', 'Nascimento', 'Pereira', 'Pinto',
  'Ribeiro', 'Rocha', 'Santana', 'Silva', 'Soares', 'Souza', 'Teixeira', 'Vieira'];
// Semanas completas de histórico (as mesmas 26 dos gráficos do painel) e dias de agenda futura (os mesmos da busca).
const HIST_WEEKS = 26;
const AHEAD_DAYS = 14;

// Cria todos os dados. reset: true apaga as tabelas antes (botão da administração e `npm run seed`).
export function seedDemo(db, { reset = false, notesKey = null } = {}) {
  const rand = prng(20261022);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const now = nowSP();
  const today = now.slice(0, 10);
  const nowMin = toMinutes(now);
  const pass = hashPassword(DEMO_PASSWORD);
  // Horário de São Paulo → instante UTC no formato das colunas created_at e paid_at (São Paulo = UTC−3).
  const utc = (sp) => fromMinutes(toMinutes(sp) + 180) + ':00Z';
  const later = (sp, min) => fromMinutes(toMinutes(sp) + min);

  db.tx(() => {
    if (reset) {
      for (const t of ['events', 'push_subscriptions', 'notifications', 'reminders', 'sessions', 'audit', 'notes', 'reviews', 'messages', 'payments', 'appointments', 'packages', 'triages', 'availability', 'pros', 'users']) db.run(`DELETE FROM ${t}`);
    }
    // created: instante UTC do cadastro (padrão: agora).
    const user = (role, name, email, { bairro = 'Bela Vista', demo = 0, plan = 'free', created = null } = {}) =>
      db.run(`INSERT INTO users(role, name, email, pass_hash, bairro, is_demo, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%SZ','now')))`,
        role, name, email, pass, bairro, demo ? 1 : 0, plan, created).lastInsertRowid;
    const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
    // Evento do funil (v1.3), gravado direto: no seed não há repetição para descartar.
    const ev = (kind, userId, proId, refId, at) => db.run('INSERT INTO events(kind, user_id, pro_id, ref_id, at) VALUES (?, ?, ?, ?, ?)', kind, userId, proId, refId, at);

    user('admin', 'Equipe Me Salva (administração)', 'admin@demo.mesalva.app', { demo: 1 });
    const mariana = user('patient', 'Mariana Souza', 'mariana@demo.mesalva.app', { demo: 1, bairro: 'Bela Vista' });
    const bairros = ['Pinheiros', 'Mooca', 'Santana', 'Tatuapé', 'Penha', 'Vila Mariana', 'Butantã', 'Lapa', 'Ipiranga', 'Moema'];
    // Os 20 pacientes com nome fixo já estavam em acompanhamento quando o histórico começa, e continuam.
    const histStart = addDays(weekStart(today), -HIST_WEEKS * 7);
    const arrived = (i) => `${addDays(histStart, -10 - 3 * i)}T10:00`;
    const adults = ADULTS.map((n, i) => user('patient', n, `${slug(n)}@exemplo.mesalva.app`, { bairro: bairros[i % bairros.length], created: utc(arrived(i)) }));
    const families = FAMILIES.map((n, i) => user('patient', n, `${slug(n)}@exemplo.mesalva.app`, { bairro: bairros[(i + 3) % bairros.length], created: utc(arrived(i + 12)) }));

    const ids = {};
    for (const p of PROS) {
      const email = p.demo ? `${slug(p.name)}@demo.mesalva.app` : `${slug(p.name.replace(/^Dra?\. /, ''))}@exemplo.mesalva.app`;
      const id = user('pro', p.name, email, { demo: p.demo, bairro: p.bairro });
      ids[p.key] = id;
      db.run(`INSERT INTO pros(user_id, area, title, reg, approach, approach_short, topics, audience, modalities, price, years, bio, color, is_new, supervisor, social_price, social_weekly, auto_fill, status, verified_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
      id, p.area, p.title, p.reg, p.approach, p.short, JSON.stringify(p.topics), JSON.stringify(p.audience), JSON.stringify(p.modal),
      p.price * 100, p.years, p.bio, p.color, p.isNew ? 1 : 0, p.supervisor || null, p.social ? p.social * 100 : null, p.socialWeekly || 0, p.autoFill ? 1 : 0);
      for (const t of p.hours) db.run('INSERT INTO availability(pro_id, weekday, hour) VALUES (?, ?, ?)', id, t.weekday, t.hour);
    }
    // Profissional aguardando verificação, para mostrar o fluxo do administrador.
    const bea = user('pro', 'Beatriz Campos', 'beatriz.campos@demo.mesalva.app', { demo: 1, bairro: 'Lapa' });
    db.run(`INSERT INTO pros(user_id, area, title, reg, approach, approach_short, topics, audience, modalities, price, years, bio, color, is_new, supervisor, status)
            VALUES (?, 'psicologo', 'Psicóloga', 'CRP 06/215530', 'Terapia Cognitivo-Comportamental', 'TCC', '["Ansiedade","Autoestima"]', '["Adultos","Adolescentes"]', '["online"]', 7000, 0, ?, '#3E7CB1', 1, ?, 'pending')`,
    bea, 'Psicóloga recém-formada, atendo adolescentes e adultos com ansiedade e baixa autoestima, com supervisão clínica semanal.', 'Supervisão semanal com Bruno Corrêa (CRP 06/148392)');
    for (const wd of [1, 3, 5]) for (const h of H(18, 19)) db.run('INSERT INTO availability(pro_id, weekday, hour) VALUES (?, ?, ?)', bea, wd, h);

    const proOf = (key) => {
      const p = PROS.find((x) => x.key === key);
      return { price: p.price * 100, social_price: p.social ? p.social * 100 : null };
    };
    // Cria uma sessão com os valores de quote() e o pagamento (aprovado; vencido se a sessão foi cancelada).
    // Grava também os eventos do funil: reserva e pagamento (as sessões de pacote contam uma vez, pelo pacote)
    // e sessão realizada. booked: horário de São Paulo da reserva (padrão: 3 dias antes, às 09:00).
    // pkg: sessão de um pacote recorrente (v1.2), paga pelo PIX do pacote, feito em paidDay.
    const insertAppt = (patient, key, start, status, { modality, social = false, room = null, pkg = null, paidDay = null, plus = false, booked = null } = {}) => {
      const p = PROS.find((x) => x.key === key);
      const q = quote({ pro: proOf(key), social: social && p.social, plus });
      const at = booked || `${paidDay || addDays(start.slice(0, 10), -3)}T09:00`;
      const id = db.run(`INSERT INTO appointments(patient_id, pro_id, package_id, start, modality, social, base_price, amount, fee, pro_amount, status, room, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient, ids[key], pkg, start, modality || p.modal[0], social && p.social ? 1 : 0, q.base, q.amount, q.fee, q.pro_amount, status,
      status === 'confirmed' ? room || 'MeSalva-' + randomId(9) : null, utc(at)).lastInsertRowid;
      if (!pkg) ev('booking_created', patient, ids[key], id, at);
      const method = pkg ? 'pix' : rand() < 0.6 ? 'pix' : 'card';
      db.run(`INSERT INTO payments(user_id, appointment_id, package_id, kind, method, amount, fee, pro_amount, status, card_last4, created_at, paid_at)
              VALUES (?, ?, ?, 'session', ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient, id, pkg, method, q.amount, q.fee, q.pro_amount, status === 'cancelled' ? 'expired' : 'paid', method === 'card' ? '4242' : null, utc(at), status === 'cancelled' ? null : utc(later(at, 5)));
      if (status !== 'cancelled' && !pkg) ev('payment_confirmed', patient, ids[key], id, later(at, 5));
      if (status === 'done') ev('session_done', patient, ids[key], id, later(start, 50));
      return id;
    };
    // O horário ainda está livre para o profissional? Evita violar o índice único de horários.
    const free = (key, start) => !db.get("SELECT 1 FROM appointments WHERE pro_id = ? AND start = ? AND status <> 'cancelled'", ids[key], start);

    // ---------- Cenas fixas da demonstração (horários guardados antes de simular o histórico) ----------
    // Sessão online da Mariana com a Fernanda numa hora cheia entre 1h30 e 2h30 depois de restaurar os dados
    // (entre 08:00 e 23:00 do mesmo dia). Serve para demonstrar a sala de vídeo (aberta o dia todo no modo demo)
    // e o lembrete de 1 h, que chega às duas contas em tempo real: sozinho, só depois de pelo menos 30 minutos,
    // ou na hora, pelo botão "Disparar lembretes agora" da administração.
    let sessionToday = fromMinutes(Math.ceil((nowMin + 90) / 60) * 60);
    if (sessionToday.slice(0, 10) !== today) sessionToday = `${today}T23:00`;
    if (sessionToday < `${today}T08:00`) sessionToday = `${today}T08:00`;
    const julDay = addDays(today, 3);
    // Pacote recorrente da Mariana com o Rafael (v1.2): seg e qua às 08:00, começado na segunda de duas semanas atrás.
    const pkgStart = `${addDays(weekStart(today), -14)}T08:00`;
    const pkgDays = [1, 3];
    // Conflito para o agendamento recorrente: quem montar "ter e qui às 15:00" a partir da próxima terça encontra
    // a quinta da semana seguinte já reservada por outra família.
    const nextTue = addDays(today, ((2 - weekday(today) + 7) % 7) || 7);
    const conflictAt = `${addDays(nextTue, 9)}T15:00`;
    const reserved = new Set([
      `bruno|${addDays(today, -13)}T18:00`, `bruno|${addDays(today, -6)}T18:00`, `fernanda|${sessionToday}`, `juliana|${julDay}T10:00`,
      ...['09:00', '14:00', '17:00'].map((h) => `rafael|${today}T${h}`), `rafael|${conflictAt}`,
      ...occurrences({ start: pkgStart, weekdays: pkgDays, weeks: 8 }).map((s) => `rafael|${s}`),
    ]);
    // Na agenda futura do Rafael ficam livres: as terças e quintas das 14:00 às 16:00 (só o conflito acima ocupa)
    // e as vagas sociais de segunda às 09:00, 10:00 e 14:00, para a triagem TEA/ABA da Mariana indicá-lo com
    // horário social de R$ 45 (é a cena do Reels e do pitch).
    for (let i = 0; i <= AHEAD_DAYS; i++) {
      const d = addDays(today, i);
      if ([2, 4].includes(weekday(d))) for (const h of ['14:00', '15:00', '16:00']) reserved.add(`rafael|${d}T${h}`);
      if (weekday(d) === 1) for (const h of ['09:00', '10:00', '14:00']) reserved.add(`rafael|${d}T${h}`);
    }

    // ---------- Histórico simulado: 26 semanas completas, a semana atual e 14 dias de agenda futura ----------
    const horizon = `${addDays(today, AHEAD_DAYS)}T23:59`;
    const taken = new Set(reserved);
    const byKey = Object.fromEntries(PROS.map((p) => [p.key, p]));
    const fixedSocial = Object.fromEntries(PROS.map((p) => [p.key, socialKeys({ is_new: p.isNew ? 1 : 0, supervisor: p.supervisor, social_price: p.social ? p.social * 100 : null, social_weekly: p.socialWeekly }, p.hours)]));
    // Horários fixos possíveis com um profissional: um por semana, ou dois dias no mesmo horário (ex.: seg e qua, 09:00).
    const options = (key) => {
      const hours = byKey[key].hours;
      if (SIM[key].per === 1) return hours.map((h) => [h]);
      return hours.flatMap((a) => hours.filter((b) => b.hour === a.hour && b.weekday - a.weekday >= 2).map((b) => [a, b]));
    };
    // Datas das sessões a partir de firstDay, nos dias do horário fixo, por `weeks` semanas, até o fim da agenda futura.
    const datesFor = (slots, firstDay, weeks, every) => {
      const out = [];
      const ws = weekStart(firstDay);
      for (let w = 0; w < weeks; w += every) {
        for (const s of slots) {
          const day = addDays(ws, 7 * w + (s.weekday === 0 ? 6 : s.weekday - 1));
          const start = `${day}T${s.hour}`;
          if (day >= firstDay && start <= horizon) out.push(start);
        }
      }
      return out.sort();
    };
    // Escolhe o profissional pelo peso (t vai de 0, no início do histórico, a 1, hoje).
    const weightOf = (key, t) => SIM[key].w * (SIM[key].grow ? 0.25 + 1.6 * t : 1);
    const choosePro = (seg, t, skip = new Set()) => {
      const keys = Object.keys(SIM).filter((k) => SIM[k].seg === seg && !skip.has(k));
      let x = rand() * keys.reduce((s, k) => s + weightOf(k, t), 0);
      for (const k of keys) { x -= weightOf(k, t); if (x <= 0) return k; }
      return keys.at(-1);
    };
    // Encaixa um paciente: um profissional e um horário fixo em que todas as datas estão livres (até 4 tentativas).
    // early: para logo no começo; long: segue em acompanhamento até hoje; forced: profissional definido.
    const place = (seg, t, firstDay, { early = false, long = false, forced = null } = {}) => {
      const tried = new Set();
      for (let k = 0; k < 4; k++) {
        const key = forced || choosePro(seg, t, tried);
        tried.add(key);
        const sim = SIM[key];
        // 1 em 5 para logo no começo (uma ou duas semanas), como acontece na terapia.
        const weeks = long ? HIST_WEEKS + 4 : early ? between(1, 2) * sim.every : between(sim.weeks[0], sim.weeks[1]);
        // Famílias preferem os horários de vaga social (mais baratos), quando o profissional oferece.
        const opts = shuffle(options(key));
        const social = (slots) => slots.some((x) => fixedSocial[key].has(`${x.weekday}|${x.hour}`));
        if (fixedSocial[key].size && rand() < 0.85) opts.sort((a, b) => social(b) - social(a));
        for (const slots of opts) {
          const all = datesFor(slots, firstDay, weeks, sim.every);
          // Um horário guardado para a demonstração encerra o acompanhamento antes dele (o paciente teve alta);
          // um horário de outro paciente descarta a opção. Quem segue até hoje (long) precisa de todas as datas.
          const cut = all.findIndex((d) => reserved.has(`${key}|${d}`));
          if (long && cut !== -1) continue;
          const dates = cut === -1 ? all : all.slice(0, cut);
          if (dates.length >= (early ? 1 : Math.min(3, all.length)) && dates.every((d) => !taken.has(`${key}|${d}`))) {
            dates.forEach((d) => taken.add(`${key}|${d}`));
            return { key, slots, dates, modality: pick(byKey[key].modal) };
          }
        }
        if (forced) break;
      }
      return null;
    };

    const plans = [];
    // Pacientes com nome: Carla, Roberto e Tatiane são famílias atendidas pelo Rafael (têm sessão com ele hoje).
    const named = [...adults.map((id) => [id, 'adult', null]), ...families.map((id, i) => [id, 'family', i < 3 ? 'rafael' : null])];
    named.forEach(([id, seg, forced], i) => {
      const at = arrived(i);
      ev('triage_started', id, null, null, at);
      ev('triage_done', id, null, null, later(at, 4));
      const plan = place(seg, 0, histStart, { long: true, forced }) || place(seg, 0, histStart, { long: true });
      if (!plan) return;
      ev('profile_view', id, ids[plan.key], null, later(at, 7));
      plans.push({ id, ...plan, booked: later(at, 12), paid: true, named: true });
    });
    // Outros 18 pacientes que já estavam em acompanhamento no começo do histórico (cadastro e funil antes dele).
    for (let i = 0; i < 18; i++) {
      const seg = rand() < 0.4 ? 'family' : 'adult';
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const at = `${addDays(histStart, -between(7, 90))}T${String(between(8, 21)).padStart(2, '0')}:15`;
      const id = user('patient', name, `${slug(name)}.0${i}@exemplo.mesalva.app`, { bairro: pick(bairros), created: utc(at) });
      const plan = place(seg, 0, histStart);
      if (!plan) continue;
      ev('triage_started', id, null, null, at);
      ev('triage_done', id, null, null, later(at, 5));
      ev('profile_view', id, ids[plan.key], null, later(at, 8));
      plans.push({ id, ...plan, booked: later(at, 12), paid: true });
    }
    // Novos cadastros por semana: de cerca de 6 no começo a cerca de 11 agora.
    let serial = 0;
    for (let w = 0; w <= HIST_WEEKS; w++) {
      const t = w / HIST_WEEKS;
      const n = Math.max(2, Math.round(6 + 5 * t + (rand() - 0.5) * 4));
      for (let i = 0; i < n; i++) {
        const day = addDays(histStart, 7 * w + between(0, 6));
        const at = `${day}T${String(between(7, 22)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`;
        if (at > now) continue;
        const seg = rand() < 0.4 ? 'family' : 'adult';
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        serial += 1;
        const id = user('patient', name, `${slug(name)}.${serial}@exemplo.mesalva.app`, { bairro: pick(bairros), created: utc(at) });
        // Funil: 3 em 4 começam pela triagem; os outros vão direto à busca.
        const viaTriage = rand() < 0.75;
        let step = at;
        if (viaTriage) {
          ev('triage_started', id, null, null, step);
          if (rand() > 0.85) continue; // desistiu no meio da triagem
          step = later(step, between(3, 7));
          ev('triage_done', id, null, null, step);
        }
        if (rand() > (viaTriage ? 0.85 : 0.9)) continue; // não abriu nenhum perfil
        step = later(step, between(1, 4));
        const books = rand() < (viaTriage ? 0.62 : 0.5);
        const paid = rand() < 0.93;
        const plan = books ? place(seg, t, addDays(day, between(2, 6)), { early: rand() < 0.2 }) : null;
        ev('profile_view', id, ids[plan?.key || choosePro(seg, t)], null, step);
        if (!plan) continue;
        if (!paid) {
          // Reservou e não pagou a tempo: o horário volta a ficar livre.
          plan.dates.forEach((d) => taken.delete(`${plan.key}|${d}`));
          plan.dates = plan.dates.slice(0, 1);
        }
        plans.push({ id, ...plan, booked: later(step, between(3, 9)), paid, t });
      }
    }

    // Me Salva+: cerca de 8,5% dos pacientes com sessão nos últimos 30 dias, escolhidos entre os que continuam em
    // acompanhamento (com nome fixo, nenhum: os testes contam com o plano gratuito deles).
    const monthAgo = `${addDays(today, -29)}T00:00`;
    const active30 = plans.filter((p) => p.paid && p.dates.some((d) => d >= monthAgo && d <= now)).length;
    const continuing = shuffle(plans.filter((p) => p.paid && !p.named && p.dates.at(-1) >= today && p.dates[0] < today));
    for (const p of continuing.slice(0, Math.round(active30 * 0.085))) {
      const since = [p.dates[0].slice(0, 10), addDays(today, -between(14, 120))].sort().at(-1);
      p.plusFrom = since;
      db.run("UPDATE users SET plan = 'plus', plan_since = ? WHERE id = ?", utc(`${since}T10:00`), p.id);
      for (let d = since; d <= today; d = addDays(d, 30)) {
        db.run(`INSERT INTO payments(user_id, kind, method, amount, fee, status, card_last4, created_at, paid_at) VALUES (?, 'plus', 'card', 1990, 1990, 'paid', '4242', ?, ?)`,
          p.id, utc(`${d}T10:00`), utc(`${d}T10:01`));
      }
    }

    // Pacotes recorrentes: 7 em cada 10 famílias com duas sessões por semana passaram a pagar 8 semanas de uma vez
    // nas últimas semanas (v1.2). As sessões continuam sendo linhas de appointments, ligadas ao pacote.
    const pkgWindow = addDays(today, -49);
    for (const p of plans) {
      if (!p.paid || SIM[p.key].per < 2 || p.named || rand() > 0.7) continue;
      const first = p.dates.find((d) => d.slice(0, 10) >= pkgWindow);
      if (!first) continue;
      const end = `${addDays(weekStart(first.slice(0, 10)), 56)}T00:00`;
      const inPkg = p.dates.filter((d) => d >= first && d < end);
      if (inPkg.length < 6) continue;
      const paidDay = addDays(first.slice(0, 10), -3);
      const weekdays = [...new Set(p.slots.map((s) => s.weekday))].sort();
      p.pkg = { from: first, to: end, paidDay, id: db.run(`INSERT INTO packages(patient_id, pro_id, weekdays, time, weeks, modality, amount, status, paid_at, created_at)
                VALUES (?, ?, ?, ?, 8, ?, 0, 'paid', ?, ?)`, p.id, ids[p.key], JSON.stringify(weekdays), p.slots[0].hour, p.modality, utc(`${paidDay}T09:05`), utc(`${paidDay}T09:00`)).lastInsertRowid };
      ev('booking_created', p.id, ids[p.key], p.pkg.id, `${paidDay}T09:00`);
      ev('payment_confirmed', p.id, ids[p.key], p.pkg.id, `${paidDay}T09:05`);
    }

    // Grava as sessões: as que já terminaram ficam realizadas (4,5% de faltas), as próximas, confirmadas.
    // Em 5% das semanas o paciente não marcou (viagem, doença). Carla, Roberto e Tatiane têm a sessão de hoje à parte.
    const todayFixed = new Set(families.slice(0, 3));
    for (const p of plans) {
      p.dates.forEach((start, i) => {
        if (i > 0 && rand() < 0.05) return;
        if (todayFixed.has(p.id) && start.startsWith(today)) return;
        const status = !p.paid ? 'cancelled' : toMinutes(start) + 50 <= nowMin ? (rand() < 0.045 ? 'no_show' : 'done') : 'confirmed';
        const inPkg = p.pkg && start >= p.pkg.from && start < p.pkg.to;
        insertAppt(p.id, p.key, start, status, {
          modality: p.modality, social: fixedSocial[p.key].has(`${weekday(start.slice(0, 10))}|${start.slice(11, 16)}`),
          plus: Boolean(p.plusFrom && start.slice(0, 10) >= p.plusFrom), pkg: inPkg ? p.pkg.id : null, paidDay: inPkg ? p.pkg.paidDay : null,
          booked: i === 0 ? p.booked : null,
        });
      });
    }
    for (const p of plans) if (p.pkg) db.run('UPDATE packages SET amount = (SELECT COALESCE(SUM(amount), 0) FROM appointments WHERE package_id = ?) WHERE id = ?', p.pkg.id, p.pkg.id);

    // Avaliações: as comentadas (de cada perfil) nas sessões realizadas mais recentes; as demais só com nota,
    // numa proporção de notas 5, 4 (e algumas 3) que chega perto da média definida para o perfil.
    for (const p of PROS) {
      const done = db.all("SELECT id, start FROM appointments WHERE pro_id = ? AND status = 'done' ORDER BY start DESC", ids[p.key]);
      const reviewAt = (appt, label, rating, text, tags) => {
        const a = db.get('SELECT * FROM appointments WHERE id = ?', appt.id);
        db.run('INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, tags, text, author_label, modality, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          a.id, a.patient_id, a.pro_id, rating, JSON.stringify(tags), text, label, a.modality, `${appt.start.slice(0, 10)}T22:00:00Z`);
        ev('review_sent', a.patient_id, a.pro_id, a.id, `${appt.start.slice(0, 10)}T19:00`);
      };
      p.reviews.forEach(([label, rating, text, tags], i) => done[i * 2] && reviewAt(done[i * 2], label, rating, text, tags));
      // As só com nota ficam espalhadas pelo histórico, com as notas intercaladas.
      const rest = done.slice(p.reviews.length * 2 + 1);
      const extra = Math.min(p.n, Math.floor(rest.length * 0.6));
      const threes = p.rating < 4.8 ? Math.floor(extra / 25) : 0;
      const p5 = Math.max(0.3, Math.min(0.95, p.rating - 4 + threes / Math.max(1, extra)));
      const gap = extra ? rest.length / extra : 1;
      for (let i = 0; i < extra; i++) {
        const three = threes && i % Math.floor(extra / threes) === Math.floor(extra / threes / 2) && i / Math.floor(extra / threes) < threes;
        reviewAt(rest[Math.floor(i * gap)], 'Anônimo', three ? 3 : Math.floor((i + 1) * p5) > Math.floor(i * p5) ? 5 : 4, '', []);
      }
    }

    // Rafael: três atendimentos hoje para aparecerem no painel.
    const [carla, roberto, tatiane] = families;
    for (const [pt, h, social, modality] of [[carla, '09:00', true, 'presencial'], [tatiane, '14:00', false, 'online'], [roberto, '17:00', true, 'presencial']]) {
      if (free('rafael', `${today}T${h}`)) insertAppt(pt, 'rafael', `${today}T${h}`, 'confirmed', { social, modality });
    }
    if (notesKey) {
      for (const text of ['Sessão 12: Theo pediu água usando a frase completa duas vezes. Manter reforço imediato e registrar no quadro da família.', 'Orientação à mãe: rotina visual da manhã funcionando; ajustar tempo de transição para o banho.']) {
        const e = encrypt(notesKey, text);
        db.run('INSERT INTO notes(pro_id, patient_id, iv, tag, data) VALUES (?, ?, ?, ?, ?)', ids.rafael, carla, e.iv, e.tag, e.data);
      }
    }
    db.run('INSERT INTO messages(patient_id, pro_id, sender_id, kind, body, read_by_patient, read_by_pro, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?)',
      carla, ids.rafael, carla, 'text', 'Bom dia, Rafael! O Theo dormiu mal hoje, pode ser que chegue mais agitado.', `${today}T10:40:00Z`);

    // Mariana (paciente de demonstração): sessões com o Bruno, a de hoje com a Fernanda, a Juliana daqui a 3 dias
    // e o pacote com o Rafael (os horários foram guardados antes do histórico; ver "Cenas fixas").
    // Por segurança, libera um horário que o histórico tenha ocupado (com os horários guardados, não deveria acontecer).
    const clearSlot = (key, start) => {
      const old = db.all("SELECT id FROM appointments WHERE pro_id = ? AND start = ?", ids[key], start);
      for (const o of old) {
        db.run('DELETE FROM reviews WHERE appointment_id = ?', o.id); db.run('DELETE FROM payments WHERE appointment_id = ?', o.id);
        db.run("DELETE FROM events WHERE ref_id = ? AND pro_id = ? AND kind IN ('booking_created','payment_confirmed','session_done','review_sent')", o.id, ids[key]);
        db.run('DELETE FROM appointments WHERE id = ?', o.id);
      }
    };
    clearSlot('bruno', `${addDays(today, -13)}T18:00`);
    clearSlot('bruno', `${addDays(today, -6)}T18:00`);
    const p1 = insertAppt(mariana, 'bruno', `${addDays(today, -13)}T18:00`, 'done', { modality: 'online' });
    insertAppt(mariana, 'bruno', `${addDays(today, -6)}T18:00`, 'done', { modality: 'online' });
    db.run('INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, tags, text, author_label, modality, created_at) VALUES (?, ?, ?, 5, ?, ?, ?, ?, ?)',
      p1, mariana, ids.bruno, '["Acolhimento","Explicações claras"]', 'Comecei por causa do estresse no trabalho e já sinto diferença no sono.', 'Mariana S.', 'online', `${addDays(today, -13)}T22:00:00Z`);
    if (free('fernanda', sessionToday)) insertAppt(mariana, 'fernanda', sessionToday, 'confirmed', { modality: 'online' });
    if (free('juliana', `${julDay}T10:00`)) insertAppt(mariana, 'juliana', `${julDay}T10:00`, 'confirmed', { modality: 'presencial' });

    // Pacote recorrente da Mariana com o Rafael (v1.2): seg e qua às 08:00, presencial (em casa), por 8 semanas,
    // começado na segunda-feira de duas semanas atrás. As sessões que já passaram estão realizadas; as próximas,
    // confirmadas. A segunda às 08:00 é vaga social do Rafael (R$ 45); a quarta, valor normal (R$ 90).
    const rafael = PROS.find((x) => x.key === 'rafael');
    const rafaelSocial = socialKeys({ is_new: 1, supervisor: rafael.supervisor, social_price: rafael.social * 100, social_weekly: rafael.socialWeekly }, rafael.hours);
    const marianaBusy = () => db.all("SELECT start FROM appointments WHERE patient_id = ? AND status IN ('confirmed','pending_payment','done')", mariana).map((r) => r.start);
    const pkgDates = occurrences({ start: pkgStart, weekdays: pkgDays, weeks: 8 }).filter((st) => !marianaBusy().some((b) => overlaps(b, st)));
    const pkgPaid = addDays(pkgStart.slice(0, 10), -3);
    const pkg = db.run(`INSERT INTO packages(patient_id, pro_id, weekdays, time, weeks, modality, amount, status, paid_at, created_at)
                        VALUES (?, ?, ?, '08:00', 8, 'presencial', 0, 'paid', ?, ?)`, mariana, ids.rafael, JSON.stringify(pkgDays), `${pkgPaid}T12:05:00Z`, `${pkgPaid}T12:00:00Z`).lastInsertRowid;
    for (const st of pkgDates) {
      if (st < now) clearSlot('rafael', st); else if (!free('rafael', st)) continue;
      const social = rafaelSocial.has(`${weekday(st.slice(0, 10))}|08:00`);
      insertAppt(mariana, 'rafael', st, st < now ? 'done' : 'confirmed', { modality: 'presencial', social, pkg, paidDay: pkgPaid });
    }
    db.run("UPDATE packages SET amount = (SELECT COALESCE(SUM(amount), 0) FROM appointments WHERE package_id = ?) WHERE id = ?", pkg, pkg);
    ev('booking_created', mariana, ids.rafael, pkg, `${pkgPaid}T09:00`);
    ev('payment_confirmed', mariana, ids.rafael, pkg, `${pkgPaid}T09:05`);
    // A Mariana chegou pela triagem TEA/ABA, três semanas antes do pacote.
    ev('triage_started', mariana, null, null, `${addDays(pkgPaid, -21)}T21:10`);
    ev('triage_done', mariana, null, null, `${addDays(pkgPaid, -21)}T21:14`);

    // Conflito do agendamento recorrente (ver "Cenas fixas"): a quinta às 15:00, já reservada por outra família.
    if (free('rafael', conflictAt)) insertAppt(families[4], 'rafael', conflictAt, 'confirmed', { modality: 'presencial' });

    // Mensagem de chat criada minutesAgo minutos atrás.
    const msg = (patient, key, sender, kind, body, minutesAgo, read = 1) => {
      const at = new Date(Date.now() - minutesAgo * 60000).toISOString().slice(0, 19) + 'Z';
      db.run('INSERT INTO messages(patient_id, pro_id, sender_id, kind, body, read_by_patient, read_by_pro, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        patient, ids[key], sender, kind, body, sender === patient ? 1 : read, sender === ids[key] ? 1 : 1, at);
    };
    const [dd, mm] = [sessionToday.slice(8, 10), sessionToday.slice(5, 7)];
    msg(mariana, 'juliana', null, 'system', `Sessão confirmada para ${julDay.slice(8, 10)}/${julDay.slice(5, 7)} às 10:00 (presencial).`, 60 * 30);
    msg(mariana, 'juliana', ids.juliana, 'text', 'Olá! Para a avaliação inicial do seu filho, traga, se puder, relatórios da escola e da pediatra.', 60 * 26);
    msg(mariana, 'bruno', ids.bruno, 'text', 'Como foram os exercícios de respiração esta semana?', 60 * 20);
    msg(mariana, 'bruno', mariana, 'text', 'Consegui fazer 4 dias! Ajudou antes da reunião.', 60 * 19);
    msg(mariana, 'bruno', ids.bruno, 'text', 'Que ótimo! Na próxima sessão vamos ver o registro de pensamentos.', 60 * 18);
    msg(mariana, 'fernanda', null, 'system', `Sessão confirmada para ${dd}/${mm} às ${sessionToday.slice(11)} (online, pela sala segura da plataforma).`, 60 * 24);
    // Lembrete de 24 h dessa sessão, como se tivesse sido enviado ontem (24 horas antes do início).
    const leftMin = toMinutes(sessionToday) - toMinutes(now);
    const remindedAgo = 24 * 60 - leftMin;
    const remindedAt = fromMinutes(toMinutes(now) - remindedAgo);
    const fernandaWhen = whenText(sessionToday, remindedAt);
    if (remindedAgo > 90 && remindedAgo < 24 * 60) {
      msg(mariana, 'fernanda', null, 'system', `Lembrete: a sessão é ${fernandaWhen}, online. A sala abre 15 minutos antes do horário.`, remindedAgo);
    }
    // Conversa com o Rafael sobre o pacote recorrente.
    const pkgView = db.get("SELECT MIN(start) first, MAX(start) last, COUNT(*) n FROM appointments WHERE package_id = ?", pkg);
    const pkgAgo = Math.round((Date.now() - Date.parse(`${pkgPaid}T12:05:00Z`)) / 60000);
    msg(mariana, 'rafael', null, 'system', `Pacote confirmado: ${pkgView.n} sessões (${weekdaysText(pkgDays)}, 08:00), de ${pkgView.first.slice(8, 10)}/${pkgView.first.slice(5, 7)} a ${pkgView.last.slice(8, 10)}/${pkgView.last.slice(5, 7)}, presencial.`, pkgAgo);
    msg(mariana, 'rafael', ids.rafael, 'text', 'Oi, Mariana! Combinado: segundas e quartas às 8h, aí na sua casa. Na primeira sessão eu levo o material da rotina visual da manhã.', pkgAgo - 40);
    msg(mariana, 'rafael', mariana, 'text', 'Perfeito, Rafael. Obrigada!', pkgAgo - 55);
    msg(mariana, 'fernanda', mariana, 'text', 'Oi, Fernanda! Essa semana foi difícil, queria falar sobre o aniversário da minha mãe.', 90);
    msg(mariana, 'fernanda', ids.fernanda, 'text', 'Claro, Mariana. Separei um tempo para isso na nossa sessão de hoje. Até mais tarde!', 75, 0);

    // Central de notificações (v1.1): a Mariana e a Fernanda já começam com duas não lidas cada uma,
    // e o Rafael com o aviso da mensagem da Carla. read = true cria a notificação já lida.
    const isoAgo = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString().slice(0, 19) + 'Z';
    const note = (userId, kind, title, body, minutesAgo, { screen = null, param = null, ref = null, read = false } = {}) => {
      const at = isoAgo(minutesAgo);
      db.run('INSERT INTO notifications(user_id, kind, title, body, screen, param, ref, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        userId, kind, title, body, screen, param, ref, read ? at : null, at);
    };
    const ago30h = fromMinutes(toMinutes(now) - 60 * 30);
    const ago24h = fromMinutes(toMinutes(now) - 60 * 24);
    note(mariana, 'confirmed', 'Pacote confirmado', `Suas ${pkgView.n} sessões com Rafael Nunes estão confirmadas (seg e qua, 08:00).`, pkgAgo, { screen: 'pacote', param: String(pkg), read: true });
    note(ids.rafael, 'confirmed', 'Novo pacote confirmado', `Mariana Souza marcou ${pkgView.n} sessões (seg e qua, 08:00, presencial).`, pkgAgo, { screen: 'proagenda', read: true });
    note(mariana, 'confirmed', 'Sessão confirmada', `Sua sessão com Juliana Prado é ${whenText(`${julDay}T10:00`, ago30h)} (presencial).`, 60 * 30, { screen: 'agenda', read: true });
    note(mariana, 'confirmed', 'Sessão confirmada', `Sua sessão com Fernanda Alves é ${whenText(sessionToday, ago24h)} (online).`, 60 * 24, { screen: 'agenda', read: true });
    note(ids.fernanda, 'confirmed', 'Nova sessão confirmada', `Mariana Souza marcou ${whenText(sessionToday, ago24h)} (online).`, 60 * 24, { screen: 'proagenda', read: true });
    if (remindedAgo > 90 && remindedAgo < 24 * 60) {
      note(mariana, 'reminder', 'Lembrete de sessão', `Sua sessão com Fernanda Alves é ${fernandaWhen} (online).`, remindedAgo, { screen: 'agenda' });
      note(ids.fernanda, 'reminder', 'Lembrete de sessão', `Sessão com Mariana Souza ${fernandaWhen} (online).`, remindedAgo, { screen: 'proagenda' });
    }
    note(mariana, 'message', 'Nova mensagem', 'Fernanda Alves enviou uma mensagem.', 75, { screen: 'chat', param: String(ids.fernanda), ref: `chat:${ids.fernanda}` });
    const lastReview = db.get('SELECT author_label, rating, created_at FROM reviews WHERE pro_id = ? ORDER BY created_at DESC LIMIT 1', ids.fernanda);
    if (lastReview) {
      const minutes = Math.max(1, Math.round((Date.now() - Date.parse(lastReview.created_at)) / 60000));
      note(ids.fernanda, 'review', 'Nova avaliação', `${lastReview.author_label} avaliou a sessão com ${lastReview.rating} ${lastReview.rating === 1 ? 'estrela' : 'estrelas'}.`, minutes, { screen: 'perfil', param: String(ids.fernanda) });
    }
    const carlaAgo = Math.max(1, Math.round((Date.now() - Date.parse(`${today}T10:40:00Z`)) / 60000));
    note(ids.rafael, 'message', 'Nova mensagem', 'Carla Mendes enviou uma mensagem.', carlaAgo, { screen: 'chat', param: String(carla), ref: `chat:${carla}` });

    // Lembretes: sessões que já estão dentro da janela de 24 h (ou de 1 h) ficam com o lembrete marcado como
    // enviado, para a demonstração não começar com dezenas de avisos para pacientes fictícios.
    const until = fromMinutes(toMinutes(now) + 24 * 60);
    for (const a of db.all("SELECT id, start FROM appointments WHERE status = 'confirmed' AND start > ? AND start <= ?", now, until)) {
      const left = toMinutes(a.start) - toMinutes(now);
      db.run('INSERT OR IGNORE INTO reminders(appointment_id, kind) VALUES (?, ?)', a.id, left <= 60 ? '1h' : '24h');
    }
  });
}

// Execução direta: `npm run seed`
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { config } = await import('./config.js');
  const { openDb } = await import('./db.js');
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(join(config.dataDir, 'mesalva.db'));
  seedDemo(db, { reset: true, notesKey: loadNotesKey(config) });
  const n = db.get('SELECT COUNT(*) n FROM appointments').n;
  console.log(`Dados de demonstração criados (${n} sessões). Senha de todas as contas: ${DEMO_PASSWORD}`);
  db.close();
}

