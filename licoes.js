/* licoes.js — a base que aprende com os próprios erros.
 *
 * O `esquema.js` sabe o que o nó ACEITA. A `n8n-gramatica.md` sabe como se
 * escreve. Nenhum dos dois sabe o que ESTE cockpit erra na prática — e isso o
 * cockpit já mede e joga fora três vezes por dia:
 *
 *   1. o portão reprova a rodada N e a rodada N+1 passa. O delta entre as duas é
 *      uma lição exata, com tipo, versão e chave.
 *   2. o Kauan aceita um patch de edição que muda a FORMA de um parâmetro. Isso
 *      é ele corrigindo o modelo, nas coordenadas exatas de que uma lição
 *      precisa.
 *   3. uma assinatura de erro do quadro do `flows.html` nomeia um nó de um fluxo
 *      que rodou de verdade. É o sinal mais forte que existe aqui: o fluxo foi
 *      construído, aprovado, e quebrou no mundo.
 *
 * O terceiro é o primeiro caminho neste repositório que faz as duas portas da
 * frente se falarem: até agora `blueprints.json`, `proposals.json` e
 * `fixes.json` eram três arquivos ligados por nada.
 *
 * UMA LIÇÃO É UMA ALEGAÇÃO COM FONTE, NUNCA UMA REGRA. Ela diz "medido no build
 * X" e vale como aviso; virar regra é decisão do Kauan, à mão, movendo a frase
 * para a `n8n-gramatica.md`. Uma base de conhecimento que se auto-escreve se
 * envenena na primeira vez que aprende de uma correção errada — e a correção
 * errada existe: o modelo às vezes conserta um portão removendo a coisa certa.
 *
 * FATOS APENAS. Nada aqui decide se uma lição é boa; decide-se na curadoria.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ARQ = path.join(__dirname, "licoes.json");

/* Versão do formato. Ao contrário dos caches, aqui NÃO se descarta o arquivo
 * quando a versão muda: ele não se regenera — a rodada reprovada não existe mais
 * em lugar nenhum. Bump serve para quem migra saber o que está lendo. */
const LICOES_V = 1;

/* Tetos. O arquivo é para durar anos e ser lido por um humano. */
const MAX_LICOES = 400;         // além disso as mais antigas e nunca revistas saem
const MAX_TEXTO = 300;          // uma lição é uma frase, não um parágrafo
const TETO_PROMPT = 3500;       // o que cabe no arquivo da corrida sem virar parede

const ehObj = v => v && typeof v === "object" && !Array.isArray(v);

/* ------------------------------------------------------------------ arquivo */

function vazio() {
  return { v: LICOES_V, licoes: [] };
}

function ler() {
  try {
    const j = JSON.parse(fs.readFileSync(ARQ, "utf8"));
    if (!j || !Array.isArray(j.licoes)) return vazio();
    return j;
  } catch { return vazio(); }
}

/* Espera curta e SÍNCRONA. `Atomics.wait` num buffer compartilhado é o único
 * jeito de dormir sem async — e aqui tem que ser síncrono porque `gravar` é
 * chamada de dentro de código síncrono em três lugares. */
function esperar(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const fim = Date.now() + ms; while (Date.now() < fim) { /* sem SharedArrayBuffer */ } }
}

/* Escrita atômica com REPETIÇÃO, e a repetição não é paranoia: medida.
 *
 * No Windows o `rename` sobre um arquivo que outro processo tem aberto falha com
 * `EPERM` — e quem abre este arquivo é o próprio cockpit, que lê `licoes.json` na
 * rota de status, mais o antivírus varrendo o que acabou de ser escrito. Apareceu
 * como um teste que falhava 1 em 8 e não reproduzia, o pior tipo de vermelho:
 * ensina a rodar de novo em vez de investigar.
 *
 * O mesmo defeito existe no caminho de PRODUÇÃO — `registrar()` roda no fim de um
 * build — e ali o sintoma seria uma lição perdida em silêncio, porque quem chama
 * captura e segue. Cinco tentativas com espera crescente cobrem a janela.
 *
 * O que NÃO se faz aqui: cair para escrita direta sobre o arquivo final. Um
 * arquivo de conhecimento rastreado no git meio escrito é pior que uma gravação
 * que falhou e avisou. */
function gravar(base) {
  const tmp = ARQ + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(base, null, 2), "utf8");
  let ultimo = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try { fs.renameSync(tmp, ARQ); return; }
    catch (e) {
      ultimo = e;
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code)) break;
      esperar(20 * (tentativa + 1));
    }
  }
  /* Deixa o `.tmp` para trás de propósito: ele é a única cópia do que não
   * conseguiu entrar, e é gitignored. */
  throw ultimo;
}

/* Chave composta por `JSON.stringify` de um array, NUNCA concatenação com
 * separador escrito à mão. Este repositório já pagou duas vezes por isso — o
 * separador saiu como U+0000 e a chave nunca casou, silenciosamente, porque uma
 * chave que não casa não dá erro: devolve `undefined` para sempre. */
const chave = l => JSON.stringify([l.fonte, l.tipo, l.versao == null ? null : String(l.versao), l.chave || null, l.frase]);

/* ------------------------------------------------------------------ escrita */

/* Registra, deduplicando. Repetição não cria entrada nova: incrementa `vezes` e
 * anexa onde foi visto de novo. Uma lição vista cinco vezes é uma lição mais
 * forte, e essa contagem é o que ordena a curadoria — não a data. */
function registrar(novas) {
  const lista = Array.isArray(novas) ? novas : [novas];
  const base = ler();
  const porChave = new Map(base.licoes.map(l => [chave(l), l]));
  const entraram = [];

  for (const bruta of lista) {
    const l = limpar(bruta);
    if (!l) continue;
    const k = chave(l);
    const velha = porChave.get(k);
    if (velha) {
      /* Descartada CONTINUA descartada. Sem isto, uma lição que o Kauan já
       * recusou volta a aparecer na próxima vez que o mesmo erro acontecer — e
       * ele recusa de novo, para sempre. */
      velha.vezes = (velha.vezes || 1) + 1;
      velha.visto = velha.visto || [];
      if (l.ondeMedido && !velha.visto.includes(l.ondeMedido)) velha.visto.push(l.ondeMedido);
      if (velha.visto.length > 8) velha.visto = velha.visto.slice(-8);
      velha.ultimaVez = l.em;
      continue;
    }
    porChave.set(k, l);
    base.licoes.push(l);
    entraram.push(l);
  }

  /* Poda: as mais antigas que ninguém nunca revisou e que só aconteceram uma
   * vez. Uma lição promovida ou descartada é decisão do Kauan e nunca sai; uma
   * repetida também não, porque repetição é evidência. */
  if (base.licoes.length > MAX_LICOES) {
    const descartaveis = base.licoes
      .filter(l => l.estado === "novo" && (l.vezes || 1) === 1)
      .sort((a, b) => String(a.em).localeCompare(String(b.em)));
    const sobra = base.licoes.length - MAX_LICOES;
    const fora = new Set(descartaveis.slice(0, sobra).map(l => l.id));
    if (fora.size) base.licoes = base.licoes.filter(l => !fora.has(l.id));
  }

  gravar(base);
  return entraram;
}

let contador = 0;

function limpar(l) {
  if (!ehObj(l)) return null;
  const fonte = ["portao", "edicao", "producao"].includes(l.fonte) ? l.fonte : null;
  const tipo = typeof l.tipo === "string" && l.tipo ? l.tipo.slice(0, 120) : null;
  const frase = typeof l.frase === "string" && l.frase.trim() ? l.frase.trim().slice(0, MAX_TEXTO) : null;
  if (!fonte || !tipo || !frase) return null;
  const em = new Date().toISOString();
  contador++;
  return {
    id: "l" + Date.now().toString(36) + contador.toString(36),
    em, ultimaVez: em,
    fonte, tipo,
    versao: l.versao == null ? null : String(l.versao),
    chave: typeof l.chave === "string" && l.chave ? l.chave.slice(0, 120) : null,
    errado: recorte(l.errado),
    certo: recorte(l.certo),
    frase,
    /* A flag que separa a lição que ensina da que só conta. Preservada aqui, ou
     * o `documento()` perderia a distinção e voltaria a farejar a própria frase
     * procurando a palavra "anotou" — formato reconhecido por regex sobre o
     * próprio texto quebra no dia em que a frase muda. */
    comDiagnostico: l.comDiagnostico === true ? true : undefined,
    ondeMedido: typeof l.ondeMedido === "string" ? l.ondeMedido.slice(0, 120) : null,
    visto: typeof l.ondeMedido === "string" ? [l.ondeMedido.slice(0, 120)] : [],
    vezes: 1,
    estado: "novo"
  };
}

/* O "errado" e o "certo" carregam FORMA, não valor.
 *
 * Um valor de parâmetro é dado do Kauan — nome de canal, telefone, id de
 * planilha. Guardar isso aqui furaria o mesmo invariante que o `catalog.js`
 * protege, num arquivo que é RASTREADO no git, o que é pior que um cache local.
 * O que ensina é a forma: "string onde tinha que ser objeto com `__rl`", "sem o
 * prefixo `=`". */
function recorte(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return forma(v);
  if (typeof v === "number" || typeof v === "boolean") return typeof v;
  return forma(v);
}

/* A forma de um valor, em uma palavra ou duas. É isto que decide se uma mudança
 * ensina algo: valor trocado não ensina, forma trocada ensina. */
function forma(v) {
  if (v === null) return "nulo";
  if (Array.isArray(v)) return "lista[" + v.length + "]";
  if (ehObj(v)) {
    if (v.__rl === true) return "resourceLocator(mode:" + (typeof v.mode === "string" ? v.mode : "?") + ")";
    const ks = Object.keys(v).sort();
    if (!ks.length) return "objeto vazio";
    return "objeto{" + ks.slice(0, 6).join(",") + (ks.length > 6 ? ",…" : "") + "}";
  }
  if (typeof v === "string") {
    if (v.startsWith("=")) return "expressão (com `=`)";
    if (/\{\{/.test(v)) return "texto com {{ }} SEM o `=`";
    return "texto";
  }
  return typeof v;
}

/* ------------------------------------------------------- os três coletores */

/* 1. O PORTÃO. Rodada reprovada contra rodada aprovada.
 *
 * O que entra é só o que o portão de esquema apontou e que a rodada seguinte
 * resolveu — não toda diferença entre os dois documentos. A rodada N+1 reescreve
 * o fluxo inteiro, então comparar tudo produziria dezenas de "mudanças" que não
 * têm nada a ver com a reprovação. */
function doPortao({ wfFalho, wfBom, esquema, ondeMedido }) {
  if (!esquema || !ehObj(wfFalho) || !Array.isArray(wfFalho.nodes)) return [];
  const esq = require("./esquema.js");
  const bons = new Map((ehObj(wfBom) && Array.isArray(wfBom.nodes) ? wfBom.nodes : []).map(n => [String(n && n.name), n]));
  const out = [];

  for (const nd of wfFalho.nodes) {
    if (!ehObj(nd)) continue;
    const achados = esq.conferir(esquema, nd);
    if (!achados.length) continue;
    const bom = bons.get(String(nd.name));
    for (const a of achados) {
      /* Só a chave de primeiro nível: descer em `options.x` daria uma lição
       * sobre um caminho que o próximo build provavelmente não tem. */
      const raiz = String(a.chave || "").split(".")[0];
      if (!raiz) continue;
      const antes = ehObj(nd.parameters) ? nd.parameters[raiz] : undefined;
      const depois = bom && ehObj(bom.parameters) ? bom.parameters[raiz] : undefined;

      /* A rodada boa tem que ter REALMENTE resolvido aquela chave. Sem esta
       * conferência, uma lição nasceria de um erro que continuou lá e só deixou
       * de ser apontado porque o nó mudou de nome. */
      let resolveu = false, certo = null;
      if (!bom) resolveu = false;
      else if (depois === undefined) { resolveu = true; certo = "a chave não existe no fluxo aprovado"; }
      else if (!esq.conferir(esquema, bom).some(x => String(x.chave || "").split(".")[0] === raiz)) {
        resolveu = true; certo = recorte(depois);
      }
      if (!resolveu) continue;

      out.push({
        fonte: "portao", tipo: nd.type, versao: nd.typeVersion, chave: raiz,
        errado: a.tipo === "enum" ? "valor fora do enum" : (a.tipo === "desconhecida" ? "chave que não existe nessa versão" : "chave de outra operação"),
        certo,
        frase: fraseDoPortao(a, nd, certo),
        ondeMedido
      });
    }
  }
  return out;
}

function fraseDoPortao(a, nd, certo) {
  const raiz = String(a.chave || "").split(".")[0];
  const v = nd.typeVersion == null ? "" : " v" + nd.typeVersion;
  if (a.tipo === "enum") {
    return "em `" + nd.type + "`" + v + ", `" + raiz + "` não aceita o valor que eu escrevi; os aceitos estão no esquema";
  }
  if (a.tipo === "desconhecida") {
    return "em `" + nd.type + "`" + v + ", `" + raiz + "` NÃO existe — eu inventei essa chave e o n8n a ignora em silêncio" +
      (certo === "a chave não existe no fluxo aprovado" ? "; o fluxo aprovado simplesmente não a tem" : "");
  }
  return "em `" + nd.type + "`" + v + ", `" + raiz + "` só vale sob outra combinação de resource/operation";
}

/* 2. A EDIÇÃO. O Kauan aceitou um patch que mudou a FORMA de um parâmetro.
 *
 * O filtro é o que faz este coletor prestar: **mudança de valor não ensina
 * nada.** Trocar o canal do Slack, o telefone, o id da planilha é ele dizendo o
 * que quer — não é correção de erro meu. Só entra quando a forma muda: string
 * onde tinha que ser resourceLocator, `{{ }}` que ganhou o `=`, chave que
 * apareceu ou desapareceu. */
function daEdicao({ antes, depois, ondeMedido }) {
  if (!ehObj(antes) || !ehObj(depois)) return [];
  const velhos = new Map((Array.isArray(antes.nodes) ? antes.nodes : []).map(n => [String(n && n.name), n]));
  const out = [];

  for (const nd of Array.isArray(depois.nodes) ? depois.nodes : []) {
    if (!ehObj(nd)) continue;
    const velho = velhos.get(String(nd.name));
    if (!velho) continue;                       // nó novo não corrige nada
    const pa = ehObj(velho.parameters) ? velho.parameters : {};
    const pd = ehObj(nd.parameters) ? nd.parameters : {};

    for (const k of new Set([...Object.keys(pa), ...Object.keys(pd)])) {
      const fa = k in pa ? forma(pa[k]) : "ausente";
      const fd = k in pd ? forma(pd[k]) : "ausente";
      if (fa === fd) continue;                  // valor mudou, forma não: não ensina

      out.push({
        fonte: "edicao", tipo: nd.type, versao: nd.typeVersion, chave: k,
        errado: fa, certo: fd,
        frase: "num `" + nd.type + "`, o Kauan trocou a FORMA de `" + k + "`: de " + fa + " para " + fd,
        ondeMedido
      });
    }
  }
  return out;
}

/* 3. A PRODUÇÃO. Assinatura de erro do quadro do `flows.html`.
 *
 * Recebe pronto o que o chamador resolveu, e de propósito: mapear nome de nó
 * para TIPO de nó exige ler o grafo do fluxo, que é chamada de rede, e este
 * arquivo não faz rede. Quem colhe é `--colher-producao`, um passo explícito, e
 * não o poll — o caminho quente do painel continua só emitindo fatos.
 *
 * É o sinal mais forte dos três: o fluxo foi construído, aprovado, e quebrou
 * rodando. E é o mais escorregadio, porque um erro de execução pode não ter nada
 * a ver com a forma do parâmetro (credencial expirada, API fora). Por isso a
 * frase diz o que se sabe — "este tipo de nó falhou N vezes com esta mensagem" —
 * e nunca uma causa. */
function daProducao({ tipo, no, erro, quantas, ondeMedido, comDiagnostico }) {
  if (typeof tipo !== "string" || !tipo) return [];
  const msg = String(erro || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!msg) return [];
  return [{
    fonte: "producao", tipo, versao: null, chave: null,
    errado: null, certo: null,
    /* `comDiagnostico` é o que separa uma lição que ensina de uma que só conta.
     * Sem ela eu teria que farejar a minha própria frase procurando a palavra
     * "anotou" para saber a diferença — e formato reconhecido por regex sobre o
     * próprio texto é o tipo de acoplamento que quebra no dia em que a frase
     * muda. Aqui é uma flag, decidida por quem sabe. */
    comDiagnostico: !!comDiagnostico,
    frase: "`" + tipo + "` já falhou em produção" + (quantas > 1 ? " (" + quantas + " assinaturas)" : "") +
      (no ? ", no nó «" + no + "»" : "") + ": " + msg,
    ondeMedido
  }];
}

/* ------------------------------------------------------------- curadoria */

/* Três estados. `novo` é injetado nos prompts; `promovido` NÃO é — porque
 * promover quer dizer que a frase virou parágrafo na `n8n-gramatica.md`, e
 * injetar as duas seria dizer a mesma coisa duas vezes com autoridades
 * diferentes. `descartado` nunca volta. */
function decidir(id, estado, nota) {
  if (!["novo", "promovido", "descartado"].includes(estado)) throw new Error("estado inválido: " + estado);
  const base = ler();
  const l = base.licoes.find(x => x.id === id);
  if (!l) return null;
  l.estado = estado;
  l.decididoEm = new Date().toISOString();
  if (typeof nota === "string" && nota.trim()) l.nota = nota.trim().slice(0, MAX_TEXTO);
  gravar(base);
  return l;
}

/* ------------------------------------------------------------- leitura */

/* As lições que valem para os tipos em jogo. Ordenadas por evidência —
 * `vezes` primeiro, e produção antes de portão, porque um erro que quebrou
 * rodando vale mais que um que o portão pegou antes de sair. */
const PESO_FONTE = { producao: 3, edicao: 2, portao: 1 };

function paraTipos(tipos, { teto = 20 } = {}) {
  const alvo = new Set((tipos || []).filter(t => typeof t === "string"));
  return ler().licoes
    .filter(l => l.estado === "novo" && alvo.has(l.tipo))
    .sort((a, b) => (b.vezes || 1) - (a.vezes || 1) || (PESO_FONTE[b.fonte] || 0) - (PESO_FONTE[a.fonte] || 0) || String(b.em).localeCompare(String(a.em)))
    .slice(0, teto);
}

/* O arquivo que vai para o diretório da corrida. Vazio devolve `null` — escrever
 * um `LICOES.md` que só diz "nada aqui" gasta uma leitura da sessão e ensina que
 * o arquivo não vale a pena abrir. */
function documento(tipos) {
  const ls = paraTipos(tipos);
  if (!ls.length) return null;

  const linhas = [
    "# O que já deu errado aqui",
    "",
    "Cada linha abaixo foi MEDIDA numa construção anterior deste cockpit: ou o portão reprovou e a",
    "rodada seguinte consertou, ou o Kauan corrigiu à mão, ou o fluxo quebrou rodando de verdade.",
    "",
    "São AVISOS, não regras — a regra está no `esquema.json` e na `GRAMATICA.md`. Se uma linha daqui",
    "contradisser aqueles dois, eles ganham. O valor disto é probabilístico: é onde a chance de errar",
    "de novo é maior.",
    ""
  ];
  /* Lição de produção SEM diagnóstico é informativa uma vez, não três.
   *
   * Medido na primeira colheita: três assinaturas distintas do mesmo `slack`
   * produziam três linhas dizendo a mesma coisa com nomes de nó diferentes — e
   * nome de nó de OUTRO fluxo não ajuda ninguém a escrever este. Sem
   * diagnóstico, o que informa é "este tipo já falhou em produção, N vezes", e
   * é isso que fica. As COM diagnóstico nunca colapsam: ali cada frase diz uma
   * coisa diferente e é o conteúdo que vale. */
  const porTipo = new Map();
  const finais = [];
  for (const l of ls) {
    if (l.fonte === "producao" && !l.comDiagnostico) {
      const g = porTipo.get(l.tipo);
      if (g) { g.n++; continue; }
      const item = { ...l, n: 1, colapsada: true };
      porTipo.set(l.tipo, item);
      finais.push(item);
      continue;
    }
    finais.push(l);
  }

  let tamanho = linhas.join("\n").length;
  let cortadas = 0;
  for (const l of finais) {
    const marca = l.colapsada ? "" : ((l.vezes || 1) > 1 ? " _(visto " + l.vezes + "x)_" : "");
    const corpo = (l.colapsada && l.n > 1)
      ? "`" + l.tipo + "` já falhou em produção " + l.n + " vezes, nenhuma com diagnóstico anotado"
      : l.frase;
    const linha = "- " + corpo + marca;
    if (tamanho + linha.length > TETO_PROMPT) { cortadas++; continue; }
    linhas.push(linha);
    tamanho += linha.length + 1;
  }
  /* Silêncio sobre o que foi cortado é a mesma classe de mentira que uma
   * varredura truncada que se apresenta como total. */
  if (cortadas) linhas.push("", "_(mais " + cortadas + " lição(ões) não couberam aqui.)_");
  return linhas.join("\n");
}

/* Cache por MTIME, pelo mesmo motivo que o `esquema.resumo()`: isto é montado a
 * cada poll da rota de status, e desde o `aba.js` são até três páginas poleiando
 * a cada 6 segundos. O arquivo é pequeno, então o custo não é CPU — é a janela.
 * Ler um arquivo dezenas de vezes por minuto no Windows disputa com quem o
 * reescreve por `rename` atômico, e o sintoma disso é um teste que falha uma vez
 * em vinte e não reproduz: o pior tipo de vermelho, porque ensina a rodar de novo
 * em vez de investigar. Um `rename` troca o mtime, então uma lição nova aparece
 * na chamada seguinte. */
let resumoCache = { mtime: 0, valor: null };

function resumo() {
  let st = null;
  try { st = fs.statSync(ARQ); } catch { st = null; }
  if (st && resumoCache.valor && resumoCache.mtime === st.mtimeMs) return resumoCache.valor;

  const ls = ler().licoes;
  const por = { novo: 0, promovido: 0, descartado: 0 };
  const porFonte = { portao: 0, edicao: 0, producao: 0 };
  for (const l of ls) {
    if (por[l.estado] !== undefined) por[l.estado]++;
    if (porFonte[l.fonte] !== undefined) porFonte[l.fonte]++;
  }
  const valor = { total: ls.length, porEstado: por, porFonte, aRevisar: por.novo };
  /* Só cacheia com mtime em mão. Sem arquivo ainda (cockpit recém-clonado), o
   * cálculo é trivial e cachear sem chave faria a primeira lição da vida nunca
   * aparecer na tela. */
  if (st) resumoCache = { mtime: st.mtimeMs, valor };
  return valor;
}

/* ------------------------------------------------------------------- CLI */

if (require.main === module) {
  const args = process.argv.slice(2);
  const pega = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  if (args.includes("--promover") || args.includes("--descartar")) {
    const promover = args.includes("--promover");
    const id = pega(promover ? "--promover" : "--descartar");
    const l = decidir(id, promover ? "promovido" : "descartado", pega("--nota"));
    if (!l) { console.log("não achei a lição `" + id + "`"); process.exitCode = 1; }
    else console.log((promover ? "promovida" : "descartada") + ": " + l.frase);

  } else if (args.includes("--colher-producao")) {
    /* Único caminho deste arquivo que precisa de rede — e por isso é um comando,
     * não um gancho no poll. Lê `fixes.json` (as assinaturas que o Kauan marcou
     * ou que o quadro registrou) e resolve nome de nó para TIPO de nó lendo o
     * grafo do fluxo, dentro do processo. Só id, nome e tipo cruzam. */
    (async () => {
      const n8n = require("./n8n.js");
      if (!n8n.configured) { console.log("sem `.env` configurado: não dá para resolver o tipo dos nós"); process.exitCode = 1; return; }
      let fixes;
      try { fixes = JSON.parse(fs.readFileSync(path.join(__dirname, "fixes.json"), "utf8")); }
      catch (e) { console.log("não consegui ler fixes.json: " + e.message); process.exitCode = 1; return; }

      const hist = Array.isArray(fixes.history) ? fixes.history : [];
      const atuais = ehObj(fixes.fixes) ? Object.keys(fixes.fixes) : [];
      const assinaturas = [...new Set([...atuais, ...hist.map(h => h && h.key).filter(Boolean)])];
      console.log("assinaturas em fixes.json: " + assinaturas.length);

      const grafos = new Map();
      const novas = [];
      for (const sig of assinaturas) {
        const partes = String(sig).split("|");
        if (partes.length < 3) continue;
        const [wfId, noNome, erroTipo] = partes;
        if (!grafos.has(wfId)) {
          try { grafos.set(wfId, await n8n.getGraph(wfId)); }
          catch (e) { grafos.set(wfId, null); console.log("  não li o grafo de " + wfId + ": " + String(e.message).slice(0, 80)); }
        }
        const g = grafos.get(wfId);
        if (!g || !Array.isArray(g.nodes)) continue;
        const nd = g.nodes.find(x => x && x.name === noNome);
        /* Nó que não está no grafo do fluxo que falhou é o caso do sub-fluxo, e
         * resolvê-lo exigiria seguir a chamada. Aqui a resposta honesta é não
         * registrar: uma lição sobre o tipo errado é pior que nenhuma. */
        if (!nd || !nd.type) continue;
        const nota = hist.filter(h => h && h.key === sig).map(h => h.note).filter(Boolean).pop();
        /* A nota só entra quando diz alguma coisa.
         *
         * Medido na primeira colheita: das 14 assinaturas, duas viraram
         * "«slack» já falhou em produção: NodeOperationError — o Kauan anotou:
         * Ja ajustei". Isso não é uma lição, é ruído injetado num prompt — e
         * ruído num arquivo que se apresenta como conhecimento medido ensina a
         * ignorar o arquivo. Sem a nota a linha continua verdadeira e útil de
         * leve ("este tipo de nó já falhou com este erro aqui"), então o certo é
         * derrubar a nota, não a lição.
         *
         * O corte é por TAMANHO, não por palavra: uma lista de frases inúteis
         * ("ja ajustei", "resolvido", "ok") nunca termina, e o que separa uma
         * anotação que explica de uma que só marca é ela ter conteúdo. */
        /* E cai também a nota que é SENTINELA NOSSA, não anotação de ninguém:
         * o `flows.html` grava "Aplicado pelo cockpit sem explicação do Claude —
         * N nó(s) alterado(s)" quando o modelo não escreveu o resumo. Ela passa
         * de 25 caracteres e diz zero sobre o defeito. Reconhecer a própria
         * sentinela não é chutar palavra-chave: é saber o que este código
         * escreve. */
        const limpa = typeof nota === "string" ? nota.trim() : "";
        const ehSentinela = /^Aplicado pelo cockpit sem explica/i.test(limpa);
        const notaVale = limpa.length >= 25 && !ehSentinela;
        /* A nota é texto do próprio Kauan e já está rastreada no git dentro do
         * `fixes.json` — copiá-la para cá não atravessa fronteira nenhuma que já
         * não estivesse atravessada. O que NUNCA entra aqui é valor de parâmetro
         * lido de um fluxo; isso é o que `forma()` existe para impedir. */
        novas.push(...daProducao({
          tipo: nd.type, no: noNome, erro: notaVale ? erroTipo + " — o Kauan anotou: " + limpa : erroTipo,
          comDiagnostico: notaVale,
          quantas: 1, ondeMedido: "fixes.json:" + sig
        }));
      }
      const entraram = registrar(novas);
      console.log("lições novas: " + entraram.length + " (de " + novas.length + " candidatas; o resto já existia)");
    })().catch(e => { console.error(e); process.exitCode = 1; });

  } else {
    const r = resumo();
    console.log(JSON.stringify(r, null, 2));
    const ls = ler().licoes.filter(l => l.estado === "novo")
      .sort((a, b) => (b.vezes || 1) - (a.vezes || 1) || (PESO_FONTE[b.fonte] || 0) - (PESO_FONTE[a.fonte] || 0));
    if (ls.length) {
      console.log("\nA REVISAR (as com mais evidência primeiro):\n");
      for (const l of ls.slice(0, 30)) {
        console.log("  " + l.id + "  [" + l.fonte + (l.vezes > 1 ? " ×" + l.vezes : "") + "]  " + l.frase);
        if (l.visto && l.visto.length) console.log("        visto em: " + l.visto.join(", "));
      }
      console.log("\nPromover uma lição é MOVER A FRASE para `n8n-gramatica.md` à mão, e depois marcar:");
      console.log("  node licoes.js --promover <id> [--nota \"...\"]");
      console.log("  node licoes.js --descartar <id> [--nota \"por que não vale\"]");
      console.log("\nColher de produção (precisa de .env, faz rede):  node licoes.js --colher-producao");
    } else {
      console.log("\nnenhuma lição a revisar.");
    }
  }
}

module.exports = {
  LICOES_V, ARQ, TETO_PROMPT, MAX_LICOES,
  ler, registrar, decidir, paraTipos, documento, resumo,
  doPortao, daEdicao, daProducao, forma, chave
};
