# Roteiro — Tour do Cockpit

**Voz:** `kPzsL2i3teMYv0FxEYQ6`, style 0.55, stability 0.40
**Régua:** 14,8 car/s (faixa medida 14,1–15,4). A coluna `≈s` é **derivada** de `voz.duracao()` por
`docs/video/contar.js`, nunca digitada — a primeira versão trazia a coluna à mão e a soma estava 31%
otimista. Ver o cabeçalho de `.video/voz.js`.

**Gravação:** fixture. Todo `/api/**` interceptado, nada chega ao n8n, nada gasta cota de modelo.

**Ordem:** a que o Kauan pediu em 26/08, substituindo a primeira. A mudança de peso: o Disco saiu do
fim e ganhou corpo, o seletor de fluxos ganhou cena própria, e o Tester e o Upgrade dobraram —
"mostrar um projeto já criado e como foi a criação" e "mandar um upgrade num nó" são duas cenas que a
versão anterior não tinha. A v1 está em `.01-roteiro-v1.md.bak` para comparar.

## O que este roteiro não faz, de propósito

Toda tela, rótulo e botão citados aqui **existem** e foram lidos no fonte, verbatim. Onde eu não
tinha certeza, a cena não entrou.

- **Não clica em `✓ Aprovar e aplicar`** nem em `✓ aplicar` no Upgrade. Os dois escrevem em fluxo de
  produção. As cenas param no diff, que é onde o produto para — é o argumento, não uma limitação.
- **Não clica em `▷ Reexecutar a execução`.** Manda mensagem real para lead real, sem desfazer.
- **`⏺ Gravar` fica desligado.** O que responde ao seu "escondendo se tiver alguma coisa que não pode
  mostrar" é o **fixture**, não a tarja: nome de projeto no Disco e nome de lead nos fluxos são
  inventados. Tarja em quadro faz o espectador achar que o produto esconde coisa dele.

---

## ATO 1 — A aba de fluxos (0:00 – 0:19)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 1.1 | `/` recém-carregada | segurar. **Carga limpa** — o contador que sobe e os cartões que entram animam **uma vez só** | "Um fluxo parou, alguém reclamou, e você tem quinze abas abertas tentando achar onde. Esse é o Cockpit, e essa é a aba de fluxos." | 9,3 |
| 1.2 | zoom na tira de KPIs | zoom suave | "Novecentas execuções em vinte e quatro horas. Onze falhas. E, o que importa: **quais** onze." | 6,7 |

**Fixture:** `GET /api/n8n/overview` — 8 fluxos, ~900 execuções, 3 com erro → 2 assinaturas.

---

## ATO 2 — Os fluxos que estão de pé (0:19 – 0:51)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 2.1 | rolar até `[ 05 / 05 ] Fluxos com atividade` | rolar devagar | "Aqui embaixo, os fluxos que estão de pé. E «de pé» tem regra: rodou na janela, ou está ativo, ou é chamado por um fluxo vivo." | 9,1 |
| 2.2 | zoom num cartão de fluxo | zoom | "Cada cartão diz numa frase o que está acontecendo com aquele fluxo. Não é nota de saúde: é frase que você consegue agir sobre." | 9,1 |
| 2.3 | apontar um cartão `CHAMADO POR` | segurar | "E esse não tem gatilho próprio. Quem dispara é o fluxo que chama ele — o cockpit sabe disso e te manda olhar lá primeiro." | 8,8 |

> **Nota:** um sub-fluxo **nunca** pode estar `active` no n8n. Qualquer painel que filtre por "ativo
> ou rodou" esconde justamente os quietos, e 14 de 68 fluxos estavam nessa forma quando isso foi
> medido. A fala 2.3 existe porque é uma diferença que ninguém nota até perder uma tarde.

---

## ATO 3 — O filtro do ao vivo (0:51 – 1:14)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 3.1 | `[ 02 / 05 ] Ao vivo`, zoom no chip do fluxo | zoom no chip `▾` da barra de filtro | "Repara numa coisa no ao vivo: um fluxo sozinho domina o volume." | 4,6 |
| 3.2 | clicar o chip; abre o modal `[ FLUXO ] Filtrar por fluxo` | clicar | "É sempre assim. Tem um fluxo que roda o tempo todo e enterra todos os outros na lista." | 6,2 |
| 3.3 | modal aberto, página desfocada | segurar; apontar as linhas | "Então filtrar aqui não é conveniência. É o que faz os outros existirem na tela." | 5,7 |
| 3.4 | ↓ ↓ Enter | escolher pelo teclado | "Escolho um, e o ao vivo passa a ser só dele." | 3,2 |

**Fixture:** o seletor de `flows.html` lista **só os fluxos que executaram na janela**, mais a
linha `Todos os fluxos`. Fluxo sem execução não tem o que filtrar — é desenho, não falta.

> **Nota:** este ato foi reescrito. A primeira versão misturava duas telas numa cena só: a coluna
> `tela` dizia `Ao vivo` (o `flows.html`) e a fala era do `/upgrade` — "peso, desenho e dossiê" é
> conceito daquela página, e os grupos `na vitrine`/`fora da porta` são o `SELETOR_GRUPO` de lá.
>
> **A primeira versão desta nota trazia uma medição ERRADA, e ela é a lição mais útil deste ato.**
> Eu havia escrito que `todos os fluxos ▾` "só existe no `upgrade.html`, medido: 1 ocorrência lá, 0
> no `flows.html`". **Falso.** O `flows.html` TEM esse controle — é o terceiro `.fchip` da barra do
> ao vivo, e as cenas 3.2–3.4 clicam nele. O grep não o achou porque o rótulo é montado em
> `flows.html:4768` por `el("span", "nm", S.feedFilter.wf ? … : "todos os fluxos")` e o `▾` é outro
> elemento: grepar `todos os fluxos` dá **2 e 2**, não 0 e 1.
>
> E o erro foi pior que um grep ruim. **O inventário de tela já havia dito que o `flows.html` tinha
> aquele controle, e eu descartei essa observação por causa da minha medição.** Troquei o que foi
> visto na tela pelo que o texto do arquivo dizia — exatamente ao contrário da disciplina desta
> casa, que extrai da página em tempo de execução em vez de reimplementar. Grep mede o TEXTO do
> arquivo; rótulo montado por `el()` com ternário é invisível para ele. **Quem decide é o DOM.**
>
> Nada disso muda o ato: o assunto novo, a coluna `tela` e a ação estão certos, e os "75 fluxos, 64
> pelo id" continuam no Ato 11 porque o seletor do `flows.html` lista só quem executou — ele não
> tem 75 linhas nem dois grupos. Achado pela sessão que grava, medindo o DOM. Os "75 fluxos, 64 pelo id" foram para o Ato 11, que
> é onde o `/upgrade` já estava. Achado pela sessão que grava, olhando o quadro renderizado — não
> pelo fonte.

---

## ATO 4 — Uma execução que deu certo (1:14 – 1:43)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 4.1 | clicar no chip `deu certo` | clicar | "No ao vivo eu filtro só o que deu certo." | 2,9 |
| 4.2 | clicar numa linha verde; a seção 01 desenha | clicar | "Clico numa execução e o fluxo aparece desenhado, do jeito que existe no n8n. Mesmos ícones, mesmas portas." | 7,7 |
| 4.3 | zoom no bloco `O que aconteceu` | zoom | "E embaixo, em português: quem escreveu, o que mandou, o que o fluxo respondeu. Não é «rodou com sucesso». É **o que ele fez**." | 9,1 |
| 4.4 | apontar a lista de nós fechada | segurar | "E a prova fica aqui, nó por nó, se você quiser conferir." | 4,1 |

**Fixture:** `GET /api/n8n/graph/:id` (12–20 nós, uma sticky note) e `GET /api/n8n/execution/:id` com
contato, mensagem recebida e mensagem enviada.

---

## ATO 5 — Uma que deu errado (1:43 – 2:35)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 5.1 | clicar no chip `deu erro` | clicar | "Agora o outro lado. Filtro só o que deu errado —" | 3,5 |
| 5.2 | a lista filtra, banda `NO PALCO` acende | segurar 1s | "— que, sejamos honestos, é a única coisa que você quer ver numa segunda-feira." | 5,7 |
| 5.3 | rolar até `[ 03 / 05 ] Erros agrupados` | rolar | "As falhas vêm agrupadas por assinatura. O mesmo erro em dois fluxos é **um** defeito, não dois." | 6,9 |
| 5.4 | os DOIS cartões no quadro, um sob o outro | zoom out para caber os dois | "E aqui estão os dois lados do mesmo defeito. Mesmo nó, mesma mensagem — mas um cartão é a falha em casa, e o outro é ela reportada no fluxo pai." | 10,4 |
| 5.5 | zoom no chip `⤷` do segundo cartão | zoom | "Esse chip é o cockpit dizendo: o nó que quebrou não existe no fluxo que você está vendo. Ele abriu os sub-fluxos e achou onde ele mora." | 9,8 |
| 5.6 | segurar nos dois | segurar | "Sem isso você abre o editor, procura o nó, não acha, e desconfia do painel. Já custou tarde de gente boa." | 7,6 |

**Fixture:** a assinatura de sub-fluxo — o pai reporta um nó que só existe no filho.
`GET /api/n8n/locate/:id?node=` e `GET /api/n8n/callers`.

---

## ATO 6 — Clico no cartão e mando pro Claude (2:35 – 3:46)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 6.1 | cartão de erro | clicar **`⧉ Mandar pro Claude`** | "E aqui o cockpit deixa de ser painel. Um clique." | 3,5 |
| 6.2 | overlay `[ HANDOFF ]` abre com morph | segurar; o mini grafo se desenha | "Ele abre o Claude Code **na sua máquina**. Sem rede, sem shell, sem ver credencial nenhuma." | 6,6 |
| 6.3 | etapas 1–5 correndo | acelerar 2× na montagem | "Lê a assinatura, o desenho do fluxo, localiza o nó, relê a execução que quebrou." | 5,8 |
| 6.4 | etapa 6, banda de atividade | segurar; mostrar `Read`/`Write` | "E agora ele corrige. Você vê o que ele está lendo, arquivo por arquivo. Sem barra de progresso fingindo trabalho." | 8,2 |
| 6.5 | o portão que reprova, na banda de atividade | segurar; a linha do portão no log | "Aí vem a parte que eu mais gosto: onze portões conferem a proposta antes de você ver qualquer coisa. E esse aqui reprovou." | 8,8 |
| 6.6 | a rodada volta pro Claude | segurar; `rodada 2` na banda | "Ele tinha desligado um nó em vez de consertar. Volta pra ele com o motivo — e uma proposta que não passa **nunca vira botão de aprovar**." | 9,9 |
| 6.7 | `[ REVISÃO ]`, as pílulas e o diff | zoom nas pílulas, depois rolar o diff | "Na segunda tentativa passou. Nenhum nó removido, nenhuma credencial tocada, nenhum segredo no parâmetro. E o que chega pra você é o diff, nó por nó." | 10,7 |
| 6.8 | zoom no rodapé `HANDOFF_TRUTH` | zoom | "E o cockpit diz com todas as letras: nada disso está no n8n ainda. Ele propõe, **você** aplica." | 6,9 |

**Fixture:** `POST /api/claude/fix` + stream: 8 etapas, `tool_use` plausível, **uma rodada reprovada
antes de passar** (a cena 6.6 depende dela), 10 portões passando, diff em 1 nó.

> **Nota:** medido no produto, uma rodada é ~176s e ~US$1,16. Comprimir para ~35s de tela é honesto
> desde que a narração não diga "em segundos" — e ela não diz.
>
> **As cenas 6.5–6.7 foram reordenadas para seguir a FITA, e a razão é uma medição.** As pílulas de
> portão não acendem uma a uma: `.gate` é **zero** durante as duas passagens pelos portões e **13**
> só na banda de revisão. A versão anterior filmava a 6.5 na banda (onde as pílulas existem) e a
> 6.6 num instante ANTERIOR da fita — o espectador veria verde, reprovação, verde de novo, e
> concluiria que a reprovação veio depois da aprovação. Agora a reprovação é narrada onde ela
> acontece e os vereditos onde eles existem.
>
> **E a fita não tinha rodada reprovada nenhuma até 26/08.** A nota de fixture acima pedia
> explicitamente "uma rodada reprovada antes de passar" e ninguém tinha conferido que a fita
> cumpria — zero portão com `ok: false` em qualquer quadro. **Nota de fixture é especificação, e
> especificação sem aferição é desejo**: a cena 6.6 teria sido gravada sobre um instante que não
> existia. Achado pela sessão que grava, medindo a fita antes de mapeá-la.

---

## ATO 7 — Passo de volta pelos fluxos (3:46 – 3:58)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 7.1 | fechar o overlay, voltar a `/` | clicar `✕ Fechar` | "Fecho, e o painel continua onde estava. A falha segue no quadro: ela sai quando parar de acontecer, não quando alguém disser que resolveu." | 10,0 |

> **Nota:** literal no produto. Marcar uma correção guarda o maior id de execução daquele momento, e
> a assinatura **reabre sozinha** se aparecer uma execução com id maior.

---

## ATO 8 — O Disco (3:58 – 4:37)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 8.1 | navegar para `/disco` | clicar na porta `Disco` (a lente viaja) | "Segunda porta: o Disco. É onde ficam os seus projetos de verdade, os da pasta." | 5,7 |
| 8.2 | zoom na barra de distribuição | zoom nas quatro faixas | "Ele varre a pasta e separa em quatro: ativo, atenção, parado e frio. Clico numa faixa e filtro." | 6,9 |
| 8.3 | zoom num cartão com diagnóstico | zoom | "E cada projeto vem com uma frase. «Fora do git, nenhuma alteração é reversível». «Sem CLAUDE.md nem README — um agente abre isso sem contexto nenhum»." | 10,9 |
| 8.4 | clicar num cartão, abrir o detalhe | clicar | "Abro e vejo os pontos a verificar, o git, onde está o peso do projeto, os TODOs. Tudo derivado da varredura. Nada digitado." | 8,9 |

**Fixture:** `GET /api/projects` — ~10 projetos inventados, nas quatro faixas.

> **Nota:** os nomes vêm do fixture, então não há o que esconder. Na máquina de verdade essa tela
> mostra nome de cliente, e é por isso que ela não é filmada ao vivo.

---

## ATO 9 — O Tester: eu só descrevo (4:37 – 5:40)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 9.1 | navegar para `/tester` | clicar na porta `Tester` | "Terceira porta, e essa não conserta fluxo. Ela **constrói**." | 4,3 |
| 9.2 | zoom no campo e nos chips de nível | zoom em `nunca mexi` / `sei o básico` / `sou técnico` | "Repara no que ele pergunta primeiro: o seu nível. Porque não é você que precisa saber n8n." | 6,5 |
| 9.3 | digitar no campo | digitar de verdade | "Eu escrevo do meu jeito, em português, do jeito que eu explicaria pra um colega." | 5,8 |
| 9.4 | campo preenchido | clicar `Começar →` | "«avisar no Slack quando cair pedido novo». É isso. Nenhum nó, nenhum JSON, nenhuma documentação aberta." | 7,5 |
| 9.5 | etapa 01, perguntas | segurar nas perguntas | "E ele **pergunta o que falta**, em vez de adivinhar. Qual canal, o que vai na mensagem." | 6,3 |
| 9.6 | clicar 2 chips e enviar | `Enviar respostas →` | "Escolho as respostas —" | 1,6 |
| 9.7 | etapas 04–05, canvas desenhando | acelerar; o canvas desenha ao vivo | "— e ele desenha. Nó por nó, na tela, enquanto escreve o arquivo." | 4,6 |
| 9.8 | `[ 06 ] O QUE ISTO PRODUZIRIA` | zoom na bolha do Slack | "E antes de entregar, mostra **o que isso produziria**, desenhado como Slack. Não é ele dizendo que funciona: é o fluxo resolvendo as próprias expressões." | 11,1 |
| 9.9 | zoom no rodapé | zoom | "E o rodapé, o tempo todo: nada foi criado no n8n. Você importa quando quiser." | 5,6 |

**Fixture:** `GET /api/tester/status` + stream de um build **curto** (4 nós, Slack), parando na etapa
01 com 3 perguntas, depois correndo até a 07.

---

## ATO 10 — Um que já foi construído (5:40 – 6:06)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 10.1 | voltar ao início, zoom em `[ SEUS PROJETOS ]` | clicar `← Voltar para o início` | "E o que você constrói fica guardado." | 2,6 |
| 10.2 | clicar num projeto salvo | clicar num cartão | "Abro um que já existe, e ele **replica a conversa inteira** que construiu aquele fluxo." | 6,3 |
| 10.3 | rolar a conversa replicada | rolar devagar | "O que eu pedi, o que ele entendeu, e o que eu escolhi. Seis meses depois, o motivo de cada nó ainda está aqui." | 8,0 |
| 10.4 | zoom out para o fluxo desenhado | zoom out | "E o fluxo desenhado, do jeito que ele saiu, com o JSON pronto para copiar." | 5,4 |

**Fixture:** um projeto salvo com `chat` e `respostas` preenchidos, mais o `wf` de 4 nós.

> **Nota:** projeto salvo antes dessa funcionalidade existir não tem histórico, e a tela **diz isso**
> em vez de fingir que a linha da ideia foi a conversa. O fixture usa um com histórico, que é o caso
> que vale filmar.

---

## ATO 11 — O Upgrade: mexer num fluxo que já roda (6:06 – 7:21)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 11.1 | navegar para `/upgrade` | clicar na porta `Upgrade` | "Quarta porta. Essa é para quando o fluxo **já funciona** e você quer que funcione melhor." | 6,4 |
| 11.2 | zoom na vitrine | zoom na grade | "A grade mostra os onze que estão de pé, com o peso de cada um e quanto custa conversar sobre ele." | 7,0 |
| 11.2b | clicar `todos os fluxos ▾`, o seletor abre | clicar | "E os outros? Setenta e cinco fluxos na instância. Os sessenta e quatro que não estão na grade só eram alcançáveis colando o id na URL. Agora estão aqui, em dois grupos que dizem por que cada um está onde está." | 15,1 |
| 11.3 | clicar num cartão | clicar | "Escolho um." | 0,8 |
| 11.4 | tela do fluxo | zoom no desenho | "Ele abre o fluxo desenhado, e a conversa do lado." | 3,6 |
| 11.5 | digitar o pedido | digitar de verdade | "E eu peço em português: «no nó que manda a mensagem, corta o texto em quatro mil e quinhentos caracteres, e avisa quando cortar»." | 9,3 |
| 11.6 | ele responde com o alvo | segurar | "Ele não sai remendando. Primeiro volta dizendo **qual nó** vai mexer e o que vai fazer. E eu confirmo." | 7,4 |
| 11.7 | clicar `✓ é isso`; a bateria acende | clicar | "Confirmo, e vem a bateria: oito checagens, da estrutura até o aceite do próprio n8n." | 6,1 |
| 11.8 | zoom no diff | rolar o diff | "E de novo termina aqui. O diff do que ele quer escrever, e o botão de aplicar do seu lado da mesa." | 7,1 |

**Fixture:** vitrine com 8 fluxos, **dossiê verde** num deles (sem dossiê o compositor nasce travado —
comportamento real), a resposta de alvo, e a bateria com as 8 linhas passando.

> **Atenção:** ao vivo, `✓ é isso` **escreve** uma cópia inativa na instância antes de qualquer
> aprovação, e aplicar dispara uma escrita de dossiê paga sozinha minutos depois. Com fixture nada
> disso acontece — é a razão principal de o Upgrade não ser filmado ao vivo.

---

## ATO 12 — Fecho (7:21 – 7:30)

| # | tela | ação | fala | ≈s |
|---|---|---|---|---|
| 12.1 | volta para `/`, zoom out até a tela cheia | zoom out lento | "Quatro portas. Uma pergunta: o que está vivo, o que apodreceu, e o que fazer sobre isso. Sem quinze abas." | 7,6 |

---

## Contas

**Derivado, nunca digitado.** `node docs/video/contar.js` recalcula a coluna `≈s`, as marcas de
tempo de cada ato e esta tabela. Ver o cabeçalho deste script para o defeito que o criou.

| | |
|---|---|
| atos | 12 |
| falas | 55 |
| caracteres falados | 5231 |
| narração estimada | **379s** (6:19) |
| duração alvo | **450s** (7:30) |
| fala / silêncio | 84% / 16% |

| ato | fala | janela |
|---|---|---|
| 1 | 16s em 2 falas | 0:00 – 0:19 |
| 2 | 27s em 3 falas | 0:19 – 0:51 |
| 3 | 20s em 4 falas | 0:51 – 1:14 |
| 4 | 24s em 4 falas | 1:14 – 1:43 |
| 5 | 44s em 6 falas | 1:43 – 2:35 |
| 6 | 60s em 8 falas | 2:35 – 3:46 |
| 7 | 10s em 1 falas | 3:46 – 3:58 |
| 8 | 32s em 4 falas | 3:58 – 4:37 |
| 9 | 53s em 9 falas | 4:37 – 5:40 |
| 10 | 22s em 4 falas | 5:40 – 6:06 |
| 11 | 63s em 9 falas | 6:06 – 7:21 |
| 12 | 8s em 1 falas | 7:21 – 7:30 |

**Densidade em 84%, acima do limite.** Acima de 80% cansa. Corte narração ou
aumente o alvo — mas o alvo veio de um pedido ("não pode demorar tanto"), então cortar é a
saída certa.

**Cota do ElevenLabs:** 5231 caracteres por geração completa do roteiro. Reserve 3×
para regeração — e note que esta chave **não tem** `user_read`, então não há como consultar o
saldo: o primeiro sinal de cota esgotada é um HTTP de erro numa fala qualquer.

## Armadilhas de gravação, medidas

1. **As animações de entrada disparam uma vez.** `seenCardIds`, `S.fantasmaVisto`, `S.desenhado`,
   `S.batAssin`, o contador que sobe. Toda tomada que precisa de movimento exige **recarga forte**.
2. **A lente da navegação só viaja entre portas diferentes.** F5 na mesma porta não anima nada — os
   atos 8, 9 e 11 dependem de navegar, não recarregar.
3. **SSE repinta colunas inteiras várias vezes por segundo.** Para plano que precise ficar parado,
   `?static=1`.
4. **Barra sem histórico é listrada, não percentual.** Nunca mostre número na barra do dossiê
   incremental: ela tem **zero** amostras medidas.
5. **`prefers-reduced-motion` mata metade da camada de movimento.** Confira na máquina de gravação.
6. **O compositor do Upgrade nasce travado em 72 dos 75 fluxos** — sem dossiê não há campo para
   digitar. O fixture do ato 11 precisa de dossiê verde, senão a cena 11.5 não existe.
