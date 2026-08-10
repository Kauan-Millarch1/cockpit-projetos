# Cockpit de Projetos

Single-user control panel for every project under `C:\Users\kauan.millarch_ecomm\Desktop\Projects`.
Kauan runs ~20 projects in parallel and loses sight of them. The cockpit answers one question:
**which projects are alive, which are rotting, and what do I do about it.**

UI copy is Brazilian Portuguese. Code, comments, and this file are English.

## Status

v2 shipped: **the front door is now the live n8n flow panel** (`flows.html`), fed by a poll of the
n8n Cloud public API pushed to the browser over SSE. It answers "what is running, what broke, and
in which node" from real execution data, including a replay of a run across the actual workflow
graph. The v1 disk scanner still works, moved to `/disco`.

Clicking **"⧉ Mandar pro Claude"** on any signature no longer stops at the clipboard. It re-reads
the flow and the failed execution from n8n live, then **spawns the local Claude Code CLI headless**
on the failing workflow. Claude writes a patch, deterministic gates judge it, and a failed gate goes
straight back to Claude for another round. What lands on screen is a **pull-request review**: the
gate verdicts, Claude's root-cause report, and a per-node diff. **"✓ Aprovar e aplicar"** is the one
button in this codebase that writes to n8n — and it writes exactly the diff that was on screen.
Applying keeps a backup, so **↺ Desfazer** restores the previous state.

The error board closes the loop: each signature can be marked **"correção feita"** with a note
describing what was changed (persisted in `fixes.json`, auto-reopened if the failure recurs, note
resurfaced the next time the same node+type fails anywhere), carries a heuristic suggestion of what
to do, filters to a single flow when its card is clicked, and can be handed to Claude as a
copy-pasteable briefing.

**v3 added a third front door: `/tester`.** The other two answer "what is running and what broke".
This one answers **"how do I build the thing I have in my head"**. Kauan describes a flow in plain
Portuguese; the panel asks back what it needs, researches the third-party API when no dedicated n8n
node exists, lists the nodes and credentials required, **draws the flow node by node as it is
written**, renders the full workflow JSON, validates it against twelve deterministic gates, imports
an **inactive, credential-free** `[SANDBOX tester]` copy to prove the instance accepts the schema,
and finally shows a **simulated** result rendered in the shape of its destination — a Slack bubble,
a WhatsApp bubble, a table row. He imports the JSON by hand and attaches credentials himself.

Measured on real builds: a notification flow is **~US$1 and ~3 minutes**; a conversational agent is
**US$3.19 and 13.6 minutes for 65 nodes** — gates passing on the first round in both cases.
The full design is in `PLAN.md`, locked by grill and hardened by five rounds of adversarial review
by a second model (`PLAN-REVIEW-LOG.md` carries the whole argument).

Scope is deliberately n8n-only for now — the disk portfolio and n8n live state are not yet merged
into one view. Not yet built: markdown pipeline, ClickUp, project type/tier, deploy beyond
localhost. **The Tester does not attach credentials and does not execute** — the public API has no
execute endpoint at all, so that is not a scope choice.

## Run it

Double-click `start-cockpit.cmd` — checks for Node, warns if `.env` is missing, opens the browser,
runs the server in a window that stays up until closed. Or manually:

```
node server.js          # http://localhost:4317
```

Node 22, zero dependencies, `127.0.0.1` only.

**`.env` is required for the flow panel** (gitignored, never commit it):

```
N8N_BASE_URL=https://ecommercepuro.app.n8n.cloud
N8N_API_KEY=<public API key>

# opcionais — correção pelo Claude
CLAUDE_BIN=C:\Users\...\.local\bin\claude.exe   # só se não estiver no lugar padrão
COCKPIT_CLAUDE_MODEL=sonnet                     # padrão: o modelo padrão do CLI
COCKPIT_SANDBOX_TEST=1                          # liga o teste numa cópia inativa (padrão: off)
```

Without it the server still boots and `/disco` works; the flow panel shows an honest error state.
Without the Claude CLI the panel degrades to the old clipboard handoff **and says why** — it never
pretends a session ran.

URL flags on the flow panel: `?static=1` freezes it to a single read (SSE holds a connection open
forever, which blocks headless capture and simple embedding), `?theme=light|dark` forces the theme.

**Do not run the server as a Claude Code background task.** Those processes get killed when the
harness reaps them, so the cockpit dies mid-session. Start it from a real terminal or the `.cmd`. Scan is cached to `.cache-scan.json` for 15 minutes;
the "Atualizar varredura" button forces `?refresh=1`.

## Files

| File | Role |
|---|---|
| `server.js` | Local HTTP server, disk scanner, SSE broadcaster. **Emits facts only.** |
| `n8n.js` | n8n Cloud API client. **Security boundary + facts only.** Read-only above the marked `WRITE PATH` block; below it, the four functions the approve/revert path uses. |
| `claude-fix.js` | Spawns the Claude Code CLI headless, applies its patch, runs the gates, builds the redacted diff, and owns the only two calls that write to n8n. **Facts only** — whether a proposal is good is decided on the review screen. |
| `flows.html` | Front door: live n8n flow panel. **Holds all judgement.** |
| `cockpit.html` | v1 disk portfolio, served at `/disco`. **Holds all judgement.** |
| `00-research.md` | Research that produced the design. Reference implementations, PPM requirements, layout rules, locked decisions. |
| `.env` | n8n credentials. Gitignored. |
| `fixes.json` | Error signatures Kauan marked as fixed (exec id at mark time) plus the append-only history of what he wrote he changed. **Tracked in git — not a cache.** It cannot be regenerated from the API, and the notes are the only record of how each failure was actually solved. |
| `proposals.json` | One entry per Claude run: signature, gate verdicts, diff summary, report, whether it was applied and when. **Tracked in git — not a cache.** It is the record of what the cockpit proposed and what Kauan decided. Deliberately holds no workflow JSON. |
| `.claude-runs/<id>/` | The session's scratch dir — what Claude sees. Gitignored. Holds `workflow.json` (credential-free), `nodes-index.md`, `target-nodes.json`, `failure.md`, `RULES.md`, plus the `patch.json` and `report.md` it writes. |
| `.claude-runs/_private/<id>.json` | Pre-apply backup — the raw workflow **with** credentials. Outside the session's cwd on purpose. Gitignored. Source of ↺ Desfazer. |
| `tester.html` | The Tester, served at `/tester`. **Holds all judgement** for that page, in one block at the top. |
| `tester.js` | The Tester's stage machine: two isolated sessions, generation tokens, the twelve gates, the sandbox fence, the ledger. **Facts only.** |
| `simulate.js` | The ghost. Derives what a flow **would** send by resolving its own expressions. Fails closed outside a declared class. No `eval`, ever. |
| `tester-agentes.md` | **The domain knowledge for conversational agents**, in prose, read at runtime. Four anchor-delimited blocks are injected into the Tester's prompts. Editing it changes what the Tester builds — no code change, no restart. Every fact in it was measured in the live flows. |
| `agentes.js` | The machine around that doc: extract a block, decide whether an idea is an agent, and the gates that only apply to one. **No knowledge lives here** — it lives in the `.md`. |
| `agentes-test.js` | Proves each agent gate rejects the specific defect it exists for, and that the doc parses. Free — no model, no cost. `node agentes-test.js`. |
| `prompt-budget-test.js` | Builds the **worst case** of every prompt and proves it fits the command line. The prompt travels in `-p`; overflowing it fails as `spawn ENAMETOOLONG`, which names neither the prompt nor the size. `node prompt-budget-test.js`. |
| `edicao-test.js` | The patch applier for a saved project: what a request can and cannot do to a flow that already exists. Every test rejects one named defect, and the list is the same one `promptEdicao` promises the model — that is what stops prompt and code from drifting apart. Free. `node edicao-test.js`. |
| `caractere-test.js` | No control character in any served or prompt-injected file, reported with line and column. This file is what the note below about U+0000 in a cache key always claimed existed. `node caractere-test.js`. |
| `testar.cmd` | Double-click: runs every test that costs nothing. `tester-smoke.js` is deliberately left out — it bills the plan. |
| `catalog.js` | What this instance actually accepts, distilled from the 62 live workflows. **Only sanitized parameter shapes reach disk — never values.** Since 2026-08-10 it also carries `credenciaisConhecidas`: credential **type, id and name** referenced by his flows. The secret is not there and never can be — the public API does not return credential values. Cache is versioned (`CACHE_V`); bump it on any shape change. |
| `credenciais-test.js` | The per-node checklist and the auto-attach rule, plus one boundary test: no credential name may reach the catalogue slice the build session reads. Free. `node credenciais-test.js`. |
| `lixeira-test.js` | Delete moves, restore returns whole, permanent delete ends it. Runs against the real `projetos/` — that is the directory the functions know — with a `zz-teste-lixeira-*` fixture cleaned up in a `finally`. Free. `node lixeira-test.js`. |
| `iso-check.js` | The build gate that had to pass before the Tester's research session was allowed network. Re-run it after any CLI upgrade. |
| `tester-smoke.js` | Drives a whole build headless. What decides whether the Tester is worth anything is the flow that comes out, not the screen. |
| `blueprints.json` | One entry per Tester build: idea, stages, gate verdicts, sandbox id, cost per invocation. **Tracked in git.** |
| `PLAN.md`, `PLAN-REVIEW-LOG.md` | The Tester's locked design and the full record of the adversarial review that hardened it. |
| `.cache-scan.json`, `.cache-n8n-exec.json`, `.cache-catalog.json`, `.cache-tester-docs/`, `.tester-runs/` | Caches and scratch. Disposable, gitignored. The docs cache is **deliberately not tracked**: it is third-party web text with a TTL, and a poisoned or stale fetch must never become permanent. |

## The core invariant

**`server.js` and `n8n.js` state facts. The HTML judges them.** The server never decides a project
or a flow is unhealthy, stale, or risky; it reports counts, timestamps, git output, execution
status, node timings and error strings. Every threshold, band, grouping rule and diagnosis sentence
lives in the marked judgement block at the top of the page script — `flows.html` has `BANDS`,
`SCRATCH`, `naPorta`, `motivoPorta`, `projectOf`, `classify`, `diagnose`, `errorKey`, `similarKey`, `isAnnotation`,
`fixState`, `cardPref`/`toggleFav`/`hideCard` (favorite/removed — see below), `SUGGESTIONS`/`suggestFor`, `originOf`/`nodeOrigin`/`errNodeLabel`,
`HANDOFF`/`STAGE_MAP`/`HANDOFF_TRUTH`/`APPLY_TRUTH`/`APPLY_CAVEAT`; `cockpit.html` has
`BANDS`, `WEIGHTS`, `computeHealth`, `diagnose`, `buildChecks`, `isGenerated`.

Keep it that way. The definition of "healthy" is the part Kauan tunes most often, and splitting it
across the server would mean every tweak requires a restart and a cache bust.

## The other invariant: n8n payloads are hostile

`n8n.js` is a **security boundary**, not just a client. The raw API returns things that must never
reach the browser or a cache file:

- `error.node.credentials` — credential ids and names (verified present in live responses).
- `error.node.parameters` — session keys built from lead phone/email.
- `runData[node][].data` — full execution payloads, i.e. real customer conversations.

Every response goes through an explicit whitelist (`extractWorkflow`, `extractGraph`,
`extractExecRow`, `extractExecDetail`). **If a field is not named there, it does not exist
downstream.** The API key never leaves the process. Never widen these functions to "just pass the
object through"; verify after any change by grepping a live `/api/n8n/*` response for `eyJhbGci`,
`credentials` and `sessionKey`.

**`getRawWorkflow` is the one deliberate hole**, added for the Claude fix path. It returns the
unfiltered workflow — credentials and all — and it is process-local: no HTTP route serves its
output. `claude-fix.js` is what keeps that honest, in three layers:

- **The session never sees credentials.** `sanitizedWorkflow()` strips every `credentials` block
  before anything is written into the scratch dir, and `redactWorkflow()` also replaces anything
  shaped like a token in a parameter value. Verified on the live 33-node flow: 20 credential blocks
  in the raw workflow, zero in the dir.
- **The backup lives outside that dir.** It is the only file that still carries credentials, and
  Claude has no Bash and no `--add-dir`, so it is out of reach.
- **The diff is redacted before it is built**, not after. Both sides go through `redactWorkflow()`
  and `credentials` is excluded from the serialized node text, so there is no moment where a
  credential exists in an object headed for the browser.

## API

| Route | Returns |
|---|---|
| `GET /api/n8n/overview` | Workflows (whitelisted), the 24h execution window, and extracted detail for every errored run. |
| `GET /api/n8n/stream` | SSE. `delta` events carry only new/changed executions plus new error details; `failure` carries a poll error. One poll feeds all tabs. |
| `GET /api/n8n/graph/:id` | Node names/types/positions + edges with port names. No parameters, no credentials. |
| `GET /api/n8n/locate/:id?node=` | Whether that node is in that workflow, and which called sub-workflows contain it: `{inWorkflow, subflows:[{viaNode, childId, childName, hasNode}]}`. Reads `parameters.workflowId` inside the process; only ids and names cross. Cached 10 min. |
| `GET /api/n8n/callers` | The call graph: `{porFilho:{childId:[{id,name,viaNode}]}, lidos, falhas, total}`. Reads every workflow's nodes in-process; only ids and names cross. **Measured 20s cold for 68 workflows**, cached 15 min — the client fetches it *after* the first paint. `falhas` is reported because with an incomplete read "nothing calls this flow" stops being a claim the panel can make. |
| `GET /api/n8n/execution/:id` | One execution: per-node `executionIndex`/`executionTime`/`executionStatus`, plus the whitelisted error. Drives the replay. |
| `GET /api/fixes` | `{fixes, history}`. `fixes` = current mark per signature; `history` = append-only log of every mark, with `undoneAt` when one was reverted. Facts only — whether a mark still holds is decided in `flows.html`. |
| `POST /api/fixes` | Upsert `{key, maxExecId, note}` or revert `{key, undo:true}`. Body capped at 8KB, key validated as `wfId\|node\|type`, note capped at 600 chars, atomic temp+rename write of **both** lists. |
| `GET /api/projects` | v1 disk scan. `?refresh=1` bypasses cache. |
| `GET /api/project/:name` | v1 per-project detail. |
| `POST /api/reveal` | Opens the project folder in Explorer. Path-guarded to the root. |
| `GET /api/claude/status` | Whether a fix run is even possible: CLI found, n8n configured, sandbox test on/off. The panel asks before offering the button's real behaviour. |
| `POST /api/claude/fix` | Starts a run for `{key, wfId, briefing}`. Returns `202 {runId}`. One run at a time — a second one gets 409. |
| `GET /api/claude/run/:id` | Snapshot: status, stage, round, gates, redacted diff, report, cost, log. |
| `GET /api/claude/run/:id/stream` | SSE. Sends the full `snapshot` first, then `ev` deltas. Reconnect resends the snapshot, so the client tracks how many log lines it already painted. |
| `POST /api/claude/run/:id/approve` | **The only write to a real workflow.** Re-fetches, refuses on `updatedAt` drift, re-runs the gates, saves the backup, then `PUT`s. |
| `POST /api/claude/run/:id/reject` | Records the rejection. Writes nothing to n8n. |
| `POST /api/claude/run/:id/revert` | `PUT`s the backup back. Only valid on an applied run. |
| `GET /api/claude/proposals` | The `proposals.json` ledger. |
| `GET /tester` | The Tester page. `?s=<id>` reattaches to a live build (one takes minutes; a refresh used to lose it). `?static=1` freezes it to a single read — SSE holds the connection open forever, which blocks headless capture. |
| `GET /api/tester/status` | CLI found, n8n configured, sandbox on/off, which models, **which auth mode** — so "plan quota, no card" is visible rather than assumed — and `docAgentes` (is `tester-agentes.md` there, which blocks parsed, which are missing, which are read by nobody). The page warns **before** a build, because afterwards the flow is already out and looks normal. |
| `POST /api/tester/session` | Start `{ideia, nivel}` → `202 {id}`. One build at a time (409). |
| `POST /api/tester/session/:id/reply` | A message, chip answers, or the gate decision. Free text bumps the generation and restarts from that stage. |
| `GET /api/tester/session/:id` | Snapshot. `GET …/stream` is SSE: full snapshot first, then deltas. |
| `POST /api/tester/session/:id/simulate` | Re-run the ghost with a different seed. **Local code — no model, no cost, instant.** |
| `POST /api/tester/projeto/:slug/editar` | Opens a saved project as a live session (`modo: "edicao"`) → `202 {id}`. Same id format and same SSE as a build, so a refresh mid-patch comes back to it. |
| `POST /api/tester/session/:id/decidir` | `{aplicar}` — the only click that writes the project file. Saves the previous `wf` into `versoes[]` first, then runs the sandbox copy. Returns the snapshot. |
| `POST /api/tester/projeto/:slug/desfazer` | Swaps the current version with `versoes[0]`. Neither is discarded, so undoing again redoes. |
| `POST /api/tester/session/:id/credencial` | `{credId}` — breaks a credential tie. **Local, instant, no model, and no secret**: the body carries the id of a credential that already exists in the instance, validated against the catalogue. Returns the snapshot. |
| `GET /api/tester/blueprints` | The `blueprints.json` ledger. |

Guards in place and verified: `..`, `/`, `\` in a project name → 400; unknown project → 404;
`revealFolder` refuses anything outside `ROOT`; workflow id must match `[A-Za-z0-9_-]{1,64}`,
execution id must be digits; run id must match `r[a-z0-9]{1,32}`; the fix signature goes through the
same `validKey` as `/api/fixes`. Upstream 409 and 503 pass through instead of collapsing to 500 —
"o fluxo mudou, revise de novo" and "o cockpit quebrou" are different stories and the UI says
whichever is true.

## n8n API facts, learned the hard way

Verified against the live instance on 2026-08-05. These cost real debugging time — do not re-derive.

- **`GET /api/v1/projects` returns 403.** Not available on this plan. Tags are unusable too (a
  single tag named "Teste"). So the **only** grouping available is the `[PREFIX]` name convention,
  and `projectOf()` in `flows.html` is it.
- **`status=crashed` returns 400.** The valid filter set is `success | error | waiting | running |
  canceled`.
- **`running` and `waiting` are almost always 0.** Executions finish in 60–600ms, so a "rodando
  agora" KPI would sit pinned at zero. The panel shows "última execução há Xs" instead and only
  surfaces a running count when it is actually nonzero.
- **Node positions can be anywhere** — observed `x` from −27632 to −4592. Always normalize by the
  bounding box; assume nothing about origin or sign.
- **A sub-workflow cannot be `active`.** `active` only means something for a flow with its own
  trigger; a flow whose only trigger is `executeWorkflowTrigger` is woken by its caller and stays
  `active: false` forever. 14 of the 68 workflows here are in that shape. Any rule of the form
  "active or ran recently" structurally excludes the quiet ones — see `naPorta`.
- **A sub-workflow error is reported on the parent execution.** `error.node.name` can name a node
  that does not exist in the parent's graph (e.g. `memoria_redis_roberto` surfacing on
  `WhatsApp API Oficial`). The panel says so explicitly and falls back to `lastNodeExecuted`, which
  is the node that made the call. Never silently point at the wrong node.
- **One child failure produces two error signatures** — parent and child each get an errored
  execution with the same node and message. That is accurate, not a bug in the grouping.
- **Sticky notes are nodes** (`n8n-nodes-base.stickyNote`). They never appear in `runData` and they
  inflate the bounding box, so `isAnnotation()` filters them before layout.
- **Volume, for sizing polls:** ~840 executions per 24h, one workflow (`WhatsApp API Oficial`)
  accounting for ~20% of them; ~5–10 errors per day. Backfill walks the cursor once at boot, then
  only page 1 is polled and merged by id — ids are monotonic, so dedupe is trivial.
- **A `redis` node with `operation: get` returns the value under `propertyName`, not `value`.** Reading
  `$json.value` yields `undefined` with no error, no warning, and a green execution. Verified on
  execution `#176997` (a `success`): all five `redis get` nodes returned an object whose **only key is
  `propertyName`**. This is not academic — it is silently killing two layers of the live Iago agent, in
  code that is **byte-identical** between the active flow and its twin:
  - `Code_verificar_lock` tests `redisData.value !== undefined` to detect an existing lock, so
    `lock_ativo` is **always `false`** (measured). The processing lock protects nothing; two concurrent
    messages from the same contact both pass.
  - `parse_conv_summary` reads `$input.first().json.value` for the conversation summary, so
    `has_summary` is **always `false`** and `conversation_summary` **always `null`** (measured). The
    structured history that keeps the agent from repeating an argument never loads.

  The same flow reads it correctly in `If_ts_match` (the buffer), which is why the buffer works. Both
  readings coexist and only the wrong one is silent. **Always `propertyName`.**
- **The editor writes `settings` keys the public API rejects.** `workflowSettings` in the
  instance's own `GET /api/v1/openapi.yml` is `additionalProperties: false`, and the live
  workflows carry `timeSavedMode` — which is *not* in that schema (`timeSavedPerExecution` is).
  Echoing `settings` back on a `PUT` fails with `400 request/body/settings must NOT have
  additional properties`, **and the message never names the offending key**. Measured 2026-08-06:
  5 of the 10 active workflows carry it, so every apply would have failed. `pickSettings()` in
  `n8n.js` is the whitelist, transcribed from that spec; when it drops something the writer is
  told, because **a `PUT` replaces `settings` wholesale — a dropped key is a key removed from the
  flow**, and that change was never on the diff Kauan approved. The allowed set is
  `saveExecutionProgress`, `saveManualExecutions`, `saveDataErrorExecution`,
  `saveDataSuccessExecution`, `executionTimeout`, `errorWorkflow`, `timezone`, `executionOrder`,
  `callerPolicy`, `callerIds`, `timeSavedPerExecution`, `availableInMCP`. If the same 400 ever
  returns, re-read the spec from the instance before touching anything else — the list went stale.

## The fix loop — how "Mandar pro Claude" actually corrects a flow

**Claude runs locally, headless, and blind to the instance.** `claude-fix.js` spawns
`claude.exe -p … --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools
"Read,Write,Edit,Glob,Grep" --strict-mcp-config --mcp-config '{"mcpServers":{}}'` with `cwd` pinned
to the run's scratch dir. **No Bash, no network, no API key** — the cockpit does every n8n call. The
`stream-json` lines become the terminal you watch: `assistant` text and `tool_use` names, live.
Retries reuse the session with `--resume <session_id>` off the `result` event, so round 2 still
remembers round 1.

**Claude does not rewrite the workflow — it writes a patch.** Three verbs: `updateNodes`,
`addNodes`, `rewire`. Two reasons, both load-bearing:

1. **Scale.** The biggest flow here has 188 nodes. Asking for the whole document back burns the
   context that should go to the diagnosis, and invites corruption far from the defect. Instead the
   dir gets `nodes-index.md` (exact name · type · outgoing edges, target marked `⚠`) and
   `target-nodes.json` (the failing node plus one-hop neighbours) — the full `workflow.json` is
   there for `Grep`, stated as the last resort.
2. **"Never delete a node" stops being a rule that can be broken.** There is no delete verb. To take
   a node out of the path, `disabled: true` or rewire around it. A gate that *could* fail became a
   sentence the format cannot express.

`applyPatch()` also refuses unknown node fields, any `credentials` key, and a `type` change — so a
malformed patch produces a *named error that goes back to Claude*, not a bad proposal.

**The run follows the sub-workflow, and says so.** n8n reports a child's failure **on the parent**,
so the signature routinely names a node that does not exist in the flow you clicked
(`Convert text to speech` on `WhatsApp API Oficial`). `followSubWorkflow()` opens the
`executeWorkflow`/`toolWorkflow` nodes, reads the child id (`parameters.workflowId` is a bare string
in older node versions and a `{__rl, value, mode}` resource locator in newer ones — both are read),
fetches each candidate and **switches the run's target** to whichever child actually contains the
node. The `lastNodeExecuted` caller is tried first because it is the one with evidence behind it.
One hop only, at most 4 candidates, and anything beyond that is logged instead of recursed.

When that happens `snap.redirected` carries `{fromId, fromName, viaNode, toId, toName, node}` and
the review screen leads with it: *"o diff abaixo é do fluxo X, aprovar escreve nele, não em Y"*.
**That banner is not optional** — the card he clicked belongs to one workflow and the approve button
would write to another; letting that be implicit would be the worst write this codebase can make.

This was added *because* the first live run on that signature produced a `notes`-only patch whose
own report said "isto não resolve". The model was right and the output was useless: the defect was
one workflow away. With the hop, the same signature produced a real fix to the `text` parameter
(empty-output fallback plus a 4500-char cap) in the 188-node child.

**The gates are code, and the retry prompt is their output verbatim.** Ten of them (`validate()`):
proposal shape, no node removed, no type change, no credential touched, unique names, every
connection resolvable, node shape, `active` untouched, no secret literal in a *changed* parameter,
and something actually changed. Fail any → the failed lines are handed straight back to Claude for
up to `MAX_ROUNDS` (4). **This is the loop Kauan asked for**: it tries, the validator rejects it, it
tries again — and if it never passes, the screen says so and offers no approve button. A proposal
that cannot pass never becomes a button.

**The eleventh gate is optional and off by default.** `COCKPIT_SANDBOX_TEST=1` makes the run `PUT`
the proposal into an inactive `[SANDBOX cockpit] <name>` copy — the only check that proves *n8n
itself* accepts the JSON. It is off by default because it is a write to the instance before Kauan
approved anything. **When it is off the review screen says so** (`○ teste na instância desligado`)
rather than letting the absence read as success. The sandbox copy is reused by name and never
deleted.

**Approve is fail-closed three times over.** It re-fetches the workflow; refuses if `updatedAt`
drifted since the proposal was built (the diff on screen no longer describes what would happen);
re-applies the patch to the **current** document and re-runs every gate; writes the backup; only
then `PUT`s. The `PUT` body is built field by field (`name`, `nodes`, `connections`, `settings`) —
never a spread, because n8n rejects read-only fields, and `active` is never sent, so applying a fix
can never wake a dormant flow. Writes are **not retried** (a repeated write that maybe landed is
worse than a reported error); only GETs are.

## The Tester — how an idea becomes a flow

Seven stages, stopping in exactly two places: after `[ 01 ] Entender`, because confirming intent is
the cheapest checkpoint there is, and at `[ 06 ] Fantasma`, which is the agreement. The other five
stream, and typing in the composer at any moment restarts from the affected stage.

**`[ 01 ] Entender` is a multi-round interview, not a single question card.** One round of three
questions produced flows built on guesses — Kauan's words: with 3 questions you don't get a real,
functional flow. The prompt now carries a six-dimension checklist (trigger, source, filter, message
content, exact destination, empty/error behaviour), asks up to `PERGUNTAS_POR_RODADA` (5) per round,
and each answered round feeds the next until the model returns `perguntas: []` — which is what
releases the gate. Answers **accumulate across rounds by question text** (merge, never replace);
`MAX_ENTREVISTAS` (4) is enforced in code after the model call, not just requested in the prompt, and
the last round converts what is still open into `a-confirmar` findings instead of questions.
Skipping is always available ("Pular e construir assim mesmo") but says the price: open dimensions
become stated assumptions. Free text resets the round budget — a changed idea deserves a fresh
interview. The interview also proposes a human `titulo` (the snake_case `wf.name` used to be the
suggested project name, and it read as garbage on the start screen).

**"Você ainda não disse" was being said with stage 04 already drawing.** Two defects stacked.
`entendi.ondeChega` crossed whole interviews still open, because the model asked CONTEÚDO
(dimension 4) first and DESTINO (5) is the one dimension with **no possible default** — a Slack
channel, a phone number, a table and a spreadsheet are not guessable. The prompt now says so, makes
it the first question of the round while it is open, and forbids closing the interview on account of
it (except on the last round). And the card rendered *open* and *closed* with the same sentence, so
it kept asking for an answer that no longer had anywhere to be given.

There are now **three** row states, and the last two must never read alike: answered; open (the
question is still coming); and **assumption in force** — either the model declared it (the value
starts with the exact prefix `"suposição: "`, same contract style as the existing `"não disse"`) or
`fecharAberto()` wrote it because the interview closed with the field empty. That last one is
**code, not a request to the model**: the screen has to be able to state the difference between
"I'll ask you" and "I decided without you" even when the model does not cooperate. It also pushes
one `a-confirmar` finding per field, deduped by text, and `promptDesenhar` is told that a
`suposição:` field was confirmed by nobody — it shapes the flow, but every parameter depending on it
ships as `[PREENCHER]`. Inventing a channel there would be worse than the marker: the flow imports
and sends to the wrong place with nothing warning.

**An option can be the message it produces, not a description of it.** Choosing between "remetente e
assunto" and "remetente, assunto e trecho do corpo" was choosing between two labels. A content
question (dimension 4) now carries `previa` (`slack` | `whatsapp` | `email` | `texto`) and `modelos`
— a map from the **exact** option string to the text it produces, dynamic fields written as
`{{ campo }}` — and the option renders as a card with that message drawn in the destination's
anatomy, reusing the ghost's own `.slack-msg`/`.wha-*`/`.mail-*` blocks.

Three things about it that are load-bearing:
- **The badge says `MODELO`, never `SIMULAÇÃO`.** The ghost is *derived from the flow by code*; this
  is text the model wrote so you can compare, before a flow exists at all. One badge for both would
  erase the only thing that makes the ghost worth anything.
- **`data-resp` is still the whole contract.** The answer is the same string either way, so the
  click handler, `marcar()` and the by-question-text merge never learn which of the two drawings is
  on screen.
- **The card is a `<button>`, so the mockup is built from `span`s** — a `<div>` inside a button is
  invalid markup. That is what the `display` line under `.tpl-mock` is for. `{{ campo }}` is painted
  with `--accent` (movement, never status) because it is the *hole* where the value goes, not the
  value.

`limparPergunta()` treats a question as hostile payload: `previa` must be one of the four surfaces
`previaModelo()` can actually draw, and a `modelos` entry survives only if its key is really in
`opcoes` — an orphan template would be a preview no click can select.

**`preview/gen-pergunta-preview.js`** renders all of it standalone (`node preview/gen-pergunta-preview.js`,
double-click the output): four surfaces, the plain-chip fallback, and the three card states side by
side. Like `gen-mocks-preview.js`, nothing is hand-copied — the CSS and the renderers are extracted
from `tester.html` at generation time, so the preview cannot drift from the screen. Both states of
an interview row are otherwise minutes and dollars deep into a live build.

**Two isolated sessions, and that split is the security boundary.** Session R has `WebSearch` and
`WebFetch`, runs in an **empty** directory, is told nothing about the flow being built, writes
exactly one markdown file, and is **discarded** — never resumed. Session B has **no network at all**
and reads that file as data. Distilling a page and discarding the HTML inside one long-lived session
would have been theatre: the contamination stays in context and is re-sent on every resume.

**`[ 02 ] Pesquisar` usually does not happen.** If every service already has a node in the instance
catalog, there is nothing to read: the stage is skipped, says so, and the build goes straight on.
Research is the most expensive step in the pipeline in both wall-clock and context.

**Three things the gates refuse outright**: any `credentials` key **in what the model writes** (see
the credentials section below — the cockpit itself may attach one afterwards, and that is a
different actor with a different rule), any `active` key **anywhere — including in the JSON shown on
screen**, because banning it
only on the write path still hands over a document that wakes a webhook on import, and any
top-level key outside `{name, nodes, connections, settings}`, because the write path builds its body
field by field and a sanitised sandbox test would otherwise certify a JSON nobody tested.

**The gate that proves a node exists.** The n8n public API accepts an unknown node type without
complaint — it only becomes a "?" in the editor when the JSON is pasted, i.e. exactly when Kauan is
counting on it. So the sandbox test never proved the node types were real. `validar()` now refuses
any `type` absent from the instance catalog (the message says to use `httpRequest` instead, and the
build prompt states the rule up front), requires `typeVersion` on every node (omitted, n8n imports
as v1 and parameters written for v2+ break silently), and still checks the version against what the
instance actually runs. Two false-positive fixes rode along: `respondToWebhook` matched the old
trigger regex (`/webhook/i`) and a webhook→response flow was refused as "2 starts" — trigger
detection is now `/(?:trigger|cron)$/` or `\.webhook$`; and sticky notes are exempt from the
trigger/connection/catalog gates, since they never connect to anything.

**The ghost is derived, never narrated.** A model asked what its own flow produces always answers
that it works. `simulate.js` resolves the flow's own expressions against seeded input: the outbound
side is real, the inbound side is seeded and labelled. It **fails closed** — a `Code` node, a merge,
a loop or an expression outside the measured subset produces a stated refusal, not a partial picture.
The supported expression subset was **measured, not chosen**: the first draft covered 46% of the
2284 expressions here because it included the legacy `$node["Nome"]` (0 occurrences) and excluded
the modern `$('Nome')` (1019). `SIMULAVEL_V1` in `catalog.js` is the source of truth; changing it
means re-running `node catalog.js --refresh` and re-reading the percentage before promising anything
on screen.

**Generator and verifier must stay aligned.** Telling the build session to prefer `Set` over `Code`
was not enough — it complied and wrote `Set` nodes full of JavaScript, so every expression fell
outside what the simulator can evaluate. The build prompt now **lists the supported subset** and
says that leaving it costs the simulation. If you ever widen `simulate.js`, widen that prompt in the
same commit.

**The ghost renders in the anatomy of the destination, never in its brand colors.** A Slack send is
drawn as a Slack message (channel header, square avatar, bold sender + APP badge, timestamp), a
WhatsApp/Telegram send as a tailed bubble over a dotted chat ground, an e-mail with to/subject
header, a database write as a highlighted table row, a webhook reply as an `HTTP 200` block. The
service name travels as `rotulo` on the surface object — telegram shares the whatsapp *shape* but
must never be labelled "WhatsApp". A `linha` surface also carries `envio.campos` (the record,
derived like everything else; `fieldsUi.fieldValues[]` and `columns.value{}` are flattened to
columns on screen). Entrance animation is gated by a signature (`S.fantasmaVisto`) so the SSE
repaint never replays the arrival. Three traps, each paid for: `prefers-reduced-motion` must zero
`animation-delay` too, not just duration — with `fill: both` a delayed element sits invisible at its
from-state; a class named `.st` collides with the stage-step grid and stacked "HTTP 200" into a
20px column; and the simulated clock is the frozen 09:00 from `simulate.js` — a live timestamp would
make the same simulation change on every look.

**The drawing appears while the build session is still writing.** The stream-json `tool_use` event
carries the full `Write` input, so the moment the session writes `workflow.json` the server parses
it (`parcialDeWrite`) and emits a **skeleton-only** partial — name, type, typeVersion, position,
connections; parameters of an unvalidated draft never cross to the browser. The canvas renders it
labelled `[ RASCUNHO · … · AINDA DESENHANDO ]` and the validated document replaces it (same node
names → same signature → no re-animation). On a correction round the next `Write` updates the
draft, so a gate-failed flow is seen being redrawn live. `Edit` calls are ignored — they carry no
full content to reconstruct.

### Conversational agents are a different kind of build, and the Tester knows it

Asked for "an agent that answers leads on WhatsApp", the Tester used to run the same six-dimension
interview it runs for "tell me on Slack when I sell something", and produce the same shape of flow. It
never asked whether the agent should reply with audio, never asked what to do when the lead sends three
messages in eight seconds, and never built a buffer — the word did not appear anywhere in the prompts.
The output imported into n8n, looked right, and would answer a picked-apart question three times.

**The knowledge lives in `tester-agentes.md`, not in code.** Four blocks delimited by
`<!-- BLOCO: nome -->` anchors, read at runtime by `agentes.js`, injected into the prompt that needs
them: `entrevista` into `promptEntender`, and `arquitetura` + `receitas` + `armadilhas` into
`promptDesenhar`. Same reasoning as the judgement block in `flows.html` — the part Kauan tunes most
often is prose in one place, and a new sentence must not require a restart. **Every number in it was
measured in the live flows** (15s buffer, 30s lock TTL, 15min→1h→24h follow-up); an invented number
there becomes an invented number in every flow built from it.

**A field missing from the payload is not the same as the answer being "no" — and this project has now
made that mistake twice.** The opening screen warned *"Não achei `tester-agentes.md`"* with the 48KB file
sitting right there. Cause: the running cockpit had started before `docAgentes` existed, so
`/api/tester/status` never sent the field, `S.capab.docAgentes` was `undefined`, and the check read that
silence as "the file is gone." It blamed Kauan's file for a stale Node process — exactly what the
`Response.json()`-on-a-404 note further down describes, in a new place.

The fix is to branch on **`"docAgentes" in S.capab`** before looking at its contents, and say the true
thing: *the cockpit running now started before this version, close the window and open it again.* Any new
field added to a status route needs the same three-state treatment — absent, present-and-negative,
present-and-positive. **Never let an absent field fall into the negative branch.**

**The anchors must sit alone on their line** (`^…$` with `/m`). Without that, the doc's own table
explaining the format — it cites `<!-- BLOCO: nome -->` mid-sentence — is parsed as a real block, and a
phantom block named `nome` appears holding the prose between the two mentions. `docStatus()` reports
`desconhecidos` for exactly this reason: a block nobody reads is either a typo in an anchor or a section
someone wrote expecting it to be used, and both deserve to be said out loud.

**Classification is the model's, with the regex as a net.** `promptEntender` asks for a `tipo` field
(`agente` | `automacao`) against three tests: the person writes freely, the reply is generated rather
than chosen, and the conversation has state. `pareceAgente()` only decides whether to spend the
twelve-dimension block on round one — a regex cannot tell "an agent that answers leads" from "tell the
sales agent on Slack", and both sentences carry the same words. Once decided, `s.ehAgente` drives the
interview, the node types offered in stage 3, the gates in stage 5, and the refusal in stage 6.

**The agent gates check function, not style.** In `agentes.js`, and they are deliberately few: agent
exists, has a model, has memory **keyed by an expression** (a fixed `sessionKey` mixes every contact's
conversation into one — measured in a live flow using the literal `eleven-labs`), has a structured
output parser, declares `hasOutputParser: true` (separate from connecting it: without the flag the
parser is connected and ignored, silently), has `messages` in the schema, wires every `ai_*` component
through **its own port and not `main`** (by `main` it imports without error and the agent simply has no
model), and — on a messaging channel — has `wait` + `redis` for the buffer. Anything about quality
rather than function becomes an `achado` on screen, never a rejection.

**The drawing needs two tracks, because an agent is not a chain.** The Tester's canvas laid every node
on one horizontal line in array order. An agent hangs its model, memory, parser and each tool off the
`ai_*` ports, and those edges run *into* the agent — on a single track they became wires doubling back
right-to-left across the whole drawing, and an agent rendered as spaghetti. Now the execution nodes keep
the horizontal track and **the `ai_*` attachments sit on a second track under the agent they serve**,
which is how the n8n editor draws it. Their edges leave the *top* of the attachment and enter the
*bottom* of the agent; they are dashed and thinner (`.edge.ia`) so the two tracks read as two different
things — no colour spent, since status colour is reserved and `--accent` means movement. An attachment
also gets **one port, on top**: drawing side ports would claim data flows through it, and it does not.

Two details that matter if you touch it. `.edge` sets `stroke-dasharray: var(--len)` for the draw-in
animation, where `--len` is the path's own length — reusing that on a dashed edge erases the line, so
`.edge.ia` sets an explicit `3 3.5` and `dashoffset: 0`. And the canvas width is now computed from the
**rightmost node that exists** rather than estimated from a column count: the estimate left ~400px of
empty space beside an agent, and the `viewBox` shrank the whole drawing to fit room nobody used. Every
flow gained 112px of usable width as a side effect.

**The ghost refuses an agent, and the reason matters.** `simulate.js` would refuse anyway — an agent is
built from the very types it declines by principle (`code`, `merge`, `switch`) — but it would say
"expression outside the simulable subset", which sends Kauan hunting an expression problem that does not
exist. `recusaFantasma()` intercepts first and says the true thing: the reply is written by a language
model, and the ghost does not invent what it would say.

**`catalog.slice()` + `.slice(0, 7000)` was a latent bug, and an agent triggered it.** The prompt used
to serialize the catalogue slice and truncate the string at 7000 characters — which cuts mid-key and
hands the model invalid JSON, so it guesses the parameter shape and burns a round at the gate. The base
slice is already 6158 characters with 8 types; an agent needs 23 types and 16390. `catalog.fatiaTexto()`
now cuts **at whole-type boundaries**, in the order the caller asked for, and **returns what was left
out** so the prompt can say it instead of silently losing half the catalogue.

### The prompt travels in `-p`, so a big prompt fails as `spawn ENAMETOOLONG`

Measured 2026-08-10, on the first real agent build. Windows caps an entire command line at **32767
characters**. The agent knowledge inline took `promptDesenhar` past 49KB (31KB of doc + 16KB of
catalogue slice), and stage 04 died with `spawn ENAMETOOLONG` — a message that names no prompt and no
size, and sends whoever reads it hunting a file-path problem. It was armed regardless of agents: the
catalogue slice alone reaches 16KB on a flow with several services.

Two fixes, and the second is the real one:

- **`PROMPT_MAX` (24000) in `rodar()`** rejects an oversized prompt *by name*, before spawning, saying
  that big material belongs in a file. A guard that turns an incomprehensible OS error into a sentence.
- **`escreverContexto()` writes the big material to the run directory** and the prompt says what to
  read: `catalogo.json` always, `AGENTES.md` on an agent build, `doc.md` when research ran. Same shape
  `claude-fix.js` already uses. It beats inline for three reasons beyond fitting: the session reads the
  block it needs instead of carrying all of it, it can `Grep` the catalogue for one type, and **what it
  read shows up in the activity log** — so you can see whether it consulted the recipe or improvised.

**Two parts of the interview prompt grow without a ceiling**, and moving the doc out of the prompt did
not fix them: the accumulated answers (24 × ~500 chars) and the free-text messages (2000 each). Measured
worst case for an agent: **36637 characters** — over the internal cap *and* over the Windows limit.
`ultimosAteCaber()` gives each a budget (7000 for answers, 3000 for chat) and drops the **oldest** first:
a recent answer is the decision currently in force, an old one is usually already reflected in `entendi`.
**When it drops something it says so in the prompt** — a model that does not know it lost context asks a
question that was already answered, which is the exact failure the interview exists to avoid. The same
worst case now measures 23325, leaving ~8.7KB of headroom on the command line, and
`prompt-budget-test.js` is what keeps it that way.

**That fix also repaired an older bug.** `promptDesenhar` said *"leia o arquivo `doc.md` para o
detalhe"* — and `doc.md` did not exist in the build session's cwd. `pesquisar()` writes it inside
`s.dir/research/` and then deletes that directory whole (it is the discarded network session's
scratch), so the build session was being pointed at a path that had just been removed. The research
text was only ever reaching it inline, clipped to 2500 characters. Now the file is written into
`s.dir` and the whole ficha is readable.

`escreverContexto()` runs **once per round**, not once per build. The session holds `Write` and owns
that directory, so nothing stops round 1 from clobbering the `AGENTES.md` round 2 will read. It is
local I/O — free — and it removes the whole class of "round 2 read a file round 1 corrupted." Only the
first round logs it.

### Six minutes is not enough to build an agent, and the round that dies costs money nobody counted

Both measured on the first end-to-end agent build, 2026-08-10.

**`ROUND_TIMEOUT_MS` was one number for two very different jobs.** A notification flow is 5 nodes; an
agent is ~40 and the model reads ~45KB of `AGENTES.md` before writing a line. Round 1 ran past 369s
against a 360s cap, was killed mid-write, and round 2 restarted from zero — same reading, same cost,
same fate. With three rounds all dying at the same point, **an agent could never finish**. There are now
two caps: `ROUND_TIMEOUT_MS` (6 min) and `ROUND_TIMEOUT_AGENTE_MS` (14 min), picked by `s.ehAgente`.

**A killed round reports `usd: 0`, and that is not the same as free.** `total_cost_usd` arrives in the
`result` event, which is the CLI's last line — a process killed mid-flight never gets there. Recording
`0` claims the round was free when it may have been the most expensive of the run, and it made
`estourouTeto()` authorise the next round as if nothing had been spent. The cost entry now carries
`usdDesconhecido: true` plus a reason, the screen and the smoke print **"não medido"** instead of zero,
and `gastoAte()` charges each blind round at the average of the measured ones — a declared guess, which
beats a silent zero. Same reasoning as everywhere else here: a failed write proves the absence of a
confirmation, not the absence of an effect.

**And `tester-smoke.js` was showing none of it.** It subscribed to `etapa`, `atividade`, `custo` and
`fim` — not `log`. So a round being killed, restarted and killed again looked like stage 04 simply
"correndo" for ten minutes, and the only tell was an accumulated cost that stopped rising. It now prints
every `log` event whose level is not `info`. A test harness that hides warnings is worse than no
harness: it converts a loud failure into a slow one.

### What the first end-to-end agent build actually produced

Measured 2026-08-10, from *"quero um agente que responde os leads no whatsapp, tira dúvida sobre os
eventos e manda o link de pagamento"* plus one round of interview answers. This is the baseline — compare
against it before believing a regression is normal.

**65 nodes, gates passing on round one**, US$3.19 total, 818s wall clock. The build session alone was
US$2.79 and **660s — nearly double the old 6-minute cap**, which is why an agent could never finish
before `ROUND_TIMEOUT_AGENTE_MS` existed.

All seven layers present: webhook answered before processing, media triage with transcription, buffer
(`wait` + `redis`), processing lock, memory, agent with structured output, bubbles with a pause between
them, and 19 persistence nodes — **19 of 19 carrying `onError: continueRegularOutput`**, 10 nodes with
`retryOnFail`. **16 `[PREENCHER]` markers**, so it invented no business rule.

Verified on the sandbox copy the run created (`F2klcwnQfSdzRuWN`): inactive, no `credentials`, name
prefixed, and **n8n accepted the named ports** — `ai_languageModel` 1, `ai_memory` 1, `ai_outputParser` 1,
`ai_tool` 3, `main` 53. `hasOutputParser: true`. The schema carried `messages` plus eight decision fields.
The memory key is `=memoria:{{ …telefone_normalizado }}` — it picked up the phone-normalisation layer
documented from the Gabi flows — and `contextWindowLength: 25`, following the doc's 20–30 rather than the
`10000` the live agents use.

The ghost refused with the right sentence, and — because `fantasma()` now checks
`agentes.recusaFantasma()` before asking — it did **not** spend a model call on seeds nobody would read.

**Where the 818 seconds went, so nobody re-derives it.** The build session wrote **89.894 bytes ≈ 25.000
output tokens**, which at ~38 tok/s *is* the 660s. There is no hidden inefficiency: the time is the size
of the document.

| Phase | Time | Note |
|---|---|---|
| Interview, 2 rounds | 153s | two sonnet calls, US$0.41 |
| Ingredients | 2s | local code |
| Reading the 3 files | 5s | 51KB in |
| Processing + planning | 221s | ~19k input tokens, deciding 65 nodes |
| Writing `workflow.json` | 253s | 66KB — 74% of everything written |
| Writing `seeds.json` | 54s | 8.7KB, **entirely wasted on an agent** |
| Writing `report.md` | 127s | 15KB, node-by-node across 65 nodes |

Two of those were waste and are fixed: the build prompt now **tells an agent not to write `seeds.json`**
at all (the ghost refuses before reading them), and asks for the report **grouped by the seven layers
instead of node by node** — with 65 nodes the per-node form was a wall nobody reads, and it duplicated
what the agent rules already ask for by layer. Together those should return roughly a sixth of the build
time; that part is an estimate, not a measurement, until the next agent build.

**The remaining lever is the model.** `COCKPIT_TESTER_MODELO_BUILD` defaults to `opus`. Sonnet writes 2–3×
faster and the same 65-node document would land in a fraction of the time — but the JSON is where opus
earns it (correct `ai_*` ports, `typeVersion` per type, no invented node). Worth measuring before
switching; do not switch on intuition.

**What the Tester will not pretend.** The system prompt comes out as an eleven-section skeleton with
`[PREENCHER]` markers — the live Iago agent carries **71.705 characters** across sections 0–10, tuned
over months of real conversation, and shipping 2k as finished would be a lie. Tools come out declared,
not implemented: each is a separate sub-workflow and the Tester builds one workflow per run, so
`workflowId.value` is a `[PREENCHER]` and the list of what to build lands in `report.md`.

**A saved project carries the whole conversation.** `salvarProjeto` persists `chat` and `respostas`;
`telaProjeto` replays it with the same `blocosConversa()` the live run uses, plus the drawing and
the ghost. Projects saved before this existed have no history — the screen says so instead of
pretending the idea line was the conversation.

### The trash, and the promise that was false

Deleting a project used to `unlink` the file, and the dialog said the folder is versioned so git could
bring it back. **Measured 2026-08-10: that was false for exactly the projects most likely to be
deleted.** `projetos/` is tracked, but a project saved *after* the last commit is untracked, and
`unlink` on an untracked file is final. Two projects were deleted through that button during one
session — one was committed and shows as ` D` (recoverable with `git checkout -- projetos/`), the
other had never been committed and is gone, with no copy anywhere. A build costs minutes and dollars;
that deserved a step between the click and the end.

**`excluirProjeto` now moves instead of deleting.** The file goes to `projetos/.lixeira/`, which sits
inside `projetos/` on purpose — it is tracked for the same reason the rest is, and `listarProjetos`
filters `.json` at the top level, so a directory never shows up as a project. It writes the
destination **before** removing the source: if the write fails the project stays where it was, and the
reverse would lose the file on a full disk.

**The trash filename carries a timestamp** (`<slug>__YYYYMMDDhhmmss`). Deleting the same slug twice is
normal — rebuilding under the same name happens — and without the stamp the second deletion would
overwrite the first, silently destroying exactly what the trash exists to protect. There is a test
for that, and it sleeps 1.1s because the stamp has second resolution.

**Restoring can rename, and says so.** Nothing stops saving a new project under the slug that a
trashed one holds; overwriting would swap a live file for a dead one. So it restores under the first
free slug and returns `renomeado: true`, which the screen turns into a dialog — restoring silently
under another name is a broken link nobody knows is broken.

**Permanent deletion still exists, and its copy no longer over-promises.** It says git brings it back
*if this project had already been committed*, that there is no copy anywhere if it was saved after the
last commit, and — the honest part — **that the page cannot tell which of the two this is**.

**The trash door is always visible, even empty.** A door that only appears when there is something
behind it is a door nobody finds, and the moment it gets looked for is right after deleting, exactly
when the card that would reveal it has just left the screen. Empty, it says it is empty.

Two things about how the trash screen looks that are not decoration. The cards are **desaturated and
dashed** so "out of service" reads at a distance; without it the trash looks like the project list and
someone restores thinking they are opening. And each card shows **what the build cost** — nodes,
edit versions, dollars — because that is what decides the click, and hiding it behind the word
"delete" is the class of damage this panel exists to avoid.

### Confirming an action: the native `confirm()` is gone

`confirm()` was the one thing on this page the theme could not reach — it arrives as
*"localhost:4317 diz"*, with the OS font, the OS button order and `\n\n` where a paragraph belongs.
Worse than ugly: **it cannot tell a destructive action from a reversible one**, and the two calls
that existed were exactly one of each. Deleting removes a file; undoing swaps two versions that both
stay.

`confirmar()` in `tester.html` returns a Promise and carries the rules the rest of the panel already
follows: `role="dialog"` + `aria-modal` + `aria-labelledby`, `inert` on every other body child while
it is open (without it Tab walks behind the scrim — a real defect fixed once already in
`flows.html`), focus returned to the button that opened it, Esc and scrim cancel, and a closed Tab
cycle between the two buttons.

Two details that are decisions, not styling. **A destructive dialog opens focused on Cancelar** —
Enter without reading must not delete anything; a reversible one opens on the action. And
**`.btn.perigo` is the only red button in this codebase**: dressing a reversible action in `--risk`
would spend the alarm before the deletion needs it.

The copy changed too. *"Dá para recuperar com git"* without the command is not an escape route, so
the delete dialog names it (`git checkout -- projetos/`) and states its condition (while the previous
commit exists). Both dialogs also say what they do **not** touch — nothing is written to n8n — because
this panel writes to two very different places and the sentence that says which one is the whole
point.

**`preview/gen-confirmar-preview.js` is interactive on purpose.** What has to be checked here cannot
be checked in a screenshot: Esc, the scrim, the Tab cycle, the initial focus and the focus return.
It also carries the one `grab()` in the preview generators that scans instead of matching by regex —
`function confirmar({ tag, … })` has a brace **inside its parameter**, so counting from the first `{`
returned the signature alone and the page died with a `SyntaxError` pointing at none of that. Find
the `)` that closes the parameters by counting parens, then open the brace count at the next `{`.

### Credentials: what the cockpit can honestly say, and what it can attach

Four facts about the instance come first, because every design here is shaped by them and they cost
real debugging time:

- **`GET /credentials` returns 405.** There is no inventory endpoint. The list of credentials in the
  account does not exist for anything in this codebase.
- **`/credentials/schema/:tipo` works**, and only says which fields that type asks for.
- **The sandbox copy is credential-free.** That gate proves n8n accepts the schema; it proves
  nothing about auth, and the screen says so.
- **There is no way to test a credential through the public API.** The cockpit can never say "this
  one works" — only "one of this type is referenced by your flows".

**The checklist is per node, because that is the unit of work in the n8n editor.** The by-type list
answered "what does this flow need"; it never answered "and now, what do I click", which is the
question left over with the flow already imported and three red nodes on screen — answering it meant
translating credential type into node by eye. `checklistCredenciais()` derives one row per node from
`catalogo.nodes[tipo].credenciais`, which is what those node types use **in his own flows**. The
consequence is stated on screen: a node that never asked for a credential here does not appear. It
is a floor, not a total — the same honesty as the truncated disk scan.

A node with more than one possible credential type ships with **all** of them. Hiding the
alternatives would decide for him which authentication to use, and `httpRequest` in this account has
already appeared with half a dozen different credentials.

**`catalog.js` stopped dropping id and name, and that is the one line in that file that got less
restrictive than it was born.** Before, only the type survived, so the cockpit could say "this flow
needs a `slackApi`" and never "you already have *Slack Ecommerce Puro*, used in 6 flows" — which is
the sentence that saves the work, and the prerequisite for attaching anything. What enters is `id`
and `name`; what does not, here or anywhere, is the secret — the public API never returns it. The
consequence that has to be written down: those names now exist in `.cache-catalog.json` on disk. The
file is local and gitignored, and the hard rule of that file still holds — **a parameter value never
reaches disk**. A credential name is not a parameter value. `credenciaisConhecidas` is deliberately
**outside `cat.nodes`**, so `slice`/`fatiaTexto` never carry it into the build session's prompt: that
session has `credentials` refused at the gate, so an inventory there would be context it cannot use.
`credenciais-test.js` asserts that absence rather than trusting it.

**The exported JSON can come pre-attached, and the rule is code, not a request to a model.** n8n
matches credentials by `id` + `name` on import, so a flow that already points at an existing one
imports wired — zero clicks. On a 3-node flow that is a minute; on a 65-node agent with 20
credential blocks it is the whole job. `ligacaoCredenciais()` attaches **only when there is no choice
to make**: exactly one candidate with an id and a name, counting across every credential type that
node type accepts. Two candidates is ambiguous, and picking one would decide which account the
message goes out from — worse than an empty field, because it imports silently and only shows up on
the first execution, at the wrong destination. Zero candidates is the same failure with an invented
id.

**`s.wf` still never carries `credentials`** — not at the gate, not in the sandbox copy, not in the
ghost, not in the project file. The server returns only the **report** (`credLigacao`), and
`wfParaExportar()` in `tester.html` composes the exported document from it. Two reasons: the
snapshot travels on every event and a second copy of a 66KB agent would double it, and this keeps
the split intact — the server states which credential is unambiguous for which node, the page
decides what the export looks like. The toggle exists because a clean JSON has a real use: sending
the flow to another person or another account, where those ids mean nothing.

**The tiebreaker, and why it is local code.** A node with two possible credentials stayed blank
**forever**: the cockpit refuses to guess, and there was no way to tell it which one. Measured in his
flows, that is exactly the Slack case — `slackApi` (22 uses) and `slackOAuth2Api` (3). The choice is
now stored by **credential id**, not by node name (`escolhasCred`, persisted in the project file), so
"when it's Slack, use Ecommerce Puro" covers every Slack node including ones a future patch creates,
and survives a rename. Two chosen credentials that both fit one node is still ambiguous — the
tiebreaker did not break the tie, and guessing there would be the original mistake.

Two ways in, sharing all the machinery. The **chip on the checklist row** is the primary one:
unambiguous by construction, and it sits where the tie is displayed. The **sentence in the chat** is
matched **locally, with no model** — the candidate set is two or three names, and spawning a CLI
session to choose between two strings would cost tens of seconds and real money. Same reasoning as
`resimular`.

`interpretarEscolhaCred()` intercepts in `pedirEdicao` **before** the spawn, under two conditions
that are both required, because a false positive would swallow a real build request: the sentence
must carry a word declaring the subject (`credencial|conta|autenticação|login|auth`) — *"manda o
aviso pro Slack Ecommerce Puro"* is a flow request, not a tiebreak — and **exactly one** candidate
must match. Two matching is a new ambiguity, and the answer is to hand the question back. No match
returns the list of what would fit, rather than silence. Only candidates of nodes that are actually
blank count; choosing something already attached is noise.

**Nothing here handles a secret.** What travels is the `id` of a credential that already exists in
the instance, validated against the catalogue before it is stored — an id matching nothing would
wire a node to a credential that does not exist, which imports silently and fails on the first
execution, the same silent failure the auto-attach refuses to produce. Creating a credential stays in
n8n, and not only for safety: **7 of the 16 credential types this account uses are OAuth** (measured
— `clickUpOAuth2Api` alone has 93 uses), and OAuth cannot be created by pasting a value. A credential
form in the cockpit would be structurally incapable of handling almost half the types while paying
the whole price of holding secrets.

**A bug worth keeping documented.** The first version returned the `porTipo` entry untouched, and a
project saved before this feature carries `ingredientes.credenciais` without `existentes` — so
reopening an old project showed **zero credentials**, which reads as "you have none" when the truth
was "that field was never saved". `visto` and `existentes` now always come from the **current**
catalogue; only `campos` is reused, because each one costs a schema call. Same class as the
`docAgentes` note above: an absent field must never fall into the negative branch.

**And the control-character trap fired again, in a new place.** The composite key in `catalog.js` was
written as `t + " " + (id || nome)` and the separator came out as **U+0000** — caught by
`caractere-test.js`, which exists for exactly this. It is `JSON.stringify([tipo, id])` now. A
hand-concatenated composite key has failed silently twice in this repository; do not write a third.

### Reopening a saved project is a conversation, and it patches instead of rebuilding

A saved project used to be a dead replay: the conversation, the drawing, the JSON, and the only way
forward was building the whole thing again from scratch. `POST /api/tester/projeto/:slug/editar`
opens it as a live session (`modo: "edicao"`) that reuses the same id format, the same `sessions`
map and the same SSE — so a refresh mid-patch comes back to it, with no new route.

**It writes a patch, not a workflow, and the reason is measured.** Rewriting `workflow.json` whole
is what stage 04 does: on the 65-node agent that was **US$2,79 and 660s**, per request, with every
round free to touch nodes nobody asked about. A patch reads the nodes that matter — and, the part
that decides everything else, **a patch produces a diff**, which is what makes it possible to show
what will change before it changes. A rewritten document only allows comparing two documents, which
is exactly what nobody does.

The verbs are the ones `claude-fix.js` already has, imported straight from it (`applyPatch`,
`diffWorkflow`, `nodesIndex`) — **plus a fourth that lives only here**. `claude-fix.js` has no delete
verb on purpose: there the target is a production flow and "never delete a node" became something
the format cannot express. Here the target is Kauan's own draft, which never went to n8n, and "take
the Slack step out" is a legitimate request. So `removeNodes` exists in `aplicarRemendo()` in
`tester.js`, and `claude-fix.js` still does not know how to delete. The production guarantee holds
because it was not touched.

Two details in `aplicarRemendo()` that cost a test each: edges pointing at a removed node are swept
from the whole document (leaving one dangling makes the gate fail with a message about an invalid
connection, which sends whoever reads it hunting a model error where there was one of ours), and
`applyPatch`'s "patch doesn't change anything" is filtered out when something was removed — the
removal *is* the change, and without the filter deleting a node was rejected as an empty patch.

**A question must not become a patch.** "why does that node have retry?" is a doubt, and the right
answer is a sentence. `resposta.json` has two shapes — `{"tipo":"resposta"}` and `{"tipo":"patch"}` —
and the prompt requires the first one *also* when the request is ambiguous: asking back is cheaper
than patching wrong and more honest than guessing. `blocosConversa()` had to learn to render a
Tester text message for this; during a build it never happens (there the Tester's turn *is* the
understanding card, with `texto: null`), so the branch is inert on the old path.

**Nothing is written until the click, and the screen keeps saying so.** The sandbox copy runs
*after* the accept, not before — writing to n8n for a proposal that may be discarded would be effect
without decision. That is the one place this path deliberately diverges from the build, which writes
its sandbox at stage 05. `salvarEdicao()` pushes the previous `wf` into `versoes[]` (capped at
`MAX_VERSOES`, 10) before replacing it, and only the **delta** of this session's cost is added to
`custoTotal` — adding `s.custo` whole on every accept would charge the second patch for the first
one plus itself.

**Undo is a swap, not a discard.** `desfazerEdicao()` puts the current version back into the list in
the place of the one it restored, so undoing again redoes and neither is lost. It also updates any
open session on that slug, because otherwise the next patch would be written against a document that
is no longer the saved one.

**The stage counter is derived now.** `faixaProc` and `ladoDireito` had `07` written into them, and
an edit has five steps — a `03 / 07` there would be a counter promising two stages that do not
exist. Both read `s.etapas.length`, and "para aqui" reads the `para` flag off the stage itself,
falling back to `PARA_EM` for the build path that does not send it.

**`preview/gen-remendo-preview.js`** renders the review band standalone, including the yellow
deletion warning that only appears when a patch removes a node. The diff in it is **not a fixture**:
it is built by the real `diffWorkflow` over two real workflows, so the page shows the exact object
the band receives. Reaching that screen for real costs a model call and minutes, and it is the
screen that decides whether a saved flow changes.

**The SSE repaint must never eat what Kauan is typing.** The whole screen re-renders on every event,
and a build emits events constantly — the composer, the "Outro…" field and the project title used to
lose text and focus mid-sentence, and the canvas lost its pan/zoom. `capturarInputs()`/
`restaurarInputs()` carry value, focus and caret across the repaint, and the camera lives in `S.cam`
keyed by the drawing's signature.

**The write, and the invariant it revises.** `CLAUDE.md` used to say the only write was an approved
diff. There is now a second class: *create or update exactly one inactive, credential-free workflow
whose name starts with `[SANDBOX tester] `*. Reused by name, so from round two it is a `PUT` — and
the target's **current name is re-read and re-checked** before every one. Never deleted
automatically. `COCKPIT_TESTER_SANDBOX=0` turns it off.

**The footer is derived, and that is not decoration.** It reads "nada foi criado no n8n" until stage
05 writes, then names the sandbox copy; and when a write **fails** it says the result could not be
*confirmed* — a failed `POST`/`PUT` proves the absence of a confirmation, not the absence of an
effect. That is the same reasoning behind never retrying a write here.

### `--allowedTools` does not restrict anything — it auto-approves

Measured 2026-08-10. A session started with `--allowedTools "Read,Write,Edit,Glob,Grep"` **executed
a shell command** and echoed back the string it was asked to print. The flag is an approval list, not
a sandbox. `--disallowedTools` does restrict — same prompt, answer `SEM_SHELL`.

This means the claim this file used to make about the fix session — "No Bash, no network" — **was
false until both files started passing `--disallowedTools`**. It matters far more now that a session
with network exists next door. Both `claude-fix.js` and `tester.js` pass it; do not remove it, and
do not assume `--allowedTools` alone fences anything.

### The global `CLAUDE.md` carries a live n8n API key, and it loads in headless sessions

Also measured by `iso-check.js`: without isolation, every session the cockpit spawns loads the
user's global `CLAUDE.md`, which on this machine contains the n8n API key in plain text. The fix is
**`--setting-sources ""`**, which drops it and the global hooks while keeping the OAuth login.
Verified alternatives that do **not** work: `CLAUDE_CONFIG_DIR` isolates the credentials too and the
session cannot authenticate; an empty `cwd` isolates nothing, because the global file arrives
through the **user** setting source rather than directory discovery. `--bare` is rejected on purpose
— its own help says OAuth is never read under it, i.e. isolation bought with off-plan billing.

**Cost never leaves the plan.** The child environment is built from an **allowlist**, so
`ANTHROPIC_API_KEY` and the Bedrock/Vertex switches are absent rather than blanked — a variable that
does not exist cannot be forgotten. Auth is `claudeAiOauth`, `subscriptionType=team`: what a build
consumes is the same 5h/7d quota as an interactive session, not a card.

### Facts about the Claude CLI that cost time here

- **It is a native `.exe` on this machine** (`~/.local/bin/claude.exe`, ~280MB). `spawn` works
  directly, no shell, no shim.
- **`--mcp-config '{}'` is rejected** — it needs `'{"mcpServers":{}}'`. Without
  `--strict-mcp-config` the session loads every configured MCP server and pays for it at boot.
- **The user's global hooks and `CLAUDE.md` still load** in headless mode. Harmless here, but it is
  why the session prints things the cockpit did not ask for.
- **A denied tool costs a round, quietly.** The first live run tried `Bash` to self-validate, got
  refused, and spent turns explaining that it could not verify. `RULES.md` now states the tool list
  and that validation happens on the cockpit's side. It still occasionally tries; it recovers in one
  turn, which is cheaper than any workaround.
- **Close stdin or pay 3s per round.** With an open, empty stdin pipe the CLI waits three seconds
  for input and then writes `Warning: no stdin data received in 3s` to stderr — which surfaced in
  the cockpit's log looking like something had gone wrong. The prompt travels in `-p`, so the spawn
  uses `stdio: ["ignore", "pipe", "pipe"]`. Verified: stderr empty.
- **Cost and wall clock, measured on a real 33-node flow:** ~176s and ~US$1.16 for one round that
  passed. The review screen shows both — an agent whose price is invisible is an agent nobody
  budgets for.

### `Response.json()` on a 404 body is a number, not an error

The stale-process failure mode documented further down bit this feature on Kauan's first real click,
and it lied about the cause. The old process (started 53 minutes before `server.js` was edited)
answered `/api/claude/status` with the plain-text body `404`. **`JSON.parse("404")` succeeds** — it
is a valid JSON number — so `await res.json()` returned `404`, the panel treated that number as the
status object, read `capab.claudeBin` as `undefined` and printed **"Claude Code CLI não encontrado
em undefined"**. It blamed Kauan's Claude install for a problem that was a stale Node process.

Every call to the new routes now goes through `callApi()` in `flows.html`, which rejects any body
that is not a plain object and names a 404 for what it is: *"esta rota não existe no servidor que
está rodando — ele subiu antes desta versão do server.js"*. Never call `res.json()` directly on
these routes again, and never trust `res.ok` alone: a wrong-but-parseable body is the failure that
gets misread, not the one that throws.

**Node does not reload `server.js`.** After editing it, restart the cockpit window. If a route that
exists on disk 404s, compare the process start time with the file mtime before debugging the code.

### What the first live run caught, and why it stays documented

The first real proposal changed `retryOnFail`, `maxTries`, `waitBetweenTries` and `notes` on one
node. **The diff rendered empty**, because `nodeText()` serialized only
`type/typeVersion/disabled/position/parameters`. A diff that shows nothing for a real change is the
worst possible failure of this screen: it says "nothing to review" at the exact moment Kauan is
about to click approve. The serializer is now an **exclusion** list (`id`, `webhookId`, `name`,
`credentials`) so a field the n8n team adds tomorrow shows up on its own instead of vanishing. If
you ever narrow it back to an inclusion list, you are re-introducing this bug.

## Attribution: which workflow does the failing node actually belong to

n8n reports a child's failure **on the parent**, so `error.node.name` routinely names a node that
does not exist in the flow that failed. The board used to render that as
`WhatsApp API Oficial · Convert text to speech` — Kauan opened the editor, could not find the node,
and was right to distrust the panel. The flow card said the same thing in prose: *"6 de 410
execuções falharam no nó Convert text to speech"*.

`GET /api/n8n/locate/:wfId?node=<name>` answers it as a **fact**: is the node in this workflow, and
if not, which called sub-workflows contain it. It reads `parameters.workflowId` server-side and
emits only `{viaNode, childId, childName, hasNode}` — the parameter object never crosses the
whitelist. Cached 10 min. `claude-fix.js` calls the same function, so the panel and the fix run can
never disagree about where a node lives.

`originOf(wfId, node, lastNode)` in the judgement block turns that into `local` / `subflow` /
`elsewhere` / `unknown`, and **`unknown` renders exactly like `local`** — while the answer is in
flight the panel says nothing rather than hedging about a problem that may not exist.

**Two children can own a node with the same name.** Measured here: `Convert text to speech` exists
in *both* `Agente Iago Comercial` and `Agente eContrate`. Taking the first match would point at the
wrong flow half the time — the same class of error this whole section exists to fix. The
discriminator is `lastNodeExecuted`: it is the node that was calling when it broke, so it is
evidence, not a guess. When it does not disambiguate, the card, the briefing and the review banner
all say so ("N sub-fluxos têm um nó com esse nome … confirme antes de mexer") instead of silently
picking one.

What the panel shows once it knows: a `⤷ <child>` chip between the flow name and the node chip, the
node chip dashed, a sentence naming the caller, an **"Abrir sub-fluxo ↗"** button (the plain "Abrir
no n8n" leads to the flow where the node isn't — that was the wasted trip), and the flow-card
diagnosis reading *"no nó X, do sub-fluxo Y"*.

### The briefing carries the evidence, not just the label

`briefingFor()` now leads with where the node lives, and includes the **executed path** — the last
10 `nodeRuns` with timings and status. That is the difference between "o nó X falhou" and "o nó X
falhou depois de Y e Z, com estes tempos", and it is usually where the node that produced the bad
data shows up. On the live signature it ends with `Call 'Roberto Comercial' · 34,8s · error`.

### A control character made a lookup fail silently, and nothing logged

`nodeOrigin` built its cache key as `wfId + <sep> + node` and `ensureLocate` did the same — except
one of the two ended up with a literal **U+0000** where the space should be (a second spot in
`n8n.js` had **U+001F**). The keys never matched, `Map.get` returned `undefined` forever,
`originOf` answered `unknown`, and the card kept the wrong attribution. **No error, no warning,
nothing in the console** — the failure mode of an invisible byte is that everything looks fine.

Both are gone: keys are `locKey(wfId, node) = JSON.stringify([wfId, node])`, which is ASCII, has no
separator to corrupt, and is immune to a node name containing the separator. The test suite now
fails if any control character other than tab/CR/LF appears in `flows.html`, `cockpit.html`,
`n8n.js`, `server.js` or `claude-fix.js`. **Never hand-concatenate a composite cache key here.**

## The stage speaks n8n

The stage used to be `132×38` rectangles with the node name inside. It is now the editor's own
vocabulary, because the panel and the n8n tab are read minutes apart and a second visual language
costs a translation every time: **84×84 square, drawn icon, label outside and below, ports, bezier
with an arrowhead, dot grid, sticky notes behind everything**. Approved from a standalone preview
(`preview/canvas-n8n.html`, real data embedded, opens with a double click) before any of it touched
`flows.html`.

- **`ICONS` + `iconFor()` are the map, and they are drawn** — one glyph per family, same 24 viewBox,
  same stroke weight, so a row of nodes reads as a system. No emoji, no third-party logo. What
  doesn't match falls to a neutral dash rather than getting a wrong icon.
- **Icon colour is the service; border colour is the state.** They never occupy the same place, so
  the status-colour reservation still holds where it matters. This is the one deliberate risk in the
  port: Redis red sits near failure red. A failed node carries a thicker border, tinted fill, badge
  and pulse — four signals against one hue.
- **`paintNode`/`paintSticky`/`edgePath` are shared by the stage and the handoff mini graph.** They
  were two near-identical blocks before; every tweak had to be made twice and one of them was always
  forgotten.
- **The label lives outside the box, so the node is taller than `NODE_H`.** `boxFor`, `miniBox`,
  `layout` and `follow` all add `LABEL_GAP + 14`. Without it the bottom row of names sits flush
  against the stage edge — measured on the first capture.
- **The per-node time is written when the node lights up** (`paintNodeTime`), from `runData`, and is
  **cleared at the start of every replay**. A stale millisecond number surviving into a new run
  would be the worst lie this stage can tell.
- **Sticky notes render but stay out of the bounding box.** `isAnnotation()` still removes them from
  `nodes`; they are kept aside in `graph.stickies`. They are where the step names live
  (`LOCK + CANCELAR VÁCUO`), and at full-flow zoom they become the map of sections. Their title
  colour is `color-mix(sticky, --txt)` because the raw yellow lands at ~2.5:1 on the light theme.
- **The replay has a pace, and it lives in the judgement block (`REPLAY`).** The first version used a
  45ms floor per node and a 6s budget: the whole tape flew past in about two seconds, which showed
  everything and communicated nothing — the eye cannot follow a jump every 45ms. Real proportion is
  still preserved (a 12s node lasts longer on screen than a 12ms one), but inside a window:
  `stepMinMs` 300 is what can be read, `stepMaxMs` 1500 stops one slow node from freezing the tape,
  `budgetMs` 16000 is the target for the proportional part, and `totalCapMs` 42000 makes the floor
  yield (down to `stepFloorMs` 170) on long flows instead of running for minutes — **and the status
  line says "ritmo comprimido" when that happens** rather than letting a faster tape read as normal.
  Edge timings (`escorre`, `assenta`) and the travelling pulse all derive from the node's step;
  fixed values made the wire settle before the node on slow flows and after the next node on fast
  ones. Measured on the live 23-node execution: 15 nodes settled at 6s, complete by ~10s.
- **`n8n.js` grew exactly two derived fields**, both shape-checked: `sub` (the editor's subtitle,
  from `operation`/`resource`/`mode`, `/^[a-zA-Z][\w .:-]{0,23}$/` or `null`) and `sticky`
  (content clipped to 300, size, colour index). Verified on the live 189-node payload: no
  `parameters`, no `credentials`, no token, no session key.

## The content boundary moved once, deliberately

Until 2026-08-07 **no payload value left `n8n.js`**. Kauan asked for the summary to read "o fluxo
enviou a mensagem X para o lead tal", which cannot be built from shape alone, so a narrow slice now
crosses. The slice is defined by four rules, and widening any of them is a decision about customer
data, not a refactor:

1. **Named fields only** (`SAMPLE_MSG` / `SAMPLE_NAME` / `SAMPLE_WHO` / `SAMPLE_REF`). There is still
   no path that returns raw `json`; a field not on the list does not exist downstream. The search is
   **breadth-first to 4 levels**, because the real payload nests: measured on the Iago flow, the
   fields are `contact.profile.name`, `contact.wa_id`, `message.text.body`, and one node later
   `contato-name` / `contato-wpp` / `contato-msg`. A first-level-only scan — the first version —
   found nothing and left the panel silent on exactly the flows that matter.
2. **Message text passes**, clipped to 180 chars — it is what answers the question.
3. **Phone and e-mail are masked always** (`maskPII`), including when they appear *inside* the text:
   `+55 41 ***** 1395`, `k****@hotmail.com`. Masking only the `to` field would leave the door open
   through `text`, which is where the lead's number usually shows up.
4. **Objects and arrays never pass.** String, number, boolean only.

The lead's *name* is not masked: it is what makes the summary usable ("Ana Palma Rodrigues
Pimenta · k****@hotmail.com"), and it is Kauan's own CRM data on his own machine. Contact details
are what stay covered, because a screen left open all day should not publish a way to reach someone.

**Person names and thing names are the same word.** Taking any `name` made the summary call the lead
"Performance Shopee – Turma 5" — the event. So `SAMPLE_NAME` holds only fields that exist for people
(`full_name`, `pushname`, `contato-name`), and bare `name`/`nome` counts only when its parent object
is a person (`NAME_PARENT`: contact, profile, lead, cliente, from, sender). Anything else lands in
`nomeFraco` and is used only when nothing better shows up in the whole execution. The label is
**"contato", not "lead"** — in the scheduling flow this line reads "Google Meet ·
i****@ecommercepuro.com.br", which is true as a contact and would be a lie as a lead.

**No text is not the same as nothing happened.** When the trigger carries no message body but the
run has `binary`, the summary says *"recebeu um arquivo (áudio, imagem ou documento) … sem texto no
corpo da mensagem"*. That was the execution Kauan opened: the lead sent audio, and a silent panel
looked broken instead of accurate.

**A send node's output is the API's reply, not the message.** The text was on the *input*, which is
the previous node in execution order — so when the send node itself has no text, the summary shows
that item's text and labels it *"(o item que entrou em `<nó>`)"*. That is a verifiable fact, not a
guess about what the node assembled internally, and the label is what keeps the two apart.

## "Rodou" versus "fez o quê"

The panel could say an execution succeeded but not what it *did* — sent a message? wrote a row?
called an API? n8n answers that by showing each node's payload, which here is a real lead's
conversation and **must not cross `n8n.js`**. So what crosses is the *shape*, not the content:

- `shapeOf()` adds `items` (how many), `keys` (field NAMES) and `binary` (audio/image present) per
  node run. Field names go through `KEY_SHAPE` — in a Code node the author can use text as a key,
  and that is the only way content could escape here; a malformed key is dropped, not truncated.
- `EFFECTS` + `OP_VERB` + `effectOf()` in the judgement block turn that into a sentence: *"gravou —
  1 item · campos: id, telefone, status"*, *"empilhou"*, *"respondeu a chamada"*. **No matching rule
  means no sentence at all** — the node keeps its type in the long list and stays out of the summary.
  "Executou" was removed as a fallback on purpose: a verb that fits every node informs nothing, and
  a column of it was what made the first version unreadable. Where a rule matches but declares no
  verb and the node declares no operation, `fb` supplies a service-specific one ("mexeu no banco",
  "mexeu no Redis").
- **The execution reads as prose first, the node list second and collapsed.** `resumoExecucao()`
  builds `lead · recebeu «…» · enviou «…» para … · mudou 3× leu, 1× gravou · fim`. The per-node list
  is the evidence behind it and lives in a closed `<details>` that scrolls inside itself — 105 nodes
  would otherwise push the error board off the screen every time it opened.
- **`external: true` marks what leaves the system** (message sent, row written, API called) and
  those come first, because that is what cannot be undone. Transformation nodes (code, if, set,
  merge) are steps, not effects, and stay out of the short list — measured across 8 live workflows:
  they are 61 `code`, 40 `if`, 26 `set`, and listing them would bury the 6 `whatsApp` and 67
  `supabase` that actually did something.
- **Rule order is load-bearing.** Three node types end in "webhook": `respondToWebhook` was matching
  the httpRequest rule and reading as "chamou uma API" when it *answers* one, and the trigger node
  is not an effect at all — counting it inflated "efeitos externos" by one.

**Which execution is on stage** is now stated twice, because the live list caps at 200 rows and this
instance does ~700 executions a day: the row itself gets `.feed-row.sel` (accent bar, scrolled into
view only when the selection *changes*, never on a poll), and a `#feed-sel` band above the list
names it — *"NO PALCO · 14:53 · WhatsApp API Oficial · #172022 · fora das 200 linhas listadas"*.
Without the band, the question "which one am I looking at?" had no answer in exactly the old cases
that get investigated.

**`.cache-n8n-exec.json` is versioned (`EXEC_CACHE_V`).** Finished executions are immutable, so the
cache never goes stale from n8n's side — but it does from the cockpit's: when `extractExecDetail`
starts extracting a new field, records written before it silently lack it, and the screen shows a
poor summary for old executions and a complete one for new ones. Measured: the effects list came up
with no counts and no field names for exactly that reason. Bump the version on any detail-shape
change; the old cache is discarded whole, never patched.

## Judgement details worth knowing

**Generated-file noise.** A project's newest file is often a cron log, not work. `isGenerated()`
filters `logs/`, `cache/`, `graphify-out/`, `dist/`, `build/` and `.log/.lock/.tmp/.bak`. The
detail view shows both raw last-touch and last *human* touch, and raises a check when they
disagree. Agente Roberta is the live example: files from today, last commit from 2026-06-09.

**Checks are derived, never typed.** `buildChecks()` turns facts into actionable points: no git, no
CLAUDE.md/README, uncommitted count, missing remote, `.env` outside `.gitignore`, missing lockfile,
TODO density, long idle, truncated scan.

**Scan caps.** `WALK_FILE_CAP` 6000 files per project, `TODO_FILE_CAP` 400 files grepped, depth 12.
When a cap trips, `truncated: true` propagates and the UI says the numbers are a floor, not a
total. Never present a truncated count as complete.

**Marking a fix never hides a live failure.** "✓ Correção feita" records the highest execution id
that existed for that signature at mark time (`maxExecIdAtFix`). The signature moves to a collapsed
"marcada como corrigida" list — never deleted — and `fixState()` reopens it the moment an errored
execution with a *larger id* shows up. The discriminator is the **exec id, not the clock**: ids come
from the n8n instance and are monotonic, while `markedAt` comes from Kauan's machine, so comparing
timestamps across the two would either hide a new failure or reopen a good fix on skew. Compared as
`BigInt` — ids can exceed `Number.MAX_SAFE_INTEGER` and lexical compare puts `9` after `100`.

**The note is asked for before saving, and it is the point.** Clicking "Correção feita" opens an
inline field ("o que você ajustou?") — saving without one is allowed, because mandatory friction
kills the habit, but the field comes *before* the save, while he is still in context. Notes surface
again on any future card matching `similarKey()` (`node|type`, workflow dropped), which is correct
rather than sloppy: n8n reports a sub-workflow failure on **both** parent and child with the same
node and message, so `memoria_redis_roberto` on two flows is literally one defect. A note whose fix
was later undone renders as "já tentei isso e não resolveu" — weaker evidence, stated as such.

**Suggestions are heuristics and say so.** `SUGGESTIONS` matches the error message/type/node against
patterns seeded from what this instance actually produces (Redis multi-key, Slack `invalid_auth`,
WhatsApp empty `text.body`, TTS 400, 401/403, 429, network, ExpressionError, Calendar). First match
wins; **no match means no suggestion** — a vague guess would cost the trust that is the whole point
of the panel. Kauan's own note always renders above the suggestion. A live LLM call was deliberately
not built: it would put an API key on the server and change the security story.

**A flow card can be starred or removed, and removal is "wake me when it moves".** Both are view
preferences, so they live in the judgement block and persist in `localStorage`
(`cockpit.flows.prefs.v1`) — the server keeps emitting facts only, and a screen preference has no
business becoming a route. The star pins the card first, above status rank. **Remover is not
archiving**: it records the flow's highest exec id at hide time, and the card returns by itself the
moment a larger id shows up — same BigInt exec-id discipline as `fixState`, never the clock. A flow
with zero executions stores `"0"`, so its first execution ever also brings it back. Star and remove
are mutually exclusive (a pinned card that never shows would be the worst possible state). Removed
flows keep a visible door back — a collapsed line under the grid with "trazer de volta" per flow,
stating the auto-return rule, for the same reason the Tester's trash door is always visible.

**Clicking a flow card filters the error board** to that workflow (`S.errFilterWf`, cleared by the
chip, by a second click on the same card, or by switching project in the rail). It is deliberately
*separate* from `S.selectedWf`: "Ver falha no fluxo" and the live-feed rows move the stage without
touching the filter, otherwise inspecting one failure would collapse the board being read. The chip
in the section header — not the card outline — is the authority on whether the board is filtered.

**A failed read of the marks is never silent.** `loadFixes()` used to swallow every error with
"melhor um mapa velho que nenhum" — which is true for the *map*, and a lie for the *page*: with the
GET failing, `S.fixes` stays empty and the board becomes indistinguishable from "no fix has ever
been marked". A signature you already resolved comes back as open and there is no way to tell. The
error is now kept in `S.fixesError` and stated at the top of the error board, above every count,
because the counts are all suspect while it holds. `markFix` sets it on a failed POST and clears it
on a successful one.

The failure that surfaced this: a `node server.js` process from the day before was still listening
on 4317, so `/api/fixes` 404'd while every `/api/n8n/*` route answered normally. **Node does not
reload `server.js`** — after editing it, the old process keeps serving the old routes and the only
symptom is a 404 on whatever is new. The 404 branch says so by name; if a route that exists on disk
returns 404, check the process start time against the file mtime before debugging the code.

**A fix mark under a capped fetch is not proof.** Recurrence is read from `S.details`, which
`ERROR_DETAIL_CAP` bounds on cold boot. A signature can be absent because its detail was never
fetched, not because it stopped firing — so when `errorsTruncated` is set, the resolved list says
"recorrência não verificável" instead of implying zero recurrences.

**"⧉ Mandar pro Claude" now goes all the way to a diff, and stops there on purpose.** Eight stages
(`HANDOFF` in the judgement block): five read-only ones that build the context, then the Claude
session, the gates, and the review. The briefing is still anchored on `g.key` in superflow format —
it is what Claude receives as `failure.md`, and `⧉ Briefing` still copies it, because handing the
case to a full session by hand has to stay possible. **Never widen `n8n.js` to enrich that prompt.**

**Every stage is backed by real work, and the stage that is still missing is the point.** Stages 2
and 4 fire actual `GET /api/n8n/graph/:id` and `GET /api/n8n/execution/:id` (reusing
`S.graph`/`S.details` when already loaded); stages 6–8 are a real headless CLI process, real
deterministic gates and the diff those gates approved. Nothing is a timer pretending to be work.
What still does not exist is a stage that says **"Claude aplicou a correção"** — because it does
not apply it. `HANDOFF_TRUTH` says so in the footer, and the screen keeps saying "nada disto está no
n8n ainda" until the click. Animating an application that has not happened would let Kauan open n8n
and find the node untouched: the same class of lie as a live clock over stale data. If someone asks
for a "prettier" version of this screen, that sentence and the amber banner are not the parts to cut.

**The run is no longer a wall of log.** A fixed activity band (`.hoff-act`) sits between the mini
graph and the terminal and carries exactly three things: the current stage, the single most recent
fact about what Claude is doing (`Read`/`Grep`/`Write` target, or its last sentence), and a time
bar. The terminal underneath still holds the full history — the band exists because 40 scrolling
lines bury the one line that answers "where is it now".

The bar measures **elapsed time against the median of past runs**, not stages completed: seven of
the eight stages take milliseconds and one takes three minutes, so a per-stage bar would jump to
60% and freeze there. `estimate()` reads `proposals.json` and returns median + p80 + sample count;
median, not mean, because one 4-round run (474s measured) would drag the mean away from the typical
~183s. Below 3 samples it returns `samples: 0` and **the bar goes striped-indeterminate** with
"sem histórico suficiente para estimar" — an invented ETA on the first run is worse than none. Past
the median it caps at 97%, turns `--warn`, and says it overran; it never fills before a proposal
exists, because a full bar over a still screen is the fastest way to lose the panel's credibility.

**`newestSampleId` reads `S.details`, not the frozen group.** The bug it fixes looked exactly like
"marking doesn't save": the error group is built at render time, the SSE keeps adding failures while
the dialog is open (a Claude run takes minutes), so marking with the card's stale id and comparing
against the live one made `fixState()` answer `reopened` immediately — the mark was written to disk
and the card never left the board. The floor is what the card showed, the ceiling is what has
arrived since.

**Applying now marks the signature as fixed, and the note is Claude's own.** Decided 2026-08-06,
replacing the earlier split where the ledger and `fixes.json` deliberately ignored each other. On a
successful approve the panel makes a **second** write — `POST /api/fixes` with the highest exec id
that existed for that signature at that moment — carrying a one-sentence explanation the model
wrote itself. `RULES.md` now requires `report.md` to open with `**Resumo:** …` precisely so that
line can be lifted; `fixNote()` in `claude-fix.js` extracts it, falls back to the first sentence of
*O que mudei* (code fences stripped), and falls back again to the measured diff summary. It is
prefixed `Claude (cockpit) [nós]:` because it lands in the same board as Kauan's hand-written
notes and confusing the two would erase who decided what.

Marking early is safe **only because `fixState()` reopens on a larger exec id** — the mark is a
claim about what was done, never about what worked. Two consequences that must not be softened:
the two writes fail independently, so applied-and-marked and applied-but-not-marked are different
screens (`APPLY_MARK_FAIL` names the error); and **↺ Desfazer undoes both**, because a reverted
flow with the signature still marked is a live failure nobody is being told about.

**After applying, the review band becomes a receipt, not a proposal.** `renderDone()` replaces it
with `[ CONCLUÍDO ] Alteração concluída`, the time and flow, the model's sentence in `.notecard`,
whether the board write landed, `APPLY_CAVEAT`, and the diff collapsed into `<details>` — audit
stays reachable without competing with what is new.

**After applying, the screen refuses to claim victory.** `APPLY_TRUTH` explains that the backup
exists and that the next execution is the first one to run with the change; `APPLY_CAVEAT` says
plainly that applying is **not** proof the failure is gone, and that the signature stays on the
board until it stops recurring. The cockpit already knows how to tell that difference — `fixState()`
reopens on a larger exec id — so the screen must not pre-empt it.

**The review band is `[ REVISÃO ]` inside the `[ HANDOFF ]` modal**, not a sixth page section. It
reuses the same gate/diff vocabulary and stays out of the `[ 0n / 05 ]` count for the same reason
the overlay does.

The overlay renders **its own** mini graph with the same `.nd`/`.edge` classes and states as the
stage, but never touches `S.view` — that camera is a singleton owned by `#svg`, and driving it from
here would pan the panel sitting behind the scrim. It closes on Esc, on the scrim, and on either
Fechar; closing mid-run cancels the remaining stages through a token check (`alive()`), so a
half-finished sequence cannot keep writing into a removed DOM.

**Error-detail cap.** `ERROR_DETAIL_CAP` (40) bounds how many errored executions get an
`includeData=true` detail fetch per cold boot — each is a multi-MB payload serialized behind
`MAX_INFLIGHT=4`, so an uncapped loop would hold `/api/n8n/overview` open for a minute on a bad day.
When it trips, `errorsTruncated` propagates and the error board states the signatures are a floor.
The "Falhas 24h" KPI is unaffected — it counts execution rows, which are never capped.

## Locked decisions

- **Hosting:** localhost first. Deploy target undecided — keep the build portable. No host-locked
  APIs, no server requirement, output stays static-friendly.
- **Source of truth:** markdown with frontmatter, one file per project. Chosen because it is
  git-versionable, hand-editable, and natively an Obsidian vault.
- **Obsidian:** convention, not integration. Sharing the file format costs nothing and requires no
  plugin, no Local REST API, no Sync subscription, no running process. Do not build a two-way
  Obsidian integration — it adds a runtime dependency and a merge-conflict surface for no gain.
- **Data authorship:** an agent writes project data at end of session. Manual editing stays
  possible but is not the primary path. Every personal dashboard that depends on manual entry dies
  in about two weeks — the agent is the ingestion mechanism, not a convenience.
- **Write boundary (revised — was read-only):** the cockpit still never modifies project code and
  never deploys. It now **can** modify one thing: a workflow, through `POST
  /api/claude/run/:id/approve`, and only under all of these at once —
  1. a proposal produced by the local Claude session,
  2. that passed every deterministic gate,
  3. whose **diff was rendered on screen** before the click,
  4. clicked by Kauan, once, for that specific proposal,
  5. with a backup written first and `↺ Desfazer` available.

  That is not a softening of the old rule, it is the old rule's own condition being met: the
  standing requirement was always "per-action authorization with the diff shown first". What stays
  out is anything that skips a step — no auto-apply, no "apply all", no scheduled fixing, no
  retrying an execution, no deleting anything. `fixes.json` and `proposals.json` remain what they
  were: bookkeeping about what was observed and decided.

## Where the opinion lives

Two judgement blocks, both at the top of their page script. **Nothing else in the codebase judges
anything** — the rest only renders. Keep it that way: scattering it across the render functions
turns every tweak into an `if`-hunt.

**`flows.html` — flow health (v0, awaiting Kauan's calibration).** `BANDS`: >20% error rate or 3+
absolute failures in the window = risk; any failure = warn; active but idle >90 min = cold; >30s =
slow.

**Who reaches the front door: `naPorta(f)`, and it is called from two places, never copied.**
The rule is *ran in the window*, **or** `active`, **or** *called by a live flow* — minus anything
whose name is scratch and never ran. Three things it fixes, all measured on the live instance
2026-08-10:

- **A sub-workflow can never be `active` in n8n** — the parent is what gets woken. So `Agente
  eContrate` (108 nodes, production, called by `WhatsApp API Oficial` with 645 executions) sat in the
  collapsed list because it happened to be quiet for 24h, while its own caller was the top card.
  `/api/n8n/callers` supplies the call graph as a fact; "live caller" is decided here. Measured: it
  admits **3** flows, not 40.
- **A scratch name is now a filter, not just a label.** `[ROBERTO] Agent — Iago Comercial (TESTER)`
  was on the board with zero executions purely because it was `active`. Scratch-**and-never-ran**
  leaves; scratch **that ran** stays, because hiding a failure on account of its name would be the
  worst trade available. `SCRATCH` gained `\(tester\)` and `^\[sandbox`: it now matches 25 flows, and
  **none of them has an execution in the window** — in particular it does not match `Agente Iago
  Comercial`, the real flow, with 87. Re-run that count if you touch the regex; a false positive here
  erases a production flow from the screen.
- **A scratch flow is not a live caller either, and callers are ordered by evidence.** The TESTER copy
  is `active`, so it was being credited on screen as the parent of two Tools that the *real* agent
  calls — "Sub-fluxo de … (TESTER)". Worse, a Tool called only by a test copy would have entered on
  its strength. A caller counts when it ran, or when it is active *and* not scratch; the list is
  sorted by execution count, so the label names the caller that has proof behind it (the same
  "evidence, not a guess" reasoning as `lastNodeExecuted` in the attribution path).

`motivoPorta(f)` is what the card says when a flow is there for the caller's sake — the `proj` line
reads `CHAMADO POR WHATSAPP API OFICIAL` instead of `· inativo`, and `diagnose()` says *"quem dispara
é o fluxo que chama, então olhe lá primeiro"* rather than "gatilho pode estar mudo", which would send
Kauan to inspect a trigger the flow does not have. While the call graph is still loading — or if it
failed — the collapsed list says so, because until it lands that list may be hiding a production
sub-workflow and must not read as complete.

Filtering by activity at all matters because the instance holds 68 workflows and only ~9 execute:
without it the signal is buried under `My workflow 1–6`, `SANDBOX` and `(apagar)`.

**`cockpit.html` — disk project health (v0).** momentum 60% / documented 25% / versioned 15%; bands
at 14 / 45 / 120 days. Known gap: no project *type*. A production project idle 60 days is healthy;
an experiment idle 60 days is dead weight. The model treats them identically.

**Known gap in the flow model:** it has no notion of *expected cadence*. A cron that should fire
hourly and a webhook that fires when a lead writes are judged by the same 90-minute idle band, so a
quiet Saturday reads as "cold" on flows that are perfectly healthy.

## Design rules

Derived in `00-research.md` from Linear/Stripe/Vercel/Grafana convergence — read that file before
relayouting.

**Visual references for `flows.html` (chosen by Kauan):** firecrawl.dev and pandavideo.com. They
map onto the two themes instead of fighting each other — **dark is Panda Video** (near-black navy,
electric indigo accent, big numerals, generous space), **light is Firecrawl** (paper white, hairline
blueprint grid, mono bracket annotations like `[ 01 / 04 ]` and `[ 30 NÓS · 33 CONEXÕES ]`).
Firecrawl's signature orange is **identity only** — wordmark, section index, grid sparkles. It is
never a status color, because status color stays reserved.

- Sidebar 250px + KPI strip + CSS Grid card area (`auto-fill`, `minmax(290px, 1fr)`).
- Five numbered sections: `[ 01 ]` stage, `[ 02 ]` live feed, `[ 03 ]` grouped errors,
  `[ 04 ]` completed fixes (header hidden when empty), `[ 05 ]` flows with activity. Renumber all
  five together — a stale `[ 04 / 04 ]` next to `[ 05 / 05 ]` is the kind of detail this panel
  cannot afford to get wrong. The handoff overlay is **not** a sixth section: it is a modal over the
  page, indexed `[ HANDOFF ]`, and it stays out of the count.
- In `.panel-hd`, controls never shrink. Flow names are long ("Agente Iago Comercial" in a 740px
  panel) and a plain flex row squeezed the buttons until `⤢ Caminho` broke under its own icon. The
  title and hint truncate with ellipsis; `.btn` is `flex: 0 0 auto`.
- **KPI strip capped at 6.** More cards become wallpaper and get ignored within two weeks.
- Status color (ok / warn / risk / cold) is **reserved**. Never reuse it as a chart series color.
- **A status color as fill and the same color as text are two different tokens.** `--ok/--warn/
  --risk/--cold/--accent/--brand` were calibrated as bar, border and fill, where WCAG imposes no
  contrast floor. Reused as small text they failed AA — measured on the live DOM: light theme
  `--ok` 3.39, `--warn` 3.64, `--risk` 4.20 in a pill, `--cold` 3.18, `--brand` 3.12; dark
  `--cold` 3.11 and `--accent` 4.17. There is now a parallel set — `--ok-txt`, `--warn-txt`,
  `--risk-txt`, `--cold-txt`, `--accent-txt`, `--brand-txt` — used **only** in `color:`
  declarations, so the red bar keeps the exact red Kauan calibrated and the label is still legible.
  Where the original already passed, the pair holds the same value. Adding a new colored label means
  reaching for the `-txt` token, not the status token.
- **A text token must clear every surface it lands on, not the easiest one.** `--txt-faint` was
  tuned against `--surface` and still failed on `--surface-2` (4.33) and on the selected rail item's
  `--accent-soft` composite (3.85). It is now set from the *worst* background, with headroom above
  4.5 rather than landing on it — a 4.4996 that rounds to "4.50" is a fail.
- **Raising the bottom step of the text ladder moves the step above it.** `--txt` / `--txt-dim` /
  `--txt-faint` are three levels of emphasis, and `.nd text.nm` (node name, dim) versus
  `.nd text.ty` (node type, faint) is where the gap is load-bearing. Pulling faint up to AA left the
  two within 10 channel points in light theme, so the graph distinguished name from type by font size
  alone. Both tokens moved: dim now sits near 9:1 (darker in light, lighter in dark), which reopens
  the gap and reads better on its own. Touching only faint forces a choice between AA and hierarchy —
  don't. After changing any of the three, check `.nd text.nm` against `.nd text.ty` on the stage,
  not just the contrast sweep: the sweep samples `.hoff-mini .corner` but never the SVG node labels.
- Every component needs loading, empty, and error states designed. Empty state exists; the other
  two arrive with real async data.
- Light and dark both first-class. Tokens on `:root`, redefined under
  `@media (prefers-color-scheme: dark)` and again under `:root[data-theme="dark"|"light"]` so the
  viewer's toggle wins in both directions. Never style components inside the media query.
- Numerals use `--font-num` with `tabular-nums`. Instrument-panel vernacular, and columns align.
- Mobile is a different information budget, not a squeezed grid: single-column card stack, rail
  collapses to scrollable chips, touch targets ≥40px.
- **Everything clickable is reachable by keyboard.** The flow cards, rail items and feed rows are
  `div`s with `onclick` — measured, 0 of 14 cards, 0 of 5 rail items and 0 of 200 feed rows could be
  focused, so the panel only worked with a mouse. `clickable(node, label, fn)` gives them
  `tabindex`, `role="button"`, an accessible name and Enter/Space without rewriting the markup or
  losing the grid layout. Use it for any new clickable non-button.
- **Focus is visible.** The panel declared no focus style at all, and Chrome's default outline
  disappeared against the buttons' gradient border. `:focus-visible` now draws an explicit
  `--accent` ring with offset, plus the hover fill on rows so the cue is never colour alone.
- **The handoff is a real dialog.** `role="dialog"` + `aria-modal` + `aria-labelledby`, the body's
  other children get `inert` while it is open (17 page controls stayed tabbable before that, so Tab
  walked out of the modal into buttons hidden under the blur), the terminal is
  `role="log" aria-live="polite"` because it fills in over several seconds, and the mini graph is a
  labelled `role="img"` rather than 178 unreadable node labels. On close, focus goes back to the
  button that opened it — **found again by `data-key` on the error card**, because the SSE usually
  redraws that card while the dialog is open and the original node is gone.
- Cards state a diagnosis in words, not just a score. A number tells you something is wrong; a
  sentence tells you what to do.

## The motion layer (cult-ui, ported — not installed)

Kauan picked [nolly-studio/cult-ui](https://github.com/nolly-studio/cult-ui) as the movement
reference. It is React + Tailwind + framer-motion, distributed shadcn-style by copy-pasting a
`.tsx` per component. **It was deliberately not installed** — that would mean npm, a build step and
React inside a panel that is one HTML file with zero dependencies and boots from a `.cmd`. What
crossed over is the *recipe*, rewritten in plain CSS/WAAPI, marked in a block at the end of the
stylesheet:

| cult-ui component | ported as | where |
|---|---|---|
| `border-beam-button` | `.beam` + `@property --beam-a` conic gradient with an xor mask | Recarregar, Reexecutar visual, Mandar pro Claude, overlay frame |
| `texture-button` | `.btn` two-layer gradient bevel (padding-box fill + border-box frame) | every button |
| `texture-card` | `.kpi::after` / `.panel::after` diagonal sheen | KPI strip, panels |
| `glow-button` | `.card::after` radial gradient at `--mx`/`--my`, set on `pointermove` | flow cards |
| `animated-number` | `springNumber()` — the same spring constants integrated in a rAF | KPI numerals |
| `grid-beam` | `.backdrop .gbeam` traveling hairline | page background |
| `terminal-animation` | `.hoff-term` sequential mono lines | handoff overlay |
| `dynamic-island` / `expandable-screen` | WAAPI morph from the clicked button's rect | handoff overlay |

Rules that came out of building it, and that a future pass must not undo:

- **Movement is `--accent` only.** Status color stays reserved and `--brand` stays identity. A
  cinematic overlay is exactly where an orange glow gets reached for; it does not belong there.
- **No colored glow shadows.** Elevation is neutral (`rgba(0,0,0,…)`); the accent appears as border,
  fill or background gradient, never as a chromatic halo. That look is the default tell of a
  generated UI and the design hook flags it.
- **Nothing re-animates on a poll.** The SSE redraws the KPI strip, the flow cards and the error
  board every cycle. Entrance animation is gated on first paint plus genuinely new ids
  (`seenCardIds`, `seenErrKeys`), and `springNumber` only runs when the value actually changed —
  its previous value is read off `dataset.raw` before the strip is cleared. Movement with no new
  information behind it is noise, and after two weeks it is worse than no movement.
- **`prefers-reduced-motion` keeps every stage and every fetch**, dropping only the morph, the
  stagger, the spin and the pause between lines. No information lives in the animation. Verified by
  emulating the media feature: six stages complete and the briefing still lands.

Three CSS facts that each cost a verification cycle — do not re-derive them:

- **On a clipped container the beam must sit at `inset: 0`, not `-1px`.** `.hoff` needs
  `overflow: hidden` for its inner rows' corners, and that clips its own `::after` — at `-1px` the
  beam renders entirely outside the clip and silently disappears. `getComputedStyle(…, '::after')`
  reports `opacity: 1` either way, so it looks fine and shows nothing. The only honest check is a
  screenshot with `--beam-a` pinned to a known angle.
- **`.backdrop` needs its own `overflow: hidden`.** `body { overflow-x: hidden }` does **not** clip a
  `position: fixed` layer, so the traveling grid beam escaped the viewport and created horizontal
  scroll.
- **`.panel-hd` controls don't shrink on desktop, and therefore must wrap on mobile.** The two rules
  are one decision: `flex: 0 0 auto` is what stops `⤢ Caminho` breaking under its own icon at
  1440px, and it is also what overflowed the page at 390px until `flex-wrap: wrap` was added there.
  Change one and you must change the other.

## Data

Walk excludes `.git`, `node_modules`, `.next`, `dist`, `build`, `out`, `venv`, `.venv`,
`__pycache__`, `.cache`, `.turbo`, `.vercel`, `coverage`, `.pytest_cache`.

The freshness stamp renders `scannedAt` from the payload — **never** `new Date()`. A live clock on
stale data is a lie: it proves the page is alive, never that the data is.

Never fabricate a project field. If a signal was not scanned, omit it rather than filling a
plausible value — the whole point of this cockpit is that its numbers can be trusted.

`.env` contents are never read or transmitted. Only its presence and whether `.gitignore` covers it.

## Open questions

1. Project **type/tier** (production / client / experiment / archive) — the biggest gap in the
   health model. For flows, the equivalent gap is **expected cadence** (see above).
2. ~~Which live integrations land first~~ — **answered: n8n runs.** Open follow-up: does the n8n
   panel merge with the disk portfolio into one view, or stay a separate front door?
3. ~~Does the cockpit stay observe-only, or gain actions?~~ **Answered: it acts, under approval.**
   It runs the Claude Code CLI locally and applies an approved workflow diff. Open follow-ups:
   (a) does `COCKPIT_SANDBOX_TEST` become the default once the sandbox copies prove harmless?
   (b) should a *retry* of a failed execution be offered too — it is a different kind of write
   (replays side effects: real WhatsApp messages, real Slack posts) and has **not** been decided;
   (c) ~~the proposal ledger and `fixes.json` ignore each other~~ — **answered 2026-08-06: applying
   marks the signature**, with Claude's own sentence as the note, and Desfazer unmarks it. Open
   follow-up: `proposals.json` and `fixes.json` are still two files, joined only by the signature
   key; a single event log would make "what did we do about this failure" one query instead of two.
4. **Deploy.** "Sempre atualizando" is currently localhost + SSE. Going always-on means a hosted
   process that holds the n8n key — which changes the security story, because today the key never
   leaves Kauan's machine.
4. Do the per-project `.md` files live in a new `projects/` vault here, or inside the existing
   `Chief of Staff` vault? **Still unanswered.**

## Related

An "Agent Engineer" is planned as a separate, global concern. Kauan will spec it after the cockpit.
Do not design the cockpit around assumptions about it.
