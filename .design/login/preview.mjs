/* Bancada de preview das telas de entrada.
 *
 *   node .design/login/preview.mjs
 *
 * Abre cada `.dc.html` num navegador de verdade, no tamanho exato do quadro, e
 * salva PNG em 2x. Depois monta uma folha de contato para revisar tudo de uma
 * vez. Nada aqui sobe nada para lugar nenhum: é arquivo local.
 *
 * Por que navegador de verdade e não uma conferência de string: `color-mix()`,
 * a borda em duas camadas do botão e o `backdrop-filter` da topbar só existem
 * depois do cálculo do estilo. Medir isso fora do navegador mediria a fixture.
 *
 * Duas coisas que este arquivo trata de propósito:
 *   - `support.js` NÃO existe em disco — é o runtime que o editor injeta na
 *     hora de renderizar. A rota é interceptada e respondida vazia, senão cada
 *     captura vem com um 404 no console e o erro real se perde no meio.
 *   - `<x-dc>` é elemento desconhecido, logo inline por padrão. Cada artboard
 *     declara `x-dc{display:block}` no próprio helmet; se algum esquecer, o
 *     layout desaba e a captura mostra isso — é para mostrar.
 */
import { readdir, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

/* O playwright NÃO entra neste projeto, e isso não é preguiça: "Node 22, zero
   dependência" é uma propriedade do cockpit inteiro, e um `node_modules` aqui
   para tirar print de mockup a torraria. Ele já está no cache do npx desta
   máquina, com os navegadores baixados — a busca abaixo acha de lá.
   Se não achar, o script diz o comando em vez de estourar num ERR_MODULE_NOT_FOUND
   que não nomeia nem o playwright nem o motivo. */
async function pegarChromium() {
  const cache = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  const cands = [];
  if (existsSync(cache)) {
    for (const d of readdirSync(cache)) {
      const p = path.join(cache, d, "node_modules", "playwright");
      if (existsSync(path.join(p, "package.json"))) cands.push(p);
    }
  }
  /* Mais novo primeiro: o navegador baixado costuma ser o da versão mais nova,
     e um playwright velho apontando para um binário que já saiu falha com
     "Executable doesn't exist" — erro que manda procurar no lugar errado. */
  const comV = [];
  for (const p of cands) {
    try {
      const v = JSON.parse(await readFile(path.join(p, "package.json"), "utf8")).version || "0";
      comV.push({ p, v });
    } catch { /* pacote pela metade no cache: ignora, não é candidato */ }
  }
  comV.sort((a, b) => b.v.localeCompare(a.v, undefined, { numeric: true }));

  for (const { p } of comV) {
    try { return (await import(pathToFileURL(path.join(p, "index.mjs")).href)).chromium; }
    catch { try { return (await import(pathToFileURL(p).href)).chromium; } catch { /* próximo */ } }
  }
  try { return (await import("playwright")).chromium; } catch { /* cai no erro abaixo */ }

  console.error("playwright nao encontrado. Rode uma vez, fora deste projeto:");
  console.error("  npx --yes playwright@1.62.1 install chromium");
  console.error("Nao instale no projeto: zero dependencia e uma propriedade do cockpit.");
  process.exit(1);
}
const chromium = await pegarChromium();

/* fileURLToPath e obrigatorio: o caminho deste projeto tem espaco
   ("Cockpit Projetos"), entao import.meta.url chega com %20. Converter na mao
   por regex tira a barra inicial e NAO decodifica — o erro sai como um ENOENT
   num caminho com %20 dentro, que nao nomeia a causa. */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "png");
const ESCALA = 2;

/* Ordem de leitura da entrada, não ordem alfabética: a folha de contato tem que
   contar a história na sequência em que a pessoa vive. Quem não estiver aqui
   entra depois, em ordem de nome, para um arquivo novo nunca sumir da folha. */
const ORDEM = [
  /* primeira entrada — a sequencia, vista uma vez */
  "Entrar.dc.html",
  "EntrarClaro.dc.html",
  "Main.dc.html",
  "ConectarN8n.dc.html",
  "N8nPuxado.dc.html",
  "ConectarIA.dc.html",
  "IAConectada.dc.html",
  /* permanente — o que existe para sempre, sem sequencia */
  "VoltaConectado.dc.html",
  "VoltaQuebrada.dc.html",
  "Integracoes.dc.html",
  "IAsDuas.dc.html",
  /* o passo a passo do download — a unica sequencia que comeca FORA do painel */
  "Baixar.dc.html",
  "DepoisDeBaixar.dc.html",
  "PrimeiraAbertura.dc.html",
  "Atualizar.dc.html",
];

const LEGENDA = {
  "Entrar.dc.html":      ["[ 01 ]", "Entrar — tema escuro"],
  "EntrarClaro.dc.html": ["[ 01 ]", "Entrar — tema claro"],
  "Main.dc.html":        ["[ HUB ]", "O que falta — os três estados"],
  "ConectarN8n.dc.html": ["[ 02 ]", "Conectar o n8n — o formulário"],
  "N8nPuxado.dc.html":   ["[ 02 ]", "Fluxos puxados — com leitura parcial"],
  "ConectarIA.dc.html":  ["[ 03 ]", "Conectar a IA — Claude ou Codex"],
  "IAConectada.dc.html": ["[ 03 ]", "IA conectada — a cerca"],
  "VoltaConectado.dc.html": ["[ VOLTA ]", "Ela volta e nada e pedido"],
  "VoltaQuebrada.dc.html":  ["[ VOLTA ]", "Ela volta e algo parou de funcionar"],
  "Integracoes.dc.html":    ["[ PERM ]", "Painel de integracoes — os quatro estados"],
  "IAsDuas.dc.html":        ["[ PERM ]", "Duas IAs — quem faz qual trabalho"],
  "Baixar.dc.html":          ["[ 1 de 4 ]", "O site — o que e, o que precisa, e o botao"],
  "DepoisDeBaixar.dc.html":  ["[ 2 de 4 ]", "Baixou — o que fazer com o arquivo"],
  "PrimeiraAbertura.dc.html":["[ 3 de 4 ]", "Primeira abertura — falta o login do Claude"],
  "Atualizar.dc.html":       ["[ 4 de 4 ]", "Versao nova — e o que ela nao toca"],
};

const achados = await readdir(AQUI);
const artboards = achados.filter((f) => f.endsWith(".dc.html"));
const ordenados = [
  ...ORDEM.filter((f) => artboards.includes(f)),
  ...artboards.filter((f) => !ORDEM.includes(f)).sort(),
];

if (!ordenados.length) {
  console.error("nenhum .dc.html em " + AQUI);
  process.exit(1);
}

await mkdir(SAIDA, { recursive: true });

const nav = await chromium.launch();
const rel = [];

for (const arq of ordenados) {
  const ctx = await nav.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: ESCALA,
  });
  /* O runtime do editor entra por aqui na renderização real. Em disco o arquivo
     não existe; responder vazio deixa o console limpo para o erro que importa. */
  await ctx.route("**/support.js", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));

  const pag = await ctx.newPage();
  const erros = [];
  pag.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  pag.on("console", (m) => { if (m.type() === "error") erros.push("console: " + m.text()); });

  await pag.goto(pathToFileURL(path.join(AQUI, arq)).href, { waitUntil: "load" });
  await pag.waitForTimeout(260);   /* fonte de sistema assenta; nada de rede para esperar */

  /* Medida honesta: o quadro é fixo em 1280x860, então o que passar disso é
     CORTADO, não rolado. Reportar a altura real do conteúdo é a única forma de
     saber se a tela caberia — a captura sozinha esconde exatamente isso.
     E NÃO dá para usar `scrollHeight` da raiz: a raiz é justamente quem tem
     `overflow:hidden`, então ela devolve a própria altura e a medida concorda
     com o quadro por construção. Um portão que aprova por construção não é
     portão. A união dos retângulos dos descendentes é imune a isso. */
  const m = await pag.evaluate((QUADRO) => {
    /* A raiz do formato e o proprio `x-dc`, nao "o primeiro div dentro dele":
       um artboard e livre de comecar por um `.backdrop` absoluto, e foi isso
       que aconteceu — medir o backdrop devolvia 0x0 e o portao passava, porque
       ele nao tem descendente nenhum. Medir contra `x-dc` e medir contra o que
       o formato garante existir. */
    const raiz = document.querySelector("x-dc");
    if (!raiz) return { semRaiz: true };
    const cs = getComputedStyle(raiz);
    const r = raiz.getBoundingClientRect();
    let fundo = r.top, direita = r.left, contados = 0;
    for (const el of raiz.querySelectorAll("*")) {
      if (el.closest("helmet")) continue;          /* <style> nao desenha nada */
      const cse = getComputedStyle(el);
      if (cse.display === "none" || cse.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      contados++;
      if (b.bottom > fundo) fundo = b.bottom;
      if (b.right > direita) direita = b.right;
    }
    /* Tema do artboard lido do token, nao do nome do arquivo: e o `--bg` que
       decide se a logo branca precisa de invert, e um arquivo pode ser
       renomeado sem que o token mude. */
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const claro = /^#(f|e|d)/i.test(bg);
    const lg = raiz.querySelector("img.eplogo");
    const logo = lg ? {
      presente: true,
      /* naturalWidth = 0 significa que o arquivo NAO carregou. E a unica forma
         de distinguir "imagem quebrada" de "imagem que eu nao olhei". */
      carregou: lg.naturalWidth > 0,
      nw: lg.naturalWidth,
      filtro: getComputedStyle(lg).filter,
      alt: lg.getAttribute("alt") || "",
      altura: Math.round(lg.getBoundingClientRect().height),
    } : { presente: false };

    return {
      altura: Math.ceil(fundo - r.top),
      largura: Math.ceil(direita - r.left),
      raizA: Math.round(r.height),
      raizL: Math.round(r.width),
      xdcBloco: cs.display,
      contados,
      quadro: QUADRO,
      bg, claro, logo,
    };
  }, { w: 1280, h: 860 });

  const png = path.join(SAIDA, arq.replace(/\.dc\.html$/, "") + ".png");
  await pag.screenshot({ path: png });
  await ctx.close();

  const avisos = [];
  if (m.semRaiz) avisos.push("nao achei <x-dc> — o arquivo nao esta no formato");
  if (m.xdcBloco && m.xdcBloco !== "block") avisos.push(`x-dc nao esta display:block (${m.xdcBloco}) — layout desaba`);
  /* Um artboard que mede 4 elementos nao foi desenhado: quase sempre e um
     arquivo pego no meio da escrita. Sem esta contagem a captura sai preta e o
     relatorio diz "ok". */
  if (m.contados !== undefined && m.contados < 12) avisos.push(`so ${m.contados} elementos desenhados — arquivo incompleto?`);
  if (m.altura > 860) avisos.push(`conteudo desce ate ${m.altura}px: ${m.altura - 860}px CORTADOS no quadro de 860`);
  if (m.largura > 1280) avisos.push(`conteudo vai ate ${m.largura}px: ${m.largura - 1280}px CORTADOS no quadro de 1280`);
  /* Sobra grande nao e defeito, e informacao de composicao: 150px de vazio no
     pe de uma tela e uma decisao, e quem revisa por imagem precisa ver o numero. */
  if (m.altura && m.altura < 700) avisos.push(`nota: conteudo para em ${m.altura}px — ${860 - m.altura}px de sobra no pe`);

  const L = m.logo;
  if (L && !L.presente) {
    avisos.push("sem img.eplogo — a logo da Ecommerce Puro nao esta nesta topbar");
  } else if (L) {
    if (!L.carregou) avisos.push("img.eplogo NAO carregou (naturalWidth=0) — src quebrado, renderiza vazio sem erro");
    if (!L.alt) avisos.push("img.eplogo sem alt");
    /* 32px e a altura do `.eplogo` do app, e vale para os artboards que SAO o
       painel. `Baixar.dc.html` nao e: e a pagina do site, outro contexto, e o
       ADENDO 3 do BRIEF autorizou a logo maior ali. Excecao nomeada e nao
       heuristica — adivinhar "e site ou e painel" pelo conteudo erraria no dia
       em que alguem fizesse uma segunda pagina de site. */
    const ALTURA_LOGO = { "Baixar.dc.html": 40 };
    const esperada = ALTURA_LOGO[arq] || 32;
    if (L.altura !== esperada) {
      avisos.push(`img.eplogo com ${L.altura}px de altura, esperado ${esperada}`
        + (esperada === 32 ? " (o valor do app)" : " (excecao nomeada para a pagina de site)"));
    }
    /* A arte e branca. Claro sem invert = invisivel; escuro COM invert = preta
       sobre fundo preto. Os dois erros sao o mesmo defeito em direcoes opostas. */
    const invertido = /invert/.test(L.filtro) && !/invert\(0\)/.test(L.filtro);
    if (m.claro && !invertido) avisos.push(`logo BRANCA sem invert num artboard claro (bg ${m.bg}) — fica invisivel`);
    if (!m.claro && invertido) avisos.push(`logo invertida num artboard escuro (bg ${m.bg}) — fica preta sobre fundo preto`);
  }

  rel.push({ arq, png: path.basename(png), ...m, erros, avisos });

  const sinal = avisos.length || erros.length ? "!!" : "ok";
  console.log(`${sinal}  ${arq}  ${m.largura}x${m.altura}`);
  for (const a of avisos) console.log(`      aviso: ${a}`);
  for (const e of erros.slice(0, 3)) console.log(`      ${e}`);
}

await nav.close();

/* ------------------------------------------------------------ folha de contato
   Uma página só, tema do painel, para olhar tudo em sequência. Cada cartão
   carrega os avisos da própria captura: uma folha que mostra só a imagem
   esconde justamente o corte de 40px que o olho não pega. */
const cartoes = rel.map((r) => {
  const [ix, nome] = LEGENDA[r.arq] || ["[ — ]", r.arq.replace(/\.dc\.html$/, "")];
  const problemas = [...r.avisos, ...r.erros];
  const faixa = problemas.length
    ? `<ul class="prob">${problemas.map((p) => `<li>${p.replace(/</g, "&lt;")}</li>`).join("")}</ul>`
    : `<p class="limpo">cabe no quadro · nenhum erro de pagina</p>`;
  return `<figure>
  <figcaption><span class="ix">${ix}</span> ${nome}
    <span class="dim">${r.largura}&times;${r.altura}</span></figcaption>
  <a href="png/${r.png}" target="_blank"><img src="png/${r.png}" alt="${nome}" width="1280" height="860"></a>
  ${faixa}
</figure>`;
}).join("\n");

const comProblema = rel.filter((r) => r.avisos.length || r.erros.length).length;

await writeFile(path.join(AQUI, "preview.html"), `<!doctype html>
<meta charset="utf-8">
<title>Cockpit — telas de entrada</title>
<style>
  :root { --bg:#06060B; --surface:#0E0F1A; --line:rgba(255,255,255,.09);
    --line-soft:rgba(255,255,255,.05); --txt:#E9EBF5; --txt-dim:#AAAFC2;
    --txt-faint:#777D92; --brand:#FF5A1F; --risk-soft:#FF4F5E1a; --risk-txt:#FF4F5E;
    --ok-txt:#2FD48F;
    --font:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;
    --font-num:"Cascadia Mono",Consolas,ui-monospace,monospace; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--txt); font-family:var(--font);
    padding:34px 34px 90px }
  h1 { font-size:19px; font-weight:650; letter-spacing:-.02em; margin:0 0 6px }
  .sub { font-family:var(--font-num); font-size:10.5px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--txt-faint); margin:0 0 26px }
  .sub b { color:${comProblema ? "var(--risk-txt)" : "var(--ok-txt)"} }
  figure { margin:0 0 30px; max-width:1280px }
  figcaption { display:flex; align-items:center; gap:10px; font-size:13.5px; font-weight:600;
    margin-bottom:9px }
  figcaption .ix { font-family:var(--font-num); font-size:10.5px; letter-spacing:.14em;
    color:var(--brand); font-weight:400 }
  figcaption .dim { margin-left:auto; font-family:var(--font-num); font-size:10.5px;
    color:var(--txt-faint); font-weight:400; font-variant-numeric:tabular-nums }
  img { display:block; width:100%; height:auto; border:1px solid var(--line);
    border-radius:12px; background:var(--surface) }
  .prob { margin:9px 0 0; padding:9px 12px; list-style:none; background:var(--risk-soft);
    border-radius:8px; font-family:var(--font-num); font-size:11px; line-height:1.7;
    color:var(--risk-txt) }
  .limpo { margin:9px 0 0; font-family:var(--font-num); font-size:10.5px;
    letter-spacing:.1em; text-transform:uppercase; color:var(--txt-faint) }
</style>
<h1>Telas de entrada do Cockpit — preview</h1>
<p class="sub">${rel.length} artboards &middot; quadro 1280&times;860 &middot; captura 2&times; &middot;
  <b>${comProblema ? comProblema + " com aviso" : "nenhum aviso"}</b> &middot; nada foi publicado</p>
${cartoes}
`, "utf8");

console.log(`\nfolha de contato: ${path.join(AQUI, "preview.html")}`);
console.log(comProblema ? `${comProblema} artboard(s) com aviso — leia a folha` : "todos couberam no quadro");
