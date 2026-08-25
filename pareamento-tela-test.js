/* pareamento-tela-test.js — a TELA do pareamento e da escolha de IA, no
 * `integracoes.html`.
 *
 * O BLOCO DE JUÍZO E AS FUNÇÕES DE DESENHO SÃO EXTRAÍDOS DA PÁGINA EM TEMPO DE
 * EXECUÇÃO. Reimplementá-los aqui provaria a cópia, não a tela — mesma disciplina
 * do `dossie-tela-test.js` e do `audio-test.js`. E a extração LANÇA quando não
 * acha a âncora: uma fatia vazia devolvida em silêncio faria o arquivo inteiro
 * passar sobre string vazia, e renomear uma função viraria uma suíte verde que
 * não mede nada.
 *
 * O QUE ESTE ARQUIVO GUARDA, em uma frase por bloco:
 *
 *  1. As frases dos estados são TODAS DISTINTAS. `nao-pareado` e `ilegivel` são o
 *     par perigoso: as duas são "não está funcionando" e mandam para lugares
 *     opostos — uma manda parear, a outra manda desparear ANTES de parear, porque
 *     parear por cima esconde um arquivo que ela nem sabe que está lá. Uma frase
 *     só para as duas ensina a ignorar as duas.
 *  2. `ilegivel` NÃO oferece só «Parear».
 *  3. `idConfere` tem TRÊS saídas distintas: `true` confere, `false` acusa, `null`
 *     diz que não há com o que comparar. Deixar `null` cair em `false` é acusar
 *     por um campo que nunca existiu — o defeito do `docAgentes`.
 *  4. CAMPO AUSENTE NÃO CAI NO GALHO NEGATIVO. É a nona vez que este repositório
 *     escreve isso, e aqui é o pior galho de todos: dizer "nenhum site manda neste
 *     agente" por causa de um processo Node velho, com pareamento vivo no disco.
 *  5. A lista de origens é desenhada ITEM A ITEM. Um número esconde exatamente o
 *     que precisa ser conferido — quem pode escrever em fluxo de produção.
 *  6. O `codex` APARECE, recusado, COM O MOTIVO. Opção ausente e sem explicação
 *     vira "o cockpit não suporta"; opção visível e recusada é informação.
 *  7. Cada modo diz QUEM PAGA, e o `plano` diz o pré-requisito que não é nosso.
 *  8. O CÓDIGO NUNCA É MOSTRADO NESTA TELA, e a tela diz onde procurá-lo. Se ele
 *     voltasse em resposta, a confirmação humana viraria enfeite.
 *  9. A escolha de IA é dita como NÃO GRAVADA.
 *
 * De graça: sem browser, sem servidor, sem rede, sem modelo.
 * `node pareamento-tela-test.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

const bruto = fs.readFileSync(path.join(__dirname, "integracoes.html"), "utf8");
const h = bruto.replace(/\r\n/g, "\n");

/* LANÇA quando não acha. Ver o cabeçalho: uma fatia vazia devolvida calada é uma
   suíte verde que não mede nada. */
function pega(de, ate) {
  const i = h.indexOf(de);
  if (i < 0) throw new Error("nao achei `" + de + "` no integracoes.html - a tela mudou de forma");
  const j = h.indexOf(ate, i + de.length);
  if (j < 0) throw new Error("nao achei o fim do bloco que comeca em `" + de + "`");
  return h.slice(i, j);
}

/* MEDIR SEM COMENTÁRIO. Um mutante que apagou uma guarda inteira no
   `dossie-tela-test.js` deixou dois casos verdes porque o comentário que
   explicava a guarda carregava o nome que eles procuravam. Toda checagem de
   FIAÇÃO (o que o código chama, em que ordem) mede esta versão. */
const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const FIM_JUIZO = "/* ═══════════════════════════════════════════════════════════════════════════\n   FIM DO JUÍZO.";

/* Todo o juízo novo: pareamento, IA e o leitor do pacote. */
const juizo = pega("const PASSOS = [", FIM_JUIZO);
/* O vocabulário de aviso é da página — a cerimônia o usa ANCORADO, e uma cópia
   aqui provaria a cópia exatamente como reimplementar o juízo provaria. */
const avisos = pega("const AVISO_GLIFO = {", "function pilhaAvisos()");
/* Os glifos e o ícone de recarregar, que o desenho usa. */
const glifos = pega("const GLIFOS = {", "function linhaHtml(L)");
/* O desenho das duas seções. */
const desenho = pega("const ICO_CHAVE =", "/* ------------------------------------------------------- o que sobrevive ao repaint");
/* O rodapé honesto, para provar que ele parou de dizer que a tela não escreve. */
const verdade = pega("const VERDADE = [", "\n/* Um botão que não faz nada");
/* A reconciliação entre a LINHA do Codex e o CARTÃO de IA. Ela mora lá em cima,
   junto do juízo das três conexões, e não no bloco novo — por isso vem à parte. */
const codexRec = pega("function codexReconciliar(f)", "\n/* Quantos fluxos");
/* O aviso da FORMA do que está guardado no cofre. Ele existe porque o
   `cofre-test.js` tem um alarme que fica vermelho no dia em que a tela falar do
   cofre e não consumir `forma` — e esse dia é hoje. */
const formaChave = pega("const FORMA_CONHECIDA = [", "\n/* ------------------------------------------------- o que para em consequência");

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const S = {
  fase: "pronto", fatos: null, erro: null, conferindo: false,
  par: null, parErro: null, parBuscando: false,
  abrindoPacote: false, cerim: null, cerimErro: null, pacote: "", codigo: "", ocupado: false,
  iaProv: null, iaModo: null
};

const api = new Function("esc", "S",
  glifos + avisos + juizo + verdade + codexRec + formaChave + desenho +
  "; return { PASSOS, passoAtual, variantePar, PAR_FRASE, PAR_CONTROLE, PAR_TAG, NAO_REVOGA," +
  " idConfereFrase, origensDescartadasFrase, BUSCA, buscaFase, ONDE_PADRAO, ondeFrase," +
  " normalizacoesFrase, restaFrase, confirmarFalha, IA_PROVEDOR, IA_MODO, IA_PADRAO," +
  " provedorPorId, modoPorId, escolhaFrase, IA_PENDENTE, iaFonte, lerPacote, PACOTE_EXEMPLO," +
  " VERDADE, codexReconciliar, FORMA_CONHECIDA, avisoFormaChave, passosHtml, origensHtml, fatosPareado, pareamentoHtml, cerimoniaHtml," +
  " opProvedorHtml, opModoHtml, iaHtml };")(esc, S);

let ok = 0, bad = 0;
const t = (n, c) => { if (c) { ok++; console.log("  ok    " + n); } else { bad++; console.log("  FALHOU " + n); } };

/* Zera a tela entre casos: um estado deixado de pé por um caso anterior faz o
   seguinte medir outra coisa. */
function zerar(extra) {
  S.fase = "pronto"; S.fatos = null; S.erro = null;
  S.par = null; S.parErro = null; S.parBuscando = false;
  S.abrindoPacote = false; S.cerim = null; S.cerimErro = null;
  S.pacote = ""; S.codigo = ""; S.ocupado = false;
  S.iaProv = null; S.iaModo = null;
  Object.assign(S, extra || {});
}

const PAREADO = {
  estado: "pareado", dono: "8f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f", formaDono: "uuid",
  origens: ["https://painel.exemplo.com", "https://outro.exemplo.com"],
  origensInvalidas: [], iss: "https://emis.exemplo.co/auth/v1",
  jwks: "https://emis.exemplo.co/auth/v1/.well-known/jwks.json",
  agenteId: "ag_0123456789abcdef0123456789abcdef", idConfere: true, temChave: true,
  em: "2026-08-24T12:00:00.000Z", versao: 1, guardaAceita: true, bytes: 512,
  arquivo: "C:\\cockpit\\.agente\\pareamento.json", desafio: null
};
const clone = x => JSON.parse(JSON.stringify(x));
const VARIANTES = ["ausente", "desconhecido", "ilegivel", "naoPareado", "meioPareamento",
  "semChave", "idNaoBate", "idNaoConferivel", "origensDescartadas", "pareado"];

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 1 ] variantePar — a ordem dos testes é a regra");

t("bloco ausente -> `ausente`, NUNCA `naoPareado`", api.variantePar(undefined) === "ausente");
t("objeto sem `estado` -> `ausente` (campo ausente nao cai no galho negativo)", api.variantePar({}) === "ausente");
t("`estado` que nao e string -> `ausente`", api.variantePar({ estado: 3 }) === "ausente");
t("null -> `ausente`", api.variantePar(null) === "ausente");
t("`ilegivel` tem variante propria", api.variantePar({ estado: "ilegivel", porque: "x" }) === "ilegivel");
t("`nao-pareado` tem variante propria", api.variantePar({ estado: "nao-pareado" }) === "naoPareado");
t("estado desconhecido NAO cai no ramo bom", api.variantePar({ estado: "meio-ligado" }) === "desconhecido");
t("pareado inteiro -> `pareado`", api.variantePar(PAREADO) === "pareado");

let d = clone(PAREADO); d.guardaAceita = false;
t("guarda nao aceita -> `meioPareamento` (o arquivo existe e nao vale)", api.variantePar(d) === "meioPareamento");
d = clone(PAREADO); delete d.guardaAceita;
t("`guardaAceita` AUSENTE tambem e meio-pareamento, nunca verde", api.variantePar(d) === "meioPareamento");
d = clone(PAREADO); d.temChave = false;
t("sem chave privada -> `semChave`", api.variantePar(d) === "semChave");
d = clone(PAREADO); d.idConfere = false;
t("identidade nao bate -> `idNaoBate`", api.variantePar(d) === "idNaoBate");
d = clone(PAREADO); d.idConfere = null;
t("identidade nao conferivel -> `idNaoConferivel`, e NAO `idNaoBate`", api.variantePar(d) === "idNaoConferivel");
d = clone(PAREADO); delete d.idConfere;
t("`idConfere` AUSENTE cai no nao-conferivel, nunca na acusacao", api.variantePar(d) === "idNaoConferivel");
d = clone(PAREADO); d.origensInvalidas = ["http://claro.exemplo.com"];
t("origem descartada -> `origensDescartadas`", api.variantePar(d) === "origensDescartadas");
d = clone(PAREADO); d.guardaAceita = false; d.temChave = false; d.idConfere = false;
t("com varios problemas, o mais grave vence (guarda ignora o arquivo)", api.variantePar(d) === "meioPareamento");

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 2 ] as frases dos estados sao TODAS distintas");

const frases = VARIANTES.map(v => api.PAR_FRASE[v]({
  estado: v === "desconhecido" ? "meio-ligado" : "pareado",
  porque: "o arquivo nao e JSON valido.",
  origensInvalidas: ["http://claro.exemplo.com"],
  idConfere: v === "idNaoBate" ? false : null
}));
t("as DEZ frases existem", frases.every(f => typeof f === "string" && f.length > 40));
t("as DEZ frases sao distintas entre si", new Set(frases).size === VARIANTES.length);

const fAus = api.PAR_FRASE.ausente({});
const fNao = api.PAR_FRASE.naoPareado({});
const fIle = api.PAR_FRASE.ilegivel({ porque: "o arquivo de pareamento não é JSON válido." });
t("`ausente` fala do processo velho e do `server.js`, nao de pareamento",
  /server\.js/.test(fAus) && /abra de novo/.test(fAus));
t("`ausente` NAO afirma que nao esta pareado",
  !/não está ligado a nenhuma conta/.test(fAus) && /não afirma/.test(fAus));
t("`naoPareado` diz que nada quebrou e que o painel local funciona",
  /Nada quebrou/.test(fNao) && /funciona igual/.test(fNao));
t("`naoPareado` NAO fala de arquivo no disco", !/no disco/.test(fNao) && !/arquivo/.test(fNao));
t("`ilegivel` diz que EXISTE arquivo e cita o motivo do modulo",
  /Existe um arquivo/.test(fIle) && /não é JSON válido/.test(fIle));
t("`ilegivel` NAO le como `naoPareado`: ele nega a leitura de 'nunca pareado'",
  /não é «nunca pareado»/.test(fIle));
t("`ilegivel` manda desparear e refazer, nao parear por cima",
  /desparear e refazer/.test(fIle));
t("`meioPareamento` diz que o guarda ignora o arquivo",
  /guarda o ignora/.test(api.PAR_FRASE.meioPareamento({})));
t("`desconhecido` nomeia o estado que veio, em vez de traduzir",
  /meio-ligado/.test(api.PAR_FRASE.desconhecido({ estado: "meio-ligado" })));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 3 ] idConfere — TRES saidas distintas");

const idT = api.idConfereFrase({ idConfere: true });
const idF = api.idConfereFrase({ idConfere: false });
const idN = api.idConfereFrase({ idConfere: null });
const idA = api.idConfereFrase({});
t("as tres frases sao distintas", new Set([idT, idF, idN]).size === 3);
t("`true` afirma que bate", /bate/.test(idT) && !/não bate/.test(idT));
t("`false` e ACUSACAO e manda refazer", /não bate/.test(idF) && /acusação/.test(idF) && /Despareie/.test(idF));
t("`null` diz que NAO HA COM O QUE COMPARAR", /não há com o que comparar/.test(idN));
t("`null` nega explicitamente a leitura do `false`", /não<\/b> quer dizer que ela não bate/.test(idN));
t("`null` nao acusa ninguem", !/acusação/.test(idN) && !/editou o arquivo/.test(idN));
t("AUSENTE devolve a frase do `null`, nunca a do `false`", idA === idN);

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 4 ] os controles que cada estado oferece");

t("`ilegivel` NAO oferece so 'Parear'", api.PAR_CONTROLE.ilegivel.parear === false);
t("`ilegivel` oferece desparear e refazer", api.PAR_CONTROLE.ilegivel.refazer === true);
t("`naoPareado` e o UNICO que oferece parear",
  VARIANTES.filter(v => api.PAR_CONTROLE[v].parear).join() === "naoPareado");
t("`ausente` nao oferece controle nenhum",
  !api.PAR_CONTROLE.ausente.parear && !api.PAR_CONTROLE.ausente.desparear && !api.PAR_CONTROLE.ausente.refazer);
t("`desconhecido` nao oferece controle nenhum",
  !api.PAR_CONTROLE.desconhecido.parear && !api.PAR_CONTROLE.desconhecido.desparear && !api.PAR_CONTROLE.desconhecido.refazer);
t("`meioPareamento` so tem a saida de refazer", api.PAR_CONTROLE.meioPareamento.refazer === true &&
  api.PAR_CONTROLE.meioPareamento.parear === false);
t("todas as dez variantes tem entrada em PAR_CONTROLE",
  VARIANTES.every(v => api.PAR_CONTROLE[v] && typeof api.PAR_CONTROLE[v].parear === "boolean"));
t("todas as dez variantes tem etiqueta e glifo",
  VARIANTES.every(v => api.PAR_TAG[v] && api.PAR_TAG[v].txt && api.PAR_TAG[v].glifo));
t("as dez etiquetas sao distintas", new Set(VARIANTES.map(v => api.PAR_TAG[v].txt)).size === 10);
t("`ausente` e `desconhecido` sao FRIOS, nunca vermelhos",
  api.PAR_TAG.ausente.cls === "cold" && api.PAR_TAG.desconhecido.cls === "cold");
t("so `pareado` e verde", VARIANTES.filter(v => api.PAR_TAG[v].cls === "ok").join() === "pareado");

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 5 ] o desenho: ilegivel nao convida a parear por cima");

zerar({ par: { estado: "ilegivel", porque: "o arquivo de pareamento está vazio — escrita interrompida." } });
const hIle = api.pareamentoHtml();
t("ilegivel NAO desenha o botao de parear", !/Parear com uma conta/.test(hIle));
t("ilegivel desenha 'Desparear e refazer'", /Desparear e refazer/.test(hIle));
t("ilegivel carrega a etiqueta propria", /ARQUIVO ILEGÍVEL/.test(hIle));
t("ilegivel mostra o motivo do modulo, e marcado como `sens`",
  /escrita interrompida/.test(hIle) && /class="sens"/.test(hIle));

zerar({ par: { estado: "nao-pareado", porque: "este agente nunca foi pareado com nenhuma conta." } });
const hNao = api.pareamentoHtml();
t("nao-pareado desenha o botao de parear", /Parear com uma conta/.test(hNao));
t("nao-pareado NAO desenha 'Desparear'", !/Desparear/.test(hNao));
t("nao-pareado carrega etiqueta propria e diferente da de ilegivel",
  /NÃO PAREADO/.test(hNao) && !/ARQUIVO ILEGÍVEL/.test(hNao));

zerar({ par: undefined, parBuscando: false });
const hAus = api.pareamentoHtml();
t("campo ausente NAO desenha botao nenhum de acao",
  !/Parear com uma conta/.test(hAus) && !/Desparear/.test(hAus));
t("campo ausente diz por que nao ha controle", /não age sobre um estado que ela não leu/.test(hAus));
t("campo ausente NAO diz 'NÃO PAREADO'", !/NÃO PAREADO/.test(hAus) && /AINDA NÃO SEI/.test(hAus));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 6 ] as origens, item a item");

zerar({ par: PAREADO });
const hPar = api.pareamentoHtml();
t("as DUAS origens saem escritas, cada uma",
  /painel\.exemplo\.com/.test(hPar) && /outro\.exemplo\.com/.test(hPar));
t("saem como itens de lista, nao como contagem",
  (hPar.match(/<li class="val"><span class="mk">vale<\/span>/g) || []).length === 2);
t("a tela NAO substitui a lista por um numero", !/2 origens/.test(hPar));
t("a conta sai marcada como `sens`", /<b class="sens">8f1c2d3e/.test(hPar));
t("o `naoRevoga` e repetido antes do clique", /Não invalida nenhuma sessão do lado do site/.test(hPar));

d = clone(PAREADO); d.origensInvalidas = ["http://claro.exemplo.com"];
d.origens = d.origens.concat(["http://claro.exemplo.com"]);
zerar({ par: d });
const hInv = api.pareamentoHtml();
t("origem descartada aparece marcada como descartada", /<span class="mk">descartada<\/span>/.test(hInv));
t("as validas continuam marcadas como vale", /<span class="mk">vale<\/span>/.test(hInv));
t("a frase NOMEIA a origem descartada, nao so conta",
  /claro\.exemplo\.com/.test(api.origensDescartadasFrase(d)) && /guarda descarta cada uma delas/.test(api.origensDescartadasFrase(d)));
t("singular e plural sao explicitos, nunca derivados por 's'",
  /não tem forma de origem/.test(api.origensDescartadasFrase({ origensInvalidas: ["a"] })) &&
  /não têm forma de origem/.test(api.origensDescartadasFrase({ origensInvalidas: ["a", "b"] })));

d = clone(PAREADO); d.origens = [];
t("lista vazia diz que nao autoriza site nenhum, em vez de sumir",
  /Nenhuma origem gravada/.test(api.origensHtml(d)));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 7 ] a cerimonia: o codigo NAO esta nesta tela");

t("o passo 3 diz que o codigo sai no CONSOLE do agente",
  /CONSOLE DELE/.test(api.PASSOS[2].txt) && /janela preta/.test(api.PASSOS[2].txt));
t("sao quatro passos", api.PASSOS.length === 4);
t("sem cerimonia e sem pareamento, a pessoa esta no passo 2", api.passoAtual(null, null) === 2);
t("cerimonia aberta poe a pessoa no passo 4", api.passoAtual(null, { desafio: "d_1" }) === 4);
t("pareado sem cerimonia e 'acabou' (5)", api.passoAtual({ estado: "pareado" }, null) === 5);
t("cerimonia aberta vence o pareado: o passo e o 4", api.passoAtual({ estado: "pareado" }, { desafio: "d_1" }) === 4);

const ondeCom = api.ondeFrase({ onde: "o código está na janela do cockpit (o terminal que ficou aberto)." });
const ondeSem = api.ondeFrase({});
t("as duas frases de `onde` sao distintas", ondeCom !== ondeSem);
t("as duas dizem que o codigo NAO aparece nesta tela",
  /NÃO aparece nesta tela/.test(ondeCom) && /NÃO aparece nesta tela/.test(ondeSem));
t("as duas explicam o porque (a confirmacao humana viraria enfeite)",
  /enfeite/.test(ondeCom) && /enfeite/.test(ondeSem));
t("`onde` ausente NAO fica calado: ele diz onde procurar mesmo assim",
  /console dele/.test(ondeSem) && /start-cockpit\.cmd/.test(ondeSem));

zerar({ par: { estado: "nao-pareado" }, cerim: { desafio: "d_abc", expiraEm: Date.now() + 60000, tentativas: 5, onde: "na janela do cockpit." } });
const hCer = api.pareamentoHtml();
t("com cerimonia aberta, a trilha marca o passo 4", /passo 4[\s\S]{0,40}você está aqui/.test(hCer));
t("desenha o campo do codigo", /id="codigo"/.test(hCer));
t("o placeholder do campo NAO e um codigo de verdade", /placeholder="000-000"/.test(hCer));
t("diz quantas tentativas existem", /5 tentativas/.test(hCer));
t("diz que caractere fora do alfabeto NAO gasta tentativa", /não gasta tentativa/.test(hCer));
t("diz quais caracteres nao existem no alfabeto", /<code>0<\/code>/.test(hCer) && /<code>I<\/code>/.test(hCer));
t("nenhum lugar da cerimonia promete mostrar o codigo", !/o código é/.test(hCer));

zerar({ par: { estado: "nao-pareado" }, cerim: { desafio: "d_abc", expiraEm: Date.now() + 60000, onde: "x" } });
t("tentativas AUSENTE nao vira zero nem some: diz que nao sabe",
  /Quantas tentativas existem, não sei/.test(api.pareamentoHtml()));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 8 ] normalizacoes, prazo e recusa");

t("sem normalizacao, nao inventa aviso", api.normalizacoesFrase({ normalizacoes: [] }) === null);
t("campo ausente tambem nao inventa aviso", api.normalizacoesFrase({}) === null);
const nz = api.normalizacoesFrase({ normalizacoes: [{ campo: "origem", de: "https://X.exemplo.com/", para: "https://x.exemplo.com" }] });
t("normalizacao mostra OS DOIS lados (colou X, pareia Y)",
  /https:\/\/X\.exemplo\.com\//.test(nz) && /https:\/\/x\.exemplo\.com/.test(nz));
t("...e diz que e a forma normalizada que o guarda compara", /o guarda vai comparar/.test(nz));

const agora = 1000000;
t("prazo futuro conta em segundos", api.restaFrase(agora + 45000, agora).txt === "vale por mais 45 s" &&
  api.restaFrase(agora + 45000, agora).venceu === false);
t("prazo acima de um minuto sai em min e s", /vale por mais 2 min/.test(api.restaFrase(agora + 125000, agora).txt));
t("prazo vencido diz que venceu", api.restaFrase(agora - 1, agora).venceu === true);
t("`expiraEm` AUSENTE nao vira '0 s' (que leria como vencido)",
  api.restaFrase(undefined, agora).venceu === false && /sem prazo declarado/.test(api.restaFrase(undefined, agora).txt));

const f410 = api.confirmarFalha(410, { motivo: "o código venceu." });
const f400 = api.confirmarFalha(400, { motivo: "o código não confere.", tentativasRestantes: 3 });
const fX = api.confirmarFalha(undefined, { motivo: "?" });
t("410, 400 e desconhecido sao TRES frases distintas", new Set([f410.frase, f400.frase, fX.frase]).size === 3);
t("410 marca fim de cerimonia", f410.fim === true && /acabou/.test(f410.frase));
t("400 NAO marca fim, e diz que da para tentar", f400.fim === false && /continua aberta/.test(f400.frase));
t("400 diz quantas tentativas restam", /3 tentativas/.test(f400.frase));
t("400 sem `tentativasRestantes` diz que nao sabe, em vez de omitir",
  /não sei/.test(api.confirmarFalha(400, {}).frase));
/* Ele MENCIONA as duas leituras para dizer que não escolhe nenhuma — o que não
   pode acontecer é ele AFIRMAR uma delas, que são as duas frases literais das
   outras saídas. */
t("status desconhecido NAO cai em 'acabou' nem em 'tente de novo'",
  fX.fim === false && !/A cerimônia acabou/.test(fX.frase) &&
  !/continua aberta/.test(fX.frase) && /não classifica/.test(fX.frase));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 9 ] o pacote colado");

t("vazio pede o pacote em vez de acusar erro", api.lerPacote("").vazio === true && api.lerPacote("").ok === false);
t("texto que nao e JSON diz para copiar o bloco inteiro",
  /Copie o bloco inteiro/.test(api.lerPacote("cole aqui").porque) && api.lerPacote("cole aqui").ok === false);
const inc = api.lerPacote('{"dono":"abc"}');
t("pacote incompleto NOMEIA o que falta", inc.ok === false && /origens/.test(inc.porque) && /iss/.test(inc.porque));
t("...e nao completa o que nao recebeu", /Não completo o que não recebi/.test(inc.porque));
const bom = api.lerPacote('{"dono":"abc12345","origens":["https://a.b"],"iss":"https://c.d/auth/v1","jwks":"https://c.d/auth/v1/j"}');
t("pacote completo passa", bom.ok === true && bom.campos.origens.length === 1);
t("...e a frase diz ATE ONDE isso vale (so a forma)", /só isso que eu conferi/.test(bom.porque));
t("...e avisa que o JWKS tem de ser do mesmo endereco do emissor", /mesmo endereço do emissor/.test(bom.porque));
const sing = api.lerPacote('{"dono":"abc12345","origem":"https://a.b","iss":"https://c.d/x","jwks":"https://c.d/y"}');
t("`origem` no singular e aceito (a rota aceita os dois)", sing.ok === true && sing.campos.origens[0] === "https://a.b");
t("o exemplo do campo usa [SEU VALOR], nunca um endereco inventado",
  /\[O SITE\]/.test(api.PACOTE_EXEMPLO) && !/supabase\.co/.test(api.PACOTE_EXEMPLO));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 10 ] a IA: o codex aparece COM o motivo");

const cx = api.provedorPorId("codex");
const cl = api.provedorPorId("claude");
t("o codex esta na lista (nao foi escondido)", !!cx);
t("o codex esta marcado como recusado", cx.aceito === false);
t("o claude e o aceitavel", cl.aceito === true);
t("o motivo do codex NOMEIA a flag que falta", /--setting-sources/.test(cx.porque));
t("...e diz o que carrega sempre por causa disso",
  /config\.toml/.test(cx.porque) && /AGENTS\.md/.test(cx.porque));
t("...e diz o que foi MEDIDO nesta maquina (a chave em texto puro)",
  /Medido nesta máquina/.test(cx.porque) && /varredura de segredo/.test(cx.porque));
t("a recusa e por ausencia de FLAG, nao por o CLI nao existir",
  /ausência medida de flag/.test(cx.resumo) && /está instalado/.test(cx.resumo));
t("o claude diz QUAIS sao as tres cercas",
  /--disallowedTools/.test(cl.porque) && /--strict-mcp-config/.test(cl.porque));

zerar({});
const hIa = api.iaHtml();
t("o codex e DESENHADO, com a etiqueta de recusado", /RECUSADO/.test(hIa) && /Codex CLI/.test(hIa));
t("o botao do codex vem desabilitado", /data-id="codex"[^>]*disabled/.test(hIa));
t("o motivo do codex esta no desenho, nao so no dado", /config\.toml/.test(hIa));
t("o claude vem como PODE RODAR", /PODE RODAR/.test(hIa));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 11 ] o modo diz QUEM PAGA");

const mp = api.modoPorId("plano");
const mc = api.modoPorId("chave");
t("os dois modos existem", !!mp && !!mc);
t("as duas frases de 'quem paga' sao distintas", mp.paga !== mc.paga);
t("`plano` diz que sai da cota da assinatura e que nenhum cartao e cobrado",
  /cota da assinatura/.test(mp.paga) && /nenhum cartão é cobrado/.test(mp.paga));
t("`chave` diz que sai do CARTAO, por token", /cartão dela, por token/.test(mc.paga));
t("`chave` diz explicitamente que NAO sai da assinatura", /<b>não<\/b> da assinatura/.test(mc.paga));
t("`plano` exige a CLI instalada E LOGADA nesta maquina",
  /instalada e logada nesta máquina/.test(mp.exige));
t("...e aponta para a linha do Claude, que e quem responde isso",
  /linha do Claude Code acima/.test(mp.exige));
t("`chave` nomeia a variavel de ambiente", /ANTHROPIC_API_KEY/.test(mc.exige));
t("`chave` diz que esta tela nao recebe nem guarda chave",
  /não recebe, não guarda e não mostra chave nenhuma/.test(mc.exige));
t("o desenho mostra quem paga nos dois cartoes",
  /cota da assinatura/.test(hIa) && /cartão dela, por token/.test(hIa));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 12 ] o padrao e dito, e a escolha e dita como NAO GRAVADA");

const padrao = api.escolhaFrase(api.IA_PADRAO.provedor, api.IA_PADRAO.modo, true);
const escolhido = api.escolhaFrase("claude", "chave", false);
t("padrao e escolha dizem coisas diferentes", padrao !== escolhido);
t("o padrao se anuncia como padrao", /é o padrão/.test(padrao) && /Ninguém escolheu/.test(padrao));
t("a escolha se anuncia como escolha", /Escolhido por você nesta aba/.test(escolhido));
t("uma escolha recusada avisa que NENHUMA rodada acontece",
  /nenhuma rodada/.test(api.escolhaFrase("codex", "plano", false)));
t("provedor desconhecido nao afirma quem paga",
  /não afirmo nada sobre quem paga/.test(api.escolhaFrase("gemini", "plano", false)));

t("a pendencia diz que a escolha NAO e gravada", /não é gravada/.test(api.IA_PENDENTE));
t("...diz que some num F5", /some num F5/.test(api.IA_PENDENTE));
t("...e diz que NENHUMA rodada le esta escolha hoje", /nenhuma rodada do painel lê esta escolha/.test(api.IA_PENDENTE));
t("a pendencia esta DESENHADA na tela, com o marcador", /\[ pendente \]/.test(hIa) && /não é gravada/.test(hIa));

/* ═════════════════════════════════════════════════════════════════════════
   O BLOCO QUE EXISTE POR CAUSA DE UM DEFEITO REAL. Quando `/api/integracoes`
   passou a emitir `ia`, `iaFonte` caiu no galho "veio do servidor" e `iaHtml`
   continuou desenhando a cópia local — a tela AFIRMAVA uma origem e DESENHAVA
   outra, num cartão que responde quem paga a conta de alguém. Pior que o estado
   anterior, em que a cópia existia e a tela dizia que era cópia.

   A regra que fecha isso: «diz servidor» e «desenha servidor» são A MESMA
   CONDIÇÃO, lida de um lugar só. O último caso deste bloco é o que amarra as
   duas metades — um mutante que mude só um lado tem de voltar vermelho. */
console.log("\n[ 12b ] a procedencia dos fatos de IA: dizer e desenhar sao a mesma condicao");

/* O dublê tem a forma REAL de `ia.capacidades()`, medida em
   `node -e "require('./ia.js').capacidades()"`, mais um provedor que SÓ existe
   aqui — é ele que separa "li do servidor" de "coincidiu com a cópia". */
const IA_SERVIDOR = {
  provedores: {
    claude: { rotulo: "Claude Code CLI", envBin: "CLAUDE_BIN", envChave: "ANTHROPIC_API_KEY",
      comandoLogin: ["auth", "status", "--json"], precisaShell: false, cercasQueFaltam: [], utilizavel: true },
    codex: { rotulo: "Codex CLI", envBin: "CODEX_BIN", envChave: "OPENAI_API_KEY",
      comandoLogin: ["login", "status"], precisaShell: true, cercasQueFaltam: ["negadas", "settings"], utilizavel: false },
    /* NÃO EXISTE na cópia desta página. Se ele aparecer na tela, o desenho veio
       mesmo do servidor. */
    zumbi: { rotulo: "Zumbi CLI Inventado", envBin: "ZUMBI_BIN", envChave: "ZUMBI_KEY",
      comandoLogin: ["x"], precisaShell: true, cercasQueFaltam: ["mcp"], utilizavel: false }
  },
  modos: [
    { id: "plano", rotulo: "plano (login no CLI)", usaChave: false },
    { id: "chave", rotulo: "chave de API", usaChave: true },
    /* Também só existe aqui: é o que prova que os MODOS vêm do servidor, e não
       só os provedores. Um deles bastaria para o cartão de cima parecer certo
       enquanto o de baixo continuava sendo a cópia. */
    { id: "zumbimodo", rotulo: "Modo Zumbi Inventado", usaChave: true }
  ],
  padrao: { provedor: "claude", modo: "plano" },
  tetoPromptPadrao: 24000
};

const fServ = api.iaFonte({ ia: IA_SERVIDOR });
const fSem = api.iaFonte({});
const fNulo = api.iaFonte({ ia: null });
const fRuim = api.iaFonte({ ia: 3 });

t("os QUATRO motivos sao nomes distintos",
  new Set([fServ.motivo, fSem.motivo, fNulo.motivo, fRuim.motivo]).size === 4);
t("as QUATRO frases de procedencia sao distintas",
  new Set([fServ.frase, fSem.frase, fNulo.frase, fRuim.frase]).size === 4);

/* --- `ia` presente e bem formado --- */
t("bem formado -> doServidor", fServ.doServidor === true && fServ.motivo === "servidor");
t("bem formado -> as listas vem do SERVIDOR, nao da copia",
  fServ.provedores !== api.IA_PROVEDOR && fServ.provedores.length === 3);
t("bem formado -> o padrao vem do servidor", fServ.padrao.provedor === "claude" && fServ.padrao.modo === "plano");
t("a frase diz que os cartoes sao desenhados a partir dele",
  /desenhados a partir dele/.test(fServ.frase));
t("...e a frase NAO promete que a prosa da recusa veio de la",
  /prosa que explica cada recusa continua sendo desta tela/.test(fServ.frase));

zerar({ fatos: { ia: IA_SERVIDOR } });
const hServ = api.iaHtml();
t("o provedor que SO existe no servidor aparece na tela",
  /Zumbi CLI Inventado/.test(hServ));
t("...e ele NAO esta na copia local desta pagina",
  !api.IA_PROVEDOR.some(p => p.id === "zumbi"));
t("com `ia` bem formado, a frase de transcricao NAO aparece",
  !/transcrição feita nesta página/.test(hServ) && !/transcrição desta página/.test(hServ));
t("...e a frase de procedencia do servidor aparece", /vieram do cockpit/.test(hServ));
t("os tres provedores do servidor sao desenhados",
  (hServ.match(/data-acao="ia-prov"/g) || []).length === 3);
/* Os MODOS também vêm de lá. Sem este par de casos, um mutante que trocasse só
   a lista de baixo passaria: o cartão de cima estaria certo e o de baixo seria a
   cópia — a mesma divergência silenciosa, meia tela abaixo. */
t("o modo que SO existe no servidor aparece na tela", /Modo Zumbi Inventado/.test(hServ));
t("os tres modos do servidor sao desenhados",
  (hServ.match(/data-acao="ia-modo"/g) || []).length === 3);
t("...e um modo desconhecido diz quem paga a partir do `usaChave` que veio",
  /este modo usa CHAVE DE API/.test(hServ) && /não tem prosa medida para este modo/.test(hServ));

/* O MOTIVO MEDIDO DA RECUSA DO CODEX TEM DE SOBREVIVER À TROCA DE FONTE.
   `capacidades()` não devolve essa prosa — devolve `utilizavel` e
   `cercasQueFaltam` —, então é a página que a casa com o fato. Sem isto, a
   leitura que sobra é "o cockpit não suporta Codex". */
t("com fonte no servidor, o motivo MEDIDO do codex continua na tela",
  /--setting-sources/.test(hServ) && /config\.toml/.test(hServ) && /varredura de segredo/.test(hServ));
t("um provedor desconhecido sai com motivo derivado do FATO que veio",
  /Falta equivalente para/.test(hServ) && /impedir o carregamento de servidor de MCP/.test(hServ));
t("...e ele DIZ que esta pagina nao tem prosa medida para ele",
  /não tem prosa medida para este CLI/.test(hServ));

/* O FATO VENCE A PROSA. Se o cockpit passar a dizer que o codex é utilizável, a
   prosa medida daqui vira mentira — e ela não pode sobreviver ao fato que a
   contradiz. */
const viradoCodex = JSON.parse(JSON.stringify(IA_SERVIDOR));
viradoCodex.provedores.codex.utilizavel = true;
viradoCodex.provedores.codex.cercasQueFaltam = [];
zerar({ fatos: { ia: viradoCodex } });
const hVirado = api.iaHtml();
/* MEDIDO DENTRO DO BOTAO DAQUELE PROVEDOR, nunca no HTML inteiro: o Claude
   tambem carrega `PODE RODAR`, entao um `test` sobre a pagina toda passaria com
   o codex ainda recusado. Um teste que mede demais nao mede nada. */
const botaoDe = (html, id) => {
  const i = html.indexOf('data-id="' + id + '"');
  if (i < 0) throw new Error("nao achei o botao do provedor `" + id + "` no desenho");
  const ini = html.lastIndexOf("<button", i);
  const fim = html.indexOf("</button>", i);
  if (ini < 0 || fim < 0) throw new Error("nao achei os limites do botao de `" + id + "`");
  return html.slice(ini, fim);
};
const bCodexServ = botaoDe(hServ, "codex");
const bCodexVirado = botaoDe(hVirado, "codex");
t("no dublê normal o botao do codex diz RECUSADO",
  /RECUSADO/.test(bCodexServ) && !/PODE RODAR/.test(bCodexServ));
t("servidor dizendo `utilizavel: true` VENCE a prosa medida da pagina",
  /PODE RODAR/.test(bCodexVirado) && !/RECUSADO/.test(bCodexVirado));
t("...e o botao dele deixa de vir desabilitado", !/disabled/.test(bCodexVirado));
t("...e a divergencia e DITA, em vez de silenciada",
  /está velha/.test(bCodexVirado) && /o cockpit respondeu agora/.test(bCodexVirado));
t("...e a recusa medida some junto com o fato que a sustentava",
  !/varredura de segredo/.test(hVirado));

/* --- `ia` AUSENTE --- */
t("bloco `ia` ausente -> a tela diz que esta falando por conta propria",
  fSem.doServidor === false && /transcrição feita nesta página/.test(fSem.frase));
t("...e NAO diz 'o cockpit nao sabe de IA' (o galho negativo)",
  !/não sabe/.test(fSem.frase) && /pode envelhecer/.test(fSem.frase));
t("ausente -> a saida e reabrir a janela (o processo e velho)",
  /server\.js/.test(fSem.frase) && /abra de novo/.test(fSem.frase));
t("ausente -> as listas sao a COPIA local", fSem.provedores === api.IA_PROVEDOR && fSem.modos === api.IA_MODO);
zerar({ fatos: {} });
const hSem = api.iaHtml();
t("ausente -> desenha a copia, e o codex continua com o motivo medido",
  /Codex CLI/.test(hSem) && /varredura de segredo/.test(hSem));
t("ausente -> a frase de transcricao esta na tela", /transcrição feita nesta página/.test(hSem));

/* --- `ia: null` — o TERCEIRO estado, e ele NAO e igual a ausente --- */
t("`ia: null` tem motivo proprio", fNulo.doServidor === false && fNulo.motivo === "nulo");
t("`ia: null` diz que o adaptador falhou ou nao esta la",
  /adaptador de IA falhou/.test(fNulo.frase));
t("`ia: null` NEGA explicitamente a leitura de 'o cockpit e velho'",
  /não é «o cockpit é velho»/.test(fNulo.frase) && /reabrir a janela não muda/.test(fNulo.frase));
t("`ia: null` NAO manda reabrir a janela (que e a saida do ausente)",
  !/abra de novo/.test(fNulo.frase));
t("`ia: null` e `ia` ausente sao frases DIFERENTES", fNulo.frase !== fSem.frase);
t("`ia: null` ainda desenha a partir da copia", fNulo.provedores === api.IA_PROVEDOR);
zerar({ fatos: { ia: null } });
const hNulo = api.iaHtml();
t("`ia: null` -> os cartoes continuam desenhados", /Claude Code CLI/.test(hNulo) && /Codex CLI/.test(hNulo));
t("`ia: null` -> nunca cartao vazio", !/data-acao="ia-prov"[^>]*><\/button>/.test(hNulo));

/* --- `ia` presente e MALFORMADO --- */
const malformados = [
  ["string", { ia: "capacidades" }],
  ["array", { ia: [] }],
  ["objeto sem `provedores`", { ia: { modos: [], padrao: {} } }],
  ["`provedores` vazio", { ia: { provedores: {}, modos: [{ id: "plano", usaChave: false }], padrao: { provedor: "a", modo: "b" } } }],
  ["provedor sem `utilizavel`", { ia: { provedores: { x: { rotulo: "X" } }, modos: [{ id: "p", usaChave: false }], padrao: { provedor: "x", modo: "p" } } }],
  ["`modos` que nao e lista", { ia: { provedores: { x: { rotulo: "X", utilizavel: true } }, modos: {}, padrao: { provedor: "x", modo: "p" } } }],
  ["`padrao` faltando", { ia: { provedores: { x: { rotulo: "X", utilizavel: true } }, modos: [{ id: "p", usaChave: false }] } }]
];
for (const [nome, f] of malformados) {
  const v = api.iaFonte(f);
  t("malformado (" + nome + ") cai na transcricao, com frase",
    v.doServidor === false && v.motivo === "malformado" && /não tem a forma que esta tela sabe ler/.test(v.frase));
  t("malformado (" + nome + ") NUNCA desenha vazio: as listas sao a copia",
    v.provedores === api.IA_PROVEDOR && v.modos === api.IA_MODO && !!v.padrao);
}
t("a frase de malformado NOMEIA o que estava errado, nao so 'deu erro'",
  /não é um objeto simples/.test(api.iaFonte({ ia: 3 }).frase) &&
  /não diz <code>utilizavel<\/code>/.test(api.iaFonte(malformados[4][1]).frase));
t("a frase de malformado nunca fica com o marcador MOTIVO por preencher",
  !/MOTIVO/.test(fRuim.frase));
zerar({ fatos: { ia: "capacidades" } });
t("malformado -> nada de `undefined` na tela", !/undefined/.test(api.iaHtml()));

/* ═══ O CASO QUE AMARRA AS DUAS METADES. Para CADA um dos quatro estados, a
   frase que a tela imprime e a lista que ela desenha têm de vir do MESMO
   veredito. Um mutante que troque só um dos lados volta vermelho aqui. */
const casos = [
  ["servidor", { ia: IA_SERVIDOR }, true],
  ["ausente", {}, false],
  ["nulo", { ia: null }, false],
  ["malformado", { ia: [] }, false]
];
let amarrados = 0;
for (const [nome, fatos, esperaServidor] of casos) {
  const v = api.iaFonte(fatos);
  zerar({ fatos });
  const html = api.iaHtml();
  /* «diz servidor»: a frase de procedência do veredito está no HTML. */
  const diz = html.includes(v.frase);
  /* «desenha servidor»: o provedor que só existe no dublê do servidor aparece. */
  const desenha = /Zumbi CLI Inventado/.test(html);
  /* E o teste é a EQUIVALÊNCIA, não os dois lados soltos. */
  const coerente = diz && (desenha === esperaServidor) && (v.doServidor === esperaServidor);
  t("«diz» e «desenha» sao a mesma condicao em `" + nome + "`", coerente);
  if (coerente) amarrados++;
}
t("os quatro estados passaram pela amarracao", amarrados === 4);

/* A metade que o mutante mais gosta de atacar: `iaHtml` NÃO pode ler a cópia
   direto. Medido em fonte sem comentário — o comentário que explica a regra cita
   os três nomes, e um teste que casa dentro de comentário aprova a ausência da
   decisão que ele existe para provar. */
const iaHtmlSrc = semComentario(pega("function iaHtml() {", "\n/* ---------------------------------"));
t("`iaHtml` nao le `IA_PROVEDOR` direto", !/\bIA_PROVEDOR\b/.test(iaHtmlSrc));
t("`iaHtml` nao le `IA_MODO` direto", !/\bIA_MODO\b/.test(iaHtmlSrc));
t("`iaHtml` nao le `IA_PADRAO` direto", !/\bIA_PADRAO\b/.test(iaHtmlSrc));
t("`iaHtml` chama `iaFonte` UMA vez so (duas leituras podem discordar)",
  (iaHtmlSrc.match(/iaFonte\(/g) || []).length === 1);
t("`iaHtml` desenha as listas do veredito", /fonte\.provedores/.test(iaHtmlSrc) && /fonte\.modos/.test(iaHtmlSrc));
t("`iaHtml` tira o padrao do veredito, nao da constante", /fonte\.padrao\.provedor/.test(iaHtmlSrc));

/* ═════════════════════════════════════════════════════════════════════════
   O SEGUNDO DEFEITO QUE A CHEGADA DA ROTA EXPÔS, e este era uma frase DESTA
   PÁGINA: o pé da linha do Codex dizia «não há spawn, não há detecção, não há
   variável de ambiente» — e o bloco `ia`, na mesma colheita, imprime `CODEX_BIN`
   e as cercas que faltam dez centímetros abaixo. Duas das três negações eram
   falsas, e a tela ficou com duas frases se contradizendo. */
console.log("\n[ 12c ] a linha do Codex e o cartao de IA falam do mesmo nome");

const peCodexSrc = semComentario(pega("  if (est === \"nunca\") {\n    const porque = cx", "  } else if (est === \"ok\") {"));
t("o pe da linha do Codex NAO nega mais a deteccao", !/não há detecção/.test(peCodexSrc));
t("o pe NAO nega mais a variavel de ambiente", !/não há variável de ambiente/.test(peCodexSrc));
t("...e mantem a negacao que continua VERDADEIRA (nenhuma acao abre o Codex)",
  /nenhuma ação do painel abre o Codex/.test(peCodexSrc));
t("o pe chama a reconciliacao", /codexReconciliar\(f\)/.test(peCodexSrc));

t("sem bloco `ia`, nao ha segunda voz e nao ha frase nova", api.codexReconciliar({}) === null);
t("`ia: null` tambem nao inventa a segunda voz", api.codexReconciliar({ ia: null }) === null);
const semCodex = JSON.parse(JSON.stringify(IA_SERVIDOR));
delete semCodex.provedores.codex;
t("bloco `ia` sem codex tambem nao inventa", api.codexReconciliar({ ia: semCodex }) === null);
const rec = api.codexReconciliar({ ia: IA_SERVIDOR });
t("com o par na tela, a frase existe", typeof rec === "string" && rec.length > 60);
t("...e diz que NAO e contradicao", /Não é contradição/.test(rec));
t("...e separa caminho de ACAO de regra de POLITICA",
  /caminho de ação/.test(rec) && /regra que decidiria qual CLI rodar/.test(rec));
t("...e o verbo sai do FATO que veio (recusa), nao de uma constante",
  /<b>recusa<\/b>/.test(rec) && /<b>aceita<\/b>/.test(api.codexReconciliar({ ia: viradoCodex })));

/* ═════════════════════════════════════════════════════════════════════════
   O AVISO DA FORMA DA CHAVE GUARDADA NO COFRE.

   Existe porque `cofre-test.js` carrega um alarme: enquanto nenhuma tela lesse
   `forma`, o aviso "isso não tem cara de chave do n8n" não existiria — existiria
   a INTENÇÃO dele, que é a mesma doença do `escreveNoM8n`… do `escreveNoN8n`,
   um contrato morto que carregou uma afirmação falsa por muito tempo porque
   ninguém lia o campo.

   O ALARME É UM `/forma/.test(html)`, frouxo de propósito. Escrever a palavra em
   qualquer lugar o deixaria verde — e ISSO seria o teste cego que este
   repositório cataloga. Os casos abaixo medem a DECISÃO, não a presença da
   palavra: o mutante que troca a frase por uma que ACUSA a chave de errada tem
   de voltar vermelho. */
console.log("\n[ 12d ] a forma do que esta guardado no cofre");

const comCofre = (forma, temChave) => ({ n8n: { cofre: Object.assign(
  { disponivel: true, porque: null, temChave: temChave !== false, onde: "C:\\x\\cofre.bin", abriu: true, erro: null },
  forma === undefined ? {} : { forma }) } });

t("a lista fechada e a do modulo: `jwt` e `estranha`, e nada mais",
  api.FORMA_CONHECIDA.length === 2 &&
  api.FORMA_CONHECIDA.includes("jwt") && api.FORMA_CONHECIDA.includes("estranha"));

/* --- forma estranha COM chave: o aviso existe --- */
const avEstranha = api.avisoFormaChave(comCofre("estranha"));
t("forma estranha com chave -> ha aviso", !!avEstranha);
t("...e ele e do tipo `alerta`, nunca `erro`", avEstranha.tipo === "alerta");
t("...e a frase RELATA o observado", /não tem cara de chave do n8n/.test(avEstranha.texto));
/* O CASO QUE CARREGA O BLOCO: a frase NÃO pode acusar a chave de errada. Uma
   chave que o n8n aceita e que não parece um JWT continua sendo a chave dela, e
   acusar quem está certo é como se ensina alguém a ignorar avisos. */
t("...e ele NEGA explicitamente que a chave esteja errada",
  /não quer dizer que ela está errada/.test(avEstranha.texto));
t("...e diz que quem decide se a chave vale e o n8n, nao esta tela",
  /quem decide se a chave vale é o n8n/.test(avEstranha.texto));
t("...e diz que NADA foi recusado nem bloqueado",
  /Nada foi recusado e nada foi bloqueado/.test(avEstranha.texto) && /o cofre guardou/.test(avEstranha.texto));
t("...e NAO usa vocabulario de recusa/invalidez",
  !/inválida|invalida|recusad[ao] a chave|chave errada|troque a chave/i.test(avEstranha.texto));
t("...e oferece o engano provavel sem afirmar que foi ele",
  /Vale conferir/.test(avEstranha.texto) && /endereço da instância/.test(avEstranha.texto));

/* --- ele chega DESENHADO, e ancorado na linha da chave --- */
zerar({ fase: "pronto", fatos: comCofre("estranha") });
const linha = api.pareamentoHtml; /* só para o linter não reclamar do escopo */
const hLinha = (function () {
  /* `linhaN8n` + `linhaHtml` são o par que ancora o aviso. Extraídos e dirigidos
     aqui, porque é o desenho que prova a ancoragem — o descritor sozinho provaria
     só que a frase existe. */
  const fonteLinha = pega("function linhaN8n(f) {", "\nfunction linhaClaude(f)")
    + pega("function linhaHtml(L) {", "\nfunction esqueletoHtml");
  /* UMA fatia só, da primeira constante de juízo até `linhaN8n` — `avisoFormaChave`
     está dentro dela, então `formaChave` NÃO entra de novo aqui: duas cópias do
     mesmo `const` no mesmo corpo são um SyntaxError, e o erro apontaria para o
     teste em vez de para a página. */
  const extra = pega("const ESTADO = {", "function linhaN8n(f) {");
  const num = v => Number(v).toLocaleString("pt-BR");
  const dur = ms => (typeof ms !== "number" ? "—" : ms + " ms");
  const quando = () => null;
  return new Function("esc", "num", "dur", "quando",
    glifos + avisos + extra + fonteLinha +
    "; return f => linhaHtml(linhaN8n(f));")(esc, num, dur, quando);
})();

const desenhoEstranha = hLinha(comCofre("estranha"));
t("o aviso chega DESENHADO na linha da chave", /class="linha-aviso"/.test(desenhoEstranha));
t("...com a classe do tipo `alerta`", /<div class="aviso alerta"/.test(desenhoEstranha));
t("...e ANCORADO, nunca na pilha flutuante do canto", !/class="avisos"/.test(desenhoEstranha));
t("...e com o glifo do vocabulario, escondido do leitor de tela",
  /<span class="ai" aria-hidden="true">!<\/span>/.test(desenhoEstranha));

/* --- forma reconhecida: SEM aviso --- */
t("forma `jwt` -> nenhum aviso", api.avisoFormaChave(comCofre("jwt")) === null);
t("...e nada desenhado", !/class="linha-aviso"/.test(hLinha(comCofre("jwt"))));

/* --- forma AUSENTE: o terceiro estado, e nesta fatia e o caso COMUM --- */
t("`forma` ausente -> nenhum aviso (nao sei nao e forma estranha)",
  api.avisoFormaChave(comCofre(undefined)) === null);
t("...e nada desenhado", !/class="linha-aviso"/.test(hLinha(comCofre(undefined))));
t("`forma` que nao e string tambem nao vira aviso",
  api.avisoFormaChave(comCofre(3)) === null && api.avisoFormaChave(comCofre("")) === null);

/* --- sem chave no cofre: `forma` nao descreve nada --- */
t("sem chave no cofre -> nenhum aviso, mesmo com forma estranha",
  api.avisoFormaChave(comCofre("estranha", false)) === null);
t("...e nada desenhado", !/class="linha-aviso"/.test(hLinha(comCofre("estranha", false))));
t("sem bloco do cofre -> nenhum aviso", api.avisoFormaChave({ n8n: {} }) === null &&
  api.avisoFormaChave({}) === null && api.avisoFormaChave(null) === null);
t("bloco do cofre que nao e objeto -> nenhum aviso",
  api.avisoFormaChave({ n8n: { cofre: "sim" } }) === null);

/* --- palavra presente que esta tela nao conhece --- */
const avDesconhecida = api.avisoFormaChave(comCofre("hexadecimal"));
t("forma desconhecida tem saida propria, nao a do `estranha`",
  !!avDesconhecida && avDesconhecida.texto !== avEstranha.texto);
t("...e ela e `info`, nao `alerta`: e sobre o vocabulario, nao sobre a chave",
  avDesconhecida.tipo === "info");
t("...e NAO afirma nada sobre a chave",
  !/não tem cara de chave/.test(avDesconhecida.texto) &&
  /não digo nada sobre a chave/i.test(avDesconhecida.texto));
t("...e nomeia a palavra que veio", /hexadecimal/.test(avDesconhecida.texto));
t("as tres saidas com aviso sao distintas entre si",
  new Set([avEstranha.texto, avDesconhecida.texto]).size === 2 &&
  avEstranha.titulo !== avDesconhecida.titulo);

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 13 ] achei a maquina — o interativo, e ele e honesto");

t("as tres frases de busca sao distintas", new Set(Object.values(api.BUSCA)).size === 3);
t("procurando NAO promete achar uma maquina: ele diz o que esta em voo",
  /está em voo/.test(api.BUSCA.procurando));
t("achei diz que o agente e quem serve esta pagina", /serve esta página/.test(api.BUSCA.achei));
t("falhou culpa o cockpit, nunca a configuracao dela",
  /defeito do cockpit/.test(api.BUSCA.falhou) && /não da sua configuração/.test(api.BUSCA.falhou));
t("falhou avisa que NENHUMA frase abaixo diz 'nao pareado'",
  /nenhuma frase abaixo diz que você não está pareado/.test(api.BUSCA.falhou));

zerar({ parBuscando: true });
t("buscando -> `procurando`", api.buscaFase(S) === "procurando");
zerar({ parErro: "falhou" });
t("erro -> `falhou`, mesmo sem `par`", api.buscaFase(S) === "falhou");
zerar({ par: PAREADO });
t("resposta -> `achei`", api.buscaFase(S) === "achei");
zerar({ par: PAREADO, parErro: "algo", parBuscando: false });
t("erro vence resposta velha: a tela nao diz 'respondeu' quando falhou", api.buscaFase(S) === "falhou");

zerar({ parBuscando: true });
t("enquanto procura, o trilho de tres segmentos esta na tela", /class="rail"/.test(api.pareamentoHtml()));
zerar({ par: PAREADO });
t("depois de responder, o trilho sai (movimento sem informacao atras e ruido)",
  !/class="rail"/.test(api.pareamentoHtml()));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 14 ] o rodape parou de mentir");

const vTxt = api.VERDADE.map(v => v.html).join(" ");
t("o rodape NAO diz mais que esta tela nao escreve NADA", !/<b>Nada\.<\/b>/.test(vTxt));
t("ele nomeia o que a tela escreve agora", /pareamento\.json/.test(vTxt) && /chave do agente/.test(vTxt));
t("...e diz que no n8n continua nao escrevendo nada", /No n8n, nada/.test(vTxt));
t("...e diz que so escreve DEPOIS do codigo", /depois de você digitar o código/.test(vTxt));
t("o rodape separa pareamento de login", /nunca quem senta nesta cadeira/.test(vTxt));
t("`Conferir de novo` continua declarado como quem nao escreve", /continuam não escrevendo nada/.test(vTxt));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 15 ] a fiacao — medida em fonte SEM comentario");

const desenhoCode = semComentario(desenho);
const juizoCode = semComentario(juizo);
const paginaCode = semComentario(h);

/* O caso que carrega o arquivo: NENHUM caminho desta tela le um `codigo` que
   tenha vindo de uma resposta. `S.codigo` e o que a PESSOA digitou; qualquer
   `r.codigo`, `corpo.codigo` ou `d.codigo` seria a tela tentando mostrar o que
   a rota nao devolve — e no dia em que alguem "consertasse" a rota para
   devolver, a confirmacao humana viraria enfeite sem ninguem notar. */
const lidosCodigo = (paginaCode.match(/[A-Za-z_$][\w$]*\.codigo\b/g) || [])
  .filter(x => x !== "S.codigo");
t("nada nesta pagina le um `codigo` vindo de resposta", lidosCodigo.length === 0);
t("o que a pagina ENVIA e o que a pessoa digitou", /codigo:\s*S\.codigo/.test(paginaCode));

t("`pareamentoHtml` decide a variante pelo juizo, nao por conta propria",
  /variantePar\(d\)/.test(desenhoCode) && /PAR_CONTROLE\[v\]/.test(desenhoCode));
t("`pareamentoHtml` desenha a frase vinda de `PAR_FRASE`", /PAR_FRASE\[v\]\(d\)/.test(desenhoCode));
t("o desenho nao inventa etiqueta: ela vem de `PAR_TAG`", /PAR_TAG\[v\]/.test(desenhoCode));
t("nenhuma cor nova entra: as classes continuam ok/warn/risk/cold",
  VARIANTES.every(v => ["ok", "warn", "risk", "cold"].includes(api.PAR_TAG[v].cls)));

/* `desparear` REPETE o `naoRevoga` que voltou do modulo, e nao uma copia. Uma
   segunda definicao daquela frase divergiria na primeira correcao de um lado. */
/* Um F5 no meio da cerimonia nao pode perder o que o agente sabe. `iniciar`
   devolve `tentativas` e `estado` devolve `tentativasRestantes` — o mesmo fato
   com dois nomes. Sem a traducao, a tela cairia no ramo honesto "nao sei" com o
   numero vindo do agente na mao. */
t("a cerimonia adotada do `estado` traduz `tentativasRestantes` -> `tentativas`",
  /veio\.tentativasRestantes === "number"[\s\S]{0,60}veio\.tentativas = veio\.tentativasRestantes/.test(paginaCode));
t("...e a adocao acontece so quando a cerimonia NAO expirou", /!d\.desafio\.expirado/.test(paginaCode));

t("`desparear` usa o `naoRevoga` da resposta", /r\.naoRevoga/.test(paginaCode));
t("...e, sem ele, diz que nao inventa a ressalva", /não invento a ressalva/.test(h));

/* RECORTE EXATO, e ele foi pago: a primeira versao destes dois casos usou
   `[\s\S]*?render\(\)` a partir do nome da funcao, e o `*?` atravessa o fim dela
   e acha um `render()` la adiante — o teste reprovava um codigo correto. Um
   teste que mede alem do alvo nao mede o alvo. */
const trecho = (de, ate) => {
  const i = paginaCode.indexOf(de);
  if (i < 0) throw new Error("nao achei `" + de + "` no fonte sem comentario");
  const j = paginaCode.indexOf(ate, i + de.length);
  if (j < 0) throw new Error("nao achei o fim do trecho que comeca em `" + de + "`");
  return paginaCode.slice(i, j);
};

/* O ticker toca UM texto. Repintar a tela a cada segundo apagaria o codigo
   sendo digitado — e este arquivo inteiro existe para isso nao acontecer. */
const tickSrc = trecho("function ligarTicker()", "let acoesLigadas");
t("o ticker do prazo toca o texto do prazo", /par-resta/.test(tickSrc) && /textContent/.test(tickSrc));
t("o ticker do prazo NAO chama `render`", !/render\(\)/.test(tickSrc));
t("o campo de digitar sobrevive ao repaint", /capturarCampos\(\)/.test(paginaCode) && /restaurarCampos\(vivos\)/.test(paginaCode));
const inputSrc = trecho('document.addEventListener("input"', 'document.addEventListener("change"');
t("digitar guarda o texto", /S\.pacote = ev\.target\.value/.test(inputSrc) && /S\.codigo = ev\.target\.value/.test(inputSrc));
t("digitar no campo NAO repinta a tela a cada tecla", !/render\(\)/.test(inputSrc));

/* Nada de dialogo nativo, em lugar nenhum desta pagina. */
t("nenhum alert/confirm/prompt nativo", !/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(paginaCode));

/* Toda rota que a tela chama tem de existir no `server.js` — a mesma disciplina
   do `nav-sync-test.js` conferindo cada `href` da capsula. Um 404 no meio da
   cerimonia seria lido como recusa do agente. */
const servidor = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const rotas = [...new Set((paginaCode.match(/"\/api\/[a-z/]+"/g) || []).map(x => x.slice(1, -1)))];
t("a tela chama pelo menos as quatro rotas do pareamento",
  ["/api/pareamento", "/api/pareamento/iniciar", "/api/pareamento/confirmar", "/api/pareamento/cancelar"]
    .every(r => rotas.includes(r)));
for (const r of rotas) t("a rota " + r + " existe no server.js", servidor.includes('"' + r + '"'));

/* ═════════════════════════════════════════════════════════════════════════ */
console.log("\n[ 16 ] acessibilidade e vocabulario");

zerar({ par: { estado: "nao-pareado" }, abrindoPacote: true });
const hAbr = api.pareamentoHtml();
t("o campo do pacote tem nome acessivel fixo", /aria-label="o pacote de pareamento/.test(hAbr));
t("o botao de comecar nasce desabilitado com o campo vazio", /data-acao="par-iniciar" disabled/.test(hAbr));
zerar({ par: { estado: "nao-pareado" }, abrindoPacote: true, pacote: '{"dono":"abc12345","origens":["https://a.b"],"iss":"https://c.d/x","jwks":"https://c.d/y"}' });
t("...e habilita quando a forma esta certa", !/data-acao="par-iniciar" disabled/.test(api.pareamentoHtml()));
t("a tela diz que ate ali nada foi gravado", /até aqui nada foi gravado/.test(api.pareamentoHtml()));

zerar({ par: { estado: "nao-pareado" }, cerim: { desafio: "d", expiraEm: Date.now() + 9000, tentativas: 5 } });
t("o campo do codigo tem nome acessivel", /aria-label="o código que apareceu no console do agente"/.test(api.pareamentoHtml()));
t("os grupos de escolha de IA sao anunciados", /role="group" aria-label="qual CLI/.test(hIa) && /role="group" aria-label="de quem é a conta/.test(hIa));
t("as opcoes de IA sao botoes com aria-pressed", /<button type="button" class="op"[^>]*aria-pressed=/.test(hIa));
t("nenhum emoji nos controles novos (o BRIEF mede que eles saem como caixa vazia)",
  !/[\u{1F300}-\u{1FAFF}]/u.test(desenho));

console.log("\n" + ok + " ok, " + bad + " falha(s)\n");
process.exit(bad ? 1 : 0);
