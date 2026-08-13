# De onde vem o conhecimento, e como extrair de novo

Tudo aqui foi verificado ao vivo em 2026-08-12. Nada é "deveria funcionar".

## 1. O esquema autoritativo dos nós — o pacote npm

**O que se ganha:** por `(tipo, typeVersion)`, toda propriedade com tipo, valor padrão, o **enum
completo** dos discriminadores, se é obrigatória, e o `displayOptions` — sob qual
`resource`/`operation`/`@version` a chave sequer existe.

O `displayOptions` vale mais que o enum, e é o menos usado. É ele que diz que `propertyName` do
`redis` **só existe quando `operation` é `get`** — o que transforma "chave plausível" em "chave
inaplicável", ou seja num teste booleano onde antes havia palpite.

### Baixar

```bash
npm pack n8n-nodes-base                      # ~8.7MB de tarball
npm pack @n8n/n8n-nodes-langchain            # ~1.4MB — toda a pilha de agente
tar -xzf n8n-nodes-base-<v>.tgz -C base --strip-components=1
```

`npm pack`, não `npm install`: o tarball traz todos os `dist/nodes/**/*.node.js` e **não** traz árvore
de dependências — porque as dependências vão ser stubadas. 10MB de tarball contra ~83MB instalados, e
nenhum `node_modules` para alguém confundir com dependência de runtime.

Descompactar leva minutos: são ~26 mil arquivos.

### Carregar um descriptor

Cada `.node.js` é TypeScript compilado que importa três coisas (`n8n-workflow`, `lodash/*`,
`./utils`). Pendure um hook em `Module._load` que devolve um Proxy para o que não resolver, e requeira
o arquivo. `new Cls().description` sai estruturado.

**Cinco detalhes, e cada um custou um tipo de nó inteiro:**

1. **`VersionedNodeType` tem que ser real, não Proxy.** É o construtor que guarda `nodeVersions`, e é
   dele que sai a separação por versão — o ponto inteiro do exercício. Stubado como Proxy,
   `new If()` devolve um objeto sem nenhuma chave e o nó multi-versão desaparece em silêncio.

   ```js
   class VersionedNodeType {
     constructor(nodeVersions, description) {
       this.nodeVersions = nodeVersions;
       this.description = description;
     }
   }
   ```

2. **`updateDisplayOptions` tem que ser real.** É como boa parte dos nós **pendura** o
   `displayOptions` numa lista de propriedades: a lista é declarada limpa e o predicado
   `{show:{resource:['channel']}}` é injetado depois. Stubada, a chamada devolve algo não-iterável, o
   construtor morre com `is not a function or its return value is not iterable`, e o tipo desaparece.
   Custou `slack` e `whatsApp`. A semântica é `merge({}, prop.displayOptions, displayOptions)` do
   lodash: objeto funde recursivamente, array funde por índice, escalar sobrescreve.

3. **O Proxy tem que responder `__esModule: true`.** Isto é o oposto do intuitivo. O helper
   `__importStar` do tsc, quando `__esModule` é falso, **copia as chaves enumeráveis** do módulo para
   um objeto novo — e um Proxy sobre função só tem `length`/`name`/`prototype`, então a cópia sai sem
   o stub e `mod.description` vira `undefined`. Custou `convertToFile`.

4. **O Proxy tem que ter `Symbol.iterator`** (gerador vazio serve). Vários descriptors fazem
   `...algumHelper()` para concatenar listas de propriedade; não-iterável mata o construtor. Vazio
   degrada: perde aquelas propriedades e mantém o nó.

5. **Faça isso num processo FILHO.** Sujar o `Module._load` do processo que serve a aplicação é
   imprudente; o filho morre com o hook dentro dele.

### O `options` de uma propriedade quer dizer três coisas

Confundi-las produz um esquema que parece certo e mente:

| `type` | O que `options` é | No JSON |
|---|---|---|
| `options`, `multiOptions` | **enum**: `[{name, value}]` | vai o `value` |
| `collection` | lista de **propriedades internas**, todas opcionais | objeto |
| `fixedCollection` | lista de **grupos** nomeados: `[{name, values:[prop…]}]` | `{grupo: {…}}`, ou `{grupo: [{…}]}` com `multipleValues` |

Ler `fixedCollection.options` como enum dá um enum de nomes de grupo, que não é valor de nada.

### Versão: dois formatos

- `VersionedNodeType` → `nodeVersions` é mapa versão → implementação, cada uma com a sua lista.
- nó simples → `description.version` é número **ou ARRAY** de números (`[1, 1.1, 1.2]`), e nesse caso
  todas as versões compartilham a lista. Tratar o array como número produz a chave `"1,1.1,1.2"`.

### Duas propriedades reais que NÃO estão na lista

O n8n injeta conforme uma flag da description, e sem isso um conferidor acusa chave correta:

- `polling: true` → o nó recebe `pollTimes`.
- `requestDefaults` presente → o nó recebe `requestOptions`.
- `usableAsTool: true` → **existe um tipo a mais**, `<tipo>Tool`, que é o mesmo nó pendurado na porta
  `ai_tool` de um agente, com `descriptionType` e `toolDescription` a mais. A flag pode estar na
  description base **ou** dentro da de uma versão (`googleSheets` declara na base, `clickUp` só na
  V2) — ler só um dos dois lugares perde metade das variantes.

### O bônus: o schema do que o nó DEVOLVE

Ao lado de cada nó pode haver `__schema__/v<versão>/<resource>/<operation>.json` — JSON Schema da
**saída**. Medido: 169 nós de `n8n-nodes-base`, 1018 arquivos.

Isso responde uma pergunta diferente e igualmente caçadora de defeito silencioso: depois que o nó
roda, quais campos existem em `$json`. É a diferença entre `{{ $json.channel }}` e
`{{ $json.channel.id }}` — as duas importam sem erro e só uma funciona.

**A pasta é `v2.3.0` e a `typeVersion` do nó é `2.3`.** O terceiro segmento é patch do schema e não
existe do lado do fluxo; casar sem cortá-lo produz a chave `"2.3.0"`, que nunca bate com nó nenhum —
erro silencioso. E `v1.0.0` vira `"1"`, não `"1.0"`.

### Também no pacote: tipos gerados

`dist/node-definitions/nodes/<pacote>/<nó>/v23.ts` e `v23.schema.js` — tipos TypeScript e schemas Zod
gerados por versão. Os `.ts` são a única fonte oficial da forma dos parâmetros **opacos**:

```ts
type FilterValue = { conditions: Array<{ leftValue: unknown; operator: { type: string; operation: string }; rightValue: unknown }> };
```

Os `.schema.js` são fábricas Zod que precisam do `z` injetado, e tratam os mesmos tipos como folha
(`filterValueSchema`) — ou seja, o n8n também os considera opacos ali.

## 2. Um nó só, sem baixar o pacote — jsdelivr

```
https://cdn.jsdelivr.net/npm/n8n-nodes-base@<versão>/dist/nodes/<Caminho>.node.js
```

~28KB por nó, sem auth. O caminho de cada nó sai do manifesto:

```
GET https://registry.npmjs.org/n8n-nodes-base/<versão>   →  campo `n8n.nodes`
```

438 caminhos declarados, 43KB, uma chamada. Casar tipo → caminho pelo **basename** do arquivo.

**Use jsdelivr, não unpkg.** Medido: `unpkg.com` devolveu **500** em 2 de 5 requisições, inclusive no
`package.json` do pacote; `cdn.jsdelivr.net` respondeu todas. E o descriptor de uma versão fixa é
imutável — cacheie para sempre, por versão de pacote.

Se for por CDN, siga os `require("./…")` relativos recursivamente: o wrapper de um nó versionado tem
~1KB e aponta para `V1/`, `V2/`. Um `if` puxa 6 arquivos.

## 3. Fluxos reais que funcionam — a API de templates

Sem auth, público.

```
GET https://api.n8n.io/templates/search?rows=<n>&page=<p>&nodes=<tipo>   → ids + metadados
GET https://api.n8n.io/templates/workflows/<id>                          → o workflow JSON completo
```

Medido: `totalWorkflows` **1854**; o filtro `nodes=` funciona; cada linha da busca já traz
`typeVersion`, `displayName`, categorias e `codex.data.resources.primaryDocumentation.url` — o link da
doc oficial daquele tipo de nó, de graça.

É a única fonte da forma dos parâmetros **compostos** para nós que você nunca usou, e a única fonte de
**topologia** real: ramo de erro, paginação, lote, webhook→resposta.

**Confira a `typeVersion` antes de usar como exemplar.** O template `#1` é de 2019 e é todo
`typeVersion: 1`. Exemplar de versão errada ensina exatamente o erro que se quer evitar.

Rendimento medido: **24 templates deram 52 pares (tipo, versão)**, incluindo `if@2.2`/`2.3`,
`set@3.4`, `slack@2.4`, `httpRequest@4.2`/`4.3`, `googleSheets@4.7`.

## 4. A doc oficial em markdown

- **Qualquer página** com `.md` no fim: `https://docs.n8n.io/build/flow-logic/loop.md`.
- **O índice**: `https://docs.n8n.io/llms.txt` (~279KB).
- **O corpus inteiro**: `https://docs.n8n.io/llms-full.txt` (~680KB). Cuidado: boa parte é
  hospedagem/deploy, pouco útil para gerar fluxo. É melhor como arquivo em disco para `Grep` do que
  como material de prompt.
- Página que não existe devolve uma **lista de páginas sugeridas** em markdown, o que serve como
  busca.

## 5. O que NÃO funciona — não re-derive

| Tentativa | Resposta |
|---|---|
| `GET /types/nodes.json` na instância Cloud | **401** |
| `GET /rest/node-types` | **404** |
| `GET /api/v1/node-types` | **404** |
| `GET /api/v1/credentials` | **405** — não existe inventário de credenciais |
| `GET /api/v1/projects` | **403** em plano sem a feature |
| `?status=crashed` no filtro de execuções | **400**. Válidos: `success \| error \| waiting \| running \| canceled` |
| executar um fluxo pela API pública | **não existe endpoint** |

O endpoint de esquema do editor não é alcançável com chave da API pública. É por isso que o caminho é
o pacote npm.

## 6. Alternativas consideradas e recusadas

- **`n8n-mcp` (czlonkowski)** — SQLite pronto com 2412 nós, e o `node:sqlite` do Node 22 tornaria o
  uso viável sem dependência. Recusado: põe o artefato de build de um terceiro como fonte de verdade
  sobre o n8n, versionado no calendário deles, quando a fonte primária é um `npm pack`.
- **`@n8n/workflow-sdk` + a skill `workflow-builder` do n8n** — reais e do fornecedor, e a forma
  errada aqui: o fluxo é autorado em **TypeScript**. Serve para quem tem build; não serve para
  produzir JSON que alguém cola no editor.
