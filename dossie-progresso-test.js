/* dossie-progresso-test.js — a telinha de progresso da escrita do dossiê.
 *
 * O QUE ELA VEIO FECHAR: o botão do dossiê ficava `disabled` enquanto a escrita
 * corria, com uma linha de atividade ao lado. A escrita leva MINUTOS (medido: 514s
 * num fluxo de 103 nós, 682s num de 179) e aquela tela não dizia em que etapa está,
 * em que rodada, nem quanto falta — que é exatamente a pergunta de quem espera. O
 * botão deixou de ser morto e virou a porta desta telinha.
 *
 * ESTE ARQUIVO FIXA A FUNÇÃO PURA `progressoDossie` E A FIAÇÃO DA TELINHA. As
 * funções são EXTRAÍDAS do `upgrade.html` em tempo de execução — reimplementá-las
 * aqui provaria a cópia, e não a tela; é a mesma disciplina do `dossie-tela-test.js`,
 * do `seletor-test.js` e do `audio-test.js`. As checagens de fiação medem o código
 * com os COMENTÁRIOS REMOVIDOS: este repositório já teve dois casos ficarem verdes
 * porque um comentário carregava o nome que eles procuravam.
 *
 * O CASO QUE CARREGA O ARQUIVO é o (2): `duracao` AUSENTE não pode ler como "não
 * tenho histórico". Ausente significa que o cockpit que está respondendo subiu antes
 * desta versão do `server.js` (Node não recarrega esse arquivo), e dizer "nunca medi
 * nada" numa máquina que tem régua de quatro escritas seria a oitava vez que esta
 * base lê ausência como resposta negativa.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhum n8n, nada escrito no repositório.
 *   node dossie-progresso-test.js */

"use strict";

const fs = require("fs");
const path = require("path");

const h = fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8");
const pega = (de, ate) => {
  const i = h.indexOf(de);
  if (i < 0) throw new Error("nao achei `" + de + "` no upgrade.html - a tela mudou de forma");
  const j = h.indexOf(ate, i);
  if (j < 0) throw new Error("nao achei o fim do bloco a partir de `" + de + "`");
  return h.slice(i, j);
};
const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/* O BLOCO INTEIRO DO PROGRESSO, do mapa de etapas até a frase — `progressoDossie`
   não chama nada de fora dele, e é por isso que ele pode ser exercitado sem browser,
   sem `S` e sem rede. Mesma razão pela qual `resolverAlvo`, `podeConversar` e
   `custoDaRodada` foram extraídos puros. */
const FONTE = pega("const PROG_ETAPA = {", "function seloDossie(d)");
const monta = src => new Function(src
  + "; return { progressoDossie, fraseProgresso, PROG_ETAPA, PROG_INDET, dur };")();
const api = monta(FONTE);

let ok = 0, bad = 0, mut = 0;
const t = (n, c) => { if (c) { ok++; console.log("  ok    " + n); } else { bad++; console.log("  FALHOU " + n); } };
/* UM MUTANTE É O ÚNICO JEITO DE SABER QUE UM CASO É UM CASO. `prova` é o próprio
   predicado do caso, avaliado sobre a cópia quebrada: se ele continuar VERDADEIRO, o
   caso ficaria verde com o defeito presente — e um caso que fica verde com o defeito
   presente não é um caso. Nada aqui toca o arquivo em disco: a mutação acontece na
   string extraída, em memória. */
const M = (nome, prova) => {
  if (prova) { bad++; console.log("  MUTANTE SOBREVIVEU: " + nome); }
  else { mut++; console.log("  mut   " + nome + " -> o caso fica vermelho"); }
};
const mutar = (de, para) => {
  if (FONTE.indexOf(de) < 0) throw new Error("mutante sem alvo: `" + de + "`");
  return monta(FONTE.split(de).join(para));
};

const AGORA = Date.parse("2026-08-25T12:00:00.000Z");
const desde = msAtras => new Date(AGORA - msAtras).toISOString();
/* `duracao` NÃO entra por padrão: `progressoDossie` testa `"duracao" in job`, e um
   `duracao: undefined` no molde criaria a chave e apagaria justamente o caso (2). */
const job = (msAtras, extra) => {
  const j = { escrevendo: true, comecouEm: desde(msAtras), etapa: "escrevendo",
    etapaI: 2, etapaTotal: 4, rodada: 1, rodadas: 2, atividade: "rodada 1 de 2" };
  if (extra) for (const k of Object.keys(extra)) j[k] = extra[k];
  return j;
};
const REGUA = { medianaMs: 600000, amostras: 4 };

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 1 ] sem escrita não há progresso, e isso é `null` e não zero");
/* UMA BARRA SOBRE UMA ESCRITA QUE ACABOU AFIRMARIA MOVIMENTO QUE NÃO EXISTE. `null`
   é o que faz cada chamador não desenhar nada; um 0% no lugar seria uma afirmação
   onde deveria haver vazio — e o botão da faixa passaria a dizer "0% · ver
   progresso" sobre uma escrita terminada. */
t("job ausente devolve null", api.progressoDossie(null, AGORA) === null
  && api.progressoDossie(undefined, AGORA) === null);
t("...e `escrevendo: false` também, mesmo com todo o resto no lugar",
  api.progressoDossie(job(60000, { escrevendo: false, duracao: REGUA }), AGORA) === null);
M("`if (!job)` esquece o `escrevendo`",
  mutar("if (!job || !job.escrevendo) return null;", "if (!job) return null;")
    .progressoDossie(job(60000, { escrevendo: false, duracao: REGUA }), AGORA) === null);

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 2 ] campo AUSENTE não é 'não tenho histórico' — o caso que carrega o arquivo");
/* A OITAVA VEZ QUE ESTA BASE ESCREVE A REGRA DOS TRÊS ESTADOS, e aqui o ramo
   negativo perigoso é `semRegua`: ele diz "esta máquina nunca mediu uma escrita
   assim", que é uma afirmação sobre o histórico. O que `duracao` ausente diz é outra
   coisa — o cockpit que respondeu subiu antes desta versão do `server.js`, e Node
   não recarrega esse arquivo. Confundir os dois manda ele procurar um problema de
   histórico que não existe, em vez de fechar a janela e abrir de novo. */
const pAusente = api.progressoDossie(job(60000), AGORA);
t("`duracao` ausente é indeterminado por `campoAusente`",
  pAusente.indeterminado === true && pAusente.porqueIndet === "campoAusente");
t("...e NUNCA por `semRegua`", pAusente.porqueIndet !== "semRegua");
t("...e a frase manda fechar a janela do cockpit e abrir de novo",
  /feche a janela/i.test(api.fraseProgresso(pAusente)) && /abra de novo/i.test(api.fraseProgresso(pAusente)));
t("...e ela nomeia a causa: o servidor é velho, não o histórico",
  /servidor/i.test(api.fraseProgresso(pAusente)) && !/nunca medi/i.test(api.fraseProgresso(pAusente)));
/* `comecouEm` ilegível cai no MESMO ramo, e de propósito: sem início não há
   decorrido, e sem decorrido a régua não vira nada — o que falta continua sendo um
   campo, não uma medida. */
t("`comecouEm` ilegível cai no mesmo ramo, porque também é um campo que não veio",
  api.progressoDossie(job(0, { comecouEm: null, duracao: REGUA }), AGORA).porqueIndet === "campoAusente");
M("ausente cai em `semRegua`",
  mutar('return { ...base, porqueIndet: "campoAusente" };', 'return { ...base, porqueIndet: "semRegua" };')
    .progressoDossie(job(60000), AGORA).porqueIndet === "campoAusente");
M("a frase do ausente deixa de mandar reabrir a janela",
  /feche a janela/i.test(mutar("feche a janela ", "").fraseProgresso(pAusente)));

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 3 ] os três indeterminados são três frases DISTINTAS");
/* Mesma disciplina das quatro frases da faixa do dossiê: uma frase só para dois
   estados ensina a ignorar os dois. `lendo` é a rota tendo devolvido 202 sem esperar
   a leitura do ledger — por alguns instantes a resposta honesta é "ainda estou
   lendo", que não é nem "servidor velho" nem "nunca medi". */
const pLendo = api.progressoDossie(job(60000, { duracao: null }), AGORA);
t("`duracao: null` é `lendo`, e não `campoAusente`",
  pLendo.indeterminado === true && pLendo.porqueIndet === "lendo");
const pSemRegua = api.progressoDossie(job(60000, { duracao: { medianaMs: null, amostras: 0 } }), AGORA);
const tresFrases = [pAusente, pLendo, pSemRegua].map(p => api.fraseProgresso(p));
t("as TRÊS frases são textualmente distintas", new Set(tresFrases).size === 3);
t("...e nenhuma delas é vazia", tresFrases.every(f => f.length > 20));
M("`lendo` responde com a frase do ausente", (() => {
  const mu = mutar("\"Ainda estou lendo o histórico para saber quanto uma escrita destas costuma demorar.\"",
    "PROG_INDET.campoAusente()");
  return new Set([pAusente, pLendo, pSemRegua].map(p => mu.fraseProgresso(p))).size === 3;
})());

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 4 ] sem régua, nenhum minuto é citado");
/* É ONDE TODA ESCRITA INCREMENTAL CAI HOJE: medido, `incremental` tem 0 amostras em
   `dossies.json`, e a primeira delas é que cria a régua. Citar um minuto ali seria
   cotar o tempo da escrita INTEIRA ao lado da palavra "parcial" — a mesma classe de
   defeito que a oferta do recibo já pagou com o preço. */
t("mediana nula com amostras contadas é `semRegua`",
  pSemRegua.indeterminado === true && pSemRegua.porqueIndet === "semRegua" && pSemRegua.amostras === 0);
t("...e a frase não cita minuto nenhum", !/min/.test(api.fraseProgresso(pSemRegua)));
t("...e ela diz que é esta escrita que cria a régua",
  /cria a régua/i.test(api.fraseProgresso(pSemRegua)));
/* 0 e 1 são histórias diferentes: "nunca" e "só uma vez, e a régua precisa de duas". */
const pUma = api.progressoDossie(job(60000, { duracao: { medianaMs: null, amostras: 1 } }), AGORA);
t("...e uma amostra só diz o número, em vez de ler como nunca",
  /1 escrita medida/.test(api.fraseProgresso(pUma))
  && api.fraseProgresso(pUma) !== api.fraseProgresso(pSemRegua));
M("mediana nula passa como régua válida",
  mutar("if (!(med > 0)) return { ...base", "if (false) return { ...base")
    .progressoDossie(job(60000, { duracao: { medianaMs: null, amostras: 0 } }), AGORA).porqueIndet === "semRegua");
M("a frase de sem régua passa a citar minuto",
  !/min/.test(mutar("+ \". É esta que cria a régua.\"",
    "+ \" — as inteiras levam uns 10 min. É esta que cria a régua.\"").fraseProgresso(pSemRegua)));

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 5 ] com régua: a conta, o teto de 97% e o estouro");
const meia = api.progressoDossie(job(300000, { duracao: REGUA }), AGORA);
t("metade da mediana dá metade da barra",
  meia.indeterminado === false && Math.abs(meia.pct - 0.5) < 1e-9 && meia.estourou === false);
t("...e a régua viaja junto, para a frase poder citá-la",
  meia.medianaMs === 600000 && meia.amostras === 4);
/* BARRA CHEIA COM A TELA PARADA É A FORMA MAIS RÁPIDA DE PERDER A CONFIANÇA DE UM
   PAINEL — está escrito no `CLAUDE.md` desde a barra da correção. A mediana é a
   mediana, não uma promessa: metade das escritas passa dela, e a barra para de
   crescer em vez de mentir que acabou. */
const dezVezes = api.progressoDossie(job(6000000, { duracao: REGUA }), AGORA);
t("decorrido de 10x a mediana ainda para em 0,97", dezVezes.pct === 0.97);
t("...e nunca chega a 1", dezVezes.pct < 1);
t("passada a mediana, `estourou` é verdadeiro",
  api.progressoDossie(job(600001, { duracao: REGUA }), AGORA).estourou === true);
t("...e antes dela é falso",
  api.progressoDossie(job(599999, { duracao: REGUA }), AGORA).estourou === false);
/* E O ESTOURO NÃO É FALHA, então a frase tem de dizer isso — `--warn`, nunca
   `--risk`, e a razão escrita ao lado. */
t("a frase do estouro diz que passar da mediana não é falha",
  /não é falha/i.test(api.fraseProgresso(dezVezes)));
M("o teto vira 1 (barra cheia com a tela parada)",
  mutar("Math.min(0.97,", "Math.min(1,").progressoDossie(job(6000000, { duracao: REGUA }), AGORA).pct === 0.97);
M("`estourou` fica ligado desde o início",
  mutar("estourou: decorridoMs > med", "estourou: decorridoMs >= 0")
    .progressoDossie(job(599999, { duracao: REGUA }), AGORA).estourou === false);

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 6 ] etapa desconhecida vem CRUA, nunca no primeiro rótulo");
/* Mesma regra que `seloDossie` aplica a uma cor que ele não conhece. Cair no
   primeiro rótulo faria a telinha afirmar "lendo o fluxo e montando o diretório"
   sobre uma etapa que o `dossie.js` inventou depois — a tela mentindo por causa de
   uma lista fechada que envelheceu. */
const pCru = api.progressoDossie(job(60000, { etapa: "cozinhando", duracao: REGUA }), AGORA);
const primeiro = api.PROG_ETAPA[Object.keys(api.PROG_ETAPA)[0]];
t("etapa fora do mapa aparece entre aspas, com o nome cru",
  pCru.faseTxt === "«cozinhando»");
t("...e NÃO cai no primeiro rótulo do mapa", pCru.faseTxt !== primeiro);
/* E ETAPA AUSENTE É UM TERCEIRO ESTADO: um processo velho que não manda o campo não
   pode virar «undefined» escrito na tela. */
t("etapa ausente é `null`, nunca «undefined»",
  api.progressoDossie(job(60000, { etapa: null, duracao: REGUA }), AGORA).faseTxt === null);
M("etapa desconhecida cai no primeiro rótulo",
  mutar("(PROG_ETAPA[job.etapa] || \"«\" + String(job.etapa) + \"»\")",
        "(PROG_ETAPA[job.etapa] || PROG_ETAPA.preparando)")
    .progressoDossie(job(60000, { etapa: "cozinhando", duracao: REGUA }), AGORA).faseTxt !== primeiro);

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 7 ] a barra é TEMPO, então ela não anda para trás quando a etapa anda");
/* A SEQUÊNCIA NÃO É MONOTÔNICA: uma rodada reprovada volta de `conferindo` para
   `escrevendo`, e o `etapaI` ANDA PARA TRÁS. Quem avança é `rodada`.
   ESTE COMPORTAMENTO NUNCA FOI VISTO NUMA ESCRITA REAL — nenhuma linha de
   `dossies.json` registra mais de uma rodada até hoje —, então o caso existe pelo
   DESENHO e não por uma medição, e isso fica escrito para quem for calibrá-lo
   depois. Ele é barato e o defeito que ele recusa é caro: uma barra recuando na tela
   lê como "quebrou", e quem está esperando há oito minutos não tem como saber que
   aquilo é o desenho funcionando. */
const antes = api.progressoDossie(job(300000, { etapa: "conferindo", etapaI: 3, duracao: REGUA }), AGORA);
const depois = api.progressoDossie(job(360000, { etapa: "escrevendo", etapaI: 2, duracao: REGUA }), AGORA);
t("etapa voltando de 3 para 2 não faz a barra recuar", depois.pct > antes.pct);
t("...e a fase mostrada acompanha a etapa, que é o campo que de fato voltou",
  antes.faseTxt !== depois.faseTxt && depois.faseTxt === api.PROG_ETAPA.escrevendo);
t("...e a rodada continua sendo o que avança, e viaja dita",
  antes.rodadaTxt === "rodada 1/2" && depois.rodadaTxt === "rodada 1/2");
M("a barra passa a ser feita de etapas cumpridas", (() => {
  const troca = ["Math.min(0.97, Math.max(0, decorridoMs / med))",
    "Math.min(0.97, Math.max(0, (Number(job.etapaI) || 1) / (Number(job.etapaTotal) || 4)))"];
  const mu = mutar(troca[0], troca[1]);
  return mu.progressoDossie(job(360000, { etapa: "escrevendo", etapaI: 2, duracao: REGUA }), AGORA).pct
       > mu.progressoDossie(job(300000, { etapa: "conferindo", etapaI: 3, duracao: REGUA }), AGORA).pct;
})());

/* ─────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 8 ] a fiação, medida sobre a fonte SEM COMENTÁRIOS");
/* SEM COMENTÁRIOS porque este repositório já teve dois casos ficarem verdes por
   causa de um comentário que carregava o nome procurado: o `podeConversar` apagado
   continuou "presente" porque a prosa que o explicava o citava. Um teste que casa
   dentro de um comentário documenta a decisão no melhor caso e aprova a ausência
   dela no pior. */

/* (a) A CADEIA DO `keydown`. Ela é uma só, em captura, e a ordem dela é a camada
   declarada desta página, do mais à frente para o mais atrás: 50 o `.scrim`, 47 o
   visor, 46 esta telinha, 45 o seletor, 40 o overlay. Com ouvinte próprio, um Esc
   fecharia a telinha E chamaria o `parar()` — duas ações na mesma tecla, e uma delas
   mata uma rodada de modelo JÁ PAGA. */
const cadeia = semComentario(pega("addEventListener(\"keydown\", e => {", "}, true);"));
const iVisor = cadeia.indexOf("tecladoVisor(e)");
const iProg = cadeia.indexOf("tecladoProgresso(e)");
const iSel = cadeia.indexOf("tecladoSeletor(e)");
t("a cadeia chama `tecladoProgresso` ENTRE o visor e o seletor",
  iVisor >= 0 && iProg >= 0 && iSel >= 0 && iVisor < iProg && iProg < iSel);
t("...e é um `return` que interrompe a cadeia, não uma chamada solta",
  /if \(tecladoProgresso\(e\)\) return;/.test(cadeia));
t("...e a telinha não registra ouvinte próprio de teclado",
  !/addEventListener\("keydown"/.test(semComentario(pega("function abrirProgressoDossie(wfId, origem) {", "function fecharProgressoDossie()")))
  && !/addEventListener\("keydown"/.test(semComentario(pega("function tecladoProgresso(e) {", "\nconst poeTxt"))));
M("a telinha sobe acima do visor", (() => {
  const c = cadeia.replace("if (tecladoVisor(e)) return;", "")
    .replace("if (tecladoProgresso(e)) return;",
      "if (tecladoProgresso(e)) return;\n  if (tecladoVisor(e)) return;");
  const a = c.indexOf("tecladoVisor(e)"), b = c.indexOf("tecladoProgresso(e)"), d = c.indexOf("tecladoSeletor(e)");
  return a >= 0 && b >= 0 && d >= 0 && a < b && b < d;
})());

/* (b) A BARRA NÃO É NOVA. `.pbar`/`.pfill` (com `.unknown` e `.over`) já existiam
   neste arquivo, vieram com o bloco do handoff e estavam MORTAS. Uma segunda família
   de barra seria uma segunda calibragem da mesma coisa, e a que divergisse seria a
   que ninguém olhou — a mesma razão pela qual o seletor acendeu a casca `.fmod*` em
   vez de escrever a sua. */
const css = h.slice(h.indexOf("<style>"), h.indexOf("</style>"));
const pintor = semComentario(pega("function pintarProgresso() {", "function paraProg(cls, txt)"));
t("a telinha pinta com `.pbar` e `.pfill`, os que já existiam",
  /className = "pbar prog-bar"/.test(pintor) && /className = "pfill"/.test(pintor));
/* ANCORADO NO COMEÇO DA LINHA, e não em qualquer lugar: `.pbar.unknown .pfill {` e
   `.pbar.over .pfill {` são ESTADOS da mesma barra, e contá-los como declarações
   faria o caso reprovar exatamente a barra que ele existe para proteger. O que ele
   conta é a DECLARAÇÃO BASE de cada uma — a de dentro do `@media` de movimento
   reduzido é indentada, e por isso também fica de fora. */
t("...e o CSS declara a base de cada um UMA vez só",
  (css.match(/^\.pbar \{/gm) || []).length === 1 && (css.match(/^\.pfill \{/gm) || []).length === 1);
/* `.prog-bar` existe só para o espaçamento: se ela recalibrasse fundo ou altura,
   seria a segunda família entrando pela porta dos fundos. */
const regraProgBar = (css.match(/\.prog-bar \{[^}]*\}/) || [""])[0];
t("...e `.prog-bar` só posiciona: não redeclara fundo nem altura",
  !!regraProgBar && !/background/.test(regraProgBar) && !/height/.test(regraProgBar));
t("...e os dois estados de que ela precisa são os que a barra já tinha",
  /\.pbar\.unknown/.test(css) && /\.pbar\.over/.test(css)
  && /p\.indeterminado \? " unknown" : \(p\.estourou \? " over" : ""\)/.test(pintor));
M("a telinha declara uma barra própria", (() => {
  const c = css + "\n.prog-bar { height: 5px; background: red; }\n.pfill { height: 2px; }";
  const regra = (c.match(/\.prog-bar \{[^}]*\}/) || [""])[0];
  return (c.match(/^\.pfill \{/gm) || []).length === 1
    && !!regra && !/background/.test(regra) && !/height/.test(regra);
})());

/* (c) A TELINHA ABRE NO CLIQUE, E DEPOIS DO POST. Antes dele, um 409 de "já estou
   escrevendo o de X" abriria uma janela de progresso sobre uma escrita que o
   servidor recusou — progresso de coisa nenhuma, com o `catch` logo abaixo tendo a
   frase certa e ninguém para lê-la. */
const escr = semComentario(pega("async function escreverDossie(f) {", "\n/* Peso e desenho"));
const iPost = escr.indexOf("callApi(\"/api/upgrade/dossie/");
const iAbre = escr.indexOf("abrirProgressoDossie(");
t("`escreverDossie` abre a telinha, e só DEPOIS do POST",
  iPost >= 0 && iAbre >= 0 && iPost < iAbre);
t("...e o `catch` que sobra é o que fala do 409, sem abrir nada",
  /S\.erro = "não consegui começar a escrita do dossiê/.test(escr)
  && escr.lastIndexOf("abrirProgressoDossie(") < escr.indexOf("} catch (e)"));
M("a telinha abre ANTES do POST", (() => {
  const c = escr.replace("abrirProgressoDossie(f.id);", "")
    .replace("await callApi(\"/api/upgrade/dossie/",
      "abrirProgressoDossie(f.id);\n    await callApi(\"/api/upgrade/dossie/");
  const a = c.indexOf("callApi(\"/api/upgrade/dossie/"), b = c.indexOf("abrirProgressoDossie(");
  return a >= 0 && b >= 0 && a < b;
})());

/* (d) O POLL ESCREVE NOS DOIS MAPAS. `S.dossie` é a tela do fluxo, `S.dossieVit` é o
   selo do cartão. Escrever só num deles deixaria o cartão envelhecendo enquanto a
   tira do topo está fresca — duas caches, duas idades, e as duas telas discordando
   sobre quem trava a conversa, que é o pior desencontro possível aqui. */
const ver = semComentario(pega("async function verDossie(id, forcar) {", "\n/* A VARREDURA DA VITRINE"));
const acomp = semComentario(pega("function acompanharDossie(id) {", "async function escreverDossie(f)"));
t("`verDossie` escreve nos DOIS mapas",
  /S\.dossie\.set\(k,/.test(ver) && /S\.dossieVit\.set\(k, S\.dossie\.get\(k\)\)/.test(ver));
t("...e o poll passa por ele, e não por um GET próprio",
  /await verDossie\(k, true\)/.test(acomp) && !/callApi\(/.test(acomp));
/* E ELE TEM TETO: um `setInterval` que só para por condição fica batendo no servidor
   para sempre numa aba aberta o dia todo. */
t("...e o poll tem teto, além da condição de desfecho",
  /DOSSIE_POLL_TETO/.test(acomp) && /clearInterval\(S\.dossiePoll\)/.test(acomp));
M("o poll escreve só no mapa da tela do fluxo", (() => {
  const c = ver.replace(/S\.dossieVit\.set\(k, S\.dossie\.get\(k\)\);?/, "");
  return /S\.dossie\.set\(k,/.test(c) && /S\.dossieVit\.set\(k, S\.dossie\.get\(k\)\)/.test(c);
})());

console.log("\n" + (bad ? "FALHOU: " + bad + " de " + (ok + bad)
  : "passou: " + ok + " casos, e cada um recusa um defeito com nome")
  + " · " + mut + " mutantes verificados vermelhos");
process.exit(bad ? 1 : 0);
