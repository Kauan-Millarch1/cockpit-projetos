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
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const n8n = require("./n8n");
/* O portão de destino de rede. Ele entra AQUI, e não só no `bateria.js`, porque a
 * auditoria de 24/08/2026 mediu que `validate()` passa 10 de 10 contra as quatro
 * variantes de exfiltração: redirecionar a `url` de um `httpRequest` que já existe
 * não deixa nenhum dos dez portões vermelho — `credentials-untouched` fica verde
 * JUSTAMENTE porque a credencial não foi tocada, então o nó segue autenticando com
 * a mesma chave e passa a mandar tudo para outro lugar. Todos os dez perguntam se o
 * documento continua VÁLIDO, e ele continua. Destino era o único fato que ninguém
 * olhava, e este é o caminho que escreve em fluxo de produção. */
const rede = require("./rede.js");
/* QUAL IA roda a rodada, e COM QUAL CREDENCIAL. O adaptador é quem monta os
 * argumentos, o ambiente e a descoberta do binário — e as três cercas
 * (`--disallowedTools`, `--setting-sources ""`, `--strict-mcp-config`) passaram a
 * ser DADO na tabela dele em vez de um array escrito à mão aqui. O motivo é o
 * mesmo que o `ambiente.js` já escreveu sobre a allowlist: enquanto a lista
 * existia em quatro arquivos, eram quatro chances de divergirem, e o lado que
 * divergisse seria uma sessão sem cerca.
 *
 * Nada muda no comportamento de hoje: o padrão declarado do adaptador é
 * `claude` + `plano` — o mesmo CLI e o mesmo login OAuth, com a chave de API
 * AUSENTE do ambiente. A diferença só aparece no dia em que a pessoa escolher o
 * modo `chave`, e essa escolha ainda não tem por onde chegar aqui. */
const ia = require("./ia.js");

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

/* QUAL IA roda esta rodada, e de quem é a conta que paga. Hoje é o PADRÃO
   DECLARADO do adaptador — `claude` + `plano`, o mesmo binário e o mesmo login
   OAuth de sempre, com a chave de API AUSENTE do ambiente. É uma constante e não
   um objeto montado dentro do spawn porque é a escolha DA CORRIDA: no dia em que
   ela vier da pessoa, o que muda é de onde este objeto sai — não o que o spawn
   faz com ele. */
/* A escolha de IA da rodada. FUNÇÃO, e não constante de módulo, e essa é a
   correção de um defeito armado — não de estilo.
 *
 * Era `const escolhaDaRodada() = ia.escolher({})`, resolvida UMA VEZ no `require`. Como
 * o padrão é `plano`, isso significa que a escolha de credencial de toda rodada
 * de todo mundo é decidida no instante em que o processo sobe, antes de existir
 * qualquer pessoa para escolher. Hoje o comportamento é o certo — é um dono, na
 * máquina dele, gastando o plano dele — então nada muda agora, e há teste
 * aferindo que os argumentos e o ambiente saem idênticos.
 *
 * O que muda é que ela deixa de ser IMPOSSÍVEL de variar. Uma escolha congelada
 * no `require` não consegue seguir uma decisão por rodada, por pessoa ou por
 * conta, e o sintoma disso não é um erro: é a conta de outra pessoa sendo
 * gastada em silêncio, que é exatamente o que trocar o plano por chave de API
 * existe para evitar.
 *
 * É a TERCEIRA ocorrência desta família num dia: `n8n.js` congelava `configured`
 * e `instance` (o cofre nunca chegaria ao cabeçalho), `claude-fix.js` congelava
 * uma cópia de `n8n.configured`, e esta. O padrão é sempre o mesmo — um valor
 * lido no `require` para responder uma pergunta cuja resposta muda depois.
 *
 * `chave` continua NÃO sendo passada a `ambienteDaRodada`, e isso é deliberado
 * enquanto o modo é `plano`: no modo plano a variável de chave tem de estar
 * AUSENTE do ambiente, nunca vazia. Quando a escolha vier da pessoa, é aqui que
 * ela entra — num sítio só, por arquivo, auditável. */
function escolhaDaRodada() {
  return ia.escolher({});
}

/* Onde está o binário. O `findClaude()` que morava aqui era a MESMA função que o
   `tester.js` e o `iso-check.js` tinham, letra por letra — três chances de
   deixarem de ser. Ela agora é `ia.descobrir("claude")`, e as três cópias
   sumiram.
   O `.env` continua sendo lido AQUI e não lá: o `ia.js` não abre arquivo de
   configuração de propósito (uma decisão de rodada não pode depender de um
   arquivo que ninguém passou — um `readEnv` vencendo o `process.env` já custou um
   `PUT` real na instância de produção neste repositório), então quem lê o `.env`
   é o `readEnv` deste arquivo e o valor entra como AMBIENTE. */
const CLAUDE_BIN_DECLARADO = process.env.CLAUDE_BIN || readEnv("CLAUDE_BIN") || null;
const ACHEI_CLAUDE = ia.descobrir("claude", {
  env: CLAUDE_BIN_DECLARADO ? { CLAUDE_BIN: CLAUDE_BIN_DECLARADO } : {}
});

/* O CAMINHO É O MESMO DE ANTES NOS TRÊS ESTADOS. Achado, é o caminho; não achado
   (o `CLAUDE_BIN` aponta para o vazio) ou indeterminado, sobra o nome nu para o
   PATH — que é exatamente o que o `findClaude()` devolvia no `return` final. */
const CLAUDE_BIN = ACHEI_CLAUDE.caminho
  || (process.platform === "win32" ? ia.PROVEDORES.claude.naPath.win32 : ia.PROVEDORES.claude.naPath.outro);

/* `claudeFound` CONTINUA BOOLEANO, porque é o que os consumidores de hoje
   esperam e trocar o tipo aqui seria mudar comportamento numa fiação.
   Mas o TERCEIRO ESTADO não pode morrer na tradução, e é por isso que
   `claudeAchado`/`claudePorque` saem no `module.exports`: `descobrir` responde
   `true` (achei), `false` (você apontou `CLAUDE_BIN` e lá não tem nada) e `null`
   (não deu para procurar — sobra o nome nu no PATH, e sobre um nome nu
   `existsSync` não responde nem sim nem não). O `false` de hoje é
   `fs.existsSync("claude.exe")`, uma AFIRMAÇÃO que ninguém mediu: ela diz "o CLI
   não está nesta máquina" sobre um CLI que pode estar no PATH. O
   `integracoes.js` já tem o ramo "não sei nem se o CLI está aqui" e hoje ele é
   inalcançável; com estes dois campos ele passa a ser. */
const claudeFound = ACHEI_CLAUDE.achado === true;

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

  /* Destino de rede. É o único portão desta lista que não pergunta se o documento
     é válido — pergunta se ele passou a ALCANÇAR um lugar que o fluxo de antes não
     alcançava. A régua é derivada do próprio fluxo original, não de uma allowlist:
     lista mantida à mão envelhece e acaba com `*` dentro.

     A lista de gravidade vem do `rede.js` e NÃO é redeclarada aqui. `validate()` é
     a checagem 1 da bateria, e o `bateria.js` lê a mesma lista — duas cópias
     divergiriam na primeira correção feita num lado só, e o lado que divergisse
     desligaria o bloqueio exatamente aqui, no caminho que escreve em produção.
     Importar `bateria.js` não dá: ele requer este arquivo, seria ciclo.

     TRÊS coisas fecham em vez de ficarem neutras, e cada uma é um caso de teste:

     1. O `catch`. Se o portão que separa "arruma o nó" de "manda o dado para fora"
        não RODOU, o botão não pode aparecer. Todos os outros portões daqui podem
        ser lidos como "conferi e está bom"; este não pode ser lido como "não
        consegui conferir e está bom".
     2. O `teto`. Varredura que desistiu no meio deixa a tela verde do mesmo jeito
        que varredura que terminou limpa, e essa é a definição de portão inútil.
     3. A lista AUSENTE. Se alguém renomear o export no `rede.js`, `REPROVAM_REDE`
        chega `undefined`; tratado como conjunto vazio, nada mais seria grave e o
        bloqueio desapareceria em silêncio. Ausente é a mesma disciplina que este
        repositório já escreveu sete vezes: campo que não veio nunca cai no galho
        negativo. */
  let redeOk = true, redeDetalhe = null;
  try {
    const graves = rede.REPROVAM_REDE;
    if (!(graves instanceof Set) || graves.size === 0) {
      throw new Error("`rede.REPROVAM_REDE` não chegou como conjunto — sem a régua "
        + "não dá para dizer qual achado é saída de dado");
    }
    const r = rede.varrer(orig, prop);
    const pesados = (r.achados || []).filter(a => graves.has(a.tipo) || a.tipo === "teto");
    if (pesados.length) {
      redeOk = false;
      redeDetalhe = pesados.map(a => rede.frase(a)).join(" · ");
    }
  } catch (e) {
    redeOk = false;
    redeDetalhe = "não consegui conferir o destino de rede: "
      + String((e && e.message) || e).slice(0, 200)
      + " — sem essa conferência o diff não pode ser aprovado";
  }
  add("no-new-network-destination", "não manda dado para endereço novo", redeOk, redeDetalhe);

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

/* ══════════════════════════════ DE QUE TIPO É ESTA LINHA ═══════════════════
 *
 * ETAPA 1 de quatro (PLAN-UPGRADE.md §7.1). A aba Upgrade grava NESTE arquivo,
 * de propósito: separar teria fragmentado o histórico sem motivo, e o que este
 * repositório já registra é o desejo oposto — "um único log de eventos faria «o
 * que fizemos sobre essa falha» ser uma consulta em vez de duas".
 *
 * O preço é que todo consumidor passa a precisar dizer de que tipo ele fala, e
 * o mais caro deles é o CAP. `STORE_CAP` era global: um dia de upgrades
 * expulsaria o histórico inteiro de correção, e `writeStore` corta sem avisar
 * ninguém. O defeito só aparece no dia em que alguém procura o registro que já
 * não existe.
 *
 * `kindOf` (o `kindDe` do plano) é o que torna o legado legível: nenhuma das
 * linhas escritas até aqui tem o campo — medido, 31 de 31 sem `kind` — e todas
 * elas são correção. Ausente é `"fix"`, nunca o ramo novo. Mesma regra que este
 * arquivo já aplica em três outros lugares: campo ausente não cai no ramo
 * negativo.
 *
 * O `tester` NÃO entra aqui. Ele tem ledger próprio (`blueprints.json`) e nunca
 * escreveu neste arquivo; incluí-lo na lista seria abrir um tipo que ninguém
 * grava. Isto é sobre o ledger, não sobre `n8n.writeOwner`, cujos kinds são
 * três porque lá o assunto é escrita na instância. */
const LEDGER_KINDS = new Set(["fix", "upgrade"]);
const kindOf = p => (p && p.kind) || "fix";

/* Cru e privado: devolve o arquivo inteiro, os dois tipos misturados. Só quem
   vai REESCREVER pode usar — ler filtrado e escrever de volta apagaria as
   linhas do outro tipo, que é dano pior do que o cap global que esta etapa
   veio consertar. */
async function readStoreRaw() {
  try {
    const raw = JSON.parse(await fsp.readFile(STORE_FILE, "utf8"));
    return Array.isArray(raw.proposals) ? raw.proposals : [];
  } catch { return []; }
}

/* O `kind` é OBRIGATÓRIO, e é por isso que ele não tem default. Um parâmetro
   opcional aqui devolveria a lista misturada para quem esquecesse de passar —
   exatamente o default silencioso que a etapa 0 acabou de fechar do outro lado. */
async function readStore(kind) {
  if (!LEDGER_KINDS.has(kind)) {
    throw new Error("readStore: diga de que tipo você fala — " + [...LEDGER_KINDS].join(" ou ")
      + ' — veio "' + String(kind) + '" (PLAN-UPGRADE.md §7.1)');
  }
  return (await readStoreRaw()).filter(p => kindOf(p) === kind);
}

/* O cap é POR TIPO. A ordem do arquivo é cronológica e continua sendo: quem
   sobrevive é escolhido por tipo, e o resultado é filtrado na ordem original —
   `rehydrate` lê `slice(-N)` contando com isso.
   Consequência a registrar: o teto do arquivo dobra, 60 linhas para 120. Medido
   a ~6,8KB por linha (o `report` inteiro viaja nela), então o arquivo em git vai
   de ~410KB para ~820KB no pior caso. Se isso incomodar, o número a mexer é
   `STORE_CAP` — e ele agora é por tipo, não do arquivo. */
function trimPorTipo(list) {
  const porTipo = new Map();
  list.forEach((p, i) => {
    const k = kindOf(p);
    if (!porTipo.has(k)) porTipo.set(k, []);
    porTipo.get(k).push(i);
  });
  const sobrevivem = new Set();
  for (const indices of porTipo.values()) for (const i of indices.slice(-STORE_CAP)) sobrevivem.add(i);
  return list.filter((_, i) => sobrevivem.has(i));
}

async function writeStore(list) {
  const trimmed = trimPorTipo(list);
  const tmp = STORE_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), proposals: trimmed }, null, 2), "utf8");
  await fsp.rename(tmp, STORE_FILE);
}

/* Escrever sem `kind` é erro. Com isso o fallback de `kindOf` só serve ao
   legado que já está no disco — nenhuma linha nova nasce sem tipo, e o dia em
   que a aba Upgrade gravar aqui ela não vai poder gravar como correção por
   omissão. */
/* Puro, e é assim que `ledger-kind-test.js` prova o que importa sem escrever no
   ledger de verdade — o cockpit grava nele o dia inteiro, e um teste que
   restaurasse o arquivo inteiro passaria por cima de uma escrita de verdade.
   Mesmo motivo pelo qual `custoDaRodada` no Tester é função pura. */
function upsertEm(list, entry) {
  const fora = list.slice();
  const i = fora.findIndex(p => p.runId === entry.runId);
  if (i >= 0) fora[i] = entry; else fora.push(entry);
  return fora;
}

async function upsertStore(entry) {
  if (!LEDGER_KINDS.has(entry && entry.kind)) {
    throw new Error("upsertStore: a linha precisa de `kind` (" + [...LEDGER_KINDS].join(" ou ")
      + ') — veio "' + String(entry && entry.kind) + '"');
  }
  /* CRU de propósito: ler filtrado aqui e escrever de volta apagaria as linhas
     do outro tipo — dano pior que o cap global que esta etapa veio consertar. */
  await writeStore(upsertEm(await readStoreRaw(), entry));
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
    // Toda tentativa de reexecutar, inclusive a que não voltou. Uma resposta
    // perdida não prova que a execução não começou, então o registro nasce
    // antes da chamada e a tela precisa poder mostrar esse estado.
    retries: run.retries || [],
    // De qual fluxo é a execução que tem o lead esperando. Num caso de
    // sub-fluxo a correção foi no filho e a execução é do PAI.
    retryWfId: retryTargetWf(run),
    log: run.log
  };
}

/* A execução que tem o lead esperando é a do fluxo que RODOU, não a do fluxo que
   foi corrigido. Quando `followSubWorkflow` redirecionou, o diff aplicado é do
   filho e quem executou é o pai — e o filho corrigido é carregado em runtime,
   então reexecutar o pai já entra com a correção. Conferir contra `run.wfId`
   recusaria justamente os casos de sub-fluxo, que são a maioria dos que
   importam aqui. */
function retryTargetWf(run) {
  return String((run.redirected && run.redirected.fromId) || run.wfId || "");
}

/* ------------------------------------------------------------ claude driver */

function runClaude(run, { prompt, resume }) {
  return new Promise((resolve) => {
    /* OS ARGUMENTOS SAEM DO ADAPTADOR, e as cercas com eles. O array que estava
       escrito aqui era o mesmo do `tester.js` e o mesmo do `upgrade.js`, com as
       mesmas três flags que este repositório mediu uma a uma:
         `--disallowedTools`   `--allowedTools` só AUTO-APROVA e não restringe
                               (medido 2026-08-07: uma sessão com exatamente
                               `Read,Write,Edit,Glob,Grep` executou shell). A
                               afirmação "no Bash, no network" deste arquivo só é
                               verdade por causa dela;
         `--setting-sources ""`  sem ela a sessão carrega o `CLAUDE.md` global,
                               que nesta máquina tem a chave da API do n8n em
                               texto puro (medido em `iso-check.js`);
         `--strict-mcp-config` + `--mcp-config '{"mcpServers":{}}'`  sem ela a
                               sessão sobe todo MCP configurado e paga no boot.
       Nenhuma some na tradução: no `ia.js` elas são DADO na tabela do provedor, e
       um provedor sem as três é recusado por nome antes de virar spawn.

       `negadas` NÃO é passado de propósito: o default do adaptador é o FECHADO
       (`NEGADAS_SEM_REDE`), que é byte a byte a lista que estava escrita aqui.
       Quem quer rede pede rede, e esta sessão nunca pediu.

       `tetoPrompt` é uma RECUSA QUE NÃO EXISTIA NESTE ARQUIVO. Antes, um prompt
       grande daqui morria com `spawn ENAMETOOLONG`, que não nomeia nem o prompt
       nem o tamanho e manda quem lê procurar problema de caminho de arquivo. O
       número é o `ia.PROMPT_MAX` (24000, o mesmo do `upgrade.js`) em vez de um
       terceiro literal solto. Medido: o prompt da rodada 1 daqui é constante e
       tem ~450 caracteres, e o da retentativa é a lista de portões reprovados —
       nenhum dos dois chega perto do teto. */
    const mont = ia.argumentosDaRodada({
      escolha: escolhaDaRodada(),
      prompt,
      ferramentas: "Read,Write,Edit,Glob,Grep",
      modelo: process.env.COCKPIT_CLAUDE_MODEL || readEnv("COCKPIT_CLAUDE_MODEL") || null,
      resumeId: resume || null,
      tetoPrompt: ia.PROMPT_MAX
    });
    if (!mont.ok) {
      /* Montagem recusada NÃO vira spawn. O formato é o que este caminho já usa
         — `{ok:false, sessionId, error}` — porque quem chama trata `res.ok` e
         guarda `res.error`; inventar um formato novo aqui faria a rodada morrer
         num `undefined` em vez de numa frase. */
      resolve({ ok: false, sessionId: resume || null, error: mont.erro });
      return;
    }

    const child = spawn(CLAUDE_BIN, mont.args, {
      cwd: run.dir,
      windowsHide: true,
      // stdin fechado. Com um pipe aberto e vazio o CLI espera 3s por dados em
      // TODA rodada e depois escreve um aviso no stderr, que subia para o log
      // como se algo tivesse dado errado. O prompt vai por `-p`; não há stdin.
      stdio: ["ignore", "pipe", "pipe"],
      /* Allowlist, não espalhamento. Aqui havia `{ ...process.env, N8N_API_KEY: "" }`,
         que cegava UMA variável e deixava passar todo o resto: medido 24/08/2026
         nesta máquina, 69 das 87 atravessavam — inclusive `CLAUDE_CODE_MESSAGING_TOKEN`,
         que é credencial viva, e a cadeia `GIT_ASKPASS`, que aponta para o script
         que o git chama para pedir senha. Esta é a sessão que escreve patch em
         fluxo de produção a partir de um prompt onde texto de estranho já chega
         íntegro, então o ambiente dela é superfície de ataque e não configuração.

         A lista continua morando no `ambiente.js`; quem monta em cima dela agora
         é o `ia.js`, e a diferença é uma só e ela é do FUTURO: no modo `chave` o
         adaptador acrescenta a chave de API do provedor escolhido, numa linha, e
         só dele. No modo `plano` — o de hoje, e o padrão — `ANTHROPIC_API_KEY`
         fica AUSENTE do objeto, não presente e vazia: uma variável que não existe
         não precisa ser lembrada.

         O CARIMBO viaja como parâmetro porque ele diz QUEM spawnou, e isso é
         próprio de cada caminho: um carimbo único faria as três abas virarem uma
         só no que quer que leia esse campo. Este é `cockpit`, o mesmo de sempre. */
      env: ia.ambienteDaRodada({ escolha: escolhaDaRodada(), carimbo: "cockpit" })
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
/* `pinData` é DADO DE EXECUÇÃO, não estrutura de fluxo — é o payload que alguém
   fixou no editor do n8n para testar um nó, e nesta instância isso significa
   conversa de lead, telefone e chave de sessão.

   MEDIDO em 24/08/2026, antes desta linha existir: 6 cópias de fluxo na pasta que
   a sessão headless LÊ carregavam 8,6 KB de `pinData`, com telefone cru dentro.
   Ou seja, dado de cliente entrando no contexto de um modelo — pela função que
   existe exatamente para impedir isso. E o preço é maior no produto distribuído:
   num plano que treina, aquele conteúdo fica.

   Vale para as TRÊS portas de uma vez, e isso foi conferido: `claude-fix` (a
   pasta da correção), `upgrade.js` nos dois sítios, e `dossie.js` todos passam
   por aqui. Se cada uma montasse a sua limpeza, seriam três correções.

   Remover é seguro e NÃO apaga nada do fluxo vivo — conferido no `writeBody` do
   `n8n.js`, que monta o corpo do `PUT` com exatamente `name`, `nodes`,
   `connections` e `settings`. `pinData` nunca volta para a instância, então a
   cópia limpa não pode levar embora o que a pessoa fixou no editor.

   ESTA LIMPEZA É PARA FRENTE, e isso precisa estar escrito porque sem a frase
   alguém lê `PAYLOAD_KEY` e conclui que o problema acabou. Os 6 arquivos que já
   estavam em `.claude-runs/` no dia da medição CONTINUAM LÁ até alguém apagar —
   nenhum diretório de corrida tem expurgo, e o total media 33,7 MB crescendo
   desde 06/08. Apagar é decisão do Kauan e não nossa: são regeneráveis do ponto
   de vista de perda e são evidência do ponto de vista de dimensionar exposição,
   e o `_private/` ao lado carrega credencial.

   O que dá para afirmar sobre o risco daqueles seis, conferido no fonte: eles são
   dado PARADO, não exposição viva. O único `spawn` de sessão nasce em `drive()`,
   que tem um chamador só, dentro de `start()`, que cria o diretório novo naquela
   mesma chamada. Uma corrida reidratada por `rehydrate` aponta para o diretório
   antigo, mas volta como `ready` e não chega a rodada nenhuma; `approve` e
   `retry` não abrem sessão. Então o payload velho não volta para o contexto de
   um modelo — ele só está no disco. Ruim, e menos urgente que o contrário. */
const PAYLOAD_KEY = /^pinData$/;

function sanitizedWorkflow(raw) {
  const w = redactWorkflow(raw);
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (CRED_KEY.test(k) || PAYLOAD_KEY.test(k)) continue;
        o[k] = walk(val);
      }
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
/* Só a leitura, separada porque `escreverAprovado()` recebe o patch já lido —
   ele não conhece run nenhuma, e portanto não conhece diretório de run. */
async function lerPatch(dir) {
  try {
    return { ok: true, patch: JSON.parse(await fsp.readFile(path.join(dir, "patch.json"), "utf8")) };
  } catch (err) {
    return { ok: false, error: err.code === "ENOENT" ? "patch.json não foi criado" : "patch.json não é JSON válido: " + err.message };
  }
}

async function buildProposal(run, raw) {
  const lido = await lerPatch(run.dir);
  if (!lido.ok) return { ok: false, error: lido.error };
  const patch = lido.patch;
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
  /* O dono é o MESMO nos dois ramos: é a mesma escrita lógica, e na primeira vez
     ela é um POST só porque a cópia ainda não existe. Ver n8n.js `writeOwner`. */
  const owner = n8n.writeOwner("fix", run.id, "testando a correção numa cópia de " + (run.wfName || run.wfId));
  if (id) {
    await n8n.putWorkflow(owner, id, body, dropped => sayDropped(run, dropped));
  } else {
    const created = await n8n.createWorkflow(owner, body, dropped => sayDropped(run, dropped));
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

/* O `kind` entra aqui porque a mediana é o denominador de uma barra na tela, e
   as duas coisas não duram o mesmo tanto: uma correção típica são ~183s medidos,
   um upgrade é conversa mais patch. Misturar faria a barra mentir para os dois
   lados — e para baixo justamente no caso mais lento, que é quando alguém olha. */
async function estimate(kind) {
  const list = await readStore(kind);
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
    activity: null, tools: {}, eta: await estimate("fix"),
    startedAt: new Date().toISOString(), finishedAt: null, appliedAt: null, revertedAt: null,
    capturedUpdatedAt: null, sandboxId: null, sessionId: null, child: null,
    retries: []
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
    /* Toda linha nova nasce tipada. Ver `kindOf` acima: só o legado no disco
       depende do fallback. */
    kind: "fix",
    runId: run.id, key: run.key, wfId: run.wfId, wfName: run.wfName, redirected: run.redirected,
    status: run.status, gates: run.gates, summary: run.diff ? run.diff.summary : null,
    report: run.report, fixNote: fixNote(run), sandbox: run.sandbox, error: run.error, cost: run.cost,
    startedAt: run.startedAt, finishedAt: run.finishedAt,
    appliedAt: run.appliedAt, revertedAt: run.revertedAt,
    capturedUpdatedAt: run.capturedUpdatedAt,
    /* Entra no ledger em git porque é o registro de que uma mensagem saiu para
       um lead. `proposals.json` já é "o que o cockpit propôs e o que o Kauan
       decidiu"; reexecutar é uma decisão, e a única sem desfazer. */
    retries: run.retries || []
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
  const list = (await readStore("fix")).filter(p => p.status === "ready").slice(-REHYDRATE_CAP);
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
      /* O histórico volta, mas o status não: um run reidratado renasce como
         `ready`, então reexecutar por ele é recusado até ser aplicado de novo.
         É o certo — depois de reiniciar o cockpit, ninguém tem na tela o diff
         que autorizaria mandar mensagem para um lead. */
      retries: Array.isArray(p.retries) ? p.retries : [],
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

/* ══════════════════════════ O ÚNICO CAMINHO DE ESCRITA APROVADA ════════════
 *
 * ETAPA 2 de quatro (PLAN-UPGRADE.md §6.1). A aba Upgrade vai escrever em fluxo
 * vivo, e a rodada 1 da revisão derrubou a ideia de "reusar `approve()` inteiro":
 * `approve` é acoplado ao ciclo de vida daqui — `runs.get`, `status === "ready"`,
 * `buildProposal(run, …)`, `backupPath(run)`, o store, o `emit`. Uma SEGUNDA cópia
 * da sequência que escreve em produção é inaceitável: as duas divergem no primeiro
 * conserto feito num lado só, e o lado que divergir escreve em fluxo trafegado.
 *
 * Então o que se compartilha é a SEQUÊNCIA, e ela não conhece run nenhuma:
 *
 *   1. re-busca o workflow;
 *   2. RECUSA se `updatedAt` mudou — o diff que estava na tela deixou de
 *      descrever o que vai acontecer;
 *   3. reaplica o patch ao documento ATUAL, nunca à cópia de quando a proposta
 *      nasceu;
 *   4. roda os portões de novo — eles valem no momento de aplicar, não só no de
 *      propor;
 *   5. grava o backup;
 *   6. `PUT` com o corpo montado campo por campo.
 *
 * A ORDEM É A GARANTIA, não uma preferência de leitura. Portões antes do backup
 * (não se guarda cópia de algo que não vai ser escrito), backup antes do `PUT`
 * (é a origem do `↺ Desfazer`), e o `PUT` por último e SEM RETRY — escrita que
 * falhou prova ausência de confirmação, não ausência de efeito.
 *
 * `revalidar` é injetado e NÃO tem default. Aqui ele é `validate` (os 10
 * portões); a aba Upgrade roda a bateria de sete, cuja checagem 1 são esses
 * mesmos 10. Um default cairia nos 10 quando a aba esquecesse de passar a
 * bateria — e um upgrade aprovado por portão de correção é exatamente a
 * divergência que esta extração existe para impedir. O primitivo é dono da
 * mecânica; quem julga é quem chama.
 *
 * Mora neste arquivo, e não num `escrever.js`, porque depende de `applyPatch` e
 * porque `tester.js` já importa daqui — mover código de escrita de produção para
 * um módulo novo é risco próprio, e a ordem desta etapa existe justamente para
 * não somar riscos. Se um dia a aba Upgrade não precisar mais de nada daqui, é aí
 * que a mudança de casa fica barata.
 *
 * `revert()` NÃO passa por aqui, e isso não é esquecimento: ele restaura um
 * backup literal — não re-busca, não aplica patch, não tem portão para rodar.
 * Forçá-lo nesta sequência exigiria inventar um patch que ele não tem. */
async function escreverAprovado({ owner, wfId, capturedUpdatedAt, patch, revalidar, backupPath, onSettingsDropped }) {
  if (!wfId) throw new Error("escreverAprovado: falta `wfId`");
  if (!patch || typeof patch !== "object") throw new Error("escreverAprovado: falta `patch` (o objeto já lido, não o caminho)");
  if (typeof revalidar !== "function") throw new Error("escreverAprovado: falta `revalidar` — quem escreve declara com que portões, não há default");
  if (!backupPath) throw new Error("escreverAprovado: falta `backupPath` — sem backup não existe ↺ Desfazer");

  /* A REGIÃO INTEIRA segura a vez de escrever (etapa 3), não só o `PUT`. Sem
     isso outro dono escreveria ENTRE a revalidação dos portões e o `PUT`, e o
     documento gravado deixaria de ser o que os portões aprovaram — a única
     garantia que este caminho dá. A fila é reentrante por dono, então o `PUT` lá
     embaixo reentra em vez de esperar por si mesmo; é também o que permite a um
     portão que escreve (a checagem 7 da aba Upgrade grava a cópia sandbox)
     rodar aqui dentro sem travar. */
  return n8n.comEscrita(owner, () => sequenciaAprovada({
    owner, wfId, capturedUpdatedAt, patch, revalidar, backupPath, onSettingsDropped
  }));
}

async function sequenciaAprovada({ owner, wfId, capturedUpdatedAt, patch, revalidar, backupPath, onSettingsDropped }) {
  const current = await n8n.getRawWorkflow(wfId);

  // Fail-closed: o fluxo mudou depois que a proposta foi montada.
  if (capturedUpdatedAt && current.updatedAt && current.updatedAt !== capturedUpdatedAt) {
    throw Object.assign(new Error("o fluxo mudou no n8n depois desta proposta (" + current.updatedAt + ") — rode de novo para revisar em cima do estado atual"), { status: 409 });
  }

  const { workflow: proposto, errors } = applyPatch(current, patch);
  if (errors.length) throw new Error(errors.join(" · "));

  /* AWAIT: `validate` é síncrona e passa por aqui inalterada (await sobre não-promessa
     é identidade), mas a bateria de sete da aba Upgrade é assíncrona — a checagem 7
     grava a cópia `[SANDBOX upgrade]`, que é uma escrita reentrante dentro desta
     mesma região. Sem o await, `v` seria a Promise, `v.ok` viria `undefined` e o
     approve do Upgrade falharia SEMPRE, com a frase de portão reprovado — culpando a
     proposta por um defeito da chamada. Falha fechada, e por isso silenciosa. */
  const v = await revalidar(current, proposto);
  if (!v.ok) {
    // Os vereditos sobem no erro: quem chama é que tem onde guardá-los.
    throw Object.assign(new Error("a proposta não passa mais nas portas de validação"), { status: 409, gates: v.gates });
  }

  await fsp.writeFile(backupPath, JSON.stringify(current, null, 2), "utf8");
  await n8n.putWorkflow(owner, wfId, {
    name: current.name,
    nodes: proposto.nodes,
    connections: proposto.connections,
    settings: proposto.settings || current.settings || { executionOrder: "v1" }
  }, onSettingsDropped);

  return { current, proposto, gates: v.gates };
}

/* ------------------------------------------------------- approve / revert */

// A ÚNICA porta de escrita no fluxo real. Chega aqui só com o Kauan tendo
// clicado em cima de um diff que já estava na tela.
async function approve(runId) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error("run desconhecido"), { status: 404 });
  if (run.status !== "ready") throw Object.assign(new Error("esta proposta não está pronta (" + run.status + ")"), { status: 409 });

  const lido = await lerPatch(run.dir);
  if (!lido.ok) throw new Error(lido.error);

  /* A sequência inteira — re-busca, recusa por `updatedAt`, reaplica sobre o
     estado ATUAL, portões de novo, backup, `PUT` — vive em `escreverAprovado`,
     que a aba Upgrade vai chamar também. Duas cópias dela é o que a etapa 2
     existe para não deixar acontecer. */
  try {
    await escreverAprovado({
      owner: n8n.writeOwner("fix", run.id, "aplicando correção em " + (run.wfName || run.wfId)),
      wfId: run.wfId,
      capturedUpdatedAt: run.capturedUpdatedAt,
      patch: lido.patch,
      revalidar: validate,
      backupPath: backupPath(run),
      onSettingsDropped: dropped => sayDropped(run, dropped)
    });
  } catch (err) {
    // Os vereditos voltam no erro porque só a run tem onde guardá-los.
    if (err && err.gates) run.gates = err.gates;
    throw err;
  }

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
  const owner = n8n.writeOwner("fix", run.id, "desfazendo a correção em " + (run.wfName || run.wfId));
  await n8n.putWorkflow(owner, run.wfId, {
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

/* Reexecuta a execução que falhou, com o fluxo já corrigido.
 *
 * É a única coisa neste arquivo cujo efeito sai da instância: manda mensagem
 * para pessoa de verdade. Não existe desfazer, e por isso as travas aqui são
 * mais duras que as de `approve` — lá o pior caso é um documento errado que
 * `↺ Desfazer` conserta.
 *
 * O que o retry faz e não faz está no comentário de `n8n.retryExecution`; o
 * resumo é que ele RETOMA do nó que falhou, então o que já rodou não repete. */
async function retry(runId, execId) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error("run desconhecido"), { status: 404 });

  // Reexecutar antes de aplicar rodaria com o defeito ainda no fluxo, e depois
  // de desfazer rodaria com o defeito de volta. As duas frases são diferentes
  // porque as duas decisões são diferentes.
  if (run.status === "reverted") {
    throw Object.assign(new Error("a correção foi desfeita — reexecutar agora rodaria com o defeito de volta no fluxo"), { status: 409 });
  }
  if (run.status !== "applied") {
    throw Object.assign(new Error("a correção ainda não foi aplicada (" + run.status + ") — reexecutar agora rodaria com o defeito ainda no fluxo"), { status: 409 });
  }

  const id = String(execId || "");
  if (!/^\d{1,20}$/.test(id)) throw Object.assign(new Error("id de execução inválido"), { status: 400 });

  run.retries = run.retries || [];

  /* A trava que mais importa, e ela é contra o duplo clique — não contra um
     atacante. Dois cliques em cima do mesmo botão são duas mensagens para o
     mesmo lead, e é o defeito que esta feature está aqui para não causar.
     `enviado` (resposta não voltou) também bloqueia: repetir uma escrita que
     talvez tenha chegado é exatamente o que `request` se recusa a fazer. */
  const antes = run.retries.find(r => r.execId === id && r.state !== "erro");
  if (antes) {
    throw Object.assign(new Error(
      antes.state === "ok"
        ? "esta execução já foi reexecutada (virou a execução " + antes.newExecId + ")"
        : "já existe uma reexecução desta execução em voo e a resposta não voltou — confira no n8n antes de mandar outra"
    ), { status: 409 });
  }

  /* Fail-closed contra o id que veio do cliente. A tela manda `newestSampleId`,
     mas o servidor não escreve com base no que a página afirmou: confere de qual
     fluxo a execução é e se ela de fato falhou. */
  const alvo = retryTargetWf(run);
  let row;
  try {
    row = await n8n.getExecRow(id);
  } catch (err) {
    throw Object.assign(new Error("não consegui ler a execução " + id + " no n8n: " + err.message), { status: 502 });
  }
  if (row.workflowId && alvo && row.workflowId !== alvo) {
    throw Object.assign(new Error("a execução " + id + " é do fluxo " + row.workflowId + ", e esta correção é sobre " + alvo), { status: 409 });
  }
  if (row.status !== "error" && row.status !== "crashed") {
    throw Object.assign(new Error("a execução " + id + " está como \"" + row.status + "\" — só uma que falhou pode ser reexecutada"), { status: 409 });
  }

  /* O registro nasce ANTES da chamada, e é persistido antes. Se a resposta se
     perder, o que fica escrito é "tentei e não sei o que houve" — que é a
     verdade. Gravar só no sucesso deixaria uma mensagem enviada sem nenhum
     rastro, e o próximo clique a enviaria de novo. */
  const entry = { execId: id, wfId: alvo, at: new Date().toISOString(), state: "enviado", newExecId: null, error: null };
  run.retries.push(entry);
  say(run, "reexecutando a execução " + id + " com o fluxo já corrigido", "warn");
  emit(run, { t: "state", status: run.status });
  await persist(run);

  let nova;
  try {
    nova = await n8n.retryExecution(id, { loadWorkflow: true });
  } catch (err) {
    /* Nem toda falha é igual, e a diferença decide se tentar de novo é seguro.
       `request` só carimba `err.status` quando o n8n RESPONDEU e recusou — aí a
       requisição chegou, foi rejeitada e nada rodou, então tentar de novo é
       limpo. Sem status, o fetch morreu antes da resposta: pode ter começado.
       Tratar os dois como "erro" liberava a segunda tentativa justamente no caso
       em que ela duplica a mensagem. */
    const respondeu = Number.isFinite(err && err.status);
    entry.state = respondeu ? "erro" : "incerto";
    entry.error = String(err.message || err).slice(0, 300);
    say(run, "a reexecução da execução " + id + " não foi confirmada: " + entry.error, "bad");
    emit(run, { t: "state", status: run.status });
    await persist(run);

    if (respondeu) {
      throw Object.assign(new Error(
        "o n8n recusou a reexecução: " + entry.error + " — nada rodou, dá para tentar de novo"
      ), { status: 502 });
    }
    // 409, não 502: o estado é indefinido, e a tela usa esse código para NÃO
    // oferecer o botão de tentar de novo.
    throw Object.assign(new Error(
      "não consegui confirmar a reexecução: " + entry.error
      + " — uma resposta perdida não prova que ela não começou, confira a execução " + id + " no n8n antes de tentar de novo"
    ), { status: 409 });
  }

  entry.state = "ok";
  entry.newExecId = nova && nova.id ? String(nova.id) : null;
  say(run, "reexecução disparada" + (entry.newExecId ? " — virou a execução " + entry.newExecId : ""), "good");
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
  /* `configured` era `const configured = n8n.configured` CONGELADO no topo deste
     arquivo — o valor do instante em que o módulo foi carregado, que nunca mais
     acompanhava a instância. Medido por grep: NINGUÉM consome
     `claudeFix.configured` hoje (os 14 usos de `.configured` no repositório são
     todos de `n8n.configured`), então era contrato morto.
     Vira GETTER em vez de sumir, e a direção é a regra que este repositório já
     escreveu sete vezes: campo ausente cai no ramo negativo, e o ramo negativo
     de um booleano chamado `configured` é o que SUB-AVISA — a tela diria "o n8n
     não está configurado" por causa de uma chave que ninguém apagou, ela só
     deixou de ser exportada. Como getter, ele passa a responder o que a
     instância responde AGORA. */
  get configured() { return n8n.configured; },
  claudeFound, claudeBin: CLAUDE_BIN, sandboxEnabled: SANDBOX_TEST,
  /* OS TRÊS ESTADOS DA DESCOBERTA, que `claudeFound` não sabe dizer.
     `claudeAchado` é `true | false | null`: achei / você apontou `CLAUDE_BIN` e
     lá não tem nada / não deu para procurar (sobra o nome nu no PATH, e sobre um
     nome nu `existsSync` não responde). `claudePorque` é a frase de fato, já
     nomeando a variável que conserta. Saem daqui para o `integracoes.js` poder
     dizer "não sei" em vez de "não tem" — a distinção que ele já tem ramo para
     mostrar e que hoje é inalcançável, porque `claudeFound` é booleano. */
  claudeAchado: ACHEI_CLAUDE.achado, claudePorque: ACHEI_CLAUDE.porque,
  start, get, subscribe, approve, reject, revert, readStore, rehydrate,
  // o único efeito sem desfazer — leia o comentário de `retry` antes de chamar
  retry,
  // exportados para teste
  validate, applyPatch, diffWorkflow, redactWorkflow, sanitizedWorkflow, nodesIndex, targetNodes, scrub, fixNote, estimate,
  /* O ledger de dois tipos (etapa 1). `readStoreRaw` NÃO sai: ler cru é
     privilégio de quem reescreve, e exportá-lo seria oferecer a mistura para
     quem só quer um tipo. As três puras saem para o teste poder provar o cap sem
     escrever no arquivo que o cockpit usa. */
  kindOf, trimPorTipo, upsertEm, upsertStore, LEDGER_KINDS, STORE_CAP,
  /* O único caminho de escrita aprovada (etapa 2). Sai daqui porque a aba
     Upgrade tem de chamar ESTE, não uma segunda cópia da sequência. */
  escreverAprovado, lerPatch,
  /* `runs` sai daqui pelo mesmo motivo que `sessions` sai de `tester.js`: as
     travas de `retry` SÃO a máquina de estados, e reimplementá-la no teste
     provaria a cópia, não o original. */
  retryTargetWf, runs,
  /* Exportada só para o `ia-fiacao-test.js`, que troca `child_process.spawn` por
     um filho falso ANTES de exigir este módulo e depois chama esta função de
     verdade. Mesmo motivo do `rodar` do `upgrade.js`: o que aquele teste prova é
     a LIGAÇÃO — que os argumentos e o ambiente que chegam ao spawn são os que o
     adaptador montou. Remontar o array por fora provaria a cópia, não o produto.
     Não spawna CLI de verdade sob o dublê e não fala com o n8n. */
  runClaude
};
