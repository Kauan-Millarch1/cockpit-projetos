/* novidades-test.js — o job diário, sem modelo, sem rede e sem custo.
 *
 * O que ele faz roda sozinho, uma vez por dia, com ninguém olhando: parseia
 * texto vindo da internet, julga uma proposta de modelo e ESCREVE na base de
 * conhecimento do Tester. Cada teste aqui recusa um defeito nomeado, e a lista é
 * a mesma que `prompt()` promete ao modelo — é isso que impede prompt e código
 * de divergirem, do mesmo jeito que `edicao-test.js` faz do outro lado.
 *
 * `node novidades-test.js`
 */

"use strict";

const n = require("./novidades.js");

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); console.log("  ok    " + nome); ok++; }
  catch (e) { console.log("  FALHA " + nome + "\n        " + (e && e.message)); falhas++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "esperava verdadeiro"); }
function contem(lista, trecho) {
  assert(lista.some(p => p.includes(trecho)), "esperava um problema contendo «" + trecho + "», veio: " + JSON.stringify(lista));
}

/* ------------------------------------------------------------------ o feed */

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>n8n release notes</title>
<item>
<title>Add a guided setup view for Custom Auth</title>
<link>https://github.com/n8n-io/n8n/pull/35324</link>
<guid isPermaLink="true">https://github.com/n8n-io/n8n/pull/35324</guid>
<pubDate>Tue, 04 Aug 2026 00:00:00 GMT</pubDate>
<category>n8n 2.34</category>
<description>Credenciais agora mostram &quot;um formulário&quot; &amp; nada de JSON cru.</description>
</item>
<item>
<title>Outra coisa</title>
<link>https://github.com/n8n-io/n8n/pull/35400</link>
<guid isPermaLink="true">https://github.com/n8n-io/n8n/pull/35400</guid>
<category>n8n 2.35</category>
<description><![CDATA[Descrição com <b>tag</b> dentro.]]></description>
</item>
</channel></rss>`;

const itens = n.parseFeed(XML);

t("o feed vira itens com guid, versão e link", () => {
  assert(itens.length === 2, "esperava 2 itens, veio " + itens.length);
  assert(itens[0].guid === "https://github.com/n8n-io/n8n/pull/35324", "guid errado: " + itens[0].guid);
  assert(itens[0].versao === "n8n 2.34", "versão errada: " + itens[0].versao);
  assert(itens[0].titulo.startsWith("Add a guided setup"), "título errado");
});

t("entidade XML é desescapada e tag é removida", () => {
  assert(itens[0].descricao.includes('"um formulário"'), "não desescapou &quot;: " + itens[0].descricao);
  assert(itens[0].descricao.includes("&"), "não desescapou &amp;");
  assert(!itens[1].descricao.includes("<b>"), "deixou tag HTML passar: " + itens[1].descricao);
  assert(itens[1].descricao.includes("tag"), "comeu o texto junto com a tag");
});

t("caractere de controle vindo do feed nao sobrevive", () => {
  // Escrito com escape: um byte de controle LITERAL aqui faria este proprio
  // arquivo reprovar no `caractere-test.js`. O defeito que se testa nao pode
  // ser plantado no testador.
  const sujo = n.limpar("antes\u0000\u001Fdepois");
  assert(!/[\u0000-\u001F]/.test(sujo), "passou controle: " + JSON.stringify(sujo));
  assert(sujo.includes("antes") && sujo.includes("depois"), "comeu o texto: " + sujo);
});

t("item sem guid nem link é descartado, não vira entrada anônima", () => {
  const semGuid = n.parseFeed("<rss><channel><item><title>solto</title></item></channel></rss>");
  assert(semGuid.length === 0, "aceitou item sem fonte");
});

t("feed que não é feed devolve lista vazia em vez de item inventado", () => {
  assert(n.parseFeed("<html><body>404: Not Found</body></html>").length === 0, "inventou item de uma página HTML");
});

/* ------------------------------------------------------------------ portões */

const bom = { entradas: [{ guid: itens[0].guid, impacto: "credencial", texto: "Credencial de Custom Auth agora tem formulário por campo; o JSON cru deixou de ser o caminho." }], precisaEsquema: false, nota: "n8n 2.34" };

t("proposta bem formada passa", () => {
  const p = n.validar(bom, itens);
  assert(p.length === 0, "reprovou proposta boa: " + JSON.stringify(p));
});

t("lista vazia é resposta legítima — a maioria dos dias não tem nada", () => {
  assert(n.validar({ entradas: [] }, itens).length === 0, "reprovou entradas vazias");
});

t("guid que não veio no feed é recusado — nada de fonte inventada", () => {
  contem(n.validar({ entradas: [{ guid: "https://exemplo.invalido/1", texto: "x".repeat(40) }] }, itens), "não veio no feed");
});

t("entrada sem guid é recusada", () => {
  contem(n.validar({ entradas: [{ texto: "x".repeat(40) }] }, itens), "`guid` ausente");
});

t("guid repetido na mesma proposta é recusado", () => {
  const dup = { entradas: [bom.entradas[0], { ...bom.entradas[0] }] };
  contem(n.validar(dup, itens), "repetido");
});

t("texto curto demais é recusado", () => {
  contem(n.validar({ entradas: [{ guid: itens[0].guid, texto: "mudou" }] }, itens), "curto demais");
});

t("texto acima do teto é recusado com o tamanho na mensagem", () => {
  contem(n.validar({ entradas: [{ guid: itens[0].guid, texto: "a".repeat(n.MAX_TEXTO + 1) }] }, itens), String(n.MAX_TEXTO + 1));
});

t("bloco de código no texto é recusado — quem monta o doc é o código", () => {
  contem(n.validar({ entradas: [{ guid: itens[0].guid, texto: "use assim:\n```json\n{}\n```\nfim disso tudo" }] }, itens), "bloco de código");
});

t("título markdown no texto é recusado — ele quebraria a estrutura do doc", () => {
  contem(n.validar({ entradas: [{ guid: itens[0].guid, texto: "# Novidade grande\nisso muda a forma do parâmetro" }] }, itens), "título markdown");
});

t("resposta que não é objeto é recusada sem explodir", () => {
  contem(n.validar(null, itens), "não é um objeto");
  contem(n.validar([1, 2], itens), "não é um objeto");
  contem(n.validar("texto", itens), "não é um objeto");
});

t("`precisaEsquema` não booleano é recusado", () => {
  contem(n.validar({ entradas: [], precisaEsquema: "sim" }, itens), "booleano");
});

t("`nota` gigante é recusada — ela vai no carimbo de versão", () => {
  contem(n.validar({ entradas: [], nota: "n".repeat(200) }, itens), "120");
});

t("`impacto` fora do conjunto é recusado", () => {
  contem(n.validar({ entradas: [{ guid: itens[0].guid, impacto: "urgentíssimo", texto: "x".repeat(40) }] }, itens), "`impacto` fora");
});

/* ------------------------------------------------------------------- o doc */

t("a linha do doc carrega SEMPRE a fonte e a versão", () => {
  const linha = n.linhaEntrada(bom.entradas[0], itens[0]);
  assert(linha.includes(itens[0].link), "linha sem link: " + linha);
  assert(linha.includes("n8n 2.34"), "linha sem versão: " + linha);
  assert(linha.includes("formulário por campo"), "linha sem o texto");
});

t("texto do modelo com quebra de linha não parte a linha do doc", () => {
  const linha = n.linhaEntrada({ texto: "primeira\nsegunda" }, itens[0]);
  const corpo = linha.split("\n")[0];
  assert(corpo.includes("primeira segunda"), "quebra sobreviveu: " + JSON.stringify(linha));
});

/* ------------------------------------------------------------------ versão */

t("a menor sobe, a maior nunca", () => {
  assert(n.proximaVersao("v3.1") === "v3.2", "v3.1 deveria virar v3.2");
  assert(n.proximaVersao("v3.9") === "v3.10", "não pode voltar para v4.0 sozinho");
});

t("versão em formato inesperado não vira número inventado", () => {
  assert(n.proximaVersao("base ?") === null, "inventou versão de um valor torto");
  assert(n.proximaVersao(undefined) === null, "inventou versão do nada");
});

/* ------------------------------------------------------------------ prompt */

t("o prompt cabe na linha de comando com a rodada cheia", () => {
  const gordo = Array.from({ length: n.ITENS_POR_RODADA }, (_, i) => ({
    guid: "https://github.com/n8n-io/n8n/pull/" + (40000 + i),
    titulo: "T".repeat(140), versao: "n8n 2.99", link: "https://x/" + i,
    descricao: "D".repeat(900)
  }));
  const p = n.prompt(gordo, true);
  assert(p.length < 30000, "prompt com " + p.length + " caracteres — o teto do `rodarAvulso` é 30000");
});

t("o prompt manda deixar de fora na dúvida", () => {
  const p = n.prompt(itens, false);
  assert(p.includes("Na dúvida, deixe de fora"), "sumiu a regra que segura a base de se envenenar");
  assert(p.includes("entradas: []"), "não diz que lista vazia é resposta válida");
});

/* ------------------------------------------- aplicar(): a escrita no doc
 *
 * Este bloco existe por um defeito MEDIDO que custou 8 entradas de conhecimento
 * já pagas, e ele é o único aqui que exercita a função que ESCREVE.
 *
 * 09/09/2026: `n8n-novidades.md` estava 100% CRLF — o git converte na saída no
 * Windows, e um `git checkout` qualquer basta. O código casava a âncora com uma
 * STRING terminada em `\n`, que contra `-->\r\n` não casa; e `String.replace`
 * sem casamento devolve o original SEM RECLAMAR. O arquivo era reescrito
 * idêntico e a função retornava `escreveu: 4`.
 *
 * O dano não foi o arquivo não mudar: foi a função AFIRMAR que mudou. Com
 * `escreveu` truthy o `rodada()` sobe a versão, escreve o aviso dizendo "4
 * novidades" e marca os `guid` como VISTOS — e item visto não volta nunca. As
 * rodadas v3.7 e v3.8 se perderam, e a conta fecha: o doc tinha 22 entradas e
 * v3.2..v3.6 somam exatamente 22.
 *
 * Por isso os casos vêm em pares: um prova que a linha ENTRA, o outro prova que
 * a função RECUSA quando não entrou. Só o primeiro deixaria passar de volta
 * exatamente este defeito, porque o bug antigo escrevia um arquivo válido. */

const fs = require("fs");
const path = require("path");
const os = require("os");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "novid-test-"));
const ITENS = [
  { guid: "g1", titulo: "Slack Node: novo campo", link: "https://github.com/n8n-io/n8n/pull/1", versao: "n8n 2.40" },
  { guid: "g2", titulo: "Set Node: outro campo", link: "https://github.com/n8n-io/n8n/pull/2", versao: null }
];
const ENTRADAS = [{ guid: "g1", texto: "primeiro texto" }, { guid: "g2", texto: "segundo texto" }];

/* O doc de fixture é montado com a âncora e o fim de linha pedidos. `eol`
   explícito, nunca herdado desta máquina: o defeito É sobre fim de linha, e um
   fixture que usa o do ambiente testaria o ambiente. */
function docFixture(eol, comAncora = true) {
  const l = ["# Novidades", "", comAncora ? "<!-- BLOCO: novidades -->" : "<!-- OUTRA COISA -->", "",
    "- **Entrada antiga** · n8n 2.30 — texto velho.", "  <https://github.com/n8n-io/n8n/pull/0>",
    "<!-- /BLOCO -->", ""];
  return l.join(eol);
}

let assincronos = 0, assincronasFalhas = 0;
async function ta(nome, fn) {
  try { await fn(); console.log("  ok    " + nome); assincronos++; }
  catch (e) { console.log("  FALHA " + nome + "\n        " + (e && e.message)); assincronasFalhas++; }
}

(async () => {
  console.log("\n  --- aplicar(): a escrita no doc");

  /* O CASO QUE CARREGA O ARQUIVO. Com a âncora seguida de `\r\n`, a versão
     antiga devolvia `escreveu: 2` sem inserir nada. */
  await ta("insere num doc CRLF — o defeito de 09/09", async () => {
    const doc = path.join(TMP, "crlf.md");
    fs.writeFileSync(doc, docFixture("\r\n"), "utf8");
    const r = await n.aplicar(ENTRADAS, ITENS, doc);
    assert(r.escreveu === 2, "escreveu " + r.escreveu + ", esperava 2");
    assert(!r.erro, "não devia ter erro: " + r.erro);
    const d = fs.readFileSync(doc, "utf8");
    assert(d.includes("primeiro texto") && d.includes("segundo texto"), "as linhas não entraram no arquivo");
    assert(d.includes("Entrada antiga"), "a entrada que já existia foi perdida");
  });

  await ta("e num doc LF, que é o caso que já funcionava", async () => {
    const doc = path.join(TMP, "lf.md");
    fs.writeFileSync(doc, docFixture("\n"), "utf8");
    const r = await n.aplicar(ENTRADAS, ITENS, doc);
    assert(r.escreveu === 2, "escreveu " + r.escreveu);
    assert(fs.readFileSync(doc, "utf8").includes("primeiro texto"), "a linha não entrou");
  });

  /* O FIM DE LINHA DO DOCUMENTO MANDA. Inserir LF num arquivo CRLF deixaria o
     doc misturado, e a rodada seguinte leria um arquivo que não é nem um nem
     outro — o defeito voltaria pela porta do lado. */
  await ta("preserva o CRLF do documento em vez de misturar", async () => {
    const doc = path.join(TMP, "eol.md");
    fs.writeFileSync(doc, docFixture("\r\n"), "utf8");
    await n.aplicar(ENTRADAS, ITENS, doc);
    const b = fs.readFileSync(doc, "latin1");
    const crlf = (b.match(/\r\n/g) || []).length, lf = (b.match(/\n/g) || []).length;
    assert(lf === crlf, "sobraram " + (lf - crlf) + " LF puro(s) num arquivo CRLF");
  });

  await ta("e o LF de um doc LF, pelo mesmo motivo", async () => {
    const doc = path.join(TMP, "eol-lf.md");
    fs.writeFileSync(doc, docFixture("\n"), "utf8");
    await n.aplicar(ENTRADAS, ITENS, doc);
    const b = fs.readFileSync(doc, "latin1");
    assert((b.match(/\r/g) || []).length === 0, "apareceu CR num arquivo LF");
  });

  /* O OUTRO LADO DO PAR, e é ele que impede o defeito de voltar: sem âncora,
     `escreveu` é 0, o erro é NOMEADO, e o arquivo não é tocado. A versão antiga
     devolvia o número cheio aqui. */
  await ta("sem a âncora: escreveu 0, erro nomeado, e NADA escrito", async () => {
    const doc = path.join(TMP, "sem-ancora.md");
    const antes = docFixture("\r\n", false);
    fs.writeFileSync(doc, antes, "utf8");
    const r = await n.aplicar(ENTRADAS, ITENS, doc);
    assert(r.escreveu === 0, "escreveu " + r.escreveu + " sem âncora — é o defeito de volta");
    assert(r.erro && /âncora/.test(r.erro), "o erro não nomeia a âncora: " + r.erro);
    assert(/visto/.test(r.erro), "o erro não diz que nada foi marcado como visto: " + r.erro);
    assert(fs.readFileSync(doc, "utf8") === antes, "o arquivo foi tocado mesmo sem inserir");
  });

  /* `linhaEntrada` LANÇAVA com `guid` que não casa (`item.versao` sobre
     `undefined`), então o `.filter(Boolean)` do chamador nunca protegeu nada — e
     lançar ali mata uma rodada paga inteira por causa de uma linha. */
  await ta("linhaEntrada devolve null em vez de lançar quando o item não veio", () => {
    assert(n.linhaEntrada({ guid: "x", texto: "t" }, undefined) === null, "devia ser null");
    assert(n.linhaEntrada({ guid: "x", texto: "t" }, {}) === null, "item sem link devia ser null");
    assert(n.linhaEntrada(null, ITENS[0]) === null, "entrada nula devia ser null");
  });

  await ta("um guid órfão é pulado e as outras entradas ainda entram", async () => {
    const doc = path.join(TMP, "orfao.md");
    fs.writeFileSync(doc, docFixture("\r\n"), "utf8");
    const r = await n.aplicar([...ENTRADAS, { guid: "nao-existe", texto: "fantasma" }], ITENS, doc);
    assert(r.escreveu === 2, "escreveu " + r.escreveu + ", esperava 2 (o órfão não conta)");
    const d = fs.readFileSync(doc, "utf8");
    assert(!d.includes("fantasma"), "o órfão entrou no doc");
    assert(d.includes("primeiro texto"), "a entrada boa não entrou");
  });

  await ta("doc ausente nasce com o cabeçalho e a âncora", async () => {
    const doc = path.join(TMP, "nao-existe.md");
    const r = await n.aplicar(ENTRADAS, ITENS, doc);
    assert(r.escreveu === 2, "escreveu " + r.escreveu);
    const d = fs.readFileSync(doc, "utf8");
    assert(d.includes("<!-- BLOCO: novidades -->"), "nasceu sem a âncora");
    assert(d.includes("primeiro texto"), "nasceu sem a entrada");
  });

  await ta("lista vazia não escreve e não é erro", async () => {
    const doc = path.join(TMP, "vazio.md");
    const antes = docFixture("\r\n");
    fs.writeFileSync(doc, antes, "utf8");
    const r = await n.aplicar([], ITENS, doc);
    assert(r.escreveu === 0, "escreveu " + r.escreveu);
    assert(!r.erro, "lista vazia não é falha: " + r.erro);
    assert(fs.readFileSync(doc, "utf8") === antes, "tocou o arquivo sem ter o que inserir");
  });

  /* A ÂNCORA é exportada, então o teste mede a de verdade em vez de uma cópia. */
  await ta("a âncora casa os dois fins de linha", () => {
    assert(n.ANCORA.test("<!-- BLOCO: novidades -->\n"), "não casa LF");
    assert(n.ANCORA.test("<!-- BLOCO: novidades -->\r\n"), "não casa CRLF");
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* melhor deixar lixo que mascarar o erro */ }

  const totalOk = ok + assincronos, totalFalhas = falhas + assincronasFalhas;
  console.log("\n" + (totalFalhas ? "FALHOU" : "passou") + ": " + totalOk + " ok, " + totalFalhas + " falha(s)\n");
  process.exit(totalFalhas ? 1 : 0);
})();
