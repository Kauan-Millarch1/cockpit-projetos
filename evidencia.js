/* evidencia.js — o que a sessão pode ver do n8n, e como.
 *
 * POR QUE EXISTE. A conversa do `/upgrade` lia o dossiê e o índice de nós, e
 * nada mais. Isso responde "onde mexer" e não responde a pergunta que o Kauan
 * fez: *"às vezes ele manda que o ingresso está R$0,00 — de onde vem isso?"*.
 * Essa é respondível só pelas EXECUÇÕES, e às vezes por outro fluxo (a tool que
 * busca o preço é um sub-workflow).
 *
 * A SESSÃO NÃO FALA COM O N8N, e isso não vai mudar. Ela roda com
 * `--disallowedTools Bash,…,WebFetch,WebSearch`: não tem shell e não tem rede,
 * então não tem como fazer requisição nem que tivesse a chave. Medido neste
 * repo: `--allowedTools` AUTORIZA, não restringe — uma sessão iniciada só com
 * ele executou shell. E sem `--setting-sources ""` ela carregaria o CLAUDE.md
 * global, que nesta máquina tem a chave do n8n em texto puro.
 *
 * Então o laço é: a sessão escreve um PEDIDO, o cockpit busca, escreve o arquivo
 * na pasta dela, e a rodada roda de novo. Mesmo laço das correções, que já
 * funciona — só que com evidência em vez de recusa.
 *
 * ═══════════════════════ A FRONTEIRA, QUE É NOVA E MAIS LARGA ═══════════════
 *
 * `n8n.js` tem uma whitelist (`extractExecDetail`) que protege o que vai para o
 * BROWSER e para o cache em disco: só campo nomeado, texto cortado em 180,
 * objeto e array nunca passam. Ela continua valendo e não foi tocada.
 *
 * Esta aqui é OUTRA, para outro consumidor — a pasta de scratch de uma sessão
 * local — e ela é deliberadamente mais larga, porque a pergunta exige valor:
 *
 *   - número e booleano passam INTEIROS. É o preço, a contagem, a tentativa, a
 *     flag. Foi medido que o preço chega da API como `"3000"` em string, então
 *     string numérica também passa inteira.
 *   - string passa MASCARADA (`n8n.maskPII`, o mesmo do painel) e cortada.
 *   - objeto e array passam, com teto de profundidade, de itens e de chaves —
 *     é o que permite ver `data.tiers[0].offers[0].price`, que é onde o preço
 *     mora de verdade.
 *
 * O QUE NÃO MUDA, em nenhuma circunstância: telefone e e-mail são mascarados
 * SEMPRE, inclusive dentro do meio de um texto — porque o telefone do lead
 * aparece no corpo da mensagem, e mascarar só o campo `to` deixaria a porta
 * aberta pelo lado do `text`. E nada daqui é servido em rota HTTP nenhuma.
 *
 * "SEMPRE" ERA FALSO EM DOIS PONTOS, e os dois eram do mesmo tamanho do furo que o
 * `DIG_MAX` já fechava do lado da string:
 *
 *   - um telefone gravado como NÚMERO no payload atravessava cru, porque o atalho
 *     do número não olhava o tamanho. `5521999990000` cabe exato num double.
 *   - o NOME DA CHAVE saía cru, e nesta instância a chave do Redis é o telefone do
 *     lead (`memoria:<telefone>`). Um hash devolvido inteiro traz um contato por
 *     chave.
 *
 * Os dois usam a mesma régua agora (`mascarar`), e nenhum dos dois é uma abertura
 * nova: é a mesma frase acima passando a ser verdade.
 *
 * ═════════════════ A BUSCA ENTENDE A MÁSCARA, E NÃO A DESFAZ ═════════════════
 *
 * `contem` comparava a agulha CRUA contra um palheiro já mascarado, então buscar
 * por telefone era impossível — medido numa conversa real, e a sessão diagnosticou
 * certo antes de desistir. A correção é MASCARAR A AGULHA: procura-se a máscara e
 * encontra-se a máscara. A fronteira não se move um milímetro; o que mudou é que a
 * busca fala o mesmo idioma do que sai.
 *
 * FATOS APENAS. Este arquivo não decide se uma execução é interessante; ele
 * busca a que foi pedida e recorta. Quem julga é a sessão, lendo. */

"use strict";

const n8n = require("./n8n.js");

/* ─────────────────────────────────────────────────────────── os tetos ────── */

/* Cada teto existe contra um jeito específico de a evidência ficar inútil ou
   caríssima. Nenhum deles é redondo por estética. */
const PROF_MAX = 8;        // `data.tiers[0].offers[0].price` tem 5; 8 dá folga
const ITENS_ARRAY = 6;     // um array de 400 leads não ensina mais que 6
const CHAVES_MAX = 40;     // objeto de payload de webhook chega a centenas
const TEXTO_CAP = 300;     // maior que os 180 do painel: aqui é para diagnosticar
const NOS_POR_PEDIDO = 12; // pedir 100 nós é pedir o payload inteiro por fora

/* ───────────── o orçamento da varredura: tempo, não contagem ─────────────── */

/* ISTO ERA UM TETO DE CONTAGEM (`VARRER_MAX = 40`) E A MÉTRICA ESTAVA ERRADA.
 *
 * O Kauan colou um telefone e pediu "veja o que aconteceu nesse número". As 40
 * execuções mais novas eram TODAS de hoje, entre 13h14 e 15h00 — 2% do que a
 * instância guarda — e o caso dele era mais antigo. A sessão não tinha como andar
 * para trás, gastou os pedidos e desistiu.
 *
 * O que reenquadra tudo: A VARREDURA NÃO CUSTA TOKEN DE MODELO NENHUM. O cockpit
 * abre, filtra, e só o que CASOU vai para o arquivo que a sessão lê. Então os 40
 * protegiam relógio e carga no n8n — nunca contexto nem cota. Um teto em contagem
 * mede a coisa errada: 40 execuções de um fluxo pequeno são um segundo, e 40 de um
 * fluxo com payload gordo são vinte.
 *
 * MEDIDO NA INSTÂNCIA VIVA em 2026-08-19, no `Agente Iago Comercial` (o fluxo mais
 * movimentado daqui), através do próprio `n8n.js` — não de um cliente de teste:
 *
 *   execuções alcançáveis      1941      a retenção vai a 14,8 dias, 131/dia
 *   listar as 1941             2056ms    8 páginas de 250, 257ms cada
 *   abrir uma execução         0,57MB
 *   abrir com pool 1           285ms/exec
 *   abrir com pool 3           132ms/exec
 *   abrir com pool 4            92ms/exec
 *   abrir com pool 8            82ms/exec   <- 12% melhor que 4, não o dobro
 *   429                        zero, em qualquer pool
 *
 * A LISTA É QUASE DE GRAÇA E ABRIR É O CUSTO — 2 segundos contra 3 minutos para as
 * mesmas 1941. É por isso que listar fundo (para saber QUANTAS existem) e varrer
 * dentro de um orçamento são duas decisões separadas, com dois tetos diferentes. */

/* O pool é 4 porque `request()` no `n8n.js` tem `MAX_INFLIGHT = 4` GLOBAL: um pool
 * de 8 aqui não abre 8 conexões, ele deixa 4 tarefas girando no laço de espera de
 * 60ms. Medido acima — o ganho de 4 para 8 é 12%, e ele vem do enfileiramento, não
 * de paralelismo real.
 *
 * Subir para 8 significaria mexer no `MAX_INFLIGHT`, e isso não é uma decisão sobre
 * este arquivo: os mesmos 4 slots servem o poll do SSE que mantém o `flows.html`
 * vivo. Uma varredura de 3 minutos com pool 8 tomaria os 8 slots e deixaria o
 * painel do Kauan sem poll o tempo inteiro, por 20 segundos de ganho. */
const POOL_VARRER = 4;

/* O orçamento de TEMPO de uma varredura, derivado de uma varredura DE VERDADE e não
 * de uma amostra: a rajada de 16 execuções deu 92ms cada, e as 1913 seguidas deram
 * 110ms — a amostra curta subestima, porque os 4 slots são disputados por mais tempo.
 * Aos 110ms medidos, as 1941 que esta instância alcança custam 213s.
 *
 * 210s foi a primeira escolha e ela ERRAVA por 28 execuções: a varredura parava em
 * 98,6% e disparava todo o aparato de continuação para 3 segundos de trabalho que
 * faltava. 240s são os 213s com 12% de folga, e cabem ~2180 execuções — a retenção de
 * hoje com margem para ela crescer.
 *
 * O número foi escolhido para que a varredura NORMALMENTE TERMINE — `parou: "fim"`,
 * a retenção inteira lida — porque só aí "não achei" pode significar "não existe em
 * nada que esta instância guarda". Um orçamento que estoura sempre transforma toda
 * resposta em "talvez esteja no que eu não abri". */
const ORC_VARRER_MS = 240000;

/* Para de varrer quando já achou o bastante. É o que faz o caso comum custar
 * segundos em vez de minutos: um telefone casa em uma ou duas execuções, e abrir as
 * outras 1900 para confirmar o que já está confirmado é relógio jogado fora.
 *
 * 12 e não 3: com `EXEC_POR_SAIDA = 4`, a sessão consegue abrir 4 destas no pedido
 * seguinte, e 12 dá margem para ela escolher quais 4 — inclusive uma de controle.
 * O preço é que uma pergunta de CONTAGEM ("em quantas saiu R$0,00?") passa a ter um
 * piso em vez de um total quando bate aqui, e o aviso diz isso com essas palavras.
 *
 * É um teto de DESPACHO, não de resultado: as aberturas que já estavam no ar quando o
 * número foi alcançado terminam e entram, então o resultado pode trazer até
 * `POOL_VARRER - 1` a mais. Jogar fora um casamento já pago para o número fechar
 * redondo seria descartar evidência por estética. */
const ACHADOS_MAX = 12;

/* O teto absoluto de execuções abertas num pedido. Ele NÃO é o que morde no comum —
 * aos 92ms medidos o orçamento de tempo para em ~2280 — e existe para o dia em que
 * abrir ficar muito mais rápido e a retenção muito maior: um `for` de 50 mil
 * iteracões não pode nascer de um pedido de uma sessão. */
const VARRER_TETO = 4000;

/* Quantas páginas de lista o pedido pode andar. A lista é o DENOMINADOR da
 * cobertura ("abri 830 das 1941 que existem"), então ela precisa alcançar o fim da
 * retenção: medido, 8 páginas. 16 são 4000 linhas — o mesmo teto do `VARRER_TETO`,
 * porque listar o que nunca poderia ser aberto é 4 segundos gastos para nada. */
const PAGINAS_MAX = 16;
const PAGINA = 250;        // teto por página na API pública; pedir mais é ignorado
const LISTA_TETO = PAGINAS_MAX * PAGINA;

/* Quantas execuções UM pedido `saida` abre.
 *
 * Existe porque `saida` abria uma só, e isso torrava o orçamento por construção:
 * medido num teste de conversa de verdade, uma pergunta sobre TRÊS execuções
 * gastou os 3 pedidos de `MAX_PEDIDOS` só para abri-las, e a resposta fechou na
 * última rodada possível, sem folga para um quarto olhar.
 *
 * O teto é 4, e ele NÃO é sobre bytes — três execuções pedidas de uma vez ou em
 * três rodadas escrevem exatamente os mesmos bytes. O que o teto controla é o
 * tamanho de UM arquivo que a sessão vai ler inteiro com `Read`. Medido em disco
 * nas conversas reais, um `saida` de 6 nós deu 21763 bytes (os outros quatro:
 * 6567, 4521, 6766, 3293). A 4 execuções o pior caso fica em ~87KB, que é a
 * ordem do `DOSSIE.md` (56KB) que a sessão já lê inteiro. Acima disso o arquivo
 * de evidência passa a ser o maior do diretório, e a rodada vira leitura em vez
 * de decisão.
 *
 * 4 e não 3: 3 é a necessidade medida (os três ids da pergunta real), e o quarto
 * slot é o que deixa comparar as três com uma execução de controle no MESMO
 * pedido — que é exatamente o passo que faltou naquela conversa. */
const EXEC_POR_SAIDA = 4;

/* Teto de quantas linhas do `execucoes` carregam a lista de nós que rodaram
 * (`comNos`).
 *
 * É MUITO menor que os 40 do `contem`, e a razão é estrutural: o `contem`
 * devolve só as linhas que CASARAM (normalmente poucas), então o que ele abre
 * não decide o tamanho do que ele escreve. O `comNos` devolve uma lista de nomes
 * para CADA linha aberta, então o tamanho cresce junto com o teto.
 *
 * Medido com uma execução real do Iago: 106 nós rodaram, e a linha com a lista
 * inteira dá 3182 bytes já indentada. A 6 linhas o arquivo fica em 19032 bytes,
 * logo abaixo do maior `saida` que este laço já escreveu em disco (21763). Aos
 * 40 do `contem` daria 125351 — mais que o dobro do `DOSSIE.md`. */
const VARRER_COM_NOS = 6;

/* Teto de nomes por linha do `comNos`. 120 é o mesmo teto do `quemRodou` do
 * `saida`: os dois caminhos respondem "quem rodou nesta execução", e cortar em
 * números diferentes faria a MESMA execução parecer diferente conforme o pedido
 * que a encontrou. Medido, o maior fluxo desta instância roda 106 nós numa
 * execução, então este teto é folga, não corte no caminho comum. */
const NOS_POR_LINHA = 120;

/* ────────────────────────────────────────────── o recorte de um valor ────── */

/* Uma string que É um número passa inteira: medido, o preço vem da API como
 * `"3000"`. Cortar isso em 180 não protegeria nada e destruiria a resposta.
 *
 * O TETO DE 9 DÍGITOS É A PARTE QUE IMPORTA, e ele fecha um furo que eu abri: a
 * primeira versão aceitava até 15, então um telefone cru — `5541999991395`, que é
 * a forma exata de `contact.wa_id` nesta instância — atravessaria SEM MÁSCARA por
 * ser "numérico".
 *
 * O número 9 não é arbitrário: `maskPII` só age a partir de 10 dígitos. Então
 * tudo o que ela sabe mascarar fica FORA deste atalho, e nada que ela mascararia
 * escapa por aqui. Preço, contagem, tentativa e lote têm menos de 10 dígitos;
 * telefone e epoch têm mais. Um epoch mascarado é ruído inofensivo; um telefone
 * vazado não é.
 *
 * Se alguma vez `maskPII` passar a agir com menos dígitos, este teto desce com
 * ela — os dois números são o mesmo número. */
const DIG_MAX = 9;
const ehNumerico = s => new RegExp("^-?\\d{1," + DIG_MAX + "}([.,]\\d{1,6})?$").test(s.trim());

/* A máscara e o corte num lugar só — é o que sai para o texto, para o número
   grande e para o NOME DA CHAVE. Três caminhos, uma régua. */
function mascarar(s) {
  const m = n8n.maskPII(String(s)).replace(/\s+/g, " ").trim();
  return m.length > TEXTO_CAP ? m.slice(0, TEXTO_CAP - 1) + "…" : m;
}

/* O MESMO `DIG_MAX`, em forma de número: `10**9` é o menor valor com 10 dígitos
 * inteiros, que é exatamente onde `maskPII` começa a agir.
 *
 * ISTO ERA UM FURO, e do mesmo tamanho do que o `DIG_MAX` fechou do lado da string:
 * `typeof v === "number"` devolvia o valor inteiro sem olhar o tamanho, então um
 * telefone gravado como NÚMERO no payload atravessava CRU. E cabe: `5521999990000`
 * é exato num double. O atalho existia para preço, contagem, tentativa e flag — que
 * têm menos de 10 dígitos — e estava valendo para telefone e epoch também. */
const NUM_MAX = 10 ** DIG_MAX;

function valor(v, prof) {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Math.abs(v) >= NUM_MAX ? mascarar(v) : v;
  if (typeof v === "string") {
    const s = v.trim();
    if (ehNumerico(s)) return s;
    return mascarar(s);
  }
  if (prof >= PROF_MAX) return "«fundo demais»";
  if (Array.isArray(v)) {
    const corte = v.slice(0, ITENS_ARRAY).map(x => valor(x, prof + 1));
    if (v.length > ITENS_ARRAY) corte.push("«e mais " + (v.length - ITENS_ARRAY) + " item(ns)»");
    return corte;
  }
  if (typeof v === "object") {
    const out = {};
    let n = 0;
    for (const [k, val] of Object.entries(v)) {
      if (n++ >= CHAVES_MAX) { out["«e mais»"] = Object.keys(v).length - CHAVES_MAX + " chave(s)"; break; }
      /* `credentials` não passa nem aqui. A sessão nunca vê credencial, e este
         arquivo não é a exceção. */
      if (/^credentials$/i.test(k)) { out[k] = "«credencial oculta»"; continue; }
      /* O NOME DA CHAVE também sai daqui, e ele não era mascarado. Nesta instância
         a chave do Redis É o telefone do lead (`memoria:<telefone>`, medido nos
         agentes), e um hash devolvido inteiro traz um contato por chave. Chave crua
         é o mesmo vazamento que valor cru.
         Colisão entre duas chaves diferentes que mascaram igual é NUMERADA em vez
         de sobrescrever: perder uma chave em silêncio seria pior que a colisão.

         A GUARDA SÓ PEGAVA UMA DAS DUAS ORDENS, e a que faltava é a que apaga
         dado. Ela era `chave !== k && chave in out`, e essa primeira metade fazia
         a chave que JÁ ESTÁ NA FORMA DA MÁSCARA passar reto: com
         `{"tel:5521999990000": a, "tel:5521 ***** 0000": b}` a primeira mascara
         para o nome da segunda, a segunda mascara para ela mesma (`chave === k`),
         a guarda é pulada e `a` some — medido. O mesmo vale para o colapso de
         espaço que `mascarar` faz (`"x  y"` e `"x y"`).
         `Object.entries` nunca repete chave, então `chave in out` só pode ser
         verdade porque uma chave ANTERIOR caiu ali: isso É a colisão, com ou sem
         a chave ter mudado. A metade que sobrou é a condição inteira. */
      let chave = mascarar(k);
      if (chave in out) {
        let i = 2;
        while ((chave + " «" + i + "»") in out) i++;
        chave += " «" + i + "»";
      }
      out[chave] = valor(val, prof + 1);
    }
    return out;
  }
  return null;
}

/* A saída `main` de uma rodada de um nó, recortada. `binary` não passa: é o áudio
   ou a imagem do lead, e não caberia num `.json` nem ensinaria nada. */
function saidaDoRun(run) {
  const main = ((run || {}).data || {}).main || [];
  const ramos = main.map((ramo, i) => ({
    ramo: i,
    itens: (ramo || []).slice(0, ITENS_ARRAY).map(x => valor(x && x.json, 0)),
    total: (ramo || []).length
  }));
  return {
    ramos,
    ms: typeof run.executionTime === "number" ? run.executionTime : null,
    status: run.executionStatus || null,
    /* De quem este run recebeu — é a aresta, não o vizinho na ordem de execução.
       Sem isso, "de onde veio esse valor" fica sem resposta. */
    de: (Array.isArray(run.source) ? run.source.filter(Boolean)[0] : null)
      ? { no: (run.source.filter(Boolean)[0] || {}).previousNode || null,
          run: (run.source.filter(Boolean)[0] || {}).previousNodeRun || 0 } : null,
    temBinario: !!(run.data && run.data.main && JSON.stringify(run.data.main).includes('"binary"'))
  };
}

/* ─────────────────────────────────────────────── os quatro pedidos ───────── */

/* ─────────────────────── a agulha, do lado da máscara ────────────────────── */

/* POR QUE ISTO EXISTE. Colar um telefone e pedir "veja o que aconteceu nesse
 * número" é a pergunta mais natural que existe, e era IMPOSSÍVEL: o `contem`
 * comparava a agulha CRUA contra um palheiro já mascarado por `saidaDoRun`, então
 * não tinha como casar. Medido numa conversa real: a sessão buscou
 * `5521999990000`, não achou nada, queimou pedidos e desistiu — com o diagnóstico
 * certo ("telefone sempre vem mascarado, buscar pelo número cru por texto
 * praticamente não tem chance de casar") e sem saída nenhuma.
 *
 * A saída não alarga a fronteira em um milímetro: MASCARA-SE A AGULHA. Procura-se a
 * máscara e encontra-se a máscara — nenhum dado cru passa a atravessar, e a busca
 * continua sendo feita no recorte.
 *
 * `maskPII` é canônica para o mesmo número, mas só depois de NORMALIZAR. Medido:
 *
 *     5521999990000      ->  "5521 ***** 0000"
 *     +55 21 99999-0000  ->  "+5521 ***** 0000"
 *     (21) 99999-0000    ->  "(21 ***** 0000"     <- o parêntese entra na máscara
 *
 * Reduzir a agulha a DÍGITOS antes de mascarar faz as três escritas convergirem para
 * uma só. E o mesmo contato gravado com e sem código de país produz máscaras que
 * divergem no começo e coincidem no fim — "5521 ***** 0000" contra "21 ***** 0000".
 * Por isso existe a CAUDA como terceira agulha, e por isso ela é ROTULADA: `***** 0000`
 * casa qualquer número terminado nesses quatro dígitos, e quem lê a resposta precisa
 * saber que o casamento foi frouxo. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* 10 porque é o piso de `maskPII` — abaixo disso a máscara É o literal, e uma agulha
   a mais que casa no mesmo lugar só faria o relatório dizer "casou pela máscara"
   sobre um casamento que foi literal. */
const TEL_DIG_MIN = 10;
/* 19 é o máximo que o regex de `maskPII` consegue casar (1 + 17 + 1). Acima disso ela
   não age, então mascarar a agulha produziria um texto que não existe no palheiro. */
const TEL_DIG_MAX = 19;
/* O que `maskPII` preserva no fim, e o teto do que a cauda pode afirmar.
 *
 * MEDIDO AO VIVO, e o resultado mudou o desenho: varrendo 1913 execuções do Iago com
 * a cauda `***** 0000` ligada por padrão, o único casamento foi
 * `"timestamp":"1786 ***** 0000"` — um EPOCH mascarado terminado nos mesmos quatro
 * dígitos. Falso positivo, e não por azar: quatro dígitos são 1 em 10 mil, e uma
 * varredura dessas passa por ~20 mil valores mascarados. A colisão é esperada.
 *
 * Pior: o furo do número que este arquivo acabou de fechar é o que CRIA esse
 * palheiro — antes, um epoch era um número cru e não tinha máscara para colidir.
 *
 * Então a cauda deixou de ser padrão e virou `frouxo: true`, pedido de propósito. */
const CAUDA_DIG = 4;

/* As formas locais em que o MESMO contato pode estar gravado: sem código de país. É o
 * que resolve o caso real sem o ruído da cauda, porque a máscara de uma forma local
 * ancora o PREFIXO também — `21 ***** 0000` exige seis dígitos certos, contra os
 * quatro da cauda, e não casa `1786 ***** 0000`.
 *
 * 11 e 10 porque são os comprimentos de um número local aqui (com e sem o nono
 * dígito). Não é o país que está no código, é o comprimento — e o que não existir na
 * instância simplesmente não casa nada. */
const LOCAIS = [11, 10];

/* As formas de casar, EM ORDEM DE FORÇA. A ordem é o que decide qual casamento é
   reportado quando mais de um casa na mesma execução — e ela importa porque a máscara
   CONTÉM a cauda como substring: reportar a cauda quando a máscara casou faria a
   resposta parecer mais frouxa do que foi. */
const FORCAS = ["literal", "mascara", "variante", "cauda"];

function agulhas(cru, { frouxo } = {}) {
  const alvo = String(cru == null ? "" : cru).trim().slice(0, 80);
  const alvos = [{ texto: alvo, tipo: "literal" }];
  const juntar = (texto, tipo) => {
    if (!texto || alvos.some(a => a.texto === texto)) return;
    alvos.push({ texto, tipo });
  };
  let forma = null;
  if (EMAIL_RE.test(alvo)) {
    forma = "email";
    const dom = alvo.slice(alvo.indexOf("@") + 1);
    /* Duas escritas porque `maskPII` preserva a primeira letra e o domínio COMO
       ESTÃO: o mesmo e-mail digitado em maiúscula produz outra máscara. */
    juntar(mascarar(alvo), "mascara");
    juntar(mascarar(alvo.toLowerCase()), "mascara");
    /* O domínio sozinho casa QUALQUER PESSOA nele — outro contato, não este. Por isso
       é `frouxo`, pedido de propósito, e nunca padrão. */
    if (frouxo) { juntar("****@" + dom, "cauda"); juntar("****@" + dom.toLowerCase(), "cauda"); }
  } else {
    const dig = alvo.replace(/\D/g, "");
    /* Letra nenhuma, senão `id-5521999990000` e `R$ 0,00` entrariam aqui. O que
       recebe tratamento de número é uma agulha que É um número. */
    if (!/[a-z]/i.test(alvo) && dig.length >= TEL_DIG_MIN && dig.length <= TEL_DIG_MAX) {
      forma = "telefone";
      juntar(mascarar(dig), "mascara");
      /* O mesmo contato sem código de país. Ancorado no prefixo, então não é cauda. */
      for (const n of LOCAIS) if (dig.length > n) juntar(mascarar(dig.slice(-n)), "variante");
      if (frouxo) juntar("***** " + dig.slice(-CAUDA_DIG), "cauda");
    }
  }
  return { alvo, forma, alvos };
}

/* Qual agulha casou, na ordem de força — nunca "casou" sozinho. Uma resposta que não
   diz COMO casou obriga quem lê a confiar igualmente num número inteiro e numa
   cauda de quatro dígitos. */
function casouComo(texto, alvos) {
  for (const a of alvos) if (texto.includes(a.texto)) return a.tipo;
  return null;
}

/* ──────────────────────── a janela, e como andar para trás ───────────────── */

/* A API pública NÃO TEM FILTRO DE DATA em `/executions` — os parâmetros são
 * `workflowId`, `status`, `limit`, `cursor` e `includeData`, e nada mais. Então
 * "procure nas execuções de terça" só existe se alguém andar o cursor até lá, e quem
 * anda é este arquivo.
 *
 * Um instante SEM FUSO é lido como UTC, e isso é uma decisão, não um detalhe: o campo
 * `em` que a sessão lê em cada linha vem da API em UTC com `Z`, então é essa a forma
 * que ela vai copiar. Deixar o `Date.parse` do Node tratar `2026-08-18T13:14` como
 * hora LOCAL deslocaria a janela em 3 horas nesta máquina — silenciosamente, e a
 * sessão concluiria sobre uma faixa de tempo que não foi a varrida. */
const DATA_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function instante(s) {
  if (s == null || s === "") return null;
  const txt = String(s).trim();
  if (!DATA_RE.test(txt)) return null;
  let iso = txt.replace(" ", "T");
  if (!/\d{2}:\d{2}/.test(iso)) iso += "T00:00:00";
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/* A data como uma pessoa lê, em UTC e dizendo que é UTC. Converter para o fuso da
   máquina faria a MESMA execução aparecer com hora diferente conforme onde o cockpit
   está rodando, e a frase da cobertura é comparada com o `em` de cada linha. */
function quando(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 24);
  const d = new Date(t), p = n => String(n).padStart(2, "0");
  return p(d.getUTCDate()) + "/" + p(d.getUTCMonth() + 1) + " "
    + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + "Z";
}

/* A faixa de tempo de um conjunto de linhas. Ordena lexicalmente porque a API devolve
   `startedAt` sempre no mesmo formato ISO com `Z` — ordenar por `Date.parse` custaria
   uma alocação por linha em 1941 linhas para dar o mesmo resultado. */
function faixa(linhas) {
  const ts = linhas.map(l => l.em || l.startedAt).filter(Boolean).sort();
  return { de: ts[0] || null, ate: ts[ts.length - 1] || null };
}
const fraseFaixa = f => !f || !f.de ? "janela desconhecida"
  : f.de === f.ate ? quando(f.de) : quando(f.de) + " a " + quando(f.ate);

/* Lista as execuções, andando o cursor até cobrir o que foi pedido. Sem
 * `includeData` — medido, 257ms por página de 250, contra 92ms POR EXECUÇÃO para
 * abrir. É a parte quase de graça, e é ela que dá o DENOMINADOR da cobertura: sem
 * saber que existem 1941, "abri 830" não é uma afirmação sobre coisa nenhuma. */
async function coletar({ wfId, status, limite, desde, ate, cursor }) {
  const alvo = Math.max(1, Math.min(Number(limite) || 30, LISTA_TETO));
  const t0 = instante(desde), t1 = instante(ate);
  const temJanela = t0 != null || t1 != null;
  /* Com janela ou continuação, cada página pode ser inteira descartada, então vale
     pedir o máximo. Sem, uma página do tamanho do pedido basta. */
  const porPagina = temJanela || cursor ? PAGINA : Math.min(PAGINA, alvo);

  const linhas = [];
  let cur = cursor || null, paginas = 0, proximo = null;
  let passouDoInicio = false, feedAcabou = false, cortouNoMeio = false;

  const tL = Date.now();
  while (paginas < PAGINAS_MAX) {
    const pg = await n8n.listExecutions({ wfId, status, limite: porPagina, cursor: cur });
    paginas++;
    const rows = pg.linhas || [];
    proximo = pg.cursor || null;
    let i = 0;
    for (; i < rows.length; i++) {
      const e = rows[i];
      if (temJanela) {
        const t = e.startedAt ? Date.parse(e.startedAt) : NaN;
        /* Sem `startedAt` a linha não pode ser situada. Ela fica de fora quando há
           janela pedida: incluir uma linha que talvez esteja fora faria a janela
           reportada ser mentira. */
        if (!Number.isFinite(t)) continue;
        if (t1 != null && t > t1) continue;                       // mais nova que a janela
        if (t0 != null && t < t0) { passouDoInicio = true; break; } // a lista é do novo para o velho
      }
      linhas.push(e);
      if (linhas.length >= alvo) { cortouNoMeio = i < rows.length - 1; break; }
    }
    if (passouDoInicio || linhas.length >= alvo) break;
    if (!proximo || !rows.length) { feedAcabou = true; break; }
    cur = proximo;
  }
  const msLista = Date.now() - tL;

  /* Continuar de onde este pedido parou. `proximoCursor` só viaja quando a página foi
     consumida até o fim: parados no meio dela, o `nextCursor` aponta para DEPOIS da
     página inteira e usá-lo pularia linhas em silêncio — que é o defeito que este
     campo existe para não cometer. `ate` sempre serve, com o preço de repetir a
     última linha, e repetir é o lado certo de errar. */
  const acabou = feedAcabou || (passouDoInicio && t0 != null);
  const ultima = linhas.length ? linhas[linhas.length - 1].startedAt || null : null;
  const bateuPagina = paginas >= PAGINAS_MAX && !acabou;

  return {
    linhas,
    lista: {
      paginas, msLista, feedAcabou,
      /* `true` quando a lista provou ter chegado ao fim do que existe (ou ao começo
         da janela pedida). É a diferença entre "não existe" e "não olhei". */
      completa: acabou,
      bateuTetoDePaginas: bateuPagina,
      continuar: acabou ? null : {
        ate: ultima,
        cursor: cortouNoMeio || passouDoInicio ? null : proximo
      }
    }
  };
}

/* ─────────────────── varrer: abrir muitas, dentro de um orçamento ────────── */

/* Abre as execuções em paralelo até UMA das quatro condições: achou o bastante,
 * estourou o tempo, bateu o teto absoluto, ou acabou a lista. Devolve os
 * casamentos na ORDEM DA LISTA — um pool que devolvesse fora de ordem faria a
 * resposta trocar de forma entre dois pedidos iguais.
 *
 * QUANTAS FORAM ABERTAS É EXATO, e isso é o que permite continuar sem pular nada:
 * os índices são despachados em ordem por `i++`, cada trabalhador espera o seu
 * `await` antes de pegar o próximo, e o `Promise.all` só resolve com todos os
 * despachados terminados. Então o conjunto concluído é exatamente `[0, despachadas)`,
 * sem buraco no meio. */
async function varrer(linhas, aoAbrir, { aoProgresso, orcMs, parar } = {}) {
  const t0 = Date.now();
  const ORC = orcMs || ORC_VARRER_MS;
  const limite = Math.min(linhas.length, VARRER_TETO);
  let i = 0, erros = 0, parou = null;
  const achados = [];
  let ultimoAviso = 0;

  const trabalhador = async () => {
    for (;;) {
      if (achados.length >= ACHADOS_MAX) { parou = parou || "achados"; return; }
      if (Date.now() - t0 >= ORC) { parou = parou || "tempo"; return; }
      /* Esc precisa PARAR A CARGA, não só descartar o resultado: uma varredura de
         três minutos que segue rodando depois do cancelamento continua ocupando os
         4 slots do `n8n.js`, e é justamente o poll do painel que fica sem eles. */
      if (parar && parar()) { parou = parou || "parado"; return; }
      if (i >= limite) { parou = parou || (limite < linhas.length ? "teto" : "fim"); return; }
      const meu = i++;
      try {
        const achou = await aoAbrir(linhas[meu], meu);
        if (achou) achados.push({ ordem: meu, achado: achou });
      } catch (e) {
        /* Falha de leitura NÃO é ausência de casamento, e a conta é reportada: com
           300 execuções que não abriram, "não achei" diz muito menos do que parece. */
        erros++;
      }
      /* O progresso é dito enquanto acontece porque uma varredura pode levar
         minutos, e uma tela parada por três minutos lê como travada. */
      if (aoProgresso && Date.now() - ultimoAviso > 2500) {
        ultimoAviso = Date.now();
        aoProgresso({ abertas: i, de: linhas.length, achados: achados.length, ms: Date.now() - t0 });
      }
    }
  };
  await Promise.all(Array.from({ length: POOL_VARRER }, trabalhador));

  const abertas = Math.min(i, limite);
  achados.sort((a, b) => a.ordem - b.ordem);
  return {
    achados: achados.map(a => a.achado),
    abertas, erros, ms: Date.now() - t0,
    parou: parou || "fim",
    /* A última linha que TERMINOU de ser aberta. É por ela que a continuação
       começa, e não pelo índice, porque o pedido seguinte lista de novo. */
    ultimaAberta: abertas ? linhas[abertas - 1] : null
  };
}

/* Como a varredura parou, em uma frase — e cada uma delas tem consequência
   diferente para o que a sessão pode afirmar. */
const PAROU_FRASE = {
  fim: "varri tudo o que a lista alcançou",
  parado: "fui interrompido antes do fim",
  achados: "parei ao achar " + ACHADOS_MAX + ", que é o teto de casamentos por pedido",
  tempo: "estourei o orçamento de " + Math.round(ORC_VARRER_MS / 1000) + "s de varredura",
  teto: "bati o teto de " + VARRER_TETO + " execuções abertas num pedido"
};

/* `execucoes` — quais execuções existem, e opcionalmente quais CONTÊM um texto
 * (`contem`) ou QUAIS NÓS rodaram em cada uma (`comNos`).
 *
 * O `contem` é o que responde "me traz as execuções onde saiu R$0,00" ou "onde
 * aparece este telefone": ele abre uma por uma e procura, agora fundo — a retenção
 * inteira, dentro do orçamento de tempo — e sabendo mascarar a agulha.
 *
 * O `comNos` responde a pergunta de antes dessa — "qual execução vale abrir" — e
 * existe porque sem ele escolher é chute: medido num teste de conversa de verdade,
 * um dos 3 pedidos foi inteiro numa execução que tinha caído num ramo que não
 * interessava, e a lista de id/status/horário não tinha como avisar.
 *
 * Os dois abrem execução, e os tetos deles são de naturezas diferentes: o do
 * `contem` é de RELÓGIO (o resultado só carrega o que casou), e o do `comNos` é de
 * BYTES (cada linha carrega a lista de nomes inteira). Um número só para os dois
 * faria um deles estar errado.
 *
 * A COBERTURA SEMPRE VIAJA: quantas abriu, de quantas existem, e a janela real em
 * datas. Uma varredura truncada apresentada como completa é a mentira que este painel
 * não conta, e "não achei" nunca pode ler como "não existe".
 *
 * Os campos de nós são DOIS, e de propósito: `nos` são os nós onde o `contem` casou;
 * `rodaram` são todos os que rodaram. Um nome só para as duas coisas faria a mesma
 * lista significar duas coisas diferentes conforme o pedido. */
/* `_orcMs` NÃO é campo do pedido: `validarPedido` nunca o produz, e `atender`
 * recebe o objeto validado. Ele existe para o teste poder provar o caminho do
 * orçamento estourado em 150ms em vez de esperar 210 segundos — e há um caso
 * provando que uma sessão não consegue encurtar nem esticar a varredura por aqui. */
async function execucoes({ wfId, status, limite, contem, comNos, desde, ate, cursor, frouxo, aoProgresso, parar, _orcMs } = {}) {
  /* Com `contem`, o padrão é ir FUNDO: a varredura não custa token de modelo, e o
     caso que motivou isto (um telefone de dias atrás) estava fora das 40 mais novas.
     Sem `contem`, a lista é o produto e 30 linhas é o que se lê. */
  const alvoLista = limite != null ? limite : (contem ? LISTA_TETO : 30);
  const col = await coletar({ wfId, status, limite: alvoLista, desde, ate, cursor });
  const linhas = col.linhas.map(e => ({
    id: String(e.id), status: e.status, em: e.startedAt,
    ms: e.startedAt && e.stoppedAt ? new Date(e.stoppedAt) - new Date(e.startedAt) : null
  }));

  /* A cobertura da LISTA existe mesmo quando nada foi aberto: "listei 1941 e não
     abri nenhuma" é uma afirmação diferente de "não existem". */
  const janelaListada = faixa(linhas);
  const base = {
    total: linhas.length,
    janela: {
      pedida: desde || ate ? { desde: desde || null, ate: ate || null } : null,
      listadas: { n: linhas.length, ...janelaListada },
      paginas: col.lista.paginas, msLista: col.lista.msLista,
      alcancouOFim: col.lista.completa,
      continuar: col.lista.continuar
    }
  };

  /* Uma sentença sobre o alcance da lista, quando ela NÃO chegou ao fim. Sem isto, um
     `limite` pequeno esconde que existe mais atrás — e é o defeito que esta rodada
     inteira existe para consertar. */
  const avisoLista = !col.lista.completa
    ? "a lista NÃO chegou ao fim do que existe: parei em " + linhas.length + " linha(s), a mais antiga de "
      + quando(janelaListada.de || janelaListada.ate) + (col.lista.bateuTetoDePaginas
        ? " (bati o teto de " + PAGINAS_MAX + " páginas)" : "")
      + ". Para continuar mais para trás, peça de novo com "
      + (col.lista.continuar && col.lista.continuar.cursor
        ? "`cursor` igual ao `janela.continuar.cursor` desta resposta"
        : "`ate` igual ao `janela.continuar.ate` desta resposta")
      + " — ou aponte a janela direto com `desde`/`ate` se você souber mais ou menos quando foi."
    : null;

  if (!contem && !comNos) return { ...base, execucoes: linhas, varridas: 0, truncado: false, aviso: avisoLista };

  /* A lista de nós de UMA execução já aberta. Só nome: nada de parâmetro, nada de
     saída — quem quer valor pede `saida`, e esta é a resposta mais barata que existe
     para "por qual ramo essa execução foi". */
  const rodaramDe = rd => {
    const nomes = Object.keys(rd);
    return { rodaram: nomes.slice(0, NOS_POR_LINHA), rodaramTotal: nomes.length };
  };
  const runDataDe = bruto => (((bruto.data || {}).resultData || {}).runData) || {};

  /* Só `comNos`: abre até o teto próprio dele e devolve TODAS as linhas abertas, não
     só as que casaram — não há o que casar aqui. O teto é de BYTES, então continua
     pequeno e sequencial: seis execuções são meio segundo. */
  if (!contem) {
    const quantas = Math.min(linhas.length, VARRER_COM_NOS);
    const out = [];
    for (let i = 0; i < quantas; i++) {
      let bruto;
      /* Falha de leitura é estado PRÓPRIO, não ausência de nós: uma linha sem
         `rodaram` e sem explicação leria como "essa execução não rodou nada". */
      try { bruto = await n8n.getRawExecution(linhas[i].id); }
      catch (e) { out.push({ ...linhas[i], erro: "não consegui abrir: " + String(e && e.message || e).slice(0, 120) }); continue; }
      out.push({ ...linhas[i], ...rodaramDe(runDataDe(bruto)) });
    }
    const abertas = { n: quantas, ...faixa(out) };
    return {
      ...base, varridas: quantas, truncado: quantas < linhas.length,
      janela: { ...base.janela, abertas },
      aviso: [
        quantas < linhas.length
          ? "abri " + quantas + " das " + linhas.length + " execuções listadas (teto de " + VARRER_COM_NOS
            + " para `comNos`, porque cada linha traz a lista de nós inteira — o teto aqui é de tamanho de "
            + "resposta, não de relógio). As abertas vão de " + fraseFaixa(abertas)
            + ". Um nó que você não achou aqui pode estar nas que não abri — aponte a janela com "
            + "`desde`/`ate`, ou use `contem` se o que você procura é um valor."
          : null,
        avisoLista
      ].filter(Boolean).join(" ") || null,
      execucoes: out
    };
  }

  /* ── a varredura por conteúdo, fundo e com orçamento ───────────────────────── */

  const ag = agulhas(contem, { frouxo });
  let comNosEm = 0;
  const v = await varrer(linhas, async (linha) => {
    const bruto = await n8n.getRawExecution(linha.id);
    const rd = runDataDe(bruto);
    const onde = [];
    let como = null;
    for (const [nome, runs] of Object.entries(rd)) {
      for (const run of (runs || [])) {
        /* A busca é no que o nó PRODUZIU, RECORTADO — nunca no payload cru, para que
           nem a busca veja o que a fronteira não deixa sair. É por isso que a agulha
           precisou ser mascarada em vez de o palheiro ser aberto. */
        const tipo = casouComo(JSON.stringify(saidaDoRun(run)), ag.alvos);
        if (tipo) {
          onde.push(nome);
          if (!como || FORCAS.indexOf(tipo) < FORCAS.indexOf(como)) como = tipo;
          break;
        }
      }
      if (onde.length >= 8) break;
    }
    if (!onde.length) return null;
    const achado = { ...linha, nos: onde, comoCasou: como };
    /* Com `contem` a execução JÁ está aberta, então `comNos` aqui não custa GET
       nenhum — custa só bytes. Por isso o teto de linhas que carregam a lista
       continua valendo, e o quanto foi coberto é dito. */
    if (comNos && comNosEm < VARRER_COM_NOS) { Object.assign(achado, rodaramDe(rd)); comNosEm++; }
    return achado;
  }, { aoProgresso, parar, orcMs: _orcMs });

  const casaram = v.achados;
  const abertas = { n: v.abertas, ...faixa(linhas.slice(0, v.abertas)) };
  const porCauda = casaram.filter(l => l.comoCasou === "cauda").length;
  const porVariante = casaram.filter(l => l.comoCasou === "variante").length;
  const sobraram = linhas.length - v.abertas;

  return {
    ...base,
    procurei: ag.alvo,
    /* A forma reconhecida e as agulhas de fato usadas. Sem isto, a sessão não tem como
       saber que o número que ela colou foi procurado em outra escrita — e concluiria
       que a busca é literal quando ela não é. */
    forma: ag.forma,
    agulhas: ag.alvos,
    varridas: v.abertas,
    naoAbriram: v.erros,
    truncado: sobraram > 0,
    parou: v.parou,
    msVarredura: v.ms,
    comNosEm: comNos ? comNosEm : undefined,
    janela: { ...base.janela, abertas },
    /* Dito em vez de implícito: com orçamento estourado, "não achei" não é "não
       existe". A cobertura vem em NÚMEROS e em DATAS, porque "40 execuções" não diz
       se elas eram de hoje ou da semana passada. */
    aviso: [
      "abri " + v.abertas + " de " + linhas.length + " execução(ões) listadas, cobrindo "
        + fraseFaixa(abertas) + " — " + PAROU_FRASE[v.parou] + ".",
      v.erros ? v.erros + " não abriram por falha de leitura, e falha de leitura não é ausência "
        + "de casamento: essas não foram procuradas." : null,
      sobraram > 0
        ? "sobraram " + sobraram + " listadas sem abrir (as mais antigas, até "
          + quando(janelaListada.de || janelaListada.ate) + "), então NÃO ACHEI não é NÃO EXISTE. "
          + "Para continuar de onde parei, peça de novo com `ate` igual a "
          + ((v.ultimaAberta && v.ultimaAberta.em) || "…")
          + (v.parou === "achados" ? " — ou já use o que casou, que costuma bastar." : ".")
        : null,
      porVariante
        ? porVariante + " casaram por uma VARIANTE do número — a mesma cauda com outro prefixo, "
          + "que é o mesmo contato gravado sem código de país. Ancorado no prefixo, então é forte; "
          + "mas se o prefixo não fizer sentido para você, confira com `saida`."
        : null,
      /* A cauda casou um EPOCH mascarado na primeira medição ao vivo. Quem pediu
         `frouxo` merece saber disso de novo aqui, com o exemplo real. */
      porCauda
        ? porCauda + " casaram só pela CAUDA (`"
          + (ag.alvos.find(a => a.tipo === "cauda") || {}).texto + "`), que são quatro dígitos e nada "
          + "mais: medido ao vivo, isso casou um `\"timestamp\":\"1786 ***** 0000\"` — um epoch "
          + "mascarado, não um contato. CONFIRA CADA UM com `saida` antes de afirmar qualquer coisa."
        : null,
      ag.forma
        ? "reconheci a agulha como " + (ag.forma === "email" ? "e-mail" : "telefone")
          + " e procurei também a forma MASCARADA dela (" + ag.alvos.filter(a => a.tipo !== "literal")
            .map(a => "`" + a.texto + "`").join(", ") + "), porque a evidência sai mascarada dos dois lados."
          + (frouxo ? "" : " Se você esperava casar e não casou, o número pode estar gravado numa forma "
            + "que eu não previ: `frouxo: true` procura só pelos 4 últimos dígitos — acha mais, e "
            + "erra mais (casa epoch e id que terminam igual).")
        : null,
      comNos && casaram.length > comNosEm
        ? "só as " + comNosEm + " primeiras das " + casaram.length + " que casaram trazem `rodaram` (teto de "
          + VARRER_COM_NOS + "): nas outras, a ausência da lista não diz nada sobre quais nós rodaram."
        : null,
      avisoLista
    ].filter(Boolean).join(" "),
    execucoes: casaram
  };
}

/* O bloco de UMA execução: o que os nós nomeados produziram nela. */
async function umaExecucao(execId, nos) {
  const bruto = await n8n.getRawExecution(execId);
  const rd = (((bruto.data || {}).resultData || {}).runData) || {};
  const pedidos = (Array.isArray(nos) ? nos : [nos]).filter(Boolean).map(String).slice(0, NOS_POR_PEDIDO);

  const out = {};
  const ausentes = [];
  for (const nome of pedidos) {
    if (!rd[nome]) { ausentes.push(nome); continue; }
    out[nome] = (rd[nome] || []).slice(0, 3).map(saidaDoRun);
  }
  return {
    execId: String(execId), status: bruto.status || null, em: bruto.startedAt || null,
    /* O nó do erro, quando houve — a mesma informação que o quadro de falhas usa. */
    erro: ((bruto.data || {}).resultData || {}).error
      ? { no: (((bruto.data.resultData.error || {}).node || {}).name) || null,
          mensagem: String(bruto.data.resultData.error.message || "").slice(0, 300) } : null,
    ultimoNo: ((bruto.data || {}).resultData || {}).lastNodeExecuted || null,
    nos: out,
    /* Nó ausente é FATO, não erro: ele pode não ter rodado neste caminho, e isso
       costuma ser a própria resposta. A lista de quem rodou vai junto para a
       sessão não ficar adivinhando nome. */
    naoRodaram: ausentes,
    quemRodou: Object.keys(rd).slice(0, NOS_POR_LINHA)
  };
}

/* `saida` — o que nós nomeados produziram numa execução, ou em VÁRIAS. É o pedido
 * que responde "de onde veio esse valor".
 *
 * DUAS FORMAS, e a de sempre não mudou um byte: com `execId` o resultado é o
 * bloco plano que a sessão já conhece; com `execIds` ele vem CHAVEADO por
 * execução, cada uma com o seu `naoRodaram` e o seu `quemRodou`. Misturar as
 * listas de três execuções num só `naoRodaram` seria pior que não ter a lista —
 * "esse nó não rodou" sem dizer em qual delas não responde nada.
 *
 * A forma segue o campo que foi usado, e não a quantidade: `execIds` com um id só
 * ainda vem chaveado. Uma forma que muda com o tamanho da lista obriga a sessão a
 * adivinhar qual leitura fazer. */
async function saida({ execId, execIds, nos, ignorados }) {
  if (!Array.isArray(execIds)) return umaExecucao(execId, nos);

  const ids = execIds.map(String).slice(0, EXEC_POR_SAIDA);
  const porExec = {};
  const falharam = [];
  for (const id of ids) {
    /* Uma execução que não abre NÃO derruba as outras: com um id só a falha é a
       própria resposta e o laço já a reporta como fato, mas perder três leituras
       boas por causa de um id errado seria exatamente o desperdício de rodada que
       este pedido existe para acabar. */
    try { porExec[id] = await umaExecucao(id, nos); }
    catch (e) { falharam.push({ execId: id, erro: String(e && e.message || e).slice(0, 200) }); }
  }
  return {
    pedidas: ids.length + (ignorados || []).length,
    abertas: Object.keys(porExec).length,
    /* Id que não caberia no teto é DITO, nunca descartado em silêncio: sem esta
       lista a sessão concluiria sobre uma execução que ninguém abriu. */
    naoAbri: (ignorados || []).map(String),
    falharam,
    execucoes: porExec
  };
}

/* `grafo` — os nós e as arestas de outro fluxo, para seguir uma tool ou um
   sub-workflow. Reusa a whitelist do painel: aqui não se precisa de parâmetro,
   só de estrutura. */
async function grafo({ wfId }) {
  const g = await n8n.getGraph(wfId);
  /* `extractGraph` devolve `{id, name, active, nodes, edges}` — em INGLÊS. A
     primeira versão daqui leu `g.nome/g.nos/g.arestas`, que não existem, então
     TODO fluxo voltava `{nos: [], arestas: []}`: o único caminho para seguir um
     sub-fluxo ou uma tool era cego. Pego por um teste de conversa de verdade, e o
     defeito grave não era o vazio — era o silêncio: o log escrevia
     "li o grafo: 0 nós" no nível `good`, e a sessão leu isso como "esse fluxo
     está vazio". Por isso `grafoVazio` abaixo existe. */
  /* A DECISÃO, para a tradução não voltar a ser implícita: a SAÍDA fica em
     PORTUGUÊS (`nome`, `ativo`, `nos`, `arestas`), e a tradução acontece AQUI,
     nesta linha, que é a única fronteira entre os dois idiomas.
     Duas razões, e a segunda é a que decide. A interface que a sessão de modelo lê
     é português do começo ao fim — `execucoes`, `saida`, `naoRodaram`, `quemRodou`,
     `comoCasou` — e um único pedido devolvendo `nodes/edges` obrigaria ela a saber
     qual verbo fala qual idioma. E `resumo`, `grafoVazio` e o `upgrade.js` já leem
     `r.nos`: espelhar o inglês trocaria um bug silencioso por outro, em três
     lugares de uma vez. O que não pode existir é a tradução ficar subentendida —
     foi exatamente assim que ela sumiu. */
  const nos = g.nodes || [];
  const arestas = g.edges || [];
  return { wfId: String(wfId), nome: g.name || null, ativo: !!g.active, nos, arestas };
}

/* Um fluxo que existe e não tem nó não existe nesta instância: até um fluxo
   recém-criado tem trigger. Zero nós é falha de leitura, e ela tem de se
   anunciar — devolver vazio como sucesso foi exatamente o que fez a sessão
   concluir coisa errada com confiança. */
const grafoVazio = r => !!r && Array.isArray(r.nos) && r.nos.length === 0;

/* `fluxos` — a lista, para achar o id do sub-fluxo por nome. Só id, nome e
   estado; nada de nó nem de parâmetro. */
async function fluxos() {
  const l = await n8n.listWorkflows();
  return { fluxos: (l || []).map(w => ({ id: String(w.id), nome: w.name, ativo: !!w.active })).slice(0, 200) };
}

/* ───────────────────────────────────────────── o contrato do pedido ──────── */

const TIPOS = new Set(["execucoes", "saida", "grafo", "fluxos"]);

/* Valida ANTES de gastar uma chamada. Um pedido malformado volta como recusa
   nomeada para a sessão, que é o laço que já funciona — nunca como uma busca
   torta que devolve lixo e queima a rodada. */
function validarPedido(p) {
  const erros = [];
  if (!p || typeof p !== "object") return { ok: false, erros: ["`pedido` tem que ser um objeto"] };
  const oque = String(p.oque || "");
  if (!TIPOS.has(oque)) {
    erros.push('`oque` tem que ser um de ' + [...TIPOS].join(", ") + ' — veio "' + oque + '"');
    return { ok: false, erros };
  }
  const v = { oque };
  if (oque === "execucoes") {
    if (p.wfId != null) v.wfId = String(p.wfId);
    if (p.status != null) {
      if (!n8n.STATUS_VALIDOS.has(String(p.status))) {
        erros.push('`status` inválido: os que esta instância aceita são ' + [...n8n.STATUS_VALIDOS].join(", ")
          + " — `crashed` devolve 400, é medido");
      } else v.status = String(p.status);
    }
    /* O teto do `limite` era 250, que é o tamanho de UMA página da API. Com a lista
       paginando, pedir mais que uma página deixou de ser impossível — e é o que
       permite estabelecer o denominador da cobertura ("de quantas existem"). */
    if (p.limite != null) v.limite = Math.max(1, Math.min(LISTA_TETO, Number(p.limite) || 30));
    /* A janela de data. Ela é o que resolve o caso real por cima do orçamento: o
       Kauan sabe mais ou menos quando foi, e uma janela de um dia são ~131 execuções
       (12s medidos) em vez das 1941 da retenção inteira (179s). */
    for (const campo of ["desde", "ate"]) {
      if (p[campo] == null || p[campo] === "") continue;
      if (instante(p[campo]) == null) {
        erros.push("`" + campo + "` tem que ser um instante ISO como o campo `em` de cada linha "
          + '(`2026-08-14` ou `2026-08-14T13:14:00Z`) — veio "' + String(p[campo]).slice(0, 40)
          + '". Sem fuso ele é lido como UTC, igual ao que a API devolve.');
      } else v[campo] = String(p[campo]).trim();
    }
    /* Janela invertida é recusada em vez de devolver vazio: uma varredura que abre
       zero execuções e responde "não achei" leria como "não existe". */
    if (v.desde && v.ate && instante(v.desde) > instante(v.ate)) {
      erros.push("`desde` é mais novo que `ate` — nessa ordem a janela é vazia e a resposta seria "
        + "um `não achei` que não afirma nada. A lista vai do mais novo para o mais velho: "
        + "`desde` é o começo (mais antigo) e `ate` é o fim (mais recente).");
    }
    /* O cursor é opaco (base64 do n8n) e só faz sentido se veio de uma resposta
       nossa. Validado pela forma para um texto qualquer não virar uma página
       aleatória do feed. */
    if (p.cursor != null && p.cursor !== "") {
      const c = String(p.cursor);
      if (!/^[A-Za-z0-9+/=_-]{1,512}$/.test(c)) {
        erros.push("`cursor` tem que ser o valor exato de `janela.continuar.cursor` de uma "
          + "resposta anterior — não é uma data nem um id");
      } else v.cursor = c;
    }
    if (p.contem != null) {
      const c = String(p.contem).trim();
      if (c.length < 2) erros.push("`contem` precisa de ao menos 2 caracteres para valer uma varredura");
      else v.contem = c.slice(0, 80);
    }
    /* `comNos` é booleano e nada mais: um valor qualquer virando `true` faria a
       sessão abrir 6 execuções por causa de um `"não"` escrito no campo. */
    if (p.comNos != null && p.comNos !== false) {
      if (p.comNos !== true) erros.push("`comNos` só aceita `true` ou `false` — veio `" + JSON.stringify(p.comNos) + "`");
      else v.comNos = true;
    }
    /* `frouxo` liga a busca pelos 4 últimos dígitos. Mesma disciplina do `comNos`, e
       aqui o preço de um valor coagido é pior: casamento falso apresentado como
       achado. Medido ao vivo, a cauda casou um epoch mascarado. */
    if (p.frouxo != null && p.frouxo !== false) {
      if (p.frouxo !== true) erros.push("`frouxo` só aceita `true` ou `false` — veio `" + JSON.stringify(p.frouxo) + "`");
      else if (p.contem == null) erros.push("`frouxo` só faz sentido junto com `contem` — ele afrouxa a busca, e sem busca não afrouxa nada");
      else v.frouxo = true;
    }
  }
  if (oque === "saida") {
    /* `execIds` é a forma nova (várias execuções num pedido) e `execId` é a que a
       sessão já conhece. Com os dois, o de fora entra na lista em vez de virar
       recusa: recusar custaria uma rodada por uma ambiguidade que não existe. */
    const listou = p.execIds != null;
    const brutos = listou
      ? (Array.isArray(p.execIds) ? p.execIds : [p.execIds]).concat(p.execId != null ? [p.execId] : [])
      : [p.execId];
    const limpos = [];
    for (const cru of brutos) {
      const id = String(cru == null ? "" : cru).trim();
      if (!/^\d{1,20}$/.test(id)) {
        erros.push("`" + (listou ? "execIds" : "execId") + "` tem que ser o id numérico de uma execução — veio \"" + id.slice(0, 40) + "\"");
        continue;
      }
      if (!limpos.includes(id)) limpos.push(id);
    }
    if (listou && !erros.length) {
      if (!limpos.length) erros.push("`execIds` veio vazio — liste ao menos um id de execução");
      v.execIds = limpos.slice(0, EXEC_POR_SAIDA);
      /* Passa do teto: os que sobram NÃO são descartados em silêncio, eles viajam
         para o resultado poder dizer quais ficaram de fora. Truncar calado faria a
         sessão concluir sobre uma execução que ninguém abriu. */
      if (limpos.length > EXEC_POR_SAIDA) v.ignorados = limpos.slice(EXEC_POR_SAIDA);
    } else if (!listou && limpos.length) {
      v.execId = limpos[0];
    }
    const nos = (Array.isArray(p.nos) ? p.nos : [p.nos]).filter(Boolean).map(String);
    if (!nos.length) erros.push("`nos` tem que listar ao menos um nome de nó, exato como está no `nodes-index.md`");
    else v.nos = nos.slice(0, NOS_POR_PEDIDO);
  }
  if (oque === "grafo") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(p.wfId || ""))) erros.push("`wfId` tem que ser o id de um fluxo");
    else v.wfId = String(p.wfId);
  }
  return erros.length ? { ok: false, erros } : { ok: true, valor: v };
}

/* Executa um pedido JÁ VALIDADO. Só GET — não existe pedido que escreva, e isso
   é por construção: os quatro verbos são um conjunto fechado e nenhum deles
   chama `putWorkflow`, `createWorkflow` ou `retryExecution`. */
/* Os dois ganchos são opcionais. `aoProgresso` existe por uma razão de tela: uma varredura pode levar
   minutos, e a conversa emite uma linha de atividade quando o pedido começa e nada
   até ele acabar. Três minutos de tela parada leem como travada — e este arquivo não
   pode conhecer a sessão, então quem quer contar o progresso passa a função. */
async function atender(p, { aoProgresso, parar } = {}) {
  if (p.oque === "execucoes") return execucoes({ ...p, aoProgresso, parar });
  if (p.oque === "saida") return saida(p);
  if (p.oque === "grafo") return grafo(p);
  if (p.oque === "fluxos") return fluxos();
  throw new Error("pedido não atendido: " + p.oque);
}

/* Uma linha para o log da conversa: o que foi buscado e o tamanho do que voltou.
   Sem isso, "ela pediu evidência" é ato de fé — e este painel mostra o que
   aconteceu, não o que foi solicitado. */
function resumo(p, r) {
  const kb = (JSON.stringify(r).length / 1024).toFixed(1) + "KB";
  /* A COBERTURA EM DATAS entra no log, não só a contagem. "varri 40 execuções" foi
     exatamente a frase que deixou o Kauan sem saber que as 40 eram todas da última
     hora e meia — a janela é o que transforma o número numa afirmação. */
  const jan = r.janela || {};
  const emDatas = f => f && f.n ? ", entre " + fraseFaixa(f) : "";
  if (p.oque === "execucoes") {
    if (p.contem) {
      return 'procurei "' + p.contem + '" em ' + r.varridas + " execução(ões)"
        + (r.forma ? " (e na forma mascarada, é um " + (r.forma === "email" ? "e-mail" : "telefone") + ")" : "")
        + " de " + r.total + " listadas" + emDatas(jan.abertas) + ": " + r.execucoes.length + " casaram"
        + (r.execucoes.some(l => l.comoCasou === "cauda") ? " (alguma só pela CAUDA — 4 dígitos, confira)" : "")
        + (r.execucoes.some(l => l.comoCasou === "variante") ? " (alguma por variante sem código de país)" : "")
        + (p.comNos ? ", " + (r.comNosEm || 0) + " com a lista de nós" : "")
        + (r.naoAbriram ? " · " + r.naoAbriram + " não abriram" : "")
        + " · " + PAROU_FRASE[r.parou] + " em " + ((r.msVarredura || 0) / 1000).toFixed(0) + "s · " + kb;
    }
    /* Com `comNos` o número que importa é quantas foram ABERTAS de quantas: dizer
       só "listei 15" esconderia que a lista de nós só existe para 6 delas. */
    if (p.comNos) {
      return "abri " + r.varridas + " de " + r.total + " execução(ões) para ver quais nós rodaram"
        + emDatas(jan.abertas)
        + (r.truncado ? " — as outras " + (r.total - r.varridas) + " não foram abertas" : "") + " · " + kb;
    }
    return "listei " + r.total + " execução(ões)" + emDatas(jan.listadas)
      + (jan.alcancouOFim === false ? " — e NÃO cheguei ao fim do que existe" : "") + " · " + kb;
  }
  if (p.oque === "saida") {
    /* Forma de várias execuções: o resumo NUNCA soma os nós de todas numa conta
       só, porque "3 nós com saída" de três execuções não diz em qual. */
    if (r.execucoes && !r.nos) {
      if (!r.abertas) return "NÃO CONSEGUI ABRIR nenhuma das " + r.pedidas
        + " execuções pedidas. Não conclua nada sobre elas a partir disto.";
      const partes = Object.values(r.execucoes).map(b =>
        "#" + b.execId + " (" + Object.keys(b.nos).length + " com saída"
        + (b.naoRodaram.length ? ", " + b.naoRodaram.length + " não rodaram" : "") + ")");
      return "abri " + r.abertas + " de " + r.pedidas + " execuções: " + partes.join(", ")
        + (r.falharam.length ? " · não abriram: #" + r.falharam.map(f => f.execId).join(", #") : "")
        + (r.naoAbri.length ? " · fora do teto, NÃO abertas: #" + r.naoAbri.join(", #") : "") + " · " + kb;
    }
    const achados = Object.keys(r.nos).length;
    return "abri a execução #" + r.execId + ": " + achados + " nó(s) com saída"
      + (r.naoRodaram.length ? ", " + r.naoRodaram.length + " não rodaram" : "") + " · " + kb;
  }
  if (p.oque === "grafo") {
    /* Vazio NUNCA lê como sucesso: é o que fez uma sessão concluir que um fluxo
       ativo de 31 nós estava vazio. A frase diz que a leitura falhou. */
    if (grafoVazio(r)) return "NÃO CONSEGUI LER o grafo de " + r.wfId + " — voltou com 0 nós, "
      + "o que não acontece com fluxo que existe. Não conclua nada sobre este fluxo a partir disto.";
    return "li o grafo de " + (r.nome || r.wfId) + ": " + r.nos.length + " nós, " + r.arestas.length + " arestas · " + kb;
  }
  return "listei " + (r.fluxos || []).length + " fluxos · " + kb;
}

module.exports = {
  validarPedido, atender, resumo,
  // expostos para teste
  valor, saidaDoRun, execucoes, saida, grafo, fluxos, ehNumerico,
  TIPOS, PROF_MAX, ITENS_ARRAY, TEXTO_CAP, NOS_POR_PEDIDO, DIG_MAX, grafoVazio,
  EXEC_POR_SAIDA, VARRER_COM_NOS, NOS_POR_LINHA,
  /* a agulha e o orçamento */
  agulhas, casouComo, instante, quando, faixa, fraseFaixa, varrer, coletar, mascarar,
  ORC_VARRER_MS, ACHADOS_MAX, VARRER_TETO, POOL_VARRER, PAGINAS_MAX, PAGINA, LISTA_TETO,
  TEL_DIG_MIN, TEL_DIG_MAX, CAUDA_DIG, LOCAIS, FORCAS, PAROU_FRASE, NUM_MAX
};
