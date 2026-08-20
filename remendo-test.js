"use strict";
/* remendo-test.js — a FIAÇÃO do §4, executada.
 *
 * `upgrade-test.js` prova o CONTRATO: o que a validação aceita e o que recusa.
 * Este arquivo prova o que aquele não alcança — que as peças compõem quando
 * rodam juntas. `prepararAlvo` busca o fluxo certo e escreve os arquivos certos,
 * `avaliarPatch` encadeia `applyPatch` + os dez portões + o portão do marcador +
 * o diff, e `instrucaoPatch` diz à sessão o que ela precisa saber.
 *
 * Ele nasceu como ensaio de uso único fora do repositório, e um ensaio que prova
 * alguma coisa e depois evapora é a mesma dívida que um portão sem teste.
 *
 * De graça e SEM REDE: o `n8n.js` é trocado no `require.cache` antes de o
 * `upgrade.js` carregar. Sem essa troca, `loadConfig()` lê o `.env` desta pasta —
 * que VENCE `process.env` — e uma chamada aqui falaria com a instância de
 * produção. Nada é escrito no n8n, aqui nem em lugar nenhum.
 *
 *   node remendo-test.js
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const REPO = __dirname;

const FLUXO = {
  id: "FILHO1", name: "Agente eContrate", active: false,
  updatedAt: "2026-08-19T10:00:00.000Z",
  nodes: [
    { name: "trigger", type: "n8n-nodes-base.executeWorkflowTrigger", typeVersion: 1, position: [0, 0], parameters: {} },
    { name: "monta_texto", type: "n8n-nodes-base.set", typeVersion: 3, position: [200, 0],
      parameters: { assignments: { assignments: [{ name: "texto", value: "=Ola {{ $json.nome }}" }] } },
      /* O fixture CARREGA credencial de propósito: o que este arquivo tem de
         provar é que ela não chega aos arquivos que a sessão lê nem ao diff que
         vai para o navegador. */
      credentials: { fake: { id: "c1", name: "NAO PODE VAZAR" } } },
    { name: "manda_whats", type: "n8n-nodes-base.whatsApp", typeVersion: 1, position: [400, 0],
      parameters: { textBody: "={{ $json.texto }}" } }
  ],
  connections: {
    trigger: { main: [[{ node: "monta_texto", type: "main", index: 0 }]] },
    monta_texto: { main: [[{ node: "manda_whats", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1" }
};

let pediu = null;
const cn = path.join(REPO, "n8n.js");
const real = require(cn);
require.cache[require.resolve(cn)].exports = Object.assign({}, real, {
  getRawWorkflow: async id => { pediu = id; return JSON.parse(JSON.stringify(FLUXO)); },
  locateNode: async () => { throw new Error("este teste nunca deve localizar nó"); }
});

const u = require(path.join(REPO, "upgrade.js"));
const fix = require(path.join(REPO, "claude-fix.js"));

let ok = 0, bad = 0;
const t = (n, c, x) => {
  if (c) { ok++; console.log("  ok    " + n); }
  else { bad++; console.log("  FALHA " + n + (x ? "\n          " + x : "")); }
};
const vermelhos = a => a.portoes.filter(g => !g.ok).map(g => g.nome + " — " + g.frase).join(" | ");

(async () => {
  const limpo = fix.sanitizedWorkflow(FLUXO);

  console.log("\n1. prepararAlvo — o que a sessão vai encontrar na pasta");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remendo-"));
  const s = {
    dir, wfId: "PAI", wfNome: "WhatsApp API Oficial",
    alvo: { nos: [{ nome: "monta_texto", novo: false }, { nome: "no_novo", novo: true }] },
    resolucao: { estado: "trocar", wfIdAlvo: "FILHO1", wfNomeAlvo: "Agente eContrate",
      redirecionado: { viaNode: "chama_econtrate" } }
  };
  const ctx = await u.prepararAlvo(s);

  /* O caso que carrega o §4.5 inteiro: com o alvo trocado, tudo tem de sair do
     FILHO. Buscar o pai aqui montaria o patch contra o documento errado — e o
     erro só apareceria no `applyPatch`, sem dizer que a causa foi essa. */
  t("busca o fluxo ALVO, não o que estava aberto", pediu === "FILHO1", "pediu " + pediu);
  t("os nomes válidos são os do filho", ctx.nomes.has("monta_texto") && !ctx.nomes.has("chama_econtrate"));
  t("um nó marcado `novo` não é procurado no documento", ctx.quantos === 3, "veio " + ctx.quantos);

  const arqs = fs.readdirSync(dir).sort();
  t("escreve os três arquivos da etapa 2",
    arqs.join(",") === "alvo-fluxo.json,alvo-nodes-index.md,target-nodes.json", arqs.join(","));
  const tudo = arqs.map(a => fs.readFileSync(path.join(dir, a), "utf8")).join("");
  t("NENHUM arquivo da sessão carrega credencial", !tudo.includes("NAO PODE VAZAR"));
  const tn = JSON.parse(fs.readFileSync(path.join(dir, "target-nodes.json"), "utf8"));
  t("target-nodes traz o valor exato dos campos", /textBody/.test(JSON.stringify(tn)));
  /* O CARIMBO, e ele é fail-OPEN quando falta.
     `escreverAprovado` escreve a recusa como `if (capturedUpdatedAt && ...)`, então
     um `undefined` não faz a guarda falhar fechada: faz ela ser PULADA. Sem este
     campo, alguém edita o fluxo no editor do n8n com a conversa aberta e o aplicar
     sobrescreve a edição sem uma palavra. Ficou meses assim sendo lido e nunca
     escrito. */
  t("prepararAlvo captura o updatedAt do documento que leu", ctx.updatedAt === "2026-08-19T10:00:00.000Z",
    "veio " + JSON.stringify(ctx.updatedAt));

  t("target-nodes é lista de nós, sem repetição",
    Array.isArray(tn) && new Set(tn.map(n => n.name)).size === tn.length);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log("\n2. avaliarPatch — applyPatch, os dez portões, o marcador e o diff, encadeados");
  const a1 = u.avaliarPatch(limpo, { updateNodes: [{ name: "monta_texto", parameters: {
    assignments: { assignments: [{ name: "texto", value: "=Boa tarde {{ $json.nome }}" }] } } }] });
  t("patch legítimo passa em todos os portões", a1.ok, a1.ok ? "" : vermelhos(a1));
  t("...e o diff conta 1 nó modificado", a1.diff && a1.diff.summary.modified === 1);
  /* O diff vai para o navegador. `diffWorkflow` redige os dois lados antes de
     montar, e é isso que este caso trava. */
  t("...e o diff não vaza credencial", !JSON.stringify(a1.diff).includes("NAO PODE VAZAR"));
  t("...e `avaliarPatch` não decide se é aplicável", !("aplicavel" in a1));

  const a2 = u.avaliarPatch(limpo, { updateNodes: [{ name: "monta_texto", parameters: { tabela: "[PREENCHER]" } }] });
  /* Diff nulo quando reprova é decisão, não descuido: um diff na tela ao lado de
     um portão vermelho convida a ler como proposta pronta. */
  t("[PREENCHER] reprova e o diff NÃO é montado", !a2.ok && a2.diff === null);
  t("...e o portão vermelho é o do marcador", a2.portoes.some(g => !g.ok && /marcador/.test(g.nome)));

  const a3 = u.avaliarPatch(limpo, { updateNodes: [{ name: "nao_existe", parameters: {} }] });
  t("nó inexistente reprova logo no primeiro portão", !a3.ok && !a3.portoes[0].ok);
  t("...e a frase que volta para o modelo nomeia o nó", /nao_existe/.test(a3.portoes[0].frase || ""));

  const a4 = u.avaliarPatch(limpo, {
    addNodes: [{ name: "log_supabase", type: "n8n-nodes-base.supabase", typeVersion: 1, position: [600, 0], parameters: {} }],
    rewire: { manda_whats: { main: [[{ node: "log_supabase", type: "main", index: 0 }]] } } });
  t("addNodes e rewire juntos passam", a4.ok, a4.ok ? "" : vermelhos(a4));
  t("...e o diff conta o nó novo e a aresta nova",
    a4.diff && a4.diff.summary.added === 1 && a4.diff.summary.edgesAdded >= 1);

  /* O §4.2 inteiro depende disto: sem verbo de apagar, desligar é O caminho para
     tirar um nó de serviço. Um portão que barrasse `disabled` tornaria isso
     impossível, e a única saída restante seria apagar — que não existe. */
  t("desligar um nó continua sendo caminho válido",
    u.avaliarPatch(limpo, { updateNodes: [{ name: "manda_whats", disabled: true }] }).ok);

  console.log("\n3. instrucaoPatch — o que a sessão de fato recebe");
  const ins = u.instrucaoPatch(s, { quantos: 3 });
  t("nomeia o fluxo alvo quando houve troca", /Agente eContrate/.test(ins));
  t("...e nomeia o nó que chama", /chama_econtrate/.test(ins));
  t("...e aponta os arquivos do ALVO", /alvo-nodes-index\.md/.test(ins));
  t("...e ensina a perguntar em vez de inventar", /tipo: "resposta"/.test(ins));
  t("cabe folgado no orçamento do prompt", ins.length < 4000, ins.length + " caracteres");
  /* Uma tarja de troca num alvo local mandaria a sessão procurar um sub-fluxo
     que não existe, e ela gastaria a rodada nisso. */
  t("sem troca de fluxo, não inventa tarja",
    !/ATENÇÃO/.test(u.instrucaoPatch({ resolucao: { estado: "local" } }, { quantos: 2 })));

  console.log("\n4. confirmarAlvo — as recusas que acontecem ANTES de gastar uma rodada");
  t("id desconhecido é 404", (await u.confirmarAlvo("uinexistente")).status === 404);

  console.log("\n" + (bad
    ? "FALHOU: " + bad + " de " + (ok + bad)
    : "passou: " + ok + " casos — a fiação do §4 compõe, e nada dela escreve no n8n"));
  process.exit(bad ? 1 : 0);
})();
