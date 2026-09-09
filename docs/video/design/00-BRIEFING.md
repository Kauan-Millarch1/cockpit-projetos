# Briefing — vídeo animado da aba Fluxos

Leia este arquivo primeiro. Os outros três são referência; este é o pedido.

## O que é para fazer

Um **vídeo animado curto** (~1:45) que ensina uma pessoa **não técnica** a usar a aba Fluxos do
Cockpit. Ele vai atrás de um botão *"como usar esta tela"* dentro do próprio painel, então quem
assiste **já está na tela** e quer saber onde clicar — não é peça de venda e não é tour do produto.

Vai existir um vídeo por aba (Fluxos, Disco, Tester, Upgrade). **Este é o da aba Fluxos.**

## O que já foi tentado, e por que não serviu

Foi gravada a tela real do produto, em 4K, com câmera animada por script (zoom com easing,
panorâmica, cursor desenhado, clique com onda, digitação caractere por caractere). O veredito de
quem pediu foi: *"você tá tipo gravando a tela"*.

**A conclusão é sobre a natureza do material, não sobre o acabamento.** Gravação de tela — mesmo com
câmera se movendo — continua sendo um retângulo de interface parada com movimento por cima. O que se
quer é o **oposto do ponto de partida**: elementos que nascem, contam, se transformam e saem. A
interface como personagem, não como cenário.

Então: **desenhe a interface, não filme ela.** Recrie os elementos do cockpit como objetos animáveis
e conte a história com eles.

## A restrição que manda em tudo

**Não invente botão, tela, rótulo nem número.**

Quem vai assistir usa este produto. Um botão que não existe faz a pessoa procurar por ele e não
achar — e a partir daí ela não confia em mais nada do vídeo. É a diferença entre um tutorial e uma
propaganda.

Isso **não** significa reproduzir a captura pixel a pixel. Significa que:

- todo elemento desenhado tem de existir no produto, com o **texto que ele tem de verdade**;
- todo número em quadro tem de ser um dos valores de `02-ANATOMIA-E-DADOS.md`;
- pode simplificar (mostrar 4 cartões onde há 12), enquadrar, isolar, ampliar, animar;
- **não pode acrescentar** — nem um ícone, nem uma aba, nem um "Configurações" que não existe.

Simplificar é escolher o que mostrar. Inventar é mostrar o que não existe. A primeira é edição, a
segunda é o defeito.

## O que se espera de "animado"

O que faltou não foi movimento de câmera — foi **transformação**. Coisas que valem:

- números que **contam** até o valor em vez de aparecerem prontos;
- cartões que **entram** em sequência, não todos juntos;
- uma lista que **se filtra** na frente da pessoa: as linhas que saem encolhem e desaparecem, as que
  ficam sobem para preencher o espaço;
- um cartão que **cresce** e se abre para mostrar o que tem dentro;
- o desenho do fluxo se **construindo** nó por nó, com as ligações se desenhando entre eles;
- um elemento que **se transforma em outro** entre duas cenas, em vez de corte seco;
- o tema **virando** claro→escuro numa varredura, não num pisca.

O cursor, se houver, é ferramenta e não protagonista: ele existe para dizer *onde* se clica, e a
consequência do clique é o que a cena mostra.

## Duração e ritmo

**~1:45 no total, 14 cenas.** Cada cena tem uma fala com duração **medida** — está em
`03-ROTEIRO-E-MOVIMENTO.md`, na coluna `fala`. Esses segundos são o contrato: a animação de cada
cena tem de caber neles, porque o áudio já existe e não vai ser reescrito para acomodar imagem.

Cena que precisa de mais tempo do que a fala dá é cena com movimento demais. Prefira uma
transformação clara a três pequenas.

## Tema

**Claro.** A paleta clara está em `01-SISTEMA-DE-DESIGN.md`. A cena `f13` clica o botão de tema e a
tela **muda para escuro em quadro** — é a única cena que troca, e a `f14` termina já no tema novo.
Por isso a paleta escura também está no arquivo.

## Resolução

**4K (3840×2160), 30fps.** Interface desenhada não tem o problema que a gravação tinha: não existe
layout esticando, então 4K aqui é só nitidez.

## Sobre a voz

A narração já existe, gerada e medida. O texto de cada cena está em `03-ROTEIRO-E-MOVIMENTO.md`.
**Não reescreva as falas** — os arquivos de áudio já estão feitos e a coluna de duração vem deles.

Se uma fala tiver de mudar, diga qual e por quê; ela é regerada e a duração muda com ela.

## O que NUNCA pode aparecer sendo clicado

Três botões do produto escrevem em fluxo de produção ou mandam mensagem para cliente real:

- `✓ Aprovar e aplicar`
- `✓ aplicar`
- `▷ Reexecutar a execução`

Eles podem **aparecer** em quadro — a cena `f11` fala de um deles. Nenhum pode aparecer **sendo
clicado**: um tutorial que mostra o clique ensina o clique.

## Os arquivos

| arquivo | o que é |
|---|---|
| `00-BRIEFING.md` | este: o pedido e as restrições |
| `01-SISTEMA-DE-DESIGN.md` | cores, tipografia e geometria, **medidos do produto rodando** |
| `02-ANATOMIA-E-DADOS.md` | as regiões da tela, os rótulos literais e os números que aparecem |
| `03-ROTEIRO-E-MOVIMENTO.md` | as 14 cenas: fala, duração medida, e o que deve se transformar |

`01` e `02` são **gerados** (`node .video/brief-md.js`) a partir de valores lidos do browser com a
página viva. Não são descrição do produto: são medição dele. Se algo neles parecer estranho, é
porque o produto é assim.
