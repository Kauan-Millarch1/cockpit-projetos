/* reexec-test.js — reexecutar a execução que falhou, depois da correção.
 *
 * Cada caso rejeita UM defeito nomeado. A ordem importa menos que o motivo:
 * este é o único caminho do cockpit cujo efeito sai da instância e não tem
 * desfazer. Um erro aqui manda mensagem repetida para um cliente de verdade.
 *
 * Não custa nada: nenhum modelo, nenhuma chamada ao n8n. O cliente do n8n é
 * substituído no `require.cache` antes de `claude-fix` ser carregado.
 *
 * node reexec-test.js
 */

const path = require("path");

/* O n8n falso entra ANTES do require de claude-fix, senão ele fecha em cima do
   módulo real e o teste vira uma escrita na instância do Kauan. */
const n8nPath = require.resolve("./n8n");
const n8n = require(n8nPath);

const chamadas = [];
let execRow = null;      // o que `getExecRow` devolve
let execRowErro = null;  // ou o erro que ele lança
let retryResp = null;    // o que `retryExecution` devolve
let retryErro = null;    // ou o erro que ele lança

n8n.getExecRow = async id => {
  chamadas.push(["getExecRow", String(id)]);
  if (execRowErro) throw new Error(execRowErro);
  return execRow;
};
n8n.retryExecution = async (id, opt) => {
  chamadas.push(["retryExecution", String(id), opt]);
  if (retryErro) throw new Error(retryErro);
  return retryResp;
};

const cf = require("./claude-fix");

/* ------------------------------------------------------------------ harness */

let ok = 0;
const falhas = [];
function t(nome, fn) {
  try { fn(); ok++; }
  catch (err) { falhas.push(nome + "\n      " + (err && err.message ? err.message : String(err))); }
}
async function ta(nome, fn) {
  try { await fn(); ok++; }
  catch (err) { falhas.push(nome + "\n      " + (err && err.message ? err.message : String(err))); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || "esperava") + ": " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
}
function inclui(hay, needle) {
  if (!String(hay).includes(needle)) throw new Error("esperava conter " + JSON.stringify(needle) + ", veio " + JSON.stringify(String(hay)));
}
async function recusa(fn) {
  try { await fn(); } catch (err) { return err; }
  throw new Error("devia ter recusado, e passou");
}

/* Um run mínimo, direto no Map real. `persist` grava em proposals.json, que é
   rastreado em git — por isso ele é neutralizado por run, com um id que nunca
   colide com um de verdade. */
let seq = 0;
function novoRun(over) {
  const id = "rzztest" + (++seq);
  const run = Object.assign({
    id, key: "WF1|no_x|NodeApiError", wfId: "WF1", wfName: "Fluxo Pai",
    node: "no_x", lastNode: "no_x", redirected: null,
    status: "applied", stage: "review", round: 1,
    gates: null, diff: null, report: null, sandbox: null,
    error: null, cost: 0, log: [], activity: null, tools: {},
    eta: { medianMs: null, p80Ms: null, samples: 0 },
    startedAt: new Date().toISOString(), finishedAt: null,
    appliedAt: new Date().toISOString(), revertedAt: null,
    capturedUpdatedAt: null, sandboxId: null, sessionId: null, child: null,
    dir: path.join(__dirname, ".claude-runs", id),
    retries: []
  }, over || {});
  cf.runs.set(id, run);
  return run;
}
function limpar() {
  for (const id of [...cf.runs.keys()]) if (id.startsWith("rzztest")) cf.runs.delete(id);
  chamadas.length = 0;
  execRow = { id: "9001", workflowId: "WF1", status: "error", mode: "webhook", retryOf: null };
  execRowErro = null;
  retryResp = { id: "9002", workflowId: "WF1", status: "running", mode: "retry", retryOf: "9001" };
  retryErro = null;
}

/* `proposals.json` é ledger rastreado em git, e `retry` persiste nele de
   verdade — de propósito: o registro da reexecução É parte do que está sendo
   testado, e neutralizar a gravação provaria uma cópia.

   O que este teste NÃO pode fazer é salvar o arquivo inteiro e restaurá-lo por
   cima no fim. O cockpit do Kauan fica de pé o dia todo e escreve no mesmo
   arquivo; uma escrita dele entre a leitura e a restauração apagaria uma
   correção real. Então a limpeza é cirúrgica: tira só os runs deste teste
   (prefixo `rzztest`) do que estiver no disco NAQUELE momento, e não encosta em
   mais nada. */
const fs = require("fs");
const STORE = path.join(__dirname, "proposals.json");
const PREFIXO = "rzztest";

function limparLedger() {
  if (!fs.existsSync(STORE)) return 0;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return -1; }
  if (!doc || !Array.isArray(doc.proposals)) return -1;
  const antes = doc.proposals.length;
  doc.proposals = doc.proposals.filter(p => !String(p && p.runId || "").startsWith(PREFIXO));
  const tirados = antes - doc.proposals.length;
  if (tirados > 0) fs.writeFileSync(STORE, JSON.stringify(doc, null, 2), "utf8");
  return tirados;
}

(async function main() {

  /* ------------------------------------------------- 1. o alvo do sub-fluxo */
  // O DEFEITO: conferir a execução contra o fluxo CORRIGIDO. Numa falha de
  // sub-fluxo o diff foi aplicado no filho e quem rodou com o lead foi o pai —
  // essa conferência recusaria justamente os casos que importam (Iago,
  // eContrate), que são a maioria das falhas reais desta instância.
  t("alvo do retry é o fluxo corrigido quando não houve redirecionamento", () => {
    eq(cf.retryTargetWf({ wfId: "WF1", redirected: null }), "WF1");
  });
  t("alvo do retry é o PAI quando o Claude seguiu o sub-fluxo", () => {
    eq(cf.retryTargetWf({ wfId: "FILHO", redirected: { fromId: "PAI", toId: "FILHO" } }), "PAI",
      "a execução com o lead é a do pai, não a do filho corrigido");
  });

  /* ------------------------------------------------------ 2. estado do run */
  limpar();
  await ta("recusa reexecutar antes de aplicar — rodaria com o defeito ainda no fluxo", async () => {
    const r = novoRun({ status: "ready" });
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    inclui(err.message, "ainda não foi aplicada");
    eq(chamadas.length, 0, "não podia nem ter falado com o n8n");
  });

  limpar();
  await ta("recusa reexecutar depois de desfazer, com frase PRÓPRIA", async () => {
    const r = novoRun({ status: "reverted" });
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    inclui(err.message, "defeito de volta");
    // As duas recusas não podem ler igual: "ainda não aplicou" e "desfez" levam
    // a ações opostas — uma pede aplicar, a outra pede refazer a correção.
    if (err.message.includes("ainda não foi aplicada")) throw new Error("está usando a frase do estado errado");
  });

  limpar();
  await ta("run desconhecido é 404, não 500", async () => {
    const err = await recusa(() => cf.retry("rzznaoexiste", "9001"));
    eq(err.status, 404);
  });

  /* -------------------------------------------------------- 3. o id que vem */
  limpar();
  await ta("recusa execId que não é número — vem do cliente", async () => {
    const r = novoRun();
    for (const mau of ["../9001", "9001; DROP", "", "abc", "9".repeat(30)]) {
      const err = await recusa(() => cf.retry(r.id, mau));
      eq(err.status, 400, "id " + JSON.stringify(mau));
    }
    eq(chamadas.length, 0);
  });

  limpar();
  await ta("recusa execução de OUTRO fluxo, mesmo com o cliente afirmando", async () => {
    const r = novoRun();
    execRow = { id: "9001", workflowId: "OUTRO", status: "error" };
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    inclui(err.message, "OUTRO");
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 0, "não podia ter escrito");
  });

  limpar();
  await ta("recusa execução que NÃO falhou", async () => {
    const r = novoRun();
    execRow = { id: "9001", workflowId: "WF1", status: "success" };
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    inclui(err.message, "success");
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 0);
  });

  limpar();
  await ta("aceita execução crashed, não só error", async () => {
    const r = novoRun();
    execRow = { id: "9001", workflowId: "WF1", status: "crashed" };
    await cf.retry(r.id, "9001");
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 1);
  });

  /* ------------------------------------------------ 4. o caminho que funciona */
  limpar();
  await ta("reexecuta com loadWorkflow: true — sem isso rodaria com o defeito", async () => {
    const r = novoRun();
    const snap = await cf.retry(r.id, "9001");
    const c = chamadas.find(x => x[0] === "retryExecution");
    eq(c[1], "9001");
    eq(c[2].loadWorkflow, true, "sem loadWorkflow o n8n reexecuta o workflow salvo NA ÉPOCA, com o bug");
    eq(snap.retries.length, 1);
    eq(snap.retries[0].state, "ok");
    eq(snap.retries[0].newExecId, "9002");
  });

  limpar();
  await ta("num caso de sub-fluxo, confere contra o PAI e deixa passar", async () => {
    const r = novoRun({ wfId: "FILHO", redirected: { fromId: "PAI", toId: "FILHO" } });
    execRow = { id: "9001", workflowId: "PAI", status: "error" };
    const snap = await cf.retry(r.id, "9001");
    eq(snap.retries[0].state, "ok");
    eq(snap.retryWfId, "PAI");
  });

  /* --------------------------------------------------- 5. o duplo clique */
  // O DEFEITO que esta feature existe para NÃO causar: dois cliques = duas
  // mensagens para o mesmo lead.
  limpar();
  await ta("recusa reexecutar duas vezes a mesma execução", async () => {
    const r = novoRun();
    await cf.retry(r.id, "9001");
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    inclui(err.message, "já foi reexecutada");
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 1, "escreveu duas vezes");
  });

  limpar();
  await ta("recusa quando a tentativa anterior NÃO voltou — resposta perdida não é ausência de efeito", async () => {
    const r = novoRun();
    r.retries.push({ execId: "9001", state: "enviado", newExecId: null, at: new Date().toISOString() });
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    inclui(err.message, "em voo");
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 0);
  });

  limpar();
  await ta("permite tentar de novo depois de um erro confirmado", async () => {
    const r = novoRun();
    r.retries.push({ execId: "9001", state: "erro", newExecId: null, error: "500", at: new Date().toISOString() });
    await cf.retry(r.id, "9001");
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 1);
  });

  limpar();
  await ta("NÃO permite tentar de novo depois de um estado incerto", async () => {
    const r = novoRun();
    r.retries.push({ execId: "9001", state: "incerto", newExecId: null, error: "socket hang up", at: new Date().toISOString() });
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409);
    eq(chamadas.filter(c => c[0] === "retryExecution").length, 0, "incerto não pode virar segunda mensagem");
  });

  /* ------------------------------------- 6. o registro nasce ANTES da chamada */
  // O DEFEITO: gravar só no sucesso. Uma resposta perdida deixaria uma mensagem
  // enviada sem rastro nenhum, e o clique seguinte a enviaria de novo.
  /* A distinção que decide se tentar de novo é seguro. `request` só carimba
     `err.status` quando o n8n RESPONDEU. Tratar os dois casos igual liberava a
     segunda tentativa justamente quando ela duplica a mensagem. */
  limpar();
  await ta("resposta PERDIDA fica incerta e bloqueia a próxima tentativa", async () => {
    const r = novoRun();
    retryErro = "socket hang up";                    // sem .status: fetch morreu
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 409, "409 é o código que faz a tela NÃO oferecer o botão");
    eq(r.retries.length, 1, "a tentativa tem que ficar registrada mesmo tendo falhado");
    eq(r.retries[0].state, "incerto");
    inclui(err.message, "não prova que ela não começou");
    // E a próxima tentativa tem que bater na trava.
    retryErro = null;
    const err2 = await recusa(() => cf.retry(r.id, "9001"));
    eq(err2.status, 409);
    inclui(err2.message, "em voo");
  });

  limpar();
  await ta("n8n que RESPONDEU e recusou é erro confirmado — nada rodou, pode tentar de novo", async () => {
    const r = novoRun();
    const e = new Error("n8n 400 em /api/v1/executions/9001/retry: bad request");
    e.status = 400;
    n8n.retryExecution = async () => { throw e; };
    const err = await recusa(() => cf.retry(r.id, "9001"));
    eq(err.status, 502, "502 é o código que libera o botão de tentar de novo");
    eq(r.retries[0].state, "erro");
    inclui(err.message, "nada rodou");
    // E a próxima tentativa passa.
    n8n.retryExecution = async (id, opt) => { chamadas.push(["retryExecution", String(id), opt]); return retryResp; };
    await cf.retry(r.id, "9001");
    eq(r.retries.length, 2);
    eq(r.retries[1].state, "ok");
  });

  limpar();
  await ta("o registro já existe no momento em que o n8n é chamado", async () => {
    const r = novoRun();
    let noMomentoDaChamada = null;
    n8n.retryExecution = async (id, opt) => {
      chamadas.push(["retryExecution", String(id), opt]);
      noMomentoDaChamada = JSON.parse(JSON.stringify(r.retries));
      return retryResp;
    };
    await cf.retry(r.id, "9001");
    eq(noMomentoDaChamada.length, 1, "o registro tem que nascer antes da escrita, não depois");
    eq(noMomentoDaChamada[0].state, "enviado");
  });

  /* ------------------------------------- 7. a classificação, extraída da tela */
  // `reexecClasse` mora no bloco de juízo do flows.html e não é módulo Node —
  // mesma solução que os geradores de preview usam: extrair na hora, para o
  // teste não poder divergir da tela.
  await ta("a classificação da tela é fail-closed", async () => {
    const html = fs.readFileSync(path.join(__dirname, "flows.html"), "utf8");
    const grab = nome => {
      const i = html.indexOf("const " + nome);
      if (i < 0) throw new Error("não achei " + nome + " no flows.html");
      return i;
    };
    const ini = grab("REEXEC_AMBIGUO");
    const fim = html.indexOf("const REEXEC_LIMPO_TXT");
    if (fim < 0) throw new Error("não achei o fim do bloco de reexecução");
    const src = html.slice(ini, fim);
    const reexecClasse = new Function(src + "\n return reexecClasse;")();

    eq(reexecClasse({ error: { message: "required JSON field 'text'" } }).classe, "limpo");
    eq(reexecClasse({ error: { message: "Cannot read properties of undefined" } }).classe, "limpo");
    eq(reexecClasse({ error: { message: "ETIMEDOUT" } }).classe, "ambiguo");
    eq(reexecClasse({ error: { message: "status code 429" } }).classe, "ambiguo");
    eq(reexecClasse({ error: { message: "status code 502 bad gateway" } }).classe, "ambiguo");
    // O caso que decide o desenho todo: erro NOVO, nunca visto. Cair em "limpo"
    // mandaria mensagem repetida sozinha, sem ninguém olhando.
    eq(reexecClasse({ error: { message: "coisa que nunca aconteceu antes" } }).classe, "ambiguo",
      "erro desconhecido tem que ser ambíguo — o default não pode ser o que dispara sozinho");
    eq(reexecClasse(null).classe, "ambiguo");
    eq(reexecClasse({}).classe, "ambiguo");
    // Um erro que casa nas duas listas é ambíguo: o risco vence.
    eq(reexecClasse({ error: { message: "ExpressionError depois de ETIMEDOUT" } }).classe, "ambiguo",
      "casando nas duas, quem vence é o risco");
  });

  /* ------------------------------------------------------------------ fecho */
  limpar();
  const tirados = limparLedger();
  if (tirados < 0) console.log("aviso: não consegui ler proposals.json para limpar os runs de teste");
  // Falhar não pode deixar lixo no ledger: a limpeza vem antes da saída, nos
  // dois caminhos.
  if (falhas.length) {
    console.log("\nfalhou: " + falhas.length + " de " + (ok + falhas.length));
    for (const f of falhas) console.log("  ✕ " + f);
    process.exit(1);
  }
  console.log("passou: " + ok + " ok, 0 falha(s)");
})().catch(err => {
  // Um erro fora dos casos (require quebrado, mudança de assinatura) não pode
  // deixar run de teste no ledger que vai para o git.
  limparLedger();
  console.log("quebrou fora dos casos: " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
