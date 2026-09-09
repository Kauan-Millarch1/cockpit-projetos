# Anatomia da aba Tester: os seis momentos, e o que está escrito em cada um

**Tudo aqui foi lido da tela rodando.** Os textos são os que a tela mostra, com a caixa que
ela mostra — vários rótulos são `text-transform: uppercase`, então o que se vê é maiúsculo
mesmo que o código escreva minúsculo.

## A diferença que manda em tudo: a aba Fluxos é uma tela, o Tester é uma MÁQUINA

A aba Fluxos mostra um painel e ele fica lá. O Tester **atravessa seis estados**, e cada um
apaga boa parte do anterior. Desenhar "a tela do Tester" é impossível: não existe uma. O que
existe são os momentos abaixo, e cada cena do vídeo mora em exatamente um deles.

| momento | o que está em quadro |
|---|---|
| **abertura** | a tela de abertura, antes de qualquer coisa |
| **entrevista** | a etapa 01, com as perguntas na tela |
| **construcao** | as etapas correndo e o desenho se construindo |
| **fantasma** | o portão do fantasma, com a bolha do Slack e o rodapé |
| **entrega** | a etapa 07, com o JSON e o checklist de credenciais |
| **projetoSalvo** | um projeto já construído, reaberto da tela de abertura |

Os seis foram medidos um a um, cada um a partir de um carregamento novo da página — a
máquina de fases da fixture sobrevive entre medições do mesmo processo, e sem recomeçar do
zero um momento herdaria a fase do anterior: a tela errada, com os números certos.

---

## O que existe em TODOS os momentos

**A topbar**, 58px de altura. Da esquerda: o wordmark da Ecommerce Puro, a chama e
`COCKPIT / tester`, o **carimbo de versão da base** (medido: `v3.4`), a cápsula de
navegação, e à direita `⊘ Avisar`, `◐`, `⏺ Gravar`.

Dentro de uma construção a topbar ganha mais duas coisas à esquerda: `← início` e o resumo do
que está sendo construído — medido: `← início` mais
`quero ser avisado no Slack quando entrar uma… · medio`. **Sair no meio é seguro**: a sessão
vive no servidor, e o cartão dela volta na tela de abertura.

**A cápsula de navegação** tem cinco portas, e uma delas não é porta de produto:

| rótulo | rota | é porta de produto? |
|---|---|---|
| Fluxos alt 1 | `/` | sim |
| Disco alt 2 | `/disco` | sim |
| Tester alt 3 | `/tester` | sim |
| Upgrade alt 4 | `/upgrade` | sim |
| Conta alt 5 | `/conta` | **não** — é a conta |

**O rodapé**, 30px de altura, e ele é DERIVADO — muda dentro do vídeo. São dois textos e
os dois estão medidos:

| quando | o que diz (literal) |
|---|---|
| até a etapa 04 | `nada foi criado no n8n · nenhuma chamada feita` |
| da etapa 05 em diante | `cópia de teste no n8n: [SANDBOX tester] loja_aviso_venda_slack · inativa · sem credenciais · seu fluxo original intocado` |

**Essa troca é o assunto de uma cena inteira, e ela não pode ser suavizada.** O Tester
escreve UMA coisa no n8n: uma cópia inativa, sem credencial, com o nome prefixado, só para
provar que a instância aceita o schema. O fluxo original de quem assiste fica intocado — e é
a palavra do rodapé, não um adjetivo da narração.

---

## Momento 1 · abertura

| | |
|---|---|
| título | **O que vamos construir?** |
| linha abaixo | Escreve do seu jeito. Não precisa saber n8n — eu pergunto o que faltar. |
| placeholder do campo | *quero ver quantas vendas eu fiz no mercado livre* |
| rótulo dos níveis | `SEU NÍVEL` |
| os três níveis | `nunca mexi` · `sei o básico` · `sou técnico` |
| botão | `Começar →` |

**A caixa da ideia mede 700×146px** e tem três entradas dentro dela, não uma:
`● falar`, `⊕ anexar`, `⊞ pasta`. A voz e os anexos
existem porque uma ideia digitada em duas linhas perde justamente o que decide o fluxo — o
formato real do destino, o nome verdadeiro das colunas.

**Os quatro exemplos clicáveis, literais:**

- `avisar no Slack quando cair pedido novo`
- `todo dia às 9h, resumo das tarefas abertas do ClickUp no Slack`
- `quando entrar lead no Supabase, mandar mensagem no WhatsApp`
- `um agente que responde os leads no WhatsApp e tira dúvida sobre os eventos`

**O bloco `[ SEUS PROJETOS ]`**, com a contagem, a porta da `Lixeira` e um `⋯` por cartão
(`Renomear`, `Excluir`). Os três projetos em quadro, medidos:

| projeto | ideia | nós | quando |
|---|---|---|---|
| Aviso de venda no Slack | quero ser avisado no Slack quando entrar uma venda nova na loja, com o nome do produto e o valor | 4 nós · webhook, if, set | 26/08/2026 · simulou |
| NPS pós-venda no WhatsApp | mandar a pesquisa de satisfação 3 dias depois da entrega | 7 nós · scheduleTrigger, supabase, if | 23/08/2026 · simulou |
| Resumo diário de estoque | todo dia às 8h, listar o que está abaixo do mínimo | 6 nós · scheduleTrigger, supabase, code | 17/08/2026 |

---

## Momento 2 · entrevista (etapa 01)

É aqui que o Tester deixa de parecer um campo de busca. Ele **pergunta o que falta**, em
rodadas, e cada pergunta traz por baixo a razão de existir. As três em quadro, literais:

**Em que canal do Slack o aviso deve chegar?**

> Destino é a única dimensão sem padrão possível: um canal, um número e uma planilha não são chutáveis.

`#vendas` · `#geral` · `mensagem direta pra mim` · `Outro…`

**O que a mensagem precisa mostrar?**

> Isto decide os campos que o fluxo lê do pedido — e a opção aqui é a mensagem que sai, não um rótulo dela.

`só produto e valor` · `produto, valor e nome do cliente` · `produto, valor, cliente e link do pedido` · `Outro…`

**E quando o pedido for cancelado ou o pagamento cair depois?**

> Sem isto o fluxo avisa de venda que não existe, e o canal deixa de ser confiável.

`avisar só pagamento aprovado` · `avisar tudo e marcar o status` · `avisar aprovado e mandar outro aviso se cancelar` · `Outro…`

**A segunda pergunta não tem opção de texto: cada opção É A MENSAGEM que ela produz.**
Medido em quadro, cada uma das três vem desenhada como uma bolha de Slack, com o selo
`MODELO`, o cabeçalho `canal do Slack`, o remetente `◈ seu fluxo`, o crachá `APP`, a hora
`09:00` e o texto:

```
*Venda nova* 🎉
{{ produto }} — R$ {{ valor }}
Cliente: {{ cliente }}
<{{ link }}|abrir o pedido>
```

**`MODELO` e `SIMULAÇÃO` são dois selos e nunca podem virar um.** `MODELO` é texto que o
modelo escreveu para você comparar antes de o fluxo existir; `SIMULAÇÃO` (momento 4) é o
fluxo resolvendo as próprias expressões. Um selo só para os dois apagaria a única coisa que
faz o fantasma valer alguma coisa. Os `{{ campo }}` são o BURACO onde o valor entra, e são
pintados em `--accent` por isso — nunca em cor de status.

O rodapé da entrevista, literal: **`Faltam 3 respostas pra fechar o desenho`**, mais
`Cada resposta vira uma decisão de construção. Dá pra pular, mas o que ficar em aberto eu
preencho com o padrão mais comum e marco como suposição nos achados.` Os dois botões:
`Enviar respostas →` e `Pular e construir assim mesmo`. E o carimbo de gasto da rodada:
`RODADA 1 DA ENTREVISTA · ATÉ AQUI US$0,18`.

---

## A coluna da direita, presente do momento 2 em diante

Quatro seções, e o índice faz parte do desenho: `[ ETAPAS ]`, `[ ACHADOS ]`, `[ CREDENCIAIS ]`, `[ GASTO ]`.

**`[ ETAPAS ]`** é a esteira de sete, com o contador `NN de 07` no cabeçalho. Os nomes são
fixos; o que muda é a etiqueta de cada um. Medido no momento **fantasma**:

| # | nome | etiqueta | nota |
|---|---|---|---|
| 01 | Entender | `✓` |  |
| 02 | Pesquisar | `PULADA` | todo serviço já tem nó nesta instância — nada a pesquisar |
| 03 | Ingredientes | `✓` |  |
| 04 | Desenhar | `✓` |  |
| 05 | Validar | `✓` |  |
| 06 | Fantasma | `ESPERA VOCÊ` |  |
| 07 | Entregar | — |  |

**A etapa 02 costuma ser PULADA, e a nota diz por quê** — `todo serviço já tem nó nesta instância — nada a pesquisar`.
Isso é o produto, não o fixture: pesquisar é o passo mais caro do processo, e quando todo
serviço já tem nó não há nada para ler.

**A etapa 06 nasce marcada `para aqui`** enquanto ainda está pendente. Marcar de antemão
onde a esteira vai parar é informação; confundir isso com "parou agora" não é, e o tom é o
que separa os dois. **A esteira só para em dois lugares no vídeo inteiro: 01 e 06.**

**`[ ACHADOS ]`** é onde o Tester escreve o que ele mesmo não tem certeza. Os dois que
aparecem no vídeo, literais:

- **FALTA** — o destino ainda não foi dito, e não existe padrão razoável para ele  ·  *A CONFIRMAR · ainda não verifiquei*
- **RISCO** — o canal foi resolvido pelo NOME (`#vendas`); confira se é o id certo na sua conta  ·  *A CONFIRMAR · ainda não verifiquei*

A terceira linha de cada achado (`A CONFIRMAR · ainda não verifiquei`) é a FONTE, e ela é o
ponto: o Tester separa o que mediu do que supôs, na cara de quem lê.

**`[ CREDENCIAIS ]`** troca de conteúdo dentro do vídeo, e as duas frases estão medidas:

| momento | o que está no lugar |
|---|---|
| entrevista | *ainda não sei quais credenciais este fluxo precisa* |
| construção em diante | **JÁ USA** — slackApi pede: accessToken |

O selo `JÁ USA` significa "esta credencial aparece nos seus outros fluxos" — nunca "ela
funciona": a API pública do n8n não tem como testar credencial, e o painel não afirma o que
não pode.

**`[ GASTO ]`** diz `desta construção` e traz o valor corrente, com a frase
`equivalentes · sai do seu plano, sem cobrança por fora.` mais
`Mexer na simulação depois de pronto não gasta nada — ela roda aqui na sua máquina.`

---

## Momento 3 · construção (etapas 03–05)

A faixa de processamento, 604×62px, borda `--accent`. Literal em quadro:

> Processando a próxima etapa — Desenhar escrevendo workflow.json 04 / 07 ⨯ parar esc

Três partes: o título (`Processando a próxima etapa — <nome>`), a **linha de atividade**
(`escrevendo workflow.json` — o que a sessão está fazendo agora, não um texto genérico), o
passo `04 / 07` em fonte monoespaçada, e o botão `⨯ parar` carregando a tecla `esc`.

O canto do desenho mostra `[ MONTANDO 3 / 4 ]` **enquanto revela** e vira
`[ 4 NOS · 3 CONEXOES ]` quando termina. A diferença não é cosmética: ele revela um documento
que já está pronto, e não afirma estar escrevendo o terceiro nó enquanto os quatro existem.

Os quatro nós do fluxo em quadro, com o tipo que aparece por baixo de cada um:

| nó | tipo |
|---|---|
| `webhook_pedido_pago` | webhook |
| `if_pagamento_aprovado` | if |
| `set_montar_aviso` | set |
| `slack_avisar_vendas` | slack |

A linha de ajuda embaixo do desenho, literal: `arraste para mover · role para aproximar ·
duplo clique para ajustar`, mais o botão `ajustar`.

---

## Momento 4 · fantasma (etapa 06) — o portão

O cabeçalho, literal: **`[ 06 ] O QUE ISTO PRODUZIRIA`**, com `· modelo` ao lado.

A bolha, 550×84px, na anatomia do Slack e **nunca nas cores de marca do Slack**: cabeçalho
com o canal `#vendas`, selo `SIMULAÇÃO`, remetente `◈ slack_avisar_vendas` com crachá `APP`,
hora `09:00`, e o texto resolvido:

```
*Venda nova* 🎉
Performance Shopee — Turma 5 — R$ 1788,00
Cliente: Ana Carolina Ribeiro Souza
<https://loja.exemplo.com/admin/pedidos/48127|abrir o pedido>
```

**O relógio é 09:00 congelado, de propósito.** Hora ao vivo faria a mesma simulação mudar a
cada olhada.

O selo por baixo, literal e inteiro — é a frase mais importante desta tela:

> Isto é uma simulação. Nada foi chamado, nenhuma credencial foi usada. O texto e o destino
> vêm do seu fluxo; os dados dentro dele são de exemplo. Passar aqui não prova que o fluxo
> funciona — prova que ele monta a mensagem certa com os campos que você apontou.

E a pergunta que abre o portão:

> É isso que você queria ver? Se sim, eu fecho e te entrego o JSON pra importar no n8n. Se
> não, escreve embaixo o que mudar — eu recomeço do ponto que interessa.

Botão: `É isso, pode fechar`. Carimbo: `ATÉ AQUI US$0,79 · PLANO, SEM COBRANÇA POR FORA`.

---

## Momento 5 · entrega (etapa 07)

Cabeçalho: **`[ 07 ] PRONTO PARA IMPORTAR`**, com o selo literal:

> O JSON abaixo é exatamente o que foi testado na cópia de teste, com uma diferença: o nome,
> que na cópia leva o prefixo [SANDBOX tester]. Ele não traz credenciais — depois de
> importar, escolha cada credencial no editor do n8n.

Os controles em quadro, literais: `Dê um nome a este projeto para guardá-lo`,
`Salvar projeto`, `⧉ Copiar o JSON`, `Abrir a cópia de teste ↗`, `← Voltar para o início`.

E o interruptor que decide o que sai no JSON: **`ligar no JSON as credenciais que já
existem`**, com a frase por baixo — literal:

> 1 nó(s) já vão ligados. Só liga quando existe UMA credencial possível — havendo duas, a
> escolha é sua, e um palpite aqui importaria calado e mandaria a mensagem pela conta errada.

A seção `[ CREDENCIAIS ] POR NÓ` aparece aqui com a frase que ela pode honestamente dizer:

> nenhum nó deste fluxo pediu credencial nos seus outros fluxos. Isso é o que dá para
> afirmar — não é promessa de que nenhum vai pedir.

O JSON em quadro é o do fluxo de 4 nós, e ele é REAL — validado, com `typeVersion` por nó
(`webhook` 2, `if` 2.2, `set` 3.4, `slack` 2.3) e as `connections` completas. Não precisa
estar legível inteiro; precisa **parecer o que é**, que é um documento pronto e não um
rascunho.

---

## Momento 6 · um projeto já construído

Clicando um cartão de `[ SEUS PROJETOS ]`, a tela volta com tudo: o `VOCÊ` com a ideia
original, o bloco **`◈ O QUE EU ENTENDI`** (as quatro linhas medidas abaixo), o desenho, o
fantasma, as credenciais e o JSON.

| linha | conteúdo |
|---|---|
| quando | quando o webhook da loja avisa que um pedido foi pago |
| o que faz | lê o pedido, monta uma linha com produto e valor, e manda no Slack |
| resultado | uma mensagem no canal, com o link do pedido |
| onde chega | canal #vendas do Slack |

O cabeçalho do bloco é `[ PROJETO GUARDADO ]` com a data `26/08/2026` e o nome
`Aviso de venda no Slack`. Os botões: `✎ Conversar e editar`, `⧉ Copiar o JSON`,
`← Voltar para o início`. E a seção `[ NÓS ] 4` lista os quatro com o tipo de cada um.

**O rodapé volta a `nada foi criado no n8n · nenhuma chamada feita`**, porque abrir um projeto salvo
não chama nada. É a mesma frase do momento 1, e ela está certa nos dois.

---

## Os dados que aparecem em quadro

São dados **falsos**, de `.video/fixtures.js`. Use estes valores e não outros:

| fato | valor |
|---|---|
| a ideia digitada | **avisar no Slack quando cair pedido novo** |
| o nível escolhido | **sei o básico** (`medio` no resumo da topbar) |
| a ideia completa, como o Tester a repete | **quero ser avisado no Slack quando entrar uma venda nova na loja, com o nome do produto e o valor** |
| perguntas na primeira rodada | **3** |
| canal escolhido | **#vendas** |
| etapas | **7**, com a **02** pulada |
| nós do fluxo | **4**, com **3** conexões |
| nome do fluxo gerado | **loja_aviso_venda_slack** |
| cópia de teste criada | **[SANDBOX tester] loja_aviso_venda_slack** |
| gasto após a entrevista | **US$0,18** |
| gasto no fantasma | **US$0,79** |
| credencial reconhecida | **slackApi**, pedindo **accessToken** |
| projetos guardados | **3**, mais **1** na lixeira |
| produto na simulação | **Performance Shopee — Turma 5 — R$ 1788,00** |
| cliente na simulação | **Ana Carolina Ribeiro Souza** |

**O número do gasto é o que faz esta aba ser levada a sério, e ele não pode ser arredondado
para "centavos" na animação.** `US$0,18` e `US$0,79` são o que a tela mostra, e a frase ao
lado (`sai do seu plano, sem cobrança por fora`) é o que responde a pergunta que quem
assiste vai fazer em seguida.
