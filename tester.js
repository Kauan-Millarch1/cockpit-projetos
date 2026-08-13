/* tester.js — a máquina do Tester. PLAN.md §1, §2, §4, §7, §8, §13.
 *
 * Ideia em português vira blueprint + JSON de workflow, desenhado enquanto é
 * escrito, validado por portões determinísticos, provado numa cópia inativa e
 * simulado. FATOS APENAS: nada aqui decide se um fluxo é bom — isso é da tela.
 *
 * Três coisas que este arquivo garante e que não podem ser afrouxadas:
 *
 * 1. DUAS SESSÕES ISOLADAS. A que tem rede (pesquisa) nunca sabe o que está
 *    sendo construído e é jogada fora; a que constrói não tem rede nenhuma.
 *    Página web envenenada não alcança a sessão que escreve o workflow.
 * 2. AMBIENTE POR ALLOWLIST. Nada de `...process.env`. `ANTHROPIC_API_KEY` e os
 *    interruptores de Bedrock/Vertex ficam de fora por ausência, não por
 *    limpeza — assim ninguém esquece de zerar e o custo nunca sai do plano.
 * 3. ESCRITA CERCADA. A única escrita no n8n é criar/atualizar UM workflow cujo
 *    nome começa com `[SANDBOX tester] `, inativo e sem credenciais, e o nome
 *    atual do alvo é reconferido antes de qualquer PUT.
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const n8n = require("./n8n");
const catalog = require("./catalog");
const agentes = require("./agentes");
/* O esquema autoritativo dos nós (pacote npm, por versão) e a gramática em
 * prosa. O catálogo diz o que ESTA instância usa; o esquema diz o que o nó É. Os
 * dois entram: o catálogo é a prova de existência na conta dele, o esquema é a
 * definição — e é o único que carrega enum, obrigatoriedade e sob qual operação
 * cada chave existe. */
const esquema = require("./esquema");
const gramatica = require("./gramatica");
/* O que já deu errado AQUI. O esquema sabe o que o nó aceita e a gramática sabe
 * como se escreve; nenhum dos dois sabe o que este cockpit erra na prática — e
 * isso ele já mede três vezes por dia e jogava fora. Lição é ALEGAÇÃO com fonte,
 * nunca regra: quem promove é o Kauan, à mão. */
const licoes = require("./licoes");
const anexos = require("./anexos");
const { simulate } = require("./simulate");
// Só os verbos do patch, o diff e o índice de nós. Nada do caminho de escrita
// em fluxo de produção passa por aqui — ver "edição de projeto" mais abaixo.
const fix = require("./claude-fix");

/* ------------------------------------------------------------------ config */

const RUNS_DIR   = path.join(__dirname, ".tester-runs");
const DOCS_DIR   = path.join(__dirname, ".cache-tester-docs");
const LEDGER     = path.join(__dirname, "blueprints.json");
const SANDBOX_PREFIX = "[SANDBOX tester] ";
const DOCS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ROUNDS  = 3;                       // rodadas de correção do JSON

/* Teto por invocação. Dois valores, porque as duas construções não têm o mesmo
 * tamanho: um fluxo de notificação tem 5 nós, um agente tem 40 e o modelo lê
 * ~45KB de `AGENTES.md` antes de escrever a primeira linha.
 *
 * Medido em 2026-08-10, no primeiro build de agente de ponta a ponta: a rodada 1
 * levou mais de 369s com 6 minutos de teto, foi morta no meio da escrita, e a
 * rodada 2 recomeçou do zero — mesma leitura, mesmo custo, mesmo destino. Sem
 * este par, um agente nunca termina: ele gasta as três rodadas sendo morto no
 * mesmo ponto. */
const ROUND_TIMEOUT_MS = 6 * 60 * 1000;
const ROUND_TIMEOUT_AGENTE_MS = 14 * 60 * 1000;
const TETO_USD = Number(readEnv("COCKPIT_TESTER_TETO_USD") || 8);
const SANDBOX_ON = (readEnv("COCKPIT_TESTER_SANDBOX") || "1") !== "0";
const MODELO_CONVERSA = readEnv("COCKPIT_TESTER_MODELO_CONVERSA") || "sonnet";
const MODELO_BUILD    = readEnv("COCKPIT_TESTER_MODELO_BUILD")    || "opus";

const ETAPAS = [
  { n: 1, nome: "Entender",      para: true  },
  { n: 2, nome: "Pesquisar",     para: false },
  { n: 3, nome: "Ingredientes",  para: false },
  { n: 4, nome: "Desenhar",      para: false },
  { n: 5, nome: "Validar",       para: false },
  { n: 6, nome: "Fantasma",      para: true  },
  { n: 7, nome: "Entregar",      para: false }
];

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [".env", ".env.local"]) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(new RegExp("^\\s*" + name + "\\s*=\\s*(.*)$", "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function findClaude() {
  const explicit = readEnv("CLAUDE_BIN");
  const cands = [
    explicit,
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "claude", "claude.exe")
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* segue */ } }
  return process.platform === "win32" ? "claude.exe" : "claude";
}
const CLAUDE_BIN = findClaude();

/* Allowlist. A ausência de ANTHROPIC_API_KEY aqui é a garantia de que o custo
 * fica no plano — uma variável que não existe não precisa ser lembrada. */
const ENV_ALLOW = [
  "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME",
  "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE", "LANG", "LC_ALL"
];
function envLimpo() {
  const out = {};
  for (const k of ENV_ALLOW) if (process.env[k] != null) out[k] = process.env[k];
  out.CLAUDE_CODE_ENTRYPOINT = "cockpit-tester";
  return out;
}

/* --------------------------------------------------------------- utilidades */

/* Todo caminho de arquivo sai daqui. Nome de serviço vem de um modelo que
 * acabou de ler uma página web; ele nunca toca o filesystem cru. */
function slugify(s) {
  const base = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "servico";
  const h = crypto.createHash("sha1").update(String(s || "")).digest("hex").slice(0, 6);
  return base + "-" + h;
}
function dentro(dir, p) {
  const r = path.resolve(dir, p);
  if (r !== path.resolve(dir) && !r.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error("caminho fora do diretório permitido");
  }
  return r;
}

const SECRET_RE = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g, /\bAIza[A-Za-z0-9_-]{20,}/g
];
function scrub(s) {
  let t = String(s == null ? "" : s);
  for (const re of SECRET_RE) t = t.replace(re, "«removido»");
  return t;
}

/* Bloco ```json do texto do modelo. Pegamos o ÚLTIMO: se ele corrigiu o próprio
 * JSON no meio da resposta, o último é o que vale. */
function jsonDoTexto(txt) {
  const blocos = [...String(txt || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  const cands = blocos.length ? blocos.reverse() : [String(txt || "")];
  for (const c of cands) {
    try { return JSON.parse(c.trim()); } catch { /* tenta o próximo */ }
  }
  return null;
}

/* --------------------------------------------------------------- as sessões */

const sessions = new Map();
const listeners = new Map();

function emit(s, tipo, dados) {
  s.versao = (s.versao || 0) + 1;
  const set = listeners.get(s.id);
  if (!set) return;
  for (const fn of set) { try { fn(tipo, dados); } catch { /* cliente sumiu */ } }
}
function diz(s, texto, nivel) {
  const linha = { at: new Date().toISOString(), texto: scrub(texto).slice(0, 400), nivel: nivel || "info" };
  s.log.push(linha);
  if (s.log.length > 400) s.log.shift();
  emit(s, "log", linha);
}
/* O que a faixa de atividade mostra.
 *
 * Antes ela recebia a última linha crua do modelo e o nome cru da ferramenta, o
 * que produziu duas telas ruins de verdade: uma faixa escrita ``` (o modelo
 * tinha acabado de abrir um bloco de código) e outra escrita
 * `Write C:\...\.tester-runs\t10ee20e87f86` — caminho absoluto da máquina, que
 * não diz nada para quem está olhando e ainda vaza estrutura interna. */
const FERRAMENTA_PT = {
  Write: "escrevendo", Edit: "ajustando", Read: "lendo", Glob: "procurando arquivo",
  Grep: "procurando", WebSearch: "pesquisando na web", WebFetch: "lendo a página"
};
const so = t => String(t || "").replace(/\s+/g, " ").trim();

function atividadeFerramenta(nome, alvo) {
  const verbo = FERRAMENTA_PT[nome] || nome.toLowerCase();
  const a = so(alvo);
  if (!a) return verbo;
  // Caminho absoluto vira só o nome do arquivo; URL vira só o domínio.
  if (/^https?:\/\//i.test(a)) { try { return verbo + " " + new URL(a).hostname; } catch { return verbo; } }
  if (/[\\/]/.test(a)) return verbo + " " + a.split(/[\\/]/).filter(Boolean).pop();
  return verbo + " " + a.slice(0, 60);
}

/* Frase do modelo só vira atividade se for uma frase. Cerca de código, linha de
 * pontuação, marcador solto e trecho curto demais são ruído. */
function fraseUtil(txt) {
  const t = so(txt);
  if (t.length < 12) return null;
  if (/^[`~#>*\-_=\[\]{}()|.,:;!?\s]+$/.test(t)) return null;
  if (/^```/.test(t)) return null;
  return t;
}

function atividade(s, rotulo) {
  const t = so(rotulo);
  if (!t) return;
  s.atividade = scrub(t).slice(0, 160);
  emit(s, "atividade", { atividade: s.atividade });
}

function etapa(s, n, estado, nota) {
  s.etapa = n;
  s.etapaEstado = estado;
  const e = s.etapas.find(x => x.n === n);
  if (e) { e.estado = estado; if (nota !== undefined) e.nota = nota; }
  emit(s, "etapa", { etapa: n, estado, nota });
}

function snapshot(s) {
  return {
    id: s.id, gen: s.gen, versao: s.versao || 0,
    // `modo` é o que separa a esteira de sete etapas da conversa sobre um fluxo
    // já pronto. A tela lê ele antes de decidir o que desenhar.
    modo: s.modo || "construcao",
    proposta: s.proposta || null, gatesProposta: s.gatesProposta || null,
    ideia: s.ideia, nivel: s.nivel,
    status: s.status, etapa: s.etapa, etapas: s.etapas, atividade: s.atividade || null,
    chat: s.chat, entendi: s.entendi, titulo: s.titulo || null, perguntas: s.perguntas,
    ehAgente: s.ehAgente === undefined ? null : s.ehAgente, ehAgentePorque: s.ehAgentePorque || null,
    respostas: s.respostas || [], rodadaEntrevista: s.rodadaEntrevista || 1, achados: s.achados,
    doc: s.doc ? { slug: s.doc.slug, servico: s.doc.servico, fontes: s.doc.fontes, texto: s.doc.texto } : null,
    pesquisaPulada: s.pesquisaPulada || null,
    ingredientes: s.ingredientes,
    /* O que ela anexou. Só os metadados — nome, tipo, tamanho, caminho relativo:
     * o conteúdo do arquivo nunca entra no snapshot, que viaja a cada evento do
     * SSE. Um print de 3MB em base64 aqui multiplicaria o tráfego por evento e
     * não serviria para nada na tela, que só precisa desenhar o chip. */
    anexos: (s.anexos || []).map(a => ({
      nome: a.nome, arquivo: a.arquivo, tipo: a.tipo, bytes: a.bytes,
      dePasta: !!a.dePasta, raiz: a.raiz || null, segredosRemovidos: a.segredosRemovidos || 0
    })),
    anexosResumo: anexos.resumo(s.anexos || []),
    anexosLidos: s.anexosLidos || [],
    wf: s.wf, wfParcial: s.wf ? null : (s.wfParcial || null), provenance: s.provenance,
    /* Só o relatório, nunca uma segunda cópia do fluxo: num agente de 65 nós o
     * documento tem ~66KB e o snapshot viaja a cada evento. A tela compõe o
     * export a partir daqui. */
    credLigacao: s.credLigacao || null, escolhasCred: s.escolhasCred || [],
    gates: s.gates, sandbox: s.sandbox,
    sementes: s.sementes, sementesOrigem: s.sementesOrigem || null, fantasma: s.fantasma,
    custo: s.custo, custoTotal: +(s.custo.reduce((a, c) => a + (c.usd || 0), 0)).toFixed(4),
    projetoSlug: s.projetoSlug || null, projetoTitulo: s.projetoTitulo || null,
    erro: s.erro || null, log: s.log
  };
}

/* --------------------------------------------------------- spawn das sessões */

/* Uma invocação do CLI. `ferramentas` e `cwd` são a cerca — não são detalhe de
 * conveniência. A sessão de pesquisa recebe rede e um diretório vazio; a de
 * construção recebe o diretório da corrida e nenhuma rede. */
/* `--allowedTools` NÃO restringe: é lista de auto-aprovação. Medido em
 * 2026-08-07 — uma sessão com `--allowedTools "Read,Write,Edit,Glob,Grep"`
 * executou shell e imprimiu o que mandamos. Quem nega é `--disallowedTools`,
 * verificado logo depois no mesmo prompt: respondeu `SEM_SHELL`.
 *
 * Isto é a cerca de verdade das duas sessões. A de pesquisa tem rede e por isso
 * NÃO pode ter shell; a de construção não pode ter nem um nem outro. Sem esta
 * linha, "sessão sem rede" e "sessão sem Bash" eram afirmações falsas — inclusive
 * a que o CLAUDE.md já fazia sobre o claude-fix.js. */
const NEGADAS_SEMPRE = "Bash,PowerShell,BashOutput,KillShell,Task,Agent,NotebookEdit,SlashCommand";
const NEGADAS_SEM_REDE = NEGADAS_SEMPRE + ",WebFetch,WebSearch";

/* O limite de linha de comando do Windows: 32767 caracteres para todo o comando.
 * O prompt viaja em `-p`, então um prompt grande não falha com "prompt grande" —
 * falha com `spawn ENAMETOOLONG`, que não diz nada a ninguém e manda quem lê
 * procurar um problema de caminho de arquivo. Medido de verdade: o conhecimento de
 * agentes inline levou o prompt a 49KB e a esteira morreu na etapa 04 com essa
 * mensagem. A margem cobre o binário, as flags e o resto dos argumentos. */
const PROMPT_MAX = 30000;

/* A entrada de custo de UMA rodada, e por que é função em vez de `if` inline:
 * é a regra que decide se um gasto entra no ledger como medido ou como cego, e
 * ela precisa ser testável sem spawnar um CLI de verdade.
 *
 * `usd` vem do evento `result`, que é a ÚLTIMA linha que o CLI emite. Um processo
 * morto no meio nunca chega lá, então `usd` fica 0 — e registrar 0 seria afirmar
 * que a rodada foi de graça, quando ela pode ter sido a mais cara da corrida. O
 * teto de custo também passaria a não ver esse gasto. `usdDesconhecido` é a forma
 * honesta: a linha aparece na tela como "custo não medido" em vez de zero, e o
 * teto sabe que está cego.
 *
 * Cancelar entra pela mesma porta do teto de tempo, e tem que entrar: para o CLI
 * as duas são a mesma morte. O discriminador é `!usd` — se o `result` chegou
 * antes da morte, o número é real e vale mais que a suspeita. */
function custoDaRodada({ rotulo, usd, ms, comRede, morto, cancelada }) {
  const entrada = { sessao: rotulo, usd, ms, comRede: !!comRede };
  if ((morto || cancelada) && !usd) {
    entrada.usdDesconhecido = true;
    entrada.motivo = morto
      ? "a sessão foi interrompida antes de reportar o custo"
      : "você cancelou antes de a sessão reportar o custo";
  }
  return entrada;
}

function rodar(s, { rotulo, prompt, ferramentas, cwd, modelo, comRede, aoUsarFerramenta, tetoMs }) {
  return new Promise(resolve => {
    if (String(prompt).length > PROMPT_MAX) {
      const msg = "o prompt da etapa `" + rotulo + "` ficou com " + String(prompt).length +
        " caracteres e o limite aqui é " + PROMPT_MAX +
        " (a linha de comando do Windows não aceita mais). Material grande tem que ir para arquivo no diretório da sessão, como `AGENTES.md` e `catalogo.json`, não para dentro do prompt";
      diz(s, msg, "erro");
      resolve({ erro: msg, texto: "", usd: 0, ms: 0 });
      return;
    }
    const args = [
      "-p", prompt,
      "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
      "--allowedTools", ferramentas,
      "--disallowedTools", comRede ? NEGADAS_SEMPRE : NEGADAS_SEM_REDE,
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      // Medido em iso-check.js: sem isto a sessão carrega o CLAUDE.md global,
      // que tem a chave do n8n em texto puro. Numa sessão COM REDE isso seria
      // uma credencial ao lado de uma ferramenta de saída.
      "--setting-sources", "",
      "--model", modelo
    ];

    const t0 = Date.now();
    const child = spawn(CLAUDE_BIN, args, {
      cwd, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],   // stdin fechado: senão o CLI espera 3s e avisa
      env: envLimpo()
    });
    s.filho = child;

    let buf = "", texto = "", usd = 0, erro = null, morto = false;
    const limite = tetoMs || ROUND_TIMEOUT_MS;
    const timer = setTimeout(() => {
      morto = true;
      erro = "tempo esgotado nesta etapa (" + Math.round(limite / 60000) + " min)";
      try { child.kill(); } catch { /* já morreu */ }
    }, limite);

    child.stdout.on("data", chunk => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch { continue; }

        if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === "text" && c.text) {
              texto += c.text;
              const frase = fraseUtil(c.text.split(/\n+/).filter(Boolean).pop());
              if (frase) atividade(s, frase.slice(0, 140));
            } else if (c.type === "tool_use") {
              const alvo = (c.input && (c.input.file_path || c.input.query || c.input.url || c.input.pattern)) || "";
              const humano = atividadeFerramenta(c.name, alvo);
              atividade(s, humano);
              diz(s, "· " + humano);
              // Quem chamou pode espiar a ferramenta (é assim que o desenho
              // aparece ao vivo). Erro do espião nunca derruba a sessão.
              if (aoUsarFerramenta) { try { aoUsarFerramenta(c); } catch { /* segue */ } }
            }
          }
        } else if (ev.type === "result") {
          if (typeof ev.total_cost_usd === "number") usd = ev.total_cost_usd;
          if (ev.is_error) erro = erro || "a sessão terminou com erro";
          if (typeof ev.result === "string" && !texto) texto = ev.result;
        }
      }
    });
    child.stderr.on("data", d => { const t = d.toString("utf8").trim(); if (t) diz(s, "stderr: " + t.slice(0, 200), "warn"); });
    child.on("error", e => { clearTimeout(timer); resolve({ erro: String(e && e.message || e), texto, usd, ms: Date.now() - t0 }); });
    child.on("close", code => {
      clearTimeout(timer);
      s.filho = null;
      const ms = Date.now() - t0;
      /* `usd` vem do evento `result`, que é a ÚLTIMA linha que o CLI emite. Um
       * processo morto no meio nunca chega lá, então `usd` fica 0 — e registrar 0
       * seria afirmar que a rodada foi de graça, quando ela pode ter sido a mais
       * cara da corrida. O teto de custo também passaria a não ver esse gasto.
       * `usdDesconhecido` é a forma honesta: a linha aparece na tela como "custo
       * não medido" em vez de zero, e o teto sabe que está cego. */
      const entrada = custoDaRodada({
        rotulo, usd, ms, comRede, morto, cancelada: s.status === "cancelada"
      });
      s.custo.push(entrada);
      emit(s, "custo", { custo: s.custo });
      resolve({ erro: erro || (code === 0 ? null : "a sessão saiu com código " + code), texto, usd, ms });
    });
  });
}

/* Uma sessão SEM conversa: nenhuma `s`, nenhum SSE, nenhum ledger de custo.
 *
 * Existe para o job diário do `novidades.js`, que roda sem ninguém olhando. E
 * existe AQUI, e não lá, por um motivo só: a cerca desta sessão são os flags do
 * `rodar()` acima — `--disallowedTools`, `--setting-sources ""`, `envLimpo()`.
 * Este repositório já mediu que `--allowedTools` NÃO restringe nada (uma sessão
 * com ele executou shell), e que sem `--setting-sources ""` a sessão carrega o
 * `CLAUDE.md` global, que nesta máquina tem a chave do n8n em texto puro. Uma
 * segunda cópia desses flags noutro arquivo divergiria da primeira na primeira
 * correção feita só de um lado, e o lado que divergisse seria uma sessão sem
 * cerca. Então há uma cópia, e é esta.
 *
 * Devolve o texto e o custo; quem chamou decide o que fazer com os dois. */
function rodarAvulso({ prompt, ferramentas, cwd, modelo, comRede = false, tetoMs = ROUND_TIMEOUT_MS, aoDizer }) {
  return new Promise(resolve => {
    if (String(prompt).length > PROMPT_MAX) {
      resolve({ erro: "prompt com " + String(prompt).length + " caracteres, acima do teto de " + PROMPT_MAX, texto: "", usd: 0, ms: 0 });
      return;
    }
    const args = [
      "-p", prompt,
      "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
      "--allowedTools", ferramentas,
      "--disallowedTools", comRede ? NEGADAS_SEMPRE : NEGADAS_SEM_REDE,
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "",
      "--model", modelo || MODELO_CONVERSA
    ];
    const t0 = Date.now();
    const child = spawn(CLAUDE_BIN, args, {
      cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: envLimpo()
    });
    let buf = "", texto = "", usd = 0, erro = null;
    const timer = setTimeout(() => {
      erro = "tempo esgotado (" + Math.round(tetoMs / 60000) + " min)";
      try { child.kill(); } catch { /* já morreu */ }
    }, tetoMs);

    child.stdout.on("data", chunk => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch { continue; }
        if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === "text" && c.text) texto += c.text;
            else if (c.type === "tool_use" && aoDizer) {
              const alvo = (c.input && (c.input.file_path || c.input.pattern || c.input.url)) || "";
              try { aoDizer("· " + c.name + (alvo ? " " + String(alvo).slice(0, 80) : "")); } catch { /* segue */ }
            }
          }
        } else if (ev.type === "result") {
          if (typeof ev.total_cost_usd === "number") usd = ev.total_cost_usd;
          if (ev.is_error) erro = erro || "a sessão terminou com erro";
          if (typeof ev.result === "string" && !texto) texto = ev.result;
        }
      }
    });
    child.stderr.on("data", d => { const t = d.toString("utf8").trim(); if (t && aoDizer) aoDizer("stderr: " + t.slice(0, 200)); });
    child.on("error", e => { clearTimeout(timer); resolve({ erro: String(e && e.message || e), texto, usd, ms: Date.now() - t0 }); });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({
        erro: erro || (code === 0 ? null : "a sessão saiu com código " + code),
        texto, usd, ms: Date.now() - t0,
        // Mesma honestidade do `custoDaRodada`: morta no meio, o `result` nunca
        // chegou, e 0 não é o mesmo que de graça.
        usdDesconhecido: !usd && !!erro
      });
    });
  });
}

/* ------------------------------------------------------------------ prompts */

const REGISTRO = {
  "nunca mexi": "A pessoa nunca usou n8n. Explique em português simples, sem jargão. Nunca escreva nome de tipo de nó nem nome de campo técnico no texto que ela lê.",
  "sei o básico": "A pessoa já montou fluxo em n8n mas não conhece a API deste serviço. Pode citar nome de nó; explique o que for específico do serviço.",
  "sou técnico": "A pessoa é técnica. Seja direto e denso: nomes de nó, endpoints, campos. Nada de explicação básica."
};

/* A entrevista tem rodadas: o modelo pergunta, a pessoa responde nos cartões, e
 * a rodada seguinte digere as respostas e pergunta o que ainda faltar — até o
 * modelo devolver `perguntas: []`, que é o que libera a construção. O teto
 * existe porque uma entrevista sem fim é pior que uma suposição declarada. */
const MAX_ENTREVISTAS = 4;
const PERGUNTAS_POR_RODADA = 5;

/* As duas partes do prompt de entrevista que crescem sem teto: as respostas
 * acumuladas (até 24, ~500 chars cada) e os textos livres do chat (2000 cada).
 * Medido: no pior caso o prompt de um agente chegava a 36637 caracteres — acima
 * do `PROMPT_MAX` e acima do limite real do Windows.
 *
 * Aqui elas ganham orçamento, e o corte é pelas MAIS ANTIGAS: uma resposta recente
 * é a decisão que está valendo, uma antiga costuma já estar refletida em
 * `entendi`. Quando corta, o prompt DIZ que cortou — um modelo que não sabe que
 * perdeu contexto repete pergunta já respondida, que é exatamente o que a
 * entrevista existe para não fazer. */
function ultimosAteCaber(itens, teto, formatar) {
  const out = [];
  let usado = 0, cortados = 0;
  for (let i = itens.length - 1; i >= 0; i--) {
    const linha = formatar(itens[i]);
    if (usado + linha.length > teto && out.length) { cortados = i + 1; break; }
    out.unshift(linha);
    usado += linha.length;
  }
  return { linhas: out, cortados };
}

const ORC_RESPOSTAS = 7000;
const ORC_CHAT = 3000;

function promptEntender(s) {
  const tipos = Object.keys(s.catalogo.nodes).slice(0, 40).join(", ");
  const creds = Object.keys(s.catalogo.credenciaisPorTipo).join(", ");
  const ultimaRodada = (s.rodadaEntrevista || 1) >= MAX_ENTREVISTAS;

  const r = ultimosAteCaber(s.respostas || [], ORC_RESPOSTAS, x => "- " + x.q + "\n  -> " + x.r);
  const respondidas = r.linhas.length
    ? ["", "Ela JÁ respondeu a estas perguntas — não repita nenhuma, e trate cada resposta como decisão dela:",
       ...r.linhas,
       r.cortados ? "(mais " + r.cortados + " resposta(s) anterior(es) que não couberam aqui — elas já estão refletidas no resumo acima; não pergunte de novo o que o resumo já afirma)" : ""].filter(Boolean).join("\n")
    : "";
  return [
    "Você conduz a entrevista que transforma uma ideia em um fluxo de automação no n8n. Esta é a etapa de ENTENDER.",
    "NÃO monte o fluxo agora. NÃO escreva JSON de workflow.",
    "",
    REGISTRO[s.nivel] || REGISTRO["sei o básico"],
    "",
    "A instância de n8n desta pessoa já usa estes tipos de nó: " + tipos,
    "E já tem credenciais destes tipos referenciadas nos fluxos dela: " + creds,
    "Serviço que NÃO estiver nessa lista provavelmente não tem nó dedicado e vira HTTP Request + credencial própria.",
    "",
    "A ideia dela:",
    "«" + s.ideia + "»",
    (() => {
      const livres = s.chat.filter(m => m.quem === "voce" && !m.escolhas).slice(1);
      const c = ultimosAteCaber(livres, ORC_CHAT, m => "Depois ela disse: «" + m.texto + "»");
      return c.linhas.concat(c.cortados ? ["(e " + c.cortados + " mensagem(ns) anterior(es), mais antigas, omitidas)"] : []).join("\n");
    })(),
    respondidas,
    /* O material que ela anexou. Vem depois das respostas e antes do formato de
     * saída de propósito: é contexto para as perguntas, não instrução de como
     * responder. O conteúdo dos arquivos não entra aqui — só o caminho e a ordem
     * de ler, que é a lição do `escreverContexto`. */
    anexos.trechoPrompt(s.anexos),
    "",
    "Responda SÓ com um bloco ```json com esta forma exata:",
    "{",
    '  "tipo": "agente" | "automacao",',
    '  "entendi": { "quando": "...", "oQueFaz": "...", "resultado": "...", "ondeChega": "..." },',
    '  "titulo": "Aviso de venda no Slack",',
    '  "servicos": ["mercado livre", "slack"],',
    '  "perguntas": [ { "q": "...", "porque": "...", "opcoes": ["...", "..."],',
    '                   "previa": "slack|whatsapp|email|texto", "modelos": { "<opção exata>": "texto pronto" } } ],',
    '  "achados": [ { "tipo": "risco|falta|ideia", "texto": "...", "fonte": "fato|a-confirmar|sugestao" } ]',
    "}",
    "",
    'O CAMPO `tipo`. Responda "agente" quando as TRÊS coisas valerem: (a) a pessoa do outro lado escreve',
    "livremente, sem menu nem botão; (b) a resposta é escrita por um modelo, não escolhida numa árvore de",
    "decisão; (c) a conversa tem estado, ou seja a quinta mensagem depende das quatro anteriores. Faltando",
    'qualquer uma, é "automacao". Um fluxo que responde sempre a mesma coisa a qualquer texto é automacao.',
    'Avisar, notificar, resumir e relatar são automacao mesmo quando o destino é o WhatsApp.',
    "",
    "A ENTREVISTA. Um fluxo só sai funcional se estas seis dimensões estiverem respondidas ou tiverem padrão óbvio:",
    "1. GATILHO — o que dispara o fluxo (horário? webhook? evento?) e com que frequência.",
    "2. ORIGEM — de onde vêm os dados: qual conta, qual loja, qual tabela, e qual recorte (só novos? últimas 24h?).",
    "3. FILTRO — alguma condição antes de agir (status, valor mínimo, tipo de item)?",
    "4. CONTEÚDO — o que a mensagem ou o registro precisa conter, campo a campo. Peça um exemplo se ajudar.",
    "5. DESTINO — exatamente onde chega: qual canal, qual número, qual tabela, qual planilha.",
    "6. VAZIO/ERRO — o que fazer quando não houver dado novo ou a chamada falhar: avisar mesmo assim, ou silêncio?",
    "",
    /* DESTINO é a única dimensão sem padrão possível — canal, número, tabela e
     * planilha não se adivinham. Medido: o modelo perguntava CONTEÚDO primeiro e
     * `ondeChega` atravessava a entrevista inteira em aberto, até a construção
     * começar com o destino ainda por definir. */
    "A dimensão 5 (DESTINO) não tem padrão possível: canal do Slack, número de WhatsApp, tabela e planilha",
    "não se adivinham. Enquanto `entendi.ondeChega` estiver em aberto ela é a PRIMEIRA pergunta da rodada,",
    "e você não pode devolver \"perguntas\": [] por causa dela — exceto na última rodada, quando ela vira suposição declarada.",
    "",
    "Regras que importam:",
    "- Campo de `entendi` que a pessoa não disse e que você AINDA vai perguntar: escreva exatamente \"não disse\". Nunca preencha com um palpite plausível.",
    "- Campo que você NÃO vai mais perguntar e vai assumir: escreva \"suposição: <o que você vai assumir>\". A tela mostra isso etiquetado como suposição, e não como algo que a pessoa disse.",
    ultimaRodada
      ? "- Esta é a ÚLTIMA rodada da entrevista: NÃO faça novas perguntas — devolva \"perguntas\": []. Para o que ficou aberto, assuma o padrão mais comum e registre CADA suposição em `achados` como \"a-confirmar\"."
      : "- Pergunte TUDO das dimensões acima que ainda estiver aberto e mudar o fluxo de verdade — até " + PERGUNTAS_POR_RODADA + " perguntas nesta rodada, as mais importantes primeiro. Haverá outra rodada se sobrar algo. Não pergunte o que já foi respondido nem o que tem um padrão óbvio.",
    "- A entrevista tem que CONVERGIR: cada rodada com menos perguntas que a anterior. Pergunta só o que muda NÓS ou CONEXÕES do fluxo — o que for parâmetro fino que a pessoa ajusta depois no editor do n8n vira suposição registrada em `achados`, não pergunta.",
    "- Quando NADA mais faltar, devolva \"perguntas\": [] — é isso que libera a construção.",
    "- `opcoes` são respostas prontas para clicar: curtas, concretas, no máximo 4. Sempre ofereça opções.",
    /* Escolher entre "remetente e assunto" e "remetente, assunto e trecho do
     * corpo" é escolher entre duas descrições. Com `modelos` a pessoa escolhe
     * vendo a mensagem montada, que é a coisa que ela realmente vai receber. */
    "- Pergunta sobre o CONTEÚDO de uma mensagem (dimensão 4) tem que vir com `previa` e `modelos`:",
    "  `previa` é a superfície onde a mensagem chega — \"slack\", \"whatsapp\", \"email\" ou \"texto\";",
    "  `modelos` é um mapa da OPÇÃO EXATA (a mesma string que está em `opcoes`) para o texto que aquela",
    "  opção produziria, já montado, com os campos dinâmicos escritos como {{ nome_do_campo }}.",
    "  Máximo 6 linhas e 400 caracteres por modelo. Escreva no formato do destino (no Slack, *negrito* com asterisco).",
    "  Nas outras perguntas NÃO mande `previa` nem `modelos`.",
    "- `titulo` é um nome curto e humano para o fluxo (máx 60 caracteres), em português normal — nunca snake_case.",
    "- `servicos` são os serviços externos envolvidos, em minúsculas, nome comum.",
    "- `achados` com fonte \"fato\" só para o que dá para afirmar da lista acima. O resto é \"a-confirmar\" ou \"sugestao\".",
    "- Tudo em português do Brasil.",
    /* O conhecimento de agente entra na etapa 1 quando a ideia parece um agente
     * — e a triagem por texto erra para os dois lados, então ela decide apenas
     * se vale gastar contexto com as doze dimensões. Quem decide de verdade é o
     * campo `tipo` acima, que o modelo preenche tendo lido a ideia inteira. Numa
     * rodada seguinte a decisão já está tomada e vale ela, não o regex. */
    (s.ehAgente === true || (s.ehAgente === undefined && agentes.pareceAgente(s.ideia)))
      ? agentes.trechoEntrevista()
      : ""
  ].filter(Boolean).join("\n");
}

function promptPesquisa(servico) {
  return [
    "Pesquise a API pública de: " + servico,
    "",
    "Use WebSearch e WebFetch. Depois escreva UM arquivo chamado `doc.md` no diretório atual com:",
    "- o endpoint (ou endpoints) que serve para listar/consultar os dados principais",
    "- o método HTTP e os parâmetros de consulta que importam",
    "- como funciona a autenticação (tipo, se o token expira, se tem refresh)",
    "- os nomes EXATOS dos campos da resposta que interessam",
    "- limite de chamadas, se houver",
    "- uma lista `Fontes:` com as URLs que você leu, uma por linha",
    "",
    "Escreva em português. Seja curto: é uma ficha técnica, não um tutorial.",
    "Se não encontrar documentação oficial, escreva isso no arquivo em vez de deduzir.",
    "Não escreva nenhum outro arquivo."
  ].join("\n");
}

/* O que a sessão de construção LÊ do disco, em vez de receber no prompt.
 *
 * Medido: com o conhecimento de agentes inline, o prompt passou de 49KB e o spawn
 * morreu com `ENAMETOOLONG` — o limite de linha de comando do Windows é 32767
 * caracteres, e o prompt viaja em `-p`. Era uma bomba armada de qualquer forma: a
 * fatia do catálogo sozinha já chegava a 16KB num fluxo com vários serviços.
 *
 * A saída é a mesma que o `claude-fix.js` usa: o material grande vira arquivo no
 * diretório da corrida e o prompt diz o que ler. Sai melhor que o inline por três
 * razões, não só por caber — a sessão lê o bloco de que precisa em vez de carregar
 * tudo, pode `Grep` o catálogo por um tipo específico, e o que ela leu aparece no
 * log de atividade, então dá para ver se ela consultou a receita ou improvisou. */
async function escreverContexto(s, silencioso) {
  const escritos = [];

  const fatia = catalog.fatiaTexto(s.catalogo, s.ingredientes.nos.map(n => n.tipo), 60000);
  await fsp.writeFile(dentro(s.dir, "catalogo.json"), JSON.stringify(
    { instancia: s.catalogo.instancia, geradoEm: s.catalogo.geradoEm, nodes: JSON.parse(fatia.texto) }, null, 2), "utf8");
  escritos.push({ arquivo: "catalogo.json", o_que: "os tipos de nó desta instância, com as versões e a forma dos parâmetros", omitidos: fatia.omitidos });

  /* O esquema, só dos tipos em jogo e só na versão que a instância roda.
   *
   * Mandar as cinco versões de um `if` é ensinar quatro formas erradas — a que
   * vale é uma. A versão pedida sai do catálogo (`versaoMaisUsada`), que é o que
   * esta conta de fato executa; sem ela, a mais alta do esquema. */
  if (s.esquema) {
    const pares = s.ingredientes.nos.map(n => {
      const c = s.catalogo.nodes[n.tipo];
      return { tipo: n.tipo, versao: n.versao || (c && c.versaoMaisUsada) || null };
    });
    const fe = esquema.fatiaPorVersao(s.esquema, pares, 90000);
    await fsp.writeFile(dentro(s.dir, "esquema.json"), fe.texto, "utf8");
    escritos.push({
      arquivo: "esquema.json",
      o_que: "a DEFINIÇÃO de cada nó, na versão em uso: toda propriedade, o enum de cada discriminador, o que é obrigatório, sob qual operação cada chave existe, e o que o nó devolve",
      omitidos: fe.omitidos
    });
  }

  /* A gramática. Vale sempre — inclusive quando o esquema não pôde ser lido,
   * porque ela é justamente a parte que descriptor nenhum carrega. */
  const gram = gramatica.documento({ ehAgente: !!s.ehAgente });
  if (gram && gram.length > 200) {
    await fsp.writeFile(dentro(s.dir, "GRAMATICA.md"), gram, "utf8");
    escritos.push({ arquivo: "GRAMATICA.md", o_que: "como se escreve um fluxo: o prefixo `=`, as três camadas de `connections`, a forma dos parâmetros compostos, erro e retry, e as armadilhas medidas", chars: gram.length });
  }

  /* As lições, e só as que valem para os tipos em jogo.
   *
   * `null` quando não há nenhuma, de propósito: escrever um `LICOES.md` que só
   * diz "nada aqui" gasta uma leitura da sessão e ensina que o arquivo não vale
   * a pena abrir. Um build num cockpit recém-clonado não tem lição nenhuma, e é
   * o estado normal — não uma falta. */
  try {
    const lic = licoes.documento(s.ingredientes.nos.map(n => n.tipo));
    if (lic) {
      await fsp.writeFile(dentro(s.dir, "LICOES.md"), lic, "utf8");
      escritos.push({ arquivo: "LICOES.md", o_que: "o que JÁ DEU ERRADO nestas construções — avisos medidos, não regras; onde o esquema e a gramática discordarem deles, eles perdem", chars: lic.length });
    }
  } catch (e) {
    /* Uma lição ilegível não pode derrubar um build. O resto do contexto vale
     * sozinho, e a ausência aparece no log em vez de virar silêncio. */
    if (!silencioso) diz(s, "não consegui montar o LICOES.md: " + String(e && e.message), "warn");
  }

  if (s.ehAgente) {
    const partes = [
      "# Como se constrói um agente conversacional nesta instância",
      "",
      "Isto não é sugestão: é o padrão medido nos agentes que rodam nesta conta. Leia tudo antes de",
      "escrever o `workflow.json`. As sete camadas são obrigatórias, e a ausência de cada uma produz uma",
      "falha nomeada aqui dentro.",
      "",
      agentes.bloco("arquitetura"),
      "",
      agentes.bloco("receitas"),
      "",
      agentes.bloco("armadilhas")
    ].filter(Boolean).join("\n");
    await fsp.writeFile(dentro(s.dir, "AGENTES.md"), partes, "utf8");
    escritos.push({ arquivo: "AGENTES.md", o_que: "as sete camadas, as receitas de nó com typeVersion, e as armadilhas medidas", chars: partes.length });
  }

  if (s.doc && s.doc.texto) {
    await fsp.writeFile(dentro(s.dir, "doc.md"), s.doc.texto, "utf8");
    escritos.push({ arquivo: "doc.md", o_que: "a ficha da API de " + s.doc.servico });
  }

  s.contexto = escritos;
  if (!silencioso) for (const e of escritos) diz(s, "escrevi " + e.arquivo + " no diretório da sessão");
  return escritos;
}

function promptDesenhar(s, correcoes) {
  return [
    "Monte um workflow de n8n. Escreva o resultado no arquivo `workflow.json` do diretório atual.",
    "",
    "O que a pessoa quer:",
    JSON.stringify(s.entendi, null, 2),
    (s.respostas && s.respostas.length)
      ? [
          "",
          "Ela respondeu explicitamente às perguntas abaixo. Estas respostas MANDAM: se alguma delas",
          "contradizer o resumo acima, siga a resposta.",
          ...s.respostas.map(r => "- " + r.q + "\n  -> " + r.r)
        ].join("\n")
      : "",
    /* Um campo que começa com "suposição:" não foi confirmado por ninguém. Ele
     * vale como direção, nunca como dado: sair com um canal inventado dentro do
     * parâmetro é pior que sair com o marcador, porque o fluxo importa e manda a
     * mensagem para o lugar errado sem que nada avise. */
    "",
    "Campo do resumo que começa com \"suposição:\" NÃO foi confirmado pela pessoa. Use-o para decidir a FORMA do",
    "fluxo, mas todo parâmetro que dependa dele (canal, número, tabela, planilha, e-mail de destino) sai como",
    "`[PREENCHER]`, e o `report.md` lista esses campos juntos.",
    "",
    "",
    "LEIA ESTES ARQUIVOS ANTES DE ESCREVER — eles estão no diretório atual e são o que você precisa saber:",
    ...(s.contexto || []).map(c => "  `" + c.arquivo + "` — " + c.o_que),
    /* Os anexos entram na construção também, e por um motivo específico: é aqui
     * que o nome REAL da coluna do CSV ou o formato exato visto no print vira
     * expressão dentro do nó. A entrevista lê para perguntar; a construção lê
     * para escrever o parâmetro certo em vez de um sinônimo plausível. */
    (s.anexos || []).length
      ? "  `anexos/INDICE.md` — a árvore do que a pessoa anexou (" + s.anexos.length + " arquivo(s)). " +
        "Abra o que decide parâmetro: nome de coluna, formato de mensagem, identificador de destino. " +
        "O que estiver escrito num anexo vale mais que a sua suposição — e o que NÃO estiver em anexo nenhum " +
        "continua saindo como `[PREENCHER]`."
      : "",
    s.ehAgente
      ? "\nCOMECE por `AGENTES.md`. Ela é a especificação do que construir, não material de apoio: as sete\ncamadas que ela descreve são obrigatórias, e os portões reprovam a maioria dos casos em que faltam.\nDepois leia `GRAMATICA.md` e `esquema.json`: o primeiro diz COMO escrever, o segundo diz quais\nchaves existem em cada nó na versão em uso."
      : "\nCOMECE por `esquema.json` e `GRAMATICA.md`. O `esquema.json` é a DEFINIÇÃO dos nós que você vai\nusar — toda propriedade, o enum de cada discriminador, o que é obrigatório e sob qual operação cada\nchave existe. Ele vale mais que a sua memória: foi lido do pacote `n8n-nodes-base` desta instância,\ne a sua memória foi treinada em versões que já mudaram de forma. Um parâmetro que não está lá é\nignorado pelo n8n em silêncio, e o portão reprova por isso.",
    ((s.contexto || []).find(c => c.arquivo === "catalogo.json" && (c.omitidos || []).length))
      ? "Tipos que existem na instância e ficaram fora de `catalogo.json`: " +
        (s.contexto.find(c => c.arquivo === "catalogo.json").omitidos.join(", "))
      : "",
    "",
    "FORMATO EXATO do arquivo — nenhuma outra chave no topo:",
    '{ "name": "...", "nodes": [...], "connections": {...}, "settings": { "executionOrder": "v1" } }',
    "",
    "Regras que o validador aplica depois, em código:",
    "- Nenhuma chave `credentials` em nó nenhum. A pessoa escolhe a credencial no editor do n8n.",
    "- Nenhuma chave `active`, em lugar nenhum.",
    "- Exatamente um nó de início.",
    "- Todo nó ligado; toda conexão apontando para nó que existe.",
    "- Nomes de nó únicos, em snake_case e em português, no estilo desta instância.",
    "- `type` SÓ pode ser um tipo que está em `catalogo.json`. Tipo fora dele é reprovado sem apelação —",
    "  serviço sem nó dedicado vira `n8n-nodes-base.httpRequest`. Não invente tipo de nó.",
    "- `typeVersion` é OBRIGATÓRIO em todo nó e tem que ser uma das versões de `catalogo.json` para aquele tipo.",
    "- Todo parâmetro que você escrever tem que existir em `esquema.json` para aquele tipo NAQUELA versão,",
    "  e valer para o `resource`/`operation` que você escolheu. Chave que não está lá, ou que só existe",
    "  sob outra operação, é reprovada: o n8n a aceita e ignora, então o fluxo importa limpo e não faz o",
    "  que foi pedido. Discriminador (`resource`, `operation`, `mode`, `select`, `method`) só aceita valor",
    "  do enum que está no esquema.",
    "",
    gramatica.regrasCurtas(),
    "",
    "COMO ESCREVER AS EXPRESSÕES — isto muda o que a pessoa consegue ver antes de subir o fluxo.",
    "O cockpit simula o fluxo por código, sem executar nada. Ele avalia SÓ este conjunto:",
    "  {{ $json.campo }}            acesso a campo, com ponto ou colchete, quantos níveis quiser",
    "  {{ $json.a?.b }}             encadeamento opcional",
    "  {{ $('Nome do Nó').item.json.campo }}",
    "  {{ $now }}  e  {{ $today }}  sem chamar método neles",
    "  {{ ...qualquer um dos acima || 'valor padrão' }}",
    "Fora disso o campo aparece como «não simulada» e a pessoa não vê o resultado daquele pedaço.",
    "Especificamente NÃO consigo avaliar: ternário `? :`, `.map()`, `.join()`, `.filter()`, `.length`,",
    "`DateTime`, template com crase, `$('x').all()`, `$items()`.",
    "",
    "Então: PREFIRA `Set` com expressões simples a nós `Code`, e prefira expressão simples a expressão",
    "esperta. Se precisar de lógica que não cabe no conjunto acima, use um nó `Code` e diga no",
    "`report.md` que aquele trecho não vai poder ser simulado — é melhor assumir isso do que",
    "espalhar JavaScript dentro de `Set` e ter o mesmo efeito sem avisar.",
    "",
    /* Só as regras — o conhecimento longo está em `AGENTES.md`, no disco. */
    s.ehAgente ? agentes.regrasConstrucao() : "",
    "",
    "Escreva também `report.md`, começando com uma linha `**Resumo:** ...` de uma frase,",
    /* Nó a nó não escala. Com 65 nós isso deu 15KB de relatório — 127s de escrita
     * para uma parede que ninguém lê inteira, e ainda repetindo o que a regra de
     * agente já pede por camada. Agrupar é mais curto E mais útil. */
    s.ehAgente
      ? "seguida de UMA SEÇÃO POR CAMADA (as sete), dizendo quais nós formam a camada e o que ela faz.\nNão descreva nó por nó: com dezenas de nós isso vira uma parede que ninguém lê."
      : "seguida do que cada nó faz e do que ainda precisa ser preenchido à mão.",
    "",
    /* Sementes só servem para a simulação, e a simulação de um agente recusa antes
     * de olhar para elas — a resposta vem de um modelo. Medido no primeiro build
     * de agente: 8745 bytes e 54s gastos escrevendo um arquivo que ninguém leu.
     * Num fluxo comum elas são o que faz a etapa 6 existir, e continuam pedidas. */
    s.ehAgente
      ? "NÃO escreva `seeds.json`. Este é um agente: a resposta é escrita por um modelo na hora, então o\ncockpit não simula o resultado e dados de exemplo não serviriam para nada."
      : [
          "E escreva `seeds.json`: dados de EXEMPLO para o cockpit simular este fluxo sem chamar nada.",
          "Formato: { \"nome_do_no\": { ...objeto que aquele nó receberia ou devolveria... } }",
          "Só o nó de início e os nós que fazem chamada externa precisam de entrada.",
          "Os VALORES podem ser inventados; os NOMES DE CAMPO não — use os nomes reais da API,",
          "porque é exatamente aí que o erro aparece se estiverem errados."
        ].join("\n"),
    correcoes ? "\nA TENTATIVA ANTERIOR FOI REPROVADA PELO VALIDADOR:\n" + correcoes + "\nCorrija exatamente isso e escreva o arquivo de novo." : ""
  ].filter(Boolean).join("\n");
}

function promptSementes(s) {
  return [
    "Abaixo está um workflow de n8n. Preciso de dados de EXEMPLO para simular o que ele produziria,",
    "sem chamar nada de verdade.",
    "",
    "```json", JSON.stringify({ nodes: s.wf.nodes.map(n => ({ name: n.name, type: n.type, parameters: n.parameters })) }, null, 2).slice(0, 10000), "```",
    s.doc ? "\nFicha da API (use os NOMES DE CAMPO reais daqui):\n" + s.doc.texto.slice(0, 3000) : "",
    "",
    "Responda SÓ com um bloco ```json mapeando nome-do-nó → o objeto que aquele nó receberia/devolveria:",
    '{ "nome_do_no_de_inicio": { ... }, "nome_do_no_http": { ... } }',
    "",
    "Só nós de início e nós que fazem chamada externa precisam de exemplo.",
    "Use os nomes de campo REAIS da API. Os valores podem ser inventados, mas os NOMES não —",
    "é justamente onde o erro aparece se estiverem errados."
  ].filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ portões */

const CHAVES_TOPO = new Set(["name", "nodes", "connections", "settings"]);

/* Sticky note é anotação: não executa, não liga em nada e não tem typeVersion
 * que importe. Os portões de gatilho, conexão e catálogo não valem para ela. */
const ehSticky = t => /stickyNote/i.test(String(t || ""));

/* Gatilho de verdade: termina em Trigger/cron, ou é o webhook. O regex antigo
 * (/trigger|webhook|cron|schedule/i) contava `respondToWebhook` como início e
 * reprovava um fluxo webhook→resposta com "2 nós de início" — falso positivo. */
const ehGatilho = t => /(?:trigger|cron)$/i.test(String(t || "")) || /\.webhook$/i.test(String(t || ""));

/* `ehAgente` é opcional: sem ele os portões são os doze de sempre. Com ele entram
 * os de `agentes.js`, que verificam FUNÇÃO e não estilo — agente sem memória
 * responde toda mensagem como se fosse a primeira, o que não é um fluxo pior, é
 * um fluxo que não faz o que foi pedido. */
function validar(wf, cat, ehAgente, esq) {
  const falhas = [];
  const F = m => falhas.push(m);

  if (!wf || typeof wf !== "object" || Array.isArray(wf)) return ["o arquivo não é um objeto JSON"];
  for (const k of Object.keys(wf)) if (!CHAVES_TOPO.has(k)) F(`chave de topo não permitida: \`${k}\` (só name, nodes, connections, settings)`);
  if (typeof wf.name !== "string" || !wf.name.trim()) F("falta `name`");
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) F("`nodes` vazio ou ausente");
  if (!wf.connections || typeof wf.connections !== "object") F("falta `connections`");
  if (falhas.length) return falhas;

  const nomes = new Set();
  let gatilhos = 0;
  for (const nd of wf.nodes) {
    if (!nd || typeof nd !== "object") { F("há um nó que não é objeto"); continue; }
    const nome = nd.name;
    if (typeof nome !== "string" || !nome.trim()) { F("há nó sem nome"); continue; }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(nome)) F(`o nome \`${nome}\` tem caractere de controle`);
    if (nomes.has(nome)) F(`nome de nó repetido: \`${nome}\``);
    nomes.add(nome);
    if ("credentials" in nd) F(`o nó \`${nome}\` traz \`credentials\` — proibido, a pessoa escolhe no editor`);
    if ("active" in nd) F(`o nó \`${nome}\` traz \`active\` — proibido`);
    if ("origem" in nd || "provenance" in nd) F(`o nó \`${nome}\` traz metadado do cockpit dentro do JSON — proibido`);
    if (typeof nd.type !== "string" || !nd.type) F(`o nó \`${nome}\` não tem \`type\``);
    if (!Array.isArray(nd.position) || nd.position.length !== 2 || nd.position.some(v => typeof v !== "number")) F(`o nó \`${nome}\` tem \`position\` inválida`);
    if (nd.typeVersion !== undefined && typeof nd.typeVersion !== "number") F(`o nó \`${nome}\` tem \`typeVersion\` que não é número`);
    /* O portão que garante que o nó EXISTE. O JSON vai ser colado no n8n, e a
     * API aceita tipo desconhecido sem reclamar — ele só vira um "?" no editor
     * na hora que a pessoa importa. A prova de existência disponível é o
     * catálogo: tipos que já rodam nesta instância. Fora dele, a saída honesta
     * é httpRequest, e o prompt de construção diz isso. */
    if (!ehSticky(nd.type) && typeof nd.type === "string" && nd.type) {
      const conhecido = cat.nodes[nd.type];
      if (!conhecido) {
        F(`o tipo \`${nd.type}\` não aparece em nenhum fluxo desta instância — não dá para provar que ele existe; use um tipo do catálogo ou \`n8n-nodes-base.httpRequest\``);
      } else if (nd.typeVersion === undefined) {
        // Sem typeVersion o n8n importa como v1, e parâmetro escrito no formato
        // das versões novas quebra em silêncio dentro do editor.
        F(`o nó \`${nome}\` está sem \`typeVersion\` — obrigatório; esta instância usa ${Object.keys(conhecido.versions).join("/")} para \`${nd.type}\``);
      } else if (!Object.keys(conhecido.versions).includes(String(nd.typeVersion))) {
        F(`o nó \`${nome}\` usa typeVersion ${nd.typeVersion}, e esta instância só tem ${Object.keys(conhecido.versions).join("/")} para \`${nd.type}\``);
      }
      if (ehGatilho(nd.type)) gatilhos++;
    }
    for (const [k, v] of Object.entries(nd.parameters || {})) {
      if (typeof v === "string" && SECRET_RE.some(re => new RegExp(re.source).test(v))) F(`o nó \`${nome}\` tem algo com cara de segredo no parâmetro \`${k}\``);
    }

    /* O PORTÃO QUE ACABA COM O ERRO SILENCIOSO DE PARÂMETRO.
     *
     * A API pública do n8n não valida `parameters`. Um `POST` que devolve 200
     * prova que o SCHEMA DO DOCUMENTO foi aceito e nada sobre as chaves dentro
     * dele — o defeito aparece na importação, no editor, que é justo quando
     * alguém está contando com o fluxo. Medido em 99 fluxos publicados: 33 nós
     * carregam parâmetro que a versão declarada não tem (`range` num
     * googleSheets v4, `requestMethod` num httpRequest v4). O n8n aceita e
     * ignora, sem aviso.
     *
     * Três achados, cada um com o nome da chave, e a mensagem é o que volta para
     * o modelo na rodada seguinte — o loop de correção que já funciona.
     *
     * FAIL-OPEN em cinco pontos, e cada um impede uma reprovação falsa: sem
     * esquema, tipo desconhecido, versão aproximada, predicado indeciso e tipo
     * de parâmetro opaco. Medido: assim o portão marca 1,3% dos nós de fluxos
     * publicados que funcionam, e o que sobra é parâmetro de versão velha — ou
     * seja, achado de verdade. Um portão que dispara por falta de conhecimento
     * bloqueia fluxo bom, que é pior que o defeito que ele caça. */
    if (esq && !ehSticky(nd.type)) {
      for (const a of esquema.conferir(esq, nd)) {
        if (a.tipo === "desconhecida") {
          F(`o nó \`${nome}\` (\`${nd.type}\` v${nd.typeVersion}) tem o parâmetro \`${a.chave}\`, que não existe nessa versão do nó — o n8n aceita e ignora em silêncio; veja \`esquema.json\``);
        } else if (a.tipo === "inaplicavel") {
          F(`o nó \`${nome}\` tem \`${a.chave}\`, que só existe sob outra combinação de resource/operation nessa versão — escrito aqui ele é ignorado sem aviso; veja em \`esquema.json\` quais chaves valem para a operação escolhida`);
        } else if (a.tipo === "enum") {
          F(`o nó \`${nome}\` usa \`${a.chave}: ${JSON.stringify(a.valor)}\`, e essa versão só aceita ${a.aceitos.map(x => "`" + x + "`").join(", ")}`);
        }
      }
    }
  }
  if ("active" in wf) F("o workflow traz `active` — proibido, nem no arquivo exibido");
  if (gatilhos === 0) F("nenhum nó de início");
  if (gatilhos > 1) F(`${gatilhos} nós de início; o V1 monta fluxo com um começo só`);

  const ligados = new Set();
  for (const [de, portas] of Object.entries(wf.connections)) {
    if (!nomes.has(de)) { F(`\`connections\` cita \`${de}\`, que não existe em \`nodes\``); continue; }
    ligados.add(de);
    for (const [porta, ramos] of Object.entries(portas || {})) {
      if (!Array.isArray(ramos)) { F(`a porta \`${porta}\` de \`${de}\` não é lista`); continue; }
      const cat_ = cat.nodes[(wf.nodes.find(n => n.name === de) || {}).type];
      if (cat_ && cat_.maxSaidas && ramos.length > cat_.maxSaidas) {
        F(`\`${de}\` usa ${ramos.length} saídas, e nesta instância esse tipo de nó nunca teve mais de ${cat_.maxSaidas}`);
      }
      for (const lista of ramos) for (const c of (lista || [])) {
        if (!c || !nomes.has(c.node)) F(`\`${de}\` liga para \`${c && c.node}\`, que não existe`);
        else ligados.add(c.node);
      }
    }
  }
  const executaveis = wf.nodes.filter(n => n && !ehSticky(n.type));
  for (const nd of executaveis) if (!ligados.has(nd.name) && executaveis.length > 1) F(`o nó \`${nd.name}\` está solto, sem entrada nem saída`);

  if (ehAgente) for (const f of agentes.validarAgente(wf)) F(f);

  return falhas;
}

/* ------------------------------------------------------------------ sandbox */

async function mandarParaSandbox(s) {
  const nome = SANDBOX_PREFIX + String(s.wf.name).slice(0, 80);
  const corpo = { name: nome, nodes: s.wf.nodes, connections: s.wf.connections, settings: s.wf.settings || { executionOrder: "v1" } };
  const achado = await n8n.findWorkflowByName(nome);
  if (achado) {
    // A cerca fica na rota, não só em quem chama: o nome ATUAL do alvo é
    // reconferido antes do PUT. Sem isto, um id herdado de outra sessão poderia
    // apontar para um fluxo de produção.
    if (!String(achado.name || "").startsWith(SANDBOX_PREFIX)) throw new Error("alvo não é uma cópia de teste — escrita recusada");
    await n8n.putWorkflow(achado.id, corpo, d => diz(s, "o n8n descartou estas chaves de settings: " + d.join(", "), "warn"));
    return { id: String(achado.id), nome, criado: false };
  }
  const novo = await n8n.createWorkflow(corpo, d => diz(s, "o n8n descartou estas chaves de settings: " + d.join(", "), "warn"));
  return { id: novo && novo.id ? String(novo.id) : null, nome, criado: true };
}

/* -------------------------------------------------------------- a esteira */

const vivo = (s, gen) => s.gen === gen && s.status !== "cancelada";

async function esteira(s) {
  const gen = s.gen;
  try {
    /* -------------------------------------------------------- 02 pesquisar */
    const semNo = s.servicos.filter(sv => !temNoPara(s.catalogo, sv));
    if (!semNo.length) {
      s.pesquisaPulada = s.servicos.length
        ? "todos os serviços já têm nó nesta instância — não havia doc para ler"
        : "nenhum serviço externo novo";
      etapa(s, 2, "pulada", s.pesquisaPulada);
      diz(s, "pesquisa pulada: " + s.pesquisaPulada);
    } else {
      etapa(s, 2, "correndo");
      await pesquisar(s, semNo[0]);
      if (!vivo(s, gen)) return;
      etapa(s, 2, s.doc ? "feita" : "vazia", s.doc ? null : "não encontrei documentação — o que vier daqui é memória do modelo");
    }

    /* ----------------------------------------------------- 03 ingredientes */
    if (!vivo(s, gen)) return;
    etapa(s, 3, "correndo");
    await ingredientes(s);
    etapa(s, 3, "feita");

    /* --------------------------------------------------------- 04 desenhar */
    if (!vivo(s, gen)) return;
    etapa(s, 4, "correndo");
    const ok = await desenhar(s, gen);
    if (!vivo(s, gen)) return;
    if (!ok) { etapa(s, 4, "falhou"); s.status = "falhou"; emit(s, "fim", {}); await gravarLedger(s); return; }
    etapa(s, 4, "feita");

    /* ---------------------------------------------------------- 05 validar */
    etapa(s, 5, "correndo");
    await validarEProvar(s);
    if (!vivo(s, gen)) return;
    etapa(s, 5, "feita");

    /* --------------------------------------------------------- 06 fantasma */
    etapa(s, 6, "correndo");
    await fantasma(s, gen);
    if (!vivo(s, gen)) return;
    etapa(s, 6, "espera");
    s.status = "aguardando";
    emit(s, "espera", { etapa: 6 });
    await gravarLedger(s);

  } catch (e) {
    /* Matar o filho no meio faz a etapa levantar exceção, e sem esta linha o
     * `catch` reescreveria a sessão como "falhou" com um "quebrou: …" na tela —
     * dizendo que o Tester teve um defeito quando quem parou foi você. Vale para
     * cancelar E para o texto livre, que já matava o filho desde sempre. */
    if (!vivo(s, gen)) return;
    s.erro = scrub(String(e && e.message || e));
    s.status = "falhou";
    diz(s, "quebrou: " + s.erro, "erro");
    emit(s, "fim", {});
    await gravarLedger(s);
  }
}

function temNoPara(cat, servico) {
  const alvo = String(servico || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!alvo) return true;
  return Object.keys(cat.nodes).some(t => t.toLowerCase().replace(/[^a-z0-9]/g, "").includes(alvo));
}

/* Sessão R: rede, diretório vazio, sem contexto do que está sendo construído,
 * e o servidor lê UM caminho que ele mesmo calculou. */
async function pesquisar(s, servico) {
  const slug = slugify(servico);
  const cacheF = path.join(DOCS_DIR, slug + ".md");
  try {
    const st = await fsp.stat(cacheF);
    if (Date.now() - st.mtimeMs < DOCS_TTL_MS) {
      const texto = await fsp.readFile(cacheF, "utf8");
      s.doc = { slug, servico, texto, fontes: fontesDe(texto), doCache: true };
      diz(s, "ficha de " + servico + " veio do cache local (nada foi buscado na internet)");
      emit(s, "doc", { doc: s.doc });
      return;
    }
  } catch { /* sem cache */ }

  const dirR = path.join(s.dir, "research");
  await fsp.mkdir(dirR, { recursive: true });
  diz(s, "sessão de pesquisa (com rede, isolada, descartável) para: " + servico);

  const r = await rodar(s, {
    rotulo: "pesquisa", prompt: promptPesquisa(servico),
    ferramentas: "WebSearch,WebFetch,Write", cwd: dirR,
    modelo: MODELO_CONVERSA, comRede: true
  });

  let texto = null;
  try { texto = await fsp.readFile(dentro(dirR, "doc.md"), "utf8"); } catch { /* não escreveu */ }
  // O diretório inteiro é descartado: o servidor pediu UM caminho e não
  // enumera o que a sessão escreveu.
  await fsp.rm(dirR, { recursive: true, force: true }).catch(() => {});

  if (!texto) {
    diz(s, "a pesquisa não produziu ficha" + (r.erro ? " (" + r.erro + ")" : ""), "warn");
    s.achados.push({ tipo: "risco", texto: "não consegui ler a documentação de " + servico + ": o que vier depois é memória do modelo, não fonte", fonte: "fato" });
    return;
  }
  await fsp.mkdir(DOCS_DIR, { recursive: true });
  await fsp.writeFile(cacheF, texto, "utf8");
  s.doc = { slug, servico, texto: texto.slice(0, 20000), fontes: fontesDe(texto), doCache: false };
  emit(s, "doc", { doc: s.doc });
}

function fontesDe(texto) {
  return [...String(texto).matchAll(/https?:\/\/[^\s)\]]+/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
}

async function ingredientes(s) {
  const tipos = new Set();
  for (const sv of s.servicos) {
    const alvo = sv.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const t of Object.keys(s.catalogo.nodes)) {
      if (t.toLowerCase().replace(/[^a-z0-9]/g, "").includes(alvo)) tipos.add(t);
    }
  }
  /* Os tipos de uso geral entram sempre: são o vocabulário mínimo de qualquer
   * fluxo. O modelo só vê a FATIA (catalog.slice) — se o gatilho por webhook não
   * estiver nela, ele chuta a versão e perde uma rodada no portão. */
  for (const t of ["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.webhook", "n8n-nodes-base.respondToWebhook",
                   "n8n-nodes-base.httpRequest", "n8n-nodes-base.set", "n8n-nodes-base.if",
                   "n8n-nodes-base.filter", "n8n-nodes-base.noOp"]) {
    if (s.catalogo.nodes[t]) tipos.add(t);
  }

  /* Um agente precisa de um vocabulário que o casamento por nome de serviço nunca
   * acha: "whatsapp" casa `whatsApp`, e nada em "quero um agente que responde
   * lead" casa `langchain.agent`. Sem estes tipos na fatia, o modelo escreve o
   * nó de agente de memória, chuta a `typeVersion` e é reprovado pelo portão do
   * catálogo — foi o que motivou esta lista existir. */
  if (s.ehAgente) {
    for (const t of ["@n8n/n8n-nodes-langchain.agent", "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                     "@n8n/n8n-nodes-langchain.memoryRedisChat", "@n8n/n8n-nodes-langchain.memoryBufferWindow",
                     "@n8n/n8n-nodes-langchain.outputParserStructured", "@n8n/n8n-nodes-langchain.toolWorkflow",
                     "@n8n/n8n-nodes-langchain.toolCode", "@n8n/n8n-nodes-langchain.openAi",
                     "n8n-nodes-base.redis", "n8n-nodes-base.wait", "n8n-nodes-base.switch",
                     "n8n-nodes-base.merge", "n8n-nodes-base.code", "n8n-nodes-base.supabase"]) {
      if (s.catalogo.nodes[t]) tipos.add(t);
    }
    for (const t of Object.keys(s.catalogo.nodes)) {
      // O canal de saída: sem ele o fluxo não tem como falar com ninguém.
      if (/\.(whatsApp|telegram)$/i.test(t)) tipos.add(t);
    }
  }

  const nos = [...tipos].map(t => ({
    tipo: t,
    versao: s.catalogo.nodes[t].versaoMaisUsada,
    usos: s.catalogo.nodes[t].usos,
    origem: "instancia"
  }));

  const credTipos = new Set();
  for (const t of tipos) for (const c of s.catalogo.nodes[t].credenciais || []) credTipos.add(c);

  const creds = [];
  for (const tipo of credTipos) {
    let campos = null;
    try {
      // Fato, não palpite: o schema real da instância.
      const sch = await n8n.credentialSchema(tipo);
      campos = sch ? sch.obrigatorios : null;
    } catch { /* schema indisponível */ }
    creds.push({ tipo, visto: catalog.credencialVista(s.catalogo, tipo), campos });
  }
  s.ingredientes = { nos, credenciais: creds };
  emit(s, "ingredientes", { ingredientes: s.ingredientes });

  for (const c of creds) {
    if (!c.visto) s.achados.push({ tipo: "falta", texto: "não encontrei credencial do tipo `" + c.tipo + "` em nenhum fluxo seu — pode existir e ainda não estar em uso", fonte: "fato" });
  }
}

/* O rascunho que aparece na tela ENQUANTO a sessão constrói. O evento tool_use
 * do stream-json traz o conteúdo inteiro do Write — dá para ler o workflow.json
 * no instante em que o modelo o escreve, antes de portão nenhum rodar. Por isso
 * o que sobe para a tela é SÓ o esqueleto (nome, tipo, versão, posição e
 * conexões): parâmetro de rascunho não passou por validação e não tem por que
 * cruzar. O documento que vale continua sendo o do disco, lido depois. */
function parcialDeWrite(c) {
  if (!c || c.name !== "Write" || !c.input) return null;
  if (!/workflow\.json$/i.test(String(c.input.file_path || ""))) return null;
  let wf;
  try { wf = JSON.parse(c.input.content); } catch { return null; }
  if (!wf || !Array.isArray(wf.nodes) || !wf.nodes.length) return null;
  return {
    name: typeof wf.name === "string" ? wf.name.slice(0, 120) : "",
    nodes: wf.nodes.filter(n => n && typeof n === "object").map(n => ({
      name: String(n.name || "").slice(0, 120),
      type: String(n.type || "").slice(0, 120),
      typeVersion: typeof n.typeVersion === "number" ? n.typeVersion : undefined,
      position: (Array.isArray(n.position) && n.position.length === 2 && n.position.every(v => typeof v === "number")) ? n.position : [0, 0]
    })),
    connections: (wf.connections && typeof wf.connections === "object" && !Array.isArray(wf.connections)) ? wf.connections : {}
  };
}

async function desenhar(s, gen) {
  let correcoes = null;
  /* O documento da última rodada REPROVADA, guardado só em memória e só até a
   * rodada seguinte decidir. É o outro lado do delta que vira lição: sem ele, a
   * rodada que passou não tem contra o que ser comparada, e a informação de qual
   * erro foi corrigido morre com o processo. */
  let reprovado = null;
  for (let rodada = 1; rodada <= MAX_ROUNDS; rodada++) {
    if (!vivo(s, gen)) return false;
    /* Reescrito a cada rodada, não só na primeira: a sessão tem `Write` e o
     * diretório é o dela, então nada impede que uma rodada sobrescreva o
     * `AGENTES.md` ou o `catalogo.json` que a rodada seguinte vai ler. É I/O
     * local — custa nada e apaga a classe inteira de "a rodada 2 leu um arquivo
     * corrompido pela rodada 1". O log só menciona na primeira. */
    await escreverContexto(s, rodada > 1);
    if (estourouTeto(s)) { s.erro = "parei por custo: a construção passou do teto de US$" + TETO_USD; diz(s, s.erro, "warn"); return false; }
    s.rodada = rodada;
    diz(s, "montando o fluxo (rodada " + rodada + " de " + MAX_ROUNDS + ")");

    const r = await rodar(s, {
      rotulo: "construcao-r" + rodada, prompt: promptDesenhar(s, correcoes),
      ferramentas: "Read,Write,Edit,Glob,Grep", cwd: s.dir,
      modelo: MODELO_BUILD, comRede: false,
      tetoMs: s.ehAgente ? ROUND_TIMEOUT_AGENTE_MS : ROUND_TIMEOUT_MS,
      aoUsarFerramenta: c => {
        const parcial = parcialDeWrite(c);
        if (parcial && vivo(s, gen)) {
          s.wfParcial = parcial;
          emit(s, "wfParcial", { wfParcial: s.wfParcial });
        }
        // A construção também abre anexo: é aqui que o nome real da coluna do CSV
        // entra na expressão. O chip marca o que foi lido em qualquer etapa.
        registrarLeituraAnexo(s, c);
      }
    });
    if (!vivo(s, gen)) return false;

    let wf = null;
    try { wf = JSON.parse(await fsp.readFile(dentro(s.dir, "workflow.json"), "utf8")); }
    catch (e) { correcoes = "não consegui ler `workflow.json`: " + String(e && e.message || e); diz(s, correcoes, "warn"); continue; }

    const falhas = validar(wf, s.catalogo, s.ehAgente, s.esquema);
    s.gates = { rodada, falhas, passou: !falhas.length };
    emit(s, "gates", { gates: s.gates });

    if (!falhas.length) {
      /* A rodada passou e a anterior não: aqui está a única lição que este
       * cockpit consegue tirar de graça, e ele a jogava fora. O que entra é só o
       * que o portão de ESQUEMA apontou e esta rodada resolveu — comparar os dois
       * documentos inteiros daria dezenas de diferenças sem relação com a
       * reprovação, porque a rodada N+1 reescreve o fluxo todo.
       *
       * Nunca deixa o build cair: registrar lição é bookkeeping, e um erro aqui
       * não pode custar uma construção que acabou de dar certo. */
      if (reprovado && s.esquema) {
        try {
          const novas = licoes.registrar(licoes.doPortao({
            wfFalho: reprovado.wf, wfBom: wf, esquema: s.esquema,
            ondeMedido: "build:" + s.id + " r" + reprovado.rodada + "→r" + rodada
          }));
          if (novas.length) diz(s, "aprendi " + novas.length + " lição(ões) com a rodada reprovada — revise com `node licoes.js`");
        } catch (e) { diz(s, "não consegui registrar as lições da rodada: " + String(e && e.message), "warn"); }
      }
      s.wf = wf;
      s.wfParcial = null;                       // o documento validado assume
      s.provenance = proveniencia(s, wf);
      // Agora dá para estreitar a lista de credenciais para os nós que o fluxo
      // REALMENTE usa. Na etapa 3 ela é um chute largo — `httpRequest` já foi
      // usado com meia dúzia de credenciais diferentes nos fluxos do Kauan, e
      // listar todas fazia a coluna virar parede de texto sem informação.
      await estreitarCredenciais(s, wf);
      try { s.report = (await fsp.readFile(dentro(s.dir, "report.md"), "utf8")).slice(0, 6000); } catch { s.report = null; }
      /* Sementes escritas pela MESMA sessão que montou o fluxo. Antes isto era
       * uma invocação separada do modelo — medida em ~50s e ~US$0,14 por
       * construção, para produzir algo que quem acabou de escrever o fluxo já
       * sabia de cor. É a maior economia de tempo desta esteira, e não custa
       * qualidade: quem escreveu o nó é quem melhor sabe o que ele recebe. */
      try {
        const j = JSON.parse(await fsp.readFile(dentro(s.dir, "seeds.json"), "utf8"));
        if (j && typeof j === "object" && !Array.isArray(j)) {
          s.sementes = j;
          s.sementesOrigem = s.doc ? ("escritas junto do fluxo, a partir da ficha de " + s.doc.servico)
                                   : "escritas junto do fluxo";
        }
      } catch { /* sem seeds.json: a etapa 6 pede numa sessão à parte */ }
      emit(s, "wf", { wf: s.wf, provenance: s.provenance });
      if (wf.nodes.some(n => n.type === "n8n-nodes-base.code")) {
        s.achados.push({ tipo: "risco", texto: "este fluxo usa um nó `Code`: eu não consigo simular o que ele devolve, então o resultado da etapa 6 não cobre esse trecho", fonte: "fato" });
      }
      return true;
    }
    correcoes = falhas.map(f => "- " + f).join("\n");
    reprovado = { wf, rodada };
    diz(s, "o validador reprovou " + falhas.length + " ponto(s)", "warn");
  }
  s.erro = "o fluxo proposto não passou nos portões em " + MAX_ROUNDS + " tentativas";
  return false;
}

/* Credenciais dos tipos de nó que estão no fluxo, e só deles. Um nó que nunca
 * pede credencial (Set, IF, agenda) não entra. Se o tipo aparece no catálogo com
 * mais de um tipo de credencial possível, todos entram — aí a escolha é do
 * Kauan no editor, e esconder as alternativas seria decidir por ele. */
async function estreitarCredenciais(s, wf) {
  const tipos = new Set();
  for (const nd of wf.nodes || []) {
    const c = s.catalogo.nodes[nd.type];
    for (const t of (c && c.credenciais) || []) tipos.add(t);
  }
  const creds = [];
  const porTipo = new Map();
  for (const tipo of tipos) {
    let campos = null;
    try { const sch = await n8n.credentialSchema(tipo); campos = sch ? sch.obrigatorios : null; }
    catch { /* schema indisponível */ }
    const item = {
      tipo, campos,
      visto: catalog.credencialVista(s.catalogo, tipo),
      // Nomear em vez de só tipar. "você tem a *Slack Ecommerce Puro*, usada em
      // 6 fluxos" é uma frase acionável; "existe alguma do tipo slackApi" não é.
      existentes: catalog.credenciaisDoTipo(s.catalogo, tipo)
    };
    porTipo.set(tipo, item);
    creds.push(item);
  }
  s.ingredientes = {
    nos: s.ingredientes.nos, credenciais: creds,
    porNo: checklistCredenciais(wf, s.catalogo, porTipo),
    estreitada: true
  };
  recomputarLigacao(s);
  emit(s, "ingredientes", { ingredientes: s.ingredientes });
}

/* A mesma informação, virada do avesso: por NÓ em vez de por tipo.
 *
 * A lista por tipo responde "o que este fluxo precisa"; ela não responde "e
 * agora, o que eu clico". Com o fluxo já importado e três nós vermelhos na tela,
 * a pergunta é sempre a segunda, e respondê-la a partir da primeira exige
 * traduzir tipo de credencial em nó na tela — que é justamente o passo que
 * ninguém consegue fazer às onze da noite.
 *
 * É derivada, e derivada DOS FLUXOS DELE: `catalogo.nodes[tipo].credenciais` são
 * os tipos de credencial que aquele tipo de nó usa nesta instância. Consequência
 * que a tela precisa dizer em voz alta: um nó que aqui nunca pediu credencial
 * não aparece, mesmo que possa vir a pedir. A lista é um piso, não um total —
 * exatamente como a varredura truncada do `/disco`.
 *
 * Nó com mais de um tipo possível sai com TODOS. Esconder as alternativas seria
 * decidir por ele qual autenticação usar, e `httpRequest` nesta conta já apareceu
 * com meia dúzia de credenciais diferentes. */
/* Quais nós dá para deixar já ligados no JSON exportado, e quais não dá.
 *
 * O n8n casa credencial por `id` + `name` na importação: um fluxo que já sai
 * apontando para uma credencial existente importa ligado, zero clique. Num fluxo
 * de 3 nós isso é um minuto; num agente de 65 nós com 20 blocos de credencial, é
 * o trabalho todo.
 *
 * A REGRA, e ela é código e não pedido a modelo: só liga quando NÃO HÁ ESCOLHA A
 * FAZER. Um único candidato com id e nome, somando todos os tipos de credencial
 * que aquele tipo de nó aceita. Dois candidatos é ambíguo, e escolher um seria
 * decidir por ele de qual conta a mensagem sai — pior que o campo vazio, porque
 * importa calado e só aparece na primeira execução, no destino errado. Zero
 * candidatos idem: id inventado é a mesma falha silenciosa.
 *
 * Isto devolve só o RELATÓRIO, nunca uma segunda cópia do fluxo. `s.wf` continua
 * sem `credentials` em todo lugar que importa — no portão, na cópia sandbox, no
 * fantasma e no arquivo do projeto. Quem monta o documento exportado é a tela,
 * a partir destes fatos: o servidor diz qual credencial é inequívoca para qual
 * nó, e a página compõe. */
function ligacaoCredenciais(wf, cat, escolhas) {
  const escolhidos = new Set((escolhas || []).map(e => e && e.id).filter(Boolean));
  const ligados = [], vazios = [];
  for (const nd of (wf && wf.nodes) || []) {
    const c = cat.nodes[nd.type];
    const tipos = (c && c.credenciais) || [];
    if (!tipos.length) continue;
    const cands = [];
    for (const tipo of tipos) {
      for (const x of catalog.credenciaisDoTipo(cat, tipo)) {
        if (x.id && x.nome) cands.push({ tipo, id: x.id, nome: x.nome, usos: x.usos });
      }
    }
    /* O desempate. Sem ele, um nó com duas credenciais possíveis ficava em
     * branco PARA SEMPRE — o cockpit se recusa a chutar, e até aqui não havia
     * como dizer a ele qual era. Medido nos fluxos do Kauan: é o caso do Slack,
     * que tem `slackApi` (22 usos) e `slackOAuth2Api` (3).
     *
     * A escolha é guardada por `id`, não por nó: "quando for Slack, usa a
     * Ecommerce Puro" vale para todo nó de Slack, inclusive os que um remendo
     * ainda vai criar. Guardar por nome de nó quebraria no primeiro rename.
     *
     * Duas escolhas cabendo no mesmo nó continua sendo ambíguo — aí o desempate
     * não desempatou nada, e chutar aqui seria o mesmo erro de antes. */
    const porEscolha = cands.filter(x => escolhidos.has(x.id));
    const alvo = cands.length === 1 ? cands[0] : (porEscolha.length === 1 ? porEscolha[0] : null);

    if (alvo) {
      ligados.push({ no: nd.name, tipo: alvo.tipo, id: alvo.id, nome: alvo.nome, porEscolha: cands.length > 1 });
    } else {
      vazios.push({
        no: nd.name, tipos,
        motivo: !cands.length ? "nenhuma credencial deste tipo nos seus fluxos"
          : porEscolha.length > 1 ? "você escolheu mais de uma que serve para este nó"
          : "mais de uma credencial serviria",
        candidatos: cands.map(x => ({ tipo: x.tipo, id: x.id, nome: x.nome, usos: x.usos }))
      });
    }
  }
  return { ligados, vazios };
}

function recomputarLigacao(s) {
  if (!s.wf || !s.catalogo) return;
  s.credLigacao = ligacaoCredenciais(s.wf, s.catalogo, s.escolhasCred || []);
}

/* Registrar a escolha. É código local: sem modelo, sem custo, instantâneo — e
 * nenhum segredo passa por aqui. O que se guarda é um ponteiro (`id`) para uma
 * credencial que já existe na instância; o valor dela nunca sai do n8n, e o
 * cockpit nunca teve como pedi-lo (a API pública não devolve).
 *
 * `tipo` e `id` são conferidos contra o catálogo antes de entrar: um id que não
 * corresponde a nada ligaria o nó a uma credencial inexistente, que importa
 * calado e falha na primeira execução — a mesma falha silenciosa que a ligação
 * automática se recusa a produzir por conta própria. */
function escolherCredencial(id, credId) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }
  if (!s.catalogo) { const e = new Error("o catálogo ainda não carregou"); e.status = 409; throw e; }

  const alvo = (s.catalogo.credenciaisConhecidas || []).find(c => c.id && String(c.id) === String(credId));
  if (!alvo) { const e = new Error("não conheço nenhuma credencial com esse identificador nos seus fluxos"); e.status = 400; throw e; }

  const lista = (s.escolhasCred || []).filter(c => c.tipo !== alvo.tipo);
  lista.push({ tipo: alvo.tipo, id: String(alvo.id), nome: alvo.nome, em: new Date().toISOString() });
  s.escolhasCred = lista.slice(0, 20);
  recomputarLigacao(s);
  emit(s, "ingredientes", { ingredientes: s.ingredientes, credLigacao: s.credLigacao, escolhasCred: s.escolhasCred });
  return { escolhida: { tipo: alvo.tipo, id: String(alvo.id), nome: alvo.nome } };
}

/* ------------------------------------------------ o desempate, pelo chat
 *
 * Casamento LOCAL, sem modelo: os candidatos são dois ou três nomes, e mandar
 * isso para uma sessão do CLI custaria dezenas de segundos e alguns centavos
 * para escolher entre duas strings. Mesma razão pela qual re-simular é código.
 *
 * Duas condições, e as duas são obrigatórias, porque um falso positivo aqui
 * engoliria um pedido de construção de verdade:
 *   1. a frase tem que carregar uma palavra que declara o assunto (credencial,
 *      conta, autenticação, login) — "manda o aviso pro Slack Ecommerce Puro"
 *      não é um desempate, é um pedido de fluxo;
 *   2. exatamente UM candidato tem que casar. Dois casando é ambiguidade nova,
 *      e a resposta certa é devolver a pergunta, nunca escolher.
 */
const SINAL_CRED = /\b(credencia\w*|credential\w*|conta|autentica\w*|login|auth)\b/i;
const semAcento = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function interpretarEscolhaCred(texto, credLigacao) {
  const t = semAcento(texto);
  if (!SINAL_CRED.test(t)) return null;

  // Só candidatos de nós que estão de fato em branco: escolher uma credencial
  // que já está ligada não é desempate, é ruído.
  const cands = new Map();
  for (const v of (credLigacao && credLigacao.vazios) || []) {
    for (const c of v.candidatos || []) if (c.id) cands.set(c.id, c);
  }
  if (!cands.size) return null;

  const casou = [...cands.values()].filter(c => {
    const nome = semAcento(c.nome);
    return (nome.length >= 3 && t.includes(nome)) || t.includes(semAcento(c.tipo));
  });
  if (casou.length === 1) return { escolha: casou[0] };
  if (casou.length > 1) return { ambiguo: casou };
  return { naoAchei: [...cands.values()] };
}

function checklistCredenciais(wf, cat, porTipo) {
  const out = [];
  for (const nd of (wf && wf.nodes) || []) {
    const c = cat.nodes[nd.type];
    const tipos = (c && c.credenciais) || [];
    if (!tipos.length) continue;
    out.push({
      no: nd.name,
      tipo: nd.type,
      /* `campos` vem do `porTipo` quando já foi buscado, porque cada um custa uma
       * chamada de schema à instância. `visto` e `existentes` saem SEMPRE do
       * catálogo de agora, nunca do que veio junto: num projeto salvo esses
       * campos são um retrato da instância de meses atrás, e reaproveitá-los
       * mostraria uma credencial que já não existe — ou nenhuma, que foi o que
       * apareceu na primeira vez que isto foi olhado num projeto antigo. */
      opcoes: tipos.map(t => ({
        ...(porTipo.get(t) || { campos: null }),
        tipo: t,
        visto: catalog.credencialVista(cat, t),
        existentes: catalog.credenciaisDoTipo(cat, t)
      }))
    });
  }
  return out;
}

function proveniencia(s, wf) {
  const out = {};
  for (const nd of wf.nodes || []) {
    const c = s.catalogo.nodes[nd.type];
    out[nd.name] = c
      ? { origem: "instancia", nota: c.usos + " usos nos seus fluxos" }
      : (s.doc ? { origem: "web", nota: s.doc.servico, fonte: (s.doc.fontes || [])[0] || null }
               : { origem: "memoria", nota: "nada confirmou este tipo de nó" });
  }
  return out;
}

async function validarEProvar(s) {
  if (!SANDBOX_ON) { s.sandbox = { estado: "desligado" }; emit(s, "sandbox", { sandbox: s.sandbox }); return; }
  try {
    const r = await mandarParaSandbox(s);
    s.sandbox = { estado: "ok", id: r.id, nome: r.nome, criado: r.criado };
    diz(s, "cópia de teste " + (r.criado ? "criada" : "atualizada") + " no n8n: " + r.nome);
  } catch (e) {
    // Falha de escrita prova ausência de CONFIRMAÇÃO, não ausência de efeito.
    s.sandbox = { estado: "indeterminado", motivo: scrub(String(e && e.message || e)) };
    diz(s, "não consegui confirmar a cópia de teste: " + s.sandbox.motivo, "warn");
  }
  emit(s, "sandbox", { sandbox: s.sandbox });
}

async function fantasma(s, gen) {
  // Caminho rápido: a sessão de construção já escreveu as sementes. Só quando
  // ela não escreveu é que vale gastar uma invocação a mais.
  if (s.sementes && Object.keys(s.sementes).length) { rodarFantasma(s); return; }

  /* Num agente a simulação recusa antes de olhar as sementes — a resposta vem de
   * um modelo, e é isso que `recusaFantasma()` diz. Então pedir sementes aqui é
   * pagar uma invocação (~US$0,14 e ~50s, medidos) por um dado que ninguém vai
   * ler. O caminho honesto é recusar já. */
  if (s.wf && agentes.recusaFantasma(s.wf)) {
    diz(s, "não vou pedir dados de exemplo: a simulação de um agente recusa de qualquer forma, porque a resposta vem de um modelo");
    rodarFantasma(s);
    return;
  }

  diz(s, "o fluxo veio sem dados de exemplo — pedindo numa sessão à parte");
  const r = await rodar(s, {
    rotulo: "sementes", prompt: promptSementes(s),
    ferramentas: "Read", cwd: s.dir, modelo: MODELO_CONVERSA, comRede: false
  });
  if (!vivo(s, gen)) return;
  s.sementes = jsonDoTexto(r.texto) || {};
  s.sementesOrigem = s.doc ? ("geradas a partir da ficha de " + s.doc.servico) : "geradas de memória do modelo";
  rodarFantasma(s);
}

function rodarFantasma(s) {
  if (!s.wf) {
    s.fantasma = { ok: false, recusa: "não há fluxo para simular" };
  } else {
    /* A recusa pelo motivo CERTO. Um agente é feito exatamente dos tipos que o
     * simulador recusa por princípio (`code`, `merge`, `switch`), então ele
     * recusaria de qualquer jeito — dizendo "expressão fora do subconjunto", o
     * que manda o Kauan procurar um problema de expressão que não existe. O
     * motivo verdadeiro é que a resposta vem de um modelo. */
    s.fantasma = agentes.recusaFantasma(s.wf) || simulate(s.wf, { seeds: s.sementes || {} });
  }
  emit(s, "fantasma", { fantasma: s.fantasma, sementes: s.sementes, sementesOrigem: s.sementesOrigem });
}

/* O teto só vale enquanto o custo é conhecido. Uma rodada morta por tempo não
 * reporta `total_cost_usd`, e somar 0 por ela faria o teto autorizar a próxima
 * rodada como se a anterior tivesse sido de graça. Quando há gasto não medido, o
 * teto usa a média das rodadas medidas como piso — um palpite declarado, que é
 * melhor que um zero silencioso. */
function gastoAte(s) {
  const medidos = s.custo.filter(c => !c.usdDesconhecido);
  const soma = medidos.reduce((a, c) => a + (c.usd || 0), 0);
  const cegos = s.custo.length - medidos.length;
  if (!cegos) return { usd: soma, estimado: false };
  const media = medidos.length ? soma / medidos.length : 0.5;
  return { usd: soma + cegos * media, estimado: true, cegos };
}
const estourouTeto = s => gastoAte(s).usd >= TETO_USD;

/* ------------------------------------------------------------------ ledger */

async function gravarLedger(s) {
  let lista = [];
  try { lista = JSON.parse(await fsp.readFile(LEDGER, "utf8")); } catch { /* primeiro */ }
  if (!Array.isArray(lista)) lista = [];
  const entrada = {
    id: s.id, ideia: s.ideia, nivel: s.nivel,
    criadoEm: s.criadoEm, terminadoEm: new Date().toISOString(),
    status: s.status, etapaFinal: s.etapa,
    /* O ledger é o registro do que o Tester propôs, e um agente e uma notificação
     * não são a mesma construção: rodam prompts diferentes, portões diferentes e
     * tetos de tempo diferentes. Sem este campo, comparar custo ou taxa de
     * aprovação entre builds mistura duas populações. `rodadasEntrevista` é o que
     * diz se a entrevista de doze dimensões converge na prática. */
    ehAgente: s.ehAgente === undefined ? null : s.ehAgente,
    rodadasEntrevista: s.rodadaEntrevista || 1,
    respostas: (s.respostas || []).length,
    pesquisou: !!s.doc, pesquisaDoCache: !!(s.doc && s.doc.doCache),
    nos: s.wf ? s.wf.nodes.length : 0,
    gates: s.gates ? { passou: s.gates.passou, rodada: s.gates.rodada, falhas: (s.gates.falhas || []).length } : null,
    sandbox: s.sandbox ? s.sandbox.estado : null,
    fantasma: s.fantasma ? (s.fantasma.ok ? "simulou" : "recusou") : null,
    custo: s.custo, custoTotal: +(s.custo.reduce((a, c) => a + (c.usd || 0), 0)).toFixed(4),
    exportado: !!s.exportado
  };
  const i = lista.findIndex(x => x.id === s.id);
  if (i >= 0) lista[i] = entrada; else lista.push(entrada);
  const tmp = LEDGER + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(lista, null, 2), "utf8");
  await fsp.rename(tmp, LEDGER);
}

/* ---------------------------------------------------------------- projetos
 *
 * O que o Tester produz e o Kauan decidiu guardar. Um arquivo por projeto,
 * RASTREADO no git — não é cache: o JSON do fluxo, o relatório e a simulação não
 * dá para regenerar sem pagar a construção de novo.
 *
 * O nome do arquivo sai de `slugify`, nunca do título cru: o título vem de um
 * campo de texto e não pode virar caminho. */
const PROJETOS_DIR = path.join(__dirname, "projetos");

async function salvarProjeto(id, titulo) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }
  if (!s.wf) { const e = new Error("esta construção não tem fluxo para salvar"); e.status = 409; throw e; }

  const nome = so(titulo) || so(s.wf.name) || "projeto sem nome";
  const slug = slugify(nome);
  await fsp.mkdir(PROJETOS_DIR, { recursive: true });

  const projeto = {
    slug, titulo: nome.slice(0, 120),
    ideia: s.ideia, nivel: s.nivel,
    // Sem isto, reabrir um projeto de agente mostra a conversa longa sem dizer
    // por que ela foi longa, e a recusa da simulação fica sem explicação.
    ehAgente: s.ehAgente === undefined ? null : s.ehAgente,
    salvoEm: new Date().toISOString(), sessaoId: s.id,
    // A conversa inteira: reabrir um projeto tem que mostrar o que foi dito e
    // decidido, não só o JSON — um mês depois é ISTO que explica o fluxo.
    chat: s.chat, respostas: s.respostas || [],
    /* Os METADADOS dos anexos, nunca os arquivos. `.tester-runs/` é descartável e
     * some; guardar cópia dentro de `projetos/` faria um print de 3MB entrar no
     * git a cada projeto salvo. O que fica é o registro de que o fluxo foi
     * construído olhando aquele material, com nome e tipo — e a tela diz que os
     * arquivos em si não estão mais aqui, em vez de mostrar chip que não abre. */
    anexos: (s.anexos || []).map(a => ({ nome: a.nome, tipo: a.tipo, bytes: a.bytes, dePasta: !!a.dePasta, raiz: a.raiz || null })),
    anexosLidos: s.anexosLidos || [],
    escolhasCred: s.escolhasCred || [],
    wf: s.wf, provenance: s.provenance,
    report: s.report || null,
    fantasma: s.fantasma || null, sementes: s.sementes || null, sementesOrigem: s.sementesOrigem || null,
    achados: s.achados, ingredientes: s.ingredientes,
    // Ponteiros para credenciais que já existem na instância — nunca segredo.
    // Guardados porque a escolha vale para o próximo remendo também.
    escolhasCred: s.escolhasCred || [],
    sandbox: s.sandbox, gates: s.gates,
    custoTotal: +(s.custo.reduce((a, c) => a + (c.usd || 0), 0)).toFixed(4)
  };
  const alvo = dentro(PROJETOS_DIR, slug + ".json");
  const tmp = alvo + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(projeto, null, 2), "utf8");
  await fsp.rename(tmp, alvo);

  s.projetoSlug = slug;
  s.projetoTitulo = projeto.titulo;
  emit(s, "projeto", { slug, titulo: projeto.titulo });
  await gravarLedger(s);
  return { slug, titulo: projeto.titulo };
}

async function listarProjetos() {
  let arquivos = [];
  try { arquivos = await fsp.readdir(PROJETOS_DIR); } catch { return []; }
  const out = [];
  for (const f of arquivos) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = JSON.parse(await fsp.readFile(dentro(PROJETOS_DIR, f), "utf8"));
      out.push({
        slug: p.slug, titulo: p.titulo, ideia: p.ideia, salvoEm: p.salvoEm,
        nos: (p.wf && p.wf.nodes || []).length,
        tipos: [...new Set((p.wf && p.wf.nodes || []).map(n => String(n.type).replace("n8n-nodes-base.", "")))].slice(0, 5),
        simulou: !!(p.fantasma && p.fantasma.ok),
        custoTotal: p.custoTotal
      });
    } catch { /* arquivo ruim: some da lista em vez de derrubar a tela */ }
  }
  return out.sort((a, b) => String(b.salvoEm).localeCompare(String(a.salvoEm)));
}

/* Renomear NÃO mexe no nome do arquivo. O slug é a identidade do projeto — a
 * URL que abre ele, a chave do card — e renomear um arquivo por causa de um
 * título editado criaria duplicata na primeira vez que alguém voltasse atrás. */
async function renomearProjeto(slug, titulo) {
  const p = await lerProjeto(slug);
  if (!p) { const e = new Error("projeto não encontrado"); e.status = 404; throw e; }
  const novo = so(titulo).slice(0, 120);
  if (!novo) { const e = new Error("o nome não pode ficar vazio"); e.status = 400; throw e; }
  p.titulo = novo;
  p.renomeadoEm = new Date().toISOString();
  const alvo = dentro(PROJETOS_DIR, slug + ".json");
  const tmp = alvo + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(p, null, 2), "utf8");
  await fsp.rename(tmp, alvo);
  return { slug, titulo: novo };
}

/* ---------------------------------------------------------------- lixeira
 *
 * Excluir MOVE, não apaga. Antes era `unlink` direto, e o desfazer existia só na
 * forma de `git checkout` — o que é verdade e não é uma saída: exige lembrar o
 * comando, estar num terminal e que o commit anterior exista. Uma construção
 * custa minutos e dólares; ela merece um passo entre o clique e o fim.
 *
 * Apagar de vez continua existindo, e continua sendo `unlink` — só que agora é
 * uma decisão tomada dentro da lixeira, olhando o que vai sumir, em vez de um
 * efeito colateral de um clique num menu de card.
 *
 * A pasta fica DENTRO de `projetos/` de propósito: ela é rastreada no git pelo
 * mesmo motivo que o resto, e `listarProjetos` filtra por `.json` no nível de
 * cima, então um diretório não aparece como projeto. O nome do arquivo carrega
 * um carimbo de tempo porque excluir duas vezes o mesmo slug é normal — sem ele
 * a segunda exclusão sobrescreveria a primeira, apagando calado o que a lixeira
 * existe para não apagar. */
const LIXEIRA_DIR = path.join(PROJETOS_DIR, ".lixeira");
const LIXO_RE = /^[a-z0-9-]{1,64}__[0-9]{14}$/;

const carimbo = d => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

async function excluirProjeto(slug) {
  if (!/^[a-z0-9-]{1,64}$/.test(String(slug || ""))) { const e = new Error("identificador inválido"); e.status = 400; throw e; }
  const proj = await lerProjeto(slug);
  if (!proj) { const e = new Error("projeto não encontrado"); e.status = 404; throw e; }

  await fsp.mkdir(LIXEIRA_DIR, { recursive: true });
  const agora = new Date();
  const lixo = slug + "__" + carimbo(agora);
  proj.excluidoEm = agora.toISOString();
  proj.slugOriginal = slug;

  // Escreve o destino ANTES de remover a origem: se a escrita falhar, o projeto
  // continua onde estava. O contrário perderia o arquivo num disco cheio.
  await fsp.writeFile(dentro(LIXEIRA_DIR, lixo + ".json"), JSON.stringify(proj, null, 2), "utf8");
  await fsp.unlink(dentro(PROJETOS_DIR, slug + ".json"));
  return { removido: slug, lixo };
}

async function listarLixeira() {
  let arquivos = [];
  try { arquivos = await fsp.readdir(LIXEIRA_DIR); } catch { return []; }
  const out = [];
  for (const f of arquivos) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = JSON.parse(await fsp.readFile(dentro(LIXEIRA_DIR, f), "utf8"));
      out.push({
        lixo: f.replace(/\.json$/, ""),
        slug: p.slugOriginal || p.slug, titulo: p.titulo, ideia: p.ideia,
        salvoEm: p.salvoEm, excluidoEm: p.excluidoEm || null,
        nos: (p.wf && p.wf.nodes || []).length,
        tipos: [...new Set((p.wf && p.wf.nodes || []).map(n => String(n.type).replace("n8n-nodes-base.", "")))].slice(0, 5),
        simulou: !!(p.fantasma && p.fantasma.ok),
        custoTotal: p.custoTotal,
        // O que se perde de verdade ao apagar de vez. Uma construção que custou
        // US$3 e 14 minutos não pode sumir atrás da palavra "excluir".
        versoes: Array.isArray(p.versoes) ? p.versoes.length : 0
      });
    } catch { /* arquivo ruim: some da lista em vez de derrubar a tela */ }
  }
  return out.sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
}

/* Voltar da lixeira. O slug pode ter sido reocupado — nada impede salvar um
 * projeto novo com o mesmo nome enquanto o antigo estava lá dentro —, e
 * sobrescrever seria trocar um dado vivo por um morto. Nesse caso ele volta com
 * um slug livre, e QUEM CHAMOU RECEBE o slug novo para poder dizer na tela. */
async function restaurarProjeto(lixo) {
  if (!LIXO_RE.test(String(lixo || ""))) { const e = new Error("identificador inválido"); e.status = 400; throw e; }
  const origem = dentro(LIXEIRA_DIR, lixo + ".json");
  let proj;
  try { proj = JSON.parse(await fsp.readFile(origem, "utf8")); }
  catch { const e = new Error("não achei este item na lixeira"); e.status = 404; throw e; }

  const base = proj.slugOriginal || proj.slug;
  let slug = base, n = 1;
  while (fs.existsSync(dentro(PROJETOS_DIR, slug + ".json"))) {
    n++; slug = (base + "-" + n).slice(0, 64);
    if (n > 50) { const e = new Error("não consegui achar um nome livre para restaurar"); e.status = 409; throw e; }
  }

  proj.slug = slug;
  delete proj.excluidoEm;
  delete proj.slugOriginal;
  proj.restauradoEm = new Date().toISOString();
  await fsp.mkdir(PROJETOS_DIR, { recursive: true });
  await gravarProjeto(proj);
  await fsp.unlink(origem);
  return { slug, titulo: proj.titulo, renomeado: slug !== base };
}

async function excluirDaLixeira(lixo) {
  if (!LIXO_RE.test(String(lixo || ""))) { const e = new Error("identificador inválido"); e.status = 400; throw e; }
  try { await fsp.unlink(dentro(LIXEIRA_DIR, lixo + ".json")); }
  catch { const e = new Error("não achei este item na lixeira"); e.status = 404; throw e; }
  return { apagado: lixo };
}

async function esvaziarLixeira() {
  let arquivos = [];
  try { arquivos = await fsp.readdir(LIXEIRA_DIR); } catch { return { apagados: 0 }; }
  let n = 0;
  for (const f of arquivos) {
    if (!f.endsWith(".json")) continue;
    try { await fsp.unlink(dentro(LIXEIRA_DIR, f)); n++; } catch { /* já sumiu */ }
  }
  return { apagados: n };
}

async function lerProjeto(slug) {
  if (!/^[a-z0-9-]{1,64}$/.test(String(slug || ""))) return null;
  try { return JSON.parse(await fsp.readFile(dentro(PROJETOS_DIR, slug + ".json"), "utf8")); }
  catch { return null; }
}

/* O projeto com a checklist de credenciais preenchida na hora da leitura.
 *
 * Ela é DERIVADA, então não é gravada: um projeto salvo antes desta feature
 * ganha a checklist ao ser aberto, e um projeto salvo hoje não fica com uma
 * cópia velha dela no disco no dia em que a instância mudar. `lerProjeto` cru
 * continua existindo para quem vai gravar de volta — enriquecer ali colocaria
 * campo derivado dentro do arquivo na primeira renomeação. */
async function lerProjetoParaTela(slug) {
  const p = await lerProjeto(slug);
  if (!p || !p.wf) return p;
  try {
    const cat = await catalog.get({});
    const porTipo = new Map((p.ingredientes && p.ingredientes.credenciais || []).map(c => [c.tipo, c]));
    p.ingredientes = { ...(p.ingredientes || { nos: [], credenciais: [] }), porNo: checklistCredenciais(p.wf, cat, porTipo) };
    p.credLigacao = ligacaoCredenciais(p.wf, cat, p.escolhasCred || []);
  } catch { /* sem catálogo a tela diz que não sabe, em vez de mentir uma lista vazia */ }
  return p;
}

/* ------------------------------------------------------- edição de projeto
 *
 * Um projeto salvo era um replay morto: a conversa, o desenho e o JSON, e o
 * único caminho adiante era construir tudo de novo do zero. Aqui ele volta a ser
 * conversa — dá para perguntar, mudar, acrescentar e tirar.
 *
 * REMENDO, NÃO RECONSTRUÇÃO. A sessão de edição escreve um PATCH sobre o fluxo
 * que já existe, com os mesmos verbos que o `claude-fix.js` já usa no painel de
 * fluxos. Duas razões, as duas medidas nesta esteira:
 *   1. Custo. Reescrever o `workflow.json` inteiro é o que a etapa 04 faz, e num
 *      agente isso foi US$2,79 e 660s — por pedido. Um remendo olha os nós
 *      relevantes e cabe em uma fração disso.
 *   2. Revisão. Um patch produz DIFF, e diff é o que permite mostrar o que vai
 *      mudar antes de mudar. Um documento reescrito só permite comparar dois
 *      documentos, que é exatamente o que ninguém faz.
 *
 * O QUARTO VERBO. `claude-fix.js` tem três (`updateNodes`, `addNodes`, `rewire`)
 * e não tem apagar, de propósito: lá o alvo é um fluxo de produção e "nunca
 * apague um nó" virou algo que o formato não sabe expressar. Aqui o alvo é o
 * rascunho da própria pessoa, que nunca foi para o n8n, e "tira o passo do
 * Slack" é pedido legítimo. Então `removeNodes` existe — mas mora AQUI, e o
 * `claude-fix.js` continua sem saber apagar. A garantia do caminho de produção
 * fica intacta porque ela não foi tocada. (`fix` é exigido no topo do arquivo.)
 *
 * UMA PERGUNTA NÃO VIRA PATCH. "por que esse nó tem retry?" é dúvida, e a
 * resposta certa é uma frase, não uma alteração. O contrato de saída tem os dois
 * formatos e o prompt manda usar `resposta` também quando o pedido está ambíguo:
 * perguntar de volta é mais barato que remendar errado e mais honesto que
 * adivinhar. */

const ETAPAS_EDICAO = [
  { n: 1, nome: "Ler o pedido", para: false },
  { n: 2, nome: "Remendar",     para: false },
  { n: 3, nome: "Validar",      para: false },
  { n: 4, nome: "Simular",      para: false },
  { n: 5, nome: "Decidir",      para: true  }
];

/* Quantas versões anteriores o arquivo do projeto guarda. Não é cache: é o que
 * faz o desfazer existir. O teto é o que impede um projeto muito editado de
 * virar um arquivo de dezenas de megabytes de fluxos velhos. */
const MAX_VERSOES = 10;

async function abrirEdicao(slug) {
  const p = await lerProjeto(slug);
  if (!p) { const e = new Error("projeto não encontrado"); e.status = 404; throw e; }
  if (!p.wf) { const e = new Error("este projeto não tem fluxo para editar"); e.status = 409; throw e; }
  if ([...sessions.values()].some(s => s.status === "correndo")) { const e = new Error("já existe uma construção ou edição em andamento"); e.status = 409; throw e; }
  if (!fs.existsSync(CLAUDE_BIN)) throw new Error("CLI do Claude não encontrado em " + CLAUDE_BIN);

  const id = "t" + crypto.randomBytes(6).toString("hex");
  const dir = path.join(RUNS_DIR, id);
  await fsp.mkdir(dir, { recursive: true });

  /* A sessão de edição usa o MESMO formato de id e o mesmo mapa `sessions` da
   * construção, então o SSE, o snapshot e o reattach por `?s=` funcionam sem uma
   * linha de rota nova. O que muda é `modo`, e é ele que a tela lê para saber que
   * está numa conversa sobre um fluxo pronto e não numa esteira de sete etapas. */
  const s = {
    id, gen: 1, dir, modo: "edicao",
    criadoEm: new Date().toISOString(),
    ideia: p.ideia || "", nivel: p.nivel || "sei o básico",
    status: "aguardando", etapa: 1,
    etapas: ETAPAS_EDICAO.map(e => ({ ...e, estado: "pendente" })),
    chat: Array.isArray(p.chat) ? p.chat.slice() : [],
    entendi: null, titulo: p.titulo || null, perguntas: [],
    achados: Array.isArray(p.achados) ? p.achados.slice() : [],
    servicos: [], respostas: Array.isArray(p.respostas) ? p.respostas.slice() : [],
    rodadaEntrevista: 1,
    doc: null, ingredientes: p.ingredientes || { nos: [], credenciais: [] },
    wf: p.wf, wfParcial: null, provenance: p.provenance || {},
    gates: p.gates || null, sandbox: p.sandbox || null,
    sementes: p.sementes || null, sementesOrigem: p.sementesOrigem || null,
    fantasma: p.fantasma || null, report: p.report || null,
    // `null` no arquivo quer dizer "salvo antes de existir classificação", que
    // não é a mesma coisa que "não é agente" — `undefined` é o que os portões
    // de agente leem como ausência.
    ehAgente: p.ehAgente === null ? undefined : p.ehAgente,
    escolhasCred: Array.isArray(p.escolhasCred) ? p.escolhasCred.slice() : [],
    projetoSlug: p.slug, projetoTitulo: p.titulo,
    proposta: null, custoGravado: 0,
    custo: [], log: [], versao: 0
  };
  sessions.set(id, s);
  s.catalogo = await catalog.get({});
  /* Falha mole: sem os pacotes baixados `s.esquema` fica nulo, o portão de
   * esquema não roda e o Tester se comporta como antes desta feature. O que NÃO
   * pode acontecer é o build parar porque um esquema não estava lá. */
  s.esquema = esquema.lerCache();
  diz(s, "abri «" + (p.titulo || p.slug) + "» para conversar: " + (p.wf.nodes || []).length + " nós");
  return { id };
}

/* Um pedido do Kauan sobre o fluxo aberto. Texto novo sempre cancela o que
 * estiver correndo (mesma regra da construção: a geração muda e todo emit
 * confere antes de agir) — mudar de ideia no meio não pode custar uma espera. */
async function pedirEdicao(id, texto) {
  const s = sessions.get(id);
  if (!s || s.modo !== "edicao") { const e = new Error("sessão de edição não encontrada"); e.status = 404; throw e; }
  const t = so(texto).slice(0, 2000);
  if (!t) { const e = new Error("escreva o que você quer"); e.status = 400; throw e; }

  /* Desempate de credencial é resolvido AQUI, antes de gastar uma sessão do
   * CLI: são dois nomes para comparar, e mandar isso para o modelo custaria
   * dezenas de segundos e alguns centavos para escolher entre duas strings.
   * A interceptação é estrita de propósito (ver `interpretarEscolhaCred`) —
   * um falso positivo engoliria um pedido de construção de verdade. */
  const cred = interpretarEscolhaCred(t, s.credLigacao);
  if (cred) {
    s.chat.push({ quem: "voce", texto: t, at: new Date().toISOString() });
    let resposta;
    if (cred.escolha) {
      escolherCredencial(id, cred.escolha.id);
      const quantos = ((s.credLigacao && s.credLigacao.ligados) || []).filter(l => l.porEscolha).length;
      resposta = "Anotado: quando for `" + cred.escolha.tipo + "`, uso a **" + cred.escolha.nome + "**. " +
        (quantos ? quantos + " nó(s) passaram a sair já ligados no JSON. " : "") +
        "Isto é só um ponteiro para uma credencial que já existe na sua conta — nenhum segredo passou por aqui, " +
        "e criar credencial continua sendo no n8n.";
    } else if (cred.ambiguo) {
      resposta = "Mais de uma bate com o que você escreveu: " +
        cred.ambiguo.map(c => c.nome + " (`" + c.tipo + "`)").join(", ") +
        ". Escreve o nome inteiro, ou clica na que você quer na lista de credenciais aqui em cima.";
    } else {
      resposta = "Não achei essa credencial entre as que os seus fluxos usam. As que servem para os nós " +
        "em branco são: " + cred.naoAchei.map(c => c.nome + " (`" + c.tipo + "`)").join(", ") +
        ". Se a que você quer não está aí, ela precisa ser criada no n8n primeiro — " +
        "o cockpit só enxerga credencial que algum fluxo seu já referencia.";
    }
    s.chat.push({ quem: "tester", texto: resposta, at: new Date().toISOString() });
    emit(s, "chat", { chat: s.chat });
    return { id: s.id };
  }

  s.gen++;
  const gen = s.gen;
  try { if (s.filho) s.filho.kill(); } catch { /* já morreu */ }
  s.proposta = null;
  s.erro = null;
  s.chat.push({ quem: "voce", texto: t, at: new Date().toISOString() });
  s.status = "correndo";
  s.etapas = ETAPAS_EDICAO.map(e => ({ ...e, estado: "pendente" }));
  emit(s, "chat", { chat: s.chat });
  rodadaEdicao(s, gen, t);
  return { id: s.id };
}

async function rodadaEdicao(s, gen, pedido) {
  try {
    etapa(s, 1, "correndo");
    await escreverContextoEdicao(s);

    let correcoes = null;
    for (let rodada = 1; rodada <= MAX_ROUNDS; rodada++) {
      if (!vivo(s, gen)) return;
      if (estourouTeto(s)) {
        s.erro = "parei por custo: esta sessão passou do teto de US$" + TETO_USD;
        diz(s, s.erro, "warn"); break;
      }
      diz(s, "pensando no pedido (rodada " + rodada + " de " + MAX_ROUNDS + ")");

      const r = await rodar(s, {
        rotulo: "edicao-r" + rodada, prompt: promptEdicao(s, pedido, correcoes),
        ferramentas: "Read,Write,Glob,Grep", cwd: s.dir,
        modelo: MODELO_BUILD, comRede: false,
        tetoMs: s.ehAgente ? ROUND_TIMEOUT_AGENTE_MS : ROUND_TIMEOUT_MS
      });
      if (!vivo(s, gen)) return;

      // O arquivo manda; o texto da sessão é a rede quando ela responde no chat
      // em vez de escrever. Ler os dois evita queimar uma rodada por formato.
      let j = null;
      try { j = JSON.parse(await fsp.readFile(dentro(s.dir, "resposta.json"), "utf8")); }
      catch { j = jsonDoTexto(r.texto); }
      if (!j || typeof j !== "object" || Array.isArray(j)) {
        correcoes = "não consegui ler `resposta.json` como JSON" + (r.erro ? " (" + r.erro + ")" : "");
        diz(s, correcoes, "warn"); continue;
      }

      if (j.tipo === "resposta" || (!j.patch && j.texto)) {
        const txt = so(j.texto).slice(0, 4000);
        if (!txt) { correcoes = "`resposta.json` veio com `tipo: resposta` e `texto` vazio"; continue; }
        s.chat.push({ quem: "tester", texto: txt, at: new Date().toISOString() });
        s.status = "aguardando";
        etapa(s, 1, "ok", "respondi sem mexer no fluxo");
        emit(s, "chat", { chat: s.chat });
        emit(s, "espera", { etapa: 1 });
        return;
      }

      etapa(s, 2, "correndo");
      const alvo = aplicarRemendo(s.wf, j.patch);
      if (alvo.errors.length || !alvo.workflow) {
        correcoes = alvo.errors.map(e => "- " + e).join("\n") || "- o patch não produziu fluxo nenhum";
        diz(s, "o remendo não aplicou: " + alvo.errors.length + " problema(s)", "warn");
        continue;
      }

      etapa(s, 3, "correndo");
      const falhas = validar(alvo.workflow, s.catalogo, s.ehAgente, s.esquema);
      s.gatesProposta = { rodada, falhas, passou: !falhas.length };
      emit(s, "gates", { gatesProposta: s.gatesProposta });
      if (falhas.length) {
        correcoes = falhas.map(f => "- " + f).join("\n");
        diz(s, "o validador reprovou " + falhas.length + " ponto(s) do remendo", "warn");
        continue;
      }

      /* A simulação roda no CANDIDATO, não no fluxo salvo: a pergunta que a tela
       * responde é "o que este remendo produziria", e simular o fluxo antigo
       * responderia outra. O fluxo salvo continua intacto até o clique. */
      etapa(s, 4, "correndo");
      const fantasmaNovo = s.wf && agentes.recusaFantasma(alvo.workflow)
        ? agentes.recusaFantasma(alvo.workflow)
        : simulate(alvo.workflow, { seeds: s.sementes || {} });

      s.proposta = {
        pedido, rodada,
        resumo: so(j.resumo).slice(0, 400) || "remendo sem resumo",
        porque: so(j.porque).slice(0, 800) || null,
        wf: alvo.workflow,
        diff: fix.diffWorkflow(s.wf, alvo.workflow),
        gates: { rodada, falhas: [], passou: true },
        fantasma: fantasmaNovo,
        removidos: alvo.removidos
      };
      s.status = "aguardando";
      etapa(s, 5, "espera");
      emit(s, "proposta", { proposta: s.proposta });
      return;
    }

    s.erro = s.erro || "não consegui produzir um remendo que passasse nos portões em " + MAX_ROUNDS + " tentativas";
    s.status = "aguardando";
    etapa(s, 3, "falhou");
    emit(s, "fim", {});
  } catch (e) {
    s.erro = scrub(String(e && e.message || e));
    s.status = "aguardando";
    emit(s, "fim", {});
  }
}

/* O quarto verbo, e só ele, mora aqui. A remoção acontece ANTES de o
 * `applyPatch` rodar, porque um `rewire` na mesma leva costura o buraco que ela
 * abriu — e é por isso que o prompt exige as duas coisas juntas. As arestas que
 * apontavam para o nó removido são varridas de todo o documento: deixar uma
 * pendurada faria o portão reprovar com uma mensagem sobre conexão inválida, que
 * manda quem lê procurar um erro do modelo onde houve um erro nosso. */
function aplicarRemendo(orig, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { workflow: null, errors: ["`patch` não é um objeto JSON"], removidos: [] };
  }
  const errors = [];
  const pedidos = (Array.isArray(patch.removeNodes) ? patch.removeNodes : []).map(x => String(x || "")).filter(Boolean);
  let base = orig;
  let removidos = [];

  if (pedidos.length) {
    base = JSON.parse(JSON.stringify(orig));
    const existentes = new Set((base.nodes || []).map(n => String(n.name)));
    for (const nome of pedidos) if (!existentes.has(nome)) errors.push('removeNodes: o nó "' + nome + '" não existe — os nomes exatos estão em `nodes-index.md`');
    const fora = new Set(pedidos.filter(n => existentes.has(n)));
    removidos = [...fora];
    base.nodes = (base.nodes || []).filter(n => !fora.has(String(n.name)));
    base.connections = base.connections || {};
    for (const nome of fora) delete base.connections[nome];
    for (const outs of Object.values(base.connections)) {
      for (const [porta, ramos] of Object.entries(outs || {})) {
        outs[porta] = (ramos || []).map(ramo => (ramo || []).filter(c => !fora.has(String(c && c.node))));
      }
    }
  }

  const r = fix.applyPatch(base, {
    updateNodes: patch.updateNodes, addNodes: patch.addNodes, rewire: patch.rewire
  });
  /* "não muda nada" é verdade para os três verbos do claude-fix e mentira para
   * este patch: a remoção é a mudança. Sem este filtro, apagar um nó seria
   * reprovado com a mensagem de um patch vazio. */
  const errs = (r.errors || []).filter(e => !(removidos.length && /não muda nada/.test(e)));
  return { workflow: r.workflow || base, errors: [...errors, ...errs], removidos };
}

/* O que a sessão de edição lê do disco. Mesmo desenho do `escreverContexto` da
 * construção e pelo mesmo motivo: o fluxo inteiro no prompt estoura a linha de
 * comando do Windows muito antes de estourar o contexto do modelo. */
async function escreverContextoEdicao(s) {
  await fsp.writeFile(dentro(s.dir, "workflow.json"), JSON.stringify(s.wf, null, 2), "utf8");
  await fsp.writeFile(dentro(s.dir, "nodes-index.md"), fix.nodesIndex(s.wf), "utf8");

  const fatia = catalog.fatiaTexto(s.catalogo, (s.wf.nodes || []).map(n => n.type), 60000);
  await fsp.writeFile(dentro(s.dir, "catalogo.json"), JSON.stringify(
    { instancia: s.catalogo.instancia, geradoEm: s.catalogo.geradoEm, nodes: JSON.parse(fatia.texto) }, null, 2), "utf8");

  /* A conversa que produziu o fluxo. É o que impede o remendo de contradizer uma
   * decisão já tomada — sem isto o modelo reabre discussão fechada meses atrás,
   * com a diferença de que agora ele decide sozinho. */
  const linhas = ["# A conversa que produziu este fluxo", ""];

  /* O ESTADO antes da história. "Está funcionando?" é a pergunta mais comum de
   * uma conversa de edição, e a resposta honesta é feita de fatos que a sessão
   * não tinha: o que os portões verificaram, se o n8n aceitou o schema, o que a
   * simulação produziu ou recusou, e o que ainda está [PREENCHER]. Sem isto o
   * modelo deduzia tudo do JSON — acertava, mas gastava a resposta re-derivando
   * o que o cockpit já sabia. */
  linhas.push("## O estado deste fluxo agora", "");
  linhas.push("- Nós: " + (s.wf.nodes || []).length);
  if (s.gates) linhas.push("- Portões do cockpit: " + (s.gates.passou ? "TODOS PASSARAM (rodada " + s.gates.rodada + ")" : "reprovado"));
  if (s.sandbox) {
    linhas.push("- Cópia de teste no n8n: " + (s.sandbox.estado === "ok"
      ? "aceita pela instância (" + (s.sandbox.nome || "") + ") — prova que o SCHEMA é válido, nunca que o acesso funciona (ela roda sem credencial)"
      : s.sandbox.estado));
  }
  if (s.fantasma) {
    linhas.push("- Simulação: " + (s.fantasma.ok
      ? "produziu resultado (o texto e o destino saem do fluxo; os dados são de exemplo)"
      : "recusada — " + (s.fantasma.recusa || "")));
  }
  const pend = acharPreencher(s.wf);
  if (pend.length) {
    linhas.push("- Marcadores [PREENCHER] ainda abertos (" + pend.length + "):");
    for (const p of pend.slice(0, 20)) linhas.push("  - " + p);
    if (pend.length > 20) linhas.push("  - (e mais " + (pend.length - 20) + ")");
  } else {
    linhas.push("- Nenhum [PREENCHER] pendente.");
  }
  linhas.push("- O que NENHUMA dessas checagens prova: que o fluxo roda de verdade. A API pública do n8n não tem endpoint de execução — só uma execução real, disparada lá, prova funcionamento.");
  linhas.push("");
  for (const m of (s.chat || []).slice(-40)) {
    if (m.quem === "voce" && m.texto) linhas.push("**Kauan:** " + m.texto, "");
    else if (m.entendi) linhas.push("**O que ficou entendido:** " + JSON.stringify(m.entendi), "");
    else if (m.texto) linhas.push("**Tester:** " + m.texto, "");
  }
  if ((s.respostas || []).length) {
    linhas.push("## Respostas explícitas da entrevista", "");
    for (const r of s.respostas) linhas.push("- " + r.q + "\n  -> " + r.r);
  }
  if (s.report) linhas.push("", "## Relatório da construção", "", String(s.report).slice(0, 6000));
  await fsp.writeFile(dentro(s.dir, "CONVERSA.md"), linhas.join("\n"), "utf8");
}

/* Onde o fluxo ainda diz [PREENCHER]. Caminho "nó > parâmetro", porque é isso
 * que responde "o que falta eu configurar" sem abrir o JSON. */
function acharPreencher(wf) {
  const out = [];
  for (const nd of (wf && wf.nodes) || []) {
    (function anda(v, caminho) {
      if (typeof v === "string") {
        if (v.includes("[PREENCHER]")) out.push(nd.name + " > " + caminho);
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => anda(x, caminho + "[" + i + "]")); return; }
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) anda(x, caminho ? caminho + "." + k : k);
    })(nd.parameters || {}, "");
  }
  return out;
}

function promptEdicao(s, pedido, correcoes) {
  return [
    "Você conversa com a pessoa sobre um fluxo de n8n que ELA JÁ TEM. O fluxo existe, está salvo, e",
    "ninguém vai reconstruí-lo: no máximo você o remenda.",
    "",
    REGISTRO[s.nivel] || REGISTRO["sei o básico"],
    "",
    "LEIA ANTES DE RESPONDER, no diretório atual:",
    "  `workflow.json`  — o fluxo como ele está hoje",
    "  `nodes-index.md` — nome exato · tipo · saídas de cada nó",
    "  `catalogo.json`  — os tipos de nó que esta instância aceita, com versões e forma dos parâmetros",
    "  `CONVERSA.md`    — o ESTADO do fluxo (portões, cópia de teste, simulação, o que falta preencher)",
    "                     e como ele foi decidido. Decisão que já está aqui NÃO se reabre por conta própria.",
    "",
    "O QUE VOCÊ SABE E O QUE NÃO SABE — responda dentro disso, nunca além:",
    "- Você sabe tudo que está nesses arquivos: cada nó, cada expressão, cada decisão da conversa.",
    "- Você NÃO executa nada e NÃO enxerga a instância dela. \"Está funcionando?\" tem uma resposta",
    "  honesta em três partes: o que já foi VERIFICADO (portões, schema aceito pela cópia de teste,",
    "  simulação), o que FALTA ela fazer ([PREENCHER], credencial, ativar), e o que SÓ uma execução",
    "  real no n8n prova. Nunca diga que rodou; nunca diga que funciona — diga o que está conferido.",
    "- Pedido grande também é remendo: dá para acrescentar um subsistema inteiro em um patch",
    "  (vários `addNodes` + `rewire`). Não recuse por tamanho; recuse por ambiguidade.",
    "",
    "O QUE ELA PEDIU AGORA:",
    "«" + pedido + "»",
    "",
    "Escreva UM arquivo `resposta.json` no diretório atual, em UM destes dois formatos.",
    "",
    "1) É PERGUNTA, ou o pedido está ambíguo, ou você discorda e quer argumentar:",
    '{ "tipo": "resposta", "texto": "..." }',
    "   Nada muda no fluxo. Perguntar de volta é mais barato que remendar errado — use este formato",
    "   sempre que remendar exigiria adivinhar qual das duas coisas ela quis dizer.",
    "   COMO ESCREVER `texto` — isto vira uma bolha de chat, não um relatório:",
    "   - parágrafos curtos separados por linha em branco; lista numerada quando forem passos;",
    "   - **negrito** no que decide, `código` para nome de nó e de campo;",
    "   - responda O QUE FOI PERGUNTADO primeiro, em uma frase; o detalhe vem depois;",
    "   - até ~1500 caracteres, salvo se ela pedir detalhe. Parede de texto não se lê.",
    "",
    "2) É MUDANÇA, e você sabe exatamente qual:",
    '{ "tipo": "patch",',
    '  "resumo": "uma frase dizendo o que muda, em português, para ela ler antes de aprovar",',
    '  "porque": "por que isto atende o pedido (2 a 4 frases)",',
    '  "patch": {',
    '    "updateNodes": [ { "name": "nome exato", "parameters": {...}, "typeVersion": 2 } ],',
    '    "addNodes":    [ { "name": "...", "type": "...", "typeVersion": 1, "position": [x, y], "parameters": {...} } ],',
    '    "removeNodes": [ "nome exato" ],',
    '    "rewire":      { "nome do nó": { "main": [[{ "node": "destino", "type": "main", "index": 0 }]] } }',
    "  } }",
    "",
    "REGRAS DO PATCH — o cockpit aplica em código, e o que estiver fora daqui é recusado por nome:",
    "- `updateNodes` só altera: parameters, typeVersion, position, disabled, notes, notesInFlow,",
    "  alwaysOutputData, executeOnce, retryOnFail, maxTries, waitBetweenTries, onError. Nunca `name`, nunca `type`.",
    "- Nenhuma chave `credentials`, em nó nenhum, nem novo nem existente. Quem liga credencial é ela, no editor do n8n.",
    "- Nenhuma chave `active`, em lugar nenhum.",
    "- `type` de nó novo SÓ pode ser um tipo que está em `catalogo.json`; serviço sem nó dedicado vira",
    "  `n8n-nodes-base.httpRequest`. `typeVersion` é obrigatório e tem que ser uma das versões de lá.",
    "- `rewire` substitui as saídas INTEIRAS do nó citado. Não existe merge parcial: escreva todas as saídas dele.",
    "- Tirar um nó do caminho é `removeNodes` MAIS o `rewire` que costura o buraco. Remover sem religar",
    "  deixa o fluxo partido, e o validador reprova.",
    "- Nome de nó novo em snake_case e em português, no estilo dos que já estão lá.",
    "- Mexa no MÍNIMO de nós que resolve o pedido. Nó que o pedido não citou e não depende dele não entra no patch.",
    "",
    "O fluxo simulado vale mais quando as expressões cabem no que o cockpit sabe avaliar:",
    "  {{ $json.campo }} · {{ $json.a?.b }} · {{ $('Nome do Nó').item.json.campo }} · {{ $now }} · {{ $today }} · || 'padrão'",
    "Fora disso o campo aparece como «não simulada». Prefira `Set` com expressão simples a `Code`.",
    "",
    "Tudo em português do Brasil. Não escreva nenhum outro arquivo além de `resposta.json`.",
    correcoes
      ? ["", "A SUA TENTATIVA ANTERIOR FOI REPROVADA. Corrija exatamente isto e escreva `resposta.json` de novo:", correcoes].join("\n")
      : ""
  ].filter(Boolean).join("\n");
}

/* A decisão. É o único ponto em que o arquivo do projeto muda — e ele guarda a
 * versão anterior inteira, porque desfazer existe em todo caminho de escrita
 * deste código e não vai faltar justo no que a pessoa usa mais. */
async function decidirEdicao(id, aplicar) {
  const s = sessions.get(id);
  if (!s || s.modo !== "edicao") { const e = new Error("sessão de edição não encontrada"); e.status = 404; throw e; }
  if (!s.proposta) { const e = new Error("não há remendo esperando decisão"); e.status = 409; throw e; }
  const p = s.proposta;

  if (!aplicar) {
    s.chat.push({ quem: "tester", texto: "Descartei este remendo. O fluxo salvo continua exatamente como estava.", at: new Date().toISOString() });
    s.proposta = null;
    etapa(s, 5, "ok", "descartado");
    emit(s, "chat", { chat: s.chat });
    emit(s, "proposta", { proposta: null });
    return { aplicado: false };
  }

  const anterior = s.wf;
  s.wf = p.wf;
  s.provenance = proveniencia(s, s.wf);
  s.gates = p.gates;
  s.fantasma = p.fantasma;
  s.chat.push({ quem: "tester", texto: p.resumo, at: new Date().toISOString() });

  /* O Kauan aceitou um patch: é ele corrigindo o modelo, nas coordenadas exatas
   * de que uma lição precisa. O filtro é o que faz isso prestar — só entra
   * mudança de FORMA. Trocar o canal do Slack, o telefone ou o id da planilha é
   * ele dizendo o que quer, não corrigindo um erro meu, e virar lição disso seria
   * transformar a base num diário de preferências. */
  try {
    const novas = licoes.registrar(licoes.daEdicao({
      antes: anterior, depois: s.wf, ondeMedido: "edicao:" + (s.projetoSlug || s.id)
    }));
    if (novas.length) diz(s, "aprendi " + novas.length + " lição(ões) com esta correção — revise com `node licoes.js`");
  } catch (e) { diz(s, "não consegui registrar as lições da edição: " + String(e && e.message), "warn"); }

  await estreitarCredenciais(s, s.wf);
  // A cópia de teste roda DEPOIS do aceite: é escrita no n8n, e escrever por
  // conta de uma proposta que pode ser descartada seria efeito sem decisão.
  await validarEProvar(s);
  const salvo = await salvarEdicao(s, anterior, p);

  s.proposta = null;
  etapa(s, 5, "ok", "aplicado e salvo");
  emit(s, "wf", { wf: s.wf, provenance: s.provenance });
  emit(s, "fantasma", { fantasma: s.fantasma, sementes: s.sementes, sementesOrigem: s.sementesOrigem });
  emit(s, "chat", { chat: s.chat });
  emit(s, "proposta", { proposta: null });
  return { aplicado: true, slug: s.projetoSlug, versoes: salvo.versoes };
}

async function salvarEdicao(s, anterior, p) {
  const proj = await lerProjeto(s.projetoSlug);
  if (!proj) { const e = new Error("o arquivo do projeto sumiu do disco"); e.status = 409; throw e; }

  const versoes = Array.isArray(proj.versoes) ? proj.versoes : [];
  versoes.unshift({ em: new Date().toISOString(), pedido: p.pedido, resumo: p.resumo, wf: anterior });

  proj.versoes = versoes.slice(0, MAX_VERSOES);
  proj.wf = s.wf;
  proj.provenance = s.provenance;
  proj.chat = s.chat;
  proj.gates = s.gates;
  proj.sandbox = s.sandbox;
  proj.fantasma = s.fantasma;
  proj.achados = s.achados;
  proj.ingredientes = s.ingredientes;
  proj.escolhasCred = s.escolhasCred || [];
  proj.editadoEm = new Date().toISOString();

  /* Só o DELTA desta sessão entra no total. Somar `s.custo` inteiro a cada
   * aceite cobraria o segundo remendo pelo preço do primeiro mais o dele. */
  const gasto = s.custo.reduce((a, c) => a + (c.usd || 0), 0);
  proj.custoTotal = +((proj.custoTotal || 0) + Math.max(0, gasto - (s.custoGravado || 0))).toFixed(4);
  s.custoGravado = gasto;

  await gravarProjeto(proj);
  return { versoes: proj.versoes.length };
}

async function gravarProjeto(proj) {
  const alvo = dentro(PROJETOS_DIR, proj.slug + ".json");
  const tmp = alvo + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(proj, null, 2), "utf8");
  await fsp.rename(tmp, alvo);
}

/* Desfazer é uma TROCA, não um descarte: a versão que sai de cena entra no lugar
 * da que voltou. Assim desfazer de novo refaz, e nenhuma das duas some. */
async function desfazerEdicao(slug) {
  const proj = await lerProjeto(slug);
  if (!proj) { const e = new Error("projeto não encontrado"); e.status = 404; throw e; }
  const versoes = Array.isArray(proj.versoes) ? proj.versoes : [];
  if (!versoes.length) { const e = new Error("este projeto não tem versão anterior guardada"); e.status = 409; throw e; }

  const v = versoes.shift();
  versoes.unshift({
    em: new Date().toISOString(),
    pedido: "desfeito: " + (v.pedido || "edição sem pedido registrado"),
    resumo: "esta é a versão que estava valendo antes de você desfazer — desfazer de novo traz ela de volta",
    wf: proj.wf
  });
  proj.versoes = versoes.slice(0, MAX_VERSOES);
  proj.wf = v.wf;
  proj.editadoEm = new Date().toISOString();
  await gravarProjeto(proj);

  // A sessão aberta sobre este projeto, se houver, tem que ver o mesmo fluxo —
  // senão o próximo remendo sai de um documento que já não é o salvo.
  for (const s of sessions.values()) {
    if (s.modo === "edicao" && s.projetoSlug === slug) {
      s.wf = proj.wf; s.proposta = null;
      s.chat.push({ quem: "tester", texto: "Desfeito. O fluxo voltou para a versão anterior.", at: new Date().toISOString() });
      emit(s, "wf", { wf: s.wf, provenance: s.provenance });
      emit(s, "chat", { chat: s.chat });
    }
  }
  return { slug, restaurada: v.em || null, versoes: proj.versoes.length };
}

/* ------------------------------------------------------------------- API */

/* A VERSÃO DO TESTER, numa frase.
 *
 * Não é versão de código — é da BASE: o que ele sabe na hora de construir. A
 * gramática do n8n, o doc de agentes, o esquema dos nós e as lições em curadoria
 * mudam o fluxo que sai do build sem mudar uma linha de código, e sem carimbo
 * "melhorou" é impressão: não há como comparar um fluxo construído hoje com um
 * de semana passada nem saber qual base produziu cada entrada do `blueprints`.
 *
 * Sobe `n` quando muda o que ele SABE, não quando muda como ele desenha; `nota`
 * diz o que entrou, em poucas palavras. A menor conta rodadas de conhecimento a
 * partir de 2026-08-12, que é quando o carimbo passou a existir — antes disso
 * não há número honesto para atribuir.
 *
 * Vem do servidor de propósito. Node não recarrega este arquivo: um processo
 * velho serve a base velha, e a tela só consegue dizer isso se o número vier de
 * quem está rodando, não de uma constante embutida na página.
 *
 * MORA EM `versao.json`, NÃO AQUI. O job diário do `novidades.js` sobe a menor
 * sozinho quando entra novidade, e um robô editando `.js` é uma classe de risco
 * que editar dados não tem: uma escrita torta em JSON estraga um campo, a mesma
 * escrita torta em código derruba o servidor inteiro. Lido a cada chamada, sem
 * cache: é uma leitura de 100 bytes, e cachear faria o número na tela ficar
 * velho justamente depois de uma atualização — que é o único momento em que
 * alguém olha para ele. */
const VERSAO_ARQ = path.join(__dirname, "versao.json");
const VERSAO_FALLBACK = { n: "base ?", em: null, nota: "o arquivo `versao.json` não foi lido" };

function lerVersao() {
  try {
    const v = JSON.parse(fs.readFileSync(VERSAO_ARQ, "utf8"));
    if (!v || typeof v.n !== "string") return VERSAO_FALLBACK;
    return { n: v.n, em: v.em || null, nota: v.nota || null };
  } catch { return VERSAO_FALLBACK; }
}

function status() {
  return {
    versao: lerVersao(),
    cliEncontrado: fs.existsSync(CLAUDE_BIN), cli: CLAUDE_BIN,
    n8nConfigurado: n8n.configured, instancia: n8n.instance,
    sandbox: SANDBOX_ON, tetoUsd: TETO_USD,
    modelos: { conversa: MODELO_CONVERSA, construcao: MODELO_BUILD },
    // Ausência é a garantia: a allowlist não tem chave de API, então não existe
    // caminho de cobrança fora do plano.
    autenticacao: process.env.ANTHROPIC_API_KEY ? "há ANTHROPIC_API_KEY no ambiente, mas ela NÃO é repassada" : "plano (OAuth), sem chave de API",
    // Sem o doc o Tester ainda constrói agente, e constrói pior. A tela precisa
    // poder dizer isso antes do build, não depois.
    docAgentes: agentes.docStatus(),
    /* A gramática vale para TODO build, não só para agente — então a ausência
     * dela é uma notícia maior que a do doc de agentes. Mesma forma de resposta,
     * de propósito: a tela já sabe desenhar `docStatus`. */
    docGramatica: gramatica.docStatus(),
    /* O esquema dos nós. Três estados, nunca dois — a lição do `docAgentes`: um
     * campo ausente jamais pode cair no galho negativo, porque "não baixei os
     * pacotes" e "esse nó não existe" levam a decisões opostas. Quem lê isto na
     * tela tem que poder dizer qual dos dois é. */
    /* `resumo()`, nunca `lerCache()`: este objeto é montado a cada poll da tela
     * de abertura (4s) e `lerCache()` faz `JSON.parse` de 9,4MB — medido, a rota
     * respondia em ~190ms de CPU bloqueante num servidor de uma thread que
     * também segura SSE. O resumo tem cache por mtime. */
    esquema: esquema.resumo(),
    /* As lições esperando curadoria. Facts only: contagem por estado e por
     * fonte. O que fazer com `aRevisar > 0` é julgamento da tela — e sem esta
     * contagem em algum lugar visível, a base aprende e ninguém nunca olha, que é
     * o mesmo que não aprender. */
    licoes: licoes.resumo(),
    emAndamento: [...sessions.values()].some(s => s.status === "correndo"),
    /* A sessão viva, para a tela de abertura desenhar o card "em construção".
     * Sair da página no meio de um build sempre foi seguro — a sessão mora no
     * servidor e `?s=` reatacha — mas era um caminho que só existia para quem
     * soubesse da URL. Fatos apenas: as etapas com estado; a porcentagem é
     * julgamento e é a tela quem a deriva. `correndo` ganha de `aguardando`
     * (um build ativo importa mais que uma entrevista esperando resposta), e
     * entre iguais vale a mais recente. */
    andamento: (() => {
      const vivas = [...sessions.values()].filter(s => s.status === "correndo" || s.status === "aguardando");
      if (!vivas.length) return null;
      vivas.sort((a, b) => (b.status === "correndo") - (a.status === "correndo") ||
        String(b.criadoEm).localeCompare(String(a.criadoEm)));
      const s = vivas[0];
      return {
        id: s.id, modo: s.modo || "construcao", status: s.status,
        titulo: s.titulo || s.projetoTitulo || null,
        ideia: String(s.ideia || "").slice(0, 140),
        etapa: s.etapa,
        etapas: (s.etapas || []).map(e => ({ n: e.n, nome: e.nome, estado: e.estado })),
        atividade: s.atividade || null,
        ehAgente: s.ehAgente === undefined ? null : s.ehAgente
      };
    })()
  };
}

async function iniciar({ ideia, nivel, bandeja }) {
  if ([...sessions.values()].some(s => s.status === "correndo")) { const e = new Error("já existe uma construção em andamento"); e.status = 409; throw e; }
  if (!fs.existsSync(CLAUDE_BIN)) throw new Error("CLI do Claude não encontrado em " + CLAUDE_BIN);
  if (!n8n.configured) throw new Error("n8n não configurado (.env)");

  const id = "t" + crypto.randomBytes(6).toString("hex");
  const dir = path.join(RUNS_DIR, id);
  await fsp.mkdir(dir, { recursive: true });

  const s = {
    id, gen: 1, dir, criadoEm: new Date().toISOString(),
    ideia: String(ideia).slice(0, 2000), nivel: String(nivel || "sei o básico"),
    status: "correndo", etapa: 1,
    // `pendente` (ainda não começou) e `espera` (parou e depende de você) são
    // estados diferentes. Usar o mesmo nome para os dois deixava as sete etapas
    // desenhadas como se todas estivessem esperando decisão.
    etapas: ETAPAS.map(e => ({ ...e, estado: "pendente" })),
    chat: [{ quem: "voce", texto: String(ideia).slice(0, 2000), at: new Date().toISOString() }],
    entendi: null, titulo: null, perguntas: [], achados: [], servicos: [], respostas: [], rodadaEntrevista: 1,
    doc: null, ingredientes: { nos: [], credenciais: [] }, wf: null, wfParcial: null, provenance: {},
    gates: null, sandbox: null, sementes: null, fantasma: null,
    anexos: [], anexosLidos: [],
    custo: [], log: [], versao: 0
  };
  sessions.set(id, s);

  /* A bandeja que a tela de abertura encheu antes de a sessão existir. Adotar é
   * mover o diretório para dentro da corrida — e o inventário sai do DISCO, não
   * do que a tela disse ter mandado: o que a sessão vai poder abrir é o que
   * realmente está lá. */
  if (bandeja) {
    try {
      const veio = await anexos.adotar(RUNS_DIR, bandeja, dir);
      if (veio) {
        s.anexos = await anexos.inventario(dir);
        await anexos.escreverIndice(dir, s.anexos);
        diz(s, "recebi " + s.anexos.length + " anexo(s) — vou olhar antes de perguntar");
      }
    } catch (err) {
      // Anexo perdido não derruba a construção: a ideia escrita continua válida
      // e a tela precisa saber que o material não chegou, em vez de a sessão
      // seguir calada sem ele.
      diz(s, "não consegui aproveitar os anexos: " + (err && err.message || err), "erro");
    }
  }

  s.catalogo = await catalog.get({});
  /* Falha mole: sem os pacotes baixados `s.esquema` fica nulo, o portão de
   * esquema não roda e o Tester se comporta como antes desta feature. O que NÃO
   * pode acontecer é o build parar porque um esquema não estava lá. */
  s.esquema = esquema.lerCache();
  etapa(s, 1, "correndo");
  entender(s, s.gen);
  return { id };
}

/* Anexar com a conversa já aberta. Grava e devolve o snapshot — e NÃO reinicia
 * etapa nenhuma: quem dispara a releitura é a mensagem que ela manda depois
 * ("olha esse print"), pelo caminho de texto livre que já existe. Separar as
 * duas coisas é o que permite arrastar três arquivos e falar uma vez, em vez de
 * a esteira reiniciar a cada arquivo solto. */
async function anexar(id, item) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }
  const r = await anexos.gravar(s.dir, item, s.anexos || []);
  // A categoria viaja no erro para a tela agrupar as recusas de um lote.
  if (!r.ok) { const e = new Error(r.motivo); e.status = 400; e.categoria = r.categoria || null; throw e; }
  s.anexos = [...(s.anexos || []), r.meta];
  await anexos.escreverIndice(s.dir, s.anexos);
  diz(s, "anexo recebido: " + r.meta.nome);
  emit(s, "anexos", { anexos: snapshot(s).anexos, anexosResumo: anexos.resumo(s.anexos) });
  return snapshot(s);
}

async function desanexar(id, arquivo) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }
  await anexos.remover(s.dir, arquivo);
  s.anexos = (s.anexos || []).filter(a => a.arquivo !== arquivo);
  await anexos.escreverIndice(s.dir, s.anexos);
  emit(s, "anexos", { anexos: snapshot(s).anexos, anexosResumo: anexos.resumo(s.anexos) });
  return snapshot(s);
}

/* Uma pergunta vinda do modelo é payload, não estrutura de dados confiável. Só
 * passa o que a tela sabe desenhar: `previa` dentro do conjunto de superfícies
 * que existem em `superficie()`, e `modelos` apenas para opções que realmente
 * estão em `opcoes` — um modelo órfão viraria uma prévia que nenhum clique
 * seleciona. */
const PREVIAS = new Set(["slack", "whatsapp", "email", "texto"]);

function limparPergunta(q) {
  const o = {
    q: String(q && q.q || "").slice(0, 300),
    porque: q && q.porque ? String(q.porque).slice(0, 300) : "",
    opcoes: (Array.isArray(q && q.opcoes) ? q.opcoes : [])
      .filter(x => typeof x === "string" && x.trim()).slice(0, 4).map(x => x.slice(0, 200))
  };
  const previa = String(q && q.previa || "").toLowerCase();
  const modelos = {};
  if (q && q.modelos && typeof q.modelos === "object" && !Array.isArray(q.modelos)) {
    for (const opt of o.opcoes) {
      const v = q.modelos[opt];
      if (typeof v === "string" && v.trim()) modelos[opt] = v.slice(0, 400);
    }
  }
  if (PREVIAS.has(previa) && Object.keys(modelos).length) { o.previa = previa; o.modelos = modelos; }
  return o;
}

/* O que sobrou em aberto quando a entrevista fecha. O valor vira uma suposição
 * DECLARADA — o cartão etiqueta, o `promptDesenhar` sabe que não foi confirmado
 * e marca o parâmetro com `[PREENCHER]`, e o achado põe a mesma decisão na lista
 * lateral, onde ela pode ser contestada. */
const ROTULO_ENTENDI = { quando: "quando", oQueFaz: "o que faz", resultado: "resultado", ondeChega: "onde chega" };
const SUPOSTO_PADRAO = "suposição: não foi dito, então segui com o padrão mais comum";

function fecharAberto(s) {
  const e = s.entendi || {};
  for (const [campo, rotulo] of Object.entries(ROTULO_ENTENDI)) {
    const t = String(e[campo] == null ? "" : e[campo]).trim();
    if (t && !/^n[ãa]o disse$/i.test(t)) continue;
    e[campo] = SUPOSTO_PADRAO;
    const texto = "«" + rotulo + "» ficou sem resposta e a entrevista fechou: construí com o padrão mais comum, " +
      "e o parâmetro que depender disso sai marcado para você preencher";
    if (!s.achados.some(a => a && a.texto === texto)) s.achados.push({ tipo: "risco", texto, fonte: "a-confirmar" });
  }
}

/* Quais anexos a sessão REALMENTE abriu.
 *
 * Sem isto, anexar é um ato de fé: a pessoa manda o print, a entrevista faz uma
 * pergunta que o print já respondia, e não há como saber se ele foi lido ou
 * ignorado. O `tool_use` do stream-json carrega o caminho, então a leitura é
 * fato observado — não promessa do prompt. A tela marca o chip do que foi
 * aberto, e um anexo que ninguém abriu fica visivelmente não aberto. */
function registrarLeituraAnexo(s, ev) {
  const alvo = String((ev && ev.input && ev.input.file_path) || "");
  if (!alvo) return;
  const norm = alvo.split(/[/\\]/).join("/");
  for (const a of s.anexos || []) {
    if (!norm.endsWith(a.arquivo) && !norm.endsWith("/" + a.nome)) continue;
    if ((s.anexosLidos || []).includes(a.arquivo)) return;
    s.anexosLidos = [...(s.anexosLidos || []), a.arquivo];
    emit(s, "anexos", { anexos: snapshot(s).anexos, anexosLidos: s.anexosLidos });
    return;
  }
}

async function entender(s, gen) {
  try {
    const r = await rodar(s, {
      rotulo: "conversa", prompt: promptEntender(s),
      /* `Glob` e `Grep` só quando há anexo, e não por economia: a cerca desta
       * sessão é a lista de ferramentas, e uma entrevista sem material nenhum
       * não tem o que procurar no disco. Com uma pasta de 200 arquivos as duas
       * são o que separa explorar de despejar — sem elas o modelo abriria
       * arquivo por arquivo até o contexto acabar. A cerca que importa continua
       * sendo `--disallowedTools`: sem Bash e sem rede, medido. */
      ferramentas: (s.anexos || []).length ? "Read,Glob,Grep" : "Read",
      cwd: s.dir, modelo: MODELO_CONVERSA, comRede: false,
      aoUsarFerramenta: ev => registrarLeituraAnexo(s, ev)
    });
    if (!vivo(s, gen)) return;
    const j = jsonDoTexto(r.texto);
    if (!j || !j.entendi) {
      s.erro = "não consegui entender a ideia" + (r.erro ? " (" + r.erro + ")" : "");
      s.status = "falhou"; etapa(s, 1, "falhou"); emit(s, "fim", {});
      return;
    }
    s.entendi = j.entendi;

    /* Agente ou automação. O modelo classifica; o texto da ideia é a rede quando
     * o campo falta. A decisão muda a entrevista, os tipos de nó que o modelo vê
     * na etapa 3, os portões da etapa 5 e a recusa da etapa 6 — por isso é
     * decidida aqui, uma vez, e não reavaliada em cada etapa. */
    const d = agentes.decidir({ tipoDoModelo: j.tipo, ideia: s.ideia });
    if (s.ehAgente !== d.ehAgente) {
      s.ehAgente = d.ehAgente;
      s.ehAgentePorque = d.porque;
      diz(s, d.ehAgente
        ? "tratando como agente conversacional (" + d.porque + "): a entrevista cobre buffer, mídia, voz, memória, tools e escalonamento"
        : "tratando como automação (" + d.porque + ")");
      if (d.ehAgente) {
        const st = agentes.docStatus();
        if (!st.encontrado) {
          s.achados.push({ tipo: "risco", texto: "não achei `tester-agentes.md`: vou construir sem o conhecimento de agentes desta instância, e o resultado tende a sair sem buffer e sem memória", fonte: "fato" });
          diz(s, "tester-agentes.md não encontrado — o agente sai sem o conhecimento medido", "warn");
        } else if (st.faltando.length) {
          diz(s, "tester-agentes.md sem o(s) bloco(s): " + st.faltando.join(", "), "warn");
        }
      }
    }

    if (typeof j.titulo === "string" && j.titulo.trim()) s.titulo = j.titulo.trim().slice(0, 80);
    s.perguntas = (Array.isArray(j.perguntas) ? j.perguntas.slice(0, PERGUNTAS_POR_RODADA) : []).map(limparPergunta);
    // O teto de rodadas é aplicado em código, não só pedido no prompt: na última
    // rodada o que sobrou vira suposição declarada, nunca mais uma pergunta.
    if ((s.rodadaEntrevista || 1) >= MAX_ENTREVISTAS) s.perguntas = [];
    // E entrevista fechada não pode deixar campo em "não disse": ninguém mais
    // vai perguntar e a construção segue mesmo assim. Aqui é código, não pedido
    // ao modelo, porque a tela precisa poder afirmar a diferença entre "ainda
    // vou perguntar" e "decidi sem você" mesmo quando o modelo não colaborar.
    if (!s.perguntas.length) fecharAberto(s);
    s.servicos = Array.isArray(j.servicos) ? j.servicos.slice(0, 5) : [];
    for (const a of (Array.isArray(j.achados) ? j.achados : []).slice(0, 6)) s.achados.push(a);
    s.chat.push({ quem: "tester", texto: null, entendi: s.entendi, perguntas: s.perguntas, at: new Date().toISOString() });
    s.status = "aguardando";
    etapa(s, 1, "espera");
    emit(s, "entendi", { entendi: s.entendi, perguntas: s.perguntas, achados: s.achados, servicos: s.servicos });
    emit(s, "espera", { etapa: 1 });
  } catch (e) {
    if (!vivo(s, gen)) return;                 // parada não é defeito — ver o catch da esteira
    s.erro = scrub(String(e && e.message || e)); s.status = "falhou"; emit(s, "fim", {});
  }
}

/* Parar no meio, como Ctrl+C num terminal.
 *
 * O portão já existia e nunca tinha sido ligado: `vivo()` testa
 * `s.status !== "cancelada"` desde o primeiro dia e NADA no codebase setava esse
 * status. Toda etapa já confere a geração antes de emitir, escrever ou saltar —
 * então cancelar é subir a geração e matar o filho, e a esteira para sozinha no
 * próximo `if (!vivo(...)) return`.
 *
 * NÃO é pausa, e não existe retomar. Quem quer continuar escreve no compositor,
 * que já reinicia da etapa afetada COM a correção junto; um "retomar" idêntico
 * refaria exatamente o que foi morto, pelo mesmo preço e pelo mesmo caminho.
 *
 * O que sobra na tela sobra de propósito: desenho, etapas concluídas, achados e
 * gasto continuam. Cancelar é parar de gastar, não apagar o que já foi pago. */
async function cancelar(id) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }
  if (s.status === "cancelada") return snapshot(s);   // idempotente: dois Esc não são dois cancelamentos
  if (s.status !== "correndo") {
    const e = new Error("esta sessão não está processando nada agora");
    e.status = 409; throw e;
  }

  s.gen++;                      // invalida tudo que estiver em voo
  s.status = "cancelada";       // e a partir daqui `vivo()` responde false
  s.perguntas = [];
  s.wfParcial = null;           // rascunho da corrida invalidada: desenhar de novo é começar do zero

  /* O status vem ANTES do kill de propósito: o `close` do filho lê `s.status`
   * para saber que o custo desta rodada não foi medido. Invertido, a rodada
   * entraria no ledger como se tivesse custado zero. */
  try { if (s.filho) s.filho.kill(); } catch { /* já morreu */ }

  const e = (s.etapas || []).find(x => x.n === s.etapa);
  if (e && e.estado === "correndo") etapa(s, s.etapa, "cancelada", "você parou aqui");
  diz(s, "cancelado por você", "warn");
  emit(s, "fim", {});
  /* Entra no ledger igual a uma que falhou: a corrida existiu e gastou. Uma
   * cancelada fora do registro faria a soma de gasto do painel mentir por baixo. */
  await gravarLedger(s);
  return snapshot(s);
}

/* Resposta do usuário. `seguir` é o portão da etapa 1; texto livre a qualquer
 * momento cancela o que está correndo e recomeça DAQUELA etapa — a geração
 * muda, e todo emit/escrita confere a geração antes de agir. */
async function responder(id, { texto, seguir, respostas }) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }

  /* Numa sessão de edição o compositor é o MESMO campo de texto, e mandar ele
   * para a máquina de etapas da construção reiniciaria uma entrevista que não
   * existe. Aqui ele é um pedido sobre o fluxo aberto. */
  if (s.modo === "edicao") { await pedirEdicao(id, texto); return snapshot(s); }

  /* As escolhas nos cartões de pergunta. Elas ACUMULAM entre rodadas — a rodada
   * 2 só carrega o que foi respondido agora, e substituir a lista jogaria fora
   * a rodada 1. O merge é por texto de pergunta: responder de novo à mesma
   * pergunta troca a resposta antiga, nunca duplica. */
  let novas = [];
  if (Array.isArray(respostas) && respostas.length) {
    novas = respostas
      .filter(r => r && typeof r.q === "string" && typeof r.r === "string")
      .slice(0, 20)
      .map(r => ({ q: r.q.slice(0, 300), r: r.r.slice(0, 200) }));
    if (novas.length) {
      const mapa = new Map((s.respostas || []).map(r => [r.q, r]));
      for (const r of novas) mapa.set(r.q, r);
      s.respostas = [...mapa.values()].slice(0, 24);
      s.chat.push({
        quem: "voce",
        texto: novas.map(r => r.r).join(" · "),
        escolhas: true,
        at: new Date().toISOString()
      });
      emit(s, "chat", { chat: s.chat });
    }
  }

  /* Respostas SEM "pode seguir" e sem texto livre são a rodada seguinte da
   * entrevista: o modelo digere o que foi respondido e pergunta o que ainda
   * falta — ou devolve perguntas vazias, que é o que libera o portão. */
  if (novas.length && !seguir && !texto && s.etapa === 1) {
    s.rodadaEntrevista = (s.rodadaEntrevista || 1) + 1;
    s.status = "correndo";
    s.perguntas = [];
    etapa(s, 1, "correndo");
    entender(s, s.gen);
    return snapshot(s);
  }

  if (texto) {
    s.chat.push({ quem: "voce", texto: String(texto).slice(0, 2000), at: new Date().toISOString() });
    s.gen++;                                  // invalida o que estiver correndo
    try { if (s.filho) s.filho.kill(); } catch { /* já morreu */ }
    s.status = "correndo";
    s.perguntas = [];
    s.wfParcial = null;                         // rascunho da corrida invalidada
    // Texto livre muda a ideia — a entrevista recomeça com direito a rodadas
    // novas, senão uma correção tardia herdaria um teto já gasto.
    s.rodadaEntrevista = 1;
    etapa(s, 1, "correndo");
    emit(s, "chat", { chat: s.chat });
    entender(s, s.gen);
    return snapshot(s);
  }

  if (seguir && s.etapa === 1) {
    s.status = "correndo";
    s.perguntas = [];
    etapa(s, 1, "feita");
    emit(s, "chat", { chat: s.chat });
    esteira(s);
    return snapshot(s);
  }

  if (seguir && s.etapa === 6) {
    etapa(s, 7, "correndo");
    s.exportado = true;
    s.status = "pronta";
    etapa(s, 7, "feita");
    emit(s, "fim", {});
    await gravarLedger(s);
    return snapshot(s);
  }
  return snapshot(s);
}

/* Re-simular com outra semente. Código local: sem modelo, sem custo, instantâneo.
 * É o laço de refino que o PLAN.md §6 promete de graça. */
function resimular(id, sementes) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }
  if (sementes && typeof sementes === "object") { s.sementes = sementes; s.sementesOrigem = "colada por você"; }
  rodarFantasma(s);
  return snapshot(s);
}

function pegar(id) { const s = sessions.get(id); return s ? snapshot(s) : null; }

function assinar(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
  return () => { const set = listeners.get(id); if (set) { set.delete(fn); if (!set.size) listeners.delete(id); } };
}

async function ledger() {
  try { return JSON.parse(await fsp.readFile(LEDGER, "utf8")); } catch { return []; }
}

module.exports = { status, iniciar, responder, cancelar, resimular, pegar, assinar, ledger, validar,
  anexar, desanexar,
  /* Para o job diário do `novidades.js`. A sessão avulsa mora aqui porque a
     cerca dela são os flags do `rodar()`, e uma segunda cópia deles noutro
     arquivo seria uma sessão sem cerca no dia em que as duas divergissem. */
  rodarAvulso, lerVersao, CLAUDE_BIN, MODELO_CONVERSA,
  salvarProjeto, listarProjetos, lerProjeto, lerProjetoParaTela, renomearProjeto, excluirProjeto, SANDBOX_PREFIX,
  listarLixeira, restaurarProjeto, excluirDaLixeira, esvaziarLixeira,
  checklistCredenciais, ligacaoCredenciais, interpretarEscolhaCred, escolherCredencial,
  parcialDeWrite,
  abrirEdicao, pedirEdicao, decidirEdicao, desfazerEdicao,
  // Puro e testável sem modelo: é ele que decide o que um patch pode fazer.
  aplicarRemendo, promptEdicao, acharPreencher,
  /* Expostos para `cancelar-test.js`. `sessions` é o mapa de verdade: o teste
   * monta uma sessão com um filho falso e chama a `cancelar` real, em vez de
   * reimplementar por fora a máquina de estados que ela mexe. `custoDaRodada` é
   * a regra do gasto cego, que de outro jeito só seria alcançável spawnando o
   * CLI — ou seja, cobrando do plano para rodar um teste. */
  sessions, custoDaRodada,
  /* Expostos para teste, junto do teto que eles têm que respeitar. São funções
   * puras, e o que se mede nelas é o tamanho: o prompt viaja em `-p` e a linha de
   * comando do Windows tem limite rígido. Um teste que remonta o prompt por fora
   * envelhece em silêncio — este mede o mesmo texto que vai para o CLI. */
  promptEntender, promptDesenhar, PROMPT_MAX,
  /* Exportado para teste: o que a sessão de construção lê do disco é a única
   * parte desta feature cuja falha é INVISÍVEL — um arquivo que não foi escrito
   * não dá erro, o modelo só constrói pior. `esquema-test.js` prova que os três
   * saem. */
  escreverContexto };
