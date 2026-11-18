// Pacotes recorrentes (v1.2) na interface: PIX do pacote, tela do pacote com todas as sessões, cartão agrupado
// na agenda do paciente, marca "recorrente" na agenda do profissional e cancelamento ("só esta sessão" ou
// "esta e as próximas"). A opção "Repetir" fica na tela de agendamento, em patient.js.
import {
  S, A, LAYERS, screen, api, run, go, top, refresh, every, openLayer, closeLayer, confirmSheet, toast,
  esc, ic, avatar, stars, backBtn, brl2, when, dayLabel, dateBox, qrSvg, weekdayOf, hoursUntil, dm, $,
} from '../core.js';
import { notifyInvite } from './notifications.js';

// Situação de cada sessão, em texto curto.
const STATUS = {
  confirmed: '<span class="pill lav">confirmada</span>', done: '<span class="pill ok">realizada</span>',
  no_show: '<span class="pill warn">falta</span>', cancelled: '<span class="pill">cancelada</span>',
  pending_payment: '<span class="pill warn">aguardando pagamento</span>',
};
// A sessão ficou num horário diferente do padrão do pacote (sugestão aceita)?
const moved = (pk, a) => a.start.slice(11, 16) !== pk.time || !pk.weekdays.includes(weekdayOf(a.start.slice(0, 10)));
// Quem pode cancelar: o profissional a qualquer momento; o paciente até 24 h antes.
const canCancel = (a) => a.status === 'pending_payment' || (a.status === 'confirmed' && (S.user.role === 'pro' || hoursUntil(a.start) >= 24));

/* ================= PIX do pacote ================= */
// Um PIX só, com o valor total; o botão simula a confirmação do banco e confirma todas as sessões.
screen('pixpacote', {
  nav: 'agenda', width: 'narrow',
  load: (id) => api(`/api/packages/${id}`),
  view: (id, d) => {
    const pk = d.package;
    return `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">PIX do pacote</div><h1 class="h1">${brl2(pk.amount)}</h1></div></header>
    <main class="scroll gut">
      ${pk.status === 'expired' ? `<div class="banner warn">${ic('clock')}<div><b>O prazo terminou</b><span>Os horários foram liberados. Volte e monte o pacote de novo.</span></div></div>` : ''}
      <div class="card row">${avatar(pk.pro_name, pk.pro_color, 44)}<div class="grow"><b>${esc(pk.pro_name)}</b><div class="small muted">${pk.sessions} sessões · ${esc(pk.label)} · de ${dm(pk.first)} a ${dm(pk.last)}</div></div></div>
      <div class="qr">${qrSvg(pk.pix_code || 'pacote' + id)}</div>
      <div class="row" style="justify-content:center"><span class="spin"></span><span class="muted">Aguardando pagamento · expira em <span id="pixcount" class="num">15:00</span></span></div>
      <section class="sec"><div class="lbl">PIX copia e cola</div><div class="pixcode" id="pixcode">${esc(pk.pix_code || '')}</div><button class="btn btn-ghost btn-block" data-a="copyPix">${ic('copy')}Copiar código</button></section>
      <div class="disclaimer">${ic('info')}<span>Ambiente de teste: o código segue o padrão do PIX, mas a chave é fictícia e nenhum valor é cobrado. O valor total é a soma das sessões, sem taxa extra.</span></div>
    </main>
    <div class="footer gut"><button class="btn btn-teal btn-block" data-a="pixPackOk" data-v="${id}" ${pk.status === 'pending' ? '' : 'disabled'}>${ic('check')}Simular pagamento aprovado</button></div>`;
  },
  after: (id, d) => {
    const until = d.package.expires_at || Date.now();
    const tick = () => { const left = Math.max(0, until - Date.now()); const el = $('#pixcount'); if (el) el.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`; };
    tick(); every(tick, 1000);
    // Pago em outra aba ou aparelho: segue para a confirmação.
    every(async () => { const r = await api(`/api/packages/${id}`).catch(() => null); if (r?.package.status === 'paid' && top().n === 'pixpacote') { S.stack = [{ n: 'home' }]; go('pacote', { id, ok: true }); } }, 4000);
  },
});
A.pixPackOk = (el) => run(async () => {
  const id = Number(el.dataset.v);
  await api(`/api/packages/${id}/pix-simulate`, { method: 'POST' });
  S.stack = [{ n: 'home' }];
  go('pacote', { id, ok: true });
}, el);

/* ================= tela do pacote ================= */
// Todas as sessões do pacote, com cancelamento sessão por sessão e "cancelar as próximas".
// O parâmetro é o id do pacote ou { id, ok: true } logo depois do pagamento (mostra "Pacote agendado!").
screen('pacote', {
  nav: 'agenda', width: 'mid',
  load: (p) => api(`/api/packages/${typeof p === 'object' ? p.id : p}`),
  view: (p, d) => {
    const pk = d.package;
    const isPro = S.user.role === 'pro';
    const fresh = typeof p === 'object' && p.ok;
    const now = d.now;
    const next = d.items.filter((a) => ['confirmed', 'pending_payment'].includes(a.status) && a.start >= now.slice(0, 10));
    const past = d.items.filter((a) => !next.includes(a));
    const first = next.find(canCancel);
    const rest = first ? next.filter((a) => a.start >= first.start) : [];
    const row = (a) => {
      const acts = [];
      if (a.room_open) acts.push(`<button class="btn btn-teal btn-sm" data-a="go" data-v="sessao" data-p="${a.id}">${ic('video')}Entrar</button>`);
      if (!isPro && a.status === 'done') acts.push(a.review_id ? `<span class="row small" style="gap:4px">${stars(a.review_rating)}</span>` : `<button class="btn btn-ghost btn-sm" data-a="go" data-v="avaliar" data-p="${a.id}">${ic('star')}Avaliar</button>`);
      if (a.status === 'confirmed' && canCancel(a)) acts.push(`<button class="btn btn-ghost btn-sm" data-a="packCancel" data-v="${a.id}">Cancelar</button>`);
      return `<div class="pk-row ${a.status === 'cancelled' ? 'is-off' : ''}">${dateBox(a.start)}
        <div class="grow"><b>${dayLabel(a.start.slice(0, 10))} · ${a.start.slice(11, 16)}</b><span>${brl2(isPro ? a.pro_amount : a.amount)}${isPro ? ' para você' : ''}${a.social ? ' · <em class="soc">vaga social</em>' : ''}${moved(pk, a) ? ' · horário alternativo' : ''}</span></div>
        ${STATUS[a.status] || ''}${acts.length ? `<div class="pk-act">${acts.join('')}</div>` : ''}</div>`;
    };
    const who = isPro ? pk.patient_name : pk.pro_name;
    return `<header class="bar gut">${fresh ? '' : backBtn()}<div class="bar-t"><div class="eyebrow">Pacote recorrente</div><h1 class="h1">${esc(who)}</h1></div></header>
    <main class="scroll gut">
      ${fresh ? `<div class="ok-wrap"><div class="ok-ring">${ic('check')}</div><h1 class="h1">Pacote agendado!</h1><p class="muted" style="margin:0;max-width:36ch">Pagamento aprovado. As ${pk.upcoming} sessões estão confirmadas, e ${esc(pk.pro_name.split(' ')[0])} recebeu o aviso. Os lembretes chegam antes de cada uma.</p></div>` : ''}
      <div class="two">
        <div class="col">
          ${pk.status === 'pending' ? `<div class="banner warn">${ic('clock')}<div><b>Aguardando o PIX</b><span>Os horários ficam reservados por 15 minutos.</span></div>${isPro ? '' : `<button class="btn btn-primary btn-sm" data-a="go" data-v="pixpacote" data-p="${pk.id}">Pagar</button>`}</div>` : ''}
          <section class="sec"><div class="sec-h"><h2 class="h2">Próximas sessões</h2><span class="small muted">${next.length}</span></div>
            ${next.length ? `<div class="pk-list">${next.map(row).join('')}</div>` : `<div class="card small muted">Nenhuma sessão por vir neste pacote.</div>`}</section>
          ${past.length ? `<section class="sec"><div class="sec-h"><h2 class="h2">Anteriores e canceladas</h2><span class="small muted">${past.length}</span></div><div class="pk-list">${past.slice().reverse().map(row).join('')}</div></section>` : ''}
        </div>
        <div class="col stick">
          <section class="card sum">
            <div class="row" style="margin-bottom:4px">${avatar(who, isPro ? '#3E8E7E' : pk.pro_color, 44)}<div class="grow"><b>${esc(who)}</b><div class="small muted">${isPro ? 'Paciente' : esc(pk.pro_title)}</div></div></div>
            <div class="sum-r"><span>Quando</span><b>${esc(pk.label)}</b></div>
            <div class="sum-r"><span>Duração</span><b>${pk.weeks} semanas · ${dm(pk.first)} a ${dm(pk.last)}</b></div>
            <div class="sum-r"><span>Atendimento</span><b>${pk.modality === 'online' ? 'Online (vídeo)' : 'Presencial'} · 50 min</b></div>
            <div class="sum-r"><span>Sessões</span><b>${pk.done} realizadas · ${pk.upcoming} por vir${pk.cancelled ? ` · ${pk.cancelled} canceladas` : ''}</b></div>
            <div class="sum-r sum-t"><span>${isPro ? 'Valor das sessões ativas' : 'Valor pago (PIX)'}</span><b class="total-big">${brl2(pk.active_amount)}</b></div>
            ${rest.length ? `<button class="btn btn-ghost btn-block" data-a="packCancelRest" data-v="${first.id}" data-n="${rest.length}" data-r="${dm(rest[0].start)} a ${dm(rest.at(-1).start)}">${ic('x')}Cancelar as próximas (${rest.length})</button>` : ''}
            <button class="btn btn-ghost btn-block" data-a="go" data-v="chat" data-p="${isPro ? pk.patient_id : pk.pro_id}">${ic('chat')}Mensagem</button>
            ${isPro ? '' : '<div class="small muted">Cancelamento grátis até 24 horas antes de cada sessão, com o valor devolvido.</div>'}
          </section>
        </div>
      </div>
      ${fresh ? notifyInvite('confirmado') : ''}
    </main>`;
  },
});

/* ================= cancelamento ================= */
// Recarrega a tela depois de um cancelamento. Na tela do pacote, o "Pacote agendado!" não aparece de novo.
function reload() {
  const t = top();
  if (t.n === 'pacote' && typeof t.p === 'object') t.p = t.p.id;
  refresh();
}
// Cancelar uma sessão de pacote: "só esta" ou "esta e as próximas". n e range descrevem as próximas.
export function openPackCancel(id, n, range) { openLayer('packCancel', { id, n, range }); }
LAYERS.packCancel = (l) => `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-label="Cancelar sessão do pacote">
  <div class="h2">Cancelar sessão do pacote</div>
  <p class="muted" style="margin:0">Esta sessão faz parte de um pacote recorrente. ${S.user.role === 'pro' ? 'O paciente recebe o aviso e o valor pago é devolvido.' : 'O valor pago é devolvido, e os horários voltam a ficar livres para outras pessoas.'}</p>
  <button class="btn btn-ghost btn-block" data-a="packCancelGo" data-v="one" autofocus>Cancelar só esta sessão</button>
  ${l.n > 1 ? `<button class="btn btn-danger btn-block" data-a="packCancelGo" data-v="all">Cancelar esta e as próximas (${l.n}, de ${esc(l.range)})</button>` : ''}
  <button class="btn btn-ghost btn-block" data-a="close">Voltar</button></div>`;
// Botão "Cancelar" de uma sessão na tela do pacote.
A.packCancel = (el) => {
  const d = top().d;
  const a = d.items.find((x) => x.id === Number(el.dataset.v));
  const rest = d.items.filter((x) => x.start >= a.start && ['confirmed', 'pending_payment'].includes(x.status));
  openPackCancel(a.id, rest.length, `${dm(rest[0].start)} a ${dm(rest.at(-1).start)}`);
};
A.packCancelGo = (el) => run(async () => {
  const following = el.dataset.v === 'all';
  const r = await api(`/api/appointments/${S.layer.id}/cancel`, { method: 'POST', body: { following } });
  closeLayer();
  toast(r.cancelled > 1 ? `${r.cancelled} sessões canceladas.` : 'Sessão cancelada.');
  reload();
}, el);
// "Cancelar as próximas", no resumo do pacote.
A.packCancelRest = (el) => confirmSheet({
  title: 'Cancelar as próximas sessões?',
  text: `${el.dataset.n} sessões, de ${el.dataset.r}, serão canceladas${S.user.role === 'pro' ? '. O paciente recebe o aviso e o valor pago é devolvido.' : ', com o valor devolvido. As sessões já realizadas não mudam.'}`,
  ok: 'Cancelar sessões', danger: true,
}, async () => {
  const r = await api(`/api/appointments/${el.dataset.v}/cancel`, { method: 'POST', body: { following: true } });
  closeLayer(); toast(`${r.cancelled} sessões canceladas.`); reload();
});

/* ================= agenda ================= */
// Junta as sessões do mesmo pacote: cada pacote vira um item só, na posição da primeira sessão dele.
export function groupByPackage(list, packages) {
  const out = [];
  const seen = new Map();
  for (const a of list) {
    const pk = a.package_id && packages?.[a.package_id];
    if (!pk) { out.push({ a }); continue; }
    if (!seen.has(pk.id)) { const g = { pk, items: [] }; seen.set(pk.id, g); out.push(g); }
    seen.get(pk.id).items.push(a);
  }
  return out;
}

// Cartão de um pacote na agenda do paciente (aba "Próximas" ou "Anteriores").
export function packCard(pk, items, tab) {
  const a = items[0];
  const total = pk.sessions - pk.cancelled;
  const pct = total ? Math.round((pk.done / total) * 100) : 0;
  const pending = items.some((x) => x.status === 'pending_payment');
  const toReview = tab === 'past' ? items.find((x) => x.status === 'done' && !x.review_id) : null;
  return `<section class="card pk-card"><div class="appt">${dateBox(a.start)}
    <div class="grow"><b>${esc(a.pro_name)}</b>
      <span class="pk-tag">${ic('repeat')}Pacote · ${esc(pk.label)}</span>
      <span>${ic('clock')}${tab === 'past' ? 'Última' : 'Próxima'}: ${when(a.start)}</span>
      <span>${ic(pk.modality === 'online' ? 'video' : 'pin')}${pk.modality === 'online' ? 'Online' : 'Presencial'}${a.social ? ' · <b style="color:var(--lav);font-weight:600;display:inline">vaga social</b>' : ''}</span></div>
    ${pending ? '<span class="pill warn">aguardando pagamento</span>' : a.room_open ? '<span class="live">sala aberta</span>' : ''}</div>
    <div class="pk-prog" role="img" aria-label="${pk.done} de ${total} sessões realizadas"><i style="width:${pct}%"></i></div>
    <div class="small muted">${pk.done} de ${total} realizadas · ${pk.upcoming} por vir</div>
    <div class="appt-act">${pending ? `<button class="btn btn-primary btn-sm" data-a="go" data-v="pixpacote" data-p="${pk.id}">${ic('pix')}Concluir pagamento</button><button class="btn btn-ghost btn-sm" data-a="packGiveUp" data-v="${a.id}">Desistir</button>`
      : `${a.room_open && tab !== 'past' ? `<button class="btn btn-teal btn-sm" data-a="go" data-v="sessao" data-p="${a.id}">${ic('video')}Entrar na sessão</button>` : ''}${toReview ? `<button class="btn btn-primary btn-sm" data-a="go" data-v="avaliar" data-p="${toReview.id}">${ic('star')}Avaliar sessão</button>` : ''}<button class="btn btn-ghost btn-sm" data-a="go" data-v="chat" data-p="${pk.pro_id}">${ic('chat')}Mensagem</button>`}
      <button class="btn btn-ghost btn-sm" data-a="go" data-v="pacote" data-p="${pk.id}">Ver as ${pk.sessions - pk.cancelled} sessões${ic('chevR')}</button></div></section>`;
}
// Desistir de um pacote que ainda aguarda o PIX (libera todos os horários).
A.packGiveUp = (el) => confirmSheet({ title: 'Desistir deste pacote?', text: 'Os horários reservados voltam a ficar livres para outras pessoas. Nada foi cobrado.', ok: 'Desistir', danger: true }, async () => {
  await api(`/api/appointments/${el.dataset.v}/cancel`, { method: 'POST', body: { following: true } });
  closeLayer(); toast('Pacote desfeito. Os horários foram liberados.'); refresh();
});

// Marca "recorrente" ao lado do paciente, na agenda do profissional; abre a tela do pacote.
export const recurTag = (pk) => (pk ? `<button class="tag lav tag-btn" data-a="go" data-v="pacote" data-p="${pk.id}" title="Pacote recorrente: ${esc(pk.label)}, ${pk.weeks} semanas">${ic('repeat')}recorrente</button>` : '');
