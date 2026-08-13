/* gen-avisos-preview.js — generates preview/avisos.html from tester.html.
 *
 * Same pattern as the other generators: the CSS and `avisar()` itself are
 * EXTRACTED from tester.html, never hand-copied — so the preview cannot drift
 * from the screen.
 *
 * Why this one earns its place: reaching each of the four notice types for real
 * means CAUSING four different failures — a refused attachment, a blocked
 * microphone, a dead server, a saved project. Two of them are minutes and
 * dollars deep into a live build. Here all eight states (four types × anchored
 * and floating) are on one page, side by side, in both themes.
 *
 * It is INTERACTIVE on purpose, for the same reason the confirmar preview is:
 * what has to be checked cannot be checked in a screenshot — that the pause on
 * hover actually pauses, that the progress bar matches the life, that the close
 * button works, that error and alert do NOT disappear on their own, and that the
 * stack caps at four instead of covering the page.
 *
 * Regenerate: node preview/gen-avisos-preview.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "tester.html"), "utf8");
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!css) throw new Error("style block not found");

/* Mesma varredura do gen-confirmar-preview: acha o `)` que fecha os parâmetros
 * contando parênteses e só então abre a contagem de chaves. Uma regex ingênua
 * tropeça em qualquer função cujo parâmetro tenha chave. */
function grab(nome) {
  const marca = "function " + nome + "(";
  const i = html.indexOf(marca);
  if (i < 0) throw new Error(nome + " not found");
  let k = i + marca.length, par = 1;
  while (k < html.length && par) {
    if (html[k] === "(") par++;
    else if (html[k] === ")") par--;
    k++;
  }
  const abre = html.indexOf("{", k);
  if (abre < 0) throw new Error(nome + ": corpo não encontrado");
  let d = 0;
  for (let j = abre; j < html.length; j++) {
    if (html[j] === "{") d++;
    else if (html[j] === "}") { d--; if (!d) return html.slice(i, j + 1); }
  }
  throw new Error(nome + ": chave de fechamento não encontrada");
}

// As constantes que governam o comportamento saem do arquivo também: escrever
// `4500` aqui à mão seria um número que para de ser verdade na primeira mudança.
function grabConst(nome) {
  const re = new RegExp("const " + nome + " = ([^;]+);");
  const m = html.match(re);
  if (!m) throw new Error(nome + " not found");
  return "const " + nome + " = " + m[1] + ";";
}

/* Toda constante que `avisar()` lê tem que vir junto. Medido: `VIDA_MAX_PAUSA`
 * entrou depois e o preview morreu com `VIDA_MAX_PAUSA is not defined` — um
 * ReferenceError que aponta para o gerador, não para a página. Se acrescentar
 * constante nova em `avisar()`, acrescente aqui no mesmo commit. */
const bloco = [
  grabConst("AVISO_GLIFO"),
  grabConst("AVISO_VIDA"),
  grabConst("VIDA_MAX_PAUSA"),
  grab("pilhaAvisos"),
  grab("avisar")
].join("\n\n");

/* As mensagens reais, dos lugares que as produzem. É o único pedaço não
 * extraído deste arquivo — se a cópia mudar lá e não aqui, o preview mente. */
const CASOS = [
  { tipo: "erro", titulo: null,
    msg: "esta rota não existe no servidor que está rodando — ele subiu antes desta versão do server.js" },
  { tipo: "alerta", titulo: "contrato.docx",
    msg: "Word não abre aqui (é um zip por dentro). Salve como PDF ou cole o texto na conversa." },
  { tipo: "ok", titulo: null, msg: "Projeto salvo. O fluxo continua fora do n8n até você importar." },
  { tipo: "info", titulo: "A próxima caixa é do navegador",
    msg: "O Chrome vai perguntar se pode enviar os arquivos da pasta — a caixa é dele, não nossa. Clique em «Fazer upload» para continuar." }
];

const cartaoAncorado = c =>
  '<div class="aviso ' + c.tipo + '">' +
    '<span class="ai" aria-hidden="true">' + ({ erro: "✕", alerta: "!", ok: "✓", info: "i" })[c.tipo] + "</span>" +
    '<span class="ac">' + (c.titulo ? '<span class="at">' + c.titulo + "</span>" : "") + c.msg + "</span>" +
  "</div>";

const pagina = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cockpit — avisos (preview)</title>
<style>
${css}
/* Só do preview: a moldura que põe os oito estados na mesma tela. */
body{padding:26px 22px 60px;background:var(--bg);color:var(--txt);font-family:var(--font)}
.wrap{max-width:1040px;margin:0 auto}
h1{font-size:19px;margin:0 0 4px}
.sub{font-size:12.5px;color:var(--txt-faint);margin:0 0 22px;line-height:1.6;max-width:78ch}
h2{font-size:11px;font-family:var(--font-num);letter-spacing:.07em;color:var(--txt-faint);
  margin:26px 0 10px;font-weight:600;text-transform:uppercase}
.grade{display:grid;gap:10px}
.disparos{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.nota{font-size:11.5px;color:var(--txt-faint);line-height:1.6;margin-top:10px;max-width:78ch}
.nota b{color:var(--txt-dim)}
</style>
</head>
<body>
<div class="wrap">
  <h1>Avisos — os quatro tipos, nos dois modos</h1>
  <p class="sub">Gerado de <code>tester.html</code> por <code>preview/gen-avisos-preview.js</code>.
    O CSS e a função <code>avisar()</code> são extraídos do arquivo, não copiados — este preview não
    consegue divergir da tela. Alcançar estes quatro estados de verdade exigiria causar quatro falhas
    diferentes, e duas delas custam minutos e dólares de uma construção ao vivo.</p>

  <h2>Ancorado — fica onde o problema está</h2>
  <div class="grade">
    ${CASOS.map(cartaoAncorado).join("\n    ")}
  </div>

  <h2>Flutuante — a pilha do canto</h2>
  <div class="disparos">
    ${CASOS.map((c, i) => '<button type="button" class="btn" data-i="' + i + '">' + c.tipo + "</button>").join("\n    ")}
    <button type="button" class="btn" id="todos">os quatro de uma vez</button>
    <button type="button" class="btn" id="seis">seis seguidos (prova o teto de 4)</button>
    <button type="button" class="btn" id="tema">◐ trocar tema</button>
  </div>
  <p class="nota">
    <b>O que só dá para conferir aqui:</b> passe o mouse sobre um aviso de <code>ok</code> ou
    <code>info</code> — a barra pausa e ele não foge debaixo do cursor. Solte e ele sai em 1,2s.
    <code>erro</code> e <code>alerta</code> <b>não somem sozinhos</b> e não têm barra: quem precisa ler
    não pode perder a frase. Dispare seis para ver o teto de quatro — sem ele, uma pasta com oito
    arquivos recusados viraria uma coluna que cobre a página.
  </p>
</div>

<script>
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));

${bloco}

const CASOS = ${JSON.stringify(CASOS, null, 2)};
document.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", () => {
  const c = CASOS[+b.dataset.i];
  avisar(c.msg, c.tipo, c.titulo);
}));
document.getElementById("todos").addEventListener("click", () => {
  CASOS.forEach((c, i) => setTimeout(() => avisar(c.msg, c.tipo, c.titulo), i * 160));
});
document.getElementById("seis").addEventListener("click", () => {
  for (let i = 0; i < 6; i++) setTimeout(() => avisar("aviso número " + (i + 1) + " — os dois primeiros saem quando o quinto entra", "alerta", "teto da pilha"), i * 120);
});
document.getElementById("tema").addEventListener("click", () => {
  const r = document.documentElement;
  const escuro = r.getAttribute("data-theme") === "dark"
    || (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  r.setAttribute("data-theme", escuro ? "light" : "dark");
});
</script>
</body>
</html>
`;

const alvo = path.join(__dirname, "avisos.html");
fs.writeFileSync(alvo, pagina, "utf8");
console.log("escrito: " + alvo);
console.log("abra com um duplo clique — os quatro tipos, ancorados e flutuantes, nos dois temas.");
