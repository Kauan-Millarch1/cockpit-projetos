// A nota permanente do quadro de erros não pode sair mutilada de fixNote().
//
// Cada teste rejeita um defeito nomeado que já aconteceu (ou quase) aqui:
// markdown removido onde não era markdown corrompeu fixes.json em silêncio —
// e esse arquivo é o único registro de como cada falha foi resolvida.
// Grátis: sem modelo, sem rede, sem escrever no n8n. `node fixnote-test.js`.

const { fixNote } = require("./claude-fix.js");

let falhas = 0;
function caso(nome, cond, obtido) {
  if (cond) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHOU " + nome);
  console.log("         nota: " + obtido);
}

// Monta um run mínimo cujo report abre com **Resumo:** — o caminho principal.
function runComResumo(resumo) {
  return { report: "**Resumo:** " + resumo + "\n\n## Causa raiz\n\nprosa.", diff: { summary: null, nodes: [{ name: "no_alvo" }] } };
}

// 1. snake_case dentro de palavra — o defeito que mutilou fixes.json de verdade
// (strip global de `_` transformou "filtrar_por_horario" em "filtrarporhorario").
let n = fixNote(runComResumo("Liguei retry em `filtrar_por_horario` porque o task runner caiu."));
caso("nó snake_case sobrevive inteiro", n.includes("filtrar_por_horario porque"), n);
caso("versão mutilada não existe", !n.includes("filtrarporhorario"), n);

// 2. #canal no meio da frase — o strip global de `#` fez "#estoque" virar
// "estoque" e a nota passou a dizer que o app não era "membro do estoque".
n = fixNote(runComResumo("o app do Slack não é membro do #estoque; convide-o lá."));
caso("#canal no meio da linha fica", n.includes("#estoque"), n);

// 3. conteúdo de crase não participa do parse de ênfase — apagar as crases
// antes fazia "`a*b` e `c*d`" virar "ab e cd": dois identificadores fabricados.
n = fixNote(runComResumo("o campo `a*b` e `c*d` mudaram de tipo."));
caso("expressões entre crases ficam intactas", n.includes("a*b e c*d"), n);

// 4. asterisco solto é multiplicação, não itálico — o par sem encostar no
// conteúdo apagava a conta ("maxTries waitBetweenTries 2").
n = fixNote(runComResumo("mudei maxTries * waitBetweenTries * 2 no nó."));
caso("multiplicação com * espaçado sobrevive", n.includes("maxTries * waitBetweenTries * 2"), n);

// 5. glob é asterisco colado só de um lado — não é par de ênfase.
n = fixNote(runComResumo("passei a ler só *.json e *.md do diretório."));
caso("globs *.ext sobrevivem", n.includes("*.json e *.md"), n);

// 6. markdown de verdade ainda sai: negrito, itálico, _ênfase_ isolada, crase.
n = fixNote(runComResumo("o nó _antigo_ usava *retry* com **três** tentativas e `jsCode` puro."));
caso("ênfase de verdade é removida", n.includes("o nó antigo usava retry com três tentativas e jsCode puro"), n);

// 7. título e citação saem só no começo da linha (fallback "O que mudei" lê
// texto multilinha, onde `>` e `#` de bloco aparecem de fato).
n = fixNote({ report: "## O que mudei\n\n> citação de contexto\n\n- Ajustei o timeout de 60s para 120s no nó de fila, sem tocar em mais nada do fluxo. Fim.", diff: { summary: null, nodes: [] } });
caso("citação em começo de linha sai", !n.includes(">"), n);

console.log("");
if (falhas) {
  console.log("FALHOU: " + falhas + " caso(s). A nota permanente sairia corrompida.");
  process.exit(1);
}
console.log("passou: a nota do quadro de erros sai como o report escreveu.");
