/* mutex-test.js — ETAPA 3 de quatro, a última antes da aba (PLAN-UPGRADE.md §6.5).
 *
 * A fila de escrita é process-wide e REENTRANTE POR DONO. A palavra
 * "reentrante" é a razão de a etapa 0 existir antes desta: o approve da aba
 * Upgrade escreve duas vezes e a de dentro fica DENTRO da de fora —
 * `escreverAprovado` segura a região inteira e a checagem 7 dos portões grava a
 * cópia `[SANDBOX upgrade]` enquanto ela está segura. Numa fila não reentrante a
 * escrita de dentro espera pela de fora, que espera por ela.
 *
 * O sintoma seria um DEADLOCK que só aparece com a checagem 7 ligada — que é o
 * padrão novo daquela aba. Um deadlock não deixa rastro: a tela fica parada e
 * ninguém sabe se o n8n está lento ou se o cockpit travou. Por isso ele é
 * provado aqui, com um teto de tempo curto, antes de existir a aba.
 *
 * O teto vem de `COCKPIT_ESCRITA_TIMEOUT_MS`, cravado ANTES do require —
 * `ESCRITA_TIMEOUT_MS` é lido no carregamento do módulo. (Não confundir com o
 * `.env`, que vence o `process.env` só para `N8N_BASE_URL`/`N8N_API_KEY`.)
 *
 * De graça, e nada fala com a instância: os blocos 1 a 5 exercitam a fila de
 * verdade sem nenhuma requisição, e o bloco 6 usa uma CÓPIA de `n8n.js` num
 * diretório sem `.env`, contra um servidor HTTP local.
 *
 * node mutex-test.js */

process.env.COCKPIT_ESCRITA_TIMEOUT_MS = "300";

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
async function recusa(f) { try { await f(); return null; } catch (e) { return e; } }
const dono = (ref, oque) => n8n.writeOwner("fix", ref, oque);

/* Um deadlock não falha: ele PARA. Sem esta corrida contra o relógio o teste
   ficaria pendurado para sempre e o CI mostraria "rodando", não "vermelho". */
async function comTeto(ms, p) {
  let estourou = false;
  const alarme = espera(ms).then(() => { estourou = true; });
  const r = await Promise.race([p.then(v => ({ v })).catch(e => ({ e })), alarme]);
  return estourou ? { travou: true } : r;
}

(async () => {

  /* ─────────────────── 1. reentrância: o mesmo dono nunca espera ───────── */

  console.log("\n[ 01 ] reentrância — o dono não espera por si mesmo");

  t("ninguém está com a vez no começo", n8n.donoDaEscrita().id === null);

  const d1 = dono("r1", "aplicando correção em Fluxo Vivo");
  const dentro = [];
  const r1 = await comTeto(1500, n8n.comEscrita(d1, async () => {
    dentro.push("fora");
    /* ESTA é a forma da checagem 7: uma escrita acontecendo dentro de uma
       região já segura pelo mesmo dono. Numa fila não reentrante ela espera
       pela de fora, que só solta quando ela terminar. */
    await n8n.comEscrita(d1, async () => {
      dentro.push("dentro");
      await n8n.comEscrita(d1, async () => { dentro.push("mais dentro"); });
    });
    return "pronto";
  }));
  t("não travou — a escrita de dentro entrou", !r1.travou);
  t("...e rodou na ordem, três níveis", dentro.join(">") === "fora>dentro>mais dentro");
  t("...devolvendo o valor de fora", r1.v === "pronto");
  t("e a vez foi solta no fim", n8n.donoDaEscrita().id === null);

  /* A profundidade é o que separa reentrar de soltar. Se o nível de dentro
     soltasse a vez, outro dono escreveria no meio da região protegida. */
  let profundoVisto = 0, donoNoMeio = null;
  await n8n.comEscrita(d1, async () => {
    await n8n.comEscrita(d1, async () => {
      profundoVisto = n8n.donoDaEscrita().profundidade;
    });
    donoNoMeio = n8n.donoDaEscrita().id;   // depois do nível de dentro sair
  });
  t("reentrar conta profundidade, não troca de dono", profundoVisto === 2);
  t("...e sair do nível de dentro NÃO solta a vez", donoNoMeio === "fix:r1");

  /* ──────────── 2. outro dono espera, em vez de intercalar ─────────────── */

  console.log("\n[ 02 ] outro dono espera — nunca intercala");

  const dA = dono("ra", "aplicando correção em A");
  const dB = dono("rb", "testando o fluxo numa cópia de B");
  const ordem = [];

  const pA = n8n.comEscrita(dA, async () => {
    ordem.push("A entrou");
    await espera(80);
    ordem.push("A saiu");
  });
  await espera(10);                      // garante que A pegou a vez primeiro
  const vistoDuranteA = n8n.donoDaEscrita();
  const pB = n8n.comEscrita(dB, async () => { ordem.push("B entrou"); ordem.push("B saiu"); });
  await espera(10);
  const esperandoDuranteA = n8n.donoDaEscrita().esperando;
  await Promise.all([pA, pB]);

  t("B não intercalou — entrou só depois de A sair",
    ordem.join(" > ") === "A entrou > A saiu > B entrou > B saiu");
  t("durante A, o dono corrente é A", vistoDuranteA.id === "fix:ra");
  t("...e a frase dele é legível para a tela", vistoDuranteA.doing === "aplicando correção em A");
  t("...e a fila reporta 1 esperando", esperandoDuranteA === 1);
  t("no fim ninguém segura a vez", n8n.donoDaEscrita().id === null);

  /* Ordem de chegada, não de sorte: três donos, três posições. */
  const chegada = [];
  const seguro = n8n.comEscrita(dA, async () => { await espera(60); });
  await espera(5);
  const p1 = n8n.comEscrita(dono("rc", "c"), async () => { chegada.push("c"); });
  const p2 = n8n.comEscrita(dono("rd", "d"), async () => { chegada.push("d"); });
  const p3 = n8n.comEscrita(dono("re", "e"), async () => { chegada.push("e"); });
  await Promise.all([seguro, p1, p2, p3]);
  t("a fila é por ordem de chegada", chegada.join("") === "cde");

  /* ────────────── 3. o teto, e o erro que nomeia quem está lá ─────────── */

  console.log("\n[ 03 ] a espera tem teto, e o erro diz por quem esperava");

  t("o teto veio do ambiente", n8n.ESCRITA_TIMEOUT_MS === 300);

  const preso = n8n.comEscrita(dA, async () => { await espera(700); });
  await espera(10);
  const err = await recusa(() => n8n.comEscrita(dB, async () => { throw new Error("nunca deveria rodar"); }));
  t("quem espera demais recebe erro", !!err);
  t("...com 409 — o cockpit está ocupado, não quebrado", (err || {}).status === 409);
  /* Sem o nome do dono corrente, "esperando" e "travado" são a mesma tela. */
  t("...e o erro NOMEIA o dono corrente", /aplicando correção em A/.test((err || {}).message || ""));
  t("...dizendo quanto esperou", /0s|1s/.test((err || {}).message || ""));
  t("...e NÃO é a mensagem do trabalho recusado", !/nunca deveria rodar/.test((err || {}).message || ""));
  await preso;
  t("depois que o dono solta, a vez fica livre de novo", n8n.donoDaEscrita().id === null);
  t("...e a fila esvaziou, sem deixar quem desistiu pendurado", n8n.donoDaEscrita().esperando === 0);

  /* ──────────── 4. escrita que joga não pode travar a fila ────────────── */

  console.log("\n[ 04 ] um erro na escrita solta a vez");

  const quebrou = await recusa(() => n8n.comEscrita(dA, async () => { throw new Error("n8n 503"); }));
  t("o erro da escrita sobe", /503/.test((quebrou || {}).message || ""));
  t("...e a vez foi solta", n8n.donoDaEscrita().id === null);
  const depois = await comTeto(500, n8n.comEscrita(dB, async () => "passou"));
  t("...então o próximo escreve normalmente", depois.v === "passou");

  /* O mesmo, mas jogando de DENTRO de uma reentrância: a profundidade tem de
     desenrolar até zero, senão a vez fica presa em um dono que já saiu. */
  const dentroQuebrou = await recusa(() => n8n.comEscrita(dA, async () => {
    await n8n.comEscrita(dA, async () => { throw new Error("caiu no nível de dentro"); });
  }));
  t("erro dentro da reentrância sobe", /nível de dentro/.test((dentroQuebrou || {}).message || ""));
  t("...e a profundidade desenrolou até zero", n8n.donoDaEscrita().id === null && n8n.donoDaEscrita().profundidade === 0);

  /* ─────────────── 5. sem dono não se entra na fila ──────────────────── */

  console.log("\n[ 05 ] a fila herda a exigência da etapa 0");

  const semDono = await recusa(() => n8n.comEscrita(undefined, async () => "x"));
  t("comEscrita sem dono é recusado", !!semDono);
  t("...nomeando a função", /comEscrita/.test((semDono || {}).message || ""));
  t("...e não deixou a vez tomada", n8n.donoDaEscrita().id === null);

  /* ──────── 6. concorrência de verdade, no caminho HTTP, numa cópia ───── */

  console.log("\n[ 06 ] dois putWorkflow concorrentes, contra um servidor local");

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mutex-test-"));
  /* Uma CÓPIA de `n8n.js`, feita agora, num diretório SEM `.env`: `loadConfig()`
     lê o `.env` do próprio diretório e ele vence o `process.env`, então rodar
     isto na pasta do projeto falaria com a instância de produção do Kauan.
     A cópia é conferida byte a byte para não haver como ela divergir. */
  for (const f of ["n8n.js", "simulate.js"]) fs.copyFileSync(path.join(__dirname, f), path.join(TMP, f));
  t("a cópia de n8n.js é idêntica à do projeto",
    fs.readFileSync(path.join(TMP, "n8n.js")).equals(fs.readFileSync(path.join(__dirname, "n8n.js"))));

  const emVoo = [];
  const marcas = [];
  let liberar = null;
  const srv = http.createServer((req, res) => {
    emVoo.push(req.url);
    marcas.push("entrou:" + emVoo.length);
    let b = ""; req.on("data", d => b += d);
    req.on("end", async () => {
      /* A primeira requisição fica pendurada. Se a fila não existisse, a segunda
         chegaria ao servidor enquanto esta está aberta — e `emVoo` teria 2. */
      if (emVoo.length === 1) await new Promise(r => { liberar = r; });
      marcas.push("saiu");
      emVoo.pop();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x" }));
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  fs.writeFileSync(path.join(TMP, ".env"),
    "N8N_BASE_URL=http://127.0.0.1:" + srv.address().port + "\nN8N_API_KEY=chave-de-mentira\n");

  const copia = require(path.join(TMP, "n8n.js"));
  const wf = { name: "x", nodes: [], connections: {}, settings: {} };
  const oX = copia.writeOwner("upgrade", "u1", "aplicando upgrade em X");
  const oY = copia.writeOwner("tester", "t1", "testando o fluxo numa cópia de Y");

  const w1 = copia.putWorkflow(oX, "wf1", wf);
  await espera(40);
  const w2 = copia.putWorkflow(oY, "wf2", wf);
  await espera(40);
  t("só UMA requisição chegou ao n8n — a segunda está na fila", emVoo.length === 1);
  t("...e a fila sabe quem está lá", copia.donoDaEscrita().doing === "aplicando upgrade em X");
  t("...com um esperando", copia.donoDaEscrita().esperando === 1);
  if (liberar) liberar();
  await w1;
  await espera(40);
  if (liberar) liberar();
  await w2;
  t("as duas requisições completaram, uma depois da outra",
    marcas.join(" ") === "entrou:1 saiu entrou:1 saiu");
  t("no fim a vez está livre", copia.donoDaEscrita().id === null);

  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  /* ──────────────── 7. o que a fila envolve, e o que não ─────────────── */

  console.log("\n[ 07 ] quem está dentro da fila, lido da fonte");

  const sn = fs.readFileSync(path.join(__dirname, "n8n.js"), "utf8");
  const cf = fs.readFileSync(path.join(__dirname, "claude-fix.js"), "utf8");

  const corpo = nome => (sn.match(new RegExp("async function " + nome + "\\([\\s\\S]*?\\n\\}")) || [""])[0];
  t("putWorkflow escreve dentro da fila", /return comEscrita\(owner, async \(\) => \{/.test(corpo("putWorkflow")));
  t("createWorkflow escreve dentro da fila", /return comEscrita\(owner, async \(\) => \{/.test(corpo("createWorkflow")));
  t("...e o `request` das duas está lá dentro",
    /comEscrita[\s\S]*request\("PUT"/.test(corpo("putWorkflow")) && /comEscrita[\s\S]*request\("POST"/.test(corpo("createWorkflow")));
  /* `retryExecution` fora: não escreve documento, e serializar um efeito que já
     é recusado em duplicidade só esconderia a fila. */
  t("retryExecution NÃO entra na fila", !/comEscrita/.test(corpo("retryExecution")));
  t("nenhum GET entra na fila", !/comEscrita/.test(corpo("getRawWorkflow")));
  t("o `finally` que solta a vez existe", /finally \{ soltarVez\(\); \}/.test(sn));

  /* A região inteira, não só o `PUT`: é isso que impede outro dono de escrever
     entre a revalidação dos portões e a escrita. */
  t("escreverAprovado segura a região inteira", /return n8n\.comEscrita\(owner, \(\) => sequenciaAprovada\(\{/.test(cf));
  t("...e a sequência em si não toma a vez de novo por fora",
    !/comEscrita/.test((cf.match(/async function sequenciaAprovada\([\s\S]*?\n\}/) || [""])[0]));

  console.log(bad
    ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
    : "\npassou: " + ok + " casos — a fila serializa entre donos e reentra no mesmo, então a checagem 7 não trava");
  process.exit(bad ? 1 : 0);
})();
