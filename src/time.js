// Datas no fuso de São Paulo, independentemente do fuso do servidor.
// Horários de sessão são guardados como texto local: 'AAAA-MM-DDTHH:MM'.
// Assim um servidor em UTC (como o Render) mostra os mesmos horários que o usuário vê.

// Formatador que converte um instante para a hora de São Paulo (o formato en-CA gera AAAA-MM-DD).
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Agora (ou a data informada) como 'AAAA-MM-DDTHH:MM' no horário de São Paulo.
export function nowSP(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Só a data: 'AAAA-MM-DD'.
export const todaySP = (date) => nowSP(date).slice(0, 10);

// Soma n dias a uma data 'AAAA-MM-DD' (n pode ser negativo). Usa UTC para não sofrer com mudanças de fuso.
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
// Dia da semana de uma data: 0 = domingo … 6 = sábado.
export function weekday(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
// Minutos desde 1970 de um horário local (só para comparar e somar).
export function toMinutes(stamp) {
  const [day, time = '00:00'] = stamp.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
}
// Operação inversa de toMinutes.
export function fromMinutes(min) {
  return new Date(min * 60000).toISOString().slice(0, 16);
}
// Segunda-feira da semana de um dia (para agrupar vagas sociais por semana).
export function weekStart(day) {
  const wd = weekday(day);
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}
// Mês 'AAAA-MM' de um horário.
export const monthOf = (stamp) => stamp.slice(0, 7);
