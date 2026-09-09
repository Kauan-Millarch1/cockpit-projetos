/* nav-sync-test.js — a navegação é UM bloco em quatro arquivos, e este teste é o
 * que impede que ela vire quatro.
 *
 * O CLAUDE.md documenta a dívida desde que o topbar foi unificado: flows.html,
 * tester.html e cockpit.html carregam cópias do mesmo chrome, e "mudança lá tem
 * que ser repetida aqui" é uma frase que depende de alguém lembrar. Já falhou:
 * um resync inseriu um segundo bloco de avisos no flows.html em vez de
 * substituir o existente, e a página morreu com "Illegal return statement".
 *
 * QUATRO portas, e são todas: Fluxos (`/`), Disco (`/disco`), Tester (`/tester`)
 * e Upgrade (`/upgrade`). Em 09/09/2026 o dono decidiu não produtizar, e as
 * portas de login e de integrações saíram com as rotas que as serviam —
 * `/conta`, `/entrar` e `/integracoes` não existem mais, nem no server.js nem
 * como arquivo. Este teste é o que percebe se alguma delas voltar por metade:
 * um href sem rota do outro lado é um 404 que só aparece no clique.
 *
 * Aqui a lembrança virou portão. Cada caso rejeita um defeito com nome:
 *   1. o bloco existe nas páginas testadas;
 *   2. o CSS é BYTE A BYTE igual em todas;
 *   3. o JS é byte a byte igual em todas;
 *   4. nenhuma sobra do .pages antigo ficou pendurada;
 *   5. o bloco aparece UMA vez por arquivo (o defeito do segundo bloco);
 *   6. cada página marca a própria porta como atual — e só ela;
 *   7. as quatro portas apontam para as rotas que o server.js serve, e nenhuma
 *      porta aposentada voltou;
 *   8. o atalho que o chip promete existe no JS, e os dígitos são contíguos;
 *   9. a lente não bloqueia o boot nem lê geometria demais, e o gerador
 *      concorda com as páginas;
 *  10. o tema e o modo gravação são UM estado, não um por página.
 *
 * Grátis: sem modelo, sem rede, sem servidor. `node nav-sync-test.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* Os delimitadores são deste teste, de propósito. Se alguém reescrever o bloco e
 * apagar um deles, o teste falha dizendo que não achou o bloco — que é
 * exatamente o aviso que se quer nesse caso, não um silêncio. */
const CSS_INICIO = "NAV — as quatro portas";
const CSS_FIM = ".nvd .lente.varre::after{animation:none}";
const JS_INICIO = "NAV — a lente de vidro";
const JS_FIM = "}());";

const PAGINAS = [
  { arq: "flows.html", porta: "fluxos" },
  { arq: "tester.html", porta: "tester" },
  { arq: "cockpit.html", porta: "disco" },
  { arq: "upgrade.html", porta: "upgrade" }
];
const ROTAS = { fluxos: "/", disco: "/disco", tester: "/tester", upgrade: "/upgrade" };
/* As portas aposentadas. Não basta parar de exigi-las: uma porta que volta ao
   markup sem rota do outro lado é um 404 que só aparece no clique, e um chip
   `alt 5` que não navega é rótulo mentindo. Este teste recusa as duas coisas. */
const APOSENTADAS = ["/conta", "/entrar", "/integracoes"];

let falhas = 0;
const ok = m => console.log("  ok    " + m);
const erro = m => { falhas++; console.log("  FALHA " + m); };

function recorte(txt, inicio, fim, arq, nome) {
  const i = txt.indexOf(inicio);
  if (i < 0) { erro(arq + ": bloco " + nome + " não encontrado (o delimidador «" + inicio + "» sumiu)"); return null; }
  const f = txt.indexOf(fim, i);
  if (f < 0) { erro(arq + ": bloco " + nome + " começa mas não termina («" + fim + "» não veio depois)"); return null; }
  return txt.slice(i, f + fim.length);
}

const textos = new Map();
for (const p of PAGINAS) {
  const alvo = path.join(__dirname, p.arq);
  if (!fs.existsSync(alvo)) { erro(p.arq + ": arquivo não existe"); continue; }
  textos.set(p.arq, fs.readFileSync(alvo, "utf8"));
}

console.log("\n1. o bloco existe nas páginas testadas");
const blocos = { css: new Map(), js: new Map() };
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const c = recorte(txt, CSS_INICIO, CSS_FIM, p.arq, "CSS");
  const j = recorte(txt, JS_INICIO, JS_FIM, p.arq, "JS");
  if (c) blocos.css.set(p.arq, c);
  if (j) blocos.js.set(p.arq, j);
  if (c && j) ok(p.arq + ": CSS " + c.length + " bytes, JS " + j.length + " bytes");
}

/* Comparar contra a PRIMEIRA página e nomear a divergência pelo primeiro byte
 * diferente: "os blocos diferem" manda procurar em 4 KB de CSS; "diferem no
 * byte 1832" abre o editor no lugar. */
function comparar(rotulo, mapa) {
  const nomes = [...mapa.keys()];
  if (nomes.length < 2) { erro(rotulo + ": menos de duas páginas para comparar"); return; }
  const ref = mapa.get(nomes[0]);
  for (const n of nomes.slice(1)) {
    const outro = mapa.get(n);
    if (outro === ref) { ok(rotulo + ": " + n + " idêntico a " + nomes[0]); continue; }
    let i = 0;
    while (i < Math.min(ref.length, outro.length) && ref[i] === outro[i]) i++;
    erro(rotulo + ": " + n + " difere de " + nomes[0] + " no byte " + i
      + " — «" + ref.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, "\\n") + "»"
      + " contra «" + outro.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, "\\n") + "»"
      + ". Rode: node preview/aplicar-nav.js");
  }
}

console.log("\n2. o CSS é byte a byte igual nas quatro");
comparar("CSS", blocos.css);

console.log("\n3. o JS é byte a byte igual em todas");
comparar("JS", blocos.js);

console.log("\n4. nenhuma sobra do .pages antigo");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  if (/\.pages\b|class="pages"/.test(txt)) erro(p.arq + ": ainda tem .pages — a navegação antiga ficou pendurada");
  else ok(p.arq + ": limpo");
}

console.log("\n5. o bloco aparece UMA vez por arquivo");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const conta = s => txt.split(s).length - 1;
  const c = conta(CSS_INICIO), j = conta(JS_INICIO), n = conta('class="nvd"');
  if (c === 1 && j === 1 && n === 1) ok(p.arq + ": um CSS, um JS, um <nav>");
  else erro(p.arq + ": bloco duplicado — CSS ×" + c + ", JS ×" + j + ", nav ×" + n
    + ". Um resync tem que SUBSTITUIR o bloco, nunca inserir um segundo");
}

console.log("\n6. cada página marca a própria porta, e só ela");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const nav = txt.slice(txt.indexOf('<nav class="nvd"'), txt.indexOf("</nav>", txt.indexOf('<nav class="nvd"')));
  const marcadas = [...nav.matchAll(/data-porta="([a-z]+)"([^>]*)>/g)]
    .filter(m => /aria-current="page"/.test(m[2])).map(m => m[1]);
  if (marcadas.length === 1 && marcadas[0] === p.porta) ok(p.arq + ": porta «" + p.porta + "»");
  else erro(p.arq + ": esperava só «" + p.porta + "» marcada, veio [" + marcadas.join(", ") + "]");
}

console.log("\n7. as quatro portas apontam para as rotas que o server.js serve");
const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const nav = txt.slice(txt.indexOf('<nav class="nvd"'), txt.indexOf("</nav>", txt.indexOf('<nav class="nvd"')));
  let bom = true;
  for (const [porta, rota] of Object.entries(ROTAS)) {
    const re = new RegExp('href="' + rota.replace("/", "\\/") + '" data-porta="' + porta + '"');
    if (!re.test(nav)) { erro(p.arq + ": a porta «" + porta + "» não aponta para " + rota); bom = false; }
  }
  /* E SÓ elas. Conferir presença aprova uma porta a mais: a de `/conta` ficou no
     markup das quatro páginas depois de a rota sair do server.js, e todos os
     casos deste bloco continuaram verdes porque cada porta esperada estava lá. */
  const quantas = (nav.match(/data-porta="/g) || []).length;
  const esperadas = Object.keys(ROTAS).length;
  if (quantas !== esperadas) {
    erro(p.arq + ": a cápsula tem " + quantas + " portas e o teste conhece " + esperadas
      + (quantas > esperadas
        ? " — uma porta a mais é um href que o server.js não serve"
        : " — uma porta a menos é uma tela que só se alcança digitando a URL"));
    bom = false;
  }
  for (const rota of APOSENTADAS) {
    if (nav.includes('href="' + rota + '"')) {
      erro(p.arq + ": a porta aposentada " + rota + " voltou para a cápsula");
      bom = false;
    }
  }
  if (bom) ok(p.arq + ": " + quantas + " portas, todas com rota servida");
}
// A rota tem que existir do outro lado. Um href para uma rota que o servidor não
// serve é um 404 que só aparece no clique.
for (const rota of ["/disco", "/tester", "/upgrade"]) {
  if (server.includes('"' + rota + '"')) ok("server.js serve " + rota);
  else erro("server.js NÃO serve " + rota + " — o href levaria a 404");
}
// E o outro lado da mesma moeda: a rota aposentada não pode ter voltado ao
// servidor por trás da cápsula. Aqui o portão é `p === "/rota"`, a forma exata
// que o server.js usa para despachar — um `/conta` dentro de um comentário ou de
// uma mensagem não é uma rota servida, e reprovar por causa dele seria falso.
for (const rota of APOSENTADAS) {
  if (server.includes('p === "' + rota + '"')) {
    erro("server.js voltou a servir " + rota + " — a decisão de 09/09/2026 foi tirar essa porta");
  } else ok("server.js não serve mais " + rota);
}

console.log("\n8. o atalho que o chip promete existe");
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  /* APERTADO em 25/08/2026, porque a versão frouxa aprovou um defeito vivo. Ela
     perguntava se existia ALGUM chip `alt [123]` e se o handler existia — e com
     QUATRO portas, cada uma com o seu chip, o handler lia `"123".indexOf(...)`.
     `alt 4` nunca funcionou, o rótulo prometia que sim, e este caso ficou verde
     o tempo todo. Agora ele compara os dois conjuntos: todo chip prometido tem
     que estar nos dígitos que o handler aceita, e todo dígito aceito tem que ter
     uma porta atrás. */
  const chips = [...txt.matchAll(/<kbd>alt (\d)<\/kbd>/g)].map(m => m[1]);
  const mDig = /"(\d+)"\.indexOf\(ev\.key\)/.exec(txt);
  const digitos = mDig ? mDig[1].split("") : [];
  const portas = (txt.match(/data-porta="/g) || []).length;
  const temTecla = /ev\.altKey/.test(txt) && /location\.href/.test(txt);
  const semAtalho = chips.filter(c => !digitos.includes(c));
  const semPorta = digitos.filter(d => Number(d) > portas);
  if (temTecla && chips.length && !semAtalho.length && !semPorta.length) {
    ok(p.arq + ": " + chips.length + " chip(s), todos com tecla");
  } else {
    erro(p.arq + ": chips=[" + chips + "] digitos=[" + digitos + "] portas=" + portas
      + " tecla=" + temTecla
      + (semAtalho.length ? " — prometem atalho e não têm: alt " + semAtalho.join(", alt ") : "")
      + (semPorta.length ? " — aceitam dígito sem porta: " + semPorta.join(", ") : "")
      + " — um rótulo prometendo atalho que não funciona é pior que nenhum rótulo");
  }
}

console.log("\n9. a lente não bloqueia o boot nem lê geometria demais");
/* Medido no navegador, e é o custo de JS nº 1 no boot de duas destas telas:
   `assentar()` lendo `offsetLeft` durante a execução do script ANTECIPA o primeiro
   layout do documento e o torna síncrono — **209 ms de thread bloqueada no
   `/disco`**, 126 ms no `/tester`. O `/upgrade`, com o dobro do CSS, custava 0 ms
   no mesmo ponto: a diferença é só QUANDO o script corre. Depois de adiar a
   partida para depois da primeira pintura: 0,1 ms.

   E no hover eram 4 leituras de geometria por quadro (~17 fps, 8,7 no `/`), porque
   `a.offsetLeft` era lido de novo numa linha onde `ax` já era ele. Depois: 0,5–0,8
   leituras por quadro, 55–65 fps. */
for (const p of PAGINAS) {
  const txt = textos.get(p.arq);
  if (!txt) continue;
  const semComent = txt.replace(/\/\*[\s\S]*?\*\//g, " ");
  const adiada = /requestAnimationFrame\(function \(\) \{ requestAnimationFrame\(partir\); \}\)/.test(semComent);
  // A lente nasce invisível e só aparece posicionada: sem isto, adiar a partida
  // troca 209 ms de bloqueio por um quadro de lente no lugar errado.
  const nasceInvisivel = /\.nvd \.lente\{[^}]*opacity:0/.test(txt);
  const revela = /\.nvd \.lente\.pronta\{opacity:1\}/.test(txt) && /classList\.add\("pronta"\)/.test(semComent);
  // A leitura duplicada: `a.offsetLeft` dentro da linha do ímã.
  const semLeituraDupla = !/h\.offsetLeft > a\.offsetLeft/.test(semComent);
  if (adiada && nasceInvisivel && revela && semLeituraDupla) ok(p.arq + ": partida adiada, lente revelada, sem leitura duplicada");
  else erro(p.arq + ": adiada=" + adiada + " invisivel=" + nasceInvisivel
    + " revela=" + revela + " semLeituraDupla=" + semLeituraDupla);
}
/* O gerador tem de concordar com as páginas. Ele é migração de mão única
   (`transformar()` lança se a cápsula já está no texto), então a única forma de
   manter o bloco sincronizado é aplicar a mesma troca aos quatro arquivos e ao
   gerador — e este caso é o que percebe se alguém mexeu só de um lado. */
{
  let g = null;
  try { g = fs.readFileSync(path.join(__dirname, "preview", "aplicar-nav.js"), "utf8"); } catch { g = null; }
  if (!g) erro("não achei preview/aplicar-nav.js");
  else {
    const semComent = g.replace(/\/\*[\s\S]*?\*\//g, " ");
    const bate = /requestAnimationFrame\(partir\)/.test(semComent)
      && /\.nvd \.lente\.pronta\{opacity:1\}/.test(g)
      && !/h\.offsetLeft > a\.offsetLeft/.test(semComent);
    if (bate) ok("preview/aplicar-nav.js: o gerador tem as mesmas três mudanças");
    else erro("preview/aplicar-nav.js DIVERGIU das páginas — uma regeneração futura desfaria a correção");

    /* E O GERADOR TEM DE CARREGAR. Este caso existe porque ele NÃO carregava:
       quatro comentários dentro do template literal do bloco JS citavam
       identificadores entre backticks, o backtick fechou a string, e
       `node preview/aplicar-nav.js` morria com um SyntaxError apontando para
       `ax`. Ficou assim sem ninguém notar justamente porque os casos acima leem
       o arquivo como TEXTO — regex casa igual em código que não compila. Ler é
       barato e prova pouco; carregar prova que o gerador é executável.
       `require` aqui não roda migração nenhuma: a aplicação está atrás de
       `require.main === module`. */
    try {
      const mod = require(path.join(__dirname, "preview", "aplicar-nav.js"));
      const temTudo = typeof mod.CSS === "string" && typeof mod.JS === "string"
        && typeof mod.marcacao === "function" && Array.isArray(mod.ALVOS);
      if (temTudo) ok("preview/aplicar-nav.js: carrega e exporta CSS, JS, marcacao e ALVOS");
      else erro("preview/aplicar-nav.js carrega mas não exporta o que o gerador promete");
    } catch (e) {
      erro("preview/aplicar-nav.js NÃO CARREGA (" + e.message
        + ") — um gerador que não roda não regenera nada, e o defeito é invisível para quem só lê o texto");
    }

    /* O gerador é a única fonte da marcação, então as portas dele são as portas.
       Uma porta aposentada de volta ao PORTAS de nav-comum.js reapareceria nas
       quatro páginas na próxima aplicação. */
    try {
      const mod = require(path.join(__dirname, "preview", "aplicar-nav.js"));
      const marca = mod.marcacao("fluxos");
      const portas = (marca.match(/data-porta="/g) || []).length;
      if (portas === Object.keys(ROTAS).length) ok("o gerador desenha " + portas + " portas");
      else erro("o gerador desenha " + portas + " portas e o teste espera " + Object.keys(ROTAS).length);
      const voltou = APOSENTADAS.filter(r => marca.includes('href="' + r + '"'));
      if (!voltou.length) ok("o gerador não desenha nenhuma porta aposentada");
      else erro("o gerador voltou a desenhar: " + voltou.join(", "));

      /* E OS CHIPS DO GERADOR TÊM DE SER OS DÍGITOS DO JS DO GERADOR. O caso 8
         mede isso nas páginas, que é onde dói — mas as páginas saem daqui, então
         um `tecla` errado no PORTAS do nav-comum.js atravessa para as quatro na
         próxima aplicação e só então fica vermelho. Medido: com o `tecla: "5"` na
         quarta porta todos os outros casos deste bloco ficavam verdes, porque a
         CONTAGEM de portas e os hrefs continuavam certos. */
      const chipsG = [...marca.matchAll(/<kbd>alt (\d)<\/kbd>/g)].map(m => m[1]);
      const mDigG = /"(\d+)"\.indexOf\(ev\.key\)/.exec(mod.JS);
      const digG = mDigG ? mDigG[1].split("") : [];
      const contiguos = chipsG.join("") === digG.join("")
        && digG.join("") === digG.map((_, i) => String(i + 1)).join("")
        && digG.length === portas;
      if (contiguos) ok("o gerador promete alt " + chipsG.join("/") + " e o JS dele aceita os mesmos dígitos");
      else erro("o gerador promete chips [" + chipsG + "] e o JS dele aceita [" + digG + "]"
        + " para " + portas + " portas — têm que ser 1..N, contíguos, os três de acordo");
    } catch { /* o caso acima já reprovou por não carregar */ }
  }
}

/* ── 10. o tema e o modo gravação são UM estado, não um por página ───────────
 *
 * O defeito que paga este bloco foi visto na tela: tema claro escolhido nas
 * outras abas e uma delas abrindo escura sozinha. A causa era uma letra — a
 * página lia `cockpit-tema` e as outras gravam `cockpit-theme`. Duas chaves para
 * um fato: nada casava, a página caía na `prefers-color-scheme` do sistema, e a
 * escolha explícita da pessoa não existia. Exatamente a família do
 * `#tema`/`#theme` que o CLAUDE.md já registra — divergir num detalhe, num bloco
 * que foi copiado à mão.
 *
 * E junto veio um segundo, pior: a gravação era lida DEPOIS do primeiro paint.
 * O borrão chegava tarde e a tela piscava dado de cliente — exatamente o que o
 * modo existe para esconder de uma filmagem.
 *
 * A página onde os dois foram medidos era a de login, e ela não existe mais
 * (09/09/2026, a decisão de não produtizar). O bloco fica porque o defeito não
 * era daquela página: era de um chrome copiado à mão em várias, e as quatro que
 * sobraram têm as mesmas duas leituras pelo mesmo motivo. Retirar o caso junto
 * com o arquivo teria trocado uma garantia viva por nada.
 *
 * Cinco casos por arquivo, e cada um recusa um defeito com nome. O quinto é o
 * que carrega o bloco: uma página que LÊ uma chave e ESCREVE outra é o mesmo bug
 * em miniatura, e é o que sobra quando alguém conserta metade.
 *
 * Medido sobre fonte SEM COMENTÁRIO, que é a lição que o `dossie-tela-test.js`
 * pagou: o comentário que explica a correção cita a chave errada pelo nome, e um
 * caso que casa dentro de comentário aprova a ausência da correção. */
{
  /* As mesmas quatro páginas do PAGINAS acima, derivadas dele em vez de
     redigitadas: enquanto eram duas listas, uma delas ficou com `entrar.html` e
     `integracoes.html` depois de os arquivos saírem do disco. */
  const SERVIDAS = PAGINAS.map(p => p.arq);
  const TEMA = "cockpit-theme";
  const REC = "cockpit-rec";
  const semComent = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/<!--[\s\S]*?-->/g, " ");

  for (const arq of SERVIDAS) {
    const alvo = path.join(__dirname, arq);
    if (!fs.existsSync(alvo)) { erro(arq + ": arquivo não existe"); continue; }
    const bruto = fs.readFileSync(alvo, "utf8");
    const src = semComent(bruto);

    /* 1. lê a chave certa. */
    const leTema = src.includes('getItem("' + TEMA + '")');
    if (leTema) ok(arq + ": lê o tema de «" + TEMA + "»");
    else erro(arq + ": NÃO lê o tema de «" + TEMA + "» — o tema não vai cruzar de aba");

    /* 2. e não usa nenhuma variante. Uma variante não dói até alguém navegar,
       que é o que a torna capaz de sobreviver a uma revisão. */
    const variantes = (src.match(/cockpit-(?:tema|theme|Theme|TEMA)\b/g) || [])
      .filter(v => v !== TEMA);
    if (!variantes.length) ok(arq + ": nenhuma variante da chave do tema");
    else erro(arq + ": usa variante(s) da chave do tema: " + [...new Set(variantes)].join(", "));

    /* 3+4. as duas leituras acontecem ANTES do primeiro paint. O índice do
       `<body` é o marco: depois dele a página já pintou, e um borrão que chega
       depois é um flash do dado que o modo existe para esconder. */
    const iBody = src.indexOf("<body");
    for (const [chave, nome] of [[TEMA, "tema"], [REC, "modo gravação"]]) {
      const i = src.indexOf('getItem("' + chave + '")');
      if (i < 0) { erro(arq + ": não lê «" + chave + "» em lugar nenhum"); continue; }
      if (iBody < 0) { erro(arq + ": não achei o <body> para medir a ordem"); continue; }
      if (i < iBody) ok(arq + ": lê o " + nome + " antes do primeiro paint");
      else erro(arq + ": lê o " + nome + " DEPOIS do <body> — a tela pinta e só então corrige");

      /* E APLICA. Ler a preferência e não escrever o atributo é a página lendo o
         que a pessoa escolheu e ignorando — tema quebrado com o `getItem` no
         lugar, que é o mutante que passou verde na primeira versão deste caso. */
      const attr = chave === TEMA ? "data-theme" : "data-rec";
      const j = src.indexOf('setAttribute("' + attr + '"');
      if (j < 0) erro(arq + ": lê o " + nome + " e nunca escreve «" + attr + "» — a preferência é lida e ignorada");
      else if (j < iBody) ok(arq + ": aplica «" + attr + "» antes do primeiro paint");
      else erro(arq + ": só aplica «" + attr + "» DEPOIS do <body> — a tela pinta errado e corrige na frente da pessoa");
    }

    /* 5. e a ESCRITA usa a mesma chave da LEITURA. Consertar só a leitura deixa
       a página lendo o compartilhado e gravando no próprio, então a escolha
       feita ali é a única que não propaga — o bug de volta, invertido. */
    const escritas = [...new Set((src.match(/setItem\("(cockpit-[a-zA-Z]+)"/g) || [])
      .map(m => m.slice(9, -1)))].filter(k => /the?ma?e?$/i.test(k) || k === TEMA);
    if (!escritas.length) ok(arq + ": não grava tema (não tem o botão, e isso é legítimo)");
    else if (escritas.length === 1 && escritas[0] === TEMA) ok(arq + ": grava o tema na mesma chave que lê");
    else erro(arq + ": lê «" + TEMA + "» e grava em " + escritas.join(", "));
  }
}

console.log("");
if (falhas) { console.log("FALHOU: " + falhas + " problema(s)"); process.exit(1); }
console.log("passou: a navegação é um bloco só, nas páginas testadas");
