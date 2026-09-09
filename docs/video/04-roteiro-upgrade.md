# Roteiro — tutorial da aba Upgrade

Vídeo curto, por aba, para o botão **"como usar esta tela"** que vai dentro do cockpit. Não é o
tour de produto (`01-roteiro-tour.md`, 6:21): aquele conta a história inteira para quem nunca viu o
painel. **Este ensina a usar UMA tela**, para quem já está nela e quer saber onde clicar.

É o terceiro da série. Os anteriores: `02-roteiro-fluxos.md` (1:39 medido) e `03-roteiro-tester.md`
(2:00 medido).

## O que este roteiro faz de diferente do tour

| | tour (`01-`) | tutorial de aba (este) |
|---|---|---|
| pergunta que responde | "o que é este produto" | "como eu uso esta tela" |
| duração | 6:21 | mira **1:45–2:05** |
| tom | argumento, com o porquê de cada decisão | instrução, direto no como |
| tema | escuro | **claro, e não troca** |
| resolução | 1920×1080 | **3840×2160 (4K)** |
| imagem | gravação de tela, plano fixo | **animado**: elementos que nascem, se transformam e saem |
| público | quem decide usar | **quem já está usando, e não é técnico** |

**Menos técnico, e a régua é a mesma das outras abas:** fora `assinatura`, `SSE`, `portão
determinístico`, `heurística`, `fixture`, `payload`, `schema`, `expressão`, `regressão`, `diff`.
Dentro `nó`, `fluxo`, `sub-fluxo` (aqui ele **entra**, e é a única mudança de régua — a aba inteira
fala de fluxo que chama fluxo, e chamar isso de "outra automação" seria mais confuso que a palavra),
`dossiê`, `credencial`, `backup`.

## Esta é a aba mais séria das quatro, e o roteiro tem de refletir isso

As outras três **olham** ou **constroem**. Esta **reescreve um fluxo que está rodando em produção**.
Quase toda frase da tela existe para dizer o que ainda NÃO foi escrito, e o vídeo tem de carregar
isso — não como aviso legal no fim, mas como o assunto.

**Três coisas ordenam as cenas, nesta ordem:** primeiro *como escolher onde mexer*, depois *como ele
te devolve o alvo antes de mexer*, e só então *como você decide*. Se o vídeo inverter isso, ele vira
uma demonstração de um botão que escreve em produção.

---

## As cenas

`≈s` é **estimativa** (13,8 car/s, medido sobre 53 falas do tour), e ela existe para fechar a cena
antes de gastar cota. **As catorze falas já foram geradas** — os MP3 estão em
`.video/audio/falas-upgrade/` e a duração REAL de cada uma está em
`design-upgrade/03-ROTEIRO-E-MOVIMENTO.md`, medida com `ffprobe`. **O corte é contra aquela, nunca
contra esta coluna**: aqui a estimativa errou **1,52s na `u7`**, e o total ficou **5,69s mais curto**
que o orçamento.

A coluna é derivada por `node docs/video/contar-roteiro.js 04-roteiro-upgrade.md u`. Nenhuma célula
foi digitada à mão.

| # | tela | animação | fala | ≈s |
|---|---|---|---|---|
| u1 | `/upgrade` recém-carregada, tema claro | a topbar desce, o título se escreve, os cartões entram em sequência | "Última porta. Essa é pra quando o fluxo já funciona e você quer que ele funcione melhor." | 6,4 |
| u2 | a grade de onze cartões | três cartões se destacam um a um enquanto a fala os nomeia | "A grade mostra os que estão de pé, na ordem de quem mais roda. Cada um traz o tamanho, quantas vezes rodou hoje, e quanto custa conversar sobre ele." | 10,7 |
| u3 | o selo de dossiê de cada cartão | os selos acendem por último; nove ficam com o cadeado, dois não | "Repara no selo de baixo. Sem um dossiê em dia, a conversa daquele fluxo nem abre — e ele te diz isso antes do clique, não depois." | 9,3 |
| u4 | clique em `todos os fluxos ▾` | o modal sobe, as linhas caem em dois grupos | "E os que não estão na grade? Setenta e cinco no total. Estão todos aqui, em dois grupos que dizem por que cada um está onde está." | 9,3 |
| u5 | clique num cartão; a tela do fluxo | o cartão cresce e vira a tela inteira: conversa de um lado, desenho do outro | "Escolho um. Ele abre o fluxo desenhado do jeito que ele existe no n8n, e a conversa do lado." | 6,7 |
| u6 | a banda do dossiê, verde | a banda desliza por baixo do cabeçalho e o número se escreve | "A faixa verde diz que ele já leu esse fluxo inteiro e escreveu um resumo. É isso que faz a conversa entender um fluxo de trinta e três nós." | 10,1 |
| u7 | digitar o pedido no compositor | o texto aparece letra a letra; o botão enviar acende | "Aí eu peço em português: no nó que manda a mensagem, corta o texto em quatro mil e quinhentos caracteres, e avisa quando cortar." | 9,3 |
| u8 | a resposta com o `ALVO PROPOSTO` | o bloco entra e, no desenho ao lado, um nó se acende em azul | "E ele não sai mexendo. Primeiro volta dizendo qual nó vai tocar, o que muda nele, e por quê. O nó acende no desenho." | 8,4 |
| u9 | o bloco de confirmação | o botão pulsa uma vez; a fala não clica ainda | "Só com o meu ok ele monta a alteração. Enquanto eu não confirmo, nada disso saiu do lugar." | 6,5 |
| u10 | a bateria acende linha a linha | as nove linhas acendem em sequência, de cinza para verde | "Confirmado, vem a conferência: nove passos, da estrutura do arquivo até o próprio n8n dizer se aceita." | 7,4 |
| u11 | as duas linhas de regressão | as duas linhas ganham o número setecentos e dois contando | "Duas delas olham para trás: ele confere as setecentas execuções de hoje e prova que continuam passando pelos mesmos nós, com a mesma mensagem." | 10,3 |
| u12 | o diff, uma linha muda | o bloco sobe e a linha vermelha vira verde em cima da anterior | "Só então ele mostra o que quer escrever. Uma linha muda, e as outras aparecem colapsadas do lado." | 7,0 |
| u13 | o rodapé com `✓ aplicar` | o botão recebe foco e fica; nada é clicado | "E o botão fica do seu lado da mesa. Aplicar escreve nesse fluxo e só nele, com backup antes e desfazer depois." | 8,0 |
| u14 | volta ao plano geral | a tela se afasta e as quatro portas se alinham no centro | "É isso. Você diz o que quer, ele diz onde vai mexer, e quem aperta o botão é você." | 5,9 |

**Soma estimada: 115,4s (1:55).**

---

## Notas de gravação

**Tema claro do começo ao fim.** `?theme=light` força.

**O que NUNCA entra em quadro com clique:**

- **`✓ aplicar`** — é o único clique deste codebase que reescreve um fluxo de produção. A cena `u13`
  mostra o botão e para ali, que é literalmente o que a fala diz.
- **`↻ atualizar dossiê`** — dispara uma sessão paga de minutos e substitui a prosa anterior sem
  cópia nenhuma. Ele aparece na banda da cena `u6` e não é apertado.
- **`▷ Reexecutar`** — não existe nesta aba, mas se aparecer em alguma variação da tela, mesma regra.

**`✓ é isso` É clicado, na cena u10 — e isso precisa de uma frase, porque a tela mente sobre ele.**
Ver a seção abaixo. A narração da `u9` foi escrita para **não** repetir o que a tela afirma.

**A cena u8 é a que define a aba.** O produto inteiro se resume a: ele devolve o alvo antes de
mexer. Se só uma cena receber capricho de animação, que seja o nó acendendo no desenho ao mesmo
tempo em que o bloco `ALVO PROPOSTO` entra na conversa — é uma coisa só acontecendo em dois lugares,
e é isso que precisa ser visto.

**A cena u11 existe porque é o que ninguém espera.** Uma conferência que olha as execuções passadas
e prova que o patch não muda o caminho delas é o que separa esta aba de um editor de texto com
autocompletar. A fala diz "setecentas" e a tela mostra **702** — arredondar na voz está certo,
mudar o número na tela não.

**Três vermelhos diferentes na mesma tela, e a legenda é o que os separa.** No desenho, vermelho é
*nó que falhou nas últimas 24h*; na banda do dossiê, é *dossiê velho*; na bateria, seria *checagem
reprovada*. A legenda embaixo do desenho (`vai ser mexido · falhou em 24h · intocado`) precisa estar
em quadro na `u5` ou na `u8`.

**Os rótulos dos nós são truncados pela própria tela** (`Transcrever áu…`, `redis_gravar_b…`).
Desenhar o nome inteiro mostraria um cockpit que não existe.

**Nada é inventado.** O que aparece é o cockpit real rodando contra os dados falsos de
`.video/fixtures.js`. Toda cor, todo tamanho e todo rótulo do brief foi lido da página viva por
`node .video/medir-upgrade.js`; nenhum foi digitado de memória.

---

## O defeito de produto que este roteiro encontrou, e como ele foi contornado

**A tela afirma o contrário do código, na frase que autoriza um clique.**

O bloco de confirmação do alvo diz, literal:

> Confirma o alvo? Confirmar manda ele **montar o patch** e mostrar o diff aqui — custa uma rodada,
> e **não escreve nada no n8n**.

E o `title` do botão repete: *"monta o patch e mostra o diff — uma rodada de modelo, nenhuma escrita
no n8n"*.

**Isso é falso na configuração padrão.** `checagem7`, a última linha da bateria, grava a cópia
inativa `[SANDBOX upgrade]` com `putWorkflow`/`createWorkflow` — e ela roda **nessa mesma rodada**,
disparada por esse mesmo clique. O próprio `upgrade.js` documenta: *"É a única escrita que acontece
ANTES de ele aprovar qualquer coisa"*. `SANDBOX_LIGADO` é `process.env.COCKPIT_UPGRADE_SANDBOX !==
"0"` — ou seja, **ligado por padrão**. A frase só é verdadeira com a variável em `0`.

É a mesma família que este repositório já pagou duas vezes (`REGRAS_MOLDE` prometendo que nada do
que a sessão escreve vai para o n8n; o `escreveNoM8n: false` num contrato morto), agora no pior
lugar possível: **na sentença que a pessoa lê imediatamente antes de apertar o botão.**

**O que o roteiro faz enquanto isso não é corrigido:** a fala da `u9` não repete a promessa. Ela diz
*"enquanto eu não confirmo, nada disso saiu do lugar"* — que é verdade sobre o **fluxo de
produção**, e é o que importa para quem assiste — e a `u10` fecha nomeando o que de fato acontece:
*"o próprio n8n dizer se aceita"*, que é exatamente a cópia inativa sendo escrita.

**Não é o vídeo que tem de resolver isso.** A correção é na tela: ou a frase passa a dizer que uma
cópia inativa e sem credencial é criada, ou ela passa a ser condicional em `SANDBOX_LIGADO` — que é
o que `capacidades()` já expõe como `escreve.copiaInativa`. Decisão do Kauan.

---

## As três marcas duras, medidas no áudio que existe

O Claude Design marcou pontos em que a voz tem de casar com a animação. Medidos com carimbo por
palavra (`node .video/conferir-marcas.js upgrade`):

| marca | pedido | medido | veredito |
|---|---|---|---|
| `u11` · "setecentas" | depois de 4,0s (o `702` para de contar) | **3,40s** | **0,60s cedo** |
| `u8` · "tocar" | por volta de 0,85s (o nó acende) | **4,02s** | 3,17s depois |
| `u8` · "acende" | sobre o detalhe por nó, a 3,6s | **7,12s** | 3,52s depois |
| `u3` · "abre" | perto de 5,6s (os selos escurecem) | **4,90s** | 0,70s cedo, dentro |
| `u6` · "resumo" | perto de 3,4s (os números se escrevem) | **4,76s** | 1,36s depois |

**A `u11` é a única que rompe uma restrição declarada**, e por 0,6s. O áudio inteiro veio 0,37s mais
curto que o orçamento, então tudo dentro dele cai mais cedo — mover o fim da contagem do `702` para
~3,2s resolve sem tocar na fala.

**As duas da `u8` não são deriva, são a frase.** A fala começa em *"E ele não sai mexendo."* antes de
chegar em *"qual nó vai tocar"*, então não existe leitura em que essa palavra caia aos 0,85s. Se o
nó precisa acender junto com a **palavra**, a marca é ~4,0s; se precisa acender junto com o **bloco
do alvo entrando**, a marca de 0,85s está certa e a voz confirma depois — que é como a cena foi
escrita. Decisão do Claude Design.

---

## O que falta para este roteiro virar vídeo

1. ~~Gerar as catorze falas.~~ **Feito em 27/08.** Os MP3 estão em `.video/audio/falas-upgrade/`,
   gerados com `eleven_v3`, `language_code: pt`, voz `kPzsL2i3teMYv0FxEYQ6` — a mesma dos vídeos das
   abas Fluxos e Tester, porque os três são da mesma série.
2. **Mandar a tabela de durações REAIS para o Claude Design**, para ele reencaixar. O total ficou
   **1:50** contra os **1:55** planejados, e a cena que mais encurtou foi a `u7` (−1,52s).
3. **Decidir a voz.** Continua aberto: um Voice ID nativo de pt-BR conserta o sotaque, e trocar
   depois muda as durações dos **três** vídeos e obriga a retimar todos.
