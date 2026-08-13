/* gen-aba-preview.js — o favicon e o piscar da aba, em tamanho que dá para ver.
 *
 *   node preview/gen-aba-preview.js      →  preview/aba.html  (dois cliques)
 *
 * Interativo por necessidade, como o `gen-avisos-preview.js` e o
 * `gen-confirmar-preview.js`. O que decide se esta feature presta não cabe numa
 * captura: o pulso percorrendo o fluxo, o título alternando, a animação PARANDO
 * quando a aba volta ao foco, e as três cores de estado. Um PNG mostraria um
 * quadro — e o quadro parado é justamente o que já existia antes.
 *
 * O `aba.js` é INLINADO aqui em tempo de geração, não reescrito. Chegar a esta
 * tela de verdade custa um build inteiro do Tester (minutos e dólares), e uma
 * cópia do desenho divergiria do que vai para a aba no primeiro ajuste — que é a
 * regra que os outros geradores deste diretório já seguem.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const fonte = fs.readFileSync(path.join(RAIZ, "aba.js"), "utf8");

/* A cerca: se o `aba.js` deixar de ser autossuficiente, esta página passa a
 * mostrar um desenho que não é o real — e falhar é melhor que mostrar. */
const relativos = [...fonte.matchAll(/require\("(\.[^"]+)"\)/g)].map(m => m[1]);
if (relativos.length) {
  console.error("aba.js passou a requerer módulo local (" + relativos.join(", ") + "): esta preview mostraria outro desenho.");
  process.exit(1);
}

const html = `<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aviso de aba · preview</title>
<link rel="icon" href="data:,">
<style>
:root{
  --bg:#0b0d14; --surface:#12151f; --surface-2:#171b28; --line:#242a3a;
  --txt:#e7ebf5; --txt-dim:#aab3c7; --txt-faint:#7c869c;
  --accent:#5b6cff; --accent-txt:#93a0ff;
  --ok:#3fb984; --warn:#d9a13a; --risk:#d6455b; --cold:#5f6a80;
  --font-num:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
}
:root[data-theme="light"]{
  --bg:#fbfbfd; --surface:#fff; --surface-2:#f4f6fa; --line:#e2e6ef;
  --txt:#151a24; --txt-dim:#4a5364; --txt-faint:#6d7688;
  --accent:#3d4ee0; --accent-txt:#2f3dbb;
  --ok:#1f8f62; --warn:#a9741d; --risk:#b82f43; --cold:#5f6a80;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);
  font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px}
h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--txt-dim);margin:0 0 6px}
p.sub{color:var(--txt-faint);max-width:70ch;margin:0 0 22px}
.grade{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));margin-bottom:26px}
.cartao{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;text-align:center}
.cartao h2{font:600 11px/1 ui-sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--txt-dim);margin:0 0 12px}
canvas{image-rendering:pixelated;background:var(--surface-2);border:1px solid var(--line);border-radius:10px}
.real{width:32px;height:32px;image-rendering:auto;vertical-align:middle}
.legenda{font:11px/1.4 var(--font-num);color:var(--txt-faint);margin-top:10px}
.aba{display:inline-flex;align-items:center;gap:8px;background:var(--surface-2);
  border:1px solid var(--line);border-top-left-radius:9px;border-top-right-radius:9px;
  border-bottom:0;padding:8px 14px;font-size:12.5px;color:var(--txt-dim);max-width:230px}
.aba .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.barra{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 18px}
button{font:inherit;background:var(--surface-2);color:var(--txt);border:1px solid var(--line);
  border-radius:9px;padding:8px 13px;cursor:pointer}
button:hover{border-color:var(--accent)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Barra lateral INSET de 2px, nao borda externa de 3px. A casa faz assim (o
   flows.html, e o commit que levou a cor de status para a barra esquerda dos
   cards do /disco): borda grossa colorida de um lado so e o tell mais
   reconhecivel de UI gerada, e o inset mantem a moldura de 1px inteira em volta.
   Sem backtick neste comentario de proposito: ele vive dentro de um template
   literal, e um backtick aqui fecha a string e mata o gerador. */
.nota{background:var(--surface);border:1px solid var(--line);
  box-shadow:inset 2px 0 0 var(--warn);
  border-radius:10px;padding:14px 16px 14px 18px;max-width:80ch;color:var(--txt-dim);margin-top:22px}
.nota b{color:var(--txt)}
code{font-family:var(--font-num);font-size:.92em;color:var(--accent-txt)}
</style>
</head>
<body>

<h1>Aviso de aba</h1>
<p class="sub">O favicon é um <b>fluxo</b> — um nó, dois ramos, duas arestas — e o pulso o percorre na
ordem em que um fluxo executa. Ampliado 6× aqui; do lado de cada um está o tamanho real, que é o que
o navegador mostra. <b>A barra da aba em si não pode ser animada</b>: aquilo é chrome do navegador e
nenhuma API alcança. Favicon e título são o que existe naquela área.</p>

<div class="barra">
  <button id="b-idle">parado (idle)</button>
  <button id="b-correndo">construindo</button>
  <button id="b-pronto">PRONTO — animar</button>
  <button id="b-aguardando">TE ESPERA — animar</button>
  <button id="b-falhou">FALHOU — animar</button>
  <button id="b-parar">parar</button>
  <button id="b-tema">◐ tema</button>
</div>

<div class="grade" id="grade"></div>

<div class="cartao" style="text-align:left">
  <h2>a aba, como o navegador desenha</h2>
  <!-- Os dois "img" desta pagina recebem, em runtime, o data URL que o proprio
       "pintar()" devolve. O src inicial e um GIF transparente de 1px: sem ele, um
       canvas bloqueado deixaria a caixa de imagem quebrada no lugar exato onde a
       preview deveria estar provando o desenho. -->
  <div class="aba"><img class="real" id="fav-aba" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><span class="t" id="titulo-aba">Tester · Cockpit</span></div>
  <div class="legenda" id="estado-aba">estado: idle</div>
</div>

<div class="nota">
  <b>O que só se verifica aqui, clicando.</b>
  Que o pulso atravessa as duas arestas e acende os nós na ordem certa. Que o título alterna e volta
  ao original. Que a animação <b>para sozinha</b> — no produto ela para ao voltar o foco para a aba e
  no teto de <code>ANIM_MAX_MS</code>. Que as três cores de estado se distinguem em 32px, inclusive no
  tema claro (troque com <code>◐ tema</code>: um ícone desenhado para o tema escuro <b>desaparece</b>
  no branco, e é por isso que o <code>aba.js</code> redesenha ao mudar o tema).
  <br><br>
  A notificação do sistema operacional não aparece nesta página: ela exige permissão concedida num
  clique e um servidor de verdade. Verificada no navegador, junto do <code>aba-test.js</code>.
</div>

<script>
/* Esta pagina abre por dois cliques, ou seja em file://, e o aba.js inlinado
   abaixo poleia /api/tester/status como faz no produto. Em file:// isso vira erro
   de CORS no console — dois por carregamento. O aba.js trata (o olhar() tem
   catch), mas console sujo numa pagina de verificacao e um custo real: quem abre
   aqui esta justamente procurando o que esta errado, e ruido conhecido treina a
   pessoa a ignorar o console. Entao o poll e desligado AQUI, sem knob novo no
   codigo de producao. */
if (location.protocol === "file:") {
  const original = window.fetch;
  window.fetch = function (u) {
    if (String(u).indexOf("/api/") === 0) return Promise.reject(new Error("preview: sem servidor"));
    return original.apply(this, arguments);
  };
}
</script>
<script>
/* ─── aba.js inlinado em tempo de geração — não edite aqui ─────────────── */
${fonte}
/* ─── fim do aba.js ───────────────────────────────────────────────────── */

(function () {
  "use strict";
  const A = window.__aba;
  const grade = document.getElementById("grade");
  const favAba = document.getElementById("fav-aba");
  const tituloAba = document.getElementById("titulo-aba");
  const estadoAba = document.getElementById("estado-aba");
  const ESTADOS = ["idle", "correndo", "pronto", "aguardando", "falhou"];
  const telas = {};

  for (const e of ESTADOS) {
    const c = document.createElement("div");
    c.className = "cartao";
    c.innerHTML = '<h2>' + e + '</h2>';
    const grande = document.createElement("canvas");
    grande.width = grande.height = 192;
    c.appendChild(grande);
    const linha = document.createElement("div");
    linha.className = "legenda";
    const real = document.createElement("img");
    real.className = "real";
    real.alt = "";
    real.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    linha.appendChild(real);
    linha.appendChild(document.createTextNode(" 32px real"));
    c.appendChild(linha);
    grade.appendChild(c);
    telas[e] = { grande, real };
    /* Quadro estático de cada estado, para comparar as cores lado a lado. */
    const url = A.pintar(e, null, grande);
    if (url) real.src = url;
  }

  /* A animação da preview desenha nos canvas grandes E no <img> da aba, com o
   * MESMO \`pintar\` que o produto usa. Reimplementar o loop aqui deixaria a
   * preview certa e o produto errado — ou o contrário, que é pior. */
  let timer = null, q = 0, atual = "idle";
  function parar() {
    if (timer) { clearInterval(timer); timer = null; }
    tituloAba.textContent = "Tester · Cockpit";
  }
  function mostrar(estado, animando) {
    parar();
    atual = estado;
    estadoAba.textContent = "estado: " + estado + (animando ? " (animando)" : " (estático)");
    if (!animando) {
      const url = A.pintar(estado, null, telas[estado].grande);
      if (url) { telas[estado].real.src = url; favAba.src = url; }
      return;
    }
    const cfg = A.ESTADOS[estado];
    const icone = cfg ? cfg.icone : estado;
    const rotulo = cfg ? cfg.titulo : estado.toUpperCase();
    q = 0;
    timer = setInterval(() => {
      q++;
      const periodo = 16;
      const fase = (q % periodo) / (periodo - 4);
      const url = A.pintar(icone, fase > 1 ? null : fase, telas[estado].grande);
      if (url) { telas[estado].real.src = url; favAba.src = url; }
      if (q % 8 === 0) {
        tituloAba.textContent = tituloAba.textContent.indexOf("●") === 0
          ? "Tester · Cockpit" : "● " + rotulo + " · Tester · Cockpit";
      }
    }, 90);
  }

  document.getElementById("b-idle").onclick = () => mostrar("idle", false);
  document.getElementById("b-correndo").onclick = () => mostrar("correndo", false);
  document.getElementById("b-pronto").onclick = () => mostrar("pronto", true);
  document.getElementById("b-aguardando").onclick = () => mostrar("aguardando", true);
  document.getElementById("b-falhou").onclick = () => mostrar("falhou", true);
  document.getElementById("b-parar").onclick = () => { parar(); mostrar("idle", false); };
  document.getElementById("b-tema").onclick = () => {
    const r = document.documentElement;
    r.dataset.theme = r.dataset.theme === "light" ? "dark" : "light";
    /* Redesenha tudo: é exatamente o que o produto faz no \`change\` do
     * prefers-color-scheme, e o motivo é o mesmo — ícone do tema anterior
     * desaparece no fundo novo. */
    for (const e of ESTADOS) {
      const url = A.pintar(e, null, telas[e].grande);
      if (url) telas[e].real.src = url;
    }
    if (!timer) mostrar(atual, false);
  };

  mostrar("idle", false);
})();
</script>
</body>
</html>
`;

const destino = path.join(__dirname, "aba.html");
fs.writeFileSync(destino, html, "utf8");
console.log("gerado " + path.relative(RAIZ, destino) + " (" + html.length + " chars) — abra com dois cliques");
