/* licoes-test.js — cada teste recusa um defeito com nome.
 *
 * Roda contra o `licoes.json` de verdade, porque é esse arquivo que as funções
 * conhecem — e o SALVA e RESTAURA byte a byte num `finally`. Ele é rastreado no
 * git e não se regenera: a rodada reprovada que gerou uma lição não existe mais
 * em lugar nenhum.
 *
 * Grátis: nenhum modelo, nenhuma rede, nenhuma escrita no n8n.
 *   node licoes-test.js
 */

"use strict";

const fs = require("fs");
const lic = require("./licoes.js");
const esq = require("./esquema.js");

let ok = 0, falhou = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(e && e.message)); }
};
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "") + " esperava " + JSON.stringify(b) + ", veio " + JSON.stringify(a)); };
const verdade = (v, m) => { if (!v) throw new Error(m || "esperava verdadeiro"); };

/* O backup. Sem isto, rodar o teste apaga as lições reais. */
let backup = null, existia = false;
try { backup = fs.readFileSync(lic.ARQ); existia = true; } catch { existia = false; }
const limpar = () => fs.writeFileSync(lic.ARQ, JSON.stringify({ v: lic.LICOES_V, licoes: [] }, null, 2), "utf8");

const e = esq.lerCache();

const no = (name, type, typeVersion, parameters) => ({ name, type, typeVersion, parameters });
const wf = nodes => ({ name: "t", nodes, connections: {}, settings: { executionOrder: "v1" } });

try {

console.log("\n[ o coletor do portão: rodada reprovada contra rodada aprovada ]");

if (!e) {
  console.log("  (sem `.cache-esquema.json` — pulando os testes do portão. Rode `node esquema.js --construir`)");
} else {

  t("chave inventada na rodada reprovada, ausente na aprovada, vira lição", () => {
    limpar();
    const falho = wf([no("le_cache", "n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v", inventada: 1 })]);
    const bom = wf([no("le_cache", "n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v" })]);
    const ls = lic.doPortao({ wfFalho: falho, wfBom: bom, esquema: e, ondeMedido: "build:x r1→r2" });
    igual(ls.length, 1, "quantidade de lições:");
    igual(ls[0].chave, "inventada");
    igual(ls[0].tipo, "n8n-nodes-base.redis");
    igual(ls[0].fonte, "portao");
    verdade(/NÃO existe/.test(ls[0].frase), "a frase não diz o que aconteceu: " + ls[0].frase);
  });

  t("erro que CONTINUOU na rodada aprovada não vira lição", () => {
    /* Sem esta conferência, uma lição nasceria de um defeito que segue lá e só
     * deixou de ser apontado por outro motivo — ensinar isso é pior que não
     * ensinar nada. */
    const falho = wf([no("le_cache", "n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v", inventada: 1 })]);
    igual(lic.doPortao({ wfFalho: falho, wfBom: falho, esquema: e, ondeMedido: "x" }), []);
  });

  t("nó renomeado na rodada aprovada não vira lição — não dá para provar que foi corrigido", () => {
    const falho = wf([no("le_cache", "n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v", inventada: 1 })]);
    const bom = wf([no("le_o_cache", "n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v" })]);
    igual(lic.doPortao({ wfFalho: falho, wfBom: bom, esquema: e, ondeMedido: "x" }), []);
  });

  t("valor fora do enum corrigido vira lição, e a frase nomeia a chave", () => {
    const falho = wf([no("le_cache", "n8n-nodes-base.redis", 1, { operation: "buscar", key: "k" })]);
    const bom = wf([no("le_cache", "n8n-nodes-base.redis", 1, { operation: "get", key: "k", propertyName: "v" })]);
    const ls = lic.doPortao({ wfFalho: falho, wfBom: bom, esquema: e, ondeMedido: "x" });
    verdade(ls.some(l => l.chave === "operation" && /não aceita o valor/.test(l.frase)), "não achei a lição do enum: " + JSON.stringify(ls));
  });

  t("sem esquema, o coletor do portão não inventa lição", () => {
    const falho = wf([no("x", "n8n-nodes-base.redis", 1, { inventada: 1 })]);
    igual(lic.doPortao({ wfFalho: falho, wfBom: wf([]), esquema: null, ondeMedido: "x" }), []);
  });
}

console.log("\n[ o coletor da edição: forma ensina, valor não ]");

t("mudança de VALOR não vira lição", () => {
  /* Trocar o canal do Slack é o Kauan dizendo o que quer, não corrigindo um erro
   * meu. Sem este filtro a base viraria um diário de preferências. */
  const antes = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { select: "channel", text: "=Chegou {{ $json.x }}" })]);
  const depois = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { select: "channel", text: "=Vendeu {{ $json.y }}" })]);
  igual(lic.daEdicao({ antes, depois, ondeMedido: "e" }), []);
});

t("mudança de FORMA vira lição: texto sem `=` que ganhou o `=`", () => {
  const antes = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { text: "Chegou {{ $json.x }}" })]);
  const depois = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { text: "=Chegou {{ $json.x }}" })]);
  const ls = lic.daEdicao({ antes, depois, ondeMedido: "e" });
  igual(ls.length, 1, "quantidade:");
  igual(ls[0].errado, "texto com {{ }} SEM o `=`");
  igual(ls[0].certo, "expressão (com `=`)");
  igual(ls[0].fonte, "edicao");
});

t("string trocada por resourceLocator vira lição, e a forma nomeia o `mode`", () => {
  const antes = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { channelId: "C123" })]);
  const depois = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { channelId: { __rl: true, mode: "list", value: "C123" } })]);
  const ls = lic.daEdicao({ antes, depois, ondeMedido: "e" });
  igual(ls.length, 1);
  igual(ls[0].errado, "texto");
  igual(ls[0].certo, "resourceLocator(mode:list)");
});

t("chave que apareceu ou desapareceu vira lição", () => {
  const antes = wf([no("grava", "n8n-nodes-base.redis", 1, { operation: "set" })]);
  const depois = wf([no("grava", "n8n-nodes-base.redis", 1, { operation: "set", key: "k" })]);
  const ls = lic.daEdicao({ antes, depois, ondeMedido: "e" });
  verdade(ls.some(l => l.chave === "key" && l.errado === "ausente"), "não pegou a chave nova: " + JSON.stringify(ls));
});

t("nó NOVO não corrige nada, então não vira lição", () => {
  const antes = wf([]);
  const depois = wf([no("novo", "n8n-nodes-base.redis", 1, { operation: "get", key: "k" })]);
  igual(lic.daEdicao({ antes, depois, ondeMedido: "e" }), []);
});

console.log("\n[ nenhum VALOR de parâmetro entra no arquivo — ele é rastreado no git ]");

t("`forma()` nunca devolve o valor, só a forma", () => {
  /* Este é o teste mais importante do arquivo. `licoes.json` vai para o git; um
   * telefone, um id de planilha ou um nome de canal dentro dele fura o mesmo
   * invariante que o `catalog.js` protege, e num lugar pior que um cache local. */
  const segredos = [
    "+55 41 99999-1395", "kauan@ecommercepuro.com.br", "C09KLV9DJSX",
    "1AbCdEfGhIjKlMnOpQrStUvWxYz", "sk-ant-api03-abcdef", "=Oi {{ $json.contato.nome }}"
  ];
  for (const v of segredos) {
    const f = lic.forma(v);
    verdade(!f.includes(v), "a forma devolveu o valor: " + f);
    for (const pedaco of [v.slice(0, 8), v.slice(-8)]) {
      verdade(!f.includes(pedaco), "a forma devolveu um pedaço do valor (" + pedaco + "): " + f);
    }
  }
  /* Nome de CHAVE pode aparecer — é vocabulário da API, não dado de ninguém. */
  verdade(lic.forma({ __rl: true, mode: "list", value: "C09KLV9DJSX" }) === "resourceLocator(mode:list)");
  verdade(!lic.forma({ telefone: "+5541999991395" }).includes("5541"), "vazou valor de dentro do objeto");
});

t("nenhuma lição gravada carrega valor de parâmetro", () => {
  limpar();
  const antes = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { channelId: "C09KLV9DJSX", text: "Oi +55 41 99999-1395" })]);
  const depois = wf([no("avisa", "n8n-nodes-base.slack", 2.4, { channelId: { __rl: true, mode: "list", value: "C09KLV9DJSX" }, text: "=Oi {{ $json.tel }}" })]);
  lic.registrar(lic.daEdicao({ antes, depois, ondeMedido: "e" }));
  const bruto = fs.readFileSync(lic.ARQ, "utf8");
  for (const v of ["C09KLV9DJSX", "99999-1395", "+55 41"]) {
    verdade(!bruto.includes(v), "o arquivo gravado contém `" + v + "`");
  }
});

console.log("\n[ dedupe, curadoria e poda ]");

t("a mesma lição duas vezes não cria duas entradas — incrementa `vezes`", () => {
  limpar();
  const l = { fonte: "portao", tipo: "n8n-nodes-base.redis", versao: 1, chave: "x", frase: "uma frase" };
  lic.registrar(l);
  lic.registrar({ ...l, ondeMedido: "build:2" });
  const base = lic.ler();
  igual(base.licoes.length, 1, "quantidade de entradas:");
  igual(base.licoes[0].vezes, 2, "contagem:");
  verdade(base.licoes[0].visto.includes("build:2"), "não anotou onde viu de novo");
});

t("lição DESCARTADA nunca volta a ser injetada", () => {
  /* Sem isto, uma lição que ele já recusou reaparece na próxima vez que o mesmo
   * erro acontecer — e ele recusa de novo, para sempre. */
  limpar();
  const [l] = lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.redis", versao: 1, chave: "x", frase: "frase ruim" });
  lic.decidir(l.id, "descartado", "não vale");
  lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.redis", versao: 1, chave: "x", frase: "frase ruim" });
  const base = lic.ler();
  igual(base.licoes.length, 1);
  igual(base.licoes[0].estado, "descartado", "o estado voltou para novo:");
  igual(lic.paraTipos(["n8n-nodes-base.redis"]), []);
  igual(lic.documento(["n8n-nodes-base.redis"]), null);
});

t("lição PROMOVIDA sai da injeção — a frase virou parágrafo na gramática", () => {
  limpar();
  const [l] = lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.redis", versao: 1, chave: "x", frase: "frase boa" });
  verdade(lic.documento(["n8n-nodes-base.redis"]), "não injetou enquanto era nova");
  lic.decidir(l.id, "promovido");
  igual(lic.documento(["n8n-nodes-base.redis"]), null, "continuou injetando depois de promovida:");
});

t("a poda preserva o que foi decidido e o que se repetiu", () => {
  limpar();
  const promovida = lic.registrar({ fonte: "portao", tipo: "t", frase: "promovida" })[0];
  lic.decidir(promovida.id, "promovido");
  const repetida = lic.registrar({ fonte: "portao", tipo: "t", frase: "repetida" })[0];
  lic.registrar({ fonte: "portao", tipo: "t", frase: "repetida" });
  for (let i = 0; i < lic.MAX_LICOES + 20; i++) lic.registrar({ fonte: "portao", tipo: "t", frase: "enchendo " + i });
  const base = lic.ler();
  verdade(base.licoes.length <= lic.MAX_LICOES, "passou do teto: " + base.licoes.length);
  verdade(base.licoes.some(x => x.id === promovida.id), "a poda comeu uma lição promovida");
  verdade(base.licoes.some(x => x.id === repetida.id), "a poda comeu uma lição vista 2×");
});

t("`resumo()` tem cache, e uma lição nova ainda aparece", () => {
  /* O cache existe porque a rota de status é lida a cada 6s por até três páginas
   * desde o `aba.js`. Se ele não invalidar, a contagem na tela congela e a base
   * aprende sem ninguém saber — que é o defeito que a curadoria existe para
   * evitar. */
  limpar();
  igual(lic.resumo().total, 0, "começou sujo:");
  lic.registrar({ fonte: "portao", tipo: "t", frase: "para o resumo" });
  igual(lic.resumo().total, 1, "o cache não invalidou depois de gravar:");
  igual(lic.resumo().aRevisar, 1);
  const [l2] = lic.registrar({ fonte: "portao", tipo: "t", frase: "outra" });
  lic.decidir(l2.id, "descartado");
  const r = lic.resumo();
  igual(r.total, 2);
  igual(r.aRevisar, 1, "a descartada continuou contando como a revisar:");
});

console.log("\n[ o documento que vai para a corrida ]");

t("sem lição para os tipos em jogo, o documento é `null`", () => {
  limpar();
  lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.slack", frase: "algo sobre slack" });
  igual(lic.documento(["n8n-nodes-base.redis"]), null, "injetou lição de outro tipo:");
});

t("o documento diz que é AVISO e que perde do esquema", () => {
  limpar();
  lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.redis", frase: "uma frase medida" });
  const d = lic.documento(["n8n-nodes-base.redis"]);
  verdade(/AVISOS, não regras/.test(d), "não diz que é aviso");
  verdade(/eles ganham/.test(d), "não diz quem ganha em caso de conflito");
  verdade(d.includes("uma frase medida"), "a frase não entrou");
});

t("o que não couber no teto é DITO, não perdido em silêncio", () => {
  limpar();
  for (let i = 0; i < 20; i++) {
    lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.redis", frase: "lição comprida numero " + i + " " + "x".repeat(250) });
  }
  const d = lic.documento(["n8n-nodes-base.redis"]);
  verdade(d.length <= lic.TETO_PROMPT + 200, "estourou o teto: " + d.length);
  verdade(/não couberam/.test(d), "cortou em silêncio");
});

t("produção SEM diagnóstico colapsa por tipo; COM diagnóstico nunca colapsa", () => {
  /* Medido na primeira colheita real: três assinaturas do mesmo `slack` viravam
   * três linhas dizendo a mesma coisa com nomes de nó de outros fluxos — que não
   * ajudam ninguém a escrever este. */
  limpar();
  for (const no of ["a", "b", "c"]) {
    lic.registrar(lic.daProducao({ tipo: "n8n-nodes-base.slack", no, erro: "NodeOperationError", quantas: 1, ondeMedido: "f:" + no }));
  }
  let d = lic.documento(["n8n-nodes-base.slack"]);
  igual((d.match(/^- /gm) || []).length, 1, "não colapsou:");
  verdade(/3 vezes/.test(d), "não disse quantas: " + d);

  lic.registrar(lic.daProducao({
    tipo: "n8n-nodes-base.slack", no: "d", erro: "NodeApiError — o Kauan anotou: o canal não existia",
    comDiagnostico: true, quantas: 1, ondeMedido: "f:d"
  }));
  d = lic.documento(["n8n-nodes-base.slack"]);
  igual((d.match(/^- /gm) || []).length, 2, "a com diagnóstico foi colapsada junto:");
  verdade(/o canal não existia/.test(d), "perdeu o diagnóstico");
});

t("produção ordena antes de portão com a mesma evidência", () => {
  limpar();
  lic.registrar({ fonte: "portao", tipo: "n8n-nodes-base.redis", frase: "do portao" });
  lic.registrar(lic.daProducao({ tipo: "n8n-nodes-base.redis", no: "le", erro: "ECONNRESET", quantas: 1, ondeMedido: "fixes.json:a|b|c" }));
  const ls = lic.paraTipos(["n8n-nodes-base.redis"]);
  igual(ls[0].fonte, "producao", "a de produção não veio primeiro:");
});

t("`daProducao` sem mensagem de erro não inventa lição", () => {
  igual(lic.daProducao({ tipo: "n8n-nodes-base.redis", no: "x", erro: "", quantas: 1 }), []);
  igual(lic.daProducao({ tipo: "", no: "x", erro: "algo", quantas: 1 }), []);
});

t("uma lição malformada é descartada, não gravada pela metade", () => {
  limpar();
  igual(lic.registrar([{ fonte: "inventada", tipo: "t", frase: "x" }, { fonte: "portao", frase: "sem tipo" }, { fonte: "portao", tipo: "t" }]), []);
  igual(lic.ler().licoes.length, 0);
});

t("a chave composta é `JSON.stringify` de um array, nunca concatenação", () => {
  /* Chave composta escrita à mão já saiu com U+0000 duas vezes neste
   * repositório, silenciosamente — uma chave que nunca casa não dá erro. */
  const k = lic.chave({ fonte: "portao", tipo: "a|b", versao: 1, chave: "c|d", frase: "e" });
  verdade(k.startsWith("["), "não é JSON de array: " + k);
  verdade(!/[\x00-\x1f]/.test(k), "a chave tem caractere de controle");
  /* E é imune a separador dentro do conteúdo: estes dois não podem colidir. */
  const k1 = lic.chave({ fonte: "portao", tipo: "a", versao: null, chave: "b|c", frase: "f" });
  const k2 = lic.chave({ fonte: "portao", tipo: "a|b", versao: null, chave: "c", frase: "f" });
  verdade(k1 !== k2, "duas lições diferentes geraram a mesma chave");
});

} finally {
  if (existia) fs.writeFileSync(lic.ARQ, backup);
  else { try { fs.unlinkSync(lic.ARQ); } catch { /* nunca existiu */ } }
  try { fs.unlinkSync(lic.ARQ + ".tmp"); } catch { /* já removido pelo rename */ }
}

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exitCode = falhou ? 1 : 0;
