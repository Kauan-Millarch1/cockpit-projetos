# Sistema de design do Cockpit — medido, não descrito

**Todos os valores deste arquivo foram lidos da aba Upgrade rodando**, com
`getComputedStyle` no browser — não do CSS-fonte e não de memória. Isso importa porque
várias cores saem de `color-mix()` e de variável que troca por tema: ler o fonte daria a
fórmula, não a cor.

Medido em 27/08/2026, 09:04:57, na rota `/upgrade`, contra os dados falsos de
`.video/fixtures.js`. Nenhum pedido saiu para o servidor real.

**Este vídeo é no tema CLARO do começo ao fim, e não troca de tema em nenhuma cena.** A
coluna escura está na tabela mesmo assim, porque a paleta é a mesma nas quatro abas do
produto e um brief que traz metade dela convida a inventar a outra metade quando alguma cena
precisar de um tom mais fundo. Ela é referência, não é para ser usada aqui.

## Cores

| token | claro | escuro | para que serve |
|---|---|---|---|
| `--bg` | `#FAFAF9` | `#06060B` | fundo da página |
| `--bg-deep` | `#F4F4F2` | `#040408` | fundo mais fundo (scrim, trilhos) |
| `--surface` | `#FFFFFF` | `#0E0F1A` | cartão, painel |
| `--surface-2` | `#00000005` | `#14162454` | faixa alternada dentro de painel |
| `--raised` | `#FFFFFF` | `#171A2B` | elemento acima do cartão |
| `--line` | `rgba(10,10,20,.11)` | `rgba(255,255,255,.09)` | borda padrão |
| `--line-soft` | `rgba(10,10,20,.06)` | `rgba(255,255,255,.05)` | divisória interna |
| `--grid` | `rgba(10,10,20,.045)` | `rgba(255,255,255,.028)` | malha de fundo (blueprint) |
| `--grid-bold` | `rgba(10,10,20,.08)` | `rgba(255,255,255,.055)` | malha, linha forte |
| `--txt` | `#14151C` | `#E9EBF5` | texto principal |
| `--txt-dim` | `#3F424D` | `#AAAFC2` | texto secundário |
| `--txt-faint` | `#666973` | `#777D92` | texto terciário |
| `--accent` | `#3B48E0` | `#5865F5` | MOVIMENTO e seleção — nunca status |
| `--accent-soft` | `#3B48E014` | `#5865F51f` | fundo de item selecionado |
| `--accent-line` | `#3B48E055` | `#5865F55c` | borda de item selecionado |
| `--brand` | `#FF5A1F` | `#FF5A1F` | identidade: wordmark, índice de seção |
| `--ok` | `#0E9F6E` | `#2FD48F` | status: deu certo (preenchimento/borda) |
| `--warn` | `#B7791F` | `#F5A524` | status: atenção |
| `--risk` | `#DC2B3A` | `#FF4F5E` | status: falhou |
| `--cold` | `#8B90A0` | `#59617D` | status: quieto/inativo |
| `--ok-soft` | `#0E9F6E14` | `#2FD48F1a` | fundo de pill ok |
| `--warn-soft` | `#B7791F14` | `#F5A5241a` | fundo de pill atenção |
| `--risk-soft` | `#DC2B3A14` | `#FF4F5E1a` | fundo de pill falha |
| `--cold-soft` | `#8B90A014` | `#59617D1a` | fundo de pill quieto |
| `--ok-txt` | `#0B8159` | `#2FD48F` | TEXTO verde (par de contraste) |
| `--warn-txt` | `#9A661A` | `#F5A524` | TEXTO âmbar |
| `--risk-txt` | `#D02937` | `#FF4F5E` | TEXTO vermelho |
| `--cold-txt` | `#6D717E` | `#798096` | TEXTO cinza |
| `--accent-txt` | `#3B48E0` | `#606CF5` | TEXTO accent |
| `--brand-txt` | `#D04919` | `#FF5A1F` | TEXTO da marca |

### Três regras de cor que não são estética

**Cor de status é reservada.** `--ok`, `--warn`, `--risk` e `--cold` significam estado e
nada mais. Nunca use uma delas como cor decorativa, como série de gráfico ou como tinta de
tipo de nó.

**Nesta aba a regra tem uma consequência dura, porque existem DOIS vermelhos possíveis e
eles significam coisas diferentes.** No desenho do fluxo, um nó vermelho é um nó que
**falhou nas últimas 24h**; na banda do dossiê, vermelho é **dossiê velho**; na bateria,
vermelho seria uma checagem **reprovada**. São três leituras da mesma cor em três lugares, e
a legenda embaixo do desenho existe justamente por isso — ela está literal no arquivo 02 e
**precisa aparecer em quadro na cena do desenho**.

**Existem DOIS conjuntos, e o segundo é só para texto.** As cores de cima foram calibradas
como preenchimento, borda e barra — onde não há requisito de contraste. Reusá-las em texto
pequeno reprova o AA: medido no produto, o tema claro reprovava `--ok` em 3,39, `--warn` em
3,64 e `--cold` em 3,18. Os pares `-txt` existem para isso. Em texto, use o par; em
preenchimento, use o original.

**`--accent` é movimento, `--brand` é identidade.** O laranja da marca aparece no wordmark e
nos índices de seção (`[ 01 ]`, `[ 02 ]`, `[ REVISÃO ]`, `[ VERIFICANDO UPGRADE ]`), e em
nada mais. Nenhum brilho colorido: elevação é sombra neutra.

## Tipografia

| | |
|---|---|
| fonte de texto | `"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, -apple-system, sans-serif` |
| fonte de número | `"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", ui-monospace, monospace` |
| texto de corpo | 10.5px / 15.225px |
| cartão da vitrine | 15px |
| linha do seletor | 13.3333px |
| banda do dossiê | 15px |
| linha da bateria | 15px |
| compositor | 12.5px |

**Todo número usa a fonte monoespaçada com `tabular-nums`.** É vocabulário de painel de
instrumento, e é o que faz coluna de número alinhar. Nesta aba os números que aparecem são
a contagem de nós de cada fluxo, as execuções por 24h, o peso em tokens, o preço do dossiê,
o contador da bateria (`09 / 09`) e as linhas do diff — vários deles mudam em quadro, e é
por isso que a largura de cada dígito precisa ser fixa: com fonte de texto o número **treme**
enquanto conta.

## Geometria

| elemento | tamanho medido | detalhe |
|---|---|---|
| topbar | 1920×58px | `height: 58px` · `padding: 0px 22px` · `border-bottom: 1px solid rgba(10, 10, 20, 0.11)` |
| cartão da vitrine | 292×243px | `padding: 0px` · `border-radius: 12px` · `border: 1px solid rgba(10, 10, 20, 0.11)` |
| linha do seletor | 498×52px | `height: 52px` · `padding: 9px 10px` · `border-radius: 10px` |
| cabeçalho do fluxo | 1518×59px | `padding: 13px 16px` · `border-bottom: 1px solid rgba(10, 10, 20, 0.11)` |
| banda do dossiê | 1518×55px | `padding: 11px 16px` · `border-radius: 0px` · `border: ` |
| compositor | 585×76px | `padding: 11px 12px` · `border-radius: 0px` · `border: 0px none rgb(20, 21, 28)` |
| bolha da conversa | 504×42px | `padding: 10px 12px` · `border-radius: 11px` |
| bloco de confirmação | 587×48px | `padding: 12px 0px 0px` · `border-radius: 0px` · `border: ` |
| bateria | 561×337px | `padding: 0px` · `border-radius: 0px` · `border: 0px none rgb(20, 21, 28)` |
| linha da bateria | 327×50px | `padding: 7px 9px` · `border-radius: 8px` |
| rodapé da proposta | 561×42px | `padding: 9px 0px 0px` · `border-radius: 0px` · `border: ` |

| | |
|---|---|
| raio padrão | `12px` |
| sombra do cartão da vitrine | `rgba(10, 10, 20, 0.04) 0px 1px 2px 0px, rgba(10, 10, 20, 0.28) 0px 12px 28px -22px` |

### O desenho do fluxo

O desenho é **SVG com câmera** (arrasta, roda para aproximar, `⤢ caber`), e a posição de
cada nó é a **posição real dele no n8n** — não é um layout nosso. Medir o retângulo do DOM
daria um número que muda com a roda do mouse, então o que vale é o que a própria tela diz:
a legenda embaixo do desenho declara **`nó 67px`** como o tamanho corrente.

O rótulo fica **fora do nó, por baixo**, em duas linhas: o nome em `--txt` e o tipo com a
operação (`whatsApp · send: message`, `redis · get`) em `--txt-faint`, na fonte
monoespaçada. Nomes longos são **truncados com reticências na própria tela**
(`Transcrever áu…`, `redis_gravar_b…`) — desenhar o nome inteiro mostraria um cockpit que
não existe.

**Três estados de nó, e a legenda em quadro os nomeia:** `vai ser mexido` (o alvo, aceso em
`--accent`), `falhou em 24h` (`--risk`) e `intocado`. Essa legenda é o que impede o vermelho
do desenho de ser lido como o vermelho da bateria.
