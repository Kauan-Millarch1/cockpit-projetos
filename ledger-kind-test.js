/* ledger-kind-test.js — ETAPA 1 de quatro (PLAN-UPGRADE.md §7.1).
 *
 * `proposals.json` guarda duas coisas agora: o que o cockpit propôs como
 * CORREÇÃO e o que vai propor como UPGRADE. Um arquivo só foi decisão
 * deliberada — o próprio `CLAUDE.md` registra o desejo de "um único log de
 * eventos" — e o preço é que todo consumidor tem de dizer de que tipo fala.
 *
 * O defeito que este arquivo existe para impedir é SILENCIOSO, e é o cap:
 * `STORE_CAP` era global, então um dia de upgrades expulsaria o histórico
 * inteiro de correção e `writeStore` corta sem avisar ninguém. Ninguém descobre
 * até procurar o registro que já não existe.
 *
 * O mutante que TEM de derrubar este teste é tirar o filtro de UM consumidor só.
 *
 * NADA AQUI ESCREVE NO LEDGER. O cockpit grava nele o dia inteiro, e um teste
 * que salvasse e restaurasse o arquivo passaria por cima de uma escrita de
 * verdade — é por isso que `trimPorTipo` e `upsertEm` são funções puras. O que
 * toca o disco é leitura, e ela é usada como MEDIÇÃO do legado que está lá.
 *
 * De graça: nenhuma rede, nenhum modelo, nenhuma escrita. `node ledger-kind-test.js`. */

const fs = require("fs");
const path = require("path");
const fix = require("./claude-fix.js");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}
const src = f => fs.readFileSync(path.join(__dirname, f), "utf8");
const CAP = fix.STORE_CAP;

/* ─────────────────────────────────── 1. o legado não tem o campo ────────── */

console.log("\n[ 01 ] kindOf — ausente é `fix`, nunca o ramo novo");

t("linha sem `kind` é correção", fix.kindOf({ runId: "r1" }) === "fix");
t("linha com kind fix é correção", fix.kindOf({ kind: "fix" }) === "fix");
t("linha com kind upgrade é upgrade", fix.kindOf({ kind: "upgrade" }) === "upgrade");
t("linha nula não derruba", fix.kindOf(null) === "fix");
t("os tipos do ledger são exatamente fix e upgrade",
  [...fix.LEDGER_KINDS].sort().join(",") === "fix,upgrade");
/* `tester` tem ledger próprio (`blueprints.json`) e nunca escreveu aqui. Abrir o
   tipo seria abrir um ramo que ninguém grava. */
t("`tester` NÃO é tipo de ledger", !fix.LEDGER_KINDS.has("tester"));

/* ───────────────────────────────────── 2. o cap é por tipo ──────────────── */

console.log("\n[ 02 ] trimPorTipo — " + CAP + " de cada, e a ordem do arquivo sobrevive");

const linha = (kind, n) => ({ runId: kind[0] + n, kind, startedAt: "2026-08-18T10:00:00.000Z" });
const legado = n => ({ runId: "old" + n, startedAt: "2026-08-01T10:00:00.000Z" });   // sem `kind`

/* O caso do plano, e o motivo desta etapa existir antes da aba. */
const misto = [...Array.from({ length: 31 }, (_, i) => legado(i)),
               ...Array.from({ length: CAP }, (_, i) => linha("upgrade", i))];
const corta = fix.trimPorTipo(misto);
t(CAP + " upgrades NÃO expulsam as 31 correções do histórico",
  corta.filter(p => fix.kindOf(p) === "fix").length === 31);
t("...e os " + CAP + " upgrades também ficam", corta.filter(p => fix.kindOf(p) === "upgrade").length === CAP);
t("...total = a soma, não o teto de um arquivo só", corta.length === 31 + CAP);

/* Antes desta etapa: cap global. O assert abaixo é o que falha se ele voltar. */
const global60 = misto.slice(-CAP);
t("(referência) com cap GLOBAL o histórico de correção morreria",
  global60.filter(p => fix.kindOf(p) === "fix").length === 0);

const demais = fix.trimPorTipo(Array.from({ length: CAP + 25 }, (_, i) => linha("fix", i)));
t("um tipo sozinho ainda é cortado no teto", demais.length === CAP);
t("...e quem sai são os MAIS ANTIGOS", demais[0].runId === "f25" && demais[CAP - 1].runId === "f" + (CAP + 24));

/* `rehydrate` faz `slice(-N)` contando com a ordem cronológica do arquivo. Se o
   trim reagrupasse por tipo, ele reabriria a proposta errada. */
const ordem = fix.trimPorTipo([linha("fix", 1), linha("upgrade", 1), linha("fix", 2), linha("upgrade", 2)]);
t("a ordem do arquivo é preservada, nunca reagrupada por tipo",
  ordem.map(p => p.runId).join(",") === "f1,u1,f2,u2");

t("lista curta passa intacta", fix.trimPorTipo([linha("fix", 1)]).length === 1);
t("lista vazia não derruba", fix.trimPorTipo([]).length === 0);

/* ─────────────────── 3. escrever um tipo não apaga o outro ──────────────── */

console.log("\n[ 03 ] upsertEm — o dano pior que o cap");

const base = [legado(1), linha("upgrade", 1), legado(2)];
const comNovo = fix.upsertEm(base, linha("upgrade", 2));
t("acrescentar upgrade preserva as correções", comNovo.filter(p => fix.kindOf(p) === "fix").length === 2);
t("...e a linha nova entra no fim", comNovo[comNovo.length - 1].runId === "u2");
const substituido = fix.upsertEm(base, { runId: "u1", kind: "upgrade", status: "applied" });
t("upsert substitui pelo runId, no lugar", substituido.length === 3 && substituido[1].status === "applied");
t("...sem duplicar", substituido.filter(p => p.runId === "u1").length === 1);
t("upsertEm é puro — a lista de entrada não muda", base.length === 3 && !base[1].status);

/* ───────────────────── 4. quem não diz o tipo não passa ─────────────────── */

console.log("\n[ 04 ] o tipo é obrigatório, e a ausência é erro alto");

async function recusa(f) { try { await f(); return null; } catch (e) { return e.message; } }

(async () => {
  const semTipo = await recusa(() => fix.readStore());
  t("readStore sem tipo é recusado", !!semTipo);
  t("...e a mensagem diz o que passar", /fix.*upgrade/.test(semTipo || ""));
  t("...e aponta o plano", /7\.1/.test(semTipo || ""));
  t("readStore com tipo inventado é recusado", !!(await recusa(() => fix.readStore("tester"))));

  /* `upsertStore` recusa ANTES de ler ou escrever, então este caso não toca o
     ledger. Com ele, o fallback de `kindOf` só serve o legado que já está no
     disco: nenhuma linha nova nasce sem tipo. */
  const gravaSemTipo = await recusa(() => fix.upsertStore({ runId: "zz-nunca-gravado" }));
  t("upsertStore sem `kind` é recusado", !!gravaSemTipo);
  t("...e nomeia o campo que falta", /kind/.test(gravaSemTipo || ""));
  t("...e não escreveu nada", !src("proposals.json").includes("zz-nunca-gravado"));

  t("`readStoreRaw` NÃO é exportado — ler cru é de quem reescreve",
    typeof fix.readStoreRaw === "undefined");

  /* ──────────────── 5. contra o ledger de verdade, só leitura ──────────── */

  console.log("\n[ 05 ] o arquivo que está no disco agora");

  const cru = JSON.parse(src("proposals.json")).proposals;
  const soFix = await fix.readStore("fix");
  const soUp = await fix.readStore("upgrade");
  /* ESTE BLOCO MUDOU QUANDO A ABA COMEÇOU A GRAVAR DE VERDADE, em 2026-08-20,
     com o primeiro upgrade aplicado no `Agente Iago Comercial`.

     Ele afirmava duas coisas que eram verdade até ali: que TODA linha do disco
     era legado sem `kind`, e que o tipo `upgrade` estava vazio porque a aba
     ainda não escrevia. Nenhuma das duas descrevia uma garantia — descreviam o
     estado do arquivo naquele dia, e por isso ficaram vermelhas sozinhas.

     O que elas de fato protegiam continua, e agora está afirmado sem depender
     do conteúdo do ledger: linha sem `kind` conta como correção (o legado segue
     legível), os dois filtros somam o arquivo (nenhuma linha se perde nem é
     contada duas vezes), e um filtro nunca devolve linha do outro tipo — que é
     o que impede a mediana de um tipo de contaminar a barra do outro. */
  const legado = cru.filter(p => !p.kind).length;
  const upNoDisco = cru.filter(p => p.kind === "upgrade").length;
  t("linha sem `kind` conta como correção (" + legado + " no disco)",
    soFix.length === legado + cru.filter(p => p.kind === "fix").length);
  t("o filtro `upgrade` devolve exatamente as linhas de upgrade (" + upNoDisco + ")",
    soUp.length === upNoDisco);
  t("nenhum filtro devolve linha do outro tipo",
    soFix.every(p => (p.kind || "fix") === "fix") && soUp.every(p => p.kind === "upgrade"));
  t("os dois filtros somam o arquivo", soFix.length + soUp.length === cru.length);

  /* A mediana é o denominador de uma barra na tela. Se o filtro cair, o upgrade
     passa a herdar as amostras da correção e a barra mente para os dois lados. */
  const eFix = await fix.estimate("fix");
  const eUp = await fix.estimate("upgrade");
  t("estimate(fix) tem amostras do histórico real", eFix.samples > 0);
  /* A afirmação é sobre NÃO HERDAR, não sobre estar zerado: com upgrades
     aplicados no disco, `samples` deixa de ser 0 legitimamente. O que não pode
     acontecer é o upgrade contar as amostras da correção — aí a barra mentiria
     para os dois lados. */
  t("estimate(upgrade) NÃO herda as amostras da correção",
    eUp.samples === soUp.length || eUp.samples < eFix.samples);
  t("...e sem amostras não inventa mediana", eUp.medianMs === null);

  /* ─────────────────────── 6. todo consumidor, na fonte ───────────────── */

  console.log("\n[ 06 ] os cinco consumidores dizem de que tipo falam");

  const cf = src("claude-fix.js");
  const sv = src("server.js");

  /* A contagem é o portão, igual à da etapa 0: um `readStore()` novo sem tipo
     não compila conceito nenhum — ele JOGA — mas um com o tipo errado passa, e
     é isso que a enumeração pega. */
  const chamadas = [...cf.matchAll(/\breadStore\(([^)]*)\)/g)].map(m => m[1].trim())
    .filter(a => a !== "kind");   // a própria definição e o repasse de estimate
  t("claude-fix: toda leitura do ledger nomeia o tipo",
    chamadas.length > 0 && chamadas.every(a => /^"(fix|upgrade)"$/.test(a)));
  t("rehydrate lê só correção — upgrade não volta como proposta de conserto",
    /readStore\("fix"\)\)\.filter\(p => p\.status === "ready"\)/.test(cf));
  t("estimate é chamado com tipo", /await estimate\("fix"\)/.test(cf));
  t("persist grava a linha tipada", /kind: "fix",/.test(cf));
  t("o cap é por tipo, não do arquivo", /indices\.slice\(-STORE_CAP\)/.test(cf));
  t("...e writeStore passa pelo trim por tipo", /const trimmed = trimPorTipo\(list\)/.test(cf));
  t("upsertStore lê CRU antes de reescrever", /upsertEm\(await readStoreRaw\(\), entry\)/.test(cf));
  t("server: a rota /api/claude/proposals filtra correção", /claudeFix\.readStore\("fix"\)/.test(sv));
  t("...e é a única leitura do ledger no servidor",
    (sv.match(/claudeFix\.readStore\(/g) || []).length === 1);

  /* Nenhuma parte da etapa 1 liga fila. Isso é a etapa 3. */
  t("etapa 1 não antecipou o mutex", !/\bmutex\b|aguardando a vez/i.test(cf));

  console.log(bad
    ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
    : "\npassou: " + ok + " casos — o upgrade divide o ledger sem expulsar a correção");
  process.exit(bad ? 1 : 0);
})();
