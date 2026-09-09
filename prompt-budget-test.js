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
const fs = require("fs");
const path = require("path");

/* O CATALOGO E ESTADO POR CHECKOUT, e este arquivo dependia dele com um `require`
   seco. `.cache-catalog.json` e um cache — gitignorado de proposito, destilado dos
   fluxos vivos e regeneravel num comando — entao num checkout novo ele nao existe e
   o `require` derrubava a bateria com `Cannot find module`, uma mensagem que parece
   dependencia faltando num repositorio cuja regra e ter zero dependencia.
   MEDIDO num clone de verdade do remoto.
   O pulo sai com codigo 2 e NAO com 0: o prompt aqui e montado A PARTIR do catalogo,
   entao sem ele nao ha pior caso nenhum para medir, e dizer "passou" sobre uma
   medicao que nao aconteceu e a unica saida realmente errada. */
const CAT = path.join(__dirname, ".cache-catalog.json");
if (!fs.existsSync(CAT)) {
  console.log("PULADA: sem `.cache-catalog.json` neste checkout (e um cache, gitignorado).");
  console.log("        O pior caso do prompt e montado a partir do catalogo, entao sem ele");
  console.log("        nao ha o que medir. Para rodar: node catalog.js --refresh");
  process.exit(2);
}
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

/* ─────────────────── A CONVERSA DO UPGRADE, que faltava aqui ───────────────
 *
 * Este arquivo cobria só o Tester, e o `/upgrade` tem prompt próprio, teto próprio
 * e — desde 2026-08-19 — um teto de resposta MAIOR: uma resposta de investigação
 * foi recusada por tamanho e a sessão gastou uma rodada inteira reescrevendo. Subir
 * o teto do `texto` sem provar que cinco mensagens dele ainda cabem seria trocar
 * uma recusa nomeada por `spawn ENAMETOOLONG`, que não nomeia nem prompt nem
 * tamanho. */
const up = require("./upgrade.js");

/* A pior conversa possível: as mensagens dele no teto de `mensagem()` (2000) e as
 * dela no teto de `TEXTO_MAX`, alternando — mais dossiê laranja, os 3 pedidos de
 * evidência de `MAX_PEDIDOS` com resumo longo, e duas recusas da rodada anterior.
 * Vinte mensagens para que o corte por orçamento seja exercitado, não evitado. */
function conversaPior() {
  const chat = [];
  for (let i = 0; i < 10; i++) {
    chat.push({ de: "eu", texto: x(2000) });
    chat.push({ de: "ele", texto: x(up.TEXTO_MAX) });
  }
  return {
    chat, nos: 179,
    wfNome: "[ROBERTO] Agent — Iago Comercial com um nome de fluxo bem comprido para o pior caso",
    dossie: { usa: true, cor: "laranja", mudados: 12 },
    evidencias: Array.from({ length: up.MAX_PEDIDOS }, (_, i) => ({
      arquivo: "evidencia/" + (i + 1) + "-saida.json",
      resumo: "abri 4 de 4 execuções: #171281 (3 com saída, 2 não rodaram), #171291 (3 com saída, "
        + "2 não rodaram), #171294 (3 com saída, 2 não rodaram), #171300 (3 com saída) · 84.2KB"
    })),
    correcoes: ["um motivo de recusa bem comprido ".repeat(8), "outro motivo ".repeat(10)]
  };
}

t("a conversa do upgrade no pior caso cabe no teto interno", () => {
  const p = up.prompt(conversaPior());
  relatar("upgrade (conversa)", p);
  assert.ok(p.length <= up.PROMPT_MAX, p.length + " chars, teto " + up.PROMPT_MAX);
});

t("...e cabe na linha de comando do Windows com folga", () => {
  const p = up.prompt(conversaPior());
  const folga = WINDOWS_MAX - (p.length + OVERHEAD);
  assert.ok(folga >= 2000, "folga de só " + folga + " chars — apertado demais para um caminho novo");
});

/* O teto que cabe numa resposta e estoura a conversa não é conserto. A pior janela
 * de cinco é 3 dela no teto novo + 2 dele no teto de `mensagem()`. */
t("cinco mensagens no teto novo cabem no orçamento da conversa", () => {
  const pior = 3 * up.TEXTO_MAX + 2 * 2000;
  console.log("         pior janela de 5 mensagens: " + pior + " chars (ORC_CONVERSA " + up.ORC_CONVERSA + ")");
  assert.ok(pior <= up.ORC_CONVERSA, pior + " > ORC_CONVERSA " + up.ORC_CONVERSA
    + " — subiu o teto do texto sem subir o orçamento da conversa");
});

/* E as cinco têm de sobreviver DE VERDADE, não só na aritmética: se `ultimasAteCaber`
 * cortar uma delas, a conversa perdeu a decisão em vigor de duas trocas atrás. */
t("as cinco últimas mensagens sobrevivem ao corte", () => {
  const chat = [
    { de: "ele", texto: "R1 " + x(up.TEXTO_MAX - 3) },
    { de: "eu", texto: "K1 " + x(1997) },
    { de: "ele", texto: "R2 " + x(up.TEXTO_MAX - 3) },
    { de: "eu", texto: "K2 " + x(1997) },
    { de: "ele", texto: "R3 " + x(up.TEXTO_MAX - 3) }
  ];
  const r = up.ultimasAteCaber(chat, up.ORC_CONVERSA);
  for (const marca of ["R1 ", "K1 ", "R2 ", "K2 ", "R3 "]) {
    assert.ok(r.texto.includes(marca), "a mensagem " + marca.trim() + " caiu do prompt");
  }
  assert.strictEqual(r.cortadas, 0, "cortou mensagem numa janela de cinco que devia caber");
});

/* Se o corte por mensagem ficar abaixo do teto do texto, uma resposta longa é
 * truncada na rodada seguinte — e um modelo que não sabe o que perdeu reafirma o
 * que já tinha corrigido. */
t("o corte por mensagem não fica abaixo do teto da resposta", () => {
  assert.ok(up.MSG_SLICE >= up.TEXTO_MAX, "MSG_SLICE " + up.MSG_SLICE + " < TEXTO_MAX " + up.TEXTO_MAX);
});

/* ───────────── O UPGRADE COM ANEXO, que é o pior caso NOVO ──────────────────
 *
 * O `promptEntender` do Tester já carrega 40 anexos de nome longo aqui, justamente
 * para que o dia em que alguém arrastar uma pasta não seja o dia em que o pior caso
 * deixa de ser o pior caso. A conversa do Upgrade ganhou a mesma entrada e tem
 * MENOS folga: `PROMPT_MAX` 24000 contra ~16,4KB já gastos.
 *
 * E o bloco dos anexos tinha um buraco real: `anexos.trechoPrompt` põe teto na
 * lista de arquivos SOLTOS (`ORC_ANEXOS` interno, e ela diz quando corta) e nenhum
 * na lista de PASTAS — 40 raízes de nome longo somam ~4,8KB sem limite nenhum. É
 * por isso que `trechoAnexos` existe, com orçamento próprio e corte que se anuncia. */
const nomeLongo = i => "planilha-de-estoque-consolidado-2026-marketplace-" + String(i).padStart(2, "0") + ".csv";

// 40 arquivos, todos vindos de PASTAS DIFERENTES: é a forma que estoura o pedaço
// sem teto. Um por pasta, com nome de raiz longo.
function anexosPior() {
  return Array.from({ length: 40 }, (_, i) => {
    const raiz = "projeto-cliente-ecommercepuro-especificacao-" + String(i).padStart(2, "0");
    return {
      nome: nomeLongo(i), arquivo: "anexos/" + raiz + "/dados/" + nomeLongo(i),
      raiz, dePasta: true, tipo: "dados", bytes: 120000, segredosRemovidos: 1
    };
  });
}

t("o bloco de anexos tem orçamento próprio e respeita ele", () => {
  const t1 = up.trechoAnexos({ anexos: anexosPior() });
  console.log("         bloco de anexos (40, todos de pasta): " + t1.length
    + " chars (ORC_ANEXOS " + up.ORC_ANEXOS + ")");
  assert.ok(t1.length <= up.ORC_ANEXOS + 400,
    t1.length + " chars — o teto de " + up.ORC_ANEXOS + " não está sendo aplicado");
});

/* CORTAR CALADO É O DEFEITO, não o corte. Uma sessão que não sabe que perdeu
 * contexto pergunta o que o anexo já respondia — exatamente o que anexar existe
 * para evitar. O corte tem de nomear quanto ficou fora E onde a lista inteira está. */
t("...e quando corta, DIZ que cortou e aponta o índice", () => {
  const t1 = up.trechoAnexos({ anexos: anexosPior() });
  assert.ok(/cortado aqui/.test(t1), "cortou em silêncio");
  assert.ok(/anexos\/INDICE\.md/.test(t1), "cortou sem dizer onde está a lista completa");
});

t("...e não corta o que cabe", () => {
  const poucos = [{ nome: "print.png", arquivo: "anexos/print.png", dePasta: false, tipo: "imagem", bytes: 90000 }];
  const t1 = up.trechoAnexos({ anexos: poucos });
  assert.ok(!/cortado aqui/.test(t1), "cortou um bloco que caberia inteiro");
  assert.ok(/print\.png/.test(t1), "o nome do arquivo não entrou no prompt");
});

t("a conversa do upgrade COM 40 anexos ainda cabe no teto interno", () => {
  const s = conversaPior();
  s.anexos = anexosPior();
  const p = up.prompt(s);
  relatar("upgrade (conversa + 40 anexos)", p);
  assert.ok(p.length <= up.PROMPT_MAX, p.length + " chars, teto " + up.PROMPT_MAX);
});

t("...e cabe na linha de comando do Windows com folga", () => {
  const s = conversaPior();
  s.anexos = anexosPior();
  const p = up.prompt(s);
  const folga = WINDOWS_MAX - (p.length + OVERHEAD);
  assert.ok(folga >= 2000, "folga de só " + folga + " chars — apertado demais para um caminho novo");
});

/* O ARQUIVO NUNCA VIAJA NO PROMPT, só o índice. É a lição que o `escreverContexto`
 * do Tester pagou: um .md de 40KB inline mata o spawn com `ENAMETOOLONG`. */
t("o prompt carrega o índice, nunca o conteúdo do anexo", () => {
  const s = conversaPior();
  s.anexos = [{
    nome: "spec.md", arquivo: "anexos/spec.md", dePasta: false, tipo: "texto",
    bytes: 40 * 1024, conteudo: "SEGREDO-DO-CONTEUDO-QUE-NAO-PODE-VIAJAR"
  }];
  const p = up.prompt(s);
  assert.ok(!p.includes("SEGREDO-DO-CONTEUDO-QUE-NAO-PODE-VIAJAR"),
    "conteúdo de anexo entrou no prompt — é assim que se mata o spawn com ENAMETOOLONG");
  assert.ok(p.includes("anexos/INDICE.md"), "o prompt não manda ler o índice");
});

/* Sem anexo o prompt não muda de tamanho: quem não anexou nada não paga o bloco. */
t("sem anexo, nada do bloco entra no prompt", () => {
  const p = up.prompt(conversaPior());
  assert.ok(!/ELA ANEXOU MATERIAL/.test(p) && !/anexos\/INDICE\.md/.test(p),
    "o bloco de anexos entrou numa conversa sem anexo nenhum");
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exit(falhou ? 1 : 0);
