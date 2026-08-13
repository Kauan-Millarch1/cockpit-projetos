/* prompt-budget-test.js — o prompt cabe na linha de comando, no pior caso.
 *
 * O prompt viaja no argumento `-p` do CLI e o Windows limita a linha de comando
 * inteira a 32767 caracteres. Estourar não falha com "prompt grande": falha com
 * `spawn ENAMETOOLONG`, que não nomeia nem o prompt nem o tamanho — e foi assim
 * que o primeiro build de agente morreu, com 49KB de prompt.
 *
 * Este teste monta o PIOR caso de propósito. O caminho comum sempre cabe e não
 * prova nada; o que quebra é uma entrevista de quatro rodadas sobre um agente,
 * com o chat cheio e as respostas acumuladas.
 *
 * Uso: node prompt-budget-test.js   (não gasta modelo, não chama a rede)
 */

"use strict";

const assert = require("assert");
const cat = require("./.cache-catalog.json");
const { promptEntender, promptDesenhar, PROMPT_MAX } = require("./tester");

let ok = 0, falhou = 0;
const t = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); ok++; }
  catch (e) { console.log("  FALHA " + nome + "\n         " + String(e && e.message || e).split("\n")[0]); falhou++; }
};

/* O teto real do sistema, para a linha de comando INTEIRA. As flags do spawn
 * (`--output-format`, `--disallowedTools`, `--mcp-config`, o caminho do binário)
 * somam ~600 caracteres antes do prompt. */
const WINDOWS_MAX = 32767;
const OVERHEAD = 700;

const x = n => "x".repeat(n);

/* Uma sessão no pior caso plausível, com todos os tetos que o código aplica
 * estourados: ideia no limite, cinco textos livres de 2000, e a entrevista com as
 * 24 respostas que `responder()` permite acumular. */
function sessaoPior(ehAgente) {
  return {
    ideia: x(2000), nivel: "sou técnico", catalogo: cat, ehAgente,
    rodadaEntrevista: 2,
    chat: Array.from({ length: 5 }, () => ({ quem: "voce", texto: x(2000) })),
    respostas: Array.from({ length: 24 }, (_, i) => ({ q: x(300) + i, r: x(200) })),
    entendi: { quando: x(300), oQueFaz: x(600), resultado: x(300), ondeChega: x(300) },
    doc: { servico: "mercado pago", texto: x(20000), fontes: [] },
    ingredientes: { nos: Object.keys(cat.nodes).slice(0, 23).map(t2 => ({ tipo: t2 })) },
    /* Os CINCO arquivos de contexto, com a descrição do tamanho que elas têm de
     * verdade no `escreverContexto`. A lista viaja INLINE no prompt (só o
     * conteúdo é que fica no disco), então cada arquivo novo custa uma linha aqui
     * — e o dia em que alguém adiciona o sexto é o dia em que este caso deixa de
     * ser o pior caso, exatamente como aconteceu com os 40 anexos. */
    contexto: [
      { arquivo: "catalogo.json", o_que: "os tipos de nó desta instância, com as versões e a forma dos parâmetros", omitidos: [] },
      { arquivo: "esquema.json", o_que: "a DEFINIÇÃO de cada nó, na versão em uso: toda propriedade, o enum de cada discriminador, o que é obrigatório, sob qual operação cada chave existe, e o que o nó devolve", omitidos: ["n8n-nodes-base.algumTipoQueNaoCoube", "n8n-nodes-base.outroTipoQueNaoCoube"] },
      { arquivo: "GRAMATICA.md", o_que: "como se escreve um fluxo: o prefixo `=`, as três camadas de `connections`, a forma dos parâmetros compostos, erro e retry, e as armadilhas medidas" },
      { arquivo: "LICOES.md", o_que: "o que JÁ DEU ERRADO nestas construções — avisos medidos, não regras; onde o esquema e a gramática discordarem deles, eles perdem" },
      { arquivo: "AGENTES.md", o_que: "as sete camadas, as receitas de nó com typeVersion, e as armadilhas medidas" },
      { arquivo: "doc.md", o_que: "a ficha da API de mercado pago" }
    ],
    /* Os anexos no teto: 40 arquivos com nome longo, o que é exatamente o que
     * uma pasta arrastada produz. Sem eles neste caso, o pior caso do prompt
     * pararia de ser o pior caso no dia em que alguém anexou uma pasta — e a
     * falha apareceria como `spawn ENAMETOOLONG`, que não nomeia nem prompt nem
     * anexo. O `trechoPrompt` tem teto próprio; é ele que este caso prova. */
    anexos: Array.from({ length: 40 }, (_, i) => ({
      nome: "documento-de-especificacao-bem-comprido-" + i + ".md",
      arquivo: "anexos/pasta-do-cliente/subpasta/documento-de-especificacao-bem-comprido-" + i + ".md",
      tipo: i % 3 === 0 ? "imagem" : "texto", bytes: 200000,
      dePasta: i > 3, raiz: i > 3 ? "pasta-do-cliente" : null, segredosRemovidos: 0
    }))
  };
}

const relatar = (nome, p) => {
  const cmd = p.length + OVERHEAD;
  console.log("         " + nome.padEnd(28) + "prompt " + String(p.length).padStart(6) +
    "  linha " + String(cmd).padStart(6) + "  folga " + (WINDOWS_MAX - cmd));
};

console.log("o pior caso de cada prompt\n");

t("entrevista de AGENTE cabe no teto interno", () => {
  const p = promptEntender(sessaoPior(true));
  relatar("entrevista (agente)", p);
  assert.ok(p.length <= PROMPT_MAX, p.length + " chars, teto " + PROMPT_MAX);
});

t("entrevista de agente cabe na linha de comando, com folga", () => {
  const p = promptEntender(sessaoPior(true));
  const folga = WINDOWS_MAX - (p.length + OVERHEAD);
  assert.ok(folga >= 2000, "folga de só " + folga + " chars — apertado demais para um caminho novo");
});

t("entrevista de automação também cabe", () => {
  const p = promptEntender(sessaoPior(false));
  relatar("entrevista (automação)", p);
  assert.ok(p.length <= PROMPT_MAX, p.length + " chars, teto " + PROMPT_MAX);
});

t("construção de agente cabe — o conhecimento longo está em arquivo", () => {
  const p = promptDesenhar(sessaoPior(true), null);
  relatar("construção (agente)", p);
  assert.ok(p.length <= PROMPT_MAX, p.length + " chars, teto " + PROMPT_MAX +
    " — se estourou, material longo voltou para dentro do prompt em vez de ir para o diretório da corrida");
});

t("construção com correções da rodada anterior também cabe", () => {
  const correcoes = Array.from({ length: 12 }, (_, i) => "- falha número " + i + ": " + x(200)).join("\n");
  const p = promptDesenhar(sessaoPior(true), correcoes);
  relatar("construção + correções", p);
  assert.ok(p.length <= PROMPT_MAX, p.length + " chars, teto " + PROMPT_MAX);
});

/* Se o pior caso ficar pequeno, o teste passa por acidente e para de proteger. */
t("o pior caso é realmente grande (o teste não passou por acidente)", () => {
  const p = promptEntender(sessaoPior(true));
  assert.ok(p.length > 14000, "o pior caso deu só " + p.length + " chars — a montagem do caso está fraca");
});

/* A entrevista de agente tem que ser MAIOR que a de automação: é o bloco das doze
 * dimensões que faz a diferença, e se os dois tamanhos empatarem o bloco não está
 * entrando. */
t("a entrevista de agente carrega mais que a de automação", () => {
  const a = promptEntender(sessaoPior(true)).length;
  const b = promptEntender(sessaoPior(false)).length;
  assert.ok(a - b > 5000, "diferença de só " + (a - b) + " chars — o bloco de agente não está entrando");
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exit(falhou ? 1 : 0);
