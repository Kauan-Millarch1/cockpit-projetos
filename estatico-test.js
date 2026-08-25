/* estatico-test.js — o que a negociação de uma resposta estática não pode errar.
 *
 * Cada caso recusa UM defeito com nome. Os que carregam peso:
 *
 *  - o SSE comprimido. Não deixa o painel lento, deixa MUDO: o stream de gzip
 *    segura os bytes até fechar o bloco, e o sintoma é "o cockpit travou" sem nada
 *    no console. É o defeito mais caro que esta camada pode introduzir.
 *  - o `304` que lê o arquivo do disco. O ganho inteiro desta camada é NÃO ler
 *    387KB para responder "não mudou". Um `304` correto que leu o disco tem o
 *    cabeçalho certo e o custo do erro.
 *  - o cache por caminho que guarda duas gerações. Cada save do arquivo vazaria
 *    387KB crus mais o gzip em memória, para sempre.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhum servidor, nada escrito em disco.
 *   node estatico-test.js */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const e = require("./estatico.js");

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (err) { falhas++; console.log("  FALHOU  " + nome + "\n         " + (err && err.message)); }
}
function bloco(nome) { console.log("\n" + nome); }

/* Um arquivo falso com tamanho e mtime declarados, e um `ler` que CONTA quantas
 * vezes foi chamado — é assim que se prova que o `304` não tocou o disco. */
function arquivo({ caminho = "/x/pagina.html", ext = ".html", corpo = "", mtimeMs = 1_700_000_000_123 } = {}) {
  const buf = Buffer.from(corpo, "utf8");
  const conta = { lidas: 0 };
  return {
    arq: { caminho, ext, tamanho: buf.length, mtimeMs },
    ler: () => { conta.lidas++; return buf; },
    conta, buf
  };
}
const GRANDE = "<!doctype html><body>" + "a".repeat(40_000) + "</body>";
const req = (headers = {}, method = "GET") => ({ method, headers });

// ---------------------------------------------------------------- 1. gzip
bloco("1. compressão: quando sim, quando não");

t("página grande com Accept-Encoding: gzip sai comprimida", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({ "accept-encoding": "gzip, deflate, br" }), f.arq, f.ler);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers["content-encoding"], "gzip");
  assert.ok(r.body.length < f.buf.length / 4, "gzip devia cortar bem mais de 75% de HTML repetitivo, veio " + r.body.length);
  assert.strictEqual(zlib.gunzipSync(r.body).toString("utf8"), GRANDE, "o corpo comprimido tem que descomprimir idêntico");
});

t("cliente que não fala gzip recebe os bytes crus", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({}), f.arq, f.ler);
  assert.strictEqual(r.headers["content-encoding"], undefined);
  assert.strictEqual(r.body.length, f.buf.length);
});

t("`gzip;q=0` é RECUSA explícita, não aceite", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({ "accept-encoding": "gzip;q=0, identity" }), f.arq, f.ler);
  assert.strictEqual(r.headers["content-encoding"], undefined, "q=0 significa que o cliente não entende gzip");
});

t("`*` no Accept-Encoding conta como aceite", () => {
  assert.strictEqual(e.aceitaGzip("*"), true);
  assert.strictEqual(e.aceitaGzip("*;q=0"), false);
});

t("arquivo abaixo do piso não é comprimido — o overhead comeria o ganho", () => {
  e.limparCache();
  const f = arquivo({ corpo: "oi" });
  const r = e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  assert.strictEqual(r.headers["content-encoding"], undefined);
  assert.ok(e.MIN_GZIP >= 512, "um piso abaixo de 512 bytes comprime o que não vale");
});

t("PNG não é comprimido: já vem comprimido, gzipar só gasta CPU", () => {
  e.limparCache();
  const f = arquivo({ caminho: "/x/i.png", ext: ".png", corpo: GRANDE });
  const r = e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  assert.strictEqual(r.headers["content-encoding"], undefined);
});

t("SVG é texto e comprime", () => {
  assert.strictEqual(e.comprimivel("image/svg+xml", 5000), true);
});

// ------------------------------------------------------- 2. o SSE, jamais
bloco("2. o SSE não pode ser comprimido — nem por descuido");

t("`text/event-stream` está na lista do NUNCA, separada da lista do que comprime", () => {
  assert.ok(e.NUNCA_COMPRIMIR.has("text/event-stream"));
  assert.ok(!e.COMPRIMIVEL.has("text/event-stream"),
    "estar fora da lista de comprimíveis é a segunda camada, não a primeira");
});

t("comprimivel() recusa event-stream de qualquer tamanho", () => {
  assert.strictEqual(e.comprimivel("text/event-stream", 10), false);
  assert.strictEqual(e.comprimivel("text/event-stream", 10_000_000), false);
  assert.strictEqual(e.comprimivel("text/event-stream; charset=utf-8", 999_999), false);
});

t("a recusa do event-stream não depende do charset nem do caixa alto", () => {
  assert.strictEqual(e.comprimivel("TEXT/EVENT-STREAM; charset=UTF-8", 50_000), false);
});

// ------------------------------------------------- 3. 304 e o disco intocado
bloco("3. o 304, e o disco que ele não toca");

t("ETag que combina devolve 304", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const tag = e.etiqueta(f.arq.tamanho, f.arq.mtimeMs);
  const r = e.negociar(req({ "if-none-match": tag }), f.arq, f.ler);
  assert.strictEqual(r.status, 304);
});

t("o 304 NÃO lê o arquivo do disco — é aqui que está o ganho", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const tag = e.etiqueta(f.arq.tamanho, f.arq.mtimeMs);
  e.negociar(req({ "if-none-match": tag }), f.arq, f.ler);
  assert.strictEqual(f.conta.lidas, 0, "um 304 que leu o disco tem o cabeçalho certo e o custo do erro");
});

t("o 304 não leva corpo nem Content-Length", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({ "if-none-match": e.etiqueta(f.arq.tamanho, f.arq.mtimeMs) }), f.arq, f.ler);
  assert.strictEqual(r.body, null);
  assert.strictEqual(r.headers["content-length"], undefined, "304 com Content-Length trava cliente");
});

t("ETag de OUTRA versão não vale 304", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const outra = e.etiqueta(f.arq.tamanho + 1, f.arq.mtimeMs);
  const r = e.negociar(req({ "if-none-match": outra }), f.arq, f.ler);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(f.conta.lidas, 1);
});

t("a comparação de ETag é fraca: W/\"x\" e \"x\" são a mesma entidade", () => {
  assert.strictEqual(e.combina('"abc"', 'W/"abc"'), true);
  assert.strictEqual(e.combina('W/"abc"', 'W/"abc"'), true);
  assert.strictEqual(e.combina('"abd"', 'W/"abc"'), false);
});

t("lista de ETags e `*` são aceitos", () => {
  assert.strictEqual(e.combina('"a", W/"b", "c"', 'W/"b"'), true);
  assert.strictEqual(e.combina("*", 'W/"qualquer"'), true);
});

t("If-Modified-Since vale quando não há If-None-Match", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const depois = new Date(f.arq.mtimeMs + 5000).toUTCString();
  const r = e.negociar(req({ "if-modified-since": depois }), f.arq, f.ler);
  assert.strictEqual(r.status, 304);
  assert.strictEqual(f.conta.lidas, 0);
});

t("If-Modified-Since anterior ao mtime devolve 200", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const antes = new Date(f.arq.mtimeMs - 10_000).toUTCString();
  const r = e.negociar(req({ "if-modified-since": antes }), f.arq, f.ler);
  assert.strictEqual(r.status, 200);
});

t("If-Modified-Since tem resolução de SEGUNDO — o mtime é truncado antes de comparar", () => {
  /* Sem o truncamento, um arquivo cujo mtime tem 123ms nunca casa com o
   * cabeçalho que o próprio servidor mandou (que só carrega o segundo), e a
   * página volta 200 para sempre — o cache existe e não serve para nada. */
  const mtimeMs = 1_700_000_000_999;
  const cabecalho = new Date(Math.floor(mtimeMs / 1000) * 1000).toUTCString();
  assert.strictEqual(e.naoModificadoDesde(cabecalho, mtimeMs), true);
});

t("If-None-Match presente e errado GANHA de um If-Modified-Since que casaria", () => {
  /* O cliente mandou os dois; o ETag é o discriminador mais forte e é o que a
   * especificação manda obedecer. Deixar o date decidir devolveria 304 para
   * conteúdo que o cliente não tem. */
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({
    "if-none-match": 'W/"nada-a-ver"',
    "if-modified-since": new Date(f.arq.mtimeMs + 5000).toUTCString()
  }), f.arq, f.ler);
  assert.strictEqual(r.status, 200);
});

t("data ilegível em If-Modified-Since não vira 304", () => {
  assert.strictEqual(e.naoModificadoDesde("ontem à noite", Date.now()), false);
  assert.strictEqual(e.naoModificadoDesde("", Date.now()), false);
});

// ------------------------------------------------------------ 4. cabeçalhos
bloco("4. os cabeçalhos que precisam estar lá");

t("Vary: Accept-Encoding sai SEMPRE, inclusive quando não comprimiu", () => {
  e.limparCache();
  const f = arquivo({ corpo: "curto" });
  const r = e.negociar(req({}), f.arq, f.ler);
  assert.strictEqual(r.headers["vary"], "Accept-Encoding",
    "sem Vary, um proxy entrega a versão comprimida a quem não aceita gzip");
});

t("Vary sai também no 304", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({ "if-none-match": e.etiqueta(f.arq.tamanho, f.arq.mtimeMs) }), f.arq, f.ler);
  assert.strictEqual(r.headers["vary"], "Accept-Encoding");
});

t("Cache-Control é `no-cache`, nunca `max-age`", () => {
  /* `no-cache` é "guarde e pergunte antes de usar". `max-age` deixaria o
   * navegador servir HTML velho sem perguntar — o defeito do processo antigo
   * servindo rota antiga, que este repositório já pagou três vezes. */
  assert.strictEqual(e.CACHE_HTML, "no-cache");
  assert.ok(!/max-age/.test(e.CACHE_HTML), "max-age aqui é página desatualizada sem aviso");
});

t("ETag e Last-Modified saem no 200 e no 304", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const a = e.negociar(req({}), f.arq, f.ler);
  const b = e.negociar(req({ "if-none-match": a.headers.etag }), f.arq, f.ler);
  for (const r of [a, b]) {
    assert.ok(r.headers.etag, "sem ETag não há revalidação");
    assert.ok(r.headers["last-modified"], "sem Last-Modified o cliente sem ETag não tem como perguntar");
  }
  assert.strictEqual(b.status, 304);
});

t("Content-Length é o tamanho do que FOI enviado, não do arquivo", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  assert.strictEqual(Number(r.headers["content-length"]), r.body.length);
  assert.notStrictEqual(Number(r.headers["content-length"]), f.buf.length,
    "o comprimido é menor que o arquivo; anunciar o tamanho do arquivo trava o cliente");
});

t("o Content-Type vem da extensão, e o desconhecido não vira text/html", () => {
  assert.match(e.tipoDe(".html"), /^text\/html/);
  assert.match(e.tipoDe(".js"), /javascript/);
  assert.match(e.tipoDe(".json"), /json/);
  assert.strictEqual(e.tipoDe(".xyz"), "application/octet-stream");
  assert.strictEqual(e.tipoDe(undefined), "application/octet-stream");
});

t("HEAD leva os cabeçalhos e nenhum corpo", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({ "accept-encoding": "gzip" }, "HEAD"), f.arq, f.ler);
  assert.strictEqual(r.body, null);
  assert.ok(Number(r.headers["content-length"]) > 0, "HEAD sem Content-Length mente sobre o tamanho");
});

// ---------------------------------------------------------------- 5. cache
bloco("5. o cache é por mtime, e guarda uma geração só");

t("a segunda chamada não relê o disco nem re-gzipa", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const a = e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  const b = e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  assert.strictEqual(f.conta.lidas, 1, "o disco devia ter sido lido uma vez só");
  assert.strictEqual(a.doCache, false);
  assert.strictEqual(b.doCache, true);
  assert.deepStrictEqual(b.body, a.body);
});

t("editar o arquivo (mtime novo) invalida — nada de TTL", () => {
  e.limparCache();
  const f1 = arquivo({ corpo: GRANDE, mtimeMs: 1_700_000_000_000 });
  e.negociar(req({ "accept-encoding": "gzip" }), f1.arq, f1.ler);
  const f2 = arquivo({ corpo: GRANDE + "<!--v2-->", mtimeMs: 1_700_000_001_000 });
  const r = e.negociar(req({ "accept-encoding": "gzip" }), f2.arq, f2.ler);
  assert.strictEqual(f2.conta.lidas, 1, "mtime novo tem que reler");
  assert.strictEqual(r.doCache, false);
  assert.ok(zlib.gunzipSync(r.body).toString("utf8").includes("<!--v2-->"), "servir a versão antiga é a mentira que o TTL causaria");
});

t("o mesmo caminho guarda UMA geração — editar não vaza a anterior", () => {
  /* O corpo tem que ter SEMPRE o mesmo tamanho: a chave do cache é
   * (caminho, tamanho, mtime), então variar o tamanho junto com o mtime troca a
   * chave por dois motivos e o teste passa mesmo sem evicção — foi o que um
   * mutante provou. Aqui só o mtime muda, e a sonda final repete exatamente a
   * primeira geração: se ela ainda estiver em memória, `doCache` vem true. */
  e.limparCache();
  const corpo = i => GRANDE + String(i).padStart(4, "0");
  for (let i = 0; i < 30; i++) {
    const f = arquivo({ corpo: corpo(i), mtimeMs: 1_700_000_000_000 + i * 1000 });
    e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  }
  const f = arquivo({ corpo: corpo(0), mtimeMs: 1_700_000_000_000 });
  const r = e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  assert.strictEqual(r.doCache, false, "a geração de 30 saves atrás não podia estar viva em memória");
  assert.strictEqual(f.conta.lidas, 1, "a geração antiga expulsa tem que ser relida, não servida de memória");
});

t("caminhos diferentes convivem no cache", () => {
  e.limparCache();
  const a = arquivo({ caminho: "/x/a.html", corpo: GRANDE });
  const b = arquivo({ caminho: "/x/b.html", corpo: GRANDE });
  e.negociar(req({ "accept-encoding": "gzip" }), a.arq, a.ler);
  e.negociar(req({ "accept-encoding": "gzip" }), b.arq, b.ler);
  e.negociar(req({ "accept-encoding": "gzip" }), a.arq, a.ler);
  assert.strictEqual(a.conta.lidas, 1, "b não podia ter expulsado a");
});

t("o cliente sem gzip aproveita o buffer cru já guardado", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  e.negociar(req({ "accept-encoding": "gzip" }), f.arq, f.ler);
  const r = e.negociar(req({}), f.arq, f.ler);
  assert.strictEqual(f.conta.lidas, 1);
  assert.strictEqual(r.body.length, f.buf.length);
});

t("a chave do cache é JSON.stringify de um array, nunca concatenação", () => {
  /* Chave composta escrita à mão já falhou em silêncio duas vezes neste
   * repositório (U+0000 e U+001F como separador). Um caminho que contenha o
   * separador colidiria com outro arquivo. */
  e.limparCache();
  const a = arquivo({ caminho: '/x/a"-1000.html', corpo: GRANDE });
  const b = arquivo({ caminho: '/x/a', corpo: GRANDE + "b" });
  e.negociar(req({}), a.arq, a.ler);
  e.negociar(req({}), b.arq, b.ler);
  const r = e.negociar(req({}), a.arq, a.ler);
  assert.strictEqual(r.doCache, true, "dois caminhos esquisitos não podem colidir numa chave");
  const fonte = fs.readFileSync(path.join(__dirname, "estatico.js"), "utf8");
  assert.ok(/JSON\.stringify\(\[caminho/.test(fonte), "a chave tem que ser JSON.stringify de array");
});

// ------------------------------------------------- 6. as páginas de verdade
bloco("6. medido nas quatro páginas servidas");

t("as quatro páginas e o aba.js encolhem para menos de um terço no total", () => {
  /* Os tetos são o que foi MEDIDO, com folga — não um número redondo escolhido.
   * Por arquivo o teto é frouxo (40%) porque `aba.js` é JS denso e comprime pior
   * que HTML (37,2% medido); o teto que importa é o do TOTAL, porque é ele que
   * diz quanto o navegador deixa de baixar ao trocar de tela. */
  const alvos = ["flows.html", "tester.html", "upgrade.html", "cockpit.html", "aba.js"];
  const linhas = [];
  let cruTotal = 0, zipTotal = 0;
  for (const nome of alvos) {
    const p = path.join(__dirname, nome);
    if (!fs.existsSync(p)) { linhas.push("       " + nome + ": ausente"); continue; }
    const cru = fs.readFileSync(p);
    const zip = zlib.gzipSync(cru, { level: e.NIVEL });
    const razao = zip.length / cru.length;
    cruTotal += cru.length; zipTotal += zip.length;
    linhas.push("       " + nome.padEnd(13) + String(cru.length).padStart(7) + " → " + String(zip.length).padStart(6) + "  (" + (razao * 100).toFixed(1) + "%)");
    assert.ok(razao < 0.40, nome + " comprimiu só para " + (razao * 100).toFixed(1) + "%, esperado abaixo de 40%");
  }
  const total = zipTotal / cruTotal;
  linhas.push("       " + "TOTAL".padEnd(13) + String(cruTotal).padStart(7) + " → " + String(zipTotal).padStart(6) + "  (" + (total * 100).toFixed(1) + "%)");
  console.log(linhas.join("\n"));
  assert.ok(total < 0.35, "no total comprimiu para " + (total * 100).toFixed(1) + "%, esperado abaixo de 35%");
});

t("o gzip das cinco custa menos de 400ms no total, e é pago uma vez por edição", () => {
  const t0 = Date.now();
  let bytes = 0;
  for (const nome of ["flows.html", "tester.html", "upgrade.html", "cockpit.html", "aba.js"]) {
    const p = path.join(__dirname, nome);
    if (!fs.existsSync(p)) continue;
    bytes += zlib.gzipSync(fs.readFileSync(p), { level: e.NIVEL }).length;
  }
  const ms = Date.now() - t0;
  console.log("       " + ms + "ms para comprimir as cinco, " + bytes + " bytes servidos");
  assert.ok(ms < 400, "comprimir as cinco levou " + ms + "ms — acima disso o cache por mtime não salva o primeiro request depois de editar");
});

bloco("8. cabecalhos de seguranca -- nao existia nenhum em resposta nenhuma");

t("frame-ancestors 'none' sai numa resposta 200", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const r = e.negociar(req({}), f.arq, f.ler);
  assert.strictEqual(r.headers["content-security-policy"], "frame-ancestors 'none'");
});

t("...e no 304 tambem, que e a resposta MAIS comum na volta a mesma tela", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const tag = e.etiqueta(f.arq.tamanho, f.arq.mtimeMs);
  const r = e.negociar(req({ "if-none-match": tag }), f.arq, f.ler);
  assert.strictEqual(r.status, 304);
  assert.strictEqual(r.headers["content-security-policy"], "frame-ancestors 'none'",
    "um frame-ancestors que so sai no 200 protege a primeira visita e deixa todas as outras descobertas");
});

t("x-frame-options acompanha, para o browser que ignora CSP", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  assert.strictEqual(e.negociar(req({}), f.arq, f.ler).headers["x-frame-options"], "DENY");
});

t("nosniff e referrer-policy saem juntos", () => {
  e.limparCache();
  const f = arquivo({ corpo: GRANDE });
  const h = e.negociar(req({}), f.arq, f.ler).headers;
  assert.strictEqual(h["x-content-type-options"], "nosniff");
  assert.strictEqual(h["referrer-policy"], "no-referrer");
});

t("a CSP NAO declara script-src -- politica com unsafe-inline nao protege nada", () => {
  assert.ok(!/script-src/.test(e.SEGURANCA["content-security-policy"]),
    "as quatro paginas tem o JS inline; ver o comentario do SEGURANCA antes de mexer");
});

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + (ok + falhas)
  : "passou: " + ok + " ok, 0 falha(s)"));
process.exit(falhas ? 1 : 0);
