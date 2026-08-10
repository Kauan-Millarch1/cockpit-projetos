/* edicao-test.js — o remendo de um projeto salvo, sem gastar modelo.
 *
 * `aplicarRemendo` é o que decide o que um pedido de edição PODE fazer com um
 * fluxo que já existe, e ele é a única peça deste caminho que não depende de
 * nenhuma resposta de modelo. Cada teste aqui prova a rejeição de um defeito
 * específico — a lista é a mesma que o prompt promete ao modelo, e é isso que
 * impede o prompt e o código de divergirem em silêncio.
 *
 * Custa zero: nenhum spawn, nenhuma rede. `node edicao-test.js`
 */

"use strict";

const assert = require("assert");
const { aplicarRemendo, promptEdicao, PROMPT_MAX } = require("./tester");

let ok = 0, bad = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { bad++; console.log("  FALHA " + nome + "\n         " + (e && e.message)); }
};
const grupo = n => console.log("\n" + n);

/* Três nós em linha, que é a forma do fluxo do print: gatilho -> set -> slack. */
const base = () => ({
  name: "aviso_slack_email_novo",
  nodes: [
    { name: "trigger_gmail_novo_email", type: "n8n-nodes-base.gmailTrigger", typeVersion: 1, position: [0, 0], parameters: {} },
    { name: "montar_mensagem_email", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [220, 0], parameters: { mode: "manual" } },
    { name: "slack_dm_aviso_email", type: "n8n-nodes-base.slack", typeVersion: 2.2, position: [440, 0], parameters: { select: "user" } }
  ],
  connections: {
    trigger_gmail_novo_email: { main: [[{ node: "montar_mensagem_email", type: "main", index: 0 }]] },
    montar_mensagem_email: { main: [[{ node: "slack_dm_aviso_email", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1" }
});

const nomes = wf => (wf.nodes || []).map(n => n.name);
const arestas = wf => {
  const out = [];
  for (const [de, outs] of Object.entries(wf.connections || {})) {
    for (const ramos of Object.values(outs || {})) {
      for (const ramo of ramos || []) for (const c of ramo || []) out.push(de + "->" + (c && c.node));
    }
  }
  return out.sort();
};

grupo("o quarto verbo: remover");

t("remove o nó e some com as arestas que entravam nele", () => {
  const r = aplicarRemendo(base(), {
    removeNodes: ["montar_mensagem_email"],
    rewire: { trigger_gmail_novo_email: { main: [[{ node: "slack_dm_aviso_email", type: "main", index: 0 }]] } }
  });
  assert.deepStrictEqual(r.errors, [], r.errors.join(" · "));
  assert.deepStrictEqual(nomes(r.workflow), ["trigger_gmail_novo_email", "slack_dm_aviso_email"]);
  assert.deepStrictEqual(arestas(r.workflow), ["trigger_gmail_novo_email->slack_dm_aviso_email"]);
  assert.deepStrictEqual(r.removidos, ["montar_mensagem_email"]);
});

t("remover sem religar não inventa conexão — deixa o buraco à mostra", () => {
  const r = aplicarRemendo(base(), { removeNodes: ["montar_mensagem_email"] });
  assert.deepStrictEqual(r.errors, [], r.errors.join(" · "));
  // A aresta que apontava para o nó removido some; a que saía do gatilho fica
  // vazia. Quem reprova isso é o portão de conexões, não este aplicador.
  assert.ok(!arestas(r.workflow).some(a => /montar_mensagem_email/.test(a)),
    "sobrou aresta apontando para o nó removido: " + arestas(r.workflow).join(", "));
});

t("só remover JÁ É uma mudança — não cai em «patch não muda nada»", () => {
  const r = aplicarRemendo(base(), { removeNodes: ["slack_dm_aviso_email"] });
  assert.deepStrictEqual(r.errors, [], r.errors.join(" · "));
});

t("remover nó que não existe é erro nomeado", () => {
  const r = aplicarRemendo(base(), { removeNodes: ["nó_que_nunca_existiu"] });
  assert.ok(r.errors.some(e => /nó_que_nunca_existiu/.test(e)), r.errors.join(" · "));
});

t("um patch totalmente vazio é recusado", () => {
  const r = aplicarRemendo(base(), {});
  assert.ok(r.errors.some(e => /não muda nada/.test(e)), r.errors.join(" · "));
});

t("patch que não é objeto é recusado sem estourar", () => {
  for (const x of [null, "patch", 42, ["a"]]) {
    const r = aplicarRemendo(base(), x);
    assert.strictEqual(r.workflow, null);
    assert.ok(r.errors.length);
  }
});

grupo("o que o remendo continua sem poder fazer");

t("recusa credentials em nó novo", () => {
  const r = aplicarRemendo(base(), {
    addNodes: [{ name: "gravar_linha", type: "n8n-nodes-base.supabase", typeVersion: 1, position: [660, 0],
      parameters: {}, credentials: { supabaseApi: { id: "1", name: "conta" } } }]
  });
  assert.ok(r.errors.some(e => /credentials/.test(e)), r.errors.join(" · "));
});

t("recusa mexer em credentials de nó existente", () => {
  const r = aplicarRemendo(base(), {
    updateNodes: [{ name: "slack_dm_aviso_email", credentials: { slackApi: { id: "9" } } }]
  });
  assert.ok(r.errors.some(e => /credentials/.test(e)), r.errors.join(" · "));
});

t("recusa trocar o `type` de um nó existente", () => {
  const r = aplicarRemendo(base(), {
    updateNodes: [{ name: "slack_dm_aviso_email", type: "n8n-nodes-base.httpRequest" }]
  });
  assert.ok(r.errors.some(e => /type/.test(e)), r.errors.join(" · "));
  assert.strictEqual(r.workflow.nodes.find(n => n.name === "slack_dm_aviso_email").type, "n8n-nodes-base.slack");
});

t("recusa renomear por dentro do updateNodes", () => {
  const r = aplicarRemendo(base(), { updateNodes: [{ name: "slack_dm_aviso_email", disabled: true }] });
  assert.deepStrictEqual(r.errors, [], r.errors.join(" · "));
  assert.ok(nomes(r.workflow).includes("slack_dm_aviso_email"), "o nome não pode mudar por patch");
});

t("nó novo sem type ou sem position é recusado", () => {
  const semTipo = aplicarRemendo(base(), { addNodes: [{ name: "x", position: [0, 0] }] });
  assert.ok(semTipo.errors.length, "aceitou nó sem type");
  const semPos = aplicarRemendo(base(), { addNodes: [{ name: "x", type: "n8n-nodes-base.set" }] });
  assert.ok(semPos.errors.length, "aceitou nó sem position");
});

t("nó novo com nome que já existe é recusado", () => {
  const r = aplicarRemendo(base(), {
    addNodes: [{ name: "slack_dm_aviso_email", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [660, 0] }]
  });
  assert.ok(r.errors.some(e => /já existe/.test(e)), r.errors.join(" · "));
});

grupo("acrescentar e religar");

t("acrescenta um nó e o costura no fim da linha", () => {
  const r = aplicarRemendo(base(), {
    addNodes: [{ name: "gravar_registro_aviso", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [660, 0], parameters: {} }],
    rewire: { slack_dm_aviso_email: { main: [[{ node: "gravar_registro_aviso", type: "main", index: 0 }]] } }
  });
  assert.deepStrictEqual(r.errors, [], r.errors.join(" · "));
  assert.strictEqual(r.workflow.nodes.length, 4);
  assert.ok(arestas(r.workflow).includes("slack_dm_aviso_email->gravar_registro_aviso"));
});

t("rewire substitui as saídas INTEIRAS do nó, nunca faz merge parcial", () => {
  const wf = base();
  wf.connections.trigger_gmail_novo_email.main[0].push({ node: "slack_dm_aviso_email", type: "main", index: 0 });
  const r = aplicarRemendo(wf, {
    rewire: { trigger_gmail_novo_email: { main: [[{ node: "montar_mensagem_email", type: "main", index: 0 }]] } }
  });
  assert.deepStrictEqual(r.errors, [], r.errors.join(" · "));
  assert.deepStrictEqual(arestas(r.workflow).filter(a => a.startsWith("trigger_")),
    ["trigger_gmail_novo_email->montar_mensagem_email"]);
});

t("rewire a partir de um nó que não existe é erro nomeado", () => {
  const r = aplicarRemendo(base(), { rewire: { fantasma: { main: [[]] } } });
  assert.ok(r.errors.some(e => /fantasma/.test(e)), r.errors.join(" · "));
});

t("o fluxo original nunca é mutado — o remendo trabalha numa cópia", () => {
  const wf = base();
  const antes = JSON.stringify(wf);
  aplicarRemendo(wf, {
    removeNodes: ["montar_mensagem_email"],
    updateNodes: [{ name: "slack_dm_aviso_email", disabled: true }]
  });
  assert.strictEqual(JSON.stringify(wf), antes, "aplicarRemendo mutou o fluxo salvo");
});

grupo("o prompt cabe na linha de comando");

t("o pior caso do prompt de edição cabe no teto interno", () => {
  const x = n => "a".repeat(n);
  const s = {
    nivel: "sou técnico",
    // 40 mensagens é o que `escreverContextoEdicao` leva para o arquivo; o que
    // entra no prompt é só o pedido, e ele é limitado a 2000 no `pedirEdicao`.
    chat: [], respostas: []
  };
  const p = promptEdicao(s, x(2000), x(4000));
  console.log("         prompt " + p.length + "  teto " + PROMPT_MAX + "  folga " + (PROMPT_MAX - p.length));
  assert.ok(p.length <= PROMPT_MAX, p.length + " chars, teto " + PROMPT_MAX);
});

t("o prompt diz ao modelo os quatro verbos e as recusas que o código aplica", () => {
  const p = promptEdicao({ nivel: "sei o básico" }, "tira o Slack", null);
  for (const termo of ["updateNodes", "addNodes", "removeNodes", "rewire", "credentials", "active", "typeVersion"]) {
    assert.ok(p.includes(termo), "o prompt não menciona `" + termo + "`");
  }
  // A saída de pergunta tem que estar oferecida, senão toda dúvida vira patch.
  assert.ok(/"tipo": "resposta"/.test(p), "o prompt não oferece o formato de resposta sem patch");
});

console.log("\npassou: " + ok + " ok, " + bad + " falha(s)\n");
process.exit(bad ? 1 : 0);
