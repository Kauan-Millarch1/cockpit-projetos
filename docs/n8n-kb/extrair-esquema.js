/* extrair-esquema.js — CÓPIA GERADA. Não edite aqui.
 *
 * Gerado de `esquema.js` do Cockpit de Projetos por `docs/n8n-kb/sync.js`.
 * A canônica é a de lá; mudança feita aqui é perdida na próxima sincronização.
 *
 * Autossuficiente: só módulos embutidos do Node 22. Sem `npm install`.
 *
 *   node extrair-esquema.js --baixar       # npm pack dos pacotes de nó
 *   node extrair-esquema.js --construir    # destila para .cache-esquema.json
 *   node extrair-esquema.js --ver <tipo> [--versao <v>]
 *   node extrair-esquema.js --conferir <fluxo.json>
 */
/* esquema.js — o esquema AUTORITATIVO dos nós do n8n.
 *
 * O `catalog.js` responde "que tipos de nó existem nesta instância e com que
 * forma de parâmetro eles aparecem nos fluxos do Kauan". É um piso derivado do
 * que ele já construiu, e tem três limites que só ficam visíveis quando se olha
 * o que a sessão de construção recebe:
 *
 *   - todo discriminador chega como a palavra "string". `redis.operation` é
 *     "string" num repositório cujo CLAUDE.md documenta um bug silencioso de
 *     produção sobre `redis get` devolver o valor em `propertyName`. O catálogo
 *     é estruturalmente incapaz de carregar esse fato.
 *   - o sketch é UNIÃO ENTRE VERSÕES. `if` 2 / 2.2 / 2.3 viram um objeto só, e
 *     uma união descreve forma que NENHUMA versão aceita.
 *   - chave que ele nunca usou não existe — que é justo o caso em que o Tester
 *     deveria servir para mais.
 *
 * Este arquivo é a outra metade. A definição real de cada nó vem do pacote npm
 * (`n8n-nodes-base`, `@n8n/n8n-nodes-langchain`), por versão, com os enums, os
 * defaults, o que é obrigatório, e — a peça que vale mais que o enum — o
 * `displayOptions`, que diz sob qual `resource`/`operation`/`@version` cada
 * chave sequer EXISTE. É isso que transforma "chave plausível" em "chave
 * inaplicável", ou seja num portão booleano onde hoje há palpite.
 *
 * Medido: `redis` traz 26 propriedades, `operation` com enum
 * delete/get/incr/info/keys/llen/pop/publish/push/set, e `propertyName` com
 * default "propertyName" aparecendo SÓ quando `operation=get`. O esquema
 * codifica exatamente o defeito que custou debug a este projeto — sempre esteve
 * a um download de distância.
 *
 * A REGRA DE DEPENDÊNCIA ZERO CONTINUA VALENDO, e é por isso que o download é
 * um comando e não um `require`. Nada do servidor em execução importa qualquer
 * coisa de `.n8n-pkgs/`; os pacotes são lidos uma vez, na destilação, por um
 * processo FILHO. O motivo do filho é concreto: destilar exige pendurar um hook
 * em `Module._load` para stubar as três dependências de cada descriptor
 * (`n8n-workflow`, `lodash/*`, `./utils`), e sujar o carregador de módulos do
 * processo que serve o cockpit seria imprudente. O filho morre com o hook
 * dentro dele.
 *
 * O que este arquivo NÃO decide: se um fluxo é bom. Ele afirma fatos sobre a
 * definição dos nós. Quem julga é o portão em `tester.js` e a tela.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const PKGS = path.join(__dirname, ".n8n-pkgs");
const CACHE = path.join(__dirname, ".cache-esquema.json");

/* Versão do FORMATO da saída, do mesmo jeito e pelo mesmo motivo que
 * `CACHE_V` no catalog.js e `EXEC_CACHE_V` no server.js: no dia em que a
 * destilação passa a extrair um campo novo, o cache velho continuaria valendo e
 * a tela mostraria a informação nova como AUSENTE — que é indistinguível de
 * "esse nó não tem isso", e é mentira. Cache velho é descartado inteiro, nunca
 * remendado. Suba este número em qualquer mudança de forma. */
const ESQUEMA_V = 1;

/* O nome deste arquivo, para as mensagens.
 *
 * Não é firula: a cópia portátil em `docs/n8n-kb/` se chama
 * `extrair-esquema.js`, e uma mensagem que manda rodar `node esquema.js
 * --baixar` num projeto onde esse arquivo não existe é uma instrução que não
 * funciona — o pior tipo de mensagem de erro, porque parece resolver. */
const EU = path.basename(__filename);

/* Os pacotes que valem a pena. `n8n-nodes-base` é o núcleo; o langchain é toda
 * a pilha de agente (agent, memory, parser, tools) e sem ele 13 dos 52 tipos
 * que ele usa ficariam de fora — justamente os mais difíceis de acertar de
 * cabeça. O elevenlabs é comunidade e entra do mesmo jeito se estiver lá. */
const PACOTES = [
  { dir: "base", npm: "n8n-nodes-base", prefixo: "n8n-nodes-base" },
  { dir: "langchain", npm: "@n8n/n8n-nodes-langchain", prefixo: "@n8n/n8n-nodes-langchain" },
  /* Comunidade, e está instalado na instância dele — sem ele o `elevenLabs`
   * ficaria sem esquema e o portão de existência reprovaria um tipo real. Um
   * pacote de comunidade que não exista mais no npm falha no download e o resto
   * segue: `disponivel()` reporta o que faltou em vez de derrubar tudo. */
  { dir: "elevenlabs", npm: "@elevenlabs/n8n-nodes-elevenlabs", prefixo: "@elevenlabs/n8n-nodes-elevenlabs" }
];

/* ------------------------------------------------------------------ util */

const ehObj = v => v && typeof v === "object" && !Array.isArray(v);

function lerJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/* ---------------------------------------------------------- disponibilidade */

/* Três estados, nunca dois. Ausente, presente-e-vazio e presente-e-cheio são
 * histórias diferentes, e a lição já paga deste repositório é que um campo
 * ausente jamais pode cair no galho negativo: o aviso "não achei
 * tester-agentes.md" apareceu com o arquivo de 48KB no lugar, porque o processo
 * tinha subido antes do campo existir. Quem lê `disponivel()` tem que poder
 * dizer "os pacotes não foram baixados" em vez de "esse nó não existe". */
function disponivel() {
  const out = { pacotes: [], faltando: [], ok: false };
  for (const p of PACOTES) {
    const pkg = lerJson(path.join(PKGS, p.dir, "package.json"));
    const raiz = path.join(PKGS, p.dir, "dist", "nodes");
    if (pkg && fs.existsSync(raiz)) out.pacotes.push({ npm: p.npm, versao: pkg.version, dir: p.dir });
    else out.faltando.push(p.npm);
  }
  out.ok = out.pacotes.length > 0;
  return out;
}

/* ------------------------------------------------------------------ baixar */

/* `npm pack` em vez de `npm install`, de propósito: o tarball traz todos os
 * `dist/nodes/**\/*.node.js` e NÃO traz árvore de dependências, porque as
 * dependências são stubadas na destilação. 10MB de tarball contra ~83MB de
 * árvore instalada, e nenhum `node_modules` dentro do repositório para alguém
 * confundir com dependência de runtime. */
function baixar({ log = console.log } = {}) {
  fs.mkdirSync(PKGS, { recursive: true });
  for (const p of PACOTES) {
    log("baixando " + p.npm + " …");
    const r = spawnSync("npm", ["pack", p.npm, "--pack-destination", PKGS], {
      cwd: PKGS, encoding: "utf8", shell: process.platform === "win32", timeout: 10 * 60 * 1000
    });
    if (r.status !== 0) { log("  falhou: " + String(r.stderr || r.error || "").trim().slice(0, 300)); continue; }
    const tgz = fs.readdirSync(PKGS).filter(f => f.endsWith(".tgz") && f.includes(p.npm.replace(/^@/, "").replace("/", "-")));
    const alvo = tgz.sort().pop();
    if (!alvo) { log("  não achei o tarball de " + p.npm); continue; }
    const destino = path.join(PKGS, p.dir);
    fs.mkdirSync(destino, { recursive: true });
    log("  descompactando " + alvo + " (leva minutos: são ~26 mil arquivos)");
    const t = spawnSync("tar", ["-xzf", path.join(PKGS, alvo), "-C", destino, "--strip-components=1"], {
      encoding: "utf8", shell: process.platform === "win32", timeout: 20 * 60 * 1000
    });
    if (t.status !== 0) log("  tar falhou: " + String(t.stderr || t.error || "").trim().slice(0, 300));
  }
  const d = disponivel();
  log("pacotes prontos: " + (d.pacotes.map(x => x.npm + "@" + x.versao).join(", ") || "nenhum"));
  return d;
}

/* -------------------------------------------------------------- destilação */

/* Roda só no processo filho. Fora dele o `Module._load` fica intacto. */
function destilarAqui({ log = () => {} } = {}) {
  const Module = require("module");
  const original = Module._load;

  /* Um Proxy que responde a qualquer acesso e serializa como o nome da última
   * propriedade em minúscula. Isso não é preguiça: `NodeConnectionType.Main` é
   * exatamente a string "main", que é o valor certo, então o stub acerta o
   * único caso em que o valor importa para a saída. */
  function talvez(nome) {
    const f = function () { return talvez(nome); };
    return new Proxy(f, {
      get(_t, p) {
        if (p === "toJSON") return () => nome;
        if (p === Symbol.toPrimitive) return () => nome;
        /* `true`, e isto é o oposto do que parece intuitivo.
         *
         * Os descriptors são TypeScript compilado, então um import vira
         * `__importStar(require(…))` — e o helper do tsc, quando `__esModule` é
         * falso, COPIA as chaves enumeráveis do módulo para um objeto novo. Um
         * Proxy sobre função tem `length`/`name`/`prototype` e nada mais, então
         * a cópia sai sem o stub inteiro e `mod.description` vira `undefined`:
         * o Proxy morre na porta. Com `__esModule: true` o helper devolve o
         * módulo como veio e o stub sobrevive. Foi isto que fez `convertToFile`
         * falhar com `iCall.description is not iterable` mesmo já havendo
         * iterador. */
        if (p === "__esModule") return true;
        /* Iterável vazio, e não `undefined`.
         *
         * Vários descriptors fazem `...algumHelper()` para concatenar listas de
         * propriedade. Com o Proxy não-iterável, o spread lança
         * `X is not iterable`, o construtor morre e o tipo desaparece —
         * `convertToFile` sumiu por isto. Vazio degrada: a lista fica sem
         * aquelas propriedades e o resto do nó continua existindo. Perder
         * propriedade é ruim; perder o nó é pior, porque o portão de existência
         * do `tester.js` passa a reprovar um tipo que é real. */
        if (p === Symbol.iterator) return function* () {};
        if (typeof p === "symbol") return undefined;
        return talvez(String(p).toLowerCase());
      },
      construct() { return {}; },
      apply() { return talvez(nome); }
    });
  }

  /* Estas duas funções precisam ser REAIS, não Proxy, e a descoberta custou
   * onze tipos de nó — entre eles `slack` e `whatsApp`, dois dos que ele mais
   * usa. `updateDisplayOptions` é como uma boa parte dos nós PENDURA o
   * `displayOptions` numa lista de propriedades: a lista é declarada limpa e o
   * predicado `{show:{resource:['channel']}}` é injetado depois. Stubada como
   * Proxy, a chamada devolve um Proxy que não é iterável, o construtor morre com
   * `(0 , n8n_workflow_1.updateDisplayOptions) is not a function or its return
   * value is not iterable`, e o tipo desaparece do esquema em silêncio.
   *
   * Ou seja: a função que eu ia stubar é exatamente a que carrega a informação
   * pela qual este arquivo existe. O `merge` é o do lodash, semântica
   * transcrita do fonte (`merge({}, prop.displayOptions, displayOptions)`):
   * objeto funde recursivamente, array funde por índice, escalar sobrescreve. */
  const fundir = (a, b) => {
    if (!ehObj(a) && !Array.isArray(a)) return b === undefined ? a : b;
    if (b === undefined) return a;
    if (Array.isArray(a) && Array.isArray(b)) {
      const out = a.slice();
      for (let i = 0; i < b.length; i++) out[i] = fundir(out[i], b[i]);
      return out;
    }
    if (!ehObj(a) || !ehObj(b)) return b;
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = fundir(out[k], v);
    return out;
  };
  const updateDisplayOptions = (displayOptions, properties) =>
    (Array.isArray(properties) ? properties : []).map(p => ({ ...p, displayOptions: fundir(p && p.displayOptions, displayOptions) }));

  /* O `VersionedNodeType` precisa ser real, não Proxy: é o construtor que
   * guarda `nodeVersions`, e é dele que sai a separação por versão — que é o
   * ponto inteiro deste arquivo. Stubado como Proxy, `new If()` devolve um
   * objeto sem nenhuma chave e o nó multi-versão desaparece em silêncio. */
  class VersionedNodeType {
    constructor(nodeVersions, description) {
      this.nodeVersions = nodeVersions;
      this.description = description;
      this.currentVersion = description && description.defaultVersion;
    }
  }
  const conhecidos = {
    VersionedNodeType,
    updateDisplayOptions,
    NodeConnectionType: new Proxy({}, { get: (_t, p) => String(p).toLowerCase() }),
    NodeConnectionTypes: new Proxy({}, { get: (_t, p) => String(p).toLowerCase() })
  };
  const n8nWorkflow = new Proxy(conhecidos, {
    get(t, p) { return p in t ? t[p] : talvez(String(p)); },
    has() { return true; }
  });

  Module._load = function (req) {
    if (req === "n8n-workflow" || req === "n8n-core") return n8nWorkflow;
    try { return original.apply(this, arguments); } catch { return talvez(req); }
  };

  const nodes = {};
  const pacotes = [];
  let lidos = 0, falhas = 0;
  /* Um nó cujo construtor estoura desaparecia SEM CONTAGEM, e isso é o defeito
   * mais perigoso que este arquivo pode ter: o portão de existência do
   * `tester.js` lê a ausência como "esse tipo não existe" e reprova um fluxo
   * correto. `slack` e `whatsApp` ficaram fora de uma rodada inteira exatamente
   * assim. O que não carregou tem nome, e sai no relatório. */
  const naoColheram = [];

  for (const p of PACOTES) {
    const pkgPath = path.join(PKGS, p.dir, "package.json");
    const pkg = lerJson(pkgPath);
    const raiz = path.join(PKGS, p.dir, "dist", "nodes");
    if (!pkg || !fs.existsSync(raiz)) continue;
    pacotes.push({ npm: p.npm, versao: pkg.version });

    for (const arq of achar(raiz)) {
      let mod;
      try {
        mod = require(arq);
      } catch (e) {
        falhas++;
        log("  não carregou " + path.relative(PKGS, arq) + ": " + String(e && e.message).slice(0, 120));
        continue;
      }
      for (const [nomeExport, Cls] of Object.entries(mod)) {
        if (typeof Cls !== "function") continue;
        const rel = path.relative(PKGS, arq).replace(/\\/g, "/");
        let inst;
        try {
          inst = new Cls();
        } catch (e) {
          naoColheram.push({ arquivo: rel, exportado: nomeExport, porque: "construtor: " + String(e && e.message).slice(0, 120) });
          continue;
        }
        const colhido = colher(inst, p.prefixo);
        if (!colhido) {
          /* Sem `description.name` não há tipo. Acontece de verdade nos nós de
           * vector store, que montam a description por fábrica
           * (`createVectorStoreNode`) em vez de declará-la — e uma fábrica não
           * roda com as dependências stubadas. Dizer isso é melhor que somar
           * ao silêncio. */
          naoColheram.push({ arquivo: rel, exportado: nomeExport, porque: "sem `description.name` (provável fábrica de description)" });
          continue;
        }
        lidos++;
        /* Um mesmo tipo aparece em mais de um arquivo (o wrapper versionado e
         * cada VN dentro de `V1/`, `V2/`). Mesclar por versão em vez de o
         * último ganhar: o wrapper traz o mapa completo, os arquivos internos
         * às vezes trazem só uma. Quem tiver mais propriedades para aquela
         * versão fica. */
        const alvo = nodes[colhido.tipo] || (nodes[colhido.tipo] = { pacote: p.npm, nome: colhido.nome, grupo: colhido.grupo, versoes: {} });
        if (!alvo.nome && colhido.nome) alvo.nome = colhido.nome;
        /* As três flags viajam juntas. Copiar só `usaComoFerramenta` deixou
         * `pollTimes` e `requestOptions` acusados como chave desconhecida em
         * fluxos publicados que funcionam — a flag era lida certo e perdida na
         * mesclagem. */
        if (colhido.usaComoFerramenta) alvo.usaComoFerramenta = true;
        if (colhido.ehPolling) alvo.ehPolling = true;
        if (colhido.ehDeclarativo) alvo.ehDeclarativo = true;
        for (const [v, d] of Object.entries(colhido.versoes)) {
          const antigo = alvo.versoes[v];
          if (!antigo || (d.props || []).length > (antigo.props || []).length) alvo.versoes[v] = d;
        }

        /* Os pacotes trazem, ao lado do nó, um `__schema__/` com o JSON Schema
         * do que cada operação DEVOLVE — 169 nós de base, 1018 arquivos. Isso
         * responde uma pergunta diferente da lista de propriedades e igualmente
         * caçadora de defeito silencioso: depois que o nó roda, quais campos
         * existem em `$json`. É a diferença entre escrever `{{ $json.channel }}`
         * e `{{ $json.channel.id }}` — as duas importam sem erro e só uma
         * funciona. Serve também para as `seeds.json` do fantasma saírem com
         * NOME DE CAMPO real, que é a única parte das sementes que não pode ser
         * inventada.
         *
         * São schemas: só nome e tipo de campo, valor nenhum, em nenhum nível. */
        const saidas = colherSaidas(path.join(path.dirname(arq), "__schema__"));
        for (const [v, ops] of Object.entries(saidas)) {
          const d = alvo.versoes[v];
          if (!d) continue;
          d.devolve = { ...(d.devolve || {}), ...ops };
        }
      }
    }
  }

  /* As variantes `…Tool`.
   *
   * O n8n GERA um tipo novo para todo nó marcado `usableAsTool`: o
   * `googleSheets` vira também `googleSheetsTool`, que é o mesmo nó pendurado na
   * porta `ai_tool` de um agente. Essa variante não existe como arquivo no
   * pacote, então sem isto quatro tipos que ele usa de verdade
   * (`googleSheetsTool`, `clickUpTool`, `googleDocsTool`, `dataTableTool`)
   * ficariam fora do esquema — e o portão de existência os reprovaria.
   *
   * A regra é a do próprio n8n (a flag), não um palpite sobre sufixo: um alias
   * para todo nó daria 500 tipos falsos e o portão passaria a aceitar
   * `slackTool` sem que ele exista. As duas propriedades que o n8n injeta na
   * variante entram declaradas como injetadas — elas não estão no pacote, e o
   * portão precisa conhecê-las para não acusar chave desconhecida. */
  const PROPS_TOOL = [
    { nome: "descriptionType", tipo: "options", enum: ["auto", "manual"], padrao: "auto", injetadaPeloN8n: true },
    /* SEM `quando`, de propósito. A declaração real é do n8n e eu não a tenho;
     * medido, fluxos publicados escrevem `toolDescription` sem declarar
     * `descriptionType`, e um portão que reprova isso reprova fluxo bom por
     * causa de um predicado que EU inventei. Numa propriedade injetada, o certo
     * é ser permissivo. */
    { nome: "toolDescription", tipo: "string", injetadaPeloN8n: true }
  ];
  /* `pollTimes` e `requestOptions`: mesma história, gatilhada por flag. */
  const PROPS_POLLING = [{ nome: "pollTimes", tipo: "fixedCollection", injetadaPeloN8n: true }];
  const PROPS_DECLARATIVO = [{ nome: "requestOptions", tipo: "collection", injetadaPeloN8n: true }];

  for (const n of Object.values(nodes)) {
    const extra = [...(n.ehPolling ? PROPS_POLLING : []), ...(n.ehDeclarativo ? PROPS_DECLARATIVO : [])];
    if (!extra.length) continue;
    for (const d of Object.values(n.versoes)) d.props = [...extra, ...(d.props || [])];
  }

  let variantes = 0;
  for (const [tipo, n] of Object.entries({ ...nodes })) {
    if (!n.usaComoFerramenta) continue;
    const alvo = tipo + "Tool";
    if (nodes[alvo]) continue;
    const versoes = {};
    for (const [v, d] of Object.entries(n.versoes)) versoes[v] = { ...d, props: [...PROPS_TOOL, ...(d.props || [])] };
    nodes[alvo] = { pacote: n.pacote, nome: (n.nome || tipo) + " (como ferramenta)", grupo: n.grupo, variantePorFerramentaDe: tipo, versoes };
    variantes++;
  }

  return {
    v: ESQUEMA_V,
    geradoEm: new Date().toISOString(),
    pacotes,
    nosLidos: lidos,
    arquivosComFalha: falhas,
    variantesDeFerramenta: variantes,
    /* Reportado, nunca omitido: a ausência de um tipo aqui é lida adiante como
     * "não existe", e a diferença entre "não existe" e "não consegui ler"
     * decide se um portão reprova fluxo bom. */
    naoColheram,
    tipos: Object.keys(nodes).length,
    nodes
  };
}

/* `__schema__/v2.3.0/channel/create.json` → `{ "2.3": { "channel:create": […] } }`.
 *
 * A pasta é `v2.3.0` e a `typeVersion` do nó é `2.3`: o terceiro segmento é
 * patch de schema e não existe do lado do fluxo. Casar sem cortá-lo produziria
 * a chave "2.3.0", que nunca bate com nó nenhum — o mesmo tipo de erro
 * silencioso da chave de cache concatenada à mão que este repositório já pagou
 * duas vezes. `v1.0.0` vira "1", não "1.0". */
const TETO_CAMPOS = 60;

function versaoDePasta(nome) {
  const m = /^v(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(nome);
  if (!m) return null;
  const menor = m[2] && m[2] !== "0" ? "." + m[2] : (m[2] ? ".0" : "");
  /* `.0` só sobrevive quando estava escrito: `v4.0.0` é a typeVersion 4 nos
   * fluxos, e "4.0" não casaria com "4". */
  return m[2] === undefined ? m[1] : (m[2] === "0" ? m[1] : m[1] + "." + m[2]);
}

function camposDeSchema(sch, prefixo = "", prof = 0, acc = []) {
  if (!ehObj(sch) || acc.length >= TETO_CAMPOS) return acc;
  if (sch.type === "array" && ehObj(sch.items)) return camposDeSchema(sch.items, prefixo, prof, acc);
  const props = ehObj(sch.properties) ? sch.properties : null;
  if (!props) return acc;
  for (const [k, v] of Object.entries(props)) {
    if (acc.length >= TETO_CAMPOS) break;
    const t = ehObj(v) ? (Array.isArray(v.type) ? v.type.join("|") : v.type) : null;
    acc.push(prefixo + k + (t ? ":" + t : ""));
    /* Dois níveis. Mais que isso é uma parede que não ajuda a escrever uma
     * expressão, e o objetivo aqui é o nome do campo, não o contrato inteiro. */
    if (prof < 1 && ehObj(v) && (v.properties || (ehObj(v.items) && v.items.properties))) {
      camposDeSchema(v, prefixo + k + ".", prof + 1, acc);
    }
  }
  return acc;
}

function colherSaidas(dirSchema) {
  const out = {};
  let raiz;
  try { raiz = fs.readdirSync(dirSchema, { withFileTypes: true }); } catch { return out; }
  for (const v of raiz) {
    if (!v.isDirectory()) continue;
    const versao = versaoDePasta(v.name);
    if (!versao) continue;
    const ops = {};
    const andar = (dir, rotulo) => {
      let itens;
      try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const it of itens) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) andar(p, rotulo ? rotulo + ":" + it.name : it.name);
        else if (it.isFile() && it.name.endsWith(".json")) {
          const sch = lerJson(p);
          if (!sch) continue;
          const chave = (rotulo ? rotulo + ":" : "") + it.name.replace(/\.json$/, "");
          const campos = camposDeSchema(sch);
          if (campos.length) ops[chave] = campos;
        }
      }
    };
    andar(path.join(dirSchema, v.name), "");
    if (Object.keys(ops).length) out[versao] = ops;
  }
  return out;
}

function achar(raiz, acc = []) {
  for (const e of fs.readdirSync(raiz, { withFileTypes: true })) {
    const p = path.join(raiz, e.name);
    if (e.isDirectory()) achar(p, acc);
    else if (e.isFile() && e.name.endsWith(".node.js")) acc.push(p);
  }
  return acc;
}

/* Um nó do n8n vem em dois formatos, e os dois têm que ser lidos:
 *   - `VersionedNodeType`: `nodeVersions` é um mapa versão → implementação, e
 *     cada implementação tem a sua própria lista de propriedades. É aqui que a
 *     união entre versões do catalog.js deixa de ser necessária.
 *   - nó simples: `description.version` é um número OU um ARRAY de números
 *     (`[1, 1.1, 1.2]`), e nesse caso todas as versões compartilham a mesma
 *     lista. Tratar o array como número produziria a chave "1,1.1,1.2". */
function colher(inst, prefixo) {
  const base = inst.description || (inst.baseDescription || null);
  if (!base || typeof base !== "object") return null;
  const nomeCurto = base.name;
  if (typeof nomeCurto !== "string" || !nomeCurto) return null;

  const tipo = nomeCurto.includes(".") ? nomeCurto : prefixo + "." + nomeCurto;
  const saida = { tipo, nome: str(base.displayName), grupo: base.group, versoes: {} };
  /* A flag pode estar na description base OU dentro da de uma versão — o
   * `googleSheets` a declara na base, o `clickUp` só na V2. Ler só um dos dois
   * lugares perde metade das variantes. */
  if (base.usableAsTool === true) saida.usaComoFerramenta = true;
  marcarInjecoes(saida, base);

  if (ehObj(inst.nodeVersions)) {
    for (const [v, impl] of Object.entries(inst.nodeVersions)) {
      const d = impl && impl.description;
      if (!ehObj(d)) continue;
      if (d.usableAsTool === true) saida.usaComoFerramenta = true;
      marcarInjecoes(saida, d);
      saida.versoes[v] = versao(d);
    }
    return Object.keys(saida.versoes).length ? saida : null;
  }

  const vs = Array.isArray(base.version) ? base.version : [base.version == null ? 1 : base.version];
  const corpo = versao(base);
  for (const v of vs) saida.versoes[String(v)] = corpo;
  return saida;
}

/* Três propriedades reais que NÃO estão na lista do pacote porque o n8n as
 * injeta conforme uma flag da description. Medido nos 99 fluxos publicados: sem
 * isto o portão acusava `pollTimes` em todo trigger de polling
 * (googleSheetsTrigger, gmailTrigger) e `requestOptions` em todo nó declarativo
 * (elevenLabs, perplexity) — chaves corretas, em fluxos que funcionam.
 *
 * A regra é a flag do próprio n8n, nunca o nome: `polling: true` e
 * `requestDefaults`. Aceitar `pollTimes` em qualquer nó transformaria o portão
 * numa peneira. */
function marcarInjecoes(saida, d) {
  if (d.polling === true) saida.ehPolling = true;
  if (ehObj(d.requestDefaults)) saida.ehDeclarativo = true;
}

function versao(d) {
  return {
    props: (Array.isArray(d.properties) ? d.properties : []).map(prop).filter(Boolean),
    credenciais: (Array.isArray(d.credentials) ? d.credentials : [])
      .map(c => c && c.name ? { tipo: str(c.name), obrigatorio: !!c.required } : null).filter(Boolean),
    /* Quantas saídas o tipo tem, e como se chamam. É o que separa um `if` (duas
     * saídas por índice) de um agente (portas nomeadas `ai_*`). Vem stubado
     * como string minúscula pelo Proxy — é isso que "main"/"ai_tool" são. */
    entradas: portas(d.inputs),
    saidas: portas(d.outputs),
    rotulosDeSaida: (Array.isArray(d.outputNames) ? d.outputNames.map(str) : []).filter(Boolean)
  };
}

function portas(v) {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(x => ehObj(x) ? str(x.type) : str(x)).filter(Boolean);
  /* Expressão do n8n (`={{ … }}`) para portas dinâmicas, ou um Proxy do stub.
   * Nos dois casos o honesto é dizer que não foi possível ler, e não inventar
   * uma lista de portas que o portão depois usaria para reprovar fluxo bom. */
  return null;
}

function str(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  /* Um Proxy do stub serializa via toJSON; qualquer outra coisa não é texto e
   * não deve virar texto. */
  try { const s = v && typeof v.toJSON === "function" ? v.toJSON() : null; return typeof s === "string" ? s : null; }
  catch { return null; }
}

/* O `options` de uma propriedade quer dizer TRÊS coisas diferentes conforme o
 * `type`, e confundi-las é o jeito mais rápido de produzir um esquema que
 * parece certo e mente:
 *   - `options` / `multiOptions`  → é ENUM: `[{name, value}]`, e o que vai no
 *     JSON é `value`.
 *   - `collection`                → é uma lista de PROPRIEDADES INTERNAS, todas
 *     opcionais, dentro de um objeto.
 *   - `fixedCollection`           → é uma lista de GRUPOS nomeados
 *     (`[{name, values:[prop…]}]`); no JSON viram `{ grupo: {…} }` ou
 *     `{ grupo: [{…}] }` quando `multipleValues`.
 * Ler `fixedCollection.options` como enum daria um enum de nomes de grupo, que
 * não é valor de nada. */
function prop(p) {
  if (!ehObj(p) || typeof p.name !== "string" || !p.name) return null;
  const tipo = str(p.type) || "unknown";
  const o = { nome: p.name, tipo };

  if (p.required) o.obrigatorio = true;
  if (p.default !== undefined && ehSerializavel(p.default)) o.padrao = p.default;

  if ((tipo === "options" || tipo === "multiOptions") && Array.isArray(p.options)) {
    const vals = p.options.map(x => ehObj(x) ? x.value : undefined)
      .filter(v => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
    if (vals.length) o.enum = vals;
  } else if (tipo === "collection" && Array.isArray(p.options)) {
    const dentro = p.options.map(prop).filter(Boolean);
    if (dentro.length) o.dentro = dentro;
  } else if (tipo === "fixedCollection" && Array.isArray(p.options)) {
    const grupos = {};
    for (const g of p.options) {
      if (!ehObj(g) || typeof g.name !== "string") continue;
      grupos[g.name] = {
        lista: !!p.typeOptions && !!p.typeOptions.multipleValues,
        campos: (Array.isArray(g.values) ? g.values : []).map(prop).filter(Boolean)
      };
    }
    if (Object.keys(grupos).length) o.grupos = grupos;
  } else if (tipo === "resourceLocator" && Array.isArray(p.modes)) {
    const m = p.modes.map(x => ehObj(x) ? str(x.name) : null).filter(Boolean);
    if (m.length) o.modos = m;
  }

  if (ehObj(p.displayOptions)) {
    if (ehObj(p.displayOptions.show)) o.quando = limparCond(p.displayOptions.show);
    if (ehObj(p.displayOptions.hide)) o.quandoNao = limparCond(p.displayOptions.hide);
  }
  if (ehObj(p.typeOptions) && p.typeOptions.multipleValues) o.multiplos = true;
  return o;
}

/* As condições do n8n aceitam valor literal, ou um objeto `{_cnd:{gte:2.1}}`.
 * Guardo os dois, mas só o que é serializável: um Proxy do stub dentro de uma
 * condição viraria `{}` e o portão leria isso como "condição vazia, logo
 * satisfeita", que é exatamente o falso positivo que reprova fluxo bom. */
function limparCond(cond) {
  const out = {};
  for (const [k, v] of Object.entries(cond)) {
    if (!Array.isArray(v)) continue;
    const vals = v.filter(x => ehSerializavel(x));
    if (vals.length) out[k] = vals;
  }
  return Object.keys(out).length ? out : undefined;
}

function ehSerializavel(v, prof = 0) {
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "function") return false;
  if (prof > 4) return false;
  if (Array.isArray(v)) return v.every(x => ehSerializavel(x, prof + 1));
  if (ehObj(v)) {
    /* Proxy do stub tem `toJSON`; objeto de verdade de parâmetro não tem. */
    if (typeof v.toJSON === "function") return false;
    return Object.values(v).every(x => ehSerializavel(x, prof + 1));
  }
  return false;
}

/* ------------------------------------------------------------------ cache */

function lerCache() {
  const j = lerJson(CACHE);
  if (!j || j.v !== ESQUEMA_V || !j.nodes) return null;
  return j;
}

/* O resumo, para quem só precisa saber SE está pronto — a rota de status, a
 * tela de abertura, o aviso antes do build.
 *
 * Isto existe porque `lerCache()` custa 211ms: ele faz `JSON.parse` de 9,4MB.
 * A tela de abertura poleia o status a cada 4 segundos, então a versão ingênua
 * gastava 190ms de CPU bloqueante a cada 4s num servidor de uma thread que
 * também segura SSE aberto. Medido: `/api/tester/status` respondia em ~190ms e
 * passou a responder em ~1ms.
 *
 * O cache é por MTIME, não por tempo: destilar de novo troca o arquivo e o
 * resumo se refaz na chamada seguinte. Um TTL faria a tela dizer "não
 * destilado" por até N segundos depois de destilar, que é o tipo de mentira
 * temporária que este projeto já resolveu não contar. */
let resumoCache = { mtime: 0, valor: null };

function resumo() {
  let st;
  try { st = fs.statSync(CACHE); }
  catch {
    const d = disponivel();
    return {
      pronto: false,
      porque: d.ok
        ? "os pacotes estão baixados, mas o esquema não foi destilado — rode `node " + EU + " --construir`"
        : "os pacotes de nó não foram baixados — rode `node " + EU + " --baixar` e depois `--construir`",
      faltando: d.faltando
    };
  }
  if (resumoCache.mtime === st.mtimeMs && resumoCache.valor) return resumoCache.valor;

  const j = lerCache();
  const valor = j
    ? { pronto: true, tipos: j.tipos, pacotes: j.pacotes, geradoEm: j.geradoEm, naoColheram: (j.naoColheram || []).length }
    /* Arquivo existe e não serve: versão de formato velha, ou truncado. Dizer
     * qual dos dois importa — "destile de novo" e "seu disco encheu no meio da
     * escrita" levam a ações diferentes. */
    : { pronto: false, porque: "o `.cache-esquema.json` existe mas não é legível nesta versão de formato — rode `node " + EU + " --construir`", faltando: [] };

  resumoCache = { mtime: st.mtimeMs, valor };
  return valor;
}

function gravarCache(e) {
  const tmp = CACHE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(e), "utf8");
  fs.renameSync(tmp, CACHE);
}

/* Constrói no FILHO. O hook em `Module._load` morre com ele. */
function construirEmFilho({ log = () => {} } = {}) {
  return new Promise((ok, no) => {
    const f = spawn(process.execPath, [__filename, "--construir", "--json"], {
      cwd: __dirname, stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", err = "";
    f.stdout.setEncoding("utf8"); f.stdout.on("data", d => out += d);
    f.stderr.setEncoding("utf8"); f.stderr.on("data", d => { err += d; log(String(d).trim()); });
    f.on("error", no);
    f.on("close", c => {
      if (c !== 0) return no(new Error("destilação falhou (código " + c + "): " + err.trim().slice(0, 300)));
      try { ok(JSON.parse(out)); } catch (e) { no(new Error("destilação devolveu algo que não é JSON: " + String(e.message))); }
    });
  });
}

/* O ponto de entrada do resto do cockpit.
 *
 * Falha MOLE, sempre. Sem pacote baixado, sem cache e sem conseguir destilar, o
 * retorno é `{ok:false, porque}` e quem chama volta ao comportamento de hoje. O
 * Tester não pode parar de funcionar porque um esquema não estava lá — e o
 * portão que nasce daqui é fail-open pelo mesmo motivo. */
async function get({ refresh = false, log = () => {} } = {}) {
  if (!refresh) {
    const c = lerCache();
    if (c) return { ok: true, esquema: c, doCache: true };
  }
  const d = disponivel();
  if (!d.ok) {
    return { ok: false, porque: "os pacotes de nó não foram baixados — rode `node " + EU + " --baixar` (faltando: " + d.faltando.join(", ") + ")", disponivel: d };
  }
  try {
    const e = await construirEmFilho({ log });
    gravarCache(e);
    return { ok: true, esquema: e, doCache: false };
  } catch (err) {
    const c = lerCache();
    if (c) return { ok: true, esquema: c, doCache: true, aviso: String(err.message) };
    return { ok: false, porque: String(err.message), disponivel: d };
  }
}

/* --------------------------------------------------- consulta e conferência */

/* Resolver a versão pedida contra as que existem. Exato primeiro; depois a
 * maior que não passa da pedida (o n8n roda parâmetro de v2.2 num nó declarado
 * 2.3, mas o contrário não vale); por último a maior de todas, e nesse caso
 * quem chama tem que saber que houve aproximação, porque um portão que reprova
 * em cima de uma versão aproximada reprova fluxo bom. */
function versaoDe(esquema, tipo, versaoPedida) {
  const n = esquema && esquema.nodes && esquema.nodes[tipo];
  if (!n) return null;
  const vs = Object.keys(n.versoes);
  if (!vs.length) return null;
  const pedida = Number(versaoPedida);
  const alvo = String(versaoPedida);
  if (n.versoes[alvo]) return { versao: alvo, exata: true, dados: n.versoes[alvo], no: n };
  if (Number.isFinite(pedida)) {
    const menores = vs.map(Number).filter(v => Number.isFinite(v) && v <= pedida).sort((a, b) => b - a);
    if (menores.length) {
      const k = vs.find(v => Number(v) === menores[0]);
      return { versao: k, exata: false, dados: n.versoes[k], no: n };
    }
  }
  const maior = vs.map(Number).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const k = vs.find(v => Number(v) === maior) || vs[0];
  return { versao: k, exata: false, dados: n.versoes[k], no: n };
}

/* Avaliar `displayOptions` sem nunca fingir certeza.
 *
 * Três resultados, não dois: `true` (a chave se aplica), `false` (não se
 * aplica, com confiança), e `null` (não sei). O `null` existe porque as
 * condições do n8n incluem operadores (`_cnd` com gte/lte/eq/not/between/
 * startsWith/includes/regex) e referências a `@version`, e chutar um deles como
 * falso reprovaria fluxo correto. Quem consome trata `null` como "não gate".
 *
 * Semântica, transcrita do comportamento do editor: dentro de `show`, TODAS as
 * chaves precisam casar (E), e a lista de cada chave é alternativa (OU).
 * `hide` é o inverso: casar qualquer uma esconde. */
function aplica(p, params, versaoNum) {
  const av = (cond, esconder) => {
    if (!ehObj(cond)) return true;
    let indeciso = false;
    for (const [chave, aceitos] of Object.entries(cond)) {
      const valor = chave === "@version" ? versaoNum : params ? params[chave] : undefined;
      /* Um discriminador escrito como EXPRESSÃO (`={{ $json.op }}`) só tem valor
       * em execução, e o cockpit não executa. Tratá-lo como um literal que não
       * casa marcaria como inaplicável TODA chave que depende dele — um fluxo
       * legítimo com `operation` dinâmico sairia reprovado inteiro. Não sei, e
       * não invento. */
      if (typeof valor === "string" && valor.startsWith("=")) { indeciso = true; continue; }
      let casou = false, naoSei = false;
      for (const a of aceitos) {
        if (ehObj(a) && a._cnd) {
          const r = cnd(a._cnd, valor);
          if (r === null) naoSei = true; else if (r) casou = true;
        } else if (a === valor) casou = true;
        else if (valor === undefined && a === undefined) casou = true;
      }
      if (casou) { if (esconder) return true; continue; }
      if (naoSei || valor === undefined) { indeciso = true; continue; }
      if (!esconder) return false;
    }
    if (indeciso) return null;
    return esconder ? false : true;
  };

  const mostrar = p.quando ? av(p.quando, false) : true;
  if (mostrar === false) return false;
  const esconde = p.quandoNao ? av(p.quandoNao, true) : false;
  if (esconde === true) return false;
  if (mostrar === null || esconde === null) return null;
  return true;
}

function cnd(c, valor) {
  const n = Number(valor);
  const num = op => Number.isFinite(n) && Number.isFinite(Number(c[op]));
  if ("eq" in c) return valor === c.eq;
  if ("not" in c) return valor !== c.not;
  if ("gte" in c) return num("gte") ? n >= Number(c.gte) : null;
  if ("lte" in c) return num("lte") ? n <= Number(c.lte) : null;
  if ("gt" in c) return num("gt") ? n > Number(c.gt) : null;
  if ("lt" in c) return num("lt") ? n < Number(c.lt) : null;
  if ("between" in c && ehObj(c.between)) {
    const { from, to } = c.between;
    return Number.isFinite(n) && Number.isFinite(Number(from)) && Number.isFinite(Number(to)) ? n >= Number(from) && n <= Number(to) : null;
  }
  if ("startsWith" in c) return typeof valor === "string" ? valor.startsWith(String(c.startsWith)) : null;
  if ("endsWith" in c) return typeof valor === "string" ? valor.endsWith(String(c.endsWith)) : null;
  if ("includes" in c) return typeof valor === "string" ? valor.includes(String(c.includes)) : null;
  if ("exists" in c) return valor !== undefined;
  return null;   // operador que eu não conheço: não sei, e não invento
}

/* UM NOME DE PROPRIEDADE APARECE VÁRIAS VEZES, e ignorar isso foi o defeito que
 * fez o portão marcar 14,4% dos nós de 99 fluxos publicados que funcionam.
 *
 * O n8n declara uma entrada por combinação de resource/operation. No
 * `googleSheets` v4.7 existem DUAS `documentId`: uma sob `resource:sheet` e
 * outra sob `resource:spreadsheet, operation:deleteSpreadsheet`. Um `Map` por
 * nome guarda a última e avalia o predicado errado — o editor, ao contrário,
 * renderiza a declaração que casa. Então a semântica certa é OU: a chave vale
 * se QUALQUER declaração com aquele nome vale. */
function agrupar(props) {
  const m = new Map();
  for (const p of props || []) {
    if (!m.has(p.nome)) m.set(p.nome, []);
    m.get(p.nome).push(p);
  }
  return m;
}

/* Preencher os defaults antes de avaliar.
 *
 * Um fluxo real OMITE o parâmetro que está no default: nenhum nó `googleSheets`
 * escreve `resource: "sheet"`, porque é o valor padrão. Sem resolver isso, todo
 * predicado que depende de `resource` cai em "não sei" e o esquema fica cego
 * justamente nos discriminadores — que é a informação pela qual ele existe.
 *
 * Passa três vezes porque os defaults se destravam em cadeia: `resource` não
 * tem condição e entra na primeira; `operation` só se aplica depois que
 * `resource` existe, e entra na segunda. Três é folga sobre o que se observa. */
function resolver(props, params, vnum) {
  const grupos = agrupar(props);
  const res = { ...(params || {}) };
  for (let volta = 0; volta < 3; volta++) {
    let mudou = false;
    for (const [nome, lista] of grupos) {
      if (nome in res) continue;
      for (const p of lista) {
        if (p.padrao === undefined) continue;
        const t = typeof p.padrao;
        if (t !== "string" && t !== "number" && t !== "boolean") continue;
        if (aplica(p, res, vnum) !== true) continue;
        res[nome] = p.padrao;
        mudou = true;
        break;
      }
    }
    if (!mudou) break;
  }
  return res;
}

/* Verdadeiro se alguma declaração se aplica; `null` se nenhuma se aplica com
 * certeza mas alguma é indecisa; falso só quando TODAS negam. */
function aplicaAlguma(lista, params, vnum) {
  let indeciso = false;
  for (const p of lista) {
    const a = aplica(p, params, vnum);
    if (a === true) return { valor: true, prop: p };
    if (a === null) indeciso = true;
  }
  return { valor: indeciso ? null : false, prop: lista[0] };
}

/* As propriedades que valem para o estado atual dos parâmetros. É isto que vai
 * no prompt: dez propriedades aplicáveis em vez do catálogo inteiro. */
function propsAplicaveis(esquema, tipo, versaoPedida, params) {
  const r = versaoDe(esquema, tipo, versaoPedida);
  if (!r) return null;
  const vnum = Number(r.versao);
  const resolvidos = resolver(r.dados.props, params, vnum);
  const out = [];
  for (const [nome, lista] of agrupar(r.dados.props)) {
    const { valor, prop } = aplicaAlguma(lista, resolvidos, vnum);
    if (valor === false) continue;
    /* A declaração que casou é a que descreve a forma. Cair na primeira quando
     * nenhuma casou com certeza é o comportamento honesto: marcada `talvez`, o
     * prompt a mostra e o portão não a usa. */
    const escolhida = valor === true ? prop : { ...prop, talvez: true };
    out.push(nome === escolhida.nome ? escolhida : { ...escolhida, nome });
  }
  return { versao: r.versao, exata: r.exata, props: out, credenciais: r.dados.credenciais, saidas: r.dados.saidas, rotulosDeSaida: r.dados.rotulosDeSaida, devolve: r.dados.devolve };
}

/* Tipos de parâmetro cuja forma JSON mora no WIDGET do editor, não na lista de
 * propriedades. O descriptor diz `type: "filter"` e não diz como um filter é
 * escrito — essa forma vem de exemplar real (`gramatica.md`). Por isso a
 * conferência não desce dentro deles: um "chave desconhecida" aqui seria uma
 * afirmação sobre uma forma que este arquivo não conhece. */
const OPACOS = new Set(["filter", "assignmentCollection", "resourceLocator", "resourceMapper", "json", "workflowSelector", "credentials", "curlImport", "callout", "notice", "hidden", "unknown"]);

/* A conferência que vira portão.
 *
 * Três achados, todos com o nome da chave:
 *   - `desconhecida`: chave que a definição daquele tipo+versão não tem. Hoje
 *     ela importa e simplesmente não faz nada.
 *   - `inaplicavel`: chave real, mas que não existe sob o `resource`/`operation`
 *     escolhido. Mesmo efeito silencioso.
 *   - `enum`: discriminador com valor fora do conjunto.
 *
 * FAIL-OPEN em cinco pontos, e cada um deles impede uma reprovação falsa: sem
 * esquema, tipo ausente, versão aproximada (`exata: false`), predicado
 * indeciso (`talvez`), e tipo opaco. Um portão que dispara por falta de
 * conhecimento bloqueia fluxo bom, que é pior que o defeito que ele caça. */
function conferir(esquema, node) {
  const achados = [];
  if (!esquema || !node || !ehObj(node)) return achados;
  const tipo = node.type, params = ehObj(node.parameters) ? node.parameters : {};
  const r = versaoDe(esquema, tipo, node.typeVersion);
  if (!r) return achados;                      // tipo que não conheço: calo
  if (!r.exata) return achados;                // versão aproximada: calo

  const vnum = Number(r.versao);
  /* Avaliar contra os parâmetros COM os defaults resolvidos, não contra o que o
   * modelo escreveu: um fluxo correto omite o que está no default, e sem isto o
   * predicado fica indeciso em todo discriminador. */
  const raiz = resolver(r.dados.props, params, vnum);

  const andar = (valores, props, prefixo, contexto) => {
    const grupos = agrupar(props);
    for (const [k, v] of Object.entries(valores)) {
      const lista = grupos.get(k);
      if (!lista) {
        achados.push({ tipo: "desconhecida", chave: prefixo + k, no: node.name });
        continue;
      }
      const { valor: a, prop: p } = aplicaAlguma(lista, contexto, vnum);
      if (a === false) {
        /* Chave inaplicável com valor VAZIO não é acusada.
         *
         * O editor do n8n deixa `"options": {}` e `"filters": {}` para trás
         * quando a pessoa muda um discriminador — medido num fluxo que o próprio
         * Tester construiu e que funciona. Um objeto vazio não instrui nada:
         * não pode causar o erro silencioso que este portão existe para pegar,
         * e acusá-lo custaria uma rodada de modelo para remover um `{}`. Achado
         * correto e inconsequente é ruído, e ruído num portão que cobra caro
         * ensina a ignorar o portão. */
        const vazio = (ehObj(v) && !Object.keys(v).length) || (Array.isArray(v) && !v.length);
        if (!vazio) achados.push({ tipo: "inaplicavel", chave: prefixo + k, no: node.name, sob: lista.map(x => x.quando || x.quandoNao).filter(Boolean) });
        continue;
      }
      if (a === null) continue;                // indeciso: calo

      if (p.enum && (typeof v === "string" || typeof v === "number")) {
        /* Expressão no lugar de um enum é legítima: `={{ … }}` resolve em
         * execução, e o cockpit não executa. Não é palpite meu — é o único
         * valor que não pode ser conferido contra conjunto nenhum. */
        const expr = typeof v === "string" && v.startsWith("=");
        if (!expr && !p.enum.includes(v)) {
          achados.push({ tipo: "enum", chave: prefixo + k, no: node.name, valor: v, aceitos: p.enum });
        }
      }
      if (OPACOS.has(p.tipo)) continue;
      /* Dentro de uma coleção o contexto é o objeto local SOBRE o de fora: um
       * `displayOptions` de campo interno costuma citar tanto um irmão quanto o
       * `operation` do topo. */
      if (p.dentro && ehObj(v)) andar(v, p.dentro, prefixo + k + ".", { ...contexto, ...v });
      if (p.grupos && ehObj(v)) {
        for (const [g, conteudo] of Object.entries(v)) {
          const grupo = p.grupos[g];
          if (!grupo) { achados.push({ tipo: "desconhecida", chave: prefixo + k + "." + g, no: node.name }); continue; }
          const itens = Array.isArray(conteudo) ? conteudo : [conteudo];
          for (const it of itens) if (ehObj(it)) andar(it, grupo.campos, prefixo + k + "." + g + ".", { ...contexto, ...it });
        }
      }
    }
  };

  andar(params, r.dados.props, "", raiz);
  return achados;
}

/* ------------------------------------------------------- fatia para prompt */

/* O material grande vai para arquivo no diretório da corrida, nunca inline — o
 * prompt viaja em `-p` e a linha de comando do Windows acaba em 32767
 * caracteres. Aqui só se decide O QUE entra e se diz o que ficou de fora.
 *
 * Corta em fronteira de TIPO, do mesmo jeito e pelo mesmo motivo que o
 * `catalog.fatiaTexto`: cortar um JSON no meio da chave entrega ao modelo um
 * documento inválido e ele chuta a forma, queimando uma rodada. */
function fatia(esquema, tipos, teto = 90000) {
  if (!esquema) return { texto: "{}", omitidos: [], tipos: [] };
  const dentro = {}, omitidos = [], usados = [];
  let tamanho = 2;
  for (const t of tipos) {
    const n = esquema.nodes[t];
    if (!n) { omitidos.push(t + " (não está no esquema)"); continue; }
    const corpo = JSON.stringify(n);
    if (tamanho + corpo.length + t.length + 4 > teto) { omitidos.push(t + " (não caberia)"); continue; }
    dentro[t] = n;
    usados.push(t);
    tamanho += corpo.length + t.length + 4;
  }
  return { texto: JSON.stringify({ pacotes: esquema.pacotes, nodes: dentro }), omitidos, tipos: usados };
}

/* Só as versões pedidas de cada tipo. Um `if` tem 5 versões no esquema e a
 * construção usa uma; mandar as cinco é ensinar quatro formas erradas. */
function fatiaPorVersao(esquema, pares, teto = 90000) {
  if (!esquema) return { texto: "{}", omitidos: [], tipos: [] };
  const dentro = {}, omitidos = [], usados = [];
  let tamanho = 2;
  for (const { tipo, versao } of pares) {
    const r = versaoDe(esquema, tipo, versao);
    if (!r) { omitidos.push(tipo + " (não está no esquema)"); continue; }
    const n = esquema.nodes[tipo];
    const item = { pacote: n.pacote, nome: n.nome, versaoPedida: String(versao), versaoDoEsquema: r.versao, exata: r.exata, ...r.dados };
    const corpo = JSON.stringify(item);
    if (tamanho + corpo.length + tipo.length + 4 > teto) { omitidos.push(tipo + " (não caberia)"); continue; }
    dentro[tipo] = item;
    usados.push(tipo);
    tamanho += corpo.length + tipo.length + 4;
  }
  /* SEM indentação, e isso é medido, não estética.
   *
   * Com `null, 1` a fatia de 4 nós saía 95848 bytes para 54033 de conteúdo — o
   * recuo quase dobrava o arquivo. Quem lê é um modelo, que não ganha nada com
   * alinhamento e paga por cada byte em contexto e em tempo de leitura. O teto
   * do `fatiaPorVersao` também passa a medir a coisa certa: antes ele contava o
   * JSON compacto e escrevia o indentado, então o arquivo estourava um teto que
   * dizia ter respeitado. */
  return { texto: JSON.stringify({ pacotes: esquema.pacotes, nodes: dentro }), omitidos, tipos: usados };
}

/* ------------------------------------------------------------------- CLI */

if (require.main === module) {
  const args = process.argv.slice(2);
  const temJson = args.includes("--json");
  const log = temJson ? (m => process.stderr.write(String(m) + "\n")) : console.log;

  (async () => {
    if (args.includes("--baixar")) { baixar({ log }); return; }

    if (args.includes("--construir")) {
      const e = destilarAqui({ log });
      if (temJson) { process.stdout.write(JSON.stringify(e)); return; }
      gravarCache(e);
      log("tipos: " + e.tipos + " | nós lidos: " + e.nosLidos + " | arquivos com falha: " + e.arquivosComFalha);
      log("pacotes: " + e.pacotes.map(p => p.npm + "@" + p.versao).join(", "));
      log("gravado em " + path.basename(CACHE) + " (" + (fs.statSync(CACHE).size / 1048576).toFixed(1) + " MB)");
      return;
    }

    /* Conferir um arquivo de fluxo pela linha de comando. Serve ao cockpit
     * (checar um projeto salvo sem subir o servidor) e é o que faz a cópia
     * portátil deste arquivo ter valor sozinha, fora daqui. */
    if (args.includes("--conferir")) {
      const alvo = args[args.indexOf("--conferir") + 1];
      if (!alvo) { log("uso: node " + EU + " --conferir <arquivo.json>"); process.exitCode = 1; return; }
      const r = await get({ log });
      if (!r.ok) { log("sem esquema: " + r.porque); process.exitCode = 1; return; }
      let doc;
      try { doc = JSON.parse(fs.readFileSync(alvo, "utf8")); } catch (e) { log("não consegui ler `" + alvo + "`: " + e.message); process.exitCode = 1; return; }
      /* Aceita o workflow direto ou um envelope que o contenha (é a forma que
       * um projeto salvo e um template da API têm). */
      const wf = Array.isArray(doc.nodes) ? doc
        : (doc.wf && Array.isArray(doc.wf.nodes)) ? doc.wf
        : (doc.workflow && Array.isArray(doc.workflow.nodes)) ? doc.workflow
        : (doc.workflow && doc.workflow.workflow && Array.isArray(doc.workflow.workflow.nodes)) ? doc.workflow.workflow
        : null;
      if (!wf) { log("não achei `nodes` nesse arquivo"); process.exitCode = 1; return; }
      let n = 0;
      for (const nd of wf.nodes) {
        for (const a of conferir(r.esquema, nd)) {
          n++;
          if (a.tipo === "desconhecida") log("  " + nd.name + " (" + nd.type + " v" + nd.typeVersion + "): `" + a.chave + "` não existe nessa versão — o n8n aceita e ignora");
          else if (a.tipo === "inaplicavel") log("  " + nd.name + " (" + nd.type + " v" + nd.typeVersion + "): `" + a.chave + "` só existe sob outra combinação de resource/operation — ignorado sem aviso");
          else if (a.tipo === "enum") log("  " + nd.name + ": `" + a.chave + " = " + JSON.stringify(a.valor) + "` fora do conjunto aceito {" + a.aceitos.join("|") + "}");
        }
      }
      log(n ? "\n" + n + " achado(s) em " + wf.nodes.length + " nós." : "nenhum achado em " + wf.nodes.length + " nós.");
      /* Achado não é erro de execução: sai 0 de propósito, para poder rodar em
       * cima de um lote sem o script morrer no primeiro fluxo velho. */
      return;
    }

    if (args.includes("--ver")) {
      const alvo = args[args.indexOf("--ver") + 1];
      const r = await get({ log });
      if (!r.ok) { log("sem esquema: " + r.porque); process.exitCode = 1; return; }
      const n = r.esquema.nodes[alvo];
      if (!n) {
        const parecidos = Object.keys(r.esquema.nodes).filter(t => t.toLowerCase().includes(String(alvo).toLowerCase())).slice(0, 15);
        log("não achei `" + alvo + "`." + (parecidos.length ? " Parecidos: " + parecidos.join(", ") : ""));
        process.exitCode = 1; return;
      }
      log(alvo + " — " + (n.nome || "") + " [" + n.pacote + "] versões: " + Object.keys(n.versoes).join(", "));
      const v = args.includes("--versao") ? args[args.indexOf("--versao") + 1] : Object.keys(n.versoes).pop();
      const d = n.versoes[v];
      log("\n=== v" + v + " — " + (d.props || []).length + " propriedades, saídas: " + JSON.stringify(d.saidas));
      for (const p of d.props || []) {
        const q = p.quando ? "  quando " + JSON.stringify(p.quando) : "";
        const e = p.enum ? "  ∈ {" + p.enum.join("|") + "}" : "";
        log("  " + p.nome + " : " + p.tipo + (p.obrigatorio ? " (obrigatório)" : "") + e + q);
        for (const d2 of p.dentro || []) log("      ." + d2.nome + " : " + d2.tipo + (d2.enum ? " ∈ {" + d2.enum.join("|") + "}" : ""));
        for (const [g, gg] of Object.entries(p.grupos || {})) log("      ." + g + (gg.lista ? "[]" : "") + " : " + gg.campos.map(c => c.nome).join(", "));
      }
      return;
    }

    const r = await get({ log });
    if (!r.ok) { log("sem esquema: " + r.porque); process.exitCode = 1; return; }
    log("esquema pronto — " + r.esquema.tipos + " tipos, " + (r.doCache ? "do cache" : "recém-destilado"));
    log("pacotes: " + r.esquema.pacotes.map(p => p.npm + "@" + p.versao).join(", "));
    log("\nuso:  node " + EU + " --baixar | --construir | --ver <tipo> [--versao <v>] | --conferir <fluxo.json>");
  })().catch(e => { console.error(e); process.exitCode = 1; });
}

module.exports = {
  ESQUEMA_V, PKGS, CACHE,
  disponivel, baixar, get, lerCache, resumo,
  versaoDe, aplica, propsAplicaveis, conferir, fatia, fatiaPorVersao, OPACOS
};
