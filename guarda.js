/* guarda.js — as três camadas na porta do agente local.
 *
 * O QUE ISTO EXISTE PARA IMPEDIR, medido antes de escrever uma linha:
 *
 *   server.js       0 cabeçalhos CORS, 0 validação de content-type
 *   server.js:545   readBody() lê qualquer corpo e só depois dá JSON.parse
 *   server.js       39 rotas POST + 2 DELETE, nenhum OPTIONS
 *
 * O `server.js` escuta em 127.0.0.1 e a fence sempre foi "só localhost". Isso
 * protege contra a REDE e não contra o BROWSER: qualquer aba aberta na máquina
 * dispara requisição para o loopback. Sem CORS e sem checagem de content-type,
 * um POST de formulário de um site qualquer é requisição SIMPLES — não passa por
 * preflight, o efeito acontece, e o atacante só não consegue LER a resposta.
 * Os dois alvos que importam:
 *
 *   POST /api/claude/run/<id>/approve   escreve no fluxo de produção
 *   POST /api/claude/run/<id>/retry     manda mensagem real para um lead, sem undo
 *
 * Hoje o que segura é o `runId` ser difícil de adivinhar. Isso é sorte, não
 * fence — e a arquitetura hospedada piora: a página passa a entregar esses ids
 * ao browser.
 *
 * FATOS, como o resto do servidor. `decidir()` é PURA de propósito, pelo mesmo
 * motivo de `resolverAlvo` e `custoDaRodada`: a política tem que ser testável
 * sem subir servidor, sem browser e sem rede.
 *
 * O QUE ESTE ARQUIVO NÃO GUARDA: segredo. A chave do n8n continua no `.env` da
 * máquina e a credencial do Claude continua no CLI. O único material de chave
 * que passa por aqui é a chave PÚBLICA do Supabase, buscada do JWKS.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/* Métodos que mudam algo. GET e HEAD ficam de fora porque leitura cruzada já é
 * barrada pelo próprio browser: sem `access-control-allow-origin` na resposta,
 * o `fetch` e o `EventSource` não expõem o corpo a quem pediu. Barrar o método
 * de leitura aqui não fecharia nada e quebraria o painel. */
const MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* Algoritmos aceitos. A lista é fechada e a razão é confusão de algoritmo: um
 * token `alg: "none"` ou `alg: "HS256"` tem que ser RECUSADO em vez de tentado.
 * HS* é chave compartilhada — se o agente pudesse verificar HS256 ele precisaria
 * do JWT secret do projeto Supabase, e esse segredo FORJA TOKEN DE QUALQUER
 * USUÁRIO. Dez agentes instalados com ele dentro são dez cópias da chave-mestra.
 * Assimétrico, o agente só tem a pública — por isso a recusa a HS* é decisão de
 * arquitetura e não rigor de leitura de spec. */
const ALGS = new Set(["ES256", "RS256", "EdDSA"]);

const CAB_TOKEN = "authorization";

/* ─────────────────────────────────────────────────────── camada 1: a origem */

/* As origens do próprio agente. As duas formas contam porque as duas são
 * digitáveis e o `start-cockpit.cmd` abre uma delas — um allowlist com só uma
 * recusaria o painel do próprio dono, que é a pior falha possível aqui: a que
 * faz alguém desligar o guarda inteiro para voltar a trabalhar. */
function origensProprias(porta) {
  return [`http://127.0.0.1:${porta}`, `http://localhost:${porta}`];
}

/* ───────────────────────────────── camada 0: o `Host`, contra DNS rebinding ── */

/* O QUE ISTO FECHA, e nenhuma das outras camadas fechava:
 *
 * O atacante registra `algum.dominio` apontando para o IP dele, serve uma página,
 * e depois REAPONTA o DNS para `127.0.0.1`. A partir daí o browser considera a
 * página e o cockpit a MESMA ORIGEM — `sec-fetch-site: same-origin`, e o `origin`
 * casa com o do atacante, que é o da própria página. `classificar` respondia
 * `propria`, e mais: `decidir` libera TODA leitura antes de olhar a classe, então
 * a página lia conversa de lead, ids de execução e `runId` sem passar por nada.
 *
 * Checar `origin` não cobre isto por construção — depois do rebind a origem do
 * atacante É a origem da requisição, e ela é legítima do ponto de vista do
 * browser. O único cabeçalho que denuncia é o `Host`, porque o browser escreve
 * nele o nome que a pessoa digitou (`algum.dominio:4317`) e não o IP para o qual
 * ele resolveu. Um nome que não é o nosso não pode ser o nosso.
 *
 * FECHA PARA LEITURA TAMBÉM, e é o ponto: `MUTANTES` deixa `GET` de fora porque
 * leitura cruzada já é barrada pelo browser via CORS. Depois do rebind não é —
 * não há nada de cruzado. Então esta camada é a única do arquivo que recusa `GET`.
 *
 * A lista de hosts aceitos inclui as origens PAREADAS, senão a arquitetura
 * hospedada nasceria quebrada: se o app legítimo alcança o agente por um nome, o
 * `Host` vai ser esse nome. Pareado é explícito e é decisão de alguém; rebind é
 * um nome que ninguém autorizou. */
function hostsProprios(porta, origensPareadas) {
  const ok = new Set([
    `127.0.0.1:${porta}`, `localhost:${porta}`, `[::1]:${porta}`
  ]);
  for (const o of (Array.isArray(origensPareadas) ? origensPareadas : [])) {
    try { ok.add(new URL(String(o)).host.toLowerCase()); } catch { /* origem torta não vira host */ }
  }
  return ok;
}

/* `Host` ausente é recusa, não passe livre. HTTP/1.1 o exige; um cliente que o
   omite é anômalo, e anômalo na camada que decide rebind cai fechado. */
function hostConfere(req, porta, origensPareadas) {
  const h = (req && req.headers) || {};
  const bruto = typeof h.host === "string" ? h.host.trim().toLowerCase() : "";
  if (!bruto) return false;
  return hostsProprios(porta, origensPareadas).has(bruto);
}

/* Classifica de onde a requisição vem. Quatro classes, e `ausente` e `estranha`
 * NÃO podem ler igual: uma é cliente que não é browser (curl, script) e a outra
 * é um site tentando dirigir o agente. Levam a decisões opostas.
 *
 * `sec-fetch-site` vem primeiro porque script não consegue escrevê-lo — quem
 * escreve é o browser. `origin` é o segundo sinal e desaparece em alguns casos
 * legítimos; usar só ele seria fail-open exatamente onde não pode. */
function classificar(req, porta, origensPareadas) {
  const h = (req && req.headers) || {};
  const sitio = typeof h["sec-fetch-site"] === "string" ? h["sec-fetch-site"] : null;

  /* `Origin: null` É UMA ORIGEM DECLARADA, não uma ausência — e a diferença
   * decide se uma escrita passa. Um `<iframe sandbox>` sem `allow-same-origin`
   * manda exatamente essa string, e a versão anterior a convertia em `null` de
   * JavaScript, jogando a requisição no ramo `ausente`. Com o agente não pareado,
   * `ausente` responde `permite: true, exigeToken: false` — ou seja, um iframe
   * sandbox escrevia num fluxo de produção.
   *
   * `ausente` existe para o cliente que NÃO É BROWSER (curl, script local), e a
   * regra que este repositório já escreveu em cinco lugares vale aqui na direção
   * mais cara: campo ausente nunca cai no ramo permissivo. Uma origem opaca é uma
   * origem que existe e não é nossa, logo `estranha`. */
  const bruteOrigem = typeof h.origin === "string" ? h.origin : null;
  const origemOpaca = bruteOrigem === "null";
  const origem = bruteOrigem && !origemOpaca ? bruteOrigem : null;

  const proprias = origensProprias(porta);
  const pareadas = Array.isArray(origensPareadas) ? origensPareadas : [];

  const bruto = typeof h[CAB_TOKEN] === "string" ? h[CAB_TOKEN] : "";
  const m = /^Bearer\s+(\S+)$/i.exec(bruto.trim());
  const token = m ? m[1] : null;

  const muta = MUTANTES.has(String(req && req.method));

  const hostOk = hostConfere(req, porta, pareadas);

  let classe;
  /* Primeiro de tudo, e antes até de `origin`: depois de um rebind o `origin` é
     legítimo e o `Host` é o único que denuncia. Uma classe própria, porque
     `decidir` precisa recusá-la ANTES do ramo de leitura. */
  if (!hostOk) classe = "hostErrado";
  else if (origemOpaca) classe = "estranha";
  else if (origem && proprias.includes(origem)) classe = "propria";
  else if (origem && pareadas.includes(origem)) classe = "pareada";
  else if (origem) classe = "estranha";
  else if (sitio === "same-origin") classe = "propria";
  /* `sec-fetch-site: none` é navegação iniciada por pessoa (barra de endereço,
   * favorito). Num GET é o caso normal do painel abrindo. Num método mutante é
   * anomalia — browser não produz isso — então cai em `ausente` e passa a exigir
   * credencial, em vez de ser tratado como se fosse o próprio painel. */
  else if (sitio === "none" && !muta) classe = "propria";
  else if (sitio === "cross-site" || sitio === "same-site") classe = "estranha";
  else classe = "ausente";

  return { classe, origem, sitio, token, muta, hostOk };
}

/* A tabela de decisão. PURA — nada de rede, nada de disco, nada de relógio.
 *
 * `pareado` é o estado do agente: sem arquivo de pareamento ele não confia em
 * nenhuma origem hospedada, e o cockpit funciona exatamente como funciona hoje.
 * Isso não é gentileza com o setup atual: é o que permite a camada entrar sem
 * quebrar o uso corrente, e uma camada de segurança que quebra o uso corrente é
 * uma camada que alguém desliga na segunda-feira. */
function decidir({ metodo, classe, pareado }) {
  /* ANTES do ramo de leitura, e é a única checagem deste arquivo que recusa GET.
     O resto do arquivo deixa leitura passar porque o browser barra leitura
     cruzada sozinho, via CORS — mas depois de um DNS rebinding não existe nada
     de cruzado: a página do atacante e o cockpit são a mesma origem para o
     browser, e ele entrega o corpo. Conversa de lead, id de execução e `runId`
     saem por GET. Então esta linha vem primeiro, e recusa tudo. */
  if (classe === 'hostErrado') {
    return {
      permite: false, exigeToken: false, status: 403,
      motivo: 'esta requisição chegou com um nome de host que não é o deste agente'
    };
  }

  if (!MUTANTES.has(String(metodo))) {
    return { permite: true, exigeToken: false, status: 200, motivo: "leitura" };
  }

  if (classe === "propria") {
    return { permite: true, exigeToken: false, status: 200, motivo: "painel local" };
  }

  /* Origem conhecida e não pareada é 403 e nenhum token salva. Defesa em
   * profundidade de propósito: um token roubado não deve poder dirigir o agente
   * a partir da origem do atacante. */
  if (classe === "estranha") {
    return {
      permite: false, exigeToken: false, status: 403,
      motivo: "esta origem não está pareada com este agente"
    };
  }

  if (classe === "pareada") {
    if (!pareado) {
      return {
        permite: false, exigeToken: false, status: 403,
        motivo: "este agente não foi pareado com nenhuma conta"
      };
    }
    return { permite: true, exigeToken: true, status: 200, motivo: "origem pareada" };
  }

  /* `ausente`: nem `origin` nem `sec-fetch-site`. Na prática é cliente que não é
   * browser — curl, script, automação local.
   *
   * A barra SOBE COM O PAREAMENTO, e isso é a regra, não uma concessão. Enquanto
   * o agente não foi pareado não existe app hospedado, logo não existe token que
   * alguém pudesse apresentar: exigir credencial aqui seria recusa SEM SAÍDA, e
   * este repo já escreveu em três lugares que uma recusa tem que nomear o
   * caminho. Vale também que uma PÁGINA não consegue chegar nesta classe —
   * Chrome, Firefox e Safari atuais mandam `origin` em todo POST cruzado e
   * mandam `sec-fetch-site` em tudo, e script não escreve nenhum dos dois. Então
   * fechar aqui, sem pareamento, custaria a automação local e não compraria
   * defesa contra o atacante que este arquivo existe para barrar.
   *
   * Pareado, aperta: aí o token existe, e um cliente sem origem que não o
   * apresenta não tem por que estar mandando escrever. */
  if (!pareado) {
    return {
      permite: true, exigeToken: false, status: 200,
      motivo: "cliente local sem origem, agente não pareado"
    };
  }
  return {
    permite: true, exigeToken: true, status: 200,
    motivo: "requisição sem origem: exige credencial"
  };
}

/* ─────────────────────────────────────────────────── camada 1b: os cabeçalhos */

/* `access-control-allow-origin` sai SÓ para origem própria ou pareada. Para
 * `estranha` a resposta vai sem cabeçalho nenhum, e é isso que faz o browser
 * esconder o corpo de quem pediu — inclusive nos GET, que a tabela acima
 * libera. Liberar o método e não expor a resposta são duas coisas diferentes. */
function cabecalhosCors({ classe, origem }) {
  if (classe !== "propria" && classe !== "pareada") return {};
  if (!origem) return {};
  return {
    "access-control-allow-origin": origem,
    "access-control-allow-credentials": "true",
    "vary": "origin"
  };
}

/* O preflight. Existe por dois motivos, e o segundo não é segurança:
 *
 * 1. Exigir `authorization` faz de toda mutante uma requisição NÃO-simples, o
 *    que força este preflight. É aí que o CORS deixa de ser decorativo e passa
 *    a ser portão — é o efeito que a camada 1 compra.
 * 2. `access-control-allow-private-network` é REQUISITO DE FUNCIONAMENTO do
 *    Chrome para público→privado, não proteção. Safari e Firefox divergem, então
 *    nada aqui pode depender dele para segurar nada. */
function responderPreflight(req, res, { classe, origem }) {
  const h = (req && req.headers) || {};
  if (classe !== "propria" && classe !== "pareada") {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("origem não pareada");
    return true;
  }
  const cab = Object.assign(cabecalhosCors({ classe, origem }), {
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    "content-length": "0"
  });
  if (String(h["access-control-request-private-network"]) === "true") {
    cab["access-control-allow-private-network"] = "true";
  }
  res.writeHead(204, cab);
  res.end();
  return true;
}

/* ────────────────────────────── camada 2: a assinatura, e camada 3: o dono */

const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
let jwksCache = null; /* { chaves, buscadoEm, url } */

function b64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/* A chave pública do JWKS do Supabase. Sem dependência: `createPublicKey` aceita
 * JWK direto desde o Node 15.
 *
 * ARMADILHA MEDIDA: assinatura ES256 em JWT é R||S cru (IEEE P1363) e o padrão
 * do Node é DER. Sem `dsaEncoding: "ieee-p1363"` a verificação falha em TODO
 * token válido — e falha em silêncio, devolvendo `false` como se o token fosse
 * forjado. O sintoma aponta para o token; a causa está aqui. */
function conferirAssinatura(alg, dados, jwk, assinatura) {
  const chave = crypto.createPublicKey({ key: jwk, format: "jwk" });
  if (alg === "ES256") {
    return crypto.verify("sha256", dados, { key: chave, dsaEncoding: "ieee-p1363" }, assinatura);
  }
  if (alg === "RS256") return crypto.verify("sha256", dados, chave, assinatura);
  if (alg === "EdDSA") return crypto.verify(null, dados, chave, assinatura);
  return false;
}

async function buscarJwks(url) {
  if (!url) throw new Error("pareamento sem endereço de JWKS");
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.buscadoEm < JWKS_TTL_MS) {
    return { chaves: jwksCache.chaves, doCache: true };
  }
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`JWKS respondeu ${r.status}`);
  const corpo = await r.json();
  const chaves = Array.isArray(corpo && corpo.keys) ? corpo.keys : [];
  if (!chaves.length) throw new Error("JWKS sem chaves");
  jwksCache = { chaves, buscadoEm: Date.now(), url };
  return { chaves, doCache: false };
}

/* ATENÇÃO — ESTA FUNÇÃO ESTÁ PARA O KAUAN ESCREVER. É a política de quando o
 * agente NÃO CONSEGUE buscar o JWKS (máquina offline, Supabase fora, DNS
 * quebrado). Três leituras defensáveis:
 *
 *   fail-closed puro — nenhuma mutante sem JWKS fresco. Segurança máxima; quem
 *     está offline perde até o que não depende de rede.
 *   cache com TTL    — última chave boa vale por N horas. A janela é real: chave
 *     rotacionada por comprometimento segue aceita até vencer.
 *   misto            — fecha nas mutantes, abre nas leituras. Casa com a divisão
 *     que este repo já faz entre "emite fatos" e "escreve".
 *
 * `cacheado`: { chaves, buscadoEm } | null — último JWKS bom, se houver
 * `agora`:    number  — ms epoch, INJETADO. Nunca `Date.now()` aqui dentro, ou a
 *                       política deixa de ser testável.
 * `muta`:     boolean — esta rota escreve algo?
 *
 * O `motivo` vai para a tela, então tem que separar "não confirmei a assinatura"
 * de "assinatura inválida". Este repo já tem três casos em que ler igual custou
 * tempo. */
function decidirSemJwks({ cacheado, agora, muta }) {
  // TODO (Kauan): retorne { permite: boolean, motivo: string }
  throw new Error("decidirSemJwks: política não definida — ver o comentário acima");
}

/* As claims, numa definição só, porque são DUAS as saídas que precisam delas.
 *
 * O DEFEITO QUE ISTO FECHA, e ele era latente: o ramo offline devolvia
 * `{ ok: true, sub: corpo.sub, semAssinatura: true }` direto de um corpo NÃO
 * VERIFICADO — sem `exp`, sem `iss`, sem `aud` e, o que decide, sem a camada 3
 * (`corpo.sub === pareamento.dono`). Qualquer JWT recortado à mão com o `sub` de
 * outra conta dirigia o agente. Hoje aquele ramo é inalcançável porque
 * `decidirSemJwks` lança — mas DUAS das três políticas que o docblock dela
 * recomenda devolvem `permite: true`, então quem escrever o TODO entrega um
 * bypass de autenticação sem encostar nesta função. Uma lista só é o que torna
 * o ramo estruturalmente incapaz de pular as claims: enquanto eram duas, uma
 * delas estava vazia e nada no arquivo dizia isso.
 *
 * Devolve a RECUSA, ou `null` quando passou. Nunca `true`/`false`: um booleano
 * obrigaria cada chamador a reinventar o `status` e o `motivo`, que é a forma
 * como as duas listas divergiram da primeira vez. */
function conferirClaims(corpo, pareamento, agora) {
  /* Corpo que não é objeto (`null`, número, string) é `JSON.parse` legítimo e
   * não é um JWT. Cai fechado aqui em vez de estourar `TypeError` três linhas
   * abaixo, que o `server.js` converteria em 503 — "o cockpit quebrou" no lugar
   * de "sua credencial não presta" são histórias diferentes. */
  if (!corpo || typeof corpo !== "object") {
    return { ok: false, status: 401, motivo: "credencial ilegível" };
  }
  if (typeof corpo.exp !== "number" || corpo.exp * 1000 <= agora) {
    return { ok: false, status: 401, motivo: "credencial expirada" };
  }
  /* `nbf` não era olhado por ninguém. Um token emitido para valer só amanhã
   * valia HOJE, e quem o guarda nesse intervalo é justamente quem ainda não
   * deveria poder usá-lo. Ausente é legítimo (o Supabase não emite `nbf`), então
   * a recusa exige o campo EXISTIR e ser futuro — o contrário barraria todo
   * token real, que é a falha que faz alguém desligar o guarda. */
  if (typeof corpo.nbf === "number" && corpo.nbf * 1000 > agora) {
    return { ok: false, status: 401, motivo: "credencial ainda não vale" };
  }
  if (pareamento.iss && corpo.iss !== pareamento.iss) {
    return { ok: false, status: 401, motivo: "credencial de outro emissor" };
  }
  /* `if (corpo.aud && corpo.aud !== "authenticated")` ACEITAVA um token sem
   * `aud` nenhum — o erro que este repositório documenta seis vezes: campo
   * ausente caindo no galho permissivo. A audiência é o que separa um token de
   * usuário logado de um `anon` emitido para qualquer visitante, e um JWT que
   * não a declara não prova ser nenhum dos dois. Exigir a string é a mesma
   * direção de `exp`, que já era obrigatório. */
  if (corpo.aud !== "authenticated") {
    return { ok: false, status: 401, motivo: "credencial de outra audiência" };
  }
  if (!corpo.sub || corpo.sub !== pareamento.dono) {
    return { ok: false, status: 403, motivo: "esta credencial é de outra conta" };
  }
  return null;
}

/* Verifica o token e confere o dono. As duas coisas juntas de propósito: um
 * token com assinatura boa de OUTRA conta do mesmo app não serve, senão
 * qualquer cliente seu comanda o agente de qualquer outro. Essa é a camada 3, e
 * ela é uma linha — o que custa é ter o `dono` gravado no pareamento. */
async function verificarToken(token, pareamento, agora = Date.now()) {
  if (!pareamento) return { ok: false, status: 403, motivo: "agente sem pareamento" };
  if (!token) return { ok: false, status: 401, motivo: "requisição sem credencial" };

  const partes = String(token).split(".");
  if (partes.length !== 3) return { ok: false, status: 401, motivo: "credencial malformada" };

  let cab, corpo;
  try {
    cab = JSON.parse(b64url(partes[0]).toString("utf8"));
    corpo = JSON.parse(b64url(partes[1]).toString("utf8"));
  } catch {
    return { ok: false, status: 401, motivo: "credencial ilegível" };
  }

  if (!ALGS.has(String(cab && cab.alg))) {
    return { ok: false, status: 401, motivo: `algoritmo ${cab && cab.alg} não é aceito aqui` };
  }

  let chaves;
  try {
    ({ chaves } = await buscarJwks(pareamento.jwks));
  } catch {
    /* EM SEQUÊNCIA, e cada passo fecha sozinho. O ternário que estava aqui
     * decidia UMA coisa (a política offline) e devolvia OUTRA (um `ok: true`
     * sem claim nenhuma conferida), e é essa distância que fazia o buraco caber
     * numa linha só. Aqui a política só decide se o ramo continua; quem diz que
     * a credencial serve segue sendo `conferirClaims`, a mesma do ramo que
     * confere assinatura.
     *
     * A ordem "assinatura antes das claims" documentada abaixo não se aplica
     * neste ramo, e não é descuido: aqui assinatura nenhuma é conferida, então
     * responder "expirada" não conta a ninguém qual metade do token ele acertou
     * — não há metade certa a acertar. O que este ramo devolve quando passa
     * carrega `semAssinatura: true`, que é o único jeito honesto de dizer que a
     * camada 2 não rodou. */
    const d = decidirSemJwks({ cacheado: jwksCache, agora, muta: true });
    if (!d.permite) return { ok: false, status: 503, motivo: d.motivo };
    const recusa = conferirClaims(corpo, pareamento, agora);
    if (recusa) return recusa;
    return { ok: true, sub: corpo.sub, semAssinatura: true, motivo: d.motivo };
  }

  /* Sem fallback de chave única, e a AUSÊNCIA dele é a decisão. A versão
   * anterior caía em `chaves[0]` quando nenhum `kid` casava e o JWKS trazia
   * exatamente uma chave — adivinhar, dentro de uma rotina de SELEÇÃO de chave.
   * A assinatura ainda era conferida, então não era buraco escancarado; o que
   * era é silêncio no meio de uma ROTAÇÃO: o JWKS passa a servir a chave nova,
   * um token com `kid` antigo (ou inventado) segue sendo testado contra a única
   * que sobrou, e o motivo na tela deixa de nomear a causa. `kid` que não casa é
   * chave desconhecida, que é a recusa que já existia logo abaixo. */
  const jwk = chaves.find(k => k && k.kid === cab.kid);
  if (!jwk) return { ok: false, status: 401, motivo: "credencial assinada por chave desconhecida" };

  const dados = Buffer.from(`${partes[0]}.${partes[1]}`, "utf8");
  let boa = false;
  try { boa = conferirAssinatura(cab.alg, dados, jwk, b64url(partes[2])); } catch { boa = false; }
  if (!boa) return { ok: false, status: 401, motivo: "assinatura da credencial não confere" };

  /* Ordem: assinatura antes das claims. Ler `exp` de um token não verificado e
   * responder "expirada" contaria ao atacante qual metade do token ele acertou. */
  const recusa = conferirClaims(corpo, pareamento, agora);
  if (recusa) return recusa;

  return { ok: true, sub: corpo.sub, motivo: "credencial confere" };
}

/* ──────────────────────────────────────────────────────────── o pareamento */

/* Ausente = modo local: o agente não confia em nenhuma origem hospedada e o
 * painel funciona como hoje. Campo ausente NUNCA cai no galho negativo — este
 * arquivo é o sétimo lugar do repo a escrever essa frase, e aqui o galho
 * negativo seria confiar numa origem que ninguém pareou.
 *
 * `origens` exige `https://` por item: uma origem `http://` na lista seria uma
 * página em claro autorizada a mandar escrever num fluxo de produção. */
function lerPareamento(dir = __dirname) {
  try {
    const bruto = fs.readFileSync(path.join(dir, ".agente", "pareamento.json"), "utf8");
    const p = JSON.parse(bruto);
    if (!p || typeof p.dono !== "string" || !Array.isArray(p.origens)) return null;
    return {
      dono: p.dono,
      origens: p.origens.filter(o => typeof o === "string" && /^https:\/\/[^\s/]+$/.test(o)),
      jwks: typeof p.jwks === "string" ? p.jwks : null,
      iss: typeof p.iss === "string" ? p.iss : null,
      agenteId: typeof p.agenteId === "string" ? p.agenteId : null
    };
  } catch {
    return null;
  }
}

module.exports = {
  MUTANTES, ALGS, JWKS_TTL_MS,
  origensProprias, classificar, decidir,
  cabecalhosCors, responderPreflight,
  /* `conferirClaims` sai exportada pelo mesmo motivo de `decidir`: é PURA, e
     uma regra que decide quem comanda o agente tem que ser testável sem rede,
     sem par de chaves e sem JWKS. */
  verificarToken, conferirClaims, decidirSemJwks, lerPareamento,
  _jwks: () => jwksCache
};
