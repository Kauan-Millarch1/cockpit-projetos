// integracoes.js — os fatos da tela `/integracoes`. FATO, nunca juízo.
//
// A invariante do repositório vale aqui inteira (CONTRATO §1): este módulo diz
// *configurado*, *respondeu*, *status HTTP*, *quantos fluxos*, *achei a CLI*. Ele
// não diz `ok`, `nunca`, `quebrou` nem `conferindo`, não escolhe cor e não
// escreve frase de diagnóstico em português sobre o estado da conexão. Quem faz
// isso é o bloco de juízo no topo de `integracoes.html`, pelo mesmo motivo de
// sempre: a definição de "quebrou" é a parte que o Kauan ajusta mais, e
// espalhá-la pelo servidor faz cada ajuste exigir reinício.
//
// SOMENTE LEITURA. Nada aqui autentica ninguém, guarda chave, escreve no n8n ou
// no disco. Não existe `getRawWorkflow` neste arquivo, não existe rota HTTP nova
// para o n8n, e não existe caminho de escrita — `integracoes-test.js` afere essa
// ausência sobre a fonte sem comentário, em vez de confiar nesta frase. Um
// comentário que afirma uma invariante que o código lá embaixo contradiz é pior
// que nenhum comentário: ele ensina que os comentários daqui não valem.
//
// INJEÇÃO DE DEPENDÊNCIA, não `require` no topo. `colher({ n8n, fix })` recebe os
// módulos. Dois motivos, e o segundo é o que decide: o teste exerce a lógica de
// verdade com falsos, sem a cirurgia em `require.cache` que os testes mais
// antigos daqui precisam fazer; e `require("./n8n.js")` no topo executaria
// `loadConfig()` — que lê `.env` do diretório e VENCE `process.env` — só por
// carregar o arquivo. Um teste que apenas importa este módulo não pode ler a
// chave de produção.

"use strict";

/* Cache de 30s (CONTRATO §3): `listWorkflows` mediu 1,4s para 75 fluxos e a
   página pode ser recarregada à vontade. */
const CACHE_MS = 30 * 1000;

/* Teto da mensagem de erro que atravessa. O corpo de um erro de instância pode
   vir com quilobytes de HTML de proxy, e isso viaja em toda resposta. Mesmo
   número do `MSG_CAP` do `n8n.js`, de propósito: duas casas com dois tetos
   diferentes para a mesma string divergiriam na primeira correção de um lado. */
const MSG_CAP = 400;

/* O teto de páginas de `getWorkflows` no `n8n.js`: o laço para quando
   `rows.length >= 1000` mesmo com cursor sobrando. É o ÚNICO sinal de leitura
   parcial disponível — `listWorkflows` devolve um array cru, sem `truncado` e
   sem `total` (ver o relatório: é uma lacuna do contrato). Então `parcial` é
   inferido daqui, e este acoplamento está escrito para quem mexer no `n8n.js`
   saber que precisa mexer aqui: se o teto de lá subir e este número ficar, uma
   leitura completa de 1.100 fluxos passa a ser anunciada como piso. */
const TETO_LEITURA = 1000;

/* A frase do CONTRATO §2, literal. Ela é fato sobre o NOSSO código, não juízo
   sobre uma conexão: não existe spawn, detecção nem variável de ambiente de
   Codex em lugar nenhum deste repositório. Por isso `integrado` é `false` de
   verdade, e não o `null` que os outros dois campos usam para "não sei". */
const CODEX_PORQUE = "o cockpit não sabe chamar o Codex: não existe spawn, detecção nem variável de ambiente para ele.";

const SEM_SEGREDO = "«segredo removido»";

/* ------------------------------------------------------------------ varredura */

/* A chave vai no cabeçalho `X-N8N-API-KEY` e não pode aparecer em campo nenhum
   da resposta (CONTRATO §4). A varredura é DELIBERADAMENTE conservadora: é
   melhor apagar uma string inofensiva que vazar uma vez, e o custo do falso
   positivo é uma mensagem de erro menos legível — o do falso negativo é a chave
   da instância num painel que fica aberto o dia inteiro e é filmado em
   apresentação (o modo gravação existe justamente por isso).
   A ORDEM importa: as regras com nome rodam antes do apanhador genérico, para o
   apanhador não comer metade de um casamento que a regra específica descreve
   melhor. O placeholder tem `«` e espaço, então nenhuma regra posterior casa
   dentro dele. */
const SEGREDO_RE = [
  /* Nome do cabeçalho COM valor colado, antes do nome sozinho — na outra ordem o
     nome viraria placeholder e o valor ficaria solto na linha seguinte dele. */
  /x-n8n-api-key\s*[:=]\s*["']?[^\s"',;}]+/gi,
  /x-n8n-api-key/gi,
  /* Só engole valor depois de um separador EXPLÍCITO. Sem essa exigência,
     `apiKey recusada` viraria `«segredo removido»`, apagando a única informação
     útil da linha: um `[:=]?` opcional aqui transforma a próxima palavra
     portuguesa em suspeita. */
  /\b(?:api[_-]?key|apikey|token|secret|segredo|senha|password|passwd|authorization|auth[_-]?token)\b\s*[:=]\s*["']?[^\s"',;}]+/gi,
  /\bbearer\s+[^\s"',;}]+/gi,
  /* JWT, que é o formato da chave desta instância. Casa também o prefixo `eyJ`
     sem os três segmentos: um pedaço de JWT já é material vazado. */
  /\beyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)*/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /* Apanhador: qualquer corrida longa de base64. Ponto, dois-pontos, barra
     invertida e espaço quebram a corrida, então host (`a.b.n8n.cloud`), URL e
     caminho do Windows sobrevivem inteiros — foi medido contra os dois. */
  /[A-Za-z0-9_\-+/]{40,}={0,2}/g
];

function varrer(s) {
  let out = String(s == null ? "" : s);
  for (const re of SEGREDO_RE) out = out.replace(re, SEM_SEGREDO);
  /* Varre e SÓ DEPOIS corta. Na ordem inversa, um JWT partido pelo corte
     deixaria o prefixo do lado de dentro — a varredura tem de ver a string
     inteira. */
  return out.length > MSG_CAP ? out.slice(0, MSG_CAP) + "…" : out;
}

/* ------------------------------------------------------- os três estados */

/* A regra que carrega o arquivo: ausente nunca cai no ramo negativo. Este
   repositório já pagou cinco vezes por isso — `docAgentes` acusando um arquivo
   de 48KB de não existir, `ingredientes.credenciais` dizendo "você não tem
   credencial", o cinza do dossiê que não pode ler como vermelho, `resolucao`
   ausente que não pode ler como "está tudo no fluxo aberto".
   Aqui o campo mais barato de errar é `cliAchada`: um `fix` sem `claudeFound`
   viraria `false`, e a tela diria "não achei a CLI" sobre uma CLI que ninguém
   perguntou se existe. */
function booleanoOuNulo(v) {
  return typeof v === "boolean" ? v : null;
}

/* ------------------------------------------------------------------ instância */

/* O host, nunca a chave. `n8n.instance` é `cfg.baseUrl` cru — a URL inteira do
   `.env`, não o host que o CONTRATO §2 descreve (ver relatório). Derivar o host
   é fato, e tem um ganho de segurança de graça: se alguém escrever a base como
   `https://usuario:senha@host`, o userinfo não atravessa nem por `new URL` nem
   pelo regex de reserva. */
function hostDe(base) {
  const s = String(base == null ? "" : base).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.host) return u.host;
  } catch { /* não é URL absoluta — cai no regex abaixo */ }
  const m = s.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@]*@)?([^/:?#\s]+)/i);
  return m && m[1] ? m[1] : null;
}

/* ------------------------------------------------------------ status HTTP */

/* `httpStatus` é FATO, não diagnóstico (CONTRATO §2): `401` é `401`, e quem diz
   "chave recusada" em português é a página.
   Duas fontes, e a segunda existe por um detalhe do `n8n.js` que o contrato não
   previa: `request()` só faz `err.status = res.status` no ramo `!res.ok`. No ramo
   de 429/5xx, depois de esgotar as três tentativas, ele lança
   `new Error("n8n 503 em /api/v1/workflows")` SEM `.status` — exatamente o caso
   de "instância fora do ar" que a tela mais precisa nomear. Ler o número da
   mensagem é acoplamento ao formato dela, e está escrito aqui para o dia em que
   o formato mudar. */
function statusDoErro(err) {
  const n = err && err.status;
  if (typeof n === "number" && Number.isFinite(n) && n >= 100 && n <= 599) return n;
  const m = String((err && err.message) || "").match(/\bn8n\s+([1-5]\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/* --------------------------------------------------------------- os fluxos */

/* `fluxos` é PISO, nunca total (CONTRATO §2). Três estados aqui também:
   - array → quantos deu para ler, com `parcial` dizendo se bateu no teto;
   - qualquer outra forma → `null`, NUNCA `0`. "A instância tem zero fluxos" e
     "não consegui contar" levam a decisões opostas, e `0` é o ramo negativo
     onde o desconhecido não pode cair. */
function contarFluxos(linhas) {
  if (!Array.isArray(linhas)) return { fluxos: null, parcial: null };
  const n = linhas.length;
  return { fluxos: n, parcial: n >= TETO_LEITURA };
}

/* ------------------------------------------------------------------- cache */

/* Uma entrada só, porque a configuração do n8n é lida uma vez no carregamento
   do `n8n.js` e não muda no processo. A entrada guarda a instância a que
   pertence: servir a resposta de um host para outro seria a mentira mais barata
   deste arquivo.
   SÓ COLHEITA QUE RESPONDEU ENTRA. Erro não entra (CONTRATO §3: trinta segundos
   dizendo "não respondeu" mantêm a tela acusando uma instância que já voltou), e
   colheita que não perguntou também não — não há 1,4s para economizar, e guardar
   só acrescentaria idade. */
let cache = null;

function limparCache() { cache = null; }

/* --------------------------------------------------------------- a colheita */

/* `agora` é injetado para o teste poder andar com o relógio sem dormir 30
   segundos, e para `ms` e `em` saírem do mesmo relógio.
   `refazer` ignora o cache DESTE módulo — é o que o botão "Conferir de novo"
   precisa, porque um botão que devolve cache é um botão que não faz nada.
   `ignorarCacheDoN8n` passa `force` para `listWorkflows`, e o padrão é `true` de
   propósito: `getWorkflows` tem um cache PRÓPRIO de 5 minutos, então um
   `listWorkflows()` pelado pode responder `respondeu: true` sem tocar a rede,
   sobre uma instância que caiu há quatro minutos. O §3 protege o defeito
   simétrico (erro grudado por 30s) e este é maior. Sai como opção para o
   servidor poder decidir o contrário sem editar este arquivo. */
async function colher({
  n8n = null,
  fix = null,
  /* Pergunta ao CLI se ele está logado. Injetada, e não um `require` daqui,
     pelo mesmo motivo das outras: o teste exercita a lógica de verdade com um
     dublê, sem abrir processo nenhum. Quem implementa é o `server.js`, que já
     tem `execFile`.
     Ela existe porque `claudeFound` sempre foi `fs.existsSync(binário)` — que
     na máquina do Kauan é verdade e nunca incomodou, e na máquina de um
     estranho são DOIS fatos: instalou e nunca logou virava "conectada" na tela,
     e a primeira construção morria com um erro que não explicava nada. */
  autenticar = null,
  /* Os fatos do adaptador de provedor -- quais IAs existem, qual e recusada e por
     que, quais modos de credencial ha, qual e o padrao. INJETADO, como todo o
     resto deste modulo: o teste exercita com um duble e nada e importado aqui.

     Por que isto entrou: sem ele a tela transcrevia os fatos do `ia.js` a mao, o
     que e uma SEGUNDA COPIA do mesmo fato -- e a copia envelhece sem ninguem notar,
     que e exatamente a divergencia que o `REPROVAM_REDE` e o `ENV_ALLOW` ja
     custaram neste repositorio. Aqui a copia seria pior que as duas: ela diz a uma
     pessoa QUAL IA ela pode usar e QUEM PAGA a conta. */
  ia = null,
  agora = Date.now,
  refazer = false,
  ignorarCacheDoN8n = true
} = {}) {
  const t0 = Number(agora()) || 0;
  const instancia = varrer(hostDe(n8n && n8n.instance)) || null;

  if (!refazer && cache && cache.instancia === instancia && t0 - cache.at < CACHE_MS) {
    /* `em` é o instante da colheita ORIGINAL, nunca o de agora: uma resposta de
       cache que se apresenta como fresca é a mesma classe de mentira do relógio
       vivo sobre dado velho, que este repositório proíbe no carimbo de varredura.
       `idadeMs` e `doCache` viajam para a página poder dizer há quanto tempo. */
    /* `checado` é sobre ESTA colheita, e esta não perguntou nada — ela veio do
       cache. Sem este `false` o corpo guardado devolve o `checado: true` da
       colheita que encheu o cache, e a resposta afirma "perguntei agora" ao lado
       de `doCache: true`: duas frases que se contradizem no mesmo objeto, com a
       página decidindo a partir de uma delas. O `respondeu` guardado continua
       valendo — é a resposta que temos, com a idade declarada. */
    return { ...cache.corpo, n8n: { ...cache.corpo.n8n, checado: false },
      idadeMs: t0 - cache.at, doCache: true };
  }

  const configurado = booleanoOuNulo(n8n && n8n.configured);
  const podeLer = typeof (n8n && n8n.listWorkflows) === "function";

  const alvo = {
    configurado,
    instancia,
    checado: false,
    /* `null` NÃO é `false`. `null` = não perguntei nesta colheita; `false` =
       perguntei e não respondeu. As duas levam a decisões opostas. */
    respondeu: null,
    fluxos: null,
    parcial: null,
    teto: TETO_LEITURA,
    httpStatus: null,
    erro: null,
    ms: null
  };

  /* Só pergunta com `configurado === true`. Com `false` não há o que perguntar; e
     com `null` — o módulo injetado não disse — perguntar produziria
     `respondeu: false` sobre uma instância possivelmente nem configurada, que é
     o desconhecido caindo no ramo negativo um nível acima. */
  if (configurado === true && podeLer) {
    alvo.checado = true;
    const inicio = Number(agora()) || 0;
    try {
      const linhas = await n8n.listWorkflows(ignorarCacheDoN8n ? { force: true } : undefined);
      const c = contarFluxos(linhas);
      alvo.respondeu = true;
      alvo.fluxos = c.fluxos;
      alvo.parcial = c.parcial;
      alvo.httpStatus = 200;
      alvo.ms = (Number(agora()) || 0) - inicio;
    } catch (err) {
      alvo.respondeu = false;
      alvo.httpStatus = statusDoErro(err);
      alvo.erro = varrer((err && err.message) || String(err)) || null;
      alvo.ms = (Number(agora()) || 0) - inicio;
    }
  } else if (configurado === true && !podeLer) {
    /* Nosso defeito de fiação, não uma instância muda. `respondeu` fica `null`:
       marcar `false` aqui acusaria o n8n de um erro nosso, que é a direção que
       este repositório recusa em toda mensagem de falha. */
    alvo.erro = "o módulo n8n injetado não expõe `listWorkflows`";
  }

  const corpo = {
    em: new Date(t0).toISOString(),
    idadeMs: 0,
    doCache: false,
    n8n: alvo,
    claude: {
      /* Os três estados de novo, e aqui é onde a regra é mais barata de quebrar. */
      cliAchada: booleanoOuNulo(fix && fix.claudeFound),
      caminho: typeof (fix && fix.claudeBin) === "string" ? varrer(fix.claudeBin) : null,
      sandbox: booleanoOuNulo(fix && fix.sandboxEnabled),
      /* Preenchidos abaixo por `perguntarLogin`. Nascem `null` — "não perguntei"
         — e não `false`, que seria "perguntei e ela não está logada". */
      logado: null, rota: null, plano: null, conta: null, org: null,
      porqueNaoSei: null
    },
    codex: { integrado: false, porque: CODEX_PORQUE },
    /* Tres estados, e o ausente NAO e "nao tem adaptador": e "o cockpit que esta
       respondendo subiu antes de o adaptador existir". O Node nao recarrega o
       `server.js`, entao esse caso e real e a tela tem de dizer para reabrir a
       janela -- nunca desenhar como se a escolha de IA nao existisse. */
    ia: capacidadesDe(ia)
  };

  await perguntarLogin(corpo.claude, autenticar);

  if (alvo.respondeu === true) cache = { at: t0, instancia, corpo };
  return corpo;
}

/* Os fatos do adaptador, com a mesma disciplina do resto do arquivo: nunca lanca.
   Um adaptador quebrado nao pode derrubar a rota inteira -- ele e uma das cinco
   coisas que esta tela mostra, e as outras quatro continuam validas. */
function capacidadesDe(ia) {
  if (!ia || typeof ia.capacidades !== "function") return null;
  try {
    const c = ia.capacidades();
    return (c && typeof c === "object") ? c : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────── login do Claude
   Fato, nunca juízo: devolve `logado`, `rota`, `plano`, e o motivo quando não
   deu para saber. Quem decide que `rota: "claude.ai"` significa "sai do plano
   dela, sem cartão" é a página.

   Nunca lança. Um `catch` aqui é a diferença entre a tela dizer "não consegui
   perguntar" e o painel inteiro devolver 500 porque um CLI demorou. */
async function perguntarLogin(c, autenticar) {
  /* Sem CLI no disco não há o que perguntar — e isso NÃO é "não está logada".
     São coisas diferentes e a tela precisa poder dizer qual. */
  if (c.cliAchada !== true) {
    c.porqueNaoSei = c.cliAchada === false
      ? "não perguntei: o CLI do Claude não está nesta máquina."
      : "não perguntei: não sei nem se o CLI está aqui.";
    return;
  }
  if (typeof autenticar !== "function") {
    /* Fiação nossa, não problema dela. A frase diz de quem é a culpa, porque a
       alternativa é a pessoa procurar defeito na instalação dela. */
    c.porqueNaoSei = "não perguntei: esta versão do cockpit subiu sem a checagem de login ligada.";
    return;
  }
  try {
    const r = await autenticar();
    if (!r || typeof r !== "object") {
      c.porqueNaoSei = "perguntei e a resposta não veio no formato esperado.";
      return;
    }
    /* `logado` só vira booleano se veio booleano. Um `undefined` do CLI não
       pode virar `false` — seria a ausência caindo no ramo negativo, de novo. */
    c.logado = booleanoOuNulo(r.loggedIn);
    c.rota = typeof r.authMethod === "string" ? varrer(r.authMethod) : null;
    c.plano = typeof r.subscriptionType === "string" ? varrer(r.subscriptionType) : null;
    /* Conta e organização são dados da pessoa. Atravessam porque é a máquina
       dela e é como ela confere que é a conta certa — e a tela marca os dois
       como `sens`, então o modo gravação os borra, igual ao host do n8n. */
    c.conta = typeof r.email === "string" ? varrer(r.email) : null;
    c.org = typeof r.orgName === "string" ? varrer(r.orgName) : null;
    if (c.logado === null) c.porqueNaoSei = "perguntei, mas a resposta não disse se está logada.";
  } catch (err) {
    /* Varrido como qualquer outra mensagem que sai daqui: o erro de um CLI pode
       ecoar caminho, variável de ambiente ou pedaço de token. */
    c.porqueNaoSei = "não consegui perguntar: " + (varrer((err && err.message) || String(err)) || "erro sem mensagem");
  }
}

module.exports = {
  colher, limparCache,
  /* Exportadas para o teste poder provar cada decisão isolada, sem falso e sem
     rede: a varredura da chave, a extração do status, a derivação do host, o
     piso de fluxos e a regra dos três estados. */
  varrer, statusDoErro, hostDe, contarFluxos, booleanoOuNulo, perguntarLogin, capacidadesDe,
  CACHE_MS, MSG_CAP, TETO_LEITURA, CODEX_PORQUE, SEM_SEGREDO
};
