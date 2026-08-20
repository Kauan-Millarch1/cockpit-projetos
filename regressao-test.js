"use strict";
/* regressao-test.js — as checagens 5a e 5b, e cada caso recusa um defeito com nome.
 *
 * De graça: nenhum modelo, nenhum spawn, nenhuma chamada ao n8n. As duas funções
 * recebem a evidência por parâmetro justamente para que isto seja possível — um
 * veredito de cor que só desse para conferir com uma instância viva na frente é
 * um veredito que ninguém confere.
 *
 * O GRUPO 3 É O CORAÇÃO DO ARQUIVO: a 5a nunca pode ficar verde sem ter olhado o
 * caminho que o patch mexe. É o "verde falso" do §5.5, e é o único defeito aqui
 * que ninguém veria acontecer — a tela mostraria verde, o botão apareceria, e a
 * checagem simplesmente não teria conferido nada.
 *
 *   node regressao-test.js
 */
const r = require("./regressao.js");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const bad = m => { total++; falhas++; console.log("  FALHA " + m); };
const t = (nome, cond) => cond ? ok(nome) : bad(nome);

/* ── fixtures ──────────────────────────────────────────────────────────────
 * Um fluxo de três nós, do jeito que os desta instância são: gatilho, um passo
 * de dado, um destino. Pequeno de propósito — o que está em teste é o veredito,
 * não a capacidade de percorrer um documento grande. */
const fluxo = (over = {}) => JSON.parse(JSON.stringify({
  name: "avisa vendas",
  nodes: [
    { name: "cron", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: {} },
    { name: "monta", type: "n8n-nodes-base.set", typeVersion: 3, position: [200, 0], parameters: {} },
    { name: "avisar", type: "n8n-nodes-base.slack", typeVersion: 2.2, position: [400, 0], parameters: { channelId: "#v", text: "oi" } }
  ],
  connections: {
    cron: { main: [[{ node: "monta", type: "main", index: 0 }]] },
    monta: { main: [[{ node: "avisar", type: "main", index: 0 }]] }
  },
  ...over
}));

/* Uma execução com `runData` extraído, no formato que `extractExecDetail` emite.
   `src` é o que registra a aresta de verdade. */
const exec = (pares) => ({
  id: "1", status: "success",
  nodeRuns: pares.map(([nome, de], i) => ({
    name: nome, index: i, ms: 10, status: "success",
    items: 1, keys: [], binary: false,
    src: de ? { no: de, run: 0, saida: 0 } : null
  }))
});

/* A execução completa do fluxo acima: cron → monta → avisar. */
const cheia = () => exec([["cron", null], ["monta", "cron"], ["avisar", "monta"]]);

const patchDe = p => Object.assign({ updateNodes: [], addNodes: [], rewire: {} }, p);
const cor = async (over = {}) => (await r.regressaoCaminho(Object.assign({
  antes: fluxo(), depois: fluxo(), patch: patchDe({}), amostra: [cheia()]
}, over))).cor;

(async () => {

console.log("\n1. `tocados` — o que o patch mexe, e o que a cobertura pode exigir");
{
  const a = fluxo();
  const x = r.tocados(patchDe({
    updateNodes: [{ name: "monta" }],
    addNodes: [{ name: "novo_log" }],
    rewire: { avisar: { main: [[]] } }
  }), a);
  t("`updateNodes` de nó existente entra como preexistente", x.preexistentes.has("monta"));
  t("origem de `rewire` existente entra como preexistente", x.preexistentes.has("avisar"));
  /* Um nó que nasce neste patch NUNCA executou, então exigir que ele apareça na
     amostra deixaria a 5a cinza para sempre em todo patch que acrescenta nó. */
  t("`addNodes` NÃO entra na exigência de cobertura", x.criados.has("novo_log") && !x.preexistentes.has("novo_log"));
  t("`updateNodes` de nome que não existe no documento não é cobrável",
    !r.tocados(patchDe({ updateNodes: [{ name: "fantasma" }] }), a).preexistentes.has("fantasma"));
}

console.log("\n2. `oQueRodou` — a aresta trafegada sai do `src`, não da ordem");
{
  const v = r.oQueRodou([cheia()]);
  t("conta as execuções lidas", v.lidas === 1);
  t("registra os três nós", v.nos.size === 3);
  t("deriva a aresta cron→monta do `src` de quem recebeu", v.ares.has(r.arestaKey("cron", "monta")));
  t("deriva a aresta monta→avisar", v.ares.has(r.arestaKey("monta", "avisar")));
  /* Sem `src` não há aresta: o gatilho não é alimentado por ninguém, e inventar
     um antecessor pela ordem de execução é a lição do `Wait` dentro de laço. */
  t("nó sem `src` não inventa aresta", v.ares.size === 2);
  const dois = r.oQueRodou([cheia(), cheia()]);
  t("o mesmo nó em duas execuções conta duas vezes", dois.nos.get("monta") === 2);
  t("execução sem `nodeRuns` não conta como lida", r.oQueRodou([{ id: "x" }]).lidas === 0);
}

console.log("\n3. o VERDE FALSO — a 5a nunca fica verde sem ter olhado o alvo");
{
  /* O caso que carrega o §5.5 inteiro. O patch mexe num nó que a amostra não
     viu; sem esta regra a linha sairia verde e o botão de aplicar apareceria a
     partir de uma checagem que não conferiu nada. */
  const so_cron = exec([["cron", null]]);
  const c = await cor({ patch: patchDe({ updateNodes: [{ name: "avisar" }] }), amostra: [so_cron] });
  t("alvo fora da amostra é CINZA, nunca verde", c === "cold");

  const l = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(),
    patch: patchDe({ updateNodes: [{ name: "avisar" }] }), amostra: [so_cron]
  });
  t("...e a linha diz quantas execuções foram lidas", /1 execução/.test(l.frase));
  t("...e NOMEIA o alvo que ficou de fora", /avisar/.test(l.frase));
  t("...e o detalhe lista os alvos fora da amostra",
    l.detalhe.some(d => /alvos fora da amostra/.test(d) && /avisar/.test(d)));

  t("sem execução nenhuma também é cinza", (await cor({ amostra: [] })) === "cold");
  t("...com a frase dizendo que não há caminho para comparar",
    /não li execução nenhuma/.test((await r.regressaoCaminho({
      antes: fluxo(), depois: fluxo(), patch: patchDe({}), amostra: []
    })).frase));
}

console.log("\n4. a expansão do §5.5 — uma tentativa, e só uma");
{
  const so_cron = exec([["cron", null]]);
  let chamadas = 0;
  const c = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(),
    patch: patchDe({ updateNodes: [{ name: "avisar" }] }),
    amostra: [so_cron],
    expandir: async () => { chamadas++; return [cheia(), cheia()]; }
  });
  t("a expansão resgata a cobertura e a linha sai do cinza", c.cor === "ok");
  t("...e ela é chamada UMA vez", chamadas === 1);

  /* Resgatar a cobertura não é o mesmo que cobrir bem: se a expansão trouxe uma
     única execução com o alvo, a linha passa COM ressalva. Sem este caso, a
     diferença entre "olhei" e "olhei o bastante" sumiria. */
  const magra = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(),
    patch: patchDe({ updateNodes: [{ name: "avisar" }] }),
    amostra: [so_cron], expandir: async () => [cheia()]
  });
  t("expansão que cobre uma vez só passa com ressalva de cobertura magra",
    magra.cor === "warn" && magra.detalhe.some(d => /cobertura magra/.test(d)));

  /* A expansão que NUNCA cobre é onde um laço se esconderia. O teto aqui é do
     TESTE, não da função: uma implementação que insista estoura com uma frase em
     vez de pendurar, e um teste que pendura não é vermelho — é CI parado, que
     ninguém lê como defeito. Mesma disciplina do `mutex-test.js` correndo contra
     relógio para o mutante do deadlock voltar vermelho. */
  let chamadas2 = 0;
  let estourou = null;
  const c2 = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(),
    patch: patchDe({ updateNodes: [{ name: "avisar" }] }),
    amostra: [so_cron],
    expandir: async () => {
      if (++chamadas2 > 1) { estourou = "a expansão foi chamada " + chamadas2 + " vezes"; throw new Error(estourou); }
      return [so_cron];
    }
  });
  t("expansão que não cobre mantém o CINZA", c2.cor === "cold");
  t("...e é tentada UMA vez só, nunca em laço", chamadas2 === 1 && !estourou);

  const c3 = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(),
    patch: patchDe({ updateNodes: [{ name: "avisar" }] }),
    amostra: [so_cron],
    expandir: async () => { throw new Error("503 do n8n"); }
  });
  /* Expansão que FALHOU e expansão que não achou nada dão o mesmo cinza, mas o
     motivo escrito é diferente — e é o motivo que decide se ele tenta de novo. */
  t("expansão que estourou vira cinza com o erro escrito",
    c3.cor === "cold" && c3.detalhe.some(d => /503 do n8n/.test(d)));
  t("a expansão recebe os vizinhos do alvo como dica",
    r.vizinhosDe(fluxo(), new Set(["monta"])).sort().join(",") === "avisar,cron");
  t("...e o próprio alvo não entra na lista de vizinhos",
    !r.vizinhosDe(fluxo(), new Set(["monta"])).includes("monta"));
}

console.log("\n5. o VERMELHO — o caminho trafegado não sobrevive");
{
  const semAvisar = fluxo();
  semAvisar.nodes = semAvisar.nodes.filter(n => n.name !== "avisar");
  t("nó com tráfego que sumiu é vermelho", (await cor({ depois: semAvisar })) === "risk");

  const outroTipo = fluxo();
  outroTipo.nodes.find(n => n.name === "avisar").type = "n8n-nodes-base.telegram";
  t("troca de `type` num nó com tráfego é vermelho", (await cor({ depois: outroTipo })) === "risk");

  const outraVersao = fluxo();
  outraVersao.nodes.find(n => n.name === "avisar").typeVersion = 2.3;
  t("troca de `typeVersion` num nó com tráfego é vermelho", (await cor({ depois: outraVersao })) === "risk");

  const semAresta = fluxo();
  delete semAresta.connections.monta;
  t("ligação que carregou item e sumiu é vermelho", (await cor({ depois: semAresta })) === "risk");

  const l = await r.regressaoCaminho({
    antes: fluxo(), depois: semAresta, patch: patchDe({ rewire: { monta: {} } }), amostra: [cheia()]
  });
  t("...e o detalhe nomeia as duas pontas da ligação",
    l.detalhe.some(d => /monta/.test(d) && /avisar/.test(d)));
}

console.log("\n6. o LARANJA — passou, com ressalva MEDIDA");
{
  const desligado = fluxo();
  desligado.nodes.find(n => n.name === "avisar").disabled = true;
  const l = await r.regressaoCaminho({
    antes: fluxo(), depois: desligado, patch: patchDe({ updateNodes: [{ name: "avisar" }] }), amostra: [cheia(), cheia()]
  });
  /* Desligar é o mecanismo que substitui o delete (§4.2), então não é defeito —
     mas desligar um nó com tráfego é a definição de "passou, mas você precisa
     saber disso", e a contagem é o que torna a ressalva acionável. */
  t("desligar nó com tráfego é laranja, não vermelho", l.cor === "warn");
  t("...e a ressalva carrega a contagem medida",
    l.detalhe.some(d => /DESLIGADO/.test(d) && /2 execução/.test(d)));

  const l2 = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(), patch: patchDe({ updateNodes: [{ name: "avisar" }] }), amostra: [cheia()]
  });
  t("cobertura de uma execução só passa com ressalva", l2.cor === "warn");
  t("...e a ressalva diz que a cobertura é magra",
    l2.detalhe.some(d => /cobertura magra/.test(d)));

  /* Um ramo removido que não trafegou não é vermelho — pode ser ramo morto, e
     reprovar limpeza legítima ensina a ignorar a bateria. Mas a amostra é
     pequena por construção, e "não trafegou no que eu li" não é "não trafega". */
  const comRamoMorto = fluxo();
  comRamoMorto.connections.monta.main[0].push({ node: "cron", type: "main", index: 0 });
  const l3 = await r.regressaoCaminho({
    antes: comRamoMorto, depois: fluxo(),
    patch: patchDe({ rewire: { monta: {} } }), amostra: [cheia(), cheia()]
  });
  t("ramo removido sem tráfego na amostra é laranja", l3.cor === "warn");
  t("...e a ressalva diz quantas execuções foram lidas",
    l3.detalhe.some(d => /ramo morto/.test(d) && /2 execução/.test(d)));
}

console.log("\n7. o VERDE, e o que ele NÃO promete");
{
  const l = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(), patch: patchDe({ updateNodes: [{ name: "avisar" }] }), amostra: [cheia(), cheia()]
  });
  t("caminho intacto e coberto é verde", l.cor === "ok");
  t("...e a frase diz que prova encanamento, não conteúdo",
    /encanamento continua ligado/.test(l.frase) && /não que a água/.test(l.frase));
  /* Sem isto, "5a verde" é lido como "o fluxo continua fazendo a mesma coisa" —
     que é exatamente o que ela não afirma. */
  t("o detalhe SEMPRE traz as três coisas que a 5a não pega",
    r.NAO_PEGA.every(x => (l.detalhe || []).includes(x)));
  const cinza = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(), patch: patchDe({}), amostra: []
  });
  t("...inclusive no cinza, que é onde ler demais na cor é mais tentador",
    r.NAO_PEGA.every(x => (cinza.detalhe || []).includes(x)));

  const comNovo = fluxo();
  comNovo.nodes.push({ name: "novo_log", type: "n8n-nodes-base.supabase", typeVersion: 1, position: [600, 0], parameters: {} });
  const l2 = await r.regressaoCaminho({
    antes: fluxo(), depois: comNovo,
    patch: patchDe({ addNodes: [{ name: "novo_log" }] }), amostra: [cheia(), cheia()]
  });
  t("patch que só acrescenta nó novo não fica cinza por falta de cobertura", l2.cor === "ok");

  const semPatch = await r.regressaoCaminho({
    antes: fluxo(), depois: fluxo(), patch: patchDe({}), amostra: [cheia(), cheia()]
  });
  t("patch vazio com caminho intacto é verde", semPatch.cor === "ok");
}

console.log("\n8. 5b — o agente é interceptado ANTES do fantasma (§5.6)");
{
  const agente = fluxo();
  agente.nodes.push({ name: "ag", type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 1, position: [600, 0], parameters: {} });
  const l = r.regressaoConteudo({ antes: agente, depois: agente });
  t("fluxo de agente é cinza", l.cor === "cold");
  /* A frase certa importa: "expressão fora do subconjunto" mandaria o Kauan
     caçar um problema de expressão que não existe. */
  t("...e a frase é sobre o MODELO, não sobre expressão",
    /modelo de linguagem/.test(l.frase) && !/expressão/.test(l.frase));
  t("...e o detalhe diz o que dá para conferir num agente",
    l.detalhe.some(d => /FORMA do envio/.test(d)));
}

console.log("\n9. 5b — as outras quatro cores");
{
  const wf = txt => ({
    name: "t",
    nodes: [
      { name: "cron", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: {} },
      { name: "avisar", type: "n8n-nodes-base.slack", typeVersion: 2.2, position: [200, 0], parameters: { channelId: "#v", text: txt } }
    ],
    connections: { cron: { main: [[{ node: "avisar", type: "main", index: 0 }]] } }
  });
  const seeds = { cron: { nome: "Ana" } };

  const igual = r.regressaoConteudo({ antes: wf("=oi {{ $json.nome }}"), depois: wf("=oi {{ $json.nome }}"), seeds });
  t("envio idêntico antes e depois é verde", igual.cor === "ok");
  t("...e a frase diz quantos destinos foram derivados", /1 destino/.test(igual.frase));

  const mudou = r.regressaoConteudo({ antes: wf("=oi {{ $json.nome }}"), depois: wf("=olá {{ $json.nome }}"), seeds });
  /* Mudar o que sai pode ser exatamente o que ele pediu — então é laranja com o
     antes e o depois na tela, nunca vermelho. */
  t("conteúdo que mudou e ainda resolve é laranja", mudou.cor === "warn");
  t("...e o detalhe mostra o antes e o depois",
    mudou.detalhe.some(d => /oi Ana/.test(d) && /olá Ana/.test(d)));

  const quebrou = r.regressaoConteudo({
    antes: wf("=oi {{ $json.nome }}"), depois: wf("=oi {{ $json.nao.existe }}"), seeds });
  t("expressão que deixou de resolver é VERMELHO", quebrou.cor === "risk");
  t("...e o detalhe nomeia o nó", quebrou.detalhe.some(d => /avisar/.test(d)));

  const semDestino = wf("=oi");
  semDestino.nodes = semDestino.nodes.filter(n => n.name !== "avisar");
  semDestino.connections = {};
  const sumiu = r.regressaoConteudo({ antes: wf("=oi {{ $json.nome }}"), depois: semDestino, seeds });
  t("destino que sumiu é laranja, não vermelho", sumiu.cor === "warn");
  t("...e o detalhe diz qual deixou de mandar", sumiu.detalhe.some(d => /deixou de mandar/.test(d)));

  const comCode = wf("=oi");
  comCode.nodes.push({ name: "js", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 0], parameters: {} });
  comCode.connections.avisar = { main: [[{ node: "js", type: "main", index: 0 }]] };
  const recusou = r.regressaoConteudo({ antes: comCode, depois: comCode, seeds });
  t("fluxo que o fantasma recusa é cinza", recusou.cor === "cold");
  t("...e o detalhe carrega a recusa do fantasma, não uma frase nossa",
    recusou.detalhe.some(d => /code|simular/.test(d)));
}

console.log("\n" + (falhas ? "FALHOU " + falhas + " de " + total : "tudo verde: " + total + " casos"));
process.exit(falhas ? 1 : 0);

})();
