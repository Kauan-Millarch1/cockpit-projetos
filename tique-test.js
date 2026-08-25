/* tique-test.js — o tique em que nada aconteceu, os relógios que andam sozinhos,
 * e a poda do `S.details`.
 *
 * Os três nascem do mesmo fato medido: `server.js` emite `delta` a cada 20s mesmo
 * quando nada rodou (de propósito — o navegador precisa do carimbo de frescor), e
 * medido no stream ao vivo **9 de 9 deltas vieram vazios**, porque esta instância
 * faz 0,22 execução por tique. `renderAll()` rodava em todos: ~2.400 elementos
 * destruídos e recriados quatro vezes por minuto para reescrever os mesmos números.
 *
 * Os casos que carregam peso:
 *
 *  - **detalhe de ERRO nunca é podado**, mesmo fora da janela. `errorGroups()` é
 *    construído a partir deles, e o `CLAUDE.md` já registra que uma marca de
 *    correção sob leitura capada não prova nada. Podar erro pioraria isso em
 *    silêncio — a assinatura simplesmente sumiria do quadro.
 *  - **o detalhe no palco sobrevive**, senão o replay perde a fita aberta enquanto
 *    alguém a está olhando.
 *  - **o relógio relativo continua andando**. Não redesenhar é fácil; não redesenhar
 *    e deixar o cartão dizendo "há 2min" doze minutos depois é a mesma classe de
 *    mentira que o selo de frescor existe para não contar.
 *  - **o instante entra pelo DOM, nunca interpolado em `innerHTML`.** O ISO vem do
 *    payload do n8n, esta página não tem `esc()`, e a regra desta casa é que payload
 *    do n8n é hostil.
 *
 * As funções são EXTRAÍDAS de `flows.html` em tempo de execução. Reimplementar a
 * poda aqui provaria a cópia — disciplina de `audio-test.js`.
 *
 * De graça: sem modelo, sem rede, sem servidor, nada escrito em disco.
 *   node tique-test.js */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const PAG = path.join(__dirname, "flows.html");
const html = fs.readFileSync(PAG, "utf8");

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (err) { falhas++; console.log("  FALHOU  " + nome + "\n         " + (err && err.message)); }
}
function bloco(nome) { console.log("\n" + nome); }

/* Fonte sem comentário: os comentários que escrevi na página citam `renderFeed`,
 * `renderCards` e `innerHTML` várias vezes, e um `includes` casando dentro deles
 * aprovaria a documentação da decisão em vez da decisão. Lição de
 * `dossie-tela-test.js`, onde um mutante que apagou o guarda ficou VERDE porque o
 * comentário sobrevivente satisfazia o `includes`. */
function semComentario(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");
}

function recortar(src, assinatura) {
  const i = src.indexOf(assinatura);
  assert.ok(i >= 0, "não achei `" + assinatura + "` em flows.html");
  let j = src.indexOf("{", i), n = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") n++;
    else if (src[k] === "}") { n--; if (!n) return src.slice(i, k + 1); }
  }
  throw new Error("chaves não fecham em " + assinatura);
}

const SRC = semComentario(html);
const FONTE_PODAR = recortar(html, "function podarDetalhes()");
const FONTE_TOCAR = recortar(html, "function tocarRelogios()");
const FONTE_AGO = recortar(html, "function agoShort(ms)");

const HORA = 3600e3;
const AGORA = 1_760_000_000_000;      // fixo: um `Date.now()` real faria o teste mudar a cada olhada
const PISO = AGORA - 24 * HORA;

function montarPodar({ details, loadedExec }) {
  const S = { details: new Map(details), loadedExec };
  const escopo = { S, windowFloor: () => PISO };
  const nomes = Object.keys(escopo);
  const fab = new Function(...nomes, FONTE_PODAR + "\nreturn podarDetalhes;");
  return { podar: fab(...nomes.map(n => escopo[n])), S };
}

const det = (id, status, hAtras, extra) => [String(id), {
  id: String(id), status,
  startedAt: new Date(AGORA - hAtras * HORA).toISOString(),
  ...(extra || {})
}];

// ------------------------------------------------------------- 1. a poda
bloco("1. a poda do S.details: o que sai e o que fica");

t("detalhe de SUCESSO fora da janela sai", () => {
  const m = montarPodar({ details: [det(1, "success", 30)], loadedExec: null });
  assert.strictEqual(m.podar(), 1);
  assert.strictEqual(m.S.details.size, 0);
});

t("detalhe de sucesso DENTRO da janela fica", () => {
  const m = montarPodar({ details: [det(1, "success", 3)], loadedExec: null });
  assert.strictEqual(m.podar(), 0);
  assert.strictEqual(m.S.details.size, 1);
});

t("detalhe de ERRO fora da janela FICA — o quadro de erros é construído deles", () => {
  const m = montarPodar({ details: [det(1, "error", 72)], loadedExec: null });
  assert.strictEqual(m.podar(), 0, "podar erro faz a assinatura sumir do quadro sem ninguém saber");
  assert.ok(m.S.details.has("1"));
});

t("detalhe com objeto `error` mas sem `status: error` também fica", () => {
  /* Os detalhes que entram pelo delta vêm de `extractExecDetail`, e não é garantido
     que todos tragam `status`. Julgar só por `status` deixaria esses cruzarem a
     poda. */
  const m = montarPodar({ details: [det(1, "unknown", 99, { error: { nodeName: "x" } })], loadedExec: null });
  assert.strictEqual(m.podar(), 0);
});

t("o detalhe NO PALCO fica, mesmo velho e de sucesso", () => {
  const m = montarPodar({ details: [det(7, "success", 40)], loadedExec: { id: "7" } });
  assert.strictEqual(m.podar(), 0, "o replay perderia a fita aberta enquanto alguém a olha");
  assert.ok(m.S.details.has("7"));
});

t("o palco é comparado como TEXTO, não por tipo", () => {
  // `loadedExec.id` chega como número em alguns caminhos e como string em outros.
  const m = montarPodar({ details: [det(7, "success", 40)], loadedExec: { id: 7 } });
  assert.strictEqual(m.podar(), 0, "id numérico contra chave string não pode desproteger o palco");
});

t("detalhe sem `startedAt` fica — não há como julgar a idade dele", () => {
  const m = montarPodar({ details: [["9", { id: "9", status: "success" }]], loadedExec: null });
  assert.strictEqual(m.podar(), 0);
});

t("detalhe nulo não derruba a poda", () => {
  const m = montarPodar({ details: [["9", null]], loadedExec: null });
  assert.doesNotThrow(() => m.podar());
});

t("um dia de palco: 700 sucessos velhos saem, os erros e o palco ficam", () => {
  /* O número é o medido: o fluxo mais movimentado faz 764 execuções em 24h, e
     `loadExec` guardava o detalhe de cada uma — 34KB de mediana, ~26MB por dia. */
  const details = [];
  for (let i = 0; i < 700; i++) details.push(det(1000 + i, "success", 30));
  for (let i = 0; i < 11; i++) details.push(det(2000 + i, "error", 30));
  details.push(det(3000, "success", 30));
  const m = montarPodar({ details, loadedExec: { id: "3000" } });
  const fora = m.podar();
  console.log("       " + fora + " detalhes de sucesso podados, " + m.S.details.size + " ficaram (11 erros + 1 no palco)");
  assert.strictEqual(fora, 700);
  assert.strictEqual(m.S.details.size, 12);
});

// -------------------------------------------------------- 2. os relógios
bloco("2. os relógios relativos andam sem redesenhar a tela");

function montarTocar(nos) {
  const alvos = nos.map(n => ({ dataset: { desde: n }, textContent: "?" }));
  const escopo = {
    document: { querySelectorAll: sel => (sel === "[data-desde]" ? alvos : []) },
    Date: class extends Date { static now() { return AGORA; } }
  };
  const nomes = Object.keys(escopo);
  const fab = new Function(...nomes, FONTE_AGO + "\n" + FONTE_TOCAR + "\nreturn tocarRelogios;");
  return { tocar: fab(...nomes.map(n => escopo[n])), alvos };
}

t("cada nó marcado tem o texto reescrito a partir do seu próprio instante", () => {
  const m = montarTocar([
    new Date(AGORA - 40e3).toISOString(),
    new Date(AGORA - 12 * 60e3).toISOString(),
    new Date(AGORA - 5 * HORA).toISOString()
  ]);
  m.tocar();
  assert.deepStrictEqual(m.alvos.map(a => a.textContent), ["40s", "12min", "5h"]);
});

t("instante ilegível vira travessão, nunca `NaN`", () => {
  const m = montarTocar(["ontem à noite"]);
  m.tocar();
  assert.strictEqual(m.alvos[0].textContent, "—", "`NaNmin` na tela é pior que não mostrar nada");
});

t("só os nós marcados são tocados", () => {
  const m = montarTocar([]);
  assert.doesNotThrow(() => m.tocar());
});

t("os DOIS lugares com relógio marcam com `data-desde`", () => {
  // Cartão de fluxo (dentro de uma string de innerHTML, atributo posto depois) e
  // a linha `.when` do cartão de erro (construída por nós filhos).
  assert.ok(/class="desde"/.test(SRC), "o cartão de fluxo perdeu a marca do relógio");
  assert.ok(/dataset\.desde\s*=\s*f\.lastRun\.startedAt/.test(SRC), "o cartão de fluxo não guarda o instante");
  assert.ok(/dataset\.desde\s*=\s*iso/.test(SRC), "a linha do cartão de erro não guarda o instante");
});

t("o instante NUNCA é interpolado em `innerHTML`", () => {
  /* Payload do n8n é hostil e esta página não tem `esc()`. `dataset` é atribuição
     de DOM: não parseia nada. Um `data-desde="' + iso + '"` dentro de uma string de
     `innerHTML` seria injeção. */
  assert.ok(!/data-desde\s*=\s*\\?["'][^"']*['"]\s*\+/.test(SRC),
    "há um `data-desde=` sendo concatenado numa string de HTML");
  assert.ok(!/["']\s*data-desde\s*=/.test(SRC.replace(/\[data-desde\]/g, "")),
    "`data-desde` aparece dentro de uma string — tem que ser posto via `dataset`");
});

// --------------------------------------------------- 3. o guarda do tique
bloco("3. o tique vazio não redesenha, e o cheio redesenha");

t("o handler do delta decide entre `renderAll()` e `renderTiqueVazio()`", () => {
  assert.ok(/if\s*\(\s*novas\s*\|\|\s*saiu\s*\)\s*renderAll\(\)\s*;\s*else\s+renderTiqueVazio\(\)/.test(SRC),
    "esperava `if (novas || saiu) renderAll(); else renderTiqueVazio();` no handler do delta");
});

t("`novas` conta execuções E erros — um erro novo sem execução nova redesenha", () => {
  assert.ok(/const\s+novas\s*=\s*\(d\.executions\s*\|\|\s*\[\]\)\.length\s*\+\s*\(d\.errors\s*\|\|\s*\[\]\)\.length/.test(SRC),
    "contar só `executions` deixaria um erro novo fora do redesenho");
});

t("a saída da janela também redesenha", () => {
  /* Uma execução que cai fora da janela muda os cartões e o feed mesmo sem
     nenhuma linha nova ter chegado. Sem esta metade, o painel mostraria contagens
     de 24h que já não são de 24h. */
  assert.ok(/saiu\s*\+=\s*podarDetalhes\(\)/.test(SRC), "a poda tem que somar em `saiu`");
  assert.ok(/S\.execs\.delete\(id\);\s*saiu\+\+/.test(SRC), "a poda da janela tem que somar em `saiu`");
});

t("`renderTiqueVazio` NÃO refaz feed, cartões, quadro de erros nem trilha", () => {
  const corpo = semComentario(recortar(html, "function renderTiqueVazio()"));
  for (const caro of ["renderFeed", "renderCards", "renderErrors", "renderRail"]) {
    assert.ok(!corpo.includes(caro), "`renderTiqueVazio` chama `" + caro + "` — o ganho todo se perde");
  }
});

t("`renderTiqueVazio` FAZ o carimbo de frescor e os relógios", () => {
  const corpo = semComentario(recortar(html, "function renderTiqueVazio()"));
  assert.ok(corpo.includes("renderStamp"), "sem o carimbo, o painel para de provar que o dado está fresco");
  assert.ok(corpo.includes("tocarRelogios"), "sem os relógios, o cartão congela em `há 2min` por doze minutos");
});

t("`renderAll` continua fazendo as seis coisas", () => {
  const corpo = semComentario(recortar(html, "function renderAll()"));
  for (const parte of ["renderKpis", "renderRail", "renderCards", "renderErrors", "renderFeed", "renderStamp"]) {
    assert.ok(corpo.includes(parte), "`renderAll` perdeu `" + parte + "`");
  }
});

// ------------------------------------------- 4. o intervalo em aba de fundo
bloco("4. o intervalo de 10s para quando ninguém está olhando");

t("o tique lento desiste com a aba escondida", () => {
  const corpo = semComentario(recortar(html, "const tiqueLento = () =>"));
  assert.ok(/document\.hidden/.test(corpo),
    "`renderKpis` passa por `flowsWithActivity()` — ~980 `new Date()` a cada 10s numa aba de fundo, para sempre");
});

t("e roda na hora quando a aba volta", () => {
  assert.ok(/visibilitychange[\s\S]{0,160}tiqueLento\(\)/.test(SRC),
    "sem isto o painel fica até 10s falso depois de você olhar para ele, que é pior que gastar");
});

t("o tique lento também anda com os relógios", () => {
  const corpo = semComentario(recortar(html, "const tiqueLento = () =>"));
  assert.ok(corpo.includes("tocarRelogios"), "é o que mantém os relógios em 10s em vez de 20s");
});

// ------------------------------- 5. a lista atrás da seta que ninguém clicou
bloco("5. a lista de nós só é montada quando o `<details>` abre");

const HAPPENED = semComentario(recortar(html, "function renderHappened(detail)"));

t("a montagem é adiada para o `toggle`", () => {
  /* Medido no pior caso desta instância: 158 linhas, ~700 elementos e **158 parses
     de SVG** (um `innerHTML` de glifo por linha), montados dentro de um `<details>`
     que nasce fechado. `renderHappened` roda dentro de `loadExec`, que o handler do
     delta chama sempre que o fluxo aberto executou — num fluxo movimentado, a cada
     poll de 20s. */
  assert.ok(/addEventListener\("toggle"/.test(HAPPENED), "a lista precisa esperar o `toggle`");
  assert.ok(/if\s*\(\s*det\.open\s*\)/.test(HAPPENED),
    "fechar o `<details>` também dispara `toggle` — sem checar `det.open`, fechar montaria a lista");
});

t("montar duas vezes não duplica as linhas", () => {
  /* Abrir, fechar e abrir de novo dispara `toggle` três vezes. Sem a trava, a
     lista apareceria com 158, 316 e 474 linhas. */
  assert.ok(/montada\s*=\s*false/.test(HAPPENED), "falta a trava de montagem");
  const corpo = recortar(HAPPENED, "const montarLista = () =>");
  assert.ok(/if\s*\(\s*montada\s*\)\s*return\s*;/.test(corpo), "`montarLista` tem que sair cedo se já montou");
  assert.ok(corpo.indexOf("montada") < corpo.indexOf("linha("),
    "a trava tem que ser consultada ANTES de montar, não depois — foi esse o defeito do `desenharSeNovo`");
});

t("o glifo por linha saiu do caminho quente", () => {
  // `glyphHtml` é o `innerHTML` de SVG por linha. Ele só pode existir dentro da
  // função adiada, nunca no corpo que roda a cada `loadExec`.
  const antes = HAPPENED.slice(0, HAPPENED.indexOf("function linha(l)"));
  assert.ok(!antes.includes("glyphHtml"),
    "há um `glyphHtml` fora da montagem adiada: o parse de SVG voltou para o caminho de cada poll");
});

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + (ok + falhas)
  : "passou: " + ok + " ok, 0 falha(s)"));
process.exit(falhas ? 1 : 0);
