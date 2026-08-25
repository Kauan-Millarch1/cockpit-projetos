"use strict";
/* regras-anexo-test.js — o `REGRAS.md` que a sessão do /upgrade lê PRIMEIRO sai
 * do disco sabendo que existe anexo. Cada caso recusa um defeito com nome.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO DO `upgrade-test.js`: lá o bloco 7b mede a
 * PROSA (`u.regras(...)`, puro, sem tocar em disco) e aquele arquivo é inteiro
 * síncrono. Aqui se mede a FIAÇÃO, que é a metade que quase escapou: `regras()`
 * pode estar perfeita e `escreverRegras` passar `false` onde devia ler o
 * inventário — e aí todo caso sobre a prosa continua verde com o arquivo em disco
 * saindo sem o anexo, que é exatamente o defeito medido. Escrever em disco é
 * assíncrono, então o `main()` aqui é `async` e o resumo só imprime depois dele.
 *
 * O DEFEITO, MEDIDO: conversa `umt7kj5cc69ib` (24/08, `Agente eContrate`). O print
 * chegou ao disco — `.upgrade-runs/umt7kj5cc69ib/anexos/print-182748.png`, 66KB,
 * adotado da bandeja, com `INDICE.md` escrito ao lado — e o `REGRAS.md` daquela
 * pasta não continha a palavra "anexo". `prepararDir` escreve esse arquivo ANTES de
 * a bandeja ser adotada (é ele que cria o diretório onde o `rename` cai), então um
 * arquivo escrito só ali nunca poderia mencionar o anexo.
 *
 * DE GRAÇA: nenhum modelo, nenhum spawn, nenhuma chamada ao n8n, nada escrito no
 * repositório — só um `.md` num diretório temporário, apagado no `finally`.
 *
 *   node regras-anexo-test.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const u = require("./upgrade.js");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const bad = m => { total++; falhas++; console.log("  FALHA " + m); };
const t = (nome, cond) => cond ? ok(nome) : bad(nome);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regras-anexo-"));
  const ler = () => fs.readFileSync(path.join(dir, "REGRAS.md"), "utf8");
  try {
    console.log("\n1. o arquivo em disco, sem anexo nenhum");
    await u.escreverRegras({ dir, dossie: null, anexos: [] });
    const sem = ler();
    /* A direção oposta do defeito, e ela é igualmente ruim: um inventário que
       promete uma pasta que não existe gasta uma leitura recusada, e uma frase de
       ferramentas que promete `Glob` numa rodada sem `Glob` custa uma rodada em
       silêncio — "uma ferramenta negada custa uma rodada" é lição paga aqui. */
    t("não promete pasta de anexo que não existe", !/anexos\//.test(sem));
    t("não promete `Glob`, que esta rodada não recebe", !/`Glob`/.test(sem));
    t("continua dizendo quais arquivos existem", /nodes-index\.md/.test(sem) && /fluxo\.json/.test(sem));

    console.log("\n2. o mesmo diretório, agora com um anexo — a fiação");
    await u.escreverRegras({ dir, dossie: null, anexos: [{ arquivo: "anexos/print.png" }] });
    const com = ler();
    t("o arquivo em DISCO nomeia `anexos/INDICE.md`", /anexos\/INDICE\.md/.test(com));
    t("...e a lista de ferramentas passa a incluir `Glob`", /`Glob`/.test(com));
    /* Reescrever é reescrever. Um `appendFile` no lugar do `writeFile` deixaria
       duas versões no arquivo, e a sessão leria a antiga primeiro. */
    t("reescreve, não acumula: uma única seção «Os arquivos aqui»",
      (com.match(/## Os arquivos aqui/g) || []).length === 1);

    console.log("\n3. desanexar volta a zero, e a promessa tem de sair com o arquivo");
    await u.escreverRegras({ dir, dossie: null, anexos: [] });
    const zerado = ler();
    t("sem anexo de novo, a pasta de anexo sai do inventário", !/anexos\//.test(zerado));
    t("...e `Glob` deixa de ser prometido", !/`Glob`/.test(zerado));

    console.log("\n4. com dossiê, a ordem no arquivo escrito");
    await u.escreverRegras({ dir, dossie: { usa: true }, anexos: [{ arquivo: "anexos/print.png" }] });
    const dos = ler();
    /* `ARQ_COM_DOSSIE` diz "comece por aqui". Com anexo há duas instruções de
       primeira leitura no MESMO arquivo, e contradição num prompt é resolvida por
       quem lê — que é o modelo. O anexo é o PEDIDO e vem antes; o dossiê é o FLUXO. */
    t("o bloco do anexo vem ANTES do bloco do dossiê",
      dos.indexOf("anexos/INDICE.md") < dos.indexOf("`DOSSIE.md`"));
    t("...e o arquivo diz qual é qual, em vez de deixar as duas ordens no ar",
      /este índice é o \*\*pedido\*\*, o dossiê é o \*\*fluxo\*\*/.test(dos.replace(/\s+/g, " ")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("\n" + (falhas
    ? "FALHOU: " + falhas + " de " + total
    : "passou: " + total + " casos, e cada um recusa um defeito com nome"));
  process.exit(falhas ? 1 : 0);
}, err => {
  console.log("\nQUEBROU: " + (err && err.stack || err));
  process.exit(1);
});
