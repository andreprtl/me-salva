// Telas do profissional: painel, agenda, horários e vagas sociais, perfil e prontuário. Também a administração.
import {
  S, A, F, I, screen, api, run, replace, refresh, top, closeLayer, confirmSheet, toast,
  esc, ic, logoMark, avatar, backBtn, brl, brl2, nota, when, dayLabel, DOW, DOWL, chipCheck, toggle, $,
} from '../core.js';

const firstName = (n) => n.replace(/^Dra?\.\s*/, '').split(' ')[0];

/* ================= painel ================= */
// Painel do profissional: números do mês, ocupação, finanças, vagas sociais e sessões de hoje.
screen('painel', {
  tabs: true, nav: 'painel',
  load: () => api('/api/pro/dashboard'),
  view: (_, d) => {
    const p = d.pro;
    S.user.pro = p;
    const cur = d.occupancy.at(-1); const first = d.occupancy[0];
    const diff = d.sessions_month - d.sessions_prev;
    const now = new Date();
    return `<div class="topbar gut only-m"><div class="brand-mini">${logoMark(30)}ME SALVA <span class="tag teal" style="font-family:var(--f-body);letter-spacing:0">Pro</span></div><button class="me-av" data-a="tab" data-v="config" aria-label="Minha conta">${esc(firstName(S.user.name)[0])}</button></div>
    <header class="bar gut"><div class="bar-t"><div class="eyebrow">${DOWL[now.getDay()]}</div><h1 class="h1">Olá, ${esc(firstName(S.user.name))}</h1></div>${p.status === 'verified' ? `<span class="verif only-d">${ic('verified')}${esc(p.reg)} verificado</span>` : ''}</header>
    <main class="scroll gut">
      ${p.status === 'pending' ? `<div class="banner">${ic('clock')}<div><b>Seu registro está em verificação</b><span>Conferimos ${esc(p.reg)} no cadastro do conselho. Enquanto isso, complete seu perfil e seus horários; seu perfil aparece na busca assim que for aprovado.</span></div></div>` : ''}
      ${p.status === 'rejected' ? `<div class="banner warn">${ic('info')}<div><b>Não conseguimos confirmar seu registro</b><span>Confira o número em Meu perfil e fale com a equipe Me Salva.</span></div></div>` : ''}
      <section class="stats">
        <div class="stat"><span>Sessões no mês</span><b>${d.sessions_month}</b><em>${diff >= 0 ? '+' : ''}${diff} vs. mesmo período do mês passado</em></div>
        <div class="stat"><span>Agenda ocupada</span><b>${cur.pct}%</b><em>era ${first.pct}% em ${first.month}</em></div>
        <div class="stat"><span>Avaliação média</span><b>${nota(d.rating.avg)}</b><em>${d.rating.count} avaliações</em></div>
        <div class="stat"><span>Você recebeu no mês</span><b>${brl(Math.round(d.finance.net / 100) * 100)}</b><em>já descontados 12%</em></div>
      </section>
      <div class="pro-grid">
        <div class="col">
          <section class="card sec"><div class="sec-h"><h2 class="h2">Ocupação da agenda</h2><span class="small muted">últimos 6 meses</span></div>
            <div class="occ">${d.occupancy.map((o, i) => `<div class="occ-c ${i === d.occupancy.length - 1 ? 'last' : ''}" title="${o.used} de ${o.capacity} horários"><i style="height:${Math.max(4, o.pct)}%"><b>${o.pct}%</b></i><span>${o.month}</span></div>`).join('')}</div>
            <div class="sum"><div class="sum-r"><span>Sessões realizadas no mês</span><b>${d.finance.done}</b></div><div class="sum-r"><span>Valor das sessões</span><b>${brl2(d.finance.gross)}</b></div><div class="sum-r"><span>Comissão Me Salva (12%)</span><b>− ${brl2(d.finance.fee)}</b></div><div class="sum-r sum-t"><span>Você recebe</span><b>${brl2(d.finance.net)}</b></div></div></section>
          <section class="sec"><div class="sec-h"><h2 class="h2">Hoje</h2><button class="link" data-a="tab" data-v="proagenda">Ver agenda</button></div>
            ${d.today.length ? d.today.map((a) => `<div class="card appt"><div class="datebox" style="width:58px"><b style="font-size:15px">${a.start.slice(11)}</b></div><div class="grow"><b>${esc(a.patient_name)}</b><span>${ic(a.modality === 'online' ? 'video' : 'pin')}${a.modality === 'online' ? 'Online' : 'Presencial'}${a.social ? ' · <span class="soc">vaga social</span>' : ''}</span></div>
              ${a.room_open ? `<button class="btn btn-teal btn-sm" data-a="go" data-v="sessao" data-p="${a.id}">${ic('video')}Entrar</button>` : ''}<button class="icon-btn" data-a="go" data-v="prontuario" data-p="${a.patient_id}" aria-label="Prontuário de ${esc(a.patient_name)}">${ic('file')}</button></div>`).join('')
            : `<div class="card small muted">Nenhum atendimento confirmado para hoje. ${d.upcoming} sessões nos próximos dias.</div>`}
          </section>
        </div>
        <section class="card sec"><div class="sec-h"><h2 class="h2">Vagas sociais</h2>${p.is_new ? '<span class="soc">recém-formado</span>' : ''}</div>
          ${p.is_new && p.supervisor ? `<p class="small muted" style="margin:0">Horários com valor acessível para famílias que precisam de alta frequência. ${esc(p.supervisor)}.</p>
            <dl class="kv"><dt>Valor da vaga social</dt><dd>${p.social_price ? brl(p.social_price) : 'não definido'}</dd><dt>Vagas fixas por semana</dt><dd>${p.social_weekly}</dd><dt>Preencher horários vagos</dt><dd>${p.auto_fill ? 'ligado (24 h antes)' : 'desligado'}</dd><dt>Sessões sociais no mês</dt><dd>${d.social.count} · ${brl2(d.social.net)} recebidos</dd></dl>
            ${d.social_estimate ? `<div class="est"><div><span>Sessões extras / mês</span><b>+${d.social_estimate.sessions}</b></div><div><span>Renda extra estimada</span><b>${brl(d.social_estimate.net)}</b></div></div>` : ''}
            <button class="btn btn-ghost btn-block" data-a="tab" data-v="horarios">${ic('sliders')}Ajustar vagas sociais</button>`
          : `<p class="small muted" style="margin:0">Vagas sociais são para profissionais recém-formados com supervisão clínica. Se for o seu caso, marque isso em Meu perfil.</p><button class="btn btn-ghost btn-block" data-a="tab" data-v="properfil">Abrir meu perfil</button>`}
        </section>
      </div>
    </main>`;
  },
});

/* ================= agenda do profissional ================= */
S.proTab = 'up';
// Agenda do profissional: próximas sessões e histórico, com marcar como realizada, falta ou cancelar.
screen('proagenda', {
  tabs: true, nav: 'proagenda',
  load: () => api('/api/appointments'),
  view: (_, d) => {
    const list = S.proTab === 'up' ? d.upcoming.filter((a) => a.status === 'confirmed') : d.past;
    const started = (a) => a.start <= d.now;
    const groups = {};
    for (const a of list) (groups[a.start.slice(0, 10)] ||= []).push(a);
    const status = { done: '<span class="pill ok">realizada</span>', no_show: '<span class="pill warn">falta</span>', confirmed: '<span class="pill lav">confirmada</span>' };
    return `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Profissional</div><h1 class="h1">Agenda</h1></div><button class="btn btn-ghost btn-sm" data-a="tab" data-v="horarios">${ic('clock')}Meus horários</button></header>
    <div class="gut" style="padding-bottom:12px;flex:none"><div class="seg" style="max-width:420px"><button class="${S.proTab === 'up' ? 'on' : ''}" data-a="proTab" data-v="up">Próximas</button><button class="${S.proTab === 'past' ? 'on' : ''}" data-a="proTab" data-v="past">Histórico</button></div></div>
    <main class="scroll gut">${Object.keys(groups).length ? Object.entries(groups).slice(0, 30).map(([day, items]) => `<section class="sec"><div class="lbl">${dayLabel(day)}</div><div class="list">${items.map((a) => `<div class="li static" style="flex-wrap:wrap">
        <b class="num" style="width:46px">${a.start.slice(11)}</b>
        <div class="li-t"><b>${esc(a.patient_name)}</b><span>${a.modality === 'online' ? 'Online' : 'Presencial'} · ${a.social ? 'vaga social · ' : ''}${brl2(a.pro_amount)} para você</span></div>
        ${S.proTab === 'past' ? status[a.status] || '' : ''}
        ${S.proTab === 'up' ? `<div class="row" style="gap:6px;flex-wrap:wrap">
          ${a.room_open ? `<button class="btn btn-teal btn-sm" data-a="go" data-v="sessao" data-p="${a.id}">${ic('video')}Entrar</button>` : ''}
          ${started(a) || S.meta.demoMode ? `<button class="btn btn-ghost btn-sm" data-a="markDone" data-v="${a.id}">${ic('check')}Realizada</button><button class="btn btn-ghost btn-sm" data-a="markNoShow" data-v="${a.id}">Falta</button>` : ''}
          <button class="icon-btn" data-a="go" data-v="chat" data-p="${a.patient_id}" aria-label="Mensagem">${ic('chat')}</button>
          <button class="icon-btn" data-a="go" data-v="prontuario" data-p="${a.patient_id}" aria-label="Prontuário">${ic('file')}</button>
          <button class="icon-btn" data-a="proCancel" data-v="${a.id}" aria-label="Cancelar sessão">${ic('x')}</button></div>`
        : `<button class="icon-btn" data-a="go" data-v="prontuario" data-p="${a.patient_id}" aria-label="Prontuário">${ic('file')}</button>`}
      </div>`).join('')}</div></section>`).join('')
      : `<div class="empty">${ic('cal')}<div>${S.proTab === 'up' ? 'Nenhuma sessão marcada. Confira se seus horários estão abertos.' : 'Ainda não há histórico.'}</div></div>`}</main>`;
  },
});
A.proTab = (el) => { S.proTab = el.dataset.v; replace('proagenda'); };
A.markDone = (el) => run(async () => { await api(`/api/appointments/${el.dataset.v}/finish`, { method: 'POST' }); toast('Sessão marcada como realizada. O paciente já pode avaliar.'); refresh(); }, el);
A.markNoShow = (el) => run(async () => { await api(`/api/appointments/${el.dataset.v}/no-show`, { method: 'POST' }); toast('Falta registrada.'); refresh(); }, el);
A.proCancel = (el) => confirmSheet({ title: 'Cancelar esta sessão?', text: 'O paciente recebe um aviso no chat e o valor pago é devolvido.', ok: 'Cancelar sessão', danger: true }, async () => {
  await api(`/api/appointments/${el.dataset.v}/cancel`, { method: 'POST' }); closeLayer(); toast('Sessão cancelada e paciente avisado.'); refresh();
});

/* ================= horários e vagas sociais ================= */
// Dias na ordem da grade: segunda a domingo.
const WD = [1, 2, 3, 4, 5, 6, 0];
// Grade de disponibilidade semanal e configuração das vagas sociais.
screen('horarios', {
  tabs: true, nav: 'horarios',
  load: () => api('/api/pro/profile'),
  after: (_, d) => { S.av = new Set(d.availability.map((a) => `${a.weekday}|${a.hour}`)); const p = d.pro; S.soc = { price: (p.social_price || 4500) / 100, weekly: p.social_weekly, auto: p.auto_fill }; paintHorarios(); },
  view: () => `<div class="loading"><span class="spin"></span></div>`,
});
// Redesenha a tela mantendo as marcações ainda não salvas (S.av e S.soc).
function paintHorarios() {
  const d = top().d; const p = d.pro; const sc = S.soc;
  const net = Math.round(sc.weekly * 4 * sc.price * 100 * 0.88);
  $('#screen').innerHTML = `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Profissional</div><h1 class="h1">Horários e vagas sociais</h1></div></header>
  <main class="scroll gut">
    <section class="sec"><div class="sec-h"><h2 class="h2">Disponibilidade semanal</h2><span class="small muted">${S.av.size} horários por semana</span></div>
      <p class="small muted" style="margin:0">Toque nos horários em que você atende. Sessões de 50 minutos começando na hora cheia.</p>
      <div class="avail"><table><thead><tr><th></th>${WD.map((w) => `<th>${DOW[w]}</th>`).join('')}</tr></thead><tbody>
        ${d.hours.map((h) => `<tr><th class="h">${h}</th>${WD.map((w) => `<td><button class="${S.av.has(`${w}|${h}`) ? 'on' : ''}" data-a="avTog" data-v="${w}|${h}" aria-label="${DOW[w]} ${h}" aria-pressed="${S.av.has(`${w}|${h}`)}">${S.av.has(`${w}|${h}`) ? 'livre' : ''}</button></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <button class="btn btn-primary" data-a="avSave" style="align-self:flex-start">Salvar disponibilidade</button>
    </section>
    <section class="card sec"><div class="sec-h"><h2 class="h2">Vagas sociais</h2>${p.is_new ? '<span class="soc">recém-formado</span>' : ''}</div>
      ${p.is_new && p.supervisor ? `<p class="small muted" style="margin:0">As primeiras vagas de cada semana saem pelo valor social. Você define o valor (de R$ 40 a R$ 80) e a plataforma oferece as vagas a famílias compatíveis.</p>
        <div class="row"><div class="grow"><b>Vagas fixas por semana</b><div class="small muted">contadas de segunda a domingo</div></div><div class="stepper"><button data-a="socStep" data-v="-1" aria-label="Menos">−</button><b>${sc.weekly}</b><button data-a="socStep" data-v="1" aria-label="Mais">+</button></div></div>
        <div class="field"><label for="socPrice">Valor da vaga social: <b style="color:var(--ink)" id="socPriceL">${brl(sc.price * 100)}</b> (sua sessão: ${brl(p.price)})</label><input type="range" id="socPrice" data-i="socPrice" min="40" max="${Math.min(80, p.price / 100 - 5)}" step="5" value="${sc.price}"></div>
        <div class="row"><div class="grow"><b>Preencher horários vagos</b><div class="small muted">Horário livre nas próximas 24 h vira vaga social</div></div>${toggle('socAuto', sc.auto, 'Preencher horários vagos')}</div>
        <div class="est"><div><span>Sessões extras / mês</span><b>+${sc.weekly * 4}</b></div><div><span>Renda extra estimada</span><b id="socNet">${brl(net)}</b></div></div>
        <div class="disclaimer">${ic('info')}<span>${esc(p.supervisor)}. A estimativa já desconta a comissão de 12%.</span></div>
        <button class="btn btn-primary" data-a="socSave" style="align-self:flex-start">Salvar vagas sociais</button>`
      : `<p class="small muted" style="margin:0">Vagas sociais são para recém-formados com supervisão clínica cadastrada. Marque isso em Meu perfil para liberar.</p>`}
    </section>
  </main>`;
}
A.avTog = (el) => { const k = el.dataset.v; if (S.av.has(k)) S.av.delete(k); else S.av.add(k); const sc = $('.scroll')?.scrollTop; const av = $('.avail')?.scrollLeft; paintHorarios(); $('.scroll').scrollTop = sc; $('.avail').scrollLeft = av; };
A.avSave = (el) => run(async () => {
  const slots = [...S.av].map((k) => { const [w, h] = k.split('|'); return { weekday: Number(w), hour: h }; });
  await api('/api/pro/availability', { method: 'PUT', body: { slots } }); toast('Disponibilidade salva. Os novos horários já aparecem para os pacientes.');
}, el);
const repaintKeep = () => { const sc = $('.scroll')?.scrollTop; paintHorarios(); $('.scroll').scrollTop = sc; };
A.socStep = (el) => { S.soc.weekly = Math.max(0, Math.min(12, S.soc.weekly + Number(el.dataset.v))); repaintKeep(); };
A.socAuto = () => { S.soc.auto = !S.soc.auto; repaintKeep(); };
I.socPrice = (el) => {
  S.soc.price = Number(el.value);
  $('#socPriceL').textContent = brl(S.soc.price * 100);
  $('#socNet').textContent = brl(Math.round(S.soc.weekly * 4 * S.soc.price * 100 * 0.88));
};
A.socSave = (el) => run(async () => {
  const r = await api('/api/pro/social', { method: 'PUT', body: { social_price: S.soc.price, social_weekly: S.soc.weekly, auto_fill: S.soc.auto } });
  top().d.pro = r.pro; S.user.pro = r.pro; toast('Vagas sociais atualizadas.');
}, el);

/* ================= meu perfil ================= */
// Perfil público do profissional (como aparece na busca).
screen('properfil', {
  tabs: true, nav: 'properfil', width: 'mid',
  load: () => api('/api/pro/profile'),
  view: (_, d) => {
    const p = d.pro; const m = S.meta;
    return `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Profissional</div><h1 class="h1">Meu perfil</h1></div>${p.status === 'verified' ? `<button class="btn btn-ghost btn-sm" data-a="go" data-v="perfil" data-p="${p.id}">${ic('eye')}Ver como paciente</button>` : ''}</header>
    <main class="scroll gut"><form class="form" data-f="proPerfil" novalidate>
      <section class="card form">
        <div class="row">${avatar(p.name, p.color, 56)}<div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(p.reg)} · ${p.status === 'verified' ? 'verificado' : p.status === 'pending' ? 'em verificação' : 'não confirmado'}</div></div></div>
        <div class="grid2">
          <div class="field"><label for="ppTitle">Título</label><input class="input" id="ppTitle" name="title" value="${esc(p.title)}"></div>
          <div class="field"><label for="ppAppr">Abordagem</label><input class="input" id="ppAppr" name="approach" value="${esc(p.approach)}"></div>
          <div class="field"><label for="ppShort">Abordagem resumida (aparece na busca)</label><input class="input" id="ppShort" name="approach_short" maxlength="30" value="${esc(p.approach_short)}"></div>
          <div class="field"><label for="ppBairro">Bairro do consultório</label><select class="input" id="ppBairro" name="bairro">${m.bairroNames.map((b) => `<option ${b === p.bairro ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
          <div class="field"><label for="ppPrice">Valor da sessão (R$)</label><input class="input" id="ppPrice" name="price" type="number" min="40" max="1000" step="5" value="${p.price / 100}"></div>
          <div class="field"><label for="ppYears">Anos de experiência</label><input class="input" id="ppYears" name="years" type="number" min="0" max="60" value="${p.years}"></div>
        </div>
        <div class="field"><label for="ppBio">Apresentação</label><textarea class="input" id="ppBio" name="bio" maxlength="800">${esc(p.bio)}</textarea></div>
      </section>
      <section class="card form">
        <div class="field"><span class="lbl">Temas</span><div class="chips">${m.topics.map((t) => chipCheck('topics', t, t, p.topics.includes(t))).join('')}</div></div>
        <div class="field"><span class="lbl">Público</span><div class="chips">${m.audiences.map((t) => chipCheck('audience', t, t, p.audience.includes(t))).join('')}</div></div>
        <div class="field"><span class="lbl">Modalidade</span><div class="chips">${chipCheck('modalities', 'online', 'Online', p.modalities.includes('online'))}${chipCheck('modalities', 'presencial', 'Presencial', p.modalities.includes('presencial'))}</div></div>
        <label class="check"><input type="checkbox" name="is_new" ${p.is_new ? 'checked' : ''}><span><b style="color:var(--ink)">Sou recém-formado(a) com supervisão clínica</b> (libera as vagas sociais)</span></label>
        <div class="field"><label for="ppSup">Supervisor(a) clínico(a)</label><input class="input" id="ppSup" name="supervisor" value="${esc(p.supervisor || '')}" placeholder="Nome (CRP 06/000000)"></div>
      </section>
      <div class="form-error" id="ppErr" role="alert"></div>
      <button class="btn btn-primary" type="submit" style="align-self:flex-start">Salvar perfil</button>
    </form></main>`;
  },
});
F.proPerfil = (form) => run(async () => {
  const fd = new FormData(form);
  $('#ppErr').textContent = '';
  try {
    const r = await api('/api/pro/profile', { method: 'PUT', body: {
      title: fd.get('title'), approach: fd.get('approach'), approach_short: fd.get('approach_short'), bairro: fd.get('bairro'),
      price: Number(fd.get('price')), years: Number(fd.get('years')), bio: fd.get('bio'),
      topics: fd.getAll('topics'), audience: fd.getAll('audience'), modalities: fd.getAll('modalities'),
      is_new: fd.get('is_new') === 'on', supervisor: fd.get('supervisor'),
    } });
    S.user.pro = r.pro; toast('Perfil atualizado.'); refresh();
  } catch (e) { $('#ppErr').textContent = e.message; }
}, form.querySelector('[type=submit]'));

/* ================= prontuário ================= */
// Prontuário de um paciente: anotações criptografadas no servidor e histórico de sessões.
screen('prontuario', {
  nav: 'proagenda', width: 'mid',
  load: (pid) => api(`/api/pro/patients/${pid}/notes`),
  view: (pid, d) => `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Prontuário</div><h1 class="h1">${esc(d.patient.name)}</h1></div><button class="btn btn-ghost btn-sm" data-a="go" data-v="chat" data-p="${pid}">${ic('chat')}<span class="only-d">Mensagem</span></button></header>
  <main class="scroll gut"><div class="two">
    <div class="col">
      <div class="banner ok">${ic('lock')}<div><b>Anotações criptografadas</b><span>Cada nota é guardada com criptografia AES-256-GCM e só você pode ler. Todo acesso fica registrado.</span></div></div>
      <form class="card form" data-f="note"><div class="field"><label for="noteIn">Nova anotação de evolução</label><textarea class="input" id="noteIn" name="text" maxlength="5000" placeholder="Objetivos trabalhados, respostas observadas, orientações à família…"></textarea></div><button class="btn btn-primary" type="submit" style="align-self:flex-start">Salvar anotação</button></form>
      <section class="sec"><h2 class="h2">Anotações (${d.notes.length})</h2>${d.notes.length ? d.notes.map((n) => `<div class="note"><small>${new Date(n.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>${esc(n.text)}</div>`).join('') : '<div class="small muted">Nenhuma anotação ainda.</div>'}</section>
    </div>
    <section class="card sec stick"><h2 class="h2">Sessões</h2><div class="list" style="border:0">${d.history.map((a) => `<div class="li static" style="padding:10px 0"><div class="li-t"><b>${when(a.start)}</b><span>${a.modality === 'online' ? 'Online' : 'Presencial'}${a.social ? ' · vaga social' : ''}</span></div><span class="pill ${a.status === 'done' ? 'ok' : a.status === 'no_show' ? 'warn' : 'lav'}">${a.status === 'done' ? 'realizada' : a.status === 'no_show' ? 'falta' : 'confirmada'}</span></div>`).join('')}</div></section>
  </div></main>`,
});
F.note = (form) => run(async () => {
  const text = new FormData(form).get('text');
  await api(`/api/pro/patients/${top().p}/notes`, { method: 'POST', body: { text } });
  toast('Anotação salva com criptografia.'); refresh();
}, form.querySelector('[type=submit]'));

/* ================= administração ================= */
// Administração: indicadores, verificação de registros e restauração dos dados de demonstração.
screen('admin', {
  tabs: true, nav: 'admin',
  load: () => api('/api/admin/overview'),
  view: (_, d) => `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Administração</div><h1 class="h1">Visão geral da plataforma</h1></div></header>
  <main class="scroll gut">
    <section class="stats">
      <div class="stat"><span>Pacientes cadastrados</span><b>${d.patients}</b><em>${d.plus_subscribers} assinam o Me Salva+</em></div>
      <div class="stat"><span>Profissionais verificados</span><b>${d.pros_verified}</b><em>${d.pending.length} aguardando</em></div>
      <div class="stat"><span>Sessões no mês</span><b>${d.sessions_month}</b><em>${d.social_month} vagas sociais</em></div>
      <div class="stat"><span>Receita da plataforma (mês)</span><b>${brl(Math.round(d.revenue_month / 100) * 100)}</b><em>sobre ${brl(Math.round(d.gmv_month / 100) * 100)} em sessões</em></div>
    </section>
    <section class="sec"><div class="sec-h"><h2 class="h2">Verificação de registros</h2><a class="link" href="https://cadastro.cfp.org.br/" target="_blank" rel="noopener">Consultar cadastro do CFP ${ic('external')}</a></div>
      ${d.pending.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Profissional</th><th>Registro</th><th>Área</th><th>Supervisão</th><th></th></tr></thead><tbody>
        ${d.pending.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.title)} · ${esc(p.bairro)}</div></td><td>${esc(p.reg)}</td><td>${esc(S.meta.areas.find((a) => a.id === p.area)?.nome || p.area)}</td><td class="small">${p.is_new ? esc(p.supervisor) : '—'}</td>
          <td><div class="row" style="gap:6px;justify-content:flex-end"><button class="btn btn-teal btn-sm" data-a="verify" data-v="${p.id}" data-d="verified">${ic('check')}Aprovar</button><button class="btn btn-ghost btn-sm" data-a="verify" data-v="${p.id}" data-d="rejected">Recusar</button></div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card small muted">Nenhum cadastro aguardando verificação.</div>`}
    </section>
    <section class="card sec"><h2 class="h2">Modelo de receita</h2><dl class="kv"><dt>Comissão por sessão</dt><dd>12% do valor, descontados do profissional</dd><dt>Me Salva+ (pacientes)</dt><dd>R$ 19,90/mês, com 10% de desconto custeado pela plataforma</dd><dt>Triagens realizadas</dt><dd>${d.triages_total}</dd></dl></section>
    ${d.demo_mode ? `<section class="card sec"><h2 class="h2">Dados de demonstração</h2><p class="small muted" style="margin:0">Apaga tudo e recria as contas e o histórico fictícios, com sessões para hoje. Use antes de cada apresentação.</p><button class="btn btn-ghost" data-a="resetDemo" style="align-self:flex-start">${ic('refresh')}Restaurar dados de demonstração</button></section>` : ''}
  </main>`,
});
// Aprova ou recusa o registro de um profissional pendente.
A.verify = (el) => run(async () => {
  await api(`/api/admin/pros/${el.dataset.v}/verify`, { method: 'POST', body: { decision: el.dataset.d } });
  toast(el.dataset.d === 'verified' ? 'Registro aprovado. O perfil já aparece na busca.' : 'Cadastro recusado.'); refresh();
}, el);
A.resetDemo = () => confirmSheet({ title: 'Restaurar dados de demonstração?', text: 'Todos os dados atuais serão apagados e as contas fictícias recriadas. Você precisará entrar de novo.', ok: 'Restaurar', danger: true }, async () => {
  await api('/api/admin/reset-demo', { method: 'POST' });
  closeLayer(); S.user = null; location.reload();
});

