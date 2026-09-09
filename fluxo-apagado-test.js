/* fluxo-apagado-test.js — a execução de um fluxo que não existe mais.
 *
 * O DEFEITO, medido em 2026-08-28 contra a instância viva: o Kauan apagou o
 * `FLUXO AVISO ERROR` (`BpDac30P5uiuebdC`) no n8n, o n8n levou as execuções dele
 * junto — a API passou a devolver 1500 onde este processo ainda servia 1513 — e
 * o cartão de erro continuou no quadro `[ 03 / 05 ]`. Causa: o poll só SOMA
 * execuções (`S.execs.set` por id) e a única poda que existia era pela janela de
 * 24h. Uma execução de fluxo apagado nunca envelhece o bastante enquanto está
 * dentro da janela, então ela ficava para sempre.
 *
 * O QUE ESTE ARQUIVO PROVA, e a segunda metade é a que carrega:
 *   - a lista de workflows VAZIA não apaga nada. Lista vazia é o n8n fora do ar,
 *     não prova de que o fluxo sumiu, e o resto do repositório já escreve essa
 *     regra em quatro lugares (`callers` reportando `falhas`, o `truncado` do
 *     `locate`, o cinza que nunca é vermelho no dossiê, o campo ausente que
 *     nunca cai no galho negativo).
 *   - a poda roda DEPOIS dos três Maps do retrato e NÃO roda no `delta`: o
 *     `delta` do SSE não carrega workflows, então podar ali seria comparar
 *     execução nova contra lista velha e apagar fluxo vivo.
 *
 * As duas funções são EXTRAÍDAS do `flows.html` em tempo de execução. Reescrevê-las
 * aqui provaria a cópia, não a página — a disciplina que o `audio-test.js`
 * estabeleceu. A fiação é medida sobre a fonte SEM COMENTÁRIOS, porque um
 * comentário citando o nome da função já deixou caso verde neste repositório.
 *
 * Grátis: sem navegador, sem rede, sem n8n, nada escrito no repo.
 *   node fluxo-apagado-test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const PAGINA = path.join(__dirname, "flows.html");
const src = fs.readFileSync(PAGINA, "utf8");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const erro = m => { total++; falhas++; console.log("  FALHA " + m); };
const eq = (a, b, m) => (a === b ? ok(m) : erro(m + "  (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"));

/* ── extração ────────────────────────────────────────────────────────────── */

function recorte(nome) {
  const i = src.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("não achei `function " + nome + "` em flows.html");
  let j = src.indexOf("{", i), n = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") n++;
    else if (src[k] === "}") { n--; if (n === 0) return src.slice(i, k + 1); }
  }
  throw new Error("`" + nome + "` começa e não fecha");
}

/* `S` é o estado da página; as duas funções fecham sobre ele. Montar o escopo
   aqui é o que permite dirigi-las sem navegador. */
function montar() {
  const S = { workflows: new Map(), execs: new Map(), details: new Map() };
  const fn = new Function("S", recorte("fluxoSumiu") + "\n" + recorte("podarFluxosApagados")
    + "\nreturn { fluxoSumiu, podarFluxosApagados };");
  return Object.assign({ S }, fn(S));
}

/* ── 1. o veredito ───────────────────────────────────────────────────────── */
console.log("\n[1] fluxoSumiu — o veredito");
{
  const t = montar();
  t.S.workflows = new Map([["vivo1", {}], ["vivo2", {}]]);
  eq(t.fluxoSumiu("vivo1"), false, "id na lista → não sumiu");
  eq(t.fluxoSumiu("BpDac30P5uiuebdC"), true, "id fora de uma lista NÃO vazia → sumiu");
}
{
  const t = montar();
  t.S.workflows = new Map();
  eq(t.fluxoSumiu("BpDac30P5uiuebdC"), false,
    "LISTA VAZIA não acusa ninguém — n8n fora do ar não é prova de fluxo apagado");
}
{
  const t = montar();
  t.S.workflows = null;
  eq(t.fluxoSumiu("qualquer"), false, "lista ausente também não acusa (mesma regra do campo ausente)");
}

/* ── 2. a poda ───────────────────────────────────────────────────────────── */
console.log("\n[2] podarFluxosApagados — o que sai e o que fica");
{
  const t = montar();
  t.S.workflows = new Map([["vivo", { id: "vivo" }]]);
  t.S.execs = new Map([
    ["1", { id: "1", workflowId: "vivo" }],
    ["2", { id: "2", workflowId: "BpDac30P5uiuebdC" }],
    ["3", { id: "3", workflowId: "BpDac30P5uiuebdC" }]
  ]);
  t.S.details = new Map([
    ["2", { id: "2", workflowId: "BpDac30P5uiuebdC", status: "error" }],
    ["9", { id: "9", workflowId: "vivo", status: "error" }]
  ]);
  const fora = t.podarFluxosApagados();
  eq(fora, 3, "três linhas do fluxo apagado saem (2 execuções + 1 detalhe)");
  eq(t.S.execs.size, 1, "a execução do fluxo vivo fica");
  eq(t.S.execs.has("1"), true, "e é a certa");
  eq(t.S.details.size, 1, "o detalhe de erro do fluxo vivo fica");
  eq(t.S.details.has("9"), true, "e é o certo");
}
{
  /* A CASO QUE CARREGA O ARQUIVO. Sem a guarda, um n8n fora do ar esvazia o
     painel inteiro e a tela fica dizendo que nada nunca rodou. */
  const t = montar();
  t.S.workflows = new Map();
  t.S.execs = new Map([["1", { id: "1", workflowId: "vivo" }], ["2", { id: "2", workflowId: "outro" }]]);
  t.S.details = new Map([["2", { id: "2", workflowId: "outro" }]]);
  const fora = t.podarFluxosApagados();
  eq(fora, 0, "LISTA VAZIA não poda nada");
  eq(t.S.execs.size, 2, "nenhuma execução foi perdida");
  eq(t.S.details.size, 1, "nenhum detalhe foi perdido");
}
{
  const t = montar();
  t.S.workflows = new Map([["vivo", {}]]);
  eq(t.podarFluxosApagados(), 0, "nada para podar devolve 0, sem estourar em mapa vazio");
}

/* ── 3. a fiação, sobre a fonte sem comentários ──────────────────────────── */
console.log("\n[3] a fiação");

/* Tirar comentários de bloco e de linha ANTES de procurar: um comentário que
   cita o nome da função já deixou dois casos verdes neste repositório com o
   código apagado. Aspas simples/duplas de dentro do JS não interessam aqui
   porque nenhuma delas contém as sequências procuradas. */
const limpo = src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

{
  const iChamada = limpo.indexOf("podarFluxosApagados();");
  const iExecs = limpo.indexOf("S.execs = new Map(o.executions");
  const iDetails = limpo.indexOf("S.details = new Map(o.errors");
  const iWfs = limpo.indexOf("S.workflows = new Map(o.workflows");
  eq(iChamada > 0, true, "a poda é CHAMADA (não só definida)");
  eq(iWfs > 0 && iExecs > 0 && iDetails > 0, true, "os três Maps do retrato existem");
  eq(iChamada > iWfs, true, "chamada DEPOIS da lista de workflows — senão compara contra lista vazia");
  eq(iChamada > iExecs, true, "chamada DEPOIS das execuções");
  eq(iChamada > iDetails, true, "chamada DEPOIS dos detalhes de erro");
}
{
  /* O `delta` do SSE não carrega workflows. Podar ali compararia execução nova
     contra a lista do último retrato — que numa aba aberta há horas está velha —
     e apagaria execução de fluxo vivo. */
  const iDelta = limpo.indexOf('es.addEventListener("delta"');
  eq(iDelta > 0, true, "o ouvinte de `delta` existe");
  const trecho = limpo.slice(iDelta, iDelta + 2200);
  eq(trecho.includes("podarFluxosApagados"), false,
    "a poda NÃO roda no `delta` — ali a lista de workflows é do retrato anterior");
  eq(trecho.includes("podarDetalhes()"), true,
    "a poda por janela continua no `delta` (essa não depende da lista de workflows)");
}
{
  /* AS DUAS CAMADAS, e não uma. O `fluxoSumiu` já barra a lista vazia sozinho, então
     um mutante que apague a guarda DA PODA fica verde em todo caso de comportamento —
     medido, foi o único dos quatro que sobreviveu na primeira rodada. A redundância é
     deliberada (a disciplina de `nomeSeguro` + `dentro()`), e o único jeito de prová-la
     é olhar a fonte: sem isto a segunda camada some sem nada ficar vermelho, e aí a
     primeira vira a única. */
  const desde = limpo.indexOf("function podarFluxosApagados(");
  const corpo = limpo.slice(desde, limpo.indexOf("function podarDetalhes(", desde)).replace(/\s+/g, " ");
  eq(/S\.workflows[^;]*size === 0\) return 0;/.test(corpo), true,
    "a poda tem guarda PRÓPRIA de lista vazia — segunda camada, não confia só no veredito");
}
{
  const n = (limpo.match(/podarFluxosApagados\s*\(\s*\)\s*;/g) || []).length;
  eq(n, 1, "uma única chamada — uma segunda colada por engano chega vermelha com o número");
}

/* ── fim ─────────────────────────────────────────────────────────────────── */
console.log("\n" + (falhas ? "FALHOU: " + falhas + " de " + total : "tudo ok: " + total + " casos"));
process.exit(falhas ? 1 : 0);
