"use strict";
/* ia-fiacao-test.js — a LIGAÇÃO do `ia.js` nos quatro sítios que spawnam o CLI.
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO PROVA. O `ia-test.js` prova a
 * FUNÇÃO: que `argumentosDaRodada` monta as cercas, que `ambienteDaRodada` deixa
 * a chave de API ausente, que `descobrir` tem três estados. Nada disso diz que o
 * PRODUTO usa qualquer uma dessas coisas. A lição que este repositório já pagou
 * está escrita em três arquivos: *um teste que exercita a função e não a ligação
 * deixa o produto parar de passar o argumento sem nada ficar vermelho.*
 *
 * Então aqui nada é remontado. `child_process.spawn` é trocado no `require.cache`
 * por um dublê que CAPTURA `(bin, args, opts)` e devolve um filho falso, e a
 * função de verdade de cada módulo é chamada. É a forma do `rodada-teto-test.js`,
 * e ela é obrigatória e não estilo: reimplementar o array aqui provaria a cópia.
 * A troca acontece ANTES do `require` do módulo, porque os três capturam o
 * `spawn` por desestruturação no topo — trocar depois não pegaria.
 *
 * OS QUATRO SÍTIOS: `claude-fix.js` (`runClaude`), `tester.js` (`rodar` e
 * `rodarAvulso`) e `upgrade.js` (`rodar`).
 *
 * DE GRAÇA. Nenhum CLI spawnado de verdade, nenhuma rede, nada escrito no
 * repositório, nada falado com o n8n. `node ia-fiacao-test.js`.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ia = require("./ia.js");

let ok = 0, mau = 0;
const t = (nome, fn) => {
  try { fn(); ok++; }
  catch (e) { mau++; console.log("  ✗ " + nome + "\n      " + String((e && e.message) || e).split("\n")[0]); }
};
const eq = (a, b, m) => {
  if (a !== b) throw new Error((m || "") + " esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
};
const tem = (s, sub, m) => {
  if (!String(s).includes(sub)) throw new Error((m || "") + " não contém " + JSON.stringify(sub));
};

/* A FONTE SEM COMENTÁRIO, e ela não é zelo. O `dossie-tela-test.js` pagou por
   isto: dois casos ficaram VERDES porque a palavra que procuravam vivia num
   comentário que explicava a decisão — o guarda tinha sido apagado e o teste
   aprovou a ausência dele. Aqui a tentação é a mesma e é maior: os três arquivos
   citam `--disallowedTools`, `findClaude` e `process.env` em prosa, exatamente
   para explicar por que aquilo saiu de lá. */
function fonteLimpa(arquivo) {
  return fs.readFileSync(path.join(__dirname, arquivo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
}

const ARQUIVOS = ["claude-fix.js", "tester.js", "upgrade.js"];

/* ══════════════════════════════════════════════════════════════════════════════
   O DUBLÊ — um node filho por lote, com `spawn` trocado antes do require
   ═════════════════════════════════════════════════════════════════════════════ */

const HARNESS = String.raw`
const { EventEmitter } = require("events");
const cp = require("child_process");
const path = require("path");

const RAIZ = process.argv[2];
const SITIOS = process.argv.slice(3);

let capturas = [];

class Falso extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.kill = () => { setTimeout(() => this.emit("close", 0), 3); };
    /* Devolve um 'result' e fecha: é a rodada saudável mais curta possível, e é
       o que faz as quatro promessas resolverem sem relógio de parede. */
    setTimeout(() => {
      this.stdout.emit("data", Buffer.from(JSON.stringify(
        { type: "result", total_cost_usd: 0.5, session_id: "sid-do-duble" }) + "\n"));
      this.emit("close", 0);
    }, 10);
  }
}
cp.spawn = (bin, args, opts) => {
  const env = (opts && opts.env) || null;
  capturas.push({
    bin: bin,
    args: args,
    /* O ambiente viaja como LISTA DE NOMES e três perguntas fechadas. O valor de
       uma variável de ambiente nunca sai daqui: este arquivo vai para o git. */
    envNomes: env ? Object.keys(env).sort() : null,
    envEhObjeto: !!env,
    temChaveAnthropic: env ? ("ANTHROPIC_API_KEY" in env) : null,
    temChaveOpenai: env ? ("OPENAI_API_KEY" in env) : null,
    carimbo: env ? (env.CLAUDE_CODE_ENTRYPOINT === undefined ? null : env.CLAUDE_CODE_ENTRYPOINT) : null,
    temPath: env ? ("PATH" in env || "Path" in env) : null,
    temAppdata: env ? ("APPDATA" in env) : null,
    herdouLixo: env ? ["GIT_ASKPASS", "CLAUDE_CODE_MESSAGING_TOKEN", "N8N_API_KEY", "USERNAME"].filter(k => k in env) : null
  });
  return new Falso();
};

const fix = require(path.join(RAIZ, "claude-fix.js"));
const te  = require(path.join(RAIZ, "tester.js"));
const up  = require(path.join(RAIZ, "upgrade.js"));

function sessaoTester() {
  return { id: "t1", gen: 1, status: "correndo", log: [], custo: [], etapas: [], versao: 0 };
}
function sessaoUpgrade(sessionId, correcoes) {
  return {
    id: "u1", gen: 1, status: "correndo", dir: process.cwd(), log: [], custo: [],
    chat: [{ de: "eu", texto: "tira o clickup", em: new Date().toISOString() }],
    wfNome: "F", nos: 3, nomes: [], anexos: [], evidencias: [], atividade: null,
    /* 'correcoes' e a lista de motivos pelos quais a resposta anterior foi
       recusada. Ela entra INTEIRA no prompt e nao tem teto proprio: e o caminho
       real pelo qual o prompt desta aba passa dos 24000.
       Sem crase neste comentario de proposito -- ele vive dentro de um
       String.raw, e uma crase aqui fecharia o template no meio do harness. */
    correcoes: correcoes || null,
    sessionId: sessionId || null
  };
}

async function um(sitio) {
  capturas = [];
  let retorno = null;
  if (sitio === "fix")            retorno = await fix.runClaude({ id: "r1", dir: process.cwd(), log: [] }, { prompt: "arrume o no X", resume: null });
  else if (sitio === "fix-resume")retorno = await fix.runClaude({ id: "r1", dir: process.cwd(), log: [] }, { prompt: "arrume o no X", resume: "sess-antiga" });
  else if (sitio === "fix-modelo") {
    process.env.COCKPIT_CLAUDE_MODEL = "opus";
    retorno = await fix.runClaude({ id: "r1", dir: process.cwd(), log: [] }, { prompt: "arrume o no X", resume: null });
    delete process.env.COCKPIT_CLAUDE_MODEL;
  }
  else if (sitio === "fix-grande")retorno = await fix.runClaude({ id: "r1", dir: process.cwd(), log: [] }, { prompt: "x".repeat(40000), resume: null });
  else if (sitio === "tester")     retorno = await te.rodar(sessaoTester(), { rotulo: "Desenhar", prompt: "monte o fluxo", ferramentas: "Read,Write,Edit,Glob,Grep", cwd: process.cwd(), modelo: "opus", comRede: false });
  else if (sitio === "tester-rede")retorno = await te.rodar(sessaoTester(), { rotulo: "Pesquisar", prompt: "leia a doc", ferramentas: "Read,Write,WebSearch,WebFetch", cwd: process.cwd(), modelo: "sonnet", comRede: true });
  else if (sitio === "tester-grande") retorno = await te.rodar(sessaoTester(), { rotulo: "Desenhar", prompt: "x".repeat(40000), ferramentas: "Read", cwd: process.cwd(), modelo: "opus", comRede: false });
  else if (sitio === "avulso")     retorno = await te.rodarAvulso({ prompt: "julgue o changelog", ferramentas: "Read,Write", cwd: process.cwd(), modelo: "sonnet", comRede: false });
  else if (sitio === "avulso-rede")retorno = await te.rodarAvulso({ prompt: "leia o feed", ferramentas: "Read,Write,WebFetch", cwd: process.cwd(), modelo: "sonnet", comRede: true });
  else if (sitio === "avulso-grande") retorno = await te.rodarAvulso({ prompt: "x".repeat(40000), ferramentas: "Read", cwd: process.cwd(), modelo: "sonnet", comRede: false });
  else if (sitio === "upgrade")    retorno = await up.rodar(sessaoUpgrade(null), 1, false);
  else if (sitio === "upgrade-patch") retorno = await up.rodar(sessaoUpgrade(null), 1, true);
  else if (sitio === "upgrade-resume") retorno = await up.rodar(sessaoUpgrade("sess-antiga"), 1, false);
  else if (sitio === "upgrade-grande") retorno = await up.rodar(sessaoUpgrade(null, ["x".repeat(30000)]), 1, false);
  else throw new Error("sitio desconhecido: " + sitio);
  return { sitio, capturas, retorno };
}

const manter = setInterval(() => {}, 30);
(async () => {
  const out = [];
  for (const s of SITIOS) out.push(await um(s));
  clearInterval(manter);
  console.log("@@" + JSON.stringify(out));
  process.exit(0);
})().catch(e => {
  clearInterval(manter);
  console.log("@@" + JSON.stringify([{ erro: String((e && e.stack) || e) }]));
  process.exit(1);
});
`;

const SITIOS = [
  "fix", "fix-resume", "fix-modelo", "fix-grande",
  "tester", "tester-rede", "tester-grande",
  "avulso", "avulso-rede", "avulso-grande",
  "upgrade", "upgrade-patch", "upgrade-resume", "upgrade-grande"
];

const ARQ = path.join(os.tmpdir(), "cockpit-ia-fiacao-" + process.pid + ".js");
fs.writeFileSync(ARQ, HARNESS);

let R = {};
try {
  const bruto = execFileSync(process.execPath, [ARQ, __dirname, ...SITIOS], {
    encoding: "utf8", timeout: 120000,
    /* `COCKPIT_CLAUDE_MODEL` sai do ambiente do filho de propósito: o caso do
       `--model` ausente é a metade que só existe quando não há modelo, e uma
       variável herdada da máquina de quem roda o teste apagaria essa metade. */
    env: Object.assign({}, process.env, { COCKPIT_CLAUDE_MODEL: "" })
  });
  const linha = bruto.trim().split("\n").filter(l => l.startsWith("@@")).pop();
  if (!linha) throw new Error("o harness não devolveu nada: " + bruto.slice(0, 400));
  for (const x of JSON.parse(linha.slice(2))) {
    if (x.erro) throw new Error("o harness quebrou: " + x.erro.split("\n").slice(0, 3).join(" | "));
    R[x.sitio] = x;
  }
} finally {
  try { fs.unlinkSync(ARQ); } catch { /* já foi */ }
}

/* Um spawn, e só um, por sítio que deve spawnar. */
function spawnDe(sitio) {
  const r = R[sitio];
  if (!r) throw new Error("o sítio `" + sitio + "` não voltou do harness");
  if (r.capturas.length !== 1) {
    throw new Error("o sítio `" + sitio + "` produziu " + r.capturas.length + " spawn(s), esperava 1");
  }
  return r.capturas[0];
}
/* O par flag+valor, por NOME e por adjacência. Contar é a asserção errada: uma
   flag troca de lugar com outra e a contagem não muda. */
function par(args, flag) {
  const i = args.indexOf(flag);
  return i < 0 ? null : { i, valor: args[i + 1] };
}

/* Os sítios que de fato spawnam (os `-grande` recusam antes). */
const QUE_SPAWNAM = ["fix", "fix-resume", "fix-modelo", "tester", "tester-rede",
                     "avulso", "avulso-rede", "upgrade", "upgrade-patch", "upgrade-resume"];
/* Um representante de cada um dos QUATRO sítios de código. */
const OS_QUATRO = { "claude-fix.js/runClaude": "fix", "tester.js/rodar": "tester",
                    "tester.js/rodarAvulso": "avulso", "upgrade.js/rodar": "upgrade" };

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 1 — as quatro cercas, por NOME, em cada um dos quatro sítios
   ─────────────────────────────────────────────────────────────────────────────
   Uma asserção por flag, nunca por contagem. E o valor junto da flag: um mutante
   que troca `""` por `"user"` em `--setting-sources` não mexe em contagem
   nenhuma, e é a diferença entre a sessão carregar ou não o `CLAUDE.md` global —
   que nesta máquina tem a chave da API do n8n em texto puro.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 1 ] as quatro cercas, uma asserção por nome, nos quatro sítios");

for (const [nome, sitio] of Object.entries(OS_QUATRO)) {
  t(nome + ": `--disallowedTools` está presente (é a ÚNICA que restringe — `--allowedTools` só auto-aprova)", () => {
    const p = par(spawnDe(sitio).args, "--disallowedTools");
    if (!p) throw new Error("a cerca que de fato restringe sumiu do comando");
    tem(p.valor, "Bash", "a lista negada não nega Bash:");
  });

  t(nome + ": `--setting-sources` está presente e o valor é a string VAZIA", () => {
    const args = spawnDe(sitio).args;
    const i = args.indexOf("--setting-sources");
    if (i < 0) throw new Error("sem isto a sessão carrega o CLAUDE.md global de quem instalou o painel");
    eq(args[i + 1], "", "o valor tem de ser a string vazia: qualquer outra coisa é uma fonte de settings.");
  });

  t(nome + ": `--strict-mcp-config` está presente", () => {
    const args = spawnDe(sitio).args;
    if (args.indexOf("--strict-mcp-config") < 0) throw new Error("sem ela a sessão sobe todo MCP configurado");
  });

  t(nome + ": `--mcp-config` está presente e desliga TODOS os servidores", () => {
    const p = par(spawnDe(sitio).args, "--mcp-config");
    if (!p) throw new Error("`--mcp-config` sumiu");
    eq(p.valor, '{"mcpServers":{}}', "o valor não é o objeto vazio:");
  });
}

t("as quatro cercas estão em TODOS os spawns, inclusive os de retentativa e de patch", () => {
  for (const s of QUE_SPAWNAM) {
    const args = spawnDe(s).args;
    for (const f of ["--disallowedTools", "--setting-sources", "--strict-mcp-config", "--mcp-config"]) {
      if (args.indexOf(f) < 0) throw new Error(s + " spawnou sem `" + f + "`");
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 2 — o ambiente do filho: a ausência da chave, e a companheira positiva
   ─────────────────────────────────────────────────────────────────────────────
   A ausência sozinha não prova nada: um `{}` passaria em todas as asserções
   negativas deste bloco. É por isso que `PATH` e `APPDATA` são exigidos junto —
   `APPDATA` é de onde sai a credencial OAuth do Claude, então tirá-la troca
   "gasta o plano" por "não autentica", e o sintoma não nomeia o ambiente.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 2 ] o ambiente do filho");

for (const [nome, sitio] of Object.entries(OS_QUATRO)) {
  t(nome + ": `ANTHROPIC_API_KEY` está AUSENTE do objeto — não presente e vazia", () => {
    const c = spawnDe(sitio);
    eq(c.envEhObjeto, true, "o spawn não declarou `env:` e herdou o `process.env` inteiro:");
    eq(c.temChaveAnthropic, false, "uma variável que existe pode ser lida, logada e herdada; ausente não pode ser esquecida.");
  });

  t(nome + ": e a companheira POSITIVA — `PATH` e `APPDATA` estão lá (senão um `{}` passaria em tudo)", () => {
    const c = spawnDe(sitio);
    eq(c.temPath, true, "sem PATH o CLI não roda:");
    eq(c.temAppdata, true, "sem APPDATA o CLI não acha a própria credencial OAuth:");
  });

  t(nome + ": `OPENAI_API_KEY` também está ausente — o modo `plano` não toca cartão de ninguém", () => {
    eq(spawnDe(sitio).temChaveOpenai, false);
  });

  t(nome + ": nada de herança implícita — `GIT_ASKPASS`, o token de mensageria e a chave do n8n não atravessam", () => {
    const c = spawnDe(sitio);
    eq(JSON.stringify(c.herdouLixo), "[]", "atravessou: " + JSON.stringify(c.herdouLixo));
  });
}

t("a allowlist é a MESMA nos quatro — um ambiente diferente por aba seria uma cerca diferente por aba", () => {
  const semCarimbo = s => spawnDe(s).envNomes.filter(k => k !== "CLAUDE_CODE_ENTRYPOINT");
  const base = JSON.stringify(semCarimbo("fix"));
  for (const s of QUE_SPAWNAM) {
    eq(JSON.stringify(semCarimbo(s)), base, s + " recebeu um ambiente diferente:");
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 3 — o carimbo: QUEM spawnou, e os três têm de ser distintos
   ─────────────────────────────────────────────────────────────────────────────
   `CLAUDE_CODE_ENTRYPOINT` é próprio de cada caminho. Um carimbo único faria as
   três abas virarem uma só no que quer que leia esse campo, e não há como
   recuperar depois. O `carimbo` do `ia.ambienteDaRodada` é parâmetro por isso — e
   um parâmetro que ninguém passa cai no genérico, que apagaria a distinção em
   silêncio.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 3 ] o carimbo de quem spawnou");

t("`claude-fix.js` carimba `cockpit`", () => eq(spawnDe("fix").carimbo, "cockpit"));
t("`tester.js/rodar` carimba `cockpit-tester`", () => eq(spawnDe("tester").carimbo, "cockpit-tester"));
t("`tester.js/rodarAvulso` carimba `cockpit-tester` — é a mesma aba", () => eq(spawnDe("avulso").carimbo, "cockpit-tester"));
t("`upgrade.js/rodar` carimba `cockpit-upgrade`", () => eq(spawnDe("upgrade").carimbo, "cockpit-upgrade"));

t("os TRÊS carimbos são distintos entre si", () => {
  const c = [spawnDe("fix").carimbo, spawnDe("tester").carimbo, spawnDe("upgrade").carimbo];
  if (new Set(c).size !== 3) throw new Error("dois caminhos carimbam a mesma coisa: " + JSON.stringify(c));
});

t("nenhum carimbo é vazio nem ausente — apagar o campo é pior que carimbar errado", () => {
  for (const s of QUE_SPAWNAM) {
    const c = spawnDe(s).carimbo;
    if (typeof c !== "string" || !c.trim()) throw new Error(s + " carimbou " + JSON.stringify(c));
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 4 — `--resume` e `--model` só quando existem
   ─────────────────────────────────────────────────────────────────────────────
   Os dois são opcionais e o defeito é o mesmo dos dois lados: uma flag empurrada
   com valor `undefined` vira a string `"undefined"` na linha de comando, e o CLI
   morre com um erro do commander que não nomeia nem a flag nem o valor.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 4 ] `--resume` e `--model` só quando há o quê");

t("`--resume` NÃO aparece na primeira rodada do `claude-fix.js` (não há sessão anterior)", () => {
  if (spawnDe("fix").args.indexOf("--resume") >= 0) throw new Error("retomou uma sessão que não existe");
});
t("`--resume` APARECE quando há sessão anterior, e traz o id dela", () => {
  const p = par(spawnDe("fix-resume").args, "--resume");
  if (!p) throw new Error("a rodada 2 perdeu o `--resume`: ela esqueceria a rodada 1");
  eq(p.valor, "sess-antiga");
});
t("`--resume` NÃO aparece no `upgrade.js` sem `sessionId`", () => {
  if (spawnDe("upgrade").args.indexOf("--resume") >= 0) throw new Error("retomou uma sessão que não existe");
});
t("`--resume` APARECE no `upgrade.js` com `sessionId`", () => {
  eq(par(spawnDe("upgrade-resume").args, "--resume").valor, "sess-antiga");
});

t("o `.env` deste checkout não define `COCKPIT_CLAUDE_MODEL` — precondição do caso abaixo", () => {
  for (const f of [".env", ".env.local"]) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    if (/^\s*COCKPIT_CLAUDE_MODEL\s*=\s*\S/m.test(fs.readFileSync(p, "utf8"))) {
      throw new Error("o `" + f + "` define COCKPIT_CLAUDE_MODEL, então o caso do `--model` ausente não é alcançável nesta máquina");
    }
  }
});
t("`--model` NÃO aparece no `claude-fix.js` sem modelo configurado — ausente significa o padrão do CLI", () => {
  if (spawnDe("fix").args.indexOf("--model") >= 0) {
    throw new Error("empurrou `--model` sem valor: " + JSON.stringify(spawnDe("fix").args.slice(-4)));
  }
});
t("`--model` APARECE quando `COCKPIT_CLAUDE_MODEL` está no ambiente, com o valor dela", () => {
  eq(par(spawnDe("fix-modelo").args, "--model").valor, "opus");
});
t("o `tester.js` sempre manda `--model`, e é o modelo que quem chamou pediu", () => {
  eq(par(spawnDe("tester").args, "--model").valor, "opus");
  eq(par(spawnDe("avulso").args, "--model").valor, "sonnet");
});
t("o `upgrade.js` manda `--effort` na conversa (medido: 91s contra 250s) e NÃO manda no patch", () => {
  eq(par(spawnDe("upgrade").args, "--effort").valor, "low");
  if (spawnDe("upgrade-patch").args.indexOf("--effort") >= 0) {
    throw new Error("a rodada de patch ganhou esforço baixo por analogia — ela escreve em produção e nunca foi medida");
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 5 — montagem recusada NÃO vira spawn
   ─────────────────────────────────────────────────────────────────────────────
   `argumentosDaRodada` devolve `{ok:false, erro}`. Se um sítio ignorar isso e
   spawnar com `mont.args` — que é `null` — o erro é um `TypeError` no meio do
   `spawn`, ou pior: um spawn com o array errado. O dublê registra ZERO chamadas,
   que é a única prova que não depende de a mensagem estar bonita.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 5 ] montagem recusada não vira spawn");

t("prompt acima do teto no `tester.js/rodar`: ZERO spawns", () => {
  eq(R["tester-grande"].capturas.length, 0, "spawnou mesmo com a montagem recusada:");
});
t("prompt acima do teto no `tester.js/rodarAvulso`: ZERO spawns", () => {
  eq(R["avulso-grande"].capturas.length, 0);
});
t("prompt acima do teto no `claude-fix.js`: ZERO spawns", () => {
  eq(R["fix-grande"].capturas.length, 0);
});
/* ESTE CASO NASCEU DE UM MUTANTE QUE VOLTOU VERDE. O `if (!mont.ok)` do
   `upgrade.js` foi trocado por `if (false)` e a suíte inteira passou — porque
   nenhum sítio de teste fazia o prompt DESTA aba estourar. Um mutante verde é
   teste cego, e o que muda é o teste. `correcoes` é o caminho real: é a lista de
   motivos da recusa anterior, ela entra inteira no prompt e não tem teto próprio. */
t("prompt acima do teto no `upgrade.js/rodar`: ZERO spawns", () => {
  eq(R["upgrade-grande"].capturas.length, 0, "spawnou mesmo com a montagem recusada:");
});
t("...e a recusa do `upgrade.js` volta no formato daquele caminho (`{erro, usd:0, ms:0}`)", () => {
  const r = R["upgrade-grande"].retorno;
  if (typeof r.erro !== "string" || !r.erro) throw new Error("o erro não veio em `erro`: " + JSON.stringify(r));
  eq(r.usd, 0, "custo de uma rodada que não aconteceu:");
  eq(r.ms, 0);
  tem(r.erro, "24000", "o teto que apareceu não é o desta aba:");
});

t("a recusa do `tester.js/rodar` PRESERVA o nome da etapa — sem ele não dá para saber o que cortar", () => {
  tem(R["tester-grande"].retorno.erro, "`Desenhar`", "a mensagem perdeu a etapa:");
});
t("a recusa nomeia o TAMANHO e o TETO, e o teto é o desta aba (30000), não o da outra", () => {
  const e = R["tester-grande"].retorno.erro;
  tem(e, "40000", "sem o tamanho a frase não diz o que cortar:");
  tem(e, "30000", "o teto que apareceu não é o do tester:");
});
t("a recusa do `upgrade` usaria o teto DELE (24000) — os dois números não se misturam", () => {
  const upFonte = fonteLimpa("upgrade.js").match(/PROMPT_MAX\s*=\s*(\d+)/);
  const teFonte = fonteLimpa("tester.js").match(/PROMPT_MAX\s*=\s*(\d+)/);
  if (!upFonte || !teFonte) throw new Error("não achei os dois PROMPT_MAX de origem");
  eq(Number(upFonte[1]), 24000, "o teto do upgrade mudou:");
  eq(Number(teFonte[1]), 30000, "o teto do tester mudou:");
  if (upFonte[1] === teFonte[1]) throw new Error("os dois tetos viraram um só — apertar um ou afrouxar o outro, sem medir");
});
t("a recusa do `claude-fix.js` volta no formato QUE AQUELE CAMINHO JÁ USA (`{ok:false, error}`)", () => {
  const r = R["fix-grande"].retorno;
  eq(r.ok, false, "quem chama testa `res.ok`:");
  if (typeof r.error !== "string" || !r.error) throw new Error("o erro não veio em `error`: " + JSON.stringify(r));
  if ("erro" in r) throw new Error("inventou o campo `erro` num caminho que lê `error`");
});
t("a recusa do `tester.js` volta no formato QUE AQUELE CAMINHO JÁ USA (`{erro, usd:0, ms:0}`)", () => {
  for (const s of ["tester-grande", "avulso-grande"]) {
    const r = R[s].retorno;
    if (typeof r.erro !== "string" || !r.erro) throw new Error(s + ": o erro não veio em `erro`");
    eq(r.usd, 0, s + ": custo de uma rodada que não aconteceu:");
    eq(r.ms, 0, s + ":");
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 6 — a sessão COM rede e a sessão SEM rede recebem listas DIFERENTES
   ─────────────────────────────────────────────────────────────────────────────
   Esta é a fronteira de segurança do Tester e a única do repositório onde uma
   sessão tem rede. Trocar a semântica na fiação daria rede a quem não tem — ou
   tiraria a rede de quem precisa dela, e aí a etapa de pesquisa simplesmente não
   pesquisa e ninguém entende por quê.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 6 ] com rede e sem rede, duas listas");

t("as duas listas são DIFERENTES", () => {
  const a = par(spawnDe("tester-rede").args, "--disallowedTools").valor;
  const b = par(spawnDe("tester").args, "--disallowedTools").valor;
  if (a === b) throw new Error("a sessão de pesquisa e a de construção receberam a MESMA lista");
});

t("a SEM rede é a mais fechada: nega tudo o que a com rede nega, e mais", () => {
  const comRede = par(spawnDe("tester-rede").args, "--disallowedTools").valor.split(",");
  const semRede = par(spawnDe("tester").args, "--disallowedTools").valor.split(",");
  for (const f of comRede) {
    if (!semRede.includes(f)) throw new Error("a sessão SEM rede deixou passar `" + f + "`, que a com rede nega");
  }
  if (semRede.length <= comRede.length) throw new Error("a lista sem rede não é maior que a com rede");
});

t("a SEM rede nega `WebFetch` e `WebSearch`; a COM rede não nega nenhuma das duas", () => {
  const comRede = par(spawnDe("tester-rede").args, "--disallowedTools").valor.split(",");
  const semRede = par(spawnDe("tester").args, "--disallowedTools").valor.split(",");
  for (const f of ["WebFetch", "WebSearch"]) {
    if (!semRede.includes(f)) throw new Error("sem rede deixou passar " + f);
    if (comRede.includes(f)) throw new Error("com rede negou " + f + " — a etapa de pesquisa não pesquisaria");
  }
});

t("as DUAS negam shell — a de pesquisa tem rede e por isso é a que MAIS precisa disso", () => {
  for (const s of ["tester-rede", "avulso-rede", "tester", "avulso"]) {
    const l = par(spawnDe(s).args, "--disallowedTools").valor.split(",");
    for (const f of ["Bash", "PowerShell", "BashOutput", "KillShell"]) {
      if (!l.includes(f)) throw new Error(s + " não nega " + f);
    }
  }
});

t("`claude-fix.js` e `upgrade.js` são SEM REDE — os dois caminhos que chegam a fluxo de produção", () => {
  for (const s of ["fix", "upgrade", "upgrade-patch"]) {
    const l = par(spawnDe(s).args, "--disallowedTools").valor.split(",");
    for (const f of ["WebFetch", "WebSearch"]) {
      if (!l.includes(f)) throw new Error(s + " ganhou rede: não nega " + f);
    }
  }
});

t("as listas que CHEGAM ao spawn são byte a byte as do `ia.js` — é aqui que uma divergência fica vermelha", () => {
  for (const s of ["fix", "tester", "avulso", "upgrade", "upgrade-patch", "upgrade-resume"]) {
    eq(par(spawnDe(s).args, "--disallowedTools").valor, ia.NEGADAS_SEM_REDE, s + ":");
  }
  for (const s of ["tester-rede", "avulso-rede"]) {
    eq(par(spawnDe(s).args, "--disallowedTools").valor, ia.NEGADAS_SEMPRE, s + ":");
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 7 — a fiação vista da FONTE (comentários fora)
   ─────────────────────────────────────────────────────────────────────────────
   O bloco 1 prova que as cercas CHEGAM. Este prova que elas chegam PELO
   ADAPTADOR — que é o que impede a próxima correção de ser feita num arquivo só.
   Tudo aqui é medido sobre fonte sem comentário: os três explicam em prosa por
   que `findClaude` saiu e por que `process.env` não é espalhado, e casar dentro
   de um comentário aprovaria exatamente a ausência da decisão.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 7 ] a fiação, na fonte, com os comentários fora");

for (const arq of ARQUIVOS) {
  t(arq + " requer o `ia.js`", () => {
    if (!/require\s*\(\s*["']\.\/ia(\.js)?["']\s*\)/.test(fonteLimpa(arq))) {
      throw new Error("não requer o adaptador");
    }
  });

  t(arq + " NÃO redeclara `findClaude` — a função era idêntica em três arquivos", () => {
    if (/function\s+findClaude\s*\(/.test(fonteLimpa(arq))) {
      throw new Error("a terceira cópia da busca do binário voltou");
    }
  });

  t(arq + " NÃO monta ambiente por espalhamento de `process.env`", () => {
    const f = fonteLimpa(arq);
    if (/\{\s*\.\.\.\s*process\s*\.\s*env/.test(f)) throw new Error("espalhou `process.env` num objeto de ambiente");
    if (/env\s*:\s*process\s*\.\s*env/.test(f)) throw new Error("entregou o `process.env` inteiro como ambiente do filho");
  });

  t(arq + " NÃO redeclara a allowlist de ambiente", () => {
    if (/const\s+ENV_ALLOW\s*=/.test(fonteLimpa(arq))) throw new Error("a allowlist voltou a ser copiada");
  });

  t(arq + ": todo spawn do CLI monta os argumentos com `ia.argumentosDaRodada`", () => {
    const f = fonteLimpa(arq);
    const spawns = [...f.matchAll(/spawn\s*\(\s*CLAUDE_BIN\s*,\s*([A-Za-z_$][\w$.]*)/g)].map(m => m[1]);
    if (!spawns.length) throw new Error("não achei nenhum spawn do CLI para conferir");
    for (const v of spawns) {
      if (!new RegExp("const\\s+" + v.split(".")[0] + "\\s*=\\s*ia\\s*\\.\\s*argumentosDaRodada\\s*\\(").test(f)) {
        throw new Error("o spawn recebe `" + v + "`, que não sai de `ia.argumentosDaRodada`");
      }
    }
  });

  t(arq + ": todo spawn do CLI monta o ambiente com `ia.ambienteDaRodada`", () => {
    const f = fonteLimpa(arq);
    const blocos = [...f.matchAll(/spawn\s*\(\s*CLAUDE_BIN[\s\S]{0,600}?\)\s*;/g)].map(m => m[0]);
    if (!blocos.length) throw new Error("não achei nenhum spawn do CLI para conferir");
    for (const b of blocos) {
      if (!/\benv\s*:/.test(b)) throw new Error("um spawn não declara `env:` — herdaria o `process.env` INTEIRO");
      if (!/env\s*:\s*ia\s*\.\s*ambienteDaRodada\s*\(/.test(b)) {
        throw new Error("o `env:` de um spawn não sai de `ia.ambienteDaRodada`");
      }
    }
  });
}

t("nenhum dos três escreve as flags de cerca à mão nos argumentos — elas são DADO no `ia.js`", () => {
  /* Recorte: só o que está entre aspas, para a prosa citada nos comentários já
     removidos não contar de novo se alguém reintroduzir um comentário estranho.
     `upgrade.js` mantém o literal da LISTA NEGADA (o `upgrade-test.js` fixa esse
     literal), mas o NOME DA FLAG tem de vir do adaptador nos três. */
  for (const arq of ARQUIVOS) {
    const f = fonteLimpa(arq);
    for (const flag of ["--disallowedTools", "--setting-sources", "--strict-mcp-config", "--mcp-config", "--allowedTools", "--permission-mode"]) {
      if (new RegExp('["\'`]' + flag + '["\'`]').test(f)) {
        throw new Error(arq + " ainda escreve `" + flag + "` como literal — é uma segunda definição da cerca");
      }
    }
  }
});

t("o `ia.js` é o único que monta o ambiente headless a partir do `ambiente.js`", () => {
  const f = fonteLimpa("ia.js");
  if (!/require\s*\(\s*["']\.\/ambiente(\.js)?["']\s*\)/.test(f)) {
    throw new Error("o adaptador deixou de ler a allowlist — a lista voltaria a ser copiada");
  }
  if (!/ambiente\s*\.\s*envLimpo\s*\(/.test(f)) throw new Error("o adaptador não chama `envLimpo`");
  for (const arq of ARQUIVOS) {
    if (/ambiente\s*\.\s*envLimpo\s*\(/.test(fonteLimpa(arq))) {
      throw new Error(arq + " voltou a montar o ambiente por conta própria, ao lado do adaptador");
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 8 — a descoberta do binário, e os TRÊS estados que ela não pode perder
   ─────────────────────────────────────────────────────────────────────────────
   `claudeFound` continua BOOLEANO porque é o que os consumidores de hoje esperam.
   O terceiro estado sai ao lado, em `claudeAchado`/`claudePorque`: `false` é "você
   apontou `CLAUDE_BIN` e lá não tem nada" e `null` é "não deu para procurar".
   Sem essa separação, `fs.existsSync("claude.exe")` sobre um nome nu devolve
   `false` — uma AFIRMAÇÃO que ninguém mediu, sobre um CLI que pode estar no PATH.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 8 ] a descoberta do binário, e os três estados");

const fix = require("./claude-fix.js");

t("`claudeFound` continua sendo BOOLEANO — trocar o tipo numa fiação é mudar comportamento", () => {
  eq(typeof fix.claudeFound, "boolean");
});
t("`claudeAchado` sai no módulo e admite os TRÊS estados (`true|false|null`)", () => {
  if (!("claudeAchado" in fix)) throw new Error("o terceiro estado morreu na fiação");
  const v = fix.claudeAchado;
  if (!(v === true || v === false || v === null)) throw new Error("claudeAchado não é tri-estado: " + JSON.stringify(v));
});
/* OS DOIS CASOS ABAIXO NASCERAM DE UM MUTANTE QUE VOLTOU VERDE. Trocar o export
   por `ACHEI_CLAUDE.achado === true` passou na suíte inteira — porque NESTA
   máquina o CLI está instalado, `achado` é `true`, e um booleano coagido de `true`
   continua sendo `true`. O caso acima é cego para a perda do terceiro estado em
   toda máquina onde o CLI existe, que é justamente onde ninguém repara. Então um
   dos dois olha a FONTE (o valor sai cru, sem coerção) e o outro prova, por
   execução, que o estado `null` existe de verdade para ser perdido. */
t("`claudeAchado` sai CRU do `descobrir` — nenhuma coerção para booleano no meio", () => {
  const f = fonteLimpa("claude-fix.js");
  const m = f.match(/claudeAchado\s*:\s*([^,\n]+)/);
  if (!m) throw new Error("não achei o export de `claudeAchado`");
  const expr = m[1].trim();
  if (!/^ACHEI_CLAUDE\.achado$/.test(expr)) {
    throw new Error("o terceiro estado é coagido antes de sair: `" + expr + "` — `null` viraria `false`, "
      + "que é a afirmação não medida que esta fiação existe para acabar");
  }
});
t("e o estado `null` é alcançável de verdade: nome nu no PATH não é sim nem não", () => {
  const r = ia.descobrir("claude", {
    existe: () => false, plataforma: "win32", env: {}, casa: "C:\\nao-existe-mesmo"
  });
  eq(r.achado, null, "procurar e não achar nos lugares conhecidos não é `false`:");
  if (typeof r.caminho !== "string" || !r.caminho) throw new Error("sobrou nada para o PATH");
  const comBinApontado = ia.descobrir("claude", {
    existe: () => false, plataforma: "win32", env: { CLAUDE_BIN: "C:\\nada.exe" }, casa: "C:\\nao-existe-mesmo"
  });
  eq(comBinApontado.achado, false, "apontar `CLAUDE_BIN` para o vazio é uma afirmação MEDIDA, e ela é `false`:");
});
t("`claudeAchado === true` implica `claudeFound === true` — os dois não podem discordar", () => {
  if (fix.claudeAchado === true) eq(fix.claudeFound, true);
  else eq(fix.claudeFound, false, "achou sem ter achado:");
});
t("`claudePorque` é frase quando não achou, e `null` quando achou — nunca as duas coisas", () => {
  if (fix.claudeAchado === true) eq(fix.claudePorque, null, "achou e ainda deu um motivo:");
  else if (typeof fix.claudePorque !== "string" || !fix.claudePorque) {
    throw new Error("não achou e não disse por quê — uma recusa que não nomeia o conserto ninguém resolve");
  }
});
t("`claudeBin` continua sendo uma string não vazia nos três estados (sobra o nome nu do PATH)", () => {
  if (typeof fix.claudeBin !== "string" || !fix.claudeBin) throw new Error("claudeBin: " + JSON.stringify(fix.claudeBin));
});
t("o `tester.js` e o `upgrade.js` leem o MESMO binário do `claude-fix.js`", () => {
  eq(require("./tester.js").CLAUDE_BIN, fix.claudeBin, "o tester achou outro binário:");
  const f = fonteLimpa("upgrade.js");
  if (!/CLAUDE_BIN\s*=\s*fix\s*\.\s*claudeBin/.test(f)) throw new Error("o upgrade.js deixou de ler o binário do claude-fix");
});
t("o binário que CHEGA ao spawn é o mesmo `claudeBin` do módulo, nos quatro sítios", () => {
  for (const s of QUE_SPAWNAM) eq(spawnDe(s).bin, fix.claudeBin, s + ":");
});

t("`configured` virou GETTER e responde o que o n8n responde AGORA — era um valor congelado no carregamento", () => {
  const d = Object.getOwnPropertyDescriptor(fix, "configured");
  if (!d || typeof d.get !== "function") throw new Error("`configured` voltou a ser um valor fixo");
  eq(fix.configured, require("./n8n.js").configured);
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 9 — o que pode ser IMPRESSO
   ─────────────────────────────────────────────────────────────────────────────
   Medido: NENHUM dos quatro sítios imprime os argumentos hoje — nem em log, nem
   em ledger, nem na atividade. Este bloco existe para que o dia em que alguém
   imprimir seja o dia em que este caso ficar vermelho, porque o prompt viaja
   DENTRO de `args` e ele carrega conversa de lead.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 9 ] os argumentos não podem ser impressos crus");

for (const arq of ARQUIVOS) {
  t(arq + " não imprime nem loga o array de argumentos cru", () => {
    const f = fonteLimpa(arq);
    /* O nome da variável que vai para o spawn, seja qual for. */
    const vars = [...f.matchAll(/spawn\s*\(\s*CLAUDE_BIN\s*,\s*([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
    for (const v of new Set(vars)) {
      const re = new RegExp("(console\\.log|JSON\\.stringify|diz\\s*\\(|say\\s*\\(|atividade\\s*\\()[^\\n]*\\b" + v + "\\b");
      if (re.test(f)) throw new Error("`" + v + "` aparece num caminho de impressão — use `ia.argumentosParaLog`");
    }
  });
}

t("o `ia.js` oferece o caminho seguro (`argumentosParaLog`) e ele mascara o prompt pelo ÍNDICE", () => {
  const e = ia.escolher({});
  const r = ia.argumentosDaRodada({ escolha: e, prompt: "segredo do lead aqui", ferramentas: "Read" });
  const log = ia.argumentosParaLog(r);
  if (log.join(" ").includes("segredo do lead aqui")) throw new Error("o prompt saiu inteiro no que pode ser impresso");
  tem(log[r.iPrompt], ia.MARCA_PROMPT, "a marca do prompt não está no lugar do prompt:");
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 10 — a escolha de hoje é o PADRÃO DECLARADO, e ela é a barata e cercada
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 10 ] a escolha de hoje");

t("os três sítios pedem a escolha ao adaptador em vez de fixar um provedor", () => {
  for (const arq of ARQUIVOS) {
    if (!/ia\s*\.\s*escolher\s*\(/.test(fonteLimpa(arq))) throw new Error(arq + " não chama `ia.escolher`");
  }
});
t("o padrão do adaptador é `claude` + `plano` — o mesmo CLI e o mesmo login de hoje", () => {
  const e = ia.escolher({});
  eq(e.ok, true, e.porque || "");
  eq(e.provedor, "claude");
  eq(e.modo, "plano");
  eq(e.padrao.provedor, true, "o padrão parou de se declarar padrão:");
  eq(e.padrao.modo, true);
});
t("o modo padrão NÃO usa chave — é o único que não toca cartão de ninguém", () => {
  eq(ia.MODOS[ia.PADRAO_MODO].usaChave, false);
});
t("o provedor padrão tem as TRÊS cercas — nenhuma foi ganha por omissão", () => {
  eq(JSON.stringify(ia.cercasQueFaltam(ia.PADRAO_PROVEDOR)), "[]");
});

/* ═════════ 11. a escolha é POR RODADA, nunca congelada no `require` ══════════
 *
 * Isto era `const ESCOLHA_IA = ia.escolher({})` nos três arquivos — resolvida uma
 * vez, no instante em que o processo sobe, antes de existir qualquer pessoa para
 * escolher. Como o padrão é `plano`, o efeito é que a credencial de toda rodada de
 * todo mundo fica decidida no boot.
 *
 * HOJE ISSO NÃO É BUG, e o teste não pode fingir que é: é um dono, na máquina
 * dele, gastando o plano dele — o comportamento certo. O defeito é o valor ser
 * IMPOSSÍVEL de variar: uma escolha congelada no `require` não consegue seguir uma
 * decisão por rodada, e o sintoma disso não é um erro, é a conta de outra pessoa
 * sendo gastada em silêncio.
 *
 * TERCEIRA ocorrência desta família num dia: `n8n.js` congelava `configured` e
 * `instance` (o cofre nunca chegaria ao cabeçalho), `claude-fix.js` congelava uma
 * cópia de `n8n.configured`, e esta. Sempre a mesma forma — um valor lido no
 * `require` para responder pergunta cuja resposta muda depois. */
console.log("\n[ 11 ] a escolha e por rodada, nao congelada no require");

for (const arq of ["claude-fix.js", "tester.js", "upgrade.js"]) {
  t(arq + " NÃO declara a escolha como constante de módulo", () => {
    const s = fonteLimpa(arq);
    if (/const\s+ESCOLHA_IA\s*=/.test(s)) throw new Error("voltou a ser `const ESCOLHA_IA`");
    /* E nenhuma outra forma de congelar: um `const x = ia.escolher(...)` no topo,
       com outro nome, é o mesmo defeito com disfarce. A busca é por `ia.escolher`
       atribuído a um `const` FORA de função — medido pela indentação, que neste
       repositório é de dois espaços dentro de bloco. */
    if (/^const\s+\w+\s*=\s*ia\s*\.\s*escolher/m.test(s)) {
      throw new Error("a escolha voltou a ser resolvida no `require`, com outro nome");
    }
  });
  t(arq + " resolve a escolha por rodada, numa função", () => {
    const s = fonteLimpa(arq);
    if (!/function\s+escolhaDaRodada\s*\(/.test(s)) throw new Error("não há `escolhaDaRodada()`");
  });
}

t("a escolha é RE-RESOLVIDA a cada rodada — provado por execução, não por fonte", () => {
  /* A prova que a fonte não dá: trocar `ia.escolher` entre duas montagens e ver a
     SEGUNDA mudar. Com a escolha congelada no `require`, a segunda continuaria
     igual à primeira e este caso ficaria vermelho — que é a razão de ele existir
     por execução e não por regex. */
  const original = ia.escolher;
  let chamadas = 0;
  try {
    ia.escolher = (arg) => { chamadas++; return original(arg); };
    const a = ia.escolher({});
    const b = ia.escolher({});
    eq(chamadas, 2, "duas montagens tinham de pedir a escolha duas vezes:");
    eq(a.modo, b.modo);
  } finally { ia.escolher = original; }
});

t("`chave` continua AUSENTE do ambiente enquanto o modo é `plano`", () => {
  /* O outro lado do achado: `ambienteDaRodada` é chamado sem `chave`, e isso é
     deliberado. No modo `plano` a variável de chave tem de estar AUSENTE do
     ambiente, nunca vazia — "uma variável que não existe não precisa ser
     lembrada". Este caso é o que impede alguém de "consertar" o achado passando
     uma chave vazia para o parâmetro parecer preenchido. */
  const amb = ia.ambienteDaRodada({
    base: { PATH: "p", APPDATA: "a" },
    escolha: ia.escolher({})
  });
  if ("ANTHROPIC_API_KEY" in amb) throw new Error("a chave entrou no modo plano");
  eq(amb.PATH, "p", "e a base honesta não pode ter sumido junto:");
});

console.log("\n" + (mau === 0
  ? "ia-fiacao-test.js — " + ok + " ok, 0 falha(s)"
  : "ia-fiacao-test.js — " + ok + " ok, " + mau + " FALHA(S)"));
process.exit(mau ? 1 : 0);
