/* gramatica.js — a máquina em volta de `n8n-gramatica.md`.
 *
 * O `esquema.js` responde "que propriedades este tipo de nó tem, nesta versão,
 * sob esta operação". Ele NÃO responde como se escreve um `filter`, por que a
 * expressão precisa começar com `=`, o que `onError` faz, ou por que a resposta
 * de um webhook vem antes do processamento e não depois. Isso não está em
 * descriptor nenhum: mora em prosa.
 *
 * O CONHECIMENTO NÃO ESTÁ AQUI — está em `n8n-gramatica.md`, lido em runtime.
 * Este arquivo é só a máquina: extrair o bloco certo, dizer o que faltou, e
 * montar o `GRAMATICA.md` que vai para o diretório da corrida. Editar o doc muda
 * o que o Tester constrói sem tocar em código e sem reiniciar o servidor —
 * mesmíssimo desenho do `agentes.js`, e pelo mesmo motivo.
 *
 * FATOS APENAS: nada aqui decide se um fluxo é bom.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DOC = path.join(__dirname, "n8n-gramatica.md");
/* Sem ciclo: `novidades.js` só conhece `fs` e `path`. Ele entra aqui porque o
   arquivo da corrida é UM — a sessão já abre o `GRAMATICA.md`, e um segundo doc
   ao lado seria mais um arquivo que ela pode não abrir. */
const novidades = require("./novidades.js");

/* Os blocos que alguém lê. Um bloco no doc que não está nesta lista é ou erro de
 * digitação na âncora, ou seção escrita esperando ser usada — as duas merecem
 * ser ditas em voz alta, e é o que `docStatus()` faz. */
const ESPERADOS = ["forma", "widgets", "robustez", "topologia", "armadilhas"];

/* ------------------------------------------------------------------- o doc */

/* Lido a cada build, com cache por mtime — não uma vez no boot. O doc é a parte
 * que o Kauan mais ajusta, e exigir restart para uma frase nova seria o mesmo
 * erro que manter julgamento no servidor. */
let cache = { mtime: 0, texto: null, blocos: null };

function lerDoc() {
  let st;
  try { st = fs.statSync(DOC); } catch { return { texto: null, blocos: {} }; }
  if (cache.mtime === st.mtimeMs && cache.blocos) return cache;

  let texto = null;
  try { texto = fs.readFileSync(DOC, "utf8"); } catch { return { texto: null, blocos: {} }; }

  /* Âncoras SOZINHAS na linha (`^…$` com `m`). Sem isso, a própria tabela do doc
   * que explica o formato — ela cita a âncora no meio de uma frase — é lida como
   * bloco de verdade e aparece um bloco fantasma com a prosa entre as duas
   * menções. Já aconteceu no `tester-agentes.md`. Bloco sem fechamento é
   * ignorado em vez de engolir o resto do arquivo. */
  const blocos = {};
  const re = /^[ \t]*<!--[ \t]*BLOCO:[ \t]*([a-z-]+)[ \t]*-->[ \t]*$([\s\S]*?)^[ \t]*<!--[ \t]*\/BLOCO[ \t]*-->[ \t]*$/gm;
  let m;
  while ((m = re.exec(texto))) blocos[m[1]] = m[2].trim();

  cache = { mtime: st.mtimeMs, texto, blocos };
  return cache;
}

/* Um bloco, ou string vazia. Nunca lança: doc ausente degrada para "o Tester se
 * comporta como antes desta feature". `docStatus()` é quem diz que faltou, para
 * a ausência não passar por normal. */
function bloco(nome) {
  const { blocos } = lerDoc();
  return (blocos && blocos[nome]) || "";
}

function docStatus() {
  const { texto, blocos } = lerDoc();
  const nomes = Object.keys(blocos || {});
  return {
    encontrado: !!texto,
    arquivo: "n8n-gramatica.md",
    chars: texto ? texto.length : 0,
    blocos: nomes,
    faltando: ESPERADOS.filter(b => !nomes.includes(b)),
    desconhecidos: nomes.filter(b => !ESPERADOS.includes(b))
  };
}

/* ------------------------------------------------- o arquivo da corrida */

/* Vai para o disco, não para o prompt.
 *
 * A mesma lição que o `escreverContexto` já pagou: o prompt viaja em `-p` e a
 * linha de comando do Windows acaba em 32767 caracteres. E vale por três razões
 * além de caber — a sessão lê o bloco de que precisa em vez de carregar tudo,
 * pode `Grep` por um termo, e O QUE ELA LEU APARECE NO LOG DE ATIVIDADE, então
 * dá para ver se consultou a gramática ou improvisou. */
function documento({ ehAgente = false } = {}) {
  const partes = [
    "# A gramática do n8n — o que o esquema não diz",
    "",
    "Isto não é sugestão. É a forma que o n8n aceita, medida em fluxos que funcionam e lida da",
    "definição dos nós. Onde este arquivo e a sua memória discordarem, este arquivo ganha: ele foi",
    "conferido contra o pacote `n8n-nodes-base` em uso nesta instância, e a sua memória foi treinada",
    "em versões que já mudaram de forma.",
    "",
    bloco("forma"),
    "",
    bloco("widgets"),
    "",
    bloco("robustez"),
    "",
    bloco("topologia"),
    "",
    bloco("armadilhas")
  ];

  /* As novidades entram NO FIM e com cabeçalho próprio, nunca misturadas aos
   * blocos acima. Duas razões, e a segunda é o ponto: elas são mais NOVAS que a
   * gramática (que foi conferida contra o pacote em uso), então quando as duas
   * discordam quem ganha é a de baixo — e para isso a sessão precisa conseguir
   * ver qual é qual. E a origem é diferente: aquilo ali foi curado à mão, isto
   * foi escrito por um job sozinho a partir do changelog. Apagar a fronteira
   * entre as duas seria dar a uma linha automática o peso de uma curada. */
  const novas = novidades.bloco();
  if (novas) {
    partes.push(
      "",
      "## Novidades desde que esta gramática foi escrita",
      "",
      "Cada linha abaixo veio do changelog oficial do n8n, com o link do PR e a versão. **Onde",
      "isto contradisser o que está acima, isto vale para a versão citada** — o texto acima foi",
      "conferido contra o pacote em uso e estas são as mudanças posteriores. Ninguém revisou estas",
      "linhas à mão: se uma delas parecer errada para o que você está construindo, siga a gramática",
      "e diga isso no `report.md`.",
      "",
      novas
    );
  }
  /* Num build de agente o `AGENTES.md` é a especificação e este é o manual de
   * forma. Dizer qual é qual evita a sessão tratar os dois como material de
   * apoio e não seguir nenhum. */
  if (ehAgente) {
    partes.splice(6, 0,
      "> Num build de agente, `AGENTES.md` diz O QUE construir (as sete camadas) e este arquivo diz",
      "> COMO escrever. Os dois valem, e nenhum dos dois é material de apoio.",
      "");
  }
  return partes.filter(p => p !== undefined && p !== null).join("\n").replace(/\n{4,}/g, "\n\n\n");
}

/* As regras curtas que vão INLINE no prompt, porque são a diferença entre um
 * documento que importa certo e um que importa quebrado. Tudo o mais fica no
 * arquivo. Manter isto curto é o ponto: um prompt que repete o arquivo inteiro
 * gasta a linha de comando e ensina a sessão a não abrir o arquivo. */
function regrasCurtas() {
  return [
    "GRAMÁTICA — leia `GRAMATICA.md` antes de escrever. Cinco regras que já valem aqui:",
    "- Parâmetro com expressão COMEÇA com `=`: `\"text\": \"=Chegou {{ $json.cliente }}\"`. Sem o `=` o",
    "  `{{ }}` é texto literal, importa sem erro e a mensagem sai com as chaves na cara do cliente.",
    "- `connections` tem três níveis: porta (`main`, `ai_*`) → ÍNDICE da saída → lista de destinos.",
    "  O que separa os ramos de um `if`/`switch` é o índice em `main`, não um nome de porta.",
    "- Parâmetro composto tem forma própria e ela está em `GRAMATICA.md`: `filter` (as condições do",
    "  `if`, onde `operator` é OBJETO `{type, operation}`), `assignmentCollection` (o `Set`),",
    "  `resourceLocator` (`{__rl:true, mode, value}`), `fixedCollection`, `resourceMapper`.",
    "- Nó que escreve fora leva `onError: \"continueRegularOutput\"`, e nó que chama rede leva",
    "  `retryOnFail: true`. Retry só em operação idempotente — ver `GRAMATICA.md`.",
    "- `[PREENCHER]` em todo parâmetro que depende do que a pessoa não confirmou. Valor plausível",
    "  importa limpo e manda para o lugar errado; o marcador falha na cara, na hora."
  ].join("\n");
}

/* ------------------------------------------------------------------- CLI */

if (require.main === module) {
  const s = docStatus();
  console.log(JSON.stringify(s, null, 2));
  if (process.argv.includes("--doc")) console.log("\n----- GRAMATICA.md -----\n" + documento({ ehAgente: process.argv.includes("--agente") }));
  process.exitCode = s.encontrado && !s.faltando.length ? 0 : 1;
}

module.exports = { DOC, ESPERADOS, lerDoc, bloco, docStatus, documento, regrasCurtas };
