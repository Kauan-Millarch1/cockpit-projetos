/* agentes-test.js — os portões de agente e a detecção, sem gastar modelo.
 *
 * O que decide se esta feature vale algo é o fluxo que sai do Tester, e isso o
 * `tester-smoke.js` mede pagando uma construção. Aqui é o que dá para provar de
 * graça: que o doc é lido, que a triagem separa agente de notificação, e que cada
 * portão reprova o defeito que ele existe para pegar.
 *
 * Uso: node agentes-test.js
 */

"use strict";

const assert = require("assert");
const agentes = require("./agentes");
const catalog = require("./catalog");
const { validar } = require("./tester");

let ok = 0, falhou = 0;
function t(nome, fn) {
  try { fn(); console.log("  ok   " + nome); ok++; }
  catch (e) { console.log("  FALHA " + nome + "\n         " + String(e && e.message || e).split("\n")[0]); falhou++; }
}
function secao(s) { console.log("\n" + s); }

/* ------------------------------------------------------------------ o doc */

secao("o doc");

t("tester-agentes.md existe e tem os quatro blocos", () => {
  const st = agentes.docStatus();
  assert.ok(st.encontrado, "não achou o arquivo");
  assert.deepStrictEqual(st.faltando, [], "blocos faltando: " + st.faltando.join(", "));
  assert.ok(st.chars > 10000, "doc pequeno demais: " + st.chars + " chars");
});

/* A tabela do próprio doc cita `<!-- BLOCO: nome -->` no meio de uma frase para
 * explicar o formato. Com o regex sem ancoragem de linha, essa menção virava um
 * bloco de verdade chamado `nome`. */
t("nenhum bloco fantasma vindo da prosa que explica as âncoras", () => {
  const st = agentes.docStatus();
  assert.deepStrictEqual(st.desconhecidos, [], "blocos que ninguém lê: " + st.desconhecidos.join(", "));
  assert.strictEqual(st.blocos.length, agentes.ESPERADOS.length, "blocos: " + st.blocos.join(", "));
});

t("cada bloco tem conteúdo de verdade", () => {
  for (const b of agentes.ESPERADOS) {
    const txt = agentes.bloco(b);
    assert.ok(txt.length > 400, "bloco `" + b + "` tem só " + txt.length + " chars");
  }
});

t("os blocos não vazam a âncora de fechamento", () => {
  for (const b of agentes.ESPERADOS) {
    assert.ok(!/<!--/.test(agentes.bloco(b)), "bloco `" + b + "` contém comentário HTML");
  }
});

t("o trecho da entrevista não carrega a arquitetura", () => {
  const e = agentes.trechoEntrevista();
  assert.ok(e.length > 1000, "trecho vazio");
  // A etapa 1 não precisa saber typeVersion; se souber, foi o doc inteiro que veio.
  assert.ok(!/typeVersion/.test(e), "a entrevista está levando as receitas");
});

t("as regras inline de construção são curtas e cobrem o que não pode falhar", () => {
  const c = agentes.regrasConstrucao();
  assert.ok(/ai_languageModel/.test(c), "sem as portas ai_*");
  assert.ok(/onError/.test(c), "sem a regra de onError");
  assert.ok(/PREENCHER/.test(c), "sem a regra de não inventar regra de negócio");
  // Curtas é o requisito, não um detalhe: o prompt viaja em `-p` e o limite da
  // linha de comando do Windows é 32767 caracteres para o comando inteiro.
  assert.ok(c.length < 3000, "as regras inline têm " + c.length + " chars; o conhecimento longo vai por arquivo");
});

t("os blocos longos somados NÃO cabem num prompt — é por isso que vão para arquivo", () => {
  const soma = ["arquitetura", "receitas", "armadilhas"].map(b => agentes.bloco(b).length).reduce((a, b) => a + b, 0);
  assert.ok(soma > 24000, "se isto cair abaixo do limite, a decisão de escrever AGENTES.md continua certa, mas o teste perdeu o sentido: soma = " + soma);
});

/* Um portão que reprova algo que o prompt nunca pediu custa uma rodada inteira do
 * modelo de construção — o item mais caro da esteira. Este teste é o que impede
 * alguém de adicionar um portão e esquecer de avisar quem constrói. */
t("todo portão duro é avisado nas regras inline OU no doc", () => {
  const inline = agentes.regrasConstrucao();
  const doc = ["arquitetura", "receitas", "armadilhas"].map(b => agentes.bloco(b)).join("\n");
  const OBRIGATORIOS = [
    ["hasOutputParser", /hasOutputParser/],
    ["campo messages no schema", /`?messages`?/],
    ["sessionKey com expressão", /sessionKey/],
    ["portas ai_*", /ai_languageModel/],
    ["buffer com wait", /wait|buffer/i],
    ["onError nos nós de gravação", /onError/]
  ];
  const faltando = OBRIGATORIOS.filter(([, re]) => !re.test(inline) && !re.test(doc)).map(([n]) => n);
  assert.deepStrictEqual(faltando, [], "portões que o construtor nunca é avisado sobre: " + faltando.join(", "));
  // Os três mais silenciosos têm que estar INLINE: são os que o n8n aceita sem
  // reclamar, então o modelo não tem como descobrir sozinho que errou.
  for (const re of [/hasOutputParser/, /sessionKey/, /messages/]) {
    assert.ok(re.test(inline), "não está nas regras inline: " + re);
  }
});

/* ------------------------------------------------------------- a detecção */

secao("a triagem por texto");

const AGENTE = [
  "quero um agente que responde lead no whatsapp",
  "criar um agente de vendas pro whatsapp",
  "um chatbot pra atender cliente no instagram",
  "atendente virtual que tira dúvida sobre o curso",
  "quero uma IA que conversa com o lead e qualifica",
  "um SDR automático",
  "bot no telegram que responde perguntas do time"
];
const NAO_AGENTE = [
  "avisar no slack a cada venda no mercado livre",
  "resumo diário das tarefas abertas do clickup",
  "quando entrar pedido novo, notificar no whatsapp",
  "relatório semanal de faturamento por e-mail",
  "sincronizar tarefas do clickup com o calendário",
  "disparar alerta quando o estoque acabar"
];

for (const i of AGENTE) t('agente:      "' + i + '"', () => assert.ok(agentes.pareceAgente(i), "não detectou"));
for (const i of NAO_AGENTE) t('automação:   "' + i + '"', () => assert.ok(!agentes.pareceAgente(i), "detectou agente onde não há"));

secao("quem decide é o modelo, o texto é a rede");

t("o modelo dizendo `automacao` vence a triagem por texto", () => {
  const d = agentes.decidir({ tipoDoModelo: "automacao", ideia: "um agente que responde lead no whatsapp" });
  assert.strictEqual(d.ehAgente, false);
});
t("o modelo dizendo `agente` vence a triagem por texto", () => {
  const d = agentes.decidir({ tipoDoModelo: "agente", ideia: "mandar um resumo por e-mail" });
  assert.strictEqual(d.ehAgente, true);
});
t("sem campo do modelo, cai no texto", () => {
  assert.strictEqual(agentes.decidir({ ideia: "agente de vendas no whatsapp" }).ehAgente, true);
  assert.strictEqual(agentes.decidir({ tipoDoModelo: "lixo", ideia: "avisar no slack" }).ehAgente, false);
});

/* ------------------------------------------------------------- os portões */

secao("os portões de agente");

/* O CATALOGO E ESTADO POR CHECKOUT, e isto era um `require` seco.
   `.cache-catalog.json` e um cache — gitignorado de proposito, destilado dos fluxos
   vivos, regeneravel num comando — entao num checkout novo ele nao existe e o
   `require` derrubava a bateria com `Cannot find module`, mensagem que num
   repositorio de zero dependencia parece pacote faltando. MEDIDO num clone real.
   Os portoes daqui para baixo precisam dele; a TRIAGEM acima nao, e ela ja rodou.
   Entao o pulo e daqui, nao do topo do arquivo: sair no topo custaria as asserções
   de triagem sem comprar nada. Codigo 2 — "passou com pulos" — porque dizer
   "passou" sobre portao que nao rodou e a unica saida errada. */
const CAT = require("path").join(__dirname, ".cache-catalog.json");
if (!require("fs").existsSync(CAT)) {
  console.log("  PULADOS os portões de agente — sem `.cache-catalog.json` neste checkout");
  console.log("          (e um cache, gitignorado). Para rodar: node catalog.js --refresh");
  console.log("\n" + (falhou ? "FALHOU" : "passou COM PULOS") + ": " + ok + " ok, "
    + falhou + " falha(s), os portões PULADOS por falta de arquivo gitignorado\n");
  process.exit(falhou ? 1 : 2);
}
const cat = require("./.cache-catalog.json");

/* Um agente mínimo que PASSA. Tudo abaixo é este objeto com um defeito. */
function agenteBom() {
  return {
    name: "agente_atendimento_whatsapp",
    nodes: [
      { name: "webhook_whatsapp", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { path: "ag", httpMethod: "POST" } },
      { name: "empilhar_no_buffer", type: "n8n-nodes-base.redis", typeVersion: 1, position: [200, 0], parameters: { operation: "push" }, onError: "continueRegularOutput" },
      { name: "esperar_buffer", type: "n8n-nodes-base.wait", typeVersion: 1.1, position: [400, 0], parameters: { amount: 15 } },
      { name: "agente_principal", type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 2.2, position: [600, 0],
        parameters: { promptType: "define", text: "={{ $json.Mensagem }}", hasOutputParser: true, options: { systemMessage: "=voce atende" } } },
      { name: "modelo_openai", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1.2, position: [600, 200], parameters: {} },
      { name: "memoria_conversa", type: "@n8n/n8n-nodes-langchain.memoryRedisChat", typeVersion: 1.5, position: [750, 200],
        parameters: { sessionIdType: "customKey", sessionKey: "=memoria:{{ $json.telefone }}", contextWindowLength: 20 } },
      { name: "parser_saida", type: "@n8n/n8n-nodes-langchain.outputParserStructured", typeVersion: 1.3, position: [900, 200],
        parameters: { schemaType: "manual", inputSchema: '{"type":"object","properties":{"messages":{"type":"array"}}}' } },
      { name: "enviar_whatsapp", type: "n8n-nodes-base.whatsApp", typeVersion: 1.1, position: [800, 0], parameters: { operation: "send" } }
    ],
    connections: {
      webhook_whatsapp:  { main: [[{ node: "empilhar_no_buffer", type: "main", index: 0 }]] },
      empilhar_no_buffer:{ main: [[{ node: "esperar_buffer", type: "main", index: 0 }]] },
      esperar_buffer:    { main: [[{ node: "agente_principal", type: "main", index: 0 }]] },
      agente_principal:  { main: [[{ node: "enviar_whatsapp", type: "main", index: 0 }]] },
      modelo_openai:     { ai_languageModel: [[{ node: "agente_principal", type: "ai_languageModel", index: 0 }]] },
      memoria_conversa:  { ai_memory:        [[{ node: "agente_principal", type: "ai_memory", index: 0 }]] },
      parser_saida:      { ai_outputParser:  [[{ node: "agente_principal", type: "ai_outputParser", index: 0 }]] }
    },
    settings: { executionOrder: "v1" }
  };
}

/* O caso base tem que passar limpo, senão todo teste abaixo é vácuo. */
t("o agente mínimo passa em todos os portões", () => {
  const f = validar(agenteBom(), cat, true);
  assert.deepStrictEqual(f, [], "reprovou o caso bom:\n         - " + f.join("\n         - "));
});

/* Cada defeito: muda uma coisa, e o portão que existe para ela tem que falar. */
const DEFEITOS = [
  ["sem nó de agente", /não tem nenhum nó/, wf => { wf.nodes = wf.nodes.filter(n => n.type !== "@n8n/n8n-nodes-langchain.agent");
    delete wf.connections.agente_principal;
    for (const k of ["modelo_openai", "memoria_conversa", "parser_saida"]) delete wf.connections[k];
    wf.connections.esperar_buffer = { main: [[{ node: "enviar_whatsapp", type: "main", index: 0 }]] }; }],

  ["sem modelo", /não tem nó de modelo/, wf => {
    wf.nodes = wf.nodes.filter(n => n.name !== "modelo_openai"); delete wf.connections.modelo_openai; }],

  ["sem memória", /não tem memória/, wf => {
    wf.nodes = wf.nodes.filter(n => n.name !== "memoria_conversa"); delete wf.connections.memoria_conversa; }],

  ["memória com chave fixa", /mistura a conversa de todos/, wf => {
    wf.nodes.find(n => n.name === "memoria_conversa").parameters.sessionKey = "eleven-labs"; }],

  ["sem structured output", /structured output/, wf => {
    wf.nodes = wf.nodes.filter(n => n.name !== "parser_saida"); delete wf.connections.parser_saida;
    wf.nodes.find(n => n.name === "agente_principal").parameters.hasOutputParser = false; }],

  ["parser ligado sem hasOutputParser", /hasOutputParser/, wf => {
    delete wf.nodes.find(n => n.name === "agente_principal").parameters.hasOutputParser; }],

  ["schema sem o campo messages", /campo `messages`/, wf => {
    wf.nodes.find(n => n.name === "parser_saida").parameters.inputSchema = '{"type":"object","properties":{"texto":{"type":"string"}}}'; }],

  ["modelo ligado por main em vez de ai_languageModel", /deveria ser `ai_languageModel`/, wf => {
    wf.connections.modelo_openai = { main: [[{ node: "agente_principal", type: "main", index: 0 }]] }; }],

  ["memória ligada por main", /deveria ser `ai_memory`/, wf => {
    wf.connections.memoria_conversa = { main: [[{ node: "agente_principal", type: "main", index: 0 }]] }; }],

  ["mensageria sem buffer (sem wait)", /sem buffer/, wf => {
    wf.nodes = wf.nodes.filter(n => n.name !== "esperar_buffer");
    wf.connections.empilhar_no_buffer = { main: [[{ node: "agente_principal", type: "main", index: 0 }]] };
    delete wf.connections.esperar_buffer; }],

  ["dois agentes no mesmo fluxo", /nós de agente no mesmo fluxo/, wf => {
    const a = JSON.parse(JSON.stringify(wf.nodes.find(n => n.name === "agente_principal")));
    a.name = "agente_dois"; a.position = [600, 400];
    wf.nodes.push(a);
    wf.connections.agente_dois = { main: [[{ node: "enviar_whatsapp", type: "main", index: 0 }]] }; }],

  ["gravação sem onError", /nós de gravação sem/, wf => {
    for (let i = 0; i < 3; i++) {
      wf.nodes.push({ name: "gravar_" + i, type: "n8n-nodes-base.supabase", typeVersion: 1, position: [1000, i * 150], parameters: { operation: "create" } });
      wf.connections["enviar_whatsapp"] = wf.connections["enviar_whatsapp"] || { main: [[]] };
      wf.connections["enviar_whatsapp"].main[0].push({ node: "gravar_" + i, type: "main", index: 0 });
    } }]
];

for (const [nome, re, quebrar] of DEFEITOS) {
  t("reprova: " + nome, () => {
    const wf = agenteBom();
    quebrar(wf);
    const f = validar(wf, cat, true);
    assert.ok(f.some(x => re.test(x)),
      "nenhuma falha casou " + re + "\n         falhas: " + (f.length ? f.join("\n                 ") : "(nenhuma)"));
  });
}

t("nós que só LEEM não entram na conta do onError", () => {
  const wf = agenteBom();
  // Cinco leituras sem onError. Um portão que reclamasse delas treinaria o leitor
  // a ignorar a mensagem, que é como um portão morre.
  for (let i = 0; i < 5; i++) {
    wf.nodes.push({ name: "ler_" + i, type: "n8n-nodes-base.redis", typeVersion: 1, position: [1000, i * 150], parameters: { operation: "get" } });
    wf.connections.enviar_whatsapp = wf.connections.enviar_whatsapp || { main: [[]] };
    wf.connections.enviar_whatsapp.main[0].push({ node: "ler_" + i, type: "main", index: 0 });
  }
  const f = validar(wf, cat, true);
  assert.ok(!f.some(x => /nós de gravação/.test(x)), "reclamou de leitura:\n         " + f.join("\n         "));
});

t("supabase sem `operation` conta como escrita (o default dele é create)", () => {
  const wf = agenteBom();
  for (let i = 0; i < 3; i++) {
    wf.nodes.push({ name: "sb_" + i, type: "n8n-nodes-base.supabase", typeVersion: 1, position: [1000, i * 150], parameters: { tableId: "t" } });
    wf.connections.enviar_whatsapp = wf.connections.enviar_whatsapp || { main: [[]] };
    wf.connections.enviar_whatsapp.main[0].push({ node: "sb_" + i, type: "main", index: 0 });
  }
  const f = validar(wf, cat, true);
  assert.ok(f.some(x => /nós de gravação/.test(x)), "não pegou supabase sem operation");
});

/* O doc promete que uma tool sai DECLARADA e não implementada: o Tester constrói
 * um workflow por vez, então o `workflowId` é um marcador. Se um portão reprovasse
 * isso, a promessa do doc seria impossível de cumprir e todo build de agente com
 * tool morreria nas três rodadas. */
t("uma tool com `workflowId` marcado [PREENCHER] passa nos portões", () => {
  const wf = agenteBom();
  wf.nodes.push({
    name: "tool_handoff", type: "@n8n/n8n-nodes-langchain.toolWorkflow", typeVersion: 2, position: [1050, 200],
    parameters: {
      name: "handoff_humano", description: "Transfere para humano. Use quando o lead pedir.",
      workflowId: { __rl: true, value: "[PREENCHER: id do sub-workflow]", mode: "list" },
      workflowInputs: { mappingMode: "defineBelow", value: { phone: "={{ $json.telefone }}" } }
    }
  });
  wf.connections.tool_handoff = { ai_tool: [[{ node: "agente_principal", type: "ai_tool", index: 0 }]] };
  const f = validar(wf, cat, true);
  assert.deepStrictEqual(f, [], "reprovou uma tool declarada:\n         - " + f.join("\n         - "));
});

t("uma tool ligada por main em vez de ai_tool é reprovada", () => {
  const wf = agenteBom();
  wf.nodes.push({
    name: "tool_handoff", type: "@n8n/n8n-nodes-langchain.toolWorkflow", typeVersion: 2, position: [1050, 200],
    parameters: { name: "handoff_humano", description: "d", workflowId: { __rl: true, value: "x", mode: "list" } }
  });
  wf.connections.tool_handoff = { main: [[{ node: "agente_principal", type: "main", index: 0 }]] };
  const f = validar(wf, cat, true);
  assert.ok(f.some(x => /deveria ser `ai_tool`/.test(x)), "não pegou a tool na porta errada:\n         " + f.join("\n         "));
});

secao("os portões de agente NÃO valem para automação");

t("o mesmo fluxo sem agente passa quando ehAgente é falso", () => {
  const wf = {
    name: "avisar_venda_no_slack",
    nodes: [
      { name: "quando_vender", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: {} },
      { name: "avisar_slack", type: "n8n-nodes-base.slack", typeVersion: 2.3, position: [200, 0], parameters: { text: "oi" } }
    ],
    connections: { quando_vender: { main: [[{ node: "avisar_slack", type: "main", index: 0 }]] } },
    settings: { executionOrder: "v1" }
  };
  const f = validar(wf, cat, false);
  assert.ok(!f.some(x => /agente|memória|structured/i.test(x)), "portão de agente vazou:\n         " + f.join("\n         "));
});

secao("a fatia do catálogo nunca sai truncada no meio");

t("fatia grande corta por tipo inteiro e devolve o que ficou de fora", () => {
  const tipos = Object.keys(cat.nodes).slice(0, 40);
  const r = catalog.fatiaTexto(cat, tipos, 6000);
  JSON.parse(r.texto);                                    // o teste: precisa ser JSON válido
  assert.ok(r.chars <= 6600, "estourou o teto: " + r.chars);
  assert.ok(r.omitidos.length > 0, "com teto de 6000 e 40 tipos, algo tinha que sobrar de fora");
  assert.strictEqual(r.incluidos.length + r.omitidos.length, tipos.length, "perdeu tipo pelo caminho");
});

t("um tipo só passa mesmo estourando o teto (senão o prompt vem vazio)", () => {
  const r = catalog.fatiaTexto(cat, ["n8n-nodes-base.httpRequest"], 10);
  JSON.parse(r.texto);
  assert.strictEqual(r.incluidos.length, 1);
});

t("os 23 tipos de um agente cabem no teto de 20000", () => {
  const tipos = ["n8n-nodes-base.webhook", "n8n-nodes-base.respondToWebhook", "n8n-nodes-base.httpRequest",
    "n8n-nodes-base.set", "n8n-nodes-base.if", "n8n-nodes-base.filter", "n8n-nodes-base.noOp",
    "n8n-nodes-base.scheduleTrigger", "@n8n/n8n-nodes-langchain.agent", "@n8n/n8n-nodes-langchain.lmChatOpenAi",
    "@n8n/n8n-nodes-langchain.memoryRedisChat", "@n8n/n8n-nodes-langchain.memoryBufferWindow",
    "@n8n/n8n-nodes-langchain.outputParserStructured", "@n8n/n8n-nodes-langchain.toolWorkflow",
    "@n8n/n8n-nodes-langchain.toolCode", "@n8n/n8n-nodes-langchain.openAi", "n8n-nodes-base.redis",
    "n8n-nodes-base.wait", "n8n-nodes-base.switch", "n8n-nodes-base.merge", "n8n-nodes-base.code",
    "n8n-nodes-base.supabase", "n8n-nodes-base.whatsApp"];
  const r = catalog.fatiaTexto(cat, tipos, 20000);
  JSON.parse(r.texto);
  assert.deepStrictEqual(r.omitidos, [], "ficou tipo de fora num agente: " + r.omitidos.join(", "));
});

secao("o fantasma recusa agente pelo motivo certo");

t("recusa nomeia o modelo, não a expressão", () => {
  const r = agentes.recusaFantasma(agenteBom());
  assert.ok(r && r.ok === false, "não recusou");
  assert.ok(/modelo de linguagem/.test(r.recusa), "motivo errado: " + r.recusa);
  assert.strictEqual(r.classe, "agente");
});

t("fluxo sem agente não é interceptado pela recusa", () => {
  assert.strictEqual(agentes.recusaFantasma({ nodes: [{ type: "n8n-nodes-base.slack" }] }), null);
});

secao("mensageria");

t("whatsApp é mensageria; slack não é", () => {
  assert.ok(agentes.ehMensageria({ nodes: [{ type: "n8n-nodes-base.whatsApp" }] }));
  assert.ok(agentes.ehMensageria({ nodes: [{ type: "n8n-nodes-base.telegram" }] }));
  assert.ok(!agentes.ehMensageria({ nodes: [{ type: "n8n-nodes-base.slack" }] }));
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exit(falhou ? 1 : 0);
