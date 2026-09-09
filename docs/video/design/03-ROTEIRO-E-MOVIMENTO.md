# Roteiro e movimento — 14 cenas

**A duração é MEDIDA no arquivo de áudio que já existe.** Ela é o contrato: a animação de
cada cena tem de caber nesses segundos, porque a narração já está gerada e não vai ser
reescrita para acomodar imagem.

As catorze têm áudio gerado e medido. Nenhuma duração aqui é estimativa.

**Por que não usar a estimativa:** a régua de caracteres por segundo erra por fala — nestas
catorze o erro chegou a **1,61s** numa cena só. Uma animação desenhada contra a estimativa e
cortada contra o áudio perde esse tempo de movimento sem ninguém saber por quê.

**Total: 99,44s (1:39).**

A coluna `movimento` está escrita em termos de **transformação**, não de câmera: o que nasce,
o que muda, o que sai. Foi a falta disso que fez a versão gravada parecer print com voz por
cima — lá havia zoom e panorâmica, e nada se transformava.

---

## f1 — 8,08s

**Fala:**

> Olá! Bem-vindo à aba Fluxos. É aqui que você vê tudo o que as suas automações fizeram, sem precisar abrir o n8n.

**Onde:** `/` recém-carregada, tema claro

**Movimento:** Abre no **vazio**: fundo claro com a malha de blueprint só. A topbar desce de cima. Os seis cartões de KPI entram em sequência da esquerda para a direita, cada um subindo 20px e ganhando opacidade, ~90ms entre eles. **Os numerais contam** de zero até o valor durante a entrada. Nada de câmera: a tela se monta.

`f1.mp3` · 8,08s medido · 112 caracteres

---

## f2 — 7,60s

**Fala:**

> Começa por aqui. Quantas execuções rodaram hoje, quantas falharam, e quantas automações estão de pé agora.

**Onde:** tira de números do topo

**Movimento:** Os seis cartões continuam, e três deles **destacam-se um por um** enquanto a fala os nomeia: `EXECUÇÕES 24H`, `FALHAS 24H`, `FLUXOS ATIVOS`. Destacar é o cartão subir 6px e os outros cinco caírem para 45% de opacidade — o foco é por contraste, não por seta. Sincronize com a ordem da fala.

`f2.mp3` · 7,60s medido · 106 caracteres

---

## f3 — 5,12s

**Fala:**

> Do lado esquerdo estão os seus projetos. Clica num deles e a tela mostra só aquele.

**Onde:** coluna da esquerda

**Movimento:** A coluna dos projetos **desliza da esquerda**, item por item de cima para baixo. Quando a fala diz "clica num deles", o item `LOJA` recebe a borda de accent e o fundo `--accent-soft`; ao mesmo tempo os cartões da grade que não são daquele projeto **encolhem e saem**, e os que ficam se reorganizam para preencher. A consequência do clique é a cena.

`f3.mp3` · 5,12s medido · 83 caracteres

---

## f4 — 7,44s

**Fala:**

> Cada cartão é uma automação. E ele não te dá só um número: ele te diz numa frase o que está acontecendo com ela.

**Onde:** um cartão de automação

**Movimento:** Um cartão de fluxo **cresce** do centro até ocupar boa parte do quadro e se abre: nome, pill de status, faíscas de execução e a **frase de diagnóstico** aparecendo por último, palavra a palavra ou por linha. A frase é o assunto da fala, então ela é a última coisa a chegar e a que fica.

`f4.mp3` · 7,44s medido · 112 caracteres

---

## f5 — 6,00s

**Fala:**

> Aqui do lado, ao vivo, é tudo o que rodou nas últimas vinte e quatro horas — a mais recente em cima.

**Onde:** seção `Ao vivo`

**Movimento:** O cartão ampliado **se dobra** de volta e, do lado direito, o painel `[ 02 / 05 ] Ao vivo` **se abre** com as linhas caindo de cima para baixo, ~50ms entre elas, a mais recente primeiro. Cada linha tem hora, nome do fluxo, ponto de status e duração.

`f5.mp3` · 6,00s medido · 100 caracteres

---

## f6 — 8,88s

**Fala:**

> Dois botões filtram essa lista: só o que deu certo, ou só o que deu erro. É por esse que você vai começar numa segunda-feira.

**Onde:** os dois filtros

**Movimento:** Os três chips de filtro **pulsam** uma vez. O `DEU ERRO 11` recebe estado ativo, e então **a lista se filtra na frente da pessoa**: as linhas verdes encolhem em altura até desaparecer e as vermelhas sobem para fechar o espaço. É a transformação mais importante do vídeo — é ela que mostra o produto sendo usado.

`f6.mp3` · 8,88s medido · 125 caracteres

---

## f7 — 7,04s

**Fala:**

> Clica numa linha e a automação aparece desenhada, nó por nó, do jeito que ela existe no n8n.

**Onde:** clique numa execução

**Movimento:** Uma linha da lista **acende** e, do painel da esquerda, o desenho do fluxo **se constrói**: os nós entram um a um na ordem de execução, e cada ligação se **desenha** do nó anterior até o seguinte. Nó é quadrado de 84×84 com ícone dentro e rótulo fora, por baixo.

`f7.mp3` · 7,04s medido · 92 caracteres

---

## f8 — 7,28s

**Fala:**

> E logo abaixo, em português: quem falou com você, o que essa pessoa mandou, e o que a automação respondeu.

**Onde:** bloco `O que aconteceu`

**Movimento:** O desenho recua para o alto e o bloco `O que aconteceu` **se escreve** embaixo dele, linha por linha: `CONTATO`, `RECEBEU`, `MUDOU`, `FIM`. O texto de cada linha entra como se estivesse sendo digitado, ou por revelação da esquerda para a direita.

`f8.mp3` · 7,28s medido · 106 caracteres

---

## f9 — 9,44s

**Fala:**

> Quando algo falha, o cockpit junta as falhas iguais num cartão só. Se o mesmo nó quebrou dez vezes, é um problema, não dez.

**Onde:** `Erros agrupados`

**Movimento:** Dez linhas vermelhas idênticas **convergem** para o centro e **colapsam** num cartão só, com o contador `10×` aparecendo no canto dele. A fala diz "é um problema, não dez" — a animação é literalmente essa frase.

`f9.mp3` · 9,44s medido · 123 caracteres

---

## f10 — 8,24s

**Fala:**

> E se o nó que quebrou não estiver na automação que você abriu, ele te diz em qual está. Isso já custou tarde de gente boa.

**Onde:** o chip `⤷` do cartão

**Movimento:** O cartão agrupado se abre e o chip `⤷ Agente Iago Comercial` **desliza para fora** dele, e uma linha fina liga o chip ao nome do sub-fluxo. O nó `Convert text to speech` aparece **fora** do fluxo aberto, do outro lado da linha: a fala diz que ele não está ali, e o desenho mostra onde está.

`f10.mp3` · 8,24s medido · 122 caracteres

---

## f11 — 7,52s

**Fala:**

> Esse botão manda a falha para o Claude corrigir, aqui na sua máquina. Ele te mostra o que quer mudar, e você decide se aplica.

**Onde:** `⧉ Mandar pro Claude`

**Movimento:** O botão `⧉ Mandar pro Claude` **destaca-se** no cartão. Dele sai uma linha até um bloco que se monta com a etiqueta `[ HANDOFF ]` e uma lista de etapas acendendo em sequência. **Não clique** — o botão fica em foco e a explicação acontece ao lado. Ao fim, a frase "nada disto está no n8n ainda" aparece e permanece.

`f11.mp3` · 7,52s medido · 126 caracteres

---

## f12 — 6,40s

**Fala:**

> Quando você resolver, marca aqui e anota o que fez. Se a falha voltar, o cartão reaparece sozinho.

**Onde:** `✓ Correção feita`

**Movimento:** O botão `✓ Correção feita` recebe foco e, dele, um campo de nota **se abre** com o texto aparecendo como se digitado. Depois o cartão inteiro **desliza** para a seção `[ 04 / 05 ]` e desaparece dela — é a prova visual de que ele sai do quadro e volta se a falha voltar.

`f12.mp3` · 6,40s medido · 98 caracteres

---

## f13 — 4,96s

**Fala:**

> Ah — e esse botão troca entre tema claro e escuro, se você preferir o outro.

**Onde:** topbar, botão `◐`

**Movimento:** O botão `◐` da topbar recebe foco e o tema **vira em varredura**: uma frente clara→escura atravessa a tela da direita para a esquerda, cada elemento trocando de paleta quando a frente passa por ele. Não é um pisca e não é um fade do quadro inteiro.

`f13.mp3` · 4,96s medido · 76 caracteres

---

## f14 — 5,44s

**Fala:**

> É isso. Uma tela para saber o que está vivo, o que quebrou, e o que fazer sobre isso.

**Onde:** volta ao plano geral

**Movimento:** A tela **se afasta** para plano geral, já no tema escuro, e os quatro ícones das portas de produto (`Fluxos`, `Disco`, `Tester`, `Upgrade`) **sobem** da cápsula de navegação e se alinham no centro, um ao lado do outro. A fala fecha; eles ficam.

`f14.mp3` · 5,44s medido · 85 caracteres

---

## Três cenas que têm regra própria

**f11 não clica.** O botão `⧉ Mandar pro Claude` dispara uma correção. A fala explica o que
ele faz e a explicação acontece ao lado dele; o botão fica em foco e não é apertado. Um
tutorial que mostra o clique ensina o clique.

**f13 é a única que muda o estado da tela.** Ela troca o tema, e a `f14` termina no tema novo.
Se a ordem das cenas mudar, a `f13` precisa continuar antes da `f14` — senão o vídeo acaba num
tema que ninguém escolheu.

**f9 é a cena mais importante para acertar.** A fala diz "é um problema, não dez", e a
animação é literalmente essa frase: dez linhas convergindo e colapsando numa. Se ela sair
como um corte de dez cartões para um cartão, a frase perde o referente.

## O que a narração cita em voz e portanto precisa estar em quadro

| cena | o que a voz nomeia |
|---|---|
| f1 | a aba se chama **Fluxos**; o produto se chama **Cockpit**; existe o **n8n** por trás |
| f2 | quantas execuções, quantas falharam, quantas automações de pé |
| f3 | os **projetos** na coluna da esquerda |
| f4 | a **frase** do cartão, não um número |
| f5 | **vinte e quatro horas**, a mais recente em cima |
| f6 | **dois** botões de filtro; "só o que deu erro" |
| f7 | **nó por nó**, "do jeito que ela existe no n8n" |
| f8 | quem falou, o que mandou, o que a automação respondeu |
| f9 | **dez vezes**, "um problema, não dez" |
| f10 | o nó **não está** na automação aberta; ele diz em qual está |
| f11 | o **Claude** corrige **na sua máquina**; **você** decide se aplica |
| f12 | marcar e anotar; o cartão **reaparece sozinho** |
| f13 | o botão troca entre **claro e escuro** |
| f14 | "o que está vivo, o que quebrou, e o que fazer sobre isso" |
