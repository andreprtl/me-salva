# Documentação técnica do MVP Me Salva

Este documento cobre a **versão 1.1** (chat em tempo real, central de notificações e lembretes de sessão). O que mudou em relação à 1.0 está no [CHANGELOG](../CHANGELOG.md).

Ele explica como o código do MVP está organizado, como as partes conversam entre si e onde mexer para fazer as mudanças mais comuns. Para rodar o projeto, publicar e usar as contas de demonstração, veja o [README](../README.md).

Todos os dados de demonstração são fictícios, e o pagamento é simulado.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Tecnologias e decisões](#2-tecnologias-e-decisões)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Servidor](#4-servidor)
5. [Interface](#5-interface)
6. [Modelo de dados](#6-modelo-de-dados)
7. [Regras de negócio](#7-regras-de-negócio)
8. [API completa](#8-api-completa)
9. [Segurança e LGPD](#9-segurança-e-lgpd)
10. [Dados de demonstração](#10-dados-de-demonstração)
11. [Testes](#11-testes)
12. [Como fazer mudanças comuns](#12-como-fazer-mudanças-comuns)
13. [Limitações conhecidas](#13-limitações-conhecidas)
14. [Glossário](#14-glossário)

## 1. Visão geral

O Me Salva conecta pacientes e famílias a profissionais de saúde mental verificados. O MVP cobre a jornada inteira de três perfis:

| Perfil | O que faz no MVP |
|---|---|
| Paciente (`patient`) | Faz a triagem, busca profissionais, agenda, paga (PIX ou cartão simulados), conversa no chat em tempo real, recebe notificações e lembretes, entra na sala de vídeo, avalia a sessão e assina o Me Salva+ |
| Profissional (`pro`) | Acompanha o painel, gerencia agenda e horários, configura vagas sociais, conversa com pacientes, recebe notificações e lembretes e escreve no prontuário criptografado |
| Administração (`admin`) | Vê indicadores, aprova ou recusa registros profissionais, restaura os dados de demonstração e dispara lembretes na demonstração |

É uma aplicação web única: o mesmo servidor entrega a API (`/api/...`) e os arquivos da interface (`public/`). A interface funciona no computador e no celular.

## 2. Tecnologias e decisões

| Escolha | Por quê |
|---|---|
| **Node.js 22.13+ sem dependências** | O projeto roda com `npm start` logo após o clone, sem `npm install`. Usa só módulos nativos: `node:http`, `node:sqlite` e `node:crypto`. |
| **SQLite embutido** (`node:sqlite`) | Banco relacional de verdade, num único arquivo (`data/mesalva.db`), sem servidor separado. |
| **JavaScript puro no navegador** (módulos ES) | Sem etapa de build. Cada tela é uma função que devolve HTML. |
| **Horários como texto local de São Paulo** | Sessões são gravadas como `'AAAA-MM-DDTHH:MM'` no fuso de São Paulo, então um servidor em UTC mostra os mesmos horários que o usuário vê (`src/time.js`). |
| **Dinheiro em centavos** | Todos os valores são inteiros em centavos, para evitar erros de arredondamento. |
| **Tempo real com Server-Sent Events (SSE)** | SSE é um fluxo em que o navegador abre uma conexão HTTP comum e o servidor vai escrevendo avisos nela, sempre numa direção (servidor → navegador). Escolhemos SSE e não WebSocket porque o servidor só precisa empurrar avisos; o envio continua pelas rotas POST de sempre, com a proteção CSRF; o navegador já traz o `EventSource` com reconexão automática; passa por proxies e por HTTP/2; e não precisa de nenhuma dependência. |
| **Regras de negócio em funções puras** | Horários (`slots.js`), preço (`pricing.js`) e emparelhamento (`matching.js`) não acessam o banco, o que facilita testar. |

A troca de SQLite por PostgreSQL e da interface por um aplicativo React Native está prevista na Fase 1 do PIPE.

## 3. Estrutura de pastas

```
me-salva-mvp/
├── server.js                 ponto de entrada: abre o banco, cria dados demo se vazio, liga os lembretes, sobe o HTTP
├── CHANGELOG.md              histórico das versões
├── package.json              versão e scripts start, dev, seed e test (sem dependências)
├── .env.example              variáveis de ambiente opcionais
├── Dockerfile · render.yaml  publicação em Docker ou no Render
├── src/                      servidor
│   ├── config.js             leitura das variáveis de ambiente
│   ├── app.js                monta a aplicação: segurança, CSRF, sessão, rotas, arquivos estáticos
│   ├── http.js               mini-framework: roteador, leitura de JSON, cookies, arquivos estáticos
│   ├── guards.js             requireUser e requireRole (controle de acesso)
│   ├── db.js                 esquema do banco e interface all/get/run/tx/afterCommit
│   ├── services.js           consultas reaproveitadas (profissionais, horários, chat, notificações, auditoria)
│   ├── realtime.js           distribuidor de eventos em tempo real (SSE): conexões por usuário e sinal de vida
│   ├── reminders.js          lembretes de sessão 24 h e 1 h antes
│   ├── time.js               datas no fuso de São Paulo
│   ├── validate.js           validação de entradas com mensagens em português
│   ├── security.js           scrypt, tokens, AES-256-GCM, limite de tentativas, PIX, Luhn
│   ├── pricing.js            valor da sessão e divisão plataforma/profissional
│   ├── slots.js              disponibilidade semanal → horários e vagas sociais
│   ├── matching.js           triagem → necessidades → ranking com motivos
│   ├── seed.js               dados de demonstração (também roda com `npm run seed`)
│   └── routes/
│       ├── auth.js           cadastro, entrada, saída, contas demo
│       ├── me.js             conta, Me Salva+, exportação e exclusão (LGPD)
│       ├── catalog.js        dados de referência, busca, perfil, horários, triagem
│       ├── appointments.js   reserva, pagamento, cancelamento, sala, encerramento, avaliação
│       ├── messages.js       conversas, mensagens de texto e áudio, "digitando…" e "visto"
│       ├── pro.js            painel, perfil, disponibilidade, vagas sociais, prontuário
│       ├── admin.js          indicadores, verificação de registros, restauração dos dados, lembretes da demonstração
│       ├── realtime.js       GET /api/stream (canal em tempo real)
│       └── notifications.js  lista e leitura das notificações
├── public/                   interface (servida como arquivos estáticos)
│   ├── index.html            casca da página: barra lateral, tela, abas, camadas
│   ├── css/styles.css        estilos (tema claro e escuro, computador e celular)
│   └── js/
│       ├── theme.js          aplica o tema salvo antes de desenhar
│       ├── app.js            inicialização e delegação de eventos
│       ├── realtime.js       EventSource da aba, reconexão, vigia e reserva por consulta periódica
│       ├── core.js           estado, chamadas à API, navegação, menus, ícones, formatação
│       ├── shared/data.js    áreas, bairros, temas, preços e textos da triagem (usado também pelo servidor)
│       └── screens/
│           ├── common.js     entrada, login, cadastro, configurações, chat, sala de vídeo
│           ├── notifications.js  painel do sino, avisos do sistema e convite para ativá-los
│           ├── patient.js    início, busca, perfil, agendamento, pagamento, agenda, triagem, avaliação, planos
│           └── pro.js        painel, agenda, horários, perfil, prontuário e administração
├── test/
│   ├── domain.test.js        regras puras (horários, preço, emparelhamento, segurança)
│   ├── api.test.js           fluxo completo pela API com banco temporário
│   └── realtime.test.js      tempo real, notificações e lembretes
├── docs/
│   ├── DOCUMENTACAO.md       este documento
│   └── img/                  capturas de tela
└── data/                     criada na primeira execução: mesalva.db e notes.key (fora do Git)
```

## 4. Servidor

### 4.1 Caminho de uma requisição

```mermaid
sequenceDiagram
  participant N as Navegador
  participant A as app.js
  participant R as routes/*.js
  participant D as SQLite
  N->>A: POST /api/appointments (cookie + x-ms-client: web)
  A->>A: cabeçalhos de segurança (CSP, nosniff, frame)
  A->>A: encontra a rota no roteador (404 / 405)
  A->>A: confere x-ms-client (CSRF) e lê o JSON
  A->>D: busca a sessão pelo hash do token
  A->>R: requireRole('patient') → handler
  R->>D: consultas e transação
  R-->>A: objeto de resposta
  A-->>N: 200 JSON (ou { error } com o status certo)
```

Pontos importantes:

- **Rotas** são registradas por arquivos em `src/routes/`. Cada arquivo exporta uma função `(router, ctx)`, chamada uma vez em `createApp`. O `ctx` traz `db`, `config`, `svc` (serviços) e `notesKey`.
- **Handlers em sequência**: `r.get('/api/pro/dashboard', requireRole('pro'), handler)`. A guarda lança erro se o acesso não for permitido; o handler devolve um objeto, que vira JSON.
- **Erros**: as rotas lançam `HttpError(status, mensagem)` ou usam `bad(mensagem)` (400). A mensagem chega pronta para aparecer na tela. Erros inesperados vão para o log e o usuário recebe uma mensagem genérica.
- **Arquivos estáticos**: qualquer caminho fora de `/api/` é procurado em `public/`. Se não existir, o servidor devolve `index.html`, e a interface decide a tela.

### 4.2 Serviços compartilhados (`services.js`)

| Função | Para que serve |
|---|---|
| `getPro(id)` / `listPros(where)` | Profissional com nota média e número de avaliações |
| `template(id)` | Disponibilidade semanal do profissional |
| `slotsFor(pro)` | Horários dos próximos 14 dias, já sem reservas vencidas |
| `expirePending()` | Cancela reservas não pagas há mais de 15 minutos |
| `pushMessage(...)` | Grava mensagem no chat (inclusive avisos automáticos), cria a notificação de quem recebeu e empurra a mensagem em tempo real depois do COMMIT |
| `unreadCount(user)` | Número de mensagens não lidas |
| `notify(userId, {...})` | Cria uma notificação e a empurra em tempo real. Com `ref`, reaproveita a notificação do mesmo assunto (ela volta a ficar não lida e sobe para o topo) |
| `readChatNotifications(userId, otherId)` | Marca como lidas as notificações de mensagem de uma conversa |
| `counts(userId)` / `sendCounts(userId)` | Contadores de mensagens e de notificações não lidas; `sendCounts` os envia a todas as abas do usuário |
| `messageView(m)` / `notificationView(n)` | Formato de mensagem (com o campo `seen`) e de notificação enviado ao navegador |
| `roomOpen(appt)` | Se a sala de vídeo já pode ser aberta |
| `audit(user, ação, alvo)` | Registro na trilha de auditoria |

### 4.3 Tempo real (SSE)

O arquivo `src/realtime.js` cria o distribuidor de eventos (`createHub`), e a rota `GET /api/stream` (`src/routes/realtime.js`) abre o fluxo para o usuário logado, identificado pelo cookie de sessão como nas outras rotas. Cada aba aberta mantém uma conexão.

- **Conexões por usuário**: o distribuidor guarda as conexões de cada usuário na memória do servidor. O máximo é de 8 abas por usuário; quando passa disso, a conexão mais antiga é fechada.
- **Sinal de vida (`ping`)**: a cada 25 segundos o servidor manda um `ping`, que também evita que proxies cortem a conexão parada. Nesse momento ele confere se a sessão de cada conexão ainda existe e não venceu; se não, fecha a conexão.
- **Fechamento imediato**: sair da conta (logout), excluir a conta e "Restaurar dados de demonstração" fecham as conexões na hora.
- **Só depois do COMMIT**: `db.afterCommit(fn)` (em `src/db.js`) guarda a função durante uma transação e a executa só depois do COMMIT; numa transação desfeita (ROLLBACK), ela é descartada. Assim nenhum evento anuncia um dado que acabou não sendo gravado. Fora de uma transação, a função roda na hora.

Eventos enviados:

| Evento | Dados | Quando |
|---|---|---|
| `hello` | `{ messages, notifications }` | Ao conectar ou reconectar, com os contadores atuais |
| `counts` | `{ messages, notifications }` | Quando algum contador de não lidas muda |
| `message` | `{ conversation, message }` | Mensagem nova, para as duas pessoas da conversa; `conversation` é o id da outra pessoa, do ponto de vista de quem recebe |
| `typing` | `{ conversation }` | A outra pessoa está digitando |
| `read` | `{ conversation, upTo }` | A outra pessoa abriu a conversa; as mensagens até o id `upTo` foram vistas |
| `notification` | `{ notification }` | Notificação nova ou atualizada |
| `ping` | `{ t }` | Sinal de vida, a cada 25 s |

**Regra de segurança**: o destinatário de um evento é sempre um id de usuário decidido pelo servidor a partir do banco, nunca um valor enviado pelo navegador. Uma conexão só recebe eventos do próprio usuário, e uma mensagem vai só para as duas pessoas da conversa.

### 4.4 Lembretes

O arquivo `src/reminders.js` manda um lembrete 24 horas e outro 1 hora antes de cada sessão confirmada. O `server.js` liga a conferência: ela roda ao iniciar e depois a cada minuto.

- A cada conferência, o servidor olha as sessões confirmadas que começam nas próximas 24 horas.
- Se faltam mais de 60 minutos, vale o lembrete de 24 h; se faltam 60 minutos ou menos, vale o de 1 h. Só o mais próximo vale: quem marca em cima da hora recebe apenas o de 1 h.
- A tabela `reminders` tem a chave (`appointment_id`, `kind`), com `kind` igual a `24h` ou `1h`. Ela garante que o mesmo lembrete nunca seja enviado duas vezes, mesmo que a conferência rode de novo ou o botão da demonstração seja apertado várias vezes.
- Cada lembrete gera uma mensagem automática no chat da sessão (por exemplo, "Lembrete: a sessão é hoje (17/11) às 13:00, online. A sala abre 15 minutos antes do horário.") e uma notificação para o paciente e outra para o profissional. A sala só é mencionada nas sessões online.
- Os textos de data usam `whenText` (em `src/time.js`): "hoje (17/11) às 13:00", "amanhã (18/11) às 10:00" ou "qua, 25/11 às 09:00".
- **Modo demonstração**: a administração tem o botão "Disparar lembretes agora" (`POST /api/admin/reminders/run`, só para a administração e só com `DEMO_MODE=true`). Ele antecipa o lembrete de 1 h das sessões que começam nas próximas 3 horas.

## 5. Interface

A interface é uma aplicação de página única, em JavaScript puro.

- **Registro de telas** (`core.js`): cada tela é registrada com `screen(nome, { load, view, after, nav, tabs, width, bare })`. `load` busca os dados, `view` devolve o HTML e `after` roda depois de desenhar.
- **Navegação em pilha**: `go(tela, parâmetro)` abre uma tela por cima, `back()` volta, `tab(tela)` recomeça a pilha (itens do menu) e `replace` troca a tela atual.
- **Eventos por delegação** (`app.js`): o HTML não tem `onclick`. Botões usam `data-a="nomeDaAcao"` (funções em `A`), formulários usam `data-f` (funções em `F`) e campos usam `data-i` (funções em `I`). Isso permite a CSP sem scripts inline.
- **Camadas**: folhas sobrepostas (confirmação, filtros, ajuda imediata, carregando) usam `openLayer(tipo, dados)` e as funções em `LAYERS`.
- **Tempo real** (`public/js/realtime.js`): cada aba abre um `EventSource` em `/api/stream`. As telas se inscrevem nos eventos com `onLive(evento, função)`; o evento interno `_open` avisa que o canal (re)conectou, para a tela buscar o que chegou durante a queda. Se o canal cai, o navegador tenta de novo em 3 segundos; se o servidor recusa a conexão, a interface tenta de novo com uma espera que dobra de 3 s até 30 s. Um vigia reabre a conexão se ela ficar 60 segundos sem nenhum dado, e ao voltar para a aba a conexão é reaberta se tiver caído.
- **Reserva (consulta periódica)**: enquanto o canal não está aberto (`S.live` é falso), a interface volta ao que a v1.0 fazia: o chat aberto busca mensagens novas a cada 3 segundos, e os contadores de não lidas são consultados a cada 15 segundos.
- **Chat em tempo real** (`screens/common.js`): a mensagem nova aparece na hora dos dois lados; a lista de conversas e os contadores se atualizam sozinhos, sem apagar o que está sendo digitado. Com a aba em segundo plano, a conversa aberta não marca como lida; marca quando a pessoa volta.
- **Sino e painel** (`screens/notifications.js`): o sino com contador fica na barra lateral (computador) e nos cabeçalhos das telas principais do celular; ele não aparece para a administração. O painel abre à direita (tela cheia no celular), tem "Marcar todas como lidas" e, ao clicar numa notificação, marca como lida e abre a tela certa (conversa, agenda, painel ou perfil). Com o painel fechado e a aba à vista, chega um aviso rápido (toast).
- **Aviso do sistema (notificação do navegador)**: aparece só com a aba em segundo plano, com a permissão concedida e a preferência ligada. A permissão só é pedida por um clique: no convite da tela "Sessão agendada!" (que some de vez com "Agora não"), no fim do painel do sino e em Configurações → Avisos do navegador, que liga e desliga neste aparelho (guardado em `localStorage`, na chave `ms-notify`). A etiqueta (`tag`) do aviso é a mesma em todas as abas, então aparece um só. No Android e no iPhone, o aviso do sistema depende do service worker e do aplicativo instalável, previstos para a v1.2.
- **Layout**: a partir de 960 px de largura, a interface usa barra lateral; abaixo disso, abas inferiores de aplicativo.
- **Tema**: claro por padrão; o escuro é ligado em Configurações e lembrado no navegador.
- **Segurança**: todo texto vindo da API passa por `esc()` antes de entrar no HTML.

Telas por arquivo:

| Arquivo | Telas |
|---|---|
| `screens/common.js` | `entrada`, `login`, `cadastro`, `config`, `chats`, `chat`, `sessao` |
| `screens/notifications.js` | Sem tela própria: painel do sino (camada `notifs`), avisos do sistema, convite e linha de Configurações |
| `screens/patient.js` | `home`, `areas`, `busca`, `perfil`, `agendar`, `pagamento`, `pix`, `confirmado`, `agenda`, `avaliar`, `triagem`, `trires`, `planos` |
| `screens/pro.js` | `painel`, `proagenda`, `horarios`, `properfil`, `prontuario`, `admin` |

## 6. Modelo de dados

```mermaid
erDiagram
  users ||--o| pros : "perfil profissional"
  users ||--o{ sessions : "logins"
  pros ||--o{ availability : "disponibilidade semanal"
  users ||--o{ appointments : "paciente"
  pros ||--o{ appointments : "profissional"
  appointments ||--o{ payments : "cobranças"
  appointments ||--o| reviews : "avaliação"
  users ||--o{ messages : "conversa"
  users ||--o{ triages : "triagens"
  pros ||--o{ notes : "prontuário"
  users ||--o{ notifications : "avisos"
  appointments ||--o{ reminders : "lembretes enviados"
```

| Tabela | Campos principais | Observações |
|---|---|---|
| `users` | `role`, `name`, `email`, `pass_hash`, `bairro`, `plan` | `role` é `patient`, `pro` ou `admin`; `plan` é `free` ou `plus` |
| `sessions` | `token_hash`, `user_id`, `expires_at` | Guarda só o hash SHA-256 do token; vale 7 dias |
| `pros` | `area`, `reg`, `topics`, `audience`, `modalities`, `price`, `is_new`, `supervisor`, `social_price`, `social_weekly`, `auto_fill`, `status` | `status` é `pending`, `verified` ou `rejected`; listas em JSON |
| `availability` | `pro_id`, `weekday`, `hour` | Um registro por horário semanal (0 = domingo) |
| `appointments` | `start`, `modality`, `social`, `base_price`, `amount`, `fee`, `pro_amount`, `status`, `room`, `expires_at` | Índice único `appt_slot` impede duas reservas ativas no mesmo horário |
| `payments` | `kind`, `method`, `amount`, `fee`, `pro_amount`, `status`, `pix_code`, `card_last4` | `kind` é `session` ou `plus`; `status`: `pending`, `paid`, `refunded`, `expired`, `failed` |
| `messages` | `patient_id`, `pro_id`, `sender_id`, `kind`, `body`, `audio`, `read_by_*` | `kind` é `text`, `audio` ou `system`; áudio guardado como data URL |
| `reviews` | `appointment_id` (único), `rating`, `tags`, `text`, `author_label` | Uma por sessão realizada |
| `triages` | `answers`, `needs` | Respostas e critérios derivados, em JSON |
| `notes` | `pro_id`, `patient_id`, `iv`, `tag`, `data` | Texto do prontuário criptografado com AES-256-GCM |
| `audit` | `user_id`, `action`, `target` | Ex.: `login`, `notes.read`, `pro.verified`, `data.export` |
| `notifications` | `user_id`, `kind`, `title`, `body`, `screen`, `param`, `ref`, `read_at`, `created_at` | `kind` é `message`, `confirmed`, `cancelled`, `reminder`, `review`, `verified` ou `rejected`; `screen` e `param` dizem qual tela abrir ao clicar; `ref` agrupa avisos do mesmo assunto (`chat:12`); `read_at` fica vazio enquanto não lida |
| `reminders` | `appointment_id`, `kind`, `sent_at` | Chave (`appointment_id`, `kind`), com `kind` igual a `24h` ou `1h`: impede lembrete repetido |

O esquema fica em `src/db.js`. Como ele usa `CREATE TABLE IF NOT EXISTS`, uma tabela nova é criada sozinha num banco que já existe, mas uma coluna nova (ou uma regra `CHECK` nova) não é: no MVP, apague `data/mesalva.db` e reinicie. A v1.1 só acrescentou as tabelas `notifications` e `reminders` e nenhuma coluna em tabela antiga, então um banco da v1.0 continua servindo sem ser apagado. O "visto" do chat usa os campos `read_by_patient` e `read_by_pro` que já existiam.

## 7. Regras de negócio

### 7.1 Ciclo de uma sessão

```mermaid
stateDiagram-v2
  [*] --> pending_payment: paciente reserva
  pending_payment --> confirmed: pagamento aprovado
  pending_payment --> cancelled: 15 min sem pagar, cartão recusado ou cancelamento
  confirmed --> done: sessão encerrada
  confirmed --> no_show: profissional registra falta
  confirmed --> cancelled: paciente até 24 h antes, ou profissional a qualquer momento
  done --> [*]
```

- Ao confirmar, o sistema cria o nome da sala de vídeo e manda um aviso automático no chat.
- Cancelamento de sessão paga devolve o valor (`payments.status = refunded`) e avisa no chat.
- A sala de vídeo abre 15 minutos antes e fecha 60 minutos depois do início. No modo demonstração (`DEMO_MODE=true`), fica aberta no dia todo.

### 7.2 Horários e vagas sociais (`slots.js`)

- Os horários dos próximos 14 dias são gerados a partir da disponibilidade semanal do profissional.
- Horários que começam em menos de 1 hora não são oferecidos.
- **Vagas sociais** só existem para profissionais recém-formados (`is_new`) com supervisor cadastrado e valor social definido (R$ 40 a R$ 80, abaixo do valor normal).
- As primeiras N vagas de cada semana (de segunda a domingo) são sociais, onde N é `social_weekly` (0 a 12).
- Com o **preenchimento automático** ligado, qualquer horário livre nas próximas 24 horas também vira vaga social.

### 7.3 Preço e divisão (`pricing.js`)

O profissional sempre recebe 88% do valor de tabela (ou do valor social). O desconto do Me Salva+ (10%) sai da parte da plataforma.

| Caso (sessão de R$ 100) | Paciente paga | Profissional recebe | Plataforma fica com |
|---|---|---|---|
| Plano gratuito | R$ 100,00 | R$ 88,00 | R$ 12,00 |
| Me Salva+ | R$ 90,00 | R$ 88,00 | R$ 2,00 |
| Vaga social de R$ 45, plano gratuito | R$ 45,00 | R$ 39,60 | R$ 5,40 |

Os percentuais e preços ficam em `PRICING`, no arquivo `public/js/shared/data.js`.

### 7.4 Triagem e emparelhamento (`matching.js`)

**1. Necessidades.** `deriveNeeds(respostas)` transforma as respostas leigas em critérios:

| Situação | Áreas indicadas (peso de 0 a 1) | Outros critérios |
|---|---|---|
| Criança com TEA confirmado | ABA 1 · Terapia ocupacional 0,5 · Psicologia 0,4 | Tema TEA; sinais viram temas (comunicação, rotina, integração sensorial…); apoio "muito" → alta frequência |
| Criança em investigação ou sem diagnóstico | Neuropsicologia 1 · Psiquiatria 0,9 · ABA 0,6 · Psicologia 0,3 | Mesmo tratamento dos sinais |
| Adulto | Psicologia 1 · Psicanálise 0,5 (0,9 se "autoconhecimento") · Psiquiatria 0,7 se TDAH | Motivos viram temas; sintomas intensos → urgência e psiquiatria 0,9 |

Também entram público (crianças, adolescentes ou adultos), modalidade, orçamento máximo e períodos do dia.

**2. Restrições obrigatórias.** Fica de fora quem não é de uma área indicada, não atende o público, não tem horário livre em 14 dias, não atende na modalidade escolhida ou custa mais que o orçamento (considerando a vaga social livre). Se sobrarem menos de 3 opções, a busca é ampliada: primeiro o orçamento e depois a modalidade. O cartão avisa o que não foi atendido.

**3. Pontuação.** Cada critério vira um número de 0 a 1, e a nota final (0 a 100) é a média ponderada:

| Critério | Peso | Como é medido |
|---|---|---|
| Área | 30 | Peso da área na tabela acima |
| Temas | 22 | Temas da triagem presentes no perfil (até 3) |
| Avaliação | 14 | Nota bayesiana: com poucas avaliações, a nota é puxada para 4,0 |
| Disponibilidade | 12 | Horários livres no período preferido (3 ou mais = máximo) |
| Distância | 10 | Até 20 km, quando o atendimento presencial importa |
| Experiência | 6 | Anos de atuação (10 ou mais = máximo) |
| Orçamento | 6 | Cabe ou não no valor informado |

**4. Ordem e explicação.** Quem atende a todas as restrições vem primeiro; depois vale a nota. Cada indicação mostra os três motivos que mais pesaram, como "Vaga social de R$ 45 cabe no seu orçamento". A rota `/api/triage` devolve as 5 primeiras indicações.

Os pesos são uma versão inicial definida pela equipe e serão revistos com especialistas (atividade A2 do PIPE). Há um teste que garante menos de 300 ms com 10 mil perfis.

### 7.5 Outras regras

| Tema | Regra |
|---|---|
| Cadastro de profissional | Registro precisa começar com o conselho da área (CRP, CRM ou CREFITO); recém-formado precisa informar supervisor; valor entre R$ 40 e R$ 1.000 |
| Verificação | Profissional novo fica `pending` e não aparece na busca até a administração aprovar |
| Reserva | Horário fica guardado por 15 minutos até o pagamento; o servidor recalcula horário e preço |
| Cartão de teste | 4242 4242 4242 4242 é aprovado; 4000 0000 0000 0002 é recusado e libera o horário |
| Avaliação | Só depois de sessão realizada, uma por sessão, nota de 1 a 5, destaques, comentário de até 600 caracteres e opção anônima |
| Chat | Profissional só conversa com quem tem ou teve sessão com ele; áudio de até cerca de 1 minuto; o "digitando…" segue a mesma regra |
| Prontuário | Só para pacientes da agenda do profissional; toda leitura e escrita vai para a auditoria |
| Disponibilidade | Horários cheios das 07:00 às 21:00, de domingo a sábado |
| Ocupação no painel | Sessões ocupadas ÷ horários oferecidos pela disponibilidade atual, mês a mês, até hoje |

### 7.6 Notificações e lembretes

Cada notificação fica na tabela `notifications` e é empurrada em tempo real para as abas de quem a recebe.

| Tipo (`kind`) | Quando | Quem recebe | Tela que abre |
|---|---|---|---|
| `message` | Chega mensagem de texto ou áudio | Quem recebeu a mensagem | Conversa (`chat`) |
| `confirmed` | Pagamento aprovado e sessão confirmada | Paciente e profissional | Agenda (`agenda`) ou agenda do profissional (`proagenda`) |
| `cancelled` | Sessão confirmada é cancelada | Só o outro lado: quem cancelou não recebe | `agenda` ou `proagenda` |
| `reminder` | 24 h ou 1 h antes da sessão (seção 4.4) | Paciente e profissional | `agenda` ou `proagenda` |
| `review` | Paciente avalia a sessão | Profissional | Perfil (`perfil`) |
| `verified` | Administração aprova o registro | Profissional | Painel (`painel`) |
| `rejected` | Administração recusa o registro | Profissional | Meu perfil (`properfil`) |

Regras:

- **Um aviso por conversa**: as mensagens de uma conversa compartilham uma notificação só ("Fernanda Alves enviou 3 mensagens."). A cada mensagem nova, ela volta a ficar não lida e sobe para o topo. Abrir a conversa marca o aviso dela como lido.
- **Sem o texto da mensagem**: o texto nunca entra na notificação, porque o aviso do sistema pode aparecer na tela bloqueada e o assunto é saúde.
- **Visto**: um tique significa enviada, e dois tiques significam vista pela outra pessoa; embaixo da minha última mensagem lida aparece "Visto". A pessoa vê a mensagem quando abre a conversa com a aba à vista; nesse momento o servidor marca como lido e manda o evento `read` ao outro lado. Mensagens do sistema não têm visto.
- **Digitando**: a interface avisa no máximo a cada 2,5 segundos; o servidor repassa no máximo 1 aviso por segundo por conversa; a mensagem "Fulana está digitando…" some 4 segundos depois do último aviso ou quando a mensagem chega.

## 8. API completa

Todas as rotas respondem JSON, exceto `/api/stream`, que responde um fluxo `text/event-stream`. Chamadas que alteram dados (POST, PUT, PATCH, DELETE) precisam do cabeçalho `x-ms-client: web`. Valores em dinheiro vêm em centavos.

| Método | Rota | Quem pode | O que faz |
|---|---|---|---|
| POST | `/api/auth/register` | Qualquer pessoa | Cria conta de paciente ou profissional e já entra |
| POST | `/api/auth/login` | Qualquer pessoa | Entra com e-mail e senha |
| POST | `/api/auth/logout` | Qualquer pessoa | Sai e apaga a sessão |
| GET | `/api/demo-accounts` | Qualquer pessoa | Contas de demonstração (só no modo demo) |
| GET | `/api/me` | Qualquer pessoa | Usuário logado ou `null` (traz `unread` e `notifications`, os contadores) |
| PATCH | `/api/me` | Logado | Atualiza nome, bairro e endereço |
| DELETE | `/api/me` | Logado (não admin) | Exclui a conta (corpo `{ "confirm": "EXCLUIR" }`) |
| GET | `/api/me/export` | Logado | Baixa todos os dados da conta em JSON (inclui as notificações) |
| POST | `/api/me/plan` | Paciente | Assina ou cancela o Me Salva+ (`action`: `subscribe` ou `cancel`) |
| GET | `/api/unread` | Logado | Contadores de não lidas: `{ count, notifications }` (reserva do tempo real) |
| GET | `/api/meta` | Qualquer pessoa | Áreas, bairros, temas, preços e textos da triagem |
| GET | `/api/pros` | Qualquer pessoa | Busca com `area`, `q`, `modality`, `max`, `social`, `sort` |
| GET | `/api/pros/:id` | Qualquer pessoa | Perfil, avaliações e distribuição de notas |
| GET | `/api/pros/:id/slots` | Qualquer pessoa | Horários de 14 dias com o valor para o usuário |
| POST | `/api/triage` | Logado | Recebe `answers` e devolve necessidades e indicações |
| GET | `/api/appointments` | Paciente ou profissional | Próximas sessões e histórico |
| GET | `/api/appointments/:id` | Participante | Uma sessão |
| POST | `/api/appointments` | Paciente | Reserva (`pro_id`, `start`, `modality`, `method`) e cria a cobrança |
| GET | `/api/payments/:id` | Dono do pagamento | Situação do pagamento |
| POST | `/api/payments/:id/pix-simulate` | Dono do pagamento | Simula a confirmação do PIX |
| POST | `/api/payments/:id/card` | Dono do pagamento | Paga com cartão de teste (`card`: `number`, `name`, `exp`, `cvv`) |
| POST | `/api/appointments/:id/cancel` | Participante | Cancela (regra de 24 h para o paciente) |
| GET | `/api/appointments/:id/room` | Participante | Link da sala de vídeo |
| POST | `/api/appointments/:id/finish` | Participante | Marca a sessão como realizada |
| POST | `/api/appointments/:id/no-show` | Profissional | Registra falta do paciente |
| POST | `/api/appointments/:id/review` | Paciente | Avalia (`rating`, `tags`, `text`, `anonymous`) |
| GET | `/api/review-tags` | Qualquer pessoa | Destaques possíveis na avaliação |
| GET | `/api/conversations` | Paciente ou profissional | Lista de conversas |
| GET | `/api/conversations/:otherId` | Paciente ou profissional | Mensagens (com `?after=ID` para só as novas), já marcadas como lidas; cada mensagem traz `seen` |
| POST | `/api/conversations/:otherId/typing` | Paciente ou profissional | Avisa a outra pessoa que está digitando |
| POST | `/api/conversations/:otherId` | Paciente ou profissional | Envia texto (`body`) ou áudio (`audio`, `duration`) |
| GET | `/api/messages/:id/audio` | Participante | Arquivo de áudio |
| GET | `/api/stream` | Logado | Canal em tempo real (Server-Sent Events); eventos na seção 4.3 |
| GET | `/api/notifications` | Logado | As 50 notificações mais recentes e `unread` |
| POST | `/api/notifications/:id/read` | Logado | Marca uma notificação como lida (de outra pessoa: 404) |
| POST | `/api/notifications/read-all` | Logado | Marca todas como lidas |
| GET | `/api/pro/dashboard` | Profissional | Painel |
| GET · PUT | `/api/pro/profile` | Profissional | Lê ou atualiza o perfil |
| PUT | `/api/pro/availability` | Profissional | Substitui a disponibilidade semanal (`slots`) |
| PUT | `/api/pro/social` | Profissional recém-formado | Configura vagas sociais (`social_price`, `social_weekly`, `auto_fill`) |
| GET | `/api/pro/patients` | Profissional | Lista de pacientes |
| GET · POST | `/api/pro/patients/:pid/notes` | Profissional | Lê ou escreve no prontuário |
| GET | `/api/admin/overview` | Administração | Indicadores e verificações pendentes |
| POST | `/api/admin/pros/:id/verify` | Administração | Aprova ou recusa (`decision`: `verified` ou `rejected`) e notifica o profissional |
| POST | `/api/admin/reset-demo` | Administração | Recria os dados de demonstração e fecha as conexões em tempo real (só no modo demo) |
| POST | `/api/admin/reminders/run` | Administração | Antecipa o lembrete de 1 h das sessões das próximas 3 horas (só no modo demo) |

Respostas de erro têm o formato `{ "error": "mensagem" }`, com status 400 (dados inválidos), 401 (sem login), 402 (cartão recusado), 403 (sem permissão), 404, 409 (horário acabou de ser reservado), 413, 415 ou 429 (muitas tentativas).

## 9. Segurança e LGPD

| Proteção | Onde |
|---|---|
| Senhas com scrypt e sal aleatório, comparação em tempo constante | `security.js` |
| Token de sessão aleatório no cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção; no banco, só o hash | `routes/auth.js`, `app.js` |
| Limite de 12 tentativas de entrada e de cadastro a cada 5 minutos por IP | `security.js`, `routes/auth.js` |
| Proteção contra CSRF: escrita exige o cabeçalho `x-ms-client: web` | `app.js`, `core.js` |
| CSP sem scripts inline, `X-Frame-Options: DENY`, `nosniff` | `app.js` |
| Escape de todo texto exibido na interface | `core.js` (`esc`) |
| Validação de todas as entradas no servidor | `validate.js` |
| Prontuário com AES-256-GCM (IV por nota) e chave fora do banco | `security.js`, `routes/pro.js` |
| Trilha de auditoria de acessos sensíveis | tabela `audit` |
| Consentimento no cadastro, exportação dos dados (com as notificações) e exclusão da conta | `routes/auth.js`, `routes/me.js` |
| Eventos em tempo real só para o dono: destinatário decidido pelo servidor, conexão identificada pelo cookie, mensagem só para as duas pessoas da conversa | `realtime.js`, `services.js` |
| Conexões fechadas na saída, na exclusão da conta, na restauração dos dados e quando a sessão apaga ou vence (conferido a cada sinal de vida); no máximo 8 abas por usuário | `realtime.js`, `routes/auth.js`, `routes/me.js`, `routes/admin.js` |
| Eventos só depois do COMMIT: nada é anunciado de uma transação desfeita | `db.js` (`afterCommit`) |
| Notificação sem o texto da mensagem (o aviso do sistema pode aparecer na tela bloqueada) | `services.js` (`notifyMessage`) |
| Notificação de outra pessoa responde 404; "digitando…" só entre pessoas da mesma conversa | `routes/notifications.js`, `routes/messages.js` |
| O envio continua por POST com a proteção CSRF: o canal SSE só recebe | `app.js` |

A chave do prontuário vem de `NOTES_KEY` ou é gerada uma vez em `data/notes.key`. Se essa chave se perder, as notas antigas não podem mais ser lidas.

A triagem não faz diagnóstico, e a plataforma não substitui serviços de emergência: o botão de ajuda imediata (CVV 188) aparece em todas as telas.

## 10. Dados de demonstração

`src/seed.js` roda sozinho quando o banco está vazio, com `npm run seed` ou pelo botão "Restaurar dados de demonstração" da administração. O gerador aleatório tem semente fixa, então os dados saem sempre iguais, mudando só as datas, que são relativas ao dia em que os dados são criados.

O que é criado:

- 12 profissionais verificados de seis áreas, com preços, bairros, horários e avaliações, e uma profissional aguardando verificação (Beatriz Campos);
- a paciente de demonstração Mariana, 20 pacientes fictícios (adultos e famílias) e a conta de administração;
- 182 dias de histórico de sessões, com 5% de faltas e avaliações; a ocupação do Rafael (recém-formado) cresce de cerca de 22% para 68%;
- sessões confirmadas para os próximos 14 dias, incluindo três do Rafael no dia de hoje;
- notificações: a Mariana e a Fernanda começam com 2 não lidas cada uma, e o Rafael com o aviso da mensagem da Carla;
- lembretes: sessões que já estariam dentro da janela de 24 h (ou de 1 h) na hora de restaurar ficam marcadas como enviadas, para os pacientes fictícios não receberem uma enxurrada de avisos;
- para a Mariana: duas sessões passadas com o Bruno (uma avaliada), uma sessão online com a Fernanda numa hora cheia entre 1h30 e 2h30 depois da restauração (limitada a 08:00–23:00 do mesmo dia) e já com o lembrete de 24 h enviado, uma sessão presencial com a Juliana em 3 dias e conversas no chat.

Todas as contas de demonstração usam a senha `demo1234`. Como as sessões "de hoje" são criadas no momento da restauração, restaure os dados no dia de cada apresentação. O horário da sessão da Mariana com a Fernanda foi escolhido para mostrar o lembrete de 1 h em tempo real nas duas contas: ele chega sozinho quando faltarem 60 minutos (o que leva pelo menos 30 minutos depois de restaurar) ou na hora, pelo botão "Disparar lembretes agora" da administração. Restaurar apaga também as notificações e os lembretes.

Para ver o tempo real com duas contas, use duas janelas com cookies separados (uma normal e outra anônima, ou dois perfis do navegador); no mesmo perfil, entrar com a Fernanda desconecta a Mariana.

## 11. Testes

```bash
npm test
```

São 28 testes, em 3 arquivos, com o executor nativo do Node (`node:test`):

| Arquivo | O que cobre |
|---|---|
| `test/domain.test.js` | Datas, antecedência dos horários, vagas sociais fixas e automáticas, preço e desconto, triagem, restrições do emparelhamento, ampliação da busca, desempenho com 10 mil perfis, PIX, Luhn e criptografia |
| `test/api.test.js` | Proteção CSRF; fluxo do paciente (triagem, reserva, PIX, chat, sessão e avaliação); painel, vagas sociais e prontuário do profissional; aprovação de cadastro pela administração; exportação e exclusão da conta |

| `test/realtime.test.js` | Login exigido no canal; entrega da mensagem aos dois lados e só a eles (isolamento entre usuários), "digitando…" e "visto"; profissional não manda "digitando…" para quem não é paciente dele; saída fecha o canal e sessão apagada é encerrada no sinal de vida; eventos só depois do COMMIT; notificações de confirmação, cancelamento e avaliação em tempo real; um aviso por conversa, sem o texto; marcar uma ou todas e 404 para notificação de outra pessoa; aprovação do registro; lembretes de 24 h e 1 h sem duplicar e só o de 1 h em cima da hora; botão da demonstração (403 para paciente, sem duplicar); cenário dos dados de demonstração |

Os testes de API e de tempo real sobem o servidor numa porta livre com um banco temporário, então não mexem em `data/`.

## 12. Como fazer mudanças comuns

**Adicionar uma tela**

1. Em `public/js/screens/`, registre a tela: `screen('minhaTela', { load: () => api('/api/...'), view: (p, d) => \`...\` })`.
2. Abra a tela com um botão: `<button data-a="go" data-v="minhaTela" data-p="123">`.
3. Para aparecer no menu, acrescente uma linha em `NAV`, no `core.js`.

**Adicionar uma rota da API**

1. Num arquivo de `src/routes/`, registre: `r.post('/api/minha-rota', requireRole('pro'), (req) => { ... return { ok: true }; })`.
2. Valide as entradas com `validate.js` e use `bad('mensagem')` para erros.
3. Se criar um arquivo de rotas novo, inclua-o na lista de `createApp`, em `src/app.js`.
4. Acrescente um teste em `test/api.test.js`.

**Adicionar um tipo de notificação**

1. Em `src/db.js`, acrescente o tipo na lista do `CHECK(kind IN (...))` da tabela `notifications`. Como essa regra faz parte da tabela já criada, é preciso apagar `data/mesalva.db` e reiniciar.
2. Em `public/js/screens/notifications.js`, acrescente o ícone do tipo em `KIND_ICON`.
3. No ponto da rota onde o fato acontece, chame `svc.notify(idDeQuemRecebe, { kind, title, body, screen, param })`, de preferência dentro da mesma transação que grava o dado (o evento só sai depois do COMMIT). Não coloque dados sensíveis, como o texto de uma mensagem, em `title` ou `body`.
4. Acrescente um teste em `test/realtime.test.js`.

**Enviar um evento em tempo real**

1. No servidor, chame `hub.send(userId, 'nome', dados)`, com `userId` decidido pelo servidor a partir do banco (nunca um id vindo do corpo ou da URL). Dentro de uma transação, faça isso em `db.afterCommit(() => ...)`.
2. Se for um evento novo, acrescente o nome em `EVENTS`, no `public/js/realtime.js`.
3. Na tela, inscreva-se com `onLeave(onLive('nome', (dados) => ...))`, para a inscrição ser cancelada ao sair da tela.
4. Pense na reserva: se o canal cair, o que a tela faz? Use `S.live` para voltar à consulta periódica.

**Mudar regras de negócio**

| O que mudar | Onde |
|---|---|
| Comissão, preço do Me Salva+, limites da vaga social | `PRICING` em `public/js/shared/data.js` |
| Pesos do emparelhamento | `WEIGHTS` em `src/matching.js` |
| Como as respostas viram critérios | `deriveNeeds` em `src/matching.js` |
| Áreas profissionais e conselhos | `AREAS` em `public/js/shared/data.js` (e o mapeamento em `deriveNeeds`) |
| Bairros do mapa | `BAIRROS` em `public/js/shared/data.js` (posição de 0 a 100) |
| Opções da triagem | `TRIAGE` em `public/js/shared/data.js` e a tela `triagem` em `patient.js` |
| Tempo de reserva e regra de cancelamento | `HOLD_MIN` e a rota de cancelamento em `src/routes/appointments.js` |
| Janela da sala de vídeo | `roomOpen` em `src/services.js` |
| Antecedência dos lembretes e janela do botão da demonstração | `DAY_MIN`, `HOUR_MIN` e `DEMO_AHEAD_MIN` em `src/reminders.js` |
| Intervalo do sinal de vida e limite de abas | `heartbeatMs` em `src/config.js` e `maxPerUser` em `src/realtime.js` |

Depois de mudar uma regra, rode `npm test`; alguns testes conferem os valores atuais e precisarão ser ajustados junto.

**Mudar o banco**: edite `SCHEMA` em `src/db.js`. Uma tabela nova é criada sozinha; para uma coluna nova ou uma regra `CHECK` nova, apague `data/mesalva.db` e reinicie o servidor.

## 13. Limitações conhecidas

- **Pagamento simulado**: PIX e cartão não passam por nenhum banco; a confirmação é um botão.
- **Verificação manual**: o administrador confere o registro no site do conselho; não há consulta automática.
- **Áudios no banco**: as mensagens de voz ficam no banco em base64.
- **Mapa esquemático**: bairros têm posição aproximada; não há geolocalização nem serviço de mapas.
- **Videochamada externa**: a sala usa o Jitsi Meet público; a prévia da câmera fica só no aparelho.
- **Sem e-mail nem SMS**: não há confirmação de cadastro nem recuperação de senha, e os lembretes só aparecem dentro da plataforma.
- **Aviso do sistema no celular**: no Android e no iPhone ele depende do service worker e do aplicativo instalável, previstos para a v1.2.
- **Um único processo**: o limite de tentativas e o distribuidor de eventos ficam na memória do servidor, e o SQLite atende bem um servidor só. Com várias instâncias, uma aba conectada numa não receberia os eventos gerados na outra; seria preciso um canal compartilhado, como Redis ou o LISTEN/NOTIFY do PostgreSQL.
- **Limite de conexões em HTTP/1.1**: em `http://localhost`, o navegador abre no máximo 6 conexões por site e cada aba aberta usa uma para o tempo real, então muitas abas no mesmo navegador podem travar. No Render, com HTTPS e HTTP/2, isso não acontece.
- **Disco temporário no Render gratuito**: os dados voltam ao estado de demonstração quando o serviço reinicia.

## 14. Glossário

| Termo | Significado |
|---|---|
| TEA | Transtorno do Espectro Autista |
| ABA | Análise do Comportamento Aplicada, intervenção comportamental usada no TEA |
| CRP, CRM, CREFITO | Conselhos profissionais de psicologia, medicina e fisioterapia e terapia ocupacional |
| Vaga social | Horário com valor reduzido, oferecido por profissional recém-formado com supervisão clínica |
| Me Salva+ | Assinatura do paciente (R$ 19,90 por mês) com 10% de desconto nas sessões |
| LGPD | Lei Geral de Proteção de Dados (Lei nº 13.709/2018) |
| CSRF | Ataque em que outro site tenta fazer uma ação em nome do usuário logado |
| CSP | Política de segurança de conteúdo do navegador |
| SSE (Server-Sent Events) | Fluxo em que o navegador abre uma conexão HTTP e o servidor envia avisos por ela, num só sentido (servidor → navegador) |
| EventSource | Recurso do navegador que abre um fluxo SSE e reconecta sozinho se ele cair |
| WebSocket | Conexão de duas vias entre navegador e servidor; não é usada aqui porque só precisamos de avisos do servidor |
| Service worker | Programa do navegador que roda em segundo plano e permite avisos do sistema no celular (previsto para a v1.2) |
| COMMIT | O momento em que uma transação do banco é confirmada e seus dados passam a valer |
