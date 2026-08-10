/* lixeira-test.js — excluir move, restaurar volta, apagar de vez acaba.
 *
 * Roda contra a pasta `projetos/` de VERDADE, porque é ela que as funções
 * conhecem — não há injeção de diretório e inventar uma seria testar outro
 * código. O fixture tem nome próprio (`zz-teste-lixeira-*`), nunca colide com um
 * projeto real, e a limpeza está num `finally`: se algo estourar no meio, os
 * arquivos saem do mesmo jeito.
 *
 * Grátis: nenhum modelo, nenhuma rede, nenhuma escrita no n8n.
 * `node lixeira-test.js`
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const t8 = require("./tester");

const PROJETOS = path.join(__dirname, "projetos");
const LIXEIRA = path.join(PROJETOS, ".lixeira");
const PREFIXO = "zz-teste-lixeira";

let ok = 0, bad = 0;
const passos = [];
const t = (nome, fn) => passos.push({ nome, fn });
const grupo = n => passos.push({ grupo: n });

const projetoFalso = (slug, titulo) => ({
  slug, titulo,
  ideia: "fixture do teste da lixeira — pode apagar",
  nivel: "sou técnico", salvoEm: new Date().toISOString(),
  wf: { name: slug, nodes: [{ name: "um_no", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [0, 0], parameters: {} }], connections: {}, settings: {} },
  custoTotal: 1.23, versoes: [{ em: new Date().toISOString(), pedido: "x", resumo: "y", wf: { nodes: [] } }]
});

const escrever = async p => {
  await fsp.mkdir(PROJETOS, { recursive: true });
  await fsp.writeFile(path.join(PROJETOS, p.slug + ".json"), JSON.stringify(p, null, 2), "utf8");
};
const existe = f => fs.existsSync(f);
const naProjetos = slug => path.join(PROJETOS, slug + ".json");

async function limpar() {
  for (const dir of [PROJETOS, LIXEIRA]) {
    let fs2 = [];
    try { fs2 = await fsp.readdir(dir); } catch { continue; }
    for (const f of fs2) {
      if (f.startsWith(PREFIXO)) { try { await fsp.unlink(path.join(dir, f)); } catch { /* já foi */ } }
    }
  }
}

// ---------------------------------------------------------------------------

grupo("excluir move, não apaga");

const A = PREFIXO + "-a";
let lixoA = null;

t("excluir tira de projetos/ e põe na lixeira", async () => {
  await escrever(projetoFalso(A, "Projeto A do teste"));
  const r = await t8.excluirProjeto(A);
  lixoA = r.lixo;
  assert.ok(!existe(naProjetos(A)), "o arquivo continuou em projetos/");
  assert.ok(existe(path.join(LIXEIRA, r.lixo + ".json")), "não apareceu na lixeira");
});

t("ele some da lista de projetos e aparece na da lixeira, com o custo", async () => {
  const projetos = await t8.listarProjetos();
  assert.ok(!projetos.some(p => p.slug === A), "continuou listado como projeto");
  const item = (await t8.listarLixeira()).find(x => x.lixo === lixoA);
  assert.ok(item, "não apareceu na lixeira");
  assert.strictEqual(item.titulo, "Projeto A do teste");
  assert.ok(item.excluidoEm, "sem data de exclusão — a tela precisa dela");
  // O que se perde ao apagar de vez tem que estar visível ANTES do clique.
  assert.strictEqual(item.custoTotal, 1.23);
  assert.strictEqual(item.versoes, 1);
  assert.strictEqual(item.nos, 1);
});

t("excluir um slug que não existe é 404, e não cria lixo", async () => {
  await assert.rejects(() => t8.excluirProjeto(PREFIXO + "-nao-existe"), e => e.status === 404);
});

t("identificador inválido é recusado antes de tocar em disco", async () => {
  for (const mau of ["../fora", "COM/BARRA", "a".repeat(80)]) {
    await assert.rejects(() => t8.excluirProjeto(mau), e => e.status === 400, "aceitou: " + mau);
  }
});

grupo("restaurar volta inteiro");

t("restaurar devolve para projetos/ e sai da lixeira", async () => {
  const r = await t8.restaurarProjeto(lixoA);
  assert.strictEqual(r.slug, A);
  assert.strictEqual(r.renomeado, false);
  assert.ok(existe(naProjetos(A)), "não voltou para projetos/");
  assert.ok(!existe(path.join(LIXEIRA, lixoA + ".json")), "continuou na lixeira");
  const p = await t8.lerProjeto(A);
  assert.strictEqual(p.excluidoEm, undefined, "voltou carregando a marca de excluído");
  assert.ok(p.restauradoEm, "não registrou quando voltou");
  assert.strictEqual((p.versoes || []).length, 1, "perdeu o histórico de edições na viagem");
});

/* O slug pode ter sido reocupado enquanto o projeto estava na lixeira — nada
 * impede salvar um projeto novo com o mesmo nome. Sobrescrever seria trocar um
 * dado vivo por um morto. */
t("slug reocupado: volta com outro identificador e AVISA que voltou", async () => {
  const r1 = await t8.excluirProjeto(A);
  await escrever(projetoFalso(A, "Um projeto novo ocupando o nome"));
  const r2 = await t8.restaurarProjeto(r1.lixo);
  assert.strictEqual(r2.renomeado, true, "não avisou que o identificador mudou");
  assert.notStrictEqual(r2.slug, A);
  assert.ok(existe(naProjetos(r2.slug)), "o restaurado não apareceu");
  const ocupante = await t8.lerProjeto(A);
  assert.strictEqual(ocupante.titulo, "Um projeto novo ocupando o nome", "sobrescreveu o projeto vivo");
  await fsp.unlink(naProjetos(r2.slug));
});

t("restaurar algo que não está lá é 404", async () => {
  await assert.rejects(() => t8.restaurarProjeto(PREFIXO + "-x__20260810120000"), e => e.status === 404);
});

t("identificador de lixeira fora do formato é 400", async () => {
  for (const mau of ["sem-carimbo", "../fora__20260810120000", "a__123"]) {
    await assert.rejects(() => t8.restaurarProjeto(mau), e => e.status === 400, "aceitou: " + mau);
  }
});

grupo("apagar de vez acaba");

t("apagar de vez tira da lixeira e não devolve para projetos/", async () => {
  const r = await t8.excluirProjeto(A);
  await t8.excluirDaLixeira(r.lixo);
  assert.ok(!existe(path.join(LIXEIRA, r.lixo + ".json")), "continuou na lixeira");
  assert.ok(!existe(naProjetos(A)), "reapareceu em projetos/");
  assert.ok(!(await t8.listarLixeira()).some(x => x.lixo === r.lixo));
});

t("apagar de vez o que não existe é 404", async () => {
  await assert.rejects(() => t8.excluirDaLixeira(PREFIXO + "-y__20260810120000"), e => e.status === 404);
});

/* Excluir duas vezes o mesmo slug é normal — construir de novo com o mesmo nome
 * acontece. Sem o carimbo de tempo no nome do arquivo, a segunda exclusão
 * sobrescreveria a primeira, apagando calado exatamente o que a lixeira existe
 * para não apagar. */
t("excluir o mesmo slug duas vezes guarda os DOIS", async () => {
  await escrever(projetoFalso(A, "primeira versão"));
  const r1 = await t8.excluirProjeto(A);
  // O carimbo tem segundos; sem esperar, dois no mesmo segundo colidem.
  await new Promise(r => setTimeout(r, 1100));
  await escrever(projetoFalso(A, "segunda versão"));
  const r2 = await t8.excluirProjeto(A);
  assert.notStrictEqual(r1.lixo, r2.lixo, "o segundo sobrescreveu o primeiro");
  const lix = await t8.listarLixeira();
  const meus = lix.filter(x => x.lixo === r1.lixo || x.lixo === r2.lixo);
  assert.strictEqual(meus.length, 2, "só um dos dois sobreviveu");
  assert.deepStrictEqual(meus.map(x => x.titulo).sort(), ["primeira versão", "segunda versão"]);
  // A lista sai do mais recente para o mais antigo.
  assert.strictEqual(lix[0].lixo, r2.lixo, "a ordem não é do mais recente para o mais antigo");
  for (const x of meus) await t8.excluirDaLixeira(x.lixo);
});

t("a lixeira nunca aparece como projeto", async () => {
  await escrever(projetoFalso(A, "para checar a listagem"));
  await t8.excluirProjeto(A);
  const projetos = await t8.listarProjetos();
  assert.ok(!projetos.some(p => String(p.slug || "").includes(".lixeira")), "o diretório virou item de projeto");
  assert.ok(!projetos.some(p => p.slug === A));
});

// ---------------------------------------------------------------------------

(async () => {
  try {
    await limpar();
    for (const p of passos) {
      if (p.grupo) { console.log("\n" + p.grupo); continue; }
      try { await p.fn(); ok++; console.log("  ok   " + p.nome); }
      catch (e) { bad++; console.log("  FALHA " + p.nome + "\n         " + (e && e.message)); }
    }
  } finally {
    await limpar();
    console.log("\npassou: " + ok + " ok, " + bad + " falha(s)\n");
    process.exit(bad ? 1 : 0);
  }
})();
