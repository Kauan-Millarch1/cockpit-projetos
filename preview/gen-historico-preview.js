/* gen-historico-preview.js — writes preview/historico.html from upgrade.html.
 *
 * WHAT THIS IS FOR. The /upgrade tab holds ONE conversation per flow, alive only
 * in memory. The feature being decided here is persisted history: many
 * conversations per flow, a list, open an old one, start a new one. The hard part
 * is not the list — it is WHERE the list goes on a screen whose two columns both
 * need width: `[ 01 ] A conversa` (chat plus composer) and `[ 02 ] O fluxo hoje`
 * (179 nodes, pan and zoom).
 *
 * So this file draws THREE answers that differ in which axis they spend:
 *   A · TRILHA — a third column. Spends WIDTH, permanently.
 *   B · FAIXA  — a full-width strip above both columns. Spends HEIGHT, permanently.
 *   C · GAVETA — a drawer summoned from the header. Spends a CLICK, nothing else.
 *
 * SAME PATTERN AS THE OTHER GENERATORS: the CSS and every renderer that already
 * exists are EXTRACTED from upgrade.html at generation time, never hand-copied, so
 * this preview cannot drift from the screen. What is hand-written here is only the
 * part that does not exist yet — the three history vocabularies — which is exactly
 * the part being decided.
 *
 * The drawing is not a fixture either: the node positions are the REAL 179-node
 * `Agente Iago Comercial` graph, extracted from preview/canvas-n8n.html (189 nodes
 * there, 10 of them sticky notes). Nothing in this file calls the cockpit.
 *
 *   node preview/gen-historico-preview.js          # writes the HTML
 *   node preview/gen-historico-preview.js --png     # also captures the PNGs
 *
 * Open historico.html with a double click. `?so=<painel>` isolates one panel at
 * viewport size (that is what the capture uses), `?theme=light|dark` forces the
 * theme, `?rec=1` turns recording mode on, `?layout=duas|pilha|foco` still works
 * because LAYOUT itself is extracted.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const ALVO_HTML = path.join(__dirname, "historico.html");

/* ─────────────────────────────────────────────── o que vem de upgrade.html ─── */

const pagina = fs.readFileSync(path.join(RAIZ, "upgrade.html"), "utf8");
const css = (pagina.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!css) throw new Error("não achei o bloco <style> em upgrade.html");

const linhas = pagina.split("\n");

/* Extração por linha com PROVA DE COMPILAÇÃO, em vez de contar chaves.
 * `esc` carrega a regex `/[&<>"]/g`, e um contador de chaves com consciência de
 * string trata aquela aspa como início de literal — o recorte sai torto e o erro
 * aparece só no navegador. Aqui o critério é: o menor bloco de linhas a partir do
 * início que o motor aceita compilar E que fecha em `;` ou `}`. O fecho explícito
 * é o que impede um prefixo aceito por ASI (`const x = 1` de um `const x = 1 + 2;`)
 * de passar por statement inteiro. */
function trecho(re, oQue) {
  const ini = linhas.findIndex(l => re.test(l));
  if (ini < 0) throw new Error("não achei " + oQue + " em upgrade.html");
  for (let k = 1; k <= 140 && ini + k <= linhas.length; k++) {
    const t = linhas.slice(ini, ini + k).join("\n");
    if (!/[;}]\s*$/.test(t)) continue;
    try { new Function(t); } catch { continue; }
    return t;
  }
  throw new Error(oQue + " não fecha em 140 linhas — o recorte de upgrade.html mudou de forma");
}
const fun = nome => trecho(new RegExp("^function " + nome + "\\("), "function " + nome);
const kon = nome => trecho(new RegExp("^const " + nome + "\\b"), "const " + nome);

/* A ordem importa: é a ordem em que o script da página vai executar. */
const DE_CIMA = [
  kon("esc"), kon("num"), kon("usdTxt"), kon("curto"), kon("milTok"), kon("kb"),
  kon("LAYOUTS"), kon("LAYOUT_PADRAO"), kon("LAYOUT"),
  kon("NODE"), kon("ICON"),
  kon("ESC_FORMA"), kon("ESC_ALVO"), kon("ESC_MIN"), kon("trava"),
  kon("DOSSIE_FRASE"), kon("DOSSIE_CLS"),
  kon("novosDoAlvo"), kon("temNovos"),
  fun("nosFalhos"),
  fun("botaoDossie"), fun("faixaDossie"),
  fun("blocosConversa"), fun("faixaAlvo"), fun("bandaEstado"), fun("linhaCusto"),
  fun("nosAcesos"), fun("tarjaNovos"),
  fun("palco"),
  fun("camCaber"), fun("camRegiao"), fun("extentoAcesos"), fun("camAbertura"),
  fun("telaFluxo")
].join("\n\n");

/* ──────────────────────────────────────────── o desenho real, 179 nós ─────── */

/* `canvas-n8n.html` é preview, não produção — e é o único lugar deste repositório
 * onde a posição real dos nós do Iago está gravada. Ler dela é a mesma disciplina
 * de extrair o CSS: ninguém digita 179 coordenadas à mão. */
function grafoDoIago() {
  const h = fs.readFileSync(path.join(__dirname, "canvas-n8n.html"), "utf8");
  const marca = "const GRAPH = ";
  const i = h.indexOf(marca);
  if (i < 0) throw new Error("não achei GRAPH em preview/canvas-n8n.html");
  let d = 0, fim = -1;
  for (let k = h.indexOf("{", i); k < h.length; k++) {
    if (h[k] === "{") d++;
    else if (h[k] === "}" && !--d) { fim = k; break; }
  }
  const G = JSON.parse(h.slice(h.indexOf("{", i), fim + 1));
  /* Sticky note é nó no n8n, nunca aparece no `runData` e infla a caixa —
     `isAnnotation()` no flows.html existe por isso. 189 menos 10 dá os 179. */
  const reais = G.nodes.filter(n => !/stickyNote/i.test(n.type));
  const nomes = new Set(reais.map(n => n.name));
  return {
    nos: reais.map(n => ({ nome: n.name, tipo: n.type, x: n.x, y: n.y, sub: n.sub || null })),
    arestas: G.edges
      .filter(e => nomes.has(e.from) && nomes.has(e.to))
      .map(e => ({ de: e.from, para: e.to }))
  };
}
const GRAFO = grafoDoIago();
if (GRAFO.nos.length !== 179) throw new Error("esperava 179 nós reais, vieram " + GRAFO.nos.length);

/* ─────────────────────────────────────────────────────── o fluxo e o dossiê ── */

/* Números reais: o wfId e o tamanho do dossiê saem de `dossies.json`, as 87
 * execuções e o nó que falhou são os que o CLAUDE.md registra para este fluxo. */
const FLUXO = {
  id: "azwM3PgGtSbGTCsn",
  nome: "Agente Iago Comercial",
  nos: 179,
  exec24: 87,
  erro24: 6,
  active: false,
  chamadores: [{ id: "x", nome: "WhatsApp API Oficial" }],
  falhas: ["Convert text to speech"],
  tokens: 96000,
  graph: GRAFO
};

const DOSSIE = {
  cor: "laranja",
  quantosMudados: 3,
  paragrafos: 179,
  bytes: 56404,
  bytesFluxo: 297318,
  em: "2026-08-18T16:44:33.291Z",
  preco: { usd: 4.14 },
  job: null,
  ocupado: null
};

/* ──────────────────────────────────────────────────────────── as conversas ─── */

/* Conversas de verdade desta semana, com os nomes de nó verdadeiros do fluxo — o
 * alvo aceso no desenho é aceso porque o nó existe. Duas delas são bugs que o
 * CLAUDE.md deste repositório já documenta como silenciosos em produção
 * (`redis get` devolvendo em `propertyName`, e o lock que nunca pega). */
const CONVS = [
  {
    id: "cv-b471",
    titulo: "responder com áudio quando o lead manda áudio",
    status: "correndo",
    em: "agora", emOrdem: 6,
    atividade: "lendo evidencia/2-saida.json",
    rodadas: 1,
    evidencias: [
      { arquivo: "evidencia/1-execucoes.json", oque: "execucoes",
        resumo: "li 40 execuções: 11 entraram por áudio" }
    ],
    alvo: null,
    custo: [], gasto: { usd: 0.31, estimado: false, cegas: 0 },
    chat: [
      { de: "eu", texto: "quando o lead manda áudio ele responde por texto. queria que respondesse por áudio também." },
      { de: "ele", texto: "Vou olhar as execuções que entraram por áudio antes de dizer o alvo — o fluxo já transcreve, então a pergunta é o que ele faz na volta." }
    ]
  },
  {
    id: "cv-3d10",
    titulo: "ele repete a saudação quando o lead volta no mesmo dia",
    status: "alvo",
    em: "hoje 11:40", emOrdem: 5,
    rodadas: 2,
    evidencias: [
      { arquivo: "evidencia/1-saida.json", oque: "saida",
        resumo: "abri a execução #183879: has_summary saiu false nas 5 vezes" }
    ],
    alvo: {
      resumo: "O resumo da conversa nunca chega no agente: `redis_get_conv_summary` devolve o valor "
        + "em `propertyName` e `parse_conv_summary` lê `$json.value`, então `has_summary` sai `false` "
        + "em toda execução e o agente sempre acha que é a primeira mensagem do lead. Corrigir a "
        + "leitura resolve a saudação sem tocar no prompt.",
      nos: [
        { nome: "parse_conv_summary", oque: "passa a ler `propertyName`, que é onde o `redis get` devolve" },
        { nome: "redis_get_conv_summary", oque: "guarda também a marca da última saudação do dia" },
        { nome: "redis_set_saudacao_do_dia", novo: true, tipoNo: "n8n-nodes-base.redis",
          oque: "grava a saudação do dia com TTL até a meia-noite" }
      ],
      nota: "Não mexo no `build_system_prompt`: o texto da saudação está certo, o que falta é o agente saber que já falou hoje."
    },
    custo: [{ usd: 0.62 }, { usd: 0.46 }], gasto: { usd: 1.08, estimado: false, cegas: 0 },
    chat: [
      { de: "eu", texto: "quando o lead volta no mesmo dia ele começa tudo de novo, \"oi, tudo bem?\", como se nunca tivesse falado" },
      { de: "ele", texto: "Antes de mexer eu preciso de uma coisa só, porque ela muda o alvo:",
        perguntas: ["A memória do que já foi conversado vale só no mesmo dia, ou enquanto o lead estiver no funil?"] },
      { de: "eu", texto: "no mesmo dia basta" },
      { de: "ele", tipo: "alvo",
        texto: "O resumo da conversa nunca chega no agente: `redis_get_conv_summary` devolve o valor em "
          + "`propertyName` e `parse_conv_summary` lê `$json.value`, então `has_summary` sai `false` em toda "
          + "execução e o agente sempre acha que é a primeira mensagem do lead. Corrigir a leitura resolve a "
          + "saudação sem tocar no prompt." }
    ]
  },
  {
    id: "cv-8f2a",
    titulo: "às vezes ele manda que o ingresso está R$0,00",
    status: "aguardando",
    em: "hoje 09:12", emOrdem: 4,
    rodadas: 3,
    evidencias: [
      { arquivo: "evidencia/1-execucoes.json", oque: "execucoes",
        resumo: "li 40 execuções: 4 contêm \"R$ 0,00\" na saída de algum nó" },
      { arquivo: "evidencia/2-saida.json", oque: "saida",
        resumo: "abri a #182204: o campo valor chegou vazio da linha do Supabase" },
      { arquivo: "evidencia/3-grafo.json", oque: "grafo",
        resumo: "li o grafo de Agente eContrate: 103 nós, 41KB" }
    ],
    alvo: null,
    custo: [{ usd: 0.29 }, { usd: 0.24 }, { usd: 0.21 }], gasto: { usd: 0.74, estimado: false, cegas: 0 },
    chat: [
      { de: "eu", texto: "às vezes ele manda que o ingresso está R$0,00" },
      { de: "ele", texto: "Achei 4 execuções com R$ 0,00 na saída de `montar_texto_ingresso` — nas quatro o "
          + "campo `valor` chegou vazio da linha do Supabase, não do texto. Então o texto está certo e o dado "
          + "não vem. Duas coisas mudam o que eu mexo:",
        perguntas: [
          "Quando o preço não vier, ele fica calado e chama você, ou manda sem o preço e oferece o link?",
          "O preço certo está em outro lugar (a tabela `eventos`, a API do checkout), ou é para tratar o ingresso como indisponível?"
        ] }
    ]
  },
  {
    id: "cv-77c9",
    titulo: "a Ana foi chamada de outro nome no meio da conversa",
    status: "confirmado",
    em: "ontem 17:05", emOrdem: 3,
    rodadas: 2,
    evidencias: [
      { arquivo: "evidencia/1-saida.json", oque: "saida", resumo: "abri a #180936: o nome veio de contato-name" },
      { arquivo: "evidencia/2-grafo.json", oque: "grafo", resumo: "li o grafo: 179 nós, 290KB" }
    ],
    alvo: {
      resumo: "O nome do lead é lido duas vezes de fontes diferentes.",
      nos: [
        { nome: "buscar_lead", oque: "passa a ser a única fonte do nome" },
        { nome: "build_system_prompt", oque: "deixa de reescrever o nome a partir do pushname" }
      ],
      nota: null
    },
    custo: [{ usd: 0.77 }, { usd: 0.54 }], gasto: { usd: 1.31, estimado: false, cegas: 0 },
    chat: [
      { de: "eu", texto: "a Ana foi chamada de outro nome no meio da conversa" },
      { de: "ele", tipo: "alvo", texto: "O nome do lead é lido duas vezes de fontes diferentes." }
    ]
  },
  {
    id: "cv-1e05",
    titulo: "trocar o link de pagamento pelo checkout novo",
    status: "cancelada",
    em: "ter 16:22", emOrdem: 2,
    rodadas: 2,
    evidencias: [],
    alvo: null,
    custo: [{ usd: 0.41 }, { usdDesconhecido: true, porque: "parada no meio da rodada" }],
    gasto: { usd: 0.82, estimado: true, cegas: 1 },
    chat: [
      { de: "eu", texto: "o link de pagamento agora é o checkout novo, quero que ele mande aquele" },
      { de: "ele", texto: "Antes de dizer o alvo eu preciso saber de onde sai o link novo." }
    ]
  },
  {
    id: "cv-04b8",
    titulo: "por que o lock do redis não pega",
    status: "falhou",
    em: "seg 08:51", emOrdem: 1,
    rodadas: 4,
    erro: "a sessão devolveu `resposta.json` fora de forma em 4 rodadas",
    evidencias: [
      { arquivo: "evidencia/1-saida.json", oque: "saida", resumo: "abri a #176997: redisData.value veio undefined" },
      { arquivo: "evidencia/2-execucoes.json", oque: "execucoes", resumo: "li 40 execuções: 2 com duas respostas no mesmo minuto" }
    ],
    alvo: null,
    custo: [{ usd: 0.33 }, { usd: 0.3 }, { usd: 0.28 }, { usd: 0.31 }],
    gasto: { usd: 1.22, estimado: false, cegas: 0 },
    chat: [
      { de: "eu", texto: "por que o lock do redis não pega? duas mensagens do mesmo contato passam as duas" },
      { de: "ele", texto: "`Code_verificar_lock` testa `redisData.value !== undefined`, e o `redis get` devolve em `propertyName`." }
    ]
  }
];

/* ═══════════════════════════════════════════════════════════════════════════
   O QUE É NOVO — CSS
   Nada aqui inventa cor: os tokens vêm todos do bloco extraído acima. As três
   opções compartilham a MESMA linha de conversa; o que muda é onde ela mora.
   ═══════════════════════════════════════════════════════════════════════════ */

const CSS_NOVO = `
/* ─────────────────────────────────── o vocabulário comum das três opções ─── */

/* Cabeçalho de qualquer uma das três listas: rótulo mono, contagem, e a única
   coisa que precisa CHAMAR — quantas conversas estão esperando por ele. A pilha
   inteira deste projeto diz que "esperando você" é o estado mais fácil de
   esquecer; então ele é o único que ganha pílula. */
.h-cab { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-width: 0; }
.h-cab .rot { font-family: var(--font-num); font-size: 10px; letter-spacing: .12em;
  color: var(--txt-faint); white-space: nowrap; }
.h-cab .ct { font-family: var(--font-num); font-size: 10px; font-variant-numeric: tabular-nums;
  color: var(--txt-dim); }
.h-nag { font-family: var(--font-num); font-size: 9.5px; letter-spacing: .04em; white-space: nowrap;
  padding: 2px 7px; border-radius: 999px;
  color: color-mix(in srgb, var(--warn-txt) 72%, var(--txt));
  background: var(--warn-soft); border: 1px solid color-mix(in srgb, var(--warn) 34%, transparent); }

/* A LINHA. "button" de verdade: teclado de graça, e o anel de foco desta casa
   alcança ".h-item" porque ele entra na regra de ":focus-visible" abaixo. */
.h-item { display: grid; grid-template-columns: 3px minmax(0, 1fr); gap: 0 9px;
  width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: 9px;
  padding: 7px 9px; margin-bottom: 2px; }
.h-item:hover { background: var(--surface-2); border-color: var(--line-soft); }
.h-item.sel { background: var(--accent-soft); border-color: var(--accent-line); }
.h-item i.bar { grid-row: 1 / span 2; width: 3px; align-self: stretch; border-radius: 2px;
  background: var(--cold); }
.h-item .tt { font-size: 12.5px; color: var(--txt-dim); line-height: 1.35;
  overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.h-item.sel .tt { color: var(--txt); font-weight: 600; }
.h-item .mt { grid-column: 2; display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  margin-top: 4px; font-family: var(--font-num); font-size: 9.5px;
  font-variant-numeric: tabular-nums; color: var(--txt-faint); }
.h-item .mt .est { letter-spacing: .04em; }
.h-item .mt .sep { opacity: .45; }
.h-item .mk { display: inline-flex; align-items: center; gap: 3px; }
.h-item .mk svg { display: block; }
.h-item .spin { width: 9px; height: 9px; border-width: 1.6px; }

/* A cor do estado. Sete estados, sete frases — e nenhum deles é verde: confirmar
   o alvo não aplicou nada (a etapa do patch não existe ainda), e pintar de --ok
   afirmaria um resultado que não houve. --accent é movimento, --warn é o que pede
   ação, --cold é o que parou, --risk só o que quebrou sozinho. */
.h-item.e-correndo   i.bar { background: var(--accent); }
.h-item.e-alvo       i.bar { background: var(--accent); }
.h-item.e-confirmado i.bar { background: var(--accent); }
.h-item.e-aguardando i.bar { background: var(--warn); }
.h-item.e-cancelada  i.bar { background: var(--cold); }
.h-item.e-semalvo    i.bar { background: var(--cold); }
.h-item.e-falhou     i.bar { background: var(--risk); }
.h-item.e-correndo   .est { color: var(--accent-txt); }
.h-item.e-alvo       .est { color: var(--accent-txt); }
.h-item.e-confirmado .est { color: var(--accent-txt); }
.h-item.e-aguardando .est { color: var(--warn-txt); }
.h-item.e-falhou     .est { color: var(--risk-txt); }

.h-nova { width: 100%; justify-content: center; }
.h-vazio { font-size: 12px; line-height: 1.6; color: var(--txt-faint); padding: 12px 9px; }
.h-vazio b { color: var(--txt-dim); font-weight: 600; }

/* Barra de rolagem tematizada: uma lista que rola é o lugar onde o padrão do
   navegador aparece, e ele não pertence a nenhum design. */
.h-lista, .hfx { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.h-lista::-webkit-scrollbar, .hfx::-webkit-scrollbar { width: 9px; height: 9px; }
.h-lista::-webkit-scrollbar-thumb, .hfx::-webkit-scrollbar-thumb {
  background: var(--line); border-radius: 9px; border: 3px solid transparent; background-clip: content-box; }
.h-lista::-webkit-scrollbar-track, .hfx::-webkit-scrollbar-track { background: transparent; }

/* O título da conversa aberta entra no cabeçalho da seção [ 01 ], que hoje está
   vazio à direita. Nas três opções ele responde "qual delas eu estou lendo" sem
   truncar — na gaveta é a ÚNICA coisa que responde isso com a gaveta fechada. */
.secao { flex-wrap: nowrap; white-space: nowrap; }
.secao .ix { flex: 0 0 auto; }
.secao .aberta { flex: 1 1 auto; color: var(--txt-dim); min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.secao .aberta i { color: var(--txt-faint); font-style: normal; }

/* ───────────────────────────────────────────── A · TRILHA (coluna própria) ── */
.tela[data-hist="trilha"] .duas { grid-template-columns: 208px minmax(0, 1fr) minmax(0, 1.45fr); }
.col-hist { padding: 14px 10px 12px; border-right: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
.col-hist .h-lista { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
@media (max-width: 1180px) {
  .tela[data-hist="trilha"] .duas { grid-template-columns: 172px minmax(0, 1fr) minmax(0, 1.45fr); }
}

/* ─────────────────────────────────────── B · FAIXA (uma tira, largura toda) ── */
/* Ela NÃO é uma segunda faixa tingida: a do dossiê já ocupa esse lugar e duas
   fitas coloridas empilhadas leriam como decoração. Fundo transparente, fio
   embaixo, e as conversas como pastilhas. */
/* A tela nasce com tres linhas (cabecalho, dossie, as duas colunas). A faixa e uma
   QUARTA, e declara-la e obrigatorio: sem isso ela cai na linha implicita, herda o
   minmax(0,1fr) que era das colunas, e o desenho passa a ser dimensionado pelo
   proprio conteudo — medido, o desenho caiu de 593 para 256px de altura e a faixa
   vazia ficou com meia tela. */
.tela[data-hist="faixa"] { grid-template-rows: auto auto auto minmax(0, 1fr); }
.hfx { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 16px;
  border-bottom: 1px solid var(--line); overflow-x: auto; overflow-y: hidden; }
/* A pastilha e de UMA linha, e isso e o que faz a faixa custar 38px em vez de 60:
   com titulo em cima e meta embaixo ela virava uma terceira faixa. O preco esta
   dito no relatorio — a pastilha nao carrega hora nem custo, so titulo, estado,
   evidencia e alvo. O estado nunca e apenas a cor da barra: a palavra vem junto. */
.hfx .h-item { display: flex; align-items: center; gap: 7px; width: auto; flex: 0 0 auto;
  margin: 0; padding: 4px 10px 4px 5px; max-width: 296px; }
.hfx .h-item i.bar { grid-row: auto; align-self: stretch; min-height: 17px; }
/* "display: block" de volta: o corte de uma linha aqui e feito por
   "text-overflow", e o "-webkit-box" do clamp de duas linhas nao desenha reticencia
   nenhuma — medido, "a Ana foi chamada..." saia como "a An" cortado seco,
   que le como nome de lead e nao como texto cortado. O "min-width" e o piso: sem
   ele o estado e as marcas comem o titulo ate 8 caracteres. */
.hfx .h-item .tt { display: block; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; flex: 1 1 auto; min-width: 128px; }
.hfx .h-item.sel { max-width: 392px; }
.hfx .h-item .mt { grid-column: auto; margin-top: 0; flex: 0 0 auto; }
.hfx .hfx-fim { flex: 0 0 auto; margin-left: auto; padding-left: 10px; position: sticky; right: 0;
  background: linear-gradient(90deg, transparent, var(--surface) 46%); }
.hfx .fio { flex: 0 0 auto; width: 1px; align-self: stretch; background: var(--line-soft); margin: 0 2px; }

/* ────────────────────────────────────── C · GAVETA (nada de espaço fixo) ──── */
/* "position: relative" na tela é a consequência de implementação desta opção: a
   gaveta e o véu vivem DENTRO do cartão, não em cima da página, porque o topbar
   e a vitrine atrás não têm nada a ver com escolher conversa. */
.tela[data-hist="gaveta"] { position: relative; }
.hgv-scrim { position: absolute; inset: 0; z-index: 30;
  background: color-mix(in srgb, var(--bg-deep) 72%, transparent);
  backdrop-filter: blur(9px) saturate(1.1); -webkit-backdrop-filter: blur(9px) saturate(1.1);
  animation: hgvfade .2s ease-out both; }
@keyframes hgvfade { from { opacity: 0; } }
.hgv { position: absolute; left: 0; top: 0; bottom: 0; z-index: 31; width: min(384px, 88%);
  display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
  background: var(--surface); border-right: 1px solid var(--line);
  box-shadow: 0 0 0 1px var(--line-soft), 40px 0 90px -50px rgba(0, 0, 0, .85);
  animation: hgvin .24s cubic-bezier(.16, .84, .34, 1) both; }
@keyframes hgvin { from { transform: translateX(-101%); } }
@media (prefers-reduced-motion: reduce) {
  .hgv, .hgv-scrim { animation: none; }
}
.hgv-hd { display: flex; align-items: center; gap: 9px; padding: 13px 14px 10px; }
.hgv-hd .idx { font-family: var(--font-num); font-size: 10.5px; letter-spacing: .16em; color: var(--brand-txt); }
.hgv-hd h3 { margin: 0; font-size: 13.5px; font-weight: 600; letter-spacing: -.01em; }
.hgv-hd .x { margin-left: auto; border: 1px solid var(--line); background: transparent; cursor: pointer;
  width: 26px; height: 26px; border-radius: 8px; color: var(--txt-faint); font-size: 13px; line-height: 1; }
.hgv-hd .x:hover { color: var(--txt); border-color: var(--accent-line); background: var(--accent-soft); }
.hgv-busca { padding: 0 14px 11px; }
.hgv-lista { overflow-y: auto; padding: 0 8px 8px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.hgv-lista::-webkit-scrollbar { width: 9px; }
.hgv-lista::-webkit-scrollbar-thumb { background: var(--line); border-radius: 9px;
  border: 3px solid transparent; background-clip: content-box; }
.hgv-ft { display: flex; align-items: center; gap: 8px; padding: 9px 14px;
  border-top: 1px solid var(--line-soft); background: var(--surface-2);
  font-size: 11px; color: var(--txt-faint); }
.hgv-ft .tot { margin-left: auto; font-family: var(--font-num); font-variant-numeric: tabular-nums; }
.hgv-ft .h-nova { width: auto; flex: 0 0 auto; margin-right: 4px; }
.hgv.vazia { grid-template-rows: auto minmax(0, 1fr) auto; }

/* A linha rica: espaço é grátis quando é temporário, então aqui o título não
   trunca e cabe o que a lista das outras duas não consegue mostrar. */
.hgv .h-item { padding: 9px 10px; margin-bottom: 3px; }
.hgv .h-item .tt { -webkit-line-clamp: 2; }
.hgv .h-item .ult { grid-column: 2; margin-top: 4px; font-size: 11px; line-height: 1.5;
  color: var(--txt-faint); overflow: hidden; display: -webkit-box;
  -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.hgv .h-item .quando { font-family: var(--font-num); font-size: 9.5px; color: var(--txt-faint);
  font-variant-numeric: tabular-nums; }
.hgv .h-item .lin1 { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
.hgv .h-item .lin1 .tt { flex: 1 1 auto; }
.hgv .h-item .lin1 .quando { flex: 0 0 auto; }

/* O botão que chama a gaveta. O número vive nele porque, fechada, é a única
   coisa na tela que diz que existe história. */
.hgv-bt { display: inline-flex; align-items: center; gap: 6px; }
.hgv-bt svg { display: block; }
.hgv-bt .n { font-family: var(--font-num); font-variant-numeric: tabular-nums; }
.hgv-bt .esp { font-family: var(--font-num); font-size: 10px; letter-spacing: .02em;
  color: color-mix(in srgb, var(--warn-txt) 72%, var(--txt)); }
.hgv-bt .esp b { font-variant-numeric: tabular-nums; font-weight: 700; }

/* ───────────────────────────────────────────────────── foco e 390 ────────── */
.h-item:focus-visible, .hgv-hd .x:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 9px; }
.h-item:focus-visible { background: var(--accent-soft); }

@media (max-width: 900px) {
  /* A trilha nao cabe como coluna em 390: ela vira uma tira, o que torna A e B a
     mesma tela no telefone. O que ela NAO faz e empilhar as duas colunas: a regra
     ".duas{grid-template-columns:1fr}" do bloco de 900px ja existe no upgrade.html
     e e CODIGO MORTO, porque ".tela[data-layout="duas"] .duas" a vence por
     especificidade — medido, em 390 a tela de hoje mantem duas colunas e a
     conversa fica com 138px de largura. Empilhar aqui faria a opcao A parecer
     melhor em 390 por consertar um defeito que nao e dela; e empilhado dentro de
     uma ".tela" de altura fixa o desenho ia a ZERO de altura (tambem medido).
     Entao a tira entra e o resto fica igual a linha de base, defeito incluido. */
  .tela[data-hist="trilha"] .duas {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr);
    grid-template-rows: auto minmax(0, 1fr); }
  .col-hist { grid-column: 1 / -1; }
  .col-hist { border-right: 0; border-bottom: 1px solid var(--line);
    flex-direction: row; align-items: center; gap: 8px; padding: 7px 10px; overflow-x: auto; }
  .col-hist .h-lista { display: flex; gap: 6px; overflow: visible; margin: 0; padding: 0; }
  .col-hist .h-item { display: flex; align-items: center; gap: 7px; width: auto;
    max-width: 236px; margin: 0; padding: 4px 10px 4px 5px; }
  .col-hist .h-item i.bar { align-self: stretch; min-height: 17px; }
  .col-hist .h-item .tt { display: block; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; flex: 1 1 auto; min-width: 120px; }
  .col-hist .h-item .mt { margin-top: 0; flex: 0 0 auto; }
  .col-hist .h-nova { width: auto; white-space: nowrap; }
  .hfx { padding-left: 12px; }
  .hgv { width: 92%; }
}

/* ═══════════════════════════════ a moldura do preview, que não é da tela ══ */
.pv-doc { max-width: 1480px; margin: 0 auto; padding: 26px 20px 90px; position: relative; z-index: 1; }
.pv-tt { display: flex; align-items: baseline; gap: 11px; flex-wrap: wrap; margin: 0 0 6px; }
.pv-tt .ix { font-family: var(--font-num); font-size: 11px; letter-spacing: .12em; color: var(--brand-txt); }
.pv-tt h1 { font-size: 19px; margin: 0; letter-spacing: -.015em; }
.pv-p { color: var(--txt-dim); font-size: 13px; line-height: 1.65; max-width: 92ch; margin: 8px 0 0; }
.pv-p code { font-family: var(--font-num); font-size: 11.5px; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
.pv-nav { display: flex; gap: 8px; flex-wrap: wrap; margin: 18px 0 0; }
.pv-nav a { font-family: var(--font-num); font-size: 11px; text-decoration: none; color: var(--txt-dim);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; background: var(--surface); }
.pv-nav a:hover { border-color: var(--accent-line); color: var(--txt); }
.pv-leg { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 7px;
  margin: 20px 0 0; padding: 14px; border: 1px solid var(--line-soft); border-radius: 12px;
  background: var(--surface); }
.pv-leg > div { display: flex; align-items: baseline; gap: 9px; font-size: 11.5px; color: var(--txt-faint); }
.pv-leg .est { font-family: var(--font-num); font-size: 10px; letter-spacing: .04em; flex: 0 0 96px; }
.pv-h { font-family: var(--font-num); font-size: 10.5px; letter-spacing: .07em; color: var(--txt-faint);
  margin: 34px 0 4px; padding-top: 18px; border-top: 1px solid var(--line-soft); }
.pv-h b { color: var(--brand-txt); font-weight: 400; }
.pv-cap { font-size: 12.5px; color: var(--txt-dim); line-height: 1.6; margin: 0 0 12px; max-width: 96ch; }
.pv-janela { width: 1440px; max-width: 100%; height: 798px; border: 1px solid var(--line);
  border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); background: var(--surface); }
.pv-janela .tela { height: 100%; min-height: 0; border: 0; border-radius: 0; box-shadow: none; }
body.so { overflow: hidden; }
body.so .pv-doc { max-width: none; margin: 0; padding: 0; }
body.so .pv-janela { width: 100vw; height: 100vh; border: 0; border-radius: 0; box-shadow: none; }
`;

/* ═══════════════════════════════════════════════════════════════════════════
   O QUE É NOVO — JUÍZO E RENDER
   Escrito como função de verdade e serializado com `toString()`: código novo
   compila aqui antes de virar página. Só o que já existe é extraído.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────── bloco de juízo do histórico ─────────────── */
const ESTADO = {
  correndo:   { rot: "correndo agora",  curto: "correndo", cls: "e-correndo",   frase: "a sessão está pensando neste momento" },
  aguardando: { rot: "esperando você",  curto: "espera",   cls: "e-aguardando", frase: "ela perguntou de volta e parou — é o estado mais fácil de esquecer" },
  alvo:       { rot: "alvo na mesa",    curto: "alvo",     cls: "e-alvo",       frase: "ela disse onde mexer e espera o seu ✓" },
  confirmado: { rot: "alvo confirmado", curto: "✓ alvo",   cls: "e-confirmado", frase: "você confirmou o alvo; nada foi escrito no n8n" },
  cancelada:  { rot: "parada por você", curto: "parada",   cls: "e-cancelada",  frase: "você apertou parar — não existe retomar" },
  falhou:     { rot: "quebrou",         curto: "quebrou",  cls: "e-falhou",     frase: "a conversa quebrou sozinha" },
  semalvo:    { rot: "terminou sem alvo", curto: "sem alvo", cls: "e-semalvo",  frase: "acabou sem dizer onde mexer" }
};

/* Ordem: RECÊNCIA, e nada mais. Subir o que espera por ele seria reordenar a
   lista embaixo do olho a cada rodada que termina — a mesma razão pela qual o
   `#feed-sel` do flows.html só rola quando a SELEÇÃO muda, não a cada poll. Quem
   acha o que espera é a pílula do cabeçalho, que é fato sobre o presente. */
function ordemConv(a, b) { return b.emOrdem - a.emOrdem; }

function esperando(cs) { return cs.filter(c => c.status === "aguardando").length; }

/* ─────────────────────────────────────────── desenhos (nunca emoji) ─────── */
function icHist() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M9.4 4.2h8.4a2 2 0 0 1 2 2v5.6a2 2 0 0 1-2 2h-.7"/>'
    + '<path d="M4.2 8.4h9.2a2 2 0 0 1 2 2v5.4a2 2 0 0 1-2 2H7.7L4.2 20.4z"/></svg>';
}
function icEvid() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M13.4 3.9H7.2a1.8 1.8 0 0 0-1.8 1.8v12.6a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V9.3z"/>'
    + '<path d="M13.3 4v5.3h5.3"/><path d="M8.8 13.6h6.2M8.8 16.6h3.8"/></svg>';
}

/* ──────────────────────────────────────────────── a linha, nas três formas ── */

/* `sens` no TÍTULO, e isto não é zelo excessivo: um título nasce do que ele
   escreveu, e ele escreve "a Ana foi chamada de outro nome". Nome de lead na
   tela é exatamente o que o modo gravação existe para cobrir.
   E por isso o título NÃO ganha `title=`: tooltip é hover, e o borrão desta casa
   nunca abre no hover — um tooltip que revela o que o borrão esconde não protege
   nada. É a razão pela qual truncar dói mais aqui que em outros lugares. */
function linhaConv(c, sel, forma) {
  const e = ESTADO[c.status] || ESTADO.semalvo;
  const marcas = [];
  if (c.status === "correndo") marcas.push('<span class="spin" aria-hidden="true"></span>');
  /* Na pastilha a palavra e a curta: "esperando voce" tem 14 caracteres e cada um
     deles sai do titulo, que e a identidade da conversa. A frase inteira continua
     na pilula do cabecalho e na linha larga das outras duas formas. */
  marcas.push('<span class="est">' + (forma === "chip" ? e.curto : e.rot) + "</span>");
  if (c.evidencias.length) {
    marcas.push('<span class="sep">·</span><span class="mk" title="evidência buscada no n8n">'
      + icEvid() + c.evidencias.length + "</span>");
  }
  if (c.alvo) {
    marcas.push('<span class="sep">·</span><span class="mk">'
      + (c.status === "confirmado" ? "✓" : "◇") + " " + c.alvo.nos.length + " nós</span>");
  }
  if (forma !== "chip") {
    marcas.push('<span class="sep">·</span><span>' + (c.gasto.estimado
      ? "US$? não medido"
      : "US$" + c.gasto.usd.toFixed(2).replace(".", ",")) + "</span>");
  }

  const quando = '<span class="quando">' + esc(c.em) + "</span>";
  const titulo = '<span class="tt sens">' + esc(c.titulo) + "</span>";
  const corpo = forma === "rica"
    ? '<div class="lin1">' + titulo + quando + "</div>"
    : titulo;
  const ult = forma === "rica" && c.chat.length
    ? '<div class="ult sens">' + esc(c.chat[c.chat.length - 1].texto) + "</div>"
    : "";
  const meta = forma === "rica"
    ? '<div class="mt">' + marcas.join(" ") + "</div>"
    : '<div class="mt">' + (forma === "chip" ? "" : quando + '<span class="sep">·</span>') + marcas.join(" ") + "</div>";

  return '<button type="button" class="h-item ' + e.cls + (c.id === sel ? " sel" : "") + '"'
    + ' data-c="' + esc(c.id) + '" aria-current="' + (c.id === sel ? "true" : "false") + '">'
    + '<i class="bar" aria-hidden="true"></i>' + corpo + ult + meta + "</button>";
}

function botaoNova() {
  return '<button type="button" class="btn sm h-nova">+ nova conversa</button>';
}

function cabecalhoLista(cs, rot) {
  const n = esperando(cs);
  return '<div class="h-cab"><span class="rot">' + rot + "</span>"
    + '<span class="ct">' + cs.length + "</span>"
    + (n ? '<span class="h-nag">' + n + " esperando você</span>" : "") + "</div>";
}

/* ───────────────────────────────────────────────────── A · TRILHA ────────── */
function colunaTrilha(cs, sel) {
  const corpo = cs.length
    ? cs.slice().sort(ordemConv).map(c => linhaConv(c, sel, "linha")).join("")
    : '<div class="h-vazio"><b>Nenhuma conversa neste fluxo ainda.</b><br>'
      + "A primeira nasce do que você escrever ao lado.</div>";
  return '<div class="col-hist"><nav aria-label="conversas deste fluxo">'
    + cabecalhoLista(cs, "CONVERSAS") + "</nav>"
    + botaoNova()
    + '<div class="h-lista">' + corpo + "</div></div>";
}

/* ───────────────────────────────────────────────────── B · FAIXA ─────────── */
function faixaHistorico(cs, sel) {
  const chips = cs.length
    ? cs.slice().sort(ordemConv).map(c => linhaConv(c, sel, "chip")).join("")
    : '<span class="h-vazio" style="padding:2px 0">nenhuma conversa neste fluxo ainda — '
      + "a primeira nasce do que você escrever abaixo.</span>";
  return '<nav class="hfx" aria-label="conversas deste fluxo">'
    + cabecalhoLista(cs, "CONVERSAS")
    + '<span class="fio" aria-hidden="true"></span>'
    + chips
    + '<span class="hfx-fim">' + botaoNova() + "</span></nav>";
}

/* ───────────────────────────────────────────────────── C · GAVETA ────────── */
/* O aviso de "esperando voce" e PALAVRA, nao um ponto colorido. Um ponto ambar ao
   lado da contagem informa por cor sozinha — quem nao distingue a cor ve so um
   ponto, e este painel ja tem regra escrita sobre isso. Entao a contagem diz o que
   e: "6 conversas · 1 espera". Fechada, esta e a unica coisa na tela que diz que
   existe historia; e tambem a unica que chama quando uma delas parou numa pergunta. */
function botaoGaveta(cs) {
  const n = esperando(cs);
  return '<button type="button" class="btn sm hgv-bt" aria-haspopup="dialog"'
    + ' title="as conversas deste fluxo' + (n ? " — " + n + " esperando resposta sua" : "") + '">'
    + icHist() + '<span class="n">' + cs.length + "</span> conversas"
    + (n ? '<span class="esp">· <b>' + n + "</b> espera</span>" : "") + "</button>";
}

function gaveta(cs, sel, pref) {
  const corpo = cs.length
    ? cs.slice().sort(ordemConv).map(c => linhaConv(c, sel, "rica")).join("")
    : '<div class="h-vazio"><b>Nenhuma conversa neste fluxo ainda.</b><br>'
      + "A primeira nasce do que você escrever no compositor.</div>";
  /* Com a lista vazia o campo de filtro e as dicas de teclado saem: filtrar nada e
     "enter abrir" sem nada para abrir sao controles que nao fazem nada, e um botao
     que nao faz nada e pior que botao nenhum — a mesma regra que tira a dica da
     camera depois de a camera ser usada. O que NAO sai e o "+ nova conversa": vazia
     e exatamente a hora em que ele e a unica coisa que importa. */
  const busca = cs.length
    ? '<div class="hgv-busca"><div class="fbusca"><input type="text" placeholder="filtrar por palavra do título…">'
      + '<span class="kbd">/</span></div></div>'
    : "";
  const dicas = cs.length
    ? '<span class="kbd">↑↓</span> escolher <span class="kbd">enter</span> abrir'
      + '<span class="tot">' + cs.length + " no total</span>"
    : "";
  return '<div class="hgv-scrim" data-fecha="1"></div>'
    + '<aside class="hgv' + (cs.length ? "" : " vazia") + '" role="dialog" aria-modal="true"'
    + ' aria-labelledby="' + pref + '-hgv-t">'
    + '<div class="hgv-hd"><span class="idx">[ CONVERSAS ]</span>'
    + '<h3 id="' + pref + '-hgv-t">deste fluxo</h3>'
    + '<button type="button" class="x" data-fecha="1" aria-label="fechar">✕</button></div>'
    + busca
    + '<div class="hgv-lista">' + corpo + "</div>"
    + '<div class="hgv-ft">' + botaoNova() + dicas + "</div></aside>";
}

/* ══════════════════════════════════════ a moldura: montar cada painel ═════ */

/* A câmera. `montarCamera()` do upgrade.html assume UM palco por página
   (`document.querySelector`) e liga arraste, roda e teclado — nada disso decide
   nada aqui. O que precisa ser fiel é o ENQUADRAMENTO de abertura, e ele é
   fiel porque `camAbertura`, `camCaber` e `camRegiao` são os originais extraídos:
   só as seis linhas que aplicam o `viewBox` são reescritas. */
/* A UNICA divergencia deliberada em relacao a tela: `extentoAcesos()` junta
   `.pn.on` (o alvo) com `.pn.falhou` (o no que quebrou em 24h), e neste fluxo os
   dois estao a ~9.000 unidades de distancia — a regiao fica enorme, `camRegiao`
   bate no piso de ESC_NOME e a camera para num meio de caminho que nao mostra
   nem o alvo nem a falha. Isso e um achado sobre a tela de hoje, esta no
   relatorio, e nao foi consertado aqui porque producao nao se toca nesta fase.
   Enquanto uma decisao de LAYOUT esta sendo julgada, o desenho precisa mostrar o
   alvo; entao aqui o enquadramento le so `.pn.on`. */
function extentoAlvo(svg) {
  const ns = [...svg.querySelectorAll(".pn.on")];
  if (!ns.length) return null;
  const xs = ns.map(n => +n.dataset.x), ys = ns.map(n => +n.dataset.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs) + NODE,
    y0: Math.min(...ys), y1: Math.max(...ys) + NODE + LABEL_GAP + 34 };
}

function enquadrar(box) {
  const svg = box.querySelector("svg.palco");
  if (!svg) return;
  const vw = +svg.dataset.vw, vh = +svg.dataset.vh;
  const bw = box.clientWidth || 1, bh = box.clientHeight || 1;
  const r = extentoAlvo(svg) || extentoAcesos(svg);
  const cam = r ? camRegiao(r, bw, bh, ESC_NOME, ESC_ALVO) : camAbertura(svg, vw, vh, bw, bh);
  const w = bw / cam.esc, h = bh / cam.esc;
  svg.setAttribute("viewBox", (cam.cx - w / 2) + " " + (cam.cy - h / 2) + " " + w + " " + h);
  const et = box.querySelector(".cam-esc");
  if (et) et.textContent = "nó " + Math.round(NODE * cam.esc) + "px";
}

function painel(p) {
  const cs = p.vazio ? [] : CONVS;
  const sel = p.vazio ? null : (p.sel || "cv-3d10");
  const conv = cs.find(c => c.id === sel) || null;

  S.conv = conv;
  S.dossie = new Map([[String(FLUXO.id), DOSSIE]]);

  const cx = document.createElement("div");
  cx.className = "pv-janela";
  cx.innerHTML = telaFluxo(FLUXO);
  const tela = cx.querySelector(".tela");
  tela.dataset.hist = p.op;

  /* Id repetido em sete painéis é defeito de verdade (o leitor de tela lê o
     primeiro e ignora os outros), então cada painel prefixa os seus. */
  cx.querySelectorAll("[id]").forEach(el => { el.id = p.id + "-" + el.id; });

  const duas = tela.querySelector(".duas");
  if (p.op === "trilha") duas.insertAdjacentHTML("afterbegin", colunaTrilha(cs, sel));
  if (p.op === "faixa") duas.insertAdjacentHTML("beforebegin", faixaHistorico(cs, sel));
  if (p.op === "gaveta") {
    tela.querySelector(".th-r").insertAdjacentHTML("afterbegin", botaoGaveta(cs));
    if (p.aberta) tela.insertAdjacentHTML("beforeend", gaveta(cs, sel, p.id));
  }

  /* O título da conversa aberta no cabeçalho da seção [ 01 ] — só na GAVETA.
     Nas outras duas a linha selecionada já diz qual conversa está aberta, e
     repetir custaria a única fatia livre daquele cabeçalho. Aqui ele é o que
     responde "qual delas eu estou lendo" com a gaveta fechada. */
  if (conv && p.op === "gaveta") {
    const s = tela.querySelector(".col-chat .secao");
    const hint = s.querySelector(".hint");
    const alvo = document.createElement("span");
    alvo.className = "aberta";
    alvo.innerHTML = '<i>·</i> ' + '<span class="sens">' + esc(conv.titulo) + "</span>";
    if (hint) s.insertBefore(alvo, hint); else s.appendChild(alvo);
  }
  return cx;
}

function montar() {
  const q = new URLSearchParams(location.search);
  const so = q.get("so");
  if (q.get("rec") === "1") document.documentElement.setAttribute("data-rec", "1");

  const doc = document.getElementById("pv");
  const lista = so ? PAINEIS.filter(p => p.id === so) : PAINEIS;

  if (so) {
    document.body.classList.add("so");
    doc.innerHTML = "";
  }

  for (const p of lista) {
    if (!so) {
      const h = document.createElement("div");
      h.className = "pv-h";
      h.innerHTML = p.cap;
      doc.appendChild(h);
      const c = document.createElement("p");
      c.className = "pv-cap";
      c.innerHTML = p.prosa;
      doc.appendChild(c);
    }
    doc.appendChild(painel(p));
  }

  document.querySelectorAll(".palco-box").forEach(enquadrar);

  /* A faixa rola: com seis conversas so entram ~3,5 pastilhas, e a selecionada
     pode nascer fora da vista. Sem isso a tira mostraria as tres mais recentes e
     nenhuma marca de que a aberta e outra. */
  document.querySelectorAll(".hfx .h-item.sel, .col-hist .h-item.sel").forEach(el => {
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "center" });
  });

  /* Clicar numa linha troca a conversa aberta DAQUELE painel, para dar para
     sentir a navegação — é o que o `?c=<conversa>` da URL vai fazer de verdade. */
  doc.addEventListener("click", ev => {
    const it = ev.target.closest(".h-item");
    const cx = ev.target.closest(".pv-janela");
    if (!it || !cx) return;
    const p = PAINEIS.find(x => x.id === cx.dataset.pid);
    if (!p) return;
    const novo = painel(Object.assign({}, p, { sel: it.dataset.c }));
    novo.dataset.pid = p.id;
    cx.replaceWith(novo);
    novo.querySelectorAll(".palco-box").forEach(enquadrar);
  });

  document.querySelectorAll(".pv-janela").forEach((el, i) => { el.dataset.pid = lista[i].id; });
  document.documentElement.dataset.pronto = "1";
}

/* ═══════════════════════════════════════════════════════ os sete painéis ═══ */

const PAINEIS = [
  /* A LINHA DE BASE. Sem ela nao ha como separar o que uma opcao custa do que a
     tela ja fazia — e em 390 isso importa: o desenho ja nasce esmagado ali hoje. */
  { id: "Z-hoje", op: "hoje",
    cap: "<b>[ LINHA DE BASE ]</b> A TELA DE HOJE · UMA CONVERSA, NENHUMA LISTA",
    prosa: "É contra esta medida que as três opções são comparadas: caixa do desenho "
      + "<code>818×508</code>, rolagem da conversa <code>563×236</code>, numa janela de 1440×900." },
  { id: "A-cheio", op: "trilha",
    cap: "<b>[ OPÇÃO A ]</b> TRILHA · ESTADO CHEIO · 6 CONVERSAS, 1 CORRENDO, 1 COM ALVO",
    prosa: "Uma terceira coluna de 208px, fixa. A lista inteira fica na tela sem clique e sem "
      + "rolagem horizontal, com duas linhas de título. O preço é largura: ela sai das "
      + "duas colunas que já disputavam a tela." },
  { id: "A-vazio", op: "trilha", vazio: true,
    cap: "<b>[ OPÇÃO A ]</b> TRILHA · FLUXO SEM NENHUMA CONVERSA",
    prosa: "A trilha continua lá, e diz que está vazia. Porta que só aparece quando tem algo "
      + "atrás é porta que ninguém acha — a lixeira do Tester já pagou essa lição." },
  { id: "B-cheio", op: "faixa",
    cap: "<b>[ OPÇÃO B ]</b> FAIXA · ESTADO CHEIO · 6 CONVERSAS, 1 CORRENDO, 1 COM ALVO",
    prosa: "Uma tira de 40px atravessando a largura toda, entre o dossiê e as duas colunas. "
      + "Nenhuma das duas perde largura; as duas perdem a mesma altura. O preço é o título, "
      + "que trunca — e não pode ter tooltip." },
  { id: "B-vazio", op: "faixa", vazio: true,
    cap: "<b>[ OPÇÃO B ]</b> FAIXA · FLUXO SEM NENHUMA CONVERSA",
    prosa: "Vazia a faixa é uma linha de texto e um botão — 40px que ainda dizem para que "
      + "aquele lugar serve." },
  { id: "C-aberta", op: "gaveta", aberta: true,
    cap: "<b>[ OPÇÃO C ]</b> GAVETA ABERTA · 6 CONVERSAS, 1 CORRENDO, 1 COM ALVO",
    prosa: "A gaveta não tira pixel nenhum de ninguém: ela passa por cima, dentro do cartão, "
      + "com o véu e o desfoque que esta casa já usa. Espaço temporário é grátis, então "
      + "aqui o título não trunca e cabe a última mensagem." },
  { id: "C-fechada", op: "gaveta",
    cap: "<b>[ OPÇÃO C ]</b> GAVETA FECHADA · A TELA DE HOJE, MAIS UM BOTÃO",
    prosa: "Este é o custo permanente da opção C: um botão no cabeçalho com a contagem e um "
      + "ponto quando alguém está esperando. Qual conversa está aberta é respondido pelo "
      + "título em <code>[ 01 ] A conversa</code>." },
  { id: "C-vazio", op: "gaveta", aberta: true, vazio: true,
    cap: "<b>[ OPÇÃO C ]</b> GAVETA · FLUXO SEM NENHUMA CONVERSA",
    prosa: "Aberta e vazia: a frase mora onde a lista moraria, e o botão do cabeçalho marca "
      + "<code>0</code> em vez de desaparecer." }
];

/* ═════════════════════════════════════════════════════════ escrever a página ═ */

const NOVO = [
  ordemConv, esperando, icHist, icEvid, linhaConv, botaoNova, cabecalhoLista,
  colunaTrilha, faixaHistorico, botaoGaveta, gaveta, extentoAlvo, enquadrar, painel, montar
];
const fonteNovo = NOVO.map(f => (typeof f === "function" ? f.toString() : null)).filter(Boolean).join("\n\n");

const legenda = Object.keys(ESTADO).map(k =>
  '<div><span class="est h-item ' + ESTADO[k].cls + '" style="border:0;padding:0;display:block">'
  + '<span class="mt" style="margin:0"><span class="est">' + ESTADO[k].rot + "</span></span></span>"
  + "<span>" + ESTADO[k].frase + "</span></div>").join("");

const cabeca = [
  '<div class="pv-tt"><span class="ix">[ ESCOLHA DE DESENHO ]</span>',
  "<h1>Histórico de conversas no <code>/upgrade</code> — três lugares possíveis</h1></div>",
  '<p class="pv-p">Hoje esta tela tem <b>uma</b> conversa por fluxo, viva só em memória. A questão não ',
  "é desenhar uma lista — é onde ela cabe numa tela cujas <b>duas</b> colunas precisam de largura: ",
  "a conversa com o compositor, e o desenho de <b>179 nós</b> com arrasto e zoom. As três opções ",
  "abaixo gastam eixos diferentes: <b>A</b> gasta largura, <b>B</b> gasta altura, <b>C</b> gasta um clique. ",
  "O desenho, o dossiê, a conversa e o alvo são os de verdade — CSS e funções são extraídos do ",
  "<code>upgrade.html</code> na geração, e as coordenadas dos nós são as do <code>Agente Iago ",
  "Comercial</code>. O que está escrito à mão aqui é só a lista, que é o que ainda não existe.</p>",
  '<div class="pv-nav">',
  PAINEIS.map(p => '<a href="?so=' + p.id + '">' + p.id + "</a>").join(""),
  '<a href="?theme=light">tema claro</a><a href="?theme=dark">tema escuro</a>',
  '<a href="?rec=1">modo gravação</a><a href="?">tudo</a></div>',
  '<p class="pv-p" style="margin-top:16px">Sete estados, sete frases — e <b>nenhum verde</b>: ',
  "confirmar o alvo não aplicou nada, porque a etapa do patch ainda não existe, e ",
  "<code>--ok</code> afirmaria um resultado que não houve.</p>",
  '<div class="pv-leg">' + legenda + "</div>"
].join("\n");

const html = [
  "<!doctype html>",
  '<html lang="pt-BR" data-theme="dark"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>preview · histórico de conversas no /upgrade</title>",
  "<style>", css, CSS_NOVO, "</style>",
  "<script>",
  '(function(){var q=new URLSearchParams(location.search).get("theme");',
  'if(q==="light"||q==="dark")document.documentElement.setAttribute("data-theme",q);})();',
  "</script></head>",
  '<body><div class="backdrop"><i class="gbeam"></i><i class="gbeam b2"></i></div>',
  '<div class="pv-doc"><div id="cabeca">' + cabeca + '</div><div id="pv"></div></div>',
  "<script>",
  '"use strict";',
  "/* ---- extraído de upgrade.html na geração, byte a byte ---- */",
  DE_CIMA,
  "/* ---- os dados: fluxo, dossiê e conversas reais ---- */",
  "const S = { conv: null, dossie: new Map(), sel: null };",
  "const GRAFO = " + JSON.stringify(GRAFO) + ";",
  "const FLUXO = Object.assign(" + JSON.stringify(FLUXO) + ", { graph: GRAFO });",
  "const DOSSIE = " + JSON.stringify(DOSSIE) + ";",
  "const CONVS = " + JSON.stringify(CONVS) + ";",
  "/* o bloco de juizo dos estados: dado, entao viaja como dado \*/",
  "const ESTADO = " + JSON.stringify(ESTADO, null, 1) + ";",
  "const PAINEIS = " + JSON.stringify(PAINEIS) + ";",
  "/* ---- o que é novo: escrito à mão, porque não existe para extrair ---- */",
  fonteNovo,
  'if (new URLSearchParams(location.search).get("so")) document.getElementById("cabeca").remove();',
  "montar();",
  "</script></body></html>"
].join("\n");

fs.writeFileSync(ALVO_HTML, html, "utf8");
console.log("escrito " + ALVO_HTML + " (" + (html.length / 1024).toFixed(0) + "KB)");

/* ═══════════════════════════════════════════════════════════════ os PNGs ═══ */

const TOMADAS = [
  { arq: "historico-Z-hoje-escuro.png", so: "Z-hoje", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-Z-hoje-390.png", so: "Z-hoje", tema: "dark", w: 390, h: 742 },
  { arq: "historico-A-trilha-escuro.png", so: "A-cheio", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-A-trilha-claro.png", so: "A-cheio", tema: "light", w: 1440, h: 798 },
  { arq: "historico-A-trilha-vazio.png", so: "A-vazio", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-A-trilha-390.png", so: "A-cheio", tema: "dark", w: 390, h: 742 },
  { arq: "historico-B-faixa-escuro.png", so: "B-cheio", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-B-faixa-claro.png", so: "B-cheio", tema: "light", w: 1440, h: 798 },
  { arq: "historico-B-faixa-vazio.png", so: "B-vazio", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-B-faixa-390.png", so: "B-cheio", tema: "dark", w: 390, h: 742 },
  { arq: "historico-B-faixa-gravando.png", so: "B-cheio", tema: "dark", w: 1440, h: 798, rec: 1 },
  { arq: "historico-C-gaveta-escuro.png", so: "C-aberta", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-C-gaveta-claro.png", so: "C-aberta", tema: "light", w: 1440, h: 798 },
  { arq: "historico-C-gaveta-fechada.png", so: "C-fechada", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-C-gaveta-vazio.png", so: "C-vazio", tema: "dark", w: 1440, h: 798 },
  { arq: "historico-C-gaveta-390.png", so: "C-aberta", tema: "dark", w: 390, h: 742 },
  { arq: "historico-C-gaveta-gravando.png", so: "C-aberta", tema: "dark", w: 1440, h: 798, rec: 1 }
];

/* O playwright não é dependência deste projeto (zero dependências, é regra), e
   este arquivo não pode passar a exigir uma. Então ele é procurado onde a máquina
   já o tem; não achando, o HTML já está escrito e a mensagem diz o que fazer. */
const CAMINHOS = [
  "playwright",
  path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx", "db89d7302a373f10", "node_modules", "playwright"),
  path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx", "e41f203b7505f1fb", "node_modules", "playwright")
];
function acharPlaywright() {
  for (const c of CAMINHOS) { try { return require(c); } catch { /* segue */ } }
  const glob = path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx");
  try {
    for (const d of fs.readdirSync(glob)) {
      const p = path.join(glob, d, "node_modules", "playwright");
      if (fs.existsSync(p)) { try { return require(p); } catch { /* segue */ } }
    }
  } catch { /* sem cache do npx */ }
  return null;
}

async function capturar() {
  const pw = acharPlaywright();
  if (!pw) {
    console.log("\nNÃO CAPTUREI OS PNG: não achei o playwright nesta máquina.");
    console.log("O HTML está escrito e abre com dois cliques. Para as imagens:");
    console.log("  npx playwright@1.62.1 install chromium   (uma vez)");
    console.log("  node preview/gen-historico-preview.js --png");
    process.exitCode = 0;
    return;
  }
  const nav = await pw.chromium.launch();
  const url = "file:///" + ALVO_HTML.replace(/\\/g, "/");
  const medidas = [];
  for (const t of TOMADAS) {
    const ctx = await nav.newContext({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    const erros = [];
    pg.on("pageerror", e => erros.push(String(e.message)));
    await pg.goto(url + "?so=" + t.so + "&theme=" + t.tema + (t.rec ? "&rec=1" : ""));
    await pg.waitForFunction('document.documentElement.dataset.pronto === "1"', null, { timeout: 15000 });
    await pg.waitForTimeout(320);
    if (erros.length) throw new Error("erro de página em " + t.arq + ": " + erros[0]);
    if (t.w === 1440) {
      medidas.push(await pg.evaluate(nome => {
        const g = s => document.querySelector(s);
        const cx = el => el ? [el.clientWidth, el.clientHeight] : null;
        return {
          painel: nome,
          desenho: cx(g(".palco-box")),
          chat: cx(g(".conv-rol")),
          colChat: cx(g(".col-chat")),
          colDesenho: cx(g(".col-desenho")),
          no: (g(".cam-esc") || {}).textContent || ""
        };
      }, t.so));
    }
    await pg.screenshot({ path: path.join(__dirname, t.arq), animations: "disabled" });
    await ctx.close();
    console.log("  " + t.arq);
  }
  await nav.close();
  console.log("\nMEDIDO na caixa de 1440x798 (a tela real numa janela de 1440x900):");
  for (const m of medidas) {
    console.log("  " + m.painel.padEnd(11)
      + " desenho " + (m.desenho ? m.desenho.join("x") : "?").padEnd(9)
      + " conversa(rolagem) " + (m.chat ? m.chat.join("x") : "?").padEnd(9)
      + " col-chat " + (m.colChat ? m.colChat.join("x") : "?").padEnd(9)
      + " " + m.no);
  }
}

if (process.argv.includes("--png")) capturar().catch(e => { console.error(e); process.exit(1); });
