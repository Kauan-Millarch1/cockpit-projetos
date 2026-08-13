# A gramática do n8n — o que um esquema não consegue dizer

Este arquivo é lido em tempo de execução por `gramatica.js` e injetado nos prompts do Tester. Editar
aqui muda o que o Tester constrói: **nenhuma mudança de código, nenhum restart.** Mesmo desenho do
`tester-agentes.md`, e pelo mesmo motivo — a parte que o Kauan mais afina é prosa, num lugar só.

## Como este arquivo é usado

Cinco blocos, delimitados por âncoras `<!-- BLOCO: nome -->` para abrir e `<!-- /BLOCO -->` para
fechar, **sozinhas na própria linha** — a citação de uma âncora no meio de uma frase não pode abrir
bloco, e já abriu uma vez neste repositório. O `gramatica.js` extrai cada um e o injeta onde ele vale:

| Bloco | Vai para | Por quê |
|---|---|---|
| `forma` | `promptDesenhar` (via `GRAMATICA.md` no disco) | a anatomia do documento: chaves de topo, campos de nó, `connections`, o prefixo `=` |
| `widgets` | idem | a forma JSON dos parâmetros compostos, que o esquema declara como opacos |
| `robustez` | idem | erro, retry, paginação, idempotência — o que separa fluxo que roda de fluxo que sobrevive |
| `topologia` | idem | as formas de fluxo inteiro: webhook→resposta, lote, junção, sub-fluxo, espera |
| `armadilhas` | idem | defeito medido, com onde foi medido |

**Toda afirmação aqui traz a fonte.** Quatro tipos, e a diferença importa:

- **[pacote]** — lido do descriptor npm (`n8n-nodes-base@2.15.1`, `@n8n/n8n-nodes-langchain@2.34.3`).
  É a definição do nó. Não é opinião.
- **[interface]** — lido de `packages/workflow/src/interfaces.ts` no repositório do n8n.
- **[medido:instância]** — contado nos 70 fluxos do Kauan.
- **[medido:templates]** — contado em fluxos publicados na API de templates do n8n (`api.n8n.io`).
- **[doc]** — documentação oficial (`docs.n8n.io`, versão `.md`).

Número inventado aqui vira número inventado em todo fluxo construído a partir daqui. Se você não
mediu, não escreva.

## O que o esquema já resolve, e por isso não está aqui

`esquema.js` destila 810 tipos de nó dos pacotes npm e entrega, **por versão**: nome de cada
propriedade, tipo, valor padrão, o enum completo dos discriminadores, se é obrigatória, e sob qual
`resource`/`operation`/`@version` ela existe. Também traz, em 278 versões, o **schema do que o nó
devolve**.

Então não repita aqui: enum de `operation`, nome de parâmetro, `typeVersion` que existe. Isso está no
`esquema.json` do diretório da corrida e é conferido em portão. Aqui fica só o que o descriptor **não
sabe dizer**.

<!-- BLOCO: forma -->

## A anatomia do documento

### O topo

Exatamente quatro chaves, nunca outra:

```json
{ "name": "...", "nodes": [...], "connections": {...}, "settings": { "executionOrder": "v1" } }
```

`executionOrder: "v1"` não é enfeite. **[doc]** Em fluxos criados a partir do n8n 1.0, a execução
percorre um ramo até o fim antes de começar o próximo, ordenando os ramos pela posição no canvas —
de cima para baixo, e da esquerda para a direita quando dois estão na mesma altura. Sem `v1` o n8n
usa a ordem antiga (o primeiro nó de cada ramo, depois o segundo de cada ramo), e um fluxo com duas
pontas que escrevem no mesmo lugar passa a rodar numa ordem diferente da que foi desenhada.

**`active` não entra em lugar nenhum**, nem no arquivo que aparece na tela. Um JSON com `active: true`
acorda um webhook na hora da importação, e ninguém pediu isso.

`settings` só aceita a lista branca que o `pickSettings` do `n8n.js` conhece — a API pública recusa o
resto **sem dizer qual chave ofendeu**. Não escreva `settings` que você não precisa.

### Os campos de um nó

**[interface]** A lista completa e autoritativa, de `INode`:

| Campo | Tipo | Nota |
|---|---|---|
| `name` | string | único no fluxo; é a chave usada em `connections` e em `$('Nome')` |
| `type` | string | tem que existir no catálogo da instância — portão sem apelação |
| `typeVersion` | number | **obrigatório**. Omitido, o n8n importa como v1 e parâmetro escrito para v2+ quebra em silêncio |
| `position` | `[number, number]` | dois números |
| `id` | string | opcional na prática; o n8n gera |
| `disabled` | boolean | é assim que se tira um nó do caminho sem apagá-lo |
| `notes` / `notesInFlow` | string / boolean | anotação; `notesInFlow` mostra no canvas |
| `retryOnFail` | boolean | ver bloco `robustez` |
| `maxTries` | number | só vale com `retryOnFail` |
| `waitBetweenTries` | number | ms |
| `alwaysOutputData` | boolean | faz o nó emitir um item vazio em vez de nada |
| `executeOnce` | boolean | roda só para o primeiro item da entrada |
| `onError` | `stopWorkflow` \| `continueRegularOutput` \| `continueErrorOutput` | ver bloco `robustez` |
| `continueOnFail` | boolean | **legado**. Use `onError` |
| `parameters` | objeto | o que o esquema descreve |
| `credentials` | objeto | **o Tester nunca escreve isto** — a pessoa escolhe no editor |

Qualquer campo fora desta lista é invenção. O `applyPatch` do `claude-fix.js` recusa campo
desconhecido justamente porque o n8n aceita e ignora.

### `connections`

```json
"connections": {
  "nome_do_no_de_origem": {
    "main": [
      [ { "node": "destino_da_saida_0", "type": "main", "index": 0 } ],
      [ { "node": "destino_da_saida_1", "type": "main", "index": 0 } ]
    ]
  }
}
```

Três níveis, e confundi-los é o erro mais comum:

1. **a porta** (`"main"`, ou `"ai_tool"`, `"ai_memory"`, `"ai_languageModel"`, `"ai_outputParser"`);
2. **o índice da saída** — o array de fora. `main[0]` é a primeira saída, `main[1]` a segunda. **É
   isso que distingue os ramos de um `if`/`switch`: o ÍNDICE, não um nome de porta.**
   **[medido:instância]** toda porta de saída nos 70 fluxos se chama `main` (fora as `ai_*`);
3. **a lista de destinos daquela saída** — o array de dentro. Uma saída pode ir para vários nós.

`index` no objeto de destino é a **entrada** do nó que recebe (importa no `merge`, que tem duas).

Um nó de agente pendura modelo, memória, parser e ferramentas nas portas `ai_*`, e **ligá-los por
`main` importa sem erro nenhum e produz um agente sem modelo.**

### O prefixo `=`, que é onde a maioria das expressões morre

**[medido:templates]** Em fluxo publicado que funciona, um parâmetro que contém expressão vem assim:

```json
"leftValue": "={{ $json.confidence }}"
"text":      "=Chegou pedido de {{ $json.cliente }}"
```

**A regra: o valor tem que COMEÇAR com `=` para o n8n avaliar a expressão.** Sem o `=`, o
`{{ $json.x }}` é texto literal — importa sem erro, aparece no editor como se estivesse certo, e a
mensagem sai com as chaves na cara do cliente. Com o `=`, todo o resto da string é template: é por
isso que `"=Chegou pedido de {{ … }}"` funciona e mistura texto fixo com expressão.

Valor fixo **não** leva `=`. `"select": "channel"` é um literal.

<!-- /BLOCO -->

<!-- BLOCO: widgets -->

## Os parâmetros compostos, e por que eles não estão no esquema

**[pacote]** Cinco tipos de parâmetro têm a forma JSON no WIDGET do editor, não na lista de
propriedades. O descriptor diz `type: "filter"` e não diz como um filter se escreve. `esquema.js`
marca esses tipos como opacos e o portão não desce dentro deles — de propósito: acusar chave
desconhecida ali seria afirmar sobre uma forma que ele não conhece.

As formas abaixo foram **copiadas de fluxos publicados que funcionam** **[medido:templates]**, com
`typeVersion` conferida, e conferem com os tipos gerados que o próprio pacote publica em
`dist/node-definitions/`.

### `filter` — as condições de `if` (v2+), `filter` e cada ramo de `switch`

```json
"conditions": {
  "options": { "version": 2, "leftValue": "", "caseSensitive": true, "typeValidation": "strict" },
  "combinator": "and",
  "conditions": [
    {
      "id": "cond-1",
      "leftValue": "={{ $json.valor }}",
      "rightValue": "={{ $json.limite }}",
      "operator": { "type": "number", "operation": "gte" }
    }
  ]
}
```

Cinco coisas que quebram aqui, todas silenciosas:

- **`operator` é objeto**, `{type, operation}`, e não uma string. `"operator": "gte"` importa e a
  condição nunca casa.
- **`options.version: 2`** tem que estar lá. É a versão do próprio widget de filtro.
- **`typeValidation: "strict"`** compara tipos de verdade. Comparando número com o texto `"10"` a
  condição falha; se a origem é texto, ou converta antes num `Set`, ou use
  `typeValidation: "loose"`.
- **`type` do operador é o tipo do dado** (`string`, `number`, `boolean`, `dateTime`, `array`,
  `object`), e `operation` é o verbo (`equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `contains`,
  `notContains`, `startsWith`, `endsWith`, `exists`, `notExists`, `empty`, `notEmpty`). A combinação
  tem que fazer sentido: `{type:"number", operation:"contains"}` não existe.
- **`id` é obrigatório** em cada condição, e único dentro da lista.

`combinator` é `"and"` ou `"or"`, e vale para a lista inteira.

### `assignmentCollection` — o `Set` v3.x inteiro

```json
"assignments": {
  "assignments": [
    { "id": "a1", "name": "cliente",  "type": "string", "value": "={{ $json.contato.nome }}" },
    { "id": "a2", "name": "total",    "type": "number", "value": "={{ $json.itens.valor }}" }
  ]
}
```

`assignments.assignments` — sim, duas vezes. `type` é `string` | `number` | `boolean` | `array` |
`object`, e ele **converte**: declarar `number` num valor que chega como texto é o jeito certo de
resolver a comparação estrita do `filter` acima.

Para carregar o resto dos campos junto, `"includeOtherFields": true` no mesmo nó. Sem isso o `Set`
**descarta** tudo que não foi declarado — que é a causa mais comum de um campo desaparecer no meio do
fluxo.

### `resourceLocator` — todo seletor de recurso (canal, planilha, tabela, documento)

```json
"channelId":  { "__rl": true, "mode": "list", "value": "C09KLV9DJSX", "cachedResultName": "vendas" }
"documentId": { "__rl": true, "mode": "list", "value": "1AbC…" }
"sheetName":  { "__rl": true, "mode": "list", "value": "gid=0" }
```

`__rl: true` sempre. `mode` é o modo de seleção — **[pacote]** os modos válidos variam por nó e estão
no esquema, em `modos`; os comuns são `list`, `id`, `url`, `name`. `cachedResultName` é só o rótulo
que o editor mostra: **pode ser omitido, e nunca deve ser inventado.**

Uma string crua no lugar de um resourceLocator (`"channelId": "C09…"`) importa e o campo aparece
vazio no editor.

Quando o destino não foi confirmado pela pessoa, o honesto é
`{ "__rl": true, "mode": "id", "value": "[PREENCHER]" }` — nunca um id plausível.

### `fixedCollection` — grupos nomeados, com ou sem lista

**[pacote]** A forma sai do esquema: cada grupo tem nome e campos, e `lista: true` quer dizer que o
grupo é um array.

```json
"headerParameters": { "parameters": [ { "name": "Authorization", "value": "=Bearer {{ $json.token }}" } ] }
"pollTimes":        { "item": [ { "mode": "everyMinute" } ] }
```

Grupo com `lista: false` é objeto direto, sem o array.

### `resourceMapper` — o mapeamento de colunas (`googleSheets`, `postgres`, `airtable`)

```json
"columns": {
  "mappingMode": "defineBelow",
  "value": { "nome": "={{ $json.cliente }}", "total": "={{ $json.valor }}" },
  "matchingColumns": ["nome"],
  "schema": []
}
```

`mappingMode` é `autoMapInputData` (usa os campos da entrada com o mesmo nome) ou `defineBelow` (o
mapa explícito em `value`). `matchingColumns` só importa em operação de atualização — é por qual
coluna a linha é encontrada. `schema: []` é aceito vazio.

**`autoMapInputData` é uma aposta**: depende de os campos da entrada terem exatamente o nome das
colunas. Quando os nomes reais das colunas não são conhecidos, `defineBelow` com `[PREENCHER]` diz a
verdade; `autoMapInputData` esconde o problema até a primeira execução.

<!-- /BLOCO -->

<!-- BLOCO: robustez -->

## O que separa um fluxo que roda de um fluxo que sobrevive

### O modelo de dados, que decide tudo o que vem depois

**[doc]** Tudo que passa entre nós é uma **lista de itens**, e cada item é `{ "json": {…} }` — com
`{ "binary": {…} }` ao lado quando há arquivo. **Um nó processa todos os itens da entrada
automaticamente, um por um.** Não existe "nó de laço" para isso: pôr um `splitInBatches` para
percorrer itens é resolver um problema que o n8n não tem.

Consequência prática: dentro de uma expressão, `$json` é **o item da vez**. Um nó de envio com
`{{ $json.telefone }}` na frente de 40 itens manda 40 mensagens, cada uma para o telefone do seu
item. Isso quase sempre é o desejado — e quando não é, o campo é `executeOnce: true`, não um laço.

### Erro

**[interface]** `onError` tem três valores e só três:

- `stopWorkflow` (padrão) — a execução morre ali.
- `continueRegularOutput` — o erro vira um item na saída **normal**, e o fluxo segue. É o que se quer
  em nó de persistência: falhar em gravar um log não pode derrubar o atendimento.
- `continueErrorOutput` — abre uma **segunda saída** no nó, só para o erro. É o que se quer quando há
  um plano B: avisar, gravar numa fila, tentar outro caminho. Usando isto, a saída 1 (`main[1]`) do
  nó passa a ser o ramo de erro e **precisa estar ligada em algum lugar** — deixar solta é jogar o
  erro no chão.

`continueOnFail` é o campo antigo que fazia o papel de `continueRegularOutput`. Não escreva.

**[medido:instância]** O único build de agente que saiu certo tinha `onError: continueRegularOutput`
em **19 de 19** nós de persistência. Esse é o padrão da casa.

### Retry

`retryOnFail: true`, com `maxTries` (padrão 3) e `waitBetweenTries` em ms. Vale para o que falha por
motivo passageiro — chamada HTTP, rate limit, timeout de banco. **Não** vale para o que falha por
motivo determinístico: campo obrigatório vazio vai falhar as três vezes e só atrasar o erro.

E retry só é seguro em operação **idempotente**. Um `POST` que cria pedido, tentado três vezes num
timeout de resposta, cria três pedidos — o timeout prova que a confirmação não voltou, não que o
efeito não aconteceu. Para esses, ou a API aceita uma chave de idempotência, ou o certo é
`continueErrorOutput` e um humano no meio.

### Fluxo de erro do workflow

**[doc]** Um fluxo à parte, começando por `n8n-nodes-base.errorTrigger`, apontado em
`settings.errorWorkflow`. Ele recebe:

```json
{ "execution": { "id": "231", "url": "…", "error": { "message": "…", "stack": "…" },
                 "lastNodeExecuted": "Nó Com Erro", "mode": "manual" },
  "workflow":  { "id": "1", "name": "…" } }
```

`execution.id` e `execution.url` **não vêm** quando o erro é no nó de gatilho — o fluxo não executou.
Um alerta que depende do link da execução tem que sobreviver a isso.

`n8n-nodes-base.stopAndError` é como se falha de propósito, para acionar esse caminho.

### Paginação e limite de taxa

Em `httpRequest`, a paginação é uma opção do nó (`options.pagination`), não um laço desenhado à mão.
Quando ela não serve — API com cursor esquisito —, o desenho é `splitInBatches` com o cursor guardado
entre voltas, e aí **tem que haver condição de parada explícita**: fluxo que pagina sem ela roda até
o limite de execução.

Para limite de taxa: `n8n-nodes-base.wait` entre lotes, e `retryOnFail` com `waitBetweenTries` para o
429 que escapa.

<!-- /BLOCO -->

<!-- BLOCO: topologia -->

## As formas de fluxo inteiro

### Webhook que responde

```
webhook  →  (responde já)  →  processa  →  …
```

**A resposta vem antes do processamento**, não depois. `n8n-nodes-base.webhook` com
`responseMode: "responseNode"` e um `n8n-nodes-base.respondToWebhook` logo na frente: quem chamou
recebe o `200` em milissegundos e o resto acontece sem ninguém esperando. Deixar a resposta no fim
faz o remetente esperar o fluxo todo — e estourar o timeout dele em qualquer dia ruim.

`respondToWebhook` **não** é gatilho, apesar do nome terminar em "webhook". Um fluxo
webhook→resposta tem **um** nó de início.

### Laço de verdade

`splitInBatches` só se justifica quando o lote precisa existir: limite de taxa, chamada que aceita N
por vez, cursor de paginação. A saída `main[0]` é o "done" e a `main[1]` é o lote — **e é comum
inverter as duas**, o que produz um fluxo que processa uma vez e para.

### Junção

`merge` tem **duas entradas**, e é o `index` do objeto de destino em `connections` que decide qual.
`mode` decide o que ele faz: `append` (empilha), `combine` (casa por campo ou por posição),
`chooseBranch`. Junção que casa por campo precisa que o campo exista nos dois lados — quando não
existe, o resultado é um silêncio: zero itens, sem erro.

### Sub-fluxo

`n8n-nodes-base.executeWorkflow` chama outro fluxo; do outro lado,
`n8n-nodes-base.executeWorkflowTrigger` recebe.

**[medido:instância]** Um fluxo cujo único gatilho é `executeWorkflowTrigger` **nunca fica
`active`** — quem é acordado é o pai. 14 dos 70 fluxos da instância estão nessa forma. E uma falha
dentro do filho é reportada **na execução do pai**, com o nome de um nó que não existe no grafo do
pai: é por isso que o cockpit segue o sub-fluxo antes de propor conserto.

Quando o Tester declara uma ferramenta de agente como sub-fluxo, o `workflowId` sai `[PREENCHER]`: o
fluxo dela não existe ainda, e um id inventado importa em silêncio e falha na primeira execução.

### Espera

`n8n-nodes-base.wait` para janela de agrupamento (o buffer de agente), pausa entre mensagens,
respeito a limite de taxa. Espera longa muda a natureza do fluxo — a execução fica pendurada — e isso
é escolha, não detalhe.

<!-- /BLOCO -->

<!-- BLOCO: armadilhas -->

## Armadilhas medidas

Cada uma custou debug real. A fonte está em cada linha.

### `redis` com `operation: get` devolve o valor em `propertyName`, nunca em `value`

**[medido:instância, execução #176997]** Cinco nós `redis get` devolveram um objeto cuja **única
chave é `propertyName`**. Ler `$json.value` dá `undefined`, sem erro, sem aviso, e a execução fica
verde. **[pacote]** O esquema confirma: em `redis` v1, `propertyName` é **obrigatório** e existe
apenas sob `operation: get`.

Isso está matando duas camadas de um agente em produção, em código **idêntico** entre o fluxo ativo e
o gêmeo: um teste de lock que nunca detecta lock (então dois recados simultâneos do mesmo contato
passam os dois), e um resumo de conversa que nunca carrega.

### Parâmetro de versão antiga num nó de versão nova

**[medido:templates]** Em 99 fluxos publicados, 33 nós carregam parâmetro que a versão declarada não
tem: `range`, `keyRow`, `dataMode` em `googleSheets@4`; `requestMethod` em `httpRequest@4` (o nome é
`method` a partir da v4); `rule` num nó `cron`. O n8n **aceita e ignora** — nada avisa. Este é
exatamente o defeito que o portão de esquema existe para pegar, e é a razão de ele existir.

### A API pública aceita qualquer `parameters`

Ela não valida parâmetro nenhum. Criar o fluxo pela API e receber `200` prova que o **schema do
documento** foi aceito, e **nada** sobre os parâmetros dentro dele. O erro aparece na importação, no
editor, que é justo quando alguém está contando com o fluxo. A cópia no sandbox nunca provou isso — o
portão de esquema prova.

### Chave de `settings` que o editor escreve e a API recusa

**[medido:instância]** `timeSavedMode` está em 5 dos 10 fluxos ativos e **não** está no schema da
própria instância (`additionalProperties: false`). Devolver `settings` num `PUT` falha com
`400 … must NOT have additional properties`, **e a mensagem não nomeia a chave**. Escreva `settings`
mínimo.

### O mesmo nome de propriedade é declarado várias vezes

**[pacote]** `documentId` aparece **duas vezes** em `googleSheets` v4.7 — uma sob `resource: sheet`,
outra sob `resource: spreadsheet` com `operation: deleteSpreadsheet`. O editor renderiza a declaração
que casa. Quem lê o esquema tem que fazer o mesmo: a chave vale se **qualquer** declaração vale.
Guardar só a última fez o portão acusar 14,4% dos nós de fluxos publicados que funcionam.

### Fluxo real omite o que está no padrão

**[medido:templates]** Nenhum nó `googleSheets` escreve `resource: "sheet"` — é o valor padrão.
Escrever o padrão não é erro; **contar com ele estar escrito é**. Qualquer leitura de
`displayOptions` precisa resolver os defaults antes de decidir.

### Sticky note é nó

**[medido:instância]** `n8n-nodes-base.stickyNote` conta em `nodes`, não aparece em `runData`, não
liga em nada e infla a caixa de layout. É onde os nomes das seções vivem, e é útil: um fluxo de 40
nós sem sticky é um fluxo que ninguém lê depois. Mas ela está fora dos portões de gatilho, conexão e
catálogo.

### Posição de nó pode ser qualquer número

**[medido:instância]** `x` observado de −27632 a −4592. Não assuma origem nem sinal. Para um fluxo
novo, o simples serve: uma trilha horizontal com passo de ~200 no `x`, e as ligações `ai_*` numa
segunda trilha abaixo do agente que elas servem.

### `[PREENCHER]` é melhor que um valor plausível

Regra da casa, e a razão é assimétrica: um marcador faz o nó falhar na cara, na hora, com o campo
vazio no editor. Um canal inventado, um id de planilha plausível ou um telefone de exemplo fazem o
fluxo **importar limpo e mandar para o lugar errado** — e nada avisa. Todo parâmetro que depende de
algo que a pessoa não confirmou sai `[PREENCHER]`, e a lista deles vai no `report.md`.

<!-- /BLOCO -->
