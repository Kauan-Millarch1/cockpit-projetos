/* gen-credenciais-preview.js — generates preview/credenciais.html from tester.html.
 *
 * Same pattern as the other generators: CSS and renderer extracted from
 * tester.html, never hand-copied. The checklist itself is not a fixture either —
 * it comes out of the real `checklistCredenciais` in tester.js, so what shows up
 * here is the exact object the screen receives.
 *
 * Three states worth looking at side by side, because they say three different
 * things and only one of them is good news: everything of a type he already
 * uses, something with no credential of that type anywhere, and the empty case.
 * Regenerate: node preview/gen-credenciais-preview.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { checklistCredenciais, ligacaoCredenciais } = require("../tester");

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

/* A forma é a do catálogo real: `nodes[tipo].credenciais` são os tipos de
 * credencial que aquele tipo de nó usa NOS FLUXOS DELE, e `credenciaisPorTipo` é
 * o que faz `visto` ser verdadeiro. */
const cat = {
  nodes: {
    "n8n-nodes-base.gmailTrigger": { credenciais: ["gmailOAuth2"] },
    "n8n-nodes-base.set": { credenciais: [] },
    "n8n-nodes-base.if": { credenciais: [] },
    "n8n-nodes-base.slack": { credenciais: ["slackApi", "slackOAuth2Api"] },
    "n8n-nodes-base.supabase": { credenciais: ["supabaseApi"] },
    "n8n-nodes-base.httpRequest": { credenciais: ["httpHeaderAuth", "httpBasicAuth"] }
  },
  credenciaisPorTipo: { slackApi: 6, supabaseApi: 12, httpHeaderAuth: 3, slackOAuth2Api: 1 },
  /* O inventário possível: as credenciais que os fluxos dele REFERENCIAM. Não é
   * a lista da conta — `GET /credentials` responde 405 e essa lista não existe
   * para ninguém aqui. */
  credenciaisConhecidas: [
    { tipo: "supabaseApi", id: "sb1", nome: "Supabase Ecommerce Puro", usos: 12 },
    { tipo: "slackApi", id: "sk1", nome: "Slack Ecommerce Puro", usos: 6 },
    { tipo: "httpHeaderAuth", id: "hh1", nome: "Header do parceiro", usos: 3 },
    { tipo: "slackOAuth2Api", id: "sk2", nome: "Slack OAuth antigo", usos: 1 }
  ]
};

const porTipo = new Map([
  ["slackApi", { tipo: "slackApi", visto: true, campos: ["accessToken"] }],
  ["slackOAuth2Api", { tipo: "slackOAuth2Api", visto: false, campos: ["clientId", "clientSecret"] }],
  ["supabaseApi", { tipo: "supabaseApi", visto: true, campos: ["host", "serviceRole"] }],
  ["gmailOAuth2", { tipo: "gmailOAuth2", visto: false, campos: ["clientId", "clientSecret"] }],
  ["httpHeaderAuth", { tipo: "httpHeaderAuth", visto: true, campos: ["name", "value"] }],
  ["httpBasicAuth", { tipo: "httpBasicAuth", visto: false, campos: ["user", "password"] }]
]);

const wf = {
  nodes: [
    { name: "trigger_gmail_novo_email", type: "n8n-nodes-base.gmailTrigger" },
    { name: "filtrar_remetente_cliente", type: "n8n-nodes-base.if" },
    { name: "montar_mensagem_email", type: "n8n-nodes-base.set" },
    { name: "slack_dm_aviso_email", type: "n8n-nodes-base.slack" },
    { name: "gravar_registro_aviso", type: "n8n-nodes-base.supabase" },
    { name: "chamar_api_do_parceiro", type: "n8n-nodes-base.httpRequest" }
  ]
};

const casos = [
  { titulo: "fluxo misto — o Supabase e o HTTP já vão ligados, o Slack é ambíguo e o Gmail não existe",
    s: {
      ingredientes: { porNo: checklistCredenciais(wf, cat, porTipo) },
      credLigacao: ligacaoCredenciais(wf, cat)
    } },
  { titulo: "nenhum nó pede credencial — e a frase não promete que nenhum vai pedir",
    s: { ingredientes: { porNo: [] }, credLigacao: { ligados: [], vazios: [] } } }
];

const page = [
  "<!doctype html>",
  '<html lang="pt-BR"><head><meta charset="utf-8"><title>preview · checklist de credenciais</title>',
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
  'const S = { capab: { instancia: "https://ecommercepuro.app.n8n.cloud" } };',
  grab("checklistCred"),
  grab("faixaExport"),
  "const S2 = { ligarCred: true };",
  "const ligarCred = () => S2.ligarCred;",
  "const casos = " + JSON.stringify(casos, null, 1) + ";",
  // A faixa do export tem dois estados e eles dizem coisas diferentes: ligado
  // conta o que já vai pronto, desligado explica para que serve o JSON limpo.
  // `vivo` decide se a linha empatada ganha botão: numa sessão aberta dá para
  // escolher ali mesmo; num projeto só olhado, ela diz onde escolher.
  "document.getElementById('alvo').innerHTML = casos.map(c =>",
  "  '<div class=\"pv-h\">' + esc(c.titulo) + '</div>' + checklistCred(c.s, true) + faixaExport(c.s)).join('') +",
  "  '<div class=\"pv-h\">o mesmo fluxo num projeto só aberto para ler — sem botão, com o caminho dito</div>' +",
  "  checklistCred(casos[0].s, false) +",
  "  (() => { S2.ligarCred = false;",
  "    return '<div class=\"pv-h\">a mesma faixa com o interruptor desligado — JSON limpo</div>' + faixaExport(casos[0].s); })();",
  "</script></body></html>"
].join("\n");

const out = path.join(__dirname, "credenciais.html");
fs.writeFileSync(out, page, "utf8");
console.log("written " + out);
