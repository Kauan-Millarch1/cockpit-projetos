/* aplicar-porta-conta.js — a quinta porta, escrita nos cinco arquivos de uma vez.
 *
 * Por que um script e não cinco edições à mão: o `nav-sync-test.js` compara o
 * bloco BYTE A BYTE entre as páginas, e o defeito que ele existe para pegar já
 * aconteceu uma vez (um resync inseriu um segundo bloco no flows.html em vez de
 * substituir, e a página morreu com "Illegal return statement"). Cinco edições
 * manuais é cinco chances de divergir.
 *
 * Ele também conserta um defeito VIVO, achado ao ler o bloco: o atalho lê
 * `"123".indexOf(ev.key)` enquanto existem QUATRO portas, cada uma com o chip
 * `alt N`. Ou seja, `alt 4` do Upgrade nunca funcionou e o rótulo prometia que
 * sim — que é exatamente o que o caso 8 do `nav-sync-test.js` diz existir para
 * impedir. Ele passava porque testava `[123]` e só perguntava se ALGUM chip
 * existia; a correção do teste vem junto.
 *
 * Roda uma vez e é idempotente: se a porta já está lá, ele diz e não mexe.
 * `node preview/aplicar-porta-conta.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

/* O ícone é do mesmo dialeto das outras quatro: viewBox 24, fill none, stroke
   currentColor, largura 1.9, pontas redondas. Nunca emoji. */
const PORTA =
  '    <a href="/conta" data-porta="conta"><span class="ic"><svg width="15" height="15" ' +
  'viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M12 3.9a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8z" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M4.6 20.1a7.4 7.4 0 0 1 14.8 0" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg></span><span class="lb"><span>Conta</span><kbd>alt 5</kbd></span></a>\n';

const PAGINAS = ["flows.html", "tester.html", "cockpit.html", "upgrade.html", "integracoes.html"];

let mudou = 0;
const diz = (a, m) => console.log("  " + a.padEnd(20) + m);

for (const arq of PAGINAS) {
  const alvo = path.join(RAIZ, arq);
  let t = fs.readFileSync(alvo, "utf8");
  const antes = t;

  if (t.includes('data-porta="conta"')) {
    diz(arq, "já tem a porta");
  } else {
    /* Entra ANTES do `</nav>`, depois da última porta. A ordem na cápsula é a
       ordem do DOM, e a lente viaja por `offsetLeft` — nada aqui depende de
       índice fixo. */
    const fim = t.indexOf("</nav>");
    if (fim < 0) { diz(arq, "SEM <nav> — não mexi"); continue; }
    t = t.slice(0, fim) + PORTA + "  " + t.slice(fim);
    diz(arq, "porta «conta» inserida");
  }

  /* O atalho morto. `"123"` cobria três portas para quatro chips; agora são
     cinco portas e cinco chips. */
  if (t.includes('"123".indexOf(ev.key)')) {
    t = t.replace('"123".indexOf(ev.key)', '"12345".indexOf(ev.key)');
    diz(arq, "atalho: \"123\" -> \"12345\" (alt 4 e alt 5 estavam mortos)");
  }

  /* O cabeçalho do bloco é delimitador do `nav-sync-test.js`. Ele muda nos cinco
     arquivos E no gerador, ou o teste passa a não achar o bloco. */
  t = t.replace("NAV — as quatro portas", "NAV — as cinco portas");

  if (t !== antes) { fs.writeFileSync(alvo, t); mudou++; }
}

/* O gerador carrega a própria cópia do bloco. `preview/aplicar-nav.js` é
   migração de mão única (`transformar()` recusa refazer), então ele não pode ser
   re-executado para propagar isto — a única forma segura é a mesma substituição
   byte a byte aqui, e o §9 do `nav-sync-test.js` falha se ele divergir. */
const ger = path.join(RAIZ, "preview", "aplicar-nav.js");
let g = fs.readFileSync(ger, "utf8");
const gAntes = g;
g = g.replace("NAV — as quatro portas", "NAV — as cinco portas");
g = g.replace('"123".indexOf(ev.key)', '"12345".indexOf(ev.key)');
if (g !== gAntes) { fs.writeFileSync(ger, g); diz("aplicar-nav.js", "cabeçalho e atalho alinhados"); }

console.log("\n" + mudou + " página(s) alterada(s).");
