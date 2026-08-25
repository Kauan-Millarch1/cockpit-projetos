/* dossie-tela-test.js — a faixa do dossiê e a TRAVA da conversa no `upgrade.html`.
 *
 * O bloco de juízo é EXTRAÍDO da página em tempo de execução — reimplementá-lo
 * aqui provaria a cópia, não a tela. Mesma técnica do `audio-test.js`, que extrai
 * o juízo do `flows.html`.
 *
 * O caso load-bearing da faixa: CINZA e VERMELHO têm de dizer coisas DIFERENTES.
 * Nunca escrito significa "vale escrever"; desatualizado significa "o que está lá
 * pode te enganar". Uma frase só para os dois ensina a ignorar as duas — e este
 * repositório pagou essa lição três vezes (`docAgentes` ausente lido como
 * negativo, `usd: 0` de rodada morta, `Response.json()` sobre corpo 404).
 *
 * O segundo: enquanto a resposta do servidor não chegou, a faixa NÃO diz "sem
 * dossiê". Ausência de resposta não é resposta negativa.
 *
 * OS CASOS DA TRAVA (`podeConversar`) são os dois lados do mesmo princípio, e o
 * que eles separam é o que decide se o campo de escrever existe:
 *   - estado ausente TRAVA dizendo "conferindo", nunca "sem dossiê" — quinta vez
 *     que este repositório escreve isso;
 *   - `d.erro` NÃO trava, porque travar aí culparia o arquivo dele por um problema
 *     do servidor;
 *   - reescrever um dossiê VERDE não pode travar a conversa: o antigo existe e é o
 *     que vai para a sessão. É o único caso em que a ordem dos testes dentro de
 *     `podeConversar` é o próprio veredito.
 *
 * De graça: nenhum browser, nenhuma rede, nenhum modelo. `node dossie-tela-test.js`. */

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
/* `avisoHtml` também vem da página. Ele é o vocabulário de aviso que as três
   páginas compartilham, e o bloqueio o usa ANCORADO — uma cópia dele aqui provaria
   a cópia, exatamente como reimplementar o juízo provaria. */
const src = pega("const AVISO_GLIFO = {", "function pilhaAvisos()")
  + pega("const DOSSIE_FRASE = {", "function faixaDossie(f)")
  + pega("function faixaDossie(f)", "\n/* ------");

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usdTxt = v => "US$" + v.toFixed(2).replace(".", ",");
/* `gavetaAnexos` nasce FALSE porque a tira nasce recolhida — o estado é da
   página (um `<details>` nativo perderia o aberto/fechado a cada repintura do SSE),
   e o compositor lê exatamente este campo. */
const S = { dossie: new Map(), anexosPre: [], subindo: 0, anexoErro: null, convId: null, conv: null, gavetaAnexos: false };
/* `IO` é o MÓDULO DE VERDADE, `entradas.js`, carregado em Node — não um dublê.
   O compositor desenha a fileira de anexar chamando `IO().barraIO()`, e um dublê
   aqui provaria a cópia em vez da tela: é a mesma disciplina que faz o `avisoHtml`
   ser extraído da página em vez de reescrito. Ele carrega sem DOM de propósito. */
const entradas = require("./entradas.js");
const IO = () => entradas;
/* As duas fontes de chip são da página (`anexosAgora`/`lidosAgora` no bloco de
   juízo, junto de `podeConversar`), e vêm extraídas por isso. */
const fontes = pega("const anexosAgora =", "\n/* `Math.round");
const api = new Function("esc", "usdTxt", "S", "IO",
  fontes + src + "; return { faixaDossie, DOSSIE_FRASE, botaoDossie, podeConversar, TRAVA_FRASE, compositorHtml, anexosAgora, lidosAgora };")(esc, usdTxt, S, IO);

let ok = 0, bad = 0;
const t = (n, c) => { if (c) { ok++; console.log("  ok    " + n); } else { bad++; console.log("  FALHOU " + n); } };
const flux = { id: "w1", nome: "Agente Iago" };
const põe = d => S.dossie.set("w1", d);
const semEstado = () => S.dossie.delete("w1");

console.log("\n[ 1 ] a faixa do dossiê");

semEstado();
const sem = api.faixaDossie(flux);
t("sem resposta ainda: diz que está perguntando, NÃO 'sem dossiê'", /perguntando/.test(sem) && !/sem dossiê/.test(sem));

põe({ cor: "cinza", motivo: "nunca foi escrito", nos: 179, paragrafos: 0, bytes: 0, preco: {} });
const cinza = api.faixaDossie(flux);
t("cinza: diz que nunca foi escrito", /sem dossiê/.test(cinza) && /nunca foi escrito/.test(cinza));
t("cinza: botão diz ESCREVER", /✎ escrever dossiê/.test(cinza));
t("cinza: usa a cor cold, nunca risk", /dos cold/.test(cinza) && !/dos risk/.test(cinza));

põe({ cor: "vermelho", motivo: "3 nó(s) entraram — o mapa do fluxo mudou", nos: 179, paragrafos: 179, bytes: 55468, em: "2026-08-18T16:44:33.291Z", preco: { usd: 4.13, amostras: 2 } });
const verm = api.faixaDossie(flux);
/* A FRASE DO VERMELHO FOI REESCRITA quando a trava entrou. Ela dizia "a conversa
   NÃO vai usar o dossiê, vai ler o fluxo pelo índice", que era verdade enquanto a
   conversa começava sem dossiê. Com a trava no ar a conversa não lê nada — ela não
   começa. Este caso é o que impede a frase antiga de voltar. */
t("vermelho: diz que a conversa fica TRAVADA, não que ela lê pelo índice",
  /travada/.test(verm) && !/lê o fluxo pelo índice/.test(verm) && !/NÃO vai usar/.test(verm));
t("vermelho: botão diz ATUALIZAR, não escrever", /↻ atualizar dossiê/.test(verm));
t("vermelho: mostra o preço estimado", /US\$4,13/.test(verm));
/* A DISTINÇÃO QUE IMPORTA, e ela é medida na FRASE, não na faixa inteira: a
   primeira versão deste caso comparava o HTML todo e passava com as duas frases
   iguais, porque o rótulo do botão e o `title` já diferem por conta própria. Um
   teste que compara demais não prova nada. */
const dummy = { motivo: "m", quantosMudados: 2, paragrafos: 9, bytes: 100, bytesFluxo: 900, nos: 5 };
const frases = ["verde", "laranja", "vermelho", "cinza"].map(c => api.DOSSIE_FRASE[c](dummy));
t("as QUATRO frases são distintas entre si", new Set(frases).size === 4);
t("...e cinza fala de nunca escrito, não de estar desatualizado",
  /nunca foi escrito/.test(api.DOSSIE_FRASE.cinza(dummy)) && !/atualizado/.test(api.DOSSIE_FRASE.cinza(dummy)));
t("...e vermelho fala de atualizar, não de nunca escrito",
  /atualizado/.test(api.DOSSIE_FRASE.vermelho(dummy)) && !/nunca foi escrito/.test(api.DOSSIE_FRASE.vermelho(dummy)));
t("...e nenhuma das duas promete mais que a conversa lê o fluxo pelo índice",
  !/lê o fluxo pelo índice/.test(api.DOSSIE_FRASE.cinza(dummy)) && !/lê o fluxo pelo índice/.test(api.DOSSIE_FRASE.vermelho(dummy)));
t("as quatro cores mapeiam para as quatro classes de status", /dos risk/.test(verm) && /dos cold/.test(cinza));

põe({ cor: "laranja", motivo: "2 nó(s) mudaram", quantosMudados: 2, nos: 179, paragrafos: 179, bytes: 55468, em: "x", preco: {} });
const lar = api.faixaDossie(flux);
t("laranja: diz que VAI para a conversa, com os marcados", /vai para a conversa/.test(lar) && /marcados/.test(lar));
t("laranja: nomeia quantos mudaram", /2 nó\(s\) mudaram/.test(lar));
t("laranja: sem histórico não inventa preço", !/US\$/.test(lar));

põe({ cor: "verde", motivo: "nenhum nó divergente", nos: 179, paragrafos: 179, bytes: 55468, bytesFluxo: 291000, em: "2026-08-18T16:44:33.291Z", preco: { usd: 4.13, amostras: 2 } });
const verde = api.faixaDossie(flux);
t("verde: compara prosa contra JSON", /54KB de prosa/.test(verde) && /284KB de JSON/.test(verde));
t("verde: as duas etiquetas obrigatórias viajam no title", /Escrito por um modelo/.test(verde) && /2026-08-18T16:44/.test(verde));

/* ESTE BOTÃO DEIXOU DE SER MORTO, e o caso foi repontado para a decisão nova em vez
   de perder a asserção. Ele fixava `/disabled/`: durante a escrita não havia o que
   fazer além de esperar, então o botão era um rótulo. HAVIA o que fazer — VER: uma
   escrita de minutos (medido: 514s num fluxo de 103 nós, 682s num de 179) com a tela
   mostrando só a última linha de atividade não diz em que etapa está, em que rodada,
   nem quanto falta, e é exatamente essa a pergunta de quem espera. Agora ele é a
   porta da telinha de progresso, e o que se afirma aqui é MAIS forte que o antigo:
   ele está vivo, carrega `data-prog`, e continua dizendo o que dizia. */
põe({ cor: "verde", nos: 5, paragrafos: 5, bytes: 100, preco: {},
  job: { escrevendo: true, atividade: "rodada 1 de 2 — sonnet",
    comecouEm: new Date(Date.now() - 60000).toISOString(), rodada: 1, rodadas: 2,
    duracao: { medianaMs: 600000, amostras: 2 } } });
const fEscr = api.faixaDossie(flux);
const btEscr = (fEscr.match(/<button[^>]*data-prog[^>]*>/) || [""])[0];
t("escrevendo: o botão está VIVO e é a porta da telinha de progresso",
  !!btEscr && /data-prog="1"/.test(btEscr) && !/disabled/.test(btEscr));
/* OS DOIS NUNCA PODEM COEXISTIR NO MESMO NÓ. `ligarDelegacao` trata `[data-dossie]`
   como "começa a escrita"; num botão que também é `[data-prog]` um clique tentaria
   começar uma SEGUNDA escrita enquanto a primeira roda — e o que sobra disso é um
   409 do servidor num lugar da tela que existe para mostrar progresso. */
t("...e ele NÃO carrega `data-dossie`: um clique não pode pedir uma segunda escrita",
  !!btEscr && !/data-dossie/.test(btEscr));
t("...e continua dizendo `escrevendo…` e a rodada",
  /✎ escrevendo…/.test(fEscr) && /rodada 1 de 2/.test(fEscr));
/* SEM RÉGUA NÃO HÁ PORCENTAGEM, e o rótulo cai para a rodada em vez de inventar um
   número. Um "0% · ver progresso" ali seria uma afirmação onde não há medida. */
põe({ cor: "verde", nos: 5, paragrafos: 5, bytes: 100, preco: {},
  job: { escrevendo: true, atividade: "rodada 1 de 2 — sonnet",
    comecouEm: new Date().toISOString(), rodada: 1, rodadas: 2,
    duracao: { medianaMs: null, amostras: 0 } } });
const fSemRegua = api.faixaDossie(flux);
t("...e sem régua o rótulo leva a rodada, nunca uma porcentagem inventada",
  /rodada 1\/2 · ver progresso/.test(fSemRegua) && !/%/.test(fSemRegua));

põe({ cor: "cinza", nos: 5, paragrafos: 0, bytes: 0, preco: {}, ocupado: "Agente eContrate" });
t("outro fluxo sendo escrito: recusa e diz qual", /escrevendo o de Agente eContrate/.test(api.faixaDossie(flux)));

põe({ cor: "verde", nos: 5, paragrafos: 5, bytes: 10, preco: {}, job: { escrevendo: false, erro: "não passou nas checagens em 2 rodadas" } });
t("tentativa que falhou aparece, não volta para 'sem dossiê' calado",
  /última tentativa não passou/.test(api.faixaDossie(flux)));

põe({ erro: "não consegui ler o fluxo no n8n: 503" });
t("erro de leitura tem estado próprio", /não sei o estado do dossiê/.test(api.faixaDossie(flux)));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 2 ] podeConversar — o veredito, puro");

const cin = { cor: "cinza", nos: 179, paragrafos: 0, bytes: 0, preco: { usd: 0.44, amostras: 3 } };
const vrm = { cor: "vermelho", motivo: "3 nó(s) entraram", nos: 179, paragrafos: 179, bytes: 100, preco: {} };
const lrj = { cor: "laranja", quantosMudados: 2, nos: 179, paragrafos: 179, bytes: 100, preco: {} };
const vrd = { cor: "verde", nos: 179, paragrafos: 179, bytes: 100, bytesFluxo: 900, preco: {} };

t("cinza TRAVA, e nomeia o motivo", api.podeConversar(cin).pode === false && api.podeConversar(cin).razao === "cinza");
t("vermelho TRAVA, e nomeia o motivo", api.podeConversar(vrm).pode === false && api.podeConversar(vrm).razao === "vermelho");
t("laranja LIBERA (entregue com ressalva é entregue)", api.podeConversar(lrj).pode === true);
t("verde LIBERA", api.podeConversar(vrd).pode === true);
t("verde e laranja liberam SEM ressalva na tela",
  !api.podeConversar(vrd).aviso && !api.podeConversar(lrj).aviso);

/* O ESTADO AUSENTE. Trava (não dá para escrever antes de saber), mas a razão é
   `perguntando` e nunca `cinza` — é a razão que escolhe a frase, e "sem dossiê"
   sobre um fetch de 200ms é a acusação errada. Quinta vez neste repositório. */
const ausente = api.podeConversar(undefined);
t("estado ausente: trava, mas a razão é `perguntando`, nunca `cinza`",
  ausente.pode === false && ausente.razao === "perguntando");
t("estado ausente: idem para null e para string vazia",
  api.podeConversar(null).razao === "perguntando");

/* `d.erro` NÃO TRAVA. Travar aqui culparia o arquivo dele por um problema do
   servidor, e o preço de errar para este lado é a aba funcionando como funcionava
   antes desta trava existir. O que ela DEVE é dizer isso. */
const err = api.podeConversar({ erro: "não consegui ler o fluxo no n8n: 503" });
t("`d.erro` LIBERA em vez de travar", err.pode === true);
t("`d.erro` carrega a ressalva, e ela nomeia o índice de nós",
  typeof err.aviso === "string" && /índice/.test(err.aviso));
t("`d.erro` não é apresentado como 'sem dossiê'", !/sem dossiê/.test(err.aviso));

/* Cor que esta tela não conhece: desencontro entre servidor e página, nosso
   problema, não o dossiê dele. Libera com a mesma ressalva do `d.erro`. */
const desc = api.podeConversar({ cor: "roxo", nos: 3, preco: {} });
t("cor desconhecida LIBERA com ressalva, e cita a cor recebida",
  desc.pode === true && desc.razao === "desconhecido" && /roxo/.test(desc.aviso));

/* A ORDEM DENTRO DE `podeConversar` É O VEREDITO, e este é o caso que a prova:
   reescrever um dossiê VERDE não pode travar a conversa. O dossiê antigo existe e
   é ele que vai para a sessão. Um `job.escrevendo` testado antes da cor travaria
   a conversa justamente de quem já tem dossiê — o oposto do que a trava existe
   para fazer. */
t("verde SENDO REESCRITO continua liberado",
  api.podeConversar({ ...vrd, job: { escrevendo: true, atividade: "rodada 1" } }).pode === true);
t("laranja SENDO REESCRITO continua liberado",
  api.podeConversar({ ...lrj, job: { escrevendo: true, atividade: "rodada 1" } }).pode === true);
t("cinza SENDO ESCRITO trava com razão `escrevendo`, não `cinza`",
  api.podeConversar({ ...cin, job: { escrevendo: true, atividade: "rodada 1" } }).razao === "escrevendo");
t("vermelho SENDO ATUALIZADO trava com razão `escrevendo`",
  api.podeConversar({ ...vrm, job: { escrevendo: true } }).razao === "escrevendo");

t("uma tentativa que falhou não é uma escrita em curso: volta a travar por cinza",
  api.podeConversar({ ...cin, job: { escrevendo: false, erro: "não passou em 2 rodadas" } }).razao === "cinza");
t("outro fluxo ocupado não muda a razão deste: continua cinza",
  api.podeConversar({ ...cin, ocupado: "Agente eContrate" }).razao === "cinza");

t("as quatro frases de trava são distintas entre si",
  new Set(["perguntando", "escrevendo", "cinza", "vermelho"]
    .map(r => api.TRAVA_FRASE[r]({ ...cin, job: { atividade: "x" }, motivo: "m" }).join("|"))).size === 4);

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 3 ] o compositor — os três desenhos");

põe(vrd);
const cVerde = api.compositorHtml(flux);
t("verde: o campo de escrever EXISTE e não está desabilitado",
  /id="cp"/.test(cVerde) && !/disabled/.test(cVerde));
t("verde: o botão enviar existe", /id="enviar"/.test(cVerde));
t("verde: nenhum bloco de trava", !/class="trava"/.test(cVerde));

põe(lrj);
t("laranja: o campo existe", /id="cp"/.test(api.compositorHtml(flux)) && !/disabled/.test(api.compositorHtml(flux)));

põe(cin);
const cCinza = api.compositorHtml(flux);
t("cinza: NÃO existe campo de escrever nem botão enviar",
  !/id="cp"/.test(cCinza) && !/id="enviar"/.test(cCinza));
t("cinza: a tela diz para escrever o dossiê para desbloquear",
  /escreve o dossiê para desbloquear/.test(cCinza));
t("cinza: o bloco carrega o botão que desbloqueia", /data-dossie="1"/.test(cCinza));
t("cinza: o botão carrega o preço quando ele existe", /US\$0,44/.test(cCinza));
t("cinza: usa o vocabulário `.aviso` ancorado, não a pilha flutuante",
  /class="aviso alerta"/.test(cCinza) && !/class="avisos"/.test(cCinza));
t("cinza: diz o que a sessão faria sem o dossiê (o índice, adivinhar o resto)",
  /índice de nós/.test(cCinza) && /adivinhar/.test(cCinza));
t("cinza: diz que nada é escrito no n8n", /Nada é escrito no n8n/.test(cCinza));

põe(vrm);
const cVerm = api.compositorHtml(flux);
t("vermelho: NÃO existe campo de escrever", !/id="cp"/.test(cVerm));
t("vermelho: o rótulo é ATUALIZAR, nunca escrever",
  /↻ atualizar dossiê/.test(cVerm) && !/✎ escrever dossiê/.test(cVerm));
t("vermelho: a frase é ATUALIZA para desbloquear, e não repete a do cinza",
  /atualiza o dossiê para desbloquear/.test(cVerm) && !/escreve o dossiê para desbloquear/.test(cVerm));
t("vermelho: nomeia o motivo da divergência", /3 nó\(s\) entraram/.test(cVerm));

/* O ESTADO AUSENTE, no desenho: o campo continua no lugar, SURDO. Trocar a caixa
   de texto por um bloco e depois de volta, em meio segundo, é a tela saltando
   duas vezes por uma resposta que quase sempre chega. E a frase é "conferindo",
   nunca uma recusa. */
semEstado();
const cSem = api.compositorHtml(flux);
t("ausente: o campo existe mas está desabilitado",
  /id="cp"/.test(cSem) && /<textarea[^>]*disabled/.test(cSem));
t("ausente: o botão enviar também está desabilitado", /id="enviar" disabled/.test(cSem));
t("ausente: a frase é `conferindo o dossiê…`", /conferindo o dossiê…/.test(cSem));
t("ausente: NÃO diz 'sem dossiê' e não é uma recusa",
  !/sem dossiê/.test(cSem) && !/desbloquear/.test(cSem) && !/class="aviso/.test(cSem));
t("ausente: não oferece botão de escrever dossiê sobre um estado que não chegou",
  !/data-dossie/.test(cSem));

põe({ ...cin, job: { escrevendo: true, atividade: "rodada 1 de 2 — sonnet" } });
const cEsc = api.compositorHtml(flux);
t("escrevendo: continua travado (sem campo)", !/id="cp"/.test(cEsc));
t("escrevendo: diz que está escrevendo e que desbloqueia sozinho",
  /escrevendo o dossiê agora/.test(cEsc) && /desbloqueia sozinha/.test(cEsc));
t("escrevendo: mostra a atividade da rodada", /rodada 1 de 2/.test(cEsc));
/* Nem o botão vivo NEM o morto: a linha de ação inteira sai. O `data-dossie`
   sozinho não bastava como medida — `botaoDossie` de um dossiê em escrita devolve
   um botão DESABILITADO, que não tem `data-dossie` e passaria o teste enquanto
   duplicava, dois centímetros abaixo, o botão morto que a faixa já mostra. */
t("escrevendo: NÃO repete o botão nem a nota de preço (a faixa já diz o mesmo)",
  !/data-dossie/.test(cEsc) && !/trava-bt/.test(cEsc) && !/cota de plano/.test(cEsc));
t("escrevendo: é `info`, não `alerta` — não há nada a fazer além de esperar",
  /class="aviso info"/.test(cEsc) && !/class="aviso alerta"/.test(cEsc));

põe({ ...cin, ocupado: "Agente eContrate" });
const cOcu = api.compositorHtml(flux);
t("outro fluxo ocupado: travado pelo cinza, e o botão diz por que não dá agora",
  !/id="cp"/.test(cOcu) && /escrevendo o de Agente eContrate/.test(cOcu));

põe({ erro: "não consegui ler o fluxo no n8n: 503" });
const cErr = api.compositorHtml(flux);
t("`d.erro`: o campo EXISTE (não travar é a decisão)", /id="cp"/.test(cErr) && !/<textarea[^>]*disabled/.test(cErr));
t("`d.erro`: a ressalva aparece ancorada acima do campo",
  /class="aviso alerta"/.test(cErr) && cErr.indexOf("aviso alerta") < cErr.indexOf('id="cp"'));
t("`d.erro`: a ressalva nomeia que o estado é desconhecido",
  /estado do dossiê desconhecido/.test(cErr));

põe({ cor: "roxo", nos: 3, preco: {} });
const cDes = api.compositorHtml(flux);
t("cor desconhecida: campo existe e a cor recebida é citada",
  /id="cp"/.test(cDes) && /roxo/.test(cDes));

/* O ESCAPE VEM DA PÁGINA, não daqui: o motivo e a atividade chegam do servidor, e
   um deles com `<` dentro não pode virar markup no bloco de trava. */
põe({ cor: "vermelho", motivo: '<img src=x onerror="alert(1)">', nos: 3, preco: {} });
t("motivo do servidor é escapado no bloco de trava",
  !/<img/.test(api.compositorHtml(flux)) && /&lt;img/.test(api.compositorHtml(flux)));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 4 ] a trava também vale no `enviar()` — defesa em profundidade");

/* Campo ausente e botão desabilitado NÃO são garantia: o Enter no textarea chama
   `enviar()` direto, e o campo do estado "conferindo" continua no DOM. Estes dois
   casos são estáticos de propósito — `enviar()` fala com o servidor e com o DOM, e
   o que precisa ser garantido aqui é a ORDEM: consultar antes de postar.

   OS TRÊS CASOS MEDEM O CÓDIGO SEM COMENTÁRIO, e isso foi pago: o comentário que
   explica a guarda NOMEIA `podeConversar` e cita a forma antiga
   `(S.fluxos || []).find(...)`. Sobre o texto cru, apagar a guarda inteira deixava
   os dois primeiros casos VERDES — o comentário sozinho satisfazia o `includes` e
   punha o `indexOf` antes do `callApi`. Um teste que casa dentro de comentário
   reprova a documentação da decisão no melhor caso e aprova a ausência da decisão
   no pior; aqui aconteceram os dois. Terceira vez neste arquivo (as outras duas
   estão anotadas abaixo, no convite e no `id="dos-btn"`). */
const env = pega("async function enviar() {", "\nasync function parar()");
const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const envCode = semComentario(env);
t("`enviar()` consulta `podeConversar` antes de qualquer POST",
  envCode.includes("podeConversar") && envCode.indexOf("podeConversar") < envCode.indexOf("callApi"));
/* Sair sem limpar o campo: perder a frase por causa de uma trava seria puni-lo
   duas vezes pela mesma coisa. A guarda tem de vir antes do `el.value = ""`.
   `includes` REPETIDO aqui de propósito: sem ele, apagar a guarda inteira daria
   `indexOf === -1`, que é menor que tudo e passaria o teste calado. */
t("...e sai sem limpar o que ele escreveu",
  envCode.includes("podeConversar") && envCode.indexOf("podeConversar") < envCode.indexOf('el.value = ""'));
/* E A GUARDA NÃO PODE PASSAR PELA LISTA DE FLUXOS. A primeira versão fazia
   `(S.fluxos || []).find(...)` e testava `fl && !pode`: com a lista ainda não
   carregada, `fl` era `null`, o `&&` curto-circuitava e a guarda LIBERAVA — uma
   trava falhando aberta. O estado do dossiê mora no `S.dossie`, e é de lá que o
   veredito tem de sair. Presença ANTES da ausência de propósito: sem a primeira
   metade, apagar a guarda inteira também tiraria `S.fluxos` da função e este caso
   passaria calado — a mesma armadilha do `indexOf` acima, que `-1` menor que tudo
   já pregou neste arquivo.

   MEDIDO SOBRE O `envCode` (definido acima) pelo motivo dito lá: o comentário que
   explica esta decisão CITA `(S.fluxos || []).find(...)`, e casar no texto cru
   reprovaria a própria documentação da decisão. */
t("...e a guarda não passa por `S.fluxos` (com a lista vazia ela liberava)",
  envCode.includes("podeConversar(S.dossie.get(") && !envCode.includes("S.fluxos"));
/* O CONVITE DA CONVERSA VAZIA também ficou falso com a trava: "descreve o upgrade
   que você quer" é o maior texto da coluna e manda escrever num campo que não está
   lá. Ele é gated pelo mesmo veredito. Estático porque `blocosConversa` depende de
   meia dúzia de outros pedaços da página; o que precisa ser garantido é que o
   convite não é incondicional. */
const bc = pega("function blocosConversa() {", "\n  /* Reaberta do disco");
/* Medido no `return`, não na primeira aparição do texto: o comentário que explica
   a decisão CITA o convite, e casar dentro dele reprovaria a documentação. Mesma
   armadilha do `id="dos-btn"` logo abaixo — e ela já pegou uma vez. */
t("o convite da conversa vazia é gated por `podeConversar`",
  bc.includes("podeConversar")
  && bc.indexOf("podeConversar") < bc.indexOf('<div class="vazio">Descreve o upgrade'));
t("...e o estado `perguntando` NÃO troca o convite (não sabemos ainda)",
  /razao !== "perguntando"/.test(bc));

/* O botão do dossiê aparece em DOIS lugares desde a trava. Dois nós com o mesmo
   id são HTML inválido, e o sintoma seria o pior: `getElementById` acha o
   primeiro, o segundo pinta igual e o clique não faz nada, calado. */
/* Medido em `<button …>`, não no arquivo inteiro: o comentário que explica a
   troca CITA o id antigo, e um teste que casa dentro de comentário reprova a
   própria documentação da decisão. */
t("o botão do dossiê não usa id (ele aparece duas vezes na tela)",
  !/<button[^>]*id="dos-btn"/.test(h) && /data-dossie="1"/.test(h));
t("...e nada mais na página procura o id antigo",
  !/getElementById\("dos-btn"\)/.test(h));
t("...e o clique dele é delegado uma vez só, não registrado por render",
  /closest\("\[data-dossie\]"\)/.test(h));

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 5 ] o rascunho sobrevive ao campo desaparecer");

/* A TRAVA PODE SUBIR NO MEIO DE UMA FRASE: o fluxo é editado no n8n, o refetch
   pega a divergência, o dossiê vira vermelho e o compositor é trocado por um
   bloco. O `#cp` sai do DOM levando o texto, e o `restaurarInputs` não tem onde
   devolvê-lo — não é que ele erre, é que o campo não existe mais.

   Estes casos rodam AS DUAS FUNÇÕES DE VERDADE, com um `document` de mentira,
   porque o que precisa ser provado aqui é comportamento e não forma: um teste
   estático casaria com o `S.rascunho` citado no comentário e aprovaria a ausência
   do código — que é exatamente o que aconteceu no bloco [ 4 ] deste arquivo. */
const capSrc = pega('const CAMPOS = ["cp", "hgv-q"];', "\n/* ─────────────────────── os três cliques");
let campos = {};
let focou = [];
const campo = v => ({ value: v, selectionStart: 0, selectionEnd: 0,
  focus() { focou.push(this); }, setSelectionRange() {} });
const docFake = { activeElement: null, getElementById: id => campos[id] || null,
  querySelector: () => null, querySelectorAll: () => [] };
const Sr = { rascunho: "" };
const io = new Function("S", "document", capSrc + "; return { capturarInputs, restaurarInputs };")(Sr, docFake);

// 1) O campo existe e tem texto: a pintura copia o rascunho para `S`.
campos = { cp: campo("trocar o modelo do agente por") };
io.capturarInputs();
t("com o campo na tela, a pintura guarda o rascunho em `S`", Sr.rascunho === "trocar o modelo do agente por");

// 2) A trava subiu e o campo saiu do DOM. Ninguém escreve em `S.rascunho` e o que
//    estava fica. Este é o caso inteiro.
campos = {};
const st2 = io.capturarInputs();
t("o campo desapareceu: o rascunho continua em `S` (é o caso que este bloco existe para)",
  Sr.rascunho === "trocar o modelo do agente por" && !st2.cp);
io.restaurarInputs(st2);
t("...e restaurar sem campo nenhum não explode", true);

// 3) O dossiê ficou em dia, o campo voltou vazio, e não houve medição dele.
campos = { cp: campo("") };
focou = [];
io.restaurarInputs(st2);
t("o campo voltou: o rascunho volta com ele", campos.cp.value === "trocar o modelo do agente por");
/* SEM ROUBAR O FOCO. Ele não pediu para voltar a escrever agora, pediu para não
   perder o que escreveu — e o repaint que devolve o campo pode chegar enquanto ele
   lê a conversa ou está com o cursor em outro lugar. */
t("...e sem roubar o foco de onde ele estava", focou.length === 0);

/* 4) A MEDIÇÃO DO CAMPO VENCE O RASCUNHO. Quando o `#cp` existia na pintura
      anterior, o valor DELE é a verdade e o rascunho é só o reserva — sem essa
      ordem, um rascunho velho poderia sobrescrever o que ele acabou de digitar. */
campos = { cp: campo("o que ele digitou agora") };
const st4 = io.capturarInputs();
Sr.rascunho = "uma frase velha que não pode voltar";
campos = { cp: campo("") };
io.restaurarInputs(st4);
t("com medição do campo, ela vence o rascunho guardado", campos.cp.value === "o que ele digitou agora");

/* 5) ENVIOU: o campo fica vazio, e o vazio TEM de zerar o rascunho. Sem esta
      metade, a mensagem já enviada voltaria ao campo na próxima trava — ele leria
      a própria frase de volta sem saber se mandou ou não. */
campos = { cp: campo("") };
io.capturarInputs();
t("campo vazio zera o rascunho (mensagem enviada não volta como rascunho)", Sr.rascunho === "");
campos = {};
const st5 = io.capturarInputs();
campos = { cp: campo("") };
io.restaurarInputs(st5);
t("...e depois de zerado nada é devolvido", campos.cp.value === "");

/* E A TELA DIZ QUE GUARDOU. Dos três desfechos, o pior não é perder: é guardar em
   silêncio. Perdido, ele descobre na hora e reescreve; guardado e não dito, ele
   reescreve em outro lugar e depois a versão antiga reaparece — duas versões da
   mesma ideia, e nenhum jeito de saber qual é a nova. */
S.rascunho = "";
põe({ cor: "cinza", nos: 179, preco: {} });
t("travado sem rascunho: nenhuma promessa de ter guardado nada",
  !/Guardei/.test(api.compositorHtml(flux)));
S.rascunho = "  trocar o modelo do agente  ";
const cGuard = api.compositorHtml(flux);
t("travado com rascunho: a tela diz que guardou e promete a volta",
  /Guardei/.test(cGuard) && /volta para o campo/.test(cGuard));
t("...e conta o tamanho sem repetir o texto dele no bloco da trava",
  /25 caracteres/.test(cGuard) && !/trocar o modelo/.test(cGuard));
/* Liberado NÃO fala de rascunho: o campo está ali com o texto dentro, e dizer
   "guardei" ao lado do que está à vista é ruído. */
põe({ cor: "verde", paragrafos: 179, bytes: 55468, bytesFluxo: 291000, preco: {} });
t("liberado não fala de rascunho: o texto está no campo, à vista",
  !/Guardei/.test(api.compositorHtml(flux)));
S.rascunho = "";

/* ───────────────────────────────────────────────────────────────────────────── */
console.log("\n[ 6 ] as entradas que não são o teclado, dentro do compositor");

/* A FILEIRA DE ANEXAR NÃO É UM CONTROLE SOLTO NA TELA: ela vive DENTRO do
   compositor, e é isso que faz a trava do dossiê valer para ela sem uma segunda
   regra. Sem dossiê o compositor não existe, então os botões vão com ele — e não
   sobra botão órfão convidando a anexar numa conversa que não aceita mensagem. */
const temBarra = h2 => /class="iobar"/.test(h2) && /id="up-arq"/.test(h2) && /id="up-pasta"/.test(h2);

põe({ cor: "verde", paragrafos: 179, bytes: 55468, bytesFluxo: 291000, preco: {} });
const cLib = api.compositorHtml(flux);
t("liberado: a fileira de anexar está dentro do compositor", temBarra(cLib));
t("...e nenhum botão dela vem desabilitado", temBarra(cLib) && !/id="up-arq" disabled/.test(cLib));

/* O ESTADO "CONFERINDO" MANTÉM A FILEIRA, DESABILITADA. Tirá-la e devolvê-la em
   meio segundo é a tela saltando duas vezes por uma resposta que quase sempre
   chega — e o segundo salto é o que lê como "algo deu errado". É a mesma razão
   pela qual o campo continua no DOM aqui, surdo, em vez de virar bloco. */
semEstado();
const cPerg = api.compositorHtml(flux);
t("conferindo: a fileira CONTINUA na tela (nada de saltar duas vezes)", temBarra(cPerg));
t("...mas desabilitada", /id="up-arq" disabled/.test(cPerg) && /id="up-pasta" disabled/.test(cPerg));

/* TRAVADO DE VERDADE: a fileira SAI, porque o compositor saiu. Um botão de anexar
   ao lado de um bloco que diz "escreve o dossiê para desbloquear" seria um convite
   a insistir — a mesma razão pela qual o bloqueio do §4.5 não desenha um botão de
   confirmar desabilitado. */
põe({ cor: "cinza", nos: 179, preco: {} });
t("travado: nenhum botão de anexar órfão", !temBarra(api.compositorHtml(flux)));

/* E O ANEXO GUARDADO É DITO, pelo mesmo motivo do rascunho: os arquivos já estão
   no servidor e sobrevivem à trava, mas o CHIP sai da tela junto com o compositor.
   Guardar em silêncio é o pior dos três desfechos — ele arrasta o print de novo, e
   aí há duas cópias do mesmo arquivo e nenhum jeito de saber qual entrou. */
t("travado sem anexo: nenhuma promessa de ter guardado arquivo",
  !/anexo\(s\) que você mandou/.test(api.compositorHtml(flux)));
S.anexosPre = [
  { nome: "colunas.csv", arquivo: "anexos/colunas.csv", tipo: "dados", bytes: 2048, dePasta: false },
  { nome: "print.png", arquivo: "anexos/print.png", tipo: "imagem", bytes: 90000, dePasta: false }
];
const cAnx = api.compositorHtml(flux);
t("travado com anexo: a tela diz que guardou e promete a volta do chip",
  /2 anexo\(s\) que você mandou/.test(cAnx) && /voltam junto com o campo/.test(cAnx));
/* O NOME NÃO É REPETIDO ALI: ele é `sens` (identifica cliente) e o bloco de trava é
   sobre o dossiê, não sobre o material. O que se conta é a quantidade. */
t("...sem repetir o nome do arquivo no bloco da trava", !/colunas\.csv/.test(cAnx));

/* LIBERADO: os chips aparecem, com a fonte certa. Antes da primeira mensagem a
   conversa não existe e a fonte é a BANDEJA; depois dela é o snapshot. Uma fonte só
   obrigaria a página a adivinhar em qual dos dois momentos ela está. */
põe({ cor: "verde", paragrafos: 179, bytes: 55468, bytesFluxo: 291000, preco: {} });
const cChips = api.compositorHtml(flux);
t("liberado sem conversa: o chip vem da BANDEJA",
  /class="anx/.test(cChips) && /colunas\.csv/.test(cChips) && api.anexosAgora().length === 2);
S.convId = "u1";
S.conv = { anexos: [{ nome: "spec.md", arquivo: "anexos/spec.md", tipo: "texto", bytes: 100, dePasta: false }], anexosLidos: ["anexos/spec.md"], status: "aguardando" };
const cSess = api.compositorHtml(flux);
t("com conversa aberta: o chip vem do SNAPSHOT, não da bandeja",
  /spec\.md/.test(cSess) && !/colunas\.csv/.test(cSess) && api.anexosAgora().length === 1);
/* A TIRA, E OS DOIS CASOS DE CADA MARCA. Os chips saíram de baixo do campo: com a
   conversa aberta eles sobem para a tira recolhida (`gavetaAnexos`, em
   `entradas.js`), montada ACIMA do compositor. As marcas continuam existindo e
   continuam certas — o que mudou é ONDE elas ficam —, então cada uma é medida nas
   DUAS direções: recolhida ela não aparece E A TIRA APARECE (a informação mudou de
   lugar, não sumiu da tela), aberta ela aparece.
   Medir só a ausência aceitaria a tira ter sumido junto; medir só a presença
   aceitaria a tira nascer aberta, que é o defeito oposto — o compositor voltaria a
   ser a parede de chips que este conserto tirou de lá.
   E ABRIR É `S.gavetaAnexos`, não uma chamada solta a `gavetaAnexos`: assim quem
   desenha continua sendo a página, pela mesma função servida, e o teste não vira
   uma segunda redação do desenho. */
t("com conversa aberta o chip sobe para a TIRA, que nasce RECOLHIDA",
  /class="anxgav/.test(cSess) && /1 anexo nesta conversa/.test(cSess)
  && /aria-expanded="false"/.test(cSess) && !/class="anx lido"/.test(cSess));
S.gavetaAnexos = true;
const cTira = api.compositorHtml(flux);
t("...e o `lido` só existe com sessão, agora dentro da tira ABERTA",
  /class="anx lido"/.test(cTira) && api.lidosAgora().length === 1);
/* TIRAR UM CHIP É BLOQUEADO COM RODADA CORRENDO: o arquivo já está no prompt que
   está sendo respondido, e removê-lo no meio faria a resposta citar algo que não
   está mais lá. A tira fica ABERTA nos dois casos de propósito: com ela recolhida a
   ausência do `×` seria verdadeira por acaso — não há chip nenhum ali — e o caso
   deixaria de medir a regra que ele existe para medir. */
S.conv.status = "correndo";
t("rodada correndo: não dá para tirar o chip", !/data-tirar/.test(api.compositorHtml(flux)));
S.conv.status = "aguardando";
t("rodada parada: dá para tirar, dentro da tira aberta",
  /data-tirar/.test(api.compositorHtml(flux)));
S.gavetaAnexos = false;
t("...e com a tira recolhida o × some junto com os chips, mas a tira continua na tela",
  !/data-tirar/.test(api.compositorHtml(flux)) && /class="anxgav/.test(api.compositorHtml(flux)));
S.convId = null; S.conv = null; S.anexosPre = []; S.gavetaAnexos = false;

/* ─────────── O NOME ACESSÍVEL DO CAMPO, E A FAMÍLIA `.tag` ───────────────
 *
 * Achados de uma navegação num browser de verdade, 2026-08-20. Os dois primeiros
 * casos são de COMPORTAMENTO — o HTML renderizado, não o fonte; os dois últimos leem
 * o CSS, porque contraste e overflow não se provam sem browser e o que dá para travar
 * de graça é a RECEITA continuar aplicada. */
console.log("\n[ 4 ] o nome acessível do campo, e a receita de contraste");

põe({ cor: "verde", paragrafos: 179, bytes: 55468, bytesFluxo: 291000, preco: {} });
const cA11y = api.compositorHtml(flux);
/* O DEFEITO: `placeholder` DESAPARECE no primeiro caractere digitado, então num
   leitor de tela o campo mais importante desta aba era "caixa de texto, em branco" a
   partir da primeira letra. Os dois campos do Tester já tinham o seu. */
t("o campo da conversa tem nome acessível, não só placeholder",
  /<textarea[^>]*aria-label="[^"]{10,}"/.test(cA11y));
/* Ele não pode variar com o estado: trocar o nome do campo entre "conferindo" e
   "liberado" faria o leitor anunciar um campo diferente a cada repintura, e esta tela
   repinta várias vezes por segundo. */
const rot = h2 => (String(h2).match(/<textarea[^>]*aria-label="([^"]*)"/) || [])[1] || null;
põe({ cor: "verde", paragrafos: 179, bytes: 1, bytesFluxo: 1, preco: {} });
const rotVerde = rot(api.compositorHtml(flux));
S.dossie.delete("w1");
const rotSem = rot(api.compositorHtml(flux));
t("...e o nome é o MESMO nos dois estados em que o campo existe",
  rotVerde && rotSem && rotVerde === rotSem, String(rotVerde) + " vs " + String(rotSem));

/* A FAMÍLIA `.tag`, e não uma etiqueta de cada vez. Medido no DOM vivo antes do
   conserto: claro `.tag.ok` 4,4665 e `.tag.warn` 4,4841, escuro `.tag.cold` 4,0437
   sobre `--raised`. Depois: 26 de 26 passam, pior caso 5,9522. O que este caso trava
   é a RECEITA — cor de status como texto corrido sobre `-soft` voltando a ser o token
   `-txt` cru é o defeito voltando. */
const cssPag = h.slice(h.indexOf("<style>"), h.indexOf("</style>"));
for (const cls of ["ok", "warn", "cold", "risk"]) {
  const re = new RegExp("\\.tag\\." + cls + " \\{ color: color-mix\\(in srgb, var\\(--" + cls + "-txt\\) 72%");
  t("`.tag." + cls + "` usa a receita, não o token `-txt` cru", re.test(cssPag));
}
/* As três do diff são 9,5px — o menor texto colorido da tela — e decidem um clique
   que escreve em produção. E há DOIS blocos `.dnode` no arquivo (o segundo vence pela
   cascata): consertar um só seria consertar o que a tela não usa. */
t("as três etiquetas do diff usam a receita, nos DOIS blocos `.dnode`",
  (cssPag.match(/\.dnode \.tag\.(added|modified|removed) *\{ color: color-mix/g) || []).length === 6);
/* `min-width: 0` é o conserto MECÂNICO do overflow: item de grid e de flex nascem com
   o piso no próprio min-content, e sem desligar isso mudar `grid-template-columns`
   não resolve nada. Sem o bloco, em 390px o `.tela` cortava 48px em SILÊNCIO. */
t("o bloco mobile de 620px existe e desliga o piso de min-content",
  /@media \(max-width: 620px\) \{[\s\S]{0,400}min-width: 0;/.test(cssPag));
t("...e levanta os controles do canvas acima do piso de 32px do dedo",
  /@media \(max-width: 620px\) \{[\s\S]{0,2000}\.cam button \{ height: 3[2-9]px/.test(cssPag));
/* `margin: auto` vertical resolve para ZERO em layout de bloco: a regra que centra o
   convite da conversa vazia não fazia nada, e sobravam 250px medidos entre ele e o
   compositor. */
t("`.conv-rol` é container de flex, senão o `margin: auto` do convite é morto",
  /\.conv-rol \{[^}]*display: flex;[^}]*flex-direction: column;/.test(cssPag));

console.log(bad ? "\nFALHOU: " + bad + " de " + (ok + bad) : "\npassou: " + ok + " casos");
process.exit(bad ? 1 : 0);
