/* palco-test.js — o nó do palco é preservado entre repaints, e o que decide
 * reconstruir é o que o desenho MOSTRA, nunca a atividade.
 *
 * Por que este arquivo existe: medido no fluxo do Iago, o palco são 184 nós e 220
 * arestas, que viram 97KB de string e 1.140 elementos SVG. `render()` do
 * `upgrade.html` reescreve o `#app` a cada evento do SSE, e uma rodada emite
 * `atividade` várias vezes por segundo. Enquanto o palco morava na string de
 * `telaFluxo()`, cada um desses eventos remontava os 97KB e religava sete
 * listeners. Chegar nessa tela de verdade custa uma conversa de modelo e minutos;
 * o defeito que este teste recusa é invisível num print.
 *
 * As funções são EXTRAÍDAS de `upgrade.html` em tempo de execução — reimplementar
 * a decisão aqui provaria a cópia, não a página. Mesma disciplina de
 * `audio-test.js` e `dossie-tela-test.js`.
 *
 * O DOM é dublê. Não há como parsear HTML sem dependência, e não é isso que está
 * sendo testado: o que está em jogo é a DECISÃO de reconstruir, a identidade do nó
 * entre repaints, e o religamento da câmera. O desenho de verdade se confere no
 * navegador.
 *
 * De graça: sem modelo, sem rede, sem servidor, nada escrito em disco.
 *   node palco-test.js */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const PAG = path.join(__dirname, "upgrade.html");
const html = fs.readFileSync(PAG, "utf8");

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (err) { falhas++; console.log("  FALHOU  " + nome + "\n         " + (err && err.message)); }
}
function bloco(nome) { console.log("\n" + nome); }

/* Fonte sem comentário. A lição é de `dossie-tela-test.js`: um `includes` que
 * casa DENTRO de um comentário aprova a documentação de uma decisão em vez da
 * decisão, e no pior caso aprova a ausência dela. Aqui é literal: os comentários
 * que escrevi citam `pintarPalco`, `montarCamera` e `palco(` várias vezes. */
function semComentario(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");
}

/* Recorta uma função declarada, contando chaves a partir da assinatura. */
function recortar(src, assinatura) {
  const i = src.indexOf(assinatura);
  assert.ok(i >= 0, "não achei `" + assinatura + "` em upgrade.html");
  let j = src.indexOf("{", i), n = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") n++;
    else if (src[k] === "}") { n--; if (!n) return src.slice(i, k + 1); }
  }
  throw new Error("chaves não fecham em " + assinatura);
}

const FONTE_ASSIN = (() => {
  const i = html.indexOf("const palcoAssinatura = f => JSON.stringify([");
  assert.ok(i >= 0, "não achei `palcoAssinatura` em upgrade.html");
  const fim = html.indexOf("]);", i);
  assert.ok(fim > i, "`palcoAssinatura` não fecha");
  return html.slice(i, fim + 3);
})();
const FONTE_PINTAR = recortar(html, "function pintarPalco(f)");

/* ---------------------------------------------------------------- o dublê
 *
 * `palco()` devolve uma string; conta quantas vezes foi chamada, que é a medida
 * inteira deste arquivo. `createElement` devolve uma casca cujo `innerHTML`
 * fabrica UM filho com identidade própria. */
function montar() {
  const conta = { palco: 0, criados: 0 };
  const host = { id: "palco-host", filhos: [], appendChild(n) { n.parentNode = host; host.filhos.push(n); } };

  const doc = {
    _host: host,
    getElementById(id) { return id === "palco-host" ? doc._host : null; },
    createElement() {
      const casca = { firstElementChild: null };
      Object.defineProperty(casca, "innerHTML", {
        set(s) {
          conta.criados++;
          casca.firstElementChild = { tag: "div", cls: "palco-box", html: String(s), parentNode: null, serie: conta.criados };
        },
        get() { return casca.firstElementChild ? casca.firstElementChild.html : ""; }
      });
      return casca;
    }
  };

  const S = { sel: "wf1", palcoEl: null, palcoAssin: null, palcoGrafo: null };
  const est = { acesos: [], falhos: [] };
  const grafoDe = (nos, arestas) => ({ nos: Array.from({ length: nos }, (_, i) => ({ nome: "n" + i })),
                                        arestas: Array.from({ length: arestas }, () => ({})) });

  const escopo = {
    S, document: doc,
    palco: () => { conta.palco++; return '<div class="palco-box">svg</div>'; },
    nosAcesos: () => new Set(est.acesos),
    nosFalhos: () => new Set(est.falhos)
  };

  const nomes = Object.keys(escopo);
  const corpo = FONTE_ASSIN + "\n" + FONTE_PINTAR + "\nreturn { palcoAssinatura, pintarPalco };";
  const fab = new Function(...nomes, corpo);
  const api = fab(...nomes.map(n => escopo[n]));

  return { ...api, S, conta, est, host, doc, grafoDe };
}

// ------------------------------------------------ 1. reconstruir só quando muda
bloco("1. o que decide reconstruir é o que o desenho mostra");

t("a primeira pintura constrói e anexa", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  assert.strictEqual(m.pintarPalco(f), true, "sem nó, tem que construir");
  assert.strictEqual(m.conta.palco, 1);
  assert.strictEqual(m.host.filhos.length, 1);
  assert.strictEqual(m.S.palcoEl.parentNode, m.host);
});

t("repaint sem mudança nenhuma NÃO reconstrói — e é o caso comum", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  const primeiro = m.S.palcoEl;
  for (let i = 0; i < 40; i++) assert.strictEqual(m.pintarPalco(f), false, "repaint " + i + " reconstruiu");
  assert.strictEqual(m.conta.palco, 1, "`palco()` devia ter sido chamado uma vez só, veio " + m.conta.palco);
  assert.strictEqual(m.S.palcoEl, primeiro, "o nó tem que ser o MESMO objeto, não um igual");
});

t("evento de `atividade` não muda um pixel do palco, então não custa um elemento", () => {
  /* `atividade` chega várias vezes por segundo e não entra na assinatura. Simular
     é exatamente isto: repintar sem tocar em alvo, falhos ou grafo. */
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  const antes = m.conta.palco;
  for (let i = 0; i < 200; i++) m.pintarPalco(f);
  assert.strictEqual(m.conta.palco, antes, "200 eventos de atividade custaram " + (m.conta.palco - antes) + " reconstruções");
});

t("alvo NOVO reconstrói: é o que o desenho mostra", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  m.est.acesos = ["n7"];
  assert.strictEqual(m.pintarPalco(f), true, "acender um nó tem que reconstruir");
  assert.strictEqual(m.conta.palco, 2);
});

t("a ORDEM dos nós acesos não conta como mudança", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.est.acesos = ["n7", "n3"];
  m.pintarPalco(f);
  m.est.acesos = ["n3", "n7"];
  assert.strictEqual(m.pintarPalco(f), false, "o mesmo conjunto em outra ordem não é um alvo novo");
});

t("nó falho novo reconstrói", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  m.est.falhos = ["n2"];
  assert.strictEqual(m.pintarPalco(f), true);
});

t("trocar de fluxo reconstrói", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  m.S.sel = "wf2";
  assert.strictEqual(m.pintarPalco(f), true);
});

// --------------------------------------------- 2. a identidade do grafo, à parte
bloco("2. a identidade do grafo é comparada à parte das contagens");

t("grafo DIFERENTE com as MESMAS contagens reconstrói", () => {
  /* Este é o caso que a assinatura sozinha não pega: 184 nós e 220 arestas em dois
     grafos diferentes produzem a mesma assinatura. Um fluxo relido com um nó
     renomeado cai exatamente aqui, e sem a comparação de objeto a tela seguiria
     mostrando o desenho antigo — que é pior do que redesenhar, porque parece
     certo. */
  const m = montar();
  const a = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(a);
  const b = { graph: m.grafoDe(184, 220) };
  assert.strictEqual(m.pintarPalco(b), true, "outro objeto de grafo tem que reconstruir");
  assert.strictEqual(m.conta.palco, 2);
});

t("o MESMO objeto de grafo não reconstrói", () => {
  const m = montar();
  const g = m.grafoDe(184, 220);
  m.pintarPalco({ graph: g });
  assert.strictEqual(m.pintarPalco({ graph: g }), false, "outro `f` com o mesmo grafo é o mesmo desenho");
});

t("mudar a contagem de arestas reconstrói mesmo com os nós iguais", () => {
  const m = montar();
  m.pintarPalco({ graph: m.grafoDe(184, 220) });
  const g = m.grafoDe(184, 221);
  assert.strictEqual(m.pintarPalco({ graph: g }), true);
});

t("fluxo sem grafo não explode", () => {
  const m = montar();
  assert.strictEqual(m.pintarPalco({ graph: null }), true);
  assert.strictEqual(m.pintarPalco({ graph: null }), false);
  assert.doesNotThrow(() => m.pintarPalco(null));
});

// ------------------------------------------------ 3. sair e voltar, e re-anexar
bloco("3. o nó atravessa o repaint, e a vitrine solta ele");

t("o `innerHTML` do render desanexa, e `pintarPalco` re-anexa SEM reconstruir", () => {
  /* É isto que `render()` faz: `app.innerHTML = …` cria um hospedeiro NOVO e
     órfã o nó antigo. O nó sobrevive porque `S.palcoEl` o segura. */
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  const no = m.S.palcoEl;

  m.doc._host = { id: "palco-host", filhos: [], appendChild(n) { n.parentNode = m.doc._host; m.doc._host.filhos.push(n); } };
  assert.strictEqual(m.pintarPalco(f), false, "hospedeiro novo não é desenho novo");
  assert.strictEqual(m.S.palcoEl, no, "tem que ser o mesmo nó");
  assert.strictEqual(m.doc._host.filhos.length, 1, "e tem que estar anexado no hospedeiro novo");
  assert.strictEqual(m.conta.palco, 1);
});

t("anexar não duplica: o nó já no hospedeiro certo não é re-anexado", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  for (let i = 0; i < 10; i++) m.pintarPalco(f);
  assert.strictEqual(m.host.filhos.length, 1, "o nó apareceu " + m.host.filhos.length + " vezes no hospedeiro");
});

t("sem hospedeiro (vitrine) o estado é solto, e voltar reconstrói", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  m.doc._host = null;
  assert.strictEqual(m.pintarPalco(f), false, "na vitrine não há palco para pintar");
  assert.strictEqual(m.S.palcoEl, null, "o nó tem que ser solto: `S.fluxos` pode ser relido enquanto se olha a vitrine");
  m.doc._host = m.host;
  assert.strictEqual(m.pintarPalco(f), true, "voltar para o fluxo tem que reconstruir");
});

// --------------------------------------------- 4. a fiação da câmera na página
bloco("4. a câmera só é remontada quando o nó é novo");

const SRC = semComentario(html);

t("`render()` chama `montarCamera()` SÓ quando `pintarPalco` reconstruiu", () => {
  /* Com o nó preservado, os sete listeners do SVG e o `ResizeObserver`
     sobrevivem nele. Remontar a câmera os DUPLICARIA — um arraste andaria o
     dobro, e o zoom da roda saltaria dois passos. */
  assert.ok(/if\s*\(\s*pintarPalco\(f\)\s*\)\s*montarCamera\(\)/.test(SRC),
    "esperava `if (pintarPalco(f)) montarCamera()` no render");
  // `function montarCamera()` também casa com `montarCamera()`: a declaração não
  // é uma chamada, e contá-la fazia este teste falhar por um defeito dele.
  const chamadas = (SRC.match(/(?<!function\s)montarCamera\(\)/g) || []).length;
  assert.strictEqual(chamadas, 1, "há " + chamadas + " chamada(s) a montarCamera(); só a do render, guardada, pode existir");
});

t("`pintarPalco` roda ANTES de `montarCamera` na mesma linha de decisão", () => {
  /* `extentoAcesos()` lê `.pn.on` do DOM para voar até o alvo: o desenho tem de
     estar anexado antes. Na expressão guardada isso é garantido pela ordem de
     avaliação, e é isso que o formato acima assegura. */
  const i = SRC.indexOf("pintarPalco(f)");
  const j = SRC.indexOf("montarCamera()", i);
  assert.ok(i >= 0 && j > i, "montarCamera() não pode ser avaliado antes de pintarPalco(f)");
});

t("`telaFluxo` NÃO monta o palco na string", () => {
  const tela = semComentario(recortar(html, "function telaFluxo(f)"));
  assert.ok(!/[^a-zA-Z]palco\(/.test(tela),
    "o palco voltou para dentro da string de telaFluxo: o nó deixa de ser preservado e o ganho todo se perde");
  assert.ok(/palco-host/.test(tela), "telaFluxo tem que deixar o hospedeiro onde o palco entra");
});

t("`telaFluxo` continua declarada com a assinatura exata que outro teste recorta", () => {
  // `conversas-test.js` usa a string literal `function telaFluxo(f)` como
  // delimitador. Mudar a assinatura quebra aquele teste sem quebrar a página.
  assert.ok(html.includes("function telaFluxo(f)"));
});

t("o hospedeiro é `display: contents` — senão a caixa do desenho desaba", () => {
  /* `.palco-box` é `flex: 1 1 auto` dentro da `.col-desenho`, que é flex-column.
     Um wrapper normal viraria ele o item flexível e a caixa iria para a altura do
     conteúdo: o desenho sumiria da tela. */
  assert.ok(/\.palco-host\s*\{[^}]*display:\s*contents/.test(html),
    "sem `display: contents` no `.palco-host`, o `flex: 1 1 auto` do `.palco-box` para de valer");
  assert.ok(/\.palco-box\s*\{[^}]*flex:\s*1 1 auto/.test(html),
    "esta é a premissa do teste acima; se `.palco-box` deixou de ser flexível, releia a regra");
});

// --------------------------------------------------- 5. o tamanho do que sobrou
bloco("5. o desperdício que deixou de existir");

t("um repaint de atividade custava o palco inteiro, e agora custa zero", () => {
  const m = montar();
  const f = { graph: m.grafoDe(184, 220) };
  m.pintarPalco(f);
  const base = m.conta.palco;
  const EVENTOS = 300;            // uma rodada de verdade emite nessa ordem
  for (let i = 0; i < EVENTOS; i++) m.pintarPalco(f);
  const construcoes = m.conta.palco - base;
  console.log("       " + EVENTOS + " eventos de atividade → " + construcoes + " construções do palco (antes: " + EVENTOS + ")");
  assert.strictEqual(construcoes, 0);
});

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + (ok + falhas)
  : "passou: " + ok + " ok, 0 falha(s)"));
process.exit(falhas ? 1 : 0);
