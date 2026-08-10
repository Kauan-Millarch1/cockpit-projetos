/* agentes.js — o que o Tester sabe sobre agentes conversacionais.
 *
 * Um agente conversacional não é uma automação com um nó de IA no meio. Ele tem
 * sete camadas obrigatórias (buffer, triagem de mídia, lock, memória, structured
 * output, entrega em bolhas, pós-processamento), e a ausência de qualquer uma
 * produz uma falha específica e já observada nesta instância. A entrevista de
 * seis dimensões genéricas cobre três das doze decisões que um agente exige.
 *
 * O CONHECIMENTO NÃO ESTÁ AQUI — está em `tester-agentes.md`, em prosa, lido em
 * runtime. Este arquivo é só a máquina: detectar que a ideia é um agente, extrair
 * o bloco certo do doc para o prompt certo, e os portões que só valem para
 * agente. Editar o doc muda o comportamento sem tocar em código nem reiniciar o
 * servidor — é o mesmo princípio do bloco de julgamento do `flows.html`.
 *
 * FATOS APENAS, como o resto de `tester.js`: nada aqui decide se um agente é bom.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DOC = path.join(__dirname, "tester-agentes.md");

/* ------------------------------------------------------------------- o doc */

/* Lido a cada build, não uma vez no boot: o doc é a parte que o Kauan mais
 * ajusta, e exigir restart para uma frase nova seria o mesmo erro que manter
 * julgamento no servidor. O cache é só por mtime, para não reler 40KB por
 * prompt dentro da mesma corrida. */
let cache = { mtime: 0, texto: null, blocos: null };

function lerDoc() {
  let st;
  try { st = fs.statSync(DOC); } catch { return { texto: null, blocos: {} }; }
  if (cache.mtime === st.mtimeMs && cache.blocos) return cache;

  let texto = null;
  try { texto = fs.readFileSync(DOC, "utf8"); } catch { return { texto: null, blocos: {} }; }

  /* As âncoras de abertura e fechamento têm que estar SOZINHAS na linha — daí o
   * `^…$` com a flag `m`. Sem isso, a própria tabela do doc que explica o formato
   * (ela cita a âncora no meio de uma frase, entre backticks) é reconhecida como
   * um bloco de verdade: medido, apareceu um bloco fantasma chamado `nome` cujo
   * conteúdo era o pedaço de prosa entre as duas menções. Um bloco sem
   * fechamento é ignorado em vez de engolir o resto do arquivo. */
  const blocos = {};
  const re = /^[ \t]*<!--[ \t]*BLOCO:[ \t]*([a-z-]+)[ \t]*-->[ \t]*$([\s\S]*?)^[ \t]*<!--[ \t]*\/BLOCO[ \t]*-->[ \t]*$/gm;
  let m;
  while ((m = re.exec(texto))) blocos[m[1]] = m[2].trim();

  cache = { mtime: st.mtimeMs, texto, blocos };
  return cache;
}

/* Um bloco, ou string vazia. Nunca lança: doc ausente degrada para "o Tester se
 * comporta como antes desta feature", que é pior mas não quebrado — e o
 * `docStatus()` diz que faltou, em vez de deixar a ausência passar por normal. */
function bloco(nome) {
  const { blocos } = lerDoc();
  return (blocos && blocos[nome]) || "";
}

function docStatus() {
  const { texto, blocos } = lerDoc();
  const nomes = Object.keys(blocos || {});
  return {
    encontrado: !!texto,
    arquivo: "tester-agentes.md",
    chars: texto ? texto.length : 0,
    blocos: nomes,
    faltando: ESPERADOS.filter(b => !nomes.includes(b)),
    // Bloco com nome que ninguém lê é ou um erro de digitação na âncora, ou uma
    // seção que alguém escreveu esperando que fosse usada. As duas merecem ser
    // ditas em vez de silenciosamente ignoradas.
    desconhecidos: nomes.filter(b => !ESPERADOS.includes(b))
  };
}

const ESPERADOS = ["entrevista", "arquitetura", "receitas", "armadilhas"];

/* ------------------------------------------------------------- a detecção */

/* Triagem por texto. Ela NÃO decide sozinha: decide se vale gastar as perguntas
 * de agente na primeira rodada da entrevista. A decisão final é do modelo, que
 * leu a ideia inteira e devolve `tipo` no JSON — um regex não distingue "quero um
 * agente que atende lead" de "quero avisar o agente comercial no Slack", e as
 * duas frases têm as mesmas palavras.
 *
 * Conservador de propósito nos dois sentidos: falso positivo enche o fluxo de
 * camadas que ninguém pediu, falso negativo entrega um agente sem buffer. */
const FORTE = [
  /\bagentes?\b/i, /\bchat\s?bots?\b/i, /\batendentes?\b/i, /\bassistente\s+virtual\b/i,
  /\bSDR\b/, /\bvendedor\s+(virtual|autom)/i, /\bsecret[áa]ri[ao]\s+virtual\b/i
];
const CANAL = [/\bwhats?app\b/i, /\bwpp\b/i, /\bzap\b/i, /\btelegram\b/i, /\binstagram\b/i, /\bdirect\b/i, /\bwaba\b/i];
const CONVERSA = [
  /\bresponder?\b/i, /\bresponde\b/i, /\batende(r|ndo)?\b/i, /\bconversa(r|ndo)?\b/i,
  /\bfala(r|ndo)?\s+com\b/i, /\btira(r)?\s+d[úu]vida/i, /\bqualifica(r)?\b/i, /\bnegocia(r)?\b/i
];
const IA = [/\bia\b/i, /\bA\.I\b/i, /\bGPT\b/i, /\bintelig[êe]ncia\s+artificial\b/i, /\bLLM\b/i, /\bopenai\b/i, /\bclaude\b/i];

/* O que parece agente e não é: notificação, relatório, resumo. "Avisar no
 * WhatsApp quando vender" tem canal e não tem conversa. */
const NAO = [/\bavisar?\b/i, /\bnotifica(r|ção|cao)\b/i, /\bresumo\b/i, /\brelat[óo]rio\b/i, /\balerta(r)?\b/i, /\bdisparar?\b/i];

function pareceAgente(texto) {
  const t = String(texto || "");
  if (FORTE.some(re => re.test(t))) return true;
  const temCanal = CANAL.some(re => re.test(t));
  const temConversa = CONVERSA.some(re => re.test(t));
  const temIA = IA.some(re => re.test(t));
  const soNotifica = NAO.some(re => re.test(t)) && !temConversa;
  if (soNotifica) return false;
  // Canal de mensagem + verbo de conversa é o caso comum ("responder lead no
  // whatsapp"). IA + conversa cobre quem não nomeou o canal.
  return (temCanal && temConversa) || (temIA && temConversa);
}

/* A palavra final. `tipo` vem do modelo; o regex é a rede quando o campo falta
 * (modelo antigo, JSON malformado, resposta truncada). */
function decidir({ tipoDoModelo, ideia }) {
  if (tipoDoModelo === "agente") return { ehAgente: true, porque: "o modelo classificou a ideia como agente conversacional" };
  if (tipoDoModelo === "automacao") return { ehAgente: false, porque: "o modelo classificou a ideia como automação, não conversa" };
  const p = pareceAgente(ideia);
  return { ehAgente: p, porque: p ? "detectado pelo texto da ideia (o modelo não classificou)" : "nada indicou conversa" };
}

/* --------------------------------------------------------------- prompts */

/* O trecho que entra em `promptEntender`. Só as dimensões — a arquitetura não
 * interessa a quem ainda está entendendo o pedido, e mandar o doc inteiro na
 * etapa 1 é queimar contexto que deveria ir para as perguntas. */
function trechoEntrevista() {
  const b = bloco("entrevista");
  if (!b) return "";
  return [
    "",
    "════════ ESTA IDEIA É UM AGENTE CONVERSACIONAL ════════",
    "As seis dimensões acima continuam valendo, mas NÃO bastam: um agente tem doze decisões que mudam",
    "quais nós existem no fluxo. O que segue é conhecimento medido nos agentes que já rodam nesta",
    "instância. Use-o para escolher as perguntas desta rodada.",
    "",
    b,
    "",
    "════════ fim do conhecimento de agentes ════════",
    ""
  ].join("\n");
}

/* As regras de agente que vão INLINE no prompt.
 *
 * O conhecimento longo (arquitetura, receitas, armadilhas) vai por arquivo — 31KB
 * num prompt que viaja em `-p` estourou o limite de linha de comando do Windows,
 * e a sessão lê melhor do disco de qualquer forma. Mas regra não pode depender de
 * o modelo ter lido um arquivo: o que está aqui é o mínimo que precisa valer mesmo
 * que ele ignore `AGENTES.md`, e é curto de propósito. */
function regrasConstrucao() {
  return [
    "",
    "REGRAS DE UM AGENTE CONVERSACIONAL, além das que o validador já aplica.",
    "O detalhe de COMO fazer cada uma está em `AGENTES.md`; o que está aqui é o que não pode falhar:",
    "- Monte as SETE camadas. Um agente sem buffer, sem lock, sem memória ou sem structured output",
    "  está errado mesmo que o JSON seja válido — e os portões vão reprovar a maioria desses casos.",
    "- As portas `ai_languageModel`, `ai_memory`, `ai_outputParser` e `ai_tool` NÃO são `main`. O modelo,",
    "  a memória, o parser e cada tool apontam PARA o nó de agente, cada um pela sua porta.",
    /* Estes três são portões duros e caberiam em uma linha cada. Deixá-los só no
     * AGENTES.md custava uma rodada inteira quando a sessão lia o arquivo por
     * cima — e uma rodada de opus é o item mais caro desta esteira. */
    "- O nó de agente precisa de `\"hasOutputParser\": true`. Ligar o parser NÃO basta: sem essa chave o",
    "  n8n ignora o parser e a saída volta a ser texto solto. São duas coisas, faça as duas.",
    "- O schema do parser precisa do campo `messages` (array de strings): é ele que carrega as bolhas, e",
    "  é dele que a etapa de envio lê.",
    "- O `sessionKey` da memória tem que conter uma expressão com o telefone ou id de quem está falando.",
    "  Chave fixa mistura a conversa de todos os contatos numa só — funciona no teste e vaza em produção.",
    "- Escreva o `systemMessage` como ESQUELETO com as seções nomeadas, preenchendo o que a entrevista",
    "  revelou e marcando o resto com `[PREENCHER: …]`. Não invente regra de negócio, preço, prazo,",
    "  nome de produto ou política de desconto — se a entrevista não disse, é `[PREENCHER]`.",
    "- Toda tool sai como nó `toolWorkflow` com `workflowId.value` igual a `\"[PREENCHER: id do",
    "  sub-workflow]\"`, e a lista do que precisa ser construído vai no `report.md`. O Tester constrói",
    "  UM workflow por vez; a tool é outro workflow.",
    "- Nó que grava (Redis, Supabase, planilha) leva `\"onError\": \"continueRegularOutput\"`. Nó que chama",
    "  modelo ou API externa leva `\"retryOnFail\": true` e `\"maxTries\": 3`. A resposta ao lead nunca pode",
    "  morrer porque um log falhou.",
    "- Identidade do lead (telefone, e-mail, id) em parâmetro de tool vem SEMPRE de expressão n8n, nunca",
    "  de `$fromAI`. O modelo não deve ter a chance de inventar para quem está falando.",
    "- No `report.md`, diga explicitamente quais das sete camadas você montou, o que ficou como",
    "  `[PREENCHER]`, e quais sub-workflows de tool faltam."
  ].join("\n");
}

/* -------------------------------------------------------------- portões */

/* Os portões que só existem para agente. Eles são DUROS: um agente sem memória
 * responde a cada mensagem como se fosse a primeira, o que não é um fluxo pior —
 * é um fluxo que não faz o que foi pedido. Reprovar manda a falha de volta para
 * a sessão, que é exatamente o laço que o Tester já tem para o resto.
 *
 * A lista é curta de propósito. Só entra aqui o que (a) é verificável em código
 * sem ambiguidade e (b) quebra a função do agente, não o estilo dele. Tudo que é
 * qualidade e não função vira `achados` na tela, não reprovação. */

const T = {
  agent:   "@n8n/n8n-nodes-langchain.agent",
  parser:  "@n8n/n8n-nodes-langchain.outputParserStructured",
  wait:    "n8n-nodes-base.wait",
  redis:   "n8n-nodes-base.redis"
};
const MEMORIA = /langchain\.memory/i;
const MODELO  = /langchain\.(lmChat|lmOpen|googleGemini)/i;
const TOOL    = /langchain\.tool/i;

function validarAgente(wf) {
  const falhas = [];
  const F = m => falhas.push(m);
  if (!wf || !Array.isArray(wf.nodes)) return falhas;

  const nos = wf.nodes.filter(n => n && typeof n === "object");
  const tipos = nos.map(n => String(n.type || ""));
  const tem = re => tipos.some(t => (re instanceof RegExp ? re.test(t) : t === re));

  /* 1. Existe um agente. */
  const agentes = nos.filter(n => n.type === T.agent);
  if (!agentes.length) {
    F("a pessoa pediu um agente conversacional e o fluxo não tem nenhum nó `" + T.agent + "`");
    return falhas;   // sem agente, o resto dos portões não tem sujeito
  }
  if (agentes.length > 1) F(agentes.length + " nós de agente no mesmo fluxo; o V1 monta um agente só");
  const alvo = agentes[0].name;

  /* 2. O agente tem modelo. Sem isto o fluxo importa e o agente não pensa —
   *    e o n8n não reclama na importação. */
  if (!tem(MODELO)) F("o agente `" + alvo + "` não tem nó de modelo (`lmChatOpenAi` ou equivalente) ligado na porta `ai_languageModel`");

  /* 3. Memória, e chaveada por quem está falando. Chave fixa mistura a conversa
   *    de todos os leads — funciona com um lead de teste e vaza em produção. */
  const mems = nos.filter(n => MEMORIA.test(String(n.type)));
  if (!mems.length) {
    F("o agente `" + alvo + "` não tem memória; sem ela ele responde cada mensagem como se fosse a primeira");
  } else {
    for (const m of mems) {
      const k = m.parameters && m.parameters.sessionKey;
      if (typeof k === "string" && k && !/\{\{/.test(k)) {
        F("a memória `" + m.name + "` usa a chave fixa `" + k.slice(0, 40) + "`: isso mistura a conversa de todos os contatos numa só. A chave tem que conter uma expressão com o telefone ou id de quem está falando");
      }
    }
  }

  /* 4. Structured output. Sem ele o resto do fluxo lê texto solto e volta a
   *    adivinhar se era áudio, se precisa de humano, qual o status. */
  const parsers = nos.filter(n => n.type === T.parser);
  if (!parsers.length) {
    F("falta `" + T.parser + "`: sem structured output o fluxo depois do agente tem que adivinhar a decisão dele (áudio? humano? status?) interpretando texto");
  } else {
    /* `hasOutputParser` é separado de conectar o parser: sem a flag ele está
     * ligado e é ignorado, sem erro nenhum. */
    for (const a of agentes) {
      if (!(a.parameters && a.parameters.hasOutputParser === true)) {
        F("o agente `" + a.name + "` tem um parser ligado mas não declara `\"hasOutputParser\": true` — sem essa chave o n8n ignora o parser e a saída volta a ser texto solto");
      }
    }
    /* O array de bolhas é o que a camada de entrega consome. */
    const bruto = parsers.map(p => String((p.parameters && p.parameters.inputSchema) || "")).join(" ");
    if (bruto && !/"messages"/.test(bruto)) {
      F("o schema do structured output não tem o campo `messages`: é ele que carrega as bolhas da resposta, e a etapa de envio lê dele");
    }
  }

  /* 5. As portas ai_*. O erro mais fácil e o mais silencioso: ligar o modelo ao
   *    agente por `main` importa sem reclamação e o agente fica sem modelo. */
  for (const n of nos) {
    const t = String(n.type || "");
    const esperada = MODELO.test(t) ? "ai_languageModel"
                   : MEMORIA.test(t) ? "ai_memory"
                   : t === T.parser ? "ai_outputParser"
                   : TOOL.test(t) ? "ai_tool"
                   : null;
    if (!esperada) continue;
    const saidas = Object.keys((wf.connections || {})[n.name] || {});
    if (!saidas.length) { F("o nó `" + n.name + "` não está ligado a nada; ele precisa apontar para o agente pela porta `" + esperada + "`"); continue; }
    if (!saidas.includes(esperada)) {
      F("o nó `" + n.name + "` liga no agente pela porta `" + saidas.join("`, `") + "` e deveria ser `" + esperada + "` — pela porta errada o n8n importa sem erro e o agente não recebe esse componente");
    }
  }

  /* 6. Buffer. Um agente de mensageria sem agrupamento responde três vezes a
   *    uma pergunta picada em três. Verificável: existe espera antes do agente. */
  if (ehMensageria(wf)) {
    if (!tem(T.wait)) {
      F("fluxo de mensageria sem nó `wait`: sem buffer, três mensagens seguidas do contato viram três respostas, cada uma vendo um terço da pergunta. Empilhe no Redis, espere, e siga só se você for a última");
    }
    if (!tem(T.redis)) {
      F("fluxo de mensageria sem nó `redis`: o buffer e o lock de processamento precisam dele");
    }
  }

  /* 7. Persistência não pode derrubar a resposta. Isto é função, não estilo: um
   *    insert que falha depois do envio transforma uma conversa que deu certo
   *    numa execução vermelha, e o lead já recebeu. */
  const GRAVA = /\.(supabase|redis|googleSheets|airtable|mysql|postgres)$/i;
  const semGuarda = nos.filter(n => GRAVA.test(String(n.type)) && ehEscrita(n) && n.onError !== "continueRegularOutput");
  if (semGuarda.length > 2) {
    F(semGuarda.length + " nós de gravação sem `\"onError\": \"continueRegularOutput\"` (" +
      semGuarda.slice(0, 4).map(n => "`" + n.name + "`").join(", ") +
      (semGuarda.length > 4 ? ", …" : "") +
      "): uma falha ao gravar log viraria erro numa conversa que já foi respondida");
  }

  return falhas;
}

/* Escrita, não leitura: o que importa aqui é o que grava DEPOIS de responder, e
 * um `get` que falha já é tratado em outro lugar.
 *
 * A lista é do que escreve, não do que não lê. Ao contrário — presumir escrita
 * quando `operation` está ausente — um `redis` sem operação declarada (cujo
 * default é leitura) entraria na conta e o portão reclamaria de nós que só leem,
 * o que treina o leitor a ignorar a mensagem. A exceção é `supabase`, onde o
 * default REALMENTE é `create` e o editor não escreve a chave. */
const ESCREVE = /^(set|push|incr|decr|create|insert|update|upsert|append|delete|remove|rPush|lPush)/i;
function ehEscrita(n) {
  const op = String((n.parameters && n.parameters.operation) || "");
  if (!op) return /\.supabase$/i.test(String(n.type || ""));
  return ESCREVE.test(op);
}

/* Mensageria = o fluxo fala com um canal de mensagem instantânea. É o que decide
 * se buffer e lock são obrigatórios: num widget de site ou num e-mail a pessoa
 * manda uma mensagem por vez, e o buffer seria complexidade sem função. */
const CANAL_TIPO = /\.(whatsApp|telegram|evolutionApi)$/i;
function ehMensageria(wf) {
  return (wf.nodes || []).some(n => n && CANAL_TIPO.test(String(n.type || "")));
}

/* ------------------------------------------------------------- o fantasma */

/* A recusa certa. O simulador resolve expressões por código; a resposta de um
 * agente vem de um modelo, e um agente é feito exatamente dos tipos que
 * `simulate.js` recusa por princípio (`code`, `merge`, `switch`).
 *
 * Deixar a recusa genérica ("expressão fora do subconjunto") seria dizer a
 * verdade pelo motivo errado — e o motivo errado manda o Kauan procurar um
 * problema de expressão que não existe. */
function recusaFantasma(wf) {
  const tem = t => (wf.nodes || []).some(n => n && String(n.type) === t);
  if (!tem(T.agent)) return null;
  return {
    ok: false,
    recusa: "a resposta deste fluxo é escrita por um modelo de linguagem na hora, e eu não invento o que ele diria",
    detalhe: "o fantasma resolve as expressões do fluxo por código; ele não chama modelo nenhum. " +
             "Para um agente, o que dá para conferir sem executar é a FORMA do envio — por qual canal, " +
             "para quem, quantas bolhas — e não o texto.",
    classe: "agente"
  };
}

module.exports = {
  bloco, docStatus, pareceAgente, decidir,
  trechoEntrevista, regrasConstrucao,
  validarAgente, ehMensageria, recusaFantasma,
  DOC, ESPERADOS
};
