"use strict";
/* cabecalhos-api-test.js — os quatro cabecalhos de seguranca nas respostas de API.
 *
 * O `estatico.js` ja punha `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff` e
 * `no-referrer` nas PAGINAS. As respostas de API saiam sem nenhum deles, e aqui
 * elas pesam mais do que numa pagina: sao as que carregam conversa de lead,
 * telefone mascarado e `runId` — e `runId` e o que endereca
 * `POST /api/claude/run/<id>/approve`, que escreve em fluxo de producao, e
 * `.../retry`, que manda mensagem real para um lead e nao tem desfazer.
 *
 * `frame-ancestors` e o que carrega o bloco. Sem ele o painel e enquadravel, e o
 * clique em "Aprovar e aplicar" dentro de um iframe sai `same-origin` — o
 * `guarda.js` esta CERTO em permitir, porque o clique e real. Clickjacking so se
 * fecha impedindo o enquadramento.
 *
 * COMO ISTO MEDE, e por que nao e um `includes` no fonte: as funcoes sao
 * EXTRAIDAS do `server.js` em tempo de execucao e dirigidas com um `res` falso.
 * Reimplementar `json()` aqui provaria a copia; procurar a string no fonte provaria
 * que alguem escreveu a palavra. O que interessa e o objeto que chega ao
 * `writeHead`. Mesma disciplina do `estatico-servidor-test.js`, que ja faz isso com
 * o `serveFile`.
 *
 * De graca: nenhum servidor sobe, nenhuma porta e aberta, nada e escrito.
 */

const fs = require("node:fs");
const path = require("node:path");
const estatico = require("./estatico.js");

let ok = 0, falhas = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok   " + nome); }
  else { falhas++; console.log("  FALHA " + nome); }
}

const FONTE = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const semComentario = s => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/* Um `res` falso que so guarda o que recebeu. */
function resFalso() {
  const r = { code: null, cab: null, corpo: "", terminou: false };
  r.writeHead = (c, h) => { r.code = c; r.cab = h; return r; };
  r.write = s => { r.corpo += s; return true; };
  r.end = s => { if (s) r.corpo += s; r.terminou = true; return r; };
  r.setHeader = (k, v) => { (r.cab = r.cab || {})[k] = v; };
  return r;
}

/* ══════════════════ 1. a fonte dos cabecalhos, e ela e UMA ══════════════════ */
console.log("\n── 1. a fonte");

{
  const S = estatico.SEGURANCA;
  t("`estatico.js` exporta `SEGURANCA`", S && typeof S === "object");
  t("...com `frame-ancestors 'none'`",
    /frame-ancestors\s+'none'/.test(String(S["content-security-policy"])));
  t("...com `x-frame-options: DENY`", String(S["x-frame-options"]).toUpperCase() === "DENY");
  t("...com `nosniff`", String(S["x-content-type-options"]) === "nosniff");
  t("...com `referrer-policy: no-referrer`", String(S["referrer-policy"]) === "no-referrer");

  /* Sem `script-src`, e de proposito: as quatro paginas tem todo o JS inline, entao
     qualquer politica honesta precisaria de `'unsafe-inline'` — que e a politica
     com aparencia de defesa. Este caso existe para quem acrescentar ter de vir
     ler o motivo primeiro. O `estatico.js` tem o comentario completo. */
  t("sem `script-src` — ver o motivo no `estatico.js` antes de acrescentar",
    !/script-src/.test(JSON.stringify(S)));

  /* Uma fonte so. Uma segunda copia no `server.js` divergiria na primeira correcao
     feita num lado so, e sao quatro strings que ninguem rele. Medido com os
     comentarios FORA, porque o comentario acima do `json()` cita os nomes. */
  const sc = semComentario(FONTE);
  t("`server.js` NAO redeclara os cabecalhos",
    !/frame-ancestors/.test(sc) && !/x-content-type-options\s*:/.test(sc));
  t("`server.js` le do `estatico.js`", /estatico\s*\.\s*SEGURANCA/.test(sc));
}

/* ═══════════════ 2. a resposta de API, dirigindo o `json()` real ════════════ */
console.log("\n── 2. `json()` — extraido do `server.js` e dirigido");

const SRC_JSON = (FONTE.match(/function json\(res, code, body\) \{[\s\S]*?\n\}/) || [null])[0];

{
  /* Extracao que nao acha o alvo tem de LANCAR, nunca devolver fatia vazia. Sem
     isto, renomear a funcao faria todos os casos abaixo passarem sobre uma string
     vazia — que e a primeira das quatro formas de teste cego do handoff. */
  t("o `json()` foi encontrado no fonte", !!SRC_JSON && SRC_JSON.length > 80);
  if (!SRC_JSON) {
    console.log("\ncabecalhos-api-test.js — extracao falhou, o resto nao vale nada");
    process.exit(1);
  }
}

const json = new Function("estatico", SRC_JSON + "\nreturn json;")(estatico);

{
  const res = resFalso();
  json(res, 200, { ok: true, runId: "rabc123" });

  t("responde 200", res.code === 200);
  t("o corpo e o JSON pedido", JSON.parse(res.corpo).runId === "rabc123");
  t("`content-type` continua de JSON",
    /application\/json/.test(String(res.cab["content-type"])));
  t("`content-length` continua presente — o gzip por mtime depende dele",
    res.cab["content-length"] > 0);
  t("`cache-control: no-store` continua", res.cab["cache-control"] === "no-store");

  /* Os quatro, um a um. Por NOME, nunca por contagem: contar deixaria um cabecalho
     trocar de lugar com outro sem ninguem ver. */
  t("`content-security-policy` chega na resposta de API",
    /frame-ancestors\s+'none'/.test(String(res.cab["content-security-policy"])));
  t("`x-frame-options` chega", String(res.cab["x-frame-options"]).toUpperCase() === "DENY");
  t("`x-content-type-options` chega", res.cab["x-content-type-options"] === "nosniff");
  t("`referrer-policy` chega", res.cab["referrer-policy"] === "no-referrer");
}

{
  /* O caminho de ERRO e o que mais importa proteger, e e o mais facil de esquecer:
     um 500 costuma sair por atalho. Aqui ele passa pelo mesmo `json()`, e este caso
     existe para continuar passando. */
  const res = resFalso();
  json(res, 500, { erro: "quebrou" });
  t("resposta de ERRO tambem leva os quatro",
    res.code === 500
    && /frame-ancestors/.test(String(res.cab["content-security-policy"]))
    && res.cab["x-content-type-options"] === "nosniff"
    && String(res.cab["x-frame-options"]).toUpperCase() === "DENY"
    && res.cab["referrer-policy"] === "no-referrer");

  const res2 = resFalso();
  json(res2, 409, { erro: "o fluxo mudou" });
  t("409 tambem", /frame-ancestors/.test(String(res2.cab["content-security-policy"])));
}

/* ════════════════ 3. o SSE — quatro rotas, e elas carregam dado ═════════════
 *
 * As quatro escrevem o proprio `writeHead` de proposito: o SSE NAO pode passar
 * pelo caminho estatico, porque um gzip ali nao deixa o painel lento, deixa MUDO.
 * Consequencia: elas tambem nao herdam cabecalho de ninguem, e eram as respostas
 * mais longas do painel — uma conexao aberta o dia inteiro carregando execucao,
 * erro e `runId`. */
console.log("\n── 3. os quatro `writeHead` de SSE");

{
  const sc = semComentario(FONTE);
  const blocos = [...sc.matchAll(/res\.writeHead\(\s*200\s*,\s*\{[\s\S]{0,400}?text\/event-stream[\s\S]{0,400}?\}\s*\)/g)]
    .map(m => m[0]);

  t("achei os quatro blocos de SSE no fonte", blocos.length === 4);
  t("todos os quatro espalham `estatico.SEGURANCA`",
    blocos.length === 4 && blocos.every(b => /\.\.\.\s*estatico\s*\.\s*SEGURANCA/.test(b)));

  /* A restricao que ja existia e que este arquivo nao pode quebrar: nenhum deles
     pode ganhar `content-encoding`. `estatico-servidor-test.js` ja falha nisso; o
     caso e repetido aqui porque quem mexe nestes quatro blocos e quem chega por
     este teste. */
  t("nenhum SSE ganhou `content-encoding`",
    blocos.every(b => !/content-encoding/i.test(b)));
  t("todos mantem `text/event-stream`",
    blocos.every(b => /text\/event-stream/.test(b)));
}

/* ═══════════ 4. as respostas de texto puro — 404 e 500 tambem contam ════════
 *
 * Um 404 sem `nosniff` e enquadravel do mesmo jeito, e "not found" e a resposta
 * que um atacante mais consegue provocar de fora, porque nao precisa de nenhum id
 * valido. */
console.log("\n── 4. texto puro");

{
  const sc = semComentario(FONTE);
  const planos = [...sc.matchAll(/res\.writeHead\(\s*\d{3}\s*,\s*\{[^}]{0,200}text\/plain[^}]{0,200}\}\s*\)/g)]
    .map(m => m[0]);
  t("achei as respostas de texto puro", planos.length >= 3);
  t("todas espalham `estatico.SEGURANCA`",
    planos.length > 0 && planos.every(b => /\.\.\.\s*estatico\s*\.\s*SEGURANCA/.test(b)));
}

console.log("\n" + (falhas === 0
  ? "cabecalhos-api-test.js — " + ok + " ok, 0 falha(s)"
  : "cabecalhos-api-test.js — " + ok + " ok, " + falhas + " FALHA(S)"));
process.exit(falhas === 0 ? 0 : 1);
