/* dossie.js — o dossiê do fluxo (PLAN-UPGRADE.md §2).
 *
 * POR QUE EXISTE, em um número: ler o documento inteiro do `Agente Iago
 * Comercial` custa ~81k tokens de entrada (291KB medidos). O dossiê é prosa de
 * ~6KB descrevendo o que cada trecho faz. Ele substitui a EXPLORAÇÃO — nunca a
 * edição: para mexer num nó, a sessão continua lendo o JSON real daquele nó.
 *
 * FATOS AQUI, JUÍZO NA TELA — com uma exceção declarada: o semáforo de
 * divergência (`estado`) é regra, e ela mora aqui porque `upgrade.js`, a tela e
 * o prompt precisam da MESMA resposta. Duas definições de "o dossiê está em dia"
 * seria a mesma deriva que `SCRATCH` já tem entre duas páginas.
 *
 * TRÊS COISAS QUE ESTE ARQUIVO NÃO FAZ:
 *   - não regenera nada sozinho (§2.8: gastar sem clique é o que este codebase
 *     recusa em todo lugar). Quem chama é um comando ou um botão, com o preço;
 *   - não escreve no n8n. Nenhuma função daqui importa `putWorkflow`;
 *   - não promete que a prosa está certa. A impressão digital prova que o nó e a
 *     vizinhança não mudaram, NUNCA que a descrição estava correta. Por isso o
 *     `.md` nasce com duas etiquetas: escrito por um modelo, e a partir de tal
 *     versão.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const n8n = require("./n8n.js");
const fix = require("./claude-fix.js");
const tester = require("./tester.js");

const DIR = path.join(__dirname, ".cache-fluxos");
const RUNS = path.join(__dirname, ".dossie-runs");
const LEDGER = path.join(__dirname, "dossies.json");

/* Sonnet basta: o dossiê é descrição de estrutura, não escrita de JSON — e é o
   gasto recorrente desta aba, então o modelo caro aqui custa duas vezes. */
const MODELO = process.env.COCKPIT_DOSSIE_MODELO || "sonnet";
/* 15 min por rodada, e o número é medido: 7 min mataram as duas rodadas do
   eContrate (103 nós) no meio da escrita, e o Iago tem 179. O que decide o tempo
   é o TAMANHO do que a sessão escreve — ~21KB de prosa para o eContrate — e não
   a dificuldade. Teto curto aqui não economiza: ele gasta a cota inteira e joga
   fora o arquivo. */
const TETO_MS = Number(process.env.COCKPIT_DOSSIE_TIMEOUT_MS || 900000);
const MAX_RODADAS = 2;

/* ═══════════════════════════════ A IMPRESSÃO DIGITAL ═══════════════════════
 *
 * §2.4: cache por NÓ, não por fluxo. Não é otimização — medido 2026-08-13,
 * `Agente Iago Comercial` e `Agente eContrate` foram editados no mesmo dia. Um
 * cache por fluxo venceria diariamente nos dois fluxos mais caros, e o dossiê
 * custaria mais do que economiza.
 *
 * §2.4.1: e a impressão NÃO é só o JSON do nó. Hash apenas do nó deixa passar o
 * caso que mais importa — um `rewire` entre nós que já existem muda a topologia
 * sem alterar um byte de nenhum nó, e a frase "o `Code_montar_payload` recebe do
 * buffer" fica falsa com todos os hashes intactos. Então entram três coisas:
 *
 *   1. o JSON do próprio nó, sem `credentials`, sem `position`, sem `id`
 *      (posição é layout do editor; mover um nó não muda o que ele faz);
 *   2. a assinatura de adjacência: quem entra e quem sai, COM porta e ramo, em
 *      ordem canônica — é o que pega `rewire`, troca de ramo em `switch` e
 *      reordenação de saída;
 *   3. um hash GLOBAL de `connections` e `settings`, no cabeçalho — é o que pega
 *      `executionOrder`, `errorWorkflow` e `timezone`, que mudam o comportamento
 *      de todo parágrafo sem tocar nó nenhum.
 *
 * §Step 1 do PLAN incremental: o global de (3) é UM hash para DOIS fatos, e os
 * dois pedem reparo de tamanho diferente. `settings` mudado reenquadra todo
 * parágrafo — a alegação original vale inteira. `connections` mudado invalida o
 * MAPA, que é a `## visão geral`, uma seção; os parágrafos por nó já estão
 * protegidos pela assinatura de adjacência de (2). Então entram duas impressões
 * novas, e o global de (3) FICA como estava, byte a byte, porque é ele que
 * mantém legíveis os dois dossiês que existem:
 *
 *   4. `settingsFp` — só `settings`, para o ramo que continua vermelho;
 *   5. `conexoesPorNo` — um hash POR NÓ DE ORIGEM da lista de saída daquele nó,
 *      PRESERVANDO A ORDEM DO ARRAY. Um hash agregado de `connections` detecta
 *      mas não LOCALIZA, e a rodada 2 da revisão mostrou o preço disso: na
 *      reordenação de irmãos dentro do mesmo ramo (`A.main[0]: [B,C] → [C,B]`) o
 *      `sort` de `adjacencias()` apaga a diferença, nenhuma impressão de nó se
 *      move, e o parágrafo que fica velho é o DO NÓ DE ORIGEM — justamente onde o
 *      contrato do dossiê permite dizer para quem ele manda, e portanto em que
 *      ordem. Por chave, a origem cai em `mudados` pelo caminho normal e não
 *      existe caso especial em lugar nenhum.
 *
 * A alternativa mais direta — pôr o índice-no-array dentro da tupla de
 * `adjacencias()` — foi RECUSADA com motivo: ela moveria TODA impressão de nó que
 * existe, invalidando os dois dossiês escritos e custando ~US$6,20 para
 * reconstruí-los por causa de um caso que ninguém encontrou ainda. O mapa mora no
 * cabeçalho exatamente para que nenhuma impressão antiga se mova.
 */

/* Só o que executa. Sticky notes nunca aparecem em `runData`, não conectam nada,
   e um parágrafo sobre um post-it seria linha paga sem informação. */
const ehSticky = t => String(t || "").endsWith(".stickyNote");
const executaveis = wf => (wf.nodes || []).filter(n => !ehSticky(n.type));

const sha = (s, hex = 16) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, hex);

/* QUANTOS HEX POR CHAVE DO MAPA DE CONEXÕES, e a decisão é de TAMANHO de
   cabeçalho, não de colisão. Medido no `Agente Iago Comercial` real (o
   `fluxo.json` da sessão que escreveu o dossiê): 161 chaves de `connections`; o
   mapa inteiro ocupa 5475 caracteres com 12 hex e 6119 com 16 — 10% de
   diferença, porque o que domina é o NOME do nó (35 caracteres no maior), não o
   hash. SHA-256 inteiro custaria ~8,4KB para comprar nada.
   12 hex são 48 bits, comparados chave a chave contra um valor recém-calculado:
   ~3,6e-15 de chance de uma lista de saída trocada casar com a antiga. O que
   escolhi: 12, e o motivo de não brigar mais por isso é que o nome do nó é o
   custo, e ele é irredutível se a chave tem de ser localizável por nome.
   CONSEQUÊNCIA DECLARADA: o cabeçalho do Iago cresce ~5,5KB, e o cabeçalho é
   emitido por `paraPrompt` — ver o filtro de âncora lá, que é o que impede este
   mapa de virar 5,5KB de hex em cada prompt da aba de upgrade. */
const FP_CX_HEX = 12;

/* A VERSÃO DO PORTÃO DE VAZAMENTO, gravada no cabeçalho pelo `compor`. Ela não
   decide nada AQUI, de propósito: quem a usa é o modo incremental (Step 2), que
   precisa recusar herdar parágrafo de dossiê cujo portão é desconhecido ou mais
   velho que o atual. O motivo é o achado mais afiado da rodada 1: um literal
   herdado que já SAIU do fluxo não casa mais na varredura verbatim, então se ele
   também escapar da varredura de forma pessoal fica indetectável para sempre.
   Hoje isso é seguro só porque o parágrafo passou pelo portão com as MESMAS
   regras — o que é uma propriedade da VERSÃO do portão, e nada a registrava.
   Começa em 1; sobe quando `validar`/`vazou` mudarem de regra. */
const GATE_V = 1;

/* Chave estável: as chaves de objeto saem em ordem, senão a mesma configuração
   escrita em outra ordem daria hash diferente e o dossiê venceria de graça. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}

function semRuido(no) {
  const { credentials, position, id, ...resto } = no || {};
  return canon(resto);
}

/* Quem entra e quem sai de cada nó, com porta e ramo. `JSON.stringify` de array
   em vez de concatenação à mão: chave composta escrita a mão já falhou em
   silêncio duas vezes neste repositório.
   `saiOrdem` é a lista de saída NA ORDEM em que o array a declara, e ela é
   acumulada aqui em vez de derivada de `sai` porque as duas guardam coisas
   diferentes de propósito:
     - `sai` e `entra` são a tupla de QUATRO fatos, congelada: `porNo` depende
       delas, e mexer aqui moveria toda impressão de nó que existe no disco;
     - `saiOrdem` guarda os mesmos quatro MAIS qualquer chave do objeto de conexão
       que este código não reconhece. Medido nos dois fluxos reais: hoje não existe
       nenhuma (`node`, `type`, `index` e nada além). A quinta posição existe para
       o dia em que o n8n acrescentar um fato à aresta — uma condição, um rótulo —
       e ela só aparece quando há algo, então não custa byte no caso normal. Sem
       ela, um fato novo com significado entraria no fluxo sem mover nada e o
       dossiê seguiria verde descrevendo outra coisa.
   UMA travessia para as três: reescrever esta varredura num segundo lugar é o
   defeito de "duas cópias divergem no primeiro conserto feito num lado só", e o
   lado que divergisse decidiria se um dossiê está em dia. */
const CX_CONHECIDAS = ["node", "type", "index"];

function adjacencias(wf) {
  const entra = new Map();
  const sai = new Map();
  const saiOrdem = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const [de, portas] of Object.entries(wf.connections || {})) {
    for (const [porta, ramos] of Object.entries(portas || {})) {
      (ramos || []).forEach((ramo, iRamo) => (ramo || []).forEach(c => {
        if (!c || !c.node) return;
        const quatro = [porta, iRamo, String(c.node), Number(c.index || 0)];
        push(sai, de, JSON.stringify(quatro));
        push(entra, String(c.node), JSON.stringify([porta, iRamo, de, Number(c.index || 0)]));
        const extras = Object.keys(c).filter(k => !CX_CONHECIDAS.includes(k)).sort();
        push(saiOrdem, de, JSON.stringify(extras.length
          ? [...quatro, canon(Object.fromEntries(extras.map(k => [k, c[k]])))]
          : quatro));
      }));
    }
  }
  const ordenar = m => { for (const v of m.values()) v.sort(); return m; };
  return { entra: ordenar(entra), sai: ordenar(sai), saiOrdem };
}

/* ══════════ O AGREGADO NORMALIZADO, E A POLÍTICA SOBRE RAMO VAZIO ══════════
 *
 * POR QUE ELE EXISTE: o `global` é calculado sobre `canon(wf.connections)` CRU, e
 * por isso ele vive num espaço semântico mais largo que o localizador por chave —
 * ele diverge por coisas que o localizador ignora de propósito. Usar o cru como
 * rede fail-closed dispararia vermelho por ruído conhecido; foi por isso que eu
 * tinha removido o ramo, e remover foi OVERCORRECTION: o que a medição derruba é o
 * AGREGADO COMO ESTAVA CALCULADO, não o ramo. Este é o agregado com a MESMA
 * semântica do `conexoesPorNo`, então o ramo volta a valer e só dispara em
 * divergência que de fato não dá para localizar.
 *
 * ELE É CAMPO NOVO, nunca redefinição do `global`: `dossie-test.js` fixa
 * `6126ecf1ce3d81f1` e as cinco impressões por nó, e esse pin é o que mantém
 * válidos os dois dossiês que custaram US$6,20. O `global` legado segue byte a
 * byte como está, servindo só o ramo de cabeçalho legado.
 *
 * ELE É UMA SEGUNDA CAMINHADA, INDEPENDENTE, e essa é a função dele: ele não
 * enxerga mais que o localizador — ele DISCORDA se uma das duas contas estiver
 * errada. Divergir o agregado sem nenhuma chave explicar, ou uma chave divergir
 * sem o agregado se mover, são as duas metades da mesma frase: as duas contas têm
 * de concordar, nunca discordar. Discordância é defeito do cockpit, e vira
 * vermelho por isso. Uma exceção em que ele enxerga mais: valor de porta que não é
 * array de ramos entra INTEIRO, então estrutura nova do n8on nesse nível move o
 * agregado mesmo que a tupla não a registre.
 *
 * ══ A POLÍTICA: RAMO SEM DESTINO NÃO INSTRUI NADA, ENTÃO MUDÁ-LO É VERDE ══
 *
 * Isto é decisão declarada, não efeito colateral, e o argumento é MECÂNICO antes
 * de ser estatístico: `connections[nó][porta]` é indexado pela saída do nó, e a
 * posição de cada aresta REAL viaja explícita como `iRamo` dentro da tupla. Um
 * ramo vazio DEPOIS da última aresta real não muda o `iRamo` de aresta nenhuma —
 * não existe leitura em que `[[{B}], []]` faça algo diferente de `[[{B}]]`. É o
 * mesmo raciocínio do `"options": {}` inaplicável no portão de esquema: valor
 * vazio não instrui nada, logo não pode ser a diferença entre um dossiê em dia e
 * um dossiê velho.
 *
 * O QUE A POLÍTICA **NÃO** COLAPSA, e é a metade que importa: ramo vazio no MEIO
 * empurra o `iRamo` das arestas seguintes — `[[{B}]]` para `[[], [{B}]]` muda a
 * saída de onde `B` pendura. Isso é estrutura, a tupla registra, e diverge. Não há
 * nada para decidir ali.
 *
 * A medição sustenta a política em vez de fundá-la: nos dois fluxos reais, TODOS
 * os ramos vazios são finais (9 de 9 no eContrate, 3 de 3 no Iago), nenhum no
 * meio, e nenhuma porta tem valor que não seja array. Medir "vazios existem" nunca
 * provaria que MUDAR um é irrelevante — o que prova é o `iRamo` explícito. */
const CX_PORTA_VAZIA = null;

function arestaNormalizada(c) {
  const extras = Object.keys(c).filter(k => !CX_CONHECIDAS.includes(k)).sort();
  const base = [String(c.node), Number(c.index || 0)];
  /* Mesmas cinco coisas que a tupla de `saiOrdem`, na mesma ordem de precedência:
     `type` fica fora (redundante com a porta, e o editor o reescreve) e chave
     desconhecida entra. Se uma das duas metades deixasse `type` entrar, elas
     discordariam num fluxo em que o editor o omitiu — vermelho por nada. */
  return extras.length ? [...base, canon(Object.fromEntries(extras.map(k => [k, c[k]])))] : base;
}

function conexoesNormalizadas(wf) {
  const out = {};
  for (const [de, portas] of Object.entries(wf.connections || {})) {
    const p = {};
    for (const [porta, ramos] of Object.entries(portas || {})) {
      /* Ausência é ausência: `null`/`undefined` colapsa igual a `[]`. Qualquer
         OUTRA forma que não seja array é ESTRUTURA que este código não entende, e
         entra inteira — é a mesma direção da quinta posição da tupla, um nível
         acima. Medido: nos dois fluxos reais não existe nenhuma das duas. */
      if (ramos == CX_PORTA_VAZIA) continue;
      if (!Array.isArray(ramos)) { p[porta] = canon(ramos); continue; }
      const vivos = [];
      ramos.forEach((ramo, iRamo) => {
        const reais = Array.isArray(ramo) ? ramo.filter(c => c && c.node) : [];
        /* `iRamo` ENTRA JUNTO, e é ele que faz o colapso ser seguro: o ramo vazio
           desaparece e a posição de quem sobrou continua escrita. Sem ele, colapsar
           apagaria a diferença entre `[[{B}]]` e `[[], [{B}]]`, que é uma saída
           diferente do nó. A ordem das arestas dentro do ramo vem do `map`, nunca
           de um `sort`: é a reordenação de irmãos, o achado da rodada 1. */
        if (reais.length) vivos.push([iRamo, reais.map(arestaNormalizada)]);
      });
      if (vivos.length) p[porta] = vivos;
    }
    if (Object.keys(p).length) out[de] = p;
  }
  return canon(out);
}

function impressoes(wf) {
  const { entra, sai, saiOrdem } = adjacencias(wf);
  /* O global cobre `connections` inteiro e `settings`: contexto de execução
     diferente reescreve o significado de tudo que está no dossiê.
     ELE NÃO MUDA UM BYTE com o split, e isto é a compatibilidade: é ele que
     `estado()` compara quando o cabeçalho é legado, e mexer aqui invalidaria os
     dois dossiês que existem — ~US$6,20 para reescrever. */
  const global = sha(JSON.stringify([canon(wf.connections || {}), canon(wf.settings || {})]));
  /* Só `settings`. O ramo que ele decide continua vermelho: `executionOrder`,
     `errorWorkflow`, `timezone` e `callerPolicy` reenquadram todo parágrafo, e
     essa é a metade da alegação original que o split PRESERVA em vez de negar. */
  const settingsFp = sha(JSON.stringify(canon(wf.settings || {})));
  /* A lista de saída por origem, na ordem declarada. Vem das tuplas de
     `adjacencias` em vez de `canon(connections[nome])` bruto por três motivos, e
     os três evitam falso positivo, não são estética:
       - `{}`, `{main: []}` e chave ausente colapsam no mesmo nada (uma origem sem
         destino real não entra no mapa). O editor do n8n deixa objeto vazio para
         trás, e "valor vazio não instrui nada, logo não é defeito" é a mesma
         calibração que o portão de esquema já pagou;
       - o `type` da conexão é redundante com a porta e o editor o reescreve;
       - a tupla é o MESMO vocabulário de `adjacencias`, então as duas nunca podem
         discordar sobre o que é uma aresta. */
  const conexoesPorNo = new Map();
  for (const [de, lista] of saiOrdem) {
    if (!lista.length) continue;
    conexoesPorNo.set(String(de), sha(JSON.stringify(lista), FP_CX_HEX));
  }
  /* O agregado com a MESMA semântica do mapa acima, caminhado por fora dele — ver
     o bloco de política sobre ramo vazio. É a rede fail-closed do desenho, e o
     `global` cru não podia sê-la porque diverge por ruído que o mapa ignora. */
  const conexoesFp = sha(JSON.stringify(conexoesNormalizadas(wf)));
  const porNo = new Map();
  /* SÓ O QUE EXECUTA, e isto é correção de um defeito medido, não filtro
     estético: o dossiê não descreve sticky note (não executa nada, nunca aparece
     em `runData`), então marcar um deles aqui faria `estado()` achar um nó "que
     entrou" em TODA comparação — e todo dossiê nasceria vermelho para sempre.
     Iago e eContrate são cheios de sticky note; é lá que moram os nomes dos
     trechos. Editar um post-it também não pode invalidar nada. */
  for (const no of executaveis(wf)) {
    const nome = String(no.name);
    porNo.set(nome, sha(JSON.stringify([
      semRuido(no),
      entra.get(nome) || [],
      sai.get(nome) || []
    ])));
  }
  return { global, settingsFp, conexoesFp, conexoesPorNo, porNo };
}

/* ══════════════════════════════ O SEMÁFORO ════════════════════════════════
 *
 * §2.5: divergência decide, NUNCA data. Dossiê de 30 dias de um fluxo estável há
 * 48 está correto; dossiê de 2 horas de um fluxo editado há 10 minutos está
 * errado. Mesma disciplina de `fixState()`, que compara id de execução e não o
 * relógio, e do cache do esquema, que é por mtime e não TTL.
 *
 * §2.7: CINZA NUNCA É VERMELHO. Nunca escrito e desatualizado levam a decisões
 * opostas, e este repositório pagou essa lição três vezes (`docAgentes` ausente
 * lido como negativo, `usd: 0` de rodada morta, `Response.json()` sobre corpo
 * `404`). Ausência tem ramo próprio.
 */

const LIMITE_LARANJA = 0.25;

function estado(dossie, wf) {
  if (!dossie) return { cor: "cinza", motivo: "nunca foi escrito", mudados: [], entraram: [], sairam: [], visaoSuspeita: false };

  const imp = impressoes(wf);
  const descritos = new Set(dossie.paragrafos.map(p => p.no));
  const atuais = new Set(imp.porNo.keys());

  const entraram = [...atuais].filter(n => !descritos.has(n));
  const sairam = [...descritos].filter(n => !atuais.has(n));
  const mudados = dossie.paragrafos
    .filter(p => atuais.has(p.no) && imp.porNo.get(p.no) !== p.fp)
    .map(p => p.no);

  const globalMudou = !!(dossie.global && dossie.global !== imp.global);

  /* CABEÇALHO LEGADO: escrito antes do split, então só tem `fp`. Ele não sabe
     dizer QUAL dos dois fatos se moveu, e por isso o único caminho honesto é o de
     antes — comparar `fp` contra o global recém-calculado e, se divergiu, vermelho
     inteiro. FAIL-CLOSED nos TRÊS campos: falta um, é legado. Um cabeçalho novo
     tem os três, mesmo com `settings: {}` (hash de "{}" não é vazio) e mesmo com
     `connections: {}` (hash de "{}" também não é vazio).
     `conexoesFp` entrou nesta conta depois, e entrou aqui e não numa tolerância
     própria de propósito: um cabeçalho com o mapa e sem o agregado é um cabeçalho
     sem a rede, e tolerá-lo seria repetir em miniatura exatamente o
     enfraquecimento que a rodada 4 recusou. Em produção não existe nenhum: os dois
     `.md` no disco são legados nos três campos, e `dossies.json` não tem linha
     nova desde então. */
  const legado = !dossie.settingsFp || !dossie.conexoesPorNo || !dossie.conexoesFp;

  /* A comparação por chave de conexão, e ela se divide em DUAS listas porque as
     duas levam a decisões opostas:
       - `cxMudaram`: a origem é um nó DESCRITO e que AINDA EXISTE, então a
         divergência é localizável e o parágrafo dela é regenerável. Entra em
         `mudados` pelo caminho normal;
       - `cxSemDono`: divergiu numa chave que não é nó descrito+existente (chave
         pendurada, sticky note como origem, nó que entrou). Divergência que não dá
         para localizar é divergência que não dá para remendar — vermelho, que é
         "se não der para identificar com prova, rewrite inteiro" ao pé da letra.
     A varredura é sobre a UNIÃO das chaves dos dois lados, e cada lado normaliza
     ausência para a MESMA sentinela `null`: sem isso, "ausente aqui" e "ausente
     lá" chegariam como `undefined` de um lado e `null` do outro e a comparação
     responderia por acidente de tipo. Chave que só existe num dos lados é uma
     origem que passou a mandar (ou parou de mandar), e isso é divergência. */
  const cxMudaram = [];
  const cxSemDono = [];
  if (!legado) {
    /* `|| {}` para que um cabeçalho meio escrito produza uma RECUSA com nome e não
       um `TypeError`. Este arquivo já pagou essa lição: `## no:` com dois espaços
       jogava um `Cannot read properties of null` no meio de uma rodada paga, sem
       mensagem de retry e sem linha no ledger. Exceção não é veredito. */
    const antes = dossie.conexoesPorNo || {};
    for (const k of new Set([...Object.keys(antes), ...imp.conexoesPorNo.keys()])) {
      const a = antes[k] == null ? null : String(antes[k]);
      const b = imp.conexoesPorNo.has(k) ? imp.conexoesPorNo.get(k) : null;
      if (a === b) continue;
      if (descritos.has(k) && atuais.has(k)) cxMudaram.push(k);
      else cxSemDono.push(k);
    }
  }
  const cxDivergiu = cxMudaram.length > 0 || cxSemDono.length > 0;

  /* AS DUAS CONTAS TÊM DE CONCORDAR, NUNCA DISCORDAR — a rede fail-closed do
     desenho, e ela é SIMÉTRICA de propósito. `conexoesFp` é uma segunda caminhada
     independente sobre a mesma semântica do mapa por chave (ver o bloco de
     política sobre ramo vazio). Logo:
       - agregado divergiu e nenhuma chave explica → há mudança de conexão que o
         localizador não viu, e o que não dá para localizar não dá para remendar;
       - alguma chave divergiu e o agregado NÃO se moveu → o agregado está cego, e
         um agregado cego é uma rede que não existe.
     Os dois lados são o mesmo defeito visto de pontas opostas, e é ISTO que a
     assimetria da primeira versão perdeu: eu tinha trocado um fail-closed aprovado
     por "confio que o localizador cobre tudo". A rodada 4 recusou, com razão.
     DISCORDÂNCIA É DEFEITO DO COCKPIT, não mudança do fluxo, e o motivo diz isso —
     mandar procurar no fluxo uma divergência que está na nossa conta é o pior
     diagnóstico possível aqui.
     Nenhum fluxo legítimo alcança este ramo: as duas contas leem o mesmo documento
     com a mesma semântica. É tratado em vez de assumido porque o dia em que ele
     disparar é o dia em que uma das duas está errada, e o preço de não perceber é
     um verde mentiroso numa função que também decide se a aba trava. */
  const cxAgregadoMudou = !legado && dossie.conexoesFp !== imp.conexoesFp;
  const discordancia = !legado && cxAgregadoMudou !== cxDivergiu;
  /* A VISÃO GERAL é o mapa do fluxo: quais trechos existem e em que ordem. Ela é
     o que uma mudança de `connections` invalida, e é UMA seção. `visaoSuspeita`
     reporta essa medição e nada mais — nunca "a prosa está errada".
     No ramo legado ela é FALSA de propósito: um cabeçalho velho não sabe se o que
     se moveu foi `settings` ou `connections`, e dizer "a visão está suspeita" ali
     seria afirmar o que não se mediu. */
  const visaoSuspeita = cxDivergiu || discordancia;

  /* A ORIGEM DA CONEXÃO QUE MUDOU ENTRA EM `mudados` PELO CAMINHO NORMAL, e é
     isso que faz o resto desta função não ter caso especial nenhum: a cor sai da
     mesma regra dos 25%, o parágrafo é regenerado pela mesma lista, e a tela
     mostra a mesma coisa. O `Set` é por nome porque um rewire move a impressão do
     nó E a chave de conexão dele ao mesmo tempo — sem dedupe, um nó só contaria
     duas vezes na fatia e a fronteira dos 25% mentiria.
     O ramo de `entraram`/`sairam` acima segue usando o `mudados` cru: ele é
     vermelho, não é entregue a sessão nenhuma, e a instrução deste passo é não
     tocar nele. */
  const mudadosComCx = [...new Set([...mudados, ...cxMudaram])];

  /* §2.6: nó adicionado ou removido vai DIRETO para vermelho. A frase "os nós
     12–19 são o buffer" fica falsa quando entra um nó no meio, mesmo com os oito
     originais intactos. A topologia mudou, o mapa mudou.
     ESTE RAMO VEM ANTES DO GLOBAL de propósito: acrescentar um nó quase sempre
     acrescenta uma aresta, então o global também divergiu — e se ele respondesse
     primeiro, a mensagem específica ("2 nós entraram: X, Y") ficaria escondida
     para sempre atrás da genérica. Os dois são vermelho; quem escolhe a frase é
     quem tem o diagnóstico mais acionável. */
  if (entraram.length || sairam.length) {
    return { cor: "vermelho",
      motivo: (entraram.length ? entraram.length + " nó(s) entraram" : "") +
              (entraram.length && sairam.length ? " e " : "") +
              (sairam.length ? sairam.length + " saíram" : "") + " — o mapa do fluxo mudou",
      mudados, entraram, sairam, global: globalMudou, visaoSuspeita };
  }

  if (legado) {
    /* Divergência no hash global invalida o dossiê INTEIRO — vermelho, não
       laranja (§2.4.1). Não é o caso de "N parágrafos suspeitos": é todo parágrafo
       falando de um contexto de execução que mudou.
       ESTE RAMO SÓ VALE PARA CABEÇALHO LEGADO agora. Antes do split ele também
       respondia pelo `rewire` puro, e é aí que o motivo mudou: com o mapa por
       chave, um rewire é localizável e vira `mudados` + `visaoSuspeita`. Aqui,
       sem mapa, "não sei qual dos dois se moveu" segue sendo a resposta honesta —
       e vermelho recusa herança, então a única migração de um cabeçalho legado
       divergente é o rewrite inteiro, que reescreve o cabeçalho com os campos
       novos. É isto que impede os dois dossiês que existem de nascerem inválidos
       no deploy: se nada divergiu, `fp === global` e eles seguem verdes. */
    if (globalMudou) {
      return { cor: "vermelho", motivo: "as conexões ou os settings do fluxo mudaram — isso reescreve o sentido de todo o dossiê",
        mudados, entraram, sairam, global: true, visaoSuspeita: false };
    }
  } else {
    /* `settings` mudado é a metade da alegação original que o split PRESERVA:
       `executionOrder`, `errorWorkflow`, `timezone` e `callerPolicy` reenquadram
       todo parágrafo sem tocar nó nenhum. Vermelho, e o motivo NOMEIA `settings` —
       antes ele dizia "as conexões ou os settings", que manda quem lê procurar nos
       dois lugares quando a medição já sabe qual dos dois foi. */
    if (dossie.settingsFp !== imp.settingsFp) {
      return { cor: "vermelho", motivo: "os `settings` do fluxo mudaram (ordem de execução, fuso, fluxo de erro) — isso reescreve o sentido de todo o dossiê",
        mudados: mudadosComCx, entraram, sairam, global: globalMudou, visaoSuspeita };
    }
    if (cxSemDono.length) {
      return { cor: "vermelho",
        motivo: "as conexões do fluxo mudaram e não deu para dizer em qual nó — sem localizar, não dá para remendar",
        mudados: mudadosComCx, entraram, sairam, global: globalMudou, visaoSuspeita: true };
    }
    /* A rede simétrica. Frase própria porque o diagnóstico é próprio: aqui o
       suspeito é o cockpit, não o fluxo, e quem lê tem de saber que não vai achar
       nada abrindo o editor do n8n. */
    if (discordancia) {
      return { cor: "vermelho",
        motivo: "o cockpit mediu as conexões de duas formas e as duas discordaram — é defeito nosso, não mudança sua; o dossiê inteiro fica suspeito até isso ser investigado",
        mudados: mudadosComCx, entraram, sairam, global: globalMudou, visaoSuspeita: true };
    }
  }

  /* O PISO: verde exige que a visão também esteja em pé — nunca verde com o mapa
     suspeito, porque a reordenação de irmãos sairia "nada divergiu", que é pior que
     a invalidação inteira que o split veio melhorar.
     ELE ESTÁ ESCRITO DUAS VEZES, e a de cima carrega o peso: quem impede o verde é
     `mudadosComCx` ter a origem da conexão dentro, porque aí a lista não está vazia
     e a função nem chega aqui. O `!visaoSuspeita` é redundante HOJE — verificado
     por mutante: removê-lo sozinho não derruba nenhum caso. FICA, e a rodada 4
     decidiu isso contra mim: numa função-semáforo que escolhe entre falso-verde e
     travar a aba, redundância barata e documentada é cinto de segurança aceitável.
     O mutante que remove OS DOIS juntos volta vermelho, que é a prova de que o
     cinto serve para alguma coisa.
     E O QUE ESTE PARÁGRAFO NÃO DIZ, porque foi assim que ele foi usado errado uma
     vez: esta redundância NÃO é argumento para afrouxar a rede mais forte. Guardar
     um net morto aqui é barato; trocar um fail-closed aprovado por "confio que o
     localizador cobre tudo" foi o que a rodada 4 recusou, e está desfeito acima. */
  if (!mudadosComCx.length && !visaoSuspeita) {
    return { cor: "verde", motivo: "nenhum nó divergente", mudados: [], entraram: [], sairam: [], visaoSuspeita: false };
  }

  const fatia = mudadosComCx.length / Math.max(1, atuais.size);
  /* A frase da visão vai junto do número, nas duas cores: quem lê precisa saber
     que além dos N nós o MAPA está suspeito, e é uma seção diferente de um
     parágrafo de nó. */
  const notaCx = visaoSuspeita ? " · as conexões mudaram, então a `## visão geral` está suspeita" : "";
  if (fatia > LIMITE_LARANJA) {
    return { cor: "vermelho",
      motivo: mudadosComCx.length + " de " + atuais.size + " nós mudaram (" + Math.round(fatia * 100) + "%)" + notaCx,
      mudados: mudadosComCx, entraram: [], sairam: [], visaoSuspeita };
  }
  return { cor: "laranja", motivo: mudadosComCx.length + " nó(s) mudaram desde o dossiê" + notaCx,
    mudados: mudadosComCx, entraram: [], sairam: [], visaoSuspeita };
}

/* §2.9: laranja é ENTREGUE com os parágrafos suspeitos marcados — a sessão lê o
   JSON real daqueles nós. Vermelho NÃO é entregue: cai para `nodes-index.md`.
   Pagar a leitura cara é melhor que patchar a partir de descrição errada. */
function paraPrompt(dossie, wf) {
  const st = estado(dossie, wf);
  if (st.cor === "cinza" || st.cor === "vermelho") return { usa: false, estado: st, texto: null };
  const suspeitos = new Set(st.mudados);
  /* A ÂNCORA `<!-- GLOBAL ... -->` SAI DAQUI, e isto é consequência do mapa por
     chave, não capricho: `cabecalho` é fatiado até a primeira âncora de nó, então
     ele carrega a âncora global inteira — que no Iago real passou de ~80 para
     ~5,5KB de hex ao ganhar 161 chaves. `paraPrompt` é o que a sessão da aba de
     upgrade lê, então herdar esses 5,5KB seria ~11% mais token de entrada por
     rodada em troca de zero: a âncora é metadado de máquina, e nenhuma decisão da
     sessão depende dela. As duas etiquetas obrigatórias ("escrito por um modelo" e
     "a partir da versão de") são linhas de prosa e continuam inteiras, junto com a
     `## visão geral`. Filtra por LINHA de comentário HTML, não por regex sobre o
     texto todo, para não comer prosa que por acaso cite `-->`. */
  const cabecalhoLimpo = dossie.cabecalho
    .split("\n").filter(l => !/^<!--.*-->\s*$/.test(l.trim())).join("\n");
  const linhas = [cabecalhoLimpo.trim(), ""];
  for (const p of dossie.paragrafos) {
    linhas.push("## `" + p.no + "`" + marcaDoParagrafo(p, suspeitos));
    linhas.push(p.texto.trim(), "");
  }
  return { usa: true, estado: st, texto: linhas.join("\n") };
}

/* AS DUAS MARCAS SÃO FRASES DIFERENTES DE PROPÓSITO (§Step 3.2), e a mesma
   maquinaria `⚠` carrega as duas. Frase igual apagaria a única diferença que
   importa: uma é medição, a outra é aproximação.
     - `MUDOU`: a impressão digital do nó divergiu. É fato medido — o JSON ou as
       arestas daquele nó não são mais os que o parágrafo descreve;
     - `VIZINHO`: o nó NÃO mudou. Um nó ao lado dele foi reescrito na última
       escrita incremental, e o parágrafo foi herdado sem ser re-derivado. Isso é
       suspeita de staleness SEMÂNTICA, e um salto de raio não prova nada: o
       parágrafo do `Code_montar_payload` pode ficar falso porque o nó de Redis
       mudou a dez saltos de distância. A frase diz isso em vez de fingir prova.
   QUANDO AS DUAS VALEM, `MUDOU` GANHA: divergência de impressão é medida, a
   adjacência é aproximação, e a mais forte é a que tem de aparecer. */
function marcaDoParagrafo(p, suspeitos) {
  if (suspeitos.has(p.no)) return "  ⚠ MUDOU DEPOIS DESTE TEXTO — leia o JSON real deste nó antes de confiar";
  if (p.umHop) return "  ⚠ VIZINHO DE UMA MUDANÇA — este nó não mudou; um nó ao lado dele foi reescrito depois deste texto, e este parágrafo foi herdado sem ser refeito. Um salto de distância não é prova de nada: confira o que o vizinho passou a fazer";
  return "";
}

/* ═══════════════════ A ADMISSÃO DA ESCRITA INCREMENTAL (§Step 2) ═══════════
 *
 * Reparo proporcional ao que divergiu: reescrever os parágrafos dos nós que se
 * moveram e herdar o resto. Medido, o rewrite inteiro do Iago custou US$4,14 e
 * 682s — 76% do próprio teto de 15 min, e ele piora conforme o fluxo cresce.
 *
 * A REGRA DE ADMISSÃO É UMA SÓ, e ela sozinha fecha dois achados da rodada 1 da
 * revisão: INCREMENTAL SÓ A PARTIR DE DOSSIÊ VERDE OU LARANJA. Nunca vermelho,
 * nunca cinza.
 *   - vermelho já significa "todo parágrafo fala de um contexto que mudou";
 *     herdar dali publicaria prosa que o próprio portão declarou falsa. E como
 *     cabeçalho legado divergente é vermelho, a ÚNICA migração de um cabeçalho de
 *     antes do split é o rewrite inteiro — sem segundo mecanismo (achado 2);
 *   - `entraram`/`sairam` também é vermelho, então um nó entrando no meio do fluxo
 *     nunca herda nada (achado 3). "Os nós 12–19 são o buffer" fica falso quando
 *     entra um nó no meio, mesmo com os oito originais intactos;
 *   - cinza é a ausência, e ausência tem ramo próprio: não há de onde herdar.
 *   - COR DESCONHECIDA RECUSA. Uma quinta cor que signifique algo pior que
 *     vermelho não pode liberar herança por não estar na lista.
 *
 * COR NÃO BASTA, E A RODADA 2 ESTÁ CERTA SOBRE O MOTIVO: o semáforo é sobre
 * impressão digital, e um dossiê pode VOLTAR ao verde por impressão carregando
 * parágrafos que o Step 3 marcou como semanticamente suspeitos. Numa regra só de
 * cor, esse dossiê vira a base da herança seguinte e a deriva se acumula por
 * gerações com a tela verde o tempo todo. Dois limites, os dois no espaço `de`/`g`
 * que a âncora já tinha:
 *   - a marca de um salto NÃO EMPILHA (ver `planoIncremental`);
 *   - `g >= MAX_GERACOES` não é herdável.
 *
 * E O SELO DO PORTÃO É COBRADO AQUI. `GATE_V` é gravado pelo `compor` desde o
 * Step 1 e não decidia nada. Ele decide agora: herdar parágrafo é confiar que
 * aquele texto passou pelo portão de vazamento com as MESMAS regras, e isso é
 * propriedade da VERSÃO do portão. Sem selo, ou com selo mais velho, o único
 * caminho é rewrite inteiro. O achado mais afiado da rodada 1: um literal herdado
 * que já SAIU do fluxo não casa mais na varredura verbatim, então se ele também
 * escapar da varredura de forma pessoal fica indetectável para sempre.
 *
 * FATOS AQUI, e o veredito é o mesmo tipo de exceção declarada que o `estado`: a
 * tela, o CLI e o `construir` precisam da MESMA resposta sobre poder herdar.
 * As duas funções são PURAS — nenhuma rede — pelo mesmo motivo de `resolverAlvo`
 * e `custoDaRodada`: é o que permite provar os ramos sem abrir conexão. */

const CORES_HERDAVEIS = new Set(["verde", "laranja"]);

/* CHUTE NÃO CALIBRADO, E ROTULADO COMO TAL — igual a todo número deste
   repositório que ninguém mediu. Não existe UMA escrita incremental em
   `dossies.json` ainda, então não há histórico de que gerações um parágrafo
   sobrevive nem de quanto ele derivou nesse tempo. É o botão para girar quando
   houver, e errar aqui custa gasto a mais (um rewrite de parágrafo que não
   precisava), nunca um verde falso permanente — que é o lado certo para errar. */
const MAX_GERACOES = 3;

function admitirIncremental(dossie, st) {
  if (!dossie) return { ok: false, porque: "não existe dossiê deste fluxo — não há de onde herdar parágrafo" };
  if (!st || !CORES_HERDAVEIS.has(st.cor)) {
    const cor = st && st.cor ? st.cor : "desconhecida";
    return { ok: false, porque: "o dossiê está " + cor + ", e incremental só herda de verde ou laranja"
      + (cor === "vermelho" ? " — vermelho significa que todo parágrafo fala de um contexto que mudou" : "") };
  }
  /* TRÊS ESTADOS, e o ausente NÃO cai no ramo positivo: sem selo é um dossiê
     escrito por um código que não registrava a versão do portão, e "não sei qual
     portão aprovou este texto" é motivo de rewrite, não de confiança.
     Selo MAIS NOVO que o nosso é o caso do processo velho servindo arquivo novo —
     e um portão mais novo é mais FORTE, então o parágrafo passou por regra pelo
     menos tão dura quanto a atual. Herda, e o `>=` diz isso em uma linha. */
  if (dossie.gateV == null) {
    return { ok: false, porque: "o dossiê não tem o selo `gateV` do portão de vazamento — foi escrito antes de o selo existir, e herdar parágrafo sem saber que portão o aprovou é confiar numa versão que nada identifica" };
  }
  if (dossie.gateV < GATE_V) {
    return { ok: false, porque: "o selo do portão no dossiê é `gateV " + dossie.gateV + "` e o portão atual é `" + GATE_V + "` — as regras de vazamento mudaram desde que esses parágrafos foram aprovados" };
  }
  return { ok: true, porque: null };
}

/* ═══════ O AUTOMÁTICO DEPOIS DE APLICAR — §2.8 FLEXIBILIZADA POR ELE ═══════
 *
 * DECISÃO EXPLÍCITA DO KAUAN, tomada com a ressalva na mesa. O §2.8 do
 * `PLAN-UPGRADE.md` diz que nada regenera sozinho, e o §2.3.1 nomeia GASTO
 * INVISÍVEL como o risco desta aba; ele pediu que o dossiê seja atualizado sozinho
 * a cada upgrade aplicado, ouviu a ressalva e reafirmou. Este bloco existe para
 * cumprir isso SEM reabrir o defeito que a §2.8 fechava, e o desenho é o que
 * separa uma coisa da outra:
 *
 *   1. AUTOMÁTICO É INCREMENTAL, E SÓ INCREMENTAL POR PADRÃO. A escrita inteira do
 *      Iago foi US$4,14 e ~11 minutos MEDIDOS. Disparar isso a cada apply é a conta
 *      que ninguém autorizou. A recusa da herança é local e de graça
 *      (`admitirIncremental` é pura), então recusar não custa nada — e o padrão
 *      recusa em vez de cair para o inteiro, ao contrário do que o `construir` faz
 *      quando o INCREMENTAL FOI PEDIDO por um clique ou pelo CLI, onde quem pediu
 *      está lendo a linha.
 *   2. NENHUM FINAL É SILENCIOSO. Um dossiê que ele ACREDITA fresco e está velho é
 *      pior que um que ele sabe velho: a conversa seguinte remenda a partir de
 *      descrição errada com o semáforo dizendo verde. Por isso cada veredito daqui
 *      sai com `razao` e `porque`, e quem chama é obrigado a ter o que mostrar.
 *   3. O SEMÁFORO CONTINUA SENDO A REDE FINAL. Nada aqui escreve cor: dê no que
 *      der, `estado()` segue medindo a divergência real contra o fluxo vivo. Um
 *      automático que marcasse "em dia" por ter TENTADO seria exatamente o dossiê
 *      falso-fresco do item 2.
 *
 * PURO, e pelo mesmo motivo de `admitirIncremental` e de `resolverAlvo`: o veredito
 * de gastar dinheiro sozinho tem de ser provável sem rede, sem modelo e sem
 * servidor de pé. FATO — quem mostra a frase é a tela. */

const AUTO_OFF = "off";
const AUTO_INCREMENTAL = "incremental";
const AUTO_SEMPRE = "sempre";

/* TRÊS VALORES EXPLÍCITOS, NUNCA UM BOOLEANO. Um `COCKPIT_DOSSIE_AUTO=1` teria de
   escolher entre "só o barato" e "em dia a qualquer preço", e as duas leituras
   custam diferente em dinheiro — é justamente a escolha que não pode ficar
   implícita:
     · `off`         — desligado. Nada dispara depois de aplicar.
     · `incremental` — PADRÃO. Tenta a escrita parcial; herança recusada NÃO gasta.
     · `sempre`      — parcial quando der, rewrite INTEIRO quando a herança for
                       recusada. É o que ele liga se quiser o dossiê em dia a
                       qualquer preço, e o nome diz isso.

   AUSENTE CAI NO PADRÃO SEGURO, e valor DESCONHECIDO também — nunca no mais caro.
   Aqui o "ramo negativo" que este repositório já pagou cinco vezes é o GASTO: um
   typo em `sempre` que caísse em `sempre` gastaria US$4,14 por apply sem ninguém
   ter pedido. O bruto viaja de volta em `bruto` para a tela poder dizer que o valor
   foi ignorado — cair no padrão em silêncio seria a configuração dele não existir. */
function modoAuto(bruto) {
  const v = String(bruto == null ? "" : bruto).trim().toLowerCase();
  if (v === "") return { modo: AUTO_INCREMENTAL, bruto: null, reconhecido: true };
  if (v === AUTO_OFF || v === "0" || v === "nao" || v === "não") return { modo: AUTO_OFF, bruto: v, reconhecido: true };
  if (v === AUTO_INCREMENTAL) return { modo: AUTO_INCREMENTAL, bruto: v, reconhecido: true };
  if (v === AUTO_SEMPRE) return { modo: AUTO_SEMPRE, bruto: v, reconhecido: true };
  return { modo: AUTO_INCREMENTAL, bruto: v, reconhecido: false };
}

const AUTO = modoAuto(process.env.COCKPIT_DOSSIE_AUTO);

/* O VEREDITO. `st` é o `estado()` já calculado pelo chamador — a mesma régua da
   faixa, do cartão e do prompt, porque duas definições de "está em dia" divergem no
   primeiro conserto feito de um lado só e a que divergisse decidiria gasto.
 *
 * A ORDEM DOS RAMOS É O PRÓPRIO VEREDITO, e cada um deles é uma decisão:
 *
 *   · `desligado` primeiro, porque é de graça e não depende de nada.
 *   · `ocupado` antes dos estados do dossiê: duas escritas do mesmo fluxo pisam a
 *     pasta uma da outra, e o processo já só admite uma escrita por vez. DOIS
 *     APPLIES SEGUIDOS no mesmo fluxo caem aqui — e isso é "pulado, já tem uma
 *     escrita rodando", nunca sucesso e nunca erro feio.
 *   · `semdossie` em TODO modo, inclusive `sempre`. Ele pediu que o dossiê fique
 *     EM DIA, e não existe pôr em dia o que nunca foi escrito: a primeira escrita
 *     de um fluxo é uma decisão de outro tamanho (minutos e dólares) e não é
 *     consequência deste patch. É a mesma linha que a oferta do recibo já dá para
 *     o cinza.
 *   · `emdia` antes da admissão, e este ramo é o que impede o gasto mais bobo
 *     possível: verde significa que NADA divergiu, e uma parcial ali reescreveria
 *     só o mapa. Quem clica em atualizar um dossiê verde está pedindo a prosa
 *     RE-DERIVADA — pedido legítimo, e é um clique, não um efeito colateral.
 *   · a admissão por último, porque é a única que precisa do dossiê lido.
 *
 * COR DESCONHECIDA CAI EM `semdossie`? Não: cai na admissão, que a recusa por não
 * ser herdável — e aí o padrão pula. Fail-closed no gasto, com o motivo do
 * `admitirIncremental` na frase. */
function decidirAuto({ auto, dossie: doc, st, ocupadoPor, travadoPor }) {
  const a = auto || AUTO;
  const nao = (razao, porque) => ({ rodar: false, incremental: false, razao, porque, auto: a.modo });

  if (a.modo === AUTO_OFF) {
    return nao("desligado", "a atualização automática do dossiê está desligada (`COCKPIT_DOSSIE_AUTO="
      + (a.bruto || AUTO_OFF) + "`)");
  }
  if (ocupadoPor) {
    return nao("ocupado", "já tem uma escrita de dossiê rodando (" + String(ocupadoPor)
      + ") — uma por vez, então esta não começa");
  }
  if (travadoPor) {
    return nao("ocupado", "este fluxo já está com uma escrita de dossiê em curso desde "
      + String(travadoPor) + " — uma por vez, então esta não começa");
  }
  if (!doc) {
    return nao("semdossie", "este fluxo não tem dossiê, e o automático põe em dia o que existe —"
      + " escrever o primeiro é uma decisão de outro tamanho e continua sendo um clique");
  }
  if (!st) {
    return nao("semestado", "não deu para medir a divergência deste dossiê, e eu não gasto uma sessão"
      + " sobre um estado que não conheço");
  }
  if (st.cor === "verde") {
    return nao("emdia", "nenhum parágrafo envelheceu com este patch — o dossiê continua em dia");
  }

  const adm = admitirIncremental(doc, st);
  if (adm.ok) {
    return { rodar: true, incremental: true, razao: "incremental", auto: a.modo,
      porque: "a herança é admitida, então dá para refazer só o que divergiu" };
  }
  if (a.modo === AUTO_SEMPRE) {
    return { rodar: true, incremental: false, razao: "inteiro", auto: a.modo,
      porque: "a herança foi recusada (" + adm.porque + "), e `COCKPIT_DOSSIE_AUTO=sempre`"
        + " manda reescrever o dossiê inteiro mesmo assim" };
  }
  return nao("naoadmitido", "a escrita parcial não é admitida (" + adm.porque + "), e o rewrite"
    + " inteiro é gasto de outra ordem — no padrão eu não começo um sem clique");
}

/* Os vizinhos de um nó pela ARESTA, nunca pela ordem no array. `adjacencias` já
   guarda as duas direções com porta e ramo, e a terceira posição da tupla é o
   outro ponto da aresta nas duas — em `sai` é o destino, em `entra` é a origem.
   Uma travessia só, da mesma fonte que gera as impressões: um segundo mapa de
   vizinhança divergiria no primeiro conserto feito de um lado só, e o lado que
   divergisse decidiria qual parágrafo é suspeito. */
function vizinhosPorNo(wf) {
  const { entra, sai } = adjacencias(wf);
  const viz = new Map();
  const liga = (a, b) => {
    if (!viz.has(a)) viz.set(a, new Set());
    viz.get(a).add(b);
  };
  for (const m of [entra, sai]) {
    for (const [nome, lista] of m) {
      for (const s of lista) {
        let outro = null;
        try { outro = JSON.parse(s)[2]; } catch { /* tupla ilegível: ignora */ }
        if (outro == null) continue;
        liga(String(nome), String(outro));
        liga(String(outro), String(nome));
      }
    }
  }
  return viz;
}

/* O QUE REGENERAR, O QUE HERDAR, E O QUE MARCAR. Puro: recebe o dossiê já lido,
   o veredito de `estado` e o fluxo, e não toca em rede nem em disco.
   `regenerar` NUNCA é só `st.mudados`: entram também os parágrafos de geração
   esgotada e os que já carregavam a marca de um salto e a receberiam de novo.
   A `visão` é SEMPRE reescrita — ela é o mapa do fluxo, e `visaoSuspeita` sozinho
   com `mudados` vazio é uma escrita incremental legítima de uma seção só. */
function planoIncremental(dossie, st, wf) {
  const adm = admitirIncremental(dossie, st);
  if (!adm.ok) return { ok: false, porque: adm.porque };

  const descritos = new Map(dossie.paragrafos.map(p => [p.no, p]));
  const regenerar = new Set();
  const porque = new Map();
  const marcar = (nome, razao) => {
    if (regenerar.has(nome)) return false;
    regenerar.add(nome);
    porque.set(nome, razao);
    return true;
  };

  /* 1. divergiu por impressão — nó ou chave de conexão. É a lista que `estado`
        já devolve deduplicada por nome, e o caminho normal. */
  for (const n of st.mudados) if (descritos.has(n)) marcar(n, "a impressão digital divergiu");

  /* 2. geração esgotada. É o limite que a marca de um salto NÃO pega: um
        parágrafo que nunca ficou ao lado de nada enquanto o fluxo em volta se
        mexeu. Regenera rolando, em vez de o arquivo ser reescrito inteiro. */
  for (const p of dossie.paragrafos) {
    if (p.g >= MAX_GERACOES) marcar(p.no, "sobreviveu " + p.g + " geração(ões) sem ser refeito (teto " + MAX_GERACOES + ")");
  }

  /* 3. A MARCA DE UM SALTO NÃO EMPILHA. Um parágrafo que já estava marcado
        "vizinho de mudança" e seria marcado OUTRA VEZ é regenerado, porque
        remarcar é como uma ressalva vira mobília: na terceira escrita ninguém lê
        mais o `⚠`.
        É PONTO FIXO, não uma passada: promover um parágrafo para `regenerar` cria
        vizinhos novos, e alguns deles também já estão marcados. Uma passada só
        deixaria justamente esses remarcados, que é o que esta regra proíbe.
        Ele TERMINA porque cada volta promove pelo menos um parágrafo já marcado,
        e o conjunto de já-marcados é finito — o teto de voltas é a rede para o dia
        em que alguém mexer nisso, nunca a condição de parada.
        CONSEQUÊNCIA DECLARADA: em fluxo muito remarcado o conjunto pode crescer
        muito, e aí incremental deixa de ser barato. O plano DEVOLVE o tamanho em
        vez de decidir — quem mostra o preço é a tela. */
  const viz = vizinhosPorNo(wf);
  let umHop = new Set();
  for (let volta = 0; volta <= dossie.paragrafos.length; volta++) {
    umHop = new Set();
    for (const n of regenerar) {
      for (const v of (viz.get(n) || [])) if (descritos.has(v) && !regenerar.has(v)) umHop.add(v);
    }
    let cresceu = false;
    for (const v of umHop) {
      if (descritos.get(v).umHop && marcar(v, "já estava marcado como vizinho de mudança e seria marcado de novo")) cresceu = true;
    }
    if (!cresceu) break;
  }
  for (const n of regenerar) umHop.delete(n);

  const herdar = dossie.paragrafos.filter(p => !regenerar.has(p.no)).map(p => p.no);
  return {
    ok: true, porque: null,
    regenerar: [...regenerar], herdar, umHop: [...umHop],
    razoes: Object.fromEntries(porque),
    /* A visão vai SEMPRE, e é o piso do custo do reparo mais barato possível. */
    visao: true
  };
}

/* ═══════════════════════════════ O ARQUIVO ════════════════════════════════
 *
 * Um parágrafo por nó, cada um carregando a impressão digital do nó que
 * descreve e a PROCEDÊNCIA. A âncora é `JSON.stringify` de um objeto e não
 * campos separados por `·`: nome de nó pode conter qualquer coisa, e chave
 * composta concatenada à mão já falhou em silêncio duas vezes aqui.
 */

const ANCORA = /^<!-- NO (\{.*\}) -->$/m;
const ANCORA_G = /^<!-- NO (\{.*\}) -->$/gm;

/* `settingsFp` e `conexoesPorNo` são PARÂMETROS, como o `global` já era, e não
   derivados de `wf` aqui dentro — duas fontes para o mesmo fato divergem, e a que
   divergisse decidiria se um dossiê está em dia. O preço é que quem chama tem de
   passar, e este arquivo já pagou US$6,20 por essa exata forma de defeito
   (`construir` não passava a `visao`, `compor` sabia escrevê-la, e dois dossiês
   saíram sem ela). Por isso há caso estático em `dossie-test.js` provando que o
   `construir` passa os dois.

   `modo` entra pela mesma porta e pelo mesmo motivo: é o chamador que sabe se
   esta escrita re-derivou tudo ou herdou parágrafo, e `compor` não tem como
   descobrir isso sozinho — dois parágrafos com `de` antigo poderiam vir de um
   rewrite inteiro escrito por um código futuro. Ausente é `"inteiro"`, que é o
   que os dois dossiês no disco factualmente são. */
function compor({ wf, global, settingsFp, conexoesFp, conexoesPorNo, paragrafos, visao, escritoEm, modelo, modo }) {
  const L = [
    "# Dossiê — " + String(wf.name || wf.id),
    "",
    "> **Escrito por um modelo** (" + modelo + "), não medido. Descrição gerada não é fato:",
    "> a impressão digital abaixo prova que o nó não mudou, nunca que este texto estava certo.",
    "> **A partir da versão de " + (wf.updatedAt || "?") + "**, lida em " + escritoEm + ".",
    /* Os nós que EXECUTAM, não `nodes.length`: o Iago tem 189 entradas e 10 delas
       são sticky note, que não ganham parágrafo. Dizer 189 prometeria dez
       parágrafos que não existem. */
    "> Fluxo: " + executaveis(wf).length + " nós · impressão global `" + global + "`.",
  ];
  /* A TERCEIRA ETIQUETA OBRIGATÓRIA (§Step 3.1). As duas de cima dizem que a
     prosa é de um modelo e de qual versão do fluxo. Esta diz o que a impressão
     digital NÃO prova, e é perda real: ela prova que o nó e as arestas dele não
     mudaram — nunca que a frase sobre ele continua verdadeira depois que OUTRO nó
     mudou. O parágrafo do `Code_montar_payload` pode dizer "recebe o resumo do
     Redis" com hash e adjacência intactos enquanto o nó de Redis passou a
     devolver outra coisa. Rewrite inteiro re-deriva; incremental herda. Declarar é
     o mínimo que dá para fazer, e esconder seria a classe de mentira que este
     codebase recusa em todo lugar.
     ELA SÓ APARECE NO MODO INCREMENTAL: escrevê-la sempre, com "0 herdados" num
     rewrite inteiro, ensinaria a pular a linha — e é justamente a linha que tem
     de ser lida quando ela vale. */
  if (modo === "incremental") {
    const herdados = paragrafos.filter(p => p.de && p.de !== escritoEm);
    /* As datas SEM a hora: quem lê quer saber "de quando é esta parte", e um ISO
       inteiro por parágrafo viraria uma linha de 400 caracteres em 45 nós. `Set`
       porque uma escrita incremental herda vários parágrafos da mesma data. */
    const datas = [...new Set(herdados.map(p => String(p.de).slice(0, 10)))].sort();
    const quais = datas.length > 4 ? datas.slice(0, 4).join(", ") + " e mais " + (datas.length - 4) : datas.join(", ");
    L.push("> **Construído incrementalmente**: " + herdados.length + " de " + paragrafos.length
      + " parágrafo(s) foram HERDADOS de escrita anterior" + (quais ? " (" + quais + ")" : "")
      + " e não foram refeitos agora.");
    L.push("> A impressão digital prova que aquele nó e as arestas dele não mudaram — **nunca** que a");
    L.push("> prosa sobre ele continua verdadeira depois que outro nó mudou. Um rewrite inteiro re-deriva.");
  }
  L.push(
    "",
    /* `fp` FICA, e primeiro: é ele que um leitor antigo desta âncora encontra, e é
       ele que `estado()` compara quando os campos novos não existem. Os três
       campos novos entram AO LADO dele, nunca no lugar. `conexoesPorNo` sai como
       objeto simples porque é o que cabe em JSON — `Map` não sobrevive a
       `JSON.stringify`, e escrever `[]` de pares aqui custaria 2 caracteres por
       chave para nada. */
    "<!-- GLOBAL " + JSON.stringify({
      fp: global, wfId: String(wf.id || ""), em: escritoEm, gateV: GATE_V,
      settingsFp: settingsFp || null,
      /* O AGREGADO NORMALIZADO das conexões. Campo novo ao lado do `fp`, jamais no
         lugar dele: o `fp` cru continua sendo o que um cabeçalho legado tem e o que
         o teste fixa em `6126ecf1ce3d81f1`. Um hash de 16 hex, uma vez — o custo de
         cabeçalho aqui é o mapa por chave, não este. */
      conexoesFp: conexoesFp || null,
      conexoesPorNo: conexoesPorNo instanceof Map ? Object.fromEntries(conexoesPorNo) : (conexoesPorNo || null)
    }) + " -->",
    ""
  );
  /* A VISÃO GERAL ENTRA AQUI, e ela ficou de fora na primeira versão — o defeito
     mais caro desta feature: `validar()` extraía a visão, `construir` não a
     passava, e `compor` só escrevia os parágrafos por nó. Dois dossiês foram
     escritos sem a parte que o próprio prompt chama de "a que mais vale", que é o
     que diz quais são os TRECHOS do fluxo e em que ordem.
     Ela vai ANTES da primeira âncora de nó de propósito: `parse` corta o
     cabeçalho na primeira `<!-- NO`, e `paraPrompt` emite o cabeçalho inteiro —
     então é isto que faz a visão chegar ao prompt junto com o resto. */
  if (visao && visao.trim()) {
    L.push("## visão geral", "", visao.trim(), "");
  }
  for (const p of paragrafos) {
    /* `g` E `h` SÓ ENTRAM QUANDO VALEM ALGO, e a economia não é o motivo — a
       COMPATIBILIDADE é. Um parágrafo recém-escrito tem `g: 0` e nenhuma marca, e
       é exatamente a âncora de três campos que os dois dossiês no disco têm. Se
       gravasse `"g":0,"h":0` em todo parágrafo, um rewrite inteiro passaria a
       produzir um arquivo diferente do que produzia — 179 âncoras mudadas para
       registrar dois zeros.
         - `g` é o contador de gerações que o parágrafo sobreviveu intacto;
         - `h` é a marca de "era vizinho de uma mudança na escrita anterior", e ela
           existe para NÃO EMPILHAR: o `planoIncremental` a lê para regenerar em vez
           de marcar de novo. Uma ressalva remarcada para sempre é mobília. */
    const meta = { no: p.no, fp: p.fp, de: p.de };
    if (p.g) meta.g = p.g;
    if (p.umHop) meta.h = 1;
    L.push("<!-- NO " + JSON.stringify(meta) + " -->");
    L.push(p.texto.trim(), "");
  }
  return L.join("\n");
}

function parse(md) {
  const g = md.match(/^<!-- GLOBAL (\{.*\}) -->$/m);
  /* OS QUATRO CAMPOS, CADA UM COM DEFAULT `null`, e o default é o contrato: um
     cabeçalho escrito antes do split não tem os três novos, e `null` é o que faz
     `estado()` cair no ramo legado em vez de comparar contra `undefined` e achar
     que tudo divergiu. Ausente, presente-e-negativo e presente-e-positivo são três
     estados — a lição que este repositório já pagou cinco vezes — e aqui o preço
     de errar seria os dois dossiês que existem nascerem vermelhos no deploy.
     `conexoesPorNo` volta como OBJETO SIMPLES, não `Map`: é o que está no disco, e
     um `Map` no meio de um documento que outras camadas serializam viraria `{}` em
     silêncio. Quem compara é `estado()`, que sabe da assimetria. */
  let global = null, em = null, settingsFp = null, conexoesFp = null, conexoesPorNo = null, gateV = null;
  if (g) {
    try {
      const j = JSON.parse(g[1]);
      global = j.fp || null;
      em = j.em || null;
      settingsFp = j.settingsFp || null;
      conexoesFp = j.conexoesFp || null;
      conexoesPorNo = (j.conexoesPorNo && typeof j.conexoesPorNo === "object" && !Array.isArray(j.conexoesPorNo))
        ? j.conexoesPorNo : null;
      gateV = Number.isInteger(j.gateV) ? j.gateV : null;
    } catch { /* cabeçalho velho */ }
  }

  const paragrafos = [];
  const marcas = [...md.matchAll(ANCORA_G)];
  marcas.forEach((m, i) => {
    let meta;
    try { meta = JSON.parse(m[1]); } catch { return; }
    if (!meta || !meta.no) return;
    const de = m.index + m[0].length;
    const ate = i + 1 < marcas.length ? marcas[i + 1].index : md.length;
    /* `g` E `h` COM DEFAULT NEGATIVO, e aqui o default é o contrato de novo: uma
       âncora de três campos é um parágrafo de primeira geração, nunca um parágrafo
       de geração desconhecida. Ausente é `0`/`false` porque é o que ele
       factualmente é — foi escrito por um rewrite inteiro, que re-deriva tudo.
       `Number.isInteger` e não `Number(...)`: `"3"` de um cabeçalho editado à mão
       não pode virar geração, e `NaN >= MAX_GERACOES` seria `false`, ou seja um
       parágrafo herdando para sempre por causa de um campo malformado.
       `h` aceita `1` e `true` porque o disco pode ter os dois: `compor` grava `1`
       para economizar byte, e um dossiê escrito à mão diria `true`. */
    paragrafos.push({
      no: String(meta.no), fp: String(meta.fp || ""), de: String(meta.de || "dossie"),
      g: Number.isInteger(meta.g) && meta.g > 0 ? meta.g : 0,
      umHop: meta.h === 1 || meta.h === true,
      texto: md.slice(de, ate).trim()
    });
  });

  const corte = marcas.length ? marcas[0].index : md.length;
  return { global, settingsFp, conexoesFp, conexoesPorNo, gateV, em, cabecalho: md.slice(0, corte), paragrafos };
}

const caminho = wfId => path.join(DIR, String(wfId).replace(/[^A-Za-z0-9_-]/g, "_") + ".md");

async function ler(wfId) {
  try { return parse(await fsp.readFile(caminho(wfId), "utf8")); }
  catch { return null; }
}

/* ═══════════════════ O PORTÃO: NENHUM VALOR DE PARÂMETRO NO .md ═══════════
 *
 * O dossiê descreve o que cada trecho FAZ. O conteúdo dos parâmetros é outra
 * coisa, e neste instância ele carrega conversa de lead: `sessionKey` montada
 * com telefone, corpo de mensagem, id de planilha. O `.md` é gitignored, mas é
 * injetado em prompt e mostrado na tela — e a regra deste projeto é que valor de
 * parâmetro não atravessa de graça.
 *
 * Nome de nó PASSA, e é o ponto: "o `Code_montar_payload` recebe do buffer" é
 * exatamente a frase que o dossiê existe para ter. Nome de campo também passa —
 * é chave, não valor. O que não passa é o conteúdo.
 *
 * Duas varreduras, porque elas pegam coisas diferentes: valor que aparece
 * literal (o modelo copiou), e forma de dado pessoal em qualquer lugar (o modelo
 * parafraseou um telefone). A segunda existe porque a primeira só acha o que já
 * estava no JSON com pelo menos `MIN_VALOR` caracteres.
 */

/* CALIBRADO CONTRA O CORPUS REAL, e a primeira versão estava errada — ela
 * bloqueou os dois dossiês na primeira tentativa de verdade, gastando cota e
 * produzindo nada. O corte era "valor com 8+ caracteres aparece literal", e ele
 * recusou `telefone`, `entrou_em_contato`, `event_leads`, `botao_cta`,
 * `Mensagem`, `cancelado`, `esgotado`, `contacted`, `faturamento`, `outbound` e
 * `turno_atual`. Nenhum daqueles é dado de lead: são NOMES DE CAMPO e valores de
 * enum — e em n8n o nome da coluna É valor de parâmetro (`resourceMapper`,
 * `assignmentCollection`, `fixedCollection`). Tamanho não separa `telefone`
 * (campo, 8 caracteres) de um telefone de verdade.
 *
 * Mesma lição que o portão de esquema deste repo pagou de 14,4% a 0%: achado
 * correto pela regra e inconsequente é ruído — e aqui era ruído que bloqueava.
 *
 * MEDIDO nos dois fluxos: 365 e 221 valores. Identificador puro (sem espaço):
 * 126 e 84 — vocabulário, incluindo UUID. Com espaço: 187 e 104, e a
 * distribuição por tamanho é o que decide o número:
 *
 *   0–15 chars:   2 e 0   →  "Cupons Lotes", "PREÇO FINAL" (nome de aba e de
 *                            coluna; citar isso no dossiê é inofensivo)
 *   15+ chars:  185 e 104  →  expressão `={{ … }}` e código de `Code` node
 *
 * Então CONTEÚDO é: tem espaço em branco e 15+ caracteres, ou carrega `{{`
 * (expressão sem espaço fecharia o buraco por fora do corte). É onde vivem corpo
 * de mensagem, prompt de sistema e código — o que o dossiê tem de DESCREVER em
 * vez de colar. Identificador passa inteiro, e a varredura de PII é a rede que
 * pega telefone sem formatação, e-mail, JWT e id opaco em qualquer forma. */
const MIN_CONTEUDO = 15;
const MIN_EXPRESSAO = 8;
const ehConteudo = s =>
  (/\s/.test(s) && s.length >= MIN_CONTEUDO) ||
  (s.includes("{{") && s.length >= MIN_EXPRESSAO);

/* As âncoras `<!-- … -->` são escritas por CÓDIGO, não pelo modelo, e carregam
   impressão digital em hexadecimal. Varrê-las é o portão julgando a própria
   saída — e foi o que aconteceu: `32fe4d7777030213` contém `7777030213`, dez
   dígitos que a regra de telefone casava. O portão existe para conferir o que o
   MODELO escreveu. */
const semAncoras = md => String(md).replace(/^<!--[\s\S]*?-->$/gm, "");

const PII = [
  /* As bordas `\b` são o que impede um hash de virar telefone: dentro de
     `32fe4d7777030213` o `7` vem depois de `d`, que é caractere de palavra, então
     não há início de palavra ali. Sem elas a regra casa QUALQUER corrida de 10
     dígitos — hash, timestamp, id numérico — e o portão reprova o dossiê por
     causa do cabeçalho que ele mesmo gerou. */
  [/(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[-\s]?\d{4}\b/, "telefone"],
  [/[\w.+-]+@[\w-]+\.[\w.]{2,}/, "e-mail"],
  [/eyJ[A-Za-z0-9_-]{10,}/, "token JWT"],
  [/\b[A-Za-z0-9_-]{32,}\b/, "chave ou token longo"]
];

function valoresDoFluxo(raw) {
  const nomes = new Set((raw.nodes || []).map(n => String(n.name)));
  const vals = new Set();
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
    if (typeof v !== "string") return;
    const s = v.trim();
    /* Um valor que É o nome de um nó não conta: expressões carregam nome de nó
       (`$('Buffer')`), e o dossiê tem direito de citar o nó. */
    if (nomes.has(s)) return;
    if (ehConteudo(s)) vals.add(s);
  };
  /* Sticky note fica FORA desta varredura: é documentação que o Kauan escreveu à
     mão, e é de lá que saem os nomes dos trechos (`LOCK + CANCELAR VÁCUO`) — o
     dossiê citar o nome do trecho é o melhor que ele pode fazer, não um
     vazamento. A varredura de PII continua valendo em cima do `.md` inteiro, que
     é o que cobre um telefone que alguém tenha digitado num post-it. */
  for (const no of executaveis(raw)) walk(no.parameters);
  return vals;
}

function vazou(md, raw) {
  const prosa = semAncoras(md);
  const achados = [];
  for (const v of valoresDoFluxo(raw)) {
    if (prosa.includes(v)) achados.push({ tipo: "valor de parâmetro", trecho: v.slice(0, 60) });
    if (achados.length >= 6) break;
  }
  for (const [re, nome] of PII) {
    const m = prosa.match(re);
    if (m) achados.push({ tipo: nome, trecho: String(m[0]).slice(0, 40) });
  }
  return achados;
}

/* ─────────── UMA RECUSA, LIMPA, ANTES DE SAIR DAQUI ────────────────────────
 *
 * UMA definição, TRÊS consumidores, e é por isso que ela existe como função em vez
 * de um `replace` escrito no lugar onde calhava: o ledger `dossies.json` (rastreado
 * em git), a telinha de progresso, e a linha de desfecho da escrita automática. Uma
 * segunda cópia divergiria no primeiro conserto feito de um lado só, e o lado que
 * divergisse seria o que publica.
 *
 * O QUE ELA TIRA É O TRECHO. `vazou()` logo acima devolve `{tipo, trecho}` e o
 * `trecho` é o valor de parâmetro que apareceu na prosa — na prática um telefone do
 * lead, uma chave de sessão montada a partir dele, um pedaço da conversa de um
 * cliente. A recusa cita esse valor DE PROPÓSITO, porque ela volta literal para o
 * modelo e é assim que ele sabe qual frase apagar. Isso vale dentro do diretório da
 * sessão, que é scratch. Não vale em nenhum dos três destinos acima: dois são
 * permanentes e um é uma tela que pode estar sendo gravada.
 *
 * SOBRA O QUE DECIDE ALGUMA COISA: qual portão recusou e de que tipo era o achado.
 * "vazou um valor de parâmetro (…)" manda consertar a prosa; "vazou um valor de
 * parâmetro (+55 41 99999-1395)" manda a mesma coisa e leva o telefone junto.
 *
 * O CORTE EM 120 NÃO É A PROTEÇÃO, é higiene de tela — quem protege é o `replace`.
 * Escrito assim para que ninguém leia o `slice` como se fosse o portão e o afrouxe
 * achando que está mexendo em layout. */
function recusaLimpa(r) {
  return String(r).replace(/\("[^"]*"\)/g, "(…)").slice(0, 120);
}

/* ═════════════════════════════════ A SESSÃO ════════════════════════════════
 *
 * §2.3: sessão AVULSA (`rodarAvulso` de `tester.js`: sem conversa, sem SSE),
 * a partir do workflow REDIGIDO, com `--disallowedTools` e
 * `--setting-sources ""` — sem os dois, a sessão executa shell e carrega o
 * `CLAUDE.md` global, que nesta máquina tem a chave da API do n8n em texto puro.
 * As duas medições estão no `CLAUDE.md` do projeto; não afrouxe nenhuma.
 *
 * Ela NÃO é a sessão da conversa. Se a conversa escrevesse o dossiê, escreveria
 * com a conversa toda no contexto — contaminação — e ainda faria você esperar:
 * escrever 15KB de `report.md` levou 127s medidos neste repositório.
 */

const REGRAS = `# O que você está escrevendo

Um DOSSIÊ de um fluxo n8n: prosa curta que explica o que cada nó faz e como os
trechos se encaixam. Ele existe para que uma sessão futura entenda o fluxo SEM
reler o JSON inteiro — ler o \`Agente Iago Comercial\` custa ~81k tokens.

## Arquivos nesta pasta

- \`fluxo.json\` — o fluxo, com as credenciais já removidas. É a fonte.
- \`nodes-index.md\` — nome · tipo · saídas de cada nó, gerado por código.

## O que escrever

Um arquivo \`dossie.md\`, e nada mais. Formato exato, uma seção por nó:

\`\`\`
## visão geral
<2 a 6 linhas: para que serve o fluxo, o que o dispara, o que ele produz, e
quais são os TRECHOS — buffer, lock, memória, envio. É a parte mais útil.>

## no: <nome exato do nó>
<1 a 4 linhas: o que este nó faz, de quem recebe, para quem manda, e o que ele
decide quando decide algo. Se ele existe por causa de uma armadilha (um lock,
um retry, um fallback), diga isso — é o que ninguém deduz do JSON.>
\`\`\`

Regras do formato:
- \`## no: \` seguido do nome EXATO, copiado do \`nodes-index.md\`. Um nome
  inventado ou alterado invalida o parágrafo.
- Um parágrafo por nó, TODOS os nós, na ordem em que aparecem no índice.
- Sticky notes (\`stickyNote\`) NÃO entram: não executam nada.
- Português. Sem título extra, sem conclusão, sem markdown além do \`##\`.

## A regra que reprova o trabalho

**NUNCA copie o CONTEÚDO de um parâmetro.** Nome de nó pode. Nome de campo pode
("lê \`mensagem_atual\`"). O VALOR não: nem trecho de mensagem, nem telefone,
nem e-mail, nem id de planilha, nem canal, nem token, nem expressão literal.

Diga o que o parâmetro FAZ, não o que está escrito nele:
- certo: "monta a chave de sessão a partir do telefone normalizado"
- errado: "monta \`=memoria:{{ $json.telefone }}\`"

Isto é verificado por código depois de você escrever. Um valor literal no
\`dossie.md\` reprova a rodada inteira.

## Ferramentas

Você tem \`Read\`, \`Write\`, \`Glob\` e \`Grep\`. Sem Bash, sem rede. Não precisa
ler o \`fluxo.json\` inteiro de uma vez — o índice diz onde procurar, e o
\`Grep\` acha o nó pelo nome.
`;

/* O BLOCO QUE ANULA A REGRA "TODOS OS NÓS", e ele é APENDADO ao `REGRAS` em vez
   de substituí-lo: o formato, a ordem e — principalmente — a regra que reprova
   por vazamento são as mesmas, e reescrever aquele texto num segundo lugar é o
   defeito de duas cópias divergirem no primeiro conserto feito de um lado só.
   Anular explicitamente é mais honesto que editar: quem lê vê que existe uma
   regra geral e qual rodada a suspende.
   A LISTA DE NÓS VAI NO ARQUIVO, NUNCA NO PROMPT. O prompt viaja em `-p` e a
   linha de comando do Windows acaba em 32767 caracteres; 45 nomes de nó (o teto
   do laranja no Iago) são ~2KB que não precisam estar lá, e este repositório já
   matou uma etapa com `spawn ENAMETOOLONG`, que não nomeia nem o prompt nem o
   tamanho. */
function regrasParciais(alvos, temDossie) {
  const L = [
    "",
    "# ESTA RODADA É PARCIAL — e isto SUBSTITUI a regra \"todos os nós\" acima",
    "",
    "O dossiê deste fluxo JÁ EXISTE" + (temDossie ? " e está nesta pasta como `DOSSIE.md`" : "") + ".",
    "Quase todos os parágrafos continuam valendo e vão ser reaproveitados como estão.",
    "O que mudou no fluxo desde que ele foi escrito é só a lista abaixo.",
    "",
    "Escreva `dossie.md` com **a `## visão geral` e SÓ estas " + alvos.length + " seções**:",
    ""
  ];
  for (const n of alvos) L.push("- `" + n + "`");
  L.push(
    "",
    "Regras desta rodada:",
    "- a `## visão geral` é OBRIGATÓRIA e é reescrita inteira: ela é o mapa do fluxo",
    "  (quais trechos existem e em que ordem), e é a parte que uma mudança de conexão",
    "  invalida primeiro. Reescreva-a olhando o fluxo de hoje, não copiando a antiga.",
    "- não escreva seção de nó que não está na lista. Não é proibido, é desperdício:",
    "  o parágrafo antigo daquele nó já vai ser reaproveitado.",
    "- **não copie o parágrafo antigo** dos nós da lista. Eles estão na lista porque o",
    "  nó mudou; descreva o que ele faz AGORA, lendo o `fluxo.json`.",
    (temDossie
      ? "- leia o `DOSSIE.md` para pegar o TOM e não contradizer o que fica: os parágrafos"
        + " novos vão morar no mesmo arquivo que os antigos."
      : "- não há dossiê antigo nesta pasta para consultar; escreva no mesmo formato."),
    ""
  );
  return L.join("\n");
}

/* O prompt da rodada parcial. Curto de propósito: quem carrega o que tem tamanho
   é o `REGRAS.md`, que a sessão lê com `Read`. */
function promptIncremental(wf, alvos, recusas) {
  const L = [
    "O dossiê do fluxo `" + String(wf.name || wf.id) + "` já existe e está DESATUALIZADO em "
      + alvos.length + " nó(s).",
    "",
    "Leia `REGRAS.md` primeiro, INTEIRO: a última seção dele diz que esta rodada é PARCIAL",
    "e lista exatamente quais seções escrever. Ela vale mais que a regra \"todos os nós\".",
    "",
    "Use `Grep` no `fluxo.json` para olhar de perto só os nós daquela lista, e o",
    "`nodes-index.md` para o mapa. Escreva `dossie.md` nesta pasta.",
    "",
    "A `## visão geral` é obrigatória e vai reescrita: é o mapa do fluxo, e é o que",
    "uma mudança de conexão invalida primeiro."
  ];
  if (recusas && recusas.length) {
    L.push("", "A rodada anterior foi RECUSADA por código. Motivos, literais:", "");
    for (const r of recusas) L.push("- " + r);
    L.push("", "Corrija e escreva `dossie.md` de novo. O formato e a regra não mudaram.");
  }
  return L.join("\n");
}

function prompt(wf, nos, recusas) {
  const L = [
    "Escreva o dossiê do fluxo `" + String(wf.name || wf.id) + "` (" + nos + " nós que executam).",
    "",
    "Leia `REGRAS.md` primeiro: ele diz o formato exato e a regra que reprova a rodada.",
    "Comece pelo `nodes-index.md` para ter o mapa, e use `Grep` no `fluxo.json` para os nós",
    "que você precisar olhar de perto. Escreva `dossie.md` nesta pasta.",
    "",
    "A parte que mais vale é a `## visão geral`: quais são os TRECHOS do fluxo e em que ordem.",
    "É isso que substitui a leitura do documento inteiro."
  ];
  if (recusas && recusas.length) {
    L.push("", "A rodada anterior foi RECUSADA por código. Motivos, literais:", "");
    for (const r of recusas) L.push("- " + r);
    L.push("", "Corrija e escreva `dossie.md` de novo. O formato e a regra não mudaram.");
  }
  return L.join("\n");
}

/* ═════════════ O CABEÇALHO DE UMA SEÇÃO DE NÓ, EM UM LUGAR SÓ ═════════════
 *
 * `validar()` lê o mesmo `.md` DUAS vezes: primeiro captura todas as seções para
 * conferir os nomes, depois reencontra cada uma pelo nome para recortar o
 * parágrafo. Os dois padrões precisam tolerar exatamente a mesma variação de
 * espaço — e enquanto eram dois literais separados, eles divergiram.
 *
 * O defeito medido: `## no:  Nome`, com dois espaços. A captura vinha
 * `.trim()`ada, então o nome batia com o do fluxo e a contagem de `faltando`
 * dizia que o parágrafo estava lá; a re-varredura exigia UM espaço, não achava,
 * e `m.index` estourava. Dois lugares que têm de casar e não compartilham fonte
 * divergem no primeiro ajuste feito de um lado só — daí a constante única.
 *
 * `[ \t]*` e não `\s*`: `\s` casa `\n`, e o cabeçalho tem de caber numa linha,
 * senão `## no:` numa linha com o nome na seguinte viraria seção válida. */
const CAB_NO = "^## no:[ \\t]*";
const RE_SECOES = new RegExp(CAB_NO + "(.+)$", "gm");
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* No fim, `\s*$` e não `[ \t]*$`: espaço à direita a captura já descarta no
   `.trim()`, então tolerar mais aqui não abre divergência nenhuma — fecha. */
const reSecao = nome => new RegExp(CAB_NO + escRe(nome) + "\\s*$", "m");

/* `somente` É A RODADA PARCIAL, e ele muda UMA coisa: quais nós são EXIGIDOS.
   O resto do portão fica byte a byte igual — nome inventado, parágrafo duplicado,
   e o portão de vazamento continuam valendo, porque nada neles depende de a
   rodada ser inteira.
   O QUE ELE NÃO FAZ: recusar seção de nó fora da lista. Um parágrafo que o modelo
   escreveu por conta é prosa recém-derivada, que é ESTRITAMENTE melhor que a
   herdada — recusá-la gastaria uma rodada para jogar fora trabalho bom. Ele entra,
   e entra CONTADO: `nosRegenerados` no ledger é o número real, não o pedido, senão
   `preco()` mediria uma coisa e cobraria outra.
   O piso de tamanho cai junto: "vazio ou quase" com 200 caracteres é a medida de
   um dossiê inteiro, e uma rodada parcial de um nó é legitimamente curta. */
function validar(md, raw, imp, { somente } = {}) {
  const erros = [];
  const piso = somente ? 120 : 200;
  if (!md || md.trim().length < piso) erros.push("`dossie.md` está vazio ou quase — esperava a visão geral e "
    + (somente ? "os parágrafos pedidos" : "um parágrafo por nó"));

  const secoes = [...md.matchAll(RE_SECOES)].map(m => m[1].trim());
  if (!/^## visão geral\s*$/m.test(md)) erros.push("falta a seção `## visão geral`, que é a parte mais útil do dossiê");

  const validos = new Set(executaveis(raw).map(n => String(n.name)));
  const vistos = new Set();
  for (const s of secoes) {
    if (!validos.has(s)) erros.push('a seção `## no: ' + s.slice(0, 60) + '` não é um nó deste fluxo — os nomes exatos estão em `nodes-index.md`');
    else if (vistos.has(s)) erros.push('o nó `' + s + '` tem dois parágrafos — um por nó');
    else vistos.add(s);
    if (erros.length > 12) break;
  }
  /* O QUE FOI EXIGIDO. Na rodada inteira, todo nó que executa; na parcial, só os
     pedidos — e a interseção com `validos` é de propósito: um nome na lista que
     não é mais nó do fluxo é bug NOSSO, e cobrar do modelo um parágrafo de um nó
     que não existe queimaria as duas rodadas com uma recusa impossível de
     atender. `planoIncremental` só monta a lista a partir de parágrafos de nós que
     existem, então isto é rede, não caminho. */
  const exigidos = somente ? [...validos].filter(n => somente.has(n)) : [...validos];
  const faltando = exigidos.filter(n => !vistos.has(n));
  if (faltando.length) {
    erros.push(faltando.length + " nó(s) sem parágrafo, começando por `" + faltando.slice(0, 4).join("`, `") + "`");
  }

  /* O portão que reprova por conteúdo. Vem por último porque é o mais caro de
     ler e o mais grave de todos: o resto é forma, este é vazamento. */
  for (const v of vazou(md, raw)) {
    erros.push("VAZOU " + v.tipo + ' no texto ("' + v.trecho + '") — descreva o que o parâmetro faz, nunca o que está escrito nele');
  }

  if (erros.length) return { ok: false, erros };

  const paragrafos = [];
  /* NA RODADA PARCIAL, RECORTA SÓ O QUE TEM SEÇÃO. Na inteira, `vistos` já é
     igual a `validos` neste ponto (senão `faltando` teria reprovado), então o
     filtro não muda nada e a ordem continua a do fluxo — que é o que faz o `.md`
     sair na mesma ordem do `nodes-index.md`. */
  for (const no of executaveis(raw)) {
    const nome = String(no.name);
    if (somente && !vistos.has(nome)) continue;
    const m = md.match(reSecao(nome));
    /* RECUSA NOMEADA, NUNCA EXCEÇÃO. Com o `CAB_NO` compartilhado isto ficou
       raro — sobra o espaço em branco exótico que `.trim()` remove e `[ \t]` não
       casa, um NBSP colado depois dos dois-pontos — mas raro não é nunca. E a
       diferença entre as duas saídas é o preço de uma rodada: a recusa volta
       literal para o modelo, que corrige na rodada seguinte; a exceção sobe por
       `construir`, mata a rodada inteira já paga, sem mensagem de retry e sem
       linha no ledger. */
    if (!m) return { ok: false, erros: ["a seção do nó `" + nome + "` foi contada mas não foi reencontrada no texto — escreva o cabeçalho como `## no: " + nome + "`, sozinho na linha, com um espaço simples depois dos dois-pontos"] };
    const inicio = m.index + m[0].length;
    const resto = md.slice(inicio);
    const prox = resto.search(/^## /m);
    paragrafos.push({ no: nome, fp: imp.porNo.get(nome), de: "dossie",
      texto: (prox >= 0 ? resto.slice(0, prox) : resto).trim() });
  }
  const visao = (md.match(/^## visão geral\s*$([\s\S]*?)(?=^## )/m) || [])[1] || "";
  return { ok: true, paragrafos, visao: visao.trim() };
}

/* ═══════════════════════════════ O LEDGER ══════════════════════════════════
 *
 * §7.1.2: o custo do dossiê NÃO entra em `proposals.json`. Um dossiê não é
 * proposta: não tem portão de aprovação, não tem diff, não tem decisão de
 * aplicar, não há nada para reidratar — e no store das propostas ele disputaria
 * o cap com o histórico real e poluiria `rehydrate()`.
 *
 * `dossies.json` é rastreado em git, minúsculo, append-only. É o ÚNICO lugar
 * onde o gasto recorrente desta aba existe: o `.md` é gitignored, então guardar
 * o custo lá dentro o perderia na primeira limpeza de cache.
 */

async function lerLedger() {
  try {
    const j = JSON.parse(await fsp.readFile(LEDGER, "utf8"));
    return Array.isArray(j.dossies) ? j.dossies : [];
  } catch { return []; }
}

/* ═══════════════ TRÊS TRAVAS, E A ORDEM ENTRE ELAS É OBRIGATÓRIA ══════════
 *
 * §Step 2b. TRÊS DESTAS CORRIDAS EXISTEM HOJE, antes deste plano, e nenhuma
 * delas jamais foi disparada — foram achadas por revisão, não por uso.
 *
 * A ordem é o que garante não haver ciclo, e ela é de fora para dentro:
 *
 *   1. `comTravaFluxo(wfId)` — a sessão inteira do dossiê (pasta de trabalho +
 *      publish). NÃO é o `comEscrita` do `n8n.js`: aquela fila serializa escrita
 *      de DOCUMENTO n8n e o teto dela é 45s (`COCKPIT_ESCRITA_TIMEOUT_MS`),
 *      enquanto uma escrita de dossiê leva 11 MINUTOS medidos. Segurá-la pela
 *      sessão inteira transformaria todo approve concorrente num 409 — uma
 *      feature de economia que começa quebrando a aba ao lado.
 *   2. `comEscrita` — SÓ a janela curta `relê updatedAt → aborta ou rename`.
 *      Milissegundos numa fila de teto 45s. O motivo de recusar a fila para a
 *      sessão é o motivo de usá-la no publish: sem ela sobra a janela
 *      `releu ok → um apply entra → o rename publica o velho`.
 *   3. `travaLedger` — SÓ dentro do `anotar()`. `dossies.json` é um arquivo
 *      ÚNICO escrito `lê → empilha → grava tmp → rename`, então dois fluxos
 *      DIFERENTES com travas de fluxo DIFERENTES ainda perdem a linha um do
 *      outro. Trava por fluxo não serializa arquivo global. Esta corrida existe
 *      hoje.
 *
 * Nada aqui espera por nada de fora: a trava de fluxo RECUSA em vez de enfileirar
 * (ver abaixo), então nenhuma delas pode estar bloqueada esperando a outra. */

/* A TRAVA DE FLUXO RECUSA, NÃO ESPERA, e isto é decisão, não atalho: a fila
   levaria 11 minutos medidos para andar, e "espera onze minutos calado" é pior
   que "já estou escrevendo o dossiê deste fluxo" — que é a frase que a tela já
   tem. Recusar também é o que a torna trivialmente livre de deadlock: ninguém
   fica pendurado nela, então ela nunca participa de um ciclo.
   Por `wfId`, não global: escrever o dossiê de dois fluxos ao mesmo tempo é
   legítimo, e o que não pode é duas escritas do MESMO fluxo — que hoje apagam a
   pasta de trabalho uma da outra no meio da sessão e correm no mesmo `.md.tmp`. */
const travasFluxo = new Map();

/* A CHAVE É O NOME SANEADO, o mesmo que o `caminho()` usa, e não o `wfId` cru:
   a trava existe para proteger o `.md` e a pasta, e as duas são nomeadas pelo
   saneado. Dois ids diferentes que colapsassem no mesmo arquivo receberiam duas
   travas diferentes e correriam no mesmo `.md` — que é exatamente a corrida que
   esta trava existe para fechar. */
const chaveTrava = wfId => seguro(wfId);

function donoDoDossie(wfId) {
  const t = travasFluxo.get(chaveTrava(wfId));
  return t ? { desde: t.desde, oque: t.oque } : null;
}

async function comTravaFluxo(wfId, oque, fn) {
  const k = chaveTrava(wfId);
  const preso = travasFluxo.get(k);
  if (preso) {
    throw Object.assign(
      new Error("já estou escrevendo o dossiê deste fluxo desde " + preso.desde + " (" + preso.oque + ")"),
      { status: 409 });
  }
  travasFluxo.set(k, { desde: new Date().toISOString(), oque: String(oque || "escrevendo o dossiê") });
  /* O `finally` é o que impede uma sessão que jogou de travar o fluxo até o
     processo reiniciar — a mesma razão do `finally` da fila do `n8n.js`. */
  try { return await fn(); }
  finally { travasFluxo.delete(k); }
}

/* A trava GLOBAL do ledger, e ela é uma corrente de promessas em vez de um
   "ocupado?" porque aqui recusar seria perder a linha: o ledger é o único lugar
   onde o gasto desta aba existe, e uma tentativa que custou dinheiro e não foi
   anotada é exatamente o "gasto que ninguém vê" que §2.3.1 nomeia como o risco
   da aba. Escrita de arquivo pequeno, então a fila anda em milissegundos. */
let travaLedger = Promise.resolve();

function comTravaLedger(fn) {
  const vez = travaLedger.then(fn, fn);
  /* A corrente NUNCA carrega a rejeição adiante: sem este `catch` o primeiro erro
     de disco faria toda anotação seguinte rejeitar em cadeia, e o ledger pararia
     de registrar em silêncio. Quem chamou recebe o erro por `vez`. */
  travaLedger = vez.then(() => {}, () => {});
  return vez;
}

async function anotar(linha) {
  return comTravaLedger(async () => {
    const lista = await lerLedger();
    lista.push(linha);
    const tmp = LEDGER + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), dossies: lista }, null, 2), "utf8");
    await fsp.rename(tmp, LEDGER);
  });
}

/* `modo` AUSENTE É `"inteiro"`, e não é default preguiçoso: as três linhas que
   existem em `dossies.json` são factualmente rewrite inteiro — verificado —, e
   esta é a mesma disciplina do `kindOf(p) = p.kind || "fix"` no ledger das
   propostas. Ausente nunca cai no ramo novo. */
const modoDe = d => (d && d.modo === "incremental") ? "incremental" : "inteiro";

/* QUEM MANDOU ESCREVER — clique ou o automático de depois de aplicar. Mesma
   disciplina do `modoDe` acima e do `kindOf` no ledger das propostas: AUSENTE É
   CLICADO, porque as três linhas que existem em `dossies.json` são factualmente de
   clique, e ausente nunca cai no ramo novo.
 *
 * POR QUE ESTE CAMPO EXISTE: `dossies.json` é o ÚNICO lugar onde o gasto recorrente
 * desta aba existe — o `.md` é gitignored, então guardar o custo dentro dele o
 * perderia na primeira limpeza de cache — e ele não regenera de API nenhuma. Sem
 * distinguir clique de automático, "quanto o automático está me custando por
 * semana" não tem resposta, e essa é a pergunta que um gasto que dispara sozinho
 * cria. Com a §2.8 flexibilizada, a linha do `CLAUDE.md` que pede este arquivo
 * rastreado em git vale mais, não menos.
 *
 * `preco()` NÃO filtra por isto de propósito: automático e clicado fazem O MESMO
 * TRABALHO — a régua é o `modo`, que é o que muda o tamanho da escrita. Filtrar
 * também por origem dividiria a amostra em duas por um fato que não afeta o custo,
 * e este arquivo já demorou a ter duas medições de um modo só. */
const autoDe = d => !!(d && d.automatico === true);

/* O preço vem do histórico desta máquina, nunca de chute. Sem histórico ele diz
   que não sabe — mesma disciplina de `estimate()` no caminho de correção, que
   devolve `samples: 0` em vez de inventar um ETA na primeira execução.
 *
 * FILTRA POR `modo`, E ISSO É OBRIGATÓRIO (§Step 2.6). Misturar o usd-por-nó de
 * um rewrite inteiro com o de uma escrita parcial dá número errado NAS DUAS
 * direções — e esse número é o único preço que o botão mostra. Medido: o rewrite
 * inteiro do Iago foi US$4,14 para 179 nós; uma parcial de 3 parágrafos não tem
 * nada a ver com essa taxa.
 *
 * E A RÉGUA DE CADA MODO É DIFERENTE, o que é a metade que quase passou batido:
 *   - inteiro: a taxa é usd por nó do FLUXO, porque ele reescreve todos;
 *   - incremental: usd por PARÁGRAFO REGENERADO, porque quantos ele reescreve
 *     muda a cada vez. Dividir uma parcial pelo total de nós do fluxo produziria
 *     uma "taxa" que só descreve aquela tentativa e mente na seguinte.
 * Então `nos` quer dizer coisas diferentes por modo, e a assinatura diz qual:
 * no inteiro é o tamanho do fluxo, no incremental é quantos parágrafos vão ser
 * refeitos (`planoIncremental().regenerar.length`, mais a visão). */
async function preco(nos, modo = "inteiro") {
  /* Só o que PRODUZIU dossiê serve de régua: uma tentativa reprovada custou
     dinheiro sem escrever nada, e incluí-la inflaria o preço estimado com um
     gasto que não se repete quando o portão está calibrado. */
  const base = d => modo === "incremental" ? d.nosRegenerados : d.nos;
  const medidos = (await lerLedger())
    .filter(d => d.ok !== false && d.usd > 0 && modoDe(d) === modo && base(d) > 0);
  if (medidos.length < 2) return { usd: null, amostras: medidos.length, modo };
  const porNo = medidos.map(d => d.usd / base(d)).sort((a, b) => a - b);
  const mediana = porNo[Math.floor(porNo.length / 2)];
  return { usd: mediana * nos, amostras: medidos.length, modo };
}

/* A RÉGUA DE TEMPO, irmã do `preco()` e pelo mesmo motivo que o `estimate()` do
 * caminho de correção existe: uma barra de progresso precisa de um DENOMINADOR, e
 * o único honesto é o histórico desta máquina. Mediana e não média — uma tentativa
 * que morreu no teto puxaria a média para longe do caso típico e a barra passaria a
 * mentir o tempo todo, para o lado errado.
 *
 * FILTRA POR `modo`, E ISSO É OBRIGATÓRIO, pela mesma razão que o `preco()` filtra:
 * a régua do incremental e a do inteiro são réguas DIFERENTES. O rewrite inteiro do
 * Iago levou 682s para 179 nós; uma parcial de três parágrafos não tem nada a ver
 * com esse relógio. Dividir uma escrita parcial pela régua da inteira já foi o
 * defeito consertado uma vez neste arquivo — a oferta do recibo cobrando a
 * reescrita inteira ao lado da promessa de conserto parcial. Não repetir com o
 * relógio o que já custou caro com o preço.
 *
 * HOJE `amostras` DO `incremental` É ZERO: nenhuma escrita parcial foi medida nesta
 * máquina. Então a régua dele NÃO EXISTE, e quem consome tem de dizer "não sei" —
 * nunca zero (que leria como instantâneo numa escrita de minutos) e nunca o tempo
 * da inteira com a palavra "parcial" ao lado, que é o defeito de novo.
 *
 * O QUE ELE DELIBERADAMENTE NÃO COPIA DO `preco()`: o `ok !== false`. Lá a exclusão
 * é mecânica — uma tentativa reprovada regenerou zero parágrafos, então ela não tem
 * denominador, e o `base(d) > 0` já a tira. Aqui ela TEM: uma escrita que morreu no
 * teto gastou aquele relógio de verdade (medido: 520s numa das duas primeiras
 * tentativas do eContrate), e a barra mede uma escrita cujo desfecho ninguém conhece
 * enquanto ela corre. Uma régua que só conhece sucesso acaba cedo exatamente na
 * rodada que está indo mal, que é quando alguém está olhando para ela. É a mesma
 * escolha do `estimate()`, que também não filtra corrida que falhou. */
const DUR_MAX_MS = 2 * 60 * 60 * 1000;

async function duracao(modo = "inteiro") {
  const ms = (await lerLedger())
    .filter(d => modoDe(d) === modo)
    .map(d => Number(d.ms))
    /* Linha sem `ms`, com relógio zerado ou com um número absurdo sai fora: numa
       amostra de três, uma delas sozinha move a mediana. Mesma disciplina do
       `estimate()`, que descarta a duração que não é número finito antes de ordenar. */
    .filter(v => Number.isFinite(v) && v > 0 && v <= DUR_MAX_MS)
    .sort((a, b) => a - b);
  /* Menos de duas medições não é régua, é anedota — mesmo corte do `preco()`. E o
     `amostras` viaja junto para quem consome poder dizer POR QUE não sabe. */
  if (ms.length < 2) return { medianaMs: null, amostras: ms.length, modo };
  return { medianaMs: ms[Math.floor(ms.length / 2)], amostras: ms.length, modo };
}

/* ═════════════════════════════════ CONSTRUIR ══════════════════════════════ */

const seguro = s => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

/* UM ID POR TENTATIVA, e ele carrega três funções ao mesmo tempo: nomeia a pasta
   de trabalho, nomeia o `.md.tmp` e é o `ref` do dono da fila de escrita — que
   exige `[A-Za-z0-9_-]{1,64}`. O prefixo `d` existe para não haver como colidir
   com o `r…` de uma run de correção nem com o id de uma sessão de upgrade: dois
   donos com o mesmo id REENTRAM um no outro, e reentrância entre atores
   diferentes é a pior linha que dá para escrever perto daquela fila. */
const idTentativa = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* QUANTO TEMPO UMA PASTA DE TRABALHO PODE ESTAR EM USO, e o número não é solto:
   é o teto de uma rodada vezes o número de rodadas, mais folga. Uma pasta mais
   velha que isso NÃO PODE pertencer a uma sessão viva, porque a sessão morre no
   próprio teto. Derivar do teto em vez de cravar um número é o que faz o dia em
   que alguém dobrar `TETO_MS` não virar uma poda que apaga pasta em uso. */
const VIDA_PASTA_MS = TETO_MS * MAX_RODADAS + 300000;

/* A PASTA É POR TENTATIVA, NÃO POR FLUXO (§Step 2b.2). Antes ela vinha só do
   `wfId` e a entrada fazia `fsp.rm(dir, {recursive:true})` — então uma segunda
   escrita do mesmo fluxo APAGAVA a pasta da primeira NO MEIO da sessão, e as duas
   corriam no mesmo `.md.tmp`. Essa corrida existe hoje.
   O `rm -rf` só é seguro se ninguém mais pode estar dentro, e é isso que o nome
   por tentativa compra.
   A PODA É POR IDADE, e não "apaga todas as outras deste fluxo". A trava de fluxo
   já garante que não há outra tentativa viva do mesmo fluxo — mas apagar as irmãs
   colapsaria duas camadas independentes em uma, e duas camadas é a disciplina
   deste repositório (`nomeSeguro` mais `dentro()`). O preço da idade é bom: a
   pasta da tentativa anterior sobrevive para ser lida depois de uma falha, que é
   exatamente quando alguém quer olhar. Pasta de OUTRO fluxo nunca é tocada, em
   nenhuma hipótese. */
async function pastaDaTentativa(wfId, tentativa) {
  const pref = seguro(wfId);
  const eu = pref + "__" + tentativa;
  await fsp.mkdir(RUNS, { recursive: true });
  const corte = Date.now() - VIDA_PASTA_MS;
  try {
    for (const e of await fsp.readdir(RUNS)) {
      if (e === eu) continue;
      if (e !== pref && !e.startsWith(pref + "__")) continue;
      /* `e === pref` é a pasta do formato ANTIGO, sem tentativa no nome: ela não
         pertence a sessão nenhuma deste código, então sai sem consultar a idade. */
      if (e !== pref) {
        let st = null;
        try { st = await fsp.stat(path.join(RUNS, e)); } catch { continue; }
        if (st.mtimeMs > corte) continue;
      }
      await fsp.rm(path.join(RUNS, e), { recursive: true, force: true });
    }
  } catch { /* pasta nova: nada a limpar */ }
  const dir = path.join(RUNS, eu);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/* O PUBLISH VAI DENTRO DO `comEscrita` (§Step 2b.4), e a rodada 2 da revisão
 * corrigiu a colocação: "relê `updatedAt` antes do rename" deixa a janela
 * `releu ok → um apply entra → o rename publica o velho`. Aqui a releitura e o
 * rename dividem UMA região crítica com quem escreve o documento no n8n — a mesma
 * disciplina do `escreverAprovado`, que existe justamente porque revalidar e
 * gravar em regiões diferentes não garante nada.
 *
 * ELA É CURTA, E É POR ISSO QUE ESTA FILA SERVE AQUI. O teto dela é 45s
 * (`COCKPIT_ESCRITA_TIMEOUT_MS`) e o que roda dentro é um GET e um rename —
 * milissegundos. A SESSÃO, de 11 minutos medidos, fica FORA: segurá-la dentro
 * transformaria todo approve concorrente num 409. O motivo de recusar a fila para
 * a escrita é o motivo de usá-la no publish.
 *
 * O `kind` do dono é `"upgrade"` DE PROPÓSITO, e não um quarto kind: o dossiê é
 * a §2 do `PLAN-UPGRADE.md`, e `WRITE_KINDS` é conferido por `dono-test.js` como
 * exatamente três. Inventar um kind para segurar a vez — sem escrever documento
 * nenhum no n8n — custaria mexer no `n8n.js`, que é fronteira de segurança, para
 * comprar um rótulo. `ref` é a tentativa, então dois publishes de dossiês
 * diferentes contendem em vez de reentrar.
 *
 * ABORTAR É LINHA NO LEDGER, nunca silêncio: a rodada custou dinheiro. E a
 * ausência de `updatedAt` em qualquer um dos dois lados ABORTA — "não deu para
 * conferir" não é "não mudou", que é a regra que este repositório escreveu cinco
 * vezes. */
async function publicar({ wfId, nome, raw, final, tentativa, diz, passo, rodada }) {
  const alvo = caminho(wfId);
  const tmp = alvo + "." + tentativa + ".tmp";
  /* A ETAPA É EMITIDA ANTES DE PEDIR A VEZ NA FILA, e a colocação é a decisão:
     esperar a fila É publicar, e o teto dessa espera é 45s
     (`COCKPIT_ESCRITA_TIMEOUT_MS`). Emitir só depois do `rename` deixaria a tela
     dizendo "conferindo" durante quase um minuto de espera — a barra parada bem no
     fim, que é exatamente onde uma barra parada lê como travada.
     `passo` é opcional porque `publicar` é exportada e chamada direto nos testes;
     ela já vem embrulhada em try/catch de quem a construiu. */
  if (passo) passo("publicando", { rodada, rodadas: MAX_RODADAS });
  const owner = n8n.writeOwner("upgrade", tentativa, "publicando o dossiê de " + String(nome || wfId));
  return n8n.comEscrita(owner, async () => {
    const agora = await n8n.getRawWorkflow(wfId);
    const antes = String((raw && raw.updatedAt) || "");
    const depois = String((agora && agora.updatedAt) || "");
    if (!antes || !depois) {
      return { ok: false, porque: "não deu para conferir se o fluxo mudou durante a escrita (o n8n não devolveu `updatedAt`) — publicar sem conferir seria publicar prosa que pode já ter nascido velha" };
    }
    if (antes !== depois) {
      return { ok: false, porque: "o fluxo mudou no n8n durante a escrita (era `" + antes + "`, agora é `" + depois + "`) — este dossiê descreve uma versão que já não existe" };
    }
    await fsp.mkdir(DIR, { recursive: true });
    await fsp.writeFile(tmp, final, "utf8");
    await fsp.rename(tmp, alvo);
    diz("publicado: " + path.basename(alvo) + " (" + (final.length / 1024).toFixed(1) + "KB)");
    return { ok: true, caminho: alvo };
  });
}

/* ──────────── AS QUATRO ETAPAS DE UMA ESCRITA, EM LISTA FECHADA ───────────
 *
 * O `aoDizer` já contava o que está acontecendo, em TEXTO LIVRE — e texto livre não
 * dá para desenhar: ninguém consegue dizer, de "rodada 2 de 2 — sonnet", se aquilo
 * é metade ou é o fim. `aoEtapa` é o MESMO relato em forma estruturada, e ele NÃO
 * substitui o `diz`: as duas coisas servem a perguntas diferentes — uma é a linha
 * de atividade (o que está acontecendo agora), a outra é a POSIÇÃO (onde isto está
 * dentro do trabalho inteiro). Nenhum texto de `diz()` mudou por causa disto.
 *
 * A LISTA É FECHADA E EXPORTADA de propósito: `i` de `total` só significa alguma
 * coisa se as duas pontas concordarem sobre quantas etapas existem, e uma etapa
 * inventada aqui viraria uma barra passando de 100% do outro lado. Quem desenha lê
 * `ETAPAS.length`, nunca um 4 cravado na página.
 *
 * FATO, NUNCA VEREDITO: daqui não sai porcentagem, nem cor, nem frase de tela. `i`
 * de `total` é o que se mediu; o que isso vale numa barra é juízo da página — a
 * mesma divisão que o resto deste arquivo mantém.
 *
 * A SEQUÊNCIA NÃO É MONOTÔNICA, e quem desenha precisa saber disto: uma rodada
 * reprovada no portão volta de `conferindo` para `escrevendo`, então `i` ANDA PARA
 * TRÁS. É fato, não defeito — o que avançou foi o `rodada`, que viaja junto
 * justamente para a tela poder dizer "2 de 2" em vez de fingir progresso. */
const ETAPAS = ["preparando", "escrevendo", "conferindo", "publicando"];

/* A TRAVA DE FLUXO ENVOLVE A SESSÃO INTEIRA — pasta de trabalho e publish
   (§Step 2b.1). `construir` é a casca que a segura; `umaEscrita` é o trabalho. */
/* `automatico` é um CARIMBO, nunca um comportamento: nada abaixo desta linha muda
   por causa dele. Ele existe para a linha do ledger poder dizer quem mandou (ver
   `autoDe`), e a frase da trava o diz porque `donoDoDossie` é o que a tela mostra
   quando uma segunda escrita é recusada — "já tem uma escrita rodando" sem dizer
   que ela começou sozinha é a metade que confunde. */
async function construir(wfId, { aoDizer, aoEtapa, incremental = false, automatico = false } = {}) {
  const tentativa = idTentativa();
  return comTravaFluxo(wfId, "escrevendo o dossiê" + (incremental ? " (incremental)" : "")
    + (automatico ? " · automático" : "") + " · " + tentativa,
    () => umaEscrita(wfId, { aoDizer, aoEtapa, incremental, automatico, tentativa }));
}

async function umaEscrita(wfId, { aoDizer, aoEtapa, incremental, automatico, tentativa }) {
  const diz = t => { if (aoDizer) try { aoDizer(t); } catch { /* segue */ } };

  /* Embrulhado igual ao `diz`, e pelo mesmo motivo: quem escuta é a tela, e uma
     tela que joga não pode derrubar uma escrita de onze minutos que já gastou cota.
     O `i` sai DAQUI, da posição dentro de `ETAPAS`, nunca de um número escrito à mão
     no ponto de emissão: duas definições da mesma posição divergem no primeiro
     conserto feito num lado só, e a que divergisse desenharia a barra errada.
     A FORMA É SEMPRE A MESMA — `rodada` e `rodadas` viajam `null` nas etapas que não
     têm rodada, em vez de sumirem do objeto. Campo ausente e campo nulo levam a
     leituras diferentes do outro lado, e este repositório já pagou seis vezes por
     deixar um ausente cair no ramo errado. */
  const passo = (nome, extra) => {
    if (!aoEtapa) return;
    try { aoEtapa({ etapa: nome, i: ETAPAS.indexOf(nome) + 1, total: ETAPAS.length, rodada: null, rodadas: null, ...(extra || {}) }); }
    catch { /* segue */ }
  };

  /* `preparando` cobre tudo até a pasta ficar de pé: ler o fluxo, decidir a
     admissão do incremental e montar o diretório. Nada disto gasta modelo, e é
     justamente por isso que precisa aparecer — são segundos de tela parada antes da
     primeira linha de atividade da sessão. */
  passo("preparando");

  /* `getRawWorkflow` é o buraco deliberado da whitelist e é process-local:
     nenhuma rota serve a saída dele. O que vai para a pasta da sessão é o
     REDIGIDO. */
  const raw = await n8n.getRawWorkflow(wfId);
  const nos = executaveis(raw);
  if (!nos.length) return { ok: false, erro: "esse fluxo não tem nó que executa" };

  const imp = impressoes(raw);

  /* ── A ADMISSÃO DO INCREMENTAL, ANTES DE QUALQUER GASTO ──
     A recusa aqui é de GRAÇA (código local, sem modelo), então ela cai para
     rewrite inteiro sem custo nenhum — e é o único lugar onde essa queda é
     honesta. Depois de a sessão rodar, cair para inteiro dobraria o gasto sem
     clique, que é exatamente o que §2.8 recusa. */
  let plano = null, docAntigo = null;
  if (incremental) {
    docAntigo = await ler(wfId);
    const st = estado(docAntigo, raw);
    const p = planoIncremental(docAntigo, st, raw);
    if (!p.ok) {
      diz("incremental não é possível: " + p.porque + " — vai de rewrite inteiro");
      docAntigo = null;
    } else if (!p.regenerar.length && !p.visao) {
      diz("nada divergiu — não há o que reescrever");
      return { ok: false, erro: "o dossiê está em dia; não há parágrafo para refazer" };
    } else {
      plano = p;
      diz("incremental: " + p.regenerar.length + " parágrafo(s) para refazer, "
        + p.herdar.length + " herdado(s), " + p.umHop.length + " marcado(s) como vizinho de mudança"
        + " — mais a `## visão geral`, que vai sempre");
    }
  }
  const modo = plano ? "incremental" : "inteiro";

  const dir = await pastaDaTentativa(wfId, tentativa);
  const redigido = fix.redactWorkflow(fix.sanitizedWorkflow(raw));
  await fsp.writeFile(path.join(dir, "fluxo.json"), JSON.stringify(redigido, null, 2), "utf8");
  await fsp.writeFile(path.join(dir, "nodes-index.md"), fix.nodesIndex(redigido), "utf8");
  /* O DOSSIÊ ANTIGO VAI PARA A PASTA no modo parcial, e não é conveniência: os
     parágrafos novos vão morar no mesmo arquivo que os antigos, e sem o tom e o
     vocabulário do que fica a sessão escreve prosa que contradiz o vizinho. É
     prosa de modelo, já aprovada pelo portão — não carrega credencial nem valor. */
  if (plano) await fsp.writeFile(path.join(dir, "DOSSIE.md"), await fsp.readFile(caminho(wfId), "utf8"), "utf8");
  await fsp.writeFile(path.join(dir, "REGRAS.md"),
    plano ? REGRAS + regrasParciais(plano.regenerar, true) : REGRAS, "utf8");
  diz("pasta pronta: " + nos.length + " nós, " + (JSON.stringify(redigido).length / 1024).toFixed(0) + "KB de fluxo redigido"
    + (plano ? " · rodada PARCIAL" : ""));

  const exigidos = plano ? new Set(plano.regenerar) : null;
  const umHop = new Set(plano ? plano.umHop : []);

  let recusas = null;
  const custos = [];
  for (let rodada = 1; rodada <= MAX_RODADAS; rodada++) {
    passo("escrevendo", { rodada, rodadas: MAX_RODADAS });
    diz("rodada " + rodada + " de " + MAX_RODADAS + " — " + MODELO);
    const r = await tester.rodarAvulso({
      prompt: plano ? promptIncremental(raw, plano.regenerar, recusas) : prompt(raw, nos.length, recusas),
      ferramentas: "Read,Write,Glob,Grep",
      cwd: dir, modelo: MODELO, comRede: false, tetoMs: TETO_MS, aoDizer
    });
    custos.push({ usd: r.usd, ms: r.ms, usdDesconhecido: !!r.usdDesconhecido });

    if (r.erro && r.usdDesconhecido) diz("a sessão morreu antes do relatório de custo — a rodada entra como NÃO MEDIDA, nunca como zero");
    if (r.erro) { recusas = ["a sessão terminou com erro: " + r.erro]; if (rodada === MAX_RODADAS) break; continue; }

    let md = "";
    try { md = await fsp.readFile(path.join(dir, "dossie.md"), "utf8"); }
    catch { recusas = ["`dossie.md` não foi criado nesta pasta"]; continue; }

    /* PORTÃO 1 DE 2: a validação ESTRUTURAL, no formato de rodada (`## no:`), e
       sobre O TEXTO NOVO SÓ. `validar` não fala o formato do arquivo final com
       âncoras — apontá-lo para o documento composto não é afrouxar o portão, é
       usá-lo num idioma que ele não lê. Inalterado; o que muda é `somente`. */
    /* `conferindo` cobre OS DOIS PORTÕES — o `validar` sobre o texto novo e o
       `vazou` sobre o documento composto. Eles são código local, de graça e rápidos,
       mas a etapa existe assim mesmo: uma rodada reprovada volta para `escrevendo`,
       e sem esta emissão a tela mostraria a barra parada em "escrevendo" durante a
       rodada 1 inteira e a rodada 2 inteira, sem nunca dizer que houve um portão. */
    passo("conferindo", { rodada, rodadas: MAX_RODADAS });
    const v = validar(md, raw, imp, exigidos ? { somente: exigidos } : {});
    if (!v.ok) {
      diz("recusado por código: " + v.erros.length + " motivo(s) — " + v.erros[0].slice(0, 120));
      recusas = v.erros;
      continue;
    }

    const escritoEm = new Date().toISOString();
    const monte = montarParagrafos({ v, docAntigo, nos, umHop, escritoEm });
    if (!monte.ok) {
      /* Inalcançável sob a regra de admissão (`entraram`/`sairam` é vermelho), e
         tratado exatamente por isso — o mesmo motivo do ramo `cxSemDono`. Não é
         recusa para o modelo: ele não tem como consertar um parágrafo que falta no
         dossiê antigo. Aborta com nome. */
      diz("abortei: " + monte.porque);
      recusas = [monte.porque];
      break;
    }

    /* Os três campos novos do cabeçalho viajam DAQUI, da mesma `imp` que gerou as
       impressões por nó — nunca recalculados dentro do `compor`, que veria o mesmo
       `raw` mas abriria uma segunda fonte para o mesmo fato. Sem esta linha todo
       dossiê novo nasceria com cabeçalho legado, e o split não existiria na
       prática: é a repetição exata do defeito da `visao`, que custou US$6,20. */
    const final = compor({ wf: raw, global: imp.global, settingsFp: imp.settingsFp, conexoesFp: imp.conexoesFp, conexoesPorNo: imp.conexoesPorNo, paragrafos: monte.paragrafos, visao: v.visao, escritoEm, modelo: MODELO, modo });

    /* PORTÃO 2 DE 2: o SCRUB, sobre o DOCUMENTO COMPOSTO INTEIRO. Ele existe
       porque um parágrafo herdado pode casar um valor que ENTROU no fluxo depois
       de ele ser escrito — o texto era limpo quando passou e deixou de ser sem
       ninguém tocar nele. É código local, de graça.
       ELE NÃO VOLTA PARA O MODELO, e isso é a diferença que importa: o texto novo
       já passou pelo `vazou` dentro do `validar`, então um achado aqui vem de
       parágrafo HERDADO (ou do cabeçalho, que é gerado por código). Mandar o
       modelo "corrigir" um parágrafo que ele não escreveu queimaria a rodada
       seguinte por nada. O caminho é o rewrite inteiro, e a frase diz isso. */
    const fuga = vazou(final, raw);
    if (fuga.length) {
      const porque = "o documento composto vazou " + fuga.length + " achado(s) (" + fuga[0].tipo
        + ") que não estão no texto desta rodada — vieram de parágrafo herdado, e o modelo não tem como"
        + " consertar o que não escreveu. Refaça o dossiê inteiro deste fluxo.";
      diz("abortei: " + porque);
      recusas = [porque];
      break;
    }

    const pub = await publicar({ wfId, nome: raw.name, raw, final, tentativa, diz, passo, rodada });
    if (!pub.ok) { recusas = [pub.porque]; diz("abortei: " + pub.porque); break; }

    const medido = custos.filter(c => !c.usdDesconhecido);
    const linha = {
      wfId: String(wfId), nome: String(raw.name || ""), em: escritoEm,
      /* `nosRegenerados` FINALMENTE DIFERE DE `nos`. Ele existia em toda linha do
         ledger e nunca tinha divergido (103/103, 179/179) — era a admissão do
         próprio plano de que isto sempre foi para ser incremental. É o número
         REAL de parágrafos refeitos, nunca o pedido: `preco("incremental")` divide
         por ele, e medir uma coisa e cobrar outra é o defeito que a filtragem por
         `modo` veio consertar. */
      nos: nos.length, nosRegenerados: monte.regenerados, nosHerdados: monte.herdados,
      modo, automatico: !!automatico, rodadas: rodada,
      ms: custos.reduce((a, c) => a + (c.ms || 0), 0),
      bytes: final.length
    };
    if (medido.length === custos.length) linha.usd = Number(custos.reduce((a, c) => a + c.usd, 0).toFixed(4));
    else { linha.usd = Number(medido.reduce((a, c) => a + c.usd, 0).toFixed(4)); linha.usdDesconhecido = true; }
    await anotar(linha);

    return { ok: true, caminho: pub.caminho, bytes: final.length, ...linha };
  }

  /* A TENTATIVA QUE FALHA TAMBÉM ENTRA NO LEDGER, e isto é correção de um defeito
     medido: as duas primeiras tentativas reais reprovaram no portão, gastaram
     cota e `dossies.json` nem existia — exatamente o "gasto que ninguém vê" que
     §2.3.1 nomeia como o risco desta aba. Uma tentativa reprovada custou o mesmo
     que uma que passou; o que ela não produziu foi o `.md`.
     O ABORTO DO PUBLISH CAI AQUI PELO MESMO CAMINHO (§Step 2b.5): o fluxo mudou
     no meio, o `.md` não foi publicado, e a rodada custou dinheiro. */
  const medido = custos.filter(c => !c.usdDesconhecido);
  await anotar({
    wfId: String(wfId), nome: String(raw.name || ""), em: new Date().toISOString(),
    nos: nos.length, nosRegenerados: 0, modo, automatico: !!automatico, rodadas: custos.length,
    ms: custos.reduce((a, c) => a + (c.ms || 0), 0),
    usd: Number(medido.reduce((a, c) => a + c.usd, 0).toFixed(4)),
    ...(medido.length === custos.length ? {} : { usdDesconhecido: true }),
    ok: false,
    /* O motivo entra LIMPO, pelo `recusaLimpa` — ver a definição dele. Aqui o
       destino é `dossies.json`, que é rastreado em git; nas outras duas chamadas
       o destino é a tela. Os três precisam da MESMA limpeza, e por isso ela
       deixou de ser um `replace` escrito aqui dentro. */
    porque: (recusas || []).map(recusaLimpa).slice(0, 6)
  });
  return { ok: false, erro: "não passou nas checagens em " + MAX_RODADAS + " rodadas", recusas, custos, modo };
}

/* A HERANÇA, EM UM LUGAR SÓ E PURA. Ela é o coração do Step 2 e não fala com
   disco nem com rede, então cada regra dela é provável sem gastar nada.
     - parágrafo NOVO leva `de` = o carimbo desta escrita, `g` 0, sem marca;
     - parágrafo HERDADO vai VERBATIM: o texto, o `fp` e o `de` dele. O `fp` não é
       recalculado de propósito, mesmo sendo igual — recalcular abriria uma segunda
       fonte para o fato "este parágrafo descreve esta versão do nó";
     - `g` do herdado sobe UM: é o contador de gerações que ele sobreviveu intacto;
     - a marca de um salto é gravada só em quem o plano marcou.
   A ORDEM É A DO FLUXO, não a do dossiê antigo: é ela que faz o `.md` sair na
   mesma sequência do `nodes-index.md`, que é como qualquer um vai ler os dois.
   `de` DE PARÁGRAFO LEGADO é resolvido aqui, e é o único lugar onde dá: no disco
   ele vale o literal `"dossie"` (o slot existia e ninguém o preenchia), e a data
   verdadeira daquele texto é o `em` do cabeçalho — os dois fatos só estão na mão
   ao mesmo tempo neste ponto. Sem isso o rótulo do Step 3 diria "herdado de
   dossie" onde tem de dizer uma data. */
function montarParagrafos({ v, docAntigo, nos, umHop, escritoEm }) {
  const novos = new Map(v.paragrafos.map(p => [p.no, p]));
  if (!docAntigo) {
    return { ok: true, regenerados: v.paragrafos.length, herdados: 0,
      paragrafos: v.paragrafos.map(p => ({ ...p, de: escritoEm, g: 0, umHop: false })) };
  }
  const antigos = new Map(docAntigo.paragrafos.map(p => [p.no, p]));
  const dataAntiga = p => (p.de && p.de !== "dossie") ? p.de : String(docAntigo.em || "?");
  const paragrafos = [];
  let regenerados = 0, herdados = 0;
  for (const n of nos) {
    const nome = String(n.name);
    const novo = novos.get(nome);
    if (novo) {
      regenerados++;
      paragrafos.push({ no: nome, fp: novo.fp, texto: novo.texto, de: escritoEm, g: 0, umHop: false });
      continue;
    }
    const velho = antigos.get(nome);
    if (!velho) {
      return { ok: false, porque: "o nó `" + nome + "` não tem parágrafo novo nem parágrafo no dossiê antigo — a herança ficaria com um buraco, e um dossiê com nó sem parágrafo é pior que um dossiê velho" };
    }
    herdados++;
    paragrafos.push({
      no: nome, fp: velho.fp, texto: velho.texto,
      de: dataAntiga(velho), g: (velho.g || 0) + 1, umHop: umHop.has(nome)
    });
  }
  return { ok: true, paragrafos, regenerados, herdados };
}

/* ═══════════════════════════════════ CLI ══════════════════════════════════ */

async function acharFluxo(alvo) {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(alvo)) {
    try { const w = await n8n.getRawWorkflow(alvo); if (w && w.id) return { id: String(w.id), name: w.name }; }
    catch { /* não era id */ }
  }
  const todos = await n8n.listWorkflows();
  const alvoBaixo = alvo.toLowerCase();
  const achados = (todos || []).filter(w => String(w.name || "").toLowerCase().includes(alvoBaixo));
  if (!achados.length) return null;
  if (achados.length > 1) return { ambiguo: achados.map(w => ({ id: String(w.id), name: w.name })) };
  return { id: String(achados[0].id), name: achados[0].name };
}

async function cli() {
  const arg = process.argv.slice(2);
  const cmd = arg[0];

  if (cmd === "--construir" && arg[1]) {
    /* `--incremental` é PEDIDO, nunca automático: se o dossiê não for verde ou
       laranja, ou não tiver o selo do portão, `construir` cai para rewrite inteiro
       e DIZ por quê — a recusa é local e de graça, então cair ali não custa nada.
       Nada aqui regenera sozinho (§2.8): a flag é o clique. */
    const incremental = arg.includes("--incremental");
    const achado = await acharFluxo(arg.slice(1).filter(x => !x.startsWith("--")).join(" "));
    if (!achado) { console.log("não achei fluxo com esse id nem com esse nome"); process.exit(1); }
    if (achado.ambiguo) {
      console.log("mais de um fluxo bate com isso — passe o id:");
      for (const a of achado.ambiguo) console.log("  " + a.id + "  " + a.name);
      process.exit(1);
    }
    console.log("\n[ dossiê ] " + achado.name + "  (" + achado.id + ")\n");
    const r = await construir(achado.id, { incremental, aoDizer: t => console.log("  " + t) });
    if (!r.ok) {
      console.log("\nnão passou: " + r.erro);
      for (const m of r.recusas || []) console.log("  · " + m);
      process.exit(1);
    }
    console.log("\nescrito: " + path.relative(__dirname, r.caminho) + "  [" + r.modo + "]");
    if (r.modo === "incremental") {
      console.log("  " + r.nosHerdados + " parágrafo(s) HERDADOS sem serem refeitos — a impressão digital");
      console.log("  prova que aqueles nós não mudaram, nunca que a prosa sobre eles segue verdadeira.");
    }
    console.log("  " + r.nosRegenerados + " nós · " + (r.bytes / 1024).toFixed(1) + "KB · "
      + Math.round(r.ms / 1000) + "s · " + (r.usdDesconhecido ? "US$" + r.usd + " + rodada não medida" : "US$" + r.usd)
      + " · " + r.rodadas + " rodada(s)");
    return;
  }

  if (cmd === "--estado") {
    const lista = await lerLedger();
    if (!lista.length) { console.log("nenhum dossiê escrito ainda"); return; }
    console.log("");
    /* `US$0` numa linha de tentativa morta lê como GRÁTIS, e não é: a sessão
       gastou cota e morreu antes do `result`, que é onde o custo vem. Este
       repositório já pagou essa lição no `usd: 0` da rodada morta — a linha diz
       "não medido", e o total declara quantas tentativas ficaram fora dele. */
    const dinheiro = d => d.usdDesconhecido ? (d.usd ? "US$" + d.usd + " + não medido" : "não medido") : "US$" + d.usd;
    for (const d of lista) {
      let cor;
      if (d.ok === false) cor = "reprovado";
      else {
        try { cor = estado(await ler(d.wfId), await n8n.getRawWorkflow(d.wfId)).cor; }
        catch { cor = "sem releitura"; }
      }
      /* `modo` na linha porque as duas escritas não são comparáveis: US$4,14 por
         179 nós e US$X por 3 parágrafos lidos na mesma coluna dariam a impressão
         de que o dossiê ficou barato. `modoDe` resolve o campo ausente para
         `inteiro`, que é o que as três linhas antigas factualmente são. */
      const md9 = modoDe(d) === "incremental" ? "parcial" : "inteiro";
      /* QUEM MANDOU, na mesma linha: com a §2.8 flexibilizada, uma linha do ledger
         que nao diz se foi clique ou automatico deixa "quanto o automatico esta me
         custando" sem resposta — e um gasto que dispara sozinho e justamente o que
         precisa dessa resposta. `autoDe` resolve o campo AUSENTE para CLIQUE, que e
         o que as tres linhas antigas factualmente sao. */
      const quem = autoDe(d) ? "auto  " : "clique";
      console.log("  " + cor.padEnd(13) + md9.padEnd(9) + quem.padEnd(8) + d.nome + "  (" + d.wfId + ")  "
        + d.nos + " nós, " + (d.nosRegenerados || 0) + " refeito(s) · "
        + dinheiro(d) + " · " + Math.round((d.ms || 0) / 1000) + "s · " + d.em.slice(0, 16).replace("T", " "));
      /* A tentativa reprovada não produziu `.md`, e o motivo é o que decide se
         vale tentar de novo ou consertar algo antes. */
      for (const p of (d.porque || []).slice(0, 3)) console.log("                 · " + p);
    }
    const medidas = lista.filter(d => !d.usdDesconhecido);
    const cegas = lista.length - medidas.length;
    const total = medidas.reduce((a, d) => a + (d.usd || 0), 0);
    const produziram = lista.filter(d => d.ok !== false).length;
    console.log("\n  " + lista.length + " tentativa(s), " + produziram + " com dossiê no fim"
      + "\n  gasto medido: US$" + total.toFixed(2)
      + (cegas ? "  ·  " + cegas + " tentativa(s) NÃO medida(s), que custaram e não entram nessa soma" : ""));
    /* A CONTA DO AUTOMATICO, SEPARADA — e a pergunta que a §2.8 flexibilizada cria,
       e ela so tem resposta porque a linha carrega `automatico`. Zero tentativas
       automaticas e dito com essas palavras em vez de omitido: uma linha ausente
       leria como "nao sei", e aqui eu sei. E o MODO vem do processo (`AUTO`), nunca
       de um constante da tela: Node nao recarrega arquivo, e o valor que manda e o
       de quem esta respondendo. */
    const autos = medidas.filter(autoDe);
    const gastoAuto = autos.reduce((acc, x) => acc + (x.usd || 0), 0);
    console.log("  do automatico depois de aplicar: " + autos.length + " tentativa(s) medida(s)"
      + (autos.length ? ", US$" + gastoAuto.toFixed(2) : " — nenhuma ate agora")
      + "  ·  modo agora: `COCKPIT_DOSSIE_AUTO=" + AUTO.modo + "`"
      + (AUTO.reconhecido ? "" : " (o valor `" + AUTO.bruto + "` nao e reconhecido e foi ignorado)"));
    return;
  }

  if (cmd === "--ver" && arg[1]) {
    const achado = await acharFluxo(arg.slice(1).join(" "));
    if (!achado || achado.ambiguo) { console.log("passe o id"); process.exit(1); }
    const doc = await ler(achado.id);
    if (!doc) { console.log("sem dossiê para " + achado.name); return; }
    const st = estado(doc, await n8n.getRawWorkflow(achado.id));
    console.log("\n" + st.cor.toUpperCase() + " — " + st.motivo);
    if (st.mudados.length) console.log("mudaram: " + st.mudados.join(", "));
    if (st.entraram.length) console.log("entraram: " + st.entraram.join(", "));
    if (st.sairam.length) console.log("saíram: " + st.sairam.join(", "));

    /* A VISÃO GERAL É O QUE UMA PESSOA LÊ; os parágrafos por nó existem para a
       sessão consultar. Com 179 nós, despejar tudo é uma parede de 56KB — a mesma
       lição que o `report.md` do Tester já pagou, onde a forma nó-por-nó em 65 nós
       "era uma parede que ninguém lê" e virou agrupada por camada. `--tudo` e
       `--no <nome>` continuam existindo porque auditar um parágrafo tem de ser
       possível. */
    console.log("\n" + doc.cabecalho.trim());
    if (arg.includes("--tudo")) {
      for (const p of doc.paragrafos) console.log("\n## `" + p.no + "`\n" + p.texto);
    } else {
      console.log("\n  " + doc.paragrafos.length + " parágrafos por nó, "
        + (JSON.stringify(doc.paragrafos).length / 1024).toFixed(0) + "KB — para a sessão consultar,");
      console.log("  não para ler de uma vez. `--tudo` imprime todos, `--no <nome>` imprime um.");
    }
    const qual = arg.indexOf("--no");
    if (qual >= 0 && arg[qual + 1]) {
      const alvoNo = arg.slice(qual + 1).filter(x => !x.startsWith("--")).join(" ");
      const p = doc.paragrafos.find(x => x.no === alvoNo)
        || doc.paragrafos.find(x => x.no.toLowerCase().includes(alvoNo.toLowerCase()));
      console.log(p ? "\n## `" + p.no + "`\n" + p.texto : "\nnão achei nó com esse nome no dossiê");
    }
    return;
  }

  console.log(`
dossie.js — o dossiê do fluxo (PLAN-UPGRADE.md §2)

  node dossie.js --construir <id | pedaço do nome>   escreve o dossiê (custa cota do plano)
  node dossie.js --construir <id> --incremental      refaz só os parágrafos que divergiram
                                                     (só de dossiê verde ou laranja; cai para
                                                      inteiro e diz por quê, de graça)
  node dossie.js --estado                            o que existe, e a cor de cada um
  node dossie.js --ver <id | nome>                   estado + visão geral (o que uma pessoa lê)
  node dossie.js --ver <id> --tudo                   todos os parágrafos por nó
  node dossie.js --ver <id> --no <nome do nó>        um parágrafo só

Nada NESTE CLI regenera sozinho, e nada aqui escreve no n8n. O que regenera sozinho
e a aba Upgrade depois de APLICAR um patch — decisao explicita do Kauan, que
flexibiliza o §2.8 do PLAN-UPGRADE. A variavel COCKPIT_DOSSIE_AUTO manda nisso:

  off           desligado
  incremental   PADRAO — tenta a parcial; heranca recusada NAO gasta
  sempre        parcial quando der, rewrite inteiro quando a heranca for recusada
`);
}

module.exports = {
  impressoes, adjacencias, canon, semRuido, estado, paraPrompt,
  compor, parse, ler, caminho, valoresDoFluxo, vazou, validar, executaveis,
  construir, lerLedger, preco, REGRAS, prompt,
  /* `ETAPAS` sai porque é CONTRATO entre os dois lados: quem desenha a barra lê o
     tamanho daqui em vez de cravar um 4 na página, e uma etapa acrescentada aqui
     chega lá sozinha. `duracao` sai porque é a régua do denominador dessa barra, e
     ela é PURA no sentido que importa — só lê o ledger, não fala com rede nem com
     n8n, então o número é conferível sem servidor de pé. */
  ETAPAS, duracao, recusaLimpa, LIMITE_LARANJA, MIN_CONTEUDO, ehConteudo, MODELO, DIR,
  GATE_V, FP_CX_HEX, conexoesNormalizadas,
  /* O incremental (§Step 2). As duas primeiras são PURAS e é por isso que estão
     aqui: o veredito de admissão e o conjunto a regenerar têm de ser prováveis sem
     rede, mesmo motivo de `resolverAlvo` e `custoDaRodada`. `montarParagrafos` sai
     porque a herança é a regra que mais precisa de caso em cima dela. */
  admitirIncremental, planoIncremental, montarParagrafos, vizinhosPorNo,
  regrasParciais, promptIncremental, marcaDoParagrafo, modoDe,
  MAX_GERACOES, CORES_HERDAVEIS,
  /* O automático de depois de aplicar (§2.8 flexibilizada por decisão do Kauan).
     As duas primeiras são PURAS e saem por isso: o veredito de gastar dinheiro
     sozinho tem de ser provável sem rede e sem servidor de pé. `AUTO` sai para a
     rota poder dizer na tela em que modo o cockpit que ESTÁ RESPONDENDO subiu — um
     valor lido do processo, nunca do arquivo servido. */
  modoAuto, decidirAuto, AUTO, autoDe,
  AUTO_OFF, AUTO_INCREMENTAL, AUTO_SEMPRE,
  /* As travas (§Step 2b). `comTravaFluxo` e `donoDoDossie` saem para o teste de
     ORDEM que a rodada 3 pediu; `publicar` sai porque é a região curta dentro do
     `comEscrita` e o teto de espera dela é a outra coisa que aquele round pediu. */
  comTravaFluxo, donoDoDossie, comTravaLedger, anotar, publicar, pastaDaTentativa, idTentativa
};

if (require.main === module) cli().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
