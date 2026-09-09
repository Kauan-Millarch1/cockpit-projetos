# Anatomia da aba Upgrade: os seis momentos, e o que está escrito em cada um

**Tudo aqui foi lido da tela rodando.** Os textos são os que a tela mostra, com a caixa que
ela mostra — vários rótulos são `text-transform: uppercase`, então o que se vê é maiúsculo
mesmo que o código escreva minúsculo.

## A tela é uma MÁQUINA, e esta é a mais séria das quatro

A aba Fluxos mostra um painel e ele fica lá. O Tester atravessa seis estados construindo
algo do zero. **Aqui os seis estados terminam num botão que reescreve um fluxo que está
rodando em produção** — e por isso quase toda frase desta tela existe para dizer o que ainda
NÃO foi escrito.

| momento | o que está em quadro |
|---|---|
| **vitrine** | a grade de fluxos que estão de pé, com peso e preço |
| **seletor** | o seletor com TODOS os fluxos da instância, em dois grupos |
| **fluxo** | a tela de um fluxo: desenho de um lado, conversa do outro |
| **alvo** | a resposta que diz QUAL NÓ vai mexer, antes de qualquer patch |
| **bateria** | as oito checagens correndo depois do alvo confirmado |
| **diff** | o diff do que ele quer escrever, e o botão de aplicar |

Os seis foram medidos um a um, cada um a partir de um carregamento novo da página — a
máquina de fases da fixture sobrevive entre medições do mesmo processo, e sem recomeçar do
zero um momento herdaria a fase do anterior: a tela errada, com os números certos.

---

## O que existe em TODOS os momentos

**A topbar**, 58px de altura. Da esquerda: o wordmark da Ecommerce Puro, a chama e
`COCKPIT / upgrade`, a cápsula de navegação, o **endereço da instância**
(`https://exemplo.app.n8n.cloud`) com `janela de 24h · lido 08:57:16`, e à direita
`⊘ Avisar`, `◐`, `⏺ Gravar`, `Recarregar`.

**A cápsula de navegação** tem cinco portas, e uma delas não é porta de produto:

| rótulo | rota | é porta de produto? |
|---|---|---|
| Fluxos alt 1 | `/` | sim |
| Disco alt 2 | `/disco` | sim |
| Tester alt 3 | `/tester` | sim |
| Upgrade alt 4 | `/upgrade` | sim |
| Conta alt 5 | `/conta` | **não** — é a conta |

**A frase `nada foi escrito no n8n`** aparece grudada no desenho do fluxo do momento 3 em
diante, e ela **não sai** enquanto o botão de aplicar não for clicado. É a mesma disciplina
do rodapé do Tester: a tela diz o tempo todo de que lado da mesa a decisão está.

---

## Momento 1 · vitrine — qual fluxo você quer melhorar

Índice `[ 01 ]`, título **Qual fluxo você quer melhorar**, e o botão `todos os fluxos ▾` ao
lado. Abaixo, duas frases que explicam a grade — literais:

> 11 fluxos chegaram na porta. A ordem é por execução: onde roda mais é onde um upgrade
> paga. O desenho é a posição real dos nós; nó pintado de vermelho falhou nas últimas 24h. O
> peso é quanto custa conversar sobre aquele fluxo — não é cobrança, sai da mesma cota de
> plano de uma sessão interativa.

> 2 dossiê(s) apodreceram (o fluxo mudou depois deles) · 9 de 11 estão com a conversa
> travada por falta de dossiê em dia. Conferido às 08:57:16. O selo de cada cartão diz o
> estado do dossiê dele: sem dossiê em dia a conversa daquele fluxo não abre, e isso é
> informação de antes do clique.

**São 11 cartões**, e cada um traz cinco coisas: a contagem de nós, o nome, o projeto e o
estado (`ativo` / `chamado por outro fluxo`), as execuções em 24h, o peso, e o **selo do
dossiê**. Os onze, literais:

| nós | fluxo | estado | 24h | peso | selo do dossiê |
|---|---|---|---|---|---|
| 33 | WhatsApp API Oficial | ativo | 640 | leve · 15k tok | ✓ dossiê em dia |
| 14 | Cron — Proactive Outreach | ROBERTO · ativo | 96 | leve · 6k tok | ⊘ sem dossiê · conversa travada |
| 9 | Pedidos — Pagamento aprovado | LOJA · ativo | 63 | leve · 4k tok | ⊘ sem dossiê · conversa travada |
| 179 | Agente Iago Comercial | ROBERTO · chamado por outro fluxo | 34 | pesado · 81k tok | ⚠ dossiê velho · 1 nó(s) |
| 12 | Estoque — Sync Bling | LOJA · ativo | 24 | leve · 5k tok | ⊘ sem dossiê · conversa travada |
| 7 | NPS — Pós-venda | LOJA · ativo | 8 | leve · 3k tok | ⊘ sem dossiê · conversa travada |
| 108 | Agente eContrate | ECONTRATE · chamado por outro fluxo | 6 | médio · 49k tok | ⊘ dossiê velho · conversa travada |
| 11 | Sub — Buffer de mensagens | ROBERTO · chamado por outro fluxo | 5 | leve · 5k tok | ⊘ sem dossiê · conversa travada |
| 6 | Sub — Normalizar telefone | LOJA · chamado por outro fluxo | 4 | leve · 3k tok | ⊘ sem dossiê · conversa travada |
| 9 | Sub — Consultar Bling | LOJA · chamado por outro fluxo | 3 | leve · 4k tok | ⊘ sem dossiê · conversa travada |
| 8 | Sub — Registrar no Supabase | ROBERTO · chamado por outro fluxo | 2 | leve · 4k tok | ⊘ sem dossiê · conversa travada |

**Os selos são quatro e cada um leva a uma decisão diferente**, o que é o assunto de uma cena
inteira:

| selo | quer dizer | a conversa abre? |
|---|---|---|
| `✓ dossiê em dia` | o dossiê descreve o fluxo como ele está agora | **sim** |
| `⚠ dossiê velho · 1 nó(s)` | 1 nó mudou desde o dossiê | **sim**, com ressalva |
| `⊘ dossiê velho · conversa travada` | mudou demais | **não** |
| `⊘ sem dossiê · conversa travada` | nunca foi escrito | **não** |

**`sem dossiê` e `dossiê velho` NUNCA podem ler igual**, mesmo os dois travando: um leva a
*escrever* e o outro a *atualizar*, e são botões diferentes com preços diferentes.

---

## Momento 2 · o seletor — os outros 64 fluxos

Cabeçalho `[ FLUXO ] Em qual fluxo você quer mexer`, com `✕ ESC` no canto. **75 linhas**,
em dois grupos — e o grupo é a resposta para *"por que este fluxo não está na grade?"*:

**NA**

> VITRINE os 11 cartões da grade, na mesma ordem: por execução

**FORA**

> DA PORTA 64 fluxo(s) que a grade não mostra — não rodaram na janela, não estão ativos e nenhum fluxo vivo os chama (ou têm nome de rascunho). Dá para abrir: o peso e o dossiê são pedidos no clique.

A linha traz nome, projeto, o **mesmo selo de dossiê do cartão** (reusado, não reescrito),
as execuções e a contagem de nós. As três primeiras, literais:

- `WhatsApp API Oficial ✓dossiê em dia 640 33 nós`
- `Cron — Proactive Outreach ROBERTO ⊘sem dossiê · conversa travada 96 14 nós`
- `Pedidos — Pagamento aprovado LOJA ⊘sem dossiê · conversa travada 63 9 nós`

**Escolher ABRE o fluxo; não filtra a grade.** É a diferença deliberada em relação ao seletor
da aba Fluxos, onde a escolha estreita uma lista que continua na tela.

---

## Momento 3 · a tela do fluxo — desenho de um lado, conversa do outro

O cabeçalho, literal:

> [ UPGRADE ] WhatsApp API Oficial 33 nós 640 exec/24h 0 conversas trocar de fluxo ▾ ← vitrine abrir no n8n ↗

Logo abaixo, **a banda do dossiê** (classe `dos ok`), literal:

> dossiê verde em dia · 34 parágrafos, 10KB de prosa no lugar de 52KB de JSON ↻ atualizar dossiê reescreve inteiro · ~US$0,02

**Essa banda é a pré-condição do compositor, e não é decoração.** Verde ou laranja: o campo
existe. Cinza ou vermelho: **o campo não existe** — no lugar dele entra um bloco explicando
por quê. Medido nesta tela, o compositor existe e está **liberado**.

A coluna da esquerda é `[ 01 ] A conversa`, e o convite dela, literal:

> Descreve o upgrade que você quer neste fluxo. Se faltar informação eu pergunto de volta em
> vez de adivinhar — e se o que você pediu não resolver, eu digo.

O compositor tem três entradas além do teclado — `● falar`, `⊕ anexar`, `⊞ pasta` — e a
dica `Enter envia · Shift+Enter quebra linha`, mais o botão `enviar`.

A coluna da direita é **`[ 02 ] O fluxo hoje`**, com `nada foi escrito no n8n` grudado no
título. **O fluxo tem 33 nós; o desenho mostra 15** — os que a câmera enquadra na
abertura. Os rótulos vêm truncados com reticências **pela própria tela**, e é assim que
precisam ser desenhados:

| nó | tipo |
|---|---|
| `Webhook WhatsA…` | `webhook` |
| `Responder webh…` | `respondToWebhook` |
| `Triagem de míd…` | `if` |
| `Transcrever áu…` | `openAi · transcribe: audio` |
| `Normalizar tel…` | `set · manual` |
| `redis_gravar_b…` | `redis · set` |
| `Esperar o lead` | `wait` |
| `redis_ler_buff…` | `redis · get` |
| `Lock de proces…` | `code` |
| `Chamar Agente …` | `executeWorkflow` |
| `Chamar Agente …` | `executeWorkflow` |
| `Quebrar em bol…` | `code` |
| `Enviar mensagem` | `whatsApp · send: message` |
| `Gravar conversa` | `supabase · create: row` |
| `Avisar equipe …` | `slack · post: message` |

Os controles do desenho: `⤢ caber`, `+`, `−`, e a linha `arraste para andar · roda para
aproximar`. **E a legenda, que precisa estar em quadro:** `nó 67px`, `vai ser mexido`,
`falhou em 24h`, `intocado`.

---

## Momento 4 · o alvo — ele diz QUAL NÓ antes de mexer em qualquer coisa

**Este é o momento que define a aba.** O pedido vai em português e a resposta **não é um
patch**: é uma proposta de alvo, para ser confirmada. Medido em quadro:

| | |
|---|---|
| o que foi pedido | *no nó que manda a mensagem, corta o texto em 4500 caracteres, e avisa quando cortar* |
| o que ele respondeu | **ALVO PROPOSTO** — cortar o texto em 4500 caracteres antes de enviar, e avisar no fim da mensagem quando o corte acontecer |

E o detalhe por nó, literal: **`◇ Enviar mensagem`** — *o `textBody` passa a cortar em 4500 e
a acrescentar «(mensagem cortada)» quando cortar* — com a justificativa embaixo: *4500 é o
teto que a API do WhatsApp aceita por mensagem; acima disso ela recusa a chamada inteira.*

O bloco de confirmação, literal e inteiro:

> Confirma o alvo? Confirmar manda ele montar o patch e mostrar o diff aqui — custa uma rodada, e não escreve nada no n8n. ✓ é isso não, é em outro lugar

**A frase *"e não escreve nada no n8n"* está ali de propósito e não pode ser encurtada.**

---

## Momento 5 · a bateria — 9 linhas correndo

Índice `[ VERIFICANDO UPGRADE ]`. **9 linhas**, e a primeira não é uma checagem: é a
montagem do patch. Todas nascem `aguarda` e acendem em sequência.

Os 9 passos, com o texto de espera e o de aprovação medidos lado a lado. A numeração é a
da tela e **não é 1 a 8**: a regressão é uma só checagem em duas metades, `5a` e `5b`.

| passo | enquanto espera | depois de passar | rótulo |
|---|---|---|---|
| **Montando o patch** | ainda não começou | pronto | `PRONTO` |
| **Estrutura** | os 10 portões | os 10 portões passaram: nenhum nó removido, nenhuma credencial tocada | `PASSOU` |
| **Esquema do nó** | 810 tipos conhecidos | `textBody` existe em whatsApp v1.1 sob operation: send | `PASSOU` |
| **Gramática** | n8n-gramatica.md | a expressão começa com `=`, como a gramática exige | `PASSOU` |
| **Credencial** | o catálogo dos fluxos | a credencial do nó não foi tocada | `PASSOU` |
| **Regressão de caminho** | runData da janela | os 702 caminhos da janela passam pelos mesmos nós | `PASSOU` |
| **Regressão de conteúdo** | o fantasma | o fantasma monta a mesma mensagem para as entradas medidas | `PASSOU` |
| **Impacto medido** | execuções nos nós tocados | 1 nó tocado, com 702 execuções na janela | `PASSOU` |
| **Aceite do n8n** | PUT na cópia inativa | a cópia inativa `[SANDBOX upgrade]` foi aceita pela instância | `PASSOU` |

A numeração que aparece na lista compacta da conversa é `1 · 2 · 3 · 4 · 5a · 5b · 6 · 7`,
mais a linha de montagem do patch, que não é numerada.

**O cabeçalho só existe depois que termina** — durante a corrida ele está vazio, e no fim
vira `[ VERIFICANDO UPGRADE ] 8 passou`. O contador do painel cheio marca `09 / 09`.

**A ordem importa e é o argumento da cena:** começa na estrutura do documento e termina no
**aceite do próprio n8n** — uma cópia inativa `[SANDBOX upgrade]` que a instância aceitou. É
a única linha em que algo sai desta máquina, e ela acontece **antes** de qualquer aprovação.

---

## Momento 6 · o diff, e o botão que escreve

Índice `[ REVISÃO ] O que ele quer escrever`, com o resumo `1 alterado(s) · 0 novo(s) ·
0↗ / 0↘ conexões` e o link `⤢ ver a verificação`.

O diff em quadro é de **um nó só**, marcado `ALTERADO`, com as linhas sem mudança colapsadas
(`⋯ 6 linha(s) sem mudança`). O conteúdo, literal:

```diff
  "parameters": {
    "operation": "send",
    "messageType": "text",
-   "textBody": "={{ $json.bolha }}",
+   "textBody": "={{ $json.bolha.length > 4500 ? $json.bolha.slice(0, 4500) + '\n\n(mensagem cortada)' : $json.bolha }}",
    "phoneNumberId": "[PREENCHER]"
  },
```

E o rodapé da proposta, que é onde o botão vive — literal:

> A bateria passou. Aplicar escreve este diff no fluxo de verdade, e só ele. ✓ aplicar

**Na verificação aberta em tela cheia a frase é mais longa e nomeia o fluxo**, literal:
*A bateria passou. Aplicar escreve este diff em WhatsApp API Oficial — backup antes, ↺
desfazer depois.*

O rodapé da conversa mostra o gasto: `2 rodada(s) · US$0,00 · modelo ?`.

---

## Os dados que aparecem em quadro

São dados **falsos**, de `.video/fixtures.js`. Use estes valores e não outros:

| fato | valor |
|---|---|
| fluxos na grade | **11** |
| fluxos na instância | **75** |
| fluxos fora da grade | **64** |
| com a conversa travada | **9 de 11** |
| dossiês que apodreceram | **2** |
| fluxo escolhido | **WhatsApp API Oficial**, 33 nós, 640 exec/24h |
| peso dele | **leve · 15k tok** |
| dossiê dele | **verde em dia · 34 parágrafos, 10KB de prosa no lugar de 52KB de JSON** |
| preço de reescrever o dossiê | **~US$0,02** |
| nó alvo | **Enviar mensagem** (`whatsApp · send: message`) |
| o corte pedido | **4500 caracteres** |
| execuções na janela usadas na regressão | **702** |
| linhas da bateria | **9**, contador `09 / 09` |
| nós alterados pelo patch | **1** |
| cópia de teste criada | **[SANDBOX upgrade]** |

**O `[PREENCHER]` no `phoneNumberId` está em quadro e é do produto, não um erro do vídeo.**
Ele é um marcador que já existia no fluxo; o portão que proíbe placeholder olha só os
parâmetros que o patch **toca**, e este não é um deles.
