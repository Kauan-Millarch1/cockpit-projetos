/* guarda-test.js — as três camadas na porta do agente local.
 *
 * De graça: sem modelo, sem rede, sem servidor, sem escrever nada no repo. O
 * `fetch` global é trocado por um falso, o par de chaves é gerado na hora, e o
 * arquivo de pareamento é um objeto — nada toca o disco.
 *
 * O bloco GUARDA é EXTRAÍDO do `server.js` em tempo de execução (bloco 6),
 * porque o que importa não é a política existir em `guarda.js`, é o servidor
 * chamá-la antes de rotear. Reimplementar isso aqui provaria a cópia.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const g = require("./guarda");

let ok = 0, mal = 0;
const falhas = [];
function t(nome, cond) {
  if (cond) { ok++; return; }
  mal++; falhas.push(nome);
}
function bloco(n) { console.log(`\n── ${n}`); }

const PORTA = 4317;
const PROPRIA = `http://127.0.0.1:${PORTA}`;
const HOSPEDADO = "https://cockpit.vercel.app";
const DONO = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const ISS = "https://abc.supabase.co/auth/v1";

const PAREADO = { dono: DONO, origens: [HOSPEDADO], jwks: "https://abc.supabase.co/auth/v1/.well-known/jwks.json", iss: ISS, agenteId: "a1" };

/* TODO cliente HTTP/1.1 real manda `Host` — browser, curl, script. As fixtures
   deste arquivo nasceram sem ele, e quando a camada 0 (anti-rebind) entrou, oito
   casos ficaram vermelhos por causa da FIXTURE e não da decisão. O padrão passou
   a ser o host local, que é o que a realidade manda; quem testa a camada 0
   sobrescreve `host` explicitamente. Deixar o padrão ausente teria a forma de um
   teste e o efeito de um: provaria que a decisão certa é a errada. */
function req(metodo, cab = {}) {
  const headers = Object.assign({ host: `127.0.0.1:${PORTA}` }, cab);
  return { method: metodo, headers };
}

/* Um `res` falso, do mesmo formato que `estatico-servidor-test.js` usa. */
function resFalso() {
  const r = {
    codigo: null, cab: {}, corpo: "", fixos: {},
    setHeader(k, v) { r.fixos[String(k).toLowerCase()] = v; },
    writeHead(c, h) { r.codigo = c; for (const [k, v] of Object.entries(h || {})) r.cab[String(k).toLowerCase()] = v; return r; },
    end(s) { r.corpo = s == null ? "" : String(s); }
  };
  return r;
}

/* ─────────────────────────── 1. a classificação, que é a camada 1 inteira */
bloco("1. classificar — quatro classes, e duas delas não podem ler igual");

t("origem própria (127.0.0.1) é propria",
  g.classificar(req("POST", { origin: PROPRIA }), PORTA, [HOSPEDADO]).classe === "propria");
t("origem própria (localhost) também — as duas são digitáveis",
  g.classificar(req("POST", { origin: `http://localhost:${PORTA}` }), PORTA, []).classe === "propria");
t("origem hospedada pareada é pareada",
  g.classificar(req("POST", { origin: HOSPEDADO }), PORTA, [HOSPEDADO]).classe === "pareada");
t("origem hospedada NÃO pareada é estranha",
  g.classificar(req("POST", { origin: "https://evil.example" }), PORTA, [HOSPEDADO]).classe === "estranha");
t("sem origem e sem sec-fetch-site é ausente (curl), não estranha",
  g.classificar(req("POST", {}), PORTA, []).classe === "ausente");
t("ausente e estranha são classes diferentes — levam a decisões opostas",
  g.classificar(req("POST", {}), PORTA, []).classe !==
  g.classificar(req("POST", { origin: "https://evil.example" }), PORTA, []).classe);

/* O caso que este arquivo existe para provar: POST de formulário de outro site.
 * Requisição simples, sem preflight, e antes disto o efeito acontecia. */
t("POST de formulário cross-site, SEM origin, é estranha por sec-fetch-site",
  g.classificar(req("POST", { "sec-fetch-site": "cross-site" }), PORTA, []).classe === "estranha");
t("sec-fetch-site same-site também é estranha (subdomínio não é a própria)",
  g.classificar(req("POST", { "sec-fetch-site": "same-site" }), PORTA, []).classe === "estranha");
t("sec-fetch-site same-origin sem header origin é propria",
  g.classificar(req("POST", { "sec-fetch-site": "same-origin" }), PORTA, []).classe === "propria");
t("sec-fetch-site none num GET é propria (barra de endereço, favorito)",
  g.classificar(req("GET", { "sec-fetch-site": "none" }), PORTA, []).classe === "propria");
t("sec-fetch-site none num POST NÃO é propria — browser não produz isso",
  g.classificar(req("POST", { "sec-fetch-site": "none" }), PORTA, []).classe === "ausente");
/* ESTE CASO AFIRMAVA `ausente`, E ERA A AFIRMAÇÃO QUE MANTINHA O BURACO ABERTO.
 *
 * O nome dele ("não passa por propria") continua verdadeiro nas duas leituras, e
 * é isso que o fazia parecer certo. Mas `ausente` existe para o cliente que não é
 * browser, e com o agente NÃO PAREADO `decidir` responde a `ausente`
 * `permite: true, exigeToken: false` — então um `<iframe sandbox>` sem
 * `allow-same-origin`, que manda exatamente `Origin: null`, escrevia num fluxo de
 * produção. O teste não deixava de pegar o defeito: ele o declarava correto.
 *
 * `Origin: null` é uma origem DECLARADA e opaca, não uma ausência. Logo
 * `estranha`, que é 403 e nenhum token salva. */
t("origin literal 'null' (sandbox/data:) é ESTRANHA, nunca ausente",
  g.classificar(req("POST", { origin: "null" }), PORTA, []).classe === "estranha");
t("...e por isso um iframe sandbox NÃO escreve, nem com o agente sem pareamento",
  g.decidir({ metodo: "POST", classe: g.classificar(req("POST", { origin: "null" }), PORTA, []).classe,
    pareado: false }).permite === false);

/* ─── camada 0: o `Host`, contra DNS rebinding ─────────────────────────────── */

t("host do próprio agente confere",
  g.classificar(req("GET", { host: `127.0.0.1:${PORTA}` }), PORTA, []).hostOk === true);
t("localhost também confere (o .cmd abre por esse nome)",
  g.classificar(req("GET", { host: `localhost:${PORTA}` }), PORTA, []).hostOk === true);
t("host de outro nome NÃO confere, ainda que resolva para 127.0.0.1",
  g.classificar(req("GET", { host: `rebind.example:${PORTA}` }), PORTA, []).hostOk === false);
t("host ausente não confere — HTTP/1.1 exige, e anômalo aqui cai fechado",
  g.classificar({ method: "GET", headers: {} }, PORTA, []).hostOk === false);
t("host errado vira classe própria, para decidir poder recusar antes da leitura",
  g.classificar(req("GET", { host: `rebind.example:${PORTA}` }), PORTA, []).classe === "hostErrado");

/* A LINHA QUE CARREGA ESTE BLOCO. Todas as outras camadas deixam GET passar,
   porque leitura cruzada é barrada pelo browser via CORS. Depois de um rebind não
   há nada de cruzado: a página do atacante É a mesma origem, e o browser entrega
   o corpo — conversa de lead, id de execução, `runId`. Se esta recusa não vier
   ANTES do ramo de leitura, a camada não existe. */
t("DNS rebinding é recusado NA LEITURA, não só na escrita",
  g.decidir({ metodo: "GET", classe: "hostErrado", pareado: false }).permite === false);
t("...e o motivo nomeia o host, não a origem",
  /host/i.test(g.decidir({ metodo: "GET", classe: "hostErrado", pareado: false }).motivo));
t("rebind com sec-fetch-site same-origin (o caso real) também é recusado",
  g.decidir({ metodo: "GET", pareado: false,
    classe: g.classificar(req("GET", { host: `rebind.example:${PORTA}`,
      origin: `http://rebind.example:${PORTA}`, "sec-fetch-site": "same-origin" }),
      PORTA, []).classe }).permite === false);
t("uma origem PAREADA entra na lista de hosts aceitos, senão o hospedado nasce quebrado",
  g.classificar(req("GET", { host: "app.exemplo.com" }), PORTA, ["https://app.exemplo.com"]).hostOk === true);
t("mas só a pareada — outro nome continua fora",
  g.classificar(req("GET", { host: "app.evil.com" }), PORTA, ["https://app.exemplo.com"]).hostOk === false);
t("origin ganha de sec-fetch-site quando os dois vêm e discordam",
  g.classificar(req("POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }), PORTA, []).classe === "estranha");
t("o token sai do header Authorization",
  g.classificar(req("POST", { authorization: "Bearer abc.def.ghi" }), PORTA, []).token === "abc.def.ghi");
t("Bearer é case-insensitive",
  g.classificar(req("POST", { authorization: "bearer abc.def.ghi" }), PORTA, []).token === "abc.def.ghi");
t("header sem Bearer não vira token",
  g.classificar(req("POST", { authorization: "abc.def.ghi" }), PORTA, []).token === null);

/* ─────────────────────────────────────── 2. a tabela de decisão, e ela é pura */
bloco("2. decidir — pura, e o painel local não pode quebrar");

const D = (metodo, classe, pareado) => g.decidir({ metodo, classe, pareado });

t("GET nunca exige nada (leitura cruzada já morre no browser)", D("GET", "estranha", true).permite === true);
t("GET de estranha não exige token", D("GET", "estranha", true).exigeToken === false);
t("HEAD idem", D("HEAD", "estranha", true).permite === true);

t("POST do painel local passa sem token — o uso de hoje não quebra",
  D("POST", "propria", false).permite === true && D("POST", "propria", false).exigeToken === false);
t("DELETE do painel local também", D("DELETE", "propria", false).permite === true);

t("POST de estranha é recusado", D("POST", "estranha", true).permite === false);
t("...com 403", D("POST", "estranha", true).status === 403);
t("...e NENHUM token salva: nem pede", D("POST", "estranha", true).exigeToken === false);

t("POST de pareada exige token", D("POST", "pareada", true).exigeToken === true);
t("POST de pareada em agente NÃO pareado é 403",
  D("POST", "pareada", false).permite === false && D("POST", "pareada", false).status === 403);
t("POST ausente em agente PAREADO exige token",
  D("POST", "ausente", true).permite === true && D("POST", "ausente", true).exigeToken === true);
/* A barra sobe com o pareamento. Sem pareamento não existe app hospedado, logo
 * não existe token que alguém possa apresentar — exigir um seria recusa sem
 * saída, e é o que a primeira versão deste arquivo fazia. Uma PÁGINA não chega
 * nesta classe: browser atual manda origin em POST cruzado e sec-fetch-site em
 * tudo, e script não escreve nenhum dos dois. */
t("POST ausente em agente NÃO pareado passa — automação local de hoje não quebra",
  D("POST", "ausente", false).permite === true && D("POST", "ausente", false).exigeToken === false);
t("...e as duas leituras de 'ausente' têm frases distintas",
  D("POST", "ausente", true).motivo !== D("POST", "ausente", false).motivo);
t("MUTANTE — pareado, 'ausente' NÃO pode dispensar o token",
  D("POST", "ausente", true).exigeToken === true);

/* A lição das oito frases distintas do `autoDossie()`: motivo que lê igual
 * ensina a ignorar os dois. */
const motivos = [
  D("GET", "propria", false).motivo,
  D("POST", "propria", false).motivo,
  D("POST", "estranha", true).motivo,
  D("POST", "pareada", true).motivo,
  D("POST", "pareada", false).motivo,
  D("POST", "ausente", true).motivo,
  D("POST", "ausente", false).motivo
];
t("os sete motivos da tabela são distintos", new Set(motivos).size === motivos.length);
t("o motivo de estranha não fala de credencial — não é o que falta",
  !/credencial/i.test(D("POST", "estranha", true).motivo));

/* MUTANTE: se `decidir` liberasse mutante de estranha, este bloco fica vermelho. */
t("mutante — 'estranha' não pode ser permitida em nenhum método mutante",
  ["POST", "PUT", "PATCH", "DELETE"].every(m => D(m, "estranha", true).permite === false));

/* ─────────────────────────────── 3. os cabeçalhos: liberar ≠ expor a resposta */
bloco("3. CORS — liberar o método e expor a resposta são coisas diferentes");

t("propria recebe allow-origin",
  g.cabecalhosCors({ classe: "propria", origem: PROPRIA })["access-control-allow-origin"] === PROPRIA);
t("pareada recebe allow-origin",
  g.cabecalhosCors({ classe: "pareada", origem: HOSPEDADO })["access-control-allow-origin"] === HOSPEDADO);
t("estranha NÃO recebe allow-origin — é isso que esconde o corpo do GET",
  Object.keys(g.cabecalhosCors({ classe: "estranha", origem: "https://evil.example" })).length === 0);
t("ausente não recebe allow-origin",
  Object.keys(g.cabecalhosCors({ classe: "ausente", origem: null })).length === 0);
t("nunca ecoa '*' — credenciais e curinga não convivem",
  g.cabecalhosCors({ classe: "pareada", origem: HOSPEDADO })["access-control-allow-origin"] !== "*");
t("manda Vary: origin (resposta varia por origem, cache não pode misturar)",
  g.cabecalhosCors({ classe: "pareada", origem: HOSPEDADO }).vary === "origin");

bloco("4. preflight — o portão que a exigência do header compra");

let r = resFalso();
g.responderPreflight(req("OPTIONS", { origin: "https://evil.example" }), r, { classe: "estranha", origem: "https://evil.example" });
t("preflight de estranha é 403", r.codigo === 403);
t("...e sem allow-origin", !r.cab["access-control-allow-origin"]);

r = resFalso();
g.responderPreflight(req("OPTIONS", { origin: HOSPEDADO }), r, { classe: "pareada", origem: HOSPEDADO });
t("preflight de pareada é 204", r.codigo === 204);
t("...permite o header authorization (senão a camada 2 não chega)",
  /authorization/i.test(String(r.cab["access-control-allow-headers"])));
t("...sem private-network quando não foi pedido", !r.cab["access-control-allow-private-network"]);

r = resFalso();
g.responderPreflight(req("OPTIONS", { origin: HOSPEDADO, "access-control-request-private-network": "true" }), r, { classe: "pareada", origem: HOSPEDADO });
t("private-network só quando o Chrome pede",
  r.cab["access-control-allow-private-network"] === "true");

/* ───────────────────────── 5. a assinatura (camada 2) e o dono (camada 3) */
bloco("5. o token — assinatura de verdade, com o par gerado agora");

const par = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwkPub = par.publicKey.export({ format: "jwk" });
jwkPub.kid = "k1";
jwkPub.alg = "ES256";
jwkPub.use = "sig";

function b64(o) {
  return Buffer.from(typeof o === "string" ? o : JSON.stringify(o))
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/* Assina em IEEE P1363 (R||S cru). O padrão do Node é DER, e um token assinado
 * em DER falha a verificação de TODO token válido — a armadilha documentada em
 * `conferirAssinatura`. Este teste só passa se as duas pontas concordarem. */
function token({ sub = DONO, exp = Math.floor(Date.now() / 1000) + 600, iss = ISS, aud = "authenticated", alg = "ES256", kid = "k1", assinar = true } = {}) {
  const h = b64({ alg, kid, typ: "JWT" });
  const c = b64({ sub, exp, iss, aud });
  if (!assinar) return `${h}.${c}.${b64("naoassinado")}`;
  const s = crypto.sign("sha256", Buffer.from(`${h}.${c}`), { key: par.privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${c}.${s.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/* Assina um corpo ARBITRÁRIO. Existe porque `token()` sempre escreve as quatro
 * claims, e o que está sob teste abaixo é a AUSÊNCIA de uma delas: com default
 * não dá para provar o que acontece quando o campo não vem, e o campo que não
 * vem é exatamente o que caía no galho permissivo. */
function tokenCom(claims, { alg = "ES256", kid = "k1" } = {}) {
  const h = b64({ alg, kid, typ: "JWT" });
  const c = b64(claims);
  const s = crypto.sign("sha256", Buffer.from(`${h}.${c}`), { key: par.privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${c}.${s.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

const daquiA = s => Math.floor(Date.now() / 1000) + s;

const fetchReal = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwkPub] }) });

(async () => {
  let v = await g.verificarToken(token(), PAREADO);
  t("token bem assinado, do dono, dentro da validade: passa", v.ok === true);
  t("...e devolve o sub", v.sub === DONO);

  v = await g.verificarToken(token({ sub: OUTRO }), PAREADO);
  t("CAMADA 3 — token válido de OUTRA conta é recusado", v.ok === false);
  t("...com 403, não 401: a credencial é boa, a conta é outra", v.status === 403);
  t("...e o motivo diz conta, não assinatura", /outra conta/i.test(v.motivo));

  v = await g.verificarToken(token({ exp: Math.floor(Date.now() / 1000) - 1 }), PAREADO);
  t("token expirado é recusado", v.ok === false && v.status === 401);

  v = await g.verificarToken(token({ assinar: false }), PAREADO);
  t("assinatura errada é recusada", v.ok === false);
  t("...e o motivo é de assinatura, não de expiração — ordem importa",
    /assinatura/i.test(v.motivo));

  /* Confusão de algoritmo. Os dois casos clássicos, e o segundo é o que
   * transformaria o agente em portador de chave-mestra. */
  v = await g.verificarToken(token({ alg: "none", assinar: false }), PAREADO);
  t("alg 'none' é recusado antes de qualquer verificação", v.ok === false);
  v = await g.verificarToken(token({ alg: "HS256", assinar: false }), PAREADO);
  t("alg HS256 é recusado — o agente não pode ter o JWT secret do projeto", v.ok === false);
  t("...e o motivo nomeia o algoritmo", /HS256/.test(v.motivo));

  v = await g.verificarToken(token({ iss: "https://outro.supabase.co/auth/v1" }), PAREADO);
  t("emissor diferente é recusado", v.ok === false);

  v = await g.verificarToken(token({ aud: "anon" }), PAREADO);
  t("audiência diferente de 'authenticated' é recusada", v.ok === false);

  /* A checagem era `if (corpo.aud && corpo.aud !== "authenticated")`, e o `&&`
   * é o defeito inteiro: um token SEM `aud` nenhuma passava direto. É a frase
   * que este repositório já escreveu seis vezes — campo ausente caindo no galho
   * negativo — na direção mais cara que ela tem aqui, porque `aud` é o que
   * separa um token de usuário logado de um `anon` que qualquer visitante pega.
   * O caso de cima ficava verde com o buraco aberto: ele só prova a audiência
   * ERRADA, nunca a audiência que não veio. */
  v = await g.verificarToken(tokenCom({ sub: DONO, exp: daquiA(600), iss: ISS }), PAREADO);
  t("token SEM aud nenhuma é recusado — ausente nunca cai no galho permissivo",
    v.ok === false && v.status === 401);
  t("...e o motivo é o de audiência, não o de dono", /audiência/i.test(v.motivo));

  /* `nbf` não era olhado. Um token emitido para valer só amanhã valia hoje, e
   * quem o guarda nesse intervalo é justamente quem ainda não podia usá-lo. */
  v = await g.verificarToken(tokenCom({ sub: DONO, exp: daquiA(6000), iss: ISS, aud: "authenticated", nbf: daquiA(3000) }), PAREADO);
  t("nbf no futuro é recusado — token que ainda não vale não vale", v.ok === false && v.status === 401);
  t("...e a frase não é a de expirado: são os dois extremos opostos da validade",
    /ainda não vale/i.test(v.motivo));
  /* A outra ponta, e sem ela a checagem poderia ser `sempre recusa`: `nbf`
   * ausente é o caso NORMAL — o Supabase não emite a claim — e barrar por ela
   * derrubaria todo token real, que é a falha que faz alguém desligar o guarda. */
  v = await g.verificarToken(tokenCom({ sub: DONO, exp: daquiA(600), iss: ISS, aud: "authenticated", nbf: daquiA(-60) }), PAREADO);
  t("nbf já passado passa — a recusa é do futuro, não da existência do campo", v.ok === true);

  v = await g.verificarToken(null, PAREADO);
  t("sem token: recusa 401", v.ok === false && v.status === 401);
  v = await g.verificarToken("nao.e.jwt.nenhum", PAREADO);
  t("token com 4 partes é malformado", v.ok === false);
  v = await g.verificarToken("aaa.bbb.ccc", PAREADO);
  t("token ilegível é recusado sem estourar", v.ok === false);
  v = await g.verificarToken(token(), null);
  t("agente sem pareamento recusa qualquer token", v.ok === false && v.status === 403);

  /* ESTE CASO AFIRMAVA O FALLBACK, E O FALLBACK ERA UM CHUTE.
   *
   * Ele dizia "kid desconhecido com JWKS de 1 chave cai no fallback e ainda
   * confere" e ficava verde — porque a assinatura era mesmo conferida contra a
   * única chave que sobrou. O que ele fixava, sem dizer, é uma rotina de SELEÇÃO
   * de chave adivinhando qual chave usar. O preço aparece na rotação: o JWKS
   * passa a servir a chave nova, um token com `kid` velho segue sendo testado
   * contra ela, e a recusa vira "assinatura não confere" no lugar de "chave
   * desconhecida" — duas frases que mandam procurar em lugares opostos. */
  v = await g.verificarToken(token({ kid: "k9" }), PAREADO);
  t("kid que não casa é recusado MESMO com uma chave só no JWKS — sem fallback",
    v.ok === false && v.status === 401);
  t("...e o motivo nomeia a chave, não a assinatura",
    /chave desconhecida/i.test(v.motivo));

  /* A FORMA REAL do JWK do Supabase, medida em 2026-08-21 no projeto Cockpit:
   * `alg, crv, ext, key_ops, kid, kty, use, x, y`. Os três campos a mais
   * (`ext`, `key_ops`, `use`) não existem no JWK que este teste gera, e é
   * justo por isso que este caso existe: `createPublicKey` os ignora hoje, e
   * quem "limpar" o JWK antes de importar — ou filtrar campo desconhecido por
   * zelo — mata a camada 2 SÓ EM PRODUÇÃO, onde o JWK vem com eles. A chave é
   * gerada aqui e não é a dele: a forma é que está sob teste, não o projeto. */
  const jwkGordo = Object.assign({}, jwkPub, { ext: true, key_ops: ["verify"], use: "sig" });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwkGordo] }) });
  v = await g.verificarToken(token(), { ...PAREADO, jwks: PAREADO.jwks + "?real" });
  t("JWK na forma real do Supabase (ext/key_ops/use) verifica igual", v.ok === true);
  t("...e os nove campos da forma medida estão todos no fixture",
    ["alg", "crv", "ext", "key_ops", "kid", "kty", "use", "x", "y"].every(k => k in jwkGordo));
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwkPub] }) });

  /* Chave errada: mesma curva, par diferente, e o `kid` CASANDO. Prova que
   * selecionar a chave pelo `kid` não é confiar no `kid`: a assinatura ainda é
   * conferida, e um token forjado que acerte o `kid` continua caindo. */
  const outroPar = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwkAlheio = outroPar.publicKey.export({ format: "jwk" });
  jwkAlheio.kid = "k1";
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwkAlheio] }) });
  const semCache = { ...PAREADO, jwks: PAREADO.jwks + "?2" };
  v = await g.verificarToken(token(), semCache);
  t("token assinado por outra chave é recusado mesmo com kid batendo", v.ok === false);

  /* JWKS inalcançável: hoje `decidirSemJwks` não tem política e LANÇA. O que
   * este teste fixa não é a política — é que a ausência dela NÃO abre. */
  globalThis.fetch = async () => { throw new Error("offline"); };
  const semJwks = { ...PAREADO, jwks: PAREADO.jwks + "?3" };
  let lancou = false, abriu = false;
  try {
    const vv = await g.verificarToken(token(), semJwks);
    abriu = vv && vv.ok === true;
  } catch { lancou = true; }
  t("JWKS inalcançável NÃO libera o token (política pendente falha fechada)", abriu === false);
  t("...e hoje isso acontece por exceção, que o server.js converte em 503", lancou === true);

  /* ─── 5b. o ramo offline COM a política escrita ────────────────────────────
   *
   * Os dois casos acima provam que a AUSÊNCIA de política não abre. Não provam
   * nada sobre o dia em que ela existir — e é esse dia que era o defeito: o ramo
   * devolvia `ok: true` com o `sub` de um corpo NÃO VERIFICADO, sem `exp`, sem
   * `iss`, sem `aud` e sem a camada 3. Duas das três políticas que o docblock de
   * `decidirSemJwks` recomenda devolvem `permite: true`, então quem escrevesse o
   * TODO entregava um bypass de autenticação sem encostar em `verificarToken`.
   *
   * Para medir isso é preciso RODAR aquele ramo, e ele é inalcançável enquanto a
   * função lança. Então o `guarda.js` é recompilado com o `throw` trocado pela
   * política — o arquivo real, o `verificarToken` real, nada reimplementado e
   * nada escrito no disco. A troca é conferida antes de valer qualquer coisa:
   * um `replace` que não casasse deixaria o bloco inteiro verde provando o
   * `throw` de novo, que é um teste que aprova a ausência da decisão. */
  const Module = require("module");
  const srcGuarda = fs.readFileSync(path.join(__dirname, "guarda.js"), "utf8");
  const ALVO = /^\s*throw new Error\("decidirSemJwks[^\n]*\n/m;
  const ancoraOk = ALVO.test(srcGuarda);
  t("o throw de decidirSemJwks está onde o teste pensa que está", ancoraOk);

  function guardaComPolitica(retorno) {
    const src = srcGuarda.replace(ALVO, `return ${JSON.stringify(retorno)};\n`);
    const m = new Module(path.join(__dirname, "guarda.js"), module);
    m.filename = path.join(__dirname, "guarda.js");
    m.paths = Module._nodeModulePaths(__dirname);
    m._compile(src, m.filename);
    return m.exports;
  }

  /* O bloco inteiro fica atrás da âncora, e a razão é a forma como ele falha:
   * sem a troca o `throw` continua de pé, `verificarToken` LANÇA dentro deste
   * IIFE assíncrono, a rejeição não é tratada e o processo morre antes de
   * imprimir o resumo — a lição do `mutex-test.js` na versão silenciosa, em que
   * o teste não fica vermelho, ele simplesmente para. Assim a âncora quebrada
   * vira um caso vermelho com nome, e os casos offline somem em vez de derrubar
   * o arquivo com um stack trace que não nomeia nada disto. */
  if (ancoraOk) {
  const gAbre = guardaComPolitica({ permite: true, motivo: "chave em cache, assinatura não conferida" });
  globalThis.fetch = async () => { throw new Error("offline"); };

  /* O caso que carrega o bloco. Política liberando, JWKS fora do ar, e um token
   * de OUTRA conta: a camada 3 é a única coisa entre isso e o agente. */
  let vo = await gAbre.verificarToken(token({ sub: OUTRO }), PAREADO);
  t("OFFLINE — política liberando, token de outra conta continua recusado", vo.ok === false);
  t("...com 403: a política decide se o ramo segue, não se a credencial serve", vo.status === 403);

  vo = await gAbre.verificarToken(token({ exp: Math.floor(Date.now() / 1000) - 1 }), PAREADO);
  t("OFFLINE — token expirado continua recusado, ainda que a assinatura não seja conferida",
    vo.ok === false && vo.status === 401);

  vo = await gAbre.verificarToken(tokenCom({ sub: DONO, exp: daquiA(600), iss: ISS }), PAREADO);
  t("OFFLINE — token sem aud continua recusado", vo.ok === false && vo.status === 401);

  vo = await gAbre.verificarToken(token({ iss: "https://outro.supabase.co/auth/v1" }), PAREADO);
  t("OFFLINE — emissor diferente continua recusado", vo.ok === false);

  /* A outra ponta, e sem ela os quatro casos acima passariam com um
     `return { ok: false }` cravado: com a política aberta e o token certo, o
     ramo PRECISA passar — senão não é o ramo offline que está sob teste. */
  vo = await gAbre.verificarToken(token(), PAREADO);
  t("OFFLINE — o token do dono passa quando a política manda passar", vo.ok === true);
  t("...e sai marcado `semAssinatura`, que é o único jeito honesto de dizer que a camada 2 não rodou",
    vo.semAssinatura === true);

  /* Política fechando: 503, e é o `motivo` dela que vai para a tela — "não
     confirmei a assinatura" não pode ler igual a "assinatura inválida". */
  const gFecha = guardaComPolitica({ permite: false, motivo: "sem JWKS fresco, nada de escrita" });
  vo = await gFecha.verificarToken(token(), PAREADO);
  t("OFFLINE — política fechando devolve 503, não 401", vo.ok === false && vo.status === 503);
  t("...e o motivo é o da política, não o de assinatura",
    /JWKS/i.test(vo.motivo) && !/assinatura da credencial/i.test(vo.motivo));
  }

  globalThis.fetch = fetchReal;

  /* ───────────────────────── 6. o servidor CHAMA o guarda antes de rotear */
  bloco("6. o bloco GUARDA dentro do server.js");

  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  /* Medido sobre fonte SEM COMENTÁRIO: a lição que o `dossie-tela-test.js`
   * pagou — dois casos ficaram verdes porque um comentário carregava o nome que
   * o `includes` procurava. Um teste que casa dentro de comentário aprova, no
   * pior caso, a AUSÊNCIA da decisão. */
  const limpo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  t("o bloco existe e é delimitado", /GUARDA-INI/.test(src) && /GUARDA-FIM/.test(src));
  t("uma ocorrência só de cada delimitador — bloco colado duas vezes é o defeito conhecido",
    (src.match(/GUARDA-INI/g) || []).length === 1 && (src.match(/GUARDA-FIM/g) || []).length === 1);
  t("o server requer o guarda", /require\(["']\.\/guarda["']\)/.test(limpo));

  const iIni = src.indexOf("GUARDA-INI");
  const iFim = src.indexOf("GUARDA-FIM");
  const dentro = src.slice(iIni, iFim);
  const limpoDentro = dentro.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  t("chama classificar", /guarda\.classificar\(/.test(limpoDentro));
  t("chama decidir", /guarda\.decidir\(/.test(limpoDentro));
  t("chama verificarToken", /guarda\.verificarToken\(/.test(limpoDentro));
  t("responde o preflight antes de qualquer rota", /guarda\.responderPreflight\(/.test(limpoDentro));
  t("aplica os cabeçalhos por setHeader (writeHead das rotas funde com eles)",
    /cabecalhosCors\(cls\)/.test(limpoDentro) && /setHeader\(/.test(limpoDentro));
  t("passa a PORTA de verdade, não um literal", /guarda\.classificar\(req,\s*PORT\b/.test(limpoDentro));
  t("o pareado vem do arquivo lido, não de env",
    /pareado:\s*!!pareamento/.test(limpoDentro) && /guarda\.lerPareamento\(/.test(limpoDentro));

  /* O ponto estrutural: o guarda roda ANTES da primeira rota. Se alguém mover o
   * bloco para depois, 41 rotas ficam a descoberto e nada mais neste arquivo
   * pega isso. */
  const iRota = limpo.indexOf('if (p === "/"');
  const iIniLimpo = limpo.indexOf("guarda.classificar(");
  t("o guarda vem ANTES da primeira rota servida",
    iIniLimpo > 0 && iRota > 0 && iIniLimpo < iRota);

  /* Ele tem `try` próprio, e o `catch` fecha em 503. Sem isso, um throw ali é
   * rejeição não tratada dentro do handler: socket pendurado, resposta nenhuma. */
  t("o guarda tem catch próprio", /catch\s*\(err\)/.test(limpoDentro));
  t("...e o catch recusa com 503, não segue para as rotas",
    /json\(res,\s*503/.test(limpoDentro));
  t("o catch do guarda não cai no remapeamento 401/403→502 do catch de baixo",
    limpo.indexOf("catch (err)", iIniLimpo) < limpo.indexOf("passthrough"));

  /* A CONTAGEM É UM ARAME DE TROPEÇO, NÃO A GARANTIA, e vale escrever qual é
   * qual — hoje o número subiu de 41 para 45 (as cinco rotas de pareamento) e
   * este caso ficou vermelho, que é ele funcionando.
   *
   * A garantia de verdade é ESTRUTURAL e está nos casos acima: o bloco fica antes
   * da primeira rota e é AGNÓSTICO DE CAMINHO, então rota nova nasce coberta sem
   * ninguém inscrever nada. Se a cobertura dependesse de uma lista, um número aqui
   * não salvaria — alguém acrescentaria rota e lista junto, e o teste seguiria
   * verde sobre uma inscrição errada.
   *
   * Então por que manter o número? Porque contar é a única coisa que obriga uma
   * PESSOA a olhar quando a superfície mutante cresce. O guarda cobre a rota nova
   * automaticamente; o que ele não sabe dizer é se aquela rota precisava de mais
   * do que ele — confirmação humana, teto de tentativa, dono. A falha aqui não
   * significa "está inseguro", significa "apareceu porta nova, decide se o guarda
   * basta para ela". */
  const nPost = (limpo.match(/req\.method === "POST"/g) || []).length;
  const nDel = (limpo.match(/req\.method === "DELETE"/g) || []).length;
  /* 45 -> 54, e o arame TROPEÇOU: 2026-08-25, com a auditoria de segurança em
     cima. As 11 portas novas, e o que foi decidido sobre cada uma:

       POST /api/perfil/entrar/google · entrar/email · sair · decidir
       POST /api/perfil/equipe/convidar · organizacoes · convite
       POST /api/pareamento/iniciar · confirmar · cancelar
       DELETE /api/pareamento

     · As sete de PERFIL: o guarda basta como fence de origem, e elas trazem a
       sua própria autorização — PKCE com o verifier só no servidor, `state`
       carregado no `redirect_to`, uso único com TTL de 10min, id de sessão de 24
       bytes aleatórios, cookie `HttpOnly; SameSite=Lax`, callback para um
       `/entrar` fixo (sem redirect aberto), e o papel RE-DERIVADO do banco a cada
       pedido, nunca aceito do corpo. `cabecalhosCors` só emite
       `Allow-Origin`/`Allow-Credentials` para `propria`/`pareada`, então o cookie
       novo não é legível de fora.

     · As quatro de PAREAMENTO: o guarda NÃO bastava, e foi o que este arame
       serviu para descobrir. Elas são o motor de `/integracoes`, que já exigia
       admin — e não exigiam nada: zero chamadas de `quemEsta`, ao contrário de
       `/api/cofre` e `/api/integracoes`. Quem não podia ABRIR a tela dirigia a
       API dela. Ganharam o portão de admin (bloco `p.startsWith("/api/pareamento")`
       em `server.js`), cumulativo com a confirmação humana no console — que segue
       sendo a camada que separa "a pessoa quis" de "algo na máquina dela quis".

     O número volta a ser o que ele sempre foi: um arame, não a garantia. A
     garantia continua estrutural, nos casos acima — bloco antes da primeira rota
     e agnóstico de caminho. */
  const ROTAS_MUTANTES = 54;
  t(`as ${ROTAS_MUTANTES} rotas mutantes seguem ${ROTAS_MUTANTES} (medido: ${nPost} POST + ${nDel} DELETE)`,
    nPost + nDel === ROTAS_MUTANTES);

  bloco("7. lerPareamento — ausente nunca cai no galho negativo");

  t("diretório sem .agente devolve null (modo local, confia em ninguém)",
    g.lerPareamento(path.join(__dirname, ".cache-tester-docs")) === null);
  t("MUTANTE — null não pode ser 'pareado com qualquer origem'",
    g.decidir({ metodo: "POST", classe: "pareada", pareado: !!null }).permite === false);

  /* O filtro de `origens`. Escreve num diretório temporário do SO — nada toca o
   * repo. O caso que carrega o bloco é o `http://`: uma origem em claro na
   * allowlist é uma página sem TLS autorizada a mandar escrever num fluxo de
   * produção, e o único sinal disso seria o esquema da URL. Este caso nasceu de
   * um mutante que SOBREVIVEU à primeira versão deste arquivo. */
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "guarda-"));
  const escrever = obj => {
    fs.mkdirSync(path.join(tmp, ".agente"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".agente", "pareamento.json"), JSON.stringify(obj));
  };

  escrever({ dono: DONO, origens: ["https://ok.example"], jwks: "j", iss: ISS });
  let lp = g.lerPareamento(tmp);
  t("origem https é mantida", lp && lp.origens.length === 1);

  escrever({ dono: DONO, origens: ["http://em-claro.example"], jwks: "j", iss: ISS });
  lp = g.lerPareamento(tmp);
  t("origem http:// é DESCARTADA — sem TLS não escreve em produção",
    lp && lp.origens.length === 0);
  t("...e uma requisição vinda dela classifica como estranha, não pareada",
    g.classificar(req("POST", { origin: "http://em-claro.example" }), PORTA, lp.origens).classe === "estranha");

  escrever({ dono: DONO, origens: ["https://x.example", "http://y.example", "ftp://z"], jwks: "j" });
  lp = g.lerPareamento(tmp);
  t("mistura: só a https sobrevive", lp && lp.origens.length === 1 && lp.origens[0] === "https://x.example");

  escrever({ dono: DONO, origens: ["https://x.example/caminho"], jwks: "j" });
  t("origem com caminho é descartada (origem não tem path)",
    g.lerPareamento(tmp).origens.length === 0);

  escrever({ origens: ["https://x.example"], jwks: "j" });
  t("pareamento sem dono é null inteiro — sem camada 3 não há pareamento",
    g.lerPareamento(tmp) === null);

  escrever({ dono: DONO, origens: "https://x.example" });
  t("origens que não é lista é null, não string iterada caractere a caractere",
    g.lerPareamento(tmp) === null);

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${mal ? "FALHOU" : "passou"}: ${ok} ok, ${mal} falha(s)`);
  if (mal) { for (const f of falhas) console.log(`  ✗ ${f}`); process.exitCode = 1; }
})();
