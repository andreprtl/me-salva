// Telas do paciente: início, busca, perfil, agendamento, pagamento, agenda, triagem, avaliação e planos.
import {
  S, A, F, I, LAYERS, SCREENS, screen, api, run, go, back, tab, replace, refresh, top, every, openLayer, closeLayer,
  confirmSheet, toast, esc, ic, logoMark, avatar, stars, backBtn, brl, brl2, nota, km, when, dayLabel, dateBox,
  DOW, DOWL, MES, areaName, toggle, copyText, $,
} from '../core.js';
import { wide } from './common.js';

// Filtros da busca (S.f), mantidos enquanto o paciente navega.
const freshFilters = () => ({ area: null, q: '', modality: 'todos', max: 300, social: false, sort: 'rel' });
S.f = freshFilters();
S.view = 'lista';
S.sel = null;

/* ================= início ================= */
// Início do paciente: próxima sessão, atalhos e profissionais em destaque.
screen('home', {
  tabs: true, nav: 'home',
  load: () => api('/api/appointments'),
  view: (_, d) => {
    const nx = d.upcoming.find((a) => a.status === 'confirmed');
    const now = new Date();
    const shorts = [
      ['tea', 'puzzle', 'Triagem TEA/ABA', 'Entenda o que seu filho precisa em 5 passos.', 'Começar', 'lav'],
      ['geral', 'couch', 'Terapia geral', 'Psicólogos para o dia a dia.', 'Ver profissionais', ''],
      ['ans', 'heart', 'Ansiedade', 'Especialistas em crises e preocupação.', 'Ver profissionais', ''],
      ['casal', 'users', 'Casal e família', 'Comunicação e conflitos.', 'Ver profissionais', ''],
      ['perto', 'pin', 'Perto de você', 'Atendimento presencial no mapa.', 'Abrir mapa', ''],
    ];
    const first = S.user.name.split(' ')[0];
    return `<div class="topbar gut only-m">
      <button class="icon-btn plain" data-a="drawer" aria-label="Abrir menu">${ic('menu')}</button>
      <div class="brand-mini">${logoMark(30)}ME SALVA</div>
      <button class="icon-btn plain" data-a="tab" data-v="chats" aria-label="Mensagens">${ic('chat')}${S.unread ? `<span class="badge">${S.unread}</span>` : ''}</button>
      <button class="me-av" data-a="tab" data-v="config" aria-label="Minha conta">${esc(first[0])}</button>
    </div>
    <header class="bar gut only-d"><div class="bar-t"><div class="eyebrow">${DOWL[now.getDay()]}, ${now.getDate()} de ${MES[now.getMonth()]}</div><h1 class="h1">Olá, ${esc(first)}</h1></div><button class="btn btn-ghost btn-sm" data-a="tab" data-v="chats">${ic('chat')}Mensagens${S.unread ? ` (${S.unread})` : ''}</button></header>
    <main class="scroll gut">
      <div class="home-grid">
        <section class="hero">${logoMark(84)}
          <div class="hero-hi">Que bom ter você aqui, ${esc(first)}</div>
          <h1>ME SALVA</h1>
          <p>Encontre o profissional certo para você ou para quem você cuida, com preço justo e agendamento em 3 cliques.</p>
          <div class="hero-btns"><button class="btn btn-cream" data-a="tab" data-v="areas">Encontrar profissional</button><button class="btn btn-line" data-a="tri">Fazer triagem</button></div>
        </section>
        <div class="home-side">
          ${nx ? `<section class="card next">${dateBox(nx.start)}
            <div class="grow"><div class="eyebrow">Próxima sessão</div><b>${esc(nx.pro_name)}</b><div class="small muted">${when(nx.start)} · ${nx.modality === 'online' ? 'Online' : 'Presencial'}</div></div>
            ${nx.room_open ? `<button class="btn btn-teal btn-sm" data-a="go" data-v="sessao" data-p="${nx.id}">${ic('video')}Entrar</button>` : `<button class="btn btn-ghost btn-sm" data-a="tab" data-v="agenda">Ver</button>`}
          </section>` : `<section class="card next"><span class="s-ic">${ic('cal')}</span><div class="grow"><b>Nenhuma sessão marcada</b><div class="small muted">Faça a triagem ou busque um profissional.</div></div></section>`}
          <button class="promo" data-a="short" data-v="social">${ic('sparkle')}<div><b>Vagas sociais a partir de R$ 40</b><span>Profissionais recém-formados, com supervisão clínica, abrem horários com valor acessível.</span></div></button>
          <button class="crisis only-m" data-a="crise">${ic('lifebuoy')}<div><b>Precisa de ajuda agora?</b><span>CVV: ligue 188, 24 horas, gratuito.</span></div></button>
          ${S.user.plan !== 'plus' ? `<button class="nudge only-d" data-a="tab" data-v="planos">${ic('crown')}<div class="grow"><b>Me Salva+</b> · 10% de desconto em todas as sessões por R$ 19,90/mês.</div>${ic('chevR')}</button>` : ''}
        </div>
      </div>
      <section class="sec">
        <div class="sec-h"><h2 class="h2">Atalhos</h2><div class="car-btns only-m"><button class="icon-btn" data-a="car" data-v="l" aria-label="Anterior">${ic('chevL')}</button><button class="icon-btn" data-a="car" data-v="r" aria-label="Próximo">${ic('chevR')}</button></div></div>
        <div class="strip" id="strip">${shorts.map((s) => `<button class="short ${s[5]}" data-a="short" data-v="${s[0]}"><span class="s-ic">${ic(s[1])}</span><b>${s[2]}</b><span>${s[3]}</span><i>${s[4]}${ic('arrowR')}</i></button>`).join('')}</div>
      </section>
    </main>`;
  },
});
A.car = (el) => $('#strip')?.scrollBy({ left: (el.dataset.v === 'r' ? 1 : -1) * 164, behavior: 'smooth' });
// Atalhos da tela inicial (triagem, TEA/ABA, vagas sociais).
A.short = (el) => {
  const v = el.dataset.v;
  S.f = freshFilters(); S.view = 'lista'; S.sel = null;
  if (v === 'tea') { startTri('filho'); go('triagem'); return; }
  if (v === 'geral') S.f.area = 'psicologo';
  if (v === 'ans') S.f.q = 'Ansiedade';
  if (v === 'casal') S.f.q = 'casal';
  if (v === 'perto') { S.view = 'mapa'; S.f.modality = 'presencial'; S.f.sort = 'perto'; }
  if (v === 'social') S.f.social = true;
  if (S.user.role === 'patient') go('busca');
};

/* ================= áreas ================= */
// Escolha da área antes da lista de profissionais.
screen('areas', {
  tabs: true, nav: 'areas',
  view: () => `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Buscar</div><h1 class="h1">Que profissional você procura?</h1></div></header>
  <main class="scroll gut">
    <div class="areas">${S.meta.areas.map((a) => `<button class="area ${a.id === 'aba' ? 'lav' : ''}" data-a="area" data-v="${a.id}"><span class="s-ic">${ic(a.ic)}</span><b>${esc(a.nome)}</b><span>${esc(a.desc)}</span><em>Ver profissionais</em></button>`).join('')}</div>
    <div class="two" style="gap:12px"><button class="tri-cta" data-a="tri">${ic('sparkle')}<div class="grow"><b>Não sabe por onde começar?</b><span>Responda a triagem gratuita e receba indicações compatíveis.</span></div>${ic('chevR')}</button>
    <button class="btn btn-ghost" style="min-height:64px" data-a="area" data-v="">Ver todos os profissionais</button></div>
  </main>`,
});
A.area = (el) => { S.f = { ...freshFilters(), area: el.dataset.v || null }; S.sel = null; go('busca'); };

/* ================= busca ================= */
// Monta a URL de /api/pros a partir dos filtros atuais.
const query = () => {
  const f = S.f; const p = new URLSearchParams();
  if (f.area) p.set('area', f.area);
  if (f.q) p.set('q', f.q);
  if (f.modality !== 'todos') p.set('modality', f.modality);
  if (f.max < 300) p.set('max', f.max);
  if (f.social) p.set('social', '1');
  p.set('sort', f.sort);
  return '/api/pros?' + p;
};
// Cartão de profissional na lista.
function pcard(p) {
  return `<button class="pcard ${S.sel === p.id ? 'hl' : ''}" data-a="go" data-v="perfil" data-p="${p.id}">
    ${avatar(p.name, p.color, 56)}
    <div class="pc-main">
      <div class="pc-name">${esc(p.name)}${ic('verified')}</div>
      <div class="pc-sub">${esc(p.title)} · ${esc(p.approach_short)}</div>
      <div class="tags">${p.topics.slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="pc-meta">${p.modalities.includes('online') ? `<span>${ic('video')}Online</span>` : ''}${p.modalities.includes('presencial') ? `<span>${ic('pin')}${km(p.distance)}</span>` : ''}${p.next_slot ? `<span>${ic('clock')}${when(p.next_slot)}</span>` : '<span>Sem horários</span>'}</div>
    </div>
    <div class="pc-side"><div class="rate">${ic('star', 'fill gstar')}${nota(p.rating)}</div><div class="price">${brl(p.price)}<small>/sessão</small></div>${p.social_free ? `<span class="soc">Social ${brl(p.social_price)}</span>` : ''}</div>
  </button>`;
}
// Mapa esquemático de São Paulo com um marcador por profissional (posições em shared/data.js).
function mapHtml(list, withCard) {
  const me = S.meta.bairros[S.user.bairro] || [48, 50];
  const pt = (xy) => `left:${xy[0]}%;top:${(xy[1] + 6) / 112 * 100}%`;
  const sel = list.find((p) => p.id === S.sel);
  const lbls = [['Pinheiros', 29, 47], ['Centro', 51, 39], ['Mooca', 66, 57], ['Santana', 50, 14], ['Moema', 47, 79], ['Butantã', 13, 64], ['Penha', 83, 28]];
  return `<div class="map" role="img" aria-label="Mapa com profissionais que atendem presencialmente">
    <svg viewBox="0 0 100 112" preserveAspectRatio="none" aria-hidden="true">
      <rect width="100" height="112" fill="var(--map)"/>
      <ellipse cx="55" cy="74" rx="8" ry="5.5" fill="var(--park)"/><ellipse cx="22" cy="40" rx="5" ry="3.5" fill="var(--park)"/><ellipse cx="72" cy="92" rx="6" ry="4" fill="var(--park)"/>
      <g stroke="var(--road)" fill="none" stroke-linecap="round"><path d="M0 52 L100 46" stroke-width="2"/><path d="M50 0 L46 112" stroke-width="2"/><path d="M5 95 L95 15" stroke-width="1.4"/><path d="M8 20 L92 98" stroke-width="1.2"/><path d="M0 75 Q50 64 100 72" stroke-width="1"/><path d="M28 0 Q32 60 22 112" stroke-width="1"/><path d="M72 0 Q66 50 78 112" stroke-width="1"/><path d="M0 34 Q50 40 100 30" stroke-width="1"/></g>
      <path d="M0 27 C18 21 34 30 52 25 S82 18 100 23" stroke="var(--river)" stroke-width="3" fill="none"/>
      <path d="M30 26 C27 50 33 75 37 112" stroke="var(--river)" stroke-width="2.4" fill="none"/>
    </svg>
    ${lbls.map((l) => `<span class="map-lbl" style="left:${l[1]}%;top:${l[2]}%">${l[0]}</span>`).join('')}
    <span class="me-dot" style="${pt(me)}" title="Você (${esc(S.user.bairro)})"></span>
    ${list.filter((p) => p.modalities.includes('presencial')).map((p) => `<button class="pin ${p.id === S.sel ? 'on' : ''} ${p.social_free ? 'soc' : ''}" style="${pt(p.map)}" data-a="pin" data-v="${p.id}" aria-label="${esc(p.name)}">${brl(p.eff_price)}</button>`).join('')}
    ${withCard && sel ? `<div class="map-card">${pcard(sel)}</div>` : ''}
  </div>`;
}
function results(list) {
  const W = wide();
  const onlyOnline = list.filter((p) => !p.modalities.includes('presencial')).length;
  const sortSel = `<select class="sortsel" data-i="sort" aria-label="Ordenar">${[['rel', 'Mais relevantes'], ['nota', 'Melhor avaliados'], ['preco', 'Menor preço'], ['perto', 'Mais perto']].map((o) => `<option value="${o[0]}" ${S.f.sort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  const h = `<div class="sec-h"><span class="count num">${list.length} ${list.length === 1 ? 'profissional encontrado' : 'profissionais encontrados'}</span>${W || S.view === 'lista' ? sortSel : ''}</div>`;
  if (!list.length) return h + `<div class="empty">${ic('search')}<div>Nenhum profissional com esses filtros.</div><button class="btn btn-ghost btn-sm" data-a="clearF">Limpar filtros</button></div>`;
  const note = `<div class="small muted">Toque em um valor no mapa para destacar o profissional.${onlyOnline ? ` ${onlyOnline} atende${onlyOnline > 1 ? 'm' : ''} só online e não aparece${onlyOnline > 1 ? 'm' : ''} no mapa.` : ''} Contorno lilás indica vaga social.</div>`;
  if (W) return h + `<div class="res-split"><div class="res-list">${list.map(pcard).join('')}</div><div class="res-map">${mapHtml(list, false)}${note}</div></div>`;
  if (S.view === 'mapa') return h + mapHtml(list, true) + note;
  return h + `<div class="res-list">${list.map(pcard).join('')}</div>`;
}
function fchips() {
  const f = S.f; const c = [];
  if (f.modality !== 'todos') c.push(['modality', f.modality === 'online' ? 'Online' : 'Presencial']);
  if (f.max < 300) c.push(['max', 'Até ' + brl(f.max * 100)]);
  if (f.social) c.push(['social', 'Vaga social']);
  if (f.q) c.push(['q', '“' + f.q + '”']);
  return c.map((x) => `<button class="chip on" data-a="rmF" data-v="${x[0]}">${esc(x[1])}${ic('x')}</button>`).join('');
}
const activeCount = () => (S.f.modality !== 'todos') + (S.f.max < 300) + (S.f.social ? 1 : 0);
// Busca: lista ou mapa, texto, filtros e ordenação.
screen('busca', {
  nav: 'areas', tabs: true,
  load: () => api(query()),
  view: (_, d) => `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Buscar</div><h1 class="h1">${esc(areaName(S.f.area))}</h1></div><button class="link" data-a="tab" data-v="areas">Trocar área</button></header>
  <div class="gut" style="flex:none">
    <div class="search-row"><label class="search">${ic('search')}<span class="sr">Buscar</span><input id="q" data-i="q" type="search" placeholder="Buscar especialidade, tema ou nome" value="${esc(S.f.q)}" autocomplete="off"></label><button class="icon-btn" data-a="filtros" aria-label="Filtros">${ic('filter')}${activeCount() ? `<span class="badge">${activeCount()}</span>` : ''}</button></div>
    <div class="tools"><div class="seg only-m"><button class="${S.view === 'lista' ? 'on' : ''}" data-a="view" data-v="lista">${ic('list')}Lista</button><button class="${S.view === 'mapa' ? 'on' : ''}" data-a="view" data-v="mapa">${ic('map')}Mapa</button></div><button class="addr" data-a="tab" data-v="config" aria-label="Alterar bairro">${ic('pin')}<span>Perto de ${esc(S.user.bairro)}</span></button></div>
    <div class="chips fchips" id="fchips">${fchips()}</div>
  </div>
  <main class="scroll gut" id="results" style="padding-top:14px">${results(d.pros)}</main>`,
});
async function refetch() {
  const t = top(); if (t.n !== 'busca') return;
  const d = await api(query());
  if (top() !== t) return;
  t.d = d;
  $('#results').innerHTML = results(d.pros);
  $('#fchips').innerHTML = fchips();
}
let qTimer;
// Busca por texto com espera de 280 ms, para não chamar a API a cada letra.
I.q = (el) => { S.f.q = el.value; S.sel = null; clearTimeout(qTimer); qTimer = setTimeout(() => run(refetch), 280); };
I.sort = (el) => { S.f.sort = el.value; run(refetch); };
A.view = (el) => { S.view = el.dataset.v; S.sel = null; $('#results').innerHTML = results(top().d.pros); document.querySelectorAll('[data-a=view]').forEach((b) => b.classList.toggle('on', b === el)); };
A.pin = (el) => {
  S.sel = S.sel === Number(el.dataset.v) ? null : Number(el.dataset.v);
  $('#results').innerHTML = results(top().d.pros);
  if (wide()) document.querySelector('.pcard.hl')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};
A.rmF = (el) => { const k = el.dataset.v; if (k === 'modality') S.f.modality = 'todos'; if (k === 'max') S.f.max = 300; if (k === 'social') S.f.social = false; if (k === 'q') S.f.q = ''; refresh(); };
A.clearF = () => { S.f = { ...freshFilters(), area: S.f.area }; refresh(); };
A.filtros = () => openLayer('filtros', { f: { ...S.f } });
// Folha de filtros: modalidade, valor máximo e vagas sociais.
LAYERS.filtros = (l) => {
  const f = l.f;
  return `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-label="Filtros">
  <div class="sec-h"><div class="h2">Filtros</div><button class="link" data-a="ftClear">Limpar</button></div>
  <div class="sec"><div class="lbl">Modalidade</div><div class="seg">${[['todos', 'Todas'], ['online', 'Online'], ['presencial', 'Presencial']].map((o) => `<button class="${f.modality === o[0] ? 'on' : ''}" data-a="ftSet" data-v="modality:${o[0]}">${o[1]}</button>`).join('')}</div></div>
  <div class="field"><label for="fmax">Valor máximo por sessão: <b id="fmaxL" style="color:var(--ink)">${f.max >= 300 ? 'qualquer valor' : brl(f.max * 100)}</b></label><input type="range" id="fmax" data-i="fmax" min="40" max="300" step="10" value="${f.max}"></div>
  <div class="row"><div class="grow"><b>Somente vagas sociais</b><div class="small muted">Recém-formados com supervisão, a partir de R$ 40</div></div>${toggle('ftSet', f.social, 'Somente vagas sociais', 'data-v="social:x"')}</div>
  <div class="sec"><div class="lbl">Ordenar por</div><div class="chips">${[['rel', 'Relevância'], ['nota', 'Melhor avaliados'], ['preco', 'Menor preço'], ['perto', 'Mais perto']].map((o) => `<button class="chip ${f.sort === o[0] ? 'on' : ''}" data-a="ftSet" data-v="sort:${o[0]}">${o[1]}</button>`).join('')}</div></div>
  <button class="btn btn-primary btn-block" data-a="ftApply">Mostrar resultados</button></div>`;
};
A.ftSet = (el) => { const [k, v] = el.dataset.v.split(':'); const f = S.layer.f; if (k === 'social') f.social = !f.social; else f[k] = v; openLayer('filtros', { f }); };
I.fmax = (el) => { S.layer.f.max = Number(el.value); $('#fmaxL').textContent = el.value >= 300 ? 'qualquer valor' : brl(el.value * 100); };
A.ftClear = () => openLayer('filtros', { f: { ...freshFilters(), area: S.f.area } });
A.ftApply = () => { S.f = { ...S.layer.f }; closeLayer(); refresh(); };

/* ================= perfil ================= */
// Perfil do profissional: apresentação, registro, valores, avaliações e botão de agendar.
screen('perfil', {
  nav: 'areas',
  load: (id) => api(`/api/pros/${id}`),
  view: (id, d) => {
    const p = d.pro;
    const total = d.distribution.reduce((a, b) => a + b, 0) || 1;
    return `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Perfil do profissional</div></div>${S.user.role === 'patient' ? `<button class="btn btn-ghost btn-sm" data-a="go" data-v="chat" data-p="${p.id}">${ic('chat')}<span class="only-d">Mensagem</span></button>` : ''}</header>
    <main class="scroll gut"><div class="two left">
      <div class="col stick">
        <section class="card col" style="gap:14px">
          <div class="prof-top">${avatar(p.name, p.color, 92)}<h1 class="h1">${esc(p.name)}</h1><div class="muted">${esc(p.title)} · ${esc(p.approach)}</div>
            ${p.status === 'verified' ? `<span class="verif">${ic('verified')}Registro verificado · ${esc(p.reg)}</span>` : `<span class="pill warn">${ic('clock')}Aguardando verificação</span>`}
            <div class="row" style="gap:6px">${stars(p.rating)}<b class="num">${nota(p.rating)}</b><span class="muted small num">(${p.rating_count} avaliações)</span></div></div>
          <div class="facts"><div class="fact"><b>${brl(p.price)}</b><span>por sessão</span></div><div class="fact"><b>50 min</b><span>duração</span></div><div class="fact"><b>${p.years} ${p.years === 1 ? 'ano' : 'anos'}</b><span>de experiência</span></div></div>
          ${S.user.role === 'patient' ? `<div class="only-d"><button class="btn btn-primary btn-block" data-a="agendar" data-v="${p.id}" ${p.free_count ? '' : 'disabled'}>${ic('cal')}${p.free_count ? `Agendar · a partir de ${brl(p.eff_price)}` : 'Sem horários nas próximas 2 semanas'}</button></div>` : ''}
        </section>
        ${p.social_price ? `<section class="callout">${ic('sparkle')}<div><b>Vagas sociais por ${brl(p.social_price)}</b><span>Profissional recém-formado. ${esc(p.supervisor)}</span></div></section>` : ''}
        <section class="list">
          ${p.modalities.includes('online') ? `<div class="li static">${ic('video')}<div class="li-t"><b>Atendimento online</b><span>Sala de vídeo da plataforma</span></div></div>` : ''}
          ${p.modalities.includes('presencial') ? `<div class="li static">${ic('pin')}<div class="li-t"><b>Presencial em ${esc(p.bairro)}${p.area === 'aba' ? ' ou domiciliar' : ''}</b><span>${km(p.distance)} de você</span></div></div>` : ''}
          <div class="li static">${ic('shield')}<div class="li-t"><b>Cancelamento grátis</b><span>Até 24 horas antes da sessão</span></div></div>
        </section>
      </div>
      <div class="col">
        <section class="sec"><h2 class="h2">Sobre</h2><p style="margin:0;max-width:65ch">${esc(p.bio)}</p>
          <div class="tags">${p.topics.map((t) => `<span class="tag teal">${esc(t)}</span>`).join('')}${p.audience.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></section>
        <section class="sec"><div class="sec-h"><h2 class="h2">Avaliações</h2><span class="small muted">só de quem fez sessão pela plataforma</span></div>
          <div class="card sec">
            <div class="rv-sum"><div style="text-align:center"><div class="rv-big num">${nota(p.rating)}</div>${stars(p.rating)}<div class="small muted num">${p.rating_count} avaliações</div></div>
              <div class="bars">${d.distribution.map((v, i) => `<div class="bar-r"><span>${5 - i}</span><i><b style="width:${Math.round(v / total * 100)}%"></b></i></div>`).join('')}</div></div>
            ${d.reviews.length ? d.reviews.map((r) => `<div class="review"><div class="rv-h"><span class="mini">${r.author_label === 'Anônimo' ? '?' : esc(r.author_label[0])}</span><div class="grow"><b>${esc(r.author_label)}</b> <span>· ${esc(dayLabel(r.created_at.slice(0, 10)))}</span></div>${stars(r.rating)}</div>${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}<span class="vtag">${ic('verified')}Após sessão ${r.modality === 'presencial' ? 'presencial' : 'online'} verificada</span></div>`).join('') : '<div class="small muted">Ainda não há comentários.</div>'}
          </div></section>
      </div>
    </div></main>
    ${S.user.role === 'patient' ? `<div class="footer gut only-m"><div class="tot grow"><span>a partir de</span><b class="total-big">${brl(p.eff_price)}</b></div><button class="btn btn-primary" data-a="agendar" data-v="${p.id}" ${p.free_count ? '' : 'disabled'}>Agendar sessão</button></div>` : ''}`;
  },
});
// Começa um agendamento; as escolhas ficam em S.bk.
A.agendar = (el) => { S.bk = { pro_id: Number(el.dataset.v), day: null, start: null, modality: null, method: 'pix' }; go('agendar', Number(el.dataset.v)); };

/* ================= agendamento ================= */
// Agendamento: modalidade, dia e horário (vagas sociais destacadas), com o valor de cada opção.
screen('agendar', {
  nav: 'areas', width: 'mid',
  load: async (id) => {
    const [pro, slots] = await Promise.all([api(`/api/pros/${id}`), api(`/api/pros/${id}/slots`)]);
    return { pro: pro.pro, ...slots };
  },
  after: (id, d) => {
    if (!S.bk || S.bk.pro_id !== id) S.bk = { pro_id: id, method: 'pix' };
    if (!S.bk.modality) S.bk.modality = d.pro.modalities[0];
    if (S.bk.day == null) { const i = d.days.findIndex((x) => x.items.some((s) => !s.taken)); S.bk.day = Math.max(0, i); paintAgendar(id, d); }
  },
  view: (id, d) => agendarHtml(id, d),
});
const curSlot = (d) => d.days[S.bk.day]?.items.find((s) => s.start === S.bk.start);
function agendarHtml(id, d) {
  const b = S.bk && S.bk.pro_id === id ? S.bk : { day: 0, modality: d.pro.modalities[0] };
  const p = d.pro;
  const day = d.days[b.day ?? 0];
  const slot = b.start ? day?.items.find((s) => s.start === b.start) : null;
  const q = slot ? slot.quote : null;
  const summary = `<section class="card sum">
    <div class="row" style="margin-bottom:4px">${avatar(p.name, p.color, 44)}<div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(p.title)} · ${esc(p.approach_short)}</div></div></div>
    <div class="sum-r"><span>Data</span><b>${slot ? when(slot.start) : 'Escolha um horário'}</b></div>
    <div class="sum-r"><span>Atendimento</span><b>${b.modality === 'online' ? 'Online' : 'Presencial'} · 50 min</b></div>
    ${q && q.discount ? `<div class="sum-r"><span>Desconto Me Salva+</span><b style="color:var(--lav)">− ${brl2(q.discount)}</b></div>` : ''}
    <div class="sum-r sum-t"><span>Total</span><b class="total-big">${brl2(q ? q.amount : d.regular.amount)}</b></div>
    ${slot?.social ? '<span class="soc" style="align-self:flex-end">vaga social aplicada</span>' : ''}
    <button class="btn btn-primary btn-block only-d" data-a="go" data-v="pagamento" data-p="${id}" ${slot ? '' : 'disabled'}>Continuar para pagamento</button>
  </section>`;
  return `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Agendar</div><h1 class="h1">${esc(p.name)}</h1></div></header>
  <main class="scroll gut" id="agMain"><div class="two">
    <div class="col">
      <section class="sec"><div class="lbl">Tipo de atendimento</div>
        <div class="seg" style="max-width:440px">${p.modalities.map((m) => `<button class="${b.modality === m ? 'on' : ''}" data-a="bkModal" data-v="${m}">${ic(m === 'online' ? 'video' : 'pin')}${m === 'online' ? 'Online (vídeo)' : 'Presencial'}</button>`).join('')}</div>
        <div class="small muted">${b.modality === 'presencial' ? (p.area === 'aba' ? `No consultório em ${esc(p.bairro)} ou na sua casa (domiciliar).` : `Consultório em ${esc(p.bairro)} · ${km(p.distance)} de você.`) : 'O link da sala segura aparece na sua agenda no dia da sessão.'}</div>
      </section>
      <section class="sec"><div class="sec-h"><div class="lbl">Escolha o dia</div><span class="small muted">próximas 2 semanas</span></div>
        <div class="days">${d.days.map((x, i) => { const n = x.items.filter((s) => !s.taken).length; return `<button class="day ${i === b.day ? 'on' : ''}" data-a="bkDay" data-v="${i}" ${n ? '' : 'disabled'}><span>${i === 0 ? 'Hoje' : DOW[x.weekday]}</span><b>${x.date.slice(8)}</b></button>`; }).join('')}</div>
      </section>
      <section class="sec"><div class="sec-h"><div class="lbl">Horários disponíveis</div>${d.social ? `<span class="soc">social = ${brl2(d.social.amount)}</span>` : ''}</div>
        ${day && day.items.length ? `<div class="slots">${day.items.map((s) => `<button class="slot ${s.social ? 'soc' : ''} ${b.start === s.start ? 'on' : ''}" data-a="bkSlot" data-v="${s.start}" ${s.taken ? 'disabled aria-label="Ocupado"' : ''}>${s.time}</button>`).join('')}</div>` : '<div class="small muted">Sem horários neste dia.</div>'}
      </section>
      <div class="only-m">${slot ? summary : ''}</div>
    </div>
    <div class="col stick only-d">${summary}</div>
  </div></main>
  <div class="footer gut only-m"><div class="tot grow"><span>Total</span><b class="total-big">${brl2(q ? q.amount : d.regular.amount)}</b></div><button class="btn btn-primary" data-a="go" data-v="pagamento" data-p="${id}" ${slot ? '' : 'disabled'}>Continuar</button></div>`;
}
function paintAgendar(id, d) { const sc = $('#agMain')?.scrollTop; $('#screen').innerHTML = agendarHtml(id, d); if (sc) $('#agMain').scrollTop = sc; }
A.bkModal = (el) => { S.bk.modality = el.dataset.v; const t = top(); paintAgendar(t.p, t.d); };
A.bkDay = (el) => { S.bk.day = Number(el.dataset.v); S.bk.start = null; const t = top(); paintAgendar(t.p, t.d); };
A.bkSlot = (el) => { S.bk.start = el.dataset.v; const t = top(); paintAgendar(t.p, t.d); if (!wide()) { const m = $('#agMain'); m.scrollTop = m.scrollHeight; } };

/* ================= pagamento ================= */
// Resumo e forma de pagamento (PIX ou cartão de teste).
screen('pagamento', {
  nav: 'areas', width: 'mid',
  view: (id) => {
    const prev = S.stack[S.stack.length - 2];
    const d = prev?.d;
    if (!d || !S.bk?.start) return `<main class="scroll gut"><div class="empty">${ic('info')}<div>Escolha um horário antes de pagar.</div><button class="btn btn-ghost btn-sm" data-a="back">Voltar</button></div></main>`;
    const slot = curSlot(d); const q = slot.quote; const p = d.pro;
    const m = S.bk.method;
    const payBtn = `<button class="btn btn-primary btn-block" data-a="pay">${m === 'pix' ? 'Gerar PIX de ' : 'Pagar '}${brl2(q.amount)}</button>`;
    return `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Pagamento</div><h1 class="h1">Confirme e pague</h1></div></header>
    <main class="scroll gut"><div class="two">
      <div class="col">
        <section class="sec"><div class="lbl">Forma de pagamento</div>
          <button class="pay ${m === 'pix' ? 'on' : ''}" data-a="payM" data-v="pix"><span class="p-ic">${ic('pix')}</span><div class="grow"><b>PIX</b><div class="small muted">Aprovação na hora</div></div><span class="radio"></span></button>
          <button class="pay ${m === 'card' ? 'on' : ''}" data-a="payM" data-v="card"><span class="p-ic">${ic('card')}</span><div class="grow"><b>Cartão de crédito</b><div class="small muted">Ambiente de teste</div></div><span class="radio"></span></button>
        </section>
        ${m === 'card' ? `<form class="card form" id="cardForm" data-f="noop">
          <div class="field"><label for="ccNum">Número do cartão</label><input class="input" id="ccNum" name="number" inputmode="numeric" autocomplete="cc-number" value="4242 4242 4242 4242"></div>
          <div class="field"><label for="ccName">Nome impresso no cartão</label><input class="input" id="ccName" name="name" autocomplete="cc-name" value="${esc(S.user.name.toUpperCase())}"></div>
          <div class="grid2"><div class="field"><label for="ccExp">Validade (MM/AA)</label><input class="input" id="ccExp" name="exp" autocomplete="cc-exp" value="12/30"></div><div class="field"><label for="ccCvv">CVV</label><input class="input" id="ccCvv" name="cvv" inputmode="numeric" autocomplete="cc-csc" value="123"></div></div>
          <div class="small muted">Cartões de teste: 4242 4242 4242 4242 (aprovado) e 4000 0000 0000 0002 (recusado).</div>
        </form>` : ''}
        ${S.user.plan !== 'plus' ? `<button class="nudge" data-a="tab" data-v="planos">${ic('crown')}<div class="grow">Com o <b>Me Salva+</b> esta sessão sairia por <b>${brl2(Math.round(q.base * 0.9))}</b>.</div>${ic('chevR')}</button>` : ''}
        <div class="secure">${ic('lock')}Pagamento simulado (nenhum valor é cobrado) · o horário fica reservado por 15 minutos</div>
      </div>
      <section class="card sum stick">
        <div class="row" style="margin-bottom:4px">${avatar(p.name, p.color, 40)}<div class="grow"><b>${esc(p.name)}</b><div class="small muted">${when(slot.start)} · ${S.bk.modality === 'online' ? 'Online' : 'Presencial'}</div></div></div>
        <div class="sum-r"><span>Sessão (50 min)${slot.social ? ' · vaga social' : ''}</span><b>${brl2(q.base)}</b></div>
        ${q.discount ? `<div class="sum-r"><span>Desconto Me Salva+ (10%)</span><b style="color:var(--lav)">− ${brl2(q.discount)}</b></div>` : ''}
        <div class="sum-r"><span>Taxa de serviço</span><b>Grátis</b></div>
        <div class="sum-r sum-t"><span>Total</span><b class="total-big">${brl2(q.amount)}</b></div>
        <div class="only-d">${payBtn}</div>
      </section>
    </div></main>
    <div class="footer gut only-m">${payBtn}</div>`;
  },
});
F.noop = () => {};
A.payM = (el) => { S.bk.method = el.dataset.v; replace('pagamento', top().p); };
// Cria a reserva (o horário fica guardado por 15 minutos) e segue para o PIX ou cobra o cartão.
A.pay = (el) => run(async () => {
  const card = S.bk.method === 'card' ? Object.fromEntries(new FormData($('#cardForm'))) : null;
  openLayer('processing', { text: S.bk.method === 'pix' ? 'Gerando o PIX…' : 'Processando pagamento…' });
  try {
    const r = await api('/api/appointments', { method: 'POST', body: { pro_id: S.bk.pro_id, start: S.bk.start, modality: S.bk.modality, method: S.bk.method } });
    if (S.bk.method === 'pix') { closeLayer(); go('pix', r.payment.id); return; }
    await new Promise((ok) => setTimeout(ok, 900));
    await api(`/api/payments/${r.payment.id}/card`, { method: 'POST', body: { card } });
    closeLayer(); S.stack = [{ n: 'home' }]; go('confirmado', r.appointment_id);
  } catch (e) { closeLayer(); if (e.status === 409) { S.bk.start = null; back(); } throw e; }
}, el);

// Desenho de QR Code ilustrativo; o código copia e cola ao lado é o que segue o padrão PIX.
function qrSvg(seed) {
  const n = 25; let r = '';
  const h = (s) => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="var(--qr)"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="var(--qr-bg)"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="var(--qr)"/>`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if ((x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16)) continue; if (h(seed + ':' + x + ',' + y) % 2) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR Code ilustrativo"><g fill="var(--qr)">${r}</g>${finder(0, 0)}${finder(18, 0)}${finder(0, 18)}</svg>`;
}
// Tela do PIX com contagem regressiva; o botão simula a confirmação do banco.
screen('pix', {
  nav: 'areas', width: 'narrow',
  load: (id) => api(`/api/payments/${id}`),
  view: (id, d) => `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Pagamento via PIX</div><h1 class="h1">${brl2(d.payment.amount)}</h1></div></header>
  <main class="scroll gut">
    ${d.payment.status === 'expired' ? `<div class="banner warn">${ic('clock')}<div><b>O prazo terminou</b><span>O horário foi liberado. Volte e escolha um novo horário.</span></div></div>` : ''}
    <div class="qr">${qrSvg(d.payment.pix_code || String(id))}</div>
    <div class="row" style="justify-content:center"><span class="spin"></span><span class="muted">Aguardando pagamento · expira em <span id="pixcount" class="num">15:00</span></span></div>
    <section class="sec"><div class="lbl">PIX copia e cola</div><div class="pixcode" id="pixcode">${esc(d.payment.pix_code)}</div><button class="btn btn-ghost btn-block" data-a="copyPix">${ic('copy')}Copiar código</button></section>
    <div class="disclaimer">${ic('info')}<span>Ambiente de teste: o código segue o padrão do PIX, mas a chave é fictícia e nenhum valor é cobrado. Use o botão abaixo para simular a confirmação do banco.</span></div>
  </main>
  <div class="footer gut"><button class="btn btn-teal btn-block" data-a="pixOk" data-v="${id}" ${d.payment.status === 'pending' ? '' : 'disabled'}>${ic('check')}Simular pagamento aprovado</button></div>`,
  after: (id, d) => {
    const created = new Date(d.payment.created_at).getTime();
    const tick = () => { const left = Math.max(0, created + 15 * 60000 - Date.now()); const el = $('#pixcount'); if (el) el.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`; };
    tick(); every(tick, 1000);
    every(async () => { const r = await api(`/api/payments/${id}`).catch(() => null); if (r?.payment.status === 'paid' && top().n === 'pix') { S.stack = [{ n: 'home' }]; go('confirmado', r.appointment.id); } }, 4000);
  },
});
A.copyPix = () => copyText($('#pixcode').textContent, 'Código PIX copiado.');
A.pixOk = (el) => run(async () => { const r = await api(`/api/payments/${el.dataset.v}/pix-simulate`, { method: 'POST' }); S.stack = [{ n: 'home' }]; go('confirmado', r.appointment.id); }, el);

// Sessão confirmada.
screen('confirmado', {
  nav: 'agenda', width: 'narrow',
  load: (id) => api(`/api/appointments/${id}`),
  view: (id, d) => {
    const a = d.appointment;
    return `<main class="scroll gut" style="padding-top:28px"><div class="ok-wrap"><div class="ok-ring">${ic('check')}</div><h1 class="h1">Sessão agendada!</h1><p class="muted" style="margin:0;max-width:32ch">Pagamento aprovado. ${esc(a.pro_name.split(' ')[0])} recebeu o aviso e vocês já podem conversar pelo chat.</p></div>
    <section class="card sum">
      <div class="row" style="margin-bottom:4px">${avatar(a.pro_name, a.pro_color, 44)}<div class="grow"><b>${esc(a.pro_name)}</b><div class="small muted">${esc(a.pro_title)}</div></div></div>
      <div class="sum-r"><span>Quando</span><b>${when(a.start)}</b></div>
      <div class="sum-r"><span>Atendimento</span><b>${a.modality === 'online' ? 'Online (vídeo)' : 'Presencial · ' + esc(a.pro_bairro)}</b></div>
      <div class="sum-r"><span>Valor pago</span><b>${brl2(a.amount)}${a.social ? ' · vaga social' : ''}</b></div>
      <div class="sum-r"><span>Código</span><b class="num">MS-${String(a.id).padStart(6, '0')}</b></div>
    </section>
    <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"><button class="btn btn-primary" data-a="tab" data-v="agenda">${ic('cal')}Ver na agenda</button><button class="btn btn-ghost" data-a="go" data-v="chat" data-p="${a.pro_id}">${ic('chat')}Mandar mensagem</button></div>
    </main>`;
  },
});

/* ================= agenda do paciente ================= */
S.agTab = 'up';
// Agenda do paciente: próximas sessões e histórico.
screen('agenda', {
  tabs: true, nav: 'agenda',
  load: () => api('/api/appointments'),
  view: (_, d) => {
    const list = S.agTab === 'up' ? d.upcoming : d.past;
    const card = (a) => `<section class="card"><div class="appt">${dateBox(a.start)}
      <div class="grow"><b>${esc(a.pro_name)}</b><span>${ic('clock')}${when(a.start)}</span><span>${ic(a.modality === 'online' ? 'video' : 'pin')}${a.modality === 'online' ? 'Online' : 'Presencial · ' + esc(a.pro_bairro)}${a.social ? ' · <b style="color:var(--lav);font-weight:600;display:inline">vaga social</b>' : ''}</span></div>
      ${a.status === 'pending_payment' ? '<span class="pill warn">aguardando pagamento</span>' : a.status === 'no_show' ? '<span class="pill">falta</span>' : a.room_open ? '<span class="live">sala aberta</span>' : ''}</div>
      <div class="appt-act">${a.status === 'pending_payment' ? `<button class="btn btn-primary btn-sm" data-a="go" data-v="pix" data-p="${a.payment_id}">${ic('pix')}Concluir pagamento</button><button class="btn btn-ghost btn-sm" data-a="cancelAppt" data-v="${a.id}">Desistir</button>`
        : a.status === 'confirmed' ? `${a.room_open ? `<button class="btn btn-teal btn-sm" data-a="go" data-v="sessao" data-p="${a.id}">${ic('video')}Entrar na sessão</button>` : ''}<button class="btn btn-ghost btn-sm" data-a="go" data-v="chat" data-p="${a.pro_id}">${ic('chat')}Mensagem</button><button class="btn btn-ghost btn-sm" data-a="cancelAppt" data-v="${a.id}">Cancelar</button>`
        : `${a.status === 'done' ? (a.review_id ? `<span class="row small" style="gap:6px">Você avaliou ${stars(a.review_rating)}</span>` : `<button class="btn btn-primary btn-sm" data-a="go" data-v="avaliar" data-p="${a.id}">${ic('star')}Avaliar sessão</button>`) : ''}<button class="btn btn-ghost btn-sm" data-a="agendar" data-v="${a.pro_id}">Agendar de novo</button>`}
      </div></section>`;
    return `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Minhas sessões</div><h1 class="h1">Agenda</h1></div></header>
    <div class="gut" style="padding-bottom:12px;flex:none"><div class="seg" style="max-width:420px"><button class="${S.agTab === 'up' ? 'on' : ''}" data-a="agTab" data-v="up">Próximas (${d.upcoming.length})</button><button class="${S.agTab === 'past' ? 'on' : ''}" data-a="agTab" data-v="past">Anteriores (${d.past.length})</button></div></div>
    <main class="scroll gut">${list.length ? `<div class="agenda-list">${list.map(card).join('')}</div>` : `<div class="empty">${ic('cal')}<div>Nenhuma sessão por aqui.</div><button class="btn btn-primary btn-sm" data-a="tab" data-v="areas">Encontrar profissional</button></div>`}</main>`;
  },
});
A.agTab = (el) => { S.agTab = el.dataset.v; replace(top().n, top().p); };
A.cancelAppt = (el) => confirmSheet({ title: 'Cancelar esta sessão?', text: 'Cancelamentos até 24 horas antes têm o valor devolvido. O horário volta a ficar livre para outras pessoas.', ok: 'Cancelar sessão', danger: true }, async () => {
  await api(`/api/appointments/${el.dataset.v}/cancel`, { method: 'POST' });
  closeLayer(); toast('Sessão cancelada.'); refresh();
});

/* ================= avaliação ================= */
const RV_LBL = ['Toque nas estrelas', 'Ruim', 'Regular', 'Boa', 'Muito boa', 'Excelente'];
// Avaliação depois da sessão: estrelas, destaques, comentário e opção anônima.
screen('avaliar', {
  nav: 'agenda', width: 'narrow',
  load: async (id) => { const [a, t] = await Promise.all([api(`/api/appointments/${id}`), api('/api/review-tags')]); return { a: a.appointment, tags: t.tags }; },
  view: (id, d) => {
    if (!S.rv || S.rv.id !== id) S.rv = { id, n: 0, tags: [], anon: false };
    const r = S.rv; const a = d.a;
    return `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Avaliação</div><h1 class="h1">Como foi sua sessão?</h1></div></header>
    <main class="scroll gut">
      <div class="card row">${avatar(a.pro_name, a.pro_color, 48)}<div class="grow"><b>${esc(a.pro_name)}</b><div class="small muted">${when(a.start)} · ${a.modality === 'online' ? 'Online' : 'Presencial'}</div></div></div>
      <section class="sec" style="text-align:center"><div class="bigstars" role="radiogroup" aria-label="Nota">${[1, 2, 3, 4, 5].map((i) => `<button class="${i <= r.n ? 'on' : ''}" data-a="rStar" data-v="${i}" aria-label="${i} estrela${i > 1 ? 's' : ''}">${ic('star', 'fill')}</button>`).join('')}</div><b id="rvLbl">${RV_LBL[r.n]}</b></section>
      <section class="sec"><div class="lbl">O que se destacou?</div><div class="chips">${d.tags.map((t) => `<button class="chip ${r.tags.includes(t) ? 'on' : ''}" data-a="rTag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></section>
      <div class="field"><label for="rvtxt">Conte como foi (opcional)</label><textarea class="input" id="rvtxt" maxlength="600" placeholder="Seu comentário ajuda outras pessoas a escolher. Evite dados pessoais."></textarea></div>
      <div class="row"><div class="grow"><b>Publicar como anônimo</b><div class="small muted">Seu nome não aparece no perfil do profissional.</div></div>${toggle('rAnon', r.anon, 'Publicar como anônimo')}</div>
      <div class="disclaimer">${ic('shield')}<span>Só quem realizou a sessão pela plataforma pode avaliar, uma vez por sessão.</span></div>
    </main>
    <div class="footer gut"><button class="btn btn-primary btn-block" data-a="sendRv" ${r.n ? '' : 'disabled'}>Enviar avaliação</button></div>`;
  },
});
// Redesenha a avaliação sem perder o texto digitado.
const keepText = (fn) => { const v = $('#rvtxt')?.value; fn(); const t = top(); $('#screen').innerHTML = SCREENS.avaliar.view(t.p, t.d); if (v) $('#rvtxt').value = v; };
A.rStar = (el) => keepText(() => { S.rv.n = Number(el.dataset.v); });
A.rTag = (el) => keepText(() => { const t = el.dataset.v; S.rv.tags = S.rv.tags.includes(t) ? S.rv.tags.filter((x) => x !== t) : [...S.rv.tags, t]; });
A.rAnon = () => keepText(() => { S.rv.anon = !S.rv.anon; });
A.sendRv = (el) => run(async () => {
  const r = S.rv;
  await api(`/api/appointments/${r.id}/review`, { method: 'POST', body: { rating: r.n, tags: r.tags, text: $('#rvtxt').value, anonymous: r.anon } });
  S.rv = null; S.agTab = 'past'; tab('agenda'); toast('Avaliação publicada no perfil do profissional.');
}, el);

/* ================= triagem ================= */
// Triagem em 5 passos; as respostas ficam em S.tri. para = 'filho' abre o caminho TEA/ABA.
function startTri(para) { S.tri = { step: para ? 1 : 0, para: para || null, idade: null, motivos: [], sinais: [], tempo: null, diag: null, suporte: null, antes: null, modal: null, orc: null, hor: [] }; }
A.tri = () => { if (S.user.role !== 'patient') return; startTri(); go('triagem'); };
const opt = (a, v, on, icn, title, sub) => `<button class="opt ${on ? 'on' : ''}" data-a="${a}" data-v="${esc(v)}"><span class="o-ic">${ic(icn)}</span><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${on ? ic('check') : ''}</button>`;
// Um passo da triagem por vez; Continuar só é liberado com a pergunta respondida.
screen('triagem', {
  nav: 'home', width: 'narrow',
  view: () => {
    const t = S.tri; const kid = t.para === 'filho'; const T = S.meta.triage;
    let body = ''; let ok = true;
    if (t.step === 0) { body = `<h2 class="q">Para quem é o atendimento?</h2><div class="opts">${opt('tSet', 'para:eu', t.para === 'eu', 'user', 'Para mim', '')}${opt('tSet', 'para:filho', t.para === 'filho', 'child', 'Para meu filho ou filha', 'Inclui o caminho TEA/ABA')}${opt('tSet', 'para:outro', t.para === 'outro', 'users', 'Para outra pessoa adulta', 'Um familiar ou amigo')}</div>`; ok = !!t.para; }
    else if (t.step === 1 && kid) { body = `<h2 class="q">Qual a idade da criança?</h2><div class="opts">${[['0-3', '0 a 3 anos', 'Primeira infância'], ['4-6', '4 a 6 anos', 'Pré-escola'], ['7-12', '7 a 12 anos', 'Ensino fundamental'], ['13-17', '13 a 17 anos', 'Adolescência']].map((o) => opt('tSet', 'idade:' + o[0], t.idade === o[0], 'child', o[1], o[2])).join('')}</div>`; ok = !!t.idade; }
    else if (t.step === 1) { body = `<h2 class="q">O que ${t.para === 'eu' ? 'você tem sentido' : 'essa pessoa tem sentido'}?</h2><p class="muted" style="margin:0">Pode escolher mais de uma opção.</p><div class="chips">${T.motivos.map((m) => `<button class="chip ${t.motivos.includes(m[0]) ? 'on' : ''}" data-a="tTog" data-v="motivos:${esc(m[0])}">${esc(m[1])}</button>`).join('')}</div>`; ok = t.motivos.length > 0; }
    else if (t.step === 2 && kid) { body = `<h2 class="q">O que você tem observado no dia a dia?</h2><p class="muted" style="margin:0">Marque o que for parecido com a rotina da criança.</p><div class="chips">${T.sinais.map((m) => `<button class="chip ${t.sinais.includes(m) ? 'on' : ''}" data-a="tTog" data-v="sinais:${esc(m)}">${esc(m)}</button>`).join('')}<button class="chip ${t.sinais.includes('Nenhum') ? 'on' : ''}" data-a="tTog" data-v="sinais:Nenhum">Nenhum desses</button></div>`; ok = t.sinais.length > 0; }
    else if (t.step === 2) { body = `<h2 class="q">Há quanto tempo e com que intensidade?</h2><div class="opts">${opt('tSet', 'tempo:leve', t.tempo === 'leve', 'smile', 'Há poucas semanas', 'Incomoda, mas consigo levar a rotina')}${opt('tSet', 'tempo:medio', t.tempo === 'medio', 'clock', 'Há alguns meses', 'Já atrapalha trabalho, estudo ou sono')}${opt('tSet', 'tempo:forte', t.tempo === 'forte', 'heart', 'Há muito tempo', 'Está muito difícil passar pelo dia')}</div>${t.tempo === 'forte' ? `<div class="callout" style="background:var(--danger-soft)">${ic('lifebuoy')}<div><b>Você não precisa passar por isso sozinho(a).</b><span>Vamos priorizar profissionais com horário ainda esta semana. Se estiver em risco agora, ligue 188 (CVV) ou 192 (SAMU).</span></div></div>` : ''}`; ok = !!t.tempo; }
    else if (t.step === 3 && kid) { body = `<h2 class="q">Já existe um diagnóstico?</h2><div class="opts">${opt('tSet', 'diag:sim', t.diag === 'sim', 'file', 'Sim, TEA confirmado', 'Com laudo de médico ou neuropsicólogo')}${opt('tSet', 'diag:invest', t.diag === 'invest', 'search', 'Em investigação', 'Já estamos consultando especialistas')}${opt('tSet', 'diag:nao', t.diag === 'nao', 'info', 'Ainda não', 'Tenho dúvidas e quero orientação')}</div>
      <div class="lbl" style="margin-top:6px">Quanto apoio a criança precisa no dia a dia?</div><div class="seg">${[['pouco', 'Pouco'], ['moderado', 'Moderado'], ['muito', 'Muito']].map((o) => `<button class="${t.suporte === o[0] ? 'on' : ''}" data-a="tSet" data-v="suporte:${o[0]}">${o[1]}</button>`).join('')}</div>`; ok = !!t.diag && !!t.suporte; }
    else if (t.step === 3) { body = `<h2 class="q">Já fez terapia antes?</h2><div class="opts">${opt('tSet', 'antes:sim', t.antes === 'sim', 'check', 'Sim', 'Já tive acompanhamento')}${opt('tSet', 'antes:nao', t.antes === 'nao', 'sparkle', 'Não, é a primeira vez', 'Vamos indicar quem acolhe bem quem está começando')}</div>`; ok = !!t.antes; }
    else { body = `<h2 class="q">Suas preferências</h2>
      <div class="lbl">Como prefere o atendimento?</div><div class="seg">${[['online', 'Online'], ['presencial', 'Presencial'], ['tanto', 'Tanto faz']].map((o) => `<button class="${t.modal === o[0] ? 'on' : ''}" data-a="tSet" data-v="modal:${o[0]}">${o[1]}</button>`).join('')}</div>
      <div class="lbl">Quanto pode investir por sessão?</div><div class="chips">${[[60, 'Até R$ 60'], [120, 'Até R$ 120'], [250, 'Até R$ 250'], [999, 'Sem limite']].map((o) => `<button class="chip ${t.orc === o[0] ? 'on' : ''}" data-a="tSet" data-v="orc:${o[0]}">${o[1]}</button>`).join('')}</div>
      <div class="lbl">Melhores horários</div><div class="chips">${['Manhã', 'Tarde', 'Noite'].map((o) => `<button class="chip ${t.hor.includes(o) ? 'on' : ''}" data-a="tTog" data-v="hor:${o}">${o}</button>`).join('')}</div>`; ok = !!t.modal && !!t.orc; }
    return `<header class="bar gut">${t.step ? `<button class="icon-btn" data-a="tPrev" aria-label="Voltar">${ic('chevL')}</button>` : backBtn()}<div class="bar-t"><div class="eyebrow">Triagem gratuita · passo ${t.step + 1} de 5</div><h1 class="h1">${kid ? 'Triagem TEA/ABA' : 'Vamos te conhecer'}</h1></div></header>
    <div class="gut" style="flex:none"><div class="prog"><b style="width:${(t.step + 1) / 5 * 100}%"></b></div></div>
    <main class="scroll gut" style="padding-top:20px">${body}<div class="disclaimer">${ic('lock')}<span>Suas respostas ficam protegidas e só são compartilhadas com profissionais que você agendar.</span></div></main>
    <div class="footer gut"><button class="btn btn-primary btn-block" data-a="tNext" ${ok ? '' : 'disabled'}>${t.step === 4 ? 'Ver profissionais compatíveis' : 'Continuar'}</button></div>`;
  },
});
const triPaint = () => { const t = top(); $('#screen').innerHTML = SCREENS.triagem.view(t.p, t.d); };
A.tSet = (el) => { const v = el.dataset.v; const i = v.indexOf(':'); const k = v.slice(0, i); const val = v.slice(i + 1); S.tri[k] = k === 'orc' ? Number(val) : val; if (k === 'para') { S.tri.motivos = []; S.tri.sinais = []; } triPaint(); };
A.tTog = (el) => { const v = el.dataset.v; const i = v.indexOf(':'); const k = v.slice(0, i); const val = v.slice(i + 1); let a = S.tri[k]; if (k === 'sinais' && val === 'Nenhum') a = a.includes('Nenhum') ? [] : ['Nenhum']; else { a = a.filter((x) => x !== 'Nenhum'); a = a.includes(val) ? a.filter((x) => x !== val) : [...a, val]; } S.tri[k] = a; triPaint(); };
// Avança; no último passo envia as respostas para /api/triage e mostra o resultado.
A.tNext = (el) => {
  if (S.tri.step < 4) { S.tri.step += 1; S.dir = 'fwd'; replace('triagem'); return; }
  run(async () => {
    const t = S.tri;
    const answers = { para: t.para === 'outro' ? 'eu' : t.para, idade: t.idade, motivos: t.motivos, sinais: t.sinais, tempo: t.tempo, diag: t.diag, suporte: t.suporte, antes: t.antes, modal: t.modal, orc: t.orc, hor: t.hor };
    const r = await api('/api/triage', { method: 'POST', body: { answers } });
    go('trires', r);
  }, el);
};
A.tPrev = () => { S.tri.step -= 1; S.dir = 'bk'; replace('triagem'); };
// Anel com o índice de compatibilidade.
function ring(v) { const r = 24; const c = 2 * Math.PI * r; return `<div class="ring"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="5"/><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--teal)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}"/></svg>${v}%</div>`; }
// Resultado da triagem: sugestão, aviso de busca ampliada e profissionais com os motivos da indicação.
screen('trires', {
  nav: 'home', width: 'mid',
  view: (r) => {
    const n = r.needs;
    const rec = n.forKid
      ? (n.context === 'tea-confirmado' ? 'Para TEA confirmado, a intervenção em ABA com frequência semanal costuma ser o primeiro passo, junto com orientação para a família.' : 'O primeiro passo costuma ser uma avaliação com neuropsicólogo(a) ou psiquiatra infantil. Em paralelo, a orientação parental em ABA já ajuda na rotina.')
      : (n.urgent ? 'Pelos sinais que você descreveu, vale combinar psicoterapia com uma avaliação psiquiátrica.' : 'A psicoterapia semanal é um bom começo para o que você descreveu.');
    return `<header class="bar gut">${backBtn()}<div class="bar-t"><div class="eyebrow">Resultado da triagem</div><h1 class="h1">Profissionais compatíveis</h1></div></header>
    <main class="scroll gut">
      <div class="callout" style="background:var(--teal-soft)">${ic('sparkle')}<div><b>Nossa sugestão</b><span>${rec}</span></div></div>
      ${r.relaxed.length ? `<div class="banner warn">${ic('info')}<div><b>Ampliamos a busca</b><span>Havia poucas opções com todos os critérios. Algumas indicações ${r.relaxed.includes('orcamento') ? 'passam do valor que você informou' : 'usam outra modalidade'}, e isso aparece no cartão.</span></div></div>` : ''}
      ${r.results.length ? `<div class="match">${r.results.map((x) => `<button class="card mcard" data-a="go" data-v="perfil" data-p="${x.pro.id}">
        <div class="row">${ring(x.score)}<div class="grow"><b>${esc(x.pro.name)}</b><div class="small muted">${esc(x.pro.title)} · ${esc(x.pro.approach_short)}</div><div class="row small" style="gap:4px">${ic('star', 'fill gstar')}<b class="num">${nota(x.pro.rating)}</b><span class="muted">· ${brl(x.price)}${x.price < x.pro.price ? ' (vaga social)' : ''}</span></div></div>${ic('chevR')}</div>
        <ul class="why">${x.reasons.map((w) => `<li>${ic('check')}${esc(w)}</li>`).join('')}${x.warnings.map((w) => `<li style="color:var(--danger)">${ic('info')}${esc(w)}</li>`).join('')}</ul></button>`).join('')}</div>`
      : `<div class="empty">${ic('search')}<div>Não encontramos profissionais com horários para esse perfil agora.</div></div>`}
      <button class="btn btn-ghost btn-block" data-a="triAll">Ver todos os profissionais</button>
      <div class="disclaimer">${ic('info')}<span>A triagem orienta a escolha e não é um diagnóstico. Apenas profissionais habilitados podem avaliar e diagnosticar. Cálculo feito em ${String(r.elapsed_ms).replace('.', ',')} ms.</span></div>
    </main>`;
  },
});
A.triAll = () => { const t = S.tri; S.f = { ...freshFilters(), q: t.para === 'filho' ? 'TEA' : '', modality: !t.modal || t.modal === 'tanto' ? 'todos' : t.modal, max: Math.min(300, t.orc || 300) }; S.view = 'lista'; go('busca'); };

/* ================= planos ================= */
// Planos: gratuito e Me Salva+ (assinatura simulada).
screen('planos', {
  tabs: true, nav: 'planos', width: 'mid',
  view: () => {
    const plus = S.user.plan === 'plus';
    const f = (items, cls) => `<ul class="feat">${items.map((x) => `<li>${ic('check', cls)}${x}</li>`).join('')}</ul>`;
    return `<header class="bar gut">${S.stack.length > 1 ? backBtn() : ''}<div class="bar-t"><div class="eyebrow">Planos</div><h1 class="h1">Escolha seu plano</h1></div></header>
    <main class="scroll gut">
      <div class="plans">
        <section class="plan"><div class="plan-h"><div><div class="h2">Gratuito</div><div class="small muted">Para começar sem custo</div></div>${!plus ? '<span class="cur">Seu plano</span>' : ''}</div>
          <div class="plan-p">R$ 0 <small>/ sempre</small></div>
          ${f(['Busca, filtros e mapa de profissionais', 'Triagem com indicações compatíveis', 'Agendamento e pagamento na plataforma', 'Chat com profissionais', 'Avaliações após cada sessão'])}</section>
        <section class="plan plus"><div class="plan-h"><div><div class="h2" style="display:flex;gap:6px;align-items:center">${ic('crown')}Me Salva+</div><div class="small muted">Para quem faz acompanhamento contínuo</div></div>${plus ? '<span class="cur">Seu plano</span>' : ''}</div>
          <div class="plan-p">R$ 19,90 <small>/ mês</small></div>
          ${f(['Tudo do plano gratuito', '10% de desconto em todas as sessões', 'Relatório completo da triagem para levar ao profissional', 'Diário emocional e lembretes personalizados (em breve)'])}
          ${plus ? '<button class="btn btn-ghost btn-block" data-a="unsub">Cancelar assinatura</button>' : '<button class="btn btn-lav btn-block" data-a="sub">Assinar por R$ 19,90/mês</button>'}
          <div class="small muted" style="text-align:center">Com 2 sessões de R$ 100 por mês, a assinatura já se paga. Cobrança simulada.</div></section>
      </div>
      <section class="card sec"><div class="eyebrow">Para profissionais</div><div class="h2">Plano Pro · R$ 49,90/mês (a partir do ano 2)</div>
        ${f(['Destaque nas buscas da sua região', 'Prontuário eletrônico com relatórios de evolução', 'Relatórios para ABA e convênios', 'Gestão financeira e repasses automáticos'])}
        <div class="small muted">Em todos os planos, a plataforma retém 12% de cada sessão realizada. O paciente não paga taxa extra.</div></section>
    </main>`;
  },
});
A.sub = (el) => run(async () => { const r = await api('/api/me/plan', { method: 'POST', body: { action: 'subscribe' } }); S.user = r.user; replace('planos'); toast('Assinatura Me Salva+ ativada (cobrança simulada).'); }, el);
A.unsub = (el) => run(async () => { const r = await api('/api/me/plan', { method: 'POST', body: { action: 'cancel' } }); S.user = r.user; replace('planos'); toast('Assinatura cancelada. Você voltou ao plano gratuito.'); }, el);

export { startTri };
