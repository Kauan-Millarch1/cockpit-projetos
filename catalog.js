/* catalog.js — o que esta instância de n8n de fato aceita.
 *
 * PLAN.md §3, camada 1. O modelo não sabe qual `typeVersion` a instância do
 * Kauan aceita, nem como os nós dele se chamam, nem quais portas existem. Isto
 * sabe, porque é destilado de código que já roda na conta dele.
 *
 * A REGRA QUE NÃO PODE SER AFROUXADA: **valor de parâmetro nunca vai para o
 * disco.** Os `parameters` de um nó de n8n carregam chaves de sessão montadas
 * com telefone e e-mail de lead — este repositório os classifica como payload
 * hostil, e um arquivo de cache é exatamente onde eles não podem parar. O que
 * fica gravado é a FORMA: nome da chave e tipo do valor. Se algum dia isto
 * precisar guardar um exemplo de verdade, a resposta é não.
 *
 * Sai daqui, por tipo de nó:
 *   - typeVersions realmente em uso, com contagem
 *   - esboço dos parâmetros: { chave: "string"|"number"|"bool"|"expr"|... }
 *   - nomes de porta de saída observados nas conexões
 *   - tipos de credencial que aquele nó costuma usar
 *
 * E, fora de `nodes`, `credenciaisConhecidas`: tipo, id e NOME das credenciais
 * que os fluxos dele referenciam. Isto foi restrito a "tipo apenas" até
 * 2026-08-10 — o comentário no laço explica por que mudou, o que entra e o que
 * continua sem entrar (o segredo, que a API pública nunca devolve).
 *
 * E, no agregado, a estatística de expressões `{{ }}` — que é o que decide o
 * subconjunto do simulador (PLAN.md §9) em vez de eu chutar.
 *
 * Uso: node catalog.js [--refresh]
 */

"use strict";

const fs = require("fs");
const path = require("path");
const n8n = require("./n8n");

const CACHE = path.join(__dirname, ".cache-catalog.json");
// v2: passou a carregar `credenciaisConhecidas` (tipo + id + nome).
const CACHE_V = 2;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_WORKFLOWS = 200;      // teto defensivo; a instância tem 62
const SKETCH_DEPTH = 2;         // além disso vira "object"/"array", sem descer

/* ------------------------------------------------------------------ formas */

// Sticky note é nó e não executa nada — a mesma exclusão que `isAnnotation()`
// faz no flows.html, aqui pelo tipo.
const ANNOTATION = new Set(["n8n-nodes-base.stickyNote"]);

function kindOf(v, depth) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return /\{\{/.test(v) ? "expr" : "string";
  if (Array.isArray(v)) {
    if (depth >= SKETCH_DEPTH || !v.length) return "array";
    // Um array de objetos homogêneos é comum em n8n (regras de IF, campos de
    // Set). A forma do primeiro item já diz o que precisa ser dito.
    return { array: sketch(v[0], depth + 1) };
  }
  if (typeof v === "object") {
    if (depth >= SKETCH_DEPTH) return "object";
    return sketch(v, depth + 1);
  }
  return "string";
}

function sketch(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return kindOf(obj, depth);
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = kindOf(obj[k], depth);
  return out;
}

// Une dois esboços: chave vista em qualquer fluxo entra; tipos divergentes
// viram uma união declarada em vez de o último ganhar silenciosamente.
function mergeSketch(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (typeof a === "string" && typeof b === "string") {
    return a === b ? a : [...new Set(a.split("|").concat(b.split("|")))].sort().join("|");
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (a.array || b.array) return { array: mergeSketch(a.array, b.array) };
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = mergeSketch(a[k], b[k]);
    return out;
  }
  return "mixed";
}

/* ------------------------------------------------------------- expressões */

/* Cada família de expressão que aparece nos fluxos, contada. Isto não é
 * curiosidade: o simulador do Tester só promete o que consegue avaliar, e a
 * lista do que ele NÃO cobre precisa vir de medição, não de intuição. */
const EXPR_KINDS = [
  ["$json",      /\$json\b/],
  ["$node[]",    /\$node\s*\[/],
  ["$()",        /\$\(\s*['"]/],
  ["$items()",   /\$items\s*\(/],
  ["$now/$today",/\$(now|today)\b/],
  ["$vars",      /\$vars\b/],
  ["$env",       /\$env\b/],
  ["$execution", /\$execution\b/],
  ["$workflow",  /\$workflow\b/],
  ["$prevNode",  /\$prevNode\b/],
  ["$input",     /\$input\b/],
  ["$parameter", /\$parameter\b/],
  ["$if/ternário",/\$if\s*\(|\?[^:]{0,40}:/],
  ["método JS",  /\.(map|filter|reduce|split|join|replace|slice|toUpperCase|toLowerCase|trim|match)\s*\(/],
  ["template",   /`/]
];

/* O subconjunto que o simulador do V1 promete avaliar.
 *
 * Medido, não escolhido: a primeira versão desta lista trazia `$node["Nome"]`
 * (a forma legada) e deixava `$('Nome')` de fora. A varredura mostrou 1019
 * ocorrências da moderna e ZERO da legada nesta instância — ou seja, o plano
 * cobria a sintaxe que ninguém usa aqui. Se esta lista mudar, rode
 * `node catalog.js --refresh` e olhe a porcentagem antes de prometer qualquer
 * coisa na tela. */
const SIMULAVEL_V1 = new Set(["$json", "$()", "$node[]", "$now/$today"]);

function countExpressions(value, acc) {
  if (typeof value === "string") {
    if (!/\{\{/.test(value)) return;
    acc.total++;
    let simples = true;
    for (const [nome, re] of EXPR_KINDS) {
      if (re.test(value)) {
        acc.kinds[nome] = (acc.kinds[nome] || 0) + 1;
        if (!SIMULAVEL_V1.has(nome)) simples = false;
      }
    }
    if (simples) acc.simulaveis++;
    return;
  }
  if (Array.isArray(value)) { for (const v of value) countExpressions(v, acc); return; }
  if (value && typeof value === "object") { for (const v of Object.values(value)) countExpressions(v, acc); }
}

/* ------------------------------------------------------------------ build */

async function build({ onProgress } = {}) {
  const flows = await n8n.listWorkflows({ force: true });
  const alvo = flows.slice(0, MAX_WORKFLOWS);

  const types = new Map();     // type -> { usos, versions:{v:n}, sketch, ports:Set, creds:Set, exemplos:Set }
  const expr = { total: 0, simulaveis: 0, kinds: {} };
  const credTypes = new Map(); // tipo de credencial -> quantos nós a referenciam
  const credRefs = new Map();  // "tipo id" -> { tipo, id, nome, usos } — o inventário possível
  let lidos = 0, falhas = 0;

  for (const f of alvo) {
    let raw;
    try {
      raw = await n8n.getRawWorkflow(f.id);
    } catch (e) {
      falhas++;
      if (onProgress) onProgress({ id: f.id, nome: f.name, erro: String(e && e.message || e) });
      continue;
    }
    lidos++;
    if (onProgress) onProgress({ id: f.id, nome: f.name, nodes: (raw.nodes || []).length });

    const porNome = new Map();
    for (const nd of raw.nodes || []) {
      if (!nd || !nd.type || ANNOTATION.has(nd.type)) continue;
      porNome.set(nd.name, nd.type);

      let e = types.get(nd.type);
      if (!e) {
        e = { usos: 0, versions: {}, sketch: undefined, ports: new Set(), creds: new Set(), nomes: new Set(), maxSaidas: 0 };
        types.set(nd.type, e);
      }
      e.usos++;
      const v = String(nd.typeVersion == null ? "?" : nd.typeVersion);
      e.versions[v] = (e.versions[v] || 0) + 1;
      e.sketch = mergeSketch(e.sketch, sketch(nd.parameters || {}));

      /* Tipo, id e NOME da credencial.
       *
       * Isto mudou de propósito em 2026-08-10, e é a única linha deste arquivo
       * que ficou menos restritiva do que nasceu. Antes só o tipo sobrevivia, e
       * a consequência era que o cockpit conseguia dizer "este fluxo precisa de
       * uma credencial do tipo `slackApi`" e nunca "você já tem a *Slack
       * Ecommerce Puro*, usada em 6 fluxos" — que é a frase que economiza o
       * trabalho de verdade, e o pré-requisito de ligar a credencial sozinho.
       *
       * O que entra: `id` e `name`. O que NÃO entra, aqui nem em lugar nenhum:
       * o segredo. Ele nunca sai do n8n — a API pública não devolve valor de
       * credencial, e `GET /credentials` responde 405. Um `id` é um ponteiro que
       * só significa alguma coisa dentro desta instância.
       *
       * Consequência que precisa estar escrita: estes nomes passam a existir em
       * `.cache-catalog.json`, no disco. O arquivo é gitignored e local, e a
       * regra dura deste arquivo continua intacta — **valor de parâmetro nunca
       * vai para o disco**. Nome de credencial não é valor de parâmetro.
       *
       * Isto NÃO entra na fatia que vai para o modelo (`slice`/`fatiaTexto`
       * servem `cat.nodes`, e `credenciaisConhecidas` mora fora deles): a sessão
       * de construção tem `credentials` proibido em portão, então um inventário
       * de credenciais ali seria contexto que ela não pode usar para nada. */
      for (const [t, ref] of Object.entries(nd.credentials || {})) {
        e.creds.add(t);
        credTypes.set(t, (credTypes.get(t) || 0) + 1);
        const id = ref && ref.id != null ? String(ref.id) : null;
        const nome = ref && typeof ref.name === "string" ? ref.name : null;
        if (!id && !nome) continue;
        // `JSON.stringify` de um par, nunca concatenação com separador: um nome
        // de credencial pode conter qualquer coisa, e o separador escrito à mão
        // já virou U+0000 duas vezes neste repositório — silenciosamente, porque
        // uma chave que nunca casa não dá erro, só devolve `undefined` para
        // sempre. Este mesmo defeito acabou de ser pego pelo caractere-test.
        const chave = JSON.stringify([t, id || nome]);
        const j = credRefs.get(chave);
        if (j) { j.usos++; if (!j.nome && nome) j.nome = nome; }
        else credRefs.set(chave, { tipo: t, id, nome, usos: 1 });
      }

      // Nome do nó só serve como pista de convenção; guardo poucos e curtos.
      if (e.nomes.size < 6 && typeof nd.name === "string" && nd.name.length <= 40) e.nomes.add(nd.name);

      countExpressions(nd.parameters || {}, expr);
    }

    // Portas de saída: a chave do meio em connections[origem][porta][ramo][]
    for (const [origem, saidas] of Object.entries(raw.connections || {})) {
      const t = porNome.get(origem);
      if (!t) continue;
      const e = types.get(t);
      if (!e) continue;
      // Toda porta de saída se chama "main" nesta instância — o que distingue
      // os ramos de um IF/Switch é o ÍNDICE dentro de `main`, não um nome. Um
      // portão que só confere nome de porta seria vazio; o que dá para conferir
      // de fato é quantas saídas aquele tipo de nó chega a ter.
      for (const [porta, ramos] of Object.entries(saidas || {})) {
        e.ports.add(porta);
        if (Array.isArray(ramos)) e.maxSaidas = Math.max(e.maxSaidas || 0, ramos.length);
      }
    }
  }

  const nodes = {};
  for (const [t, e] of [...types.entries()].sort((a, b) => b[1].usos - a[1].usos)) {
    nodes[t] = {
      usos: e.usos,
      versions: e.versions,
      versaoMaisUsada: Number(Object.entries(e.versions).sort((a, b) => b[1] - a[1])[0][0]) || null,
      portas: [...e.ports].sort(),
      maxSaidas: e.maxSaidas || 1,
      credenciais: [...e.creds].sort(),
      nomesDeExemplo: [...e.nomes],
      parametros: e.sketch || {}
    };
  }

  return {
    v: CACHE_V,
    geradoEm: new Date().toISOString(),
    instancia: n8n.instance,
    fluxosLidos: lidos,
    fluxosComFalha: falhas,
    tiposDeNo: Object.keys(nodes).length,
    credenciaisPorTipo: Object.fromEntries([...credTypes.entries()].sort((a, b) => b[1] - a[1])),
    /* O inventário que dá para ter. Não é a lista de credenciais da conta —
     * `GET /credentials` responde 405 e essa lista não existe para ninguém aqui.
     * É a lista das credenciais que os fluxos dele REFERENCIAM, o que é um
     * subconjunto: uma credencial criada e nunca usada não aparece. Quem mostra
     * isso na tela tem que dizer essa diferença. Ordenado por uso, então a
     * primeira de cada tipo é a que tem mais evidência atrás. */
    credenciaisConhecidas: [...credRefs.values()].sort((a, b) => b.usos - a.usos || String(a.nome).localeCompare(String(b.nome))),
    expressoes: {
      total: expr.total,
      simulaveisNoSubconjuntoV1: expr.simulaveis,
      porFamilia: Object.fromEntries(Object.entries(expr.kinds).sort((a, b) => b[1] - a[1]))
    },
    nodes
  };
}

/* ------------------------------------------------------------------ cache */

function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    if (!j || !j.geradoEm) return null;
    /* Versão do FORMATO, além do TTL. Sem ela, o dia em que o catálogo passa a
     * extrair um campo novo é um dia em que o cache velho continua valendo por
     * até 24h e a tela mostra a informação nova como ausente — que é exatamente
     * o que "não achei credencial nenhuma" pareceria, e é mentira. Mesmo motivo
     * do `EXEC_CACHE_V` no server.js: cache velho é descartado inteiro, nunca
     * remendado. Suba este número em qualquer mudança de forma da saída. */
    if (j.v !== CACHE_V) return null;
    if (Date.now() - Date.parse(j.geradoEm) > TTL_MS) return null;
    return j;
  } catch { return null; }
}

function writeCache(cat) {
  const tmp = CACHE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cat, null, 2), "utf8");
  fs.renameSync(tmp, CACHE);
}

async function get({ refresh = false, onProgress } = {}) {
  if (!refresh) {
    const hit = readCache();
    if (hit) return hit;
  }
  const cat = await build({ onProgress });
  writeCache(cat);
  return cat;
}

/* Só o que o prompt precisa ver: os tipos citados, sem o catálogo inteiro.
 * Mandar 200 tipos de nó para o modelo seria queimar contexto que deveria ir
 * para o diagnóstico — a mesma lógica do `nodes-index.md` no claude-fix.js. */
function slice(cat, tipos) {
  const out = {};
  for (const t of tipos || []) if (cat.nodes[t]) out[t] = cat.nodes[t];
  return out;
}

/* A fatia como TEXTO, cortada por tipo inteiro.
 *
 * Quem monta prompt precisa de um teto, e o jeito óbvio — `JSON.stringify(fatia)
 * .slice(0, N)` — corta no meio de uma chave e entrega JSON inválido ao modelo,
 * que então chuta a forma do parâmetro e perde uma rodada no portão. Pior: falha
 * exatamente nos fluxos maiores, onde o catálogo é mais necessário.
 *
 * Aqui o corte é sempre em fronteira de tipo, na ordem em que os tipos foram
 * pedidos (o chamador põe o que importa primeiro), e o que sobrou de fora é
 * DEVOLVIDO em vez de sumir — um prompt que perdeu metade do catálogo em
 * silêncio é a mesma classe de erro que este projeto evita em toda parte.
 *
 * Um agente conversacional precisa de ~23 tipos e ~16KB; um fluxo de notificação
 * precisa de 8 e ~6KB. O teto é do chamador porque a decisão é dele. */
function fatiaTexto(cat, tipos, teto = 16000) {
  const dentro = [];
  const fora = [];
  let usado = 2;                                  // as chaves do objeto externo
  for (const t of tipos || []) {
    const e = cat.nodes[t];
    if (!e) { fora.push(t); continue; }
    // 4 é a indentação de `JSON.stringify(obj, null, 2)` na chave; o resto é o
    // par "tipo": {…} com a vírgula.
    const custo = JSON.stringify(t).length + JSON.stringify(e, null, 2).length + 6;
    if (dentro.length && usado + custo > teto) { fora.push(t); continue; }
    dentro.push(t);
    usado += custo;
  }
  const obj = {};
  for (const t of dentro) obj[t] = cat.nodes[t];
  return { texto: JSON.stringify(obj, null, 2), incluidos: dentro, omitidos: fora, chars: usado };
}

/* Tipo de credencial referenciado por algum fluxo? É tudo que dá para saber:
 * `GET /credentials` responde 405, então não existe inventário real. A resposta
 * é "visto" ou "não visto", nunca "você tem" ou "você não tem". */
function credencialVista(cat, tipo) {
  return Object.prototype.hasOwnProperty.call(cat.credenciaisPorTipo || {}, tipo);
}

/* As credenciais daquele tipo que os fluxos dele referenciam, da mais usada para
 * a menos. Nunca é a lista da conta — ver o comentário em `credenciaisConhecidas`.
 * Uma credencial sem `id` não serve para ligar nada na importação, mas serve
 * para dizer o nome na tela, então ela fica na lista e quem liga é que filtra. */
function credenciaisDoTipo(cat, tipo) {
  return (cat.credenciaisConhecidas || []).filter(c => c.tipo === tipo);
}

module.exports = { get, build, slice, fatiaTexto, credencialVista, credenciaisDoTipo, CACHE };

/* ------------------------------------------------------------------- CLI */

if (require.main === module) {
  const refresh = process.argv.includes("--refresh");
  (async () => {
    if (!n8n.configured) { console.error("n8n não configurado: falta N8N_BASE_URL/N8N_API_KEY em .env"); process.exit(2); }
    const t0 = Date.now();
    const cat = await get({
      refresh: refresh || true,
      onProgress: p => process.stdout.write(p.erro ? `  ! ${p.nome}: ${p.erro}\n` : `  · ${p.nome} (${p.nodes} nós)\n`)
    });
    console.log("");
    console.log(`fluxos lidos: ${cat.fluxosLidos}   falhas: ${cat.fluxosComFalha}   tipos de nó: ${cat.tiposDeNo}   ${Math.round((Date.now() - t0) / 100) / 10}s`);
    console.log("");
    console.log("tipos mais usados:");
    Object.entries(cat.nodes).slice(0, 12).forEach(([t, e]) =>
      console.log(`  ${String(e.usos).padStart(4)}×  ${t}  v${Object.keys(e.versions).join("/")}  portas:[${e.portas.join(",")}]`));
    console.log("");
    console.log("credenciais vistas nos fluxos (tipo apenas):");
    Object.entries(cat.credenciaisPorTipo).forEach(([t, n]) => console.log(`  ${String(n).padStart(4)}×  ${t}`));
    console.log("");
    const ex = cat.expressoes;
    const pct = ex.total ? Math.round(ex.simulaveisNoSubconjuntoV1 / ex.total * 100) : 0;
    console.log(`expressões {{ }}: ${ex.total}   dentro do subconjunto V1: ${ex.simulaveisNoSubconjuntoV1} (${pct}%)`);
    Object.entries(ex.porFamilia).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}×  ${k}`));
    console.log("");
    console.log("gravado em " + CACHE);
  })().catch(e => { console.error("falhou: " + (e && e.stack || e)); process.exit(1); });
}
