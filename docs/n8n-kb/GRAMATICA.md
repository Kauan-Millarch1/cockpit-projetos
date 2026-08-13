# A gramática do n8n — o que um esquema não consegue dizer

Versão portátil, sem nada específico de um projeto. O irmão dela é `n8n-gramatica.md` na raiz do
Cockpit, que é a **canônica** — quando as duas discordarem, a de lá ganha, e esta deveria ser
atualizada.

**Toda afirmação traz a fonte.** Cinco tipos, e a diferença importa:

- **[pacote]** — lido do descriptor npm (`n8n-nodes-base`, `@n8n/n8n-nodes-langchain`). É a definição
  do nó. Não é opinião.
- **[interface]** — `packages/workflow/src/interfaces.ts` no repositório do n8n.
- **[doc]** — documentação oficial (`docs.n8n.io`, versão `.md`).
- **[medido:templates]** — contado em fluxos publicados na API de templates (`api.n8n.io`), com
  `typeVersion` conferida.
- **[medido:produção]** — contado numa instância real, em execução.

Número que você não mediu não entra aqui. Ele vira número inventado em todo fluxo escrito a partir
daqui.

---

## 1. A anatomia do documento

### O topo

Exatamente quatro chaves:

```json
{ "name": "...", "nodes": [...], "connections": {...}, "settings": { "executionOrder": "v1" } }
```

`executionOrder: "v1"` não é enfeite. **[doc]** A partir do n8n 1.0 a execução percorre **um ramo até
o fim** antes de começar o próximo, ordenando os ramos pela posição no canvas — de cima para baixo, e
da esquerda para a direita quando dois estão na mesma altura. Sem `v1`, vale a ordem antiga (o
primeiro nó de cada ramo, depois o segundo de cada ramo), e um fluxo com duas pontas que escrevem no
mesmo lugar roda numa ordem diferente da desenhada.

**Não escreva `active`.** Um JSON com `active: true` acorda um webhook na importação, e ninguém pediu
isso.

**`settings` mínimo.** A API pública valida `settings` com `additionalProperties: false`, e o próprio
editor do n8n escreve chaves que ela recusa (`timeSavedMode` é o caso conhecido; o nome no schema é
`timeSavedPerExecution`). O erro é `400 … must NOT have additional properties` e **não nomeia a chave
ofensora**. Consulte o `openapi.yml` da instância antes de mandar qualquer chave de `settings` que não
seja `executionOrder`.

### Os campos de um nó

**[interface]** A lista completa e autoritativa, de `INode`. Campo fora dela é invenção — e o n8n
aceita e ignora invenção:

| Campo | Tipo | Nota |
|---|---|---|
| `name` | string | único no fluxo; é a chave de `connections` e de `$('Nome')` |
| `type` | string | tem que existir na instância |
| `typeVersion` | number | **obrigatório**. Omitido, o n8n importa como v1 e parâmetro de v2+ quebra em silêncio |
| `position` | `[number, number]` | dois números |
| `id` | string | opcional; o n8n gera |
| `disabled` | boolean | é assim que se tira um nó do caminho sem apagá-lo |
| `notes` / `notesInFlow` | string / boolean | anotação; `notesInFlow` mostra no canvas |
| `retryOnFail` | boolean | ver §3 |
| `maxTries` | number | só com `retryOnFail` |
| `waitBetweenTries` | number | ms |
| `alwaysOutputData` | boolean | emite um item vazio em vez de nada |
| `executeOnce` | boolean | roda só para o primeiro item da entrada |
| `onError` | `stopWorkflow` \| `continueRegularOutput` \| `continueErrorOutput` | ver §3 |
| `continueOnFail` | boolean | **legado**. Use `onError` |
| `parameters` | objeto | o que o esquema descreve |
| `credentials` | objeto | ver §5 |

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

1. **a porta** — `"main"`, ou `"ai_tool"`, `"ai_memory"`, `"ai_languageModel"`, `"ai_outputParser"`;
2. **o índice da saída** — o array de fora. `main[0]` é a primeira saída, `main[1]` a segunda. **É o
   ÍNDICE que distingue os ramos de um `if`/`switch`, não um nome de porta.**
3. **a lista de destinos daquela saída** — o array de dentro. Uma saída pode ir para vários nós.

`index` no objeto de destino é a **entrada** do nó que recebe. Importa no `merge`, que tem duas.

Um nó de agente pendura modelo, memória, parser e ferramentas nas portas `ai_*`. **Ligá-los por
`main` importa sem erro nenhum e produz um agente sem modelo.**

### O prefixo `=`, que é onde a maioria das expressões morre

**[medido:templates]** Em fluxo publicado que funciona:

```json
"leftValue": "={{ $json.confidence }}"
"text":      "=Chegou pedido de {{ $json.cliente }}"
```

**O valor tem que COMEÇAR com `=` para o n8n avaliar a expressão.** Sem o `=`, `{{ $json.x }}` é
texto literal: importa sem erro, aparece no editor como se estivesse certo, e a mensagem sai com as
chaves na cara do cliente. Com o `=`, toda a string é template — é por isso que
`"=Chegou pedido de {{ … }}"` mistura texto fixo com expressão.

Valor fixo **não** leva `=`. `"select": "channel"` é literal.

---

## 2. Os parâmetros compostos

**[pacote]** Cinco tipos de parâmetro têm a forma JSON no **widget do editor**, não na lista de
propriedades. O descriptor diz `type: "filter"` e não diz como um filter se escreve. As formas abaixo
saíram de fluxos publicados que funcionam, com `typeVersion` conferida.

### `filter` — as condições de `if` (v2+), `filter`, e cada ramo de `switch`

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

- **`operator` é objeto** `{type, operation}`, não string. `"operator": "gte"` importa e a condição
  nunca casa.
- **`options.version: 2`** tem que estar lá. É a versão do widget de filtro.
- **`typeValidation: "strict"`** compara tipos de verdade. Número contra o texto `"10"` falha; se a
  origem é texto, converta antes num `Set` ou use `"loose"`.
- **`operator.type` é o tipo do dado** (`string`, `number`, `boolean`, `dateTime`, `array`, `object`)
  e `operation` é o verbo (`equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `contains`,
  `notContains`, `startsWith`, `endsWith`, `exists`, `notExists`, `empty`, `notEmpty`). A combinação
  tem que fazer sentido: `{type:"number", operation:"contains"}` não existe.
- **`id` é obrigatório** em cada condição, e único na lista.

`combinator` é `"and"` ou `"or"`, e vale para a lista inteira.

### `assignmentCollection` — o `Set` v3.x inteiro

```json
"assignments": {
  "assignments": [
    { "id": "a1", "name": "cliente", "type": "string", "value": "={{ $json.contato.nome }}" },
    { "id": "a2", "name": "total",   "type": "number", "value": "={{ $json.itens.valor }}" }
  ]
}
```

`assignments.assignments` — sim, duas vezes. `type` é `string` | `number` | `boolean` | `array` |
`object`, e **converte**: declarar `number` num valor que chega como texto é o jeito certo de resolver
a comparação estrita do `filter`.

`"includeOtherFields": true` no mesmo nó para carregar o resto dos campos. Sem isso o `Set`
**descarta** tudo que não foi declarado — a causa mais comum de um campo desaparecer no meio do fluxo.

### `resourceLocator` — todo seletor de recurso

```json
"channelId":  { "__rl": true, "mode": "list", "value": "C09KLV9DJSX", "cachedResultName": "vendas" }
"documentId": { "__rl": true, "mode": "list", "value": "1AbC…" }
"sheetName":  { "__rl": true, "mode": "list", "value": "gid=0" }
```

`__rl: true` sempre. `mode` varia por nó e está no esquema, em `modos` — os comuns são `list`, `id`,
`url`, `name`. `cachedResultName` é só o rótulo do editor: pode ser omitido, **nunca inventado**.

Uma string crua no lugar (`"channelId": "C09…"`) importa e o campo aparece vazio no editor.

Destino não confirmado sai `{ "__rl": true, "mode": "id", "value": "[PREENCHER]" }`.

### `fixedCollection` — grupos nomeados

```json
"headerParameters": { "parameters": [ { "name": "Authorization", "value": "=Bearer {{ $json.token }}" } ] }
"pollTimes":        { "item": [ { "mode": "everyMinute" } ] }
```

Cada grupo tem nome e campos. Grupo sem `multipleValues` é objeto direto, sem o array.

### `resourceMapper` — mapeamento de colunas (`googleSheets`, `postgres`, `airtable`)

```json
"columns": {
  "mappingMode": "defineBelow",
  "value": { "nome": "={{ $json.cliente }}", "total": "={{ $json.valor }}" },
  "matchingColumns": ["nome"],
  "schema": []
}
```

`mappingMode` é `autoMapInputData` (usa os campos da entrada com o mesmo nome) ou `defineBelow` (mapa
explícito). `matchingColumns` só importa em atualização — é por qual coluna a linha é encontrada.
`schema: []` é aceito vazio.

**`autoMapInputData` é uma aposta**: depende de os campos da entrada terem exatamente o nome das
colunas. Sem saber os nomes reais, `defineBelow` com `[PREENCHER]` diz a verdade; `autoMapInputData`
esconde o problema até a primeira execução.

---

## 3. O que separa um fluxo que roda de um fluxo que sobrevive

### O modelo de dados, que decide tudo o que vem depois

**[doc]** Tudo que passa entre nós é uma **lista de itens**, cada item `{ "json": {…} }`, com
`{ "binary": {…} }` ao lado quando há arquivo. **Um nó processa todos os itens da entrada
automaticamente, um por um.** Não existe "nó de laço" para isso: pôr um `splitInBatches` para
percorrer itens é resolver um problema que o n8n não tem.

Dentro de uma expressão, `$json` é **o item da vez**. Um nó de envio com `{{ $json.telefone }}` na
frente de 40 itens manda 40 mensagens, cada uma para o telefone do seu item. Quando não é isso que se
quer, o campo é `executeOnce: true` — não um laço.

Para pegar dado de outro nó: `{{ $('Nome do Nó').item.json.campo }}` (o item pareado) ou
`.first()` / `.last()` / `.all()`. `$('Nome')` é a forma moderna; `$node["Nome"]` é legado.

### Erro

**[interface]** `onError` tem três valores e só três:

- `stopWorkflow` (padrão) — a execução morre ali.
- `continueRegularOutput` — o erro vira item na saída **normal** e o fluxo segue. É o que se quer em
  nó de persistência: falhar em gravar um log não pode derrubar o atendimento.
- `continueErrorOutput` — abre uma **segunda saída** no nó, só para o erro. É o que se quer quando há
  plano B. Usando isto, `main[1]` passa a ser o ramo de erro e **precisa estar ligado em algum
  lugar**; deixar solto é jogar o erro no chão.

`continueOnFail` é o campo antigo que fazia o papel de `continueRegularOutput`. Não escreva.

### Retry

`retryOnFail: true`, com `maxTries` (padrão 3) e `waitBetweenTries` em ms. Vale para o que falha por
motivo passageiro — HTTP, rate limit, timeout de banco. **Não** vale para o que falha por motivo
determinístico: campo obrigatório vazio falha as três vezes e só atrasa o erro.

E retry só é seguro em operação **idempotente**. Um `POST` que cria pedido, tentado três vezes num
timeout de resposta, cria três pedidos — o timeout prova que a confirmação não voltou, **não** que o
efeito não aconteceu. Para esses: chave de idempotência na API, ou `continueErrorOutput` com um humano
no meio.

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

Em `httpRequest`, paginação é uma **opção do nó** (`options.pagination`), não um laço desenhado à mão.
Quando ela não serve, o desenho é `splitInBatches` com o cursor guardado entre voltas — e aí **tem que
haver condição de parada explícita**: fluxo que pagina sem ela roda até o limite de execução.

Para limite de taxa: `n8n-nodes-base.wait` entre lotes, e `retryOnFail` com `waitBetweenTries` para o
429 que escapa.

---

## 4. As topologias

### Webhook que responde

```
webhook  →  (responde já)  →  processa  →  …
```

**A resposta vem antes do processamento.** `n8n-nodes-base.webhook` com
`responseMode: "responseNode"` e um `n8n-nodes-base.respondToWebhook` logo na frente: quem chamou
recebe `200` em milissegundos e o resto acontece sem ninguém esperando. Resposta no fim faz o
remetente esperar o fluxo todo — e estourar o timeout dele em qualquer dia ruim.

`respondToWebhook` **não** é gatilho, apesar do nome terminar em "webhook". Um fluxo webhook→resposta
tem **um** nó de início.

### Laço de verdade

`splitInBatches` só se justifica quando o lote precisa existir: limite de taxa, chamada que aceita N
por vez, cursor de paginação. A saída `main[0]` é o "done" e a `main[1]` é o lote — **e é comum
inverter as duas**, o que produz um fluxo que processa uma vez e para.

### Junção

`merge` tem **duas entradas**, e é o `index` do destino em `connections` que decide qual. `mode` é
`append` (empilha), `combine` (casa por campo ou por posição) ou `chooseBranch`. Junção que casa por
campo precisa que o campo exista nos dois lados; quando não existe, o resultado é silêncio — zero
itens, sem erro.

### Sub-fluxo

`n8n-nodes-base.executeWorkflow` chama; `n8n-nodes-base.executeWorkflowTrigger` recebe.

Duas consequências que custam debug:

- Um fluxo cujo único gatilho é `executeWorkflowTrigger` **nunca fica `active`** — quem é acordado é o
  pai. Toda regra do tipo "ativo ou rodou recentemente" exclui estruturalmente os sub-fluxos quietos.
- Uma falha dentro do filho é reportada **na execução do pai**, com o nome de um nó que **não existe
  no grafo do pai**. Antes de consertar, siga o `workflowId` dos nós `executeWorkflow`/`toolWorkflow`
  e ache em qual filho aquele nó está. `parameters.workflowId` é string crua nas versões antigas e
  resource locator (`{__rl, value, mode}`) nas novas — leia as duas formas. Desambiguar por
  `lastNodeExecuted`: é o nó que estava chamando quando quebrou, ou seja, evidência.

### Espera

`n8n-nodes-base.wait` para janela de agrupamento, pausa entre mensagens, respeito a limite de taxa.
Espera longa muda a natureza do fluxo — a execução fica pendurada — e isso é escolha, não detalhe.

---

## 5. Credenciais

Não escreva `credentials` em fluxo gerado, com uma exceção precisa.

O n8n casa credencial por **`id` + `name`** na importação, então um fluxo que já aponta para uma
credencial existente importa ligado — zero cliques. Num fluxo de 3 nós isso é um minuto; num agente de
65 nós com 20 blocos de credencial é o trabalho todo.

A regra que faz isso ser seguro: **ligue só quando não há escolha a fazer** — exatamente um candidato,
com `id` e `name`, contando todos os tipos de credencial que aquele tipo de nó aceita. Dois candidatos
é ambíguo, e escolher um decide de qual conta a mensagem sai: pior que campo vazio, porque importa em
silêncio e só aparece na primeira execução, no destino errado. Zero candidatos é a mesma falha com um
id inventado.

O **segredo nunca** entra em nada. Ele não sai do n8n: a API pública não devolve valor de credencial,
e `GET /credentials` responde 405. O que viaja é o `id`, que só significa algo dentro daquela
instância.

Criar credencial fica no n8n, e não é só por segurança: boa parte dos tipos é OAuth, e OAuth não se
cria colando um valor.

---

## 6. Armadilhas medidas

### `redis` com `operation: get` devolve o valor em `propertyName`, nunca em `value`

**[medido:produção]** Cinco nós `redis get` devolveram um objeto cuja **única chave é
`propertyName`**. Ler `$json.value` dá `undefined`, sem erro, sem aviso, execução verde. **[pacote]**
O esquema confirma: em `redis` v1, `propertyName` é **obrigatório** e existe apenas sob
`operation: get`.

Observado matando duas camadas de um agente em produção, em código idêntico entre o fluxo ativo e o
gêmeo: um teste de lock que nunca detecta lock, e um resumo de conversa que nunca carrega.

### Parâmetro de versão antiga num nó de versão nova

**[medido:templates]** Em 99 fluxos publicados, 33 nós carregam parâmetro que a versão declarada não
tem: `range`, `keyRow`, `dataMode` em `googleSheets@4`; `requestMethod` em `httpRequest@4` (o nome é
`method` a partir da v4); `rule` num nó `cron`. O n8n **aceita e ignora** — nada avisa.

### A API pública aceita qualquer `parameters`

Ela não valida parâmetro nenhum. Criar o fluxo pela API e receber `200` prova que o **schema do
documento** foi aceito e **nada** sobre as chaves dentro dele. O erro aparece na importação, no
editor, que é justo quando alguém está contando com o fluxo.

### O mesmo nome de propriedade é declarado várias vezes

**[pacote]** `documentId` aparece **duas vezes** em `googleSheets` v4.7 — uma sob `resource: sheet`,
outra sob `resource: spreadsheet` com `operation: deleteSpreadsheet`. O editor renderiza a declaração
que casa; quem lê o esquema tem que fazer o mesmo. A chave vale se **qualquer** declaração vale.
Guardar só a última fez um conferidor acusar 14,4% dos nós de fluxos publicados que funcionam.

### Fluxo real omite o que está no padrão

**[medido:templates]** Nenhum nó `googleSheets` escreve `resource: "sheet"` — é o valor padrão.
Escrever o padrão não é erro; **contar com ele estar escrito é**. Qualquer leitura de `displayOptions`
tem que resolver os defaults antes de decidir.

### Chave inaplicável com valor vazio não é defeito

O editor deixa `"options": {}` e `"filters": {}` para trás quando a pessoa muda um discriminador. Um
objeto vazio não instrui nada e não pode causar erro silencioso. Acusá-lo é ruído — e ruído num
conferidor ensina a ignorar o conferidor.

### Sticky note é nó

`n8n-nodes-base.stickyNote` conta em `nodes`, nunca aparece em `runData`, não liga em nada e infla a
caixa de layout. É onde os nomes das seções vivem, e um fluxo de 40 nós sem sticky é um fluxo que
ninguém lê depois. Mas ela fica fora de qualquer portão de gatilho, conexão ou catálogo.

### Posição de nó pode ser qualquer número

**[medido:produção]** `x` observado de −27632 a −4592. Não assuma origem nem sinal; normalize pela
caixa envolvente. Para um fluxo novo, o simples serve: trilha horizontal com passo de ~200 no `x`, e
as ligações `ai_*` numa segunda trilha abaixo do agente que elas servem.

### `[PREENCHER]` é melhor que um valor plausível

A assimetria é o argumento: um marcador falha na cara, na hora, com o campo vazio no editor. Um canal
inventado, um id de planilha plausível ou um telefone de exemplo fazem o fluxo **importar limpo e
mandar para o lugar errado** — e nada avisa.
