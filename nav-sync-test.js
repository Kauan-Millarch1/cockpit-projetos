/* nav-sync-test.js — a navegação é UM bloco em cinco arquivos, e este teste é o
 * que impede que ela vire cinco.
 *
 * O CLAUDE.md documenta a dívida desde que o topbar foi unificado: flows.html,
 * tester.html e cockpit.html carregam cópias do mesmo chrome, e "mudança lá tem
 * que ser repetida aqui" é uma frase que depende de alguém lembrar. Já falhou:
 * um resync inseriu um segundo bloco de avisos no flows.html em vez de
 * substituir o existente, e a página morreu com "Illegal return statement".
 *
 * Aqui a lembrança virou portão. Cada caso rejeita um defeito com nome:
 *   1. o bloco existe nas páginas testadas;
 *   2. o CSS é BYTE A BYTE igual em todas;
 *   3. o JS é byte a byte igual em todas;
 *   4. nenhuma sobra do .pages antigo ficou pendurada;
 *   5. o bloco aparece UMA vez por arquivo (o defeito do segundo bloco);
 *   6. cada página marca a própria porta como atual — e só ela;
 *   7. as cinco portas apontam para as rotas que o server.js serve;
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
const CSS_INICIO = "NAV — as cinco portas";
const CSS_FIM = ".nvd .lente.varre::after{animation:none}";
const JS_INICIO = "NAV — a lente de vidro";
const JS_FIM = "}());";

const PAGINAS = [
  { arq: "flows.html", porta: "fluxos" },
  { arq: "tester.html", porta: "tester" },
  { arq: "cockpit.html", porta: "disco" },
  { arq: "upgrade.html", porta: "upgrade" },
  { arq: "entrar.html", porta: "conta" }
];
const ROTAS = { fluxos: "/", disco: "/disco", tester: "/tester", upgrade: "/upgrade", conta: "/conta" };

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

console.log("\n1. o bloco existe nas páginas testadas");
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

console.log("\n2. o CSS é byte a byte igual nas quatro");
comparar("CSS", blocos.css);

console.log("\n3. o JS é byte a byte igual em todas");
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

console.log("\n7. as cinco portas apontam para as rotas que o server.js serve");
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
  if (bom) ok(p.arq + ": todas as rotas servidas");
}
// A rota tem que existir do outro lado. Um href para uma rota que o servidor não
// serve é um 404 que só aparece no clique.
for (const rota of ["/disco", "/tester", "/upgrade", "/conta"]) {
  if (server.includes('"' + rota + '"')) ok("server.js serve " + rota);
  else erro("server.js NÃO serve " + rota + " — o href levaria a 404");
}

console.log("\n8. o atalho que o chip promete existe");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  /* APERTADO em 25/08/2026, porque a versão frouxa aprovou um defeito vivo. Ela
     perguntava se existia ALGUM chip `alt [123]` e se o handler existia — e com
     QUATRO portas, cada uma com o seu chip, o handler lia `"123".indexOf(...)`.
     `alt 4` nunca funcionou, o rótulo prometia que sim, e este caso ficou verde
     o tempo todo. Agora ele compara os dois conjuntos: todo chip prometido tem
     que estar nos dígitos que o handler aceita, e todo dígito aceito tem que ter
     uma porta atrás. */
  const chips = [...txt.matchAll(/<kbd>alt (\d)<\/kbd>/g)].map(m => m[1]);
  const mDig = /"(\d+)"\.indexOf\(ev\.key\)/.exec(txt);
  const digitos = mDig ? mDig[1].split("") : [];
  const portas = (txt.match(/data-porta="/g) || []).length;
  const temTecla = /ev\.altKey/.test(txt) && /location\.href/.test(txt);
  const semAtalho = chips.filter(c => !digitos.includes(c));
  const semPorta = digitos.filter(d => Number(d) > portas);
  if (temTecla && chips.length && !semAtalho.length && !semPorta.length) {
    ok(p.arq + ": " + chips.length + " chip(s), todos com tecla");
  } else {
    erro(p.arq + ": chips=[" + chips + "] digitos=[" + digitos + "] portas=" + portas
      + " tecla=" + temTecla
      + (semAtalho.length ? " — prometem atalho e não têm: alt " + semAtalho.join(", alt ") : "")
      + (semPorta.length ? " — aceitam dígito sem porta: " + semPorta.join(", ") : "")
      + " — um rótulo prometendo atalho que não funciona é pior que nenhum rótulo");
  }
}

console.log("\n9. a lente não bloqueia o boot nem lê geometria demais");
/* Medido no navegador, e é o custo de JS nº 1 no boot de duas destas telas:
   `assentar()` lendo `offsetLeft` durante a execução do script ANTECIPA o primeiro
   layout do documento e o torna síncrono — **209 ms de thread bloqueada no
   `/disco`**, 126 ms no `/tester`. O `/upgrade`, com o dobro do CSS, custava 0 ms
   no mesmo ponto: a diferença é só QUANDO o script corre. Depois de adiar a
   partida para depois da primeira pintura: 0,1 ms.

   E no hover eram 4 leituras de geometria por quadro (~17 fps, 8,7 no `/`), porque
   `a.offsetLeft` era lido de novo numa linha onde `ax` já era ele. Depois: 0,5–0,8
   leituras por quadro, 55–65 fps. */
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const semComent = txt.replace(/\/\*[\s\S]*?\*\//g, " ");
  const adiada = /requestAnimationFrame\(function \(\) \{ requestAnimationFrame\(partir\); \}\)/.test(semComent);
  // A lente nasce invisível e só aparece posicionada: sem isto, adiar a partida
  // troca 209 ms de bloqueio por um quadro de lente no lugar errado.
  const nasceInvisivel = /\.nvd \.lente\{[^}]*opacity:0/.test(txt);
  const revela = /\.nvd \.lente\.pronta\{opacity:1\}/.test(txt) && /classList\.add\("pronta"\)/.test(semComent);
  // A leitura duplicada: `a.offsetLeft` dentro da linha do ímã.
  const semLeituraDupla = !/h\.offsetLeft > a\.offsetLeft/.test(semComent);
  if (adiada && nasceInvisivel && revela && semLeituraDupla) ok(p.arq + ": partida adiada, lente revelada, sem leitura duplicada");
  else erro(p.arq + ": adiada=" + adiada + " invisivel=" + nasceInvisivel
    + " revela=" + revela + " semLeituraDupla=" + semLeituraDupla);
}
/* O gerador tem de concordar com as páginas. Ele é migração de mão única
   (`transformar()` lança se a cápsula já está no texto), então a única forma de
   manter o bloco sincronizado é aplicar a mesma troca aos cinco arquivos — e este
   caso é o que percebe se alguém mexeu só de um lado. */
{
  let g = null;
  try { g = fs.readFileSync(path.join(__dirname, "preview", "aplicar-nav.js"), "utf8"); } catch { g = null; }
  if (!g) erro("não achei preview/aplicar-nav.js");
  else {
    const semComent = g.replace(/\/\*[\s\S]*?\*\//g, " ");
    const bate = /requestAnimationFrame\(partir\)/.test(semComent)
      && /\.nvd \.lente\.pronta\{opacity:1\}/.test(g)
      && !/h\.offsetLeft > a\.offsetLeft/.test(semComent);
    if (bate) ok("preview/aplicar-nav.js: o gerador tem as mesmas três mudanças");
    else erro("preview/aplicar-nav.js DIVERGIU das páginas — uma regeneração futura desfaria a correção");
  }
}

console.log("");
if (falhas) { console.log("FALHOU: " + falhas + " problema(s)"); process.exit(1); }
console.log("passou: a navegação é um bloco só, nas páginas testadas");
