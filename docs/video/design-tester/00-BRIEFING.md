# Briefing — vídeo animado da aba Tester

Leia este arquivo primeiro. Os outros três são referência; este é o pedido.

## O que é para fazer

Um **vídeo animado curto** (~2:00) que ensina uma pessoa **não técnica** a usar a aba Tester do
Cockpit. Ele vai atrás de um botão *"como usar esta tela"* dentro do próprio painel, então quem
assiste **já está na tela** e quer saber onde clicar — não é peça de venda e não é tour do produto.

Vai existir um vídeo por aba (Fluxos, Disco, Tester, Upgrade). **Este é o da aba Tester.** O da aba
Fluxos já foi feito por você e serve de referência de linguagem — este é o segundo da série e
precisa parecer o mesmo produto.

## O que é a aba Tester, em duas frases

As outras abas do Cockpit **olham** para automações que já existem: o que rodou, o que quebrou, o
que precisa de conserto. A aba Tester faz o contrário — a pessoa **descreve em português** o que
quer que aconteça, o Tester **pergunta o que falta**, e no fim entrega um fluxo pronto para importar
no n8n.

## A diferença mais importante em relação ao vídeo da aba Fluxos

**A aba Fluxos é UMA tela. A aba Tester é uma máquina de SEIS estados.**

Lá as catorze cenas moram todas no mesmo painel: os cartões, a lista, os erros — tudo continua na
tela o tempo inteiro, e o que muda é para onde se olha. Aqui **cada cena mora num estado diferente,
e o estado anterior deixa de existir**: a caixa da ideia some quando a entrevista abre, as perguntas
somem quando a esteira corre, a esteira dá lugar ao desenho, o desenho recua para o fantasma
aparecer.

**Isso joga a favor deste vídeo, não contra.** No vídeo anterior a transformação teve de ser
inventada por cima de uma tela parada. Aqui a transformação **é o produto acontecendo** — a caixa de
texto que encolhe e vira uma linha de conversa no topo é literalmente o que a tela faz. Aproveite
isso: o corte entre duas cenas quase nunca precisa ser um corte.

Os seis estados estão descritos um a um em `02-ANATOMIA-E-DADOS.md`, com o texto literal de cada um.

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
- pode simplificar (mostrar 3 perguntas onde a entrevista pode ter até 5), enquadrar, isolar,
  ampliar, animar;
- **não pode acrescentar** — nem um ícone, nem uma etapa, nem um "Configurações" que não existe.

Simplificar é escolher o que mostrar. Inventar é mostrar o que não existe. A primeira é edição, a
segunda é o defeito.

## Cinco frases da tela que não podem ser resumidas

Estas cinco são o produto sendo honesto sobre os próprios limites. Elas estão na tela justamente
para não deixarem a pessoa concluir a mais, e **encurtá-las na animação desfaz o que elas fazem**.
Todas estão literais em `02-ANATOMIA-E-DADOS.md`.

1. **O rodapé, depois da etapa 05.** `cópia de teste no n8n: [SANDBOX tester]
   loja_aviso_venda_slack · inativa · sem credenciais · seu fluxo original intocado`. Uma cena
   inteira é sobre ele.
2. **O selo do fantasma.** *"Passar aqui não prova que o fluxo funciona — prova que ele monta a
   mensagem certa com os campos que você apontou."*
3. **A fonte de cada achado.** `A CONFIRMAR · ainda não verifiquei` — é o que separa o que o Tester
   mediu do que ele supôs.
4. **A frase do interruptor de credenciais.** *"Só liga quando existe UMA credencial possível —
   havendo duas, a escolha é sua."*
5. **A nota da etapa 02.** `PULADA — todo serviço já tem nó nesta instância, nada a pesquisar`.

## `MODELO` e `SIMULAÇÃO` são dois selos, e nunca podem virar um

Aparecem os dois no vídeo, em cenas diferentes, e a diferença entre eles é a única coisa que faz o
fantasma valer alguma coisa:

- **`MODELO`** (cena t6, na entrevista) — texto que o modelo **escreveu para você comparar**, antes
  de o fluxo existir. É uma proposta.
- **`SIMULAÇÃO`** (cena t9, no fantasma) — o **fluxo resolvendo as próprias contas**, depois de
  existir. É uma derivação.

Os dois desenham uma bolha de Slack quase idêntica. **O selo é o que os separa.** Um selo só para os
dois transformaria o vídeo inteiro numa promessa.

## O que se espera de "animado"

O que faltou na tentativa anterior não foi movimento de câmera — foi **transformação**. Coisas que
valem, e aqui a maioria já é o que a tela faz:

- a caixa da ideia que **encolhe** e vira a linha `VOCÊ` no topo da entrevista;
- as opções de resposta que **se transformam** de chip em bolha de mensagem;
- a esteira de sete etapas cujas etiquetas **trocam** em sequência (`ESPERA VOCÊ` → `✓` → `AGORA`);
- o desenho do fluxo se **construindo** nó por nó, com as ligações se desenhando entre eles;
- números que **contam** até o valor em vez de aparecerem prontos (o gasto, o passo `04 / 07`);
- o rodapé cuja frase **se reescreve por cima da anterior**, em vez de piscar;
- um elemento que **se transforma em outro** entre duas cenas, em vez de corte seco.

O cursor, se houver, é ferramenta e não protagonista: ele existe para dizer *onde* se clica, e a
consequência do clique é o que a cena mostra.

## Duração e ritmo

**~2:00 no total, 14 cenas.** As durações estão em `03-ROTEIRO-E-MOVIMENTO.md`.

**ATENÇÃO — e esta é a diferença mais perigosa em relação ao vídeo da aba Fluxos.** Lá a coluna de
duração era **medida** no arquivo de áudio, e era um contrato. **Aqui ela é ESTIMATIVA: a narração
ainda não foi gerada.** Nenhum MP3 existe.

Na prática, para você:

- **Trate os segundos como orçamento, não como marca.** Uma cena escrita para caber em 8,3s exatos
  vai ficar apertada ou frouxa quando o áudio real chegar.
- **Prefira animação que ESTICA bem.** Uma entrada em sequência de N elementos absorve meio segundo
  a mais sem nada quebrar; uma coreografia com três marcações rígidas, não.
- **Devolva a tabela de tempos que você usou**, como fez no vídeo da aba Fluxos. É contra ela que a
  narração vai ser gerada e ajustada — o ciclo é o inverso do anterior, e a estimativa aqui erra
  até ~1,7s numa fala só.

## Tema

**Claro, do começo ao fim.** A paleta clara está em `01-SISTEMA-DE-DESIGN.md`.

**Não há cena de troca de tema neste vídeo.** O vídeo da aba Fluxos já ensinou o botão `◐`, e
repetir a mesma cena em quatro vídeos ensina que os vídeos se repetem. A coluna escura está no
arquivo de design apenas como referência da paleta completa — não é para ser usada aqui.

## Resolução

**4K (3840×2160), 30fps.** Interface desenhada não tem o problema que a gravação tinha: não existe
layout esticando, então 4K aqui é só nitidez.

## Sobre a voz

**A narração ainda não existe.** O texto de cada cena está em `03-ROTEIRO-E-MOVIMENTO.md` e é o que
vai ser gravado — trate-o como definitivo para efeito de conteúdo, e como aproximado para efeito de
duração.

Uma fala tem uma amarra dura: a **t11** diz *"setenta e nove centavos de dólar"* **por extenso**, e
o número `US$0,79` está na tela ao mesmo tempo. Os dois têm de bater.

## O que NUNCA pode aparecer sendo clicado

- **`✓ Aplicar e salvar`** — grava um remendo num projeto já salvo, por cima da versão anterior.
- **`Excluir`** — no menu `⋯` de um cartão de projeto.

Eles podem **aparecer** em quadro. Nenhum pode aparecer **sendo clicado**: um tutorial que mostra o
clique ensina o clique.

**O que PODE e DEVE ser clicado**, porque é o caminho da tela: os chips de nível, os chips de
resposta, `Começar →`, `Enviar respostas →`, `É isso, pode fechar`, `⧉ Copiar o JSON`, e um cartão
de `[ SEUS PROJETOS ]`.

## Os arquivos

| arquivo | o que é |
|---|---|
| `00-BRIEFING.md` | este: o pedido e as restrições |
| `01-SISTEMA-DE-DESIGN.md` | cores, tipografia e geometria, **medidos do produto rodando** |
| `02-ANATOMIA-E-DADOS.md` | os seis estados da tela, os rótulos literais e os números que aparecem |
| `03-ROTEIRO-E-MOVIMENTO.md` | as 14 cenas: fala, duração estimada, e o que deve se transformar |

`01` e `02` são **gerados** (`node .video/medir-tester.js && node .video/brief-tester-md.js`) a
partir de valores lidos do browser com a página viva. Não são descrição do produto: são medição
dele. Se algo neles parecer estranho, é porque o produto é assim.
