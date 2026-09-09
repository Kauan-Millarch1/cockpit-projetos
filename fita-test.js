/* A FITA DO PALCO: o que a reexecução visual pode e não pode fazer com o desenho.
 *
 * Existe por causa de um relato que parecia impossível de reproduzir — "quando
 * clico no fluxo que deu erro, a execução sai correndo pulando um monte de nó e
 * fica tudo bugado; quando o fluxo é pequeno, roda normal". Era verdade, eram
 * quatro defeitos somados, e nenhum deles tinha teste:
 *
 *   1. um `nodeRun` não é um nó. Um agente reexecuta o mesmo nó em ciclo
 *      (medido: `Memória1` 6× alternando success/error e `OpenAI Chat Model1`
 *      8× na execução #207189 do `Agente eContrate`; numa que deu certo nada
 *      repete mais que 2×). As classes empilhavam no MESMO elemento SVG.
 *   2. `stopReplay` só cancelava os temporizadores de primeiro nível, então a
 *      fita velha continuava pintando por cima da nova.
 *   3. a câmera durava 320ms fixos contra passos de 300ms — nunca chegava, e o
 *      nó acendia fora do quadro.
 *   4. o poll do SSE reiniciava a fita a cada 20s.
 *
 * O que este arquivo mede é o CÓDIGO da página, extraído na hora de rodar —
 * reimplementar as funções aqui provaria a cópia, que é a disciplina que
 * `audio-test.js` estabeleceu. As checagens de fiação leem a fonte SEM
 * COMENTÁRIOS, porque `dossie-tela-test.js` já pagou por dois casos que ficaram
 * verdes casando dentro de um comentário.
 *
 * Grátis: sem navegador, sem modelo, sem rede, sem n8n. `node fita-test.js`.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "flows.html"), "utf8");

/* Fonte sem comentário: um `includes` que casa dentro de um comentário aprova a
   ausência da decisão, que é o pior resultado possível para um teste de fiação. */
const semComentario = s => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

let ok = 0, falhas = [];
const sim = (c, msg) => { if (c) ok++; else falhas.push(msg); };
const nao = (c, msg) => sim(!c, msg);
const titulo = t => console.log("\n" + t);

/* ------------------------------------------------ a câmera, extraída da página
 *
 * Duas fatias, e a primeira não é conveniência: `boxFor`, `maxBoxW` e `bboxOf`
 * são o que decide se enquadrar um trecho muda o ZOOM, e um `boxFor` de
 * mentira aqui aprovaria a translação sem provar nada — foi exatamente o que
 * um mutante mostrou. Quem é falso é só o que toca o DOM (`$`) e o destino do
 * movimento (`animateTo`), que é o que o teste precisa capturar. */
function fatia(ini, fim, oque) {
  const a = HTML.indexOf(ini), b = HTML.indexOf(fim);
  if (a < 0 || b < 0 || b < a) {
    console.error("As âncoras de " + oque + " mudaram: esperava " + JSON.stringify(ini)
      + " antes de " + JSON.stringify(fim) + " em flows.html.");
    process.exit(1);
  }
  return HTML.slice(a, b);
}
const GEOMETRIA = fatia("const MIN_BOX_W =", "let camAnim", "geometria da câmera");
const CAMERA = fatia("const CAM_FRACAO", "let replayTimers", "compasso da câmera");

// `larguraDoPalco` existe porque `maxBoxW()` a lê do DOM: é ela que decide se
// há folga de zoom acima de MIN_BOX_W — e é com folga que reenquadrar passa a
// significar mexer no zoom.
function montarCamera(cfg) {
  const chamadas = [];
  const ambiente = `
    let S = arguments[0], viagens = arguments[1], larguraDoPalco = arguments[2], alturaDoPalco = arguments[3];
    const NODE = 84, NODE_W = 84, NODE_H = 84, LABEL_GAP = 13;
    const $ = () => ({ getBoundingClientRect: () => ({ width: larguraDoPalco, height: alturaDoPalco }) });
    const animateTo = (box, ms) => viagens.push({ box, ms });
  ` + GEOMETRIA + CAMERA
    + "\nreturn { follow, seguirTrecho, camDuracao, boxFor, maxBoxW, bboxOf,"
    + " CAM_FRACAO, CAM_MIN_MS, CAM_CORTE, CAM_JANELA, MIN_BOX_W };";
  const api = new Function(ambiente)(cfg.S, chamadas, cfg.palcoW || 960, cfg.palcoH || 540);
  return { api, chamadas };
}

// Um grafo de brinquedo: nós numa linha, espaçados, para as contas serem óbvias.
function grafo(posicoes) {
  const nodes = Object.entries(posicoes).map(([name, xy]) => ({ name, x: xy[0], y: xy[1] }));
  return {
    graph: { nodes },
    view: { box: { x: 0, y: 0, w: 1500, h: 1500 / (16 / 9) }, L: { pos: n => ({ x: n.x, y: n.y }) } }
  };
}

/* ============================================================== 1. o compasso */
titulo("1. a câmera nunca pode ser mais lenta que o passo");
{
  const { api } = montarCamera({ S: grafo({ a: [0, 0] }) });

  // O defeito medido: passo de 300ms e viagem de 320ms fixos. 33% das viagens
  // eram cortadas no meio por outra, e a câmera nunca chegava.
  sim(api.camDuracao(300) < 300,
    "num passo de 300ms a viagem tem que caber dentro dele (é " + api.camDuracao(300) + "ms)");
  sim(api.camDuracao(300) === 225, "300ms × CAM_FRACAO = 225ms");

  // …e o teto de 320ms continua valendo: um nó de 1,5s não pode fazer a câmera
  // levar 1,1s para se mover, senão a fita fica lenta onde ela é interessante.
  sim(api.camDuracao(1500) === 320, "num passo longo a viagem para de crescer em 320ms");

  // …e o piso, porque abaixo dele o movimento vira tremor.
  sim(api.camDuracao(20) === api.CAM_MIN_MS,
    "num passo curtíssimo a viagem não desce abaixo de CAM_MIN_MS");

  // A regra em uma frase, para qualquer passo do intervalo real do replay.
  let sempreCabe = true;
  for (let p = 170; p <= 1500; p += 10) if (api.camDuracao(p) > p) sempreCabe = false;
  sim(sempreCabe, "para TODO passo entre o piso e o teto, a viagem cabe dentro do passo");

  // Sem argumento, o comportamento antigo — quem chama de fora do replay (o fim
  // da fita, o `?exec=`) não tem passo nenhum para oferecer.
  const { api: a2, chamadas } = montarCamera({ S: grafo({ a: [1200, 100] }) });
  a2.follow("a", 1500);   // perto, senão o corte do bloco 2 é que responderia
  sim(chamadas.length === 1 && chamadas[0].ms === 320,
    "sem passo declarado, a viagem volta a durar os 320ms de sempre");
}

/* ================================================================ 2. o corte */
titulo("2. salto longo é corte, não voo");
{
  // Medido no Iago: saltos de até 9.931 unidades com a janela em 1.500. Voar
  // isso em 300ms não mostra o caminho, mostra um borrão — e o borrão é o que
  // se lê como bug.
  const { api, chamadas } = montarCamera({ S: grafo({ longe: [9000, 0] }) });
  api.follow("longe", null, 300);
  sim(chamadas.length === 1, "a câmera foi para o nó distante");
  sim(chamadas[0].ms === 0, "e foi por CORTE (ms = 0), não voando");

  // Perto continua sendo movimento: o corte não pode comer o pan curto, que é
  // o que deixa claro para onde a fita andou.
  const { api: a2, chamadas: c2 } = montarCamera({ S: grafo({ perto: [1400, 200] }) });
  a2.follow("perto", null, 300);
  sim(c2.length === 1 && c2[0].ms > 0,
    "um salto curto continua sendo movimento (" + (c2[0] || {}).ms + "ms)");

  // A fronteira é declarada, não implícita.
  sim(api.CAM_CORTE > 1, "CAM_CORTE é medido em larguras de quadro e é maior que uma");
}

/* ============================================================== 3. o trecho */
titulo("3. seguir o trecho, e não o nó");
{
  /* O ciclo do agente, que é o caso real: os runs 20–42 da execução #207189 são
     seis nós batendo em ciclo. Perseguindo um por vez a câmera ia e voltava a
     cada 300ms. Se eles cabem juntos no quadro, o quadro é deles. */
  const S = grafo({ agente: [0, 0], memoria: [200, 300], modelo: [400, 300], ferramenta: [600, 300] });
  S.view.box = { x: -300, y: -200, w: 1500, h: 1500 / (16 / 9) };
  const runs = [
    { name: "agente" }, { name: "memoria" }, { name: "modelo" },
    { name: "agente" }, { name: "ferramenta" }, { name: "agente" }
  ];
  const { api, chamadas } = montarCamera({ S });
  api.seguirTrecho(runs, 0, 300);
  sim(chamadas.length === 0,
    "o ciclo inteiro já cabe no quadro: a câmera NÃO se mexe (mexeu " + chamadas.length + "×)");

  // …e quando não cabe, ela volta a seguir o nó, que é o certo num trecho que
  // de fato avança.
  const S2 = grafo({ a: [0, 0], b: [8000, 0], c: [16000, 0] });
  const { api: a2, chamadas: c2 } = montarCamera({ S: S2 });
  a2.seguirTrecho([{ name: "a" }, { name: "b" }, { name: "c" }], 0, 300);
  sim(c2.length === 1, "trecho que não cabe: volta a seguir o nó");

  /* TRANSLADA, NUNCA REENQUADRA. `boxFor` recalcula a largura a partir do
     trecho, e num palco largo há folga de zoom acima de `MIN_BOX_W` — então um
     trecho curto seguido de um longo mexeria no zoom a cada passo, que é vaivém
     disfarçado: o centro anda para os dois lados sem que a fita tenha voltado.
     Medido no Iago, isso levou as inversões de sentido de 5 para 15. */
  const palcoLargo = { palcoW: 1600, palcoH: 900 };   // dá folga acima de MIN_BOX_W
  // O trecho é largo de propósito: um trecho curto cai no piso MIN_BOX_W e os
  // dois enquadramentos coincidiriam, o que faria o caso passar por sorte.
  const S3 = grafo({ p: [0, 0], q: [1700, 0], r: [9000, 0] });
  const quadroAntes = { x: 5000, y: 0, w: 1500, h: 1500 / (1600 / 900) };
  S3.view.box = { ...quadroAntes };
  const { api: a3, chamadas: c3 } = montarCamera({ S: S3, ...palcoLargo });
  sim(a3.maxBoxW() > a3.MIN_BOX_W,
    "neste palco há folga de zoom (maxBoxW " + Math.round(a3.maxBoxW()) + " > MIN_BOX_W " + a3.MIN_BOX_W + ")");
  a3.seguirTrecho([{ name: "p" }, { name: "q" }], 0, 300);
  sim(c3.length === 1, "trecho fora do quadro: a câmera vai até ele");
  sim(c3.length === 1 && c3[0].box.w === quadroAntes.w && c3[0].box.h === quadroAntes.h,
    "e o quadro mantém EXATAMENTE o tamanho que tinha — translação pura");
  // A prova de que isso não é trivial: `boxFor` sobre o mesmo trecho daria outro
  // tamanho, e é esse "outro" que o mutante reintroduz.
  const doBoxFor = a3.boxFor(a3.bboxOf(["p", "q"]));
  sim(Math.abs(doBoxFor.w - quadroAntes.w) > 1,
    "…e `boxFor` daria um quadro de outro tamanho (" + Math.round(doBoxFor.w) + " contra " + quadroAntes.w + ")");

  sim(api.CAM_JANELA >= 2, "CAM_JANELA olha mais de um passo à frente");
}

/* ================================================ 4. o estado do nó é um só */
titulo("4. um nodeRun não é um nó: o estado é exclusivo");
{
  const fonte = semComentario(HTML);
  // O defeito: `add("hot")` sem tirar `ran`/`failed`, e `add("ran")` sem tirar
  // `failed`. Numa execução com o ciclo do agente isso deixava o mesmo nó com
  // duas classes contraditórias — e dois nós marcados como falhos.
  sim(/classList\.remove\("pending",\s*"ran",\s*"failed"\)/.test(fonte),
    "ao acender, o nó larga pending, ran E failed");
  sim(/classList\.remove\("hot",\s*"ran",\s*"failed"\)/.test(fonte),
    "ao assentar, o nó larga hot, ran E failed antes de receber o novo estado");
  nao(/classList\.remove\("pending"\);\s*\n?\s*g\.classList\.add\("hot"\)/.test(fonte),
    "não sobrou nenhum acendimento que só tira `pending`");
}

/* ====================================== 5. parar a fita para a fita de verdade */
titulo("5. stopReplay cancela TUDO, inclusive o que foi agendado de dentro");
{
  const fonte = semComentario(HTML);
  const iR = fonte.indexOf("function replay(detail)");
  const iT = fonte.indexOf("async function selectWorkflow");
  sim(iR > 0 && iT > iR, "achei o corpo do replay para medir");
  const corpo = fonte.slice(iR, iT);

  /* Medido antes da correção: depois de `stopReplay()` o desenho ainda mudou 11
     vezes em 4 segundos, porque o `hold` do nó, os três da aresta, o da seta e
     o que remove o pulso não entravam em `replayTimers`. */
  const soltos = (corpo.match(/setTimeout\(/g) || []).length;
  sim(soltos === 0,
    "nenhum setTimeout solto dentro do replay e do travel (achei " + soltos + ")");
  sim((corpo.match(/agendar\(/g) || []).length >= 6,
    "todos os temporizadores da fita passam por `agendar`");
  sim(/const agendar = \(fn, ms\) => \{ replayTimers\.push\(setTimeout\(fn, ms\)\); \};/.test(fonte),
    "`agendar` é a única porta para `replayTimers`");
  sim(/function stopReplay\(\) \{[^}]*replayTimers\.forEach\(clearTimeout\)/.test(fonte),
    "stopReplay limpa a lista inteira");
  sim(/function stopReplay\(\) \{[^}]*fitaPendente = null/.test(fonte),
    "…e derruba a pendente junto: parar a fita não pode deixar uma próxima armada");
}

/* ================================ 6. o poll não arranca a fita de quem olha */
titulo("6. o poll não reinicia nem troca a fita que está correndo");
{
  const fonte = semComentario(HTML);
  const i = fonte.indexOf('es.addEventListener("delta"');
  const corpo = fonte.slice(i, i + 3000);
  sim(i > 0, "achei o handler do delta");

  /* Medido antes: cartão do `Agente eContrate` aberto, um delta a cada 20s por
     dois minutos → 7 fitas iniciadas, 0 chegaram ao fim. Depois: 6 iniciadas,
     5 percorreram até o último nó. */
  sim(/nova !== S\.selectedExec/.test(corpo),
    "a execução que já está no palco não é recarregada do zero");
  sim(/!S\.execFixa/.test(corpo),
    "uma execução escolhida a dedo não é trocada pelo poll");
  sim(/if \(fitaCorrendo\) fitaPendente = nova; else loadExec\(nova\)/.test(corpo),
    "com fita correndo, a nova espera; sem fita, entra na hora");

  // E a pendente entra no FIM da fita, uma só — uma fila faria o palco correr
  // atrás do passado.
  sim(/if \(fitaPendente\) \{ const id = fitaPendente; fitaPendente = null; loadExec\(id\); return; \}/.test(fonte),
    "a pendente é drenada no fim da fita e some ao ser usada");

  // Quem fixa a execução: a linha do Ao vivo, o quadro de erros, o handoff e o
  // link `?exec=`. O cartão NÃO fixa — ali se escolheu o fluxo, não a execução.
  const fixam = (fonte.match(/selectWorkflow\([^)]*,\s*true\)/g) || []).length;
  sim(fixam === 4, "quatro caminhos escolhem a execução a dedo (achei " + fixam + ")");
  sim(/selectWorkflow\(f\.id, f\.lastRun\?\.id \|\| null\);/.test(fonte),
    "o clique no CARTÃO não fixa: ali o palco segue o fluxo ao vivo");
}

/* ======================================= 7. a câmera parte antes do nó acender */
titulo("7. a câmera parte com antecedência");
{
  const fonte = semComentario(HTML);
  /* Medido: 28 dos 212 acendimentos do Iago aconteciam fora do quadro visível,
     porque a câmera era disparada no MESMO instante do `hot`. Partindo com a
     duração da própria viagem de antecedência, foram a zero. */
  sim(/agendar\(\(\) => seguirTrecho\(runs, i, step\), Math\.max\(0, at - camDuracao\(step\)\)\)/.test(fonte),
    "o movimento é agendado uma viagem inteira ANTES do passo");
  const iCam = fonte.indexOf("seguirTrecho(runs, i, step)");
  const iHot = fonte.indexOf('classList.add("hot")');
  sim(iCam > 0 && iHot > iCam, "e vem antes do acendimento no corpo do replay");
}

/* --------------------------------------------------------------------- saída */
console.log("");
for (const f of falhas) console.log("  FALHOU  " + f);
if (falhas.length) {
  console.log("\nfalhou: " + falhas.length + " caso(s), " + ok + " ok");
  process.exit(1);
}
console.log("passou: " + ok + " ok, 0 falha(s)");
