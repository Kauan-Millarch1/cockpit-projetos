/* contar.js — preenche a coluna `≈s`, as marcas de tempo dos atos e o bloco
   "Contas" de um roteiro, DERIVANDO tudo da régua da voz.
 *
 * Existe por um defeito medido: a primeira versão do roteiro do tour trazia a
 * coluna digitada à mão. Três células divergiam da régua e a soma no rodapé estava
 * 31% otimista — 2.180 caracteres anunciados contra 2.857 reais, o que virava 88%
 * de densidade de fala onde eu havia escrito 67%. Um roteiro cuja duração é chute
 * desalinha a montagem inteira, e o erro só aparece DEPOIS de a cota do ElevenLabs
 * ter sido gasta.
 *
 * O mesmo defeito apareceu em dois lugares no mesmo arquivo (a coluna e as faixas
 * de tempo dos atos), o que é o sinal de que não era descuido: número digitado à
 * mão num artefato que vai ser editado dez vezes é dívida garantida.
 *
 *   node docs/video/contar.js [arquivo.md] [--alvo 220]
 *
 * `--alvo` é a duração desejada do vídeo em segundos. A densidade de fala sai
 * dela; o padrão é 220 (3:40). */
"use strict";

const fs = require("fs");
const path = require("path");
const voz = require(path.join(__dirname, "..", "..", ".video", "voz.js"));

const args = process.argv.slice(2);
const iAlvo = args.indexOf("--alvo");
const ALVO = iAlvo >= 0 ? Number(args[iAlvo + 1]) : 220;
/* O VALOR DE `--alvo` NAO E UM NOME DE ARQUIVO, e a primeira versao deste parser
   achava que era: `--alvo 330` fazia `args.find(a => !a.startsWith("--"))`
   devolver "330" e o script morria tentando ler um arquivo chamado 330. Defeito
   de dez segundos, mas do tipo que faz alguem achar que o roteiro sumiu. */
const posicionais = args.filter((a, i) => !a.startsWith("--") && i !== iAlvo + 1);
const ARQ = path.resolve(posicionais[0] || path.join(__dirname, "01-roteiro-tour.md"));

let md = fs.readFileSync(ARQ, "utf8");

/* A célula de fala é a penúltima da linha; a `≈s` é a última. O regex casa a
   linha inteira para não confundir com uma citação em texto corrido. */
const LINHA = /^(\| [^|]*\| [^|]*\| [^|]*\| ")(.+?)(" \| )([\d,]+)( \|)$/gm;

let celulas = 0;
md = md.replace(LINHA, (m, antes, fala, meio, _velho, fim) => {
  celulas++;
  return antes + fala + meio + voz.duracao(fala).toFixed(1).replace(".", ",") + fim;
});

/* Por ato, para as marcas de tempo. Divide pelo cabeçalho `## ATO n`. */
const partes = md.split(/^## ATO /m);
const porAto = [];
for (let i = 1; i < partes.length; i++) {
  const falas = [...partes[i].matchAll(/\| "(.+?)" \| [\d,]+ \|$/gm)].map(x => x[1]);
  porAto.push({ segundos: falas.reduce((a, f) => a + voz.duracao(f), 0), falas: falas.length });
}
const totalFala = porAto.reduce((a, x) => a + x.segundos, 0);
const fator = ALVO / totalFala;

const mm = s => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
let t = 0, k = 0;
md = md.replace(/^(## ATO \d+ — .+?)(?: \(\d+:\d+ – \d+:\d+\))?$/gm, (m, cab) => {
  const ini = t; t += porAto[k].segundos * fator; k++;
  return cab + " (" + mm(ini) + " – " + mm(t) + ")";
});

const todas = [...md.matchAll(/\| "(.+?)" \| [\d,]+ \|$/gm)].map(x => x[1]);
const caracteres = todas.reduce((a, f) => a + voz.pronunciar(f).length, 0);
const densidade = Math.round(100 * totalFala / ALVO);

/* O bloco Contas, inteiro, sempre reescrito. */
const contas = "## Contas\n\n"
  + "**Derivado, nunca digitado.** `node docs/video/contar.js` recalcula a coluna `≈s`, as marcas de\n"
  + "tempo de cada ato e esta tabela. Ver o cabeçalho deste script para o defeito que o criou.\n\n"
  + "| | |\n|---|---|\n"
  + "| atos | " + porAto.length + " |\n"
  + "| falas | " + todas.length + " |\n"
  + "| caracteres falados | " + caracteres + " |\n"
  + "| narração estimada | **" + Math.round(totalFala) + "s** (" + mm(totalFala) + ") |\n"
  + "| duração alvo | **" + ALVO + "s** (" + mm(ALVO) + ") |\n"
  + "| fala / silêncio | " + densidade + "% / " + (100 - densidade) + "% |\n\n"
  + "| ato | fala | janela |\n|---|---|---|\n"
  + porAto.map((a, i) => {
      let ini = 0;
      for (let j = 0; j < i; j++) ini += porAto[j].segundos * fator;
      return "| " + (i + 1) + " | " + Math.round(a.segundos) + "s em " + a.falas + " falas | "
        + mm(ini) + " – " + mm(ini + a.segundos * fator) + " |";
    }).join("\n") + "\n\n"
  + (densidade > 80
      ? "**Densidade em " + densidade + "%, acima do limite.** Acima de 80% cansa. Corte narração ou\n"
        + "aumente o alvo — mas o alvo veio de um pedido (\"não pode demorar tanto\"), então cortar é a\n"
        + "saída certa.\n\n"
      : densidade < 60
      ? "**Densidade em " + densidade + "%, abaixo do piso.** Abaixo de 60% arrasta: ou há fala a\n"
        + "acrescentar, ou o alvo está longo demais.\n\n"
      : "Densidade em **" + densidade + "%**, dentro da faixa (60–80%). Se na montagem soar apressado,\n"
        + "**alongue as pausas, não corte conteúdo**: as cenas marcadas «segurar» têm folga e as\n"
        + "marcadas «acelerar» já estão comprimidas.\n\n")
  + "**Cota do ElevenLabs:** " + caracteres + " caracteres por geração completa do roteiro. Reserve 3×\n"
  + "para regeração — e note que esta chave **não tem** `user_read`, então não há como consultar o\n"
  + "saldo: o primeiro sinal de cota esgotada é um HTTP de erro numa fala qualquer.\n\n";

md = md.replace(/## Contas\n\n[\s\S]*?(?=## Armadilhas)/, contas);
fs.writeFileSync(ARQ, md);

console.log("  " + path.basename(ARQ));
console.log("  celulas recalculadas: " + celulas + "   atos: " + porAto.length + "   falas: " + todas.length);
console.log("  caracteres: " + caracteres + "   narracao: " + Math.round(totalFala) + "s"
  + "   alvo: " + ALVO + "s   densidade: " + densidade + "%");
if (densidade > 80) console.log("  AVISO: densidade acima de 80% — corte narracao");
if (densidade < 60) console.log("  AVISO: densidade abaixo de 60% — o video vai arrastar");
