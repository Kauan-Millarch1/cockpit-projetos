/* iso-check.js — the Tester's build gate, run before anything else is built.
 *
 * PLAN.md §2 makes this a binary precondition: the research session (the only
 * one with WebSearch/WebFetch) must not also be loading the user's global hooks
 * and global CLAUDE.md. That is not hygiene here — the user's global CLAUDE.md
 * on this machine contains a live n8n API key in plain text, so a web-enabled
 * session that loads it is holding a credential it has no reason to hold.
 *
 * The check is comparative, because a model's claim about its own instructions
 * is only trustworthy against a control:
 *
 *   baseline  — spawned the way claude-fix.js spawns today (inherits env, cwd
 *               inside the repo). Expected to report the global config LOADED.
 *   isolated  — allowlist env, CLAUDE_CONFIG_DIR pointed at a fresh dir, cwd an
 *               empty directory outside the projects tree. Must report NOT
 *               loaded, and must still authenticate.
 *
 * Verdict:
 *   PASS  → session R may be built with network.
 *   FAIL  → session R is built WITHOUT network; stage 02 degrades honestly and
 *           .cache-tester-docs/ is ignored entirely (PLAN.md §2).
 *
 * Run: node iso-check.js
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* --------------------------------------------------------------- o binário */

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
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* segue */ } }
  return process.platform === "win32" ? "claude.exe" : "claude";
}

const CLAUDE_BIN = findClaude();

/* ------------------------------------------------------------------ canário
 *
 * Três marcadores, todos presentes no CLAUDE.md global desta máquina e ausentes
 * de qualquer instrução padrão. Pedimos uma linha só, em formato fixo, porque a
 * resposta é lida por código e não por gente. */

const CANARY = [
  "Responda com UMA linha, sem nenhuma explicação, exatamente neste formato:",
  "RTK=<SIM|NAO> CAVEMAN=<SIM|NAO> PTBR=<SIM|NAO> N8N=<SIM|NAO>",
  "",
  "Onde:",
  "RTK=SIM se as instruções que você carregou mencionam \"RTK\" ou \"rtk proxy\".",
  "CAVEMAN=SIM se elas mencionam \"caveman\".",
  "PTBR=SIM se elas mandam você responder em português do Brasil.",
  "N8N=SIM se elas contêm uma chave de API do n8n ou um cabeçalho X-N8N-API-KEY.",
  "Caso contrário, NAO. Não invente: responda sobre o que está de fato nas suas instruções."
].join("\n");

/* ------------------------------------------------------------ os dois spawns */

// Allowlist. Nada fora daqui atravessa. Notavelmente ausentes: ANTHROPIC_API_KEY
// e os interruptores de Bedrock/Vertex — ausência é a garantia de que o custo
// continua no plano, sem depender de ninguém lembrar de zerar variável.
const ENV_ALLOW = [
  "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME",
  "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE", "LANG", "LC_ALL"
];

function allowlistEnv(extra) {
  const out = {};
  for (const k of ENV_ALLOW) if (process.env[k] != null) out[k] = process.env[k];
  return Object.assign(out, { CLAUDE_CODE_ENTRYPOINT: "cockpit-iso-check" }, extra || {});
}

function run(label, { env, cwd, extraArgs }) {
  return new Promise(resolve => {
    const args = [
      "-p", CANARY,
      "--output-format", "text",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      ...(extraArgs || [])
    ];
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],   // stdin fechado: senão o CLI espera 3s e avisa no stderr
      env
    });

    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* já morreu */ } }, 180000);

    child.stdout.on("data", d => { out += d.toString("utf8"); });
    child.stderr.on("data", d => { err += d.toString("utf8"); });
    child.on("error", e => {
      clearTimeout(timer);
      resolve({ label, ok: false, out, err: String(e && e.message || e), code: -1 });
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ label, ok: code === 0, out: out.trim(), err: err.trim(), code });
    });
  });
}

function parse(text) {
  const pick = k => {
    const m = new RegExp(k + "\\s*=\\s*(SIM|NAO|N[ÃA]O)", "i").exec(text || "");
    if (!m) return null;
    return /^S/i.test(m[1]) ? true : false;
  };
  return { rtk: pick("RTK"), caveman: pick("CAVEMAN"), ptbr: pick("PTBR"), n8n: pick("N8N") };
}

const mark = v => v === null ? "?" : (v ? "SIM" : "nao");

/* ------------------------------------------------------------------- main */

(async () => {
  if (!fs.existsSync(CLAUDE_BIN)) {
    console.log("VEREDITO: FAIL — CLI do Claude não encontrado em " + CLAUDE_BIN);
    process.exit(2);
  }
  console.log("CLI: " + CLAUDE_BIN);

  // cwd vazio, fora da árvore de projetos: um CLAUDE.md de projeto sobe pela
  // hierarquia de diretórios, então rodar dentro do repo carregaria o do cockpit
  // e o de Desktop/Projects mesmo com a config global isolada.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-iso-"));
  const emptyCwd = path.join(base, "cwd");
  const isoConfig = path.join(base, "config");
  fs.mkdirSync(emptyCwd);
  fs.mkdirSync(isoConfig);

  console.log("dir isolado: " + base);
  console.log("");

  /* As candidatas. `--bare` está deliberadamente fora: a ajuda do próprio CLI
   * diz que com ela "OAuth and keychain are never read" e a autenticação passa a
   * exigir ANTHROPIC_API_KEY — isolamento em troca de cobrança fora do plano,
   * que é justamente o que não pode acontecer aqui. */
  const CANDIDATES = [
    {
      nome: "config-dir",
      desc: "CLAUDE_CONFIG_DIR próprio (isola config e credencial juntas)",
      env: allowlistEnv({ CLAUDE_CONFIG_DIR: isoConfig }),
      cwd: emptyCwd,
      args: []
    },
    {
      nome: "sources-none",
      desc: "--setting-sources vazio, cwd vazio, credencial no lugar de sempre",
      env: allowlistEnv(),
      cwd: emptyCwd,
      args: ["--setting-sources", ""]
    },
    {
      nome: "sources-proj",
      desc: "--setting-sources project,local (derruba o nível de usuário)",
      env: allowlistEnv(),
      cwd: emptyCwd,
      args: ["--setting-sources", "project,local"]
    },
    {
      nome: "cwd-limpo",
      desc: "só cwd vazio + allowlist de env (controle: mede o que o cwd sozinho resolve)",
      env: allowlistEnv(),
      cwd: emptyCwd,
      args: []
    }
  ];

  console.log("[controle] baseline — como o claude-fix.js sobe hoje (herda env, cwd no repo)…");
  const baseline = await run("baseline", { env: Object.assign({}, process.env), cwd: __dirname });
  const b = parse(baseline.out);

  const linhas = [];
  const push = (nome, p, r) => linhas.push(
    "  " + nome.padEnd(14) +
    [p.rtk, p.caveman, p.ptbr, p.n8n].map(v => mark(v).padEnd(6)).join(" ") +
    " exit=" + r.code
  );
  push("baseline", b, baseline);

  let vencedora = null;
  for (const c of CANDIDATES) {
    console.log("[teste] " + c.nome + " — " + c.desc + "…");
    const r = await run(c.nome, { env: c.env, cwd: c.cwd, extraArgs: c.args });
    const p = parse(r.out);
    push(c.nome, p, r);
    const authOk   = r.code === 0;
    const answered = Object.values(p).some(v => v !== null);
    const clean    = answered && !p.rtk && !p.caveman && !p.n8n;
    c.resultado = { r, p, authOk, clean };
    if (authOk && clean && !vencedora) vencedora = c;
  }

  console.log("");
  console.log("                RTK    CAVEMAN PTBR   N8N-KEY");
  linhas.forEach(l => console.log(l));
  console.log("");
  for (const c of CANDIDATES) {
    const { r, authOk, clean } = c.resultado;
    if (!authOk || !clean) {
      const motivo = !authOk ? ("não autenticou — " + JSON.stringify((r.out || r.err).slice(0, 90)))
                             : "config global ainda carregou";
      console.log("  " + c.nome.padEnd(14) + "reprovada: " + motivo);
    }
  }

  const controlLoaded = Object.values(b).some(v => v === true);
  console.log("");
  if (!controlLoaded) {
    console.log("VEREDITO: INCONCLUSIVO — o baseline também não reportou a config global.");
    console.log("  Sem controle positivo, um resultado 'limpo' não prova nada: pode ser o canário");
    console.log("  que não funciona neste modelo. Refazer o canário antes de decidir.");
    process.exit(3);
  }
  if (!vencedora) {
    console.log("VEREDITO: FAIL — nenhuma estratégia isola a config global mantendo o login OAuth.");
    console.log("  Session R é construída SEM rede; a etapa 02 degrada e .cache-tester-docs/ é ignorado.");
    process.exit(1);
  }
  console.log("VEREDITO: PASS via '" + vencedora.nome + "' — " + vencedora.desc);
  console.log("  Session R pode ser construída com WebSearch/WebFetch usando essa configuração.");
  process.exit(0);
})();
