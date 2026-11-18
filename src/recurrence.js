// Agendamento recorrente (v1.2): datas de um pacote, conferência de conflitos e sugestão do horário livre
// mais próximo. Funções puras (sem banco), cobertas por test/recurrence.test.js.
//
// Terapia ABA costuma ter várias sessões por semana. Em vez de agendar uma por uma, o paciente escolhe o
// primeiro horário, os dias da semana (por exemplo, seg e qua) e a duração (4, 8 ou 12 semanas). O pacote
// repete o mesmo horário nesses dias. Antes de pagar, cada data é conferida:
//   'mine'         o próprio paciente já tem outra sessão nesse horário (com qualquer profissional);
//   'taken'        o horário do profissional já está reservado por outra pessoa;
//   'unavailable'  o profissional não atende nesse dia e horário (ou é cedo demais para reservar).
// Para cada data com conflito, sugerimos o horário livre mais próximo (no mesmo dia, se houver).
import { addDays, weekday, toMinutes, weekStart } from './time.js';

// As sessões têm 50 minutos e começam na hora cheia: duas sessões "batem" se começam a menos de 60 minutos uma da outra.
export const GAP_MIN = 60;
export const overlaps = (a, b) => Math.abs(toMinutes(a) - toMinutes(b)) < GAP_MIN;
// A sugestão procura até 3 dias antes ou depois da data original.
export const SUGGEST_DAYS = 3;

// Datas do pacote: a partir do dia do primeiro horário, por `weeks` semanas, nos dias da semana escolhidos,
// sempre no mesmo horário. O dia do primeiro horário sempre entra. Cada dia escolhido aparece `weeks` vezes.
export function occurrences({ start, weekdays, weeks }) {
  const day0 = start.slice(0, 10);
  const time = start.slice(11, 16);
  const days = new Set([...weekdays, weekday(day0)]);
  const out = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(day0, i);
    if (days.has(weekday(day))) out.push(`${day}T${time}`);
  }
  return out;
}

// Horário livre mais próximo de `target`, até SUGGEST_DAYS dias antes ou depois, que não bata com nenhum
// horário de `avoid`. Em empate, fica o mais cedo. Devolve o horário (objeto de slots) ou null.
export function nearestFree(target, slots, avoid) {
  const t = toMinutes(target);
  let best = null;
  let bestDiff = Infinity;
  for (const s of slots) {
    if (s.taken) continue;
    const diff = Math.abs(toMinutes(s.start) - t);
    if (diff > SUGGEST_DAYS * 24 * 60 || diff > bestDiff) continue;
    if (avoid.some((a) => overlaps(a, s.start))) continue;
    if (diff < bestDiff || s.start < best.start) { best = s; bestDiff = diff; }
  }
  return best;
}

/**
 * Confere as datas de um pacote.
 * @param dates  horários do pacote (saída de occurrences)
 * @param slots  horários do profissional no período (buildSlots, achatado), com social e taken
 * @param busy   horários de outras sessões ativas do paciente (com qualquer profissional)
 * @returns [{ start, ok, reason, slot, suggestion }] — slot e suggestion são objetos de slots (com social)
 */
export function planPackage({ dates, slots, busy = [] }) {
  const byStart = new Map(slots.map((s) => [s.start, s]));
  // 1ª passada: o que pode ficar como está.
  const items = dates.map((start) => {
    const slot = byStart.get(start);
    if (!slot) return { start, ok: false, reason: 'unavailable', slot: null, suggestion: null };
    // Se o próprio paciente já tem sessão nesse horário, o aviso é esse (mesmo que a reserva seja com este profissional).
    if (busy.some((b) => overlaps(b, start))) return { start, ok: false, reason: 'mine', slot, suggestion: null };
    if (slot.taken) return { start, ok: false, reason: 'taken', slot, suggestion: null };
    return { start, ok: true, reason: null, slot, suggestion: null };
  });
  // 2ª passada: para cada conflito, o horário livre mais próximo que não bata com as outras sessões do pacote,
  // com as sugestões já feitas nem com as sessões que o paciente já tem.
  const chosen = items.filter((i) => i.ok).map((i) => i.start);
  for (const it of items) {
    if (it.ok) continue;
    it.suggestion = nearestFree(it.start, slots, [...chosen, ...busy]);
    if (it.suggestion) chosen.push(it.suggestion.start);
  }
  return items;
}

// Vagas sociais por semana (de segunda a domingo) num conjunto de sessões: { 'AAAA-MM-DD da segunda': n }.
// Usado nos testes para garantir que um pacote nunca passa do limite semanal do profissional.
export function socialPerWeek(sessions) {
  const out = {};
  for (const s of sessions) if (s.social) { const w = weekStart(s.start.slice(0, 10)); out[w] = (out[w] || 0) + 1; }
  return out;
}
