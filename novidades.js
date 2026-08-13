/* novidades.js — o Tester lê o changelog do n8n sozinho, uma vez por dia.
 *
 * O PROBLEMA. O que o Tester sabe é medido e datado: `catalog.js` lê a instância,
 * `esquema.js` destila os pacotes baixados, `n8n-gramatica.md` é prosa afinada à
 * mão. Nenhum dos três descobre sozinho que o n8n mudou de forma na semana
 * passada — e a primeira vez que alguém percebe é um fluxo que importa quebrado.
 *
 * O QUE ISTO FAZ. Uma vez por dia busca
 * `https://raw.githubusercontent.com/n8n-io/n8n-docs/main/feeds/release-notes.xml`,
 * separa os itens que nunca viu (por `guid`), e — só se houver algum — gasta uma
 * sessão local do Claude para responder uma pergunta e só uma: **isto muda como
 * a gente constrói fluxo?** O que muda vira entrada em `n8n-novidades.md`, que a
 * sessão de build lê junto com a gramática. O que não muda é registrado como
 * visto e descartado, para nunca mais custar nada.
 *
 * ONDE ELE PODE ESCREVER, E POR QUÊ ISSO É UM LIMITE.
 *
 * `licoes.js` já carrega a decisão travada deste repositório: *uma base de
 * conhecimento que se auto-escreve se envenena na primeira vez que aprende de
 * uma correção errada*. Ela vale aqui e por isso o job **não toca em
 * `n8n-gramatica.md` nem em `tester-agentes.md`** — prosa curada à mão continua
 * curada à mão. Também não toca em `catalog.js` nem no cache do `esquema.js`:
 * esses são MEDIDOS, e trocar medição por notícia seria a pior direção possível.
 * Quando a novidade for de esquema, o job diz "rode `node esquema.js --baixar`"
 * em vez de escrever.
 *
 * O que sobra — `n8n-novidades.md` — é um doc onde **toda entrada carrega a
 * fonte**: o link do PR e a versão do n8n em que saiu. É o mesmo contrato das
 * lições ("alegação com fonte"), com uma fonte mais forte: quem escreveu foi o
 * time do n8n, não um modelo inferindo de uma rodada reprovada.
 *
 * FATOS APENAS. Nada aqui decide se uma novidade é importante — isso é o que a
 * sessão responde, contra portões determinísticos abaixo. E nada aqui desenha:
 * o aviso na tela é julgamento do `tester.html`.
 */

"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const FEED = "https://raw.githubusercontent.com/n8n-io/n8n-docs/main/feeds/release-notes.xml";
const DOC = path.join(__dirname, "n8n-novidades.md");
const LEDGER = path.join(__dirname, "novidades.json");
const VERSAO_ARQ = path.join(__dirname, "versao.json");
const DIR_CORRIDA = path.join(__dirname, ".novidades-run");

const LEDGER_V = 1;
const INTERVALO_MS = 24 * 60 * 60 * 1000;
const PRIMEIRA_ESPERA_MS = 90 * 1000;   // deixa o cockpit terminar de subir
const TETO_SESSAO_MS = 8 * 60 * 1000;
/* Quantos itens novos vão para a sessão de uma vez. O feed traz ~40 itens e o
   primeiro dia veria todos; além de custar, um prompt com 40 descrições estoura
   o teto da linha de comando. O resto fica para o dia seguinte — e o ledger diz
   quantos ficaram, porque uma fila silenciosa é o mesmo que perder o item. */
const ITENS_POR_RODADA = 12;
const MAX_ENTRADAS_DOC = 300;
const MAX_TEXTO = 400;
const MAX_TITULO = 140;

/* ------------------------------------------------------------------ o feed */

/* Parser mínimo, sem dependência. O feed é RSS 2.0 gerado por máquina e sempre
 * na mesma forma — não é HTML de terceiro. Ainda assim nada aqui confia no
 * conteúdo: tudo o que sai passa por `limpar()` antes de virar prompt ou disco,
 * porque o texto vem da internet e vai parar dentro de um `-p`. */
function desescapar(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/* Corta caractere de controle e normaliza espaço. `caractere-test.js` existe
 * neste repositório porque um U+0000 invisível já quebrou uma busca em silêncio
 * duas vezes — e agora entra texto de fora, que é a via mais provável de um
 * terceiro. */
function limpar(s, teto) {
  const t = desescapar(s)
    .replace(/<[^>]+>/g, " ")
    // Escrito com escape unicode de proposito: o byte literal aqui faria este
    // arquivo reprovar no caractere-test.js, que existe justamente porque um
    // controle invisivel ja quebrou busca em silencio duas vezes.
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, " ")
    .trim();
  return teto && t.length > teto ? t.slice(0, teto - 1) + "…" : t;
}

const pegar = (bloco, tag) => {
  const m = bloco.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
};

function parseFeed(xml) {
  const itens = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(String(xml))) !== null) {
    const b = m[1];
    const guid = limpar(pegar(b, "guid") || pegar(b, "link"), 300);
    if (!guid) continue;
    itens.push({
      guid,
      titulo: limpar(pegar(b, "title"), MAX_TITULO),
      link: limpar(pegar(b, "link"), 300),
      versao: limpar(pegar(b, "category"), 40) || null,
      publicado: limpar(pegar(b, "pubDate"), 60) || null,
      descricao: limpar(pegar(b, "description"), 900)
    });
  }
  return itens;
}

async function buscarFeed() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(FEED, { signal: ctl.signal, headers: { accept: "application/rss+xml,text/xml" } });
    if (!r.ok) throw new Error("o feed respondeu " + r.status);
    const xml = await r.text();
    const itens = parseFeed(xml);
    if (!itens.length) throw new Error("o feed veio sem nenhum item — formato mudou ou a resposta não é o feed");
    return itens;
  } finally { clearTimeout(t); }
}

/* ----------------------------------------------------------------- ledger */

/* Ao contrário dos caches, este arquivo NÃO se regenera: `vistos` é a única
 * memória de que um item já foi julgado, e perdê-lo faz o job reprocessar (e
 * repagar) o feed inteiro. Versionado para quem migrar saber o que está lendo,
 * nunca descartado por diferença de versão. */
function vazio() {
  return { v: LEDGER_V, vistos: [], ultimaChecagem: null, ultimoErro: null, fila: 0, historico: [], aviso: null };
}

function ler() {
  try {
    const b = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
    if (!b || typeof b !== "object") return vazio();
    return { ...vazio(), ...b, vistos: Array.isArray(b.vistos) ? b.vistos : [] };
  } catch { return vazio(); }
}

async function gravar(base) {
  const tmp = LEDGER + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(base, null, 2), "utf8");
  await fsp.rename(tmp, LEDGER);
}

/* ------------------------------------------------------------------ portões
 *
 * O que a sessão devolve é uma PROPOSTA, e cada portão abaixo recusa um defeito
 * nomeado. Mesma disciplina do `claude-fix.js`: portão que falha vira mensagem,
 * nunca uma entrada meia-boca escrita no doc. Diferença de lá: aqui não há
 * segunda rodada — o job roda sem ninguém olhando, e insistir com um modelo que
 * já errou o formato gasta dinheiro para produzir a mesma coisa. Falhou, o dia
 * termina com o erro registrado e os itens continuam por ver. */
function validar(proposta, itensOferecidos) {
  const p = [];
  if (!proposta || typeof proposta !== "object" || Array.isArray(proposta)) {
    return ["a resposta não é um objeto JSON"];
  }
  if (!Array.isArray(proposta.entradas)) p.push("falta a lista `entradas` (pode ser vazia)");
  const porGuid = new Map(itensOferecidos.map(i => [i.guid, i]));
  const jaVi = new Set();

  for (const [i, e] of (proposta.entradas || []).entries()) {
    const onde = "entrada " + (i + 1);
    if (!e || typeof e !== "object") { p.push(onde + ": não é um objeto"); continue; }
    // A fonte é o contrato inteiro deste doc: sem ela a entrada é uma regra
    // inventada, que é exatamente o que `licoes.js` proíbe.
    if (!e.guid || !porGuid.has(e.guid)) {
      p.push(onde + ': `guid` ausente ou que não veio no feed desta rodada — só se pode escrever sobre item lido');
      continue;
    }
    if (jaVi.has(e.guid)) { p.push(onde + ": `guid` repetido na mesma proposta"); continue; }
    jaVi.add(e.guid);
    if (typeof e.texto !== "string" || e.texto.trim().length < 20) {
      p.push(onde + ": `texto` ausente ou curto demais para dizer alguma coisa");
    } else if (e.texto.length > MAX_TEXTO) {
      p.push(onde + ": `texto` com " + e.texto.length + " caracteres, acima de " + MAX_TEXTO);
    }
    if (/```|^#{1,6}\s/m.test(String(e.texto || ""))) {
      p.push(onde + ": `texto` traz bloco de código ou título markdown — a entrada é uma frase, e o doc é montado aqui");
    }
    if (e.impacto && !["forma", "no", "comportamento", "credencial", "outro"].includes(e.impacto)) {
      p.push(onde + ": `impacto` fora do conjunto conhecido");
    }
  }
  if (proposta.precisaEsquema !== undefined && typeof proposta.precisaEsquema !== "boolean") {
    p.push("`precisaEsquema` tem que ser booleano");
  }
  if (proposta.nota !== undefined && typeof proposta.nota !== "string") p.push("`nota` tem que ser texto");
  if (String(proposta.nota || "").length > 120) p.push("`nota` acima de 120 caracteres — ela vai no carimbo de versão");
  return p;
}

/* ------------------------------------------------------------------- o doc */

function lerDoc() {
  try { return fs.readFileSync(DOC, "utf8"); } catch { return null; }
}

const CABECA = [
  "# Novidades do n8n — o que mudou depois que esta base foi escrita",
  "",
  "Escrito pelo job diário do `novidades.js` a partir do feed oficial de release notes. **Toda",
  "entrada aqui carrega a fonte**: o link do PR e a versão do n8n em que saiu. Onde este arquivo e a",
  "`n8n-gramatica.md` discordarem, **este ganha para a versão que ele cita** — a gramática foi",
  "conferida contra o pacote em uso, e este arquivo é o que mudou depois disso.",
  "",
  "Nenhuma entrada aqui foi curada à mão. Se uma delas estiver errada, apague a linha: o `guid` fica",
  "no `novidades.json` e o item não volta.",
  ""
].join("\n");

/* Cada entrada é uma linha com fonte. Formato fixo e montado AQUI, nunca pelo
 * modelo — foi por isso que o portão recusa título markdown no texto: quem
 * decide a forma do documento é este arquivo, e o modelo só escreve a frase. */
function linhaEntrada(e, item) {
  const v = item.versao ? " · " + item.versao : "";
  return "- **" + limpar(item.titulo, MAX_TITULO) + "**" + v + " — " + limpar(e.texto, MAX_TEXTO)
    + "  \n  <" + item.link + ">";
}

async function aplicar(entradas, itens) {
  const porGuid = new Map(itens.map(i => [i.guid, i]));
  const linhas = entradas.map(e => linhaEntrada(e, porGuid.get(e.guid))).filter(Boolean);
  if (!linhas.length) return { escreveu: 0 };

  const atual = lerDoc();
  const corpo = atual && atual.includes("<!-- BLOCO: novidades -->")
    ? atual
    : CABECA + "\n<!-- BLOCO: novidades -->\n\n<!-- /BLOCO -->\n";

  /* As mais novas em cima: quem lê o doc a partir do topo encontra primeiro o
     que mudou por último, e a sessão de build lê de cima para baixo. */
  let novo = corpo.replace("<!-- BLOCO: novidades -->\n", "<!-- BLOCO: novidades -->\n\n" + linhas.join("\n") + "\n");

  // Teto por número de entradas: o doc é lido inteiro em todo build, e um
  // arquivo que cresce para sempre vira um custo fixo crescente no prompt.
  const marcas = novo.split("\n- **");
  if (marcas.length - 1 > MAX_ENTRADAS_DOC) {
    novo = marcas.slice(0, MAX_ENTRADAS_DOC + 1).join("\n- **")
      + "\n\n_(entradas mais antigas foram removidas ao chegar em " + MAX_ENTRADAS_DOC + ")_\n<!-- /BLOCO -->\n";
  }

  const tmp = DOC + ".tmp";
  await fsp.writeFile(tmp, novo, "utf8");
  await fsp.rename(tmp, DOC);
  return { escreveu: linhas.length };
}

/* ------------------------------------------------------------------ versão
 *
 * Sobe a MENOR, sempre — o carimbo diz "muda quando muda o que ele sabe", e
 * entrou conhecimento. A maior é decisão humana e o job não encosta nela. */
function proximaVersao(atual) {
  const m = String(atual || "").match(/^v(\d+)\.(\d+)$/);
  if (!m) return null;
  return "v" + m[1] + "." + (Number(m[2]) + 1);
}

async function bumparVersao(nota) {
  let v;
  try { v = JSON.parse(fs.readFileSync(VERSAO_ARQ, "utf8")); } catch { return null; }
  const prox = proximaVersao(v && v.n);
  // Formato inesperado: não inventa um número. O doc já foi escrito e o aviso
  // dirá o que entrou — o carimbo parado é menos ruim que um carimbo errado.
  if (!prox) return null;
  const novo = { ...v, n: prox, em: new Date().toISOString().slice(0, 10), nota: nota || v.nota };
  const tmp = VERSAO_ARQ + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(novo, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, VERSAO_ARQ);
  return novo;
}

/* ------------------------------------------------------------------ prompt */

function prompt(itens, temDoc) {
  const lista = itens.map((it, i) => [
    "### item " + (i + 1),
    "guid: " + it.guid,
    "versão: " + (it.versao || "não declarada"),
    "título: " + it.titulo,
    it.descricao
  ].join("\n")).join("\n\n");

  return [
    "Você é o curador da base de conhecimento de um construtor de fluxos n8n. Recebeu abaixo as",
    "novidades do changelog oficial do n8n que esta base ainda não viu.",
    "",
    "Responda UMA pergunta por item, e só ela: **isto muda a forma como se ESCREVE um workflow JSON",
    "de n8n, ou o que se deve construir?**",
    "",
    "Entra na base:",
    "- forma de parâmetro que mudou, campo novo obrigatório, `typeVersion` novo;",
    "- nó novo que substitui um jeito que hoje se faz com `httpRequest`;",
    "- comportamento em execução que muda decisão de construção (retry, erro, ordem, memória);",
    "- mudança em credencial que altera o que precisa ser preenchido.",
    "",
    "NÃO entra — e a maioria não entra:",
    "- melhoria de editor, de interface, de telemetria, de instalação, de docs;",
    "- correção de bug que não muda o JSON que se escreve;",
    "- recurso de plano pago, de cloud, de administração de usuários.",
    "",
    "Na dúvida, deixe de fora. Uma entrada errada na base vira um fluxo errado em todo build daqui",
    "para a frente, e ninguém revisou — este job roda sozinho.",
    "",
    "Escreva `patch.json` no diretório atual, exatamente nesta forma:",
    "",
    "{",
    '  "entradas": [',
    '    { "guid": "<o guid EXATO do item>", "impacto": "forma|no|comportamento|credencial|outro",',
    '      "texto": "uma ou duas frases dizendo o que muda para quem ESCREVE o JSON" }',
    "  ],",
    '  "precisaEsquema": false,',
    '  "nota": "até 120 caracteres, o resumo que vai no carimbo de versão"',
    "}",
    "",
    "Regras do formato, todas conferidas por código depois:",
    "- `guid` tem que ser um dos itens abaixo, copiado letra por letra. Item que você não citar fica",
    "  registrado como visto e não volta — é assim que se descarta o que não importa.",
    "- `texto` é UMA frase útil para quem escreve JSON, no máximo " + MAX_TEXTO + " caracteres, sem bloco de",
    "  código e sem título markdown. Diga a consequência, não a manchete.",
    "- `entradas: []` é uma resposta legítima e frequente.",
    "- `precisaEsquema: true` só quando a novidade for de propriedade de nó, porque aí o caminho é",
    "  rodar `node esquema.js --baixar && node esquema.js --construir`, não escrever prosa.",
    "",
    temDoc
      ? "Leia `NOVIDADES-ATUAL.md` antes: é a base que já existe. Não repita o que já está lá."
      : "A base ainda não tem nenhuma entrada.",
    "",
    "Não escreva nenhum outro arquivo. Não responda em prosa: o que vale é o `patch.json`.",
    "",
    "## Itens novos",
    "",
    lista
  ].join("\n");
}

/* ------------------------------------------------------------------ a rodada */

async function rodada({ tester, aoDizer = () => {} } = {}) {
  const base = ler();
  const agora = new Date().toISOString();

  let itens;
  try {
    itens = await buscarFeed();
  } catch (e) {
    base.ultimaChecagem = agora;
    base.ultimoErro = String((e && e.message) || e);
    await gravar(base);
    aoDizer("feed falhou: " + base.ultimoErro);
    return { ok: false, motivo: base.ultimoErro };
  }

  const vistos = new Set(base.vistos);
  const novos = itens.filter(i => !vistos.has(i.guid));
  base.ultimaChecagem = agora;
  base.ultimoErro = null;

  if (!novos.length) {
    base.fila = 0;
    await gravar(base);
    aoDizer("nenhuma novidade — " + itens.length + " itens no feed, todos já vistos");
    return { ok: true, novos: 0, escreveu: 0 };
  }

  const rodadaItens = novos.slice(0, ITENS_POR_RODADA);
  base.fila = novos.length - rodadaItens.length;
  aoDizer(novos.length + " novidade(s), julgando " + rodadaItens.length + " nesta rodada");

  if (!tester || !fs.existsSync(tester.CLAUDE_BIN)) {
    // Sem CLI não há julgamento — e marcar como visto aqui perderia os itens
    // para sempre. O erro fica registrado e o dia seguinte tenta de novo.
    base.ultimoErro = "o CLI do Claude não foi encontrado, então as novidades não foram julgadas";
    await gravar(base);
    return { ok: false, motivo: base.ultimoErro };
  }

  await fsp.rm(DIR_CORRIDA, { recursive: true, force: true });
  await fsp.mkdir(DIR_CORRIDA, { recursive: true });
  const doc = lerDoc();
  if (doc) await fsp.writeFile(path.join(DIR_CORRIDA, "NOVIDADES-ATUAL.md"), doc, "utf8");

  const r = await tester.rodarAvulso({
    prompt: prompt(rodadaItens, !!doc),
    // `Write` para o patch, `Read`/`Grep` para o doc atual. Sem rede: as
    // descrições do feed já são prosa completa, e uma sessão com rede aqui seria
    // uma cerca a mais para manter sem nada a ganhar.
    ferramentas: "Read,Write,Grep",
    cwd: DIR_CORRIDA,
    modelo: tester.MODELO_CONVERSA,
    comRede: false,
    tetoMs: TETO_SESSAO_MS,
    aoDizer
  });

  let proposta = null, erroLeitura = null;
  try {
    proposta = JSON.parse(await fsp.readFile(path.join(DIR_CORRIDA, "patch.json"), "utf8"));
  } catch (e) { erroLeitura = "não consegui ler `patch.json`: " + String((e && e.message) || e); }

  const problemas = erroLeitura ? [erroLeitura] : validar(proposta, rodadaItens);
  if (r.erro && !proposta) problemas.unshift("a sessão terminou com erro: " + r.erro);

  if (problemas.length) {
    /* Nada é marcado como visto. Um item julgado por uma proposta reprovada não
       foi julgado — dá-lo por visto perderia a novidade em silêncio, que é
       exatamente o defeito que este job existe para não ter. */
    base.ultimoErro = problemas.slice(0, 4).join(" · ");
    base.historico.unshift({ em: agora, ok: false, problemas: problemas.slice(0, 8), usd: r.usd || 0, usdDesconhecido: !!r.usdDesconhecido });
    base.historico = base.historico.slice(0, 60);
    await gravar(base);
    aoDizer("proposta reprovada: " + base.ultimoErro);
    return { ok: false, motivo: base.ultimoErro, problemas };
  }

  const entradas = proposta.entradas || [];
  const { escreveu } = await aplicar(entradas, rodadaItens);
  const versao = escreveu ? await bumparVersao(proposta.nota) : null;

  // Só agora vira visto: julgado e escrito.
  base.vistos = [...rodadaItens.map(i => i.guid), ...base.vistos].slice(0, 4000);
  base.historico.unshift({
    em: agora, ok: true, lidos: rodadaItens.length, escreveu,
    versao: versao ? versao.n : null, usd: r.usd || 0, usdDesconhecido: !!r.usdDesconhecido,
    precisaEsquema: !!proposta.precisaEsquema
  });
  base.historico = base.historico.slice(0, 60);

  /* O AVISO. Fica no ledger, não em `localStorage`: o job roda com a aba
     fechada, e um aviso guardado no navegador só existiria para a aba que já
     estava aberta na hora — que é justamente a que não precisa dele. Some
     quando ele clicar em fechar, e não antes. */
  if (escreveu) {
    base.aviso = {
      em: agora,
      versao: versao ? versao.n : null,
      quantas: escreveu,
      precisaEsquema: !!proposta.precisaEsquema,
      itens: entradas.map(e => {
        const it = rodadaItens.find(i => i.guid === e.guid);
        return { titulo: it ? it.titulo : e.guid, versao: it ? it.versao : null, link: it ? it.link : null, texto: e.texto, impacto: e.impacto || null };
      })
    };
  }
  await gravar(base);
  aoDizer(escreveu ? escreveu + " entrada(s) na base" + (versao ? ", agora " + versao.n : "") : "nada relevante nesta rodada");
  return { ok: true, novos: novos.length, escreveu, versao: versao ? versao.n : null, fila: base.fila };
}

/* ------------------------------------------------------------------ agenda
 *
 * Não é hook do Claude Code: aquilo dispara em evento de sessão, e isto tem que
 * acontecer com o Claude fechado. Quem agenda é o processo do cockpit, que já
 * fica aberto o dia inteiro.
 *
 * A recuperação é a parte que importa: `setInterval` sozinho perde o dia em que
 * a máquina estava desligada, e o job passaria a rodar "uma vez por dia, se o
 * cockpit estivesse ligado naquele instante". Ao subir, se a última checagem foi
 * há mais de 24h — ou nunca aconteceu — ele roda. Dias parados viram uma rodada,
 * não zero. */
let agendado = null;
let correndo = false;

async function talvezRodar(deps) {
  if (correndo) return;
  const base = ler();
  const ultima = base.ultimaChecagem ? Date.parse(base.ultimaChecagem) : 0;
  if (Number.isFinite(ultima) && Date.now() - ultima < INTERVALO_MS) return;
  correndo = true;
  try { await rodada(deps); }
  catch (e) { try { const b = ler(); b.ultimoErro = String((e && e.message) || e); await gravar(b); } catch { /* nada a fazer */ } }
  finally { correndo = false; }
}

function agendar(deps) {
  if (agendado) return;
  const bater = () => { talvezRodar(deps).catch(() => {}); };
  setTimeout(bater, PRIMEIRA_ESPERA_MS).unref?.();
  // Bate de hora em hora e o próprio `talvezRodar` decide: assim uma máquina
  // que dorme e acorda no meio do dia não espera 24h a mais pela janela.
  agendado = setInterval(bater, 60 * 60 * 1000);
  agendado.unref?.();
}

/* ------------------------------------------------------------------ estado */

/* Fatos apenas. Quando mostrar o aviso, com que cara e por quanto tempo é
   julgamento do `tester.html`. */
function estado() {
  const b = ler();
  return {
    ultimaChecagem: b.ultimaChecagem,
    ultimoErro: b.ultimoErro,
    vistos: b.vistos.length,
    fila: b.fila || 0,
    aviso: b.aviso || null,
    ultima: b.historico[0] || null,
    temDoc: !!lerDoc()
  };
}

async function fecharAviso() {
  const b = ler();
  b.aviso = null;
  await gravar(b);
  return estado();
}

/* O bloco que vai para o `GRAMATICA.md` da corrida. Vazio quando não há doc —
   ausência degrada para "o Tester se comporta como antes desta feature". */
function bloco() {
  const doc = lerDoc();
  if (!doc) return "";
  const m = doc.match(/^<!-- BLOCO: novidades -->$([\s\S]*?)^<!-- \/BLOCO -->$/m);
  const corpo = (m ? m[1] : "").trim();
  return corpo;
}

module.exports = {
  agendar, rodada, estado, fecharAviso, bloco,
  // expostos para `novidades-test.js` — portões e formato, sem modelo e sem rede
  parseFeed, validar, limpar, proximaVersao, linhaEntrada, prompt,
  FEED, DOC, LEDGER, ITENS_POR_RODADA, MAX_TEXTO
};
