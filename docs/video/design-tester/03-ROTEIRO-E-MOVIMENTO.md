# Roteiro e movimento — 14 cenas

**A duração é MEDIDA no arquivo de áudio que já existe.** Ela é o contrato: a animação de
cada cena tem de caber nesses segundos, porque a narração já está gerada e não vai ser
reescrita para acomodar imagem.

As 14 têm áudio gerado e medido. Nenhuma duração aqui é estimativa — e a régua de
caracteres por segundo teria errado até **1,97s** numa cena só.

**Total: 120,00s (2:00).**

A coluna `movimento` está escrita em termos de **transformação**, não de câmera: o que nasce,
o que muda, o que sai. Foi a falta disso que fez a versão gravada parecer print com voz por
cima — lá havia zoom e panorâmica, e nada se transformava.

**Nesta aba a maioria das transformações É O QUE A TELA FAZ.** O Tester atravessa seis
estados e cada um apaga o anterior de verdade: a caixa da ideia realmente vira a linha da
conversa, as perguntas realmente saem para o desenho entrar, o rodapé realmente troca de
frase. Onde a direção diz "transforme, não corte", ela está pedindo que você mostre o
produto, não que você acrescente um efeito.

---

## t1 — 7,52s medido

**Fala:**

> Bem-vindo ao Tester. As outras abas mostram o que as suas automações já fazem. Esta aqui constrói uma nova.

**Onde:** `/tester` recém-carregada, tema claro

**Movimento:** Abre no **vazio**: fundo claro com a malha de blueprint só. A topbar desce de cima. A caixa da ideia (700×146) **cresce do centro**, e só depois de assentada o título `O que vamos construir?` **se escreve** por cima dela, e a linha de dica embaixo. Nada de câmera: a tela se monta. Ao contrário do vídeo da aba Fluxos, aqui não há número nenhum contando — esta tela não tem KPI, e inventar um seria inventar a tela.

`t1.mp3` · 7,52s medido · 107 caracteres

---

## t2 — 11,12s medido

**Fala:**

> Você escreve do seu jeito, em português. E repara no que ele pergunta antes de tudo: o seu nível. Porque quem precisa saber o n8n é ele.

**Onde:** a caixa da ideia e os chips de nível

**Movimento:** A caixa fica. Dentro dela, a linha de baixo se preenche da esquerda para a direita: o rótulo `SEU NÍVEL` e então os três chips (`nunca mexi`, `sei o básico`, `sou técnico`) entrando um a um, ~90ms entre eles. O do meio **se acende** por último e fica — é o nível que o resto do vídeo usa. Os outros dois caem para ~45% de opacidade: o foco é por contraste, nunca por seta.

`t2.mp3` · 11,12s medido · 136 caracteres

---

## t3 — 7,52s medido

**Fala:**

> Se travar, tem exemplos prontos ali embaixo. Eu vou escrever o meu: avisar no Slack quando cair pedido novo.

**Onde:** os quatro exemplos, e a ideia sendo digitada

**Movimento:** Os quatro chips de exemplo **entram por baixo** da caixa, de cima para baixo, com a borda tracejada que eles têm de verdade. Então o cursor volta para o campo e o texto `avisar no Slack quando cair pedido novo` **aparece letra a letra** — digitação real, não um bloco de texto surgindo. Enquanto digita, o `Começar →` sai do estado apagado.

`t3.mp3` · 7,52s medido · 108 caracteres

---

## t4 — 5,68s medido

**Fala:**

> E aqui está a diferença. Ele não sai construindo: ele pergunta o que falta.

**Onde:** clique em `Começar →`, a entrevista abre

**Movimento:** **A transformação mais barata e mais eficaz do vídeo, porque é literalmente o que a tela faz.** A caixa da ideia **encolhe** e sobe, virando a linha `VOCÊ` no topo da conversa — o texto dentro dela cresce para a frase completa enquanto viaja. No espaço que ela desocupou, os cartões de pergunta **descem** um a um. Não corte: transforme.

`t4.mp3` · 5,68s medido · 75 caracteres

---

## t5 — 8,88s medido

**Fala:**

> Em que canal a mensagem chega, o que ela mostra, e o que fazer se o pedido cancelar. Embaixo de cada uma, o motivo dela existir.

**Onde:** as três perguntas, com o motivo por baixo

**Movimento:** Três cartões de pergunta, entrando de cima para baixo. Cada um chega em duas partes: primeiro a pergunta em negrito, e **~200ms depois** o motivo dela, em cinza, deslizando por baixo. Essa defasagem é o assunto da fala — a razão chega DEPOIS da pergunta, como quem explica. As opções de cada cartão entram por último, em fileira.

`t5.mp3` · 8,88s medido · 128 caracteres

---

## t6 — 8,64s medido

**Fala:**

> Nessa aqui a opção não é um rótulo: é a mensagem que vai sair, desenhada do jeito que vai chegar. Você escolhe olhando o resultado.

**Onde:** a pergunta do conteúdo, com as três bolhas `MODELO`

**Movimento:** O quadro fecha na segunda pergunta e as três opções dela **se transformam de chip em bolha de Slack**, uma a uma: o chip cresce, ganha o cabeçalho do canal, o crachá `APP`, a hora `09:00` e o texto com os `{{ campo }}` em `--accent`. **O selo `MODELO` entra junto com a bolha e não depois** — ele é o que impede a bolha de ser lida como resultado. A terceira opção fica selecionada ao fim.

`t6.mp3` · 8,64s medido · 131 caracteres

---

## t7 — 9,36s medido

**Fala:**

> Respondido, ele corre sozinho por sete etapas. Repara na dois: ele pulou, e escreveu o porquê do lado.

**Onde:** clique em `Enviar respostas →`, a esteira corre

**Movimento:** Clique em `Enviar respostas →`. Os cartões de pergunta **encolhem e saem** de baixo para cima, e a coluna da direita ganha o foco: a esteira `[ ETAPAS ]` **troca as etiquetas em sequência** — `01` de `ESPERA VOCÊ` para `✓`, `02` para `PULADA` com a nota deslizando por baixo, `03` para `✓`, `04` para `AGORA`. A `02` é a que a fala nomeia: segure meio segundo a mais nela, com a nota já legível.

`t7.mp3` · 9,36s medido · 102 caracteres

---

## t8 — 7,12s medido

**Fala:**

> E vai desenhando, nó por nó, enquanto escreve o arquivo. O que você está vendo é o fluxo sendo montado.

**Onde:** o desenho se construindo, nó por nó

**Movimento:** O desenho **se constrói** no lugar onde as perguntas estavam. Os quatro nós entram um a um na ordem de execução, cada um com a borda `--accent` **tracejada e marchando** e o rótulo ainda invisível; ao assentar, a borda vira neutra e o nome e o tipo aparecem por baixo. Entre um e outro, a ligação **se desenha** do anterior até o seguinte. No canto, `[ MONTANDO 3 / 4 ]` **conta** e vira `[ 4 NOS · 3 CONEXOES ]` ao terminar.

`t8.mp3` · 7,12s medido · 103 caracteres

---

## t9 — 10,16s medido

**Fala:**

> Antes de entregar, ele mostra o que isso produziria: a mensagem exata, no formato do Slack. Não é promessa — é o fluxo montando ela na sua frente.

**Onde:** `[ 06 ] O QUE ISTO PRODUZIRIA`, a bolha do Slack

**Movimento:** O desenho **recua para o alto** e o bloco `[ 06 ] O QUE ISTO PRODUZIRIA` se abre embaixo dele. A bolha do Slack **se monta linha a linha**, de cima para baixo: canal, remetente, hora, e as quatro linhas do texto. O selo `SIMULAÇÃO` entra com o cabeçalho — nunca depois. Ao fim, o selo em prosa aparece por baixo e **fica**: é a frase mais importante desta tela.

`t9.mp3` · 10,16s medido · 146 caracteres

---

## t10 — 7,60s medido

**Fala:**

> E ele marca o que não tem certeza. Aqui: o canal foi encontrado pelo nome, então confere se é o certo na sua conta.

**Onde:** o cartão de achado `RISCO`, na coluna da direita

**Movimento:** O cartão de achado `RISCO` **desliza da direita** para dentro da coluna, e uma linha fina sai dele até o `#vendas` no cabeçalho da bolha, ligando a advertência ao que ela é sobre. A terceira linha do cartão (`A CONFIRMAR · ainda não verifiquei`) chega por último e é a que fica em foco: é ela que separa o que o Tester mediu do que ele supôs.

`t10.mp3` · 7,60s medido · 115 caracteres

---

## t11 — 8,00s medido

**Fala:**

> Do lado, quanto essa construção custou. Setenta e nove centavos de dólar, e sai do seu plano — sem cobrança por fora.

**Onde:** a seção `[ GASTO ]`

**Movimento:** O quadro fecha na seção `[ GASTO ]`. O valor **conta** de `US$0,00` até `US$0,79`, em fonte monoespaçada — largura de dígito fixa, senão o número treme enquanto sobe. A frase `sai do seu plano, sem cobrança por fora` **se escreve** logo abaixo, depois que o número para. O número primeiro; a explicação depois.

`t11.mp3` · 8,00s medido · 117 caracteres

---

## t12 — 12,64s medido

**Fala:**

> E olha o rodapé. A única coisa criada no n8n foi uma cópia desligada e sem credencial, só pra provar que a sua conta aceita o desenho. O seu fluxo original, intocado.

**Onde:** o rodapé, trocando de frase

**Movimento:** **A cena que não pode sair errada.** O quadro desce até o rodapé. A frase antiga (`nada foi criado no n8n · nenhuma chamada feita`) **se apaga da esquerda para a direita** enquanto a nova **se escreve** no mesmo lugar, atrás da mesma frente — uma troca, nunca um pisca e nunca um fade. A nova frase tem quatro partes separadas por `·`, e a última (`seu fluxo original intocado`) é a que **fica em foco** quando a fala termina. Enquanto a voz fala da cópia criada, a frase antiga não pode estar em quadro.

`t12.mp3` · 12,64s medido · 166 caracteres

---

## t13 — 6,16s medido

**Fala:**

> Aí ele te entrega o arquivo pronto pra importar no n8n. Você dá um nome, guarda, e copia.

**Onde:** `[ 07 ] PRONTO PARA IMPORTAR`, o JSON

**Movimento:** O bloco `[ 07 ] PRONTO PARA IMPORTAR` **sobe** por baixo do fantasma, empurrando-o para cima. O JSON aparece como um bloco de código que **rola sozinho** por dois ou três segundos e para — ele não precisa ser legível inteiro, precisa parecer o que é: um documento pronto. Os controles (`Salvar projeto`, `⧉ Copiar o JSON`) entram por último, da esquerda para a direita.

`t13.mp3` · 6,16s medido · 89 caracteres

---

## t14 — 9,60s medido

**Fala:**

> E o que você construiu fica guardado, com a conversa que gerou aquele fluxo. É isso: você descreve, ele pergunta, e sai um fluxo pronto.

**Onde:** volta ao início, os três projetos guardados

**Movimento:** A tela **se afasta** para plano geral e volta à abertura. Os três cartões de `[ SEUS PROJETOS ]` entram em sequência, da esquerda para a direita, e o primeiro (`Aviso de venda no Slack`) **se abre um pouco** mostrando o bloco `◈ O QUE EU ENTENDI` por dentro — é a prova visual de que a conversa ficou guardada. A fala fecha; eles ficam.

`t14.mp3` · 9,60s medido · 136 caracteres

---

## Quatro cenas que têm regra própria

**t12 é a cena mais importante do vídeo, e a que mais arrisca sair errada.** O rodapé
**muda de frase** entre a etapa 04 e a 05. Até lá ele diz `nada foi criado no n8n · nenhuma
chamada feita`; depois passa a nomear a cópia inativa. A voz desta cena fala da SEGUNDA
frase. Se a primeira estiver em quadro enquanto ela fala, o vídeo estará afirmando o
contrário do produto — e no sentido pior, dizendo que nada foi criado quando algo foi. Esse
defeito exato foi encontrado no tour, na cena 9.9, e custou uma fala reescrita.

**t6 e t9 desenham a MESMA bolha, e o selo é a única coisa que as separa.** `MODELO` (t6) é
texto que um modelo escreveu para você comparar, antes de o fluxo existir. `SIMULAÇÃO` (t9)
é o fluxo resolvendo as próprias contas, depois de existir. Em ambas o selo entra **junto**
com o cabeçalho da bolha, nunca depois dela: uma bolha que aparece sem selo, mesmo por meio
segundo, é lida como resultado.

**t4 é a transformação de assinatura desta aba.** A caixa da ideia encolhendo e virando a
linha `VOCÊ` é o que a tela faz de verdade, e é o que dá a este vídeo o que o anterior não
teve. Se só uma cena receber capricho de animação, que seja essa.

**t11 tem uma amarra dura com o áudio.** A fala diz *"setenta e nove centavos de dólar"* por
extenso enquanto `US$0,79` está na tela. Os dois têm de bater, e um não pode ser corrigido
sem o outro.

## O que a narração cita em voz e portanto precisa estar em quadro

| cena | o que a voz nomeia |
|---|---|
| t1 | a aba se chama **Tester**; ela **constrói**, ao contrário das outras |
| t2 | escrever **em português**; o **seu nível**; **n8n** |
| t3 | há **exemplos** prontos; a ideia digitada, literal |
| t4 | ele **pergunta o que falta** em vez de sair construindo |
| t5 | **canal**, **o que a mensagem mostra**, **cancelamento**; o **motivo** de cada pergunta |
| t6 | a opção **é a mensagem**, não um rótulo |
| t7 | **sete** etapas; a **dois** foi **pulada**, e escreveu o porquê |
| t8 | **nó por nó**, enquanto escreve o arquivo |
| t9 | **o que isso produziria**; formato do **Slack**; não é promessa |
| t10 | ele **marca o que não tem certeza**; o canal foi encontrado **pelo nome** |
| t11 | **setenta e nove centavos de dólar**; **sai do seu plano**, sem cobrança por fora |
| t12 | **uma cópia desligada e sem credencial**; o fluxo original **intocado** |
| t13 | o arquivo **pronto pra importar**; dar nome, guardar, copiar |
| t14 | fica **guardado**, com a **conversa** que gerou o fluxo |
