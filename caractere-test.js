/* caractere-test.js — nenhum caractere de controle nos arquivos que são servidos.
 *
 * Existe por causa de um bug que não deixou rastro nenhum: `nodeOrigin` montava a
 * chave de cache com um U+0000 literal onde devia haver um espaço, e `ensureLocate`
 * montava a mesma chave com um espaço de verdade. As duas nunca casavam,
 * `Map.get` devolvia `undefined` para sempre, e a atribuição do nó ficava errada na
 * tela — sem erro, sem aviso, sem nada no console. Um segundo caso tinha U+001F.
 *
 * O byte invisível é o pior tipo de defeito: tudo parece certo e nada funciona.
 * Este teste é a rede.
 *
 * Uso: node caractere-test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* Tudo que é servido ao browser ou executado no servidor. Um `.md` de
 * conhecimento entra também: ele é injetado em prompt, e um byte de controle no
 * meio de um prompt é exatamente igual de invisível. */
const ARQUIVOS = [
  "flows.html", "cockpit.html", "tester.html",
  "server.js", "n8n.js", "claude-fix.js", "tester.js", "simulate.js", "catalog.js", "agentes.js",
  "tester-agentes.md", "CLAUDE.md"
];

/* Tab, LF e CR são texto legítimo. O resto do bloco C0, o DEL e o bloco C1 não
 * têm por que existir num arquivo destes. */
const permitido = c => c === 0x09 || c === 0x0a || c === 0x0d;
const suspeito = c => (c < 0x20 && !permitido(c)) || c === 0x7f || (c >= 0x80 && c <= 0x9f);

let falhas = 0, lidos = 0;

for (const rel of ARQUIVOS) {
  const p = path.join(__dirname, rel);
  let texto;
  try { texto = fs.readFileSync(p, "utf8"); }
  catch { console.log("  (ausente) " + rel); continue; }
  lidos++;

  const achados = [];
  let linha = 1, col = 1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.codePointAt(i);
    if (c === 0x0a) { linha++; col = 1; continue; }
    if (suspeito(c)) achados.push("U+" + c.toString(16).toUpperCase().padStart(4, "0") + " na linha " + linha + ", coluna " + col);
    col++;
  }

  if (achados.length) {
    falhas++;
    console.log("  FALHA " + rel);
    for (const a of achados.slice(0, 8)) console.log("           " + a);
    if (achados.length > 8) console.log("           … e mais " + (achados.length - 8));
  } else {
    console.log("  ok    " + rel);
  }
}

console.log("");
console.log(falhas
  ? "FALHOU: " + falhas + " de " + lidos + " arquivo(s) com caractere de controle"
  : "passou: " + lidos + " arquivos, nenhum caractere de controle");
process.exit(falhas ? 1 : 0);
