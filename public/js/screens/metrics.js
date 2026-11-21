// Painel de métricas do negócio (v1.3), na administração: indicadores do período, gráficos semanais em SVG
// próprio (sem bibliotecas), funil, retenção, vagas sociais e qualidade. Os números vêm de GET /api/admin/metrics
// (src/metrics.js, onde estão as definições). Todos os dados são de demonstração, e a tela diz isso.
//
// Os gráficos são desenhados depois que a tela aparece (after), na largura real do espaço, e redesenhados quando
// ela muda; assim os cantos arredondados e os textos ficam nítidos no celular e no computador. Passar o mouse ou o
// dedo (ou usar as setas, com o gráfico em foco) mostra os números da semana.
import { S, A, screen, api, refresh, onLeave, esc, ic, brl, brl2, nota, $ } from '../core.js';

S.mDays = 30;
const PERIODS = [[30, '30 dias'], [90, '90 dias'], [180, '6 meses']];

// 'AAAA-MM-DD' → 'DD/MM'.
const dm = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
// Dia anterior a 'AAAA-MM-DD'.
const prevDay = (day) => { const [y, m, dd] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd - 1)).toISOString().slice(0, 10); };
// Valor grande arredondado para reais inteiros (R$ 27.814).
const reais = (c) => brl(Math.round(c / 100) * 100);
const int = (n) => Number(n || 0).toLocaleString('pt-BR');
// Variação em relação ao período anterior de mesmo tamanho: '+8% vs. anterior' (ou aviso quando não há base).
function delta(cur, prev) {
  if (!prev) return '<em class="flat">sem base para comparar</em>';
  const v = Math.round(((cur - prev) / prev) * 100);
  return `<em class="${v < 0 ? 'neg' : v === 0 ? 'flat' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}% vs. anterior</em>`;
}

screen('metricas', {
  tabs: true, nav: 'metricas',
  load: () => api(`/api/admin/metrics?days=${S.mDays}`),
  view: (_, d) => {
    const k = d.kpis; const p = d.prev || {}; const per = d.period.label;
    const prevTo = d.period.from; // o período anterior termina onde este começa
    const q = d.quality; const total = q.distribution.reduce((a, b) => a + b, 0) || 1;
    const f0 = d.funnel[0].users || 1;
    return `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Administração</div><h1 class="h1">Métricas do negócio</h1></div>
      <a class="btn btn-ghost btn-sm" href="/api/admin/metrics/export?days=${d.period.days}" download>${ic('download')}<span>CSV</span></a></header>
    <div class="gut m-filter"><div class="seg" role="group" aria-label="Período">${PERIODS.map(([v, l]) => `<button class="${d.period.days === v ? 'on' : ''}" data-a="mDays" data-v="${v}" aria-pressed="${d.period.days === v}">${l}</button>`).join('')}</div>
      <span class="small muted">de ${dm(d.period.from)} a ${dm(d.period.to)}</span></div>
    <main class="scroll gut">
      <div class="banner" role="note">${ic('info')}<div><b>Dados de demonstração</b><span>Números fictícios, gerados para a apresentação. Não são resultados reais do Me Salva.</span></div></div>
      <section class="stats m-stats" aria-label="Indicadores do período">
        <div class="stat"><span>Valor transacionado</span><b>${reais(k.gmv)}</b>${delta(k.gmv, p.gmv)}</div>
        <div class="stat"><span>Receita da plataforma</span><b>${reais(k.revenue)}</b>${delta(k.revenue, p.revenue)}</div>
        <div class="stat"><span>Sessões realizadas</span><b>${int(k.sessions)}</b>${delta(k.sessions, p.sessions)}</div>
        <div class="stat"><span>Ticket médio</span><b>${brl2(k.ticket)}</b>${delta(k.ticket, p.ticket)}</div>
        <div class="stat"><span>Pacientes ativos</span><b>${int(k.patients_active)}</b>${delta(k.patients_active, p.patients_active)}</div>
        <div class="stat"><span>Assinantes do Me Salva+</span><b>${int(k.plus_subscribers)}</b><em class="flat">${k.plus_pct}% dos pacientes ativos</em></div>
        <div class="stat"><span>Profissionais ativos</span><b>${int(k.pros_active)}</b><em class="flat">de ${k.pros_verified} verificados · ${k.pros_pending} ${k.pros_pending === 1 ? 'aguardando' : 'aguardam'}</em></div>
        <div class="stat"><span>Sessões a preço social</span><b>${int(k.social_sessions)}</b><em class="flat">${d.social.share_pct}% das sessões realizadas</em></div>
      </section>
      <p class="small muted m-note">${d.prev ? `"Anterior" são os ${per} antes deste período (de ${dm(d.period.prev_from)} a ${dm(prevDay(prevTo))}). ` : 'O histórico ainda não cobre um período anterior do mesmo tamanho para comparar. '}Receita: 12% de cada sessão realizada (o desconto do Me Salva+ sai dessa parte) mais as mensalidades do Me Salva+, ${reais(k.revenue_sessions)} + ${reais(k.revenue_plus)}.</p>

      <div class="m-grid">
        <section class="card sec m-chart-card"><div class="sec-h"><h2 class="h2">Sessões realizadas por semana</h2><span class="small muted">últimas 26 semanas</span></div>
          <div class="m-legend" aria-hidden="true"><span><i class="sw c1"></i>Valor de tabela</span><span><i class="sw c2"></i>Vaga social</span></div>
          <div class="m-chart" id="chSessions"></div></section>
        <section class="card sec m-chart-card"><div class="sec-h"><h2 class="h2">Receita da plataforma por semana</h2><span class="small muted">últimas 26 semanas</span></div>
          <div class="m-chart" id="chRevenue"></div></section>
      </div>

      <div class="m-grid">
        <section class="card sec"><div class="sec-h"><h2 class="h2">Funil</h2><span class="small muted">quem começou a triagem nos últimos ${per}</span></div>
          <ol class="funnel">${d.funnel.map((s, i) => `<li><div class="fn-t"><span>${esc(s.label)}</span><b class="num">${int(s.users)}</b></div>
            <div class="fn-bar"><i style="width:${Math.max(1, Math.round((s.users / f0) * 100))}%"></i></div>
            <span class="small muted">${i ? `${s.of_prev}% do passo anterior · ${s.of_first}% do início` : 'ponto de partida'}</span></li>`).join('')}</ol>
          <p class="small muted" style="margin:0">Quem começou nos últimos dias ainda pode avançar nos passos seguintes.</p></section>
        <div class="col">
          <section class="card sec"><h2 class="h2">Retenção</h2>
            ${meter('Pacientes com 2 ou mais sessões', d.retention.two_plus, d.retention.active, d.retention.two_plus_pct)}
            ${meter('Pacientes com pacote recorrente', d.retention.package, d.retention.active, d.retention.package_pct)}
            <p class="small muted" style="margin:0">Entre os ${int(d.retention.active)} pacientes com sessão realizada no período.</p></section>
          <section class="card sec"><h2 class="h2">Vagas sociais</h2>
            ${meter('Ocupação das vagas sociais fixas', d.social.used, d.social.offered, d.social.occupancy_pct, 'lav')}
            <dl class="kv"><dt>Sessões a preço social</dt><dd>${int(d.social.sessions)} (${d.social.share_pct}% do total)</dd><dt>Economia para as famílias</dt><dd>${reais(d.social.savings)} em relação ao valor de tabela</dd><dt>Profissionais com vagas sociais</dt><dd>${d.social.pros} recém-formados, com supervisão</dd></dl></section>
        </div>
      </div>

      <div class="m-grid">
        <section class="card sec"><div class="sec-h"><h2 class="h2">Qualidade</h2><span class="small muted">${int(q.reviews)} avaliações no período</span></div>
          <div class="rv-sum"><div style="text-align:center"><div class="rv-big num">${q.avg == null ? '—' : nota(q.avg)}</div><div class="small muted">nota média</div></div>
            <div class="bars" aria-label="Distribuição das notas">${q.distribution.map((v, i) => `<div class="bar-r"><span>${5 - i}</span><i><b style="width:${Math.round((v / total) * 100)}%"></b></i><span class="num">${v}</span></div>`).join('')}</div></div>
          <dl class="kv"><dt>Taxa de faltas</dt><dd>${q.no_show_pct}% (${int(q.no_show)} de ${int(q.no_show + k.sessions)} sessões)</dd></dl></section>
        <section class="card sec m-chart-card"><div class="sec-h"><h2 class="h2">Novos cadastros de pacientes por semana</h2><span class="small muted">últimas 26 semanas</span></div>
          <div class="m-chart m-chart-sm" id="chSignups"></div></section>
      </div>

      <details class="card m-table"><summary><b>Ver as semanas em tabela</b> <span class="small muted">(os mesmos números dos gráficos)</span></summary>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Semana</th><th class="num">Sessões</th><th class="num">A preço social</th><th class="num">Faltas</th><th class="num">Valor transacionado</th><th class="num">Receita</th><th class="num">Cadastros</th></tr></thead>
        <tbody>${d.weekly.slice().reverse().map((w) => `<tr><td>${dm(w.week)}</td><td class="num">${w.sessions}</td><td class="num">${w.social}</td><td class="num">${w.no_show}</td><td class="num">${brl2(w.gmv)}</td><td class="num">${brl2(w.revenue)}</td><td class="num">${w.signups}</td></tr>`).join('')}</tbody></table></div></details>
      <p class="small muted m-note">Atualizado em ${dm(d.now)} às ${d.now.slice(11, 16)}. Semanas de segunda a domingo; a semana atual entra nos gráficos quando termina. Definições em docs/DOCUMENTACAO.md (seção "Painel de métricas").</p>
    </main>`;
  },
  after: (_, d) => {
    const draw = () => {
      const w = d.weekly;
      const label = (i) => `Semana de ${dm(w[i].week)}`;
      chart($('#chSessions'), {
        weeks: w, kind: 'bars', fmt: int,
        series: [{ cls: 'c1', value: (x) => x.sessions - x.social }, { cls: 'c2', value: (x) => x.social }],
        total: (x) => x.sessions,
        tip: (i) => `<b>${label(i)}</b><span>${int(w[i].sessions)} sessões realizadas</span><span>${int(w[i].social)} a preço social</span>`,
        aria: `Sessões realizadas por semana: de ${int(w[0].sessions)} na semana de ${dm(w[0].week)} para ${int(w.at(-1).sessions)} na de ${dm(w.at(-1).week)}.`,
      });
      chart($('#chRevenue'), {
        weeks: w, kind: 'line', fmt: (c) => reais(c),
        series: [{ cls: 'c1', value: (x) => x.revenue }], total: (x) => x.revenue,
        tip: (i) => `<b>${label(i)}</b><span>${brl2(w[i].revenue)} de receita</span><span>${brl2(w[i].gmv)} transacionados</span>`,
        aria: `Receita da plataforma por semana: de ${reais(w[0].revenue)} na semana de ${dm(w[0].week)} para ${reais(w.at(-1).revenue)} na de ${dm(w.at(-1).week)}.`,
      });
      chart($('#chSignups'), {
        weeks: w, kind: 'bars', fmt: int, height: 150,
        series: [{ cls: 'c1', value: (x) => x.signups }], total: (x) => x.signups,
        tip: (i) => `<b>${label(i)}</b><span>${int(w[i].signups)} ${w[i].signups === 1 ? 'novo cadastro' : 'novos cadastros'}</span>`,
        aria: `Novos cadastros de pacientes por semana: de ${w[0].signups} para ${w.at(-1).signups}.`,
      });
    };
    draw();
    // Redesenha quando a largura muda (girar o celular, abrir a barra lateral).
    let last = $('#chSessions')?.clientWidth;
    const ro = new ResizeObserver(() => { const now = $('#chSessions')?.clientWidth; if (now && now !== last) { last = now; draw(); } });
    ro.observe($('#screen'));
    onLeave(() => ro.disconnect());
  },
});
A.mDays = (el) => { S.mDays = Number(el.dataset.v); refresh(); };

// Barra de proporção com rótulo, número e porcentagem (retenção e vagas sociais).
function meter(label, part, whole, pct, tone = '') {
  return `<div class="meter"><div class="fn-t"><span>${esc(label)}</span><b class="num">${pct}%</b></div>
    <div class="fn-bar ${tone}" role="img" aria-label="${esc(label)}: ${part} de ${whole} (${pct}%)"><i style="width:${Math.max(pct ? 1 : 0, pct)}%"></i></div>
    <span class="small muted">${int(part)} de ${int(whole)}</span></div>`;
}

// Escala "redonda" para o eixo: o menor passo de 1, 2, 2,5 ou 5 × 10^n que deixa 4 faixas acima do máximo.
function niceMax(max) {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // 2,5 só a partir de 25, para o eixo de contagens não ganhar meias sessões.
  const step = Math.max(1, [1, 2, ...(mag >= 10 ? [2.5] : []), 5, 10].map((m) => m * mag).find((s) => s >= raw));
  return { top: step * 4, step };
}

/**
 * Desenha um gráfico semanal dentro de el (barras, empilhadas ou não, ou linha com área), na largura real.
 * Barras finas com o topo arredondado (4 px) e 2 px de espaço entre as partes empilhadas; linha de 2 px.
 * Um único eixo; grade discreta; dica com os números da semana ao passar o mouse, tocar ou usar as setas.
 */
function chart(el, { weeks, kind, series, total, fmt, tip, aria, height }) {
  if (!el) return;
  const W = el.clientWidth; const mobile = W < 520;
  const H = height || (mobile ? 190 : 220);
  const m = { l: mobile ? 44 : 56, r: 8, t: 12, b: 24 };
  const pw = W - m.l - m.r; const ph = H - m.t - m.b;
  const n = weeks.length; const col = pw / n;
  const { top, step } = niceMax(Math.max(...weeks.map(total)));
  const y = (v) => m.t + ph - (v / top) * ph;
  const x = (i) => m.l + col * i + col / 2;
  let g = '';
  // Grade e rótulos do eixo vertical.
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  // Rótulos das semanas: a cada 4 (a cada 6 no celular), sempre com a última.
  const every = mobile ? 6 : 4;
  weeks.forEach((w, i) => { if ((n - 1 - i) % every === 0) g += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${dm(w.week)}</text>`; });
  let marks = '';
  if (kind === 'bars') {
    const bw = Math.max(3, Math.min(16, col * 0.62));
    weeks.forEach((w, i) => {
      let base = y(0); const parts = series.map((s) => ({ cls: s.cls, v: s.value(w) })).filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        const h = (p.v / top) * ph - (j ? 2 : 0); // 2 px de espaço entre as partes empilhadas
        if (h <= 0) return;
        const last = j === parts.length - 1;
        marks += last ? `<path class="mk ${p.cls}" d="${roundTop(x(i) - bw / 2, base - (j ? 2 : 0) - h, bw, h, Math.min(4, bw / 2, h))}"/>`
          : `<rect class="mk ${p.cls}" x="${x(i) - bw / 2}" y="${base - (j ? 2 : 0) - h}" width="${bw}" height="${h}"/>`;
        base -= h + (j ? 2 : 0);
      });
    });
  } else {
    const pts = weeks.map((w, i) => [x(i), y(series[0].value(w))]);
    marks = `<path class="area ${series[0].cls}" d="M${pts[0][0]},${y(0)} L${pts.map((p) => p.join(',')).join(' L')} L${pts.at(-1)[0]},${y(0)} Z"/>
      <path class="ln ${series[0].cls}" d="M${pts.map((p) => p.join(',')).join(' L')}"/>`;
  }
  el.innerHTML = `<div class="m-plot" tabindex="0" role="img" aria-label="${esc(aria)} Use as setas para ver cada semana.">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect class="hl" x="0" y="${m.t}" width="${col}" height="${ph}" rx="4" visibility="hidden"/>${g}${marks}
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/><circle class="dot ${series[0].cls}" r="4.5" visibility="hidden"/></svg>
    <div class="m-tip" hidden></div></div>`;
  const plot = el.firstElementChild; const svg = plot.querySelector('svg'); const tipEl = plot.querySelector('.m-tip');
  const hl = svg.querySelector('.hl'); const cross = svg.querySelector('.cross'); const dot = svg.querySelector('.dot');
  let cur = -1;
  const show = (i) => {
    cur = Math.max(0, Math.min(n - 1, i));
    if (kind === 'bars') { hl.setAttribute('x', m.l + col * cur); hl.setAttribute('visibility', 'visible'); }
    else {
      cross.setAttribute('x1', x(cur)); cross.setAttribute('x2', x(cur)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(cur)); dot.setAttribute('cy', y(series[0].value(weeks[cur]))); dot.setAttribute('visibility', 'visible');
    }
    tipEl.innerHTML = tip(cur); tipEl.hidden = false;
    const left = Math.min(Math.max(x(cur) - tipEl.offsetWidth / 2, 0), W - tipEl.offsetWidth);
    tipEl.style.left = `${left}px`;
  };
  const hide = () => { cur = -1; tipEl.hidden = true; [hl, cross, dot].forEach((e) => e.setAttribute('visibility', 'hidden')); };
  // A área de toque é a coluna inteira da semana, maior que a barra.
  plot.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); show(Math.floor((e.clientX - r.left - m.l) / col)); });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? n - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(e.key === 'Home' ? 0 : n - 1); }
    else if (e.key === 'Escape') hide();
  });
}
// Retângulo com só os cantos de cima arredondados (o lado da base fica reto, apoiado no eixo).
function roundTop(x, y, w, h, r) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
