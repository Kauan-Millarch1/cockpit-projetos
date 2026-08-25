"use strict";
/* bateria.js — `[ VERIFICANDO UPGRADE ]`, a bateria de sete do `PLAN-UPGRADE.md` §5.
 *
 * Sete linhas acendendo uma a uma, e o botão de aplicar aparece quando não há
 * vermelho e nada está mais rodando. Este arquivo monta o esqueleto e resolve as
 * checagens 1, 2, 3, 4 e 6. As 5a, 5b e 7 entram prontas por injeção — a 7
 * escreve na instância e não tinha como morar num módulo que promete não escrever.
 *
 * AQUI MORA JUÍZO, de propósito. A cor é decisão: "conferi e passou", "não
 * consegui conferir" e "conferi e reprovou" levam a ações diferentes, e essa
 * tradução tem de estar num lugar só. A tela pinta o que este arquivo decidiu e
 * não redecide nada — é a mesma divisão que `flows.html` tem com o `server.js`,
 * invertida de lado porque aqui o juízo é caro demais para viver numa página.
 *
 * NADA AQUI FALA COM O N8N. As cinco checagens são sobre documento e catálogo já
 * em memória; o que depende de rede entra por `contexto`. Isso é o que permite
 * `bateria-test.js` ser de graça, e é o que impede esta função de virar mais um
 * lugar de onde sai uma escrita.
 *
 * As cinco cores, e a regra de uma frase (§5.1):
 *
 *   cold   cinza   não dá para conferir aqui, COM O MOTIVO ESCRITO   não bloqueia
 *   accent indigo  conferindo agora (transitório)                    BLOQUEIA
 *   ok     verde   conferido, passou                                 não bloqueia
 *   warn   laranja passou, com ressalva medida                       não bloqueia
 *   risk   vermelho conferido, reprovou                              BLOQUEIA
 *
 * Duas delas são a razão de o arquivo existir e não podem ser afrouxadas:
 *
 * CINZA NUNCA É VERDE. "Não olhei" não pode se vestir de "está bom" — e toda
 * linha cinza carrega o motivo, porque sem o motivo ela é indistinguível de
 * descuido. Este repositório já pagou essa lição quatro vezes (o `docAgentes`
 * ausente lido como arquivo faltando, o `ingredientes.credenciais` de projeto
 * velho lido como zero credenciais, o dossiê cinza que nunca é vermelho, e o
 * `resolucao` ausente que não pode virar "está tudo no fluxo aberto").
 *
 * LARANJA É "passou, mas você precisa saber disso" — e é essa informação que
 * decide o clique ("mexe em nó com 645 execuções hoje"). Movimento é `--accent`.
 * Gastar laranja em "ainda vou conferir" mataria o papel dela.
 */

const fix = require("./claude-fix.js");
const esquema = require("./esquema.js");
const catalog = require("./catalog.js");
const rede = require("./rede.js");
/* `ligacaoCredenciais` vem do `tester.js` em vez de ser reimplementada aqui, e a
 * razão é a mesma que faz o painel e a run de correção chamarem o mesmo
 * `locateNode`: duas definições de "candidato de credencial" divergem no primeiro
 * conserto feito num lado só, e aí a checagem 4 aprova o que a ligação recusa.
 * Medido: `require("./tester.js")` custa ~48ms e não deixa timer pendente. */
const tester = require("./tester.js");

/* ─────────────────────────────────────────────────────── as cinco cores ──── */

const COR = { cinza: "cold", rodando: "accent", ok: "ok", ressalva: "warn", reprova: "risk" };
const BLOQUEIAM = new Set([COR.reprova, COR.rodando]);

/* Quantos achados de uma checagem viram detalhe na tela. Uma lista de 200 chaves
   não é evidência, é parede — e a linha tem de dizer que truncou. */
const DETALHE_MAX = 8;

function linha(n, nome, cor, frase, detalhe) {
  return { n: String(n), nome, cor, frase, detalhe: detalhe && detalhe.length ? detalhe.slice(0, DETALHE_MAX) : null };
}

/* `5a` tem de cair entre `5` e `6`, e `"10"` não pode vir antes de `"2"`. Ordenar
   as strings direto faria as duas coisas erradas. */
function ordemDe(n) {
  const m = /^(\d+)([a-z]?)$/.exec(String(n));
  return m ? [Number(m[1]), m[2] || ""] : [999, String(n)];
}

/* ────────────────────────────────────────── o que o patch efetivamente toca ── */

/* Os nós que o patch escreve — é sobre ELES que as checagens 2 e 3 olham, nunca
 * sobre o documento inteiro. Um fluxo de produção de 189 nós já carrega dívida de
 * anos; reprovar o upgrade por causa dela seria reprovar todo upgrade para
 * sempre, e um portão que sempre reprova ensina a ignorar o portão. É a mesma
 * calibração que `portaPreencher` já fez, pelo mesmo motivo. */
function nosTocados(patch) {
  const nomes = new Set();
  for (const u of (patch && Array.isArray(patch.updateNodes) ? patch.updateNodes : [])) {
    if (u && u.name) nomes.add(String(u.name));
  }
  for (const a of (patch && Array.isArray(patch.addNodes) ? patch.addNodes : [])) {
    if (a && a.name) nomes.add(String(a.name));
  }
  return nomes;
}

/* Só os nós ADICIONADOS. A checagem 4 trata nó novo diferente de nó existente, e
   a diferença é o §5.7.1 inteiro. */
function nosNovos(patch) {
  const nomes = new Set();
  for (const a of (patch && Array.isArray(patch.addNodes) ? patch.addNodes : [])) {
    if (a && a.name) nomes.add(String(a.name));
  }
  return nomes;
}

function nosDe(wf) {
  const m = new Map();
  for (const n of (wf && Array.isArray(wf.nodes) ? wf.nodes : [])) {
    if (n && n.name) m.set(String(n.name), n);
  }
  return m;
}

/* ══════════════════════════════ 1 — Estrutura ═══════════════════════════════
 *
 * Os dez portões de `validate()`, que é a mesma função que guarda o caminho de
 * correção em produção. NÃO PODE FICAR CINZA: ela não depende de nada externo —
 * documento e proposta bastam —, então "não consegui conferir" aqui só poderia
 * significar que alguém quebrou o encanamento, e isso é reprovar, não abster-se. */
function checaEstrutura(documento, proposta) {
  if (!proposta) {
    return linha(1, "Estrutura", COR.reprova,
      "o patch não chegou a produzir um documento — não há o que conferir nem o que escrever");
  }
  const v = fix.validate(documento, proposta);
  const ruins = v.gates.filter(g => !g.ok);
  if (!ruins.length) {
    return linha(1, "Estrutura", COR.ok,
      "os " + v.gates.length + " portões estruturais passaram: nenhum nó sumiu, nenhum tipo trocou, "
      + "nenhuma credencial foi tocada e toda ligação resolve");
  }
  return linha(1, "Estrutura", COR.reprova,
    ruins.length + " de " + v.gates.length + " portões estruturais reprovaram",
    ruins.map(g => g.label + (g.detail ? " — " + g.detail : "")));
}

/* ══════════════════════════════ 2 — Esquema do nó ═══════════════════════════
 *
 * `esquema.js` conhece 810 tipos por `(type, typeVersion)`: quais chaves existem,
 * o enum fechado de cada discriminador, e sob qual `resource`/`operation` cada
 * chave existe. É o que pega o campo que a API pública aceita e o editor mostra
 * vazio — porque o n8n aceita QUALQUER objeto `parameters` sem validar.
 *
 * CINZA É ESTADO LEGÍTIMO AQUI, e é o caso comum num checkout novo: `.n8n-pkgs/`
 * é gitignored, então um clone fresco não tem esquema nenhum. `resumo()` responde
 * em três estados e os três têm de sair distintos — "não baixei os pacotes" e
 * "esse nó não existe" levam a ações opostas, e deixar o primeiro cair no ramo de
 * reprovação transformaria um clone limpo num upgrade impossível. */
function checaEsquema(proposta, tocados, deps) {
  const es = (deps && deps.esquema) || esquema;
  let r;
  try { r = es.resumo(); }
  catch (e) {
    /* Falha soft, sempre: o esquema é uma ajuda, e a ausência dele nunca pode
       parar um upgrade que passaria sem ele. */
    return linha(2, "Esquema do nó", COR.cinza,
      "não consegui ler o esquema dos nós: " + String((e && e.message) || e).slice(0, 160));
  }

  if (!r || !r.pronto) {
    return linha(2, "Esquema do nó", COR.cinza,
      (r && r.porque) || "o esquema dos nós não está disponível neste checkout");
  }

  let cache;
  try { cache = es.lerCache(); }
  catch { cache = null; }
  if (!cache) {
    return linha(2, "Esquema do nó", COR.cinza,
      "o esquema diz estar pronto mas o cache não abriu — rode `node esquema.js --construir`");
  }

  const mapa = nosDe(proposta);
  const achados = [];
  for (const nome of tocados) {
    const nd = mapa.get(nome);
    if (!nd) continue;                       // removido do documento: a checagem 1 responde por isso
    let saiu = [];
    try { saiu = es.conferir(cache, nd) || []; }
    catch { /* um tipo que o esquema não sabe ler não reprova nada */ }
    for (const a of saiu) achados.push(a);
  }

  if (!achados.length) {
    return linha(2, "Esquema do nó", COR.ok,
      "os " + tocados.size + " nó(s) tocados batem com a definição real da versão declarada"
      + " (" + r.tipos + " tipos conhecidos)");
  }
  return linha(2, "Esquema do nó", COR.reprova,
    achados.length + " campo(s) não batem com a definição do nó na versão declarada",
    achados.map(a => "`" + a.no + "`: `" + a.chave + "` — " + (
      a.tipo === "desconhecida" ? "essa chave não existe nesta versão"
        : a.tipo === "inaplicavel" ? "essa chave só existe sob outro resource/operation"
          : "valor fora do conjunto aceito" + (a.aceitos ? " (" + a.aceitos.slice(0, 6).join(", ") + ")" : "")
    )));
}

/* ══════════════════════════════ 3 — Gramática ═══════════════════════════════
 *
 * `n8n-gramatica.md` é PROSA — `gramatica.js` lê e serve o documento, não confere
 * nada. Então esta checagem transcreve em código as regras daquele documento que
 * são mecanicamente conferíveis, e só essas. Ver a nota de ambiguidade no fim do
 * arquivo: o plano nomeia o `.md` como fonte, e o `.md` não é executável.
 *
 * NÃO PODE FICAR CINZA: as regras estão aqui dentro, não dependem de download.
 *
 * A regra de maior valor do repositório inteiro está aqui: PARÂMETRO COM
 * EXPRESSÃO COMEÇA COM `=`. Sem o `=`, o `{{ }}` é texto literal — importa sem
 * erro, fica bonito no editor, e a mensagem sai com as chaves na cara do cliente.
 *
 * O grupo de exclusão é o que faz esta checagem prestar. `{{ }}` dentro de um
 * `jsCode` é JavaScript, não expressão do n8n; dentro de um `stickyNote` é
 * recado para humano. Acusar os dois reprovaria patch correto. */

const CHAVES_CODIGO = new Set(["jsCode", "functionCode", "pythonCode", "code", "jsonSchema"]);
const TIPOS_SEM_EXPRESSAO = new Set(["n8n-nodes-base.stickyNote"]);
const PROF_MAX_GRAM = 8;

function varrerGramatica(valor, caminho, no, achados, prof) {
  if (prof > PROF_MAX_GRAM || achados.length >= 40) return;

  if (typeof valor === "string") {
    /* `{{` e `}}` presentes, e a string NÃO começa com `=`. O `.trim()` fica de
       fora de propósito: o n8n exige o `=` no primeiro byte, então `" ={{ x }}"`
       com espaço na frente É o defeito, não um falso positivo. */
    if (valor.includes("{{") && valor.includes("}}") && !valor.startsWith("=")) {
      achados.push({
        no, chave: caminho,
        porque: "tem `{{ }}` e não começa com `=`, então vai para o n8n como texto literal"
      });
    }
    return;
  }

  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length && i < 200; i++) {
      varrerGramatica(valor[i], caminho + "[" + i + "]", no, achados, prof + 1);
    }
    return;
  }

  if (!valor || typeof valor !== "object") return;

  /* `resourceLocator` declarado tem de estar completo. Só confere o que se
     ANUNCIA como RL (`__rl: true`) — adivinhar que um `{mode, value}` qualquer
     queria ser um seria inventar defeito onde há um objeto comum. */
  if (valor.__rl === true) {
    if (typeof valor.mode !== "string" || !("value" in valor)) {
      achados.push({
        no, chave: caminho,
        porque: "está marcado `__rl: true` mas não tem `mode` e `value` — o resourceLocator fica pela metade"
      });
    }
  }

  for (const [k, v] of Object.entries(valor)) {
    /* O `operator` de uma condição de `filter` é OBJETO `{type, operation}`.
       Escrito como string ele importa e a condição nunca casa. */
    if (k === "operator" && typeof v === "string") {
      achados.push({
        no, chave: caminho + ".operator",
        porque: "`operator` é objeto `{type, operation}` na forma `filter`, não string"
      });
      continue;
    }
    if (CHAVES_CODIGO.has(k)) continue;      // JavaScript não é expressão do n8n
    varrerGramatica(v, caminho ? caminho + "." + k : k, no, achados, prof + 1);
  }
}

function checaGramatica(proposta, tocados, patch) {
  const mapa = nosDe(proposta);
  const achados = [];

  for (const nome of tocados) {
    const nd = mapa.get(nome);
    if (!nd || TIPOS_SEM_EXPRESSAO.has(String(nd.type))) continue;
    varrerGramatica(nd.parameters, "parameters", nome, achados, 0);
  }

  /* O `rewire` escreve `connections` direto, e a forma tem três níveis: porta →
     ÍNDICE da saída → lista de destinos. Um array no lugar do objeto de portas, ou
     um destino sem `node`, importa e a aresta simplesmente não existe. */
  const rew = (patch && patch.rewire && typeof patch.rewire === "object" && !Array.isArray(patch.rewire))
    ? patch.rewire : null;
  for (const [de, saidas] of Object.entries(rew || {})) {
    for (const [porta, ramos] of Object.entries(saidas || {})) {
      if (!Array.isArray(ramos)) {
        achados.push({ no: de, chave: "rewire." + porta, porque: "a porta tem de ser LISTA de saídas (uma por índice)" });
        continue;
      }
      ramos.forEach((ramo, i) => {
        if (ramo === null) return;           // saída sem destino é legítima
        if (!Array.isArray(ramo)) {
          achados.push({ no: de, chave: "rewire." + porta + "[" + i + "]", porque: "cada índice de saída tem de ser uma LISTA de destinos" });
          return;
        }
        for (const c of ramo) {
          if (!c || typeof c !== "object" || !c.node) {
            achados.push({ no: de, chave: "rewire." + porta + "[" + i + "]", porque: "destino sem `node`" });
          }
        }
      });
    }
  }

  if (!achados.length) {
    return linha(3, "Gramática", COR.ok,
      "expressões com `=` na frente, formas compostas inteiras e `connections` nos três níveis");
  }
  return linha(3, "Gramática", COR.reprova,
    achados.length + " ponto(s) fora da gramática do n8n",
    achados.map(a => "`" + a.no + "`: `" + a.chave + "` — " + a.porque));
}

/* ══════════════════════════ 4 — Credencial referenciável ════════════════════
 *
 * A checagem mais fácil de mentir, e §5.7 explica por quê: `GET /credentials`
 * responde 405 nesta instância. NÃO EXISTE INVENTÁRIO DA CONTA. O que
 * `credenciaisConhecidas` carrega é só o subconjunto REFERENCIADO PELOS FLUXOS
 * QUE EXISTEM — nunca prova que a credencial existe, que está autorizada, nem
 * que é a conta certa. A frase na tela tem de dizer isso, sempre.
 *
 * VERMELHO PARA NÓ NOVO QUE EXIGE CREDENCIAL — §5.7.1, rodada 2, e é o achado
 * mais importante desta checagem. `applyPatch()` PROÍBE qualquer chave
 * `credentials`, e essa proibição é garantia de produção que não vai ser
 * afrouxada. Logo o patch NÃO TEM COMO anexar credencial nenhuma, e a aba Upgrade
 * não tem o desempate do Tester para anexar em produção. Um nó novo que exige
 * credencial entra num fluxo VIVO com o campo vazio e falha na PRIMEIRA execução.
 *
 * Isso corrige o §5.7, que dizia "vermelho só com ZERO candidatos". A contagem de
 * candidatos é irrelevante: com dez candidatos o patch continua sem poder anexar
 * nenhum. A saída é o botão distinto do §5.7.2, que é outro patch, com diff e
 * bateria próprios — e não mora aqui. */
function checaCredencial(documento, proposta, patch, contexto, deps) {
  const cat = contexto && contexto.catalogo;
  if (!cat || !cat.nodes) {
    return linha(4, "Credencial referenciável", COR.cinza,
      "o catálogo dos seus fluxos não foi lido nesta rodada, então não sei quais credenciais "
      + "os seus fluxos referenciam");
  }

  const ligar = (deps && deps.ligacaoCredenciais) || tester.ligacaoCredenciais;
  const novos = nosNovos(patch);
  const mapaProp = nosDe(proposta);
  const mapaAntes = nosDe(documento);

  /* Quais nós novos EXIGEM credencial, segundo o que aquele tipo de nó usa nos
     fluxos dele. Um tipo que nunca pediu credencial aqui não aparece — é piso,
     não total, e a frase diz isso. */
  const novosComCred = [];
  for (const nome of novos) {
    const nd = mapaProp.get(nome);
    if (!nd) continue;
    const e = cat.nodes[String(nd.type)];
    const tipos = (e && e.credenciais) || [];
    if (tipos.length) novosComCred.push({ no: nome, tipos });
  }

  if (novosComCred.length) {
    return linha(4, "Credencial referenciável", COR.reprova,
      novosComCred.length + " nó(s) novo(s) exigem credencial, e um patch NUNCA pode anexar uma: "
      + "`applyPatch` proíbe a chave `credentials`. Entrando ligado num fluxo vivo, esse nó falha na "
      + "primeira execução com o campo vazio",
      novosComCred.map(x => "`" + x.no + "` precisa de " + x.tipos.join(" ou ")));
  }

  /* Sem nó novo, o que sobra é conferir se os nós TOCADOS continuam com uma
     credencial referenciável. Aqui o desempate é reusado do Tester, para as duas
     telas nunca discordarem sobre o que conta como candidato. */
  let lig;
  try { lig = ligar(proposta, cat, (contexto && contexto.escolhasCred) || []); }
  catch (e) {
    return linha(4, "Credencial referenciável", COR.cinza,
      "não consegui conferir as credenciais: " + String((e && e.message) || e).slice(0, 160));
  }

  const tocados = nosTocados(patch);
  const vaziosTocados = (lig.vazios || []).filter(v => tocados.has(String(v.no)));

  if (!vaziosTocados.length) {
    const ligadosTocados = (lig.ligados || []).filter(l => tocados.has(String(l.no)));
    if (!ligadosTocados.length) {
      return linha(4, "Credencial referenciável", COR.ok,
        "nenhum nó tocado por este patch pede credencial");
    }
    /* Verde só quando não há nada NOVO a decidir: o nó já vinha com credencial
       antes do patch. Se ele não vinha, existe candidato mas ninguém confirmou —
       e confirmar não é papel de um portão. */
    const jaTinham = ligadosTocados.filter(l => {
      const antes = mapaAntes.get(String(l.no));
      return antes && antes.credentials && Object.keys(antes.credentials).length;
    });
    if (jaTinham.length === ligadosTocados.length) {
      return linha(4, "Credencial referenciável", COR.ok,
        "os " + ligadosTocados.length + " nó(s) tocados que pedem credencial já vinham com uma antes "
        + "deste patch — nada novo a decidir");
    }
    return linha(4, "Credencial referenciável", COR.cinza,
      (ligadosTocados.length - jaTinham.length) + " nó(s) tocados pedem credencial e não vinham com uma. "
      + "Existe candidato entre os que os seus fluxos referenciam, mas o catálogo não é o inventário da "
      + "conta (`GET /credentials` responde 405 aqui) — confirme no n8n",
      ligadosTocados.filter(l => !jaTinham.includes(l)).map(l => "`" + l.no + "` → " + l.nome));
  }

  return linha(4, "Credencial referenciável", COR.cinza,
    vaziosTocados.length + " nó(s) tocados pedem credencial e o catálogo não desempata. Ele carrega só o "
    + "que os seus fluxos JÁ referenciam, nunca o inventário da conta — a decisão é sua, no n8n",
    vaziosTocados.map(v => "`" + v.no + "` — " + v.motivo));
}

/* ══════════════════════════════ 6 — Impacto medido ══════════════════════════
 *
 * É NÚMERO, NÃO VEREDITO. Quantas execuções passaram pelos nós que este patch
 * toca. Tráfego alto não reprova nada — mexer num nó com 645 execuções hoje é
 * decisão informada, não erro —, então o teto desta linha é LARANJA e ela nunca
 * fica vermelha. É exatamente o papel que o §5.2 reserva para o laranja: passou,
 * e você precisa saber disso antes de clicar.
 *
 * Cinza quando não há amostra: sem `execucoesPorNo` a linha não sabe nada, e
 * "zero execuções" e "não medi" são fatos opostos sobre o risco do clique. */
/* ─────────────────────────────── checagem 8: destino de rede ──────────────── */

/* A checagem que não existia, e a auditoria de 24/08/2026 mediu o preço da
 * ausência: das quatro variantes de exfiltração testadas contra o código REAL,
 * três passaram inteiras — `validate()` 10 de 10 com zero falhas, checagens 1, 2 e
 * 3 verdes, `podeAplicar: true`. Redirecionar a `url` de um `httpRequest` que já
 * existe é o pior caso, porque `credentials-untouched` fica verde JUSTAMENTE por a
 * credencial não ter sido tocada: o nó segue autenticando e passa a mandar tudo
 * para outro lugar.
 *
 * PESO, e é a decisão desta linha, não um detalhe. Destino novo REPROVA em vez de
 * ressalvar. Três razões, e a terceira é a que decide:
 *   1. é raro num patch de correção — a régua sai do próprio fluxo, então só
 *      dispara quando aparece um endereço que o fluxo inteiro não alcançava;
 *   2. é a única classe aqui cujo efeito não tem desfazer: o backup restaura o
 *      documento, não o dado que já saiu;
 *   3. o texto que escreve este patch pode ter vindo de um estranho pelo WhatsApp
 *      (caminho medido no `03-subprocesso-e-prompt.md`), e o único humano no meio
 *      é alguém lendo um diff de 179 nós.
 * O preço é declarado: um patch que acrescenta uma integração NOVA de verdade não
 * passa por aqui, e a frase diz o caminho — pôr o nó no editor do n8n à mão.
 *
 * `mencaoNova`, `leSegredo` e `despejo` ficam em RESSALVA: são fatos que merecem
 * ser ditos e não são, sozinhos, uma saída de dado. Misturar os dois pesos faria a
 * linha vermelha aparecer no dia em que alguém edita o prompt de um agente — e a
 * calibração do `preencher.js` já pagou para aprender que um vermelho frequente e
 * inconsequente ensina a clicar em ignorar. */
/* A régua mora no `rede.js`, que é quem define os tipos de achado: dizer quais
   deles significam SAÍDA DE DADO é taxonomia da própria classificação. Aqui só se
   decide o PESO (vermelho contra laranja), que é política e é desta casa.
   Importar em vez de repetir porque o `validate()` do `claude-fix.js` lê a mesma
   lista: duas cópias divergiriam na primeira correção feita num lado só, e o lado
   que divergisse desligaria o bloqueio no caminho que escreve em produção. */
const REPROVAM_REDE = rede.REPROVAM_REDE;

function checaRede(documento, proposta, deps) {
  const rd = (deps && deps.rede) || rede;
  let r;
  try { r = rd.varrer(documento, proposta); }
  catch (e) {
    /* Falha DURA, ao contrário do esquema: aqui cinza não serve. Se o portão que
       decide sobre saída de dado não rodou, o botão não pode aparecer — e
       `BLOQUEIAM` inclui `reprova`, então esta linha é o que segura. */
    return linha(8, "Destino de rede", COR.reprova,
      "não consegui conferir o destino de rede deste patch: "
      + String((e && e.message) || e).slice(0, 160)
      + " — sem essa conferência o botão não aparece, porque é ela que separa um patch que arruma "
      + "de um patch que manda o dado para fora");
  }

  const graves = r.achados.filter(a => REPROVAM_REDE.has(a.tipo));
  const leves = r.achados.filter(a => !REPROVAM_REDE.has(a.tipo) && a.tipo !== "teto");
  const tetos = r.achados.filter(a => a.tipo === "teto");

  if (graves.length) {
    return linha(8, "Destino de rede", COR.reprova,
      graves.length + " mudança(s) de destino de rede neste patch. O fluxo de antes alcançava "
      + r.conhecidos.length + " endereço(s), e este patch acrescenta destino que não estava lá — "
      + "se a integração é nova de propósito, o caminho é pôr o nó no editor do n8n à mão, "
      + "não aprovar por aqui",
      graves.concat(tetos).map(a => rd.frase(a)));
  }

  if (tetos.length) {
    return linha(8, "Destino de rede", COR.reprova,
      "não terminei de varrer os destinos deste patch, então não posso dizer que ele não abre um novo",
      tetos.map(a => rd.frase(a)));
  }

  if (leves.length) {
    return linha(8, "Destino de rede", COR.ressalva,
      "nenhum destino novo, mas " + leves.length + " coisa(s) mudaram no que este patch lê ou cita",
      leves.map(a => rd.frase(a)));
  }

  return linha(8, "Destino de rede", COR.ok,
    "nenhum endereço novo: tudo que os nós tocados alcançam já era alcançado pelo fluxo de antes"
    + (r.conhecidos.length ? " (" + r.conhecidos.length + " endereço(s) conhecido(s))" : ""));
}

function checaImpacto(patch, contexto) {
  const porNo = contexto && contexto.execucoesPorNo;
  if (!porNo || typeof porNo !== "object") {
    return linha(6, "Impacto medido", COR.cinza,
      "não medi o tráfego dos nós tocados nesta rodada — sem amostra de execução não dá para dizer "
      + "se este patch mexe em caminho quente ou em caminho parado");
  }

  const tocados = [...nosTocados(patch)];
  const comTrafego = tocados
    .map(n => ({ no: n, execs: Number(porNo[n]) || 0 }))
    .filter(x => x.execs > 0)
    .sort((a, b) => b.execs - a.execs);

  if (!comTrafego.length) {
    return linha(6, "Impacto medido", COR.ok,
      "nenhum dos " + tocados.length + " nó(s) tocados aparece nas execuções da amostra — "
      + "este patch mexe em caminho que não rodou na janela");
  }

  const total = comTrafego.reduce((s, x) => s + x.execs, 0);
  return linha(6, "Impacto medido", COR.ressalva,
    comTrafego.length + " de " + tocados.length + " nó(s) tocados rodaram na janela, "
    + total + " execução(ões) no total — o mais quente é `" + comTrafego[0].no + "` com "
    + comTrafego[0].execs,
    comTrafego.map(x => "`" + x.no + "` — " + x.execs + " execução(ões)"));
}

/* ══════════════════════════════════ a bateria ═══════════════════════════════ */

/* `linhasExtras` é o ponto de injeção das 5a, 5b e 7. Elas chegam PRONTAS: a 5a e
 * a 5b precisam de `runData` das execuções (rede), e a 7 escreve uma cópia
 * `[SANDBOX upgrade]` na instância — nenhuma das três podia morar num módulo cuja
 * garantia é não falar com o n8n. O contrato é só a forma da linha; a interface
 * delas é de quem as constrói.
 *
 * `bloqueia` inclui `accent`: uma checagem AINDA RODANDO bloqueia, senão o botão
 * apareceria durante a conferência e alguém clicaria em cima de um veredito que
 * não chegou. É o §5.1 literal — "o botão aparece quando não há vermelho E nada
 * está mais rodando". */
function bateria({ documento, patch, proposta, contexto } = {}) {
  const ctx = contexto || {};
  const deps = ctx.deps || null;
  const tocados = nosTocados(patch);

  const linhas = [
    checaEstrutura(documento, proposta),
    checaEsquema(proposta, tocados, deps),
    checaGramatica(proposta, tocados, patch),
    checaCredencial(documento, proposta, patch, ctx, deps),
    checaRede(documento, proposta, deps),
    checaImpacto(patch, ctx)
  ];

  for (const extra of (Array.isArray(ctx.linhasExtras) ? ctx.linhasExtras : [])) {
    if (extra && extra.n) linhas.push(extra);
  }

  linhas.sort((a, b) => {
    const x = ordemDe(a.n), y = ordemDe(b.n);
    return x[0] - y[0] || String(x[1]).localeCompare(String(y[1]));
  });

  const bloqueia = linhas.some(l => BLOQUEIAM.has(l.cor));
  return { linhas, bloqueia, podeAplicar: !bloqueia };
}

module.exports = {
  bateria,
  COR, BLOQUEIAM, DETALHE_MAX,
  // exportadas para teste: cada checagem é conferível sozinha, sem montar a bateria
  checaEstrutura, checaEsquema, checaGramatica, checaCredencial, checaRede, checaImpacto,
  REPROVAM_REDE,
  nosTocados, nosNovos, ordemDe, linha
};

/* ═══════════════════════════ onde o plano foi ambíguo ═══════════════════════
 *
 * Três pontos onde tive de escolher, e os três merecem ser contestados:
 *
 * 1. §5.7 diz "vermelho SÓ quando o patch escreve nó novo que exige credencial e
 *    há ZERO candidatos". §5.7.1 (rodada 2, posterior) diz "nó NOVO que exige
 *    credencial é VERMELHO por padrão", porque `applyPatch` proíbe `credentials`
 *    e portanto o patch não pode anexar nenhuma — com dez candidatos ou com zero.
 *    Segui o §5.7.1: a rodada posterior vence, e o raciocínio dele fecha. A
 *    contagem de candidatos ficou fora da decisão.
 *
 * 2. A tabela do §5 dá `n8n-gramatica.md` como fonte da checagem 3, mas aquele
 *    arquivo é PROSA e `gramatica.js` só o lê e serve — não existe conferidor. Então
 *    transcrevi em código as regras daquele documento que são mecanicamente
 *    conferíveis (o `=` na frente, `operator` como objeto, `__rl` completo, os três
 *    níveis de `connections`) e deixei de fora as que são de julgamento
 *    (`onError`/`retryOnFail` "em nó que escreve fora"), porque decidir se um nó
 *    "escreve fora" é juízo que reprovaria patch legítimo. A consequência é que a
 *    checagem 3 não cobre a gramática inteira, e a frase dela nomeia só o que
 *    conferiu.
 *
 * 3. O §5 não diz o que a checagem 6 faz quando NÃO há amostra. Pus cinza, porque
 *    "nenhum nó tocado rodou" e "não medi" são fatos opostos sobre o risco do
 *    clique, e a regra geral do §5.1 manda o cinza carregar o motivo. A alternativa
 *    seria verde, que afirmaria ausência de tráfego a partir de ausência de dado. */
