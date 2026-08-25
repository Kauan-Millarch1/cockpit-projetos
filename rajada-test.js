/* rajada-test.js — as LEITURAS do `n8n.js`: quantas vão de uma vez, e o que
 * volta no fio.
 *
 * Duas coisas foram medidas em 2026-08-20 e as duas viraram código aqui:
 *
 *   1. `MAX_INFLIGHT = 4` existe desde o primeiro dia e NUNCA foi usado pelos
 *      laços que mais custam. Um `for` com `await request(...)` dentro mantém
 *      `inFlight` em 1, então três quartos do orçamento declarado ficavam
 *      parados: `callers()` levava 18,3s para 75 GETs de ~248ms, e o laço de
 *      detalhe de erro do `overview()` levava ~19s num dia com 40 falhas —
 *      no caminho crítico do boot da página. Pior: o comentário do
 *      `ERROR_DETAIL_CAP` AFIRMAVA "serialized behind MAX_INFLIGHT", o que era
 *      falso. Um comentário errado é pior que nenhum, porque parece conferido.
 *
 *   2. 43% do payload de `/api/n8n/overview` não tinha consumidor nenhum.
 *
 * O caso que carrega este arquivo é o do bloco 4: `stoppedAt` NÃO atravessa o
 * fio e PRECISA continuar existindo dentro do processo, porque é ele que o
 * `poll()` compara para saber que uma execução terminou. Tirá-lo da whitelist
 * economiza 37KB e para o painel de perceber execução concluída — em silêncio,
 * sem erro, sem log. O par de casos "o campo não sai" + "o delta ainda vê o
 * campo" é o que impede as duas metades de divergirem.
 *
 * DE GRAÇA e sem falar com a instância. Os blocos 1 e 2 são funções puras. Os
 * blocos 3 a 6 usam uma CÓPIA de `n8n.js` num diretório SEM `.env`, contra um
 * servidor HTTP local — `loadConfig()` lê o `.env` do próprio diretório e ele
 * VENCE o `process.env`, então rodar isto na pasta do projeto falaria com a
 * instância de produção do Kauan. A cópia é conferida byte a byte.
 *
 * node rajada-test.js */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const n8n = require("./n8n.js");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}
const espera = ms => new Promise(r => setTimeout(r, ms));

/* O teto vem do ARQUIVO, não daqui. Cravar 4 no teste faria ele continuar verde
   no dia em que alguém subisse `MAX_INFLIGHT` sem medir nada. */
const FONTE = fs.readFileSync(path.join(__dirname, "n8n.js"), "utf8");
const TETO = n8n.MAX_INFLIGHT;

(async () => {

  /* ══════════════════ 1. a rajada: largura, ordem e rede de erro ═════════ */

  console.log("\n[ 01 ] emRajada — o teto é honrado e a ordem é a da entrada");

  t("o teto do arquivo é um número > 1", Number.isInteger(TETO) && TETO > 1);
  t("`MAX_INFLIGHT` continua sendo a largura padrão da rajada",
    /async function emRajada\(itens, trabalho, largura = MAX_INFLIGHT\)/.test(FONTE));

  {
    let vivos = 0, maximo = 0, feitos = 0;
    const itens = Array.from({ length: 40 }, (_, i) => i);
    const saida = await n8n.emRajada(itens, async i => {
      vivos++; maximo = Math.max(maximo, vivos);
      /* Atraso DECRESCENTE: o item mais tarde responde mais rápido. É isso que
         mata o mutante que troca `out[i] = …` por `out.push(…)` — com `push` a
         saída sai na ordem em que as respostas voltaram. */
      await espera(2 + (40 - i) * 0.5);
      vivos--; feitos++;
      return "v" + i;
    });
    t("nunca passou do teto declarado no arquivo", maximo <= TETO);
    t("...e usou o orçamento inteiro (não ficou em 1)", maximo === TETO);
    t("todo item foi trabalhado exatamente uma vez", feitos === 40);
    t("a saída está na ordem da ENTRADA, não na de chegada",
      saida.join(",") === itens.map(i => "v" + i).join(","));
    t("nada de `push` na rajada — o resultado vai para a posição do item",
      !/out\.push/.test((FONTE.match(/async function emRajada\([\s\S]*?\n\}/) || [""])[0]));
  }

  {
    // Menos itens que o teto: não abre trilha vazia, e não trava com lista vazia.
    let maximo = 0, vivos = 0;
    await n8n.emRajada([1, 2], async () => { vivos++; maximo = Math.max(maximo, vivos); await espera(15); vivos--; });
    t("com 2 itens abre 2 trilhas, não " + TETO, maximo === 2);
    t("lista vazia devolve lista vazia sem travar", (await n8n.emRajada([], async () => 1)).length === 0);
  }

  {
    /* A rede: um `trabalho` que lança não pode deixar as outras trilhas
       correndo soltas — `inFlight` só volta a zero no `finally` de cada
       requisição, e uma trilha órfã seguiria consumindo o orçamento depois de o
       chamador já ter recebido o erro. */
    let comecados = 0, terminados = 0;
    let erro = null;
    try {
      await n8n.emRajada(Array.from({ length: 12 }, (_, i) => i), async i => {
        comecados++;
        await espera(5);
        if (i === 1) throw new Error("estourei no item 1");
        terminados++;
      });
    } catch (e) { erro = e; }
    t("o erro do trabalho SOBE para quem chamou", erro && /item 1/.test(erro.message));
    t("...e toda trilha drenou antes disso (nenhuma ficou órfã)",
      comecados === 12 && terminados === 11);
  }

  /* ══════════════════ 2. o filtro de saída, como função pura ═════════════ */

  console.log("\n[ 02 ] paraOFio — estreita, e não encosta no objeto de dentro");

  t("a lista do que não atravessa é exatamente os três campos",
    n8n.FORA_DO_FIO.slice().sort().join(",") === "retryOf,stoppedAt,waiting");

  {
    const dentro = { id: "1", status: "success", mode: "webhook", startedAt: "a", stoppedAt: "b", ms: 5, waiting: false, retryOf: null };
    const fora = n8n.paraOFio(dentro);
    t("`stoppedAt` não sai", !("stoppedAt" in fora));
    t("`waiting` não sai", !("waiting" in fora));
    t("`retryOf` não sai", !("retryOf" in fora));
    t("`ms` sai — é a forma útil do mesmo instante", fora.ms === 5);
    t("`startedAt` sai", fora.startedAt === "a");
    /* `mode` tem UM consumidor de verdade (`flows.html:4828`, no `title` do
       hover). Removê-lo daqui deixaria `undefined` na tela, e isso é decisão de
       tela. O caso existe para que a próxima limpeza não o tire sem ler isto. */
    t("`mode` FICA — tem consumidor no title do feed", fora.mode === "webhook");
    /* O mutante que mata: `paraOFio` deletando do próprio objeto. Aplicada em
       cima de uma linha de `state.execs`, ela apagaria o `stoppedAt` que o
       `poll()` usa — e a detecção de delta morreria sem uma linha de erro. */
    t("NÃO mutou o objeto de dentro (ele é o do `state.execs`)", dentro.stoppedAt === "b");
    t("...nem os outros dois", dentro.waiting === false && "retryOf" in dentro);
  }

  t("nulo e não-objeto passam intactos",
    n8n.paraOFio(null) === null && n8n.paraOFio(7) === 7);

  /* ════════════ 3. o servidor de mentira e a cópia sem `.env` ════════════ */

  console.log("\n[ 03 ] a cópia, e o que o servidor local vê chegar");

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rajada-test-"));
  for (const f of ["n8n.js", "simulate.js"]) fs.copyFileSync(path.join(__dirname, f), path.join(TMP, f));
  t("a cópia de n8n.js é idêntica à do projeto",
    fs.readFileSync(path.join(TMP, "n8n.js")).equals(fs.readFileSync(path.join(__dirname, "n8n.js"))));

  const N_WF = 12;
  const IDS_WF = Array.from({ length: N_WF }, (_, i) => "w" + String(i + 1).padStart(2, "0"));
  const QUEBRADO = "w06";                      // 404: vira `falhas++`, não exceção
  const CHAMAM_C1 = ["w01", "w03", "w05", "w07", "w09", "w11"];

  const N_ERRO = 45;                           // acima de ERROR_DETAIL_CAP (40)
  const N_OK = 5;
  const agora = Date.now();
  const execs = [];
  for (let i = 0; i < N_ERRO + N_OK; i++) {
    execs.push({
      id: String(500000 - i),
      workflowId: "w01",
      status: i < N_ERRO ? "error" : "success",
      mode: "trigger",
      startedAt: new Date(agora - i * 1000).toISOString(),
      stoppedAt: new Date(agora - i * 1000 + 90).toISOString(),
      retryOf: null,
      waitTill: null
    });
  }
  const porId = new Map(execs.map(e => [e.id, e]));

  /* Contadores por FAMÍLIA de rota: o que interessa é quantos GETs de workflow
     e quantos de detalhe estavam no ar ao mesmo tempo, não o total. */
  const conta = {
    wf: { vivos: 0, max: 0, n: 0 },
    det: { vivos: 0, max: 0, n: 0 },
    lista: { n: 0 }
  };
  function abre(k) { conta[k].vivos++; conta[k].n++; conta[k].max = Math.max(conta[k].max, conta[k].vivos); }
  function fecha(k) { conta[k].vivos--; }

  const docWf = id => ({
    id,
    name: "fluxo " + id,
    active: id === "w01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    tags: [],
    nodes: [
      { name: "gatilho", type: "n8n-nodes-base.scheduleTrigger", position: [0, 0], parameters: {} },
      ...(CHAMAM_C1.includes(id)
        ? [{ name: "chama_c1_" + id, type: "n8n-nodes-base.executeWorkflow", position: [10, 0], parameters: { workflowId: { __rl: true, value: "c1", mode: "list" } } }]
        : []),
      ...(id === "w02"
        ? [{ name: "chama_c2", type: "n8n-nodes-base.executeWorkflow", position: [20, 0], parameters: { workflowId: "c2" } }]
        : [])
    ],
    connections: {}
  });

  const detalhe = e => ({
    ...e,
    workflowData: { nodes: [{ name: "no_a", type: "n8n-nodes-base.slack", parameters: {} }] },
    data: {
      resultData: {
        lastNodeExecuted: "no_a",
        runData: { no_a: [{ executionIndex: 0, executionTime: 7, startTime: 1, executionStatus: e.status, data: { main: [[{ json: { ok: 1 } }]] } }] },
        error: e.status !== "error" ? null : {
          name: "NodeApiError",
          message: "deu ruim",
          node: {
            name: "no_a", type: "n8n-nodes-base.slack",
            // os dois campos que a fronteira existe para barrar
            credentials: { slackApi: { id: "9", name: "Slack Ecommerce Puro" } },
            parameters: { sessionKey: "tel:5541999998888", token: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb" }
          }
        }
      }
    }
  });

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const responde = async (k, atraso, corpo, status = 200) => {
      if (k) abre(k);
      await espera(atraso);
      if (k) fecha(k);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(corpo));
    };
    if (u.pathname === "/api/v1/workflows") {
      conta.lista.n++;
      return responde(null, 5, { data: IDS_WF.map(docWf), nextCursor: null });
    }
    const mWf = u.pathname.match(/^\/api\/v1\/workflows\/(.+)$/);
    if (mWf) {
      const id = decodeURIComponent(mWf[1]);
      if (id === QUEBRADO) { abre("wf"); fecha("wf"); res.statusCode = 404; return res.end("404"); }
      /* Atraso DECRESCENTE por posição: o fluxo mais ao fim da lista responde
         mais rápido. Com `push` no lugar de `out[i]`, `porFilho.c1` sairia
         embaralhado — e o desempate por contagem de execução na tela nomearia um
         chamador diferente a cada refresh. */
      const pos = IDS_WF.indexOf(id);
      return responde("wf", 30 + (N_WF - pos) * 6, docWf(id));
    }
    if (u.pathname === "/api/v1/executions") {
      conta.lista.n++;
      return responde(null, 5, { data: execs, nextCursor: null });
    }
    const mEx = u.pathname.match(/^\/api\/v1\/executions\/(\d+)$/);
    if (mEx) {
      const e = porId.get(mEx[1]);
      if (!e) { res.statusCode = 404; return res.end("404"); }
      if (u.searchParams.get("includeData") !== "true") return responde(null, 5, e);
      const pos = execs.indexOf(e);
      return responde("det", 25 + (execs.length - pos) * 2, detalhe(e));
    }
    res.statusCode = 404; res.end("404");
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  fs.writeFileSync(path.join(TMP, ".env"),
    "N8N_BASE_URL=http://127.0.0.1:" + srv.address().port + "\nN8N_API_KEY=chave-de-mentira\n");

  const copia = require(path.join(TMP, "n8n.js"));
  t("a cópia acha o servidor de mentira, não o `.env` do projeto", copia.instance.startsWith("http://127.0.0.1:"));

  /* ══════════════ 4. `callers()` — teto, ordem, `falhas` e TTL ═══════════ */

  console.log("\n[ 04 ] callers: em rajada, na ordem da lista, e o `falhas` ainda conta");

  /* O `try` existe para o mutante que volta a LANÇAR no lugar de contar: sem
     ele a exceção aborta o arquivo, e um teste que morre no meio não diz qual
     decisão foi violada — diz só que algo explodiu. */
  const t0 = Date.now();
  let c1 = null, estourou = null;
  try { c1 = await copia.callers({ force: true }); }
  catch (e) { estourou = e; c1 = { porFilho: {}, lidos: -1, falhas: -1, total: -1 }; }
  const msRajada = Date.now() - t0;

  t("um fluxo que não abre NÃO derruba a varredura", !estourou);
  t("leu os " + (N_WF - 1) + " que respondem", c1.lidos === N_WF - 1);
  t("o 404 virou `falhas`, não exceção", c1.falhas === 1);
  t("...e nem um GET a menos foi feito", conta.wf.n === N_WF);
  t("`total` é o tamanho da lista", c1.total === N_WF);

  t("mais de um GET de workflow no ar ao mesmo tempo", conta.wf.max > 1);
  t("...e nunca mais que o teto do arquivo (" + TETO + ")", conta.wf.max <= TETO);
  t("...usando o orçamento inteiro", conta.wf.max === TETO);

  /* O tempo é secundário — o contador acima é o fato — mas serve de rede contra
     uma implementação que abra N trilhas e as serialize por dentro. Sequencial,
     estes 11 GETs somariam > 700ms. */
  console.log("      (rajada levou " + msRajada + "ms; sequencial seria ~" +
    IDS_WF.reduce((a, id, i) => a + (id === QUEBRADO ? 0 : 30 + (N_WF - i) * 6), 0) + "ms)");
  t("o relógio confirma que não foi sequencial", msRajada < 500);

  t("`porFilho` achou os dois filhos", Object.keys(c1.porFilho).sort().join(",") === "c1,c2");
  t("a ordem de `porFilho.c1` é a da LISTA, não a de chegada",
    c1.porFilho.c1.map(x => x.id).join(",") === CHAMAM_C1.join(","));
  t("cada chamador traz o nó chamador certo",
    c1.porFilho.c1.every(x => x.viaNode === "chama_c1_" + x.id));
  t("o `workflowId` string crua também é lido (versão antiga do nó)",
    c1.porFilho.c2.length === 1 && c1.porFilho.c2[0].id === "w02");
  t("nada de `parameters` ou `nodes` atravessou",
    !/parameters|"nodes"|credentials/.test(JSON.stringify(c1)));

  {
    const antes = conta.wf.n;
    const c2 = await copia.callers({});
    t("o TTL de 15 min ainda vale — a segunda chamada não fez GET nenhum", conta.wf.n === antes);
    t("...e devolveu o mesmo objeto", c2 === c1);
  }
  t("o teto de varredura continua no laço", /rows\.slice\(0, CALLERS_SCAN_CAP\)/.test(FONTE));
  t("o TTL continua sendo 15 min", /const CALLERS_TTL_MS = 15 \* 60 \* 1000/.test(FONTE));

  /* ═════════ 5. `overview()` — detalhe em rajada, teto e o que sai ═══════ */

  console.log("\n[ 05 ] overview: detalhe em rajada, o teto de pé, e o fio limpo");

  const t1 = Date.now();
  const ov = await copia.overview();
  const msOv = Date.now() - t1;

  t("pediu detalhe só até o teto", conta.det.n === 40);
  t("`ERROR_DETAIL_CAP` continua sendo 40", /const ERROR_DETAIL_CAP = 40/.test(FONTE));
  t("o `slice` do teto continua no laço", /errored\.slice\(0, ERROR_DETAIL_CAP\)/.test(FONTE));
  t("mais de um detalhe no ar ao mesmo tempo", conta.det.max > 1);
  t("...e nunca mais que o teto", conta.det.max <= TETO);
  t("...usando o orçamento inteiro", conta.det.max === TETO);
  console.log("      (40 detalhes em " + msOv + "ms)");

  t("`errorsTotal` conta as " + N_ERRO + " falhas da janela", ov.errorsTotal === N_ERRO);
  t("`errorsDetailed` conta as 40 que voltaram", ov.errorsDetailed === 40);
  t("`errorsTruncated` continua dizendo que o quadro é um piso", ov.errorsTruncated === true);
  t("a ordem dos detalhes é a mais nova primeiro (a de `errored`)",
    ov.errors.map(d => Number(d.id)).every((v, i, a) => i === 0 || a[i - 1] > v));

  // --- o que NÃO atravessa mais, medido no objeto que a rota serve
  const semCampo = (arr, k) => arr.length > 0 && arr.every(o => !(k in o));
  t("nenhuma linha de execução leva `stoppedAt`", semCampo(ov.executions, "stoppedAt"));
  t("nenhuma leva `waiting`", semCampo(ov.executions, "waiting"));
  t("nenhuma leva `retryOf`", semCampo(ov.executions, "retryOf"));
  t("nenhum fluxo leva `triggers`", semCampo(ov.workflows, "triggers"));
  t("nenhum fluxo leva `createdAt`", semCampo(ov.workflows, "createdAt"));
  t("nenhum DETALHE leva `stoppedAt`", semCampo(ov.errors, "stoppedAt"));
  t("nenhum detalhe leva `waiting`/`retryOf`",
    semCampo(ov.errors, "waiting") && semCampo(ov.errors, "retryOf"));

  // --- e o que continua atravessando, porque tem consumidor
  t("`ms` continua vindo — é `stoppedAt` lido e descartado, não perdido",
    ov.executions.every(e => e.ms === 90));
  t("`startedAt` continua vindo", ov.executions.every(e => typeof e.startedAt === "string"));
  t("`mode` continua vindo (o title do feed)", ov.executions.every(e => e.mode === "trigger"));
  t("`updatedAt` do fluxo continua vindo", ov.workflows.every(w => typeof w.updatedAt === "string"));
  t("`nodeCount` continua vindo", ov.workflows.every(w => typeof w.nodeCount === "number"));
  t("`active` continua vindo", ov.workflows.some(w => w.active === true));
  t("o detalhe continua trazendo `nodeRuns` e `error.nodeName`",
    ov.errors.every(d => Array.isArray(d.nodeRuns) && d.error && d.error.nodeName === "no_a"));

  /* A fronteira antiga, conferida de novo porque esta tarefa mexeu na whitelist:
     nem credencial, nem chave de sessão, nem token atravessam. */
  {
    const fio = JSON.stringify(ov);
    t("nenhuma `credentials` no que a rota serve", !/credentials/.test(fio));
    t("nenhum `sessionKey`", !/sessionKey/.test(fio));
    t("nenhum token com cara de JWT", !/eyJhbGci/.test(fio));
    t("nenhum telefone do payload", !/5541999998888/.test(fio));
  }

  /* ═════════ 6. o par que não pode divergir: fio limpo, delta vivo ═══════ */

  console.log("\n[ 06 ] `stoppedAt` fora do fio E dentro do processo");

  t("`extractExecRow` ainda produz `stoppedAt`",
    /stoppedAt: stopped,\s*\/\/ process-local/.test(FONTE));
  t("...e o `poll` ainda compara por ele",
    /prev\.stoppedAt !== r\.stoppedAt/.test(FONTE));

  const p1 = await copia.poll();
  t("o primeiro poll depois do backfill não repete a janela inteira", p1.executions.length === 0);
  t("...e o que ele devolve também é limpo", !p1.executions.some(e => "stoppedAt" in e));

  // uma execução TERMINA: só `stoppedAt` muda, o status fica igual
  const alvo = execs[N_ERRO];                              // um `success`
  const statusAntes = alvo.status;
  alvo.stoppedAt = new Date(agora + 60000).toISOString();

  const p2 = await copia.poll();
  const achou = p2.executions.filter(e => e.id === alvo.id);
  t("o poll percebeu a execução que terminou (só `stoppedAt` mudou)", achou.length === 1);
  t("...sem o status ter mudado", alvo.status === statusAntes);
  t("...e a linha entregue continua sem `stoppedAt`", achou.length === 1 && !("stoppedAt" in achou[0]));
  const msEsperado = new Date(alvo.stoppedAt) - new Date(alvo.startedAt);
  t("...com o `ms` novo, que é como o cliente vê o fim",
    achou.length === 1 && achou[0].ms === msEsperado && msEsperado > 100000);

  const p3 = await copia.poll();
  t("nada mudou, nada volta — o delta não virou 'a janela toda'",
    !p3.executions.some(e => e.id === alvo.id));

  srv.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* o SO solta depois */ }

  console.log(bad
    ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
    : "\npassou: " + ok + " casos — as leituras usam o orçamento que já estava declarado, "
      + "e o fio só leva campo com consumidor (menos `stoppedAt`, que fica dentro)");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
