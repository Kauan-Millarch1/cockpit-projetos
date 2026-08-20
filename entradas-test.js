/* entradas-test.js — voz e anexo são UM arquivo servido, e continuam sendo.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O bloco de voz + anexo nasceu dentro do
 * `tester.html`. Quando o compositor do `/upgrade` pediu as mesmas entradas, o
 * caminho fácil era copiar — e esta base tem três blocos copiados à mão (topbar,
 * `.aviso`, modo gravação) com a dívida registrada no `CLAUDE.md`. Um deles já
 * produziu um `Illegal return statement` no `flows.html` porque alguém INSERIU em
 * vez de SUBSTITUIR: um erro que mata a página inteira e não aponta para a causa.
 *
 * Então o bloco virou `/entradas.js`, servido, no precedente do `aba.js`. O bloco
 * 1 deste arquivo é o que falha no dia em que uma das duas páginas voltar a
 * declarar o bloco por conta própria — que é o único jeito de a cópia voltar.
 *
 * A FONTE É MEDIDA SEM COMENTÁRIO, e isso não é detalhe. O `dossie-tela-test.js`
 * já pagou por isso: dois casos ficaram VERDES depois de a guarda ser deletada,
 * porque o comentário que explicava a guarda citava o nome que o `includes`
 * procurava. Um teste que casa dentro de comentário documenta a decisão no melhor
 * caso e aprova a AUSÊNCIA dela no pior — e ali fez os dois.
 *
 * OS BLOCOS DE JULGAMENTO DA PÁGINA SÃO EXTRAÍDOS em tempo de execução, nunca
 * reimplementados: reimplementar provaria a cópia. Mesma disciplina do
 * `audio-test.js` e do `dossie-tela-test.js`.
 *
 * De graça: nenhum browser, nenhuma rede, nenhum modelo, nenhum CLI. O cliente do
 * n8n é substituído no `require.cache` ANTES do require do `upgrade.js`, então
 * nada fala com a instância. `node entradas-test.js` */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/* O n8n e o CLI falsos entram ANTES do `upgrade.js`, senão ele fecha em cima dos
   módulos reais e o bloco 5 vira uma leitura na instância do Kauan (e um
   `claudeFound` que depende de o CLI estar instalado nesta máquina). Mesma técnica
   do `escrever-test.js` e do `reexec-test.js`. */
const n8n = require("./n8n.js");
n8n.configured = true;
let DOC = null;
n8n.getRawWorkflow = async () => JSON.parse(JSON.stringify(DOC));

const fix = require("./claude-fix.js");
fix.claudeFound = true;

const E = require("./entradas.js");
const up = require("./upgrade.js");
const anexosMod = require("./anexos.js");

let ok = 0, bad = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
};

const H = {
  tester: fs.readFileSync(path.join(__dirname, "tester.html"), "utf8"),
  upgrade: fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8"),
  server: fs.readFileSync(path.join(__dirname, "server.js"), "utf8")
};

/* Fonte SEM comentário. `//` e `/* *\/` saem, e as strings viram vazias — senão
   um `title="..."` que cite um nome contaria como declaração dele. Grosseiro de
   propósito: aqui não se avalia nada, só se procura declaração. */
function nuinha(txt) {
  return String(txt)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}()])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}
const scripts = h => [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const estilos = h => [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 1 ] um arquivo servido, e nenhuma quarta cópia");

t("o servidor serve `/entradas.js`",
  /p === "\/entradas\.js"/.test(H.server) && /path\.join\(__dirname, "entradas\.js"\)/.test(H.server));

for (const [pg, h] of Object.entries(H)) {
  if (pg === "server") continue;
  const tags = [...h.matchAll(/<script[^>]*src="\/entradas\.js"[^>]*>/g)];
  t(pg + ".html: carrega o módulo exatamente uma vez", tags.length === 1);
  /* NÃO DEFERIDO, e é uma armadilha medida: um script inline no fim do body roda
     ANTES dos deferidos, então `configurar()` receberia `window.__entradas`
     `undefined` — e o erro apareceria no clique de anexar, parecendo defeito do
     arquivo dela em vez de ordem de carregamento. */
  t(pg + ".html: e NÃO com `defer` (o inline roda antes dos deferidos)",
    tags.length === 1 && !/\bdefer\b/.test(tags[0][0]));
  t(pg + ".html: configura o módulo uma vez",
    (nuinha(scripts(h)).match(/IO\(\)\.configurar\(/g) || []).length === 1);
}

/* O QUE NENHUMA DAS DUAS PÁGINAS PODE DECLARAR. Cada nome aqui é uma peça que
   voltaria a ser cópia — e a cópia é invisível até divergir. */
const DECLARACOES = [
  "function barraIO", "function chipsAnexos", "function notaAnexos",
  "function ligarIO", "function ligarVoz", "function subirArquivos",
  "function tirarAnexo", "function avisarRecusas", "function agruparRecusas",
  "const VOZ_OK", "const ICONE_ANEXO", "const RECUSA_ROTULO",
  "const MSG_SEGREDO_CURTA", "const b64De", "webkitSpeechRecognition"
];
for (const [pg, h] of Object.entries(H)) {
  if (pg === "server") continue;
  const js = nuinha(scripts(h));
  const achadas = DECLARACOES.filter(d => js.includes(d));
  t(pg + ".html: não declara nada do bloco (" + DECLARACOES.length + " nomes conferidos)"
    + (achadas.length ? " — achei " + achadas.join(", ") : ""), achadas.length === 0);
}

/* E O CSS TAMBÉM É UM SÓ. Duas folhas para um desenho é uma a mais para divergir,
   e a que divergisse seria a que ninguém olhou — o `css-test.js` nasceu de uma
   regra aberta numa cópia dessas. */
const SELETORES = [".iobar{", ".iob{", ".anx{", ".anexos{", ".ditando{", ".anxnota{"];
for (const [pg, h] of Object.entries(H)) {
  if (pg === "server") continue;
  const css = nuinha(estilos(h)).replace(/\s*\{/g, "{");
  const achados = SELETORES.filter(s => css.includes(s));
  t(pg + ".html: não redeclara o CSS do módulo"
    + (achados.length ? " — achei " + achados.join(", ") : ""), achados.length === 0);
  t(pg + ".html: e o módulo é quem tem essas regras",
    SELETORES.every(s => E.CSS.replace(/\s*\{/g, "{").includes(s)));
}

/* AS ROTAS QUE A PÁGINA PROMETE TÊM DE EXISTIR NO SERVIDOR — mesmo espírito do
   `nav-sync-test.js`, que confere que cada `href` do topbar aponta para uma rota
   que o `server.js` serve. Aqui o erro seria pior: um `404` no meio de um upload
   que a tela relata como recusa do arquivo. */
const ROTAS = {
  tester: ["/api/tester/anexo", "/api/tester/anexo/remover"],
  upgrade: ["/api/upgrade/anexo", "/api/upgrade/anexo/remover"]
};
for (const [pg, rotas] of Object.entries(ROTAS)) {
  const js = scripts(H[pg]);
  for (const r of rotas) {
    t(pg + ".html: pede `" + r + "` e o servidor tem essa rota",
      js.includes('"' + r + '"') && H.server.includes('p === "' + r + '"'));
  }
}
t("as duas ações de sessão do upgrade existem no servidor",
  /acao === "anexo" && req\.method === "POST"/.test(H.server)
  && /acao === "desanexar" && req\.method === "POST"/.test(H.server));

/* O `callApi` DE CADA PÁGINA TEM DE COPIAR `categoria` PARA O ERRO. É ele que faz
   o agrupamento existir: sem essa cópia toda recusa de um lote cai em «formato», e
   uma pasta com uma chave dentro diria "3 tipos que eu não abro" — falso, e falso
   na direção que convida a converter a chave para um formato aceito.
   Medido: o `upgrade.html` NÃO copiava, e o defeito não aparece na tela (a frase do
   segredo ainda sai inteira), só o rótulo do grupo sai errado. */
for (const pg of ["tester", "upgrade"]) {
  const ca = (scripts(H[pg]).match(/async function callApi[\s\S]{0,1400}?\n\}/) || [""])[0];
  t(pg + ".html: o `callApi` copia `categoria` para o Error (é o que agrupa)",
    /err\.categoria = |categoria = corpo\.categoria|\.categoria = body\.categoria/.test(ca), ca.slice(0, 80));
  /* E `bandeja`: o servidor cria o diretório antes de validar, então a recusa
     também tem id. Sem trazê-lo de volta, um lote cujo primeiro arquivo é recusado
     deixa uma bandeja vazia órfã e o segundo arquivo abre outra. */
  t(pg + ".html: ...e copia `bandeja` (senão a recusa órfã deixa bandeja vazia)",
    /\.bandeja = (corpo|body)\.bandeja/.test(ca), ca.slice(0, 80));
}

/* A BANDEJA ABANDONADA DAS DUAS RAÍZES. São dois diretórios (`.tester-runs` e
   `.upgrade-runs`), e limpar só um deixaria o outro crescendo calado — arquivo de
   alguém dentro, descoberto quando o disco enche. */
t("o boot limpa bandeja abandonada das DUAS raízes",
  /upgrade\.RUNS_DIR/.test(H.server) && /TESTER_RUNS/.test(H.server)
  && /limparBandejas/.test(H.server));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 2 ] o que a fileira desenha");

const A = (nome, extra) => Object.assign({
  nome, arquivo: "anexos/" + nome, dePasta: false, tipo: "dados", bytes: 4096, segredosRemovidos: 0
}, extra || {});

t("sem anexo nenhum, nenhum chip e nenhuma nota",
  E.chipsAnexos([], [], true) === "" && E.notaAnexos([]) === "");

const chips = E.chipsAnexos([A("clientes-2026.csv"), A("print.png", { tipo: "imagem" })], [], true);
/* O NOME É `sens`, e é o caso load-bearing do desenho: `clientes-2026.csv`
   identifica um cliente, e o modo gravação existe para borrar exatamente isso.
   Tipo e tamanho ficam legíveis — eles não identificam ninguém e são o que deixa
   ele conferir que subiu o arquivo certo. */
t("o NOME do anexo é `sens` (o modo gravação borra)",
  (chips.match(/class="nm sens"/g) || []).length === 2);
t("...e o tamanho NÃO é (é o que confirma que subiu o arquivo certo)",
  /class="sz">4KB</.test(chips) && !/class="sz sens/.test(chips));
t("glifo geométrico, nunca emoji (📎 e 🗀 saem como caixa vazia nesta fonte)",
  /▦|▣/.test(chips) && !/[\u{1F300}-\u{1FAFF}]/u.test(chips));

t("lido é marca própria — anexar sem isso seria ato de fé",
  /class="anx lido"/.test(E.chipsAnexos([A("x.csv")], ["anexos/x.csv"], true))
  && !/class="anx lido"/.test(E.chipsAnexos([A("x.csv")], [], true)));
t("...e o `title` distingue «ela abriu» de «anexado»",
  /a sessão abriu este arquivo/.test(E.chipsAnexos([A("x.csv")], ["anexos/x.csv"], true))
  && /a sessão decide se precisa abrir/.test(E.chipsAnexos([A("x.csv")], [], true)));

t("sem poder remover, não há botão de ×",
  !/data-tirar/.test(E.chipsAnexos([A("x.csv")], [], false))
  && /data-tirar/.test(E.chipsAnexos([A("x.csv")], [], true)));

t("nome com HTML dentro é escapado (o nome vem do navegador, é payload)",
  !E.chipsAnexos([A('<img src=x onerror="a">.csv')], [], true).includes("<img src=x"));

const nota = E.notaAnexos([A("a.md", { tipo: "texto", segredosRemovidos: 2 }), A("b.png", { tipo: "imagem" })]);
t("a nota diz quantos segredos foram trocados em TEXTO", /2 valor\(es\) com cara de token/.test(nota));
/* DIZER O QUE NÃO FOI FEITO é a parte que costuma faltar: pixel não dá para
   varrer, e afirmar o contrário seria a mentira maior. */
t("...e diz em voz alta que imagem/PDF NÃO passa pela limpeza",
  /não varre pixel/.test(nota) && /1 imagem\/PDF/.test(nota));

const barra = E.barraIO("up");
t("a barra usa os ids com prefixo (o contrato entre página e módulo)",
  ["up-arq", "up-pasta", "up-fi", "up-fp"].every(id => barra.includes('id="' + id + '"')));
t("`pasta` é o input com webkitdirectory (é o que preserva a árvore)",
  /webkitdirectory directory multiple/.test(barra));
t("os rótulos são `⊕ anexar` e `⊞ pasta`, nunca emoji",
  /⊕<\/span> anexar/.test(barra) && /⊞<\/span> pasta/.test(barra));
/* TRAVADO DESABILITA SEM TIRAR DA TELA. Sumir e voltar em meio segundo é a tela
   saltando duas vezes por uma resposta que quase sempre chega — e o segundo salto
   é o que lê como "algo deu errado". Mesma razão pela qual o campo "conferindo"
   continua no DOM. */
t("travado: os botões existem e vêm desabilitados",
  (E.barraIO("up", true).match(/ disabled/g) || []).length >= 2
  && E.barraIO("up", true).includes('id="up-arq"'));
t("liberado: nenhum botão desabilitado", !/ disabled/.test(barra));

/* Sem `SpeechRecognition` o botão NÃO renderiza: um botão que não faz nada é pior
   que a ausência dele. Em Node não há `window`, então este é o caminho medido. */
t("sem suporte a voz o botão de falar não é desenhado",
  E.VOZ_OK === false && !barra.includes("-mic"));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 3 ] uma recusa é uma frase; um lote é UMA frase agrupada");

t("nada recusado, nada dito", E.agruparRecusas([]) === null && E.agruparRecusas(null) === null);

const uma = E.agruparRecusas([{ nome: ".env", motivo: "isto parece uma chave", categoria: "segredo" }]);
t("uma recusa: o título é o NOME do arquivo, e o corpo é o motivo inteiro",
  uma.titulo === ".env" && uma.corpo === "isto parece uma chave");

/* O LOTE É O CASO QUE ESTA FUNÇÃO EXISTE PARA RESOLVER. Medido arrastando uma
   pasta de projeto: `.env`, `.env.example` e um `.pem` recusados de uma vez viravam
   três cartões para um único fato. Numa pasta de 50 arquivos o último esconde o
   primeiro. */
const lote = E.agruparRecusas([
  { nome: ".env", motivo: "m", categoria: "segredo" },
  { nome: "sftp_key_pem", motivo: "m", categoria: "segredo" },
  { nome: "plan.docx", motivo: "m", categoria: "converter" }
]);
t("três recusas viram UM aviso", !!lote && typeof lote.titulo === "string");
t("...agrupado por categoria, que é o que faz a frase escalar",
  /2 chaves e segredos/.test(lote.titulo) && /1 formato que precisa ser exportado/.test(lote.titulo));
/* SINGULAR E PLURAL ESCRITOS, não derivados. O primeiro jeito concatenava "s" e
   saiu "3 chave ou segredos" na tela: em português a flexão não cai no fim da
   frase. */
t("...e o plural não é derivado com «s» no fim (\"3 chave ou segredos\")",
  !/chave ou segredos/.test(lote.titulo));
t("um só de uma categoria usa o SINGULAR daquela categoria",
  /1 chave ou segredo/.test(E.agruparRecusas([
    { nome: ".env", motivo: "m", categoria: "segredo" },
    { nome: "a.docx", motivo: "m", categoria: "converter" }
  ]).titulo));
/* A RAZÃO DO SEGREDO VIAJA INTEIRA mesmo no resumo: é a única recusa cuja causa a
   pessoa precisa entender, porque a mensagem antiga ("não sei abrir") convidava a
   converter a chave para um formato aceito — ou seja, a insistir. */
t("com segredo no lote, a razão dele é dita por inteiro", /não faz nenhuma chamada/.test(lote.corpo));
t("sem segredo no lote, essa frase não aparece",
  !/não faz nenhuma chamada/.test(E.agruparRecusas([
    { nome: "a.docx", motivo: "m", categoria: "converter" },
    { nome: "b.xlsx", motivo: "m", categoria: "converter" }
  ]).corpo));
t("categoria ausente cai em `formato`, nunca em `undefined` na tela",
  /tipos que eu não abro/.test(E.agruparRecusas([
    { nome: "a", motivo: "m" }, { nome: "b", motivo: "m" }
  ]).titulo));
/* O TETO DA LISTA DE NOMES: uma pasta de 50 recusados não vira uma coluna de 50
   nomes dentro de um aviso. */
t("mais de seis nomes: lista seis e conta o resto",
  /e mais 4$/.test(E.agruparRecusas(Array.from({ length: 10 }, (_, i) =>
    ({ nome: "f" + i, motivo: "m", categoria: "formato" }))).corpo));

t("o campo ancorado guarda o RESUMO, não a última recusa",
  /^3 arquivos não entraram/.test(E.textoAncorado([
    { nome: "a", motivo: "m" }, { nome: "b", motivo: "m" }, { nome: "c", motivo: "m" }
  ])));
t("...e com uma só, guarda nome e motivo",
  E.textoAncorado([{ nome: "a.docx", motivo: "Word não abre aqui" }]) === "a.docx: Word não abre aqui");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 4 ] o módulo recusa por NOME quando a página não o configurou");

const rotaRuim = (() => {
  try { E.configurar({ estado: {}, callApi: () => {}, avisar: () => {}, rotas: { bandeja: "/x" } }); return null; }
  catch (e) { return e.message; }
})();
t("rota incompleta é recusada na configuração, não no clique",
  !!rotaRuim && /rotas/.test(rotaRuim));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 5 ] a cerca por ferramenta do Upgrade");

/* A REGRA DO TESTER NÃO ATRAVESSA INTEIRA, e isso é medido e não preferência. Lá a
   base da entrevista é `Read` e `Glob`/`Grep` entram só com anexo. Aqui `Grep` é
   BASE: `REGRAS.md` manda não ler o `fluxo.json` inteiro e usar `Grep` para achar o
   nó (285KB no maior fluxo desta instância). Tirar `Grep` removeria algo que ela
   precisa — pior que a cópia.
   `Glob` é o que a regra de fato alcança: com cinco arquivos conhecidos ele não
   serve para nada, e com uma pasta de 200 ele é o que separa explorar de despejar. */
t("sem anexo: `Glob` NÃO é concedido", !/Glob/.test(up.ferramentasDaRodada({})));
t("com anexo: `Glob` é concedido", /Glob/.test(up.ferramentasDaRodada({ anexos: [A("x.csv")] })));
t("`Grep` é base e nunca sai (o `fluxo.json` tem 285KB)",
  /Grep/.test(up.ferramentasDaRodada({})) && /Grep/.test(up.ferramentasDaRodada({ anexos: [A("x.csv")] })));
t("`Write`/`Edit` nunca saem (a sessão escreve `resposta.json`)",
  /Write/.test(up.ferramentasDaRodada({})) && /Edit/.test(up.ferramentasDaRodada({})));
/* A CERCA QUE IMPORTA continua sendo `--disallowedTools`: este repositório mediu
   que `--allowedTools` é lista de AUTO-APROVAÇÃO e não restringe nada. */
t("`rodar` passa `--disallowedTools` e `--setting-sources \"\"`",
  /--disallowedTools/.test(fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8"))
  && /--setting-sources/.test(fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8")));
t("e a lista de ferramentas da rodada sai da função, não de um literal",
  /--allowedTools", ferramentasDaRodada\(s\)/.test(fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8")));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 6 ] a bandeja é adotada, e o inventário sai do DISCO");

DOC = {
  id: "wf-teste", name: "Fluxo de teste", updatedAt: "2026-08-19T10:00:00.000Z",
  nodes: [{ name: "Start", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {}, settings: {}
};

const b64 = s => Buffer.from(s, "utf8").toString("base64");

(async () => {
  /* A bandeja é criada pelo MESMO caminho que a rota usa: `dirBandeja` sob a raiz
     que o `upgrade.js` exporta. Recompor o caminho aqui seria uma segunda definição
     de onde a conversa mora, e o teste passaria com o servidor gravando noutro
     lugar. */
  const bandeja = anexosMod.novaBandeja();
  const dirB = anexosMod.dirBandeja(up.RUNS_DIR, bandeja);
  fs.mkdirSync(dirB, { recursive: true });
  const g1 = await anexosMod.gravar(dirB, { nome: "colunas.csv", rel: null, b64: b64("id,telefone,status\n") }, []);
  const g2 = await anexosMod.gravar(dirB, {
    nome: "estoque.csv", rel: "projeto-cliente/dados/estoque.csv", b64: b64("sku,qtd\n")
  }, [g1.meta]);
  t("a bandeja aceitou os dois arquivos antes de a conversa existir", g1.ok && g2.ok);

  /* O ARQUIVO FANTASMA: existe no disco e NÃO passou pela gravação. É ele que
     separa "o inventário vem do disco" de "o inventário vem do que a página
     disse" — a página nunca soube dele. */
  fs.writeFileSync(path.join(dirB, "anexos", "fantasma.md"), "escrito direto no disco", "utf8");

  const id = await up.iniciar({ wfId: "wf-teste", bandeja });
  const snap = up.snapshot(id);

  t("a conversa nasceu com os anexos da bandeja", (snap.anexos || []).length === 3);
  t("...e o INVENTÁRIO veio do disco, não do que a página mandou",
    (snap.anexos || []).some(a => a.nome === "fantasma.md"));
  t("...com a árvore da pasta preservada",
    (snap.anexos || []).some(a => a.arquivo === "anexos/projeto-cliente/dados/estoque.csv" && a.dePasta));
  /* ADOTAR É MOVER. Uma bandeja que sobrevive é um segundo lugar com o arquivo
     dele dentro — e a próxima adoção acharia arquivo repetido. */
  t("a bandeja foi MOVIDA, não copiada (o diretório dela sumiu)", !fs.existsSync(dirB));

  const dirS = path.join(up.RUNS_DIR, id);
  t("o índice foi escrito onde o prompt manda ler",
    fs.existsSync(path.join(dirS, "anexos", "INDICE.md")));
  t("...e o índice manda NÃO ler tudo (senão o modelo abre os 40 em ordem)",
    /Não leia tudo/.test(fs.readFileSync(path.join(dirS, "anexos", "INDICE.md"), "utf8")));

  /* O SNAPSHOT LEVA METADADO, NUNCA CONTEÚDO. Ele viaja em todo evento do SSE, e
     um anexo de 12MB dentro dele dobraria cada repaint. */
  t("o snapshot leva metadado, nunca o conteúdo do arquivo",
    (snap.anexos || []).every(a => !("conteudo" in a) && typeof a.bytes === "number"));
  t("o resumo dos anexos viaja como fato para a tela",
    snap.anexosResumo && snap.anexosResumo.n === 3 && Array.isArray(snap.anexosResumo.pastas));
  t("`anexosLidos` nasce vazio: nada foi aberto ainda", (snap.anexosLidos || []).length === 0);

  /* ─── o chip só é marcado por OBSERVAÇÃO do `tool_use` ─── */
  const alvo = snap.anexos.find(a => a.nome === "colunas.csv").arquivo;
  const sess = { anexos: snap.anexos, anexosLidos: [], id, log: [] };
  up.registrarLeituraAnexo(sess, { input: {} });
  t("um `tool_use` sem caminho não marca nada", sess.anexosLidos.length === 0);
  up.registrarLeituraAnexo(sess, { input: { pattern: "*.csv" } });
  t("um `Grep` (sem `file_path`) não marca nada — ela não ABRIU o arquivo",
    sess.anexosLidos.length === 0);
  /* O CASO QUE FAZ A MARCA VALER ALGUMA COISA. `rodar()` monta a linha de
     atividade lendo `file_path || pattern || path`, e o MESMO evento chega aqui —
     então é tentador reaproveitar os três. Não pode: `Glob`/`Grep` recebem um
     `path` de DIRETÓRIO e um `pattern`, e casar por eles marcaria como "ela abriu
     este arquivo" uma varredura que não abriu nada. Aí o chip volta a ser promessa
     em vez de fato observado, que é a única razão de ele existir. */
  up.registrarLeituraAnexo(sess, { input: { path: alvo, pattern: "telefone" } });
  t("um `Glob`/`Grep` cujo `path` APONTA para o anexo também não marca",
    sess.anexosLidos.length === 0);
  up.registrarLeituraAnexo(sess, { input: { file_path: "C:\\qualquer\\" + alvo.replace(/\//g, "\\") } });
  t("um `Read` no caminho do anexo marca ele (e só ele)",
    sess.anexosLidos.length === 1 && sess.anexosLidos[0] === alvo);
  up.registrarLeituraAnexo(sess, { input: { file_path: "/x/" + alvo } });
  t("...e ler de novo não duplica", sess.anexosLidos.length === 1);
  /* SESSÃO NOVA de propósito para este caso. Reaproveitar a de cima esconderia o
     defeito: com um anexo já marcado, um código que marca o PRIMEIRO da lista sem
     conferir o caminho cai no `includes` e sai calado — a contagem não se move e o
     teste passa por acidente. Com a lista vazia, marcar sem casar aparece. */
  const zero = { anexos: snap.anexos, anexosLidos: [], id, log: [] };
  up.registrarLeituraAnexo(zero, { input: { file_path: "/x/anexos/nada-a-ver.csv" } });
  t("um arquivo que não é anexo nenhum não marca ninguém", zero.anexosLidos.length === 0);
  up.registrarLeituraAnexo(zero, { input: { file_path: "/x/fluxo.json" } });
  t("...e ler o próprio `fluxo.json` também não marca anexo", zero.anexosLidos.length === 0);

  /* ─── desanexar tira o chip e o `lido` junto ─── */
  const dep = await up.desanexar(id, alvo);
  t("desanexar tira o chip", (dep.anexos || []).length === 2);
  t("...e tira o `lido` com ele (senão sobra marca de um arquivo que não existe)",
    !(dep.anexosLidos || []).includes(alvo));
  t("...e o arquivo saiu do disco", !fs.existsSync(path.join(dirS, alvo)));

  /* ─── uma bandeja que não existe não derruba a conversa ─── */
  const id2 = await up.iniciar({ wfId: "wf-teste", bandeja: anexosMod.novaBandeja() });
  const s2 = up.snapshot(id2);
  t("bandeja inexistente: a conversa nasce igual, com zero anexo",
    s2 && s2.status === "aguardando" && (s2.anexos || []).length === 0);
  t("...e sem anexo o prompt não carrega o bloco deles",
    !/ELA ANEXOU MATERIAL/.test(up.prompt({ chat: [{ de: "eu", texto: "oi" }], wfNome: "x", nos: 1, anexos: [] })));

  /* ─── e o prompt do id com anexo carrega o índice, nunca o arquivo ─── */
  const p = up.prompt({
    chat: [{ de: "eu", texto: "olha a planilha" }], wfNome: "x", nos: 1,
    anexos: dep.anexos
  });
  t("com anexo, o prompt manda ler `anexos/INDICE.md`", /anexos\/INDICE\.md/.test(p));
  t("...e nomeia a pasta preservada", /projeto-cliente\//.test(p));

  /* `subirArquivos` é ASSÍNCRONA, então a recusa por falta de `configurar()` chega
     como promessa rejeitada e não como `throw` síncrono — medir isso com um `try`
     seco passaria por acidente, porque o `try` não vê nada e a variável fica nula
     do mesmo jeito que ficaria se o módulo tivesse recusado. */
  const semCfg = await E.subirArquivos([{ name: "a.csv" }], null, null).then(() => null, e => e.message);
  t("subir sem `configurar()` falha dizendo o que falta, não em `undefined`",
    !!semCfg && /configurar/.test(semCfg));

  /* ─── A BANDEJA VOLTA MESMO NA RECUSA, e este é o defeito que o caso mede.
     O servidor cria o diretório da bandeja ANTES de validar o arquivo, então uma
     recusa também tem id. Sem trazê-lo de volta, um lote cujo PRIMEIRO arquivo é
     recusado deixa uma bandeja vazia órfã e o segundo arquivo abre outra — e a
     partir daí os arquivos de um mesmo lote moram em duas bandejas, mas só UMA é
     adotada quando a conversa nasce. O `callApi` das duas páginas copia `bandeja`
     para o Error exatamente para isto.
     O `FileReader` não existe em Node, então `b64De` é trocado por um dublê: o que
     se mede aqui é o ESTADO, não a leitura do arquivo. */
  const est = { bandeja: null, anexosPre: [], anexoErro: null, subindo: 0 };
  const pedidos = [];
  global.FileReader = class {
    readAsDataURL() { this.onload && this.onload(); }
    get result() { return "data:text/csv;base64,YWJj"; }
  };
  E.configurar({
    estado: est, avisar: () => {},
    callApi: async (url, opts) => {
      const corpo = JSON.parse(opts.body);
      pedidos.push({ url, bandeja: corpo.bandeja || null, nome: corpo.nome });
      if (corpo.nome === ".env") {
        // exatamente o que a rota devolve: 400 com a frase, a categoria E a bandeja
        throw Object.assign(new Error("isto parece uma chave"), { categoria: "segredo", bandeja: "bcafeb0ba" });
      }
      return { bandeja: corpo.bandeja || "bcafeb0ba", anexos: [{ nome: corpo.nome, arquivo: "anexos/" + corpo.nome, tipo: "dados", bytes: 3, dePasta: false }] };
    },
    rotas: {
      bandeja: "/api/upgrade/anexo", bandejaRemover: "/api/upgrade/anexo/remover",
      sessao: i => "/s/" + i, sessaoRemover: i => "/d/" + i
    }
  });
  await E.subirArquivos([{ name: ".env" }, { name: "estoque.csv" }], null, null);
  t("o primeiro arquivo recusado ainda devolve o id da bandeja para o estado",
    est.bandeja === "bcafeb0ba", String(est.bandeja));
  t("...então o segundo arquivo do lote vai para a MESMA bandeja",
    pedidos.length === 2 && pedidos[1].bandeja === "bcafeb0ba", JSON.stringify(pedidos));
  t("...e a recusa entra no campo ancorado nomeando o arquivo",
    /^\.env: /.test(String(est.anexoErro)), String(est.anexoErro));
  t("`subindo` volta a zero mesmo com recusa no meio", est.subindo === 0);

  // limpeza: o scratch é descartável, mas deixar lixo com nome de teste é sujeira
  for (const d of [dirS, path.join(up.RUNS_DIR, id2)]) fs.rmSync(d, { recursive: true, force: true });

  console.log("\n" + (bad ? "FALHOU" : "passou") + ": " + ok + " casos"
    + (bad ? ", " + bad + " falha(s)" : ", e cada um recusa um defeito com nome") + "\n");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error("\nESTOUROU: " + (e && e.stack || e) + "\n"); process.exit(1); });
