# Painel de automação de DM do Instagram

Um sistema completo pra responder automaticamente no direct quem comenta uma palavra
num post seu: a pessoa comenta, o sistema responde no comentário e manda uma DM com
botão, ela toca no botão e a conversa continua (mais mensagens, um link ou um arquivo).
O contato fica salvo como lead.

Tudo aqui é genérico. Nenhum dado real de conta nenhuma. Os valores da API do Meta
entram como variáveis de ambiente, preenchidas por você nos passos abaixo.

---

## O que tem dentro

```
index.html                 a página (login + sistema)
assets/config.js           ONDE VOCÊ MEXE: a URL e a chave anônima do Supabase
assets/styles.css          o visual (as cores ficam nas variáveis do topo)
assets/app.js              a lógica do painel
sql/01_tabelas.sql         as tabelas
sql/02_freio.sql           as funções do freio de envio (OBRIGATÓRIAS)
sql/03_rls.sql             as regras de acesso
sql/04_agendamento.sql     os robôs que rodam sozinhos (pg_cron)
supabase/functions/
  instagram-webhook/       o cérebro: recebe os eventos e responde
  ig-scheduler/            o carteiro: esvazia a fila a cada 1 minuto
  ig-token-refresh/        renova o token, 1x por semana
  ig-insights/             as métricas do dashboard
  ig-media/                a lista dos seus posts
```

---

## Passo 0: só olhar o sistema funcionando (sem configurar nada)

Abra a pasta do projeto no terminal e rode:

```
python -m http.server 5173
```

Depois abra `http://localhost:5173` no navegador.

No `localhost`, o login roda em **modo de teste local**: digite qualquer e-mail e uma
senha de **5 dígitos** e você entra direto, sem Supabase, sem cadastro. Dá pra navegar
o sistema todo, criar uma automação e ver a prévia da DM ao vivo. O que você salvar
nesse modo fica só no seu navegador, não no banco.

Os passos a seguir são pra colocar no ar de verdade, com login e dados salvos.

---

## Passo 1: criar o projeto no Supabase e rodar os SQLs

1. Crie uma conta em supabase.com e um projeto novo.
2. Abra **SQL Editor** e rode, nesta ordem, o conteúdo de:
   - `sql/01_tabelas.sql`
   - `sql/02_freio.sql`
   - `sql/03_rls.sql`

> **Não pule o `02_freio.sql`.** Sem as funções `take_send_slot` e `record_send_result`,
> o freio falha fechado: nenhuma DM por comentário sai, tudo vai pra fila e a fila
> nunca anda, sem dar erro visível. É o passo que mais derruba instalação.

Pra conferir se o freio está de pé, rode no SQL Editor:

```sql
select public.take_send_slot('private_reply');   -- deve responder true
select * from public.ig_send_budget;
```

---

## Passo 2: criar o usuário admin

No Supabase, vá em **Authentication > Users > Add user**, e crie um usuário com o seu
e-mail e uma senha. É esse login que vale quando o site estiver no ar (fora do
localhost). O sistema não tem tela de "criar conta" de propósito: o acesso é só seu.

---

## Passo 3: configurar os segredos das Edge Functions

No Supabase, em **Edge Functions > Secrets** (ou pela CLI, com `supabase secrets set`),
cadastre:

| Segredo | O que é |
|---|---|
| `IG_ACCESS_TOKEN` | o token long-lived do Instagram (vem do passo 6) |
| `IG_ACCOUNT_ID` | o id numérico da sua conta do Instagram (passo 6) |
| `APP_SECRET` | o segredo do seu app no Meta (passo 6) |
| `APP_SECRET_ENFORCE` | comece com `false`, mude pra `true` no final |
| `VERIFY_TOKEN` | uma senha que você inventa (o aperto de mão do webhook) |
| `GRAPH_API_VERSION` | `v21.0` |
| `SCHED_SECRET` | outra senha que você inventa (protege os robôs) |
| `TEST_IG_ACCOUNTS` | ids numéricos das suas contas de teste, separados por vírgula |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave service_role (em Settings > API) |

`SUPABASE_URL` já vem preenchida sozinha pelo Supabase.

A chave de service_role **nunca** vai pro frontend. Ela mora só aqui.

---

## Passo 4: publicar as Edge Functions

Com a CLI do Supabase instalada e o projeto linkado:

```
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy ig-scheduler --no-verify-jwt
supabase functions deploy ig-token-refresh --no-verify-jwt
supabase functions deploy ig-insights
supabase functions deploy ig-media
supabase functions deploy ig-subscribe --no-verify-jwt
supabase functions deploy ig-analytics
supabase functions deploy ig-link --no-verify-jwt
```

> O `ig-scheduler` e o `ig-token-refresh` também precisam de `--no-verify-jwt`: quem
> chama eles é o pg_cron, que se identifica pelo `SCHED_SECRET`, não por login. Com a
> verificação de JWT ligada, o cron leva erro 401 e a fila nunca anda.

> O `--no-verify-jwt` na `instagram-webhook` é obrigatório: essa função precisa ser
> **pública**, porque quem chama ela é o Meta, e o Meta não tem login do Supabase.
> Se preferir o painel, desligue o "Verify JWT" nas configurações dessa função.

---

## Passo 5: agendar os robôs

Abra `sql/04_agendamento.sql`, troque os placeholders `SEU_PROJETO_AQUI` e
`SEU_SCHED_SECRET_AQUI` pelos seus valores, e rode no SQL Editor.

Isso liga dois robôs:
- `ig-scheduler` a cada 1 minuto, pra esvaziar a fila e mandar os passos com atraso.
- `ig-token-refresh` 1x por semana, pra renovar o token.

Conferir:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

---

## Passo 6: o app no Meta for Developers

1. Em developers.facebook.com, crie um app e adicione o produto
   **Instagram API with Instagram Login**.
2. Conecte a sua conta profissional do Instagram (comercial ou de criador, ligada a
   uma página, conforme o fluxo que o Meta pedir).
3. Libere as permissões de ler comentários e de ler e enviar mensagens
   (`instagram_business_basic`, `instagram_business_manage_comments`,
   `instagram_business_manage_messages`).
4. Gere o **token long-lived** e anote o **id numérico da conta**.
5. Anote também o **App secret** (em Configurações básicas do app).

Esses três valores vão pros segredos do passo 3.

---

## Passo 7: cadastrar o webhook

No app do Meta, em **Webhooks**:

- **Callback URL:** `https://SEU_PROJETO.supabase.co/functions/v1/instagram-webhook`
- **Verify token:** exatamente o mesmo texto que você pôs no segredo `VERIFY_TOKEN`
- **Assine os três campos:** `comments`, `messages` e `messaging_postbacks`

> O `messaging_postbacks` é o que faz os botões da conversa funcionarem. Sem ele, a
> primeira DM chega, mas nada acontece quando a pessoa toca no botão.

**Passo que costuma ficar esquecido: inscrever a CONTA, não só o app.** Na API com
Instagram Login, assinar os campos no painel do app não basta. A conta do Instagram
também precisa estar inscrita (`subscribed_apps`), senão o Meta não entrega nenhum
comentário ao webhook, e nada acontece, sem erro nenhum. A função `ig-subscribe` faz
isso por você:

```
# ver em quais campos a conta está inscrita
curl -H "x-sched-key: SEU_SCHED_SECRET_AQUI" https://SEU_PROJETO.supabase.co/functions/v1/ig-subscribe

# inscrever em comments, messages e messaging_postbacks
curl -X POST -H "x-sched-key: SEU_SCHED_SECRET_AQUI" https://SEU_PROJETO.supabase.co/functions/v1/ig-subscribe
```

Se mesmo assim nenhum evento chegar, confira o cadastro do webhook no APP com a função
`ig-webhook-setup` (GET lê, POST cadastra a URL certa com os três campos). Ela precisa
do segredo `META_APP_SECRET`, que é a **Chave secreta do aplicativo** da tela
Configurações do app > Básico. Atenção: é diferente do segredo que aparece na tela do
Instagram, e o Meta recusa um no lugar do outro.

```
curl -X POST -H "x-sched-key: SEU_SCHED_SECRET_AQUI" "https://SEU_PROJETO.supabase.co/functions/v1/ig-webhook-setup?app_id=ID_DO_SEU_APP"
```

Um sinal seguro de que o cadastro está certo: nos logs da `instagram-webhook` aparece uma
chamada GET com o agente `facebookplatform`. Se nunca apareceu, o Meta nunca falou com
o seu webhook.

Publique essas funções com `--no-verify-jwt`, como os robôs agendados. Ela é protegida
pelo `SCHED_SECRET`. Rode de novo sempre que trocar o token do Instagram por um de
outra conta.

---

## Busca ativa: funcionar mesmo sem o Meta entregar eventos

Enquanto o app não tem **acesso avançado** às permissões de comentários e mensagens
(que só sai pela Análise do App no Meta), o Meta aceita o cadastro do webhook mas **não
entrega evento nenhum**. É um bloqueio silencioso: nada chega e nada dá erro.

Para o sistema funcionar mesmo assim, o robô `ig-scheduler`, que já roda a cada minuto,
faz uma **busca ativa**:

- lê os comentários novos dos posts das automações ativas (e dos 12 posts mais recentes,
  quando alguma automação vale para todos os posts);
- lê as respostas no direct de quem está no meio de uma conversa automática (toques nos
  botões e dados digitados);
- entrega tudo ao `instagram-webhook`, que processa exatamente como faria com um evento
  do Meta.

Consequências práticas:
- a DM sai em **até 1 minuto** depois do comentário, não na hora;
- uma automação só responde comentários feitos **depois que ela foi criada**, então
  criar uma automação nova nunca dispara DM para quem comentou no passado;
- quando o Meta aprovar o acesso avançado e começar a entregar, nada se repete: cada
  comentário e cada mensagem são processados uma única vez.

Para desligar a busca ativa, crie o segredo `POLLING_ENABLED` com o valor `false`.

A função `ig-diagnostico` (protegida pelo `SCHED_SECRET`) mostra a conta conectada, os
comentários reais de um post (`?media_id=`) e as conversas recentes (`&conversas=1`).

### Automações de story

No editor, em **Quando disparar**, escolha **Resposta ao story**. A automação dispara quando
alguém responde um story seu, pelo direct, com uma das palavras (ou com qualquer texto, se
"qualquer palavra ativa" estiver ligado). Sem stories escolhidos, vale para qualquer story,
inclusive os que você postar depois. Como a resposta da pessoa já abre a conversa, a Mensagem
1 sai direto no direct, e não existe resposta pública.

O robô `ig_entradas_10s` busca comentários novos e respostas a stories a cada 10 segundos,
enquanto houver alguma automação ligada, então a primeira DM sai em segundos tanto no feed
quanto no story. Rode o `sql/07_entradas_rapidas.sql` para criá-lo (ele substitui o robô de
stories do arquivo 06). Se o Instagram avisar que o limite de uso da API foi atingido, a busca
rápida pausa sozinha por 10 minutos, e a rodada de cada minuto continua.

A regra das 24 horas vale **por automação**: quem comenta num post e responde um story
recebe as duas mensagens, mas nunca recebe a mesma automação duas vezes no mesmo dia. Se a
pessoa estiver em duas conversas ao mesmo tempo, os botões das duas continuam funcionando.

### Central do Instagram (as cinco abas)

Rode o `sql/08_central_instagram.sql` e publique as funções `ig-analytics` (com login) e
`ig-link` (pública, `--no-verify-jwt`).

- **📊 Visão geral:** filtro de período (7, 15, 30, 90 dias ou personalizado), 8 indicadores
  com comparação ao período anterior, gráficos de crescimento, alcance (com seguidores x não
  seguidores) e engajamento, melhores conteúdos, funil do lead, saúde das automações e
  atividade recente.
- **⚙️ Automações:** cartões com miniatura, gatilho, palavras, link, ligar/desligar e as
  métricas de cada uma. Clique num cartão para ver o detalhe e o histórico de execução.
- **👥 Leads:** a planilha completa, com filtros, o caminho de cada lead e exportação. Clique
  numa linha para ver a linha do tempo da pessoa.
- **💬 Interações:** todos os eventos (comentários, DMs, respostas, cliques, novos leads).
- **📈 Análises:** taxas de entrega, resposta e clique, séries por dia, desempenho de cada
  automação, palavras-chave, horários de pico, origem dos leads e conteúdos que mais geraram leads.

O que o painel mostra e de onde vem:
- **Métricas da conta e dos conteúdos:** da API do Instagram, guardadas em cache
  (`ig_insights_diario`, `ig_media_insights`). O botão ↻ Atualizar busca de novo.
- **Seguidores ganhos por dia:** o Instagram só informa os últimos 30 dias.
- **Seguidores gerados por conteúdo:** só existe para posts do feed; Reels aparecem como n/d.
- **DM entregue:** significa aceita pelo Instagram. Confirmação de leitura só com acesso avançado.
- **Cliques:** o botão de link aponta para `ig-link`, que registra o clique e redireciona na
  hora para o destino. Contam a partir desta versão; robôs de pré-visualização são ignorados.
- **Conversão:** aparece como não disponível, porque o sistema não recebe dados de venda.

### Aba Leads (antes chamada Interações)

A planilha de todos os leads: nome, @, foto, origem (comentário ou story, com a miniatura do
conteúdo), palavra, contato, etiquetas, automação, interações, mensagens enviadas, primeira e
última vez. Tem busca, filtros, ordenação por coluna, etiquetas editáveis (lápis na célula) e
**Exportar planilha**, que baixa um CSV que abre direto no Excel e no Google Planilhas.

Cada automação aplica etiquetas a quem entra por ela: as do campo "Etiquetas" do editor ou,
se ele estiver vazio, o nome da automação.

---

## Passo 8: publicar o frontend

1. Abra `assets/config.js` e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`
   (ambos em Settings > API, no Supabase).
2. Suba os arquivos em qualquer host estático, por exemplo o GitHub Pages.

A chave anônima pode ficar à vista no arquivo: quem tranca o banco é o RLS que você
rodou no passo 1. Fora do localhost, o login passa a ser o do Supabase, com o usuário
que você criou no passo 2.

---

## Passo 9: testar

Use uma **segunda conta** do Instagram pra comentar a palavra-chave. A sua própria
conta é ignorada de propósito (comentário do dono do post não dispara nada).

Se você colocou o id dessa segunda conta em `TEST_IG_ACCOUNTS`, ela também ignora a
regra do 1 por dia, então dá pra testar quantas vezes quiser.

Onde olhar quando algo não sai:

```sql
select * from ig_deliveries order by ts desc limit 20;   -- o que saiu e o que falhou
select * from ig_send_queue where status = 'pendente';   -- o que está segurado na fila
select * from ig_send_budget;                            -- o freio e o disjuntor
```

Os logs das funções ficam no Supabase, em Edge Functions > a função > Logs.

---

## Passo 10: ligar a trava da assinatura

Quando tudo estiver funcionando, mude o segredo `APP_SECRET_ENFORCE` pra `true` e
publique a função de novo. A partir daí, requisição sem assinatura válida do Meta é
recusada.

---

## Como a conversa é guardada (o `flow`)

Cada automação guarda a conversa inteira num campo só, o `flow`:

```json
{
  "steps": [
    {
      "id": 1,
      "message": "Oi! Toca no botão aí embaixo",
      "buttons": [{ "title": "Quero o link", "next": 2 }]
    },
    {
      "id": 2,
      "message": "Toma aqui",
      "buttons": [{ "title": "Acessar", "url": "https://exemplo.com" }]
    }
  ]
}
```

Regras:
- A Mensagem 1 é sempre o **primeiro item** do array `steps` (o código pega o primeiro,
  não procura por um id específico).
- Um botão tem **ou** `next` (vai pra outra mensagem) **ou** `url` (abre um link).
  Nunca os dois.
- Botão sem `next` e sem `url` significa "encerrar": a conversa acaba ali e ele nem é
  enviado.
- O botão que avança vira um **postback** com o payload `STEP:idDaAutomacao:proximoPasso`.
  É o id da automação dentro do payload que impede duas automações com o mesmo texto de
  botão de se misturarem.

---

## Regras e limites (pra não tomar bloqueio)

- **Opt-in sempre.** O sistema só responde quem comentou. Nada de disparo em massa,
  nada de lista comprada. Isso não é negociável nem com o Meta nem com quem recebe.
- **1 DM por pessoa a cada 24h** em gatilho de comentário. As contas listadas em
  `TEST_IG_ACCOUNTS` ignoram essa regra, só pra você testar.
- **Freio de envio.** Os tetos padrão são 6 por minuto, 60 por hora e 180 por dia,
  bem abaixo do limite do Instagram (que gira em torno de 200 a 300 respostas privadas
  por dia). Quem passar do teto espera na fila. Três falhas duras seguidas pausam os
  envios por 3 horas.
- **Janela de 24h da Meta.** Fora de uma interação recente, não dá pra mandar DM. O
  comentário e o toque no botão são o que abrem essa janela.
- **O token vence em cerca de 60 dias.** A renovação semanal cuida disso, mas confira
  de vez em quando a tabela `ig_token_status`.
- **Título de botão: 20 caracteres.** O Instagram corta o resto.
- **No máximo 3 botões por mensagem** no formato colado no balão. Se cair no formato
  de pílula (o plano B), cabem até 13.
- **Resposta a comentário vale cerca de 7 dias.** Depois disso o item da fila expira.
- **O banco devolve no máximo 1000 linhas por requisição.** Nas tabelas que crescem
  (leads, entregas), pagine.

---

## Checklist do que você precisa preencher

- [ ] `assets/config.js`: `SUPABASE_URL` e `SUPABASE_ANON_KEY`
- [ ] `sql/04_agendamento.sql`: `SEU_PROJETO_AQUI` e `SEU_SCHED_SECRET_AQUI`
- [ ] Segredos das Edge Functions: `IG_ACCESS_TOKEN`, `IG_ACCOUNT_ID`, `APP_SECRET`,
      `APP_SECRET_ENFORCE`, `VERIFY_TOKEN`, `GRAPH_API_VERSION`, `SCHED_SECRET`,
      `TEST_IG_ACCOUNTS`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Usuário admin criado no Authentication do Supabase
- [ ] Webhook do Meta com `comments`, `messages` e `messaging_postbacks` assinados
