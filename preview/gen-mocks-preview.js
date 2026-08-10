/* gen-mocks-preview.js — generates preview/mocks-fantasma.html from tester.html.
 *
 * Same pattern as preview/canvas-n8n.html: a standalone page to eyeball a piece
 * of UI before (and after) it ships. Nothing is hand-copied — the CSS and the
 * renderer are EXTRACTED from tester.html at generation time, so this preview
 * cannot drift from the real screen. Regenerate: node preview/gen-mocks-preview.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

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

const NAO = "⟨não simulada⟩";
const casos = [
  { no: "slack_avisar_pedido_novo", superficie: "slack", rotulo: "Slack",
    envio: { canal: "#pedidos", texto: "Pedido novo no Mercado Livre!\nProduto: Camiseta Dry Fit · R$ 89,90\nPedido #2000004321 · comprador: Ana C." } },
  { no: "avisar_whatsapp", superficie: "whatsapp", rotulo: "WhatsApp",
    envio: { para: "+55 41 9****-1395", texto: "Chegou pedido novo: R$ 150,00 — " + NAO } },
  { no: "mandar_email", superficie: "email", rotulo: "Gmail",
    envio: { para: "equipe@ecommercepuro.com.br", assunto: "Venda confirmada #4321", texto: "O pedido 4321 foi pago.\nTotal: R$ 89,90" } },
  { no: "gravar_lead", superficie: "linha", rotulo: "Supabase",
    envio: { tabela: "pedidos_avisados", campos: { fieldsUi: { fieldValues: [
      { fieldId: "pedido_id", fieldValue: "2000004321" },
      { fieldId: "total", fieldValue: "89.90" },
      { fieldId: "avisado_em", fieldValue: "2026-01-15T09:00:00.000Z" }] } } } },
  { no: "responder_chamada", superficie: "resposta", rotulo: "Resposta do webhook",
    envio: { texto: '{"ok":true,"recebido":1}' } },
  { no: "gravar_redis", superficie: "generico", tipo: "n8n-nodes-base.redis",
    envio: { operation: "set", key: "ml:ultimo_pedido", value: "2000004321" } }
];

const page = [
  "<!doctype html>",
  '<html lang="pt-BR"><head><meta charset="utf-8"><title>preview · mockups do fantasma</title>',
  "<style>", css, "</style></head><body>",
  '<div style="max-width:70ch;margin:30px auto;padding:0 16px">',
  '<div class="surf" style="max-width:none"><div class="sh">[ 06 ] O QUE ISTO PRODUZIRIA · preview estático</div>',
  "<div id='alvo'></div>",
  "</div></div>",
  "<script>",
  '"use strict";',
  'const tema = new URLSearchParams(location.search).get("theme");',
  'if (tema === "light" || tema === "dark") document.documentElement.setAttribute("data-theme", tema);',
  "const esc = s => String(s == null ? \"\" : s).replace(/[&<>\"']/g, c => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));",
  'const HORA_SIM = "09:00";',
  grab("linhaCampos"),
  grab("superficie"),
  "const casos = " + JSON.stringify(casos, null, 1) + ";",
  "document.getElementById('alvo').innerHTML = casos.map((x, i) => superficie(x, i, true)).join('');",
  "</script></body></html>"
].join("\n");

const out = path.join(__dirname, "mocks-fantasma.html");
fs.writeFileSync(out, page, "utf8");
console.log("written " + out);
