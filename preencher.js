"use strict";
/* preencher.js — o portão `[PREENCHER]` (§4.3 do `PLAN-UPGRADE.md`).
 *
 * PORTÃO NOVO, não regra que já existia: nem `validate()` nem `applyPatch()` do
 * `claude-fix.js` rejeitam placeholder hoje. O plano tratava isso como coberto e
 * não estava — `applyPatch` recusa campo desconhecido, chave `credentials` e troca
 * de `type`, e a lista acaba aí.
 *
 * Por que ele existe: no Tester o marcador é inofensivo. Lá o JSON é importado à
 * mão, o nó aparece com `[PREENCHER]` no campo, e quem importa vê. Aqui o destino é
 * um fluxo de produção com tráfego, e o marcador entraria ESCRITO — um nó que roda,
 * não falha, e faz a coisa errada em silêncio. Se o modelo não sabe o nome da
 * tabela, ele pergunta; perguntar é uma rodada, escrever errado é um incidente.
 *
 * O QUE ELE VARRE É A METADE QUE DECIDE TUDO: apenas o que o patch escreve, nunca
 * o documento. Um fluxo de 189 nós desta instância já carrega `[PREENCHER]` de
 * builds antigos do Tester (16 marcadores no agente medido em `CLAUDE.md`), então
 * um portão que varresse o fluxo inteiro reprovaria todo patch para sempre — e um
 * portão que sempre reprova ensina a ignorar o portão.
 *
 * Fatos, não juízo de estilo: ele devolve achados com nó, caminho e marcador. As
 * frases vão de volta para o modelo no laço de correção que já funciona.
 */

/* ─────────────────────────────────────────────────── o que é marcador ────── */

/* Marcador entre colchetes. O `[^\]]{0,30}` é o que pega `[PREENCHER: nome da
   tabela]` além do `[PREENCHER]` seco — o modelo costuma explicar dentro do
   colchete, e a versão explicada é a MAIS comum das duas.

   `\[0\]` e `$json["campo"]` não casam porque a palavra é obrigatória: índice de
   array e acesso por chave são o que mais aparece num parâmetro n8n, e um portão
   que os pegasse morreria no primeiro patch. */
const RE_COLCHETE = /\[(PREENCHER|FILL|FILL_ME|PLACEHOLDER|TODO|FIXME|XXX)\b[^\]]{0,30}\]/i;

/* `TODO:` e `FIXME:` soltos, e AQUI A CAIXA ALTA É OBRIGATÓRIA — decisão de
   calibração, não descuido. Em português `todo` é palavra comum ("enviado para
   todo: cliente"), então `/todo:/i` reprovaria texto legítimo. Modelo escreve
   marcador em caixa alta de forma esmagadora; a caixa baixa fica de fora e essa é
   a brecha conhecida deste arquivo. */
const RE_TODO = /\b(TODO|FIXME|HACK)\s*:/;

/* Reticências entre sinais de menor/maior: `<...>`, `<…>`. Sem ambiguidade
   nenhuma — nada de markup se parece com isso. */
const RE_RETICENCIA = /<\s*(\.\.\.|…)\s*>/;

/* ─────────────────────────────────── o `<...>`, que é o perigoso ─────────── */

/* Esta é a parte que pode destruir o portão por falso positivo, então ela é
 * construída ao contrário das outras: em vez de descrever o que É placeholder,
 * descreve tudo que NÃO É e reprova o resto.
 *
 * O que legitimamente vive entre `<` e `>` dentro de um parâmetro n8n:
 *   - HTML num corpo de e-mail ou num `Set`: `<br>`, `<p>`, `<a href="x">`;
 *   - XML num corpo de `httpRequest`: `<pedido><id>1</id></pedido>`;
 *   - tags de seção num system prompt de agente: `<exemplo>…</exemplo>` — e o
 *     system prompt do agente vivo desta instância tem 71.705 caracteres, então
 *     este caso não é hipotético;
 *   - comparação numa expressão: `{{ $json.total < 5 }}`.
 */

/* Nome de tag conhecido não é placeholder. A lista é o atalho barato; quem faz o
   trabalho pesado é a regra do fechamento logo abaixo. */
const TAGS_HTML = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "center", "cite", "code", "col",
  "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed", "fieldset", "figcaption", "figure", "font", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img", "input",
  "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p", "param", "picture",
  "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "section", "select", "slot",
  "small", "source", "span", "strike", "strong", "style", "sub", "summary", "sup", "table",
  "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track",
  "u", "ul", "var", "video", "wbr"
]);

const RE_ANGULO = /<([^<>\n]{1,60})>/g;

/* Um placeholder NUNCA é fechado. `<pedido>` com `</pedido>` na mesma string é XML;
   `<exemplo>` com `</exemplo>` é seção de prompt. Essa única regra é o que salva o
   corpo XML e o system prompt de agente, que são os dois falsos positivos capazes
   de fazer alguém desligar o portão. */
function temFechamento(texto, nome) {
  if (!nome) return false;
  return texto.includes("</" + nome + ">") || texto.includes("</" + nome + " ");
}

function ehPlaceholderAngulo(texto, dentro) {
  const cru = String(dentro);

  /* Comentário, doctype e instrução de processamento são markup por construção. */
  if (/^[!?]/.test(cru)) return false;

  /* Tag de fechamento nunca é um campo a preencher. */
  if (/^\//.test(cru)) return false;

  /* Sem letra nenhuma não há o que preencher: `<5>`, `<=`, `<->`. */
  if (!/[A-Za-zÀ-ÿ]/.test(cru)) return false;

  /* NÃO EXISTE aqui uma regra contra comparação (`{{ x<y && z>w }}`), contra
     operador, nem contra metacaractere de regex. Existiram, e foram removidas
     depois que o mutation test provou as três MORTAS: com a inversão de alta
     confiança lá embaixo, o operando de uma comparação e o corpo de um regex já
     não passam por serem palavra em caixa baixa sem separador. Uma delas era pior
     que morta — a regra do espaço colado descartava `< SEU_CANAL >` com padding,
     que é marcador de verdade. Regra que nenhum teste consegue matar parece
     sustentar peso e não sustenta. */

  const nome = (cru.match(/^([A-Za-z][\w:.-]*)/) || [])[1] || "";

  /* Atributo com valor entre aspas é markup, e nenhum placeholder tem isso. */
  if (nome && /=\s*["']/.test(cru)) return false;

  /* Tag conhecida, com ou sem barra de auto-fechamento: `<br>`, `<br/>`, `<BR>`. */
  if (nome && TAGS_HTML.has(nome.toLowerCase())) return false;

  /* Fechada em algum lugar da mesma string: é markup inventado, não buraco. */
  if (nome && temFechamento(texto, nome)) return false;

  /* DAQUI PARA BAIXO A REGRA É AO CONTRÁRIO: em vez de reprovar tudo que sobrou,
   * só reprova FORMA DE ALTA CONFIANÇA. A inversão foi medida, não escolhida —
   * varrendo 3.649 nós de 32 fluxos de produção, a versão "reprova o que sobrou"
   * deu 4 marcadores distintos e 3 eram falso positivo:
   *
   *   `<break>`  — tag SSML CITADA em prosa num system prompt ("NUNCA use <break>")
   *   `<verbatim of what the lead asked>` — template de instrução dentro do prompt
   *   `<\/(p|div|li)>` — o regex acima
   *
   * Um portão com 75% de falso positivo não é um portão: é uma tela que ensina a
   * clicar em ignorar. O preço da inversão é declarado — `<canal>`, palavra única
   * em caixa baixa, deixa de ser pega. Quem cobre esse caso é o `[PREENCHER]`, que
   * é a forma que o prompt pede e a que o modelo escreve. */
  const limpo = cru.replace(/\/$/, "").trim();

  /* `<SEU_CANAL>`, `<TABLE_ID>`, `<ID DO EVENTO>` — caixa alta é marcador por
     convenção universal, e nenhuma tag real desta instância é assim. */
  if (/^[A-Z][A-Z0-9_ ]*$/.test(limpo)) return true;

  /* `<seu-canal>`, `<table_id>` — separador é o que distingue um slug de campo de
     um nome de tag, que nunca leva `_` e raramente leva `-`. */
  if (/^\w+([_-]\w+)+$/.test(limpo)) return true;

  /* `<nome da tabela>` — frase com palavra de preenchimento. A lista é curta de
     propósito: cada palavra a mais é uma chance de pegar prosa legítima, e o
     `<verbatim of what the lead asked>` medido acima não casa com nenhuma. */
  if (/\b(seu|sua|seus|suas|aqui|insira|coloque|preencha|informe|escolha|nome|do|da|de|dos|das|your|here|fill)\b/i.test(limpo)) return true;

  return false;
}

/* ──────────────────────────────────────────── a varredura recursiva ──────── */

/* Tetos. Um nó de agente carrega parâmetro aninhado fundo e string de dezenas de
   milhares de caracteres; sem teto, um patch patológico faria o portão custar mais
   que a rodada que ele julga. Os dois estouros são reportados como fato — um
   portão que desistiu em silêncio é pior que um portão que não existe, porque a
   tela fica verde do mesmo jeito. */
const PROF_MAX = 14;
const STRINGS_MAX = 4000;
const TRECHO = 90;

/* O caminho é montado com `.` para chave e `[i]` para índice, que é como o próprio
   n8n nomeia campo na interface — `parameters.columns.value[0].name`. A recusa
   precisa disso: "algum campo tem placeholder" faz o modelo reescrever o documento
   inteiro e errar de novo, e foi por isso que `applyPatch` já nomeia o campo. */
function varrer(valor, caminho, achados, estado) {
  if (achados.length >= 40) return;
  if (estado.strings >= STRINGS_MAX) { estado.estourou = true; return; }
  if (estado.prof > PROF_MAX) { estado.fundo = true; return; }

  if (typeof valor === "string") {
    estado.strings++;
    const m = marcadorEm(valor);
    if (m) achados.push({ caminho, marcador: m.marcador, trecho: m.trecho });
    return;
  }
  if (!valor || typeof valor !== "object") return;

  estado.prof++;
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) varrer(valor[i], caminho + "[" + i + "]", achados, estado);
  } else {
    for (const [k, v] of Object.entries(valor)) {
      varrer(v, caminho ? caminho + "." + k : k, achados, estado);
    }
  }
  estado.prof--;
}

/* O primeiro marcador de uma string, com o trecho em volta. Devolve o primeiro e
   para: a recusa quer o suficiente para o modelo achar o lugar, e listar sete
   ocorrências do mesmo campo enterra os outros campos. */
function marcadorEm(texto) {
  const s = String(texto);

  const c = s.match(RE_COLCHETE);
  if (c) return { marcador: c[0].slice(0, 40), trecho: aoRedor(s, c.index) };

  const r = s.match(RE_RETICENCIA);
  if (r) return { marcador: r[0].slice(0, 40), trecho: aoRedor(s, r.index) };

  const t = s.match(RE_TODO);
  if (t) return { marcador: t[0].slice(0, 40), trecho: aoRedor(s, t.index) };

  RE_ANGULO.lastIndex = 0;
  let m;
  while ((m = RE_ANGULO.exec(s))) {
    if (ehPlaceholderAngulo(s, m[1])) return { marcador: m[0].slice(0, 40), trecho: aoRedor(s, m.index) };
  }
  return null;
}

/* O trecho é CORTADO sempre. Um system prompt de 71.705 caracteres não pode viajar
   inteiro dentro de uma mensagem de erro que vai para dentro de outro prompt — é a
   mesma conta de `PROMPT_MAX` que já derrubou uma rodada com `ENAMETOOLONG`. */
function aoRedor(s, i) {
  const ini = Math.max(0, i - 25);
  const fim = Math.min(s.length, i + TRECHO - 25);
  return (ini > 0 ? "…" : "") + s.slice(ini, fim).replace(/\s+/g, " ") + (fim < s.length ? "…" : "");
}

/* ──────────────────────────────────────────────────────── o portão ───────── */

/* Chaves que `applyPatch` copia num nó novo. Varrer só `parameters` deixaria passar
   um nó chamado `[PREENCHER]`, que entra no documento e vira nome de verdade. */
const CHAVES_ADD = ["name", "type", "parameters", "notes", "onError"];

/* `portaPreencher(patch)` → `{ ok, achados, erros }`.
 *
 * `achados` são fatos (nó, verbo, caminho, marcador, trecho). `erros` são as frases
 * que voltam para o modelo — uma por achado, nomeando nó e caminho.
 *
 * `rewire` NÃO É VARRIDO, e isto é decisão, não esquecimento: ele só carrega
 * `connections`, que é topologia — nome de nó de origem e de destino, porta e
 * ramo. Não existe parâmetro ali para alguém deixar por preencher, e um destino
 * que não resolve já é reprovado pelo portão de conexões do `claude-fix.js`.
 */
function portaPreencher(patch) {
  const achados = [];
  const estado = { prof: 0, strings: 0, estourou: false, fundo: false };

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: true, achados: [], erros: [], vazio: true };
  }

  /* `updateNodes` escreve QUALQUER chave de `ALLOWED_NODE_KEYS` direto no nó
     (`n[k] = v` em `applyPatch`), então olhar só `parameters` deixaria `notes`
     passar — e `notes` vai escrito para produção igual ao resto. */
  for (const u of Array.isArray(patch.updateNodes) ? patch.updateNodes : []) {
    if (!u || typeof u !== "object") continue;
    const no = String(u.name || "«sem nome»");
    for (const [k, v] of Object.entries(u)) {
      if (k === "name") continue;
      const antes = achados.length;
      varrer(v, k, achados, estado);
      for (let i = antes; i < achados.length; i++) { achados[i].no = no; achados[i].verbo = "updateNodes"; }
    }
  }

  for (const a of Array.isArray(patch.addNodes) ? patch.addNodes : []) {
    if (!a || typeof a !== "object") continue;
    const no = String(a.name || "«sem nome»");
    for (const k of CHAVES_ADD) {
      if (!(k in a)) continue;
      const antes = achados.length;
      varrer(a[k], k, achados, estado);
      for (let i = antes; i < achados.length; i++) { achados[i].no = no; achados[i].verbo = "addNodes"; }
    }
  }

  const erros = achados.map(a =>
    'o nó "' + a.no + '" tem um marcador de preencher em `' + a.caminho + '`: ' + a.marcador
    + ' — em "' + a.trecho + '". Este patch vai escrito para dentro de um fluxo em produção, '
    + "então o campo tem que ir com o valor de verdade. Se você não sabe qual é, "
    + 'responda com `tipo: "resposta"` e pergunte em vez de deixar o marcador.'
  );

  /* Estouro de teto vira aviso, nunca aprovação silenciosa: o portão não terminou
     de olhar, e dizer isso é a diferença entre "não achei" e "não procurei". */
  const avisos = [];
  if (estado.estourou) avisos.push("parei de varrer em " + STRINGS_MAX + " strings — este patch é grande demais para eu afirmar que está limpo");
  if (estado.fundo) avisos.push("parei de descer em " + PROF_MAX + " níveis de aninhamento — pode haver marcador mais fundo");

  return { ok: !achados.length, achados, erros, avisos };
}

module.exports = {
  portaPreencher,
  // exportados para teste, e para quem for calibrar os falsos positivos
  marcadorEm, ehPlaceholderAngulo, TAGS_HTML,
  PROF_MAX, STRINGS_MAX
};
