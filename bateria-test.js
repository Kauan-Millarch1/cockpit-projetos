"use strict";
/* bateria-test.js — a bateria de sete do §5, e cada caso recusa um defeito com nome.
 *
 * De graça: nenhum modelo, nenhum spawn, nenhuma chamada ao n8n. As checagens
 * desta fatia (1, 2, 3, 4 e 6) são todas sobre documento e catálogo em memória,
 * e o que dependeria de rede entra por `contexto` — é por isso que este arquivo
 * consegue existir sem harness.
 *
 * O GRUPO 7 É O MAIS IMPORTANTE. É a lista do que a bateria NÃO pode reprovar,
 * porque cada reprovação indevida aqui é um upgrade legítimo que não acontece — e
 * um portão que reprova o que está certo ensina a ignorar o portão. É a mesma
 * calibração que `esquema-test.js` (grupo 3) e `preencher-test.js` já fizeram.
 *
 *   node bateria-test.js
 */
const b = require("./bateria.js");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const bad = m => { total++; falhas++; console.log("  FALHA " + m); };
const t = (nome, cond) => cond ? ok(nome) : bad(nome);

/* ───────────────────────────────────────────────────────────── fixtures ──── */

const NO = (nome, extra) => Object.assign({
  name: nome, type: "n8n-nodes-base.set", typeVersion: 3, position: [0, 0], parameters: {}
}, extra || {});

const WF = nodes => ({
  id: "W1", name: "Fluxo", nodes, connections: {}, settings: { executionOrder: "v1" }
});

/* Um esquema falso nos três estados que `resumo()` responde. É assim que o teste
   alcança o checkout sem `.n8n-pkgs/` sem ter de apagar nada do disco. */
const esquemaFalso = (estado, achados) => ({
  resumo: () => estado === "pronto"
    ? { pronto: true, tipos: 810, pacotes: 2, geradoEm: "hoje", naoColheram: 0 }
    : estado === "naoBaixado"
      ? { pronto: false, porque: "os pacotes de nó não foram baixados — rode `node esquema.js --baixar`" }
      : { pronto: false, porque: "os pacotes estão baixados, mas o esquema não foi destilado" },
  lerCache: () => estado === "pronto" ? { tipos: 810 } : null,
  conferir: () => achados || []
});

const CAT = {
  nodes: {
    "n8n-nodes-base.set": { credenciais: [] },
    "n8n-nodes-base.slack": { credenciais: ["slackApi"] },
    "n8n-nodes-base.noOp": { credenciais: [] }
  },
  credenciaisPorTipo: { slackApi: 22 },
  credenciaisConhecidas: [{ tipo: "slackApi", id: "c1", nome: "Slack Ecommerce Puro", usos: 22 }]
};

/* `ligacaoCredenciais` injetada, para não arrastar o `tester.js` inteiro para
   dentro de um teste que é sobre a bateria. */
const ligarFalso = (ligados, vazios) => () => ({ ligados: ligados || [], vazios: vazios || [] });

console.log("\n1. checagem 1 — Estrutura (NUNCA pode ficar cinza)");
{
  const doc = WF([NO("a"), NO("b")]);
  const prop = WF([NO("a", { parameters: { x: 1 } }), NO("b")]);
  const l = b.checaEstrutura(doc, prop);
  t("patch estruturalmente são passa verde", l.cor === b.COR.ok);
  t("...e a linha é a de número 1", l.n === "1");

  /* Nó apagado é o defeito que `validate()` existe para pegar, e é a garantia de
     produção mais antiga deste repositório. */
  const semB = WF([NO("a")]);
  t("nó apagado reprova em VERMELHO", b.checaEstrutura(doc, semB).cor === b.COR.reprova);
  t("...e a reprovação lista o portão que caiu", (b.checaEstrutura(doc, semB).detalhe || []).length > 0);

  /* Proposta ausente significa que o `applyPatch` não produziu documento. Isso é
     reprovar — abster-se aqui deixaria passar um patch que não existe. */
  t("proposta ausente é VERMELHO, nunca cinza", b.checaEstrutura(doc, null).cor === b.COR.reprova);
  t("a checagem 1 não tem ramo cinza em nenhum caminho",
    [b.checaEstrutura(doc, prop), b.checaEstrutura(doc, semB), b.checaEstrutura(doc, null)]
      .every(x => x.cor !== b.COR.cinza));
}

console.log("\n2. checagem 2 — Esquema do nó (cinza é estado legítimo)");
{
  const prop = WF([NO("a")]);
  const toc = new Set(["a"]);

  const pronto = b.checaEsquema(prop, toc, { esquema: esquemaFalso("pronto") });
  t("esquema pronto e sem achado passa verde", pronto.cor === b.COR.ok);

  /* O caso do clone fresco: `.n8n-pkgs/` é gitignored. Cair no ramo de reprovação
     aqui transformaria um checkout limpo num upgrade impossível. */
  const semPkg = b.checaEsquema(prop, toc, { esquema: esquemaFalso("naoBaixado") });
  t("pacotes não baixados fica CINZA, não vermelho", semPkg.cor === b.COR.cinza);
  t("...e a linha cinza carrega o MOTIVO escrito", /baixad/i.test(semPkg.frase));

  const semDestilar = b.checaEsquema(prop, toc, { esquema: esquemaFalso("naoDestilado") });
  t("pacotes baixados mas não destilados também é cinza", semDestilar.cor === b.COR.cinza);
  /* "Não baixei" e "não destilei" pedem comandos diferentes. Uma frase só para os
     dois mandaria a pessoa rodar o comando errado. */
  t("...e os dois estados cinza têm frases DIFERENTES", semPkg.frase !== semDestilar.frase);

  const comAchado = b.checaEsquema(prop, toc, {
    esquema: esquemaFalso("pronto", [{ tipo: "desconhecida", chave: "parameters.zzz", no: "a" }])
  });
  t("chave que não existe na versão reprova em vermelho", comAchado.cor === b.COR.reprova);
  t("...e o detalhe nomeia o nó e a chave",
    (comAchado.detalhe || []).some(d => /`a`/.test(d) && /zzz/.test(d)));

  /* Falha soft: o esquema é ajuda, e a ausência dele nunca pode parar um upgrade
     que passaria sem ele. */
  const explode = { resumo: () => { throw new Error("cache corrompido"); } };
  t("esquema que estoura vira CINZA, não derruba a bateria",
    b.checaEsquema(prop, toc, { esquema: explode }).cor === b.COR.cinza);
}

console.log("\n3. checagem 3 — Gramática (o `=` na frente é a regra de maior valor)");
{
  const semIgual = WF([NO("a", { parameters: { text: "Chegou {{ $json.cliente }}" } })]);
  const l = b.checaGramatica(semIgual, new Set(["a"]), {});
  t("expressão SEM o `=` na frente reprova", l.cor === b.COR.reprova);
  t("...e o detalhe diz que vai como texto literal", /literal/.test((l.detalhe || []).join(" ")));

  const comIgual = WF([NO("a", { parameters: { text: "=Chegou {{ $json.cliente }}" } })]);
  t("com o `=` na frente passa verde", b.checaGramatica(comIgual, new Set(["a"]), {}).cor === b.COR.ok);

  /* O n8n exige o `=` no primeiro byte. Espaço na frente É o defeito. */
  const comEspaco = WF([NO("a", { parameters: { text: " ={{ $json.x }}" } })]);
  t("`=` com espaço na frente continua sendo defeito", b.checaGramatica(comEspaco, new Set(["a"]), {}).cor === b.COR.reprova);

  const opString = WF([NO("a", { parameters: { conditions: { conditions: [{ operator: "equals" }] } } })]);
  t("`operator` como string reprova", b.checaGramatica(opString, new Set(["a"]), {}).cor === b.COR.reprova);

  const opObj = WF([NO("a", { parameters: { conditions: { conditions: [{ operator: { type: "string", operation: "equals" } }] } } })]);
  t("`operator` como objeto passa", b.checaGramatica(opObj, new Set(["a"]), {}).cor === b.COR.ok);

  const rlQuebrado = WF([NO("a", { parameters: { doc: { __rl: true, mode: "list" } } })]);
  t("`__rl: true` sem `value` reprova", b.checaGramatica(rlQuebrado, new Set(["a"]), {}).cor === b.COR.reprova);

  const rlInteiro = WF([NO("a", { parameters: { doc: { __rl: true, mode: "list", value: "abc" } } })]);
  t("`__rl` completo passa", b.checaGramatica(rlInteiro, new Set(["a"]), {}).cor === b.COR.ok);

  const vazio = WF([NO("a")]);
  t("rewire com porta que não é lista reprova",
    b.checaGramatica(vazio, new Set(["a"]), { rewire: { a: { main: "nao-e-lista" } } }).cor === b.COR.reprova);
  t("rewire com destino sem `node` reprova",
    b.checaGramatica(vazio, new Set(["a"]), { rewire: { a: { main: [[{ type: "main" }]] } } }).cor === b.COR.reprova);
  t("rewire bem formado passa",
    b.checaGramatica(vazio, new Set(["a"]), { rewire: { a: { main: [[{ node: "b", type: "main", index: 0 }]] } } }).cor === b.COR.ok);
  /* Saída sem destino é legítima — um `if` cujo ramo falso não vai a lugar nenhum. */
  t("saída `null` num ramo NÃO é defeito",
    b.checaGramatica(vazio, new Set(["a"]), { rewire: { a: { main: [null, [{ node: "b" }]] } } }).cor === b.COR.ok);

  t("a checagem 3 não tem ramo cinza",
    [semIgual, comIgual, opObj].every(w => b.checaGramatica(w, new Set(["a"]), {}).cor !== b.COR.cinza));
}

console.log("\n4. checagem 4 — Credencial referenciável (§5.7.1: nó novo é VERMELHO)");
{
  const doc = WF([NO("a")]);

  /* O achado da rodada 2, e o mais grave desta checagem: `applyPatch` proíbe
     `credentials`, então o patch NÃO TEM COMO anexar uma. Um nó novo de Slack
     entra ligado num fluxo vivo e falha na PRIMEIRA execução. */
  const propNovo = WF([NO("a"), NO("slack_novo", { type: "n8n-nodes-base.slack" })]);
  const patchNovo = { addNodes: [{ name: "slack_novo", type: "n8n-nodes-base.slack", position: [1, 2] }] };
  const lNovo = b.checaCredencial(doc, propNovo, patchNovo, { catalogo: CAT }, { ligacaoCredenciais: ligarFalso() });
  t("nó NOVO que exige credencial é VERMELHO", lNovo.cor === b.COR.reprova);
  t("...e a frase diz que o patch não pode anexar credencial", /não pode anexar|NUNCA pode anexar/i.test(lNovo.frase));
  t("...e nomeia o nó e o tipo de credencial", (lNovo.detalhe || []).some(d => /slack_novo/.test(d) && /slackApi/.test(d)));

  /* A correção do §5.7 pelo §5.7.1: com candidato de sobra o veredito NÃO muda,
     porque a contagem de candidatos é irrelevante quando anexar é impossível. */
  const lNovoComCand = b.checaCredencial(doc, propNovo, patchNovo, { catalogo: CAT },
    { ligacaoCredenciais: ligarFalso([{ no: "slack_novo", tipo: "slackApi", id: "c1", nome: "Slack" }]) });
  t("nó novo continua VERMELHO mesmo havendo candidato", lNovoComCand.cor === b.COR.reprova);

  /* Nó novo que NÃO pede credencial não é problema nenhum. */
  const propNoOp = WF([NO("a"), NO("noop_novo", { type: "n8n-nodes-base.noOp" })]);
  const patchNoOp = { addNodes: [{ name: "noop_novo", type: "n8n-nodes-base.noOp", position: [1, 2] }] };
  t("nó novo que NÃO pede credencial não reprova",
    b.checaCredencial(doc, propNoOp, patchNoOp, { catalogo: CAT }, { ligacaoCredenciais: ligarFalso() }).cor !== b.COR.reprova);

  /* Verde só quando não há nada NOVO a decidir. */
  const docComCred = WF([NO("s", { type: "n8n-nodes-base.slack", credentials: { slackApi: { id: "c1", name: "Slack" } } })]);
  const propComCred = WF([NO("s", { type: "n8n-nodes-base.slack", parameters: { x: 1 }, credentials: { slackApi: { id: "c1", name: "Slack" } } })]);
  const patchUpd = { updateNodes: [{ name: "s", parameters: { x: 1 } }] };
  t("nó que JÁ vinha com credencial passa verde",
    b.checaCredencial(docComCred, propComCred, patchUpd, { catalogo: CAT },
      { ligacaoCredenciais: ligarFalso([{ no: "s", tipo: "slackApi", id: "c1", nome: "Slack" }]) }).cor === b.COR.ok);

  /* Existe candidato, mas o nó não vinha com credencial: ninguém confirmou, e
     confirmar não é papel de portão. */
  const docSemCred = WF([NO("s", { type: "n8n-nodes-base.slack" })]);
  const lSemAntes = b.checaCredencial(docSemCred, propComCred, patchUpd, { catalogo: CAT },
    { ligacaoCredenciais: ligarFalso([{ no: "s", tipo: "slackApi", id: "c1", nome: "Slack" }]) });
  t("candidato existe mas o nó não vinha com credencial fica CINZA", lSemAntes.cor === b.COR.cinza);

  const lAmbiguo = b.checaCredencial(docSemCred, propComCred, patchUpd, { catalogo: CAT },
    { ligacaoCredenciais: ligarFalso([], [{ no: "s", motivo: "mais de uma credencial serviria" }]) });
  t("catálogo que não desempata fica CINZA, não vermelho", lAmbiguo.cor === b.COR.cinza);
  /* A frase precisa dizer que o catálogo NÃO é o inventário da conta — é o que
     impede alguém de ler "existe candidato" como "a credencial está lá e vale". */
  t("...e a frase diz que o catálogo não é o inventário da conta", /405|inventário/.test(lAmbiguo.frase));

  t("sem catálogo a checagem 4 fica cinza, não some",
    b.checaCredencial(doc, doc, {}, {}, { ligacaoCredenciais: ligarFalso() }).cor === b.COR.cinza);
  t("ligação que estoura vira cinza",
    b.checaCredencial(docSemCred, propComCred, patchUpd, { catalogo: CAT },
      { ligacaoCredenciais: () => { throw new Error("catálogo velho"); } }).cor === b.COR.cinza);
}

console.log("\n5. checagem 6 — Impacto medido (é número, NUNCA veredito)");
{
  const patch = { updateNodes: [{ name: "quente" }, { name: "frio" }] };

  const semAmostra = b.checaImpacto(patch, {});
  t("sem amostra fica CINZA, não verde", semAmostra.cor === b.COR.cinza);
  /* "Nenhum nó rodou" e "não medi" são fatos opostos sobre o risco do clique. */
  t("...e a frase diz que não mediu", /não medi/i.test(semAmostra.frase));

  const parado = b.checaImpacto(patch, { execucoesPorNo: { outro: 5 } });
  t("nenhum nó tocado com tráfego passa verde", parado.cor === b.COR.ok);

  const quente = b.checaImpacto(patch, { execucoesPorNo: { quente: 645, frio: 2 } });
  t("nó tocado com tráfego vira LARANJA, não vermelho", quente.cor === b.COR.ressalva);
  t("...e o NÚMERO está na frase", /645/.test(quente.frase));
  t("...e o mais quente é nomeado", /quente/.test(quente.frase));
  t("...e o detalhe lista por nó", (quente.detalhe || []).length === 2);

  /* O teto desta linha é laranja. Tráfego altíssimo continua sendo decisão
     informada, não erro — e vermelho aqui bloquearia todo upgrade em fluxo vivo. */
  t("tráfego altíssimo NUNCA chega a vermelho",
    b.checaImpacto(patch, { execucoesPorNo: { quente: 999999 } }).cor !== b.COR.reprova);
}

console.log("\n6. a bateria — ordem, injeção e a regra do botão");
{
  const doc = WF([NO("a")]);
  const prop = WF([NO("a", { parameters: { x: 1 } })]);
  const patch = { updateNodes: [{ name: "a", parameters: { x: 1 } }] };
  const base = { catalogo: CAT, execucoesPorNo: {}, deps: { esquema: esquemaFalso("pronto"), ligacaoCredenciais: ligarFalso() } };

  const r = b.bateria({ documento: doc, patch, proposta: prop, contexto: base });
  t("a bateria devolve as cinco linhas desta fatia", r.linhas.length === 5);
  t("...em ordem crescente", r.linhas.map(l => l.n).join(",") === "1,2,3,4,6");
  t("sem vermelho, podeAplicar é true", r.podeAplicar === true && r.bloqueia === false);

  const comExtras = b.bateria({ documento: doc, patch, proposta: prop, contexto: Object.assign({}, base, {
    linhasExtras: [
      { n: "7", nome: "Aceite do n8n", cor: b.COR.cinza, frase: "teste na instância desligado", detalhe: null },
      { n: "5b", nome: "Regressão de conteúdo", cor: b.COR.cinza, frase: "o fantasma recusa este fluxo", detalhe: null },
      { n: "5a", nome: "Regressão de caminho", cor: b.COR.ok, frase: "o encanamento continua ligado", detalhe: null }
    ]
  }) });
  t("as linhas injetadas entram na bateria", comExtras.linhas.length === 8);
  /* `5a` tem de cair entre `5` e `6`. Ordenar as strings direto poria `10` antes
     de `2` e `5b` antes de `5a` só por sorte. */
  t("...e `5a`/`5b` caem entre 4 e 6", comExtras.linhas.map(l => l.n).join(",") === "1,2,3,4,5a,5b,6,7");
  t("cinza injetado NÃO bloqueia o botão", comExtras.podeAplicar === true);

  const comVermelho = b.bateria({ documento: doc, patch, proposta: prop, contexto: Object.assign({}, base, {
    linhasExtras: [{ n: "5a", nome: "Regressão de caminho", cor: b.COR.reprova, frase: "uma aresta trafegada sumiu", detalhe: null }]
  }) });
  t("um vermelho injetado bloqueia", comVermelho.bloqueia === true && comVermelho.podeAplicar === false);

  /* §5.1 literal: o botão aparece quando não há vermelho E NADA ESTÁ MAIS
     RODANDO. Sem isto o botão apareceria durante a conferência. */
  const rodando = b.bateria({ documento: doc, patch, proposta: prop, contexto: Object.assign({}, base, {
    linhasExtras: [{ n: "7", nome: "Aceite do n8n", cor: b.COR.rodando, frase: "escrevendo a cópia sandbox", detalhe: null }]
  }) });
  t("checagem AINDA RODANDO bloqueia o botão", rodando.podeAplicar === false);

  /* Laranja é "passou, você precisa saber disso" — informação, não impedimento. */
  const comLaranja = b.bateria({ documento: doc, patch, proposta: prop,
    contexto: Object.assign({}, base, { execucoesPorNo: { a: 645 } }) });
  t("laranja NÃO bloqueia", comLaranja.podeAplicar === true);
  t("...e a linha laranja está lá", comLaranja.linhas.some(l => l.cor === b.COR.ressalva));

  t("toda linha tem n, nome, cor e frase",
    r.linhas.every(l => l.n && l.nome && l.cor && typeof l.frase === "string" && l.frase.length > 10));
  /* Toda linha cinza carrega o motivo — sem ele é indistinguível de descuido. */
  const cinzas = b.bateria({ documento: doc, patch, proposta: prop, contexto: {
    deps: { esquema: esquemaFalso("naoBaixado"), ligacaoCredenciais: ligarFalso() } } }).linhas.filter(l => l.cor === b.COR.cinza);
  t("toda linha cinza tem motivo escrito", cinzas.length > 0 && cinzas.every(l => l.frase.length > 20));

  /* ORDEM NUMÉRICA, não lexical. Com todas as linhas de um dígito as duas dão o
     mesmo resultado por coincidência, e foi assim que um mutante que ordenava
     string crua sobreviveu à primeira bateria de mutação. O defeito só aparece
     com dois dígitos — "10" antes de "2" — porque `localeCompare` posiciona por
     byte, não por significado. */
  t("`ordemDe` separa número de sufixo",
    JSON.stringify(["1", "5a", "5b", "10"].map(b.ordemDe))
      === JSON.stringify([[1, ""], [5, "a"], [5, "b"], [10, ""]]));
  t("...e a bateria põe `10` DEPOIS de `2`, nunca antes",
    b.bateria({ documento: doc, patch, proposta: prop, contexto: Object.assign({}, base, {
      linhasExtras: [
        { n: "10", nome: "décima", cor: b.COR.ok, frase: "uma linha de dois dígitos", detalhe: null },
        { n: "5a", nome: "quinta a", cor: b.COR.ok, frase: "a regressão de caminho", detalhe: null }
      ] }) }).linhas.map(l => l.n).join(",") === "1,2,3,4,5a,6,10");

  t("linha extra sem `n` é ignorada em vez de bagunçar a ordem",
    b.bateria({ documento: doc, patch, proposta: prop, contexto: Object.assign({}, base, {
      linhasExtras: [{ nome: "sem numero", cor: b.COR.ok, frase: "x" }] }) }).linhas.length === 5);
}

console.log("\n7. FALSO POSITIVO — o que a bateria NÃO pode reprovar");
{
  const deps = { esquema: esquemaFalso("pronto"), ligacaoCredenciais: ligarFalso() };
  const ctx = { catalogo: CAT, execucoesPorNo: {}, deps };
  const passa = (nome, doc, prop, patch) => {
    const r = b.bateria({ documento: doc, patch, proposta: prop, contexto: ctx });
    const ruins = r.linhas.filter(l => l.cor === b.COR.reprova);
    t(nome, !ruins.length);
    if (ruins.length) console.log("          reprovou em: " + ruins.map(l => l.n + " " + l.frase).join(" | "));
  };

  /* `{{ }}` dentro de um `jsCode` é JavaScript, não expressão do n8n. Acusar isso
     reprovaria todo patch que encosta num nó de código — e o Iago tem 61. */
  passa("`{{ }}` dentro de `jsCode` NÃO é expressão do n8n",
    WF([NO("c", { type: "n8n-nodes-base.code" })]),
    WF([NO("c", { type: "n8n-nodes-base.code", parameters: { jsCode: "const s = `{{ nao e expressao }}`;" } })]),
    { updateNodes: [{ name: "c", parameters: { jsCode: "x" } }] });

  /* Sticky note é recado para humano. Ele nem aparece em `runData`. */
  passa("`{{ }}` num sticky note não é defeito",
    WF([NO("s", { type: "n8n-nodes-base.stickyNote" })]),
    WF([NO("s", { type: "n8n-nodes-base.stickyNote", parameters: { content: "lembrar do {{ campo }}" } })]),
    { updateNodes: [{ name: "s", parameters: { content: "x" } }] });

  /* Texto com chave simples não é expressão. `{ }` sozinho é JSON, CSS, o que for. */
  passa("chave simples `{ }` sem par duplo não é expressão",
    WF([NO("a")]), WF([NO("a", { parameters: { txt: "use { assim } sempre" } })]),
    { updateNodes: [{ name: "a", parameters: { txt: "x" } }] });

  /* Um objeto com `mode` e `value` que NÃO se declara `__rl` é objeto comum. */
  passa("objeto com `mode`/`value` sem `__rl` não é resourceLocator quebrado",
    WF([NO("a")]), WF([NO("a", { parameters: { cfg: { mode: "auto", value: 3 } } })]),
    { updateNodes: [{ name: "a", parameters: { cfg: {} } }] });

  /* Posição negativa é normal nesta instância — medido, `x` de −27632 a −4592. */
  passa("posição negativa é normal e não reprova",
    WF([NO("a")]), WF([NO("a"), NO("novo", { position: [-27632, -4592] })]),
    { addNodes: [{ name: "novo", type: "n8n-nodes-base.set", typeVersion: 3, position: [-27632, -4592] }] });

  /* Desligar um nó é O caminho para tirá-lo de serviço: não existe verbo de
     apagar (§4.2). Um portão que barrasse `disabled` fecharia essa saída. */
  passa("desligar um nó (`disabled: true`) não reprova",
    WF([NO("a"), NO("b")]), WF([NO("a"), NO("b", { disabled: true })]),
    { updateNodes: [{ name: "b", disabled: true }] });

  /* Dívida antiga do fluxo não é problema deste patch. A bateria olha só os nós
     TOCADOS — senão um fluxo de produção de 189 nós reprovaria para sempre. */
  passa("expressão sem `=` num nó que o patch NÃO toca é ignorada",
    WF([NO("a"), NO("velho", { parameters: { txt: "{{ divida antiga }}" } })]),
    WF([NO("a", { parameters: { x: 1 } }), NO("velho", { parameters: { txt: "{{ divida antiga }}" } })]),
    { updateNodes: [{ name: "a", parameters: { x: 1 } }] });

  /* HTML dentro de parâmetro é comum em e-mail e em `Set`. */
  passa("HTML num parâmetro não é defeito de gramática",
    WF([NO("a")]), WF([NO("a", { parameters: { html: "<br><div>oi</div>" } })]),
    { updateNodes: [{ name: "a", parameters: { html: "x" } }] });

  /* Patch que só mexe em conexão não toca nó nenhum — e não pode reprovar por
     "nenhum nó conferido".
     A proposta aqui sai do `applyPatch` DE VERDADE, não escrita à mão: um fixture
     escrito à mão me deu proposta idêntica ao documento e o portão "algo mudou"
     reprovou — a bateria estava certa e o teste, errado. Derivar do código que
     roda em produção é o que impede o caso de provar a minha imaginação. */
  {
    const docRw = WF([NO("a"), NO("b")]);
    const patchRw = { rewire: { a: { main: [[{ node: "b", type: "main", index: 0 }]] } } };
    const ap = require("./claude-fix.js").applyPatch(docRw, patchRw);
    t("o `applyPatch` do rewire não dá erro", !ap.errors.length);
    passa("patch que só faz `rewire` não reprova", docRw, ap.workflow, patchRw);
  }

  /* Sem esquema destilado, tudo o que a checagem 2 pode dizer é "não sei". */
  const semEsq = b.bateria({
    documento: WF([NO("a")]), proposta: WF([NO("a", { parameters: { x: 1 } })]),
    patch: { updateNodes: [{ name: "a", parameters: { x: 1 } }] },
    contexto: { catalogo: CAT, execucoesPorNo: {}, deps: { esquema: esquemaFalso("naoBaixado"), ligacaoCredenciais: ligarFalso() } }
  });
  t("checkout sem `.n8n-pkgs/` continua podendo aplicar", semEsq.podeAplicar === true);
}

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + total
  : "passou: " + total + " casos — cinza nunca é verde, laranja informa, e só vermelho barra o botão"));
process.exit(falhas ? 1 : 0);
