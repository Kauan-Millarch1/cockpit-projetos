/* anexo-bolha-test.js — o print aparece DENTRO da mensagem que o levou.
 *
 * O DEFEITO, visto por ele na tela: manda um print no /upgrade e a conversa desenha
 * a mensagem como texto puro. Medido antes de consertar: o arquivo chega ao disco,
 * entra no prompt e é ABERTO pela sessão — o `Read` volta com a imagem decodificada,
 * e a resposta fala do conteúdo do print. Só a TELA não mostrava; e o chip continuava
 * no compositor depois do envio, o que lê como *ainda não mandei*. Um pipeline que
 * funciona e uma tela que não mostra é indistinguível de um que não funciona, e a
 * segunda leitura é a que faz alguém mandar o arquivo de novo.
 *
 * O QUE CADA BLOCO PROVA, em uma linha:
 *   1. o retrato que vai na mensagem é SÓ FORMA — nenhum byte de conteúdo;
 *   2. ele é do INSTANTE DO ENVIO, não o estado atual da pasta;
 *   3. o histórico persiste isso, e o LEDGER (que vai para o git) não;
 *   4. a guarda de caminho recusa sair de `anexos/` — inclusive para o backup COM
 *      credencial, que mora no diretório vizinho;
 *   5. a rota: as três recusas, o 404 que é FATO sobre o disco, e o content-type;
 *   6. a bolha desenha imagem como imagem e o resto como chip, e não desenha nada
 *      quando o campo nunca existiu;
 *   7. o ramo do arquivo ausente é um ouvinte em captura, e a frase dele não acusa
 *      o disco — as duas causas possíveis ficam no `title`;
 *   8. depois do envio o chip SAI do compositor e vai para a TIRA, e o compositor
 *      não repete mais a explicação — a ausência dela é medida, não só a presença.
 *
 * O juízo da tela e o bloco da rota são EXTRAÍDOS em tempo de execução — do
 * `upgrade.html` e do `server.js`, que não é `require`ável (ele dá `listen()` na
 * 4317, o terminal de verdade do Kauan). Reimplementá-los aqui provaria a cópia.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhum n8n. Escreve só num diretório
 * temporário, apagado no fim.
 *   node anexo-bolha-test.js */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const anexos = require("./anexos.js");
const up = require("./upgrade.js");
const conversas = require("./conversas.js");
const estatico = require("./estatico.js");
/* O MÓDULO DE VERDADE, não um dublê: é ele que desenha a tira, e um dublê aqui
   provaria a cópia em vez da tela — a mesma disciplina que faz o juízo ser extraído
   do `upgrade.html` em tempo de execução. Ele carrega sem DOM de propósito. */
const entradas = require("./entradas.js");

const h = fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8");
const srv = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const pega = (texto, de, ate) => {
  const i = texto.indexOf(de);
  if (i < 0) throw new Error("nao achei `" + de + "` — o arquivo mudou de forma");
  const j = texto.indexOf(ate, i);
  if (j < 0) throw new Error("nao achei o fim do bloco a partir de `" + de + "`");
  return texto.slice(i, j);
};
const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

let ok = 0, bad = 0;
const t = (n, c) => { if (c) { ok++; console.log("  ok    " + n); } else { bad++; console.log("  FALHOU " + n); } };

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 1 ] o retrato que vai na mensagem: só forma, nunca conteúdo");

/* Um anexo como o `inventario()` devolve, mais campos que NÃO podem viajar. O
   `b64` é o que o navegador mandou; se ele vazar para cá, um print de 66KB entra no
   histórico como base64 — num arquivo que é lido inteiro em toda abertura da gaveta. */
const anx1 = { nome: "print-182748.png", arquivo: "anexos/print-182748.png", tipo: "imagem", bytes: 67417, b64: "AAAA", conteudo: "xxx", dePasta: false };
const anx2 = { nome: "estoque.csv", arquivo: "anexos/projeto/dados/estoque.csv", tipo: "dados", bytes: 900, dePasta: true, raiz: "projeto" };
const retrato = up.anexosDaMensagem({ anexos: [anx1, anx2] });
t("o retrato leva nome, caminho, tipo e tamanho",
  retrato.length === 2 && retrato[0].arquivo === "anexos/print-182748.png"
  && retrato[0].tipo === "imagem" && retrato[0].bytes === 67417);
t("nenhum byte de conteúdo atravessa",
  !JSON.stringify(retrato).includes("AAAA") && !JSON.stringify(retrato).includes("xxx"));
t("as chaves são exatamente as quatro",
  retrato.every(a => Object.keys(a).sort().join(",") === "arquivo,bytes,nome,tipo"));
t("sessão sem anexo devolve lista vazia, nunca `null`",
  Array.isArray(up.anexosDaMensagem({ anexos: [] })) && up.anexosDaMensagem({}).length === 0
  && up.anexosDaMensagem(null).length === 0);

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 2 ] é o instante do ENVIO, não o estado de agora");
const fonteUp = semComentario(fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8"));
t("a mensagem dele nasce com o retrato colado nela",
  /de: "eu", texto: t, em: new Date\(\)\.toISOString\(\), anexos: anexosDaMensagem\(s\)/.test(fonteUp));
/* SE A TELA LESSE `s.anexos` NA HORA DE DESENHAR, um print anexado hoje apareceria
   dentro da mensagem de ontem — a tela afirmando que uma rodada já paga viu algo que
   ela não tinha como ver. O retrato na mensagem é o que impede isso. */
const bolhaSrc = semComentario(pega(h, "function anexosDaBolha(m) {", "\nfunction blocosConversa()"));
t("a bolha lê o retrato DA MENSAGEM, nunca o estado atual da pasta",
  /m && m\.anexos/.test(bolhaSrc) && !/S\.conv\.anexos/.test(bolhaSrc) && !/anexosAgora\(/.test(bolhaSrc));

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 3 ] o histórico guarda; o ledger do git não");
const fonteConv = semComentario(fs.readFileSync(path.join(__dirname, "conversas.js"), "utf8"));
const docSrc = pega(fonteConv, "function documento(s) {", "\nasync function salvar");
t("o `documento` persiste os anexos da mensagem", /anexos: Array\.isArray\(m\.anexos\)/.test(docSrc));
t("...só a forma, nunca o arquivo", !/b64/.test(docSrc) && !/conteudo/.test(docSrc));
/* `null` e não `[]` para mensagem sem anexo: é o que as conversas gravadas ANTES
   desta versão têm, e as duas têm de ler igual na tela. */
/* `null` E NAO `[]`, e este caso afere o LITERAL porque um mutante passou pela
   versao frouxa dele: `Array.isArray(m.anexos)` sozinho grava `[]` em toda mensagem
   sem anexo, e uma regex de "termina em null" continua casando com o resto do bloco.
   A diferenca importa porque `[]` seria um campo NOVO em toda conversa antiga
   regravada — afirmando "esta mensagem nao levou anexo" onde a verdade e "esta
   versao nao sabia registrar", que e ler ausencia como negativa. */
t("mensagem sem anexo grava `null`, igual ao que o histórico velho já tem",
  /anexos: Array\.isArray\(m\.anexos\) && m\.anexos\.length/.test(docSrc)
  && /^\s*: null,$/m.test(docSrc));
/* O QUE VAI PARA O GIT é o `conversas.json`, e ele é uma whitelist de nomes. Um
   nome de arquivo ali identificaria cliente num arquivo rastreado. */
const ledSrc = pega(fonteConv, "function linhaLedger(d) {", "\nasync function lerLedger");
t("o ledger rastreado não leva anexo nenhum",
  !/anexo/i.test(ledSrc) && !/chat/.test(ledSrc));

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 4 ] a guarda de caminho: sair de `anexos/` é recusado");
const dirFake = path.join(os.tmpdir(), "x-sessao");
const recusa = rel => {
  try { anexos.caminhoDeAnexo(dirFake, rel); return false; } catch { return true; }
};
t("um anexo normal passa",
  anexos.caminhoDeAnexo(dirFake, "anexos/print.png") === path.join(dirFake, "anexos", "print.png"));
t("anexo dentro de pasta passa",
  anexos.caminhoDeAnexo(dirFake, "anexos/projeto/dados/estoque.csv").endsWith(path.join("anexos", "projeto", "dados", "estoque.csv")));
t("`..` para fora do diretório da sessão é recusado", recusa("anexos/../../outro/x.png"));
/* O IRMÃO É O CASO QUE IMPORTA: `fluxo.json` é o documento do fluxo, e uma rota que
   existe para mostrar imagem não pode servir ele. */
t("um irmão do diretório da sessão é recusado", recusa("fluxo.json"));
t("`REGRAS.md` da sessão é recusado", recusa("REGRAS.md"));
/* E O PIOR DE TODOS: o backup pré-aplicação vive FORA do diretório da sessão de
   propósito, e é o único arquivo que ainda carrega credencial. */
t("o backup com credencial do diretório vizinho é recusado",
  recusa("../_private/r123.json") && recusa("anexos/../../_private/r123.json"));
t("caminho absoluto é recusado", recusa("C:/Windows/win.ini") || recusa("/etc/passwd"));

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 5 ] a rota, dirigida de verdade");

/* O bloco sai do `server.js` entre delimitadores e roda com um `req`/`res` falsos.
   As dependências reais entram como parâmetro: `anexos` e `estatico` são os de
   verdade, então as guardas e o MIME provados aqui são os que o servidor usa. */
const rotaSrc = pega(srv, "/* ARQANEXO-INI", "/* ARQANEXO-FIM */")
  .replace("/* ARQANEXO-INI", "/*");
const rodarRota = new Function("req", "res", "url", "p", "json", "path", "fs", "anexos", "upgrade", "estatico",
  rotaSrc + "; return { naoBateu: true };");

const dirSessao = fs.mkdtempSync(path.join(os.tmpdir(), "bolha-"));
const convId = "u" + "abc123";
const raizFake = dirSessao;
fs.mkdirSync(path.join(raizFake, convId, "anexos"), { recursive: true });
/* Um PNG de 1x1 de verdade: o teste tem de provar o content-type e o
   content-length sobre bytes que existem, não sobre um arquivo de texto renomeado. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001"
  + "0d0a2db40000000049454e44ae426082", "hex");
fs.writeFileSync(path.join(raizFake, convId, "anexos", "print.png"), PNG);
fs.writeFileSync(path.join(raizFake, convId, "fluxo.json"), '{"nodes":[]}');

function chamar(caminho, busca, metodo) {
  const resp = { status: 0, cab: null, corpo: null, terminou: false };
  const res = {
    writeHead(s, c) { resp.status = s; resp.cab = c; },
    end(b) { resp.corpo = b == null ? null : b; resp.terminou = true; }
  };
  const json = (r, s, o) => { resp.status = s; resp.corpo = JSON.stringify(o); resp.terminou = true; };
  rodarRota({ method: metodo || "GET" }, res, new URL("http://x" + caminho + (busca || "")),
    caminho, json, path, fs, anexos, { RUNS_DIR: raizFake }, estatico);
  return resp;
}

try {
  const bom = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fprint.png");
  t("o anexo é servido com 200", bom.status === 200);
  t("...com o content-type da imagem, tirado do `estatico.tipoDe`",
    bom.cab && bom.cab["content-type"] === "image/png");
  t("...com o tamanho real do arquivo",
    bom.cab && bom.cab["content-length"] === String(PNG.length) && bom.corpo && bom.corpo.length === PNG.length);
  /* `inline` é o que faz a imagem APARECER; sem ele o navegador baixa e a bolha
     fica vazia sem nada dizer por quê. */
  t("...e `inline`, senão o navegador baixa em vez de mostrar",
    /^inline;/.test((bom.cab || {})["content-disposition"] || ""));
  t("...e `private`: isto é dado de cliente, nenhum proxy tem por que guardar",
    /private/.test((bom.cab || {})["cache-control"] || ""));
  t("HEAD leva os cabeçalhos e nenhum corpo",
    (() => { const r = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fprint.png", "HEAD");
      return r.status === 200 && r.corpo == null && r.cab["content-length"] === String(PNG.length); })());

  t("id de conversa fora de forma é 400", chamar("/api/upgrade/arquivo/../x", "?nome=anexos%2Fa.png").status === 400);
  /* DUAS CAMADAS, e este caso prova que a de fora existe. `caminhoDeAnexo` sozinho
     ja recusa `fluxo.json` (o `path.relative` sai com `..`), entao aferir so o 400
     deixa passar o mutante que apaga o porteiro da rota — foi o que aconteceu. O que
     pina a camada e a FRASE: cada uma recusa com a sua, e a de fora diz o que a
     rota aceita em vez de falar de caminho. Mesma disciplina de `nomeSeguro`/`dentro`
     no `anexos.js`: duas camadas independentes, nao uma com backup. */
  const foraDeAnexos = chamar("/api/upgrade/arquivo/" + convId, "?nome=fluxo.json");
  t("nome que não começa em `anexos/` é 400", foraDeAnexos.status === 400);
  t("...e é o porteiro da ROTA que recusa, com frase própria",
    /só arquivo de anexo/.test(String(foraDeAnexos.corpo)));
  /* A MESMA lista que aceitou o arquivo na entrada decide na saída. Uma segunda
     lista aqui aceitaria de volta o que a entrada recusou. */
  t("extensão fora de `anexos.TIPOS` é 400",
    chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fchave.pem").status === 400);
  t("...e a lista consultada é a de `anexos.js`, não uma cópia",
    /anexos\.TIPOS\[ext\]/.test(semComentario(rotaSrc)));
  t("escapar de `anexos/` pelo `..` é 400",
    chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2F..%2F..%2F_private%2Fr1.json").status === 400);
  /* ────────────────────────────────────────────────────────────────────────
     O TIPO QUE O ANEXO PEDE NÃO PODE SER O TIPO COM QUE ELE É SERVIDO.
     Achado de auditoria, 2026-08-25: XSS ARMAZENADO de primeira parte.

     `anexos.TIPOS` aceita `.html` (classe "dados") porque a SESSÃO lê o arquivo
     com `Read`, e ler é inofensivo. Servir era outra coisa: a rota mandava
     `content-type: estatico.tipoDe(ext)` com `content-disposition: inline`, e
     `estatico.tipoDe(".html")` é `text/html`. Um clique no chip abria o arquivo
     DO CLIENTE como documento de PRIMEIRA PARTE em localhost:4317, com o cookie
     `cockpit_sessao` junto e o `guarda` dizendo `propria` — e dali o script
     chamava `/api/claude/run/:id/approve` (escreve em fluxo de produção) e
     `/retry` (mensagem real para um lead, sem desfazer). O vetor é a rotina que
     o CLAUDE.md documenta: "arraste a pasta descompactada, pastas são aceitas".
     `nosniff` não ajuda quando o tipo DECLARADO já é executável.

     Os casos vão nos DOIS sentidos, e o segundo é o que impede a correção de
     virar "recusa tudo": a imagem TEM que continuar `inline`, senão a bolha fica
     vazia — que é o defeito que este arquivo inteiro existe para não ter. */
  fs.writeFileSync(path.join(raizFake, convId, "anexos", "carga.html"),
    "<script>fetch('/api/claude/run/r1/approve',{method:'POST'})<\/script>");
  const html = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fcarga.html");
  t("um .html anexado ainda é SERVIDO (200): recusar seria perder o arquivo",
    html.status === 200);
  t("...mas NUNCA como text/html — desce como octeto",
    (html.cab || {})["content-type"] === "application/octet-stream");
  t("...e como `attachment`: o navegador baixa, não executa",
    /^attachment;/.test((html.cab || {})["content-disposition"] || ""));
  t("...e o CSP é SOBRESCRITO para `default-src none` mais `sandbox`",
    /default-src 'none'/.test((html.cab || {})["content-security-policy"] || "")
    && /sandbox/.test((html.cab || {})["content-security-policy"] || ""));
  t("...e o CSP herdado de `estatico.SEGURANCA` não fica no lugar dele",
    (html.cab || {})["content-security-policy"] !== estatico.SEGURANCA["content-security-policy"]);
  /* A lista é de RENDERIZÁVEL e não pode depender do que NÃO está no
     `estatico.TIPOS`: hoje `.htm` escapa por ACIDENTE (está fora daquela tabela),
     e segurança que depende de uma ausência quebra no dia em que alguém a
     completa. Este caso é o que trava a correção na forma de LISTA e não na
     forma de sorte. */
  fs.writeFileSync(path.join(raizFake, convId, "anexos", "carga.htm"), "<script>x<\/script>");
  t("o mesmo vale para .htm, que hoje só escapa por acidente",
    (() => { const r = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fcarga.htm");
      return r.status === 200 && r.cab["content-type"] === "application/octet-stream"
        && /^attachment;/.test(r.cab["content-disposition"]); })());
  t("a imagem NÃO foi levada junto: segue image/png e segue `inline`",
    (() => { const r = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fprint.png");
      return r.cab["content-type"] === "image/png" && /^inline;/.test(r.cab["content-disposition"]); })());
  fs.writeFileSync(path.join(raizFake, convId, "anexos", "spec.pdf"),
    Buffer.from("255044462d312e340a25", "hex"));
  t("...e o PDF segue renderizável, que é o outro que a bolha oferece",
    (() => { const r = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fspec.pdf");
      return r.status === 200 && r.cab["content-type"] === "application/pdf"
        && /^inline;/.test(r.cab["content-disposition"]); })());

  t("método que não é leitura é 405",
    chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fprint.png", "POST").status === 405);

  /* 404 É FATO SOBRE O DISCO, não recusa: `.upgrade-runs/` é scratch, e a tela
     precisa dessa diferença para escrever "o arquivo não está mais aqui". */
  const sumiu = chamar("/api/upgrade/arquivo/" + convId, "?nome=anexos%2Fnaoexiste.png");
  t("arquivo limpo do scratch é 404", sumiu.status === 404);
  t("...e o corpo diz que é scratch, para a tela poder explicar",
    /"scratch":true/.test(String(sumiu.corpo)) && /não está mais no disco/.test(String(sumiu.corpo)));
  t("...e a rota nunca serve nada de fora do processo por engano: o corpo é JSON",
    (() => { try { JSON.parse(String(sumiu.corpo)); return true; } catch { return false; } })());

  /* ────────────────────────────────────────────────────────────────────────── */
  console.log("\n[ 6 ] a bolha: imagem vira imagem, o resto vira chip");
  const S = { convId: "uabc123" };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const bolha = new Function("S", "esc",
    pega(h, "function anexosDaBolha(m) {", "\nfunction blocosConversa()")
    + "; return anexosDaBolha;")(S, esc);

  const imgHtml = bolha({ anexos: [{ arquivo: "anexos/print-182748.png", nome: "print-182748.png", tipo: "imagem", bytes: 67417 }] });
  t("imagem sai como `<img>`", /<img /.test(imgHtml));
  t("...apontando para a rota do arquivo, com o nome codificado",
    /\/api\/upgrade\/arquivo\/uabc123\?nome=anexos%2Fprint-182748\.png/.test(imgHtml));
  /* `sens`: é dado de cliente, e o modo gravação tem de borrar a miniatura antes de
     qualquer outra coisa desta tela. */
  t("...com `sens`, porque o modo gravação tem de borrar isso", /class="sens"/.test(imgHtml));
  t("...com `alt`, senão a miniatura não existe para quem não vê", /alt="print-182748\.png"/.test(imgHtml));
  /* Um `<img>` sozinho não amplia, e ver o print grande é o que decide se ele
     mandou o certo. */
  t("...dentro de um link para o arquivo em tamanho real",
    /<a class="banx-img" href="\/api\/upgrade\/arquivo\//.test(imgHtml));
  t("...que abre em outra aba sem dar `window.opener` para a página aberta",
    /target="_blank" rel="noopener"/.test(imgHtml));

  const csvHtml = bolha({ anexos: [{ arquivo: "anexos/estoque.csv", nome: "estoque.csv", tipo: "dados", bytes: 900 }] });
  t("o que não é imagem sai como chip com o nome", /banx-chip/.test(csvHtml) && /estoque\.csv/.test(csvHtml));
  t("...e não como `<img>`", !/<img /.test(csvHtml));
  t("...com o nome também `sens`: um nome de arquivo identifica cliente",
    /<span class="sens">estoque\.csv<\/span>/.test(csvHtml));

  /* AUSÊNCIA E LISTA VAZIA LEEM IGUAL, e é a sétima vez que esta base escreve isso:
     conversa gravada antes desta versão não tem o campo, e afirmar "esta mensagem
     não levou anexo" sobre um campo que nunca existiu seria ler ausência como
     negativa. As duas somem sem dizer nada. */
  t("mensagem sem o campo não desenha nada", bolha({ texto: "oi" }) === "");
  t("mensagem com lista vazia também não", bolha({ anexos: [] }) === "");
  t("`null` também não", bolha({ anexos: null }) === "");
  /* Sem `convId` não há rota para montar: desenhar um `<img>` com URL pela metade
     daria o ícone de imagem quebrada, que lê como defeito da tela. */
  t("sem conversa aberta não monta rota nenhuma",
    (() => { S.convId = null; const r = bolha({ anexos: [{ arquivo: "anexos/a.png", nome: "a.png", tipo: "imagem", bytes: 1 }] }); S.convId = "uabc123"; return r === ""; })());
  /* Nome vem de disco, mas passou por `nomeSeguro` — e ainda assim é escapado:
     `flows.html` não tem `esc()` e esta página tem, então não usá-lo aqui seria
     abrir mão de graça. */
  t("o nome é escapado",
    !/<b>/.test(bolha({ anexos: [{ arquivo: "anexos/a.csv", nome: "<b>x</b>.csv", tipo: "dados", bytes: 1 }] })));

  console.log("\n[ 7 ] o ramo do arquivo ausente é um ouvinte, não `onerror` inline");
  /* Um handler dentro de uma string HTML precisa de três níveis de aspas e é onde um
     `esc()` esquecido vira execução; e seriam tantas definições dele quantos anexos
     na tela. */
  t("a bolha não escreve `onerror` inline", !/onerror/.test(bolhaSrc));
  const delSrc = semComentario(pega(h, "function ligarDelegacao() {", "\nasync function confirmarAlvo"));
  t("o ramo existe, delegado no documento", /addEventListener\("error"/.test(delSrc));
  /* EM CAPTURA, e não é escolha: o evento `error` de um `<img>` NÃO borbulha, então
     um ouvinte na bolha nunca seria chamado. */
  /* A JANELA FIXA DE CARACTERES ERA FRAGIL: a frase do handler cresceu e o caso
     ficou vermelho por tamanho, nao por comportamento. Agora ele pega o PRIMEIRO
     terminador `}, <bool>)` depois do ouvinte e exige que ele seja `true` — o que
     nao depende de quantas linhas o corpo tem. */
  t("...em CAPTURA, senão ele nunca é chamado",
    (/addEventListener\("error"[\s\S]*?\},\s*(true|false)\)/.exec(delSrc) || [])[1] === "true");
  t("...e ele troca a miniatura por uma frase, não deixa a imagem quebrada",
    /banx-ido/.test(delSrc) && /não consegui abrir este anexo/.test(delSrc));
  /* A FRASE NAO ACUSA O DISCO. Daqui so se sabe que a imagem nao carregou, e ha
     DUAS causas com decisoes opostas: o scratch foi limpo, ou o cockpit que
     respondeu subiu antes desta versao e nao tem a rota (Node nao recarrega o
     `server.js`). Afirmar a primeira manda ele procurar um arquivo que esta la —
     a mesma classe do `Response.json()` sobre corpo 404, que acusou a instalacao
     do Claude por causa de um processo velho. */
  t("...e nao afirma a causa: as duas ficam no `title`",
    !/textContent = "○ o arquivo deste anexo não está mais no disco"/.test(delSrc)
    && /já foi limpo/.test(delSrc) && /subiu antes desta versão/.test(delSrc));

  /* ───────────────────────────────────────────────────────────────────────── */
  console.log("\n[ 8 ] depois do envio o chip SAI do compositor e vai para a TIRA");
  /* ESTE BLOCO MUDOU DE NOME PORQUE A PREMISSA DELE MORREU. Ele se chamava "o chip
     que fica no compositor depois do envio é EXPLICADO", e o que ele provava era
     uma FRASE: embaixo do campo, depois do envio, uma nota dizia por que o chip
     continuava ali — o anexo é da conversa, não da mensagem, e volta no prompt de
     toda rodada. A frase existia porque o chip ficava.

     A DECISÃO NOVA É MAIS FORTE QUE A FRASE: o chip não fica mais. Ele sobe para a
     TIRA recolhida (`gavetaAnexos`, em `entradas.js`), montada ACIMA do compositor,
     o campo fica limpo, e a explicação foi junto — ela vive no corpo aberto da
     tira, ao lado dos chips que ela explica. MOSTRAR onde o arquivo está bate
     AFIRMAR que ele foi.

     Então o que se afirma aqui agora tem DUAS METADES, e a segunda é a que impede a
     redundância de voltar por descuido:
       (a) a frase da BANDEJA — antes de existir conversa — CONTINUA no compositor,
           porque ali o arquivo ainda VAI, e esse é o momento da dúvida dele ("é
           para aparecer dessa forma?", perguntado olhando exatamente esse estado);
       (b) com a conversa aberta o compositor NÃO carrega mais essa explicação, e a
           TIRA é emitida no lugar dela.
     Afirmar só (a) deixaria a frase antiga voltar para baixo do campo sem nenhum
     teste ficar vermelho — duas redações do mesmo fato a dois centímetros uma da
     outra, e a que divergisse seria a que ninguém releu. Por isso a AUSÊNCIA é
     medida, e não só a presença.

     E ela é medida no DESENHO, não no fonte: "com conversa aberta" é um ESTADO, e a
     única prova de que a frase não está mais lá é pintar esse estado e procurar por
     ela. `compositorHtml` e o bloco de juízo à volta dele são EXTRAÍDOS da página em
     tempo de execução — reimplementá-los aqui provaria a cópia, que é a mesma
     disciplina que este arquivo já segue com `anexosDaBolha` e com a rota. */
  const campoSrc = semComentario(pega(h, "const campo = travado =>", "\n  /* Liberado com ressalva"));
  const tiraSrc  = semComentario(pega(h, "const naConversa = !!S.convId;", "const campo = travado =>"));

  const Sc = { dossie: new Map(), anexosPre: [], subindo: 0, anexoErro: null,
    convId: null, conv: null, rascunho: "", gavetaAnexos: false };
  const usdTxt = v => "US$" + v.toFixed(2).replace(".", ",");
  const juizo = new Function("esc", "usdTxt", "S", "IO",
      pega(h, "const anexosAgora =", "\n/* `Math.round")
    + pega(h, "const AVISO_GLIFO = {", "function pilhaAvisos()")
    + pega(h, "const DOSSIE_FRASE = {", "function faixaDossie(f)")
    + pega(h, "function faixaDossie(f)", "\n/* ------")
    + "; return { compositorHtml };")(esc, usdTxt, Sc, () => entradas);

  const fx = { id: "w1", nome: "Agente Iago" };
  const anxUm = [{ nome: "print-182748.png", arquivo: "anexos/print-182748.png", tipo: "imagem", bytes: 67417, dePasta: false }];
  // Verde para o compositor existir: sem dossiê usável não há campo, e aí não há
  // nada para medir — a trava é assunto do `dossie-tela-test.js`.
  Sc.dossie.set("w1", { cor: "verde", nos: 5, paragrafos: 5, bytes: 100, bytesFluxo: 900, preco: {} });

  Sc.convId = null; Sc.conv = null; Sc.anexosPre = anxUm; Sc.gavetaAnexos = false;
  const cBandeja = juizo.compositorHtml(fx);
  Sc.convId = "u1"; Sc.anexosPre = [];
  Sc.conv = { anexos: anxUm, anexosLidos: [], status: "aguardando" };
  const cConversa = juizo.compositorHtml(fx);
  Sc.gavetaAnexos = true;
  const cAberta = juizo.compositorHtml(fx);
  Sc.gavetaAnexos = false;

  /* (a) A BANDEJA. */
  t("a frase da BANDEJA existe: ali o arquivo AINDA VAI",
    /Vai com a próxima mensagem/.test(cBandeja));
  t("...e ela diz onde o print aparece", /dentro da mensagem/.test(cBandeja));
  /* O chip mudar de lugar no primeiro envio é mais uma coisa acontecendo sem aviso,
     e a frase da bandeja é o único lugar que existe antes do envio para avisar. */
  t("...e ela avisa que depois disso o chip passa para a tira",
    /passam para a tira/.test(cBandeja));
  t("...e sem conversa não há tira: o chip é do pedido que está sendo escrito",
    !/anxgav/.test(cBandeja) && /class="anexos"/.test(cBandeja));

  /* (b) A AUSÊNCIA, que é a metade nova. */
  t("com conversa aberta o compositor não carrega mais a explicação antiga",
    !/ficam com a conversa/i.test(cConversa) && !/voltam no prompt de/.test(cConversa));
  /* E não é só a frase: sem upload em curso e sem recusa, o bloco inteiro que a
     abrigava deixa de existir. O que resta ali é o que pertence ao MOMENTO, não à
     conversa. */
  t("...e o `.cp-anx` nem é emitido: nada de upload, nada de recusa, nada de frase",
    !/cp-anx/.test(cConversa));

  /* ...e a TIRA no lugar dela. */
  t("a tira é emitida no lugar dela, acima do compositor",
    /class="anxgav/.test(cConversa) && /1 anexo nesta conversa/.test(cConversa)
    && cConversa.indexOf("anxgav") < cConversa.indexOf('class="compositor'));
  t("...com o nome do arquivo na linha fechada, que é o que responde «qual print?»",
    /print-182748\.png/.test(cConversa));
  t("...e ela nasce RECOLHIDA: uma linha, com o corpo fora do DOM",
    /aria-expanded="false"/.test(cConversa) && !/anxgav-corpo/.test(cConversa));
  t("...e é o corpo ABERTO que carrega a explicação, ao lado dos chips que ela explica",
    /anxgav-corpo/.test(cAberta) && /voltam no prompt de/.test(cAberta) && /class="anexos"/.test(cAberta));

  /* E o `S.convId` continua sendo o que separa os dois estados: sem ele as duas
     leituras colapsariam numa e o estado voltaria a não ser dito. */
  t("...e é o `S.convId` que separa os dois estados, nos dois lugares",
    /!S\.convId/.test(campoSrc) && /const naConversa = !!S\.convId;/.test(tiraSrc));
} finally {
  fs.rmSync(dirSessao, { recursive: true, force: true });
}

console.log("\n" + (bad ? "FALHOU: " + bad + " de " + (ok + bad) : "passou: " + ok + " casos, e cada um recusa um defeito com nome"));
process.exit(bad ? 1 : 0);
