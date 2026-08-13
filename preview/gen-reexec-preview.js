/* gen-reexec-preview.js — gera preview/reexec.html a partir de flows.html.
 *
 * Mesmo padrão dos outros geradores: o CSS, as constantes, `reexecClasse` e
 * `reexecBloco` são EXTRAÍDOS do flows.html, nunca copiados à mão — então o
 * preview não pode divergir da tela.
 *
 * Por que este ganha o lugar dele: chegar nesses estados de verdade custa uma
 * rodada do Claude Code (minutos e dólares), um clique de aprovar que ESCREVE
 * num fluxo de produção, e — para ver o estado de sucesso — uma reexecução, que
 * manda mensagem para um lead de verdade e não tem desfazer. Ou seja: o único
 * jeito de olhar essa tela antes era causar exatamente aquilo que ela existe
 * para deixar seguro.
 *
 * É INTERATIVO de propósito. O que precisa ser conferido não cabe num print:
 * que o botão do caso ambíguo troca o bloco inteiro pelo resultado, que ele se
 * desabilita no clique (dois cliques = duas mensagens para o mesmo lead), e que
 * o motivo do risco está na tela ANTES do clique, não depois.
 *
 * Regenerar: node preview/gen-reexec-preview.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "flows.html"), "utf8");

const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!css) throw new Error("bloco <style> não encontrado em flows.html");

/* Acha o `)` que fecha os parâmetros contando parênteses e só então abre a
   contagem de chaves — uma regex ingênua tropeça em qualquer função cujo
   parâmetro tenha chave. Mesma varredura do gen-avisos/gen-confirmar. */
function grab(nome) {
  const marca = "function " + nome + "(";
  const i = html.indexOf(marca);
  if (i < 0) throw new Error(nome + " não encontrada em flows.html");
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

function grabConst(nome) {
  const re = new RegExp("const " + nome + " = ([\\s\\S]*?);\\n");
  const m = html.match(re);
  if (!m) throw new Error(nome + " não encontrada em flows.html");
  return "const " + nome + " = " + m[1] + ";";
}

/* Toda constante que `reexecBloco` lê tem que vir junto. Se acrescentar uma nova
   no bloco de juízo, acrescente aqui no mesmo commit — senão o preview morre com
   um ReferenceError que aponta para o gerador e não para a página. */
const bloco = [
  "const el = " + (html.match(/const el = (\(t, c, txt\) => \{[\s\S]*?\};)/) || [])[1],
  grabConst("REEXEC_AMBIGUO"),
  grabConst("REEXEC_LIMPO"),
  grabConst("REEXEC_LIMPO_TXT"),
  grabConst("REEXEC_AMBIGUO_TXT"),
  grabConst("REEXEC_ESCOPO"),
  grabConst("REEXEC_SEM_DESFAZER"),
  grab("reexecClasse"),
  grab("reexecBloco")
].join("\n\n");

for (const nome of ["reexecClasse", "reexecBloco", "REEXEC_ESCOPO"]) {
  if (!bloco.includes(nome)) throw new Error("extração falhou: " + nome);
}

/* O `reexecutar` de verdade fala com o servidor. Aqui ele é trocado por um que
   não sai da página — mas com a MESMA forma de retorno ({ok, error, newExecId}),
   porque é ela que o bloco lê. Alternar sucesso/erro é o que deixa os dois
   desfechos visíveis sem precisar derrubar nada. */
const stub = `
// 0 = dá certo · 1 = n8n recusou (nada rodou) · 2 = resposta perdida (indefinido)
let MODO = 0;
async function reexecutar(runId, execId) {
  await new Promise(r => setTimeout(r, 600));
  if (MODO === 1) return { ok: false, newExecId: null, podeTentar: true,
    error: "o n8n recusou a reexecução: n8n 400 em /api/v1/executions/" + execId + "/retry — nada rodou, dá para tentar de novo" };
  if (MODO === 2) return { ok: false, newExecId: null, podeTentar: false,
    error: "não consegui confirmar a reexecução: socket hang up — uma resposta perdida não prova que ela não começou, confira a execução " + execId + " no n8n antes de tentar de novo" };
  return { ok: true, error: null, newExecId: String(Number(execId) + 1), podeTentar: false };
}
`;

const CASOS = [
  { t: "Erro limpo — reexecutou junto com o aprovar",
    d: "O nó recusou antes de mandar nada. O botão de aprovar dizia “Aprovar, aplicar e responder o lead”, e isto é o que aparece depois.",
    err: "required JSON field 'text'", res: "ok" },
  { t: "Falhou, mas o n8n RESPONDEU — dá para tentar de novo",
    d: "O pedido chegou e foi recusado, então nada rodou. Só aqui aparece o botão de tentar de novo.",
    err: "Cannot read properties of undefined", res: "recusado" },
  { t: "Falhou e a resposta se PERDEU — sem botão, de propósito",
    d: "A execução pode ter começado. Um segundo clique mandaria a mensagem duas vezes, então a tela manda conferir no n8n em vez de oferecer o botão.",
    err: "ExpressionError no payload", res: "perdido" },
  { t: "Erro ambíguo — espera o clique, com o motivo do lado",
    d: "Timeout: a mensagem pode ter saído. O motivo aparece ANTES do clique, porque é ele que decide.",
    err: "ETIMEDOUT", res: null },
  { t: "Erro desconhecido — cai no ambíguo, nunca no limpo",
    d: "Padrão que ninguém cadastrou. O default não pode ser o que dispara sozinho.",
    err: "coisa que nunca aconteceu antes neste fluxo", res: null }
];

const page = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reexecutar — preview</title>
<style>
${css}
body { padding: 28px; max-width: 1180px; margin: 0 auto; }
.pv-hd { margin-bottom: 22px; }
.pv-hd h1 { font-size: 20px; margin: 0 0 6px; }
.pv-hd p { color: var(--txt-dim); font-size: 13px; margin: 0 0 4px; max-width: 76ch; line-height: 1.55; }
.pv-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); }
.pv-case { border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: var(--surface); }
.pv-case > h2 { font-size: 13px; margin: 0 0 4px; font-family: var(--font-num); letter-spacing: .04em; }
.pv-case > .why { font-size: 12px; color: var(--txt-dim); margin: 0 0 10px; line-height: 1.5; }
.pv-case > .err { font-size: 11px; font-family: var(--font-num); color: var(--txt-faint);
  margin: 0 0 10px; padding: 5px 8px; border-left: 2px solid var(--line); }
.pv-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
</style></head>
<body>
<div class="pv-hd">
  <h1>Reexecutar a execução que falhou — os cinco estados</h1>
  <p>Corrigir o nó conserta o fluxo dali para a frente. A execução que travou continua travada, e o
  lead dela continua sem resposta. Este bloco é o que fecha isso — e é o único efeito do cockpit que
  sai da instância e não tem desfazer.</p>
  <p>Tudo aqui é extraído de <code>flows.html</code> na hora de gerar: o CSS, as constantes,
  <code>reexecClasse</code> e <code>reexecBloco</code>. Só o <code>reexecutar</code> é falso, para a
  página não escrever em lugar nenhum.</p>
</div>

<div class="pv-bar">
  <button class="btn" id="tema">◐ tema</button>
  <button class="btn" id="falhar">a próxima reexecução: <b>dá certo</b></button>
  <span style="font-size:12px;color:var(--txt-dim);align-self:center">clique nos botões dos casos ambíguos — é o que não cabe num print</span>
</div>

<div class="pv-grid" id="grid"></div>

<script>
${stub}
${bloco}

const CASOS = ${JSON.stringify(CASOS)};

function pintar() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  for (const c of CASOS) {
    const box = el("div", "pv-case");
    box.append(el("h2", null, c.t));
    box.append(el("p", "why", c.d));
    box.append(el("div", "err", "erro: " + c.err));

    const rx = reexecClasse({ error: { message: c.err } });
    const rxres = c.res === "ok" ? { ok: true, error: null, newExecId: "180937", podeTentar: false }
      : c.res === "recusado" ? { ok: false, newExecId: null, podeTentar: true,
          error: "o n8n recusou a reexecução: n8n 400 em /api/v1/executions/180936/retry — nada rodou, dá para tentar de novo" }
      : c.res === "perdido" ? { ok: false, newExecId: null, podeTentar: false,
          error: "socket hang up — uma resposta perdida não prova que ela não começou" }
      : null;
    box.append(reexecBloco(rx, rxres, "180936", "rpreview1"));

    const tag = el("div", "err", "classe: " + rx.classe + (rx.por ? " · " + rx.por : ""));
    box.append(tag);
    grid.append(box);
  }
}

document.getElementById("tema").onclick = () => {
  const r = document.documentElement;
  const escuro = r.getAttribute("data-theme") === "dark"
    || (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  r.setAttribute("data-theme", escuro ? "light" : "dark");
};
const MODOS = ["dá certo", "n8n recusa (nada rodou)", "resposta se perde (indefinido)"];
const bf = document.getElementById("falhar");
bf.onclick = () => {
  MODO = (MODO + 1) % 3;
  bf.innerHTML = "a próxima reexecução: <b>" + MODOS[MODO] + "</b>";
};

pintar();
</script>
</body></html>`;

const out = path.join(__dirname, "reexec.html");
fs.writeFileSync(out, page, "utf8");
console.log("escrito: " + out);
console.log("abra com dois cliques. clique no botão do caso ambíguo — é o que não cabe num print.");
