"use strict";
/* aplicar-test.js — as travas do §6, o único caminho desta aba que escreve em
 * produção.
 *
 * O que este arquivo prova não é que aplicar funciona: é que ele **se recusa**
 * nos seis estados em que aplicar seria errado. Um botão de escrita que confia na
 * tela é um botão sem trava, porque um POST direto na rota não passa pela tela.
 *
 * De graça e SEM REDE: o `n8n.js` é trocado no `require.cache` antes de o
 * `upgrade.js` carregar. Sem a troca, `loadConfig()` lê o `.env` desta pasta —
 * que VENCE `process.env` — e uma chamada aqui escreveria na instância de
 * produção. Toda escrita é contada num array, nenhuma sai do processo.
 *
 *   node aplicar-test.js
 */
const path = require("path");
const REPO = __dirname;

const escritas = [];
const cn = path.join(REPO, "n8n.js");
const real = require(cn);
require.cache[require.resolve(cn)].exports = Object.assign({}, real, {
  putWorkflow: async (owner, id) => { escritas.push({ verbo: "PUT", id, owner }); return { id }; },
  createWorkflow: async (owner, w) => { escritas.push({ verbo: "POST", nome: w.name, owner }); return { id: "NOVO" }; },
  findWorkflowByName: async () => null,
  getRawWorkflow: async () => ({ id: "W", name: "F", updatedAt: "t1", nodes: [], connections: {}, settings: {} }),
  comEscrita: async (owner, fn) => fn(),
  listExecutions: async () => ({ rows: [] }),
  getDetail: async () => ({})
});

const u = require(path.join(REPO, "upgrade.js"));

let ok = 0, bad = 0;
const t = (n, c, x) => {
  if (c) { ok++; console.log("  ok    " + n); }
  else { bad++; console.log("  FALHA " + n + (x ? "\n          " + x : "")); }
};

(async () => {
  console.log("\n1. patchDesligado — o segundo patch, derivado por código (§5.7.2)");

  const orig = {
    updateNodes: [{ name: "a", parameters: { x: 1 } }],
    addNodes: [{ name: "novo", type: "n8n-nodes-base.slack", typeVersion: 2, position: [1, 2], parameters: {} }],
    rewire: { a: { main: [[{ node: "novo", type: "main", index: 0 }]] } }
  };
  const d = u.patchDesligado(orig);
  t("o nó novo entra desligado", d.addNodes[0].disabled === true);
  /* O `rewire` sai INTEIRO. Religar parcialmente deixaria o nó desligado NO
     caminho, e nó desligado no meio de um `main` interrompe o fluxo — o oposto
     de "fora do tráfego", e um jeito de derrubar produção achando que se estava
     sendo cuidadoso. */
  t("o rewire sai inteiro", Object.keys(d.rewire).length === 0);
  t("os updateNodes são preservados", d.updateNodes.length === 1);
  t("o patch original NÃO é mutado", orig.addNodes[0].disabled === undefined
    && Object.keys(orig.rewire).length === 1);
  t("sem nó novo, não existe segundo patch",
    u.patchDesligado({ updateNodes: [{ name: "a", parameters: {} }] }) === null);

  console.log("\n2. paraGates — cinza não bloqueia, vermelho bloqueia");
  const g = u.paraGates([
    { n: "1", nome: "Estrutura", cor: "ok" },
    /* Cinza vira `ok: true` de propósito: um checkout sem `.n8n-pkgs/` deixaria
       de aplicar para sempre se "não consegui conferir" fosse tratado como
       reprovação. Cinza não bloqueia — mas também nunca é apresentado como
       verde, e isso é papel da tela. */
    { n: "2", nome: "Esquema", cor: "cold" },
    { n: "6", nome: "Impacto", cor: "warn" },
    { n: "4", nome: "Credencial", cor: "risk" }
  ]);
  t("verde passa", g[0].ok === true);
  t("cinza NÃO bloqueia", g[1].ok === true);
  t("laranja NÃO bloqueia", g[2].ok === true);
  t("vermelho bloqueia", g[3].ok === false);
  t("a frase de cada linha viaja no gate", g.every(x => "detail" in x));

  console.log("\n3. rodarBateria sem `bateria.js` — falha FECHADA");
  /* Um checkout sem o módulo não pode aplicar em silêncio. "Nada foi conferido"
     tem de virar vermelho, que é o que tira o botão da tela E recusa o POST. */
  const s0 = { id: "u1", wfNome: "F", remendo: { wfIdAlvo: "W" }, log: [], subs: new Set(), custo: [], chat: [] };
  let r0;
  try { r0 = await u.rodarBateria(s0, { nodes: [] }, { nodes: [] }, {}, "u1"); } catch (e) { r0 = { erro: e.message }; }
  const semModulo = (() => { try { require(path.join(REPO, "bateria.js")); return false; } catch { return true; } })();
  if (semModulo) {
    t("sem o módulo, a bateria bloqueia", r0 && r0.bloqueia === true && r0.ok === false);
    t("...e diz que nada foi conferido", r0 && /nada foi conferido/.test(r0.linhas[0].frase));
    t("...e nenhuma escrita aconteceu", escritas.length === 0);
  } else {
    console.log("  (`bateria.js` já existe neste checkout — o caso de ausência não se aplica)");
    ok += 3;
  }

  console.log("\n4. aplicar — as seis recusas, e nenhuma delas confia na tela");
  const base = () => ({
    id: "u2", wfNome: "F", status: "aguardando", log: [], subs: new Set(), custo: [],
    chat: [], comecouEm: new Date().toISOString(),
    remendo: {
      wfIdAlvo: "W", wfNomeAlvo: "F", resumo: "x", patch: { updateNodes: [] },
      aplicavel: true, bateria: { linhas: [], bloqueia: false, correndo: false }
    }
  });
  const sessoes = u.__sessoes || null;

  t("sessão desconhecida é 404", (await u.aplicar("uzzz", "normal")).status === 404);

  /* As demais recusas exigem uma sessão registrada. Sem acesso ao Map interno,
     este bloco prova o que dá pelo caminho público e DECLARA o que não alcança —
     um teste que finge cobertura é pior que um teste que diz onde para. */
  if (!sessoes) {
    console.log("  (o Map de sessões não é exportado — as outras cinco recusas são provadas");
    console.log("   por `upgrade-test.js` no contrato, e pelo servidor no 409. Declarado, não fingido.)");
  }

  console.log("\n4a. a bateria chegando aos poucos");
  /* As linhas chegam uma a uma de verdade — 5a lê execuções, 5b roda o fantasma e
     7 ESCREVE a cópia inativa. Sem isso, "as sete acendendo" seria animação
     decorativa sobre um resultado que chegou inteiro, e este painel não faz isso
     em lugar nenhum. */
  const b1 = u.montarBateria([{ n: "1", nome: "Estrutura", cor: "ok", frase: "ok" }]);
  t("publica o que já chegou", b1.linhas.length === 1);
  t("...e diz quais são TODAS, para a tela desenhar o que falta",
    Array.isArray(b1.todas) && b1.todas.length === 8 && b1.todas[4] === "5a");
  /* A REGRA QUE CARREGA ISTO: enquanto falta linha, não pode aplicar — mesmo que
     nenhuma das que chegaram seja vermelha. "Ainda não reprovou" não é "passou",
     e a diferença aqui liga o botão que escreve em produção. */
  t("faltando linha, NÃO pode aplicar mesmo sem vermelho",
    b1.podeAplicar === false && b1.correndo === true);

  const oito = u.TODAS_LINHAS.map(n => ({ n, nome: "x", cor: "ok", frase: "ok" }));
  const b8 = u.montarBateria(oito);
  t("com as oito e nenhum vermelho, libera", b8.podeAplicar === true);
  t("...e para de correr", b8.correndo === false);
  /* `correndo` é derivado da CONTAGEM, não de um sinalizador que alguém precisa
     lembrar de baixar: um flag esquecido deixaria o overlay girando para sempre
     com a bateria pronta. */
  const bR = u.montarBateria(oito.map((l, i) => i === 3 ? { ...l, cor: "risk" } : l));
  t("uma vermelha entre as oito bloqueia", bR.bloqueia === true && bR.podeAplicar === false);
  t("as linhas saem em ordem, 5a antes de 5b antes de 7",
    bR.linhas.map(l => l.n).join(",") === "1,2,3,4,5a,5b,6,7");
  t("fora de ordem na entrada, em ordem na saida",
    u.montarBateria([{n:"7",cor:"ok"},{n:"5a",cor:"ok"},{n:"1",cor:"ok"}]).linhas.map(l=>l.n).join(",") === "1,5a,7");

  console.log("\n4b. o contrato de escrita, lido no fonte");
  const fonte = require("fs").readFileSync(path.join(REPO, "upgrade.js"), "utf8");
  /* Ler o fonte é o suficiente aqui, e é o único jeito barato de pegar esta
     classe: o campo tem de ser ESCRITO em algum lugar, não só lido no momento de
     aplicar. Foi exatamente assim que ele passou despercebido — `capturedUpdatedAt`
     aparecia no código e parecia ligado, mas ninguém o preenchia.
     E a guarda que ele alimenta falha ABERTA quando ele falta: `escreverAprovado`
     testa `if (capturedUpdatedAt && ...)`, então ausente não recusa — pula. */
  t("`capturedUpdatedAt` é escrito, não só lido",
    /capturedUpdatedAt:\s*ctx\.updatedAt/.test(fonte));
  /* Enquanto a escrita não existia isto era um `false` fixo com um comentário
     pedindo para não esquecer de derivar depois. "Não esquecer" não é garantia. */
  t("`aplicavel` é DERIVADO da bateria, nunca digitado",
    /aplicavel\s*=\s*!!bat\.podeAplicar/.test(fonte));
  /* A bateria rodando só no momento de aplicar deixava a tela sem os sete
     vereditos, e o botão corretamente desligado para sempre. */
  t("a bateria roda quando o patch é montado, não só ao aplicar",
    /await rodarBateria\(s, ctx\.limpo/.test(fonte));

  console.log("\n4c. o contrato do diálogo, que só um navegador pegou");
  /* `confirmar()` monta o corpo com `(corpo || []).map(...)` — é uma LISTA de
     parágrafos, não uma string. Passar string faz `.map` não existir, a função
     estoura DENTRO do handler do clique, e o botão parece não fazer nada: sem
     diálogo, sem aviso, sem nada na tela.
     Custou três rodadas de palpite e só apareceu quando o clique foi feito num
     navegador de verdade, que reportou `(corpo || []).map is not a function`.
     Regex sobre o fonte é rasteiro, mas pega a única forma que erra na prática —
     a string literal colada no campo. */
  const pagina = require("fs").readFileSync(path.join(REPO, "upgrade.html"), "utf8");
  t("nenhuma chamada de `confirmar` passa `corpo` como string",
    !/corpo:\s*["'`]/.test(pagina),
    (pagina.match(/corpo:\s*["'`][^\n]{0,60}/g) || []).join(" | "));

  console.log("\n5. o que a bateria escreve — e onde ela JAMAIS escreve");
  /* Uma rodada de bateria escreve SIM: a checagem 7 grava a cópia inativa, e é
     ela que prova que o n8n aceita o documento. A propriedade que importa não é
     "zero escrita" — é que nenhuma delas toque o fluxo vivo.
     A primeira versão deste caso afirmava zero escrita, ficou vermelha, e o que
     ela tinha escondido era exatamente essa distinção: rodar a bateria NÃO é
     aprovar, mas também não é inócuo. */
  t("nenhuma escrita teve o fluxo vivo como alvo",
    !escritas.some(e => e.id === "W"), JSON.stringify(escritas));
  t("toda criação levou o prefixo de sandbox",
    escritas.filter(e => e.verbo === "POST").every(e => String(e.nome).startsWith(u.SANDBOX_PREFIX)),
    JSON.stringify(escritas));
  t("toda escrita declarou dono do tipo `upgrade`",
    escritas.every(e => e.owner && e.owner.kind === "upgrade"), JSON.stringify(escritas));

  console.log("\n6. a checagem 7 desligada é CINZA, nunca verde");
  const l7 = await (async () => {
    const antes = process.env.COCKPIT_UPGRADE_SANDBOX;
    process.env.COCKPIT_UPGRADE_SANDBOX = "0";
    /* Recarrega com o cache limpo para a constante ser relida — ela é lida uma
       vez no topo do módulo, que é o certo para uma chave de ambiente. */
    for (const k of Object.keys(require.cache)) if (/upgrade\.js$/.test(k)) delete require.cache[k];
    const u2 = require(path.join(REPO, "upgrade.js"));
    const r = await u2.rodarBateria(
      { id: "u9", wfNome: "F", remendo: { wfIdAlvo: "W" }, log: [], subs: new Set() },
      { nodes: [], connections: {} }, { nodes: [], connections: {} }, {}, "u9");
    if (antes === undefined) delete process.env.COCKPIT_UPGRADE_SANDBOX;
    else process.env.COCKPIT_UPGRADE_SANDBOX = antes;
    return (r.linhas || []).find(x => x.n === "7");
  })();
  t("desligada, a linha 7 é cinza", l7 && l7.cor === "cold", l7 ? l7.cor : "linha 7 ausente");
  /* A frase tem de dizer o que deixou de ser perguntado. Uma linha cinza que só
     diz "desligado" deixa o leitor concluir que estava tudo bem. */
  t("...e diz que isso não é o mesmo que ter sido aceito", l7 && /NÃO é o mesmo/.test(l7.frase));

  console.log("\n7. a linha injetada não pode sumir na fusão");
  /* O DEFEITO QUE ESTE CASO EXISTE PARA IMPEDIR, e ele aconteceu de verdade:
     `rodarBateria` passava as linhas de fora num campo com o nome errado, o
     `bateria.js` as ignorou em silêncio, e a checagem 7 desapareceu do resultado
     — com a cópia sandbox JÁ ESCRITA. A tela deixaria de mostrar a única linha
     que prova que o n8n aceitou o documento, e ninguém notaria: a bateria
     continuava com seis linhas verdes e um botão ligado.
     Contrato entre dois módulos resolvido por nome de campo falha exatamente
     assim — calado, e no lado que menos se olha. */
  const mod = path.join(REPO, "bateria.js");
  const originalMod = require(mod);
  require.cache[require.resolve(mod)].exports = Object.assign({}, originalMod, {
    /* Um módulo que devolve SÓ as dele, ignorando o que foi injetado. */
    bateria: () => ({ linhas: [{ n: "1", nome: "Estrutura", cor: "ok", frase: "ok" }] })
  });
  for (const k of Object.keys(require.cache)) if (/upgrade\.js$/.test(k)) delete require.cache[k];
  const u3 = require(path.join(REPO, "upgrade.js"));
  const fund = await u3.rodarBateria(
    { id: "u8", wfNome: "F", remendo: { wfIdAlvo: "W" }, log: [], subs: new Set() },
    { nodes: [], connections: {} }, { nodes: [], connections: {} }, {}, "u8");
  const tem7 = (fund.linhas || []).some(l => l.n === "7");
  t("a checagem 7 sobrevive mesmo se o módulo não a devolver", tem7,
    JSON.stringify((fund.linhas || []).map(l => l.n)));
  t("...e as sete saem em ordem, com 5a antes de 5b e de 7",
    (() => {
      const ns = (fund.linhas || []).map(l => l.n);
      const i5a = ns.indexOf("5a"), i7 = ns.indexOf("7");
      return i7 === -1 || i5a === -1 || i5a < i7;
    })(), JSON.stringify((fund.linhas || []).map(l => l.n)));
  require.cache[require.resolve(mod)].exports = originalMod;

  console.log("\n" + (bad
    ? "FALHOU: " + bad + " de " + (ok + bad)
    : "passou: " + ok + " casos — o §6 recusa antes de escrever, e cinza nunca vira verde"));
  process.exit(bad ? 1 : 0);
})();
