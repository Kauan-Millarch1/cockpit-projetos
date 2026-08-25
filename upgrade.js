"use strict";
/* upgrade.js — a conversa sobre um fluxo que já existe.
 *
 * A terceira máquina de sessão deste projeto, e ela é deliberadamente a menor.
 * `claude-fix.js` conserta o que quebrou (o alvo vem da assinatura de erro) e
 * `tester.js` cria do zero (não há alvo). Aqui o fluxo existe, funciona, e o que
 * falta é descobrir ONDE mexer a partir de uma frase em português.
 *
 * FATOS, como o resto do servidor. Esta máquina não decide se um upgrade é bom:
 * ela conduz a conversa, aplica o contrato e emite eventos. Todo juízo mora no
 * bloco no topo do `upgrade.html`.
 *
 * A CONVERSA NÃO ESCREVE; O §5/§6 ESCREVE — E SÃO COISAS DIFERENTES. Até o §4
 * este arquivo era absoluto: nenhuma chamada de escrita, nem importada. Isso
 * deixou de ser verdade, e o que sobrou dele é a parte que importava. Conduzir a
 * conversa e resolver o alvo (`mensagem`, `conduzir`, `umaRodada`, `resolverAlvo`,
 * §4.5) continua sem efeito nenhum fora do processo, e o patch é aplicado a uma
 * CÓPIA EM MEMÓRIA só para poder virar diff. Do bloco §5/§6 para baixo saem TRÊS
 * escritas diretas, de dois tipos que não podem ser confundidos:
 *
 *   - `checagem7` grava a cópia INATIVA `[SANDBOX upgrade]` — `putWorkflow` se ela
 *     já existe, `createWorkflow` na primeira vez. Documento descartável, sem
 *     credencial, que não executa, e cujo único trabalho é o n8n dizer se aceita o
 *     schema. É a única escrita que acontece ANTES de ele aprovar (a bateria roda
 *     no §4, para montar o remendo), e é por isso que ela tem chave para desligar;
 *   - `desfazer` restaura um backup literal com `putWorkflow`. Fica fora da
 *     sequência de propósito: não há patch para reaplicar nem portão para rodar;
 *   - `aplicar` escreve NO FLUXO VIVO, e é a única coisa aqui que exige esse
 *     cuidado — e ele **não chama `putWorkflow`**. Passa por
 *     `fix.escreverAprovado`, a sequência única, cuja ORDEM é a garantia: re-busca,
 *     recusa por `updatedAt`, portões (a bateria de sete, injetada como
 *     `revalidar`), backup, e só então o `PUT`, que nunca é repetido.
 *
 * `upgrade-test.js` afirma isso em vez de confiar: conta as escritas diretas por
 * regex — então uma quarta colada por descuido chega vermelha, com o número — e
 * afirma que dentro de `aplicar` não existe nenhum `n8n.putWorkflow` solto.
 *
 * A CERCA da sessão são as flags, não a lista de ferramentas. Medido neste repo:
 * `--allowedTools` AUTORIZA, não restringe — uma sessão iniciada só com ele
 * executou shell. Quem nega é `--disallowedTools`. E sem `--setting-sources ""`
 * a sessão carrega o CLAUDE.md global, que nesta máquina tem a chave do n8n em
 * texto puro. As duas linhas não são opcionais.
 *
 * A sessão NUNCA vê credencial: o `fluxo.json` que vai para o diretório passa por
 * `sanitizedWorkflow` + `redactWorkflow` do `claude-fix.js`, os mesmos que a
 * correção já usa.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

const n8n = require("./n8n.js");
const fix = require("./claude-fix.js");
/* QUAL IA roda a rodada, e COM QUAL CREDENCIAL. Ele monta os argumentos — com as
   três cercas como DADO numa tabela em vez de um array escrito à mão aqui — e o
   ambiente do filho, em cima da allowlist do `ambiente.js`, que continua sendo a
   fonte e que este arquivo deixou de ler direto. */
const ia = require("./ia.js");
const dossie = require("./dossie.js");
const evidencia = require("./evidencia.js");
const conversas = require("./conversas.js");
/* §4.3 — o portão do `[PREENCHER]`. Fica em módulo próprio porque ele é a única
   peça desta aba que julga o CONTEÚDO do patch, e porque a calibração dele foi
   medida contra 3.649 nós de produção: misturá-la aqui esconderia o número. */
const preencher = require("./preencher.js");
/* O que ela anexa à conversa: print, PDF, .md, planilha, pasta inteira. É o
   MESMO módulo do Tester, sem uma linha reimplementada — ele já é dono dos
   guardas de caminho, da whitelist, dos tetos, da recusa de segredo com
   instrução e do scrub de texto. Aqui ele não é reescrito, é usado. */
const anexos = require("./anexos.js");

/* ─────────────────────────────────────────────────────────── configuração ── */

const RAIZ = path.join(__dirname, ".upgrade-runs");
const CLAUDE_BIN = fix.claudeBin;

/* QUAL IA roda a rodada, e de quem é a conta. Hoje é o PADRÃO DECLARADO do
   adaptador — `claude` + `plano`: o mesmo CLI e o mesmo login OAuth de sempre,
   com a chave de API AUSENTE do ambiente do filho. Nada muda no comportamento de
   hoje; a diferença só aparece no dia em que a pessoa escolher o modo `chave`. */
/* A escolha de IA da rodada. FUNÇÃO, e não constante de módulo, e essa é a
   correção de um defeito armado — não de estilo.
 *
 * Era `const escolhaDaRodada() = ia.escolher({})`, resolvida UMA VEZ no `require`. Como
 * o padrão é `plano`, isso significa que a escolha de credencial de toda rodada
 * de todo mundo é decidida no instante em que o processo sobe, antes de existir
 * qualquer pessoa para escolher. Hoje o comportamento é o certo — é um dono, na
 * máquina dele, gastando o plano dele — então nada muda agora, e há teste
 * aferindo que os argumentos e o ambiente saem idênticos.
 *
 * O que muda é que ela deixa de ser IMPOSSÍVEL de variar. Uma escolha congelada
 * no `require` não consegue seguir uma decisão por rodada, por pessoa ou por
 * conta, e o sintoma disso não é um erro: é a conta de outra pessoa sendo
 * gastada em silêncio, que é exatamente o que trocar o plano por chave de API
 * existe para evitar.
 *
 * É a TERCEIRA ocorrência desta família num dia: `n8n.js` congelava `configured`
 * e `instance` (o cofre nunca chegaria ao cabeçalho), `claude-fix.js` congelava
 * uma cópia de `n8n.configured`, e esta. O padrão é sempre o mesmo — um valor
 * lido no `require` para responder uma pergunta cuja resposta muda depois.
 *
 * `chave` continua NÃO sendo passada a `ambienteDaRodada`, e isso é deliberado
 * enquanto o modo é `plano`: no modo plano a variável de chave tem de estar
 * AUSENTE do ambiente, nunca vazia. Quando a escolha vier da pessoa, é aqui que
 * ela entra — num sítio só, por arquivo, auditável. */
function escolhaDaRodada() {
  return ia.escolher({});
}

const MODELO = process.env.COCKPIT_UPGRADE_MODELO || "sonnet";

/* O TETO DE UMA RODADA SÃO DOIS NÚMEROS, e a razão de serem dois é que os dois
 * defeitos que eles pegam são diferentes — um relógio de parede só sabia pegar um.
 *
 * Aqui havia um número só, 180000, com um comentário afirmando que "a conversa lê
 * um índice e responde uma frase, então isso é leitura curta". Esse número nunca
 * foi medido e a frase que o justificava era falsa. Medido em 2026-08-20,
 * reproduzindo a rodada que morreu de verdade (pedido: *tirar todo o ClickUp do
 * Agente Iago Comercial*, 189 nós, `fluxo.json` de 364KB), com o MESMO prompt e o
 * MESMO modelo:
 *
 *   | esforço do CLI     | parede    | US$    | nós certos no alvo |
 *   |--------------------|-----------|--------|--------------------|
 *   | padrão (sem flag)  | 250.461ms | 1,0418 | 5 de 7             |
 *   | `--effort medium`  | 167.671ms | 0,9096 | 6 de 7             |
 *   | `--effort low`     |  90.986ms | 0,7331 | 6 de 7             |
 *
 * Ou seja: a sessão NÃO tinha travado. Ela estava trabalhando e foi morta 70
 * segundos antes de responder, e o Kauan pagou a rodada inteira para ver
 * "tempo esgotado nesta rodada (180s)" na tela. Um teto de parede não consegue
 * distinguir "está pensando há três minutos" de "morreu e não avisa".
 *
 * O que distingue é MEDIDO e vem de graça no stdout: o CLI emite
 * `{"type":"system","subtype":"thinking_tokens"}` a cada poucos segundos ENQUANTO
 * pensa. Nas três rodadas completas medidas acima o maior silêncio real do stdout
 * foi de **14,2s** (e o arranque, até o `system/init`, 10,8s). Então:
 *
 *   - `SILENCIO_MS` (90s) é o detector de TRAVA. Seis vezes o pior silêncio
 *     medido, e ele pega uma sessão morta em 90s em vez de esperar o teto inteiro.
 *   - `RODADA_MS` (600s) é o teto DURO, para a sessão que continua dando sinal e
 *     não termina nunca. 2,4× a pior rodada medida (250s).
 *
 * As duas mortes têm frases diferentes (`fraseMorte`), porque "travou" e "demorou
 * demais" mandam procurar coisas diferentes. */
const RODADA_MS = Number(process.env.COCKPIT_UPGRADE_TIMEOUT_MS || 600000);
const SILENCIO_MS = Number(process.env.COCKPIT_UPGRADE_SILENCIO_MS || 90000);

/* Por que a rodada morreu, em UMA frase por motivo, e elas têm de ser distintas.
 * Mesma disciplina do `autoDossie()` e das quatro frases da banda do dossiê: duas
 * mortes com a mesma frase ensinam a ignorar as duas. `travou` manda olhar se o
 * CLI está vivo; `teto` manda estreitar o pedido. Pura de propósito — o teste
 * afirma que as frases são diferentes sem spawnar nada. */
function fraseMorte(motivo, ms) {
  const s = Math.round((ms || 0) / 1000);
  if (motivo === "travou") {
    return "a sessão parou de dar qualquer sinal por " + Math.round(SILENCIO_MS / 1000)
      + "s e foi morta como travada (ela estava rodando há " + s + "s) — nada foi escrito no n8n";
  }
  return "a rodada passou do teto de " + Math.round(RODADA_MS / 1000)
    + "s e foi morta (" + s + "s) — ela continuava dando sinal, então o pedido é grande demais para uma"
    + " rodada só: peça uma parte de cada vez. Nada foi escrito no n8n";
}

/* O ESFORÇO DE RACIOCÍNIO DO CLI, e ele é decidido por TIPO DE RODADA porque só
 * um dos dois tipos foi medido.
 *
 * A tabela acima mede a rodada de CONVERSA (entender o pedido e apontar o alvo):
 * `low` responde em 91s contra 250s do padrão, custa 30% menos, e devolveu 6 dos 7
 * nós que de fato citam ClickUp — um a MAIS que o padrão devolveu. Velocidade que
 * não foi comprada com resposta pior, então `low` é o padrão da conversa.
 *
 * A rodada do PATCH não foi medida, e ela é a que escreve num fluxo de produção.
 * Baixar o esforço dela por analogia seria mudar o caminho mais perigoso do
 * arquivo com base numa medição de outro caminho — então ela fica EXATAMENTE como
 * estava: sem flag nenhuma, o padrão do CLI. Quando alguém medir, muda aqui.
 *
 * Um valor não reconhecido no ambiente cai no padrão daquele tipo de rodada e o
 * valor cru viaja em `capacidades()` para a tela poder dizer que foi ignorado —
 * passá-lo adiante mataria o spawn com um erro do commander que não nomeia nem a
 * variável nem o valor. */
const ESFORCOS = ["low", "medium", "high", "xhigh", "max"];
const ESFORCO_CONVERSA_PADRAO = "low";
const ESFORCO_PATCH_PADRAO = null;          // null = sem flag, o padrão do CLI

function esforcoDaRodada(ehPatch, env) {
  const e = env || process.env;
  const cru = ehPatch ? e.COCKPIT_UPGRADE_ESFORCO_PATCH : e.COCKPIT_UPGRADE_ESFORCO;
  const padrao = ehPatch ? ESFORCO_PATCH_PADRAO : ESFORCO_CONVERSA_PADRAO;
  if (cru == null || cru === "") return padrao;
  if (cru === "padrao") return null;        // "use o padrão do CLI", dito de propósito
  return ESFORCOS.includes(cru) ? cru : padrao;
}

/* O teto do `texto` de uma resposta, e ele foi MEDIDO antes de ser escolhido.
 *
 * Era 2000, e uma resposta de investigação foi recusada por tamanho: a sessão
 * gastou uma rodada inteira reescrevendo o que já estava certo — pagando de novo
 * o mesmo raciocínio para caber. Medidas que decidiram o número:
 *
 *   - as cinco respostas reais do teste de conversa deram 988, 988, 1063, 1248 e
 *     1307 caracteres. 2000 é pouca folga sobre 1307;
 *   - com `execIds` (várias execuções num pedido) uma resposta passa a poder
 *     relatar até 4 execuções. Medido na resposta que já cobria três, a densidade
 *     é ~435 caracteres por execução; 4 × 435 mais um parágrafo de causa do
 *     tamanho medido de uma resposta inteira (988) dá ~2730;
 *   - 3500 é isso com ~20% de folga.
 *
 * E o teto NÃO é de graça, o que é a outra metade da medição: `ORC_CONVERSA` tem
 * de carregar CINCO mensagens deste tamanho, senão um teto que cabe numa resposta
 * estoura a conversa. A pior janela de cinco é 3×3500 dela + 2×2000 dele (o teto
 * da mensagem em `mensagem()`) = 14500 — que é de onde vem o `ORC_CONVERSA`
 * abaixo. Medido no `prompt-budget-test.js`. */
const TEXTO_MAX = 3500;

/* Quantas mensagens da conversa entram no prompt. O prompt viaja em `-p` e a
 * linha de comando do Windows morre em 32767 caracteres com `spawn
 * ENAMETOOLONG`, que não nomeia nem o prompt nem o tamanho. As mais ANTIGAS são
 * as que caem: a última mensagem é a decisão em vigor. Quando cai algo, o prompt
 * DIZ que caiu — um modelo que não sabe que perdeu contexto repete pergunta já
 * respondida, que é exatamente o defeito que a conversa existe para evitar.
 *
 * 15000 é a pior janela de cinco mensagens no teto novo (14500, ver `TEXTO_MAX`)
 * com folga. Medido: o pior prompt inteiro fica em ~16,4KB contra `PROMPT_MAX`
 * 24000 e 32767 na linha de comando — a conversa nunca foi o que aperta aqui. */
const ORC_CONVERSA = 15000;
const PROMPT_MAX = 24000;

/* Quanto de UMA mensagem entra no prompt. É o mesmo número do `TEXTO_MAX` de
 * propósito: com um corte menor que o teto, uma resposta longa dela seria
 * truncada na rodada seguinte SEM NINGUÉM DIZER — e um modelo que não sabe o que
 * perdeu reafirma o que já tinha corrigido. Com os dois iguais, o corte só pode
 * acontecer se alguém subir um teto e esquecer o outro, e aí ele se anuncia. */
const MSG_SLICE = TEXTO_MAX;

/* ORÇAMENTO PRÓPRIO DO ÍNDICE DE ANEXOS, e ele é obrigatório e não zelo.
 *
 * O bloco que `anexos.trechoPrompt()` devolve tem duas partes: uma prosa fixa
 * (~1,3KB) e DUAS listas que crescem com o que ela arrastou. A dos arquivos
 * soltos tem teto lá dentro (`ORC_ANEXOS`, 1800, e ela diz quando corta) — a das
 * PASTAS não tem: 40 arquivos vindos de 40 raízes de nome longo somam ~4,8KB sem
 * nenhum limite. Medido aqui, o pior prompt desta aba já ficava em ~16,4KB contra
 * `PROMPT_MAX` 24000, então a folga é ~7,6KB e não cabe um bloco sem teto.
 *
 * 3000 é isso com folga sobre o pior caso real (40 anexos de nome longo, ver
 * `prompt-budget-test.js`), e o corte SE ANUNCIA apontando o arquivo onde a lista
 * completa está. Uma sessão que não sabe que perdeu contexto pergunta o que o
 * anexo já respondia — que é exatamente o defeito que anexar existe para evitar. */
const ORC_ANEXOS = 3000;

function trechoAnexos(s) {
  const t = anexos.trechoPrompt((s && s.anexos) || []);
  if (t.length <= ORC_ANEXOS) return t;
  return t.slice(0, ORC_ANEXOS)
    + "\n\n«cortado aqui: mais " + (t.length - ORC_ANEXOS) + " caracteres desta lista não couberam no prompt. "
    + "A lista COMPLETA está em `anexos/INDICE.md` — leia esse arquivo antes de concluir que algo não veio.»";
}

const NEGADAS = "Bash,PowerShell,BashOutput,KillShell,Task,Agent,NotebookEdit,SlashCommand,WebFetch,WebSearch";

/* AS FERRAMENTAS DA RODADA, e a diferença em relação ao Tester é medida, não
 * preferência.
 *
 * O Tester concede `Glob`/`Grep` só quando há anexo, porque a base da entrevista
 * dele é `Read` e uma conversa sem material nenhum não tem o que procurar no
 * disco. Aqui `Grep` é BASE e não pode sair: `REGRAS.md` manda a sessão não ler o
 * `fluxo.json` inteiro e usar `Grep` para achar o nó (o maior fluxo desta
 * instância tem 285KB — lê-lo todo gasta o contexto que devia ir para a decisão).
 * Tirar `Grep` daqui removeria algo que ela precisa, o que seria pior que a cópia.
 *
 * `Glob` é o que a regra de fato alcança: com cinco arquivos conhecidos no
 * diretório ele não serve para nada, e com uma pasta de 200 arquivos ele é —
 * junto com o `Grep` — o que separa EXPLORAR de DESPEJAR. Então ele entra só
 * quando existe anexo.
 *
 * A cerca que importa continua sendo `--disallowedTools` (`NEGADAS`) e
 * `--setting-sources ""`: `--allowedTools` é lista de auto-aprovação, medido neste
 * repositório, e não restringe nada. `Write`/`Edit` ficam sempre, porque a sessão
 * escreve `resposta.json`. */
function ferramentasDaRodada(s) {
  const base = "Read,Write,Edit,Grep";
  return ((s && s.anexos) || []).length ? base + ",Glob" : base;
}

/* Ambiente por ALLOWLIST, não por remoção: `ANTHROPIC_API_KEY` e os interruptores
 * de Bedrock/Vertex ficam AUSENTES em vez de apagados. Uma variável que não
 * existe não precisa ser lembrada, e o custo continua saindo do plano.
 *
 * A lista continua morando no `ambiente.js`; quem monta em cima dela agora é o
 * `ia.js`, que é o único ponto do repositório autorizado a acrescentar uma chave
 * de API a um ambiente headless — e só faz isso no modo `chave`, para o provedor
 * que a pessoa escolheu, numa linha.
 *
 * O CARIMBO continua sendo desta aba porque ele identifica QUEM spawnou: um
 * carimbo único faria as três abas virarem uma só no que quer que leia o campo. */
const CARIMBO_IA = "cockpit-upgrade";

/* ────────────────────────────────────────────────────────────── as sessões ── */

const sessoes = new Map();
const ouvintes = new Map();   // id -> Set<res>
let ativa = null;             // uma por vez: cada uma spawna um CLI e gasta cota

const novoId = () => "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* A geração é o que faz "digitar durante a rodada" funcionar sem corromper
 * estado: mensagem nova incrementa `gen`, e tudo que a rodada velha ainda fosse
 * emitir cai no chão. Mesmo mecanismo do Tester, e a mesma razão para ele existir:
 * matar o filho não é instantâneo. */
const vivo = (s, gen) => s && s.gen === gen && s.status !== "cancelada";

function emit(s, tipo, dados) {
  const set = ouvintes.get(s.id);
  if (!set) return;
  const linha = "event: " + tipo + "\ndata: " + JSON.stringify(dados) + "\n\n";
  for (const res of set) { try { res.write(linha); } catch { /* fechou */ } }
}

function diz(s, texto, nivel) {
  const l = { em: new Date().toISOString(), texto: String(texto).slice(0, 400), nivel: nivel || "info" };
  s.log.push(l);
  if (s.log.length > 300) s.log.shift();
  emit(s, "log", l);
}

function atividade(s, texto) {
  s.atividade = String(texto).slice(0, 160);
  emit(s, "atividade", { atividade: s.atividade });
}

/* ─────────────────────────────────────────── gravar a conversa em disco ───── */

/* Chamado em TODA transição de estado, nunca "no fim". Uma conversa não tem fim:
 * ela para de existir quando o processo morre, e não há um instante em que se
 * saiba que aquele foi o último — gravar só no fim é o mesmo que não gravar. É
 * I/O local, de graça contra os minutos de uma rodada.
 *
 * Falhar aqui NÃO derruba a conversa: o disco é memória, não requisito. O caminho
 * sem ele é o que funcionava antes desta fatia. Mas a falha é DITA no log — um
 * histórico que parou de gravar em silêncio é indistinguível de um fluxo que
 * nunca teve conversa, e essa é a distinção que a gaveta existe para não errar. */
function guardar(s) {
  conversas.salvar(s).catch(e => {
    diz(s, "não consegui gravar esta conversa em disco (" + String(e && e.message || e).slice(0, 140)
      + ") — ela continua na memória, mas um F5 depois de fechar o cockpit vai perdê-la", "warn");
  });
}

/* ─────────────────────────────────────────────── o diretório da sessão ───── */

/* O que a sessão vê. Três arquivos, e o `fluxo.json` é o único grande — por isso
 * ele vai para DISCO e não para o prompt. O índice é 22× menor que o documento
 * (13KB contra 285KB medidos no Iago), e é ele que responde "onde mexer". */
/* O `REGRAS.md` é REESCRITO sempre que o inventário do diretório muda, e não uma
 * vez na abertura. `prepararDir` roda ANTES de a bandeja ser adotada — é ele que
 * cria o diretório onde o `rename` vai cair — então um arquivo escrito só ali
 * nunca poderia mencionar o anexo, que é exatamente o defeito medido. Os quatro
 * momentos em que o inventário muda são: preparar o diretório, adotar a bandeja,
 * anexar no meio da conversa e desanexar. Desanexar entra pelo mesmo motivo que os
 * outros três e por um a mais: a lista pode voltar a ZERO, e aí a frase das
 * ferramentas tem de deixar de prometer `Glob`.
 *
 * Custa um `writeFile` local de ~15KB, num caminho que já escreve 175KB de
 * `fluxo.json` — grátis perto do que uma rodada custa. */
async function escreverRegras(s) {
  await fsp.writeFile(path.join(s.dir, "REGRAS.md"),
    regras(s.dossie, ((s && s.anexos) || []).length > 0), "utf8");
}

async function prepararDir(s, raw) {
  await fsp.mkdir(s.dir, { recursive: true });

  const limpo = fix.redactWorkflow(fix.sanitizedWorkflow(raw));
  await fsp.writeFile(path.join(s.dir, "fluxo.json"), JSON.stringify(limpo, null, 2), "utf8");
  await fsp.writeFile(path.join(s.dir, "nodes-index.md"), fix.nodesIndex(limpo, null), "utf8");

  /* O DOSSIÊ, quando existe e está utilizável. Vai para DISCO, não para o prompt:
   * medido, o do `Agente Iago Comercial` tem 56KB e `PROMPT_MAX` aqui é 24000
   * caracteres — inline ele mataria o spawn com `ENAMETOOLONG`, que não nomeia
   * nem o prompt nem o tamanho. Mesma lição que `escreverContexto()` do Tester já
   * pagou.
   *
   * Quem decide se ele serve é `dossie.paraPrompt`, num lugar só: verde vai
   * inteiro, laranja vai com os parágrafos suspeitos marcados, e vermelho/cinza
   * NÃO vão — ali a sessão cai no `nodes-index.md`, porque pagar a leitura cara é
   * melhor que remendar a partir de descrição errada. */
  s.dossie = null;
  try {
    const doc = await dossie.ler(s.wfId);
    const p = dossie.paraPrompt(doc, raw);
    s.dossie = { cor: p.estado.cor, motivo: p.estado.motivo, usa: p.usa, mudados: p.estado.mudados.length };
    if (p.usa) {
      await fsp.writeFile(path.join(s.dir, "DOSSIE.md"), p.texto, "utf8");
      s.dossie.bytes = p.texto.length;
      diz(s, "dossiê " + p.estado.cor + " na pasta da sessão — " + (p.texto.length / 1024).toFixed(0)
        + "KB de prosa em vez de " + (JSON.stringify(limpo).length / 1024).toFixed(0) + "KB de JSON", "info");
    } else {
      diz(s, "sem dossiê utilizável (" + p.estado.cor + ": " + p.estado.motivo
        + ") — a sessão vai ler o fluxo pelo índice", "warn");
    }
  } catch (e) {
    /* Falha aqui NÃO derruba a conversa: o dossiê é atalho, não requisito. O
       caminho sem ele é o que funcionava antes desta fatia. */
    diz(s, "não consegui ler o dossiê (" + String(e && e.message || e).slice(0, 120) + ") — seguindo pelo índice", "warn");
  }

  await escreverRegras(s);

  // Prova, não promessa: nenhum `credentials` no que foi escrito.
  const escrito = await fsp.readFile(path.join(s.dir, "fluxo.json"), "utf8");
  if (/"credentials"/.test(escrito)) {
    throw new Error("ABORTADO: `credentials` apareceu no fluxo.json da sessão — o saneamento falhou");
  }
  s.credenciaisNoDir = 0;
}

const REGRAS_MOLDE = `# O que você está fazendo

Este é o painel de um fluxo do n8n que **já existe e funciona**. O Kauan quer que
ele passe a fazer mais uma coisa. Você **não** está criando um fluxo, e **não**
está consertando um erro.

## Ferramentas

{{FERRAMENTAS}} Não tem Bash e não tem rede —
isso é a cerca, não esquecimento. Todas as chamadas ao n8n são feitas pelo
cockpit; você nunca vê a chave da API e nunca vê credencial nenhuma.

## Os arquivos aqui

{{ARQUIVOS}}

## O que você escreve

Um arquivo, \`resposta.json\`, com **uma** de quatro formas. As três primeiras valem
o tempo todo; a quarta só quando o cockpit te pedir o patch, depois de o Kauan
confirmar o alvo.

**1. Quando o pedido é claro o suficiente para você dizer onde mexer:**

\`\`\`json
{
  "tipo": "alvo",
  "resumo": "uma frase dizendo o que vai mudar, em português",
  "nos": [
    { "nome": "nome exato de nodes-index.md", "oque": "o que muda nele", "novo": false },
    { "nome": "nome_do_no_novo", "oque": "o que ele faz", "novo": true, "tipoNo": "n8n-nodes-base.slack" }
  ],
  "nota": "opcional: algo que você quer que ele saiba antes de confirmar"
}
\`\`\`

**2. Quando falta informação, quando o pedido é ambíguo, ou quando ele te fez uma
pergunta:**

\`\`\`json
{
  "tipo": "resposta",
  "texto": "sua resposta ou sua pergunta, em português",
  "base": ["evidencia/1-saida.json"],
  "perguntas": ["até 3 perguntas curtas, se houver"]
}
\`\`\`

### \`base\` é obrigatório, e é o campo mais importante desta forma

Ele diz **em que a sua resposta se apoia**. É uma lista, e cada item é um destes:

| valor | o que significa |
|---|---|
| \`"dossie"\` | você leu o \`DOSSIE.md\`. **Prosa escrita por um modelo**, não medida — não prova comportamento nenhum |
| \`"fluxo"\` | você leu o \`fluxo.json\`. É o documento real, mas é **código**, não execução |
| \`"indice"\` | você leu o \`nodes-index.md\` |
| \`"evidencia/2-saida.json"\` | você leu **este arquivo**, que o cockpit buscou no n8n nesta conversa |

Duas regras, e as duas são recusa se quebradas:

- **Só vale citar arquivo que existe nesta sessão.** Se você citar um \`evidencia/…\`
  que não está lá, a resposta volta recusada dizendo quais existem.
- **Afirmação sobre o que ACONTECE numa execução exige um arquivo de \`evidencia/\`.**
  Frases como *"nenhuma execução passa por esse nó"* ou *"essa cadeia nunca
  executa"* são afirmações sobre o mundo. O \`fluxo.json\` mostra que o ramo existe;
  ele não mostra que ninguém passa por lá. E o dossiê é um modelo escrevendo sobre
  o fluxo: sustentar comportamento nele é um modelo citando outro modelo. Se a
  pergunta é de comportamento e você ainda não abriu execução, o certo é
  \`tipo: "pedido"\` primeiro — não responder com a ressalva.

Pode citar mais de um: \`"base": ["dossie", "evidencia/1-execucoes.json"]\`.

**3. Quando você precisa OLHAR ALGO NO N8N que não está nesta pasta:**

\`\`\`json
{
  "tipo": "pedido",
  "porque": "uma frase dizendo o que você quer descobrir com isso",
  "pedido": { "oque": "saida", "execId": "194351", "nos": ["api_get_evento_detalhe"] }
}
\`\`\`

Você **não tem rede e não tem shell** — isso é a cerca, não esquecimento. Quem
fala com o n8n é o cockpit. Você pede, o arquivo aparece em \`evidencia/\`, e a
rodada roda de novo com ele lá. Os quatro pedidos possíveis:

| \`oque\` | campos | o que volta |
|---|---|---|
| \`execucoes\` | \`wfId\`, \`status\`, \`limite\`, \`contem\`, \`comNos\`, \`desde\`, \`ate\`, \`cursor\`, \`frouxo\` | a lista de execuções. Com \`contem\`, ele ABRE cada uma e devolve as que têm aquele texto na saída de algum nó — a retenção inteira, não só as recentes. Com \`comNos: true\`, cada linha vem com os NOMES dos nós que rodaram nela |
| \`saida\` | \`execId\` **ou** \`execIds\` (até 4), \`nos\` (até 12 nomes) | o que cada nó produziu naquela execução, com os valores, mais de quem cada um recebeu. Com \`execIds\` o resultado vem chaveado por execução, cada uma com o seu \`naoRodaram\` |
| \`grafo\` | \`wfId\` | os nós e as arestas de OUTRO fluxo — é como você segue uma tool ou um sub-workflow |
| \`fluxos\` | — | id e nome de todos os fluxos, para achar o id de um sub-fluxo pelo nome |

### Qual dos dois: \`contem\` ou \`comNos\`

Os dois abrem execução (é o que custa), e servem para perguntas diferentes:

- **\`comNos\`** responde *"qual execução vale abrir"*. Use quando o que você
  procura é um CAMINHO: se o ramo do cache rodou, se o nó de áudio rodou, se
  aquela tool foi chamada. Ele lista os nós que rodaram, e um nó que não está na
  lista não rodou naquela execução — que costuma ser a própria resposta. Abre até
  6 execuções, porque cada linha carrega a lista inteira de nomes.
- **\`contem\`** responde *"em quais execuções saiu ESTE valor"*. Use quando você
  já sabe o texto que procura: \`R$0,00\`, uma mensagem de erro, um id, **um telefone
  ou um e-mail**. Ele varre FUNDO — tudo o que a instância guarda (medido: 1941
  execuções, ~15 dias) — e devolve só as que casaram.

### Sim, você PODE buscar por telefone e por e-mail

Isto mudou. A evidência sai mascarada (\`5521 ***** 0000\`, \`k****@dominio\`), então
antes buscar pelo número cru não casava nunca — e a conclusão certa era desistir.
**Agora o cockpit mascara a AGULHA também**: você cola o número como quiser
(\`5521999990000\`, \`+55 21 99999-0000\`, \`(21) 99999-0000\`) e ele procura a forma
mascarada. Os dois lados falam a mesma língua.

O que a resposta te diz, e você precisa ler:

- **\`forma\`** — se ele reconheceu a agulha como \`telefone\` ou \`email\`, e quais
  formas mascaradas ele procurou de fato.
- **\`comoCasou\`** por execução, e ele diz o quanto confiar:
  - \`mascara\` — a forma exata do que você colou. É o mesmo número, ponto.
  - \`variante\` — a mesma cauda com outro prefixo, i.e. **o mesmo contato gravado sem
    código de país** (\`21 ***** 0000\` em vez de \`5521 ***** 0000\`). Ancorado no
    prefixo, então é forte; se o prefixo não fizer sentido para você, confira.
  - \`literal\` — casou o número cru, que só acontece em nome de chave.
- **\`frouxo: true\` existe e você quase nunca deve usar.** Ele procura só pelos 4
  últimos dígitos. Medido ao vivo: numa varredura de 1913 execuções, o único
  casamento de \`***** 0000\` foi \`"timestamp":"1786 ***** 0000"\` — **um epoch
  mascarado, não um contato**. Use quando a busca normal não achou nada e você
  suspeita de um formato de gravação diferente, e então **confira CADA casamento com
  \`saida\`** antes de afirmar qualquer coisa.

Contato continua vindo mascarado no resultado. Buscar por ele funciona; ver o número
inteiro, não.

### Varrer fundo, e onde gastar os minutos

Abrir execução é o que custa (medido: 110ms cada, 213s para as 1941). **Listar é
quase de graça** (2s para todas, 8 páginas). Então:

- **Sem janela, o \`contem\` varre a retenção inteira** e para quando: achou 12,
  estourou o orçamento de tempo, ou acabou a lista. Pode levar até ~3 minutos.
- **Com \`desde\`/\`ate\`, ele varre só aquele pedaço** — e uma janela de um dia são
  ~131 execuções, ~12 segundos. **Se você sabe mais ou menos quando foi, diga**: é a
  diferença entre 12 segundos e 3 minutos. O formato é o mesmo do campo \`em\` de cada
  linha (\`2026-08-14\` ou \`2026-08-14T13:14:00Z\`); sem fuso é lido como UTC. \`desde\`
  é o começo (mais antigo), \`ate\` é o fim (mais recente).
- **A resposta SEMPRE diz a cobertura**: quantas abriu, de quantas existem, e a
  janela real em datas (\`janela.abertas\`). Leia isso antes de concluir — "abri 830
  das 1941, cobrindo 12/08 a 19/08" e "abri as 1941, cobrindo tudo" autorizam frases
  diferentes.
- **Se sobrou coisa sem abrir, o aviso diz e diz como continuar** (\`janela.continuar\`,
  por \`ate\` ou por \`cursor\`). Nesse caso **"não achei" NÃO é "não existe"** — é "não
  olhei tudo", e a resposta tem de dizer qual dos dois é.

Na dúvida: se a sua pergunta é sobre **por onde passou**, é \`comNos\`; se é sobre
**o que saiu**, é \`contem\`. Escolher a execução no olho a partir de id, status e
horário é chute — foi medido, e um pedido inteiro foi gasto numa execução que
tinha ido por um ramo que não interessava. Os dois juntos no mesmo pedido também
valem, e aí o \`comNos\` não custa GET nenhum (a execução já está aberta).

Regras do pedido, e elas custam dinheiro se ignoradas:

- **Cada pedido é uma rodada nova.** Peça o que você vai usar, não o que seria
  bom ter. O teto é 3 pedidos por pergunta; batido, você responde com o que tem.
- **Pergunta sobre várias execuções vai num pedido só**, com \`execIds\`. Três
  pedidos de \`saida\` para três execuções gastam o orçamento inteiro e não sobra
  rodada para o quarto olhar.
- **Não peça o que já está em \`evidencia/\`.** O prompt lista o que já veio.
- **\`status\` só aceita** \`success\`, \`error\`, \`waiting\`, \`running\`, \`canceled\`.
  \`crashed\` devolve 400 nesta instância — é medido.
- **Nome de nó é exato**, do \`nodes-index.md\`. Nó que não rodou naquela execução
  volta em \`naoRodaram\`, e isso costuma ser a própria resposta.
- **Telefone e e-mail vêm mascarados**, sempre. Número, booleano e preço vêm
  inteiros. Não peça o dado de contato de ninguém: não vai vir. **Buscar** por
  telefone e e-mail funciona (veja acima) — o que não vem é o valor inteiro.
- **Uma varredura é minutos, não segundos** (medido: 213s para as 1941 execuções
  desta instância, 12s para uma janela de um dia). Se você sabe a janela, passe
  \`desde\`/\`ate\`. Se não sabe, mande sem e leia a cobertura que volta.
- Nada que você pede escreve no n8n. Os quatro verbos são só leitura.

**4. Quando o cockpit te pedir O PATCH** — só acontece depois de o Kauan confirmar
o alvo, e a mensagem que pede vem com o \`target-nodes.json\` já na pasta:

\`\`\`json
{
  "tipo": "patch",
  "resumo": "uma frase sobre o que este patch muda",
  "base": ["evidencia/1-execucoes.json"],
  "patch": {
    "updateNodes": [
      { "name": "nome exato de um nó que já existe", "parameters": { } }
    ],
    "addNodes": [
      { "name": "nome_do_no_novo", "type": "n8n-nodes-base.set", "typeVersion": 3,
        "position": [100, 200], "parameters": { } }
    ],
    "rewire": {
      "NoDeOrigem": { "main": [[{ "node": "NoDeDestino", "type": "main", "index": 0 }]] }
    }
  }
}
\`\`\`

Os três verbos são esses, e **não existe um quarto**. Em particular **não existe
verbo de apagar nó** — este fluxo está em produção. Tirar um nó do caminho é
\`updateNodes\` com \`"disabled": true\` mais o \`rewire\` que costura a ligação por
cima dele. Um \`removeNodes\` é recusado nomeando o verbo.

O que mais é recusado, e cada recusa volta para você com o motivo:

- **Nome de nó que não existe** em \`alvo-nodes-index.md\`. Para criar, é \`addNodes\`
  — e o nome novo não pode colidir com um que já está lá.
- **Trocar o \`type\` de um nó existente.** Isso não é remendo: é outro nó com o
  mesmo nome, herdando ligações desenhadas para o que estava ali.
- **Qualquer \`credentials\`**, em qualquer profundidade. Credencial de nó novo é
  configurada por humano no n8n; o cockpit nunca escreve uma.
- **Marcador de preencher** — \`[PREENCHER]\`, \`[FILL]\`, \`TODO:\`, \`<COISA_ASSIM>\` —
  em qualquer campo que o patch toque. No Tester o marcador é inofensivo num JSON
  que alguém importa à mão; aqui ele iria escrito para dentro de produção, e o nó
  roda fazendo a coisa errada em silêncio. **Se você não sabe o nome da tabela, do
  canal ou do campo, pergunte** — é \`tipo: "resposta"\`, e é mais barato.
- **Pergunta dentro do \`resumo\`.** Mesma regra da \`nota\` do alvo, e aqui é pior: o
  patch chega à tela com o diff pronto ao lado de um botão.
- **Um patch que não muda nada.** Se a sua conclusão é que não há o que mexer,
  isso é \`tipo: "resposta"\`.

\`rewire\` **substitui as saídas inteiras** do nó citado — não é merge. Escreva
todas as saídas que aquele nó deve ter, não só a que mudou.

O patch é aplicado a uma **cópia em memória** para o diff existir. **Quem aplica
não é você**: escrever no fluxo vivo depende de um clique do Kauan sobre esse diff.
Antes desse clique, uma coisa sua sai do processo, e ela é um portão — a checagem 7
grava o documento numa **cópia INATIVA** \`[SANDBOX upgrade]\` (sem credencial, não
executa) para o n8n dizer se aceita o schema.

## As regras que decidem qual das quatro

- **Perguntar de volta é mais barato que errar o alvo.** Se a resposta muda o
  patch, pergunte. Não invente nome de tabela, de canal, de coluna nem de campo.
- **Você pode contestar, e deve.** Se o que ele pediu não resolve o problema dele,
  ou resolve com um efeito colateral que ele não viu, diga — mesmo que dê para
  fazer. Um exemplo real: pedir aviso num nó \`noOp\` que não manda nada.
- **Ele também faz perguntas.** "por que esse nó tem retry?" é dúvida, e a resposta
  certa é uma frase, não um patch. Use \`tipo: "resposta"\`.
- **Todo nome em \`nos\` tem que existir em \`nodes-index.md\`**, exatamente como está
  escrito lá, EXCETO os que você marcar \`"novo": true\`.
- **Pergunta NUNCA vai em \`nota\`.** Se falta uma decisão que muda o patch — qual canal, qual
  tabela, qual campo — isso é \`tipo: "resposta"\` com as perguntas em \`perguntas\`. \`nota\` é só
  para o que ele precisa saber e que **não** muda o alvo. Medido: um alvo válido veio com
  "falta decidir o canal…" na nota, e o cockpit recusa isso.
- **Nunca proponha apagar um nó.** Este fluxo está em produção. Tirar um nó do
  caminho é desligar (\`disabled\`) e recosturar as ligações, e isso é decisão de
  outra etapa — aqui você só diz onde.

## Onde a etapa termina

Você diz o alvo, o Kauan confirma no desenho, e aí o cockpit te pede o patch —
com \`target-nodes.json\` na pasta, que traz o valor exato dos campos dos nós alvo
e dos vizinhos de um salto.

O patch que você escrever é aplicado a uma **cópia em memória**, passa pelos
portões e vira um diff na tela. **Quem aplica não é você**: nada que você escreva
entra no fluxo vivo por esta rodada — isso depende de um clique do Kauan sobre o
diff que está na tela. O que sai do processo antes desse clique é uma coisa só, e
é um portão: a checagem 7 grava o documento numa **cópia INATIVA**
\`[SANDBOX upgrade]\`, sem credencial e que não executa, para o n8n dizer se ele
aceita o schema. Se ele recusar lá, o seu patch volta reprovado com o motivo.
`;

/* OS ARQUIVOS QUE A SESSÃO TEM mudam conforme o dossiê estar utilizável, e a
 * ordem em que eles são apresentados é o que decide o gasto: com dossiê, o
 * primeiro a ler é a prosa; sem ele, é o índice.
 *
 * A frase sobre o dossiê carrega DUAS coisas que ela não pode perder: que foi
 * escrito por um modelo (então pode estar errado sem divergir) e que a decisão
 * final é lida no `fluxo.json`. Um dossiê apresentado como verdade seria a mentira
 * que este projeto não conta — e um parágrafo marcado `⚠ MUDOU` existe justamente
 * porque a impressão digital não prova que a descrição estava certa. */
const ARQ_INDICE = `- \`nodes-index.md\` — Um nó por linha: nome exato, tipo, e para onde a saída vai.
  É o mapa, e é 22× menor que o documento.
- \`fluxo.json\` — o documento inteiro, sem credencial. **Não leia inteiro.** Use
  \`Grep\` para achar o nó que te interessa. No maior fluxo desta instância ele tem
  285KB, e ler tudo gasta o contexto que devia ir para a decisão.`;

const ARQ_COM_DOSSIE = `- \`DOSSIE.md\` — **comece por aqui**. Prosa descrevendo o fluxo: uma visão geral
  com os TRECHOS em ordem, e um parágrafo por nó. Foi **escrito por um modelo**, não
  medido: serve para você ENTENDER o fluxo sem reler o JSON, e não como verdade
  final. Parágrafo marcado \`⚠ MUDOU DEPOIS DESTE TEXTO\` descreve um nó que mudou
  desde então — nesse leia o JSON real antes de confiar.
- \`nodes-index.md\` — o mapa cru: nome exato, tipo, saídas. Use para conferir o
  nome de um nó antes de citá-lo em \`resposta.json\`.
- \`fluxo.json\` — o documento inteiro, sem credencial. **Não leia inteiro**: use
  \`Grep\` no nó que você vai mexer. O dossiê substitui a EXPLORAÇÃO, nunca a
  leitura do nó que você decidiu tocar.`;

/* O ANEXO NO INVENTÁRIO QUE A SESSÃO LÊ PRIMEIRO.
 *
 * O defeito que este bloco fecha foi medido numa conversa real (`umt7kj5cc69ib`,
 * 24/08): o print chegou ao disco (`anexos/print-182748.png`, 66KB, adotado da
 * bandeja) e entrou no prompt pelo `trechoAnexos`, e ainda assim o `REGRAS.md` —
 * que o prompt manda ler **antes de qualquer coisa**, e cuja seção se chama
 * literalmente "Os arquivos aqui" — listava dois arquivos e não mencionava o
 * anexo. Um inventário que se apresenta como completo e omite o material do
 * pedido é a mesma classe de defeito que este projeto já documentou duas vezes:
 * prosa que o MODELO lê afirmando o que o código contradiz. E a direção do erro é
 * a pior: ela ensina a sessão a não procurar o que ele acabou de mandar.
 *
 * ELE VEM ANTES DO DOSSIÊ na lista, e os dois "comece por aqui" NÃO se
 * atropelam porque fazem trabalhos diferentes: o anexo é o PEDIDO (o formato real
 * do destino, o nome verdadeiro da coluna, a mensagem que ele quer ver chegando —
 * nada disso existe no `fluxo.json`), o dossiê é o FLUXO. A frase diz qual é qual.
 *
 * "Não leia tudo" é repetido aqui de propósito, mesmo já estando no `INDICE.md`:
 * sem essa linha o modelo abre os 40 arquivos em ordem e chega na primeira
 * pergunta com o contexto cheio de nada — medido no Tester, e é a razão de o
 * índice existir em vez de o conteúdo viajar no prompt. */
const ARQ_ANEXOS = `- \`anexos/INDICE.md\` — **o que o Kauan anexou nesta conversa**: print, PDF,
  planilha, \`.md\`, ou uma pasta inteira. **Leia este índice primeiro** e abra o que
  decide o pedido — é aqui que mora o que o fluxo não tem: o formato real do
  destino, o nome verdadeiro de uma coluna, a mensagem que ele quer ver chegando.
  Imagem e PDF você abre com \`Read\`, nativamente, sem ferramenta nenhuma a mais.
  **Não leia tudo**: cada leitura gasta o contexto que devia ir para a decisão, e
  numa pasta grande use \`Glob\`/\`Grep\` para achar o arquivo certo antes de abrir.
  Se o índice disser que a lista foi cortada, ela está completa nesse arquivo.
  A ORDEM, quando o \`DOSSIE.md\` também estiver aqui: este índice é o **pedido**, o
  dossiê é o **fluxo**, e o pedido vem antes — de nada serve entender o fluxo para
  então descobrir que o print pedia outra coisa.`;

/* A FRASE DAS FERRAMENTAS SAI DA MESMA FUNÇÃO QUE MONTA O SPAWN, e isso é o
 * conserto do segundo defeito do mesmo parágrafo: o molde prometia
 * `Read, Write, Edit, Glob, Grep` **sempre**, e `ferramentasDaRodada` concede
 * `Glob` só quando existe anexo. Uma rodada sem anexo lia a promessa, chamava
 * `Glob` e levava recusa — e "uma ferramenta negada custa uma rodada, em
 * silêncio" já é lição paga neste repositório. Duas listas divergem no primeiro
 * ajuste feito num lado só; esta é derivada, então não pode divergir. */
function fraseFerramentas(temAnexo) {
  const t = ferramentasDaRodada({ anexos: temAnexo ? [1] : [] }).split(",").map(x => "`" + x + "`");
  const ultima = t.pop();
  return "Você tem " + t.join(", ") + " e " + ultima + ".";
}

function regras(d, temAnexo) {
  const arquivos = (temAnexo ? ARQ_ANEXOS + "\n" : "") + (d && d.usa ? ARQ_COM_DOSSIE : ARQ_INDICE);
  return REGRAS_MOLDE
    .replace("{{FERRAMENTAS}}", fraseFerramentas(!!temAnexo))
    .replace("{{ARQUIVOS}}", arquivos);
}

/* Mantido para o teste e para quem só quer ver o molde sem dossiê e sem anexo. */
const REGRAS = regras(null, false);

/* ────────────────────────────────────────────────────────────── o prompt ──── */

/* As mensagens que caibam no orçamento, as mais NOVAS primeiro a serem mantidas.
 * Devolve também se algo caiu, porque o prompt tem de dizer. */
function ultimasAteCaber(msgs, orcamento) {
  const linhas = [];
  let total = 0, cortadas = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const bruto = String(m.texto || "");
    /* Corte que se ANUNCIA. Uma mensagem chegando muda no prompt sem aviso é a
       mesma falha do `cortadas` lá embaixo, só uma escala menor: ela reafirma o
       que já tinha corrigido porque não sabe que a correção sumiu. */
    const corpo = bruto.length > MSG_SLICE
      ? bruto.slice(0, MSG_SLICE) + " «cortado aqui: mais " + (bruto.length - MSG_SLICE) + " caracteres que não couberam»"
      : bruto;
    const l = (m.de === "eu" ? "KAUAN: " : "VOCÊ: ") + corpo;
    if (total + l.length > orcamento && linhas.length) { cortadas = i + 1; break; }
    linhas.unshift(l);
    total += l.length;
  }
  return { texto: linhas.join("\n\n"), cortadas };
}

function prompt(s) {
  const { texto: conversa, cortadas } = ultimasAteCaber(s.chat, ORC_CONVERSA);
  const partes = [
    "Leia `REGRAS.md` no diretório atual antes de qualquer coisa: ele diz o que você está fazendo, ",
    "quais arquivos existem e qual das duas formas de `resposta.json` escrever.\n\n",
    "O fluxo é `", s.wfNome, "` (", String(s.nos), " nós).\n\n"
  ];
  /* A linha que dirige a PRIMEIRA ação. `REGRAS.md` já diz "comece por aqui", mas
     o que a sessão faz primeiro é o que o prompt manda — e o gasto da rodada é
     decidido nessa primeira leitura. */
  if (s.dossie && s.dossie.usa) {
    partes.push(
      "Existe um `DOSSIE.md` neste diretório: prosa descrevendo o fluxo trecho por trecho, ",
      "escrita por um modelo a partir de uma versão anterior deste mesmo fluxo. LEIA ELE PRIMEIRO — ",
      "é para isso que ele existe, e ele te poupa de reler o `fluxo.json`.",
      /* COM ANEXO, ele NÃO é o primeiro, e a ressalva mora aqui porque as duas
         frases estão no mesmo prompt: "leia o dossiê primeiro" e o bloco de anexos
         logo abaixo se contradiriam, e a contradição é resolvida por quem lê — que
         é o modelo. O pedido vem antes do fluxo: entender 103 nós para então
         descobrir que o print pedia outra coisa é a rodada paga duas vezes. */
      (s.anexos || []).length
        ? " ANTES dele, leia `anexos/INDICE.md`: o anexo é o PEDIDO, o dossiê é o FLUXO."
        : "",
      s.dossie.cor === "laranja"
        ? " " + String(s.dossie.mudados) + " nó(s) mudaram depois que ele foi escrito e estão marcados "
          + "com `⚠` — nesses, confira o JSON real antes de confiar no parágrafo."
        : "",
      "\n\n"
    );
  }
  /* A evidência já buscada nesta pergunta. Vai como LISTA de arquivos, nunca
     inline: um `saida` de 4 nós deu 8,2KB medidos, e três voltas estourariam o
     `PROMPT_MAX`. Mesma regra do dossiê e do catálogo do Tester. */
  if (s.evidencias && s.evidencias.length) {
    partes.push("Evidência que você já pediu nesta pergunta, e que está na pasta:\n");
    for (const e of s.evidencias) {
      partes.push("- ", e.arquivo ? "`" + e.arquivo + "` — " : "(não veio) ", e.resumo, "\n");
    }
    partes.push("\nLeia o que precisar com `Read`. Não peça de novo o que já está aí.\n\n");
  }
  if (cortadas) {
    partes.push(
      "AVISO: esta conversa tem ", String(s.chat.length), " mensagens e as ", String(cortadas),
      " mais antigas não couberam aqui. Se algo parecer faltar, pergunte em vez de supor — ",
      "o que está abaixo é o que vale agora.\n\n"
    );
  }
  /* O MATERIAL QUE ELE ANEXOU. Vem antes da conversa porque é a única parte do
     prompt que muda o que a sessão faz PRIMEIRO: ler o índice e abrir o que
     decide, em vez de sair varrendo o `fluxo.json`.
     Só o ÍNDICE entra aqui — o arquivo viaja em disco. Um .md de 40KB inline
     mataria o spawn com `ENAMETOOLONG`, que não nomeia nem o prompt nem o
     tamanho, e é a lição que o `escreverContexto()` do Tester já pagou. */
  if ((s.anexos || []).length) partes.push(trechoAnexos(s), "\n\n");
  partes.push("A conversa até agora:\n\n", conversa, "\n\n");
  if (s.correcoes && s.correcoes.length) {
    partes.push(
      "A sua resposta anterior foi recusada pelo cockpit por estes motivos. Corrija e escreva ",
      "`resposta.json` de novo:\n- ", s.correcoes.join("\n- "), "\n\n"
    );
  }
  partes.push("Escreva `resposta.json` agora. Nada além dele.");
  return partes.join("");
}

/* ──────────────────────────────────────────────────────── rodar uma rodada ── */

function rodar(s, gen, ehPatch) {
  return new Promise(resolve => {
    const p = prompt(s);

    /* OS ARGUMENTOS SAEM DO ADAPTADOR, e as três cercas com eles —
       `--disallowedTools`, `--setting-sources ""` e `--strict-mcp-config` são
       DADO na tabela do provedor no `ia.js`, e um provedor sem as três é recusado
       por nome antes de virar spawn.

       `NEGADAS` daqui continua sendo passado explicitamente em vez de deixar o
       default: ele é byte a byte o `ia.NEGADAS_SEM_REDE`, e o `ia-fiacao-test.js`
       afere essa igualdade sobre o valor que CHEGA ao spawn — então o dia em que
       as duas divergirem é vermelho, em vez de ser uma sessão com uma cerca a
       menos que ninguém notou.

       O teto do prompt continua sendo o `PROMPT_MAX` desta aba (24000, medido
       contra o pior prompt de ~16,4KB), e não o do Tester: as duas têm folgas
       diferentes e escolher um só seria apertar uma ou afrouxar a outra sem
       medir. A recusa por NOME antes do spawn é a mesma de antes — sem ela o erro
       é `spawn ENAMETOOLONG`, que manda quem lê procurar caminho de arquivo. */
    const mont = ia.argumentosDaRodada({
      escolha: escolhaDaRodada(),
      prompt: p,
      ferramentas: ferramentasDaRodada(s),
      negadas: NEGADAS,
      modelo: MODELO,
      esforco: esforcoDaRodada(ehPatch),
      resumeId: s.sessionId,
      tetoPrompt: PROMPT_MAX
    });
    if (!mont.ok) {
      resolve({ erro: mont.erro, usd: 0, ms: 0 });
      return;
    }
    /* A ORDEM DAS DUAS RECUSAS É A DE ANTES: prompt primeiro, CLI depois. Um
       prompt estourado com o CLI ausente continua relatando o prompt — trocar a
       ordem mandaria instalar um CLI para depois descobrir que o pedido é grande
       demais. */
    if (!fix.claudeFound) {
      resolve({ erro: "Claude Code CLI não encontrado em " + CLAUDE_BIN + " — defina CLAUDE_BIN no .env", usd: 0, ms: 0 });
      return;
    }

    const t0 = Date.now();
    const child = spawn(CLAUDE_BIN, mont.args, {
      cwd: s.dir, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],   // stdin fechado: senão o CLI espera 3s e avisa no stderr
      env: ia.ambienteDaRodada({ escolha: escolhaDaRodada(), carimbo: CARIMBO_IA })
    });
    s.filho = child;

    let buf = "", usd = 0, erro = null, morto = false;

    /* O VIGIA, e ele mede DUAS coisas com um só relógio.
     *
     * `ultimoSinal` é qualquer byte vindo do filho — stdout ou stderr. O stderr
     * conta de propósito: um CLI reencaixando uma chamada de API escreve lá, e
     * isso é sinal de vida, não de trava. Se ele reencaixar para sempre, quem
     * pega é o teto duro. */
    let ultimoSinal = Date.now();
    const sinal = () => { ultimoSinal = Date.now(); };
    const morrer = motivo => {
      if (morto) return;
      morto = true;
      erro = fraseMorte(motivo, Date.now() - t0);
      try { child.kill(); } catch { /* já morreu */ }
    };
    /* 2s de passo: barato, e é a granularidade com que o `thinking_tokens` chega.
     * `unref()` para que um vigia esquecido nunca segure o processo do cockpit
     * vivo — o `close`/`error` limpa, mas um `clearInterval` que não roda por um
     * caminho novo não pode virar um servidor que não desliga. */
    const vigia = setInterval(() => {
      const agora = Date.now();
      if (agora - ultimoSinal >= SILENCIO_MS) morrer("travou");
      else if (agora - t0 >= RODADA_MS) morrer("teto");
    }, 2000);
    if (typeof vigia.unref === "function") vigia.unref();

    child.stdout.on("data", chunk => {
      sinal();
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch { continue; }
        if (!vivo(s, gen)) continue;

        if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === "text" && c.text) {
              const ultima = c.text.split(/\n+/).filter(Boolean).pop();
              if (ultima && ultima.length > 8) atividade(s, ultima.slice(0, 150));
            } else if (c.type === "tool_use") {
              const alvo = (c.input && (c.input.file_path || c.input.pattern || c.input.path)) || "";
              const humano = c.name + (alvo ? " " + path.basename(String(alvo)) : "");
              atividade(s, humano);
              diz(s, "· " + humano);
              /* Qual anexo ela REALMENTE abriu. Sem isto, anexar é ato de fé: ela
                 manda o print, a rodada pergunta uma coisa que o print já
                 respondia, e não há como saber se ele foi lido ou ignorado. O chip
                 só é marcado por observação do `tool_use`, nunca porque o prompt
                 pediu para abrir. */
              registrarLeituraAnexo(s, c);
            }
          }
        } else if (ev.type === "result") {
          if (typeof ev.total_cost_usd === "number") usd = ev.total_cost_usd;
          if (typeof ev.session_id === "string") s.sessionId = ev.session_id;
          if (ev.is_error) erro = erro || "a sessão terminou com erro";
        } else if (ev.type === "system") {
          if (typeof ev.session_id === "string") s.sessionId = ev.session_id;
          /* O BATIMENTO DO PENSAMENTO, e mostrá-lo não é enfeite: é o mesmo fato
             em que o vigia se apoia para decidir que a sessão travou. Medido, a
             rodada do ClickUp ficou 81s entre um `tool_use` e o próximo — a banda
             de atividade congelava naquela linha e uma tela parada por 81s lê como
             quebrada. Estes eventos chegam a cada poucos segundos ENQUANTO ela
             pensa, então a banda passa a dizer o que está acontecendo. Falha
             macio: um CLI que não emita `thinking_tokens` volta ao comportamento
             de antes, que é a banda parada. */
          if (ev.subtype === "thinking_tokens" && typeof ev.estimated_tokens === "number") {
            atividade(s, "pensando… ~" + ev.estimated_tokens + " tokens");
          }
        }
      }
    });

    child.stderr.on("data", d => {
      sinal();
      const t = d.toString("utf8").trim();
      if (t) diz(s, "stderr: " + t.slice(0, 200), "warn");
    });

    child.on("error", e => {
      clearInterval(vigia);
      /* Só anula se ainda for ESTE filho. `mensagem()` mata o processo e começa a
         rodada nova na sequência; o `close` do morto chega depois, assíncrono, com
         `s.filho` já apontando para o novo. Anular ali cega o `cancelar()` e o
         `mensagem()` seguintes, e o CLI vivo roda até o timeout queimando cota. */
      if (s.filho === child) s.filho = null;
      resolve({ erro: String(e && e.message || e), usd, ms: Date.now() - t0 });
    });

    child.on("close", code => {
      clearInterval(vigia);
      /* Só anula se ainda for ESTE filho. `mensagem()` mata o processo e começa a
         rodada nova na sequência; o `close` do morto chega depois, assíncrono, com
         `s.filho` já apontando para o novo. Anular ali cega o `cancelar()` e o
         `mensagem()` seguintes, e o CLI vivo roda até o timeout queimando cota. */
      if (s.filho === child) s.filho = null;
      const ms = Date.now() - t0;
      /* Rodada morta reporta `usd: 0` porque `total_cost_usd` vem no evento
       * `result`, a ÚLTIMA linha do CLI. Registrar zero afirmaria que foi de
       * graça, quando pode ter sido a mais cara. A entrada fica CEGA, e a tela
       * mostra "não medido" em vez de zero. O `!usd` importa: se o `result`
       * chegou antes da morte, o número é real e vence a suspeita. */
      const cega = (morto || s.status === "cancelada") && !usd;
      s.custo.push({
        em: new Date().toISOString(), ms,
        usd: cega ? null : usd,
        usdDesconhecido: cega,
        motivo: cega ? (morto ? "rodada morta por tempo" : "cancelada no meio") : null
      });
      emit(s, "custo", { custo: s.custo, total: gastoAte(s) });
      /* O custo também vai para disco AQUI, e não só na transição de estado
         seguinte: quando ele aperta parar, `cancelar()` grava e o filho morre
         DEPOIS, empurrando a rodada cega para um `s.custo` que ninguém mais ia
         gravar. Sem esta linha o gasto de uma conversa parada no meio ficava por
         baixo no `conversas.json`, calado. */
      guardar(s);
      resolve({ erro: erro || (code === 0 ? null : "a sessão saiu com código " + code), usd, ms });
    });
  });
}

/* O gasto até agora, cobrando cada rodada cega pela MÉDIA das medidas. É um
 * palpite DECLARADO, e ele vence um zero silencioso: somar zero autorizaria a
 * próxima rodada como se nada tivesse sido gasto. */
function gastoAte(s) {
  /* `custo` ausente vira lista vazia em vez de estourar. Isto deixou de ser
     zelo quando `enxuto()` passou a ser chamado de `publicarParcial()`: aquele
     caminho roda no meio da bateria, ou seja dentro da região de escrita, e um
     TypeError ali aborta a verificação de um patch que já criou a cópia sandbox
     — deixando a tela parada sem dizer o que houve. */
  const custo = Array.isArray(s && s.custo) ? s.custo : [];
  const medidas = custo.filter(c => !c.usdDesconhecido).map(c => c.usd);
  const media = medidas.length ? medidas.reduce((a, b) => a + b, 0) / medidas.length : 0;
  const cegas = custo.filter(c => c.usdDesconhecido).length;
  return {
    usd: medidas.reduce((a, b) => a + b, 0) + cegas * media,
    cegas, estimado: cegas > 0
  };
}

/* ──────────────────────────────────────────────── ler e validar a resposta ── */

/* ═════════════ A PROCEDÊNCIA: toda afirmação diz em que ela se baseia ═══════
 *
 * O achado mais grave do teste de conversa de 2026-08-19. Duas das cinco
 * perguntas pediam comportamento observado — *"confere numa execução se…"* — e
 * foram respondidas a partir do `DOSSIE.md` e do `fluxo.json`, afirmando coisas
 * sobre o MUNDO: *"nenhuma execução passa por ele"*, *"essa cadeia nunca
 * executa"*. Zero execuções abertas. E nada no formato da resposta separava isso
 * de uma resposta com execução real atrás: as duas chegaram na tela com a mesma
 * confiança, e a mais barata das cinco (US$0,21) foi a que não verificou nada.
 *
 * O dossiê é PROSA ESCRITA POR UM MODELO. A impressão digital do `dossie.js`
 * prova que o nó não mudou; ela nunca provou que a descrição estava certa. Então
 * uma afirmação sobre execução sustentada pelo dossiê é modelo citando modelo, e
 * é a única das três procedências que precisa aparecer como ressalva.
 *
 * OBRIGATÓRIO SEMPRE, e não só quando ela afirma comportamento. A escolha é essa
 * porque "isto é uma afirmação sobre o mundo?" é exatamente o juízo que falhou:
 * a resposta que leu só código escreveu *"conferi de verdade"*. Um campo exigido
 * apenas quando o modelo se autoclassifica é um campo que desliga na hora que
 * importa. O preço é uma linha em toda resposta — e o `REGRAS.md` ensina com
 * exemplo, senão a primeira rodada de toda pergunta viraria recusa. */

const BASES_FIXAS = {
  dossie: { arquivo: "DOSSIE.md", procedencia: "dossie" },
  fluxo: { arquivo: "fluxo.json", procedencia: "codigo" },
  indice: { arquivo: "nodes-index.md", procedencia: "codigo" }
};

/* As três procedências, e nenhuma pode ler como as outras — é o ponto todo. */
const PROC_FRASE = {
  evidencia: "com evidência atrás: leitura no n8n feita nesta conversa",
  codigo: "por leitura do JSON do fluxo — código, não execução observada",
  dossie: "só pelo DOSSIE.md, que é prosa escrita por um modelo — nada foi verificado no n8n"
};
/* O nível é o que a tela pinta e o que se lê como confiança. Mesma disciplina do
   grafo vazio: uma resposta sem verificação nenhuma não entra como `good`. */
const PROC_NIVEL = { evidencia: "good", codigo: "info", dossie: "warn" };

/* Aceita `dossie`, `fluxo`, `indice` e um arquivo de `evidencia/` — com ou sem a
   pasta na frente, porque as duas formas aparecem no prompt e recusar por causa
   de um prefixo custaria uma rodada. */
function normalizarBase(x) {
  const s = String(x == null ? "" : x).trim();
  const t = s.toLowerCase().replace(/^\.?[\\/]+/, "").replace(/\\/g, "/");
  if (BASES_FIXAS[t]) return t;
  const m = t.match(/^(?:evidencia\/)?(\d{1,3}-[a-z]+\.json)$/);
  return m ? "evidencia/" + m[1] : s.slice(0, 80);
}

/* O conjunto que ESTA sessão pode citar. Verificável, não promessa: `dossie` só
   entra quando o `DOSSIE.md` foi realmente escrito na pasta (vermelho e cinza não
   escrevem), e um arquivo de evidência só entra quando a busca voltou — uma que
   falhou tem `arquivo: null` e citá-la seria citar uma fonte inexistente. */
function basesDaSessao(s) {
  const set = new Set(["fluxo", "indice"]);
  if (s && s.dossie && s.dossie.usa) set.add("dossie");
  for (const e of (s && s.evidencias) || []) if (e && e.arquivo) set.add(normalizarBase(e.arquivo));
  return set;
}

/* A mais forte entre as citadas. Forte, não fraca: se ela abriu execução, abriu —
   e a lista inteira continua na tela para quem quiser ver o que mais entrou. */
function procedenciaDe(base) {
  let melhor = "dossie";
  for (const b of base) {
    const p = /^evidencia\//.test(b) ? "evidencia" : (BASES_FIXAS[b] || {}).procedencia || "dossie";
    if (p === "evidencia") return "evidencia";
    if (p === "codigo") melhor = "codigo";
  }
  return melhor;
}

/* Toda resposta é payload hostil: ela vem de um modelo e vai virar interface.
 * Devolve `{ok, valor}` ou `{ok:false, erros}` — e os erros voltam para o modelo
 * literalmente, que é o laço que já funciona no `claude-fix.js`.
 *
 * `bases` é o conjunto que a SESSÃO tem (ver `basesDaSessao`). Sem ele, o padrão
 * é só o que existe em toda pasta — nunca "aceita tudo": um padrão permissivo
 * transformaria a checagem em promessa exatamente no caminho que ela existe para
 * verificar. */
/* Os três verbos do §4.1, importados em espírito de `claude-fix.js` — e a ausência
 * do quarto é o §4.2 inteiro. Não existe verbo de apagar porque o alvo aqui é
 * produção: "nunca apague um nó" deixa de ser regra que dá para quebrar quando o
 * formato não sabe expressá-la. O `removeNodes` do Tester existe porque lá o alvo
 * é rascunho do Kauan, e `claude-fix.js` não foi tocado para isto. */
const VERBOS_PATCH = new Set(["updateNodes", "addNodes", "rewire"]);

/* Onde aparece uma chave de credencial, em qualquer profundidade — devolve o
   CAMINHO, não um booleano, porque a recusa que não diz onde faz o modelo
   reescrever o documento inteiro e errar de novo. */
function caminhoDeCredencial(v, caminho = "patch", prof = 0) {
  if (prof > 8 || !v || typeof v !== "object") return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length && i < 200; i++) {
      const r = caminhoDeCredencial(v[i], caminho + "[" + i + "]", prof + 1);
      if (r) return r;
    }
    return null;
  }
  for (const [k, x] of Object.entries(v)) {
    if (/^credentials$/i.test(k)) return caminho + "." + k;
    const r = caminhoDeCredencial(x, caminho + "." + k, prof + 1);
    if (r) return r;
  }
  return null;
}

function validarResposta(bruto, nomesValidos, bases) {
  const erros = [];
  let j;
  try { j = JSON.parse(bruto); } catch (e) { return { ok: false, erros: ["`resposta.json` não é JSON válido: " + e.message] }; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, erros: ["`resposta.json` tem que ser um objeto"] };

  if (j.tipo === "resposta") {
    const disponiveis = bases instanceof Set ? bases : new Set(["fluxo", "indice"]);
    const listaDisp = [...disponiveis].sort().join(", ");
    const temEvidencia = [...disponiveis].some(b => /^evidencia\//.test(b));

    const texto = String(j.texto || "").trim();
    if (!texto) erros.push('`tipo: "resposta"` exige o campo `texto` com o que você quer dizer');
    if (texto.length > TEXTO_MAX) erros.push("`texto` passou de " + TEXTO_MAX + " caracteres (veio com "
      + texto.length + ") — resuma");

    const crua = Array.isArray(j.base) ? j.base : (j.base != null ? [j.base] : []);
    const base = [];
    for (const x of crua.slice(0, 6)) {
      const b = normalizarBase(x);
      if (!b) continue;
      if (!disponiveis.has(b)) {
        erros.push('`base` cita "' + String(x).slice(0, 60) + '", que não existe nesta sessão. '
          + "As bases que existem aqui são: " + listaDisp + "."
          + (temEvidencia ? "" : " Você não pediu evidência nenhuma nesta pergunta, então não há arquivo em "
            + "`evidencia/` para citar — se a sua afirmação é sobre o que acontece numa execução, peça "
            + '`tipo: "pedido"` antes de responder.'));
        continue;
      }
      if (!base.includes(b)) base.push(b);
    }
    /* Ausência é estado PRÓPRIO, com frase própria: sem isto o campo faltando cairia
       no ramo de "base inválida", que manda procurar um erro de digitação onde o que
       houve foi não declarar nada. */
    if (!crua.length) {
      erros.push('`tipo: "resposta"` exige o campo `base`, dizendo em QUE a sua resposta se apoia. '
        + "Os valores possíveis nesta sessão são: " + listaDisp + " — pode ser mais de um, em lista. "
        /* O exemplo é montado com o que ESTA sessão tem. Um exemplo citando um
           arquivo de evidência numa sessão sem evidência ensinaria a inventar a
           fonte, que é o defeito que este campo existe para fechar. */
        + 'Exemplo: `"base": ["' + (temEvidencia ? [...disponiveis].filter(b => /^evidencia\//.test(b))[0] : "fluxo") + '"]`. '
        + "Uma afirmação sobre o que acontece numa execução tem de citar um arquivo de `evidencia/`; "
        + "o dossiê é prosa escrita por um modelo e não prova comportamento."
        + (temEvidencia ? "" : ' Se você ainda não abriu execução nenhuma, peça `tipo: "pedido"` primeiro.'));
    } else if (!base.length && !erros.length) {
      erros.push("`base` veio, mas nenhum valor sobreviveu à checagem — os que existem aqui são: " + listaDisp);
    }

    const perguntas = Array.isArray(j.perguntas)
      ? j.perguntas.map(x => String(x || "").trim()).filter(Boolean).slice(0, 3) : [];
    if (erros.length) return { ok: false, erros };
    return { ok: true, valor: { tipo: "resposta", texto, perguntas, base, procedencia: procedenciaDe(base) } };
  }

  if (j.tipo === "alvo") {
    const resumo = String(j.resumo || "").trim();
    if (!resumo) erros.push('`tipo: "alvo"` exige `resumo` com uma frase sobre o que muda');
    if (!Array.isArray(j.nos) || !j.nos.length) erros.push("`nos` tem que ser uma lista com ao menos um nó");
    const nos = [];
    for (const n of (Array.isArray(j.nos) ? j.nos : []).slice(0, 24)) {
      const nome = String(n && n.nome || "").trim();
      const novo = !!(n && n.novo);
      if (!nome) { erros.push("um item de `nos` veio sem `nome`"); continue; }
      if (!novo && !nomesValidos.has(nome)) {
        erros.push('o nó "' + nome + '" não existe neste fluxo — os nomes exatos estão em `nodes-index.md`. ' +
          'Se ele é um nó NOVO que você quer criar, marque `"novo": true`');
        continue;
      }
      if (novo && nomesValidos.has(nome)) {
        erros.push('"' + nome + '" está marcado como novo mas já existe no fluxo — escolha outro nome ou tire o `novo`');
        continue;
      }
      nos.push({
        nome, novo,
        oque: String(n.oque || "").trim().slice(0, 240),
        tipoNo: novo ? String(n.tipoNo || "").trim().slice(0, 80) : null
      });
    }
    if (!nos.length && !erros.length) erros.push("nenhum nó da lista sobreviveu à checagem de nome");

    /* Pergunta na `nota` é o defeito que a primeira rodada real produziu, medido
     * 2026-08-13: o alvo veio válido e a `nota` dizia *"falta decidir o canal:
     * reaproveita o de slack_notificar_novo_lead ou um separado?"*. Isso não é
     * observação — é uma decisão pendente que MUDA o patch, escondida dentro de um
     * alvo que a tela apresenta como pronto para confirmar. Se ele confirma, a
     * etapa seguinte escolhe sozinha ou marca `[PREENCHER]`, e nenhum dos dois é o
     * que ele pediu.
     *
     * `nota` serve para o que NÃO muda o patch ("esse noOp está no caminho, então
     * pendurar funciona"). Pergunta pertence a `tipo: "resposta"`, que é a porta
     * que existe exatamente para isso — e recusar aqui devolve o motivo ao modelo,
     * que é o laço que já funciona. */
    const nota = String(j.nota || "").trim();
    if (/\?/.test(nota)) {
      erros.push('a `nota` tem pergunta ("' + nota.slice(0, 80) + '…"). Pergunta que muda o patch não vai em ' +
        '`nota`: responda com `tipo: "resposta"` e as perguntas em `perguntas`. `nota` é só para o que ' +
        "ele precisa saber e que NÃO muda o alvo");
    }
    if (erros.length) return { ok: false, erros };
    return {
      ok: true,
      valor: { tipo: "alvo", resumo: resumo.slice(0, 400), nos, nota: nota.slice(0, 500) || null }
    };
  }

  /* ═══════════════════════════ A TERCEIRA FORMA: PEDIDO ════════════════════
   *
   * A conversa lia o dossiê e o índice, e nada mais — então uma pergunta como
   * "por que o preço saiu R$0,00" não tinha resposta possível: ela mora nas
   * EXECUÇÕES, e às vezes em outro fluxo (a tool que busca preço é sub-workflow).
   *
   * A sessão NÃO fala com o n8n e isso não vai mudar: sem shell, sem rede, e
   * portanto sem como fazer requisição nem que tivesse a chave. Quem busca é o
   * cockpit — ela pede, o arquivo aparece na pasta, a rodada roda de novo. Mesmo
   * laço das correções, com evidência em vez de recusa.
   *
   * O recorte do que ela pode ver está em `evidencia.js`, não aqui. */
  /* ─────────────────────────── tipo "patch" — §4.1/4.2/4.4 do PLAN-UPGRADE ────
   *
   * Três verbos, e a AUSÊNCIA do quarto é a garantia de produção. O Tester tem
   * `removeNodes` porque lá o alvo é rascunho do Kauan; aqui o alvo é um fluxo
   * que está rodando. Tirar nó do caminho é `disabled: true` mais o `rewire` que
   * costura o buraco — e "nunca apague um nó" deixa de ser uma regra que dá para
   * quebrar quando o formato não sabe expressá-la.
   *
   * O que `applyPatch` já recusa (campo desconhecido, `credentials`, troca de
   * `type`) é recusado LÁ e volta nomeado. O que é recusado AQUI é o que ele não
   * pega: o verbo inventado, o nome que não existe, e — o portão novo do §4.3 —
   * o `[PREENCHER]`. A duplicação de `credentials` é deliberada: chegar até o
   * `applyPatch` para ser barrado ali é tarde demais para uma checagem que existe
   * por segurança, e uma segunda camada barata não custa nada. */
  if (j.tipo === "patch") {
    const disponiveis = bases instanceof Set ? bases : new Set(["fluxo", "indice"]);
    const listaDisp = [...disponiveis].sort().join(", ");

    const resumo = String(j.resumo || "").trim();
    if (!resumo) erros.push('`tipo: "patch"` exige `resumo` com uma frase sobre o que o patch muda');
    /* Mesma razão da `nota` do alvo, e aqui é pior: um patch com pergunta dentro é
       apresentado na tela com o diff pronto, ao lado de um botão. Decisão pendente
       que muda o que vai ser escrito pertence a `tipo: "resposta"`. */
    if (/\?/.test(resumo)) {
      erros.push('o `resumo` tem pergunta ("' + resumo.slice(0, 80) + '…"). Se falta uma decisão que muda '
        + 'o patch, isso é `tipo: "resposta"` com as perguntas em `perguntas` — nunca um patch que a tela '
        + "apresenta como pronto");
    }

    const p = j.patch;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      erros.push("`tipo: \"patch\"` exige o campo `patch`, um objeto com `updateNodes`, `addNodes` e/ou `rewire`");
      return { ok: false, erros };
    }

    /* Verbo fora dos três é recusado NOMEANDO o verbo, e a frase diz o caminho
       certo. Um `removeNodes` silenciosamente ignorado seria pior que recusado: o
       modelo acharia que apagou e o diff não mostraria remoção nenhuma. */
    for (const k of Object.keys(p)) {
      if (VERBOS_PATCH.has(k)) continue;
      erros.push('`patch` traz o verbo "' + k + '", que não existe aqui. Os três são `updateNodes`, '
        + "`addNodes` e `rewire`" + (/remov|delet|apag/i.test(k)
          ? ". Não existe verbo de apagar: este fluxo está em produção, e tirar um nó do caminho é "
            + "`updateNodes` com `disabled: true` mais o `rewire` que costura a ligação por cima dele"
          : ""));
    }

    const upd = Array.isArray(p.updateNodes) ? p.updateNodes : [];
    const add = Array.isArray(p.addNodes) ? p.addNodes : [];
    const rew = p.rewire && typeof p.rewire === "object" && !Array.isArray(p.rewire) ? p.rewire : null;
    if (p.updateNodes != null && !Array.isArray(p.updateNodes)) erros.push("`updateNodes` tem que ser uma lista");
    if (p.addNodes != null && !Array.isArray(p.addNodes)) erros.push("`addNodes` tem que ser uma lista");
    if (p.rewire != null && !rew) erros.push('`rewire` tem que ser um objeto no formato {"NoDeOrigem": {"main": [[...]]}}');

    /* Patch que não muda nada não é patch — é uma resposta que se apresentou como
       escrita, e ela chegaria à tela com um diff vazio ao lado de um botão. */
    if (!upd.length && !add.length && !(rew && Object.keys(rew).length)) {
      erros.push("o `patch` não muda nada: nenhum dos três verbos veio com conteúdo. Se a sua conclusão é "
        + 'que não há o que mexer, isso é `tipo: "resposta"`');
    }

    const novos = new Set();
    for (const a of add) {
      const nome = String(a && a.name || "").trim();
      if (!nome) { erros.push("um item de `addNodes` veio sem `name`"); continue; }
      if (nomesValidos.has(nome)) {
        erros.push('`addNodes` quer criar "' + nome + '", mas já existe um nó com esse nome no fluxo — '
          + "escolha outro nome, ou use `updateNodes` se a intenção era mexer no que já está lá");
      }
      if (novos.has(nome)) erros.push('`addNodes` traz "' + nome + '" duas vezes');
      novos.add(nome);
      if (!String(a.type || "").trim()) erros.push('`addNodes`: "' + nome + '" precisa de `type`');
      if (!Array.isArray(a.position) || a.position.length !== 2 || !a.position.every(x => typeof x === "number")) {
        erros.push('`addNodes`: "' + nome + '" precisa de `position: [x, y]` com dois números');
      }
    }

    for (const u of upd) {
      const nome = String(u && u.name || "").trim();
      if (!nome) { erros.push("um item de `updateNodes` veio sem `name`"); continue; }
      if (!nomesValidos.has(nome)) {
        erros.push('`updateNodes` cita "' + nome + '", que não existe no fluxo. Os nomes exatos estão em '
          + "`nodes-index.md`. Para criar um nó novo é `addNodes`");
      }
      /* Trocar o `type` de um nó de produção não é remendo: é outro nó com o mesmo
         nome, herdando ligações que foram desenhadas para o antigo. */
      if ("type" in u) {
        erros.push('`updateNodes` tenta trocar o `type` de "' + nome + '". Isso não é um remendo — é outro '
          + "nó com o mesmo nome, herdando ligações desenhadas para o que estava lá. Se é para trocar o nó, "
          + "adicione o novo e recosture com `rewire`");
      }
    }

    if (rew) {
      for (const [de, saidas] of Object.entries(rew)) {
        if (!nomesValidos.has(de) && !novos.has(de)) {
          erros.push('`rewire` parte de "' + de + '", que não existe no fluxo nem está sendo criado neste patch');
        }
        if (!saidas || typeof saidas !== "object" || Array.isArray(saidas)) {
          erros.push('`rewire`: as saídas de "' + de + '" têm que ser um objeto {"main": [[...]]}');
        }
      }
    }

    /* `credentials` em QUALQUER profundidade. `applyPatch` já barra no topo do nó,
       mas segredo é a única coisa aqui que não tem desfazer, e a checagem barata
       vem antes. */
    /* Localizado pelo NÓ, não pelo índice do array. Todo o resto deste arquivo — e o
       `portaPreencher` — nomeia o nó, e esta frase volta para o modelo no laço de
       correção: `updateNodes[0]` obriga ele a contar posição de array para saber de
       qual nó se trata, num patch que pode ter seis. */
    for (const [lista, verbo] of [[upd, "updateNodes"], [add, "addNodes"]]) {
      for (const item of lista) {
        const nome = String(item && item.name || "?").trim() || "?";
        const onde = caminhoDeCredencial(item, verbo + " de \"" + nome + "\"");
        if (onde) {
          erros.push("o nó \"" + nome + "\" mexe em `credentials` (em `" + onde + "`), o que é proibido. "
            + "Credencial de nó novo é configurada por humano no n8n — o cockpit nunca escreve uma");
        }
      }
    }
    /* O `rewire` só carrega ligação, mas a varredura cobre o objeto inteiro de
       qualquer jeito: um verbo que passasse a aceitar mais campo amanhã entraria
       coberto em vez de entrar por fora. */
    const ondeSolto = caminhoDeCredencial({ rewire: rew }, "patch");
    if (ondeSolto) {
      erros.push("o patch mexe em `credentials` (em `" + ondeSolto + "`), o que é proibido. Credencial de nó "
        + "novo é configurada por humano no n8n — o cockpit nunca escreve uma");
    }

    /* §4.3 — o portão do placeholder. Ele só olha o que ESTE patch escreve, nunca o
       que já estava no fluxo: varrer o documento inteiro reprovaria todo patch para
       sempre, porque fluxo de produção carrega marcador de build antigo do Tester. */
    const pre = preencher.portaPreencher(p);
    if (!pre.ok) for (const e of pre.erros) erros.push(e);

    const base = [];
    const crua = Array.isArray(j.base) ? j.base : (j.base ? [j.base] : []);
    for (const x of crua) {
      const b = normalizarBase(x);
      if (!b) continue;
      if (!disponiveis.has(b)) {
        erros.push('`base` cita "' + String(x).slice(0, 60) + '", que não existe nesta sessão. As que existem '
          + "aqui são: " + listaDisp + ".");
        continue;
      }
      if (!base.includes(b)) base.push(b);
    }
    if (!crua.length) {
      erros.push('`tipo: "patch"` exige `base`, dizendo em QUE este patch se apoia. Nesta sessão: '
        + listaDisp + ". Um patch que muda o que um nó FAZ tem de citar um arquivo de `evidencia/`; "
        + "o dossiê é prosa escrita por um modelo e não prova comportamento.");
    } else if (!base.length && !erros.length) {
      erros.push("`base` veio, mas nenhum valor sobreviveu à checagem — os que existem aqui são: " + listaDisp);
    }

    if (erros.length) return { ok: false, erros };
    return {
      ok: true,
      valor: {
        tipo: "patch",
        resumo: resumo.slice(0, 400),
        patch: {
          updateNodes: upd,
          addNodes: add,
          rewire: rew || {}
        },
        base, procedencia: procedenciaDe(base)
      }
    };
  }

  if (j.tipo === "pedido") {
    const p = evidencia.validarPedido(j.pedido || j);
    if (!p.ok) return { ok: false, erros: p.erros };
    return { ok: true, valor: { tipo: "pedido", pedido: p.valor, porque: String(j.porque || "").trim().slice(0, 300) || null } };
  }

  return { ok: false, erros: ['`tipo` tem que ser exatamente "resposta", "alvo", "patch" ou "pedido" — veio "' + String(j.tipo) + '"'] };
}

/* ─────────────────────────────────────────────────────────────── a esteira ── */

const MAX_CORRECOES = 2;

/* `ehPatch` viaja EXPLÍCITO e não é derivado de `nomesAlvo`. Dava para inferir —
   hoje só o `montarRemendo` passa nomes —, e é exatamente por isso que não: a
   inferência fica certa até alguém passar nomes por outro motivo, e aí a rodada
   que escreve em produção mudaria de esforço em silêncio. */
async function umaRodada(s, gen, forcado, nomesAlvo, ehPatch) {
  s.status = "correndo";
  /* `forcado` é instrução que vem de FORA da rodada, e ela tem de sobreviver a
     esta linha. `s.correcoes` é estado interno do laço de correção — zerado a cada
     rodada — então o `conduzir` escrevendo nele ANTES de chamar aqui nunca chegava
     ao modelo: a instrução de teto de evidência era apagada antes de ser lida. */
  s.correcoes = forcado ? [forcado] : [];
  emit(s, "estado", enxuto(s));
  /* Gravado JÁ EM `correndo`, e é isso que torna o oitavo estado detectável: se o
     cockpit fechar agora, o arquivo fica dizendo `correndo` sem ninguém rodando,
     e a lista distingue isso de "correndo agora" pelo fato `viva`. Gravar só
     depois da rodada faria uma conversa morta no meio voltar como se a rodada
     nunca tivesse começado — e o gasto dela sumiria com ela. */
  guardar(s);

  for (let tentativa = 0; tentativa <= MAX_CORRECOES; tentativa++) {
    const alvoArq = path.join(s.dir, "resposta.json");
    try { await fsp.unlink(alvoArq); } catch { /* não existia */ }

    const r = await rodar(s, gen, ehPatch);
    if (!vivo(s, gen)) return null;

    if (r.erro) { diz(s, r.erro, "erro"); s.status = "falhou"; s.erro = r.erro; emit(s, "estado", enxuto(s)); guardar(s); return null; }

    let bruto;
    try { bruto = await fsp.readFile(alvoArq, "utf8"); }
    catch {
      s.correcoes = ["você não escreveu `resposta.json`. Escreva o arquivo, com uma das duas formas de `REGRAS.md`"];
      diz(s, "a rodada não escreveu `resposta.json` — pedindo de novo", "warn");
      continue;
    }

    /* Os nomes válidos são os do fluxo ALVO, não os do fluxo aberto. Quando o §4.5
       trocou o alvo para um filho, validar contra o índice do pai aceitaria nomes
       que não existem onde o patch vai ser aplicado — e o erro só apareceria lá na
       frente, no `applyPatch`, sem dizer que a causa foi olhar o documento errado. */
    const v = validarResposta(bruto, nomesAlvo || s.nomes, basesDaSessao(s));
    if (!v.ok) {
      s.correcoes = v.erros;
      for (const e of v.erros) diz(s, "recusado: " + e, "warn");
      continue;
    }

    if (!vivo(s, gen)) return null;
    return v.valor;
  }

  s.status = "falhou";
  s.erro = "a sessão não conseguiu escrever uma resposta válida em " + (MAX_CORRECOES + 1) + " tentativas";
  diz(s, s.erro, "erro");
  emit(s, "estado", enxuto(s));
  guardar(s);
  return null;
}

/* Quantas voltas de evidência uma pergunta pode dar. Cada pedido é uma RODADA
 * NOVA — sessão nova do CLI, cota nova — então isto é teto de gasto, não de
 * paciência. Três é o que uma investigação de verdade precisou: listar as
 * execuções, abrir uma, seguir o sub-fluxo.
 *
 * Batido o teto, ela é obrigada a responder com o que tem. Uma sessão que pede
 * para sempre gasta a cota inteira sem nunca dizer uma frase — e o pior é que
 * cada volta PARECE progresso na tela. */
const MAX_PEDIDOS = 3;

async function conduzir(s, gen) {
  try {
    /* ── o laço da evidência ───────────────────────────────────────────────── */
    s.evidencias = s.evidencias || [];
    let v = null;
    for (let volta = 0; volta <= MAX_PEDIDOS; volta++) {
      v = await umaRodada(s, gen);
      if (!v || !vivo(s, gen)) return;
      if (v.tipo !== "pedido") break;

      if (volta === MAX_PEDIDOS) {
        /* A rodada forçada acontece AQUI, não numa volta a mais do laço.
         *
         * O defeito medido: `continue` incrementava `volta` para além da condição,
         * o laço terminava, e `v` ainda era o PRÓPRIO PEDIDO — que caía no ramo do
         * alvo e virava `{tipo:"alvo", texto: undefined}`, apresentado na tela como
         * pronto para confirmar. Pedido de evidência exibido como alvo confirmável é
         * a pior troca que esta tela pode fazer, porque o botão seguinte escreve.
         *
         * E a instrução vai por parâmetro, não por `s.correcoes`: aquele campo é
         * zerado no topo de `umaRodada`, então escrevê-lo daqui nunca funcionou. */
        const teto = "você já pediu evidência " + MAX_PEDIDOS + " vezes nesta pergunta, que é o teto. "
          + "Responda com `tipo: \"resposta\"` usando o que já está em `evidencia/` — e diga o que "
          + "ficou sem confirmar, se ficou.";
        diz(s, "teto de " + MAX_PEDIDOS + " pedidos de evidência nesta pergunta — pedindo a resposta com o que já tem", "warn");
        v = await umaRodada(s, gen, teto);
        if (!v || !vivo(s, gen)) return;
        if (v.tipo === "pedido") {
          /* Insistiu mesmo com o teto dito. Não existe alvo nem resposta para
             mostrar, e inventar qualquer um dos dois seria pior que devolver a vez.
             Esta frase é do COCKPIT, não do modelo — por isso a procedência é
             `codigo`, e não a de uma resposta que se apoiou em evidência. */
          s.chat.push({
            de: "ele", tipo: "resposta",
            texto: "Pedi evidência " + MAX_PEDIDOS + " vezes e ainda precisaria de mais uma busca "
              + "para fechar isto — que é o teto desta pergunta. Me diga a janela de datas, ou "
              + "refaça a pergunta mais estreita, e eu volto com resposta em vez de outro pedido.",
            perguntas: [], base: ["fluxo"], procedencia: "codigo",
            em: new Date().toISOString()
          });
          s.alvo = null;
          s.status = "aguardando";
          emit(s, "estado", enxuto(s));
          guardar(s);
          return;
        }
        break;
      }

      const n = s.evidencias.length + 1;
      const arq = "evidencia/" + n + "-" + v.pedido.oque + ".json";
      atividade(s, "buscando no n8n: " + v.pedido.oque);
      diz(s, "ela pediu evidência: " + v.pedido.oque + (v.porque ? " — " + v.porque : ""), "info");
      try {
        /* A varredura profunda pode levar minutos (medido: 179s para as 1941
           execuções que esta instância guarda), e a linha de atividade era escrita
           uma vez e nunca mais. Uma tela parada por três minutos lê como travada, e
           quem está esperando não tem como saber se ainda está indo.
           `parar` é o outro lado da mesma coisa: cancelar precisa parar a CARGA, não
           só jogar o resultado fora — a varredura ocupa os 4 slots do `n8n.js`, e é o
           poll do painel que fica sem eles. */
        const r = await evidencia.atender(v.pedido, {
          parar: () => !vivo(s, gen),
          aoProgresso: p => {
            if (!vivo(s, gen)) return;
            atividade(s, "varrendo execuções: " + p.abertas + " de " + p.de
              + (p.achados ? " · " + p.achados + " casaram" : "")
              + " · " + Math.round(p.ms / 1000) + "s");
          }
        });
        if (!vivo(s, gen)) return;
        await fsp.mkdir(path.join(s.dir, "evidencia"), { recursive: true });
        await fsp.writeFile(path.join(s.dir, arq), JSON.stringify(r, null, 2), "utf8");
        const linha = evidencia.resumo(v.pedido, r);
        s.evidencias.push({ arquivo: arq, pedido: v.pedido, resumo: linha });
        /* Uma leitura que voltou vazia NÃO entra como `good`. O nível é o que a
           tela pinta e o que a sessão lê como confiança — um grafo de 0 nós
           anunciado em verde fez uma sessão concluir que um fluxo ativo estava
           vazio. */
        diz(s, "→ " + arq + " · " + linha, /^NÃO CONSEGUI/.test(linha) ? "warn" : "good");
      } catch (e) {
        /* A busca falhou — e isso é FATO que volta para ela, não erro da conversa.
           "A execução 999 não existe" é uma resposta útil; matar a conversa por
           causa disso não é. */
        const msg = String(e && e.message || e).slice(0, 200);
        s.evidencias.push({ arquivo: null, pedido: v.pedido, resumo: "FALHOU: " + msg });
        diz(s, "o pedido de evidência falhou: " + msg, "warn");
      }
      emit(s, "estado", enxuto(s));
      guardar(s);
    }

    if (v.tipo === "resposta") {
      /* A procedência viaja no chat, então ela entra no snapshot e a tela pode
         mostrar em que a frase se apoia. Sem isso, "isto eu vi numa execução" e
         "isto eu li na prosa do dossiê" chegam iguais — que é o defeito medido. */
      s.chat.push({
        de: "ele", tipo: "resposta", texto: v.texto, perguntas: v.perguntas,
        base: v.base, procedencia: v.procedencia, em: new Date().toISOString()
      });
      diz(s, "resposta " + PROC_FRASE[v.procedencia] + " — base: " + v.base.join(", "),
        PROC_NIVEL[v.procedencia]);
      s.alvo = null;
      s.status = "aguardando";
    } else {
      /* §4.5 — em qual fluxo cada nó do alvo mora, ANTES de a tela apresentar o
         alvo. Um upgrade não tem assinatura de erro, então não existe
         `lastNodeExecuted` para desempatar: onde `claude-fix.js` escolhe, aqui se
         bloqueia. Sem isto o patch pode remendar o PAI e nunca tocar o filho de
         verdade — válido, com portões verdes, e sem efeito nenhum. */
      atividade(s, "conferindo em qual fluxo os nós do alvo moram");
      let res;
      try {
        res = await resolverAlvoNoN8n(s.wfId, s.wfNome, v.nos);
      } catch (e) {
        /* Falha de leitura NÃO libera o alvo. É exatamente o estado em que decidir
           sozinho escreve no fluxo errado. */
        res = {
          estado: "bloqueado", wfIdAlvo: null, wfNomeAlvo: null, redirecionado: null, porNo: [],
          bloqueio: {
            motivo: "incompleto", nos: [],
            frase: "não consegui conferir em qual fluxo os nós moram: "
              + String(e && e.message || e).slice(0, 200)
              + ". Enquanto isso não fecha, o patch fica parado — remendar o fluxo errado é pior que esperar."
          }
        };
      }
      if (!vivo(s, gen)) return;
      s.resolucao = res;

      if (res.estado === "trocar") {
        diz(s, "o alvo mora em `" + (res.wfNomeAlvo || res.wfIdAlvo) + "`, chamado por `"
          + res.redirecionado.viaNode + "` — o patch escreveria LÁ, não em `" + s.wfNome + "`", "warn");
      } else if (res.estado === "bloqueado") {
        diz(s, "alvo bloqueado (" + res.bloqueio.motivo + "): " + res.bloqueio.frase, "warn");
      }

      s.chat.push({ de: "ele", tipo: "alvo", texto: v.resumo, em: new Date().toISOString() });
      s.alvo = v;
      s.status = "alvo";   // esperando ele confirmar no desenho
    }
    emit(s, "estado", enxuto(s));
    guardar(s);
  } catch (e) {
    // Matar o filho faz a rodada estourar. Isso não é defeito nosso: se a sessão
    // não está mais viva, quem mandou parar foi ele, e chamar isso de "quebrou"
    // seria acusar o cockpit de um problema que não existe.
    if (!vivo(s, gen)) return;
    s.status = "falhou";
    s.erro = "quebrou: " + String(e && e.message || e);
    diz(s, s.erro, "erro");
    emit(s, "estado", enxuto(s));
    guardar(s);
  }
}


/* ───────────────────────────── §4.5 — em qual fluxo o alvo mora de verdade ──── */

/* O caminho de correção resolve isto com `followSubWorkflow`, guiado pela
 * assinatura de erro: `lastNodeExecuted` é a evidência que desempata. **Um upgrade
 * não tem assinatura** — ninguém falhou, então não existe nada apontando para o
 * filho certo. É essa ausência que faz este bloco BLOQUEAR onde `claude-fix.js`
 * escolhe.
 *
 * O defeito que ele existe para impedir tem nome: remendar o PAI e nunca tocar o
 * filho de verdade. O patch sairia válido, os portões passariam, o diff apareceria
 * na tela inteiro — e o nó descrito nele continuaria intacto, num fluxo que
 * ninguém abriu. Medido nesta instância: `Convert text to speech` existe em
 * `Agente Iago Comercial` E em `Agente eContrate`.
 *
 * Nada aqui escreve. É leitura e veredito. */

const ONDE = {
  local:      "está no fluxo aberto",
  filho:      "está num sub-fluxo",
  ambiguo:    "existe em mais de um sub-fluxo",
  incompleto: "a leitura não terminou",
  sumido:     "não achei em lugar nenhum"
};

/* PURA de propósito: recebe o que o n8n já respondeu e devolve o veredito, sem
   rede nenhuma. É o que permite testar os cinco estados e as quatro agregações
   sem abrir conexão — mesma razão de `custoDaRodada()` ter sido extraída.

   Um nó marcado `novo` ainda não existe em lugar nenhum, então não há o que
   localizar: ele nasce no fluxo que o patch acabar mirando. Resolver os que já
   existem é justamente o que decide qual fluxo é esse. */
function resolverAlvo(wfId, wfNome, nos, locais) {
  const porNo = [];

  for (const n of nos || []) {
    const nome = String(n && n.nome || "");
    if (!nome) continue;

    if (n.novo) { porNo.push({ nome, novo: true, onde: "novo" }); continue; }

    const loc = locais instanceof Map ? locais.get(nome) : (locais || {})[nome];

    /* Falha de leitura NÃO é ausência: um `locateNode` que estourou é exatamente o
       caso em que decidir sozinho escreve no fluxo errado. */
    if (!loc || loc.erro) {
      porNo.push({
        nome, novo: false, onde: "incompleto",
        porque: "não consegui ler: " + String(loc && loc.erro || "sem resposta")
      });
      continue;
    }

    if (loc.inWorkflow) { porNo.push({ nome, novo: false, onde: "local" }); continue; }

    const subs = Array.isArray(loc.subflows) ? loc.subflows : [];
    const tem = subs.filter(x => x.hasNode === true);
    const naoLidos = subs.filter(x => x.hasNode === null);

    if (tem.length > 1) {
      porNo.push({
        nome, novo: false, onde: "ambiguo",
        candidatos: tem.map(x => ({ id: x.childId, nome: x.childName, viaNode: x.viaNode }))
      });
      continue;
    }

    if (tem.length === 1) {
      /* Achou UM — mas se sobrou filho por ler, ou o scan bateu o teto, esse "um"
         pode ser o primeiro de dois. A ambiguidade medida (o mesmo nome em dois
         filhos) é exatamente o que ficaria escondido atrás de uma leitura
         incompleta, e ela some sem deixar sintoma. */
      if (naoLidos.length || loc.truncado) {
        porNo.push({
          nome, novo: false, onde: "incompleto",
          porque: loc.truncado
            ? "achei em `" + (tem[0].childName || tem[0].childId) + "`, mas parei em "
              + subs.length + " de " + loc.candidatos + " sub-fluxos chamados — pode haver outro com o mesmo nome"
            : "achei em `" + (tem[0].childName || tem[0].childId) + "`, mas " + naoLidos.length
              + " sub-fluxo(s) não abriram, e o mesmo nome pode estar num deles",
          parcial: { id: tem[0].childId, nome: tem[0].childName, viaNode: tem[0].viaNode }
        });
        continue;
      }
      porNo.push({
        nome, novo: false, onde: "filho",
        destino: { id: tem[0].childId, nome: tem[0].childName, viaNode: tem[0].viaNode }
      });
      continue;
    }

    /* Zero casamentos. Leitura completa quer dizer que o nó realmente não está a um
       salto; leitura incompleta quer dizer ignorância. As duas NÃO podem sair
       iguais: tratar ignorância como "então é aqui" é o defeito de 4.5 inteiro. */
    if (naoLidos.length || loc.truncado) {
      porNo.push({
        nome, novo: false, onde: "incompleto",
        porque: loc.truncado
          ? "olhei " + subs.length + " de " + loc.candidatos + " sub-fluxos chamados e parei no teto"
          : naoLidos.length + " sub-fluxo(s) não abriram, então não sei dizer se o nó está num deles"
      });
      continue;
    }
    porNo.push({ nome, novo: false, onde: "sumido" });
  }

  const existentes = porNo.filter(p => !p.novo);
  const travados = existentes.filter(p => p.onde === "ambiguo" || p.onde === "incompleto" || p.onde === "sumido");

  if (travados.length) {
    return {
      estado: "bloqueado",
      wfIdAlvo: null, wfNomeAlvo: null, redirecionado: null, porNo,
      bloqueio: {
        motivo: travados.some(p => p.onde === "ambiguo") ? "ambiguo" : "incompleto",
        frase: fraseBloqueio(travados),
        nos: travados
      }
    };
  }

  /* Um patch, um fluxo. Alvo espalhado entre o pai e um filho não é um patch que dá
     para mostrar num diff — seriam dois, em dois documentos, e o botão diria
     "aplicar" sem dizer onde. */
  const destinos = new Map();
  for (const p of existentes) {
    const id = p.onde === "local" ? String(wfId) : String(p.destino.id);
    if (!destinos.has(id)) destinos.set(id, p);
  }

  if (destinos.size > 1) {
    return {
      estado: "bloqueado",
      wfIdAlvo: null, wfNomeAlvo: null, redirecionado: null, porNo,
      bloqueio: {
        motivo: "dividido",
        frase: "os nós deste alvo moram em fluxos diferentes, e um patch escreve num "
          + "documento só. Diga por qual começar — o outro vira uma segunda conversa.",
        nos: existentes
      }
    };
  }

  /* Nenhum nó existente: o alvo só cria nós, e eles nascem no fluxo aberto. */
  if (!destinos.size) {
    return { estado: "local", wfIdAlvo: String(wfId), wfNomeAlvo: wfNome || null, redirecionado: null, bloqueio: null, porNo };
  }

  const [idAlvo, exemplo] = [...destinos.entries()][0];
  if (idAlvo === String(wfId)) {
    return { estado: "local", wfIdAlvo: String(wfId), wfNomeAlvo: wfNome || null, redirecionado: null, bloqueio: null, porNo };
  }

  /* Troca de alvo. A tarja é a MESMA do caminho de correção, e ela não é opcional:
     ele abriu o fluxo X e o patch escreveria no Y. Deixar isso implícito seria a
     pior escrita que este código pode fazer. */
  return {
    estado: "trocar",
    wfIdAlvo: idAlvo,
    wfNomeAlvo: exemplo.destino.nome || null,
    redirecionado: {
      deId: String(wfId), deNome: wfNome || null,
      viaNode: exemplo.destino.viaNode,
      paraId: idAlvo, paraNome: exemplo.destino.nome || null
    },
    bloqueio: null, porNo
  };
}

/* A frase carrega O QUE FOI LIDO E O QUE NÃO FOI, porque é isso que permite a ele
   desempatar à mão. "Não consegui decidir" sem a lista é um beco sem saída. */
function fraseBloqueio(travados) {
  const amb = travados.filter(p => p.onde === "ambiguo");
  if (amb.length) {
    const p = amb[0];
    return "`" + p.nome + "` existe em " + p.candidatos.length + " sub-fluxos: "
      + p.candidatos.map(c => "`" + (c.nome || c.id) + "`").join(", ")
      + ". Sem uma falha para desempatar não há evidência de qual é o certo, e "
      + "escolher seria escrever no fluxo errado. Diga qual.";
  }
  const p = travados[0];
  return "não consegui provar onde `" + p.nome + "` mora: " + (p.porque || ONDE[p.onde])
    + ". Enquanto isso não fecha, o patch fica parado — remendar o fluxo errado é "
    + "pior que esperar.";
}

/* O invólucro que fala com o n8n. Separado da função pura acima por isso mesmo: o
   veredito é testável sem rede, e aqui só mora a busca. Um `locateNode` que estoura
   vira `erro` naquele nó em vez de derrubar a rodada — falha de leitura é um estado
   previsto, e o veredito sabe o que fazer com ela. */
async function resolverAlvoNoN8n(wfId, wfNome, nos) {
  const locais = new Map();
  for (const n of nos || []) {
    if (!n || !n.nome || n.novo) continue;
    if (locais.has(n.nome)) continue;
    try { locais.set(n.nome, await n8n.locateNode(wfId, n.nome)); }
    catch (e) { locais.set(n.nome, { erro: String(e && e.message || e).slice(0, 200) }); }
  }
  return resolverAlvo(wfId, wfNome, nos, locais);
}

/* ═══════════════════════════ §4 — a rodada que escreve o patch ═════════════
 *
 * Confirmar o alvo é o que dispara isto. A etapa 1 do §3.4 leu o dossiê (ou o
 * índice) e disse EM PROSA onde mexer; a etapa 2 recebe o valor EXATO dos campos
 * dos nós alvo e escreve o patch. Duas etapas porque medir saiu 13KB contra 285KB
 * — 22× — e porque o checkpoint entre elas é o mais barato que existe.
 *
 * O PATCH É APLICADO A UMA CÓPIA EM MEMÓRIA, e é dela que sai o diff — o fluxo
 * vivo só é escrito no §6, atrás do botão, e por `fix.escreverAprovado`, nunca
 * por um `putWorkflow` daqui. O que já sai do processo nesta etapa é uma coisa
 * só, e ela tem nome: a `checagem7` da bateria grava a cópia INATIVA
 * `[SANDBOX upgrade]` para o n8n dizer se aceita o schema. É a única escrita que
 * acontece antes de ele aprovar qualquer coisa, e é desligável exatamente por
 * isso (`COCKPIT_UPGRADE_SANDBOX=0`). */

/* Os arquivos do fluxo ALVO, que pode não ser o fluxo aberto.
 *
 * Se o §4.5 trocou o alvo para um filho, os nomes de nó válidos são os DELE — um
 * patch validado contra o índice do pai citaria nós que não existem onde ele vai
 * ser aplicado, e o erro só apareceria no `applyPatch`, sem dizer que a causa foi
 * olhar o documento errado. */
async function prepararAlvo(s) {
  const wfId = s.resolucao && s.resolucao.wfIdAlvo ? s.resolucao.wfIdAlvo : s.wfId;
  const bruto = await n8n.getRawWorkflow(wfId);
  /* O documento cru carrega credencial. O que vai para o diretório da sessão é o
     sanitizado, sempre — mesma disciplina do `claude-fix.js`, e é por isso que a
     sessão nunca viu um segredo neste projeto. */
  const limpo = fix.sanitizedWorkflow(bruto);
  const nomes = new Set((limpo.nodes || []).map(n => String(n.name)));

  const alvos = (s.alvo.nos || []).filter(n => !n.novo).map(n => n.nome);
  await fsp.writeFile(path.join(s.dir, "alvo-fluxo.json"), JSON.stringify(limpo, null, 2), "utf8");
  await fsp.writeFile(path.join(s.dir, "alvo-nodes-index.md"), fix.nodesIndex(limpo, alvos[0] || null), "utf8");

  /* `target-nodes.json` é a etapa 2: os nós alvo mais os vizinhos de um salto, com
     o valor exato de cada campo. É o que permite escrever `updateNodes` sem
     reler 285KB — e é o único lugar da conversa onde o valor cru de um parâmetro
     aparece para a sessão, porque sem ele o patch é escrito no escuro. */
  const alvoNos = [];
  const vistos = new Set();
  for (const nome of alvos) {
    for (const nd of fix.targetNodes(limpo, nome) || []) {
      const k = String(nd && nd.name || "");
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      alvoNos.push(nd);
    }
  }
  await fsp.writeFile(path.join(s.dir, "target-nodes.json"), JSON.stringify(alvoNos, null, 2), "utf8");

  /* O CARIMBO DO DOCUMENTO QUE ESTE PATCH DESCREVE.
     Sem ele, `escreverAprovado` recebe `null` e a recusa por `updatedAt` — a
     guarda que impede sobrescrever uma edição feita no editor do n8n enquanto a
     conversa estava aberta — é PULADA. Ela é escrita como
     `if (capturedUpdatedAt && ...)`, então a ausência não falha fechada: falha
     aberta, em silêncio, no único caminho que escreve em produção. */
  return { wfId, bruto, limpo, nomes, quantos: alvoNos.length, updatedAt: bruto.updatedAt || null };
}

/* A instrução da rodada. Vai por parâmetro (`forcado`), não por `s.correcoes`:
   aquele campo é zerado no topo de `umaRodada`, e escrever nele daqui nunca
   funcionou — é o defeito que o teto de evidência já pagou. */
function instrucaoPatch(s, ctx) {
  const r = s.resolucao || {};
  const troca = r.estado === "trocar"
    ? "\n\nATENÇÃO: o alvo NÃO é o fluxo que estava aberto. Os nós que você vai mexer moram em `"
      + (r.wfNomeAlvo || r.wfIdAlvo) + "`, que é chamado por `" + (r.redirecionado || {}).viaNode
      + "`. Os arquivos `alvo-fluxo.json`, `alvo-nodes-index.md` e `target-nodes.json` são DESSE fluxo — "
      + "use os nomes de nó de lá, não os do índice do fluxo aberto."
    : "";
  return "O Kauan confirmou o alvo. Agora escreva o PATCH.\n\n"
    + "Leia `target-nodes.json` — são os nós do alvo mais os vizinhos de um salto, com o valor exato de "
    + "cada campo (" + ctx.quantos + " nós). Confira nome de nó em `alvo-nodes-index.md`. "
    + "`alvo-fluxo.json` está aí para `Grep`, e ler ele inteiro gasta o contexto que devia ir para a decisão."
    + troca
    + "\n\nEscreva `resposta.json` com `tipo: \"patch\"`, na forma que o `REGRAS.md` descreve. "
    + "Se faltar uma decisão que muda o que vai ser escrito — qual canal, qual tabela, qual campo — "
    + "isso NÃO vai dentro do patch: responda `tipo: \"resposta\"` com as perguntas em `perguntas`. "
    + "Perguntar de volta é mais barato que patchar errado.";
}

/* Aplica numa CÓPIA, roda os portões, monta o diff. Devolve o veredito inteiro —
   nunca decide se ele é bom, que é juízo da tela. */
function avaliarPatch(limpo, patch) {
  const portoes = [];
  const ap = fix.applyPatch(limpo, patch);
  portoes.push({
    nome: "o patch se aplica ao documento de hoje", ok: !ap.errors.length,
    frase: ap.errors.length ? ap.errors.join(" · ") : null
  });
  if (!ap.workflow) return { ok: false, portoes, diff: null, proposta: null };

  const v = fix.validate(limpo, ap.workflow);
  for (const g of v.gates) portoes.push({ nome: g.label, ok: g.ok, frase: g.detail });

  /* §4.3 — o portão do placeholder. Ele já reprovou na validação da resposta; roda
     de novo aqui porque o veredito da tela tem de mostrar TODOS os portões, e um
     portão que só existe quando falha não dá para conferir quando passa. */
  const pre = preencher.portaPreencher(patch);
  portoes.push({
    nome: "nenhum campo do patch ficou com marcador de preencher", ok: pre.ok,
    frase: pre.ok ? null : pre.erros.join(" · ")
  });

  const ok = portoes.every(g => g.ok);
  return { ok, portoes, diff: ok ? fix.diffWorkflow(limpo, ap.workflow) : null, proposta: ap.workflow };
}

/* Confirmar o alvo. Dispara a rodada e devolve o snapshot na hora — a rodada leva
   minutos, e segurar a resposta HTTP até ela acabar mataria a conexão. */
async function confirmarAlvo(id) {
  const s = sessoes.get(id);
  if (!s) return { erro: "conversa desconhecida", status: 404 };
  if (s.status === "correndo") return { erro: "esta conversa já está rodando", status: 409 };
  if (!s.alvo) return { erro: "não há alvo para confirmar", status: 409 };

  const r = s.resolucao;
  /* Ausente NÃO é liberado. Uma conversa reaberta de antes do §4.5 não passou pela
     conferência, e confirmar ali montaria um patch sem ninguém ter provado em qual
     fluxo os nós moram — que é exatamente o que aquela etapa existe para impedir. */
  if (!r) return { erro: "este alvo não passou pela conferência de em qual fluxo os nós moram — "
    + "refaça a pergunta para conferir antes de confirmar", status: 409 };
  if (r.estado === "bloqueado") return { erro: "o alvo está bloqueado: " + r.bloqueio.frase, status: 409 };

  const gen = ++s.gen;
  montarRemendo(s, gen);   // sem await de propósito: a rodada roda em segundo plano
  return enxuto(s);
}

async function montarRemendo(s, gen) {
  try {
    s.remendo = null;
    atividade(s, "lendo os nós do alvo");
    const ctx = await prepararAlvo(s);
    if (!vivo(s, gen)) return;
    diz(s, "montando o patch contra `" + (s.resolucao.wfNomeAlvo || s.wfNome) + "` — "
      + ctx.quantos + " nós no `target-nodes.json`", "info");

    let instrucao = instrucaoPatch(s, ctx);
    for (let volta = 0; volta <= MAX_CORRECOES; volta++) {
      const v = await umaRodada(s, gen, instrucao, ctx.nomes, true);
      if (!v || !vivo(s, gen)) return;

      /* Ela pode responder em vez de patchar, e isso é legítimo: o prompt manda
         perguntar quando falta decisão que muda o que vai ser escrito. */
      if (v.tipo !== "patch") {
        s.chat.push({
          de: "ele", tipo: "resposta", texto: v.texto || v.resumo, perguntas: v.perguntas || [],
          base: v.base, procedencia: v.procedencia, em: new Date().toISOString()
        });
        s.status = "aguardando";
        emit(s, "estado", enxuto(s));
        guardar(s);
        return;
      }

      const av = avaliarPatch(ctx.limpo, v.patch);
      if (!vivo(s, gen)) return;

      if (!av.ok) {
        const ruins = av.portoes.filter(g => !g.ok);
        for (const g of ruins) diz(s, "portão vermelho: " + g.nome + (g.frase ? " — " + g.frase : ""), "warn");
        if (volta === MAX_CORRECOES) {
          /* Não virou proposta. A tela mostra os portões vermelhos e NÃO oferece
             botão nenhum — um patch que não passa nunca vira botão. */
          s.remendo = {
            resumo: v.resumo, wfIdAlvo: ctx.wfId,
            wfNomeAlvo: s.resolucao.wfNomeAlvo || s.wfNome,
            capturedUpdatedAt: ctx.updatedAt, patch: v.patch,
            diff: null, portoes: av.portoes,
            /* Sem bateria porque não houve o que conferir: o patch não chegou a
               virar um documento válido. `null` e "rodou e não achou nada" são
               coisas diferentes, e a tela distingue as duas. */
            bateria: null, aplicavel: false,
            base: v.base, procedencia: v.procedencia
          };
          s.status = "aguardando";
          diz(s, "o patch não passou nos portões em " + (MAX_CORRECOES + 1) + " tentativas", "erro");
          emit(s, "estado", enxuto(s));
          guardar(s);
          return;
        }
        /* O texto do portão volta LITERAL para o modelo — é o laço que já funciona
           no `claude-fix.js`, e reescrever a frase aqui criaria uma segunda versão
           do que deu errado. */
        instrucao = "O patch que você escreveu não passou nestes portões:\n- "
          + ruins.map(g => g.nome + (g.frase ? ": " + g.frase : "")).join("\n- ")
          + "\n\nCorrija e escreva `resposta.json` de novo, com `tipo: \"patch\"`.";
        continue;
      }

      s.remendo = {
        resumo: v.resumo, wfIdAlvo: ctx.wfId,
        wfNomeAlvo: s.resolucao.wfNomeAlvo || s.wfNome,
        capturedUpdatedAt: ctx.updatedAt,
        patch: v.patch,
        diff: av.diff, portoes: av.portoes,
        bateria: null,
        /* Nasce false e só vira true depois de a bateria responder. A ordem
           importa: o campo que a tela lê para mostrar o botão de ESCREVER em
           produção nunca pode existir num estado em que ninguém conferiu nada. */
        aplicavel: false,
        base: v.base, procedencia: v.procedencia
      };
      /* O diff aparece ANTES da bateria, de propósito: ele já é útil para ler, e a
         bateria leva segundos (a checagem 7 escreve a cópia inativa). É isso que
         faz as sete linhas acenderem uma a uma na tela em vez de tudo surgir de
         uma vez no fim. */
      emit(s, "estado", enxuto(s));
      atividade(s, "verificando o upgrade");
      const bat = await rodarBateria(s, ctx.limpo, av.proposta, v.patch, s.id);
      if (!vivo(s, gen)) return;
      s.remendo.bateria = { linhas: bat.linhas, bloqueia: bat.bloqueia, correndo: bat.correndo,
        podeAplicar: bat.podeAplicar };
      /* DERIVADO, nunca digitado. Enquanto a escrita não existia isto era um
         `false` fixo com um comentário pedindo para não esquecer — e "não
         esquecer" não é garantia. Agora é a bateria que responde. */
      s.remendo.aplicavel = !!bat.podeAplicar;
      for (const l of bat.linhas.filter(x => x.cor === "risk")) diz(s, "bateria: " + l.nome + " reprovou — " + l.frase, "warn");

      /* §5.7.1/§5.7.2 — se o que reprovou foi a credencial de um nó NOVO, existe
         uma saída, e ela é uma PROPOSTA INDEPENDENTE: patch próprio, diff próprio
         e bateria própria. Nunca compartilha veredito com a de cima. */
      const credRuim = bat.linhas.some(l => l.n === "4" && l.cor === "risk");
      const pd = credRuim ? patchDesligado(v.patch) : null;
      if (pd) {
        const avd = avaliarPatch(ctx.limpo, pd);
        if (avd.ok) {
          const batd = await rodarBateria(s, ctx.limpo, avd.proposta, pd, s.id + "d");
          if (!vivo(s, gen)) return;
          s.remendo.desligado = {
            resumo: v.resumo + " (com o nó novo desligado)", wfIdAlvo: ctx.wfId,
            wfNomeAlvo: s.remendo.wfNomeAlvo, capturedUpdatedAt: ctx.updatedAt,
            patch: pd, diff: avd.diff, portoes: avd.portoes,
            bateria: { linhas: batd.linhas, bloqueia: batd.bloqueia, correndo: batd.correndo,
              podeAplicar: batd.podeAplicar },
            aplicavel: !!batd.podeAplicar, base: v.base, procedencia: v.procedencia
          };
          diz(s, "existe uma segunda proposta: o nó novo entra desligado e fora do caminho", "info");
        }
      }
      s.chat.push({ de: "ele", tipo: "patch", texto: v.resumo, base: v.base, procedencia: v.procedencia, em: new Date().toISOString() });
      s.status = "aguardando";
      diz(s, "patch pronto: " + av.diff.summary.modified + " nó(s) alterado(s), "
        + av.diff.summary.added + " novo(s) — nada disto está no n8n", "good");
      emit(s, "estado", enxuto(s));
      guardar(s);
      return;
    }
  } catch (e) {
    if (!vivo(s, gen)) return;
    s.status = "falhou";
    s.erro = "quebrou montando o patch: " + String(e && e.message || e);
    diz(s, s.erro, "erro");
    emit(s, "estado", enxuto(s));
    guardar(s);
  }
}

/* ══════════════════════ §5 checagem 7 e §6 — aplicar em produção ═══════════
 *
 * Este é o único bloco deste arquivo cujo efeito sai do processo. Tudo acima
 * lê, propõe e desenha; daqui para baixo escreve — a cópia sandbox da checagem
 * 7, e o fluxo vivo no approve.
 *
 * A sequência de escrita NÃO mora aqui. Ela é `escreverAprovado()` de
 * `claude-fix.js`: re-busca, recusa por `updatedAt`, reaplica sobre o documento
 * ATUAL, roda os portões de novo, grava o backup, e só então o `PUT` montado
 * campo por campo. Uma segunda cópia dessa sequência é inaceitável — é o único
 * caminho de escrita em produção do cockpit, e duas cópias divergem no primeiro
 * conserto feito num lado só (§6.1). O que esta aba fornece é o `revalidar`:
 * a bateria de sete, e não os dez portões da correção. */

/* A bateria vive em módulo próprio e é carregada com guarda: um checkout onde
   ela ainda não existe tem de FALHAR FECHADO — uma linha vermelha que bloqueia o
   botão — e nunca sumir em silêncio deixando o approve passar sem conferência
   nenhuma. Vermelho é exatamente a cor certa: não foi conferido. */
let bateriaMod = null;
try { bateriaMod = require("./bateria.js"); } catch { /* ainda não instalada */ }

const LINHA_SEM_BATERIA = {
  n: "1", nome: "Bateria de verificação", cor: "risk",
  frase: "o módulo `bateria.js` não está neste checkout, então nada foi conferido. "
    + "Aplicar sem a bateria é escrever em produção sem portão — o botão fica fora.",
  detalhe: null
};

const SANDBOX_PREFIX = "[SANDBOX upgrade] ";

/* A checagem 7 é a única do conjunto que ESCREVE — uma cópia inativa, antes de
 * o Kauan ter aprovado qualquer coisa. Por isso ela desliga, e o §5 já previa a
 * linha cinza "quando desligado".
 *
 * O padrão aqui é LIGADA, ao contrário do `COCKPIT_SANDBOX_TEST` do caminho de
 * correção. Os dois casos não são simétricos: lá o alvo já tinha assinatura de
 * erro e dez portões; aqui a checagem 7 é a única porta que não é opinião deste
 * processo — é o n8n dizendo se aceita o documento. Desligá-la por padrão
 * deixaria a decisão de escrever em produção apoiada só no que este processo
 * acha. `COCKPIT_UPGRADE_SANDBOX=0` desliga. */
const SANDBOX_LIGADO = process.env.COCKPIT_UPGRADE_SANDBOX !== "0";
const BT_ENV = "`COCKPIT_UPGRADE_SANDBOX=0`";

/* Checagem 7 — a única porta que não é opinião deste processo: o n8n aceita este
 * JSON? Escreve numa cópia INATIVA, nunca no fluxo real, e nunca apaga nada.
 *
 * `active` não vai no corpo, aqui nem no approve: aplicar um upgrade não pode
 * acordar fluxo dormente (§6.2).
 *
 * Ela roda DENTRO da região que `escreverAprovado` já segura, então é uma escrita
 * reentrante no mesmo dono. É por isso que a fila do `n8n.js` teve de ser
 * reentrante antes de esta aba existir: sem isso, a checagem 7 esperaria pelo
 * approve que está esperando por ela, e o sintoma seria uma tela parada para
 * sempre — indistinguível de n8n lento. */
async function checagem7(s, proposta, ownerRef) {
  /* Desligada é CINZA com o motivo escrito, nunca verde: "não conferi" e
     "conferi e passou" levam a decisões opostas, e aqui a decisão é escrever
     num fluxo que está rodando. Cinza não bloqueia — quem desligou sabe o que
     fez, e a linha diz o que deixou de ser perguntado. */
  if (!SANDBOX_LIGADO) {
    return { n: "7", nome: "Aceite do n8n", cor: "cold",
      frase: "o teste na instância está desligado (" + BT_ENV + "), então ninguém perguntou ao "
        + "n8n se ele aceita este documento. Isto NÃO é o mesmo que ele ter aceitado.",
      detalhe: null };
  }
  const nome = SANDBOX_PREFIX + String(s.remendo && s.remendo.wfNomeAlvo || s.wfNome || s.wfId).slice(0, 80);
  const corpo = {
    name: nome,
    nodes: proposta.nodes,
    connections: proposta.connections,
    settings: proposta.settings || { executionOrder: "v1" }
  };
  const dono = n8n.writeOwner("upgrade", ownerRef, "testando o upgrade numa cópia de " + (s.wfNome || s.wfId));
  try {
    let id = s.sandboxId || null;
    if (!id) {
      /* O nome atual é RELIDO antes de escrever: a cópia é reusada por nome, e
         escrever por id guardado numa sessão antiga poderia acertar outro fluxo
         se alguém tiver renomeado coisas no n8n. */
      const achado = await n8n.findWorkflowByName(nome);
      id = achado ? String(achado.id) : null;
    }
    if (id) await n8n.putWorkflow(dono, id, corpo, d => avisoSettings(s, d));
    else {
      const criado = await n8n.createWorkflow(dono, corpo, d => avisoSettings(s, d));
      id = criado && criado.id ? String(criado.id) : null;
    }
    s.sandboxId = id;
    return { n: "7", nome: "Aceite do n8n", cor: "ok",
      frase: "o n8n aceitou o documento na cópia inativa `" + nome + "`. Isso prova o SCHEMA, "
        + "não o comportamento — a cópia não tem credencial e não executa.", detalhe: null };
  } catch (e) {
    /* Falha de escrita da cópia é VERMELHO, não cinza: se o n8n recusa o
       documento na cópia, ele vai recusar no fluxo vivo — e o que está sendo
       decidido é justamente escrever no vivo. */
    return { n: "7", nome: "Aceite do n8n", cor: "risk",
      frase: "o n8n recusou o documento na cópia inativa: " + String(e && e.message || e).slice(0, 220),
      detalhe: null };
  }
}

function avisoSettings(s, dropped) {
  if (!dropped || !dropped.length) return;
  /* Um `PUT` REPLACE o `settings` inteiro, então chave descartada é chave REMOVIDA
     do fluxo — e essa mudança não estava no diff que ele aprovou. Dizer é
     obrigatório. */
  diz(s, "atenção: o n8n não aceita a(s) chave(s) de `settings` " + dropped.join(", ")
    + " — elas saem do fluxo, e isso não aparecia no diff", "warn");
}

/* §5.7.1 e §5.7.2 — o segundo patch, derivado por CÓDIGO.
 *
 * Quando o patch cria nó que exige credencial, a checagem 4 fica vermelha: o
 * `applyPatch` proíbe qualquer chave `credentials` (garantia de produção que não
 * será afrouxada), logo o patch não tem como anexar uma, e o nó entraria num
 * fluxo vivo com campo vazio para falhar na primeira execução.
 *
 * A saída é entrar FORA DO TRÁFEGO: nó com `disabled: true` e SEM o `rewire` que
 * o religaria. Incapaz de disparar.
 *
 * E ele é uma PROPOSTA INDEPENDENTE, não uma variação do primeiro — este é o
 * achado mais grave das três rodadas de revisão. O contrato do repositório é
 * *patch → diff mostrado → escrita idêntica ao diff*; um botão que aplicasse "o
 * mesmo patch, mas desligado" escreveria algo diferente do que estava na tela, ou
 * reusaria veredito de portão rodado sobre outro documento. Qualquer um dos dois
 * quebra a única garantia que o approve dá. Então ele tem diff próprio e bateria
 * própria, e os dois NUNCA compartilham veredito. */
function patchDesligado(patch) {
  const add = (patch.addNodes || []).map(a => Object.assign({}, a, { disabled: true }));
  if (!add.length) return null;   // sem nó novo, não há o que desligar
  return {
    updateNodes: patch.updateNodes || [],
    addNodes: add,
    /* O `rewire` sai INTEIRO. Religar parcialmente deixaria o nó desligado no
       caminho, e um nó desligado no meio de um `main` interrompe o fluxo — o
       oposto de "fora do tráfego". */
    rewire: {}
  };
}

/* Onde mora o backup: FORA do diretório da sessão, porque é o único arquivo que
   ainda carrega credencial (é o documento cru de antes da escrita) e a sessão do
   CLI tem `Read` naquele diretório. Mesma separação do `claude-fix.js`. */
function caminhoBackup(id) {
  return path.join(RAIZ, "_private", String(id) + ".json");
}

/* Aplicar. `qual` é "normal" ou "desligado", e a escolha vem do BOTÃO que ele
   clicou — nunca inferida aqui, porque os dois botões mostram diffs diferentes e
   escrever o que não estava na tela é o defeito que o §5.7.2 existe para impedir. */
async function aplicar(id, qual) {
  const s = sessoes.get(id);
  if (!s) return { erro: "conversa desconhecida", status: 404 };
  if (s.status === "correndo") return { erro: "esta conversa está rodando", status: 409 };

  const r = s.remendo;
  if (!r) return { erro: "não há patch para aplicar", status: 409 };
  const alvo = qual === "desligado" ? r.desligado : r;
  if (!alvo) return { erro: "não existe a versão «" + String(qual) + "» deste patch", status: 409 };
  if (!alvo.bateria || alvo.bateria.bloqueia || alvo.bateria.correndo) {
    return { erro: "a bateria não liberou este patch — o botão não deveria existir", status: 409 };
  }
  /* Fail-closed também aqui, e de propósito: a tela decide se mostra o botão, mas
     o servidor não confia na tela. Um POST direto na rota tem de bater na mesma
     regra. */
  if (!alvo.aplicavel) return { erro: "este patch não está marcado como aplicável", status: 409 };
  if (s.aplicado) return { erro: "este patch já foi aplicado — desfaça antes de aplicar de novo", status: 409 };

  await fsp.mkdir(path.dirname(caminhoBackup(s.id)), { recursive: true });
  const dono = n8n.writeOwner("upgrade", s.id, "aplicando upgrade em " + (r.wfNomeAlvo || s.wfNome));

  try {
    const res = await fix.escreverAprovado({
      owner: dono,
      wfId: r.wfIdAlvo,
      capturedUpdatedAt: r.capturedUpdatedAt || null,
      patch: alvo.patch,
      /* A BATERIA é o `revalidar`, e não os dez portões da correção. O primitivo
         não tem default de propósito: quem escreve declara com que portões, e um
         default silencioso faria um upgrade ser aprovado pelos portões de um
         conserto — a divergência exata que a extração existe para impedir. */
      revalidar: (atual, proposto) => rodarBateria(s, atual, proposto, alvo.patch, s.id),
      backupPath: caminhoBackup(s.id),
      onSettingsDropped: d => avisoSettings(s, d)
    });
    s.aplicado = { em: new Date().toISOString(), qual: qual === "desligado" ? "desligado" : "normal", wfId: r.wfIdAlvo };
    diz(s, "aplicado em `" + (r.wfNomeAlvo || s.wfNome) + "` — o backup está guardado e o ↺ Desfazer existe", "good");
    /* O ledger é o mesmo arquivo da correção, com `kind: "upgrade"` (etapa 1).
       O cap é por tipo, então um dia de upgrades não expulsa o histórico de
       correções. */
    await registrarNoLedger(s, alvo, res);
    s.status = "aguardando";
    emit(s, "estado", enxuto(s));
    guardar(s);
    return enxuto(s);
  } catch (e) {
    /* Uma escrita que falhou prova ausência de CONFIRMAÇÃO, não ausência de
       efeito (§6.3) — por isso não há repetição, e a frase não afirma que nada
       aconteceu. */
    const msg = String(e && e.message || e);
    diz(s, "não deu para aplicar: " + msg, "erro");
    emit(s, "estado", enxuto(s));
    return { erro: msg, status: e && e.status || 500, gates: e && e.gates || null };
  }
}

/* §6.4 — desfazer restaura o backup, igual ao caminho de correção. */
async function desfazer(id) {
  const s = sessoes.get(id);
  if (!s) return { erro: "conversa desconhecida", status: 404 };
  if (!s.aplicado) return { erro: "não há aplicação para desfazer", status: 409 };

  let backup;
  try { backup = JSON.parse(await fsp.readFile(caminhoBackup(s.id), "utf8")); }
  catch (e) { return { erro: "o backup desta aplicação não está mais em disco: " + String(e && e.message || e), status: 409 }; }

  const dono = n8n.writeOwner("upgrade", s.id, "desfazendo o upgrade em " + (s.remendo && s.remendo.wfNomeAlvo || s.wfNome));
  try {
    await n8n.putWorkflow(dono, s.aplicado.wfId, {
      name: backup.name,
      nodes: backup.nodes,
      connections: backup.connections,
      settings: backup.settings || { executionOrder: "v1" }
    }, d => avisoSettings(s, d));
    s.desfeito = { em: new Date().toISOString() };
    s.aplicado = null;
    diz(s, "desfeito — o fluxo voltou ao estado anterior à aplicação", "warn");
    emit(s, "estado", enxuto(s));
    guardar(s);
    return enxuto(s);
  } catch (e) {
    const msg = String(e && e.message || e);
    diz(s, "não deu para desfazer: " + msg, "erro");
    return { erro: msg, status: e && e.status || 500 };
  }
}

/* A bateria completa: as cinco de `bateria.js`, as duas de `regressao.js`, e a
 * checagem 7 daqui — que é a única que escreve.
 *
 * Devolve no formato que `escreverAprovado` espera (`{ok, gates}`) E as linhas
 * cruas, porque a tela precisa das sete com cor e frase, não de um booleano.
 *
 * `escreverAprovado` chama isto com o documento ATUAL, re-buscado no momento de
 * aplicar. Isso é o ponto: a bateria que decidiu mostrar o botão rodou sobre o
 * documento de minutos atrás, e a que autoriza a escrita roda sobre o de agora. */
/* Publica o parcial: a tela lê `remendo.bateria` e desenha o que já chegou,
   apagando o que falta. É chamado a cada linha resolvida.
   `correndo` é derivado da CONTAGEM, não de um sinalizador que alguém precisa
   lembrar de baixar no fim — um flag esquecido deixaria o overlay girando para
   sempre com a bateria pronta. */
/* PURA: o veredito a partir das linhas que já chegaram. Separada do `emit`
   porque a regra que ela decide — se o botão que ESCREVE EM PRODUÇÃO aparece —
   tem de ser testável sem montar uma sessão inteira. Mesma razão de
   `custoDaRodada()` e `resolverAlvo()` terem sido extraídas. */
function montarBateria(linhas) {
  const prontas = (linhas || []).filter(Boolean);
  const vermelha = prontas.some(l => l.cor === "risk");
  const completa = prontas.length >= TODAS_LINHAS.length;
  return {
    linhas: prontas.slice().sort((a, b) => ordemLinha(a.n) - ordemLinha(b.n)),
    todas: TODAS_LINHAS,
    /* `correndo` é derivado da CONTAGEM, nunca de um sinalizador que alguém
       precise lembrar de baixar no fim: um flag esquecido deixaria o overlay
       girando para sempre com a bateria pronta. */
    correndo: !completa,
    bloqueia: vermelha,
    /* Enquanto falta linha, NÃO pode aplicar — mesmo que nenhuma das que
       chegaram seja vermelha. "Ainda não reprovou" não é "passou", e a diferença
       aqui liga um botão que escreve num fluxo que está rodando. */
    podeAplicar: completa && !vermelha
  };
}

function publicarParcial(s, linhas) {
  if (!s || !s.remendo) return;
  s.remendo.bateria = montarBateria(linhas);
  emit(s, "estado", enxuto(s));
}

async function rodarBateria(s, atual, proposto, patch, ownerRef) {
  const linhas = [];

  if (!bateriaMod) {
    /* Falha FECHADA: sem o módulo, nada foi conferido, e nada conferido não pode
       virar autorização de escrita em produção. */
    linhas.push(LINHA_SEM_BATERIA);
    return { ok: false, gates: paraGates(linhas), linhas, bloqueia: true, correndo: false, podeAplicar: false };
  }

  /* As cinco do módulo resolvem em milissegundos (documento e catálogo já em
     memória), então elas são publicadas JUNTAS. Escaloná-las na tela seria
     inventar uma espera que não existe — e a régua deste painel é que movimento
     só acontece quando há informação nova atrás dele. O que demora de verdade é
     5a (lê execuções), 5b (o fantasma) e 7 (escreve a cópia). */
  const cedo = await bateriaMod.bateria({
    documento: atual, patch, proposta: proposto,
    contexto: { wfId: s.remendo && s.remendo.wfIdAlvo, wfNome: s.remendo && s.remendo.wfNomeAlvo,
      execucoes: s.execAmostra || null }
  });
  for (const l of (cedo && cedo.linhas || [])) if (l && l.n) linhas.push(l);
  publicarParcial(s, linhas);

  /* 5a e 5b vêm de fora e entram como linhas prontas — é o ponto de injeção que o
     `bateria.js` declara. Ele não busca execução nenhuma, e por isso a amostra é
     montada aqui, onde o n8n é alcançável. */
  const deFora = [];
  try {
    const reg = require("./regressao.js");
    const col = await amostraDeExecucoes(s, atual);
    if (typeof reg.regressaoCaminho === "function") {
      atividade(s, "conferindo a regressão de caminho");
      const l = await reg.regressaoCaminho({
        antes: atual, depois: proposto, patch,
        amostra: col.execucoes,
        /* Chamado UMA vez, e só se faltar cobertura — quem decide isso é a 5a,
           que é quem sabe que "não olhei o caminho que está sendo mexido" tem de
           virar cinza em vez de verde. */
        expandir: async () => (await amostraDeExecucoes(s, atual, true)).execucoes
      });
      if (l && l.n) { deFora.push(l); publicarParcial(s, linhas.concat(deFora)); }
    }
    if (typeof reg.regressaoConteudo === "function") {
      atividade(s, "conferindo a regressão de conteúdo");
      /* As MESMAS sementes dos dois lados. Sementes diferentes fariam a diferença
         que aparece ser da semente, não do patch — e a linha diria que o conteúdo
         mudou quando nada mudou. */
      const l = await reg.regressaoConteudo({ antes: atual, depois: proposto, seeds: s.seeds || null });
      if (l && l.n) { deFora.push(l); publicarParcial(s, linhas.concat(deFora)); }
    }
  } catch (e) {
    /* Módulo ausente ou que estourou vira CINZA — não bloqueia, mas diz por quê.
       Vermelho aqui seria acusar o patch de um defeito nosso; verde seria pior. */
    deFora.push({ n: "5a", nome: "Regressão de caminho", cor: "cold",
      frase: "não deu para conferir a regressão neste checkout: " + String(e && e.message || e).slice(0, 160),
      detalhe: null });
  }

  atividade(s, "perguntando ao n8n se ele aceita o documento");
  deFora.push(await checagem7(s, proposto, ownerRef));
  publicarParcial(s, linhas.concat(deFora));

  const r = await bateriaMod.bateria({
    documento: atual, patch, proposta: proposto,
    contexto: {
      wfId: s.remendo && s.remendo.wfIdAlvo, wfNome: s.remendo && s.remendo.wfNomeAlvo,
      execucoes: s.execAmostra || null,
      /* O ponto de injeção que o `bateria.js` declara. Ele monta as cinco dele e
         acrescenta estas, ordenando por `n`. */
      linhasExtras: deFora
    }
  });

  /* A FUSÃO É CONFERIDA, não presumida — e este parágrafo custou um teste
     vermelho para existir.
     A primeira versão passava as linhas de fora num campo de nome errado, o
     módulo as ignorou em silêncio, e a checagem 7 SUMIU do resultado: a cópia
     sandbox tinha sido escrita, e a tela não mostrava a linha que prova isso.
     Um contrato entre dois módulos que se resolve por nome de campo falha assim
     — calado, e no lado que menos se olha. Então o que foi injetado é reafirmado
     aqui, e uma linha que o módulo tenha devolvido para o mesmo `n` vence, porque
     ela é a que ele ordenou. */
  const doModulo = Array.isArray(r && r.linhas) ? r.linhas : [];
  const porN = new Map();
  for (const l of linhas.concat(deFora)) if (l && l.n) porN.set(String(l.n), l);
  for (const l of doModulo) if (l && l.n) porN.set(String(l.n), l);
  const todas = [...porN.values()].sort((a, b) => ordemLinha(a.n) - ordemLinha(b.n));
  /* Publica o conjunto FECHADO pelo mesmo caminho do parcial. Calcular
     `podeAplicar` aqui de novo criaria uma segunda definição da regra que decide
     se o botão de escrever em produção aparece — e duas definições divergem no
     primeiro ajuste feito num lado só. */
  publicarParcial(s, todas);
  const bloqueia = todas.some(l => l.cor === "risk");
  const correndo = todas.some(l => l.cor === "correndo");
  return { ok: !bloqueia && !correndo, gates: paraGates(todas), linhas: todas,
    bloqueia, correndo, podeAplicar: !bloqueia && !correndo };
}

/* `escreverAprovado` sobe `gates` no erro para quem chama guardar. A bateria fala
   em cores; o primitivo fala em `{id, label, ok, detail}`. A tradução mora aqui,
   num lugar só — e CINZA vira `ok: true`, porque cinza não bloqueia. Se cinza
   virasse `false`, um checkout sem `.n8n-pkgs/` deixaria de aplicar para sempre. */
/* A ordem das sete na tela. `5a` e `5b` não são números, então comparar como
   string colocaria `5b` antes de `5a` em alguns casos e `7` antes de `5a` em
   todos. Uma tabela explícita é mais curta que a regra que a derivaria. */
const TODAS_LINHAS = ["1", "2", "3", "4", "5a", "5b", "6", "7"];
const ORDEM_LINHA = { "1": 1, "2": 2, "3": 3, "4": 4, "5a": 5, "5b": 6, "6": 7, "7": 8 };
const ordemLinha = x => ORDEM_LINHA[String(x)] || 99;

function paraGates(linhas) {
  return linhas.map(l => ({
    id: String(l.n), label: l.nome,
    ok: l.cor !== "risk" && l.cor !== "correndo",
    detail: l.frase || null
  }));
}

/* A amostra que a 5a lê: as execuções com ERRO da janela mais as N mais recentes
 * bem-sucedidas. Buscar todas não é opção — `WhatsApp API Oficial` fez 751 em 24h
 * e cada detalhe com `runData` é multi-MB.
 *
 * Quem decide se a amostra COBRE o alvo é a 5a, não isto: aqui só se busca. É a
 * mesma separação de `resolverAlvo` — o veredito é puro, a busca fica fora. */
const AMOSTRA_N = 5;
const AMOSTRA_EXPANDIDA = 20;

async function amostraDeExecucoes(s, doc, expandir) {
  const wfId = String(doc && doc.id || (s.remendo && s.remendo.wfIdAlvo) || s.wfId);
  const quantas = expandir ? AMOSTRA_EXPANDIDA : AMOSTRA_N;
  const out = [];
  try {
    const erradas = await n8n.listExecutions({ wfId, status: "error", limite: 20 });
    const boas = await n8n.listExecutions({ wfId, status: "success", limite: quantas });
    const ids = [...(erradas.rows || erradas || []), ...(boas.rows || boas || [])]
      .map(e => e && e.id).filter(Boolean).slice(0, quantas + 20);
    for (const id of ids) {
      try { out.push(await n8n.getDetail(id)); } catch { /* uma que não abriu não invalida as outras */ }
    }
  } catch (e) {
    /* Falha de leitura é FATO que sobe para a 5a decidir — ela é quem sabe que
       "não olhei" tem de virar cinza em vez de verde. */
    return { execucoes: [], falhou: String(e && e.message || e).slice(0, 160), expandida: !!expandir,
      expandir: () => amostraDeExecucoes(s, doc, true) };
  }
  return { execucoes: out, falhou: null, expandida: !!expandir,
    expandir: () => amostraDeExecucoes(s, doc, true) };
}

/* O ledger é o mesmo `proposals.json` da correção, com `kind: "upgrade"` — a
   etapa 1 dividiu o cap por tipo justamente para um dia de upgrades não expulsar
   o histórico de correções. Deliberadamente NÃO guarda workflow nenhum. */
async function registrarNoLedger(s, alvo, res) {
  try {
    await fix.upsertStore({
      kind: "upgrade",
      runId: s.id,
      wfId: s.remendo.wfIdAlvo,
      wfName: s.remendo.wfNomeAlvo || s.wfNome,
      startedAt: s.comecouEm || null,
      finishedAt: new Date().toISOString(),
      resumo: alvo.resumo || null,
      diffSummary: alvo.diff ? alvo.diff.summary : null,
      gates: (alvo.bateria && alvo.bateria.linhas || []).map(l => ({ n: l.n, nome: l.nome, cor: l.cor })),
      qual: s.aplicado && s.aplicado.qual || "normal",
      applied: true,
      appliedAt: s.aplicado && s.aplicado.em || null,
      usd: gastoAte(s)
    });
  } catch (e) {
    /* O ledger falhar NÃO desfaz a escrita, e mentir sobre isso seria pior: o
       fluxo já mudou. A frase diz o que aconteceu e o que não ficou registrado. */
    diz(s, "aplicado, mas não consegui registrar no ledger: " + String(e && e.message || e).slice(0, 160), "warn");
  }
}

/* ──────────────────────────────────────────────────────────────── a API ───── */

/* ═══════════════════════════════ OS ANEXOS DA CONVERSA ══════════════════════
 *
 * Um pedido de upgrade escrito em duas linhas perde exatamente o que decide o
 * patch: o formato real do destino, o nome verdadeiro da coluna, a mensagem que
 * ele quer ver chegando. Tudo isso ele já tem em algum lugar — num print, numa
 * planilha, num .md de especificação.
 *
 * FATOS APENAS, e nenhum parser nosso: `anexos.js` grava, valida e descreve; a
 * sessão do Claude abre com `Read`. Este arquivo só liga as duas coisas e conta
 * o que aconteceu.
 *
 * NADA AQUI ESCREVE NO N8N. O anexo vai para o diretório de scratch da conversa
 * (`.upgrade-runs/<id>/anexos/`), que é gitignorado e descartável. */

/* Quais anexos a sessão REALMENTE abriu.
 *
 * Sem isto, anexar é um ato de fé: ele manda o print, a rodada pergunta uma
 * coisa que o print já respondia, e não há como saber se ele foi lido ou
 * ignorado. O `tool_use` do stream-json carrega o caminho, então a leitura é
 * fato OBSERVADO — não promessa do prompt. */
function registrarLeituraAnexo(s, ev) {
  const alvo = String((ev && ev.input && ev.input.file_path) || "");
  if (!alvo) return;
  const norm = alvo.split(/[/\\]/).join("/");
  for (const a of s.anexos || []) {
    if (!norm.endsWith(a.arquivo) && !norm.endsWith("/" + a.nome)) continue;
    if ((s.anexosLidos || []).includes(a.arquivo)) return;
    s.anexosLidos = [...(s.anexosLidos || []), a.arquivo];
    emit(s, "anexos", { anexos: enxuto(s).anexos, anexosLidos: s.anexosLidos });
    return;
  }
}

/* Anexar com a conversa já aberta. Grava e devolve o snapshot — e NÃO dispara
 * rodada nenhuma: quem manda a sessão olhar é a mensagem seguinte, pelo caminho
 * de texto que já existe. Separar as duas coisas é o que permite arrastar três
 * arquivos e falar uma vez, em vez de pagar uma rodada por arquivo solto. */
async function anexar(id, item) {
  const s = sessoes.get(id);
  if (!s) throw Object.assign(new Error("conversa não encontrada"), { status: 404 });
  const r = await anexos.gravar(s.dir, item, s.anexos || []);
  // A categoria viaja no erro para a tela agrupar as recusas de um lote: uma
  // pasta de projeto recusa vários de uma vez, e um aviso por arquivo vira uma
  // coluna em que o último esconde o primeiro.
  if (!r.ok) throw Object.assign(new Error(r.motivo), { status: 400, categoria: r.categoria || null });
  s.anexos = [...(s.anexos || []), r.meta];
  await anexos.escreverIndice(s.dir, s.anexos);
  await escreverRegras(s);
  diz(s, "anexo recebido: " + r.meta.nome);
  emit(s, "anexos", { anexos: enxuto(s).anexos, anexosResumo: anexos.resumo(s.anexos) });
  return enxuto(s);
}

async function desanexar(id, arquivo) {
  const s = sessoes.get(id);
  if (!s) throw Object.assign(new Error("conversa não encontrada"), { status: 404 });
  await anexos.remover(s.dir, arquivo);
  s.anexos = (s.anexos || []).filter(a => a.arquivo !== arquivo);
  s.anexosLidos = (s.anexosLidos || []).filter(x => x !== arquivo);
  await anexos.escreverIndice(s.dir, s.anexos);
  await escreverRegras(s);
  emit(s, "anexos", { anexos: enxuto(s).anexos, anexosResumo: anexos.resumo(s.anexos) });
  return enxuto(s);
}

function enxuto(s) {
  return {
    id: s.id, wfId: s.wfId, wfNome: s.wfNome, nos: s.nos,
    /* O que ela anexou — só os METADADOS: nome, tipo, tamanho, caminho relativo.
       O conteúdo fica no disco da conversa, e `anexosLidos` é observação do
       `tool_use`, não promessa do prompt. */
    anexos: (s.anexos || []).map(a => ({
      nome: a.nome, arquivo: a.arquivo, tipo: a.tipo, bytes: a.bytes,
      dePasta: !!a.dePasta, raiz: a.raiz || null, segredosRemovidos: a.segredosRemovidos || 0
    })),
    anexosResumo: anexos.resumo(s.anexos || []),
    anexosLidos: s.anexosLidos || [],
    /* O título e o carimbo do fluxo viajam no snapshot porque a tela precisa dos
       dois com a gaveta FECHADA: o título é o que responde "qual conversa eu estou
       lendo" na fatia livre do cabeçalho `[ 01 ]`, e o `wfUpdatedAt` é o que
       permite dizer que o fluxo mudou depois desta conversa. Derivar o título na
       página daria uma segunda definição de corte, e as duas divergiriam no
       primeiro ajuste feito num lado só. */
    titulo: conversas.tituloDoChat(s.chat),
    wfUpdatedAt: s.updatedAt || null,
    /* Reaberta do disco: nenhuma rodada desta conversa rodou neste processo, então
       não existe log da anterior e a tela diz isso em vez de mostrar um terminal
       vazio como se nada tivesse acontecido. */
    reaberta: !!s.reaberta,
    // o que foi buscado no n8n nesta pergunta — FATO, para a tela poder mostrar
    // que a resposta tem evidência atrás em vez de pedir fé
    evidencias: (s.evidencias || []).map(e => ({ arquivo: e.arquivo, oque: e.pedido && e.pedido.oque, resumo: e.resumo })),
    status: s.status, erro: s.erro || null,
    chat: s.chat, alvo: s.alvo, atividade: s.atividade,
    /* Onde os nós do alvo moram — FATO. A tarja de troca de fluxo e a recusa de
       alvo ambíguo são desenhadas a partir daqui; quem julga é a página. */
    resolucao: s.resolucao || null,
    /* O patch montado — resumo, diff, veredito de cada portão. FATO. Se ele é bom
       o bastante para virar botão é a tela que decide, e ela exige DOIS campos: o
       `podeAplicar` da bateria e este `aplicavel`, que desde o §6 é o próprio
       `!!bat.podeAplicar`. Ausente nunca liga o botão — um remendo montado antes
       do §6 ficou no disco sem o campo, e ausência não é liberação. */
    remendo: s.remendo || null,
    /* Se ja foi escrito no n8n, quando, e qual dos dois patches. FATO: a tela
       decide se mostra recibo ou botao, e o ↺ Desfazer depende disto existir. */
    aplicado: s.aplicado || null, desfeito: s.desfeito || null,
    custo: s.custo, gasto: gastoAte(s),
    modelo: MODELO, comecouEm: s.comecouEm
  };
}

function snapshot(id) {
  const s = sessoes.get(id);
  if (!s) return null;
  return Object.assign(enxuto(s), { log: s.log });
}

async function iniciar({ wfId, bandeja }) {
  if (!n8n.configured) throw Object.assign(new Error("n8n não configurado"), { status: 503 });
  if (!fix.claudeFound) {
    throw Object.assign(new Error("Claude Code CLI não encontrado em " + CLAUDE_BIN + " — defina CLAUDE_BIN no .env"), { status: 503 });
  }
  const anterior = ativa && sessoes.get(ativa);
  if (anterior && (anterior.status === "correndo")) {
    throw Object.assign(new Error("já existe uma conversa rodando (" + ativa + ")"), { status: 409 });
  }

  const raw = await n8n.getRawWorkflow(wfId);
  const nodes = (raw.nodes || []).filter(n => n.type !== "n8n-nodes-base.stickyNote");

  const id = novoId();
  const s = {
    id, gen: 1, wfId: String(wfId), wfNome: String(raw.name || ""),
    nos: nodes.length,
    // `updatedAt` no instante em que a conversa abriu. Ainda não há escrita nesta
    // fatia, mas quando houver é este carimbo que prova que o alvo discutido é o
    // documento atual — guardar depois seria guardar outra coisa.
    updatedAt: raw.updatedAt || null,
    dir: path.join(RAIZ, id),
    nomes: new Set(nodes.map(n => String(n.name))),
    status: "preparando", erro: null,
    chat: [], alvo: null, atividade: null, log: [], custo: [],
    filho: null, sessionId: null, correcoes: [],
    anexos: [], anexosLidos: [],
    modelo: MODELO, reaberta: false,
    comecouEm: new Date().toISOString()
  };
  sessoes.set(id, s);
  ativa = id;

  await prepararDir(s, raw);
  diz(s, "diretório pronto: índice de " + nodes.length + " nós, fluxo sem credencial");

  /* A BANDEJA QUE A TELA ENCHEU ANTES DA CONVERSA EXISTIR.
   *
   * A sessão só nasce na PRIMEIRA mensagem, e ele anexa antes dela — não há id
   * para pendurar o arquivo. Adotar é mover o diretório (`rename`, atômico, sem
   * copiar 48MB), e é o que faz o anexo chegar já na primeira rodada.
   *
   * O INVENTÁRIO É LIDO DO DISCO, nunca do que a página disse que mandou. Mesma
   * regra do Tester e o mesmo motivo: a tela sabe o que enviou, o servidor não
   * pode acreditar nela — o inventário verdadeiro é o que existe no diretório.
   * Uma tela que mentisse (ou uma gravação que falhou no meio) poria no prompt um
   * arquivo que a sessão não consegue abrir. */
  if (bandeja) {
    try {
      const veio = await anexos.adotar(RAIZ, bandeja, s.dir);
      if (veio) {
        s.anexos = await anexos.inventario(s.dir);
        await anexos.escreverIndice(s.dir, s.anexos);
        await escreverRegras(s);
        diz(s, "recebi " + s.anexos.length + " anexo(s) — vou olhar antes de responder");
      }
    } catch (err) {
      /* Falhar em aproveitar o anexo NÃO mata a conversa: o pedido dele continua
         válido sem o print. Mas é dito em voz alta, porque um anexo que sumiu em
         silêncio é pior que um anexo recusado — ele fica achando que foi lido. */
      diz(s, "não consegui aproveitar os anexos: " + (err && err.message || err), "erro");
    }
  }

  s.status = "aguardando";
  return id;
}

/* ═════════════════════════ REABRIR UMA CONVERSA DO DISCO ════════════════════
 *
 * Devolve o `chat` para a memória e nada mais: NENHUM CLI é spawnado aqui, nada
 * é escrito no n8n, e o custo é zero. A próxima rodada é que gasta, e ela vem
 * pelo compositor como qualquer outra.
 *
 * O `sessionId` NÃO VOLTA, e essa é a armadilha medida deste caminho: `rodar()`
 * passa `--resume <sessionId>` quando ele existe, e um id de sessão que não
 * existe mais faz o spawn falhar — uma conversa reaberta morreria na primeira
 * rodada, com um erro que fala de sessão e não de histórico. Sem ele a próxima
 * rodada é sessão NOVA e o histórico viaja pelo prompt, por `ultimasAteCaber`,
 * que já existe e já sabe dizer quando cortou. O preço é prompt maior; ele é
 * menor que o de um spawn que não sobe.
 *
 * O DIRETÓRIO É NOVO. A pasta da sessão original é scratch (`.upgrade-runs/`) e
 * pode não existir mais, então `prepararDir` roda de novo — o que também relê o
 * fluxo do n8n, ou seja a rodada seguinte trabalha contra o documento de AGORA e
 * não contra o de quando a conversa nasceu. A evidência antiga não é recopiada:
 * os resumos continuam no chat e o prompt os cita, mas os arquivos são scratch e a
 * tela diz que eles podem não estar mais lá.
 */
async function retomar({ wfId, convId }) {
  const jaNaMemoria = sessoes.get(convId);
  if (jaNaMemoria && String(jaNaMemoria.wfId) === String(wfId)) return enxuto(jaNaMemoria);

  if (!n8n.configured) throw Object.assign(new Error("n8n não configurado"), { status: 503 });
  const d = await conversas.ler(wfId, convId);
  if (!d) {
    /* Apagada e inexistente NÃO são a mesma frase. Uma diz o que aconteceu com o
       que ele tinha; a outra diz que o endereço não vale. A tela precisa das duas
       separadas, então o status também é diferente. */
    const e = await conversas.estado(wfId, convId);
    if (e.estado === "apagada") {
      throw Object.assign(new Error("essa conversa foi apagada" + (e.apagadaEm ? " em " + e.apagadaEm : "")),
        { status: 410, apagadaEm: e.apagadaEm || null });
    }
    throw Object.assign(new Error("não achei essa conversa neste fluxo"), { status: 404 });
  }

  /* A rodada que o cockpit fechou por cima entra como CEGA aqui, uma vez só —
     `conversas.interrompida` é idempotente porque troca o status. Ver a nota
     longa dela: o defeito é por omissão, e um total limpo mentiria para baixo. */
  const doc = conversas.interrompida(d);

  const raw = await n8n.getRawWorkflow(wfId);
  const nodes = (raw.nodes || []).filter(n => n.type !== "n8n-nodes-base.stickyNote");

  const s = {
    id: String(doc.convId), gen: 1, wfId: String(wfId), wfNome: String(raw.name || doc.wfNome || ""),
    nos: nodes.length,
    /* O carimbo do fluxo continua sendo o DE QUANDO A CONVERSA NASCEU. Trocá-lo
       pelo de agora apagaria justamente o aviso de que o fluxo mudou desde então —
       o alvo discutido na segunda pode apontar para um nó que não existe mais na
       quinta, e é a divergência que responde isso. */
    updatedAt: doc.wfUpdatedAt || null,
    dir: path.join(RAIZ, String(doc.convId)),
    nomes: new Set(nodes.map(n => String(n.name))),
    status: doc.status === "correndo" ? "interrompida" : doc.status,
    erro: doc.erro || null,
    chat: doc.chat || [], alvo: doc.alvo || null, atividade: null, log: [],
    custo: doc.custo || [],
    evidencias: (doc.evidencias || []).map(e => ({ arquivo: e.arquivo, pedido: { oque: e.oque }, resumo: e.resumo })),
    filho: null, sessionId: null, correcoes: [],
    anexos: [], anexosLidos: [],
    modelo: MODELO, reaberta: true,
    comecouEm: doc.criadaEm || new Date().toISOString()
  };
  sessoes.set(s.id, s);

  await prepararDir(s, raw);
  /* Os anexos são SCRATCH, e reabrir lê o que sobrou no disco em vez de confiar
     numa lista guardada. `.upgrade-runs/` é descartável: uma limpeza de cache
     apaga os arquivos, e uma lista persistida apontaria para o que não existe —
     a sessão tentaria `Read` num caminho vazio no meio da rodada. Zero anexos
     aqui é um fato sobre o diretório, não sobre o que ele mandou um dia. */
  s.anexos = await anexos.inventario(s.dir);
  s.anexosLidos = [];
  if (s.anexos.length) {
    await anexos.escreverIndice(s.dir, s.anexos);
    await escreverRegras(s);
    diz(s, "os " + s.anexos.length + " anexo(s) desta conversa ainda estão no disco e voltam para o prompt.", "info");
  }
  diz(s, "conversa reaberta do disco: " + (s.chat || []).length + " mensagens, "
    + s.custo.length + " rodada(s) já pagas. A próxima rodada é uma sessão NOVA — "
    + "o histórico vai pelo prompt, não por `--resume`.", "info");
  if (doc.status === "correndo") {
    diz(s, "esta conversa ficou marcada como `correndo`: o cockpit fechou no meio de uma rodada. "
      + "O custo dela nunca chegou, então ela entra como rodada não medida em vez de zero.", "warn");
  }
  emit(s, "estado", enxuto(s));
  /* Grava JÁ: o status novo e a rodada cega precisam estar em disco antes do
     próximo clique, senão reabrir duas vezes acrescentaria duas rodadas cegas
     para uma rodada que morreu uma vez. */
  await conversas.salvar(s).catch(() => { /* `guardar` já explica a falha no log */ });
  return enxuto(s);
}

/* ─────────────────────────── os dois fatos que a gaveta precisa ───────────── */

/* Quais conversas estão RODANDO neste processo agora. As duas metades importam:
 * uma sessão que está no Map com `status: "aguardando"` está presente e não está
 * rodando, e "presente no Map" faria uma conversa parada numa pergunta ficar de
 * fora do ramo de `interrompida` sem estar correndo — troca de uma mentira por
 * outra. Quem decide o que fazer com isto é a página. */
function rodandoAgora() {
  const set = new Set();
  for (const s of sessoes.values()) if (s.status === "correndo") set.add(s.id);
  return set;
}

/* A conversa que está ocupando o cockpit, e EM QUAL FLUXO. Uma conversa roda por
 * vez em toda a aba, então `+ nova conversa` precisa poder aparecer desabilitado
 * dizendo qual é e onde ela está: um 409 depois do clique é pior que um botão que
 * explica, porque o clique já custou a decisão de clicar. */
/* O TÍTULO NÃO SAI DAQUI de propósito. Ele carrega nome de lead, e esta frase
 * aterrissa no rótulo de um botão desabilitado — fora da lista, onde a classe
 * `sens` cobre. O nome do fluxo já identifica o suficiente para decidir, e se a
 * conversa é deste fluxo a própria linha dela na gaveta já a mostra, borrada
 * quando tem de estar. */
function ativaAgora() {
  for (const s of sessoes.values()) {
    if (s.status === "correndo") return { convId: s.id, wfId: s.wfId, wfNome: s.wfNome };
  }
  return null;
}

/* Tirar a conversa da memória. Sem isto, apagar não apaga: a sessão continua no
 * Map, o `guardar` da transição seguinte reescreve o arquivo e a linha volta para
 * a gaveta sozinha — o pior resultado possível de um clique destrutivo, porque
 * quem apagou já acreditou que apagou. Recusa por nome se ela estiver rodando:
 * matar uma rodada é `cancelar`, e fazer isso de dentro de um "apagar" seria
 * esconder um efeito atrás de outro. */
function esquecer(convId) {
  const s = sessoes.get(convId);
  if (!s) return false;
  if (s.status === "correndo") {
    throw Object.assign(new Error("esta conversa está rodando — pare ela antes (Esc)"), { status: 409 });
  }
  sessoes.delete(convId);
  if (ativa === convId) ativa = null;
  ouvintes.delete(convId);
  return true;
}

/* O QUE FOI COM ESTA MENSAGEM.
 *
 * O DEFEITO QUE ISTO FECHA foi ele quem viu, olhando a tela: manda um print, e a
 * conversa desenha a mensagem como texto puro. O arquivo chegou ao disco, entrou no
 * prompt e foi ABERTO pela sessão — medido, o `Read` volta com a imagem decodificada
 * —, e ainda assim, para quem olha, "a imagem não foi". Pior: o chip continua no
 * compositor depois do envio, o que lê como *ainda não mandei*. Um pipeline que
 * funciona e uma tela que não mostra é indistinguível de um que não funciona.
 *
 * É UM RETRATO DO INSTANTE DO ENVIO, e é por isso que ele mora na mensagem em vez
 * de a tela ler `s.anexos` na hora de desenhar: `s.anexos` é o estado ATUAL da pasta
 * e cresce quando ele anexa mais um arquivo no meio da conversa. Lido na pintura,
 * um print anexado hoje apareceria dentro da mensagem de ontem — a tela afirmando
 * que uma rodada já paga viu algo que ela não tinha como ver.
 *
 * SÓ FORMA, nunca conteúdo: nome, caminho relativo, tipo e tamanho. O arquivo
 * continua em disco e é servido por rota própria; copiá-lo para dentro do histórico
 * transformaria um `.json` de conversa em 66KB de base64 por print. */
function anexosDaMensagem(s) {
  return ((s && s.anexos) || []).map(a => ({
    arquivo: a.arquivo, nome: a.nome, tipo: a.tipo, bytes: a.bytes
  }));
}

/* Uma mensagem dele. Sempre incrementa a geração: se havia rodada correndo, ela
 * morre e o que ela ainda fosse emitir cai no chão. Não existe "fila de
 * mensagens" — a última é a que vale, e enfileirar faria o modelo responder a uma
 * pergunta que ele já mudou de ideia sobre. */
async function mensagem(id, texto) {
  const s = sessoes.get(id);
  if (!s) throw Object.assign(new Error("conversa desconhecida"), { status: 404 });
  const t = String(texto || "").trim();
  if (!t) throw Object.assign(new Error("mensagem vazia"), { status: 400 });
  if (t.length > 2000) throw Object.assign(new Error("mensagem acima de 2000 caracteres"), { status: 400 });

  if (s.filho) { try { s.filho.kill(); } catch { /* já morreu */ } }
  s.gen++;
  s.status = "correndo";
  s.erro = null;
  s.alvo = null;
  s.chat.push({ de: "eu", texto: t, em: new Date().toISOString(), anexos: anexosDaMensagem(s) });
  emit(s, "estado", enxuto(s));
  /* Antes da rodada, não depois: a primeira mensagem é o que dá TÍTULO à conversa,
     e é ela que faz a conversa existir na gaveta. Uma frase digitada e perdida
     porque o cockpit fechou dois segundos depois seria a perda mais barata de
     evitar deste arquivo. */
  guardar(s);

  const gen = s.gen;
  conduzir(s, gen).catch(() => { /* `conduzir` já trata */ });
  return enxuto(s);
}

/* Parar. Duas linhas, porque o mecanismo já existia: todo ponto da esteira checa
 * `vivo()` antes de emitir ou avançar, então basta mover a geração e matar o
 * filho. Não é pausa e não há retomar: digitar de novo reinicia com a correção
 * junto, que é melhor do que redoar o que foi morto pelo mesmo preço. */
function cancelar(id) {
  const s = sessoes.get(id);
  if (!s) throw Object.assign(new Error("conversa desconhecida"), { status: 404 });
  if (s.status !== "correndo") throw Object.assign(new Error("esta conversa não está rodando (" + s.status + ")"), { status: 409 });
  s.gen++;
  s.status = "cancelada";
  if (s.filho) { try { s.filho.kill(); } catch { /* já morreu */ } }
  diz(s, "parada por você — nada foi escrito no n8n", "warn");
  emit(s, "estado", enxuto(s));
  guardar(s);
  return enxuto(s);
}

function assinar(id, res) {
  const s = sessoes.get(id);
  if (!s) return false;
  if (!ouvintes.has(id)) ouvintes.set(id, new Set());
  ouvintes.get(id).add(res);
  res.write("event: snapshot\ndata: " + JSON.stringify(snapshot(id)) + "\n\n");
  return true;
}

function desassinar(id, res) {
  const set = ouvintes.get(id);
  if (set) { set.delete(res); if (!set.size) ouvintes.delete(id); }
}

/* A conversa aberta agora, se houver. A tela do fluxo pergunta isso ao abrir: uma
 * conversa que custou minutos não pode ser perdida por um F5. */
function daquiFluxo(wfId) {
  for (const s of sessoes.values()) {
    if (String(s.wfId) === String(wfId) && s.status !== "cancelada" && s.status !== "falhou") return s.id;
  }
  return null;
}

function capacidades() {
  return {
    cliAchado: !!fix.claudeFound, cliCaminho: CLAUDE_BIN,
    n8nConfigurado: !!n8n.configured, modelo: MODELO,
    /* DOIS tetos, e os dois viajam. `tetoRodadaMs` sozinho continuaria dizendo a
     * verdade sobre o teto duro e MENTINDO por omissão: desde o vigia, a rodada
     * pode morrer bem antes dele, por silêncio. Um contrato que declara um só
     * limite quando existem dois é a mesma classe do `escreveNoN8n` logo abaixo. */
    tetoRodadaMs: RODADA_MS, silencioMs: SILENCIO_MS,
    /* O esforço EFETIVO por tipo de rodada, mais o valor cru do ambiente quando
     * ele não foi reconhecido. `null` em `patch` não é ausência: é "sem flag, o
     * padrão do CLI", que é o que essa rodada de fato usa. */
    esforco: {
      conversa: esforcoDaRodada(false),
      patch: esforcoDaRodada(true),
      ignorado: [
        ["COCKPIT_UPGRADE_ESFORCO", process.env.COCKPIT_UPGRADE_ESFORCO],
        ["COCKPIT_UPGRADE_ESFORCO_PATCH", process.env.COCKPIT_UPGRADE_ESFORCO_PATCH]
      ].filter(([, v]) => v != null && v !== "" && v !== "padrao" && !ESFORCOS.includes(v))
       .map(([k, v]) => k + "=" + v)
    },
    /* O QUE ESTA ABA ESCREVE, E ONDE. Isto é valor, não comentário: é contrato
     * para quem consome a rota, e por isso tem de ser verdade.
     *
     * Aqui havia `escreveNoN8n: false`, afirmando — com um comentário dizendo
     * que a tela podia repetir isso ao Kauan — que nesta fatia não existia
     * caminho de escrita nenhum. O §5/§6 acrescentou TRÊS, uma delas no fluxo
     * vivo, e o campo ficou. Ninguém descobriu porque **nada consumia o campo**
     * (medido por grep: só a definição e o teste) — mentira em contrato morto é
     * a que ninguém encontra até alguém começar a ler.
     *
     * Podia ter sido apagado, e a razão de NÃO ter sido é a regra que este
     * repositório já pagou cinco vezes: um campo ausente cai no ramo negativo, e
     * o ramo negativo de um booleano chamado `escreveNoN8n` é exatamente o que
     * ENGANA — a tela diria "nada é escrito" com três escritas no arquivo. Um
     * objeto não tem ramo negativo para cair, e diz a coisa que o booleano não
     * expressa: as duas escritas são de naturezas diferentes, e chamar as duas
     * de "escreve" apaga a única parte que importa.
     *
     * `fluxoVivo` é um estado, não um booleano, porque a verdade tem condição:
     * a escrita existe e só acontece por `fix.escreverAprovado`, depois de o
     * Kauan clicar no diff que está na tela. `copiaInativa` é a `checagem7`,
     * que grava a cópia descartável `[SANDBOX upgrade]` ANTES de qualquer
     * aprovação — é o estado de `SANDBOX_LIGADO` e não uma constante justamente
     * porque ela desliga (`COCKPIT_UPGRADE_SANDBOX=0`), e "não perguntei ao n8n" e
     * "perguntei e ele aceitou" levam a decisões opostas.
     *
     * Fica de fora `desfazer`, a terceira escrita: ela restaura um backup
     * literal e só existe depois de um `aplicar`, então não é uma capacidade
     * nova — é a que `fluxoVivo` já declarou, de volta. */
    escreve: { fluxoVivo: "apenasAposAprovacao", copiaInativa: SANDBOX_LIGADO }
  };
}

module.exports = {
  iniciar, mensagem, cancelar, snapshot, assinar, desassinar, daquiFluxo, capacidades,
  // §4 — confirmar o alvo é o que dispara a rodada que escreve o patch
  confirmarAlvo,
  // o histórico: reabrir do disco, esquecer, e os dois fatos que a gaveta lê
  retomar, esquecer, rodandoAgora, ativaAgora,
  // exportados para teste, sem spawnar CLI nenhum
  validarResposta, ultimasAteCaber, gastoAte, prompt, REGRAS, regras, ARQ_COM_DOSSIE, ARQ_INDICE,
  // a procedência: em que a resposta se apoia, e como isso é verificado
  basesDaSessao, normalizarBase, procedenciaDe, PROC_FRASE, PROC_NIVEL, BASES_FIXAS,
  // exportado para teste: prova que o DOSSIE.md aterrissa na pasta da sessão
  prepararDir,
  /* Exportada porque a FIAÇÃO é o que quase escapou: `regras()` pode estar
     perfeita e `escreverRegras` passar `false` no lugar do inventário, e aí todo
     caso sobre a prosa continua verde com o arquivo em disco sem o anexo. Ela só
     escreve um `.md` local — nada de n8n, nada de CLI. */
  escreverRegras,
  PROMPT_MAX, ORC_CONVERSA, MAX_PEDIDOS, TEXTO_MAX, MSG_SLICE,
  /* O teto da rodada: as duas mortes e o esforço. `fraseMorte` e `esforcoDaRodada`
     são puras — o teste prova as duas frases distintas e a escolha do esforço sem
     spawnar CLI nenhum, mesma razão de `resolverAlvo` e `custoDaRodada` serem. */
  RODADA_MS, SILENCIO_MS, ESFORCOS, ESFORCO_CONVERSA_PADRAO, ESFORCO_PATCH_PADRAO,
  fraseMorte, esforcoDaRodada,
  /* Os anexos. `RUNS_DIR` sai porque a BANDEJA vive debaixo dele e é o servidor
     que a cria — deixar o caminho ser recomposto lá seria uma segunda definição
     de onde a conversa mora, e a que divergisse gravaria numa bandeja que a
     adoção nunca acharia. `trechoAnexos` e `ferramentasDaRodada` são puras:
     testáveis sem spawnar CLI e sem tocar em disco. */
  anexar, desanexar, registrarLeituraAnexo,
  /* `anexosDaMensagem` é pura: o retrato que vai na mensagem é testável sem sessão,
     sem disco e sem CLI — e o que ela NÃO carrega (conteúdo) é o caso que importa. */
  anexosDaMensagem,
  RUNS_DIR: RAIZ, ORC_ANEXOS, trechoAnexos, ferramentasDaRodada,
  // §4.5 — em qual fluxo o alvo mora. `resolverAlvo` é pura: testável sem rede.
  resolverAlvo, fraseBloqueio, resolverAlvoNoN8n, ONDE,
  /* Exportada só para o teste do VIGIA, que troca `child_process.spawn` por um
     filho falso antes de exigir este módulo. Não spawna CLI e não fala com o n8n
     — o que ela prova é o relógio: um vigia que não mata não FALHA, ele PARA, e
     um teste pendurado lê como "rodando". Mesma lição do `mutex-test.js`. */
  rodar,
  // §4.1/4.2/4.4 — o contrato do patch. `VERBOS_PATCH` sai para o teste poder
  // afirmar que o quarto verbo não nasceu de novo por descuido.
  VERBOS_PATCH, caminhoDeCredencial,
  // `avaliarPatch` é pura sobre (documento, patch): testável sem rede e sem CLI.
  avaliarPatch, instrucaoPatch,
  /* `prepararAlvo` sai porque é o elo mais arriscado do §4 e o único que toca o
     n8n: ele busca o documento do fluxo ALVO (que pode ser um filho), sanea, e
     escreve os três arquivos que a sessão lê. Sem export, a única prova possível
     era ler o código — e ler não é executar. O teste troca o `n8n.js` no
     `require.cache`, então nada é chamado de verdade. */
  prepararAlvo,
  // §5 checagem 7 e §6 — o unico caminho deste arquivo que escreve em producao
  aplicar, desfazer, patchDesligado, rodarBateria, paraGates, SANDBOX_PREFIX, SANDBOX_LIGADO,
  // a bateria chegando aos poucos: a tela desenha o que falta a partir de `todas`
  publicarParcial, montarBateria, TODAS_LINHAS
};
