# Plan Review Log: dossiê incremental — hash global, regeneração parcial, semáforo na vitrine

Started 2026-08-20, session time ~10:16. MAX_ROUNDS=5.
Reviewer: Codex CLI 0.112.0, read-only sandbox, session resumed across rounds.

Scope in one line: make the dossier's repair proportional to what diverged, and make a rotten
dossier visible without opening 62 screens — without weakening the leak gate or writing to n8n.

## Round 1 — Codex

Thread `01a01f53-e324-74c1-8274-752dfb19a49a`. Verdict: **REVISE**. Five findings, all material.

1. O split de `connections/settings` ainda tem um buraco real: trocar a ordem dos destinos dentro do mesmo ramo (`A.main[0]: [B, C] -> [C, B]`) muda `connectionsFp`, mas não move nenhuma assinatura local porque `adjacencias()` ordena os tuples e apaga essa ordem; com a regra proposta “cor pela fatia normal”, isso pode cair até em verde com `mudados = 0`. Referências: [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L102), [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L140), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L96), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L109). Fix: qualquer `connectionsFp` divergente deve no mínimo forçar laranja/vermelho até a fingerprint incluir a posição no array interno, em vez de assumir que os endpoints bastam.

2. O ramo de compatibilidade do `GLOBAL` velho fica incoerente quando existe herança parcial: o plano diz que `fp` velho divergente é “não sei se foi settings ou connections, então vermelho como hoje”, mas no passo seguinte ainda permite incremental por `mudados ∪ entraram` se não caiu em `settings`/>25%. Referências: [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L105), [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L140). Fix: se o cabeçalho não tiver `settingsFp/connectionsFp` e `fp !== global`, a única migração permitida é rewrite inteiro.

3. O stale set “derivado de `estado()`” está sendo cortado no lugar errado: o código atual trata qualquer `entraram/sairam` como invalidando o mapa inteiro, mas o plano incremental só reescreve `mudados ∪ entraram` e apaga `sairam`, o que herda parágrafos que a regra atual já declarou falsos quando um nó entra ou sai do meio do fluxo. Referências: [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L140), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L166), [CLAUDE.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/CLAUDE.md#L1598). Fix: `entraram.length || sairam.length` tem de ser gatilho de rewrite inteiro, não de herança parcial.

4. A herança de parágrafos ainda pode passar lixo por fora de `validar/vazou`: `validar()` hoje entende o formato de rodada com `## no:`, não o arquivo final com âncoras, então “rodar o leak gate no documento composto” está subespecificado; e se a implementação cair para `vazou(final, rawAtual)`, um literal herdado que já saiu do workflow e não casa PII ampla deixa de ser detectável para sempre. Referências: [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L154), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L226), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L377), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L498). Fix: separar explicitamente “validação estrutural do texto novo” de “scrub do arquivo composto” e proibir herança de dossiê legado sem passar por um scrub dedicado ou rewrite inteiro.

5. A proposta não fecha concorrência: hoje o bloqueio de dossiê é só process-local e só na rota HTTP, `construir()` compartilha a mesma scratch dir por `wfId`, usa o mesmo `...md.tmp`, e nunca revalida `updatedAt` antes do rename final; então duas escritas do mesmo fluxo ou uma escrita correndo junto com `aplicar()` podem publicar um `.md` já nascido velho ou pisar uma na outra. Referências: [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L591), [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L640), [server.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/server.js#L467), [server.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/server.js#L793), [claude-fix.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1452). Fix: introduzir lock por workflow para scratch + `.md` + ledger e abortar a publicação se `updatedAt` mudou entre o fetch inicial e o rename final.

VERDICT: REVISE
### Claude's response — round 1

**All five accepted. Nothing rejected.** Finding 1 was verified in code before accepting, because
it contradicted the plan's own central claim: a 3-node fixture with `A.main[0]` reordered from
`[B, C]` to `[C, B]` gives `global` changed `true` and A, B, C each changed `false`. The round-0
claim that every `connections` change moves some node's adjacency was **false**, and under the
round-0 rule that flow would have read as **green with `mudados = 0`**.

| # | What changed in the plan |
|---|---|
| 1 | `connectionsFp` divergent now carries a **floor of orange** — never green — plus `visaoSuspeita`. The measured counterexample is written into the plan. The more precise alternative (index-in-array inside the adjacency tuple) is **rejected with a reason**: it would move every fingerprint in existence and cost ~US$6.20 to rebuild both dossiers for a case nobody has hit. |
| 2 + 3 | Replaced by **one** rule instead of two mechanisms: **incremental is admitted only from a green or orange dossier.** A divergent legacy `GLOBAL` header is red, so it can only migrate by full rewrite (2). `entraram`/`sairam` is red, so a node entering the middle never inherits (3). |
| 4 | Split into two gates. `validar` keeps parsing the **round format** it actually speaks (`CAB_NO` at `dossie.js:491` — confirmed, it does not read the anchored file) over **new text only**; `vazou(final, rawAtual)` runs over the **composed whole**. Plus Codex's sharper half: a **`gateV` stamp** in the GLOBAL anchor, and **no inheritance from a dossier without it or with an older one** — inheritance was silently trusting a gate version nothing recorded. |
| 5 | New **Step 2b**. Per-workflow lock over scratch + publish + ledger; **per-attempt** scratch dir (the `rm -rf` on entry is only safe if nobody else is inside); `updatedAt` re-read immediately before the rename with an abort that says so. Explicitly **not** `n8n.js`'s `comEscrita`: that queue's ceiling is 45s and a dossier write is 11 minutes measured, so it would turn every concurrent approve into a 409. |

Also folded in, measured against the live instance between rounds and not requested by Codex:
75 workflows (not 62), **18.3s cold for 75 of 75 `getRawWorkflow`, 0 failures**, and **65ms for
all 2228 fingerprints**. Step 5's open question is answered; what remains open is holding 3.1MB
of raw documents at once, so the implementation must fingerprint and discard one at a time.

The two races in Step 2b **exist today, before this plan**. That is the most valuable thing this
round produced.

## Round 2 — Codex

Verdict: **REVISE**. Four findings, all material, two of them supplying a better mechanism than the round-1 revision had.

1. A correção do `connectionsFp` ainda deixa passar texto de nó stale no caso que ela própria usa para justificar o floor laranja. O plano agora garante “nunca verde” em divergência de conexões, mas o Step 2 ainda admite incremental com `mudados = []` e reescreve só a `visão`; num reorder de irmãos no mesmo ramo, isso preserva o parágrafo do nó de origem exatamente onde o contrato do dossiê permite dizer “para quem manda” e, portanto, em que ordem manda. Referências: [PLAN.md:103](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [PLAN.md:176](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [PLAN.md:117](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [dossie.js:424](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js), [dossie.js:104](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js). Fix: em qualquer `connectionsFp` divergente, regenere também os parágrafos dos nós de origem/destino das listas de conexão que mudaram; se não der para identificá-los com prova, faça rewrite inteiro.

2. A regra “admite incremental só de verde ou laranja” ainda tem um furo de procedência: ela olha só a cor, mas o próprio plano passa a admitir que há parágrafos herdados semanticamente suspeitos fora do semáforo normal (`incremental`, herdados, um-hop de mudança). Um dossiê pode voltar a verde por fingerprint e ainda carregar texto herdado que o Step 3 manda tratar com ressalva; pela regra atual, ele vira base de nova herança do mesmo jeito. Referências: [PLAN.md:157](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [PLAN.md:251](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [PLAN.md:255](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md). Fix: a admissão precisa checar procedência, não só cor; por exemplo, recusar herdar de um dossiê que ainda tenha parágrafos herdados marcados como adjacentes a mudança, ou impor limite de uma geração antes de rewrite inteiro.

3. O lock novo continua mal colocado para o ledger compartilhado: um lock por workflow não serializa `dossies.json`, que é um único arquivo global e hoje é escrito por `read -> push -> write tmp -> rename`. Dois fluxos diferentes podem segurar locks diferentes e mesmo assim perder linha um do outro no append. Referências: [PLAN.md:228](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [dossie.js:567](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js), [dossie.js:572](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js). Fix: além do lock por workflow, serialize `anotar()` com um lock global do ledger ou troque o ledger para um formato de append que não faça read-modify-write do arquivo inteiro.

4. O `updatedAt` relido antes do rename ainda não fecha a corrida com `aplicar()`: sem uma coordenação compartilhada entre “último re-read do workflow” e “write real no n8n”, ainda existe a janela `re-read OK -> apply entra -> rename publica .md stale`. Isso não é a mesma disciplina de `escreverAprovado`, porque lá a revalidação e o `PUT` vivem na mesma região crítica da escrita; aqui o publish local continua solto em relação à mutação remota. Referências: [PLAN.md:235](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [PLAN.md:228](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md), [claude-fix.js:1446](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js), [claude-fix.js:1455](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js). Fix: introduza um lock/epoch por workflow compartilhado entre o publish final do dossiê e qualquer caminho que escreve o workflow, e faça o `re-read updatedAt -> rename` dentro dessa região curta.

VERDICT: REVISE
### Claude's response — round 2

**All four accepted. Nothing rejected. Two of them replaced my mechanism rather than patching it.**

| # | What changed in the plan |
|---|---|
| 1 | The orange floor was **insufficient and Codex named exactly why**: it flagged the `visão`, but on a sibling reorder the paragraph that goes stale is the **source node's** — and with `mudados = []` it was inherited intact. So `connectionsFp` (one hash) becomes **`conexoesPorNo` (a per-source-key map, array order preserved)**. Now the reorder is *localizable*, the source lands in `mudados` **by the normal path**, and no special case exists anywhere. The floor stays only because the visão is genuinely suspect. Added the fail-closed branch: aggregate diverges but no per-key diff explains it → **red**, which is his *"if you cannot identify them with proof, full rewrite"* taken literally. |
| 2 | **Colour-only admission was a hole.** A dossier can return to green by fingerprint while carrying paragraphs step 3 flagged as suspect, and then become the base of the next inheritance — drift compounding across generations with the screen green the whole way. Two bounds on the `de` slot that already exists: the one-hop flag **does not stack** (already-flagged and flagged again → regenerated, because re-flagging is how a caveat becomes furniture), and a per-paragraph **generation counter `g`**, not inheritable at `g >= MAX_GERACOES`. `MAX_GERACOES = 3` is **labelled an uncalibrated guess**, to be turned once `dossies.json` has incremental history. |
| 3 | **Flatly correct and I had it wrong.** `dossies.json` is one global file written `read → push → write tmp → rename`; two different flows holding two different per-workflow locks still lose each other's row. Added a **global ledger lock around `anotar()`**, separate from the per-workflow one. This race exists today. |
| 4 | **Better placement than mine.** "Re-read `updatedAt` before the rename" left the window `re-read OK → apply lands → rename publishes stale`, and he is right that it was not `escreverAprovado`'s discipline — there revalidation and the `PUT` share one critical region. The publish now runs **inside `comEscrita`**, which is safe *because it is the short region*: milliseconds inside a 45s-ceiling queue, versus the 11-minute session that stays outside. **The reason to reject that queue for the write is the reason to use it for the publish** — I had drawn the boundary in the wrong place. |

Round 2 produced one more pre-existing defect (finding 3) on top of round 1's two. Three races
in `dossie.js` that predate this plan, all found by review rather than by use.

## Round 3 — Codex

Verdict: **APPROVED**. Converged in 3 rounds.

Nenhum problema material novo no plano revisado.

O ponto mais arriscado da rodada anterior, a granularidade de `connections`, ficou fechado de forma defensável. `conexoesPorNo` por chave de origem resolve o caso real de reorder entre irmãos sem mexer nos fingerprints antigos, e o ramo “aggregate diverges but no per-key diff explains it → red” falha fechado em vez de deixar um verde mentiroso. Isso é compatível com o contrato atual do dossiê em [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L424) e com o fato de a assinatura local existente já continuar cobrindo `entra/sai` por destino em [dossie.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L96). Eu não achei um furo de granularidade comparável ao reorder de irmãos na versão nova do [PLAN.md](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md).

A contenção por gerações também ficou “sound enough”. `g` não prova verdade semântica, mas ele não existe para isso; ele existe para impedir herança infinita silenciosa. Com “one-hop não empilha” e `g >= MAX_GERACOES` forçando rewrite, a herança converge no sentido que importa aqui: nenhum parágrafo sobrevive intacto por gerações ilimitadas só porque o semáforo voltou a verde. O número `3` continua um chute, mas o próprio plano o rotula como não calibrado, e errar aí custa overspend, não falso verde permanente.

A parte de concorrência também está aceitável agora, desde que a implementação preserve a ordem implícita do plano: lock do workflow para a sessão do dossiê, `comEscrita` só na janela curta `re-read updatedAt -> rename`, e lock global só dentro de `anotar()`. Nessa direção eu não vejo ciclo com `escreverAprovado()` em [claude-fix.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1433) nem com a fila reentrante em [n8n.js](C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/n8n.js#L1207). O risco residual aqui é de implementação/teste, não de desenho: eu acrescentaria testes explícitos para a ordem dos locks e para o timeout de espera no publish curto, mas isso não muda meu veredito sobre o plano.

VERDICT: APPROVED
### Claude's response — round 3

Nothing to revise. One implementation note taken forward, not a plan change: Codex asks for
**explicit tests for the lock ORDER and for the wait timeout on the short publish**. That is
added to the build brief, because it is the same class of test `mutex-test.js` already carries —
it races a clock so the mutant that removes reentrancy comes back red instead of hanging forever.

Final state: nine findings over three rounds, **all nine accepted, none rejected**. Two of them
replaced a mechanism rather than patching one (`conexoesPorNo` per key; the publish inside
`comEscrita`). **Three of them are races that exist in `dossie.js` today**, independent of this
plan: the shared scratch dir with `rm -rf` on entry, the shared `.md.tmp`, and the global
`dossies.json` read-modify-write. None had ever been hit; none would have been found by using
the feature.

The claim the review killed: *"every `connections` change moves at least one node's adjacency
signature."* Verified false in code before accepting — sibling reorder inside one branch moves
the global hash and zero node fingerprints. Under the round-0 rule that flow would have read
green with `mudados = 0`.

## Round 4 — the session died, and the reason is worth writing down

The attempt to adjudicate Step 1's one deviation on the **same** thread failed twice with
`exit=1` and an empty verdict file. Cause, from stderr:

```
compaction_request_model_visible_bytes=971348
compact_error=unexpected status 404 Not Found: .../backend-api/codex/responses/compact
ERROR: Failed to run pre-sampling compact
Warning: no last agent message; wrote empty content to codex-verdict.txt
```

**Codex CLI 0.112.0 cannot compact a long session** — the remote compact endpoint 404s on this
version — so a thread that grows past the model's visible-byte budget stops being resumable. Three
rounds of a plan review plus a repo read reached ~971KB. The `codex-review` skill's own
prerequisite (CLI ≥ 0.130) is the real fix; until then, **a review loop on this machine has a
finite thread and the fourth round is roughly where it ends.**

Note the failure mode: `exit=1`, and `-o` **overwrites the verdict file with empty content**, so
the previous round's verdict is destroyed rather than preserved. Round 4 onward writes to
`codex-verdict-r<n>.txt` instead.

Adjudication continues in a **fresh session**, which loses rounds 1–3 as context. Acceptable here
because the question is self-contained and the plan plus this log are on disk — and a fresh critic
is arguably the better judge of whether a deviation from the plan is sound.

## Round 4 (fresh session) — adjudicating Step 1's deviation

Verdict: **REVISE**. The deviation does not stand as implemented.

1. Sim, o gap residual é real. O contraexemplo mais limpo é uma mudança só em `connections` que adiciona ou remove um ramo vazio sem mexer em nenhuma aresta real, por exemplo `A.main: [[{node:"B", index:0, type:"main"}]] -> [[{node:"B", index:0, type:"main"}], []]`. O `global` muda porque ainda é calculado sobre `canon(wf.connections)` bruto em [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L194), mas `conexoesPorNo` não muda porque `adjacencias()` só emite tupla para conexões com `c.node`, então ramo vazio colapsa para nada em [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L169) e [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L209). `cxSemDono` também não muda porque a chave continua pertencendo a um nó descrito e existente em [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L290). No caminho de cabeçalho novo, esse `globalMudou` é só reportado e não decide nada em [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L316) e [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L376). O próprio teste fixa esse comportamento para vazios em [dossie-test.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie-test.js#L389). Então há, sim, mudança em `connections` que hoje passa verde.

2. Sim, isso é melhor. O problema que ele mediu não derruba o ramo fail-closed do plano; derruba só o agregado atual, porque ele foi definido num espaço semântico mais amplo do que o localizador por chave. O conserto correto é normalizar o agregado com a mesma semântica que `conexoesPorNo` usa: colapsar chave ausente, `{}`, `{main: []}` e ramo vazio se essa é a política desejada, mas preservar ordem real de arestas e extras por aresta. Aí o ramo exigido no plano em [PLAN.md](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/docs/codex-review/dossie-incremental-20260820-1016/PLAN.md#L118) volta a ter valor: ele só dispara quando houver divergência impossível de localizar, em vez de disparar por ruído já conhecido. Remover o ramo inteiro foi overcorrection. O sinal mais claro disso é que, no cabeçalho novo, `fp` virou praticamente write-only: é gravado em [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L479) e o teste já aceita que ele não decide nada em [dossie-test.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie-test.js#L475). Isso enfraquece justamente a rede que o Step 1 tinha aprovado para evitar falso verde silencioso.

3. O guard de `!visaoSuspeita` é de fato morto hoje, e o próprio comentário admite isso em [dossie.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/dossie.js#L392). Eu não bloquearia por ele. Neste código, numa função-semáforo que decide falso verde versus travar aba, uma redundância barata e documentada é aceitável como cinto de segurança. O que não é aceitável é usar essa redundância como argumento para relaxar a rede mais forte. Em outras palavras: guardar um net morto aqui é ok; trocar um fail-closed aprovado por “confio que o localizador cobre tudo” não é.

VERDICT: REVISE
### Claude's response — round 4

**Upheld against the implementer, and against my own earlier instinct to accept his measurement
at face value.** The counterexample is clean and I had not found it:

```
A.main: [[{node:"B"}]]  →  [[{node:"B"}], []]
```

Adding an **empty branch** moves `global` (computed over raw `canon(connections)`), moves **no**
`conexoesPorNo` key (`adjacencias()` only emits a tuple when `c.node` exists), and does not touch
`cxSemDono` (the key still belongs to a described, existing node). It reads **green** today, and
`dossie-test.js:389` pins that.

The load-bearing half of the judgement is not the counterexample though — it is *"removing the
branch entirely was overcorrection"*. What the implementer measured (11 empty connection sources
across the two real flows) invalidates **the aggregate as currently computed**, not the plan's
fail-closed branch: the aggregate lives in a wider semantic space than the per-key localizer, so
it diverges on noise the localizer deliberately ignores. Normalize the aggregate to the localizer's
semantics and the branch fires only on genuinely unlocalizable divergence. The tell that something
was lost: in a new header `fp` became **write-only**, and a test now asserts it decides nothing —
which is precisely the net Step 1 had been approved with.

**Two independent halves in the fix, and the second is a policy the implementer must state rather
than assume:**

1. Restore the fail-closed branch, over a **normalized** aggregate — collapsing absent keys, `{}`,
   `{main: []}` and empty branches, while preserving real edge order and per-edge extras.
2. **Decide, out loud, whether a CHANGE to an empty branch means anything.** His measurement showed
   empties *exist* and are common; it did not show that adding or removing one is meaningless. If
   the policy is that an unwired branch instructs nothing — the same reasoning that made an
   inapplicable `"options": {}` inconsequential for the schema gate — then green is correct **by
   declared policy** rather than by accident, and that is the difference that matters.

The legacy `global` computation must stay **byte-identical**: `dossie-test.js` pins
`6126ecf1ce3d81f1` plus the five per-node hashes, and that pin is what keeps the two existing
US$6.20 dossiers valid. So the normalized aggregate is a **new** stored field, not a redefinition
of the old one.

**Mutant 4: Codex ruled against me and I accept it.** In a semaphore function deciding false-green
versus locking the tab, a cheap documented redundancy is an acceptable belt. The dead
`!visaoSuspeita` guard **stays**. What is refused is using that redundancy as the argument for
relaxing the stronger net — which is exactly how it was used.

**Not dispatched immediately, and the reason is file contention**: the Step 2/2b/3 agent is inside
`dossie.js` right now. Two concurrent editors of one file clobber each other, so this revision is
queued behind it rather than racing it.
