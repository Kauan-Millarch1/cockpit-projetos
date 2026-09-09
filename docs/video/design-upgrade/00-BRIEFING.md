# Briefing — vídeo animado da aba Upgrade

Leia este arquivo primeiro. Os outros três são referência; este é o pedido.

## O que é para fazer

Um **vídeo animado curto** (~1:55) que ensina uma pessoa **não técnica** a usar a aba Upgrade do
Cockpit. Ele vai atrás de um botão *"como usar esta tela"* dentro do próprio painel, então quem
assiste **já está na tela** e quer saber onde clicar — não é peça de venda e não é tour do produto.

Vai existir um vídeo por aba (Fluxos, Disco, Tester, Upgrade). **Este é o da aba Upgrade**, o
terceiro da série. Os dois anteriores já foram feitos por você e servem de referência de linguagem:
este precisa parecer o mesmo produto.

## O que é a aba Upgrade, em duas frases

A aba Fluxos **olha** para automações que já existem. A aba Tester **constrói** uma nova do zero.
Esta aqui **mexe numa que já está rodando**: a pessoa descreve em português a melhoria que quer, o
Cockpit responde dizendo **qual nó vai tocar e por quê**, monta a alteração, roda nove conferências,
e só então mostra o que quer escrever — com o botão de aplicar do lado dela.

## Esta é a mais séria das quatro telas, e o vídeo tem de carregar isso

**As outras três olham ou constroem. Esta reescreve um fluxo que está em produção**, com tráfego
real passando por ele. Por isso quase toda frase da tela existe para dizer o que **ainda não foi
escrito** — `nada foi escrito no n8n` fica grudado no desenho o vídeo inteiro.

Não vire isso num aviso legal no fim. **É o assunto.** A ordem das cenas é deliberada e não deve ser
mexida: primeiro *como escolher onde mexer*, depois *como ele devolve o alvo antes de mexer*, e só
então *como você decide*. Invertida, a peça vira a demonstração de um botão que escreve em produção.

## A tela é uma MÁQUINA de seis estados

Igual ao Tester, e pelo mesmo motivo isso joga a favor de um vídeo animado: cada cena mora num
estado diferente e o anterior **realmente** deixa de existir. O cartão da grade que cresce e vira a
tela do fluxo é o que a tela faz, não um efeito por cima dela.

Os seis estão descritos um a um em `02-ANATOMIA-E-DADOS.md`, com o texto literal de cada um:
**vitrine · seletor · fluxo · alvo · bateria · diff**.

## O que já foi tentado, e por que não serviu

Foi gravada a tela real do produto, em 4K, com câmera animada por script (zoom com easing,
panorâmica, cursor desenhado, clique com onda, digitação caractere por caractere). O veredito de
quem pediu foi: *"você tá tipo gravando a tela"*.

**A conclusão é sobre a natureza do material, não sobre o acabamento.** Gravação de tela — mesmo com
câmera se movendo — continua sendo um retângulo de interface parada com movimento por cima. O que se
quer é o **oposto do ponto de partida**: elementos que nascem, contam, se transformam e saem. A
interface como personagem, não como cenário.

Então: **desenhe a interface, não filme ela.**

## A restrição que manda em tudo

**Não invente botão, tela, rótulo nem número.**

Quem vai assistir usa este produto. Um botão que não existe faz a pessoa procurar por ele e não
achar — e a partir daí ela não confia em mais nada do vídeo.

Isso **não** significa reproduzir pixel a pixel. Significa que:

- todo elemento desenhado tem de existir no produto, com o **texto que ele tem de verdade**;
- todo número em quadro tem de ser um dos valores de `02-ANATOMIA-E-DADOS.md`;
- pode simplificar (mostrar a cascata de linhas do seletor saindo do quadro em vez de desenhar as
  75), enquadrar, isolar, ampliar, animar;
- **não pode acrescentar** — nem um ícone, nem uma checagem a mais na bateria, nem um botão.

Simplificar é escolher o que mostrar. Inventar é mostrar o que não existe.

## A transformação de assinatura desta aba: UMA coisa em DOIS lugares

Na cena `u8`, o bloco `ALVO PROPOSTO` entra na conversa **e o nó correspondente acende no desenho ao
lado, no mesmo instante**. Não são duas informações: é a mesma, dita em dois lugares.

É esse par que explica a aba inteira — *ele não sai mexendo, ele te mostra onde vai mexer*. Se as
duas metades acontecerem em momentos diferentes, viram duas coisas soltas e a cena perde o
argumento. **Se só uma cena receber capricho de animação, que seja essa.**

## Três vermelhos na mesma tela, e a legenda é o que os separa

Cor de status é reservada neste produto, e aqui isso tem uma consequência dura: **`--risk` aparece
em três lugares com três significados**.

| onde | vermelho quer dizer |
|---|---|
| no desenho do fluxo | aquele nó **falhou nas últimas 24h** |
| na banda do dossiê | o dossiê está **velho** |
| na bateria | uma checagem **reprovou** |

A legenda embaixo do desenho (`vai ser mexido · falhou em 24h · intocado`) é o que impede a primeira
de ser lida como as outras. **Ela precisa estar em quadro.**

## Quatro selos de dossiê, e dois deles não podem ler igual

O selo do cartão diz se a conversa daquele fluxo abre — **é informação de antes do clique**, e é o
assunto da cena `u3`. Nos dados em quadro, **9 dos 11 cartões estão travados**.

| selo | a conversa abre? |
|---|---|
| `✓ dossiê em dia` | sim |
| `⚠ dossiê velho · 1 nó(s)` | sim, com ressalva |
| `⊘ dossiê velho · conversa travada` | **não** |
| `⊘ sem dossiê · conversa travada` | **não** |

Os dois últimos travam igual e **não significam a mesma coisa**: um leva a *escrever* um dossiê e o
outro a *atualizar*. São botões diferentes com preços diferentes, e desenhar os dois com a mesma
palavra apagaria isso.

## O que se espera de "animado"

O que faltou na tentativa anterior não foi movimento de câmera — foi **transformação**. Nesta aba a
maioria delas já é o que a tela faz:

- o cartão da grade que **cresce e vira** a tela do fluxo, com a miniatura do desenho escalando para
  o painel;
- o nó que **acende** no desenho no mesmo instante em que o alvo entra na conversa;
- as nove linhas da bateria acendendo **uma a uma**, com a frase de espera sendo **substituída** pela
  de resultado no lugar;
- o número `702` **contando** dentro da frase da regressão;
- a linha `-` do diff com a `+` **se escrevendo por cima e abaixo dela**, empurrando o resto;
- as linhas do seletor **caindo em cascata** em dois grupos.

O cursor, se houver, é ferramenta e não protagonista.

## Duração e ritmo

**~1:55 no total, 14 cenas.** As durações estão em `03-ROTEIRO-E-MOVIMENTO.md`.

**ATENÇÃO: a duração ali é ESTIMATIVA — a narração ainda não foi gerada.** Nenhum MP3 existe.

- **Trate os segundos como orçamento, não como marca.** A régua de caracteres por segundo errou
  **1,97s numa fala só** no vídeo do Tester.
- **Prefira animação que ESTICA bem.** Uma entrada em sequência de N elementos absorve meio segundo
  a mais sem nada quebrar; uma coreografia com três marcações rígidas, não.
- **Devolva a tabela de tempos que você usou**, como nos dois anteriores. É contra ela que a
  narração vai ser gerada.

## Tema

**Claro, do começo ao fim.** A paleta clara está em `01-SISTEMA-DE-DESIGN.md`. **Não há cena de
troca de tema** — o vídeo da aba Fluxos já ensinou o botão `◐`, e repetir a mesma cena em quatro
vídeos ensina que os vídeos se repetem. A coluna escura está no arquivo de design apenas como
referência da paleta completa.

## Resolução

**4K (3840×2160), 30fps.**

## Sobre a voz

**A narração ainda não existe.** O texto de cada cena está em `03-ROTEIRO-E-MOVIMENTO.md` e é o que
vai ser gravado — definitivo para efeito de conteúdo, aproximado para efeito de duração.

Uma amarra dura: a **u11** diz *"setecentas execuções"* por extenso enquanto **`702`** está na tela,
contando. Arredondar na voz está certo; **mudar o número na tela não**.

## O que NUNCA pode aparecer sendo clicado

- **`✓ aplicar`** — é o único clique deste produto que reescreve um fluxo rodando em produção. A
  cena `u13` mostra o botão e para ali.
- **`↻ atualizar dossiê`** — dispara uma sessão paga de minutos e substitui a prosa anterior sem
  cópia nenhuma. Ele aparece na banda da cena `u6` e não é apertado.

**O que É clicado, porque é o caminho da tela:** `todos os fluxos ▾`, um cartão da grade, o campo da
conversa, `enviar`, e `✓ é isso`.

## Uma coisa que a tela afirma e que a narração deliberadamente não repete

O bloco de confirmação do alvo diz *"não escreve nada no n8n"*. **Isso é falso na configuração
padrão do produto** — a última checagem da bateria grava uma cópia inativa `[SANDBOX upgrade]` nessa
mesma rodada, e é o próprio código que documenta isso.

Você vai ver a frase no arquivo `02`, porque ela **é** o que a tela mostra e este brief não
reescreve o produto. Mas a narração não a repete: a fala da `u9` diz *"enquanto eu não confirmo,
nada disso saiu do lugar"* — verdade sobre o fluxo de produção, que é o que importa — e a `u10`
fecha com *"o próprio n8n dizer se aceita"*, que é exatamente essa cópia sendo escrita.

**Se você precisar mostrar essa frase em quadro, mostre-a como ela está.** O que não pode é a voz
sublinhar uma promessa que o produto não cumpre.

## Os arquivos

| arquivo | o que é |
|---|---|
| `00-BRIEFING.md` | este: o pedido e as restrições |
| `01-SISTEMA-DE-DESIGN.md` | cores, tipografia e geometria, **medidos do produto rodando** |
| `02-ANATOMIA-E-DADOS.md` | os seis estados da tela, os rótulos literais e os números que aparecem |
| `03-ROTEIRO-E-MOVIMENTO.md` | as 14 cenas: fala, duração estimada, e o que deve se transformar |

`01` e `02` são **gerados** (`node .video/medir-upgrade.js && node .video/brief-upgrade-md.js`) a
partir de valores lidos do browser com a página viva. Não são descrição do produto: são medição
dele. Se algo neles parecer estranho, é porque o produto é assim.
