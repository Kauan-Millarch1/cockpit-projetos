// claude-fix.js — the cockpit stops observing and starts proposing.
//
// WHAT THIS IS. "Mandar pro Claude" used to end at the clipboard. It now spawns
// the local Claude Code CLI headless, hands it the failing workflow, and loops
// it against deterministic gates until the proposal passes. The result is a
// PROPOSAL — a patched workflow JSON plus a redacted diff. Nothing reaches the
// n8n instance until Kauan clicks approve on that diff.
//
// THE BOUNDARY MOVED IN EXACTLY ONE PLACE. `n8n.js` gained a write path; it is
// reachable only from `approve()` / `revert()` below, both of which require a
// proposal whose diff was already rendered in the browser. Every other path
// stays read-only. Automatic application is not a feature that got deferred —
// it is a feature that is deliberately absent.
//
// FACTS ONLY still holds for what leaves this file: the gate list, the diff and
// the log are facts. Whether a proposal is "good" is Kauan's call, made on the
// review screen in flows.html.
//
// SECURITY. Claude runs with cwd pinned to a per-run scratch dir, tool access
// limited to Read/Write/Edit/Glob/Grep (no Bash, no network, no n8n key) and
// MCP disabled. It never sees the API key: this process does every n8n call.
// The raw workflow written into that dir DOES carry credential ids and node
// parameters — that is why `redactWorkflow()` runs before anything crosses back
// to the browser, and why the credential blocks are a hard gate: a proposal
// that touches them is rejected, not shown.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const n8n = require("./n8n");

/* ------------------------------------------------------------------ config */

const RUNS_DIR = path.join(__dirname, ".claude-runs");
// Fora do cwd do Claude de propósito. O backup é o único arquivo do fluxo que
// ainda carrega credenciais, e ele não precisa estar ao alcance da sessão.
const PRIVATE_DIR = path.join(RUNS_DIR, "_private");
const STORE_FILE = path.join(__dirname, "proposals.json");

const MAX_ROUNDS = 4;                    // how many times Claude gets the gates back
const ROUND_TIMEOUT_MS = 8 * 60 * 1000;  // per invocation
const LOG_CAP = 900;                     // log lines kept per run
const STORE_CAP = 60;                    // proposals kept on disk
const RUNS_IN_MEMORY = 20;               // runs still consultable in this process
const REPORT_CAP = 8000;

// Sandbox test = a real PUT into a clearly named inactive copy in the instance.
// It is the only gate that proves n8n itself accepts the JSON, and it is also a
// write to n8n before Kauan approved anything — so it is OFF unless he turns it
// on. With it off the panel says so instead of implying the proposal was tried.
const SANDBOX_TEST = /^(1|true|yes)$/i.test(String(process.env.COCKPIT_SANDBOX_TEST || readEnv("COCKPIT_SANDBOX_TEST") || ""));

function readEnv(name) {
  for (const f of [".env", ".env.local"]) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(new RegExp("^\\s*" + name + "\\s*=\\s*(.*)$", "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function findClaude() {
  const explicit = process.env.CLAUDE_BIN || readEnv("CLAUDE_BIN");
  const candidates = [
    explicit,
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "claude", "claude.exe")
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ } }
  return process.platform === "win32" ? "claude.exe" : "claude";   // hope it is on PATH
}

const CLAUDE_BIN = findClaude();
const claudeFound = fs.existsSync(CLAUDE_BIN);
const configured = n8n.configured;

/* ---------------------------------------------------------------- scrubbing */

// Anything shaped like a secret is replaced before it can reach a log line, the
// store or the browser. Claude reads the raw workflow, so its own prose is a
// path a credential could take out of this process.
const SECRET_RE = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g,  // JWT
  /\bsk-[A-Za-z0-9_-]{16,}/g,                                        // OpenAI-style
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,                                 // Slack
  /\bghp_[A-Za-z0-9]{20,}/g,                                         // GitHub
  /\bAIza[A-Za-z0-9_-]{20,}/g                                        // Google
];
function scrub(s) {
  let out = String(s == null ? "" : s);
  for (const re of SECRET_RE) out = out.replace(re, "«segredo removido»");
  return out;
}

const CRED_KEY = /^(credentials|credential)$/i;

// Deep copy with every `credentials` block replaced by a stable placeholder.
// The ids are not shown because they are not the user's decision surface — the
// gate below already refuses any proposal that changes them.
function redactWorkflow(w) {
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = CRED_KEY.test(k) ? "«credencial oculta»" : walk(val);
      return o;
    }
    if (typeof v === "string") return scrub(v);
    return v;
  };
  return walk(w);
}

/* ------------------------------------------------------------------- gates */

const nodeMap = w => new Map((w.nodes || []).map(n => [String(n.name), n]));
const stable = v => JSON.stringify(v ?? null);

// Every gate is a fact about the two JSON documents — no heuristics, no model
// in the loop. Claude gets this list verbatim in RULES.md, so it is being
// judged against something it can read, and the retry prompt is the gate output
// itself rather than a paraphrase of it.
function validate(orig, prop) {
  const gates = [];
  const add = (id, label, ok, detail) => gates.push({ id, label, ok: !!ok, detail: detail || null });

  if (!prop || typeof prop !== "object" || Array.isArray(prop)) {
    add("json", "a proposta montada é um objeto JSON", false, "não é um objeto");
    return { ok: false, gates };
  }
  const nodesOk = Array.isArray(prop.nodes);
  const connOk = prop.connections && typeof prop.connections === "object" && !Array.isArray(prop.connections);
  add("json", "a proposta montada tem nodes[] e connections{}", nodesOk && connOk,
    nodesOk ? (connOk ? null : "connections ausente ou não é objeto") : "nodes ausente ou não é array");
  if (!nodesOk || !connOk) return { ok: false, gates };

  const A = nodeMap(orig), B = nodeMap(prop);

  // Nunca apagar nó — regra do Kauan para qualquer fluxo vivo. Desconectar é
  // permitido, remover não.
  const removed = [...A.keys()].filter(n => !B.has(n));
  add("nodes-kept", "nenhum nó removido", removed.length === 0,
    removed.length ? "removidos: " + removed.join(", ") : null);

  const retyped = [...B.keys()].filter(n => A.has(n) && String(A.get(n).type) !== String(B.get(n).type));
  add("types-kept", "nenhum nó existente trocou de tipo", retyped.length === 0,
    retyped.length ? "trocaram de tipo: " + retyped.join(", ") : null);

  const credTouched = [...B.keys()].filter(n => A.has(n) && stable(A.get(n).credentials) !== stable(B.get(n).credentials));
  add("credentials-untouched", "nenhuma credencial alterada", credTouched.length === 0,
    credTouched.length ? "credencial mexida em: " + credTouched.join(", ") : null);

  const names = (prop.nodes || []).map(n => String(n.name));
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  add("names-unique", "nomes de nó únicos", dupes.length === 0,
    dupes.length ? "duplicados: " + [...new Set(dupes)].join(", ") : null);

  const dangling = [];
  for (const [from, outs] of Object.entries(prop.connections || {})) {
    if (!B.has(from)) { dangling.push(from + " (origem inexistente)"); continue; }
    for (const branches of Object.values(outs || {})) {
      for (const branch of branches || []) {
        for (const c of branch || []) {
          const to = String(c && c.node);
          if (!B.has(to)) dangling.push(from + " → " + to + " (destino inexistente)");
        }
      }
    }
  }
  add("connections-valid", "toda conexão aponta para nó existente", dangling.length === 0,
    dangling.length ? dangling.slice(0, 6).join("; ") : null);

  const shapeBad = (prop.nodes || []).filter(n =>
    !n || typeof n !== "object" || !n.name || !n.type || !Array.isArray(n.position) || n.position.length !== 2);
  add("nodes-shaped", "todo nó tem name, type e position [x,y]", shapeBad.length === 0,
    shapeBad.length ? shapeBad.length + " nó(s) malformado(s)" : null);

  // `detail` só quando reprova: uma porta verde com explicação ao lado lê como
  // ressalva, e a linha "✓ não tenta ativar — active mudaria para true" dizia
  // exatamente o contrário do veredito.
  const activeOk = prop.active === undefined || !!prop.active === !!orig.active;
  add("active-untouched", "não tenta ativar/desativar o fluxo", activeOk,
    activeOk ? null : "active mudaria para " + !!prop.active);

  // Um token literal colado num parâmetro é o defeito que o superflow já achou
  // nesta instância. Não passa como "correção".
  const literal = [];
  for (const [name, n] of B) {
    const before = A.has(name) ? stable(A.get(name).parameters) : "";
    const after = stable(n.parameters);
    if (before === after) continue;
    for (const re of SECRET_RE) { re.lastIndex = 0; if (re.test(after)) { literal.push(name); break; } }
  }
  add("no-secret-literals", "nenhum segredo literal em parâmetro alterado", literal.length === 0,
    literal.length ? "parece haver token literal em: " + literal.join(", ") : null);

  const changed = stable(orig.nodes) !== stable(prop.nodes) || stable(orig.connections) !== stable(prop.connections);
  add("changed", "a proposta muda alguma coisa", changed, changed ? null : "proposal.json é idêntico ao workflow atual");

  return { ok: gates.every(g => g.ok), gates };
}

/* ------------------------------------------------------------------- patch */

// Claude NÃO reescreve o workflow. Ele escreve um patch com três verbos —
// atualizar nó, adicionar nó, refazer as saídas de um nó — e o cockpit aplica.
//
// Duas razões, e as duas importam:
//   1. Escala. Um fluxo daqui tem 188 nós e o JSON passa de meio mega. Pedir o
//      documento inteiro de volta gasta contexto que deveria ir para o
//      diagnóstico, e a chance de corromper algo longe do defeito é alta.
//   2. Não existe verbo de apagar. "Nunca apagar nó" deixa de ser uma porta que
//      pode reprovar e passa a ser algo que o formato não sabe expressar.
const ALLOWED_NODE_KEYS = new Set([
  "parameters", "typeVersion", "position", "disabled", "notes", "notesInFlow",
  "alwaysOutputData", "executeOnce", "retryOnFail", "maxTries", "waitBetweenTries", "onError"
]);

function applyPatch(orig, patch) {
  const errors = [];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { workflow: null, errors: ["patch.json não é um objeto JSON"] };
  }

  const out = JSON.parse(JSON.stringify(orig));
  out.nodes = out.nodes || [];
  out.connections = out.connections || {};
  const byName = new Map(out.nodes.map(n => [String(n.name), n]));

  for (const u of patch.updateNodes || []) {
    if (!u || !u.name) { errors.push("updateNodes: entrada sem `name`"); continue; }
    const n = byName.get(String(u.name));
    if (!n) { errors.push('updateNodes: o nó "' + u.name + '" não existe — os nomes exatos estão em nodes-index.md'); continue; }
    for (const [k, v] of Object.entries(u)) {
      if (k === "name") continue;
      if (CRED_KEY.test(k)) { errors.push('updateNodes: "' + u.name + '" tenta mexer em credentials, o que é proibido'); continue; }
      if (!ALLOWED_NODE_KEYS.has(k)) { errors.push('updateNodes: o campo "' + k + '" não pode ser alterado (permitidos: ' + [...ALLOWED_NODE_KEYS].join(", ") + ")"); continue; }
      n[k] = v;
    }
  }

  for (const a of patch.addNodes || []) {
    if (!a || !a.name) { errors.push("addNodes: entrada sem `name`"); continue; }
    if (byName.has(String(a.name))) { errors.push('addNodes: já existe um nó chamado "' + a.name + '"'); continue; }
    if (a.credentials) { errors.push('addNodes: "' + a.name + '" traz credentials — nó novo que precise de credencial tem que ser configurado por humano no n8n'); continue; }
    if (!a.type || !Array.isArray(a.position) || a.position.length !== 2) {
      errors.push('addNodes: "' + a.name + '" precisa de `type` e `position: [x, y]`'); continue;
    }
    const node = {
      name: String(a.name), type: String(a.type),
      typeVersion: a.typeVersion == null ? 1 : a.typeVersion,
      position: a.position, parameters: a.parameters || {}
    };
    if (a.disabled) node.disabled = true;
    if (a.onError) node.onError = a.onError;
    out.nodes.push(node);
    byName.set(node.name, node);
  }

  // rewire substitui as saídas INTEIRAS do nó citado. É o único jeito honesto:
  // um merge parcial de conexões deixa aresta órfã que ninguém pediu.
  for (const [from, outs] of Object.entries(patch.rewire || {})) {
    if (!byName.has(from)) { errors.push('rewire: o nó de origem "' + from + '" não existe'); continue; }
    if (!outs || typeof outs !== "object") { errors.push('rewire: as saídas de "' + from + '" precisam ser um objeto tipo {"main": [[...]]}'); continue; }
    out.connections[from] = outs;
  }

  const touched = (patch.updateNodes || []).length + (patch.addNodes || []).length + Object.keys(patch.rewire || {}).length;
  if (!touched) errors.push("patch.json não muda nada — updateNodes, addNodes e rewire estão todos vazios");

  return { workflow: out, errors };
}

/* -------------------------------------------------------------------- diff */

// LCS de linhas. Pequeno de propósito: o diff é por nó, então cada comparação
// é de dezenas de linhas, não de milhares.
function lineDiff(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: " ", s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", s: a[i] }); i++; }
    else { out.push({ t: "+", s: b[j] }); j++; }
  }
  while (i < m) out.push({ t: "-", s: a[i++] });
  while (j < n) out.push({ t: "+", s: b[j++] });
  return out;
}

// Colapsa blocos longos de contexto — um nó de agente tem um prompt de 15k
// caracteres e mostrar tudo enterra a única linha que mudou.
function collapse(lines, ctx = 3) {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.t === " ") return;
    for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ t: "~", s: skipped + " linha(s) sem mudança" }); skipped = 0; }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ t: "~", s: skipped + " linha(s) sem mudança" });
  return out;
}

// TUDO do nó menos identidade e credencial. A primeira versão listava só
// `type/typeVersion/disabled/position/parameters`, e a primeira correção real
// que o Claude propôs mexia em `retryOnFail`, `maxTries`, `waitBetweenTries` e
// `notes` — o diff saiu vazio para um patch que mudava o comportamento do nó.
// Um diff que não mostra a mudança é pior que diff nenhum: ele afirma que não
// há nada para revisar bem no momento em que o Kauan vai clicar em aprovar.
// Por isso a lista agora é de exclusão, não de inclusão — campo novo do n8n
// aparece sozinho em vez de sumir em silêncio.
const NODE_DIFF_SKIP = new Set(["id", "webhookId", "name", "credentials"]);
const nodeText = n => {
  const o = {};
  for (const k of Object.keys(n).sort()) if (!NODE_DIFF_SKIP.has(k)) o[k] = n[k];
  return JSON.stringify(o, null, 2).split("\n");
};

// Diff já redigido: os dois lados passam por redactWorkflow antes de virar
// texto, então nenhuma credencial existe neste objeto para vazar na tela.
function diffWorkflow(origRaw, propRaw) {
  const orig = redactWorkflow(origRaw), prop = redactWorkflow(propRaw);
  const A = nodeMap(orig), B = nodeMap(prop);

  const nodes = [];
  for (const [name, b] of B) {
    const a = A.get(name);
    if (!a) {
      nodes.push({ name, type: String(b.type || ""), kind: "added", lines: nodeText(b).map(s => ({ t: "+", s })) });
      continue;
    }
    const la = nodeText(a), lb = nodeText(b);
    if (la.join("\n") === lb.join("\n")) continue;
    nodes.push({ name, type: String(b.type || ""), kind: "modified", lines: collapse(lineDiff(la, lb)) });
  }
  for (const [name, a] of A) {
    // Não deveria acontecer (o gate barra), mas se acontecer tem que aparecer.
    if (!B.has(name)) nodes.push({ name, type: String(a.type || ""), kind: "removed", lines: nodeText(a).map(s => ({ t: "-", s })) });
  }

  const edgeSet = w => {
    const s = new Set();
    for (const [from, outs] of Object.entries(w.connections || {})) {
      for (const [port, branches] of Object.entries(outs || {})) {
        (branches || []).forEach((branch, bi) => (branch || []).forEach(c => s.add(from + " —" + port + (bi ? "#" + bi : "") + "→ " + (c && c.node))));
      }
    }
    return s;
  };
  const ea = edgeSet(orig), eb = edgeSet(prop);
  const connections = {
    added: [...eb].filter(e => !ea.has(e)),
    removed: [...ea].filter(e => !eb.has(e))
  };

  return {
    nodes,
    connections,
    summary: {
      added: nodes.filter(n => n.kind === "added").length,
      modified: nodes.filter(n => n.kind === "modified").length,
      removed: nodes.filter(n => n.kind === "removed").length,
      edgesAdded: connections.added.length,
      edgesRemoved: connections.removed.length
    }
  };
}

/* ------------------------------------------------------------------- store */

// proposals.json guarda o que aconteceu — assinatura, veredito das portas,
// resumo do diff, se foi aplicado e quando. NÃO guarda o workflow inteiro: isso
// vive em .claude-runs/<id>/ (descartável, gitignored), porque o backup bruto
// carrega credenciais e não tem por que entrar no git.
async function readStore() {
  try {
    const raw = JSON.parse(await fsp.readFile(STORE_FILE, "utf8"));
    return Array.isArray(raw.proposals) ? raw.proposals : [];
  } catch { return []; }
}
async function writeStore(list) {
  const trimmed = list.slice(-STORE_CAP);
  const tmp = STORE_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), proposals: trimmed }, null, 2), "utf8");
  await fsp.rename(tmp, STORE_FILE);
}
async function upsertStore(entry) {
  const list = await readStore();
  const i = list.findIndex(p => p.runId === entry.runId);
  if (i >= 0) list[i] = entry; else list.push(entry);
  await writeStore(list);
}

/* -------------------------------------------------------------------- runs */

const runs = new Map();          // runId -> run object (in memory, with the log)
const bus = new EventEmitter();
bus.setMaxListeners(0);

let seq = 0;
const newRunId = () => "r" + Date.now().toString(36) + (++seq).toString(36);

function emit(run, ev) {
  const payload = { ...ev, runId: run.id, at: new Date().toISOString() };
  if (ev.t === "log") {
    run.log.push(payload);
    if (run.log.length > LOG_CAP) run.log.splice(0, run.log.length - LOG_CAP);
  }
  bus.emit("ev", payload);
  bus.emit(run.id, payload);
}
const say = (run, text, level) => emit(run, { t: "log", level: level || null, text: scrub(text) });

// O que sai para o browser. Sem workflow bruto, sem chave, sem credencial.
function snapshot(run) {
  return {
    runId: run.id,
    key: run.key,
    wfId: run.wfId,
    wfName: run.wfName,
    status: run.status,
    stage: run.stage,
    // Quando a corrida trocou de fluxo, a tela PRECISA dizer: o cartão que ele
    // clicou é de um fluxo e o diff é de outro.
    redirected: run.redirected,
    round: run.round,
    maxRounds: MAX_ROUNDS,
    // O que está acontecendo agora e o que já foi feito — a tela mostra isso
    // grande, fora do log. `eta` é medido do próprio ledger; `samples: 0`
    // significa que ainda não dá para estimar, e a tela diz isso em vez de
    // desenhar uma barra que não corresponde a nada.
    activity: run.activity || null,
    tools: run.tools || {},
    eta: run.eta || { medianMs: null, p80Ms: null, samples: 0 },
    gates: run.gates,
    diff: run.diff,
    report: run.report,
    // A frase que a tela grava no quadro de erros ao aplicar. Vai no snapshot
    // para que o que é registrado seja exatamente o que esteve na tela.
    fixNote: fixNote(run),
    sandbox: run.sandbox,
    sandboxEnabled: SANDBOX_TEST,
    error: run.error,
    cost: run.cost,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    appliedAt: run.appliedAt,
    revertedAt: run.revertedAt,
    capturedUpdatedAt: run.capturedUpdatedAt,
    log: run.log
  };
}

/* ------------------------------------------------------------ claude driver */

function runClaude(run, { prompt, resume }) {
  return new Promise((resolve) => {
    const args = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read,Write,Edit,Glob,Grep",
      // `--allowedTools` só auto-aprova; NÃO restringe. Medido em 2026-08-07:
      // com exatamente a lista acima, a sessão executou shell. A afirmação
      // "No Bash, no network" deste arquivo só passou a ser verdade com a linha
      // abaixo, verificada respondendo SEM_SHELL no mesmo prompt.
      "--disallowedTools", "Bash,PowerShell,BashOutput,KillShell,Task,Agent,NotebookEdit,SlashCommand,WebFetch,WebSearch",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      // Sem a config global do usuário. Medido em iso-check.js: sem isto a
      // sessão carrega o CLAUDE.md global, que nesta máquina tem a chave da API
      // do n8n em texto puro — uma credencial que esta sessão não tem motivo
      // nenhum para segurar. Também derruba os hooks globais, que aqui só
      // faziam a sessão imprimir coisa que o cockpit não pediu.
      "--setting-sources", ""
    ];
    if (resume) args.push("--resume", resume);
    if (process.env.COCKPIT_CLAUDE_MODEL || readEnv("COCKPIT_CLAUDE_MODEL")) {
      args.push("--model", process.env.COCKPIT_CLAUDE_MODEL || readEnv("COCKPIT_CLAUDE_MODEL"));
    }

    const child = spawn(CLAUDE_BIN, args, {
      cwd: run.dir,
      windowsHide: true,
      // stdin fechado. Com um pipe aberto e vazio o CLI espera 3s por dados em
      // TODA rodada e depois escreve um aviso no stderr, que subia para o log
      // como se algo tivesse dado errado. O prompt vai por `-p`; não há stdin.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, N8N_API_KEY: "", CLAUDE_CODE_ENTRYPOINT: "cockpit" }
    });
    run.child = child;

    let buf = "";
    let sessionId = resume || null;
    let hadError = null;

    const timer = setTimeout(() => {
      hadError = "tempo esgotado (" + Math.round(ROUND_TIMEOUT_MS / 60000) + "min) nesta rodada";
      try { child.kill(); } catch { /* já morreu */ }
    }, ROUND_TIMEOUT_MS);

    child.stdout.on("data", chunk => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        handleEvent(run, ev, id => { sessionId = id; });
      }
    });

    child.stderr.on("data", d => {
      const s = d.toString("utf8").trim();
      if (s) say(run, "stderr: " + s.slice(0, 300), "warn");
    });

    child.on("error", err => {
      clearTimeout(timer);
      run.child = null;
      resolve({ ok: false, sessionId, error: "não consegui executar o Claude CLI: " + err.message });
    });

    child.on("close", code => {
      clearTimeout(timer);
      run.child = null;
      // stdout pode terminar sem \n final
      if (buf.trim()) { try { handleEvent(run, JSON.parse(buf.trim()), id => { sessionId = id; }); } catch { /* linha parcial */ } }
      if (hadError) return resolve({ ok: false, sessionId, error: hadError });
      resolve({ ok: code === 0, sessionId, error: code === 0 ? null : "Claude CLI saiu com código " + code });
    });
  });
}

const TOOL_HINT = {
  Read: i => "lendo " + short(i && i.file_path),
  Write: i => "escrevendo " + short(i && i.file_path),
  Edit: i => "editando " + short(i && i.file_path),
  Glob: i => "procurando " + (i && i.pattern),
  Grep: i => "buscando /" + (i && i.pattern) + "/"
};
const short = p => (p ? String(p).split(/[\\/]/).pop() : "?");

/* O que o Claude está fazendo AGORA, separado do log corrido.
 *
 * O terminal já mostrava tudo — e era justamente o problema: com 40 linhas
 * rolando, "por onde ele está passando" some no meio do texto. Isto é um único
 * fato por vez, sobrescrito, que a tela pode exibir grande: a ferramenta, o
 * alvo, e desde quando. Os contadores dizem o resto da história (quantos
 * arquivos lidos, quantas buscas), que é o que responde "ele está progredindo
 * ou está preso?" sem precisar ler o log inteiro. */
function setActivity(run, kind, label) {
  run.activity = { kind, label: String(label).slice(0, 160), at: new Date().toISOString() };
  emit(run, { t: "activity", activity: run.activity, tools: run.tools });
}

function handleEvent(run, ev, setSession) {
  if (!ev || typeof ev !== "object") return;

  if (ev.session_id) setSession(ev.session_id);

  if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content) {
      if (c.type === "text" && c.text && c.text.trim()) {
        for (const para of c.text.trim().split(/\n{2,}/)) say(run, para.trim().slice(0, 400), "claude");
        // A última frase dita é o "raciocínio corrente" da tela; a primeira
        // linha basta, o resto já está no log.
        setActivity(run, "pensando", c.text.trim().split(/\n/)[0]);
      } else if (c.type === "tool_use") {
        const hint = TOOL_HINT[c.name];
        const label = hint ? hint(c.input) : c.name;
        run.tools = run.tools || {};
        run.tools[c.name] = (run.tools[c.name] || 0) + 1;
        say(run, "· " + label, "tool");
        setActivity(run, "ferramenta", label);
      }
    }
    return;
  }

  if (ev.type === "result") {
    if (typeof ev.total_cost_usd === "number") run.cost = (run.cost || 0) + ev.total_cost_usd;
    if (ev.is_error) say(run, "a rodada terminou em erro do CLI", "bad");
  }
}

/* ------------------------------------------------------------- the workdir */

const TASK_PROMPT =
  "Leia RULES.md, failure.md, nodes-index.md e target-nodes.json nesta pasta (nessa ordem). "
  + "Diagnostique a causa raiz da falha e escreva a correção MÍNIMA em patch.json, mais um report.md "
  + "em português. workflow.json tem o fluxo inteiro e pode ser grande — use Grep para achar o trecho "
  + "que interessa em vez de ler tudo. Siga RULES.md à risca: as portas de validação são código, "
  + "rodam sozinhas, e um patch que reprove volta para você corrigir.";

function retryPrompt(gates, extra) {
  const failed = (gates || []).filter(g => !g.ok);
  const L = ["O patch foi REPROVADO na validação automática. Corrija patch.json (e report.md, se mudar o diagnóstico).", ""];
  for (const g of failed) L.push("- REPROVADO: " + g.label + (g.detail ? " → " + g.detail : ""));
  if (extra) { L.push(""); L.push(extra); }
  L.push("");
  L.push("Resolva cada ponto acima. Não troque de estratégia sem motivo: se o problema for de parâmetro, a correção é de parâmetro.");
  return L.join("\n");
}

const RULES_MD = `# Regras da correção (validação automática)

Você está corrigindo UM workflow do n8n. Trabalhe só nesta pasta.

Suas ferramentas são \`Read\`, \`Write\`, \`Edit\`, \`Glob\` e \`Grep\`. **Não há Bash, não há rede e
não há chave de API** — não tente rodar \`node\`, \`curl\` ou script de validação, a chamada é
recusada e você perde a rodada. A validação roda do lado do cockpit e o resultado volta para você
se reprovar. Quem fala com o n8n é o cockpit, e só depois que o Kauan aprovar o seu diff na tela.

## Entradas
- \`failure.md\` — a falha observada: assinatura, nó, mensagem, quantas vezes, notas de tentativas anteriores.
- \`nodes-index.md\` — todos os nós com nome exato, tipo e para onde apontam. **Nome de nó é chave**; copie daqui.
- \`target-nodes.json\` — o nó que quebrou e os vizinhos imediatos, já sem credenciais. Comece por aqui.
- \`workflow.json\` — o fluxo inteiro, sem credenciais. Pode ter centenas de nós: use \`Grep\`, não leia inteiro.

## Saídas obrigatórias
### \`patch.json\`
Três verbos, todos opcionais, mas pelo menos um preenchido:

\`\`\`json
{
  "updateNodes": [
    { "name": "nome exato do nó", "parameters": { ...bloco parameters completo do nó... } }
  ],
  "addNodes": [
    { "name": "nome novo", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
      "position": [x, y], "parameters": { } }
  ],
  "rewire": {
    "nome do nó de origem": { "main": [[{ "node": "destino", "type": "main", "index": 0 }]] }
  }
}
\`\`\`

- \`updateNodes\` substitui os campos citados no nó existente. Em \`parameters\`, mande o **objeto
  inteiro** já corrigido, não só a chave que mudou.
- Campos permitidos num nó: \`parameters\`, \`typeVersion\`, \`position\`, \`disabled\`, \`notes\`,
  \`notesInFlow\`, \`alwaysOutputData\`, \`executeOnce\`, \`retryOnFail\`, \`maxTries\`,
  \`waitBetweenTries\`, \`onError\`. Qualquer outro é recusado.
- \`rewire\` **substitui todas as saídas** do nó citado. Inclua as ligações que devem continuar
  existindo, senão elas somem.
- **Não existe verbo de apagar nó.** É de propósito. Para tirar um nó do caminho, use
  \`disabled: true\` ou reescreva as conexões que passam por ele.

### \`report.md\`
Português, curto. A **primeira linha** é obrigatoriamente um resumo de UMA frase, neste formato
exato, porque ela é copiada para o quadro de erros do cockpit como registro do que foi feito —
é o que o Kauan vai reler daqui a três meses quando a mesma falha voltar:

\`\`\`
**Resumo:** o que você mudou e por quê, em uma frase de até 200 caracteres.
\`\`\`

Depois dela, nesta ordem, com estes títulos:
**Causa raiz** · **O que mudei** · **Por que isso resolve** · **Risco residual**.
Sem prometer o que você não fez. Se você não tem certeza, escreva que não tem. O resumo segue a
mesma regra: se o patch só torna a falha diagnosticável, o resumo diz isso, não diz "corrigido".

## Portas (código, não modelo)
1. \`patch.json\` é JSON válido e usa só os três verbos acima.
2. Nenhum nó removido — o formato não permite.
3. Nenhum nó existente muda de \`type\`.
4. **Nenhum bloco \`credentials\` tocado.** Se a causa for credencial revogada/expirada, diga isso no
   report: a reautorização é feita por humano no n8n, e a sua parte é propor (se houver) a mudança
   de fluxo que sobrevive à falha, tipo tratar o erro em vez de estourar.
5. Nomes de nó únicos.
6. Toda conexão aponta para nó existente.
7. Todo nó tem \`name\`, \`type\` e \`position: [x, y]\`.
8. \`active\` não é tocado.
9. Nenhum segredo literal (token, chave, JWT) em parâmetro que você alterou.
10. O patch muda alguma coisa de fato.

## Como pensar
- Correção **mínima**. Um parâmetro certo vale mais que um nó novo.
- Erro de dado ausente quase nunca se resolve no nó que estourou: trate o vazio **antes** dele
  (expressão com fallback, um If, um Set), porque o nó só foi o primeiro a esbarrar no buraco.
- Se o nó culpado estiver num sub-workflow que não está aqui, **diga isso** no report em vez de
  inventar correção no fluxo errado. O n8n reporta falha de sub-fluxo no pai.
- Se você não conseguir determinar a causa com o que tem, escreva isso no report e faça o patch
  mínimo que torne a falha diagnosticável (ex: \`onError\` + nota), em vez de chutar.
`;

// Índice compacto: nome exato, tipo e saídas. É o que substitui "leia o JSON
// inteiro" num fluxo de 188 nós — nome de nó é chave em todo lugar no n8n, e
// errar o nome é o jeito mais fácil de o patch reprovar.
function nodesIndex(w, targetName) {
  const L = ["# Índice de nós", "", "Nome exato · tipo · saídas. O nó marcado com ⚠ é o que aparece na falha.", ""];
  const outs = new Map();
  for (const [from, o] of Object.entries(w.connections || {})) {
    const dests = [];
    for (const [port, branches] of Object.entries(o || {})) {
      (branches || []).forEach((br, bi) => (br || []).forEach(c => dests.push((port === "main" && !bi ? "" : port + (bi ? "#" + bi : "") + ":") + (c && c.node))));
    }
    outs.set(from, dests);
  }
  for (const n of w.nodes || []) {
    const mark = n.name === targetName ? "⚠ " : "";
    const dis = n.disabled ? " [desativado]" : "";
    const to = (outs.get(n.name) || []);
    L.push("- " + mark + "`" + n.name + "` · " + n.type + dis + (to.length ? " → " + to.join(", ") : " → (nenhuma saída)"));
  }
  return L.join("\n");
}

// O nó da falha e os vizinhos a um salto. Sem credenciais: o Claude não precisa
// delas, o patch não sabe expressá-las, e o que não está na pasta não vaza.
function targetNodes(w, targetName) {
  const neighbours = new Set(targetName ? [targetName] : []);
  for (const [from, o] of Object.entries(w.connections || {})) {
    for (const branches of Object.values(o || {})) {
      for (const br of branches || []) {
        for (const c of br || []) {
          if (c && c.node === targetName) neighbours.add(from);
          if (from === targetName && c && c.node) neighbours.add(c.node);
        }
      }
    }
  }
  const strip = n => { const { credentials, ...rest } = n; return rest; };
  return (w.nodes || []).filter(n => neighbours.has(n.name)).map(strip);
}

// O que o Claude enxerga do fluxo nunca inclui credencial. `redactWorkflow`
// também troca segredo literal em parâmetro, então um token colado num nó não
// volta copiado no patch.
function sanitizedWorkflow(raw) {
  const w = redactWorkflow(raw);
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, val] of Object.entries(v)) { if (!CRED_KEY.test(k)) o[k] = walk(val); }
      return o;
    }
    return v;
  };
  return walk(w);
}

async function prepareDir(run, rawWorkflow, briefing, targetName, aviso) {
  await fsp.mkdir(run.dir, { recursive: true });
  await fsp.mkdir(PRIVATE_DIR, { recursive: true });

  const safe = sanitizedWorkflow(rawWorkflow);
  await fsp.writeFile(path.join(run.dir, "workflow.json"), JSON.stringify(safe, null, 2), "utf8");
  await fsp.writeFile(path.join(run.dir, "nodes-index.md"), nodesIndex(safe, targetName), "utf8");
  await fsp.writeFile(path.join(run.dir, "target-nodes.json"), JSON.stringify(targetNodes(safe, targetName), null, 2), "utf8");

  const fail = [String(briefing || "(sem briefing)")];
  if (aviso) fail.push("", "## Observação do cockpit", "", aviso);
  await fsp.writeFile(path.join(run.dir, "failure.md"), fail.join("\n"), "utf8");
  await fsp.writeFile(path.join(run.dir, "RULES.md"), RULES_MD, "utf8");

  // Fora da pasta da sessão: este é o único arquivo com credenciais.
  await fsp.writeFile(backupPath(run), JSON.stringify(rawWorkflow, null, 2), "utf8");
}

const backupPath = run => path.join(PRIVATE_DIR, run.id + ".json");

// A API pública rejeita `settings` com chave fora do schema dela, e a UI do n8n
// grava algumas (`timeSavedMode`). `n8n.js` filtra para o PUT passar — mas o PUT
// substitui `settings` inteiro, então filtrar REMOVE a chave do fluxo. Isso é
// uma alteração que o Kauan não viu no diff, por isso ela é dita em voz alta em
// vez de ficar só no corpo da requisição.
function sayDropped(run, dropped) {
  say(run, "settings fora do schema da API pública do n8n foram omitidos do PUT — e como o PUT troca o objeto inteiro, saem do fluxo: " + dropped.join(", "), "warn");
}

// Lê o patch e o aplica sobre o workflow atual. O que sai daqui é a proposta
// completa, que ainda passa por `validate` — o formato já impede o pior, as
// portas cobrem o resto.
async function buildProposal(run, raw) {
  let patch;
  try {
    patch = JSON.parse(await fsp.readFile(path.join(run.dir, "patch.json"), "utf8"));
  } catch (err) {
    return { ok: false, error: err.code === "ENOENT" ? "patch.json não foi criado" : "patch.json não é JSON válido: " + err.message };
  }
  const { workflow, errors } = applyPatch(raw, patch);
  if (errors.length) return { ok: false, error: errors.join(" · "), patch };
  return { ok: true, value: workflow, patch };
}

/* A nota que vai para o quadro de erros quando a proposta é aplicada.
 *
 * Quem escreve é o Claude — é a primeira linha do `report.md`, pedida em
 * RULES.md justamente para caber aqui. O cockpit não inventa texto: se a linha
 * não veio, cai para a seção "O que mudei" e, se nem isso existir, para o
 * resumo do diff, que é fato medido e não interpretação. O prefixo diz de quem
 * é a frase, porque no quadro ela vai conviver com as notas escritas à mão pelo
 * Kauan e confundir as duas apagaria quem decidiu o quê.
 *
 * Teto de 600 no POST /api/fixes; aqui é menor de propósito — uma nota que não
 * se lê de relance no cartão não é lida nunca. */
const NOTE_CAP = 320;

function fixNote(run) {
  // Blocos de código saem primeiro: o fallback lê prosa, e um trecho de JS
  // colado no cartão do quadro de erros não se lê de relance nem ensina nada.
  const rep = String(run.report || "").replace(/```[\s\S]*?```/g, " ");
  // Markdown sai só onde é markdown. Três lições pagas aqui, todas da mesma
  // classe — corromper em silêncio a única nota que documenta como a falha foi
  // resolvida: (1) remover `_` e `#` em qualquer posição mutilava os nós
  // snake_case ("filtrar_por_horario" → "filtrarporhorario") e o canal
  // ("#estoque" → "estoque"); (2) apagar as crases ANTES da ênfase deixava o
  // conteúdo do código participar do parse — "`a*b` e `c*d`" virava "ab e cd",
  // dois identificadores fabricados; (3) o par de * precisa encostar no
  // conteúdo, senão "maxTries * waitBetweenTries * 2" e "*.json e *.md" são
  // lidos como itálico e a conta/glob some. Por isso o texto é fatiado em
  // código e prosa: ênfase só cai na prosa, crase só perde o invólucro.
  const stripEnfase = x => x
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1") // **negrito**, colado no conteúdo
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1")     // *itálico*, colado no conteúdo
    // _ênfase_ isolada por espaço/pontuação — nunca o _ interno de snake_case
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2");
  const oneLine = s => String(s)
    .replace(/^\s*#{1,6}\s+/gm, "")      // título, só no começo da linha
    .replace(/^\s*>\s?/gm, "")           // citação, só no começo da linha
    .split(/(`+[^`\n]*`+)/)              // separa trecho de código de prosa
    .map(p => p.startsWith("`") ? p.replace(/`+/g, "") : stripEnfase(p))
    .join("")
    .replace(/`+/g, "")                  // crase ímpar que sobrou é invólucro
    .replace(/\s+/g, " ").trim();
  // Uma frase, não um parágrafo. O ponto final só conta como fim de frase
  // seguido de espaço e maiúscula, senão "1.7s" e "n8n-nodes-base.set" cortam.
  const firstSentence = s => {
    const m = /^(.{20,220}?[.!?])\s+[A-ZÀ-Ú(]/.exec(s + " A");
    return m ? m[1] : s;
  };

  let body = null;
  const resumo = /\*\*\s*Resumo\s*:?\s*\*\*\s*:?\s*([^\n]+)/i.exec(rep);
  if (resumo) body = oneLine(resumo[1]);

  if (!body) {
    const sec = /#{1,4}\s*O que mudei\s*\n+([\s\S]*?)(?=\n#{1,4}\s|\n\*\*[A-ZÀ-Ú]|$)/i.exec(rep);
    if (sec) body = firstSentence(oneLine(sec[1]));
  }
  if (!body) {
    const d = run.diff && run.diff.summary;
    if (!d) return null;
    const partes = [
      d.modified ? d.modified + " nó(s) alterado(s)" : null,
      d.added ? d.added + " nó(s) novo(s)" : null,
      (d.edgesAdded || d.edgesRemoved) ? (d.edgesAdded + "↗/" + d.edgesRemoved + "↘ conexões") : null
    ].filter(Boolean);
    body = "sem resumo no report — " + (partes.join(", ") || "nenhuma mudança descrita");
  }

  const nomes = ((run.diff && run.diff.nodes) || []).map(n => n.name).slice(0, 2).join(", ");
  const alvo = nomes ? " [" + nomes + "]" : "";
  const prefixo = "Claude (cockpit)" + alvo + ": ";
  const full = scrub(prefixo + body);
  // Corta em palavra inteira e marca o corte: uma nota que termina no meio de
  // uma palavra parece dado corrompido, não texto truncado.
  return full.length <= NOTE_CAP ? full : full.slice(0, NOTE_CAP - 2).replace(/\s+\S*$/, "") + " …";
}

async function readReport(run) {
  try { return scrub((await fsp.readFile(path.join(run.dir, "report.md"), "utf8")).slice(0, REPORT_CAP)); }
  catch { return null; }
}

/* ------------------------------------------------------------ sandbox test */

const SANDBOX_PREFIX = "[SANDBOX cockpit] ";

// Prova que o n8n aceita o JSON — a única porta que não é opinião deste
// processo. Escreve numa cópia INATIVA, nunca no fluxo real, e nunca apaga nada.
async function sandboxTest(run, proposal) {
  const name = SANDBOX_PREFIX + String(run.wfName || run.wfId).slice(0, 80);
  const body = {
    name,
    nodes: proposal.nodes,
    connections: proposal.connections,
    settings: proposal.settings || { executionOrder: "v1" }
  };
  let id = run.sandboxId;
  if (!id) {
    const found = await n8n.findWorkflowByName(name);
    id = found ? found.id : null;
  }
  if (id) {
    await n8n.putWorkflow(id, body, dropped => sayDropped(run, dropped));
  } else {
    const created = await n8n.createWorkflow(body, dropped => sayDropped(run, dropped));
    id = created && created.id ? String(created.id) : null;
  }
  run.sandboxId = id;
  return { id, name };
}

/* ------------------------------------------------------------------- start */

/* Quanto tempo isto costuma levar — medido, não chutado.
 *
 * A barra de progresso da tela precisa de um denominador, e o único honesto é o
 * histórico desta máquina: as corridas que já terminaram, no ledger. Mediana e
 * não média, porque uma corrida de 4 rodadas (474s medidos) puxaria a média
 * para longe do caso típico (~180s) e a barra passaria a mentir para baixo o
 * tempo todo.
 *
 * Devolve `samples: 0` quando não há histórico. Nesse caso a tela **não**
 * desenha estimativa nenhuma — mostra o tempo decorrido e diz que ainda não sabe
 * quanto falta. Um ETA inventado na primeira execução seria pior que nenhum. */
const ETA_MIN_SAMPLES = 3;

async function estimate() {
  const list = await readStore();
  const durs = list
    .filter(p => p.startedAt && p.finishedAt)
    .map(p => new Date(p.finishedAt) - new Date(p.startedAt))
    .filter(ms => Number.isFinite(ms) && ms > 5000 && ms < 60 * 60 * 1000)
    .sort((a, b) => a - b);
  if (durs.length < ETA_MIN_SAMPLES) return { medianMs: null, p80Ms: null, samples: durs.length };
  const at = q => durs[Math.min(durs.length - 1, Math.floor(durs.length * q))];
  return { medianMs: at(0.5), p80Ms: at(0.8), samples: durs.length };
}

let active = null;   // one run at a time: each one spawns a CLI and hits the API

async function start({ key, wfId, briefing, wfName, node, lastNode }) {
  if (!claudeFound) throw Object.assign(new Error("Claude Code CLI não encontrado em " + CLAUDE_BIN + " — defina CLAUDE_BIN no .env"), { status: 503 });
  if (!n8n.configured) throw Object.assign(new Error("n8n não configurado"), { status: 503 });
  if (active && runs.get(active) && runs.get(active).status === "running") {
    throw Object.assign(new Error("já existe uma correção rodando (" + active + ")"), { status: 409 });
  }

  const id = newRunId();
  const run = {
    id, key, wfId: String(wfId), wfName: wfName || null,
    node: node || null, lastNode: lastNode || null, redirected: null,
    dir: path.join(RUNS_DIR, id),
    status: "running", stage: "fetch", round: 0,
    gates: null, diff: null, report: null, sandbox: null,
    error: null, cost: 0, log: [],
    activity: null, tools: {}, eta: await estimate(),
    startedAt: new Date().toISOString(), finishedAt: null, appliedAt: null, revertedAt: null,
    capturedUpdatedAt: null, sandboxId: null, sessionId: null, child: null
  };
  runs.set(id, run);
  active = id;

  // Cada run guarda até 900 linhas de log em memória e o processo do cockpit
  // fica de pé o dia inteiro. Só os mais recentes precisam continuar
  // consultáveis — o que importa a longo prazo já está em proposals.json.
  // Um run aplicado nunca é descartado: é dele que sai o Desfazer.
  if (runs.size > RUNS_IN_MEMORY) {
    const descartaveis = [...runs.values()]
      .filter(r => r.status !== "running" && r.status !== "ready" && r.status !== "applied");
    for (const r of descartaveis.slice(0, runs.size - RUNS_IN_MEMORY)) runs.delete(r.id);
  }

  drive(run, briefing).catch(async err => {
    run.status = "failed";
    run.error = scrub(err && err.message || err);
    run.finishedAt = new Date().toISOString();
    say(run, "falhou: " + run.error, "bad");
    emit(run, { t: "state", status: run.status });
    await persist(run).catch(() => {});
  });

  return { runId: id };
}

async function persist(run) {
  await upsertStore({
    runId: run.id, key: run.key, wfId: run.wfId, wfName: run.wfName, redirected: run.redirected,
    status: run.status, gates: run.gates, summary: run.diff ? run.diff.summary : null,
    report: run.report, fixNote: fixNote(run), sandbox: run.sandbox, error: run.error, cost: run.cost,
    startedAt: run.startedAt, finishedAt: run.finishedAt,
    appliedAt: run.appliedAt, revertedAt: run.revertedAt,
    capturedUpdatedAt: run.capturedUpdatedAt
  });
}

const setStage = (run, stage) => { run.stage = stage; emit(run, { t: "stage", stage }); };

/* Segue o sub-workflow. A resolução de "onde este nó vive" é FATO e mora em
 * `n8n.locateNode` — o quadro de erros usa a mesma resposta para não atribuir o
 * nó ao fluxo errado na tela. Aqui só se decide o que fazer com ela: quando o
 * filho tem o nó, a corrida troca de alvo, porque propor no pai um conserto que
 * pertence ao filho é entregar um bilhete, não uma correção.
 *
 * Um salto só. Se o nó estiver dois níveis abaixo isso vira log, não recursão.
 * O nó que o n8n apontou como último executado tem prioridade: é quem estava
 * chamando quando quebrou, ou seja o palpite com evidência atrás. */
async function followSubWorkflow(run, parent, sigNode) {
  let loc;
  try { loc = await n8n.locateNode(run.wfId, sigNode); }
  catch (err) { say(run, "não consegui localizar o nó: " + scrub(err.message || err), "warn"); return null; }
  if (loc.inWorkflow) return null;

  const candidates = (loc.subflows || []).filter(s => s.hasNode);
  if (!candidates.length) {
    if ((loc.subflows || []).length) say(run, "nenhum dos " + loc.subflows.length + " sub-fluxos chamados tem esse nó — pode estar mais fundo", "warn");
    return null;
  }
  // Desempate por evidência: nesta instância `Convert text to speech` existe em
  // dois filhos, então "o primeiro da lista" acerta por sorte. O nó que o n8n
  // registrou como último executado é quem estava chamando quando quebrou.
  const byEvidence = candidates.find(s => s.viaNode === run.lastNode);
  const pick = byEvidence || candidates[0];
  const certain = !!byEvidence || candidates.length === 1;
  if (!certain) {
    say(run, candidates.length + " sub-fluxos têm esse nó (" + candidates.map(c => c.childName || c.childId).join(", ")
      + ") e a execução não disse qual chamou — segui o de " + pick.viaNode, "warn");
  }

  let child;
  try { child = await n8n.getRawWorkflow(pick.childId); }
  catch (err) { say(run, "não consegui abrir o sub-fluxo " + pick.childId + ": " + scrub(err.message || err), "warn"); return null; }

  return {
    child, id: String(child.id || pick.childId), viaNode: pick.viaNode, certain,
    others: certain ? null : candidates.filter(c => c !== pick).map(c => c.childName || c.childId),
    fromId: String(run.wfId), fromName: run.wfName || String(run.wfId)
  };
}

async function drive(run, briefing) {
  /* 1 — ler o workflow bruto (fica neste processo e no disco local, nunca vai pro browser) */
  setStage(run, "fetch");
  say(run, "lendo o workflow " + run.wfId + " na instância", "step");
  // `let`, não `const`: a corrida pode trocar de fluxo quando o nó da
  // assinatura mora num sub-workflow (ver `followSubWorkflow` abaixo).
  let raw = await n8n.getRawWorkflow(run.wfId);
  run.wfName = String(raw.name || run.wfName || "");
  run.capturedUpdatedAt = raw.updatedAt || null;
  say(run, (raw.nodes || []).length + " nós · atualizado em " + (raw.updatedAt || "?"), null);

  /* Qual nó recortar. Não é só ler a assinatura: o n8n reporta a falha de um
   * sub-workflow NO PAI, então `wfId|nó|tipo` pode nomear um nó que não existe
   * neste grafo (observado: `Convert text to speech` na `WhatsApp API Oficial`).
   * Recortar em volta de um nó inexistente entrega uma pasta vazia e o Claude
   * gasta uma rodada descobrindo isso sozinho. Então o cockpit resolve o alvo
   * aqui, cai no último nó executado quando precisa, e **diz na cara** qual dos
   * dois casos é — apontar para o nó errado em silêncio seria pior que não
   * apontar. */
  let names = new Set((raw.nodes || []).map(n => String(n.name)));
  const sigNode = run.node || String(run.key || "").split("|")[1] || null;
  let targetName = sigNode && names.has(sigNode) ? sigNode : null;
  let aviso = null;

  /* Antes de desistir do nó: seguir o sub-workflow.
   *
   * Quando a assinatura nomeia um nó que não existe aqui, o defeito está no
   * filho — e propor qualquer coisa no pai é, na melhor das hipóteses, deixar
   * um bilhete. A primeira corrida real nesta assinatura terminou exatamente
   * assim: um patch só de `notes`, com o report dizendo em voz alta "isto não
   * resolve". Estava certo, e era inútil.
   *
   * Então o cockpit abre o nó `executeWorkflow` que fez a chamada, lê o id do
   * filho e **troca o alvo da corrida** para ele. Um salto só: se o nó estiver
   * dois níveis abaixo, isso aparece no log em vez de virar recursão. */
  if (!targetName && sigNode) {
    const redir = await followSubWorkflow(run, raw, sigNode);
    if (redir) {
      raw = redir.child;
      names = new Set((raw.nodes || []).map(n => String(n.name)));
      targetName = sigNode;
      run.wfId = redir.id;
      run.wfName = String(raw.name || redir.id);
      run.capturedUpdatedAt = raw.updatedAt || null;
      run.redirected = {
        fromId: redir.fromId, fromName: redir.fromName, viaNode: redir.viaNode,
        toId: redir.id, toName: run.wfName, node: sigNode,
        certain: redir.certain, others: redir.others
      };
      aviso = 'Atenção: a falha apareceu no fluxo pai `' + redir.fromName + '` (o n8n reporta erro de sub-workflow no pai), '
        + 'mas o nó `' + sigNode + '` vive **neste** workflow, que é o filho chamado por `' + redir.viaNode + '`. '
        + 'Você está com o arquivo certo: corrija aqui.';
      say(run, "o nó não existe no pai — segui o sub-workflow por " + redir.viaNode, "warn");
      say(run, "alvo trocado para " + run.wfName + " (" + redir.id + ") · " + (raw.nodes || []).length + " nós", "step");
      emit(run, { t: "state", status: run.status });
    }
  }

  if (!targetName && sigNode) {
    if (run.lastNode && names.has(run.lastNode)) {
      targetName = run.lastNode;
      aviso = 'O nó `' + sigNode + '` da assinatura **não existe neste workflow**. O n8n reporta a falha de '
        + 'um sub-workflow no fluxo pai, então este é o pai. O recorte em `target-nodes.json` é do nó que fez '
        + 'a chamada (`' + run.lastNode + '`), que é o que dá para tratar aqui. Se a correção certa for dentro '
        + 'do sub-workflow, **diga isso no report** em vez de inventar uma mudança neste fluxo — o que dá para '
        + 'fazer no pai é tornar a falha tratada ou diagnosticável, não consertar o filho.';
      say(run, "o nó da assinatura não existe neste grafo — falha propagada de sub-workflow; alvo cai para "
        + run.lastNode, "warn");
    } else {
      aviso = 'O nó `' + sigNode + '` da assinatura não existe neste workflow e o último nó executado também não '
        + 'foi localizado. Use `nodes-index.md` para achar o ponto certo, e se não der para determinar, diga isso '
        + 'no report em vez de chutar.';
      say(run, "o nó da assinatura não existe neste grafo e não há último nó executado utilizável", "warn");
    }
  }

  await prepareDir(run, raw, briefing, targetName, aviso);
  say(run, "pasta preparada: índice de " + (raw.nodes || []).length + " nós, recorte de "
    + targetNodes(sanitizedWorkflow(raw), targetName).length + " nó(s) em volta de "
    + (targetName || "(nenhum nó localizado)"), null);
  say(run, "credenciais não entram na pasta — o Claude nunca as vê", null);

  /* 2..N — Claude propõe, as portas julgam, o resultado volta pra ele */
  let lastGates = null, lastExtra = null;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    run.round = round;
    // A rodada é a informação que muda o significado do tempo decorrido: 3min na
    // rodada 1 é o caso típico, 3min na rodada 3 quer dizer que duas propostas
    // já foram reprovadas. A tela mostra isso ao lado da barra.
    emit(run, { t: "round", round, maxRounds: MAX_ROUNDS });
    setStage(run, round === 1 ? "claude" : "retry");
    say(run, "rodada " + round + "/" + MAX_ROUNDS + " — Claude trabalhando", "step");

    const prompt = round === 1 ? TASK_PROMPT : retryPrompt(lastGates || [], lastExtra);
    const res = await runClaude(run, { prompt, resume: round === 1 ? null : run.sessionId });
    if (res.sessionId) run.sessionId = res.sessionId;
    if (!res.ok && !(await buildProposal(run, raw)).ok) throw new Error(res.error || "a rodada do Claude falhou");

    setStage(run, "gates");
    const p = await buildProposal(run, raw);
    if (!p.ok) {
      lastGates = [{ id: "patch", label: "patch.json aplicável", ok: false, detail: p.error }];
      lastExtra = null;
      run.gates = lastGates;
      emit(run, { t: "gates", gates: run.gates });
      say(run, "✕ " + p.error, "bad");
      continue;
    }

    const v = validate(raw, p.value);
    run.gates = v.gates;
    emit(run, { t: "gates", gates: run.gates });
    for (const g of v.gates) say(run, (g.ok ? "✓ " : "✕ ") + g.label + (g.detail ? " — " + g.detail : ""), g.ok ? "good" : "bad");

    if (!v.ok) { lastGates = v.gates; lastExtra = null; continue; }

    /* porta extra: o próprio n8n aceita o JSON? só se o Kauan ligou o sandbox */
    if (SANDBOX_TEST) {
      setStage(run, "sandbox");
      say(run, "testando numa cópia inativa na instância", "step");
      try {
        const sb = await sandboxTest(run, p.value);
        run.sandbox = { ok: true, id: sb.id, name: sb.name };
        say(run, "✓ o n8n aceitou o JSON na cópia " + sb.name, "good");
      } catch (err) {
        run.sandbox = { ok: false, error: scrub(err.message || err) };
        say(run, "✕ o n8n recusou o JSON: " + run.sandbox.error, "bad");
        lastGates = [...v.gates, { id: "sandbox", label: "o n8n aceita o JSON", ok: false, detail: run.sandbox.error }];
        lastExtra = "O n8n recusou o workflow com: " + run.sandbox.error;
        run.gates = lastGates;
        emit(run, { t: "gates", gates: run.gates });
        continue;
      }
    } else {
      run.sandbox = { ok: null, skipped: true };
      say(run, "teste na instância desligado (COCKPIT_SANDBOX_TEST=0) — só validação local", "warn");
    }

    /* pronto: monta o diff redigido e para. Aplicar é decisão do Kauan. */
    setStage(run, "review");
    run.diff = diffWorkflow(raw, p.value);
    run.report = await readReport(run);
    run.status = "ready";
    run.finishedAt = new Date().toISOString();
    const s = run.diff.summary;
    say(run, "proposta pronta: " + s.modified + " nó(s) alterado(s), " + s.added + " novo(s), "
      + s.edgesAdded + " conexão(ões) a mais, " + s.edgesRemoved + " a menos", "good");
    say(run, "nada foi aplicado no n8n — o diff está à sua espera", "step");
    emit(run, { t: "ready", snapshot: snapshot(run) });
    emit(run, { t: "state", status: run.status });
    await persist(run);
    return;
  }

  run.status = "failed";
  run.error = "as portas de validação continuaram reprovando depois de " + MAX_ROUNDS + " rodadas";
  run.finishedAt = new Date().toISOString();
  say(run, run.error, "bad");
  emit(run, { t: "state", status: run.status });
  await persist(run);
}

/* ------------------------------------------------------------- reidratação */

/* As corridas vivem em memória, e o `server.js` precisa reiniciar sempre que é
 * editado — foi exatamente o que aconteceu ao consertar o 400 do `settings`: a
 * proposta pronta (uma sessão do Claude, minutos e dólares reais) evaporava com
 * o processo e a única saída era rodar tudo de novo.
 *
 * A reidratação NÃO restaura um diff em cache: ela reabre o `patch.json` que
 * ficou no diretório da corrida e o reaplica sobre o estado ATUAL do fluxo,
 * rerodando as portas e remontando o diff. O que volta para a tela descreve o
 * que aconteceria se o botão fosse clicado agora — que é a única coisa que a
 * tela pode prometer. Uma proposta que não passa mais nas portas não volta como
 * `ready`; some da lista, porque aprovar não seria possível mesmo.
 *
 * Nada aqui escreve no n8n. Só GET. */
const REHYDRATE_CAP = 8;

async function rehydrate() {
  if (!n8n.configured) return { restored: 0, skipped: 0 };
  const list = (await readStore()).filter(p => p.status === "ready").slice(-REHYDRATE_CAP);
  let restored = 0, skipped = 0;
  for (const p of list) {
    if (runs.has(p.runId)) continue;
    const run = {
      id: p.runId, key: p.key, wfId: String(p.wfId), wfName: p.wfName || null,
      node: null, lastNode: null, redirected: p.redirected || null,
      dir: path.join(RUNS_DIR, p.runId),
      status: "ready", stage: "review", round: p.round || 0,
      gates: p.gates || null, diff: null, report: p.report || null, sandbox: p.sandbox || null,
      error: null, cost: p.cost || null,
      startedAt: p.startedAt || null, finishedAt: p.finishedAt || null,
      appliedAt: null, revertedAt: null,
      capturedUpdatedAt: p.capturedUpdatedAt || null,
      log: [], child: null, sessionId: null, sandboxId: null
    };
    try {
      const current = await n8n.getRawWorkflow(run.wfId);
      const prop = await buildProposal(run, current);
      if (!prop.ok) { skipped++; continue; }
      const v = validate(current, prop.value);
      if (!v.ok) { skipped++; continue; }
      run.gates = v.gates;
      run.diff = diffWorkflow(current, prop.value);
      // O carimbo passa a ser o do documento sobre o qual este diff foi montado,
      // senão o próprio `approve` recusaria a proposta que acabou de reabrir.
      run.capturedUpdatedAt = current.updatedAt || null;
      run.log = [{ t: "log", level: "warn", runId: run.id, at: new Date().toISOString(),
        text: "proposta reaberta depois de um reinício do cockpit — o patch foi reaplicado sobre o estado atual do fluxo (" + (current.updatedAt || "?") + ") e as portas rodaram de novo" }];
      runs.set(run.id, run);
      restored++;
    } catch { skipped++; }
  }
  return { restored, skipped };
}

/* ------------------------------------------------------- approve / revert */

// A ÚNICA porta de escrita no fluxo real. Chega aqui só com o Kauan tendo
// clicado em cima de um diff que já estava na tela.
async function approve(runId) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error("run desconhecido"), { status: 404 });
  if (run.status !== "ready") throw Object.assign(new Error("esta proposta não está pronta (" + run.status + ")"), { status: 409 });

  // Fail-closed: se o fluxo mudou no n8n depois que a proposta foi montada, o
  // diff que ele aprovou não descreve mais o que vai acontecer.
  const current = await n8n.getRawWorkflow(run.wfId);
  if (run.capturedUpdatedAt && current.updatedAt && current.updatedAt !== run.capturedUpdatedAt) {
    throw Object.assign(new Error("o fluxo mudou no n8n depois desta proposta (" + current.updatedAt + ") — rode de novo para revisar em cima do estado atual"), { status: 409 });
  }

  // O patch é reaplicado sobre o estado ATUAL, não sobre a cópia de quando a
  // proposta nasceu. Com o carimbo acima os dois são o mesmo documento; se um
  // dia deixarem de ser, o que vale é o que está na instância.
  const p = await buildProposal(run, current);
  if (!p.ok) throw new Error(p.error);

  // Revalida contra o estado atual antes de escrever: as portas valem no
  // momento de aplicar, não só no momento de propor.
  const v = validate(current, p.value);
  if (!v.ok) {
    run.gates = v.gates;
    throw Object.assign(new Error("a proposta não passa mais nas portas de validação"), { status: 409 });
  }

  await fsp.writeFile(backupPath(run), JSON.stringify(current, null, 2), "utf8");
  await n8n.putWorkflow(run.wfId, {
    name: current.name,
    nodes: p.value.nodes,
    connections: p.value.connections,
    settings: p.value.settings || current.settings || { executionOrder: "v1" }
  }, dropped => sayDropped(run, dropped));

  run.status = "applied";
  run.appliedAt = new Date().toISOString();
  say(run, "aplicado no fluxo " + run.wfId + " — backup do estado anterior guardado", "good");
  emit(run, { t: "state", status: run.status });
  await persist(run);
  return snapshot(run);
}

async function reject(runId, note) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error("run desconhecido"), { status: 404 });
  if (run.child) { try { run.child.kill(); } catch { /* já morreu */ } }
  run.status = "rejected";
  run.finishedAt = run.finishedAt || new Date().toISOString();
  if (note) say(run, "rejeitado: " + String(note).slice(0, 300), "warn");
  else say(run, "rejeitado — nada foi aplicado", "warn");
  emit(run, { t: "state", status: run.status });
  await persist(run);
  return snapshot(run);
}

// Desfaz aplicando o backup. É um PUT como qualquer outro — por isso também
// exige clique, e por isso o backup é gravado no momento de aplicar, não antes.
async function revert(runId) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error("run desconhecido"), { status: 404 });
  if (run.status !== "applied") throw Object.assign(new Error("não há aplicação para desfazer"), { status: 409 });

  const backup = JSON.parse(await fsp.readFile(backupPath(run), "utf8"));
  await n8n.putWorkflow(run.wfId, {
    name: backup.name,
    nodes: backup.nodes,
    connections: backup.connections,
    settings: backup.settings || { executionOrder: "v1" }
  }, dropped => sayDropped(run, dropped));
  run.status = "reverted";
  run.revertedAt = new Date().toISOString();
  say(run, "desfeito — o fluxo voltou ao estado anterior à aplicação", "warn");
  emit(run, { t: "state", status: run.status });
  await persist(run);
  return snapshot(run);
}

function get(runId) {
  const run = runs.get(runId);
  return run ? snapshot(run) : null;
}

function subscribe(runId, fn) {
  const h = ev => fn(ev);
  bus.on(runId, h);
  return () => bus.off(runId, h);
}

module.exports = {
  configured, claudeFound, claudeBin: CLAUDE_BIN, sandboxEnabled: SANDBOX_TEST,
  start, get, subscribe, approve, reject, revert, readStore, rehydrate,
  // exportados para teste
  validate, applyPatch, diffWorkflow, redactWorkflow, sanitizedWorkflow, nodesIndex, targetNodes, scrub, fixNote, estimate
};
