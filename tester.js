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
const { simulate } = require("./simulate");

/* ------------------------------------------------------------------ config */

const RUNS_DIR   = path.join(__dirname, ".tester-runs");
const DOCS_DIR   = path.join(__dirname, ".cache-tester-docs");
const LEDGER     = path.join(__dirname, "blueprints.json");
const SANDBOX_PREFIX = "[SANDBOX tester] ";
const DOCS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ROUNDS  = 3;                       // rodadas de correção do JSON
const ROUND_TIMEOUT_MS = 6 * 60 * 1000;
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
function atividade(s, rotulo) { s.atividade = scrub(rotulo).slice(0, 160); emit(s, "atividade", { atividade: s.atividade }); }

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
    ideia: s.ideia, nivel: s.nivel,
    status: s.status, etapa: s.etapa, etapas: s.etapas, atividade: s.atividade || null,
    chat: s.chat, entendi: s.entendi, perguntas: s.perguntas, respostas: s.respostas || [], achados: s.achados,
    doc: s.doc ? { slug: s.doc.slug, servico: s.doc.servico, fontes: s.doc.fontes, texto: s.doc.texto } : null,
    pesquisaPulada: s.pesquisaPulada || null,
    ingredientes: s.ingredientes,
    wf: s.wf, provenance: s.provenance,
    gates: s.gates, sandbox: s.sandbox,
    sementes: s.sementes, sementesOrigem: s.sementesOrigem || null, fantasma: s.fantasma,
    custo: s.custo, custoTotal: +(s.custo.reduce((a, c) => a + (c.usd || 0), 0)).toFixed(4),
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

function rodar(s, { rotulo, prompt, ferramentas, cwd, modelo, comRede }) {
  return new Promise(resolve => {
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

    let buf = "", texto = "", usd = 0, erro = null;
    const timer = setTimeout(() => { erro = "tempo esgotado nesta etapa"; try { child.kill(); } catch { /* já morreu */ } }, ROUND_TIMEOUT_MS);

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
              const frase = c.text.trim().split(/\n+/).filter(Boolean).pop();
              if (frase) atividade(s, frase.slice(0, 140));
            } else if (c.type === "tool_use") {
              const alvo = (c.input && (c.input.file_path || c.input.query || c.input.url || c.input.pattern)) || "";
              atividade(s, c.name + (alvo ? " " + String(alvo).slice(0, 90) : ""));
              diz(s, "· " + c.name + " " + String(alvo).slice(0, 120));
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
      s.custo.push({ sessao: rotulo, usd, ms, comRede: !!comRede });
      emit(s, "custo", { custo: s.custo });
      resolve({ erro: erro || (code === 0 ? null : "a sessão saiu com código " + code), texto, usd, ms });
    });
  });
}

/* ------------------------------------------------------------------ prompts */

const REGISTRO = {
  "nunca mexi": "A pessoa nunca usou n8n. Explique em português simples, sem jargão. Nunca escreva nome de tipo de nó nem nome de campo técnico no texto que ela lê.",
  "sei o básico": "A pessoa já montou fluxo em n8n mas não conhece a API deste serviço. Pode citar nome de nó; explique o que for específico do serviço.",
  "sou técnico": "A pessoa é técnica. Seja direto e denso: nomes de nó, endpoints, campos. Nada de explicação básica."
};

function promptEntender(s) {
  const tipos = Object.keys(s.catalogo.nodes).slice(0, 40).join(", ");
  const creds = Object.keys(s.catalogo.credenciaisPorTipo).join(", ");
  return [
    "Você ajuda a transformar uma ideia em um fluxo de automação no n8n. Esta é a PRIMEIRA etapa: entender.",
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
    s.chat.filter(m => m.quem === "voce").slice(1).map(m => "Depois ela disse: «" + m.texto + "»").join("\n"),
    "",
    "Responda SÓ com um bloco ```json com esta forma exata:",
    "{",
    '  "entendi": { "quando": "...", "oQueFaz": "...", "resultado": "...", "ondeChega": "..." },',
    '  "servicos": ["mercado livre", "slack"],',
    '  "perguntas": [ { "q": "...", "porque": "...", "opcoes": ["...", "..."] } ],',
    '  "achados": [ { "tipo": "risco|falta|ideia", "texto": "...", "fonte": "fato|a-confirmar|sugestao" } ]',
    "}",
    "",
    "Regras que importam:",
    "- Campo de `entendi` que a pessoa NÃO disse: escreva exatamente \"não disse\". Nunca preencha com um palpite plausível.",
    "- No máximo 3 perguntas, e só o que muda o fluxo de verdade. Se não faltar nada, devolva [].",
    "- `opcoes` são respostas prontas para clicar: curtas, concretas, no máximo 4.",
    "- `servicos` são os serviços externos envolvidos, em minúsculas, nome comum.",
    "- `achados` com fonte \"fato\" só para o que dá para afirmar da lista acima. O resto é \"a-confirmar\" ou \"sugestao\".",
    "- Tudo em português do Brasil."
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

function promptDesenhar(s, correcoes) {
  const fatia = catalog.slice(s.catalogo, s.ingredientes.nos.map(n => n.tipo));
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
    "",
    s.doc ? "Ficha da API externa (leia o arquivo `doc.md` para o detalhe):\n" + s.doc.texto.slice(0, 4000) : "",
    "",
    "Tipos de nó desta instância, com as versões e a FORMA dos parâmetros que ela aceita:",
    "```json", JSON.stringify(fatia, null, 2).slice(0, 12000), "```",
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
    "- `typeVersion` tem que ser uma das versões listadas acima para aquele tipo.",
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
    "Escreva também `report.md`, começando com uma linha `**Resumo:** ...` de uma frase,",
    "seguida do que cada nó faz e do que ainda precisa ser preenchido à mão.",
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

function validar(wf, cat) {
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
    const conhecido = cat.nodes[nd.type];
    if (conhecido && nd.typeVersion !== undefined && !Object.keys(conhecido.versions).includes(String(nd.typeVersion))) {
      F(`o nó \`${nome}\` usa typeVersion ${nd.typeVersion}, e esta instância só tem ${Object.keys(conhecido.versions).join("/")} para \`${nd.type}\``);
    }
    if (/trigger|webhook|cron|schedule/i.test(String(nd.type))) gatilhos++;
    for (const [k, v] of Object.entries(nd.parameters || {})) {
      if (typeof v === "string" && SECRET_RE.some(re => new RegExp(re.source).test(v))) F(`o nó \`${nome}\` tem algo com cara de segredo no parâmetro \`${k}\``);
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
  for (const nd of wf.nodes) if (!ligados.has(nd.name) && wf.nodes.length > 1) F(`o nó \`${nd.name}\` está solto, sem entrada nem saída`);

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
  for (const t of ["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.httpRequest", "n8n-nodes-base.set", "n8n-nodes-base.if"]) {
    if (s.catalogo.nodes[t]) tipos.add(t);
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

async function desenhar(s, gen) {
  let correcoes = null;
  for (let rodada = 1; rodada <= MAX_ROUNDS; rodada++) {
    if (!vivo(s, gen)) return false;
    if (estourouTeto(s)) { s.erro = "parei por custo: a construção passou do teto de US$" + TETO_USD; diz(s, s.erro, "warn"); return false; }
    s.rodada = rodada;
    diz(s, "montando o fluxo (rodada " + rodada + " de " + MAX_ROUNDS + ")");

    const r = await rodar(s, {
      rotulo: "construcao-r" + rodada, prompt: promptDesenhar(s, correcoes),
      ferramentas: "Read,Write,Edit,Glob,Grep", cwd: s.dir,
      modelo: MODELO_BUILD, comRede: false
    });
    if (!vivo(s, gen)) return false;

    let wf = null;
    try { wf = JSON.parse(await fsp.readFile(dentro(s.dir, "workflow.json"), "utf8")); }
    catch (e) { correcoes = "não consegui ler `workflow.json`: " + String(e && e.message || e); diz(s, correcoes, "warn"); continue; }

    const falhas = validar(wf, s.catalogo);
    s.gates = { rodada, falhas, passou: !falhas.length };
    emit(s, "gates", { gates: s.gates });

    if (!falhas.length) {
      s.wf = wf;
      s.provenance = proveniencia(s, wf);
      // Agora dá para estreitar a lista de credenciais para os nós que o fluxo
      // REALMENTE usa. Na etapa 3 ela é um chute largo — `httpRequest` já foi
      // usado com meia dúzia de credenciais diferentes nos fluxos do Kauan, e
      // listar todas fazia a coluna virar parede de texto sem informação.
      await estreitarCredenciais(s, wf);
      try { s.report = (await fsp.readFile(dentro(s.dir, "report.md"), "utf8")).slice(0, 6000); } catch { s.report = null; }
      emit(s, "wf", { wf: s.wf, provenance: s.provenance });
      if (wf.nodes.some(n => n.type === "n8n-nodes-base.code")) {
        s.achados.push({ tipo: "risco", texto: "este fluxo usa um nó `Code`: eu não consigo simular o que ele devolve, então o resultado da etapa 6 não cobre esse trecho", fonte: "fato" });
      }
      return true;
    }
    correcoes = falhas.map(f => "- " + f).join("\n");
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
  for (const tipo of tipos) {
    let campos = null;
    try { const sch = await n8n.credentialSchema(tipo); campos = sch ? sch.obrigatorios : null; }
    catch { /* schema indisponível */ }
    creds.push({ tipo, visto: catalog.credencialVista(s.catalogo, tipo), campos });
  }
  s.ingredientes = { nos: s.ingredientes.nos, credenciais: creds, estreitada: true };
  emit(s, "ingredientes", { ingredientes: s.ingredientes });
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
  s.fantasma = s.wf ? simulate(s.wf, { seeds: s.sementes || {} }) : { ok: false, recusa: "não há fluxo para simular" };
  emit(s, "fantasma", { fantasma: s.fantasma, sementes: s.sementes, sementesOrigem: s.sementesOrigem });
}

const estourouTeto = s => s.custo.reduce((a, c) => a + (c.usd || 0), 0) >= TETO_USD;

/* ------------------------------------------------------------------ ledger */

async function gravarLedger(s) {
  let lista = [];
  try { lista = JSON.parse(await fsp.readFile(LEDGER, "utf8")); } catch { /* primeiro */ }
  if (!Array.isArray(lista)) lista = [];
  const entrada = {
    id: s.id, ideia: s.ideia, nivel: s.nivel,
    criadoEm: s.criadoEm, terminadoEm: new Date().toISOString(),
    status: s.status, etapaFinal: s.etapa,
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

/* ------------------------------------------------------------------- API */

function status() {
  return {
    cliEncontrado: fs.existsSync(CLAUDE_BIN), cli: CLAUDE_BIN,
    n8nConfigurado: n8n.configured, instancia: n8n.instance,
    sandbox: SANDBOX_ON, tetoUsd: TETO_USD,
    modelos: { conversa: MODELO_CONVERSA, construcao: MODELO_BUILD },
    // Ausência é a garantia: a allowlist não tem chave de API, então não existe
    // caminho de cobrança fora do plano.
    autenticacao: process.env.ANTHROPIC_API_KEY ? "há ANTHROPIC_API_KEY no ambiente, mas ela NÃO é repassada" : "plano (OAuth), sem chave de API",
    emAndamento: [...sessions.values()].some(s => s.status === "correndo")
  };
}

async function iniciar({ ideia, nivel }) {
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
    entendi: null, perguntas: [], achados: [], servicos: [], respostas: [],
    doc: null, ingredientes: { nos: [], credenciais: [] }, wf: null, provenance: {},
    gates: null, sandbox: null, sementes: null, fantasma: null,
    custo: [], log: [], versao: 0
  };
  sessions.set(id, s);

  s.catalogo = await catalog.get({});
  etapa(s, 1, "correndo");
  entender(s, s.gen);
  return { id };
}

async function entender(s, gen) {
  try {
    const r = await rodar(s, {
      rotulo: "conversa", prompt: promptEntender(s),
      ferramentas: "Read", cwd: s.dir, modelo: MODELO_CONVERSA, comRede: false
    });
    if (!vivo(s, gen)) return;
    const j = jsonDoTexto(r.texto);
    if (!j || !j.entendi) {
      s.erro = "não consegui entender a ideia" + (r.erro ? " (" + r.erro + ")" : "");
      s.status = "falhou"; etapa(s, 1, "falhou"); emit(s, "fim", {});
      return;
    }
    s.entendi = j.entendi;
    s.perguntas = Array.isArray(j.perguntas) ? j.perguntas.slice(0, 3) : [];
    s.servicos = Array.isArray(j.servicos) ? j.servicos.slice(0, 5) : [];
    for (const a of (Array.isArray(j.achados) ? j.achados : []).slice(0, 6)) s.achados.push(a);
    s.chat.push({ quem: "tester", texto: null, entendi: s.entendi, perguntas: s.perguntas, at: new Date().toISOString() });
    s.status = "aguardando";
    etapa(s, 1, "espera");
    emit(s, "entendi", { entendi: s.entendi, perguntas: s.perguntas, achados: s.achados, servicos: s.servicos });
    emit(s, "espera", { etapa: 1 });
  } catch (e) {
    s.erro = scrub(String(e && e.message || e)); s.status = "falhou"; emit(s, "fim", {});
  }
}

/* Resposta do usuário. `seguir` é o portão da etapa 1; texto livre a qualquer
 * momento cancela o que está correndo e recomeça DAQUELA etapa — a geração
 * muda, e todo emit/escrita confere a geração antes de agir. */
async function responder(id, { texto, seguir, respostas }) {
  const s = sessions.get(id);
  if (!s) { const e = new Error("sessão não encontrada"); e.status = 404; throw e; }

  /* As escolhas nos cartões de pergunta. Chegam junto do "pode seguir" e vão
   * para o prompt da construção — NÃO disparam uma rodada nova de entendimento.
   * A rodada custaria ~20s e uma cobrança de contexto para reescrever um cartão
   * que já está certo; o que falta não é entender de novo, é levar a resposta
   * adiante. Elas entram no chat como registro do que foi escolhido. */
  if (Array.isArray(respostas) && respostas.length) {
    s.respostas = respostas
      .filter(r => r && typeof r.q === "string" && typeof r.r === "string")
      .slice(0, 6)
      .map(r => ({ q: r.q.slice(0, 300), r: r.r.slice(0, 200) }));
    if (s.respostas.length) {
      s.chat.push({
        quem: "voce",
        texto: s.respostas.map(r => r.r).join(" · "),
        escolhas: true,
        at: new Date().toISOString()
      });
      emit(s, "chat", { chat: s.chat });
    }
  }

  if (texto) {
    s.chat.push({ quem: "voce", texto: String(texto).slice(0, 2000), at: new Date().toISOString() });
    s.gen++;                                  // invalida o que estiver correndo
    try { if (s.filho) s.filho.kill(); } catch { /* já morreu */ }
    s.status = "correndo";
    s.perguntas = [];
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

module.exports = { status, iniciar, responder, resimular, pegar, assinar, ledger, validar, SANDBOX_PREFIX };
