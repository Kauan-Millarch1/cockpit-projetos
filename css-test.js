/* css-test.js — nenhuma regra CSS aberta nas páginas servidas.
 *
 * EXISTE POR CAUSA DE UM DEFEITO QUE EU CAUSEI, e ele não deixa rastro nenhum
 * de erro: ao copiar o bloco do `confirmar()` do `tester.html` para o
 * `upgrade.html`, o corte por número de linhas pegou um comentário no meio e
 * deixou o `.btn.perigo` sem a chave de fechamento. Uma regra aberta faz o
 * navegador engolir TUDO o que vem depois dela na folha — a página abriu sem
 * grade, sem cartão, sem borda, com o texto encostado na margem — e o console
 * não diz uma palavra, porque CSS inválido não é erro, é CSS ignorado.
 *
 * Este repositório já tem a mesma classe de rede para outra coisa: o
 * `caractere-test.js`, que nasceu de um byte invisível. A lição é a mesma — o
 * pior defeito é o que parece certo e não funciona.
 *
 * O que ele confere, em cada `<style>` de cada página servida:
 *   - as chaves fecham (nenhuma regra aberta no fim do bloco);
 *   - nunca se fecha mais do que se abriu (chave sobrando também quebra);
 *   - nenhum `@media`/`@keyframes` sem corpo.
 *
 * De graça: nenhum browser, nenhuma rede. `node css-test.js` */

"use strict";

const fs = require("fs");
const path = require("path");

const PAGINAS = ["flows.html", "cockpit.html", "tester.html", "upgrade.html"];

/* Comentários e strings saem antes da contagem: `content: "}"` é legítimo e
   contaria como fechamento. `url(...)` idem. */
function limpar(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/* A linha onde a chave sem par foi aberta — sem isso a falha diz "está
   desbalanceado" e deixa quem lê caçando 3000 linhas de folha. */
function culpadas(css) {
  const pilha = [];
  let linha = 1;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "\n") { linha++; continue; }
    if (c === "{") pilha.push(linha);
    else if (c === "}") { if (!pilha.length) return { sobrando: linha }; pilha.pop(); }
  }
  return { abertas: pilha };
}

let falhas = 0, lidos = 0;

for (const rel of PAGINAS) {
  const p = path.join(__dirname, rel);
  let h;
  try { h = fs.readFileSync(p, "utf8"); }
  catch { console.log("  (ausente) " + rel); continue; }
  lidos++;

  const blocos = [...h.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (!blocos.length) { console.log("  FALHA " + rel + " — nenhum bloco <style>, e todas estas páginas têm um"); falhas++; continue; }

  const problemas = [];
  blocos.forEach((b, i) => {
    const css = limpar(b[1]);
    const r = culpadas(css);
    if (r.sobrando) problemas.push("bloco " + i + ": `}` sobrando na linha " + r.sobrando + " do bloco");
    else if (r.abertas.length) {
      problemas.push("bloco " + i + ": " + r.abertas.length + " regra(s) sem fechar, abertas na(s) linha(s) "
        + r.abertas.slice(0, 5).join(", ") + " do bloco");
    }
    /* `@media` ou `@keyframes` sem `{` é a outra forma de a folha morrer em
       silêncio a partir daquele ponto. */
    for (const m of css.matchAll(/@(media|keyframes|supports)([^{;]*)(;|$)/g)) {
      problemas.push("bloco " + i + ": `@" + m[1] + m[2].trim() + "` sem corpo");
    }
  });

  if (problemas.length) {
    falhas++;
    console.log("  FALHA " + rel);
    for (const x of problemas.slice(0, 6)) console.log("           " + x);
  } else {
    console.log("  ok    " + rel + " · " + blocos.length + " bloco(s) <style>, chaves balanceadas");
  }
}

console.log("");
console.log(falhas
  ? "FALHOU: " + falhas + " de " + lidos + " página(s) com CSS quebrado — o navegador ignora tudo depois da regra aberta"
  : "passou: " + lidos + " páginas, nenhuma regra CSS aberta");
process.exit(falhas ? 1 : 0);
