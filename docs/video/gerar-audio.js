/* gerar-audio.js — gera um MP3 por fala do roteiro.
 *
 *   node docs/video/gerar-audio.js [roteiro.md] [--refazer]
 *
 * RETOMÁVEL de propósito, e isso não é conveniência: a chave desta conta não tem
 * `user_read`, então não há como consultar o saldo. O primeiro sinal de cota
 * esgotada é um HTTP de erro numa fala qualquer, no meio do lote. Se o script
 * recomeçasse do zero, cada tentativa depois disso gastaria de novo tudo que já
 * havia saído — e a cota que falta é exatamente a que não dá para medir. Então:
 * arquivo que já existe é pulado, e uma falha no meio deixa o que já saiu no disco.
 * `--refazer` ignora o que existe.
 *
 * O nome do arquivo é o id da cena (`ato-cena.mp3`, ex. `06-6.5.mp3`), para a
 * montagem casar áudio e plano sem tabela intermediária.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const voz = require(path.join(__dirname, "..", "..", ".video", "voz.js"));

const args = process.argv.slice(2);
const REFAZER = args.includes("--refazer");
const ARQ = path.resolve(args.find(a => !a.startsWith("--")) || path.join(__dirname, "01-roteiro-tour.md"));
const SAIDA = path.join(__dirname, "..", "..", ".video", "audio", "falas");
fs.mkdirSync(SAIDA, { recursive: true });

const md = fs.readFileSync(ARQ, "utf8");

/* Cada linha de cena: `| 6.5 | tela | acao | "fala" | 9,7 |`. O id vem da primeira
   célula, que é o que amarra o MP3 ao plano. */
const cenas = [...md.matchAll(/^\| (\d+\.\d+) \| [^|]*\| [^|]*\| "(.+?)" \| [\d,]+ \|$/gm)]
  .map(m => ({ id: m[1], fala: m[2] }));

if (!cenas.length) {
  console.error("nenhuma cena encontrada em " + path.basename(ARQ) + " — o formato da tabela mudou?");
  process.exit(1);
}

const total = cenas.reduce((a, c) => a + voz.pronunciar(c.fala).length, 0);
console.log("  " + cenas.length + " falas, " + total + " caracteres, ~"
  + Math.round(cenas.reduce((a, c) => a + voz.duracao(c.fala), 0)) + "s de narração");
console.log("  voz " + voz.VOZ_PADRAO + "   style " + voz.AJUSTES.style + "   stability " + voz.AJUSTES.stability + "\n");

(async () => {
  let feitos = 0, pulados = 0, gastos = 0, segundos = 0;
  const desvios = [];
  for (const c of cenas) {
    const ato = c.id.split(".")[0].padStart(2, "0");
    const arq = path.join(SAIDA, ato + "-" + c.id + ".mp3");
    if (!REFAZER && fs.existsSync(arq)) {
      pulados++;
      segundos += voz.segundosDoMp3(fs.readFileSync(arq)) || 0;
      continue;
    }
    let r;
    try {
      r = await voz.falar(c.fala);
    } catch (e) {
      console.log("\n  PAROU em " + c.id + ": " + e.message);
      console.log("  " + feitos + " geradas, " + gastos + " caracteres gastos neste lote.");
      console.log("  O que saiu está no disco. Rode de novo para continuar de onde parou.");
      process.exit(1);
    }
    fs.writeFileSync(arq, r.buf);
    feitos++; gastos += r.caracteres; segundos += r.segundos || 0;
    const desvio = r.segundos == null ? null : (r.segundos - r.estimado);
    if (desvio !== null && Math.abs(desvio) > 1.2) desvios.push([c.id, r.estimado, r.segundos]);
    console.log("  " + c.id.padEnd(5) + " " + String(r.caracteres).padStart(4) + " car   "
      + (r.segundos == null ? "  ?  " : r.segundos.toFixed(1).padStart(5)) + "s"
      + (desvio === null ? "" : "   (estimei " + r.estimado.toFixed(1) + "s)"));
  }

  console.log("\n  geradas: " + feitos + "   puladas (já existiam): " + pulados);
  console.log("  caracteres gastos neste lote: " + gastos);
  console.log("  narração MEDIDA no total: " + Math.round(segundos) + "s ("
    + Math.floor(segundos / 60) + ":" + String(Math.round(segundos % 60)).padStart(2, "0") + ")");
  /* A estimativa erra até ~10% por fala, e num roteiro de 53 falas os erros não se
     cancelam de forma confiável. Este é o número que a montagem usa. */
  if (desvios.length) {
    console.log("\n  falas onde a régua errou mais de 1,2s (o plano precisa de folga):");
    for (const [id, est, med] of desvios) {
      console.log("     " + id.padEnd(5) + " estimei " + est.toFixed(1) + "s, saiu " + med.toFixed(1) + "s");
    }
  }
  console.log("\n  arquivos em .video/audio/falas/");
})();
