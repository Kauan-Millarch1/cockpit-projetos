/* disco-test.js — o cache de `rows()` e a busca que não repinta por tecla.
 *
 * `cockpit.html` não tinha nenhum teste de lógica: os quatro que o tocavam
 * (`css-test`, `caractere-test`, `nav-sync-test`, `estatico-test`) são estruturais.
 *
 * Medido: `rows()` é chamado **quinze vezes por pintura** (uma direta, catorze
 * através de `countIn`), e `render()` rodava a cada tecla digitada na busca. Com 21
 * projetos são **315 espalhamentos de objeto e 315 `computeHealth` por tecla**,
 * sempre com o mesmo resultado.
 *
 * O caso que carrega peso é o da MEIA-NOITE: `computeHealth` mede idade contra o
 * dia, então um cache que não invalida na virada faz a aba aberta desde ontem
 * afirmar "parado há 14 dias" no dia 15. Um cache de performance que passa a contar
 * uma idade errada é pior que nenhum cache — este painel existe para que seus
 * números possam ser confiados.
 *
 * `rows()` é EXTRAÍDO de `cockpit.html` em tempo de execução; `computeHealth` entra
 * como dublê que CONTA chamadas, porque a contagem é a medida inteira deste arquivo.
 *
 * De graça: sem modelo, sem rede, sem servidor, nada escrito em disco.
 *   node disco-test.js */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const PAG = path.join(__dirname, "cockpit.html");
const html = fs.readFileSync(PAG, "utf8");

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (err) { falhas++; console.log("  FALHOU  " + nome + "\n         " + (err && err.message)); }
}
function bloco(nome) { console.log("\n" + nome); }

function semComentario(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");
}

function recortar(src, assinatura) {
  const i = src.indexOf(assinatura);
  assert.ok(i >= 0, "não achei `" + assinatura + "` em cockpit.html");
  let j = src.indexOf("{", i), n = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") n++;
    else if (src[k] === "}") { n--; if (!n) return src.slice(i, k + 1); }
  }
  throw new Error("chaves não fecham em " + assinatura);
}

const SRC = semComentario(html);
const FONTE_ROWS = (() => {
  const i = html.indexOf("let cacheRows =");
  assert.ok(i >= 0, "não achei a declaração do cache de `rows()`");
  const fim = html.indexOf("\n", i);
  return html.slice(i, fim + 1) + recortar(html, "function rows()");
})();

/* 21 projetos: o número real medido no disco do Kauan. */
const PROJETOS = Array.from({ length: 21 }, (_, i) => ({ name: "proj" + i, lastTouch: "2026-08-0" + (i % 9 + 1) }));

function montar(dia) {
  const conta = { saude: 0 };
  const state = { data: null };
  let hoje = dia || "2026-08-20";
  const escopo = {
    state,
    today: () => hoje,
    computeHealth: () => { conta.saude++; return { band: { key: "ativo" } }; }
  };
  const nomes = Object.keys(escopo);
  const fab = new Function(...nomes, FONTE_ROWS + "\nreturn rows;");
  return { rows: fab(...nomes.map(n => escopo[n])), state, conta, virarODia: d => { hoje = d; } };
}

// -------------------------------------------------------------- 1. o cache
bloco("1. quinze chamadas por pintura viram um cálculo");

t("sem dados devolve lista vazia e não calcula nada", () => {
  const m = montar();
  assert.deepStrictEqual(m.rows(), []);
  assert.strictEqual(m.conta.saude, 0);
});

t("a primeira chamada calcula um por projeto", () => {
  const m = montar();
  m.state.data = { projects: PROJETOS };
  assert.strictEqual(m.rows().length, 21);
  assert.strictEqual(m.conta.saude, 21);
});

t("QUINZE chamadas na mesma pintura custam 21 cálculos, não 315", () => {
  const m = montar();
  m.state.data = { projects: PROJETOS };
  for (let i = 0; i < 15; i++) m.rows();
  console.log("       15 chamadas × 21 projetos → " + m.conta.saude + " cálculos (antes: 315)");
  assert.strictEqual(m.conta.saude, 21);
});

t("o resultado devolvido é o MESMO array, não um igual", () => {
  const m = montar();
  m.state.data = { projects: PROJETOS };
  assert.strictEqual(m.rows(), m.rows(), "devolver uma cópia nova por chamada gastaria a alocação que o cache veio evitar");
});

t("uma tela de busca inteira (10 teclas × 15 chamadas) custa 21", () => {
  const m = montar();
  m.state.data = { projects: PROJETOS };
  for (let tecla = 0; tecla < 10; tecla++) for (let i = 0; i < 15; i++) m.rows();
  console.log("       10 teclas × 15 chamadas → " + m.conta.saude + " cálculos (antes: 3.150)");
  assert.strictEqual(m.conta.saude, 21);
});

// ---------------------------------------------------------- 2. invalidação
bloco("2. o que invalida, e o que aconteceria sem isso");

t("dados novos recalculam — a identidade de `state.data` é a invalidação", () => {
  const m = montar();
  m.state.data = { projects: PROJETOS };
  m.rows();
  m.state.data = { projects: PROJETOS };   // `load()` substitui o objeto inteiro
  m.rows();
  assert.strictEqual(m.conta.saude, 42, "uma varredura nova tem que aparecer na tela");
});

t("A VIRADA DA MEIA-NOITE recalcula", () => {
  /* `computeHealth` mede idade contra o dia. Sem esta invalidação, a aba aberta
     desde ontem afirma "parado há 14 dias" no dia 15 — um cache de performance que
     passa a contar idade errada é pior que nenhum cache. */
  const m = montar("2026-08-20");
  m.state.data = { projects: PROJETOS };
  m.rows();
  assert.strictEqual(m.conta.saude, 21);
  m.virarODia("2026-08-21");
  m.rows();
  assert.strictEqual(m.conta.saude, 42, "cruzar a meia-noite tem que recalcular a saúde");
});

t("o mesmo dia com o mesmo objeto não recalcula depois da virada", () => {
  const m = montar("2026-08-20");
  m.state.data = { projects: PROJETOS };
  m.rows();
  m.virarODia("2026-08-21");
  m.rows();
  m.rows(); m.rows();
  assert.strictEqual(m.conta.saude, 42);
});

t("o dia é comparado por VALOR — `today()` devolve string", () => {
  /* Se `today()` devolvesse um `Date`, a comparação por identidade falharia em
     toda chamada e o cache nunca acertaria: seria o mesmo custo de antes com uma
     camada a mais. */
  assert.ok(/const today = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0,10\)/.test(SRC),
    "`today()` mudou de forma: reveja a comparação do cache");
});

t("o cache guarda uma geração só", () => {
  const m = montar();
  for (let i = 0; i < 30; i++) { m.state.data = { projects: PROJETOS }; m.rows(); }
  const antigo = m.state.data;
  m.state.data = { projects: PROJETOS };
  m.rows();
  m.state.data = antigo;
  m.rows();
  assert.strictEqual(m.conta.saude, 32 * 21, "voltar para um `state.data` anterior tem que recalcular, não ressuscitar cache");
});

// ------------------------------------------------------------- 3. a busca
bloco("3. a busca não repinta por tecla, e o caret fica onde está");

t("o `input` é adiado", () => {
  const corpo = semComentario(recortar(html, "q.oninput = e =>"));
  assert.ok(/setTimeout/.test(corpo), "sem adiamento, cada tecla reescreve o `<main>` inteiro");
  assert.ok(/clearTimeout/.test(corpo), "sem cancelar o anterior, dez teclas viram dez repinturas");
});

t("o relógio vive FORA de `render()`", () => {
  /* Dentro, cada pintura criaria um closure novo e o `clearTimeout` não alcançaria
     o relógio da pintura anterior: ele dispararia de qualquer forma, e o
     adiamento não adiaria nada. */
  const i = SRC.indexOf("let alarmeBusca");
  const j = SRC.indexOf("function render()");
  assert.ok(i >= 0, "não achei `alarmeBusca`");
  assert.ok(i < j, "`alarmeBusca` tem que estar declarado antes de `render()`, no escopo do módulo");
  const corpoRender = semComentario(recortar(html, "function render()"));
  assert.ok(!/let\s+alarmeBusca/.test(corpoRender), "`alarmeBusca` foi declarado dentro de `render()`");
});

t("o caret volta para onde estava, não para o fim", () => {
  /* A versão anterior chamava `q.focus()` sem restaurar a seleção, o que joga o
     caret para o fim: editar o meio da palavra era impossível. */
  const corpo = semComentario(recortar(html, "q.oninput = e =>"));
  assert.ok(/selectionStart/.test(corpo), "o caret precisa ser lido antes da repintura");
  assert.ok(/setSelectionRange/.test(corpo), "o caret precisa ser devolvido depois da repintura");
});

t("o adiamento é curto — digitar é a única coisa com retorno imediato nesta tela", () => {
  const corpo = semComentario(recortar(html, "q.oninput = e =>"));
  const m = corpo.match(/setTimeout\([\s\S]*?,\s*(\d+)\s*\)/);
  assert.ok(m, "não achei o prazo do adiamento");
  const ms = Number(m[1]);
  assert.ok(ms >= 60 && ms <= 200, "prazo de " + ms + "ms: abaixo de 60 não adia nada, acima de 200 se lê como painel travado");
});

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + (ok + falhas)
  : "passou: " + ok + " ok, 0 falha(s)"));
process.exit(falhas ? 1 : 0);
