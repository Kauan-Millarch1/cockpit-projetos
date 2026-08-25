"use strict";
/* pareamento.js — a cerimônia que VINCULA este agente a um site hospedado.
 *
 * ────────────────────────────────────────────── o buraco, medido antes de escrever
 *
 * `guarda.js` já é a porta: três camadas, e a terceira é o `dono` gravado em
 * `.agente/pareamento.json`. Ele LÊ esse arquivo por `lerPareamento()`.
 *
 * MEDIDO com grep no repositório inteiro, 2026-08-24: `pareamento.json` aparece
 * em `guarda.js`, em `guarda-test.js`, no `.gitignore` e no `CLAUDE.md`. NENHUM
 * arquivo escreve. Ou seja: hoje o único jeito de parear é abrir um editor de
 * texto e escrever o JSON à mão — o que é exatamente a fricção que o modelo
 * distribuído promete não existir, e é pior que isso: um arquivo escrito à mão
 * não tem cerimônia nenhuma, então nada distingue "o dono pareou" de "alguém
 * pareou".
 *
 * Quem escreve ali decide QUAL SITE pode mandar este agente escrever num fluxo
 * de produção do n8n e disparar `POST /retry`, que manda mensagem real para um
 * lead e não tem undo. Este é o arquivo mais perigoso do sistema, e é por isso
 * que ele é o mais chato.
 *
 * ──────────────────────────────────── FATOS, e o juízo é da tela (como o resto)
 *
 * Este módulo diz o que aconteceu. Ele NUNCA decide se a tela mostra verde.
 * `estado()`, `caminhos()`, `derivarAgenteId()` e as três normalizações são
 * puras ou só leem disco, pelo mesmo motivo de `decidir()` no `guarda.js` e de
 * `resolverAlvo` no `upgrade.js`: a política tem que ser testável sem subir
 * servidor, sem browser e sem rede.
 *
 * ─────────────────────────────────── QUEM PODE CHEGAR AQUI, e isso muda o desenho
 *
 * Vale ler `guarda.decidir()` antes de mexer em qualquer coisa deste arquivo,
 * porque ele já decidiu metade do desenho:
 *
 *   - um site hospedado NÃO PAREADO classifica como `estranha`, e mutante de
 *     `estranha` é 403 sem token nenhum salvar. Então **o site hospedado não
 *     consegue chamar `iniciar` nem `confirmar`**. A cerimônia é conduzida do
 *     painel local (`127.0.0.1`, classe `propria`), e não do site. Isso inverte
 *     a direção do que se imaginaria: o site MOSTRA um pacote (origem, iss,
 *     jwks, conta), a pessoa leva esse pacote para o painel local, e é o painel
 *     local que abre a cerimônia.
 *
 *   - um cliente local que não é browser (curl, script, automação) classifica
 *     como `ausente`, e com o agente NÃO PAREADO `decidir()` **libera mutante
 *     sem token** — de propósito, e o motivo está escrito lá. Consequência
 *     direta para cá: **um processo local qualquer consegue chamar `iniciar` e
 *     `confirmar` deste módulo.** É essa a razão de a confirmação humana não ser
 *     cerimônia teatral: sem ela, o primeiro script que rodasse na máquina
 *     parearia o agente com o site dele em silêncio, e sairia com poder de
 *     escrever em produção.
 *
 * ───────────────────────────── O CÓDIGO NÃO VOLTA EM RESPOSTA NENHUMA, e por quê
 *
 * `iniciar()` não devolve o código. Ele o entrega a `mostrar(codigo, info)`, que
 * por padrão imprime no CONSOLE DO PRÓPRIO AGENTE — a janela de terminal que o
 * `start-cockpit.cmd` deixa aberta.
 *
 * Se o código voltasse no corpo da resposta, quem pediu a cerimônia já saberia
 * o código e poderia chamar `confirmar()` na linha seguinte: a confirmação
 * humana viraria enfeite. Devolver e "confiar que a rota não repassa" seria uma
 * invariante afirmada em prosa — e este repositório já pagou por prosa que o
 * código de três linhas abaixo contradizia (ver a seção do `CLAUDE.md` sobre a
 * invariante que sobreviveu ao código). Aqui é estrutural: **não existe função
 * neste módulo que devolva o código.** Nenhuma rota pode vazá-lo por descuido
 * porque nenhuma rota consegue obtê-lo.
 *
 * O TETO DISTO, escrito porque a frase acima sugere mais do que existe: um
 * processo que rodasse como a mesma pessoa e tivesse sido ele a subir o servidor
 * lê o stdout dele. Contra isso nada guardado nesta máquina protege — é o mesmo
 * teto que o `cofre.js` declara para o DPAPI. O que este canal fecha é o caso
 * que importa: um SITE aberto no browser dela, e um script local que não é o pai
 * deste processo.
 *
 * O canal é INJETÁVEL (`mostrar`) exatamente para o Kauan poder trocá-lo por
 * outro se decidir que o script local está fora do escopo. O alternativo óbvio
 * — uma rota `GET /api/pareamento/codigo` que só o painel local leria — é
 * segura contra o site (sem `access-control-allow-origin` o browser esconde o
 * corpo, e `guarda.cabecalhosCors` não manda o cabeçalho para `estranha`) e
 * NÃO é segura contra o script local. O console é estritamente mais forte, e
 * custa UX. A troca está declarada; a decisão é dele.
 *
 * ─────────────────────────────────────────────── por que Ed25519 e não P-256
 *
 * As duas servem: `guarda.ALGS` aceita `EdDSA` e `ES256`. Ed25519 ganha por um
 * motivo que este repositório já pagou: `conferirAssinatura` no `guarda.js`
 * carrega uma armadilha MEDIDA — assinatura ES256 em JWT é R||S cru (IEEE
 * P1363) e o padrão do Node é DER, e sem `dsaEncoding` a verificação falha em
 * TODO token válido, em silêncio. Ed25519 tem UMA codificação canônica de
 * assinatura, então essa classe inteira de defeito não existe. Some-se que
 * `generateKeyPairSync("ed25519")` não tem parâmetro de curva para errar, e que
 * a pública tem 32 bytes.
 *
 * O preço, declarado: em forma JWK a Ed25519 é `kty: "OKP"` (RFC 8037), que
 * biblioteca velha não lê. Aqui o consumidor é o `createPublicKey` do próprio
 * Node e, do outro lado, WebCrypto — que suporta Ed25519 no Node 22 e nos
 * browsers atuais. Se algum dia o lado hospedado for uma biblioteca antiga, a
 * troca para P-256 é de uma linha em `gerarIdentidade` e o `agenteId` continua
 * derivando igual, porque ele hasheia o SPKI (que carrega o algoritmo junto) e
 * não os bytes crus da chave.
 *
 * ──────────────────────────────────────────── a chave privada e o cofre
 *
 * Ela é gravada em `.agente/agente.key` (PKCS#8 PEM), em arquivo SEPARADO do
 * `pareamento.json`, e NÃO passa pelo `cofre.js`. As três razões, na ordem em
 * que pesam:
 *
 *  1. `cofre.js` é um cofre de UMA GAVETA: caminho fixo (`n8n.dat`), valor
 *     único, `memoria` única. Guardar um segundo segredo ali exige transformá-lo
 *     em chaveiro — o que é uma decisão de desenho dele, no arquivo dele, e não
 *     efeito colateral desta tarefa.
 *  2. O teto do DPAPI é justamente o vizinho desta ameaça: ele não protege
 *     contra outro processo rodando na MESMA conta de Windows, e é esse processo
 *     que a confirmação humana existe para barrar. Cifrar não fecharia a porta
 *     que este arquivo existe para fechar.
 *  3. E o que o DPAPI FECHARIA é real e continua aberto: o segredo em texto puro
 *     num arquivo que viaja (pasta zipada, backup na nuvem, commit por engano).
 *     `.agente/` está no `.gitignore`, o que cobre o commit e não cobre o resto.
 *
 * Ou seja: **a chave privada merece o cofre e não está nele, de propósito, e
 * isto está escrito aqui para não apodrecer em silêncio.** O que dá para fazer
 * sem tocar em arquivo de ninguém está feito: arquivo separado, `0o600`
 * (INERTE no Windows — medido pela auditoria e documentado no `cofre.js`; a
 * linha fica porque noutro sistema ela vale, e não conta como segunda camada),
 * escrita atômica, e NENHUMA função deste módulo devolve a privada além da que
 * a gera.
 *
 * FATO que precisa estar dito: **nada no repositório consome a chave privada
 * hoje.** `guarda.js` verifica um JWT do Supabase com a pública do JWKS; a
 * identidade do agente não é usada em lugar nenhum ainda. Ela é gerada porque a
 * cerimônia é o único momento em que existe uma pessoa confirmando, e gerar
 * depois custaria uma segunda cerimônia. Mesma disciplina do `preencher.js`:
 * nada chama, e isso está certo — ligar um portão a um caminho que não existe
 * seria a fingimento que este projeto recusa em todo lugar.
 *
 * ─────────────────────────────────────────────────────── falha FECHA, sempre
 *
 * Não existe meio-pareado. `confirmar()` grava a chave, grava o documento, e
 * então RELÊ o resultado com o `guarda.lerPareamento` de verdade: se o que
 * ficou no disco não é o que o guarda aceita, o estado anterior é restaurado
 * byte a byte e a função recusa. Um `pareamento.json` truncado por queda de luz
 * não vira meio-pareamento porque a escrita é `open + write + fsync + rename`.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const guarda = require("./guarda");

/* ─────────────────────────────────────────────────────────────── constantes */

const VERSAO = 1;

const DIR_AGENTE = ".agente";
const ARQ_PAREAMENTO = "pareamento.json";
const ARQ_CHAVE = "agente.key";

/* 32 caracteres, sem `0`, `1`, `I` e `O`. Confusável lido em voz alta ou
   digitado de um terminal para um campo é erro de pessoa que a tela conta como
   tentativa gasta — e tentativa é recurso escasso aqui (o teto é 5). */
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TAM_CODIGO = 6;

/* 5 minutos. Ler um código numa janela de terminal e digitá-lo num campo da
   mesma máquina é tarefa de ~15 segundos; o prazo cobre ser interrompido, achar
   a janela e errar duas vezes. Mais que isso não compra nada e alarga a janela
   em que o código existe num print, numa gravação de tela ou numa
   compartilhada de reunião. NÃO É CALIBRADO — é um palpite declarado, como o
   `MAX_GERACOES` do `dossie.js`, e errar aqui custa uma cerimônia repetida e
   nunca um pareamento errado. */
const PRAZO_MS = 5 * 60 * 1000;

/* 32^6 = 1.073.741.824 códigos possíveis. Com 5 tentativas, adivinhar é
   irrelevante — mas o teto não é a defesa principal e é importante não contar
   duas onde existe uma: a defesa é o canal, porque quem não vê o console do
   agente não tem o que adivinhar. O teto existe para que estourá-lo MATE A
   CERIMÔNIA INTEIRA, e não só a tentativa: assim força bruta custa um `iniciar`
   novo, que imprime um código novo onde o atacante não lê. */
const TETO_TENTATIVAS = 5;

/* Um deploy de produção e um de preview são o caso legítimo de mais de uma
   origem. Quatro é folga; uma lista longa aqui é uma lista que ninguém confere,
   e cada item é um site com poder de escrever em produção. */
const MAX_ORIGENS = 4;

/* O documento pareado tem ~600 bytes. 16 KB barra um arquivo trocado por lixo
   grande antes de qualquer `JSON.parse`. */
const TETO_ARQUIVO = 16 * 1024;

/* Nome de arquivo interno. Não vem de fora hoje, e é validado do mesmo jeito
   que se viesse: a disciplina desta casa é duas camadas independentes
   (`nomeSeguro` + `dentro()` no `anexos.js`), e a segunda só vale se a primeira
   não presumir que a entrada é amiga. */
/* O ponto inicial é opcional e o resto NÃO pode começar com ponto: `.agente`
   passa, `..` não, `...` não, `..agente` não. Um `{0,39}` depois de um caractere
   obrigatório é o que impede o nome de ser só pontos. */
const NOME_INTERNO_RE = /^\.?[a-z0-9][a-z0-9._-]{0,39}$/;

/* Transcrição LITERAL do regex de `lerPareamento` no `guarda.js`. Ele é a
   segunda camada da origem: o `ORIGEM_RE` abaixo é mais estrito, então tudo o
   que passa por ele passa por este — e a prova de que as duas pontas não
   divergiram não é este comentário, é o teste de ida e volta pelo
   `guarda.lerPareamento` de verdade em `pareamento-test.js`. Uma origem que
   este módulo gravasse e o guarda descartasse seria meio-pareamento: arquivo
   escrito, site sem poder, e nada na tela explicando. */
const RE_GUARDA_ORIGEM = /^https:\/\/[^\s/]+$/;

/* Mais estrito que o do guarda de propósito: apertar é seguro (o que eu recuso
   nunca é gravado), afrouxar seria gravar o que o guarda joga fora. Sem `@`
   (userinfo não existe em origem), sem `?`, sem `#`, sem barra. */
const ORIGEM_RE = /^https:\/\/[a-z0-9][a-z0-9.-]{0,252}(?::\d{2,5})?$/;

/* `iss` e `jwks` têm caminho (`/auth/v1`, `/.well-known/jwks.json`), então o
   regex é outro. `https://` obrigatório nos dois: um emissor em claro é um
   token que viaja em claro, e um JWKS em claro é a chave que verifica esse
   token buscada por um canal que qualquer rede troca. */
const URL_HTTPS_RE = /^https:\/\/[a-z0-9][a-z0-9.-]{0,252}(?::\d{2,5})?(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*)?$/;

/* O `sub` do Supabase é uuid. O regex NÃO exige uuid, e isso é a mesma decisão
   do `pareceChave` no `cofre.js`: recusar por forma é apostar que a forma nunca
   muda, e o dia em que mudasse travaria a pessoa fora do próprio agente. Então
   valida o que é estrutural (texto, tamanho, alfabeto sem espaço) e REPORTA a
   forma como fato, para a tela poder avisar sem impedir. */
const DONO_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ────────────────────────────────────────────────────── caminho: duas camadas */

function recusa(motivo, categoria) {
  return { ok: false, motivo, categoria };
}

/* Camada 1: os componentes CRUS, antes de qualquer `resolve`. `path.resolve`
   come `..` e devolve um caminho perfeitamente válido em outro lugar do disco —
   então checar depois de resolver é checar o resultado do ataque, não o ataque.
   Caractere de controle sai aqui: um U+0000 num caminho é truncamento em
   algumas camadas do SO, e este repositório já perdeu tempo três vezes com byte
   invisível (U+0000 no `nodeOrigin`, U+001F no `n8n.js`, U+0000 no
   `catalog.js`). */
function raizSegura(dir) {
  if (typeof dir !== "string" || !dir.trim()) {
    return recusa("preciso saber em qual diretório gravar o pareamento, e nenhum foi passado.", "caminho");
  }
  if (/[\u0000-\u001f\u007f]/.test(dir)) {
    return recusa("o caminho tem caractere de controle — isso não é um diretório.", "caminho");
  }
  const partes = dir.split(/[/\\]/);
  if (partes.some(p => p === "..")) {
    return recusa("o caminho tem `..` — não subo de diretório para gravar pareamento.", "caminho");
  }
  return { ok: true, valor: path.resolve(dir) };
}

/* Camada 2: resolve e PROVA que o resultado continua debaixo do permitido. É a
   última linha e não a primeira, igual ao `dentro()` do `anexos.js`. */
function dentro(base, p) {
  const r = path.resolve(base, p);
  const b = path.resolve(base);
  if (r !== b && !r.startsWith(b + path.sep)) {
    throw new Error("caminho fora do diretório permitido");
  }
  return r;
}

function nomeInterno(n) {
  const s = String(n);
  if (!NOME_INTERNO_RE.test(s) || s.includes("..") || s.includes("/") || s.includes("\\")) {
    throw new Error("nome de arquivo interno inválido: " + JSON.stringify(s));
  }
  return s;
}

/* Os quatro caminhos que este módulo conhece. Devolve recusa em vez de lançar
   porque quem chama é uma rota, e uma rota precisa de uma frase. */
function caminhos(dir) {
  const r = raizSegura(dir);
  if (!r.ok) return r;
  let base, pareamento, chave;
  try {
    base = dentro(r.valor, nomeInterno(DIR_AGENTE));
    pareamento = dentro(base, nomeInterno(ARQ_PAREAMENTO));
    chave = dentro(base, nomeInterno(ARQ_CHAVE));
  } catch (err) {
    return recusa("não consegui montar o caminho do pareamento: " + (err && err.message), "caminho");
  }
  return { ok: true, raiz: r.valor, base, pareamento, chave };
}

/* ───────────────────────────────────────────────────────── identidade do agente */

/* O `agenteId` é DERIVADO da pública, nunca sorteado: um id aleatório solto não
   é conferível, e quem recebesse o par (id, pública) não teria como saber que
   um é do outro. Hasheia o SPKI DER e não os bytes crus da chave porque o SPKI
   carrega o algoritmo junto — assim uma Ed25519 e uma P-256 nunca podem colidir
   num mesmo id, e trocar a curva não muda a forma do id. 128 bits de hash
   truncado: resistência a colisão de 64 bits é irrelevante aqui (não existe
   ganho em colidir com um id que já é público), e o que importa é caber numa
   tela e ser conferível. */
function derivarAgenteId(publica) {
  const spki = crypto.createPublicKey(publica).export({ type: "spki", format: "der" });
  return "ag_" + crypto.createHash("sha256").update(spki).digest("hex").slice(0, 32);
}

/* A ÚNICA função deste módulo que devolve a chave privada, e ela é
   NÃO-ENUMERÁVEL de propósito. `JSON.stringify` e `Object.assign` copiam só o
   enumerável, então uma rota que fizesse `json(res, 200, ident)` — ou um
   `console.log` de objeto — não vaza a privada. Destructuring continua
   funcionando para quem realmente precisa dela. É a mesma ideia de tornar
   estrutural o que seria uma promessa em comentário. */
function gerarIdentidade() {
  const par = crypto.generateKeyPairSync("ed25519");
  const publica = par.publicKey.export({ type: "spki", format: "pem" });
  const privada = par.privateKey.export({ type: "pkcs8", format: "pem" });
  const fora = { agenteId: derivarAgenteId(publica), publica };
  Object.defineProperty(fora, "privada", {
    value: privada, enumerable: false, writable: false, configurable: false
  });
  return fora;
}

/* ─────────────────────────────────────────────────────────────── o código */

/* `randomInt` é sem viés (rejeição por dentro) e é nativo. Um `% 32` sobre
   `randomBytes` seria sem viés por acidente (32 divide 256) e viraria viés
   silencioso no dia em que alguém tirasse uma letra do alfabeto. */
function gerarCodigo() {
  let s = "";
  for (let i = 0; i < TAM_CODIGO; i++) s += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
  return s;
}

function formatarCodigo(c) {
  return c.slice(0, 3) + "-" + c.slice(3);
}

/* Separador e caixa são ruído de digitação e saem. O que NÃO acontece é remapear
   confusável (`O`→`0`, `I`→`1`): a tabela de remapeamento mapearia dois códigos
   diferentes num só, e o alfabeto já não tem os quatro confusáveis. Um caractere
   de fora é recusa com a frase que ensina, não silêncio. */
function normalizarCodigo(v) {
  const bruto = String(v == null ? "" : v).toUpperCase().replace(/[\s.\-_]/g, "");
  if (!bruto) return recusa("digite o código que apareceu na janela do cockpit.", "codigo");
  for (const ch of bruto) {
    if (!ALFABETO.includes(ch)) {
      return recusa(
        `o caractere "${ch}" não existe no código: ele só tem 2-9 e letras, sem 0, 1, I nem O.`,
        "codigo");
    }
  }
  return { ok: true, valor: bruto };
}

/* `timingSafeEqual` LANÇA quando os tamanhos diferem — e um `throw` aqui viraria
   503 ("a checagem não rodou") onde a verdade é "o código está errado", duas
   frases que levam a ações opostas. Então o tamanho é conferido antes, e o
   vazamento de tamanho é irrelevante: `TAM_CODIGO` é constante pública. */
function iguaisEmTempoConstante(a, b) {
  const A = Buffer.from(String(a), "utf8");
  const B = Buffer.from(String(b), "utf8");
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/* ──────────────────────────────────────────────── normalização das três URLs */

/* Normaliza pelo `URL` do Node e guarda `url.origin`. Isso não é zelo: é o que
   faz a origem gravada ser EXATAMENTE a string que o browser vai mandar no
   cabeçalho `origin` — caixa do host abaixada, IDN em punycode, userinfo e
   porta padrão descartados. Gravar o que a pessoa colou, sem normalizar, é
   gravar uma origem que nunca casa, e o sintoma seria "pareei e o site continua
   dando 403", que aponta para lugar nenhum.
   Quando a normalização mudou algo, isso volta como FATO (`normalizada`), para
   a tela poder dizer o que ela pareou de verdade. */
function normalizarOrigem(v) {
  if (typeof v !== "string" || !v.trim()) {
    return recusa("falta o endereço do site a parear.", "origem");
  }
  const original = v.trim();
  let u;
  try { u = new URL(original); }
  catch { return recusa(`"${original}" não é um endereço de site.`, "origem"); }
  if (u.protocol !== "https:") {
    return recusa(
      `só pareio site em https:// — "${original}" iria em claro, e uma página sem TLS autorizada a escrever num fluxo de produção derruba todo o resto.`,
      "origem");
  }
  const valor = u.origin;
  if (!ORIGEM_RE.test(valor) || !RE_GUARDA_ORIGEM.test(valor)) {
    return recusa(`"${original}" não tem a forma de uma origem (esquema + host + porta, sem caminho).`, "origem");
  }
  return { ok: true, valor, original, normalizada: valor !== original };
}

function normalizarUrlHttps(v, campo, categoria) {
  if (typeof v !== "string" || !v.trim()) {
    return recusa(`falta o ${campo}.`, categoria);
  }
  const original = v.trim();
  let u;
  try { u = new URL(original); }
  catch { return recusa(`o ${campo} ("${original}") não é uma URL.`, categoria); }
  if (u.protocol !== "https:") {
    return recusa(`o ${campo} tem que ser https:// — em claro, qualquer rede troca o que vem por ali.`, categoria);
  }
  const valor = u.origin + u.pathname;
  if (!URL_HTTPS_RE.test(valor)) {
    return recusa(`o ${campo} ("${original}") não tem forma de URL simples.`, categoria);
  }
  return { ok: true, valor, original, normalizada: valor !== original, origem: u.origin };
}

/* ──────────────────────────────────────────────────── escrita, atômica de fato */

/* `open + write + fsync + close + rename`. O `rename` sozinho garante que
   ninguém vê o arquivo pela metade, e NÃO garante que o conteúdo chegou ao disco
   antes da entrada de diretório — numa queda de energia dá para acabar com um
   nome apontando para bloco vazio. Um `pareamento.json` de zero byte é
   exatamente o "meio-pareado" que este arquivo existe para não produzir, então o
   `fsync` é a diferença entre atômico de verdade e atômico de fachada.
   O `.tmp` é apagado antes de abrir: sobra de queda anterior manteria o modo
   antigo do arquivo, e `open(..., mode)` só aplica o modo na criação. */
function escreverAtomico(destino, texto, modo) {
  const tmp = destino + ".tmp";
  try { fs.rmSync(tmp, { force: true }); } catch { /* não existia */ }
  const fd = fs.openSync(tmp, "w", modo);
  try {
    fs.writeFileSync(fd, texto, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, destino);
}

function lerBruto(p) {
  try { return fs.readFileSync(p, "utf8"); }
  catch { return null; }
}

function restaurar(p, conteudo, modo) {
  try {
    if (conteudo === null) fs.rmSync(p, { force: true });
    else escreverAtomico(p, conteudo, modo);
  } catch { /* nada mais a fazer: o estado já é "não pareado", que é o lado seguro */ }
}

/* ────────────────────────────────────────────────────────────────── estado */

/* TRÊS estados, nunca dois. `nao-pareado` e `ilegivel` levam a decisões opostas
   de quem lê a tela: uma manda parear, a outra manda olhar o arquivo (ou
   desparear e refazer). Devolver `nao-pareado` para um JSON corrompido seria
   convidar a pessoa a parear de novo por cima de um arquivo que ela nem sabe que
   está lá. É a oitava vez que este repositório escreve essa frase, e aqui o
   galho negativo é o pior de todos. */
function estado(dir, agora = Date.now()) {
  const cam = caminhos(dir);
  if (!cam.ok) {
    return { estado: "ilegivel", porque: cam.motivo, categoria: cam.categoria, arquivo: null };
  }

  const base = {
    arquivo: cam.pareamento,
    chaveEm: cam.chave,
    desafio: cerimoniaVisivel(cam.base, agora)
  };

  let st;
  try { st = fs.statSync(cam.pareamento); }
  catch (err) {
    if (err && err.code === "ENOENT") {
      return Object.assign({
        estado: "nao-pareado",
        porque: "este agente nunca foi pareado com nenhuma conta."
      }, base);
    }
    return Object.assign({
      estado: "ilegivel",
      porque: "existe algo em `" + ARQ_PAREAMENTO + "` e eu não consegui ler: " + (err && err.code || err && err.message),
      categoria: "disco"
    }, base);
  }

  /* Arquivo de zero byte é `ilegivel`, e não `nao-pareado`, porque zero byte é
     escrita interrompida — o sintoma do defeito que o `fsync` acima evita. Tratar
     como "nunca pareado" apagaria o rastro do único caso em que este módulo
     falhou. */
  if (!st.isFile()) {
    return Object.assign({ estado: "ilegivel", porque: "`" + ARQ_PAREAMENTO + "` não é um arquivo.", categoria: "disco" }, base);
  }
  if (st.size === 0) {
    return Object.assign({ estado: "ilegivel", porque: "o arquivo de pareamento está vazio — escrita interrompida. Despareie e refaça.", categoria: "disco" }, base);
  }
  if (st.size > TETO_ARQUIVO) {
    return Object.assign({ estado: "ilegivel", porque: "o arquivo de pareamento está maior que o teto de " + TETO_ARQUIVO + " bytes.", categoria: "disco" }, base);
  }

  let doc;
  try { doc = JSON.parse(fs.readFileSync(cam.pareamento, "utf8")); }
  catch { return Object.assign({ estado: "ilegivel", porque: "o arquivo de pareamento não é JSON válido.", categoria: "disco" }, base); }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return Object.assign({ estado: "ilegivel", porque: "o arquivo de pareamento não é um objeto.", categoria: "disco" }, base);
  }
  if (typeof doc.dono !== "string" || !doc.dono) {
    return Object.assign({ estado: "ilegivel", porque: "o pareamento não diz de qual conta é (`dono` faltando) — sem a camada 3 não existe pareamento.", categoria: "disco" }, base);
  }
  if (!Array.isArray(doc.origens)) {
    return Object.assign({ estado: "ilegivel", porque: "o pareamento não tem lista de origens.", categoria: "disco" }, base);
  }

  const origens = doc.origens.filter(o => typeof o === "string");
  const invalidas = origens.filter(o => !ORIGEM_RE.test(o) || !RE_GUARDA_ORIGEM.test(o));

  /* Três estados também aqui, e não dois: `null` é "não tenho a pública gravada
     para conferir", que é o caso de um arquivo escrito à mão. `false` é "tenho e
     NÃO bate", que é acusação. Deixar o `null` cair em `false` seria acusar um
     arquivo por um campo que nunca existiu — o defeito do `docAgentes`. */
  let idConfere = null;
  if (typeof doc.publica === "string" && doc.publica && typeof doc.agenteId === "string") {
    try { idConfere = derivarAgenteId(doc.publica) === doc.agenteId; }
    catch { idConfere = false; }
  }

  let temChave = false;
  try { temChave = fs.statSync(cam.chave).size > 0; } catch { /* sem chave */ }

  return Object.assign({
    estado: "pareado",
    porque: null,
    dono: doc.dono,
    formaDono: UUID_RE.test(doc.dono) ? "uuid" : "estranha",
    origens,
    origensInvalidas: invalidas,
    iss: typeof doc.iss === "string" ? doc.iss : null,
    jwks: typeof doc.jwks === "string" ? doc.jwks : null,
    agenteId: typeof doc.agenteId === "string" ? doc.agenteId : null,
    idConfere,
    temChave,
    em: typeof doc.em === "string" ? doc.em : null,
    versao: typeof doc.versao === "number" ? doc.versao : null,
    /* O fato que fecha a volta: o guarda de verdade aceita este arquivo? Um
       arquivo presente que o guarda ignora é meio-pareamento, e a tela precisa
       poder dizer isso em vez de mostrar verde. */
    guardaAceita: !!guarda.lerPareamento(cam.raiz),
    bytes: st.size
  }, base);
}

/* ───────────────────────────────────────────────────────────── a cerimônia */

/* UMA cerimônia por processo. Duas simultâneas seriam dois códigos no mesmo
   console (a pessoa confirma o errado) e multiplicariam o teto de tentativas por
   quantas alguém quisesse abrir. Ela vive em MEMÓRIA e não em disco: uma
   cerimônia que sobrevive a um reinício é um código que sobrevive à janela que o
   mostrou, e um arquivo de cerimônia é justamente um canal que o processo local
   vizinho leria. Morrer com o processo é o lado seguro. */
let cerimonia = null;

function cerimoniaVisivel(base, agora) {
  if (!cerimonia || cerimonia.base !== base) return null;
  return {
    desafio: cerimonia.desafio,
    expiraEm: cerimonia.expiraEm,
    expirado: agora >= cerimonia.expiraEm,
    tentativasRestantes: cerimonia.tentativas,
    origens: cerimonia.origens.slice(),
    dono: cerimonia.dono
  };
}

function mostrarNoConsole(codigo, info) {
  const seg = Math.round(info.prazoMs / 1000);
  const linhas = [
    "",
    "  ┌─────────────────────────────────────────────────────────┐",
    "  │  PAREAMENTO — confira este código na tela e confirme     │",
    "  └─────────────────────────────────────────────────────────┘",
    "",
    "        " + codigo,
    "",
    "    site:  " + info.origens.join(", "),
    "    conta: " + info.dono,
    "    vale por " + seg + "s, e serve uma vez só.",
    "",
    "    Se você não pediu este pareamento, não confirme: alguém está",
    "    tentando dar a um site permissão de escrever nos seus fluxos.",
    ""
  ];
  for (const l of linhas) console.log(l);
}

/* Abre a cerimônia. NÃO toca o disco: nada é criado, nem o diretório. Um
   `iniciar` que criasse `.agente/` deixaria rastro de uma cerimônia que talvez
   nunca seja confirmada, e a tela leria diretório existente como progresso. */
function iniciar(opcoes) {
  const o = opcoes || {};
  const cam = caminhos(o.dir);
  if (!cam.ok) return cam;

  const agora = typeof o.agora === "number" ? o.agora : Date.now();

  /* ─── UMA CERIMÔNIA VIVA NÃO É SUBSTITUÍDA. NUNCA. ──────────────────────────
   *
   * Isto é a trava mais importante deste arquivo, e ela existe porque NADA
   * amarra uma cerimônia ao cliente que a abriu — `confirmar()` só pede
   * `desafio` + `codigo`, e `estado()` entrega o `desafio` a quem perguntar.
   *
   * O ATAQUE, medido contra o desenho e não imaginado: o `guarda.decidir()`
   * libera mutante SEM TOKEN para cliente local que não é browser com o agente
   * ainda não pareado — está escrito no cabeçalho deste arquivo. Então, enquanto
   * ele está no meio do pareamento em `/integracoes`, qualquer processo local
   * chama `POST /api/pareamento/iniciar` com `origens:["https://evil.example"]`
   * mais o `iss`/`jwks`/`dono` do atacante. Antes desta linha, `iniciar` TROCAVA
   * a cerimônia dele pela do atacante em silêncio: a tela dele faz poll, adota o
   * `desafio`/`origens`/`dono` novos, ele lê no console o código MAIS RECENTE —
   * que é o do atacante — confere e confirma. O agente sai pareado com o site do
   * atacante, que a partir daí alcança `POST /api/claude/run/:id/approve` (grava
   * num fluxo vivo do n8n) e `/retry` (mensagem real para um lead, sem desfazer).
   *
   * A confirmação humana não cobre isso, e é justamente aí que ela falha: ela
   * prova que a pessoa está na máquina e que ela conferiu SEIS CARACTERES. Ela
   * não prova que os seis caracteres são da cerimônia que ela abriu.
   *
   * RECUSAR, e não substituir, porque o defeito é a substituição em si. Recusar
   * é o lado seguro nos dois erros possíveis: se a cerimônia aberta é dele, ele
   * cancela e reabre (um clique); se é do atacante, o atacante não consegue
   * atropelar a dele. Deixar passar a segunda inverte isso — quem chega por
   * último ganha, e quem chega por último é quem está tentando.
   *
   * O EMPATE POR EXPIRAÇÃO É DE PROPÓSITO: cerimônia vencida não é cerimônia, e
   * travar por 5 minutos depois de o prazo cair seria uma porta fechada sem
   * nada atrás. `base` diferente também passa — cerimônia aberta para OUTRO
   * agente não é esta, e `confirmar()` já recusa esse cruzamento.
   *
   * A frase NOMEIA O CANCELAMENTO porque a saída tem que caber na recusa: existe
   * `POST /api/pareamento/cancelar` e existe o botão "Cancelar a cerimônia" na
   * tela. Uma recusa que não diz como sair vira um agente que ninguém consegue
   * parear até reiniciar o processo. */
  if (cerimonia && cerimonia.base === cam.base && agora < cerimonia.expiraEm) {
    return recusa(
      "já existe uma cerimônia de pareamento aberta neste agente. Cancele-a antes de abrir outra — "
      + "eu não troco uma cerimônia viva por outra, porque quem está olhando o código no console não "
      + "tem como saber que ele mudou de dono.",
      "desafio");
  }

  const brutas = Array.isArray(o.origens) ? o.origens
    : (o.origem == null ? [] : [o.origem]);
  if (!brutas.length) {
    return recusa("falta o endereço do site a parear.", "origem");
  }
  if (brutas.length > MAX_ORIGENS) {
    return recusa(`no máximo ${MAX_ORIGENS} origens por pareamento — cada uma é um site com poder de escrever em produção.`, "origem");
  }

  const origens = [];
  const normalizacoes = [];
  for (const b of brutas) {
    const n = normalizarOrigem(b);
    if (!n.ok) return n;
    if (origens.includes(n.valor)) {
      return recusa(`a origem "${n.valor}" aparece duas vezes.`, "origem");
    }
    origens.push(n.valor);
    if (n.normalizada) normalizacoes.push({ campo: "origem", de: n.original, para: n.valor });
  }

  const iss = normalizarUrlHttps(o.iss, "emissor (`iss`)", "emissor");
  if (!iss.ok) return iss;
  if (iss.normalizada) normalizacoes.push({ campo: "iss", de: iss.original, para: iss.valor });

  const jwks = normalizarUrlHttps(o.jwks, "endereço do JWKS", "jwks");
  if (!jwks.ok) return jwks;
  if (jwks.normalizada) normalizacoes.push({ campo: "jwks", de: jwks.original, para: jwks.valor });

  /* O JWKS tem que ser da MESMA ORIGEM do emissor, e isto é endurecimento de
     verdade, não formalidade. Quem escolhe o JWKS escolhe a chave que verifica
     todo token — então um pacote com um `iss` de cara conhecida e um `jwks` do
     atacante passaria a camada 2 inteira com token forjado. A confirmação humana
     prova que a pessoa está na máquina; ela NÃO prova que o pacote que ela colou
     é honesto. Esta linha é o que cobre essa diferença. Medido na forma real do
     Supabase: `iss` é `https://<ref>.supabase.co/auth/v1` e o JWKS é
     `.../auth/v1/.well-known/jwks.json` — mesma origem. */
  if (jwks.origem !== iss.origem) {
    return recusa(
      `o JWKS (${jwks.origem}) não é do mesmo endereço do emissor (${iss.origem}). Quem escolhe o JWKS escolhe a chave que valida todo token, então isto eu não pareio.`,
      "jwks");
  }

  const dono = typeof o.dono === "string" ? o.dono.trim() : "";
  if (!dono) {
    return recusa("falta a conta (o `sub` do usuário) que vai mandar neste agente.", "dono");
  }
  if (!DONO_RE.test(dono)) {
    return recusa("a conta veio com espaço ou caractere estranho — confira se ela foi colada inteira.", "dono");
  }

  /* O que sobrou de substituível depois da trava lá em cima: uma cerimônia
     VENCIDA, ou uma de outro agente. As duas são substituições legítimas, e o
     campo continua viajando porque a tela precisa poder dizer "o código anterior
     não vale mais" em vez de deixar dois códigos no console sem explicação —
     era esse o buraco: a variável já existia e ninguém agia sobre ela. */
  const substituiuDesafio = cerimonia ? cerimonia.desafio : null;

  const codigo = gerarCodigo();
  cerimonia = {
    desafio: "d_" + crypto.randomBytes(16).toString("hex"),
    codigo,
    base: cam.base,
    raiz: cam.raiz,
    criadaEm: agora,
    expiraEm: agora + PRAZO_MS,
    tentativas: TETO_TENTATIVAS,
    origens, iss: iss.valor, jwks: jwks.valor, dono
  };

  const info = {
    desafio: cerimonia.desafio,
    expiraEm: cerimonia.expiraEm,
    prazoMs: PRAZO_MS,
    origens: origens.slice(),
    dono
  };

  /* O código sai por AQUI e por nenhum outro lugar. Se `mostrar` explodir, a
     cerimônia morre: um código gerado que ninguém viu é um código que só serve
     para quem o gerou, e quem o gerou pode ser um script. */
  const canal = typeof o.mostrar === "function" ? "canal injetado" : "console do agente";
  try {
    (typeof o.mostrar === "function" ? o.mostrar : mostrarNoConsole)(formatarCodigo(codigo), info);
  } catch (err) {
    cerimonia = null;
    return recusa("não consegui mostrar o código de confirmação: " + (err && err.message), "canal");
  }

  return {
    ok: true,
    desafio: cerimonia.desafio,
    expiraEm: cerimonia.expiraEm,
    prazoMs: PRAZO_MS,
    tentativas: TETO_TENTATIVAS,
    tamanhoCodigo: TAM_CODIGO,
    canal,
    onde: "o código está na janela do cockpit (o terminal que ficou aberto).",
    origens: origens.slice(),
    iss: iss.valor,
    jwks: jwks.valor,
    dono,
    formaDono: UUID_RE.test(dono) ? "uuid" : "estranha",
    normalizacoes,
    substituiuDesafio
  };
}

/* Cancela a cerimônia em andamento. Existe porque um botão de cancelar é uma
   necessidade real da tela, e porque sem ele o único jeito de largar uma
   cerimônia aberta é esperar 5 minutos. Devolve se havia alguma. */
function esquecerCerimonia() {
  const havia = !!cerimonia;
  cerimonia = null;
  return havia;
}

/* Fecha a cerimônia e GRAVA. É o único caminho de código deste módulo que
   escreve `pareamento.json` — não existe "parear automaticamente porque é a
   primeira vez", e `pareamento-test.js` prova isso lendo a fonte, porque um
   segundo ponto de escrita colado aqui por descuido seria a pior linha
   disponível neste arquivo. */
function confirmar(opcoes) {
  const o = opcoes || {};
  const cam = caminhos(o.dir);
  if (!cam.ok) return cam;

  const agora = typeof o.agora === "number" ? o.agora : Date.now();

  if (!cerimonia) {
    return recusa("não existe cerimônia de pareamento em andamento. Comece de novo.", "desafio");
  }
  /* Cerimônia aberta para um diretório e confirmada em outro é bug de quem
     chama, e o lado seguro é recusar sem tocar em nada. Gravar seria parear um
     agente com o consentimento dado a outro. */
  if (cerimonia.base !== cam.base) {
    return recusa("a cerimônia em andamento é de outro diretório de agente.", "caminho");
  }
  if (agora >= cerimonia.expiraEm) {
    cerimonia = null;
    return recusa("o código venceu. Comece o pareamento de novo.", "prazo");
  }
  if (typeof o.desafio !== "string" || o.desafio !== cerimonia.desafio) {
    return recusa("esta confirmação não é da cerimônia em andamento.", "desafio");
  }

  const cod = normalizarCodigo(o.codigo);
  /* Malformado NÃO gasta tentativa: o teto existe contra ADIVINHAÇÃO, e um
     caractere fora do alfabeto não é um palpite — é um `l` minúsculo digitado
     por engano. Gastar tentativa aí faria a pessoa perder a cerimônia por causa
     de um erro de digitação, e o teto de 5 ficaria de mentira. */
  if (!cod.ok) return Object.assign({}, cod, { tentativasRestantes: cerimonia.tentativas });
  /* Tamanho errado, pela mesma razão: não é um palpite do espaço de 6. */
  if (cod.valor.length !== TAM_CODIGO) {
    return Object.assign(
      recusa(`o código tem ${TAM_CODIGO} caracteres, e veio ${cod.valor.length}.`, "codigo"),
      { tentativasRestantes: cerimonia.tentativas });
  }

  if (!iguaisEmTempoConstante(cod.valor, cerimonia.codigo)) {
    cerimonia.tentativas -= 1;
    if (cerimonia.tentativas <= 0) {
      cerimonia = null;
      return recusa(
        `o código errou ${TETO_TENTATIVAS} vezes e a cerimônia foi encerrada inteira. Nada foi pareado. Comece de novo se foi você.`,
        "teto");
    }
    return Object.assign(
      recusa("o código não confere.", "codigo"),
      { tentativasRestantes: cerimonia.tentativas });
  }

  /* Acertou. USO ÚNICO: a cerimônia morre ANTES da gravação. O preço é que uma
     falha de disco custa uma cerimônia nova; o que se compra é que um código
     cuja gravação falhou pela metade não pode ser reapresentado. Entre repetir
     15 segundos de cerimônia e ter um código válido duas vezes, não é escolha. */
  const c = cerimonia;
  cerimonia = null;

  /* O estado anterior, byte a byte, para poder voltar. Sem isto uma falha na
     segunda escrita deixaria a pessoa SEM o pareamento que funcionava — falha
     fecha não pode significar "e destrói o que estava bom". */
  const previoPar = lerBruto(cam.pareamento);
  const previoChave = lerBruto(cam.chave);
  let anterior = null;
  if (previoPar) {
    try {
      const d = JSON.parse(previoPar);
      if (d && typeof d === "object") anterior = { dono: d.dono || null, origens: Array.isArray(d.origens) ? d.origens : [] };
    } catch { anterior = { dono: null, origens: [] }; }
  }

  const ident = gerarIdentidade();
  const em = new Date(agora).toISOString();
  const doc = {
    versao: VERSAO,
    agenteId: ident.agenteId,
    publica: ident.publica,
    dono: c.dono,
    origens: c.origens.slice(),
    iss: c.iss,
    jwks: c.jwks,
    em,
    /* Escrito para quem for ler o arquivo depois, e não para código nenhum. */
    nota: "escrito pela cerimonia de pareamento, com codigo confirmado por uma pessoa. Nao edite a mao: use desparear e pareie de novo."
  };

  try {
    fs.mkdirSync(cam.base, { recursive: true });
    /* Chave PRIMEIRO, documento DEPOIS, e a ordem é a garantia: "pareado" é
       definido por `pareamento.json` existir e ser aceito pelo guarda, então se
       a chave falhar não existe pareamento nenhum. A ordem inversa deixaria um
       agente pareado sem identidade. */
    escreverAtomico(cam.chave, ident.privada, 0o600);
    escreverAtomico(cam.pareamento, JSON.stringify(doc, null, 2) + "\n", 0o600);

    /* A volta fechada: releio com o `lerPareamento` DE VERDADE. O que este
       módulo grava só serve se aquele módulo aceitar, e "aceita" é um fato
       aferível — presumir seria a invariante afirmada em prosa que este repo já
       viu o código contradizer. */
    const lido = guarda.lerPareamento(cam.raiz);
    const bate = lido
      && lido.dono === doc.dono
      && lido.jwks === doc.jwks
      && lido.iss === doc.iss
      && lido.agenteId === doc.agenteId
      && lido.origens.length === doc.origens.length
      && doc.origens.every(x => lido.origens.includes(x));
    if (!bate) {
      throw new Error("o arquivo gravado não foi aceito pelo guarda na releitura");
    }
  } catch (err) {
    /* O `.tmp` da escrita que morreu no meio sai ANTES da restauração, e o que
       manda é o da chave: ele carrega uma privada inteira. Deixá-lo para trás
       seria um segredo órfão num diretório que a tela diz estar não pareado. */
    for (const p of [cam.pareamento + ".tmp", cam.chave + ".tmp"]) {
      try { fs.rmSync(p, { force: true }); } catch { /* segue */ }
    }
    restaurar(cam.pareamento, previoPar, 0o600);
    restaurar(cam.chave, previoChave, 0o600);
    return recusa(
      "não consegui gravar o pareamento: " + (err && err.message || err) + ". Nada foi pareado.",
      "disco");
  }

  return {
    ok: true,
    agenteId: ident.agenteId,
    dono: doc.dono,
    formaDono: UUID_RE.test(doc.dono) ? "uuid" : "estranha",
    origens: doc.origens.slice(),
    iss: doc.iss,
    jwks: doc.jwks,
    em,
    arquivo: cam.pareamento,
    chaveEm: cam.chave,
    conferidoPeloGuarda: true,
    /* Um pareamento é de UMA conta: confirmar substitui o anterior inteiro, e
       nunca funde origens (fundir deixaria o site da conta A servido pelo agente
       da conta B). Quando havia algo antes, a tela tem obrigação de dizer o que
       saiu — mesma razão pela qual o `cofre.guardar` devolve `revogacaoManual`. */
    substituiu: anterior
  };
}

/* Apaga. Um pareamento sem porta de saída é pior que nenhum: sem isto o jeito de
   tirar o poder de um site é achar um arquivo escondido num diretório que começa
   com ponto. Não pede confirmação, e isso é deliberado — desparear é a direção
   que FECHA, e pedir confirmação para fechar ensina a clicar em confirmar. */
function desparear(dir) {
  const cam = caminhos(dir);
  if (!cam.ok) return cam;

  if (cerimonia && cerimonia.base === cam.base) cerimonia = null;

  const removeu = { pareamento: false, chave: false };
  const erros = [];
  for (const [k, p] of [["pareamento", cam.pareamento], ["chave", cam.chave]]) {
    try {
      fs.unlinkSync(p);
      removeu[k] = true;
    } catch (err) {
      if (!err || err.code !== "ENOENT") erros.push(k + ": " + (err && err.code || err && err.message));
    }
  }
  /* O `.tmp` de uma escrita interrompida também sai: ele carrega uma chave
     privada inteira, e deixá-lo para trás faria o desparear mentir. */
  for (const p of [cam.pareamento + ".tmp", cam.chave + ".tmp"]) {
    try { fs.rmSync(p, { force: true }); } catch { /* segue */ }
  }

  if (erros.length) {
    return recusa("não consegui apagar tudo (" + erros.join("; ") + "). O agente pode continuar pareado.", "disco");
  }
  return {
    ok: true,
    removeu,
    /* A frase que a tela tem obrigação de repetir: desparear tira o poder do
       site sobre ESTE agente e não invalida token nenhum do lado do Supabase, do
       mesmo jeito que trocar a chave no cofre não revoga a antiga no n8n. */
    naoRevoga: "isto tira o poder do site sobre este agente. Não invalida nenhuma sessão do lado do site."
  };
}

module.exports = {
  VERSAO, DIR_AGENTE, ARQ_PAREAMENTO, ARQ_CHAVE,
  ALFABETO, TAM_CODIGO, PRAZO_MS, TETO_TENTATIVAS, MAX_ORIGENS, TETO_ARQUIVO,
  ORIGEM_RE, RE_GUARDA_ORIGEM, URL_HTTPS_RE, DONO_RE, UUID_RE,
  caminhos, dentro, derivarAgenteId, gerarIdentidade,
  gerarCodigo, formatarCodigo, normalizarCodigo, iguaisEmTempoConstante,
  normalizarOrigem, normalizarUrlHttps,
  estado, iniciar, confirmar, desparear, esquecerCerimonia
};
