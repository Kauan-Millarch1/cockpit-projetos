/* estatico.js — a negociação de UMA resposta estática, como função pura.
 *
 * Por que existe, e por que é um módulo e não um `if` dentro do handler:
 *
 * As quatro páginas são arquivo único e pesam 66KB, 217KB, 325KB e 387KB. Trocar
 * de tela é reload de verdade (as três portas são navegação, não SPA), então o
 * custo de trocar de tela É o custo de transportar e reparsear esses bytes. Medido
 * antes de escrever isto: nenhuma resposta saía comprimida e nenhuma respondia
 * `304`, então cada volta à mesma tela pagava o arquivo inteiro outra vez.
 *
 * `server.js` emite fatos e o HTML julga — esta é a mesma disciplina uma camada
 * abaixo: aqui não se decide se uma resposta é boa, decide-se o que os cabeçalhos
 * de um GET permitem devolver. Fica separado do handler porque o handler abre
 * porta e conexão SSE: não dá para exercitar o handler num teste de graça, e um
 * teste que lê o fonte do handler por regex provaria a cópia, não o comportamento.
 * Puro, ele é dirigido direto pelo teste — a mesma razão de `custoDaRodada`,
 * `resolverAlvo` e `podeConversar` serem puros.
 *
 * Não há dependência nova: `zlib` é do Node. */

"use strict";

const zlib = require("zlib");

/* ─────────────────────────── os cabeçalhos que faltavam em TODA resposta ───── */

/* Medido na auditoria de 24/08/2026: zero cabeçalhos de segurança em qualquer
 * resposta do cockpit. O que isso custava, em ordem de gravidade:
 *
 * `frame-ancestors 'none'` é o que carrega este bloco. Sem ele o painel é
 * ENQUADRÁVEL: um site qualquer põe `/upgrade` num iframe invisível, alinha o
 * cursor sobre `✓ Aprovar e aplicar` e a pessoa clica achando que clicou em outra
 * coisa. O `guarda.js` não pega isso e não é falha dele — o clique é REAL, sai
 * `same-origin` e ele está certo em permitir. A defesa contra clickjacking é
 * impedir o enquadramento, e ela só existe aqui.
 *
 * `X-Frame-Options: DENY` vai junto, e não é redundância: um browser velho que
 * ignora CSP ainda obedece o cabeçalho antigo. Custam 20 bytes.
 *
 * `nosniff` fecha a interpretação de um `.md` ou `.json` servido como HTML — o
 * `/api/upgrade/dossie` e os anexos põem texto de fora perto de uma rota que
 * serve arquivo, e sniffing é o que transforma "texto" em "script".
 *
 * `Referrer-Policy` impede que o caminho da URL vaze para terceiros. As URLs
 * daqui carregam `?f=<id do fluxo>` e `?s=<id da sessão>`, e o `runId` é o que
 * autoriza o approve.
 *
 * O QUE NÃO ESTÁ AQUI, DE PROPÓSITO: uma CSP com `script-src`. As quatro páginas
 * são arquivo único com todo o JS inline, então qualquer política honesta
 * precisaria de `'unsafe-inline'` — que é a política que não protege de nada, com
 * a aparência de proteger. A CSP séria exige tirar o script de dentro do HTML, e
 * isso é uma mudança de arquitetura, não um cabeçalho. Enquanto ela não existe,
 * `frame-ancestors` é a diretiva que funciona sozinha.
 *
 * `Strict-Transport-Security` também fica fora: isto serve `http://127.0.0.1` e
 * um HSTS aqui é ou inerte ou uma armadilha para quem hospedar depois. */
const SEGURANCA = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

/* Nível 6, e isto é medição, não gosto. Nível 9 gasta mais CPU para ganhar pouco
 * byte, e nível 1 devolve arquivo maior de graça — mas nenhum dos dois importa
 * por request, porque o resultado fica no cache abaixo. O que decide é o custo da
 * PRIMEIRA vez depois de editar a página, e nessa 6 é o meio honesto. */
const NIVEL = 6;

/* Abaixo disso comprimir é prejuízo: o cabeçalho `Content-Encoding` mais o
 * overhead do gzip passam do que se economiza, e ainda se paga CPU. */
const MIN_GZIP = 1024;

/* O que vale comprimir. Texto comprime; PNG, ICO e fonte já vêm comprimidos e
 * gzipar de novo só gasta CPU para devolver bytes iguais ou maiores. */
const COMPRIMIVEL = new Set([
  "text/html", "text/css", "text/plain", "text/markdown",
  "application/javascript", "application/json", "image/svg+xml"
]);

/* `text/event-stream` NUNCA entra aqui, e isto é a armadilha desta camada.
 * O SSE é uma conexão que fica aberta para sempre e cujo valor inteiro é o evento
 * chegar na hora. Um stream de gzip acumula bytes até fechar o bloco, então
 * comprimir o SSE não deixa o painel lento: deixa o painel MUDO por tempo
 * indeterminado, e o sintoma é "o cockpit travou" sem nada no console. Está numa
 * constante à parte, e não só ausente da lista acima, para que apagar a lista não
 * reabra a porta. */
const NUNCA_COMPRIMIR = new Set(["text/event-stream"]);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  /* OS TIPOS DE ANEXO. Entraram quando a conversa do /upgrade passou a desenhar o
     print dentro da mensagem que o levou: sem eles a rota do arquivo devolveria
     `application/octet-stream`, e o navegador BAIXA em vez de mostrar — a imagem
     não apareceria e nada diria por quê. Nenhum deles está em `COMPRIMIVEL`, então
     não há decisão nova de compressão aqui; é só o cabeçalho certo. */
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf"
};

function tipoDe(ext) { return TIPOS[String(ext || "").toLowerCase()] || "application/octet-stream"; }

/* O tipo sem o `; charset=`, que é o que as duas listas acima indexam. */
function mime(contentType) { return String(contentType || "").split(";")[0].trim().toLowerCase(); }

function comprimivel(contentType, tamanho) {
  const m = mime(contentType);
  if (NUNCA_COMPRIMIR.has(m)) return false;
  if (!COMPRIMIVEL.has(m)) return false;
  return Number(tamanho) >= MIN_GZIP;
}

/* O cliente aceita gzip? Aceita-encoding é uma lista com qualidade opcional, e
 * `gzip;q=0` significa RECUSA explícita — tratar como aceite mandaria bytes que o
 * cliente disse não entender. */
function aceitaGzip(accept) {
  if (!accept) return false;
  for (const parte of String(accept).split(",")) {
    const [nome, ...params] = parte.trim().split(";");
    const n = nome.trim().toLowerCase();
    if (n !== "gzip" && n !== "*") continue;
    const q = params.map(p => p.trim().toLowerCase()).find(p => p.startsWith("q="));
    if (q && Number(q.slice(2)) === 0) return false;
    return true;
  }
  return false;
}

/* A etiqueta é de tamanho + mtime, não hash do conteúdo, e a escolha tem preço
 * declarado: hashear 387KB a cada request custaria mais do que a compressão que
 * este módulo existe para pagar uma vez só. É `W/` (weak) porque é exatamente o
 * que ela é — uma aposta em dois metadados, não uma prova do byte. Duas edições
 * dentro do mesmo milissegundo que resultem no MESMO tamanho passariam como
 * iguais; num painel editado à mão isso não acontece, e quando acontecer o
 * recarregamento forçado resolve. */
function etiqueta(tamanho, mtimeMs) {
  return 'W/"' + Number(tamanho).toString(36) + "-" + Math.floor(Number(mtimeMs)).toString(36) + '"';
}

/* `no-cache` NÃO é "não guarde": é "guarde e pergunte antes de usar". É o único
 * valor honesto aqui. `max-age` deixaria o navegador servir HTML velho sem
 * perguntar, e este repositório já pagou três vezes pelo mesmo defeito — processo
 * antigo servindo rota antiga, e o sintoma nunca aponta para a causa. Com
 * `no-cache` a volta à mesma tela é um `304` de poucas centenas de bytes em vez
 * de 387KB, e continua impossível ver uma página desatualizada. */
const CACHE_HTML = "no-cache";

/* `If-None-Match` pode vir com lista e com `*`. A comparação é fraca de
 * propósito: `W/"x"` e `"x"` são a mesma entidade para efeito de revalidação. */
function combina(ifNoneMatch, tag) {
  if (!ifNoneMatch || !tag) return false;
  const limpa = s => String(s).trim().replace(/^W\//, "");
  const alvo = limpa(tag);
  for (const parte of String(ifNoneMatch).split(",")) {
    const p = parte.trim();
    if (p === "*") return true;
    if (limpa(p) === alvo) return true;
  }
  return false;
}

/* `If-Modified-Since` tem resolução de SEGUNDO. Comparar contra um mtime em
 * milissegundos faz um arquivo salvo 400ms depois do cabeçalho parecer não
 * modificado — então o mtime é truncado para segundo antes de comparar. */
function naoModificadoDesde(ifModifiedSince, mtimeMs) {
  if (!ifModifiedSince) return false;
  const t = Date.parse(ifModifiedSince);
  if (!Number.isFinite(t)) return false;
  return Math.floor(Number(mtimeMs) / 1000) * 1000 <= t;
}

/* -------------------------------------------------------------- o cache
 *
 * Chaveado por caminho + mtime + tamanho. Não é TTL, e a razão é a mesma que
 * `esquema.resumo()` já registrou: um TTL faria a página servir o arquivo antigo
 * por N segundos depois de editar, que é o tipo de mentira temporária que este
 * projeto decidiu não contar. Trocar o arquivo troca a chave, e a entrada velha
 * cai fora na chamada seguinte.
 *
 * O que ele guarda é o BUFFER cru e o gzipado. Sem ele, o gzip de `upgrade.html`
 * seria pago a cada request; com ele, é pago uma vez por edição. */
const cache = new Map();

function chave(caminho, tamanho, mtimeMs) {
  return JSON.stringify([caminho, Number(tamanho), Math.floor(Number(mtimeMs))]);
}

function guardado(caminho, tamanho, mtimeMs) {
  return cache.get(chave(caminho, tamanho, mtimeMs)) || null;
}

function guardar(caminho, tamanho, mtimeMs, valor) {
  const k = chave(caminho, tamanho, mtimeMs);
  /* Uma entrada por caminho: o mtime mudou, a antiga não serve mais para nada e
   * ficar com as duas é vazar o arquivo inteiro em memória a cada save. */
  for (const antiga of cache.keys()) {
    if (JSON.parse(antiga)[0] === caminho) cache.delete(antiga);
  }
  cache.set(k, valor);
  return valor;
}

function limparCache() { cache.clear(); }

function gzip(buf) { return zlib.gzipSync(buf, { level: NIVEL }); }

/* -------------------------------------------------------------- a resposta
 *
 * `negociar` recebe FATOS — o que o request pediu e o que o arquivo é — e devolve
 * o que a resposta deve ser. Nenhum I/O aqui dentro: quem lê o disco é o chamador,
 * e é o chamador que decide se vale ler (num `304` não vale, e é aí que está a
 * maior parte do ganho).
 *
 *   req:  { method, headers }
 *   arq:  { caminho, ext, tamanho, mtimeMs }
 *   ler:  () => Buffer   — chamado SÓ quando o corpo for de fato necessário
 *
 * Devolve { status, headers, body, gzipado, doCache }. */
function negociar(req, arq, ler) {
  const metodo = String((req && req.method) || "GET").toUpperCase();
  const h = (req && req.headers) || {};
  const contentType = tipoDe(arq.ext);
  const tag = etiqueta(arq.tamanho, arq.mtimeMs);
  const lastModified = new Date(Math.floor(Number(arq.mtimeMs) / 1000) * 1000).toUTCString();

  const base = {
    "content-type": contentType,
    "cache-control": CACHE_HTML,
    "etag": tag,
    "last-modified": lastModified,
    ...SEGURANCA,
    /* Sem isto, um proxy que guardou a versão comprimida pode entregá-la a um
     * cliente que não aceita gzip. É obrigatório sempre que a resposta VARIA por
     * cabeçalho, mesmo quando esta resposta específica saiu sem comprimir. */
     "vary": "Accept-Encoding"
  };

  if (combina(h["if-none-match"], tag) || (!h["if-none-match"] && naoModificadoDesde(h["if-modified-since"], arq.mtimeMs))) {
    /* `304` não leva corpo nem `Content-Length`. É esta linha que transforma a
     * volta a uma tela já visitada de 387KB em algumas centenas de bytes. */
    return { status: 304, headers: base, body: null, gzipado: false, doCache: true };
  }

  const querGzip = comprimivel(contentType, arq.tamanho) && aceitaGzip(h["accept-encoding"]);

  const jaTem = guardado(arq.caminho, arq.tamanho, arq.mtimeMs);
  let cru = jaTem && jaTem.cru;
  let zip = jaTem && jaTem.zip;
  const doCache = !!(jaTem && (querGzip ? zip : cru));

  if (!cru) cru = ler();
  if (querGzip && !zip) zip = gzip(cru);
  guardar(arq.caminho, arq.tamanho, arq.mtimeMs, { cru, zip: zip || null });

  const body = querGzip ? zip : cru;
  const headers = { ...base, "content-length": String(body.length) };
  if (querGzip) headers["content-encoding"] = "gzip";

  /* HEAD leva os mesmos cabeçalhos e nenhum corpo — inclusive o `Content-Length`
   * do que teria sido enviado, senão a resposta mente sobre o tamanho. */
  return {
    status: 200, headers,
    body: metodo === "HEAD" ? null : body,
    gzipado: querGzip, doCache
  };
}

module.exports = {
  negociar, tipoDe, comprimivel, aceitaGzip, etiqueta, combina, naoModificadoDesde,
  SEGURANCA,
  limparCache, NIVEL, MIN_GZIP, COMPRIMIVEL, NUNCA_COMPRIMIR, CACHE_HTML
};
