"use strict";
/* conversas.js — o histórico das conversas do `/upgrade`, em disco.
 *
 * O QUE ISTO CONSERTA. Até aqui uma conversa do upgrade vivia só no `sessoes`
 * (um Map em memória do `upgrade.js`) e morria com o processo — junto com o
 * `s.custo`, que é o único lugar onde o gasto daquela aba existia. Uma conversa
 * de 4 rodadas custou minutos e cota, ninguém registrou nada, e um F5 depois de
 * o cockpit fechar perdia a conversa inteira. Este arquivo é o disco.
 *
 * FATOS, como o resto do servidor. Aqui não se decide se uma conversa está
 * "esperando você" nem em que ordem ela aparece: isto grava, lê, apaga e conta.
 * Todo juízo mora no bloco no topo do `upgrade.html`.
 *
 * ══════════════════════ DOIS ARQUIVOS, E A DIVISÃO É DE PROPÓSITO ═══════════
 *
 * 1. `conversas/<wfId>/<convId>.json` — GITIGNORED. Carrega o `chat` inteiro, o
 *    alvo e os RESUMOS da evidência. O resumo de uma leitura de execução é
 *    recorte de conversa de cliente ainda que mascarado, e o título nasce do que
 *    o Kauan escreveu — ele escreve *"a Ana foi chamada de outro nome"*.
 *    Nada disso entra em git. Mesma razão do `.upgrade-runs/`.
 *
 * 2. `conversas.json` — RASTREADO, uma linha por conversa, SEM TÍTULO E SEM
 *    TEXTO. Se o custo morasse no arquivo de conteúdo ele sumiria na primeira
 *    limpeza de cache, que é exatamente o argumento que o `dossies.json` já
 *    ganhou. Então o gasto mora aqui, e para poder morar em git esta linha não
 *    carrega uma letra do que foi conversado — só contagens, ids e dólares.
 *    `conversas-test.js` afirma isso contra telefone, e-mail e nome de lead.
 *
 * O PAYLOAD NÃO ESTÁ EM NENHUM DOS DOIS. Ele fica em
 * `.upgrade-runs/<sessao>/evidencia/`, que é scratch descartável: o resumo
 * sobrevive, o arquivo pode não estar mais lá, e a tela tem de poder dizer isso
 * em vez de mostrar um link que não abre.
 *
 * O `sessionId` do CLI NÃO É PERSISTIDO, e isso é decisão medida: `upgrade.js`
 * reata a sessão com `--resume <sessionId>`, e um id morto faz o spawn falhar.
 * Reabrir uma conversa devolve o `chat` para a memória e a próxima rodada é
 * sessão NOVA, com o histórico indo pelo prompt (`ultimasAteCaber`, que já
 * existe). Custa prompt maior; é o preço, e ele é menor que um spawn que morre.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const RAIZ = path.join(__dirname, "conversas");
const LEDGER = path.join(__dirname, "conversas.json");

const WF_RE = /^[A-Za-z0-9_-]{1,64}$/;
/* Mesma forma que o `server.js` já exige do id de sessão. O id da conversa É o
   id da sessão que a criou — é o que faz `?c=` reatar sem inventar um segundo
   espaço de nomes. */
const CONV_RE = /^u[a-z0-9]{1,32}$/;
const LIXO_RE = /^u[a-z0-9]{1,32}__[0-9]{14}$/;

/* Teto do título. MEDIDO, não escolhido: os títulos reais de uma semana de
 * conversas (os do mockup aprovado) dão 32, 44, 44, 45, 53 e 55 caracteres, e a
 * linha da gaveta é `-webkit-line-clamp: 2` a 12,5px numa coluna de ~344px, o
 * que comporta ~96 caracteres em duas linhas.
 *
 * 90 é isso com folga, e o número é 90 e não 120 por uma razão que é a única
 * vantagem da gaveta sobre as outras duas opções de desenho: nela **o título não
 * trunca**. Um teto acima do que a caixa mostra faria o `…` aparecer no fim da
 * segunda linha, e a alternativa — `title=` — está proibida nesta tela: tooltip é
 * hover, e o borrão do modo gravação nunca abre no hover, então um tooltip que
 * revela o que o borrão esconde não protege nada. Cortado é cortado, e o corte
 * tem de caber. */
const TITULO_MAX = 90;

const carimbo = d => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

/* Todo caminho sai daqui. O `wfId` vem da URL e o `convId` de um corpo de POST;
   as duas regex acima já os prendem, e este é o segundo cinto — duas camadas
   independentes, como `nomeSeguro`/`dentro()` no `anexos.js`. */
function dentro(dir, p) {
  const r = path.resolve(dir, p);
  if (r !== path.resolve(dir) && !r.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error("caminho fora do diretório permitido");
  }
  return r;
}

const pastaDo = wfId => {
  if (!WF_RE.test(String(wfId || ""))) { const e = new Error("wfId inválido"); e.status = 400; throw e; }
  return dentro(RAIZ, String(wfId));
};
const lixeiraDo = wfId => path.join(pastaDo(wfId), ".lixeira");

/* ────────────────────────────────────────────────────────────── o título ──── */

/* O título é a PRIMEIRA MENSAGEM DELE, cortada. Sem chamada de modelo: ela
 * custaria uma rodada por conversa para nomear o que ele mesmo acabou de
 * escrever, e o que ele escreveu é o que ele reconhece na lista.
 *
 * Ele carrega a classe `sens` na tela, porque pode ter nome de lead dentro — e
 * no modo gravação ele borra. O corte é em fronteira de palavra: cortar
 * "Ana" no meio ("a An…") não protege nada e piora a leitura.
 *
 * O espaço em branco é colapsado porque a mensagem vem de um `<textarea>`: um
 * Enter no meio viraria quebra de linha dentro de um rótulo de uma-ou-duas
 * linhas, e a caixa passaria a mostrar meia frase. */
function titulo(texto) {
  const t = String(texto == null ? "" : texto).replace(/\s+/g, " ").trim();
  if (t.length <= TITULO_MAX) return t;
  const corte = t.slice(0, TITULO_MAX);
  const esp = corte.lastIndexOf(" ");
  return (esp > TITULO_MAX * 0.6 ? corte.slice(0, esp) : corte).replace(/[\s,;:.\-]+$/, "") + "…";
}

const tituloDoChat = chat => {
  const m = (chat || []).find(x => x && x.de === "eu");
  return m ? titulo(m.texto) : "";
};

/* ───────────────────────────────────────────── o que vai para o arquivo ───── */

/* O documento gravado. Lista EXPLÍCITA de campos, nunca um spread da sessão: a
 * sessão carrega `filho` (um ChildProcess), `nomes` (um Set), `log` e o
 * `sessionId`, e um `JSON.stringify` do objeto inteiro gravaria os dois últimos
 * — o `sessionId` é justamente o que não pode ser persistido. Campo que não está
 * nomeado aqui não existe em disco.
 *
 * O `log` fica FORA de propósito: ele é o terminal de uma rodada, não a
 * conversa. Ele morre com o processo, e a tela diz que uma conversa reaberta não
 * tem o log da rodada anterior em vez de mostrar um painel vazio. */
function documento(s) {
  return {
    convId: String(s.id),
    wfId: String(s.wfId),
    wfNome: String(s.wfNome || ""),
    titulo: tituloDoChat(s.chat),
    criadaEm: s.comecouEm || new Date().toISOString(),
    tocadaEm: new Date().toISOString(),
    /* O `updatedAt` do fluxo QUANDO A CONVERSA NASCEU. É o que permite a tela
       dizer "este fluxo mudou depois desta conversa": um alvo decidido na segunda
       contra um fluxo de quinta pode apontar para um nó que não existe mais.
       Guardar o `updatedAt` na hora de salvar guardaria outra coisa — o de agora
       — e a comparação nunca acusaria nada. */
    wfUpdatedAt: s.updatedAt || null,
    nos: s.nos || 0,
    status: String(s.status || ""),
    erro: s.erro || null,
    modelo: s.modelo || null,
    chat: (s.chat || []).map(m => ({
      de: m.de, tipo: m.tipo || null, texto: m.texto == null ? null : String(m.texto),
      perguntas: Array.isArray(m.perguntas) ? m.perguntas.map(String) : null,
      base: Array.isArray(m.base) ? m.base.map(String) : null,
      procedencia: m.procedencia || null,
      em: m.em || null
    })),
    alvo: s.alvo || null,
    /* Só o RESUMO da evidência, e o nome do arquivo — nunca o recorte. O arquivo
       vive em `.upgrade-runs/`, que é scratch: ele pode não existir mais quando
       esta conversa for reaberta, e a tela diz isso. */
    evidencias: (s.evidencias || []).map(e => ({
      arquivo: e.arquivo || null,
      oque: (e.pedido && e.pedido.oque) || e.oque || null,
      resumo: String(e.resumo || "")
    })),
    /* `porque` OU `motivo`: `rodar()` no `upgrade.js` grava o campo com o nome
       `motivo`, e ler só um dos dois perderia a explicação da rodada cega — que é
       a única coisa que impede o "não medido" da tela de virar um zero calado. */
    custo: (s.custo || []).map(c => ({
      usd: typeof c.usd === "number" ? c.usd : 0,
      usdDesconhecido: !!c.usdDesconhecido,
      porque: c.porque || c.motivo || null,
      ms: typeof c.ms === "number" ? c.ms : null
    }))
  };
}

/* ─────────────────────────────────────────── o gasto, somado de um só jeito ── */

/* A MESMA conta do `gastoAte()` do `upgrade.js`, e ela vive nos dois lugares por
 * uma razão: aquele soma uma sessão viva, este soma um arquivo lido do disco. O
 * teste afirma que os dois dão o mesmo número sobre a mesma lista de rodadas —
 * duas contas de dinheiro que divergem seriam pior que uma conta que falta.
 *
 * Rodada cega (o `result` do CLI nunca chegou, porque o processo morreu no meio)
 * é cobrada pela MÉDIA das medidas. É palpite DECLARADO, e ele vence um zero
 * silencioso: somar zero afirma que a rodada foi de graça quando ela pode ter
 * sido a mais cara da conversa. */
function gasto(custo) {
  const lista = Array.isArray(custo) ? custo : [];
  const medidas = lista.filter(c => !c.usdDesconhecido).map(c => Number(c.usd) || 0);
  const media = medidas.length ? medidas.reduce((a, b) => a + b, 0) / medidas.length : 0;
  const cegas = lista.filter(c => c.usdDesconhecido).length;
  return {
    usd: medidas.reduce((a, b) => a + b, 0) + cegas * media,
    cegas, estimado: cegas > 0
  };
}

/* ────────────────────────────── a rodada que o cockpit fechou por cima ────── */

/* O OITAVO ESTADO, e ele existe por omissão, que é o tipo mais difícil de ver.
 *
 * `total_cost_usd` chega no evento `result`, que é a ÚLTIMA linha do CLI. Se o
 * cockpit foi fechado no meio de uma rodada, o processo morreu antes daquela
 * linha e nenhuma entrada de custo foi escrita — a rodada não entra como zero,
 * ela simplesmente NÃO EXISTE. Para o `conversas.json`, que é rastreado, isso é
 * pior que um zero: o arquivo afirma um total por baixo do que foi gasto e ninguém
 * tem como saber que faltou algo. É a mesma família do `usd: 0` de rodada morta,
 * com o agravante de ser silêncio em vez de número errado.
 *
 * Então reabrir uma conversa que ficou em `correndo` acrescenta uma rodada CEGA:
 * `gasto()` a cobra pela média das medidas e devolve `estimado: true`, e a tela
 * mostra "não medido" em vez de um total limpo que mente.
 *
 * Ela também troca o status para `interrompida`, e isso é o que torna a operação
 * IDEMPOTENTE: reabrir a mesma conversa duas vezes não pode acrescentar duas
 * rodadas cegas para uma rodada que morreu uma vez. Puro de propósito — o teste
 * afirma isso sem spawnar nada. */
const PORQUE_INTERROMPIDA = "o cockpit fechou no meio desta rodada — o custo dela nunca chegou";

function interrompida(d) {
  if (!d || d.status !== "correndo") return d;
  return Object.assign({}, d, {
    status: "interrompida",
    custo: (d.custo || []).concat([{ usd: 0, usdDesconhecido: true, porque: PORQUE_INTERROMPIDA, ms: null }])
  });
}

/* ─────────────────────────────────────────────────────── a forma da lista ──── */

/* O que a gaveta recebe por conversa. FATO: contagens, carimbos, ids. Qual é o
 * estado que "pede ação", a ordem, e o que a frase diz é `upgrade.html`.
 *
 * `ultima` é a última mensagem em texto, e é o campo que faz a linha rica da
 * gaveta valer a pena — é ele que responde "qual conversa é essa" quando o
 * título não basta. Ele é cortado aqui porque a linha mostra duas linhas de
 * texto: mandar 3500 caracteres para desenhar ~110 seria pagar o snapshot inteiro
 * por conversa. */
const ULTIMA_MAX = 240;

function fatos(d, rodando) {
  const g = gasto(d.custo);
  const ult = (d.chat || []).length ? d.chat[d.chat.length - 1] : null;
  return {
    id: d.convId,
    titulo: d.titulo || "",
    status: d.status || "",
    /* VIVA = existe uma sessão NESTE processo RODANDO esta conversa agora. As
       duas metades são necessárias, e a segunda foi a que quase passou batido:
       uma sessão que está no `sessoes` com `status: "aguardando"` está presente e
       não está rodando, então "presente no Map" teria trocado uma mentira por
       outra. Quem passa o conjunto é o `upgrade.js`, e ele passa só os que estão
       correndo — o Map é dele.
       É o fato que permite à tela distinguir "correndo agora" de "o cockpit
       fechou no meio de uma rodada": sem ele um arquivo gravado no instante em
       que o processo morreu diria "correndo agora" para sempre, com nada
       rodando, que é a mentira mais cara que esta lista pode contar. */
    viva: !!rodando,
    criadaEm: d.criadaEm || null,
    em: d.tocadaEm || d.criadaEm || null,
    wfUpdatedAt: d.wfUpdatedAt || null,
    evidencias: (d.evidencias || []).length,
    alvo: d.alvo ? (d.status === "confirmado" ? "confirmado" : "proposto") : null,
    alvoNos: d.alvo && Array.isArray(d.alvo.nos) ? d.alvo.nos.length : 0,
    rodadas: (d.custo || []).length,
    usd: +g.usd.toFixed(4),
    usdDesconhecido: g.estimado,
    ultima: ult && ult.texto ? String(ult.texto).replace(/\s+/g, " ").trim().slice(0, ULTIMA_MAX) : null,
    ultimaDe: ult ? ult.de : null
  };
}

/* ──────────────────────────────────────────────────────────── ler e gravar ── */

async function gravarAtomico(alvo, obj) {
  const tmp = alvo + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fsp.rename(tmp, alvo);
}

/* Salvar a cada transição de estado, não no fim. Uma conversa "termina" na hora
 * em que o processo morre, e não existe um momento em que se saiba que é a
 * última — gravar só no fim é o mesmo que não gravar. É I/O local, de graça
 * contra os minutos de uma rodada. */
async function salvar(s) {
  if (!s || !s.id || !s.wfId) return null;
  /* Conversa sem uma mensagem dele não tem título, e uma linha sem título na
     gaveta é uma linha sem identidade. Sessão criada e mensagem que falhou no
     POST não deve deixar fantasma na lista. */
  if (!(s.chat || []).length) return null;
  if (!CONV_RE.test(String(s.id))) { const e = new Error("id de conversa inválido"); e.status = 400; throw e; }

  const d = documento(s);
  const pasta = pastaDo(s.wfId);
  await fsp.mkdir(pasta, { recursive: true });
  await gravarAtomico(dentro(pasta, d.convId + ".json"), d);
  await anotar(linhaLedger(d));
  return d;
}

async function ler(wfId, convId) {
  if (!WF_RE.test(String(wfId || "")) || !CONV_RE.test(String(convId || ""))) return null;
  try { return JSON.parse(await fsp.readFile(dentro(pastaDo(wfId), convId + ".json"), "utf8")); }
  catch { return null; }
}

/* A lista de um fluxo. Devolve TRÊS coisas porque são três situações com três
 * decisões diferentes, e a que mais importa é a do meio:
 *
 *   - `conversas: []` com `erro: null` → nunca houve conversa neste fluxo;
 *   - `erro` preenchido → NÃO SEI o que existe. A tela nunca pode dizer "nenhuma
 *     conversa ainda" aqui: seria afirmar ausência a partir de uma falha de
 *     leitura, que é o defeito que este repositório já pagou três vezes;
 *   - `ilegiveis: n` → existem N arquivos que eu não consegui abrir. Sumir com
 *     eles em silêncio esconderia uma conversa que custou dinheiro.
 *
 * `rodando` é o conjunto de ids que estão CORRENDO neste processo agora — não os
 * que existem no Map. Quem passa é o `upgrade.js`, porque o Map é dele; ver a
 * nota do campo `viva` em `fatos()`. */
async function listar(wfId, rodando) {
  const corre = id => !!(rodando && (rodando.has ? rodando.has(id) : rodando[id]));
  /* A validação do `wfId` fica FORA do `try`: um id fora de forma é um 400, não um
     "não consegui ler o histórico". Deixá-lo cair no `catch` daria à tela a frase
     de falha de leitura para um problema que é do endereço — duas causas com uma
     frase, que é o defeito que este arquivo inteiro tenta não cometer. */
  const pasta = pastaDo(wfId);
  let arquivos;
  try { arquivos = await fsp.readdir(pasta); }
  catch (e) {
    if (e && e.code === "ENOENT") return { conversas: [], ilegiveis: 0, erro: null };
    return { conversas: [], ilegiveis: 0, erro: String(e && e.message || e).slice(0, 200) };
  }
  const conversas = [];
  let ilegiveis = 0;
  for (const f of arquivos) {
    if (!f.endsWith(".json") || f.endsWith(".tmp")) continue;
    try {
      const d = JSON.parse(await fsp.readFile(dentro(pastaDo(wfId), f), "utf8"));
      if (!d || !d.convId) { ilegiveis++; continue; }
      conversas.push(fatos(d, corre(d.convId)));
    } catch { ilegiveis++; }
  }
  return { conversas, ilegiveis, erro: null };
}

/* ────────────────────────────────────────────────── apagada, ou nunca houve ── */

/* Três respostas, e nenhuma pode ler como as outras. Um `?c=` de uma conversa
 * apagada e um `?c=` inventado levam a frases diferentes: uma diz o que
 * aconteceu com o que ele tinha, a outra diz que o endereço não vale. */
async function estado(wfId, convId) {
  if (!WF_RE.test(String(wfId || "")) || !CONV_RE.test(String(convId || ""))) {
    return { estado: "invalida", apagadaEm: null };
  }
  if (fs.existsSync(dentro(pastaDo(wfId), convId + ".json"))) return { estado: "viva", apagadaEm: null };
  const lixos = await naLixeira(wfId, convId);
  if (lixos.length) return { estado: "apagada", apagadaEm: lixos[0].apagadaEm, lixo: lixos[0].lixo };
  return { estado: "inexistente", apagadaEm: null };
}

async function naLixeira(wfId, convId) {
  let arquivos = [];
  try { arquivos = await fsp.readdir(lixeiraDo(wfId)); } catch { return []; }
  const out = [];
  for (const f of arquivos) {
    if (!f.endsWith(".json")) continue;
    const lixo = f.replace(/\.json$/, "");
    if (!LIXO_RE.test(lixo)) continue;
    if (convId && !lixo.startsWith(convId + "__")) continue;
    let d = null;
    try { d = JSON.parse(await fsp.readFile(dentro(lixeiraDo(wfId), f), "utf8")); } catch { /* segue */ }
    out.push({
      lixo, convId: (d && d.convId) || lixo.split("__")[0],
      titulo: (d && d.titulo) || "",
      apagadaEm: (d && d.apagadaEm) || null,
      rodadas: (d && d.custo || []).length,
      usd: d ? +gasto(d.custo).usd.toFixed(4) : 0
    });
  }
  // Mais recente primeiro: o carimbo do nome ordena sozinho, e ele é a fonte que
  // não depende de o arquivo ter sido lido com sucesso.
  return out.sort((a, b) => String(b.lixo).localeCompare(String(a.lixo)));
}

/* Apagar MOVE. Era a mesma lição que custou dois projetos do Tester: `unlink` num
 * arquivo que nunca foi comitado é definitivo, e aqui é pior — `conversas/` é
 * gitignored, então NENHUMA conversa está em git e o `git checkout` não existe
 * como saída para nenhuma delas.
 *
 * O nome carrega CARIMBO DE TEMPO porque apagar duas conversas do mesmo fluxo é
 * normal, e sem ele a segunda sobrescreveria a primeira — apagando calado
 * exatamente o que a lixeira existe para não apagar. O carimbo tem resolução de
 * segundo, então duas exclusões no mesmo segundo colidiriam; o `while` abaixo
 * empurra para o segundo seguinte em vez de sobrescrever. */
async function apagar(wfId, convId) {
  if (!CONV_RE.test(String(convId || ""))) { const e = new Error("id de conversa inválido"); e.status = 400; throw e; }
  const origem = dentro(pastaDo(wfId), convId + ".json");
  let d;
  try { d = JSON.parse(await fsp.readFile(origem, "utf8")); }
  catch { const e = new Error("não achei essa conversa"); e.status = 404; throw e; }

  await fsp.mkdir(lixeiraDo(wfId), { recursive: true });
  const agora = new Date();
  let lixo = convId + "__" + carimbo(agora);
  for (let k = 1; fs.existsSync(dentro(lixeiraDo(wfId), lixo + ".json")); k++) {
    if (k > 60) { const e = new Error("não consegui achar um nome livre na lixeira"); e.status = 409; throw e; }
    lixo = convId + "__" + carimbo(new Date(agora.getTime() + k * 1000));
  }
  d.apagadaEm = agora.toISOString();

  // Escreve o destino ANTES de remover a origem: se a escrita falhar, a conversa
  // continua onde estava. A ordem inversa a perderia num disco cheio.
  await gravarAtomico(dentro(lixeiraDo(wfId), lixo + ".json"), d);
  await fsp.unlink(origem);
  return { apagada: convId, lixo };
}

/* Voltar da lixeira. NÃO renomeia, e isso é o contrário do que a lixeira do
 * Tester faz: lá o slug é derivado do título e pode ser reocupado; aqui o
 * `convId` É O ENDEREÇO (`?c=`), então restaurar sob outro nome quebraria o link
 * que alguém guardou. Se o id estiver ocupado, a resposta é uma frase, não uma
 * renomeação silenciosa. */
async function restaurar(wfId, lixo) {
  if (!LIXO_RE.test(String(lixo || ""))) { const e = new Error("identificador inválido"); e.status = 400; throw e; }
  const origem = dentro(lixeiraDo(wfId), lixo + ".json");
  let d;
  try { d = JSON.parse(await fsp.readFile(origem, "utf8")); }
  catch { const e = new Error("não achei esse item na lixeira"); e.status = 404; throw e; }

  const convId = d.convId || String(lixo).split("__")[0];
  const alvo = dentro(pastaDo(wfId), convId + ".json");
  if (fs.existsSync(alvo)) {
    const e = new Error("já existe uma conversa com esse id — a de agora não pode ser trocada pela apagada");
    e.status = 409; throw e;
  }
  delete d.apagadaEm;
  d.restauradaEm = new Date().toISOString();
  await fsp.mkdir(pastaDo(wfId), { recursive: true });
  await gravarAtomico(alvo, d);
  await fsp.unlink(origem);
  return { convId, titulo: d.titulo || "" };
}

/* ──────────────────────────────────────────────────────────────── o ledger ── */

/* A LINHA QUE VAI PARA O GIT. Oito campos, e a ausência dos outros é o ponto:
 * nem `titulo`, nem `ultima`, nem `chat`, nem `wfNome`, nem resumo de evidência.
 * `conversas.json` é rastreado, e um título carrega nome de lead — este arquivo
 * é o primeiro deste projeto que teria vontade de carregar dado de cliente para
 * dentro do histórico do git, e ele não vai.
 *
 * Escrita como função PURA para poder ser afirmada num teste sem tocar disco:
 * `conversas-test.js` serializa a saída dela e varre por telefone, e-mail e nome
 * de lead. Um campo novo aqui é um campo que aquele teste vê. */
function linhaLedger(d) {
  const g = gasto(d.custo);
  return {
    wfId: String(d.wfId),
    convId: String(d.convId),
    em: d.tocadaEm || d.criadaEm || new Date().toISOString(),
    rodadas: (d.custo || []).length,
    // Quantas voltas de evidência a conversa deu. É o que separa uma conversa que
    // olhou execução de uma que respondeu por leitura de código.
    pedidos: (d.evidencias || []).length,
    usd: +g.usd.toFixed(4),
    usdDesconhecido: g.estimado,
    teveAlvo: !!d.alvo
  };
}

async function lerLedger() {
  try {
    const j = JSON.parse(await fsp.readFile(LEDGER, "utf8"));
    return Array.isArray(j.conversas) ? j.conversas : [];
  } catch { return []; }
}

/* UPSERT por `convId`, não append. Uma conversa é salva a cada transição de
 * estado, então um append daria uma linha por rodada e o ledger contaria a mesma
 * conversa cinco vezes — o total de gasto viraria ficção. "Uma linha por
 * conversa" é o contrato. */
async function anotar(linha) {
  const lista = await lerLedger();
  const i = lista.findIndex(x => x && x.convId === linha.convId);
  if (i >= 0) lista[i] = linha; else lista.push(linha);
  await gravarAtomico(LEDGER, { savedAt: new Date().toISOString(), conversas: lista });
  return linha;
}

module.exports = {
  salvar, ler, listar, estado, apagar, restaurar, naLixeira,
  lerLedger, anotar,
  // puros, exportados para teste: nada aqui toca disco
  titulo, tituloDoChat, documento, fatos, gasto, linhaLedger, interrompida,
  TITULO_MAX, ULTIMA_MAX, PORQUE_INTERROMPIDA, RAIZ, LEDGER, CONV_RE, LIXO_RE
};
