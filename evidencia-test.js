/* evidencia-test.js — o que a sessão pode ver do n8n.
 *
 * DOIS GRUPOS, e o segundo é o que decide se esta feature pode existir:
 *
 * 1. O RECORTE. Número, booleano e preço passam inteiros — é o que responde "por
 *    que saiu R$0,00". Telefone e e-mail vêm mascarados SEMPRE, inclusive no meio
 *    de um texto, porque o telefone do lead aparece no corpo da mensagem e
 *    mascarar só o campo `to` deixaria a porta aberta pelo lado do `text`.
 *
 * 2. NENHUM PEDIDO ESCREVE. Os quatro verbos são um conjunto fechado e read-only.
 *    Uma sessão de modelo pedindo `putWorkflow` seria escrita em produção sem
 *    diff e sem clique — o oposto de tudo o que este painel garante.
 *
 * E um terceiro que é sobre dinheiro: cada pedido é uma rodada nova, então o teto
 * de pedidos e os tetos de tamanho são gasto, não paciência.
 *
 * De graça: o cliente do n8n é substituído no `require.cache`, nada fala com a
 * instância. `node evidencia-test.js` */

"use strict";

const fs = require("fs");
const path = require("path");

/* O n8n falso entra ANTES do require, senão o teste vira leitura na instância do
   Kauan. Mesma técnica do reexec-test e do escrever-test. */
const n8n = require("./n8n.js");
const chamadas = [];
let execFalsa = null, listaFalsa = null, grafoFalso = null, listaWf = null;

n8n.getRawExecution = async id => { chamadas.push(["getRawExecution", String(id)]); if (!execFalsa) throw new Error("execução não encontrada"); return execFalsa; };
n8n.listExecutions = async o => { chamadas.push(["listExecutions", o]); return listaFalsa || { linhas: [], cursor: null }; };
/* O PADRÃO DESTE DUBLÊ TEM A FORMA REAL DE `n8n.getGraph`, e isso não é zelo: ele
   era `{nome, nos, arestas}` — a forma ERRADA, a mesma que o `grafo()` lia por
   engano. Um dublê que fala o idioma do bug prova a cópia, não o contrato: com ele
   de pé, o `grafo()` quebrado passava no teste, e por isso a suíte não pegou o
   defeito (achado por uma conversa de verdade). `formaDeGetGraph` abaixo é o que
   fixa isto: qualquer fixture daqui é conferida contra as chaves de `extractGraph`. */
n8n.getGraph = async id => { chamadas.push(["getGraph", String(id)]); return grafoFalso || { id: String(id), name: "F", active: false, nodes: [], edges: [] }; };
n8n.listWorkflows = async () => { chamadas.push(["listWorkflows"]); return listaWf || []; };

const ev = require("./evidencia.js");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}
async function recusa(f) { try { await f(); return null; } catch (e) { return e; } }

/* ───────────────────────── 1. o recorte de um valor ────────────────────── */

console.log("\n[ 01 ] valor — o que passa inteiro e o que vem mascarado");

/* O caso que motivou a feature: o preço vem da API como STRING numérica. Cortar
   ou mascarar isso destruiria a resposta e não protegeria nada. */
t("número passa inteiro", ev.valor(3000, 0) === 3000);
t("preço como string numérica passa inteiro", ev.valor("3000", 0) === "3000");
t("decimal com vírgula passa", ev.valor("48,90", 0) === "48,90");
t("negativo passa", ev.valor("-12", 0) === "-12");
/* O FURO QUE O MUTANTE ACHOU. A primeira versão aceitava 15 dígitos como
   "numérico", então um telefone cru — `5541999991395`, a forma exata de
   `contact.wa_id` nesta instância — passava SEM MÁSCARA pelo atalho do número.
   O teto de 9 dígitos existe porque `maskPII` só age a partir de 10: o atalho e
   a máscara cobrem faixas que não se sobrepõem. */
t("telefone escrito como número CRU é mascarado, não tratado como preço",
  !/999991395/.test(String(ev.valor("5541999991395", 0))));
t("...e um id de 13 dígitos também (epoch mascarado é ruído; telefone vazado não)",
  !/1755600000000/.test(String(ev.valor("1755600000000", 0))));
t("o teto do atalho é o piso da máscara — os dois são o mesmo número", ev.DIG_MAX === 9);
t("preço de 9 dígitos ainda passa inteiro", ev.valor("123456789", 0) === "123456789");
t("preço com centavos passa inteiro", ev.valor("4800.50", 0) === "4800.50");
t("booleano passa", ev.valor(true, 0) === true && ev.valor(false, 0) === false);
t("zero passa como zero, não como ausente", ev.valor(0, 0) === 0);
t("null continua null", ev.valor(null, 0) === null);

/* A invariante que não se move. */
t("telefone é mascarado", !/99999.?1395/.test(String(ev.valor("+55 41 99999-1395", 0))));
t("e-mail é mascarado", /\*\*\*\*@/.test(String(ev.valor("kauan.millarch@ecommercepuro.com.br", 0))));
t("telefone NO MEIO de um texto é mascarado",
  !/99999.?1395/.test(String(ev.valor("o lead é o Joao, chama no +55 41 99999-1395 hoje", 0))));
t("...e o resto do texto sobrevive", /Joao/.test(String(ev.valor("o lead é o Joao, chama no +55 41 99999-1395 hoje", 0))));
t("texto longo é cortado no teto", String(ev.valor("x".repeat(900), 0)).length <= ev.TEXTO_CAP + 1);
t("o teto daqui é maior que os 180 do painel — aqui é para diagnosticar", ev.TEXTO_CAP > 180);

/* Objeto e array PASSAM, e é o que permite ver onde o preço mora de verdade:
   medido, `data.tiers[0].offers[0].price`. */
const API = { success: true, data: { name: "Imersão", tiers: [{ name: "L1", offers: [{ name: "Lote 1", price: "3000" }] }] } };
const rec = ev.valor(API, 0);
t("objeto aninhado passa", rec.data.tiers[0].offers[0].price === "3000");
t("...e o booleano do topo também", rec.success === true);

t("array é cortado no teto de itens, e DIZ que cortou",
  (() => { const r = ev.valor(Array.from({ length: 50 }, (_, i) => i), 0);
    return r.length === ev.ITENS_ARRAY + 1 && /e mais 44/.test(String(r[r.length - 1])); })());
t("profundidade demais para de descer, e diz", (() => {
  let fundo = "fim"; for (let i = 0; i < 20; i++) fundo = { n: fundo };
  return JSON.stringify(ev.valor(fundo, 0)).includes("fundo demais");
})());
t("objeto com chaves demais é cortado, e diz", (() => {
  const o = {}; for (let i = 0; i < 120; i++) o["k" + i] = i;
  const r = ev.valor(o, 0);
  return Object.keys(r).length === ev.PROF_MAX * 0 + 41 && /chave/.test(String(r["«e mais»"]));
})());

/* DOIS FUROS DA MESMA FAMÍLIA DO `DIG_MAX`, e os dois deixavam um telefone
   atravessar CRU apesar de o comentário do módulo prometer "sempre mascarado". */
t("telefone gravado como NÚMERO é mascarado — cabe exato num double e passava cru",
  !/999990000/.test(String(ev.valor(5521999990000, 0))));
t("...e um epoch de 13 dígitos também (epoch mascarado é ruído; telefone vazado não)",
  !/1755600000000/.test(String(ev.valor(1755600000000, 0))));
t("...e o piso do atalho do número é o MESMO do da string, em outra forma",
  ev.NUM_MAX === 10 ** ev.DIG_MAX);
t("preço como número passa inteiro — o atalho existe para ele", ev.valor(3000, 0) === 3000);
t("...e o maior que ainda é preço também", ev.valor(999999999, 0) === 999999999);
t("negativo grande também é mascarado, não só o positivo",
  !/999990000/.test(String(ev.valor(-5521999990000, 0))));
/* Nesta instância a chave do Redis É o telefone do lead (`memoria:<telefone>`), e um
   hash devolvido inteiro traz um contato por chave. Chave crua é o mesmo vazamento
   que valor cru — e o nome da chave saía sem passar por máscara nenhuma. */
t("o NOME DA CHAVE é mascarado, não só o valor",
  !/999990000/.test(JSON.stringify(ev.valor({ "memoria:5521999990000": 1 }, 0))));
t("...e a chave normal não é tocada", "propertyName" in ev.valor({ propertyName: 1 }, 0));
t("duas chaves diferentes que mascaram igual são NUMERADAS, não sobrescritas",
  (() => { const r = ev.valor({ "tel:5521999990000": "a", "tel:55 21 99999 0000": "b" }, 0);
    return Object.keys(r).length === 2 && Object.values(r).join() === "a,b"; })());
/* A GUARDA DA COLISÃO SÓ PEGAVA UMA DAS DUAS ORDENS, e a que faltava é a que apaga
   dado em silêncio: ela era `chave !== k && chave in out`, então a chave que JÁ
   ESTÁ na forma da máscara não era conferida contra nada e escrevia por cima da que
   tinha mascarado para o nome dela. É a mesma família do defeito de cima — perder
   uma chave calado — e o valor perdido aqui é o do Redis chaveado por telefone. */
t("chave já na forma da máscara NÃO sobrescreve a que mascarou para ela",
  (() => { const r = ev.valor({ "tel:5521999990000": "a", "tel:5521 ***** 0000": "b" }, 0);
    return Object.keys(r).length === 2 && Object.values(r).sort().join() === "a,b"; })());
/* `mascarar` também colapsa espaço, então duas chaves que só diferem nisso colidem
   sem telefone nenhum no meio — e colidiam na mesma direção cega. */
t("...e o colapso de espaço da máscara também não apaga a chave vizinha",
  (() => { const r = ev.valor({ "x  y": 1, "x y": 2 }, 0);
    return Object.keys(r).length === 2 && Object.values(r).sort().join() === "1,2"; })());
/* A ORDEM DAS CHAVES NÃO PODE DECIDIR SE UM VALOR SOME. As duas escritas do mesmo
   par são o mesmo payload lido do mesmo Redis; se uma perde e a outra não, a
   evidência muda conforme a ordem em que o n8n serializou o hash. */
t("...e a numeração vale nos dois sentidos, porque a ordem é do payload, não nossa",
  (() => { const par = ["tel:5521999990000", "tel:5521 ***** 0000"];
    const a = ev.valor({ [par[0]]: 1, [par[1]]: 2 }, 0);
    const b = ev.valor({ [par[1]]: 2, [par[0]]: 1 }, 0);
    return Object.keys(a).length === 2 && Object.keys(b).length === 2; })());
/* E a numeração continua sendo o desempate, não um sufixo que aparece sozinho: uma
   chave sem colisão nenhuma não pode ganhar `«2»`. */
t("...sem inventar sufixo onde não houve colisão",
  !/«2»/.test(JSON.stringify(ev.valor({ "memoria:5521999990000": 1, outra: 2 }, 0))));

/* Credencial não passa nem aqui, e este arquivo NÃO é a exceção. */
t("`credentials` é ocultado mesmo neste caminho mais largo",
  ev.valor({ node: { credentials: { slackApi: { id: "9", name: "Slack Prod" } } } }, 0).node.credentials === "«credencial oculta»");
t("...e o nome da credencial não vaza",
  !/Slack Prod/.test(JSON.stringify(ev.valor({ c: { credentials: { x: { name: "Slack Prod" } } } }, 0))));

/* ──────────────────── 2. nenhum pedido escreve, e é fechado ────────────── */

console.log("\n[ 02 ] os quatro verbos são um conjunto fechado e só leem");

t("são exatamente quatro", ev.TIPOS.size === 4);
t("e são estes", [...ev.TIPOS].sort().join(",") === "execucoes,fluxos,grafo,saida");
for (const proibido of ["putWorkflow", "createWorkflow", "retryExecution", "aplicar", "escrever", "delete"]) {
  t('`' + proibido + '` NÃO é um pedido possível', !ev.TIPOS.has(proibido));
  t("...e é recusado nomeando os válidos",
    (() => { const r = ev.validarPedido({ oque: proibido }); return !r.ok && /execucoes/.test(r.erros[0]); })());
}
/* Prova na FONTE, não só no contrato: o módulo não pode nem alcançar uma escrita. */
/* Comentários fora antes de varrer: o comentário do módulo CITA as escritas para
   dizer que não as chama, e a primeira versão deste caso casou nele. Mesma
   disciplina do `css-test.js`, que tira comentário antes de contar chave. */
const fonte = fs.readFileSync(path.join(__dirname, "evidencia.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
t("o módulo não chama nenhuma escrita do n8n",
  !/putWorkflow|createWorkflow|retryExecution|comEscrita/.test(fonte));
t("...e usa a máscara do painel em vez de uma própria", /n8n\.maskPII/.test(fonte));

/* ──────────────────────── 3. o contrato do pedido ──────────────────────── */

console.log("\n[ 03 ] validação antes de gastar a chamada");

t("pedido que não é objeto é recusado", !ev.validarPedido("saida").ok);
t("`oque` ausente é recusado", !ev.validarPedido({}).ok);

const st = ev.validarPedido({ oque: "execucoes", status: "crashed" });
t("`status: crashed` é recusado", !st.ok);
/* Medido nesta instância: `crashed` devolve 400. Deixar passar gastaria a chamada
   para receber um erro que a validação já sabia. */
t("...dizendo que é medido", /medido/.test(st.erros[0]));
t("...e listando os que valem", /success/.test(st.erros[0]));
t("`status: error` passa", ev.validarPedido({ oque: "execucoes", status: "error" }).ok);

/* O teto do `limite` era 250 — o tamanho de UMA página da API. Com a lista
   paginando, pedir mais que uma página deixou de ser impossível, e é isso que dá o
   denominador da cobertura ("abri 830 das 1941 que existem"). */
t("`limite` é preso no teto da lista, que já não é uma página",
  ev.validarPedido({ oque: "execucoes", limite: 9999 }).valor.limite === ev.LISTA_TETO);
t("...e o teto da lista é o mesmo do que dá para abrir, para não listar o inalcançável",
  ev.LISTA_TETO === ev.PAGINAS_MAX * ev.PAGINA && ev.LISTA_TETO === ev.VARRER_TETO);
t("...e ele passa de uma página, senão a paginação não serviria para nada", ev.LISTA_TETO > ev.PAGINA);
t("`limite` zero vira 1, não zero", ev.validarPedido({ oque: "execucoes", limite: 0 }).valor.limite >= 1);
t("`contem` de 1 caractere é recusado — não vale uma varredura", !ev.validarPedido({ oque: "execucoes", contem: "0" }).ok);
t("`contem` normal passa e é cortado", ev.validarPedido({ oque: "execucoes", contem: "R$0,00" }).valor.contem === "R$0,00");

t("`saida` sem execId numérico é recusado", !ev.validarPedido({ oque: "saida", execId: "abc", nos: ["x"] }).ok);
t("`saida` sem nós é recusado", !ev.validarPedido({ oque: "saida", execId: "1" }).ok);
t("...dizendo que o nome vem do nodes-index", /nodes-index/.test(ev.validarPedido({ oque: "saida", execId: "1" }).erros[0]));
t("`nos` é preso no teto de 12",
  ev.validarPedido({ oque: "saida", execId: "1", nos: Array.from({ length: 40 }, (_, i) => "n" + i) }).valor.nos.length === ev.NOS_POR_PEDIDO);
t("`grafo` com wfId torto é recusado", !ev.validarPedido({ oque: "grafo", wfId: "nao..vale" }).ok);
t("`fluxos` não precisa de campo", ev.validarPedido({ oque: "fluxos" }).ok);

/* `execIds`: uma pergunta sobre três execuções gastava os 3 pedidos do teto só
   para abri-las — medido, e a resposta fechou na última rodada possível. */
console.log("\n[ 03b ] `execIds`: várias execuções num pedido só");
const multi = ev.validarPedido({ oque: "saida", execIds: ["171281", "171291", "171294"], nos: ["a"] });
t("uma lista de execIds passa", multi.ok && multi.valor.execIds.length === 3);
t("`execId` sozinho continua funcionando — é a forma que ela já conhece",
  ev.validarPedido({ oque: "saida", execId: "171281", nos: ["a"] }).valor.execId === "171281");
t("...e sozinho NÃO ganha `execIds`, para a forma do resultado não mudar sem aviso",
  ev.validarPedido({ oque: "saida", execId: "171281", nos: ["a"] }).valor.execIds === undefined);
t("os dois juntos entram na mesma lista em vez de virar recusa (recusa custa uma rodada)",
  (() => { const r = ev.validarPedido({ oque: "saida", execId: "9", execIds: ["1", "2"], nos: ["a"] });
    return r.ok && r.valor.execIds.join() === "1,2,9"; })());
t("id repetido não abre a mesma execução duas vezes",
  ev.validarPedido({ oque: "saida", execIds: ["7", "7", "8"], nos: ["a"] }).valor.execIds.join() === "7,8");
t("id não numérico na lista é recusado nomeando o campo",
  (() => { const r = ev.validarPedido({ oque: "saida", execIds: ["1", "abc"], nos: ["a"] });
    return !r.ok && /execIds/.test(r.erros[0]); })());
t("lista vazia é recusada", !ev.validarPedido({ oque: "saida", execIds: [], nos: ["a"] }).ok);
t("a lista é presa no teto", (() => {
  const r = ev.validarPedido({ oque: "saida", execIds: ["1", "2", "3", "4", "5", "6"], nos: ["a"] });
  return r.valor.execIds.length === ev.EXEC_POR_SAIDA;
})());
/* O que passa do teto é DITO, nunca descartado em silêncio: sem isto a sessão
   concluiria sobre uma execução que ninguém abriu. */
t("...e os que sobraram viajam para o resultado poder nomeá-los",
  (ev.validarPedido({ oque: "saida", execIds: ["1", "2", "3", "4", "5", "6"], nos: ["a"] }).valor.ignorados || []).join() === "5,6");
t("dentro do teto não sobra `ignorados`",
  ev.validarPedido({ oque: "saida", execIds: ["1", "2"], nos: ["a"] }).valor.ignorados === undefined);

/* `comNos`: escolher qual execução abrir era chute, porque a lista só trazia id,
   status e horário — medido, um pedido inteiro foi gasto numa execução que tinha
   caído num ramo que não interessava. */
console.log("\n[ 03c ] `comNos`: quais nós rodaram em cada linha");
t("`comNos: true` passa", ev.validarPedido({ oque: "execucoes", comNos: true }).valor.comNos === true);
t("`comNos: false` não liga a varredura",
  ev.validarPedido({ oque: "execucoes", comNos: false }).valor.comNos === undefined);
/* Um valor qualquer virando `true` faria 6 execuções serem abertas por causa de um
   `"não"` escrito no campo — e cada uma é um GET de vários MB. */
t("`comNos` com string é recusado, não coagido para true",
  !ev.validarPedido({ oque: "execucoes", comNos: "sim" }).ok);
t("...e a recusa diz o que o campo aceita",
  /só aceita .true. ou .false./.test(ev.validarPedido({ oque: "execucoes", comNos: 1 }).erros[0]));

(async () => {

  /* ─────────────────── 4. o que volta de uma execução ─────────────────── */

  console.log("\n[ 04 ] saida — os valores, e de quem cada nó recebeu");

  execFalsa = {
    status: "success", startedAt: "2026-08-19T12:00:00.000Z",
    data: { resultData: {
      lastNodeExecuted: "Manda",
      runData: {
        api_get_evento_detalhe: [{ executionTime: 320, executionStatus: "success",
          source: [{ previousNode: "resolver_event_id", previousNodeRun: 0 }],
          data: { main: [[{ json: API }]] } }],
        redis_get_evento_detalhe: [{ executionTime: 12, executionStatus: "success",
          source: [null, { previousNode: "parametros", previousNodeRun: 0 }],
          data: { main: [[{ json: { propertyName: '{"data":{"tiers":[]}}' } }]] } }],
        Manda: [{ executionTime: 800, executionStatus: "success",
          data: { main: [[{ json: { to: "+55 41 99999-1395", texto: "seu ingresso custa R$ 3000" } }]] } }]
      }
    } }
  };
  chamadas.length = 0;
  const r = await ev.saida({ execId: "194351", nos: ["api_get_evento_detalhe", "redis_get_evento_detalhe", "Manda", "nao_existe"] });

  t("abriu a execução pedida", chamadas.some(c => c[0] === "getRawExecution" && c[1] === "194351"));
  t("o preço aparece com o valor", r.nos.api_get_evento_detalhe[0].ramos[0].itens[0].data.tiers[0].offers[0].price === "3000");
  /* O bug medido no Iago: o Redis devolve tudo sob `propertyName`. Ver essa chave
     É a resposta, e a fronteira não pode escondê-la. */
  t("a chave `propertyName` do Redis é visível", "propertyName" in r.nos.redis_get_evento_detalhe[0].ramos[0].itens[0]);
  t("o telefone do lead vem mascarado", !/99999.?1395/.test(JSON.stringify(r.nos.Manda)));
  t("...e o texto da mensagem continua legível", /ingresso custa/.test(JSON.stringify(r.nos.Manda)));

  /* A aresta, não o vizinho na ordem de execução — é a lição do `Wait` dentro de
     laço, que este repo já pagou no resumo de execução. */
  t("diz de QUEM o nó recebeu", r.nos.api_get_evento_detalhe[0].de.no === "resolver_event_id");
  t("...e pega o primeiro `source` não-nulo (nó de múltiplas entradas)", r.nos.redis_get_evento_detalhe[0].de.no === "parametros");

  /* Nó ausente é fato, não erro: ele pode não ter rodado, e isso costuma ser a
     própria resposta. */
  t("nó que não rodou volta em `naoRodaram`", r.naoRodaram.join() === "nao_existe");
  t("...e a lista de quem rodou vai junto, para não adivinhar nome", r.quemRodou.includes("Manda"));
  t("o último nó executado vem", r.ultimoNo === "Manda");
  t("execução inexistente devolve erro nomeado",
    (execFalsa = null, !!(await recusa(() => ev.saida({ execId: "999", nos: ["x"] })))));

  /* ────────── 4b. várias execuções num pedido, sem misturar as listas ── */

  console.log("\n[ 04b ] saida com `execIds` — chaveado por execução");

  /* Cada execução responde uma coisa diferente, então o resultado não pode somar:
     "esse nó não rodou" sem dizer em QUAL das três não responde nada. */
  const porId = {
    "171281": { status: "success", startedAt: "a", data: { resultData: { lastNodeExecuted: "X", runData: {
      buscar_treinamento: [{ data: { main: [[{ json: { preco: "2700" } }]] } }] } } } },
    "171291": { status: "success", startedAt: "b", data: { resultData: { lastNodeExecuted: "Y", runData: {
      buscar_evento: [{ data: { main: [[{ json: { preco_atual: 0 } }]] } }] } } } },
    "171294": { status: "error", startedAt: "c", data: { resultData: { lastNodeExecuted: "Z", runData: {
      buscar_treinamento: [{ data: { main: [[{ json: { preco: "2700" } }]] } }] } } } }
  };
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    if (!porId[String(id)]) throw new Error("execução não encontrada");
    return porId[String(id)];
  };

  chamadas.length = 0;
  const tres = await ev.saida({ execIds: ["171281", "171291", "171294"], nos: ["buscar_evento", "buscar_treinamento"] });
  t("abriu as três execuções num pedido só", chamadas.filter(c => c[0] === "getRawExecution").length === 3);
  t("o resultado é chaveado por execução", Object.keys(tres.execucoes).join() === "171281,171291,171294");
  t("cada uma tem o SEU `naoRodaram`, não uma lista misturada",
    tres.execucoes["171281"].naoRodaram.join() === "buscar_evento"
    && tres.execucoes["171291"].naoRodaram.join() === "buscar_treinamento");
  t("...e o seu `quemRodou`", tres.execucoes["171291"].quemRodou.join() === "buscar_evento");
  t("o valor de cada uma chega inteiro",
    tres.execucoes["171291"].nos.buscar_evento[0].ramos[0].itens[0].preco_atual === 0);
  t("diz quantas foram pedidas e quantas abriram", tres.pedidas === 3 && tres.abertas === 3);

  /* Uma execução que não abre não pode derrubar as outras: perder três leituras
     boas por causa de um id errado é o desperdício que este pedido existe para
     acabar. */
  const comRuim = await ev.saida({ execIds: ["171281", "999999"], nos: ["buscar_treinamento"] })
    .catch(e => ({ estourou: String(e && e.message || e) }));
  t("um id que não abre não derruba os outros",
    !comRuim.estourou && comRuim.abertas === 1 && !!comRuim.execucoes["171281"]);
  t("...e o que falhou é nomeado com o motivo",
    !comRuim.estourou && comRuim.falharam.length === 1 && comRuim.falharam[0].execId === "999999"
    && /não encontrada/.test(comRuim.falharam[0].erro));
  /* Nenhuma abriu é estado PRÓPRIO: o resumo não pode ler como "abri e não achei". */
  const nenhuma = await ev.saida({ execIds: ["999998", "999999"], nos: ["x"] })
    .catch(e => ({ estourou: String(e && e.message || e) }));
  t("nenhuma abrindo é dito como falha de leitura, não como ausência de nós",
    !nenhuma.estourou && /NÃO CONSEGUI ABRIR/.test(ev.resumo({ oque: "saida" }, nenhuma)));
  t("...e proíbe concluir a partir disso",
    !nenhuma.estourou && /não conclua nada/i.test(ev.resumo({ oque: "saida" }, nenhuma)));

  /* O teto e o que ele impede: 4 é a necessidade medida (3) mais um slot de
     controle, e o arquivo no pior caso fica na ordem do DOSSIE.md que a sessão já
     lê inteiro. */
  t("o teto de execuções por `saida` é 4", ev.EXEC_POR_SAIDA === 4);
  const truncado = await ev.saida({ execIds: ["171281"], ignorados: ["171291", "171294"], nos: ["buscar_treinamento"] });
  t("id fora do teto aparece em `naoAbri`", (truncado.naoAbri || []).join() === "171291,171294");
  t("...e `pedidas` conta os que ficaram de fora", truncado.pedidas === 3 && truncado.abertas === 1);
  t("...e o resumo diz que elas NÃO foram abertas",
    /fora do teto, NÃO abertas: #171291, #171294/.test(ev.resumo({ oque: "saida" }, truncado)));
  /* A forma de sempre não mudou um byte: `execId` sozinho continua plano. */
  const plano = await ev.saida({ execId: "171281", nos: ["buscar_treinamento"] });
  t("`execId` sozinho continua devolvendo o bloco plano de sempre",
    plano.execId === "171281" && !!plano.nos && !plano.execucoes);
  t("...e o resumo dele também não mudou",
    /^abri a execução #171281: 1 nó\(s\) com saída/.test(ev.resumo({ oque: "saida" }, plano)));
  /* O resumo de várias nomeia cada execução: uma soma só ("3 nós com saída") não
     diria em qual delas. */
  const linhaTres = ev.resumo({ oque: "saida" }, tres);
  t("o resumo de várias nomeia cada execução", /#171281 \(1 com saída, 1 não rodaram\)/.test(linhaTres));
  t("...e diz quantas de quantas", /abri 3 de 3 execuções/.test(linhaTres));

  /* ────────── 4c. quais nós rodaram, para escolher deixar de ser chute ── */

  console.log("\n[ 04c ] execucoes com `comNos` — por qual ramo cada execução foi");

  const RD_TAG = { switch_tem_tag: [{}], api_get_evento_detalhe: [{}], parse_cache_evento: [{}] };
  const RD_SEM = { switch_tem_tag: [{}], api_get_eventos_lista1: [{}] };
  listaFalsa = { linhas: Array.from({ length: 15 }, (_, i) => ({ id: 194400 + i, status: "success",
    startedAt: "2026-08-19T10:00:00.000Z", stoppedAt: "2026-08-19T10:00:01.000Z" })) };
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    return { status: "success", startedAt: "x",
      data: { resultData: { runData: Number(id) % 2 ? RD_TAG : RD_SEM } } };
  };

  chamadas.length = 0;
  const ramos = await ev.execucoes({ wfId: "w1", comNos: true, limite: 15 });
  const rod = i => (ramos.execucoes[i] || {}).rodaram || [];
  t("cada linha traz os nomes dos nós que rodaram", rod(0).includes("switch_tem_tag"));
  /* É esta diferença que fazia falta: sem ela, escolher qual execução abrir era
     chute, e um pedido de 3 foi gasto numa que tinha ido pelo ramo errado. */
  t("...e dá para ver que uma foi por um ramo e outra por outro",
    rod(0).includes("api_get_eventos_lista1") && rod(1).includes("parse_cache_evento"));
  t("a lista traz o total de nós, não só os cortados", ramos.execucoes[0].rodaramTotal === 2);
  t("abriu só até o teto próprio do `comNos`",
    chamadas.filter(c => c[0] === "getRawExecution").length === ev.VARRER_COM_NOS);
  /* Os dois tetos são de NATUREZAS diferentes, e é por isso que não podem ser o
     mesmo número: o do `comNos` é de BYTES (cada linha carrega a lista de nomes
     inteira), e o do `contem` é de RELÓGIO (o resultado só leva o que casou). */
  t("...e ele é ordens de grandeza menor que o que o `contem` alcança",
    ev.VARRER_COM_NOS * 100 < ev.VARRER_TETO);
  /* Uma varredura truncada apresentada como completa é a mentira que este painel
     não conta — e aqui "não achei o nó" pode ser "não abri a execução". */
  t("diz quantas abriu de quantas", ramos.varridas === ev.VARRER_COM_NOS && ramos.total === 15);
  t("...e marca que truncou", ramos.truncado === true);
  t("...com aviso dizendo que 'não achei' pode ser 'não abri'",
    /pode estar nas que não abri/.test(ramos.aviso));
  t("...e o resumo do log diz abertas de quantas, não só 'listei 15'",
    /abri 6 de 15 execução\(ões\) para ver quais nós rodaram/.test(ev.resumo({ oque: "execucoes", comNos: true }, ramos)));
  const poucas = { linhas: listaFalsa.linhas.slice(0, 3) };
  listaFalsa = poucas;
  t("sem truncar, não há aviso inventado",
    (await ev.execucoes({ wfId: "w1", comNos: true })).aviso === null);

  /* Falha de leitura de UMA linha é estado próprio: uma linha sem `rodaram` e sem
     explicação leria como "essa execução não rodou nada". */
  n8n.getRawExecution = async id => { chamadas.push(["getRawExecution", String(id)]); throw new Error("timeout"); };
  const quebrado = await ev.execucoes({ wfId: "w1", comNos: true, limite: 2 });
  t("linha que não abriu diz por quê, em vez de vir sem nós",
    !!quebrado.execucoes[0].erro && quebrado.execucoes[0].rodaram === undefined);
  t("...e o motivo é nomeado", /timeout/.test(quebrado.execucoes[0].erro));

  /* Sem nenhum dos dois, `execucoes` continua não abrindo nada — é só a lista, e é
     o pedido mais barato que existe. */
  chamadas.length = 0;
  await ev.execucoes({ wfId: "w1", limite: 15 });
  t("sem `contem` e sem `comNos`, nenhuma execução é aberta",
    chamadas.filter(c => c[0] === "getRawExecution").length === 0);

  /* Devolve o n8n falso ao estado do topo do arquivo: os blocos abaixo leem
     `execFalsa`, e deixar o dublê deste bloco de pé faria os casos seguintes
     testarem a fixture errada — que é como um teste passa a provar outra coisa. */
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    if (!execFalsa) throw new Error("execução não encontrada");
    return execFalsa;
  };

  /* ──────────────── 5. a varredura por conteúdo, e seu teto ───────────── */

  console.log("\n[ 05 ] execucoes com `contem` — achar onde saiu o zero");

  listaFalsa = { linhas: Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, status: "success",
    startedAt: "2026-08-19T10:00:00.000Z", stoppedAt: "2026-08-19T10:00:01.000Z" })) };
  execFalsa = { status: "success", startedAt: "x", data: { resultData: { runData: {
    Manda: [{ data: { main: [[{ json: { texto: "seu ingresso custa R$ 0,00" } }]] } }]
  } } } };
  chamadas.length = 0;
  const busca = await ev.execucoes({ wfId: "w1", contem: "R$ 0,00", limite: 60 });
  /* NÃO existe mais teto de 40 aqui. Com todas as 60 casando, o que para a varredura
     é o teto de CASAMENTOS — que é sobre ter evidência bastante, não sobre relógio. */
  t("para no teto de casamentos, não num teto de contagem de execuções",
    busca.parou === "achados");
  t("...e o resultado traz ao menos o teto de casamentos",
    busca.execucoes.length >= ev.ACHADOS_MAX);
  /* Teto de DESPACHO: as aberturas que já estavam no ar terminam e entram. Descartar
     um casamento já pago para o número fechar redondo seria jogar evidência fora. */
  t("...e no máximo o pool a mais, porque quem já estava no ar termina",
    busca.execucoes.length <= ev.ACHADOS_MAX + ev.POOL_VARRER - 1);
  t("...e diz que truncou, porque sobraram listadas sem abrir", busca.truncado === true);
  /* Uma varredura truncada apresentada como completa é a mentira que este painel
     não conta: "não achei" precisaria significar "não existe". */
  t("...com aviso dizendo, com estas palavras, que NÃO ACHEI não é NÃO EXISTE",
    /NÃO ACHEI não é NÃO EXISTE/.test(busca.aviso));
  t("...e dizendo como continuar de onde parou", /peça de novo com `ate` igual a/.test(busca.aviso));
  t("...nomeando o nó onde casou", busca.execucoes[0].nos.includes("Manda"));
  t("abriu exatamente as que contou como abertas",
    chamadas.filter(c => c[0] === "getRawExecution").length === busca.varridas);
  t("não abriu além do que a lista trouxe", busca.varridas <= 60);

  const semBusca = await ev.execucoes({ wfId: "w1", limite: 60 });
  t("sem `contem` não abre execução nenhuma — é só a lista",
    (chamadas.length = 0, (await ev.execucoes({ wfId: "w1", limite: 60 })),
      chamadas.filter(c => c[0] === "getRawExecution").length === 0));
  t("...e devolve as linhas", semBusca.execucoes.length === 60);
  t("a linha traz id, status e quando", !!semBusca.execucoes[0].id && !!semBusca.execucoes[0].status && !!semBusca.execucoes[0].em);

  /* A busca é feita no RECORTE, não no payload cru: nem a busca vê o que a
     fronteira não deixa sair. */
  execFalsa = { status: "success", startedAt: "x", data: { resultData: { runData: {
    Manda: [{ data: { main: [[{ json: { to: "+55 41 99999-1395" } }]] } }]
  } } } };
  listaFalsa = { linhas: [{ id: 1, status: "success", startedAt: "x", stoppedAt: "x" }] };
  const porTel = await ev.execucoes({ wfId: "w1", contem: "999991395" });
  t("procurar pelo telefone cru não acha nada — a busca é no recorte", porTel.execucoes.length === 0);

  /* ─────────── 5c. os dois juntos: `contem` já abriu, `comNos` é grátis ── */

  console.log("\n[ 05c ] contem + comNos no mesmo pedido");

  listaFalsa = { linhas: Array.from({ length: 30 }, (_, i) => ({ id: 2000 + i, status: "success",
    startedAt: "x", stoppedAt: "x" })) };
  execFalsa = { status: "success", startedAt: "x", data: { resultData: { runData: {
    Manda: [{ data: { main: [[{ json: { texto: "seu ingresso custa R$ 0,00" } }]] } }],
    switch_cache_evento: [{ data: { main: [[{ json: { ok: true } }]] } }]
  } } } };
  chamadas.length = 0;
  const dois = await ev.execucoes({ wfId: "w1", contem: "R$ 0,00", comNos: true, limite: 30 });
  /* Com `contem` a execução já está aberta, então `comNos` não custa GET nenhum —
     o número de aberturas é o do `contem`, não a soma dos dois. */
  t("`comNos` junto com `contem` não abre execução a mais",
    chamadas.filter(c => c[0] === "getRawExecution").length === dois.varridas);
  const semComNos = (chamadas.length = 0,
    await ev.execucoes({ wfId: "w1", contem: "R$ 0,00", limite: 30 }),
    chamadas.filter(c => c[0] === "getRawExecution").length);
  t("...e o mesmo pedido sem `comNos` abre o mesmo tanto", semComNos === dois.varridas);
  t("os dois campos convivem e significam coisas diferentes",
    dois.execucoes[0].nos.join() === "Manda" && (dois.execucoes[0].rodaram || []).length === 2);
  /* Um nome só para "onde casou" e "quem rodou" faria a mesma lista significar duas
     coisas conforme o pedido — que é uma mentira silenciosa. */
  t("`nos` é onde casou; `rodaram` é quem rodou",
    dois.execucoes[0].nos.length === 1 && (dois.execucoes[0].rodaram || []).includes("switch_cache_evento"));
  t("só as primeiras linhas carregam `rodaram`, e o teto é o do comNos",
    dois.comNosEm === ev.VARRER_COM_NOS && dois.execucoes[ev.VARRER_COM_NOS].rodaram === undefined);
  /* Ausência de `rodaram` numa linha NÃO pode ler como "nenhum nó rodou". */
  t("...e o aviso diz que a ausência da lista não afirma nada",
    /a ausência da lista não diz nada/.test(dois.aviso));
  t("o resumo do log diz quantas trazem a lista",
    /com a lista de nós/.test(ev.resumo({ oque: "execucoes", contem: "R$ 0,00", comNos: true }, dois)));

  /* ─────────── 5d. os tetos, medidos em bytes e não escolhidos no olho ── */

  console.log("\n[ 05d ] o tamanho do pior caso de cada teto");

  /* Medido em disco nas conversas reais: o maior `saida` deste laço deu 21763
     bytes indentados. É a régua — um pedido que passe muito disso vira leitura em
     vez de decisão, porque a sessão lê o arquivo inteiro com `Read`. */
  const MAIOR_SAIDA_MEDIDA = 21763;
  /* A distribuição é a MEDIDA, não uma inventada: numa execução real do Iago
     rodaram 106 nós com nome de 15,9 caracteres em média (o maior, 33). Nomes
     longos demais aqui fariam o caso reprovar um teto que na instância cabe. */
  const nomesReais = Array.from({ length: 106 }, (_, i) => "no_medido_" + String(i).padStart(6, "0"));
  const linhaComNos = {
    id: "194351", status: "success", em: "2026-08-19T10:00:00.000Z", ms: 12345,
    rodaram: nomesReais, rodaramTotal: nomesReais.length
  };
  const bytesComNos = JSON.stringify({
    total: 60, varridas: ev.VARRER_COM_NOS, truncado: true, aviso: "x".repeat(200),
    execucoes: Array.from({ length: ev.VARRER_COM_NOS }, () => linhaComNos)
  }, null, 2).length;
  console.log("        comNos no teto (" + ev.VARRER_COM_NOS + " linhas × 106 nós): " + bytesComNos + " bytes");
  t("o pior caso do `comNos` fica na ordem do maior `saida` já escrito",
    bytesComNos <= MAIOR_SAIDA_MEDIDA);
  /* E a profundidade do `contem` não serve aqui: nas 1941 execuções que esta
     instância alcança (medido), o mesmo formato daria MEGABYTES — é por isso que o
     `comNos` não herdou o alcance novo, e a diferença não é de grau. */
  const MEDIDO_RETENCAO = 1941;
  t("...e na profundidade que o `contem` alcança ele NÃO ficaria — daria megabytes",
    bytesComNos / ev.VARRER_COM_NOS * MEDIDO_RETENCAO > 1000000);
  /* Os dois caminhos que respondem "quem rodou nesta execução" cortam no MESMO
     número: cortes diferentes fariam a mesma execução parecer diferente conforme o
     pedido que a encontrou. */
  t("o teto de nomes por linha é o mesmo do `quemRodou` do saida", ev.NOS_POR_LINHA === 120);
  execFalsa = { status: "success", startedAt: "x", data: { resultData: { runData:
    Object.fromEntries(Array.from({ length: 200 }, (_, i) => ["n" + i, [{}]])) } } };
  listaFalsa = { linhas: [{ id: 1, status: "success", startedAt: "x", stoppedAt: "x" }] };
  const cortou = await ev.execucoes({ wfId: "w1", comNos: true });
  t("...e o corte por linha é dito com o total real, não escondido",
    (cortou.execucoes[0].rodaram || []).length === ev.NOS_POR_LINHA && cortou.execucoes[0].rodaramTotal === 200);
  const cortouSaida = await ev.saida({ execId: "1", nos: ["n0"] });
  t("...igual ao `quemRodou`, no mesmo número", cortouSaida.quemRodou.length === ev.NOS_POR_LINHA);

  /* ─────────── 5b. o grafo: o bug que um teste de conversa achou ──────── */

  console.log("\n[ 05b ] grafo — os campos são em INGLÊS, e vazio não é sucesso");

  /* `extractGraph` devolve `{id, name, active, nodes, edges}`. A primeira versão
     do `grafo()` leu `nome/nos/arestas`, que não existem — então TODO fluxo
     voltava vazio, e o único caminho para seguir um sub-fluxo era cego.
     Achado por um teste de conversa de verdade, não por raciocínio. */
  /* Toda fixture de grafo passa por aqui, e o caso lá embaixo confere cada uma
     contra a forma lida do `n8n.js`: uma fixture nova que fale o idioma do bug
     é o caminho por onde esta regressão volta. */
  const FIXTURES_GRAFO = [];
  const comoGetGraph = f => (FIXTURES_GRAFO.push(f), f);
  grafoFalso = comoGetGraph({ id: "w9", name: "WhatsApp API Oficial", active: true,
    nodes: [{ nome: "a" }, { nome: "b" }], edges: [{ de: "a", para: "b" }] });
  const g = await ev.grafo({ wfId: "w9" });
  t("lê `nodes` e `edges`, que são os campos que existem", g.nos.length === 2 && g.arestas.length === 1);
  t("...e `name`, não `nome`", g.nome === "WhatsApp API Oficial");
  t("...e traz se o fluxo está ativo", g.ativo === true);

  /* O defeito grave não era o vazio — era o SILÊNCIO: o log dizia "li o grafo:
     0 nós" em nível `good`, e a sessão leu isso como "esse fluxo está vazio" e
     concluiu em cima disso. */
  grafoFalso = comoGetGraph({ id: "w9", name: "X", active: true, nodes: [], edges: [] });
  const vazio = await ev.grafo({ wfId: "w9" });
  t("um grafo sem nó nenhum é reconhecido como falha de leitura", ev.grafoVazio(vazio));
  const frase = ev.resumo({ oque: "grafo" }, vazio);
  t("...e o resumo diz que NÃO conseguiu ler", /NÃO CONSEGUI LER/.test(frase));
  t("...e proíbe concluir a partir dele", /não conclua nada/i.test(frase));
  t("grafo com nós não é lido como falha", !ev.grafoVazio(g));
  /* O nível do log é o que a sessão lê como confiança. */
  const u0 = fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8");
  t("no upgrade.js, leitura vazia entra como `warn`, não `good`",
    /NÃO CONSEGUI[\s\S]{0,80}\? "warn" : "good"/.test(u0));

  /* ── a forma vem do `n8n.js`, e não de uma fixture escrita à mão ────────── */

  /* POR QUE ISTO EXISTE, e é a parte que faltava. Os casos acima provam que o
     `grafo()` lê `nodes/edges` — contra uma fixture que ESTE ARQUIVO escreveu.
     Se um dia o `extractGraph` renomear um campo, a fixture continua verde e o
     `grafo()` volta a devolver vazio em produção: um dublê é uma segunda opinião
     sobre a forma, nunca a forma. Aqui a lista de campos é LIDA do `n8n.js` em
     tempo de execução, mesma disciplina do `audio-test.js`, que extrai o bloco de
     juízo do `flows.html` em vez de reimplementá-lo. */
  const FORMA = (() => {
    const src = fs.readFileSync(path.join(__dirname, "n8n.js"), "utf8");
    const m = /function extractGraph[\s\S]*?\n\s*return \{([^}]*)\};/.exec(src);
    return m ? m[1].split(",").map(s => (/^\s*([A-Za-z_$][\w$]*)/.exec(s) || [])[1]).filter(Boolean) : null;
  })();
  t("a forma de `getGraph` é lida do `n8n.js`, não escrita à mão aqui",
    Array.isArray(FORMA) && FORMA.length === 5);
  t("...e ela é em INGLÊS", ["id", "name", "active", "nodes", "edges"].every(k => FORMA.includes(k)));
  /* Se um campo em português aparecer LÁ, este arquivo tem de parar e ser lido —
     não silenciosamente continuar traduzindo o que já viria traduzido. */
  t("...e nenhum campo em português mora lá, que é o idioma do bug",
    !FORMA.some(k => ["nome", "nos", "arestas", "ativo"].includes(k)));

  /* O DUBLÊ DO TOPO FALAVA O IDIOMA DO BUG (`{nome, nos, arestas}`), e é por isso
     que a suíte não pegou o defeito: com ele de pé, o `grafo()` quebrado passava.
     Um dublê que só o código errado entende prova a cópia, não o contrato. */
  grafoFalso = null;
  const padrao = await n8n.getGraph("w0");
  t("o dublê deste arquivo devolve a forma REAL, senão a suíte prova a cópia",
    Object.keys(padrao).sort().join() === [...FORMA].sort().join());
  /* E as fixtures escritas à mão aqui em cima são conferidas contra a mesma forma,
     em vez de contra a lembrança de quem as escreveu. */
  t("...e toda fixture de grafo deste arquivo tem exatamente esses campos",
    FIXTURES_GRAFO.length === 2
    && FIXTURES_GRAFO.every(f => Object.keys(f).sort().join() === [...FORMA].sort().join()));

  /* Fim a fim com a fixture MONTADA A PARTIR da forma lida: renomear o campo de
     qualquer um dos dois lados reprova isto, que é exatamente o que o par
     `grafo()` + dublê errado não conseguia fazer. */
  const dinamico = {};
  for (const k of FORMA) dinamico[k] = k === "nodes" ? [{ name: "a" }, { name: "b" }, { name: "c" }]
    : k === "edges" ? [{ from: "a", to: "b" }]
    : k === "name" ? "Fluxo Dinâmico" : k === "active" ? true : "w7";
  grafoFalso = dinamico;
  const gd = await ev.grafo({ wfId: "w7" });
  t("`grafo()` lê a forma que o `n8n.js` REALMENTE devolve, campo a campo",
    gd.nos.length === 3 && gd.arestas.length === 1 && gd.nome === "Fluxo Dinâmico" && gd.ativo === true);
  /* A DECISÃO, fixada: a tradução acontece dentro do `grafo()` e a saída é em
     PORTUGUÊS, igual ao resto da interface que a sessão lê (`naoRodaram`,
     `quemRodou`, `comoCasou`). O que não pode voltar a existir é a tradução
     implícita — um pedido devolvendo `nodes/edges` obrigaria a sessão a saber qual
     verbo fala qual idioma. */
  t("a saída fica em português, e não vaza o inglês da API junto",
    ["wfId", "nome", "ativo", "nos", "arestas"].every(k => k in gd)
    && !("nodes" in gd) && !("edges" in gd) && !("name" in gd) && !("active" in gd));
  /* E ela não é uma preferência solta: `resumo` e `grafoVazio` já leem `nos`, então
     espelhar o inglês trocaria um bug silencioso por outro em três lugares. */
  t("...e é o que `resumo` e `grafoVazio` já leem", /r\.nos\.length/.test(fonte) && /r\.nos\b/.test(fonte));
  t("...e o resumo conta os nós que vieram, em vez de 0", /3 nós, 1 arestas/.test(ev.resumo({ oque: "grafo" }, gd)));

  /* ─────────── 5e. a agulha mascarada: o telefone que era impossível ──── */

  console.log("\n[ 05e ] a agulha é mascarada, porque o palheiro já é");

  /* Telefone e e-mail de MENTIRA, sempre: este arquivo vai para o git, e o número do
     Kauan não. `5521999990000` da conversa real fica de fora de propósito. */
  const TEL = "5511970001234";       // 13 dígitos, com código de país
  const TEL_LOCAL = "11970001234";   // o MESMO contato, gravado sem o 55
  const MAIL = "fulano.teste@exemplo.com.br";

  const a1 = ev.agulhas(TEL);
  const a2 = ev.agulhas("+55 11 97000-1234");
  const a3 = ev.agulhas("(11) 97000-1234");
  const masc = ag => (ag.alvos.find(x => x.tipo === "mascara") || {}).texto;
  const cauda = ag => (ag.alvos.find(x => x.tipo === "cauda") || {}).texto;

  t("um telefone é reconhecido como telefone", a1.forma === "telefone");
  /* A normalização é o que faz as escritas convergirem. Sem reduzir a dígitos antes de
     mascarar, `(11) 97000-1234` casa com o parêntese dentro da máscara — medido. */
  t("as duas escritas com código de país produzem a MESMA máscara", masc(a1) === masc(a2));
  t("...e a máscara é a que `maskPII` produz no palheiro", masc(a1) === "5511 ***** 1234");
  t("a escrita local casa por dentro da com código de país, pela direita",
    String(masc(a1)).includes(String(masc(a3))) && masc(a3) === "11 ***** 1234");
  t("a agulha crua continua sendo procurada — é o que acha chave e número não mascarado",
    a1.alvos[0].tipo === "literal" && a1.alvos[0].texto === TEL);
  /* A CAUDA NÃO É PADRÃO, e isso foi medido, não raciocinado: varrendo 1913 execuções
     reais com ela ligada, o único casamento de `***** 0000` foi
     `"timestamp":"1786 ***** 0000"` — um epoch mascarado. Quatro dígitos são 1 em 10
     mil e a varredura passa por ~20 mil valores mascarados; a colisão é esperada. E o
     furo do número que este arquivo fechou é o que CRIA esse palheiro. */
  t("a cauda NÃO entra por padrão — quatro dígitos casam epoch e id", cauda(a1) === undefined);
  t("...e entra com `frouxo`, pedida de propósito",
    (ag => (ag.alvos.find(x => x.tipo === "cauda") || {}).texto === "***** 1234")(ev.agulhas(TEL, { frouxo: true })));
  t("...com os 4 dígitos que `maskPII` preserva", ev.CAUDA_DIG === 4);
  /* O que substituiu a cauda no padrão: a mesma cauda com o PREFIXO da forma local.
     `11 ***** 1234` exige seis dígitos certos, e não casa `1786 ***** 0000`. */
  const vari = ag => ag.alvos.filter(x => x.tipo === "variante").map(x => x.texto);
  t("a variante é a forma local do mesmo número, ancorada no prefixo",
    vari(a1).includes("11 ***** 1234"));
  t("...e ela vem dos comprimentos de um número local, não de um país no código",
    ev.LOCAIS.join() === "11,10");
  t("...e um número já local não ganha variante do próprio comprimento",
    !vari(ev.agulhas(TEL_LOCAL)).includes("11 ***** 1234"));
  /* A ordem é o que decide o rótulo quando duas agulhas casam no mesmo texto — e a
     máscara CONTÉM a cauda, então sem ordem o relatório diria "cauda" sempre. */
  t("a ordem de força é literal, máscara, variante, cauda",
    ev.FORCAS.join() === "literal,mascara,variante,cauda");
  t("`casouComo` devolve a mais FORTE quando as duas casam",
    ev.casouComo("saiu para 5511 ***** 1234 agora", a1.alvos) === "mascara");
  t("...e a variante só quando é a única que casa",
    ev.casouComo("saiu para 11 ***** 1234 agora", a1.alvos) === "variante");
  t("...e a cauda, que é a mais fraca, só quando nem a variante casou",
    ev.casouComo("prazo 1786 ***** 1234 fim", ev.agulhas(TEL, { frouxo: true }).alvos) === "cauda");

  t("um e-mail é reconhecido como e-mail", ev.agulhas(MAIL).forma === "email");
  t("...e a máscara é a que sai na evidência", masc(ev.agulhas(MAIL)) === "f****@exemplo.com.br");
  /* `maskPII` preserva a primeira letra COMO ESTÁ, então a mesma caixa importa. */
  t("...e a escrita em outra caixa também é procurada",
    ev.agulhas("Fulano.Teste@exemplo.com.br").alvos.filter(x => x.tipo === "mascara").length === 2);
  /* O domínio sozinho casa OUTRA PESSOA, não este contato — então também é `frouxo`. */
  t("o domínio sozinho não entra por padrão — casaria qualquer pessoa nele",
    cauda(ev.agulhas(MAIL)) === undefined);
  t("...e com `frouxo` ele entra, rotulado como o casamento fraco que é",
    cauda(ev.agulhas(MAIL, { frouxo: true })) === "****@exemplo.com.br");

  /* O que NÃO pode ganhar tratamento de telefone, senão a busca comum vira ruído. */
  t("`R$ 0,00` não é telefone", ev.agulhas("R$ 0,00").forma === null);
  t("...e continua com uma agulha só", ev.agulhas("R$ 0,00").alvos.length === 1);
  t("um id com letra e 13 dígitos não é telefone", ev.agulhas("lead-5511970001234").forma === null);
  /* Abaixo de 10 dígitos `maskPII` não age, então a máscara seria o próprio literal e
     uma segunda agulha idêntica só faria o relatório mentir sobre COMO casou. */
  t("9 dígitos não ganham máscara — é o piso da própria `maskPII`",
    ev.agulhas("970001234").forma === null && ev.TEL_DIG_MIN === 10);
  t("...e acima do que `maskPII` consegue casar também não",
    ev.agulhas("1".repeat(ev.TEL_DIG_MAX + 1)).forma === null);

  /* FIM A FIM: o defeito 1. O palheiro é o recorte mascarado, e a busca acha. */
  listaFalsa = { linhas: Array.from({ length: 3 }, (_, i) => ({ id: 3000 + i, status: "success",
    startedAt: "2026-08-14T09:0" + i + ":00.000Z", stoppedAt: "2026-08-14T09:0" + i + ":01.000Z" })) };
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    /* Só a do meio falou com o contato, e ela guarda o número COM código de país. */
    const json = String(id) === "3001"
      ? { to: "+55 11 97000-1234", texto: "seu ingresso custa R$ 0,00" }
      : { to: "+55 41 98888-7777", texto: "tudo certo" };
    return { status: "success", startedAt: "x", data: { resultData: { runData: {
      Manda: [{ data: { main: [[{ json }]] } }] } } } };
  };
  const achouTel = await ev.execucoes({ wfId: "w1", contem: TEL });
  t("BUSCAR PELO TELEFONE ACHA — era impossível antes, e é a pergunta mais natural",
    achouTel.execucoes.length === 1 && achouTel.execucoes[0].id === "3001");
  t("...e o resultado diz que casou pela MÁSCARA, não pelo literal",
    achouTel.execucoes[0].comoCasou === "mascara");
  t("...e diz qual forma reconheceu, para a sessão não achar que a busca é literal",
    achouTel.forma === "telefone" && /reconheci a agulha como telefone/.test(achouTel.aviso));
  t("...nomeando as agulhas mascaradas que procurou", /`5511 \*\*\*\*\* 1234`/.test(achouTel.aviso));
  /* A fronteira NÃO se moveu: o telefone cru não está no que volta. */
  t("o telefone cru não aparece no resultado — a busca entende a máscara, não a desfaz",
    !/97000.?1234/.test(JSON.stringify(achouTel.execucoes)));
  t("...e o resumo do log diz que a agulha era um telefone, não só o que casou",
    /é um telefone/.test(ev.resumo({ oque: "execucoes", contem: TEL }, achouTel)));

  /* O MESMO contato gravado SEM código de país: as máscaras divergem no começo e
     coincidem no fim, e é para isso que a cauda existe. */
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    return { status: "success", startedAt: "x", data: { resultData: { runData: {
      Manda: [{ data: { main: [[{ json: { to: TEL_LOCAL, texto: "oi" } }]] } }] } } } };
  };
  const porVar = await ev.execucoes({ wfId: "w1", contem: TEL });
  t("o mesmo contato gravado sem o código de país é achado pela VARIANTE",
    porVar.execucoes.length === 3 && porVar.execucoes[0].comoCasou === "variante");
  t("...e o aviso diz que foi variante, e o que isso significa",
    /casaram por uma VARIANTE/.test(porVar.aviso) && /sem código de país/.test(porVar.aviso));
  /* Sem casar nada exato, a saída existe e tem de ser OFERECIDA — senão a sessão
     conclui "não existe" quando o certo era afrouxar e conferir. */
  t("...e o aviso oferece `frouxo` como o próximo passo, com o preço dito",
    /`frouxo: true`/.test(porVar.aviso) && /erra mais/.test(porVar.aviso));

  /* E com `frouxo`, o aviso repete o falso positivo REAL, com o exemplo medido. */
  n8n.getRawExecution = async id => ({ status: "success", startedAt: "x",
    data: { resultData: { runData: { Manda: [{ data: { main: [[{ json:
      { prazo: 1786000001234, texto: "nada de contato aqui" } }]] } }] } } } });
  const comFrouxo = await ev.execucoes({ wfId: "w1", contem: TEL, frouxo: true });
  t("com `frouxo`, a cauda casa um EPOCH mascarado — o falso positivo medido ao vivo",
    comFrouxo.execucoes.length === 3 && comFrouxo.execucoes[0].comoCasou === "cauda");
  t("...e o aviso nomeia esse caso, com o valor real que casou",
    comFrouxo.aviso.includes('"timestamp":"1786 ***** 0000"') && /epoch/.test(comFrouxo.aviso));
  t("...e manda conferir CADA UM com `saida`", /CONFIRA CADA UM com `saida`/.test(comFrouxo.aviso));
  /* Sem `frouxo`, o mesmo palheiro não casa nada — é a prova de que o padrão é limpo. */
  t("sem `frouxo`, o mesmo epoch NÃO casa — o padrão não produz falso positivo",
    (await ev.execucoes({ wfId: "w1", contem: TEL })).execucoes.length === 0);

  t("`frouxo` coagido de uma string é recusado, não virado true",
    !ev.validarPedido({ oque: "execucoes", contem: "x1", frouxo: "sim" }).ok);
  t("`frouxo` sem `contem` é recusado — não há busca para afrouxar",
    !ev.validarPedido({ oque: "execucoes", frouxo: true }).ok);
  t("`frouxo` com `contem` passa",
    ev.validarPedido({ oque: "execucoes", contem: "x1", frouxo: true }).valor.frouxo === true);

  /* ────────── 5f. o orçamento é de TEMPO, e a cobertura é declarada ───── */

  console.log("\n[ 05f ] varrer fundo: orçamento de tempo, e a cobertura em datas");

  /* Um feed que PAGINA como a API real: mais novo primeiro, `nextCursor` enquanto
     sobra, e `startedAt` descendo. Sem isto não há como testar andar para trás. */
  const feed = (n, passoMs = 3600000, base = "2026-08-19T15:00:00.000Z") => {
    const t0 = Date.parse(base);
    const rows = Array.from({ length: n }, (_, i) => ({
      id: 200000 - i, status: "success",
      startedAt: new Date(t0 - i * passoMs).toISOString(),
      stoppedAt: new Date(t0 - i * passoMs + 500).toISOString()
    }));
    return o => {
      const lim = Math.min(Number(o.limite) || 250, 250);
      const ini = o.cursor ? Number(String(o.cursor).slice(1)) : 0;
      const fim = Math.min(ini + lim, rows.length);
      return { linhas: rows.slice(ini, fim), cursor: fim < rows.length ? "c" + fim : null };
    };
  };
  let paginador = feed(0);
  n8n.listExecutions = async o => { chamadas.push(["listExecutions", o]); return paginador(o); };

  /* 300 execuções, nenhuma casando: é o caso em que o teto ANTIGO de 40 respondia
     "não achei" tendo olhado 13% — e o do Kauan estava nos outros 87%. */
  paginador = feed(300);
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    return { status: "success", startedAt: "x", data: { resultData: { runData: {
      Manda: [{ data: { main: [[{ json: { texto: "nada aqui" } }]] } }] } } } };
  };
  chamadas.length = 0;
  const fundo = await ev.execucoes({ wfId: "w1", contem: "R$ 0,00" });
  t("varre MUITO mais que as 40 de antes — abriu as 300", fundo.varridas === 300);
  t("...e o padrão do `contem` é ir fundo, sem `limite` pedido", fundo.total === 300);
  /* A lista pagina, e é isso que dá o denominador da cobertura. */
  t("a lista andou mais de uma página", chamadas.filter(c => c[0] === "listExecutions").length >= 2);
  t("...pedindo páginas cheias, porque listar é quase de graça",
    chamadas.filter(c => c[0] === "listExecutions")[0][1].limite === ev.PAGINA);
  t("terminou por FIM, e é o único jeito de 'não achei' valer algo", fundo.parou === "fim");
  t("...e diz isso em palavras", /varri tudo o que a lista alcançou/.test(fundo.aviso));
  t("nada casou, e a resposta não inventa casamento", fundo.execucoes.length === 0);
  t("a lista provou ter chegado ao fim do que existe", fundo.janela.alcancouOFim === true);
  t("...então não há continuação a oferecer", fundo.janela.continuar === null);
  t("...e nada de 'NÃO ACHEI não é NÃO EXISTE', porque aqui não é o caso",
    !/NÃO ACHEI não é NÃO EXISTE/.test(fundo.aviso));

  /* A COBERTURA EM DATAS. A frase que a sessão montou sozinha na conversa real
     ("todas de hoje, entre 13h14 e 15h00") tem de vir do DADO. */
  t("a cobertura diz quantas abriu, de quantas, e a janela em datas",
    fundo.janela.abertas.n === 300 && !!fundo.janela.abertas.de && !!fundo.janela.abertas.ate);
  t("...e as datas são as das linhas, não uma inferência",
    fundo.janela.abertas.ate === "2026-08-19T15:00:00.000Z");
  t("...com a mais antiga sendo a mais antiga aberta de verdade",
    fundo.janela.abertas.de === new Date(Date.parse("2026-08-19T15:00:00.000Z") - 299 * 3600000).toISOString());
  t("o aviso escreve a janela para uma pessoa ler", /07\/08 04:00Z a 19\/08 15:00Z/.test(fundo.aviso));
  t("o resumo do log carrega a janela, não só a contagem",
    /entre 07\/08 04:00Z a 19\/08 15:00Z/.test(ev.resumo({ oque: "execucoes", contem: "R$ 0,00" }, fundo)));
  t("...e quanto tempo levou, porque o orçamento é de tempo",
    /\ds ·/.test(ev.resumo({ oque: "execucoes", contem: "R$ 0,00" }, fundo)));
  t("a data é escrita em UTC e DIZ que é — o `em` da linha vem em UTC",
    /Z$/.test(ev.quando("2026-08-19T15:00:22.479Z")));

  /* O ORÇAMENTO DE TEMPO. Com um `getRawExecution` lento, ele para antes do fim — e é
     a condição que substituiu o teto de contagem. */
  const orcReal = ev.ORC_VARRER_MS;
  paginador = feed(400);
  n8n.getRawExecution = async id => {
    await new Promise(r => setTimeout(r, 12));
    return { status: "success", startedAt: "x", data: { resultData: { runData: {
      Manda: [{ data: { main: [[{ json: { texto: "nada" } }]] } }] } } } };
  };
  /* O orçamento verdadeiro são 210s, então o teste o encurta para 150ms em vez de
     esperar três minutos e meio. É o MESMO caminho e o mesmo relógio — e `_orcMs` não
     é campo de pedido: há um caso abaixo provando que a sessão não alcança este botão. */
  const estourou = await ev.execucoes({ wfId: "w1", contem: "R$ 0,00", _orcMs: 150 });
  t("o orçamento de TEMPO para a varredura antes do fim", estourou.parou === "tempo");
  t("...tendo aberto bem menos que as 400", estourou.varridas < 400 && estourou.varridas > 0);
  t("...e diz que sobraram listadas sem abrir", estourou.truncado === true);
  /* Aqui "não achei" não pode ler como "não existe" — é a regra da casa. */
  t("...com as palavras NÃO ACHEI não é NÃO EXISTE", /NÃO ACHEI não é NÃO EXISTE/.test(estourou.aviso));
  t("...dizendo quantas sobraram e até quando elas vão",
    new RegExp("sobraram " + (400 - estourou.varridas) + " listadas sem abrir").test(estourou.aviso));
  t("...e COMO continuar de onde parou, com um instante que existe na lista",
    /peça de novo com `ate` igual a 2026-08-/.test(estourou.aviso));
  /* 110ms e não 92: a rajada de 16 subestima, e a varredura de 1913 seguidas mediu o
     custo de verdade. Aos 210s iniciais ela parava em 98,6% e disparava a continuação
     inteira para 3 segundos de trabalho que faltavam. */
  t("o orçamento cobre a retenção medida ao custo medido de uma varredura inteira",
    orcReal === 240000 && orcReal > 1941 * 110);
  t("o teto absoluto de contagem existe, e é maior que o que o tempo alcança",
    ev.VARRER_TETO > (orcReal / 92));

  /* O POOL. Não pode passar de `POOL_VARRER`, e não pode ser 1 — 1 são 285ms por
     execução medidos, contra 92ms com 4. */
  let vivas = 0, pico = 0;
  paginador = feed(40);
  n8n.getRawExecution = async id => {
    vivas++; pico = Math.max(pico, vivas);
    await new Promise(r => setTimeout(r, 5));
    vivas--;
    return { status: "success", startedAt: "x", data: { resultData: { runData: {} } } };
  };
  await ev.execucoes({ wfId: "w1", contem: "zzz" });
  t("abre em paralelo, senão varrer fundo levaria 3× mais", pico > 1);
  t("...e nunca mais que o pool", pico <= ev.POOL_VARRER);
  /* Um pool maior aqui não abriria mais conexões: `request()` no n8n.js tem
     `MAX_INFLIGHT = 4` GLOBAL, e os mesmos 4 slots servem o poll do painel. */
  t("...e o pool é o mesmo MAX_INFLIGHT do n8n.js, que é o gargalo real",
    ev.POOL_VARRER === 4 && /const MAX_INFLIGHT = 4;/.test(fs.readFileSync(path.join(__dirname, "n8n.js"), "utf8")));

  /* ORDEM e EXATIDÃO. Com pool, quem termina primeiro não é quem começou primeiro. */
  paginador = feed(20);
  const casaEm = new Set(["199995", "199987", "199981"]);
  n8n.getRawExecution = async id => {
    /* Os que casam demoram MAIS, para chegarem fora de ordem se ninguém ordenar. */
    await new Promise(r => setTimeout(r, casaEm.has(String(id)) ? 25 : 2));
    return { status: "success", startedAt: "x", data: { resultData: { runData: {
      Manda: [{ data: { main: [[{ json: { texto: casaEm.has(String(id)) ? "achou zzz aqui" : "nada" } }]] } }] } } } };
  };
  const ordenado = await ev.execucoes({ wfId: "w1", contem: "zzz" });
  t("os casamentos voltam na ORDEM DA LISTA, não na ordem em que chegaram",
    ordenado.execucoes.map(l => l.id).join() === "199995,199987,199981");

  /* Falha de leitura NÃO é ausência de casamento, e a conta tem de aparecer. */
  paginador = feed(10);
  n8n.getRawExecution = async id => {
    if (Number(id) % 2) throw new Error("timeout");
    return { status: "success", startedAt: "x", data: { resultData: { runData: {} } } };
  };
  const comFalha = await ev.execucoes({ wfId: "w1", contem: "zzz" });
  t("execução que não abriu é contada, não some", comFalha.naoAbriram === 5);
  t("...e o aviso diz que falha de leitura não é ausência de casamento",
    /falha de leitura não é ausência de casamento/.test(comFalha.aviso));
  t("...e ela ainda conta como aberta na cobertura, porque foi tentada",
    comFalha.varridas === 10);

  /* ────────── 5g. a janela pedida, e andar para trás sem pular linha ─── */

  console.log("\n[ 05g ] `desde`/`ate`/`cursor`: escolher ONDE os minutos são gastos");

  paginador = feed(600);   // 600 horas de histórico, uma execução por hora
  n8n.getRawExecution = async id => ({ status: "success", startedAt: "x",
    data: { resultData: { runData: { Manda: [{ data: { main: [[{ json: { texto: "nada" } }]] } }] } } } });
  chamadas.length = 0;
  const janelada = await ev.execucoes({ wfId: "w1", contem: "zzz",
    desde: "2026-08-05T00:00:00Z", ate: "2026-08-06T00:00:00Z" });
  t("a janela de data filtra a lista", janelada.total === 25);
  t("...e é ela que faz o caso do Kauan custar segundos em vez de minutos",
    janelada.varridas === 25);
  t("...com a janela pedida ecoada no resultado",
    janelada.janela.pedida.desde === "2026-08-05T00:00:00Z");
  t("...e a janela REAL das que abriu, que é a que importa",
    janelada.janela.abertas.de === "2026-08-05T00:00:00.000Z"
    && janelada.janela.abertas.ate === "2026-08-06T00:00:00.000Z");
  /* Andar até a janela custa páginas de lista, que são quase de graça (257ms cada
     medido) — e é por isso que a janela vale a pena mesmo longe do topo. */
  t("andou páginas até alcançar a janela", chamadas.filter(c => c[0] === "listExecutions").length >= 2);
  t("a lista cobriu a janela pedida inteira, então nada a continuar",
    janelada.janela.alcancouOFim === true && janelada.janela.continuar === null);

  /* O fuso. `Date.parse("2026-08-10T00:00")` no Node é hora LOCAL: nesta máquina isso
     desloca a janela em 3 horas, em silêncio, e a sessão concluiria sobre uma faixa de
     tempo que não foi a varrida. O campo `em` que ela lê vem em UTC. */
  t("instante sem fuso é lido como UTC, não como hora local da máquina",
    ev.instante("2026-08-10T00:00") === Date.parse("2026-08-10T00:00:00Z"));
  t("...e só a data também", ev.instante("2026-08-10") === Date.parse("2026-08-10T00:00:00Z"));
  t("...e com fuso explícito ele é respeitado",
    ev.instante("2026-08-10T00:00:00-03:00") === Date.parse("2026-08-10T03:00:00Z"));
  t("texto que não é instante é recusado, não vira NaN silencioso", ev.instante("semana passada") === null);

  /* `erro1` em vez de `.erros[0]` cru: uma recusa que não veio deixa `erros`
     undefined, e a asserção EXPLODIA em vez de reprovar com nome. Mutante morto por
     crash é mutante morto por acidente — e o relatório fica sem dizer o que quebrou. */
  const erro1 = r => String(((r && r.erros) || [])[0] || "");
  const jRuim = ev.validarPedido({ oque: "execucoes", desde: "semana passada" });
  t("`desde` que não é instante é recusado nomeando o campo", !jRuim.ok && /`desde`/.test(erro1(jRuim)));
  t("...e a recusa diz a forma que serve e que sem fuso é UTC",
    /2026-08-14T13:14:00Z/.test(erro1(jRuim)) && /UTC/.test(erro1(jRuim)));
  /* Janela invertida devolveria zero execuções abertas e um "não achei" que não
     afirma nada — pior que uma recusa, porque parece resposta. */
  const jInv = ev.validarPedido({ oque: "execucoes", desde: "2026-08-12", ate: "2026-08-10" });
  t("janela invertida é recusada em vez de responder 'não achei'", !jInv.ok);
  t("...explicando qual ponta é qual", /`desde` é o começo \(mais antigo\)/.test(erro1(jInv)));
  t("janela na ordem certa passa",
    ev.validarPedido({ oque: "execucoes", desde: "2026-08-10", ate: "2026-08-12" }).ok);

  t("`cursor` torto é recusado — não é uma data nem um id",
    !ev.validarPedido({ oque: "execucoes", cursor: "ontem à tarde!" }).ok);
  t("`cursor` no formato do n8n passa",
    ev.validarPedido({ oque: "execucoes", cursor: "MjAyNi0wOC0xOA==" }).valor.cursor === "MjAyNi0wOC0xOA==");
  chamadas.length = 0;
  await ev.execucoes({ wfId: "w1", limite: 5, cursor: "c100" });
  t("...e é repassado ao n8n, senão continuar do cursor não continuaria nada",
    chamadas.filter(c => c[0] === "listExecutions")[0][1].cursor === "c100");

  /* Lista truncada por `limite`: o `nextCursor` da página aponta para DEPOIS dela
     inteira, então usá-lo pularia linhas em silêncio. */
  const cortada = await ev.execucoes({ wfId: "w1", limite: 30 });
  t("lista cortada no `limite` diz que NÃO chegou ao fim", cortada.janela.alcancouOFim === false);
  t("...e oferece continuar por `ate`, que sempre serve", !!cortada.janela.continuar.ate);
  /* Aqui a página fechou EXATA no `limite`, então o `nextCursor` aponta para a linha
     seguinte de verdade e pode ser oferecido. */
  t("...e oferece o cursor, porque a página foi consumida até o fim",
    cortada.janela.continuar.cursor === "c30");
  /* Já com a página cheia e o corte no meio dela, o `nextCursor` aponta para DEPOIS
     das 250 — usá-lo pularia 220 linhas em silêncio, que é o defeito que este campo
     existe para não cometer. */
  const meioDaPagina = await ev.execucoes({ wfId: "w1", limite: 30, cursor: "c0" });
  t("cortado no MEIO de uma página cheia, o cursor é retido",
    meioDaPagina.total === 30 && meioDaPagina.janela.continuar.cursor === null);
  t("...e sobra o `ate`, que repete a última linha em vez de pular 220",
    !!meioDaPagina.janela.continuar.ate);
  t("...e o aviso diz com o que continuar e que dá para apontar a janela direto",
    /`cursor` igual ao `janela.continuar.cursor`/.test(cortada.aviso) && /`desde`\/`ate`/.test(cortada.aviso));
  /* A MAIS ANTIGA, e não a mais nova. `faixa()` devolve `de` = mais antiga e
     `ate` = mais nova, e a primeira versão desta frase lia o campo errado — dizia
     "a mais antiga de 19/08 15:00", que é exatamente a linha do TOPO da lista. Uma
     cobertura que nomeia a ponta errada é pior que não nomear ponta nenhuma. */
  t("...e a MAIS ANTIGA listada é nomeada, para 'não achei' não ser 'não existe'",
    /a mais antiga de 18\/08 10:00Z/.test(cortada.aviso));
  t("...e quando o cursor é retido, a frase troca para o `ate`",
    /`ate` igual ao `janela.continuar.ate`/.test(meioDaPagina.aviso));

  /* Teto de páginas: com mais linhas que `PAGINAS_MAX × PAGINA`, a lista para e diz. */
  paginador = feed(ev.LISTA_TETO + 500);
  const bateuPag = await ev.execucoes({ wfId: "w1", limite: ev.LISTA_TETO + 400 });
  t("a lista para no teto de páginas em vez de andar para sempre",
    bateuPag.total === ev.LISTA_TETO && bateuPag.janela.paginas === ev.PAGINAS_MAX);
  t("...e diz que foi o teto de páginas", /bati o teto de 16 páginas/.test(bateuPag.aviso));

  /* O progresso, porque três minutos de tela parada leem como travada. */
  paginador = feed(60);
  n8n.getRawExecution = async id => {
    await new Promise(r => setTimeout(r, 3));
    return { status: "success", startedAt: "x", data: { resultData: { runData: {} } } };
  };
  const passos = [];
  await ev.atender({ oque: "execucoes", wfId: "w1", contem: "zzz" }, { aoProgresso: p => passos.push(p) });
  t("a varredura conta o progresso enquanto acontece", passos.length >= 1);
  t("...com quantas de quantas, e quantos casamentos até agora",
    passos.every(p => typeof p.abertas === "number" && p.de === 60 && typeof p.achados === "number"));
  /* `atender` sem gancho é o caminho de quem não quer contar — não pode quebrar. */
  t("e `atender` sem gancho nenhum continua funcionando",
    !!(await ev.atender({ oque: "execucoes", wfId: "w1", limite: 3 })).execucoes);

  /* Esc precisa parar a CARGA, não só descartar o resultado: uma varredura de três
     minutos que segue rodando depois do cancelamento continua ocupando os 4 slots do
     n8n.js — e é o poll do painel que fica sem eles. */
  let abertasAntesDeParar = 0;
  const parado = await ev.atender({ oque: "execucoes", wfId: "w1", contem: "zzz" },
    { parar: () => ++abertasAntesDeParar > 8 });
  t("o gancho de parada interrompe a varredura no meio", parado.parou === "parado");
  t("...tendo aberto muito menos que as 60 listadas", parado.varridas < 60 && parado.varridas > 0);
  t("...e a resposta continua dizendo a cobertura, em vez de fingir que varreu tudo",
    parado.janela.alcancouOFim === true && parado.truncado === true
    && /fui interrompido antes do fim/.test(parado.aviso));

  /* O orçamento NÃO é campo do pedido: uma sessão não pode encurtar a varredura para
     fingir que varreu, nem esticá-la para prender o cockpit por meia hora. */
  t("`_orcMs` não sobrevive à validação — a sessão não alcança o orçamento",
    ev.validarPedido({ oque: "execucoes", contem: "zzz", _orcMs: 1 }).valor._orcMs === undefined);
  t("...nem `aoProgresso`, que é função e viria de fora",
    ev.validarPedido({ oque: "execucoes", contem: "zzz", aoProgresso: "x" }).valor.aoProgresso === undefined);

  /* Devolve os dublês ao estado do topo, para os blocos seguintes não testarem a
     fixture errada — que é como um teste passa a provar outra coisa. */
  n8n.listExecutions = async o => { chamadas.push(["listExecutions", o]); return listaFalsa || { linhas: [], cursor: null }; };
  n8n.getRawExecution = async id => {
    chamadas.push(["getRawExecution", String(id)]);
    if (!execFalsa) throw new Error("execução não encontrada");
    return execFalsa;
  };

  /* ───────────────────────── 6. o resumo para o log ──────────────────── */

  console.log("\n[ 06 ] o resumo que vai para o log da conversa");

  const p1 = { oque: "saida" };
  t("o resumo de `saida` diz a execução e quantos nós",
    /execução #7: 1 nó/.test(ev.resumo(p1, { execId: "7", nos: { a: [] }, naoRodaram: [] })));
  t("...e diz quantos não rodaram, quando houve",
    /não rodaram/.test(ev.resumo(p1, { execId: "7", nos: {}, naoRodaram: ["x", "y"] })));
  t("o resumo da busca diz o que procurou e quantas abriu",
    /procurei "R\$0" em 5 execução/.test(ev.resumo({ oque: "execucoes", contem: "R$0" }, { varridas: 5, execucoes: [] })));
  t("todo resumo carrega o tamanho, para o gasto ser visível",
    /KB$/.test(ev.resumo({ oque: "fluxos" }, { fluxos: [] })));

  /* ──────────────── 7. o laço na conversa, e o teto de gasto ─────────── */

  console.log("\n[ 07 ] o laço no upgrade.js");

  const u = fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8");
  t("o teto de pedidos por pergunta existe", /const MAX_PEDIDOS = 3;/.test(u));
  /* Sem teto, uma sessão pede para sempre: cada volta é uma rodada nova, e cada
     volta PARECE progresso na tela. */
  t("...e batido, ela é obrigada a responder com o que tem",
    /você já pediu evidência .* vezes nesta pergunta, que é o teto/.test(u));
  t("a evidência é escrita em arquivo, não colada no prompt", /path\.join\(s\.dir, arq\)/.test(u));
  t("...e o prompt só leva a LISTA do que já veio", /Não peça de novo o que já está aí/.test(u));
  t("uma busca que falha volta como fato, não mata a conversa", /FALHOU: " \+ msg/.test(u));
  t("o log diz o que foi buscado e o tamanho", /evidencia\.resumo\(v\.pedido, r\)/.test(u));
  t("a sessão continua sem rede", /WebFetch,WebSearch/.test(u) && /Bash,PowerShell/.test(u));
  /* ESTE CASO AFIRMAVA QUE O upgrade.js NÃO ESCREVIA. Era verdade até o §4; o
     §6 acrescentou a escrita em produção de propósito, e apagar o caso deixaria
     este arquivo sem nenhuma afirmação sobre o assunto.
     A garantia que ele guardava não era "não escreve" — era "nenhuma escrita sem
     dono declarado", que é o que a etapa 0 do §6.5.1 construiu: toda chamada de
     escrita nomeia quem está escrevendo, e a fila do n8n.js usa esse nome para
     serializar entre donos e reentrar no mesmo.
     O escopo forte — quantas escritas existem, onde estão, e que o fluxo VIVO só
     é tocado pelo primitivo compartilhado — vive em upgrade-test.js. Aqui fica a
     metade que interessa a este arquivo. */
  t("...e toda escrita do upgrade.js passa por um dono declarado",
    (u.match(/n8n\.(putWorkflow|createWorkflow)\s*\(/g) || []).length ===
    (u.match(/n8n\.(putWorkflow|createWorkflow)\s*\(\s*dono\b/g) || []).length);

  console.log(bad
    ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
    : "\npassou: " + ok + " casos — a sessão vê valor sem ver contato, e nenhum pedido escreve");
  process.exit(bad ? 1 : 0);
})();
