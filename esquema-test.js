/* esquema-test.js — cada teste recusa um defeito com nome.
 *
 * Roda contra o `.cache-esquema.json` de verdade: reimplementar o esquema fora
 * daqui provaria a cópia, não o esquema. Sem cache, o arquivo diz o que rodar em
 * vez de passar em silêncio — um teste que "passa" porque não achou o que testar
 * é pior que teste nenhum.
 *
 * Grátis: nenhum modelo, nenhuma chamada de rede, nenhuma escrita no n8n.
 *   node esquema-test.js
 */

"use strict";

const esq = require("./esquema.js");

let ok = 0, falhou = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(e && e.message)); }
};
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "") + " esperava " + JSON.stringify(b) + ", veio " + JSON.stringify(a)); };
const verdade = (v, m) => { if (!v) throw new Error(m || "esperava verdadeiro"); };

const e = esq.lerCache();
if (!e) {
  console.log("sem `.cache-esquema.json`. Rode antes:\n  node esquema.js --baixar\n  node esquema.js --construir");
  process.exitCode = 1;
  return;
}

const no = (type, typeVersion, parameters, name = "no_de_teste") => ({ name, type, typeVersion, parameters });
const achados = n => esq.conferir(e, n);
const chaves = n => achados(n).map(a => a.tipo + ":" + a.chave).sort();

console.log("\n[ o esquema existe e cobre o que precisa ]");

t("o cache tem os três pacotes e uma contagem de tipos que faz sentido", () => {
  verdade(e.tipos > 400, "tipos: " + e.tipos);
  verdade(e.pacotes.some(p => p.npm === "n8n-nodes-base"), "falta n8n-nodes-base");
  verdade(e.pacotes.some(p => p.npm === "@n8n/n8n-nodes-langchain"), "falta o pacote de langchain");
});

t("um nó que não carregou é REPORTADO, nunca somado ao silêncio", () => {
  verdade(Array.isArray(e.naoColheram), "`naoColheram` não é lista");
  for (const x of e.naoColheram) verdade(x.arquivo && x.porque, "entrada sem arquivo ou sem motivo: " + JSON.stringify(x));
});

t("redis v1 traz o enum de `operation` — o discriminador que o catálogo chama de \"string\"", () => {
  const r = esq.versaoDe(e, "n8n-nodes-base.redis", 1);
  verdade(r && r.exata, "sem versão exata para redis 1");
  const op = r.dados.props.find(p => p.nome === "operation" && p.enum);
  verdade(op, "redis v1 sem enum em `operation`");
  for (const v of ["get", "set", "incr", "publish"]) verdade(op.enum.includes(v), "falta `" + v + "` no enum");
});

t("redis diz que `propertyName` é obrigatório e só existe em `operation: get`", () => {
  /* Este é o defeito que custou debug de produção neste projeto: `redis get`
   * devolve o valor em `propertyName`, nunca em `value`. O esquema carrega o
   * fato — o catálogo é incapaz. */
  const r = esq.versaoDe(e, "n8n-nodes-base.redis", 1);
  const p = r.dados.props.find(x => x.nome === "propertyName");
  verdade(p, "redis sem `propertyName`");
  igual(p.quando, { operation: ["get"] }, "condição de propertyName:");
  verdade(p.obrigatorio, "`propertyName` deveria ser obrigatório");
});

t("`if` vem SEPARADO por versão, não como união", () => {
  /* A união entre versões do catalog.js descreve forma que nenhuma versão
   * aceita. Aqui 2 e 2.3 são documentos diferentes. */
  const n = e.nodes["n8n-nodes-base.if"];
  verdade(n, "sem o nó `if`");
  for (const v of ["1", "2", "2.2", "2.3"]) verdade(n.versoes[v], "falta a versão " + v + " de `if`");
  const v1 = n.versoes["1"].props.map(p => p.nome).sort();
  const v23 = n.versoes["2.3"].props.map(p => p.nome).sort();
  verdade(JSON.stringify(v1) !== JSON.stringify(v23), "v1 e v2.3 saíram com a mesma lista — a separação não está valendo");
});

t("as variantes `…Tool` existem, e só para quem o n8n marca `usableAsTool`", () => {
  verdade(e.nodes["n8n-nodes-base.googleSheetsTool"], "sem googleSheetsTool");
  igual(e.nodes["n8n-nodes-base.googleSheetsTool"].variantePorFerramentaDe, "n8n-nodes-base.googleSheets");
  /* Se todo tipo ganhasse alias, o portão de existência passaria a aceitar
   * ferramenta que não existe. */
  verdade(!e.nodes["n8n-nodes-base.ifTool"], "`ifTool` não deveria existir");
});

t("o esquema de SAÍDA (o que o nó devolve) foi colhido em pelo menos 150 versões", () => {
  let n = 0;
  for (const nd of Object.values(e.nodes)) for (const v of Object.values(nd.versoes)) if (v.devolve) n++;
  verdade(n >= 150, "só " + n + " versões com `devolve`");
});

t("a pasta `v2.3.0` casa com a typeVersion 2.3, e `v4.0.0` com a 4", () => {
  /* Chave "2.3.0" não bate com nó nenhum, e o erro seria silencioso — a mesma
   * classe da chave de cache concatenada à mão que este repositório já pagou
   * duas vezes. */
  const s = esq.versaoDe(e, "n8n-nodes-base.slack", "2.3");
  verdade(s && s.exata, "sem slack 2.3");
  verdade(s.dados.devolve && Object.keys(s.dados.devolve).length, "slack 2.3 sem esquema de saída (a pasta é v2.3.0)");
});

console.log("\n[ o portão pega o que existe para pegar ]");

t("chave inventada é acusada como desconhecida", () => {
  const a = chaves(no("n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v", inventada: 1 }));
  verdade(a.includes("desconhecida:inventada"), "não acusou: " + a.join(", "));
});

t("chave real sob outra operação é acusada como inaplicável", () => {
  /* `keyPattern` existe no redis, mas só em `operation: keys`. Escrita num
   * `get`, ela importa sem erro e não faz nada — que é exatamente o defeito
   * silencioso que este portão existe para acabar. */
  const a = chaves(no("n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v", keyPattern: "x*" }));
  verdade(a.includes("inaplicavel:keyPattern"), "não acusou: " + a.join(", "));
});

t("valor fora do enum é acusado, e a mensagem traz o conjunto aceito", () => {
  const a = achados(no("n8n-nodes-base.redis", 1, { operation: "buscar", key: "k" }));
  const x = a.find(y => y.tipo === "enum" && y.chave === "operation");
  verdade(x, "não acusou o enum: " + JSON.stringify(a));
  verdade(Array.isArray(x.aceitos) && x.aceitos.includes("get"), "sem a lista de aceitos");
});

t("chave desconhecida DENTRO de uma coleção também é acusada", () => {
  const a = chaves(no("n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v", options: { naoExiste: true } }));
  verdade(a.includes("desconhecida:options.naoExiste"), "não desceu na coleção: " + a.join(", "));
});

console.log("\n[ e não pega o que não deve — cada um destes reprovaria fluxo bom ]");

t("nó correto não gera achado nenhum", () => {
  igual(chaves(no("n8n-nodes-base.redis", 1, { operation: "get", key: "chave", propertyName: "valor" })), []);
});

t("parâmetro omitido por estar no default não vira \"inaplicável\"", () => {
  /* Nenhum fluxo real escreve `resource: "sheet"` no googleSheets: é o padrão.
   * Sem resolver o default, todo predicado que depende de `resource` fica cego
   * e o portão acusou 14,4% dos nós de 99 fluxos publicados. */
  const a = chaves(no("n8n-nodes-base.googleSheets", 4.7, {
    operation: "append",
    documentId: { __rl: true, mode: "list", value: "abc" },
    sheetName: { __rl: true, mode: "list", value: "gid=0" },
    columns: { mappingMode: "defineBelow", value: {} },
    options: {}
  }));
  igual(a, [], "achados num nó correto:");
});

t("o mesmo nome declarado várias vezes vale se QUALQUER declaração vale", () => {
  /* `documentId` é declarado duas vezes no googleSheets v4.7: uma sob
   * `resource:sheet`, outra sob `resource:spreadsheet + deleteSpreadsheet`. Um
   * mapa por nome guarda a última e avalia a errada. */
  const r = esq.versaoDe(e, "n8n-nodes-base.googleSheets", "4.7");
  const quantas = r.dados.props.filter(p => p.nome === "documentId").length;
  verdade(quantas > 1, "o caso não existe mais neste pacote (documentId aparece " + quantas + "x) — reveja este teste");
  igual(chaves(no("n8n-nodes-base.googleSheets", 4.7, { operation: "append", documentId: { __rl: true, mode: "list", value: "x" } })), []);
});

t("chave inaplicável com valor VAZIO não é acusada", () => {
  /* Medido num fluxo que o próprio Tester construiu e que funciona: o
   * `gmailTrigger` fica com `simple: true` e `options: {}`, e o esquema esconde
   * `options` quando `simple` é verdadeiro. Um objeto vazio não instrui nada, e
   * gastar uma rodada de modelo para apagar um `{}` ensina a ignorar o portão. */
  igual(chaves(no("n8n-nodes-base.gmailTrigger", 1.2, {
    pollTimes: { item: [{ mode: "everyMinute" }] }, simple: true, filters: {}, options: {}
  })), []);
  /* Mas com conteúdo dentro, acusa: aí há instrução sendo ignorada em silêncio. */
  const a = chaves(no("n8n-nodes-base.gmailTrigger", 1.2, { simple: true, options: { downloadAttachments: true } }));
  verdade(a.includes("inaplicavel:options"), "deixou passar `options` com conteúdo: " + a.join(", "));
});

t("tipo que o esquema não conhece não gera achado — fail-open", () => {
  igual(chaves(no("n8n-nodes-community.inexistente", 1, { qualquerCoisa: 1 })), []);
});

t("versão aproximada não gera achado — fail-open", () => {
  /* Com `typeVersion` que o pacote não tem, a resolução é aproximada e o portão
   * cala. Reprovar sobre versão aproximada reprova fluxo bom. */
  igual(chaves(no("n8n-nodes-base.redis", 99, { operation: "get", coisaNova: 1 })), []);
});

t("expressão no lugar de um enum não é acusada", () => {
  /* `={{ … }}` resolve em execução, e o cockpit não executa. É o único valor
   * que não pode ser conferido contra conjunto nenhum. */
  igual(chaves(no("n8n-nodes-base.redis", 1, { operation: "={{ $json.op }}", key: "k" })), []);
});

t("propriedade injetada pelo n8n não é acusada: pollTimes, requestOptions, toolDescription", () => {
  const a = chaves(no("n8n-nodes-base.googleSheetsTrigger", 1, { pollTimes: { item: [{ mode: "everyMinute" }] }, documentId: { __rl: true, mode: "list", value: "x" } }));
  verdade(!a.some(x => x.includes("pollTimes")), "acusou pollTimes: " + a.join(", "));
  const b = chaves(no("n8n-nodes-base.googleSheetsTool", 4.7, { descriptionType: "manual", toolDescription: "lê a planilha", operation: "read" }));
  verdade(!b.some(x => x.includes("toolDescription")), "acusou toolDescription: " + b.join(", "));
});

t("sticky note e nó sem parâmetros não geram achado", () => {
  igual(chaves(no("n8n-nodes-base.stickyNote", 1, {})), []);
  igual(chaves({ name: "x", type: "n8n-nodes-base.redis", typeVersion: 1 }), []);
});

t("um payload hostil não derruba a conferência", () => {
  /* O que chega aqui é JSON escrito por um modelo. Explodir em vez de acusar
   * transformaria um portão numa queda do Tester. */
  for (const p of [null, undefined, 0, "texto", []]) {
    igual(chaves(no("n8n-nodes-base.redis", 1, p)), [], "com parameters=" + JSON.stringify(p));
  }
  /* Aninhamento fundo não é payload inválido, é chave desconhecida — e acusar
   * `a` é a resposta certa. O que se prova aqui é que não estoura. */
  igual(chaves(no("n8n-nodes-base.redis", 1, { a: { b: { c: { d: {} } } } })), ["desconhecida:a"]);
  igual(esq.conferir(e, null), []);
  igual(esq.conferir(null, no("n8n-nodes-base.redis", 1, { x: 1 })), []);
});

console.log("\n[ a fatia que vai para o prompt ]");

t("`fatiaPorVersao` manda SÓ a versão pedida", () => {
  const f = esq.fatiaPorVersao(e, [{ tipo: "n8n-nodes-base.if", versao: "2.3" }]);
  const j = JSON.parse(f.texto);
  igual(j.nodes["n8n-nodes-base.if"].versaoDoEsquema, "2.3");
  verdade(!j.nodes["n8n-nodes-base.if"].versoes, "mandou o mapa de versões inteiro");
});

t("o que não caberia no teto é DITO, não perdido em silêncio", () => {
  const f = esq.fatiaPorVersao(e, [
    { tipo: "n8n-nodes-base.httpRequest", versao: "4.3" },
    { tipo: "n8n-nodes-base.slack", versao: "2.4" }
  ], 800);
  verdade(f.omitidos.length > 0, "nada foi omitido com teto de 800 chars");
  verdade(f.texto.length <= 3000, "o texto passou muito do teto: " + f.texto.length);
  JSON.parse(f.texto);   // cortar no meio da chave entrega JSON inválido ao modelo
});

t("tipo pedido que não está no esquema entra em `omitidos` com o motivo", () => {
  const f = esq.fatiaPorVersao(e, [{ tipo: "n8n-nodes-base.naoExiste", versao: "1" }]);
  verdade(f.omitidos.some(x => x.includes("naoExiste")), "não reportou: " + JSON.stringify(f.omitidos));
});

t("`propsAplicaveis` corta o que não vale para a operação escolhida", () => {
  const g = esq.propsAplicaveis(e, "n8n-nodes-base.redis", 1, { operation: "get" });
  const nomes = g.props.map(p => p.nome);
  verdade(nomes.includes("propertyName"), "faltou propertyName num `get`");
  verdade(!nomes.includes("keyPattern"), "trouxe keyPattern, que é de `keys`");
  verdade(g.props.length < esq.versaoDe(e, "n8n-nodes-base.redis", 1).dados.props.length, "não cortou nada");
});

console.log("\n[ o portão está LIGADO no Tester, e o contexto chega ao disco ]");

/* Estes dois importam o `tester.js`. Sem eles, tudo acima poderia passar com a
 * feature desligada: um portão que funciona isolado e não está ligado é
 * exatamente o defeito que ninguém vê. */
const tester = require("./tester.js");
const gramatica = require("./gramatica.js");

const catMin = { instancia: "teste", geradoEm: new Date().toISOString(), nodes: {
  "n8n-nodes-base.scheduleTrigger": { usos: 1, versions: { "1.2": 1 }, versaoMaisUsada: 1.2, portas: ["main"], maxSaidas: 1, credenciais: [], nomesDeExemplo: [], parametros: {} },
  "n8n-nodes-base.redis": { usos: 1, versions: { "1": 1 }, versaoMaisUsada: 1, portas: ["main"], maxSaidas: 1, credenciais: ["redis"], nomesDeExemplo: [], parametros: {} }
} };
const fluxo = extra => ({
  name: "teste",
  settings: { executionOrder: "v1" },
  nodes: [
    { name: "todo_dia", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: {} },
    { name: "le_o_cache", type: "n8n-nodes-base.redis", typeVersion: 1, position: [200, 0], parameters: { operation: "get", key: "k", propertyName: "v", ...extra } }
  ],
  connections: { todo_dia: { main: [[{ node: "le_o_cache", type: "main", index: 0 }]] } }
});

t("`validar` do tester reprova parâmetro inventado — o portão está ligado", () => {
  const limpo = tester.validar(fluxo(), catMin, false, e);
  igual(limpo, [], "o fluxo correto foi reprovado:");
  const sujo = tester.validar(fluxo({ inventado: 1 }), catMin, false, e);
  verdade(sujo.some(f => /inventado/.test(f)), "não reprovou o parâmetro inventado: " + JSON.stringify(sujo));
});

t("sem esquema, `validar` não reprova por parâmetro — fail-open ponta a ponta", () => {
  /* Checkout novo não tem `.n8n-pkgs/`. O build tem que continuar, sem o portão. */
  igual(tester.validar(fluxo({ inventado: 1 }), catMin, false, null), []);
});

t("`promptDesenhar` manda ler os dois arquivos novos", () => {
  const p = tester.promptDesenhar({
    entendi: { objetivo: "x" }, respostas: [], ehAgente: false,
    contexto: [{ arquivo: "catalogo.json", o_que: "…" }, { arquivo: "esquema.json", o_que: "…" }, { arquivo: "GRAMATICA.md", o_que: "…" }],
    anexos: []
  }, null);
  verdade(/esquema\.json/.test(p), "o prompt não cita `esquema.json`");
  verdade(/GRAMATICA\.md/.test(p), "o prompt não cita `GRAMATICA.md`");
  verdade(p.length < tester.PROMPT_MAX, "o prompt passou do teto interno: " + p.length);
});

t("a gramática tem os cinco blocos, e nenhum bloco que ninguém lê", () => {
  const st = gramatica.docStatus();
  verdade(st.encontrado, "não achei n8n-gramatica.md");
  igual(st.faltando, [], "blocos faltando:");
  igual(st.desconhecidos, [], "blocos que ninguém injeta:");
});

/* O último teste escreve no disco e é assíncrono. Ele fica sozinho aqui embaixo,
 * depois da conta síncrona, e o resumo só sai quando ele termina — um teste
 * assíncrono cuja falha aparece DEPOIS do "tudo ok" é um teste que mente. */
async function assincronos() {
  const ta = async (nome, fn) => {
    try { await fn(); ok++; console.log("  ok   " + nome); }
    catch (er) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(er && er.message)); }
  };

  await ta("`escreverContexto` escreve catálogo, esquema e gramática no diretório da corrida", async () => {
    const fsx = require("fs"), os = require("os"), pth = require("path");
    const dir = fsx.mkdtempSync(pth.join(os.tmpdir(), "esq-test-"));
    try {
      const s = {
        dir, catalogo: catMin, esquema: e, ehAgente: false,
        ingredientes: { nos: [{ tipo: "n8n-nodes-base.redis", versao: 1 }], credenciais: [] },
        doc: null, log: [], gen: 1, status: "correndo"
      };
      await tester.escreverContexto(s, true);   // silencioso: não depende do emissor
      for (const arq of ["catalogo.json", "esquema.json", "GRAMATICA.md"]) {
        verdade(fsx.existsSync(pth.join(dir, arq)), "não escreveu " + arq);
      }
      const esq2 = JSON.parse(fsx.readFileSync(pth.join(dir, "esquema.json"), "utf8"));
      verdade(esq2.nodes["n8n-nodes-base.redis"], "o esquema escrito não tem o nó pedido");
      igual(esq2.nodes["n8n-nodes-base.redis"].versaoDoEsquema, "1", "versão escrita:");
      const gram = fsx.readFileSync(pth.join(dir, "GRAMATICA.md"), "utf8");
      verdade(/COMEÇAR com `=`/.test(gram), "a gramática escrita não traz a regra do `=`");
      verdade(s.contexto.some(c => c.arquivo === "esquema.json"), "`s.contexto` não cita o esquema — o prompt não vai pedir para ler");
      verdade(s.contexto.some(c => c.arquivo === "GRAMATICA.md"), "`s.contexto` não cita a gramática");
    } finally {
      fsx.rmSync(dir, { recursive: true, force: true });
    }
  });
}

assincronos().then(() => {
  console.log("\n" + (falhou ? "FALHOU" : "tudo ok") + " — " + ok + " passaram, " + falhou + " falharam\n");
  process.exitCode = falhou ? 1 : 0;
});
