// Dados de referência compartilhados entre o servidor e o navegador (os dois importam este mesmo arquivo).

export const AREAS = [
  { id: 'psicologo', nome: 'Psicólogo(a)', desc: 'Psicoterapia para ansiedade, humor e relações.', ic: 'couch', conselho: 'CRP' },
  { id: 'psiquiatra', nome: 'Psiquiatra', desc: 'Médico: diagnóstico e tratamento com medicação.', ic: 'pill', conselho: 'CRM' },
  { id: 'psicanalista', nome: 'Psicanalista', desc: 'Escuta e autoconhecimento de longo prazo.', ic: 'brain', conselho: 'CRP' },
  { id: 'aba', nome: 'Terapeuta ABA', desc: 'Intervenção comportamental para crianças com TEA.', ic: 'puzzle', conselho: 'CRP' },
  { id: 'neuro', nome: 'Neuropsicólogo(a)', desc: 'Avaliação de TEA, TDAH e funções cognitivas.', ic: 'eye', conselho: 'CRP' },
  { id: 'to', nome: 'Terapeuta ocupacional', desc: 'Integração sensorial e autonomia no dia a dia.', ic: 'hand', conselho: 'CREFITO' },
];
export const areaById = (id) => AREAS.find((a) => a.id === id);

// Posição aproximada de bairros de São Paulo num mapa esquemático (0 a 100).
export const BAIRROS = {
  'Bela Vista': [48, 50], 'Butantã': [20, 58], 'Centro': [53, 44], 'Higienópolis': [48, 45],
  'Ipiranga': [66, 70], 'Lapa': [28, 36], 'Liberdade': [56, 52], 'Moema': [50, 73],
  'Mooca': [68, 52], 'Penha': [88, 33], 'Perdizes': [34, 39], 'Pinheiros': [33, 52],
  'Santana': [54, 20], 'Santo Amaro': [40, 90], 'Tatuapé': [76, 40], 'Vila Mariana': [56, 63],
};
export const BAIRRO_NAMES = Object.keys(BAIRROS);

// Distância aproximada em km entre dois bairros do mapa esquemático.
export function distanceKm(a, b) {
  const p = BAIRROS[a] || BAIRROS['Bela Vista'];
  const q = BAIRROS[b] || BAIRROS['Bela Vista'];
  return Math.round((Math.hypot(p[0] - q[0], p[1] - q[1]) * 0.32 + 0.6) * 10) / 10;
}

// Temas que o profissional marca no perfil e que a triagem procura.
export const TOPICS = [
  'Ansiedade', 'Depressão', 'TDAH', 'TEA', 'Luto', 'Relacionamentos', 'Terapia de casal', 'Família',
  'Estresse no trabalho', 'Autoestima', 'Autoconhecimento', 'Angústia', 'Procrastinação', 'Comunicação',
  'Orientação parental', 'Habilidades sociais', 'Rotina', 'Ansiedade infantil', 'Comportamento',
  'Dificuldade escolar', 'Seletividade alimentar', 'Autonomia', 'Integração sensorial',
];
export const AUDIENCES = ['Crianças', 'Adolescentes', 'Adultos', 'Famílias'];

export const PRICING = {
  commission: 0.12,      // comissão da plataforma sobre o valor da sessão
  plusDiscount: 0.10,    // desconto do Me Salva+ para o paciente (custeado pela plataforma)
  plusPrice: 1990,       // R$ 19,90 por mês, em centavos
  proPlanPrice: 4990,    // R$ 49,90 por mês, em centavos
  minSocial: 4000,       // valor mínimo de uma vaga social (R$ 40)
  maxSocial: 8000,
};

// Opções de resposta da triagem: motivos (adultos) e sinais observados (crianças).
export const TRIAGE = {
  motivos: [
    ['Ansiedade', 'Ansiedade ou preocupação constante'], ['Depressão', 'Tristeza ou desânimo'],
    ['TDAH', 'Dificuldade de concentração'], ['Relacionamentos', 'Problemas nos relacionamentos'],
    ['Luto', 'Luto ou perda'], ['Estresse no trabalho', 'Estresse no trabalho'],
    ['Autoconhecimento', 'Quero me conhecer melhor'],
  ],
  sinais: [
    'Fala pouco ou ainda não fala', 'Pouco contato visual', 'Prefere brincar sozinho(a)',
    'Movimentos ou falas repetitivas', 'Crises intensas quando a rotina muda',
    'Sensível a barulhos, texturas ou luzes', 'Dificuldades na escola',
  ],
};
