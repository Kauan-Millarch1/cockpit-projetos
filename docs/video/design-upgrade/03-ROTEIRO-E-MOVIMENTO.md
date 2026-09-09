# Roteiro e movimento — 14 cenas

**A duração é MEDIDA no arquivo de áudio que já existe.** Ela é o contrato: a animação de
cada cena tem de caber nesses segundos, porque a narração já está gerada e não vai ser
reescrita para acomodar imagem.

As 14 têm áudio gerado e medido. Nenhuma duração aqui é estimativa — e a régua de
caracteres por segundo teria errado até **1,52s** numa cena só.

**Total: 109,68s (1:50).**

A coluna `movimento` está escrita em termos de **transformação**, não de câmera: o que nasce,
o que muda, o que sai. Foi a falta disso que fez a versão gravada parecer print com voz por
cima — lá havia zoom e panorâmica, e nada se transformava.

**Nesta aba a transformação mais importante é uma coisa só acontecendo em DOIS lugares.** Na
cena `u8`, o bloco do alvo entra na conversa e o nó correspondente acende no desenho ao lado,
**no mesmo instante**. É esse par que explica a aba inteira; se as duas metades acontecerem em
momentos diferentes, vira duas informações soltas.

---

## u1 — 6,32s medido

**Fala:**

> Última porta. Essa é pra quando o fluxo já funciona e você quer que ele funcione melhor.

**Onde:** `/upgrade` recém-carregada, tema claro

**Movimento:** Abre no **vazio**: fundo claro com a malha de blueprint só. A topbar desce de cima, com o endereço da instância se escrevendo do lado. O índice `[ 01 ]` e o título `Qual fluxo você quer melhorar` chegam, e os cartões entram em sequência — três colunas, da esquerda para a direita, ~80ms entre eles. **Nenhum número conta nesta cena**: esta tela não tem KPI e inventar um seria inventar a tela.

`u1.mp3` · 6,32s medido · 88 caracteres

---

## u2 — 9,36s medido

**Fala:**

> A grade mostra os que estão de pé, na ordem de quem mais roda. Cada um traz o tamanho, quantas vezes rodou hoje, e quanto custa conversar sobre ele.

**Onde:** a grade de onze cartões

**Movimento:** Os cartões ficam, e **três se destacam um por um** na ordem em que a fala os nomeia: a contagem de nós, as execuções em 24h, o peso. Destacar é o cartão subir 6px e os outros caírem para 45% de opacidade — foco por contraste, nunca por seta. Dentro do cartão em foco, só o campo citado ganha peso; o resto do cartão fica.

`u2.mp3` · 9,36s medido · 148 caracteres

---

## u3 — 8,72s medido

**Fala:**

> Repara no selo de baixo. Sem um dossiê em dia, a conversa daquele fluxo nem abre — e ele te diz isso antes do clique, não depois.

**Onde:** o selo de dossiê de cada cartão

**Movimento:** **A cena de virada da primeira metade.** O quadro fecha na fileira de selos, e eles acendem por último, um a um. Nove ficam `⊘` e dois não — e a diferença é o que a fala nomeia. Os nove travados podem escurecer levemente em bloco depois de acesos, deixando os dois restantes em pé: é a leitura *"desses onze, dois abrem"* sem precisar de número em quadro.

`u3.mp3` · 8,72s medido · 129 caracteres

---

## u4 — 9,12s medido

**Fala:**

> E os que não estão na grade? Setenta e cinco no total. Estão todos aqui, em dois grupos que dizem por que cada um está onde está.

**Onde:** clique em `todos os fluxos ▾`

**Movimento:** Clique em `todos os fluxos ▾`. A página **desfoca por trás** e o modal sobe. As linhas **caem em cascata** de cima para baixo, e o cabeçalho de cada grupo (`NA VITRINE`, `FORA DA PORTA`) entra antes das linhas dele, com a nota deslizando por baixo. Não precisa desenhar as 75: mostre a cascata continuando para fora do quadro — é o que comunica o número.

`u4.mp3` · 9,12s medido · 129 caracteres

---

## u5 — 6,88s medido

**Fala:**

> Escolho um. Ele abre o fluxo desenhado do jeito que ele existe no n8n, e a conversa do lado.

**Onde:** clique num cartão; a tela do fluxo

**Movimento:** **Transforme, não corte.** O cartão escolhido **cresce** e ocupa a tela: o nome dele vira o cabeçalho, o desenho que estava em miniatura dentro do cartão **escala** para o painel da direita, e a coluna da conversa **entra pela esquerda** no espaço que sobrou. Os nós do desenho assentam nas posições reais deles, não numa fileira.

`u5.mp3` · 6,88s medido · 92 caracteres

---

## u6 — 9,36s medido

**Fala:**

> A faixa verde diz que ele já leu esse fluxo inteiro e escreveu um resumo. É isso que faz a conversa entender um fluxo de trinta e três nós.

**Onde:** a banda do dossiê, verde

**Movimento:** A banda do dossiê **desliza por baixo do cabeçalho**, verde, e o texto dela se escreve em duas partes: primeiro `dossiê verde em dia`, depois os números (`34 parágrafos, 10KB de prosa no lugar de 52KB de JSON`), que são o assunto. O botão `↻ atualizar dossiê` aparece à direita e **não é tocado**.

`u6.mp3` · 9,36s medido · 139 caracteres

---

## u7 — 7,76s medido

**Fala:**

> Aí eu peço em português: no nó que manda a mensagem, corta o texto em quatro mil e quinhentos caracteres, e avisa quando cortar.

**Onde:** digitar o pedido no compositor

**Movimento:** O cursor entra no compositor e o pedido **aparece letra a letra** — digitação real, não um bloco de texto surgindo. Enquanto digita, o botão `enviar` sai do estado apagado. A dica `Enter envia · Shift+Enter quebra linha` fica visível embaixo.

`u7.mp3` · 7,76s medido · 128 caracteres

---

## u8 — 8,40s medido

**Fala:**

> E ele não sai mexendo. Primeiro volta dizendo qual nó vai tocar, o que muda nele, e por quê. O nó acende no desenho.

**Onde:** a resposta com o `ALVO PROPOSTO`

**Movimento:** **A cena que define a aba, e é UMA coisa acontecendo em DOIS lugares ao mesmo tempo.** Na conversa, o bloco `ALVO PROPOSTO` entra; no desenho ao lado, o nó `Enviar mensagem` **acende em `--accent`** no mesmo instante, com a borda engrossando. Uma linha fina pode ligar os dois durante a transição e sumir. Depois disso entram o detalhe por nó (`◇ Enviar mensagem`) e, por último, a justificativa em cinza.

`u8.mp3` · 8,40s medido · 116 caracteres

---

## u9 — 6,16s medido

**Fala:**

> Só com o meu ok ele monta a alteração. Enquanto eu não confirmo, nada disso saiu do lugar.

**Onde:** o bloco de confirmação

**Movimento:** O bloco de confirmação **se abre** por baixo do alvo e o botão `✓ é isso` **pulsa uma vez** e para. Nada é clicado nesta cena — ela existe para o botão ficar parado o tempo da fala. A frase de dentro do bloco é longa: revele-a por linha, não de uma vez.

`u9.mp3` · 6,16s medido · 90 caracteres

---

## u10 — 8,56s medido

**Fala:**

> Confirmado, vem a conferência: nove passos, da estrutura do arquivo até o próprio n8n dizer se aceita.

**Onde:** a bateria acende linha a linha

**Movimento:** O clique acontece e a bateria **se abre**, com as nove linhas já listadas em cinza, a 42% de opacidade. Elas acendem **uma a uma, de cima para baixo**: o glifo `○` vira `✓`, a linha ganha opacidade cheia e a frase de espera **é substituída** pela frase de resultado, no lugar. O rótulo `PASSOU` entra pela direita. O contador do cabeçalho conta junto.

`u10.mp3` · 8,56s medido · 102 caracteres

---

## u11 — 9,92s medido

**Fala:**

> Duas delas olham para trás: ele confere as setecentas execuções de hoje e prova que continuam passando pelos mesmos nós, com a mesma mensagem.

**Onde:** as duas linhas de regressão

**Movimento:** O quadro fecha nas duas linhas de regressão (`5a` e `5b`). **O número 702 conta** de zero dentro da frase de cada uma, em fonte monoespaçada. As duas linhas ficam em foco e o resto da lista cai para 45% — é o único momento do vídeo em que a bateria deixa de ser um bloco e passa a ter duas linhas que importam mais.

`u11.mp3` · 9,92s medido · 142 caracteres

---

## u12 — 5,76s medido

**Fala:**

> Só então ele mostra o que quer escrever. Uma linha muda, e as outras aparecem colapsadas do lado.

**Onde:** o diff, uma linha muda

**Movimento:** A bateria recua e o bloco `[ REVISÃO ] O que ele quer escrever` **sobe** por baixo dela. As linhas sem mudança entram já colapsadas (`⋯ 6 linha(s) sem mudança`). A linha `-` vermelha aparece primeiro e a `+` verde **se escreve por cima e abaixo dela**, empurrando o resto — é a mudança acontecendo, não duas linhas prontas.

`u12.mp3` · 5,76s medido · 97 caracteres

---

## u13 — 7,84s medido

**Fala:**

> E o botão fica do seu lado da mesa. Aplicar escreve nesse fluxo e só nele, com backup antes e desfazer depois.

**Onde:** o rodapé com `✓ aplicar`

**Movimento:** O quadro desce até o rodapé da proposta. O botão `✓ aplicar` **recebe foco e fica**; o cursor para em cima dele e sai. A frase ao lado (`Aplicar escreve este diff no fluxo de verdade, e só ele`) se escreve antes do botão acender. **Não clique** — o vídeo termina com o botão intocado, que é literalmente o que a fala diz.

`u13.mp3` · 7,84s medido · 110 caracteres

---

## u14 — 5,52s medido

**Fala:**

> É isso. Você diz o que quer, ele diz onde vai mexer, e quem aperta o botão é você.

**Onde:** volta ao plano geral

**Movimento:** A tela **se afasta** para plano geral e os quatro ícones das portas de produto (`Fluxos`, `Disco`, `Tester`, `Upgrade`) **sobem** da cápsula de navegação e se alinham no centro, com o `Upgrade` aceso. A fala fecha; eles ficam.

`u14.mp3` · 5,52s medido · 82 caracteres

---

## Cinco cenas que têm regra própria

**u13 NÃO clica, e isso não é negociável.** `✓ aplicar` é o único clique deste produto que
reescreve um fluxo rodando em produção. A cena mostra o botão, a fala diz o que ele faz, e o
vídeo acaba com ele intocado. Um tutorial que mostra o clique ensina o clique.

**u6 mostra `↻ atualizar dossiê` e também não clica.** Ele dispara uma sessão paga de minutos
e substitui a prosa anterior sem cópia nenhuma.

**u8 é a cena de assinatura.** O alvo entrando na conversa e o nó acendendo no desenho são a
mesma informação em dois lugares, e têm de acontecer juntos. Se só uma cena receber capricho
de animação, que seja essa.

**u3 é a virada da primeira metade.** Nove dos onze fluxos não abrem a conversa, e a tela diz
isso **antes** do clique. É a cena que faz a grade deixar de ser uma lista bonita e virar uma
porta com fechadura.

**u11 é a cena que ninguém espera.** Uma conferência que olha as execuções passadas e prova
que o patch não muda o caminho delas. A fala arredonda para "setecentas"; **a tela mostra
702 e esse número não muda**.

## O que a narração cita em voz e portanto precisa estar em quadro

| cena | o que a voz nomeia |
|---|---|
| u1 | é a **última** das quatro portas; o fluxo **já funciona** |
| u2 | ordem por **quem mais roda**; tamanho, execuções de hoje, **quanto custa** |
| u3 | o **selo**; sem dossiê em dia a conversa **nem abre**; **antes** do clique |
| u4 | **setenta e cinco** no total; **dois grupos** |
| u5 | o fluxo **como existe no n8n**; a conversa **do lado** |
| u6 | a faixa **verde**; ele **leu o fluxo inteiro**; **trinta e três** nós |
| u7 | o pedido em **português**; **quatro mil e quinhentos** caracteres |
| u8 | **qual nó**, **o que muda** e **por quê**; o nó **acende** |
| u9 | só com o **seu ok**; **nada saiu do lugar** |
| u10 | **nove** passos; da **estrutura** até o **n8n dizer se aceita** |
| u11 | **duas** delas olham para trás; **setecentas** execuções; **mesmos nós** |
| u12 | **uma linha** muda; as outras **colapsadas** |
| u13 | o botão do **seu lado da mesa**; **backup antes**, **desfazer depois** |
| u14 | você diz **o que quer**, ele diz **onde vai mexer**, **você** aperta o botão |
