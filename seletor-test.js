/* seletor-test.js — o seletor de fluxo da aba Upgrade: em qual fluxo mexer.
 *
 * O JUÍZO É EXTRAÍDO DO `upgrade.html` EM TEMPO DE EXECUÇÃO e as checagens de
 * fiação medem FONTE SEM COMENTÁRIO. As duas disciplinas são desta base e as duas
 * foram pagas: reimplementar a decisão aqui provaria a cópia e não a tela, e um
 * caso que casa dentro de um comentário aprova a ausência da decisão — foi o que
 * aconteceu no `dossie-tela-test.js`, onde dois casos ficaram verdes porque o
 * comentário citava o nome que o teste procurava.
 *
 * OS TRÊS CASOS QUE CARREGAM O ARQUIVO:
 *
 *   1. O SELETOR NÃO TEM OUVINTE DE TECLADO PRÓPRIO. Se tivesse, um Esc fecharia a
 *      telinha E chamaria `parar()` — duas ações na mesma tecla, e uma delas mata
 *      uma rodada de modelo já paga. Ele entra na cadeia de captura da página, e o
 *      caso afere a ORDEM: abaixo do `.scrim`, acima do `parar()`.
 *
 *   2. O PONTO DA LINHA É `pontoStatus` E O SELO É `seloDossie`. Nenhuma segunda
 *      redação: se o ponto significasse "estado do dossiê", dois pontos vermelhos na
 *      mesma tela quereriam dizer coisas diferentes; e uma segunda frase de "sem
 *      dossiê · conversa travada" divergiria da do cartão no primeiro ajuste, com as
 *      duas telas discordando sobre qual fluxo aceita conversa.
 *
 *   3. A PARTIÇÃO É TOTAL. Todo fluxo de `S.fluxos` cai em exatamente um grupo, e
 *      nenhum se perde: o grupo de baixo é a razão de o seletor existir (a grade
 *      mostra 11 de 75), então um fluxo que não aparecesse em nenhum dos dois seria
 *      um fluxo inalcançável — de novo — sem nada na tela dizendo.
 *
 * De graça: nenhum browser, nenhuma rede, nenhum modelo, nada escrito em lugar
 * nenhum. `node seletor-test.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

const h = fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8");

const pega = (de, ate) => {
  const i = h.indexOf(de);
  if (i < 0) throw new Error("nao achei `" + de + "` no upgrade.html - a tela mudou de forma");
  const j = h.indexOf(ate, i);
  if (j < 0) throw new Error("nao achei o fim do bloco a partir de `" + de + "`");
  return h.slice(i, j);
};
const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/* O bloco de juízo inteiro, de `SCRATCH` até o juízo da gaveta: é dele que saem
   `naPorta`, `ordem`, `pontoStatus`, `partesNome`, `SELETOR_GRUPO` e
   `gruposDoSeletor`. Mais `passaSeletor`, que é o filtro da busca e é puro. */
const juizo = pega("const SCRATCH = /", "/* ═══════════════════ O HISTÓRICO DE CONVERSAS")
  + pega("function passaSeletor(f, q) {", "\nfunction pintarSeletor()");

const api = new Function(juizo
  + "; return { naPorta, ordem, pontoStatus, partesNome, morno,"
  + " SELETOR_GRUPO, gruposDoSeletor, passaSeletor, SCRATCH };")();

let ok = 0, bad = 0;
const t = (n, c) => { if (c) { ok++; console.log("  ok    " + n); } else { bad++; console.log("  FALHOU " + n); } };

/* A instância deste projeto em miniatura, com as formas que existem de verdade:
   um fluxo de muitas execuções, um sub-fluxo que NUNCA pode estar `active` (o pai é
   que é acordado) e por isso entra pelo chamador, um ativo sem execução, um
   rascunho que nunca rodou, um rascunho que RODOU, e dois parados. */
const F = [
  { id: "a", nome: "WhatsApp API Oficial", active: true, exec24: 731, nos: 31, chamadores: [] },
  { id: "b", nome: "[ROBERTO] Cron — Proactive Outreach", active: true, exec24: 96, nos: 19, chamadores: [] },
  { id: "c", nome: "Agente Iago Comercial", active: false, exec24: 92, nos: 189, chamadores: [{ nome: "WhatsApp API Oficial" }] },
  { id: "d", nome: "[ROBERTO] Tool - Buscar Evento", active: false, exec24: 0, nos: 12, chamadores: [{ nome: "Agente Iago Comercial" }] },
  { id: "e", nome: "GABI [Envio Manual]", active: true, exec24: 0, nos: 4, chamadores: [] },
  { id: "f", nome: "[SANDBOX upgrade] Agente Iago Comercial", active: false, exec24: 0, nos: 189, chamadores: [] },
  { id: "g", nome: "My workflow 3", active: false, exec24: 0, nos: 2, chamadores: [] },
  { id: "h", nome: "Zebra parada", active: false, exec24: 0, nos: 5, chamadores: [] },
  { id: "i", nome: "Abacaxi parado", active: false, exec24: 0, nos: 7, chamadores: [] },
  { id: "j", nome: "[SANDBOX cockpit] rodou mesmo assim", active: false, exec24: 3, nos: 9, chamadores: [] }
];
const gr = api.gruposDoSeletor(F);
const dentro = (gr.find(g => g.chave === "vitrine") || { fluxos: [] }).fluxos;
const fora = (gr.find(g => g.chave === "fora") || { fluxos: [] }).fluxos;
const ids = l => l.map(f => f.id).join(",");

console.log("\n[ 1 ] os dois grupos, e o de baixo é o motivo do seletor existir");
t("o grupo de cima é exatamente quem chega na porta",
  ids(dentro) === ids(F.filter(api.naPorta).slice().sort(api.ordem)));
/* O grupo de baixo é o que a grade NÃO mostra. Sem ele o seletor listaria os
   mesmos 11 cartões que já estão na tela — filtrar o que se está olhando não vale
   um modal, e os outros 64 continuariam alcançáveis só colando `?f=<id>`. */
t("o grupo de baixo tem quem a grade não mostra", fora.length > 0);
/* PARTIÇÃO TOTAL: nenhum fluxo em dois grupos, nenhum fora dos dois. */
const juntos = [...dentro, ...fora].map(f => String(f.id));
t("nenhum fluxo aparece nos dois grupos", new Set(juntos).size === juntos.length);
t("nenhum fluxo se perde: os dois grupos somam a instância inteira",
  juntos.length === F.length && new Set(juntos).size === F.length);

console.log("\n[ 2 ] as duas ordens, e cada uma é a decisão do seu grupo");
/* Em cima, `ordem`: a MESMA da grade, por execução, porque onde roda mais é onde
   um upgrade paga. Duas ordens para a mesma lista faria o seletor discordar da tela
   atrás dele. */
t("o grupo da vitrine desce por execução, como a grade", ids(dentro) === "a,b,c,j,d,e");
/* Embaixo, por NOME: são fluxos com zero execução, então ordenar por execução seria
   ordenar um empate — e ali quem procura procura por nome. */
t("o grupo de fora sobe por nome, em pt-BR",
  ids(fora) === ids(fora.slice().sort((x, y) => String(x.nome).localeCompare(String(y.nome), "pt-BR"))));
t("...e o acento não vai para o fim: `Abacaxi` antes de `Zebra`",
  fora.findIndex(f => f.id === "i") < fora.findIndex(f => f.id === "h"));

console.log("\n[ 3 ] o rascunho, e o que decide qual lado dele fica");
/* Rascunho que NUNCA rodou fica fora — é o que `naPorta` já decide. */
t("rascunho que nunca rodou fica fora da vitrine", fora.some(f => f.id === "f") && fora.some(f => f.id === "g"));
/* Rascunho que RODOU fica dentro, e isto é a decisão oposta pela mesma razão:
   esconder uma execução por causa do nome seria a pior troca disponível. */
t("rascunho que RODOU continua na vitrine", dentro.some(f => f.id === "j"));
/* O sub-fluxo entra pelo chamador. Uma regra "ativo ou rodou" excluiria
   estruturalmente os quietos — o pai é que é acordado. */
t("sub-fluxo sem execução entra pela mão de quem o chama", dentro.some(f => f.id === "d"));

console.log("\n[ 4 ] grupo vazio não vira cabeçalho, e o vocabulário dos dois é distinto");
t("instância sem nada fora da porta não cria o segundo grupo",
  api.gruposDoSeletor([F[0]]).length === 1);
t("...e o contrário também: só rascunho parado não cria o primeiro",
  ids(api.gruposDoSeletor([F[5], F[6]])[0].fluxos) !== "" && api.gruposDoSeletor([F[5], F[6]]).length === 1
  && api.gruposDoSeletor([F[5], F[6]])[0].chave === "fora");
t("lista vazia não devolve grupo nenhum", api.gruposDoSeletor([]).length === 0);
/* Dois títulos iguais ensinariam a ignorar os dois — a mesma razão pela qual as
   quatro frases da faixa do dossiê têm de ser distintas. */
t("os dois títulos são distintos",
  api.SELETOR_GRUPO.vitrine.titulo !== api.SELETOR_GRUPO.fora.titulo);
/* A nota do grupo de baixo é a RESPOSTA a "por que este não está na grade?", que é
   a pergunta que a pessoa vai fazer ao ver o nome ali. */
const nf = api.SELETOR_GRUPO.fora.nota(64);
t("a nota de fora explica POR QUE aquele fluxo não está na grade",
  /não rodaram/.test(nf) && /não estão ativos/.test(nf) && /rascunho/.test(nf));
t("...e diz que dá para abrir, com o preço chegando no clique", /abrir/.test(nf));
t("a nota de cima diz que a ordem é a mesma da grade", /por execução/.test(api.SELETOR_GRUPO.vitrine.nota(11)));

console.log("\n[ 5 ] o corte do nome mora num lugar só, e a busca usa ele");
t("`[PROJETO] Nome` sai partido", api.partesNome("[ROBERTO] Cron — X").proj === "ROBERTO"
  && api.partesNome("[ROBERTO] Cron — X").nome === "Cron — X");
/* Sem prefixo o nome é a identidade inteira, e `proj` é `null` — nunca a string
   "SEM PREFIXO", que escrita em quatro linhas seguidas é ruído no lugar onde se
   procura um nome. */
t("sem prefixo, `proj` é null e o nome fica inteiro",
  api.partesNome("Agente Iago Comercial").proj === null
  && api.partesNome("Agente Iago Comercial").nome === "Agente Iago Comercial");
t("`[Envio Manual]` NO FIM do nome não é prefixo", api.partesNome("GABI [Envio Manual]").proj === null);
/* A busca casa por PROJETO também: "roberto" tem de achar `[ROBERTO] Cron — …`,
   cujo nome visível no cartão não contém a palavra. */
t("buscar pelo projeto acha o fluxo", api.passaSeletor(F[1], "roberto"));
t("buscar pelo nome acha o fluxo", api.passaSeletor(F[2], "iago"));
t("busca vazia passa tudo", api.passaSeletor(F[7], ""));
t("o que não casa não passa", !api.passaSeletor(F[2], "slack"));
/* Uma segunda regex do mesmo corte divergiria no primeiro fluxo que fugisse da
   convenção, e as duas telas passariam a discordar sobre o nome do projeto. */
const fonteCartao = semComentario(pega("function cartao(f) {", "\n/* O selo, desenhado"));
t("o cartão usa `partesNome` em vez da segunda cópia da regex",
  fonteCartao.includes("partesNome(f.nome)") && !/\\\[\(\[\^\\\]\]/.test(fonteCartao));

console.log("\n[ 6 ] o teclado: uma tecla, um dono");
const fonteAbrir = semComentario(pega("function abrirSeletor(origem) {", "\nfunction fecharSeletor()"));
/* O CASO QUE CARREGA O ARQUIVO. Um ouvinte próprio faria o Esc fechar a telinha E
   parar a rodada — a nota do `tecladoGaveta` descreve esse defeito por inteiro, e
   ali ele foi medido no navegador. */
t("o seletor NÃO registra ouvinte de teclado próprio", !/addEventListener\("keydown"/.test(fonteAbrir));
const cadeia = semComentario(pega('addEventListener("keydown", e => {', "\n/* ------"));
t("`tecladoSeletor` está na cadeia de captura da página", cadeia.includes("tecladoSeletor(e)"));
/* A ORDEM É A DECISÃO: o `.scrim` do `confirmar()` recebe primeiro (ele nasce de um
   botão desta tela), e o `parar()` vem por último — fechar a telinha não é parar a
   rodada. */
t("...abaixo do `.scrim` do confirmar()",
  cadeia.indexOf('querySelector(".scrim")') < cadeia.indexOf("tecladoSeletor(e)"));
t("...e acima do `parar()`, senão um Esc mataria uma rodada já paga",
  cadeia.indexOf("tecladoSeletor(e)") < cadeia.indexOf("parar()"));
const fonteTecla = semComentario(pega("function tecladoSeletor(e) {", "\n/* A lupa DESENHADA"));
t("com o seletor fechado ele não consome tecla nenhuma", /if \(!s\) return false/.test(fonteTecla));
t("Esc fecha, e diz que consumiu a tecla",
  /"Escape"[\s\S]{0,80}fecharSeletor\(\);\s*return true/.test(fonteTecla));
t("↑↓ andam sem abrir nada, e Enter é o que abre",
  /ArrowDown/.test(fonteTecla) && /"Enter"[\s\S]{0,60}click\(\)/.test(fonteTecla));
/* Digitar não pode ser consumido: a tecla tem de chegar no campo de busca. */
t("qualquer outra tecla passa adiante, para o campo de busca", /return false;\s*\}\s*$/.test(fonteTecla.trim()));

console.log("\n[ 7 ] o vocabulário da linha: nenhuma segunda redação");
const fonteLinha = semComentario(pega("function linhaSeletor(f, s) {", "\n/* O SELO DE UMA LINHA"));
/* O ponto é saúde de EXECUÇÃO, como no cartão. Se aqui fosse o dossiê, dois pontos
   vermelhos na mesma tela quereriam dizer coisas diferentes. */
t("o ponto da linha sai de `pontoStatus`", fonteLinha.includes("pontoStatus(f)"));
t("...e não do dossiê", !/seloDossie/.test(fonteLinha));
const fonteSelo = semComentario(pega("function pintarUmSelo(cel, id) {", "\nfunction pintarSelosSeletor()"));
/* `seloDossie` inteiro: o mesmo glifo, o mesmo texto e a MESMA decisão de trava do
   cartão. Uma segunda frase de "sem dossiê · conversa travada" aqui divergiria da
   do cartão no primeiro ajuste. */
t("o selo da linha é o `seloDossie` do cartão, reusado inteiro",
  fonteSelo.includes("seloDossie(S.dossieVit.get(String(id)))"));
t("...e o texto não é reescrito aqui", !/conversa travada/.test(fonteSelo) && !/sem dossiê/.test(fonteSelo));
/* O glifo é `aria-hidden`: uma linha distinguida só por cor não existe para quem
   não vê, então a palavra tem de estar no texto. */
t("o glifo é aria-hidden e a palavra fica no texto", /aria-hidden/.test(fonteSelo));

console.log("\n[ 8 ] os selos chegam depois, e a lista não pode andar embaixo do cursor");
const fonteSelos = semComentario(pega("function pintarSelosSeletor() {", "\nfunction marcarSeletor()"));
/* Atualizar no LUGAR. Reconstruir a lista moveria o item que está a um Enter de ser
   escolhido — é a razão pela qual o retrato existe, e ela vale para o repaint
   também. */
t("a atualização dos selos mexe só nas células", /querySelectorAll\("\[data-selo\]"\)/.test(fonteSelos));
t("...e nunca reconstrói a lista", !/innerHTML = ""/.test(fonteSelos) && !/pintarSeletor\(/.test(fonteSelos));
t("`render()` é quem avisa que a varredura chegou",
  semComentario(pega("  pintarVerif();", "  restaurarInputs(comp);")).includes("pintarSelosSeletor()"));
/* Sem este pedido, as 64 linhas de fora ficariam em "conferindo o dossiê…" para
   sempre — e a frase seria FALSA, porque ninguém estaria conferindo. */
/* A GUARDA VIAJA COM A CHAMADA, e isso foi um mutante que passou: aferir só o
   texto `varrerDossies(semSelo` fica verde com um `if (false)` na frente — o teste
   provava que a linha EXISTE, nunca que ela roda. A guarda tem de ser o tamanho da
   lista, que é também o que evita um GET vazio quando não falta selo nenhum. */
t("abrir pede a varredura dos que não têm selo, e a guarda é ter algum",
  /if \(semSelo\.length\) varrerDossies\(semSelo, \{ meta: false \}\);/.test(fonteAbrir));
t("...com `meta: false`, para não reescrever a frase que fala dos cartões",
  /varrerDossies\(semSelo, \{ meta: false \}\)/.test(fonteAbrir));

console.log("\n[ 9 ] abrir, fechar, e o foco");
/* O modal nasce no `body` porque `render()` reescreve o `#app` inteiro: dentro dele
   a telinha sumiria no primeiro evento que repintasse a tela. */
t("o véu é anexado ao `document.body`, não ao `#app`", /document\.body\.append\(scrim\)/.test(fonteAbrir));
t("o resto da página fica `inert` enquanto ele está aberto",
  /setAttribute\("inert"/.test(fonteAbrir));
const fonteFechar = semComentario(pega("function fecharSeletor() {", "\n/* O filtro casa por NOME"));
t("fechar devolve o `inert` de exatamente quem ele marcou",
  /for \(const n of s\.behind\) n\.removeAttribute\("inert"\)/.test(fonteFechar));
/* O botão que abriu costuma NÃO existir mais: entre abrir e fechar cabe a varredura
   dos selos, que termina em `render()`. Sem o reencontro, o foco cai no body e o Tab
   recomeça do topo da página — medido no handoff do `flows.html`. */
t("o foco volta pelo seletor `[data-seletor]` quando o nó de origem já morreu",
  /querySelector\("\[data-seletor\]"\)/.test(fonteFechar));
const fonteEscolher = semComentario(pega("function escolherNoSeletor(id) {", "\nfunction tecladoSeletor"));
/* Fechar ANTES de navegar: `irPara` chama `render()`, e com o véu de pé o `inert`
   dos irmãos do body continuaria ali por um instante, com o foco voltando para um nó
   já descartado. */
t("fecha antes de navegar", fonteEscolher.indexOf("fecharSeletor()") < fonteEscolher.indexOf("irPara(id)"));
t("escolher o fluxo já aberto só fecha, sem recarregar nada",
  /if \(mesmo\) return;/.test(fonteEscolher));
/* Só o véu fecha. Sem o teste de `target`, arrastar para selecionar o nome de um
   fluxo e soltar fora do texto fecharia a telinha no meio da seleção. */
t("clique no véu fecha; clique dentro da caixa não",
  /scrim\.onclick = ev => \{ if \(ev\.target === scrim\)/.test(fonteAbrir));
t("digitar volta o cursor para o topo da lista",
  /inp\.oninput[\s\S]{0,80}cur = 0/.test(fonteAbrir));
t("é um diálogo de verdade: `role`, `aria-modal` e rótulo",
  /"role", "dialog"/.test(fonteAbrir) && /"aria-modal", "true"/.test(fonteAbrir)
  && /aria-labelledby/.test(fonteAbrir));

console.log("\n[ 10 ] as duas portas de entrada, e a camada");
const fonteHtml = semComentario(h);
/* Dois nós com o mesmo `id` são HTML inválido, e o sintoma é o pior possível:
   `getElementById` acha o primeiro, o segundo pinta igual e o clique não faz nada,
   SEM erro no console. O botão do dossiê desta página já pagou isso. */
t("as duas portas são `data-seletor`, nunca um `id` repetido",
  (fonteHtml.match(/data-seletor="1"/g) || []).length >= 2
  && !/id="abrir-sel"/.test(fonteHtml));
t("...e o clique é delegado uma vez só",
  (fonteHtml.match(/closest\("\[data-seletor\]"\)/g) || []).length === 1);
/* A tela em que ele mais importa: "nenhum fluxo chegou na porta" é uma frase sobre
   a JANELA, e a instância pode ter 75 fluxos parados. Sem o botão ali, a única tela
   onde a grade não oferece nada seria também a única sem saída. */
t("a vitrine vazia também oferece o seletor",
  semComentario(pega("nenhum fluxo chegou na porta", "</div>")).includes("data-seletor"));
/* A camada desta página é declarada: 40 gaveta, 45 seletor, 50 o `.scrim` do
   confirmar() — e este arquivo afirma em dois lugares que o `.scrim` está na frente
   de tudo. Os 92 herdados do `flows.html` deixariam essa frase verdadeira por sorte. */
const cssScrim = pega(".fmod-scrim {", "}");
t("o véu do seletor fica abaixo do `.scrim` do confirmar()", /z-index: 45/.test(cssScrim));
/* A casca (`.fmod*`, `.fitem*`) já estava aqui e era CSS MORTA: veio do `flows.html`
   na composição desta página e nada a usava. O seletor a ACENDE em vez de escrever
   uma quinta cópia. */
t("a telinha usa as classes da casca herdada", /cx\.className = "fmod"/.test(fonteAbrir)
  && /className = "fmod-lista"/.test(fonteAbrir) && /className = "fitem"/.test(semComentario(pega("function linhaSeletor(f, s) {", "\n/* O SELO DE UMA LINHA")).replace('b.className = "fitem"', 'className = "fitem"')));
/* UMA definição de cada regra da casca. Uma segunda cópia colada aqui seria o
   defeito que já deixou o rabo de um bloco velho pendurado no `flows.html` — quem
   sincroniza tem de SUBSTITUIR, nunca inserir. */
t("...e cada regra da casca existe uma vez só neste arquivo",
  (fonteHtml.match(/^\.fmod \{/gm) || []).length === 1
  && (fonteHtml.match(/^\.fitem \{/gm) || []).length === 1
  && (fonteHtml.match(/^\.fmod-scrim \{/gm) || []).length === 1);
/* A lupa é DESENHADA: `⌕` (U+2315) sai como um círculo vazio nesta fonte, medido —
   mesma armadilha de `📎` e `🗀`. */
t("a lupa é desenhada, e nenhum botão usa o glifo `⌕`",
  /function lupaSvg\(\)/.test(fonteHtml) && !/⌕/.test(fonteHtml));

console.log("\n" + (bad ? "FALHOU: " + bad + " de " + (ok + bad) : "passou: " + ok + " casos"));
process.exit(bad ? 1 : 0);
