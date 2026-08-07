// n8n client for the cockpit.
//
// SECURITY BOUNDARY. The raw n8n API carries things that must never leave this
// process: credential ids/names, node parameters (session keys built from lead
// phone/email), and full per-node execution payloads (real conversations).
// Every response is passed through an explicit field whitelist BEFORE it is
// cached or served. If a field is not named in an extract* function below, it
// does not exist as far as the rest of the system is concerned.
//
// FACTS ONLY. Nothing here decides a flow is healthy, stale or risky.
// All judgement lives in flows.html.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const CFG_FILES = [".env", ".env.local"];
const WINDOW_HOURS = 24;
const BACKFILL_MAX_PAGES = 6;      // 250 rows/page; ~9h/page at current volume
const PAGE_SIZE = 250;
const WORKFLOWS_TTL_MS = 5 * 60 * 1000;
const GRAPH_TTL_MS = 10 * 60 * 1000;
const EXEC_CACHE_CAP = 600;        // extracted executions kept on disk
const MSG_CAP = 400;               // truncate error strings
// Detail costs one ?includeData=true fetch of a multi-MB payload per errored
// execution, serialized behind MAX_INFLIGHT. On a bad day (dozens of failures)
// an uncapped loop would hold /overview open for a minute on every refresh.
const ERROR_DETAIL_CAP = 40;

const EXEC_CACHE_FILE = path.join(__dirname, ".cache-n8n-exec.json");

/* ------------------------------------------------------------------- config */

function loadConfig() {
  const env = { ...process.env };
  for (const f of CFG_FILES) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const base = (env.N8N_BASE_URL || "").replace(/\/+$/, "");
  return { baseUrl: base, apiKey: env.N8N_API_KEY || "" };
}

const cfg = loadConfig();
const configured = !!(cfg.baseUrl && cfg.apiKey);

/* ---------------------------------------------------------------- transport */

let inFlight = 0;
const MAX_INFLIGHT = 4;

async function api(pathname, params = {}) {
  return request("GET", pathname, { params });
}

// `method`/`body` existem só para o caminho de escrita abaixo. Um PUT NÃO é
// re-tentado: repetir uma escrita que talvez tenha chegado é pior que devolver
// o erro — só GET entra no laço de retry.
async function request(method, pathname, { params = {}, body = null } = {}) {
  if (!configured) throw new Error("n8n não configurado: falta N8N_BASE_URL ou N8N_API_KEY em .env");

  while (inFlight >= MAX_INFLIGHT) await new Promise(r => setTimeout(r, 60));
  inFlight++;
  try {
    const url = new URL(cfg.baseUrl + pathname);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));

    const idempotent = method === "GET";
    const attempts = idempotent ? 3 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), body ? 60000 : 25000);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            "X-N8N-API-KEY": cfg.apiKey,
            accept: "application/json",
            ...(body ? { "content-type": "application/json" } : {})
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctl.signal
        });
      } finally { clearTimeout(timer); }

      if (idempotent && (res.status === 429 || res.status >= 500)) {
        if (attempt === attempts - 1) throw new Error(`n8n ${res.status} em ${pathname}`);
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        // Carrega o status para o servidor não transformar um 404 do n8n num
        // 500 nosso — a causa é "não existe", não "quebramos". Numa escrita o
        // corpo da resposta é o que diz QUAL campo o n8n recusou, então ele
        // entra na mensagem em vez de ser descartado.
        let extra = "";
        if (!idempotent) {
          try { extra = ": " + (await res.text()).slice(0, 400); } catch { /* corpo ilegível */ }
        }
        const err = new Error(`n8n ${res.status} em ${pathname}${extra}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    }
  } finally { inFlight--; }
}

/* --------------------------------------------------------------- whitelists */

const clip = s => (typeof s === "string" ? s.slice(0, MSG_CAP) : null);
const num = n => (typeof n === "number" && Number.isFinite(n) ? n : null);

// Trigger types are how a flow gets woken up — a fact worth surfacing, and the
// node *type* string carries no user data (unlike node parameters).
function triggerTypes(nodes) {
  const out = new Set();
  for (const n of nodes || []) {
    const t = String(n.type || "");
    if (/trigger|webhook|cron|schedule|executeWorkflowTrigger|formTrigger/i.test(t)) out.add(t);
  }
  return [...out];
}

function extractWorkflow(w) {
  return {
    id: String(w.id),
    name: String(w.name ?? ""),
    active: !!w.active,
    createdAt: w.createdAt ?? null,
    updatedAt: w.updatedAt ?? null,
    nodeCount: Array.isArray(w.nodes) ? w.nodes.length : null,
    triggers: triggerTypes(w.nodes),
    tags: (w.tags || []).map(t => String(t.name ?? "")).filter(Boolean)
  };
}

// Node positions in real workflows can be anywhere (observed: [-14480, 976]).
// Coordinates are emitted raw; normalization is the renderer's job.
/* Subtítulo do nó, do jeito que o editor do n8n escreve embaixo do nome
   ("update: row", "get", "transcribe: audio"). NÃO é o objeto `parameters` —
   é um par de enums curtos do próprio node, filtrado por forma antes de sair
   daqui. Qualquer coisa longa, com caractere fora do conjunto, ou que não seja
   string, vira `null`: um parâmetro do cliente jamais passa por este funil.

   Esta é a única informação de `parameters` que o desenho recebe, e ela existe
   porque sem operação o rótulo do nó vira o tipo, que repete o ícone e não diz
   o que o passo faz. */
const OP_SHAPE = /^[a-zA-Z][\w .:-]{0,23}$/;
const opWord = v => (typeof v === "string" && OP_SHAPE.test(v) ? v : null);

function nodeSubtitle(n) {
  const p = n && n.parameters;
  if (!p || typeof p !== "object") return null;
  const op = opWord(p.operation), rs = opWord(p.resource), md = opWord(p.mode);
  if (op && rs) return op + ": " + rs;
  return op || (md && md !== "list" ? md : null);
}

/* Sticky note é conteúdo do fluxo: é onde está escrito o nome da etapa
   ("LOCK + CANCELAR VÁCUO"). Continua fora do bounding box da câmera — quem
   decide isso é `isAnnotation()` no cliente, e essa regra não muda — mas o
   texto precisa atravessar para o desenho poder mostrá-lo. Clipado em 300
   caracteres porque o que interessa é o título e a primeira linha. */
function stickyOf(n) {
  if (!/stickyNote/i.test(String(n.type || ""))) return null;
  const p = (n && n.parameters) || {};
  return {
    // cap próprio, não o de mensagem de erro: este texto tem outro dono e
    // outro tamanho útil, e herdar o cap alheio faria o limite mudar sozinho
    // no dia em que `MSG_CAP` mudar.
    content: typeof p.content === "string" ? p.content.slice(0, 300) : null,
    w: num(p.width) ?? 240,
    h: num(p.height) ?? 160,
    color: num(p.color) ?? 1
  };
}

function extractGraph(w) {
  const nodes = (w.nodes || []).map(n => ({
    name: String(n.name ?? ""),
    type: String(n.type ?? ""),
    x: num(n.position?.[0]) ?? 0,
    y: num(n.position?.[1]) ?? 0,
    disabled: !!n.disabled,
    sub: nodeSubtitle(n),
    sticky: stickyOf(n)
  }));
  const known = new Set(nodes.map(n => n.name));

  const edges = [];
  for (const [from, outs] of Object.entries(w.connections || {})) {
    for (const [port, branches] of Object.entries(outs || {})) {
      (branches || []).forEach((branch, bi) => (branch || []).forEach(c => {
        const to = String(c?.node ?? "");
        if (known.has(from) && known.has(to)) edges.push({ from, to, port: String(port), branch: bi });
      }));
    }
  }
  return { id: String(w.id), name: String(w.name ?? ""), active: !!w.active, nodes, edges };
}

// Summary row from the executions list. No payload is present at this level.
function extractExecRow(e) {
  const started = e.startedAt ?? null;
  const stopped = e.stoppedAt ?? null;
  return {
    id: String(e.id),
    workflowId: e.workflowId != null ? String(e.workflowId) : null,
    status: String(e.status ?? ""),
    mode: String(e.mode ?? ""),
    startedAt: started,
    stoppedAt: stopped,
    ms: started && stopped ? new Date(stopped) - new Date(started) : null,
    retryOf: e.retryOf != null ? String(e.retryOf) : null,
    waiting: !!e.waitTill
  };
}

// Detail from ?includeData=true. This is the dangerous one: `error.node` holds
// `parameters` and `credentials`, and every runData task holds `data`. Only the
// named fields below survive.
/* A FORMA da saída de um nó, nunca o conteúdo.
 *
 * `runData[nó][].data` é a conversa real do lead: texto de WhatsApp, telefone,
 * e-mail, o que o agente respondeu. Isso não atravessa e não vai atravessar.
 * O que atravessa é o formato: quantos itens saíram, os NOMES dos campos, e se
 * havia binário (áudio, imagem, PDF). Com isso a tela consegue dizer "gravou 1
 * linha com id, telefone e status" ou "produziu 1 áudio" — que é a diferença
 * entre "rodou" e "fez o quê" — sem mostrar um caractere do que foi dito.
 *
 * Os nomes de campo passam por forma (`KEY_SHAPE`): num nó de Code o autor pode
 * ter usado o texto como chave, e é a única maneira de conteúdo escapar por
 * aqui. Chave torta é descartada, não truncada. */
const KEY_SHAPE = /^[A-Za-z_$][\w .$-]{0,38}$/;
const KEY_CAP = 12;

/* ------------------------------------------------------------- A AMOSTRA
 *
 * Mudança deliberada de fronteira, pedida pelo Kauan em 2026-08-07: "o resumo
 * pode vir 'fluxo enviou a mensagem X para o lead tal'". Até aqui NENHUM valor
 * de payload saía deste módulo; agora sai um recorte, e as regras do recorte
 * são estas:
 *
 *   1. Só campos NOMEADOS abaixo. O payload inteiro continua fora — não existe
 *      caminho que devolva `json` cru.
 *   2. O texto da mensagem passa (é o que responde a pergunta), cortado.
 *   3. **Telefone e e-mail são mascarados sempre**, inclusive quando aparecem
 *      dentro do texto: `+55 41 *****-1395`, `k****@dominio.com`. Basta para
 *      reconhecer o lead sem publicar o contato dele numa tela que fica aberta.
 *   4. Objeto e array não passam. Só string, número e booleano.
 *
 * O que isso NÃO é: uma janela para o payload. Um campo que não esteja na lista
 * não aparece, e um valor gigante é cortado, não paginado. */
/* Os campos que interessam vivem ANINHADOS no payload real. Medido no fluxo do
   Iago: `contact.profile.name`, `contact.wa_id`, `message.text.body`, e no nó
   seguinte `contato-name`, `contato-wpp`, `contato-msg`. Olhar só o primeiro
   nível — que era o que a primeira versão fazia — não encontrava nada e a tela
   ficava muda justamente nos fluxos que mais importam.

   A varredura é em LARGURA até 4 níveis: campo raso ganha de campo fundo, que é
   o que evita pegar o `name` de um objeto de metadados no lugar do nome do
   lead. Continua sendo whitelist de nomes — o que muda é onde ela procura. */
const SAMPLE_MSG  = /^(text|body|message|mensagem|texto|content|caption|resposta|reply|output|answer|conversation|prompt|question|assunto|subject|contato-msg)$/i;
/* Nome de PESSOA e nome de COISA usam a mesma palavra. Medido: pegar qualquer
   `name` fez o resumo chamar o lead de "Performance Shopee – Turma 5", que é o
   nome do evento. Então há dois níveis: campos que só existem para pessoa
   (`full_name`, `pushname`, `contato-name`) e o genérico `name`/`nome`, que só
   vale quando o objeto que o contém é de pessoa (`contact.profile.name`). */
const SAMPLE_NAME = /^(full_?name|pushname|notifyname|profile_?name|contato-name|lead_?name|contact_?name|cliente)$/i;
const SAMPLE_NAME_WEAK = /^(name|nome)$/i;
const NAME_PARENT = /^(contact|contato|profile|perfil|lead|cliente|customer|from|sender|remetente|usuario|user)$/i;
const SAMPLE_WHO  = /^(to|from|phone|telefone|celular|numero|number|chat_?id|wa_?id|remotejid|recipient|email|e_?mail|mail|whatsapp|contato-wpp|display_phone_number)$/i;
const SAMPLE_REF  = /^(id|_id|lead_?id|task_?id|event_?id|external_?id|sku|status|stage|etapa|situacao)$/i;
const SAMPLE_TEXT_CAP = 180;
const SAMPLE_VAL_CAP = 60;
const SAMPLE_DEPTH = 4;

// Máscara aplicada a QUALQUER string que sai daqui, não só aos campos de
// contato: o telefone do lead costuma aparecer no meio do texto da mensagem, e
// mascarar só o campo `to` deixaria a porta aberta pelo lado do `text`.
function maskPII(s) {
  return String(s)
    .replace(/[\w.+-]+@([\w-]+\.[\w.-]+)/g, (m, dom) => m[0] + "****@" + dom)
    .replace(/\+?\d[\d\s().-]{8,17}\d/g, m => {
      const d = m.replace(/\D/g, "");
      if (d.length < 8) return m;
      return (m.trim().startsWith("+") ? "+" : "") + d.slice(0, d.length > 11 ? 4 : 2) + " ***** " + d.slice(-4);
    });
}

function sampleValue(v, cap) {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") return null;          // objeto e array não passam
  const s = maskPII(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
}

function sampleOf(json) {
  if (!json || typeof json !== "object") return null;
  const out = {};
  // Fila de largura: [objeto, profundidade]. Um array contribui só com o
  // primeiro elemento — a amostra é um exemplo, não um dump.
  const fila = [[json, 0, ""]];       // [objeto, profundidade, nome do pai]
  let visitados = 0;
  while (fila.length && visitados < 120) {
    const [obj, d, pai] = fila.shift();
    visitados++;
    for (const [k, v] of Object.entries(obj)) {
      if (!KEY_SHAPE.test(k)) continue;
      if (v && typeof v === "object") {
        if (d < SAMPLE_DEPTH) {
          const alvo = Array.isArray(v) ? v[0] : v;
          if (alvo && typeof alvo === "object") fila.push([alvo, d + 1, k]);
        }
        continue;
      }
      if (!out.texto && SAMPLE_MSG.test(k)) { const s = sampleValue(v, SAMPLE_TEXT_CAP); if (s) out.texto = s; }
      else if (!out.nome && (SAMPLE_NAME.test(k) || (SAMPLE_NAME_WEAK.test(k) && NAME_PARENT.test(pai)))) {
        const s = sampleValue(v, SAMPLE_VAL_CAP); if (s) out.nome = s;
      }
      else if (!out.quem && SAMPLE_WHO.test(k)) { const s = sampleValue(v, SAMPLE_VAL_CAP); if (s) out.quem = s; }
      else if (!out.ref && SAMPLE_REF.test(k)) { const s = sampleValue(v, SAMPLE_VAL_CAP); if (s) out.ref = s; }
      // `name`/`nome` solto, sem pai de pessoa: guardado à parte e usado só se
      // nada melhor aparecer na execução inteira.
      else if (!out.nomeFraco && SAMPLE_NAME_WEAK.test(k)) { const s = sampleValue(v, SAMPLE_VAL_CAP); if (s) out.nomeFraco = s; }
    }
    if (out.texto && out.nome && out.quem && out.ref) break;
  }
  return Object.keys(out).length ? out : null;
}

function shapeOf(task) {
  const main = task && task.data && task.data.main;
  if (!Array.isArray(main)) return null;
  let items = 0, binary = false, sample = null;
  const keys = [];
  for (const branch of main) {
    if (!Array.isArray(branch)) continue;
    items += branch.length;
    for (const it of branch) {
      if (!it || typeof it !== "object") continue;
      if (it.binary && typeof it.binary === "object") binary = true;
      if (!it.json || typeof it.json !== "object") continue;
      // A amostra vem do PRIMEIRO item que tiver algo reconhecível: um nó que
      // manda 40 mensagens não devolve 40 textos, devolve um exemplo.
      if (!sample) sample = sampleOf(it.json);
      if (keys.length >= KEY_CAP) continue;
      for (const k of Object.keys(it.json)) {
        if (keys.length >= KEY_CAP) break;
        if (KEY_SHAPE.test(k) && !keys.includes(k)) keys.push(k);
      }
    }
  }
  return { items, keys, binary, sample };
}

function extractExecDetail(e) {
  const rd = (e.data && e.data.resultData) || {};
  const err = rd.error || null;

  const nodes = [];
  for (const [name, tasks] of Object.entries(rd.runData || {})) {
    for (const t of Array.isArray(tasks) ? tasks : []) {
      const shape = shapeOf(t);
      nodes.push({
        name: String(name),
        index: num(t.executionIndex),
        ms: num(t.executionTime),
        startTime: num(t.startTime),
        status: t.executionStatus ? String(t.executionStatus) : null,
        // forma da saída — contagem, nomes de campo e presença de binário
        items: shape ? shape.items : null,
        keys: shape ? shape.keys : [],
        binary: shape ? shape.binary : false,
        // recorte de conteúdo: texto (cortado), contato (mascarado), referência
        sample: shape ? shape.sample : null
      });
    }
  }
  nodes.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return {
    ...extractExecRow(e),
    lastNode: rd.lastNodeExecuted ? String(rd.lastNodeExecuted) : null,
    nodeRuns: nodes,
    error: err ? {
      type: err.name ? String(err.name) : null,
      message: clip(err.message),
      description: clip(err.description),
      level: err.level ? String(err.level) : null,
      functionality: err.functionality ? String(err.functionality) : null,
      nodeName: err.node?.name ? String(err.node.name) : null,
      nodeType: err.node?.type ? String(err.node.type) : null
    } : null
  };
}

/* -------------------------------------------------------------------- state */

const state = {
  workflows: { at: 0, rows: [] },
  graphs: new Map(),                 // id -> { at, graph }
  locate: new Map(),                 // JSON.stringify([wfId, node]) -> { at, value }
  execs: new Map(),                  // id -> extracted row
  details: new Map(),                // id -> extracted detail
  lastPoll: null,
  lastError: null,
  backfilled: false
};

/* A execução terminada é imutável, então este cache nunca envelhece pelo lado do
   n8n — mas envelhece pelo lado do cockpit: quando `extractExecDetail` passa a
   extrair um campo novo, os registros gravados antes não o têm, e a tela mostra
   silenciosamente um resumo pobre para execuções antigas e completo para as
   novas. Medido: a lista "o que aconteceu" apareceu sem contagem e sem campos
   porque os detalhes vieram de um cache anterior à mudança.

   O carimbo abaixo sobe sempre que o formato do detalhe muda; o cache antigo é
   descartado inteiro em vez de ser remendado. */
const EXEC_CACHE_V = 5;

function loadExecCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(EXEC_CACHE_FILE, "utf8"));
    if (raw.v !== EXEC_CACHE_V) return;
    for (const d of raw.details || []) state.details.set(String(d.id), d);
  } catch { /* no cache yet */ }
}
loadExecCache();

let savePending = false;
async function saveExecCache() {
  if (savePending) return;
  savePending = true;
  setTimeout(async () => {
    savePending = false;
    // Finished executions are immutable, so this cache never goes stale — it
    // only needs a size cap. Keep the newest ids (n8n ids are monotonic).
    const details = [...state.details.values()]
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, EXEC_CACHE_CAP);
    state.details = new Map(details.map(d => [d.id, d]));
    try {
      await fsp.writeFile(EXEC_CACHE_FILE, JSON.stringify({ v: EXEC_CACHE_V, savedAt: new Date().toISOString(), details }), "utf8");
    } catch { /* cache is disposable */ }
  }, 2000);
}

/* ------------------------------------------------------------------ fetches */

async function getWorkflows({ force = false } = {}) {
  if (!force && Date.now() - state.workflows.at < WORKFLOWS_TTL_MS && state.workflows.rows.length) {
    return state.workflows.rows;
  }
  const rows = [];
  let cursor = null;
  do {
    const page = await api("/api/v1/workflows", { limit: PAGE_SIZE, cursor });
    for (const w of page.data || []) rows.push(extractWorkflow(w));
    cursor = page.nextCursor || null;
  } while (cursor && rows.length < 1000);

  state.workflows = { at: Date.now(), rows };
  return rows;
}

async function getGraph(id) {
  const hit = state.graphs.get(id);
  if (hit && Date.now() - hit.at < GRAPH_TTL_MS) return hit.graph;
  const w = await api(`/api/v1/workflows/${encodeURIComponent(id)}`);
  const graph = extractGraph(w);
  state.graphs.set(id, { at: Date.now(), graph });
  return graph;
}

async function getDetail(id) {
  const hit = state.details.get(String(id));
  if (hit) return hit;
  const raw = await api(`/api/v1/executions/${encodeURIComponent(id)}`, { includeData: "true" });
  const d = extractExecDetail(raw);
  if (d.status !== "running" && d.status !== "waiting") { state.details.set(d.id, d); saveExecCache(); }
  return d;
}

/* ------------------------------------------------------ onde o nó vive ---
 *
 * O n8n reporta a falha de um sub-workflow NO PAI, então `error.node.name`
 * rotineiramente nomeia um nó que não existe no grafo do fluxo que falhou.
 * Mostrar "WhatsApp API Oficial · Convert text to speech" é afirmar uma coisa
 * que não é verdade — aquele nó mora no filho.
 *
 * Isto é FATO, não juízo: está escrito no JSON dos dois workflows. Por isso sai
 * daqui. O id do filho vem de `parameters.workflowId`, que NÃO é whitelistado —
 * só o id e o nome do workflow atravessam, nunca o objeto de parâmetros.
 */
const SUBFLOW_RE = /executeWorkflow|toolWorkflow/i;
const SUBFLOW_SCAN_CAP = 6;
const LOCATE_TTL_MS = 10 * 60 * 1000;

// O n8n mudou a forma desse parâmetro entre versões: já foi string crua, hoje
// costuma ser o "resource locator" `{__rl, value, mode}`. Ler as duas é mais
// barato que descobrir na produção que a versão do nó mudou.
function subWorkflowId(node) {
  const v = (node && node.parameters || {}).workflowId;
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && typeof v.value === "string") return v.value.trim() || null;
  return null;
}

async function locateNode(wfId, nodeName) {
  const key = JSON.stringify([String(wfId), String(nodeName)]);
  const hit = state.locate.get(key);
  if (hit && Date.now() - hit.at < LOCATE_TTL_MS) return hit.value;

  const parent = await request("GET", `/api/v1/workflows/${encodeURIComponent(wfId)}`);
  const inWorkflow = (parent.nodes || []).some(n => String(n.name) === nodeName);

  const subflows = [];
  if (!inWorkflow) {
    for (const n of parent.nodes || []) {
      if (!SUBFLOW_RE.test(String(n.type))) continue;
      const id = subWorkflowId(n);
      if (!id || subflows.some(s => s.childId === id)) continue;
      if (subflows.length >= SUBFLOW_SCAN_CAP) break;
      let child = null;
      try { child = await request("GET", `/api/v1/workflows/${encodeURIComponent(id)}`); }
      catch { /* filho apagado ou sem permissão: entra como desconhecido */ }
      subflows.push({
        viaNode: String(n.name),
        childId: String(id),
        childName: child ? String(child.name ?? "") : null,
        hasNode: child ? (child.nodes || []).some(x => String(x.name) === nodeName) : null
      });
    }
  }

  const value = { wfId: String(wfId), workflowName: String(parent.name ?? ""), node: nodeName, inWorkflow, subflows };
  state.locate.set(key, { at: Date.now(), value });
  return value;
}

function windowFloor() {
  return Date.now() - WINDOW_HOURS * 3600 * 1000;
}

function pruneWindow() {
  const floor = windowFloor();
  for (const [id, row] of state.execs) {
    if (row.startedAt && new Date(row.startedAt).getTime() < floor) state.execs.delete(id);
  }
}

// Walk the cursor once at boot to fill the window. After that only page 1 is
// polled and merged by id — re-walking the cursor every tick would burn quota
// to re-read rows we already hold.
async function backfill() {
  const floor = windowFloor();
  let cursor = null;
  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    const res = await api("/api/v1/executions", { limit: PAGE_SIZE, cursor });
    const rows = (res.data || []).map(extractExecRow);
    for (const r of rows) state.execs.set(r.id, r);
    const oldest = rows.length ? rows[rows.length - 1].startedAt : null;
    cursor = res.nextCursor || null;
    if (!cursor || !oldest || new Date(oldest).getTime() < floor) break;
  }
  state.backfilled = true;
  pruneWindow();
}

// Returns the rows that are new or changed since the last tick, so the SSE
// stream stays a delta instead of resending the whole window.
async function poll() {
  if (!state.backfilled) await backfill();

  const res = await api("/api/v1/executions", { limit: PAGE_SIZE });
  const fresh = [];
  for (const raw of res.data || []) {
    const r = extractExecRow(raw);
    const prev = state.execs.get(r.id);
    if (!prev || prev.status !== r.status || prev.stoppedAt !== r.stoppedAt) fresh.push(r);
    state.execs.set(r.id, r);
  }
  pruneWindow();
  state.lastPoll = new Date().toISOString();

  // Errors are rare (observed ~5 per 9h), so pulling detail for each is cheap
  // and turns "algo falhou" into "nó X falhou com mensagem Y".
  const newDetails = [];
  for (const r of fresh) {
    if (r.status !== "error" || state.details.has(r.id)) continue;
    try { newDetails.push(await getDetail(r.id)); }
    catch (err) { state.lastError = String(err.message || err); }
  }

  return { fetchedAt: state.lastPoll, executions: fresh, errors: newDetails };
}

async function overview() {
  const workflows = await getWorkflows();
  if (!state.backfilled) await backfill();

  const executions = [...state.execs.values()].sort((a, b) => Number(b.id) - Number(a.id));

  // Backfill can surface errors that predate this process; fetch their detail
  // too, otherwise the error board is blind to anything before boot. Newest
  // first, capped — a truncated board must never read as complete.
  const errored = executions.filter(r => r.status === "error");
  const errors = [];
  for (const r of errored.slice(0, ERROR_DETAIL_CAP)) {
    try { errors.push(await getDetail(r.id)); }
    catch (err) { state.lastError = String(err.message || err); }
  }

  return {
    fetchedAt: new Date().toISOString(),
    lastPoll: state.lastPoll,
    windowHours: WINDOW_HOURS,
    instance: cfg.baseUrl,
    configured,
    workflows,
    executions,
    errors,
    errorsTotal: errored.length,
    errorsDetailed: errors.length,
    errorsTruncated: errored.length > errors.length,
    errorDetailCap: ERROR_DETAIL_CAP,
    lastError: state.lastError
  };
}

/* ============================================================== WRITE PATH ==
 *
 * Everything above this line is read-only. Everything below mutates the n8n
 * instance and exists for exactly one caller: `claude-fix.js`, on the approve
 * and revert paths, after Kauan clicked on a diff that was already rendered.
 *
 * Three rules that are not negotiable:
 *   1. No delete. There is no delete function here and there must not be one —
 *      the standing rule for this instance is add, modify or disconnect only.
 *   2. No activation. `active` is never sent, so applying a fix can never wake
 *      a dormant flow.
 *   3. No auto-apply. Nothing in this module calls these; the HTTP route does,
 *      one approved proposal at a time.
 *
 * `getRawWorkflow` is the deliberate hole in the whitelist: it returns the
 * unfiltered workflow, credentials and all. It is process-local — the server
 * never serves its output, and `claude-fix.js` writes it into a scratch dir on
 * this machine and redacts everything that comes back out.
 * ========================================================================== */

async function getRawWorkflow(id) {
  return request("GET", `/api/v1/workflows/${encodeURIComponent(id)}`);
}

/* `settings` é validado com `additionalProperties: false` no schema
   `workflowSettings` do openapi público — e a UI do n8n grava chaves que esse
   schema não conhece. Medido em 2026-08-06 no fluxo 9dGEJcYa7LxTAwAs: o objeto
   vivo trazia `timeSavedMode: "fixed"`, que não existe no schema (o que existe é
   `timeSavedPerExecution`). Repassar o objeto como veio derrubava o PUT com
   `400 request/body/settings must NOT have additional properties` — e o erro não
   nomeia a chave culpada, então sem esta lista o próximo caso custa a mesma
   depuração de novo.

   A lista abaixo é transcrita de `GET /api/v1/openapi.yml` da própria
   instância. Se um dia ela ficar velha, o sintoma é o mesmo 400.

   Descartar aqui **remove a chave do fluxo**: o PUT substitui `settings`
   inteiro, não faz merge. Por isso `putWorkflow` devolve as descartadas em vez
   de as engolir — quem escreve tem que poder dizer na tela o que saiu junto. */
const SETTINGS_ALLOWED = new Set([
  "saveExecutionProgress", "saveManualExecutions",
  "saveDataErrorExecution", "saveDataSuccessExecution",
  "executionTimeout", "errorWorkflow", "timezone", "executionOrder",
  "callerPolicy", "callerIds", "timeSavedPerExecution", "availableInMCP"
]);

function pickSettings(s) {
  const src = s && typeof s === "object" && !Array.isArray(s) ? s : null;
  if (!src) return { settings: { executionOrder: "v1" }, dropped: [] };
  const settings = {};
  const dropped = [];
  for (const [k, v] of Object.entries(src)) {
    if (SETTINGS_ALLOWED.has(k)) settings[k] = v;
    else dropped.push(k);
  }
  if (!Object.keys(settings).length) settings.executionOrder = "v1";
  return { settings, dropped };
}

// n8n recusa o PUT se vier campo read-only (id, active, tags, createdAt…), então
// o corpo é montado a partir dos quatro campos que a API aceita, nunca por spread.
function writeBody(w) {
  const { settings, dropped } = pickSettings(w.settings);
  return {
    body: {
      name: String(w.name || ""),
      nodes: w.nodes,
      connections: w.connections,
      settings
    },
    dropped
  };
}

async function putWorkflow(id, w, onDropped) {
  const { body, dropped } = writeBody(w);
  if (dropped.length && typeof onDropped === "function") onDropped(dropped);
  const out = await request("PUT", `/api/v1/workflows/${encodeURIComponent(id)}`, { body });
  // O desenho em cache passou a mentir no instante da escrita.
  state.graphs.delete(String(id));
  state.workflows.at = 0;
  return out;
}

async function createWorkflow(w, onDropped) {
  const { body, dropped } = writeBody(w);
  if (dropped.length && typeof onDropped === "function") onDropped(dropped);
  return request("POST", "/api/v1/workflows", { body });
}

/* A lista de fluxos, já pela whitelist de `extractWorkflow`. Existe porque o
 * catálogo do Tester precisa percorrer os fluxos para descobrir quais tipos de
 * nó esta instância de fato aceita, e `api()` não é exportada de propósito.
 * Nada aqui é novo: é o mesmo `getWorkflows` que o overview usa, com o mesmo
 * cache e a mesma extração. */
async function listWorkflows(opts) {
  return getWorkflows(opts || {});
}

async function findWorkflowByName(name) {
  const rows = await getWorkflows({ force: true });
  return rows.find(w => w.name === name) || null;
}

module.exports = {
  configured, instance: cfg.baseUrl, overview, poll, getGraph, getDetail, locateNode, WINDOW_HOURS,
  // write path — ver o bloco acima antes de usar
  getRawWorkflow, putWorkflow, createWorkflow, findWorkflowByName, listWorkflows,
  // exportado para teste
  pickSettings, SETTINGS_ALLOWED
};
