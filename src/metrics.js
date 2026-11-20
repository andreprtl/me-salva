// Painel de métricas do negócio (v1.3), visto pela administração. Só lê o banco: devolve os números prontos
// para a tela (GET /api/admin/metrics) e para a planilha (GET /api/admin/metrics/export, em CSV).
// Valores em centavos; horários de São Paulo ('AAAA-MM-DDTHH:MM'), como no resto do projeto.
//
// Definições (as mesmas da tela, do README e de docs/DOCUMENTACAO.md):
//   período                os últimos N dias, contando hoje (30, 90 ou 180), até agora
//   sessões realizadas     sessões com status 'done' que começaram no período
//   valor transacionado    o que os pacientes pagaram por essas sessões + as mensalidades do Me Salva+ pagas no período
//   receita da plataforma  a parte da plataforma nessas sessões (12% do valor de tabela, menos o desconto do
//                          Me Salva+, que sai dela) + as mensalidades do Me Salva+
//   ticket médio           valor pago pelas sessões realizadas ÷ número de sessões realizadas
//   pacientes ativos       pacientes com pelo menos uma sessão realizada no período (o mesmo vale para profissionais)
//   funil                  coorte: quem começou a triagem no período e quantos deles deram cada passo seguinte, na ordem
//   retenção               entre os pacientes ativos: quantos fizeram 2 ou mais sessões e quantos têm pacote recorrente
//   vagas sociais          ocupação dos horários fixos de vaga social que já passaram e sessões a preço social
//   qualidade              avaliações enviadas no período e faltas ÷ (sessões realizadas + faltas)
import { nowSP, addDays, weekday, weekStart, toMinutes, fromMinutes } from './time.js';
import { socialKeys, offersSocial } from './slots.js';

// Filtros de período da tela, em dias.
export const PERIODS = { 30: '30 dias', 90: '90 dias', 180: '6 meses' };
// Semanas completas nos gráficos (de segunda a domingo; a semana atual entra quando termina).
export const WEEKS = 26;

// Passos do funil, na ordem. O rótulo é o que aparece na tela e no CSV.
export const FUNNEL = [
  ['triage_started', 'Começaram a triagem'],
  ['triage_done', 'Concluíram a triagem'],
  ['profile_view', 'Abriram o perfil de um profissional'],
  ['booking_created', 'Reservaram um horário'],
  ['payment_confirmed', 'Pagaram'],
  ['session_done', 'Fizeram a primeira sessão'],
];

// Instante gravado em UTC ('…Z', como created_at e paid_at) → horário de São Paulo.
const spOf = (iso) => nowSP(new Date(iso));
// Porcentagem inteira (0 quando o divisor é zero).
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const sum = (list, key) => list.reduce((t, x) => t + (x[key] || 0), 0);

/** Período dos últimos `days` dias até `now`, como intervalo [from, to), e o período anterior de mesmo tamanho. */
export function periodRange(now, days) {
  const today = now.slice(0, 10);
  const from = `${addDays(today, -(days - 1))}T00:00`;
  const to = fromMinutes(toMinutes(now) + 1); // inclui o minuto atual
  return { days, from, to, prevFrom: `${addDays(today, -(2 * days - 1))}T00:00`, prevTo: from };
}

// Sessões realizadas e faltas com início em [a, b), com o valor de tabela do profissional (para a economia das vagas sociais).
const sessionsIn = (db, a, b) => db.all(
  `SELECT a.id, a.patient_id, a.pro_id, a.package_id, a.start, a.status, a.social, a.base_price, a.amount, a.fee, p.price AS pro_price
   FROM appointments a JOIN pros p ON p.user_id = a.pro_id
   WHERE a.status IN ('done','no_show') AND a.start >= ? AND a.start < ? ORDER BY a.start`, a, b);

// Mensalidades do Me Salva+ pagas em [a, b) (paid_at é UTC; a comparação é no horário de São Paulo).
const plusIn = (db, a, b) => db.all("SELECT amount, fee, paid_at FROM payments WHERE kind = 'plus' AND status = 'paid' AND paid_at IS NOT NULL")
  .filter((p) => { const t = spOf(p.paid_at); return t >= a && t < b; });

/** Indicadores principais de [a, b). */
export function kpis(db, a, b) {
  const rows = sessionsIn(db, a, b);
  const done = rows.filter((r) => r.status === 'done');
  const plus = plusIn(db, a, b);
  const gmvSessions = sum(done, 'amount');
  const social = done.filter((r) => r.social);
  return {
    gmv: gmvSessions + sum(plus, 'amount'),
    gmv_sessions: gmvSessions,
    revenue: sum(done, 'fee') + sum(plus, 'fee'),
    revenue_sessions: sum(done, 'fee'),
    revenue_plus: sum(plus, 'fee'),
    sessions: done.length,
    ticket: done.length ? Math.round(gmvSessions / done.length) : 0,
    patients_active: new Set(done.map((r) => r.patient_id).filter(Boolean)).size,
    pros_active: new Set(done.map((r) => r.pro_id)).size,
    social_sessions: social.length,
    no_show: rows.length - done.length,
  };
}

/**
 * Funil por coorte: as pessoas que começaram a triagem em [a, b) e, para cada uma, até onde chegou seguindo
 * a ordem dos passos (um passo só conta se veio depois do anterior). Devolve [{ kind, label, users, of_prev, of_first }].
 */
export function funnel(db, a, b) {
  const kinds = FUNNEL.map(([k]) => k);
  const events = db.all(`SELECT user_id, kind FROM events WHERE user_id IS NOT NULL AND at >= ? AND at < ?
                         AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY at, id`, a, b, ...kinds);
  const reached = new Map(); // pessoa → quantos passos já deu
  for (const e of events) {
    const step = reached.get(e.user_id) ?? 0;
    if (step < kinds.length && e.kind === kinds[step]) reached.set(e.user_id, step + 1);
  }
  const counts = kinds.map((_, i) => [...reached.values()].filter((s) => s > i).length);
  return FUNNEL.map(([kind, label], i) => ({
    kind, label, users: counts[i],
    of_prev: i ? pct(counts[i], counts[i - 1]) : 100,
    of_first: pct(counts[i], counts[0]),
  }));
}

/** Retenção entre os pacientes com sessão realizada em [a, b). */
export function retention(db, a, b) {
  const done = sessionsIn(db, a, b).filter((r) => r.status === 'done' && r.patient_id);
  const per = new Map();
  for (const r of done) {
    const p = per.get(r.patient_id) || { n: 0, pkg: false };
    p.n += 1; p.pkg ||= Boolean(r.package_id);
    per.set(r.patient_id, p);
  }
  const list = [...per.values()];
  const twoPlus = list.filter((p) => p.n >= 2).length;
  const pkg = list.filter((p) => p.pkg).length;
  return { active: list.length, two_plus: twoPlus, two_plus_pct: pct(twoPlus, list.length), package: pkg, package_pct: pct(pkg, list.length) };
}

/**
 * Vagas sociais em [a, b): horários fixos de vaga social que já passaram (offered), quantos tiveram sessão
 * (used, realizada ou falta), sessões realizadas a preço social (inclusive as do preenchimento automático)
 * e quanto as famílias deixaram de pagar em relação ao valor de tabela.
 */
export function socialStats(db, a, b) {
  const pros = db.all("SELECT * FROM pros WHERE status = 'verified'").filter(offersSocial);
  const rows = sessionsIn(db, a, b);
  let offered = 0; let used = 0;
  for (const p of pros) {
    const keys = socialKeys(p, db.all('SELECT weekday, hour FROM availability WHERE pro_id = ?', p.user_id));
    for (let day = a.slice(0, 10); day <= b.slice(0, 10); day = addDays(day, 1)) {
      for (const k of keys) {
        const [wd, hour] = k.split('|');
        const start = `${day}T${hour}`;
        if (Number(wd) === weekday(day) && start >= a && start < b) offered += 1;
      }
    }
    used += rows.filter((r) => r.pro_id === p.user_id && r.social && keys.has(`${weekday(r.start.slice(0, 10))}|${r.start.slice(11, 16)}`)).length;
  }
  const done = rows.filter((r) => r.status === 'done');
  const social = done.filter((r) => r.social);
  return {
    pros: pros.length, offered, used, occupancy_pct: pct(used, offered),
    sessions: social.length, share_pct: pct(social.length, done.length),
    savings: social.reduce((t, r) => t + Math.max(0, r.pro_price - r.base_price), 0),
  };
}

/** Qualidade em [a, b): nota média, distribuição das notas (5 → 1) e taxa de faltas. */
export function quality(db, a, b) {
  const reviews = db.all('SELECT rating, created_at FROM reviews').filter((r) => { const t = spOf(r.created_at); return t >= a && t < b; });
  const rows = sessionsIn(db, a, b);
  const noShow = rows.filter((r) => r.status === 'no_show').length;
  return {
    reviews: reviews.length,
    avg: reviews.length ? Math.round((sum(reviews, 'rating') / reviews.length) * 100) / 100 : null,
    distribution: [5, 4, 3, 2, 1].map((n) => reviews.filter((r) => r.rating === n).length),
    no_show: noShow, no_show_pct: pct(noShow, rows.length),
  };
}

/**
 * Séries semanais das últimas WEEKS semanas completas: sessões realizadas (e quantas a preço social), faltas,
 * valor transacionado, receita e novos pacientes (primeira sessão realizada naquela semana).
 */
export function weekly(db, now, weeks = WEEKS) {
  const end = weekStart(now.slice(0, 10)); // segunda-feira da semana atual (fica de fora)
  const first = addDays(end, -7 * weeks);
  const list = Array.from({ length: weeks }, (_, i) => {
    const week = addDays(first, 7 * i);
    return { week, sessions: 0, social: 0, no_show: 0, gmv: 0, revenue: 0, new_patients: 0 };
  });
  const at = (stamp) => Math.floor((toMinutes(stamp.slice(0, 10)) - toMinutes(first)) / (7 * 24 * 60));
  for (const r of sessionsIn(db, `${first}T00:00`, `${end}T00:00`)) {
    const w = list[at(r.start)];
    if (r.status === 'no_show') { w.no_show += 1; continue; }
    w.sessions += 1; w.social += r.social ? 1 : 0; w.gmv += r.amount; w.revenue += r.fee;
  }
  for (const p of plusIn(db, `${first}T00:00`, `${end}T00:00`)) {
    const w = list[at(spOf(p.paid_at))];
    w.gmv += p.amount; w.revenue += p.fee;
  }
  for (const r of db.all("SELECT MIN(start) AS first FROM appointments WHERE status = 'done' AND patient_id IS NOT NULL GROUP BY patient_id")) {
    if (r.first >= `${first}T00:00` && r.first < `${end}T00:00`) list[at(r.first)].new_patients += 1;
  }
  return list;
}

/** Tudo o que o painel mostra para o período de `days` dias (30, 90 ou 180). */
export function computeMetrics(db, { now = nowSP(), days = 30 } = {}) {
  const r = periodRange(now, days);
  const cur = kpis(db, r.from, r.to);
  const plusSubscribers = db.get("SELECT COUNT(*) n FROM users WHERE role = 'patient' AND plan = 'plus'").n;
  return {
    now,
    period: { days, label: PERIODS[days] || `${days} dias`, from: r.from.slice(0, 10), to: now.slice(0, 10), prev_from: r.prevFrom.slice(0, 10) },
    kpis: {
      ...cur,
      pros_verified: db.get("SELECT COUNT(*) n FROM pros WHERE status = 'verified'").n,
      pros_pending: db.get("SELECT COUNT(*) n FROM pros WHERE status = 'pending'").n,
      plus_subscribers: plusSubscribers,
      plus_pct: pct(plusSubscribers, cur.patients_active),
    },
    prev: kpis(db, r.prevFrom, r.prevTo),
    funnel: funnel(db, r.from, r.to),
    retention: retention(db, r.from, r.to),
    social: socialStats(db, r.from, r.to),
    quality: quality(db, r.from, r.to),
    weekly: weekly(db, now),
  };
}

/* ---------------- exportação em CSV ---------------- */
// Planilha em português do Brasil: separador ';', vírgula decimal, valores em reais e BOM para o Excel reconhecer o UTF-8.
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
const br = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const cell = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Monta o CSV do painel: indicadores do período (com o período anterior), funil e as semanas. */
export function metricsCsv(m) {
  const k = m.kpis; const p = m.prev;
  const lines = [
    ['Me Salva - métricas do negócio (DADOS DE DEMONSTRAÇÃO, fictícios)'],
    ['Período', `últimos ${m.period.label} (${br(m.period.from)} a ${br(m.period.to)})`],
    ['Gerado em', `${br(m.now.slice(0, 10))} ${m.now.slice(11, 16)}`],
    [],
    ['Indicador', 'Período', 'Período anterior'],
    ['Valor transacionado (R$)', reais(k.gmv), reais(p.gmv)],
    ['Receita da plataforma (R$)', reais(k.revenue), reais(p.revenue)],
    ['  das sessões (12%) (R$)', reais(k.revenue_sessions), reais(p.revenue_sessions)],
    ['  do Me Salva+ (R$)', reais(k.revenue_plus), reais(p.revenue_plus)],
    ['Sessões realizadas', k.sessions, p.sessions],
    ['Ticket médio (R$)', reais(k.ticket), reais(p.ticket)],
    ['Pacientes ativos', k.patients_active, p.patients_active],
    ['Profissionais ativos', k.pros_active, p.pros_active],
    ['Profissionais aguardando verificação', k.pros_pending, ''],
    ['Assinantes do Me Salva+ (hoje)', k.plus_subscribers, ''],
    ['Sessões a preço social', k.social_sessions, p.social_sessions],
    ['Pacientes com 2 ou mais sessões', `${m.retention.two_plus} (${m.retention.two_plus_pct}%)`, ''],
    ['Pacientes com pacote recorrente', `${m.retention.package} (${m.retention.package_pct}%)`, ''],
    ['Ocupação das vagas sociais fixas', `${m.social.used} de ${m.social.offered} (${m.social.occupancy_pct}%)`, ''],
    ['Economia das famílias nas vagas sociais (R$)', reais(m.social.savings), ''],
    ['Nota média', m.quality.avg == null ? '' : String(m.quality.avg).replace('.', ','), ''],
    ['Avaliações (5/4/3/2/1 estrelas)', m.quality.distribution.join('/'), ''],
    ['Taxa de faltas', `${m.quality.no_show_pct}%`, ''],
    [],
    ['Funil (quem começou a triagem no período)', 'Pessoas', 'Do passo anterior (%)', 'Do início (%)'],
    ...m.funnel.map((f) => [f.label, f.users, f.of_prev, f.of_first]),
    [],
    ['Semana (início)', 'Sessões realizadas', 'A preço social', 'Faltas', 'Valor transacionado (R$)', 'Receita da plataforma (R$)', 'Novos pacientes'],
    ...m.weekly.map((w) => [br(w.week), w.sessions, w.social, w.no_show, reais(w.gmv), reais(w.revenue), w.new_patients]),
  ];
  return '﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
}
