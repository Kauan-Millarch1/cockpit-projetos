/* desenho-test.js — o desenho do Tester atravessa o repaint, e uma linha de
 * terminal não custa um snapshot.
 *
 * Por que este arquivo existe. `pintar()` no `tester.html` faz
 * `app.innerHTML = …` — a tela inteira — e QUINZE tipos de evento do SSE
 * chamavam `refrescar(id)`, que baixa o snapshot inteiro antes de repintar.
 * `"log"` era um deles, e `diz()` no `tester.js` emite um evento `log` POR LINHA
 * do stream-json do CLI. Medido no agente de 65 nós: o `wf` do snapshot são
 * ~51KB e o `log` vai a 400 linhas × 400 chars. Cada linha que o Claude escrevia
 * no terminal custava um GET de ~200KB, um `JSON.parse` e a reconstrução da tela
 * — dentro dela, ~650 elementos SVG e 69 `getTotalLength()`, que é consulta de
 * geometria e força layout.
 *
 * Chegar nessa tela de verdade custa minutos e dólares de cota do plano, e o
 * defeito é invisível num print: a tela fica CERTA, só caríssima. É exatamente o
 * que um teste de graça tem de recusar.
 *
 * As funções são EXTRAÍDAS de `tester.html` em tempo de execução — reimplementar
 * a decisão aqui provaria a cópia, não a página. Mesma disciplina de
 * `palco-test.js`, `audio-test.js` e `dossie-tela-test.js`.
 *
 * O DOM é dublê. Não há como parsear HTML sem dependência, e não é isso que está
 * em jogo: o que está em jogo é a DECISÃO de reconstruir, a identidade do nó
 * entre repaints, o religamento do `#fit` e do `#corner`, e a ausência do `log`
 * na lista. O desenho de verdade se confere no navegador.
 *
 * De graça: sem modelo, sem rede, sem servidor, nada escrito em disco.
 *   node desenho-test.js */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const PAG = path.join(__dirname, "tester.html");
const html = fs.readFileSync(PAG, "utf8");

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (err) { falhas++; console.log("  FALHOU  " + nome + "\n         " + (err && err.message)); }
}
function bloco(nome) { console.log("\n" + nome); }

/* Fonte sem comentário. A lição é de `dossie-tela-test.js`: um `includes` que
 * casa DENTRO de um comentário aprova a documentação de uma decisão em vez da
 * decisão, e no pior caso aprova a AUSÊNCIA dela. Aqui é literal: os comentários
 * que escrevi na página citam `"log"`, `S.desenhado`, `desenhoEl` e
 * `getTotalLength` várias vezes cada. */
function semComentario(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");
}

/* Recorta um bloco `{…}` contando chaves a partir da assinatura dada. */
function recortar(src, assinatura) {
  const i = src.indexOf(assinatura);
  assert.ok(i >= 0, "não achei `" + assinatura + "` em tester.html");
  let j = src.indexOf("{", i), n = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") n++;
    else if (src[k] === "}") { n--; if (!n) return src.slice(i, k + 1); }
  }
  throw new Error("chaves não fecham em " + assinatura);
}

const FONTE_ASSIN   = recortar(html, "const desenhoAssinatura = s =>") + ";";
const FONTE_RELIGAR = recortar(html, "function religarCanvas()");
const FONTE_PINTAR  = recortar(html, "function desenharSeNovo(s)");
/* O handler do `log` é uma arrow inline dentro de `ligar()`. O que interessa é o
   corpo dela: sem GET, sem `pintar()`, e sem duplicar. */
const FONTE_LOG = recortar(html, 'es.addEventListener("log", ev =>')
  .replace(/^es\.addEventListener\("log", ev =>\s*/, "");

/* ------------------------------------------------------------------ o dublê */

function elemento(tag, conta) {
  const el = {
    tag, id: null, atributos: {}, filhos: [], parentNode: null,
    classes: new Set(), listeners: {}, innerHTML: "", _texto: "",
    style: { cursor: "", setProperty() { } },
    setAttribute(k, v) { el.atributos[k] = String(v); },
    getAttribute(k) { return el.atributos[k]; },
    appendChild(n) {
      if (n.parentNode) n.parentNode._solta(n);
      n.parentNode = el; el.filhos.push(n); return n;
    },
    append(...ns) { for (const n of ns) el.appendChild(n); },
    _solta(n) { const i = el.filhos.indexOf(n); if (i >= 0) el.filhos.splice(i, 1); },
    remove() { if (el.parentNode) { el.parentNode._solta(el); el.parentNode = null; } },
    addEventListener(t2, fn) { (el.listeners[t2] = el.listeners[t2] || []).push(fn); },
    disparar(t2) { for (const fn of el.listeners[t2] || []) fn({ preventDefault() { } }); },
    querySelectorAll(sel) { return el.filhos.filter(f => f.tag === sel); },
    classList: {
      add(c) { el.classes.add(c); }, remove(c) { el.classes.delete(c); },
      contains(c) { return el.classes.has(c); }
    },
    getTotalLength() { if (conta) conta.getTotalLength++; return 137.5; },
    getBoundingClientRect() { return { width: 800, height: 220, left: 0, top: 0 }; }
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._texto, set(v) { el._texto = v == null ? "" : String(v); }
  });
  return el;
}

function montar() {
  const conta = { criados: 0, getTotalLength: 0 };
  const est = { host: null, corner: null, fit: null, reduzido: false };
  const fila = [];

  /* O que o `app.innerHTML = …` do `pintar()` faz: o `#canvas`, o `#corner` e o
     `#fit` são nós NOVOS a cada evento. Chamar isto entre dois `desenharSeNovo`
     é a simulação inteira do repaint. */
  function repintar() {
    const host = elemento("div"); host.id = "canvas";
    const corner = elemento("div"); corner.id = "corner";
    const fit = elemento("button"); fit.id = "fit";
    host.appendChild(corner); host.appendChild(fit);
    est.host = host; est.corner = corner; est.fit = fit;
    return host;
  }

  const $ = sel => {
    if (sel === "#canvas") return est.host;
    if (sel === "#corner") return est.host ? est.corner : null;
    if (sel === "#fit") return est.host ? est.fit : null;
    return null;
  };

  const S = {
    desenhado: null, cam: null, snap: null,
    desenhoEl: null, desenhoAjustar: null, desenhoRotulo: null,
    desenhoMontando: false, desenhoGen: 0
  };

  const escopo = {
    S, $, LOG_TETO: 400,
    document: { createElementNS(ns, tag) { conta.criados++; return elemento(tag, conta); } },
    matchMedia: () => ({ matches: est.reduzido }),
    /* A revelação só avança quando o teste manda. Por omissão ela fica parada no
       primeiro `await`, que é o estado "montando" — a maioria dos casos aqui mede
       a CONSTRUÇÃO, não a animação. `avancar()` é para os poucos que precisam
       dela, e o que eles provam é o que nenhum print mostra: o contador tem de
       aparecer no `#corner` de DEPOIS do repaint. */
    esperar: () => new Promise(r => fila.push(r)),
    GLYPH: { x: "<path/>" },
    glyphDe: () => "x"
  };

  const nomes = Object.keys(escopo);
  const corpo = FONTE_ASSIN + "\n" + FONTE_RELIGAR + "\n" + FONTE_PINTAR
    + "\nconst aoLog = ev => " + FONTE_LOG + ";"
    + "\nreturn { desenhoAssinatura, religarCanvas, desenharSeNovo, aoLog };";
  const api = new Function(...nomes, corpo)(...nomes.map(n => escopo[n]));

  /* Solta N esperas e deixa as microtarefas correrem — um `setTimeout(0)` cai
     depois de toda a fila de microtarefas, então o laço da revelação chega ao
     próximo `await` antes de o teste continuar. */
  const avancar = async n => {
    for (let i = 0; i < n; i++) {
      const r = fila.shift(); if (r) r();
      await new Promise(res => setTimeout(res, 0));
    }
  };

  repintar();
  return { ...api, S, conta, est, repintar, avancar, fila };
}

/* Um wf sintético: cadeia n0 → n1 → … O fluxo de verdade carrega a conversa de um
   lead, e este arquivo vai para o git. */
function wfDe(n, opt) {
  const o = opt || {};
  const nodes = Array.from({ length: n }, (_, i) => ({
    name: (o.prefixo || "n") + i,
    type: o.tipos ? o.tipos(i) : "n8n-nodes-base.set",
    typeVersion: o.versao || 3
  }));
  const connections = {};
  for (let i = 0; i < n - 1; i++) {
    connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: "main", index: 0 }]] };
  }
  return { nodes, connections };
}

// ══════════════════════════════════════════════ 1. reconstruir só quando muda
bloco("1. o que decide reconstruir é o que o desenho MOSTRA");

t("a primeira pintura constrói e anexa", () => {
  const m = montar();
  assert.strictEqual(m.desenharSeNovo({ wf: wfDe(8) }), true, "sem nó, tem que construir");
  assert.ok(m.conta.criados > 40, "construiu " + m.conta.criados + " elementos, esperava o desenho inteiro");
  assert.strictEqual(m.est.host.filhos.filter(f => f.tag === "svg").length, 1);
  assert.strictEqual(m.S.desenhoEl.parentNode, m.est.host);
});

t("repaint sem mudança NÃO reconstrói — e é o caso comum", () => {
  /* O defeito que este caso recusa: `desenharSeNovo` calculava a assinatura,
     construía os ~650 elementos, demolia o svg anterior, e só 160 linhas DEPOIS
     consultava `if (jaEra || reduzido)`. O nome prometia o que não entregava. */
  const m = montar();
  const s = { wf: wfDe(65) };
  m.desenharSeNovo(s);
  const base = m.conta.criados, primeiro = m.S.desenhoEl;
  for (let i = 0; i < 40; i++) {
    m.repintar();
    assert.strictEqual(m.desenharSeNovo(s), false, "repaint " + i + " reconstruiu");
  }
  assert.strictEqual(m.conta.criados, base, "40 repaints custaram " + (m.conta.criados - base) + " elementos");
  assert.strictEqual(m.S.desenhoEl, primeiro, "tem que ser o MESMO nó, não um igual");
});

t("`getTotalLength()` — a consulta que força layout — não acontece de novo", () => {
  const m = montar();
  const s = { wf: wfDe(65) };
  m.desenharSeNovo(s);
  const base = m.conta.getTotalLength;
  assert.ok(base >= 60, "o desenho de 65 nós devia medir ~64 arestas, mediu " + base);
  for (let i = 0; i < 40; i++) { m.repintar(); m.desenharSeNovo(s); }
  assert.strictEqual(m.conta.getTotalLength, base,
    "40 repaints custaram " + (m.conta.getTotalLength - base) + " medições de geometria");
});

t("mudança de `type` com o MESMO nome reconstrói", () => {
  /* Este é o caso que a assinatura antiga (`nodes.map(n => n.name)`) não pegava.
     Enquanto o svg era reconstruído a cada evento de qualquer forma, a troca
     aparecia na tela mesmo assim; com o nó preservado ela pararia de aparecer —
     o glifo, a linha de tipo e o `<title>` todos vêm de `type`. */
  const m = montar();
  m.desenharSeNovo({ wf: wfDe(6) });
  m.repintar();
  const outro = wfDe(6, { tipos: i => i === 3 ? "n8n-nodes-base.slack" : "n8n-nodes-base.set" });
  assert.strictEqual(m.desenharSeNovo({ wf: outro }), true, "trocar o tipo de um nó tem que reconstruir");
});

t("mudança de `typeVersion` reconstrói — ela é o que o `<title>` mostra", () => {
  const m = montar();
  m.desenharSeNovo({ wf: wfDe(6, { versao: 3 }) });
  m.repintar();
  assert.strictEqual(m.desenharSeNovo({ wf: wfDe(6, { versao: 4 }) }), true);
});

t("mudança em `connections` reconstrói mesmo com os nós idênticos", () => {
  /* `connections` decide as arestas, quem vai para a segunda trilha (portas
     `ai_*`), a largura e o `viewBox`. Um `rewire` entre nós que já existem não
     muda um byte de nenhum nó — a mesma lição que o `dossie.js` pagou. */
  const m = montar();
  const a = wfDe(6);
  m.desenharSeNovo({ wf: a });
  m.repintar();
  const b = wfDe(6);
  b.connections["n0"] = { main: [[{ node: "n4", type: "main", index: 0 }]] };
  assert.strictEqual(m.desenharSeNovo({ wf: b }), true, "religar duas pontas tem que reconstruir");
});

t("um nó a mais reconstrói", () => {
  const m = montar();
  m.desenharSeNovo({ wf: wfDe(6) });
  m.repintar();
  assert.strictEqual(m.desenharSeNovo({ wf: wfDe(7) }), true);
});

t("o MESMO documento relido do snapshot (outro objeto) NÃO reconstrói", () => {
  /* `refrescar()` faz `JSON.parse` do snapshot: o objeto é sempre novo. Comparar
     por referência aqui — como o palco do upgrade.html pode fazer — reconstruiria
     em todo evento. */
  const m = montar();
  const texto = JSON.stringify({ wf: wfDe(65) });
  m.desenharSeNovo(JSON.parse(texto));
  const base = m.conta.criados;
  m.repintar();
  assert.strictEqual(m.desenharSeNovo(JSON.parse(texto)), false);
  assert.strictEqual(m.conta.criados, base);
});

// ══════════════════════════════════ 2. rascunho contra validado
bloco("2. rascunho e validado são dois desenhos, e o rótulo é a diferença");

t("rascunho → validado reconstrói e TROCA o rótulo do `#corner`", () => {
  /* O `wfParcial` vem do `Write` da sessão, ANTES dos portões. Sem `parcial` na
     assinatura, os mesmos nós validados seriam "o mesmo desenho" e o rótulo
     ficaria preso em "AINDA DESENHANDO" — a tela afirmando que ainda está sendo
     escrito um documento que já passou nos portões. */
  const m = montar();
  const wf = wfDe(5);
  m.est.reduzido = true;                        // sem revelação: o rótulo final entra direto
  m.desenharSeNovo({ wf: null, wfParcial: wf });
  assert.ok(/RASCUNHO/.test(m.est.corner.textContent), "rascunho: " + m.est.corner.textContent);
  m.repintar();
  assert.strictEqual(m.desenharSeNovo({ wf }), true, "a validação tem que reconstruir");
  assert.ok(!/RASCUNHO/.test(m.est.corner.textContent), "validado ainda diz rascunho: " + m.est.corner.textContent);
  assert.ok(/CONEXOES/.test(m.est.corner.textContent), "validado: " + m.est.corner.textContent);
});

t("o rótulo preservado volta no `#corner` NOVO depois do repaint", () => {
  const m = montar();
  m.est.reduzido = true;
  m.desenharSeNovo({ wf: wfDe(5) });
  const antes = m.est.corner.textContent;
  m.repintar();
  assert.strictEqual(m.est.corner.textContent, "", "o `#corner` novo nasce vazio (é a premissa)");
  m.desenharSeNovo({ wf: wfDe(5) });
  assert.strictEqual(m.est.corner.textContent, antes, "o rótulo não voltou no #corner recriado");
});

t("enquanto a revelação corre, o rótulo final NÃO é escrito por cima dela", () => {
  /* O contador "MONTANDO i / n" é da revelação. Escrever a contagem final aqui
     afirmaria o total antes de o último nó chegar. */
  const m = montar();
  m.est.reduzido = false;
  m.desenharSeNovo({ wf: wfDe(9) });
  assert.ok(/MONTANDO/.test(m.est.corner.textContent), "esperava o contador: " + m.est.corner.textContent);
  assert.strictEqual(m.S.desenhoMontando, true);
  m.repintar();
  m.desenharSeNovo({ wf: wfDe(9) });
  assert.strictEqual(m.est.corner.textContent, "", "o repaint escreveu o rótulo final no meio da revelação");
});

// ══════════════════════════════════ 3. o nó atravessa o repaint
bloco("3. o nó atravessa o repaint, e é RE-ANEXADO");

t("o `innerHTML` desanexa, e `desenharSeNovo` re-anexa SEM reconstruir", () => {
  /* Um `return` seco na trava não serviria: o `#canvas` é um nó NOVO e VAZIO a
     cada evento, então a tela ficaria SEM DESENHO. */
  const m = montar();
  const s = { wf: wfDe(20) };
  m.desenharSeNovo(s);
  const no = m.S.desenhoEl, base = m.conta.criados;

  m.repintar();
  assert.strictEqual(m.est.host.filhos.filter(f => f.tag === "svg").length, 0, "o hospedeiro novo nasce vazio");
  assert.strictEqual(m.desenharSeNovo(s), false, "hospedeiro novo não é desenho novo");
  assert.strictEqual(m.S.desenhoEl, no, "tem que ser o mesmo nó");
  assert.strictEqual(m.est.host.filhos.filter(f => f.tag === "svg").length, 1, "o desenho não foi re-anexado: a tela ficou vazia");
  assert.strictEqual(no.parentNode, m.est.host);
  assert.strictEqual(m.conta.criados, base);
});

t("re-anexar não duplica: o nó já no hospedeiro certo fica onde está", () => {
  const m = montar();
  const s = { wf: wfDe(8) };
  m.desenharSeNovo(s);
  for (let i = 0; i < 10; i++) m.desenharSeNovo(s);      // sem repintar de propósito
  assert.strictEqual(m.est.host.filhos.filter(f => f.tag === "svg").length, 1,
    "o desenho apareceu " + m.est.host.filhos.filter(f => f.tag === "svg").length + " vezes");
});

t("reconstruir DEMOLE o svg antigo — um desenho velho por baixo é pior que redesenhar", () => {
  const m = montar();
  m.desenharSeNovo({ wf: wfDe(6) });
  m.repintar();
  m.desenharSeNovo({ wf: wfDe(7) });
  assert.strictEqual(m.est.host.filhos.filter(f => f.tag === "svg").length, 1);
});

t("sem `#canvas` na tela devolve false e não constrói nada", () => {
  /* A abertura e a lixeira não têm canvas. Ali não há nada para pintar, e
     construir 650 elementos para jogar fora seria o desperdício de novo. */
  const m = montar();
  m.est.host = null;
  assert.strictEqual(m.desenharSeNovo({ wf: wfDe(9) }), false);
  assert.strictEqual(m.conta.criados, 0);
});

t("sem `wf` nenhum devolve false", () => {
  const m = montar();
  assert.strictEqual(m.desenharSeNovo({ wf: null, wfParcial: null }), false);
  assert.strictEqual(m.conta.criados, 0);
});

t("`S.desenhado = null` (voltar ao início, desfazer) força a reconstrução", () => {
  // Os três sítios que zeram `S.desenhado` continuam valendo como reset.
  const m = montar();
  const s = { wf: wfDe(9) };
  m.desenharSeNovo(s);
  m.repintar();
  m.S.desenhado = null;
  assert.strictEqual(m.desenharSeNovo(s), true);
});

// ══════════════════════════════════ 4. o que o repaint arranca em volta do nó
bloco("4. `#fit` e `#corner` são recriados, então precisam ser religados");

t("`#fit` continua ligado depois de um repaint", () => {
  /* `ajustar` é um closure sobre o escopo da construção. Com o svg preservado e
     o botão recriado, sem religar ele PINTA e NÃO FAZ NADA — erro nenhum no
     console, o defeito que este repo já pagou duas vezes. */
  const m = montar();
  const s = { wf: wfDe(9) };
  m.desenharSeNovo(s);
  m.est.reduzido = false;

  m.repintar();
  m.desenharSeNovo(s);
  assert.ok((m.est.fit.listeners.click || []).length >= 1, "o `#fit` recriado ficou sem handler");

  // E ele tem de MEXER na câmera, não só existir.
  m.S.cam = null;
  m.est.fit.disparar("click");
  assert.ok(m.S.cam, "o clique no `#fit` religado não aplicou a câmera");
  assert.strictEqual(m.S.cam.k, 1, "ajustar tem que voltar o zoom para 1");
});

t("o `#fit` de cada repaint recebe UM handler, não uma pilha deles", () => {
  const m = montar();
  const s = { wf: wfDe(9) };
  m.desenharSeNovo(s);
  for (let i = 0; i < 12; i++) { m.repintar(); m.desenharSeNovo(s); }
  assert.strictEqual((m.est.fit.listeners.click || []).length, 1,
    "o botão novo saiu com " + (m.est.fit.listeners.click || []).length + " handlers");
});

t("a câmera do svg preservado NÃO é religada — ela sobrevive dentro do nó", () => {
  /* Os seis listeners de pan/zoom e o cursor vivem no svg. Se ele é preservado e
     alguém religa por cima, um arraste andaria o dobro. */
  const m = montar();
  const s = { wf: wfDe(9) };
  m.desenharSeNovo(s);
  const svg = m.S.desenhoEl;
  const antes = Object.keys(svg.listeners).reduce((a, k) => a + svg.listeners[k].length, 0);
  assert.ok(antes >= 6, "esperava os listeners de pan/zoom no svg, achei " + antes);
  for (let i = 0; i < 5; i++) { m.repintar(); m.desenharSeNovo(s); }
  const depois = Object.keys(svg.listeners).reduce((a, k) => a + svg.listeners[k].length, 0);
  assert.strictEqual(depois, antes, "os listeners do svg foram duplicados: " + antes + " → " + depois);
});

// ══════════════════════════════════ 5. o defeito latente do reduced-motion
bloco("5. `prefers-reduced-motion` pedia MENOS movimento e pagava MAIS CPU");

t("com reduced-motion, `S.desenhado` é ATRIBUÍDO", () => {
  /* A ordem antiga era `if (jaEra || reduzido) { …; return; }` e só DEPOIS
     `S.desenhado = assinatura`. Com reduced-motion ativo a atribuição nunca
     acontecia, `jaEra` era sempre falso, e o desenho era reconstruído inteiro a
     cada evento do SSE, para sempre. */
  const m = montar();
  m.est.reduzido = true;
  m.desenharSeNovo({ wf: wfDe(9) });
  assert.ok(m.S.desenhado, "`S.desenhado` ficou nulo: a trava nunca fecha");
  assert.strictEqual(m.S.desenhado, m.desenhoAssinatura({ wf: wfDe(9) }));
});

t("com reduced-motion, 40 repaints custam ZERO reconstrução", () => {
  const m = montar();
  m.est.reduzido = true;
  const s = { wf: wfDe(65) };
  m.desenharSeNovo(s);
  const base = m.conta.criados;
  for (let i = 0; i < 40; i++) { m.repintar(); m.desenharSeNovo(s); }
  assert.strictEqual(m.conta.criados, base,
    "quem pediu menos movimento pagou " + (m.conta.criados - base) + " elementos a mais");
});

t("reduced-motion mantém o ESTADO: tudo nasce montado e o rótulo final entra", () => {
  // A regra da casa: derruba o movimento, mantém o estado.
  const m = montar();
  m.est.reduzido = true;
  m.desenharSeNovo({ wf: wfDe(5) });
  assert.strictEqual(m.S.desenhoMontando, false, "não há revelação a correr");
  assert.ok(/NOS/.test(m.est.corner.textContent), "rótulo: " + m.est.corner.textContent);
});

// ══════════════════════════════════ 6. a ordem no código-fonte
bloco("6. a trava está ANTES da demolição, no arquivo");

const SRC = semComentario(recortar(semComentario(html), "function desenharSeNovo(s)"));

t("a trava de reaproveitamento vem antes de `createElementNS` e da demolição", () => {
  const trava = SRC.indexOf("S.desenhoEl");
  const cria  = SRC.indexOf("createElementNS");
  const demol = SRC.indexOf('querySelectorAll("svg")');
  assert.ok(trava >= 0, "a trava sumiu de `desenharSeNovo`");
  assert.ok(cria > trava, "o desenho é construído ANTES de a trava ser consultada — o defeito original");
  assert.ok(demol > trava, "o svg antigo é demolido ANTES de a trava ser consultada");
});

t("`S.desenhado` é atribuído antes de qualquer `return` das duas travas", () => {
  const atrib = SRC.indexOf("S.desenhado = assinatura");
  const ret = SRC.indexOf("return true", SRC.indexOf("reduzido"));
  assert.ok(atrib >= 0 && ret > atrib, "`S.desenhado` voltou para depois do return do reduced-motion");
});

t("a revelação escreve no `#corner` LIDO na hora, nunca num nó capturado", () => {
  /* Com o repaint, o `#corner` que a revelação tinha na mão no começo já foi
     jogado fora: escrever nele é escrever num órfão, e o contador não aparece. */
  assert.ok(/escreverCorner\(/.test(SRC), "esperava `escreverCorner` na função");
  assert.ok(!/corner\.textContent\s*=/.test(SRC),
    "voltou a escrever num `#corner` capturado — o contador escreve num órfão depois do primeiro repaint");
});

t("a revelação carrega um selo de geração", () => {
  /* Ela sobrevive ao repaint agora, então duas podem coexistir — a antiga sobre
     um svg já substituído — e as duas escreveriam no mesmo `#corner`. */
  assert.ok(/gen\s*!==\s*S\.desenhoGen/.test(SRC), "sem o selo, a revelação velha escreve no desenho novo");
});

t("a assinatura carrega as quatro coisas que o desenho mostra", () => {
  const a = semComentario(recortar(semComentario(html), "const desenhoAssinatura = s =>"));
  for (const p of ["n.name", "n.type", "n.typeVersion", "wf.connections"]) {
    assert.ok(a.includes(p), "a assinatura não olha `" + p + "`");
  }
  assert.ok(/!\(?s\.wf\)?/.test(a), "a assinatura não distingue rascunho de validado");
});

// ══════════════════════════════════ 7. o `log` fora da lista
bloco("7. uma linha de terminal não custa um snapshot");

const SRC_LIGAR = semComentario(recortar(semComentario(html), "function ligar(id)"));

t('`"log"` NÃO está na lista que chama `refrescar`', () => {
  /* Uma linha do stream-json do CLI custava um GET do snapshot inteiro (~51KB só
     de `wf` num agente de 65 nós) + `JSON.parse` + `app.innerHTML` da tela toda. */
  const m = SRC_LIGAR.match(/for \(const t of \[([^\]]*)\]\)/);
  assert.ok(m, "não achei a lista de eventos que refrescam");
  const lista = m[1].split(",").map(x => x.trim().replace(/^"|"$/g, ""));
  assert.ok(!lista.includes("log"), "`log` voltou para a lista: " + m[1]);
  assert.ok(lista.includes("fim"), "`fim` tem que ficar: é o refresh final, e vem DEPOIS do último `diz()`");
  assert.ok(lista.includes("wf") && lista.includes("etapa"), "a lista perdeu evento de verdade");
});

t("`anexos` e `projeto` ENTRARAM na lista — eles viajavam de carona no `log`", () => {
  /* Medido no `tester.js`: os dois são emitidos e ninguém escutava. O chip de
     "a sessão abriu este arquivo" (`registrarLeituraAnexo`) só aparecia no
     refresh que a próxima linha de `log` disparava. Tirar o `log` sem eles
     deixaria esse chip mudo até a etapa seguinte. */
  const m = SRC_LIGAR.match(/for \(const t of \[([^\]]*)\]\)/);
  const lista = m[1].split(",").map(x => x.trim().replace(/^"|"$/g, ""));
  for (const e of ["anexos", "projeto"]) {
    assert.ok(lista.includes(e), "`" + e + "` ficou sem ouvinte, e sem o `log` ninguém repinta por ele");
  }
});

t("o `log` tem handler PRÓPRIO, e ele não chama `refrescar` nem `pintar`", () => {
  const h = semComentario(FONTE_LOG);
  assert.ok(/es\.addEventListener\("log"/.test(SRC_LIGAR), "o handler dedicado do `log` desapareceu");
  assert.ok(!/refrescar\(/.test(h), "o handler do `log` voltou a baixar o snapshot");
  assert.ok(!/pintar\(/.test(h), "o handler do `log` repinta a tela inteira");
  assert.ok(!/fetch\(|callApi\(/.test(h), "o handler do `log` faz chamada de rede");
});

t("a linha nova é anexada ao log do snapshot", () => {
  const m = montar();
  m.S.snap = { log: [{ at: "t1", texto: "primeira", nivel: "info" }] };
  m.aoLog({ data: JSON.stringify({ at: "t2", texto: "segunda", nivel: "warn" }) });
  assert.strictEqual(m.S.snap.log.length, 2);
  assert.deepStrictEqual(m.S.snap.log[1], { at: "t2", texto: "segunda", nivel: "warn" });
});

t("a ORDEM é preservada — um log fora de ordem não é um log", () => {
  const m = montar();
  m.S.snap = { log: [] };
  for (let i = 0; i < 30; i++) m.aoLog({ data: JSON.stringify({ at: "t" + i, texto: "l" + i, nivel: "info" }) });
  assert.deepStrictEqual(m.S.snap.log.map(x => x.texto), Array.from({ length: 30 }, (_, i) => "l" + i));
});

t("o NÍVEL atravessa: `info`, `warn` e `erro` chegam como o servidor mandou", () => {
  const m = montar();
  m.S.snap = { log: [] };
  for (const n of ["info", "warn", "erro"]) m.aoLog({ data: JSON.stringify({ at: "t", texto: n, nivel: n }) });
  assert.deepStrictEqual(m.S.snap.log.map(x => x.nivel), ["info", "warn", "erro"]);
});

t("a linha que já veio no snapshot NÃO duplica — é o defeito mais provável daqui", () => {
  /* O SSE e o GET do `refrescar` correm soltos: o snapshot pode trazer a linha
     ANTES de o evento dela chegar. */
  const m = montar();
  const linha = { at: "2026-08-20T10:00:00.000Z", texto: "escrevendo workflow.json", nivel: "info" };
  m.S.snap = { log: [linha] };
  m.aoLog({ data: JSON.stringify(linha) });
  assert.strictEqual(m.S.snap.log.length, 1, "a linha entrou duas vezes");
  // E de novo, dez vezes: uma reconexão reenvia o snapshot inteiro.
  for (let i = 0; i < 10; i++) m.aoLog({ data: JSON.stringify(linha) });
  assert.strictEqual(m.S.snap.log.length, 1);
});

t("duas linhas de texto igual em instantes DIFERENTES são duas linhas", () => {
  // O contrário do caso acima: deduplicar por texto só engoliria repetição real.
  const m = montar();
  m.S.snap = { log: [] };
  m.aoLog({ data: JSON.stringify({ at: "t1", texto: "lendo catalogo.json", nivel: "info" }) });
  m.aoLog({ data: JSON.stringify({ at: "t2", texto: "lendo catalogo.json", nivel: "info" }) });
  assert.strictEqual(m.S.snap.log.length, 2);
});

t("sem snapshot ainda, a linha é descartada em vez de explodir", () => {
  // O snapshot é o primeiro evento do SSE, mas uma reconexão em curso pode
  // deixar `S.snap` nulo por um instante — e ele traz o log inteiro de qualquer
  // forma, então não há nada a perder.
  const m = montar();
  m.S.snap = null;
  assert.doesNotThrow(() => m.aoLog({ data: JSON.stringify({ at: "t", texto: "x", nivel: "info" }) }));
});

t("payload quebrado não derruba o handler", () => {
  const m = montar();
  m.S.snap = { log: [] };
  assert.doesNotThrow(() => m.aoLog({ data: "não é json" }));
  assert.doesNotThrow(() => m.aoLog({ data: "null" }));
  assert.doesNotThrow(() => m.aoLog({ data: '{"nivel":"info"}' }));   // sem texto
  assert.strictEqual(m.S.snap.log.length, 0, "entrou lixo no log");
});

t("o teto do cliente é o mesmo do servidor — senão uma etapa longa cresce sem fim", () => {
  /* `diz()` no tester.js faz `shift()` acima de 400. A etapa 04 de um agente
     mediu 660s sem nenhum outro evento; sem teto, a aba aberta acumularia. */
  const m = montar();
  m.S.snap = { log: [] };
  for (let i = 0; i < 900; i++) m.aoLog({ data: JSON.stringify({ at: "t" + i, texto: "l" + i, nivel: "info" }) });
  assert.strictEqual(m.S.snap.log.length, 400, "o log do cliente foi a " + m.S.snap.log.length + " linhas");
  assert.strictEqual(m.S.snap.log[0].texto, "l500", "o teto tem que jogar fora as VELHAS, como o `diz()` faz");
  const teto = html.match(/const LOG_TETO\s*=\s*(\d+)/);
  assert.ok(teto, "não achei `LOG_TETO` na página");
  assert.strictEqual(teto[1], "400", "o teto do cliente saiu do teto do `diz()` no servidor");
});

// ══════════════════════════════════ 8. o tamanho do que sobrou
bloco("8. o desperdício que deixou de existir");

t("a assinatura nova é ordens de grandeza mais barata do que o que ela substitui", () => {
  const m = montar();
  const s = { wf: wfDe(65) };
  const N = 2000;
  let t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) m.desenhoAssinatura(s);
  const msAssin = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const chars = m.desenhoAssinatura(s).length;

  m.desenharSeNovo(s);
  const els = m.conta.criados, geo = m.conta.getTotalLength;
  console.log("       assinatura: " + chars + " chars, " + msAssin.toFixed(3) + " ms");
  console.log("       o que ela evita por evento: " + els + " elementos SVG + " + geo + " getTotalLength()");
  assert.ok(msAssin < 2, "a assinatura custou " + msAssin.toFixed(3) + " ms — ela não pode ser o novo gargalo");
  assert.ok(els > 300, "esperava o desenho inteiro, veio " + els + " elementos");
});

t("uma rodada de eventos que não mudam o desenho custa zero", () => {
  const m = montar();
  const s = { wf: wfDe(65) };
  m.desenharSeNovo(s);
  const base = m.conta.criados, baseGeo = m.conta.getTotalLength;
  const EVENTOS = 300;                     // uma construção de verdade emite nessa ordem
  for (let i = 0; i < EVENTOS; i++) { m.repintar(); m.desenharSeNovo(s); }
  console.log("       " + EVENTOS + " repaints → " + (m.conta.criados - base) + " elementos e "
    + (m.conta.getTotalLength - baseGeo) + " getTotalLength() (antes: " + (EVENTOS * base) + " e " + (EVENTOS * baseGeo) + ")");
  assert.strictEqual(m.conta.criados - base, 0);
  assert.strictEqual(m.conta.getTotalLength - baseGeo, 0);
});

t("o agente de verdade, se o diretório da corrida ainda existir", () => {
  /* `.tester-runs/` é descartável e gitignored: num checkout novo isto não
     existe, e o teste diz isso em vez de falhar por um arquivo que ninguém
     prometeu. Os números do relatório vieram daqui. */
  const p = path.join(__dirname, ".tester-runs", "t74ee9813fa57", "workflow.json");
  if (!fs.existsSync(p)) { console.log("       (sem `.tester-runs/t74ee9813fa57` neste checkout — nada a medir)"); return; }
  const wf = JSON.parse(fs.readFileSync(p, "utf8"));
  const m = montar();
  const s = { wf };
  const chars = m.desenhoAssinatura(s).length;
  m.desenharSeNovo(s);
  console.log("       " + wf.nodes.length + " nós reais: assinatura " + chars + " chars · "
    + m.conta.criados + " elementos · " + m.conta.getTotalLength + " getTotalLength()");
  m.repintar();
  assert.strictEqual(m.desenharSeNovo(s), false, "o agente de verdade reconstruiu num repaint sem mudança");
});

// ══════════════════════════════════ 9. a revelação atravessando o repaint
/* Estes quatro são assíncronos porque só existem depois de a revelação ANDAR, e
 * é aí que vive o que nenhum print mostra: ela sobrevive ao repaint agora, então
 * o `#corner` em que ela escreve não é mais o que ela tinha na mão. */
async function ta(nome, fn) {
  try { await fn(); ok++; console.log("  ok   " + nome); }
  catch (err) { falhas++; console.log("  FALHOU  " + nome + "\n         " + (err && err.message)); }
}

(async () => {
  bloco("9. a revelação anda, e o repaint acontece por baixo dela");

  await ta("o contador aparece no `#corner` NOVO depois do repaint", async () => {
    /* Antes, `corner` era capturado no começo da construção. O `innerHTML` do
       primeiro evento do SSE jogava aquele nó fora, e daí em diante a revelação
       escrevia num órfão: o contador congelava em "MONTANDO 1 / n" na tela e
       ninguém veria erro nenhum no console. */
    const m = montar();
    m.desenharSeNovo({ wf: wfDe(6) });
    assert.ok(/MONTANDO 1 \/ 6/.test(m.est.corner.textContent), "início: " + m.est.corner.textContent);
    m.repintar();
    m.desenharSeNovo({ wf: wfDe(6) });                 // caminho de preservação
    await m.avancar(4);
    assert.ok(/MONTANDO/.test(m.est.corner.textContent),
      "o contador não chegou no `#corner` recriado: " + JSON.stringify(m.est.corner.textContent));
    assert.ok(!/MONTANDO 1 \/ 6/.test(m.est.corner.textContent),
      "o contador congelou no primeiro nó: " + m.est.corner.textContent);
  });

  await ta("no fim da revelação entra o rótulo, e `desenhoMontando` cai", async () => {
    const m = montar();
    m.desenharSeNovo({ wf: wfDe(3) });
    await m.avancar(40);
    assert.strictEqual(m.S.desenhoMontando, false, "a revelação terminou e o selo de montagem ficou de pé");
    assert.ok(/CONEXOES/.test(m.est.corner.textContent), "rótulo final: " + m.est.corner.textContent);
  });

  await ta("a revelação de um desenho SUBSTITUÍDO para de escrever no `#corner`", async () => {
    /* Duas revelações podem coexistir agora — a antiga rodando sobre um svg que
       já foi demolido. Sem o selo de geração, as duas escrevem no mesmo
       `#corner`, e o contador do desenho novo salta para trás. */
    const m = montar();
    m.desenharSeNovo({ wf: wfDe(30) });                // revelação A começa
    m.repintar();
    m.desenharSeNovo({ wf: wfDe(4) });                 // documento novo: revelação B
    const marca = m.est.corner.textContent;
    assert.ok(/\/ 4/.test(marca), "a revelação nova devia ter escrito: " + marca);
    await m.avancar(30);                               // solta as esperas das DUAS
    assert.ok(!/\/ 30/.test(m.est.corner.textContent),
      "a revelação velha continuou escrevendo: " + m.est.corner.textContent);
  });

  await ta("depois da revelação, o rótulo preservado ainda volta no repaint", async () => {
    const m = montar();
    m.desenharSeNovo({ wf: wfDe(3) });
    await m.avancar(40);
    const rotulo = m.est.corner.textContent;
    m.repintar();
    m.desenharSeNovo({ wf: wfDe(3) });
    assert.strictEqual(m.est.corner.textContent, rotulo, "o rótulo não voltou depois de a revelação acabar");
  });

  console.log("\n" + (falhas
    ? "FALHOU: " + falhas + " de " + (ok + falhas)
    : "passou: " + ok + " ok, 0 falha(s)"));
  process.exit(falhas ? 1 : 0);
})();
