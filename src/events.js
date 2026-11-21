// Registro de eventos do funil (v1.3), lido pelo painel de métricas da administração (src/metrics.js).
// Cada evento guarda só o tipo, o horário de São Paulo e identificadores internos (paciente, profissional,
// sessão ou pacote). Nunca o nome, as respostas da triagem, o texto de mensagens ou valores.
import { nowSP, toMinutes, fromMinutes } from './time.js';

// Os sete passos registrados, na ordem em que costumam acontecer.
export const EVENT_KINDS = ['triage_started', 'triage_done', 'profile_view', 'booking_created', 'payment_confirmed', 'session_done', 'review_sent'];
// Eventos que o navegador pode registrar por POST /api/events. Os demais nascem no servidor, dentro das
// próprias rotas (triagem, perfil, reserva, pagamento, sessão e avaliação), e não podem ser forjados.
export const CLIENT_EVENTS = ['triage_started'];
// Abrir a triagem de novo ou recarregar o mesmo perfil dentro de 30 minutos conta uma vez só,
// para não inflar o funil.
const DEDUPE_MIN = 30;
const DEDUPED = new Set(['triage_started', 'profile_view']);

export function createEvents(db) {
  /**
   * Grava um evento. Devolve false quando ele repete um evento recente da mesma pessoa (veja DEDUPE_MIN).
   * @param kind   um de EVENT_KINDS
   * @param user_id paciente; pro_id profissional; ref_id sessão ou pacote; at horário 'AAAA-MM-DDTHH:MM' (padrão: agora)
   */
  function track(kind, { user_id = null, pro_id = null, ref_id = null, at = nowSP() } = {}) {
    if (!EVENT_KINDS.includes(kind)) throw new Error(`Evento desconhecido: ${kind}`);
    if (DEDUPED.has(kind) && user_id) {
      const since = fromMinutes(toMinutes(at) - DEDUPE_MIN);
      if (db.get('SELECT 1 FROM events WHERE kind = ? AND user_id = ? AND pro_id IS ? AND at >= ?', kind, user_id, pro_id, since)) return false;
    }
    db.run('INSERT INTO events(kind, user_id, pro_id, ref_id, at) VALUES (?, ?, ?, ?, ?)', kind, user_id, pro_id, ref_id, at);
    return true;
  }
  return { track };
}
