# Plan: aba Upgrade — evoluir um fluxo que já existe
_Locked via grill — by Claude + Kauan, 2026-08-13_

## Goal

O cockpit tem duas portas e nenhuma faz o que esta aba faz. `flows.html` conserta o que **quebrou**
(a assinatura de erro define o alvo). O Tester **cria** fluxo do zero. Não existe caminho para
*"esse fluxo funciona e eu quero que ele passe a fazer mais uma coisa"* — que é o pedido mais
frequente e o único que hoje termina em edição manual no editor do n8n.

A aba `/upgrade` abre uma **vitrine dos fluxos vivos**, Kauan escolhe um, e a partir daí é
**conversa**: ele descreve a melhoria, o modelo pode contestar ou perguntar de volta, e o resultado
é um **patch** contra o fluxo vivo. Uma **bateria de sete checagens** decide se o botão de aplicar
aparece. Aplicar escreve no fluxo real do n8n, com backup e `↺ Desfazer`, reusando o caminho de
approve que já existe.

O que a aba **não** promete: que o upgrade funciona. A API pública do n8n **não tem endpoint de
execução** — nada aqui executa fluxo. A bateria prova que o documento é estruturalmente válido na
versão declarada e que nada que carregava tráfego foi rompido. Isso é piso, não teto, e a tela tem
de continuar dizendo isso.

## Approach

### 1. A vitrine (`/upgrade`)

1.1 **Conjunto: reusa `naPorta()` de `flows.html`.** Rodou na janela **ou** está `active` **ou** é
chamado por fluxo vivo, menos o que tem nome de rascunho e nunca rodou. Medido 2026-08-13: **13 de
73 fluxos**. Uma segunda definição de "fluxo vivo" no produto seria deriva garantida.

1.2 **Ordem: execuções na janela, decrescente.** É o oposto do quadro de erros (lá sobe o que
quebrou). Aqui sobe o que importa e funciona: 751 execuções/24h é onde um upgrade paga.

1.3 **Cartão = ideia C (escolhida por Kauan olhando PNG).** A identidade visual do cartão é o
**desenho real do fluxo** — posição verdadeira dos nós (`x`/`y` de `extractGraph`) e arestas,
normalizada pela caixa, sticky notes filtradas por `isAnnotation()`. Nós como quadrados de 1,6–3px
conforme densidade; arestas em `--wire`.

1.4 **O desenho pinta o nó que falhou em `--risk`.** É o que impede o desenho de ser enfeite: a
assinatura de erro nomeia o nó, então o cartão mostra **onde** dói antes do clique. Quando a
atribuição aponta para sub-fluxo (`originOf` = `subflow`), o cartão **não** pinta nó nenhum e diz
`⤷ <filho>` — pintar o nó errado é pior que não pintar.

1.5 **Rótulo de custo em três faixas, não em dólar seco.** `leve` / `médio` / `pesado` mais o número
cru de tokens, e o estado do dossiê: `pesado · sem dossiê` antes, `leve · dossiê de hoje` depois.
Dólar no cartão lê como fatura, e **não é cobrança**: as sessões rodam no plano
(`claudeAiOauth`, `subscriptionType=team`), a mesma cota de 5h/7d de uma sessão interativa.

1.6 **Fluxo com zero execuções entra, no fim, tracejado e dessaturado.** `GABI [Envio Manual]` é
manual por definição; esconder seria a tela decidir que ele não existe. Mas não pode competir
visualmente com um de 751. Medido: 4 dos 13.

1.7 **`⤷ <pai>` quando o fluxo é sub-fluxo.** Sub-fluxo nunca é `active` no n8n, então
`Agente Iago Comercial` aparece com 96 execuções e `active: false`. A linha vem de
`/api/n8n/callers` (20s a frio, cache 15 min) e é buscada **depois** da primeira pintura.

### 2. O dossiê do fluxo (`.cache-fluxos/<id>.md`)

2.1 **Por que existe.** Ler o documento inteiro do `Agente Iago Comercial` custa **~81k tokens de
entrada** (291KB medido). O dossiê é prosa de ~6KB descrevendo o que cada trecho faz, e substitui a
**exploração** — nunca a edição.

2.2 **Nível 1, grátis e sempre fresco: `nodes-index.md`.** Gerado por código
(`nodesIndex` de `claude-fix.js`), 13KB para 179 nós: `nome · tipo · arestas de saída`. Não pode
envelhecer porque nasce a cada rodada.

2.3 **Nível 2, o dossiê em prosa.** Escrito por uma sessão avulsa (padrão `rodarAvulso` de
`tester.js`: sem conversa, sem SSE), a partir do workflow **redigido** (`redactWorkflow`), com
`--disallowedTools` e `--setting-sources ""`.

2.3.1 **O custo do dossiê É medido e gravado**, ao contrário do que `rodarAvulso` faz hoje. Corrigido
na rodada 1: esse padrão não tem ledger de custo, e adotá-lo como está apagaria a observabilidade
exatamente sobre o gasto **recorrente novo** que esta aba introduz — o dossiê é regenerado a cada
alteração relevante do fluxo, então é o item que mais tende a acumular sem ninguém ver.

**Vai para `dossies.json`, e não para `proposals.json`** — ver §7.1.2 para a razão. Rodada morta grava
`usdDesconhecido: true` em vez de zero, pela lição já paga. *(A rodada 1 deste plano dizia
`proposals.json` com `kind: "dossie"`; a rodada 2 mudou o destino e deixou as duas regras convivendo em
seções diferentes. Contradição apontada e removida na rodada 3 — existe **um** ledger de dossiê, e é
`dossies.json`. Não existe `kind: "dossie"` em lugar nenhum.)*

2.4 **Cache por nó, não por fluxo.** Cada parágrafo carrega uma **impressão digital** do nó que
descreve. Isso é obrigatório, não otimização: medido 2026-08-13, `Agente Iago Comercial` e
`Agente eContrate` foram editados **hoje**. Um cache por fluxo venceria diariamente nos dois fluxos
mais caros, e o dossiê custaria mais do que economiza.

2.4.1 **A impressão digital não é só o JSON do nó** — corrigido na rodada 1 da revisão. Hash apenas
do nó deixa passar o caso que mais importa: um `rewire` entre nós que já existem muda a topologia sem
alterar um byte de nenhum nó, e a frase *"o `Code_montar_payload` recebe do buffer"* fica falsa com
todos os hashes intactos. A impressão é `SHA-256` de:
- o JSON do próprio nó (sem `credentials`, sem `position`, sem `id`);
- a **assinatura de adjacência**: nomes de quem entra e de quem sai, **com porta e ramo**, em ordem
  canônica (é o que pega `rewire`, troca de ramo em `switch`, e reordenação de saída);
- um hash **global** de `connections` e de `settings` do workflow, carregado no cabeçalho do dossiê
  (é o que pega mudança de `executionOrder`, `errorWorkflow` e `timezone`, que alteram o
  comportamento de todo parágrafo sem tocar nó nenhum).

Divergência no hash global invalida o dossiê **inteiro** — vermelho, não laranja. Um contexto de
execução diferente reescreve o significado de tudo que está lá.

2.5 **Semáforo por divergência, nunca por data.** O tempo não decide: dossiê de 30 dias de um fluxo
estável há 48 está correto; dossiê de 2 horas de um fluxo editado há 10 minutos está errado. Mesma
disciplina de `fixState()`, que compara **id de execução e não o relógio**, e do cache do esquema,
que é por **mtime e não TTL**.

| Cor | Estado | Regra |
|---|---|---|
| `--ok` verde | em dia | zero nós divergentes |
| `--warn` laranja | N nós mudaram | 1 ≤ N ≤ 25% dos nós, **e** nenhum nó entrou ou saiu |
| `--risk` vermelho | desatualizado | N > 25% **ou** qualquer nó adicionado/removido |
| `--cold` cinza | sem dossiê | nunca escrito |

2.6 **Nó adicionado ou removido vai direto para vermelho.** A frase *"os nós 12–19 são o buffer"*
fica falsa quando entra um nó no meio, mesmo com os oito originais intactos. Topologia mudou, o mapa
mudou.

2.7 **Cinza nunca é vermelho.** Nunca escrito e desatualizado levam a decisões opostas. Regra já
paga três vezes neste repo: `docAgentes` ausente lido como negativo, `usd: 0` de rodada morta,
`Response.json()` sobre corpo `404`.

2.8 **Atualizar é botão, com o preço nele:** `↻ atualizar dossiê · ~US$0,14 (2 nós)`. Nada regenera
sozinho, nem barato — gastar sem clique é o que este codebase recusa em todo lugar.

2.9 **Laranja é entregue à sessão com os parágrafos suspeitos marcados**; ela lê o JSON real
daqueles nós. **Vermelho não é entregue**: cai para `nodes-index.md`. Pagar a leitura cara é melhor
que patchar a partir de descrição errada.

2.10 **Gitignored.** Derivado do n8n e regenerável; um `.md` velho rastreado parece fonte e é
lembrança. Mesma razão de `.cache-tester-docs/`.

2.11 **Exibido para Kauan na tela do fluxo, com duas etiquetas obrigatórias:** escrito por um
modelo, e a partir da versão de tal data. Descrição gerada exibida como fato é exatamente a mentira
que este projeto não conta.

### 3. A conversa

3.1 **Contrato reusado do modo `edicao` do Tester.** `resposta.json` sai como
`{"tipo":"resposta"}` **ou** `{"tipo":"patch"}`, e o prompt **exige** o primeiro quando o pedido é
ambíguo — perguntar de volta é mais barato que patchar errado e mais honesto que adivinhar. Sem
estágio de entrevista com rodada fixa: as seis dimensões que o Tester persegue já estão escritas no
documento, e perguntar sobre elas leria como não ter aberto o fluxo.

3.2 **`{"tipo":"resposta"}` faz dois trabalhos:** perguntar de volta, e **responder** pergunta dele
sobre um nó (*"por que esse nó tem retry?"*). A conversa é sobre os nós, não só ditado de ideia.

3.3 **O modelo pode contestar.** Pedido explícito de Kauan: *"ahh, isso não vai funcionar por causa
de x e y"* é resposta legítima e vai no prompt como comportamento esperado.

3.4 **Duas etapas para achar onde plugar.** No caminho de correção o alvo é conhecido; aqui a frase
o nomeia em prosa.
- **Etapa 1**: a sessão lê o dossiê (ou o índice de 13KB) e responde *"vou mexer em X e adicionar
  2 nós depois de Y"*. O cockpit **acende esses nós no desenho** e Kauan confirma ou corrige.
- **Etapa 2**: recebe `target-nodes.json` (`targetNodes` de `claude-fix.js`: alvos mais vizinhos de
  um salto) com o valor **exato** dos campos, e escreve o patch.

Medido: 13KB contra 285KB, 22×. E o checkpoint da etapa 1 é o mais barato que existe.

3.5 **O prompt viaja em `-p`.** Teto de 24.000 caracteres (`PROMPT_MAX`) e a linha de comando do
Windows morre em 32.767 com `spawn ENAMETOOLONG`, que não nomeia nem prompt nem tamanho. Dossiê,
índice, catálogo e gramática vão para o diretório da run (padrão `escreverContexto`), uma vez por
rodada. `prompt-budget-test.js` ganha o pior caso desta aba.

3.6 **Classe intrinsecamente caro, dita antes.** *"melhora o system prompt do agente"* tem como alvo
um campo de **71.705 caracteres** — ~20k tokens de saída para reescrever. Nenhuma fatia ajuda: o
campo é o alvo. A tela avisa **antes**, não depois.

3.7 **A tela é a janela, e o desenho tem câmera.** Medido 2026-08-14: o cartão crescia com o
conteúdo, sobrava meia janela vazia embaixo, e o desenho de 189 nós era uma faixa de 98px. O ajuste
óbvio — aumentar a tela — **não resolve, e a conta diz por quê**: o fluxo do Iago é um retângulo de
`24064×3368` unidades (razão **7,14**), então cada nó rende `84·(largura/24064)` — **2,4px** numa
coluna de 700px e **5,2px** na largura inteira de 1500px; o nome do nó, 20 unidades, sai a 0,6px e
1,2px. Dobrar a tela leva o nó de 2,4 para 5,2 pixels. Quem resolve é escala própria mais poder
andar: roda, arraste, `⤢ caber`, `+`/`−`, setas e `0` no teclado, e um marcador que diz **quantos
pixels o nó está medindo agora** — é o número que transforma "está pequeno" em observação
verificável.

Duas escalas nomeadas, e as duas são decisão: `ESC_FORMA` (0,28), de onde o nó se reconhece como nó,
e `ESC_NOME` (0,50), de onde o nome se lê. A abertura sai disso: **se caber inteiro já passa de
`ESC_FORMA`, abre cabendo** — a forma do fluxo é a informação mais útil que existe de graça; se não
passa, abre em `ESC_NOME` na porta do fluxo, porque um desenho de 5px é uma imagem de poeira e
parece página quebrada. O eixo vertical entra pelo meio do que está na janela horizontal, não pelo
`y` do gatilho (centrado no gatilho, metade da caixa ficava vazia). E a borda esquerda da abertura é
a do **mundo**, não a do primeiro nó: `palco()` reserva `padX` ali porque o rótulo é centrado e
transborda, e entrar por dentro dessa folga cortou `executeWorkFlowTrigger` em `cuteWorkFlowTrigger`.

**Alvo novo faz a câmera voar até ele** — é a resposta ao que ele acabou de pedir, e o único
movimento nesta tela com informação nova atrás; o mesmo alvo repetido não voa, porque o SSE repinta
a coluna várias vezes por rodada. O voo tem **teto próprio** (`ESC_ALVO`, 0,8): enquadrar dois nós
vizinhos dava escala enorme e o voo parava em nó de **185px** — dois retângulos gigantes e nenhuma
vizinhança à vista, o contrário do que "onde isso vai mexer" pergunta. Na roda o teto continua sendo
`ESC_MAX`, porque aproximar à mão é pedir para chegar perto. A câmera vive em `S.cam` chaveada pelo
desenho, pela mesma razão que a do Tester: o SSE repinta a coluna e uma câmera perdida a cada evento
jogaria fora o enquadramento no meio da leitura.

3.8 **Três layouts, escolhidos em print, e a URL é o comutador.** `?layout=duas|pilha|foco` troca sem
editar nada — é assim que os três foram comparados, e é por isso que **não existe gerador de preview
para esta tela**: cada variante está a uma URL de distância na tela de verdade, e uma cópia num
arquivo separado só teria a chance de divergir dela (o preview do filtro do feed foi apagado depois
de servir, pelo mesmo motivo). Medido a 1460×900:

| layout | caixa do desenho | nós num relance | compositor |
|---|---|---|---|
| `duas` (padrão) | 807×593 | 8 | 546px |
| `pilha` | 1386×295 | 13 | 728px |
| `foco` | 1032×593 | 10 | 322px |

`duas` é o padrão porque **altura é o que a conversa e o alvo pedem**: 593px dão contexto vertical do
alvo e dos ramos que saem dele, contra 295px da `pilha`, e o compositor cabe sem aperto — a `foco`
comprime para 322px o campo onde se escreve um pedido de parágrafo. A `pilha` mostra 13 nós de uma
vez e é a melhor para **ler** o fluxo inteiro. As três mantêm conversa e desenho visíveis ao mesmo
tempo de propósito: o alvo acendendo é o retorno do que ele escreveu, e esconder um dos dois quebraria
esse par.

Só a conversa rola; alvo, banda de estado, compositor e custo ficam presos — descer atrás do campo de
escrever era metade do espaço mal usado. Três defeitos que apareceram nos prints e não nos números:
com um alvo proposto na `pilha`, a pilha de blocos presos passava dos 295px e a conversa era espremida
a **zero** (piso de 104px, e o que não couber transborda com a coluna rolando); `width: min(100%, 90ch)`
na `pilha` desalinhou o cabeçalho da seção do compositor, porque **`ch` mede na fonte do próprio
elemento** (12px contra 15px) — é `px` agora; e mensagem nova nascia fora da vista, então
`rolarConversa()` rola até o fim **quando a contagem muda**, nunca a cada evento do SSE.

### 4. O patch

4.1 **Três verbos, importados de `claude-fix.js`:** `updateNodes`, `addNodes`, `rewire`.

4.2 **Sem verbo de delete, e isso é a garantia de produção.** O `removeNodes` do Tester existe
porque lá o alvo é rascunho de Kauan. Aqui o alvo é produção. Tirar nó do caminho é
`disabled: true` mais o `rewire` que costura o buraco. `claude-fix.js` não é tocado.

4.3 **`[PREENCHER]` é vermelho, sempre — e é PORTÃO NOVO, não regra existente.** Corrigido na
rodada 1: nem `validate()` nem `applyPatch()` rejeitam placeholder hoje, e o plano tratava isso como
se já estivesse coberto. `portaPreencher()` varre **apenas os parâmetros tocados pelo patch**
(recursivo, string em qualquer profundidade) e reprova qualquer `[PREENCHER]`, `[FILL]`, `TODO:` ou
`<...>` nomeando o nó e a chave. No Tester o marcador é inofensivo num JSON importado à mão; aqui iria
escrito para dentro de produção — nó que roda e faz a coisa errada em silêncio. Se o modelo não sabe o
nome da tabela, ele **pergunta**.

4.4 **`applyPatch` já recusa** campo desconhecido de nó, qualquer chave `credentials` e troca de
`type`, e o erro nomeado volta para o modelo em vez de virar proposta ruim. Isso é o que ele **já**
faz — a lista acaba aí, e `[PREENCHER]` não está nela.

4.5 **Resolução de alvo pai/filho é OBRIGATÓRIA e vem antes do patch.** Promovido de "questão aberta"
para etapa na rodada 1, porque não é detalhe de interface: é seleção de alvo, e um upgrade pode
remendar o **pai errado** sem nunca tocar o filho de verdade. O caminho de correção resolve isso com
`followSubWorkflow`, guiado pela assinatura de erro; um upgrade não tem assinatura. Então a etapa 1
tem de responder **em qual workflow** cada nó alvo vive, usando `locateNode`/`callers` já existentes,
e:
- alvo no fluxo aberto → segue;
- alvo num filho → a run **troca de alvo**, e a tela leva a mesma tarja que o caminho de correção já
  usa (`redirected`): *"o diff abaixo é do fluxo X, aprovar escreve nele, não em Y"*;
- alvo ambíguo (dois filhos com nó de mesmo nome — **medido**: `Convert text to speech` existe em
  `Agente Iago Comercial` **e** `Agente eContrate`) → **recusa continuar** e pergunta qual. Sem
  assinatura de erro não há `lastNodeExecuted` para desempatar, então aqui não há evidência para
  escolher, e escolher seria escrever no fluxo errado.

4.5.1 **`locateNode` e `callers` NÃO são exaustivos, e incompletude cai para seleção manual
bloqueante.** Corrigido na rodada 2. `locateNode` faz **um salto** e para em `SUBFLOW_SCAN_CAP = 6`
candidatos; `callers` reporta `falhas` justamente porque com leitura incompleta *"nada chama esse
fluxo"* deixa de ser afirmação que o painel pode fazer. Numa árvore maior a resposta pode voltar
`local` ou `não achei` **sem evidência suficiente** — e "não achei" tratado como "é aqui" escreve no
pai errado, que é o defeito exato que 4.5 existe para impedir.

Então qualquer **cap batido, falha de leitura ou resultado incompleto** na resolução de alvo →
**seleção manual bloqueante**, com a lista do que foi lido e do que não foi. Nunca decisão automática.
Mesma disciplina da lista colapsada em `flows.html`, que diz que pode estar escondendo um sub-fluxo de
produção enquanto o call graph não chegou.

### 5. `[ VERIFICANDO UPGRADE ]` — a bateria de sete

Tela própria, sete linhas acendendo uma a uma.

| # | Checagem | Fonte | Pode ser cinza? |
|---|---|---|---|
| 1 | Estrutura | os 10 portões de `validate()` | não |
| 2 | Esquema do nó | `esquema.js`, 810 tipos | **sim** — checkout sem `.n8n-pkgs/` |
| 3 | Gramática | `n8n-gramatica.md` (o `=` na frente, formas compostas) | não |
| 4 | Credencial **referenciável pelos fluxos atuais** | `catalog.credenciaisConhecidas` + `ligacaoCredenciais` | **sim** |
| 5a | **Regressão de caminho** | `runData` das execuções da janela | **sim** — fluxo sem execução |
| 5b | Regressão de conteúdo (fantasma) | `simulate.js` antes/depois | **sim** — 63% dos fluxos |
| 6 | Impacto medido | execuções que passam pelos nós tocados | é número, não veredito |
| 7 | Aceite do n8n | `PUT` em `[SANDBOX upgrade] <nome>` inativo | **sim** — quando desligado |

5.1 **Cinco estados de cor, e o botão tem uma regra de uma frase.**

| Cor | Estado | Bloqueia? |
|---|---|---|
| `--cold` cinza | não dá para conferir aqui, **com o motivo escrito** | não |
| `--accent` indigo | conferindo agora (transitório) | **sim** |
| `--ok` verde | conferido, passou | não |
| `--warn` laranja | passou, **com ressalva medida** ("mexe em nó com 645 execuções hoje") | não |
| `--risk` vermelho | conferido, reprovou | **sim** |

**O botão aparece quando não há vermelho e nada está mais rodando.**

5.2 **Movimento é `--accent`, não `--warn`.** Laranja neste produto significa *"passou, mas você
precisa saber disso"*, e esse papel carrega a informação que decide o clique. Gastar laranja em
"ainda vou conferir" mataria o papel.

5.3 **"Reprovou" e "não se aplica" não são a mesma luz.** Medido 2026-08-13 na instância viva: dos
73 fluxos, **46 (63%)** contêm tipo que o fantasma recusa por princípio (`code`, `merge`,
`splitInBatches`, `switch`, `langchain`); **dos 32 fluxos com 10+ nós, 29 recusam (91%)**. Os
simuláveis são cópias `[SANDBOX tester]`, `My workflow` e tools de 2–6 nós. Uma regra literal de
"todos os sete verdes" faria a aba **nunca aplicar em nenhum agente** — 3 fluxos descartáveis de
cobertura. A regra em vigor é: **toda checagem aplicável verde, e a tela diz quais não se aplicaram
e por quê.**

5.4 **5a é continuidade estrutural mínima — e NÃO é a proteção principal.** Corrigido na rodada 1:
a redação anterior vendia como proteção o que é um piso. 5a é **medida, não simulada**: para cada nó
com tráfego na amostra — continua existindo, mesmo `type` e `typeVersion`, **mesma aresta
alimentadora** (`task.source[0]`, primeiro não-nulo), e as saídas que carregavam tráfego seguem
ligadas. Roda no Iago de 179 nós, onde o fantasma nunca rodou.

**O que 5a estruturalmente NÃO pega**, e a linha na tela precisa dizer: mudança de parâmetro dentro
de um nó que continua no mesmo lugar, inserção de nó no meio de um caminho preservado, e troca de
semântica sob o mesmo `type`/`typeVersion`. Ou seja: 5a prova que o **encanamento** continua ligado,
nunca que a água que passa por ele é a mesma.

5.5 **5a lê uma AMOSTRA, e amostra que não cobre o alvo não pode dar verde.** Saber quais nós rodaram
exige `runData` por execução, e `WhatsApp API Oficial` fez 751 execuções em 24h — buscar todas é
multi-MB × 751. A amostra é: **todas as execuções com erro da janela** mais as **N mais recentes
bem-sucedidas** (N inicial 5), união dos nós, reusando `S.details` já carregado antes de buscar.

**Regra corrigida na rodada 1, e é a que fecha o verde falso:** se **qualquer** nó ou aresta tocada
pelo patch não aparecer na amostra, 5a tenta **uma expansão automática** (mais `N_EXPANDIDO` = 20
execuções bem-sucedidas, preferindo as que passaram por nós vizinhos ao alvo). Se ainda não aparecer,
**5a fica CINZA, nunca verde** — a checagem não olhou o caminho que está sendo mexido, e "não olhei"
não pode se vestir de "está bom". A linha carrega quantas execuções foram lidas e quais alvos ficaram
fora.

5.6 **`recusaFantasma()` intercepta antes de `simulate.js`** em fluxo de agente, para a linha 5b
dizer *"a resposta é escrita por um modelo"* em vez de *"expressão fora do subconjunto"* — que
mandaria Kauan caçar problema de expressão que não existe. Não gasta chamada de modelo com sementes
que ninguém leria.

5.7 **A linha 4 pode ficar CINZA, e a redação anterior mentia sobre o que ela sabe.** Corrigido na
rodada 1. `GET /credentials` responde **405** nesta instância: não existe inventário da conta. O que
`credenciaisConhecidas` carrega é o subconjunto **referenciado pelos fluxos existentes**, e
`ligacaoCredenciais()` escolhe por tipo e contagem de uso — nunca prova que a credencial existe na
conta, que está autorizada, nem que é a conta certa. Então:
- **verde** só quando existe candidato único referenciável **e** o nó já vinha com credencial anexada
  antes do patch (nada novo a decidir);
- **cinza** quando a evidência do catálogo é incompleta (tipo de credencial que nenhum fluxo dele usa)
  — e aí a decisão é dele, no desempate que já existe;
- **vermelho** só quando o patch escreve nó novo que **exige** credencial e há **zero** candidatos:
  campo vazio num fluxo vivo falha na primeira execução.

5.7.1 **Nó NOVO que exige credencial é VERMELHO por padrão, e a única saída é ele entrar fora de
tráfego.** Corrigido na rodada 2, e o achado é certo: `applyPatch()` **proíbe** qualquer chave
`credentials`, e essa proibição é garantia de produção que não vai ser afrouxada. Logo o patch **não
tem como** anexar credencial — e a aba Upgrade não tem o `escolherCredencial` do Tester para anexar em
produção. Com cinza não bloqueando, o plano da rodada 1 permitia aplicar num fluxo vivo um nó que
falharia na **primeira execução**. Então:

- nó novo que exige credencial → **vermelho**, e o botão de aplicar normal não aparece;
- a única saída é um botão **distinto**, `✓ Aplicar com o nó novo desligado`, que escreve o nó com
  `disabled: true` e **não faz o `rewire`** — fora do caminho, portanto incapaz de disparar com campo
  vazio. A tela diz o que falta: anexar a credencial no n8n e ligar o nó.

5.7.2 **Esse caminho é um SEGUNDO PATCH, com diff próprio e bateria própria.** Corrigido na rodada 3, e
é o achado mais grave das três rodadas. O repo tem exatamente um contrato coerente —
*patch → diff mostrado → escrita idêntica ao diff* — e um botão que aplica "o mesmo patch, mas com o nó
desligado e sem religar" **não é o patch que passou pelos portões**. Do jeito que a rodada 2 escreveu,
esse botão aplicaria algo diferente do que estava na tela, ou reusaria veredito de portão rodado sobre
outro documento. Qualquer um dos dois quebra a única garantia que o approve dá.

Então `patchDesligado` é derivado por **código** a partir do patch original (`disabled: true` nos nós
adicionados, `rewire` removido), e a partir daí é tratado como proposta independente:

1. `applyPatch` roda sobre ele;
2. a **bateria de sete roda de novo** sobre o documento resultante — em particular a 5a, porque um nó
   que não religa tem impacto diferente no caminho trafegado;
3. `diffWorkflow` produz **o diff dele**, que é o que aparece na tela sob esse botão;
4. `escreverAprovado()` recebe **esse** patch, com o `capturedUpdatedAt` da mesma leitura.

Os dois patches coexistem na run e **nunca compartilham veredito de portão**. A tela mostra um de cada
vez, com o diff correspondente — dois diffs lado a lado num único ecrã de aprovação seria a forma mais
rápida de alguém aprovar o que não leu.

Isso é o "aplicar desligado" da opção rejeitada em `[02]` voltando **restringido ao único caso em que
ele é a resposta certa**, em vez de política geral. Reusa `disabled: true`, que já é o mecanismo que
substitui delete aqui.

**Cinza com desempate segue valendo apenas para nó que JÁ TINHA credencial** e cuja escolha de conta é
ambígua — ali não há campo vazio possível, o nó continua com o que tinha, e recusar por causa de
escolha de conta seria fechar a porta quando bastava perguntar.

5.8 **7 passa a ser LIGADO por padrão nesta aba** (`COCKPIT_UPGRADE_SANDBOX=1`), ao contrário do
caminho de correção. Mudou na rodada 1, e a razão é a assimetria dos alvos: uma correção repara fluxo
**quebrado**, um upgrade escreve nó novo em fluxo **saudável e trafegado**. A cópia
`[SANDBOX upgrade] <nome>` é inativa e sem credencial, e é a única evidência que vem da instância.
Desligado explicitamente, a linha diz `○ teste na instância desligado` — ausência não pode ler como
sucesso.

5.9 **Chave de `settings` descartada é uma MUDANÇA e entra no diff.** `pickSettings()` existe porque
o editor do n8n grava chaves que o schema público recusa (`timeSavedMode`, medido em **5 dos 10
fluxos ativos**), e um `PUT` **substitui `settings` por inteiro** — chave descartada é chave
**removida do fluxo**. Ela nunca esteve no diff que Kauan aprovou. Corrigido na rodada 1: as chaves
descartadas aparecem no diff como **remoção explícita**, na mesma tela, antes do clique.

5.9.1 **Chave descartada é CLASSIFICADA, e desconhecida bloqueia.** Revisado na rodada 2, contra a
minha própria recusa da rodada 1. O contra-argumento do revisor está certo no que importa: a medição
de `timeSavedMode` em 5 dos 10 fluxos ativos prova **prevalência, não inocuidade**, e num `PUT` que
substitui `settings` inteiro prevalência alta aumenta o raio, não reduz. Meu argumento era sobre
cobertura, não sobre segurança, e cobertura não vence perda silenciosa de comportamento.

O que separa os dois casos é **qual** chave cai. As que carregam comportamento —
`executionOrder`, `errorWorkflow`, `timezone`, `callerPolicy`, `executionTimeout` — estão **dentro** de
`SETTINGS_ALLOWED` e nunca são descartadas. O que cai são chaves que o openapi da instância não
conhece. Então:

- **Lista de descarte conhecido-inócuo**, hoje com exatamente **um** membro medido: `timeSavedMode`
  (métrica de painel do editor, sem efeito de execução). Descarte dela → linha explícita no diff,
  **não bloqueia**.
- **Qualquer outra chave descartada bloqueia o apply**, vermelho, nomeando a chave. Não sabemos o que
  ela faz, e uma versão futura do n8n pode gravar chave com comportamento antes do openapi acompanhar
  — que é exatamente como esta armadilha nasceu.
- Mesmo no caso inócuo, o reconhecimento é **separado do botão principal**: `confirmar()` com
  `perigo: true`, dizendo qual chave sai do fluxo. Uma remoção que nunca esteve no diff aprovado não
  pode viajar de carona no clique de aplicar.

Entrar chave nova nessa lista exige **medir o que ela faz**, nunca observar que ela é comum.

### 6. Aplicar

6.1 **NÃO reusa `approve()` — extrai um primitivo compartilhado.** Corrigido na rodada 1: `approve()`
é acoplado ao ciclo de vida do `claude-fix` (`runs.get(runId)`, `status === "ready"`,
`run.capturedUpdatedAt`, `buildProposal(run, current)`, `backupPath(run)`, o store dele), e "reusar
inteiro" era falso. O que se extrai é `escreverAprovado({ wfId, capturedUpdatedAt, patch, backupPath,
onSettingsDropped })`, que faz a sequência que importa e não conhece run nenhuma:

1. re-busca o workflow;
2. **recusa se `updatedAt` mudou** — o diff na tela deixou de descrever o que aconteceria;
3. reaplica o patch ao documento **atual**, não à cópia de quando a proposta nasceu;
4. roda os portões de novo (valem no momento de aplicar, não só no de propor);
5. grava o backup fora do cwd da sessão;
6. `PUT` com o corpo montado campo por campo.

`claude-fix.js` passa a chamar esse primitivo no lugar do corpo atual de `approve()` — mesma
sequência, mesma ordem, mesmos 409 — e a aba Upgrade monta a máquina de estado dela em cima. **Uma
segunda cópia dessa sequência é inaceitável**: é o único caminho de escrita em produção, e duas cópias
divergem no primeiro conserto feito num lado só.

6.2 **`active` nunca é enviado**, e o corpo é montado campo por campo (`name`, `nodes`,
`connections`, `settings` via `pickSettings`) — nunca spread. Aplicar um upgrade não pode acordar
fluxo dormente.

6.3 **Escrita não é repetida.** `PUT` que falhou prova ausência de confirmação, não ausência de
efeito. Só `GET` tem retry.

6.4 **`↺ Desfazer`** restaura o backup, igual ao caminho de correção.

6.5 **Mutex process-wide no caminho de ESCRITA de `n8n.js`, não uma terceira trava de aba.**
Corrigido na rodada 1: a "trava compartilhada" que o plano prometia **não existe**. `claude-fix.js`
serializa só as runs dele (`let active`), `tester.js` serializa só as sessões dele, e não há nada
envolvendo todos os `PUT`/`POST` na instância — hoje um build do Tester pode escrever a cópia sandbox
no mesmo instante que um approve escreve um fluxo vivo. A trava desce para `putWorkflow` e
`createWorkflow`, uma fila process-wide, com o motivo do dono corrente no erro:
*"esperando: aplicando correção em X"*.

**Cuidado que a implementação tem de respeitar:** o próprio caminho de approve escreve duas vezes
(cópia sandbox na checagem 7, depois o fluxo vivo). O mutex é **reentrante por dono** ou a checagem 7
travaria contra o próprio approve dela. Um teste tem de provar isso, porque o sintoma seria um deadlock
que só aparece com a checagem 7 ligada — que é o novo padrão desta aba.

6.5.1 **"Extrair o mutex primeiro" não era etapa segura, e virou duas etapas.** Corrigido na rodada 3.
`putWorkflow(id, w, onDropped)` e `createWorkflow(w, onDropped)` **não recebem token de dono nenhum**
hoje, e já são chamadas de **seis** lugares em produção — contagem corrigida na rodada 4, que a pegou
subcontada em cinco, e verificada por `grep`:

| Call site | O que escreve |
|---|---|
| `claude-fix.js:929` | `putWorkflow` — cópia `[SANDBOX cockpit]` reusada por nome |
| `claude-fix.js:931` | `createWorkflow` — a mesma cópia, na primeira vez |
| `claude-fix.js:1324` | `putWorkflow` — **o approve**, o fluxo vivo |
| `claude-fix.js:1360` | `putWorkflow` — o `↺ Desfazer` |
| `tester.js:998` | `putWorkflow` — cópia `[SANDBOX tester]` reusada |
| `tester.js:1001` | `createWorkflow` — a mesma cópia, na primeira vez |

A aba Upgrade acrescenta duas (a cópia `[SANDBOX upgrade]` e o approve dela), então a etapa 0 tem de
fechar as seis **antes** de existir a sétima. Ligar um mutex "por dono" antes de existir dono é ligar um
mutex que não sabe distinguir reentrância de disputa — exatamente o deadlock que o teste deveria pegar,
introduzido pela própria etapa que deveria ser a segura.

**Etapa 0**: acrescentar `writeOwner` na assinatura das duas funções e **preencher em todos os call
sites atuais**, sem trava nenhuma ligada. Nada muda de comportamento; é encanamento, e um teste prova
que todo call site passa dono não-vazio.
**Etapa 1**: só então ligar a fila, reentrante por dono.

Nessa ordem cada etapa é reversível sozinha. Na ordem anterior, a primeira já podia travar produção.

`retryExecution` **fica fora do mutex**: não escreve documento, e serializar um efeito que já é
recusado em duplicidade só esconderia a fila.

### 7. Ledger e navegação

7.1 **Uma linha por run em `proposals.json`, com campo `kind: "fix" | "upgrade"`.** Corrigido na
rodada 1: a justificativa anterior (*"linhas sem assinatura quebrariam `estimate()`"*) era **falsa** —
`estimate()` só lê `startedAt`/`finishedAt` e nunca toca a assinatura. Verificado no código. Separar
teria fragmentado histórico sem motivo, e o próprio `CLAUDE.md` já registra o desejo oposto: *"um único
log de eventos faria «o que fizemos sobre essa falha» ser uma consulta em vez de duas"*.

7.1.1 **TODO consumidor de `proposals.json` filtra por `kind`, e o cap é POR kind.** Ampliado na
rodada 2: falar só de `estimate()` era insuficiente. O store tem `STORE_CAP = 60` e `rehydrate()`, e
sem filtro total uma sequência de upgrades **expulsa histórico de correção** — silenciosamente, porque
o cap corta o fim da lista e ninguém é avisado.
- `estimate(kind)` filtra: uma rodada de upgrade num fluxo de 179 nós não dura o que dura uma correção
  (mediana medida ~183s), e misturar faria a barra mentir **nos dois lados**. Com menos de
  `ETA_MIN_SAMPLES` (3) daquele tipo, `samples: 0` e barra listrada indeterminada — comportamento
  honesto que já existe.
- `rehydrate()` filtra: uma proposta de upgrade reidratada volta como `ready` e tem de recusar
  reexecução até ser aplicada de novo, igual à de correção.
- `STORE_CAP` é aplicado **por `kind`**, nunca ao total.

7.1.1.1 **`kind` ausente lê-se como `"fix"`, e essa regra vem ANTES de qualquer filtro.** Corrigido na
rodada 3: as linhas que já estão em `proposals.json` hoje **não têm `kind`**, então sem regra de
migração o primeiro filtro escolhe entre perder todo o histórico de correção já acumulado ou misturar
legado de forma arbitrária — e o histórico é o que alimenta a mediana do ETA que já está na tela.
`kindDe(p) = p.kind || "fix"`, aplicado na leitura do store, uma vez, antes de `estimate`, `rehydrate` e
do cap. Sem migração de arquivo: linha antiga continua válida como está.

É a mesma regra que este repo já pagou três vezes por violar — **campo ausente nunca cai no ramo
negativo** — aplicada agora a um arquivo em vez de a uma tela.

7.1.2 **O custo do dossiê NÃO entra em `proposals.json` — vai para `dossies.json`.** Revisado na
rodada 2. Um dossiê não é proposta: não tem portão, não tem diff, não tem decisão de aplicar e não há
nada para reidratar. Enfiá-lo no store das propostas o faria disputar `STORE_CAP` com o histórico real
e poluir `rehydrate()`. `dossies.json` é rastreado no git, minúsculo, append-only:
`{wfId, em, nosRegenerados, ms, usd | usdDesconhecido}`. É o registro do gasto **recorrente** que esta
aba introduz, e é o único lugar onde ele existe — o `.md` é gitignored, então guardar o custo lá dentro
o perderia na primeira limpeza de cache.

7.2 **Quarta porta na cápsula de navegação.** Ícone desenhado (viewBox 24, stroke 1.9,
`currentColor`), atalho `alt 4`, e a lente de vidro passa a ter quatro destinos. O CSS/JS é
**gerado** por `preview/aplicar-nav.js` e escrito nas páginas; `nav-sync-test.js` exige blocos
byte-idênticos, uma ocorrência por arquivo, `href` que o `server.js` serve de fato, e o atalho
existindo. Regenerar as **quatro** páginas no mesmo commit.

7.3 **Dívida conhecida que esta aba agrava:** a topbar de `/tester` e `/disco` já transborda 32px e
13px a 390px. Uma quarta porta piora. Não é escopo desta aba consertar, mas tem de ser dito.

### 8. `CLAUDE.md` é atualizado ANTES do código

O bloco **"Locked decisions → Write boundary"** enumera o que o cockpit pode escrever, e hoje diz que
é um diff aprovado (mais a reexecução, de outra natureza). Este plano acrescenta **três** coisas a
esse enumerado, e sem atualizar o documento a fronteira passa a mentir sobre onde o cockpit escreve —
que é o pior lugar deste repo para um documento estar errado. Corrigido na rodada 2, e é passo de
plano, não tarefa de acabamento:

1. **Upgrade de fluxo vivo**, sob as mesmas cinco condições do diff aprovado, mais a bateria de sete.
2. **A cópia `[SANDBOX upgrade] <nome>`**, inativa e sem credencial — segunda instância da exceção que
   o Tester já abriu, e agora **ligada por padrão**.
3. **`aplicar com o nó novo desligado`**, que escreve nó com `disabled: true` e sem `rewire`.

Entra junto: o mutex process-wide no caminho de escrita (muda a garantia de concorrência que o
documento descreve), `escreverAprovado()` como o único caminho de escrita aprovada, e a linha nova na
tabela de arquivos para `dossies.json` e `.cache-fluxos/`.

### 9. Testes

- `upgrade-test.js` — a máquina de estados da bateria: cada cor, a regra do botão numa frase, cinza
  nunca caindo no ramo negativo, laranja não bloqueando, indigo bloqueando.
- `dossie-test.js` — divergência: nó alterado dá laranja, nó adicionado dá **vermelho**, 26% dá
  vermelho, zero dá verde, ausente dá cinza; e **nenhum valor de parâmetro chega ao `.md`**.
- `regressao-test.js` — 5a: aresta alimentadora rompida reprova; nó com tráfego removido reprova;
  fluxo sem execução na janela dá **cinza e não verde**; a amostra é reportada.
- `prompt-budget-test.js` — pior caso desta aba (dossiê + índice + catálogo + gramática) cabendo na
  linha de comando.
- `nav-sync-test.js` — quatro páginas, quatro portas.
- `caractere-test.js` — os arquivos novos entram na varredura de caractere de controle.

Três casos que a rodada 2 tornou críticos e que não estavam cobertos:

- **`mutex-test.js` — reentrância no approve com a checagem 7 LIGADA.** O approve escreve duas vezes
  (cópia sandbox, depois o fluxo vivo). Um mutex não reentrante trava contra si mesmo, e o sintoma é
  deadlock que só aparece com a checagem 7 ligada — que é o **novo padrão** desta aba. O teste prova
  também que uma segunda escrita de outro dono espera em vez de intercalar, e que o erro nomeia o dono
  corrente.
- **`ledger-kind-test.js` — filtro por `kind` em todo consumidor.** `estimate` só olha o próprio tipo;
  `rehydrate` não devolve upgrade como correção; e **60 upgrades não expulsam o histórico de
  correção** (`STORE_CAP` por `kind`). O mutante que tem de falhar é remover o filtro de um consumidor
  só — o defeito é silencioso e o cap corta sem avisar.
- **`credencial-nova-test.js` — nó novo que exige credencial.** Vermelho por padrão; o botão de aplicar
  normal não aparece; a saída `aplicar com o nó novo desligado` escreve `disabled: true` **e não faz o
  `rewire`**; e nó que **já tinha** credencial com escolha ambígua fica cinza com desempate, sem
  bloquear. O mutante que tem de falhar é o `rewire` viajando junto com o nó desligado — que
  reintroduz o campo vazio no caminho de tráfego.

## Key decisions & tradeoffs

1. **Alvo é o fluxo vivo, não cópia nem rascunho.** Escolha de Kauan, contra a recomendação inicial
   de promover a partir de cópia `[UPGRADE]`. O preço: entre aplicar e perceber, produção roda o
   upgrade que ninguém executou. Mitigação é a bateria mais o backup mais `↺ Desfazer`, **não** um
   estágio de teste — porque estágio de teste não existe nesta API.

2. **"Aplicar desligado" foi rejeitada como POLÍTICA GERAL e voltou como caminho RESTRITO.** Corrigido
   na rodada 4, que apontou este parágrafo contradizendo §5.7.2. A proposta original era que todo nó
   novo entrasse com `disabled: true` sempre que houvesse incerteza, e Kauan a superou em `[02]` ao
   escolher "a bateria destrava o botão" — essa rejeição continua valendo, e é por isso que o caminho
   normal aplica ligado.

   O que voltou, na rodada 2, é o **único caso em que desligar é a resposta certa**: nó novo que exige
   credencial. `applyPatch()` proíbe `credentials` — garantia de produção que não será afrouxada —
   então o cockpit **não tem como** anexar a credencial, e o nó ligado falharia na primeira execução.
   Ali ele entra `disabled: true` e sem `rewire`, como **segundo artefato com diff e bateria próprios**
   (§5.7.2), nunca como variação do patch aprovado.

   Ambiguidade de **conta** num nó que já tinha credencial é outra coisa e não usa esse caminho: fica
   cinza com desempate, porque não há campo vazio possível.

3. **"Testes internos" não existem e o plano não finge.** Sem endpoint de execução na API pública.
   `n8n execute` do CLI lê o **banco** da instância e n8n Cloud não dá shell nem chave; n8n local
   bate em quatro paredes (credencial não vem da API; recriar as 16 significa executar de verdade e
   mandar mensagem para lead real; nó `slack`/`supabase`/`whatsApp` não aceita trocar host; sem
   `pinData` o fluxo morre no nó 1) mais ~1GB de dependência de runtime num projeto de zero
   dependência.

4. **`POST /executions/{id}/retry` é a única porta de execução — e fica fora da bateria.** Ela
   executa com dado real e credencial real, mas o efeito é real e **não tem undo**. Só como botão
   autorizado clique por clique, depois de aplicado, como a reexecução que já existe. **Não
   verificado:** se aceita retry de execução bem-sucedida — o serviço faz `pop()` no `runData` do
   último nó executado, e numa execução `success` não há nó quebrado. Fecha lendo
   `execution.service.ts`, como este repo já fez antes em vez de medir.

5. **Semáforo por divergência, não por data.** Contra o pedido literal de Kauan ("passou um tempo
   fica com uma cor"), aceito por ele depois do argumento. Data continua **exibida** como contexto.

6. **Custo em faixa, não em dólar.** Some a cara de fatura numa tela que não cobra: o consumo é cota
   de plano.

7. **Cache do dossiê por nó, não por fluxo.** Sem isso o dossiê perde dinheiro nos dois fluxos que
   mais custam, porque são editados diariamente.

## Risks / open questions

1. **O que fica de risco irredutível, dito sem enfeite: um upgrade semanticamente errado passa.**
   Todas as sete checagens podem ficar verdes sobre um patch que faz a coisa errada — muda o parâmetro
   de um nó que continua no lugar, com valor válido, dentro do enum, sem placeholder. Nenhum portão
   estrutural pega isso, e não existe endpoint de execução para pegar. O que sobra contra esse caso é
   o **diff na tela** e o clique dele. É a mesma exposição que o caminho de correção já tem, com uma
   diferença que precisa estar escrita: lá o alvo já estava quebrado, aqui está funcionando. **É a
   decisão consciente de Kauan** (`[01]`), tomada contra a recomendação de promover a partir de cópia.

2. **O dossiê é prosa escrita por modelo e pode estar errado sem divergir.** A impressão digital prova
   que o nó e a vizinhança não mudaram, nunca que a descrição estava correta. Um dossiê errado no
   nascimento fica verde para sempre. Sem resposta boa hoje além da etiqueta na tela e do fato de a
   etapa 2 ler o JSON real dos nós alvo — que é o que impede o erro de prosa de virar patch errado.

3. **Custo real da conversa não foi medido.** As contas do plano são derivadas de bytes ÷ 3,6
   caracteres por token × US$15/Mtok. O primeiro upgrade real de ponta a ponta é a medição, e o
   baseline a comparar é o do Tester: US$3,19 e 818s para 65 nós.

4. **`getDetail` por execução é multi-MB** e `ERROR_DETAIL_CAP` (40) já limita o caminho de erro. A
   amostra de 5a — agora com expansão automática até 20 execuções — soma pressão ao mesmo poll. Ela
   reusa `S.details` antes de buscar, mas o teto combinado dos dois caminhos não foi medido.

5. **Modelo.** `COCKPIT_TESTER_MODELO_BUILD` é `opus` por padrão. Para o dossiê, sonnet basta
   (descrever é mais fácil que escrever 65 nós corretos). Não medido.

6. **Timeout.** `ROUND_TIMEOUT_MS` 6 min e `ROUND_TIMEOUT_AGENTE_MS` 14 min existem porque um agente
   não caberia em 6. Uma rodada de upgrade num fluxo de 179 nós é desconhecida. Rodada morta tem de
   entrar no ledger como **não medida** (`usdDesconhecido`), nunca como zero — a lição já paga.

7. **O mutex process-wide toca `claude-fix.js` e `tester.js`, que hoje funcionam.** Descer a trava para
   `n8n.js` é a correção certa, e é também a única mudança deste plano que mexe em caminho de escrita
   que já está em produção. **Ordem obrigatória, em quatro etapas reversíveis** (a etapa 0 foi
   acrescentada na rodada 3, porque sem ela a primeira etapa já podia travar produção):

   - **0.** `writeOwner` na assinatura de `putWorkflow`/`createWorkflow` e preenchido nos **seis** call
     sites atuais (enumerados em §6.5.1), sem trava ligada. Teste prova dono não-vazio em todos.
   - **1.** `kindDe(p) = p.kind || "fix"` na leitura do store, e o filtro por `kind` em `estimate`,
     `rehydrate` e no cap. Teste prova que 60 linhas novas não expulsam legado.
   - **2.** Extrair `escreverAprovado()` e fazer `claude-fix.js` chamá-lo. A correção e o Tester têm de
     seguir passando **antes** de qualquer linha da aba nova.
   - **3.** Ligar a fila reentrante por dono, com o teste de reentrância sob a checagem 7 ligada.

   Só depois disso a aba Upgrade é construída em cima.

## Out of scope

- **Não executa fluxo.** Nada aqui roda um fluxo, com ou sem credencial.
- **Não deleta.** Nem nó, nem fluxo, nem execução, nem credencial. Sem verbo de delete.
- **Não ativa nem desativa fluxo.** `active` nunca vai no corpo.
- **Não cria credencial.** 7 dos 16 tipos desta conta são OAuth (`clickUpOAuth2Api` com 93 usos) e
  OAuth não se cola. Criar credencial continua no n8n.
- **Não aplica em lote.** Um upgrade, um fluxo, um clique. Sem "aplicar todos", sem agendado, sem
  auto-apply.
- **Não mexe em `n8n-gramatica.md`, `tester-agentes.md`, `catalog.js` nem no cache do esquema.**
  Prosa curada segue curada à mão; o que é medido segue medido.
- **Não funde a vitrine com o portfólio de disco.** Continuam duas portas.
- **Não conserta o transbordo de topbar a 390px** em `/tester` e `/disco`, só registra que a quarta
  porta agrava.
