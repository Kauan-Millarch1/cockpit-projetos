/* atualizar-nav.js — reescreve o bloco de navegação nas páginas que JÁ o têm.
 *
 * `aplicar-nav.js` é migração de mão única: ele converte uma página que ainda
 * carrega o `.pages` antigo e recusa rodar de novo ("a cápsula já está neste
 * texto"). Isso foi correto enquanto a cápsula era escrita uma vez. Quando a
 * quarta porta entrou, não havia caminho para ATUALIZAR as três páginas que já
 * a tinham — e editar uma só é exatamente o que `nav-sync-test.js` existe para
 * proibir.
 *
 * Este arquivo troca as três regiões geradas, achadas por âncora:
 *   1. o bloco CSS  — do banner "NAV — as ... portas" até o fim do @media
 *   2. a marcação   — <nav class="nvd"> … </nav>
 *   3. o bloco JS   — do banner "NAV — a lente de vidro" até `}());</script>`
 *
 * Cada troca exige EXATAMENTE uma ocorrência. Duas seria o defeito que já
 * aconteceu aqui uma vez: o rabo de um bloco antigo pendurado no flows.html, e a
 * página morrendo com "Illegal return statement".
 *
 *   node preview/atualizar-nav.js
 *   node nav-sync-test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { CSS, JS, marcacao, ALVOS } = require("./aplicar-nav.js");

const RAIZ = path.join(__dirname, "..");

/* A região CSS antiga, extraída do arquivo. O banner mudou de "três" para
   "quatro" portas, então a âncora de início casa o número em vez de assumi-lo.
   `\w` NÃO serve aqui: "três" tem `ê`, que está fora da classe, e a âncora
   falhava dizendo que não achou o bloco — erro que aponta para o arquivo errado. */
const CSS_INI = /\/\* ═+ NAV — as [^\n]+? portas/;
const CSS_FIM = ".nvd .lente.varre::after{animation:none}\n}";
const JS_INI = "/* ═══════════════════════════════════════════════════ NAV — a lente de vidro";
const JS_FIM = "}());\n</script>";

function trocarUm(txt, arq, ini, fim, novo, oque) {
  const i = typeof ini === "string" ? txt.indexOf(ini) : (txt.match(ini) || {}).index;
  if (i == null || i < 0) throw new Error(arq + ": não achei o início de " + oque);
  const j = txt.indexOf(fim, i);
  if (j < 0) throw new Error(arq + ": não achei o fim de " + oque);
  const resto = txt.slice(j + fim.length);
  const dupe = typeof ini === "string" ? resto.indexOf(ini) : (resto.match(ini) || {}).index;
  if (dupe != null && dupe >= 0) throw new Error(arq + ": " + oque + " aparece DUAS vezes — nunca insira um segundo bloco");
  return txt.slice(0, i) + novo + resto;
}

function atualizar(txt, arq, porta) {
  // 1. CSS
  txt = trocarUm(txt, arq, CSS_INI, CSS_FIM, CSS, "o bloco CSS da navegação");

  // 2. marcação — a página nova traz um marcador em vez de um <nav>
  if (txt.includes("<!--__NAV__-->")) {
    txt = txt.replace("<!--__NAV__-->", () => marcacao(porta));
  } else {
    const i = txt.indexOf('<nav class="nvd"');
    if (i < 0) throw new Error(arq + ': não achei <nav class="nvd">');
    const f = txt.indexOf("</nav>", i);
    if (f < 0) throw new Error(arq + ": não achei o </nav> da navegação");
    if (txt.indexOf('<nav class="nvd"', f) >= 0) throw new Error(arq + ": duas navegações no arquivo");
    txt = txt.slice(0, i) + marcacao(porta) + txt.slice(f + 6);
  }

  // 3. JS
  if (txt.includes("<!--__NAVJS__-->")) {
    txt = txt.replace("<!--__NAVJS__-->", () => JS);
  } else {
    txt = trocarUm(txt, arq, JS_INI, JS_FIM, JS.replace(/^<script>\n/, "").replace(/<\/script>$/, "") + "</script>",
      "o bloco JS da navegação");
  }
  return txt;
}

module.exports = { atualizar };

if (require.main === module) {
  for (const t of ALVOS) {
    const p = path.join(RAIZ, t.arq);
    const antes = fs.readFileSync(p, "utf8");
    const depois = atualizar(antes, t.arq, t.porta);
    fs.writeFileSync(p, depois, "utf8");
    console.log("atualizado: " + t.arq + "  (porta " + t.porta + ")  " + antes.length + " -> " + depois.length);
  }
  console.log("\nrode: node nav-sync-test.js");
}
