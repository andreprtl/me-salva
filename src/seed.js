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

// Cria todos os dados. reset: true apaga as tabelas antes (botão da administração e `npm run seed`).
export function seedDemo(db, { reset = false, notesKey = null } = {}) {
  const rand = prng(20261022);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const now = nowSP();
  const today = now.slice(0, 10);
  const pass = hashPassword(DEMO_PASSWORD);

  db.tx(() => {
    if (reset) {
      for (const t of ['push_subscriptions', 'notifications', 'reminders', 'sessions', 'audit', 'notes', 'reviews', 'messages', 'payments', 'appointments', 'packages', 'triages', 'availability', 'pros', 'users']) db.run(`DELETE FROM ${t}`);
    }
    const user = (role, name, email, { bairro = 'Bela Vista', demo = 0, plan = 'free' } = {}) =>
      db.run('INSERT INTO users(role, name, email, pass_hash, bairro, is_demo, plan) VALUES (?, ?, ?, ?, ?, ?, ?)', role, name, email, pass, bairro, demo ? 1 : 0, plan).lastInsertRowid;
    const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

    user('admin', 'Equipe Me Salva (administração)', 'admin@demo.mesalva.app', { demo: 1 });
    const mariana = user('patient', 'Mariana Souza', 'mariana@demo.mesalva.app', { demo: 1, bairro: 'Bela Vista' });
    const bairros = ['Pinheiros', 'Mooca', 'Santana', 'Tatuapé', 'Penha', 'Vila Mariana', 'Butantã', 'Lapa', 'Ipiranga', 'Moema'];
    const adults = ADULTS.map((n, i) => user('patient', n, `${slug(n)}@exemplo.mesalva.app`, { bairro: bairros[i % bairros.length] }));
    const families = FAMILIES.map((n, i) => user('patient', n, `${slug(n)}@exemplo.mesalva.app`, { bairro: bairros[(i + 3) % bairros.length] }));

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
    // Cria uma sessão já com o pagamento aprovado e os valores calculados por quote().
    // pkg: sessão de um pacote recorrente (v1.2), paga pelo PIX do pacote, criado em paidDay.
    const insertAppt = (patient, key, start, status, { modality, social = false, room = null, pkg = null, paidDay = null } = {}) => {
      const p = PROS.find((x) => x.key === key);
      const q = quote({ pro: proOf(key), social: social && p.social, plus: false });
      const day = paidDay || addDays(start.slice(0, 10), -3);
      const id = db.run(`INSERT INTO appointments(patient_id, pro_id, package_id, start, modality, social, base_price, amount, fee, pro_amount, status, room, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient, ids[key], pkg, start, modality || p.modal[0], social && p.social ? 1 : 0, q.base, q.amount, q.fee, q.pro_amount, status,
      status === 'confirmed' ? room || 'MeSalva-' + randomId(9) : null, `${day}T12:00:00Z`).lastInsertRowid;
      if (status !== 'cancelled') {
        db.run(`INSERT INTO payments(user_id, appointment_id, package_id, kind, method, amount, fee, pro_amount, status, card_last4, created_at, paid_at)
                VALUES (?, ?, ?, 'session', ?, ?, ?, ?, 'paid', ?, ?, ?)`,
        patient, id, pkg, pkg ? 'pix' : rand() < 0.6 ? 'pix' : 'card', q.amount, q.fee, q.pro_amount, pkg ? null : '4242', `${day}T12:00:00Z`, `${day}T12:05:00Z`);
      }
      return id;
    };

    // Histórico dos últimos 6 meses (sessões realizadas e algumas faltas) para alimentar painéis e notas.
    for (const p of PROS) {
      const pool = p.audience.includes('Adultos') ? adults : families;
      const done = [];
      for (let back = 182; back >= 1; back--) {
        const day = addDays(today, -back);
        const wd = weekday(day);
        // Ocupação crescente do Rafael (recém-formado) graças às vagas sociais: ~22% → ~68%.
        const occ = p.key === 'rafael' ? 0.22 + (182 - back) / 182 * 0.46 : 0.3;
        for (const t of p.hours.filter((h) => h.weekday === wd)) {
          if (rand() > occ) continue;
          const status = rand() < 0.05 ? 'no_show' : 'done';
          const social = Boolean(p.social) && rand() < 0.4;
          const id = insertAppt(pick(pool), p.key, `${day}T${t.hour}`, status, { social, modality: pick(p.modal) });
          if (status === 'done') done.push({ id, start: `${day}T${t.hour}` });
        }
      }
      done.sort((a, b) => b.start.localeCompare(a.start));
      // Avaliações com comentário nas sessões mais recentes; as demais só com nota.
      const reviewAt = (appt, label, rating, text, tags) => {
        const a = db.get('SELECT * FROM appointments WHERE id = ?', appt.id);
        db.run('INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, tags, text, author_label, modality, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          a.id, a.patient_id, a.pro_id, rating, JSON.stringify(tags), text, label, a.modality, `${appt.start.slice(0, 10)}T22:00:00Z`);
      };
      p.reviews.forEach(([label, rating, text, tags], i) => done[i * 2] && reviewAt(done[i * 2], label, rating, text, tags));
      const extra = Math.min(p.n, done.length - p.reviews.length * 2);
      const p5 = Math.max(0.3, Math.min(0.95, p.rating - 4));
      for (let i = 0; i < extra; i++) {
        const appt = done[p.reviews.length * 2 + 1 + i];
        if (!appt) break;
        // Proporção fixa de notas 5 e 4 para chegar perto da média definida para o perfil.
        reviewAt(appt, 'Anônimo', i < Math.round(extra * p5) ? 5 : 4, '', []);
      }
    }

    // Rafael: três atendimentos hoje para aparecerem no painel.
    // O horário ainda está livre para o profissional? Evita violar o índice único de horários.
    const free = (key, start) => !db.get("SELECT 1 FROM appointments WHERE pro_id = ? AND start = ? AND status <> 'cancelled'", ids[key], start);
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

    // Mariana (paciente de demonstração).
    // Sessão online da Mariana com a Fernanda numa hora cheia entre 1h30 e 2h30 depois de restaurar os dados
    // (entre 08:00 e 23:00 do mesmo dia). Serve para demonstrar a sala de vídeo (aberta o dia todo no modo demo)
    // e o lembrete de 1 h, que chega às duas contas em tempo real: sozinho, só depois de pelo menos 30 minutos,
    // ou na hora, pelo botão "Disparar lembretes agora" da administração.
    let sessionToday = fromMinutes(Math.ceil((toMinutes(now) + 90) / 60) * 60);
    if (sessionToday.slice(0, 10) !== today) sessionToday = `${today}T23:00`;
    if (sessionToday < `${today}T08:00`) sessionToday = `${today}T08:00`;
    // Libera horários que o histórico aleatório possa ter ocupado antes de criar as sessões fixas da Mariana.
    const clearSlot = (key, start) => {
      const old = db.all("SELECT id FROM appointments WHERE pro_id = ? AND start = ?", ids[key], start);
      for (const o of old) { db.run('DELETE FROM reviews WHERE appointment_id = ?', o.id); db.run('DELETE FROM payments WHERE appointment_id = ?', o.id); db.run('DELETE FROM appointments WHERE id = ?', o.id); }
    };
    clearSlot('bruno', `${addDays(today, -13)}T18:00`);
    clearSlot('bruno', `${addDays(today, -6)}T18:00`);
    const p1 = insertAppt(mariana, 'bruno', `${addDays(today, -13)}T18:00`, 'done', { modality: 'online' });
    insertAppt(mariana, 'bruno', `${addDays(today, -6)}T18:00`, 'done', { modality: 'online' });
    db.run('INSERT INTO reviews(appointment_id, patient_id, pro_id, rating, tags, text, author_label, modality, created_at) VALUES (?, ?, ?, 5, ?, ?, ?, ?, ?)',
      p1, mariana, ids.bruno, '["Acolhimento","Explicações claras"]', 'Comecei por causa do estresse no trabalho e já sinto diferença no sono.', 'Mariana S.', 'online', `${addDays(today, -13)}T22:00:00Z`);
    if (free('fernanda', sessionToday)) insertAppt(mariana, 'fernanda', sessionToday, 'confirmed', { modality: 'online' });
    const julDay = addDays(today, 3);
    if (free('juliana', `${julDay}T10:00`)) insertAppt(mariana, 'juliana', `${julDay}T10:00`, 'confirmed', { modality: 'presencial' });

    // Pacote recorrente da Mariana com o Rafael (v1.2): seg e qua às 08:00, presencial (em casa), por 8 semanas,
    // começado na segunda-feira de duas semanas atrás. As sessões que já passaram estão realizadas; as próximas,
    // confirmadas. A segunda às 08:00 é vaga social do Rafael (R$ 45); a quarta, valor normal (R$ 90).
    const rafael = PROS.find((x) => x.key === 'rafael');
    const rafaelSocial = socialKeys({ is_new: 1, supervisor: rafael.supervisor, social_price: rafael.social * 100, social_weekly: rafael.socialWeekly }, rafael.hours);
    const pkgStart = `${addDays(weekStart(today), -14)}T08:00`;
    const pkgDays = [1, 3];
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

    // Para demonstrar o agendamento recorrente com conflito: as terças e quintas do Rafael das 14:00 às 16:00 ficam
    // livres nas próximas semanas, menos a quinta da semana seguinte à próxima terça, às 15:00, já reservada por
    // outra família. Quem montar "ter e qui às 15:00" a partir da próxima terça vê esse conflito e a sugestão
    // de 14:00 no mesmo dia.
    const nextTue = addDays(today, ((2 - weekday(today) + 7) % 7) || 7);
    const demoKeep = (key, day, hour) => key === 'rafael' && [2, 4].includes(weekday(day)) && ['14:00', '15:00', '16:00'].includes(hour);
    const conflictAt = `${addDays(nextTue, 9)}T15:00`;
    if (free('rafael', conflictAt)) insertAppt(families[4], 'rafael', conflictAt, 'confirmed', { modality: 'presencial' });

    // Agenda futura: alguns horários já reservados por outras famílias e pacientes.
    for (const p of PROS) {
      const pool = p.audience.includes('Adultos') ? adults : families;
      for (let i = 0; i < 14; i++) {
        const day = addDays(today, i);
        for (const t of p.hours.filter((h) => h.weekday === weekday(day))) {
          if (`${day}T${t.hour}` <= now || !free(p.key, `${day}T${t.hour}`) || demoKeep(p.key, day, t.hour)) continue;
          if (rand() < (p.key === 'rafael' ? 0.35 : 0.25)) insertAppt(pick(pool), p.key, `${day}T${t.hour}`, 'confirmed', { modality: pick(p.modal), social: Boolean(p.social) && rand() < 0.5 });
        }
      }
    }


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

