/* simulate.js — o fantasma. PLAN.md §9.
 *
 * Deriva do JSON do fluxo, por código, o que ele PRODUZIRIA. Nunca pergunta a um
 * modelo: um modelo perguntado sobre o próprio fluxo sempre responde que
 * funciona.
 *
 * A linha que separa honesto de inventado passa dentro de cada nó:
 *
 *   SAÍDA (outbound) é DERIVADA. O texto que o nó do Slack mandaria é o `text`
 *   daquele nó com as expressões resolvidas contra o que vem antes. Se nada
 *   antes define `$json.titulo`, o campo sai vazio e o motivo é dito. É aqui que
 *   o teste morde.
 *
 *   ENTRADA (inbound) é SEMEADA. O que o Mercado Livre responderia ninguém sabe
 *   sem chamar, e a API pública do n8n não tem execução. Vem de `seeds`, sempre
 *   rotulada na tela.
 *
 * FALHA FECHADO. Fora da classe declarada (linear, um item, tipos da whitelist,
 * expressões do subconjunto medido) ele NÃO desenha um resultado parcial: ele
 * recusa e diz qual nó ou qual expressão não sabe simular. Meio-quadro
 * apresentado como resultado é pior que quadro nenhum.
 *
 * Uso como biblioteca: simulate(workflow, { seeds })
 * Auto-teste:          node simulate.js
 */

"use strict";

/* ------------------------------------------------------------- whitelist */

/* Tipos que o V1 sabe simular. Tudo fora daqui é recusa declarada, não palpite.
 * A lista veio do catálogo real da instância (catalog.js): são os tipos que
 * aparecem em fluxo linear de um item. `code` está de fora DE PROPÓSITO — ele
 * roda JavaScript arbitrário, e fingir que sei o que ele devolve é exatamente a
 * mentira que este arquivo existe para não contar. */
const TRIGGERS = new Set([
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.cron",
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.executeWorkflowTrigger"
]);

const PASSTHROUGH = new Set(["n8n-nodes-base.noOp", "n8n-nodes-base.set"]);
const BRANCH      = new Set(["n8n-nodes-base.if"]);
const FETCH       = new Set(["n8n-nodes-base.httpRequest"]);

/* Superfície de destino: como o resultado é desenhado. O nó diz qual é. */
const SURFACES = {
  "n8n-nodes-base.slack":        { surface: "slack",    campos: { canal: ["channelId", "channel", "select"], texto: ["text", "message"] } },
  "n8n-nodes-base.whatsApp":     { surface: "whatsapp", campos: { para: ["recipientPhoneNumber", "to"], texto: ["textBody", "text", "message"] } },
  "n8n-nodes-base.telegram":     { surface: "whatsapp", campos: { para: ["chatId"], texto: ["text"] } },
  "n8n-nodes-base.gmail":        { surface: "email",    campos: { para: ["sendTo", "to"], assunto: ["subject"], texto: ["message", "html"] } },
  "n8n-nodes-base.emailSend":    { surface: "email",    campos: { para: ["toEmail"], assunto: ["subject"], texto: ["text", "html"] } },
  "n8n-nodes-base.supabase":     { surface: "linha",    campos: { tabela: ["tableId", "table"] } },
  "n8n-nodes-base.googleSheets": { surface: "linha",    campos: { tabela: ["sheetName", "documentId"] } },
  "n8n-nodes-base.respondToWebhook": { surface: "resposta", campos: { texto: ["respondWith", "responseBody"] } }
};

const NAO_SIMULADA = "⟨não simulada⟩";

const isAnnotation = t => /stickyNote/i.test(String(t || ""));

/* ----------------------------------------------------------- expressões */

/* O subconjunto medido em catalog.js: 88% das 2284 expressões desta instância.
 * Só acesso a campo — nada de método, ternário, template literal ou `$if`.
 * Deliberadamente NÃO uso `eval` nem `new Function`: além do risco óbvio com
 * texto que passou por uma página web, um avaliador que "quase" roda JS produz
 * resultados que parecem certos e não são. */
const RAIZ = /^(\$json|\$\(\s*(['"])((?:\\.|[^'"\\])*)\2\s*\)(?:\s*\.\s*(?:item|first\(\)|last\(\)))?\s*\.\s*json|\$now|\$today)/;
const PASSO = /^\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['"])((?:\\.|[^'"\\])*)\2\s*\]|\[\s*(\d+)\s*\])/;

function avaliarUm(texto, ctx) {
  const m = RAIZ.exec(texto.trim());
  if (!m) return { erro: "expressão fora do subconjunto simulável" };

  let valor, resto = texto.trim().slice(m[0].length);
  if (m[1] === "$now" || m[1] === "$today") {
    // Data fixa e declarada. Um relógio de verdade faria a mesma simulação dar
    // resultado diferente a cada olhada, e nada aqui mede tempo real.
    valor = ctx.agora;
  } else if (m[1] === "$json") {
    valor = ctx.json;
  } else {
    const nome = m[3].replace(/\\(.)/g, "$1");
    if (!(nome in ctx.porNo)) return { erro: `nenhum nó chamado "${nome}" antes deste` };
    valor = ctx.porNo[nome];
  }

  while (resto.length) {
    const p = PASSO.exec(resto);
    if (!p) return { erro: "expressão fora do subconjunto simulável" };
    const chave = p[1] !== undefined ? p[1] : (p[3] !== undefined ? p[3].replace(/\\(.)/g, "$1") : Number(p[4]));
    if (valor === null || valor === undefined) return { erro: `caminho interrompido em .${chave}` };
    valor = valor[chave];
    resto = resto.slice(p[0].length);
  }
  if (valor === undefined) return { vazio: true };
  return { valor };
}

/* O n8n marca campo em modo expressão com um `=` na frente do valor:
 * `"text": "={{ $json.total }} vendas"`. Esse `=` não faz parte do texto. Deixá-lo
 * passar transforma `{{ $json.total }}` em `"=3"`, e aí `Number("=3")` é `NaN` —
 * um IF compararia NaN > 0, escolheria o ramo falso e a simulação seguiria
 * confiante pelo caminho errado, sem erro nenhum na tela. */
const semMarcador = s => (typeof s === "string" && s.startsWith("=") ? s.slice(1) : s);

/* Resolve uma string inteira: pedaços literais + `{{ … }}`. Devolve o texto e
 * as pendências — nunca inventa valor para o que não soube avaliar. */
function resolverTexto(bruta, ctx) {
  const s = semMarcador(bruta);
  const notas = [];
  let saida = "", i = 0, mexeu = false;
  while (i < s.length) {
    const ab = s.indexOf("{{", i);
    if (ab < 0) { saida += s.slice(i); break; }
    const fe = s.indexOf("}}", ab);
    if (fe < 0) { saida += s.slice(i); break; }
    saida += s.slice(i, ab);
    mexeu = true;
    const dentro = s.slice(ab + 2, fe);
    const r = avaliarUm(dentro, ctx);
    if (r.erro) { saida += NAO_SIMULADA; notas.push({ expr: dentro.trim(), motivo: r.erro }); }
    else if (r.vazio) { notas.push({ expr: dentro.trim(), motivo: "chega vazio: nenhum nó anterior define este campo" }); }
    else saida += (typeof r.valor === "object" ? JSON.stringify(r.valor) : String(r.valor));
    i = fe + 2;
  }
  return { texto: saida, notas, mexeu };
}

function resolverFundo(v, ctx, notas) {
  if (typeof v === "string") {
    if (!v.includes("{{")) return semMarcador(v);
    const r = resolverTexto(v, ctx);
    notas.push(...r.notas);
    return r.texto;
  }
  if (Array.isArray(v)) return v.map(x => resolverFundo(x, ctx, notas));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = resolverFundo(val, ctx, notas);
    return out;
  }
  return v;
}

/* ------------------------------------------------------------- topologia */

/* Ordem de execução, e a recusa quando o fluxo sai da classe suportada.
 * "Linear e de um item" não é preguiça: modelar array de itens, merge e laço
 * pela metade produz um quadro confiante e errado. */
function ordenar(wf) {
  const nodes = (wf.nodes || []).filter(n => n && !isAnnotation(n.type));
  const porNome = new Map(nodes.map(n => [n.name, n]));
  const conex = wf.connections || {};

  const entradas = new Map();
  const saidas = new Map();
  for (const [de, portas] of Object.entries(conex)) {
    for (const ramos of Object.values(portas || {})) {
      (ramos || []).forEach((lista, idx) => {
        for (const c of lista || []) {
          if (!c || !c.node) continue;
          (saidas.get(de) || saidas.set(de, []).get(de)).push({ para: c.node, ramo: idx });
          entradas.set(c.node, (entradas.get(c.node) || 0) + 1);
        }
      });
    }
  }

  const gatilhos = nodes.filter(n => TRIGGERS.has(n.type) || !entradas.get(n.name));
  if (!gatilhos.length) return { erro: "o fluxo não tem nó de início — não dá para simular sem saber por onde começa" };
  if (gatilhos.length > 1) {
    return { erro: `o fluxo tem ${gatilhos.length} pontos de início (${gatilhos.map(g => g.name).join(", ")}). O V1 só simula fluxo com um começo.` };
  }
  for (const [nome, n] of entradas) {
    if (n > 1) return { erro: `o nó "${nome}" recebe ${n} entradas (junção). O V1 só simula caminho linear.` };
  }
  return { inicio: gatilhos[0], porNome, saidas };
}

/* ------------------------------------------------------------- nós, um a um */

function primeiroCampo(params, nomes) {
  for (const n of nomes || []) {
    const v = params[n];
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      // resource locator: { __rl, value, mode }
      if (typeof v.value === "string" || typeof v.value === "number") return String(v.value);
      continue;
    }
    if (String(v).length) return String(v);
  }
  return null;
}

/* Condição de IF v2+: estrutura declarada, não JS. Só operações que dá para
 * decidir com certeza; qualquer outra recusa o fluxo inteiro em vez de chutar
 * um ramo — chutar o ramo é escolher o resultado. */
function avaliarCondicao(cond, ctx, notas) {
  const grupos = (cond && cond.conditions) || [];
  if (!grupos.length) return { erro: "IF sem condição legível" };
  const combin = (cond.combinator || "and").toLowerCase();
  const parciais = [];
  for (const c of grupos) {
    const esq = resolverFundo(c.leftValue, ctx, notas);
    const dir = resolverFundo(c.rightValue, ctx, notas);
    const op = (c.operator && c.operator.operation) || "";
    const vazio = v => v === undefined || v === null || v === "" || v === NAO_SIMULADA;
    let r;
    switch (op) {
      case "equals":    r = String(esq) === String(dir); break;
      case "notEquals": r = String(esq) !== String(dir); break;
      case "contains":  r = String(esq).includes(String(dir)); break;
      case "notContains": r = !String(esq).includes(String(dir)); break;
      case "exists": case "notEmpty": r = !vazio(esq); break;
      case "notExists": case "empty": r = vazio(esq); break;
      case "gt":  r = Number(esq) >  Number(dir); break;
      case "gte": r = Number(esq) >= Number(dir); break;
      case "lt":  r = Number(esq) <  Number(dir); break;
      case "lte": r = Number(esq) <= Number(dir); break;
      case "true":  r = esq === true || String(esq) === "true"; break;
      case "false": r = esq === false || String(esq) === "false"; break;
      default: return { erro: `operação "${op || "?"}" do IF não está no conjunto simulável` };
    }
    if (String(esq).includes(NAO_SIMULADA)) return { erro: "o IF compara um campo que não soube simular" };
    parciais.push(r);
  }
  return { valor: combin === "or" ? parciais.some(Boolean) : parciais.every(Boolean) };
}

function aplicarSet(params, ctx, notas) {
  const a = params.assignments && params.assignments.assignments;
  const base = params.includeOtherFields === false ? {} : Object.assign({}, ctx.json);
  if (!Array.isArray(a)) {
    // v2 usava `values.string[]`; fora da classe declarada.
    return { erro: "este nó Set usa um formato que o V1 não simula" };
  }
  for (const asg of a) {
    if (!asg || !asg.name) continue;
    const v = resolverFundo(asg.value, ctx, notas);
    base[asg.name] = asg.type === "number" ? Number(v) : (asg.type === "boolean" ? (v === true || v === "true") : v);
  }
  return { json: base };
}

/* ---------------------------------------------------------------- simular */

function simulate(workflow, { seeds = {}, agora = "2026-01-15T09:00:00.000Z" } = {}) {
  const passos = [];
  const pendencias = [];
  const superficies = [];

  const t = ordenar(workflow || {});
  if (t.erro) return { ok: false, recusa: t.erro, passos, superficies, pendencias };

  const ctx = { json: {}, porNo: {}, agora };
  let atual = t.inicio;
  let guarda = 0;

  while (atual) {
    if (++guarda > 60) return { ok: false, recusa: "o fluxo é longo demais ou tem laço — o V1 não simula laço.", passos, superficies, pendencias };

    const tipo = String(atual.type || "");
    const params = atual.parameters || {};
    const notas = [];
    let ramoEscolhido = 0;
    const passo = { no: atual.name, tipo, notas };

    if (TRIGGERS.has(tipo)) {
      const s = seeds[atual.name];
      ctx.json = (s && typeof s === "object") ? s : {};
      passo.papel = "início";
      passo.json = ctx.json;
      passo.semente = !!s;
      if (!s) notas.push({ motivo: "sem semente para o início: os campos abaixo chegam vazios" });

    } else if (PASSTHROUGH.has(tipo)) {
      passo.papel = "dados";
      if (tipo === "n8n-nodes-base.set") {
        const r = aplicarSet(params, ctx, notas);
        if (r.erro) return { ok: false, recusa: `no nó "${atual.name}": ${r.erro}`, passos, superficies, pendencias };
        ctx.json = r.json;
      }
      passo.json = ctx.json;

    } else if (FETCH.has(tipo)) {
      passo.papel = "chamada externa";
      const url = resolverFundo(params.url, ctx, notas);
      passo.envio = {
        metodo: String(params.method || "GET").toUpperCase(),
        url: typeof url === "string" ? url : NAO_SIMULADA,
        corpo: params.jsonBody !== undefined ? resolverFundo(params.jsonBody, ctx, notas) : undefined
      };
      const s = seeds[atual.name];
      if (s && typeof s === "object") { ctx.json = s; passo.semente = true; }
      else {
        ctx.json = {};
        passo.semente = false;
        notas.push({ motivo: "sem semente de resposta: nada foi chamado, então tudo depois deste nó chega vazio" });
      }
      passo.json = ctx.json;

    } else if (BRANCH.has(tipo)) {
      passo.papel = "decisão";
      const r = avaliarCondicao(params.conditions, ctx, notas);
      if (r.erro) return { ok: false, recusa: `no nó "${atual.name}": ${r.erro}`, passos, superficies, pendencias };
      ramoEscolhido = r.valor ? 0 : 1;
      passo.ramo = r.valor ? "verdadeiro" : "falso";
      passo.json = ctx.json;

    } else if (SURFACES[tipo]) {
      const def = SURFACES[tipo];
      passo.papel = "destino";
      const envio = {};
      for (const [rotulo, chaves] of Object.entries(def.campos)) {
        const bruto = primeiroCampo(params, chaves);
        if (bruto === null) continue;
        const r = resolverTexto(bruto, ctx);
        notas.push(...r.notas);
        envio[rotulo] = r.texto;
      }
      passo.envio = envio;
      superficies.push({ no: atual.name, superficie: def.surface, envio });

    } else {
      return {
        ok: false,
        recusa: `o nó "${atual.name}" é do tipo \`${tipo}\`, que o V1 não simula` +
                (tipo === "n8n-nodes-base.code" ? " — ele roda JavaScript, e adivinhar o que ele devolve seria inventar o resultado." : "."),
        passos, superficies, pendencias
      };
    }

    ctx.porNo[atual.name] = ctx.json;
    passos.push(passo);
    for (const n of notas) pendencias.push(Object.assign({ no: atual.name }, n));

    const proximas = (t.saidas.get(atual.name) || []).filter(s => s.ramo === ramoEscolhido);
    if (proximas.length > 1) {
      return { ok: false, recusa: `o nó "${atual.name}" abre ${proximas.length} caminhos em paralelo. O V1 só simula caminho único.`, passos, superficies, pendencias };
    }
    atual = proximas.length ? t.porNome.get(proximas[0].para) : null;
  }

  if (!superficies.length) {
    pendencias.push({ motivo: "o fluxo não termina num destino que eu saiba desenhar — mostro só o dado final" });
  }
  return { ok: true, passos, superficies, pendencias, jsonFinal: ctx.json };
}

module.exports = { simulate, NAO_SIMULADA, SURFACES, TRIGGERS };

/* -------------------------------------------------------------- auto-teste */

if (require.main === module) {
  const wf = {
    name: "vendas ml",
    nodes: [
      { name: "agenda_5min",      type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],   parameters: {} },
      { name: "buscar_vendas_ml", type: "n8n-nodes-base.httpRequest",     typeVersion: 4.2, position: [200, 0], parameters: { method: "GET", url: "https://api.mercadolibre.com/orders/search?seller={{ $json.sellerId }}" } },
      { name: "tem_venda",        type: "n8n-nodes-base.if",              typeVersion: 2.2, position: [400, 0], parameters: { conditions: { combinator: "and", conditions: [{ leftValue: "={{ $json.paging.total }}", rightValue: 0, operator: { operation: "gt" } }] } } },
      { name: "avisar_slack",     type: "n8n-nodes-base.slack",           typeVersion: 2.2, position: [600, 0], parameters: { channelId: "#vendas", text: "={{ $json.paging.total }} vendas hoje. Último: {{ $json.results[0].title }}" } }
    ],
    connections: {
      agenda_5min:      { main: [[{ node: "buscar_vendas_ml", type: "main", index: 0 }]] },
      buscar_vendas_ml: { main: [[{ node: "tem_venda", type: "main", index: 0 }]] },
      tem_venda:        { main: [[{ node: "avisar_slack", type: "main", index: 0 }], []] }
    }
  };

  const casos = [
    ["com semente completa", { agenda_5min: { sellerId: "1234" }, buscar_vendas_ml: { paging: { total: 3 }, results: [{ title: "Camiseta Dry Fit" }] } }],
    ["sem a semente do HTTP", { agenda_5min: { sellerId: "1234" } }],
    ["semente sem o campo usado", { agenda_5min: { sellerId: "1234" }, buscar_vendas_ml: { paging: { total: 2 }, results: [] } }]
  ];

  for (const [rotulo, seeds] of casos) {
    console.log("\n=== " + rotulo + " ===");
    const r = simulate(wf, { seeds });
    if (!r.ok) { console.log("RECUSA: " + r.recusa); continue; }
    for (const s of r.superficies) console.log(`  [${s.superficie}] ` + JSON.stringify(s.envio));
    if (!r.superficies.length) console.log("  (não chegou a nenhum destino)");
    for (const p of r.pendencias) console.log(`  ! ${p.no || "-"}${p.expr ? " {{" + p.expr + "}}" : ""}: ${p.motivo}`);
  }

  console.log("\n=== nó fora da whitelist (Code) ===");
  const comCode = JSON.parse(JSON.stringify(wf));
  comCode.nodes[2] = { name: "somar", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 0], parameters: { jsCode: "return items" } };
  delete comCode.connections.tem_venda;
  comCode.connections.buscar_vendas_ml = { main: [[{ node: "somar", type: "main", index: 0 }]] };
  comCode.connections.somar = { main: [[{ node: "avisar_slack", type: "main", index: 0 }]] };
  console.log("RECUSA: " + (simulate(comCode, { seeds: {} }).recusa || "(não recusou — BUG)"));
}
