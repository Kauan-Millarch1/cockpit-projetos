/* gen-nav-d-preview.js — gera preview/nav-d.html.
 *
 * A variante D (cápsula ícone-primeiro) foi a escolhida, e o que falta nela é a
 * troca: uma lente de vidro que viaja entre as portas, no espírito do Liquid
 * Glass do iOS. Esta tela existe para aprovar ESSA parte, que é a única que não
 * cabe numa imagem.
 *
 * Os tokens e o topbar são EXTRAÍDOS do flows.html (via nav-comum.js), então a
 * lente é julgada sobre o fundo real, com o mesmo blur da barra por trás dela —
 * que é o que decide se o vidro se lê ou desaparece.
 *
 * Regerar: node preview/gen-nav-d-preview.js
 *
 * ANTES DE EDITAR: nenhum backtick pode entrar no template literal da página —
 * nem em comentário CSS, nem citando o nome de uma propriedade. Ele fecha a
 * string e o erro aponta para uma linha de CSS, não para a causa. Use var(--x)
 * ou aspas. Isto já custou três rodadas no gerador irmão.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { ico, PORTAS, chamaDe, cssDe } = require("./nav-comum.js");

const html = fs.readFileSync(path.join(__dirname, "..", "flows.html"), "utf8");
const css = cssDe(html);
const chama = chamaDe(html);

/* ═══════════════════════════════════════════════════════════ a cápsula (D)
   Uma diferença estrutural em relação ao que estava no comparativo: o fundo do
   ativo saiu de dentro do <a> e virou UM elemento que viaja (.lente). Enquanto
   cada porta pintava o próprio fundo, não havia o que animar entre elas — o
   estado aparecia e desaparecia. A lente é o objeto; as portas são o trilho. */
const CSS_D = `
.nvd{position:relative;display:flex;align-items:center;gap:3px;padding:3px;
  border-radius:999px;flex:0 0 auto;isolation:isolate;
  background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-soft)}
.nvd a{position:relative;z-index:1;display:flex;align-items:center;height:30px;padding:0 9px;
  border-radius:999px;color:var(--txt-faint);text-decoration:none;
  transition:color .22s ease}
.nvd a:hover{color:var(--txt-dim)}
.nvd a[aria-current=page]{color:var(--txt)}
.nvd a[aria-current=page] .ic{color:var(--accent-txt)}
.nvd .ic{display:grid;transition:transform .3s cubic-bezier(.2,.9,.15,1)}
.nvd a[aria-current=page] .ic{transform:translateY(-.5px)}

/* O rótulo abre por CSS. A lente NÃO é sincronizada com esta transição: ela
   persegue a geometria da porta ativa quadro a quadro, então o alvo dela se
   move enquanto o rótulo abre e a chegada fica arrastada. É de onde vem a
   sensação de líquido — nada aqui está roteirizado em keyframes. */
.nvd .lb{display:flex;align-items:center;gap:7px;max-width:0;overflow:hidden;opacity:0;
  white-space:nowrap;font-size:12.5px;font-weight:500;
  transition:max-width .34s cubic-bezier(.2,.9,.15,1),opacity .24s ease,
    margin-left .34s cubic-bezier(.2,.9,.15,1)}
.nvd a:hover .lb,.nvd a[aria-current=page] .lb{max-width:130px;opacity:1;margin-left:7px}
.nvd kbd{font-family:var(--font-num);font-size:9px;letter-spacing:.02em;
  color:color-mix(in srgb,var(--txt-faint) 58%,var(--txt));
  padding:1px 4px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--line);line-height:1.5}

/* ─────────────────────────────────────────────────────────── a lente de vidro
   Cinco camadas, e cada uma responde por uma coisa que o vidro do iOS faz:
     1. o corpo tingido de accent, translúcido;
     2. backdrop-filter: o que está ATRÁS aparece desfocado e mais saturado —
        por isso a lente fica ABAIXO das portas (z-index 0). Se ficasse acima,
        desfocaria o ícone e o rótulo, que é o oposto do que vidro faz com o
        objeto que ele carrega;
     3. o realce especular no topo (o gradiente radial), que é o que dá volume;
     4. o aro: uma linha clara em cima e uma escura embaixo. Sombra NEUTRA, sem
        halo colorido — a regra da casa não abre exceção para vidro;
     5. a refração de borda (::before), um anel de 3px onde o backdrop é MAIS
        desfocado, recortado com a mesma máscara xor que o .beam já usa aqui.
   translate/scale vêm de --x/--sx/--sy, escritos pela mola. A largura vem em
   --w e é animada como largura mesmo: a lente é out-of-flow, então mudar a
   largura dela não reflui nada, e fazer isso com scaleX transformaria a cápsula
   numa elipse — o raio de 999px viraria oval e a forma deixaria de ser cápsula. */
.nvd .lente{position:absolute;top:3px;left:0;height:30px;width:var(--w,30px);
  transform:translateX(var(--x,0)) scale(var(--sx,1),var(--sy,1));
  /* A origem segue o sentido do movimento: indo para a direita, escala a partir
     da borda esquerda, então quem avança é a borda DA FRENTE. Com origem no
     centro a lente esticava para os dois lados e vazava para fora do leito, o
     que lê como defeito e não como líquido — e é o contrário do que um blob faz:
     a frente puxa, a traseira segue. */
  transform-origin:var(--org,center);
  border-radius:999px;pointer-events:none;z-index:0;
  /* Afinação do tema CLARO (é a base; o escuro sobrescreve abaixo). Aqui o que
     está atrás é quase branco e quase chapado, então blur não produz efeito
     algum — o vidro se lê por contrast, pelo aro nítido em cima e pela espessura
     insinuada por uma sombra interna embaixo. brightness para cima clarearia
     ainda mais um fundo já claro: o caminho é o oposto. */
  background:
    radial-gradient(130% 170% at 28% -12%,
      color-mix(in srgb,#fff 62%,transparent), transparent 58%),
    color-mix(in srgb,var(--accent) 12%,transparent);
  backdrop-filter:blur(9px) saturate(1.5) contrast(1.06);
  -webkit-backdrop-filter:blur(9px) saturate(1.5) contrast(1.06);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb,var(--accent) 42%,transparent),
    inset 0 1.5px 0 color-mix(in srgb,#fff 90%,transparent),
    inset 0 -3px 5px -2px rgba(10,10,20,.13),
    0 3px 10px -7px rgba(10,10,20,.40)}
/* No escuro o fundo é quase preto: aí sim brightness e saturate trabalham, e o
   aro pode ser mais discreto porque o corpo tingido já se destaca sozinho. */
:root[data-theme=dark] .nvd .lente,
:root:not([data-theme=light]) .nvd .lente{
  background:
    radial-gradient(130% 170% at 28% -10%,
      color-mix(in srgb,#fff 17%,transparent), transparent 62%),
    color-mix(in srgb,var(--accent) 22%,transparent);
  backdrop-filter:blur(7px) saturate(1.9) brightness(1.06);
  -webkit-backdrop-filter:blur(7px) saturate(1.9) brightness(1.06);
  box-shadow:
    inset 0 0 0 1px var(--accent-line),
    inset 0 1px 0 color-mix(in srgb,#fff 34%,transparent),
    inset 0 -2px 3px -1px rgba(0,0,0,.22),
    0 2px 9px -6px rgba(0,0,0,.55)}
.nvd .lente::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:3px;
  backdrop-filter:blur(2px) saturate(2.4);-webkit-backdrop-filter:blur(2px) saturate(2.4);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
/* O brilho que corre na chegada. Fica em opacity 0 e é disparado por classe: um
   realce que varre sozinho a cada poll seria movimento sem informação atrás. */
.nvd .lente::after{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;
  background:linear-gradient(100deg,transparent 34%,
    color-mix(in srgb,#fff 55%,transparent) 47%,transparent 60%);
  pointer-events:none}
.nvd .lente.varre::after{animation:varrer .62s cubic-bezier(.2,.75,.2,1) 1}
@keyframes varrer{
  0%{opacity:0;transform:translateX(-40%)}
  22%{opacity:.9}
  100%{opacity:0;transform:translateX(40%)}}

/* Sem vidro: o comparativo. Mesma lente, mesma mola, só as cinco camadas fora —
   é o único jeito honesto de saber se o vidro está fazendo alguma coisa ou se é
   a mola que está fazendo todo o trabalho. */
.semvidro .nvd .lente{background:var(--accent-soft);backdrop-filter:none;
  -webkit-backdrop-filter:none;box-shadow:inset 0 0 0 1px var(--accent-line)}
.semvidro .nvd .lente::before{display:none}

@media (prefers-reduced-motion: reduce){
  /* O estado fica, o vidro fica (blur parado não é movimento). Some a viagem,
     o esticão e a varredura. A mola é desligada no JS pela mesma consulta. */
  .nvd .lb{transition:none}
  .nvd .lente{transition:none}
  .nvd .lente.varre::after{animation:none}
}`;

const capsula = (atual, comFato) => '<nav class="nvd" aria-label="telas do cockpit">'
  + '<span class="lente" aria-hidden="true"></span>'
  + PORTAS.map(p =>
      '<a href="' + p.href + '" data-porta="' + p.id + '"'
      + (p.id === atual ? ' aria-current="page"' : "") + ">"
      + '<span class="ic">' + ico(p.id) + "</span>"
      + '<span class="lb"><span>' + p.rot + "</span>"
      + (comFato ? '<span class="fato">' + p.fato + "</span>" : "<kbd>alt " + p.tecla + "</kbd>")
      + "</span></a>").join("")
  + "</nav>";

/* `so` é a fila de zoom: só a cápsula, sobre a malha. Com o wordmark dentro, a
   ampliação de 2× quebrava "COCKPIT / fluxos n8n" em duas linhas — defeito do
   preview que se leria como defeito da cápsula. */
const barra = (atual, comFato, so) => so
  ? '<header class="topbar">' + capsula(atual, comFato)
    + '<div class="spacer"></div><button class="btn ghost" type="button">◐</button></header>'
  : '<header class="topbar">'
  + '<div class="brand"><span class="flame" aria-hidden="true">' + chama + "</span>"
  + '<h1 class="wm"><b>COCKPIT</b> <span>/ '
  + (PORTAS.find(p => p.id === atual) || PORTAS[0]).sufixo + "</span></h1></div>"
  + '<div class="sep"></div>' + capsula(atual, comFato)
  + '<div class="sep"></div><div class="meta">ecommercepuro.app.n8n.cloud</div>'
  + '<div class="spacer"></div><div class="meta">14:53:07</div>'
  + '<div class="livedot on"><i></i><span>ao vivo</span></div>'
  + '<button class="btn ghost" type="button" title="Alternar tema">◐</button>'
  + '<button class="btn ghost rec" type="button"><span class="dot" aria-hidden="true">⏺</span> '
  + '<span class="lbl">Gravar</span></button>'
  + '<button class="btn beam" type="button">Recarregar</button></header>';

const pagina = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cockpit — cápsula com lente de vidro (preview)</title>
<style>
${css}
${CSS_D}

/* ══════════════════════════════════════════════════ só do preview: a moldura */
body{display:block;padding:0;background:var(--bg-deep);overflow-x:hidden}
.pv{max-width:1180px;margin:0 auto;padding:30px 24px 90px}
.pv h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}
.pv .sub{font-size:13px;color:var(--txt-faint);line-height:1.65;max-width:80ch;margin:0 0 8px}
.pv .sub code{font-family:var(--font-num);font-size:12px;color:var(--txt-dim)}
.ctrl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:18px 0 6px;
  position:sticky;top:0;z-index:80;padding:10px 0;
  background:linear-gradient(180deg,var(--bg-deep) 74%,transparent)}
.ctrl .lbl{font-family:var(--font-num);font-size:10.5px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--txt-faint);margin-right:2px}
.bl{margin-top:26px;padding-top:22px;border-top:1px solid var(--line-soft)}
.bl h2{font-size:15px;margin:0 0 5px;letter-spacing:-.01em}
.bl p{font-size:12.5px;color:var(--txt-dim);line-height:1.62;max-width:82ch;margin:0 0 14px}
/* A malha e o feixe ficam ATRÁS da barra, não embaixo dela. É o que o
   .backdrop faz na página real: uma camada fixa no fundo que a barra
   translúcida amostra. Com a moldura chapada, o backdrop-filter da lente não
   tinha o que refratar e o vidro no tema claro sumia — o defeito era do preview,
   não da lente. Por isso nada aqui tem isolation nem overflow que isole: a
   amostragem do backdrop precisa alcançar estas duas camadas. */
.moldura{position:relative;border-radius:14px;border:1px solid var(--line);
  background:var(--bg);box-shadow:var(--shadow);overflow:hidden}
.moldura .malha{position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    linear-gradient(var(--grid) 1px,transparent 1px) 0 0/34px 34px,
    linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/34px 34px}
.moldura .raio{position:absolute;left:-30%;top:26px;width:56%;height:1px;z-index:0;
  pointer-events:none;opacity:.55;
  background:linear-gradient(90deg,transparent,var(--accent),transparent);
  animation:corre 13s linear infinite}
@keyframes corre{to{transform:translateX(280%)}}
.moldura .topbar{position:relative;z-index:1;border-radius:14px 14px 0 0}
.moldura .brand,.moldura .livedot{flex:0 0 auto;white-space:nowrap}
.moldura .meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.palco{position:relative;z-index:1;height:120px}
.zoom{margin-top:14px;height:112px;border-radius:12px;border:1px dashed var(--line);
  background:var(--bg);overflow:hidden;position:relative}
.zoom .malha{position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    linear-gradient(var(--grid) 1px,transparent 1px) 0 0/58px 58px,
    linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/58px 58px}
.zi{position:relative;z-index:1;transform:scale(2);transform-origin:0 0;width:50%}
.zi .topbar{position:static;background:transparent;backdrop-filter:none;border-bottom:0}
.nota{font-size:12px;color:var(--txt-faint);line-height:1.65;max-width:82ch;margin:24px 0 0;
  padding:14px 16px;border-radius:12px;background:var(--surface-2);
  box-shadow:inset 0 0 0 1px var(--line-soft)}
.nota b{color:var(--txt-dim)}
.nvd .fato{font-family:var(--font-num);font-size:9.5px;letter-spacing:.03em;
  color:color-mix(in srgb,var(--txt-faint) 58%,var(--txt))}
/* A tira: seis poses estáticas, uma por linha, com a malha atrás de cada uma
   para o vidro ter o que refratar — igual à barra real. */
.tira{display:grid;gap:8px}
.tira .q{position:relative;display:flex;align-items:center;gap:14px;padding:10px 14px;
  border-radius:12px;border:1px solid var(--line-soft);background:var(--bg);overflow:hidden}
.tira .q .malha{position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    linear-gradient(var(--grid) 1px,transparent 1px) 0 0/34px 34px,
    linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/34px 34px}
.tira .q .nvd{z-index:1}
.tira .q .leg{z-index:1;margin-left:auto;display:flex;gap:16px;align-items:baseline;
  font-family:var(--font-num);font-size:10.5px;color:var(--txt-faint);white-space:nowrap}
.tira .q .leg b{color:var(--txt-dim);font-weight:500}
.tira .q .ms{z-index:1;font-family:var(--font-num);font-size:11px;color:var(--accent-txt);
  min-width:52px}
</style>
</head>
<body>
<div class="pv">
  <h1>Cápsula ícone-primeiro — a lente de vidro que viaja</h1>
  <p class="sub">Gerado de <code>flows.html</code> por <code>preview/gen-nav-d-preview.js</code>.
    Tokens e topbar extraídos do arquivo; a lente é a proposta. Nada disto está no sistema ainda.</p>
  <p class="sub"><b>Clique nas portas</b> — ou deixe o desfile correndo. A varredura de brilho, o
    esticão no voo e o arraste da chegada não existem numa imagem.</p>

  <div class="ctrl">
    <span class="lbl">conferir</span>
    <button class="btn ghost" type="button" id="desfile" aria-pressed="true">⏸ pausar desfile</button>
    <button class="btn ghost" type="button" id="lento" aria-pressed="false">◷ 0,3× lento</button>
    <button class="btn ghost" type="button" id="vidro" aria-pressed="true">◇ desligar vidro</button>
    <button class="btn ghost" type="button" id="tema">◐ trocar tema</button>
    <button class="btn ghost" type="button" id="rm" aria-pressed="false">⏸ reduced-motion</button>
  </div>

  <section class="bl">
    <h2>Na barra, tamanho real</h2>
    <p>É assim que ela vai aparecer. O palco abaixo carrega a malha e o feixe do fundo real —
      sem eles o <code>backdrop-filter</code> não tem o que refratar e o vidro parece um retângulo
      translúcido qualquer.</p>
    <div class="moldura"><i class="malha"></i><i class="raio"></i>
      <div id="real">${barra("fluxos", false)}</div><div class="palco"></div></div>
    <div class="zoom"><i class="malha"></i>
      <div class="zi" id="zoomA">${barra("fluxos", false, true)}</div></div>
  </section>

  <section class="bl">
    <h2>Com o fato ao vivo no lugar do atalho</h2>
    <p>A mesma cápsula carregando <code>2 falhas · 24h</code> em vez de <code>alt 1</code>. Vale ver
      porque muda a largura do rótulo — e a largura do rótulo é o que a lente persegue. Os números
      são amostra.</p>
    <div class="moldura"><i class="malha"></i><i class="raio"></i>
      <div id="fato">${barra("fluxos", true)}</div><div class="palco"></div></div>
  </section>

  <section class="bl">
    <h2>O voo, quadro a quadro</h2>
    <p>Seis instantes de uma troca da primeira porta para a terceira. Não é ilustração: a página
      integra a <b>mesma mola</b>, com a mesma geometria lida das portas de verdade, e desenha a
      pose de cada instante. É a única forma de a animação caber numa imagem.
      Uma ressalva que a tira não consegue mostrar: <b>só a lente se move aqui</b> — os rótulos
      estão congelados no estado final, quando na tela eles abrem junto, e é justamente esse alvo
      em movimento que faz a chegada ficar arrastada.</p>
    <div class="tira" id="tira"></div>
  </section>

  <p class="nota"><b>O que a mola faz e o que ela não faz.</b> É o mesmo integrador do
    <code>springNumber()</code> do <code>flows.html</code>, com outra afinação: lá a razão de
    amortecimento é ~0,97 de propósito, porque um contador que passa do valor e volta lê como dado
    errado; aqui ela é ~0,55, porque passar e voltar é o que faz parecer líquido. O esticão
    (<code>--sx</code>/<code>--sy</code>) é <b>derivado da velocidade da própria mola</b>, não
    roteirizado: a lente estica no eixo do movimento e comprime no outro, com volume preservado.
    E o alvo é lido a cada quadro em vez de medido uma vez — os rótulos abrem por CSS, então a
    geometria de destino muda durante o voo e a chegada fica arrastada. Nada disto é keyframe.</p>
</div>

<script>
"use strict";
const raiz = document.documentElement;
const REDUZIR = () => matchMedia("(prefers-reduced-motion: reduce)").matches
  || raiz.hasAttribute("data-rm");
let ESCALA = 1; // 1 = normal, 0.3 = lento

/* ═══════════════════════════════════════════════════════════════ a mola
   Mesmo integrador do springNumber() do flows.html — passo fixo de 16ms, porque
   com a aba em segundo plano o dt real explode e a mola diverge em vez de
   assentar. A afinação é outra e a razão está na nota da página.
   Duas molas por cápsula: posição e largura. Elas não são "iniciadas" a cada
   troca — o alvo muda e elas continuam de onde estão, que é o que torna a
   interrupção no meio do voo natural em vez de um corte. */
const MOLA = { k: 170, c: 14, m: 1 };   // razao de amortecimento ~0,54
/* Quanto a velocidade vira deformação. Medido: com 0,055 o esticão batia no teto
   de 20% e ficava GRUDADO nele durante metade do voo — deformação constante lê
   como escala fixa, não como física. Em 0,022 o pico chega perto do teto sem
   saturar, e um pulo curto (porta vizinha) deforma menos que um pulo longo, que
   é o comportamento que se espera de algo com massa. */
const ESTICA = 0.022;
const TETO = 0.16;

function animar(nav){
  const lente = nav.querySelector(".lente");
  if (!lente) return;
  const est = { x:0, vx:0, w:30, vw:0, pronto:false, vivo:false };
  nav._est = est;

  const alvo = () => {
    const a = nav.querySelector("[aria-current=page]");
    if (!a) return null;
    // Lido A CADA QUADRO: o rotulo abre por CSS, entao o destino se move.
    let x = a.offsetLeft, w = a.offsetWidth;
    // Ima: com o cursor sobre uma porta inativa a lente se inclina para ela.
    // 4px é o suficiente para ler como intenção e pouco para não parecer erro.
    const h = nav.querySelector("a:hover");
    if (h && h !== a) x += Math.sign(h.offsetLeft - a.offsetLeft) * 4;
    return { x, w };
  };

  const passo = () => {
    const t = alvo();
    if (!t) { est.vivo = false; return; }
    if (REDUZIR()){
      est.x = t.x; est.w = t.w; est.vx = est.vw = 0;
      pintar(0); est.vivo = false; return;
    }
    const dt = 0.016 * ESCALA;
    for (let i = 0; i < 2; i++){
      est.vx += ((-MOLA.k*(est.x - t.x) - MOLA.c*est.vx)/MOLA.m) * dt; est.x += est.vx * dt;
      est.vw += ((-MOLA.k*(est.w - t.w) - MOLA.c*est.vw)/MOLA.m) * dt; est.w += est.vw * dt;
    }
    pintar(est.vx);
    const parado = Math.abs(t.x-est.x) < .35 && Math.abs(est.vx) < 3
                && Math.abs(t.w-est.w) < .35 && Math.abs(est.vw) < 3;
    if (parado){ est.x = t.x; est.w = t.w; est.vx = est.vw = 0; pintar(0); est.vivo = false; return; }
    requestAnimationFrame(passo);
  };

  /* A deformacao SAI da velocidade. sx cresce no eixo do movimento e sy encolhe
     na mesma proporção reduzida — volume preservado, que é o que separa vidro
     líquido de pastilha com easing. Teto de 20% porque acima disso a cápsula
     deixa de parecer cápsula. */
  function pintar(v){
    const d = Math.min(TETO, Math.abs(v) * ESTICA / 100);
    lente.style.setProperty("--x", est.x.toFixed(2)+"px");
    lente.style.setProperty("--w", est.w.toFixed(2)+"px");
    lente.style.setProperty("--sx", (1 + d).toFixed(3));
    lente.style.setProperty("--sy", (1 - d*0.72).toFixed(3));
    // Só troca a origem com velocidade que se leia: perto de zero o sinal fica
    // trocando de lado a cada quadro e a lente tremia no assentamento.
    if (Math.abs(v) > 12) lente.style.setProperty("--org", v > 0 ? "left center" : "right center");
  }

  est.acordar = () => { if (!est.vivo){ est.vivo = true; requestAnimationFrame(passo); } };
  est.assentar = () => { const t = alvo(); if (!t) return;
    est.x = t.x; est.w = t.w; est.vx = est.vw = 0; pintar(0); };
  est.assentar();
  nav.addEventListener("pointerover", est.acordar);
  nav.addEventListener("pointerout", est.acordar);
}

function trocar(escopo, id, humano){
  const nav = escopo.querySelector(".nvd");
  if (!nav) return;
  const atualJa = nav.querySelector("[aria-current=page]");
  if (atualJa && atualJa.dataset.porta === id) return;
  nav.querySelectorAll("[data-porta]").forEach(a => {
    if (a.dataset.porta === id) a.setAttribute("aria-current","page");
    else a.removeAttribute("aria-current");
  });
  const wm = escopo.querySelector(".wm span");
  if (wm) wm.textContent = "/ " + SUFIXO[id];
  const lente = nav.querySelector(".lente");
  if (lente && !REDUZIR()){
    // Reinicia a varredura: remover a classe e forçar reflow é o que permite
    // disparar a mesma animação duas vezes seguidas.
    lente.classList.remove("varre"); void lente.offsetWidth; lente.classList.add("varre");
  }
  if (nav._est) nav._est.acordar();
}

const SUFIXO = ${JSON.stringify(Object.fromEntries(PORTAS.map(p => [p.id, p.sufixo])))};
const ORDEM = ${JSON.stringify(PORTAS.map(p => p.id))};

// Todas as cápsulas da página trocam juntas: comparar o vidro ligado e desligado
// exige que as duas estejam na mesma porta no mesmo instante.
const escopos = () => [...document.querySelectorAll(".moldura .topbar, .zi .topbar")];
function trocarTodas(id){ escopos().forEach(e => trocar(e, id)); }

document.querySelectorAll(".nvd").forEach(animar);

document.addEventListener("click", ev => {
  const a = ev.target.closest("[data-porta]");
  if (!a) return;
  ev.preventDefault();
  pausar();
  trocarTodas(a.dataset.porta);
});
document.addEventListener("keydown", ev => {
  if (ev.altKey && "123".includes(ev.key)){ pausar(); trocarTodas(ORDEM[+ev.key-1]); ev.preventDefault(); }
});

/* ------------------------------------------------------------------ controles */
let volta = null, i = 0;
const btDesfile = document.getElementById("desfile");
function pausar(){ if (!volta) return; clearInterval(volta); volta = null;
  btDesfile.setAttribute("aria-pressed","false"); btDesfile.textContent = "▶ retomar desfile"; }
function correr(){ if (volta) return;
  volta = setInterval(() => { i = (i+1) % ORDEM.length; trocarTodas(ORDEM[i]); }, 2200);
  btDesfile.setAttribute("aria-pressed","true"); btDesfile.textContent = "⏸ pausar desfile"; }
btDesfile.addEventListener("click", () => volta ? pausar() : correr());
correr();

const btLento = document.getElementById("lento");
btLento.addEventListener("click", () => {
  const on = btLento.getAttribute("aria-pressed") !== "true";
  btLento.setAttribute("aria-pressed", String(on));
  ESCALA = on ? 0.3 : 1;
  btLento.textContent = on ? "◷ velocidade normal" : "◷ 0,3× lento";
});

const btVidro = document.getElementById("vidro");
btVidro.addEventListener("click", () => {
  const on = btVidro.getAttribute("aria-pressed") !== "true";
  btVidro.setAttribute("aria-pressed", String(on));
  document.body.classList.toggle("semvidro", !on);
  btVidro.textContent = on ? "◇ desligar vidro" : "◇ ligar vidro";
});

document.getElementById("tema").addEventListener("click", () => {
  const escuro = raiz.getAttribute("data-theme") === "dark"
    || (!raiz.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  raiz.setAttribute("data-theme", escuro ? "light" : "dark");
});

const btRm = document.getElementById("rm");
btRm.addEventListener("click", () => {
  const on = btRm.getAttribute("aria-pressed") !== "true";
  btRm.setAttribute("aria-pressed", String(on));
  document.getElementById("css-rm").disabled = !on;
  if (on) raiz.setAttribute("data-rm",""); else raiz.removeAttribute("data-rm");
  document.querySelectorAll(".nvd").forEach(n => n._est && n._est.assentar());
});

addEventListener("resize", () => document.querySelectorAll(".nvd").forEach(n => n._est && n._est.assentar()));

/* ═════════════════════════════════════════════════ a tira: o voo numa imagem
   Integra a MESMA mola fora da tela, com a geometria real lida das portas, e
   desenha a pose de seis instantes. Reescrever a física aqui provaria a cópia,
   não a animação — por isso o passo é o mesmo laço do animar(). */
(function tira(){
  const alvoDiv = document.getElementById("tira");
  const base = document.querySelector("#real .nvd");
  if (!alvoDiv || !base) return;

  const portas = [...base.querySelectorAll("a")];
  const de = { x: portas[0].offsetLeft, w: portas[0].offsetWidth };
  // A porta 3 medida COM o rótulo aberto: é a geometria que a lente persegue.
  // Sem simular a abertura, a largura de destino sairia a do ícone sozinho.
  const larguraAberta = portas[0].offsetWidth;
  const para = { x: portas[2].offsetLeft - (larguraAberta - portas[2].offsetWidth),
                 w: larguraAberta };

  /* Instantes escolhidos pelo que cada um mostra: a partida, a aceleração, o
     pico de deformação, a desaceleração, a passada além do alvo (velocidade
     negativa) e o repouso. Um sétimo quadro depois de ~290ms repetiria o sexto. */
  const INSTANTES = [0, 24, 64, 112, 176, 288];
  let x = de.x, vx = 0, w = de.w, vw = 0, t = 0;
  const poses = [];
  const passo = () => {
    const dt = 0.016;
    vx += ((-MOLA.k*(x - para.x) - MOLA.c*vx)/MOLA.m) * dt; x += vx * dt;
    vw += ((-MOLA.k*(w - para.w) - MOLA.c*vw)/MOLA.m) * dt; w += vw * dt;
    t += 16;
  };
  for (const ms of INSTANTES){
    while (t < ms) passo();
    const d = Math.min(TETO, Math.abs(vx) * ESTICA / 100);
    poses.push({ ms, x, w, sx: 1+d, sy: 1-d*0.72, v: vx,
      org: Math.abs(vx) > 12 ? (vx > 0 ? "left center" : "right center") : "center" });
  }

  alvoDiv.innerHTML = poses.map(p => {
    const nav = base.cloneNode(true);
    nav.querySelectorAll("[data-porta]").forEach(a => a.removeAttribute("aria-current"));
    // O rótulo da porta de destino é forçado aberto: durante o voo ele JÁ está
    // abrindo, e uma tira com todos fechados mostraria um voo que não acontece.
    const dest = nav.querySelectorAll("[data-porta]")[2];
    dest.setAttribute("aria-current","page");
    const l = nav.querySelector(".lente");
    l.style.cssText = "--x:"+p.x.toFixed(1)+"px;--w:"+p.w.toFixed(1)+"px;"
      + "--sx:"+p.sx.toFixed(3)+";--sy:"+p.sy.toFixed(3)+";--org:"+p.org;
    return '<div class="q"><i class="malha"></i><span class="ms">'+p.ms+' ms</span>'
      + nav.outerHTML
      + '<span class="leg"><span>estica <b>'+((p.sx-1)*100).toFixed(1)+'%</b></span>'
      + '<span>comprime <b>'+((1-p.sy)*100).toFixed(1)+'%</b></span>'
      + '<span>velocidade <b>'+Math.round(p.v)+' px/s</b></span></span></div>';
  }).join("");
})();
</script>
<style id="css-rm" disabled>
.nvd .lb{transition:none!important}
.nvd .lente::after{animation:none!important}
.palco::after{animation:none!important}
</style>
</body>
</html>
`;

const alvo = path.join(__dirname, "nav-d.html");
fs.writeFileSync(alvo, pagina, "utf8");
console.log("escrito: " + alvo);
console.log("abra com duplo clique — o desfile já começa correndo. 0,3× lento mostra o esticão.");
