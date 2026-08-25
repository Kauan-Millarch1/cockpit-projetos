/* A escala tipográfica dos artboards tem que ser a do app.
 *
 *   node .design/login/escala.mjs             — só reporta
 *   node .design/login/escala.mjs --corrigir  — encosta os inventados na escala
 *
 * O defeito que isto pega não é "hierarquia achatada", é RUÍDO DE TAMANHO:
 * medido nos artboards da rodada 2, um arquivo carregava 12,8 / 12,4 / 12,3 /
 * 12,2 e outro 10,8 / 10,7 / 10,6 / 10,5 — quatro tamanhos dentro de 0,6px, duas
 * vezes no mesmo arquivo. Nenhum olho resolve essa diferença. Cada um daqueles
 * valores é uma decisão imperceptível E um número que não existe no painel, o
 * que quebra a única regra que faz o mockup valer algo: os valores são
 * LEVANTADOS do app, nunca escolhidos.
 *
 * A escala é lida do `upgrade.html` EM TEMPO DE EXECUÇÃO, de propósito. Uma
 * lista transcrita aqui divergiria do painel na primeira vez que alguém mexesse
 * num tamanho lá, e o lado que divergisse seria este — o que ninguém abre.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(AQUI, "..", "..", "upgrade.html");
const CORRIGIR = process.argv.includes("--corrigir");

const RE = /font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g;

/* A escala vem do painel. Sem ela não há régua, e inventar uma aqui seria
   exatamente o defeito que este arquivo existe para pegar — então falha fechado. */
const app = await readFile(APP, "utf8").catch(() => null);
if (!app) {
  console.error(`nao consegui ler ${APP} — sem a escala do app nao existe regua. Nada foi conferido.`);
  process.exit(1);
}
const permitidos = [...new Set([...app.matchAll(RE)].map((m) => Number(m[1])))].sort((a, b) => a - b);
if (permitidos.length < 8) {
  console.error(`li so ${permitidos.length} tamanhos em upgrade.html — leitura suspeita, nao vou usar isso como regua.`);
  process.exit(1);
}
console.log(`escala do app (${permitidos.length} tamanhos): ${permitidos.join(" ")}`);

/* Empate resolvido pelo MAIS USADO no app, não pelo menor: 11,8 fica a 0,2 de 12
   e a 0,3 de 11,5, mas quando a distância empata quem ganha é o degrau que o
   painel realmente usa — é ele que faz o artboard parecer com o produto. */
const uso = new Map();
for (const m of app.matchAll(RE)) uso.set(Number(m[1]), (uso.get(Number(m[1])) || 0) + 1);
const encostar = (v) => {
  let melhor = permitidos[0], d = Infinity;
  for (const p of permitidos) {
    const dd = Math.abs(p - v);
    if (dd < d - 1e-9 || (Math.abs(dd - d) < 1e-9 && (uso.get(p) || 0) > (uso.get(melhor) || 0))) {
      melhor = p; d = dd;
    }
  }
  return melhor;
};

const arqs = (await readdir(AQUI)).filter((f) => f.endsWith(".dc.html")).sort();
let totalFora = 0, totalTrocas = 0;

for (const arq of arqs) {
  const p = path.join(AQUI, arq);
  let s = await readFile(p, "utf8");
  const usados = [...new Set([...s.matchAll(RE)].map((m) => Number(m[1])))].sort((a, b) => b - a);
  const fora = usados.filter((v) => !permitidos.includes(v));

  /* Vizinhos imperceptíveis: dois tamanhos a menos de 0,4px um do outro no mesmo
     arquivo são a mesma coisa desenhada duas vezes. Reportado, nunca corrigido
     automaticamente — colapsar pode ser certo ou pode apagar uma distinção real.
     MAS o par só conta quando ALGUÉM DELE ESTÁ FORA DA ESCALA. Se os dois são do
     painel, o painel já decidiu: 13px é `.btn` e 12,8px é o corpo do diálogo,
     papéis diferentes, e acusar isso seria acusar o produto. A primeira versão
     acusava — e um portão que grita no que já está certo ensina a ignorar o
     portão, que é o defeito que ele existe para não ser. */
  const juntos = [];
  for (let i = 0; i < usados.length - 1; i++) {
    const [a, b] = [usados[i], usados[i + 1]];
    if (b - a >= -0.4 && a - b < 0.4 && (!permitidos.includes(a) || !permitidos.includes(b))) {
      juntos.push(`${a}/${b}`);
    }
  }

  if (!fora.length && !juntos.length) { console.log(`ok  ${arq}  ${usados.length} tamanhos`); continue; }

  totalFora += fora.length;
  console.log(`!!  ${arq}  ${usados.length} tamanhos`);
  for (const v of fora) console.log(`      fora da escala: ${v}px  ->  ${encostar(v)}px`);
  for (const j of juntos) console.log(`      vizinhos imperceptiveis: ${j}px`);

  if (CORRIGIR && fora.length) {
    /* Do maior para o menor e com o "px" na busca: trocar "12.2" solto acertaria
       um `letter-spacing`, uma largura ou um pedaço de outro número. */
    for (const v of [...fora].sort((a, b) => b - a)) {
      const alvo = encostar(v);
      const re = new RegExp(`(font-size:\\s*)${String(v).replace(".", "\\.")}px`, "g");
      const antes = s;
      s = s.replace(re, `$1${alvo}px`);
      const n = (antes.match(re) || []).length;
      totalTrocas += n;
    }
    await writeFile(p, s, "utf8");
  }
}

console.log("");
if (CORRIGIR) {
  console.log(`${totalTrocas} declaracao(oes) encostada(s) na escala do app.`);
  console.log("Rode a bancada de captura de novo: mexer em tamanho mexe em altura, e o quadro corta.");
} else if (totalFora) {
  console.log(`${totalFora} tamanho(s) fora da escala. --corrigir encosta na mais proxima (empate: a mais usada no app).`);
} else {
  console.log("todos os tamanhos vem da escala do app.");
}
