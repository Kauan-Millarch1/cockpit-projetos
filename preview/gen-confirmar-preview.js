/* gen-confirmar-preview.js — generates preview/confirmar.html from tester.html.
 *
 * Same pattern as the other generators: the CSS and `confirmar()` itself are
 * EXTRACTED from tester.html, never hand-copied.
 *
 * This one is INTERACTIVE on purpose. The two dialogs it opens are the two real
 * ones, with the real copy, and what has to be checked here cannot be checked in
 * a screenshot: Esc cancels, clicking the scrim cancels, Tab cycles between the
 * two buttons and never leaves, the destructive one opens focused on Cancelar,
 * and the focus goes back to the button that opened it.
 * Regenerate: node preview/gen-confirmar-preview.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "tester.html"), "utf8");
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!css) throw new Error("style block not found");

/* Contar a partir da PRIMEIRA `{` depois de `i` extraía a chave da
 * desestruturação do parâmetro — `function confirmar({ tag, … })` devolvia só a
 * assinatura, e o preview quebrava com um `SyntaxError` que não apontava para
 * nada disso. O início do corpo é a `{` com que o próprio match termina. */
/* Varredura, não regex. `function confirmar({ tag, … })` tem chave DENTRO do
 * parâmetro: contar a partir da primeira `{` depois do nome devolvia só a
 * assinatura, e o preview quebrava com um `SyntaxError` que não apontava para
 * nada disso. Uma regex que tentasse pular o parâmetro ou para cedo ou corre
 * para dentro do corpo — as duas falhas foram vistas aqui. O caminho honesto é
 * achar o `)` que fecha os parâmetros contando parênteses, e só então abrir a
 * contagem de chaves na `{` seguinte. */
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

// As duas chamadas reais, copiadas dos dois lugares que as fazem. Se o texto
// mudar lá e não aqui, este preview passa a mentir — é o único pedaço deste
// arquivo que não é extraído.
const casos = {
  excluir: {
    tag: "EXCLUIR", perigo: true, botao: "Excluir o projeto",
    titulo: "Excluir «resumo_diario_tarefas_clickup_no_slack»?",
    corpo: [
      "O arquivo sai de projetos/ e a construção não volta sozinha — refazer o fluxo custaria uma construção inteira.",
      "A pasta é versionada no git, então dá para recuperar: git checkout -- projetos/, enquanto o commit anterior existir.",
      "Nada é tocado no n8n. Se você já importou este fluxo lá, ele continua lá."
    ]
  },
  desfazer: {
    tag: "DESFAZER", perigo: false, botao: "Voltar para a anterior",
    titulo: "Voltar este fluxo para a versão anterior?",
    corpo: [
      "A versão de agora continua guardada no projeto — desfazer de novo traz ela de volta.",
      "Nada é tocado no n8n: o que muda é o arquivo do projeto nesta máquina."
    ]
  }
};

const page = [
  "<!doctype html>",
  '<html lang="pt-BR"><head><meta charset="utf-8"><title>preview · confirmar</title>',
  "<style>", css,
  ".pv{max-width:64ch;margin:60px auto;padding:0 16px}",
  ".pv h1{font-size:20px;font-weight:650;margin:0 0 8px}",
  ".pv p{font-size:13px;line-height:1.65;color:var(--txt-dim)}",
  ".pv .acoes{margin-top:18px}",
  ".pv .eco{margin-top:16px;font-family:var(--font-num);font-size:11px;color:var(--txt-faint)}",
  "</style></head><body>",
  '<div class="pv">',
  "<h1>Confirmar — os dois diálogos reais</h1>",
  "<p>Abra os dois e confira o que uma captura de tela não mostra: <strong>Esc</strong> cancela, clicar no fundo cancela, " +
    "<strong>Tab</strong> circula entre os dois botões e não sai, o destrutivo abre com o foco no <em>Cancelar</em>, " +
    "e ao fechar o foco volta para o botão que abriu.</p>",
  '<div class="acoes">' +
    '<button type="button" class="btn perigo" id="ab-excluir">Abrir o de excluir (destrutivo)</button> ' +
    '<button type="button" class="btn" id="ab-desfazer">Abrir o de desfazer (reversível)</button>' +
  "</div>",
  '<div class="eco" id="eco">nenhuma resposta ainda</div>',
  "</div>",
  "<script>",
  '"use strict";',
  'const tema = new URLSearchParams(location.search).get("theme");',
  'if (tema === "light" || tema === "dark") document.documentElement.setAttribute("data-theme", tema);',
  "const esc = s => String(s == null ? \"\" : s).replace(/[&<>\"']/g, c => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));",
  grab("confirmar"),
  "const casos = " + JSON.stringify(casos, null, 1) + ";",
  'const eco = document.getElementById("eco");',
  'for (const [k, cfg] of Object.entries(casos)) {',
  '  document.getElementById("ab-" + k).addEventListener("click", async () => {',
  '    const r = await confirmar(cfg);',
  '    eco.textContent = k + " -> " + (r ? "CONFIRMADO" : "cancelado") + " · o foco voltou para: " + (document.activeElement && document.activeElement.id || "?");',
  "  });",
  "}",
  "</script></body></html>"
].join("\n");

const out = path.join(__dirname, "confirmar.html");
fs.writeFileSync(out, page, "utf8");
console.log("written " + out);
