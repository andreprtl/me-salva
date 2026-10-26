// Motor de emparelhamento: triagem → necessidades → restrições obrigatórias → pontuação ponderada.
// Os pesos são a versão inicial definida pela equipe e devem ser revistos com especialistas (PIPE, atividade A2).
import { distanceKm, areaById } from '../public/js/shared/data.js';

// Peso de cada critério na nota final (somam 100).
export const WEIGHTS = { area: 30, topics: 22, rating: 14, availability: 12, distance: 10, experience: 6, budgetFit: 6 };

// Normaliza texto para comparar sem acentos e sem diferença entre maiúsculas e minúsculas.
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Faixas de horário escolhidas na triagem, em horas [início, fim).
const PERIODS = { 'Manhã': [0, 12], 'Tarde': [12, 18], 'Noite': [18, 24] };

/** Converte as respostas leigas da triagem em critérios. */
export function deriveNeeds(a = {}) {
  const kid = a.para === 'filho';
  // Critérios: áreas indicadas com peso de 0 a 1, temas, público, modalidade, orçamento em centavos e períodos.
  const needs = {
    forKid: kid,
    audience: kid ? (a.idade === '13-17' ? 'Adolescentes' : 'Crianças') : 'Adultos',
    areas: {}, topics: [],
    modality: ['online', 'presencial'].includes(a.modal) ? a.modal : 'tanto',
    budget: Math.max(0, Number(a.orc) || 0) * 100 || Infinity, // reais → centavos
    periods: Array.isArray(a.hor) ? a.hor.filter((p) => PERIODS[p]) : [],
    urgent: false, highFrequency: false, context: null,
  };
  // Caminho TEA/ABA: com diagnóstico, prioriza ABA; sem diagnóstico, prioriza quem pode avaliar (neuropsicologia e psiquiatria).
  if (kid) {
    const sinais = Array.isArray(a.sinais) ? a.sinais : [];
    needs.topics.push('TEA');
    if (a.diag === 'sim') {
      Object.assign(needs.areas, { aba: 1, to: 0.5, psicologo: 0.4 });
      needs.context = 'tea-confirmado';
    } else {
      Object.assign(needs.areas, { neuro: 1, psiquiatra: 0.9, aba: 0.6, psicologo: 0.3 });
      needs.context = 'tea-investigacao';
    }
    if (sinais.some((s) => /sens[ií]vel/i.test(s))) { needs.areas.to = Math.max(needs.areas.to || 0, 0.8); needs.topics.push('Integração sensorial'); }
    if (sinais.some((s) => /escola/i.test(s))) needs.topics.push('Dificuldade escolar');
    if (sinais.some((s) => /fala|contato|brincar/i.test(s))) needs.topics.push('Comunicação', 'Habilidades sociais');
    if (sinais.some((s) => /rotina/i.test(s))) needs.topics.push('Rotina', 'Comportamento');
    if (a.suporte === 'muito') needs.highFrequency = true;
  } else {
    // Adultos: os motivos escolhidos viram temas, e a psicologia é a área principal.
    const motivos = Array.isArray(a.motivos) ? a.motivos : [];
    needs.topics.push(...motivos);
    needs.areas.psicologo = 1;
    needs.areas.psicanalista = motivos.includes('Autoconhecimento') ? 0.9 : 0.5;
    if (motivos.includes('TDAH')) needs.areas.psiquiatra = 0.7;
    if (motivos.includes('Relacionamentos')) needs.topics.push('Terapia de casal', 'Família');
    if (a.tempo === 'forte') { needs.urgent = true; needs.areas.psiquiatra = Math.max(needs.areas.psiquiatra || 0, 0.9); }
  }
  return needs;
}

const topicHit = (proTopics, t) => proTopics.some((p) => norm(p) === norm(t) || norm(p).includes(norm(t)));
const hourOf = (start) => Number(start.slice(11, 13));

/**
 * @param pros   [{ id, area, audience[], topics[], modalities[], price, social_price, bairro, years, rating, rating_count, name }]
 * @param needs  saída de deriveNeeds
 * @param ctx    { bairro, freeSlotsByPro: Map<id, [{start, social}]> } (próximos 14 dias, só horários livres)
 */
export function rank(pros, needs, ctx = {}) {
  const slotsOf = (p) => ctx.freeSlotsByPro?.get(p.id) || [];
  // Preço efetivo: o da vaga social, se houver uma livre; senão, o valor normal.
  const effPrice = (p) => {
    const free = slotsOf(p);
    const socialFree = p.social_price && free.some((s) => s.social);
    return socialFree ? Math.min(p.price, p.social_price) : p.price;
  };
  // Restrições obrigatórias: área indicada, público, ter horário livre, modalidade e orçamento.
  // As duas últimas podem ser relaxadas quando há poucas opções.
  const hard = (p, relax) => {
    if (!(needs.areas[p.area] > 0)) return false;
    const aud = needs.audience === 'Adolescentes' ? ['Adolescentes', 'Crianças'] : [needs.audience];
    if (!p.audience.some((x) => aud.includes(x))) return false;
    if (!slotsOf(p).length) return false;
    if (!relax.includes('modalidade') && needs.modality !== 'tanto' && !p.modalities.includes(needs.modality)) return false;
    if (!relax.includes('orcamento') && effPrice(p) > needs.budget) return false;
    return true;
  };

  // Se sobrarem menos de 3 opções, relaxa primeiro o orçamento e depois a modalidade.
  let relax = [];
  let pool = pros.filter((p) => hard(p, relax));
  for (const r of ['orcamento', 'modalidade']) {
    if (pool.length >= 3) break;
    relax = [...relax, r];
    pool = pros.filter((p) => hard(p, relax));
  }

  const results = pool.map((p) => {
    const free = slotsOf(p);
    const price = effPrice(p);
    const matched = [...new Set(needs.topics)].filter((t) => topicHit(p.topics, t));
    // Nota bayesiana: aproxima de 4,0 quem tem poucas avaliações, para uma única nota 5 não valer mais que 60 notas 4,8.
    const C = 3, prior = 4.0;
    const bayes = (p.rating * p.rating_count + prior * C) / (p.rating_count + C);
    const inPeriod = needs.periods.length
      ? free.filter((s) => needs.periods.some((per) => hourOf(s.start) >= PERIODS[per][0] && hourOf(s.start) < PERIODS[per][1]))
      : free;
    const km = ctx.bairro ? distanceKm(ctx.bairro, p.bairro) : 5;
    const presencialMatters = needs.modality !== 'online' && p.modalities.includes('presencial');

    // Cada critério vira um número de 0 a 1; a nota final é a média ponderada pelos WEIGHTS, de 0 a 100.
    const f = {
      area: needs.areas[p.area] || 0,
      topics: needs.topics.length ? Math.min(1, matched.length / Math.min(3, new Set(needs.topics).size)) : 0.5,
      rating: Math.max(0, Math.min(1, (bayes - 3) / 2)),
      availability: Math.min(1, inPeriod.length / 3),
      distance: presencialMatters ? 1 - Math.min(km, 20) / 20 : (p.modalities.includes('online') ? 0.7 : 0.3),
      experience: Math.min(p.years, 10) / 10,
      budgetFit: Number.isFinite(needs.budget) ? (price <= needs.budget ? 1 : 0) : 0.5,
    };
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const score = Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * f[k], 0) / total * 100);

    // Motivos em linguagem simples, do critério que mais pesou para o que menos pesou.
    const reasons = [];
    const add = (weight, text) => reasons.push({ weight, text });
    const areaText = {
      'tea-confirmado': { aba: 'Intervenção ABA indicada para TEA confirmado', to: 'Terapia ocupacional complementar ao ABA' },
      'tea-investigacao': { neuro: 'Pode investigar e confirmar o diagnóstico', psiquiatra: 'Avaliação médica para investigar o diagnóstico', aba: 'Orientação para a rotina enquanto o diagnóstico é investigado' },
    }[needs.context]?.[p.area];
    if (areaText) add(WEIGHTS.area * f.area, areaText);
    else if (needs.urgent && p.area === 'psiquiatra') add(WEIGHTS.area * f.area, 'Avaliação médica para sintomas intensos');
    if (matched.length) add(WEIGHTS.topics * f.topics, 'Experiência com ' + matched.slice(0, 3).join(', ').toLowerCase().replace(/\btea\b/, 'TEA').replace(/\btdah\b/, 'TDAH'));
    if (price <= needs.budget && Number.isFinite(needs.budget)) {
      // A vaga social é decisiva para quem tem orçamento limitado, então o motivo aparece com prioridade.
      add(price < p.price ? 25 : WEIGHTS.budgetFit, price < p.price ? `Vaga social de ${brl(price)} cabe no seu orçamento` : `Valor dentro do seu orçamento (${brl(price)})`);
    }
    if (presencialMatters) add(WEIGHTS.distance * f.distance, `Atende presencialmente a ${String(km).replace('.', ',')} km`);
    else if (needs.modality === 'online') add(WEIGHTS.distance * f.distance, 'Atende online');
    if (needs.periods.length && inPeriod.length) add(WEIGHTS.availability * f.availability, `Tem horários livres de ${needs.periods.join(' e ').toLowerCase()}`);
    if (needs.highFrequency && p.area === 'aba') add(WEIGHTS.availability, 'Atende com alta frequência semanal');
    if (p.rating_count >= 3) add(WEIGHTS.rating * f.rating, `Nota ${p.rating.toFixed(1).replace('.', ',')} em ${p.rating_count} avaliações`);
    reasons.sort((a, b) => b.weight - a.weight);

    // Avisos mostrados no cartão quando o profissional entrou só porque a busca foi ampliada.
    const warnings = [];
    if (relax.includes('orcamento') && price > needs.budget) warnings.push('Acima do valor que você informou');
    if (relax.includes('modalidade') && needs.modality !== 'tanto' && !p.modalities.includes(needs.modality)) warnings.push(needs.modality === 'online' ? 'Atende só presencialmente' : 'Atende só online');

    return {
      pro_id: p.id, score, price, area: areaById(p.area)?.nome, strict: warnings.length === 0,
      reasons: reasons.slice(0, 3).map((r) => r.text), warnings, features: f,
    };
  });
  // Quem atende a todas as restrições vem antes de quem só entrou porque a busca foi ampliada.
  results.sort((a, b) => Number(b.strict) - Number(a.strict) || b.score - a.score);
  return { results, relaxed: relax };
}

const brl = (c) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
