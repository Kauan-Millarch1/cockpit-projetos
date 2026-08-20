# Plan: dossiê incremental — o hash global, a regeneração parcial e o semáforo na vitrine
_Round 0 — initial draft by Claude_

Repo: `Cockpit Projetos`. Read `CLAUDE.md` at the repo root first — it is law here, not
recommendation, and several constraints below are quotes from it.

## Goal

The dossier (`dossie.js` — prose describing a flow node by node, so a session understands a
179-node flow without reading 291KB of JSON) rots on every upgrade and nobody is told. Two
halves:

**A.** Applying an upgrade through the cockpit leaves the dossier stale. Today the only repair
is a **full** rewrite of every paragraph: measured **US$4.14 / 682s for 179 nodes**. Make the
repair proportional to what actually diverged.

**B.** A flow edited directly in the n8n editor rots its dossier too, and the semaphore only
fires when that flow's screen is opened. 62 workflows, ~3 opened. Make "which dossiers rotted"
answerable without 62 clicks.

A third thing became urgent today and reframes both: a lock shipped this morning
(`podeConversar` in `upgrade.html`) means **red or grey now locks the conversation**. A rotten
dossier is no longer just stale prose — it freezes the tab.

## Measured facts (attack these first if they are wrong)

From `dossies.json` — the whole ledger, 3 rows:

| flow | nodes | rounds | ms | usd | outcome |
|---|---|---|---|---|---|
| Agente eContrate | 103 | 2 | 520149 | unmeasured | **failed** — session timed out |
| Agente eContrate | 103 | 1 | 514076 | 2.0595 | ok, 23841 bytes |
| Agente Iago Comercial | 179 | 1 | 682346 | 4.1384 | ok, 56404 bytes |

- `TETO_MS = 900000` (15 min). Iago's successful write took **76% of that cap**. eContrate's
  first attempt **died at the cap with cost unmeasured**. A full rewrite is already near its own
  ceiling and gets worse as flows grow — incremental is not only cheaper, it is the only version
  that keeps fitting.
- `preco(nos)` = median usd-per-node over successful writes × **total** node count. With 2
  samples the median is `porNo[1]` = 0.02312, so Iago quotes 0.02312 × 179 = **US$4.14**. That
  is the number on the button in the screenshot that started this.
- **`nosRegenerados` exists in every ledger row and has never differed from `nos`** (103/103,
  179/179). The field is the plan's own admission that this was always meant to be incremental.
- `MAX_RODADAS = 2`, `MODELO = sonnet` (env-overridable), `LIMITE_LARANJA = 0.25`.

From `dossie.js`:

- `impressoes(wf)` returns `{ global, porNo }`.
  `global = sha(JSON.stringify([canon(connections), canon(settings)]))` — **one hash for two
  facts.**
- `porNo` per node = `sha([semRuido(node), entra[node], sai[node]])`, where `adjacencias()`
  records, **for both directions, sorted**, `[porta, iRamo, node, index]`. So every endpoint of
  an edge move has its own fingerprint moved, independently of the global hash.
- `estado(dossie, wf)` red branches, in evaluation order: (1) `entraram`/`sairam` non-empty;
  (2) `globalMudou`; (3) `mudados/total > LIMITE_LARANJA`. Otherwise orange, else green, and
  `cinza` when there is no dossier at all.
- `paraPrompt` returns `usa: false` for grey and red (not delivered to the session) and
  `usa: true` for orange, with the divergent paragraphs marked `⚠`.
- `compor()` writes a per-paragraph anchor `<!-- NO {"no":…,"fp":…,"de":…} -->` and a header
  anchor `<!-- GLOBAL {"fp":…,"wfId":…,"em":…} -->`. **`parse()` reads `de` and defaults it to
  `"dossie"`. A per-paragraph provenance slot already exists and is unused.**
- `visao` is a single `## visão geral` section placed **before the first node anchor**, so
  `parse`'s header slice carries it into the prompt. The build prompt calls it the part that
  matters most: it says which **stretches** the flow has and in what order.
- `construir()` does `fsp.rm(dir, {recursive:true})` and rewrites everything, every round.
- `validar(md, raw, imp)` is the leak gate: no parameter value may reach the `.md`, two sweeps
  (verbatim value, and personal-data shape anywhere). A leak refuses the **whole round**.

From `dossie-test.js` (114 cases, in `testar.cmd`):

- Line 203 asserts `stRewire.cor === "vermelho" && stRewire.global === true`, and the comment
  above it argues the decision explicitly: *"Global divergente invalida o dossiê INTEIRO:
  contexto de execução diferente reescreve o sentido de todo parágrafo. Vermelho, não laranja."*
  The file header names the rewire as **the** load-bearing case of the whole suite.
- The same block asserts what must **not** invalidate: dragging a node (position), attaching a
  credential, key order inside a parameter.

## Approach

### Step 1 — Split the global fingerprint, preserving the original argument rather than contradicting it

The claim under the current design is *"a different execution context rewrites the meaning of
every paragraph."* Split it by which fact moved:

- **`settings` moved** (`executionOrder`, `errorWorkflow`, `timezone`, `callerPolicy`…) — the
  claim holds. Every paragraph is reframed. **Stays red.**
- **`connections` moved** (a rewire) — what actually breaks is **the map**: which stretches
  exist and in what order. And the map is the **`visão`**, one section. The per-node paragraphs
  are already protected by the adjacency signature, which moves for every endpoint of the edge
  that moved.

So the proposal is *not* "connections stops mattering". It is: **a connections change
invalidates the `visão` and the affected nodes, not every paragraph.**

Concretely:

1. `impressoes()` returns `{ global, settingsFp, conexoesPorNo, porNo }`. `global` is kept and
   still computed exactly as today, for backward compatibility (below).
2. **`conexoesPorNo` is a MAP, not one hash, and round 2 is what forced that.** Per source key,
   the hash of that node's outgoing connection list **preserving array order**:
   `sha(canon(connections[nome]))` without the sort that `adjacencias()` applies. `compor()`
   writes it and `settingsFp` into the GLOBAL anchor **alongside** the existing `fp`; `parse()`
   reads all of them, defaulting to `null`.

   The reason it is per key: **the fingerprint must record at the granularity where the
   invalidation decision is made** — the same principle `CLAUDE.md` already argues for the
   per-node rather than per-flow cache. With one aggregate hash, a sibling reorder is detectable
   but not **localizable**, and round 2 showed what that costs: the paragraph that goes stale is
   the **source node's** (the dossier contract lets a paragraph say who it sends to, and
   therefore in what order), while `mudados` stays empty and the paragraph is inherited intact.
   Per key, the reorder moves the source's entry, the source lands in `mudados` **by the normal
   path**, and its paragraph is regenerated with no special case anywhere.
3. `estado()`:
   - `settingsFp` present on both sides and divergent → **red**, motivo names `settings`.
   - **`conexoesPorNo` divergent on one or more keys** → those source nodes join `mudados`, and
     `visaoSuspeita: true` because the map changed. Colour by the normal 25% rule, with a
     **floor of orange** — never green, since the visão itself is now suspect.
   - **The aggregate `connections` hash diverges but no per-key diff explains it** → **red**.
     Fail closed: a divergence we cannot localize is one we cannot patch, and that is round 2's
     *"if you cannot identify them with proof, full rewrite"* applied literally. It should not be
     reachable, which is exactly why it must be handled instead of assumed away.
   - **Old-format header** (`settingsFp`/`connectionsFp` absent, only `fp`): compare `fp`
     against the freshly computed `global` **first**. Equal → nothing global diverged, proceed to
     the per-node comparison as today. Different → **red**, exactly as today, because an old
     header cannot say *which* of the two moved — **and red refuses incremental** (step 2), so
     the only migration path from a divergent legacy header is a full rewrite. The split fields
     are written on the next write. This is what stops the two existing dossiers being
     force-invalidated on deploy.

**MEASURED COUNTEREXAMPLE — round 1 of the review found this and it was verified in code.** The
round-0 draft claimed that every `connections` change moves at least one node's adjacency
signature. **That is false.** Reordering the destinations *inside the same branch*
(`A.main[0]: [B, C] → [C, B]`) moves `connectionsFp` and moves **no** node fingerprint at all,
because `adjacencias()` sorts the tuples and that sort erases sibling order. Verified against
the real `impressoes()` on a 3-node fixture: `global` changed `true`, and A, B and C each
changed `false`. Under the round-0 rule that would have landed in **green with `mudados = 0`** —
a reordered flow reading as "nothing diverged", which is worse than the full-invalidation it was
meant to improve on.

Hence `conexoesPorNo` being a per-key map: it makes the reorder **localizable**, so the source
node's paragraph is regenerated rather than merely flagged.

**The rejected alternative**, and the reason: putting the destination's index-in-array inside the
`adjacencias()` tuple would also make the reorder visible, and more directly — but it would
change **every node fingerprint in existence**, force-invalidating both dossiers that exist and
costing ~US$6.20 to rebuild them for a case nobody has hit yet. The per-key map lives in the
header instead, so no existing fingerprint moves; a legacy dossier simply has no map, which puts
it on the migration path already described.

**Test cost, stated plainly.** `dossie-test.js:203` has to change, and that is the most
expensive part of this step — this repo's own `CLAUDE.md` says a test whose assertion is
loosened *"approves the absence of the decision"*. The existing case is **not deleted**: its
assertion becomes "the rewire invalidates, the visão is marked, and both endpoints are in
`mudados`", and its comment is rewritten to argue why the *reason* changed while the *verdict*
on that fixture does not. On the 4-node fixture, 2 of 4 endpoints moved = 50% > 25%, so it is
**still red — by `fatia`, not by `global`**. A second, larger fixture is added where the same
rewire is 2 of 179 = 1.1% → **orange**, because that is the case the change exists for, and
asserting it only by implication would be asserting nothing.

**What survives the counterexample.** Swapping *branches* (`iRamo` 0 ↔ 1) does move both
endpoints' tuples, because `iRamo` is inside the recorded tuple — that case was never the hole.
Moving an edge between different nodes also moves the source's `sai` and the target's `entra`.
The single blind spot is sibling order within one branch, and the orange floor covers it without
touching any fingerprint.

### Step 2 — `construir()` gains an incremental mode, keyed on `estado()`, never on the patch

The upgrade path knows the patch by verb (`updateNodes`/`addNodes`/`rewire`) and it is
**tempting and wrong** to derive the stale set from it: the fingerprint is the authority, it has
114 cases behind it, and it catches what the patch does not name — a rewire's third endpoint,
and the `settings` keys `pickSettings()` drops on the way to n8n (a dropped key is a key
**removed** from the flow, and it was never on the approved diff). Deriving from `estado()` also
means the screen and the regeneration can never disagree, because it is the same function that
paints the semaphore.

**THE ADMISSION RULE, and it subsumes two of round 1's findings: incremental is allowed only
from a GREEN or ORANGE dossier. Never from red, never from grey.** Red already means *"every
paragraph is talking about a context that changed"* — inheriting from it would publish
paragraphs the gate has already declared false. That single rule closes round 1's finding 2 (a
divergent legacy `GLOBAL` header is red, so it can only migrate by full rewrite) and finding 3
(`entraram`/`sairam` is red, so a node entering or leaving the middle of the flow never inherits
anything) without a second mechanism for either.

**COLOUR IS NOT ENOUGH, AND ROUND 2 IS RIGHT ABOUT WHY: admission must also check
provenance.** The semaphore is about fingerprints, and a dossier can return to **green** by
fingerprint while still carrying paragraphs that step 3 flagged as semantically suspect. Under a
colour-only rule that dossier becomes the base of the next inheritance, and the drift compounds
across generations while the screen says green the whole way. Two bounds, both cheap, using the
`de` slot that already exists per paragraph:

- **The one-hop flag does not stack.** A paragraph that was already flagged adjacent-to-a-change
  in a previous write and would be flagged again is **regenerated instead of re-flagged**.
  Re-flagging is how a caveat becomes permanent furniture.
- **A generation counter `g` per paragraph**, incremented on every incremental write it survives
  untouched and reset to 0 when it is rewritten. **A paragraph with `g >= MAX_GERACOES` is not
  inheritable** — it is regenerated, so the refresh rolls rather than the file being rewritten
  whole. It bounds the case the flag does not catch: a paragraph never adjacent to anything while
  the flow around it keeps moving.

`MAX_GERACOES = 3` is **an uncalibrated guess and is labelled as one**, like every other number
in this repo that has not been measured. It is the knob to turn once there is incremental history
in `dossies.json` to look at.

**The cost of that rule, stated plainly:** `addNodes` is a common upgrade verb, so **an upgrade
that adds a node still pays the full US$4.14.** The tempting extension — treat add/remove the
same way as connections, rewrite the `visão` plus the new node and its neighbours, inherit the
rest — is **deliberately not in this plan.** It contradicts an even more explicitly argued
decision (§2.6: *"the sentence 'nodes 12–19 are the buffer' becomes false when a node enters the
middle, even with the eight originals intact"*), and stacking two contested loosenings of the
same gate in one slice is how a gate stops being trusted. Measure incremental on the cheap case
first; then that argument can be had with data instead of with reasoning. It is the obvious next
slice, not a gap nobody noticed.

1. `construir(wfId, { incremental: true })`. Read the existing `.md` with `ler()`, compute
   `estado()`, and **refuse unless the colour is green or orange**. Regenerate set = `mudados`,
   plus **always the `visão`** (and `visaoSuspeita` alone, with `mudados` empty, is a legitimate
   incremental write of exactly one section). `entraram`/`sairam` cannot occur here, by the
   admission rule.
2. The session's directory gets the **existing `DOSSIE.md`**, so the new paragraphs match the
   voice and do not contradict inherited text, plus `fluxo.json` and `nodes-index.md` as today.
   It has `Read`/`Grep`, so it reads only the nodes it must write about — that is where the
   saving comes from, on input as well as output.
3. `compor()` reuses inherited paragraphs **verbatim**, with their existing `fp` and their
   existing `de`. New paragraphs get `de` = this write's stamp.
4. **Incremental refuses** and falls back to a full rewrite when the colour is not green or
   orange (the admission rule above — which covers no existing `.md`, `settingsFp` moved,
   `entraram`/`sairam`, and `> LIMITE_LARANJA`). Reusing `LIMITE_LARANJA` for the second job is
   named in the tradeoffs as contestable.
5. **Two gates, not one, and round 1 was right that "run the leak gate over the composed
   document" was underspecified.** `validar(md, raw, imp)` parses the **round format**
   (`CAB_NO = "^## no:[ \t]*"`, verified at `dossie.js:491`), not the final anchored file, so it
   cannot be pointed at the composed document as written. They are separated explicitly:
   - **Structural validation** (`validar`) runs on **the new text only**, in the round format it
     already speaks. Unchanged.
   - **The scrub** (`vazou(final, rawAtual)`) runs on the **composed whole document**, because an
     inherited paragraph could match a value that entered the flow after it was written. Local
     code, free.
   - **A legacy dossier may not be inherited from at all.** Codex's sharper half: an inherited
     literal that has since *left* the workflow no longer matches the verbatim sweep, so if it
     also escapes the PII-shape sweep it becomes undetectable forever. Today that is safe only
     because the paragraph passed the gate under the same rules at write time — which is a
     property of the gate's **version**, and nothing records it. So `compor()` writes a
     **`gateV` stamp** into the GLOBAL anchor, and **a dossier whose header carries no `gateV`,
     or an older one than the current, forces a full rewrite.** Without that stamp, inheritance
     is trusting a gate nobody can identify.
6. Ledger: `nosRegenerados` finally differs from `nos`, and a new field
   `modo: "incremental" | "inteiro"` is written. **`preco()` must filter by `modo`** — mixing a
   full write's usd-per-node with a partial one's produces a number wrong in both directions, and
   that quote is the only price the button can show.

### Step 2b — One dossier write per flow at a time, and refuse to publish one born stale

Round 1 found this and it is the finding this plan would otherwise have shipped without. Two
independent races, both reachable today, **before** anything in this plan:

- **Two writes of the same flow collide on two shared paths.** `construir()` computes its scratch
  dir from the `wfId` alone (`dossie.js:602`) and does `fsp.rm(dir, {recursive:true})` on entry,
  and the publish uses `caminho(wfId) + ".tmp"` (`:640`). A second write of the same flow deletes
  the first one's working directory **mid-session** and then races it on the same temp file. The
  existing guard is per-route and process-local; it is not a lock.
- **A write racing an `aplicar()` publishes a `.md` born stale.** The model reads the flow at
  T0 and renames at T0+11min; an upgrade applied in between means the published prose describes a
  version that no longer exists.

Fixes:

1. **A per-workflow dossier lock** covering the scratch dir and the `.md` publish. It is **not**
   `n8n.js`'s `comEscrita` queue for the *whole write*, and that is a decision: that queue exists
   to serialize *n8n document* writes and its ceiling is `COCKPIT_ESCRITA_TIMEOUT_MS` = 45s. A
   dossier write takes **11 minutes measured**, so holding that queue for the whole session would
   turn every concurrent approve into a 409. Separate lock, separate ceiling.
2. **Per-attempt scratch dir**, not per-flow — the `rm -rf` on entry is only safe if nobody else
   can be inside that directory.
3. **A GLOBAL ledger lock around `anotar()`, separate from the per-workflow one — round 2 caught
   this and it is flatly correct.** `dossies.json` is one file written as
   `read → push → write tmp → rename`, so two *different* flows holding two *different*
   per-workflow locks still lose each other's row. A per-workflow lock cannot serialize a global
   file. **This race exists today**, before anything in this plan.
4. **The publish goes INSIDE `comEscrita`, and round 2 corrected my placement here.** The
   round-1 text said "re-read `updatedAt` before the rename", which leaves the window
   `re-read OK → an apply lands → rename publishes stale`. It is not `escreverAprovado`'s
   discipline, because there the revalidation and the `PUT` share one critical region and here
   the local publish was floating free of the remote mutation. So `re-read updatedAt → abort or
   rename` runs **inside `comEscrita`** — which is safe precisely because it is the *short*
   region: milliseconds inside a queue whose ceiling is 45s, versus the 11-minute session that
   stays outside it. The reason to reject that queue for the write is the reason to use it for
   the publish.
5. Abort is a **ledger row** like any other failed attempt, because the round cost money.
   `construir` already writes failed attempts, for exactly this reason. Worth noting the stale
   publish is *not* silent today — the stored fingerprints come from the raw the session read,
   so the semaphore would immediately show divergence — but publishing something known-stale and
   charging for it is worse than refusing and naming it.

### Step 3 — Declare what incremental cannot prove

The fingerprint proves node X's JSON and its edges did not move. It **cannot** prove the prose
about X is still true after Y changed. Real shape: the paragraph on `Code_montar_payload` says
*"receives the summary from Redis"*; the Redis node is patched to return something else; X's hash
and adjacency are intact and its paragraph is now wrong. A full rewrite re-derives; an
incremental one inherits. This is a real loss and it must be declared, not hidden.

1. The `.md` header states it was built incrementally, how many paragraphs are inherited, and
   from which dates. The file already carries two mandatory labels (written by a model; from the
   flow version of date X) — this is a third of the same kind.
2. `paraPrompt` marks inherited paragraphs that are **one hop** from a rewritten node, using the
   same `⚠` machinery orange already uses but with a **distinct sentence**: adjacent to a change,
   not itself changed. Identical wording for both would erase the difference.
3. The label must not claim the one-hop radius is proof. It is the cheap approximation of
   semantic staleness, and saying otherwise would be the exact class of lie this codebase refuses
   elsewhere.

### Step 4 — The offer goes on the receipt; it is not automatic

`PLAN-UPGRADE.md` §2.8 says nothing regenerates on its own, and §2.3.1 names *invisible spend*
as this tab's risk. That holds. After a successful `aplicar()`, the receipt gains one line naming
how many paragraphs are stale and the price, with the button right there — the receipt is the
highest-consent moment that exists, since he just clicked apply and is looking at the result.

**There are zero measured incremental writes**, so until there are two the button says it does
not know the price — the same discipline as `preco()` returning `amostras: 0` rather than
inventing an ETA. Revisit "automatic" only with data; if incremental lands at US$0.05 the
calculus changes, and that is a decision with a measurement behind it.

### Step 5 — The semaphore on the vitrine card (this is the answer to B)

The original request for B was *"ask the person: was the flow updated in the last days?"*. That
is the wrong mechanism and the plan says so: `estado()` compares fingerprints against the
**live** flow, so an edit made in the n8n editor moves the fingerprint **identically** to one
applied by the cockpit. n8n also returns `updatedAt` per workflow, so the cockpit can even say
*when*. Asking a human to confirm a fact the machine measured is how a wrong "yes" is collected,
and a remembered answer poisoning the base is the exact failure `licoes.js` was built around.

The real gap the question pointed at is different and worth fixing: **the semaphore only fires
when that flow's screen is opened.** So put it on the card in `telaVitrine()`
(`upgrade.html:3236`), which today shows execution count and the cost of talking about the flow
and **nothing about the dossier**. With the lock shipped, a red dot also means *"this flow cannot
be talked to"* — needed **before** clicking in, not after.

- `estado()` is local code: no model, no cost. The expensive part is having the raw workflow to
  fingerprint. **Measured 2026-08-20, against the live instance, before writing this step:**
  `listWorkflows` returns **75** flows in 1.4s; **75 of 75** `getRawWorkflow` succeed in
  **18.3s** cold, 3.1MB of payload total; and fingerprinting all **2228** executable nodes with
  `impressoes()` costs **65ms in total**. So the hash is free and the fetch is the whole cost —
  the same shape and the same order as `GET /api/n8n/callers` (20s for 68). Cache 15 min, fetch
  after the first paint, and **report how many flows failed to read**, because with an incomplete
  read *"nothing rotted"* stops being a claim the panel can make — the same reason `callers`
  reports `falhas`.
- Note the instance has **75** workflows now, not the 62/68 quoted elsewhere in `CLAUDE.md`.
  Nothing in this plan depends on the exact number, but the doc is stale.
- `getRawWorkflow` is the deliberate whitelist hole and is process-local. Fingerprinting stays
  in-process; **only the colour, the motive and the counts may cross to the browser.**

## Key decisions & tradeoffs

1. **Splitting the global fingerprint contradicts a documented, argued decision and forces a
   load-bearing test's assertion to change.** Mitigation: preserve the original argument (a
   connections change invalidates the *map*, i.e. the `visão`) rather than deny it, and rewrite
   the test's assertion with its reasoning instead of loosening it. The decision most worth
   attacking.
2. **The one-hop blast radius is an approximation with no proof behind it.** Marking nothing
   hides real staleness; marking everything erases the distinction orange exists for.
3. **`LIMITE_LARANJA` is reused as the incremental/full threshold.** One constant, two jobs. A
   second constant would be more honest and is one more number nobody calibrates.
4. **Not automatic**, even though the lock makes a red dossier expensive now.
5. **Backward compatibility by keeping the combined `fp` in the header** and comparing it first.
   Costs one redundant hash per read; avoids force-invalidating the two dossiers that exist.
6. **`visão` is rewritten on every incremental write**, which puts a floor under the cost of the
   cheapest possible repair.

## Risks / open questions

- **Incremental has never been measured.** It may not be much cheaper: the session still needs
  enough context to write coherent prose, and the `visão` floor is paid every time. Until two
  writes exist the price is unknown and the screen must say so rather than quote a guess.
- Does a partial round still deserve `MAX_RODADAS = 2`? A refused partial round wastes less, so
  more rounds may be affordable — unmeasured, so unchanged for now.
- ~~Fingerprinting the flows for the vitrine~~ — **measured, answered: 18.3s for 75 of 75, 0
  failures, and 65ms for all 2228 fingerprints.** What remains open is whether 3.1MB of raw
  workflow held in the server process at once is acceptable, or whether it must be fingerprinted
  and discarded flow by flow. The measurement above held them one at a time; the implementation
  must do the same rather than building an array of 75 raw documents.
- If Codex finds a `connections` change that moves no node's adjacency, step 1 is wrong. Steps
  2–5 survive on the unsplit hash, applying to fewer cases.

## Out of scope

- **No write to n8n of any kind.** Nothing here touches `putWorkflow`/`createWorkflow`, the
  battery of seven, or the `[PREENCHER]` gate.
- No change to `paraPrompt`'s `usa: false` contract for grey and red.
- No automatic regeneration, on any trigger.
- No change to the leak gate's rules — only to the document it runs over.
- Not merging the dossier into anything the patch stage reads differently.
- No promotion of lessons, no changes to `licoes.js`.
