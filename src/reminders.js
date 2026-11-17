// Lembretes de sessão (v1.1): um 24 horas antes e outro 1 hora antes de cada sessão confirmada.
// Cada lembrete vira uma mensagem automática no chat da sessão e uma notificação para o paciente e o profissional.
// A tabela reminders tem a chave (sessão, tipo): o mesmo lembrete nunca é enviado duas vezes, mesmo que a
// conferência rode de novo ou que o botão da demonstração seja apertado várias vezes.
import { nowSP, toMinutes, fromMinutes, whenText } from './time.js';

// O lembrete de 24 h vale para sessões que começam nas próximas 24 horas (e ainda a mais de 1 hora).
export const DAY_MIN = 24 * 60;
// O lembrete de 1 h vale quando faltam 60 minutos ou menos.
export const HOUR_MIN = 60;
// Botão "Disparar lembretes agora" (só no modo demonstração): antecipa o lembrete de 1 h das sessões
// que começam nas próximas 3 horas, para a apresentação não depender de esperar o relógio.
export const DEMO_AHEAD_MIN = 180;

export function createReminders({ db, svc }) {
  // Confere as sessões confirmadas e envia os lembretes devidos no instante now ('AAAA-MM-DDTHH:MM', São Paulo).
  // ahead: até quantos minutos antes do início vale o lembrete de 1 h. Devolve a lista do que foi enviado.
  function run({ now = nowSP(), ahead = HOUR_MIN } = {}) {
    const until = fromMinutes(toMinutes(now) + DAY_MIN);
    const appts = db.all(`SELECT a.id, a.start, a.modality, a.patient_id, a.pro_id, pu.name AS pro_name, pt.name AS patient_name,
                                 r24.kind AS sent24, r1.kind AS sent1
                          FROM appointments a
                          JOIN users pu ON pu.id = a.pro_id
                          JOIN users pt ON pt.id = a.patient_id
                          LEFT JOIN reminders r24 ON r24.appointment_id = a.id AND r24.kind = '24h'
                          LEFT JOIN reminders r1 ON r1.appointment_id = a.id AND r1.kind = '1h'
                          WHERE a.status = 'confirmed' AND a.start > ? AND a.start <= ?
                          ORDER BY a.start`, now, until);
    const sent = [];
    for (const a of appts) {
      const left = toMinutes(a.start) - toMinutes(now);
      // Só o lembrete mais próximo vale: quem marca em cima da hora recebe só o de 1 h.
      const kind = left <= ahead ? '1h' : '24h';
      if ((kind === '24h' && a.sent24) || (kind === '1h' && a.sent1)) continue;
      db.tx(() => {
        // A chave da tabela garante "uma vez só", mesmo com duas conferências ao mesmo tempo.
        if (!db.run('INSERT INTO reminders(appointment_id, kind) VALUES (?, ?) ON CONFLICT DO NOTHING', a.id, kind).changes) return;
        const when = whenText(a.start, now);
        const modal = a.modality === 'online' ? 'online' : 'presencial';
        const extra = a.modality === 'online' ? ' A sala abre 15 minutos antes do horário.' : '';
        svc.pushMessage({ patient_id: a.patient_id, pro_id: a.pro_id, kind: 'system', body: `Lembrete: a sessão é ${when}, ${modal}.${extra}` });
        svc.notify(a.patient_id, { kind: 'reminder', title: 'Lembrete de sessão', body: `Sua sessão com ${a.pro_name} é ${when} (${modal}).`, screen: 'agenda' });
        svc.notify(a.pro_id, { kind: 'reminder', title: 'Lembrete de sessão', body: `Sessão com ${a.patient_name} ${when} (${modal}).`, screen: 'proagenda' });
        sent.push({ appointment_id: a.id, kind });
      });
    }
    return sent;
  }

  // Liga a conferência automática: uma vez agora e depois a cada minuto. Devolve a função que desliga.
  function start(intervalMs = 60_000) {
    const tick = () => { try { run(); } catch (e) { console.error('Falha ao enviar lembretes:', e); } };
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { run, start };
}
