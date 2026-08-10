/* gen-pergunta-preview.js — generates preview/pergunta-modelos.html from tester.html.
 *
 * Same pattern as gen-mocks-preview.js: the CSS and the renderers are EXTRACTED
 * from tester.html at generation time, never hand-copied, so this page cannot
 * drift from the real screen. It exists to eyeball two things that only show up
 * mid-interview and are therefore expensive to reach in a live build:
 *   - the option-as-message picker, on all four surfaces plus the plain chips;
 *   - the three states of a "o que eu entendi" row (answered / open / assumed).
 * Regenerate: node preview/gen-pergunta-preview.js
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

function grabLinha(prefixo) {
  const l = html.split("\n").find(x => x.trimStart().startsWith(prefixo));
  if (!l) throw new Error(prefixo + " not found");
  return l.trim();
}

const SLACK = [
  "*Novo e-mail na caixa de entrada*",
  "*De:* {{ remetente }}",
  "*Assunto:* {{ assunto }}"
].join("\n");

const perguntas = [
  {
    q: "O que a mensagem no Slack precisa mostrar do e-mail?",
    porque: "define os campos que o fluxo extrai do e-mail para montar o texto da mensagem",
    opcoes: ["Remetente e assunto", "Remetente, assunto e trecho do corpo", "Remetente, assunto, corpo e link para abrir o e-mail"],
    previa: "slack",
    modelos: {
      "Remetente e assunto": SLACK,
      "Remetente, assunto e trecho do corpo": SLACK + "\n\n> {{ trecho_do_corpo }}",
      "Remetente, assunto, corpo e link para abrir o e-mail": SLACK + "\n\n> {{ trecho_do_corpo }}\n\n<{{ link_do_email }}|Abrir no Gmail>"
    }
  },
  {
    q: "Como o aviso chega no WhatsApp?",
    porque: "muda o tamanho do texto e se o fluxo manda uma bolha ou várias",
    opcoes: ["Uma bolha curta", "Bolha com os detalhes do pedido"],
    previa: "whatsapp",
    modelos: {
      "Uma bolha curta": "Pedido novo: {{ produto }} — R$ {{ total }}",
      "Bolha com os detalhes do pedido": "Pedido novo no Mercado Livre\nProduto: {{ produto }}\nTotal: R$ {{ total }}\nComprador: {{ comprador }}"
    }
  },
  {
    q: "Qual o formato do relatório semanal por e-mail?",
    porque: "define o assunto e o corpo que o fluxo monta",
    opcoes: ["Resumo em uma linha", "Resumo com quebra por canal"],
    previa: "email",
    modelos: {
      "Resumo em uma linha": "Assunto: Faturamento da semana — R$ {{ total_semana }}\n\nA semana fechou em R$ {{ total_semana }}, com {{ qtd_pedidos }} pedidos.",
      "Resumo com quebra por canal": "Assunto: Faturamento da semana — R$ {{ total_semana }}\n\nTotal: R$ {{ total_semana }} em {{ qtd_pedidos }} pedidos.\nMercado Livre: R$ {{ total_ml }}\nShopee: R$ {{ total_shopee }}"
    }
  },
  {
    q: "O que o registro guarda?",
    porque: "destino sem anatomia própria cai na prévia neutra",
    opcoes: ["Só o identificador", "Identificador e valor"],
    previa: "texto",
    modelos: {
      "Só o identificador": "pedido_id = {{ pedido_id }}",
      "Identificador e valor": "pedido_id = {{ pedido_id }}\ntotal = {{ total }}"
    }
  },
  {
    q: "Com que frequência o fluxo deve checar?",
    porque: "pergunta sem modelos continua sendo chip, como sempre foi",
    opcoes: ["A cada 5 minutos", "De hora em hora", "Uma vez por dia"]
  }
];

const cartoes = [
  { titulo: "entrevista ABERTA — o campo em aberto ainda vai ser perguntado",
    dono: { perguntas: [{ q: "x" }], etapa: 1 },
    e: { quando: "toda vez que chegar um novo e-mail", oQueFaz: "envia um aviso no Slack",
         resultado: "mensagem no Slack avisando sobre o e-mail recebido", ondeChega: "não disse" } },
  { titulo: "entrevista FECHADA, campo vazio — ninguém mais vai perguntar",
    dono: { perguntas: [], etapa: 4 },
    e: { quando: "toda vez que chegar um novo e-mail", oQueFaz: "envia um aviso no Slack",
         resultado: "mensagem no Slack avisando sobre o e-mail recebido", ondeChega: "não disse" } },
  { titulo: "suposição DECLARADA pelo modelo",
    dono: { perguntas: [], etapa: 4 },
    e: { quando: "toda vez que chegar um novo e-mail", oQueFaz: "envia um aviso no Slack",
         resultado: "mensagem no Slack avisando sobre o e-mail recebido",
         ondeChega: "suposição: canal #geral do Slack, o único que a conta tem conectado" } },
  { titulo: "tudo respondido — nenhum aviso, nenhum rodapé",
    dono: { perguntas: [], etapa: 4 },
    e: { quando: "toda vez que chegar um novo e-mail", oQueFaz: "envia um aviso no Slack",
         resultado: "mensagem no Slack avisando sobre o e-mail recebido", ondeChega: "canal #avisos do Slack" } }
];

const page = [
  "<!doctype html>",
  '<html lang="pt-BR"><head><meta charset="utf-8"><title>preview · pergunta com modelo</title>',
  "<style>", css,
  ".pv-h{font-family:var(--font-num);font-size:10px;letter-spacing:.06em;color:var(--txt-faint);" +
    "margin:26px 0 9px;border-top:1px solid var(--line-soft);padding-top:14px}",
  "</style></head><body>",
  '<div style="max-width:74ch;margin:30px auto 60px;padding:0 16px">',
  '<div id="alvo"></div>',
  "</div>",
  "<script>",
  '"use strict";',
  'const tema = new URLSearchParams(location.search).get("theme");',
  'if (tema === "light" || tema === "dark") document.documentElement.setAttribute("data-theme", tema);',
  "const esc = s => String(s == null ? \"\" : s).replace(/[&<>\"']/g, c => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));",
  'const HORA_SIM = "09:00";',
  "const S = { respostas: {} };",
  grabLinha("const marcarCampos ="),
  grab("previaModelo"),
  grab("pergunta"),
  grab("cartaoEntendi"),
  "const perguntas = " + JSON.stringify(perguntas, null, 1) + ";",
  "const cartoes = " + JSON.stringify(cartoes, null, 1) + ";",
  // A primeira opção de cada pergunta já vem marcada: o estado selecionado é o
  // que precisa ser conferido contra o não-selecionado, lado a lado.
  "for (const q of perguntas) if (q.modelos) S.respostas[q.q] = q.opcoes[0];",
  "document.getElementById('alvo').innerHTML =",
  "  cartoes.map(c => '<div class=\"pv-h\">' + esc(c.titulo) + '</div>' + cartaoEntendi(c.e, c.dono)).join('') +",
  "  perguntas.map(q => '<div class=\"pv-h\">' + esc(q.previa ? 'previa: ' + q.previa : 'sem modelos — chip de sempre') + '</div>' + pergunta(q)).join('');",
  "</script></body></html>"
].join("\n");

const out = path.join(__dirname, "pergunta-modelos.html");
fs.writeFileSync(out, page, "utf8");
console.log("written " + out);
