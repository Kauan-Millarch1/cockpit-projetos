/* gen-nav-preview.js — gera preview/nav.html a partir de flows.html.
 *
 * Mesmo padrão dos outros geradores: os TOKENS e o topbar são EXTRAÍDOS de
 * flows.html, nunca copiados à mão — então o preview não consegue divergir do
 * chrome real. O que é autoral aqui é só o CSS das VARIANTES, porque elas ainda
 * não existem na página: são propostas.
 *
 * Por que este preview se paga: a navegação é a única coisa que aparece nas três
 * telas ao mesmo tempo. Mexer nela direto no flows.html significa mexer em três
 * arquivos e descobrir só depois que o ativo não se lê a 100% de zoom. Aqui as
 * seis propostas estão na mesma tela, dentro de um topbar de verdade (com a
 * chama, a instância, o carimbo, o ponto vivo e os botões da direita), nos dois
 * temas e em 390px.
 *
 * É INTERATIVO de propósito. O que decide entre estas variantes não cabe num
 * print: o indicador que desliza entre as portas, o painel que desce, o rótulo
 * que abre no hover, o foco pelo teclado. Clique nas portas.
 *
 * Regerar: node preview/gen-nav-preview.js
 *
 * ANTES DE EDITAR: nenhum backtick pode entrar no template literal da página —
 * nem dentro de comentário CSS, nem citando um nome de propriedade. Ele fecha a
 * string, e o erro que sai aponta para uma linha de CSS ("css.pages is not a
 * function", "Unexpected identifier 'transform'"), não para a causa. Isto custou
 * três rodadas na primeira escrita deste arquivo. Use var(--x) ou aspas.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { ico, PORTAS, chamaDe, cssDe } = require("./nav-comum.js");

const html = fs.readFileSync(path.join(__dirname, "..", "flows.html"), "utf8");
const css = cssDe(html);
const chama = chamaDe(html);

const ATUAL = "fluxos"; // a porta em que o preview abre

/* ═════════════════════════════════════════════════════════════════ variantes
   Cada uma: CSS próprio + como monta o <nav>. Ordem = minha recomendação
   decrescente, e a razão de cada uma vem escrita na tela junto. */

const VARIANTES = [

/* ------------------------------------------------------------------------ A */
{
  id: "a", nome: "Trilho segmentado",
  fica: "Um leito só, e uma pastilha elevada que DESLIZA para a porta clicada.",
  pro: "O ativo se lê pela forma (pastilha branca sobre leito afundado), não por um tint de 8%. O deslize é o único momento de movimento, e ele carrega informação: mostra de onde você veio.",
  contra: "É o vocabulário de segmented control que a Linear e a Vercel usam — familiar, mas não é uma ideia nova.",
  recomendo: true,
  desliza: true,
  css: `
.nv-a{position:relative;display:flex;align-items:center;padding:3px;border-radius:11px;
  background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-soft);flex:0 0 auto}
.nv-a a{position:relative;z-index:1;display:flex;align-items:center;gap:6px;padding:6px 12px;
  font-size:12.5px;font-weight:500;color:var(--txt-faint);text-decoration:none;white-space:nowrap;
  border-radius:8px;transition:color .18s ease}
.nv-a a svg{opacity:.62;transition:opacity .18s ease,transform .3s cubic-bezier(.2,.9,.15,1)}
.nv-a a:hover{color:var(--txt-dim)}
.nv-a a:hover svg{opacity:1}
.nv-a a[aria-current=page]{color:var(--txt);font-weight:600}
.nv-a a[aria-current=page] svg{opacity:1;color:var(--accent-txt);transform:translateY(-.5px)}
/* Anima width DE PROPÓSITO, e o detector de design reclama disto. Duas razões:
   a pastilha é position:absolute, então a largura dela não reflui nada em volta —
   o custo fica numa caixa fora do fluxo; e a alternativa (scaleX) esmagaria o
   anel de 1px e o raio de 8px, que aqui NÃO são enfeite: a borda da pastilha é o
   que faz o ativo se ler por forma em vez de por mais tinta. */
.nv-a .glide{position:absolute;top:3px;bottom:3px;left:0;width:var(--w,0);border-radius:8px;
  transform:translateX(var(--x,0));pointer-events:none;
  background:color-mix(in srgb,var(--raised) 92%,var(--accent));
  box-shadow:inset 0 0 0 1px var(--accent-line),0 1px 2px rgba(0,0,0,.10),0 6px 14px -12px rgba(0,0,0,.5);
  transition:transform .34s cubic-bezier(.2,.9,.15,1),width .34s cubic-bezier(.2,.9,.15,1)}
.nv-a .sg{position:absolute;top:2px;right:2px;width:5px;height:5px;border-radius:50%;
  box-shadow:0 0 0 2px var(--bg)}`,
  nav: (atual, sinal) => '<nav class="nv-a" aria-label="telas do cockpit"><i class="glide"></i>'
    + PORTAS.map(p => porta(p, atual, sinal, ico(p.id) + "<span>" + p.rot + "</span>")).join("")
    + "</nav>"
},

/* ------------------------------------------------------------------------ B */
{
  id: "b", nome: "Sublinhado com feixe",
  fica: "As portas ocupam a altura inteira da barra e o ativo é uma barra de 2px que desliza na costura, com brilho de accent.",
  pro: "Zero moldura: nada de caixa dentro de caixa. Ancorar na borda inferior amarra a navegação AO conteúdo abaixo, que é o que ela governa. Mais leve de todas.",
  contra: "Sem contêiner, as três portas competem com o wordmark e com o `meta` do lado. E o brilho é o único lugar onde um halo colorido entra — o resto do painel proíbe.",
  desliza: true,
  css: `
.nv-b{position:relative;display:flex;align-self:stretch;align-items:stretch;gap:2px;margin-bottom:-1px;flex:0 0 auto}
.nv-b a{display:flex;align-items:center;gap:7px;padding:0 13px;font-size:12.5px;font-weight:500;
  color:var(--txt-faint);text-decoration:none;white-space:nowrap;position:relative;
  transition:color .18s ease,background .18s ease}
.nv-b a svg{opacity:.6;transition:opacity .18s ease}
.nv-b a:hover{color:var(--txt-dim);background:linear-gradient(180deg,transparent 40%,var(--surface-2))}
.nv-b a:hover svg{opacity:1}
.nv-b a[aria-current=page]{color:var(--txt);font-weight:600}
.nv-b a[aria-current=page] svg{opacity:1;color:var(--accent-txt)}
/* Mesma decisão da pastilha do A: fora do fluxo, então a largura não reflui a
   barra. Aqui scaleX seria viável, mas manter os dois indicadores com a mesma
   mecânica é o que permite comparar A e B pelo desenho, e não pelo motor. */
.nv-b .bar{position:absolute;bottom:0;left:0;height:2px;width:var(--w,0);border-radius:2px 2px 0 0;
  background:var(--accent);box-shadow:0 -2px 14px -3px var(--accent);pointer-events:none;
  transform:translateX(var(--x,0));
  transition:transform .32s cubic-bezier(.2,.9,.15,1),width .32s cubic-bezier(.2,.9,.15,1)}
.nv-b .sg{position:absolute;top:14px;right:6px;width:5px;height:5px;border-radius:50%}`,
  nav: (atual, sinal) => '<nav class="nv-b" aria-label="telas do cockpit"><i class="bar"></i>'
    + PORTAS.map(p => porta(p, atual, sinal, ico(p.id) + "<span>" + p.rot + "</span>")).join("")
    + "</nav>"
},

/* ------------------------------------------------------------------------ C */
{
  id: "c", nome: "Suspenso horizontal",
  fica: "Uma porta só na barra — a atual — e ela abre um painel de largura inteira com as três telas, cada uma com o que ela responde e um fato ao vivo.",
  pro: "É o único formato onde cabe COPY. Hoje «Disco» é uma palavra que não explica nada; aqui ela vem com «os projetos no disco: vivos, parados, apodrecendo». E devolve espaço na barra, que está cheia (instância, carimbo, ponto vivo, tema, gravar, recarregar).",
  contra: "Custa um clique a mais para trocar de tela, num painel que é para ser operado o dia inteiro. Mega-menu é padrão de site institucional, não de cockpit.",
  suspenso: true,
  css: `
.nv-c{position:relative;flex:0 0 auto}
.nv-c .trg{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 11px;border-radius:10px;
  background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-soft);cursor:pointer;
  font-size:12.5px;font-weight:600;color:var(--txt);border:0;font-family:inherit;white-space:nowrap;
  transition:box-shadow .18s ease,background .18s ease}
.nv-c .trg:hover,.nv-c .trg[aria-expanded=true]{background:var(--accent-soft);
  box-shadow:inset 0 0 0 1px var(--accent-line)}
.nv-c .trg svg.ic{color:var(--accent-txt)}
.nv-c .trg .ch{width:9px;height:9px;color:var(--txt-faint);transition:transform .26s cubic-bezier(.2,.9,.15,1)}
.nv-c .trg[aria-expanded=true] .ch{transform:rotate(180deg)}
.nv-c .pane{position:absolute;top:calc(100% + 9px);left:-11px;z-index:60;display:grid;
  grid-template-columns:repeat(3,minmax(200px,1fr));gap:4px;padding:6px;
  border-radius:14px;border:1px solid var(--line);background:var(--raised);
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 26px 60px -30px rgba(0,0,0,.55);
  opacity:0;transform:translateY(-7px) scale(.985);filter:blur(3px);pointer-events:none;
  transition:opacity .2s ease,transform .3s cubic-bezier(.2,.9,.15,1),filter .2s ease}
.nv-c[data-open="1"] .pane{opacity:1;transform:none;filter:none;pointer-events:auto}
.nv-c .pane a{display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:stretch;
  padding:11px 12px;border-radius:10px;text-decoration:none;border:1px solid transparent}
/* A descrição tem 2 ou 3 linhas conforme a tela. Sem empurrar o fato para o
   rodapé da célula, os três fatos ficam em três alturas diferentes e a linha de
   baixo do painel vira um degrau. */
.nv-c .pane a>span:last-child{display:flex;flex-direction:column;min-height:100%}
.nv-c .pane .fx{margin-top:auto;padding-top:7px}
.nv-c .pane a:hover{background:var(--surface-2);border-color:var(--line-soft)}
.nv-c .pane a[aria-current=page]{background:var(--accent-soft);border-color:var(--accent-line)}
.nv-c .pane .tile{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;
  background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-soft);color:var(--txt-dim)}
.nv-c .pane a[aria-current=page] .tile{color:var(--accent-txt);background:var(--raised);
  box-shadow:inset 0 0 0 1px var(--accent-line)}
/* display:block nos dois — são span dentro de span, e sem isto o nome cola na
   descrição numa linha só ("Fluxoso que rodou, o que quebrou"). */
.nv-c .pane .nm{display:block;font-size:13px;font-weight:600;color:var(--txt);line-height:1.3}
/* O painel vive sobre var(--raised), que é MAIS CLARO que var(--surface) — e
   var(--txt-faint) foi calibrado contra surface. Medido aqui: 3,72 no tema
   escuro, falha de AA em 11,5px. Como isto é a copy que justifica a variante,
   sobe para txt-dim; o fato, que é etiqueta, ganha a mistura que o resto do
   painel já usa para cor sobre fundo tingido. */
.nv-c .pane .ds{display:block;font-size:11.5px;color:var(--txt-dim);line-height:1.45;margin-top:2px}
.nv-c .pane .fx{display:flex;align-items:center;gap:6px;
  font-family:var(--font-num);font-size:10px;letter-spacing:.03em;
  color:color-mix(in srgb,var(--txt-faint) 62%,var(--txt))}
.nv-c .pane .sg{width:6px;height:6px;border-radius:50%}`,
  nav: (atual, sinal) => {
    const at = PORTAS.find(p => p.id === atual) || PORTAS[0];
    return '<div class="nv-c" data-open="0">'
      + '<button class="trg" type="button" aria-expanded="false" aria-haspopup="true" aria-controls="pane-c">'
      + '<span class="ic" style="display:grid">' + ico(at.id, 15) + "</span>"
      + "<span>" + at.rot + "</span>"
      + '<svg class="ch" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6"'
      + ' stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + "</button>"
      + '<nav class="pane" id="pane-c" aria-label="telas do cockpit">'
      + PORTAS.map(p =>
          '<a href="' + p.href + '" data-porta="' + p.id + '"'
          + (p.id === atual ? ' aria-current="page"' : "") + ">"
          + '<span class="tile">' + ico(p.id, 16) + "</span><span>"
          + '<span class="nm">' + p.rot + "</span>"
          + '<span class="ds">' + p.desc + "</span>"
          + '<span class="fx"><i class="sg" style="background:var(--' + p.sinal + ')"></i>'
          + p.fato + "</span></span></a>").join("")
      + "</nav></div>";
  }
},

/* ------------------------------------------------------------------------ D */
{
  id: "d", nome: "Cápsula ícone-primeiro",
  fica: "Cápsula compacta: só ícones, e o rótulo ABRE no hover e no ativo. Cada porta anuncia seu atalho.",
  pro: "Menor pegada da barra — devolve ~90px para o nome do fluxo, que hoje é truncado. E é o único formato que ensina o atalho de teclado no lugar onde ele é usado.",
  contra: "Ícone sozinho é aposta: «disco» e «tester» só ficam óbvios depois de aprendidos, e numa tela usada uma vez por semana isso é ruim. Pior: o rótulo abrindo no hover EMPURRA as portas vizinhas — alvo que se move debaixo do cursor. É o único formato aqui com esse defeito, e ele é inseparável da compactação que o justifica.",
  atalhos: true,
  css: `
.nv-d{display:flex;align-items:center;gap:3px;padding:3px;border-radius:999px;
  background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-soft);flex:0 0 auto}
.nv-d a{position:relative;display:flex;align-items:center;height:30px;padding:0 9px;border-radius:999px;
  color:var(--txt-faint);text-decoration:none;
  transition:color .18s ease,background .2s ease,box-shadow .2s ease}
.nv-d a:hover{color:var(--txt-dim);background:var(--raised)}
.nv-d a[aria-current=page]{color:var(--txt);background:var(--accent-soft);
  box-shadow:inset 0 0 0 1px var(--accent-line)}
.nv-d a[aria-current=page] svg.ic{color:var(--accent-txt)}
/* max-width animado: aqui o reflow é o EFEITO pretendido — a cápsula cresce e
   as vizinhas cedem espaço. Não existe versão com transform que produza isso,
   e por isso o defeito não é de performance e sim de interação: o alvo se move
   debaixo do cursor. Está escrito no "contra" da variante, onde ele é decidido. */
.nv-d .lb{display:flex;align-items:center;gap:7px;max-width:0;overflow:hidden;opacity:0;
  white-space:nowrap;font-size:12.5px;font-weight:500;
  transition:max-width .32s cubic-bezier(.2,.9,.15,1),opacity .2s ease,margin-left .32s cubic-bezier(.2,.9,.15,1)}
.nv-d a:hover .lb,.nv-d a[aria-current=page] .lb{max-width:120px;opacity:1;margin-left:7px}
/* 9px é o menor texto da barra: medido 4,33 escuro / 4,46 claro com txt-faint,
   as duas abaixo de AA. A mistura sobe para ~6 sem virar um segundo rótulo. */
.nv-d kbd{font-family:var(--font-num);font-size:9px;letter-spacing:.02em;
  color:color-mix(in srgb,var(--txt-faint) 58%,var(--txt));
  padding:1px 4px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--line);line-height:1.5}
.nv-d .sg{position:absolute;top:3px;right:5px;width:5px;height:5px;border-radius:50%;
  box-shadow:0 0 0 2px var(--surface)}`,
  nav: (atual, sinal) => '<nav class="nv-d" aria-label="telas do cockpit">'
    + PORTAS.map(p => porta(p, atual, sinal,
        '<span class="ic" style="display:grid">' + ico(p.id) + "</span>"
        + '<span class="lb"><span>' + p.rot + "</span><kbd>alt " + p.tecla + "</kbd></span>",
        "ic")).join("")
    + "</nav>"
},

/* ------------------------------------------------------------------------ E */
{
  id: "e", nome: "Índice em colchete",
  fica: "O vocabulário que o painel já fala — colchete mono, caixa alta, tique de accent que cresce da esquerda.",
  pro: "É a única variante que não podia estar em nenhum outro produto. O painel já anota tudo em `[ 01 / 05 ]` e `[ 30 NÓS · 33 CONEXÕES ]`: a navegação passa a falar a mesma língua em vez de parecer um componente importado.",
  contra: "Caixa alta em 11px mono é o formato mais difícil de bater contraste, e mono como fantasia de «técnico» é vício conhecido. Aqui ele se paga porque a referência do Kauan (firecrawl) é isso.",
  css: `
.nv-e{display:flex;align-items:center;gap:15px;flex:0 0 auto}
.nv-e a{position:relative;display:flex;align-items:center;gap:7px;padding:6px 1px;
  font-family:var(--font-num);font-size:11px;letter-spacing:.075em;text-transform:uppercase;
  color:var(--txt-faint);text-decoration:none;white-space:nowrap;transition:color .18s ease}
.nv-e a svg{opacity:.55;transition:opacity .18s ease}
.nv-e a .br{color:var(--line);transition:color .22s ease}
.nv-e a:hover{color:var(--txt-dim)}
.nv-e a:hover svg{opacity:.9}
.nv-e a:hover .br{color:var(--txt-faint)}
.nv-e a[aria-current=page]{color:var(--txt)}
.nv-e a[aria-current=page] svg{opacity:1;color:var(--accent-txt)}
.nv-e a[aria-current=page] .br{color:var(--accent)}
.nv-e a::after{content:"";position:absolute;left:0;right:0;bottom:1px;height:1px;
  background:var(--accent);transform:scaleX(0);transform-origin:left center;
  transition:transform .3s cubic-bezier(.2,.9,.15,1)}
.nv-e a:hover::after{transform:scaleX(.35)}
.nv-e a[aria-current=page]::after{transform:scaleX(1)}
.nv-e .sg{width:5px;height:5px;border-radius:50%;margin-left:1px}`,
  nav: (atual, sinal) => '<nav class="nv-e" aria-label="telas do cockpit">'
    + PORTAS.map(p => porta(p, atual, sinal,
        '<span class="br" aria-hidden="true">[</span>' + ico(p.id, 13)
        + "<span>" + p.rot + '</span><span class="br" aria-hidden="true">]</span>')).join("")
    + "</nav>"
},

/* ------------------------------------------------------------------------ F */
{
  id: "f", nome: "Portas com sinal",
  fica: "Cada porta é um bloco de duas linhas: o nome e um fato ao vivo daquela tela.",
  pro: "É a única que trabalha. O produto já sabe que há 2 falhas em 24h e que uma construção está rodando, e hoje a barra não diz nada — você descobre entrando. Uma porta que avisa antes do clique é o que um cockpit deveria ter.",
  contra: "Come a largura toda da barra e desequilibra: três blocos de duas linhas pesam mais que o wordmark. E o fato tem que ser verdade sempre — um número velho ali é pior que nenhum.",
  css: `
.nv-f{display:flex;align-items:center;gap:5px;flex:0 0 auto}
.nv-f a{display:flex;align-items:center;gap:9px;padding:5px 12px 5px 10px;border-radius:10px;
  text-decoration:none;border:1px solid transparent;
  transition:background .18s ease,border-color .18s ease}
.nv-f a:hover{background:var(--surface-2);border-color:var(--line-soft)}
.nv-f a svg{opacity:.6;color:var(--txt-faint);transition:opacity .18s ease}
.nv-f a:hover svg{opacity:1}
.nv-f a[aria-current=page]{background:var(--accent-soft);border-color:var(--accent-line)}
.nv-f a[aria-current=page] svg{opacity:1;color:var(--accent-txt)}
.nv-f .tx{display:flex;flex-direction:column;gap:1px;line-height:1.15}
.nv-f .nm{font-size:12px;font-weight:500;color:var(--txt-dim);white-space:nowrap}
.nv-f a[aria-current=page] .nm{color:var(--txt);font-weight:600}
.nv-f .fx{display:flex;align-items:center;gap:5px;font-family:var(--font-num);font-size:10px;
  letter-spacing:.03em;color:var(--txt-faint);white-space:nowrap}
.nv-f .sg{width:5px;height:5px;border-radius:50%;flex:0 0 auto}`,
  nav: (atual, sinal) => '<nav class="nv-f" aria-label="telas do cockpit">'
    + PORTAS.map(p =>
        '<a href="' + p.href + '" data-porta="' + p.id + '"'
        + (p.id === atual ? ' aria-current="page"' : "") + ">" + ico(p.id, 16)
        + '<span class="tx"><span class="nm">' + p.rot + "</span>"
        + '<span class="fx"><i class="sg" style="background:var(--' + p.sinal + ')"></i>'
        + p.fato + "</span></span></a>").join("")
    + "</nav>"
}
];

/* Uma porta comum: <a> + conteúdo + o pontinho de sinal opcional. O sinal é um
 * eixo ORTOGONAL às variantes — dá para ligar em qualquer uma delas — então ele
 * mora aqui e não dentro de cada CSS. */
function porta(p, atual, sinal, dentro, cls) {
  return '<a href="' + p.href + '" data-porta="' + p.id + '"'
    + (p.id === atual ? ' aria-current="page"' : "") + ">" + dentro
    + (sinal ? '<i class="sg sinal" style="background:var(--' + p.sinal + ')"></i>' : "")
    + "</a>";
}

/* ─────────────────────────────────────────────────────── um topbar de verdade
   Sem o resto da barra, qualquer navegação parece boa: o que aperta é o
   wordmark do lado esquerdo e os cinco controles da direita. */
function barra(v, atual, sinal, curto) {
  /* `curto` é a fila de zoom: SÓ a navegação, sobre o fundo real. Com o wordmark
     dentro, a variante F (a mais larga) empurrava "COCKPIT / fluxos n8n" para
     duas linhas — um defeito do preview que se leria como defeito da variante. */
  if (curto) return '<header class="topbar">' + v.nav(atual, sinal)
    + '<div class="spacer"></div><button class="btn ghost" type="button">◐</button></header>';
  return '<header class="topbar">'
    + '<div class="brand"><span class="flame" aria-hidden="true">' + chama + "</span>"
    + '<h1 class="wm"><b>COCKPIT</b> <span>/ ' + (atual === "disco" ? "disco" : atual === "tester" ? "tester" : "fluxos n8n") + "</span></h1></div>"
    + '<div class="sep"></div>'
    + v.nav(atual, sinal)
    + (curto ? "" : '<div class="sep"></div><div class="meta">ecommercepuro.app.n8n.cloud</div>')
    + '<div class="spacer"></div>'
    + (curto ? "" : '<div class="meta">14:53:07</div>'
       + '<div class="livedot on"><i></i><span>ao vivo</span></div>')
    + '<button class="btn ghost" type="button" title="Alternar tema">◐</button>'
    + (curto ? "" : '<button class="btn ghost rec" type="button"><span class="dot" aria-hidden="true">⏺</span> <span class="lbl">Gravar</span></button>'
       + '<button class="btn beam" type="button">Recarregar</button>')
    + "</header>";
}

const HOJE = {
  id: "hoje", nav: (atual) => '<nav class="pages" aria-label="telas do cockpit">'
    + PORTAS.map(p => '<a href="' + p.href + '" data-porta="' + p.id + '"'
        + (p.id === atual ? ' aria-current="page"' : "") + ">" + p.rot + "</a>").join("")
    + "</nav>"
};

const secao = v => `
<section class="vr" id="v-${v.id}" data-desliza="${v.desliza ? 1 : 0}">
  <div class="vh">
    <span class="tag">${v.id.toUpperCase()}</span>
    <h2>${v.nome}</h2>
    ${v.recomendo ? '<span class="rec-tag">recomendo</span>' : ""}
  </div>
  <p class="fica">${v.fica}</p>
  <div class="moldura">${barra(v, ATUAL, false)}</div>
  <div class="zoom"><div class="zi">${barra(v, ATUAL, false, true)}</div></div>
  <div class="dupla">
    <div><h3>a favor</h3><p>${v.pro}</p></div>
    <div><h3>contra</h3><p>${v.contra}</p></div>
  </div>
</section>`;

const pagina = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cockpit — navegação (preview)</title>
<style>
${css}

/* ═══════════════════════════════════════════ as variantes (CSS autoral, proposta)
   Cada uma num namespace próprio (.nv-a … .nv-f) para não colidir com o .pages
   que está no ar — a barra "HOJE" no topo desta página é a referência-contrária e
   tem que continuar sendo exatamente o que se vê hoje.
   NOTA para quem editar este gerador: NENHUM backtick pode entrar neste template
   literal, nem dentro de comentário CSS. Ele fecha a string e o erro que sai
   aponta para uma linha de CSS ("css.pages is not a function"), não para a causa.
   Isto já custou duas rodadas aqui. */
${VARIANTES.map(v => "/* ---- " + v.id.toUpperCase() + " · " + v.nome + " */" + v.css).join("\n")}

/* ══════════════════════════════════════════════════ só do preview: a moldura */
body{display:block;padding:0;background:var(--bg-deep);overflow-x:hidden}
.pv{max-width:1180px;margin:0 auto;padding:30px 24px 90px}
.pv h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}
.pv .sub{font-size:13px;color:var(--txt-faint);line-height:1.65;max-width:80ch;margin:0 0 6px}
.pv .sub code{font-family:var(--font-num);font-size:12px;color:var(--txt-dim)}
.ctrl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:20px 0 4px;
  position:sticky;top:0;z-index:80;padding:10px 0;
  background:linear-gradient(180deg,var(--bg-deep) 72%,transparent)}
.ctrl .lbl{font-family:var(--font-num);font-size:10.5px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--txt-faint);margin-right:2px}
.vr{margin-top:34px;padding-top:26px;border-top:1px solid var(--line-soft)}
.vh{display:flex;align-items:center;gap:10px;margin-bottom:7px}
.vh h2{font-size:17px;margin:0;letter-spacing:-.01em}
.tag{font-family:var(--font-num);font-size:10.5px;letter-spacing:.08em;color:var(--txt-faint);
  padding:2px 7px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line)}
.rec-tag{font-family:var(--font-num);font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--accent-txt);padding:3px 8px;border-radius:999px;background:var(--accent-soft);
  box-shadow:inset 0 0 0 1px var(--accent-line)}
.fica{font-size:13px;color:var(--txt-dim);line-height:1.6;max-width:82ch;margin:0 0 16px}
/* A barra vive sobre var(--bg), então a moldura tem que ser var(--bg) — julgar o
   contraste do ativo sobre o fundo errado é o jeito de aprovar algo que não se
   lê na tela real. */
.moldura{border-radius:14px;border:1px solid var(--line);background:var(--bg);
  overflow:visible;box-shadow:var(--shadow)}
.moldura .topbar{position:static;border-radius:14px 14px 0 0;border-bottom:1px solid var(--line)}
/* A moldura tem 1130px, a tela real tem 1440. Sem estas três, o wordmark quebra
   em duas linhas e o "ao vivo" empilha — ruído que não é da navegação e que
   sequestra a comparação. Na página real quem encolhe é o nome do fluxo. */
.moldura .brand,.moldura .livedot{flex:0 0 auto;white-space:nowrap}
.moldura .meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.moldura::after{content:"";display:block;height:74px;border-radius:0 0 14px 14px;
  background:
    linear-gradient(90deg,var(--surface-2) 0 34%,transparent 34%) no-repeat 22px 22px/240px 11px,
    linear-gradient(90deg,var(--surface-2) 0 34%,transparent 34%) no-repeat 22px 42px/380px 11px}
/* Altura explícita: transform não infla a caixa do pai, então o filho escalado
   1,7× pintava fora de uma moldura de 58px e a variante F (duas linhas) saía
   cortada pela metade — exatamente a linha que ela existe para mostrar. */
.zoom{margin-top:12px;height:100px;border-radius:12px;border:1px dashed var(--line);
  background:var(--bg);padding:0;overflow:hidden}
.zi{transform:scale(1.7);transform-origin:0 0;width:58.8%;pointer-events:auto}
/* A costura fica: a variante B apoia a barra de accent NELA, e sem a linha o
   indicador aparece solto no meio do nada. */
.zi .topbar{position:static;background:transparent;backdrop-filter:none;
  border-bottom:1px solid var(--line)}
.dupla{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:16px}
.dupla h3{font-family:var(--font-num);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
  margin:0 0 5px;color:var(--txt-faint);font-weight:600}
.dupla p{margin:0;font-size:12.5px;line-height:1.62;color:var(--txt-dim)}
.dupla div:last-child h3{color:var(--warn-txt)}
.movel{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:16px;margin-top:14px}
.mf{width:390px;border-radius:14px;border:1px solid var(--line);background:var(--bg);overflow:hidden}
/* As regras móveis do flows.html moram numa media query de VIEWPORT, e este
   quadro é um contêiner de 390px dentro de uma janela de 1440 — então elas não
   entram sozinhas e o quadro mentiria, mostrando uma barra que não quebra.
   Transcritas do bloco @media (max-width:...) do flows.html; se ele mudar lá,
   muda aqui. */
.mf .topbar{position:static;height:auto;min-height:56px;flex-wrap:wrap;row-gap:6px;
  padding:8px 14px;gap:10px}
.mf .topbar .sep{display:none}
.mf .topbar .btn{flex:0 0 auto;min-height:40px}
.mf .topbar .spacer{flex:1 1 auto}
.mf .topbar .brand{flex:0 0 auto}
.mf .cap{font-family:var(--font-num);font-size:10px;letter-spacing:.05em;color:var(--txt-faint);
  padding:7px 12px;border-top:1px solid var(--line-soft)}
.nota{font-size:12px;color:var(--txt-faint);line-height:1.65;max-width:82ch;margin:26px 0 0;
  padding:14px 16px;border-radius:12px;background:var(--surface-2);
  box-shadow:inset 0 0 0 1px var(--line-soft)}
.nota b{color:var(--txt-dim)}
@media (max-width:880px){.dupla{grid-template-columns:1fr;gap:14px}}
</style>
</head>
<body>
<div class="pv">
  <h1>Navegação — seis formatos para as três portas</h1>
  <p class="sub">Gerado de <code>flows.html</code> por <code>preview/gen-nav-preview.js</code>.
    Os tokens e o topbar são extraídos do arquivo, não copiados — este preview não consegue divergir
    do chrome real. O CSS das variantes é autoral: elas ainda não existem na página.</p>
  <p class="sub"><b>Clique nas portas.</b> O que decide entre estas seis não cabe num print: o
    indicador que desliza, o painel que desce, o rótulo que abre no hover, o foco pelo teclado
    (Tab). Em <code>D</code>, <code>alt+1/2/3</code> troca de tela.</p>

  <div class="ctrl">
    <span class="lbl">conferir em</span>
    <button class="btn ghost" type="button" id="tema">◐ trocar tema</button>
    <button class="btn ghost" type="button" id="sinal" aria-pressed="false">● ligar sinal em A · B · D · E</button>
    <button class="btn ghost" type="button" id="mov" aria-pressed="false">▭ 390px</button>
    <button class="btn ghost" type="button" id="rm" aria-pressed="false">⏸ reduced-motion</button>
  </div>

  <section class="vr" id="v-hoje">
    <div class="vh"><span class="tag">HOJE</span><h2>O que está no ar</h2></div>
    <p class="fica">Texto puro, e o ativo é um tint de <code>--accent-soft</code> a 8%. É a
      referência-contrária: as três portas têm o mesmo peso, nada diz onde você está antes de ler, e
      nenhuma delas diz o que a tela faz.</p>
    <div class="moldura">${barra(HOJE, ATUAL, false)}</div>
    <div class="zoom"><div class="zi">${barra(HOJE, ATUAL, false, true)}</div></div>
  </section>

${VARIANTES.map(secao).join("\n")}

  <div class="movel" id="movel" hidden></div>

  <p class="nota"><b>Os números são amostra.</b> «2 falhas · 24h», «21 projetos» e «1 construindo»
    estão aqui para provar que a barra aguenta a informação — não para afirmar o estado de agora.
    Se <code>F</code> (ou o sinal ligado em qualquer variante) for o escolhido, o fato tem que sair
    dos dados de verdade e o painel tem que saber dizer «não sei» enquanto ele não chegou: um número
    velho na navegação é pior que nenhum.</p>
</div>

<script>
"use strict";
const raiz = document.documentElement;

/* O indicador que desliza. Sem número mágico: o rótulo muda de largura com o
   tema e com a fonte do sistema.
   Usa offsetLeft/offsetWidth e NÃO getBoundingClientRect: a fila de zoom desta
   página é um clone dentro de um scale(1.7), e o rect vem multiplicado por 1.7
   enquanto o px que eu escrevo é em coordenada local — a pastilha nascia cobrindo
   duas portas. offsetLeft é métrica de layout e ignora transform. */
function posicionar(nav){
  const ind = nav.querySelector(".glide,.bar");
  if (!ind) return;
  const at = nav.querySelector("[aria-current=page]");
  if (!at) { ind.style.setProperty("--w","0px"); return; }
  ind.style.setProperty("--x",at.offsetLeft+"px");
  ind.style.setProperty("--w",at.offsetWidth+"px");
}
const todosNavs = () => document.querySelectorAll(".nv-a,.nv-b");
const recolocar = () => todosNavs().forEach(posicionar);

/* Trocar de porta dentro de uma barra só afeta AQUELA barra — comparar duas
   variantes exige que cada uma guarde sua própria porta atual. */
function trocar(escopo, id){
  escopo.querySelectorAll("[data-porta]").forEach(a => {
    if (a.dataset.porta === id) a.setAttribute("aria-current","page");
    else a.removeAttribute("aria-current");
  });
  const wm = escopo.querySelector(".wm span");
  if (wm) wm.textContent = "/ " + (id === "fluxos" ? "fluxos n8n" : id);
  const trg = escopo.querySelector(".nv-c .trg");
  if (trg){
    const a = escopo.querySelector('.nv-c .pane [data-porta="'+id+'"]');
    if (a) trg.querySelector("span:not(.ic)").textContent = a.querySelector(".nm").textContent;
    const ic = escopo.querySelector('.nv-c .pane [data-porta="'+id+'"] .tile svg');
    if (ic) trg.querySelector(".ic").innerHTML = ic.outerHTML;
  }
  const nav = escopo.querySelector(".nv-a,.nv-b");
  if (nav) posicionar(nav);
}

document.addEventListener("click", ev => {
  const a = ev.target.closest("[data-porta]");
  if (a){
    ev.preventDefault();
    const escopo = a.closest(".topbar") || document;
    trocar(escopo, a.dataset.porta);
    const c = a.closest(".nv-c");
    if (c) c.dataset.open = "0", c.querySelector(".trg").setAttribute("aria-expanded","false");
    return;
  }
  const t = ev.target.closest(".nv-c .trg");
  if (t){
    const c = t.closest(".nv-c");
    const abre = c.dataset.open !== "1";
    c.dataset.open = abre ? "1" : "0";
    t.setAttribute("aria-expanded", String(abre));
    return;
  }
  document.querySelectorAll('.nv-c[data-open="1"]').forEach(c => {
    c.dataset.open = "0";
    c.querySelector(".trg").setAttribute("aria-expanded","false");
  });
});

/* Hover abre o suspenso com atraso: sem os 130ms, atravessar a barra com o mouse
   abre e fecha o painel na cara de quem só ia clicar em Recarregar. */
document.querySelectorAll(".nv-c").forEach(c => {
  let t = null;
  c.addEventListener("pointerenter", () => { t = setTimeout(() => {
    c.dataset.open = "1"; c.querySelector(".trg").setAttribute("aria-expanded","true"); }, 130); });
  c.addEventListener("pointerleave", () => { clearTimeout(t);
    c.dataset.open = "0"; c.querySelector(".trg").setAttribute("aria-expanded","false"); });
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") document.querySelectorAll('.nv-c[data-open="1"]').forEach(c => {
    c.dataset.open = "0"; c.querySelector(".trg").setAttribute("aria-expanded","false");
    c.querySelector(".trg").focus();
  });
  if (ev.altKey && "123".includes(ev.key)){
    const id = ["fluxos","disco","tester"][+ev.key-1];
    document.querySelectorAll("#v-d .topbar").forEach(b => trocar(b, id));
    ev.preventDefault();
  }
});

/* ------------------------------------------------------------------ controles */
document.getElementById("tema").addEventListener("click", () => {
  const escuro = raiz.getAttribute("data-theme") === "dark"
    || (!raiz.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  raiz.setAttribute("data-theme", escuro ? "light" : "dark");
  requestAnimationFrame(recolocar);
});

const btSinal = document.getElementById("sinal");
btSinal.addEventListener("click", () => {
  const on = btSinal.getAttribute("aria-pressed") !== "true";
  btSinal.setAttribute("aria-pressed", String(on));
  btSinal.textContent = on ? "● desligar sinal em A · B · D · E" : "● ligar sinal em A · B · D · E";
  document.querySelectorAll(".sinal").forEach(e => { e.style.display = on ? "" : "none"; });
  requestAnimationFrame(recolocar);
});
btSinal.click(); btSinal.click(); // nasce desligado, mas com os nós já escondidos

const btRm = document.getElementById("rm");
btRm.addEventListener("click", () => {
  const on = btRm.getAttribute("aria-pressed") !== "true";
  btRm.setAttribute("aria-pressed", String(on));
  document.getElementById("css-rm").disabled = !on;
});

/* 390px: as mesmas seis barras num quadro estreito. É onde a variante F estoura
   e onde D ganha — e nada disso aparece no desktop. */
const btMov = document.getElementById("mov");
const alvoMov = document.getElementById("movel");
btMov.addEventListener("click", () => {
  const on = btMov.getAttribute("aria-pressed") !== "true";
  btMov.setAttribute("aria-pressed", String(on));
  alvoMov.hidden = !on;
  if (!on) return;
  if (alvoMov.childElementCount) return;
  document.querySelectorAll(".vr").forEach(v => {
    const b = v.querySelector(".moldura .topbar");
    if (!b) return;
    const q = document.createElement("div");
    q.className = "mf";
    q.appendChild(b.cloneNode(true));
    const c = document.createElement("div");
    c.className = "cap";
    c.textContent = v.id.replace("v-","").toUpperCase() + " · 390px";
    q.appendChild(c);
    alvoMov.appendChild(q);
  });
  requestAnimationFrame(recolocar);
});

addEventListener("resize", recolocar);
addEventListener("load", recolocar);
recolocar();
</script>
<style id="css-rm" disabled>
*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}
</style>
</body>
</html>
`;

const alvo = path.join(__dirname, "nav.html");
fs.writeFileSync(alvo, pagina, "utf8");
console.log("escrito: " + alvo);
console.log("abra com duplo clique — seis variantes, dois temas, 390px. Clique nas portas.");
