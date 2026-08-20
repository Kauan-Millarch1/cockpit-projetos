"use strict";
/* auto-dossie-test.js — a atualização AUTOMÁTICA do dossiê depois de aplicar.
 *
 * O QUE ELA É: decisão explícita do Kauan. O §2.8 do `PLAN-UPGRADE.md` diz que nada
 * regenera sozinho, e o §2.3.1 nomeia GASTO INVISÍVEL como o risco desta aba; ele
 * pediu que o dossiê fique em dia sozinho, ouviu a ressalva e reafirmou. Este
 * arquivo não relitiga isso — ele prova o desenho que separa a decisão dele de uma
 * armadilha, e cada caso recusa um defeito com nome.
 *
 * OS DOIS DEFEITOS QUE CARREGAM O ARQUIVO, e eles apontam para lados opostos:
 *
 *   1. GASTO SURPRESA. A escrita inteira do Iago foi US$4,14 e 682s MEDIDOS. O
 *      automático é incremental e, no padrão, herança recusada NÃO gasta. Chave
 *      ausente e chave com valor desconhecido caem no PADRÃO SEGURO — nunca no mais
 *      caro. Aqui o "ramo negativo" que esta casa já pagou seis vezes é o dinheiro.
 *
 *   2. FINAL SILENCIOSO. Um dossiê que ele ACREDITA fresco e está velho é pior que
 *      um que ele sabe velho: a conversa seguinte remenda a partir de descrição
 *      errada com o semáforo dizendo verde. Todo desfecho — escreveu, pulou, tentou
 *      e não conseguiu — tem de chegar à tela e ao ledger.
 *
 * DE GRAÇA E SEM REDE. O veredito (`decidirAuto`) e o parse da chave (`modoAuto`)
 * são PUROS, pelo mesmo motivo de `admitirIncremental` e `resolverAlvo`: um veredito
 * que gasta dinheiro sozinho tem de ser provável sem rede, sem modelo e sem servidor
 * de pé. O juízo da tela é EXTRAÍDO do `upgrade.html` em tempo de execução —
 * reimplementá-lo aqui provaria a cópia, e não a tela (a disciplina do
 * `audio-test.js`). A fiação do servidor é lida no FONTE, medida sem comentário,
 * porque o que ela tem de provar é a ORDEM e as AUSÊNCIAS — que nenhum estado
 * otimista é escrito e que a resposta do apply não espera.
 *
 * `construir()` NÃO é chamado em nenhum caso. Ele custa dinheiro e ~11 minutos, e
 * escreve.
 *
 *   node auto-dossie-test.js
 */
const fs = require("fs");
const path = require("path");

const REPO = __dirname;
const dossie = require(path.join(REPO, "dossie.js"));

let ok = 0, bad = 0;
const t = (n, c, x) => {
  if (c) { ok++; console.log("  ok    " + n); }
  else { bad++; console.log("  FALHOU " + n + (x ? "\n          " + x : "")); }
};

/* Comentário é onde uma decisão é DOCUMENTADA, nunca onde ela é implementada. Um
   `includes` que casa dentro de um comentário aprova, no melhor caso, a documentação
   da decisão — e no pior, a ausência dela. Este arquivo já pagou isso no
   `dossie-tela-test.js`, onde apagar uma guarda inteira deixou dois casos verdes
   porque o comentário acima dela citava o nome da função. */
const semComentario = s => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const H = fs.readFileSync(path.join(REPO, "upgrade.html"), "utf8");
const pega = (de, ate) => {
  const i = H.indexOf(de);
  if (i < 0) throw new Error("não achei `" + de + "` no upgrade.html — a tela mudou de forma");
  const j = H.indexOf(ate, i);
  if (j < 0) throw new Error("não achei o fim do bloco a partir de `" + de + "`");
  return H.slice(i, j);
};

/* ═════════════ 1. A CHAVE: TRÊS VALORES, E O AUSENTE É O BARATO ════════════ */

console.log("\n[ 1 ] `COCKPIT_DOSSIE_AUTO` — três valores explícitos, nunca um booleano");

const m = v => dossie.modoAuto(v);

t("`off` desliga", m("off").modo === "off" && m("off").reconhecido === true);
t("`incremental` é o modo parcial", m("incremental").modo === "incremental");
t("`sempre` é o único que autoriza o rewrite inteiro", m("sempre").modo === "sempre");

/* O DEFEITO: um booleano teria de escolher entre "só o barato" e "em dia a qualquer
   preço" em silêncio, e as duas leituras custam diferente em DINHEIRO. Os três
   valores existem para essa escolha não ficar implícita. */
t("são exatamente três modos possíveis",
  new Set(["off", "incremental", "sempre"].map(v => m(v).modo)).size === 3);

/* AUSENTE NÃO CAI NO RAMO NEGATIVO — e aqui o negativo perigoso é o GASTO. Um
   `undefined` que caísse em `sempre` gastaria US$4,14 por apply sem ninguém pedir. */
t("chave AUSENTE cai no padrão, que é o incremental", m(undefined).modo === "incremental");
t("...e o padrão NUNCA é `sempre`", m(undefined).modo !== "sempre" && m(null).modo !== "sempre"
  && m("").modo !== "sempre");
t("string vazia é o mesmo que ausente", m("").modo === "incremental");
t("...e ausente é declarado como reconhecido, com `bruto` nulo",
  m(undefined).reconhecido === true && m(undefined).bruto === null);

/* VALOR DESCONHECIDO TAMBÉM CAI NO BARATO, e é dito em voz alta: cair no padrão em
   silêncio faria a configuração dele não existir, e o padrão é o barato — então o
   silêncio esconderia justamente a diferença que custa. */
for (const lixo of ["semrpe", "1", "true", "sim", "inteiro", "SEMPRE!", "on"]) {
  t("valor `" + lixo + "` não vira `sempre`", m(lixo).modo !== "sempre");
}
t("um valor desconhecido é marcado como NÃO reconhecido", m("semrpe").reconhecido === false);
t("...e o bruto viaja para a tela poder dizer que ignorou", m("semrpe").bruto === "semrpe");
t("`SEMPRE` maiúsculo é o mesmo valor (a chave não é case-sensitive)", m("SEMPRE").modo === "sempre");
t("espaço em volta não muda nada", m("  off  ").modo === "off");
/* `0` e `nao` são o desligado que qualquer um escreveria por hábito, e desligar é
   o lado seguro — reconhecê-los não abre nenhum gasto. */
t("`0` desliga", m("0").modo === "off");
t("o processo leu a chave uma vez e a expõe", dossie.AUTO && typeof dossie.AUTO.modo === "string");

/* ══════════════════════ 2. O VEREDITO, RAMO POR RAMO ══════════════════════ */

console.log("\n[ 2 ] `decidirAuto` — quando roda, em que modo, e por quê");

const AUTO_OFF = { modo: "off", bruto: "off", reconhecido: true };
const AUTO_INC = { modo: "incremental", bruto: null, reconhecido: true };
const AUTO_SEMPRE = { modo: "sempre", bruto: "sempre", reconhecido: true };

/* Um dossiê HERDÁVEL: selo do portão presente, parágrafos com geração nova. O
   `admitirIncremental` real é quem julga — um dublê aqui provaria o dublê. */
const docBom = () => ({
  gateV: dossie.GATE_V, em: "2026-08-18T16:44:33.291Z",
  paragrafos: [{ no: "a", fp: "1", texto: "x", de: "2026-08-18T16:44:33.291Z", g: 0, umHop: false }]
});
const docSemSelo = () => ({ em: "x", paragrafos: [{ no: "a", fp: "1", texto: "x", g: 0 }] });
const st = (cor, extra) => Object.assign({ cor, motivo: cor, mudados: [], entraram: [], sairam: [], visaoSuspeita: false }, extra || {});

const d = o => dossie.decidirAuto(o);

// desligado
const off = d({ auto: AUTO_OFF, dossie: docBom(), st: st("laranja", { mudados: ["a"] }) });
t("`off` não roda nada", off.rodar === false && off.razao === "desligado");
t("...e a frase nomeia a chave", /COCKPIT_DOSSIE_AUTO/.test(off.porque));

// o padrão: incremental quando a herança é admitida
const inc = d({ auto: AUTO_INC, dossie: docBom(), st: st("laranja", { mudados: ["a"] }) });
t("laranja com selo: roda, e roda INCREMENTAL", inc.rodar === true && inc.incremental === true);
t("...e o modo declarado é `incremental`", inc.razao === "incremental");

/* O CASO QUE CARREGA O DESENHO: herança recusada NÃO GASTA no padrão. Cair para o
   rewrite inteiro aqui é a conta que ninguém autorizou — US$4,14 medidos. */
const recusa = d({ auto: AUTO_INC, dossie: docSemSelo(), st: st("laranja", { mudados: ["a"] }) });
t("sem o selo `gateV`, o PADRÃO não gasta", recusa.rodar === false && recusa.razao === "naoadmitido");
t("...e o motivo do `admitirIncremental` viaja inteiro na frase", /gateV/.test(recusa.porque));
t("...e a frase diz que o inteiro é gasto de outra ordem", /outra ordem/.test(recusa.porque));

const verm = d({ auto: AUTO_INC, dossie: docBom(), st: st("vermelho", { entraram: ["b"] }) });
t("vermelho: o padrão NÃO gasta", verm.rodar === false && verm.razao === "naoadmitido");
t("...e o motivo cita que só herda de verde ou laranja", /verde ou laranja/.test(verm.porque));

/* `sempre` é o único que autoriza o caro, e ele diz de onde vem a autorização. */
const semp = d({ auto: AUTO_SEMPRE, dossie: docBom(), st: st("vermelho", { entraram: ["b"] }) });
t("`sempre`: vermelho vira rewrite INTEIRO", semp.rodar === true && semp.incremental === false);
t("...e o veredito é rotulado `inteiro`", semp.razao === "inteiro");
t("...e a frase nomeia a chave que autorizou o gasto", /sempre/.test(semp.porque));
/* `sempre` NÃO troca a parcial pelo inteiro quando a parcial vale: em dia a
   qualquer preço não é "sempre o mais caro". */
const sempOk = d({ auto: AUTO_SEMPRE, dossie: docBom(), st: st("laranja", { mudados: ["a"] }) });
t("`sempre` ainda prefere a parcial quando ela vale", sempOk.incremental === true);

// verde: nada envelheceu, então nada é gasto — em NENHUM modo
for (const [nome, a] of [["incremental", AUTO_INC], ["sempre", AUTO_SEMPRE]]) {
  const v = d({ auto: a, dossie: docBom(), st: st("verde") });
  t("verde em modo `" + nome + "`: não gasta", v.rodar === false && v.razao === "emdia");
}

/* CINZA É PULADO EM TODO MODO, INCLUSIVE `sempre`. Ele pediu o dossiê EM DIA, e não
   existe pôr em dia o que nunca foi escrito: a primeira escrita de um fluxo é uma
   decisão de outro tamanho e não é consequência deste patch. É a mesma linha que a
   oferta do recibo já dá para o cinza. */
for (const [nome, a] of [["incremental", AUTO_INC], ["sempre", AUTO_SEMPRE]]) {
  const c = d({ auto: a, dossie: null, st: st("cinza") });
  t("sem dossiê em modo `" + nome + "`: não escreve o primeiro sozinho",
    c.rodar === false && c.razao === "semdossie");
}
t("...e a frase diz que escrever o primeiro continua sendo um clique",
  /clique/.test(d({ auto: AUTO_SEMPRE, dossie: null, st: st("cinza") }).porque));

/* Estado ausente FALHA FECHADO no gasto. "Não sei medir a divergência" e "está em
   dia" levam a decisões opostas, e gastar sobre um estado que não se conhece é o
   oposto de consentimento informado. */
const semSt = d({ auto: AUTO_INC, dossie: docBom(), st: null });
t("sem estado medido: não gasta", semSt.rodar === false && semSt.razao === "semestado");

/* Cor desconhecida cai na admissão, que a recusa por não ser herdável — nunca em
   "verde" e nunca num rewrite silencioso. */
const roxo = d({ auto: AUTO_SEMPRE, dossie: docBom(), st: st("roxo") });
t("cor desconhecida com `sempre`: vai de inteiro, declarado", roxo.razao === "inteiro");
t("...e com o padrão, não gasta", d({ auto: AUTO_INC, dossie: docBom(), st: st("roxo") }).rodar === false);

/* ═══════════ 3. CONCORRÊNCIA: AS TRAVAS QUE JÁ EXISTEM, RESPEITADAS ═══════ */

console.log("\n[ 3 ] dois applies seguidos — pulado, nunca sucesso e nunca erro feio");

/* O DEFEITO: um segundo apply no mesmo fluxo contado como sucesso. Duas escritas do
   mesmo fluxo pisam a pasta uma da outra (a trava por fluxo do `dossie.js` existe
   por isso e RECUSA em vez de enfileirar), e o processo já só admite uma por vez. */
const oc = d({ auto: AUTO_INC, dossie: docBom(), st: st("laranja", { mudados: ["a"] }),
  ocupadoPor: "deste mesmo fluxo" });
t("com uma escrita rodando: PULADO, não roda", oc.rodar === false && oc.razao === "ocupado");
t("...e a frase diz que já tem uma escrita rodando", /escrita de dossiê rodando/.test(oc.porque));
t("...e ela não é um erro: o veredito é `ocupado`, distinto de `naoadmitido`",
  oc.razao !== "naoadmitido" && oc.razao !== "quebrou");

const tr = d({ auto: AUTO_INC, dossie: docBom(), st: st("laranja", { mudados: ["a"] }),
  travadoPor: "2026-08-20T10:00:00.000Z" });
t("a trava POR FLUXO também pula", tr.rodar === false && tr.razao === "ocupado");
t("...e a frase diz desde quando", /2026-08-20T10:00:00.000Z/.test(tr.porque));

/* A ORDEM DOS RAMOS É O PRÓPRIO VEREDITO: `ocupado` vem ANTES dos estados do
   dossiê. Se viesse depois, um segundo apply num dossiê que virou vermelho sairia
   como "não admitido" — motivo errado, e o certo (já tem uma rodando) perdido. */
const ocVerm = d({ auto: AUTO_SEMPRE, dossie: docBom(), st: st("vermelho", { entraram: ["b"] }),
  ocupadoPor: "do fluxo X" });
t("ocupado vence a admissão, mesmo em `sempre`", ocVerm.rodar === false && ocVerm.razao === "ocupado");
/* E `off` vence tudo: é de graça e não depende de nada. */
t("desligado vence até o ocupado",
  d({ auto: AUTO_OFF, dossie: docBom(), st: st("laranja"), ocupadoPor: "x" }).razao === "desligado");

/* As duas travas são CONSULTADAS, não duplicadas. Ambas continuam morando onde
   moravam, e o `donoDoDossie` segue sendo a rede depois da consulta. */
const srvBruto = fs.readFileSync(path.join(REPO, "server.js"), "utf8");
const gat = semComentario(pega0(srvBruto, "async function dossieDepoisDeAplicar(wfId)", "\n/* A ESCRITA PARCIAL, COMO FATO"));
function pega0(txt, de, ate) {
  const i = txt.indexOf(de);
  if (i < 0) throw new Error("não achei `" + de + "` no server.js");
  const j = txt.indexOf(ate, i);
  return txt.slice(i, j < 0 ? txt.length : j);
}
t("o gatilho consulta a trava por PROCESSO (`dossieJob`)", /dossieJob && dossieJob\.escrevendo/.test(gat));
t("...e a trava por FLUXO (`donoDoDossie`)", /dossie\.donoDoDossie\(/.test(gat));
t("...e não reimplementa nenhuma das duas", !/travasFluxo/.test(gat) && !/new Map\(/.test(gat));

/* ══════ 4. A FIAÇÃO NO SERVIDOR: A ORDEM, E AS AUSÊNCIAS QUE IMPORTAM ═════ */

console.log("\n[ 4 ] o gatilho no servidor — não bloqueia, não afirma cor, não joga");

/* O DEFEITO: o automático bloqueando a resposta do apply. Uma escrita leva ~11
   minutos medidos e a leitura do estado leva uma ida ao n8n; a rota responde na hora
   e a tela acompanha, igual ao botão manual já faz. */
const rota = semComentario(pega0(srvBruto, 'if (acao === "aplicar" && req.method === "POST")', 'if (acao === "desfazer"'));
t("a rota chama o gatilho SEM `await`", /\n\s*if \(escrito\) dossieDepoisDeAplicar\(escrito\);/.test(rota));
t("...e nenhuma forma de espera aparece no caminho dele",
  !/await dossieDepoisDeAplicar/.test(rota) && !/dossieDepoisDeAplicar\([^)]*\)\s*\.then/.test(rota));
t("...e o `json(res, 200, r)` vem DEPOIS de o gatilho ter sido disparado",
  rota.indexOf("dossieDepoisDeAplicar(escrito)") < rota.indexOf("json(res, 200, r)"));
/* O ALVO É O FLUXO ESCRITO, NÃO O ABERTO: por causa do §4.5 o patch pode ter ido
   para um sub-fluxo, e o dossiê que envelheceu é o de lá. Ler o fluxo aberto
   escreveria o dossiê errado — pago, e em silêncio. */
t("o alvo vem do `aplicado.wfId`, que é o fluxo REALMENTE escrito",
  /const escrito = r\.aplicado && r\.aplicado\.wfId/.test(rota));
t("...e não do fluxo aberto na tela", !/S\.sel/.test(rota) && !/r\.wfId\b/.test(rota));
/* O gatilho só dispara em SUCESSO. Um apply que falhou não envelheceu nada, e
   gastar por causa dele seria gasto sem efeito. */
t("um apply que falhou retorna antes do gatilho",
  rota.indexOf("if (r && r.erro) return json") < rota.indexOf("dossieDepoisDeAplicar"));

/* O DEFEITO: o automático marcando estado OTIMISTA. O semáforo é a rede final —
   dê no que der, `estado()` continua medindo a divergência real contra o fluxo vivo.
   Um automático que gravasse "em dia" por ter TENTADO seria o dossiê falso-fresco
   que este desenho existe para impedir, agora escrito por nós. */
t("o gatilho APAGA a cor em cache", /dossieCorCache\.delete\(/.test(gat));
t("...e NUNCA escreve uma cor", !/guardarCor\(/.test(gat) && !/fatiaCor\(/.test(gat));
t("...e a cor que ele lê vem do `dossie.estado`, medindo", /dossie\.estado\(doc, raw\)/.test(gat));

/* O DEFEITO: uma rejeição sem dono derrubando o processo que serve o cockpit por
   causa de uma leitura de dossiê, num caminho que ninguém está esperando. */
t("o gatilho é todo dentro de um `try`, e o `catch` anota", /catch \(e\) \{[\s\S]*anotarAuto\(/.test(gat));
t("...e todo final sai como linha anotada", (gat.match(/anotarAuto\(/g) || []).length >= 3);
t("o wfId é validado antes de qualquer coisa", /\^\[A-Za-z0-9_-\]\{1,64\}\$/.test(gat));

/* ═════════════ 5. O DESFECHO NÃO PODE MORAR SÓ NO `dossieJob` ═════════════ */

console.log("\n[ 5 ] o registro por fluxo — o `dossieJob` é singleton, o desfecho não pode ser");

const ini = semComentario(pega0(srvBruto, "function iniciarDossie(wfId,", "\n/* ─────────── O DESFECHO"));
t("o começo do automático é anotado", /anotarAuto\(wfId, \{ estado: "correndo"/.test(ini));
/* A ASSERÇÃO OLHA A GUARDA, NÃO A STRING. A primeira versão testava só
   `/estado: "escreveu"/`, e um mutante que trocou a guarda por `if (false)` passou
   VERDE com o texto intacto no fonte: a anotação existia e era inalcançável. Um
   teste que casa a presença de um literal aprova a intenção, nunca o caminho. */
t("...o sucesso também, e sob a guarda do automático",
  /if \(automatico\) \{\s*anotarAuto\(wfId, r\.ok/.test(ini) && /estado: "escreveu"/.test(ini));
t("...e a reprovação nos portões também", /estado: "falhou", razao: "reprovou"/.test(ini));
/* A trava por fluxo recusa com 409 e a recusa chega COMO EXCEÇÃO — sem esta linha
   ela sairia da tela como silêncio, que é o defeito nº 2 deste arquivo. */
t("...e a exceção do `construir` (a trava com 409) também",
  /\.catch\(e => \{[\s\S]{0,400}if \(automatico\) \{\s*anotarAuto\(wfId/.test(ini));
/* TRÊS anotações, TRÊS guardas: começou, terminou, quebrou. O número exato é o que
   pega a guarda desligada de um dos três — `>= 2` deixava passar. */
t("nada disso acontece quando a escrita foi CLICADA",
  (ini.match(/if \(automatico\)/g) || []).length === 3);
t("o `automatico` é repassado ao `construir`, para virar linha no ledger",
  /dossie\.construir\(wfId, \{ incremental, automatico,/.test(ini));

const fat = semComentario(pega0(srvBruto, "function fatiaAuto(wfId)", "\n/* O GATILHO"));
t("a fatia declara que ESTE processo suporta o campo", /suportado: true/.test(fat));
t("...e manda o modo em que o processo subiu", /modo: dossie\.AUTO\.modo/.test(fat));
t("...e `ultimo` é NULO quando não há tentativa, nunca omitido",
  /ultimo: autoUltimo\.get\(String\(wfId\)\) \|\| null/.test(fat));

const est = semComentario(pega0(srvBruto, "async function dossieEstado(wfId)", "\nconst server = http"));
t("o estado do dossiê carrega a fatia do automático", /auto: fatiaAuto\(wfId\)/.test(est));

/* ═══════════════ 6. O LEDGER DISTINGUE AUTOMÁTICO DE CLICADO ══════════════ */

console.log("\n[ 6 ] `dossies.json` — a única resposta para «quanto o automático custou»");

/* O DEFEITO: um ledger que não distingue. `dossies.json` é o único lugar onde o
   gasto recorrente desta aba existe (o `.md` é gitignored) e não regenera de API
   nenhuma. Sem o campo, "quanto o automático está me custando por semana" — que é a
   pergunta que um gasto que dispara sozinho cria — não tem resposta. */
t("`autoDe` reconhece a linha automática", dossie.autoDe({ automatico: true }) === true);
t("...e a clicada", dossie.autoDe({ automatico: false }) === false);
/* AUSENTE É CLICADO, e não é default preguiçoso: as três linhas que existem em
   `dossies.json` são factualmente de clique. Mesma disciplina do `modoDe` e do
   `kindOf(p) = p.kind || "fix"` no ledger das propostas. */
t("AUSENTE é clicado, nunca automático", dossie.autoDe({}) === false && dossie.autoDe({ modo: "inteiro" }) === false);
t("...e lixo no campo não vira automático",
  dossie.autoDe({ automatico: "sim" }) === false && dossie.autoDe({ automatico: 1 }) === false);
t("nulo e undefined não explodem", dossie.autoDe(null) === false && dossie.autoDe(undefined) === false);

const dsrc = fs.readFileSync(path.join(REPO, "dossie.js"), "utf8");
const dLimpo = semComentario(dsrc);
t("a linha de sucesso grava `automatico`", /modo, automatico: !!automatico, rodadas: rodada/.test(dLimpo));
t("...e a linha da tentativa que FALHA também", /modo, automatico: !!automatico, rodadas: custos\.length/.test(dLimpo));
/* `preco()` NÃO filtra por origem: automático e clicado fazem o MESMO trabalho, e a
   régua é o `modo`. Filtrar também por origem dividiria a amostra em duas por um
   fato que não afeta o custo — e este arquivo já demorou a ter duas medições de um
   modo só. */
const precoSrc = semComentario(pega0(dsrc, "async function preco(nos, modo", "\n/* ═════"));
t("`preco` filtra por `modo` e NÃO por origem",
  /modoDe\(d\) === modo/.test(precoSrc) && !/autoDe\(/.test(precoSrc));

/* ═══════════════════ 7. A TELA DIZ TODOS OS DESFECHOS ═════════════════════ */

console.log("\n[ 7 ] a tela — nenhum final em silêncio, e o vermelho amarra as duas coisas");

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usdTxt = v => "US$" + v.toFixed(2).replace(".", ",");
const S = { dossie: new Map() };
const srcTela = pega("const DOSSIE_FRASE = {", "function faixaDossie(f)");
const api = new Function("esc", "usdTxt", "S",
  srcTela + "; return { autoDossie, ofertaDossie, AUTO_MODO_FRASE };")(esc, usdTxt, S);

const base = cor => ({ cor, motivo: "m", quantosMudados: 2, paragrafos: 9, bytes: 100, bytesFluxo: 900,
  nos: 5, preco: {}, incremental: { admitido: true, regenerar: 2, herdar: 3, umHop: 0, visao: true, preco: {} } });
const comAuto = (cor, ultimo, extra) => Object.assign(base(cor), {
  auto: Object.assign({ suportado: true, modo: "incremental", reconhecido: true, bruto: null, ultimo }, extra || {})
});

/* TRÊS ESTADOS, e o ausente NÃO cai no ramo negativo — sétima vez neste repositório.
   Aqui o negativo perigoso é "o automático não rodou": ele leria como um final, e o
   final verdadeiro é "não sei". */
/* O `try` aqui é o que faz este caso NOMEAR o defeito em vez de estourar. Sem o
   ramo do campo ausente, a função segue para `a.reconhecido` sobre `undefined` e
   joga um `TypeError` dentro do `render()` — que na tela é a coluna inteira em
   branco, sem frase e sem pista. Um teste que morre com stack prova que algo
   quebrou; um que devolve linha vermelha diz o quê. */
const semCampo = (() => {
  try { return api.autoDossie(base("laranja")) || { razao: null, frase: "" }; }
  catch (e) { return { razao: "estourou", frase: "estourou: " + e.message }; }
})();
t("campo AUSENTE: diz que NÃO SABE, nunca que não rodou",
  /não sei/i.test(semCampo.frase) && !/não foi atualizado/i.test(semCampo.frase), semCampo.frase);
t("...e culpa o processo velho, não o arquivo dele", /subiu antes desta versão/.test(semCampo.frase));
t("...e `razao` é `semcampo`, distinto de qualquer desfecho", semCampo.razao === "semcampo");

const semTent = api.autoDossie(comAuto("laranja", null));
t("sem tentativa registrada: diz isso, e diz em que modo está", semTent.razao === "semtentativa"
  && /Nenhuma atualização automática foi registrada/.test(semTent.frase));

const desl = api.autoDossie(comAuto("laranja", null, { modo: "off" }));
t("desligado: a tela DIZ que está desligado", desl.razao === "desligado" && /desligada/.test(desl.frase));
t("...e nomeia a chave, para haver como ligar", /COCKPIT_DOSSIE_AUTO=off/.test(desl.frase));

const corr = api.autoDossie(comAuto("laranja", { estado: "correndo", incremental: true }));
t("correndo: diz que está sendo atualizado SOZINHO", corr.razao === "correndo" && /sozinho/.test(corr.frase));
t("...e diz que é só o que envelheceu", /parágrafos que envelheceram/.test(corr.frase));
t("...e a reescrita inteira é dita como inteira",
  /reescrita inteira/.test(api.autoDossie(comAuto("laranja", { estado: "correndo", incremental: false })).frase));

const escreveu = api.autoDossie(comAuto("verde", { estado: "escreveu", incremental: true,
  regenerados: 3, herdados: 176, usd: 0.31, ms: 90000, rodadas: 1 }));
t("escreveu: diz o que foi regenerado", escreveu.razao === "escreveu" && /3 parágrafo\(s\)/.test(escreveu.frase));
t("...e quantos foram herdados como estavam", /176 herdado/.test(escreveu.frase));
t("...e o custo", /US\$0,31/.test(escreveu.frase));
t("...e a cor é `ok`, porque nada quebrou", escreveu.cls === "ok");
/* `usdDesconhecido` é a lição do `usd: 0` da rodada morta: uma rodada que morreu
   antes do relatório de custo não foi de graça, e zero leria como grátis. */
const cego = api.autoDossie(comAuto("verde", { estado: "escreveu", incremental: true,
  regenerados: 3, herdados: 0, usd: 0, usdDesconhecido: true }));
t("custo não medido é dito como NÃO MEDIDO, nunca como zero",
  /não foi medido/.test(cego.frase) && !/US\$0,00/.test(cego.frase));

const pulLar = api.autoDossie(comAuto("laranja", { estado: "pulado", razao: "naoadmitido",
  porque: "a escrita parcial não é admitida (sem selo)" }));
t("pulado: diz que NÃO foi atualizado", pulLar.razao === "pulado" && /NÃO foi atualizado sozinho/.test(pulLar.frase));
t("...e diz o motivo que veio do servidor", /sem selo/.test(pulLar.frase));
t("...e diz que o dossiê segue como estava", /segue exatamente como estava/.test(pulLar.frase));

/* O CASO QUE O PEDIDO NOMEIA: vermelho + pulado. Os dois fatos têm a MESMA causa, e
   dizer só um deles manda ele procurar dois problemas onde existe um. */
const pulVerm = api.autoDossie(comAuto("vermelho", { estado: "pulado", razao: "naoadmitido",
  porque: "a escrita parcial não é admitida (o dossiê está vermelho)" }));
t("vermelho + pulado: a MESMA frase liga o pulo à conversa travada",
  /NÃO foi atualizado sozinho/.test(pulVerm.frase) && /conversa sobre este fluxo travada/.test(pulVerm.frase));
t("...e diz POR QUE ela está travada (desatualizado não vai para a sessão)",
  /não é entregue à sessão/.test(pulVerm.frase));
t("...e aponta a saída, que é o botão do lado", /botão aqui do lado/.test(pulVerm.frase));
t("...e a cor sobe para `risk`", pulVerm.cls === "risk");
t("no laranja a mesma frase NÃO fala de trava (ele vai para a sessão)",
  !/travada/.test(pulLar.frase) && pulLar.cls === "warn");

const falhou = api.autoDossie(comAuto("vermelho", { estado: "falhou", razao: "reprovou",
  porque: "não passou nas checagens em 2 rodadas" }));
t("falhou: diz que tentou e não conseguiu", falhou.razao === "falhou" && /tentou e não conseguiu/.test(falhou.frase));
t("...e diz que o dossiê ANTIGO permanece", /continua no lugar/.test(falhou.frase));
t("...e que nada meio-escrito o substituiu (o publish é atômico)", /meio-escrito/.test(falhou.frase));
t("...e que o semáforo segue medindo", /segue medindo/.test(falhou.frase));

/* Os desfechos têm de ser DISTINGUÍVEIS entre si. Duas frases iguais para dois
   finais diferentes ensinam a ignorar as duas — a lição que esta casa já pagou com
   cinza e vermelho na faixa do dossiê. */
const todas = [semCampo, semTent, desl, corr, escreveu, pulLar, pulVerm, falhou].map(x => x.frase);
t("os oito desfechos são frases distintas", new Set(todas).size === 8);
t("nenhum deles fica vazio", todas.every(f => f && f.length > 30));

/* O valor de chave desconhecido é dito, e escapado: ele vem do ambiente, mas é
   texto de fora e a página monta HTML. */
const lixo = api.autoDossie(comAuto("laranja", null, { reconhecido: false, bruto: '<img src=x onerror="alert(1)">' }));
t("valor desconhecido é anunciado", /não é\s+reconhecido/.test(lixo.frase.replace(/\s+/g, " ")));
t("...e escapado antes de virar HTML", !/<img/.test(lixo.frase));

/* A escrita que começou SOZINHA é dita como tal na oferta. "Já está sendo escrito"
   ao lado de um recibo, sem dizer que começou sozinha, deixa a pessoa procurando o
   clique que ela não deu. */
const ofAuto = api.ofertaDossie(Object.assign(base("laranja"),
  { job: { escrevendo: true, atividade: "rodada 1 de 2", automatico: true } }));
t("a oferta diz que a escrita em curso começou sozinha", /começou <strong>sozinha<\/strong>/.test(ofAuto.frase));
const ofClique = api.ofertaDossie(Object.assign(base("laranja"),
  { job: { escrevendo: true, atividade: "rodada 1 de 2", automatico: false } }));
t("...e não diz isso quando foi clicada", !/sozinha/.test(ofClique.frase));

/* A LINHA DESENHADA. `semtentativa` não desenha: é o estado normal antes de
   qualquer apply, e uma linha "nada foi registrado" num recibo seria ruído em cima
   do único lugar onde o desfecho importa. */
const linhaSrc = semComentario(pega("function linhaOfertaDossie(ap)", "\n/* A BANDA DE ESTADO"));
t("a linha do recibo desenha o desfecho do automático", /autoDossie\(d\)/.test(linhaSrc));
t("...em bloco PRÓPRIO, não colado na frase da oferta", /\[ AUTOMÁTICO \]/.test(linhaSrc));
t("...e `semtentativa` não desenha nada", /razao !== "semtentativa"/.test(linhaSrc));

/* ══════════ 8. O ACOMPANHAMENTO — UMA definição, e ela para sozinha ═══════ */

console.log("\n[ 8 ] acompanhar a escrita — o desfecho chega minutos depois, e não num F5");

const acomp = semComentario(pega("function acompanharDossie(id)", "\nasync function escreverDossie"));
t("a parada olha o `job`", /at\.job && at\.job\.escrevendo/.test(acomp));
/* O gatilho roda DEPOIS de a rota responder, então nos primeiros instantes não
   existe nem `job` nem `auto.ultimo`. Parar ali encerraria o acompanhamento antes de
   a escrita começar — e o desfecho nunca chegaria. */
t("...E o `auto.ultimo` correndo", /ultimo\.estado === "correndo"/.test(acomp));
t("...e existe a janela de corrida das primeiras voltas", /DOSSIE_POLL_CORRIDA/.test(acomp));
t("...e existe TETO, para não bater no servidor para sempre", /DOSSIE_POLL_TETO/.test(acomp));

const escSrc = semComentario(pega("async function escreverDossie(f)", "\n/* Peso e desenho"));
const apSrc = semComentario(pega("async function aplicarRemendo(qual)", "\nasync function desfazerRemendo"));
t("o clique usa a MESMA função de acompanhamento", /acompanharDossie\(/.test(escSrc));
t("...e o apply também", /acompanharDossie\(/.test(apSrc));
/* Duas cópias do laço divergiriam no primeiro conserto feito de um lado só. */
t("e não há um segundo `setInterval` de dossiê copiado",
  !/setInterval/.test(escSrc) && !/setInterval/.test(apSrc));
t("o apply acompanha o fluxo ESCRITO, não o aberto",
  /const alvo = \(p && p\.wfIdAlvo\) \|\| \(r && r\.wfIdAlvo\) \|\| S\.sel/.test(apSrc));

console.log("\n" + (bad
  ? "FALHOU: " + bad + " de " + (ok + bad)
  : "passou: " + ok + " casos — o automático é incremental, a recusa não gasta, e nenhum final é silencioso"));
process.exit(bad ? 1 : 0);
