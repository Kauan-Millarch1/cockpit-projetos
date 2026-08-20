/* O que a execução DISSE quando o que trafegou não foi texto.
 *
 * Cada caso recusa um defeito com nome, e os que sustentam o resto são dois:
 *
 *   - a atribuição é pela CADEIA DE `src`, nunca por vizinhança. Um nó de TTS
 *     colado na ordem de execução mas fora da aresta não pode ser usado: seria o
 *     mesmo erro que `alimentador` já pagou num laço com `Wait`, e aqui o preço
 *     seria pior — mostrar na tela um texto que não foi o desta mensagem.
 *   - sem cadeia que prove, a linha diz que mandou áudio e NÃO inventa texto.
 *
 * O bloco de juízo é EXTRAÍDO do `flows.html` na hora de rodar, entre âncoras, do
 * mesmo jeito que os geradores de preview fazem. Reimplementá-lo aqui provaria a
 * cópia. Se as âncoras mudarem, este arquivo falha dizendo isso — o que é o
 * resultado certo, porque um teste que não achou o que testar passou por sorte.
 *
 * Fixture é SINTÉTICA de propósito: uma execução real carrega a conversa de um
 * lead, e este arquivo vai para o git.
 *
 * Grátis: sem modelo, sem rede, sem escrever no n8n. `node audio-test.js`.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { midiaEnviada } = require("./n8n.js");

/* ------------------------------------------------- o bloco de juízo, extraído */
const HTML = fs.readFileSync(path.join(__dirname, "flows.html"), "utf8");
const INI = "const EFFECTS = [";
const FIM = "const SCRATCH =";
const iIni = HTML.indexOf(INI);
const iFim = HTML.indexOf(FIM);
if (iIni < 0 || iFim < 0 || iFim < iIni) {
  console.error("As âncoras do bloco de juízo mudaram: esperava " + JSON.stringify(INI)
    + " antes de " + JSON.stringify(FIM) + " em flows.html.");
  process.exit(1);
}
const juizo = new Function(HTML.slice(iIni, iFim)
  + "\nreturn { resumoExecucao, textoDaMidia, cadeiaAtras, ehTranscricao, ehFala, CADEIA_MAX };")();

/* ---------------------------------------------------------------- fixture */
// Tipos e `sub` como o servidor os entrega — medido na instância: o nó de
// transcrição do OpenAI chega como "transcribe: audio" e o ElevenLabs como
// "textToSpeech: speech".
const T = {
  webhook:  { type: "n8n-nodes-base.executeWorkflowTrigger", sub: null },
  set:      { type: "n8n-nodes-base.set", sub: null },
  code:     { type: "n8n-nodes-base.code", sub: null },
  stt:      { type: "@n8n/n8n-nodes-langchain.openAi", sub: "transcribe: audio" },
  tts:      { type: "@elevenlabs/n8n-nodes-elevenlabs.elevenLabs", sub: "textToSpeech: speech" },
  envio:    { type: "n8n-nodes-base.whatsApp", sub: "send: message" }
};

// Uma run: nome, papel, de quem ela veio (`src`), e o que o servidor extraiu.
function run(nome, papel, de, extra = {}) {
  return Object.assign({
    name: nome, papel, index: 0, ms: 5, status: "success",
    items: 1, keys: [], binary: false,
    src: de ? { no: de, run: 0, saida: 0 } : null,
    enviado: null, midia: null, sample: null
  }, extra);
}

function montar(runs) {
  runs.forEach((r, i) => { r.index = i; });
  const byName = new Map(runs.map(r => [r.name, Object.assign({ name: r.name }, T[r.papel])]));
  return { detail: { nodeRuns: runs, status: "success", ms: 4600, error: null }, byName };
}

const resumo = runs => {
  const { detail, byName } = montar(runs);
  return juizo.resumoExecucao(detail, byName);
};
const bloco = (res, tipo) => res.blocos.find(b => b.tipo === tipo) || null;

/* ------------------------------------------------------------------ harness */
let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); console.log("  ok    " + nome); ok++; }
  catch (e) { console.log("  FALHA " + nome + "\n        " + e.message); falhas++; }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || "") + " esperava " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
}

/* =========================================================== 1. o fato novo */
console.log("\n1. o servidor diz que o nó mandou mídia, e só quando mandou");

t("whatsApp com messageType audio -> audio", () =>
  eq(midiaEnviada({ resource: "message", operation: "send", messageType: "audio" }), "audio"));

t("messageType text NÃO é mídia (senão a frase antiga perde o caso dela)", () =>
  eq(midiaEnviada({ messageType: "text" }), null));

t("messageType template NÃO é mídia", () =>
  eq(midiaEnviada({ messageType: "template" }), null));

t("telegram nomeia a mídia na operação: sendAudio -> audio", () =>
  eq(midiaEnviada({ operation: "sendAudio" }), "audio"));

t("telegram sendMessage não é mídia", () =>
  eq(midiaEnviada({ operation: "sendMessage" }), null));

t("messageType desconhecido não passa (o conjunto é fechado)", () =>
  eq(midiaEnviada({ messageType: "reaction" }), null));

t("sem parâmetro nenhum -> null, nunca uma exceção", () => {
  eq(midiaEnviada(null), null);
  eq(midiaEnviada(undefined), null);
  eq(midiaEnviada("audio"), null);
});

t("o parâmetro em si não atravessa — só a palavra", () =>
  eq(midiaEnviada({ messageType: "audio", phoneNumberId: "1049018671622779" }), "audio"));

/* ================================================== 2. o áudio que ENTROU */
console.log("\n2. áudio do lead: a transcrição ganha do recado que o fluxo escreveu");

t("a transcrição ganha do «[lead enviou um audio]», mesmo vindo 3 nós depois", () => {
  const r = resumo([
    run("parametros", "set", null, { sample: { texto: "[lead enviou um audio]", quem: "5517 ***** 2919" } }),
    run("download_audio", "code", "parametros", { binary: true }),
    run("openAI_audio", "stt", "download_audio", { sample: { texto: "oi, queria saber do evento" } }),
    run("msg", "envio", "openAI_audio", { enviado: "claro, te explico" })
  ]);
  const b = bloco(r, "in");
  eq(b.texto, "oi, queria saber do evento");
  eq(b.midia, "audio", "o símbolo de áudio precisa estar lá:");
  eq(b.origem, "transcricao", "e a citação tem que se declarar transcrição:");
  eq(b.origemNó, "openAI_audio");
});

t("sem transcrição, continua o primeiro texto que apareceu (comportamento antigo)", () => {
  const r = resumo([
    run("parametros", "set", null, { sample: { texto: "Boa tarde", quem: "5521 ***** 9536" } }),
    run("msg", "envio", "parametros", { enviado: "Boa tarde, tudo bem?" })
  ]);
  const b = bloco(r, "in");
  eq(b.texto, "Boa tarde");
  eq(b.midia, undefined, "mensagem digitada não leva selo de mídia:");
  eq(b.quem, "5521 ***** 9536");
});

t("transcrição DEPOIS do envio não é o que entrou", () => {
  const r = resumo([
    run("parametros", "set", null, { sample: { texto: "Boa tarde" } }),
    run("msg", "envio", "parametros", { enviado: "oi" }),
    run("openAI_audio1", "stt", "msg", { sample: { texto: "isto é o áudio que saiu" } })
  ]);
  eq(bloco(r, "in").texto, "Boa tarde");
});

t("transcrição sem texto não vira linha de recebido", () => {
  const r = resumo([
    run("openAI_audio", "stt", null, { sample: null, binary: true }),
    run("msg", "envio", "openAI_audio", { enviado: "oi" })
  ]);
  const b = bloco(r, "in");
  eq(b.midia, undefined, "sem texto, cai no caso do arquivo:");
  eq(b.arquivo, true);
});

/* =================================================== 3. o áudio que SAIU */
console.log("\n3. áudio do agente: o texto vem pela aresta, ou não vem");

const cadeiaTTS = extra => [
  run("agente", "code", null, { sample: { texto: "[lead enviou um audio]" } }),
  run("Convert text to speech", "tts", "agente", extra.tts || {}),
  run("Code in JavaScript", "code", "Convert text to speech", { binary: true }),
  run("envio", "envio", "Code in JavaScript", Object.assign({ midia: "audio" }, extra.envio || {}))
];

t("dois nós atrás pela aresta: o texto que virou áudio", () => {
  const r = resumo(cadeiaTTS({ tts: { enviado: "Olha, eu entendo que possa parecer estranho" } }));
  const b = bloco(r, "out");
  eq(b.midia, "audio");
  eq(b.texto, "Olha, eu entendo que possa parecer estranho");
  eq(b.origem, "fala", "classe param — é a mensagem por construção:");
  eq(b.origemNó, "Convert text to speech");
});

t("sem texto no TTS, entra a transcrição que pendura no MESMO TTS", () => {
  const runs = cadeiaTTS({});
  runs.push(run("openAI_audio1", "stt", "Convert text to speech",
    { sample: { texto: "olha, eu entendo que possa parecer estranho" } }));
  const b = bloco(resumo(runs), "out");
  eq(b.texto, "olha, eu entendo que possa parecer estranho");
  eq(b.origem, "transcricao", "e a tela tem que dizer que é a volta pelo STT:");
  eq(b.origemNó, "openAI_audio1");
});

t("o texto do próprio nó de envio ganha do TTS (é o mais próximo da verdade)", () => {
  const b = bloco(resumo(cadeiaTTS({
    tts: { enviado: "texto do tts" },
    envio: { enviado: "legenda do próprio nó" }
  })), "out");
  eq(b.texto, "legenda do próprio nó");
  eq(b.origem, "param");
});

t("SEM TTS na cadeia: diz que mandou áudio e não inventa texto", () => {
  const b = bloco(resumo([
    run("busca", "code", null, { sample: { texto: "[lead enviou um audio]" } }),
    run("envio", "envio", "busca", { midia: "audio" })
  ]), "out");
  eq(b.midia, "audio");
  eq(b.texto, null, "texto inventado é o defeito que este caso recusa:");
  eq(b.origem, null);
});

t("TTS COLADO na ordem mas fora da aresta não conta — proximidade não prova", () => {
  const b = bloco(resumo([
    run("outro_ramo", "code", null, {}),
    // roda logo antes do envio e não está na cadeia dele: é outro ramo do fluxo
    run("Convert text to speech", "tts", "outro_ramo", { enviado: "áudio de OUTRO ramo" }),
    run("preparar", "code", null, {}),
    run("envio", "envio", "preparar", { midia: "audio" })
  ]), "out");
  eq(b.texto, null, "o texto do ramo vizinho não pode virar a mensagem desta:");
});

t("sem `src` a cadeia para — nunca cai no vizinho da ordem", () => {
  const b = bloco(resumo([
    run("Convert text to speech", "tts", null, { enviado: "áudio sem aresta até o envio" }),
    run("envio", "envio", null, { midia: "audio" })
  ]), "out");
  eq(b.texto, null);
});

t("TTS além de CADEIA_MAX saltos fica fora", () => {
  const runs = [run("Convert text to speech", "tts", null, { enviado: "longe demais" })];
  let anterior = "Convert text to speech";
  for (let i = 0; i < juizo.CADEIA_MAX + 1; i++) {
    runs.push(run("passo" + i, "code", anterior, {}));
    anterior = "passo" + i;
  }
  runs.push(run("envio", "envio", anterior, { midia: "audio" }));
  eq(bloco(resumo(runs), "out").texto, null);
});

t("mídia sem texto equivalente: imagem não vai procurar transcrição", () => {
  const runs = cadeiaTTS({ tts: { enviado: "texto do tts" } });
  runs[3].midia = "image";
  const b = bloco(resumo(runs), "out");
  eq(b.midia, "image");
  eq(b.texto, null, "uma imagem não tem transcrição, e o TTS ao lado não é dela:");
});

t("mídia que o servidor não reconhece não vira selo", () => {
  const runs = cadeiaTTS({ tts: { enviado: "texto do tts" } });
  runs[3].midia = "carrossel";
  eq(bloco(resumo(runs), "out").midia, null);
});

/* ================================================== 4. o caminho de texto */
console.log("\n4. o envio de texto continua exatamente como era");

t("texto resolvido do parâmetro: origem param, nenhum selo", () => {
  const b = bloco(resumo([
    run("parametros", "set", null, { sample: { texto: "Boa tarde", quem: "5521 ***** 9536" } }),
    run("msg", "envio", "parametros", { enviado: "Boa tarde, tudo bem?" })
  ]), "out");
  eq(b.texto, "Boa tarde, tudo bem?");
  eq(b.origem, "param");
  eq(b.midia, null);
  eq(b.origemNó, null);
});

t("sem texto e sem mídia, a frase antiga sobrevive (é o caso dela)", () => {
  const b = bloco(resumo([
    run("parametros", "set", null, {}),
    run("msg", "envio", "parametros", {})
  ]), "out");
  eq(b.texto, null);
  eq(b.midia, null);
  eq(b.entrada, null);
});

t("o item que ENTROU continua sendo a terceira opção, rotulado", () => {
  const b = bloco(resumo([
    run("tipo_envio", "set", null, { sample: { texto: "o que entrou no envio" } }),
    run("msg", "envio", "tipo_envio", {})
  ]), "out");
  eq(b.entrada, "o que entrou no envio");
  eq(b.entradaNó, "tipo_envio");
});

/* ============================================== 5. reconhecer os dois papéis */
console.log("\n5. quem é transcrição e quem é fala");

t("transcribe: audio é transcrição; send: message não é", () => {
  eq(juizo.ehTranscricao({ sub: "transcribe: audio" }), true);
  eq(juizo.ehTranscricao({ sub: "send: message" }), false);
  eq(juizo.ehTranscricao(null), false);
});

t("textToSpeech é fala pelo sub OU pelo tipo — pacote de terceiro muda a palavra", () => {
  eq(juizo.ehFala({ sub: "textToSpeech: speech" }), true);
  eq(juizo.ehFala({ sub: null, type: "@elevenlabs/n8n-nodes-elevenlabs.elevenLabs" }), true);
  eq(juizo.ehFala({ sub: "transcribe: audio", type: "@n8n/n8n-nodes-langchain.openAi" }), false);
  eq(juizo.ehFala(null), false);
});

/* -------------------------------------------------------------------- fim */
console.log(falhas ? `\nfalhou: ${ok} ok, ${falhas} falha(s)` : `\npassou: ${ok} ok, 0 falha(s)`);
process.exit(falhas ? 1 : 0);
