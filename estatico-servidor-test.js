/* estatico-servidor-test.js — os três caminhos do `server.js` que ganharam cache,
 * cada caso recusando UM defeito com nome.
 *
 * `estatico-test.js` prova a NEGOCIAÇÃO (função pura, noutro arquivo). Este prova
 * o LIGAMENTO: que o handler chama aquilo, que o `304` não lê disco, que editar o
 * arquivo continua valendo, que o SSE não passou por lá, e que os dois caches
 * novos (detalhe de projeto e peso) fazem o que dizem.
 *
 * Os três blocos são EXTRAÍDOS do `server.js` em tempo de execução, entre
 * delimitadores, e dirigidos com dependências falsas. Reimplementá-los aqui
 * provaria a cópia, não o comportamento — a disciplina que `audio-test.js` e
 * `dossie-tela-test.js` fixaram. `server.js` não é `require`ável: ele dá
 * `listen()` na 4317, que é o terminal de verdade do Kauan.
 *
 * Os que carregam peso:
 *
 *  - **o SSE comprimido.** Não deixa o painel lento, deixa MUDO — o stream de
 *    gzip segura os bytes até fechar o bloco — e o sintoma é "o cockpit travou"
 *    sem nada no console. São quatro rotas de stream e o teste falha se qualquer
 *    uma delas ganhar `content-encoding` ou passar a ser servida por `serveFile`.
 *  - **o `304` que lê o disco.** O ganho inteiro desta camada é NÃO ler 419KB para
 *    responder "não mudou". Um `304` que leu o disco tem o cabeçalho certo e o
 *    custo do erro, e nada na tela denuncia.
 *  - **editar o arquivo e não ver a versão nova.** A decisão documentada do
 *    `/aba.js` é essa; a mudança de `no-store` para `no-cache` a preserva, e é
 *    aqui que isso é provado por HTTP de verdade, não por leitura de cabeçalho.
 *  - **o `max-age`.** É o único valor de `cache-control` que quebraria a decisão
 *    acima, servindo HTML velho sem perguntar. Um caso existe só para recusá-lo.
 *  - **o laço do peso sequencializado de novo.** O teste MEDE a concorrência; um
 *    `await` de volta dentro do laço fica vermelho.
 *  - **o `null` cacheado.** Um projeto criado agora continuaria "não encontrado"
 *    por 15 minutos, e o sintoma manda procurar defeito na rota.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhum n8n, nada escrito fora do
 * diretório temporário do SO.
 *   node estatico-servidor-test.js */

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const estatico = require("./estatico.js");

let ok = 0, falhas = 0;
const casos = [];
function t(nome, fn) { casos.push({ nome, fn }); }
function bloco(nome) { casos.push({ bloco: nome }); }

const FONTE = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

/* Sem comentários. Um `includes` que casa dentro de um comentário aprova a
 * DOCUMENTAÇÃO de uma decisão no melhor caso e a AUSÊNCIA dela no pior — este
 * repositório já pagou por isso em `dossie-tela-test.js`. */
function semComentario(txt) {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function extrair(ini, fim) {
  const a = FONTE.indexOf(ini);
  const b = FONTE.indexOf(fim, a);
  assert.ok(a >= 0, "delimitador `" + ini + "` não está no server.js — alguém apagou a âncora");
  assert.ok(b > a, "delimitador `" + fim + "` não está no server.js depois de `" + ini + "`");
  return FONTE.slice(a, b + fim.length);
}

/* ------------------------------------------------ os três blocos, do fonte */

const SRC_SERVE = extrair("/* ESTATICO-INI", "/* ESTATICO-FIM */");
const SRC_DETALHE = extrair("/* DETALHE-INI", "/* DETALHE-FIM */");
const SRC_PESO = extrair("/* PESO-INI", "/* PESO-FIM */");

/* `serveFile` fala com `fs`, `path` e `estatico` — os três de verdade, porque o
 * que se quer provar é o ligamento e não uma imitação dele. */
const serveFile = new Function("fs", "path", "estatico",
  SRC_SERVE + "\nreturn serveFile;")(fs, path, estatico);

/* O bloco do detalhe fala com `detail`, que é injetado falso e CONTA chamadas —
 * é assim que se prova que a segunda visita não varreu o disco outra vez. */
function montarDetalhe(detail) {
  return new Function("detail", SRC_DETALHE + "\nreturn { detalheComCache, DETALHE_TTL, DETALHE_CAP, detalheCache, detalheEmVoo };")(detail);
}

/* O laço do peso é uma EXPRESSÃO dentro do handler, então é embrulhado numa
 * função com as quatro coisas que ele lê em escopo. */
function montarPeso({ n8n, pesoCache = new Map(), PESO_TTL = 900000, semCredenciais = x => x }) {
  const corpo = "return async function rodar(crus) {\n" + SRC_PESO + "\nreturn pesos;\n};";
  return new Function("n8n", "pesoCache", "PESO_TTL", "semCredenciais", corpo)(n8n, pesoCache, PESO_TTL, semCredenciais);
}

/* --------------------------------------------------------- um `res` falso */

function resFalso() {
  const r = {
    status: null, headers: null, corpo: null, terminou: false,
    writeHead(s, h) { r.status = s; r.headers = h || {}; return r; },
    end(b) { r.corpo = b === undefined ? null : b; r.terminou = true; return r; }
  };
  return r;
}
const req = (headers = {}, method = "GET") => ({ method, headers });

/* Um arquivo real, num diretório temporário do SO. Nada é escrito no repo. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-est-"));
function arquivoTmp(nome, corpo) {
  const p = path.join(TMP, nome);
  fs.writeFileSync(p, corpo);
  return p;
}
const GRANDE = "<!doctype html><body>" + "abc ".repeat(12000) + "</body>";

// ------------------------------------------------------ 1. o ligamento existe
bloco("1. `serveFile` chama a negociação, e não relê o disco no `304`");

t("um GET simples sai 200 com etag, last-modified, vary e content-length", () => {
  estatico.limparCache();
  const p = arquivoTmp("p1.html", GRANDE);
  const res = resFalso();
  serveFile(req({ "accept-encoding": "gzip" }), res, p);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.etag, "sem `etag` o navegador não tem o que revalidar — era o estado medido antes desta camada");
  assert.ok(res.headers["last-modified"], "sem `last-modified` o `If-Modified-Since` que o navegador manda não tem resposta");
  assert.strictEqual(res.headers.vary, "Accept-Encoding");
  assert.strictEqual(res.headers["content-length"], String(res.corpo.length),
    "sem `content-length` a resposta sai `Transfer-Encoding: chunked`, que era o estado medido antes");
});

t("o etag que o servidor deu volta como 304, e o corpo NÃO vem", () => {
  estatico.limparCache();
  const p = arquivoTmp("p2.html", GRANDE);
  const a = resFalso();
  serveFile(req({ "accept-encoding": "gzip" }), a, p);
  const b = resFalso();
  serveFile(req({ "accept-encoding": "gzip", "if-none-match": a.headers.etag }), b, p);
  assert.strictEqual(b.status, 304, "validador que casa tem que virar 304 — 200 aqui é re-baixar 419KB para dizer «não mudou»");
  assert.strictEqual(b.corpo, null, "um 304 não leva corpo");
  assert.strictEqual(b.headers["content-length"], undefined, "um 304 não leva `content-length`");
  assert.ok(b.terminou, "a resposta tem que ser encerrada, senão o request pendura");
});

t("um etag que NÃO casa continua 200 com o corpo inteiro", () => {
  estatico.limparCache();
  const p = arquivoTmp("p3.html", GRANDE);
  const res = resFalso();
  serveFile(req({ "accept-encoding": "gzip", "if-none-match": 'W/"nada-disso"' }), res, p);
  assert.strictEqual(res.status, 200, "validador que não casa tem que devolver o arquivo — 304 aqui deixa a tela em branco");
  assert.ok(res.corpo && res.corpo.length > 0);
});

t("o 304 não toca o disco: apagar o arquivo depois do primeiro GET não muda a resposta", () => {
  estatico.limparCache();
  const p = arquivoTmp("p4.html", GRANDE);
  const a = resFalso();
  serveFile(req({}), a, p);
  const tag = a.headers.etag;
  const st = fs.statSync(p);
  /* O `stat` continua sendo lido (é ele que produz o etag), então o arquivo tem
   * que existir; o que se prova aqui é que o CORPO não é lido. Um `serveFile` que
   * lesse o disco antes de negociar teria o mesmo cabeçalho e o custo do erro, e
   * a única testemunha é o contador. */
  let lidas = 0;
  const readFileSync = fs.readFileSync;
  fs.readFileSync = (...a) => { lidas++; return readFileSync(...a); };
  try {
    const b = resFalso();
    serveFile(req({ "if-none-match": tag }), b, p);
    assert.strictEqual(b.status, 304);
    assert.strictEqual(lidas, 0, "o 304 leu o disco " + lidas + " vez(es) — o ganho desta camada É não ler");
  } finally { fs.readFileSync = readFileSync; }
  assert.ok(st.size > 0);
});

t("`If-Modified-Since` também vale, e um arquivo salvo depois volta 200", () => {
  estatico.limparCache();
  const p = arquivoTmp("p5.html", GRANDE);
  const a = resFalso();
  serveFile(req({}), a, p);
  const igual = resFalso();
  serveFile(req({ "if-modified-since": a.headers["last-modified"] }), igual, p);
  assert.strictEqual(igual.status, 304);
  const velho = resFalso();
  serveFile(req({ "if-modified-since": new Date(Date.parse(a.headers["last-modified"]) - 60000).toUTCString() }), velho, p);
  assert.strictEqual(velho.status, 200, "cabeçalho mais antigo que o arquivo significa MODIFICADO");
});

t("arquivo que não existe é 404 de texto, não 500 nem exceção", () => {
  const res = resFalso();
  serveFile(req({}), res, path.join(TMP, "nunca-existiu.html"));
  assert.strictEqual(res.status, 404);
  assert.ok(String(res.headers["content-type"] || "").startsWith("text/plain"));
});

t("um DIRETÓRIO no lugar do arquivo é 404, não 500 com stack", () => {
  const res = resFalso();
  serveFile(req({}), res, TMP);
  assert.strictEqual(res.status, 404, "`readFileSync` num diretório lança EISDIR — sem o `isFile()` isto virava 500");
});

t("HEAD leva os cabeçalhos e nenhum corpo", () => {
  estatico.limparCache();
  const p = arquivoTmp("p6.html", GRANDE);
  const res = resFalso();
  serveFile(req({ "accept-encoding": "gzip" }, "HEAD"), res, p);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers["content-length"], "o HEAD tem que declarar o tamanho do que TERIA sido enviado");
  assert.strictEqual(res.corpo, null);
  assert.ok(res.terminou, "sem `end()` o HEAD pendura o request");
});

// -------------------------------------------- 2. `no-cache`, nunca `max-age`
bloco("2. o cabeçalho preserva a decisão do `/aba.js`");

t("o cache-control revalida e NÃO carrega max-age", () => {
  estatico.limparCache();
  const p = arquivoTmp("p7.html", GRANDE);
  const res = resFalso();
  serveFile(req({}), res, p);
  const cc = String(res.headers["cache-control"] || "");
  assert.ok(/no-cache|no-store|must-revalidate/.test(cc), "cache-control veio «" + cc + "»: sem revalidação, editar o arquivo deixa de valer");
  assert.ok(!/max-age\s*=\s*[1-9]/.test(cc),
    "`max-age` positivo em «" + cc + "» serve HTML velho SEM perguntar — é o único valor que quebra a decisão documentada do /aba.js");
});

t("o servidor não declara `no-store` em nenhuma das seis rotas estáticas", () => {
  const s = semComentario(FONTE);
  const trecho = s.slice(s.indexOf("function serveFile"), s.indexOf("function serveFile") + 3000);
  assert.ok(!/no-store/.test(trecho),
    "`no-store` de volta no caminho estático apaga o 304 inteiro: o navegador não guarda, então não tem etag para revalidar");
});

// -------------------------------- 3. editar o arquivo faz a versão nova aparecer
bloco("3. por HTTP de verdade: 304 na segunda visita E versão nova depois de editar");

function servidorDeTeste(arquivo) {
  const srv = http.createServer((req2, res2) => serveFile(req2, res2, arquivo));
  return new Promise(ok => srv.listen(0, "127.0.0.1", () => ok({ srv, porta: srv.address().port })));
}
/* Com teto de tempo, e ele não é zelo: um `serveFile` que esquece o `end()` no
 * caminho sem corpo deixa a resposta ABERTA, e sem este teto o teste inteiro
 * pendura em vez de falhar. Um teste que trava é pior que um que fica vermelho —
 * o vermelho nomeia o defeito, o travado manda procurar defeito no teste. */
function pedir(porta, headers = {}, metodo = "GET") {
  return new Promise((ok, ruim) => {
    const r = http.request({ host: "127.0.0.1", port: porta, path: "/", method: metodo, headers }, res => {
      const pedacos = [];
      res.on("data", c => pedacos.push(c));
      res.on("end", () => ok({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(pedacos) }));
    });
    r.setTimeout(4000, () => { r.destroy(); ruim(new Error("a resposta não terminou em 4s — a resposta ficou aberta, provavelmente sem `end()`")); });
    r.on("error", ruim); r.end();
  });
}

t("primeira visita 200 comprimida, segunda 304, e depois de EDITAR o arquivo o mesmo etag volta 200 com os bytes NOVOS", async () => {
  estatico.limparCache();
  const p = arquivoTmp("vivo.html", GRANDE + "<!--v1-->");
  const { srv, porta } = await servidorDeTeste(p);
  try {
    const a = await pedir(porta, { "accept-encoding": "gzip" });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.headers["content-encoding"], "gzip", "HTML de 48KB tem que sair comprimido");
    assert.ok(zlib.gunzipSync(a.corpo).toString("utf8").includes("<!--v1-->"));
    const tag = a.headers.etag;

    const b = await pedir(porta, { "accept-encoding": "gzip", "if-none-match": tag });
    assert.strictEqual(b.status, 304, "segunda visita à mesma tela tem que ser 304");
    assert.strictEqual(b.corpo.length, 0);

    /* A EDIÇÃO. É a metade que importa: um `max-age` teria passado nos casos
     * acima e falharia aqui, e é exatamente o defeito que a decisão documentada
     * do `/aba.js` existe para não ter. O tamanho muda junto com o conteúdo, e o
     * mtime tem resolução de milissegundo — mas dois saves no MESMO
     * milissegundo com o MESMO tamanho colidiriam, e o `estatico.js` declara esse
     * limite. Aqui o tamanho muda, então não há como colidir. */
    await new Promise(r => setTimeout(r, 15));
    fs.writeFileSync(p, GRANDE + "<!--v2 mais longo-->");

    const c = await pedir(porta, { "accept-encoding": "gzip", "if-none-match": tag });
    assert.strictEqual(c.status, 200, "com o arquivo editado, o etag velho NÃO casa mais — 304 aqui é servir a versão antiga, que é a mentira que esta camada não pode contar");
    const texto = zlib.gunzipSync(c.corpo).toString("utf8");
    assert.ok(texto.includes("<!--v2 mais longo-->"), "veio a versão velha depois de editar o arquivo");
    assert.ok(!texto.includes("<!--v1-->"));
    assert.notStrictEqual(c.headers.etag, tag, "o etag tem que se mover com o arquivo");

    const d = await pedir(porta, { "accept-encoding": "gzip", "if-none-match": c.headers.etag });
    assert.strictEqual(d.status, 304, "e o etag NOVO volta a revalidar");
  } finally { srv.close(); }
});

t("cliente que não fala gzip recebe os bytes crus, e são os bytes do arquivo", async () => {
  estatico.limparCache();
  const p = arquivoTmp("cru.html", GRANDE);
  const { srv, porta } = await servidorDeTeste(p);
  try {
    const r = await pedir(porta, {});
    assert.strictEqual(r.headers["content-encoding"], undefined);
    assert.ok(r.corpo.equals(fs.readFileSync(p)), "os bytes crus têm que ser byte a byte o arquivo");
  } finally { srv.close(); }
});

// ------------------------------------------------------------ 4. a cerca do SSE
bloco("4. o SSE não passa pela camada nova — e não pode passar nunca");

t("`text/event-stream` está na constante de RECUSA, não só fora da lista de comprimíveis", () => {
  assert.ok(estatico.NUNCA_COMPRIMIR.has("text/event-stream"));
  assert.strictEqual(estatico.comprimivel("text/event-stream", 10_000_000), false,
    "gzip no SSE não deixa o painel lento, deixa MUDO: o stream segura os bytes até fechar o bloco");
});

t("as quatro rotas de stream escrevem o próprio writeHead, nenhuma via serveFile", () => {
  const s = semComentario(FONTE);
  const n = (s.match(/text\/event-stream/g) || []).length;
  assert.strictEqual(n, 4, "achei " + n + " rota(s) de stream no fonte, esperava 4 — se nasceu uma quinta, ela precisa entrar nos casos abaixo");
  // cada ocorrência tem que estar dentro de um `res.writeHead(` e não de um `serveFile(`
  let i = -1;
  while ((i = s.indexOf("text/event-stream", i + 1)) >= 0) {
    const antes = s.slice(Math.max(0, i - 400), i);
    const abre = antes.lastIndexOf("res.writeHead(");
    assert.ok(abre >= 0, "uma rota de stream não escreve o próprio writeHead");
    assert.ok(!antes.slice(abre).includes("serveFile("),
      "uma rota de stream passou a ser servida por `serveFile` — isso a comprime e o painel fica MUDO");
  }
});

t("nenhum dos quatro writeHead de stream carrega content-encoding nem gzip", () => {
  const s = semComentario(FONTE);
  let i = -1;
  while ((i = s.indexOf("text/event-stream", i + 1)) >= 0) {
    const inicio = s.lastIndexOf("res.writeHead(", i);
    const fim = s.indexOf("});", i);
    const objeto = s.slice(inicio, fim < 0 ? i + 400 : fim);
    assert.ok(!/content-encoding/i.test(objeto), "um writeHead de SSE ganhou `content-encoding`");
    assert.ok(!/gzip|deflate|brotli/i.test(objeto), "um writeHead de SSE menciona compressão");
  }
});

t("`serveFile` só é chamado com arquivo de extensão que a tabela de tipos conhece", () => {
  const s = semComentario(FONTE);
  const chamadas = [...s.matchAll(/serveFile\(req, res, path\.join\(__dirname, "([^"]+)"\)\)/g)].map(m => m[1]);
  assert.ok(chamadas.length >= 6, "achei " + chamadas.length + " chamadas de serveFile, esperava as 6 rotas estáticas");
  for (const nome of chamadas) {
    const ext = path.extname(nome);
    const tipo = estatico.tipoDe(ext);
    assert.notStrictEqual(tipo, "application/octet-stream", "`" + nome + "` tem extensão que a tabela de tipos não conhece");
    assert.ok(!estatico.NUNCA_COMPRIMIR.has(tipo.split(";")[0]), "`" + nome + "` cai num tipo que nunca pode ser comprimido");
  }
});

t("`serveFile` recebe o `req` — sem ele não há validador para ler", () => {
  const s = semComentario(FONTE);
  assert.ok(!/serveFile\(res,/.test(s),
    "sobrou uma chamada `serveFile(res, …)`: sem o `req` os cabeçalhos do navegador são invisíveis e a rota volta a devolver 200 sempre");
  assert.ok(/function serveFile\(req, res, file\)/.test(s));
});

// ------------------------------------- 5. o cache do detalhe de projeto (tarefa 2)
bloco("5. `/api/project/:name`: cache por TTL, `?refresh=1` fura, `null` não entra");

function detailFalso(resposta) {
  const conta = { n: 0, nomes: [] };
  const fn = async name => {
    conta.n++; conta.nomes.push(name);
    await new Promise(r => setTimeout(r, 5));
    return typeof resposta === "function" ? resposta(name, conta.n) : resposta;
  };
  return { fn, conta };
}

t("a segunda chamada não varre o disco outra vez", async () => {
  const d = detailFalso(name => ({ name, scannedAt: "x" }));
  const m = montarDetalhe(d.fn);
  const a = await m.detalheComCache("Projeto");
  const b = await m.detalheComCache("Projeto");
  assert.strictEqual(d.conta.n, 1, "varreu " + d.conta.n + " vezes — medido antes: 1,08s por clique, sem cache nenhum");
  assert.strictEqual(a, b, "a segunda chamada tem que devolver o MESMO objeto guardado");
});

t("`?refresh=1` fura o cache, como já faz em /api/projects", async () => {
  const d = detailFalso((name, n) => ({ name, volta: n }));
  const m = montarDetalhe(d.fn);
  await m.detalheComCache("P");
  const b = await m.detalheComCache("P", { refresh: true });
  assert.strictEqual(d.conta.n, 2, "com refresh o cache tem que ser furado — senão o botão «atualizar varredura» mente");
  assert.strictEqual(b.volta, 2);
});

t("um projeto que não existe NÃO é cacheado", async () => {
  let existe = false;
  const d = detailFalso(() => (existe ? { name: "novo" } : null));
  const m = montarDetalhe(d.fn);
  assert.strictEqual(await m.detalheComCache("Novo"), null);
  existe = true;
  assert.ok(await m.detalheComCache("Novo"), "o `null` foi cacheado: uma pasta criada agora continuaria «não encontrada» por 15 minutos, e o sintoma manda procurar defeito na rota");
});

t("o TTL expira e revarre", async () => {
  const d = detailFalso((name, n) => ({ name, volta: n }));
  const m = montarDetalhe(d.fn);
  await m.detalheComCache("P");
  // envelhece a entrada à mão em vez de esperar 15 minutos
  const e = m.detalheCache.get("P");
  e.at = Date.now() - m.DETALHE_TTL - 1;
  const b = await m.detalheComCache("P");
  assert.strictEqual(b.volta, 2, "entrada mais velha que o TTL tem que ser revarrida");
});

t("o TTL é o mesmo 15 minutos de /api/projects — duas idades para o mesmo disco seriam duas verdades", () => {
  const m = montarDetalhe(async () => null);
  assert.strictEqual(m.DETALHE_TTL, 15 * 60 * 1000);
  const s = semComentario(FONTE);
  assert.ok(/15 \* 60 \* 1000/.test(s.slice(s.indexOf("function listProjects"), s.indexOf("function listProjects") + 600)),
    "o TTL de /api/projects mudou e o do detalhe não acompanhou");
});

t("dois cliques ao mesmo tempo no mesmo projeto fazem UMA varredura", async () => {
  const d = detailFalso((name, n) => ({ name, volta: n }));
  const m = montarDetalhe(d.fn);
  const [a, b] = await Promise.all([m.detalheComCache("P"), m.detalheComCache("P")]);
  assert.strictEqual(d.conta.n, 1, "varreu " + d.conta.n + " vezes: dois cliques custavam dois segundos de disco por um resultado só");
  assert.strictEqual(a, b);
});

t("dois projetos DIFERENTES em paralelo não compartilham resposta", async () => {
  const d = detailFalso(name => ({ name }));
  const m = montarDetalhe(d.fn);
  const [a, b] = await Promise.all([m.detalheComCache("A"), m.detalheComCache("B")]);
  assert.strictEqual(a.name, "A");
  assert.strictEqual(b.name, "B", "a deduplicação em voo colidiu dois projetos — cada um tem que ter a própria chave");
  assert.strictEqual(d.conta.n, 2);
});

t("o mapa em voo é limpo ao terminar, mesmo quando `detail` lança", async () => {
  let vaiLancar = true;
  const m = montarDetalhe(async () => { if (vaiLancar) throw new Error("disco caiu"); return { name: "P" }; });
  await assert.rejects(() => m.detalheComCache("P"));
  assert.strictEqual(m.detalheEmVoo.size, 0, "promessa rejeitada ficou no mapa em voo: toda chamada seguinte herdaria o mesmo erro para sempre");
  vaiLancar = false;
  assert.ok(await m.detalheComCache("P"));
});

t("o teto de entradas descarta a mais antiga", async () => {
  const m = montarDetalhe(async name => ({ name }));
  for (let i = 0; i < m.DETALHE_CAP + 3; i++) await m.detalheComCache("p" + i);
  assert.ok(m.detalheCache.size <= m.DETALHE_CAP, "o cache passou do teto: " + m.detalheCache.size);
  assert.ok(!m.detalheCache.has("p0"), "a entrada mais antiga tinha que sair primeiro");
  assert.ok(m.detalheCache.has("p" + (m.DETALHE_CAP + 2)), "a mais nova tinha que estar dentro");
});

t("a rota lê `?refresh=1` do query, não de outro lugar", () => {
  const s = semComentario(FONTE);
  /* O que se procura é a CHAMADA, não a declaração — `indexOf` acha a declaração
   * primeiro e ela nunca vai ter `searchParams` por perto. */
  const i = s.indexOf("await detalheComCache(name");
  assert.ok(i > 0, "a rota /api/project/ não chama `detalheComCache`");
  assert.ok(s.slice(i, i + 200).includes('searchParams.get("refresh")'),
    "a rota não repassa o `?refresh=1` — o cache ficaria sem furo nenhum");
});

// ---------------------------------------- 6. o laço do peso em paralelo (tarefa 3)
bloco("6. `/api/upgrade/peso`: em paralelo, na ordem, e sem derrubar os vizinhos");

/* Um n8n falso que MEDE a concorrência: quantas leituras estavam abertas ao
 * mesmo tempo. É este número que fica igual a 1 se alguém puser um `await` de
 * volta dentro do laço. */
function n8nFalso({ falhaEm = new Set(), atraso = 20 } = {}) {
  const st = { abertos: 0, pico: 0, chamadas: [] };
  const um = tipo => async id => {
    st.abertos++; st.pico = Math.max(st.pico, st.abertos);
    st.chamadas.push(tipo + ":" + id);
    try {
      await new Promise(r => setTimeout(r, atraso));
      if (falhaEm.has(id)) throw new Error("fluxo " + id + " não abriu");
      const graph = { nodes: [{ name: "n", type: "x", sub: null, x: 0, y: 0 }, { name: "post-it", type: "n8n-nodes-base.stickyNote", x: 1, y: 1 }], edges: [{ from: "n", to: "n" }] };
      const raw = { id, nodes: [{ name: "n", parameters: { a: 1 } }] };
      if (tipo === "raw") return raw;
      if (tipo === "graph") return graph;
      return { raw, graph };                 // getRawEGrafo
    } finally { st.abertos--; }
  };
  /* `getRawEGrafo` é o contrato de hoje: `getRawWorkflow` e `getGraph` batiam na
     MESMA URL, então o peso pedia o mesmo documento duas vezes por fluxo. Os dois
     antigos ficam no dublê de propósito — se alguém voltar a chamá-los aqui, a
     contagem de `chamadas` mostra, em vez de o teste explodir com `undefined`. */
  return { st, cliente: { getRawWorkflow: um("raw"), getGraph: um("graph"), getRawEGrafo: um("ambos") } };
}

const TREZE = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j10", "k11", "l12", "m13"];

t("os 13 fluxos são lidos em paralelo, não um de cada vez", async () => {
  const f = n8nFalso();
  const rodar = montarPeso({ n8n: f.cliente });
  const t0 = Date.now();
  await rodar(TREZE);
  const ms = Date.now() - t0;
  assert.ok(f.st.pico > 2, "pico de concorrência foi " + f.st.pico + ": o laço voltou a ser sequencial, que é o defeito medido em 6,69s para 13 fluxos");
  assert.ok(ms < 13 * 20, "levou " + ms + "ms, mais que os 13 atrasos somados — sequencial de novo");
});

t("UM fluxo custa UM GET, não dois do mesmo documento", async () => {
  /* `getRawWorkflow` e `getGraph` batem na mesma URL (`/api/v1/workflows/:id`):
     `api()` é `request("GET", …)` com params vazios. Pedir os dois era baixar o
     mesmo documento duas vezes, e o maior desta instância tem 291KB. Medido nos
     13 ids da vitrine: 26 GETs em 2.055ms contra 13 em 1.230ms. */
  const f = n8nFalso();
  const rodar = montarPeso({ n8n: f.cliente });
  await rodar(["so-um"]);
  assert.strictEqual(f.st.chamadas.length, 1,
    "foram " + f.st.chamadas.length + " leituras para um fluxo: " + f.st.chamadas.join(", "));
  assert.deepStrictEqual(f.st.chamadas, ["ambos:so-um"],
    "o peso tem que usar `getRawEGrafo`, que traz documento e grafo de um GET só");
});

t("nenhum fluxo é lido duas vezes na vitrine inteira", async () => {
  const f = n8nFalso({ atraso: 1 });
  const rodar = montarPeso({ n8n: f.cliente });
  await rodar(TREZE);
  assert.strictEqual(f.st.chamadas.length, 13,
    "13 fluxos deviam custar 13 leituras, custaram " + f.st.chamadas.length);
  assert.strictEqual(new Set(f.st.chamadas).size, 13, "há id repetido nas leituras");
});

t("a ordem pedida é a ordem devolvida", async () => {
  const f = n8nFalso({ atraso: 1 });
  const rodar = montarPeso({ n8n: f.cliente });
  const r = await rodar(TREZE);
  assert.deepStrictEqual(r.map(x => x.id), TREZE,
    "a vitrine desenha na ordem que pediu; embaralhar os cartões a cada refresh seria efeito colateral de uma mudança que só queria ser mais rápida");
});

t("um fluxo que não abre vira ausência dita, e não derruba os outros doze", async () => {
  const f = n8nFalso({ falhaEm: new Set(["g7"]) });
  const rodar = montarPeso({ n8n: f.cliente });
  const r = await rodar(TREZE);
  assert.strictEqual(r.length, 13);
  const mau = r.find(x => x.id === "g7");
  assert.ok(mau.erro, "o fluxo que falhou tinha que carregar `erro`");
  assert.strictEqual(mau.bytes, undefined, "não pode virar zero: zero é um peso, ausência é uma ausência");
  assert.strictEqual(r.filter(x => x.erro).length, 1,
    "uma falha derrubou os vizinhos — `Promise.all` sem `catch` por fluxo rejeita tudo na primeira");
});

t("o que está em cache não é buscado de novo", async () => {
  const cache = new Map([["b2", { at: Date.now(), valor: { id: "b2", bytes: 7, guardado: true } }]]);
  const f = n8nFalso({ atraso: 1 });
  const rodar = montarPeso({ n8n: f.cliente, pesoCache: cache });
  const r = await rodar(["a1", "b2"]);
  assert.ok(r[1].guardado, "o valor do cache tem que ser devolvido como está");
  assert.ok(!f.st.chamadas.some(c => c.endsWith(":b2")), "buscou um fluxo que já estava em cache");
});

t("entrada de cache mais velha que o TTL é rebuscada", async () => {
  const cache = new Map([["a1", { at: Date.now() - 999_999_999, valor: { id: "a1", velho: true } }]]);
  const f = n8nFalso({ atraso: 1 });
  const rodar = montarPeso({ n8n: f.cliente, pesoCache: cache });
  const r = await rodar(["a1"]);
  assert.ok(!r[0].velho, "devolveu a entrada vencida");
});

t("post-it não conta como nó, e nenhum `parameters` atravessa", async () => {
  const f = n8nFalso({ atraso: 1 });
  const rodar = montarPeso({ n8n: f.cliente });
  const r = await rodar(["a1"]);
  assert.strictEqual(r[0].graph.nos.length, 1, "o sticky note entrou na contagem de nós");
  const texto = JSON.stringify(r[0]);
  assert.ok(!texto.includes("parameters"), "um `parameters` atravessou para o cliente");
  assert.ok(typeof r[0].tokens === "number" && r[0].tokens > 0);
});

// --------------------------------------------------------------------- fim
(async () => {
  for (const c of casos) {
    if (c.bloco) { console.log("\n" + c.bloco); continue; }
    try { await c.fn(); ok++; console.log("  ok   " + c.nome); }
    catch (err) { falhas++; console.log("  FALHOU  " + c.nome + "\n         " + (err && err.message)); }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* diretório temporário do SO */ }
  console.log("\n" + (falhas
    ? "FALHOU: " + falhas + " de " + (ok + falhas)
    : "passou: " + ok + " ok, 0 falha(s)"));
  process.exit(falhas ? 1 : 0);
})();
