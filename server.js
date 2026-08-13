// Cockpit de Projetos — local server.
// Emits FACTS only. All judgement (health score, bands, checks) lives in cockpit.html.
// Read-only: never writes into a project, never deploys.

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const n8n = require("./n8n");
const claudeFix = require("./claude-fix");
const tester = require("./tester");
const novidades = require("./novidades");
const anexos = require("./anexos");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");          // Desktop\Projects
const SELF = path.basename(__dirname);               // "Cockpit Projetos"
const PORT = Number(process.env.PORT || 4317);
const CACHE_FILE = path.join(__dirname, ".cache-scan.json");
// O mesmo diretório que o `tester.js` usa. As bandejas de anexo moram debaixo
// dele (`_bandejas/`), então o caminho tem que ser um só — duas verdades sobre
// onde ficam os arquivos seria uma bandeja que a sessão nunca encontra.
const TESTER_RUNS = path.join(__dirname, ".tester-runs");

const IGNORE_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "out", "venv", ".venv",
  "__pycache__", ".cache", ".turbo", ".vercel", "coverage", ".pytest_cache"
]);

const TEXT_EXT = new Set([
  ".md", ".txt", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".py",
  ".html", ".css", ".yml", ".yaml", ".sh", ".ps1", ".sql", ".toml", ".env.example"
]);

const WALK_FILE_CAP = 6000;   // stop walking a project past this — protects against huge trees
const TODO_FILE_CAP = 400;    // how many text files to grep for TODO/FIXME
const TODO_SIZE_CAP = 200_000;

/* ------------------------------------------------------------------ walking */

async function walk(dir, acc, depth = 0) {
  if (acc.files.length >= WALK_FILE_CAP || depth > 12) { acc.truncated = true; return acc; }

  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return acc; }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) { acc.skipped.add(e.name); continue; }
      await walk(full, acc, depth + 1);
    } else if (e.isFile()) {
      if (acc.files.length >= WALK_FILE_CAP) { acc.truncated = true; return acc; }
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      acc.files.push({
        path: path.relative(acc.base, full).replace(/\\/g, "/"),
        name: e.name,
        ext: path.extname(e.name).toLowerCase(),
        size: st.size,
        mtime: st.mtime.toISOString()
      });
    }
  }
  return acc;
}

async function walkProject(dir) {
  const acc = { base: dir, files: [], skipped: new Set(), truncated: false };
  await walk(dir, acc);
  return { files: acc.files, skipped: [...acc.skipped], truncated: acc.truncated };
}

const exists = p => fs.existsSync(p);

/* ---------------------------------------------------------------------- git */

async function gitFacts(dir) {
  if (!exists(path.join(dir, ".git"))) return { isRepo: false };

  const run = async (...args) => {
    try {
      const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
        timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024
      });
      return stdout.trim();
    } catch { return null; }
  };

  const [branch, status, remote, log, count] = await Promise.all([
    run("rev-parse", "--abbrev-ref", "HEAD"),
    run("status", "--porcelain"),
    run("remote", "get-url", "origin"),
    run("log", "-8", "--date=short", "--format=%h\x1f%ad\x1f%an\x1f%s"),
    run("rev-list", "--count", "HEAD")
  ]);

  return {
    isRepo: true,
    branch,
    remote,
    commitCount: count ? Number(count) : null,
    uncommitted: status ? status.split("\n").filter(Boolean).length : 0,
    dirtyFiles: status ? status.split("\n").filter(Boolean).slice(0, 12).map(l => l.trim()) : [],
    commits: log ? log.split("\n").filter(Boolean).map(l => {
      const [hash, date, author, subject] = l.split("\x1f");
      return { hash, date, author, subject };
    }) : []
  };
}

/* ------------------------------------------------------------------ scanning */

function docNames(files) {
  const find = re => files.find(f => !f.path.includes("/") && re.test(f.name));
  return {
    claudeMd: !!find(/^CLAUDE\.md$/i),
    readme: find(/^README/i)?.name || null,
    agentsMd: !!find(/^AGENTS\.md$/i)
  };
}

async function summarize(name) {
  const dir = path.join(ROOT, name);
  const { files, skipped, truncated } = await walkProject(dir);
  const docs = docNames(files);

  let newest = null;
  for (const f of files) if (!newest || f.mtime > newest.mtime) newest = f;

  return {
    name,
    dir,
    files: files.length,
    truncated,
    skipped,
    sizeMB: +(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1),
    lastTouch: newest ? newest.mtime.slice(0, 10) : null,
    lastFile: newest ? newest.path : null,
    git: exists(path.join(dir, ".git")),
    claudeMd: docs.claudeMd,
    readme: !!docs.readme,
    agentsMd: docs.agentsMd,
    pkg: exists(path.join(dir, "package.json")),
    vault: exists(path.join(dir, ".obsidian")),
    envFile: files.some(f => /^\.env$/i.test(f.name)),
    gitignore: exists(path.join(dir, ".gitignore"))
  };
}

async function listProjects({ refresh = false } = {}) {
  if (!refresh && exists(CACHE_FILE)) {
    try {
      const cached = JSON.parse(await fsp.readFile(CACHE_FILE, "utf8"));
      if (Date.now() - new Date(cached.scannedAt).getTime() < 15 * 60 * 1000) return cached;
    } catch { /* fall through to rescan */ }
  }

  const entries = await fsp.readdir(ROOT, { withFileTypes: true });
  const names = entries
    .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== SELF)
    .map(e => e.name);

  const projects = [];
  for (const n of names) projects.push(await summarize(n));   // sequential: disk-bound, keeps I/O sane

  const payload = { scannedAt: new Date().toISOString(), root: ROOT, projects };
  await fsp.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

/* -------------------------------------------------------------------- detail */

async function readHead(file, max = 6000) {
  try {
    const buf = await fsp.readFile(file, "utf8");
    return { text: buf.slice(0, max), truncated: buf.length > max, bytes: Buffer.byteLength(buf) };
  } catch { return null; }
}

async function scanTodos(dir, files) {
  const targets = files
    .filter(f => TEXT_EXT.has(f.ext) && f.size < TODO_SIZE_CAP)
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, TODO_FILE_CAP);

  const hits = [];
  let scanned = 0;
  for (const f of targets) {
    let text;
    try { text = await fsp.readFile(path.join(dir, f.path), "utf8"); } catch { continue; }
    scanned++;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\b(TODO|FIXME|HACK|XXX)\b[:\s-]*(.*)/);
      if (m) {
        hits.push({ file: f.path, line: i + 1, kind: m[1], text: (m[2] || "").trim().slice(0, 160) });
        if (hits.length >= 60) return { hits, scanned, capped: true };
      }
    }
  }
  return { hits, scanned, capped: false };
}

async function detail(name) {
  const dir = path.join(ROOT, name);
  if (!exists(dir)) return null;

  const [{ files, skipped, truncated }, git] = await Promise.all([walkProject(dir), gitFacts(dir)]);
  const docs = docNames(files);

  const recent = [...files].sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 20);

  // top-level composition: where the weight of the project actually sits
  const buckets = new Map();
  for (const f of files) {
    const top = f.path.includes("/") ? f.path.split("/")[0] + "/" : "(raiz)";
    const b = buckets.get(top) || { name: top, files: 0, size: 0, newest: "" };
    b.files++; b.size += f.size;
    if (f.mtime > b.newest) b.newest = f.mtime;
    buckets.set(top, b);
  }
  const composition = [...buckets.values()]
    .sort((a, b) => b.files - a.files)
    .slice(0, 12)
    .map(b => ({ ...b, sizeMB: +(b.size / 1048576).toFixed(2), newest: b.newest.slice(0, 10) }));

  const extCount = new Map();
  for (const f of files) extCount.set(f.ext || "(sem ext)", (extCount.get(f.ext || "(sem ext)") || 0) + 1);
  const fileTypes = [...extCount.entries()]
    .map(([ext, n]) => ({ ext, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  const claudeMd = docs.claudeMd ? await readHead(path.join(dir, "CLAUDE.md")) : null;
  const readme = docs.readme ? await readHead(path.join(dir, docs.readme)) : null;

  let pkgInfo = null;
  const pkgPath = path.join(dir, "package.json");
  if (exists(pkgPath)) {
    try {
      const p = JSON.parse(await fsp.readFile(pkgPath, "utf8"));
      pkgInfo = {
        name: p.name || null,
        scripts: Object.keys(p.scripts || {}),
        deps: Object.keys(p.dependencies || {}).length,
        devDeps: Object.keys(p.devDependencies || {}).length,
        lockfile: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].find(l => exists(path.join(dir, l))) || null
      };
    } catch { pkgInfo = { error: "package.json inválido" }; }
  }

  const todos = await scanTodos(dir, files);

  let newest = null;
  for (const f of files) if (!newest || f.mtime > newest.mtime) newest = f;

  return {
    name,
    dir,
    scannedAt: new Date().toISOString(),
    files: files.length,
    truncated,
    skipped,
    sizeMB: +(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1),
    lastTouch: newest ? newest.mtime.slice(0, 10) : null,
    lastFile: newest ? newest.path : null,
    git,
    docs: {
      claudeMd: docs.claudeMd,
      readmeName: docs.readme,
      agentsMd: docs.agentsMd,
      claudeMdText: claudeMd?.text || null,
      readmeText: readme?.text || null
    },
    flags: {
      vault: exists(path.join(dir, ".obsidian")),
      envFile: files.some(f => /^\.env$/i.test(f.name)),
      gitignore: exists(path.join(dir, ".gitignore")),
      gitignoreCoversEnv: exists(path.join(dir, ".gitignore"))
        ? /(^|\n)\s*\.env\s*(\n|$)/.test(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"))
        : false
    },
    pkg: pkgInfo,
    composition,
    fileTypes,
    recent,
    todos
  };
}

/* -------------------------------------------------------------------- server */

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(s)
  });
  res.end(s);
}

function serveFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(buf);
  });
}

// Reveal a project folder in Explorer. Not a mutation, but still guard the path.
function revealFolder(target) {
  const resolved = path.resolve(target);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) throw new Error("fora da raiz");
  if (!exists(resolved)) throw new Error("pasta não existe");
  execFile("explorer.exe", [resolved], { windowsHide: true }, () => {});   // explorer exits nonzero on success
  return resolved;
}

/* ------------------------------------------------------------------- fixes */

// Kauan marks an error signature as fixed after adjusting the flow in n8n.
// FACTS ONLY: this stores what he marked and the highest execution id that
// existed at that moment. Whether a mark is still valid — i.e. whether the
// signature came back — is decided in flows.html, never here.
//
// Not a cache. `.cache-*.json` can be regenerated from the API; this file is
// knowledge that exists nowhere else, so it is tracked in git.
const FIXES_FILE = path.join(__dirname, "fixes.json");
const FIX_BODY_CAP = 8 * 1024;
const HISTORY_CAP = 500;

/* Um anexo por requisição, e o corpo dele é o único grande deste servidor.
 *
 * O teto é o tamanho de um arquivo (12MB em `anexos.js`) mais o inchaço de ~33%
 * do base64, mais folga para o resto do JSON. Um-a-um é decisão, não limitação:
 * mandar 40 arquivos num corpo só significaria segurar ~64MB de string em
 * memória, sem progresso na tela e com o upload inteiro perdido se um arquivo
 * fosse recusado no fim. */
const ANEXO_BODY_CAP = 18 * 1024 * 1024;

// Two lists, different lifetimes:
//   fixes   — the CURRENT mark per signature. Undo removes from here.
//   history — append-only log of every mark ever made, with the note. Undo does
//             not delete an entry, it stamps `undoneAt` on it: "I tried this and
//             it did not hold" is weaker evidence than "this held", and the
//             difference is the whole point of keeping notes.
async function readFixes() {
  try {
    const raw = JSON.parse(await fsp.readFile(FIXES_FILE, "utf8"));
    return {
      fixes: Array.isArray(raw.fixes) ? raw.fixes : [],
      history: Array.isArray(raw.history) ? raw.history : []   // tolerates the old {fixes:[]} shape
    };
  } catch { return { fixes: [], history: [] }; }
}

// Temp + rename: a torn write here loses every fix ever marked, not one poll.
// Both lists are always written together — writing `fixes` alone would drop the
// history, i.e. destroy exactly the knowledge this file exists to accumulate.
async function writeFixes({ fixes, history }) {
  let log = history;
  if (log.length > HISTORY_CAP) {
    console.log(`fixes.json: histórico passou de ${HISTORY_CAP}, descartando ${log.length - HISTORY_CAP} entrada(s) mais antiga(s)`);
    log = log.slice(-HISTORY_CAP);
  }
  const tmp = FIXES_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify({ fixes, history: log }, null, 2), "utf8");
  await fsp.rename(tmp, FIXES_FILE);
}

// Assinatura no formato do superflow: `workflowId|node|errorType`.
function validKey(key) {
  const s = String(key || "");
  if (!s || s.length > 400 || /[\r\n]/.test(s)) return null;
  const parts = s.split("|");
  if (parts.length !== 3) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(parts[0])) return null;
  if (!parts[1] || !parts[2]) return null;
  return s;
}

async function readBody(req, cap) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > cap) {
      const err = new Error("corpo grande demais");
      err.status = 413;
      throw err;
    }
  }
  return body;
}

/* ------------------------------------------------------------- n8n live feed */

// Server-Sent Events. One n8n poll feeds every connected browser, so opening a
// second tab costs no extra API quota.
const POLL_MS = Number(process.env.POLL_MS || 20000);
const sseClients = new Set();

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) {
    try { sseSend(res, event, data); } catch { sseClients.delete(res); }
  }
}

let polling = false;
async function pollTick() {
  if (polling || !n8n.configured) return;
  polling = true;
  try {
    const delta = await n8n.poll();
    // Always emit: the browser needs the timestamp to prove the data is fresh,
    // even on a tick where nothing ran.
    broadcast("delta", delta);
  } catch (err) {
    broadcast("failure", { at: new Date().toISOString(), error: String(err && err.message || err) });
  } finally { polling = false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") return serveFile(res, path.join(__dirname, "flows.html"), "text/html; charset=utf-8");
    if (p === "/disco") return serveFile(res, path.join(__dirname, "cockpit.html"), "text/html; charset=utf-8");
    /* O aviso de aba: favicon animado, título piscando, notificação do SO. Um
     * arquivo servido às três páginas em vez de um quarto bloco copiado — o
     * topbar e o `.aviso` já são três cópias e essa fila não precisa crescer.
     * `no-store` como o resto: editar o arquivo e recarregar tem que valer, e um
     * favicon em cache é justo o tipo de coisa que ninguém pensa em invalidar. */
    if (p === "/aba.js") return serveFile(res, path.join(__dirname, "aba.js"), "text/javascript; charset=utf-8");

    if (p === "/api/n8n/overview") return json(res, 200, await n8n.overview());

    if (p === "/api/n8n/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(": conectado\n\n");
      sseClients.add(res);
      const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 25000);
      req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
      return;
    }

    if (p.startsWith("/api/n8n/graph/")) {
      const id = decodeURIComponent(p.slice("/api/n8n/graph/".length));
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json(res, 400, { error: "id inválido" });
      return json(res, 200, await n8n.getGraph(id));
    }

    // Onde o nó da assinatura realmente vive. Fato, não juízo: o quadro de
    // erros usava o nome do nó ao lado do nome do fluxo como se um pertencesse
    // ao outro, e numa falha de sub-workflow isso é falso.
    if (p.startsWith("/api/n8n/locate/")) {
      const id = decodeURIComponent(p.slice("/api/n8n/locate/".length));
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json(res, 400, { error: "id inválido" });
      const node = url.searchParams.get("node") || "";
      if (!node || node.length > 200 || /[\r\n]/.test(node)) return json(res, 400, { error: "nó inválido" });
      return json(res, 200, await n8n.locateNode(id, node));
    }

    if (p.startsWith("/api/n8n/execution/")) {
      const id = decodeURIComponent(p.slice("/api/n8n/execution/".length));
      if (!/^[0-9]{1,20}$/.test(id)) return json(res, 400, { error: "id inválido" });
      return json(res, 200, await n8n.getDetail(id));
    }

    // Quem chama quem. Um sub-fluxo nunca pode estar `active`, então sem isto a
    // porta de entrada esconde fluxo de produção que está apenas quieto na
    // janela. Fato: id, nome e nó chamador — `parameters` não atravessa.
    if (p === "/api/n8n/callers") {
      return json(res, 200, await n8n.callers({ force: url.searchParams.get("refresh") === "1" }));
    }

    if (p === "/api/projects") {
      return json(res, 200, await listProjects({ refresh: url.searchParams.get("refresh") === "1" }));
    }

    if (p.startsWith("/api/project/")) {
      const name = decodeURIComponent(p.slice("/api/project/".length));
      if (name.includes("/") || name.includes("\\") || name.includes("..")) return json(res, 400, { error: "nome inválido" });
      const d = await detail(name);
      return d ? json(res, 200, d) : json(res, 404, { error: "projeto não encontrado" });
    }

    if (p === "/api/fixes" && req.method === "GET") {
      return json(res, 200, await readFixes());
    }

    if (p === "/api/fixes" && req.method === "POST") {
      const { key, maxExecId, note, undo } = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
      const k = validKey(key);
      if (!k) return json(res, 400, { error: "assinatura inválida" });

      const { fixes, history } = await readFixes();
      const rest = fixes.filter(f => f.key !== k);
      const at = new Date().toISOString();

      if (undo) {
        // Marca a entrada de histórico como desfeita em vez de apagar: a nota
        // continua valendo como "já tentei isso".
        const undone = fixes.find(f => f.key === k);
        const log = history.map(h =>
          (undone && h.key === k && h.markedAt === undone.markedAt && !h.undoneAt)
            ? { ...h, undoneAt: at } : h);
        await writeFixes({ fixes: rest, history: log });
        return json(res, 200, { ok: true, removed: k, fixes: rest, history: log });
      }

      const id = String(maxExecId == null ? "" : maxExecId);
      if (id && !/^[0-9]{1,20}$/.test(id)) return json(res, 400, { error: "execId inválido" });

      // markedAt é só para exibir "corrigido há X" — o discriminador de
      // reincidência é o id de execução, que vem do n8n e é monotônico. Relógio
      // desta máquina versus relógio da instância dá skew, e skew aqui esconde
      // uma falha nova ou reabre uma correção boa sem motivo.
      const entry = {
        key: k,
        markedAt: at,
        maxExecIdAtFix: id || null,
        note: typeof note === "string" && note.trim() ? note.trim().slice(0, 600) : null
      };
      const next = [...rest, entry];
      const log = [...history, entry];
      await writeFixes({ fixes: next, history: log });
      return json(res, 200, { ok: true, fixes: next, history: log });
    }

    /* ---------------------------------------------------------- Tester (v1) */
    // Ideia em português -> blueprint + JSON de workflow, desenhado, validado,
    // provado numa cópia inativa e simulado. Ver PLAN.md.
    if (p === "/tester") return serveFile(res, path.join(__dirname, "tester.html"), "text/html; charset=utf-8");

    if (p === "/api/tester/status") return json(res, 200, tester.status());

    if (p === "/api/tester/blueprints") return json(res, 200, await tester.ledger());

    /* As novidades do n8n. O job diário vive no `novidades.js` e escreve sozinho;
     * estas rotas só mostram e fecham o aviso. `forcar` existe para não ser
     * preciso esperar 24h para ver se funciona — é o mesmo trabalho, adiantado,
     * e não pula portão nenhum. */
    if (p === "/api/novidades" && req.method === "GET") return json(res, 200, novidades.estado());
    if (p === "/api/novidades/fechar" && req.method === "POST") return json(res, 200, await novidades.fecharAviso());
    if (p === "/api/novidades/verificar" && req.method === "POST") {
      const r = await novidades.rodada({ tester, aoDizer: m => console.log("novidades:", m) });
      return json(res, r.ok ? 200 : 502, { ...r, estado: novidades.estado() });
    }

    // Projetos salvos: o que o Tester produziu e o Kauan decidiu guardar.
    if (p === "/api/tester/projetos") return json(res, 200, await tester.listarProjetos());

    /* A lixeira. Excluir um projeto move para cá; apagar de vez é uma decisão
     * tomada aqui dentro, olhando o que vai sumir. Nada disto toca no n8n — um
     * fluxo já importado lá continua lá, e a tela diz isso. */
    if (p === "/api/tester/lixeira" && req.method === "GET") return json(res, 200, await tester.listarLixeira());

    if (p === "/api/tester/lixeira/esvaziar" && req.method === "POST") {
      try { return json(res, 200, await tester.esvaziarLixeira()); }
      catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
    }

    if (p.startsWith("/api/tester/lixeira/")) {
      const resto = p.slice("/api/tester/lixeira/".length);
      const [lixo, acao] = resto.split("/");
      if (!/^[a-z0-9-]{1,64}__[0-9]{14}$/.test(lixo)) return json(res, 400, { error: "identificador inválido" });

      if (acao === "restaurar" && req.method === "POST") {
        try { return json(res, 200, await tester.restaurarProjeto(lixo)); }
        catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }
      if (!acao && req.method === "DELETE") {
        try { return json(res, 200, await tester.excluirDaLixeira(lixo)); }
        catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }
    }

    if (p.startsWith("/api/tester/projeto/")) {
      const resto = p.slice("/api/tester/projeto/".length);
      const [slug, acao] = resto.split("/");
      if (!/^[a-z0-9-]{1,64}$/.test(slug)) return json(res, 400, { error: "identificador inválido" });

      if (!acao && req.method === "GET") {
        // A checklist de credenciais é derivada na leitura, nunca gravada: um
        // projeto salvo antes dela existir ganha a lista ao ser aberto.
        const proj = await tester.lerProjetoParaTela(slug);
        return proj ? json(res, 200, proj) : json(res, 404, { error: "projeto não encontrado" });
      }
      if (!acao && req.method === "DELETE") {
        try { return json(res, 200, await tester.excluirProjeto(slug)); }
        catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }
      if (acao === "renomear" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
        try { return json(res, 200, await tester.renomearProjeto(slug, body.titulo)); }
        catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }
      // Abre o projeto salvo como uma sessão viva: a partir daqui é conversa —
      // perguntar, mudar, acrescentar e tirar, sempre por remendo com diff.
      if (acao === "editar" && req.method === "POST") {
        try { return json(res, 202, await tester.abrirEdicao(slug)); }
        catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }
      // Troca a versão em vigor pela anterior. Desfazer de novo refaz.
      if (acao === "desfazer" && req.method === "POST") {
        try { return json(res, 200, await tester.desfazerEdicao(slug)); }
        catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }
    }

    if (p === "/api/tester/projeto" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
      if (!/^t[a-z0-9]{1,32}$/.test(String(body.id || ""))) return json(res, 400, { error: "id de sessão inválido" });
      const titulo = typeof body.titulo === "string" ? body.titulo.trim().slice(0, 120) : "";
      try {
        return json(res, 200, await tester.salvarProjeto(body.id, titulo));
      } catch (err) {
        return json(res, err.status || 500, { error: String(err && err.message || err) });
      }
    }

    /* A bandeja: onde os anexos esperam antes de a sessão existir.
     *
     * A tela de abertura recebe print e pasta enquanto a pessoa ainda está
     * escrevendo a ideia — não há id de sessão para pendurar isso. Sem a
     * bandeja, a interface teria de segurar os arquivos em memória e mandar tudo
     * no clique de «Começar», que é o corpo gigante que a gravação um-a-um
     * evita. Bandeja abandonada é limpa por idade no boot.
     *
     * Nada aqui interpreta o arquivo: `anexos.js` valida extensão, tamanho e
     * caminho, e recusa devolvendo a frase que a tela mostra. */
    if (p === "/api/tester/anexo" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, ANEXO_BODY_CAP) || "{}");
      try {
        const bandeja = body.bandeja ? String(body.bandeja) : anexos.novaBandeja();
        const dir = anexos.dirBandeja(TESTER_RUNS, bandeja);
        await fsp.mkdir(dir, { recursive: true });
        const atuais = await anexos.inventario(dir);
        const r = await anexos.gravar(dir, { nome: body.nome, rel: body.rel, b64: body.b64 }, atuais);
        // `categoria` atravessa para a tela poder AGRUPAR as recusas de um lote —
        // uma pasta de projeto recusa vários de uma vez, e um aviso por arquivo
        // vira uma coluna em que o último esconde o primeiro.
        if (!r.ok) return json(res, 400, { error: r.motivo, categoria: r.categoria || null, bandeja });
        const lista = await anexos.inventario(dir);
        await anexos.escreverIndice(dir, lista);
        return json(res, 200, { bandeja, anexos: lista, resumo: anexos.resumo(lista) });
      } catch (err) {
        return json(res, err.status || 400, { error: String(err && err.message || err) });
      }
    }

    // Tirar um chip antes de começar. Só apaga dentro de `anexos/` da bandeja —
    // o guarda de caminho está em `anexos.js` e é ele que recusa o resto.
    if (p === "/api/tester/anexo/remover" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
      try {
        const dir = anexos.dirBandeja(TESTER_RUNS, String(body.bandeja || ""));
        await anexos.remover(dir, String(body.arquivo || ""));
        const lista = await anexos.inventario(dir);
        await anexos.escreverIndice(dir, lista);
        return json(res, 200, { bandeja: String(body.bandeja), anexos: lista, resumo: anexos.resumo(lista) });
      } catch (err) {
        return json(res, err.status || 400, { error: String(err && err.message || err) });
      }
    }

    if (p === "/api/tester/session" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
      const ideia = typeof body.ideia === "string" ? body.ideia.trim() : "";
      if (!ideia || ideia.length > 2000) return json(res, 400, { error: "ideia vazia ou longa demais" });
      const NIVEIS = ["nunca mexi", "sei o básico", "sou técnico"];
      const nivel = NIVEIS.includes(body.nivel) ? body.nivel : "sei o básico";
      // A bandeja é validada por formato aqui e pelo próprio `dirBandeja` lá
      // dentro: id de fora do processo nunca vira caminho sem passar por regex.
      const bandeja = /^b[a-f0-9]{6,20}$/.test(String(body.bandeja || "")) ? String(body.bandeja) : null;
      try {
        return json(res, 202, await tester.iniciar({ ideia, nivel, bandeja }));
      } catch (err) {
        return json(res, err.status || 500, { error: String(err && err.message || err) });
      }
    }

    if (p.startsWith("/api/tester/session/")) {
      const resto = p.slice("/api/tester/session/".length);
      const [id, sub] = resto.split("/");
      if (!/^t[a-z0-9]{1,32}$/.test(id)) return json(res, 400, { error: "id de sessão inválido" });

      if (!sub && req.method === "GET") {
        const snap = tester.pegar(id);
        return snap ? json(res, 200, snap) : json(res, 404, { error: "sessão não encontrada" });
      }

      if (sub === "stream") {
        const snap = tester.pegar(id);
        if (!snap) return json(res, 404, { error: "sessão não encontrada" });
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no"
        });
        const manda = (tipo, dados) => {
          try { res.write("event: " + tipo + "\ndata: " + JSON.stringify(dados) + "\n\n"); } catch { /* fechou */ }
        };
        // Snapshot inteiro primeiro: reconexão reconstrói o estado sem depender
        // de ter visto os deltas anteriores.
        manda("snapshot", snap);
        const solta = tester.assinar(id, manda);
        const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* fechou */ } }, 25000);
        req.on("close", () => { clearInterval(ping); solta(); });
        return;
      }

      /* Parar no meio. Sem corpo de propósito: não há nada a parametrizar, e um
       * corpo vazio mantém o Esc da tela a um `fetch` de distância. Escreve
       * ZERO no n8n — mata o processo local e nada mais. */
      if (sub === "cancelar" && req.method === "POST") {
        try {
          return json(res, 200, await tester.cancelar(id));
        } catch (err) {
          return json(res, err.status || 500, { error: String(err && err.message || err) });
        }
      }

      if (sub === "reply" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
        const texto = typeof body.texto === "string" ? body.texto.trim().slice(0, 2000) : null;
        try {
          return json(res, 200, await tester.responder(id, {
            texto: texto || null, seguir: !!body.seguir,
            respostas: Array.isArray(body.respostas) ? body.respostas.slice(0, 24) : null
          }));
        } catch (err) {
          return json(res, err.status || 500, { error: String(err && err.message || err) });
        }
      }

      /* Anexar com a conversa já aberta. Não reinicia etapa: quem dispara a
       * releitura é a mensagem seguinte, pelo caminho de texto livre que já
       * existe. Assim dá para arrastar três arquivos e falar uma vez. */
      if (sub === "anexo" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, ANEXO_BODY_CAP) || "{}");
        try {
          return json(res, 200, await tester.anexar(id, { nome: body.nome, rel: body.rel, b64: body.b64 }));
        } catch (err) {
          return json(res, err.status || 400, {
            error: String(err && err.message || err), categoria: err && err.categoria || null
          });
        }
      }

      if (sub === "desanexar" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
        try {
          return json(res, 200, await tester.desanexar(id, String(body.arquivo || "")));
        } catch (err) { return json(res, err.status || 400, { error: String(err && err.message || err) }); }
      }

      /* A decisão sobre um remendo. É o único ponto em que o arquivo do projeto
       * muda — e ele guarda a versão anterior antes de trocar, então `desfazer`
       * sempre tem para onde voltar. Nada disto escreve num fluxo do n8n: o que
       * a sessão de edição produz é um JSON no disco desta máquina. */
      if (sub === "decidir" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
        try {
          const r = await tester.decidirEdicao(id, !!body.aplicar);
          // Devolve o snapshot, como toda rota que a tela usa para repintar. Um
          // `{aplicado:true}` cru no lugar do snapshot apagaria a tela inteira.
          return json(res, 200, tester.pegar(id) || r);
        } catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }

      /* O desempate de credencial. Local, instantâneo e sem modelo — e nenhum
       * segredo passa por aqui: o corpo carrega o `id` de uma credencial que já
       * existe na instância, nunca um valor. Criar credencial continua sendo no
       * n8n, inclusive porque 7 dos 16 tipos usados nesta conta são OAuth e não
       * se criam colando valor nenhum. */
      if (sub === "credencial" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, 8 * 1024) || "{}");
        const credId = String(body.credId == null ? "" : body.credId);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(credId)) return json(res, 400, { error: "identificador de credencial inválido" });
        try {
          tester.escolherCredencial(id, credId);
          return json(res, 200, tester.pegar(id));
        } catch (err) { return json(res, err.status || 500, { error: String(err && err.message || err) }); }
      }

      // Re-simular é código local: sem modelo, sem custo. É o laço de refino
      // barato que faz a conversa cara ser rara.
      if (sub === "simulate" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, 64 * 1024) || "{}");
        try {
          return json(res, 200, tester.resimular(id, body.sementes));
        } catch (err) {
          return json(res, err.status || 500, { error: String(err && err.message || err) });
        }
      }
    }

    /* ------------------------------------------------- correção pelo Claude */
    // O cockpit deixa de só observar aqui. Ele dispara o Claude Code local,
    // recebe uma PROPOSTA e a mostra como diff. A única rota que escreve no n8n
    // é /approve, e ela só existe para ser clicada depois do diff na tela.

    if (p === "/api/claude/status") {
      return json(res, 200, {
        available: claudeFix.claudeFound && n8n.configured,
        claudeFound: claudeFix.claudeFound,
        claudeBin: claudeFix.claudeBin,
        n8nConfigured: n8n.configured,
        sandboxEnabled: claudeFix.sandboxEnabled
      });
    }

    if (p === "/api/claude/proposals" && req.method === "GET") {
      return json(res, 200, { proposals: await claudeFix.readStore() });
    }

    if (p === "/api/claude/fix" && req.method === "POST") {
      const { key, wfId, briefing, wfName, node, lastNode } = JSON.parse(await readBody(req, 64 * 1024) || "{}");
      if (!validKey(key)) return json(res, 400, { error: "assinatura inválida" });
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(wfId || ""))) return json(res, 400, { error: "id de fluxo inválido" });
      const nodeName = v => (typeof v === "string" && v.trim() && !/[\r\n]/.test(v) ? v.trim().slice(0, 200) : null);
      const out = await claudeFix.start({
        key: String(key),
        wfId: String(wfId),
        wfName: typeof wfName === "string" ? wfName.slice(0, 200) : null,
        // O nó da assinatura e o último nó executado chegam separados porque o
        // n8n reporta falha de sub-workflow no pai: o primeiro pode não existir
        // no grafo, e é o segundo que dá para tratar.
        node: nodeName(node),
        lastNode: nodeName(lastNode),
        briefing: String(briefing || "").slice(0, 40000)
      });
      return json(res, 202, out);
    }

    if (p.startsWith("/api/claude/run/")) {
      const rest = p.slice("/api/claude/run/".length);
      const [rawId, action] = rest.split("/");
      const id = decodeURIComponent(rawId || "");
      if (!/^r[a-z0-9]{1,32}$/.test(id)) return json(res, 400, { error: "run inválido" });

      if (!action && req.method === "GET") {
        const snap = claudeFix.get(id);
        return snap ? json(res, 200, snap) : json(res, 404, { error: "run desconhecido" });
      }

      if (action === "stream" && req.method === "GET") {
        const snap = claudeFix.get(id);
        if (!snap) return json(res, 404, { error: "run desconhecido" });
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no"
        });
        // O snapshot vai primeiro: quem conectou depois do começo precisa do log
        // que já passou, senão a tela abre vazia e parece que nada rodou.
        sseSend(res, "snapshot", snap);
        const off = claudeFix.subscribe(id, ev => { try { sseSend(res, "ev", ev); } catch { off(); } });
        const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* fechado */ } }, 25000);
        req.on("close", () => { clearInterval(keepAlive); off(); });
        return;
      }

      if (action === "approve" && req.method === "POST") return json(res, 200, await claudeFix.approve(id));
      if (action === "reject" && req.method === "POST") {
        const { note } = JSON.parse(await readBody(req, 4 * 1024) || "{}");
        return json(res, 200, await claudeFix.reject(id, note));
      }
      if (action === "revert" && req.method === "POST") return json(res, 200, await claudeFix.revert(id));

      /* A segunda escrita que sai da instância, e a única sem desfazer: manda
         mensagem para pessoa de verdade. O `execId` vem do cliente porque só a
         tela sabe qual execução está em cima (`newestSampleId`) — e por isso
         `claudeFix.retry` reconfere de qual fluxo ela é e se ela falhou, em vez
         de escrever com base no que a página afirmou. */
      if (action === "retry" && req.method === "POST") {
        const { execId } = JSON.parse(await readBody(req, 4 * 1024) || "{}");
        return json(res, 200, await claudeFix.retry(id, execId));
      }

      return json(res, 404, { error: "ação desconhecida" });
    }

    if (p === "/api/reveal" && req.method === "POST") {
      const { name } = JSON.parse(await readBody(req, 4 * 1024) || "{}");
      const opened = revealFolder(path.join(ROOT, String(name || "")));
      return json(res, 200, { ok: true, opened });
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  } catch (err) {
    const upstream = Number(err && err.status);
    // 409 e 503 vêm do claude-fix (proposta em conflito, CLI ausente) e precisam
    // chegar intactos: virar 500 transformaria "o fluxo mudou, revise de novo"
    // em "o cockpit quebrou", que é outra história.
    const passthrough = new Set([400, 404, 409, 413, 503]);
    const code = passthrough.has(upstream) ? upstream
      : upstream === 401 || upstream === 403 ? 502
      : 500;
    json(res, code, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Cockpit em http://localhost:${PORT}`);
  console.log(`Raiz: ${ROOT}`);

  /* O job diário das novidades do n8n.
   *
   * Fica AQUI e não num hook do Claude Code: hook dispara em evento de sessão, e
   * isto tem que acontecer com o Claude fechado. Este processo é o que já fica
   * aberto o dia inteiro.
   *
   * `agendar` bate de hora em hora e o próprio `novidades.js` decide se passaram
   * 24h — então uma máquina desligada por três dias faz UMA rodada ao voltar, em
   * vez de nenhuma. Não depende do n8n estar configurado: o feed é do projeto
   * n8n, não da instância dele. */
  novidades.agendar({ tester, aoDizer: m => console.log("novidades:", m) });
  if (n8n.configured) {
    console.log(`n8n: ${n8n.instance} — poll a cada ${POLL_MS / 1000}s`);
    pollTick();
    setInterval(pollTick, POLL_MS);
    // As corridas do Claude vivem em memória e este processo reinicia a cada
    // edição do servidor. As propostas que ficaram prontas voltam reaplicando o
    // patch sobre o estado atual do fluxo — nenhuma escrita, só GET.
    claudeFix.rehydrate()
      .then(r => { if (r.restored || r.skipped) console.log(`propostas reabertas: ${r.restored} (descartadas: ${r.skipped})`); })
      .catch(err => console.log("não consegui reabrir propostas pendentes:", err.message));
  } else {
    console.log("n8n: NÃO configurado (falta .env com N8N_BASE_URL e N8N_API_KEY)");
  }
  /* Bandeja de anexo que ninguém adotou é lixo com arquivo de alguém dentro:
   * abrir a tela, arrastar uma pasta e fechar o navegador deixa uma para trás.
   * Some por idade, no boot — e o número aparece, porque um diretório que cresce
   * em silêncio é o tipo de coisa que só é descoberta quando o disco enche. */
  anexos.limparBandejas(TESTER_RUNS, 24 * 60 * 60 * 1000)
    .then(n => { if (n) console.log(`bandejas de anexo abandonadas removidas: ${n}`); })
    .catch(err => console.log("não consegui limpar bandejas de anexo:", err.message));
});
