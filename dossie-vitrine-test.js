/* dossie-vitrine-test.js — o semáforo do dossiê no cartão da vitrine (§5) e a
 * oferta no recibo (§4).
 *
 * O BLOCO DE JUÍZO É EXTRAÍDO DO `upgrade.html` EM TEMPO DE EXECUÇÃO, e as duas
 * funções de render também. Reimplementá-los aqui provaria a cópia, não a tela —
 * mesma disciplina do `audio-test.js` e do `dossie-tela-test.js`. E as checagens de
 * fiação medem FONTE SEM COMENTÁRIO: esta base já teve teste passando porque o
 * comentário citava o nome da função que o teste procurava, e naquele dia ele
 * reprovou a documentação da decisão e aprovou a ausência dela ao mesmo tempo.
 *
 * OS DOIS CASOS LOAD-BEARING:
 *
 *   1. `travado` do selo SAI DE `podeConversar`, para todo estado presente. Duas
 *      definições de "não dá para conversar" divergem no primeiro ajuste feito num
 *      lado só, e o cartão passaria a convidar a abrir um fluxo que a tela seguinte
 *      recusa. A ausência é a única exceção, e é o outro caso: estado que não chegou
 *      NÃO é "sem dossiê" nem "travado" — sexta vez que este repositório escreve
 *      isso, e aqui errar significaria acusar o dossiê dele de não existir por causa
 *      de um fetch.
 *
 *   2. O botão do recibo carrega o fluxo ESCRITO em `data-wf`. Por causa do §4.5 o
 *      patch pode ter sido escrito num sub-fluxo; a delegação lia `S.sel`, então sem
 *      isso o clique escreveria o dossiê do fluxo aberto — pago, minutos de sessão,
 *      arquivo errado, e nada na tela dizendo.
 *
 * De graça: nenhum browser, nenhuma rede, nenhum modelo, nada escrito em lugar
 * nenhum. `node dossie-vitrine-test.js` */

"use strict";

const fs = require("fs");
const path = require("path");

const h = fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8");
const srv = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

const pega = (de, ate) => {
  const i = h.indexOf(de);
  if (i < 0) throw new Error("nao achei `" + de + "` no upgrade.html - a tela mudou de forma");
  const j = h.indexOf(ate, i);
  if (j < 0) throw new Error("nao achei o fim do bloco a partir de `" + de + "`");
  return h.slice(i, j);
};
const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/* O juízo do dossiê (frases, selo, oferta, botão) + o veredito da trava + as duas
   funções que desenham. Nenhuma delas é reescrita aqui. */
const src = pega("const DOSSIE_FRASE = {", "function faixaDossie(f)")
  + pega("function faixaDossie(f)", "\n/* ------")
  + pega("function linhaSeloDossie(f)", "\nfunction telaVitrine()")
  + pega("function linhaOfertaDossie(ap)", "\n/* A BANDA DE ESTADO");

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usdTxt = v => "US$" + v.toFixed(2).replace(".", ",");
const S = { dossie: new Map(), dossieVit: new Map(), dossieVitMeta: null, fluxos: [], conv: null, sel: null };
const api = new Function("esc", "usdTxt", "S",
  src + "; return { seloDossie, ofertaDossie, resumoDossieVitrine, linhaSeloDossie, linhaOfertaDossie, botaoDossie, podeConversar };")(esc, usdTxt, S);

let ok = 0, bad = 0;
const t = (n, c) => { if (c) { ok++; console.log("  ok    " + n); } else { bad++; console.log("  FALHOU " + n); } };

const cinza = { id: "w1", cor: "cinza", motivo: "nunca foi escrito", quantosMudados: 0, preco: {} };
const verm = { id: "w1", cor: "vermelho", motivo: "3 nó(s) entraram — o mapa do fluxo mudou", quantosMudados: 3, preco: { usd: 4.14, amostras: 2 } };
const lar = { id: "w1", cor: "laranja", motivo: "2 nó(s) mudaram desde o dossiê", quantosMudados: 2, preco: { usd: 4.14, amostras: 2 } };
const verde = { id: "w1", cor: "verde", motivo: "nenhum nó divergente", quantosMudados: 0, preco: {} };
const erro = { id: "w1", erro: "não consegui ler o fluxo no n8n: 503" };
const roxo = { id: "w1", cor: "roxo", quantosMudados: 0, preco: {} };

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 1 ] o selo do cartão — três estados, e a trava derivada");

const sSem = api.seloDossie(undefined);
t("estado ausente: diz que está CONFERINDO, nunca 'sem dossiê'",
  /conferindo/i.test(sSem.txt) && !/sem dossiê/i.test(sSem.txt));
t("estado ausente: NÃO é apresentado como travado (ausência não é resposta negativa)",
  sSem.travado === false);
t("estado ausente: e nem como podre — a cor é `cold`, nunca `risk`", sSem.cls === "cold");
t("estado ausente: `null` cai no mesmo ramo que `undefined`",
  api.seloDossie(null).txt === sSem.txt);
/* A frase do título tem de dizer que isto NÃO é ausência de dossiê: o selo é lido
   sem hover, mas quem passa o mouse é justamente quem ficou em dúvida. */
t("estado ausente: o título nega explicitamente ser «sem dossiê»", /não é «sem dossiê»/.test(sSem.tit));

const sErr = api.seloDossie(erro);
t("erro de leitura tem ramo PRÓPRIO, e não cai em cinza",
  /não deu para conferir/.test(sErr.txt) && !/sem dossiê/.test(sErr.txt));
t("erro de leitura: o motivo do servidor viaja no título", /503/.test(sErr.tit));
t("erro de leitura NÃO trava (culpar o arquivo dele por um 503 do n8n é a direção errada)",
  sErr.travado === false);

const sRox = api.seloDossie(roxo);
t("cor desconhecida: ramo próprio e cita a cor recebida", /não deu para conferir/.test(sRox.txt) && /roxo/.test(sRox.tit));

const sCin = api.seloDossie(cinza);
t("cinza: diz «sem dossiê» e diz que a conversa está travada",
  /sem dossiê/.test(sCin.txt) && /travada/.test(sCin.txt));
/* CINZA É A MAIORIA (2 dossiês, 75 fluxos). Ele é `cold` de propósito: selo
   barulhento em 12 de 14 cartões ensina a ignorar os 2 que apodreceram, que são a
   pergunta que esta varredura vem responder. */
t("cinza é QUIETO: cor `cold`, nunca `risk` nem `warn`", sCin.cls === "cold");

const sVer = api.seloDossie(verm);
t("vermelho: diz que a conversa está travada, ANTES do clique", /travada/.test(sVer.txt));
t("vermelho: cor `risk`", sVer.cls === "risk");
t("vermelho: o motivo medido viaja no título", /3 nó\(s\) entraram/.test(sVer.tit));

const sLar = api.seloDossie(lar);
t("laranja: nomeia quantos nós mudaram", /2 nó\(s\)/.test(sLar.txt));
t("laranja: cor `warn`, e NÃO diz travada (entregue com ressalva é entregue)",
  sLar.cls === "warn" && !/travada/.test(sLar.txt));

const sVrd = api.seloDossie(verde);
t("verde: diz em dia, cor `ok`, sem travar", /em dia/.test(sVrd.txt) && sVrd.cls === "ok" && sVrd.travado === false);
/* As duas etiquetas obrigatórias: escrito por um modelo, e a digital prova o nó e
   não a prosa. Elas viajam no título do verde porque é ali que alguém acredita. */
t("verde: o título não deixa a digital passar por prova da descrição",
  /nunca que a descrição estava certa/.test(sVrd.tit));

const escrevendo = { ...cinza, job: { escrevendo: true, atividade: "rodada 1 de 2 — sonnet" } };
const sEsc = api.seloDossie(escrevendo);
t("escrevendo: diz que está escrevendo, e NÃO «sem dossiê»",
  /escrevendo/.test(sEsc.txt) && !/sem dossiê/.test(sEsc.txt));
t("escrevendo: a atividade da rodada viaja no título", /rodada 1 de 2/.test(sEsc.tit));
t("escrevendo vem ANTES da cor: um cinza em escrita não lê como cinza",
  sEsc.txt !== sCin.txt);

const todos = [sSem, sErr, sCin, sVer, sLar, sVrd, sEsc];
t("os sete textos visíveis são distintos entre si", new Set(todos.map(s => s.txt)).size === 7);
t("todos carregam glifo (a pista nunca é só o matiz)", todos.every(s => s.glifo && s.glifo.length));

/* O CASO LOAD-BEARING: a trava do cartão é a MESMA de `podeConversar`, para todo
   estado PRESENTE. Sem isso o cartão teria uma segunda definição de "não dá para
   conversar", e ela divergiria no primeiro ajuste feito num lado só. */
const presentes = [cinza, verm, lar, verde, erro, roxo, escrevendo,
  { ...verde, job: { escrevendo: true } }, { ...lar, job: { escrevendo: true } },
  { ...verm, job: { escrevendo: true } }];
t("`travado` do selo é derivado de `podeConversar` em TODOS os estados presentes",
  presentes.every(d => api.seloDossie(d).travado === !api.podeConversar(d).pode));
/* E ele não é vacuamente igual: algum estado trava e algum não. Sem esta metade,
   um `travado: false` fixo em toda parte passaria o caso acima calado. */
t("...e a derivação não é vácuo: há estado travado e estado liberado",
  presentes.some(d => api.seloDossie(d).travado) && presentes.some(d => !api.seloDossie(d).travado));
/* Um verde sendo reescrito continua liberado — o dossiê antigo existe e é o que vai
   para a sessão. É o caso em que a ORDEM dentro de `podeConversar` é o veredito, e
   o selo herda essa ordem em vez de reinventá-la. */
t("verde sendo reescrito: o selo não trava", api.seloDossie({ ...verde, job: { escrevendo: true } }).travado === false);
t("cinza sendo escrito: o selo trava", api.seloDossie(escrevendo).travado === true);

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 2 ] o selo, desenhado no cartão");

const flux = { id: "w1", nome: "Agente Iago" };
S.dossieVit.clear();
const hSem = api.linhaSeloDossie(flux);
t("sem varredura: o cartão diz conferindo, e não fica em branco", /conferindo/.test(hSem));
t("sem varredura: nenhuma classe de status forte no cartão", /tag cold/.test(hSem) && !/tag risk/.test(hSem));

S.dossieVit.set("w1", verm);
const hVer = api.linhaSeloDossie(flux);
t("vermelho: o cartão usa `tag risk` e a linha própria `vc-dos`", /tag risk/.test(hVer) && /class="vc-dos"/.test(hVer));
t("vermelho: travado ganha contorno além da cor", /travado/.test(hVer));
t("o glifo é `aria-hidden` (quem não vê a cor lê o texto)", /aria-hidden="true"/.test(hVer));

S.dossieVit.set("w1", { ...verm, motivo: '<img src=x onerror="alert(1)">' });
const hEsc = api.linhaSeloDossie(flux);
t("o motivo do servidor é escapado no título do selo", !/<img/.test(hEsc) && /&lt;img/.test(hEsc));

S.dossieVit.set("w1", lar);
t("laranja: `tag warn` e sem contorno de travado",
  /tag warn/.test(api.linhaSeloDossie(flux)) && !/travado/.test(api.linhaSeloDossie(flux)));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 3 ] a frase de resumo da vitrine — `falhas` é o motivo dela existir");

const vivos = [{ id: "a" }, { id: "b" }, { id: "c" }];
S.dossieVit.clear(); S.dossieVitMeta = null;
t("sem varredura: diz que está conferindo, e NÃO um zero por ausência de resposta",
  /[Cc]onferindo/.test(api.resumoDossieVitrine(vivos)) && !/nenhum dossiê apodreceu/.test(api.resumoDossieVitrine(vivos)));

S.dossieVit.set("a", verde); S.dossieVit.set("b", cinza); S.dossieVit.set("c", verm);
S.dossieVitMeta = { lidos: 3, falhas: 0, geradoEm: "2026-08-20T12:00:00.000Z" };
const r1 = api.resumoDossieVitrine(vivos);
t("conta os podres (laranja + vermelho)", /1 dossiê\(s\) apodreceram/.test(r1));
t("conta os travados sobre o total", /2 de 3/.test(r1));
t("sem falha, nada de piso: a frase não fala de leitura incompleta", !/piso/.test(r1));

S.dossieVitMeta = { lidos: 2, falhas: 1, geradoEm: "x" };
const r2 = api.resumoDossieVitrine(vivos);
/* COM LEITURA INCOMPLETA, "nada apodreceu" deixa de ser afirmação que este painel
   pode fazer — mesma razão pela qual o call graph reporta `falhas`. */
t("com falha: diz quantos não deu para conferir e que os números são piso",
  /1 fluxo\(s\) não deu para conferir/.test(r2) && /piso, não total/.test(r2));

S.dossieVit.clear();
S.dossieVit.set("a", verde); S.dossieVit.set("b", verde); S.dossieVit.set("c", verde);
S.dossieVitMeta = { lidos: 3, falhas: 0, geradoEm: "x" };
t("todos em dia: a frase afirma isso em vez de calar", /nenhum dossiê apodreceu/.test(api.resumoDossieVitrine(vivos)));

/* A HORA DA LEITURA vem do payload, nunca de `new Date()`: estes números podem ser
   de uma varredura de meia hora atrás, e relógio vivo sobre dado velho prova que a
   página está de pé, nunca que o dado está. */
/* A hora impressa é a DO PAYLOAD, e a fixtura é de três horas atrás justamente
   para que trocar `geradoEm` por `new Date()` — um relógio vivo sobre dado velho —
   caia aqui. Comparar só o formato `\d\d:\d\d` deixaria esse mutante vivo, e ele
   foi verificado. */
const tresHoras = new Date(Date.now() - 3 * 3600 * 1000 - 17 * 60 * 1000);
S.dossieVitMeta = { lidos: 3, falhas: 0, geradoEm: tresHoras.toISOString() };
const rHora = api.resumoDossieVitrine(vivos);
t("a frase carrega a hora DA LEITURA, não a de agora",
  rHora.includes("Conferido às " + tresHoras.toLocaleTimeString("pt-BR"))
  && !rHora.includes(new Date().toLocaleTimeString("pt-BR")));
S.dossieVitMeta = { lidos: 3, falhas: 0, geradoEm: "x" };
t("data ilegível se cala em vez de escrever `Invalid Date` na tela",
  !/Invalid|NaN|Conferido/.test(api.resumoDossieVitrine(vivos)));
S.dossieVitMeta = { lidos: 3, falhas: 0, geradoEm: null };
t("sem data nenhuma, idem", !/Conferido/.test(api.resumoDossieVitrine(vivos)));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 4 ] a oferta do recibo — e onde ela NÃO oferece gasto");

const oSem = api.ofertaDossie(undefined);
t("estado ausente: sem botão, e a frase é conferindo",
  oSem.botao === false && /[Cc]onferindo/.test(oSem.frase));
const oErr = api.ofertaDossie(erro);
t("erro: sem botão, e diz que não oferece escrita paga sobre estado desconhecido",
  oErr.botao === false && /não sei quantos/.test(oErr.frase));
t("cor desconhecida: mesmo ramo, sem botão", api.ofertaDossie(roxo).botao === false);
const oVrd = api.ofertaDossie(verde);
t("verde: sem botão (reescrever o que está em dia é gasto sem motivo)",
  oVrd.botao === false && /continua em dia/.test(oVrd.frase));
const oCin = api.ofertaDossie(cinza);
t("cinza: sem botão, e NÃO afirma que parágrafos envelheceram (não havia nenhum)",
  oCin.botao === false && !/ficaram velhos/.test(oCin.frase) && /não tem dossiê/.test(oCin.frase));
t("cinza: manda para a faixa do fluxo em vez de esconder a saída", /faixa do dossiê/.test(oCin.frase));
t("escrevendo: sem botão, porque já está acontecendo",
  api.ofertaDossie(escrevendo).botao === false && /já está sendo escrito/.test(api.ofertaDossie(escrevendo).frase));

const oLar = api.ofertaDossie(lar);
t("laranja: OFERECE, nomeia quantos parágrafos e diz que ainda vai para a conversa",
  oLar.botao === true && /2 parágrafo\(s\)/.test(oLar.frase) && /marcados/.test(oLar.frase));
const oVer = api.ofertaDossie(verm);
t("vermelho: OFERECE, e diz que a conversa está travada",
  oVer.botao === true && /travada/.test(oVer.frase));
t("vermelho: nomeia o motivo medido", /3 nó\(s\) entraram/.test(oVer.frase));

/* O PREÇO NÃO É INVENTADO. Zero escrita parcial medida; enquanto `preco.usd` não
   vier, a frase diz que não sabe — mesma disciplina do ETA da correção devolvendo
   `samples: 0` em vez de um palpite na primeira execução. */
/* A MEDIANA TEM DE DIZER DE QUE MODO ELA É. Uma frase que diz só "das 2 escritas já
   medidas" serve para os dois modos, e os dois números não são comparáveis: US$4,14
   por 179 nós contra um conserto de três parágrafos. */
t("com histórico: mostra o número e diz de onde ele vem, NOMEANDO o modo medido",
  /US\$4,14/.test(oVer.frase) && /mediana das 2 escritas inteiras já medidas/.test(oVer.frase));
const oSemPreco = api.ofertaDossie({ ...verm, preco: {} });
t("sem histórico: diz que não sabe o preço e não escreve nenhum US$",
  /não sei o preço/.test(oSemPreco.frase) && !/US\$/.test(oSemPreco.frase));
t("sem histórico: continua oferecendo o botão (o preço desconhecido não é recusa)",
  oSemPreco.botao === true);
t("sem histórico: diz o que cria a régua, em vez de só negar", /duas primeiras escritas medidas/.test(oSemPreco.frase));

const fr = [oSem, oErr, oVrd, oCin, oLar, oVer, api.ofertaDossie(escrevendo)].map(o => o.frase);
t("as sete frases da oferta são distintas entre si", new Set(fr).size === 7);
t("as classes de cor da oferta seguem o estado", oVer.cls === "risk" && oLar.cls === "warn" && oVrd.cls === "ok" && oCin.cls === "cold");

t("motivo do servidor é escapado na frase da oferta",
  !/<img/.test(api.ofertaDossie({ ...verm, motivo: '<img src=x onerror="alert(1)">' }).frase));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 5 ] a oferta desenhada — e o fluxo ESCRITO, que pode não ser o aberto");

S.conv = { wfId: "w1", wfNome: "Agente Iago" };
S.fluxos = [{ id: "w1", nome: "Agente Iago" }];
S.dossie.clear(); S.dossie.set("w1", verm);

const l1 = api.linhaOfertaDossie({ wfId: "w1", em: "x", qual: "normal" });
t("mesmo fluxo: a linha aparece, indexada [ DOSSIÊ ]", /\[ DOSSIÊ \]/.test(l1) && /dos-of/.test(l1));
t("mesmo fluxo: NÃO nomeia o fluxo (é o que está na tela)", !/que é onde o patch foi escrito/.test(l1));
t("mesmo fluxo: o botão do dossiê está ali, com o alvo explícito",
  /data-dossie="1"/.test(l1) && /data-wf="w1"/.test(l1));

/* §4.5: o patch pode ter sido escrito num sub-fluxo. O dossiê que envelheceu é o
   DE LÁ, e o botão tem de escrever o de lá. */
S.dossie.set("w9", { ...lar, id: "w9", nome: "Agente eContrate" });
const l2 = api.linhaOfertaDossie({ wfId: "w9", em: "x", qual: "normal" });
t("outro fluxo: a linha NOMEIA onde o patch foi escrito",
  /Agente eContrate/.test(l2) && /que é onde o patch foi escrito/.test(l2));
t("outro fluxo: o botão carrega `data-wf` do fluxo ESCRITO, não do aberto",
  /data-wf="w9"/.test(l2) && !/data-wf="w1"/.test(l2));
/* Um sub-fluxo pode não estar em `S.fluxos` (não chegou na porta). O nome sai do
   próprio estado do dossiê, que o servidor manda — sem isso a linha diria o id. */
t("outro fluxo fora da vitrine: o nome vem do estado do dossiê, não o id cru",
  !/«w9»/.test(l2));

S.dossie.delete("w9");
const l3 = api.linhaOfertaDossie({ wfId: "w9", em: "x", qual: "normal" });
t("estado não lido ainda: a linha existe e diz conferindo, sem botão",
  /[Cc]onferindo/.test(l3) && !/data-dossie/.test(l3));

S.dossie.set("w1", verde);
t("verde: a linha aparece e não oferece botão", !/data-dossie/.test(api.linhaOfertaDossie({ wfId: "w1" })));
t("sem `wfId` no recibo: linha nenhuma, em vez de uma oferta sobre nada",
  api.linhaOfertaDossie({ em: "x" }) === "" && api.linhaOfertaDossie(null) === "");

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 6 ] a fiação — medida em fonte SEM comentário");

const cartaoSrc = semComentario(pega("function cartao(f) {", "\nfunction linhaSeloDossie"));
t("o cartão da vitrine desenha o selo", cartaoSrc.includes("linhaSeloDossie(f)"));

const botSrc = semComentario(pega("function botaoDossie(d, wfId)", "\nfunction faixaDossie"));
t("o botão continua marcado por `data-dossie` e não por id",
  botSrc.includes('data-dossie="1"') && !botSrc.includes('id="dos-btn"'));
t("...e só emite `data-wf` quando alguém pede um alvo (os dois antigos caem em `S.sel`)",
  /wfId \?/.test(botSrc) && botSrc.includes('data-wf="'));

const delSrc = semComentario(pega("function ligarDelegacao() {", "\nasync function confirmarAlvo"));
t("a delegação lê o alvo de `data-wf` antes de cair em `S.sel`",
  delSrc.includes("dos.dataset.wf") && delSrc.indexOf("dos.dataset.wf") < delSrc.indexOf("S.sel"));
t("...e continua sendo UM ouvinte delegado, não um por render",
  delSrc.includes('closest("[data-dossie]")'));
/* Um sub-fluxo fora da vitrine não pode fazer o clique virar no-op silencioso: o
   nome sai do estado do dossiê quando `S.fluxos` não tem o fluxo. */
t("a delegação sabe achar um fluxo que não está em `S.fluxos`",
  delSrc.includes("S.dossie.get(") && delSrc.includes("escreverDossie(fx)"));

const apSrc = semComentario(pega("async function aplicarRemendo(qual) {", "\nasync function desfazerRemendo"));
t("aplicar releva o dossiê DEPOIS de escrever (senão a oferta fica em «conferindo» para sempre)",
  apSrc.includes("verDossie(") && apSrc.indexOf("/aplicar") < apSrc.indexOf("verDossie("));
t("...e o alvo da releitura é o fluxo escrito (`wfIdAlvo`), não só o aberto",
  /wfIdAlvo\b/.test(apSrc.slice(apSrc.indexOf("verDossie(") - 260, apSrc.indexOf("verDossie(") + 40)));

const dfSrc = semComentario(pega("async function desfazerRemendo() {", "\nasync function enviar()"));
t("desfazer também relê o dossiê (o fluxo voltou, a divergência pode ter sumido)",
  dfSrc.includes("verDossie("));
t("...e ele guarda o alvo ANTES do POST, porque desfazer zera `aplicado`",
  dfSrc.indexOf("aplicado.wfId") < dfSrc.indexOf("/desfazer"));

const vdSrc = semComentario(pega("async function verDossie(id, forcar) {", "\n/* A VARREDURA"));
t("a leitura de um fluxo alimenta TAMBÉM o mapa da vitrine (uma cor, duas telas)",
  vdSrc.includes("S.dossieVit.set("));

/* A ASSINATURA GANHOU `opcoes`, e o caso foi ATUALIZADO em vez de apagado: a
   garantia que ele protegia continua inteira (lotes de 40, falha marcada com
   `erro`) e o que mudou é que agora existe um chamador que NÃO pode escrever
   `S.dossieVitMeta` — o seletor de fluxo, que varre os 75 e não os 11 da grade. */
const varSrc = semComentario(pega("async function varrerDossies(ids, opcoes) {", "\n/* Peso e desenho"));
t("a varredura vai em lotes do tamanho do teto da rota", /i \+= 40/.test(varSrc));
t("um lote que falhou marca os ids com `erro`, nunca com cinza",
  varSrc.includes("erro: e.message") && !varSrc.includes('cor: "cinza"'));
t("a varredura só existe depois da primeira pintura (chamada dentro de `carregar`)",
  semComentario(pega("async function carregar() {", "\ndocument.getElementById(\"reload\")")).includes("varrerDossies(vivos)"));
/* VOLTAR PARA A VITRINE RECONFERE. A varredura de boot pode ter meia hora, e nesse
   meio tempo ele aplicou um patch, escreveu um dossiê ou editou um fluxo no n8n —
   as três mudam a cor. Sem isto os selos ficariam parados na foto do boot. */
const irSrc = semComentario(pega("function irPara(id) {", "\naddEventListener(\"popstate\""));
t("voltar para a vitrine reconfere os selos", irSrc.includes("varrerDossies("));

/* `meta` — A FRASE DA VITRINE FALA DOS CARTÕES DA GRADE, e por isso ela não pode
   ser alimentada por uma varredura de outra lista. `resumoDossieVitrine(vivos)` lê
   `S.dossieVitMeta.falhas` para dizer "N fluxo(s) não deu para conferir, então os
   números acima são piso": com os 75 fluxos escrevendo ali, aquela frase passaria a
   contar leituras de fluxos que não estão na tela — número certo sobre a pergunta
   errada, que é a forma de mentir que esta tela mais evita.
   O DEFAULT É ESCREVER: os dois chamadores antigos não passam nada e não mudaram de
   comportamento, e um default no outro sentido apagaria a frase em silêncio. */
t("`meta` é opcional e o default ESCREVE (os dois chamadores antigos não mudam)",
  /const comMeta = !opcoes \|\| opcoes\.meta !== false/.test(varSrc));
t("...e nada é escrito em `S.dossieVitMeta` quando o chamador pediu `meta: false`",
  /if \(comMeta\) S\.dossieVitMeta = /.test(varSrc));
/* O seletor é o chamador que precisa disso. Sem o `meta: false` no ponto de
   chamada, a asserção acima seria uma capacidade que ninguém usa. */
const selSrc = semComentario(pega("function abrirSeletor(origem) {", "\nfunction fecharSeletor()"));
t("o seletor varre os fluxos sem selo e pede `meta: false`",
  /varrerDossies\(semSelo, \{ meta: false \}\)/.test(selSrc));
/* Ele pede SÓ o que falta: os 11 da grade já vieram na varredura de boot, e
   repedi-los não está errado (a rota tem cache) — mas pedir apenas o que falta é o
   que faz a frase "conferindo o dossiê…" das 64 linhas ficar VERDADEIRA sem custo
   nenhum nas outras. */
t("...e só dos ids que ainda não têm selo",
  /filter\(id => !S\.dossieVit\.has\(id\)\)/.test(selSrc));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 7 ] o servidor emite FATO, e só o que o cartão precisa");

const srvSem = semComentario(srv);
t("a rota da varredura existe", srvSem.includes('p === "/api/upgrade/dossies"'));
t("...e valida id e teto como a rota do peso", /no máximo 40 ids por chamada/.test(srvSem));
/* `getRawWorkflow` é o buraco deliberado da whitelist. O que atravessa é cor,
   motivo e CONTAGEM — nunca a lista de nós, nunca um parâmetro, nunca credencial. */
const fatia = semComentario(srv.slice(srv.indexOf("function fatiaCor("), srv.indexOf("async function corDoDossie")));
t("a fatia que atravessa não leva a LISTA de nós, só as contagens",
  fatia.includes("quantosMudados") && !/\bmudados:/.test(fatia) && !/entraram:/.test(fatia));
t("...e nada de `nodes`, `parameters` ou `credentials` nela",
  !/nodes|parameters|credentials/.test(fatia));

const cor = semComentario(srv.slice(srv.indexOf("async function corDoDossie"), srv.indexOf("async function varrerDossies")));
t("a cor sai do `dossie.estado()`, nunca de uma segunda régua aqui", cor.includes("dossie.estado("));
/* SEM `.md` NENHUMA LEITURA DO N8N. `estado(null, wf)` responde cinza sem olhar o
   fluxo, e é isso que faz a varredura de 75 cartões custar duas leituras hoje. */
t("fluxo sem dossiê não custa leitura do n8n",
  cor.indexOf("dossie.ler(") < cor.indexOf("getRawWorkflow") && /if \(!doc\) return guardarCor/.test(cor));
/* Erro NÃO é cacheado: guardar 15 minutos de "não deu para ler" faria o painel
   continuar acusando um n8n que já voltou. */
t("erro de leitura não entra na cache (o throw sobe para quem conta a falha)",
  !cor.includes("catch"));

const est = semComentario(srv.slice(srv.indexOf("async function dossieEstado("), srv.indexOf("const server = http.createServer")));
t("a leitura de um fluxo escreve na MESMA cache que a varredura lê",
  est.includes("guardarCor("));
const ini = semComentario(srv.slice(srv.indexOf("function iniciarDossie("), srv.indexOf("async function dossieEstado(")));
t("terminada uma escrita, a cor velha é jogada fora", ini.includes("dossieCorCache.delete("));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 8 ] o preço cota o MODO que o clique vai usar");

/* O DEFEITO QUE ESTE BLOCO EXISTE PARA IMPEDIR, e ele é o único acoplamento que a
   paralelização deixou passar: `preco()` já distinguia os dois modos, com régua
   diferente em cada um, e a rota chamava sem modo — então caía no default
   `"inteiro"` e a oferta que promete "conserta só o que envelheceu" cotava a
   reescrita inteira. US$4,14 medidos no Iago contra um conserto de três parágrafos:
   um botão cotando um gasto e fazendo outro. Quanto menor é o parcial ninguém mediu,
   e é por isso que ele não pode sair da régua do outro modo.

   E O PREÇO DA PARCIAL É `null` HOJE — zero escritas incrementais medidas nesta
   máquina. Os dois jeitos de errar isso são simétricos e os dois estão pinados
   abaixo: renderizar `null` como zero (grátis, que ele não é) e renderizar `null`
   com o número do inteiro (o defeito original, agora escrito ao lado da promessa
   de que é parcial). */

const SELO_FALTA = "o dossiê não tem o selo `gateV` do portão de vazamento — foi escrito antes de o selo existir, e herdar parágrafo sem saber que portão o aprovou é confiar numa versão que nada identifica";
const incAdm = o => ({ admitido: true, porque: null, regenerar: 3, herdar: 176, umHop: 5, visao: true,
  preco: { usd: null, amostras: 0, modo: "incremental" }, ...(o || {}) });
const incNao = porque => ({ admitido: false, porque, regenerar: 0, herdar: 0, umHop: 0, visao: true, preco: null });

/* Laranja com a parcial admitida e SEM régua: é o estado real desta máquina no dia
   em que o primeiro dossiê ganhar o selo do portão. */
const aSemRegua = api.ofertaDossie({ ...lar, incremental: incAdm() }).frase;
t("parcial admitida: a frase é sobre consertar só o que envelheceu",
  /Consertar só o que envelheceu/.test(aSemRegua));
t("parcial admitida: nomeia quantos parágrafos e quantos são herdados",
  /3 parágrafo\(s\)/.test(aSemRegua) && /outros 176 são herdados/.test(aSemRegua));
t("parcial admitida: a `visão geral` é dita, porque ela vai SEMPRE",
  /visão geral/.test(aSemRegua));
/* `null` NÃO É ZERO. Este é o mutante que a tela mais facilmente esconde: `usd: 0`
   passa por qualquer checagem de "tem número" e sai `US$0,00`, que lê como grátis
   numa escrita que spawna uma sessão de minutos. */
t("sem régua parcial: diz que NÃO SABE o preço, e não escreve US$0,00",
  /ainda não sei quanto isso/.test(aSemRegua) && !/US\$0,00/.test(aSemRegua));
/* `null` TAMBÉM NÃO É O NÚMERO DO INTEIRO. O número do inteiro pode aparecer — ele
   é útil como comparação —, mas só dentro de uma oração que diga que ele é do
   inteiro. Solto, ele volta a ser o defeito original com a frase da parcial em
   volta, que é pior que o defeito original. */
t("sem régua parcial: o número do inteiro só aparece rotulado como do INTEIRO",
  /Para comparação: (Ainda não sei o preço de reescrever o dossiê inteiro|Reescrever o dossiê inteiro deve custar cerca de US\$4,14)/.test(aSemRegua));
t("...e a frase da parcial nunca apresenta o número do inteiro como o preço dela",
  !/Consertar só o que envelheceu reescreve [^.]*US\$4,14/.test(aSemRegua));

/* Com régua parcial existindo, o número do inteiro SAI: dois preços na mesma frase,
   um deles o do trabalho que não vai acontecer, é a leitura que faz alguém somar os
   dois ou pegar o maior. */
const aComRegua = api.ofertaDossie({ ...lar, incremental: incAdm({ preco: { usd: 0.12, amostras: 2, modo: "incremental" } }) }).frase;
t("com régua parcial: mostra o preço da PARCIAL e diz que a mediana é de parciais",
  /US\$0,12/.test(aComRegua) && /mediana das 2 escritas parciais já medidas/.test(aComRegua));
t("com régua parcial: o preço do inteiro não aparece junto", !/US\$4,14/.test(aComRegua));

/* Zero parágrafos de nó com a parcial admitida é escrita LEGÍTIMA — `visaoSuspeita`
   sozinho. "0 parágrafo(s)" leria como "nada a fazer" ao lado de um botão que gasta. */
const aVisao = api.ofertaDossie({ ...lar, incremental: incAdm({ regenerar: 0, herdar: 179 }) }).frase;
t("zero parágrafos de nó: diz «só a visão geral», nunca «0 parágrafo»",
  /só a <strong>visão geral<\/strong>/.test(aVisao) && !/0 parágrafo/.test(aVisao));

/* A RECUSA. Hoje ela é o caso REAL: os dois `.md` em disco não têm o selo `gateV`,
   então nenhum dos dois pode ser herdado até uma reescrita inteira. É consequência
   intencional do selo, e sem esta frase na tela lê como defeito nosso. */
const aNao = api.ofertaDossie({ ...lar, incremental: incNao(SELO_FALTA) }).frase;
t("parcial recusada: NÃO afirma que vai consertar só o que envelheceu",
  !/Consertar só o que envelheceu/.test(aNao));
t("parcial recusada: nomeia o motivo que o servidor mediu (o selo do portão)",
  /gateV/.test(aNao) && /Não dá para consertar só os parágrafos velhos/.test(aNao));
t("parcial recusada: cota o INTEIRO, porque é o que vai acontecer de fato",
  /US\$4,14/.test(aNao) && /reescreve o dossiê inteiro/.test(aNao));
t("parcial recusada: diz a saída — é a reescrita inteira que libera a parcial",
  /deixa o conserto parcial disponível da próxima vez/.test(aNao));
t("motivo da recusa é escapado (ele vem do servidor)",
  !/<img/.test(api.ofertaDossie({ ...lar, incremental: incNao('<img src=x onerror="alert(1)">') }).frase));

/* TERCEIRO ESTADO, sexta vez que este repositório escreve isto: campo AUSENTE é o
   processo velho respondendo, e ele não cai no ramo negativo NEM no positivo. */
const aAusente = api.ofertaDossie(lar).frase;
t("campo ausente: não afirma que dá para consertar só o que envelheceu",
  !/Consertar só o que envelheceu/.test(aAusente));
t("campo ausente: e também não afirma que NÃO dá — diz que não sabe",
  !/Não dá para consertar/.test(aAusente) && /Não sei se dá para consertar/.test(aAusente));
t("campo ausente: culpa o processo velho, não o dossiê dele",
  /subiu antes desta versão do servidor/.test(aAusente));
t("campo ausente: cota o inteiro, que é o que aquele servidor sabe fazer",
  /US\$4,14/.test(aAusente));
t("as três frases de preço são distintas entre si",
  new Set([aSemRegua, aNao, aAusente]).size === 3);

/* O BOTÃO. Ele dizia "atualizar dossiê" com o preço do inteiro sempre — três
   parágrafos e 179 liam igual, pelo mesmo número. */
const bAdm = api.botaoDossie({ ...lar, incremental: incAdm({ preco: { usd: 0.12, amostras: 2 } }) });
t("botão com parcial admitida: diz «só o que envelheceu» e o preço da parcial",
  /só o que envelheceu/.test(bAdm) && /US\$0,12/.test(bAdm) && !/US\$4,14/.test(bAdm));
const bNao = api.botaoDossie({ ...lar, incremental: incNao(SELO_FALTA) });
t("botão com parcial recusada: diz que REESCREVE INTEIRO, e cota o inteiro",
  /reescreve inteiro/.test(bNao) && /US\$4,14/.test(bNao));
t("botão com o campo ausente: cai no inteiro, nunca promete parcial",
  /reescreve inteiro/.test(api.botaoDossie(lar)) && !/só o que envelheceu/.test(api.botaoDossie(lar)));
/* MEDIDO NO ESTADO REAL: verde tem `regenerar` 0, e o botão dizia «só o que
   envelheceu» sobre um dossiê onde nada envelheceu. */
t("botão em VERDE com a parcial admitida: diz que reescreve inteiro, nunca «só o que envelheceu»",
  /reescreve inteiro/.test(api.botaoDossie({ ...verde, incremental: incAdm({ regenerar: 0, herdar: 179 }) }))
  && !/só o que envelheceu/.test(api.botaoDossie({ ...verde, incremental: incAdm({ regenerar: 0, herdar: 179 }) })));
t("botão sem régua nenhuma: diz «preço não medido» em vez de um span vazio",
  /preço não medido/.test(api.botaoDossie({ ...lar, preco: {}, incremental: incAdm() })));
t("o rótulo continua distinguindo escrever de atualizar (pinado no dossie-tela-test)",
  /↻ atualizar dossiê/.test(bAdm) && /✎ escrever dossiê/.test(api.botaoDossie({ ...cinza, incremental: incNao("x") })));
/* O alvo do §4.5 continua no botão: o patch pode ter ido para um sub-fluxo, e sem
   `data-wf` o clique escreveria o dossiê do fluxo ABERTO — pago, minutos, calado. */
S.dossie.set("w9", { ...lar, id: "w9", nome: "Agente eContrate", incremental: incAdm() });
t("com o modo no botão, `data-wf` do fluxo escrito continua lá",
  /data-wf="w9"/.test(api.linhaOfertaDossie({ wfId: "w9", em: "x" })));
S.dossie.delete("w9");

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 9 ] a fiação do modo — do fato do servidor até o POST");

const estSrc2 = semComentario(srv.slice(srv.indexOf("async function dossieEstado("), srv.indexOf("const server = http.createServer")));
/* O MUTANTE PRINCIPAL: `preco(nos)` sem modo. A assinatura tem default `"inteiro"`,
   então a chamada sem modo COMPILA, RESPONDE 200 e mente no número. */
t("a rota cota o inteiro com o modo EXPLÍCITO, nunca pelo default da assinatura",
  /dossie\.preco\(nos, "inteiro"\)/.test(estSrc2));
t("...e emite a fatia do incremental como fato próprio", estSrc2.includes("fatiaIncremental("));

const fiSrc = semComentario(srv.slice(srv.indexOf("async function fatiaIncremental("), srv.indexOf("async function dossieEstado(")));
t("o veredito sai da `planoIncremental`, nunca de uma segunda régua no servidor",
  fiSrc.includes("dossie.planoIncremental("));
t("o preço da parcial é cotado no modo `incremental`",
  /dossie\.preco\(.*"incremental"\)/.test(fiSrc));
/* A régua do incremental divide por `nosRegenerados`, que conta parágrafo de NÓ e
   não a visão. Uma escrita de visão-só tem `regenerar` 0, e `mediana × 0` sairia
   US$0,00 num botão que gasta uma sessão. Zero lê como grátis. */
t("...com piso de um parágrafo, senão uma escrita de visão-só sairia US$0,00",
  /Math\.max\(1, plano\.regenerar\.length\)/.test(fiSrc));
t("o que atravessa é CONTAGEM, nunca a lista de nós",
  fiSrc.includes("plano.regenerar.length") && fiSrc.includes("plano.herdar.length")
  && !/regenerar: plano\.regenerar,/.test(fiSrc) && !/herdar: plano\.herdar,/.test(fiSrc));
t("recusa também é fato: `admitido` false com o motivo medido",
  /admitido: false/.test(fiSrc) && /porque: String\(plano\.porque/.test(fiSrc));

const iniSrc2 = semComentario(srv.slice(srv.indexOf("function iniciarDossie("), srv.indexOf("async function fatiaIncremental(")));
t("`iniciarDossie` repassa o pedido de escrita parcial para o `construir`",
  /construir\(wfId, \{ incremental/.test(iniSrc2));
const resSrc = semComentario(srv.slice(srv.indexOf("function dossieResumo()"), srv.indexOf("O SEMÁFORO DE UM FLUXO")));
t("o job publica `modoPedido`, não `modo`: pedir parcial não prova que ela aconteceu",
  resSrc.includes("modoPedido") && !/\bmodo,/.test(resSrc));

const postSrc = semComentario(srv.slice(srv.indexOf('if (p.startsWith("/api/upgrade/dossie/"))'), srv.indexOf('if (p === "/api/n8n/overview")')));
t("o POST só faz escrita parcial se ela foi PEDIDA", /searchParams\.get\("incremental"\) === "1"/.test(postSrc)
  && /if \(parcial\) \{/.test(postSrc));
/* A QUEDA SILENCIOSA É O DEFEITO: `construir` cai para rewrite inteiro de graça e
   DIZ por quê — contrato certo para o CLI, onde quem pediu está lendo a linha e
   pode parar. Pelo botão não: o consentimento foi dado sobre a cotação parcial, e
   cair para o inteiro gastaria os US$4,14 medidos sem um segundo clique. */
t("...e recusa com 409 se a admissão caiu entre a leitura e o clique, em vez de cair para o inteiro",
  /a escrita parcial já não vale/.test(postSrc) && /409/.test(postSrc)
  && postSrc.indexOf("planoIncremental") < postSrc.indexOf("iniciarDossie("));

const escSrc = semComentario(pega("async function escreverDossie(f) {", "\n/* Peso e desenho"));
t("o clique manda `?incremental=1` e só no modo que o botão prometeu",
  /\(parcial \? "\?incremental=1" : ""\)/.test(escSrc) && /modoDoClique\(d\) === "incremental"/.test(escSrc));
/* UM LUGAR SÓ decide o modo: botão, diálogo e frase do preço têm de concordar, e
   três leituras do mesmo fato divergem no primeiro ajuste feito num lado só — a que
   divergisse cotaria um gasto e faria outro. */
const modoSrc = semComentario(pega("function modoDoClique(d) {", "\nfunction fraseDoPreco"));
t("o modo do clique é decidido numa função só, e ela é gated no `admitido` do servidor",
  /!d\.incremental \|\| !d\.incremental\.admitido/.test(modoSrc) && /return "inteiro"/.test(modoSrc));
/* Visto no estado REAL antes de ser escrito: um dossiê em dia tem `regenerar` 0, e
   o botão dizia «só o que envelheceu» sobre um dossiê onde nada envelheceu. Quem
   clica em atualizar um dossiê verde quer a prosa RE-DERIVADA, que é a única coisa
   que a herança não faz. */
t("...e VERDE vai de inteiro mesmo com a parcial admitida", /d\.cor === "verde"/.test(modoSrc));
t("o botão do dossiê lê o modo da mesma função", /modoDoClique\(d\) === "incremental"/.test(botSrc));
t("o diálogo cota o preço do modo que vai rodar, não sempre o do inteiro",
  /parcial \? d\.incremental\.preco : d\.preco/.test(escSrc));
/* O que a parcial compra de menos tem de estar no diálogo, não só no `.md`: a
   impressão digital prova que o nó não mudou, nunca que a prosa sobre ele segue
   verdadeira depois que um vizinho mudou. */
t("...e declara o que herança NÃO prova, antes do gasto",
  /nunca que a frase sobre ele segue verdadeira/.test(escSrc));

console.log(bad ? "\nFALHOU: " + bad + " de " + (ok + bad) : "\npassou: " + ok + " casos");
process.exit(bad ? 1 : 0);
