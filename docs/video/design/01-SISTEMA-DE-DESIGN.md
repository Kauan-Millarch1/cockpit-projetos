# Sistema de design do Cockpit — medido, não descrito

**Todos os valores deste arquivo foram lidos do produto rodando**, com
`getComputedStyle` no browser — não do CSS-fonte e não de memória. Isso importa porque
várias cores saem de `color-mix()` e de variável que troca por tema: ler o fonte daria a
fórmula, não a cor.

O tutorial é no **tema claro**. A coluna escura está aqui porque uma cena do roteiro clica o
botão de tema e a tela muda em quadro — então a animação precisa das duas paletas.

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
certo".

**Existem DOIS conjuntos, e o segundo é só para texto.** As cores de cima foram calibradas
como preenchimento, borda e barra — onde não há requisito de contraste. Reusá-las em texto
pequeno reprova o AA: medido no produto, o tema claro reprovava `--ok` em 3,39, `--warn` em
3,64 e `--cold` em 3,18. Os pares `-txt` existem para isso. Em texto, use o par; em
preenchimento, use o original.

**`--accent` é movimento, `--brand` é identidade.** O laranja da marca aparece no wordmark e
no índice de seção, e em nada mais. Nenhum brilho colorido: elevação é sombra neutra.

## Tipografia

| | |
|---|---|
| fonte de texto | `"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, -apple-system, sans-serif` |
| fonte de número | `"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", ui-monospace, monospace` |
| corpo | 15px / 21.75px |
| chip | 10px, uppercase, espaçamento 0.7px |
| linha do ao vivo | 12.5px |

**Todo número usa a fonte monoespaçada com `tabular-nums`.** É vocabulário de painel de
instrumento, e é o que faz coluna de número alinhar. Número em fonte de texto quebra as duas
coisas.

## Geometria

| elemento | tamanho medido | detalhe |
|---|---|---|
| topbar | 1920×58px | `height: 58px` · `padding: 0px 22px` · `border-bottom: 1px solid rgba(10, 10, 20, 0.11)` |
| coluna dos projetos | 250×1022px | `width: 250px` · `border-right: 1px solid rgba(10, 10, 20, 0.11)` |
| cartão de KPI | 261×100px | `padding: 13px 15px 14px` · `border-radius: 12px` · `border: 1px solid rgba(10, 10, 20, 0.11)` |
| cartão de fluxo | 314×173px | `padding: 14px 15px 13px` · `border-radius: 12px` |
| painel | 1284×737px | `border-radius: 12px` · `border: 1px solid rgba(10, 10, 20, 0.11)` |
| linha do ao vivo | 318×44px | `height: 44.125px` · `padding: 12px 14px` · `border-radius: 10px` |
| chip de filtro | 116×22px | `height: 22px` · `padding: 4px 9px` · `border-radius: 20px` |

| | |
|---|---|
| raio padrão | `12px` |
| sombra de cartão | `rgba(10, 10, 20, 0.04) 0px 1px 2px 0px, rgba(10, 10, 20, 0.28) 0px 12px 28px -22px` |

O nó do desenho de fluxo é um **quadrado de 84×84** com o ícone dentro e o rótulo FORA, por
baixo — é o vocabulário do próprio editor do n8n, de propósito: o painel e a aba do n8n são
lidos minutos um do outro, e duas linguagens visuais custariam uma tradução a cada olhada.
