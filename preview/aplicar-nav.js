/* aplicar-nav.js — instala a cápsula com lente de vidro nas QUATRO páginas.
 *
 * Existe por um motivo só: o CSS, o HTML e o JS da navegação têm que ser
 * IDÊNTICOS em flows.html, tester.html, cockpit.html e upgrade.html, e nenhuma
 * das quatro tem build. Aplicar à mão é como as cópias divergem — o CLAUDE.md
 * documenta isso como dívida desde que o topbar foi unificado. Aqui o texto é
 * gerado UMA vez e escrito nos quatro arquivos, e `nav-sync-test.js` falha no
 * dia em que alguém editar uma só.
 *
 * As PORTAS são quatro e vêm de nav-comum.js, o mesmo arquivo que alimentou os
 * previews — o que foi aprovado na tela é o que entra na página. As portas de
 * login e de integrações saíram em 09/09/2026, quando o dono decidiu não
 * produtizar: `/conta`, `/entrar` e `/integracoes` não existem mais, nem como
 * rota nem como ícone aqui.
 *
 * Não é código de produção e não é servido. Roda uma vez:
 *   node preview/aplicar-nav.js
 *
 * ANTES DE EDITAR: todo backtick dentro dos template literals dos blocos tem
 * que vir ESCAPADO (\`). Eles carregam CSS e JS, e um backtick solto fecha a
 * string com um erro que aponta para a linha errada — foi exatamente o que
 * aconteceu: quatro comentários do bloco JS citavam identificadores entre
 * backticks e este arquivo ficou impossível de carregar, sem ninguém notar,
 * porque `nav-sync-test.js` o lê como TEXTO e nunca o `require`.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { ico, PORTAS } = require("./nav-comum.js");

const RAIZ = path.join(__dirname, "..");

/* ═══════════════════════════════════════════════════════════════════ o CSS */
const CSS = `/* ═══════════════════════════════════════════════════════ NAV — as quatro portas
   BLOCO COMPARTILHADO. Este CSS é IDÊNTICO em flows.html, tester.html,
   cockpit.html e upgrade.html — gerado por preview/aplicar-nav.js e travado por
   nav-sync-test.js. Ao mudar, rode o gerador de novo; NÃO edite uma página só,
   e nunca insira um segundo bloco (foi assim que o rabo de um bloco antigo
   ficou pendurado no flows.html e a página morreu com "Illegal return
   statement").

   A cápsula é ícone-primeiro: o rótulo existe na porta ativa, sob o cursor e no
   foco de teclado. O fundo do ativo NÃO é pintado por cada porta — é UM
   elemento que viaja, a .lente, movida por mola no JS. Enquanto cada porta
   pintava o próprio fundo não havia o que animar entre elas: o estado aparecia
   e desaparecia.

   Cor: corpo e aro da lente são --accent, que neste painel significa MOVIMENTO.
   Status (ok/warn/risk/cold) continua reservado e não entra na navegação. */
.nvd{position:relative;display:flex;align-items:center;gap:3px;padding:3px;
  border-radius:999px;flex:0 0 auto;background:var(--surface-2);
  box-shadow:inset 0 0 0 1px var(--line-soft)}
.nvd a{position:relative;z-index:1;display:flex;align-items:center;height:30px;
  padding:0 9px;border-radius:999px;color:var(--txt-faint);text-decoration:none;
  transition:color .22s ease}
.nvd a:hover{color:var(--txt-dim)}
.nvd a[aria-current="page"]{color:var(--txt)}
.nvd a[aria-current="page"] .ic{color:var(--accent-txt)}
.nvd a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.nvd .ic{display:grid;transition:transform .3s cubic-bezier(.2,.9,.15,1)}
.nvd a[aria-current="page"] .ic{transform:translateY(-.5px)}
/* O rótulo abre por CSS e a lente NÃO é sincronizada com esta transição: ela
   persegue a geometria da porta ativa quadro a quadro, então o alvo se move
   enquanto o rótulo abre e a chegada fica arrastada. É de onde vem a sensação
   de líquido — não há keyframe de viagem em nenhum lugar.
   Abre também no foco de teclado: navegando por Tab, um ícone sozinho não diz
   para onde se vai. */
.nvd .lb{display:flex;align-items:center;gap:7px;max-width:0;overflow:hidden;
  opacity:0;white-space:nowrap;font-size:12.5px;font-weight:500;
  transition:max-width .34s cubic-bezier(.2,.9,.15,1),opacity .24s ease,
    margin-left .34s cubic-bezier(.2,.9,.15,1)}
.nvd a:hover .lb,.nvd a:focus-visible .lb,.nvd a[aria-current="page"] .lb{
  max-width:130px;opacity:1;margin-left:7px}
/* O atalho é anunciado no lugar onde é usado. O chip só se paga porque o atalho
   EXISTE (alt+1 a alt+4 navega): um rótulo prometendo tecla que não faz nada é pior
   que nenhum rótulo. */
.nvd kbd{font-family:var(--font-num);font-size:9px;letter-spacing:.02em;
  color:color-mix(in srgb,var(--txt-faint) 58%,var(--txt));
  padding:1px 4px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--line);
  line-height:1.5}
/* ─────────────────────────────────────────────────────────── a lente de vidro
   Cinco camadas, cada uma respondendo por uma coisa que vidro faz:
     1. corpo tingido translúcido;
     2. backdrop-filter — o que está ATRÁS aparece desfocado. Por isso a lente
        fica ABAIXO das portas (z-index 0): acima, desfocaria o próprio ícone e
        o rótulo, que é o contrário do que vidro faz com o objeto que carrega;
     3. realce especular no topo, que dá volume;
     4. o aro: linha clara em cima, escura embaixo. Sombra externa NEUTRA — a
        regra da casa não abre exceção de halo colorido para vidro;
     5. refração de borda (::before): um anel de 3px onde o backdrop é mais
        desfocado, recortado com a mesma máscara xor que o .beam já usa aqui.
   --x/--w/--sx/--sy vêm da mola. A largura é animada como LARGURA mesmo: a
   lente é out-of-flow, então mudar a largura dela não reflui nada, e fazer isso
   com scaleX transformaria a cápsula numa elipse (o raio de 999px viraria oval).
   A afinação do tema claro é a base e a do escuro sobrescreve: atrás do claro o
   fundo é quase branco e chapado, onde blur não produz efeito e brightness
   pioraria — ali o vidro se lê por contrast, aro nítido e sombra interna. */
.nvd .lente{position:absolute;top:3px;left:0;height:30px;width:var(--w,30px);opacity:0;
  transform:translateX(var(--x,0)) scale(var(--sx,1),var(--sy,1));
  transform-origin:var(--org,center);
  border-radius:999px;pointer-events:none;z-index:0;
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
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]) .nvd .lente{
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
}
:root[data-theme="dark"] .nvd .lente{
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
.nvd .lente.pronta{opacity:1}
.nvd .lente::before{content:"";position:absolute;inset:0;border-radius:inherit;
  padding:3px;pointer-events:none;
  backdrop-filter:blur(2px) saturate(2.4);
  -webkit-backdrop-filter:blur(2px) saturate(2.4);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude}
/* O brilho que corre na chegada. Nasce em opacity 0 e é disparado por classe:
   um realce varrendo sozinho seria movimento sem informação atrás. */
.nvd .lente::after{content:"";position:absolute;inset:0;border-radius:inherit;
  opacity:0;pointer-events:none;
  background:linear-gradient(100deg,transparent 34%,
    color-mix(in srgb,#fff 55%,transparent) 47%,transparent 60%)}
.nvd .lente.varre::after{animation:navvarrer .62s cubic-bezier(.2,.75,.2,1) 1}
@keyframes navvarrer{
  0%{opacity:0;transform:translateX(-40%)}
  22%{opacity:.9}
  100%{opacity:0;transform:translateX(40%)}}
/* Em tela estreita o rótulo sai de cena, inclusive o do ativo: o sufixo do
   wordmark ao lado já diz em que tela você está, e três rótulos abertos
   estouravam a barra em 390px. */
@media (max-width:620px){
  .nvd a:hover .lb,.nvd a:focus-visible .lb,.nvd a[aria-current="page"] .lb{
    max-width:0;opacity:0;margin-left:0}
}
@media (prefers-reduced-motion: reduce){
  /* O estado fica e o vidro fica — blur parado não é movimento. Somem a viagem,
     o esticão e a varredura. A mola é desligada no JS pela mesma consulta. */
  .nvd .lb,.nvd .ic,.nvd a{transition:none}
  .nvd .lente.varre::after{animation:none}
}`;

/* ═════════════════════════════════════════════════════════════════ o markup */
const marcacao = atual => '<nav class="nvd" aria-label="telas do cockpit">\n'
  + '    <span class="lente" aria-hidden="true"></span>\n'
  + PORTAS.map(p =>
      '    <a href="' + (p.id === "fluxos" ? "/" : "/" + p.id) + '" data-porta="' + p.id + '"'
      + (p.id === atual ? ' aria-current="page"' : "") + ">"
      + '<span class="ic">' + ico(p.id) + "</span>"
      + '<span class="lb"><span>' + p.rot + "</span><kbd>alt " + p.tecla + "</kbd></span>"
      + "</a>").join("\n")
  + "\n  </nav>";

/* ════════════════════════════════════════════════════════════════════ o JS */
const JS = `<script>
/* ═══════════════════════════════════════════════════ NAV — a lente de vidro
   BLOCO COMPARTILHADO. Idêntico em flows.html, tester.html, cockpit.html e upgrade.html,
   gerado por preview/aplicar-nav.js e travado por nav-sync-test.js.

   As quatro portas são navegação DE VERDADE: clicar recarrega a página. Então a
   lente nunca seria vista viajando — cada página nasceria com ela parada no
   lugar. Ela parte da porta DE ONDE VOCÊ VEIO, guardada em sessionStorage, e
   voa até a atual no carregamento. Mesma disciplina do resto do painel: só
   anima quando há informação nova atrás (você trocou de tela); F5 na mesma
   porta não anima nada, e uma aba nova também não, porque ali você não veio de
   lugar algum.

   Nada aqui julga: a navegação não tem estado de saúde, não lê fato nenhum e
   não faz uma única chamada. */
(function () {
  "use strict";
  var nav = document.querySelector(".nvd");
  if (!nav) return;
  var lente = nav.querySelector(".lente");
  if (!lente) return;

  var CHAVE = "cockpit.nav.v1";
  var reduzir = function () {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  };

  /* Mesmo integrador do springNumber() — passo fixo de 16ms, porque com a aba em
     segundo plano o dt real explode e a mola diverge em vez de assentar. A
     afinação é OUTRA de propósito: lá a razão de amortecimento é ~0,97, porque
     um contador que passa do valor e volta lê como dado errado; aqui é ~0,54,
     porque passar e voltar é o que faz parecer líquido. */
  var K = 170, C = 14, M = 1;
  /* Quanto a velocidade vira deformação. Medido: em 0,055 o esticão grudava no
     teto e deformação constante lê como escala fixa, não como física. */
  var ESTICA = 0.022, TETO = 0.16;

  var x = 0, vx = 0, w = 30, vw = 0, vivo = false;

  function alvo() {
    var a = nav.querySelector('[aria-current="page"]');
    if (!a) return null;
    /* Lido A CADA QUADRO: o rótulo abre por CSS, então o destino se move. */
    var ax = a.offsetLeft, aw = a.offsetWidth;
    /* Ímã: com o cursor sobre uma porta inativa a lente se inclina para ela.
       4px lê como intenção e é pouco para não parecer erro. */
    var h = nav.querySelector("a:hover");
    /* \`ax\` JÁ é \`a.offsetLeft\`: ler de novo aqui era uma quarta leitura de
       geometria por quadro, e cada uma força layout do documento inteiro. */
    if (h && h !== a) ax += (h.offsetLeft > ax ? 1 : -1) * 4;
    return { x: ax, w: aw };
  }

  /* A deformação SAI da velocidade da própria mola: estica no eixo do movimento
     e comprime no outro, volume preservado. É o que separa vidro líquido de
     pastilha com easing. A origem segue o sentido do movimento — com origem no
     centro a lente esticava para os dois lados e vazava para fora do leito. */
  function pintar(v) {
    var d = Math.min(TETO, Math.abs(v) * ESTICA / 100);
    lente.style.setProperty("--x", x.toFixed(2) + "px");
    lente.style.setProperty("--w", w.toFixed(2) + "px");
    lente.style.setProperty("--sx", (1 + d).toFixed(3));
    lente.style.setProperty("--sy", (1 - d * 0.72).toFixed(3));
    if (Math.abs(v) > 12) {
      lente.style.setProperty("--org", v > 0 ? "left center" : "right center");
    }
  }

  function assentar() {
    var t = alvo();
    if (!t) return;
    x = t.x; w = t.w; vx = 0; vw = 0;
    lente.style.setProperty("--org", "center");
    pintar(0);
  }

  function passo() {
    var t = alvo();
    if (!t) { vivo = false; return; }
    if (reduzir()) { assentar(); vivo = false; return; }
    var i, dt = 0.016;
    for (i = 0; i < 2; i++) {
      vx += ((-K * (x - t.x) - C * vx) / M) * dt; x += vx * dt;
      vw += ((-K * (w - t.w) - C * vw) / M) * dt; w += vw * dt;
    }
    pintar(vx);
    if (Math.abs(t.x - x) < 0.35 && Math.abs(vx) < 3 &&
        Math.abs(t.w - w) < 0.35 && Math.abs(vw) < 3) {
      x = t.x; w = t.w; vx = 0; vw = 0; pintar(0); vivo = false; return;
    }
    requestAnimationFrame(passo);
  }

  function acordar() { if (!vivo) { vivo = true; requestAnimationFrame(passo); } }

  var aqui = (nav.querySelector('[aria-current="page"]') || {}).dataset;
  aqui = aqui ? aqui.porta : null;

  /* A partida. Se a porta anterior desta aba não é esta, a lente nasce lá e voa
     para cá. Só então a varredura de brilho se paga: ela marca uma chegada. */
  var de = null;
  try { de = sessionStorage.getItem(CHAVE); } catch (e) { de = null; }
  var origem = de && de !== aqui ? nav.querySelector('[data-porta="' + de + '"]') : null;

  /* A PARTIDA RODA DEPOIS DA PRIMEIRA PINTURA, e isto é medição, não gosto.
     Ler \`offsetLeft\` durante a execução do script ANTECIPA o primeiro layout do
     documento e o torna síncrono: 209 ms de thread bloqueada no \`/disco\` e 126 ms
     no \`/tester\` (as duas funções nº 1 de JS no boot dessas telas). O \`/upgrade\`,
     com o dobro do CSS, custa 0 ms no mesmo ponto — a diferença é só QUANDO o
     script corre em relação ao layout já estar limpo.
     Dois quadros: o primeiro deixa o navegador fazer o layout dele, o segundo lê
     uma árvore que já existe. A lente fica invisível (\`opacity:0\`) até estar
     posicionada, então o adiamento não vira flash no lugar errado. */
  function partir() {
    if (origem && !reduzir()) {
      x = origem.offsetLeft; w = origem.offsetWidth; vx = 0; vw = 0;
      pintar(0);
      lente.classList.add("varre");
      acordar();
    } else {
      assentar();
    }
    lente.classList.add("pronta");
  }
  requestAnimationFrame(function () { requestAnimationFrame(partir); });
  try { if (aqui) sessionStorage.setItem(CHAVE, aqui); } catch (e) {}

  nav.addEventListener("pointerover", acordar);
  nav.addEventListener("pointerout", acordar);
  addEventListener("resize", assentar);

  /* O atalho que o chip promete. Navega de verdade; alt+dígito não digita nada
     em campo de texto, então não precisa de guarda contra o compositor. */
  addEventListener("keydown", function (ev) {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var i = "1234".indexOf(ev.key);
    if (i < 0) return;
    var a = nav.querySelectorAll("a")[i];
    if (!a || a.getAttribute("aria-current") === "page") return;
    ev.preventDefault();
    location.href = a.getAttribute("href");
  });
}());
</script>`;

/* ═══════════════════════════════════════════════════════════════ aplicação */
const ALVOS = [
  { arq: "flows.html", porta: "fluxos" },
  { arq: "tester.html", porta: "tester" },
  { arq: "cockpit.html", porta: "disco" },
  { arq: "upgrade.html", porta: "upgrade" }
];

// O CSS antigo do .pages ocupa um pedaço contíguo em cada arquivo, e cada um o
// escreve com formatação própria. Recorto do PRIMEIRO seletor `.pages` até a
// última regra dele, achando o fim pela última chave antes do próximo seletor
// que não começa com `.pages`.
function trocarCss(txt) {
  const i = txt.search(/^[ \t]*\.pages\s*\{/m);
  if (i < 0) throw new Error(".pages não encontrado");
  // Varre as regras seguintes enquanto o seletor começar com .pages
  let k = i;
  for (;;) {
    const fecha = txt.indexOf("}", k);
    if (fecha < 0) throw new Error(".pages: chave de fechamento não encontrada");
    const resto = txt.slice(fecha + 1);
    const prox = resto.match(/^\s*([^{}]*?)\{/);
    if (prox && /(^|[\s,])\.pages(\s|,|:|\[|\{)/.test(prox[1])) {
      k = fecha + 1 + prox[0].length;
      continue;
    }
    return txt.slice(0, i) + CSS + txt.slice(fecha + 1);
  }
}

function trocarMarcacao(txt, porta) {
  const i = txt.indexOf('<nav class="pages"');
  if (i < 0) throw new Error('<nav class="pages"> não encontrado');
  const f = txt.indexOf("</nav>", i);
  if (f < 0) throw new Error("</nav> da navegação não encontrado");
  return txt.slice(0, i) + marcacao(porta) + txt.slice(f + 6);
}

function inserirJs(txt) {
  const marca = "\n</body>";
  const i = txt.lastIndexOf(marca);
  if (i < 0) throw new Error("</body> não encontrado");
  return txt.slice(0, i) + "\n" + JS + txt.slice(i);
}

/* A transformação inteira, sobre um texto qualquer. É exportada porque o commit
 * precisa dela aplicada à versão do HEAD, não à do disco: quando esta navegação
 * foi escrita, os três arquivos já tinham trabalho não commitado de outra
 * sessão, e varrer esse trabalho para dentro de um commit sobre navegação faria
 * o histórico mentir sobre o que ele contém. */
function transformar(txt, porta) {
  if (txt.includes('class="nvd"')) throw new Error("a cápsula já está neste texto");
  return inserirJs(trocarMarcacao(trocarCss(txt), porta));
}

module.exports = { CSS, JS, marcacao, transformar, ALVOS };

if (require.main === module) {
  for (const t of ALVOS) {
    const p = path.join(RAIZ, t.arq);
    const txt = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, transformar(txt, t.porta), "utf8");
    console.log("aplicado: " + t.arq + "  (porta " + t.porta + ")");
  }
  console.log("\nrode: node nav-sync-test.js");
}
