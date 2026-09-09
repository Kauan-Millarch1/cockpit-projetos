/* tutorial.js — o vídeo "como usar esta tela", servido às páginas que o têm.
 *
 * ARQUIVO SERVIDO, e isso é a decisão que este arquivo existe para tomar. A
 * faixa e o player nasceram dentro do `upgrade.html`, já parametrizados por um
 * `TUT_SLUG` no topo — ou seja quem os escreveu previu reuso. Quando o Fluxos e
 * o Tester pediram o mesmo botão, havia dois caminhos: copiar o bloco (a QUINTA
 * cópia desta base — topbar, `.aviso` e modo gravação já são três, e uma delas
 * produziu um `Illegal return statement` no `flows.html` porque alguém INSERIU
 * onde devia SUBSTITUIR, erro que mata a página inteira apontando para nada), ou
 * seguir o precedente do `aba.js` e do `entradas.js`: um arquivo servido. É o
 * segundo.
 *
 * O CSS VEM JUNTO. Ele não pode ficar nas páginas: seriam três folhas para um
 * desenho, e a que divergisse seria a que ninguém olhou. `injetarCSS()` põe o
 * bloco uma vez por documento, marcado por id, e o id é o que faz a segunda
 * chamada não fazer nada. Mesma mecânica do `entradas.js`, copiada e não
 * inventada.
 *
 * O ESTADO É DAQUI, e essa é a única diferença de fundo em relação ao
 * `entradas.js` (que guarda no `estado` da página). Ali o estado é o rascunho e
 * os anexos, que a página inteira consulta; aqui é a resposta do ledger, o
 * player aberto e o "já vi" — três coisas que nada fora deste arquivo lê. Fora
 * do DOM, porque `render()` reescreve a tela a cada evento do SSE, e fora do `S`
 * da página, porque três páginas declarando os mesmos três campos é a mesma
 * divergência que este arquivo existe para não ter.
 *
 * O QUE ELE NÃO SABE, e portanto chega por `configurar()`: o slug, como se chama
 * a API, como a página repinta, quais são os três marcos DESTE vídeo e como
 * termina a frase do convite. Onde a faixa entra é da página também — ela recebe
 * HTML (`hero()`, `mini()`, `tira()`) e escolhe o lugar.
 *
 * ELE NÃO PEDE `avisar`, e isso é deliberado apesar de as outras peças
 * compartilhadas pedirem: falhar em LER o ledger é problema nosso, não do vídeo,
 * e a decisão documentada em `carregar()` é NÃO levantar aviso — a causa fica no
 * console. Pedir uma dependência que ninguém usa seria uma mentira no contrato
 * do `configurar`.
 *
 * CARREGA EM NODE também, sem DOM: aí não injeta nada e as decisões puras
 * (`estadoDe`, `tempo`, `TECLAS`) seguem exportadas, que é o que
 * `tutorial-test.js` prova. Regra que decide se um convite aparece tem de ser
 * testável sem navegador. O `localStorage` é lido através da `janela`, então um
 * teste que queira exercitar o "já vi" põe `global.window = { localStorage: … }`
 * antes do `require`.
 */

(function (raiz, fabrica) {
  "use strict";
  const api = fabrica();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.__tutorial = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const temDOM = typeof document !== "undefined" && !!document.createElement;
  const doc = temDOM ? document : null;
  const janela = typeof window !== "undefined" ? window : null;

  /* `esc` é definido AQUI e não injetado, pela mesma razão do `entradas.js`: ele
     é uma linha, não é julgamento, e o `flows.html` não tem um. */
  const esc = s => String(s == null ? "" : s)
    .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ═══════════════════════════════════════════════════════ o que a página dá ══ */

  let cfg = null;

  /* `marcos` são os três marcos DO VÍDEO daquela aba, na ordem em que aparecem
     nele — o que decide se vale clicar. Sem eles a terceira coluna simplesmente
     não é desenhada; ela existe porque a faixa é larga e a 1600px metade dela
     ficava vazia, o que lê como peça inacabada.
     `cauda` é o FIM da frase do convite, e é fragmento de propósito: a frase
     inteira mora aqui, numa definição só, e cada aba diz apenas onde ela
     termina. Três páginas montando a frase inteira é a divergência de sempre. */
  function configurar(c) {
    if (!c || !c.slug || typeof c.callApi !== "function" || typeof c.render !== "function") {
      throw new Error("tutorial.configurar precisa de { slug, callApi, render }");
    }
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(c.slug)) {
      throw new Error("tutorial.configurar: slug inválido: " + c.slug);
    }
    cfg = {
      slug: c.slug,
      callApi: c.callApi,
      render: c.render,
      /* O nome da aba, para o rótulo de leitor de tela da miniatura. Derivar do
         slug daria "Upgrade"/"Fluxos"/"Tester" corretamente hoje e erraria no
         primeiro slug composto, então ele é explícito com o derivado só como
         último recurso. */
      aba: c.aba || (c.slug.charAt(0).toUpperCase() + c.slug.slice(1)),
      marcos: Array.isArray(c.marcos) ? c.marcos.slice(0, 3) : [],
      cauda: c.cauda || ""
    };
    injetarCSS();
    return api;
  }
  const exigir = () => {
    if (!cfg) throw new Error("tutorial.js: a página não chamou `configurar()` — sem slug não há tutorial que pedir");
    return cfg;
  };

  /* ════════════════════════════════════════════════════════════════ o CSS ════
   *
   * Duas peças: a FAIXA de convite e o PLAYER.
   *
   * A faixa é deliberadamente grande. O pedido foi literal — "não pode ser um
   * botão tão discreto" — e a razão é a mesma que o `flows.html` já escreveu
   * sobre o teto de seis KPIs: o que é discreto vira papel de parede e passa a
   * ser ignorado em duas semanas. Só que a recíproca também vale, e por isso a
   * faixa TEM uma porta de saída: quem já viu esconde, e o que fica é o
   * `.tut-mini` — a mesma decisão da lixeira do Tester, cuja porta está sempre
   * visível mesmo vazia.
   *
   * O PLAYER É `z-index: 48`. A camada declarada do `upgrade.html`, do mais à
   * frente para o mais atrás: 50 o `.scrim` do `confirmar()`, **48 o player**,
   * 47 o visor de anexo, 46 a telinha do dossiê, 45 o seletor, 40 o overlay da
   * verificação. O `.scrim` continua na frente porque é ele que decide um gasto,
   * e um vídeo por cima do botão que confirma dinheiro seria a pior sobreposição
   * possível. Nas outras duas páginas o 48 continua valendo por baixo do
   * `.scrim`/`.hoff-scrim` delas, que são os únicos véus mais à frente que
   * existem em cada uma.
   *
   * NENHUM BRILHO COLORIDO. Elevação é sombra neutra e `--accent` é movimento —
   * a regra da casa, e um player é justamente onde se tenta um halo azul.
   *
   * SEM ACENTO E SEM BACKTICK NOS COMENTÁRIOS DAQUI PARA BAIXO, dentro da
   * template string: um backtick FECHA o literal, e o erro que o Node imprime é
   * `SyntaxError: Invalid left-hand side expression in postfix operation`
   * apontando para a linha do `const CSS =`, que não é nem perto do problema.
   * Armadilha já paga pelo `entradas.js`. */
  const CSS_ID = "tutorial-css";
  const CSS = `
/* -- a faixa de convite -- */
.tut-hero {
  display: grid; grid-template-columns: 272px minmax(0, 1fr) auto; gap: 18px; align-items: center;
  margin: 0 0 20px; padding: 14px; border-radius: 16px;
  border: 1px solid var(--accent-line); background: var(--accent-soft);
  position: relative; overflow: hidden;
  /* A FAIXA DECLARA O PROPRIO ALINHAMENTO, e isto e conserto de um defeito visto
     no print: dentro do '.open-in' do /tester, que e 'text-align: center', ela
     HERDAVA centro — titulo, frase e olho centralizados — enquanto nas outras duas
     telas ela e a esquerda. Um componente com duas aparencias por heranca e a
     divergencia que este arquivo existe para nao ter, e ninguem decidiu aquilo:
     ela so pegou o alinhamento do pai. A esquerda e o desenho — poster a esquerda,
     texto a direita, marcos em lista — e texto centralizado ao lado de um poster
     deixa as duas bordas irregulares e o olho sem onde comecar. */
  text-align: left;
}
/* O brilho diagonal do 'texture-card', o mesmo dos paineis: da volume sem gastar
   cor. 'pointer-events:none' porque ele cobre a faixa inteira. */
.tut-hero::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: linear-gradient(115deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 42%);
}
.tut-thumb {
  position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0;
  border: 1px solid var(--line); border-radius: 11px; overflow: hidden; cursor: pointer;
  background: var(--bg-deep);
  box-shadow: rgba(10,10,20,.05) 0 1px 2px, rgba(10,10,20,.30) 0 14px 30px -24px;
}
.tut-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* O disco de play sobre o poster. 'backdrop-filter' em vez de fundo opaco: o
   quadro por baixo continua legivel, e e ele que diz de que tela e o video. */
.tut-thumb .pl {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: rgba(6,6,11,.16); transition: background .18s ease;
}
.tut-thumb:hover .pl, .tut-thumb:focus-visible .pl { background: rgba(6,6,11,.30); }
.tut-thumb .pl i {
  width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,255,255,.90); backdrop-filter: blur(6px);
  border: 1px solid rgba(10,10,20,.16);
  box-shadow: rgba(10,10,20,.28) 0 8px 22px -10px;
  transition: transform .2s cubic-bezier(.2,.9,.25,1);
}
.tut-thumb:hover .pl i, .tut-thumb:focus-visible .pl i { transform: scale(1.07); }
.tut-thumb .pl svg { width: 22px; height: 22px; margin-left: 3px; fill: #14151C; }
/* A duracao no canto do poster, no vocabulario de numero desta casa. */
.tut-thumb .dur {
  position: absolute; right: 7px; bottom: 7px; padding: 2px 7px; border-radius: 6px;
  font-family: var(--font-num); font-size: 10.5px; color: #fff;
  background: rgba(6,6,11,.72);
}
.tut-txt { min-width: 0; }
.tut-eyebrow {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-num); font-size: 10px; letter-spacing: .11em; text-transform: uppercase;
  color: var(--accent-txt); margin: 0 0 8px;
}
/* O ponto que pulsa. E 'transform'/'opacity' e nada mais: a regra desta casa e
   que animacao PERMANENTE so toca essas duas — um 'box-shadow' animado custou
   19% de CPU num ponto de 7px, medido. */
.tut-eyebrow .dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  position: relative; flex: 0 0 auto;
}
.tut-eyebrow .dot::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; z-index: -1;
  background: var(--accent); opacity: .34;
  animation: tutpulse 2.4s ease-out infinite;
}
@keyframes tutpulse {
  0% { transform: scale(1); opacity: .34; }
  70%, 100% { transform: scale(3.3); opacity: 0; }
}
/* "h2" e nao "h3" — SEM CRASE: este bloco e um template literal, e uma crase
   aqui dentro FECHA a string. A faixa entra logo depois do h1 do wordmark nas
   tres paginas que a servem, e um h3 ali pula um nivel na arvore. */
.tut-txt h3, .tut-txt h2 { margin: 0 0 5px; font-size: 18px; line-height: 1.25; color: var(--txt); font-weight: 600; }
.tut-txt p { margin: 0 0 11px; font-size: 13px; line-height: 1.5; color: var(--txt-dim); max-width: 62ch; }
.tut-acts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tut-acts .btn.pri { height: 38px; padding: 0 18px; font-size: 12.5px; }
/* O LINK DE ESCONDER: 12px, e o '--txt-faint' cru REPROVA o AA. Medido nas tres
   telas e nos dois temas, com a faixa na tela: 4,4216 no /tester claro, porque ali
   o '--accent-soft' da faixa compoe sobre o '--bg-deep' do '.stage-open' e nao
   sobre a '--surface' das outras duas. E a regra que esta casa ja escreveu: um
   token de texto tem de passar em TODA superficie onde cai, nao na mais facil — e
   este mesmo link passa a 4,6532 no /upgrade, que e por que o defeito so apareceu
   quando a faixa chegou na terceira tela.
   O mix a 80% mede 5,7081 no pior caso, e a 80 e nao a 55 porque este link tem de
   continuar sendo a coisa mais QUIETA da faixa: '--txt-dim' daria 8,0792, o mesmo
   do paragrafo do convite, e ai a saida competiria com o convite.
   SEM BACKTICK AQUI: este bloco e uma template string, e um backtick a fecha — o
   erro que o Node imprime aponta para a linha do const CSS, longe do problema. */
.tut-acts .lk {
  background: none; border: 0; padding: 4px 2px; cursor: pointer;
  font-family: var(--font); font-size: 12px;
  color: color-mix(in srgb, var(--txt-faint) 80%, var(--txt));
  text-decoration: underline; text-underline-offset: 3px;
}
.tut-acts .lk:hover { color: var(--txt-dim); }

/* Os tres marcos do video, na coluna da direita. Numerados por 'counter' e nao
   por glifo digitado: a lista tem tres itens hoje e o numero nao pode ser uma
   coisa que alguem esqueca de corrigir ao mexer nela. */
.tut-marcos {
  list-style: none; margin: 0; padding: 0 4px 0 16px; max-width: 330px;
  border-left: 1px solid var(--accent-line);
  counter-reset: marco;
}
.tut-marcos li {
  position: relative; padding-left: 24px; font-size: 12px; line-height: 1.45;
  color: var(--txt-dim);
}
.tut-marcos li + li { margin-top: 10px; }
.tut-marcos li::before {
  counter-increment: marco; content: counter(marco);
  position: absolute; left: 0; top: 0;
  width: 17px; height: 17px; border-radius: 50%;
  display: grid; place-items: center;
  font-family: var(--font-num); font-size: 9.5px;
  color: var(--accent-txt); background: var(--surface);
  border: 1px solid var(--accent-line);
}
/* O verbo em bloco proprio: ele e o que se le varrendo os olhos, e a explicacao
   e o que se le depois de decidir olhar. */
.tut-marcos b { display: block; color: var(--txt); font-weight: 600; }

/* O botao pequeno que sobra quando a faixa e escondida. Uma porta que so existe
   enquanto ninguem a usou e uma porta que ninguem acha depois. */
.tut-mini { flex: 0 0 auto; }
/* A TIRA DA PORTA, para as paginas que nao tem cabecalho onde encaixar o botao
   pequeno. Ver a nota de 'mini()': nelas a porta fica no MESMO lugar de onde a
   faixa saiu, entao nao ha nada a descobrir e ela pode nascer depois. */
.tut-tira { display: flex; justify-content: flex-end; margin: 0 0 16px; }

/* -- o player -- */
.tut-scrim {
  position: fixed; inset: 0; z-index: 48; display: grid; place-items: center; padding: 26px;
  background: color-mix(in srgb, var(--bg-deep) 72%, transparent);
  backdrop-filter: blur(9px);
  animation: tutfade .2s ease both;
}
@keyframes tutfade { from { opacity: 0 } to { opacity: 1 } }
.tut {
  width: min(1180px, 100%); max-height: calc(100vh - 52px);
  display: flex; flex-direction: column; min-height: 0;
  background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
  overflow: hidden;
  box-shadow: rgba(10,10,20,.34) 0 40px 90px -40px, rgba(10,10,20,.18) 0 8px 20px -12px;
  /* A CAIXA NASCE NO RETANGULO DO BOTAO e cresce ate aqui — a receita do
     'dynamic-island' que o handoff do 'flows.html' ja usa. A transformacao e
     feita em JS (WAAPI) porque so la se conhece o rect de origem. */
  transform-origin: center;
}
.tut-hd {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.tut-hd .ix { font-family: var(--font-num); font-size: 9.5px; letter-spacing: .07em; color: var(--brand-txt); }
.tut-hd .tt { font-size: 13px; font-weight: 600; color: var(--txt); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tut-hd .sb { font-size: 11.5px; color: var(--txt-faint); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tut-hd .x { margin-left: auto; flex: 0 0 auto; }

/* O palco do video. Preto e nao '--surface': um video com barra clara em volta
   muda o brilho aparente do proprio video. */
.tut-palco {
  position: relative; background: #06060B; flex: 1 1 auto; min-height: 0;
  display: grid; place-items: center;
}
.tut-palco video { width: 100%; height: 100%; max-height: calc(100vh - 220px); display: block; object-fit: contain; }

/* O AVISO DE SOM. Ele existe porque o navegador PROIBE comecar com audio sem um
   gesto: o video abre no mudo, e sem este cartaz a pessoa assiste ao tutorial
   inteiro sem saber que havia narracao. E grande de proposito, e sai no primeiro
   clique — em qualquer lugar dele. */
.tut-som {
  position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer;
  border: 0; padding: 0; background: rgba(6,6,11,.30); backdrop-filter: blur(2px);
}
.tut-som .cx {
  display: flex; align-items: center; gap: 11px; padding: 13px 20px 13px 15px;
  border-radius: 999px; background: rgba(255,255,255,.94);
  border: 1px solid rgba(10,10,20,.14);
  box-shadow: rgba(10,10,20,.34) 0 14px 34px -14px;
  animation: tutsom 2.8s ease-in-out infinite;
}
.tut-som svg { width: 24px; height: 24px; flex: 0 0 auto; stroke: #14151C; fill: none;
  stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.tut-som b { font-size: 13.5px; color: #14151C; display: block; }
.tut-som span { font-size: 11.5px; color: #4A4E5A; display: block; margin-top: 1px; }
@keyframes tutsom {
  0%, 100% { transform: translateY(0) }
  50% { transform: translateY(-4px) }
}

/* O play central, quando pausado. */
.tut-mid {
  position: absolute; inset: 0; display: grid; place-items: center; border: 0; padding: 0;
  background: rgba(6,6,11,.22); cursor: pointer;
}
.tut-mid i {
  width: 66px; height: 66px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,255,255,.92); border: 1px solid rgba(10,10,20,.14);
  box-shadow: rgba(10,10,20,.30) 0 10px 26px -12px;
  transition: transform .18s cubic-bezier(.2,.9,.25,1);
}
.tut-mid:hover i { transform: scale(1.06); }
.tut-mid svg { width: 25px; height: 25px; margin-left: 3px; fill: #14151C; }

/* '[hidden]' PRECISA SER DITO AQUI, e este e o defeito que o navegador achou e
   que nenhum teste de fonte acharia. O atributo 'hidden' vale por uma regra de
   folha de estilo do proprio navegador ('[hidden] { display: none }'), e
   QUALQUER regra de autor que declare 'display' a vence — as duas de cima
   declaram 'display: grid'. O sintoma medido: com o video ja sem mudo,
   'som.hidden = true' era obedecido pelo DOM e ignorado pela tela, entao o
   cartaz de som ficava por cima do video para sempre, comendo todos os cliques.
   O '.tut-mid' fazia o mesmo tocando, e como ele e 'inset: 0', era ele quem
   recebia o clique que ia para o cartaz. */
.tut-som[hidden], .tut-mid[hidden] { display: none; }

/* -- a barra de controles -- */
.tut-ctl {
  flex: 0 0 auto; padding: 10px 14px 12px; background: var(--surface);
  border-top: 1px solid var(--line-soft);
  display: flex; flex-direction: column; gap: 9px;
}
/* A trilha. 'height' pequena com uma area de clique grande por cima: a barra
   fina e o que se quer ver, e 16px e o que se quer acertar com o mouse. */
.tut-trilha { position: relative; height: 16px; cursor: pointer; display: flex; align-items: center; }
.tut-trilha .fundo { position: absolute; left: 0; right: 0; height: 5px; border-radius: 999px;
  background: color-mix(in srgb, var(--txt) 13%, transparent); }
.tut-trilha .buf { position: absolute; left: 0; height: 5px; border-radius: 999px;
  background: color-mix(in srgb, var(--txt) 20%, transparent); width: 0; }
.tut-trilha .pos { position: absolute; left: 0; height: 5px; border-radius: 999px;
  background: var(--accent); width: 0; }
.tut-trilha .bolha {
  position: absolute; left: 0; width: 13px; height: 13px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--surface); transform: translateX(-50%);
  box-shadow: rgba(10,10,20,.28) 0 2px 6px -1px;
  transition: transform .14s ease;
}
.tut-trilha:hover .bolha, .tut-trilha:focus-visible .bolha { transform: translateX(-50%) scale(1.22); }
.tut-trilha:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 999px; }

.tut-linha { display: flex; align-items: center; gap: 6px; }
.tut-b {
  height: 34px; min-width: 34px; padding: 0 9px; display: inline-flex; align-items: center;
  justify-content: center; gap: 6px; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: 9px;
  color: var(--txt-dim); font-family: var(--font); font-size: 12px;
}
.tut-b:hover { background: var(--surface-2); border-color: var(--line); color: var(--txt); }
.tut-b svg { width: 17px; height: 17px; fill: none; stroke: currentColor;
  stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.tut-b.play svg { fill: currentColor; stroke: none; }
/* 'color-mix(... 72%, var(--txt))' e NAO '--accent-txt' cru: medido no tema
   escuro, o accent puro sobre o '--accent-soft' composto da **4,0397** —
   reprova o AA a 12px. E a mesma receita que o '.aviso' e a banda do dossie
   desta casa ja usam, e a mesma armadilha: as cores de accent e de status foram
   calibradas como PREENCHIMENTO, onde nao ha piso de contraste. Depois: 5,4+
   nos dois temas. A BORDA E O FUNDO NAO MUDAM — eles sao preenchimento, e e ali
   que o accent tem de continuar reconhecivel. */
.tut-b.mudo {
  color: color-mix(in srgb, var(--accent-txt) 72%, var(--txt));
  border-color: var(--accent-line); background: var(--accent-soft);
}
.tut-tempo { font-family: var(--font-num); font-size: 11.5px; color: var(--txt-faint);
  font-variant-numeric: tabular-nums; margin-left: 4px; }
.tut-tempo b { color: var(--txt-dim); font-weight: 500; }
.tut-esp { margin-left: auto; }
.tut-ft { padding: 0 14px 12px; font-size: 11px; line-height: 1.5; color: var(--txt-faint); }

@media (prefers-reduced-motion: reduce) {
  /* O ESTADO FICA, o movimento sai. Nada aqui carrega informacao na animacao: o
     ponto continua accent, o cartaz de som continua na tela, a barra continua
     andando — o que para e o pulso, o balanco e a abertura da caixa. */
  .tut-eyebrow .dot::after { animation: none; opacity: 0; }
  .tut-som .cx { animation: none; }
  .tut-scrim { animation-duration: 1ms; }
  .tut-thumb .pl i, .tut-mid i, .tut-trilha .bolha { transition: none; }
}

@media (max-width: 1200px) {
  /* Os tres marcos saem primeiro, e antes do poster: a 1200px a faixa ja nao tem
     largura para tres colunas, e entre perder a lista e apertar a frase que
     convida, some a lista — ela e o detalhe, a frase e o convite. */
  .tut-hero { grid-template-columns: 272px minmax(0, 1fr); }
  .tut-marcos { display: none; }
}
@media (max-width: 860px) {
  /* Ai o poster vira topo em vez de coluna: 272px de miniatura mais texto nao
     cabem lado a lado, e cortar o texto seria perder a frase que convida. */
  .tut-hero { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .tut-palco video { max-height: 46vh; }
  .tut-hd .sb { display: none; }
}
`;
  function injetarCSS() {
    if (!temDOM || doc.getElementById(CSS_ID)) return false;
    const el = doc.createElement("style");
    el.id = CSS_ID;
    el.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(el);
    return true;
  }

  /* ═══════════════════════════════ O JUÍZO ═══════════════════════════════════
   *
   * O servidor manda FATO (`GET /api/tutorial`): o que o ledger declara e o que
   * o `stat` confirma. Se isso vira convite, botão pequeno ou nada é decisão
   * daqui.
   *
   * TRÊS ESTADOS, e é a nona vez que este projeto escreve esta regra. A resposta
   * ausente é **ainda não chegou** — não é "não existe tutorial". Cair no galho
   * negativo aqui faria a tela dizer que o vídeo não está lá durante os ~200ms
   * do boot, e a frase apareceria e desapareceria: o segundo salto é o que lê
   * como defeito. Enquanto não chega, não se desenha nada.
   *
   * O QUARTO ESTADO É O QUE MAIS IMPORTA E É FÁCIL DE PERDER: o ledger existe e
   * o `.mp4` NÃO. `tutoriais/` é versionado de propósito (medido — cabe no git),
   * mas um `git clean` agressivo ou um checkout parcial deixa o ledger sem o
   * arquivo. Aí o convite não pode aparecer: um play que não toca é pior que a
   * ausência do botão, porque a pessoa conclui que o painel está quebrado.
   *
   * PURA, e recebendo a resposta em vez de lê-la do estado: é o que faz os
   * quatro estados testáveis sem navegador e sem rede, a mesma razão de
   * `resolverAlvo` e de `podeConversar` serem puros. */
  function estadoDe(resposta, slug) {
    if (!resposta) return { estado: "carregando" };
    const t = (resposta.tutoriais || []).find(x => x.slug === slug);
    if (!t) return { estado: "naoRegistrado" };
    if (!t.existe) return { estado: "semArquivo", t };
    return { estado: "pronto", t };
  }

  /* JÁ VI, ESCONDE. Preferência de tela, então `localStorage` e não rota — o
     servidor emite fato, e "eu já assisti" não é fato sobre a instância. Mesma
     decisão do `cardPref` do `flows.html`.
     A CHAVE CARREGA O SLUG: esconder o tutorial do Upgrade não pode esconder o
     do Tester. E carrega uma VERSÃO — se o vídeo for reeditado, o registrador
     muda `registradoEm` e o convite volta, porque o que ela já viu foi outro
     vídeo. */
  const CHAVE = "cockpit.tut.visto.v1";
  const loja = () => {
    try { return (janela && janela.localStorage) || null; } catch { return null; }
  };
  function vistos() {
    try {
      const l = loja();
      return l ? (JSON.parse(l.getItem(CHAVE) || "{}") || {}) : {};
    } catch { return {}; }
  }
  function visto(slug, quando) {
    const v = vistos()[slug];
    /* Sem `quando` (ledger antigo, sem data) o registro vale como visto: exigir
       a data faria o convite voltar para sempre num tutorial que não a tem, o
       que é o oposto de "já vi". */
    return !!v && (!quando || v === quando);
  }
  function marcarVisto(slug, quando) {
    try {
      const l = loja();
      if (!l) return;
      const v = vistos();
      v[slug] = quando || "1";
      l.setItem(CHAVE, JSON.stringify(v));
    } catch { /* sem localStorage o convite volta, e isso é degradar para o lado seguro */ }
  }

  /* mm:ss. `Math.floor` nos dois lados e o total arredondado ANTES de dividir —
     arredondar minuto e segundo em separado imprime `1:60` para 119,995s,
     defeito que a contagem dos roteiros deste projeto já pagou. */
  function tempo(s) {
    const n = Math.max(0, Math.floor(Number(s) || 0));
    return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  }

  /* O PULO DOS BOTÕES DE AVANÇAR E RETROCEDER. Dez segundos porque é o que a
     convenção de player já ensinou (YouTube, Netflix, iOS) — e o rótulo do botão
     diz o número, então não há o que adivinhar. */
  const PULO = 10;

  /* OS ATALHOS, como DADO e não como `if` espalhado pelo handler. Assim a tabela
     é a documentação e o teste pode conferir que cada tecla prometida na tela
     existe. */
  const TECLAS = {
    " ": "play", k: "play",
    ArrowLeft: "voltar", j: "voltar",
    ArrowRight: "avancar", l: "avancar",
    m: "mudo", f: "cheia"
  };

  /* Os desenhos. Nenhum emoji: `📎` e `🗀` saem como caixa vazia nesta fonte,
     medido neste projeto, e um controle de player que virou tofu é um controle
     que não existe. Mesmo viewBox 24 e mesma espessura do resto do desenho. */
  const SVG = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7 5 12l6 5"/><path d="M19 7l-6 5 6 5"/></svg>',
    avancar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 7l6 5-6 5"/><path d="M5 7l6 5-6 5"/></svg>',
    som: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l4-3.5v13L7 15H4z"/><path d="M15.5 9.2a3.6 3.6 0 0 1 0 5.6"/><path d="M18 6.8a7 7 0 0 1 0 10.4"/></svg>',
    mudo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l4-3.5v13L7 15H4z"/><path d="M16 9.5l4 5"/><path d="M20 9.5l-4 5"/></svg>',
    cheia: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>'
  };

  /* ═══════════════════════════════ O ESTADO ══════════════════════════════════
   *
   * `resp` é a resposta do servidor (`null` = ainda não chegou, e o juízo trata
   * isso como um estado e não como ausência); `player` é o player aberto, com o
   * próprio véu, os irmãos que ele marcou `inert` e o botão que o abriu — `null`
   * é fechado, e é isso que a cadeia do Esc de cada página consulta para saber
   * de quem é aquela tecla; `escondido` é o "já vi" desta sessão, que faz a
   * faixa sair sem esperar o F5. */
  const st = { resp: null, player: null, escondido: false };

  /* Pede o que existe. UMA vez, no boot: o ledger não muda enquanto a página
     está aberta (mudar exige rodar o registrador no terminal), então um poll
     aqui gastaria requisição para confirmar o que já se sabe. */
  async function carregar() {
    const c = exigir();
    try { st.resp = await c.callApi("/api/tutorial"); }
    catch (e) {
      /* Falhar em LER o que existe é problema nosso, não do vídeo — então o
         estado fica `{tutoriais: []}` e o convite simplesmente não aparece.
         Levantar um aviso vermelho por causa de um tutorial seria acusar a
         instância de algo que não tem a ver com ela. A causa fica no console
         para quem for procurar. */
      console.warn("[tutorial] não consegui ler /api/tutorial:", e && e.message);
      st.resp = { tutoriais: [], falhou: e && e.message };
    }
    c.render();
  }

  const meu = () => estadoDe(st.resp, exigir().slug);
  const temVideo = () => meu().estado === "pronto";
  const aberto = () => !!st.player;

  /* ══════════════════════════════ A FAIXA ════════════════════════════════════
   *
   * Devolve string vazia em três dos quatro estados, e cada um por um motivo
   * diferente:
   * - `carregando`: a resposta não chegou. Desenhar e depois trocar é o salto
   *   duplo que lê como defeito.
   * - `naoRegistrado`: não há tutorial para esta tela. Nada a oferecer.
   * - `semArquivo`: o ledger promete e o disco não tem. Um play que não toca é
   *   pior que a ausência do botão.
   * - visto ou escondido: ela já assistiu. Sobra o `mini()`. */
  function hero() {
    const c = exigir();
    const d = meu();
    if (d.estado !== "pronto") return "";
    const t = d.t;
    if (st.escondido) return "";
    if (visto(c.slug, t.registradoEm)) return "";
    const poster = t.poster ? "/api/tutorial/" + c.slug + ".jpg" : "";
    /* A FRASE É DAQUI E NÃO DO LEDGER, e a razão é mecânica: o `subtitulo` do
       ledger é uma linha curta sem ponto final (ele também vai para o cabeçalho
       do player, onde ponto seria estranho), e concatená-lo com o texto seguinte
       produziu "…e decidir se aplica Em 1:49 você vê…" na tela. Uma frase
       montada com um pedaço que não sabe que virou frase é a mesma família do
       número digitado à mão: funciona até alguém editar o outro lado.
       A `cauda` é fragmento DECLARADO, e o ponto final é posto aqui — se ela
       vier com um, não se põe outro, porque `escreve..` é o mesmo defeito visto
       de perto. */
    const cauda = String(c.cauda || "").trim();
    const fim = cauda ? (/[.!?]$/.test(cauda) ? " " + cauda : " " + cauda + ".") : ".";
    return '<div class="tut-hero">'
      + '<button type="button" class="tut-thumb" data-tut="1" '
      + 'aria-label="Assistir a introdução da aba ' + esc(c.aba) + ", " + tempo(t.segundos) + '">'
      + (poster ? '<img src="' + poster + '" alt="">' : "")
      + '<span class="pl"><i>' + SVG.play + "</i></span>"
      + '<span class="dur">' + tempo(t.segundos) + "</span>"
      + "</button>"
      + '<div class="tut-txt">'
      + '<p class="tut-eyebrow"><span class="dot" aria-hidden="true"></span>Novo por aqui?</p>'
      + "<h2>" + esc(t.titulo) + "</h2>"
      + "<p>Em " + tempo(t.segundos) + " você vê o caminho inteiro desta tela," + esc(fim) + "</p>"
      + '<div class="tut-acts">'
      + '<button type="button" class="btn pri beam on" data-tut="1">'
      + '<span aria-hidden="true">▷</span> assistir a introdução</button>'
      + '<button type="button" class="lk" data-tut-esconde="1">já vi, esconder</button>'
      + "</div></div>"
      /* A TERCEIRA COLUNA EXISTE PORQUE A FAIXA É LARGA. A 1600px o texto
         ocupava metade dela e a outra metade ficava vazia — o que lê como peça
         inacabada, não como respiro. O que entra aqui não é enchimento: são os
         três marcos do próprio vídeo, na ordem em que aparecem, e é a informação
         que decide se vale clicar. Abaixo de 1200px ela sai, porque aí a largura
         acabou e a frase é que tem de sobreviver.
         Sem marcos declarados a coluna não existe: uma lista inventada aqui
         seria a mesma mentira que um rótulo de botão digitado de memória. */
      + (c.marcos.length
        ? '<ul class="tut-marcos">'
          + c.marcos.map(m => "<li><b>" + esc(m[0]) + "</b>" + esc(m[1]) + "</li>").join("")
          + "</ul>"
        : "")
      + "</div>";
  }

  /* O botão pequeno, para depois de esconder.
   *
   * NO `upgrade.html` ELE APARECE JUNTO COM A FAIXA, e nas outras duas não —
   * essa assimetria é a mesma regra aplicada, não um esquecimento. A regra é:
   * uma porta que nasce no mesmo instante em que a outra morre é uma porta que
   * ninguém vê nascer. No Upgrade o botão pequeno mora NOUTRO lugar (o cabeçalho
   * da grade), então ele precisa ser visto antes de a faixa sair; no Fluxos e no
   * Tester ele ocupa o MESMO lugar de onde a faixa saiu, e aí não há nada a
   * descobrir — a porta não se mexeu. Quem decide é a página, que escolhe onde
   * chamar. */
  function mini() {
    if (!temVideo()) return "";
    return '<button class="btn sm tut-mini" data-tut="1" title="Assistir a introdução desta tela">'
      + '<span aria-hidden="true">▷</span> tutorial</button>';
  }

  /* A tira, para as páginas que põem a porta no lugar da faixa. É `mini()` numa
     linha alinhada à direita — nada de novo, só onde. Vazia enquanto a faixa
     está na tela, porque ali a porta grande já está aberta. */
  function tira() {
    if (!temVideo()) return "";
    if (hero()) return "";
    return '<div class="tut-tira">' + mini() + "</div>";
  }

  /* ══════════════════════════════ O PLAYER ═══════════════════════════════════
   *
   * POR QUE CONTROLES PRÓPRIOS EM VEZ DO `controls` NATIVO. É a mesma razão pela
   * qual esta casa proibiu `alert()` e `confirm()`: a barra nativa é chrome do
   * navegador, chega com a fonte e a ordem de botões do sistema, é diferente em
   * cada um, e não há como fazê-la dizer "avançar 10s" nem casar com os tokens
   * da página. O preço está declarado: teclado, foco e `aria` passam a ser
   * nossos, e é por isso que a tabela de atalhos é DADO (`TECLAS`) e não `if`
   * espalhado.
   *
   * O SOM COMEÇA DESLIGADO E ISSO NÃO É ESCOLHA. O navegador bloqueia autoplay
   * com áudio sem um gesto — se o vídeo tentasse abrir com som, `play()` seria
   * recusado e a tela ficaria parada num play que não obedece. Então abre no
   * mudo, tocando, com um CARTAZ grande em cima; o primeiro clique é o gesto, e
   * ele liga o som. Sem esse cartaz a pessoa assiste ao tutorial inteiro sem
   * saber que havia narração — que é exatamente o pedido: "coloque um sinal para
   * a pessoa acionar o audio". */
  function abrir(origem) {
    const c = exigir();
    const d = meu();
    if (d.estado !== "pronto") return;
    /* Um player já aberto não abre outro: dois véus empilhados deixariam um
       `inert` para trás ao fechar o de cima. Mesma guarda do visor. */
    if (st.player) return;
    const t = d.t;

    const scrim = doc.createElement("div");
    scrim.className = "tut-scrim";
    const cx = doc.createElement("div");
    cx.className = "tut";
    cx.setAttribute("role", "dialog");
    cx.setAttribute("aria-modal", "true");
    cx.setAttribute("aria-label", "Tutorial: " + t.titulo);

    cx.innerHTML =
      '<div class="tut-hd">'
        + '<span class="ix">[ TUTORIAL ]</span>'
        + '<span class="tt">' + esc(t.titulo) + "</span>"
        + '<span class="sb">' + esc(t.subtitulo) + "</span>"
        + '<button type="button" class="btn sm x" data-tut-x="1">'
        + '<span aria-hidden="true">✕</span> fechar</button>'
      + "</div>"
      + '<div class="tut-palco">'
        + '<video playsinline preload="auto" src="/api/tutorial/' + c.slug + '.mp4"></video>'
        /* O cartaz do som. É um `<button>` de verdade e não uma `div` com
           `onclick`: ele é o controle mais importante desta tela nos primeiros
           segundos, e precisa ser alcançável por Tab e por leitor de tela. */
        + '<button type="button" class="tut-som" data-tut-som="1">'
          + '<span class="cx">' + SVG.som
          + "<span><b>O som está desligado</b>"
          + "<span>clique para ouvir a narração</span></span></span>"
        + "</button>"
        + '<button type="button" class="tut-mid" data-tut-play="1" hidden '
        + 'aria-label="Continuar"><i>' + SVG.play + "</i></button>"
      + "</div>"
      + '<div class="tut-ctl">'
        /* A TRILHA É UM `slider` DE VERDADE no `aria`: sem `role`/`valuenow`, um
           leitor de tela anuncia "botão" e não diz em que minuto o vídeo está —
           que é a única informação que a barra carrega. */
        + '<div class="tut-trilha" data-tut-trilha="1" role="slider" tabindex="0" '
        + 'aria-label="Posição no vídeo" aria-valuemin="0" aria-valuemax="'
        + Math.floor(t.segundos) + '" aria-valuenow="0" aria-valuetext="0:00">'
          + '<span class="fundo"></span><span class="buf"></span>'
          + '<span class="pos"></span><span class="bolha"></span>'
        + "</div>"
        + '<div class="tut-linha">'
          + '<button type="button" class="tut-b play" data-tut-play="1" aria-label="Pausar">'
          + SVG.pause + "</button>"
          + '<button type="button" class="tut-b" data-tut-pulo="-1" aria-label="Voltar '
          + PULO + ' segundos">' + SVG.voltar + PULO + "s</button>"
          + '<button type="button" class="tut-b" data-tut-pulo="1" aria-label="Avançar '
          + PULO + ' segundos">' + PULO + "s" + SVG.avancar + "</button>"
          + '<span class="tut-tempo"><b data-tut-agora>0:00</b> / '
          + tempo(t.segundos) + "</span>"
          + '<span class="tut-esp"></span>'
          + '<button type="button" class="tut-b mudo" data-tut-som="1" aria-label="Ligar o som">'
          + SVG.mudo + "som</button>"
          + '<button type="button" class="tut-b" data-tut-cheia="1" aria-label="Tela cheia">'
          + SVG.cheia + "</button>"
        + "</div>"
      + "</div>"
      /* O RODAPÉ DIZ O QUE O VÍDEO É, e isto não é enfeite: o tutorial foi feito
         contra dados falsos, e alguém que reconhece a tela mas não os números
         merece saber por quê antes de procurar `Agente Iago Comercial` na
         instância dele. */
      + '<div class="tut-ft">Gravado com dados de exemplo — os fluxos, os números e as '
      + "conversas do vídeo não são da sua instância. Atalhos: "
      + "<b>espaço</b> toca e pausa · <b>←</b> <b>→</b> pulam " + PULO
      + "s · <b>m</b> liga o som · <b>f</b> tela cheia · <b>Esc</b> fecha.</div>";

    scrim.append(cx);

    /* `inert` NOS OUTROS FILHOS DO BODY: a mecânica do `confirmar()`, do seletor
       e do visor, copiada e não inventada. O retrato é tirado ANTES de o véu
       entrar no body, senão ele marcaria a si mesmo como inerte e nada dentro do
       player receberia foco. */
    const behind = [...doc.body.children];
    for (const n of behind) n.setAttribute("inert", "");
    doc.body.append(scrim);

    const vid = cx.querySelector("video");
    st.player = { scrim, cx, vid, behind, origem: origem || null, t };

    /* A ABERTURA. A caixa nasce no retângulo do botão que a chamou e cresce — a
       receita do `dynamic-island` que o handoff do `flows.html` já usa.
       `prefers-reduced-motion` pula a morfose e mantém o estado: nada da
       informação está no movimento. */
    const rect = origem && origem.getBoundingClientRect ? origem.getBoundingClientRect() : null;
    const reduz = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (rect && rect.width > 0 && !reduz && cx.animate) {
      const alvo = cx.getBoundingClientRect();
      const ex = (rect.left + rect.width / 2) - (alvo.left + alvo.width / 2);
      const ey = (rect.top + rect.height / 2) - (alvo.top + alvo.height / 2);
      const escala = Math.max(0.22, Math.min(1, rect.width / Math.max(1, alvo.width)));
      cx.animate([
        { transform: "translate(" + ex + "px," + ey + "px) scale(" + escala + ")", opacity: 0.2 },
        { transform: "translate(0,0) scale(1)", opacity: 1 }
      ], { duration: 380, easing: "cubic-bezier(.2,.9,.25,1)", fill: "both" });
    }

    /* Começa MUDO e tocando. `play()` pode ser recusado mesmo mudo em alguns
       ajustes de navegador, e nesse caso o cartaz central de play aparece — por
       isso o `catch` chama `pintar()` em vez de engolir. */
    vid.muted = true;
    vid.play().then(pintar).catch(pintar);

    vid.addEventListener("timeupdate", pintar);
    vid.addEventListener("progress", pintar);
    vid.addEventListener("play", pintar);
    vid.addEventListener("pause", pintar);
    vid.addEventListener("volumechange", pintar);
    vid.addEventListener("ended", pintar);
    /* O `error` do `<video>` NÃO borbulha, então o ouvinte tem de estar nele — a
       mesma armadilha do `<img>` da bolha de anexo, que este projeto já pagou. E
       a frase não acusa o disco: pode ser o arquivo, pode ser um processo velho
       sem a rota. As duas causas levam a lugares opostos. */
    vid.addEventListener("error", () => {
      const p = cx.querySelector(".tut-palco");
      if (p) {
        p.innerHTML = '<div class="vazio" style="padding:38px 22px;text-align:center">'
          + "não consegui tocar este vídeo.<br>"
          + "<span style=\"font-size:11.5px\">ou o arquivo saiu de <code>tutoriais/</code>, "
          + "ou o cockpit que está respondendo subiu antes desta rota existir — "
          + "o Node não recarrega o <code>server.js</code>.</span></div>";
      }
    });

    /* Só o VÉU fecha, nunca um clique nascido dentro da caixa: sem o teste de
       `target`, arrastar na barra de progresso e soltar fora dela fecharia o
       player no meio do gesto. Mesma guarda do seletor e do visor. */
    scrim.onclick = ev => { if (ev.target === scrim) fechar(); };

    /* MARCA COMO VISTO NA ABERTURA, não no fim. Quem fecha aos 20 segundos
       decidiu que não quer — e o convite voltar depois disso é o painel
       discutindo com ela. O `mini()` continua lá para quem quiser rever. */
    marcarVisto(c.slug, t.registradoEm);

    const primeiro = cx.querySelector(".tut-som");
    (primeiro || cx.querySelector("[data-tut-x]")).focus();
    pintar();
  }

  function fechar() {
    const p = st.player;
    if (!p) return;
    st.player = null;
    /* PAUSA ANTES DE REMOVER. Sem isto o elemento sai do DOM ainda tocando e, em
       alguns navegadores, o áudio continua até o coletor de lixo passar — som de
       um vídeo que já não está na tela. */
    try { p.vid.pause(); } catch { /* já morto */ }
    try { if (doc.fullscreenElement) doc.exitFullscreen(); } catch { /* nada */ }
    for (const n of p.behind) n.removeAttribute("inert");
    p.scrim.remove();
    /* A faixa some depois de assistir, e a tela precisa refletir isso sem F5. */
    exigir().render();
    /* O FOCO DEPOIS DO REPINTAR, e essa ordem é a correção de uma disputa: o
       `telaAbertura()` do `/tester` põe o foco no campo da ideia toda vez que
       desenha, então devolver o foco ANTES do repintar era devolvê-lo para um nó
       que o repintar destruía em seguida — e o foco caía no `body` de qualquer
       jeito. Nesta ordem, uma página que decide onde o foco fica ao desenhar
       ganha, e as que não decidem continuam caindo no `body`.
       O botão que abriu costuma não existir mais: `render()` reescreve a tela.
       Cair no `body` é uma posição neutra; reencontrar por seletor seria afirmar
       algo falso sobre onde o foco estava. Mesma decisão do `fecharVisor`. */
    /* Se o repintar já pôs o foco em algum lugar, não se disputa com ele — é a
       página dizendo onde o foco pertence naquela tela. Só quando o foco caiu no
       `body` (ninguém quis) é que este arquivo escolhe. */
    if (doc.activeElement && doc.activeElement !== doc.body) return;
    const volta = (p.origem && doc.contains(p.origem)) ? p.origem : doc.body;
    if (volta && volta.focus) volta.focus();
  }

  /* Redesenha só o que muda: tempo, barra, e o rótulo dos dois botões de estado.
     NÃO reescreve o `innerHTML` do player — isso mataria o `<video>` e
     recomeçaria o download a cada `timeupdate`, que dispara ~4 vezes por
     segundo. */
  function pintar() {
    const p = st.player;
    if (!p) return;
    const { cx, vid, t } = p;
    const dur = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : (t.segundos || 0);
    const frac = dur > 0 ? Math.min(1, Math.max(0, vid.currentTime / dur)) : 0;

    const pos = cx.querySelector(".tut-trilha .pos");
    const bol = cx.querySelector(".tut-trilha .bolha");
    const buf = cx.querySelector(".tut-trilha .buf");
    if (pos) pos.style.width = (frac * 100).toFixed(3) + "%";
    if (bol) bol.style.left = (frac * 100).toFixed(3) + "%";
    if (buf && vid.buffered && vid.buffered.length && dur > 0) {
      /* O ÚLTIMO intervalo bufferizado, não o primeiro: depois de uma busca o
         navegador guarda dois pedaços, e mostrar o de trás pintaria a barra como
         se nada tivesse sido carregado à frente. */
      const fim = vid.buffered.end(vid.buffered.length - 1);
      buf.style.width = (Math.min(1, fim / dur) * 100).toFixed(3) + "%";
    }

    const ag = cx.querySelector("[data-tut-agora]");
    if (ag) ag.textContent = tempo(vid.currentTime);
    const tr = cx.querySelector(".tut-trilha");
    if (tr) {
      tr.setAttribute("aria-valuenow", String(Math.floor(vid.currentTime)));
      tr.setAttribute("aria-valuetext", tempo(vid.currentTime));
    }

    const tocando = !vid.paused && !vid.ended;
    const bp = cx.querySelector(".tut-b.play");
    if (bp) {
      bp.innerHTML = tocando ? SVG.pause : SVG.play;
      bp.setAttribute("aria-label", tocando ? "Pausar" : "Tocar");
      bp.classList.toggle("play", !tocando);
    }
    /* O play central aparece só quando está parado E o cartaz do som já saiu: os
       dois ao mesmo tempo seriam dois botões grandes no meio do vídeo disputando
       o clique. */
    const mid = cx.querySelector(".tut-mid");
    const som = cx.querySelector(".tut-som");
    const mudo = vid.muted || vid.volume === 0;
    if (som) som.hidden = !mudo;
    if (mid) mid.hidden = tocando || mudo;

    const bs = cx.querySelector(".tut-b.mudo, .tut-b[data-tut-som]");
    if (bs) {
      bs.innerHTML = (mudo ? SVG.mudo : SVG.som) + (mudo ? "som" : "som");
      bs.setAttribute("aria-label", mudo ? "Ligar o som" : "Desligar o som");
      /* A classe `mudo` acende o botão em `--accent`: enquanto está sem som, ele
         é o controle que a pessoa precisa achar, e `--accent` é movimento — não
         é cor de status, então não rouba significado de nada. */
      bs.classList.toggle("mudo", mudo);
    }
  }

  /* Ligar o som. `muted = false` E `volume = 1`, porque as duas coisas silenciam
     e um player que "ligou o som" com volume em zero é o pior estado possível
     aqui. */
  function ligarSom() {
    const p = st.player;
    if (!p) return;
    p.vid.muted = false;
    if (p.vid.volume === 0) p.vid.volume = 1;
    /* Ligar o som é o gesto que o navegador esperava: se o `play()` da abertura
       foi recusado, é aqui que ele passa. */
    if (p.vid.paused) p.vid.play().catch(() => {});
    pintar();
  }

  function pular(dir) {
    const p = st.player;
    if (!p) return;
    const dur = (isFinite(p.vid.duration) && p.vid.duration > 0) ? p.vid.duration : (p.t.segundos || 0);
    p.vid.currentTime = Math.min(dur, Math.max(0, p.vid.currentTime + dir * PULO));
    pintar();
  }

  function alternar() {
    const p = st.player;
    if (!p) return;
    if (p.vid.paused || p.vid.ended) p.vid.play().catch(() => {});
    else p.vid.pause();
    pintar();
  }

  /* Buscar pela posição do ponteiro na trilha. `pointerdown` mais `pointermove`
     enquanto o botão está apertado: um `click` só daria o salto e nunca o
     arrasto, e arrastar é como se procura um trecho. */
  function buscar(ev, tr) {
    const p = st.player;
    if (!p) return;
    const r = tr.getBoundingClientRect();
    if (r.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const dur = (isFinite(p.vid.duration) && p.vid.duration > 0) ? p.vid.duration : (p.t.segundos || 0);
    p.vid.currentTime = frac * dur;
    pintar();
  }

  function telaCheia() {
    const p = st.player;
    if (!p) return;
    try {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else if (p.cx.requestFullscreen) p.cx.requestFullscreen();
    } catch { /* navegador sem fullscreen: o botão simplesmente não faz nada, e não quebra */ }
  }

  /* ══════════════════════════ O TECLADO E O CLIQUE ═══════════════════════════
   *
   * `teclado(ev)` NÃO REGISTRA OUVINTE — ela entra na cadeia de captura da
   * página e devolve `true` quando consumiu a tecla, que é o contrato. Com um
   * `keydown` próprio, um Esc fecharia o player E chamaria o `parar()` da página
   * (`/upgrade` e `/tester` têm um), matando uma rodada de modelo já paga — duas
   * ações diferentes na mesma tecla. A nota longa está no `tecladoGaveta` do
   * `upgrade.html`.
   *
   * AQUI ELE CONSOME MAIS QUE O ESC: espaço, setas, `m` e `f` pertencem ao
   * player enquanto ele está aberto. O `inert` já tirou o resto da página do
   * caminho, mas o `keydown` do documento continua correndo — sem estas linhas,
   * espaço rolaria a página por trás do véu. */
  function teclado(e) {
    if (!st.player) return false;
    if (e.key === "Escape") { e.preventDefault(); fechar(); return true; }
    /* Modificador segue a cadeia: `ctrl+←` é navegação do sistema, não do vídeo. */
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    /* Campo de texto dentro do player não existe hoje, e a guarda fica porque o
       dia em que existir é o dia em que espaço deixaria de digitar espaço. */
    const a = doc.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) return false;
    const acao = TECLAS[e.key] || TECLAS[String(e.key).toLowerCase()];
    if (!acao) return false;
    e.preventDefault();
    if (acao === "play") alternar();
    else if (acao === "voltar") pular(-1);
    else if (acao === "avancar") pular(1);
    else if (acao === "mudo") {
      const p = st.player;
      if (p.vid.muted || p.vid.volume === 0) ligarSom();
      else { p.vid.muted = true; pintar(); }
    } else if (acao === "cheia") telaCheia();
    return true;
  }

  /* `cliques(ev)` é o mesmo contrato: devolve `true` quando consumiu. Delegado
     porque `data-tut` existe em TRÊS lugares (a miniatura, o botão grande da
     faixa e o `mini()`), e um `id` repetido pintaria o segundo e o terceiro sem
     fazer nada, em silêncio. Os controles de dentro do player também entram
     aqui, e não em ouvintes montados no `abrir`: assim `fechar` não precisa
     desmontar nada além do nó, e não sobra ouvinte apontando para um player que
     já morreu. */
  function cliques(ev) {
    if (!ev || !ev.target || !ev.target.closest) return false;
    const t = ev.target.closest("[data-tut]");
    if (t && !t.disabled) { ev.preventDefault(); abrir(t); return true; }
    const tesc = ev.target.closest("[data-tut-esconde]");
    if (tesc) {
      ev.preventDefault();
      /* Esconde AGORA e persiste: o `marcarVisto` é o que faz a decisão
         sobreviver ao F5, e `st.escondido` é o que faz a faixa sair sem
         esperar. */
      const c = exigir();
      marcarVisto(c.slug, (meu().t || {}).registradoEm);
      st.escondido = true;
      c.render();
      return true;
    }
    if (ev.target.closest("[data-tut-x]")) { ev.preventDefault(); fechar(); return true; }
    if (ev.target.closest("[data-tut-som]")) { ev.preventDefault(); ligarSom(); return true; }
    if (ev.target.closest("[data-tut-play]")) { ev.preventDefault(); alternar(); return true; }
    if (ev.target.closest("[data-tut-cheia]")) { ev.preventDefault(); telaCheia(); return true; }
    const tpl = ev.target.closest("[data-tut-pulo]");
    if (tpl) { ev.preventDefault(); pular(Number(tpl.dataset.tutPulo) || 1); return true; }
    return false;
  }

  /* ═══════════════════════════════ OS GESTOS ═════════════════════════════════
   *
   * O ARRASTO DA TRILHA e as teclas Home/End dela. Esta é a ÚNICA função aqui
   * que registra ouvintes, e ela pode: todos são guardados por `st.player` E por
   * o alvo estar dentro de `.tut-trilha`, então nenhum deles pode consumir uma
   * tecla que é da página. O `keydown` daqui não é o do player — é o do slider,
   * e um slider que não anda com as setas é um slider mentiroso para quem usa
   * leitor de tela.
   *
   * O arrasto é capturado NO DOCUMENTO e não na trilha: soltar o ponteiro FORA
   * da barra (o que acontece sempre que se arrasta rápido) não pode deixar a
   * busca presa. `setPointerCapture` resolveria também, e não é usado porque
   * exige um nó estável — e o `.tut-trilha` morre com o player.
   *
   * IDEMPOTENTE, porque uma página pode chamá-la sem saber que outra linha já
   * chamou: dois pares de ouvintes fariam o vídeo buscar duas vezes por
   * movimento do ponteiro. */
  let gestosLigados = false;
  function ligarGestos() {
    if (!temDOM || gestosLigados) return false;
    gestosLigados = true;
    let arrastando = null;
    doc.addEventListener("pointerdown", ev => {
      if (!ev.target || !ev.target.closest) return;
      const tr = ev.target.closest(".tut-trilha");
      if (!tr || !st.player) return;
      ev.preventDefault();
      arrastando = tr;
      tr.focus();
      buscar(ev, tr);
    });
    doc.addEventListener("pointermove", ev => {
      if (!arrastando || !st.player) return;
      /* `buttons` e não `button`: durante um `pointermove` o segundo é sempre
         -1, e o teste de "ainda está apertado" mora no primeiro. Sem isto o
         vídeo buscaria com o ponteiro solto passando por cima da barra. */
      if (!(ev.buttons & 1)) { arrastando = null; return; }
      buscar(ev, arrastando);
    });
    doc.addEventListener("pointerup", () => { arrastando = null; });
    doc.addEventListener("pointercancel", () => { arrastando = null; });
    doc.addEventListener("keydown", ev => {
      if (!st.player) return;
      const tr = ev.target && ev.target.closest && ev.target.closest(".tut-trilha");
      if (!tr) return;
      if (ev.key === "Home") { ev.preventDefault(); st.player.vid.currentTime = 0; pintar(); }
      else if (ev.key === "End") {
        ev.preventDefault();
        const d = st.player.vid.duration;
        st.player.vid.currentTime = (isFinite(d) && d > 0) ? d - 0.1 : 0;
        pintar();
      }
    });
    return true;
  }

  const api = {
    configurar, injetarCSS, CSS, CSS_ID, CHAVE,
    estadoDe, visto, marcarVisto, tempo, PULO, TECLAS, SVG,
    carregar, hero, mini, tira, temVideo,
    abrir, fechar, pintar, ligarSom, pular, alternar, buscar, telaCheia,
    teclado, cliques, ligarGestos, aberto,
    esc,
    /* Só para teste: o estado interno, para poder plantar a resposta do ledger
       sem servidor. Nomeado com `_` porque nenhuma página tem o que fazer com
       ele — quem precisa da resposta chama `hero()`. */
    _st: st
  };
  return api;
});
