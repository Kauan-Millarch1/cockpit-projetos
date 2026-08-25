/* aplicar-nav-em-conta.js — leva a cápsula para `entrar.html`, byte a byte.
 *
 * Uma aba de que não se sai não é uma aba. A `entrar.html` nasceu como tela
 * solta (a pessoa chega deslogada, não há para onde ir), e virou a quinta porta
 * — então precisa do mesmo bloco que as outras cinco páginas carregam.
 *
 * Copiar à mão seria a sexta cópia de um bloco que o `nav-sync-test.js` existe
 * para manter idêntico, e o defeito que ele pega já aconteceu: um resync
 * inseriu um segundo bloco no flows.html em vez de substituir, e a página morreu
 * com "Illegal return statement". Aqui o bloco é EXTRAÍDO do upgrade.html na
 * hora, nunca redigitado.
 *
 * `node preview/aplicar-nav-em-conta.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const PAGINAS = ["flows.html", "tester.html", "cockpit.html", "upgrade.html", "integracoes.html"];

/* O comentário DENTRO do bloco também dizia "quatro". Um bloco compartilhado que
   se descreve errado é a mesma classe de defeito que este repositório já
   documenta: prosa afirmando uma invariante que o código ao lado contradiz. */
for (const arq of [...PAGINAS, path.join("preview", "aplicar-nav.js")]) {
  const alvo = path.join(RAIZ, arq);
  let t = fs.readFileSync(alvo, "utf8");
  const antes = t;
  t = t.replace(/As quatro portas são navegação DE VERDADE/g, "As cinco portas são navegação DE VERDADE");
  t = t.replace(/Idêntico em flows\.html, tester\.html, cockpit\.html e upgrade\.html,/g,
                "Idêntico em flows.html, tester.html, cockpit.html, upgrade.html e entrar.html,");
  if (t !== antes) { fs.writeFileSync(alvo, t); console.log("  " + arq.padEnd(24) + "comentário do bloco alinhado"); }
}

/* ─────────────────────────────────────── extrai do upgrade.html, não redigita */

const up = fs.readFileSync(path.join(RAIZ, "upgrade.html"), "utf8");

function blocoDe(txt, marca, fim) {
  const m = txt.indexOf(marca);
  if (m < 0) throw new Error("marca não encontrada: " + marca);
  /* Volta até o `/*` que abre o comentário do bloco — é ele que o
     `nav-sync-test.js` usa como início, e cortar depois dele deixaria um
     comentário órfão. */
  const abre = txt.lastIndexOf("/*", m);
  const f = txt.indexOf(fim, m);
  if (f < 0) throw new Error("fim não encontrado depois de " + marca);
  return txt.slice(abre, f + fim.length);
}

const CSS = blocoDe(up, "NAV — as cinco portas", ".nvd .lente.varre::after{animation:none}");
const JS = blocoDe(up, "NAV — a lente de vidro", "}());");

const a = up.indexOf('<nav class="nvd"');
const b = up.indexOf("</nav>", a) + "</nav>".length;
/* `aria-current` sai daqui e entra na porta `conta`: cada página marca a
   própria porta, e SÓ ela — é o caso 6 do teste. */
const NAV = up.slice(a, b)
  .replace(/ aria-current="page"/g, "")
  .replace('data-porta="conta"', 'data-porta="conta" aria-current="page"');

/* ─────────────────────────────────────────────────────── escreve na entrar.html */

const alvo = path.join(RAIZ, "entrar.html");
let t = fs.readFileSync(alvo, "utf8");

if (t.includes('<nav class="nvd"')) {
  console.log("\n  entrar.html já tem a cápsula — nada a fazer.");
  process.exit(0);
}

/* CSS: antes do `</style>`. */
t = t.replace("</style>", CSS + "\n</style>");

/* Markup: logo depois do separador que segue a marca, que é onde as outras
   páginas põem. */
const ancora = '</div>\n  <div class="sep"></div>\n  <div class="lbl meta" id="quem">';
if (!t.includes(ancora)) throw new Error("âncora do topbar não encontrada em entrar.html");
t = t.replace(ancora, '</div>\n  <div class="sep"></div>\n  ' + NAV + '\n  <div class="sep"></div>\n  <div class="lbl meta" id="quem">');

/* JS: num `<script>` próprio, ANTES do script da página. A cápsula não depende
   de nada da página, e a página não depende dela — mas o bloco lê `offsetLeft`
   em dois `requestAnimationFrame`, e pôr depois não muda isso. */
t = t.replace('<main class="plate" id="app"></main>',
  '<main class="plate" id="app"></main>\n<script>\n' + JS + '\n</script>');

fs.writeFileSync(alvo, t);
console.log("\n  entrar.html: CSS (" + CSS.length + "), markup (" + NAV.length + ") e JS (" + JS.length + ") inseridos.");
