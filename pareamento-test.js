/* pareamento-test.js — a cerimônia que vincula o agente a um site hospedado.
 *
 * De graça: sem modelo, sem rede, sem servidor. Tudo o que toca disco toca um
 * diretório temporário do SO, criado por `mkdtemp` e removido num `finally`.
 *
 * O `.agente/` DO REPOSITÓRIO NÃO É TOCADO EM CASO NENHUM, e isso não é
 * educação: se o Kauan já estiver pareado, um teste que escrevesse ali trocaria
 * o pareamento vivo dele por um de mentira — e a única pista seria o painel
 * parar de funcionar. `pareamento.js` não tem `dir` padrão exatamente para que
 * um esquecimento aqui vire recusa e não escrita no lugar errado; o bloco 2
 * fixa isso.
 *
 * Dois casos são de INTEGRAÇÃO de verdade e carregam o arquivo:
 *   - o que foi gravado é lido de volta pelo `guarda.lerPareamento()` REAL;
 *   - o `agenteId` do arquivo é rederivado da pública do próprio arquivo.
 * Reimplementar o formato aqui provaria a cópia, não a ligação.
 *
 * Todo teto (prazo, tentativa) é exercido contra um RELÓGIO INJETADO. A lição do
 * `mutex-test.js`: um teto que não corta não falha, ele *para*, e teste pendurado
 * lê como "rodando".
 *
 * Uso: node pareamento-test.js
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const P = require("./pareamento");
const g = require("./guarda");

let ok = 0, mal = 0;
const falhas = [];
function t(nome, cond) {
  if (cond) { ok++; return; }
  mal++; falhas.push(nome);
}
function bloco(n) { console.log("\n── " + n); }

const DONO = "11111111-1111-4111-8111-111111111111";
const DONO2 = "22222222-2222-4222-8222-222222222222";
const ISS = "https://abc.supabase.co/auth/v1";
const JWKS = "https://abc.supabase.co/auth/v1/.well-known/jwks.json";
const SITE = "https://cockpit.vercel.app";

const raizTmp = fs.mkdtempSync(path.join(os.tmpdir(), "pareamento-test-"));
let seq = 0;
function novoDir() {
  const d = path.join(raizTmp, "ag" + (++seq));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* Abre a cerimônia capturando o código pelo canal injetado. É assim que o teste
   obtém o código, e é a prova viva de que ele não volta em retorno nenhum: se
   `iniciar` devolvesse, esta função não precisaria existir. */
function abrir(dir, extra) {
  let capturado = null;
  const r = P.iniciar(Object.assign({
    dir, origem: SITE, iss: ISS, jwks: JWKS, dono: DONO,
    mostrar: c => { capturado = c; }
  }, extra || {}));
  return { r, codigo: capturado };
}

/* Varredura recursiva, e ela olha `getOwnPropertyNames` de propósito: uma
   propriedade NÃO-ENUMERÁVEL escondendo a privada passaria por
   `Object.keys`/`JSON.stringify` e é justamente o truque que `gerarIdentidade`
   usa. Se algum dia alguém devolver a chave assim de outra função, esta varredura
   pega; olhar só o enumerável aprovaria o vazamento. */
function varrer(obj, alvo, vistos) {
  vistos = vistos || new Set();
  if (obj == null) return false;
  if (typeof obj === "string") return obj.includes(alvo);
  if (typeof obj !== "object") return false;
  if (vistos.has(obj)) return false;
  vistos.add(obj);
  for (const k of Object.getOwnPropertyNames(obj)) {
    if (String(k).includes(alvo)) return true;
    let v;
    try { v = obj[k]; } catch { continue; }
    if (varrer(v, alvo, vistos)) return true;
  }
  return false;
}

const fonte = fs.readFileSync(path.join(__dirname, "pareamento.js"), "utf8");
/* Fonte SEM COMENTÁRIO. A lição que o `dossie-tela-test.js` pagou e o
   `guarda-test.js` repete: dois casos ficaram verdes porque um comentário
   carregava o nome que o `includes` procurava. Um teste que casa dentro de
   comentário documenta a decisão no melhor caso e aprova a AUSÊNCIA dela no
   pior. */
const limpo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* Recorta o corpo de uma função de nível superior, contando chaves. */
function corpo(nome) {
  const i = limpo.indexOf("function " + nome + "(");
  if (i < 0) return "";
  let j = limpo.indexOf("{", i), n = 0;
  for (let k = j; k < limpo.length; k++) {
    if (limpo[k] === "{") n++;
    else if (limpo[k] === "}") { n--; if (n === 0) return limpo.slice(j, k + 1); }
  }
  return "";
}

try {

/* ══════════════════════════════════ 1. a identidade, e o id conferível */
bloco("1. identidade — o id sai da chave, nunca de um sorteio");

const ident = P.gerarIdentidade();
t("gera uma pública em PEM SPKI", /^-----BEGIN PUBLIC KEY-----/.test(ident.publica));
t("gera uma privada em PEM PKCS#8", /^-----BEGIN PRIVATE KEY-----/.test(ident.privada));
t("a chave é Ed25519 (uma codificação de assinatura só, sem a armadilha do ES256/DER)",
  crypto.createPublicKey(ident.publica).asymmetricKeyType === "ed25519");
t("o agenteId é derivado da pública, e a derivação é reprodutível",
  P.derivarAgenteId(ident.publica) === ident.agenteId);
t("...e tem prefixo legível", /^ag_[0-9a-f]{32}$/.test(ident.agenteId));

const ident2 = P.gerarIdentidade();
t("dois pares diferentes dão ids diferentes — o id não é constante",
  ident2.agenteId !== ident.agenteId);
t("REGRA 6 — `privada` é NÃO-ENUMERÁVEL: JSON.stringify não a leva",
  !JSON.stringify(ident).includes("PRIVATE"));
t("...nem Object.keys", Object.keys(ident).indexOf("privada") === -1);
t("...nem um spread, que é como uma rota vazaria sem querer",
  !JSON.stringify(Object.assign({}, ident)).includes("PRIVATE"));
t("...e ainda assim quem precisa dela a alcança por destructuring",
  (({ privada }) => /BEGIN PRIVATE KEY/.test(privada))(ident));
/* Hashear o SPKI e não os bytes crus é o que impede uma Ed25519 e uma P-256 de
   colidirem num mesmo id, e é o que faz trocar de curva não mudar a forma. */
const parEc = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
t("o id de uma chave de OUTRO algoritmo é diferente — o SPKI carrega o algoritmo",
  P.derivarAgenteId(parEc.publicKey.export({ type: "spki", format: "pem" })) !== ident.agenteId);

/* ══════════════════════════════════ 2. o caminho: duas camadas independentes */
bloco("2. caminho — `..` recusado antes de resolver, e provado depois");

t("REGRA 8 — `..` num componente do dir é recusado",
  P.caminhos(raizTmp + "/../x").ok === false);
t("...com categoria de caminho, não de disco",
  P.caminhos(raizTmp + "/../x").categoria === "caminho");
t("`..` sozinho é recusado", P.caminhos("..").ok === false);
t("`..` com contrabarra (Windows) é recusado igual", P.caminhos("C:\\a\\..\\b").ok === false);
t("caractere de controle no caminho é recusado",
  P.caminhos(raizTmp + "\u0000/etc").ok === false);
t("dir vazio é recusado — este módulo ESCREVE, e um padrão silencioso gravaria no repo",
  P.caminhos("").ok === false);
t("dir ausente é recusado", P.caminhos(undefined).ok === false);
t("dir que não é texto é recusado", P.caminhos({}).ok === false);
t("não existe `dir` padrão: `estado()` sem argumento não lê o repositório",
  P.estado().estado === "ilegivel");
t("...e `iniciar` sem dir também recusa", P.iniciar({ origem: SITE, iss: ISS, jwks: JWKS, dono: DONO }).ok === false);

const camOk = P.caminhos(raizTmp);
t("dir bom devolve os três caminhos", camOk.ok === true && !!camOk.base && !!camOk.pareamento && !!camOk.chave);
t("SEGUNDA CAMADA — o arquivo final está provadamente dentro de <dir>/.agente",
  camOk.pareamento === path.join(raizTmp, ".agente", "pareamento.json") &&
  camOk.chave === path.join(raizTmp, ".agente", "agente.key"));
t("`dentro()` recusa um `..` mesmo depois de tudo limpo",
  (() => { try { P.dentro(raizTmp, "../fora.json"); return false; } catch { return true; } })());
t("`dentro()` deixa passar um nome normal",
  P.dentro(raizTmp, "ok.json") === path.join(raizTmp, "ok.json"));
t("as duas camadas são independentes: a checagem de `..` não depende do resolve",
  /partes\.some\(p => p === "\.\."\)/.test(limpo) && /startsWith\(b \+ path\.sep\)/.test(limpo));

/* ══════════════════════════════════ 3. as normalizações */
bloco("3. origem, iss, jwks e código — o que entra e o que é recusado");

t("REGRA 4 — http:// é recusado", P.normalizarOrigem("http://x.example").ok === false);
t("...e o motivo diz que é sobre TLS, não sobre formato",
  /claro|TLS/i.test(P.normalizarOrigem("http://x.example").motivo));
t("https:// passa", P.normalizarOrigem("https://x.example").valor === "https://x.example");
t("caixa do host é abaixada — é a forma que o browser manda no header `origin`",
  P.normalizarOrigem("https://X.EXAMPLE").valor === "https://x.example");
t("caminho é descartado, sobra a origem", P.normalizarOrigem("https://x.example/painel").valor === "https://x.example");
t("...e a normalização é reportada como FATO, para a tela dizer o que pareou",
  P.normalizarOrigem("https://x.example/painel").normalizada === true);
t("origem já canônica não reporta normalização", P.normalizarOrigem(SITE).normalizada === false);
t("porta explícita sobrevive", P.normalizarOrigem("https://x.example:8443").valor === "https://x.example:8443");
t("userinfo é descartado (origem não tem usuário)",
  P.normalizarOrigem("https://malandro@x.example").valor === "https://x.example");
t("ftp:// é recusado", P.normalizarOrigem("ftp://x.example").ok === false);
t("texto que não é URL é recusado", P.normalizarOrigem("cockpit.vercel.app").ok === false);
t("vazio é recusado", P.normalizarOrigem("").ok === false);
t("não-texto é recusado", P.normalizarOrigem(42).ok === false);

/* A ponte com o guarda: tudo que este módulo aceita TEM que passar pelo regex
   de `lerPareamento`. Uma origem gravada que o guarda descarta é meio-pareamento
   — arquivo escrito, site sem poder, e nada na tela explicando. */
const aceitas = ["https://a.example", "https://b.example:8443", "https://sub.dom.example",
  "https://x.example/algo", "https://X.Example"]
  .map(s => P.normalizarOrigem(s)).filter(r => r.ok).map(r => r.valor);
t("toda origem aceita aqui passa pelo regex do guarda (o de verdade, transcrito)",
  aceitas.length === 5 && aceitas.every(o => /^https:\/\/[^\s/]+$/.test(o)));

t("iss em http:// é recusado", P.normalizarUrlHttps("http://a.b/auth/v1", "iss", "emissor").ok === false);
t("iss com caminho passa", P.normalizarUrlHttps(ISS, "iss", "emissor").valor === ISS);
t("jwks com caminho longo passa", P.normalizarUrlHttps(JWKS, "jwks", "jwks").valor === JWKS);
t("iss vazio é recusado", P.normalizarUrlHttps("", "iss", "emissor").ok === false);

t("código: separador e caixa saem", P.normalizarCodigo("ab2-c3d").valor === "AB2C3D");
t("código com caractere fora do alfabeto é recusado", P.normalizarCodigo("AB0C3D").ok === false);
t("...e a frase ensina quais caracteres existem", /0, 1, I nem O/.test(P.normalizarCodigo("ABIC3D").motivo));
t("código vazio é recusado", P.normalizarCodigo("").ok === false);
t("o alfabeto tem 32 caracteres e nenhum confusável",
  P.ALFABETO.length === 32 && !/[01IO]/.test(P.ALFABETO));
t("...e todos distintos", new Set(P.ALFABETO).size === 32);

/* REGRA 3: `timingSafeEqual` LANÇA com tamanhos diferentes. */
t("REGRA 3 — comparação usa timingSafeEqual", /timingSafeEqual/.test(limpo));
t("...e tamanhos diferentes devolvem false SEM lançar",
  (() => { try { return P.iguaisEmTempoConstante("ABC", "ABCDEF") === false; } catch { return false; } })());
t("...iguais dão true", P.iguaisEmTempoConstante("ABCDEF", "ABCDEF") === true);
t("...diferentes do mesmo tamanho dão false", P.iguaisEmTempoConstante("ABCDEF", "ABCDEG") === false);
t("...vazio contra vazio não estoura",
  (() => { try { return P.iguaisEmTempoConstante("", "") === true; } catch { return false; } })());

/* ══════════════════════════════════ 4. estado — TRÊS estados, nunca dois */
bloco("4. estado — pareado / não pareado / não deu para ler");

const dVazio = novoDir();
const e0 = P.estado(dVazio);
t("diretório limpo é `nao-pareado`", e0.estado === "nao-pareado");
t("...e diz por quê", typeof e0.porque === "string" && e0.porque.length > 10);
t("...e NÃO é `ilegivel` — as duas levam a decisões opostas", e0.estado !== "ilegivel");

const dLixo = novoDir();
fs.mkdirSync(path.join(dLixo, ".agente"));
fs.writeFileSync(path.join(dLixo, ".agente", "pareamento.json"), "{isso não é json");
const eLixo = P.estado(dLixo);
t("REGRA — JSON quebrado é `ilegivel`, e nunca `nao-pareado`", eLixo.estado === "ilegivel");
t("...e o motivo nomeia o JSON", /JSON/i.test(eLixo.porque));

const dZero = novoDir();
fs.mkdirSync(path.join(dZero, ".agente"));
fs.writeFileSync(path.join(dZero, ".agente", "pareamento.json"), "");
t("arquivo de ZERO byte é `ilegivel` (escrita interrompida), não `nao-pareado`",
  P.estado(dZero).estado === "ilegivel");
t("...e o motivo fala em escrita interrompida, que é o que zero byte significa",
  /interrompida|vazio/i.test(P.estado(dZero).porque));

const dGrande = novoDir();
fs.mkdirSync(path.join(dGrande, ".agente"));
fs.writeFileSync(path.join(dGrande, ".agente", "pareamento.json"), "x".repeat(P.TETO_ARQUIVO + 1));
t("acima do teto de arquivo é `ilegivel` antes de qualquer parse",
  P.estado(dGrande).estado === "ilegivel");

const dSemDono = novoDir();
fs.mkdirSync(path.join(dSemDono, ".agente"));
fs.writeFileSync(path.join(dSemDono, ".agente", "pareamento.json"),
  JSON.stringify({ origens: [SITE], jwks: JWKS }));
t("pareamento sem `dono` é `ilegivel` — sem a camada 3 não existe pareamento",
  P.estado(dSemDono).estado === "ilegivel");
t("...e o motivo nomeia o campo", /dono/.test(P.estado(dSemDono).porque));

const dSemOrigens = novoDir();
fs.mkdirSync(path.join(dSemOrigens, ".agente"));
fs.writeFileSync(path.join(dSemOrigens, ".agente", "pareamento.json"),
  JSON.stringify({ dono: DONO, origens: "https://x.example" }));
t("`origens` que não é lista é `ilegivel`", P.estado(dSemOrigens).estado === "ilegivel");

const dDir = novoDir();
fs.mkdirSync(path.join(dDir, ".agente", "pareamento.json"), { recursive: true });
t("um DIRETÓRIO no lugar do arquivo é `ilegivel`", P.estado(dDir).estado === "ilegivel");

/* Os três estados de `idConfere`, que é a mesma regra dos três estados aplicada
   dentro do módulo: ausente nunca cai no galho negativo. */
const dSemPub = novoDir();
fs.mkdirSync(path.join(dSemPub, ".agente"));
fs.writeFileSync(path.join(dSemPub, ".agente", "pareamento.json"),
  JSON.stringify({ dono: DONO, origens: [SITE], jwks: JWKS, iss: ISS, agenteId: "ag_deadbeef" }));
t("sem a pública gravada, `idConfere` é null — não é `false`, que seria acusação",
  P.estado(dSemPub).idConfere === null);

const dPubErrada = novoDir();
fs.mkdirSync(path.join(dPubErrada, ".agente"));
fs.writeFileSync(path.join(dPubErrada, ".agente", "pareamento.json"),
  JSON.stringify({ dono: DONO, origens: [SITE], jwks: JWKS, iss: ISS, agenteId: "ag_00000000000000000000000000000000", publica: ident.publica }));
t("pública que não bate com o id dá `idConfere` false", P.estado(dPubErrada).idConfere === false);
t("...e os três valores de idConfere são distintos",
  new Set([P.estado(dSemPub).idConfere, P.estado(dPubErrada).idConfere, true]).size === 3);

t("`estado()` nunca lança, nem com dir maluco",
  (() => { try { P.estado("\u0000"); P.estado(null); P.estado(123); return true; } catch { return false; } })());

/* ══════════════════════════════════ 5. iniciar */
bloco("5. iniciar — abre a cerimônia, e não escreve nada");

P.esquecerCerimonia();
const dA = novoDir();
const aberto = abrir(dA);
t("iniciar com tudo certo abre", aberto.r.ok === true);
t("o canal recebeu o código, formatado", /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(aberto.codigo));
t("REGRA 1 — o código NÃO está no retorno, em campo nenhum, em profundidade nenhuma",
  !varrer(aberto.r, aberto.codigo.replace("-", "")) && !varrer(aberto.r, aberto.codigo));
t("...e não há campo chamado `codigo` no retorno", !("codigo" in aberto.r));
t("o retorno diz ONDE o código está, senão a pessoa não acha",
  typeof aberto.r.onde === "string" && aberto.r.onde.length > 10);
t("REGRA — iniciar NÃO toca o disco: nem `.agente` é criado",
  !fs.existsSync(path.join(dA, ".agente")));
t("...e o estado continua `nao-pareado` com a cerimônia aberta",
  P.estado(dA).estado === "nao-pareado");
t("o desafio tem entropia de sobra", /^d_[0-9a-f]{32}$/.test(aberto.r.desafio));
t("o prazo e o teto viajam no retorno, para a tela poder contar",
  aberto.r.prazoMs === P.PRAZO_MS && aberto.r.tentativas === P.TETO_TENTATIVAS);
t("`estado()` mostra a cerimônia em andamento — sem o código",
  P.estado(dA).desafio && P.estado(dA).desafio.desafio === aberto.r.desafio &&
  !varrer(P.estado(dA), aberto.codigo.replace("-", "")));

/* ZERA ANTES DE CADA CASO DE VALIDAÇÃO, e isto não é arrumação.
 *
 * Desde a trava de substituição (bloco 5b), `iniciar` recusa DE SAÍDA enquanto
 * existe cerimônia viva para o mesmo agente — antes de olhar origem, iss, jwks
 * ou dono. Sem zerar, todos os casos abaixo continuariam VERDES pelo motivo
 * errado: recusados por "já existe cerimônia" em vez de pelo defeito que cada um
 * nomeia, e o arquivo pararia de provar a validação sem nada ficar vermelho.
 * É a mesma classe do caso que casava dentro de comentário no
 * `dossie-tela-test.js`: verde que aprova a ausência da decisão. */
const zerar = () => P.esquecerCerimonia();

zerar();
t("REGRA 4 — origem http:// nem abre cerimônia",
  P.iniciar({ dir: dA, origem: "http://x.example", iss: ISS, jwks: JWKS, dono: DONO, mostrar: () => {} }).ok === false);
zerar();
t("iss em http:// não abre",
  P.iniciar({ dir: dA, origem: SITE, iss: "http://a.b/auth/v1", jwks: JWKS, dono: DONO, mostrar: () => {} }).ok === false);
zerar();
t("jwks em http:// não abre",
  P.iniciar({ dir: dA, origem: SITE, iss: ISS, jwks: "http://a.b/jwks.json", dono: DONO, mostrar: () => {} }).ok === false);

/* O endurecimento que a confirmação humana NÃO cobre: ela prova que a pessoa
   está na máquina, não que o pacote que ela colou é honesto. */
zerar();
const jwksAlheio = P.iniciar({ dir: dA, origem: SITE, iss: ISS, jwks: "https://atacante.example/jwks.json", dono: DONO, mostrar: () => {} });
t("JWKS de OUTRA origem que o emissor é recusado — quem escolhe o JWKS escolhe a chave",
  jwksAlheio.ok === false && jwksAlheio.categoria === "jwks");
t("...e o motivo explica o que isso permitiria", /chave/i.test(jwksAlheio.motivo));
/* A categoria é o que prova que a recusa veio do lugar certo: `jwks` e não
   `desafio`. Sem ela, a trava de substituição atendendo no lugar do portão do
   JWKS seria indistinguível de o portão do JWKS funcionando. */
t("...e a categoria é `jwks`, não a da trava de cerimônia", jwksAlheio.categoria !== "desafio");

zerar();
t("dono ausente não abre",
  P.iniciar({ dir: dA, origem: SITE, iss: ISS, jwks: JWKS, mostrar: () => {} }).ok === false);
zerar();
t("dono com espaço no meio não abre (colado pela metade)",
  P.iniciar({ dir: dA, origem: SITE, iss: ISS, jwks: JWKS, dono: "1111 2222", mostrar: () => {} }).ok === false);
zerar();
t("dono curto demais não abre",
  P.iniciar({ dir: dA, origem: SITE, iss: ISS, jwks: JWKS, dono: "abc", mostrar: () => {} }).ok === false);
zerar();
t("dono que não é uuid ABRE, e a forma vai como fato — recusar por forma travaria a pessoa fora",
  (() => { const r = P.iniciar({ dir: dA, origem: SITE, iss: ISS, jwks: JWKS, dono: "usuario-legado-12345", mostrar: () => {} });
    return r.ok === true && r.formaDono === "estranha"; })());
zerar();
t("...e um uuid é reportado como uuid", abrir(dA).r.formaDono === "uuid");

zerar();
t("sem origem nenhuma não abre",
  P.iniciar({ dir: dA, origens: [], iss: ISS, jwks: JWKS, dono: DONO, mostrar: () => {} }).ok === false);
zerar();
t("acima de MAX_ORIGENS não abre",
  P.iniciar({ dir: dA, origens: ["https://a.ex", "https://b.ex", "https://c.ex", "https://d.ex", "https://e.ex"], iss: ISS, jwks: JWKS, dono: DONO, mostrar: () => {} }).ok === false);
zerar();
t("origem repetida não abre — a lista é o que decide quem escreve em produção",
  P.iniciar({ dir: dA, origens: [SITE, SITE], iss: ISS, jwks: JWKS, dono: DONO, mostrar: () => {} }).ok === false);
zerar();
t("duas origens distintas abrem (produção e preview é o caso legítimo)",
  P.iniciar({ dir: dA, origens: [SITE, "https://preview.vercel.app"], iss: ISS, jwks: JWKS, dono: DONO, mostrar: () => {} }).origens.length === 2);
t("uma recusa não deixa cerimônia pendurada com dados errados",
  P.estado(dA).desafio !== null);

/* ═════════════════════ 5b. a cerimônia viva NÃO é substituída (o desvio de auth)
 *
 * O DEFEITO, medido contra o desenho e não imaginado. Nada amarra uma cerimônia
 * ao cliente que a abriu, e `guarda.decidir()` libera mutante SEM TOKEN para
 * cliente local que não é browser enquanto o agente não está pareado. Então, com
 * o Kauan no meio do pareamento em `/integracoes`, um processo local qualquer
 * chamava `iniciar` com a origem DELE — e a cerimônia do Kauan era trocada em
 * silêncio. A tela dele faz poll, adota `desafio`/`origens`/`dono` novos, ele lê
 * no console o código MAIS RECENTE (o do atacante) e confirma. Saída: agente
 * pareado com o site do atacante, que alcança `/api/claude/run/:id/approve`
 * (grava num fluxo vivo do n8n) e `/retry` (mensagem real para um lead, sem
 * desfazer).
 *
 * A confirmação humana não cobre isso: ela prova que a pessoa conferiu SEIS
 * CARACTERES, nunca que os seis são da cerimônia que ela abriu. */
bloco("5b. cerimônia viva não é substituída — só cancelada");

zerar();
const dSub = novoDir();
const legitima = abrir(dSub, { agora: 1_000_000 });
t("a primeira cerimônia abre normalmente", legitima.r.ok === true);

const invasao = P.iniciar({
  dir: dSub, origem: "https://evil.example", iss: "https://mal.supabase.co/auth/v1",
  jwks: "https://mal.supabase.co/auth/v1/.well-known/jwks.json", dono: DONO2,
  agora: 1_000_000 + 1000, mostrar: () => {}
});
t("a segunda, com a primeira viva, é RECUSADA — não substitui", invasao.ok === false);
t("...e a categoria é `desafio`", invasao.categoria === "desafio");
t("...e a recusa NOMEIA o cancelamento, senão o agente fica intravável até reiniciar",
  /cancel/i.test(invasao.motivo));
t("...e o código do atacante nem chegou a ser mostrado",
  (() => { let mostrou = false;
    P.iniciar({ dir: dSub, origem: "https://evil.example", iss: ISS, jwks: JWKS, dono: DONO2,
      agora: 1_000_000 + 1000, mostrar: () => { mostrou = true; } });
    return mostrou === false; })());

/* O QUE A TELA DELE VÊ é o que decide se o ataque funciona: se a cerimônia viva
   fosse trocada, o poll adotaria o desafio e a origem do atacante. */
const depois = P.estado(dSub, 1_000_000 + 1000);
t("a cerimônia viva continua sendo a DELE — mesmo desafio",
  depois.desafio && depois.desafio.desafio === legitima.r.desafio);
t("...com a origem DELE, não a do atacante",
  depois.desafio.origens.length === 1 && depois.desafio.origens[0] === SITE);
t("...e com a conta DELE", depois.desafio.dono === DONO);

/* O código antigo continua valendo: uma recusa que invalidasse a cerimônia
   legítima seria negação de serviço com outro nome — bastaria bater na rota. */
t("e o código da cerimônia legítima continua confirmando",
  P.confirmar({ dir: dSub, desafio: legitima.r.desafio, codigo: legitima.codigo, agora: 1_000_000 + 2000 }).ok === true);

/* Os dois casos em que substituir é legítimo, e cada um por um motivo diferente:
   cerimônia VENCIDA não é cerimônia, e cerimônia de OUTRO agente não é esta. */
zerar();
const dExp = novoDir();
const velha = abrir(dExp, { agora: 5_000_000 });
const depoisDoPrazo = P.iniciar({ dir: dExp, origem: SITE, iss: ISS, jwks: JWKS, dono: DONO,
  agora: 5_000_000 + P.PRAZO_MS, mostrar: () => {} });
t("cerimônia VENCIDA pode ser substituída — travar 5 minutos por uma porta sem nada atrás seria pior",
  depoisDoPrazo.ok === true);
t("...e o retorno DIZ qual desafio ela substituiu, senão sobram dois códigos no console sem explicação",
  depoisDoPrazo.substituiuDesafio === velha.r.desafio);

zerar();
const dOutro1 = novoDir(), dOutro2 = novoDir();
abrir(dOutro1, { agora: 7_000_000 });
t("cerimônia aberta para OUTRO agente não bloqueia este",
  P.iniciar({ dir: dOutro2, origem: SITE, iss: ISS, jwks: JWKS, dono: DONO, agora: 7_000_000 + 1000, mostrar: () => {} }).ok === true);

/* Cancelar é a saída que a frase promete. Se ela não funcionasse, a recusa
   acima estaria mandando a pessoa para uma porta que não abre. */
zerar();
const dCanc = novoDir();
abrir(dCanc, { agora: 9_000_000 });
t("cancelar devolve `havia: true` quando havia cerimônia", P.esquecerCerimonia() === true);
t("...e depois de cancelar, abrir de novo funciona",
  P.iniciar({ dir: dCanc, origem: SITE, iss: ISS, jwks: JWKS, dono: DONO, agora: 9_000_000 + 1000, mostrar: () => {} }).ok === true);

/* Não existe segundo caminho para trocar a cerimônia: a única atribuição a
   `cerimonia = {` no arquivo é a do `iniciar`, e ela está DEPOIS da trava.
   Sem este caso, um `iniciar` alternativo colado adiante passaria despercebido —
   é a mesma vigilância do bloco 10 sobre o único ponto de escrita. */
t("REGRA — a trava vem ANTES da única atribuição que abre cerimônia",
  (() => {
    const f = fonte.replace(/\/\*[\s\S]*?\*\//g, " ");
    const iTrava = f.indexOf("cerimonia.base === cam.base");
    const iAbre = f.indexOf("cerimonia = {");
    return iTrava > 0 && iAbre > 0 && iTrava < iAbre;
  })());
t("...e `cerimonia = {` aparece uma vez só no arquivo",
  (fonte.replace(/\/\*[\s\S]*?\*\//g, " ").match(/cerimonia\s*=\s*\{/g) || []).length === 1);

/* ══════════════════════════════════ 6. confirmar */
bloco("6. confirmar — código, teto de tentativa, prazo e uso único");

P.esquecerCerimonia();
const dB = novoDir();
t("confirmar sem cerimônia aberta é recusado",
  P.confirmar({ dir: dB, desafio: "d_x", codigo: "AB2C3D" }).ok === false);
t("...e nada foi gravado", P.estado(dB).estado === "nao-pareado");

let b = abrir(dB);
t("desafio errado é recusado", P.confirmar({ dir: dB, desafio: "d_outro", codigo: b.codigo }).ok === false);
t("...sem gastar tentativa (não é palpite do código)",
  !!P.estado(dB).desafio && P.estado(dB).desafio.tentativasRestantes === P.TETO_TENTATIVAS);

const outroDir = novoDir();
t("REGRA — cerimônia aberta num diretório não confirma noutro",
  P.confirmar({ dir: outroDir, desafio: b.codigo && b.r.desafio, codigo: b.codigo }).ok === false);
t("...e o de fora continua não pareado", P.estado(outroDir).estado === "nao-pareado");

const malformado = P.confirmar({ dir: dB, desafio: b.r.desafio, codigo: "AB0C3D" });
t("código com caractere fora do alfabeto é recusado", malformado.ok === false);
t("...e NÃO gasta tentativa: teto é contra adivinhação, não contra erro de digitação",
  malformado.tentativasRestantes === P.TETO_TENTATIVAS);

const curto = P.confirmar({ dir: dB, desafio: b.r.desafio, codigo: "AB2C3" });
t("código de tamanho errado é recusado", curto.ok === false);
t("...e também não gasta tentativa", curto.tentativasRestantes === P.TETO_TENTATIVAS);
t("...e a frase diz o tamanho certo", new RegExp(String(P.TAM_CODIGO)).test(curto.motivo));

/* Um código bem formado e errado: esse é palpite, e gasta. */
function erradoDe(codigo) {
  const c = codigo.replace("-", "");
  const ult = c[5];
  const outro = P.ALFABETO[(P.ALFABETO.indexOf(ult) + 1) % P.ALFABETO.length];
  return c.slice(0, 5) + outro;
}
const err1 = P.confirmar({ dir: dB, desafio: b.r.desafio, codigo: erradoDe(b.codigo) });
t("REGRA 5 — código bem formado e errado gasta tentativa", err1.tentativasRestantes === P.TETO_TENTATIVAS - 1);
t("...e é recusado", err1.ok === false && err1.categoria === "codigo");
t("...e nada foi gravado", P.estado(dB).estado === "nao-pareado");

/* Estoura o teto: a cerimônia INTEIRA morre, não só a tentativa. Uma tentativa
   já foi gasta acima, então faltam `TETO - 1` — contar isso é o que faz o caso
   discriminar entre "a cerimônia morreu no teto" e "a cerimônia já não existia".
   Se o laço passar do teto, a recusa vira categoria `desafio` e o caso ficaria
   verde pelo motivo errado. */
let ultima = null;
for (let i = 0; i < P.TETO_TENTATIVAS - 1; i++) {
  ultima = P.confirmar({ dir: dB, desafio: b.r.desafio, codigo: erradoDe(b.codigo) });
  t("tentativa " + (i + 2) + " de " + P.TETO_TENTATIVAS + " ainda é recusa de código, não fim",
    i === P.TETO_TENTATIVAS - 2 ? ultima.categoria === "teto" : ultima.categoria === "codigo");
}
t("REGRA 5 — estourado o teto, a recusa é de categoria `teto`", ultima.categoria === "teto");
t("...e a frase diz que a cerimônia morreu inteira", /encerrada|inteira/i.test(ultima.motivo));
t("...e o CÓDIGO CERTO depois disso não vale mais — morreu a cerimônia, não a tentativa",
  P.confirmar({ dir: dB, desafio: b.r.desafio, codigo: b.codigo }).ok === false);
t("...e o agente continua não pareado", P.estado(dB).estado === "nao-pareado");
t("...e não sobrou cerimônia no estado", P.estado(dB).desafio === null);

/* O prazo, contra relógio injetado. Se o código lesse `Date.now()` em vez do
   `agora` recebido, estes dois casos ficariam vermelhos — é isso que os torna
   discriminantes em vez de decorativos. */
P.esquecerCerimonia();
const dC = novoDir();
const T0 = 1_700_000_000_000;
let c1 = abrir(dC, { agora: T0 });
t("um milissegundo ANTES do vencimento ainda vale",
  P.confirmar({ dir: dC, desafio: c1.r.desafio, codigo: c1.codigo, agora: T0 + P.PRAZO_MS - 1 }).ok === true);
P.desparear(dC);

P.esquecerCerimonia();
c1 = abrir(dC, { agora: T0 });
const venceu = P.confirmar({ dir: dC, desafio: c1.r.desafio, codigo: c1.codigo, agora: T0 + P.PRAZO_MS });
t("REGRA 2 — no vencimento exato o código já não vale", venceu.ok === false);
t("...com categoria `prazo`, distinta de `codigo` (frases que levam a ações diferentes)",
  venceu.categoria === "prazo" && venceu.categoria !== "codigo");
t("...e a cerimônia expirada é destruída, não fica pendurada", P.estado(dC).desafio === null);
t("...e nada foi gravado", P.estado(dC).estado === "nao-pareado");
t("o prazo é curto e declarado (<= 10 min)", P.PRAZO_MS > 0 && P.PRAZO_MS <= 10 * 60 * 1000);

/* Uso único. */
P.esquecerCerimonia();
const dD = novoDir();
const d1 = abrir(dD);
const acerto = P.confirmar({ dir: dD, desafio: d1.r.desafio, codigo: d1.codigo });
t("o código certo pareia", acerto.ok === true);
t("REGRA 2 — o MESMO código não vale uma segunda vez",
  P.confirmar({ dir: dD, desafio: d1.r.desafio, codigo: d1.codigo }).ok === false);
t("...e o estado depois do acerto tem a cerimônia zerada", P.estado(dD).desafio === null);

/* ESTES TRÊS CASOS MUDARAM DE LADO, e a premissa deles morreu por segurança —
   não estão apagados de propósito, porque apagar uma garantia inconveniente é
   trocá-la por nada. O texto antigo era "uma cerimônia nova invalida a anterior,
   senão o teto de 5 tentativas vira 5 POR cerimônia aberta". A preocupação era
   legítima e a solução estava invertida: substituir era exatamente o desvio de
   autenticação do bloco 5b. Agora a segunda nem abre.

   O TETO CONTINUA COBERTO, e por um caminho mais forte: com uma cerimônia viva
   não existe segunda cerimônia para dividir o teto. Cancelar e reabrir devolve 5
   tentativas — e sempre devolveu —, o que não é buraco porque o código é
   SORTEADO DE NOVO a cada abertura: são 32^6 possibilidades, então reabrir não
   aproxima ninguém de acertar, só reinicia uma loteria. */
P.esquecerCerimonia();
const dE = novoDir();
const e1 = abrir(dE);
const e2 = abrir(dE);
t("abrir de novo NÃO substitui: a segunda é recusada", e2.r.ok === false);
t("...e nenhuma cerimônia nova nasceu, então não há `substituiuDesafio`",
  e2.r.substituiuDesafio === undefined);
t("...o código da PRIMEIRA continua sendo o que confirma",
  P.confirmar({ dir: dE, desafio: e1.r.desafio, codigo: e1.codigo }).ok === true);

t("`esquecerCerimonia` existe e diz se havia alguma (é o botão cancelar da tela)",
  (() => { P.esquecerCerimonia(); const dz = novoDir(); abrir(dz); return P.esquecerCerimonia() === true && P.esquecerCerimonia() === false; })());

/* ══════════════════ 7. INTEGRAÇÃO: o guarda de verdade lê o que foi gravado */
bloco("7. integração — `guarda.lerPareamento()` REAL lê o arquivo escrito aqui");

P.esquecerCerimonia();
const dG = novoDir();
const g1 = abrir(dG, { origens: [SITE, "https://preview.vercel.app"] });
const gravado = P.confirmar({ dir: dG, desafio: g1.r.desafio, codigo: g1.codigo });
t("confirmou", gravado.ok === true);

const lido = g.lerPareamento(dG);
t("O CASO QUE CARREGA O ARQUIVO — o guarda lê o arquivo gravado aqui", lido !== null);
t("...e o dono chega inteiro (é a camada 3)", !!lido && lido.dono === DONO);
t("...e as duas origens sobrevivem ao filtro https do guarda",
  !!lido && lido.origens.length === 2 && lido.origens.includes(SITE));
t("...e o jwks", !!lido && lido.jwks === JWKS);
t("...e o iss", !!lido && lido.iss === ISS);
t("...e o agenteId", !!lido && lido.agenteId === gravado.agenteId);
t("`confirmar` já tinha conferido isso sozinho, e diz que conferiu",
  gravado.conferidoPeloGuarda === true);

/* A volta completa: com este arquivo no lugar, a tabela de decisão do guarda
   libera a origem pareada — que é o efeito inteiro desta cerimônia. */
const cls = g.classificar({ method: "POST", headers: { origin: SITE, host: "127.0.0.1:4317" } }, 4317, (lido||{}).origens || []);
t("uma requisição vinda do site pareado classifica como `pareada`", cls.classe === "pareada");
t("...e `decidir` a permite exigindo token",
  g.decidir({ metodo: "POST", classe: "pareada", pareado: !!lido }).permite === true &&
  g.decidir({ metodo: "POST", classe: "pareada", pareado: !!lido }).exigeToken === true);
const clsOutro = g.classificar({ method: "POST", headers: { origin: "https://evil.example", host: "127.0.0.1:4317" } }, 4317, (lido||{}).origens || []);
t("...e um site NÃO pareado continua `estranha`", clsOutro.classe === "estranha");

/* O segundo caso de integração exigido: o id do arquivo bate com a pública do
   arquivo. Rederivado do próprio documento, não do retorno da função. */
const doc = JSON.parse(fs.readFileSync(path.join(dG, ".agente", "pareamento.json"), "utf8"));
t("o arquivo carrega a pública", typeof doc.publica === "string" && /BEGIN PUBLIC KEY/.test(doc.publica));
t("O OUTRO CASO QUE CARREGA — o agenteId do arquivo é o derivado da pública do arquivo",
  P.derivarAgenteId(doc.publica) === doc.agenteId);
t("`estado()` confere isso sozinho e reporta", P.estado(dG).idConfere === true);
t("o documento carrega versão", doc.versao === P.VERSAO);
t("o documento carrega a data da cerimônia", typeof doc.em === "string" && !isNaN(Date.parse(doc.em)));

/* ══════════════════════════════════ 8. a privada nunca sai */
bloco("8. a chave privada — nunca em retorno, nunca em erro, nunca no documento");

const privBytes = fs.readFileSync(path.join(dG, ".agente", "agente.key"), "utf8");
t("a privada foi gravada em arquivo SEPARADO", /BEGIN PRIVATE KEY/.test(privBytes));
t("REGRA 6 — o `pareamento.json` não tem a privada",
  !fs.readFileSync(path.join(dG, ".agente", "pareamento.json"), "utf8").includes("PRIVATE KEY"));
const miolo = privBytes.split("\n").filter(l => l && !l.startsWith("-----")).join("");
t("REGRA 6 — `confirmar` não devolve a privada, em profundidade nenhuma",
  !varrer(gravado, "PRIVATE") && !varrer(gravado, miolo.slice(0, 24)));
t("REGRA 6 — `estado` não devolve a privada", !varrer(P.estado(dG), "PRIVATE") && !varrer(P.estado(dG), miolo.slice(0, 24)));
t("REGRA 6 — `iniciar` não devolve a privada", !varrer(g1.r, "PRIVATE"));
t("REGRA 6 — `desparear` não devolve a privada",
  (() => { const dz = novoDir(); P.esquecerCerimonia(); const z = abrir(dz);
    P.confirmar({ dir: dz, desafio: z.r.desafio, codigo: z.codigo });
    const r = P.desparear(dz); return !varrer(r, "PRIVATE"); })());
t("nenhum retorno tem campo com nome de segredo",
  !varrer(gravado, "privada") && !varrer(P.estado(dG), "privada") && !varrer(g1.r, "privada"));
t("`estado` reporta que existe chave, sem entregá-la", P.estado(dG).temChave === true);
t("a fonte não imprime a privada em log nenhum",
  !/console\.(log|error|warn)[^\n]*privada/.test(limpo));
t("a fonte não põe a privada em mensagem de erro",
  !/Error\([^)]*privada/.test(limpo));

/* ══════════════════════════════════ 9. escrita atômica e rollback */
bloco("9. escrita atômica — e uma falha no meio não destrói o pareamento bom");

t("REGRA 7 — sobrou nada de `.tmp` depois de uma gravação boa",
  fs.readdirSync(path.join(dG, ".agente")).filter(n => n.endsWith(".tmp")).length === 0);
t("...e existem exatamente os dois arquivos esperados",
  fs.readdirSync(path.join(dG, ".agente")).sort().join(",") === "agente.key,pareamento.json");
t("REGRA 7 — existe UM único primitivo de escrita na fonte",
  (limpo.match(/fs\.writeFileSync\(/g) || []).length === 1 &&
  (limpo.match(/fs\.renameSync\(/g) || []).length === 1);
t("...e ele é temp + fsync + rename, não um write direto",
  /fs\.openSync\(tmp/.test(limpo) && /fs\.fsyncSync\(fd\)/.test(limpo) && /fs\.renameSync\(tmp, destino\)/.test(limpo));
t("...com o fsync ANTES do rename (senão o rename publica um bloco vazio)",
  limpo.indexOf("fs.fsyncSync(fd)") < limpo.indexOf("fs.renameSync(tmp, destino)"));

/* A falha no meio, simulada trocando `fs.renameSync` — o módulo faz a busca da
   propriedade em tempo de chamada, então a troca pega. */
P.esquecerCerimonia();
const dR = novoDir();
const r1 = abrir(dR);
P.confirmar({ dir: dR, desafio: r1.r.desafio, codigo: r1.codigo });
const antesDono = P.estado(dR).dono;
const antesId = P.estado(dR).agenteId;
const antesChave = fs.readFileSync(path.join(dR, ".agente", "agente.key"), "utf8");

const renameReal = fs.renameSync;
let explodiu = false;
fs.renameSync = function (a, bb) {
  if (!explodiu && String(bb).endsWith(P.ARQ_PAREAMENTO)) { explodiu = true; throw new Error("disco cheio (simulado)"); }
  return renameReal(a, bb);
};
const r2 = abrir(dR, { dono: DONO2 });
const falhou = P.confirmar({ dir: dR, desafio: r2.r.desafio, codigo: r2.codigo });
fs.renameSync = renameReal;

t("REGRA 10 — gravação que falha no meio RECUSA", falhou.ok === false && falhou.categoria === "disco");
t("...e a frase diz que nada foi pareado", /nada foi pareado/i.test(falhou.motivo));
t("REGRA 10 — o pareamento que funcionava foi restaurado byte a byte",
  P.estado(dR).dono === antesDono && P.estado(dR).agenteId === antesId);
t("...inclusive a chave privada anterior, senão a identidade restaurada não teria par",
  fs.readFileSync(path.join(dR, ".agente", "agente.key"), "utf8") === antesChave);
t("...e o guarda continua aceitando o antigo", (g.lerPareamento(dR) || {}).dono === antesDono);
t("...e o `.tmp` da tentativa morta não ficou para trás",
  fs.readdirSync(path.join(dR, ".agente")).filter(n => n.endsWith(".tmp")).length === 0);
t("...e a cerimônia foi consumida do mesmo jeito (uso único vale mesmo na falha)",
  P.confirmar({ dir: dR, desafio: r2.r.desafio, codigo: r2.codigo }).ok === false);

/* O caso acima NÃO exercita a restauração, e isso foi achado por mutante: com o
   `rename` explodindo, o `pareamento.json` antigo nunca chega a ser sobrescrito,
   então ele sobrevive sozinho e o mutante que apaga o `restaurar` fica VERDE.
   A restauração só importa na outra falha: a gravação DEU CERTO e a releitura
   pelo guarda recusou. É esse o caso que destrói um pareamento bom sem o
   rollback, e é ele que precisa de teste. */
P.esquecerCerimonia();
const dS = novoDir();
const s1 = abrir(dS);
P.confirmar({ dir: dS, desafio: s1.r.desafio, codigo: s1.codigo });
const sDono = P.estado(dS).dono;
const sId = P.estado(dS).agenteId;
const sChave = fs.readFileSync(path.join(dS, ".agente", "agente.key"), "utf8");
const sBytes = fs.readFileSync(path.join(dS, ".agente", "pareamento.json"), "utf8");

const lerReal = g.lerPareamento;
let recusouUmaVez = false;
g.lerPareamento = function (dir) {
  if (!recusouUmaVez) { recusouUmaVez = true; return null; }
  return lerReal.call(g, dir);
};
const s2 = abrir(dS, { dono: DONO2, origens: ["https://outro.exemplo.app"] });
const reprovado = P.confirmar({ dir: dS, desafio: s2.r.desafio, codigo: s2.codigo });
g.lerPareamento = lerReal;

t("REGRA 10 — gravou e o guarda NÃO aceitou: recusa", reprovado.ok === false);
t("...e o motivo diz que o guarda recusou na releitura", /releitura|guarda/i.test(reprovado.motivo));
t("REGRA 10 — e o pareamento bom anterior volta BYTE A BYTE (falha fecha não pode destruir o que funcionava)",
  fs.readFileSync(path.join(dS, ".agente", "pareamento.json"), "utf8") === sBytes);
t("...com o dono e o id de antes", P.estado(dS).dono === sDono && P.estado(dS).agenteId === sId);
t("...e a chave privada de antes, senão a identidade restaurada ficaria sem par",
  fs.readFileSync(path.join(dS, ".agente", "agente.key"), "utf8") === sChave);
t("...e o dono novo NÃO ficou em lugar nenhum", P.estado(dS).dono !== DONO2);
t("...e o guarda de verdade continua aceitando o antigo", (g.lerPareamento(dS) || {}).dono === sDono);

/* ══════════════════════════════════ 10. o que a fonte não pode ter */
bloco("10. a fonte — um só ponto de escrita, nenhum HS*, falha fecha");

t("REGRA 1 — `pareamento.json` é gravado em UM único lugar da fonte",
  (limpo.match(/escreverAtomico\(cam\.pareamento/g) || []).length === 1);
t("...e esse lugar é `confirmar`", /escreverAtomico\(cam\.pareamento/.test(corpo("confirmar")));
t("REGRA 1 — `iniciar` não escreve nada, em hipótese nenhuma",
  !/escreverAtomico|writeFileSync|mkdirSync|renameSync/.test(corpo("iniciar")));
t("REGRA 1 — `estado` não escreve nada",
  !/escreverAtomico|writeFileSync|mkdirSync|renameSync/.test(corpo("estado")));
t("REGRA 1 — não existe caminho de 'parear automaticamente na primeira vez'",
  !/primeiraVez|autoParear|semConfirmacao/i.test(limpo));
t("`confirmar` compara o código ANTES de gravar",
  corpo("confirmar").indexOf("iguaisEmTempoConstante") < corpo("confirmar").indexOf("escreverAtomico"));
t("`confirmar` zera a cerimônia ANTES de gravar (uso único não depende do disco)",
  corpo("confirmar").indexOf("cerimonia = null;\n\n  /*") >= 0 ||
  corpo("confirmar").indexOf("const c = cerimonia;") < corpo("confirmar").indexOf("escreverAtomico"));

t("REGRA 9 — nenhum HS256/HS384/HS512 na fonte", !/HS(256|384|512)/.test(fonte));
t("REGRA 9 — a fonte não escreve `alg` em lugar nenhum", !/["']alg["']\s*:/.test(limpo));
t("REGRA 9 — o documento gravado não tem campo `alg`", !("alg" in doc));
t("REGRA 9 — coerente com o guarda: ALGS não tem HS* nem none",
  [...g.ALGS].every(a => !/^HS/.test(a) && a !== "none"));
t("REGRA 9 — este módulo não assina nem verifica JWT (não é o trabalho dele)",
  !/crypto\.sign\(|crypto\.verify\(/.test(limpo));

t("REGRA 10 — a chave é gravada ANTES do documento (pareado = documento existir)",
  corpo("confirmar").indexOf("escreverAtomico(cam.chave") < corpo("confirmar").indexOf("escreverAtomico(cam.pareamento"));
t("REGRA 10 — a releitura pelo guarda acontece dentro do `try`, então falhar nela desfaz",
  /guarda\.lerPareamento\(cam\.raiz\)/.test(corpo("confirmar")) &&
  corpo("confirmar").indexOf("guarda.lerPareamento(cam.raiz)") < corpo("confirmar").indexOf("catch (err)"));
t("o módulo importa o guarda de verdade — a volta é fechada, não presumida",
  /require\(["']\.\/guarda["']\)/.test(limpo));

t("`desparear` apaga os dois arquivos e o `.tmp` da chave",
  /unlinkSync/.test(corpo("desparear")) && /\.tmp/.test(corpo("desparear")));
t("`desparear` diz o que NÃO revoga — desparear não invalida sessão do outro lado",
  (() => { P.esquecerCerimonia(); const dz = novoDir(); const z = abrir(dz);
    P.confirmar({ dir: dz, desafio: z.r.desafio, codigo: z.codigo });
    const r = P.desparear(dz);
    return r.ok === true && typeof r.naoRevoga === "string" &&
      P.estado(dz).estado === "nao-pareado" && g.lerPareamento(dz) === null; })());
t("desparear num diretório sem pareamento não é erro",
  P.desparear(novoDir()).ok === true);
t("desparear com dir hostil é recusado", P.desparear("..").ok === false);

/* ══════════════════════════════════ 11. bytes invisíveis */
bloco("11. nenhum caractere de controle nos dois arquivos novos");

/* `caractere-test.js` tem uma lista fixa de arquivos e estes dois ainda não
   estão nela — então a varredura anda junto aqui, com a mesma regra. Tab, LF e
   CR são texto; o resto do bloco C0, o DEL e o bloco C1 não têm por que existir
   num arquivo destes. */
function varreControle(rel) {
  const texto = fs.readFileSync(path.join(__dirname, rel), "utf8");
  const achados = [];
  let linha = 1, col = 1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.codePointAt(i);
    if (c === 0x0a) { linha++; col = 1; continue; }
    const suspeito = (c < 0x20 && c !== 0x09 && c !== 0x0d) || c === 0x7f || (c >= 0x80 && c <= 0x9f);
    if (suspeito) achados.push("U+" + c.toString(16).toUpperCase().padStart(4, "0") + " linha " + linha + " coluna " + col);
    col++;
  }
  return achados;
}
for (const rel of ["pareamento.js", "pareamento-test.js"]) {
  const a = varreControle(rel);
  t("sem caractere de controle em " + rel + (a.length ? " (" + a.slice(0, 3).join("; ") + ")" : ""), a.length === 0);
}

} finally {
  /* Nada aqui pode sobrar: o diretório é do SO e some inteiro, e o `.agente` do
     repositório nunca foi tocado — nenhum caso deste arquivo passa `__dirname`
     para uma função que escreve. */
  fs.rmSync(raizTmp, { recursive: true, force: true });
  P.esquecerCerimonia();
}

console.log("\n" + (mal ? "FALHOU" : "passou") + ": " + ok + " ok, " + mal + " falha(s)");
if (mal) { for (const f of falhas) console.log("  ✗ " + f); process.exitCode = 1; }
