# Sistema de design do Cockpit — medido, não descrito

**Todos os valores deste arquivo foram lidos da aba Tester rodando**, com
`getComputedStyle` no browser — não do CSS-fonte e não de memória. Isso importa porque
várias cores saem de `color-mix()` e de variável que troca por tema: ler o fonte daria a
fórmula, não a cor.

Medido em 26/08/2026, 17:04:30, na rota `/tester`, contra os dados falsos de
`.video/fixtures.js`. Nenhum pedido saiu para o servidor real.

**Este vídeo é no tema CLARO do começo ao fim, e não troca de tema em nenhuma cena.** A
coluna escura está na tabela mesmo assim, por um motivo: a paleta é a mesma nas quatro abas
do produto, e um brief que traz metade dela convida a inventar a outra metade quando alguma
cena precisar de um tom mais fundo. Ela é referência, não é para ser usada aqui.

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

### Duas regras de cor que não são estética

**Cor de status é reservada.** `--ok`, `--warn`, `--risk` e `--cold` significam estado e
nada mais. Nunca use uma delas como cor decorativa, como série de gráfico ou como tinta de
tipo de nó — se o verde puder significar "é um nó de banco", ele para de significar "deu
certo". No Tester isso aparece na esteira de etapas: `✓`, `PULADA`, `AGORA` e `ESPERA VOCÊ`
são quatro estados, e a cor é o que os separa a três metros de distância.

**Existem DOIS conjuntos, e o segundo é só para texto.** As cores de cima foram calibradas
como preenchimento, borda e barra — onde não há requisito de contraste. Reusá-las em texto
pequeno reprova o AA: medido no produto, o tema claro reprovava `--ok` em 3,39, `--warn` em
3,64 e `--cold` em 3,18. Os pares `-txt` existem para isso. Em texto, use o par; em
preenchimento, use o original.

**`--accent` é movimento, `--brand` é identidade.** O laranja da marca aparece no wordmark e
no índice de seção (`[ ETAPAS ]`, `[ 06 ]`, `[ 07 ]`), e em nada mais. Nenhum brilho
colorido: elevação é sombra neutra.

## Tipografia

| | |
|---|---|
| fonte de texto | `"Segoe UI Variable Display","Segoe UI",Inter,system-ui,-apple-system,sans-serif` |
| fonte de número | `"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",ui-monospace,monospace` |
| texto de corpo | 13.5px / 21.6px |
| chip de nível | 11.5px, peso 400 |
| chip de exemplo | 11.5px |
| botão | 12px, peso 600 |
| cabeçalho de seção (`[ ETAPAS ]`) | 9.5px, espaçamento 0.57px |
| rodapé | 10px |

**Todo número usa a fonte monoespaçada com `tabular-nums`.** É vocabulário de painel de
instrumento, e é o que faz coluna de número alinhar. No Tester os números que aparecem são
o passo (`04 / 07`), a contagem de etapas feitas (`05 de 07`) e o gasto (`US$0,79`) — todos
mudam em quadro, e é por isso que a largura de cada dígito precisa ser fixa: com fonte de
texto o número **treme** enquanto conta.

## Geometria

| elemento | tamanho medido | detalhe |
|---|---|---|
| topbar | 1920×58px | `height: 58px` · `padding: 0px 22px` · `border-bottom: 1px solid rgba(10, 10, 20, 0.11)` |
| caixa da ideia | 700×146px | `padding: 15px 16px 12px` · `border-radius: 14px` · `border: 1px solid rgba(10, 10, 20, 0.11)` |
| chip de nível | 83×30px | `height: 30px` · `padding: 5px 12px` · `border-radius: 999px` |
| chip de exemplo | 229×29px | `height: 29px` · `padding: 6px 12px` · `border-radius: 999px` · `border: 1px dashed rgba(10, 10, 20, 0.11)` |
| botão `Começar →` | 93×34px | `height: 34px` · `padding: 8px 14px` · `border-radius: 9px` |
| faixa de processamento | 604×62px | `padding: 12px 14px` · `border-radius: 12px` · `border: 1px solid rgba(59, 72, 224, 0.333)` |
| linha de etapa | 302×30px | `height: 30px` · `padding: 7px 8px` · `border-radius: 8px` |
| cabeçalho de seção | 302×11px | `font-size: 9.5px` · `letter-spacing: 0.57px` |
| cartão de achado | 302×88px | `padding: 9px 11px` · `border-radius: 10px` · `border: 1px solid rgba(10, 10, 20, 0.11)` |
| bolha do Slack | 550×84px | `padding: 12px 14px` |
| rodapé | 1920×30px | `height: 30px` · `padding: 9px 18px` |

| | |
|---|---|
| raio padrão | `12px` |

**Os cartões desta tela não têm sombra** — medido, `box-shadow: none` no cartão de achado.
A separação é por borda (`--line`) e por fundo, não por elevação. A aba Fluxos usa sombra
nos cartões dela; esta não. Acrescentar uma aqui faria a coluna da direita flutuar sobre a
página, que é o oposto do que ela é: uma margem de anotação ao lado do que está acontecendo.

### O nó do desenho

O desenho do fluxo é **SVG com câmera** (arrasta, dá zoom), então medir o retângulo do DOM
daria um número que muda com a roda do mouse. O que é fixo são os atributos, nas unidades
do próprio `viewBox`:

| | |
|---|---|
| corpo do nó | `64×48`, raio `10` |
| `viewBox` do desenho de 4 nós | `0 0 680 200` |

**O rótulo fica FORA do nó, por baixo**, em duas linhas: o nome em `--txt` e o tipo do nó
em `--txt-faint`, na fonte monoespaçada. É o vocabulário do próprio editor do n8n, de
propósito — quem assiste vai abrir o n8n minutos depois, e duas linguagens visuais
custariam uma tradução a cada olhada.

**O nó tem três estados enquanto o desenho se constrói**, e eles não são decoração:
`writing` (borda `--accent` tracejada, marchando, e o rótulo ainda invisível), `built`
(borda neutra, rótulo presente) e o repouso. É essa troca que faz a etapa 04 parecer
escrita acontecendo em vez de uma imagem chegando pronta.
