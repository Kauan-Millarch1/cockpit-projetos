/* dono-test.js — ETAPA 0 de quatro (PLAN-UPGRADE.md §6.5.1).
 *
 * O que este arquivo prova: TODO caminho de escrita desta instância diz quem
 * está escrevendo, e a ausência é erro alto em vez de default silencioso.
 *
 * Por que ele existe antes da fila. A etapa 3 desce um mutex process-wide para
 * `putWorkflow`/`createWorkflow`, reentrante POR DONO — porque o approve da aba
 * Upgrade escreve duas vezes (cópia sandbox da checagem 7, depois o fluxo vivo).
 * Ligar essa fila antes de existir dono é ligar uma fila que não distingue
 * reentrância de disputa: deadlock que só aparece com a checagem 7 ligada, que é
 * o padrão novo daquela aba. Então primeiro o dono existe em todos os seis call
 * sites — sem trava — e este teste é o que impede o sétimo de nascer sem ele.
 *
 * A terceira bateria é ANÁLISE ESTÁTICA da fonte de verdade, não de uma cópia:
 * ela lê `claude-fix.js` e `tester.js`. Um teste que reimplementasse as chamadas
 * aqui provaria a cópia. E a CONTAGEM é o portão: um call site novo derruba o
 * teste por definição, que é exatamente o aviso que se quer no dia em que
 * alguém colar mais um `PUT`.
 *
 * De graça: nenhuma rede, nenhum modelo, nenhuma escrita. `node dono-test.js`. */

const fs = require("fs");
const path = require("path");
const n8n = require("./n8n.js");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}
const src = f => fs.readFileSync(path.join(__dirname, f), "utf8");

/* ───────────────────────────────────────────── 1. o construtor do dono ──── */

console.log("\n[ 01 ] writeOwner — o formato é validado na construção");

const bom = n8n.writeOwner("fix", "r7abc", "aplicando correção em WhatsApp API Oficial");
t("dono válido tem id `kind:ref`", bom.id === "fix:r7abc");
t("...e guarda kind e ref separados", bom.kind === "fix" && bom.ref === "r7abc");
t("...e a frase da espera", /aplicando correção/.test(bom.doing));

const jog = f => { try { f(); return null; } catch (e) { return e.message; } };

t("kind desconhecido é recusado", !!jog(() => n8n.writeOwner("qualquer", "r1", "x")));
t("...e a recusa NOMEIA o que veio", /"qualquer"/.test(jog(() => n8n.writeOwner("qualquer", "r1", "x"))));
t("...e lista os kinds válidos", /fix/.test(jog(() => n8n.writeOwner("qualquer", "r1", "x"))));
t("os três kinds são exatamente fix, tester e upgrade",
  [...n8n.WRITE_KINDS].sort().join(",") === "fix,tester,upgrade");
t("os três kinds constroem", ["fix", "tester", "upgrade"].every(k => n8n.writeOwner(k, "r1", "x").kind === k));

t("ref vazia é recusada", !!jog(() => n8n.writeOwner("fix", "", "x")));
t("ref ausente é recusada", !!jog(() => n8n.writeOwner("fix", null, "x")));
/* A ref entra numa chave de fila e num texto de tela. Um `:` dentro dela faria
   dois donos diferentes colidirem num id só — o defeito de chave composta
   concatenada à mão que este repositório já pagou duas vezes. */
t("ref com `:` é recusada (colidiria com o separador do id)", !!jog(() => n8n.writeOwner("fix", "r7:abc", "x")));
t("ref com espaço é recusada", !!jog(() => n8n.writeOwner("fix", "r7 abc", "x")));
t("ref acima de 64 é recusada", !!jog(() => n8n.writeOwner("fix", "r".repeat(65), "x")));
t("os ids reais das três abas passam",
  ["r7abc12", "t9f3a1b2c4d5", "umsrvqfwhgkxl"].every(r => n8n.writeOwner("fix", r, "x").ref === r));

t("doing vazio é recusado", !!jog(() => n8n.writeOwner("fix", "r1", "   ")));
t("doing ausente é recusado", !!jog(() => n8n.writeOwner("fix", "r1", null)));
t("doing é cortado no teto, não recusado",
  n8n.writeOwner("fix", "r1", "y".repeat(400)).doing.length === n8n.DOING_CAP);

/* Congelado porque a fila da etapa 3 compara `id` para decidir reentrância: um
   dono mutável deixaria a comparação depender de quando ela roda. */
const cong = n8n.writeOwner("fix", "r1", "x");
try { cong.id = "fix:outro"; } catch { /* strict mode joga, sloppy só ignora */ }
t("o dono é congelado — id não muda depois de criado", cong.id === "fix:r1");

/* ─────────────────────────────── 2. a ausência é erro, não default ──────── */

console.log("\n[ 02 ] a escrita sem dono para ANTES de qualquer chamada de rede");

async function recusa(f) {
  try { await f(); return null; } catch (e) { return e.message; }
}

(async () => {
  const wf = { name: "x", nodes: [], connections: {}, settings: {} };

  const semDono = await recusa(() => n8n.putWorkflow(undefined, "abc", wf));
  t("putWorkflow sem dono é recusado", !!semDono);
  t("...e a mensagem nomeia a função", /putWorkflow/.test(semDono || ""));
  t("...e ensina o que passar", /writeOwner/.test(semDono || ""));
  t("...e aponta o plano", /6\.5\.1/.test(semDono || ""));
  /* A prova de que parou antes da rede: a mensagem é a do dono, nunca um erro de
     HTTP, timeout ou 401 da instância. */
  t("...e NÃO chegou a falar com o n8n", !/40[13]|ECONN|fetch|timeout|n8n respondeu/i.test(semDono || ""));

  const criarSemDono = await recusa(() => n8n.createWorkflow(undefined, wf));
  t("createWorkflow sem dono é recusado", !!criarSemDono);
  t("...e a mensagem nomeia a função", /createWorkflow/.test(criarSemDono || ""));
  t("...e NÃO chegou a falar com o n8n", !/40[13]|ECONN|fetch|timeout|n8n respondeu/i.test(criarSemDono || ""));

  t("dono `null` é recusado", !!(await recusa(() => n8n.putWorkflow(null, "abc", wf))));
  /* Trocar os dois primeiros argumentos de lugar é o erro de digitação mais
     provável aqui, e uma string no lugar do dono não pode passar por dono. */
  t("string no lugar do dono é recusada", !!(await recusa(() => n8n.putWorkflow("fix:r1", "abc", wf))));
  t("objeto com id vazio é recusado", !!(await recusa(() => n8n.putWorkflow({ id: "", doing: "x" }, "abc", wf))));
  t("objeto sem doing é recusado", !!(await recusa(() => n8n.putWorkflow({ id: "fix:r1" }, "abc", wf))));

  /* ────────────────────────── 3. os seis call sites de verdade ─────────── */

  console.log("\n[ 03 ] os seis call sites em produção, lidos da fonte");

  const CONSUMIDORES = { "claude-fix.js": 4, "tester.js": 2 };
  const CHAMADA = /n8n\s*\.\s*(putWorkflow|createWorkflow)\s*\(\s*([^\s,)]*)/g;

  let total = 0;
  for (const [arq, esperado] of Object.entries(CONSUMIDORES)) {
    const s = src(arq);
    const achadas = [...s.matchAll(CHAMADA)];
    total += achadas.length;
    /* A contagem é o portão: um `PUT` novo colado de outro lugar derruba este
       teste em vez de entrar calado sem dono. Se a contagem mudou de propósito,
       mude aqui — e a mudança fica no diff, que é o ponto. */
    t(arq + ": " + esperado + " escritas, nem mais nem menos (achei " + achadas.length + ")",
      achadas.length === esperado);
    t(arq + ": TODA escrita passa `owner` como primeiro argumento",
      achadas.length > 0 && achadas.every(m => m[2] === "owner"));
    t(arq + ": o dono é construído por `n8n.writeOwner(`", /n8n\.writeOwner\(/.test(s));
    t(arq + ": e com um kind literal, nunca variável",
      [...s.matchAll(/n8n\.writeOwner\(\s*([^,]+),/g)].every(m => /^"(fix|tester|upgrade)"$/.test(m[1].trim())));
  }
  t("seis call sites no total — o sétimo é o da aba Upgrade e ainda não existe", total === 6);

  const cf = src("claude-fix.js");
  t("claude-fix: o dono do approve diz que está APLICANDO", /writeOwner\("fix",[^)]*aplicando correção/.test(cf));
  t("claude-fix: o do desfazer diz que está DESFAZENDO", /writeOwner\("fix",[^)]*desfazendo a correção/.test(cf));
  t("claude-fix: o do sandbox diz que é uma CÓPIA", /writeOwner\("fix",[^)]*cópia de/.test(cf));
  /* As duas escritas do sandbox (PUT quando a cópia existe, POST na primeira
     vez) são a mesma escrita lógica, então compartilham UM dono. Na etapa 3 é
     esse compartilhamento que as torna reentrantes entre si.
     Medido DENTRO do corpo de `sandboxTest`, não por contagem de `const owner`
     no arquivo: a etapa 2 tirou a declaração de dentro do `approve` (o dono
     agora vai inline para `escreverAprovado`) e uma contagem de declarações
     passou a medir a FORMA em vez do fato. */
  const corpoSandbox = (cf.match(/async function sandboxTest\(run, proposal\) \{[\s\S]*?\n\}/) || [""])[0];
  t("claude-fix: o corpo do sandboxTest foi recortado", corpoSandbox.length > 200);
  t("claude-fix: sandbox constrói UM dono...", (corpoSandbox.match(/n8n\.writeOwner\(/g) || []).length === 1);
  t("...para as DUAS escritas dele", (corpoSandbox.match(/n8n\.(putWorkflow|createWorkflow)\(/g) || []).length === 2);
  /* E nenhuma escrita do arquivo perdeu o dono no caminho: três donos para as
     quatro escritas (sandbox compartilha um), em qualquer forma sintática. */
  t("claude-fix: três donos construídos, um por escrita lógica",
    (cf.match(/n8n\.writeOwner\(/g) || []).length === 3);
  t("tester: o dono diz que é uma cópia de teste", /writeOwner\("tester",[^)]*cópia de/.test(src("tester.js")));
  t("tester: um dono só para os dois ramos",
    (src("tester.js").match(/const owner = n8n\.writeOwner/g) || []).length === 1);

  /* ───────────────────────────── 4. o que continua fora ───────────────── */

  console.log("\n[ 04 ] o que a etapa 0 deliberadamente NÃO toca");

  const sn = src("n8n.js");
  t("putWorkflow recebe o dono primeiro", /async function putWorkflow\(owner, id, w, onDropped\)/.test(sn));
  t("createWorkflow recebe o dono primeiro", /async function createWorkflow\(owner, w, onDropped\)/.test(sn));
  /* Escopado no corpo de cada uma, não contado no arquivo: a etapa 3 acrescentou
     um terceiro `requireOwner` em `comEscrita`, e uma contagem global passou a
     medir quantas vezes a linha aparece em vez de QUEM confere. Mesma lição que
     a contagem de `const owner` já deu aqui. */
  const corpoDe = nome => (sn.match(new RegExp("async function " + nome + "\\([\\s\\S]*?\\n\\}")) || [""])[0];
  t("putWorkflow confere o dono", /requireOwner\(owner, "putWorkflow"\)/.test(corpoDe("putWorkflow")));
  t("createWorkflow confere o dono", /requireOwner\(owner, "createWorkflow"\)/.test(corpoDe("createWorkflow")));
  /* A conferência das duas é redundante com a de `comEscrita` — e fica de
     propósito: assim a recusa nomeia a função que o chamador chamou, não a fila
     interna. Uma mensagem que aponta para dentro manda procurar no lugar errado. */
  t("a fila da etapa 3 também confere", /requireOwner\(owner, "comEscrita"\)/.test(sn));

  /* `retryExecution` fica fora do mutex e fora do dono: não escreve documento
     nenhum. Serializar um efeito que já é recusado em duplicidade só esconderia
     a fila — e é a única função deste módulo cujo efeito sai da instância. */
  const retry = (sn.match(/async function retryExecution\([\s\S]*?\n}/) || [""])[0];
  t("retryExecution NÃO ganhou dono", /async function retryExecution\(execId\b/.test(sn));
  t("...e não confere dono nenhum", !/requireOwner/.test(retry));

  /* Nenhuma trava nesta etapa. Ligar a fila aqui é a etapa 3, e o teste dela é
     outro (`mutex-test.js`). Se este assert cair, alguém pulou uma etapa. */
  t("etapa 0 não ligou fila nenhuma", !/\bqueue\b|\bmutex\b|aguardando a vez/i.test(sn));

  /* ─────────────────────── 5. a cerca deste próprio arquivo ───────────── */

  /* MEDIDO ao escrever esta etapa, e é a armadilha que o `mutex-test.js` da
     etapa 3 vai encontrar primeiro: `loadConfig()` em n8n.js lê o `.env` do
     diretório e ele VENCE o `process.env`. Então apontar `N8N_BASE_URL` para um
     servidor de mentira não isola nada — um teste que chame `putWorkflow` com
     dono VÁLIDO nesta pasta fala com a instância de produção de verdade. Custou
     um `PUT` real (recusado com 404 num id inexistente, nada escrito).
     Para exercitar o caminho feliz, copie `n8n.js` para um diretório sem `.env`.
     Este arquivo, por construção, só passa donos inválidos. */
  const eu = src("dono-test.js");
  const chamadasDaqui = [...eu.matchAll(/n8n\.(putWorkflow|createWorkflow)\(([^,]*),/g)].map(m => m[2].trim());
  t("este teste NUNCA passa dono válido para uma escrita (ou falaria com a instância real)",
    chamadasDaqui.length > 0 && chamadasDaqui.every(a => /^(undefined|null|"[^"]*"|\{)/.test(a)));

  console.log(bad
    ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
    : "\npassou: " + ok + " casos — os seis call sites dizem quem escreve, e o sétimo não nasce calado");
  process.exit(bad ? 1 : 0);
})();
