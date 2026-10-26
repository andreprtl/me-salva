// Telas comuns: entrada, login, cadastro, configurações, mensagens e sala de vídeo.
import {
  S, A, F, I, LAYERS, SCREENS, screen, api, run, go, back, tab, replace, resetTo, refresh, top, homeOf, every, onLeave,
  openLayer, closeLayer, confirmSheet, toast, esc, ic, wordmark, logoMark, avatar, backBtn, chipCheck, toggle,
  msgTime, when, setTheme, isDark, downloadBlob, copyText, $, repaintShell,
} from '../core.js';

// Layout de computador a partir de 960 px de largura.
const wide = () => matchMedia('(min-width: 960px)').matches;

/* ================= entrada ================= */
// Descrição de cada conta de demonstração na tela de entrada.
const DEMO_INFO = {
  'mariana@demo.mesalva.app': ['user', 'Paciente com sessões, mensagens e plano gratuito'],
  'rafael.nunes@demo.mesalva.app': ['briefcase', 'Profissional recém-formado com vagas sociais'],
  'fernanda.alves@demo.mesalva.app': ['briefcase', 'Psicóloga: o outro lado do chat e da sessão da Mariana'],
  'beatriz.campos@demo.mesalva.app': ['clock', 'Profissional aguardando verificação do registro'],
  'admin@demo.mesalva.app': ['shield', 'Administração: verificar registros e ver indicadores'],
};

// Tela inicial sem login: apresentação, botões das contas de demonstração, entrar e criar conta.
screen('entrada', {
  bare: true,
  load: () => api('/api/demo-accounts').catch(() => ({ accounts: [] })),
  view: (_, d) => `<div class="splash gut">
    <div class="sp-hero">${wordmark(wide() ? 72 : 58)}<div class="tagline">A sua terapia na palma da sua mão</div>
      <p class="muted" style="margin:0;max-width:34em">Conectamos pessoas e famílias a psicólogos, psiquiatras e terapeutas verificados, com triagem guiada, preço transparente e agendamento em poucos cliques.</p>
      <div class="sp-btns">
        <button class="btn btn-primary" data-a="go" data-v="login">${ic('user')}Entrar</button>
        <button class="btn btn-ghost" data-a="go" data-v="cadastro">${ic('plus')}Criar conta grátis</button>
      </div>
    </div>
    <div class="sp-feats">
      ${d.accounts.length ? `<section class="card sec"><div class="sec-h"><h2 class="h2">Contas de demonstração</h2><span class="small muted">senha: ${esc(d.password)}</span></div>
        <div class="demo">${d.accounts.map((a) => { const [icon, text] = DEMO_INFO[a.email] || ['user', a.role]; return `<button class="demo-btn" data-a="demoLogin" data-v="${esc(a.email)}"><span class="s-ic">${ic(icon)}</span><div class="grow"><b>${esc(a.name)}</b><span>${esc(text)}</span></div>${ic('chevR')}</button>`; }).join('')}</div>
        <div class="small muted">Os dados são fictícios e podem ser restaurados pela conta de administração.</div></section>`
      : `<div class="feat-card"><span class="s-ic">${ic('sparkle')}</span><div><b>Triagem guiada</b><span>Perguntas simples, sem jargão, que indicam o tipo de profissional certo, incluindo o caminho TEA/ABA.</span></div></div>
         <div class="feat-card"><span class="s-ic">${ic('verified')}</span><div><b>Profissionais verificados</b><span>Registro no conselho conferido antes de aparecer na busca.</span></div></div>
         <div class="feat-card lav"><span class="s-ic">${ic('heart')}</span><div><b>Vagas sociais</b><span>Recém-formados com supervisão abrem horários a partir de R$ 40.</span></div></div>`}
    </div>
    <div class="sp-note">MVP acadêmico · Empreendedorismo em Informática · USP</div>
  </div>`,
});

// Depois de entrar ou se cadastrar: guarda o usuário e abre a tela inicial do perfil.
async function afterLogin(user) {
  S.user = user;
  S.unread = user.unread || 0;
  tab(homeOf(user));
}
// Entra com uma conta de demonstração (senha demo1234).
A.demoLogin = (el) => run(async () => {
  const d = top().d;
  const r = await api('/api/auth/login', { method: 'POST', body: { email: el.dataset.v, password: d.password } });
  afterLogin(r.user);
}, el);

/* ================= login ================= */
// Entrar com e-mail e senha.
screen('login', {
  bare: true, width: 'narrow',
  view: () => `<div class="auth gut"><div class="auth-card">
    <div>${backBtn()}</div>
    <div class="row" style="gap:6px">${logoMark(44)}<div><div class="eyebrow">Me Salva</div><h1 class="h1">Entrar na sua conta</h1></div></div>
    <form class="form card" data-f="login" novalidate>
      <div class="field"><label for="lgEmail">E-mail</label><input class="input" id="lgEmail" name="email" type="email" autocomplete="email" required autofocus></div>
      <div class="field"><label for="lgPass">Senha</label><input class="input" id="lgPass" name="password" type="password" autocomplete="current-password" required></div>
      <div class="form-error" id="lgErr" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit">Entrar</button>
    </form>
    <p class="muted small" style="text-align:center;margin:0">Ainda não tem conta? <button class="link" data-a="go" data-v="cadastro">Criar conta grátis</button></p>
  </div></div>`,
});
F.login = (form) => run(async () => {
  const fd = new FormData(form);
  $('#lgErr').textContent = '';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
    afterLogin(r.user);
  } catch (e) { $('#lgErr').textContent = e.message; }
}, form.querySelector('[type=submit]'));

/* ================= cadastro ================= */
// Cadastro de paciente ou profissional; os campos profissionais só aparecem quando necessários.
screen('cadastro', {
  bare: true, width: 'narrow',
  view: (role = 'patient') => {
    const m = S.meta;
    return `<div class="auth gut"><div class="auth-card">
    <div>${backBtn()}</div>
    <div><div class="eyebrow">Criar conta</div><h1 class="h1">Comece em menos de 2 minutos</h1></div>
    <form class="form" data-f="cadastro" novalidate>
      <div class="seg" role="radiogroup" aria-label="Tipo de conta">
        <label style="flex:1"><input type="radio" name="role" value="patient" data-i="role" ${role === 'patient' ? 'checked' : ''} class="sr"><span class="segbtn">${ic('user')}Paciente ou responsável</span></label>
        <label style="flex:1"><input type="radio" name="role" value="pro" data-i="role" ${role === 'pro' ? 'checked' : ''} class="sr"><span class="segbtn">${ic('briefcase')}Profissional</span></label>
      </div>
      <section class="card form">
        <div class="field"><label for="cdName">Nome completo</label><input class="input" id="cdName" name="name" autocomplete="name" required></div>
        <div class="grid2">
          <div class="field"><label for="cdEmail">E-mail</label><input class="input" id="cdEmail" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="cdPass">Senha (mínimo 8 caracteres)</label><input class="input" id="cdPass" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        </div>
        <div class="field"><label for="cdBairro">Bairro em São Paulo (para calcular distâncias)</label><select class="input" id="cdBairro" name="bairro">${m.bairroNames.map((b) => `<option ${b === 'Bela Vista' ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
      </section>
      <section class="card form" id="proFields" ${role === 'pro' ? '' : 'hidden'}>
        <div class="h2">Dados profissionais</div>
        <div class="banner">${ic('shield')}<div><b>Seu perfil passa por verificação</b><span>Conferimos o registro no conselho antes de mostrar seu perfil na busca.</span></div></div>
        <div class="grid2">
          <div class="field"><label for="cdArea">Área de atuação</label><select class="input" id="cdArea" name="area" data-i="area">${m.areas.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
          <div class="field"><label for="cdReg">Registro no conselho</label><input class="input" id="cdReg" name="reg" placeholder="CRP 06/123456"></div>
          <div class="field"><label for="cdTitle">Como quer ser apresentado(a)</label><input class="input" id="cdTitle" name="title" placeholder="Psicóloga"></div>
          <div class="field"><label for="cdAppr">Abordagem</label><input class="input" id="cdAppr" name="approach" placeholder="Terapia Cognitivo-Comportamental"></div>
          <div class="field"><label for="cdPrice">Valor da sessão (R$)</label><input class="input" id="cdPrice" name="price" type="number" min="40" max="1000" step="5" value="100"></div>
          <div class="field"><label for="cdYears">Anos de experiência</label><input class="input" id="cdYears" name="years" type="number" min="0" max="60" value="0"></div>
        </div>
        <div class="field"><span class="lbl">Temas que atende</span><div class="chips">${m.topics.map((t) => chipCheck('topics', t, t)).join('')}</div></div>
        <div class="field"><span class="lbl">Público</span><div class="chips">${m.audiences.map((t) => chipCheck('audience', t, t)).join('')}</div></div>
        <div class="field"><span class="lbl">Modalidade</span><div class="chips">${chipCheck('modalities', 'online', 'Online', true)}${chipCheck('modalities', 'presencial', 'Presencial')}</div></div>
        <div class="field"><label for="cdBio">Apresentação para pacientes</label><textarea class="input" id="cdBio" name="bio" maxlength="800" placeholder="Conte como você trabalha e quem você atende."></textarea></div>
        <label class="check"><input type="checkbox" name="is_new" data-i="isNew"><span><b style="color:var(--ink)">Sou recém-formado(a) e tenho supervisão clínica.</b> Isso libera as vagas sociais.</span></label>
        <div class="field" id="supField" hidden><label for="cdSup">Supervisor(a) clínico(a) e registro</label><input class="input" id="cdSup" name="supervisor" placeholder="Nome (CRP 06/000000)"></div>
      </section>
      <label class="check"><input type="checkbox" name="consent" required><span>Li e aceito os termos de uso e a política de privacidade. Entendo que dados de saúde são dados sensíveis e serão usados só para o meu atendimento (LGPD).</span></label>
      <div class="form-error" id="cdErr" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit">Criar conta</button>
    </form>
  </div></div>`;
  },
});
// Mostram ou escondem campos conforme as escolhas no formulário.
I.role = (el) => { if (el.checked) $('#proFields').hidden = el.value !== 'pro'; };
I.isNew = (el) => { $('#supField').hidden = !el.checked; };
I.area = (el) => { const a = S.meta.areas.find((x) => x.id === el.value); $('#cdReg').placeholder = `${a.conselho} 06/123456`; };
// Envia o cadastro para /api/auth/register.
F.cadastro = (form) => run(async () => {
  const fd = new FormData(form);
  const role = fd.get('role');
  const body = { role, name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), bairro: fd.get('bairro'), consent: fd.get('consent') === 'on' };
  if (role === 'pro') {
    body.pro = {
      area: fd.get('area'), reg: fd.get('reg'), title: fd.get('title'), approach: fd.get('approach'),
      approach_short: String(fd.get('approach') || '').split(/[–-]/)[0].trim().slice(0, 30),
      price: Number(fd.get('price')), years: Number(fd.get('years')), bio: fd.get('bio'),
      topics: fd.getAll('topics'), audience: fd.getAll('audience'), modalities: fd.getAll('modalities'),
      is_new: fd.get('is_new') === 'on', supervisor: fd.get('supervisor'),
    };
  }
  $('#cdErr').textContent = '';
  try {
    const r = await api('/api/auth/register', { method: 'POST', body });
    await afterLogin(r.user);
    toast(role === 'pro' ? 'Conta criada. Seu registro está em verificação.' : 'Conta criada. Boas-vindas ao Me Salva!');
  } catch (e) { $('#cdErr').textContent = e.message; $('#cdErr').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}, form.querySelector('[type=submit]'));

/* ================= configurações ================= */
// Configurações: dados pessoais, tema escuro, exportação e exclusão de dados (LGPD) e saída.
screen('config', {
  tabs: true, width: 'narrow',
  view: () => {
    const u = S.user;
    return `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Conta</div><h1 class="h1">Configurações</h1></div></header>
    <main class="scroll gut">
      ${u.is_demo ? `<div class="banner">${ic('info')}<div><b>Conta de demonstração</b><span>Os dados desta conta são fictícios.</span></div></div>` : ''}
      <form class="card form" data-f="perfil">
        <div class="row"><span class="me-av" style="width:54px;height:54px;font-size:17px;cursor:default">${esc(u.name.split(' ').map((s) => s[0]).slice(0, 2).join(''))}</span><div class="grow"><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)}</div></div></div>
        <div class="field"><label for="cfName">Nome</label><input class="input" id="cfName" name="name" value="${esc(u.name)}"></div>
        <div class="grid2">
          <div class="field"><label for="cfBairro">Bairro</label><select class="input" id="cfBairro" name="bairro">${S.meta.bairroNames.map((b) => `<option ${b === u.bairro ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
          <div class="field"><label for="cfAddr">Endereço (opcional)</label><input class="input" id="cfAddr" name="address" value="${esc(u.address)}" placeholder="Rua e número"></div>
        </div>
        <button class="btn btn-ghost" type="submit">Salvar alterações</button>
      </form>
      <section class="sec"><div class="lbl">Aparência</div><div class="list">
        <div class="li static">${ic('moon')}<div class="li-t"><b>Tema escuro</b><span>O tema claro é o padrão da plataforma</span></div>${toggle('theme', isDark(), 'Tema escuro')}</div></div></section>
      ${u.role === 'patient' ? `<section class="sec"><div class="lbl">Plano</div><div class="list"><button class="li" data-a="tab" data-v="planos">${ic('crown')}<div class="li-t"><b>Meu plano</b><span>${u.plan === 'plus' ? 'Me Salva+ · R$ 19,90/mês' : 'Gratuito'}</span></div>${ic('chevR')}</button>
        <button class="li" data-a="tri">${ic('sparkle')}<div class="li-t"><b>Refazer triagem</b><span>Atualize suas necessidades e preferências</span></div>${ic('chevR')}</button></div></section>` : ''}
      <section class="sec"><div class="lbl">Privacidade e dados (LGPD)</div><div class="list">
        <button class="li" data-a="exportData">${ic('download')}<div class="li-t"><b>Baixar meus dados</b><span>Arquivo com tudo o que guardamos sobre você</span></div>${ic('chevR')}</button>
        ${u.role !== 'admin' ? `<button class="li" data-a="deleteAccount">${ic('trash')}<div class="li-t"><b>Excluir minha conta</b><span>Apaga seus dados; avaliações ficam anônimas</span></div>${ic('chevR')}</button>` : ''}
      </div></section>
      <section class="sec"><div class="lbl">Ajuda</div><div class="list">
        <button class="li" data-a="crise">${ic('lifebuoy')}<div class="li-t"><b>Ajuda imediata</b><span>CVV 188 · SAMU 192</span></div>${ic('chevR')}</button>
        <button class="li" data-a="logout">${ic('logout')}<div class="li-t"><b>Sair</b><span>Encerrar a sessão neste aparelho</span></div></button>
      </div></section>
      <div class="small muted" style="text-align:center">Me Salva · MVP 0.1 · projeto acadêmico</div>
    </main>`;
  },
});
F.perfil = (form) => run(async () => {
  const fd = new FormData(form);
  const r = await api('/api/me', { method: 'PATCH', body: { name: fd.get('name'), bairro: fd.get('bairro'), address: fd.get('address') } });
  S.user = r.user; toast('Dados atualizados.'); refresh();
}, form.querySelector('[type=submit]'));
A.theme = (el) => { const on = !isDark(); setTheme(on); el.classList.toggle('on', on); el.setAttribute('aria-checked', on); };
// Baixa um JSON com todos os dados da conta.
A.exportData = (el) => run(async () => {
  const res = await fetch('/api/me/export', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Não foi possível gerar o arquivo agora.');
  downloadBlob(await res.blob(), 'meus-dados-me-salva.json');
  toast('Arquivo com seus dados baixado.');
}, el);
A.deleteAccount = () => confirmSheet({ title: 'Excluir sua conta?', text: 'Seus dados, mensagens e triagens serão apagados. Sessões futuras serão canceladas. Esta ação não pode ser desfeita.', input: 'Digite EXCLUIR para confirmar', ok: 'Excluir conta', danger: true }, async (v) => {
  await api('/api/me', { method: 'DELETE', body: { confirm: String(v || '').trim().toUpperCase() } });
  S.user = null; closeLayer(); resetTo('entrada'); toast('Conta excluída.');
});
A.logout = (el) => run(async () => { await api('/api/auth/logout', { method: 'POST' }); S.user = null; S.call = null; resetTo('entrada'); }, el);

/* ================= ajuda imediata e menu do celular ================= */
// Folha de ajuda imediata com telefones de emergência (CVV 188), acessível em todas as telas.
A.crise = () => openLayer('crise');
LAYERS.crise = () => `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-label="Ajuda imediata">
  <div class="h2">Você não está sozinho(a)</div><p style="margin:0" class="muted">Se você está em perigo ou pensando em se machucar, procure ajuda agora. Ligue do seu celular:</p>
  <div class="hotline">${ic('lifebuoy')}<div class="grow"><b>188</b><div class="small muted">CVV · ligação gratuita, 24 horas. Também há chat em cvv.org.br</div></div><button class="btn btn-ghost btn-sm" data-a="copyNum" data-v="188">${ic('copy')}Copiar</button></div>
  <div class="hotline">${ic('heart')}<div class="grow"><b>192</b><div class="small muted">SAMU · emergência médica</div></div><button class="btn btn-ghost btn-sm" data-a="copyNum" data-v="192">${ic('copy')}Copiar</button></div>
  <div class="small muted">Em risco imediato, vá ao pronto-socorro mais próximo. O Me Salva não é um serviço de emergência.</div>
  <button class="btn btn-primary btn-block" data-a="close">Entendi</button></div>`;
A.copyNum = (el) => copyText(el.dataset.v, 'Número copiado: ' + el.dataset.v);
A.drawer = () => openLayer('drawer');
LAYERS.drawer = () => `<div class="scrim" data-a="close"></div><nav class="drawer" aria-label="Menu">
  <div class="row">${logoMark(40)}<div class="grow"><b>${esc(S.user.name)}</b><div class="small muted">${S.user.plan === 'plus' ? 'Me Salva+' : 'Plano gratuito'}</div></div><button class="icon-btn plain" data-a="close" aria-label="Fechar">${ic('x')}</button></div>
  <div class="list">
    <button class="li" data-a="tri">${ic('sparkle')}<div class="li-t"><b>Triagem gratuita</b></div></button>
    <button class="li" data-a="tab" data-v="planos">${ic('crown')}<div class="li-t"><b>Planos</b></div></button>
    <button class="li" data-a="tab" data-v="config">${ic('shield')}<div class="li-t"><b>Privacidade e dados</b></div></button>
  </div>
  <button class="crisis" data-a="crise">${ic('lifebuoy')}<div><b>Ajuda imediata</b><span>CVV 188 · SAMU 192</span></div></button>
  <div class="small muted" style="margin-top:auto">O Me Salva conecta você a profissionais habilitados. Não é um serviço de emergência.</div></nav>`;

/* ================= mensagens ================= */
// Lista de conversas (à esquerda no computador; tela própria no celular).
function convList(list, active) {
  if (!list.length) return `<div class="empty" style="padding:30px 16px">${ic('chat')}<div>Nenhuma conversa ainda.${S.user.role === 'patient' ? ' Abra o perfil de um profissional e toque em Mensagem.' : ''}</div></div>`;
  return `<div class="list chat-list" style="${wide() && active !== undefined ? 'border:0;border-radius:0' : ''}">${list.map((c) => `<button class="li ${c.other.id === active ? 'on' : ''}" data-a="openChat" data-v="${c.other.id}">${avatar(c.other.name, c.other.color, 48)}
    <div class="li-t"><b>${esc(c.other.name)}</b><span>${c.last.kind === 'audio' ? 'Mensagem de voz' : (c.last.sender_id === S.user.id ? 'Você: ' : '') + esc(c.last.body)}</span></div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="small muted">${msgTime(c.last.created_at)}</span>${c.unread && c.other.id !== active ? `<span class="unread">${c.unread}</span>` : ''}</div></button>`).join('')}</div>`;
}
// Mensagens: lista de conversas.
screen('chats', {
  tabs: true, nav: 'chats',
  load: () => api('/api/conversations'),
  view: (_, d) => {
    const head = `<header class="bar gut"><div class="bar-t"><div class="eyebrow">Conversas</div><h1 class="h1">Mensagens</h1></div></header>`;
    if (wide()) return head + `<div class="split"><div class="split-list">${convList(d.conversations, null)}</div><div class="split-main"><div class="pick"><div>${ic('chat')}<p style="margin:8px 0 0">Escolha uma conversa para abrir.</p><p class="small" style="margin:4px 0 0">${ic('lock')} As mensagens ficam protegidas e só você e o profissional têm acesso.</p></div></div></div></div>`;
    return head + `<main class="scroll gut">${convList(d.conversations)}<div class="disclaimer">${ic('lock')}<span>Só você e o profissional têm acesso às mensagens. Este chat não é para emergências: ligue 188 (CVV).</span></div></main>`;
  },
});
A.openChat = (el) => {
  const id = Number(el.dataset.v);
  const t = top();
  if (wide() && (t.n === 'chat' || t.n === 'chats')) replace('chat', id); else go('chat', id);
};

// Uma mensagem: texto, áudio com player ou aviso do sistema.
function bubble(m, me, other) {
  if (m.kind === 'system') return `<div class="e2e">${ic('info')}${esc(m.body)}</div>`;
  const mine = m.sender_id === me;
  const cls = mine ? 'me' : 'pro';
  if (m.kind === 'audio') {
    const bars = Array.from({ length: 28 }, (_, i) => `<i style="height:${20 + ((m.id * 7 + i * 13) % 80)}%"></i>`).join('');
    return `<div class="msg ${cls} audio" data-audio="${m.id}"><button class="au-play" data-a="playAudio" data-v="${m.id}" data-dur="${m.duration}" aria-label="Ouvir áudio">${ic('play', 'fill')}</button><div class="au-wave">${bars}</div><span class="au-time">0:${String(m.duration).padStart(2, '0')}</span></div>`;
  }
  return `<div class="msg ${cls}">${esc(m.body)}<small>${msgTime(m.created_at)}</small></div>`;
}
function bubbles(msgs, me, other) {
  let last = null;
  return msgs.map((m) => {
    let who = '';
    const key = m.kind === 'system' ? 'sys' : m.sender_id;
    if (key !== last && m.kind !== 'system') who = `<div class="who ${m.sender_id === me ? 'me' : ''}">${m.sender_id === me ? 'VOCÊ' : esc(other.name.split(' ')[0].toUpperCase())}</div>`;
    last = key;
    return who + bubble(m, me, other);
  }).join('');
}
const composer = () => S.rec
  ? `<button class="round" data-a="recCancel" aria-label="Cancelar gravação">${ic('x')}</button><div class="recbar" id="rectime">Gravando 0:00</div><button class="round send" data-a="recSend" aria-label="Enviar áudio">${ic('send')}</button>`
  : `<button class="round" data-a="rec" aria-label="Gravar áudio">${ic('mic')}</button><label class="grow"><span class="sr">Mensagem</span><input class="input" id="msgIn" placeholder="Escreva uma mensagem" autocomplete="off" maxlength="2000"></label><button class="round send" data-a="send" aria-label="Enviar">${ic('send')}</button>`;

// Conversa aberta. No computador, mostra a lista ao lado; busca mensagens novas a cada 3 segundos.
screen('chat', {
  nav: 'chats',
  load: async (id) => {
    const [conv, list] = await Promise.all([api(`/api/conversations/${id}`), wide() ? api('/api/conversations') : Promise.resolve(null)]);
    return { ...conv, list: list?.conversations || null };
  },
  view: (id, d) => {
    const inCall = S.call && S.call.otherId === id;
    const panel = `<div class="chat-head">${wide() ? '' : backBtn()}${avatar(d.other.name, d.other.color, 40)}<div class="grow"><b style="font-size:15px">${esc(d.other.name)}</b><div class="small muted">${esc(d.other.title)}</div></div>
      ${inCall ? `<button class="btn btn-teal btn-sm" data-a="toCall" style="white-space:nowrap">${ic('video')}Voltar · <span class="num" id="chatcall">${callTime()}</span></button>` : ''}
      ${S.user.role === 'patient' ? `<button class="icon-btn" data-a="go" data-v="perfil" data-p="${d.other.id}" aria-label="Ver perfil">${ic('user')}</button>` : `<button class="icon-btn" data-a="go" data-v="prontuario" data-p="${d.other.id}" aria-label="Prontuário">${ic('file')}</button>`}</div>
      <div class="msgs" id="msgs"><div class="e2e">${ic('lock')}Só vocês dois têm acesso a esta conversa. Em emergências, ligue 188 (CVV).</div>${bubbles(d.messages, d.me, d.other)}</div>
      <div class="composer" id="composer">${composer()}</div>`;
    if (wide()) return `<header class="bar gut">${S.stack.length > 1 ? backBtn() : ''}<div class="bar-t"><div class="eyebrow">Conversas</div><h1 class="h1">Mensagens</h1></div></header><div class="split"><div class="split-list">${convList(d.list || [], id)}</div><div class="split-main">${panel}</div></div>`;
    return `<div class="split-main">${panel}</div>`;
  },
  after: (id, d) => {
    const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight;
    api('/api/unread').then((r) => { S.unread = r.count; repaintShell(); }).catch(() => {});
    // Busca mensagens novas a cada 3 segundos enquanto a conversa está aberta.
    every(async () => {
      const t = top(); if (t.n !== 'chat' || t.p !== id) return;
      const lastId = t.d.messages.at(-1)?.id || 0;
      try {
        const r = await api(`/api/conversations/${id}?after=${lastId}`);
        if (r.messages.length) appendMsgs(r.messages);
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 3000);
    if (S.call) every(() => { const el = $('#chatcall'); if (el) el.textContent = callTime(); }, 1000);
    $('#msgIn')?.focus();
  },
});
// Acrescenta mensagens novas sem redesenhar a conversa inteira.
function appendMsgs(msgs) {
  const t = top(); const d = t.d;
  const fresh = msgs.filter((m) => !d.messages.some((x) => x.id === m.id));
  if (!fresh.length) return;
  d.messages.push(...fresh);
  const box = $('#msgs');
  if (!box) return;
  box.innerHTML = `<div class="e2e">${ic('lock')}Só vocês dois têm acesso a esta conversa. Em emergências, ligue 188 (CVV).</div>${bubbles(d.messages, d.me, d.other)}`;
  box.scrollTop = box.scrollHeight;
}
// Envia uma mensagem de texto.
A.send = (el) => run(async () => {
  const input = $('#msgIn'); const body = input.value.trim(); if (!body) return;
  const id = top().p;
  input.value = '';
  const r = await api(`/api/conversations/${id}`, { method: 'POST', body: { kind: 'text', body } });
  appendMsgs([r.message]);
  $('#msgIn')?.focus();
}, el);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'msgIn') { e.preventDefault(); A.send($('[data-a=send]')); } });

// Gravação de áudio com o microfone do aparelho (MediaRecorder).
A.rec = (el) => run(async () => {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Seu navegador não permite gravar áudio aqui.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw new Error('Permita o uso do microfone para gravar o áudio.'); }
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  S.rec = { rec, stream, chunks, start: Date.now() };
  rec.start();
  $('#composer').innerHTML = composer();
  S.rec.iv = setInterval(() => { const t = $('#rectime'); if (!t) return; const s = Math.floor((Date.now() - S.rec.start) / 1000); t.textContent = `Gravando 0:${String(s).padStart(2, '0')}`; if (s >= 59) A.recSend(); }, 250);
}, el);
function stopRec() { if (!S.rec) return null; clearInterval(S.rec.iv); const r = S.rec; S.rec = null; r.stream.getTracks().forEach((t) => t.stop()); return r; }
A.recCancel = () => { const r = stopRec(); if (r && r.rec.state !== 'inactive') r.rec.stop(); $('#composer').innerHTML = composer(); };
A.recSend = () => {
  const r = stopRec(); if (!r) return;
  const duration = Math.max(1, Math.round((Date.now() - r.start) / 1000));
  const id = top().p;
  r.rec.onstop = () => run(async () => {
    const blob = new Blob(r.chunks, { type: r.rec.mimeType || 'audio/webm' });
    const dataUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
    const res = await api(`/api/conversations/${id}`, { method: 'POST', body: { kind: 'audio', audio: dataUrl, duration } });
    if (top().p === id) appendMsgs([res.message]);
  });
  r.rec.stop();
  $('#composer').innerHTML = composer();
};
// Player único: tocar um áudio pausa o anterior.
let player = null;
A.playAudio = (el) => {
  const id = el.dataset.v;
  const box = el.closest('.audio');
  const bars = box.querySelectorAll('.au-wave i');
  const time = box.querySelector('.au-time');
  if (player && player.id === id) { if (player.audio.paused) player.audio.play(); else player.audio.pause(); return; }
  if (player) { player.audio.pause(); player.reset(); }
  const audio = new Audio(`/api/messages/${id}/audio`);
  const reset = () => { bars.forEach((b) => b.classList.remove('on')); el.innerHTML = ic('play', 'fill'); time.textContent = `0:${String(el.dataset.dur).padStart(2, '0')}`; };
  player = { id, audio, reset };
  audio.ontimeupdate = () => {
    const dur = Number.isFinite(audio.duration) ? audio.duration : Number(el.dataset.dur);
    const n = Math.round(audio.currentTime / dur * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < n));
    time.textContent = `0:${String(Math.max(0, Math.ceil(dur - audio.currentTime))).padStart(2, '0')}`;
  };
  audio.onplay = () => { el.innerHTML = ic('pause', 'fill'); };
  audio.onpause = () => { el.innerHTML = ic('play', 'fill'); };
  audio.onended = () => { reset(); player = null; };
  audio.play().catch(() => toast('Não foi possível tocar o áudio.', 'err'));
};

/* ================= sala de vídeo ================= */
// Cronômetro da sessão. O início fica em S.call, então ele continua ao ligar ou desligar a câmera e ao abrir o chat.
export const callTime = () => {
  if (!S.call) return '00:00';
  const s = Math.floor((Date.now() - S.call.start) / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
// Sala de vídeo: prévia da câmera, controles e link da videochamada (Jitsi).
screen('sessao', {
  nav: 'agenda',
  load: (id) => api(`/api/appointments/${id}/room`),
  view: (id, d) => {
    if (!S.call || S.call.id !== id) S.call = { id, start: Date.now(), mic: true, cam: true, otherId: d.other?.id };
    const c = S.call;
    const other = d.other || { name: 'Participante', title: '' };
    return `<div class="call">
      <div class="call-top"><span class="lock">${ic('lock')}Sala segura · ${esc(when(d.appointment.start))}</span><b class="num" id="calltime">${callTime()}</b></div>
      <div class="self" id="selfBox">${c.cam ? '<video id="selfVideo" autoplay muted playsinline></video>' : `<div class="self-off">${ic('videoOff')}<div>Câmera desligada</div></div>`}</div>
      <div class="call-main">${avatar(other.name, other.color, wide() ? 150 : 120)}<div class="call-name">${esc(other.name)}</div><div class="call-sub">${esc(other.title)} · sessão de 50 min</div></div>
      <div class="call-link"><a href="${esc(d.url)}" target="_blank" rel="noopener">${ic('external')}Abrir a videochamada com ${esc(other.name.split(' ')[0])}</a></div>
      <div class="breath">${ic('heart')}<span>Respire fundo. Este é um espaço só seu.</span></div>
      <div class="call-ctl">
        <button class="cbtn ${c.mic ? '' : 'off'}" data-a="cMic" aria-label="${c.mic ? 'Desligar' : 'Ligar'} microfone">${ic(c.mic ? 'mic' : 'micOff')}</button>
        <button class="cbtn ${c.cam ? '' : 'off'}" data-a="cCam" aria-label="${c.cam ? 'Desligar' : 'Ligar'} câmera">${ic(c.cam ? 'video' : 'videoOff')}</button>
        ${other.id ? `<button class="cbtn" data-a="callChat" aria-label="Abrir chat">${ic('chat')}</button>` : ''}
        <button class="cbtn end" data-a="endCall" aria-label="Encerrar sessão">${ic('phoneOff')}</button>
      </div></div>`;
  },
  after: () => {
    every(() => { const el = $('#calltime'); if (el) el.textContent = callTime(); }, 1000);
    startPreview();
    onLeave(stopPreview);
  },
});
// Prévia da própria câmera (fica só no aparelho; a chamada em si acontece na sala de vídeo).
async function startPreview() {
  const c = S.call;
  if (!c || !c.cam || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (S.call !== c || top().n !== 'sessao') { stream.getTracks().forEach((t) => t.stop()); return; }
    c.stream = stream;
    stream.getAudioTracks().forEach((t) => { t.enabled = c.mic; });
    const v = $('#selfVideo'); if (v) v.srcObject = stream;
  } catch {
    const box = $('#selfBox'); if (box) box.innerHTML = `<div class="self-off">${ic('videoOff')}<div>Permita a câmera para ver sua imagem</div></div>`;
  }
}
function stopPreview() { if (S.call?.stream) { S.call.stream.getTracks().forEach((t) => t.stop()); S.call.stream = null; } }
function repaintCall() { stopPreview(); const t = top(); $('#screen').innerHTML = SCREENS.sessao.view(t.p, t.d); startPreview(); }
A.cMic = () => { S.call.mic = !S.call.mic; S.call.stream?.getAudioTracks().forEach((t) => { t.enabled = S.call.mic; }); const b = $('[data-a=cMic]'); b.classList.toggle('off', !S.call.mic); b.innerHTML = ic(S.call.mic ? 'mic' : 'micOff'); };
A.cCam = () => { S.call.cam = !S.call.cam; repaintCall(); };
A.callChat = () => go('chat', S.call.otherId);
A.toCall = () => { const prev = S.stack[S.stack.length - 2]; if (prev && prev.n === 'sessao') back(); else go('sessao', S.call.id); };
// Encerra a sessão: o paciente vai para a avaliação e o profissional para o prontuário.
A.endCall = (el) => run(async () => {
  const id = S.call.id;
  const r = await api(`/api/appointments/${id}/finish`, { method: 'POST' });
  stopPreview(); S.call = null;
  if (S.user.role === 'patient') { S.stack = [{ n: 'agenda' }]; go('avaliar', id); toast('Sessão encerrada. Conte como foi!'); }
  else { S.stack = [{ n: 'proagenda' }]; go('prontuario', r.appointment.patient_id); toast('Sessão encerrada. Registre a evolução no prontuário.'); }
}, el);

export { wide };
