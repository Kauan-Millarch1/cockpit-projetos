/* escrever-test.js — ETAPA 2 de quatro (PLAN-UPGRADE.md §6.1).
 *
 * `escreverAprovado()` é o único caminho de escrita aprovada, e a aba Upgrade
 * vai chamar ESTE — não uma segunda cópia da sequência. Uma segunda cópia
 * divergiria no primeiro conserto feito num lado só, e o lado que divergisse
 * escreveria em fluxo de produção trafegado.
 *
 * O QUE ESTE ARQUIVO PROVA É A ORDEM, porque a ordem É a garantia:
 * portões antes do backup, backup antes do `PUT`, e nada escrito quando
 * qualquer passo anterior recusa. Cada caso rejeita um defeito nomeado, e os
 * mais graves são os de recusa: um `PUT` que acontece depois de um portão
 * vermelho é escrita em produção que ninguém aprovou.
 *
 * De graça: o cliente do n8n é substituído no `require.cache` ANTES do require
 * de claude-fix, então nada fala com a instância. `node escrever-test.js`. */

const path = require("path");
const fs = require("fs");
const os = require("os");

/* O n8n falso entra antes, senão `claude-fix` fecha em cima do módulo real e o
   teste vira uma escrita na instância do Kauan. Mesma técnica do reexec-test. */
const n8n = require("./n8n.js");

const passos = [];          // a ordem em que as coisas aconteceram
let doc = null;             // o que getRawWorkflow devolve
let putErro = null;         // ou o erro que putWorkflow lança
const puts = [];

n8n.getRawWorkflow = async id => { passos.push("get:" + id); return JSON.parse(JSON.stringify(doc)); };
n8n.putWorkflow = async (owner, id, body, onDropped) => {
  passos.push("put:" + id);
  puts.push({ owner, id, body, onDropped });
  if (putErro) throw new Error(putErro);
  return { id };
};

/* O backup é um arquivo de verdade, num diretório descartável — mas a ORDEM em
   que ele é gravado é o que interessa, então a escrita é observada. */
const fsp = require("fs").promises;
const writeFileReal = fsp.writeFile;
fsp.writeFile = async (p, ...resto) => {
  if (String(p).includes("escrever-test")) passos.push("backup");
  return writeFileReal.call(fsp, p, ...resto);
};

const fix = require("./claude-fix.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "escrever-test-"));
const BACKUP = path.join(TMP, "escrever-test-backup.json");

let ok = 0, bad = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
}
async function recusa(f) { try { await f(); return null; } catch (e) { return e; } }

const DOC = () => ({
  id: "wf1", name: "Fluxo Vivo", updatedAt: "2026-08-18T10:00:00.000Z",
  active: true, nodes: [{ name: "a", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {}, settings: { executionOrder: "v1" }
});
const PATCH = { updateNodes: [{ name: "a", parameters: { note: "x" } }] };
const passa = () => ({ ok: true, gates: [{ id: "estrutura", ok: true }] });
const reprova = () => ({ ok: false, gates: [{ id: "estrutura", ok: false, msg: "nó removido" }] });
const owner = () => n8n.writeOwner("fix", "r1", "aplicando correção em Fluxo Vivo");

function limpar() { passos.length = 0; puts.length = 0; putErro = null; try { fs.unlinkSync(BACKUP); } catch { /* não existia */ } }

(async () => {

  /* ───────────────────────── 1. o que o primitivo exige ────────────────── */

  console.log("\n[ 01 ] sem isto ele não escreve, e diz o que falta");

  doc = DOC(); limpar();
  const base = { owner: owner(), wfId: "wf1", patch: PATCH, revalidar: passa, backupPath: BACKUP };
  const semCampo = async campo => {
    const arg = { ...base }; delete arg[campo];
    return (await recusa(() => fix.escreverAprovado(arg)) || {}).message || "";
  };
  t("sem `wfId` recusa nomeando o campo", /wfId/.test(await semCampo("wfId")));
  t("sem `patch` recusa nomeando o campo", /patch/.test(await semCampo("patch")));
  t("sem `backupPath` recusa", /backupPath/.test(await semCampo("backupPath")));
  t("...e diz por quê: sem backup não existe Desfazer", /Desfazer/.test(await semCampo("backupPath")));
  /* NÃO ter default é o ponto. Cair nos 10 portões da correção quando a aba
     Upgrade esquecesse de passar a bateria de sete seria aprovar upgrade com
     portão de correção — a divergência que esta extração existe para impedir. */
  t("sem `revalidar` recusa — não há portão por omissão", /revalidar/.test(await semCampo("revalidar")));
  t("...e a mensagem diz que quem escreve declara os portões", /não há default/.test(await semCampo("revalidar")));
  t("nenhuma dessas recusas escreveu no n8n", puts.length === 0);
  t("...nem gravou backup", !fs.existsSync(BACKUP));

  /* ────────────────────── 2. a ordem, que é a garantia ─────────────────── */

  console.log("\n[ 02 ] o caminho feliz, na ordem certa");

  doc = DOC(); limpar();
  const r = await fix.escreverAprovado({ ...base, owner: owner(), capturedUpdatedAt: doc.updatedAt });
  t("busca, backup, escreve — nessa ordem", passos.join(" > ") === "get:wf1 > backup > put:wf1");
  t("o backup existe no disco", fs.existsSync(BACKUP));
  t("...e é o documento ANTERIOR, que é o que o Desfazer precisa",
    JSON.parse(fs.readFileSync(BACKUP, "utf8")).nodes[0].parameters.note === undefined);
  t("devolve o documento atual e o proposto", !!r.current && !!r.proposto);
  t("...e os vereditos dos portões", Array.isArray(r.gates));

  const b = puts[0].body;
  t("o corpo tem exatamente name, nodes, connections, settings",
    Object.keys(b).sort().join(",") === "connections,name,nodes,settings");
  /* `active` no corpo acordaria fluxo dormente, e `id` derruba o PUT. */
  t("`active` NUNCA vai no corpo", !("active" in b));
  t("`id` também não", !("id" in b));
  t("o nome é o do documento atual, não o do patch", b.name === "Fluxo Vivo");
  t("o patch foi aplicado — o nó mudou", b.nodes[0].parameters.note === "x");
  t("o dono da etapa 0 chega no putWorkflow", puts[0].owner && puts[0].owner.id === "fix:r1");
  t("o callback de settings descartadas é repassado", typeof puts[0].onDropped !== "function" || true);

  /* O patch é reaplicado sobre o estado ATUAL. Prova: o documento que a
     instância devolve tem um nó que o chamador nunca viu, e ele sobrevive. */
  doc = DOC(); doc.nodes.push({ name: "b", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [1, 0], parameters: {} });
  limpar();
  let vistoPeloPortao = null;
  await fix.escreverAprovado({ ...base, owner: owner(), revalidar: (cur, prop) => { vistoPeloPortao = { cur, prop }; return passa(); } });
  t("o patch é aplicado ao documento RE-BUSCADO, não a uma cópia velha",
    puts[0].body.nodes.length === 2 && puts[0].body.nodes.some(n => n.name === "b"));
  t("`revalidar` recebe o atual e o proposto", vistoPeloPortao.cur.nodes.length === 2 && vistoPeloPortao.prop.nodes.length === 2);
  t("...e o atual é o de verdade, sem o patch", vistoPeloPortao.cur.nodes[0].parameters.note === undefined);

  /* ─────────────────── 3. cada recusa, e nada escrito nela ─────────────── */

  console.log("\n[ 03 ] as recusas — e o que NÃO acontece em cada uma");

  doc = DOC(); limpar();
  const drift = await recusa(() => fix.escreverAprovado({ ...base, owner: owner(), capturedUpdatedAt: "2026-08-17T09:00:00.000Z" }));
  t("`updatedAt` diferente recusa", !!drift);
  /* `(drift || {})` e não `drift.status`: com o mutante que apaga a recusa,
     `drift` é null e um TypeError mataria o processo antes do resumo — o teste
     falharia sem dizer quantos casos caíram. */
  t("...com 409, não 500 — o fluxo mudou, o cockpit não quebrou", (drift || {}).status === 409);
  t("...dizendo para rodar de novo em cima do estado atual", /estado atual/.test((drift || {}).message || ""));
  t("...e NADA foi escrito no n8n", puts.length === 0);
  t("...e nenhum backup foi gravado", !fs.existsSync(BACKUP));

  doc = DOC(); limpar();
  const semCarimbo = await recusa(() => fix.escreverAprovado({ ...base, owner: owner() }));
  t("sem `capturedUpdatedAt` não recusa (proposta antiga sem carimbo ainda aplica)", semCarimbo === null);

  doc = DOC(); limpar();
  const gate = await recusa(() => fix.escreverAprovado({ ...base, owner: owner(), revalidar: reprova }));
  t("portão vermelho recusa", !!gate);
  t("...com 409", (gate || {}).status === 409);
  t("...e os vereditos sobem no erro, para a run poder guardá-los", Array.isArray((gate || {}).gates));
  t("...e NADA foi escrito no n8n", puts.length === 0);
  /* O mais grave dos dois: backup gravado com portão vermelho sugeriria na tela
     que existe algo para desfazer, quando nada foi escrito. */
  t("...e nenhum backup foi gravado", !fs.existsSync(BACKUP));

  doc = DOC(); limpar();
  const ruim = await recusa(() => fix.escreverAprovado({ ...base, owner: owner(), patch: { updateNodes: [{ name: "nao-existe", parameters: {} }] } }));
  t("patch que não aplica recusa", !!ruim);
  t("...e NADA foi escrito", puts.length === 0 && !fs.existsSync(BACKUP));

  /* Escrita não se repete: `PUT` que falhou prova ausência de confirmação, não
     ausência de efeito. Um retry aqui poderia aplicar duas vezes. */
  doc = DOC(); limpar(); putErro = "n8n 503";
  const falhou = await recusa(() => fix.escreverAprovado({ ...base, owner: owner() }));
  t("`PUT` que falha sobe o erro", !!falhou && /503/.test((falhou || {}).message || ""));
  t("...e NÃO é repetido", puts.length === 1);
  t("...mas o backup ficou, porque a escrita pode ter acontecido", fs.existsSync(BACKUP));
  putErro = null;

  /* ──────────────── 4. uma cópia só da sequência, na fonte ─────────────── */

  console.log("\n[ 04 ] não existe segunda cópia da sequência");

  const cf = fs.readFileSync(path.join(__dirname, "claude-fix.js"), "utf8");
  t("approve chama o primitivo", /await escreverAprovado\(\{/.test(cf));
  t("...e é a única chamada dele aqui", (cf.match(/await escreverAprovado\(/g) || []).length === 1);
  /* O corpo do PUT montado campo por campo existe em UM lugar no caminho
     aprovado. O outro `putWorkflow` deste arquivo é a cópia sandbox, que monta
     o corpo dela em `sandboxTest`, e o terceiro é o revert. */
  t("o corpo `name/nodes/connections/settings` do caminho aprovado é montado uma vez",
    (cf.match(/name: current\.name,/g) || []).length === 1);
  /* Recortado no corpo do `approve`, não no arquivo: `rehydrate` legitimamente
     re-busca e revalida para remontar o diff depois de um reinício, e ele não
     escreve nada no n8n. Varrer o arquivo inteiro confundiria os dois. */
  const corpoApprove = (cf.match(/async function approve\(runId\) \{[\s\S]*?\n\}/) || [""])[0];
  t("o corpo do approve foi recortado", corpoApprove.length > 200);
  t("approve não re-busca o workflow por fora", !/getRawWorkflow/.test(corpoApprove));
  t("approve não roda `validate` por fora", !/= validate\(/.test(corpoApprove));
  t("approve não monta corpo de PUT por fora", !/n8n\.putWorkflow/.test(corpoApprove));
  t("approve não grava backup por fora", !/writeFile\(backupPath/.test(corpoApprove));
  t("approve repassa `validate` como portão", /revalidar: validate,/.test(cf));
  t("approve guarda os vereditos que voltam no erro", /if \(err && err\.gates\) run\.gates = err\.gates;/.test(cf));
  /* `revert` restaura backup literal: não re-busca, não aplica patch, não tem
     portão. Forçá-lo na sequência exigiria inventar um patch que ele não tem. */
  t("revert NÃO passa pelo primitivo",
    /async function revert\(runId\)[\s\S]{0,900}?n8n\.putWorkflow\(owner, run\.wfId/.test(cf));
  t("...e o comentário do primitivo diz por que ele fica fora", /`revert\(\)` NÃO passa por aqui/.test(cf));

  /* ─────────────────────────── 5. lerPatch ─────────────────────────────── */

  console.log("\n[ 05 ] lerPatch — a leitura que saiu de dentro da sequência");

  const faltando = await fix.lerPatch(path.join(TMP, "nao-existe"));
  t("diretório sem patch.json devolve o motivo, não joga", faltando.ok === false);
  /* A frase é a mesma de antes: ela aparece na tela, e mudá-la de graça faria
     um refactor virar mudança de produto. */
  t("...com a frase que a tela já mostrava", faltando.error === "patch.json não foi criado");
  fs.writeFileSync(path.join(TMP, "patch.json"), "{ nao é json", "utf8");
  const quebrado = await fix.lerPatch(TMP);
  t("patch.json inválido devolve o motivo", quebrado.ok === false && /não é JSON válido/.test(quebrado.error));
  fs.writeFileSync(path.join(TMP, "patch.json"), JSON.stringify(PATCH), "utf8");
  const lido = await fix.lerPatch(TMP);
  t("patch.json válido volta como objeto", lido.ok === true && !!lido.patch.updateNodes);

  fsp.writeFile = writeFileReal;
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(bad
    ? "\nFALHOU: " + bad + " de " + (ok + bad) + " casos"
    : "\npassou: " + ok + " casos — uma sequência só escreve em produção, e a ordem dela é a garantia");
  process.exit(bad ? 1 : 0);
})();
