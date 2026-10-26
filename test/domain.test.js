// Testes das regras de negócio puras: horários, vagas sociais, preço e emparelhamento.
// Rodam sem banco nem servidor, com `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots, findSlot } from '../src/slots.js';
import { quote } from '../src/pricing.js';
import { deriveNeeds, rank } from '../src/matching.js';
import { addDays, weekday, weekStart, toMinutes } from '../src/time.js';
import { pixCode, luhn, encrypt, decrypt } from '../src/security.js';
import { randomBytes } from 'node:crypto';

const MONDAY = '2026-10-19T07:00';

test('datas: soma de dias, dia da semana e início da semana', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(weekday('2026-10-19'), 1);
  assert.equal(weekStart('2026-10-25'), '2026-10-19');
  assert.equal(toMinutes('2026-10-19T10:00') - toMinutes('2026-10-19T09:00'), 60);
});

test('horários: respeitam a antecedência mínima e marcam os já reservados', () => {
  const pro = { is_new: 0 };
  const template = [{ weekday: 1, hour: '07:00' }, { weekday: 1, hour: '09:00' }, { weekday: 2, hour: '09:00' }];
  const days = buildSlots({ pro, template, taken: new Set(['2026-10-20T09:00']), now: MONDAY, days: 2 });
  assert.deepEqual(days[0].items.map((s) => s.time), ['09:00']); // 07:00 já passou
  assert.equal(findSlot(days, '2026-10-20T09:00').taken, true);
});

test('vagas sociais: só para recém-formados com supervisor e nas primeiras N vagas da semana', () => {
  const template = [1, 2, 3].map((wd) => ({ weekday: wd, hour: '10:00' }));
  const base = { social_price: 4500, social_weekly: 2, auto_fill: 0 };
  const semSupervisor = buildSlots({ pro: { ...base, is_new: 1, supervisor: null }, template, now: MONDAY, days: 7 });
  assert.ok(semSupervisor.flatMap((d) => d.items).every((s) => !s.social));
  const comSupervisor = buildSlots({ pro: { ...base, is_new: 1, supervisor: 'Supervisora' }, template, now: MONDAY, days: 7 });
  const social = comSupervisor.flatMap((d) => d.items).filter((s) => s.social).map((s) => s.start);
  assert.deepEqual(social, ['2026-10-19T10:00', '2026-10-20T10:00']);
});

test('vagas sociais: preenchimento automático transforma horário livre das próximas 24 h', () => {
  const template = [{ weekday: 2, hour: '06:00' }, { weekday: 4, hour: '10:00' }];
  const pro = { is_new: 1, supervisor: 'S', social_price: 4500, social_weekly: 0, auto_fill: 1 };
  const items = buildSlots({ pro, template, now: MONDAY, days: 7 }).flatMap((d) => d.items);
  assert.equal(items.find((s) => s.start === '2026-10-20T06:00').auto, true);
  assert.equal(items.find((s) => s.start === '2026-10-22T10:00').social, false);
});

test('preço: comissão de 12% e desconto do Me Salva+ custeado pela plataforma', () => {
  const pro = { price: 10000, social_price: 4500 };
  assert.deepEqual(quote({ pro }), { base: 10000, discount: 0, amount: 10000, fee: 1200, pro_amount: 8800 });
  const plus = quote({ pro, plus: true });
  assert.equal(plus.amount, 9000);
  assert.equal(plus.pro_amount, 8800); // o profissional recebe o mesmo valor
  assert.equal(plus.fee, 200);
  assert.equal(quote({ pro, social: true }).amount, 4500);
});

const PROS = [
  { id: 1, name: 'ABA social', area: 'aba', audience: ['Crianças'], topics: ['TEA', 'Comunicação'], modalities: ['presencial'], price: 9000, social_price: 4500, bairro: 'Penha', years: 1, rating: 4.8, rating_count: 20 },
  { id: 2, name: 'ABA sênior', area: 'aba', audience: ['Crianças'], topics: ['TEA'], modalities: ['presencial'], price: 11000, social_price: null, bairro: 'Butantã', years: 10, rating: 4.9, rating_count: 30 },
  { id: 3, name: 'Psicóloga adultos', area: 'psicologo', audience: ['Adultos'], topics: ['Ansiedade'], modalities: ['online'], price: 8000, social_price: null, bairro: 'Centro', years: 5, rating: 4.7, rating_count: 10 },
  { id: 4, name: 'Neuro', area: 'neuro', audience: ['Crianças', 'Adultos'], topics: ['TEA', 'TDAH'], modalities: ['presencial'], price: 18000, social_price: null, bairro: 'Liberdade', years: 12, rating: 4.9, rating_count: 30 },
];
const slots = new Map(PROS.map((p) => [p.id, [{ start: '2026-10-20T09:00', social: p.id === 1 }]]));

test('triagem: respostas leigas viram critérios clínicos', () => {
  const n = deriveNeeds({ para: 'filho', idade: '4-6', diag: 'sim', sinais: ['Sensível a barulhos, texturas ou luzes'], modal: 'presencial', orc: 60 });
  assert.equal(n.audience, 'Crianças');
  assert.equal(n.areas.aba, 1);
  assert.ok(n.topics.includes('Integração sensorial'));
  assert.equal(n.budget, 6000);
});

test('emparelhamento: restrições obrigatórias e vaga social dentro do orçamento', () => {
  const needs = deriveNeeds({ para: 'filho', idade: '4-6', diag: 'sim', modal: 'presencial', orc: 60 });
  const { results } = rank(PROS, needs, { bairro: 'Penha', freeSlotsByPro: slots });
  assert.equal(results[0].pro_id, 1);
  assert.ok(results[0].reasons.some((r) => r.includes('Vaga social')));
  assert.ok(!results.some((r) => r.pro_id === 3)); // atende só adultos
});

test('emparelhamento: relaxa o orçamento quando sobram poucas opções e avisa', () => {
  const needs = deriveNeeds({ para: 'filho', idade: '4-6', diag: 'nao', modal: 'presencial', orc: 60 });
  const { results, relaxed } = rank(PROS, needs, { bairro: 'Penha', freeSlotsByPro: slots });
  assert.ok(relaxed.includes('orcamento'));
  const neuro = results.find((r) => r.pro_id === 4);
  assert.ok(neuro.warnings.includes('Acima do valor que você informou'));
});

test('emparelhamento: responde rápido com 10 mil perfis', () => {
  const many = Array.from({ length: 10000 }, (_, i) => ({ ...PROS[i % 4], id: 100 + i }));
  const map = new Map(many.map((p) => [p.id, [{ start: '2026-10-20T19:00', social: false }]]));
  const needs = deriveNeeds({ para: 'eu', motivos: ['Ansiedade'], modal: 'online', orc: 120, hor: ['Noite'] });
  const t0 = performance.now();
  rank(many, needs, { bairro: 'Centro', freeSlotsByPro: map });
  assert.ok(performance.now() - t0 < 300, 'deveria levar menos de 300 ms');
});

test('segurança: PIX com CRC válido, Luhn e criptografia do prontuário', () => {
  const code = pixCode({ amountCents: 4500, txid: 'MS1abc' });
  assert.match(code, /^000201.*5802BR.*6304[0-9A-F]{4}$/);
  assert.ok(luhn('4242 4242 4242 4242'));
  assert.ok(!luhn('4242 4242 4242 4241'));
  const key = randomBytes(32);
  const enc = encrypt(key, 'Anotação sigilosa');
  assert.notEqual(enc.data, 'Anotação sigilosa');
  assert.equal(decrypt(key, enc), 'Anotação sigilosa');
});
