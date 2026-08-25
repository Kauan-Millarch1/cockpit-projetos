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
const upgrade = require("./upgrade");
const conversas = require("./conversas");
const dossie = require("./dossie");
const novidades = require("./novidades");
const anexos = require("./anexos");
/* O estado das três conexões, para a tela `/integracoes`. Emite fato e nada
   mais: quem decide que `respondeu:false` significa "quebrou" é a página. As
   dependências dele entram por parâmetro na rota, não por `require` interno —
   é o que torna o módulo testável com dublês. */
const integracoes = require("./integracoes");
/* Quem é a pessoa, e se ela foi aprovada. FATO — `entrar.html` é quem julga.
   Ver `CONTRATO-PERFIL.md`, e em especial o §0: isto é identidade, não cadeado. */
const perfil = require("./perfil");
/* O cofre da chave do n8n (DPAPI do Windows). Ele existia e ninguém o chamava —
   o `n8n.js` já sabia LER dele, e não havia como escrever. Ver o bloco da rota
   `/api/cofre`. Aqui o `require` é direto (e não guardado como no `n8n.js`)
   porque este arquivo nunca é copiado para fora da pasta do projeto. */
const cofre = require("./cofre");
/* A negociação de UMA resposta estática, como função pura. Fica fora daqui
   porque este arquivo abre porta e conexão SSE: um teste que exercitasse o
   handler não seria de graça. Ver o comentário de `serveFile` abaixo. */
const estatico = require("./estatico");
const guarda = require("./guarda");
/* A cerimonia que ESCREVE o `.agente/pareamento.json` que o `guarda` acima so LE.
 * Fatos: quem decide o que a tela mostra e a tela.
 *
 * O CODIGO DE CONFIRMACAO NAO PASSA POR ROTA NENHUMA, e isso e estrutural e nao
 * prosa -- ver o cabecalho de `pareamento.js`. */
const pareamento = require("./pareamento");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");          // Desktop\Projects
const SELF = path.basename(__dirname);               // "Cockpit Projetos"
const PORT = Number(process.env.PORT || 4317);

/* O portão de login das PÁGINAS. Ligado por padrão; `COCKPIT_LOGIN=0` desliga.
 * Um valor irreconhecível cai no LIGADO — numa permissão, o silêncio é "sim,
 * exija", que é o lado seguro de errar. Ver o bloco do portão lá embaixo. */
const LOGIN_EXIGIDO = !/^(0|nao|não|off|false)$/i.test(String(process.env.COCKPIT_LOGIN || "").trim());

/* Quem está pedindo esta página. FATO: tem sessão, está aprovado, é admin.
 * Ele NUNCA decide o que a tela mostra — só responde as três perguntas que o
 * portão faz. Fail-open quando o Supabase não está configurado, porque exigir
 * login onde login é impossível é recusa sem saída. */
async function quemEsta(req) {
  const cfg = perfil.configurado();
  if (!cfg.ok) return { sessao: true, aprovado: true, admin: true, semSupabase: true };
  const bruto = (req.headers && req.headers.cookie) || "";
  const m = /(?:^|;\s*)cockpit_sessao=([A-Za-z0-9_-]{1,64})(?:;|$)/.exec(bruto);
  if (!m) return { sessao: false, aprovado: false, admin: false };
  try {
    const t = await perfil.tokenValido(cfg, m[1]);
    if (!t.ok) return { sessao: false, aprovado: false, admin: false };
    const r = await perfil.perfilDe(cfg, t.access, t.sub);
    const pf = r.ok ? r.perfil : null;
    if (!pf) {
      /* Sessão boa e perfil ilegível é problema NOSSO, e trancar por causa dele
         seria acusar a conta da pessoa por uma falha nossa — o mesmo erro que o
         `docAgentes` cometeu ao dizer que o arquivo não existia. Deixa passar
         para a tela de conta, que sabe dizer que não conferiu. */
      return { sessao: true, aprovado: false, admin: false, ilegivel: true };
    }
    return {
      sessao: true,
      aprovado: pf.status === "aprovado",
      admin: pf.super_admin === true ||
        (pf.papel === "admin" && pf.status === "aprovado" && !!pf.organizacao_id)
    };
  } catch {
    /* Supabase fora do ar não pode trancar o painel: o cockpit trabalha contra o
       n8n, não contra o Supabase, e derrubar tudo por causa de um terceiro seria
       transformar indisponibilidade dele em indisponibilidade nossa. */
    /* MAS `admin` NAO ACOMPANHA, e a assimetria e a correcao: DISPONIBILIDADE erra
       para o lado aberto, PRIVILEGIO erra para o lado fechado. Enquanto os dois
       vinham `true` do mesmo objeto, um operador aprovado — ou uma conta `pendente`
       com cookie vivo — mandava `POST /api/cofre` durante uma queda do Supabase (ou
       so estourando o `AbortController` de 15s sob carga) e sobrescrevia a chave do
       n8n. `perfil.chamar()` tem `try/finally` SEM `catch`, entao a rejeicao do
       `fetch` chega aqui inteira: o galho nao e hipotetico, e o galho normal de
       indisponibilidade. `semResposta` viaja para quem precisa dizer "nao consegui
       conferir quem voce e" — frase diferente de "voce nao e admin", e as duas
       mandam a pessoa para lugares opostos. */
    return { sessao: true, aprovado: true, admin: false, semResposta: true };
  }
}
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

/* DETALHE-INI — delimitador lido por `estatico-servidor-test.js`; ele extrai este
 * bloco do fonte e o dirige com um `detail` falso que CONTA as varreduras. */
/* O detalhe de um projeto, com cache — e a escolha do critério é o ponto.
 *
 * MEDIDO antes de existir: 4,79s na primeira chamada e ~1,08s em toda chamada
 * seguinte, para o mesmo projeto, sem cache nenhum. `detail()` roda `walkProject`
 * mais `scanTodos`, que lê até `TODO_FILE_CAP` (400) arquivos inteiros e passa uma
 * regex por linha — a cada clique. O vizinho `/api/projects` já tinha cache de 15
 * minutos; só o detalhe pagava a varredura outra vez.
 *
 * TTL, NÃO mtime, e este projeto escolhe mtime em três outros lugares (o cache do
 * `esquema`, o cache do `estatico.js`, a impressão digital do dossiê), então a
 * divergência precisa de razão:
 *
 *  - Naqueles três o dono do dado é UM arquivo, e `stat` responde por ele em uma
 *    syscall. Aqui o dono é uma árvore de até 6000 arquivos, e a única chave por
 *    mtime honesta seria o mtime de todos eles — que é justamente a varredura que
 *    este cache existe para não repetir. Chavear por mtime custaria o que custa
 *    não ter cache.
 *  - Existe um atalho tentador e ele é falso: `fs.stat(dir).mtimeMs`. O mtime de
 *    um diretório só se move quando uma ENTRADA é criada ou removida nele — editar
 *    o conteúdo de um arquivo já existente não mexe nele, e nem sequer no do
 *    diretório pai. Ou seja: reportaria "não mudou" exatamente na edição mais
 *    comum. Seria a obsolescência silenciosa que este repositório recusa em toda
 *    parte, com cara de precisão.
 *  - São 15 minutos porque é o número que `/api/projects` já usa, sobre a MESMA
 *    varredura do MESMO disco. Dois horizontes de frescor para o mesmo fato na
 *    mesma tela seriam duas idades para uma coisa só.
 *
 * E o que torna o TTL aceitável aqui é que a resposta diz a própria idade:
 * `scannedAt` viaja no payload e a página renderiza o do payload, nunca
 * `new Date()` — regra que o `CLAUDE.md` já fixou. Um detalhe de 12 minutos
 * aparece na tela como um detalhe de 12 minutos.
 *
 * Em MEMÓRIA e não em `.cache-*.json`: é derivado, se reconstrói em ~1s, e o
 * `/api/projects` já grava o índice em disco. Um segundo arquivo (ou 21) por causa
 * do detalhe custaria gitignore, versão de formato e leitura de disco para
 * economizar um segundo que só se paga uma vez por processo.
 *
 * `?refresh=1` fura, igual `/api/projects`. */
const DETALHE_TTL = 15 * 60 * 1000;
/* 21 projetos hoje; o teto existe para o dia em que a raiz tiver 200 e cada
 * entrada carregar 6KB de CLAUDE.md mais a lista de arquivos recentes. Um `Map`
 * preserva ordem de inserção, então o primeiro a sair é o mais antigo. */
const DETALHE_CAP = 40;
const detalheCache = new Map();
/* Duas chamadas para o mesmo projeto ao mesmo tempo — dois cliques, ou a tela
 * abrindo enquanto o poll roda — faziam DUAS varreduras de 1s. Aqui a segunda
 * espera a primeira em vez de repeti-la. Não é cache: é a mesma resposta. */
const detalheEmVoo = new Map();

async function detalheComCache(name, { refresh = false } = {}) {
  if (refresh) { detalheCache.delete(name); detalheEmVoo.delete(name); }
  else {
    const hit = detalheCache.get(name);
    if (hit && Date.now() - hit.at < DETALHE_TTL) return hit.valor;
    const voando = detalheEmVoo.get(name);
    if (voando) return voando;
  }

  const p = (async () => {
    const d = await detail(name);
    /* Projeto inexistente NÃO entra no cache: `detail` devolve `null` e a rota
     * responde 404. Guardar o `null` por 15 minutos faria uma pasta criada agora
     * continuar "não encontrada" — e o sintoma manda procurar defeito na rota. */
    if (d) {
      detalheCache.set(name, { at: Date.now(), valor: d });
      while (detalheCache.size > DETALHE_CAP) detalheCache.delete(detalheCache.keys().next().value);
    }
    return d;
  })();

  detalheEmVoo.set(name, p);
  try { return await p; }
  finally { detalheEmVoo.delete(name); }
}
/* DETALHE-FIM */

/* -------------------------------------------------------------------- server */

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    /* Os mesmos quatro cabecalhos que o `estatico.js` poe nas paginas, lidos DE LA
       para nao virarem segunda copia — sao quatro strings que ninguem rele, e a
       que divergisse seria a que ninguem olhou. `frame-ancestors` carrega o bloco:
       sem ele o painel e enquadravel e o clique em "Aprovar e aplicar" sai
       `same-origin`, que o `guarda.js` permite CERTO, porque o clique e real —
       clickjacking so se fecha impedindo o enquadramento.

       Aqui vale por um motivo a mais que nas paginas: estas respostas carregam
       conversa de lead, telefone mascarado e `runId`. `nosniff` e `no-referrer`
       importam mais numa resposta de dado do que numa de HTML. */
    ...estatico.SEGURANCA,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(s)
  });
  res.end(s);
}

/* ESTATICO-INI — não mexa nos delimitadores: `estatico-servidor-test.js` extrai
 * este bloco do fonte em tempo de execução e o dirige com um `res` falso.
 * Reimplementar a função no teste provaria a cópia, não o comportamento — a
 * mesma disciplina de `audio-test.js` e `dossie-tela-test.js`.
 *
 * O QUE MUDOU AQUI, e por que não é uma otimização gratuita:
 *
 * Antes: um `fs.readFile` por request e `res.end(buf)` sem `content-length`, o
 * que sai como `Transfer-Encoding: chunked`, sem `ETag`, sem `Last-Modified` e
 * sem `Vary`. Medido: `curl -H 'If-None-Match: "abc"' /upgrade` devolvia 200 com
 * 388.730 bytes, e cada travessia entre as quatro portas re-baixava ~1MB de HTML
 * mais os dois `.js` compartilhados. Os validadores que o navegador já mandava
 * eram simplesmente ignorados.
 *
 * Agora: `estatico.negociar()` decide. Ele é PURO e mora noutro arquivo por um
 * motivo — este handler abre porta e conexão SSE, então não dá para exercitá-lo
 * de graça. O que ele decide (gzip uma vez por mtime e servido do buffer, `ETag`
 * fraco de tamanho+mtime, `304`, `Vary`, `HEAD`) está documentado lá e não se
 * decide nada aqui: aqui só se lê o `stat`, se chama, e se escreve.
 *
 * `no-store` VIROU `no-cache`, e isto é a única linha desta mudança que precisa
 * de defesa. A decisão documentada do `/aba.js` é "editar o arquivo e recarregar
 * tem que valer". `no-cache` não é "não guarde", é "guarde e PERGUNTE antes de
 * usar": o navegador revalida sempre, então continua impossível ver uma versão
 * velha — o que muda é que a resposta a "não mudou" passa a ser um `304` de
 * poucas centenas de bytes em vez do arquivo inteiro. Quem quebraria a decisão
 * seria `max-age`, que serve velho sem perguntar; esse não está aqui.
 *
 * A LEITURA É SÍNCRONA, de propósito. `negociar` só chama `ler()` quando o corpo
 * é de fato necessário — num `304` não chama, e é aí que está a maior parte do
 * ganho — então o custo bloqueante é pago uma vez por edição do arquivo, não por
 * request. Um `ler` assíncrono obrigaria a pré-ler o arquivo antes de saber se o
 * corpo é necessário, que é exatamente o que esta camada existe para não fazer.
 *
 * O `stat` é síncrono pela mesma razão que `json()` é: é uma syscall de metadado
 * num arquivo local (medido em 0,02ms), e a alternativa assíncrona mudaria a
 * semântica de `return serveFile(...)` dentro do `try` do handler — `return
 * promise` não passa pelo `catch`, então uma falha viraria unhandled rejection e
 * request pendurado em vez de 404.
 *
 * O tipo agora vem de `estatico.tipoDe(ext)`, então o parâmetro `type` saiu: dois
 * lugares declarando o MIME do mesmo arquivo é a divergência de sempre. Efeito
 * colateral declarado: os dois `.js` passam de `text/javascript` para
 * `application/javascript` — ambos são válidos e nenhum navegador distingue.
 *
 * O SSE NÃO PASSA POR AQUI, e não pode passar nunca. São quatro rotas de stream e
 * todas escrevem o próprio `writeHead` com `text/event-stream`. Um gzip ali não
 * deixa o painel lento, deixa MUDO — o stream de gzip segura os bytes até fechar
 * o bloco — e o sintoma é "o cockpit travou" sem nada no console. `estatico.js`
 * tem `text/event-stream` numa constante de recusa à parte, e
 * `estatico-servidor-test.js` falha se qualquer um dos quatro `writeHead` ganhar
 * `content-encoding`. */
function serveFile(req, res, file) {
  let st;
  try { st = fs.statSync(file); }
  catch { res.writeHead(404, { ...estatico.SEGURANCA, "content-type": "text/plain; charset=utf-8" }); return res.end("not found"); }
  if (!st.isFile()) { res.writeHead(404, { ...estatico.SEGURANCA, "content-type": "text/plain; charset=utf-8" }); return res.end("not found"); }

  let r;
  try {
    r = estatico.negociar(
      req,
      { caminho: file, ext: path.extname(file), tamanho: st.size, mtimeMs: st.mtimeMs },
      () => fs.readFileSync(file)
    );
  } catch (err) {
    /* O arquivo existia no `stat` e sumiu antes do `read`, ou o gzip estourou. É
     * 500 e não 404: 404 diria "esta rota não existe", que é a mentira que este
     * repositório já pagou três vezes — e manda quem lê procurar um processo
     * velho em vez do erro de verdade. */
    res.writeHead(500, { ...estatico.SEGURANCA, "content-type": "text/plain; charset=utf-8" });
    return res.end("não consegui servir " + path.basename(file) + ": " + String(err && err.message || err));
  }

  res.writeHead(r.status, r.headers);
  return r.body ? res.end(r.body) : res.end();
}
/* ESTATICO-FIM */

// Reveal a project folder in Explorer. Not a mutation, but still guard the path.
function revealFolder(target) {
  const resolved = path.resolve(target);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) throw new Error("fora da raiz");
  if (!exists(resolved)) throw new Error("pasta não existe");
  /* E TEM QUE SER PASTA. `explorer.exe <arquivo>` nao abre a pasta do arquivo: ele
     ABRE O ARQUIVO, com o programa que o Windows associa a extensao — um .bat, um
     .ps1, um .lnk, um .hta. A guarda de raiz acima prova que o caminho esta dentro
     de `ROOT`, e `ROOT` e a pasta de projetos, ou seja, exatamente onde qualquer
     coisa que o Kauan clonou pode ter deixado um arquivo executavel. "Dentro da
     raiz" nunca quis dizer "inofensivo" — quis dizer "nao e travessia".
     A metade CSRF disto ja fechou com o `guarda` (requisicao de outro site cai em
     `estranha` e leva 403); o que sobra e um cliente local, e um cliente local e
     precisamente o que um XSS de primeira parte vira. */
  if (!fs.statSync(resolved).isDirectory()) throw new Error("isto e um arquivo, nao uma pasta");
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

/* O corpo maior do pareamento e o `iniciar`: quatro URLs e um identificador de
   conta. 4 KB e folga de sobra, e barra um corpo trocado por lixo ANTES de
   qualquer `JSON.parse` -- que e o que o `readBody` sem teto deixava passar. */
const PAREAMENTO_BODY_CAP = 4 * 1024;
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

/* Cache do peso da vitrine. TTL e não mtime: o dono do dado é o n8n, não um
 * arquivo no disco, e um fluxo editado lá muda de tamanho sem avisar ninguém
 * aqui. 15 min é o mesmo passo do call graph, pelo mesmo motivo — é caro e
 * envelhece devagar. */
const pesoCache = new Map();
const PESO_TTL = 15 * 60 * 1000;

/* O documento como a sessão o leria: sem `credentials`, em nenhum nó e em
 * nenhuma profundidade. O `claude-fix.js` já tem `sanitizedWorkflow`, mas ele
 * carrega o resto do ciclo de vida de uma run; aqui só o tamanho importa, e uma
 * função de três linhas é mais honesta que importar aquele módulo por causa de
 * um `JSON.stringify`. */
function semCredenciais(w) {
  const nodes = (w.nodes || []).map(n => {
    const o = {};
    for (const k of Object.keys(n)) if (k !== "credentials") o[k] = n[k];
    return o;
  });
  return { name: w.name, nodes, connections: w.connections || {}, settings: w.settings || {} };
}

/* ══════════════════════════ A ESCRITA DO DOSSIÊ ═══════════════════════════
 *
 * Uma escrita leva minutos (medido: 514s no eContrate de 103 nós, 682s no Iago de
 * 179), então a rota NÃO espera por ela: o POST devolve 202 e a tela pergunta o
 * estado, que ela já pergunta de qualquer forma. Segurar a resposta por 11
 * minutos seria um fetch que qualquer proxy ou sleep da máquina derruba no meio,
 * e aí o dossiê ficaria escrito com a tela dizendo que falhou.
 *
 * Um job por vez. FATOS apenas: o que está rodando, a última atividade, e o que
 * saiu no fim. */
let dossieJob = null;

function dossieResumo() {
  if (!dossieJob) return null;
  const { wfId, nome, escrevendo, comecouEm, modoPedido, atividade, resultado, erro, automatico,
    etapa, etapaI, etapaTotal, rodada, rodadas, duracao } = dossieJob;
  /* `modoPedido`, NUNCA `modo`: o que viaja aqui é o que a página PEDIU, e
     `construir` reconsulta a admissão na hora de escrever e pode cair para rewrite
     inteiro de graça. Chamar isto de `modo` seria a tela afirmando que a escrita em
     curso é parcial sem ter como saber — e a linha de atividade é quem diz o que
     realmente aconteceu, porque ela vem do `diz` de dentro da escrita. */
  /* `automatico` viaja porque a tela tem de poder dizer QUEM mandou: "o dossie
     esta sendo escrito" ao lado de um recibo de apply, sem dizer que a escrita
     comecou sozinha, deixa a pessoa procurando o clique que ela nao deu. */
  /* A POSIÇÃO E A RÉGUA, e NENHUMA PORCENTAGEM: `etapa`/`etapaI`/`etapaTotal` e
     `rodada`/`rodadas` são o que se mediu, `duracao` é a mediana do histórico desta
     máquina para o modo pedido. O que isso vale numa barra — quanto por cento, que
     cor, que frase — é juízo da página, do mesmo jeito que a cor do semáforo sai do
     `dossie.estado()` e a banda quem escreve é o `upgrade.html`. Um denominador
     calculado aqui seria uma segunda régua ao lado da que a tela desenha. */
  /* `recusas` VIAJA, e ja limpa desde a origem (ver o `.then` do `iniciarDossie`).
     Sem ela a telinha so consegue dizer que a escrita reprovou, e "reprovou" sem
     dizer em QUE e um desfecho que nao decide nada: reprovar por parametro vazado
     manda consertar a prosa, reprovar por secao faltando manda escrever de novo.
     Uma rodada reprovada gastou cota — esconder o motivo dela seria o "gasto
     invisivel" que o §2.3.1 nomeia como o risco desta aba. */
  return { wfId, nome, escrevendo, comecouEm, modoPedido, atividade, resultado, erro, automatico: !!automatico,
    etapa, etapaI, etapaTotal, rodada, rodadas, duracao, recusas: dossieJob.recusas || null };
}

/* ─────────────────── O SEMÁFORO DE UM FLUXO, EM CACHE COMPARTILHADO ────────
 *
 * UMA definição, dois consumidores: a faixa da tela do fluxo (`dossieEstado`) e o
 * selo do cartão da vitrine (a varredura, abaixo). Duas caches teriam duas idades
 * e as duas telas discordariam sobre a MESMA pergunta — o cartão dizendo verde
 * enquanto a faixa diz vermelho é a pior forma de errar aqui, porque a segunda é
 * quem trava a conversa. Então quem lê o estado de um fluxo escreve nesta cache, e
 * quem varre a vitrine lê dela.
 *
 * A COR sai do `dossie.estado()` sempre — este arquivo não decide o que é "em
 * dia". Erro de leitura NÃO é cacheado: guardar 15 minutos de "não deu para ler"
 * faria o painel continuar acusando um n8n que já voltou.
 *
 * SEM `.md` NÃO HÁ LEITURA DO N8N. `estado(null, wf)` responde cinza sem olhar o
 * fluxo, então a varredura de 75 cartões custa uma leitura por fluxo que TEM
 * dossiê — hoje 2 — e zero pelos outros. A medição do plano (18,3s para 75 de 75)
 * é o teto de uma máquina onde todos tivessem dossiê, não o custo de hoje. */
const DOSSIE_COR_TTL = 15 * 60 * 1000;
const dossieCorCache = new Map();   // wfId -> { at, valor }

function guardarCor(wfId, valor) {
  dossieCorCache.set(String(wfId), { at: Date.now(), valor });
  return valor;
}

/* Só o que o cartão precisa, e nada além: cor, motivo, contagens e a data da
   leitura que gerou a prosa. Nenhum parâmetro, nenhuma credencial, nenhum nome de
   nó — `mudados` fica de fora de propósito, porque o cartão não mostra a lista e
   `getRawWorkflow` é o buraco deliberado da whitelist. */
function fatiaCor(st, doc) {
  return {
    cor: st.cor, motivo: st.motivo,
    quantosMudados: st.mudados.length,
    quantosEntraram: st.entraram.length,
    quantosSairam: st.sairam.length,
    em: doc ? doc.em : null
  };
}

async function corDoDossie(wfId, { force = false } = {}) {
  const k = String(wfId);
  const c = dossieCorCache.get(k);
  if (!force && c && Date.now() - c.at < DOSSIE_COR_TTL) return c.valor;

  const doc = await dossie.ler(k);
  if (!doc) return guardarCor(k, fatiaCor(dossie.estado(null, null), null));

  // Um throw aqui sobe para quem varre, que conta a falha. Não cacheado.
  const raw = await n8n.getRawWorkflow(k);
  return guardarCor(k, fatiaCor(dossie.estado(doc, raw), doc));
}

/* A VARREDURA. Os ids vêm do cliente — quem chega na vitrine é juízo da página
 * (`naPorta`), e decidir isso aqui seria o servidor julgando. Mesma forma do
 * `/api/upgrade/peso`, que já pede `?ids=` pelo mesmo motivo.
 *
 * `falhas` não é decoração: com leitura incompleta, "nenhum dossiê apodreceu"
 * deixa de ser uma afirmação que o painel pode fazer. Mesma razão pela qual
 * `callers` reporta `falhas`. Um fluxo que falhou vira `{id, erro}` — nunca cinza,
 * que significa "nunca foi escrito" e levaria à decisão oposta. */
async function varrerDossies(ids) {
  const dossies = [];
  let lidos = 0, falhas = 0;
  for (const id of ids) {
    /* Uma escrita em curso é FATO e muda o que o cartão pode dizer: a cor no disco
       é a antiga, e "sem dossiê" ao lado de uma sessão escrevendo o dossiê é a tela
       contando a metade errada. Vai no MESMO campo `job` da rota de um fluxo só —
       um segundo nome para o mesmo fato faria o veredito da página (`podeConversar`)
       ver a escrita numa tela e não ver na outra.
       E ELA CARREGA A POSIÇÃO INTEIRA PELO MESMO MOTIVO: o cartão precisa poder
       desenhar A MESMA BARRA da telinha do fluxo, e uma barra alimentada por meia
       fatia aqui e pela fatia inteira lá seriam DUAS fontes de verdade para o mesmo
       fato — a vitrine dizendo "escrevendo" sem posição enquanto a outra tela mostra
       80%, sobre a mesma escrita. `comecouEm` entra junto porque sem ele não há
       decorrido, e sem decorrido a `duracao` não vira nada.
       E NADA ALÉM DISTO: nenhum nome de nó, nenhum parâmetro, nenhum caminho de
       arquivo — a mesma linha que o `fatiaCor` já respeita. */
    const job = dossieJob && dossieJob.escrevendo && String(dossieJob.wfId) === String(id)
      ? { escrevendo: true, atividade: dossieJob.atividade, comecouEm: dossieJob.comecouEm,
          etapa: dossieJob.etapa, etapaI: dossieJob.etapaI, etapaTotal: dossieJob.etapaTotal,
          rodada: dossieJob.rodada, rodadas: dossieJob.rodadas, duracao: dossieJob.duracao }
      : null;
    try { dossies.push({ id, job, ...(await corDoDossie(id)) }); lidos++; }
    catch (e) { dossies.push({ id, job, erro: String(e && e.message || e).slice(0, 160) }); falhas++; }
  }
  return { dossies, lidos, falhas, geradoEm: new Date().toISOString() };
}

/* `incremental` É PEDIDO, e o pedido vem da PÁGINA — o servidor não decide que uma
   escrita parcial basta, do mesmo jeito que não decide quem chega na vitrine. Sem a
   flag isto continua sendo o rewrite inteiro que sempre foi, byte por byte. */
function iniciarDossie(wfId, { incremental = false, automatico = false } = {}) {
  /* O JOB É CAPTURADO NUMA CONSTANTE, e não é estilo: `dossieJob` é um SINGLETON
     que a próxima escrita — de qualquer fluxo — substitui, e os dois retornos
     assíncronos abaixo (a régua e cada etapa) chegam depois. Escrevendo no
     `dossieJob` corrente, a régua de uma escrita apareceria na tela de outra, num
     modo diferente e num fluxo diferente: um denominador que não descreve nada do
     que está na tela. Escrevendo no capturado, o que chega tarde cai num objeto que
     ninguém mais está lendo, que é o final certo. */
  const job = dossieJob = { wfId, nome: wfId, escrevendo: true, comecouEm: new Date().toISOString(),
    modoPedido: incremental ? "incremental" : "inteiro", automatico: !!automatico,
    atividade: "lendo o fluxo",
    /* A POSIÇÃO NASCE EM `preparando`, nunca em `null`: a escrita já começou quando
       esta linha roda, e `null` aqui a tela leria como "ainda não começou" numa
       sessão que está lendo o fluxo neste instante. Ela também NÃO é zerada no fim —
       parada em `escrevendo` com `escrevendo: false` ao lado, ela diz ONDE a escrita
       morreu, que é o fato que alguém procura depois de uma falha. Quem decide que a
       escrita acabou é o `escrevendo`, nunca a etapa. */
    etapa: dossie.ETAPAS[0], etapaI: 1, etapaTotal: dossie.ETAPAS.length,
    rodada: null, rodadas: null,
    /* TRÊS ESTADOS, e é a sétima vez que este repositório escreve esta regra:
       `null` aqui quer dizer "AINDA NÃO SEI" — a leitura do ledger é assíncrona e a
       rota devolve 202 sem esperar por ela. "Medi e não tem histórico" é
       `{ medianaMs: null, amostras: N }`, que é OUTRA coisa e leva à decisão oposta:
       com o primeiro a tela continua perguntando, com o segundo ela desenha
       indeterminado e diz por quê. O AUSENTE NUNCA CAI NO RAMO NEGATIVO — uma tela
       que lesse `null` como "sem histórico" desenharia indeterminado para sempre
       numa máquina que tem régua. */
    duracao: null,
    resultado: null, erro: null };
  /* A RÉGUA É RESOLVIDA UMA VEZ SÓ, e fora do caminho da resposta: a rota devolve
     202 e a tela pergunta o estado depois, então segurar o retorno por uma leitura
     de disco só atrasaria o 202 sem ninguém ganhar nada. Uma vez porque ela não muda
     durante a escrita: a linha desta escrita só entra no ledger no fim.
     A LEITURA QUE FALHA DEIXA `null`, isto é, "ainda não sei". Escrever
     `amostras: 0` no `catch` seria afirmar uma medição que não aconteceu — o mesmo
     ramo negativo que o comentário acima existe para não deixar ninguém tomar. */
  dossie.duracao(incremental ? "incremental" : "inteiro")
    .then(d => { job.duracao = { medianaMs: d.medianaMs, amostras: d.amostras }; })
    .catch(() => { /* fica `null`: não sei, e não digo que medi */ });
  if (automatico) {
    anotarAuto(wfId, { estado: "correndo", razao: incremental ? "incremental" : "inteiro",
      incremental: !!incremental,
      porque: "a atualizacao automatica comecou depois de aplicar o patch" });
  }
  dossie.construir(wfId, { incremental, automatico, aoDizer: t => { if (dossieJob) dossieJob.atividade = String(t).slice(0, 160); },
    /* SÓ COPIA O QUE VEIO. Nenhuma porcentagem é calculada aqui e nenhum campo é
       derivado: `i` e `total` vêm da lista fechada do `dossie.js`, que é a única
       dona de quantas etapas existem. Derivar o total aqui seria a segunda régua
       que este arquivo passa o tempo todo recusando. */
    aoEtapa: e => { job.etapa = e.etapa; job.etapaI = e.i; job.etapaTotal = e.total; job.rodada = e.rodada; job.rodadas = e.rodadas; } })
    .then(r => {
      /* A cache do semáforo morre aqui, dê no que der: escreveu, o `.md` é outro;
         falhou, o `.md` pode ter sido reescrito no meio de qualquer forma. Manter
         15 minutos de cor velha depois de uma escrita seria a vitrine dizendo "sem
         dossiê" sobre o dossiê que acabou de nascer. */
      dossieCorCache.delete(String(wfId));
      if (!dossieJob) return;
      dossieJob.escrevendo = false;
      if (r.ok) { dossieJob.resultado = { nos: r.nosRegenerados, bytes: r.bytes, ms: r.ms, usd: r.usd, rodadas: r.rodadas }; }
      /* Falhou: o motivo vem para a tela. Uma escrita reprovada gastou cota e não
         produziu nada, e o ledger já registra isso — a tela tem de poder dizer o
         mesmo em vez de voltar para "sem dossiê" como se nada tivesse acontecido. */
      /* A RECUSA ENTRA JA LIMPA, e nao no momento de emitir. `vazou()` cita o
         trecho que vazou de proposito — e o `dossieJob` e lido por mais de um
         lugar, entao guardar o cru aqui deixaria a fronteira dependendo de todo
         futuro consumidor lembrar de limpar. `dossie.recusaLimpa` e a UNICA
         definicao dessa limpeza; o `dossies.json` usa a mesma. */
      else { dossieJob.erro = r.erro; dossieJob.recusas = (r.recusas || []).map(dossie.recusaLimpa).slice(0, 4); }
      /* O DESFECHO DO AUTOMATICO NAO PODE MORAR SO NO `dossieJob`: ele e um
         singleton e a proxima escrita — de qualquer fluxo — o sobrescreve. Uma
         escrita automatica que reprovou nos portoes ou estourou o teto ficaria
         invisivel na tela do fluxo que ela deixou velho, que e exatamente o
         "dossie que ele acredita fresco e esta velho" que este desenho existe para
         impedir. Por isso ela e ANOTADA por fluxo, aqui e no `catch`. */
      if (automatico) {
        anotarAuto(wfId, r.ok
          ? { estado: "escreveu", razao: r.modo === "incremental" ? "incremental" : "inteiro",
              incremental: r.modo === "incremental",
              regenerados: r.nosRegenerados, herdados: r.nosHerdados || 0,
              usd: r.usd, usdDesconhecido: !!r.usdDesconhecido, ms: r.ms, rodadas: r.rodadas,
              porque: "a atualizacao automatica escreveu o dossie" }
          : { estado: "falhou", razao: "reprovou", incremental: r.modo === "incremental",
              porque: String(r.erro || "a escrita automatica nao terminou"),
              /* ISTO VAZAVA, e vazava para a tela: `autoUltimo` e servido em
                 `/api/upgrade/dossie/:id`, entao uma escrita AUTOMATICA que
                 reprovasse no portao de vazamento mandava o trecho vazado —
                 telefone do lead, chave de sessao — para a tela do fluxo, que e
                 exatamente o valor que aquele portao existe para nao deixar sair.
                 O `slice(0, 160)` nunca foi protecao: cortar em 160 preserva um
                 telefone inteiro. */
              recusas: (r.recusas || []).map(dossie.recusaLimpa).slice(0, 3) });
      }
    })
    .catch(e => {
      if (dossieJob) { dossieJob.escrevendo = false; dossieJob.erro = String(e && e.message || e).slice(0, 300); }
      /* A trava por fluxo do `dossie.js` recusa com 409 e a recusa chega COMO
         EXCECAO. Ela e um final legitimo — "pulado, ja tem uma escrita rodando" —
         e sem esta linha ela sairia da tela como silencio. */
      if (automatico) {
        anotarAuto(wfId, { estado: "falhou", razao: "quebrou", incremental: !!incremental,
          porque: String(e && e.message || e).slice(0, 300) });
      }
    });
}

/* ─────────── O DESFECHO DA ATUALIZACAO AUTOMATICA, POR FLUXO ───────────────
 *
 * DECISAO EXPLICITA DO KAUAN, e ela flexibiliza o §2.8 do PLAN-UPGRADE ("nada
 * regenera sozinho"). Ele pediu que aplicar um upgrade atualize o dossie sozinho,
 * ouviu a ressalva do gasto invisivel que o §2.3.1 nomeia como o risco desta aba, e
 * reafirmou. O desenho que separa isso de uma armadilha mora no `dossie.js`
 * (`decidirAuto`): automatico e INCREMENTAL, e por padrao heranca recusada NAO
 * gasta.
 *
 * O QUE ESTE MAPA EXISTE PARA IMPEDIR: um final silencioso. Um dossie que ele
 * ACREDITA fresco e esta velho e pior que um que ele sabe velho — a conversa
 * seguinte remenda a partir de descricao errada com o semaforo dizendo verde. Cada
 * final tem de aparecer na tela, e o `dossieJob` nao serve para isso: e um
 * singleton que a proxima escrita sobrescreve.
 *
 * FATO, nunca veredito: o que entra aqui e `estado`, `razao`, `porque` e numeros.
 * Nenhuma COR e escrita, nem aqui nem em lugar nenhum deste caminho — a rede final
 * e o `estado()`, que continua medindo a divergencia real contra o fluxo vivo. Um
 * automatico que marcasse "em dia" por ter TENTADO seria o dossie falso-fresco de
 * novo, agora escrito por nos.
 *
 * CAP porque e memoria de processo: 75 fluxos cabem, mas um mapa sem teto num
 * processo que fica aberto o dia todo e um vazamento pequeno que ninguem ve. */
const AUTO_ULTIMO_CAP = 200;
const autoUltimo = new Map();   // wfId -> { em, estado, razao, porque, ... }

function anotarAuto(wfId, linha) {
  const k = String(wfId);
  autoUltimo.delete(k);
  autoUltimo.set(k, Object.assign({ em: new Date().toISOString() }, linha));
  while (autoUltimo.size > AUTO_ULTIMO_CAP) autoUltimo.delete(autoUltimo.keys().next().value);
}

/* TRES ESTADOS, e o ausente NAO cai no ramo negativo — sexta vez que este
   repositorio escreve isso, e aqui o ramo negativo perigoso e "o automatico nao
   rodou": `suportado` diz que ESTE processo conhece o campo, `modo` diz em que modo
   ele subiu, e `ultimo` e `null` quando nenhuma tentativa foi registrada para este
   fluxo. Sem o `suportado`, um cockpit que subiu antes desta versao (Node nao
   recarrega `server.js`) responderia sem o campo e a tela leria isso como "o
   automatico nao fez nada" — a mesma classe de defeito do `docAgentes` ausente
   lido como arquivo inexistente. */
function fatiaAuto(wfId) {
  return {
    suportado: true,
    modo: dossie.AUTO.modo,
    reconhecido: dossie.AUTO.reconhecido,
    bruto: dossie.AUTO.bruto,
    ultimo: autoUltimo.get(String(wfId)) || null
  };
}

/* O GATILHO. Ele roda DEPOIS de a rota ter respondido o apply (ver `acao ===
 * "aplicar"`), e por isso nao devolve nada que alguem espere: quem quiser o desfecho
 * pergunta o estado do dossie, que a tela ja pergunta de qualquer forma.
 *
 * ELE NAO PODE JOGAR. Um `throw` aqui viraria `unhandledRejection` num caminho que
 * ninguem esta esperando, e o processo que serve o cockpit cairia por causa de uma
 * leitura de dossie. Todo final sai como linha anotada.
 *
 * A COR EM CACHE E APAGADA, NUNCA ESCRITA. O fluxo acabou de mudar, entao qualquer
 * cor guardada e de ANTES do patch e a vitrine a mostraria por ate 15 minutos.
 * Apagar remove uma afirmacao velha; escrever afirmaria uma nova, e a unica coisa
 * autorizada a afirmar cor aqui e o `estado()` medindo. */
async function dossieDepoisDeAplicar(wfId) {
  const k = String(wfId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) return;
  dossieCorCache.delete(k);
  try {
    if (dossie.AUTO.modo === dossie.AUTO_OFF) {
      /* O desligado e anotado IGUAL aos outros, nunca omitido: a tela tem de poder
         dizer que o automatico existe e esta off, senao a linha do recibo fica
         indistinguivel de um automatico que quebrou em silencio. */
      const v = dossie.decidirAuto({ dossie: null, st: null });
      anotarAuto(k, { estado: "pulado", razao: v.razao, porque: v.porque, incremental: false });
      return;
    }
    const doc = await dossie.ler(k);
    let st = null;
    if (doc) {
      const raw = await n8n.getRawWorkflow(k);
      st = dossie.estado(doc, raw);
    }
    /* AS DUAS TRAVAS QUE JA EXISTEM, CONSULTADAS E NAO DUPLICADAS: `dossieJob` e
       uma escrita por PROCESSO (mais estrita que a por fluxo), e `donoDoDossie` e a
       trava por FLUXO de dentro do `dossie.js`, que RECUSA em vez de enfileirar.
       Duas camadas independentes, a disciplina desta casa — e dois applies seguidos
       no mesmo fluxo caem numa delas e saem como "pulado", nunca como sucesso.
       O `donoDoDossie` continua sendo a rede depois desta consulta: entre ela e o
       `construir` cabe outra escrita, e quem perder recebe o 409 que o `catch` do
       `iniciarDossie` anota. */
    const ocupadoPor = dossieJob && dossieJob.escrevendo
      ? (String(dossieJob.wfId) === k ? "deste mesmo fluxo" : "do fluxo " + dossieJob.nome) : null;
    const dono = dossie.donoDoDossie(k);
    const v = dossie.decidirAuto({ dossie: doc, st, ocupadoPor, travadoPor: dono ? dono.desde : null });
    if (!v.rodar) {
      anotarAuto(k, { estado: "pulado", razao: v.razao, porque: v.porque, incremental: false });
      return;
    }
    iniciarDossie(k, { incremental: v.incremental, automatico: true });
  } catch (e) {
    anotarAuto(k, { estado: "falhou", razao: "quebrou", incremental: false,
      porque: "nao deu para conferir o estado do dossie depois de aplicar: "
        + String(e && e.message || e).slice(0, 200) });
  }
}

/* A ESCRITA PARCIAL, COMO FATO — nunca como veredito de tela.
 *
 * O DEFEITO QUE ESTA FATIA EXISTE PARA IMPEDIR: a oferta do recibo é a linha que
 * promete "conserta só o que envelheceu", e ela estava cotando a reescrita inteira
 * — US$4,14 medidos no Iago — porque `preco(nos)` caía no default `"inteiro"`. Um
 * botão que diz um preço e faz outro gasto é o gasto invisível que o §2.3.1 nomeia
 * como o risco desta aba, com a agravante de estar escrito na tela. QUANTO MENOR é
 * o parcial ninguém mediu — zero escritas incrementais existem —, e é por isso que
 * ele não pode ser cotado pela régua do outro modo.
 *
 * `admitirIncremental` e `planoIncremental` são PURAS e é por isso que a rota pode
 * montar o plano de graça: nenhum modelo, nenhuma rede além da leitura do fluxo que
 * esta função já tinha em mão. O veredito é O MESMO que `construir` vai reconsultar
 * na hora de escrever, da mesma função — duas réguas para "pode herdar?" divergiriam
 * no primeiro conserto feito de um lado só, e o lado que divergisse decidiria se um
 * parágrafo aprovado por um portão desconhecido entra num arquivo pago.
 *
 * O QUE ATRAVESSA É CONTAGEM E MOTIVO, nunca a lista de nós: `regenerar`, `herdar`
 * e `umHop` viajam como número pelo mesmo motivo que `fatiaCor` deixa `mudados` de
 * fora — `getRawWorkflow` é o buraco deliberado da whitelist e nome de nó é o que
 * ele tem de sobra.
 *
 * O PISO DE UM PARÁGRAFO NO PREÇO, e ele é a lição do `usd: 0` da rodada morta:
 * `visaoSuspeita` sozinho com `mudados` vazio é uma escrita legítima de UMA seção,
 * e aí `regenerar.length` é 0. A régua do modo incremental divide por
 * `nosRegenerados`, que conta parágrafo de NÓ e não a `## visão geral` — então
 * `mediana × 0` sairia `US$0,00` num botão que spawna uma sessão de minutos. Zero
 * lê como grátis e não é. O piso é aproximação declarada, nunca zero.
 *
 * E O `+1` QUE NÃO ESTÁ AQUI é de propósito: a `visão` é sempre reescrita, mas ela
 * não entra em `nosRegenerados` (`montarParagrafos` conta parágrafo de nó), e a
 * régua do incremental é usd por parágrafo regenerado. Somar a visão à cotação e
 * não ao denominador seria medir uma coisa e cobrar outra — exatamente o defeito
 * que a filtragem por `modo` veio consertar. O custo da visão já está dentro da
 * mediana, porque toda escrita incremental medida a pagou. */
async function fatiaIncremental(doc, st, raw) {
  const plano = dossie.planoIncremental(doc, st, raw);
  if (!plano.ok) {
    return { admitido: false, porque: String(plano.porque || "").slice(0, 300),
      regenerar: 0, herdar: 0, umHop: 0, visao: true, preco: null };
  }
  return {
    admitido: true, porque: null,
    regenerar: plano.regenerar.length,
    herdar: plano.herdar.length,
    umHop: plano.umHop.length,
    /* A visão vai SEMPRE, e ela é o piso do custo do reparo mais barato possível.
       Sai como fato para a tela poder dizer que uma escrita "de zero parágrafos"
       ainda reescreve uma seção. */
    visao: true,
    preco: await dossie.preco(Math.max(1, plano.regenerar.length), "incremental")
  };
}

async function dossieEstado(wfId) {
  let raw = null;
  try { raw = await n8n.getRawWorkflow(wfId); }
  catch (e) { return { erro: "não consegui ler o fluxo no n8n: " + String(e && e.message || e).slice(0, 160) }; }

  const doc = await dossie.ler(wfId);
  const st = dossie.estado(doc, raw);
  /* ESTA LEITURA É FRESCA, então ela vale para o cartão também. Sem isto, aplicar
     um patch e voltar para a vitrine mostraria o cartão verde por até 15 minutos
     enquanto a faixa desta mesma tela já dizia vermelho — duas telas discordando
     sobre quem trava a conversa. */
  guardarCor(wfId, fatiaCor(st, doc));
  const nos = dossie.executaveis(raw).length;
  const linhas = (await dossie.lerLedger()).filter(d => d.wfId === String(wfId));
  const ultima = linhas.filter(d => d.ok !== false).slice(-1)[0] || null;
  return {
    wfId: String(wfId), nome: raw.name || String(wfId), nos,
    cor: st.cor, motivo: st.motivo,
    mudados: st.mudados.slice(0, 12), entraram: st.entraram.slice(0, 12), sairam: st.sairam.slice(0, 12),
    quantosMudados: st.mudados.length, quantosEntraram: st.entraram.length, quantosSairam: st.sairam.length,
    /* `em` é a data da LEITURA do fluxo que gerou a prosa, e `versao` a do
       documento descrito. As duas viajam porque a tela promete as duas etiquetas:
       escrito por um modelo, e a partir de tal versão. */
    em: doc ? doc.em : null,
    bytes: doc ? JSON.stringify(doc.paragrafos).length : 0,
    paragrafos: doc ? doc.paragrafos.length : 0,
    /* O tamanho do fluxo REDIGIDO — é contra ele que a economia se mede, porque é
       ele que a sessão leria sem o dossiê. O bruto tem credencial e não vai para
       lugar nenhum, então comparar com ele daria um número que ninguém pagaria. */
    bytesFluxo: JSON.stringify(claudeFix.redactWorkflow(claudeFix.sanitizedWorkflow(raw))).length,
    ultima,
    /* O preço é o histórico desta máquina, e é `null` com menos de duas escritas
       medidas — a tela diz que não sabe em vez de inventar.
       ESTE É O PREÇO DO REWRITE INTEIRO, e o `modo` explícito é o que impede o
       defeito que estava aqui: a chamada era `preco(nos)`, sem modo, então a oferta
       do recibo — que existe para dizer "conserta só o que envelheceu" — cobrava a
       reescrita inteira. O default da assinatura é `"inteiro"`, e default silencioso
       num número que vai para um botão é como se cobra a conta errada em silêncio. */
    preco: await dossie.preco(nos, "inteiro"),
    incremental: await fatiaIncremental(doc, st, raw),
    /* A ATUALIZACAO AUTOMATICA DEPOIS DE APLICAR — FATO, e ela viaja no MESMO
       payload que a cor: a linha do recibo tem de poder dizer o desfecho ao lado do
       semaforo, e dois payloads teriam duas idades. Ver `fatiaAuto`: tres estados, e
       o ausente nunca cai em "o automatico nao fez nada". */
    auto: fatiaAuto(wfId),
    job: dossieJob && dossieJob.wfId === String(wfId) ? dossieResumo() : null,
    ocupado: !!(dossieJob && dossieJob.escrevendo) ? dossieJob.nome : null
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  /* GUARDA-INI — as três camadas na porta. `guarda-test.js` extrai este bloco do
   * fonte em tempo de execução; reimplementá-lo no teste provaria a cópia, e não
   * o que o servidor faz. Mesma disciplina de `audio-test.js` e do bloco
   * ESTATICO acima.
   *
   * ELE ESTÁ FORA DO `try` DE PROPÓSITO. O `catch` lá embaixo remapeia
   * `err.status` 401 e 403 para **502**, porque esses códigos, vindos do
   * `claude-fix`, significam que o n8n recusou — e virar 500 transformaria uma
   * história em outra. Uma recusa DAQUI virando 502 diria "o cockpit quebrou"
   * onde a verdade é "esta origem não entra". Então nada aqui lança: responde
   * pelo `json()` e retorna.
   *
   * Uma vez, e não em 41 rotas. São 39 POST e 2 DELETE hoje, e a armadilha das
   * "seis chamadas que eram sete" já custou duas vezes neste repo: o dia em que
   * alguém colar a 42ª rota não pode ser o dia em que ela nasce sem guarda. */
  /* Ele tem `try` PRÓPRIO, e não é o de baixo. Duas razões, e a segunda foi um
   * defeito real neste bloco: `verificarToken` pode lançar (hoje lança, porque
   * `decidirSemJwks` ainda não tem política), e fora de qualquer `try` isso é
   * rejeição não tratada dentro do handler — o socket fica pendurado e não há
   * resposta nenhuma, o que é pior do que qualquer código de erro.
   *
   * O `catch` daqui FECHA: guarda que quebra recusa, nunca passa. E o 503 diz
   * que a checagem não rodou, que é diferente de \"você não entra\" — as duas
   * frases levam a ações opostas de quem lê. */
  try {
    const pareamento = guarda.lerPareamento(__dirname);
    const cls = guarda.classificar(req, PORT, pareamento ? pareamento.origens : []);

    if (req.method === "OPTIONS") return guarda.responderPreflight(req, res, cls);

    for (const [k, v] of Object.entries(guarda.cabecalhosCors(cls))) res.setHeader(k, v);

    const veredito = guarda.decidir({
      metodo: req.method, classe: cls.classe, pareado: !!pareamento
    });
    if (!veredito.permite) {
      return json(res, veredito.status, { erro: veredito.motivo, classe: cls.classe });
    }
    if (veredito.exigeToken) {
      const v = await guarda.verificarToken(cls.token, pareamento);
      if (!v.ok) return json(res, v.status, { erro: v.motivo, classe: cls.classe });
      /* `semAssinatura` NAO TINHA CONSUMIDOR NENHUM — medido por grep em todo .js
         e .html: so o `guarda.js` emitia. Ou seja, no dia em que a politica
         offline for escrita, uma requisicao aceita SEM A ASSINATURA TER SIDO
         CONFERIDA chegaria aqui indistinguivel de uma inteiramente verificada, e
         escreveria num fluxo de producao pela mesma porta.
         Nao e paranoia sobre um galho morto: o campo existe justamente porque
         quem o escreveu sabia que a diferenca importa, e ela morria aqui. O
         `decidirSemJwks` de hoje lanca, entao este ramo e inalcancavel — e um
         contrato so vale se ele estiver ligado ANTES de alguem precisar dele.
         A recusa e por METODO e nao por rota: uma rota nova nasce coberta, que e
         a mesma razao por que o bloco inteiro do guarda e agnostico de caminho. */
      if (v.semAssinatura && req.method !== "GET" && req.method !== "HEAD") {
        return json(res, 503, {
          erro: "nao consegui conferir a ASSINATURA desta credencial (o conjunto de chaves "
            + "nao respondeu), e sem isso nada que escreve passa por aqui. Leitura segue.",
          classe: cls.classe
        });
      }
    }
  } catch (err) {
    return json(res, 503, {
      erro: `a checagem de entrada não rodou: ${String(err && err.message || err)}`
    });
  }
  /* GUARDA-FIM */

  try {
    /* ─────────────────────────────────── O PORTÃO: sem sessão, só a tela de conta
     *
     * Pedido do Kauan: entrar no cockpit tem que mostrar o login PRIMEIRO. Isto
     * é o que transforma "só o admin mexe em integração" de contrato de tela em
     * recusa de rota — antes disto, gatar só o operador logado o deixaria mais
     * restrito que um anônimo, que abria `/integracoes` direto.
     *
     * FALHA ABERTO EM DOIS CASOS, e os dois são deliberados:
     *
     *   - `COCKPIT_LOGIN=0` desliga. É a saída de emergência, e ela existe por
     *     um motivo concreto: as sessões vivem na MEMÓRIA deste processo, então
     *     reiniciar o cockpit desloga de tudo. Sem esta válvula, um erro de
     *     configuração do Supabase trancaria o dono para fora do próprio painel
     *     sem caminho de volta pela tela.
     *   - sem `SUPABASE_URL`/`SUPABASE_ANON_KEY` não existe login possível, e
     *     exigir o que não pode ser feito é a recusa sem saída que este
     *     repositório recusa em três outros lugares.
     *
     * O QUE ELE NÃO É, e a tela diz: cadeado. Quem tem a máquina alcança tudo
     * por fora do navegador — `guarda.decidir()` libera cliente local sem origem
     * de propósito. Isto fecha a porta da frente, não a casa.
     *
     * Só PÁGINA passa por aqui. As rotas de API seguem como estavam: o painel
     * inteiro depende delas, e fechá-las junto seria uma mudança de outro
     * tamanho, com o SSE no meio. Fica nomeado como dívida, não como pronto. */
    const PAGINAS_COM_LOGIN = new Set(["/", "/index.html", "/disco", "/tester", "/upgrade", "/integracoes"]);
    if (LOGIN_EXIGIDO && PAGINAS_COM_LOGIN.has(p)) {
      const g = await quemEsta(req);
      if (!g.sessao) {
        res.writeHead(302, { location: "/conta?volta=" + encodeURIComponent(p), "cache-control": "no-store" });
        return res.end();
      }
      if (!g.aprovado) {
        /* Pendente e recusado NÃO podem cair na mesma frase — a tela de conta é
           quem diz qual dos dois é, e ela já tem as duas. Aqui só se manda para lá. */
        res.writeHead(302, { location: "/conta", "cache-control": "no-store" });
        return res.end();
      }
      /* Chave de API e conexão com o n8n são do admin. Decisão do Kauan. */
      if (p === "/integracoes" && !g.admin) {
        res.writeHead(302, {
          location: "/conta?erro=" + encodeURIComponent("integrações é do admin da equipe — você entrou como operador"),
          "cache-control": "no-store"
        });
        return res.end();
      }
    }

    if (p === "/" || p === "/index.html") return serveFile(req, res, path.join(__dirname, "flows.html"));
    if (p === "/disco") return serveFile(req, res, path.join(__dirname, "cockpit.html"));
    /* O aviso de aba: favicon animado, título piscando, notificação do SO. Um
     * arquivo servido às três páginas em vez de um quarto bloco copiado — o
     * topbar e o `.aviso` já são três cópias e essa fila não precisa crescer.
     * A regra continua a mesma — editar o arquivo e recarregar tem que valer, e um
     * favicon em cache é justo o tipo de coisa que ninguém pensa em invalidar —
     * mas a frase que a dizia envelheceu junto com o cabeçalho: era `no-store` e
     * agora é `no-cache`, que não é "não guarde" e sim "guarde e PERGUNTE antes de
     * usar". Revalida sempre, então nunca serve velho; só deixa de mandar 26KB de
     * corpo para dizer "não mudou". Quem quebraria a decisão é `max-age`. */
    if (p === "/aba.js") return serveFile(req, res, path.join(__dirname, "aba.js"));
    /* As duas entradas que não são o teclado — falar e anexar — servidas às duas
     * páginas que têm compositor (`/tester` e `/upgrade`). O bloco nasceu dentro
     * do `tester.html` já parametrizado por `idPrefixo`; virou arquivo pelo mesmo
     * motivo do `aba.js`, e `entradas-test.js` falha no dia em que uma das duas
     * páginas voltar a declarar o bloco por conta própria. Ele injeta o próprio
     * CSS, então não há uma segunda folha para divergir. */
    if (p === "/entradas.js") return serveFile(req, res, path.join(__dirname, "entradas.js"));
    /* A logo da Ecommerce Puro no topbar das quatro páginas. Rota, e não base64
     * embutido, porque embutir são ~43KB de base64 × 4 páginas ≈ 173KB somados ao
     * HTML — e a passada de fluidez acabou de medir byte no fio e cortar 35% de
     * `/api/n8n/overview` por não ter consumidor. Servida assim ela é UM arquivo,
     * pedido uma vez, e daí em diante um `304` de algumas centenas de bytes.
     *
     * Não precisa de nada em `estatico.js`: `serveFile` já tira o MIME de
     * `estatico.tipoDe(ext)`, que conhece `.png`, e `image/png` está de fora de
     * `COMPRIMIVEL` de propósito — PNG já vem comprimido e gzipar de novo é CPU
     * para devolver os mesmos bytes. */
    if (p === "/ep-logo.png") return serveFile(req, res, path.join(__dirname, "ep-logo.png"));

    /* ─────────────────────────────────────────────────────────── UPGRADE ──
     * A quarta porta. `flows.html` conserta o que quebrou, o Tester cria do
     * zero, e esta evolui um fluxo que já existe e funciona.
     *
     * Nesta fatia TUDO aqui é leitura: não há caminho de escrita, nem para o
     * n8n nem para disco. O botão de aplicar (e a bateria que o destrava) só
     * entra depois dos quatro passos de infraestrutura do PLAN-UPGRADE.md, que
     * mexem em código já em produção e vão sozinhos.
     *
     * FATOS, como o resto do servidor. Quem chega na vitrine, em que ordem, se é
     * caro de conversar e qual nó pintar de vermelho é decidido no bloco de
     * juízo do `upgrade.html`. */
    if (p === "/upgrade") return serveFile(req, res, path.join(__dirname, "upgrade.html"));

    /* ══════════════════════════════════ INTEGRAÇÕES — somente leitura ═══════
     * Fatia 1: a tela mostra o que o cockpit JÁ sabe responder hoje — n8n
     * configurado e respondendo, CLI do Claude achada nesta máquina, e o Codex
     * que ele ainda não sabe chamar.
     *
     * Ela NÃO autentica ninguém, NÃO guarda chave e NÃO escreve em lugar
     * nenhum. O que protege o painel continua sendo o `127.0.0.1` do `listen`
     * lá embaixo, e a chave do n8n continua vindo do `.env`, uma só, do
     * processo inteiro — não existe noção de pessoa neste código. A página diz
     * isso no rodapé em vez de deixar implícito, porque uma tela de
     * "integrações" é exatamente onde alguém supõe que já existe login.
     *
     * Fato aqui, juízo no `integracoes.html`: o módulo devolve `respondeu` e
     * `httpStatus`; quem traduz isso para "a chave foi revogada" é a página.
     * Essa é a parte que o Kauan mais ajusta, e no servidor cada ajuste exigiria
     * reiniciar o processo. */
    if (p === "/integracoes") return serveFile(req, res, path.join(__dirname, "integracoes.html"));

    /* ───────────────────────────────────────────── PERFIL, ENTRADA E SUPER ADMIN
     *
     * Contrato: `CONTRATO-PERFIL.md`. `perfil.js` emite fato; `entrar.html`
     * julga. As rotas aqui são costura — elas não decidem se a conta "pode
     * entrar", elas devolvem o que o banco respondeu.
     *
     * NENHUMA PORTA NOVA NA CÁPSULA DE NAVEGAÇÃO. As quatro estão travadas por
     * `nav-sync-test.js`, e mexer nelas é outra fatia — é a mesma decisão que o
     * `/integracoes` já tomou.
     *
     * O TETO, repetido aqui porque é aqui que alguém vai querer confiar demais:
     * isto NÃO tranca o painel. `guarda.decidir()` libera cliente local sem
     * origem de propósito, e quem tem a máquina alcança tudo por fora. O que
     * estas rotas fazem é dizer quem é a pessoa e se ela foi aprovada. */
    /* `/conta` é a porta da cápsula; `/entrar` é o mesmo arquivo pelo nome que a
     * pessoa deslogada procura. Um arquivo, dois endereços — a página já decide
     * sozinha o que mostrar a partir do estado da conta, então uma segunda cópia
     * seria uma cópia para divergir. */
    if (p === "/conta" || p === "/entrar") return serveFile(req, res, path.join(__dirname, "entrar.html"));

    if (p.startsWith("/api/perfil/")) {
      const cfg = perfil.configurado();
      if (!cfg.ok) {
        return json(res, 503, {
          erro: "o cockpit está sem SUPABASE_URL ou SUPABASE_ANON_KEY no .env — sem isso não existe login"
        });
      }

      /* O id da sessão é opaco e mora num cookie `HttpOnly`. Ele nunca é lido
       * por JavaScript, e o token do Supabase nunca sai deste processo. */
      const bruto = req.headers.cookie || "";
      const achado = /(?:^|;\s*)cockpit_sessao=([A-Za-z0-9_-]{1,64})(?:;|$)/.exec(bruto);
      const sid = achado ? achado[1] : null;

      const base = `http://127.0.0.1:${PORT}`;
      const volta = `${base}/api/perfil/callback`;

      /* FATO: quem está conectado e o que o banco diz do perfil dele. Nunca
       * token, nunca refresh, nunca a chave. A tela é quem chama isso de
       * "aprovado" ou "travado". */
      if (p === "/api/perfil/eu" && req.method === "GET") {
        if (!sid) return json(res, 200, { sessao: false, perfil: null });
        const t = await perfil.tokenValido(cfg, sid);
        if (!t.ok) return json(res, 200, { sessao: false, perfil: null, motivo: t.motivo });
        /* `perfilDe` e não `eu`: um super admin enxerga TODAS as linhas pela RLS,
         * então pegar a primeira devolveria o perfil de outra pessoa como se
         * fosse o dele. Filtra pelo `sub` do próprio token. */
        const r = await perfil.perfilDe(cfg, t.access, t.sub);
        if (!r.ok) return json(res, 200, { sessao: true, perfil: null, erro: r.erro });
        /* A organização viaja junto porque a tela precisa dela para TODOS os
         * cargos: o admin vê as vagas, o operador vê de qual empresa ele é. Ler
         * numa segunda chamada faria a tela pintar sem a org e depois com — e o
         * segundo repintar é o que lê como defeito. */
        /* Presença, com estrangulamento de 1h. Sem ele isto seria um `PATCH` por
         * carregamento de página, e esta rota é chamada em toda abertura de
         * qualquer aba. Uma hora é folgado para o número que ele responde —
         * "quantas pessoas usaram nos últimos 7 dias" — e a diferença entre
         * marcar agora ou daqui a 59 minutos não muda resposta nenhuma.
         * Sem `await`: ver o comentário de `marcarPresenca`. */
        if (r.perfil) {
          const v = r.perfil.visto_em ? Date.parse(r.perfil.visto_em) : 0;
          if (!(Date.now() - v < 3600 * 1000)) perfil.marcarPresenca(cfg, t.access, t.sub);
        }
        const o = r.perfil && r.perfil.organizacao_id
          ? await perfil.organizacao(cfg, t.access, r.perfil.organizacao_id)
          : { ok: true, org: null };
        return json(res, 200, {
          sessao: true,
          perfil: r.perfil,
          org: o.ok ? o.org : null,
          /* Falhar ao ler a organização é problema NOSSO, e é diferente de a
             pessoa não ter organização. As duas levam a telas diferentes. */
          orgErro: o.ok ? null : o.erro
        });
      }

      if (p === "/api/perfil/entrar/google" && req.method === "POST") {
        const { url: destino } = perfil.comecarGoogle(cfg, volta);
        return json(res, 200, { url: destino });
      }

      if (p === "/api/perfil/entrar/email" && req.method === "POST") {
        const corpo = JSON.parse((await readBody(req, 4096)) || "{}");
        const email = String(corpo.email || "").trim();
        if (!email || email.length > 320 || !email.includes("@")) {
          return json(res, 400, { erro: "e-mail inválido" });
        }
        const r = await perfil.comecarEmail(cfg, email, volta);
        /* A RESPOSTA É A MESMA para e-mail que existe e que não existe, e o
         * `ok: true` aqui não afirma que o link saiu — afirma que o pedido foi
         * aceito. Respostas diferentes transformariam a tela de login num
         * oráculo de "esta pessoa tem conta aqui", que é vazamento sobre
         * terceiro. Um 4xx/5xx real do Supabase (cota de e-mail, projeto
         * pausado) ainda atravessa, porque isso é defeito NOSSO e esconder
         * deixaria a pessoa esperando um link que nunca vem. */
        if (!r.ok && r.status >= 500) return json(res, 502, { erro: r.erro });
        if (!r.ok && r.status === 429) {
          /* Os dois 429 do Supabase têm saídas OPOSTAS e não podem ler igual.
           * MEDIDO em 25/08/2026: `over_email_send_rate_limit` é o teto do
           * serviço de e-mail EMBUTIDO — poucos por hora, e do PROJETO inteiro,
           * não da pessoa. Esperar não resolve para quem é a terceira pessoa da
           * hora; o que resolve é um SMTP próprio. Dizer "espere um minuto" ali
           * é mandar a pessoa esperar por algo que não vai chegar. */
          const doProjeto = r.codigo === "over_email_send_rate_limit";
          return json(res, 429, {
            erro: doProjeto
              ? "o serviço de e-mail embutido do Supabase bateu no teto da hora — ele é para teste e o limite vale para o projeto inteiro, não só para você. Entre pelo Google, ou peça para configurarem um SMTP próprio."
              : "muitos pedidos seguidos para este endereço. Espere alguns segundos e tente de novo.",
            codigo: r.codigo || null,
            /* A tela usa isto para decidir se oferece o Google em destaque: com o
               e-mail no teto, insistir no botão do e-mail é insistir no que não
               vai funcionar. */
            usarGoogle: doProjeto
          });
        }
        return json(res, 200, { ok: true });
      }

      /* A volta do Google e do link por e-mail. Redireciona SEMPRE para
       * `/entrar`, nunca imprime token na barra de endereços, e a mensagem de
       * erro viaja como texto já varrido. */
      if (p === "/api/perfil/callback" && req.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("s");
        const erroUp = url.searchParams.get("error_description") || url.searchParams.get("error");

        function volta_(q) {
          res.writeHead(302, { location: "/entrar" + q, "cache-control": "no-store" });
          res.end();
        }
        if (erroUp) return volta_("?erro=" + encodeURIComponent(perfil.varrer(erroUp)));
        if (!code || !state) return volta_("?erro=" + encodeURIComponent("a volta do login chegou sem código"));

        const r = await perfil.trocarCodigo(cfg, code, state);
        if (!r.ok) return volta_("?erro=" + encodeURIComponent(r.erro));

        res.writeHead(302, {
          location: "/entrar?ok=1",
          "cache-control": "no-store",
          /* `HttpOnly` fecha o XSS; `SameSite=Lax` deixa a volta do redirect
             funcionar e barra POST cruzado. Sem `Secure`: isto é http no
             loopback, e `Secure` faria o cookie ser DESCARTADO em silêncio — o
             login pareceria funcionar e a sessão nunca existiria. */
          "set-cookie": `cockpit_sessao=${r.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(perfil.SESSAO_VIDA_MS / 1000)}`
        });
        return res.end();
      }

      if (p === "/api/perfil/sair" && req.method === "POST") {
        if (sid) perfil.encerrar(sid);
        res.writeHead(200, {
          ...estatico.SEGURANCA,
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": "cockpit_sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
        });
        return res.end(JSON.stringify({ ok: true }));
      }

      /* ─────────────────────────────── daqui para baixo exige cargo
       *
       * A checagem é feita AQUI, contra o banco, e não contra o que a página
       * afirmou. A RLS é a terceira camada e recusaria de qualquer jeito — as
       * três existem de verdade, e a tela esconder o botão é a mais fraca. */
      const t = sid ? await perfil.tokenValido(cfg, sid) : { ok: false };
      if (!t.ok) return json(res, 401, { erro: "entre antes" });
      const meu = await perfil.perfilDe(cfg, t.access, t.sub);
      if (!meu.ok || !meu.perfil) return json(res, 403, { erro: "não consegui ler o seu perfil" });
      const EU = meu.perfil;
      const SUPER = EU.super_admin === true;
      /* Admin de verdade: cargo `admin`, APROVADO e com organização. Um admin
       * recusado, ou sem empresa, não gerencia ninguém — é a mesma condição que
       * `private.eh_admin()` cobra no banco, e as duas têm que casar. */
      const ADMIN = SUPER || (EU.papel === "admin" && EU.status === "aprovado" && !!EU.organizacao_id);
      const soSuper = () => json(res, 403, { erro: "esta parte é do super admin" });
      const soAdmin = () => json(res, 403, { erro: "esta parte é de quem administra a equipe" });

      /* ── a equipe: do ADMIN, sobre a organização DELE ────────────────────── */

      if (p === "/api/perfil/equipe" && req.method === "GET") {
        if (!ADMIN) return soAdmin();
        const orgId = EU.organizacao_id;
        const [time, org, convs] = await Promise.all([
          perfil.equipe(cfg, t.access, orgId),
          perfil.organizacao(cfg, t.access, orgId),
          perfil.convites(cfg, t.access)
        ]);
        if (!time.ok) return json(res, 502, { erro: time.erro });
        return json(res, 200, {
          linhas: time.linhas,
          org: org.ok ? org.org : null,
          /* Os convites da org que ainda não viraram pessoa. Sem eles a tela
             contaria só quem já entrou e a conta das vagas não fecharia — o teto
             consome no CONVITE, não na entrada. */
          convites: convs.ok ? (convs.linhas || []).filter(c => !c.usado_em) : []
        });
      }

      if (p === "/api/perfil/equipe/convidar" && req.method === "POST") {
        if (!ADMIN) return soAdmin();
        if (!EU.organizacao_id) {
          return json(res, 400, { erro: "você ainda não está numa organização — peça ao super admin" });
        }
        const corpo = JSON.parse((await readBody(req, 4096)) || "{}");
        const email = String(corpo.email || "").trim().toLowerCase();
        if (!email || email.length > 320 || !email.includes("@")) {
          return json(res, 400, { erro: "e-mail inválido" });
        }
        /* `papel` NÃO vem do corpo: um admin só emite operador. Aceitar do corpo
           deixaria o teto de 3 vazar numa linha — promove um a admin e ele
           convida mais 3. Criar admin é ato do super admin. */
        const r = await perfil.convidarComCargo(cfg, t.access, {
          email, papel: "operador", orgId: EU.organizacao_id, porQuem: t.sub
        });
        if (!r.ok) return json(res, r.status === 409 ? 409 : 502, { erro: r.erro, semVaga: !!r.semVaga });
        return json(res, 200, { ok: true, convite: r.convite });
      }

      /* ── organizações e cargos: só o super admin ─────────────────────────── */

      if (p === "/api/perfil/organizacoes" && req.method === "GET") {
        if (!SUPER) return soSuper();
        const r = await perfil.organizacoes(cfg, t.access);
        if (!r.ok) return json(res, 502, { erro: r.erro });
        return json(res, 200, { linhas: r.linhas });
      }

      if (p === "/api/perfil/organizacoes" && req.method === "POST") {
        if (!SUPER) return soSuper();
        const corpo = JSON.parse((await readBody(req, 4096)) || "{}");
        const nome = String(corpo.nome || "").trim().slice(0, 120);
        if (!nome) return json(res, 400, { erro: "a organização precisa de um nome" });
        const r = await perfil.criarOrganizacao(cfg, t.access, { nome, porQuem: t.sub });
        if (!r.ok) return json(res, 502, { erro: r.erro });
        return json(res, 200, { ok: true, org: r.org });
      }

      if (!SUPER) return soSuper();

      if (p === "/api/perfil/pedidos" && req.method === "GET") {
        const [fila, convs, orgs, tudo] = await Promise.all([
          perfil.pedidos(cfg, t.access),
          perfil.convites(cfg, t.access),
          perfil.organizacoes(cfg, t.access),
          perfil.todos(cfg, t.access)
        ]);
        if (!fila.ok) return json(res, 502, { erro: fila.erro });
        return json(res, 200, {
          linhas: fila.linhas,
          convites: convs.ok ? convs.linhas : [],
          organizacoes: orgs.ok ? orgs.linhas : [],
          todos: tudo.ok ? tudo.linhas : [],
          /* Ler os convites pode falhar sozinho, e a fila continua válida. Dizer
             que falhou é diferente de dizer que não há nenhum. */
          convitesErro: convs.ok ? null : convs.erro
        });
      }

      if (p === "/api/perfil/decidir" && req.method === "POST") {
        const corpo = JSON.parse((await readBody(req, 4096)) || "{}");
        const alvo = String(corpo.id || "");
        if (!/^[0-9a-fA-F-]{36}$/.test(alvo)) return json(res, 400, { erro: "id inválido" });
        if (typeof corpo.aprovar !== "boolean") return json(res, 400, { erro: "aprovar tem que ser true ou false" });
        /* Recusar a si mesmo tiraria o único super admin e deixaria o painel sem
           quem aprove ninguém — sem caminho de volta pela tela. */
        if (alvo === t.sub) return json(res, 400, { erro: "você não pode decidir sobre a sua própria conta" });
        const motivo = corpo.motivo == null ? null : String(corpo.motivo).slice(0, 300);

        /* CARGO SÓ DO SUPER ADMIN, e a omissão é deliberada: `undefined` diz
         * "não mexa", `null` diria "apague o cargo". Um admin tirando alguém da
         * equipe não pode apagar o cargo dessa pessoa sem ter pedido — e o
         * gatilho do banco recusaria de qualquer jeito, mas depender disso
         * transformaria uma regra em um erro de 500 na tela. */
        let papel; let orgId;
        if (SUPER && corpo.aprovar) {
          if (corpo.papel !== undefined) {
            const v = corpo.papel === null ? null : String(corpo.papel);
            if (v !== null && v !== "admin" && v !== "operador") {
              return json(res, 400, { erro: "cargo tem que ser admin, operador, ou nenhum" });
            }
            papel = v;
          }
          if (corpo.organizacao_id !== undefined) {
            const o = corpo.organizacao_id === null ? null : String(corpo.organizacao_id);
            if (o !== null && !/^[0-9a-fA-F-]{36}$/.test(o)) {
              return json(res, 400, { erro: "organização inválida" });
            }
            orgId = o;
          }
          if (papel && orgId === null) return json(res, 400, { erro: "escolha a organização deste cargo" });
          if (papel && orgId === undefined) return json(res, 400, { erro: "escolha a organização deste cargo" });
        }

        const r = await perfil.decidir(cfg, t.access, {
          id: alvo, aprovar: corpo.aprovar, motivo, porQuem: t.sub, papel, orgId
        });
        if (!r.ok) {
          return json(res, r.status === 409 ? 409 : (r.status === 403 ? 403 : 502),
            { erro: r.erro, semVaga: !!r.semVaga });
        }
        return json(res, 200, { ok: true, perfil: r.perfil });
      }

      if (p === "/api/perfil/convite" && req.method === "POST") {
        const corpo = JSON.parse((await readBody(req, 4096)) || "{}");
        const email = String(corpo.email || "").trim().toLowerCase();
        if (!email || email.length > 320 || !email.includes("@")) {
          return json(res, 400, { erro: "e-mail inválido" });
        }
        /* `super_admin` NÃO é aceito do corpo, em nenhuma forma. Criar outro
           super admin é ato de banco, deliberadamente — ver a nota de privilégio
           de coluna na migration. */
        const papel = corpo.papel == null ? null : String(corpo.papel);
        if (papel !== null && papel !== "admin" && papel !== "operador") {
          return json(res, 400, { erro: "cargo tem que ser admin, operador, ou nenhum" });
        }
        const orgId = corpo.organizacao_id == null ? null : String(corpo.organizacao_id);
        if (orgId !== null && !/^[0-9a-fA-F-]{36}$/.test(orgId)) {
          return json(res, 400, { erro: "organização inválida" });
        }
        /* Cargo sem organização não é um estado útil e é fácil de criar sem
           querer: um admin sem empresa não gerencia ninguém e um operador sem
           empresa não pertence a lugar nenhum. Recusa nomeando o que falta, em
           vez de gravar uma linha que a tela depois não sabe explicar. */
        if (papel && !orgId) return json(res, 400, { erro: "escolha a organização deste cargo" });
        const r = await perfil.convidarComCargo(cfg, t.access, {
          email, papel, orgId, porQuem: t.sub
        });
        if (!r.ok) return json(res, r.status === 409 ? 409 : 502, { erro: r.erro, semVaga: !!r.semVaga });
        return json(res, 200, { ok: true, convite: r.convite });
      }

      return json(res, 404, { erro: "rota de perfil desconhecida" });
    }

    /* Pergunta ao CLI se ele está logado, e por qual rota. `claude auth status
     * --json` devolve `{loggedIn, authMethod, subscriptionType, email, orgName}`
     * — medido nesta máquina, ~670ms por chamada, e é por isso que a resposta
     * inteira do `/api/integracoes` tem cache de 30s.
     *
     * A pergunta vai para o CLI, NUNCA para o `~/.claude/.credentials.json`.
     * Ler o arquivo de credencial de alguém para saber se ele está logado é
     * atravessar uma fronteira que este painel não atravessa nem no n8n: a
     * resposta oficial existe, então usa-se a resposta oficial.
     *
     * `timeout` obrigatório: um CLI que pendura sem ele penduraria a rota, e a
     * tela ficaria "conferindo" para sempre — que é justo o estado que a gente
     * separou de "não está logada". */
    async function autenticarClaude() {
      const { stdout } = await execFileAsync(claudeFix.claudeBin,
        ["auth", "status", "--json"],
        { timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024 });
      return JSON.parse(stdout);
    }

    /* ─────────────────────────────────────── O COFRE DA CHAVE DO n8n
     *
     * Até 25/08/2026 o `cofre.js` existia, passava nos próprios testes, e
     * NINGUÉM o chamava — medido por grep: zero chamadas a `cofre.guardar` fora
     * dos testes dele. O `n8n.js` já sabia LER (`ORDEM_DA_CHAVE = ["cofre",
     * "env"]`), então a chave podia vir do cofre e não havia como colocá-la lá.
     * Trocar a chave era abrir o `.env` num editor e reiniciar o processo — a
     * fricção exata que o passo a passo de download promete não existir.
     *
     * TRÊS ROTAS, e a de escrita é a única do cockpit que recebe um SEGREDO no
     * corpo. Consequências que valem para ela e para nenhuma outra:
     *
     *   - o valor NUNCA volta na resposta, nem truncado. Prefixo publicado deixa
     *     conferir um palpite, e o painel viraria oráculo de credencial.
     *   - o valor NUNCA entra em log. Este arquivo não imprime corpo de requisição
     *     em lugar nenhum, e esta rota não pode ser a primeira.
     *   - o corpo é pequeno de propósito (2KB): uma chave do n8n é um JWT de
     *     algumas centenas de bytes, e um teto folgado aqui só serve para
     *     alguém empurrar outra coisa.
     *   - depois de gravar, `n8n.esquecerChave()` zera o memo do cliente. Sem
     *     isso o processo seguiria usando a chave anterior até reiniciar, e a
     *     tela diria "guardada" enquanto o n8n continuaria recusando.
     *
     * SÓ ADMIN, como o resto de integrações — decisão do Kauan. E vale o mesmo
     * teto de sempre: numa máquina que é da própria pessoa, isso impede o
     * acidente e não o determinado. */
    if (p === "/api/cofre") {
      if (LOGIN_EXIGIDO) {
        const g = await quemEsta(req);
        if (g.semResposta) return json(res, 503, { erro: "nao consegui conferir quem voce e: o Supabase nao respondeu. Isto nao e uma recusa — tenta de novo em instantes." });
        if (!g.admin) return json(res, 403, { erro: "a chave do n8n é do admin da equipe" });
      }

      if (req.method === "GET") {
        /* FATO. `estadoChave()` não devolve a chave nem pedaço dela — devolve de
           onde ela vem, se o cofre abriu, e o motivo quando não abriu. Quem
           traduz isso para português é a página. */
        return json(res, 200, await n8n.estadoChave());
      }

      if (req.method === "POST") {
        let corpo;
        try { corpo = JSON.parse((await readBody(req, 2048)) || "{}"); }
        catch { return json(res, 400, { erro: "corpo inválido" }); }

        /* `cofre.guardar` recusa não-string, vazio e branco no meio, cada um com
           a frase dele. Repassar a mensagem dele é melhor que inventar outra:
           ele é quem sabe qual das três recusas foi, e as três mandam a pessoa
           fazer coisas diferentes. */
        try {
          /* O valor vai CRU para o cofre, e não normalizado para `null` antes.
             Ele checa `typeof` e nomeia o tipo que chegou — normalizar aqui
             fazia um objeto ser reportado como "veio null", que manda quem lê
             procurar um campo ausente onde havia um campo com o tipo errado. */
          const r = await cofre.guardar(corpo.chave);
          n8n.esquecerChave();
          return json(res, 200, {
            ok: true,
            onde: r.onde,
            /* `forma` é AVISO, nunca recusa — o cofre guarda mesmo quando não
               parece um JWT, porque recusar por forma travaria a pessoa fora da
               instância no dia em que o formato mudasse. */
            forma: r.forma,
            /* Este campo existe para a obrigação deixar de ser prosa: o cabeçalho
               do `cofre.js` diz que a tela TEM que avisar que a chave antiga
               continua ativa no n8n. Como campo do contrato, a ausência do
               consumidor é aferível por teste. */
            revogacaoManual: r.revogacaoManual === true
          });
        } catch (err) {
          /* A mensagem do cofre nunca cita o valor — está escrito e testado lá.
             Ainda assim ela passa pela varredura, porque esta é a rota onde um
             segredo existe e o custo de errar é publicá-lo. */
          return json(res, 400, { erro: perfil.varrer(String((err && err.message) || err)) });
        }
      }

      if (req.method === "DELETE") {
        try {
          const tinha = await cofre.apagar();
          n8n.esquecerChave();
          /* `tinha: false` não é erro: apagar o que não existe é o resultado
             pedido. A tela diz "não havia nada guardado" em vez de reclamar. */
          return json(res, 200, { ok: true, tinha });
        } catch (err) {
          return json(res, 500, { erro: perfil.varrer(String((err && err.message) || err)) });
        }
      }

      return json(res, 405, { erro: "método não aceito nesta rota" });
    }

    if (p === "/api/integracoes") {
      /* A rota, não só a tela. Esconder a porta impede o acidente; recusar aqui
       * é o que impede o `curl`. Esta resposta carrega o host do n8n e o e-mail
       * da conta Claude — não é uma tela vazia que se está protegendo.
       * Só vale com o portão ligado: com ele desligado não existe noção de
       * pessoa, e recusar por cargo seria recusar por um cargo que ninguém tem. */
      if (LOGIN_EXIGIDO) {
        const g = await quemEsta(req);
        if (g.semResposta) return json(res, 503, { erro: "nao consegui conferir quem voce e: o Supabase nao respondeu. Isto nao e uma recusa — tenta de novo em instantes." });
        if (!g.admin) return json(res, 403, { erro: "integrações é do admin da equipe" });
      }
      /* As dependências entram por parâmetro em vez de `require` dentro do
       * módulo: é o que deixa o `integracoes-test.js` exercitar a lógica de
       * verdade com dublês, sem a cirurgia no `require.cache` que os testes
       * mais antigos daqui precisaram fazer. */
      try {
        /* `?refazer=1` é o clique em "Conferir de novo". Sem ele o cache de 30s
         * responderia o mesmo, e um botão que devolve o que já estava na tela é
         * um botão que não faz nada — pior que não ter botão. O caminho
         * automático (a primeira pintura da página) NÃO passa isso, senão o
         * cache não serve para nada. */
        const refazer = url.searchParams.get("refazer") === "1";
        return json(res, 200, await integracoes.colher({
          n8n, fix: claudeFix, refazer, autenticar: autenticarClaude,
          /* O adaptador de provedor, como FATO. A tela mostrava isto transcrito a
             mao -- segunda copia de um fato que decide qual IA a pessoa usa e quem
             paga a conta dela. `capacidades()` e puro: sem rede, sem disco. */
          ia: require("./ia.js")
        }));
      } catch (err) {
        /* A mensagem crua NÃO volta para o navegador. `colher` varre o que
         * emite (contrato §4), mas uma exceção inesperada escapa por fora dessa
         * varredura, e é justo por aí que a chave sairia. O bruto fica no
         * console, que é onde ela já mora de qualquer forma. */
        console.error("[integracoes] colheita falhou:", err);
        return json(res, 500, { error: "não consegui colher o estado das integrações — veja o console do cockpit" });
      }
    }

    /* ═══════════════════════════════════════ pareamento do agente local ═════
     *
     * A cerimonia que decide QUAL SITE pode mandar este agente escrever num fluxo
     * de producao (`/approve`) e disparar `/retry`, que manda mensagem real para
     * um lead e nao tem desfazer. `pareamento.js` emite fatos; o juizo e da tela.
     *
     * O CODIGO DE CONFIRMACAO NAO SAI POR AQUI, e nao sai de proposito: `iniciar`
     * so o entrega ao console do agente. Nenhuma rota consegue obte-lo, entao
     * nenhuma rota pode vaza-lo. NAO acrescente um parametro que devolva o codigo
     * na resposta -- isso transforma a confirmacao humana em enfeite, porque quem
     * pediu a cerimonia passa a poder fecha-la sozinho, e a confirmacao humana e a
     * unica camada que separa "a pessoa quis" de "algo na maquina dela quis".
     *
     * Um site hospedado ainda NAO pareado nao alcanca nada disto: `guarda.decidir`
     * classifica origem desconhecida como `estranha` e recusa toda mutante com 403.
     * A cerimonia e conduzida do painel local, e essa direcao foi medida contra o
     * `guarda`, nao escolhida. */
    /* O PORTAO DE ADMIN, E ELE FALTAVA. A pagina /integracoes ja exige admin
     * (bloco do portao, mais acima), e estas quatro rotas — que sao o motor dela —
     * nao exigiam nada: zero chamadas de `quemEsta` neste bloco, ao contrario de
     * /api/cofre e /api/integracoes. Quem nao pode ABRIR a tela nao pode dirigir a
     * API dela; a assimetria era a porta.
     * Ela e cumulativa com a cerimonia, nao substituta: a confirmacao humana no
     * console segue sendo a camada que separa "a pessoa quis" de "algo na maquina
     * dela quis". Esta aqui fecha o degrau anterior — quem consegue ABRIR uma
     * cerimonia.
     * O GET entra junto porque ele devolve `origens`, `iss` e `dono`, que e o
     * inventario de quem manda neste agente.
     * Sem Supabase configurado `quemEsta` devolve `admin: true` e o pareamento
     * local segue funcionando — que e o modo em que ele normalmente acontece. */
    if (p.startsWith("/api/pareamento")) {
      const g = await quemEsta(req);
      if (g.semResposta) return json(res, 503, { erro: "nao consegui conferir quem voce e: o Supabase nao respondeu. Isto nao e uma recusa — tenta de novo em instantes." });
      if (!g.admin) return json(res, 403, { erro: "o pareamento do agente e do admin da equipe" });
    }

    if (p === "/api/pareamento" && req.method === "GET") {
      return json(res, 200, pareamento.estado(__dirname));
    }

    if (p === "/api/pareamento" && req.method === "DELETE") {
      const r = pareamento.desparear(__dirname);
      return json(res, r.ok ? 200 : 500, r);
    }

    if (p === "/api/pareamento/iniciar" && req.method === "POST") {
      const b = JSON.parse(await readBody(req, PAREAMENTO_BODY_CAP) || "{}");
      const r = pareamento.iniciar({
        dir: __dirname,
        origem: b.origem, origens: b.origens,
        iss: b.iss, jwks: b.jwks, dono: b.dono
      });
      /* Recusa de entrada e 400 carregando `categoria`, como o `/api/tester/anexo`
         ja faz -- e o que deixa a tela agrupar e dizer a frase certa em vez de
         "deu erro". 202 no sucesso: a cerimonia comecou e NADA foi gravado ainda. */
      return json(res, r.ok ? 202 : 400, r);
    }

    if (p === "/api/pareamento/confirmar" && req.method === "POST") {
      const b = JSON.parse(await readBody(req, PAREAMENTO_BODY_CAP) || "{}");
      const r = pareamento.confirmar({ dir: __dirname, desafio: b.desafio, codigo: b.codigo });
      /* "erre outra vez" e "comece de novo" sao duas historias, e a tela precisa
         distinguir sem ter de ler a frase: 400 enquanto ainda da para tentar, 410
         quando a cerimonia acabou (teto de tentativa, prazo, ou nao existe mais). */
      const acabou = r.categoria === "teto" || r.categoria === "prazo" || r.categoria === "desafio";
      return json(res, r.ok ? 200 : (acabou ? 410 : 400), r);
    }

    if (p === "/api/pareamento/cancelar" && req.method === "POST") {
      return json(res, 200, { ok: true, havia: pareamento.esquecerCerimonia() });
    }

    if (p === "/api/upgrade/vitrine") {
      const ov = await n8n.overview();
      const porFluxo = new Map();
      for (const e of ov.executions || []) {
        const k = String(e.workflowId ?? "");
        if (!k) continue;
        const r = porFluxo.get(k) || { exec24: 0, erro24: 0, falhas: new Set() };
        r.exec24++;
        if (String(e.status) === "error") r.erro24++;
        porFluxo.set(k, r);
      }
      /* O nó nomeado por cada falha. Só o NOME cruza; se ele pertence a este
       * fluxo ou a um filho é o `upgrade.html` que decide, contra o grafo.
       *
       * A lista é `ov.errors`. `ov.errorsDetailed` é uma CONTAGEM — iterar aquilo
       * devolve `number 11 is not iterable` numa rota que respondia 200, e o nome
       * do campo é bom o suficiente para enganar.
       *
       * O campo é `error.nodeName`, ACHATADO: a whitelist do `extractExecDetail`
       * (`n8n.js`) emite `{type, message, description, level, functionality,
       * nodeName, nodeType}` — `error.node` não existe do lado de cá. Ler o
       * objeto aninhado dava `undefined` sempre, e o `else` respondia por todas
       * as falhas: a vitrine mostrava só o `lastNodeExecuted`, em silêncio.
       *
       * Os dois ramos não são redundantes justamente no caso sub-fluxo, que é
       * onde eles DIVERGEM: o n8n reporta a falha do filho no pai, então o nó
       * nomeado pelo erro rotineiramente não existe no grafo do fluxo que
       * falhou, e o `lastNodeExecuted` é o nó do pai que fez a chamada. */
      for (const d of ov.errors || []) {
        const r = porFluxo.get(String(d.workflowId ?? ""));
        if (!r) continue;
        const n = d.error && d.error.nodeName;
        if (n) r.falhas.add(String(n));
        else if (d.lastNode) r.falhas.add(String(d.lastNode));
      }
      const fluxos = (ov.workflows || []).map(w => {
        const st = porFluxo.get(String(w.id)) || { exec24: 0, erro24: 0, falhas: new Set() };
        return {
          id: String(w.id), nome: String(w.name ?? ""), active: !!w.active,
          nos: w.nodeCount, updatedAt: w.updatedAt || null,
          exec24: st.exec24, erro24: st.erro24, falhas: [...st.falhas],
          chamadores: []   // preenchido por /api/n8n/callers, depois da primeira pintura
        };
      });
      return json(res, 200, {
        fluxos, instancia: n8n.instance, janelaHoras: n8n.WINDOW_HOURS,
        lidoEm: ov.fetchedAt || null,
        errosTruncados: !!ov.errorsTruncated
      });
    }

    /* Peso e desenho: uma leitura do workflow por fluxo, então NÃO entra na
     * vitrine — ela tem de aparecer antes. Mesma disciplina do call graph, que o
     * cliente busca depois do primeiro paint.
     *
     * `bytes` é o documento SEM credencial, que é o que a sessão leria; `tokens`
     * é derivado dele. Nenhum parâmetro cruza: só o tamanho, e o grafo pela
     * whitelist que já existe. */
    if (p === "/api/upgrade/peso") {
      const crus = String(url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!crus.length) return json(res, 400, { error: "informe ?ids=" });
      if (crus.length > 40) return json(res, 400, { error: "no máximo 40 ids por chamada" });
      const maus = crus.filter(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id));
      if (maus.length) return json(res, 400, { error: "id inválido: " + maus[0] });

      /* PESO-INI — delimitador lido pelo teste, que dirige este laço com um cliente
       * n8n falso e MEDE a concorrência: sequencializar de volta fica vermelho. */
      /* EM PARALELO, e a ordem de `crus` é preservada porque `Promise.all`
       * devolve na ordem em que foi pedida — a vitrine desenha nessa ordem, e
       * embaralhar os cartões a cada refresh seria um efeito colateral silencioso
       * de uma mudança que só queria ser mais rápida.
       *
       * MEDIDO nos 13 ids da vitrine: 6,69s sequencial. Cada volta do laço
       * esperava dois GETs em série, e o laço esperava a volta anterior — ou seja,
       * UM request de cada vez, com a instância inteira ociosa entre eles.
       *
       * O que impede isto de inundar o n8n não é um teto daqui: é a porta de
       * `n8n.js`, que segura todo request atrás de um contador. DEPENDO da porta
       * EXISTIR, não do valor dela — hoje `MAX_INFLIGHT` é 4 (`n8n.js:58`) e este
       * código está correto para qualquer valor >= 1. É por isso que o teto certo
       * para paralelizar é aqui e não no cliente: os dois GETs de cada fluxo
       * dividem essa mesma porta com o poll, então paralelizar no navegador só
       * mudaria de lugar a fila.
       *
       * `?ids=` já é limitado a 40 acima, então o pior caso são 80 GETs na fila —
       * a mesma fila, servida na mesma largura, só sem os buracos.
       *
       * E são DOIS GETs por fluxo, não um, porque `getRawWorkflow` e `getGraph`
       * batiam na MESMA URL (`/api/v1/workflows/:id`) — o mesmo documento pedido
       * duas vezes, e o maior deles tem 291KB. `n8n.getRawEGrafo` faz um GET e
       * devolve os dois, semeando o cache de grafo de passagem: 26 GETs viraram
       * 13 nos ids desta vitrine. A extração ficou dentro do `n8n.js` de propósito
       * — derivar o grafo é derivar fato de payload cru, e essa decisão pertence à
       * whitelist, não a este arquivo.
       *
       * `catch` por fluxo, como antes: um fluxo que não pôde ser lido não vira
       * zero, vira uma ausência dita — e com `Promise.all` sem esse `catch` local
       * a primeira falha derrubaria os outros doze. */
      const pesos = await Promise.all(crus.map(async id => {
        const cache = pesoCache.get(id);
        if (cache && Date.now() - cache.at < PESO_TTL) return cache.valor;
        try {
          const { raw, graph: g } = await n8n.getRawEGrafo(id);
          const limpo = semCredenciais(raw);
          const bytes = JSON.stringify(limpo).length;
          const vivos = (g.nodes || []).filter(n => n.type !== "n8n-nodes-base.stickyNote");
          const valor = {
            id, bytes,
            // ~3,6 caracteres por token em JSON. É ESTIMATIVA e o nome do campo
            // não pode sugerir contagem exata — quem mostra na tela diz "~".
            tokens: Math.round(bytes / 3.6),
            graph: {
              nos: vivos.map(n => ({ nome: n.name, tipo: n.type, sub: n.sub, x: n.x, y: n.y })),
              arestas: (g.edges || []).map(e => ({ de: e.from, para: e.to }))
            }
          };
          pesoCache.set(id, { at: Date.now(), valor });
          return valor;
        } catch (e) {
          // Um fluxo que não pôde ser lido não vira zero: vira uma ausência dita.
          return { id, erro: String(e && e.message || e) };
        }
      }));
      /* PESO-FIM */
      return json(res, 200, { pesos });
    }

    /* A conversa. Nenhuma destas rotas escreve no n8n — `upgrade.js` não importa
     * `putWorkflow` nem `createWorkflow`. O que elas fazem é spawnar um CLI local,
     * numa sessão sem rede e sem Bash, e emitir o que ela responde. */
    if (p === "/api/upgrade/capacidades") return json(res, 200, upgrade.capacidades());

    /* A BANDEJA DA ABA UPGRADE: onde o anexo espera antes de a conversa existir.
     *
     * Aqui a sessão só nasce na PRIMEIRA mensagem (`enviar()` no `upgrade.html`
     * cria a conversa e só então manda o texto), então anexar antes dela não tem
     * id para pendurar nada. Sem bandeja a página teria de segurar os arquivos em
     * memória e mandar tudo no clique de enviar, que é justo o corpo gigante que a
     * gravação um-a-um evita.
     *
     * Nada aqui interpreta o arquivo: `anexos.js` valida extensão, nome, tamanho e
     * caminho, e recusa devolvendo a frase que a tela mostra. `categoria` atravessa
     * porque é ela que deixa a tela AGRUPAR as recusas de um lote — uma pasta de
     * projeto recusa vários de uma vez, e um aviso por arquivo vira uma coluna em
     * que o último esconde o primeiro. */
    if (p === "/api/upgrade/anexo" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, ANEXO_BODY_CAP) || "{}");
      try {
        const bandeja = body.bandeja ? String(body.bandeja) : anexos.novaBandeja();
        const dir = anexos.dirBandeja(upgrade.RUNS_DIR, bandeja);
        await fsp.mkdir(dir, { recursive: true });
        const atuais = await anexos.inventario(dir);
        const r = await anexos.gravar(dir, { nome: body.nome, rel: body.rel, b64: body.b64 }, atuais);
        if (!r.ok) return json(res, 400, { error: r.motivo, categoria: r.categoria || null, bandeja });
        const lista = await anexos.inventario(dir);
        await anexos.escreverIndice(dir, lista);
        return json(res, 200, { bandeja, anexos: lista, resumo: anexos.resumo(lista) });
      } catch (err) {
        return json(res, err.status || 400, { error: String(err && err.message || err) });
      }
    }

    // Tirar um chip antes da primeira mensagem. Só apaga dentro de `anexos/` da
    // bandeja — o guarda de caminho está em `anexos.js` e é ele que recusa o resto.
    if (p === "/api/upgrade/anexo/remover" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
      try {
        const dir = anexos.dirBandeja(upgrade.RUNS_DIR, String(body.bandeja || ""));
        await anexos.remover(dir, String(body.arquivo || ""));
        const lista = await anexos.inventario(dir);
        await anexos.escreverIndice(dir, lista);
        return json(res, 200, { bandeja: String(body.bandeja), anexos: lista, resumo: anexos.resumo(lista) });
      } catch (err) {
        return json(res, err.status || 400, { error: String(err && err.message || err) });
      }
    }

    /* O ARQUIVO DE UM ANEXO, para a conversa poder DESENHAR o print dentro da
     * mensagem que o levou. Sem esta rota o único jeito de mostrar a imagem seria
     * base64 no snapshot — 66KB por print num objeto que viaja em TODO evento do
     * SSE, várias vezes por segundo durante uma rodada.
     *
     * Endereçada pelo `convId` e não por sessão viva: uma conversa reaberta do
     * disco não tem sessão em memória, e é exatamente ali que rever o print
     * importa. O diretório é o mesmo `RAIZ/<convId>` que `iniciar` cria.
     *
     * TRÊS GUARDAS, e a do meio é a que impede o pior: o formato do `convId`
     * (senão ele vira caminho); `anexos.caminhoDeAnexo`, que prova duas vezes que o
     * alvo está debaixo de `anexos/` — sem ela um `?nome=../_private/<id>.json`
     * serviria o backup COM credencial por uma rota que existe para mostrar uma
     * imagem; e a extensão contra `anexos.TIPOS`, a MESMA lista que decidiu aceitar
     * o arquivo na entrada. Uma segunda lista aqui aceitaria na saída o que a
     * entrada recusou.
     *
     * NÃO passa pelo `serveFile`: o `estatico.negociar` guarda o buffer CRU em
     * cache por mtime, o que é certo para quatro arquivos servidos e errado para uma
     * pasta de anexos que cresce — cada print visto ficaria na memória do processo
     * até o restart. Aqui é ler e mandar. O tipo continua saindo de
     * `estatico.tipoDe`, então o MIME tem uma definição só.
     *
     * 404 é um FATO sobre o disco, não uma recusa: `.upgrade-runs/` é scratch e
     * gitignorado, então o arquivo pode ter sido limpo. O corpo diz isso em JSON
     * para a tela poder escrever "o arquivo não está mais aqui" em vez de mostrar
     * uma imagem quebrada. */
    /* ARQANEXO-INI — delimitador lido pelo `anexo-bolha-test.js`, que extrai este
       bloco e o dirige com um `req`/`res` falsos. `server.js` não é `require`ável
       (ele dá `listen()` na 4317, o terminal de verdade do Kauan), e reimplementar
       as guardas no teste provaria a cópia. Mesma disciplina do `ESTATICO-INI`. */
    if (p.startsWith("/api/upgrade/arquivo/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "só GET" });
      const convId = decodeURIComponent(p.slice("/api/upgrade/arquivo/".length));
      if (!/^u[a-z0-9]{1,32}$/.test(convId)) return json(res, 400, { error: "id de conversa inválido" });
      const nome = String(url.searchParams.get("nome") || "");
      if (!nome.startsWith("anexos/")) return json(res, 400, { error: "só arquivo de anexo" });
      const ext = path.extname(nome).toLowerCase();
      if (!anexos.TIPOS[ext]) return json(res, 400, { error: "tipo de arquivo que não entra como anexo: " + (ext || "sem extensão") });
      let alvo;
      try { alvo = anexos.caminhoDeAnexo(path.join(upgrade.RUNS_DIR, convId), nome); }
      catch (err) { return json(res, 400, { error: String(err && err.message || err) }); }
      let st;
      try { st = fs.statSync(alvo); } catch { st = null; }
      if (!st || !st.isFile()) {
        return json(res, 404, {
          error: "este anexo não está mais no disco",
          scratch: true,
          detalhe: "`.upgrade-runs/` é descartável: uma limpeza de cache apaga os arquivos e o "
            + "histórico guarda só o nome, o tipo e o tamanho."
        });
      }
      /* O TIPO DO ANEXO NAO PODE SER O TIPO QUE ELE PEDE. `anexos.TIPOS` aceita
         `.html` (classe "dados") porque a SESSAO le o arquivo com `Read`, e ler e
         inofensivo. Servir e outra coisa: `estatico.tipoDe(".html")` devolve
         `text/html`, e com `content-disposition: inline` um clique no chip abre o
         arquivo do cliente como DOCUMENTO DE PRIMEIRA PARTE em `localhost:4317` —
         com o cookie `cockpit_sessao` junto e `guarda.classificar` dizendo
         `propria`. Dali o script chama `POST /api/claude/run/:id/approve` (escreve
         em fluxo de producao), `.../retry` (mensagem real para um lead, sem
         desfazer) e `POST /api/cofre` (a chave do n8n). O vetor e a rotina que o
         `CLAUDE.md` documenta: "arraste a pasta descompactada" — uma pasta de
         projeto com um `index.html` dentro.
         `nosniff` nao ajuda quando o tipo DECLARADO ja e executavel, e o CSP de
         `estatico.SEGURANCA` so tem `frame-ancestors`, que nao governa o topo.
         Entao a lista e de RENDERIZAVEL, fechada e explicita: imagem e PDF, que e
         exatamente o que a bolha desenha. Tudo o mais desce como octeto e como
         anexo. Nao depender de `estatico.tipoDe` tambem e de proposito — hoje
         `.htm` escapa por ACIDENTE (esta fora do `estatico.TIPOS`), e seguranca
         que depende de uma ausencia quebra no dia em que alguem completa a tabela. */
      const renderavel = /^image\/|^application\/pdf$/.test(estatico.tipoDe(ext));
      const cab = {
        ...estatico.SEGURANCA,
        /* Sobrescreve, nao acrescenta: `default-src none` mais `sandbox` deixam o
           documento sem origem, sem script e sem rede mesmo que algo passe. */
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": renderavel ? estatico.tipoDe(ext) : "application/octet-stream",
        "content-length": String(st.size),
        /* `inline` para a imagem aparecer em vez de baixar, e o nome que o navegador
           usa se ele salvar. `private` porque isto é dado de cliente: nenhum
           intermediário tem por que guardar. */
        "content-disposition": (renderavel ? "inline" : "attachment")
          + '; filename="' + path.basename(alvo).replace(/["\\]/g, "") + '"',
        "cache-control": "private, max-age=300"
      };
      res.writeHead(200, cab);
      return req.method === "HEAD" ? res.end() : res.end(fs.readFileSync(alvo));
    }
    /* ARQANEXO-FIM */

    if (p === "/api/upgrade/sessao" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, 4096) || "{}");
      const wfId = String(body.wfId || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wfId)) return json(res, 400, { error: "wfId inválido" });
      /* A bandeja é validada por formato AQUI e outra vez pelo `dirBandeja` lá
         dentro: um id que veio de fora do processo nunca vira caminho sem passar
         por regex. Formato errado é tratado como ausência de bandeja em vez de
         400 — o pedido de upgrade é válido sem o print. */
      const bandeja = /^b[a-f0-9]{6,20}$/.test(String(body.bandeja || "")) ? String(body.bandeja) : null;
      const id = await upgrade.iniciar({ wfId, bandeja });
      return json(res, 202, { id });
    }

    if (p.startsWith("/api/upgrade/sessao/")) {
      const resto = p.slice("/api/upgrade/sessao/".length);
      const [id, acao] = resto.split("/");
      if (!/^u[a-z0-9]{1,32}$/.test(id || "")) return json(res, 400, { error: "id de conversa inválido" });

      if (!acao && req.method === "GET") {
        const snap = upgrade.snapshot(id);
        return snap ? json(res, 200, snap) : json(res, 404, { error: "conversa desconhecida" });
      }
      if (acao === "stream") {
        res.writeHead(200, {
          ...estatico.SEGURANCA,
        "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no"
        });
        res.write(": conectado\n\n");
        if (!upgrade.assinar(id, res)) { res.end(); return; }
        const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* fechou */ } }, 25000);
        req.on("close", () => { clearInterval(ka); upgrade.desassinar(id, res); });
        return;
      }
      if (acao === "mensagem" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, 8192) || "{}");
        return json(res, 200, await upgrade.mensagem(id, body.texto));
      }
      if (acao === "cancelar" && req.method === "POST") {
        return json(res, 200, upgrade.cancelar(id));
      }
      /* Confirmar o alvo dispara a rodada que ESCREVE O PATCH — e não escreve nada
         no n8n: o patch é aplicado a uma cópia em memória só para o diff existir.
         O 409 sobe com a frase que o `upgrade.js` montou, porque "o alvo está
         bloqueado" e "o cockpit quebrou" são histórias diferentes. */
      if (acao === "confirmar" && req.method === "POST") {
        const r = await upgrade.confirmarAlvo(id);
        return r && r.erro ? json(res, r.status || 409, { error: r.erro }) : json(res, 200, r);
      }
      /* AS DUAS ÚNICAS ROTAS DESTA ABA QUE ESCREVEM NUM FLUXO REAL.
         `qual` vem do BOTÃO que ele clicou — "normal" ou "desligado" — e nunca é
         inferido no servidor: os dois botões mostram diffs diferentes, e escrever
         o que não estava na tela é o defeito que o §5.7.2 existe para impedir. */
      if (acao === "aplicar" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, 2048) || "{}");
        const qual = body.qual === "desligado" ? "desligado" : "normal";
        const r = await upgrade.aplicar(id, qual);
        if (r && r.erro) return json(res, r.status || 409, { error: r.erro, gates: r.gates || null });
        /* O DOSSIE DO FLUXO ESCRITO ACABOU DE ENVELHECER, E AGORA ELE SE ATUALIZA
           SOZINHO — decisao explicita do Kauan, que flexibiliza o §2.8 (ver
           `dossieDepoisDeAplicar`).
         *
         * POR QUE AQUI E NAO DENTRO DO `upgrade.aplicar`: `iniciarDossie` e o job
         * dele sao um singleton DESTE arquivo, e `upgrade.js` nao pode conhecer
         * esse job — ele nao importa `dossie.js`, nao tem caminho de escrita local
         * e `upgrade-test.js` afirma essa ausencia em vez de confiar nela. Injetar
         * um callback la dentro daria o mesmo efeito com uma dependencia nova; o
         * handler da rota e o unico chamador de `aplicar` (verificado), entao ele e
         * o ponto mais barato que mantem os dois modulos como estao.
         *
         * SEM `await`, DE PROPOSITO: a resposta do apply nao pode esperar por uma
         * leitura de dossie, e muito menos pelos ~11 minutos de uma escrita. Ela
         * responde na hora e a tela acompanha pelo estado do dossie, igual ao botao
         * manual ja faz. `dossieDepoisDeAplicar` nunca joga, entao nao ha rejeicao
         * sem dono aqui.
         *
         * O ALVO E O FLUXO ESCRITO, NAO O ABERTO: por causa do §4.5 o patch pode
         * ter ido para um sub-fluxo, e o dossie que envelheceu e o de lá. Ler
         * `S.sel` seria escrever o dossie do fluxo errado, pago e em silencio — o
         * mesmo defeito que o `data-wf` do botao existe para impedir. */
        const escrito = r.aplicado && r.aplicado.wfId;
        if (escrito) dossieDepoisDeAplicar(escrito);
        return json(res, 200, r);
      }
      if (acao === "desfazer" && req.method === "POST") {
        const r = await upgrade.desfazer(id);
        return r && r.erro ? json(res, r.status || 409, { error: r.erro }) : json(res, 200, r);
      }
      /* Anexar com a conversa já aberta: direto no diretório dela, sem bandeja.
       * Não dispara rodada — quem manda a sessão olhar é a mensagem seguinte, pelo
       * caminho de texto que já existe. É o que permite arrastar três arquivos e
       * falar uma vez em vez de pagar uma rodada por arquivo. */
      if (acao === "anexo" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, ANEXO_BODY_CAP) || "{}");
        try {
          return json(res, 200, await upgrade.anexar(id, { nome: body.nome, rel: body.rel, b64: body.b64 }));
        } catch (err) {
          return json(res, err.status || 400, {
            error: String(err && err.message || err), categoria: err && err.categoria || null
          });
        }
      }
      if (acao === "desanexar" && req.method === "POST") {
        const body = JSON.parse(await readBody(req, FIX_BODY_CAP) || "{}");
        try {
          return json(res, 200, await upgrade.desanexar(id, String(body.arquivo || "")));
        } catch (err) { return json(res, err.status || 400, { error: String(err && err.message || err) }); }
      }
      return json(res, 404, { error: "ação desconhecida" });
    }

    /* ───────────────────────────────── o histórico de conversas do fluxo ─────
     *
     * FATOS: a lista, quantas não deram para ler, qual está rodando e em que
     * fluxo, e o que está na lixeira. Qual estado "pede ação", em que ordem a
     * lista aparece, e se o fluxo mudou desde a conversa é o `upgrade.html` que
     * decide — a comparação de `wfUpdatedAt` mora no bloco de juízo dele.
     *
     * `erro` e `conversas: []` são coisas DIFERENTES e a rota não as mistura:
     * uma lista vazia diz que nunca houve conversa neste fluxo, um `erro` diz que
     * eu não sei o que existe. Deixar a segunda cair na primeira seria afirmar
     * ausência a partir de uma falha de leitura. */
    if (p.startsWith("/api/upgrade/conversas/")) {
      const wfId = decodeURIComponent(p.slice("/api/upgrade/conversas/".length));
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wfId)) return json(res, 400, { error: "wfId inválido" });
      const r = await conversas.listar(wfId, upgrade.rodandoAgora());
      return json(res, 200, {
        conversas: r.conversas, ilegiveis: r.ilegiveis, erro: r.erro,
        // Uma conversa roda por vez em TODA a aba, então isto é sobre o cockpit e
        // não sobre este fluxo: é o que deixa `+ nova conversa` aparecer
        // desabilitado dizendo quem está ocupando, em vez de dar 409 no clique.
        ativa: upgrade.ativaAgora(),
        lixeira: await conversas.naLixeira(wfId, null)
      });
    }

    /* Uma conversa em particular: reabrir, ou apagar.
     *
     * Reabrir é POST e não GET porque ele tem efeito: devolve a conversa para a
     * memória do processo, relê o fluxo no n8n e — quando ela tinha ficado em
     * `correndo` — registra a rodada que o cockpit fechou por cima. Nada disso é
     * leitura pura, e nenhum deles gasta cota: o CLI só é spawnado pela mensagem
     * seguinte. */
    if (p.startsWith("/api/upgrade/conversa/")) {
      const partes = p.slice("/api/upgrade/conversa/".length).split("/").map(decodeURIComponent);
      const [wfId, convId, acao] = partes;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wfId || "")) return json(res, 400, { error: "wfId inválido" });
      if (!/^u[a-z0-9]{1,32}$/.test(convId || "")) return json(res, 400, { error: "id de conversa inválido" });

      if (acao === "abrir" && req.method === "POST") {
        return json(res, 200, await upgrade.retomar({ wfId, convId }));
      }
      if (acao === "apagar" && req.method === "POST") {
        /* Esquecer ANTES de mover: com a sessão ainda no Map, a transição de
           estado seguinte reescreveria o arquivo e a linha voltaria para a gaveta
           sozinha. E `esquecer` recusa por nome se ela estiver rodando, então
           apagar nunca mata uma rodada de lado. */
        upgrade.esquecer(convId);
        return json(res, 200, await conversas.apagar(wfId, convId));
      }
      return json(res, 404, { error: "ação desconhecida" });
    }

    /* Voltar da lixeira. A porta existe porque apagar aqui não tem `git checkout`
     * como saída: `conversas/` é gitignored, então NENHUMA conversa está em git. */
    if (p.startsWith("/api/upgrade/lixeira/") && req.method === "POST") {
      const wfId = decodeURIComponent(p.slice("/api/upgrade/lixeira/".length).split("/")[0]);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wfId)) return json(res, 400, { error: "wfId inválido" });
      const body = JSON.parse(await readBody(req, 2048) || "{}");
      return json(res, 200, await conversas.restaurar(wfId, String(body.lixo || "")));
    }

    /* Uma conversa aberta para este fluxo, se houver. A tela pergunta ao abrir:
     * uma conversa que custou minutos não pode morrer num F5. */
    if (p.startsWith("/api/upgrade/aberta/")) {
      const wfId = decodeURIComponent(p.slice("/api/upgrade/aberta/".length));
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wfId)) return json(res, 400, { error: "wfId inválido" });
      return json(res, 200, { id: upgrade.daquiFluxo(wfId) });
    }

    /* ──────────────────── o semáforo do dossiê de VÁRIOS fluxos, de uma vez ──
     *
     * O buraco que esta rota fecha: o semáforo só disparava quando a tela DAQUELE
     * fluxo era aberta. São 75 fluxos e ele abre três, então "quais dossiês
     * apodreceram" não tinha resposta sem 75 cliques.
     *
     * FATOS: cor, motivo, contagens, e quantos fluxos não deu para ler. O que a cor
     * significa no cartão — e que vermelho e cinza querem dizer "não dá para
     * conversar com este fluxo" — é juízo, e mora no `upgrade.html`.
     *
     * Perguntada DEPOIS da primeira pintura, como o peso e o call graph. */
    if (p === "/api/upgrade/dossies") {
      const crus = String(url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!crus.length) return json(res, 400, { error: "informe ?ids=" });
      if (crus.length > 40) return json(res, 400, { error: "no máximo 40 ids por chamada" });
      const maus = crus.filter(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id));
      if (maus.length) return json(res, 400, { error: "id inválido: " + maus[0] });
      return json(res, 200, await varrerDossies(crus));
    }

    /* ───────────────────────────────────────────────────── o dossiê do fluxo ──
     *
     * FATOS: a cor da divergência, o motivo, quem mudou, o tamanho e o preço
     * estimado. Quem desenha a faixa e decide o texto do botão é o
     * `upgrade.html`. A COR vem do `dossie.js` de propósito e isso está declarado
     * lá: a tela, o prompt e esta rota precisam da MESMA resposta, e duas
     * definições de "está em dia" seriam a deriva que `SCRATCH` já tem entre duas
     * páginas.
     *
     * Escrever é POST, nunca efeito de um GET: uma escrita custa minutos e cota
     * do plano, e gastar sem clique é o que este codebase recusa em todo lugar. */
    if (p.startsWith("/api/upgrade/dossie/")) {
      const wfId = decodeURIComponent(p.slice("/api/upgrade/dossie/".length));
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wfId)) return json(res, 400, { error: "wfId inválido" });

      if (req.method === "GET") return json(res, 200, await dossieEstado(wfId));

      if (req.method === "POST") {
        if (!n8n.configured) return json(res, 503, { error: "n8n não configurado" });
        if (!claudeFix.claudeFound) return json(res, 503, { error: "Claude Code CLI não encontrado" });
        /* Um por vez: cada escrita spawna um CLI e gasta cota. Mesma regra do
           `/api/claude/fix` e do build do Tester. */
        if (dossieJob && dossieJob.escrevendo) {
          return json(res, 409, { error: "já estou escrevendo o dossiê de " + dossieJob.nome, job: dossieResumo() });
        }
        /* `?incremental=1` — UM booleano, e ele vai na query e não no corpo porque a
           URL desta rota já é lida e validada duas linhas acima; um leitor de corpo
           aqui seria um segundo caminho de parse para uma flag.
           QUEM PEDE É A PÁGINA, contra o fato `incremental.admitido` que o GET
           emite. O servidor não decide que uma escrita parcial basta. */
        const parcial = url.searchParams.get("incremental") === "1";
        /* A RECUSA NO LUGAR DA QUEDA, e é aqui que ela tem de estar.
           `construir` reconsulta a admissão e, se ela caiu, cai para rewrite
           inteiro de graça e DIZ por quê — contrato certo para o CLI, onde quem
           pediu está lendo a linha e pode parar. Pelo botão não: o consentimento
           foi dado sobre a cotação parcial que estava na tela, e cair para o
           inteiro gastaria a reescrita de US$4,14 medidos sem um segundo clique.
           Isso é o gasto invisível do §2.3.1 com a tela tendo prometido outra
           coisa. A conferência é local e de graça (`planoIncremental` é pura), e
           recusar nomeando o motivo é o que este repositório faz em vez de
           publicar algo que ninguém autorizou. */
        if (parcial) {
          let adm = null;
          try {
            const raw = await n8n.getRawWorkflow(wfId);
            const doc = await dossie.ler(wfId);
            adm = dossie.planoIncremental(doc, dossie.estado(doc, raw), raw);
          } catch (e) {
            return json(res, 503, { error: "não deu para conferir se a escrita parcial ainda vale: " + String(e && e.message || e).slice(0, 160) });
          }
          if (!adm.ok) {
            return json(res, 409, { error: "a escrita parcial já não vale: " + adm.porque
              + " — o preço na tela era o da parcial, então não começo um rewrite inteiro sem você pedir de novo",
              incremental: { admitido: false, porque: adm.porque } });
          }
        }
        iniciarDossie(wfId, { incremental: parcial });
        return json(res, 202, { job: dossieResumo() });
      }
      return json(res, 404, { error: "ação desconhecida" });
    }

    if (p === "/api/n8n/overview") return json(res, 200, await n8n.overview());

    if (p === "/api/n8n/stream") {
      res.writeHead(200, {
        ...estatico.SEGURANCA,
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
      const d = await detalheComCache(name, { refresh: url.searchParams.get("refresh") === "1" });
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
    if (p === "/tester") return serveFile(req, res, path.join(__dirname, "tester.html"));

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
          ...estatico.SEGURANCA,
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

    /* O ledger da CORREÇÃO. `proposals.json` passou a guardar dois tipos de
       linha (etapa 1, PLAN-UPGRADE.md §7.1) e esta rota vive no namespace
       `/api/claude/`, então ela devolve `fix` — sem o filtro, no dia em que a aba
       Upgrade gravar, ela começaria a servir upgrade como se fosse correção.
       FATO a registrar: hoje NINGUÉM consome esta rota — nem `flows.html`, nem
       nenhum outro arquivo (conferido por grep). Ela existe para inspeção. Por
       isso o filtro entra agora, enquanto não há consumidor para quebrar; quando
       existir um que queira os dois tipos, ele pede o tipo, não a mistura. */
    if (p === "/api/claude/proposals" && req.method === "GET") {
      return json(res, 200, { proposals: await claudeFix.readStore("fix") });
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
          ...estatico.SEGURANCA,
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

    res.writeHead(404, { ...estatico.SEGURANCA, "content-type": "text/plain; charset=utf-8" });
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
  /* O estado do portão é dito em voz alta no boot, e os três casos são
     distintos. Um painel que redireciona tudo para o login sem explicar manda
     quem lê procurar defeito no lugar errado — e a sessão morre com o processo,
     então "reiniciei e perdi o login" vai acontecer e precisa ser reconhecível. */
  if (!perfil.configurado().ok) {
    console.log("login: DESLIGADO — falta SUPABASE_URL/SUPABASE_ANON_KEY no .env");
  } else if (!LOGIN_EXIGIDO) {
    console.log("login: DESLIGADO por COCKPIT_LOGIN=0 — as páginas abrem sem sessão");
  } else {
    console.log("login: exigido nas páginas. A sessão vive neste processo — reiniciar desloga.");
  }
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
  // As DUAS raízes, porque são duas bandejas em dois diretórios diferentes: o
  // Tester guarda em `.tester-runs/_bandejas` e o Upgrade em
  // `.upgrade-runs/_bandejas`. Limpar só a primeira deixaria a segunda crescendo
  // calada, que é exatamente o defeito que esta linha existe para não ter.
  for (const [rotulo, raiz] of [["tester", TESTER_RUNS], ["upgrade", upgrade.RUNS_DIR]]) {
    anexos.limparBandejas(raiz, 24 * 60 * 60 * 1000)
      .then(n => { if (n) console.log(`bandejas de anexo abandonadas removidas (${rotulo}): ${n}`); })
      .catch(err => console.log(`não consegui limpar bandejas de anexo (${rotulo}):`, err.message));
  }
});
