"use strict";
/* rodada-teto-test.js — o teto de uma rodada da aba Upgrade.
 *
 * Por que este arquivo existe, em uma frase: o teto era UM relógio de parede de
 * 180s, escolhido por analogia e nunca medido, e ele matou uma rodada que estava
 * trabalhando — o Kauan pagou US$1,04 para ler "tempo esgotado nesta rodada
 * (180s)" numa tela que não sabia dizer se a sessão tinha travado ou se ela ainda
 * estava pensando.
 *
 * MEDIDO em 2026-08-20, reproduzindo aquela rodada (tirar todo o ClickUp do
 * `Agente Iago Comercial`, 189 nós, `fluxo.json` de 364KB), mesmo prompt, mesmo
 * modelo, três execuções completas:
 *
 *   padrão do CLI    250.461ms  US$1,0418   5 de 7 nós certos
 *   --effort medium  167.671ms  US$0,9096   6 de 7
 *   --effort low      90.986ms  US$0,7331   6 de 7
 *
 * e o maior SILÊNCIO real do stdout nas três foi de 14,2s, porque o CLI emite
 * `system/thinking_tokens` enquanto pensa. Daí os dois números que este arquivo
 * defende: 90s sem sinal nenhum é trava; 600s dando sinal é pedido grande demais.
 *
 * Cada caso recusa UM defeito nomeado. Não spawna o CLI, não fala com o n8n, não
 * escreve em `conversas.json`. De graça. `node rodada-teto-test.js`.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const up = require("./upgrade.js");

let ok = 0, mau = 0;
const t = (nome, fn) => {
  try { fn(); ok++; }
  catch (e) { mau++; console.log("  ✗ " + nome + "\n      " + String(e && e.message || e).split("\n")[0]); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error((m || "") + " esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a)); };
const tem = (s, sub, m) => { if (!String(s).includes(sub)) throw new Error((m || "") + " não contém " + JSON.stringify(sub) + " em " + JSON.stringify(String(s).slice(0, 200))); };
const naoTem = (s, sub, m) => { if (String(s).includes(sub)) throw new Error((m || "") + " contém " + JSON.stringify(sub) + " e não deveria"); };

/* A fonte SEM COMENTÁRIO. Lição que o `dossie-tela-test.js` pagou: dois casos
   ficaram verdes porque a palavra que procuravam vivia num comentário que
   explicava a decisão — o guarda tinha sido apagado e o teste aprovou a ausência
   dele. Aqui a tentação é a mesma: este arquivo cita `--effort`, `setTimeout` e
   `clearTimeout` em prosa dentro do próprio `upgrade.js`. */
const FONTE_CRUA = fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8");
const FONTE = FONTE_CRUA
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 1 — as duas mortes, e elas não podem ler igual
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 1 ] as duas frases de morte");

t("as duas frases são DISTINTAS — duas mortes com a mesma frase ensinam a ignorar as duas", () => {
  const a = up.fraseMorte("travou", 90000);
  const b = up.fraseMorte("teto", 600000);
  if (a === b) throw new Error("as duas frases são idênticas");
});

t("`travou` nomeia o silêncio em segundos, para quem lê saber o que foi medido", () => {
  tem(up.fraseMorte("travou", 95000), String(Math.round(up.SILENCIO_MS / 1000)) + "s");
});

t("`travou` diz TRAVADA — a palavra que manda olhar se o CLI está vivo", () => {
  tem(up.fraseMorte("travou", 95000), "travada");
});

t("`teto` nomeia o teto duro em segundos", () => {
  tem(up.fraseMorte("teto", 600000), String(Math.round(up.RODADA_MS / 1000)) + "s");
});

t("`teto` diz que a sessão CONTINUAVA dando sinal — é o oposto de travada", () => {
  tem(up.fraseMorte("teto", 600000), "dando sinal");
});

t("`teto` diz o que fazer: pedir uma parte de cada vez", () => {
  tem(up.fraseMorte("teto", 600000), "parte de cada vez");
});

t("as DUAS dizem que nada foi escrito no n8n — é a única pergunta que importa depois de uma morte", () => {
  tem(up.fraseMorte("travou", 1), "nada foi escrito no n8n", "travou:");
  tem(up.fraseMorte("teto", 1).toLowerCase(), "nada foi escrito no n8n", "teto:");
});

t("as duas dizem há quanto tempo a rodada estava rodando — sem isso não dá para saber se o teto está errado", () => {
  tem(up.fraseMorte("travou", 137000), "137s");
  tem(up.fraseMorte("teto", 601000), "601s");
});

t("um motivo desconhecido NÃO cai em silêncio: cai na frase do teto, que é a que não acusa trava", () => {
  const x = up.fraseMorte("xpto", 5000);
  naoTem(x, "travada", "motivo desconhecido não pode acusar trava:");
  tem(x, "teto de");
});

t("a frase antiga morreu — `tempo esgotado nesta rodada` não distinguia os dois casos", () => {
  naoTem(up.fraseMorte("travou", 1), "tempo esgotado");
  naoTem(up.fraseMorte("teto", 1), "tempo esgotado");
  naoTem(FONTE, "tempo esgotado nesta rodada", "a fonte ainda monta a frase velha:");
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 2 — o esforço, e o fato de a rodada do patch NÃO ter sido medida
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 2 ] o esforço por tipo de rodada");

const semEnv = {};

t("a conversa usa o padrão MEDIDO (`low`) — 91s contra 250s, com resposta igual ou melhor", () => {
  eq(up.esforcoDaRodada(false, semEnv), "low");
});

t("o patch NÃO ganha esforço baixo: ele escreve em produção e nunca foi medido", () => {
  eq(up.esforcoDaRodada(true, semEnv), null);
});

t("`null` no patch significa SEM FLAG, e a rodada entrega esse null ao adaptador em vez de empurrar a flag", () => {
  /* REESCRITO na fiação do `ia.js`, e não apagado. Antes, o `--effort` era
     empurrado aqui mesmo, atrás de um `if (esforco)`, e era isso que este caso
     media. Esse `if` não existe mais: o valor viaja como `esforco:` para o
     `ia.argumentosDaRodada`, que só monta a flag quando há valor — e o
     `ia-test.js` fixa esse comportamento do lado de lá.
     O que este caso passa a fixar é a metade que continua sendo DESTE arquivo:
     que o valor entregue é o de `esforcoDaRodada(ehPatch)`, e não uma constante.
     Que a flag NÃO chega ao spawn na rodada de patch é provado por execução, com
     um dublê, no `ia-fiacao-test.js`. */
  if (!/esforco:\s*esforcoDaRodada\(\s*ehPatch\s*\)/.test(FONTE)) {
    throw new Error("o esforço da rodada não sai mais de `esforcoDaRodada(ehPatch)` — um valor fixo aqui mudaria o esforço da rodada que escreve em produção");
  }
  if (/args\.push\(\s*"--effort"/.test(FONTE)) {
    throw new Error("voltou a empurrar `--effort` à mão, ao lado do adaptador — duas definições da mesma flag");
  }
});

t("um valor válido no ambiente vence, na conversa", () => {
  eq(up.esforcoDaRodada(false, { COCKPIT_UPGRADE_ESFORCO: "high" }), "high");
});

t("um valor válido no ambiente vence, no patch — é assim que se mede a rodada que falta medir", () => {
  eq(up.esforcoDaRodada(true, { COCKPIT_UPGRADE_ESFORCO_PATCH: "max" }), "max");
});

t("as duas variáveis são independentes: mexer na conversa não mexe no patch", () => {
  const env = { COCKPIT_UPGRADE_ESFORCO: "xhigh" };
  eq(up.esforcoDaRodada(false, env), "xhigh");
  eq(up.esforcoDaRodada(true, env), null, "o patch leu a variável da conversa:");
});

t("valor não reconhecido cai no padrão do TIPO, nunca vaza para a linha de comando", () => {
  eq(up.esforcoDaRodada(false, { COCKPIT_UPGRADE_ESFORCO: "baixo" }), "low");
  eq(up.esforcoDaRodada(true, { COCKPIT_UPGRADE_ESFORCO_PATCH: "turbo" }), null);
});

t("valor não reconhecido no PATCH não pode cair no padrão da conversa — seria baixar o esforço de produção por um erro de digitação", () => {
  eq(up.esforcoDaRodada(true, { COCKPIT_UPGRADE_ESFORCO_PATCH: "lowww" }), null);
});

t("string vazia é o mesmo que ausente", () => {
  eq(up.esforcoDaRodada(false, { COCKPIT_UPGRADE_ESFORCO: "" }), "low");
});

t("`padrao` é a maneira EXPLÍCITA de dizer 'use o padrão do CLI' na conversa", () => {
  eq(up.esforcoDaRodada(false, { COCKPIT_UPGRADE_ESFORCO: "padrao" }), null);
});

t("o que sai é sempre `null` ou um nível que o CLI aceita — nunca uma terceira coisa", () => {
  for (const v of ["low", "medium", "high", "xhigh", "max", "padrao", "", "lixo", "LOW", "0", "1"]) {
    for (const ehPatch of [false, true]) {
      const r = up.esforcoDaRodada(ehPatch, { COCKPIT_UPGRADE_ESFORCO: v, COCKPIT_UPGRADE_ESFORCO_PATCH: v });
      if (r !== null && !up.ESFORCOS.includes(r)) throw new Error("saiu " + JSON.stringify(r) + " para " + JSON.stringify(v));
    }
  }
});

t("`LOW` maiúsculo NÃO é aceito — o CLI recusa e o spawn morre com um erro que não nomeia a variável", () => {
  eq(up.esforcoDaRodada(false, { COCKPIT_UPGRADE_ESFORCO: "LOW" }), "low");
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 3 — o contrato que a tela lê
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 3 ] capacidades()");

t("os DOIS tetos viajam — declarar só o duro é mentir por omissão desde que existe o vigia", () => {
  const c = up.capacidades();
  eq(typeof c.tetoRodadaMs, "number");
  eq(typeof c.silencioMs, "number");
});

t("o silêncio é MENOR que o teto duro — invertidos, o teto duro nunca dispararia", () => {
  const c = up.capacidades();
  if (!(c.silencioMs < c.tetoRodadaMs)) throw new Error("silencioMs " + c.silencioMs + " não é menor que tetoRodadaMs " + c.tetoRodadaMs);
});

t("o silêncio tem folga sobre o pior silêncio MEDIDO (14,2s) — apertá-lo mata sessão que está pensando", () => {
  if (up.SILENCIO_MS < 45000) throw new Error("SILENCIO_MS " + up.SILENCIO_MS + " está perto demais dos 14,2s medidos");
});

t("o teto duro cobre a pior rodada MEDIDA (250s) com folga", () => {
  if (up.RODADA_MS < 300000) throw new Error("RODADA_MS " + up.RODADA_MS + " não cobre os 250s medidos com folga");
});

t("o esforço efetivo dos dois tipos viaja, e `patch: null` é um fato, não um campo faltando", () => {
  const c = up.capacidades();
  if (!("esforco" in c)) throw new Error("capacidades() não declara `esforco`");
  if (!("patch" in c.esforco)) throw new Error("`esforco.patch` ausente — um campo ausente cai no ramo negativo");
  eq(c.esforco.conversa, up.esforcoDaRodada(false));
});

t("um valor de ambiente ignorado é DITO — cair no padrão em silêncio faz a configuração dele não existir", () => {
  const antes = process.env.COCKPIT_UPGRADE_ESFORCO;
  process.env.COCKPIT_UPGRADE_ESFORCO = "rapidao";
  try {
    const c = up.capacidades();
    if (!c.esforco.ignorado.some(x => x.includes("rapidao"))) throw new Error("o valor cru não apareceu em `ignorado`");
  } finally {
    if (antes === undefined) delete process.env.COCKPIT_UPGRADE_ESFORCO; else process.env.COCKPIT_UPGRADE_ESFORCO = antes;
  }
});

t("um valor VÁLIDO nunca entra em `ignorado`", () => {
  const antes = process.env.COCKPIT_UPGRADE_ESFORCO;
  process.env.COCKPIT_UPGRADE_ESFORCO = "high";
  try { eq(up.capacidades().esforco.ignorado.length, 0); }
  finally { if (antes === undefined) delete process.env.COCKPIT_UPGRADE_ESFORCO; else process.env.COCKPIT_UPGRADE_ESFORCO = antes; }
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 4 — a fiação, medida sobre a fonte sem comentário
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 4 ] a fiação");

t("o relógio de parede sozinho MORREU: não existe mais `setTimeout(..., RODADA_MS)`", () => {
  if (/setTimeout\([\s\S]{0,400}?RODADA_MS\s*\)/.test(FONTE)) throw new Error("ainda existe um setTimeout de parede");
});

t("nenhum `clearTimeout(timer)` sobrou — ele limparia um relógio que não existe e o vigia ficaria vivo", () => {
  naoTem(FONTE, "clearTimeout(timer)");
});

t("o vigia é limpo nos DOIS caminhos de saída (`close` e `error`)", () => {
  const n = (FONTE.match(/clearInterval\(vigia\)/g) || []).length;
  if (n < 2) throw new Error("clearInterval(vigia) aparece " + n + " vez(es); precisa aparecer no close E no error");
});

t("o vigia é `unref`ado — um vigia esquecido não pode segurar o processo do cockpit vivo", () => {
  tem(FONTE, "vigia.unref");
});

t("o stdout marca sinal de vida", () => {
  if (!/child\.stdout\.on\("data",[\s\S]{0,80}sinal\(\)/.test(FONTE)) throw new Error("`sinal()` não é chamado no stdout");
});

t("o STDERR também marca sinal — um CLI reencaixando chamada escreve lá, e isso é vida, não trava", () => {
  if (!/child\.stderr\.on\("data",[\s\S]{0,80}sinal\(\)/.test(FONTE)) throw new Error("`sinal()` não é chamado no stderr");
});

t("o batimento `thinking_tokens` alimenta a banda de atividade", () => {
  if (!/thinking_tokens[\s\S]{0,200}atividade\(/.test(FONTE)) throw new Error("o heartbeat não chega em `atividade()`");
});

t("o `session_id` do evento `system` continua sendo capturado — a refatoração do else-if podia tê-lo perdido, e sem ele o `--resume` some", () => {
  if (!/ev\.type === "system"[\s\S]{0,240}s\.sessionId = ev\.session_id/.test(FONTE)) {
    throw new Error("o ramo `system` não guarda mais o session_id");
  }
});

t("`rodar` recebe `ehPatch`", () => {
  if (!/function rodar\(s, gen, ehPatch\)/.test(FONTE)) throw new Error("assinatura de `rodar` sem `ehPatch`");
});

t("`umaRodada` repassa `ehPatch` para `rodar` — sem isso o parâmetro existe e não faz nada", () => {
  if (!/rodar\(s, gen, ehPatch\)/.test(FONTE)) throw new Error("`umaRodada` chama `rodar` sem repassar `ehPatch`");
});

t("`montarRemendo` marca a rodada como patch EXPLICITAMENTE, não por dedução de `nomesAlvo`", () => {
  if (!/umaRodada\(s, gen, instrucao, ctx\.nomes, true\)/.test(FONTE)) {
    throw new Error("a rodada do patch não se declara patch");
  }
});

t("a rodada de conversa NÃO se declara patch", () => {
  const conversa = FONTE.match(/umaRodada\(s, gen\)/g) || [];
  if (!conversa.length) throw new Error("não achei a chamada de conversa");
});

/* ══════════════════════════════════════════════════════════════════════════════
   BLOCO 5 — o vigia contra o relógio, com um filho falso
   ─────────────────────────────────────────────────────────────────────────────
   Este é o bloco que carrega o arquivo, e a razão é a lição do `mutex-test.js`:
   um vigia que não mata NÃO FALHA — ele PARA, e um teste pendurado lê como
   "rodando". Cada caso roda num node filho com os tetos reduzidos por ambiente
   (é assim que o número fica real em vez de virar um parâmetro só-de-teste), e
   cada caso tem um relógio próprio: estourou, é vermelho.
   `child_process.spawn` é trocado ANTES do require — `upgrade.js` captura a
   referência no topo, então trocar depois não pegaria. Nada é spawnado de
   verdade, nada fala com o n8n.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log("[ 5 ] o vigia, contra o relógio");

const HARNESS = String.raw`
const { EventEmitter } = require("events");
const cp = require("child_process");
const MODO = process.argv[2];

class Falso extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.morto = false;
    this.kill = () => { this.morto = true; setTimeout(() => this.emit("close", null), 5); };
  }
}

cp.spawn = () => {
  const c = new Falso();
  if (MODO === "silencio") { /* nunca emite nada: é a trava */ }
  if (MODO === "batimento") {
    const b = setInterval(() => {
      if (c.morto) return clearInterval(b);
      c.stdout.emit("data", Buffer.from(JSON.stringify({ type:"system", subtype:"thinking_tokens", estimated_tokens: 100 }) + "\n"));
    }, 120);
  }
  if (MODO === "soErro") {
    const b = setInterval(() => {
      if (c.morto) return clearInterval(b);
      c.stderr.emit("data", Buffer.from("retrying\n"));
    }, 120);
  }
  if (MODO === "rapido") {
    setTimeout(() => {
      c.stdout.emit("data", Buffer.from(JSON.stringify({ type:"result", total_cost_usd: 0.5, session_id: "abc" }) + "\n"));
      c.emit("close", 0);
    }, 60);
  }
  return c;
};

const up = require(process.argv[3]);
const s = {
  id: "t1", gen: 1, status: "correndo", dir: process.cwd(), log: [], custo: [],
  chat: [{ de: "eu", texto: "oi", em: new Date().toISOString() }],
  wfNome: "F", nos: 3, nomes: [], anexos: [], evidencias: [], atividade: null
};
/* O vigia é unref'ado de propósito lá dentro. Num cockpit de verdade quem segura
   o laço de eventos vivo são os PIPES do filho real (e o servidor HTTP); aqui o
   filho é falso e não tem pipe nenhum, então sem isto o node sairia sozinho antes
   do primeiro tique — e o caso do filho mudo voltaria vazio em vez de vermelho. */
const manter = setInterval(() => {}, 40);
const t0 = Date.now();
up.rodar(s, 1, false).then(r => {
  clearInterval(manter);
  console.log(JSON.stringify({ ms: Date.now() - t0, erro: r.erro, usd: r.usd, atividade: s.atividade }));
  process.exit(0);
});
`;

const HARNESS_ARQ = path.join(require("os").tmpdir(), "cockpit-vigia-harness-" + process.pid + ".js");
fs.writeFileSync(HARNESS_ARQ, HARNESS);
const MOD = path.join(__dirname, "upgrade.js");

function vigia(modo, env, tetoTesteMs) {
  const t0 = Date.now();
  const out = execFileSync(process.execPath, [HARNESS_ARQ, modo, MOD], {
    encoding: "utf8", timeout: tetoTesteMs,
    env: Object.assign({}, process.env, env, { COCKPIT_UPGRADE_ESFORCO: "" })
  });
  const linha = out.trim().split("\n").filter(l => l.startsWith("{")).pop();
  if (!linha) throw new Error("o harness não devolveu nada: " + out.slice(0, 300));
  return Object.assign(JSON.parse(linha), { paredeDoTeste: Date.now() - t0 });
}

const CURTO = { COCKPIT_UPGRADE_SILENCIO_MS: "700", COCKPIT_UPGRADE_TIMEOUT_MS: "9000" };

t("filho MUDO morre por trava, e morre PERTO do silêncio — não espera o teto duro", () => {
  const r = vigia("silencio", CURTO, 8000);
  tem(r.erro, "travada", "não morreu por trava:");
  if (r.ms > 3000) throw new Error("demorou " + r.ms + "ms para matar um filho mudo com silêncio de 700ms");
});

t("filho que só PENSA (heartbeat, nenhuma ferramenta) NÃO é morto por trava", () => {
  const r = vigia("batimento", { COCKPIT_UPGRADE_SILENCIO_MS: "700", COCKPIT_UPGRADE_TIMEOUT_MS: "2500" }, 12000);
  naoTem(r.erro, "travada", "matou por trava uma sessão que estava dando sinal:");
  tem(r.erro, "teto de", "não morreu pelo teto duro:");
});

t("o batimento vira linha de atividade — é o que tira a banda do congelamento de 81s medido", () => {
  const r = vigia("batimento", { COCKPIT_UPGRADE_SILENCIO_MS: "700", COCKPIT_UPGRADE_TIMEOUT_MS: "2500" }, 12000);
  tem(String(r.atividade), "pensando", "a atividade não recebeu o batimento:");
});

t("sinal SÓ no stderr também segura o vigia — reencaixe de chamada é vida, não trava", () => {
  const r = vigia("soErro", { COCKPIT_UPGRADE_SILENCIO_MS: "700", COCKPIT_UPGRADE_TIMEOUT_MS: "2500" }, 12000);
  naoTem(r.erro, "travada", "matou por trava um filho que escrevia no stderr:");
});

t("rodada que termina rápido não é morta por nada, e o custo medido chega inteiro", () => {
  const r = vigia("rapido", CURTO, 8000);
  eq(r.erro, null, "uma rodada boa voltou com erro:");
  eq(r.usd, 0.5);
});

try { fs.unlinkSync(HARNESS_ARQ); } catch { /* já foi */ }

console.log("\n" + ok + " passaram, " + mau + " falharam");
process.exit(mau ? 1 : 0);
