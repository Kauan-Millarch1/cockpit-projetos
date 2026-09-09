/* contar-roteiro.js — recalcula a coluna `≈s` de UM roteiro de aba e o total.
 *
 * POR QUE ISTO EXISTE. A coluna foi digitada a mao na primeira versao do roteiro
 * da aba Fluxos e QUATRO das catorze celulas divergiram da regua — a mesma falha
 * que o tour cometeu (31% de erro) e que o `voz.js` documenta no cabecalho. Se um
 * artefato vai ser editado dez vezes, todo numero dentro dele precisa sair de uma
 * funcao.
 *
 * POR QUE UM SO ARQUIVO PARA TODAS AS ABAS. Ele nasceu como `contar-fluxos.js`,
 * preso ao roteiro da aba Fluxos e ao prefixo `f`. Ao escrever o roteiro do
 * Tester a escolha era copiar (duas contas da mesma coisa, que divergem na
 * primeira correcao feita num lado so) ou generalizar. O que muda entre roteiros
 * e o ARQUIVO e o PREFIXO do id da cena; a regua e a mesma, porque a voz e a
 * mesma. `contar-fluxos.js` continua existindo e chama este aqui.
 *
 * A ESTIMATIVA SERVE PARA PLANEJAR, NUNCA PARA CORTAR. O corte e feito contra a
 * duracao MEDIDA no MP3 gerado; esta coluna existe para fechar a cena antes de
 * gastar cota. No tour a estimativa errou 1,73s numa fala so.
 *
 *   node docs/video/contar-roteiro.js 03-roteiro-tester.md t            confere
 *   node docs/video/contar-roteiro.js 03-roteiro-tester.md t --escrever reescreve
 */
"use strict";
const fs = require("fs");
const path = require("path");
const voz = require(path.join(__dirname, "..", "..", ".video", "voz.js"));

function contar(arquivo, prefixo, escrever) {
  const ARQ = path.isAbsolute(arquivo) ? arquivo : path.join(__dirname, arquivo);
  if (!fs.existsSync(ARQ)) { console.error("nao achei " + ARQ); process.exit(2); }

  /* A linha da cena: `| <prefixo><n> | tela | animacao | fala | s |`. O prefixo
     entra na regex para um roteiro nao contar as linhas de outro se alguem
     colar duas tabelas no mesmo arquivo. */
  const LINHA = new RegExp(
    "^(\\|\\s*" + prefixo + "\\d+\\s*\\|[^|]*\\|[^|]*\\|\\s*)(.+?)(\\s*\\|\\s*)([\\d,]+)(\\s*\\|)$", "gm");

  let md = fs.readFileSync(ARQ, "utf8");
  const vistos = [];
  md = md.replace(LINHA, (todo, antes, fala, meio, escrito, fim) => {
    /* A fala e medida SEM o negrito do markdown: `**voce**` sao quatro
       caracteres que ninguem fala, e conta-los inflaria a estimativa. */
    const limpa = fala.replace(/\*\*/g, "").replace(/^"|"$/g, "");
    const est = voz.duracao(limpa);
    vistos.push({ fala: limpa, est, escrito: Number(String(escrito).replace(",", ".")) });
    return antes + fala + meio + est.toFixed(1).replace(".", ",") + fim;
  });

  if (!vistos.length) {
    console.error("nenhuma linha casou com o prefixo \"" + prefixo + "\" em " + path.basename(ARQ) + ".");
    console.error("uma contagem que nao acha nada e pior que nenhuma: ela sai com sucesso.");
    process.exit(2);
  }

  const soma = vistos.reduce((a, v) => a + v.est, 0);
  /* ARREDONDA ANTES DE DIVIDIR. `floor(s/60)` com `round(s%60)` imprime **1:60**
     para 119,995s — os dois lados sao arredondados separadamente e o segundo
     estoura o minuto que o primeiro ja tinha descartado. */
  const mm = s => { const t = Math.round(s); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  md = md.replace(/\*\*Soma estimada: [^*]+\*\*/,
    "**Soma estimada: " + soma.toFixed(1).replace(".", ",") + "s (" + mm(soma) + ").**");

  const ruins = vistos.filter(v => Math.abs(v.est - v.escrito) > 0.05);
  console.log(path.basename(ARQ) + ": " + vistos.length + " falas · soma derivada "
    + soma.toFixed(1) + "s (" + mm(soma) + ")");
  console.log("celulas que estavam divergindo: " + ruins.length);
  for (const r of ruins) console.log("   " + r.escrito + "s -> " + r.est.toFixed(1) + "s   " + r.fala.slice(0, 52));

  if (escrever) { fs.writeFileSync(ARQ, md); console.log("\nreescrito."); }
  else if (ruins.length) { console.log("\nrode com --escrever para corrigir."); process.exit(1); }
}

module.exports = { contar };

if (require.main === module) {
  const args = process.argv.slice(2).filter(a => a !== "--escrever");
  const escrever = process.argv.includes("--escrever");
  if (args.length < 2) {
    console.error("uso: node docs/video/contar-roteiro.js <arquivo.md> <prefixo> [--escrever]");
    process.exit(2);
  }
  contar(args[0], args[1], escrever);
}
