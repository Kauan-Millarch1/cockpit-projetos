/* ia.js — QUAL IA roda a rodada, e COM QUAL CREDENCIAL ela roda.
 *
 * O QUE ISTO EXISTE PARA RESOLVER. Hoje o cockpit é de um dono só: há um
 * `CLAUDE_BIN` global, um `findClaude()` duplicado em três arquivos, e o ambiente
 * do filho é montado por um allowlist que EXCLUI `ANTHROPIC_API_KEY` de propósito
 * — o custo sai do plano do dono e de nenhum outro lugar. Distribuído, cada
 * pessoa precisa escolher duas coisas que hoje não existem: qual CLI, e de quem é
 * a conta que paga.
 *
 * FATOS, NUNCA JUÍZO (a invariante da casa). Este módulo diz *"o modo `chave` foi
 * pedido e `ANTHROPIC_API_KEY` não está no ambiente"*, *"o provedor `codex` não
 * tem equivalente de `--setting-sources`"*, *"achei o binário em X"*. Ele não
 * escolhe cor, não escreve frase de diagnóstico sobre a conta de ninguém e não
 * decide se a tela mostra vermelho. Quem faz isso é o bloco de juízo da página.
 *
 * PURO NO NÚCLEO. `escolher`, `ambienteDaRodada` e `argumentosDaRodada` não têm
 * rede, não têm disco e não spawnam nada — mesmo motivo de `resolverAlvo`,
 * `custoDaRodada` e `esforcoDaRodada` serem puras: a política tem que ser
 * testável sem subir servidor e sem gastar cota. Só `descobrir()` toca disco, e
 * até ele recebe o `existe` por parâmetro, para o teste poder provar que um
 * provedor desconhecido NÃO chega a consultar o filesystem.
 *
 * ESTE ARQUIVO NÃO OBSERVA LOGIN. `integracoes.js` já pergunta ao CLI
 * (`claude auth status --json`) e já sabe `authMethod`/`subscriptionType`. Aqui
 * está a DECISÃO (qual provedor, qual modo); lá está a OBSERVAÇÃO (com o que ela
 * está de fato logada). Duas definições de "de onde sai o dinheiro" divergiriam
 * na primeira correção feita só de um lado.
 *
 * NENHUM SEGREDO SAI DAQUI. Um valor de chave nunca aparece em mensagem de erro,
 * nem truncado: todo eco de valor cru passa por `rotular()`. A única exceção é o
 * PROMPT dentro de `args`, que é o que o spawn precisa receber byte a byte — e
 * para isso existe `argumentosParaLog()`, que é o que pode ser impresso.
 */

"use strict";

/* A allowlist do ambiente do filho headless NÃO mora aqui. Ela mora no
 * `ambiente.js`, que é folha (não requer nada do projeto, então ninguém cria
 * ciclo lendo-o) e que já é a fonte única dos quatro sítios de spawn. Medido
 * 24/08/2026: aquela lista chegou a existir em CINCO arquivos idênticos — cinco
 * chances de deixarem de ser. Este arquivo seria a sexta.
 *
 * E o `ambiente.js` já escreveu, no próprio cabeçalho, o contrato deste módulo:
 * *"quando a distribuição ligar o modo chave de API, quem monta a exceção é o
 * adaptador de provedor, EXPLICITAMENTE, e para um provedor de cada vez"*. É
 * exatamente o que `ambienteDaRodada` faz lá embaixo, e é o único ponto do
 * repositório autorizado a acrescentar uma chave de API a um ambiente headless. */
const ambiente = require("./ambiente.js");

/* ══════════════════════════════════════════════════ os provedores, fechados ══
 *
 * Lista FECHADA. Um provedor desconhecido é recusado POR NOME e nunca tentado:
 * spawnar um binário cujo nome veio de fora é execução de código arbitrário na
 * máquina de quem instalou o painel, e é o mesmo motivo pelo qual o
 * `cofre-test.js` afere que o cofre não menciona caminho de executável.
 *
 * AS CERCAS SÃO DADOS, NÃO UM `if`. Cada provedor declara, chave por chave, se
 * tem equivalente para cada cerca obrigatória; `null` significa "não tem". A
 * recusa é DERIVADA dessa tabela (ver `cercasQueFaltam`), então habilitar o Codex
 * no dia em que ele ganhar as flags é preencher um campo — não editar uma recusa
 * escrita à mão em outro lugar, que é como as duas metades divergem. */

/* Os nomes das ferramentas negadas. Idênticos aos do `tester.js` de propósito: o
 * `NEGADAS_SEM_REDE` daqui é byte a byte o `NEGADAS` do `upgrade.js` e a lista do
 * `claude-fix.js`, e `ia-test.js` afere isso em vez de confiar nesta frase.
 *
 * `--allowedTools` NÃO restringe nada, medido neste repositório em 2026-08-07:
 * uma sessão com exatamente `Read,Write,Edit,Glob,Grep` executou shell. Ele é
 * lista de AUTO-APROVAÇÃO. Quem restringe é `--disallowedTools`. Por isso a cerca
 * obrigatória abaixo é a das negadas, e não a das permitidas. */
const NEGADAS_SEMPRE = "Bash,PowerShell,BashOutput,KillShell,Task,Agent,NotebookEdit,SlashCommand";
const NEGADAS_SEM_REDE = NEGADAS_SEMPRE + ",WebFetch,WebSearch";

/* AS TRÊS CERCAS SEM AS QUAIS NÃO SE SPAWNA, e cada uma existe por uma medição:
 *
 *   negadas   `--disallowedTools`. Sem ela a sessão tem shell — medido acima.
 *   settings  `--setting-sources ""`. Sem ela a sessão carrega o `CLAUDE.md`
 *             global, que NESTA máquina tem a chave da API do n8n em texto puro
 *             (medido em `iso-check.js`). Distribuído, é o `CLAUDE.md` global de
 *             cada pessoa, e ninguém sabe o que tem lá dentro.
 *   mcp       `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`. Sem ela a
 *             sessão sobe todo MCP configurado e paga por isso no boot; e um MCP
 *             de terceiro ao lado de um fluxo de produção é uma saída de rede que
 *             ninguém pediu.
 *
 * Faltando QUALQUER uma delas, `escolher` recusa o provedor. Spawnar sem cerca
 * "porque o resto está lá" é a decisão que este arquivo existe para não tomar. */
const CERCAS_OBRIGATORIAS = ["negadas", "settings", "mcp"];

const PROVEDORES = {
  claude: {
    rotulo: "Claude Code CLI",
    /* Onde procurar o binário. Vem do `findClaude()` que hoje existe em três
       arquivos (`claude-fix.js`, `tester.js`, `iso-check.js`) — a intenção é que
       aquelas três cópias passem a chamar `descobrir()` e deixem de existir. */
    envBin: "CLAUDE_BIN",
    /* Relativos a `homedir()`, resolvidos em `descobrir()`. Não guardo caminho
       absoluto aqui porque o `homedir` do teste não é o da máquina. */
    candidatos: {
      win32: [[".local", "bin", "claude.exe"], [".local", "bin", "claude"],
              ["AppData", "Local", "Programs", "claude", "claude.exe"]],
      outro: [[".local", "bin", "claude"]]
    },
    naPath: { win32: "claude.exe", outro: "claude" },
    /* MEDIDO nesta máquina: é um `.exe` nativo (~280MB), então `spawn` funciona
       direto, sem shell e sem shim. É isso que dá a linha de comando inteira do
       Windows (32767) para o prompt — ver `TETO_CMD_WINDOWS` lá embaixo. */
    precisaShell: false,

    /* O prompt viaja em `-p`. É por isso que um prompt grande não falha dizendo
       "prompt grande": falha com `spawn ENAMETOOLONG`, que não nomeia nem o
       prompt nem o tamanho. `argumentosDaRodada` tem um teto por NOME antes do
       spawn justamente por causa disso. */
    flagPrompt: "-p",
    fluxo: ["--output-format", "stream-json", "--verbose"],
    permissao: ["--permission-mode", "acceptEdits"],
    flagPermitidas: "--allowedTools",
    flagModelo: "--model",
    flagEsforco: "--effort",
    flagResume: "--resume",

    cercas: {
      negadas: ["--disallowedTools"],
      settings: ["--setting-sources", ""],
      mcp: ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']
    },

    /* A variável de ambiente da chave de API DELE. No modo `plano` esta chave
       fica AUSENTE do objeto de ambiente; no modo `chave` ela é a única que
       entra. Ver `ambienteDaRodada`. */
    envChave: "ANTHROPIC_API_KEY",
    /* Como perguntar ao CLI se ele está logado. Quem executa isto é o `server.js`
       (`autenticarClaude`), não este arquivo — aqui está só o nome do comando,
       para não haver uma segunda definição dele solta por aí. */
    comandoLogin: ["auth", "status", "--json"],
    varEntrada: "CLAUDE_CODE_ENTRYPOINT"
  },

  codex: {
    rotulo: "Codex CLI",
    envBin: "CODEX_BIN",
    /* MEDIDO em 24/08/2026 nesta máquina: `codex-cli 0.112.0`, instalado pelo npm
       global, e o que existe lá são `codex`, `codex.cmd` e `codex.ps1` — NÃO há
       um `.exe` nativo. */
    candidatos: {
      win32: [["AppData", "Roaming", "npm", "codex.cmd"]],
      outro: [[".local", "bin", "codex"]]
    },
    naPath: { win32: "codex.cmd", outro: "codex" },
    /* E É AQUI QUE ESTE PROVEDOR JÁ MORRERIA, antes de qualquer questão de cerca.
       MEDIDO com Node v22.18.0: `spawn` de um `.cmd` sem `shell: true` devolve
       **EINVAL** (é a correção do CVE-2024-27980). E ligar `shell: true` troca um
       problema por dois piores: o prompt inteiro passa a atravessar o cmd.exe
       (superfície de injeção por citação) e o teto da linha de comando cai de
       32767 para os 8191 do cmd.exe — ou seja, o `PROMPT_MAX` deste repositório
       deixaria de valer sem ninguém mudar o número. */
    precisaShell: true,

    /* `codex exec` — MEDIDO no `--help` da 0.112.0, não suposto:
         - o prompt é POSICIONAL, e `-p` significa `--profile`. Portar o `-p` por
           analogia mandaria o prompt inteiro como nome de perfil de config.
         - o fluxo de eventos é `--json` (JSONL), não `--output-format
           stream-json`; então o parser de `stream-json` deste repositório não
           serve, ele fala outro dialeto.
         - `-s/--sandbox read-only` restringe COMANDO DE SHELL gerado pelo modelo.
           Não é o mesmo objeto que `--disallowedTools`, que fecha FAMÍLIA DE
           FERRAMENTA (WebFetch, WebSearch, Task). Chamar um de equivalente do
           outro seria a mentira que a cerca existe para não contar. */
    flagPrompt: null,
    fluxo: ["--json"],
    permissao: null,
    flagPermitidas: null,
    flagModelo: "-m",
    flagEsforco: null,
    flagResume: null,

    cercas: {
      /* NÃO EXISTE. Ver o parágrafo acima: sandbox de shell não é lista de
         ferramenta negada. */
      negadas: null,
      /* NÃO EXISTE. `codex exec --help` não tem nada equivalente a
         `--setting-sources ""`: `~/.codex/config.toml` e `~/.codex/AGENTS.md` são
         carregados de qualquer forma. MEDIDO nesta máquina em 24/08/2026: o
         `AGENTS.md` global tem 2.552 bytes e o `config.toml` tem 889 — e dentro
         dele há um `[mcp_servers.context7]` cuja linha `args` casa com a varredura
         de segredo deste repositório, isto é, uma chave de API em texto puro. É
         EXATAMENTE a mesma forma do defeito que `--setting-sources ""` foi medido
         para fechar no Claude, e aqui não há flag para fechar. `CODEX_HOME` não
         aparece no `--help` e, mesmo se aparecesse, isolaria também a credencial —
         a lição que o `CLAUDE_CONFIG_DIR` já pagou: a sessão deixa de conseguir
         autenticar. */
      settings: null,
      /* `-c mcp_servers={}` existe e é um equivalente plausível. Fica declarado
         porque é verdade, e ele SOZINHO não libera nada: `cercasQueFaltam` exige
         as três. Declarar as duas ausências e esconder esta presença seria o mesmo
         tipo de imprecisão, na direção oposta. */
      mcp: ["-c", "mcp_servers={}"]
    },

    envChave: "OPENAI_API_KEY",
    /* MEDIDO: `codex login status` NÃO tem `--json`. Então a rota de observação do
       `integracoes.js` não tem o que fazer `JSON.parse` em cima — o campo fica
       `null` ("não perguntei"), que é o estado honesto, e não `false` ("perguntei
       e ela não está logada"). */
    comandoLogin: ["login", "status"],
    varEntrada: "CODEX_INTERNAL_ORIGINATOR_OVERRIDE"
  }
};

const MODOS = {
  /* Login OAuth no próprio CLI: o gasto sai da COTA do plano da pessoa, sem
     cartão. É o comportamento de hoje e é o padrão. */
  plano: { rotulo: "plano (login no CLI)", usaChave: false },
  /* Chave de API dela: o gasto sai do CARTÃO dela. */
  chave: { rotulo: "chave de API", usaChave: true }
};

/* O PADRÃO É EXPLÍCITO E VIAJA NO RETORNO, e essa é a parte que não pode ser
 * silenciosa. O `CLAUDE.md` já escreveu sete vezes que um campo ausente nunca cai
 * no ramo negativo — e aqui o "ramo negativo" tem duas faces:
 *
 *   - recusar tudo o que chega sem provedor quebraria os quatro sítios de spawn
 *     de hoje, que não passam nada; e uma rodada recusada por omissão de um campo
 *     novo é o painel se recusando a trabalhar por causa de uma migração.
 *   - assumir em silêncio é pior no outro sentido: no dia em que o padrão mudar,
 *     ninguém saberá que estava valendo um.
 *
 * Então há padrão, ele é o lado BARATO E CERCADO (`claude` é o único provedor com
 * as três cercas; `plano` é o único modo que não toca cartão), e o retorno diz
 * `padrao: { provedor: true }` para a tela poder escrever "escolhi por você". */
const PADRAO_PROVEDOR = "claude";
const PADRAO_MODO = "plano";

/* ═══════════════════════════════════════════════════ o ambiente do filho ════
 *
 * A BASE VEM DO `ambiente.js` E NÃO É REESCRITA AQUI. Ele monta por allowlist, e
 * a ausência de `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` nessa lista é o que garante
 * que o custo fica no plano: uma variável que não existe não precisa ser
 * lembrada. Ele ainda tem uma segunda camada (`ENV_NUNCA`) que LANÇA se alguém
 * tentar acrescentar uma chave pelo `extra` — que é a porta dos fundos óbvia da
 * allowlist, e ele a fechou.
 *
 * A CONSEQUÊNCIA PARA ESTE ARQUIVO É O DESENHO DE `ambienteDaRodada`: no modo
 * `chave` a chave NÃO entra pelo `extra` (seria recusada, e com razão). Ela é
 * escrita DEPOIS, numa linha só, com nome. É o mesmo formato do `getRawWorkflow`
 * do `n8n.js`: um buraco deliberado, num lugar só, anotado como buraco — em vez
 * de uma peneira frouxa que deixa passar o que ninguém listou. */

/* Nomes que este módulo nunca escreve por conta própria, além do que o
 * `ENV_NUNCA` do `ambiente.js` já barra na entrada. Redundância deliberada, a
 * disciplina de `nomeSeguro` + `dentro()` do `anexos.js`: `ANTHROPIC_BASE_URL`
 * redirecionaria a sessão para um proxy de terceiro, e os interruptores de
 * Bedrock/Vertex levariam o gasto para fora da conta que a pessoa escolheu. */
const NUNCA_ESCREVO = [
  "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "N8N_API_KEY"
];

/* ═══════════════════════════════════════════════════════ o teto de prompt ═══
 *
 * O prompt viaja no argumento de linha de comando, e a linha inteira do Windows
 * morre em 32767 caracteres com `spawn ENAMETOOLONG` — uma mensagem que não
 * nomeia nem o prompt nem o tamanho, e manda quem lê procurar problema de
 * caminho de arquivo. Medido de verdade: o conhecimento de agentes inline levou o
 * prompt a 49KB e a etapa 04 do Tester morreu com essa mensagem.
 *
 * OS DOIS NÚMEROS ABAIXO SÃO OS QUE JÁ EXISTEM NO REPOSITÓRIO, nenhum inventado
 * aqui: 24000 é o `PROMPT_MAX` do `upgrade.js` e 30000 é o do `tester.js`. Eles
 * são diferentes porque as duas abas têm folgas diferentes (o pior prompt do
 * `upgrade.js` já fica em ~16,4KB), e escolher um só para as duas seria apertar
 * uma ou afrouxar a outra sem medir.
 *
 * Então quem chama PASSA o seu (`tetoPrompt`), e o default é o MENOR dos dois:
 * errar para o lado apertado custa uma recusa por nome antes do spawn; errar para
 * o lado largo custa um `ENAMETOOLONG` que não diz nada. */
const PROMPT_MAX = 24000;            // o do upgrade.js
const PROMPT_MAX_TESTER = 30000;     // o do tester.js
const TETO_CMD_WINDOWS = 32767;      // o limite do SO, referência para quem calibrar

/* ═════════════════════════════════════════════════ o que nunca é ecoado ═════
 *
 * A ideia é a do `pareceChave()` do `cofre.js` (que só conhece JWT porque lá o
 * único formato possível é o do n8n), ampliada para as famílias que o
 * `claude-fix.js` já varre — e o arquivo NÃO é copiado, porque o `cofre.js` é
 * DPAPI e PowerShell e nada daquilo tem a ver com aqui.
 *
 * O que isto protege: `escolher` ecoa o valor CRU de `provedor` e de `modo` para
 * a tela poder dizer "ignorei isto". Se alguém trocar a ordem dos argumentos numa
 * fiação e a chave de API cair no lugar do provedor, o eco publicaria a chave —
 * numa mensagem de erro, que é o lugar que vai para log, para ledger e para a
 * tela. Conservador de propósito: o custo do falso positivo é uma mensagem menos
 * legível, o do falso negativo é a chave. */
const SEGREDO_RE = [
  /^eyJ[A-Za-z0-9_-]{6,}/,                     // JWT (o formato da chave do n8n)
  /^sk-[A-Za-z0-9_-]{12,}/,                    // OpenAI / Anthropic
  /^sk-ant-/,
  /^xox[baprs]-/,                              // Slack
  /^ghp_[A-Za-z0-9]{16,}/,                     // GitHub
  /^AIza[A-Za-z0-9_-]{16,}/,                   // Google
  /^[A-Za-z0-9_-]{40,}$/                       // qualquer coisa longa e sem espaço
];

function pareceSegredo(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  return SEGREDO_RE.some(re => re.test(s));
}

/* Como um valor cru aparece numa frase. Três resultados, e os três são fato:
 *   - não é string: o TIPO, nunca o conteúdo;
 *   - tem cara de segredo: a FORMA (tamanho), nunca um pedaço do valor. Truncar
 *     não serve: metade de um JWT já é material vazado, e o `cofre.js` documenta
 *     que um pedaço de `eyJ` conta como vazamento;
 *   - o resto: o valor, com teto de 40 caracteres, porque um prompt de 40KB
 *     colado no lugar do provedor não pode virar uma mensagem de erro de 40KB. */
function rotular(v) {
  if (v === null) return "null";
  if (v === undefined) return "ausente";
  if (typeof v !== "string") return "um valor do tipo " + typeof v;
  if (pareceSegredo(v)) {
    return "um valor de " + v.trim().length + " caracteres com forma de credencial (não vou repeti-lo)";
  }
  const s = v.length > 40 ? v.slice(0, 40) + "…" : v;
  return "`" + s + "`";
}

/* ═══════════════════════════════════════════════════════════ a escolha ══════ */

/* Quais cercas obrigatórias faltam num provedor. Derivado da tabela, nunca
 * escrito à mão: é isto que faz "habilitar o Codex" ser preencher um campo. */
function cercasQueFaltam(p) {
  const cfg = PROVEDORES[p];
  if (!cfg) return CERCAS_OBRIGATORIAS.slice();
  return CERCAS_OBRIGATORIAS.filter(nome => {
    const v = cfg.cercas && cfg.cercas[nome];
    return !(Array.isArray(v) && v.length > 0);
  });
}

/* Nome legível de cada cerca, para a frase de recusa nomear o que falta em vez de
 * dizer "faltam cercas". Uma recusa que não nomeia o que falta é uma recusa que
 * ninguém consegue resolver. */
const CERCA_NOME = {
  negadas: "a lista de ferramentas negadas (`--disallowedTools`)",
  settings: "o descarte da configuração global (`--setting-sources \"\"`)",
  mcp: "o desligamento dos MCP (`--strict-mcp-config`)"
};

/**
 * escolher({ provedor, modo, env })
 *   -> { provedor, modo, ok, porque, padrao, envChave, faltando, cru }
 *
 * PURA. Nenhum disco, nenhuma rede, nenhum spawn.
 *
 * A ORDEM DAS CHECAGENS é decisão, não estilo: provedor antes de cerca antes de
 * modo antes de chave. Sem provedor válido não se sabe qual cerca conferir; sem
 * cerca não interessa de quem é a conta, porque não vai rodar; e o nome da
 * variável de chave é uma propriedade do provedor.
 */
function escolher({ provedor, modo, env } = {}) {
  const amb = env || process.env;
  const cru = { provedor, modo };
  const padrao = { provedor: false, modo: false };

  /* ── 1. o provedor ── */
  let p;
  if (provedor === undefined || provedor === null || provedor === "") {
    p = PADRAO_PROVEDOR;
    padrao.provedor = true;
  } else if (typeof provedor !== "string" || !Object.prototype.hasOwnProperty.call(PROVEDORES, provedor)) {
    return {
      provedor: null, modo: null, ok: false, padrao, envChave: null, faltando: [], cru,
      porque: "não conheço o provedor " + rotular(provedor) + ". Os que existem são: "
        + Object.keys(PROVEDORES).join(", ") + ". A lista é fechada de propósito — "
        + "um nome que vem de fora não é procurado no disco nem spawnado."
    };
  } else {
    p = provedor;
  }
  const cfg = PROVEDORES[p];

  /* ── 2. as cercas ── */
  const faltando = cercasQueFaltam(p);
  if (faltando.length) {
    return {
      provedor: p, modo: null, ok: false, padrao, envChave: cfg.envChave, faltando, cru,
      porque: "o provedor `" + p + "` (" + cfg.rotulo + ") não tem equivalente para "
        + faltando.map(n => CERCA_NOME[n] || n).join(" nem para ")
        + ". Sem essas flags a sessão roda sem cerca — com shell, ou carregando a "
        + "configuração global de quem instalou o painel — então ela não roda. "
        + "Isto é recusa por ausência medida de flag, não indisponibilidade do CLI."
    };
  }

  /* ── 3. o modo ── */
  let m;
  if (modo === undefined || modo === null || modo === "") {
    m = PADRAO_MODO;
    padrao.modo = true;
  } else if (typeof modo !== "string" || !Object.prototype.hasOwnProperty.call(MODOS, modo)) {
    return {
      provedor: p, modo: null, ok: false, padrao, envChave: cfg.envChave, faltando: [], cru,
      porque: "não conheço o modo de credencial " + rotular(modo) + ". Os que existem são: "
        + Object.keys(MODOS).join(", ") + "."
    };
  } else {
    m = modo;
  }

  /* ── 4. a chave, quando o modo pede uma ── */
  if (MODOS[m].usaChave) {
    const valor = amb ? amb[cfg.envChave] : undefined;
    if (typeof valor !== "string" || !valor.trim()) {
      return {
        provedor: p, modo: m, ok: false, padrao, envChave: cfg.envChave, faltando: [], cru,
        /* A frase NOMEIA a variável, porque sem o nome não há o que fazer com a
           recusa. E não diz nada sobre o valor — nem que estava vazio nem que
           estava só com espaço: `undefined` e `"   "` levam à mesma ação. */
        porque: "o modo `chave` foi pedido e a variável `" + cfg.envChave
          + "` não está no ambiente desta rodada."
      };
    }
  }

  return {
    provedor: p, modo: m, ok: true, padrao, envChave: cfg.envChave, faltando: [], cru,
    porque: null
  };
}

/* ═══════════════════════════════════════════════ o ambiente de uma rodada ═══ */

/**
 * ambienteDaRodada({ base, escolha, chave }) -> objeto de ambiente do filho
 *
 * PURA (só lê `process.env` se `base` for omitido).
 *
 * A REGRA QUE CARREGA ESTA FUNÇÃO: no modo `plano` a variável de chave de API
 * está **AUSENTE DO OBJETO**, não presente e vazia. Presente e vazia é uma
 * variável que existe: pode ser lida, logada, herdada por um subprocesso e — o
 * caso real — pode fazer um CLI achar que foi configurado com uma chave em branco
 * em vez de usar o login. Ausente não pode ser esquecida. É a frase que o
 * `ambiente.js` já escreveu e é o primeiro caso do teste.
 *
 * Lança quando a escolha não é aplicável, e lançar é o certo aqui: montar
 * ambiente para uma escolha RECUSADA é bug de quem chamou, e bug de chamador tem
 * que falhar alto no lugar onde nasceu — a lição que o `guardar()` do `cofre.js`
 * pagou com `String({})` virando `"[object Object]"` e sendo cifrado.
 */
function ambienteDaRodada({ base, escolha, chave, carimbo } = {}) {
  if (!escolha || typeof escolha !== "object") {
    throw new Error("ambienteDaRodada precisa da escolha devolvida por escolher()");
  }
  if (escolha.ok !== true) {
    throw new Error("não monto ambiente para uma escolha recusada: " + (escolha.porque || "sem motivo declarado"));
  }
  const cfg = PROVEDORES[escolha.provedor];
  if (!cfg) throw new Error("escolha com provedor que não está na lista fechada");
  const modo = MODOS[escolha.modo];
  if (!modo) throw new Error("escolha com modo que não está na lista fechada");

  const de = base || process.env;

  /* A base inteira vem de lá. `entrada` é como o `ambiente.js` recebe um ambiente
     que não é o do processo — é o que mantém esta função pura quando quem chama
     passa `base`. */
  /* O CARIMBO e proprio de cada caminho, e por isso ele e parametro em vez de
     constante. Ele diz QUEM spawnou -- `cockpit`, `cockpit-tester`,
     `cockpit-upgrade` -- e e o mesmo argumento que o `ambiente.js` usa para deixar
     o `CLAUDE_CODE_ENTRYPOINT` no chamador: um carimbo unico faria as tres abas
     virarem uma so no que quer que leia esse campo, e nao ha como recuperar depois.
     Ausente cai no generico, que e o que os quatro sitios ja escreviam antes de
     existir aba nenhuma -- nunca em vazio, que apagaria o campo. */
  const out = ambiente.envLimpo({
    entrada: de,
    extra: { [cfg.varEntrada]: (typeof carimbo === "string" && carimbo.trim()) || "cockpit" }
  });

  /* Segunda camada, redundante de propósito (ver `NUNCA_ESCREVO`). No-op hoje,
     porque o `ENV_NUNCA` de lá já barra a maior parte disto; existe para o dia em
     que alguém mexer numa das duas listas sem olhar a outra. */
  for (const k of NUNCA_ESCREVO) delete out[k];

  if (modo.usaChave) {
    const valor = typeof chave === "string" && chave.trim()
      ? chave.trim()
      : (typeof de[cfg.envChave] === "string" && de[cfg.envChave].trim() ? de[cfg.envChave].trim() : null);
    if (!valor) {
      /* `escolher` já teria recusado; chegar aqui é fiação que perdeu o valor no
         caminho. A frase nomeia a variável e nunca o valor. */
      throw new Error("modo `chave` sem valor para `" + cfg.envChave + "`");
    }
    /* O BURACO DELIBERADO, e ele é UMA LINHA, para UM provedor de cada vez.
       Não passa pelo `extra` do `ambiente.js` porque o `ENV_NUNCA` de lá LANÇA em
       cima de `ANTHROPIC_API_KEY` — e essa recusa está certa: `extra` é o ponto
       por onde qualquer caminho acrescenta coisa, e uma exceção genérica ali
       valeria para todos eles. Aqui vale só para o provedor que a pessoa
       escolheu, só quando ela escolheu o modo `chave`, e nunca para a chave de
       outro provedor — que não é da conta desta rodada e estaria sendo entregue
       ao binário de um terceiro. */
    out[cfg.envChave] = valor;
  }

  return out;
}

/* ═══════════════════════════════════════════════ os argumentos da rodada ════ */

/* O lugar do prompt dentro de `args`, para `argumentosParaLog` saber o que
 * mascarar sem procurar pelo conteúdo — procurar pelo conteúdo é o que erra
 * quando o prompt contém uma flag. */
const MARCA_PROMPT = "«prompt»";

/**
 * argumentosDaRodada({ escolha, prompt, ferramentas, negadas, modelo, esforco,
 *                      resumeId, tetoPrompt })
 *   -> { ok, args, iPrompt, erro, tamanho, teto }
 *
 * PURA. Devolve o array; quem spawna é quem chamou.
 *
 * NÃO LANÇA por prompt grande — devolve `ok: false` e uma frase, que é a forma
 * que o `rodar()` do `upgrade.js` e do `tester.js` já usam (eles resolvem a
 * promessa com `{erro}`). A frase é a mesma daquele arquivo, de propósito: duas
 * redações para o mesmo teto acabam divergindo no número.
 *
 * O PROMPT ESTÁ DENTRO DE `args` E ISSO É INEVITÁVEL — é literalmente o que o
 * spawn precisa receber. Então `args` é o objeto que vai para o `spawn` e para
 * mais nada; o que pode ser impresso, logado ou devolvido numa API é
 * `argumentosParaLog(...)`. A frase de erro nunca cita o prompt, só o tamanho.
 */
function argumentosDaRodada({ escolha, prompt, ferramentas, negadas, modelo,
                              esforco, resumeId, tetoPrompt } = {}) {
  const vazio = { ok: false, args: null, iPrompt: -1, tamanho: 0, teto: 0 };

  if (!escolha || typeof escolha !== "object") {
    return Object.assign({}, vazio, { erro: "argumentosDaRodada precisa da escolha devolvida por escolher()" });
  }
  if (escolha.ok !== true) {
    return Object.assign({}, vazio, {
      erro: "não monto argumentos para uma escolha recusada: " + (escolha.porque || "sem motivo declarado")
    });
  }
  const cfg = PROVEDORES[escolha.provedor];
  if (!cfg) {
    return Object.assign({}, vazio, { erro: "escolha com provedor que não está na lista fechada" });
  }
  /* Cinto e suspensório: `escolher` já recusou provedor sem cerca, mas esta
     função é chamável direto e a cerca é o que ela está montando. Uma checagem a
     mais custa um `filter` sobre três nomes. */
  const faltando = cercasQueFaltam(escolha.provedor);
  if (faltando.length) {
    return Object.assign({}, vazio, {
      erro: "o provedor `" + escolha.provedor + "` não tem "
        + faltando.map(n => CERCA_NOME[n] || n).join(" nem ") + " — não monto argumentos sem cerca"
    });
  }

  const p = typeof prompt === "string" ? prompt : String(prompt == null ? "" : prompt);
  const teto = Number.isFinite(tetoPrompt) && tetoPrompt > 0 ? Math.floor(tetoPrompt) : PROMPT_MAX;
  if (!p.trim()) {
    return Object.assign({}, vazio, { teto, erro: "prompt vazio: não monto uma rodada sem pedido" });
  }
  if (p.length > teto) {
    /* Falha por NOME, antes do spawn. Sem isto o erro é `spawn ENAMETOOLONG`, que
       manda quem lê procurar caminho de arquivo. O NÚMERO viaja; o TEXTO não — é
       aqui que uma chave colada por engano no lugar do prompt sairia. */
    return Object.assign({}, vazio, {
      tamanho: p.length, teto,
      erro: "o prompt ficou com " + p.length + " caracteres e o teto aqui é " + teto
        + " (a linha de comando do Windows não aceita mais que " + TETO_CMD_WINDOWS
        + " no comando inteiro). Material grande tem que ir para arquivo no diretório da sessão, não para dentro do prompt"
    });
  }

  const args = [];
  args.push(cfg.flagPrompt);
  const iPrompt = args.length;
  args.push(p);
  args.push(...cfg.fluxo);
  args.push(...cfg.permissao);

  /* `--allowedTools` é auto-aprovação e não restringe (medido). Ele entra porque
     sem ele a sessão headless para pedindo permissão que ninguém vai dar. */
  if (ferramentas) args.push(cfg.flagPermitidas, String(ferramentas));

  /* A CERCA. `negadas` é parâmetro porque o Tester tem uma sessão COM rede
     (`NEGADAS_SEMPRE`) e todo o resto é sem rede (`NEGADAS_SEM_REDE`) — mas o
     default é o FECHADO: quem quer rede pede rede. */
  args.push(...cfg.cercas.negadas, String(negadas || NEGADAS_SEM_REDE));
  args.push(...cfg.cercas.mcp);
  args.push(...cfg.cercas.settings);

  if (modelo) args.push(cfg.flagModelo, String(modelo));
  /* `esforco` só entra quando existe: ausente significa "o padrão do CLI", dito
     de propósito — a rodada de patch do `upgrade.js` nunca foi medida, e baixar o
     esforço dela por analogia mudaria o caminho que escreve em produção. */
  if (esforco && cfg.flagEsforco) args.push(cfg.flagEsforco, String(esforco));
  if (resumeId && cfg.flagResume) args.push(cfg.flagResume, String(resumeId));

  return { ok: true, args, iPrompt, erro: null, tamanho: p.length, teto };
}

/** O mesmo array, com o prompt trocado pela marca. É ISTO que pode ser impresso. */
function argumentosParaLog(r) {
  const args = Array.isArray(r) ? r : (r && r.args);
  if (!Array.isArray(args)) return [];
  const i = Array.isArray(r) ? -1 : (r && typeof r.iPrompt === "number" ? r.iPrompt : -1);
  return args.map((a, k) => {
    if (k === i) return MARCA_PROMPT + " (" + String(a).length + " caracteres)";
    /* Rede para quem passa o array cru sem o índice, e para o dia em que alguém
       puser outro texto longo nos argumentos. */
    if (i < 0 && typeof a === "string" && (a.length > 200 || pareceSegredo(a))) {
      return "«" + a.length + " caracteres não impressos»";
    }
    return a;
  });
}

/* ═══════════════════════════════════════════════════════ achar o binário ════ */

/**
 * caminhoExplicitoAceitavel(valor, win) -> { ok } | { ok:false, regra, porque }
 *
 * O valor de `CLAUDE_BIN` / `CODEX_BIN` é um CAMINHO, e aqui ele é validado como
 * um — antes de entrar em `candidatos`.
 *
 * O DEFEITO QUE ISTO FECHA, e ele é o pior alcançável deste arquivo: esse valor
 * vem do ambiente OU do `.env` do diretório, e neste projeto **o `.env` GANHA do
 * `process.env`** (medido, e registrado no `CLAUDE.md` a propósito do
 * `loadConfig()` do `n8n.js` — custou um `PUT` real na instância de produção).
 * Ele entrava PRIMEIRO em `candidatos`, e o que sai daqui é literalmente o
 * primeiro argumento do `spawn()` no `claude-fix.js`, no `upgrade.js` e no
 * `tester.js`. Ou seja: quem consegue escrever UMA linha num `.env` escolhia o
 * executável que o cockpit roda — com a conta de quem abriu o painel, que é a
 * mesma que pode escrever num fluxo de produção do n8n e disparar `/retry`.
 *
 * DUAS REGRAS, e as duas são estruturais e não de gosto:
 *
 *   - CAMINHO ABSOLUTO. Um nome nu (`claude.exe`) ou relativo (`.\x.exe`) é
 *     resolvido pelo SO contra o PATH ou contra o cwd do processo — então quem
 *     escreve o `.env` não precisa nem saber onde o painel está instalado:
 *     basta plantar um arquivo com esse nome em qualquer diretório que o PATH
 *     alcance. Exigir caminho absoluto obriga o atacante a JÁ ter escrito
 *     exatamente onde ele apontou, que é uma condição bem mais forte.
 *
 *   - NENHUM CARACTERE DE CONTROLE. Mesma linha do `raizSegura()` no
 *     `pareamento.js`: um U+0000 no meio de um caminho é truncamento em algumas
 *     camadas do SO, e este repositório já perdeu tempo três vezes com byte
 *     invisível (U+0000 no `nodeOrigin`, U+001F no `n8n.js`, U+0000 no
 *     `catalog.js`). Um caminho com byte invisível também não é imprimível: ele
 *     acabaria numa frase de recusa que a tela mostra.
 *
 * A absolutez é medida contra a PLATAFORMA DECLARADA (`path.win32`/`path.posix`)
 * e nunca contra a do processo: `C:\...` não é absoluto para o `path` do POSIX e
 * `/usr/bin/x` não é absoluto do jeito que o Windows entende. `descobrir` já
 * recebe `plataforma` por injeção, e medir com o `path` do processo faria a
 * regra mudar de resposta conforme a máquina que roda o teste.
 *
 * FATO, nunca juízo: devolve a regra quebrada e a frase; quem monta a recusa
 * final (e nomeia a variável de ambiente) é `descobrir`.
 */
function caminhoExplicitoAceitavel(valor, win) {
  if (typeof valor !== "string" || !valor.trim()) {
    return { ok: false, regra: "vazio", porque: "não é um caminho: veio " + rotular(valor) + "." };
  }
  const v = valor.trim();
  /* O caractere de controle é conferido ANTES do resto, e o valor NÃO é ecoado
     neste ramo: repetir um byte invisível numa frase de recusa é levar o byte
     invisível para o console e para a tela — o defeito, não o relatório. */
  if (/[\u0000-\u001f\u007f]/.test(v)) {
    return {
      ok: false, regra: "controle",
      porque: "tem caractere de controle no meio — isso não é um caminho de executável, "
        + "e um byte invisível num caminho é truncamento silencioso em algumas camadas do SO."
    };
  }
  const p = require("node:path");
  if (!(win ? p.win32 : p.posix).isAbsolute(v)) {
    return {
      ok: false, regra: "relativo",
      porque: "não é um caminho absoluto (veio " + rotular(v) + "). Um nome solto ou relativo quem "
        + "resolve é o PATH ou o diretório onde o painel foi aberto, então bastaria plantar um "
        + "arquivo com esse nome em qualquer lugar que o PATH alcance para trocar o executável que eu rodo."
    };
  }
  return { ok: true };
}

/**
 * descobrir(provedor, { existe, plataforma, env, casa })
 *   -> { achado, caminho, porque, candidatos }
 *
 * O ÚNICO lugar deste arquivo que toca disco — e `existe` entra por parâmetro
 * (mesma injeção do `colher({n8n, fix})` do `integracoes.js`) para o teste poder
 * provar que um provedor desconhecido NÃO chega a consultar o filesystem.
 *
 * TRÊS ESTADOS, nunca dois:
 *   achado: true   achei, e `caminho` é onde;
 *   achado: false  procurei nos candidatos e não está lá;
 *   achado: null   NÃO DEU PARA PROCURAR — provedor fora da lista, `existsSync`
 *                  lançando, ou o caso do PATH: um nome nu (`claude.exe`) não é
 *                  um caminho, e `existsSync` sobre ele não responde nem sim nem
 *                  não. Hoje o `claude-fix.js` faz `claudeFound =
 *                  fs.existsSync(CLAUDE_BIN)` sobre exatamente esse nome nu e
 *                  devolve **false** — "o CLI não está nesta máquina" — para um
 *                  CLI que pode estar no PATH. `false` ali é uma afirmação que
 *                  não foi medida; aqui é `null`.
 */
function descobrir(provedor, { existe, plataforma, env, casa } = {}) {
  /* Antes de qualquer coisa: lista fechada. Um provedor desconhecido não vira
     caminho de arquivo, não vira consulta ao disco e não vira spawn. */
  if (typeof provedor !== "string" || !Object.prototype.hasOwnProperty.call(PROVEDORES, provedor)) {
    return {
      achado: null, caminho: null, candidatos: [],
      porque: "não procurei: não conheço o provedor " + rotular(provedor)
        + " e não transformo um nome de fora em caminho de executável."
    };
  }
  const cfg = PROVEDORES[provedor];
  const amb = env || process.env;
  const plat = plataforma || process.platform;
  const win = plat === "win32";

  /* `require` local de propósito: o núcleo deste módulo é puro, e um `require` no
     topo carregaria `fs`/`os`/`path` só por importar o arquivo. */
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");

  const ex = typeof existe === "function" ? existe : (c => fs.existsSync(c));
  const home = casa || os.homedir();

  const explicito = typeof amb[cfg.envBin] === "string" && amb[cfg.envBin].trim()
    ? amb[cfg.envBin].trim() : null;
  const relativos = (win ? cfg.candidatos.win32 : cfg.candidatos.outro) || [];
  const candidatos = [];

  /* O valor apontado é validado ANTES de virar candidato — logo, antes de tocar
     o disco e muito antes de virar argumento de `spawn`. */
  if (explicito) {
    const v = caminhoExplicitoAceitavel(explicito, win);
    if (!v.ok) {
      /* NÃO CAI PARA OS CANDIDATOS PADRÃO, e isso é a metade da decisão que
         importa. Cair acharia o binário de sempre, `porque` voltaria `null`, e a
         tela não teria como dizer que a configuração dele foi RECUSADA — que é a
         regra desta casa: uma configuração ignorada tem que dizer que foi
         ignorada. Silenciosamente, ele editaria o `.env`, o painel continuaria
         funcionando, e ele concluiria que a linha pegou.

         `achado: false` e não `null` pelo mesmo motivo do ramo "`CLAUDE_BIN`
         aponta para um caminho que não existe" logo abaixo: houve uma afirmação
         e ela foi MEDIDA. `null` é reservado para quando não deu para olhar.

         `candidatos: []` é fato e não formalidade: nenhum lugar foi consultado,
         e listar os candidatos padrão aqui diria que eu procurei neles. */
      return {
        achado: false, caminho: null, candidatos: [],
        porque: "`" + cfg.envBin + "` " + v.porque
          + " Recusei o valor e NÃO procurei em mais lugar nenhum: seguir para o caminho de sempre "
          + "esconderia que a sua configuração foi ignorada. Aponte `" + cfg.envBin
          + "` para o caminho absoluto do executável, ou apague a linha."
      };
    }
    candidatos.push(explicito);
  }

  for (const partes of relativos) candidatos.push(path.join(home, ...partes));

  let erroDeLeitura = null;
  for (const c of candidatos) {
    try { if (ex(c)) return { achado: true, caminho: c, porque: null, candidatos }; }
    catch (err) {
      /* Um `existsSync` que LANÇA (permissão, caminho inválido, unidade de rede
         fora do ar) não é "não existe". Guardo e continuo procurando; se nada for
         achado, o estado é `null` e não `false`. */
      erroDeLeitura = erroDeLeitura || String((err && err.message) || err);
    }
  }

  if (erroDeLeitura) {
    return { achado: null, caminho: null, candidatos, porque: "não deu para procurar: " + erroDeLeitura };
  }
  if (explicito) {
    /* Ele APONTOU um caminho e ele não está lá. Isto é `false` de verdade: houve
       uma afirmação e ela foi medida. E a frase nomeia a variável, porque o
       conserto é editar aquela linha. */
    return {
      achado: false, caminho: null, candidatos,
      porque: "`" + cfg.envBin + "` aponta para um caminho que não existe."
    };
  }
  const naPath = win ? cfg.naPath.win32 : cfg.naPath.outro;
  return {
    achado: null, caminho: naPath, candidatos,
    porque: "não achei nos lugares conhecidos. Sobra `" + naPath + "` no PATH, e sobre isso "
      + "`existsSync` não responde: um nome nu não é um caminho. Aponte `" + cfg.envBin
      + "` para o executável se quiser uma resposta em vez de uma tentativa."
  };
}

/* ═══════════════════════════════════════════════════════════ capacidades ════ */

/* O que a tela precisa saber para desenhar as duas escolhas, como FATO. Nenhuma
 * cor, nenhuma frase de diagnóstico: quem decide que "sem cerca" pinta vermelho é
 * a página. `cercasQueFaltam` viaja porque é o que separa "esse CLI não está
 * instalado" de "esse CLI o cockpit não sabe cercar" — dois estados com dois
 * consertos diferentes. */
function capacidades() {
  const out = {};
  for (const p of Object.keys(PROVEDORES)) {
    const cfg = PROVEDORES[p];
    const faltam = cercasQueFaltam(p);
    out[p] = {
      rotulo: cfg.rotulo,
      envBin: cfg.envBin,
      envChave: cfg.envChave,
      comandoLogin: cfg.comandoLogin.slice(),
      precisaShell: cfg.precisaShell,
      cercasQueFaltam: faltam,
      utilizavel: faltam.length === 0
    };
  }
  return {
    provedores: out,
    modos: Object.keys(MODOS).map(m => ({ id: m, rotulo: MODOS[m].rotulo, usaChave: MODOS[m].usaChave })),
    padrao: { provedor: PADRAO_PROVEDOR, modo: PADRAO_MODO },
    tetoPromptPadrao: PROMPT_MAX
  };
}

module.exports = {
  PROVEDORES, MODOS, CERCAS_OBRIGATORIAS, CERCA_NOME,
  PADRAO_PROVEDOR, PADRAO_MODO,
  NUNCA_ESCREVO,
  NEGADAS_SEMPRE, NEGADAS_SEM_REDE,
  PROMPT_MAX, PROMPT_MAX_TESTER, TETO_CMD_WINDOWS,
  MARCA_PROMPT,
  escolher, ambienteDaRodada, argumentosDaRodada, argumentosParaLog,
  descobrir, capacidades, cercasQueFaltam,
  /* Pura, exportada porque a regra do caminho apontado decide o que vai para o
     `spawn`: ela precisa ser provável sem tocar disco e nas duas plataformas. */
  caminhoExplicitoAceitavel,
  /* Exportadas para o teste poder provar cada decisão isolada, e porque a
     varredura de segredo é a única defesa contra uma chave sair numa frase. */
  pareceSegredo, rotular
};
