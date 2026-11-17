# Changelog

Todas as mudanças importantes do Me Salva ficam registradas aqui. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
