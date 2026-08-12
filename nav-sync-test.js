/* nav-sync-test.js — a navegação é UM bloco em três arquivos, e este teste é o
 * que impede que ela vire três.
 *
 * O CLAUDE.md documenta a dívida desde que o topbar foi unificado: flows.html,
 * tester.html e cockpit.html carregam cópias do mesmo chrome, e "mudança lá tem
 * que ser repetida aqui" é uma frase que depende de alguém lembrar. Já falhou:
 * um resync inseriu um segundo bloco de avisos no flows.html em vez de
 * substituir o existente, e a página morreu com "Illegal return statement".
 *
 * Aqui a lembrança virou portão. Cada caso rejeita um defeito com nome:
 *   1. o bloco existe nas três páginas;
 *   2. o CSS é BYTE A BYTE igual nas três;
 *   3. o JS é byte a byte igual nas três;
 *   4. nenhuma sobra do .pages antigo ficou pendurada;
 *   5. o bloco aparece UMA vez por arquivo (o defeito do segundo bloco);
 *   6. cada página marca a própria porta como atual — e só ela;
 *   7. as três portas apontam para as três rotas que o server.js serve;
 *   8. o atalho que o chip promete existe no JS.
 *
 * Grátis: sem modelo, sem rede, sem servidor. `node nav-sync-test.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* Os delimitadores são deste teste, de propósito. Se alguém reescrever o bloco e
 * apagar um deles, o teste falha dizendo que não achou o bloco — que é
 * exatamente o aviso que se quer nesse caso, não um silêncio. */
const CSS_INICIO = "NAV — as três portas";
const CSS_FIM = ".nvd .lente.varre::after{animation:none}";
const JS_INICIO = "NAV — a lente de vidro";
const JS_FIM = "}());";

const PAGINAS = [
  { arq: "flows.html", porta: "fluxos" },
  { arq: "tester.html", porta: "tester" },
  { arq: "cockpit.html", porta: "disco" }
];
const ROTAS = { fluxos: "/", disco: "/disco", tester: "/tester" };

let falhas = 0;
const ok = m => console.log("  ok    " + m);
const erro = m => { falhas++; console.log("  FALHA " + m); };

function recorte(txt, inicio, fim, arq, nome) {
  const i = txt.indexOf(inicio);
  if (i < 0) { erro(arq + ": bloco " + nome + " não encontrado (o delimidador «" + inicio + "» sumiu)"); return null; }
  const f = txt.indexOf(fim, i);
  if (f < 0) { erro(arq + ": bloco " + nome + " começa mas não termina («" + fim + "» não veio depois)"); return null; }
  return txt.slice(i, f + fim.length);
}

const textos = new Map();
for (const p of PAGINAS) {
  const alvo = path.join(__dirname, p.arq);
  if (!fs.existsSync(alvo)) { erro(p.arq + ": arquivo não existe"); continue; }
  textos.set(p.arq, fs.readFileSync(alvo, "utf8"));
}

console.log("\n1. o bloco existe nas três páginas");
const blocos = { css: new Map(), js: new Map() };
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const c = recorte(txt, CSS_INICIO, CSS_FIM, p.arq, "CSS");
  const j = recorte(txt, JS_INICIO, JS_FIM, p.arq, "JS");
  if (c) blocos.css.set(p.arq, c);
  if (j) blocos.js.set(p.arq, j);
  if (c && j) ok(p.arq + ": CSS " + c.length + " bytes, JS " + j.length + " bytes");
}

/* Comparar contra a PRIMEIRA página e nomear a divergência pelo primeiro byte
 * diferente: "os blocos diferem" manda procurar em 4 KB de CSS; "diferem no
 * byte 1832" abre o editor no lugar. */
function comparar(rotulo, mapa) {
  const nomes = [...mapa.keys()];
  if (nomes.length < 2) { erro(rotulo + ": menos de duas páginas para comparar"); return; }
  const ref = mapa.get(nomes[0]);
  for (const n of nomes.slice(1)) {
    const outro = mapa.get(n);
    if (outro === ref) { ok(rotulo + ": " + n + " idêntico a " + nomes[0]); continue; }
    let i = 0;
    while (i < Math.min(ref.length, outro.length) && ref[i] === outro[i]) i++;
    erro(rotulo + ": " + n + " difere de " + nomes[0] + " no byte " + i
      + " — «" + ref.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, "\\n") + "»"
      + " contra «" + outro.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, "\\n") + "»"
      + ". Rode: node preview/aplicar-nav.js");
  }
}

console.log("\n2. o CSS é byte a byte igual nas três");
comparar("CSS", blocos.css);

console.log("\n3. o JS é byte a byte igual nas três");
comparar("JS", blocos.js);

console.log("\n4. nenhuma sobra do .pages antigo");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  if (/\.pages\b|class="pages"/.test(txt)) erro(p.arq + ": ainda tem .pages — a navegação antiga ficou pendurada");
  else ok(p.arq + ": limpo");
}

console.log("\n5. o bloco aparece UMA vez por arquivo");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const conta = s => txt.split(s).length - 1;
  const c = conta(CSS_INICIO), j = conta(JS_INICIO), n = conta('class="nvd"');
  if (c === 1 && j === 1 && n === 1) ok(p.arq + ": um CSS, um JS, um <nav>");
  else erro(p.arq + ": bloco duplicado — CSS ×" + c + ", JS ×" + j + ", nav ×" + n
    + ". Um resync tem que SUBSTITUIR o bloco, nunca inserir um segundo");
}

console.log("\n6. cada página marca a própria porta, e só ela");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const nav = txt.slice(txt.indexOf('<nav class="nvd"'), txt.indexOf("</nav>", txt.indexOf('<nav class="nvd"')));
  const marcadas = [...nav.matchAll(/data-porta="([a-z]+)"([^>]*)>/g)]
    .filter(m => /aria-current="page"/.test(m[2])).map(m => m[1]);
  if (marcadas.length === 1 && marcadas[0] === p.porta) ok(p.arq + ": porta «" + p.porta + "»");
  else erro(p.arq + ": esperava só «" + p.porta + "» marcada, veio [" + marcadas.join(", ") + "]");
}

console.log("\n7. as três portas apontam para as rotas que o server.js serve");
const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const nav = txt.slice(txt.indexOf('<nav class="nvd"'), txt.indexOf("</nav>", txt.indexOf('<nav class="nvd"')));
  let bom = true;
  for (const [porta, rota] of Object.entries(ROTAS)) {
    const re = new RegExp('href="' + rota.replace("/", "\\/") + '" data-porta="' + porta + '"');
    if (!re.test(nav)) { erro(p.arq + ": a porta «" + porta + "» não aponta para " + rota); bom = false; }
  }
  if (bom) ok(p.arq + ": /, /disco, /tester");
}
// A rota tem que existir do outro lado. Um href para uma rota que o servidor não
// serve é um 404 que só aparece no clique.
for (const rota of ["/disco", "/tester"]) {
  if (server.includes('"' + rota + '"')) ok("server.js serve " + rota);
  else erro("server.js NÃO serve " + rota + " — o href levaria a 404");
}

console.log("\n8. o atalho que o chip promete existe");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const temChip = /<kbd>alt [123]<\/kbd>/.test(txt);
  const temTecla = /ev\.altKey/.test(txt) && /location\.href/.test(txt);
  if (temChip && temTecla) ok(p.arq + ": chip e tecla");
  else erro(p.arq + ": chip=" + temChip + " tecla=" + temTecla
    + " — um rótulo prometendo atalho que não funciona é pior que nenhum rótulo");
}

console.log("");
if (falhas) { console.log("FALHOU: " + falhas + " problema(s)"); process.exit(1); }
console.log("passou: a navegação é um bloco só, nas três páginas");
