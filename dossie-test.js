/* dossie-test.js — o dossiê do fluxo (PLAN-UPGRADE.md §2 e §9).
 *
 * Dois grupos de caso, e o segundo é o que decide se este arquivo pode existir
 * num repositório em git:
 *
 * 1. DIVERGÊNCIA. O semáforo é por impressão digital, nunca por data. O caso
 *    load-bearing é o `rewire`: mover uma aresta entre dois nós que já existem
 *    não altera um byte de nenhum nó, e a frase "o X recebe do buffer" fica
 *    falsa com todos os hashes de nó intactos. Um hash só do nó deixa isso
 *    passar — foi o achado da rodada 1 da revisão.
 *
 * 2. NENHUM VALOR DE PARÂMETRO CHEGA AO `.md`. O dossiê descreve o que o trecho
 *    FAZ; o conteúdo dos parâmetros nesta instância é conversa de lead, chave de
 *    sessão montada com telefone, id de planilha. O `.md` é gitignored, mas é
 *    injetado em prompt e mostrado na tela.
 *
 * E o grupo 3 é o oposto: o que o portão NÃO pode reprovar. Cada um daqueles
 * casos rejeitaria um dossiê correto — nome de nó, nome de campo, e a própria
 * frase que o dossiê existe para ter.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhuma escrita. `node dossie-test.js`. */

const d = require("./dossie.js");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}

const no = (name, extra = {}) => ({
  name, type: "n8n-nodes-base.noOp", typeVersion: 1, position: [0, 0], parameters: {}, ...extra
});

/* Um fluxo pequeno com a forma que importa: um trigger, dois ramos e um envio. */
function FLUXO() {
  return {
    id: "wf1", name: "Fluxo de Teste", updatedAt: "2026-08-18T10:00:00.000Z",
    settings: { executionOrder: "v1" },
    nodes: [
      no("Webhook", { type: "n8n-nodes-base.webhook" }),
      no("Buffer"),
      no("Decide", { type: "n8n-nodes-base.if" }),
      no("Manda", { type: "n8n-nodes-base.slack", parameters: { channel: "#comercial", text: "=Chegou {{ $json.nome }}" } }),
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

/* Um dossiê coerente com o fluxo acima, montado pelo próprio `compor` a partir
   das impressões reais — nunca com hashes escritos à mão, que é como um teste de
   cache passa a provar o fixture em vez do código. */
/* Um fluxo com um parâmetro mudado, para o caso laranja — declarado aqui porque
   o bloco 1 precisa dele antes de o bloco 2 existir. */
function wfParamPreview() {
  const w = FLUXO();
  w.nodes.find(n => n.name === "Manda").parameters.text = "=Vendeu {{ $json.produto }}";
  return w;
}

function paragrafosDe(wf, imp, textos) {
  return d.executaveis(wf).map(n => ({
    no: String(n.name), fp: imp.porNo.get(String(n.name)), de: "dossie",
    texto: (textos && textos[n.name]) || "faz uma coisa e passa adiante."
  }));
}

function dossieDe(wf, textos) {
  const imp = d.impressoes(wf);
  return d.parse(d.compor({
    wf, global: imp.global, settingsFp: imp.settingsFp, conexoesFp: imp.conexoesFp, conexoesPorNo: imp.conexoesPorNo,
    paragrafos: paragrafosDe(wf, imp, textos), escritoEm: "2026-08-18T11:00:00.000Z", modelo: "sonnet"
  }));
}

/* O MESMO DOSSIÊ COM CABEÇALHO DE ANTES DO SPLIT — só `fp`, `wfId` e `em`, que é
   a forma exata dos dois dossiês que estão no disco hoje. Ele existe porque um
   teste que só exercitasse o formato novo provaria o código novo e não diria nada
   sobre não invalidar os dois arquivos que custaram US$6,20.
   A âncora é REESCRITA por cima, e não obtida chamando `compor` sem os campos
   novos: `compor` grava `gateV` sempre, e com razão — o selo é propriedade do
   código que escreveu, não do que o chamador passou. Um cabeçalho legado de
   verdade não tem selo nenhum, e é isso que este fixture tem de reproduzir. */
function dossieLegado(wf, textos) {
  const imp = d.impressoes(wf);
  const md = d.compor({
    wf, global: imp.global, settingsFp: imp.settingsFp, conexoesFp: imp.conexoesFp, conexoesPorNo: imp.conexoesPorNo,
    paragrafos: paragrafosDe(wf, imp, textos), escritoEm: "2026-08-18T11:00:00.000Z", modelo: "sonnet"
  });
  const velha = "<!-- GLOBAL " + JSON.stringify({ fp: imp.global, wfId: String(wf.id || ""), em: "2026-08-18T11:00:00.000Z" }) + " -->";
  return d.parse(md.replace(/^<!-- GLOBAL \{.*\} -->$/m, velha));
}

/* ─────────────────────────── 1. o arquivo e sua âncora ─────────────────── */

console.log("\n[ 01 ] o formato do .md, ida e volta");

const wf = FLUXO();
const doc = dossieDe(wf);
t("um parágrafo por nó que executa", doc.paragrafos.length === 5);
t("sticky note NÃO entra — não executa nada", !doc.paragrafos.some(p => p.no === "Post-it"));
t("o cabeçalho carrega a impressão global", doc.global === d.impressoes(wf).global);
t("...e diz que foi escrito por um modelo", /Escrito por um modelo/.test(doc.cabecalho));
t("...e a partir de qual versão do fluxo", /a partir da versão de 2026-08-18T10:00/i.test(doc.cabecalho));
/* O cabeçalho conta os nós que EXECUTAM. `FLUXO()` tem 6 entradas e uma é sticky
   note; dizer 6 prometeria um parágrafo que não existe. */
t("o cabeçalho conta 5 nós, não as 6 entradas com o post-it", /Fluxo: 5 nós/.test(doc.cabecalho));

/* ═══ A VISÃO GERAL TEM DE SOBREVIVER ATÉ O PROMPT ═══
 *
 * Este é o defeito mais caro desta feature, e ele passou por 85 casos sem ser
 * pego: `validar()` extraía a visão geral, `construir` não a passava para
 * `compor`, e `compor` só escrevia os parágrafos por nó. Dois dossiês de verdade
 * foram escritos — US$6,20 — sem a parte que o próprio prompt chama de "a que
 * mais vale", a que diz quais são os TRECHOS do fluxo e em que ordem.
 * A causa da cegueira do teste: `dossieDe()` chamava `compor` sem `visao`, então
 * nenhum caso exercitava o caminho. */
const VISAO = "Recebe lead no webhook, junta mensagens picadas no buffer e responde pelo Slack.";
const impV = d.impressoes(wf);
const comVisao = d.compor({
  wf, global: impV.global, settingsFp: impV.settingsFp, conexoesFp: impV.conexoesFp, conexoesPorNo: impV.conexoesPorNo, visao: VISAO,
  paragrafos: d.executaveis(wf).map(n => ({ no: String(n.name), fp: impV.porNo.get(String(n.name)), de: "dossie", texto: "faz algo." })),
  escritoEm: "2026-08-18T11:00:00.000Z", modelo: "sonnet"
});
t("a visão geral entra no .md", comVisao.includes(VISAO));
t("...sob o título `## visão geral`", /## visão geral/.test(comVisao));
const docV = d.parse(comVisao);
/* Ela vai ANTES da primeira âncora de nó: é isso que a coloca no `cabecalho`, e o
   cabeçalho é o que `paraPrompt` emite. Depois da primeira âncora, ela viraria
   parágrafo de um nó e a sessão nunca a leria como visão do fluxo. */
t("...dentro do cabeçalho, não de um parágrafo de nó", docV.cabecalho.includes(VISAO));
t("...e não vira parágrafo de nó nenhum", !docV.paragrafos.some(p => p.texto.includes(VISAO)));
t("...e os parágrafos por nó continuam íntegros", docV.paragrafos.length === 5);
t("a visão geral CHEGA no prompt", (d.paraPrompt(docV, FLUXO()).texto || "").includes(VISAO));
t("...inclusive quando o dossiê está laranja", (d.paraPrompt(docV, wfParamPreview()).texto || "").includes(VISAO));
t("dossiê sem visão geral não quebra o compor",
  !/## visão geral/.test(d.compor({ wf, global: impV.global, paragrafos: [], escritoEm: "x", modelo: "s" })));

/* Nome de nó pode conter qualquer coisa. A âncora é `JSON.stringify` de um
   objeto por isso: chave composta concatenada à mão já falhou em silêncio duas
   vezes neste repositório. */
const wfNomeFeio = FLUXO();
wfNomeFeio.nodes[1].name = 'Buffer · "15s" | dedup';
wfNomeFeio.connections.Webhook.main[0][0].node = 'Buffer · "15s" | dedup';
wfNomeFeio.connections['Buffer · "15s" | dedup'] = wfNomeFeio.connections.Buffer;
delete wfNomeFeio.connections.Buffer;
const docFeio = dossieDe(wfNomeFeio);
t("nome de nó com `·`, aspas e `|` sobrevive à ida e volta",
  docFeio.paragrafos.some(p => p.no === 'Buffer · "15s" | dedup'));
t("...e o estado dele é verde, não uma divergência inventada",
  d.estado(docFeio, wfNomeFeio).cor === "verde");

/* ─────────────────────────── 2. o semáforo ─────────────────────────────── */

console.log("\n[ 02 ] divergência — e nunca data");

t("cinza quando nunca foi escrito", d.estado(null, wf).cor === "cinza");
/* §2.7: cinza NUNCA é vermelho. Levam a decisões opostas, e este repo pagou a
   lição três vezes. */
t("...e cinza diz que nunca foi escrito, não que está velho", /nunca foi escrito/.test(d.estado(null, wf).motivo));
t("verde quando nada mudou", d.estado(doc, FLUXO()).cor === "verde");

/* Data não decide: o mesmo dossiê contra o mesmo fluxo é verde por mais velho
   que seja o carimbo. */
const wfOutraData = FLUXO(); wfOutraData.updatedAt = "2026-12-31T23:59:59.000Z";
t("fluxo com `updatedAt` novo e nós iguais segue VERDE — o relógio não decide",
  d.estado(doc, wfOutraData).cor === "verde");

const wfParam = FLUXO();
wfParam.nodes[3].parameters.text = "=Vendeu {{ $json.produto }}";
const stParam = d.estado(doc, wfParam);
t("parâmetro mudado em 1 de 5 nós dá LARANJA", stParam.cor === "laranja");
t("...nomeando o nó que mudou", stParam.mudados.join() === "Manda");

/* §2.6: nó adicionado vai DIRETO para vermelho, mesmo com todos os originais
   intactos. "os nós 12–19 são o buffer" fica falso quando entra um no meio. */
const wfMais = FLUXO();
wfMais.nodes.push(no("Loga"));
wfMais.connections.Manda = { main: [[{ node: "Loga", type: "main", index: 0 }]] };
const stMais = d.estado(doc, wfMais);
t("nó ADICIONADO é vermelho, não laranja", stMais.cor === "vermelho");
t("...e diz que o mapa do fluxo mudou", /mapa do fluxo mudou/.test(stMais.motivo));
t("...nomeando quem entrou", stMais.entraram.join() === "Loga");

const wfMenos = FLUXO();
wfMenos.nodes = wfMenos.nodes.filter(n => n.name !== "Grava");
t("nó REMOVIDO é vermelho", d.estado(doc, wfMenos).cor === "vermelho");
t("...nomeando quem saiu", d.estado(doc, wfMenos).sairam.join() === "Grava");

/* 26% é vermelho, 25% ainda é laranja — a fronteira do plano, nos dois lados. */
const mudarN = k => {
  const w = FLUXO();
  ["Webhook", "Buffer", "Decide", "Manda", "Grava"].slice(0, k).forEach(nome => {
    w.nodes.find(n => n.name === nome).parameters = { mexido: k + nome };
  });
  return w;
};
t("1 de 5 (20%) é laranja", d.estado(doc, mudarN(1)).cor === "laranja");
t("...e a fronteira: 2 de 5 (40%) já é vermelho", d.estado(doc, mudarN(2)).cor === "vermelho");
t("...com o percentual escrito no motivo", /40%/.test(d.estado(doc, mudarN(2)).motivo));
t("todos mudados é vermelho", d.estado(doc, mudarN(5)).cor === "vermelho");

/* ───────────── 3. o caso que um hash só do nó deixaria passar ──────────── */

console.log("\n[ 03 ] rewire — topologia muda, nenhum nó muda");

const wfRewire = FLUXO();
/* O `Decide` passa a mandar `Grava` no ramo 0 e `Manda` no 1: os DOIS ramos
   trocados. Nenhum nó teve um byte alterado. */
wfRewire.connections.Decide = { main: [[{ node: "Grava", type: "main", index: 0 }], [{ node: "Manda", type: "main", index: 0 }]] };
const impO = d.impressoes(wf), impR = d.impressoes(wfRewire);
t("o JSON dos nós é IDÊNTICO nos dois fluxos",
  JSON.stringify(wf.nodes) === JSON.stringify(wfRewire.nodes));
t("...e ainda assim a impressão de `Manda` mudou (assinatura de adjacência)",
  impO.porNo.get("Manda") !== impR.porNo.get("Manda"));
t("...e a de `Grava` também", impO.porNo.get("Grava") !== impR.porNo.get("Grava"));
t("...e a global mudou, porque `connections` mudou", impO.global !== impR.global);
/* ═══ O MOTIVO MUDOU; O VEREDITO NESTE FIXTURE, NÃO ═══
 *
 * A versão anterior deste caso assertava "VERMELHO, e pelo motivo global", e o
 * comentário argumentava: global divergente invalida o dossiê INTEIRO, porque
 * contexto de execução diferente reescreve o sentido de todo parágrafo.
 *
 * Metade daquele argumento sobrevive inteira e é o ramo de `settings` logo abaixo:
 * `executionOrder`, fuso e fluxo de erro realmente reenquadram todo parágrafo. A
 * outra metade não: o que uma mudança de `connections` invalida é o MAPA — quais
 * trechos existem e em que ordem — e o mapa é a `## visão geral`, UMA seção. Os
 * parágrafos por nó já estão protegidos pela assinatura de adjacência, que se move
 * em cada ponta da aresta que se moveu. Um hash só para os dois fatos cobrava
 * rewrite inteiro (US$4,14 / 682s no Iago) por uma aresta trocada.
 *
 * NESTE FIXTURE O VEREDITO NÃO MUDA, e é por isso que o caso não foi apagado nem
 * afrouxado: são 5 nós que executam, o rewire move `Manda`, `Grava` (adjacência) e
 * `Decide` (a lista de saída dele) — 3 de 5, 60%, muito acima dos 25%. Segue
 * VERMELHO, agora PELA FATIA e não pelo global, e é isso que a assertiva tem de
 * dizer: se ela só olhasse a cor, o dia em que a fatia parasse de funcionar
 * passaria com o vermelho vindo de outro lugar. O caso pelo qual esta mudança
 * existe é o fluxo grande, no bloco 03b — asserido lá, direto, e não por
 * implicação. */
const stRewire = d.estado(doc, wfRewire);
t("o rewire segue VERMELHO — mas agora pela FATIA, não pelo hash global",
  stRewire.cor === "vermelho" && /3 de 5 nós mudaram \(60%\)/.test(stRewire.motivo));
t("...com as duas pontas da aresta E a origem em `mudados`",
  ["Decide", "Grava", "Manda"].every(n => stRewire.mudados.includes(n)) && stRewire.mudados.length === 3);
t("...e a `## visão geral` marcada como suspeita, porque o mapa mudou", stRewire.visaoSuspeita === true);
t("...e o motivo diz isso em palavras, não só no campo", /visão geral/.test(stRewire.motivo));
/* O ramo genérico "as conexões OU os settings" some daqui: a medição sabe qual dos
   dois foi, e mandar quem lê procurar nos dois lugares é desperdiçar o que se
   mediu. Ele continua existindo — só para cabeçalho legado, no bloco 03c. */
t("...e o motivo NÃO é mais o genérico dos dois fatos juntos",
  !/conexões ou os settings/.test(stRewire.motivo));

/* Um `settings` diferente muda o comportamento de todo parágrafo sem tocar nó.
   Esta é a metade da alegação original que o split PRESERVA em vez de negar. */
const wfSettings = FLUXO(); wfSettings.settings = { executionOrder: "v0", timezone: "UTC" };
t("mudar `settings` invalida o dossiê inteiro", d.estado(doc, wfSettings).global === true);
t("...e segue VERMELHO", d.estado(doc, wfSettings).cor === "vermelho");
/* O motivo NOMEIA `settings`, e isso é o que separa este ramo do de conexões: as
   duas divergências pedem coisas diferentes de quem lê, e um motivo que serve para
   as duas não serve para nenhuma. */
t("...nomeando `settings`, não as conexões", /settings/.test(d.estado(doc, wfSettings).motivo));
t("...e a impressão de `settings` é um hash SÓ dele", d.impressoes(wf).settingsFp !== d.impressoes(wfSettings).settingsFp);
t("...que não se move quando só as conexões mudam",
  d.impressoes(wf).settingsFp === d.impressoes(wfRewire).settingsFp);

/* E o que NÃO pode invalidar: arrastar o nó no editor. */
const wfMovido = FLUXO(); wfMovido.nodes[1].position = [9999, -4321];
t("mover um nó no editor NÃO invalida nada — posição é layout", d.estado(doc, wfMovido).cor === "verde");
const wfCred = FLUXO(); wfCred.nodes[3].credentials = { slackApi: { id: "9", name: "Slack" } };
t("anexar credencial NÃO invalida — não é o que o dossiê descreve", d.estado(doc, wfCred).cor === "verde");
/* Ordem de chave dentro do parâmetro é a mesma configuração escrita diferente. */
const wfOrdem = FLUXO();
wfOrdem.nodes[3].parameters = { text: "=Chegou {{ $json.nome }}", channel: "#comercial" };
t("a mesma config em outra ordem de chave NÃO invalida", d.estado(doc, wfOrdem).cor === "verde");

/* ═══ NENHUMA IMPRESSÃO DE NÓ SE MOVEU COM O SPLIT ═══
 *
 * Hash conhecido, fixado à mão, e é o único lugar deste arquivo onde isso é
 * correto: em todo o resto, hash escrito à mão faria o teste provar o fixture em
 * vez do código. Aqui é o contrário — o que se prova é que o CÓDIGO NOVO produz o
 * mesmo número que o velho produzia, e para isso o número tem de vir de fora do
 * código novo. Ele foi lido da versão anterior de `dossie.js`, antes da primeira
 * linha do split.
 *
 * O que está em jogo: os dois dossiês no disco (`Agente eContrate` 103 nós,
 * `Agente Iago Comercial` 179) carregam essas impressões nas âncoras `<!-- NO -->`.
 * Mover uma delas invalidaria os dois de uma vez e cobraria ~US$6,20 para
 * reescrevê-los — que é exatamente o motivo pelo qual o mapa de conexões foi para
 * o cabeçalho em vez de entrar na tupla de `adjacencias()`. */
const FP_ANTES = {
  global: "6126ecf1ce3d81f1",
  Webhook: "9a467df7a14874ab", Buffer: "513280d95d45c63a", Decide: "dc5a104186ea7b7c",
  Manda: "b5cdfa4200e589bf", Grava: "e1a2935b88f4619f"
};
const impFix = d.impressoes(FLUXO());
t("a impressão GLOBAL não se moveu com o split", impFix.global === FP_ANTES.global);
t("...e nenhuma das 5 impressões por nó se moveu tampouco",
  ["Webhook", "Buffer", "Decide", "Manda", "Grava"].every(n => impFix.porNo.get(n) === FP_ANTES[n]));

/* ─────── 03b. o caso pelo qual o split existe: o mesmo rewire, num fluxo
   do tamanho do Iago ─────── */

console.log("\n[ 03b ] 179 nós — onde a aresta trocada deixa de custar US$4,14");

const nm = i => "N" + String(i).padStart(3, "0");
/* 179 nós que executam, encadeados, com UM nó de dois ramos no meio — que é onde
   moram tanto o rewire quanto a reordenação de irmãos. O número 179 não é
   decorativo: é o `Agente Iago Comercial` medido, US$4,14 e 682s para reescrever
   inteiro, e é contra esse preço que a fatia de 2% tem de sair laranja. */
function GRANDE(umRamo) {
  const nodes = [], connections = {};
  for (let i = 1; i <= 179; i++) nodes.push(no(nm(i)));
  for (let i = 1; i <= 178; i++) connections[nm(i)] = { main: [[{ node: nm(i + 1), type: "main", index: 0 }]] };
  const a = { node: nm(101), type: "main", index: 0 }, b = { node: nm(150), type: "main", index: 0 };
  connections[nm(100)] = umRamo ? { main: [[a, b]] } : { main: [[a], [b]] };
  return { id: "wfG", name: "Fluxo Grande", updatedAt: "2026-08-18T10:00:00.000Z", settings: { executionOrder: "v1" }, nodes, connections };
}

const grande = GRANDE();
const docG = dossieDe(grande);
t("o fluxo grande tem 179 nós que executam", d.executaveis(grande).length === 179);
t("...e o dossiê dele nasce verde", d.estado(docG, GRANDE()).cor === "verde");

const gRewire = GRANDE();
gRewire.connections[nm(100)] = { main: [[{ node: nm(150), type: "main", index: 0 }], [{ node: nm(101), type: "main", index: 0 }]] };
const stG = d.estado(docG, gRewire);
/* O MESMO rewire do bloco 03, na mesma forma: os dois ramos trocados. Em 5 nós ele
   é 60% e vermelho; em 179 ele é 3 nós — a origem e as duas pontas — e 2%. Este é
   o caso pelo qual esta mudança existe, e assertá-lo só por implicação a partir do
   fixture pequeno seria não assertar nada. */
t("o MESMO rewire em 179 nós é LARANJA", stG.cor === "laranja");
t("...mexendo em 3 nós: a origem e as duas pontas da aresta",
  stG.mudados.length === 3 && [nm(100), nm(101), nm(150)].every(n => stG.mudados.includes(n)));
t("...com a visão geral suspeita, porque o mapa mudou mesmo assim", stG.visaoSuspeita === true);
/* E laranja é ENTREGUE. Sem esta linha, "virou laranja" seria mudança de cor na
   tela; o que importa é que a sessão passa a receber o dossiê em vez de cair no
   `nodes-index.md`, que é onde os US$4,14 estavam. */
t("...e o dossiê laranja É ENTREGUE à sessão, com os 3 parágrafos marcados",
  d.paraPrompt(docG, gRewire).usa === true);
t("...o global deste fluxo mudou de qualquer forma — e não é mais ele que decide",
  d.impressoes(grande).global !== d.impressoes(gRewire).global);

/* ─────── 03c. a reordenação de irmãos: o contraexemplo da rodada 1 ─────── */

console.log("\n[ 03c ] reordenar irmãos no MESMO ramo — o buraco que a revisão achou");

/* A alegação da rodada 0 era "toda mudança de `connections` move a assinatura de
   pelo menos um nó". É FALSA, e foi verificada em código antes de ser aceita:
   `adjacencias()` ORDENA as tuplas, e esse `sort` apaga a ordem dos irmãos dentro
   do ramo. Com a regra de "cor pela fatia normal", este fluxo sairia VERDE com
   `mudados` vazio — um fluxo reordenado lido como "nada divergiu", pior que a
   invalidação inteira que o split veio melhorar.
   O parágrafo que fica velho é o DA ORIGEM: o contrato do dossiê permite a frase
   "manda para o Slack e depois grava", e é justamente a ordem que mudou. */
const wfUm = FLUXO();
wfUm.connections.Decide = { main: [[{ node: "Manda", type: "main", index: 0 }, { node: "Grava", type: "main", index: 0 }]] };
const docUm = dossieDe(wfUm);
const wfOrd = FLUXO();
wfOrd.connections.Decide = { main: [[{ node: "Grava", type: "main", index: 0 }, { node: "Manda", type: "main", index: 0 }]] };
const impUm = d.impressoes(wfUm), impOrd = d.impressoes(wfOrd);
t("o JSON dos nós é idêntico", JSON.stringify(wfUm.nodes) === JSON.stringify(wfOrd.nodes));
t("a global se move", impUm.global !== impOrd.global);
t("...e NENHUMA impressão de nó se move — o `sort` apaga a ordem dos irmãos",
  [...impUm.porNo].every(([k, v]) => impOrd.porNo.get(k) === v));
t("...mas a impressão de CONEXÃO da origem se move, e é ela que localiza",
  impUm.conexoesPorNo.get("Decide") !== impOrd.conexoesPorNo.get("Decide"));
t("...sem mover a de mais ninguém",
  impUm.conexoesPorNo.get("Webhook") === impOrd.conexoesPorNo.get("Webhook") &&
  impUm.conexoesPorNo.get("Buffer") === impOrd.conexoesPorNo.get("Buffer"));
const stOrd = d.estado(docUm, wfOrd);
t("a origem `Decide` entra em `mudados` pelo caminho normal", stOrd.mudados.join() === "Decide");
t("...a visão geral fica suspeita", stOrd.visaoSuspeita === true);
/* O PISO. Este é o caso que a cor sozinha erraria: 1 de 5 é 20%, abaixo dos 25%,
   e sem o piso a resposta seria verde. */
t("...e NÃO PODE SAIR VERDE — o piso é laranja", stOrd.cor !== "verde" && stOrd.cor === "laranja");
/* ═══════ A POLÍTICA SOBRE RAMO VAZIO, ASSERTADA COMO POLÍTICA ═══════
 *
 * A rodada 4 da revisão cobrou exatamente isto, e a cobrança é justa: a primeira
 * versão destas linhas mediu que ramos vazios EXISTEM (7 de 91 e 4 de 161 origens
 * sem destino nos dois fluxos reais) e concluiu que MUDAR um é irrelevante. Uma
 * coisa não prova a outra. Então a política é declarada, e o argumento é MECÂNICO
 * antes de estatístico:
 *
 *   `connections[nó][porta]` é indexado pela saída do nó, e a posição de cada
 *   aresta REAL viaja explícita como `iRamo` dentro da tupla. Um ramo vazio DEPOIS
 *   da última aresta real não muda o `iRamo` de aresta nenhuma. Não existe leitura
 *   em que `[[{B}], []]` faça algo diferente de `[[{B}]]` — logo ramo sem destino
 *   não instrui nada, logo mudá-lo não pode ser a diferença entre um dossiê em dia
 *   e um dossiê velho. Mesma calibração do `"options": {}` inaplicável no portão de
 *   esquema: achado correto e inconsequente é ruído, e ruído ensina a ignorar o
 *   portão.
 *
 * A medição SUSTENTA a política em vez de fundá-la, e o número que importa é outro:
 * dos 12 ramos vazios dos dois fluxos reais, TODOS os 12 são finais — nenhum no
 * meio — e nenhuma porta tem valor que não seja array.
 *
 * O CONTRAEXEMPLO DA RODADA 4 é o primeiro par abaixo, nos dois sentidos, e ele é
 * verde POR DECISÃO: o `fp` cru se move (a asserção o comprova) e as duas contas
 * normalizadas não. Antes desta rodada ele era verde por acidente, o que é a mesma
 * cor e um teste completamente diferente. */
const wfRamoVazio = FLUXO();
wfRamoVazio.connections.Webhook.main.push([]);
t("ACRESCENTAR ramo vazio no fim é VERDE — por política: não muda o `iRamo` de ninguém",
  d.estado(doc, wfRamoVazio).cor === "verde");
t("...e a prova de que não é acidente: o `fp` CRU se move, e mesmo assim é verde",
  d.impressoes(wf).global !== d.impressoes(wfRamoVazio).global);
t("...enquanto o agregado NORMALIZADO não se move — é ele que decide",
  d.impressoes(wf).conexoesFp === d.impressoes(wfRamoVazio).conexoesFp);
/* O outro sentido, que é o que acontece de verdade: o editor deixa o ramo vazio
   para trás, alguém limpa, e o dossiê não pode virar vermelho por causa disso. */
t("REMOVER ramo vazio do fim também é VERDE", d.estado(dossieDe(wfRamoVazio), FLUXO()).cor === "verde");

/* O QUE A POLÍTICA **NÃO** COLAPSA, e é a metade que a torna defensável: ramo vazio
   no MEIO empurra o `iRamo` das arestas seguintes, ou seja muda de qual saída do nó
   a aresta pendura. Isso é estrutura, não resíduo, e tem de divergir. Sem esta
   linha, "colapsa vazio" seria indistinguível de "ignora o ramo", e aí `[[{B}]]` e
   `[[], [{B}]]` — duas saídas diferentes — leriam igual. */
const wfMeio = FLUXO();
wfMeio.connections.Webhook = { main: [[], [{ node: "Buffer", type: "main", index: 0 }]] };
t("ramo vazio no MEIO NÃO colapsa — ele muda a saída de quem vem depois",
  d.estado(doc, wfMeio).cor !== "verde");
t("...e é localizável: a origem entra em `mudados`", d.estado(doc, wfMeio).mudados.includes("Webhook"));
t("...movendo o agregado normalizado junto, porque `iRamo` está dentro dele",
  d.impressoes(wf).conexoesFp !== d.impressoes(wfMeio).conexoesFp);

/* Porta inteira sem aresta, e porta ausente: mesma política, mesma cor. */
const wfVazio = FLUXO();
wfVazio.connections.Manda = { main: [] };
t("`{main: []}` numa origem sem aresta NÃO invalida nada", d.estado(doc, wfVazio).cor === "verde");
const wfVazio2 = FLUXO(); wfVazio2.connections.Grava = {};
t("`{}` numa origem sem aresta também não", d.estado(doc, wfVazio2).cor === "verde");
/* `null` é ausência, não forma: colapsa igual a `[]`. Medido: não existe nos dois
   fluxos reais, e é tratado porque um `.md` ou um payload malformado chega. */
const wfNulo = FLUXO(); wfNulo.connections.Manda = { main: null };
t("porta com valor `null` é ausência, não estrutura", d.estado(doc, wfNulo).cor === "verde");
/* E o `type` da conexão é redundante com a porta; o editor o reescreve sozinho. AS
   DUAS contas têm de ignorá-lo: se só uma ignorasse, elas discordariam num fluxo em
   que o editor o omitiu, e a rede simétrica devolveria vermelho por nada. */
const wfTipo = FLUXO();
wfTipo.connections.Webhook = { main: [[{ node: "Buffer", index: 0 }]] };
t("o `type` redundante da conexão não entra na conta", d.estado(doc, wfTipo).cor === "verde");

const gOrd = GRANDE(true), gOrd2 = GRANDE(true);
gOrd2.connections[nm(100)] = { main: [[{ node: nm(150), type: "main", index: 0 }, { node: nm(101), type: "main", index: 0 }]] };
const stGOrd = d.estado(dossieDe(gOrd), gOrd2);
t("a mesma reordenação em 179 nós é laranja com UM nó só na lista",
  stGOrd.cor === "laranja" && stGOrd.mudados.join() === nm(100) && stGOrd.visaoSuspeita === true);

/* ─────── 03d. cabeçalho legado: os dois dossiês que já estão no disco ─────── */

console.log("\n[ 03d ] cabeçalho de antes do split — e por que ele não pode nascer vermelho");

const docLeg = dossieLegado(wf);
t("o cabeçalho legado não tem `settingsFp`", docLeg.settingsFp === null);
t("...nem `conexoesPorNo`", docLeg.conexoesPorNo === null);
t("...nem `gateV`", docLeg.gateV === null);
t("...mas tem o `fp` de sempre", docLeg.global === impFix.global);
/* O QUE MAIS IMPORTA NESTE BLOCO: nada divergiu, então segue VERDE. Se o ramo
   legado comparasse errado, os dois dossiês do disco nasceriam vermelhos no deploy
   — e vermelho hoje TRAVA A CONVERSA da aba de upgrade, então seria uma feature de
   economia que começa desligando a aba. */
t("fluxo inalterado com cabeçalho legado segue VERDE", d.estado(docLeg, FLUXO()).cor === "verde");
t("...e um parâmetro mudado nele continua dando laranja pelo caminho por nó",
  d.estado(docLeg, wfParam).cor === "laranja");
/* Divergente, ele não sabe QUAL dos dois fatos se moveu, então a resposta honesta é
   a de antes: vermelho inteiro, com o motivo genérico. E vermelho recusa herança,
   então a única migração de um cabeçalho legado divergente é o rewrite inteiro —
   que reescreve o cabeçalho com os campos novos. */
const stLegR = d.estado(docLeg, wfRewire);
t("cabeçalho legado + rewire = VERMELHO, como antes", stLegR.cor === "vermelho");
t("...pelo motivo genérico dos dois fatos juntos", /conexões ou os settings/.test(stLegR.motivo));
t("...e `visaoSuspeita` é FALSA ali — ele não mediu qual dos dois foi",
  stLegR.visaoSuspeita === false);
t("cabeçalho legado + settings mudado = VERMELHO", d.estado(docLeg, wfSettings).cor === "vermelho");
/* MEIO CABEÇALHO É CABEÇALHO LEGADO, e o teste da porta é `||`, não `&&`. Um `.md`
   editado à mão ou truncado no meio da escrita pode ter `settingsFp` e não ter o
   mapa; com `&&` ele entraria no caminho novo, onde `conexoesPorNo` nulo faz o
   `Object.keys` de nada e a comparação por chave simplesmente não acontece — ou
   seja, o caminho novo rodaria CEGO para conexões e responderia verde. Fail-closed:
   falta um dos dois, é legado, e legado sabe responder com o que tem. */
const docMeio = dossieDe(wf);
docMeio.conexoesPorNo = null;
t("cabeçalho com metade dos campos novos é tratado como LEGADO — fluxo igual, verde",
  d.estado(docMeio, FLUXO()).cor === "verde");
t("...e, como legado, um rewire nele é vermelho pelo motivo genérico",
  /conexões ou os settings/.test(d.estado(docMeio, wfRewire).motivo));
/* OS TRÊS CAMPOS, um caso por campo, e este terceiro é o que a rodada 4 tornou
   necessário. Um cabeçalho com o mapa por chave e SEM o agregado é um cabeçalho sem
   a rede — e como a rede é simétrica, deixá-lo entrar no caminho novo faria o
   agregado ausente discordar do mapa e devolver VERMELHO num fluxo em que nada
   mudou. Legado sabe responder com o que tem; meio caminho não sabe responder nada.
   Não existe nenhum em produção: os dois `.md` no disco são legados nos três. */
const docSemAgregado = dossieDe(wf);
docSemAgregado.conexoesFp = null;
t("cabeçalho com o mapa e SEM o agregado é LEGADO — e um fluxo igual segue verde",
  d.estado(docSemAgregado, FLUXO()).cor === "verde");
t("...e não vermelho por discordância de uma rede que ele não tem",
  !/discordaram/.test(d.estado(docSemAgregado, FLUXO()).motivo));
const docSemSettings = dossieDe(wf);
docSemSettings.settingsFp = null;
t("cabeçalho sem `settingsFp` também é LEGADO — fluxo igual, verde",
  d.estado(docSemSettings, FLUXO()).cor === "verde");

/* ─────── 03e. fail-closed: divergência que não dá para localizar ─────── */

console.log("\n[ 03e ] o ramo que não deveria ser alcançável — e por isso é tratado");

/* Uma chave de conexão que divergiu e cuja origem NÃO é um nó descrito e existente
   (aqui, um sticky note). Não dá para pôr num `mudados` que não tem parágrafo, e
   divergência que não dá para localizar é divergência que não dá para remendar.
   Vermelho: é "se não der para identificar com prova, rewrite inteiro" ao pé da
   letra. Note que o agregado CONCORDA neste caso — o fail-closed não depende dele. */
const docSemDono = dossieDe(wf);
docSemDono.conexoesPorNo = { ...docSemDono.conexoesPorNo, "Post-it": "aaaaaaaaaaaa" };
const stSemDono = d.estado(docSemDono, FLUXO());
t("chave de conexão divergente sem nó dono é VERMELHO", stSemDono.cor === "vermelho");
t("...e não laranja nem verde", stSemDono.cor !== "laranja" && stSemDono.cor !== "verde");
t("...dizendo que não deu para localizar", /não deu para dizer em qual nó/.test(stSemDono.motivo));

/* ═══ QUEM É A REDE: O AGREGADO NORMALIZADO, NÃO O `fp` CRU ═══
 *
 * A primeira versão deste passo REMOVEU o segundo ramo fail-closed do desenho, com
 * o argumento de que o agregado só sobraria divergindo por ruído medido (7 de 91 e
 * 4 de 161 origens de `connections` sem destino nos dois fluxos reais). A rodada 4
 * da revisão recusou, e recusou certo: aquela medição derruba o agregado COMO
 * ESTAVA CALCULADO — sobre `canon(wf.connections)` cru, que vive num espaço
 * semântico mais largo que o localizador por chave — e não o ramo. Remover o ramo
 * inteiro foi overcorrection, e o sinal disso é o caso logo abaixo: com a rede
 * fora, o `fp` do cabeçalho novo virou WRITE-ONLY e nada mais decidia por
 * `connections` além do mapa por chave.
 *
 * Então há dois hashes de conexão e eles têm papéis diferentes, o que estas linhas
 * fixam nos dois sentidos: o `fp` CRU não decide (ele carrega o ruído), e o
 * AGREGADO NORMALIZADO decide (mesma semântica do mapa, caminhada independente). */
const docFpTorto = dossieDe(wf);
docFpTorto.global = "0000000000000000";
const stFpTorto = d.estado(docFpTorto, FLUXO());
t("o `fp` CRU divergente sozinho não decide no cabeçalho novo — ele carrega ruído de ramo vazio",
  stFpTorto.cor === "verde");
t("...e o campo `global` continua REPORTANDO o fato, mesmo sem decidir", stFpTorto.global === undefined || stFpTorto.global === false);

/* O CONTRÁRIO, e é este caso que prova que a rede voltou: o agregado NORMALIZADO
   adulterado sozinho é vermelho. Sem esta linha, `conexoesFp` teria repetido o
   destino do `fp` — gravado no cabeçalho e lido por ninguém, que é exatamente o
   sintoma pelo qual a rodada 4 identificou o que se havia perdido. */
const docAgTorto = dossieDe(wf);
docAgTorto.conexoesFp = "0000000000000000";
const stAgTorto = d.estado(docAgTorto, FLUXO());
t("o AGREGADO NORMALIZADO adulterado sozinho é VERMELHO — ou seja, ele é LIDO",
  stAgTorto.cor === "vermelho");
/* E a frase diz de quem é o defeito. As duas contas leem o mesmo documento com a
   mesma semântica, então discordância é bug do cockpit — mandar quem lê procurar a
   divergência no editor do n8n seria o pior diagnóstico disponível aqui. */
t("...com o motivo dizendo que o defeito é NOSSO, não do fluxo",
  /defeito nosso/.test(stAgTorto.motivo) && /discordaram/.test(stAgTorto.motivo));
t("...e a visão marcada suspeita, porque o mapa deixou de ser confiável", stAgTorto.visaoSuspeita === true);
/* A rede é SIMÉTRICA, e a segunda metade não é enfeite: uma chave divergir sem o
   agregado se mover é um agregado cego, e agregado cego é rede que não existe. Aqui
   o fluxo muda de verdade (reordenação de irmãos) e o cabeçalho é remendado para
   manter o agregado antigo — a forma exata de "o agregado não viu". */
const wfSib1 = FLUXO();
wfSib1.connections.Decide = { main: [[{ node: "Manda", type: "main", index: 0 }, { node: "Grava", type: "main", index: 0 }]] };
const wfSib2 = FLUXO();
wfSib2.connections.Decide = { main: [[{ node: "Grava", type: "main", index: 0 }, { node: "Manda", type: "main", index: 0 }]] };
const docCego = dossieDe(wfSib1);
docCego.conexoesFp = d.impressoes(wfSib2).conexoesFp;
t("chave divergente com o agregado PARADO também é VERMELHO — as duas contas têm de concordar",
  d.estado(docCego, wfSib2).cor === "vermelho");
/* No cabeçalho legado é o contrário, e tem de continuar sendo: lá `fp` é tudo o que
   existe, então ele decide. Um `fp` que não bate é vermelho. */
const docLegTorto = dossieLegado(wf);
docLegTorto.global = "0000000000000000";
t("...enquanto no cabeçalho LEGADO um `fp` que não bate segue sendo vermelho",
  d.estado(docLegTorto, FLUXO()).cor === "vermelho");

/* A QUINTA POSIÇÃO DA TUPLA: a rede de verdade, no lugar certo. Medido, hoje nenhuma
   aresta dos dois fluxos reais carrega chave além de `node`/`type`/`index`. O dia em
   que o n8n acrescentar um fato à aresta, ele move a impressão de conexão em vez de
   entrar no fluxo em silêncio. Sem isto, a rede seria o agregado — e o agregado é
   ruído medido. */
const wfExtra = FLUXO();
wfExtra.connections.Webhook = { main: [[{ node: "Buffer", type: "main", index: 0, condicaoFutura: "x > 3" }]] };
t("chave desconhecida na aresta MOVE a impressão de conexão da origem",
  d.impressoes(wf).conexoesPorNo.get("Webhook") !== d.impressoes(wfExtra).conexoesPorNo.get("Webhook"));
t("...sem mover a impressão de nó de ninguém — `porNo` fica congelado",
  [...d.impressoes(wf).porNo].every(([k, v]) => d.impressoes(wfExtra).porNo.get(k) === v));
t("...e o dossiê não sai verde por causa dela", d.estado(doc, wfExtra).cor !== "verde");

/* ─────── 03f. o selo do portão, e o cabeçalho que não vai para o prompt ─────── */

console.log("\n[ 03f ] o selo `gateV`, e os 5,5KB que não entram no prompt");

t("`compor` grava o selo do portão de vazamento", doc.gateV === d.GATE_V);
t("...e ele é um inteiro que começa em 1", Number.isInteger(d.GATE_V) && d.GATE_V >= 1);
/* Selo corrompido lê como AUSENTE, nunca como uma versão qualquer: quem vai usar
   isto (o modo incremental) recusa herdar de portão desconhecido, e um `gateV` que
   virasse `NaN` ou string passaria por uma comparação numérica sem reclamar. */
t("selo que não é inteiro lê como ausente",
  d.parse('<!-- GLOBAL {"fp":"a","gateV":"tres"} -->\n').gateV === null);
t("`conexoesPorNo` que não é objeto lê como ausente",
  d.parse('<!-- GLOBAL {"fp":"a","conexoesPorNo":["x"]} -->\n').conexoesPorNo === null);

/* O mapa por chave engorda o cabeçalho — medido no Iago real, 161 chaves e ~5,5KB
   — e `cabecalho` é o que `paraPrompt` emite. Herdar isso seria ~11% mais token de
   entrada por rodada da aba de upgrade em troca de nada: a âncora é metadado de
   máquina e nenhuma decisão da sessão depende dela. */
const promptG = d.paraPrompt(docG, GRANDE()).texto || "";
t("a âncora GLOBAL não entra no prompt", !/<!-- GLOBAL/.test(promptG));
t("...nem o hash de conexão de nenhum nó",
  !promptG.includes(d.impressoes(grande).conexoesPorNo.get(nm(100))));
/* E as duas etiquetas obrigatórias continuam inteiras: são prosa, não âncora. */
t("...e a etiqueta «escrito por um modelo» sobrevive", /Escrito por um modelo/.test(promptG));
t("...e a etiqueta da versão do fluxo também", /a partir da versão de/i.test(promptG));

/* ──────────── 4. o portão: nenhum valor de parâmetro no .md ────────────── */

console.log("\n[ 04 ] valor de parâmetro nunca chega ao .md");

const REAL = {
  id: "wf2", name: "Iago", updatedAt: "2026-08-18T10:00:00.000Z", settings: {},
  nodes: [
    no("normaliza_telefone", { parameters: { valor: "+55 41 99999 1395" } }),
    no("memoria", { parameters: { sessionKey: "=memoria:{{ $json.telefone_normalizado }}" } }),
    no("manda_email", { parameters: { to: "kauan.millarch@ecommercepuro.com.br", subject: "Sua vaga na turma 5" } }),
    no("chama_api", { parameters: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghij", url: "https://api.exemplo.com/v1/leads" } }),
    no("grava", { parameters: { tableId: "leads_producao_2026" } })
  ],
  connections: {}
};

const cabeca = "# Dossiê\n\n## visão geral\nRecebe lead e responde.\n";
const secao = (n, txt) => "\n## no: " + n + "\n" + txt + "\n";
/* Existe um piso de 200 caracteres contra arquivo vazio, e ele não é o que os
   casos de vazamento testam — seções de enchimento realistas mantêm o piso fora
   do caminho, senão o teste passaria a medir o piso em vez do portão. */
const ENCHE = "recebe do nó anterior, aplica a regra dele e passa adiante sem decidir nada.";
const mdBase = cabeca
  + secao("normaliza_telefone", "normaliza o telefone que chegou no corpo da mensagem.")
  + secao("memoria", "monta a chave de sessão a partir do telefone normalizado, para não misturar conversas.")
  + secao("manda_email", "manda o e-mail de confirmação para o contato.")
  + secao("chama_api", "chama a API de leads com o token da conta.")
  + secao("grava", "grava a linha na tabela de leads.");

t("um dossiê que só DESCREVE passa", d.validar(mdBase, REAL, d.impressoes(REAL)).ok);
t("...e o portão de vazamento não acha nada nele", d.vazou(mdBase, REAL).length === 0);

const vaza = (txt, oque) => {
  const md = cabeca + secao("normaliza_telefone", txt)
    + secao("memoria", "x.") + secao("manda_email", "x.") + secao("chama_api", "x.") + secao("grava", "x.");
  const v = d.validar(md, REAL, d.impressoes(REAL));
  t(oque + " REPROVA a rodada", !v.ok && v.erros.some(e => /VAZOU/.test(e)));
};
vaza('escreve `+55 41 99999 1395` no campo.', "telefone literal");
vaza("manda para kauan.millarch@ecommercepuro.com.br.", "e-mail literal");
vaza("usa o token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghij.", "token JWT");
vaza("monta `=memoria:{{ $json.telefone_normalizado }}`.", "expressão literal copiada do parâmetro");

/* O risco de verdade, e a razão de o corte ser "espaço + 15": corpo de mensagem,
   prompt de sistema e código de `Code` node. Medido nos dois fluxos, 185 e 104
   valores caem nesta faixa e são exatamente isso. */
const REAL_MSG = JSON.parse(JSON.stringify(REAL));
REAL_MSG.nodes[2].parameters = { texto: "Oi! Vi que você se inscreveu na turma 5, quer que eu te mande o link?" };
const mdMsg = cabeca + secao("normaliza_telefone", ENCHE)
  + secao("memoria", ENCHE)
  + secao("manda_email", 'manda "Oi! Vi que você se inscreveu na turma 5, quer que eu te mande o link?" para o contato.')
  + secao("chama_api", ENCHE) + secao("grava", ENCHE);
t("corpo de mensagem colado literal REPROVA", !d.validar(mdMsg, REAL_MSG, d.impressoes(REAL_MSG)).ok);

const REAL_CODE = JSON.parse(JSON.stringify(REAL));
REAL_CODE.nodes[0].parameters = { jsCode: "const mensagens = $json.todas_mensagens;\nconst i = $json.index_atual || 0;" };
const mdCode = cabeca + secao("normaliza_telefone", "roda `const mensagens = $json.todas_mensagens;\nconst i = $json.index_atual || 0;` para escolher a bolha.")
  + secao("memoria", ENCHE) + secao("manda_email", ENCHE) + secao("chama_api", ENCHE) + secao("grava", ENCHE);
t("código de Code node colado literal REPROVA", !d.validar(mdCode, REAL_CODE, d.impressoes(REAL_CODE)).ok);

/* O portão nomeia o que achou: uma recusa que não diz o trecho manda o modelo
   adivinhar, e a rodada seguinte custa o mesmo. */
const mdTel = cabeca + secao("normaliza_telefone", 'escreve `+55 41 99999 1395`.')
  + secao("memoria", "x.") + secao("manda_email", "x.") + secao("chama_api", "x.") + secao("grava", "x.");
const errTel = d.validar(mdTel, REAL, d.impressoes(REAL)).erros.find(e => /VAZOU/.test(e));
t("a recusa NOMEIA o tipo do que vazou", /telefone|valor de parâmetro/.test(errTel));
t("...e cita o trecho, para o modelo saber qual frase apagar", /99999/.test(errTel));
t("...e ensina o que fazer: descrever, não copiar", /descreva o que o parâmetro faz/.test(errTel));

/* ─────── 5. o que o portão NÃO pode reprovar (senão rejeita o certo) ───── */

console.log("\n[ 05 ] o que NÃO pode ser reprovado");

const passa = (txt, oque) => {
  const md = cabeca + secao("normaliza_telefone", txt)
    + secao("memoria", "x.") + secao("manda_email", "x.") + secao("chama_api", "x.") + secao("grava", "x.");
  t(oque, d.validar(md, REAL, d.impressoes(REAL)).ok);
};
/* A frase que o dossiê existe para ter. */
passa("recebe do `normaliza_telefone` e passa para a `memoria`.", "citar nome de nó passa");
passa("lê o campo `telefone_normalizado` e escreve em `sessionKey`.", "citar nome de CAMPO passa — é chave, não valor");
passa("normaliza o telefone antes de montar a chave de sessão.", "descrever dado pessoal sem copiá-lo passa");
passa("é o buffer de 15s que junta mensagens picadas.", "número de comportamento medido passa");
passa("tem `onError: continueRegularOutput`, então falha não derruba o fluxo.", "citar chave de configuração passa");

/* Um valor curto de enum é vocabulário do n8n, não conteúdo. Reprovar por
   `POST` ou `main` tornaria o portão impossível de satisfazer. */
const REAL_CURTO = JSON.parse(JSON.stringify(REAL));
REAL_CURTO.nodes[0].parameters = { method: "POST", operation: "get", mode: "main" };
/* As outras seções são realistas, e não `x.`: existe um piso de 200 caracteres
   contra arquivo vazio, e ele reprovaria antes do portão que ESTE caso testa —
   o teste passaria a medir o piso em vez do enum. */
const mdCurto = cabeca + secao("normaliza_telefone", "faz um POST, operação get, no ramo main.")
  + secao("memoria", "monta a chave de sessão a partir do telefone normalizado.")
  + secao("manda_email", "manda o e-mail de confirmação para o contato.")
  + secao("chama_api", "chama a API de leads com o token da conta.")
  + secao("grava", "grava a linha na tabela de leads.");
const vCurto = d.validar(mdCurto, REAL_CURTO, d.impressoes(REAL_CURTO));
t("valor curto de enum (POST, get, main) não é vazamento", vCurto.ok);
t("...e o portão de vazamento não achou nada", d.vazou(mdCurto, REAL_CURTO).length === 0);

/* ═══ ESPAÇO A MAIS DEPOIS DOS DOIS-PONTOS NÃO PODE CUSTAR UMA RODADA ═══
 *
 * `validar()` lê o mesmo `.md` duas vezes — captura as seções, depois reencontra
 * cada uma pelo nome — e os dois padrões precisavam concordar por coincidência.
 * Não concordavam: a captura saía `.trim()`ada, então `## no:  Nome` com dois
 * espaços contava como parágrafo presente, e a re-varredura, que exigia UM
 * espaço, devolvia `null`. O dossiê inteiro morria em `m.index`.
 *
 * Cada caso abaixo é um dossiê CERTO — o modelo descreveu todos os nós, sem
 * vazar nada — que a divergência recusava por um caractere de espaço. */
const secaoEsp = (sep, n, txt) => "\n## no:" + sep + n + "\n" + txt + "\n";
const comSep = sep => cabeca + secaoEsp(sep, "normaliza_telefone", "normaliza o telefone que chegou.")
  + secao("memoria", "monta a chave de sessão a partir do telefone normalizado.")
  + secao("manda_email", "manda o e-mail de confirmação para o contato.")
  + secao("chama_api", "chama a API de leads com o token da conta.")
  + secao("grava", "grava a linha na tabela de leads.");
const porSep = (sep, oque) => t(oque, d.validar(comSep(sep), REAL, d.impressoes(REAL)).ok);
porSep("  ", "dois espaços depois de `## no:` passam — era o defeito");
porSep("   ", "três espaços passam");
porSep("\t", "tabulação passa — `.trim()` da captura já a aceitava");
porSep("", "sem espaço nenhum passa");
/* Não basta não estourar: o recorte do parágrafo tem de sair íntegro. Uma
   tolerância que casasse o cabeçalho e errasse o `index` gravaria no `.md` um
   parágrafo vazio ou com o próprio cabeçalho dentro — e ninguém veria, porque o
   portão teria dito `ok`. */
const vSep = d.validar(comSep("  "), REAL, d.impressoes(REAL));
t("...e o parágrafo sai recortado igual, sem o cabeçalho dentro",
  vSep.ok && vSep.paragrafos[0].texto === "normaliza o telefone que chegou.");

/* ═══ OS ONZE VALORES QUE BLOQUEARAM OS DOIS DOSSIÊS DE VERDADE ═══
 *
 * A primeira versão do portão cortava por tamanho (8+ caracteres aparecendo
 * literal) e recusou TODOS estes, nas duas tentativas reais — gastou cota e
 * produziu nada. Nenhum é dado de lead: são nome de campo e valor de enum, e em
 * n8n o nome da coluna É valor de parâmetro. Cada linha aqui é um bloqueio que
 * aconteceu; se voltarem a reprovar, o dossiê volta a ser impossível de escrever. */
const DO_CORPUS = ["Mensagem", "cancelado", "esgotado", "botao_cta", "event_leads", "contacted",
  "telefone", "entrou_em_contato", "faturamento", "outbound", "turno_atual",
  /* Medidos no Iago, os dois únicos valores COM espaço abaixo de 15 caracteres:
     nome de aba de planilha e de coluna. */
  "Cupons Lotes", "PREÇO FINAL",
  /* Identificadores longos e opacos que o corpus tem aos montes: id de tabela,
     id de sub-fluxo. Não são segredo e citá-los não vaza conversa de ninguém. */
  "leads_producao_2026", "r2fkFV8WAqXq2AqBpgJT", "combineByPosition"];

const REAL_CORPUS = JSON.parse(JSON.stringify(REAL));
REAL_CORPUS.nodes = DO_CORPUS.map((v, i) => no("n" + i, { parameters: { campo: v } }));
const mdCorpus = "# D\n\n## visão geral\nUm fluxo que usa o vocabulário real da conta.\n"
  + DO_CORPUS.map((v, i) => secao("n" + i, "lê o campo `" + v + "` e decide o próximo passo com base nele.")).join("");
const vCorpus = d.validar(mdCorpus, REAL_CORPUS, d.impressoes(REAL_CORPUS));
t("os " + DO_CORPUS.length + " valores do corpus real NÃO são vazamento", vCorpus.ok);
if (!vCorpus.ok) for (const e of vCorpus.erros.slice(0, 6)) console.log("           " + e);
t("...e nenhum deles conta como conteúdo", DO_CORPUS.every(v => !d.ehConteudo(v)));

/* Uma expressão SEM espaço fica abaixo do corte de 15 por espaço, então o ramo do
   `{{` é o que a pega. Sem este caso, apagar aquele ramo não derrubaria teste
   nenhum — cobertura que faltava, achada rodando os mutantes. */
t("expressão sem espaço nenhum ainda é conteúdo", d.ehConteudo("={{$json.telefone}}"));
const REAL_EXPRC = JSON.parse(JSON.stringify(REAL));
REAL_EXPRC.nodes[1].parameters = { sessionKey: "={{$json.telefone}}" };
const mdExprC = cabeca + secao("normaliza_telefone", ENCHE)
  + secao("memoria", "monta a chave com `={{$json.telefone}}`.")
  + secao("manda_email", ENCHE) + secao("chama_api", ENCHE) + secao("grava", ENCHE);
t("...e colá-la no .md REPROVA", !d.validar(mdExprC, REAL_EXPRC, d.impressoes(REAL_EXPRC)).ok);

/* Sticky note é documentação que o Kauan escreveu à mão, e é de lá que saem os
   nomes dos trechos. Citar o nome do trecho é o melhor que o dossiê pode fazer —
   varrer o conteúdo do post-it como se fosse parâmetro reprovaria exatamente
   isso. A rede contra um telefone digitado num post-it é a varredura de PII, que
   continua valendo em cima do `.md` inteiro. */
const REAL_STICKY = JSON.parse(JSON.stringify(REAL));
/* O conteúdo do post-it É o nome do trecho, palavra por palavra — é assim que os
   fluxos do Kauan são anotados. Com sticky note dentro da varredura, citar o
   trecho seria "vazamento": 21 caracteres, tem espaço, aparece literal. */
const TRECHO = "LOCK + CANCELAR VÁCUO";
REAL_STICKY.nodes.push({ name: "Post-it", type: "n8n-nodes-base.stickyNote", typeVersion: 1,
  position: [0, 0], parameters: { content: TRECHO } });
t("o nome do trecho tem a forma de conteúdo (espaço e 15+)", d.ehConteudo(TRECHO));
const mdSticky = cabeca.replace("Recebe lead e responde.", "Tem um trecho chamado " + TRECHO + " que protege contra mensagem dupla.")
  + secao("normaliza_telefone", ENCHE) + secao("memoria", ENCHE)
  + secao("manda_email", ENCHE) + secao("chama_api", ENCHE) + secao("grava", ENCHE);
t("...e citar o nome do trecho que está num sticky note PASSA",
  d.validar(mdSticky, REAL_STICKY, d.impressoes(REAL_STICKY)).ok);
t("...e um telefone digitado num post-it ainda é pego pela varredura de PII",
  d.vazou("o contato é +55 41 99999 1395.", REAL_STICKY).length > 0);

/* ═══ A IMPRESSÃO DIGITAL NÃO PODE VIRAR TELEFONE ═══
 *
 * MEDIDO nos dois dossiês de verdade: `32fe4d7777030213` é a impressão global do
 * Iago, e ela contém `7777030213` — dez dígitos que a primeira regra de telefone
 * casava. O portão reprovava o `.md` por causa do cabeçalho que ele mesmo
 * gerou. Duas defesas independentes, e este teste cobre as duas. */
const HASHES = ["32fe4d7777030213", "776025788f7a6ef5", "b3b2122932c9137d", "4178420297311111"];
t("hash hexadecimal não é lido como telefone",
  HASHES.every(h => d.vazou("a impressão é " + h + " e nada mais.", REAL).length === 0));
/* A segunda defesa: as âncoras são escritas por código, e o portão só julga o
   que o modelo escreveu. */
t("âncora gerada por código fica fora da varredura",
  d.vazou('<!-- NO {"no":"x","fp":"32fe4d7777030213","de":"dossie"} -->\ndescreve o nó.', REAL).length === 0);
t("...mas um telefone na PROSA, na linha seguinte, ainda é pego",
  d.vazou('<!-- NO {"no":"x"} -->\nmanda para +55 41 99999 1395.', REAL).length > 0);
/* E as formas de telefone que TÊM de continuar sendo pegas, apesar das bordas. */
for (const tel of ["+55 41 99999 1395", "41 99999-1395", "(41) 99999-1395", "41999991395"]) {
  t("telefone na forma `" + tel + "` é pego", d.vazou("o lead é " + tel + ".", REAL).length > 0);
}
/* Um id só de dígitos não é telefone: nenhuma janela de 10-11 dígitos termina em
   borda de palavra dentro de uma corrida maior. */
t("id numérico longo não é lido como telefone",
  d.vazou("a planilha é 1234567890123456 nesta conta.", REAL).length === 0);

/* Um parâmetro cujo valor É o nome de um nó: expressões carregam nome de nó, e o
   dossiê tem direito de citar o nó. Sem esta exceção, todo fluxo com `$('Nome')`
   ficaria impossível de descrever. */
const REAL_EXPR = JSON.parse(JSON.stringify(REAL));
REAL_EXPR.nodes[1].parameters = { de: "normaliza_telefone" };
t("valor de parâmetro que É nome de nó não conta como vazamento",
  !d.valoresDoFluxo(REAL_EXPR).has("normaliza_telefone"));

/* ───────────────── 6. forma: o que reprova antes do conteúdo ──────────── */

console.log("\n[ 06 ] forma do dossiê");

const semVisao = secao("normaliza_telefone", "x.") + secao("memoria", "x.")
  + secao("manda_email", "x.") + secao("chama_api", "x.") + secao("grava", "x.");
t("sem `## visão geral` reprova", !d.validar("# D\n" + semVisao, REAL, d.impressoes(REAL)).ok);
t("...dizendo que é a parte mais útil", /parte mais útil/.test(d.validar("# D\n" + semVisao, REAL, d.impressoes(REAL)).erros.join(" ")));

const inventado = cabeca + secao("nao_existe", "x.");
const vI = d.validar(inventado, REAL, d.impressoes(REAL));
t("nó inventado reprova", !vI.ok);
t("...mandando ler o nodes-index.md", /nodes-index\.md/.test(vI.erros.join(" ")));

const faltando = cabeca + secao("normaliza_telefone", "x.");
const vF = d.validar(faltando, REAL, d.impressoes(REAL));
t("nó sem parágrafo reprova", !vF.ok);
t("...contando quantos e nomeando os primeiros", /4 nó\(s\) sem parágrafo/.test(vF.erros.join(" ")));

const dobrado = mdBase + secao("grava", "de novo.");
t("dois parágrafos para o mesmo nó reprovam", !d.validar(dobrado, REAL, d.impressoes(REAL)).ok);
t("dossiê vazio reprova", !d.validar("", REAL, d.impressoes(REAL)).ok);

/* ═══ NENHUM `null` DE REGEX PODE VIRAR EXCEÇÃO NESTE CAMINHO ═══
 *
 * O que sobra depois da constante compartilhada é o espaço em branco exótico:
 * `.trim()` da captura remove um NBSP, `[ \t]` da re-varredura não o casa. Raro
 * não é nunca — e as duas saídas não custam a mesma coisa. Uma RECUSA volta
 * literal para o modelo, que corrige na rodada 2. Uma EXCEÇÃO sobe por
 * `construir`, mata a rodada inteira já paga, sem mensagem de retry e sem linha
 * no ledger: o gasto recorrente que ninguém vê, que é o risco desta aba. */
const nbsp = cabeca + "\n## no: " + "\u00a0" + "normaliza_telefone\nnormaliza o telefone que chegou.\n"
  + secao("memoria", "monta a chave de sessão a partir do telefone normalizado.")
  + secao("manda_email", "manda o e-mail de confirmação para o contato.")
  + secao("chama_api", "chama a API de leads com o token da conta.")
  + secao("grava", "grava a linha na tabela de leads.");
let vNbsp = null, estourou = null;
try { vNbsp = d.validar(nbsp, REAL, d.impressoes(REAL)); } catch (e) { estourou = String(e && e.message || e); }
t("cabeçalho que a captura aceita e a re-varredura não acha NÃO estoura", estourou === null);
t("...vira recusa, não `ok`", !!vNbsp && vNbsp.ok === false);
t("...que NOMEIA a seção que não foi reencontrada",
  !!vNbsp && /normaliza_telefone/.test((vNbsp.erros || []).join(" ")) && /não foi reencontrada/.test((vNbsp.erros || []).join(" ")));
/* `[ \t]` e não `\s` no cabeçalho compartilhado: `\s` casa `\n`, e aí `## no:`
   numa linha com o nome na seguinte viraria seção válida — o recorte começaria
   uma linha depois do que deveria e o portão diria `ok` em cima de um `.md`
   malformado. Tolerar espaço é o conserto; tolerar quebra de linha é outro bug. */
const quebrado = cabeca + "\n## no:\nnormaliza_telefone\nnormaliza o telefone que chegou.\n"
  + secao("memoria", "monta a chave de sessão a partir do telefone normalizado.")
  + secao("manda_email", "manda o e-mail de confirmação para o contato.")
  + secao("chama_api", "chama a API de leads com o token da conta.")
  + secao("grava", "grava a linha na tabela de leads.");
t("`## no:` sozinho na linha não engole o nome da linha de baixo",
  !d.validar(quebrado, REAL, d.impressoes(REAL)).ok);

/* Estático, e é o que impede a divergência de voltar: o dia em que alguém
   afrouxar um dos dois padrões e não o outro, o cabeçalho aparece duas vezes no
   fonte de novo — que é a forma exata do defeito. */
const fonteD = require("fs").readFileSync(require("path").join(__dirname, "dossie.js"), "utf8");
t("captura e re-varredura saem da MESMA constante",
  (fonteD.match(/\^## no:/g) || []).length === 1
  && /new RegExp\(CAB_NO \+ "\(\.\+\)\$"/.test(fonteD)
  && /new RegExp\(CAB_NO \+ escRe\(/.test(fonteD));

/* A impressão gravada é a do nó, não a do texto: é isso que faz o cache ser por
   nó e o dossiê sobreviver a um fluxo editado num canto. */
const vOk = d.validar(mdBase, REAL, d.impressoes(REAL));
t("o parágrafo aprovado carrega a impressão do nó",
  vOk.paragrafos.every(p => p.fp === d.impressoes(REAL).porNo.get(p.no)));
t("...e a procedência", vOk.paragrafos.every(p => p.de === "dossie"));

/* ─────────────── 7. o que a sessão recebe em cada cor ─────────────────── */

console.log("\n[ 07 ] o que é entregue ao prompt");

t("verde é entregue", d.paraPrompt(doc, FLUXO()).usa === true);
/* §2.9: vermelho NÃO é entregue — cai para o `nodes-index.md`. Pagar a leitura
   cara é melhor que patchar a partir de descrição errada. */
t("vermelho NÃO é entregue", d.paraPrompt(doc, wfMais).usa === false);
t("cinza NÃO é entregue", d.paraPrompt(null, wf).usa === false);
const entregaLaranja = d.paraPrompt(doc, wfParam);
t("laranja É entregue", entregaLaranja.usa === true);
t("...com o parágrafo suspeito MARCADO", /MUDOU DEPOIS DESTE TEXTO/.test(entregaLaranja.texto));
t("...mandando ler o JSON real daquele nó", /leia o JSON real deste nó/.test(entregaLaranja.texto));
t("...e só o suspeito é marcado", (entregaLaranja.texto.match(/MUDOU DEPOIS/g) || []).length === 1);
t("o texto entregue leva as etiquetas do cabeçalho", /Escrito por um modelo/.test(entregaLaranja.texto));

/* ──────────────────── 8. as regras que a sessão lê ────────────────────── */

console.log("\n[ 08 ] REGRAS.md e o prompt");

t("as REGRAS proíbem copiar valor de parâmetro", /NUNCA copie o CONTEÚDO de um parâmetro/.test(d.REGRAS));
t("...com exemplo do certo e do errado", /certo:[\s\S]*errado:/.test(d.REGRAS));
t("...e avisam que é verificado por código", /verificado por código/.test(d.REGRAS));
t("as REGRAS mandam pular sticky note", /stickyNote/.test(d.REGRAS));
t("o prompt de recusa repassa os motivos literalmente",
  /literais/.test(d.prompt({ name: "x" }, 5, ["motivo um"])) && d.prompt({ name: "x" }, 5, ["motivo um"]).includes("motivo um"));
/* O prompt viaja em `-p` e a linha de comando do Windows acaba em 32767. */
/* ─────────────────── 9. o gasto que ninguém vê ────────────────────────── */

console.log("\n[ 09 ] a tentativa que falha também custou");

/* MEDIDO: as duas primeiras tentativas reais reprovaram no portão, gastaram cota
   e `dossies.json` nem chegou a existir — o "gasto recorrente que ninguém vê" que
   o §2.3.1 nomeia como o risco desta aba. Estático porque `construir` precisa de
   rede e de CLI; o que se prova aqui é que o caminho de falha grava. */
const fonte = require("fs").readFileSync(require("path").join(__dirname, "dossie.js"), "utf8");
const fim = (fonte.match(/return \{ ok: false, erro: "não passou nas checagens[\s\S]{0,80}/) || [""])[0];
const antesDoFim = fonte.slice(0, fonte.indexOf(fim));
t("o caminho de falha grava no ledger", /ok: false,[\s\S]{0,400}porque:/.test(antesDoFim.slice(-1200)));
/* O defeito original, na coordenada exata em que ele existiu: `compor` sabia
   escrever a visão geral e `construir` não a passava. Estático porque `construir`
   precisa de rede e de CLI — mas sem esta linha o bug que custou US$6,20 volta
   sem derrubar teste nenhum. */
/* A COORDENADA MUDOU COM O INCREMENTAL, e o defeito que ela guarda NÃO: os
   parágrafos agora vêm de `montarParagrafos` (que mistura o novo com o herdado) e
   a visão continua vindo de `v`, a rodada validada. Ela é reescrita em TODA
   escrita, inteira ou parcial — é o mapa do fluxo, e é o que uma mudança de
   conexão invalida primeiro. Se um dia alguém passar `visao` de outro lugar (do
   dossiê antigo, por exemplo), o rótulo diria "reescrevi a visão" tendo copiado a
   velha, e é o mesmo defeito de US$6,20 com outra roupa. */
t("construir passa a visão geral DESTA rodada para o compor",
  /paragrafos: monte\.paragrafos, visao: v\.visao,/.test(fonte));
/* A MESMA COORDENADA, PARA OS CAMPOS NOVOS. Sem esta linha, o dia em que alguém
   editar aquela chamada e esquecer um dos dois faz TODO dossiê novo nascer com
   cabeçalho legado — e um cabeçalho legado é o ramo que responde "vermelho inteiro"
   em vez de localizar. O split existiria no `impressoes` e não existiria na
   prática, sem derrubar teste nenhum: é a repetição exata do defeito da `visao`. */
t("...e passa `settingsFp` e `conexoesPorNo` da MESMA `imp` que gerou as por nó",
  /settingsFp: imp\.settingsFp, conexoesFp: imp\.conexoesFp, conexoesPorNo: imp\.conexoesPorNo/.test(fonte));
t("...e `validar` é quem a extrai", /visao: visao\.trim\(\)/.test(fonte));
t("...e as duas escritas do ledger são o sucesso e a falha",
  (fonte.match(/await anotar\(/g) || []).length === 2);
/* O ledger é rastreado em git e a recusa CITA o trecho que vazou. Copiar isso
   para dentro do git levaria o valor exatamente para onde o portão existe para
   não deixar chegar. */
t("o motivo gravado tira o trecho citado", /replace\(\/\\\("\[\^"\]\*"\\\)\/g, "\(…\)"\)/.test(fonte));
t("o preço estimado ignora tentativa reprovada", /d\.ok !== false && d\.usd > 0/.test(fonte));

t("o prompt do pior caso é curto — o material grande vai em arquivo",
  d.prompt({ name: "N".repeat(200) }, 900, Array.from({ length: 14 }, (_, i) => "recusa longa ".repeat(12) + i)).length < 6000);

console.log(bad
  ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
  : "\npassou: " + ok + " casos — divergência por impressão, e nenhum valor de parâmetro no .md");
process.exit(bad ? 1 : 0);
