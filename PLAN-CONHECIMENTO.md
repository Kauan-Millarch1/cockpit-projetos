# Plan: the Tester's knowledge base — from vocabulary to grammar

_Approved by Kauan, 2026-08-12. **L1, L3, L4 and L5 are built and measured** — see the status table
below. L2 is blocked on the decision at the end of this file; L6 is not started._
_Read `CLAUDE.md` first — its invariants bind this plan, and one of them is up for revision below._

## Status, 2026-08-12

| # | Layer | Estado | Onde |
|---|---|---|---|
| L1 | Esquema autoritativo dos nós | **feito** — 810 tipos, 611 nós, 0 falhas de arquivo, 9,4MB de cache. 50 dos 52 tipos dele, 67 dos 69 pares (tipo, versão) com versão exata | `esquema.js` |
| L4 | O portão de parâmetro | **feito** — 31 testes, e a calibração 14,4% → 0% de acusação nos fluxos dele | `validar()` em `tester.js`, `esquema-test.js` |
| L3 | Gramática por versão no prompt | **feito** — `esquema.json` (só a versão em uso) e `GRAMATICA.md` no diretório da corrida | `escreverContexto()`, `promptDesenhar()` |
| L5 | A prosa | **feito** — cinco blocos, lidos em runtime, com fonte em cada afirmação | `n8n-gramatica.md`, `gramatica.js` |
| — | Cópia portátil | **feito** — formato de skill, extrator gerado do canônico | `docs/n8n-kb/` |
| L2 | Exemplares minerados da instância | **bloqueado** na decisão do fim deste arquivo. Enquanto isso os exemplares vêm de templates públicos, que não tocam o invariante | — |
| L6 | A base que aprende | **feito** — três coletores, 24 testes. Primeira colheita real: 14 lições de 20 assinaturas do quadro de erros, 6 com diagnóstico. É o primeiro caminho que faz as duas portas da frente se falarem | `licoes.js`, `licoes.json`, `licoes-test.js` |
| — | Tela de curadoria das lições | **não existe.** A contagem está em `/api/tester/status`; revisar é `node licoes.js`. Base que aprende enquanto ninguém olha é base que não aprendeu | — |

Duas descobertas que não estavam no plano e mudaram o resultado: os pacotes publicam o **schema do
que cada nó devolve** (169 nós, 1018 arquivos, 278 versões colhidas), e publicam **tipos gerados** em
`dist/node-definitions/` que são a única fonte oficial da forma dos parâmetros opacos. As duas estão
documentadas em `docs/n8n-kb/FONTES.md`.

## The question this answers

The Tester builds flows that **pass every gate on the first round** and still land in n8n with fields
the editor shows as empty or wrong. Measured in `blueprints.json`: of the last 6 builds, 5 passed
gates on round 1. Gates passing is not the same as the flow working, and today nothing in the
pipeline can tell the two apart.

The cause is nameable. **The build session is taught vocabulary, not grammar.**

## What the build session actually knows today

Three files, written by `escreverContexto()` into the run directory:

| File | What it carries | When |
|---|---|---|
| `catalogo.json` | node types seen in his 70 flows, versions, a depth-2 sketch of parameter **keys and kinds**, port names, usage counts, example node names | always |
| `AGENTES.md` | the seven layers, recipes, measured traps | agent builds only |
| `doc.md` | the research fiche for a service with no dedicated node | when research ran |

`AGENTES.md` is the good part and the proof that this works: prose, measured, read at runtime,
editable without a restart. **The problem is that nothing equivalent exists for the other 95% of
builds.** Everything a non-agent flow knows comes from the sketch.

## What the sketch cannot say — measured, not assumed

Read straight off `.cache-catalog.json` today:

```
n8n-nodes-base.if     usos=166  versions={"2":11,"2.2":88,"2.3":67}
  conditions.conditions.array.operator : "object"
n8n-nodes-base.redis  usos=138  versions={"1":138}
  operation : "string"
n8n-nodes-base.slack  usos=30   versions={"2.3":21,"2.4":9}
  select : "string"   messageType : "string"   resource : "string"
```

Four gaps, in order of damage:

1. **Every discriminator is the word `"string"`.** `resource`, `operation`, `mode`, `select`,
   `method`, `keyType`, `authentication` — the keys that decide what a node *does* — arrive with no
   enum at all. The model fills them from training memory. `redis.operation` is `"string"` in a
   repository whose `CLAUDE.md` documents a live, silent, production bug about `redis get`
   returning its value under `propertyName`. The catalogue is structurally incapable of carrying
   that fact.
2. **The composite widgets flatten to `"object"`.** `if.conditions…operator` is the single most
   error-prone object in modern n8n (`{type, operation, singleValue}`) and the model sees the word
   `object`. 166 uses of `if` in his instance.
3. **The sketch is a union across versions.** `if` 2 / 2.2 / 2.3 are merged into one shape, and so
   are `httpRequest` 4 / 4.2 / 4.3 and `slack` 2.3 / 2.4. **A union can describe a shape that no
   single version accepts** — the model is being taught a node that does not exist.
4. **A key absent from his flows does not exist.** The catalogue is a floor derived from what he
   already built. Anything he has never used is invisible, which is exactly the case where the
   Tester is supposed to be most useful.

And the sandbox gate cannot catch any of it: **the n8n public API accepts any `parameters` object
without validating it.** The flow is created, the gate goes green, and the defect surfaces on
import — the exact moment Kauan is counting on it.

## The sources — all four probed live, 2026-08-12

Nothing below is a plan resting on a "should work".

### 1. The authoritative node schema, from npm — **the keystone**

`https://cdn.jsdelivr.net/npm/n8n-nodes-base@<v>/dist/nodes/<Path>.node.js` serves the compiled node
descriptor. ~28KB per node, no auth, no npm install, no build step.

Loading it needs the module's three imports stubbed (`n8n-workflow`, `lodash/set`, `./utils`) —
a `Module._load` hook returning a Proxy, plus a real 6-line `VersionedNodeType` so multi-version
nodes unfold. **Proved end to end:**

```
redis    → 26 properties;  operation enum = delete,get,incr,info,keys,llen,pop,publish,push,set
                           propertyName: default "propertyName", shown only when operation=get
if       → per-version: v1(2 props) v2 v2.1 v2.2 v2.3(3 props each)
                           conditions: type "filter"; looseTypeValidation only when @version >= 2.1
```

Read that Redis line again: **the schema encodes the exact fact that cost this project real
debugging time.** It was always downloadable.

What each property carries: `name`, `type`, `default`, `options` (the enum, with descriptions),
`displayOptions.show` (under which `resource`/`operation`/`@version` the key even applies),
`required`, `placeholder`.

Path map: `GET https://registry.npmjs.org/n8n-nodes-base/<version>` → `n8n.nodes`, 438 declared node
paths, 43KB, one call. Matching his 52 catalogued types by file basename: **34 hit directly.** The
18 misses are honest and each has a route — 13 are `@n8n/n8n-nodes-langchain` (a second registry
fetch, same technique, and it is the whole agent stack), 4 are `*Tool` wrappers that map to their
base node by dropping the suffix, 1 is the ElevenLabs community package (also on npm).

⚠️ `unpkg.com` returned 500 on two of five requests during the probe. `cdn.jsdelivr.net` answered
every time. Use jsdelivr, keep unpkg as fallback, and **cache by package version forever** — a
descriptor for a fixed version is immutable, so this is a download that happens once per node type
per n8n release.

### 2. A corpus of ~1850 real, working flows — the n8n templates API

No auth, public.

```
GET https://api.n8n.io/templates/search?rows=N&page=P&nodes=<type>   → ids + node metadata
GET https://api.n8n.io/templates/workflows/<id>                     → the full workflow JSON
```

Probed: `totalWorkflows` 1854, the `nodes=` filter works, and each search row already carries
`typeVersion`, `displayName`, categories, and `codex.data.resources.primaryDocumentation.url` — the
official docs link per node type, for free.

This is the only source for the shapes the schema cannot express (see below) on node types **he has
never used**, and the only source of real *topology* patterns: error branches, pagination, batching,
webhook→respond.

Caveat that must be enforced in code: the corpus is old in places (template #1 is from 2019, all
`typeVersion: 1`). **A template exemplar is only usable when its `typeVersion` matches the version
his instance runs.** Filter first, then use.

### 3. His own 70 flows — already read, currently under-mined

`catalog.js` already fetches every raw workflow. It measures shape and throws the values away.

### 4. What was checked and does not work

- `GET /types/nodes.json` on his n8n Cloud instance → **401**. `/rest/node-types` and
  `/api/v1/node-types` → **404**. The editor's own schema endpoint is not reachable with a public
  API key. Do not re-derive this.
- `n8n-mcp` (czlonkowski) ships a prebuilt SQLite DB of 2412 nodes and would be a shortcut —
  `node:sqlite` is available in Node 22.18, so even zero-dep it is technically possible. **Not
  recommended:** it makes a third party's build artifact the source of truth for what the cockpit
  believes about n8n, versioned on their schedule, when the primary source is one HTTPS GET away.
- n8n's own `workflow-builder` skill targets `@n8n/workflow-sdk` — workflows authored as
  **TypeScript**. Real and vendor-owned, and the wrong shape here: the Tester's output is JSON that
  Kauan pastes into the editor, with no npm and no build step anywhere in the product.

## The finding that decides the architecture

**The schema and the exemplar are complementary, and neither alone is enough.**

The schema says `if.conditions` has `type: "filter"`. It does **not** say what a filter looks like
as JSON — that shape lives in the editor widget, not in the property descriptor. Same for
`resourceLocator`, `fixedCollection` and `assignmentCollection` (which is all of `Set` v3.4).

So:

- **Schema** (npm) → the enums, which keys apply under which operation, defaults, required, per
  version. This is what makes "the model invented a key" a *detectable* fact.
- **Exemplar** (his flows, then templates) → the inner shape of the composite widgets. This is what
  makes the model write `{__rl: true, mode: "list", value: …}` instead of a bare string.

Any design that picks one source is a design that keeps one of the two failure modes.

## The proposal — six layers

### L1 · `esquema.js` — fetch and distill the authoritative schema

New module, same shape as `catalog.js`: fetch, distill, cache to `.cache-esquema.json`, versioned
(`ESQUEMA_V`), keyed by npm package version. Per `(type, typeVersion)` it stores: property names,
types, enums, defaults, required, and the `displayOptions.show` predicate.

Failure is **soft**: no network, or a type it cannot resolve, degrades to today's behaviour and says
so on screen. The Tester must never stop working because a CDN is down.

### L2 · `gramatica.json` — the mined exemplar per (type, version)

One redacted real node per pair, drawn from his flows first (they are the house style) and from a
version-matched template second. Structure kept whole; leaf values masked to `[PREENCHER]` **except**
values that are themselves schema enum members — `"get"` is an API verb, not data.

This is the layer that touches an invariant. See the decision below.

### L3 · The build session reads a grammar, not a sketch

`escreverContexto()` gains `gramatica.md` — for each type in play, and **only for the version being
used**: the applicable properties for the chosen `resource`/`operation`, their enums, and one
exemplar. Written to disk, not inlined, for the reason `prompt-budget-test.js` exists.

The current 60KB slice budget mostly disappears: the model no longer needs the whole catalogue when
it can be handed the ten properties that apply.

### L4 · The gate that ends silent wrongness — **the highest-value item on this list**

Two new checks in `validar()`, both pure code against L1:

- **Unknown key.** A parameter key absent from the schema for that `(type, typeVersion)` is a key the
  model invented. Today it imports and silently does nothing.
- **Inapplicable key or bad enum.** A key whose `displayOptions.show` does not hold under the chosen
  discriminators, or a discriminator whose value is outside the enum.

Both fail with a named message, which goes straight back to Claude — the retry loop that already
works. This converts the whole class of "imports clean, quietly wrong" into a round the cockpit
pays for and Kauan never sees.

Fail-open by construction: a type the schema could not resolve is **not** gated. A gate that fires
on missing knowledge would block real flows.

### L5 · `n8n-gramatica.md` — the prose file, in PT-BR

The `tester-agentes.md` pattern, generalised: anchor-delimited blocks, read at runtime, injected
into `promptDesenhar`. Not a dump of the schema — the things a schema cannot say. Seeded with what
this repository already paid for and currently keeps only in `CLAUDE.md`, where the model never
reads it:

- `redis get` returns the value under `propertyName`, never `value` — with the two live nodes it is
  currently killing named.
- `settings` keys the public API rejects (`pickSettings`).
- `active` is meaningless on a sub-workflow.
- Error handling as a default: `onError: continueRegularOutput` and `retryOnFail` on every write —
  measured 19/19 on the one agent build that got it right.
- Naming, `executionOrder: "v1"`, the expression subset.

**Every entry carries where it was measured.** An invented number here becomes an invented number in
every flow built from it — that rule is why `tester-agentes.md` is trustworthy and it carries over.

### L6 · The base that learns — the part that compounds

Three feeds, all from data the cockpit already collects and currently discards:

1. **From the gates.** When round N fails and round N+1 passes, the delta is a lesson:
   `(type, version, key, what was wrong, what passed)`. One line appended to `licoes.json`.
   Relevant lines get injected on later builds.
2. **From production.** An applied flow that later shows up on the `flows.html` error board carries
   a signature naming a node type. That is the strongest possible signal — the flow was built,
   approved, and broke in the real world. **This is the first thing that would make the two front
   doors feed each other**; today `blueprints.json`, `proposals.json` and `fixes.json` are three
   files joined by nothing.
3. **From Kauan's edits.** He already patches saved projects. A patch that changes a parameter is
   him correcting the model, in the exact `(type, key)` coordinates a lesson needs.

A lesson is a **claim with a source**, never a rule — it renders as "measured on build X" and is
promoted into `n8n-gramatica.md` by hand, by him. An auto-writing knowledge base poisons itself the
first time it learns from a wrong fix.

## The one decision that is yours

**L2 requires revising a hard invariant.** `catalog.js` says today, in the file, in bold: *a
parameter value never reaches disk.*

Mining exemplars means real parameter objects land in `.cache-*.json`. The precedent for how to do
this well is already in this repo — `n8n.js` crossed the content boundary exactly once, for the
execution summary, and it did it by **naming the fields** (`SAMPLE_MSG`, `SAMPLE_NAME`) rather than
widening the door.

The same discipline applies here, and it is genuinely narrower than the one already accepted:

- Only keys the schema declares as an `options` type, and only values that are **members of that
  enum**. `"get"`, `"POST"`, `"list"` — API verbs, in a fixed set, decided by n8n and not by anyone's
  customer.
- Every other leaf is replaced by `[PREENCHER]` **before** the object is serialised, not after —
  same ordering `claude-fix.js` uses for the diff, and for the same reason.
- Nothing from `credentials`, ever. That door stays shut.
- `caractere-test.js` and a new boundary test assert the absence rather than trusting it, the way
  `credenciais-test.js` already does.

Under those rules the exemplar for a Slack node is
`{select: "channel", channelId: {__rl: true, mode: "list", value: "[PREENCHER]"}, text: "[PREENCHER]"}`
— the shape, none of the content.

**My recommendation is to accept it, with those four rules written into the file the way the
existing invariant is.** The alternative — schema only, no exemplars — leaves `filter`,
`resourceLocator`, `fixedCollection` and `assignmentCollection` as guesses, and those four cover
`if`, `set`, `slack`, `googleSheets` and `httpRequest`, which is most of what he builds. The
information being written down is a shape, and a shape is what the model already gets wrong.

If you would rather not, say so and L2 becomes templates-only: the exemplars come from the public
corpus instead of from his flows. It costs house style and version match, and nothing of his
touches disk. The rest of the plan is unaffected.

## Order, and what each step is worth

| # | Step | Effort | Worth |
|---|---|---|---|
| 1 | **L1 + L4** — schema fetch, distil, cache; the two gates | ~1 day | ends the class of silent wrongness. Standalone: nothing else has to land first |
| 2 | **L3** — grammar in the prompt, per version, per operation | ~½ day | fewer rounds. Depends on L1 |
| 3 | **L5** — `n8n-gramatica.md` seeded from `CLAUDE.md` | ~½ day, mostly prose | moves knowledge the repo already owns into the place the model reads |
| 4 | **L2** — mined exemplars | ~1 day | closes the composite widgets. Blocked on the decision above |
| 5 | **L6** — the learning feeds | ~1 day | compounds, and only after 1–4 give it something worth learning |
| — | Templates corpus (source 2) | ~1 day | extends all of the above to types he has never used. Do it after 1–4 prove the shape |

**Do step 1 first even if the rest is rejected.** It is the only item that changes what the Tester
can *prove* rather than what it can *say*, it depends on nothing, and it fails soft.

## What this does not claim

- It does not make the flow correct. It makes the flow **structurally valid against the real node
  definitions** — which is a floor, not a ceiling, and the screen has to keep saying so.
- It does nothing about credentials or execution. The public API still has no execute endpoint.
- It will not survive an n8n release on its own: the cache is keyed by package version, so the day
  n8n ships a new one the schema must be re-fetched. That has to be visible on screen, not silent.
