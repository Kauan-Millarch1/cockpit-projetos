/* dossie-incremental-test.js — a escrita incremental do dossiê e as três travas
 * (PLAN.md de `docs/codex-review/dossie-incremental-20260820-1016`, Steps 2, 2b e 3).
 *
 * O QUE ESTE ARQUIVO EXISTE PARA PROVAR, em uma frase por bloco:
 *
 * 1. A REGRA DE ADMISSÃO. Incremental só herda de dossiê VERDE ou LARANJA, com o
 *    selo `gateV` em dia. Ela sozinha fecha dois achados da rodada 1 da revisão —
 *    cabeçalho legado divergente é vermelho, então só migra por rewrite inteiro; e
 *    `entraram`/`sairam` é vermelho, então nó entrando no meio nunca herda nada.
 *    Uma cor desconhecida RECUSA: uma quinta cor que signifique algo pior que
 *    vermelho não pode liberar herança por não estar na lista.
 *
 * 2. PROCEDÊNCIA, NÃO SÓ COR (achado 2 da rodada 2). Um dossiê volta ao verde por
 *    impressão digital carregando parágrafo que já era suspeito. Dois limites: a
 *    marca de um salto NÃO EMPILHA, e `g >= MAX_GERACOES` não é herdável.
 *
 * 3. DOIS PORTÕES, NÃO UM (achado 4 da rodada 1). `validar` lê o formato de
 *    rodada (`## no:`) e roda sobre o TEXTO NOVO; `vazou` roda sobre o DOCUMENTO
 *    COMPOSTO, porque parágrafo herdado pode casar valor que entrou no fluxo
 *    depois de ele ser escrito. Um portão só deixaria um dos dois furos abertos.
 *
 * 4. AS TRÊS TRAVAS E A ORDEM ENTRE ELAS (Step 2b). Três destas corridas existem
 *    HOJE, antes deste plano, e nenhuma jamais foi disparada — foram achadas por
 *    revisão, não por uso. A rodada 3 do Codex aprovou o desenho "desde que a
 *    implementação preserve esta ordem", e pediu explicitamente teste para a ORDEM
 *    das travas e para o TETO de espera do publish curto. É o bloco 6.
 *
 * O TETO DE TEMPO É OBRIGATÓRIO EM TODO BLOCO DE TRAVA, e é a lição do
 * `mutex-test.js`: um deadlock não falha, ele PARA. Sem correr contra o relógio, o
 * mutante que quebra a ordem deixaria este arquivo pendurado para sempre e o
 * resultado seria "rodando", nunca "vermelho". Um teste de deadlock que trava é um
 * teste que ninguém roda duas vezes.
 *
 * `construir()` NÃO É CHAMADO AQUI, e isso é limite, não preguiça: ele gasta cota
 * do plano, leva 11 minutos medidos e ESCREVE. O que se prova é por função pura
 * (`admitirIncremental`, `planoIncremental`, `montarParagrafos`, `marcaDoParagrafo`,
 * `modoDe`) e por injeção — o cliente do n8n é trocado no `require.cache`, como
 * `escrever-test.js` e `reexec-test.js` fazem, e nada fala com a instância.
 *
 * `dossies.json` é SALVO E RESTAURADO byte a byte (bloco 5), mesma disciplina do
 * `cancelar-test.js` com o `blueprints.json`: o ledger é rastreado em git e é o
 * único lugar onde o gasto desta aba existe.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhuma escrita no n8n.
 * node dossie-incremental-test.js */

/* Cravado ANTES do require: `ESCRITA_TIMEOUT_MS` é lido no carregamento do
   módulo. Mesmo motivo e mesmo número do `mutex-test.js`. */
process.env.COCKPIT_ESCRITA_TIMEOUT_MS = "300";

const fs = require("fs");
const path = require("path");

/* ═══ A INJEÇÃO: o `getRawWorkflow` é nosso, o resto do `n8n.js` é o de verdade.
 *
 * A fila de escrita TEM de ser a real: o que este arquivo prova é a ordem entre
 * ela e as travas do dossiê, e uma fila de mentira provaria a cópia. Então só a
 * leitura do workflow é trocada — é a única coisa aqui que falaria com a
 * instância de produção do Kauan.
 *
 * A troca é no `.exports` do registro do `require.cache`, ANTES de o `dossie.js`
 * ser carregado: `claude-fix.js` e `tester.js` também requerem `n8n.js` e também
 * recebem esta versão, o que é correto justamente porque ela repassa tudo. */
const n8nReal = require("./n8n.js");
const instancia = {
  updatedAt: "2026-08-20T10:00:00.000Z",
  segura: null,     // uma promessa para pendurar a leitura
  leituras: 0
};
const n8nFake = {};
for (const k of Object.keys(n8nReal)) n8nFake[k] = n8nReal[k];
n8nFake.getRawWorkflow = async id => {
  instancia.leituras++;
  if (instancia.segura) await instancia.segura;
  return { id: String(id), name: "Fluxo de Teste", updatedAt: instancia.updatedAt, nodes: [], connections: {}, settings: {} };
};
require.cache[require.resolve("./n8n.js")].exports = n8nFake;

const d = require("./dossie.js");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}
const espera = ms => new Promise(r => setTimeout(r, ms));
async function joga(f) { try { await f(); return null; } catch (e) { return e; } }

/* A rede contra o deadlock. `travou: true` é vermelho, nunca pendurado. */
async function comTeto(ms, p) {
  let estourou = false;
  const alarme = espera(ms).then(() => { estourou = true; });
  const r = await Promise.race([p.then(v => ({ v })).catch(e => ({ e })), alarme]);
  return estourou ? { travou: true } : r;
}

/* ═════════════════════════════ OS FIXTURES ════════════════════════════════ */

const no = (name, extra = {}) => ({
  name, type: "n8n-nodes-base.noOp", typeVersion: 1, position: [0, 0], parameters: {}, ...extra
});

/* Webhook → Buffer → Decide, e o Decide abre em dois ramos. A vizinhança importa:
   os vizinhos do `Decide` são Buffer, Manda e Grava, e os do Buffer são Webhook e
   Decide — é isso que faz o ponto fixo do "um salto não empilha" ter mais de uma
   volta para dar. */
function FLUXO() {
  return {
    id: "wf1", name: "Fluxo de Teste", updatedAt: "2026-08-20T10:00:00.000Z",
    settings: { executionOrder: "v1" },
    nodes: [
      no("Webhook", { type: "n8n-nodes-base.webhook" }),
      no("Buffer"),
      no("Decide", { type: "n8n-nodes-base.if", parameters: { modo: "um" } }),
      no("Manda", { type: "n8n-nodes-base.slack", parameters: { channel: "#comercial" } }),
      no("Grava", { type: "n8n-nodes-base.supabase", parameters: { tableId: "leads" } }),
      { name: "Post-it", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [0, 0], parameters: { content: "LOCK" } }
    ],
    connections: {
      Webhook: { main: [[{ node: "Buffer", type: "main", index: 0 }]] },
      Buffer: { main: [[{ node: "Decide", type: "main", index: 0 }]] },
      Decide: { main: [[{ node: "Manda", type: "main", index: 0 }], [{ node: "Grava", type: "main", index: 0 }]] }
    }
  };
}

/* Um dossiê montado pelo PRÓPRIO `compor` a partir das impressões reais, nunca
   com hash escrito à mão — hash de fixture prova o fixture, não o código.
   `marcas` deixa cravar `g` e `umHop` por nó, que é o que os casos de procedência
   precisam e o que nenhum caminho de produção escreve à mão. */
const DE_ANTES = "2026-08-19T09:00:00.000Z";
function dossieDe(wf, { textos, marcas, modo, escritoEm = DE_ANTES } = {}) {
  const imp = d.impressoes(wf);
  const paragrafos = d.executaveis(wf).map(n => {
    const nome = String(n.name);
    const m = (marcas || {})[nome] || {};
    return {
      no: nome, fp: imp.porNo.get(nome), de: m.de || escritoEm,
      g: m.g || 0, umHop: !!m.umHop,
      texto: (textos || {})[nome] || "faz uma coisa e passa adiante."
    };
  });
  return d.parse(d.compor({
    wf, global: imp.global, settingsFp: imp.settingsFp, conexoesFp: imp.conexoesFp, conexoesPorNo: imp.conexoesPorNo,
    paragrafos, visao: "Recebe lead, decide e manda.", escritoEm, modelo: "sonnet", modo
  }));
}

/* O MESMO dossiê sem o selo do portão — a forma EXATA dos dois `.md` que estão no
   disco hoje (verificado: nenhum dos dois tem `gateV`). Ele existe porque um teste
   que só exercitasse o formato novo provaria o código novo e não diria nada sobre
   o caminho de migração dos dois arquivos que custaram US$6,20. */
function semSelo(doc, wf, gateV) {
  const imp = d.impressoes(wf);
  const md = d.compor({
    wf, global: imp.global, settingsFp: imp.settingsFp, conexoesFp: imp.conexoesFp, conexoesPorNo: imp.conexoesPorNo,
    paragrafos: doc.paragrafos, visao: "x", escritoEm: DE_ANTES, modelo: "sonnet"
  });
  const cab = { fp: imp.global, wfId: String(wf.id || ""), em: DE_ANTES,
    settingsFp: imp.settingsFp, conexoesFp: imp.conexoesFp, conexoesPorNo: Object.fromEntries(imp.conexoesPorNo) };
  if (gateV != null) cab.gateV = gateV;
  return d.parse(md.replace(/^<!-- GLOBAL \{.*\} -->$/m, "<!-- GLOBAL " + JSON.stringify(cab) + " -->"));
}

/* Um fluxo com o `Decide` mudado: laranja de 1 em 5 = 20%, abaixo do
   `LIMITE_LARANJA`. É o caso que a feature existe para atender. */
function wfDecideMudou() {
  const w = FLUXO();
  w.nodes.find(n => n.name === "Decide").parameters.modo = "dois";
  return w;
}

const fonte = fs.readFileSync(path.join(__dirname, "dossie.js"), "utf8");
/* Fonte SEM COMENTÁRIO, e isto é a lição que o `dossie-tela-test.js` acabou de
   pagar: um caso que casa dentro de um comentário aprova a documentação de uma
   decisão no melhor caso e a AUSÊNCIA dela no pior. Lá, apagar a guarda inteira
   deixou dois casos verdes porque o comentário citava o nome da função. */
const fonteViva = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const corpoDe = nome => {
  const re = new RegExp("(?:async )?function " + nome + "\\([\\s\\S]*?\\n\\}", "m");
  return (fonteViva.match(re) || [""])[0];
};

(async () => {

/* ══════════════ 1. A REGRA DE ADMISSÃO — uma regra, dois achados ═══════════ */

console.log("\n[ 01 ] admissão: incremental só de verde ou laranja, e com selo em dia");

const wf = FLUXO();
const verde = dossieDe(wf);
t("dossiê verde é admitido", d.admitirIncremental(verde, d.estado(verde, wf)).ok === true);

const wfL = wfDecideMudou();
const stL = d.estado(verde, wfL);
t("o fixture laranja é mesmo laranja (1 de 5 nós = 20%)", stL.cor === "laranja" && stL.mudados.join() === "Decide");
t("dossiê laranja é admitido — entregue com ressalva é entregue",
  d.admitirIncremental(verde, stL).ok === true);

/* VERMELHO RECUSA, e é a regra que fecha os achados 2 e 3 da rodada 1 de uma vez:
   herdar de vermelho publicaria parágrafo que o próprio portão já declarou falso. */
const wfSettings = FLUXO(); wfSettings.settings.executionOrder = "v0";
const stS = d.estado(verde, wfSettings);
t("o fixture de `settings` é vermelho", stS.cor === "vermelho" && /settings/.test(stS.motivo));
const recS = d.admitirIncremental(verde, stS);
t("dossiê vermelho é RECUSADO", recS.ok === false);
t("...e a frase diz que vermelho significa contexto mudado", /todo parágrafo fala de um contexto que mudou/.test(recS.porque));

/* Achado 3 da rodada 1, pela regra e não por mecanismo próprio: nó entrando no
   meio do fluxo é vermelho, então nunca herda nada. */
const wfEntrou = FLUXO();
wfEntrou.nodes.push(no("Novo"));
wfEntrou.connections.Buffer = { main: [[{ node: "Novo", type: "main", index: 0 }]] };
wfEntrou.connections.Novo = { main: [[{ node: "Decide", type: "main", index: 0 }]] };
const stE = d.estado(verde, wfEntrou);
t("nó que entrou no meio é vermelho", stE.cor === "vermelho" && stE.entraram.join() === "Novo");
t("...e por isso não é admitido — sem segundo mecanismo", d.admitirIncremental(verde, stE).ok === false);

/* Achado 2 da rodada 1: cabeçalho legado DIVERGENTE é vermelho, então a única
   migração é o rewrite inteiro. E o cabeçalho legado que NÃO divergiu é verde por
   cor — e recusado pelo selo, que é o portão do Step 2. Os dois dossiês reais
   estão exatamente nesse segundo estado. */
const legado = semSelo(verde, wf, null);
t("o fixture legado não tem selo", legado.gateV === null);
t("...e ainda é verde por cor (não nasce vermelho no deploy)", d.estado(legado, wf).cor === "verde");
const recLeg = d.admitirIncremental(legado, d.estado(legado, wf));
t("dossiê sem selo `gateV` é RECUSADO", recLeg.ok === false);
t("...e a frase diz que é o selo que falta, não a cor", /gateV/.test(recLeg.porque) && /nada identifica/.test(recLeg.porque));

const velho = semSelo(verde, wf, d.GATE_V - 1);
const recV = d.admitirIncremental(velho, d.estado(velho, wf));
t("selo mais VELHO que o portão atual é recusado", recV.ok === false);
t("...nomeando as duas versões", recV.porque.includes("gateV " + (d.GATE_V - 1)) && recV.porque.includes("`" + d.GATE_V + "`"));
/* Selo mais NOVO é o processo velho servindo arquivo novo, e um portão mais novo é
   mais FORTE: o parágrafo passou por regra pelo menos tão dura quanto a atual. */
const novo = semSelo(verde, wf, d.GATE_V + 1);
t("selo mais NOVO herda — portão mais novo é mais forte, não desconhecido",
  d.admitirIncremental(novo, d.estado(novo, wf)).ok === true);

/* CINZA NUNCA É VERDE NEM VERMELHO: é a ausência, e não há de onde herdar. */
const recC = d.admitirIncremental(null, d.estado(null, wf));
t("cinza (nunca escrito) é recusado", recC.ok === false);
t("...com a frase da ausência, não a do vermelho", /não existe dossiê/.test(recC.porque));

/* FAIL-CLOSED NA COR DESCONHECIDA. Uma quinta cor que signifique algo pior que
   vermelho não pode liberar herança por não estar na lista de recusa. */
t("cor desconhecida é recusada", d.admitirIncremental(verde, { cor: "roxo", mudados: [] }).ok === false);
t("estado ausente é recusado", d.admitirIncremental(verde, null).ok === false);
t("as cores herdáveis são exatamente verde e laranja",
  [...d.CORES_HERDAVEIS].sort().join(",") === "laranja,verde");

/* ═══════════ 2. O CONJUNTO A REGENERAR — e a visão vai sempre ════════════ */

console.log("\n[ 02 ] o que refazer: `mudados`, mais SEMPRE a visão");

const pl = d.planoIncremental(verde, stL, wfL);
t("o plano sai ok de um laranja", pl.ok === true);
t("regenera o nó que divergiu", pl.regenerar.join() === "Decide");
t("...e herda os outros quatro", pl.herdar.length === 4 && !pl.herdar.includes("Decide"));
t("a visão é reescrita SEMPRE — é o mapa do fluxo", pl.visao === true);
t("o motivo de cada um entra no plano", pl.razoes.Decide === "a impressão digital divergiu");
t("plano de dossiê recusado devolve o porquê, nunca conjunto vazio",
  d.planoIncremental(verde, stS, wfSettings).ok === false && !!d.planoIncremental(verde, stS, wfSettings).porque);

/* `visaoSuspeita` SOZINHO com `mudados` vazio é escrita incremental legítima de
   UMA seção. É o caso da reordenação de irmãos dentro do mesmo ramo, que o Step 1
   tornou localizável — aqui ele aparece pelo lado do plano. */
const wfReorder = FLUXO();
wfReorder.connections.Decide = { main: [[{ node: "Manda", type: "main", index: 0 }, { node: "Grava", type: "main", index: 0 }]] };
const wfReorder2 = FLUXO();
wfReorder2.connections.Decide = { main: [[{ node: "Grava", type: "main", index: 0 }, { node: "Manda", type: "main", index: 0 }]] };
const docR = dossieDe(wfReorder);
const stR = d.estado(docR, wfReorder2);
t("reordenar irmãos no mesmo ramo NÃO fica verde", stR.cor !== "verde");
t("...e a visão fica suspeita", stR.visaoSuspeita === true);
const plR = d.planoIncremental(docR, stR, wfReorder2);
t("...e o plano é admitido", plR.ok === true);
t("...com a visão sempre reescrita", plR.visao === true);

/* ════════ 3. PROCEDÊNCIA: a marca não empilha, e a geração tem teto ══════ */

console.log("\n[ 03 ] procedência — cor não basta (achado 2 da rodada 2)");

/* O `Buffer` já estava marcado "vizinho de mudança" na escrita anterior, e é
   vizinho do `Decide`, que mudou agora. Marcá-lo DE NOVO é como uma ressalva vira
   mobília: na terceira escrita ninguém lê mais o `⚠`. Ele é REGENERADO. */
const comMarca = dossieDe(wf, { marcas: { Buffer: { umHop: true } } });
t("a marca de um salto sobrevive ao disco", comMarca.paragrafos.find(p => p.no === "Buffer").umHop === true);
const plM = d.planoIncremental(comMarca, d.estado(comMarca, wfL), wfL);
t("parágrafo já marcado que seria marcado de novo é REGENERADO",
  plM.regenerar.includes("Buffer") && plM.regenerar.includes("Decide"));
t("...e sai da lista de marcados, em vez de ganhar a marca duas vezes", !plM.umHop.includes("Buffer"));
t("...com o motivo dizendo exatamente isso", /seria marcado de novo/.test(plM.razoes.Buffer));
/* Quem NÃO estava marcado só recebe a marca — regenerar todo vizinho seria o
   rewrite inteiro com outro nome. */
t("vizinho ainda não marcado é MARCADO, não regenerado",
  plM.umHop.includes("Manda") && plM.umHop.includes("Grava") && !plM.regenerar.includes("Manda"));

/* É PONTO FIXO, não uma passada. Promover o `Buffer` faz o `Webhook` virar
   vizinho de mudança — e ele também já estava marcado. Uma passada só o deixaria
   remarcado, que é justamente o que esta regra proíbe. */
const dois = dossieDe(wf, { marcas: { Buffer: { umHop: true }, Webhook: { umHop: true } } });
const plD = d.planoIncremental(dois, d.estado(dois, wfL), wfL);
t("o ponto fixo dá mais de uma volta: Webhook também é promovido",
  plD.regenerar.includes("Webhook") && plD.regenerar.includes("Buffer") && plD.regenerar.includes("Decide"));
t("...e nenhum marcado sobra remarcado",
  plD.umHop.every(n => !dois.paragrafos.find(p => p.no === n).umHop));
t("...e ele termina, sem varrer o fluxo inteiro", plD.herdar.length === 2);

/* O teto de gerações é o limite que a marca NÃO pega: um parágrafo que nunca
   ficou ao lado de nada enquanto o fluxo em volta se mexeu. */
t("MAX_GERACOES é 3 e está rotulado como chute não calibrado",
  d.MAX_GERACOES === 3 && /CHUTE NÃO CALIBRADO[\s\S]{0,900}MAX_GERACOES = 3/.test(fonte));
const gasto = dossieDe(wf, { marcas: { Manda: { g: d.MAX_GERACOES } } });
t("a geração sobrevive ao disco", gasto.paragrafos.find(p => p.no === "Manda").g === d.MAX_GERACOES);
const plG = d.planoIncremental(gasto, d.estado(gasto, wf), wf);
t("dossiê VERDE ainda regenera o parágrafo de geração esgotada", plG.regenerar.join() === "Manda");
t("...com o motivo nomeando o teto", /sobreviveu 3 geração/.test(plG.razoes.Manda));
const plQuase = d.planoIncremental(dossieDe(wf, { marcas: { Manda: { g: d.MAX_GERACOES - 1 } } }), d.estado(verde, wf), wf);
t("uma geração abaixo do teto ainda herda", !plQuase.regenerar.includes("Manda"));

/* Campo malformado nunca herda para sempre: `"3"` não é geração, e `NaN >= teto`
   seria `false`, ou seja um parágrafo imortal por causa de um cabeçalho editado. */
const sujo = d.parse('<!-- NO {"no":"X","fp":"a","de":"dossie","g":"3"} -->\ntexto.');
t("`g` que não é inteiro cai para 0, nunca para NaN", sujo.paragrafos[0].g === 0);
t("`h` aceita 1 e true, e ausente é false",
  d.parse('<!-- NO {"no":"X","fp":"a","h":1} -->\nt.').paragrafos[0].umHop === true &&
  d.parse('<!-- NO {"no":"X","fp":"a","h":true} -->\nt.').paragrafos[0].umHop === true &&
  d.parse('<!-- NO {"no":"X","fp":"a"} -->\nt.').paragrafos[0].umHop === false);
/* Âncora de três campos é parágrafo de PRIMEIRA geração, nunca de geração
   desconhecida: ela foi escrita por um rewrite inteiro, que re-deriva tudo. */
t("âncora sem `g`/`h` é primeira geração, não desconhecida",
  legado.paragrafos.every(p => p.g === 0 && p.umHop === false));

/* ═════════════ 4. A HERANÇA: verbatim, e o contador que anda ═════════════ */

console.log("\n[ 04 ] montarParagrafos — herda verbatim, e a geração sobe");

const AGORA = "2026-08-20T12:00:00.000Z";
const antigo = dossieDe(wf, {
  textos: { Manda: "manda o aviso para o canal do comercial.", Decide: "decide o caminho." },
  marcas: { Manda: { g: 1 } }
});
const vFake = { paragrafos: [{ no: "Decide", fp: d.impressoes(wfL).porNo.get("Decide"), de: "dossie", texto: "decide de outro jeito agora." }], visao: "nova visão." };
const monte = d.montarParagrafos({ v: vFake, docAntigo: antigo, nos: d.executaveis(wfL), umHop: new Set(["Manda", "Grava", "Buffer"]), escritoEm: AGORA });
t("a montagem sai ok", monte.ok === true);
t("um refeito, quatro herdados", monte.regenerados === 1 && monte.herdados === 4);
const pManda = monte.paragrafos.find(p => p.no === "Manda");
const pDecide = monte.paragrafos.find(p => p.no === "Decide");
t("o texto herdado vai VERBATIM", pManda.texto === "manda o aviso para o canal do comercial.");
t("...com o `fp` dele, não recalculado", pManda.fp === antigo.paragrafos.find(p => p.no === "Manda").fp);
t("...e o `de` dele, não o desta escrita", pManda.de === DE_ANTES);
t("a GERAÇÃO do herdado sobe um", pManda.g === 2);
t("o parágrafo novo leva o carimbo desta escrita", pDecide.de === AGORA);
t("...com geração zero", pDecide.g === 0);
t("...e sem marca de vizinho — ele é a mudança", pDecide.umHop === false);
t("a marca de um salto é gravada em quem o plano marcou", pManda.umHop === true);
t("a ordem é a do FLUXO, não a do dossiê antigo",
  monte.paragrafos.map(p => p.no).join(",") === "Webhook,Buffer,Decide,Manda,Grava");

/* `de` de parágrafo LEGADO é resolvido aqui, e é o único lugar onde dá: no disco
   ele vale o literal `"dossie"`, e a data verdadeira daquele texto é o `em` do
   cabeçalho. Sem isso o rótulo do Step 3 diria "herdado de dossie". */
const monteLeg = d.montarParagrafos({ v: vFake, docAntigo: legado, nos: d.executaveis(wfL), umHop: new Set(), escritoEm: AGORA });
t("`de: \"dossie\"` legado vira a data do cabeçalho, nunca a palavra",
  monteLeg.paragrafos.find(p => p.no === "Manda").de === legado.em);

/* Inalcançável sob a admissão (`entraram` é vermelho) e tratado exatamente por
   isso — mesmo motivo do ramo `cxSemDono`. Aborto com nome, nunca herança com
   buraco, e nunca recusa mandada para um modelo que não pode consertar. */
const semUm = d.parse(d.compor({
  wf, global: "g", settingsFp: "s", conexoesFp: "c", conexoesPorNo: {},
  paragrafos: antigo.paragrafos.filter(p => p.no !== "Grava"),
  visao: "x", escritoEm: DE_ANTES, modelo: "sonnet"
}));
const buraco = d.montarParagrafos({ v: vFake, docAntigo: semUm, nos: d.executaveis(wfL), umHop: new Set(), escritoEm: AGORA });
t("nó sem parágrafo novo E sem parágrafo antigo aborta", buraco.ok === false);
t("...nomeando o nó", /`Grava`/.test(buraco.porque));

/* Sem dossiê antigo é o rewrite inteiro: tudo novo, geração zero, sem marca. */
const inteiro = d.montarParagrafos({ v: { paragrafos: antigo.paragrafos, visao: "x" }, docAntigo: null, nos: d.executaveis(wf), umHop: new Set(), escritoEm: AGORA });
t("rewrite inteiro: nada é herdado", inteiro.herdados === 0 && inteiro.regenerados === 5);
t("...e todo parágrafo nasce na geração zero, sem marca",
  inteiro.paragrafos.every(p => p.g === 0 && p.umHop === false && p.de === AGORA));

/* ════════════════ 5. DOIS PORTÕES, E O LEDGER POR MODO ══════════════════ */

console.log("\n[ 05 ] o scrub roda no documento COMPOSTO, e o preço filtra por modo");

/* O achado 4 da rodada 1, no concreto: um valor que ENTROU no fluxo depois de o
   parágrafo ser escrito. O texto novo desta rodada é limpo — `validar` passa — e o
   documento composto vaza pelo parágrafo HERDADO. Um portão só não pega isto. */
const wfVaza = wfDecideMudou();
wfVaza.nodes.find(n => n.name === "Grava").parameters.consulta = "manda o aviso para o canal do comercial.";
const antigoTexto = dossieDe(wf, { textos: { Manda: "manda o aviso para o canal do comercial." } });
/* O texto de uma rodada parcial de verdade: a visão inteira (2 a 6 linhas) mais o
   parágrafo do único nó pedido. Curto de propósito, mas não abaixo do piso — o
   piso existe para pegar rodada vazia, e uma parcial legítima é curta, nunca nula. */
const mdNovo = "## visão geral\n\nRecebe o lead pelo webhook, junta as mensagens picadas no buffer,\n"
  + "decide o caminho e manda o aviso ou grava a linha.\n\n"
  + "## no: Decide\ndecide de outro jeito agora: separa o caminho de aviso do caminho de registro.\n\n";
t("o TEXTO NOVO passa pelo portão de vazamento", d.vazou(mdNovo, wfVaza).length === 0);
const composto = d.compor({
  wf: wfVaza, global: "g", settingsFp: "s", conexoesFp: "c", conexoesPorNo: {},
  paragrafos: antigoTexto.paragrafos, visao: "Recebe e decide.", escritoEm: AGORA, modelo: "sonnet", modo: "incremental"
});
const fuga = d.vazou(composto, wfVaza);
t("...e o DOCUMENTO COMPOSTO vaza pelo parágrafo herdado", fuga.length > 0);
t("...nomeando o tipo do achado", fuga[0].tipo === "valor de parâmetro");
/* E `validar` continua falando SÓ o formato de rodada: apontá-lo para o arquivo
   final não é afrouxar o portão, é usá-lo num idioma que ele não lê. */
t("`validar` não reconhece o arquivo com âncoras como rodada",
  d.validar(composto, wfVaza, d.impressoes(wfVaza)).ok === false);

/* `somente` muda UMA coisa: quais nós são exigidos. */
const impV = d.impressoes(wfVaza);
const vParcial = d.validar(mdNovo, wfVaza, impV, { somente: new Set(["Decide"]) });
t("rodada parcial: um parágrafo e a visão bastam", vParcial.ok === true);
t("...e ela devolve só o parágrafo pedido", vParcial.paragrafos.map(p => p.no).join() === "Decide");
t("a MESMA rodada reprova como inteira — faltam quatro nós",
  d.validar(mdNovo, wfVaza, impV).ok === false);
t("rodada parcial sem a `## visão geral` reprova",
  d.validar("## no: Decide\ndecide de outro jeito, com bastante texto para passar do piso.\n", wfVaza, impV, { somente: new Set(["Decide"]) }).ok === false);
t("rodada parcial com nome de nó inventado reprova",
  d.validar("## visão geral\n\nx y z e mais texto para passar do piso de tamanho.\n\n## no: Inexistente\nnada.\n", wfVaza, impV, { somente: new Set(["Decide"]) }).ok === false);
/* Seção EXTRA não é recusada: prosa recém-derivada é estritamente melhor que a
   herdada, e recusá-la gastaria uma rodada para jogar fora trabalho bom. Ela entra
   CONTADA, senão `preco()` mediria uma coisa e cobraria outra. */
const vExtra = d.validar(mdNovo + "## no: Manda\nmanda para o canal.\n", wfVaza, impV, { somente: new Set(["Decide"]) });
t("seção fora da lista entra, e entra contada",
  vExtra.ok === true && vExtra.paragrafos.map(p => p.no).sort().join() === "Decide,Manda");
/* O portão de vazamento não é afrouxado pelo `somente` — é o mais grave dos dois. */
t("`somente` NÃO afrouxa o portão de vazamento",
  d.validar(mdNovo + "## no: Manda\nescreve manda o aviso para o canal do comercial.\n", wfVaza, impV, { somente: new Set(["Decide"]) }).ok === false);

/* ── `preco()` filtra por `modo`, e a régua de cada modo é diferente ──
   `dossies.json` é RASTREADO EM GIT e é o único lugar onde o gasto desta aba
   existe. Salvo e restaurado byte a byte, como o `cancelar-test.js` faz com o
   `blueprints.json`. */
const LEDGER = path.join(__dirname, "dossies.json");
const backup = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER) : null;
try {
  fs.writeFileSync(LEDGER, JSON.stringify({
    savedAt: AGORA, dossies: [
      { wfId: "a", nome: "A", em: AGORA, nos: 100, nosRegenerados: 100, usd: 2 },
      { wfId: "b", nome: "B", em: AGORA, nos: 200, nosRegenerados: 200, usd: 4 },
      { wfId: "c", nome: "C", em: AGORA, nos: 100, nosRegenerados: 2, usd: 0.1, modo: "incremental" },
      { wfId: "e", nome: "E", em: AGORA, nos: 100, nosRegenerados: 4, usd: 0.2, modo: "incremental" },
      { wfId: "f", nome: "F", em: AGORA, nos: 100, nosRegenerados: 0, usd: 9, modo: "incremental", ok: false }
    ]
  }, null, 2), "utf8");

  t("`modo` ausente é `inteiro` — as três linhas antigas são isso de fato",
    d.modoDe({}) === "inteiro" && d.modoDe({ modo: "incremental" }) === "incremental" && d.modoDe(null) === "inteiro");
  const pInt = await d.preco(100, "inteiro");
  /* Só as duas linhas de rewrite inteiro: mediana de 0,02 e 0,02 por nó. */
  t("o preço do rewrite inteiro usa SÓ as linhas de rewrite inteiro", pInt.amostras === 2);
  t("...e a taxa é por nó do fluxo", Math.abs(pInt.usd - 2) < 1e-9);
  const pInc = await d.preco(3, "incremental");
  /* Só as duas parciais bem-sucedidas, e a régua é usd por PARÁGRAFO REFEITO:
     0,1/2 = 0,05 e 0,2/4 = 0,05. */
  t("o preço parcial usa SÓ as linhas parciais", pInc.amostras === 2);
  t("...e a régua é usd por parágrafo REFEITO, não por nó do fluxo", Math.abs(pInc.usd - 0.15) < 1e-9);
  t("...e a tentativa reprovada fica fora das duas", pInc.usd < 1);
  t("o modo volta na resposta", pInt.modo === "inteiro" && pInc.modo === "incremental");
  /* Misturar daria US$0,02×3 no parcial e uma taxa contaminada no inteiro — número
     errado nas DUAS direções, e é o único preço que o botão mostra. */
  t("misturar os dois modos daria número diferente — é por isso que filtra",
    Math.abs(pInc.usd - 0.15) < 1e-9 && Math.abs(pInt.usd - 2) < 1e-9);

  /* Sem duas amostras DAQUELE modo, ele diz que não sabe — mesma disciplina de
     `estimate()` devolvendo `samples: 0` em vez de inventar um ETA. */
  fs.writeFileSync(LEDGER, JSON.stringify({ savedAt: AGORA, dossies: [
    { wfId: "a", nome: "A", em: AGORA, nos: 100, nosRegenerados: 100, usd: 2 }
  ] }, null, 2), "utf8");
  const magro = await d.preco(3, "incremental");
  t("sem amostra parcial o preço diz que não sabe", magro.usd === null && magro.amostras === 0);

  /* ── A TRAVA GLOBAL DO LEDGER (achado 3 da rodada 2) ──
     Trava POR FLUXO não serializa um arquivo GLOBAL: dois fluxos diferentes com
     travas diferentes ainda perdem a linha um do outro no
     `lê → empilha → grava tmp → rename`. Esta corrida existe HOJE. */
  fs.writeFileSync(LEDGER, JSON.stringify({ savedAt: AGORA, dossies: [] }, null, 2), "utf8");
  const corrida = await comTeto(3000, Promise.all([
    d.anotar({ wfId: "zzt1", nome: "Zz Um", em: AGORA, nos: 1, nosRegenerados: 1, usd: 1, modo: "inteiro" }),
    d.anotar({ wfId: "zzt2", nome: "Zz Dois", em: AGORA, nos: 1, nosRegenerados: 1, usd: 1, modo: "inteiro" })
  ]));
  t("duas anotações concorrentes não travam", !corrida.travou);
  const depois = JSON.parse(fs.readFileSync(LEDGER, "utf8")).dossies;
  t("...e NENHUMA das duas linhas foi perdida", depois.length === 2);
  t("...são as duas, de fluxos diferentes", depois.map(x => x.wfId).sort().join() === "zzt1,zzt2");

  /* A corrente não pode carregar a rejeição adiante: sem o `catch`, o primeiro
     erro de disco faria toda anotação seguinte rejeitar em cadeia e o ledger
     pararia de registrar em silêncio. */
  const explodiu = await joga(() => d.comTravaLedger(async () => { throw new Error("disco cheio"); }));
  t("um erro dentro da trava do ledger sobe", /disco cheio/.test((explodiu || {}).message || ""));
  const seguinte = await comTeto(1000, d.comTravaLedger(async () => "passou"));
  t("...e a anotação seguinte ainda funciona", seguinte.v === "passou");

  /* E o corpo do `anotar` está DENTRO dela, não ao lado. */
  t("`anotar` grava dentro da trava global", /comTravaLedger\(async \(\) => \{[\s\S]*?rename\(tmp, LEDGER\)/.test(corpoDe("anotar")));
} finally {
  if (backup) fs.writeFileSync(LEDGER, backup);
  else fs.rmSync(LEDGER, { force: true });
  t("o ledger foi restaurado byte a byte",
    backup ? fs.readFileSync(LEDGER).equals(backup) : !fs.existsSync(LEDGER));
}

/* ════════════ 6. AS TRÊS TRAVAS, E A ORDEM ENTRE ELAS ═════════════════════
 *
 * O que a rodada 3 do Codex pediu explicitamente: teste para a ORDEM das travas e
 * para o TETO de espera no publish curto. Tudo com relógio: um deadlock não falha,
 * ele para. */

console.log("\n[ 06 ] a ordem das travas — de fora para dentro, sem ciclo");

const WF = "zzteste-dossie-trava";
const alvo = d.caminho(WF);
const limpar = () => {
  fs.rmSync(alvo, { force: true });
  for (const f of (fs.existsSync(d.DIR) ? fs.readdirSync(d.DIR) : [])) {
    if (f.startsWith("zzteste-dossie-trava")) fs.rmSync(path.join(d.DIR, f), { force: true });
  }
};
limpar();

try {
  /* ── 1ª trava: por FLUXO, e ela envolve a SESSÃO INTEIRA ── */
  t("ninguém segura o fluxo no começo", d.donoDoDossie(WF) === null);
  let dentroViu = null, escritaDuranteSessao = null;
  const r1 = await comTeto(2000, d.comTravaFluxo(WF, "escrevendo o dossiê", async () => {
    dentroViu = d.donoDoDossie(WF);
    /* A PROVA DA ORDEM: durante a sessão de 11 minutos, a fila de escrita do
       `n8n.js` está LIVRE. Se ela fosse segurada aqui, todo approve concorrente
       viraria um 409 por causa do teto de 45s. */
    escritaDuranteSessao = n8nReal.donoDaEscrita().id;
    return "sessão";
  }));
  t("a sessão do dossiê roda com a trava do fluxo na mão", !r1.travou && !!dentroViu);
  t("...e a frase dela é legível", /escrevendo o dossiê/.test((dentroViu || {}).oque || ""));
  t("A FILA DE ESCRITA DO n8n FICA LIVRE durante a sessão", escritaDuranteSessao === null);
  t("e a trava do fluxo é solta no fim", d.donoDoDossie(WF) === null);

  /* Segunda escrita do MESMO fluxo é recusada com nome. Recusar em vez de
     enfileirar é o que a torna trivialmente livre de deadlock: ninguém fica
     pendurado nela, então ela nunca participa de um ciclo. */
  const presa = d.comTravaFluxo(WF, "primeira", async () => { await espera(200); return "a"; });
  await espera(20);
  const seg = await joga(() => d.comTravaFluxo(WF, "segunda", async () => "b"));
  t("segunda escrita do MESMO fluxo é recusada", !!seg);
  t("...com 409 — ocupado, não quebrado", (seg || {}).status === 409);
  t("...nomeando desde quando e com o quê", /desde 20\d\d/.test(seg.message) && /primeira/.test(seg.message));
  /* Fluxo DIFERENTE passa: escrever o dossiê de dois fluxos ao mesmo tempo é
     legítimo, e travar globalmente aqui seria inventar contenção. */
  const outro = await comTeto(1000, d.comTravaFluxo("zzteste-outro", "x", async () => "ok"));
  t("fluxo DIFERENTE não é bloqueado", outro.v === "ok");
  await presa;
  t("depois da primeira, o fluxo fica livre", d.donoDoDossie(WF) === null);

  /* A CHAVE É O NOME SANEADO, o mesmo do `caminho()`: dois ids que colapsassem no
     mesmo arquivo receberiam duas travas e correriam no mesmo `.md`, que é a
     corrida que esta trava existe para fechar. */
  const colide = d.comTravaFluxo("zz/teste-x", "primeiro", async () => { await espera(150); return "a"; });
  await espera(20);
  const colidiu = await joga(() => d.comTravaFluxo("zz:teste-x", "segundo", async () => "b"));
  t("dois ids que dão o MESMO arquivo compartilham a trava", !!colidiu);
  t("...e é o mesmo arquivo mesmo", d.caminho("zz/teste-x") === d.caminho("zz:teste-x"));
  await colide;

  const quebrou = await joga(() => d.comTravaFluxo(WF, "vai jogar", async () => { throw new Error("caiu"); }));
  t("erro na sessão sobe", /caiu/.test((quebrou || {}).message || ""));
  t("...e NÃO deixa o fluxo travado até reiniciar o processo", d.donoDoDossie(WF) === null);

  /* ── 2ª trava: `comEscrita`, e SÓ na janela curta do publish ── */
  console.log("\n[ 06b ] o publish é a janela CURTA, dentro da fila de escrita");

  const raw = { id: WF, name: "Fluxo de Teste", updatedAt: instancia.updatedAt };
  let donoNoPublish = null;
  instancia.segura = espera(60).then(() => { donoNoPublish = n8nReal.donoDaEscrita(); });
  const pub = await comTeto(3000, d.publicar({ wfId: WF, nome: "Fluxo de Teste", raw, final: "# Dossiê\n\ncorpo.", tentativa: "dteste1", diz: () => {} }));
  instancia.segura = null;
  t("o publish não trava", !pub.travou);
  t("...e publicou", pub.v && pub.v.ok === true && fs.existsSync(alvo));
  t("a fila de escrita ESTAVA segurada durante a releitura", (donoNoPublish || {}).id === "upgrade:dteste1");
  t("...com a frase que a espera mostra", /publicando o dossiê de Fluxo de Teste/.test((donoNoPublish || {}).doing || ""));
  t("...e foi solta no fim", n8nReal.donoDaEscrita().id === null);
  t("nenhum `.md.tmp` sobrou", !fs.existsSync(alvo + ".dteste1.tmp"));

  /* `updatedAt` divergente ABORTA, e é a janela `releu ok → apply entra → rename
     publica velho` que a rodada 2 corrigiu — aqui ela não existe porque releitura
     e rename dividem a mesma região crítica. */
  fs.rmSync(alvo, { force: true });
  instancia.updatedAt = "2026-08-20T11:11:11.000Z";
  const ab = await comTeto(3000, d.publicar({ wfId: WF, nome: "X", raw, final: "# outro", tentativa: "dteste2", diz: () => {} }));
  t("fluxo mudado no meio da escrita ABORTA o publish", ab.v && ab.v.ok === false);
  t("...dizendo as duas versões", /era `2026-08-20T10/.test(ab.v.porque) && /agora é `2026-08-20T11/.test(ab.v.porque));
  t("...e NADA foi publicado", !fs.existsSync(alvo));
  t("...nem sobrou tmp", !fs.existsSync(alvo + ".dteste2.tmp"));
  instancia.updatedAt = "2026-08-20T10:00:00.000Z";

  /* "Não deu para conferir" NÃO é "não mudou" — a regra que este repositório
     escreveu cinco vezes, aplicada onde errar publicaria prosa nascida velha. */
  const semData = await comTeto(3000, d.publicar({ wfId: WF, nome: "X", raw: { id: WF }, final: "# x", tentativa: "dteste3", diz: () => {} }));
  t("sem `updatedAt` de um dos lados, aborta em vez de assumir", semData.v && semData.v.ok === false);
  t("...com a frase da ignorância, não a da divergência", /não deu para conferir/.test(semData.v.porque));
  t("...e nada publicado", !fs.existsSync(alvo));

  /* ── O TETO DE ESPERA DO PUBLISH, que a rodada 3 pediu por nome ── */
  console.log("\n[ 06c ] o teto de espera do publish curto");

  t("o teto veio do ambiente", n8nReal.ESCRITA_TIMEOUT_MS === 300);
  const approve = n8nReal.writeOwner("fix", "rap1", "aplicando correção em Fluxo Vivo");
  const segurando = n8nReal.comEscrita(approve, async () => { await espera(900); });
  await espera(20);
  /* A ORDEM QUE IMPORTA, E ELA É A PROVA DE QUE NÃO HÁ CICLO: com a fila de
     escrita na mão de OUTRO dono, a sessão do dossiê ainda começa — ela pega a
     trava do fluxo na hora e só espera lá no fim, no publish. Se a ordem fosse a
     inversa (fila primeiro, sessão dentro), este bloco seria um deadlock de 11
     minutos contra um teto de 45 segundos. */
  let pegouTrava = false;
  const sessao = await comTeto(2500, d.comTravaFluxo(WF, "sessão durante um approve", async () => {
    pegouTrava = true;
    return d.publicar({ wfId: WF, nome: "X", raw, final: "# x", tentativa: "dteste4", diz: () => {} });
  }));
  t("a sessão do dossiê COMEÇA mesmo com a fila de escrita ocupada", pegouTrava);
  t("...não travou — desistiu no teto", !sessao.travou);
  t("...e o que chegou foi a recusa da fila", !!sessao.e);
  t("...com 409", (sessao.e || {}).status === 409);
  t("...nomeando o dono corrente da fila", /aplicando correção em Fluxo Vivo/.test((sessao.e || {}).message || ""));
  t("...e NADA foi publicado por quem desistiu", !fs.existsSync(alvo));
  t("...nem sobrou tmp de quem desistiu", !fs.existsSync(alvo + ".dteste4.tmp"));
  await segurando;
  t("depois do approve, a fila fica livre", n8nReal.donoDaEscrita().id === null);
  t("...e o fluxo também", d.donoDoDossie(WF) === null);

  /* Nada dentro da fila de escrita pede a trava de fluxo, e nada dentro da trava
     de fluxo segura a fila pela sessão: é a ausência dessas duas linhas que faz o
     ciclo ser impossível, não a sorte da ordem de chamada. */
  t("`publicar` não pede a trava de FLUXO de dentro da fila", !/comTravaFluxo/.test(corpoDe("publicar")));
  t("`comTravaFluxo` não segura a fila de escrita", !/comEscrita/.test(corpoDe("comTravaFluxo")));
  t("`anotar` não segura nem uma nem outra", !/comEscrita|comTravaFluxo/.test(corpoDe("anotar")));
  t("a sessão inteira roda DENTRO da trava do fluxo",
    /comTravaFluxo\(wfId,[\s\S]{0,200}umaEscrita\(wfId/.test(corpoDe("construir")));
  t("o `finally` que solta a trava do fluxo existe", /finally \{ travasFluxo\.delete\(k\); \}/.test(fonteViva));
  /* A ordem dentro do `publicar`: releitura E rename do MESMO lado da fila. */
  t("releitura e rename dividem a região crítica",
    /comEscrita\(owner, async \(\) => \{[\s\S]*getRawWorkflow\(wfId\)[\s\S]*rename\(tmp, alvo\)/.test(corpoDe("publicar")));
} finally {
  limpar();
}

/* ═══════ 7. A PASTA É POR TENTATIVA, e o `rm -rf` deixou de ser cego ═════ */

console.log("\n[ 07 ] a pasta de trabalho é por TENTATIVA, não por fluxo");

const RUNS = path.join(__dirname, ".dossie-runs");
const p1 = await d.pastaDaTentativa("zzteste-pasta", "dta1");
const p2 = await d.pastaDaTentativa("zzteste-pasta", "dta2");
try {
  t("duas tentativas do MESMO fluxo dão pastas DIFERENTES", p1 !== p2);
  t("...as duas dentro de `.dossie-runs`", p1.startsWith(RUNS) && p2.startsWith(RUNS));
  t("...e o id da tentativa está no nome", p1.endsWith("__dta1") && p2.endsWith("__dta2"));
  /* O defeito que existe HOJE: a pasta vinha só do `wfId` e a entrada fazia
     `rm -rf`, então a segunda escrita apagava a pasta da primeira NO MEIO da
     sessão. Aqui a da primeira sobrevive. */
  t("a pasta da primeira tentativa sobreviveu à segunda", fs.existsSync(p1));
  /* E a de OUTRO fluxo nunca é tocada, em nenhuma hipótese. */
  const outroFluxo = await d.pastaDaTentativa("zzteste-vizinho", "dtb1");
  fs.writeFileSync(path.join(outroFluxo, "marca.txt"), "x", "utf8");
  await d.pastaDaTentativa("zzteste-pasta", "dta3");
  t("pasta de OUTRO fluxo nunca é apagada", fs.existsSync(path.join(outroFluxo, "marca.txt")));
  /* A poda é por IDADE, e o corte vem do teto da própria rodada: uma pasta mais
     velha que a vida máxima de uma sessão não pode estar em uso. Sem isso, ou as
     pastas crescem para sempre, ou a poda volta a ser o `rm -rf` cego. */
  const antiga = path.join(RUNS, "zzteste-pasta__dtvelha");
  fs.mkdirSync(antiga, { recursive: true });
  const velhoT = Date.now() / 1000 - 60 * 60 * 24;
  fs.utimesSync(antiga, velhoT, velhoT);
  await d.pastaDaTentativa("zzteste-pasta", "dta4");
  t("pasta antiga do MESMO fluxo é podada", !fs.existsSync(antiga));
  t("...e a recém-criada não", fs.existsSync(p1));
  t("o corte de idade vem do teto da rodada, não de um número solto",
    /VIDA_PASTA_MS = TETO_MS \* MAX_RODADAS/.test(fonteViva));
  t("o id da tentativa serve de `ref` para o dono da fila",
    /^[A-Za-z0-9_-]{1,64}$/.test(d.idTentativa()));
  t("...e começa com `d`, para não reentrar com uma run de correção",
    d.idTentativa().startsWith("d") && d.idTentativa() !== d.idTentativa());
} finally {
  for (const e of fs.existsSync(RUNS) ? fs.readdirSync(RUNS) : []) {
    if (e.startsWith("zzteste")) fs.rmSync(path.join(RUNS, e), { recursive: true, force: true });
  }
}

/* ════════ 8. O QUE INCREMENTAL NÃO PROVA — e é declarado (Step 3) ════════ */

console.log("\n[ 08 ] a terceira etiqueta, e a frase que não vira mobília");

const impI = d.impressoes(wfL);
const paras = [
  { no: "Webhook", fp: impI.porNo.get("Webhook"), de: DE_ANTES, g: 1, texto: "recebe." },
  { no: "Buffer", fp: impI.porNo.get("Buffer"), de: "2026-08-17T08:00:00.000Z", g: 2, umHop: true, texto: "junta." },
  { no: "Decide", fp: impI.porNo.get("Decide"), de: AGORA, g: 0, texto: "decide." },
  { no: "Manda", fp: impI.porNo.get("Manda"), de: DE_ANTES, g: 1, umHop: true, texto: "manda." },
  { no: "Grava", fp: impI.porNo.get("Grava"), de: DE_ANTES, g: 1, texto: "grava." }
];
const mdInc = d.compor({ wf: wfL, global: impI.global, settingsFp: impI.settingsFp, conexoesFp: impI.conexoesFp, conexoesPorNo: impI.conexoesPorNo, paragrafos: paras, visao: "Recebe, decide e manda.", escritoEm: AGORA, modelo: "sonnet", modo: "incremental" });

t("o cabeçalho diz que foi construído incrementalmente", /\*\*Construído incrementalmente\*\*/.test(mdInc));
t("...com quantos parágrafos são herdados", /4 de 5 parágrafo\(s\) foram HERDADOS/.test(mdInc));
t("...e de que datas", /2026-08-17, 2026-08-19/.test(mdInc));
/* O RÓTULO NÃO PODE ALEGAR QUE A IMPRESSÃO É PROVA DA PROSA. É a perda real desta
   feature, e declarar é o mínimo que dá para fazer. */
t("...e diz o que a impressão digital NÃO prova", /\*\*nunca\*\* que a/.test(mdInc) && /prosa sobre ele continua verdadeira/.test(mdInc));
t("...e que um rewrite inteiro re-deriva", /rewrite inteiro re-deriva/.test(mdInc));
/* As duas etiquetas antigas continuam inteiras: a nova é uma TERCEIRA, não uma
   substituição. */
t("as duas etiquetas obrigatórias antigas seguem lá",
  /Escrito por um modelo/.test(mdInc) && /A partir da versão de/.test(mdInc));

/* Ela SÓ aparece no modo incremental: escrevê-la sempre, com "0 herdados", ensina
   a pular a linha — e é justamente a linha que tem de ser lida quando vale. */
const mdCheio = d.compor({ wf: wfL, global: impI.global, settingsFp: impI.settingsFp, conexoesFp: impI.conexoesFp, conexoesPorNo: impI.conexoesPorNo, paragrafos: paras, visao: "x", escritoEm: AGORA, modelo: "sonnet" });
t("rewrite inteiro NÃO carrega a etiqueta", !/Construído incrementalmente/.test(mdCheio));
t("...e `modo` ausente não é tratado como incremental", !/HERDADOS/.test(mdCheio));

/* A etiqueta é PROSA e sobrevive ao filtro de âncora do `paraPrompt` — que existe
   para os 5,5KB de hex do mapa de conexões não entrarem em todo prompt. */
const docInc = d.parse(mdInc);
const pp = d.paraPrompt(docInc, wfL);
t("a etiqueta CHEGA no prompt", pp.usa === true && /Construído incrementalmente/.test(pp.texto));
t("...e a âncora de máquina continua fora dele", !/<!-- GLOBAL/.test(pp.texto) && !/<!-- NO /.test(pp.texto));

/* ── AS DUAS MARCAS SÃO FRASES DIFERENTES, e a distinção é o ponto ── */
const stInc = d.estado(docInc, wfL);
t("o dossiê incremental do fixture está verde", stInc.cor === "verde");
t("o parágrafo marcado ganha a frase de VIZINHO", /VIZINHO DE UMA MUDANÇA/.test(pp.texto));
t("...e ela NÃO é a frase de MUDOU", !/MUDOU DEPOIS DESTE TEXTO/.test(pp.texto));
t("...e ela diz que um salto não é prova", /não é prova de nada/.test(pp.texto));
/* O parágrafo que não foi marcado não ganha nada: marcar tudo apagaria a
   distinção que o laranja existe para ter. */
const linhasPP = pp.texto.split("\n").filter(l => l.startsWith("## `"));
t("só os marcados levam ressalva", linhasPP.filter(l => /⚠/.test(l)).length === 2);
t("...e são o Buffer e o Manda", linhasPP.filter(l => /⚠/.test(l)).every(l => /Buffer|Manda/.test(l)));

/* QUANDO AS DUAS VALEM, `MUDOU` GANHA: divergência de impressão é medida, a
   adjacência é aproximação, e a mais forte é a que tem de aparecer. Frase igual
   para as duas apagaria exatamente esta diferença. */
const marcado = { no: "X", umHop: true };
t("com as duas condições, MUDOU vence VIZINHO",
  /MUDOU DEPOIS/.test(d.marcaDoParagrafo(marcado, new Set(["X"]))));
t("...e VIZINHO aparece quando só ele vale",
  /VIZINHO DE UMA MUDANÇA/.test(d.marcaDoParagrafo(marcado, new Set())));
t("...e sem nenhuma das duas não há marca", d.marcaDoParagrafo({ no: "X" }, new Set()) === "");
t("as duas frases são DIFERENTES",
  d.marcaDoParagrafo(marcado, new Set(["X"])) !== d.marcaDoParagrafo(marcado, new Set()));

/* ═══════════ 9. A RODADA PARCIAL, NO PROMPT E NO ARQUIVO ════════════════ */

console.log("\n[ 09 ] a rodada parcial: o que a sessão lê, e onde a lista mora");

const alvos = ["Decide", "Manda"];
const rp = d.regrasParciais(alvos, true);
t("o bloco parcial ANULA a regra `todos os nós` explicitamente",
  /SUBSTITUI a regra "todos os nós"/.test(rp));
t("...lista os nós pedidos", rp.includes("- `Decide`") && rp.includes("- `Manda`"));
t("...exige a visão geral", /`## visão geral` é OBRIGATÓRIA/.test(rp));
t("...e proíbe copiar o parágrafo antigo dos nós da lista", /não copie o parágrafo antigo/.test(rp));
t("...e aponta o DOSSIE.md quando ele está na pasta", /`DOSSIE.md`/.test(rp));
t("sem dossiê na pasta, ele diz que não há o que consultar", /não há dossiê antigo/.test(d.regrasParciais(alvos, false)));
/* O bloco é APENDADO ao `REGRAS`, nunca no lugar: o portão de vazamento e o
   formato são os mesmos, e reescrevê-los num segundo lugar é o defeito de duas
   cópias divergirem no primeiro conserto feito de um lado só. */
t("o `REGRAS` é reaproveitado inteiro, o parcial só se soma",
  /plano \? REGRAS \+ regrasParciais\(plano\.regenerar, true\) : REGRAS/.test(fonteViva));

/* A LISTA VAI NO ARQUIVO, NUNCA NO PROMPT: ele viaja em `-p` e a linha de comando
   do Windows acaba em 32767 caracteres. Este repositório já matou uma etapa com
   `spawn ENAMETOOLONG`, que não nomeia nem o prompt nem o tamanho. */
const muitos = Array.from({ length: 45 }, (_, i) => "Nó_com_nome_bem_longo_de_verdade_" + i);
const promptPior = d.promptIncremental({ name: "N".repeat(200) }, muitos, Array.from({ length: 14 }, (_, i) => "recusa longa ".repeat(12) + i));
t("o prompt do pior caso parcial é curto", promptPior.length < 6000);
t("...e NÃO carrega a lista de nós", !promptPior.includes(muitos[0]));
t("...mas diz quantos são", promptPior.includes("45 nó(s)"));
t("...e manda ler o REGRAS.md inteiro", /REGRAS\.md.*INTEIRO/.test(promptPior));
t("a recusa da rodada anterior volta literal", /recusa longa/.test(promptPior));
t("o bloco parcial do pior caso cabe num arquivo, não num prompt",
  d.regrasParciais(muitos, true).length > 1500);

/* ═════════════ 10. A ORDEM DAS COISAS DENTRO DO `umaEscrita` ═════════════ */

console.log("\n[ 10 ] a ordem dentro da escrita, lida da fonte");

const corpo = corpoDe("umaEscrita");
t("o corpo do `umaEscrita` foi recortado", corpo.length > 1000);
/* A admissão vem ANTES de qualquer gasto: a recusa é local e de graça, então cair
   para rewrite inteiro ali não custa nada. Depois de a sessão rodar, cair para
   inteiro dobraria o gasto sem clique — o que §2.8 recusa. */
const iPlano = corpo.indexOf("planoIncremental");
const iRodar = corpo.indexOf("rodarAvulso");
t("a admissão é decidida ANTES de a sessão rodar", iPlano > 0 && iPlano < iRodar);
t("...e a recusa dela CAI para rewrite inteiro, dizendo por quê",
  /vai de rewrite inteiro/.test(corpo) && /docAntigo = null/.test(corpo));
/* Os dois portões, na ordem, e o composto DEPOIS do `compor`. */
const iValidar = corpo.indexOf("validar(md, raw, imp");
const iCompor = corpo.indexOf("compor({ wf: raw");
const iVazou = corpo.indexOf("vazou(final, raw)");
const iPub = corpo.indexOf("publicar({");
t("`validar` roda no texto novo, com `somente` na rodada parcial",
  iValidar > iRodar && /exigidos \? \{ somente: exigidos \} : \{\}/.test(corpo));
t("`vazou` roda no documento COMPOSTO, depois do `compor`", iVazou > iCompor && iCompor > iValidar);
t("...e ANTES do publish — nada vazado chega ao disco", iVazou < iPub);
t("...e o achado do composto NÃO volta para o modelo", /o modelo não tem como[\s\S]{0,80}consertar/.test(corpo));
t("o publish é a última coisa antes do ledger", iPub > iVazou && iPub < corpo.indexOf("await anotar(linha)"));
/* `nosRegenerados` finalmente difere de `nos`, e é o número REAL. */
/* As duas linhas do ledger carregam `modo` E `automatico`. A asserção foi
   FORTALECIDA junto com o campo novo, nunca afrouxada para caber: `dossies.json` é
   o único lugar onde o gasto recorrente desta aba existe, e com a §2.8 flexibilizada
   (decisão explícita do Kauan) uma linha que não diz se foi clique ou automático
   deixa "quanto o automático está me custando" sem resposta. */
t("o ledger grava `modo` e `automatico`", /modo, automatico: !!automatico, rodadas: rodada/.test(corpo));
t("...e `nosRegenerados` vem da montagem, não do pedido",
  /nosRegenerados: monte\.regenerados, nosHerdados: monte\.herdados/.test(corpo));
t("...e a tentativa que falha também grava os dois", /nosRegenerados: 0, modo, automatico: !!automatico, rodadas: custos\.length/.test(corpo));
t("o aborto do publish entra no ledger pelo caminho da falha",
  /if \(!pub\.ok\) \{ recusas = \[pub\.porque\]/.test(corpo));
/* O dossiê antigo vai para a pasta no modo parcial, e o `DOSSIE.md` é o nome que
   o `REGRAS.md` promete. */
t("o dossiê antigo é escrito na pasta como `DOSSIE.md`",
  /"DOSSIE\.md"\), await fsp\.readFile\(caminho\(wfId\)/.test(corpo));
t("o prompt parcial é usado quando há plano",
  /plano \? promptIncremental\(raw, plano\.regenerar, recusas\) : prompt\(raw/.test(corpo));

console.log(bad
  ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
  : "\npassou: " + ok + " casos — herança só de verde/laranja com selo, dois portões, e três travas na ordem");
process.exit(bad ? 1 : 0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
