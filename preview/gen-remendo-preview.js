/* gen-remendo-preview.js — generates preview/remendo.html from tester.html.
 *
 * Same pattern as the other two generators: CSS and renderers are EXTRACTED from
 * tester.html, never hand-copied. The diff is not a fixture either — it is built
 * by the real `diffWorkflow` from claude-fix.js over two real workflows, so what
 * you look at here is the exact object the review band receives.
 *
 * It exists because reaching this screen for real costs a model call and a few
 * minutes, and the screen is the one that decides whether a saved flow changes.
 * Regenerate: node preview/gen-remendo-preview.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { diffWorkflow } = require("../claude-fix");
const { aplicarRemendo } = require("../tester");

const html = fs.readFileSync(path.join(__dirname, "..", "tester.html"), "utf8");
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!css) throw new Error("style block not found");

function grab(nome) {
  const re = new RegExp("function " + nome + "\\([^)]*\\) \\{");
  const i = html.search(re);
  if (i < 0) throw new Error(nome + " not found");
  let d = 0;
  for (let k = html.indexOf("{", i); k < html.length; k++) {
    if (html[k] === "{") d++;
    if (html[k] === "}") { d--; if (!d) return html.slice(i, k + 1); }
  }
}

const salvo = {
  name: "aviso_slack_email_novo",
  nodes: [
    { name: "trigger_gmail_novo_email", type: "n8n-nodes-base.gmailTrigger", typeVersion: 1, position: [0, 0],
      parameters: { pollTimes: { item: [{ mode: "everyMinute" }] }, simple: false } },
    { name: "montar_mensagem_email", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [220, 0],
      parameters: { mode: "manual", assignments: { assignments: [
        { name: "texto", type: "string", value: "=*Novo e-mail*\\n*De:* {{ $json.from.value[0].address }}" }] } } },
    { name: "slack_dm_aviso_email", type: "n8n-nodes-base.slack", typeVersion: 2.2, position: [440, 0],
      parameters: { select: "user", text: "={{ $json.texto }}" }, retryOnFail: true, maxTries: 3 }
  ],
  connections: {
    trigger_gmail_novo_email: { main: [[{ node: "montar_mensagem_email", type: "main", index: 0 }]] },
    montar_mensagem_email: { main: [[{ node: "slack_dm_aviso_email", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1" }
};

// O pedido: "só me avisa quando o e-mail for de cliente, e guarda um registro".
const remendo = aplicarRemendo(salvo, {
  updateNodes: [{ name: "slack_dm_aviso_email", maxTries: 5, waitBetweenTries: 2000 }],
  addNodes: [
    { name: "filtrar_remetente_cliente", type: "n8n-nodes-base.if", typeVersion: 2, position: [110, 0],
      parameters: { conditions: { conditions: [{ leftValue: "={{ $json.from.value[0].address }}", operator: { type: "string", operation: "contains" }, rightValue: "[PREENCHER]" }] } } },
    { name: "gravar_registro_aviso", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [660, 0],
      parameters: { mode: "manual" } }
  ],
  rewire: {
    trigger_gmail_novo_email: { main: [[{ node: "filtrar_remetente_cliente", type: "main", index: 0 }]] },
    filtrar_remetente_cliente: { main: [[{ node: "montar_mensagem_email", type: "main", index: 0 }], []] },
    slack_dm_aviso_email: { main: [[{ node: "gravar_registro_aviso", type: "main", index: 0 }]] }
  }
});
if (remendo.errors.length) throw new Error("o remendo do preview não aplica: " + remendo.errors.join(" · "));

// Um segundo caso: remoção. É o único verbo que este caminho tem e o de
// produção não — a faixa amarela dele precisa ser vista.
const comRemocao = aplicarRemendo(salvo, {
  removeNodes: ["montar_mensagem_email"],
  updateNodes: [{ name: "slack_dm_aviso_email", parameters: { select: "user", text: "={{ $json.snippet }}" } }],
  rewire: { trigger_gmail_novo_email: { main: [[{ node: "slack_dm_aviso_email", type: "main", index: 0 }]] } }
});
if (comRemocao.errors.length) throw new Error("o remendo com remoção não aplica: " + comRemocao.errors.join(" · "));

const casos = [
  { titulo: "remendo que acrescenta e altera",
    proposta: {
      pedido: "só me avisa quando o e-mail for de cliente, e guarda um registro",
      rodada: 1,
      resumo: "Acrescentei um filtro antes da mensagem e um registro depois do envio, e aumentei a tentativa do Slack de 3 para 5.",
      porque: "O pedido tem duas partes. O filtro entra entre o gatilho e a montagem, porque filtrar depois de montar gastaria o trabalho à toa. O registro entra depois do envio, para só gravar o que realmente saiu.",
      removidos: [],
      diff: diffWorkflow(salvo, remendo.workflow)
    } },
  { titulo: "remendo que APAGA um nó — a faixa amarela é obrigatória",
    proposta: {
      pedido: "tira o passo do meio, manda o texto do e-mail direto",
      rodada: 2,
      resumo: "Removi o nó que montava a mensagem e liguei o gatilho direto no Slack, com o trecho do e-mail no texto.",
      porque: "Sem o passo de montagem o texto passa a vir do próprio gatilho.",
      removidos: ["montar_mensagem_email"],
      diff: diffWorkflow(salvo, comRemocao.workflow)
    } }
];

const page = [
  "<!doctype html>",
  '<html lang="pt-BR"><head><meta charset="utf-8"><title>preview · remendo de projeto salvo</title>',
  "<style>", css,
  ".pv-h{font-family:var(--font-num);font-size:10px;letter-spacing:.06em;color:var(--txt-faint);" +
    "margin:26px 0 9px;border-top:1px solid var(--line-soft);padding-top:14px}",
  "</style></head><body>",
  '<div style="max-width:74ch;margin:30px auto 60px;padding:0 16px"><div id="alvo"></div></div>',
  "<script>",
  '"use strict";',
  'const tema = new URLSearchParams(location.search).get("theme");',
  'if (tema === "light" || tema === "dark") document.documentElement.setAttribute("data-theme", tema);',
  "const esc = s => String(s == null ? \"\" : s).replace(/[&<>\"']/g, c => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));",
  // O fantasma tem bloco próprio e preview próprio (mocks-fantasma.html); aqui
  // ele é stub para a banda de revisão poder ser lida sozinha.
  "const fantasmaBloco = () => '';",
  grab("propostaBloco"),
  grab("diffBloco"),
  "const casos = " + JSON.stringify(casos, null, 1) + ";",
  "document.getElementById('alvo').innerHTML = casos.map(c =>",
  "  '<div class=\"pv-h\">' + esc(c.titulo) + '</div>' + propostaBloco({ proposta: c.proposta })).join('');",
  "</script></body></html>"
].join("\n");

const out = path.join(__dirname, "remendo.html");
fs.writeFileSync(out, page, "utf8");
console.log("written " + out);
