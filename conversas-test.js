/* conversas-test.js — o histórico de conversas do `/upgrade`.
 *
 * Cada caso recusa UM defeito com nome. Os dois load-bearing:
 *
 *   1. NENHUM TÍTULO E NENHUM TEXTO chega ao `conversas.json`. Aquele arquivo é
 *      rastreado em git, e o título nasce do que o Kauan escreveu — ele escreve
 *      *"a Ana foi chamada de outro nome"*. É afirmado contra telefone,
 *      e-mail e nome de lead de mentira, inclusive dentro de objeto.
 *   2. O `sessionId` do CLI NÃO é persistido. `upgrade.js` reata com
 *      `--resume <id>`, e um id morto faz o spawn falhar — uma conversa reaberta
 *      morreria na primeira rodada com um erro que fala de sessão, não de
 *      histórico.
 *
 * O JUÍZO DA GAVETA É EXTRAÍDO do `upgrade.html` em tempo de execução, como o
 * `dossie-tela-test.js` já faz: reimplementá-lo aqui provaria a cópia, não a tela.
 *
 * Roda contra a pasta `conversas/` de VERDADE, porque é ela que as funções
 * conhecem. O fluxo de teste tem nome próprio (`zztesteconv*`) e a limpeza está
 * num `finally`. O `conversas.json` NUNCA é apagado inteiro — só as linhas do
 * teste saem: o cockpit escreve nele o dia todo, e é a mesma disciplina do
 * `reexec-test.js` com o `proposals.json`.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhum browser, nada escrito no n8n.
 * `node conversas-test.js`
 */

"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const conversas = require("./conversas.js");
const upgrade = require("./upgrade.js");

const RAIZ = path.join(__dirname, "conversas");
const LEDGER = path.join(__dirname, "conversas.json");
const WF = "zztesteconv1";
const WF2 = "zztesteconv2";
const WF_RUIM = "zztesteconvruim";

let ok = 0, bad = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
};
const grupo = n => console.log("\n— " + n + " " + "─".repeat(Math.max(0, 62 - n.length)));

/* ═══════════════════════════ o juízo, extraído da tela ══════════════════════ */

const html = fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8");
function pega(de, ate) {
  const i = html.indexOf(de);
  if (i < 0) throw new Error("não achei `" + de + "` no upgrade.html — a tela mudou de forma");
  const j = html.indexOf(ate, i);
  if (j < 0) throw new Error("não achei o fim do bloco a partir de `" + de + "`");
  return html.slice(i, j);
}
const fonteJuizo = pega("const ESTADO = {", "/* ═══════════════════════════════ fim do bloco de juízo");
const fonteRender = pega("function icHist()", "function telaFluxo(f)");

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usdTxt = v => "US$" + v.toFixed(2).replace(".", ",");
const S = { convId: null, hist: null, histErro: null, gavFiltro: "", gavCur: -1 };
const confirmar = () => Promise.resolve(false);

const fonteBanda = pega("const NADA_NO_N8N", "function linhaCusto()");
const fonteTeclado = pega("function tecladoGaveta(e)", "/* ─────────────────────────── o histórico");

const tela = new Function("esc", "usdTxt", "S", "confirmar",
  fonteJuizo + "\n" + fonteRender + "\n" + fonteBanda + "\n"
  + "return { ESTADO, ESTADO_BANDA, estadoConv, pedeAcao, esperando, ordemConv, fluxoMudou,"
  + " passaFiltroConv, podeNova, quandoConv, linhaConv, listaGaveta, gaveta, botaoGaveta,"
  + " portaLixeira, bandaEstado, NADA_NO_N8N };"
)(esc, usdTxt, S, confirmar);

/* O TECLADO DA GAVETA precisa de um `document` de mentira, porque o defeito que ele
 * agora recusa é justamente uma consulta ao DOM: com um `.scrim` do `confirmar()`
 * aberto, a gaveta tem de CEDER. Um browser não é necessário para provar isso — um
 * objeto com `querySelector` é. */
function harnessTeclado(temScrim) {
  const chamou = [];
  const doc = { querySelector: s => (s === ".scrim" && temScrim ? { fake: true } : null) };
  const St = {
    gaveta: true, gavEl: null, gavCur: 0, gavFiltro: "", sel: "w1", fluxos: [],
    hist: { conversas: [{ id: "u1", titulo: "a", status: "alvo", em: "2026-08-19T10:00:00Z", evidencias: 0, alvo: null, usd: 0 }] }
  };
  const api = new Function("S", "document", "fecharGaveta", "pintarGaveta", "abrirConversa", "apagarConversa",
    fonteJuizo + "\n" + fonteTeclado + "\nreturn { tecladoGaveta };"
  )(St, doc,
    () => chamou.push("fechar"), () => chamou.push("pintar"),
    id => chamou.push("abrir:" + id), id => chamou.push("apagar:" + id));
  return { api, chamou, S: St };
}
const tecla = k => ({ key: k, preventDefault() {}, shiftKey: false });

/* ═══════════════════════════════ fixtures ══════════════════════════════════ */

/* Dado de cliente de MENTIRA, com a forma do de verdade. É contra estes valores
   que o caso load-bearing do ledger é afirmado. */
const TELEFONE = "+55 41 99887-1395";
const EMAIL = "daniella.pimenta@hotmail.com";
const LEAD = "Ana Carolina Ribeiro Souza";

const sessaoFalsa = (id, extra) => Object.assign({
  id, wfId: WF, wfNome: "Agente Iago Comercial", nos: 179,
  updatedAt: "2026-08-18T16:44:33.291Z",
  status: "aguardando", erro: null, modelo: "sonnet",
  comecouEm: "2026-08-19T09:00:00.000Z",
  chat: [
    { de: "eu", texto: "a " + LEAD + " foi chamada de outro nome no meio da conversa, o telefone dela é " + TELEFONE, em: "2026-08-19T09:00:01.000Z" },
    { de: "ele", tipo: "resposta", texto: "O nome do lead é lido duas vezes de fontes diferentes; o e-mail " + EMAIL + " aparece nos dois.",
      perguntas: ["A fonte boa é o `buscar_lead` ou o `pushname`?"], base: ["fluxo.json"], procedencia: "codigo",
      em: "2026-08-19T09:03:00.000Z" }
  ],
  alvo: null,
  evidencias: [{ arquivo: "evidencia/1-saida.json", pedido: { oque: "saida", execId: "180936" }, resumo: "abri a #180936: o nome veio de contato-name" }],
  custo: [{ usd: 0.77, ms: 121000 }, { usd: 0.54, ms: 98000 }],
  /* Os três que NÃO podem chegar ao disco: um ChildProcess, um Set e o id de
     sessão do CLI. Um `JSON.stringify` da sessão inteira gravaria os dois últimos. */
  filho: { pid: 1234, kill() {} },
  nomes: new Set(["buscar_lead", "build_system_prompt"]),
  sessionId: "3f9a1c22-dead-4b0f-9c11-000000000000",
  log: [{ em: "x", texto: "diretório pronto", nivel: "info" }]
}, extra || {});

async function limpar() {
  for (const wf of [WF, WF2, WF_RUIM]) {
    const d = path.join(RAIZ, wf);
    try { await fsp.rm(d, { recursive: true, force: true }); } catch { /* já foi */ }
    // Se um caso trocou a pasta por um ARQUIVO (para forçar o erro de leitura), o
    // `rm` acima já resolve — mas `force` num arquivo com o nome da pasta também.
    try { if (fs.existsSync(d) && fs.statSync(d).isFile()) await fsp.unlink(d); } catch { /* segue */ }
  }
  /* Só as linhas do teste saem. Apagar o ledger inteiro destruiria o gasto real das
     conversas do Kauan — o mesmo cuidado que o `reexec-test.js` tem com o
     `proposals.json`. */
  try {
    const j = JSON.parse(await fsp.readFile(LEDGER, "utf8"));
    const restam = (j.conversas || []).filter(l => !String(l.wfId || "").startsWith("zzteste"));
    await fsp.writeFile(LEDGER, JSON.stringify({ savedAt: new Date().toISOString(), conversas: restam }, null, 2), "utf8");
  } catch { /* não existia */ }
}

const linhasDoTeste = async () => (await conversas.lerLedger()).filter(l => String(l.wfId || "").startsWith("zzteste"));

/* ═══════════════════════════════════ os casos ══════════════════════════════ */

async function rodar() {
  await limpar();

  // ─────────────────────────────────────────────────────────────────────────
  grupo("salvar e reler: o arquivo é a conversa, sem o que não pode ir");

  const A = "uzzta001";
  const doc = await conversas.salvar(sessaoFalsa(A));
  t("salvar devolve o documento gravado", !!doc && doc.convId === A);

  const lido = await conversas.ler(WF, A);
  t("reler devolve o chat INTEIRO, não um resumo",
    !!lido && lido.chat.length === 2 && lido.chat[1].texto.includes("duas vezes de fontes diferentes"));
  t("as perguntas de volta sobrevivem — sem elas a conversa reabre sem o que estava sendo perguntado",
    !!(lido.chat[1].perguntas && lido.chat[1].perguntas.length === 1));
  t("a procedência sobrevive: 'li no código' e 'vi numa execução' não podem reabrir iguais",
    lido.chat[1].procedencia === "codigo" && Array.isArray(lido.chat[1].base));
  t("o resumo da evidência fica, e o caminho do recorte também",
    lido.evidencias.length === 1 && /180936/.test(lido.evidencias[0].resumo)
    && lido.evidencias[0].arquivo === "evidencia/1-saida.json");
  t("o `wfUpdatedAt` de quando a conversa nasceu é gravado — é ele que acusa fluxo mudado",
    lido.wfUpdatedAt === "2026-08-18T16:44:33.291Z");

  /* LOAD-BEARING. Um `sessionId` morto faz o spawn de `--resume` falhar, e o erro
     fala de sessão em vez de histórico. */
  const cru = await fsp.readFile(path.join(RAIZ, WF, A + ".json"), "utf8");
  t("o `sessionId` do CLI NÃO é persistido (um id morto mata o spawn do --resume)",
    !/sessionId/.test(cru) && !/3f9a1c22/.test(cru));
  t("o ChildProcess não vai para o disco", !/"filho"/.test(cru) && !/1234/.test(cru));
  t("o Set de nomes de nó não vai para o disco (viraria `{}` e mentiria)", !/"nomes"/.test(cru));
  t("o log da rodada não vai para o disco — ele é do processo, não da conversa", !/"log"/.test(cru));

  const semNada = await conversas.salvar(sessaoFalsa("uzzta002", { chat: [] }));
  t("sessão sem mensagem NÃO vira linha fantasma sem título na gaveta", semNada === null);
  t("...e não deixa arquivo", !fs.existsSync(path.join(RAIZ, WF, "uzzta002.json")));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("o ledger vai para o git: nem título, nem texto");

  const linhas = await linhasDoTeste();
  t("uma linha por conversa", linhas.length === 1 && linhas[0].convId === A);

  const bruto = JSON.stringify(linhas);
  t("nenhum telefone de lead no `conversas.json`", !bruto.includes("99887") && !bruto.includes(TELEFONE));
  t("nenhum e-mail de lead no `conversas.json`", !bruto.includes("hotmail") && !bruto.includes(EMAIL));
  t("nenhum nome de lead no `conversas.json`", !bruto.includes("Ana") && !bruto.includes(LEAD));
  t("nenhum TÍTULO no `conversas.json` — é ele que carrega o nome do lead", !/titulo/i.test(bruto));
  t("nenhum texto de mensagem no `conversas.json`", !/chat|ultima|texto/i.test(bruto));
  t("nenhum resumo de evidência no `conversas.json` (é recorte de execução)", !/contato-name|resumo/i.test(bruto));
  t("nem o NOME DO FLUXO entra: menos campo, menos superfície", !/wfNome|Iago/.test(bruto));
  /* O conjunto de chaves é afirmado inteiro, não por amostragem: um campo novo
     acrescentado sem pensar aparece aqui como falha em vez de virar dado de git. */
  t("as chaves são exatamente as oito acordadas",
    JSON.stringify(Object.keys(linhas[0]).sort())
    === JSON.stringify(["convId", "em", "pedidos", "rodadas", "teveAlvo", "usd", "usdDesconhecido", "wfId"]));

  await conversas.salvar(sessaoFalsa(A, { status: "alvo", alvo: { resumo: "x", nos: [{ nome: "buscar_lead" }] } }));
  const dep = await linhasDoTeste();
  t("salvar de novo faz UPSERT, não append — senão o total de gasto viraria ficção",
    dep.length === 1 && dep[0].teveAlvo === true);

  // ─────────────────────────────────────────────────────────────────────────
  grupo("o gasto: uma conta só, e rodada cega nunca some");

  const custo = [{ usd: 0.4 }, { usd: 0.6 }, { usdDesconhecido: true, porque: "morta" }];
  const meu = conversas.gasto(custo);
  const dele = upgrade.gastoAte({ custo });
  t("o gasto somado bate com o `gastoAte()` do upgrade.js, número por número",
    meu.usd === dele.usd && meu.cegas === dele.cegas && meu.estimado === dele.estimado);
  t("a rodada cega é cobrada pela média das medidas, não como zero", meu.usd === 1.5);
  t("e o total se declara ESTIMADO — um zero silencioso autorizaria a próxima rodada", meu.estimado === true);

  await conversas.salvar(sessaoFalsa("uzzta003", { custo }));
  const cega = (await linhasDoTeste()).find(l => l.convId === "uzzta003");
  t("o `usdDesconhecido` chega ao ledger: sem ele o total em git mente para baixo, calado",
    !!cega && cega.usdDesconhecido === true && cega.usd === 1.5);
  t("o ledger conta os pedidos de evidência (o que separa conversa que olhou execução de conversa que leu código)",
    cega.pedidos === 1 && cega.rodadas === 3);

  // ─────────────────────────────────────────────────────────────────────────
  grupo("o título: a primeira frase dele, cortada onde couber");

  t("o título vem da primeira mensagem DELE, nunca da dela",
    conversas.tituloDoChat([{ de: "ele", texto: "eu falo primeiro" }, { de: "eu", texto: "eu que dou o título" }])
    === "eu que dou o título");
  t("quebra de linha é colapsada — um Enter no meio quebraria o rótulo de duas linhas",
    conversas.titulo("primeira linha\n\nsegunda   linha") === "primeira linha segunda linha");
  const longo = "quando o lead volta no mesmo dia ele começa tudo de novo como se nunca tivesse falado com a gente antes disso";
  const cortado = conversas.titulo(longo);
  t("acima do teto ele corta e DIZ que cortou", cortado.endsWith("…") && cortado.length <= conversas.TITULO_MAX + 1);
  /* Fronteira de palavra: o que sobrou é prefixo do original E o caractere seguinte
     no original é um espaço. Cortar 'Ana' no meio não protege nada e piora a
     leitura. A primeira versão deste caso comparava demais e passava vazia. */
  const base = cortado.slice(0, -1);
  t("...em fronteira de palavra: cortar 'Ana' no meio não protege nada e piora a leitura",
    longo.startsWith(base) && longo.charAt(base.length) === " ");
  t("no teto ou abaixo dele, nada é cortado", conversas.titulo("curto e direto") === "curto e direto");
  t("o teto cabe nas duas linhas que a caixa mostra (~96 caracteres)", conversas.TITULO_MAX <= 96);

  // ─────────────────────────────────────────────────────────────────────────
  grupo("apagar move para a lixeira, e a segunda não sobrescreve a primeira");

  const B = "uzztb001";
  await conversas.salvar(sessaoFalsa(B, { wfId: WF, chat: [{ de: "eu", texto: "trocar o link de pagamento" }] }));
  const r1 = await conversas.apagar(WF, B);
  t("apagar SAI da pasta do fluxo", !fs.existsSync(path.join(RAIZ, WF, B + ".json")));
  t("...e ENTRA na lixeira", fs.existsSync(path.join(RAIZ, WF, ".lixeira", r1.lixo + ".json")));
  t("o nome na lixeira carrega carimbo de tempo", conversas.LIXO_RE.test(r1.lixo));
  t("a lixeira registra QUANDO foi apagada", !!(await conversas.naLixeira(WF, B))[0].apagadaEm);

  /* A ARMADILHA QUE CUSTOU DOIS PROJETOS NO TESTER: apagar duas vezes o mesmo id
     sem carimbo faz a segunda sobrescrever a primeira, destruindo calado
     exatamente o que a lixeira existe para não destruir. */
  await conversas.salvar(sessaoFalsa(B, { chat: [{ de: "eu", texto: "de novo, outra conversa com o mesmo id" }] }));
  const r2 = await conversas.apagar(WF, B);
  t("apagar duas do mesmo id dá DOIS itens na lixeira, não um sobrescrito",
    r2.lixo !== r1.lixo && (await conversas.naLixeira(WF, B)).length === 2);

  const volta = await conversas.restaurar(WF, r2.lixo);
  t("restaurar traz de volta com o MESMO id — o convId é o endereço do `?c=`", volta.convId === B);
  t("...e a conversa volta inteira", (await conversas.ler(WF, B)).chat.length === 1);
  t("...e sai da lixeira", (await conversas.naLixeira(WF, B)).length === 1);
  let recusou = null;
  try { await conversas.restaurar(WF, r1.lixo); } catch (e) { recusou = e; }
  t("restaurar sobre um id ocupado RECUSA por nome, não renomeia calado (quebraria o link)",
    !!recusou && recusou.status === 409);
  let semItem = null;
  try { await conversas.apagar(WF, "uzztnaoexiste"); } catch (e) { semItem = e; }
  t("apagar o que não existe dá 404, não apaga nada por perto", !!semItem && semItem.status === 404);

  /* A ORDEM DA ESCRITA, afirmada na FONTE, porque ela não é observável quando as
     duas operações dão certo: escrever o destino antes de remover a origem é o que
     faz a conversa continuar onde estava se o disco estiver cheio. A ordem inversa
     perderia o arquivo, e nenhum teste de comportamento pega isso sem conseguir
     provocar uma falha de escrita. Mesma técnica do `escrever-test.js`, que também
     afirma uma ordem que é garantia. */
  const fonte = fs.readFileSync(path.join(__dirname, "conversas.js"), "utf8");
  const corpoApagar = fonte.slice(fonte.indexOf("async function apagar("), fonte.indexOf("async function restaurar("));
  t("apagar ESCREVE o destino antes de remover a origem (num disco cheio, o arquivo fica onde estava)",
    corpoApagar.indexOf("gravarAtomico(dentro(lixeiraDo") > 0
    && corpoApagar.indexOf("gravarAtomico(dentro(lixeiraDo") < corpoApagar.indexOf("fsp.unlink(origem)"));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("três ausências, três respostas — nenhuma cai no ramo negativo");

  const vazio = await conversas.listar(WF2, new Set());
  t("fluxo sem NADA: lista vazia e `erro` nulo — é uma frase sobre o fluxo",
    vazio.conversas.length === 0 && vazio.erro === null && vazio.ilegiveis === 0);

  /* Leitura que falha NÃO pode virar lista vazia: seria afirmar ausência a partir
     de uma falha, que é o defeito que este repositório pagou três vezes. A pasta é
     trocada por um ARQUIVO para o `readdir` estourar de verdade. */
  await fsp.mkdir(RAIZ, { recursive: true });
  await fsp.writeFile(path.join(RAIZ, WF_RUIM), "não sou uma pasta", "utf8");
  const ruim = await conversas.listar(WF_RUIM, new Set());
  t("histórico ILEGÍVEL: `erro` preenchido, e nunca lista vazia sem explicação",
    !!ruim.erro && ruim.conversas.length === 0);

  await fsp.writeFile(path.join(RAIZ, WF, "uzztc001.json"), "{ isto não é json", "utf8");
  const comLixo = await conversas.listar(WF, new Set());
  t("arquivo corrompido é CONTADO, não sumido em silêncio", comLixo.ilegiveis >= 1);
  t("...e as boas continuam aparecendo", comLixo.conversas.length >= 1 && comLixo.erro === null);

  const eApagada = await conversas.estado(WF, r1.lixo.split("__")[0] === B ? "uzztzzz" : "uzztzzz");
  t("id que nunca existiu: `inexistente`", eApagada.estado === "inexistente");
  await conversas.salvar(sealed("uzztd001"));
  const lixoD = await conversas.apagar(WF, "uzztd001");
  const eD = await conversas.estado(WF, "uzztd001");
  t("conversa APAGADA tem estado próprio, com a data", eD.estado === "apagada" && !!eD.apagadaEm && eD.lixo === lixoD.lixo);
  t("as três respostas são distintas entre si",
    new Set([eD.estado, eApagada.estado, (await conversas.estado(WF, A)).estado]).size === 3);

  // ─────────────────────────────────────────────────────────────────────────
  grupo("o oitavo estado: o cockpit fechou no meio de uma rodada");

  const rodandoDoc = { convId: "uzzte001", wfId: WF, status: "correndo", custo: [{ usd: 0.31 }], chat: [] };
  const inter = conversas.interrompida(rodandoDoc);
  t("`correndo` reaberto vira `interrompida`, nunca `cancelada` nem `falhou`", inter.status === "interrompida");
  t("...e a rodada que morreu entra CEGA: ela custou, e o total não pode dizer que foi grátis",
    inter.custo.length === 2 && inter.custo[1].usdDesconhecido === true && /nunca chegou/.test(inter.custo[1].porque));
  t("...e o total passa a se declarar estimado", conversas.gasto(inter.custo).estimado === true);
  t("é IDEMPOTENTE: reabrir duas vezes não cobra duas rodadas por uma morte",
    conversas.interrompida(inter).custo.length === 2);
  t("uma conversa que não estava correndo não é tocada",
    conversas.interrompida({ status: "aguardando", custo: [] }).custo.length === 0);

  t("`correndo` COM sessão rodando lê `correndo`", tela.estadoConv({ status: "correndo", viva: true }) === "correndo");
  t("`correndo` SEM sessão rodando lê `interrompida` — o fato `viva` é o que separa",
    tela.estadoConv({ status: "correndo", viva: false }) === "interrompida");
  t("status desconhecido cai em `semalvo`, não em `correndo`", tela.estadoConv({ status: "abacaxi" }) === "semalvo");

  const rots = Object.values(tela.ESTADO).map(e => e.rot);
  const frases = Object.values(tela.ESTADO).map(e => e.frase);
  t("os OITO estados têm oito rótulos distintos", new Set(rots).size === 8 && rots.length === 8);
  t("...e oito frases distintas", new Set(frases).size === 8);
  t("`interrompida` NÃO diz 'parada por você' — ele não apertou nada",
    !/parada por você|apertou parar/i.test(tela.ESTADO.interrompida.frase));
  t("`cancelada` NÃO fala de cockpit fechado — a saída dela é outra",
    !/cockpit fechou/i.test(tela.ESTADO.cancelada.frase) && /não existe retomar/i.test(tela.ESTADO.cancelada.frase));
  t("`interrompida` diz o que fazer: mandar a mensagem de novo", /de novo/i.test(tela.ESTADO.interrompida.frase));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("o fluxo mudou desde a conversa");

  t("carimbo diferente: acusa", tela.fluxoMudou({ wfUpdatedAt: "a" }, { updatedAt: "b" }) === true);
  t("carimbo igual: não acusa", tela.fluxoMudou({ wfUpdatedAt: "a" }, { updatedAt: "a" }) === false);
  t("sem carimbo na conversa: NÃO acusa — não saber não é ter mudado",
    tela.fluxoMudou({ wfUpdatedAt: null }, { updatedAt: "b" }) === false);
  t("sem carimbo no fluxo: também não acusa", tela.fluxoMudou({ wfUpdatedAt: "a" }, { updatedAt: null }) === false);
  const linhaMudou = tela.linhaConv(
    { id: "uzzt1", titulo: "x", status: "alvo", em: new Date().toISOString(), evidencias: 0, alvo: null, usd: 1, wfUpdatedAt: "a" },
    { updatedAt: "b" }, null);
  t("a linha DIZ que o fluxo mudou, e em `--warn`: pede atenção, não afirma quebra",
    /o fluxo mudou depois/.test(linhaMudou) && /class="mudou"/.test(linhaMudou) && !/risk/.test(linhaMudou));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("a gaveta: ordem, pílula, filtro e o botão que explica");

  const cs = [
    { id: "u1", titulo: "mais velha", status: "cancelada", em: "2026-08-17T10:00:00Z", evidencias: 0, alvo: null, usd: 0.2 },
    { id: "u2", titulo: "a saudação repetida", status: "aguardando", em: "2026-08-19T11:40:00Z", evidencias: 1, alvo: null, usd: 1.08, ultima: "Antes de mexer eu preciso de uma coisa" },
    { id: "u3", titulo: "mais nova", status: "alvo", em: "2026-08-19T12:00:00Z", evidencias: 2, alvo: "proposto", alvoNos: 3, usd: 0.7 }
  ];
  const ordenada = cs.slice().sort(tela.ordemConv).map(c => c.id);
  t("a ordem é RECÊNCIA e nada mais — subir o que espera reordenaria embaixo do olho",
    JSON.stringify(ordenada) === JSON.stringify(["u3", "u2", "u1"]));
  t("a pílula conta só o que espera por ele", tela.esperando(cs) === 1);
  t("...e uma conversa `correndo` sem sessão viva não conta como espera",
    tela.esperando([{ status: "correndo", viva: false }]) === 0);

  t("o filtro ignora acento e caixa: ele digita 'saudacao'",
    tela.passaFiltroConv(cs[1], "SAUDACAO") === true);
  t("o filtro também bate na última mensagem — as duas coisas que a linha mostra",
    tela.passaFiltroConv(cs[1], "preciso de uma coisa") === true);
  t("filtro que não bate exclui", tela.passaFiltroConv(cs[1], "checkout") === false);
  t("filtro vazio não esconde nada", tela.passaFiltroConv(cs[0], "   ") === true);

  const livre = tela.podeNova({ ativa: null }, "Agente Iago Comercial");
  const mesma = tela.podeNova({ ativa: { wfNome: "Agente Iago Comercial", wfId: "x" } }, "Agente Iago Comercial");
  const outra = tela.podeNova({ ativa: { wfNome: "Agente eContrate", wfId: "y" } }, "Agente Iago Comercial");
  t("sem nada rodando, `+ nova conversa` pode", livre.pode === true);
  t("rodando NESTE fluxo: recusa e diz para parar", mesma.pode === false && /pare ela/i.test(mesma.porque));
  t("rodando em OUTRO fluxo: recusa NOMEANDO o fluxo — um 409 depois do clique é pior",
    outra.pode === false && /eContrate/.test(outra.porque));
  t("as duas recusas são frases diferentes", mesma.porque !== outra.porque);

  // ─────────────────────────────────────────────────────────────────────────
  grupo("a linha: o que borra no modo gravação, e o que nunca vira tooltip");

  const linha = tela.linhaConv(cs[1], { updatedAt: null }, null);
  t("o título carrega `sens` — ele nasce do que o Kauan escreveu", /class="tt sens"/.test(linha));
  t("a última mensagem também carrega `sens`", /class="ult sens"/.test(linha));
  t("o TÍTULO não ganha `title=`: o borrão nunca abre no hover, e um tooltip que revela não protege nada",
    !/<span class="tt sens"[^>]*title=/.test(linha));
  t("estado, hora e custo ficam legíveis: dá para saber QUAL conversa é sem publicar o nome do lead",
    /class="est"/.test(linha) && /class="quando"/.test(linha) && /US\$1,08/.test(linha));
  t("a linha é um `button` de verdade — o teclado vem de graça",
    /<button type="button" class="h-item/.test(linha));
  /* Apagar era um `<span role="button">` DENTRO da linha, e por isso só funcionava
     com o mouse: `role` não dá foco, e conteúdo interativo aninhado num `<button>`
     é markup inválido. Os dois são irmãos agora. */
  t("apagar é um `<button>` IRMÃO, não um `role=button` dentro da linha (mouse-only)",
    /<button type="button" class="h-del"/.test(linha)
    && linha.indexOf('class="h-del"') > linha.indexOf("</button>")
    && !/role="button"/.test(linha));
  t("apagar tem nome acessível que NÃO é o título (que é `sens` e borra)",
    /aria-label="apagar esta conversa"/.test(linha));
  t("a evidência aparece como ícone DESENHADO, nunca emoji", /<svg /.test(linha) && !/[\u{1F300}-\u{1FAFF}]/u.test(linha));
  t("uma conversa `correndo` viva ganha o spin; uma interrompida não",
    /class="spin"/.test(tela.linhaConv({ id: "x", titulo: "a", status: "correndo", viva: true, em: "", evidencias: 0, alvo: null, usd: 0 }, {}, null))
    && !/class="spin"/.test(tela.linhaConv({ id: "x", titulo: "a", status: "correndo", viva: false, em: "", evidencias: 0, alvo: null, usd: 0 }, {}, null)));
  t("gasto não medido aparece como '?' e nunca como US$0,00",
    /US\$\? não medido/.test(tela.linhaConv({ id: "x", titulo: "a", status: "alvo", em: "", evidencias: 0, alvo: null, usd: 0, usdDesconhecido: true }, {}, null)));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("a lista vazia: três telas que não podem ler igual");

  S.hist = { conversas: [], ilegiveis: 0, lixeira: [] }; S.histErro = null; S.gavFiltro = "";
  const semConversa = tela.listaGaveta(null);
  S.histErro = "esta rota não existe no servidor que está rodando";
  const semLeitura = tela.listaGaveta(null);
  S.histErro = null;
  S.hist = { conversas: cs, ilegiveis: 0, lixeira: [] }; S.gavFiltro = "checkout";
  const semFiltro = tela.listaGaveta(null);
  S.gavFiltro = "";
  t("fluxo sem conversa: convida a escrever", /Nenhuma conversa neste fluxo ainda/.test(semConversa));
  t("histórico ilegível: diz que NÃO SABE o que existe, e que nada foi apagado",
    /não sei|Não consegui ler/i.test(semLeitura) && /nada foi apagado/i.test(semLeitura.toLowerCase()));
  t("...e NUNCA diz 'nenhuma conversa ainda'", !/Nenhuma conversa neste fluxo ainda/.test(semLeitura));
  t("lista vazia POR FILTRO fala do filtro, não do fluxo",
    /«checkout»/.test(semFiltro) && !/Nenhuma conversa neste fluxo ainda/.test(semFiltro));
  t("as três frases de vazio são distintas", new Set([semConversa, semLeitura, semFiltro]).size === 3);

  S.hist = { conversas: cs, ilegiveis: 2, lixeira: [] };
  t("arquivo que não abriu é DITO na tela, não sumido", /2 arquivo\(s\) de conversa não abriram/.test(tela.listaGaveta(null)));

  S.hist = { conversas: cs, ilegiveis: 0, lixeira: [{ lixo: "u9__20260819120000", convId: "u9", titulo: "apagada", usd: 1 }] };
  const porta = tela.portaLixeira(S.hist);
  t("a porta de volta da lixeira existe e diz que não há git como saída",
    /trazer de volta/.test(porta) && /não está no git/.test(porta));
  t("...e o título dela também borra no modo gravação", /class="nm sens"/.test(porta));
  S.hist = { conversas: [], ilegiveis: 0, lixeira: [] };
  t("lixeira vazia não desenha porta nenhuma", tela.portaLixeira(S.hist) === "");

  // ─────────────────────────────────────────────────────────────────────────
  grupo("a gaveta vazia esconde o que não faz nada, e mantém o que importa");

  S.hist = { conversas: [], ilegiveis: 0, lixeira: [] }; S.histErro = null;
  const gVazia = tela.gaveta({ nome: "Agente Iago Comercial" });
  S.hist = { conversas: cs, ilegiveis: 0, lixeira: [] };
  const gCheia = tela.gaveta({ nome: "Agente Iago Comercial" });
  t("vazia: sem campo de filtro (filtrar nada é controle que não faz nada)", !/hgv-q/.test(gVazia));
  t("vazia: sem `enter abrir` (não há o que abrir)", !/enter/.test(gVazia));
  t("vazia: MANTÉM o `+ nova conversa` — vazia, é a única coisa que importa", /hgv-nova/.test(gVazia));
  t("cheia: filtro e dicas voltam", /hgv-q/.test(gCheia) && /enter/.test(gCheia));
  t("é um diálogo de verdade: role, aria-modal e aria-labelledby",
    /role="dialog"/.test(gCheia) && /aria-modal="true"/.test(gCheia) && /aria-labelledby="hgv-t"/.test(gCheia));
  /* UM NÓ SÓ, e o teste tem de provar o ANINHAMENTO, não só as pontas: a primeira
     versão aceitava `<div class="hgv-scrim"></div><aside …>` — dois irmãos — porque
     ela só olhava o começo e o fim da string. Guardar a gaveta entre repaints
     depende de ela ser filha do véu, então o que se afirma é que nenhum `</div>`
     fecha antes do `<aside`. */
  t("a gaveta vive DENTRO do véu — um nó só, que é o que permite guardá-la entre repaints",
    /^<div class="hgv-scrim">/.test(gCheia) && gCheia.trim().endsWith("</aside></div>")
    && gCheia.indexOf("<aside") < gCheia.indexOf("</div>"));
  /* "esperando você" é o único estado que ganha aviso, e ele é PALAVRA em três
     lugares — nunca um ponto colorido em nenhum deles: a pílula do botão fechado, o
     rótulo da linha, e a frase do estado. Um ponto âmbar informaria por cor
     sozinha, e quem não distingue a cor veria só um ponto. */
  t("a pílula de 'esperando você' é PALAVRA na linha", /esperando você<\/span>/.test(gCheia));
  t("...e nunca é só um ponto colorido: não existe `sdot` na lista",
    !/sdot/.test(gCheia) && !/class="pt"/.test(gCheia));

  /* Histórico ilegível: nada para filtrar e nada para abrir com Enter, mas o
     `+ nova conversa` continua — é a única saída possível dali. */
  /* `S.hist` com conversas E `histErro` preenchido é estado sintético — hoje a rota
     não devolve os dois juntos. O caso existe para travar a INTENÇÃO: se algum dia
     ela devolver, o que a tela mostra é o aviso de que não sabe, e um campo de busca
     por cima dele seria um controle sobre uma lista que não foi lida. Sem este caso,
     um mutante que apaga o ramo do erro passa. */
  S.hist = { conversas: cs, ilegiveis: 0, lixeira: [] }; S.histErro = "caiu a rota";
  t("erro COM lista em memória: o filtro ainda sai — o aviso é o que está na tela",
    !/hgv-q/.test(tela.gaveta({ nome: "x" })));

  S.hist = null; S.histErro = "caiu a rota";
  const gErro = tela.gaveta({ nome: "Agente Iago Comercial" });
  t("com o histórico ilegível, o filtro sai (não há lista para filtrar)", !/hgv-q/.test(gErro));
  t("...e o `+ nova conversa` fica: é a única saída dali", /hgv-nova/.test(gErro));
  t("...e a gaveta diz que não sabe o que existe", /Não consegui ler o histórico/.test(gErro));

  S.hist = null; S.histErro = null;
  t("antes da resposta, o botão diz que está LENDO — nunca '0 conversas'",
    /lendo o histórico/.test(tela.botaoGaveta()) && !/>0<\/span>/.test(tela.botaoGaveta()));
  S.histErro = "caiu";
  t("com erro, o botão não afirma contagem nenhuma", /· \?/.test(tela.botaoGaveta()));
  S.histErro = null; S.hist = { conversas: [], ilegiveis: 0, lixeira: [] };
  t("a porta aparece VAZIA: porta que só aparece com algo atrás é porta que ninguém acha",
    /conversas/.test(tela.botaoGaveta()) && !/disabled/.test(tela.botaoGaveta()));
  S.hist = { conversas: cs, ilegiveis: 0, lixeira: [] };
  t("com alguém esperando, a contagem diz a palavra 'espera' no botão fechado",
    /espera/.test(tela.botaoGaveta()));

  /* O RODAPÉ É REPINTADO A CADA DADO NOVO, afirmado na FONTE porque a fiação depende
     do DOM e este teste não tem browser. Sem isto, `+ nova conversa` continuaria
     habilitado depois de uma conversa de outro fluxo começar a rodar com a gaveta já
     aberta — devolvendo no clique o 409 que o botão existe para evitar. */
  const pg = html.slice(html.indexOf("function pintarGaveta()"), html.indexOf("function ligarNova()"));
  t("`pintarGaveta` repinta o rodapé e refaz a fiação do `+ nova conversa`",
    /rodapeGaveta\(f\)/.test(pg) && /ligarNova\(\)/.test(pg));
  t("...e repinta a lista sem rolar de volta ao topo",
    /listaGaveta\(f\)/.test(pg) && /scrollTop = rol/.test(pg));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("o Esc da gaveta cede ao diálogo — um Esc, uma coisa fechada");

  /* MEDIDO NO NAVEGADOR: com o diálogo de apagar aberto, um Esc fechava o diálogo E
     a gaveta, porque o `onKey` do `confirmar()` roda em CAPTURA no `document` e
     remove o véu de forma síncrona — um teste de `.scrim` feito depois olha um
     documento onde ele já não existe. A regra já estava escrita no `CLAUDE.md` para
     o Tester: a checagem é se existe um `.scrim`. */
  const semDialogo = harnessTeclado(false);
  t("sem diálogo aberto, Esc fecha a gaveta",
    semDialogo.api.tecladoGaveta(tecla("Escape")) === true && semDialogo.chamou.includes("fechar"));

  const comDialogo = harnessTeclado(true);
  const tratou = comDialogo.api.tecladoGaveta(tecla("Escape"));
  t("com diálogo aberto, a gaveta NÃO trata o Esc — ela cede", tratou === false);
  t("...e não fecha: um Esc fecha uma coisa, não duas", !comDialogo.chamou.includes("fechar"));

  /* Não é só o Esc: com um diálogo na frente, NENHUMA tecla da gaveta pode agir —
     ↑↓ andando por trás do véu seria a mesma família de defeito que o `inert`
     resolve para o Tab. */
  const d2 = harnessTeclado(true);
  d2.api.tecladoGaveta(tecla("ArrowDown"));
  d2.api.tecladoGaveta(tecla("Enter"));
  d2.api.tecladoGaveta(tecla("Delete"));
  t("com diálogo aberto, ↑↓, Enter e Delete também não agem", d2.chamou.length === 0);

  const semD1 = harnessTeclado(false);
  semD1.api.tecladoGaveta(tecla("Delete"));
  t("sem diálogo, Delete no cursor pede para apagar aquela conversa", semD1.chamou.includes("apagar:u1"));
  const semD2 = harnessTeclado(false);
  semD2.api.tecladoGaveta(tecla("Enter"));
  t("sem diálogo, Enter no cursor abre aquela conversa", semD2.chamou.includes("abrir:u1"));

  const fechada = harnessTeclado(false);
  fechada.S.gaveta = false;
  t("com a gaveta fechada, ela não trata tecla nenhuma (Esc ainda para a rodada)",
    fechada.api.tecladoGaveta(tecla("Escape")) === false);

  /* A outra metade do conserto é a FASE do ouvinte, e ela não é observável fora do
     navegador: afirmada na fonte. Sem a captura, a checagem acima nunca vê o véu. */
  const ouvinte = html.slice(html.indexOf("addEventListener(\"keydown\", e => {"),
    html.indexOf("/* ---------------------------------------------------------------- render ---"));
  t("o ouvinte de teclado roda em CAPTURA — na bolha o véu já foi removido",
    /\}, true\);/.test(ouvinte));

  // ─────────────────────────────────────────────────────────────────────────
  grupo("as oito frases chegam na tela: nenhuma é código morto");

  /* `linhaConv` desenhava só o `rot`, então as oito `frase` que eu escrevi eram
     código morto — e pior que morto: uma SEGUNDA redação, porque a banda já dizia
     com outras palavras o que `cancelada` e `falhou` dizem. É fatal justamente no
     oitavo estado: `interrompida` sozinho como palavra não diz que a rodada
     recomeça mandando a mensagem de novo, e ninguém nunca viu esse estado antes. */
  t("`frase` é LIDA pela página, não só declarada", /ESTADO\[[^\]]+\]\.frase/.test(html));

  const semBanda = ["aguardando", "alvo", "confirmado", "semalvo"];
  t("os quatro estados que ganham banda estão declarados em `ESTADO_BANDA`",
    JSON.stringify(Object.keys(tela.ESTADO_BANDA).sort())
    === JSON.stringify(["cancelada", "correndo", "falhou", "interrompida"]));
  t("toda chave de `ESTADO_BANDA` existe em `ESTADO` — banda de estado que não existe é banda que nunca aparece",
    Object.keys(tela.ESTADO_BANDA).every(k => !!tela.ESTADO[k]));
  t("nenhuma cor de banda é `--ok`: confirmar o alvo não aplicou nada",
    !Object.values(tela.ESTADO_BANDA).includes("ok"));

  const banda = st => { S.conv = st; return tela.bandaEstado(); };
  const bInter = banda({ status: "interrompida", custo: [], chat: [] });
  t("`interrompida` GANHA banda — o estado que ninguém nunca viu é o que mais precisa da frase",
    !!bInter && /banda cold/.test(bInter));
  t("...e a banda dele diz o que fazer: mandar a mensagem de novo", /de novo/.test(bInter));
  t("...e diz que nada foi escrito no n8n", bInter.includes(tela.NADA_NO_N8N));
  t("...e é `--cold`, nunca `--risk`: não quebrou sozinha", !/banda risk/.test(bInter));

  const bCanc = banda({ status: "cancelada", custo: [], chat: [] });
  t("`cancelada` ganha banda com a frase DELA, não com uma segunda redação",
    bCanc.includes("não existe retomar") && /banda cold/.test(bCanc));
  t("as bandas de `interrompida` e `cancelada` NÃO dizem a mesma coisa",
    bCanc.replace(/\s+/g, " ") !== bInter.replace(/\s+/g, " "));

  const bQuebrou = banda({ status: "falhou", erro: "resposta.json fora de forma em 4 rodadas", custo: [], chat: [] });
  t("`quebrou` mostra a frase E o erro de verdade — o detalhe é o mais útil da tela ali",
    /quebrou sozinha/.test(bQuebrou) && /fora de forma em 4 rodadas/.test(bQuebrou) && /banda risk/.test(bQuebrou));

  for (const st of semBanda) {
    t("`" + st + "` NÃO ganha banda (tarja permanente ensina a não ler tarja)",
      banda({ status: st, custo: [], chat: [] }) === "");
  }
  const bCorrendo = banda({ status: "correndo", atividade: "lendo evidencia/2-saida.json", custo: [], chat: [] });
  t("`correndo` mantém a banda que já existia: atividade viva e o botão de parar",
    /class="spin"/.test(bCorrendo) && /id="parar"/.test(bCorrendo) && /2-saida/.test(bCorrendo));
  t("status desconhecido não inventa banda", banda({ status: "abacaxi", custo: [], chat: [] }) === "");
  S.conv = null;

  // ─────────────────────────────────────────────────────────────────────────
  grupo("quando: relativo, porque a pergunta é 'isto é de hoje?'");

  t("agora é 'agora'", tela.quandoConv(new Date().toISOString()) === "agora");
  t("hoje mais cedo diz 'hoje HH:MM'", /^hoje \d\d:\d\d$/.test(tela.quandoConv(new Date(Date.now() - 4 * 3600e3).toISOString())));
  t("carimbo ausente não vira data inventada", tela.quandoConv(null) === "?");
  t("carimbo torto também não", tela.quandoConv("nem data isto é") === "?");

  // ─────────────────────────────────────────────────────────────────────────
  grupo("a forma dos fatos: o que a rota promete à tela");

  const f = conversas.fatos(await conversas.ler(WF, A), false);
  t("os fatos carregam o que a linha desenha, e nada além",
    JSON.stringify(Object.keys(f).sort()) === JSON.stringify([
      "alvo", "alvoNos", "criadaEm", "em", "evidencias", "id", "rodadas", "status",
      "titulo", "ultima", "ultimaDe", "usd", "usdDesconhecido", "viva", "wfUpdatedAt"].sort()));
  t("`viva` é FATO, e vem de fora — a página não deduz", conversas.fatos({ convId: "x", custo: [] }, true).viva === true);
  t("`ultima` é cortada: mandar 3500 caracteres para desenhar 110 pagaria o snapshot por conversa",
    conversas.fatos({ convId: "x", custo: [], chat: [{ de: "eu", texto: "a".repeat(4000) }] }, false).ultima.length === conversas.ULTIMA_MAX);
  t("alvo confirmado e alvo proposto são valores diferentes",
    conversas.fatos({ convId: "x", custo: [], alvo: { nos: [] }, status: "confirmado" }, false).alvo === "confirmado"
    && conversas.fatos({ convId: "x", custo: [], alvo: { nos: [] }, status: "alvo" }, false).alvo === "proposto");

  // ─────────────────────────────────────────────────────────────────────────
  grupo("caminho: um id de outro lugar não vira arquivo em outro lugar");

  let mau = null;
  try { await conversas.salvar(sessaoFalsa("../../fora")); } catch (e) { mau = e; }
  t("id de conversa fora de forma é recusado por nome", !!mau && mau.status === 400);
  t("wfId com travessia é recusado", await (async () => {
    try { await conversas.listar("../..", new Set()); return false; } catch (e) { return e.status === 400; }
  })());
  t("ler com id torto devolve null em vez de estourar", (await conversas.ler(WF, "..")) === null);
}

/* Uma sessão mínima, para os casos que só precisam de um arquivo existindo. */
function sealed(id) {
  return sessaoFalsa(id, { chat: [{ de: "eu", texto: "conversa mínima de fixture" }], evidencias: [], custo: [{ usd: 0.1 }] });
}

rodar()
  .catch(e => { bad++; console.log("\n  EXPLODIU: " + (e && e.stack || e)); })
  .then(limpar)
  .then(() => {
    console.log("");
    console.log(bad ? "FALHOU: " + bad + " de " + (ok + bad) : "passou: " + ok + " casos, e cada um recusa um defeito com nome");
    process.exit(bad ? 1 : 0);
  });
