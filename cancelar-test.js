/* cancelar-test.js — parar no meio, sem gastar modelo.
 *
 * O que se prova aqui é o contrato do Esc: matar o processo, invalidar a corrida
 * em voo, marcar a etapa como parada por VOCÊ (nunca como falha), e registrar o
 * gasto que ninguém mediu em vez de zero. Cada teste rejeita um defeito nomeado.
 *
 * `cancelar` é a função real, chamada sobre uma sessão real do mapa real — o
 * único falso é o filho, um objeto com `kill()`. Reimplementar a máquina de
 * estados por fora provaria a cópia, não o código que roda.
 *
 * Custa zero: nenhum spawn, nenhuma rede, nenhum modelo. `node cancelar-test.js`
 *
 * Ele TOCA `blueprints.json`, que é rastreado no git: `cancelar` grava no ledger
 * de propósito (uma corrida cancelada existiu e gastou). O arquivo é salvo byte a
 * byte antes e restaurado num `finally` — restauração inteira, não limpeza
 * seletiva, que é o que sobrevive a um teste que quebra no meio.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const tester = require("./tester");

const { sessions, cancelar, custoDaRodada } = tester;
const LEDGER = path.join(__dirname, "blueprints.json");

let ok = 0, bad = 0;
const t = async (nome, fn) => {
  try { await fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { bad++; console.log("  FALHA " + nome + "\n         " + (e && e.message)); }
};
const grupo = n => console.log("\n" + n);

/* Uma sessão no estado em que o Esc a encontra: etapa 4 correndo, com filho
 * vivo, desenho parcial na tela e uma rodada já paga atrás. */
let n = 0;
function sessaoFake(over) {
  const id = "tzzteste" + (++n);
  let matou = 0;
  const s = {
    id, gen: 3, dir: path.join(__dirname, ".tester-runs", id),
    criadoEm: new Date().toISOString(),
    ideia: "teste de cancelamento", nivel: "sou técnico",
    status: "correndo", etapa: 4,
    etapas: [
      { n: 1, nome: "Entender", estado: "feita" },
      { n: 2, nome: "Pesquisar", estado: "pulada" },
      { n: 3, nome: "Ingredientes", estado: "feita" },
      { n: 4, nome: "Desenhar", estado: "correndo" },
      { n: 5, nome: "Validar", estado: "pendente" },
      { n: 6, nome: "Fantasma", estado: "pendente" },
      { n: 7, nome: "Entregar", estado: "pendente" }
    ],
    chat: [], entendi: { oQueFaz: "x" }, perguntas: [{ q: "sobrou?" }],
    achados: [{ tipo: "risco", texto: "algo", fonte: "fato" }],
    respostas: [], rodadaEntrevista: 2,
    wf: null, wfParcial: { nodes: [{ name: "rascunho" }] },
    custo: [{ sessao: "entender", usd: 0.41, ms: 153000 }],
    log: [], versao: 7,
    filho: { kill() { matou++; } },
    ...over
  };
  sessions.set(id, s);
  return { s, id, matou: () => matou };
}

const naEtapa = (s, n) => (s.etapas || []).find(x => x.n === n) || {};

(async () => {
  const tinha = fs.existsSync(LEDGER);
  const antes = tinha ? fs.readFileSync(LEDGER) : null;

  try {
    grupo("o cancelamento em si");

    await t("mata o filho e a sessão fica `cancelada`", async () => {
      const f = sessaoFake();
      const snap = await cancelar(f.id);
      assert.strictEqual(f.s.status, "cancelada", "status devia ser `cancelada`");
      assert.strictEqual(snap.status, "cancelada", "o snapshot devolvido tem que já refletir isso");
      assert.strictEqual(f.matou(), 1, "o processo filho tinha que ter sido morto exatamente uma vez");
    });

    await t("sobe a geração — é ela que faz a esteira parar sozinha", async () => {
      const f = sessaoFake();
      const gen = f.s.gen;
      await cancelar(f.id);
      assert.ok(f.s.gen > gen, "sem subir `gen`, a etapa em voo continuaria escrevendo");
    });

    await t("a etapa que corria vira `cancelada`, NUNCA `falhou`", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      assert.strictEqual(naEtapa(f.s, 4).estado, "cancelada");
      assert.ok(/você parou/i.test(naEtapa(f.s, 4).nota || ""), "a nota tem que dizer quem parou");
    });

    await t("etapas já concluídas não são tocadas", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      assert.strictEqual(naEtapa(f.s, 1).estado, "feita");
      assert.strictEqual(naEtapa(f.s, 2).estado, "pulada");
      assert.strictEqual(naEtapa(f.s, 5).estado, "pendente", "o que nem começou continua pendente");
    });

    await t("o rascunho da corrida morta é descartado", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      assert.strictEqual(f.s.wfParcial, null, "um desenho pela metade não pode sobreviver ao cancelamento");
      assert.deepStrictEqual(f.s.perguntas, [], "pergunta da corrida invalidada não pode ficar clicável");
    });

    await t("o que já foi pago continua na tela", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      assert.strictEqual(f.s.custo.length, 1, "cancelar não apaga gasto anterior");
      assert.strictEqual(f.s.achados.length, 1, "nem os achados");
      assert.ok(f.s.entendi, "nem o que já tinha sido entendido");
    });

    await t("deixa o log dizendo que foi você", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      assert.ok(f.s.log.some(l => /cancelado por você/i.test(l.texto)),
        "sem esta linha, o log de uma parada é indistinguível do de uma queda");
    });

    grupo("o que ele se recusa a fazer");

    await t("cancelar duas vezes é uma vez só", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      await cancelar(f.id);                      // não pode estourar nem matar de novo
      assert.strictEqual(f.matou(), 1, "o segundo Esc não pode virar um segundo cancelamento");
    });

    await t("sessão que não está correndo devolve 409, não silêncio", async () => {
      const f = sessaoFake({ status: "aguardando" });
      await assert.rejects(() => cancelar(f.id), e => e.status === 409,
        "parar o que já parou tem que ser um erro nomeado");
      assert.strictEqual(f.matou(), 0);
    });

    await t("sessão inexistente devolve 404", async () => {
      await assert.rejects(() => cancelar("tnaoexiste"), e => e.status === 404);
    });

    await t("uma sessão pronta não pode ser cancelada por engano", async () => {
      const f = sessaoFake({ status: "pronta" });
      await assert.rejects(() => cancelar(f.id), e => e.status === 409);
    });

    grupo("o gasto que ninguém mediu");

    await t("rodada cancelada sem custo reportado entra como CEGA, não como zero", () => {
      const e = custoDaRodada({ rotulo: "desenhar", usd: 0, ms: 240000, comRede: false, morto: false, cancelada: true });
      assert.strictEqual(e.usdDesconhecido, true, "registrar 0 aqui é afirmar que foi de graça");
      assert.ok(/cancelou/i.test(e.motivo), "o motivo tem que dizer que foi cancelamento, não teto de tempo");
    });

    await t("teto de tempo continua com o motivo dele", () => {
      const e = custoDaRodada({ rotulo: "desenhar", usd: 0, ms: 360000, comRede: false, morto: true, cancelada: false });
      assert.strictEqual(e.usdDesconhecido, true);
      assert.ok(/interrompida/i.test(e.motivo));
    });

    await t("custo que CHEGOU antes da morte é medido, não chutado", () => {
      const e = custoDaRodada({ rotulo: "desenhar", usd: 2.79, ms: 660000, comRede: false, morto: true, cancelada: true });
      assert.ok(!e.usdDesconhecido, "o `result` chegou: o número é real e vale mais que a suspeita");
      assert.strictEqual(e.usd, 2.79);
    });

    await t("rodada normal não ganha marca nenhuma", () => {
      const e = custoDaRodada({ rotulo: "entender", usd: 0.41, ms: 153000, comRede: false, morto: false, cancelada: false });
      assert.ok(!e.usdDesconhecido);
      assert.ok(!e.motivo);
    });

    await t("rodada de graça de verdade também não é marcada", () => {
      const e = custoDaRodada({ rotulo: "pesquisar", usd: 0, ms: 12, comRede: true, morto: false, cancelada: false });
      assert.ok(!e.usdDesconhecido, "sem morte não há cegueira — 0 aqui é 0 mesmo");
    });

    grupo("o ledger");

    await t("a corrida cancelada é registrada — ela existiu e gastou", async () => {
      const f = sessaoFake();
      await cancelar(f.id);
      const lista = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
      const linha = lista.find(x => x.id === f.id);
      assert.ok(linha, "fora do ledger, a soma de gasto do painel mente por baixo");
      assert.strictEqual(linha.status, "cancelada");
      assert.strictEqual(linha.etapaFinal, 4, "tem que dizer ONDE parou");
    });

  } finally {
    for (const id of [...sessions.keys()]) if (id.startsWith("tzzteste")) sessions.delete(id);
    if (antes) fs.writeFileSync(LEDGER, antes);
    else if (fs.existsSync(LEDGER)) fs.unlinkSync(LEDGER);
  }

  console.log("\npassou: " + ok + " ok, " + bad + " falha(s)\n");
  process.exit(bad ? 1 : 0);
})();
