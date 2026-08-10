/* credenciais-test.js — a checklist por nó e a ligação automática, sem gastar nada.
 *
 * Duas coisas são provadas aqui, e a segunda é a que importa mais:
 *   1. a checklist diz o que dá para afirmar e nada além disso;
 *   2. a ligação automática só liga quando NÃO HÁ ESCOLHA A FAZER — porque um
 *      palpite de credencial importa calado no n8n e só aparece na primeira
 *      execução, no destino errado.
 *
 * E uma terceira, de fronteira: o nome da credencial não pode vazar para a fatia
 * do catálogo que vai para a sessão de construção.
 *
 * `node credenciais-test.js`
 */

"use strict";

const assert = require("assert");
const { checklistCredenciais, ligacaoCredenciais, interpretarEscolhaCred } = require("./tester");
const catalog = require("./catalog");

let ok = 0, bad = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { bad++; console.log("  FALHA " + nome + "\n         " + (e && e.message)); }
};
const grupo = n => console.log("\n" + n);

/* A forma real do catálogo: `nodes[tipo].credenciais` são os tipos que aquele
 * tipo de nó usa NOS FLUXOS DELE, `credenciaisPorTipo` é o que faz `visto` ser
 * verdadeiro, e `credenciaisConhecidas` é o inventário possível. */
const cat = () => ({
  nodes: {
    "n8n-nodes-base.gmailTrigger": { credenciais: ["gmailOAuth2"] },
    "n8n-nodes-base.set": { credenciais: [] },
    "n8n-nodes-base.if": { credenciais: [] },
    "n8n-nodes-base.slack": { credenciais: ["slackApi", "slackOAuth2Api"] },
    "n8n-nodes-base.supabase": { credenciais: ["supabaseApi"] },
    "n8n-nodes-base.redis": { credenciais: ["redis"] }
  },
  credenciaisPorTipo: { slackApi: 6, slackOAuth2Api: 1, supabaseApi: 12, redis: 4 },
  credenciaisConhecidas: [
    { tipo: "supabaseApi", id: "sb1", nome: "Supabase Ecommerce Puro", usos: 12 },
    { tipo: "slackApi", id: "sk1", nome: "Slack Ecommerce Puro", usos: 6 },
    { tipo: "redis", id: null, nome: "Redis sem id", usos: 4 },
    { tipo: "slackOAuth2Api", id: "sk2", nome: "Slack OAuth antigo", usos: 1 }
  ]
});

const wf = () => ({
  nodes: [
    { name: "trigger_gmail_novo_email", type: "n8n-nodes-base.gmailTrigger" },
    { name: "filtrar_remetente", type: "n8n-nodes-base.if" },
    { name: "montar_mensagem_email", type: "n8n-nodes-base.set" },
    { name: "slack_dm_aviso_email", type: "n8n-nodes-base.slack" },
    { name: "gravar_registro_aviso", type: "n8n-nodes-base.supabase" },
    { name: "guardar_lock", type: "n8n-nodes-base.redis" }
  ],
  connections: {}
});

grupo("a checklist por nó");

t("nó que nunca pediu credencial não entra na lista", () => {
  const r = checklistCredenciais(wf(), cat(), new Map());
  const nomes = r.map(x => x.no);
  assert.ok(!nomes.includes("montar_mensagem_email"), "o Set entrou na checklist");
  assert.ok(!nomes.includes("filtrar_remetente"), "o IF entrou na checklist");
  assert.deepStrictEqual(nomes, ["trigger_gmail_novo_email", "slack_dm_aviso_email", "gravar_registro_aviso", "guardar_lock"]);
});

t("nó com mais de um tipo possível sai com TODOS — esconder seria escolher por ele", () => {
  const r = checklistCredenciais(wf(), cat(), new Map());
  const slack = r.find(x => x.no === "slack_dm_aviso_email");
  assert.deepStrictEqual(slack.opcoes.map(o => o.tipo), ["slackApi", "slackOAuth2Api"]);
});

t("cada opção carrega o NOME das credenciais daquele tipo, não só o tipo", () => {
  const r = checklistCredenciais(wf(), cat(), new Map());
  const sup = r.find(x => x.no === "gravar_registro_aviso").opcoes[0];
  assert.strictEqual(sup.visto, true);
  assert.deepStrictEqual(sup.existentes.map(e => e.nome), ["Supabase Ecommerce Puro"]);
});

t("tipo sem nenhuma credencial conhecida vem `visto: false` e sem nomes", () => {
  const r = checklistCredenciais(wf(), cat(), new Map());
  const gm = r.find(x => x.no === "trigger_gmail_novo_email").opcoes[0];
  assert.strictEqual(gm.visto, false);
  assert.deepStrictEqual(gm.existentes, []);
});

t("o schema já buscado é reaproveitado em vez de perder os campos", () => {
  const porTipo = new Map([["supabaseApi", { tipo: "supabaseApi", visto: true, campos: ["host", "serviceRole"], existentes: [] }]]);
  const r = checklistCredenciais(wf(), cat(), porTipo);
  assert.deepStrictEqual(r.find(x => x.no === "gravar_registro_aviso").opcoes[0].campos, ["host", "serviceRole"]);
});

/* Este pegou um defeito de verdade. Um projeto salvo antes desta feature traz
 * `ingredientes.credenciais` sem `existentes`, e a primeira versão devolvia esse
 * item intacto — reabrir um projeto antigo mostrava zero credencial, que se lê
 * como "você não tem nenhuma" quando a verdade era "esse dado não foi salvo". */
t("item antigo, sem `existentes`, é completado com o catálogo de AGORA", () => {
  const antigo = new Map([["supabaseApi", { tipo: "supabaseApi", visto: false, campos: ["host"] }]]);
  const o = checklistCredenciais(wf(), cat(), antigo).find(x => x.no === "gravar_registro_aviso").opcoes[0];
  assert.deepStrictEqual(o.existentes.map(e => e.nome), ["Supabase Ecommerce Puro"]);
  assert.strictEqual(o.visto, true, "`visto` velho sobreviveu — ele é um retrato da instância de meses atrás");
  assert.deepStrictEqual(o.campos, ["host"], "perdeu o schema já buscado e vai custar uma chamada à toa");
});

grupo("a ligação automática só liga o que não tem escolha");

t("um único candidato com id e nome: liga", () => {
  const { ligados } = ligacaoCredenciais(wf(), cat());
  const l = ligados.find(x => x.no === "gravar_registro_aviso");
  assert.ok(l, "não ligou o Supabase, que tinha candidato único");
  assert.deepStrictEqual(l, { no: "gravar_registro_aviso", tipo: "supabaseApi", id: "sb1", nome: "Supabase Ecommerce Puro", porEscolha: false });
});

t("dois candidatos: NÃO liga, e nomeia os dois para a escolha ser possível", () => {
  const { ligados, vazios } = ligacaoCredenciais(wf(), cat());
  assert.ok(!ligados.some(l => l.no === "slack_dm_aviso_email"), "ligou o Slack com duas credenciais possíveis");
  const v = vazios.find(x => x.no === "slack_dm_aviso_email");
  assert.match(v.motivo, /mais de uma/);
  assert.deepStrictEqual(v.candidatos.map(c => c.nome), ["Slack Ecommerce Puro", "Slack OAuth antigo"]);
});

t("nenhum candidato: NÃO liga e diz que não achou — id inventado falha calado", () => {
  const { ligados, vazios } = ligacaoCredenciais(wf(), cat());
  assert.ok(!ligados.some(l => l.no === "trigger_gmail_novo_email"));
  assert.match(vazios.find(x => x.no === "trigger_gmail_novo_email").motivo, /nenhuma credencial/);
});

t("credencial sem `id` não liga nada — id é o que o n8n casa na importação", () => {
  const { ligados, vazios } = ligacaoCredenciais(wf(), cat());
  assert.ok(!ligados.some(l => l.no === "guardar_lock"), "ligou uma credencial sem id");
  assert.ok(vazios.some(x => x.no === "guardar_lock"));
});

t("nó sem credencial nenhuma não aparece nem em ligados nem em vazios", () => {
  const { ligados, vazios } = ligacaoCredenciais(wf(), cat());
  for (const lista of [ligados, vazios]) {
    assert.ok(!lista.some(x => x.no === "montar_mensagem_email"), "o Set apareceu no relatório de ligação");
  }
});

t("devolve RELATÓRIO, nunca uma segunda cópia do fluxo", () => {
  const r = ligacaoCredenciais(wf(), cat());
  assert.deepStrictEqual(Object.keys(r).sort(), ["ligados", "vazios"]);
  assert.strictEqual(r.workflow, undefined, "devolveu um workflow — o snapshot dobraria de tamanho");
});

t("o fluxo de entrada nunca é mutado", () => {
  const w = wf();
  const antes = JSON.stringify(w);
  ligacaoCredenciais(w, cat());
  assert.strictEqual(JSON.stringify(w), antes, "ligacaoCredenciais mutou o fluxo");
  assert.ok(!w.nodes.some(n => n.credentials), "apareceu `credentials` no fluxo de origem");
});

grupo("o desempate");

t("escolher uma das duas resolve o nó que ficava em branco para sempre", () => {
  const { ligados, vazios } = ligacaoCredenciais(wf(), cat(), [{ tipo: "slackApi", id: "sk1" }]);
  const l = ligados.find(x => x.no === "slack_dm_aviso_email");
  assert.ok(l, "o desempate não ligou o Slack");
  assert.strictEqual(l.id, "sk1");
  assert.strictEqual(l.porEscolha, true, "não marcou que foi escolha, e a tela precisa dizer isso");
  assert.ok(!vazios.some(v => v.no === "slack_dm_aviso_email"));
});

t("o que já era único continua ligando sem escolha, e sem se dizer escolhido", () => {
  const l = ligacaoCredenciais(wf(), cat(), [{ tipo: "slackApi", id: "sk1" }]).ligados
    .find(x => x.no === "gravar_registro_aviso");
  assert.strictEqual(l.porEscolha, false);
});

t("escolher DUAS que servem no mesmo nó continua ambíguo — não chuta", () => {
  const { ligados, vazios } = ligacaoCredenciais(wf(), cat(), [{ tipo: "slackApi", id: "sk1" }, { tipo: "slackOAuth2Api", id: "sk2" }]);
  assert.ok(!ligados.some(x => x.no === "slack_dm_aviso_email"), "chutou entre duas escolhas");
  assert.match(vazios.find(v => v.no === "slack_dm_aviso_email").motivo, /mais de uma/);
});

t("escolha que não serve para nó nenhum não muda nada", () => {
  const a = ligacaoCredenciais(wf(), cat(), []);
  const b = ligacaoCredenciais(wf(), cat(), [{ tipo: "gmailOAuth2", id: "nao-existe" }]);
  assert.deepStrictEqual(a, b);
});

grupo("a frase do chat, interpretada localmente");

const ligDoTeste = () => ligacaoCredenciais(wf(), cat(), []);

t("frase sem palavra de credencial NÃO é interceptada — seria engolir um pedido de fluxo", () => {
  assert.strictEqual(interpretarEscolhaCred("manda o aviso pro Slack Ecommerce Puro", ligDoTeste()), null);
  assert.strictEqual(interpretarEscolhaCred("acrescenta um nó de supabase", ligDoTeste()), null);
});

t("frase com sinal e um nome só: resolve", () => {
  const r = interpretarEscolhaCred("no slack usa a credencial Slack Ecommerce Puro", ligDoTeste());
  assert.ok(r && r.escolha, JSON.stringify(r));
  assert.strictEqual(r.escolha.id, "sk1");
});

t("acento não atrapalha — «autenticação» é sinal", () => {
  const r = interpretarEscolhaCred("a autenticação do slack é a Slack OAuth antigo", ligDoTeste());
  assert.ok(r && r.escolha, JSON.stringify(r));
  assert.strictEqual(r.escolha.id, "sk2");
});

t("o TIPO também serve como nome — «usa a credencial slackApi»", () => {
  const r = interpretarEscolhaCred("usa a credencial slackApi", ligDoTeste());
  assert.ok(r && r.escolha, JSON.stringify(r));
  assert.strictEqual(r.escolha.tipo, "slackApi");
});

t("dois nomes batendo devolve a pergunta em vez de escolher", () => {
  const r = interpretarEscolhaCred("credencial: Slack Ecommerce Puro ou Slack OAuth antigo?", ligDoTeste());
  assert.ok(r && r.ambiguo, JSON.stringify(r));
  assert.strictEqual(r.ambiguo.length, 2);
});

t("nome que não existe devolve a lista do que serve, em vez de silêncio", () => {
  const r = interpretarEscolhaCred("usa a credencial do Discord", ligDoTeste());
  assert.ok(r && r.naoAchei, JSON.stringify(r));
  assert.ok(r.naoAchei.some(c => c.nome === "Slack Ecommerce Puro"));
});

t("sem nó em branco não há o que desempatar — não intercepta", () => {
  const tudoLigado = { ligados: [], vazios: [] };
  assert.strictEqual(interpretarEscolhaCred("usa a credencial Slack Ecommerce Puro", tudoLigado), null);
});

t("candidato sem `id` não vira escolha possível", () => {
  const r = interpretarEscolhaCred("usa a credencial Redis sem id", ligDoTeste());
  // O Redis entra em `vazios` por não ter id, então ele não é candidato de nada.
  assert.ok(!r || !r.escolha, "ofereceu como escolha uma credencial sem id: " + JSON.stringify(r));
});

grupo("a fronteira: o nome da credencial não vai para a sessão de construção");

t("`slice` e `fatiaTexto` servem só `cat.nodes` — sem inventário de credencial", () => {
  const c = cat();
  const tipos = Object.keys(c.nodes);
  const fatiado = catalog.slice(c, tipos);
  const texto = catalog.fatiaTexto(c, tipos, 60000).texto;
  for (const alvo of ["Supabase Ecommerce Puro", "Slack Ecommerce Puro", "sb1", "sk1", "credenciaisConhecidas"]) {
    assert.ok(!JSON.stringify(fatiado).includes(alvo), "`slice` vazou: " + alvo);
    assert.ok(!texto.includes(alvo), "`fatiaTexto` vazou: " + alvo);
  }
  // E o que ela precisa continuar tendo: o TIPO de credencial, que é o que
  // deixa o modelo saber que aquele nó pede autenticação.
  assert.ok(texto.includes("slackApi"), "a fatia perdeu o tipo de credencial");
});

t("`credenciaisDoTipo` devolve por uso, do mais usado para o menos", () => {
  const c = cat();
  c.credenciaisConhecidas.push({ tipo: "supabaseApi", id: "sb2", nome: "Supabase antigo", usos: 2 });
  const r = catalog.credenciaisDoTipo(c, "supabaseApi");
  assert.deepStrictEqual(r.map(x => x.nome), ["Supabase Ecommerce Puro", "Supabase antigo"]);
});

console.log("\npassou: " + ok + " ok, " + bad + " falha(s)\n");
process.exit(bad ? 1 : 0);
