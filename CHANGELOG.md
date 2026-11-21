# Changelog

Todas as mudanças importantes do Me Salva ficam registradas aqui. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.3.0] — 2026-11-21

Etapa 3C: painel de métricas do negócio, dados de demonstração coerentes e revisão geral das telas. Quem já tem o `data/mesalva.db` da versão 1.2 continua com o mesmo banco: a tabela `events` é criada sozinha na primeira inicialização. Como os eventos antigos não existem, o painel de métricas fica vazio até usar "Restaurar dados de demonstração" (ou `npm run seed`), que recria o histórico e os eventos.

### Adicionado

- **Eventos do funil** (`src/events.js`, tabela `events` em `src/db.js`): cada evento guarda só o tipo, o horário de São Paulo (`'AAAA-MM-DDTHH:MM'`) e identificadores internos (`user_id`, `pro_id`, `ref_id`). Nunca o nome, as respostas da triagem, o texto de mensagens ou valores. Tipos: `triage_started`, `triage_done`, `profile_view`, `booking_created`, `payment_confirmed`, `session_done` e `review_sent`.
  - **Onde são gravados**: triagem concluída (`POST /api/triage`), perfil visto (`GET /api/pros/:id`, só quando quem vê é paciente), reserva (`POST /api/appointments`; `POST /api/packages` conta uma reserva por pacote, com o pacote em `ref_id`), pagamento (confirmação do PIX ou do cartão e o PIX do pacote), sessão realizada (`POST /api/appointments/:id/finish`) e avaliação.
  - **"Triagem iniciada"** vem do navegador por `POST /api/events`, só para pacientes e só com esse tipo: o navegador não consegue inventar os outros passos.
  - **Sem repetição**: "triagem iniciada" e "perfil visto" repetidos pela mesma pessoa em 30 minutos contam uma vez (o perfil, para o mesmo profissional).
  - **Exclusão da conta**: `user_id` e `pro_id` ficam nulos (`ON DELETE SET NULL`), e o evento deixa de apontar para alguém.
  - **LGPD**: a exportação dos dados (`GET /api/me/export`) traz `eventos_de_uso`, com o tipo e o horário de cada evento da pessoa.
- **Métricas do negócio** (`src/metrics.js`) e duas rotas só da administração: `GET /api/admin/metrics?days=30|90|180` (padrão 30) e `GET /api/admin/metrics/export?days=...`, que baixa um CSV em português (separador `;`, vírgula decimal, valores em reais e BOM, com os indicadores do período e do anterior, o funil e as 26 semanas). As definições estão no cabeçalho do arquivo e em `docs/DOCUMENTACAO.md` (seção "Painel de métricas"):
  - **período**: os últimos N dias, contando hoje, até agora;
  - **sessões realizadas**: sessões com status `done` que começaram no período;
  - **valor transacionado**: o que os pacientes pagaram por essas sessões mais as mensalidades do Me Salva+ pagas no período;
  - **receita da plataforma**: a parte da plataforma nessas sessões (12% do valor de tabela, menos o desconto do Me Salva+) mais as mensalidades do Me Salva+;
  - **ticket médio**, **pacientes ativos** e **profissionais ativos** (com sessão realizada no período), **assinantes do Me Salva+** e a porcentagem sobre os pacientes ativos;
  - **funil por coorte**: quem começou a triagem no período e até onde chegou, na ordem dos passos;
  - **retenção**: entre os pacientes ativos, quantos fizeram 2 ou mais sessões e quantos têm pacote recorrente;
  - **vagas sociais**: ocupação dos horários fixos de vaga social que já passaram, sessões a preço social e a economia das famílias em relação ao valor de tabela;
  - **qualidade**: nota média, distribuição das notas e taxa de faltas (faltas ÷ (realizadas + faltas));
  - **séries semanais** das 26 semanas completas (segunda a domingo; a semana atual fica de fora): sessões, a preço social, faltas, valor transacionado, receita e novos cadastros de pacientes;
  - a comparação com o período anterior só aparece quando já havia sessões desde o começo dele (por isso "6 meses" mostra "sem base para comparar").
- **Tela "Métricas do negócio"** (`public/js/screens/metrics.js`), no menu e nas abas da administração e num cartão de atalho na visão geral: aviso "Dados de demonstração", filtro de 30 dias, 90 dias ou 6 meses, 8 indicadores com a variação sobre o período anterior, funil, retenção, vagas sociais, qualidade, tabela das semanas e botão CSV. Os gráficos semanais (sessões empilhadas em valor de tabela e vaga social, receita em linha e novos cadastros) são desenhados em SVG próprio, sem bibliotecas, na largura real e redesenhados quando o tamanho muda; a dica com os números da semana aparece por mouse, toque ou setas do teclado. As cores das séries seguem o tema (`--chart-1` e `--chart-2`: claro `#13998A` e `#6E4FCB`; escuro `#2AA894` e `#9479E8`), conferidas para daltonismo e contraste.
- **Testes**: `test/metrics.test.js`, com 8 testes (cálculos com dados conhecidos, funil por coorte, retenção, vagas sociais, qualidade, semanas e CSV; eventos e deduplicação; rotas gravando os passos sem dados sensíveis e a exportação LGPD; acesso só da administração e CSV; coerência dos dados de demonstração e "Restaurar"). O total passou para 58 testes em 7 arquivos.

### Alterado

- **Dados de demonstração** (`src/seed.js`): o histórico deixou de sortear pacientes para cada horário e passou a simular a jornada de cada paciente (cadastro, triagem, perfil, reserva, pagamento e sessões no mesmo horário fixo por algumas semanas, com 1 em 5 parando cedo e cerca de 4,5% de faltas). São 26 semanas completas, a semana atual e 14 dias de agenda futura. Nos últimos 30 dias, a simulação dá cerca de 75 pacientes ativos, cerca de 8% deles no Me Salva+ e ticket perto de R$ 95; as sessões por semana crescem cerca de 1,5 vez em 6 meses, e os cadastros vão de cerca de 6 para cerca de 13 por semana. As cenas das versões anteriores (Mariana, a sessão de hoje com a Fernanda, o pacote com o Rafael, o conflito de quinta e as três sessões do Rafael hoje) ficam com os horários guardados antes do histórico, e as vagas sociais de segunda do Rafael ficam livres nos próximos 14 dias, para a triagem TEA/ABA da Mariana continuar indicando o Rafael com 85%. Restaurar os dados recria tudo, inclusive os eventos.
- A visão geral da administração (`GET /api/admin/overview`) passou a usar as mesmas definições das métricas para o mês: sessões realizadas e a receita delas. O total de triagens vem dos eventos do funil.
- A agenda do profissional no celular ficou com mensagem, prontuário e cancelar na linha do nome e Entrar, Realizada e Falta numa linha embaixo. Na agenda do paciente, "Entrar" e o ícone de mensagem ficam na mesma linha que "Cancelar".
- Os cadastros pendentes da administração aparecem em cartões no celular, e a grade de horários mostra os 7 dias no celular sem rolagem.
- O painel do profissional mostra "Sessões marcadas no mês".
- O texto de exemplo do campo de busca ficou mais curto ("Especialidade, tema ou nome").
- README e `docs/DOCUMENTACAO.md` atualizados para a versão 1.3, com a tabela "Avanços desde o MVP (22/10)" no README; versão `1.3.0` no `package.json`.

### Corrigido

- `proLine()` (`public/js/core.js`) junta o título e a abordagem sem repetir: antes o perfil aparecia como "Psicólogo · ABA · ABA".
- Contraste do texto branco sobre o verde-água: de 3,5:1 para 4,9:1, com a nova cor `--teal-fill` (`#0E7E71` no tema claro).
- Os campos de texto ganharam o anel de foco do teclado.

### Segurança

- Os eventos do funil não levam dados pessoais nem de saúde: só tipo, horário e identificadores internos. O navegador só registra "triagem iniciada" (e só paciente); os demais passos nascem no servidor.
- As rotas de métricas e a exportação em CSV respondem só para a administração.

## [1.2.0] — 2026-11-18

Etapa 3B: app instalável no celular e agendamento recorrente. Quem já tem o `data/mesalva.db` da versão 1.0 ou 1.1 não precisa apagá-lo: as tabelas novas são criadas sozinhas, e as colunas novas (`package_id` em `appointments` e `payments`) são acrescentadas na primeira inicialização, sem perder dados.

### Adicionado

- **App instalável (PWA)**: service worker (`public/sw.js`) de mesmo domínio, compatível com a CSP. Guarda a estrutura do app (CSS, JavaScript, ícones, manifesto e página offline) num cache com versão; a versão é a do `package.json` mais um resumo (hash) de todos os arquivos de `public/`, montada pelo servidor a cada pedido de `/sw.js` (`src/pwa.js`). Qualquer mudança num arquivo gera um service worker novo, que baixa tudo de novo e apaga o cache antigo. A API (`/api/...`) e o canal em tempo real vão sempre pela rede, nunca pelo cache. As fontes do Google ficam num cache próprio.
- **Página offline** (`public/offline.html`): sem internet, abrir o app mostra "Você está sem internet", o botão "Tentar de novo" e a ajuda imediata, com links `tel:188` (CVV) e `tel:192` (SAMU), que funcionam sem internet. Não depende de JavaScript.
- **Faixa "sem internet"** no topo das telas quando a conexão cai, com o atalho "Ajuda: 188".
- **Manifesto completo**: ícones PNG 192 e 512, versões *maskable* (fundo até a borda, logo na zona segura), ícone SVG, cor de tema, cor de fundo da tela de abertura e três atalhos (Minha agenda, Mensagens e Ajuda imediata · CVV 188), que abrem `/?tela=...`.
- **iPhone**: `apple-touch-icon` (180 × 180), metas `apple-mobile-web-app-*` e telas de abertura para 9 tamanhos de iPhone. Os ícones e as telas são gerados a partir do logo por `scripts/icones.mjs` (precisa do `rsvg-convert`, só para quem for mudar o logo).
- **"Instalar o app"** em Configurações e convite discreto na tela inicial do paciente e no painel do profissional (some de vez com "Agora não"). No Android e no computador, abre a janela de instalação do navegador (`beforeinstallprompt`); no iPhone, mostra o passo a passo Compartilhar → Adicionar à Tela de Início.
- **Áreas seguras**: com o app instalado em tela cheia, o conteúdo respeita o entalhe e a barra inferior (`env(safe-area-inset-*)`), inclusive nos rodapés com botão.
- **Botão Voltar do aparelho**: no Android (e no navegador), voltar retorna uma tela ou fecha a folha aberta, em vez de fechar o app.
- **Web Push** (avisos com o app fechado) sem dependências (`src/push.js`): chaves VAPID geradas uma vez em `data/vapid.json` (ou lidas de `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`), assinatura JWT ES256 (RFC 8292) e criptografia do aviso em `aes128gcm` (RFC 8291), tudo com `node:crypto`, e envio com `node:https`. Cada notificação da v1.1 também vai para os aparelhos inscritos. Tabela `push_subscriptions` e rotas `GET /api/push/key`, `POST /api/push/subscribe` e `POST /api/push/unsubscribe`. No iPhone, funciona no app instalado (iOS 16.4 ou mais recente).
- **Agendamento recorrente**: na tela de agendamento, depois de escolher o horário, a opção "Repetir toda semana" deixa escolher os dias da semana (só os dias em que o profissional atende naquele horário; o dia do primeiro horário sempre entra) e a duração (4, 8 ou 12 semanas).
  - **Conferência de conflitos** antes de pagar (`GET /api/pros/:id/recurrence`): cada data é conferida contra a agenda do profissional e contra as outras sessões do próprio paciente, com qualquer profissional. As datas com problema aparecem com o motivo ("horário já reservado por outra pessoa", "você já tem uma sessão nesse horário" ou "fora da agenda do profissional") e com o horário livre mais próximo (no mesmo dia, se houver; até 3 dias antes ou depois). A pessoa escolhe "Usar 14:00" ou "Pular data". As regras ficam em `src/recurrence.js`, em funções puras.
  - **Pagamento do pacote** (`POST /api/packages` e `POST /api/packages/:id/pix-simulate`): um PIX só, com o total e o resumo por sessão. Cada sessão continua com o próprio valor (vaga social e Me Salva+ calculados sessão por sessão) e a própria cobrança; não há desconto de pacote. Os horários ficam reservados por 15 minutos, como no agendamento avulso; se o PIX não for pago, o pacote inteiro vence e libera os horários.
  - **Vagas sociais**: o limite semanal do profissional continua valendo, porque a vaga social é uma propriedade do horário (as N primeiras vagas da semana); um pacote nunca passa dele. A regra foi isolada em `socialKeys` (`src/slots.js`).
  - **Cancelamento**: continua sessão por sessão, com a regra de 24 h para o paciente, e ganhou "esta e as próximas" (`POST /api/appointments/:id/cancel` com `{ "following": true }`), com reembolso de cada sessão, um aviso só no chat e uma notificação só para o outro lado.
  - **Tela do pacote** (`pacote`, `GET /api/packages/:id`): todas as sessões, com avaliação, cancelamento e "Cancelar as próximas". **Tela do PIX do pacote** (`pixpacote`).
  - **Agenda do paciente**: as sessões do mesmo pacote aparecem num cartão só, com o padrão ("seg e qua, 08:00"), a próxima sessão e o progresso. **Agenda do profissional** e painel: o paciente aparece marcado como "recorrente"; a marca abre a tela do pacote.
  - **Lembretes**: os de 24 h e 1 h da v1.1 valem para cada sessão do pacote.
- **Testes**: `test/pwa.test.js` (6), `test/recurrence.test.js` (11) e `test/push.test.js` (5), num total de 50 testes em 6 arquivos.

### Alterado

- Os avisos do sistema (notificações do navegador) agora saem pelo service worker, o único caminho no Android e no iPhone. O toque no aviso abre a tela certa, com o app aberto ou fechado. Em Configurações, a linha passou a se chamar "Avisos do aparelho".
- Sair da conta e excluir a conta desligam o Web Push deste aparelho; entrar em outra conta no mesmo aparelho passa a inscrição para ela.
- `GET /api/appointments` traz `packages` (o resumo de cada pacote da lista) e o campo `package_id` em cada sessão; o painel do profissional também.
- `GET /api/meta` traz a versão do app (`version`); a tela de Configurações deixou de ter a versão escrita à mão.
- A exportação dos dados (LGPD) inclui os pacotes e os aparelhos com avisos ligados (só o serviço e a data, sem as chaves).
- Dados de demonstração: a Mariana tem um pacote com o Rafael (seg e qua às 08:00, presencial, 8 semanas, começado há duas semanas, com a segunda em vaga social de R$ 45) e uma conversa com ele. As terças e quintas do Rafael das 14:00 às 16:00 ficam livres para a demonstração, menos a quinta da semana seguinte à próxima terça, às 15:00, já reservada por outra família, para mostrar o conflito e a sugestão de 14:00.
- O teste "profissional não manda digitando…" usa o Caio, porque a Mariana passou a ser paciente do Rafael.
- O desenho do QR Code ilustrativo foi para `core.js` (`qrSvg`), usado pelos dois PIX.
- O botão de cancelar das folhas de confirmação usa a classe `btn-danger`, legível também no tema escuro.
- README e `docs/DOCUMENTACAO.md` atualizados para a versão 1.2; versão `1.2.0` no `package.json`.

### Segurança

- O service worker nunca guarda respostas da API: agenda, mensagens e pagamentos não ficam no aparelho.
- `/sw.js` tem uma CSP própria, que só acrescenta as fontes do Google ao `connect-src`; as páginas continuam com a CSP de antes.
- Web Push: o servidor só envia para os serviços de push conhecidos (Google, Mozilla, Apple e Microsoft), em HTTPS e na porta padrão, o que impede usar a inscrição para fazer o servidor acessar outros endereços (SSRF). O aviso vai criptografado de ponta a ponta para o aparelho, e o serviço do fabricante não consegue lê-lo. O texto das mensagens do chat continua fora das notificações.
- `data/vapid.json` é criado só com permissão para o dono do arquivo e fica fora do Git, como o resto de `data/`.
- A tela do pacote e o PIX do pacote respondem 404 para quem não é o paciente ou o profissional do pacote; o código PIX só vai para o paciente.

## [1.1.0] — 2026-11-17

Etapa 3A: tempo real e notificações. Quem já tem o `data/mesalva.db` da versão 1.0 não precisa apagá-lo: as tabelas novas são criadas sozinhas e nenhuma tabela antiga ganhou coluna.

### Adicionado

- **Canal em tempo real com Server-Sent Events (SSE)**: `GET /api/stream` abre um fluxo para o usuário logado, identificado pelo cookie de sessão. O distribuidor de eventos (`src/realtime.js`) guarda as conexões por usuário (no máximo 8 abas, e a mais antiga é fechada) e manda um sinal de vida (`ping`) a cada 25 segundos, que também confere se a sessão ainda vale. Eventos: `hello`, `counts`, `message`, `typing`, `read`, `notification` e `ping`. Escolhemos SSE e não WebSocket porque o servidor só precisa empurrar avisos, o envio continua pelas rotas POST com a proteção CSRF, o navegador já tem reconexão automática e não há dependências novas.
- **`db.afterCommit`** (`src/db.js`): os eventos só saem depois do COMMIT da transação e são descartados se ela for desfeita.
- **Chat em tempo real**: a mensagem nova aparece na hora dos dois lados; "Fulana está digitando…" (rota `POST /api/conversations/:otherId/typing`); e "visto" (um tique = enviada, dois tiques = vista pela outra pessoa, com "Visto" embaixo da última mensagem lida). O visto usa os campos `read_by_patient` e `read_by_pro` que já existiam. Com a aba em segundo plano, a conversa aberta não marca como lida. A lista de conversas e os contadores de não lidas se atualizam sozinhos, sem apagar o que está sendo digitado.
- **Interface do tempo real** (`public/js/realtime.js`): um `EventSource` por aba, reconexão automática, vigia que reabre a conexão depois de 60 segundos sem dados ou ao voltar para a aba, e reserva: enquanto o canal não está aberto, a interface volta à consulta periódica da v1.0 (chat a cada 3 s, contadores a cada 15 s).
- **Central de notificações**: tabela `notifications` e rotas `GET /api/notifications`, `POST /api/notifications/:id/read` e `POST /api/notifications/read-all`. Tipos: mensagem, sessão confirmada, sessão cancelada, lembrete, avaliação recebida e registro aprovado ou recusado. Mensagens geram um aviso só por conversa ("Fernanda Alves enviou 3 mensagens."), e abrir a conversa marca o aviso como lido.
- **Sino e painel de notificações** (`public/js/screens/notifications.js`): sino com contador na barra lateral e nos cabeçalhos das telas principais do celular (não aparece para a administração), painel com "Marcar todas como lidas", abertura da tela certa ao clicar e aviso rápido (toast) quando o painel está fechado.
- **Aviso do sistema (notificação do navegador)**: aparece só com a aba em segundo plano, permissão concedida e preferência ligada. A permissão é pedida só por clique: na tela "Sessão agendada!", no fim do painel do sino e em Configurações → Avisos do navegador. No Android e no iPhone ele depende do service worker, previsto para a v1.2.
- **Lembretes de sessão** (`src/reminders.js`, tabela `reminders`): o servidor confere a cada minuto as sessões confirmadas das próximas 24 horas e manda um lembrete 24 h e outro 1 h antes, como mensagem automática no chat da sessão e como notificação para paciente e profissional. Só o lembrete mais próximo vale, e nenhum se repete.
- **Botão "Disparar lembretes agora"** na administração (`POST /api/admin/reminders/run`, só no modo demonstração), que antecipa o lembrete de 1 h das sessões que começam nas próximas 3 horas.
- **Serviços novos** em `src/services.js`: `notify`, `readChatNotifications`, `counts`, `sendCounts`, `messageView` e `notificationView`; e `whenText` em `src/time.js` ("hoje (17/11) às 13:00", "amanhã (18/11) às 10:00", "qua, 25/11 às 09:00").
- **Testes**: o arquivo `test/realtime.test.js` e 13 testes novos, num total de 28 em 3 arquivos.
- **Este CHANGELOG**.

### Alterado

- `GET /api/unread` agora devolve `{ count, notifications }`, e `GET /api/me` traz também o contador `notifications`.
- `GET /api/conversations/:otherId` devolve o campo `seen` em cada mensagem.
- A exportação dos dados (LGPD) inclui as notificações.
- Aprovar ou recusar um registro, confirmar, cancelar e avaliar uma sessão agora também geram notificações.
- Sair da conta, excluir a conta e "Restaurar dados de demonstração" fecham as conexões em tempo real na hora.
- Dados de demonstração: a sessão online da Mariana com a Fernanda agora fica numa hora cheia entre 1h30 e 2h30 depois da restauração (entre 08:00 e 23:00 do mesmo dia), com o lembrete de 24 h já enviado, para o lembrete de 1 h chegar às duas contas em tempo real. Mariana e Fernanda começam com 2 notificações não lidas cada uma, e o Rafael com o aviso da mensagem da Carla. Lembretes que já estariam vencidos na hora da restauração ficam marcados como enviados. Restaurar apaga também as notificações e os lembretes.
- Limitações conhecidas: sai a do chat por consulta periódica; entram o processo único (o distribuidor de eventos fica na memória do servidor), o limite de 6 conexões por site em HTTP/1.1 (por exemplo, `http://localhost`), o aviso do sistema no celular que depende da v1.2 e a falta de e-mail e SMS.
- README e `docs/DOCUMENTACAO.md` atualizados para a versão 1.1.
- A versão no `package.json` passou de `0.1.0` para `1.1.0` (a tela de Configurações agora mostra "versão 1.1").

### Segurança

- Os eventos em tempo real só vão para o dono da sessão: o destinatário é sempre um id decidido pelo servidor a partir do banco, uma conexão só recebe eventos do próprio usuário e uma mensagem vai só para as duas pessoas da conversa.
- A notificação nunca leva o texto da mensagem, porque o aviso do sistema pode aparecer na tela bloqueada e o assunto é saúde.
- Uma notificação de outra pessoa responde 404, e o "digitando…" só funciona entre as duas pessoas de uma conversa válida.
- Conexões em tempo real são encerradas quando a sessão é apagada ou vence (conferido a cada sinal de vida).

## [1.0.0] — 2026-10-22

MVP apresentado no andamento da disciplina em 22/10. A `main` ficou nessa versão no commit `9b00548` (26/10, correção no README). Observação: o `package.json` daquela versão ainda dizia `0.1.0`.

### Adicionado

- **Contas**: cadastro e login de paciente e profissional, sessão segura por cookie e senhas com scrypt.
- **Verificação**: profissional novo fica "em verificação" e só aparece na busca depois que a administração aprova.
- **Triagem** em 5 passos, com caminho para TEA/ABA, e **motor de emparelhamento** no servidor, com restrições, pontuação e motivos.
- **Busca** com filtros, ordenação, lista e mapa esquemático por bairro.
- **Agenda** sem conflito de horários, reserva por 15 minutos até o pagamento e cancelamento com regra de 24 h.
- **Pagamento simulado**: cálculo do valor, divisão 12% plataforma e 88% profissional, desconto do Me Salva+ e código PIX no padrão BR Code.
- **Vagas sociais** de profissionais recém-formados, com valor social, vagas fixas por semana e preenchimento automático dos horários livres das próximas 24 horas.
- **Chat** com mensagens de texto e de áudio gravado e avisos automáticos de confirmação e cancelamento, atualizado por consulta periódica a cada 3 segundos.
- **Sessão online** com prévia da câmera, cronômetro, encerramento e link para a videochamada (Jitsi Meet).
- **Avaliações** só depois de sessão realizada, uma por sessão, com opção anônima.
- **Área do profissional**: painel com ocupação e receita líquida, agenda com presença e falta, edição de perfil e horários e prontuário criptografado (AES-256-GCM) com registro de acesso.
- **LGPD**: consentimento no cadastro, download dos próprios dados e exclusão da conta.
- **Interface** para computador e celular, tema claro e escuro e botão de ajuda imediata (CVV 188) em todas as telas.
- Dados de demonstração, 15 testes automatizados, `Dockerfile` e `render.yaml`.
