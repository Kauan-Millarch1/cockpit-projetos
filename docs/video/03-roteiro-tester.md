# Roteiro — tutorial da aba Tester

Vídeo curto, por aba, para o botão **"como usar esta tela"** que vai dentro do cockpit. Não é o
tour de produto (`01-roteiro-tour.md`, 6:21): aquele conta a história inteira para quem nunca viu o
painel. **Este ensina a usar UMA tela**, para quem já está nela e quer saber onde clicar.

É o segundo da série. O primeiro é `02-roteiro-fluxos.md` (a aba Fluxos, 14 cenas, 1:39 medido).

## O que este roteiro faz de diferente do tour

| | tour (`01-`) | tutorial de aba (este) |
|---|---|---|
| pergunta que responde | "o que é este produto" | "como eu uso esta tela" |
| duração | 6:21 | mira **1:40–2:00** |
| tom | argumento, com o porquê de cada decisão | instrução, direto no como |
| tema | escuro | **claro, e não troca** |
| resolução | 1920×1080 | **3840×2160 (4K)** |
| imagem | gravação de tela, plano fixo | **animado**: elementos que nascem, se transformam e saem |
| público | quem decide usar | **quem já está usando, e não é técnico** |

**Menos técnico, e a régua é a mesma da aba Fluxos:** fora `assinatura`, `sub-fluxo`, `SSE`,
`portão determinístico`, `heurística`, `fixture`, `payload`, `schema`, `expressão`. Dentro `nó` (o
Kauan pediu para manter — é a palavra do n8n e quem usa o cockpit vê nó na tela), `automação`,
`fluxo`, `etapa`, `credencial`, `JSON` (aparece escrito na tela, em caixa alta, e é o que a pessoa
vai copiar).

## O que muda em relação ao roteiro da aba Fluxos

**A aba Fluxos é UMA tela; o Tester é uma máquina de seis estados.** Lá as catorze cenas moram no
mesmo painel e a câmera passeia por ele. Aqui cada cena mora num estado diferente, e o estado
anterior deixa de existir. Isso ajuda o vídeo animado em vez de atrapalhar: a transformação de uma
cena para a outra **é** o produto funcionando, não um efeito por cima dele.

**Não há cena de troca de tema.** A aba Fluxos já ensinou o botão `◐` na cena `f13`, e repetir a
mesma cena em quatro vídeos é o jeito mais rápido de ensinar que os vídeos se repetem.

**O que NUNCA entra em quadro com clique:** `✓ Aplicar e salvar` (o botão que grava o remendo num
projeto salvo), `Excluir` e `Salvar projeto` com um nome que não seja o do roteiro — os três rótulos
são literais, conferidos no fonte. O vídeo é desenhado, não
gravado, então nenhum deles chegaria a lugar nenhum — a regra vale igual, porque um tutorial que
mostra o clique ensina o clique.

**O que PODE e DEVE aparecer sendo clicado**, porque é o caminho da tela: os chips de nível, os
chips de resposta da entrevista, `Começar →`, `Enviar respostas →`, `É isso, pode fechar`,
`⧉ Copiar o JSON` e um cartão de `[ SEUS PROJETOS ]`.

---

## As cenas

`≈s` é **estimativa** (13,8 car/s, medido sobre 53 falas do tour), e ela existe para fechar a cena
antes de gastar cota. **As catorze falas já foram geradas** — os MP3 estão em
`.video/audio/falas-tester/` e a duração REAL de cada uma está em
`design-tester/03-ROTEIRO-E-MOVIMENTO.md`, medida com `ffprobe`. **O corte é contra aquela, nunca
contra esta coluna**: aqui a estimativa errou **1,97s na `t7`**.

A coluna é derivada por `node docs/video/contar-roteiro.js 03-roteiro-tester.md t`. Nenhuma célula
foi digitada à mão.

| # | tela | animação | fala | ≈s |
|---|---|---|---|---|
| t1 | `/tester` recém-carregada, tema claro | a tela se monta no vazio: o campo grande cresce do centro, o título se escreve por cima | "Bem-vindo ao Tester. As outras abas mostram o que as suas automações já fazem. Esta aqui constrói uma nova." | 7,8 |
| t2 | a caixa da ideia e os chips de nível | os três chips de nível entram um a um; `sei o básico` se acende | "Você escreve do seu jeito, em português. E repara no que ele pergunta antes de tudo: o seu nível. Porque quem precisa saber o n8n é ele." | 9,9 |
| t3 | os quatro exemplos, e a ideia sendo digitada | os exemplos entram por baixo; o texto aparece no campo letra a letra | "Se travar, tem exemplos prontos ali embaixo. Eu vou escrever o meu: avisar no Slack quando cair pedido novo." | 7,8 |
| t4 | clique em `Começar →`, a entrevista abre | a caixa da ideia encolhe e vira a linha `VOCÊ` no topo; as perguntas descem no lugar dela | "E aqui está a diferença. Ele não sai construindo: ele pergunta o que falta." | 5,4 |
| t5 | as três perguntas, com o motivo por baixo | cada pergunta entra com o motivo dela chegando depois, em cinza | "Em que canal a mensagem chega, o que ela mostra, e o que fazer se o pedido cancelar. Embaixo de cada uma, o motivo dela existir." | 9,3 |
| t6 | a pergunta do conteúdo, com as três bolhas `MODELO` | as três opções se transformam de chip em bolha de Slack, uma a uma | "Nessa aqui a opção não é um rótulo: é a mensagem que vai sair, desenhada do jeito que vai chegar. Você escolhe olhando o resultado." | 9,5 |
| t7 | clique em `Enviar respostas →`, a esteira corre | as perguntas saem; a esteira de sete etapas entra e as etiquetas trocam em sequência | "Respondido, ele corre sozinho por sete etapas. Repara na dois: ele pulou, e escreveu o porquê do lado." | 7,4 |
| t8 | o desenho se construindo, nó por nó | cada nó nasce com a borda tracejada e assenta; a ligação se desenha até o próximo | "E vai desenhando, nó por nó, enquanto escreve o arquivo. O que você está vendo é o fluxo sendo montado." | 7,5 |
| t9 | `[ 06 ] O QUE ISTO PRODUZIRIA`, a bolha do Slack | o desenho recua para o alto e a bolha se monta embaixo, linha a linha | "Antes de entregar, ele mostra o que isso produziria: a mensagem exata, no formato do Slack. Não é promessa — é o fluxo montando ela na sua frente." | 10,6 |
| t10 | o cartão de achado `RISCO`, na coluna da direita | o cartão desliza da direita e uma linha fina liga ele ao canal na bolha | "E ele marca o que não tem certeza. Aqui: o canal foi encontrado pelo nome, então confere se é o certo na sua conta." | 8,3 |
| t11 | a seção `[ GASTO ]` | o valor conta de zero até setenta e nove centavos; a frase de apoio chega depois | "Do lado, quanto essa construção custou. Setenta e nove centavos de dólar, e sai do seu plano — sem cobrança por fora." | 8,5 |
| t12 | o rodapé, trocando de frase | a frase antiga se apaga da esquerda para a direita enquanto a nova se escreve por cima | "E olha o rodapé. A única coisa criada no n8n foi uma cópia desligada e sem credencial, só pra provar que a sua conta aceita o desenho. O seu fluxo original, intocado." | 12,0 |
| t13 | `[ 07 ] PRONTO PARA IMPORTAR`, o JSON | o bloco de JSON sobe por baixo do fantasma; os botões entram por último | "Aí ele te entrega o arquivo pronto pra importar no n8n. Você dá um nome, guarda, e copia." | 6,4 |
| t14 | volta ao início, os três projetos guardados | a tela se afasta e os cartões de projeto entram em sequência | "E o que você construiu fica guardado, com a conversa que gerou aquele fluxo. É isso: você descreve, ele pergunta, e sai um fluxo pronto." | 9,9 |

**Soma estimada: 120,2s (2:00).**

---

## Notas de gravação

**Tema claro do começo ao fim.** `?theme=light` força. O tour é escuro e este vídeo vive dentro da
tela clara, atrás de um botão que fica nela.

**A esteira só para em dois lugares, e as duas paradas estão no vídeo.** A etapa `01` para porque
está entrevistando (`ESPERA VOCÊ`), e a `06` para porque é o portão do fantasma. A `06` já nasce
marcada `para aqui` enquanto ainda está pendente — isso é informação, não é "parou agora", e o tom
tem de separar os dois. As outras cinco correm sem perguntar nada.

**A cena t12 é a mais importante do vídeo, e é a que corre mais risco de sair errada.** O rodapé
**muda** entre a etapa 04 e a 05: até lá ele diz `nada foi criado no n8n · nenhuma chamada feita`, e
depois passa a nomear a cópia. Uma animação que mostrasse a primeira frase enquanto a voz fala da
segunda estaria afirmando o contrário do produto — e no sentido pior, dizendo que nada foi criado
quando algo foi. Foi exatamente esse o defeito encontrado na cena `9.9` do tour, e ele custou uma
fala reescrita.

**`MODELO` e `SIMULAÇÃO` são dois selos e nunca podem virar um.** A cena t6 mostra `MODELO` — texto
que o modelo escreveu para você comparar, antes de o fluxo existir. A cena t9 mostra `SIMULAÇÃO` — o
fluxo resolvendo as próprias contas, depois de existir. Um selo só para os dois apagaria a única
coisa que faz o fantasma valer alguma coisa.

**A fala da t11 diz "setenta e nove centavos" por extenso e o número aparece na tela.** Os dois
precisam bater. Se o valor do fixture mudar, a fala muda junto — e como ela é falada por extenso,
não dá para corrigir só a tela.

**A t3 mostra a ideia sendo digitada, e a t4 mostra o Tester repetindo a ideia INTEIRA.** Não é
inconsistência: a pessoa digita `avisar no Slack quando cair pedido novo`, e a linha `VOCÊ` que
aparece na entrevista traz a frase completa que o fixture guarda. Se a animação usar a frase curta
nos dois lugares, a cena fica coerente e falsa; se usar a longa nas duas, a digitação vira um
parágrafo. Use a curta na t3 e a longa da t4 em diante — é o que a tela faz.

**Nada é inventado.** O que aparece é o cockpit real rodando contra os dados falsos de
`.video/fixtures.js`. Toda cor, todo tamanho e todo rótulo do brief foi lido da página viva por
`node .video/medir-tester.js`; nenhum foi digitado de memória.

**A t2 teve a última frase REESCRITA, e não foi por gosto.** Ela terminava em
*"Porque não é você que precisa saber n8n."* — e o `eleven_v3` leu esse `n8n` final como **"não"**,
transformando a frase em *"não é você que precisa saber, não"*. Medido gerando a frase em cinco
grafias e transcrevendo de volta: com o `n8n` na ÚLTIMA posição **nenhuma** grafia funciona
(`n8n` → "né?", `ene oito ene` → "Ini oito ini", `enê oito enê` → "é Ne8, né?"). A frase agora é
*"Porque quem precisa saber o n8n é ele."*, com o termo fora da última posição — e aí sai certo.
Perdeu-se o *"não é você"* explícito; o contraste continua em *"é ele"*. Restaurar a frase inteira
(*"…é ele, não você."*) custa **+2,5s** medidos e é decisão do Kauan.

**`n8n` é trocado por `ene oito ene` antes de ir para o ElevenLabs**, no `voz.js`, e a medição que
obrigou a isso está no comentário de lá. O roteiro escreve a palavra certa; a troca acontece na
geração — se a grafia fonética estivesse aqui, quem revisa leria "ene oito ene" e revisaria fonética
em vez de conteúdo.

---

## O que falta para este roteiro virar vídeo

1. ~~Gerar as catorze falas.~~ **Feito em 27/08.** Os MP3 estão em `.video/audio/falas-tester/`,
   gerados com `eleven_v3`, `language_code: pt`, voz `kPzsL2i3teMYv0FxEYQ6` — a mesma do vídeo da
   aba Fluxos, porque os dois são da mesma série.
2. **Mandar a tabela de durações REAIS para o Claude Design**, para ele reencaixar. Ele já disse que
   a coreografia estica. As duas que mais se moveram: `t7` **+1,97s** e `t2` **+0,96s** (esta por
   causa da reescrita acima).
3. **Decidir a voz.** Continua aberto: um Voice ID nativo de pt-BR conserta o sotaque, e trocar
   depois muda as catorze durações e obriga a retimar o vídeo inteiro. Vale decidir **antes** de o
   Claude Design retimar.
