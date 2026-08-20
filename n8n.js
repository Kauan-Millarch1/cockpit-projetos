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
// Avaliador de expressão do Tester — puro, sem I/O, sem `eval`. Ver a nota em
// `textoEnviado`: um segundo avaliador seria uma segunda definição de "expressão
// suportada", e as duas divergiriam na primeira correção feita só de um lado.
const { resolverTexto, NAO_SIMULADA } = require("./simulate.js");

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

/* O TIPO DE MÍDIA QUE O NÓ MANDOU.
 *
 * Medido no Iago, execução #183879: `Send message and wait for response1` é um
 * `whatsApp` com `messageType: "audio"` e `mediaPropertyName: "data"` — ele não
 * tem parâmetro de texto NENHUM. Então `textoEnviado` devolve `null` com razão, e
 * a tela dizia "o conteúdo não veio nos campos conhecidos": mecanicamente certo,
 * semanticamente errado, porque manda quem lê procurar um campo que não existe.
 *
 * Com este fato a página consegue dizer "enviou um áudio" em vez de descrever uma
 * ausência. Sem ele só daria para INFERIR pela presença de um nó de TTS por perto,
 * e inferir é justamente o que este painel não faz.
 *
 * O que atravessa é uma palavra de um conjunto fechado, nunca o parâmetro — ele
 * carrega `phoneNumberId` e caminho de mídia. `text` e `template` deliberadamente
 * NÃO passam: só mídia entra, porque é a ausência de texto que precisa de
 * explicação. O Telegram nomeia a mídia na própria operação (`sendAudio`), então
 * ela vale como segunda fonte quando `messageType` não existe. */
const MIDIA = /^(audio|voice|image|photo|video|document|sticker)$/i;
const MIDIA_OP = /^send(Audio|Voice|Photo|Video|Document|Sticker)$/;

function midiaEnviada(p) {
  if (!p || typeof p !== "object") return null;
  if (typeof p.messageType === "string" && MIDIA.test(p.messageType)) return p.messageType.toLowerCase();
  const m = typeof p.operation === "string" ? p.operation.match(MIDIA_OP) : null;
  return m ? m[1].toLowerCase() : null;
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

/* ------------------------------------------------------- O TEXTO QUE SAIU
 *
 * A saída de um nó de envio é a RESPOSTA da API — medido no WhatsApp:
 * `messaging_product`, `contacts`, `messages`. O texto nunca esteve ali. E
 * procurá-lo por nome de campo no vizinho anterior erra duas vezes:
 *
 *   - o campo pode chamar-se `mensagem_atual` (medido nos fluxos dele), que
 *     nenhuma whitelist honesta de nomes pega sem virar peneira;
 *   - o vizinho na ORDEM DE EXECUÇÃO não é o alimentador quando há `Wait`
 *     num laço. Medido: a run 1 do nó `msg` é alimentada pela run 1 do
 *     `tipo_envio`, que está longe dali na ordem.
 *
 * Os dois fatos que resolvem isso já vêm no payload da execução:
 *
 *   - `task.source[0]` NOMEIA o alimentador real:
 *     `{previousNode, previousNodeRun, previousNodeOutput}`. É a aresta, não
 *     a vizinhança.
 *   - `e.workflowData` traz os parâmetros do nó (verificado em 60 de 60
 *     execuções com `includeData=true`). `textBody: "={{ $json.mensagem_atual }}"`
 *     NOMEIA o campo que carrega o texto.
 *
 * Então o texto passa a ser DERIVADO: a expressão do próprio nó, resolvida
 * contra o item que de fato entrou nele. O avaliador é o do `simulate.js` —
 * mesmo subconjunto medido, sem `eval`, e marcador declarado no lugar do que
 * não soube avaliar. Só que aqui não é simulação: os dados são reais.
 *
 * QUINTA REGRA DA FRONTEIRA — as quatro acima continuam valendo. O campo lido
 * não vem da whitelist de nomes; vem do parâmetro do próprio nó, o que o torna
 * a mensagem por construção. A exposição é a classe já aprovada na regra 2:
 * no máximo `SAMPLE_TEXT_CAP` caracteres, mascarados por `sampleValue` DEPOIS
 * da resolução — um parâmetro que resolva para um objeto vira 180 caracteres
 * cortados, exatamente como um `body` gigante já virava. O parâmetro em si não
 * sai daqui: sai o texto.
 *
 * `body` está deliberadamente FORA da lista: é o corpo de um `httpRequest`, e
 * resolvê-lo faria todo POST do fluxo virar "mensagem enviada". */
const PARAM_TEXTO = ["textBody", "text", "messageText", "message", "caption", "content", "subject"];
const MARCA_NAO_LIDA = "⟨…⟩";

function primeiroSource(t) {
  // `source` vem como array e pode ter buracos: `[{...}, null, null]`.
  const s = Array.isArray(t && t.source) ? t.source.find(Boolean) : null;
  if (!s || !s.previousNode) return null;
  return {
    no: String(s.previousNode),
    run: num(s.previousNodeRun) || 0,
    saida: num(s.previousNodeOutput) || 0
  };
}

function jsonDaRun(task, saida = 0) {
  const br = task && task.data && task.data.main && task.data.main[saida];
  const it = Array.isArray(br) ? br[0] : null;
  return it && it.json && typeof it.json === "object" ? it.json : null;
}

/* Índice `nome do nó -> json` para `$('Nó')`. A run escolhida é a mais recente
   ANTES desta: uma run posterior seria informação que o nó não tinha quando
   executou, e o resumo estaria contando o futuro. */
function porNoAte(runData, indice) {
  const out = {};
  for (const [nome, tasks] of Object.entries(runData)) {
    let melhor = null, melhorI = -1;
    for (const t of Array.isArray(tasks) ? tasks : []) {
      const i = num(t.executionIndex);
      if (i == null || (indice != null && i >= indice)) continue;
      if (i > melhorI) { melhor = t; melhorI = i; }
    }
    const j = melhor && jsonDaRun(melhor);
    if (j) out[nome] = j;
  }
  return out;
}

function textoEnviado(params, task, runData, agora) {
  if (!params || typeof params !== "object") return null;
  const bruta = PARAM_TEXTO.map(k => params[k]).find(v => typeof v === "string" && v.trim());
  if (bruta === undefined) return null;

  // Texto fixo, sem expressão: não há o que resolver, e ele É a mensagem.
  if (!bruta.startsWith("=") && !bruta.includes("{{")) return sampleValue(bruta, SAMPLE_TEXT_CAP);

  const src = primeiroSource(task);
  const alim = src ? jsonDaRun((runData[src.no] || [])[src.run], src.saida) : null;
  const r = resolverTexto(bruta, {
    json: alim || {},
    // O índice por nó só é montado quando a expressão realmente cita `$('Nó')`.
    porNo: bruta.includes("$(") ? porNoAte(runData, num(task.executionIndex)) : {},
    agora
  });

  // O que o avaliador não soube ler vira marcador. Se sobrou SÓ marcador, não
  // houve leitura nenhuma — e um resumo feito de marcador é pior que o silêncio.
  const limpo = r.texto.split(NAO_SIMULADA).join(MARCA_NAO_LIDA).trim();
  if (!limpo || limpo === MARCA_NAO_LIDA) return null;
  return sampleValue(limpo, SAMPLE_TEXT_CAP);
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
  const runData = rd.runData || {};

  /* Os parâmetros ficam AQUI DENTRO e não saem — são eles que nomeiam o campo
     do texto. `workflowData` chega junto no payload de `?includeData=true`
     (verificado em 60 de 60 execuções). */
  const paramDe = new Map();
  for (const n of (e.workflowData && e.workflowData.nodes) || []) {
    if (n && n.name) paramDe.set(String(n.name), n.parameters);
  }
  const agora = e.stoppedAt || e.startedAt || null;

  const nodes = [];
  for (const [name, tasks] of Object.entries(runData)) {
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
        // de onde veio o item que ENTROU: nome do nó, run e porta. Só nomes e
        // inteiros — nenhum payload. É a aresta de verdade, e é o que corrige o
        // "vizinho na ordem" em fluxo com laço.
        src: primeiroSource(t),
        // o texto que este nó MANDOU, resolvido pelo parâmetro dele contra esse
        // item. `null` quando o nó não tem parâmetro de texto ou quando nada
        // resolveu — silêncio, nunca palpite.
        enviado: textoEnviado(paramDe.get(String(name)), t, runData, agora),
        // a mídia que este nó mandou, quando mandou mídia em vez de texto. Uma
        // palavra de conjunto fechado — é o que separa "não achei o texto" de
        // "não havia texto nenhum a achar".
        midia: midiaEnviada(paramDe.get(String(name))),
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
  docs: new Map(),                   // wfId -> { at, p } — a PROJEÇÃO do documento, ver `docDoFluxo`
  locate: new Map(),                 // JSON.stringify([wfId, node]) -> { at, value }
  callers: { at: 0, value: null },   // { porFilho: {childId: [{id,name,viaNode}]}, lidos, falhas }
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
const EXEC_CACHE_V = 7;   // 7: `midia` por run (o nó mandou áudio, não texto)

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

/* A linha de UMA execução, sem `includeData`. Existe para o caminho de retry:
   antes de reexecutar é preciso saber de qual fluxo aquela execução é e se ela
   de fato falhou, e nenhuma das duas coisas justifica arrastar o payload
   inteiro (multi-MB) só para ler dois campos.

   Não entra em cache de propósito. `getDetail` cacheia porque execução
   terminada é imutável; aqui o que se está perguntando é "posso escrever em
   cima disto agora", e responder isso com um registro velho é exatamente o
   erro que `capturedUpdatedAt` já evita no caminho do PUT. */
async function getExecRow(id) {
  const raw = await api(`/api/v1/executions/${encodeURIComponent(id)}`);
  return extractExecRow(raw);
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

/* ═══════════════ O DOCUMENTO DO FLUXO, PROJETADO E EM CACHE ════════════════
 *
 * O caro aqui nunca foi o veredito: é BUSCAR o documento. `state.locate` guarda
 * o veredito por `[wfId, nó]`, então a busca do pai e a dos filhos eram refeitas
 * inteiras a cada NOME de nó diferente. Um alvo de 5 nós do mesmo fluxo lia o
 * mesmo pai 5 vezes e os mesmos filhos até 30 — na rota quente da conversa,
 * atrás de `MAX_INFLIGHT = 4`, e o maior fluxo desta instância tem 189 nós e
 * 285KB. O que faltava era cache pelo `wfId`.
 *
 * O QUE ENTRA NO CACHE É A PROJEÇÃO, NUNCA O DOCUMENTO CRU — e isso é decisão de
 * segurança antes de ser de memória. O documento cru carrega `credentials` e
 * `parameters`: é o buraco deliberado do `getRawWorkflow`, cujo contrato é ser
 * lido e redigido na hora, process-local. Guardá-lo por 10 minutos seria uma
 * SEGUNDA cópia desse buraco, viva muito depois de o uso ter acabado e uma por
 * fluxo lido. A projeção tem exatamente o que `locateNode` usa — nome do fluxo,
 * NOMES dos nós, e o par (nó chamador, id do filho) dos nós de sub-fluxo — e
 * nenhum desses campos é novo: os três já atravessam hoje na resposta de
 * `locateNode`. Nenhuma rota passa a servir nada por causa disto.
 *
 * MESMO RELÓGIO DO VEREDITO (`LOCATE_TTL_MS`), de propósito. As duas coisas
 * envelhecem pelo mesmo motivo — alguém editou o fluxo no n8n durante a conversa
 * — e um segundo relógio só criaria a janela em que o veredito é velho e o
 * documento é novo (ou o contrário) sem que ninguém consiga dizer qual dos dois
 * está certo.
 *
 * O QUE FICA GUARDADO É A PROMESSA, NÃO O RESULTADO. Guardar só o resultado não
 * ajudaria justamente no caso que motivou isto: a rajada de nós do mesmo alvo
 * chega antes de a primeira resposta voltar, o cache ainda está vazio, e as N
 * chamadas buscam as N vezes. Com a promessa em voo, a segunda espera a primeira.
 *
 * FALHA NÃO FICA GUARDADA: a entrada é removida quando a promessa rejeita. Senão
 * um 503 passageiro fixaria "não consegui ler este fluxo" por 10 minutos, e quem
 * lê essa resposta decide se um patch anda ou para. O preço é que uma rajada em
 * cima de um fluxo ilegível re-tenta — que é exatamente o que ela já fazia antes
 * desta mudança, então não há regressão nesse caminho. */

function projecaoDoFluxo(w) {
  const nomes = new Set();
  const chamadas = [];
  const vistos = new Set();
  for (const n of (w && w.nodes) || []) {
    nomes.add(String(n.name));
    if (!SUBFLOW_RE.test(String(n.type))) continue;
    const id = subWorkflowId(n);
    // Dedup por id AQUI: o documento é o mesmo para qualquer nome de nó
    // procurado, então a lista de filhos distintos não depende da pergunta.
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    chamadas.push({ viaNode: String(n.name), childId: String(id) });
  }
  return { nome: String((w && w.name) ?? ""), nomes, chamadas };
}

function docDoFluxo(id) {
  /* Chave de UM campo, num Map próprio, e isso é a decisão: sem prefixo
     discriminador não há separador a concatenar à mão. Concatenar separador à
     mão é o que já produziu U+0000 no `nodeOrigin`, U+001F neste arquivo e
     U+0000 no `catalog.js` — três vezes, todas silenciosas. Onde a chave É
     composta ela é `JSON.stringify([...])`, como em `state.locate` abaixo. */
  const key = String(id);
  const agora = Date.now();
  const hit = state.docs.get(key);
  if (hit && agora - hit.at < LOCATE_TTL_MS) return hit.p;

  // Varredura do que já venceu: entrada vencida nunca é lida de novo, então sem
  // isto o Map só cresce. Barata — a instância tem 68 fluxos.
  for (const [k, v] of state.docs) if (agora - v.at >= LOCATE_TTL_MS) state.docs.delete(k);

  const entrada = {
    at: agora,
    p: request("GET", `/api/v1/workflows/${encodeURIComponent(id)}`).then(projecaoDoFluxo)
  };
  state.docs.set(key, entrada);
  // A identidade é conferida antes de apagar: uma entrada mais nova, criada
  // depois desta rejeitar, não pode ser derrubada pela falha da anterior.
  entrada.p.catch(() => { if (state.docs.get(key) === entrada) state.docs.delete(key); });
  return entrada.p;
}

async function locateNode(wfId, nodeName) {
  const key = JSON.stringify([String(wfId), String(nodeName)]);
  const hit = state.locate.get(key);
  if (hit && Date.now() - hit.at < LOCATE_TTL_MS) return hit.value;

  const parent = await docDoFluxo(wfId);
  const inWorkflow = parent.nomes.has(nodeName);

  const subflows = [];
  /* Quantos sub-fluxos DISTINTOS este fluxo chama, contados mesmo depois de o scan
     parar. Sem esse numero, "nao achei o no em filho nenhum" e "parei antes de
     olhar todos" chegam iguais em quem le — e as duas frases levam a decisoes
     opostas: uma libera o patch, a outra tem de bloquear. Mesma razao de `callers`
     reportar `falhas`.
     A deduplicacao e por Set, e agora vive em `projecaoDoFluxo`: conferir
     repeticao contra `subflows` voltaria a contar o mesmo filho varias vezes
     depois do teto, porque depois dele os candidatos nao entram mais na lista.
     Contar o tamanho de `chamadas` da o mesmo numero que o `candidatos++` dava —
     o total de filhos distintos, teto ou nao. */
  const candidatos = inWorkflow ? 0 : parent.chamadas.length;
  if (!inWorkflow) {
    for (const c of parent.chamadas) {
      if (subflows.length >= SUBFLOW_SCAN_CAP) break;
      // Sequencial de propósito, como antes: `docDoFluxo` já colapsa o filho
      // repetido, e disparar os seis de uma vez só desloca a pressão para o
      // `MAX_INFLIGHT` que a rota da conversa divide com o poll.
      let child = null;
      try { child = await docDoFluxo(c.childId); }
      catch { /* filho apagado ou sem permissão: entra como desconhecido */ }
      subflows.push({
        viaNode: c.viaNode,
        childId: c.childId,
        childName: child ? child.nome : null,
        hasNode: child ? child.nomes.has(nodeName) : null
      });
    }
  }

  const value = {
    wfId: String(wfId), workflowName: parent.nome, node: nodeName, inWorkflow, subflows,
    /* FATO, nao juizo: quantos candidatos existem e se a leitura ficou incompleta.
       Quem decide o que fazer com isso e quem chama — o painel pinta, o upgrade
       bloqueia. */
    candidatos, truncado: candidatos > subflows.length
  };
  state.locate.set(key, { at: Date.now(), value });
  return value;
}

/* --------------------------------------------------- quem chama quem ------
 *
 * Um sub-fluxo chamado por `executeWorkflow`/`toolWorkflow` NUNCA pode estar
 * `active` no n8n: quem acorda é o pai. Então "ativo ou executou na janela" —
 * o filtro da porta de entrada — deixava de fora fluxo de produção de 108 nós
 * só porque ele estava quieto na janela. `Agente eContrate` é o caso medido: 0
 * execuções em 24h, `active:false`, e chamado por `WhatsApp API Oficial`, que
 * tem 645 execuções e está ativo.
 *
 * Isto é FATO, do mesmo tipo que `locateNode` já emite: está escrito no JSON dos
 * dois workflows. Sai daqui **id, nome e nome do nó chamador apenas** — o objeto
 * `parameters` não é whitelistado e não atravessa. Quem decide se um chamador
 * está "vivo" é a tela, não este arquivo.
 */
const CALLERS_TTL_MS = 15 * 60 * 1000;
const CALLERS_SCAN_CAP = 200;        // teto defensivo; a instância tem 68

async function callers({ force = false } = {}) {
  if (!force && state.callers.value && Date.now() - state.callers.at < CALLERS_TTL_MS) {
    return state.callers.value;
  }
  const rows = await getWorkflows({ force: false });
  const porFilho = {};
  let lidos = 0, falhas = 0;

  for (const w of rows.slice(0, CALLERS_SCAN_CAP)) {
    let raw;
    try { raw = await request("GET", `/api/v1/workflows/${encodeURIComponent(w.id)}`); }
    catch { falhas++; continue; }
    lidos++;
    for (const nd of raw.nodes || []) {
      if (!SUBFLOW_RE.test(String(nd.type || ""))) continue;
      const filho = subWorkflowId(nd);
      if (!filho) continue;
      if (!porFilho[filho]) porFilho[filho] = [];
      if (porFilho[filho].some(c => c.id === String(w.id))) continue;
      porFilho[filho].push({ id: String(w.id), name: String(w.name ?? ""), viaNode: String(nd.name ?? "") });
    }
  }

  // `falhas` não é decoração: com leitura incompleta, "ninguém chama este fluxo"
  // deixa de ser uma afirmação sustentável, e a tela precisa poder dizer isso.
  const value = { porFilho, lidos, falhas, total: rows.length, geradoEm: new Date().toISOString() };
  state.callers = { at: Date.now(), value };
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
 * instance. Two callers today, and the count is load-bearing (see `writeOwner`):
 * `claude-fix.js`, on the sandbox/approve/revert paths after Kauan clicked on a
 * diff that was already rendered, and `tester.js`, which only ever writes an
 * inactive `[SANDBOX tester]` copy.
 *
 * Three rules that are not negotiable:
 *   1. No delete. There is no delete function here and there must not be one —
 *      the standing rule for this instance is add, modify or disconnect only.
 *   2. No activation. `active` is never sent, so applying a fix can never wake
 *      a dormant flow.
 *   3. No auto-apply. Nothing in this module calls these; the HTTP route does,
 *      one approved proposal at a time.
 *
 * `retryExecution` é a quarta função daqui e é de OUTRA NATUREZA — leia antes
 * de mexer. `putWorkflow` e `createWorkflow` mudam um documento, e o documento
 * anterior está guardado, então existe `↺ Desfazer`. Reexecutar não muda
 * documento nenhum: manda mensagem de WhatsApp para pessoa de verdade, grava
 * linha de verdade, chama API de terceiro de verdade. Não há desfazer e nunca
 * haverá. É a única coisa neste módulo cujo efeito sai da instância.
 *
 * `getRawWorkflow` is the deliberate hole in the whitelist: it returns the
 * unfiltered workflow, credentials and all. It is process-local — the server
 * never serves its output, and `claude-fix.js` writes it into a scratch dir on
 * this machine and redacts everything that comes back out.
 * ========================================================================== */

async function getRawWorkflow(id) {
  return request("GET", `/api/v1/workflows/${encodeURIComponent(id)}`);
}

/* O SEGUNDO buraco deliberado, e ele é maior que o primeiro — leia antes de usar.
 *
 * Devolve a execução CRUA, com `runData` inteiro: a conversa do lead, o payload
 * de cada nó, tudo. É process-local e **nenhuma rota HTTP serve a saída dela**,
 * exatamente como `getRawWorkflow`.
 *
 * POR QUE EXISTE: `getDetail` passa pela whitelist, que por desenho só deixa
 * atravessar campo nomeado e corta texto em 180 — e é isso que torna o painel
 * seguro para ficar aberto o dia inteiro. Mas uma pergunta como "por que o preço
 * saiu R$0,00" não é respondível por forma: precisa do VALOR do campo e de onde
 * ele veio. Medido: o preço vem da API como `"3000"` (string), e o cache do Redis
 * devolve tudo sob `propertyName` — nada disso é visível pela whitelist.
 *
 * QUEM PODE CHAMAR: `evidencia.js`, e só. Ele é o único que sabe recortar isto
 * para o que uma sessão pode ler, e a máscara de telefone/e-mail é aplicada lá
 * SEM exceção. Se aparecer um segundo chamador, a pergunta certa é por que ele
 * não passa pelo `evidencia.js`.
 *
 * O que NUNCA muda: a chave da API não sai deste arquivo. */
async function getRawExecution(id) {
  return request("GET", `/api/v1/executions/${encodeURIComponent(id)}?includeData=true`);
}

/* A lista crua de execuções, com filtro. Sem `includeData` — é só a linha, e é o
   que permite escolher QUAIS execuções abrir antes de pagar o payload de cada
   uma. `status` é validado contra o conjunto que esta instância aceita: medido,
   `crashed` devolve 400. */
const STATUS_VALIDOS = new Set(["success", "error", "waiting", "running", "canceled"]);

async function listExecutions({ wfId, status, limite = 50, cursor } = {}) {
  const q = new URLSearchParams();
  if (wfId) q.set("workflowId", String(wfId));
  if (status && STATUS_VALIDOS.has(status)) q.set("status", status);
  q.set("limit", String(Math.max(1, Math.min(250, Number(limite) || 50))));
  if (cursor) q.set("cursor", String(cursor));
  const r = await request("GET", "/api/v1/executions?" + q.toString());
  return { linhas: (r && r.data) || [], cursor: (r && r.nextCursor) || null };
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

/* ══════════════════════════════════ QUEM ESTÁ ESCREVENDO ═══════════════════
 *
 * ETAPA 0 de quatro (PLAN-UPGRADE.md §6.5.1). Hoje isto não trava nada: é
 * encanamento, e de propósito.
 *
 * O QUE VEM DEPOIS, e por que o dono tem de existir ANTES. Não há trava
 * compartilhada nesta instância: `claude-fix.js` serializa só as runs dele
 * (`let active`), `tester.js` só as sessões dele, e nada envolve todos os
 * `PUT`/`POST` — então hoje um build do Tester pode escrever a cópia sandbox no
 * mesmo instante que um approve escreve um fluxo vivo. A etapa 3 desce uma fila
 * process-wide para cá, e ela é **reentrante por dono**, porque o próprio
 * caminho de approve da aba Upgrade escreve duas vezes (a cópia sandbox da
 * checagem 7, depois o fluxo vivo). Uma fila que não sabe distinguir
 * reentrância de disputa trava contra si mesma, e o sintoma é um deadlock que só
 * aparece com a checagem 7 ligada.
 *
 * Ligar a fila antes de existir dono seria introduzir esse deadlock pela etapa
 * que devia ser a segura. Então primeiro todo call site passa a dizer quem é —
 * sem trava — e só depois a fila liga.
 *
 * DUAS COISAS VIAJAM JUNTAS, e as duas são necessárias:
 *   - `id` é a identidade que a fila compara para decidir reentrância. É por
 *     RUN, não por módulo: as duas escritas de um mesmo approve compartilham o
 *     id, e dois approves diferentes disputam.
 *   - `doing` é a frase que a espera mostra ("esperando: aplicando correção em
 *     X"). Ela mora aqui porque só quem chama sabe o nome do fluxo e o que está
 *     fazendo; derivá-la neste módulo seria `n8n.js` julgando, e ele emite fato.
 *
 * `retryExecution` fica FORA disto e continuará fora: não escreve documento, e
 * serializar um efeito que já é recusado em duplicidade só esconderia a fila.
 *
 * A ausência é ERRO, nunca um dono genérico. Um call site que esquecesse o dono
 * cairia num default silencioso, e na etapa 3 esse default viraria um dono que
 * reentra com todo mundo — a pior linha possível de escrever aqui. Este
 * repositório já registra a regra: campo ausente nunca cai no ramo negativo. */

const WRITE_KINDS = new Set(["fix", "tester", "upgrade"]);
const DOING_CAP = 120;

/* O formato é validado na CONSTRUÇÃO, num lugar só, e não no caminho quente:
   assim a etapa 0 não acrescenta nenhuma regex nova entre o clique e o `PUT`. */
function writeOwner(kind, ref, doing) {
  if (!WRITE_KINDS.has(kind)) {
    throw new Error("writeOwner: `kind` tem que ser um de " + [...WRITE_KINDS].join(", ") + ' — veio "' + String(kind) + '"');
  }
  const r = String(ref == null ? "" : ref);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(r)) {
    throw new Error('writeOwner: `ref` é o id da run/sessão, 1-64 em [A-Za-z0-9_-] — veio "' + r + '"');
  }
  const d = String(doing == null ? "" : doing).trim();
  if (!d) throw new Error("writeOwner: `doing` é a frase que a espera mostra, e não pode ser vazia");
  return Object.freeze({ id: kind + ":" + r, kind, ref: r, doing: d.slice(0, DOING_CAP) });
}

/* Barato de propósito: confere que veio do construtor acima, não o formato de
   novo. O que precisa ser alto é a ausência. */
function requireOwner(owner, fn) {
  if (!owner || typeof owner !== "object" || typeof owner.id !== "string" || !owner.id
      || typeof owner.doing !== "string" || !owner.doing) {
    throw new Error(fn + ": escrita sem dono. Passe `n8n.writeOwner(kind, ref, doing)` como primeiro argumento — "
      + "ver PLAN-UPGRADE.md §6.5.1");
  }
  return owner;
}

/* ═════════════════════════ A FILA DE ESCRITA, REENTRANTE ═══════════════════
 *
 * ETAPA 3 de quatro, a última antes da aba Upgrade (PLAN-UPGRADE.md §6.5). É a
 * única mudança deste plano que mexe em caminho de escrita já em produção — por
 * isso vem depois de `writeOwner` (etapa 0), do `kind` no ledger (1) e de
 * `escreverAprovado` (2), e por isso cada uma delas é reversível sozinha.
 *
 * O QUE ELA CONSERTA: não havia trava alguma envolvendo os `PUT`/`POST` desta
 * instância. `claude-fix.js` serializa as runs dele, `tester.js` as sessões
 * dele, e nada os serializa entre si — um build do Tester podia escrever a cópia
 * sandbox no mesmo instante que um approve escrevia um fluxo vivo.
 *
 * REENTRANTE POR DONO, e essa palavra é a razão de a etapa 0 existir antes. O
 * approve da aba Upgrade escreve DUAS vezes e a de dentro fica dentro da de
 * fora: `escreverAprovado` segura a região inteira (re-busca → portões → backup
 * → `PUT`) e a checagem 7 dos portões escreve na cópia `[SANDBOX upgrade]`
 * ENQUANTO ela está segura. Numa fila não reentrante essa escrita de dentro
 * espera pela de fora, que espera por ela: deadlock, e um que só aparece com a
 * checagem 7 ligada — que é o padrão novo daquela aba. Com dono, "sou eu mesmo"
 * e "é outro" deixam de ser a mesma pergunta.
 *
 * Segurar a região inteira não é zelo: sem isso outro dono escreveria ENTRE a
 * revalidação dos portões e o `PUT`, e o documento gravado deixaria de ser o que
 * os portões aprovaram — a única garantia que o approve dá.
 *
 * ESPERA, NÃO RECUSA. Uma escrita de outro dono entra na fila em ordem de
 * chegada; recusar de cara transformaria um approve legítimo em erro só porque o
 * Tester estava gravando uma cópia inativa. Mas a espera tem TETO: sem ele um
 * dono travado (uma requisição que nunca volta) travaria o cockpit para sempre,
 * o que é pior que recusar. Estourado o teto, o erro NOMEIA o dono corrente —
 * "o cockpit está esperando" e "o cockpit quebrou" são histórias diferentes e a
 * tela tem de poder contar a verdadeira.
 *
 * `retryExecution` fica FORA, como sempre: não escreve documento, e serializar
 * um efeito que já é recusado em duplicidade só esconderia a fila. */

const ESCRITA_TIMEOUT_MS = Number(process.env.COCKPIT_ESCRITA_TIMEOUT_MS || 45000);

let donoAtual = null;      // o dono que está com a vez
let profundidade = 0;      // quantas vezes ele reentrou
const filaEscrita = [];    // quem espera, em ordem de chegada

/* Facts only: quem está escrevendo agora e quantos esperam. É o que permite a
   uma tela dizer "esperando: aplicando correção em X" sem adivinhar. */
function donoDaEscrita() {
  return donoAtual
    ? { id: donoAtual.id, doing: donoAtual.doing, profundidade, esperando: filaEscrita.length }
    : { id: null, doing: null, profundidade: 0, esperando: filaEscrita.length };
}

function tomarVez(owner) {
  if (donoAtual && donoAtual.id === owner.id) { profundidade++; return null; }
  if (!donoAtual) { donoAtual = owner; profundidade = 1; return null; }
  return new Promise((resolve, reject) => {
    const item = { owner, resolve, reject, timer: null };
    item.timer = setTimeout(() => {
      const i = filaEscrita.indexOf(item);
      if (i >= 0) filaEscrita.splice(i, 1);
      const atual = donoAtual ? donoAtual.doing : "outra escrita";
      reject(Object.assign(
        new Error("desisti de esperar a vez de escrever depois de " + Math.round(ESCRITA_TIMEOUT_MS / 1000)
          + "s — o cockpit está ocupado com: " + atual),
        { status: 409 }));
    }, ESCRITA_TIMEOUT_MS);
    filaEscrita.push(item);
  });
}

function soltarVez() {
  if (profundidade > 1) { profundidade--; return; }
  donoAtual = null;
  profundidade = 0;
  const prox = filaEscrita.shift();
  if (prox) {
    clearTimeout(prox.timer);
    donoAtual = prox.owner;
    profundidade = 1;
    prox.resolve();
  }
}

/* Segura a vez de escrever durante `fn`. Reentrante para o MESMO dono, em
   qualquer profundidade. O `finally` é o que garante que uma escrita que jogou
   não deixa a fila parada — sem ele o primeiro 503 do n8n travaria o cockpit
   até reiniciar. */
async function comEscrita(owner, fn) {
  requireOwner(owner, "comEscrita");
  const esperar = tomarVez(owner);
  if (esperar) await esperar;
  try { return await fn(); }
  finally { soltarVez(); }
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

/* O dono vem PRIMEIRO, e é o único parâmetro obrigatório novo. Na cauda, depois
   de um callback opcional, seria possível escrever uma chamada que parece
   completa sem ele — que é exatamente o que a etapa 3 não pode tolerar. */
async function putWorkflow(owner, id, w, onDropped) {
  requireOwner(owner, "putWorkflow");
  return comEscrita(owner, async () => {
    const { body, dropped } = writeBody(w);
    if (dropped.length && typeof onDropped === "function") onDropped(dropped);
    const out = await request("PUT", `/api/v1/workflows/${encodeURIComponent(id)}`, { body });
    // O desenho em cache passou a mentir no instante da escrita.
    state.graphs.delete(String(id));
    /* A projeção também: ela lista os nós e os filhos chamados, e um patch mexe
       nas duas coisas. É cache que este arquivo criou, então deixá-lo velho
       depois da NOSSA própria escrita seria defeito nosso. O veredito de
       `locateNode` segue com o TTL dele, como sempre — mudar isso seria mudança
       de comportamento, e aqui só há otimização. */
    state.docs.delete(String(id));
    state.workflows.at = 0;
    return out;
  });
}

async function createWorkflow(owner, w, onDropped) {
  requireOwner(owner, "createWorkflow");
  return comEscrita(owner, async () => {
    const { body, dropped } = writeBody(w);
    if (dropped.length && typeof onDropped === "function") onDropped(dropped);
    return request("POST", "/api/v1/workflows", { body });
  });
}

/* Reexecuta uma execução que falhou. FATOS medidos, não suposição — lidos em
   `packages/cli/src/executions/execution.service.ts` do n8n, porque medir isto
   na instância significaria mandar mensagem para um lead de verdade:

   - O retry NÃO recomeça o fluxo. O n8n preserva o `nodeExecutionStack` e o
     `runData` da execução original e só faz `pop()` no runData do último nó
     executado — o que quebrou. Ele não passa `startNodes`, passa
     `executionData: execution.data` inteiro. Então o que já rodou não roda de
     novo: as bolhas que já foram não repetem.
   - `loadWorkflow: true` é o que torna isto útil. Sem ele o n8n reexecuta com o
     workflow salvo NA ÉPOCA da execução, ou seja, com o defeito ainda dentro.
     Com ele, roda com a versão atual — a corrigida.
   - Dois estados recusam retry, e os dois vêm nomeados: status `new` dá
     `QueuedExecutionRetryError`, e execução sem `executionData` dá
     `AbortedExecutionRetryError`. Aqui há dados: `saveDataErrorExecution` está
     ausente em 71 dos 73 fluxos, e ausente é o default do n8n (`all`).
   - Com `loadWorkflow: true`, um nó do stack que tenha sido apagado ou
     renomeado derruba o retry com `Could not find the node "<nome>" in
     workflow`. Não acontece por este caminho: `applyPatch` ignora `name` em
     `updateNodes` e não tem verbo de delete, então a correção do cockpit nunca
     renomeia nem apaga nó. Se algum dia tiver, este comentário está velho.

   O que SOBRA de risco e não dá para eliminar por API: o nó que falhou
   reexecuta. Se ele falhou DEPOIS de causar efeito (timeout na resposta, mas a
   mensagem saiu), aquele envio duplica. Quem decide se isso é aceitável é a
   tela, com o erro na mão — não esta função.

   Não é re-tentado em caso de erro de rede: `request` só re-tenta GET, e aqui
   isso é vital. Uma resposta perdida não prova que a execução não começou. */
async function retryExecution(execId, { loadWorkflow = true } = {}) {
  if (!/^\d{1,20}$/.test(String(execId))) throw new Error("id de execução inválido");
  const out = await request("POST", `/api/v1/executions/${encodeURIComponent(execId)}/retry`, {
    body: { loadWorkflow: !!loadWorkflow }
  });
  /* Nada a invalidar: o poll lê a página 1 e faz merge por id, e os ids são
     monotônicos, então a execução nova entra sozinha no ciclo seguinte. É também
     por isso que `fixState()` reabre a assinatura de graça se o retry falhar de
     novo — o mecanismo que já existe é a prova, e ela não é dada aqui. */
  return extractExecRow(out || {});
}

/* Os campos obrigatórios de um tipo de credencial. É FATO vindo da instância —
 * `GET /credentials` responde 405, então não dá para listar o que existe, mas
 * `/credentials/schema/{tipo}` diz exatamente o que aquele tipo pede. Só forma
 * atravessa: nomes de campo e quais são obrigatórios, nunca valor. */
const schemaCache = new Map();
async function credentialSchema(tipo) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(tipo || ""))) return null;
  if (schemaCache.has(tipo)) return schemaCache.get(tipo);
  let out = null;
  try {
    const raw = await api(`/api/v1/credentials/schema/${encodeURIComponent(tipo)}`);
    out = {
      obrigatorios: Array.isArray(raw.required) ? raw.required.map(String).slice(0, 20) : [],
      campos: Object.keys(raw.properties || {}).slice(0, 40)
    };
  } catch { out = null; }
  schemaCache.set(tipo, out);
  return out;
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
  configured, instance: cfg.baseUrl, overview, poll, getGraph, getDetail, getExecRow, locateNode, callers, WINDOW_HOURS,
  // write path — ver o bloco acima antes de usar
  getRawWorkflow, putWorkflow, createWorkflow, writeOwner, WRITE_KINDS, DOING_CAP,
  /* Os dois buracos deliberados, e o segundo é maior — leia o comentário deles.
     Process-local: nenhuma rota serve a saída. `getRawExecution` tem UM chamador
     legítimo, o `evidencia.js`, que é quem sabe recortar e mascarar. */
  getRawExecution, listExecutions, maskPII, STATUS_VALIDOS,
  /* A fila de escrita (etapa 3). `comEscrita` sai para quem precisa segurar a
     vez durante uma REGIÃO — é o que `escreverAprovado` faz, e é o que torna a
     checagem 7 da aba Upgrade uma reentrância em vez de um deadlock.
     `donoDaEscrita` é fato: quem está escrevendo agora e quantos esperam. */
  comEscrita, donoDaEscrita, ESCRITA_TIMEOUT_MS,
  findWorkflowByName, listWorkflows, credentialSchema,
  // o único efeito que sai da instância — leia o comentário de `retryExecution`
  retryExecution,
  // exportado para teste
  pickSettings, SETTINGS_ALLOWED, midiaEnviada
};
