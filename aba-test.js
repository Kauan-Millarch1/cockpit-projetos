/* aba-test.js — as decisões do aviso de aba, provadas sem navegador.
 *
 * O `aba.js` carrega em Node: sem DOM ele não liga timer, não pinta favicon e não
 * pede permissão, e exporta as decisões puras. É de propósito — a regra que
 * decide SE alguém é interrompido é a última que deveria depender de abrir o
 * Chrome para ser verificada.
 *
 * O que só existe no navegador (o desenho do favicon, o piscar do título, a
 * notificação do SO) é verificado por `preview/gen-aba-preview.js`, que é
 * interativo por necessidade: animação e permissão não cabem numa captura.
 *
 * Grátis: sem modelo, sem rede, sem n8n.  node aba-test.js
 */

"use strict";

const aba = require("./aba.js");

let ok = 0, falhou = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(e && e.message)); }
};
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "") + " esperava " + JSON.stringify(b) + ", veio " + JSON.stringify(a)); };
const verdade = (v, m) => { if (!v) throw new Error(m || "esperava verdadeiro"); };

const vivo = (id, estado, etapa) => ({ andamento: { id, estado, etapa: etapa || null } });
const morto = { andamento: null };

console.log("\n[ carrega sem DOM e não liga nada ]");

t("requerer em Node não estoura nem cria timer", () => {
  verdade(typeof aba.criarObservador === "function", "não exportou o observador");
  verdade(typeof aba.pintar === "function");
  igual(aba.pintar("pronto", 0.5), null, "tentou pintar sem DOM:");
});

t("sem `Notification` a permissão é `ausente`, não `denied`", () => {
  /* A diferença decide o botão: `ausente` não renderiza botão nenhum, `denied`
   * renderiza um que EXPLICA que nada vai chegar. Confundir os dois esconde o
   * bloqueio ou promete o que não existe. */
  igual(aba.estadoPermissao(), "ausente");
  igual(aba.montarBotao(), null, "montou botão sem DOM:");
});

console.log("\n[ o que merece interromper alguém ]");

t("build correndo NÃO avisa", () => {
  /* Um build de 13 minutos que avisa ao começar é um build que ensina a ignorar
   * o aviso. */
  const d = aba.criarObservador();
  igual(d(vivo("s1", "correndo", "04 desenhar")), null);
  igual(d(vivo("s1", "correndo", "05 validar")), null);
});

t("entrevista parada AVISA, e é um estado próprio", () => {
  /* É o pior caso do produto: espera para sempre e é o mais fácil de esquecer. */
  const d = aba.criarObservador();
  const ev = d(vivo("s1", "aguardando", "01 entender"));
  igual(ev.estado, "aguardando");
  igual(ev.id, "s1");
  igual(ev.extra, "01 entender", "não levou a etapa:");
  verdade(/esperando/.test(aba.ESTADOS.aguardando.frase), "a copy não diz que espera");
});

t("a sessão SAIR da lista é o que significa \"acabou\"", () => {
  /* `andamento` só existe enquanto a sessão está viva. O fim é a transição — e é
   * a única evidência disponível sem uma chamada extra a cada 6s. */
  const d = aba.criarObservador();
  igual(d(vivo("s1", "correndo")), null);
  const ev = d(morto);
  igual(ev.estado, "pronto");
  igual(ev.id, "s1", "perdeu o id da sessão que acabou:");
});

t("quem abre a página agora NÃO recebe aviso de build que já tinha acabado", () => {
  /* Sem esta regra, abrir o cockpit dispara "pronto" para um build de ontem —
   * um aviso que não corresponde a nada que a pessoa fez. */
  const d = aba.criarObservador();
  igual(d(morto), null);
  igual(d(morto), null);
});

t("o fim é anunciado UMA vez, não em todo poll seguinte", () => {
  const d = aba.criarObservador();
  d(vivo("s1", "correndo"));
  verdade(d(morto), "não anunciou o fim");
  igual(d(morto), null, "anunciou de novo:");
  igual(d(morto), null);
});

t("dois builds em sequência geram dois avisos", () => {
  const d = aba.criarObservador();
  d(vivo("s1", "correndo"));
  igual(d(morto).id, "s1");
  d(vivo("s2", "correndo"));
  igual(d(morto).id, "s2", "o segundo build não avisou:");
});

t("status quebrado ou vazio não inventa evento", () => {
  /* Corpo que não é objeto é a rota velha respondendo `404` como número —
   * `JSON.parse("404")` dá 404, e este projeto já foi enganado por isso. */
  const d = aba.criarObservador();
  for (const s of [null, undefined, {}, { andamento: undefined }, 404, "texto", []]) {
    igual(d(s), null, "com status=" + JSON.stringify(s));
  }
});

console.log("\n[ um evento, um anúncio — a eleição entre abas ]");

t("a primeira aba assume e as outras não notificam", () => {
  /* Três abas abertas não podem virar três notificações do SO para um evento: o
   * produto pareceria quebrado justo no momento em que devia brilhar. */
  aba.guardado.gravar(aba.CHAVE_DONO, "");
  verdade(aba.souDono(1000), "a primeira não assumiu");
  verdade(aba.souDono(1000 + 5000), "a dona perdeu a própria chave");
});

t("o arrendamento vence, então uma aba fechada não cala o aviso para sempre", () => {
  /* Posse fixa faria a aba dona ser fechada e ninguém mais avisar nunca. */
  aba.guardado.gravar(aba.CHAVE_DONO, JSON.stringify({ id: "outra-aba", em: 1000 }));
  igual(aba.souDono(1000 + 5000), false, "roubou a chave de uma dona viva:");
  verdade(aba.souDono(1000 + aba.ARRENDO_MS + 1), "não assumiu depois do vencimento");
});

t("dono guardado corrompido não derruba nada — assume", () => {
  aba.guardado.gravar(aba.CHAVE_DONO, "{isso nao e json");
  verdade(aba.souDono(1000), "explodiu ou recusou com lixo no armazenamento");
});

t("o mesmo evento não é anunciado duas vezes; estados diferentes sim", () => {
  aba.marcarAnunciado("s9|aguardando");
  verdade(aba.jaAnunciado("s9|aguardando"));
  verdade(!aba.jaAnunciado("s9|pronto"), "o mesmo build não pôde avisar que ficou pronto");
  verdade(!aba.jaAnunciado("s10|aguardando"), "outro build ficou mudo");
});

console.log("\n[ a copy, que é metade da feature ]");

t("cada estado tem frase, corpo e tipo de aviso próprios", () => {
  for (const [nome, cfg] of Object.entries(aba.ESTADOS)) {
    verdade(cfg.frase && cfg.frase.length > 10, nome + " sem frase");
    verdade(cfg.corpo && cfg.corpo.length > 10, nome + " sem corpo");
    verdade(["ok", "alerta", "erro", "info"].includes(cfg.aviso), nome + " com tipo de aviso inválido: " + cfg.aviso);
    verdade(cfg.titulo && cfg.titulo === cfg.titulo.toUpperCase(), nome + " sem título para a aba");
  }
  /* Copy igual para sucesso e falha ensinaria a ignorar os dois. */
  const frases = Object.values(aba.ESTADOS).map(c => c.frase);
  igual(new Set(frases).size, frases.length, "há estados com a mesma frase:");
});

t("falha e cancelamento não fazem som; pronto e te-espera fazem", () => {
  /* Som é interrupção. Vale para o que pede ação, não para o que já acabou mal. */
  verdade(aba.ESTADOS.pronto.som && aba.ESTADOS.aguardando.som);
  verdade(!aba.ESTADOS.falhou.som && !aba.ESTADOS.cancelada.som);
});

t("a falha diz que nada foi escrito no n8n", () => {
  /* É a frase que decide se a pessoa vai abrir o n8n em pânico. */
  verdade(/n8n/.test(aba.ESTADOS.falhou.corpo), "não menciona o n8n: " + aba.ESTADOS.falhou.corpo);
});

console.log("\n[ o desenho do favicon é um fluxo ]");

t("três nós, duas arestas, todas partindo da origem", () => {
  /* Uma fileira de três quadrados lê como três quadrados em 32px; um ramo lê
   * como fluxo. */
  igual(aba.NOS.length, 3);
  igual(aba.ARESTAS.length, 2);
  for (const [a, b] of aba.ARESTAS) verdade(a === 0 && b > 0, "aresta que não sai da origem: " + a + "→" + b);
});

t("o pulso não entra em aresta antes de a origem acender", () => {
  /* O defeito que isto tranca: com o teste sendo `passo > 0`, um passo de 0,5
   * dava `Math.floor(0.5) - 1 = -1`, `ARESTAS[-1]` era `undefined` e a
   * desestruturação lançava `undefined is not iterable` DENTRO do tick da
   * animação. O quadro seguinte redesenhava, então a animação PARECIA funcionar —
   * o erro só apareceu no `pageerror` do navegador. Agora falha aqui. */
  igual(aba.arestaDoPasso(0, true), null, "passo 0:");
  igual(aba.arestaDoPasso(0.5, true), null, "passo 0,5 (origem acendendo):");
  igual(aba.arestaDoPasso(0.999, true), null);
});

t("o pulso percorre a primeira aresta, depois a segunda", () => {
  igual(aba.arestaDoPasso(1, true), { idx: 0, t: 0 });
  igual(aba.arestaDoPasso(1.5, true).idx, 0);
  igual(aba.arestaDoPasso(2.25, true).idx, 1);
  igual(Math.round(aba.arestaDoPasso(2.25, true).t * 100), 25, "posição dentro da aresta:");
});

t("depois do último nó não há aresta, e o índice nunca sai da lista", () => {
  igual(aba.arestaDoPasso(3, true), null, "passo 3 (todos acesos):");
  igual(aba.arestaDoPasso(99, true), null);
  for (let p = 0; p <= 5; p += 0.05) {
    const r = aba.arestaDoPasso(p, true);
    if (r) verdade(r.idx >= 0 && r.idx < aba.ARESTAS.length, "índice fora da lista no passo " + p.toFixed(2) + ": " + r.idx);
  }
});

t("quadro estático e passo inválido não produzem pulso", () => {
  igual(aba.arestaDoPasso(1.5, false), null, "estático:");
  for (const p of [null, undefined, NaN, Infinity, "1.5", {}]) igual(aba.arestaDoPasso(p, true), null, "passo=" + String(p));
});

t("nenhum nó sai da caixa de 32", () => {
  for (const n of aba.NOS) {
    verdade(n.x >= 0 && n.y >= 0 && n.x + 9 <= aba.N && n.y + 9 <= aba.N, "nó fora da caixa: " + JSON.stringify(n));
  }
});

console.log("\n[ o poll não pode custar caro ]");

t("o intervalo é coerente com o custo medido da rota", () => {
  /* 6s só é responsável porque `/api/tester/status` custa ~5ms. Ele já custou
   * 190ms (um `JSON.parse` de 9,4MB por chamada); se aquilo voltar, este número
   * está errado e este teste é o lugar de descobrir. */
  verdade(aba.POLL_MS >= 3000, "poll agressivo demais: " + aba.POLL_MS);
  verdade(aba.POLL_MS_OCULTA >= aba.POLL_MS, "aba escondida polia mais que a visível");
});

t("a animação tem fim", () => {
  /* Favicon girando para sempre deixa de ser aviso e vira decoração — e
   * decoração que se move é a primeira coisa que o olho aprende a ignorar. */
  verdade(aba.ANIM_MAX_MS > 0 && aba.ANIM_MAX_MS <= 10 * 60 * 1000, "teto estranho: " + aba.ANIM_MAX_MS);
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exitCode = falhou ? 1 : 0;
