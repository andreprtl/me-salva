// Geração de horários a partir da disponibilidade semanal do profissional,
// incluindo a marcação de vagas sociais. Funções puras (sem banco), cobertas por testes.
import { addDays, weekday, toMinutes } from './time.js';

const DAY_ORDER = (wd) => (wd + 6) % 7; // segunda = 0 … domingo = 6

// Vagas sociais só existem para recém-formados com supervisor e valor social definido.
export function offersSocial(pro) {
  return Boolean(pro.is_new && pro.supervisor && pro.social_price);
}

/**
 * @param pro       perfil do profissional (is_new, supervisor, social_price, social_weekly, auto_fill)
 * @param template  disponibilidade semanal: [{ weekday: 0-6, hour: 'HH:MM' }]
 * @param taken     Set com horários já reservados ('AAAA-MM-DDTHH:MM')
 * @param now       agora em São Paulo ('AAAA-MM-DDTHH:MM')
 */
export function buildSlots({ pro, template, taken = new Set(), now, days = 14, minLeadMin = 60 }) {
  const today = now.slice(0, 10);
  const nowMin = toMinutes(now);
  const social = offersSocial(pro);
  // As primeiras N entradas da semana (de segunda a domingo) são vagas sociais fixas.
  const ordered = [...template].sort((a, b) => DAY_ORDER(a.weekday) - DAY_ORDER(b.weekday) || a.hour.localeCompare(b.hour));
  const fixed = new Set(social ? ordered.slice(0, pro.social_weekly || 0).map((t) => `${t.weekday}|${t.hour}`) : []);

  const out = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const wd = weekday(day);
    const items = [];
    for (const { hour } of template.filter((t) => t.weekday === wd).sort((a, b) => a.hour.localeCompare(b.hour))) {
      const start = `${day}T${hour}`;
      const m = toMinutes(start);
      // Não oferece horários que começam em menos de 1 hora.
      if (m < nowMin + minLeadMin) continue;
      const isFixed = fixed.has(`${wd}|${hour}`);
      // Preenchimento automático: horário livre nas próximas 24 h vira vaga social.
      const isAuto = social && pro.auto_fill && !isFixed && m - nowMin <= 24 * 60;
      items.push({ start, time: hour, social: isFixed || Boolean(isAuto), auto: Boolean(isAuto), taken: taken.has(start) });
    }
    out.push({ date: day, weekday: wd, items });
  }
  return out;
}

// Procura um horário específico na lista gerada (usado para validar uma reserva).
export function findSlot(days, start) {
  for (const d of days) for (const s of d.items) if (s.start === start) return s;
  return null;
}

// Só os horários ainda livres, numa lista única.
export function freeSlots(days) {
  return days.flatMap((d) => d.items.filter((s) => !s.taken));
}
