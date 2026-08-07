# Plan: Tester — idea → n8n flow blueprint, drawn, validated and simulated
_Locked via grill — by Claude + Kauan, 2026-08-07. Revised after Codex round 1._

Repo: `Cockpit Projetos` (Node 22, zero runtime dependencies, `127.0.0.1` only).
Read `CLAUDE.md` in this repo first — its invariants bind this plan.

## Goal

A third front door in the cockpit, at `/tester`, where Kauan describes a flow he wants in plain
Portuguese and the system works out how to build it in n8n: it asks back what it needs to know,
researches the third-party API when no dedicated node exists, lists the nodes and credentials
required, draws the flow on the cockpit's existing graph canvas while writing it, renders the full
workflow JSON on screen, validates it deterministically, imports an **inactive, credential-free**
sandbox copy to prove the instance accepts the schema, and finally shows a **simulated** result
rendered in the shape of the destination surface (a Slack bubble, a listing card, a table row).

V1 stops at "here is the JSON, here is what it would produce, here is what will bite you". Kauan
imports it into n8n himself and attaches credentials himself. The system never writes to a real
workflow, never activates anything, never attaches a credential, and never executes a flow.

## Approach

### 0. Where it lives

1. New page `tester.html`, served at `/tester`. **Not** a tab inside `flows.html` — that file is
   3855 lines and its judgement block is the part Kauan tunes most; merging would degrade both.
   `tester.html` gets its own judgement block at the top of its page script, same discipline.
2. New server modules: `tester.js` (session lifecycle, stage machine, CLI spawn, SSE),
   `simulate.js` (the deterministic local simulator), `catalog.js` (node knowledge + docs cache).
   `server.js` only routes; `n8n.js` stays the security boundary.
3. UI copy in Brazilian Portuguese. Code, comments, this file in English.

### 1. Two sessions, not one — the containment split

This is the single most important structural decision, and it replaces the "one resumed session"
shape inherited from `claude-fix.js`.

**Session R — research.** Runs with an explicit, minimal policy, not an intention:

- `--allowedTools "WebSearch,WebFetch,Write"` — no `Read`, no `Edit`, no `Glob`, no `Grep`, no
  `Bash`, plus `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`.
- `cwd` is a dedicated **empty** directory, `.tester-runs/<id>/research/`, created for this session
  and containing nothing else. It has no access to the build dir, to the repo, or to `.env`.
- It receives a one-line question ("what does the Mercado Livre API expose for orders, how does its
  auth work, what are its rate limits") and **no knowledge of the flow being built**.
- **The server reads exactly one file back**: `api-<slug>.md`, at a path it computed itself. Any
  other file the session wrote is ignored and the directory is discarded wholesale. The server does
  not enumerate what was written and act on it; it asks for the one path it expects and treats its
  absence as "research produced nothing".
- **`<slug>` is derived server-side and never taken from model or user text.** The service name is
  normalised to `[a-z0-9-]{1,40}` plus a short hash of the original, and the resulting path is
  re-checked to be inside the intended directory before any read or write. The raw service name —
  which comes from a model that just read a web page — never reaches the filesystem. Same rule for
  the docs cache in §12.
- The session is **discarded** — never resumed, never carried forward.

**Session B — build.** Has **no network at all**: `--allowedTools "Read,Write,Edit,Glob,Grep"`,
`--strict-mcp-config`, `--mcp-config '{"mcpServers":{}}'`, exactly as `claude-fix.js` runs today.
It reads the distilled doc as *data*, plus the node catalog slice and the conversation state. It is
the session that writes the workflow JSON.

Why this shape:

- **Prompt injection is contained by construction.** Fetched pages only ever enter Session R, whose
  sole capability is to write one markdown file, and whose context is then thrown away. A poisoned
  page cannot reach the session that authors the workflow — it can only corrupt the *content* of
  the distilled doc, which is visible on screen with its source URL. Distilling and discarding the
  HTML inside a single long-lived session would have been theatre: the contamination stays in
  context and gets re-sent on every resume.
- **Model routing falls out for free.** Session R runs on a cheap model; Session B runs on the
  strongest. No mid-session model switch is needed, which removes an unverified assumption.
- **Cost falls out for free.** The 30–80k-char page is billed once, in a session that ends.

The conversation stages (`[ 01 ]`) run in a third short-lived session on the cheap model, whose
output is the structured understanding card — also data, not context, for Session B.

### 2. Environment isolation for every spawned session

The current spawn is `env: { ...process.env, N8N_API_KEY: "", … }` — it inherits everything, and
this repo already documents that the user's global hooks and `CLAUDE.md` load in headless mode. With
network now granted to Session R, inheritance is no longer acceptable.

1. **Allowlist env, not blocklist.** Build the child env from an explicit short list (`PATH`,
   `SYSTEMROOT`, `TEMP`, `USERPROFILE`, `APPDATA` and whatever the CLI provably needs), plus
   `CLAUDE_CODE_ENTRYPOINT=cockpit`. Nothing else crosses. This subsumes blanking
   `ANTHROPIC_API_KEY` / Bedrock / Vertex switches: they simply are not in the list, so billing
   cannot silently move off the plan.
2. **Config isolation — gate RUN, verdict PASS (2026-08-07, `iso-check.js`).** The mechanism is
   **`--setting-sources ""`**, with `cwd` an empty directory outside the projects tree. Measured:

   | strategy | global config loaded? | authenticated? |
   |---|---|---|
   | baseline (how `claude-fix.js` spawns today) | **yes** — including the n8n API key | yes |
   | `CLAUDE_CONFIG_DIR` at a fresh dir | — | **no**: "Not logged in" (isolates credentials too) |
   | `--setting-sources ""` | **no** | **yes** |
   | `--setting-sources project,local` | yes (hooks dropped, global `CLAUDE.md` still loads) | yes |
   | empty `cwd` alone | yes | yes |

   Two facts worth keeping: the global `CLAUDE.md` arrives through the **user** setting source, not
   through directory discovery — so an empty `cwd` alone isolates nothing. And `--bare` is
   deliberately not used: the CLI's own help states that under it "OAuth and keychain are never
   read" and auth requires `ANTHROPIC_API_KEY`, i.e. isolation bought with off-plan billing.

   **This matters beyond the Tester: the user's global `CLAUDE.md` contains a live n8n API key in
   plain text, and it is loaded into every headless session the cockpit spawns today.** That is
   currently contained only because those sessions have no network. `claude-fix.js` should adopt the
   same `--setting-sources ""` spawn.

   The gate remains a precondition for anyone re-running this work:
   - **Pass → Session R gets network.**
   - **Fail → Session R is not built with network at all.** The Tester still ships, `[ 02 ]`
     degrades to "não pesquisei documentação externa", and every node that would have depended on it
     is stamped `origem: memoria`. The feature is worth less; it is not worth turning off the only
     containment the design has. **In this mode `.cache-tester-docs/` is ignored entirely** — a
     cached distillation is still the product of external research, and reading it would keep the
     build depending on fetched web content while the screen claims it did not. Degraded means
     degraded, not "degraded except for what we already fetched".
   The rest of the plan may not be implemented ahead of this test, because the whole justification
   for granting `WebFetch` rests on it.
3. The panel states which auth mode is active, so "plan quota, no card" is visible rather than
   assumed.

### 3. Knowledge — three layers, provenance kept outside the workflow JSON

The system must be able to build flows for services it has never seen (worked example: "quantas
vendas fiz no Mercado Livre" — there is **no** Mercado Livre node in n8n, so that flow is
`Schedule Trigger` + `HTTP Request` + OAuth2 credential + `Code`).

1. **Instance catalog** (`catalog.js`): walk the 62 workflows via the existing client and distil,
   per node `type`, the `typeVersion`s actually in use and a **sanitized shape sketch** of the
   parameters — key names and value *types* only (`{ url: string, method: enum, jsonBody: expr }`).
   **Raw parameter values are never written to disk and never cached.** n8n `parameters` carry
   session keys built from lead phone and email; this repo classifies them as hostile payload, and
   a cache file is exactly where they must not land. Raw parameters stay in memory for the duration
   of the walk and are dropped.
2. **Full n8n node registry** (`node-registry.json`): a build-time artifact listing node types with
   their documented parameters, generated once by a script and committed. The cockpit process only
   reads a file, so the zero-dependency runtime holds.
3. **Session R's distilled doc** for the third-party API contract.

**Provenance lives in a parallel structure, never inside `nodes[]`.** A `provenance` map keyed by
node name (`{ "buscar_vendas_ml": { origem: "web", fonte: "https://…" } }`) is held by the session
and rendered by the UI. Putting `origem` inside a node object would ship a foreign field into JSON
that is both `PUT` to n8n and copied by hand into the editor — n8n rejects unknown fields on write
(see the `timeSavedMode` 400 already documented), and a copied flow carrying cockpit metadata is a
flow that fails on import for a reason nobody will diagnose.

Origins: `instancia | catalogo | web | memoria`. `memoria` is the confession that nothing confirmed
it. Same discipline as `originOf()` and `SUGGESTIONS` in `flows.html`: no match, no guess.

**Credential state is reported as what it actually is, and credential identity never leaves the
process.** `GET /api/v1/credentials` is **405 — GET not allowed** (verified live), so enumeration is
impossible. What can be derived is which credential *types* are referenced by existing workflows.
The UI says **"não encontrei essa credencial em nenhum fluxo seu"**, never "você não tem" — a
credential created and not yet used is invisible to this method, and claiming otherwise would be a
fabricated fact.

**Credential `id` and `name` stay process-local.** This repo already classifies
`error.node.credentials` — ids and names — as data that must not reach the browser or a cache file.
The seen/not-seen UI does not need them: what crosses is `{ tipo, visto: true|false }` and nothing
else. Required fields per type are real and safe to show:
`GET /api/v1/credentials/schema/{type}` returns them (verified: `redis` → 200 with `required`).

### 4. The seven stages, two of which wait for the user

```
[ 01 ] Entender      restate the intent as an editable card; ask what is missing   ← STOPS
[ 02 ] Pesquisar     Session R: research the API, distil, cite URLs, then discard
[ 03 ] Ingredientes  nodes needed + credential schemas + seen/not-seen in your flows
[ 04 ] Desenhar      Session B writes the workflow JSON; drawn node-by-node as written
[ 05 ] Validar       deterministic gates, then inactive credential-free sandbox import
[ 06 ] Fantasma      simulate; render the result in the destination's shape         ← STOPS
[ 07 ] Entregar      blueprint + copyable JSON + risks + improvements
```

Stops at `[ 01 ]` and `[ 06 ]` only; the other five stream. A stage that did no real work does not
go green — if `[ 02 ]` found no documentation it says so, and that propagates into every downstream
node's origin stamp.

**Interrupting is "restart from this message", not a live patch.** Typing during `[ 04 ]` cancels
the in-flight work and re-enters the stage machine from the affected stage. Every session carries a
**generation token**, checked immediately before every SSE emit, every disk write and every n8n
call; a superseded generation is dropped. The reused machinery is strictly linear and has no such
fence, so "recompute from that stage forward" without one would let a cancelled round's output
overwrite the new state — including writing a stale proposal into the sandbox.

### 5. The conversation

- **Questions arrive in batches of at most 3**, each with suggested answers as clickable chips.
- **What it understood is an editable card** (`quando · o que faz · resultado · onde chega`).
  Unknown fields render in amber saying they are unknown — never filled with a plausible value.
- **Findings accumulate in a side panel from `[ 01 ]` onward**, stamped `FATO` / `A CONFIRMAR` /
  `SUGESTÃO`. Errors-that-could-happen and improvements are this panel, not a stage.
- **Knowledge level** (`nunca mexi` / `sei o básico` / `sou técnico`), chosen before sending and
  changeable mid-conversation, changes register only. It describes grip on **the flow's domain**,
  not on n8n.

### 6. Cost control

The CLI authenticates via `claudeAiOauth`, `subscriptionType=team`; there is no `ANTHROPIC_API_KEY`
anywhere. Consumption is plan quota — the same 5h/7d window as Kauan's interactive sessions.

1. Env allowlist (§2) keeps billing on-plan by construction.
2. Cheap model for conversation and for Session R; strongest model for Session B.
3. Raw pages die with Session R and are never resent.
4. Distilled docs are cached across sessions by service (see §10), so a second Mercado Livre flow
   pays no research.
5. **Hard per-session ceiling** on invocations and on reported cost; on trip the session stops and
   the screen says it stopped for cost.
6. **Refinement is free** — the simulator, the gates, the catalog, the credential schema lookup and
   the graph rendering are local code. Changing the seed and re-rendering the ghost costs nothing.

**Cost is recorded per CLI invocation, not per logical stage.** The CLI reports `total_cost_usd`
only on the `result` event of an invocation. Because the stages are already split across separate
sessions (conversation / research / build), per-invocation granularity happens to line up with the
expensive boundaries — but the ledger labels it for what it is and never implies a precision it
does not have.

Measured baseline for the sibling feature (`proposals.json`, 14 real runs): median US$1.44, max
US$2.19. Estimated US$3–6 equivalent for a Tester build needing research. `blueprints.json` records
per-invocation cost so that after ~3 builds the panel shows a measured median instead of this
estimate, reusing the existing `estimate()` pattern (median, not mean; below 3 samples, no ETA).

### 7. Validation — the gates

Deterministic, in `tester.js`, mirroring `validate()` in `claude-fix.js`. A failed gate hands the
failed lines back to Session B verbatim for up to `MAX_ROUNDS`; a proposal that never passes never
becomes a downloadable JSON.

1. **Proposal parses and matches an exact top-level schema: `{ name, nodes, connections, settings }`
   and nothing else.** Any other top-level key is a gate failure, not something to strip. This
   matters because `putWorkflow` already builds its body field by field: if the model emits extra
   top-level fields, the sandbox would test a sanitised document while the user copies a different,
   possibly invalid one from the screen — a green `[ 05 ]` certifying a JSON that was never tested.
   **The JSON displayed, exported and copied is the same object sent to the sandbox**, differing
   only in `name` (the sandbox carries the `[SANDBOX tester] ` prefix), and the screen states that
   one difference explicitly.
2. Exactly one trigger node, of a known trigger type.
3. Every node `type` resolves against catalog or registry; unresolved types are allowed but forced
   to `origem: memoria` and surfaced as a finding.
4. Every connection resolves to an existing node. **Port names are only checked for node types
   present in the instance catalog**, where the observed connections give real port names for a
   real `typeVersion`. `node-registry.json` documents parameters, not input/output port schemas, so
   a port gate over registry-only types would be unenforceable — and a gate that cannot fail is
   worse than no gate, because it reads as coverage. Widening it requires adding ports per
   `type@typeVersion` to the registry, which is listed as follow-up work, not assumed.
5. No orphan node (sticky notes excluded, as in `isAnnotation()`).
6. Node names unique, non-empty, no control characters.
7. **No `credentials` key anywhere in the proposal.** The model never authors one. Credentials are
   named in the blueprint for the human to attach in the editor.
8. **No `active` key anywhere in the proposal** — not in what is sent to n8n, and not in what is
   displayed, exported or copied. Rejecting it only on the write path would still hand Kauan a JSON
   that activates a webhook the moment he imports it.
9. No node object carries cockpit metadata (`origem` and friends live outside the JSON).
10. `settings` filtered through the existing `pickSettings()` whitelist, dropped keys reported (the
    `timeSavedMode` 400 is documented in `CLAUDE.md` and cost real time).
11. No secret-shaped literal in any parameter value.
12. Node shape valid (position numeric, `typeVersion` numeric).

### 8. The one write, its fence, and the invariant it revises

The Tester's only write is `createWorkflow` / `putWorkflow` against a sandbox copy:

- The name **must** start with `[SANDBOX tester] `. Enforced server-side, and on update the
  target's current name is re-read and re-checked before the `PUT`. The Tester cannot touch an
  existing workflow even if handed its id.
- `active` is never sent. `credentials` is never sent.
- Reused by name across rounds. Never deleted automatically — this codebase does not delete.
- Disabled entirely by `COCKPIT_TESTER_SANDBOX=0`.

**This is a formal revision of the repo's write boundary, and it is written down as such.**
`CLAUDE.md` currently states that the only write is an approved diff clicked by Kauan. This adds a
second write class, stated as the surface actually is rather than as its first run looks:
***creating or updating exactly one inactive, credential-free workflow whose name carries the
`[SANDBOX tester] ` prefix***, in a session Kauan started, during a stage the screen announced before
running it. The copy is reused by name across rounds, so from round two onward this is a `PUT`
against an existing workflow — an invariant that described only the `POST` would be describing the
idealised first execution, not the write that happens every other time. The reasoning for keeping it on by default rather than behind a per-run click: the
object being written is a draft that did not exist a second ago and can affect nothing, while the
alternative — shipping unproven JSON — is precisely the failure this stage exists to catch, because
static gates cannot detect a `typeVersion` the instance rejects (the `timeSavedMode` 400 is the
proof). `CLAUDE.md` must be amended in the same commit that implements this; an invariant silently
broadened is worse than one deliberately changed.

**What the sandbox import proves, stated on screen: schema only.** No credentials are attached, so a
green sandbox means "n8n accepts this document", never "this flow is ready to run". The panel says
that in those words, next to the result.

`POST /api/v1/workflows` exists; there is **no execute endpoint** in the instance's own
`openapi.yml` (verified: only `/executions/{id}/retry`, which replays a past run with real side
effects). Execution is not merely out of scope — it is unavailable.

### 9. The ghost (`simulate.js`) — narrow, honest, fail-closed

The result screen is **derived from the JSON by local code**, never narrated by a model: a model
asked what its own flow would produce always answers that it works.

- **Outbound is derived.** The text a Slack node would send is that node's `text`, with `{{ }}`
  expressions resolved against upstream output. If nothing upstream defines `$json.titulo`, the
  field renders empty and the screen says *"nenhum nó anterior define `$json.titulo`"*. That is the
  ghost having teeth.
- **Inbound is seeded.** What the Mercado Livre API would answer is unknowable without calling it.
  The seed is generated from the researched contract, always visible, labelled with its origin, and
  **editable** — pasting a real API response turns the ghost into real input + real logic with zero
  network, the strongest test available without executing.

**V1 simulates a deliberately narrow class of flow, and refuses the rest.** Reducing only the
expression language is not enough: the hard part is n8n's execution semantics — item arrays,
branching, `IF`/`Switch`/`Merge`, multiple outputs, `Code` running arbitrary JavaScript. A simulator
that half-models those produces a confident wrong picture, which is worse than no picture.

- **Supported in V1:** a linear, single-item path (one trigger, no branch merge, no loop) whose
  nodes come from a short whitelist — `scheduleTrigger`, `webhook`, `httpRequest`, `set`, `if`
  (single taken branch), and the terminal message/row nodes needed to render a destination surface.
- **Expressions — measured, and the measurement changed the answer.** `node catalog.js --refresh`
  over the 62 workflows found **2284 expressions**. The subset this plan originally named covered
  **46%** of them, because it included the legacy `$node["Nome"]` (**0 occurrences** on this
  instance) and excluded the modern `$('Nome')` (**1019 occurrences**). Corrected subset —
  `$json.x`, `$('Nó').item.json.x`, `$now`/`$today`, string concatenation — covers **88%**.

  | family | count | in V1 subset |
  |---|---|---|
  | `$json` | 1084 | yes |
  | `$('Nó')` | 1019 | yes |
  | template literal | 138 | no |
  | `$if` / ternary | 81 | no |
  | JS method (`.map`, `.split`, …) | 63 | no |
  | `$now` / `$today` | 44 | yes |
  | `$execution` | 19 | no |
  | `$input`, `$items()`, `$env`, `$vars` | 5 total | no |

  `SIMULAVEL_V1` in `catalog.js` is the single source of that list; changing it means re-running the
  scan and re-reading the percentage before promising anything on screen.
- **Outside that set the ghost does not render a result.** It states which node or which expression
  it cannot simulate, and why. `⟨não simulada⟩` for a field; a refusal for a flow. **Fail closed** —
  no partial picture presented as an outcome.
- **Render per destination surface**: Slack bubble, WhatsApp bubble, table row, calendar event,
  listing card, with a generic JSON view as fallback. The bubble is real; the data inside it is
  seeded, and the screen says exactly that.

### 10. The construction animation

Variant **A — Escrita**, chosen from a rendered comparison (`preview/tester-graph-variants.html`).
The canvas is the cockpit's existing stage renderer, same `.nd` / `.edge` classes and tokens. Nodes
appear as they are written: dashed accent outline plus a blinking caret, then settle; the edge draws
before the next node is born. The same animation settles into the final state.

**The green ✓ and the `Nms` label are removed.** In that component they mean "this node executed
successfully", and nothing here executed.

**The footer states the current truth, and it changes.** A fixed
`nada foi criado no n8n · nenhuma chamada feita` becomes a lie the moment `[ 05 ]` creates the
sandbox copy — which is exactly the failure mode `HANDOFF_TRUTH` and `APPLY_CAVEAT` exist to
prevent, and it would be this feature committing it. So the footer is derived from what has actually
happened in the session:

| Until `[ 05 ]` writes | `nada foi criado no n8n · nenhuma chamada feita` |
| After the sandbox write | `cópia de teste criada no n8n: [SANDBOX tester] <nome> · inativa · sem credenciais · seu fluxo original intocado` |
| If the sandbox is off | `nada foi criado no n8n · a cópia de teste está desligada` |
| If the sandbox write failed | `não consegui confirmar se a cópia de teste foi criada (<motivo>)` |

The failure wording is deliberate. A `POST`/`PUT` that errors proves the absence of a *confirmation*,
not the absence of an *effect* — the write may have landed and the response been lost. This repo
already reasons that way, which is why writes are never retried. Saying "não foi feita" would be
asserting a fact nobody observed. The panel may upgrade the message to a definite one **only** after
a subsequent `GET` establishes the actual state.

The `[ 06 ]` ghost keeps its own separate statement (`simulação — nenhuma chamada foi feita a
<serviço>`), because "a workflow document was created" and "an external API was called" are
different claims and collapsing them would let one cover for the other.

Motion follows the ported cult-ui rules already in the repo: `--accent` only, no coloured glow
shadows, nothing re-animates without new information, `prefers-reduced-motion` drops the motion and
keeps every stage and fetch.

### 11. API surface

| Route | Does |
|---|---|
| `GET /tester` | serves `tester.html` |
| `GET /api/tester/status` | CLI found, n8n configured, auth mode, sandbox on/off |
| `POST /api/tester/session` | start `{idea, level}` → `202 {sessionId}`; one at a time (409) |
| `POST /api/tester/session/:id/reply` | user message, chip answers, or gate decision |
| `GET /api/tester/session/:id` | snapshot: stage, findings, card, graph, JSON, gates, cost |
| `GET /api/tester/session/:id/stream` | SSE: full snapshot first, then deltas |
| `POST /api/tester/session/:id/simulate` | re-run the ghost with a seed. Local only, no model, no cost |
| `POST /api/tester/session/:id/sandbox` | create/update the `[SANDBOX tester]` copy — fenced, see below |
| `GET /api/tester/blueprints` | the ledger |

**`POST …/sandbox` takes no workflow JSON from the client.** Its body carries only the session id and
the generation token. The server writes the proposal it holds in memory for that session, and
refuses unless all of these hold: the token matches the **current** generation, the session is in
the post-gates state, and every gate passed. A client-supplied document, a superseded generation or
a pre-gate session is a `409`, not a write. Without this the endpoint would reintroduce exactly the
stale-write race the generation token exists to close — the fence has to live on the route, not only
in the stage machine that normally calls it.

Guards mirror the existing ones: session id `t[a-z0-9]{1,32}`, idea capped, level enumerated, body
caps, `..`/separator rejection, upstream 409/503 passed through rather than collapsed to 500. Every
client call goes through the existing `callApi()` discipline — never `res.json()` directly, because
`JSON.parse("404")` succeeds and that bug already burned this codebase once.

### 12. Persistence

**One rule above all of these: every filesystem path in the Tester is built from a server-derived
slug, never from model or user text.** Service names, flow names and ideas are normalised to
`[a-z0-9-]{1,40}` plus a short hash of the original, and the resulting path is re-checked to be
inside its intended directory before any read or write. The human-readable original is kept
*inside* the file, never in its name.

- `.tester-runs/<id>/` — session scratch: the distilled doc, the sanitized catalog slice, the JSON
  under construction, the seed. Gitignored. **No credentials and no raw n8n parameter values are
  ever written here.**
- `.cache-tester-docs/<slug>.md` — distilled API contracts. **Gitignored cache, not tracked
  knowledge**, with a provenance header (source URLs, fetch date) and a TTL after which it is
  re-researched. Web text is third-party-controlled and drifts; promoting it to a versioned repo
  document would make a poisoned or stale fetch permanent. Promotion to a tracked doc is a manual
  decision, per file, when a contract has earned it.
- `.cache-catalog.json` — sanitized node shape sketches only. Gitignored.
- `blueprints.json` — one entry per session: idea, level, stages reached, gate verdicts, sandbox id,
  per-invocation cost, whether the JSON was exported. Tracked in git, holds no workflow JSON.

## Key decisions & tradeoffs

1. **Blueprint + full JSON on screen; the cockpit does not create the real workflow.** Kauan imports
   by hand and attaches credentials by hand. Rejected: auto-creating it (V2).
2. **Two isolated sessions — research (network, disposable) and build (no network)** — instead of
   one resumed session. This is the containment boundary for prompt injection, and it also removes
   the unverified mid-session model switch and cuts the cost of large fetched pages.
3. **Allowlist environment for every spawn**, replacing the inherit-and-blank pattern.
4. **Instance catalog + committed registry + researched doc**, in that order of trust, with
   provenance held outside the workflow JSON.
5. **Only sanitized parameter shapes are cached**, never real n8n parameter values.
6. **Static gates always; inactive, credential-free sandbox import on by default; execution never.**
   The sandbox is a formal, written revision of the repo's write boundary, not a quiet widening.
7. **The ghost is fail-closed and narrow**: linear single-item flows over a whitelist of node kinds;
   outside it, a stated refusal rather than a partial picture.
8. **Interruption means restart-from-here, guarded by a generation token** — not a live patch.
9. **Credential state is reported as "seen / not seen in your flows"**, because enumeration is
   impossible on this API.
10. **Stops at stage 1 and 6 only**; questions batched (≤3); separate page and modules; single-user
    V1 with multi-user kept possible only where it is free.

## Risks / open questions

1. **Residual prompt-injection risk.** Session R can still be steered into writing a *wrong* doc,
   and Session B trusts that doc. The defences are: Session R can only write one markdown file, has
   no n8n key and no build context; the doc is shown on screen with its source URLs; every node it
   influences is stamped `origem: web`; and all gates are code. A poisoned doc yields a
   wrong-but-valid flow that Kauan reviews before importing.
2. **CLI config isolation is the plan's load-bearing prerequisite.** It is now a binary build gate
   (§2): the isolation test runs first, and a failure means Session R ships without network rather
   than the feature shipping without containment.
3. **Building `node-registry.json` is real work** and its generation method (scrape, package, or a
   third-party dataset) is not settled. Fallback for V1: instance catalog plus a curated subset of
   common nodes, everything else `memoria`. Largest scope risk in the plan.
4. **The simulator's whitelist may be too narrow to be useful.** If most real ideas branch or fan
   out over items, `[ 06 ]` will refuse often. That is the correct failure, but it may mean the
   ghost earns its place only in V2. Measure against the 62 workflows before building it.
5. **A passing sandbox is not a working flow** — no credentials, no network, no rate limits, no
   pagination were exercised. The screen must say so in the register of `APPLY_CAVEAT`.
6. **Quota competition.** Tester runs eat the same 5h/7d window as Kauan's interactive work. Hard
   ceiling and free local refinement are the mitigations; the budgets cannot be isolated.
7. **Paid overage on the Team plan** cannot be read from this machine. If the org enabled it,
   exceeding quota bills. Flagged for Kauan to check once in the console.
8. **Sandbox copies accumulate** in an instance already holding 62 workflows. Nothing is deleted
   automatically; the flow panel needs a filter so they do not pollute it.

## Out of scope

- Creating or updating any workflow that is not `[SANDBOX tester] …`; activating anything;
  attaching credentials; retrying an execution; deleting anything.
- Executing a flow, real or dry — the public API has no such endpoint.
- Multi-user, authentication, hosting, per-person quotas.
- V2: "send the idea and it builds everything" without the review stops.
- Merging the Tester with the disk portfolio or the flow panel into a single view.
