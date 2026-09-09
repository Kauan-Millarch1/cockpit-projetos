"use strict";
/* ============================================================================
 * tutorial-test.js — a rota que serve o vídeo do tutorial, e o bloco de juízo
 * que decide se o convite aparece.
 *
 * O QUE ELE EXISTE PARA PEGAR, e por que cada um importa:
 *
 *   1. `Range`. Sem `206 Partial Content` a barra de progresso não busca: o
 *      navegador baixa o arquivo inteiro desde o começo a cada arrasto. O pedido
 *      foi "botão para retroceder ou avançar o video", e isso é a rota, não a
 *      tela. A faixa é conferida nas cinco formas que um navegador manda:
 *      completa, aberta no fim, SUFIXO (`bytes=-N`, o que o Safari usa), fora do
 *      arquivo (416) e ausente (200).
 *
 *   2. O caminho. O nome do arquivo sai do LEDGER, nunca da URL — mas o teste
 *      dirige a rota com `../` no slug de qualquer forma, porque "o arquivo é meu,
 *      então é seguro" é a premissa que este repositório já viu falhar.
 *
 *   3. As DUAS formas de 404, que levam a lugares opostos: sem ledger ninguém
 *      registrou tutorial nenhum; com ledger e sem arquivo, o `.mp4` saiu do
 *      disco. Uma manda rodar o registrador, a outra manda procurar o arquivo.
 *
 *   4. O TERCEIRO ESTADO da tela. `S.tut` ausente é "a resposta não chegou", e
 *      não "não existe tutorial" — a nona vez que este projeto escreve essa
 *      regra, e a primeira em que o galho negativo esconderia um convite.
 *
 * A ROTA É EXTRAÍDA DE `server.js` ENTRE DELIMITADORES e dirigida com um
 * `req`/`res` falsos: aquele arquivo não é `require`ável (ele dá `listen()` na
 * 4317, o terminal de verdade do Kauan), e reimplementar as guardas aqui provaria
 * a cópia. Mesma disciplina do `anexo-bolha-test.js`.
 *
 * O BLOCO DE JUÍZO É EXTRAÍDO DE `upgrade.html` em tempo de execução, pela mesma
 * razão.
 *
 * Livre: nenhum modelo, nenhuma rede, nada escrito no repositório — só num
 * diretório temporário, removido num `finally`.
 *
 *   node tutorial-test.js
 * ========================================================================== */

const fs = require("fs");
const os = require("os");
const path = require("path");
const estatico = require("./estatico");

let ok = 0, bad = 0, pulados = 0;
const t = (nome, cond) => { if (cond) { ok++; } else { bad++; console.log("  FALHOU: " + nome); } };

/* ─────────────────────────── a rota, extraída de `server.js` ────────────── */

function montarRota(dirTutoriais) {
  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const i = src.indexOf("/* TUTORIAL-INI");
  const f = src.indexOf("/* TUTORIAL-FIM */");
  if (i < 0 || f < 0) throw new Error("nao achei os delimitadores TUTORIAL-INI/FIM em server.js");
  const bloco = src.slice(i, f);

  /* `__dirname` dentro do bloco aponta para a raiz do projeto. Aqui ele precisa
     apontar para o diretório do fixture, senão o teste mediria os tutoriais de
     verdade — e um teste que lê o estado real passa ou falha conforme o disco. */
  const corpo = "return async function rota(p, req, res, json, url) {\n"
    + bloco.replace(/__dirname/g, "DIRBASE")
    + "\n  return { naoCasou: true };\n};";
  // eslint-disable-next-line no-new-func
  return new Function("fs", "path", "estatico", "DIRBASE", corpo)(
    fs, path, estatico, path.dirname(dirTutoriais));
}

function resFalso() {
  const r = {
    status: null, headers: null, corpo: Buffer.alloc(0), acabou: false, destruido: false,
    writeHead(s, h) { r.status = s; r.headers = h || {}; return r; },
    end(b) { if (b) r.corpo = Buffer.isBuffer(b) ? b : Buffer.from(String(b)); r.acabou = true; return r; },
    write(b) { r.corpo = Buffer.concat([r.corpo, Buffer.isBuffer(b) ? b : Buffer.from(String(b))]); return r; },
    destroy() { r.destruido = true; return r; },
    on() { return r; },
    once() { return r; },
    emit() { return r; }
  };
  return r;
}

/* `json` do `server.js`, transcrito: a rota o recebe como parâmetro, e o que ele
   faz com o corpo é o que os casos leem. */
function jsonFalso(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
  return res;
}

/* `pipe` é o que a rota usa no caminho de sucesso. Como o `res` falso não é um
   stream de verdade, o teste espera o fim lendo o próprio arquivo com a faixa que
   os cabeçalhos declaram — o que é MAIS forte do que confiar no pipe: ele confere
   que o `content-range` descreve os bytes que realmente existem ali. */
async function chamar(rota, p, opcoes) {
  const o = opcoes || {};
  const req = { method: o.metodo || "GET", headers: o.headers || {} };
  const res = resFalso();
  const url = new URL("http://x" + p);
  await rota(p, req, res, jsonFalso, url);
  return res;
}

/* ───────────────────────────────── o fixture ────────────────────────────── */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tutorial-test-"));
const DIR = path.join(TMP, "tutoriais");

/* Envolvido numa IIFE assíncrona, e não com `await` no topo: `require` mais
   `await` de primeiro nível deixa o Node sem saber se o arquivo é CommonJS ou
   ESM, e ele recusa com `ERR_AMBIGUOUS_MODULE_SYNTAX` antes de rodar uma linha.
   Todo teste desta casa é CommonJS. */
(async () => {
try {
  fs.mkdirSync(DIR, { recursive: true });
  /* Um "vídeo" de 5000 bytes com conteúdo determinístico: cada byte é o índice
     módulo 251, então qualquer faixa pode ser conferida por cálculo em vez de por
     comparação com outra leitura do mesmo arquivo. */
  const TAM = 5000;
  const MP4 = Buffer.alloc(TAM);
  for (let i = 0; i < TAM; i++) MP4[i] = i % 251;
  fs.writeFileSync(path.join(DIR, "upgrade.mp4"), MP4);
  fs.writeFileSync(path.join(DIR, "upgrade.jpg"), Buffer.from("fingindo ser jpeg"));
  fs.writeFileSync(path.join(DIR, "tutoriais.json"), JSON.stringify({
    upgrade: { arquivo: "upgrade.mp4", poster: "upgrade.jpg", segundos: 109.737,
               titulo: "Upgrade — como usar esta tela", subtitulo: "sub", registradoEm: "2026-08-27T00:00:00.000Z" },
    fantasma: { arquivo: "naoexiste.mp4", poster: "naoexiste.jpg", segundos: 10, titulo: "T", subtitulo: "s" },
    torto: { arquivo: "../server.js", poster: "x.jpg", segundos: 1, titulo: "T", subtitulo: "s" }
  }, null, 2));

  const rota = montarRota(DIR);

  /* ══════════════ 1 · a lista ══════════════ */
  console.log("\n[1] a lista de tutoriais");
  {
    const r = await chamar(rota, "/api/tutorial");
    const b = JSON.parse(r.corpo.toString());
    t("responde 200", r.status === 200);
    t("lista os tres do ledger", (b.tutoriais || []).length === 3);
    const u = b.tutoriais.find(x => x.slug === "upgrade");
    const g = b.tutoriais.find(x => x.slug === "fantasma");
    t("o que existe vem `existe: true`", u && u.existe === true);
    t("o tamanho vem do disco, nao do ledger", u && u.bytes === TAM);
    t("o poster presente e reportado", u && u.poster === true);
    t("a duracao vem do ledger", u && u.segundos === 109.737);
    /* O CASO QUE CARREGA ESTE BLOCO: o ledger promete e o disco nao tem. Se
       `existe` viesse do ledger, a tela ofereceria um play que nao toca — e quem
       clica conclui que o painel esta quebrado, nao que o arquivo faltou. */
    t("o que NAO existe vem `existe: false`", g && g.existe === false);
    t("e sem tamanho, em vez de zero", g && g.bytes === null);
    t("e sem poster", g && g.poster === false);
  }

  /* ══════════════ 2 · os bytes, sem faixa ══════════════ */
  console.log("\n[2] servir o arquivo inteiro");
  {
    const r = await chamar(rota, "/api/tutorial/upgrade.mp4");
    t("responde 200", r.status === 200);
    t("content-type video/mp4", r.headers["content-type"] === "video/mp4");
    t("content-length e o tamanho real", r.headers["content-length"] === String(TAM));
    /* SEM `accept-ranges` alguns players DESABILITAM a barra inteira. E a rota
       existe justamente para a barra funcionar. */
    t("declara accept-ranges: bytes", r.headers["accept-ranges"] === "bytes");
    t("carrega os cabecalhos de seguranca", r.headers["x-content-type-options"] === "nosniff");
    const rj = await chamar(rota, "/api/tutorial/upgrade.jpg");
    t("o poster sai como image/jpeg", rj.status === 200 && rj.headers["content-type"] === "image/jpeg");
    const rh = await chamar(rota, "/api/tutorial/upgrade.mp4", { metodo: "HEAD" });
    t("HEAD responde 200 com corpo vazio", rh.status === 200 && rh.corpo.length === 0);
    t("HEAD ainda declara o tamanho", rh.headers["content-length"] === String(TAM));
    const rp = await chamar(rota, "/api/tutorial/upgrade.mp4", { metodo: "POST" });
    t("POST e recusado com 405", rp.status === 405);
  }

  /* ══════════════ 3 · a faixa ══════════════ */
  console.log("\n[3] Range — o que faz a barra buscar");
  {
    const r = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "bytes=100-199" } });
    t("faixa completa responde 206", r.status === 206);
    t("content-range descreve a faixa", r.headers["content-range"] === "bytes 100-199/5000");
    t("content-length e o tamanho da faixa", r.headers["content-length"] === "100");

    const ab = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "bytes=4900-" } });
    t("faixa aberta no fim responde 206", ab.status === 206);
    t("e vai ate o ultimo byte", ab.headers["content-range"] === "bytes 4900-4999/5000");
    t("com o tamanho certo", ab.headers["content-length"] === "100");

    /* O SUFIXO. `bytes=-N` pede os ULTIMOS N bytes, e e assim que um player le o
       indice de um mp4 sem `faststart`. Recusa-lo da um video que nao abre num
       navegador so — o tipo de defeito que so aparece na maquina de outra pessoa. */
    const sx = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "bytes=-50" } });
    t("sufixo responde 206", sx.status === 206);
    t("sufixo pega os ultimos N", sx.headers["content-range"] === "bytes 4950-4999/5000");

    /* Pedir alem do fim NAO e erro: o navegador chuta um fim e espera ser
       corrigido. Devolver 416 aqui abortaria o carregamento do video. */
    const al = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "bytes=4990-999999" } });
    t("fim alem do arquivo e recortado, nao recusado", al.status === 206
      && al.headers["content-range"] === "bytes 4990-4999/5000");

    /* INICIO alem do fim e 416, E com `content-range: bytes * /tamanho` — e assim
       que o cliente descobre o tamanho e refaz o pedido. Um 200 aqui mandaria o
       arquivo inteiro para quem pediu um pedaco fora dele. */
    const fo = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "bytes=99999-" } });
    t("inicio fora do arquivo responde 416", fo.status === 416);
    t("e o 416 diz o tamanho real", fo.headers["content-range"] === "bytes */5000");

    const vaz = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "bytes=-" } });
    t("`bytes=-` sem numero cai no 200 inteiro", vaz.status === 200);
    const lixo = await chamar(rota, "/api/tutorial/upgrade.mp4", { headers: { range: "coisas=1-2" } });
    t("faixa em formato desconhecido cai no 200 inteiro", lixo.status === 200);
  }

  /* ══════════════ 4 · o caminho ══════════════ */
  console.log("\n[4] o caminho — o nome sai do ledger, nunca da URL");
  {
    for (const mau of ["../server.js", "..%2Fserver.js", "sub/upgrade.mp4", "UPGRADE.mp4",
                       "upgrade.js", "upgrade", "upgrade.mp4.js", ".env"]) {
      const r = await chamar(rota, "/api/tutorial/" + mau);
      t("recusa `" + mau + "`", r.status === 400 || r.status === 404);
      t("e nao devolve bytes de `" + mau + "`", r.status !== 200 && r.status !== 206);
    }
    /* O SLUG `torto` ESTA NO LEDGER e aponta para fora da pasta. A regex do slug o
       aceita (ele e minusculo e sem ponto) — quem o para e a checagem do NOME do
       arquivo, que e a segunda camada. Sem ela, um ledger corrompido serviria
       `server.js` como `video/mp4`. */
    const r = await chamar(rota, "/api/tutorial/torto.mp4");
    t("slug do ledger apontando para fora da pasta e recusado", r.status === 500);
    t("e a recusa nao entrega bytes", r.corpo.toString().indexOf("require(") < 0);
  }

  /* ══════════════ 5 · as duas formas de 404 ══════════════ */
  console.log("\n[5] 404 e um fato sobre o disco, e diz QUAL");
  {
    const g = await chamar(rota, "/api/tutorial/fantasma.mp4");
    t("ledger promete e disco nao tem: 404", g.status === 404);
    const gb = JSON.parse(g.corpo.toString());
    t("e o corpo NOMEIA o arquivo que falta", gb.arquivo === "naoexiste.mp4");
    t("e a frase fala do disco, nao de rota inexistente",
      /nao esta no disco|não está no disco/.test(gb.error));

    const d = await chamar(rota, "/api/tutorial/inexistente.mp4");
    t("slug fora do ledger: 404", d.status === 404);
    t("com frase de desconhecido, nao de disco",
      /desconhecido/.test(JSON.parse(d.corpo.toString()).error));

    /* SEM LEDGER a lista responde 200 com `semLedger`, e nao 404. A tela precisa
       distinguir "ninguem registrou nada" de "esta rota nao existe no servidor que
       esta rodando" — o `callApi` desta casa transforma 404 na segunda frase, que
       manda procurar processo velho. */
    fs.renameSync(path.join(DIR, "tutoriais.json"), path.join(DIR, "guardado.json"));
    const sl = await chamar(rota, "/api/tutorial");
    const slb = JSON.parse(sl.corpo.toString());
    t("sem ledger a lista responde 200", sl.status === 200);
    t("com a lista vazia", Array.isArray(slb.tutoriais) && slb.tutoriais.length === 0);
    t("e marcada `semLedger`", slb.semLedger === true);
    t("e o detalhe nomeia o registrador", /tutorial-registrar/.test(slb.detalhe || ""));
    const sb = await chamar(rota, "/api/tutorial/upgrade.mp4");
    t("sem ledger os bytes respondem 404", sb.status === 404);
    fs.renameSync(path.join(DIR, "guardado.json"), path.join(DIR, "tutoriais.json"));
  }

  /* ══════════════ 6 · o juízo, agora no módulo servido ══════════════ */
  console.log("\n[6] o juizo do /tutorial.js — os quatro estados, o ja vi, o mm:ss");
  {
    /* O MÓDULO DE VERDADE, `require`ado, e não um bloco extraído de uma página:
       ele saiu do `upgrade.html` e virou arquivo servido, então extrair de HTML
       aqui provaria a cópia de uma cópia que já não existe. `estadoDe` é PURA de
       propósito — recebe a resposta em vez de lê-la do estado — e é isso que faz
       os quatro estados testáveis sem navegador e sem rede.

       `global.window` ANTES do `require`: o módulo lê o `localStorage` através da
       janela, então é assim que o teste exercita o "já vi" sem navegador. Um
       módulo que lesse `localStorage` direto viraria um `catch` silencioso em
       Node e o "já vi" ficaria sem prova nenhuma. */
    const mem = {};
    global.window = {
      localStorage: {
        getItem: k => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; }
      }
    };
    const T = require("./tutorial.js");

    const pronto = s => ({ tutoriais: [{ slug: s, existe: true, segundos: 109.737, registradoEm: "A" }] });

    /* O TERCEIRO ESTADO, e é a nona vez que este projeto o escreve. A resposta
       ausente é "ainda não chegou". Cair no galho negativo faria a tela dizer que
       não há tutorial durante o boot, e a frase apareceria e sumiria — o segundo
       salto é o que lê como defeito. */
    t("resposta ausente e `carregando`, nunca `naoRegistrado`",
      T.estadoDe(null, "upgrade").estado === "carregando");
    t("lista vazia e `naoRegistrado`",
      T.estadoDe({ tutoriais: [] }, "upgrade").estado === "naoRegistrado");
    t("ledger sem arquivo e `semArquivo`, um estado PROPRIO",
      T.estadoDe({ tutoriais: [{ slug: "upgrade", existe: false }] }, "upgrade").estado === "semArquivo");
    t("com arquivo e `pronto`", T.estadoDe(pronto("upgrade"), "upgrade").estado === "pronto");
    /* Os quatro estados sao QUATRO, e nenhum par colapsa: `semArquivo` levando ao
       mesmo lugar que `naoRegistrado` esconderia que o arquivo saiu do disco. */
    const estados = [
      T.estadoDe(null, "upgrade").estado,
      T.estadoDe({ tutoriais: [] }, "upgrade").estado,
      T.estadoDe({ tutoriais: [{ slug: "upgrade", existe: false }] }, "upgrade").estado,
      T.estadoDe(pronto("upgrade"), "upgrade").estado
    ];
    t("os quatro estados sao distintos", new Set(estados).size === 4);

    /* TRES SLUGS, e este e o bloco que so passou a existir com as tres paginas: o
       ledger e um so, e o modulo tem de achar o tutorial DAQUELA tela nele. Uma
       tela pedindo o slug de outra e o defeito que serviria o video errado. */
    const tres = { tutoriais: [
      { slug: "fluxos", existe: true, segundos: 99.5, registradoEm: "F" },
      { slug: "tester", existe: true, segundos: 120.05, registradoEm: "T" },
      { slug: "upgrade", existe: true, segundos: 109.737, registradoEm: "U" }
    ] };
    for (const [slug, seg] of [["fluxos", 99.5], ["tester", 120.05], ["upgrade", 109.737]]) {
      const d = T.estadoDe(tres, slug);
      t("acha o tutorial de `" + slug + "` no ledger dos tres", d.estado === "pronto" && d.t.segundos === seg);
    }
    /* O MODULO NAO FAREJA A FORMA DA RESPOSTA, e este caso e a lembranca de um
       defeito que passou por TODO o teste de fonte e so o navegador viu: o
       `callApi` do `flows.html` devolve `{ok, status, body}` em vez do corpo, e
       aquele invólucro chegou aqui como se FOSSE o ledger — `tutoriais` vinha
       `undefined`, a faixa nao aparecia, e nao havia erro nenhum no console.
       A correcao mora na costura (a pagina adapta no `configurar`), e este caso
       fixa a decisao de NAO adivinhar: um modulo que aceitasse as duas formas
       seria o defeito do `Response.json()` num corpo 404 outra vez. */
    t("um invólucro {ok,body} NAO e o ledger — o modulo nao adivinha forma",
      T.estadoDe({ ok: true, status: 200, body: { tutoriais: [{ slug: "fluxos", existe: true }] } }, "fluxos").estado
        === "naoRegistrado");
    t("um slug que nao esta no ledger dos tres e `naoRegistrado`",
      T.estadoDe(tres, "disco").estado === "naoRegistrado");

    t("nao visto por padrao", T.visto("upgrade", "A") === false);
    T.marcarVisto("upgrade", "A");
    t("visto depois de marcar", T.visto("upgrade", "A") === true);
    /* A VERSAO NA CHAVE: se o video for reeditado, `registradoEm` muda e o convite
       VOLTA — o que ela ja viu foi outro video. */
    t("outra versao do video volta a nao estar vista", T.visto("upgrade", "B") === false);
    /* A CHAVE CARREGA O SLUG, e com tres tutoriais isso deixou de ser hipotese:
       esconder o do Upgrade nao pode esconder o do Fluxos nem o do Tester. */
    t("outro slug nao herda o visto", T.visto("fluxos", "F") === false);
    t("e o terceiro tambem nao", T.visto("tester", "T") === false);
    T.marcarVisto("fluxos", "F");
    t("marcar um nao marca os outros",
      T.visto("fluxos", "F") === true && T.visto("tester", "T") === false && T.visto("upgrade", "A") === true);
    /* Ledger sem data: exigir a data faria o convite voltar para sempre. */
    t("sem data no ledger, marcado vale como visto", T.visto("upgrade", null) === true);

    t("mm:ss de 109,737 e 1:49", T.tempo(109.737) === "1:49");
    t("mm:ss de 99,5 (o Fluxos) e 1:39", T.tempo(99.5) === "1:39");
    t("mm:ss de 120,05 (o Tester) e 2:00", T.tempo(120.05) === "2:00");
    t("mm:ss de 0 e 0:00", T.tempo(0) === "0:00");
    t("mm:ss de 59,9 e 0:59, nunca 0:60", T.tempo(59.9) === "0:59");
    /* O DEFEITO `1:60`: arredondar minuto e segundo em separado o imprime para
       119,995s. Este projeto ja o pagou na contagem dos roteiros. */
    t("mm:ss de 119,995 e 1:59, nunca 1:60", T.tempo(119.995) === "1:59");
    t("negativo nao vira `-1:-1`", T.tempo(-5) === "0:00");
    t("nao-numero nao vira NaN", T.tempo(undefined) === "0:00");

    t("o pulo e 10s", T.PULO === 10);
    /* CADA TECLA PROMETIDA NO RODAPE DO PLAYER EXISTE NA TABELA. Um atalho
       anunciado que nao funciona e pior que atalho nenhum. O rodape agora e
       montado pelo modulo, entao ele e a fonte dos dois lados — que e o que
       impede a promessa e a tabela de divergirem. */
    for (const tecla of [" ", "ArrowLeft", "ArrowRight", "m", "f"]) {
      t("a tabela conhece a tecla " + JSON.stringify(tecla), !!T.TECLAS[tecla]);
    }
    const fonteMod = fs.readFileSync(path.join(__dirname, "tutorial.js"), "utf8");
    const rodape = fonteMod.slice(fonteMod.indexOf('<div class="tut-ft">'), fonteMod.indexOf("Esc</b> fecha") + 40);
    t("o rodape promete espaco", /espaço/.test(rodape));
    t("o rodape promete as setas", /←/.test(rodape) && /→/.test(rodape));
    t("o rodape promete `m` e `f`", /<b>m<\/b>/.test(rodape) && /<b>f<\/b>/.test(rodape));
    t("o rodape promete Esc", /Esc/.test(rodape));
    t("o rodape diz que os dados sao de exemplo", /dados de exemplo/.test(rodape));

    /* `configurar` RECUSA POR NOME o que falta, e isso nao e zelo: sem `render` a
       faixa nunca sairia da tela depois de "ja vi", e o sintoma seria um botao que
       nao faz nada. Um `undefined is not a function` mandaria quem le cacar o bug
       na pagina errada. */
    const recusa = fn => { try { fn(); return null; } catch (e) { return e.message; } };
    t("configurar sem slug recusa por nome",
      /precisa de/.test(recusa(() => T.configurar({ callApi: () => {}, render: () => {} })) || ""));
    t("configurar sem callApi recusa por nome",
      /precisa de/.test(recusa(() => T.configurar({ slug: "x", render: () => {} })) || ""));
    t("configurar sem render recusa por nome",
      /precisa de/.test(recusa(() => T.configurar({ slug: "x", callApi: () => {} })) || ""));
    /* O slug vai para dentro de uma URL (`/api/tutorial/<slug>.mp4`) e para dentro
       de uma chave de `localStorage`. A rota do servidor ja o valida com a mesma
       forma; validar aqui tambem e a segunda camada que esta casa insiste em ter. */
    t("configurar com slug torto recusa",
      /slug inválido/.test(recusa(() => T.configurar({ slug: "../x", callApi: () => {}, render: () => {} })) || ""));
    t("configurar com slug maiusculo recusa",
      /slug inválido/.test(recusa(() => T.configurar({ slug: "Fluxos", callApi: () => {}, render: () => {} })) || ""));

    /* A FAIXA, desenhada sem navegador: `hero()` e string, e os quatro estados dela
       sao os do juizo mais o "ja vi". */
    let pintou = 0;
    T.configurar({
      slug: "fluxos", aba: "Fluxos", callApi: async () => ({ tutoriais: [] }),
      render: () => { pintou++; },
      cauda: "do painel ao vivo ate a falha entregue ao Claude",
      marcos: [["ler", "a"], ["achar", "b"], ["agir", "c"]]
    });
    T._st.resp = null; T._st.escondido = false;
    t("sem resposta a faixa e vazia — nada de desenhar e trocar depois", T.hero() === "");
    t("e a tira tambem", T.tira() === "");
    T._st.resp = { tutoriais: [{ slug: "fluxos", existe: false, segundos: 99.5 }] };
    t("ledger sem arquivo no disco NAO oferece play", T.hero() === "" && T.tira() === "");
    T._st.resp = { tutoriais: [{ slug: "fluxos", existe: true, segundos: 99.5, poster: true,
      titulo: "Fluxos — como usar esta tela", subtitulo: "sub", registradoEm: "F2" }] };
    const faixa = T.hero();
    t("com arquivo, a faixa aparece", faixa.includes("tut-hero"));
    t("com a duracao medida do proprio video", faixa.includes("1:39"));
    t("e o poster vem da rota do slug", faixa.includes("/api/tutorial/fluxos.jpg"));
    t("os tres marcos entram como lista numerada por CSS", (faixa.match(/<li><b>/g) || []).length === 3);
    /* A CAUDA E FRAGMENTO, e o ponto final e posto pelo modulo: `escreve..` e o
       mesmo defeito visto de perto, e uma frase montada com um pedaco que nao sabe
       que virou frase e a familia do numero digitado a mao. */
    t("a frase do convite termina com UM ponto",
      /Claude\.<\/p>/.test(faixa) && !/\.\.<\/p>/.test(faixa));
    /* COM A FAIXA NA TELA A TIRA NAO EXISTE: a porta grande ja esta aberta, e dois
       convites para o mesmo video na mesma tela e ruido. */
    t("com a faixa na tela, a tira e vazia", T.tira() === "");
    T._st.escondido = true;
    t("depois de `ja vi`, a faixa sai", T.hero() === "");
    t("...e a tira com o botao pequeno fica", T.tira().includes("tut-mini"));
    /* Uma tela sem video nao ganha porta nenhuma. */
    T._st.resp = { tutoriais: [] };
    t("sem tutorial registrado nao ha botao pequeno", T.mini() === "" && T.tira() === "");

    /* SEM MARCOS a terceira coluna nao existe — e o caminho que o /tester usa, por
       causa dos 700px do `.open-in`. Inventar uma lista curta ali seria a mentira
       de um rotulo digitado de memoria. */
    T.configurar({ slug: "tester", aba: "Tester", callApi: async () => ({}), render: () => {},
      cauda: "da ideia ate o arquivo pronto" });
    T._st.resp = { tutoriais: [{ slug: "tester", existe: true, segundos: 120.05, poster: true,
      titulo: "Tester", subtitulo: "s", registradoEm: "T2" }] };
    T._st.escondido = false;
    const semMarcos = T.hero();
    t("sem marcos declarados, nenhuma lista e desenhada", !semMarcos.includes("tut-marcos"));
    t("mas o convite continua inteiro", semMarcos.includes("tut-hero") && semMarcos.includes("2:00"));

    /* `carregar()` NUNCA levanta: um tutorial que nao carrega nao pode derrubar a
       tela, e um aviso vermelho por causa dele acusaria a instancia de algo que nao
       tem a ver com ela. Ele repinta de qualquer jeito, porque o estado mudou de
       "nao sei" para "nao tem". */
    let pintou2 = 0;
    T.configurar({ slug: "fluxos", callApi: async () => { throw new Error("caiu"); },
      render: () => { pintou2++; } });
    await T.carregar();
    t("carregar() com a rota caida nao levanta", true);
    t("...e ainda repinta", pintou2 === 1);
    t("...e o estado passa a ser `naoRegistrado`, nunca `carregando` para sempre",
      T.estadoDe(T._st.resp, "fluxos").estado === "naoRegistrado");

    delete global.window;
  }

  /* ══════════════ 7 · a fiação das TRES páginas ══════════════ */
  console.log("\n[7] a fiacao das tres paginas, em fonte SEM COMENTARIO");
  {
    /* SEM COMENTARIO, e essa e a licao que `dossie-tela-test.js` pagou: duas
       asserções ficaram verdes porque um comentario carregava o nome que elas
       procuravam. Comentario e string removidos antes de medir — um `title="..."`
       que cite um nome nao pode contar como declaracao dele. */
    const nuinha = txt => String(txt)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[\s;{}()])\/\/[^\n]*/g, "$1 ")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    const scripts = h => [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
    /* DUAS FERRAMENTAS, e a diferenca entre elas e o que quatro asserções desta
       rodada custaram: `nuinha` esvazia STRING tambem, porque um `title="..."` que
       cite um nome nao pode contar como declaracao dele — e por isso ela e inutil
       para conferir ORDEM, onde o que se procura E uma string
       (`querySelector(".scrim")` virava `querySelector("")`). `semComentario` tira
       so o comentario, que e a licao do `dossie-tela-test.js`: um comentario
       carregando o nome procurado deixou duas asserções verdes sobre codigo que
       nao existia mais. Uma ferramenta para cada pergunta. */
    const semComentario = txt => String(txt)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[\s;{}()])\/\/[^\n]*/g, "$1 ");

    const PAG = {
      flows: fs.readFileSync(path.join(__dirname, "flows.html"), "utf8"),
      tester: fs.readFileSync(path.join(__dirname, "tester.html"), "utf8"),
      upgrade: fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8")
    };
    const SRV = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

    t("o servidor serve `/tutorial.js`",
      /p === "\/tutorial\.js"/.test(SRV) && /path\.join\(__dirname, "tutorial\.js"\)/.test(SRV));
    /* OS BYTES DO VIDEO NAO PASSAM PELO `serveFile`, e isso e a rota inteira: ele
       le tudo com `readFileSync` e o `estatico.negociar` guarda o buffer por mtime
       — 25 MB na memoria do processo ate o restart, e sem `206` a barra nao busca. */
    t("e os bytes do video NAO passam pelo serveFile",
      !/serveFile\([^)]*tutoriais/.test(SRV));
    /* A GRAVACAO tambem precisa da rota: sem ela os medidores servem uma pagina que
       pede um script que ninguem responde, e o sintoma e uma faixa que nao existe
       numa captura. */
    /* `.video/` e GITIGNORADO de proposito — e o pipeline de video, binario grande e
       regeneravel a partir do roteiro. Entao num checkout novo este arquivo nao
       existe, e um `readFileSync` seco explodia a bateria inteira: MEDIDO num clone
       de verdade, `EXPLODIU: ENOENT ... .video\gravar-lib.js`, levando com ele as
       outras 197 asserções deste arquivo. O pulo e NOMEADO e CONTADO — verde
       silencioso aqui seria pior que o estouro, porque diria que uma asserção que
       nunca rodou passou. */
    const pGrav = path.join(__dirname, ".video", "gravar-lib.js");
    if (fs.existsSync(pGrav)) {
      const GRAV = fs.readFileSync(pGrav, "utf8");
      t("a gravacao registra `/tutorial.js` nos estaticos", /"\/tutorial\.js": "tutorial\.js"/.test(GRAV));
    } else {
      pulados++;
      console.log("  PULADO  a gravacao registra `/tutorial.js` nos estaticos"
        + " — `.video/gravar-lib.js` nao existe neste checkout (a pasta e gitignorada)");
    }

    for (const [pg, h] of Object.entries(PAG)) {
      const tags = [...h.matchAll(/<script[^>]*src="\/tutorial\.js"[^>]*>/g)];
      t(pg + ".html: carrega o modulo exatamente uma vez", tags.length === 1);
      /* NAO DEFERIDO, e e uma armadilha medida: um script inline no fim do body roda
         ANTES dos deferidos, entao `configurar()` receberia `window.__tutorial`
         `undefined` — e o erro apareceria no clique, lendo como defeito do video em
         vez de ordem de carregamento. */
      t(pg + ".html: e NAO com `defer`", tags.length === 1 && !/\bdefer\b/.test(tags[0][0]));

      const js = nuinha(scripts(h));
      t(pg + ".html: configura o modulo uma vez",
        (js.match(/TUT\(\)\.configurar\(/g) || []).length === 1);
      /* O SLUG DAQUELA TELA, e nao o de outra: um slug errado aqui serviria o video
         da tela vizinha, com o titulo dela, e nada na tela diria isso. E medido no
         fonte CRU porque o slug e uma string, e `nuinha` esvazia string. */
      const esperado = pg === "flows" ? "fluxos" : pg;
      t(pg + ".html: declara o slug `" + esperado + "`",
        new RegExp('slug:\\s*"' + esperado + '"').test(h));
      t(pg + ".html: desenha a faixa e a tira", /TUT\(\)\.hero\(\)/.test(js));
      /* CADA PAGINA PASSA UM `callApi` QUE RESOLVE COM O CORPO. O do `flows.html`
         nao faz isso — ele devolve `{ok, status, body}` e nunca levanta — entao
         aquela pagina TEM de adaptar na costura. Passar o dela cru e o defeito que
         o navegador pegou: a faixa nao aparecia e nada dizia por que, porque o
         `catch` do modulo nunca disparava. */
      if (pg === "flows") {
        t("flows.html: adapta o callApi na costura (o dele devolve {ok,body})",
          /callApi: async caminho =>/.test(js) && /return r\.body;/.test(js));
        t("flows.html: e levanta quando o veredito e negativo",
          /if \(!r \|\| !r\.ok\) throw new Error/.test(js));
        t("flows.html: e NAO passa o callApi cru", !/aba: "Fluxos", callApi,/.test(h));
      } else {
        t(pg + ".html: passa o callApi dela, que ja resolve com o corpo",
          /callApi,/.test(js));
      }
      t(pg + ".html: pede o ledger no boot", /TUT\(\)\.carregar\(\)/.test(js));
      t(pg + ".html: liga os gestos da trilha", /TUT\(\)\.ligarGestos\(\)/.test(js));
      t(pg + ".html: liga o clique delegado", /TUT\(\)\.cliques\(/.test(js));
      t(pg + ".html: liga o teclado na cadeia dela", /TUT\(\)\.teclado\(/.test(js));
      /* `TUT()` e FUNCAO e nao referencia guardada, pela mesma razao do `IO()`: ler
         na hora do uso e o que permite a um teste trocar o modulo por um duble. */
      t(pg + ".html: le o modulo na hora do uso",
        /const TUT = \(\) => \{[\s\S]{0,400}?window\.__tutorial/.test(js));
      /* O COTO, e o defeito que ele fecha foi MEDIDO num clone montado por
         `git ls-files`: `/tutorial.js` respondia 404 porque nunca entrou no indice,
         `TUT()` devolvia `undefined`, e a PRIMEIRA chamada — `TUT().configurar`, no
         topo do script — lancava `TypeError`. Um `throw` no topo de um `<script>`
         mata todo o resto do arquivo, e aqui o resto inclui o `boot()`: a porta da
         frente do produto abria EM BRANCO por causa de um video ausente.
         Esta asserção e o que impede a linha de voltar a ser `=> window.__tutorial`. */
      t(pg + ".html: cai num coto quando o modulo falta, em vez de `undefined`",
        /const TUT_AUSENTE = \{/.test(js) && /return TUT_AUSENTE;/.test(js));
      /* A COBERTURA DO COTO — a unica coisa que impede isto de envelhecer. O coto
         cobre o que as PAGINAS chamam e nao a superficie toda de `tutorial.js`, o que
         e deliberado e tem um preco: uma pagina que passe a chamar um decimo membro
         volta a receber `undefined` naquele ponto. Entao no dia em que isso acontecer,
         isto falha NOMEANDO o membro, em vez de a tela abrir em branco outra vez.
         Medido sobre fonte sem comentario de proposito: `upgrade.html` cita
         `TUT().configurar` e `TUT().aberto()` em PROSA, e contar aquilo pediria coto
         para uma chamada que nao existe. */
      const chamados = [...new Set([...js.matchAll(/TUT\(\)\.([a-zA-Z_$]+)/g)].map(m => m[1]))];
      const coto = js.slice(js.indexOf("const TUT_AUSENTE = {"), js.indexOf("let TUT_AVISADO"));
      const semCoto = chamados.filter(k => !new RegExp("(^|[\\s,{])" + k + "\\s*[:(]").test(coto));
      t(pg + ".html: o coto cobre os " + chamados.length + " membros que a pagina chama"
        + (semCoto.length ? " — FALTA: " + semCoto.join(", ") : ""), semCoto.length === 0);
    }

    /* AS CADEIAS DE TECLA, uma por pagina, porque cada uma tem a sua. O que nao
       pode variar: o `.scrim` do dialogo vem antes (ele decide um gasto), e o
       player vem antes do que PARA alguma coisa — com um Esc unico fechando o
       player E chamando o `parar()`, uma rodada de modelo ja paga morre. */
    {
      const js = semComentario(scripts(PAG.upgrade));
      const iScrim = js.indexOf('if (document.querySelector(".scrim")) return;');
      const iTut = js.indexOf("if (TUT().teclado(e)) return;");
      const iVis = js.indexOf("if (tecladoVisor(e)) return;");
      const iParar = js.indexOf("parar();");
      t("upgrade: o player esta na cadeia", iTut > 0);
      t("upgrade: DEPOIS do `.scrim`", iScrim > 0 && iTut > iScrim);
      t("upgrade: ANTES do visor", iVis > 0 && iTut < iVis);
      t("upgrade: ANTES do parar()", iParar > 0 && iTut < iParar);
    }
    {
      const js = semComentario(scripts(PAG.tester));
      const iScrim = js.indexOf('if (document.querySelector(".scrim")) return;');
      const iTut = js.indexOf("if (TUT().teclado(ev)) return;");
      const iEsc = js.indexOf('if (ev.key !== "Escape") return;');
      const iParar = js.indexOf("await pararAgora();");
      t("tester: o player esta na cadeia", iTut > 0);
      t("tester: DEPOIS do `.scrim`", iScrim > 0 && iTut > iScrim);
      /* ANTES do teste de Escape, e isso e o unico jeito de funcionar: o player
         consome espaco, setas, `m` e `f` — se a cadeia voltasse antes por nao ser
         Escape, nenhuma delas chegaria nele e o espaco rolaria a pagina por tras
         do veu. */
      t("tester: ANTES do teste de Escape (o player quer mais que o Esc)",
        iEsc > 0 && iTut < iEsc);
      t("tester: ANTES do parar que mata a construcao", iParar > 0 && iTut < iParar);
    }
    {
      /* O flows nao tem cadeia global de Esc: cada modal registra o ouvinte dele no
         documento ao abrir. Por isso aqui o ouvinte e da PAGINA, em CAPTURA, e para
         a propagacao quando o modulo consome — senao um Esc que fecha o player
         fecharia tambem o que estiver atras. */
      const js = semComentario(scripts(PAG.flows));
      t("flows: o ouvinte do player roda em captura",
        /addEventListener\("keydown", ev => \{[\s\S]{0,120}TUT\(\)\.teclado\(ev\)[\s\S]{0,80}\}, true\)/.test(js));
      t("flows: e para a propagacao quando consome",
        /if \(TUT\(\)\.teclado\(ev\)\) ev\.stopPropagation\(\);/.test(js));
      /* A faixa e desenhada no `renderAll` e NAO no tique vazio: ali o que envelheceu
         foram os relogios, e o convite nao tem relogio. */
      const rAll = js.slice(js.indexOf("function renderAll()"), js.indexOf("function renderTiqueVazio"));
      t("flows: renderTut() entra no renderAll", /renderTut\(\);/.test(rAll));
      const rVazio = js.slice(js.indexOf("function renderTiqueVazio"), js.indexOf("function renderTiqueVazio") + 300);
      t("flows: e NAO no tique vazio", !/renderTut\(\)/.test(rVazio));
      /* O container existe no HTML e fica DEPOIS da tira de KPI: um convite acima
         dos numeros empurraria o estado da instancia para baixo do que se ve
         primeiro. E FORA da contagem das cinco secoes. */
      t("flows: o container da faixa existe", /<div id="tut"><\/div>/.test(PAG.flows));
      t("flows: e vem depois da tira de KPI",
        PAG.flows.indexOf('id="kpis"') < PAG.flows.indexOf('<div id="tut">'));
      t("flows: e antes do cabecalho [ 01 ]",
        PAG.flows.indexOf('<div id="tut">') < PAG.flows.indexOf("[ 01 / 05 ]"));
      /* A tira de KPI e CAPADA EM SEIS e a faixa nao pode ter virado a setima: mais
         que seis vira papel de parede, que e a mesma razao pela qual a faixa e
         grande. */
      t("flows: a faixa nao entrou na tira de KPI",
        !/kpis[^]{0,400}tut-hero/.test(PAG.flows));
    }
    {
      /* No tester a faixa entra na tela de ABERTURA, que e onde quem chega nao sabe
         o que digitar. E o repintar tem de preservar o que ela escreveu: esconder a
         faixa nao pode custar a frase que estava sendo montada. */
      const js = nuinha(scripts(PAG.tester));
      t("tester: a faixa e desenhada na tela de abertura", /IO_TUT\(\) \+/.test(js));
      t("tester: o render do modulo preserva o campo da ideia",
        /render: repintarAbertura/.test(js) && /function repintarAbertura/.test(js));
      const rep = js.slice(js.indexOf("function repintarAbertura"), js.indexOf("function repintarAbertura") + 700);
      t("tester: ele devolve o texto digitado", /novo\.value = texto/.test(rep));
      /* E DEVOLVE O AVISO QUE ESTAVA NA TELA: repintar com `null` apagaria em
         silencio o alerta do boot (o CLI que nao existe, o doc de agentes que
         falta), e esse aviso e o que decide se vale construir. */
      t("tester: e devolve o aviso que estava na tela", /telaAbertura\(S\.avisoAbertura\)/.test(rep));
      t("tester: e o aviso e guardado quando a tela desenha", /S\.avisoAbertura = aviso/.test(js));
      /* `pintar()` volta cedo sem snapshot, ou seja NAO desenha a abertura — passar
         ele como `render` deixaria a faixa presa na tela ate um F5. */
      t("tester: e o render nao e o pintar() cru", !/render: pintar\b/.test(js));
    }
  }

  /* ══════════════ 8 · um arquivo servido, e nenhuma quinta cópia ══════════ */
  console.log("\n[8] o bloco e UM, e nenhuma pagina o redeclara");
  {
    /* ESTE BLOCO E O QUE IMPEDE A COPIA DE VOLTAR, e ele so passou a existir com a
       extracao. A faixa e o player viviam dentro do `upgrade.html`; copia-los para
       as outras duas seria a QUINTA copia desta base (topbar, `.aviso`, modo
       gravacao, e o `entradas.js` que ja foi extraido para parar essa fila) — e uma
       delas ja produziu um `Illegal return statement` no `flows.html` porque alguem
       INSERIU onde devia SUBSTITUIR, erro que mata a pagina inteira apontando para
       nada. Mecanica copiada do bloco 1 do `entradas-test.js`. */
    const nuinha = txt => String(txt)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[\s;{}()])\/\/[^\n]*/g, "$1 ")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    const scripts = h => [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
    const estilos = h => [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");

    const PAG = {
      flows: fs.readFileSync(path.join(__dirname, "flows.html"), "utf8"),
      tester: fs.readFileSync(path.join(__dirname, "tester.html"), "utf8"),
      upgrade: fs.readFileSync(path.join(__dirname, "upgrade.html"), "utf8"),
      cockpit: fs.readFileSync(path.join(__dirname, "cockpit.html"), "utf8")
    };

    /* O QUE NENHUMA PAGINA PODE DECLARAR. Cada nome aqui e uma peca que voltaria a
       ser copia — e a copia e invisivel ate divergir. */
    const DECLARACOES = [
      "function heroTutorial", "function miniTutorial", "function abrirTutorial",
      "function fecharTutorial", "function pintarPlayer", "function tecladoTutorial",
      "function tutLigarSom", "function tutPular", "function tutAlternar",
      "function tutBuscar", "function tutTelaCheia", "function tutorialDe",
      "function tutVisto", "function marcarTutVisto", "function tutTempo",
      "const TUT_SVG", "const TUT_TECLAS", "const TUT_PULO", "const TUT_SLUG",
      "const TUT_CHAVE"
    ];
    for (const [pg, h] of Object.entries(PAG)) {
      const js = nuinha(scripts(h));
      const achadas = DECLARACOES.filter(d => js.includes(d));
      t(pg + ".html: nao declara nada do bloco (" + DECLARACOES.length + " nomes conferidos)"
        + (achadas.length ? " — achei " + achadas.join(", ") : ""), achadas.length === 0);
    }

    /* E O CSS TAMBEM E UM SO. Tres folhas para um desenho e duas a mais para
       divergir, e a que divergisse seria a que ninguem olhou. */
    const SELETORES = [".tut-hero", ".tut-thumb", ".tut-scrim", ".tut-palco",
      ".tut-som", ".tut-mid", ".tut-ctl", ".tut-trilha", ".tut-b", ".tut-marcos"];
    for (const [pg, h] of Object.entries(PAG)) {
      const css = nuinha(estilos(h)).replace(/\s*\{/g, "{");
      const achados = SELETORES.filter(sel => css.includes(sel + "{") || css.includes(sel + ":") || css.includes(sel + " "));
      t(pg + ".html: nao redeclara o CSS do modulo"
        + (achados.length ? " — achei " + achados.join(", ") : ""), achados.length === 0);
    }

    /* O CSS MORA NO MODULO e e injetado uma vez por documento, marcado por id: e o
       id que faz a segunda chamada nao fazer nada. Mesma mecanica do `entradas.js`. */
    const MOD = fs.readFileSync(path.join(__dirname, "tutorial.js"), "utf8");
    t("o modulo carrega o proprio CSS", /const CSS_ID = "tutorial-css"/.test(MOD));
    /* NENHUM BACKTICK DENTRO DO BLOCO DE CSS, e este caso e a armadilha que a
       sessao pagou DUAS vezes (aqui e no entradas.js): o bloco e uma template
       string, um backtick a FECHA, e o erro que o Node imprime e
       `SyntaxError: Invalid left-hand side expression in postfix operation`
       apontando para a linha do `const CSS =` — que nao e nem perto do problema.
       O `require` do bloco 6 ja explodiria, e este caso existe para NOMEAR a
       causa em vez de deixar quem le procurar um erro de sintaxe fantasma. */
    {
      const iCSS = MOD.indexOf("const CSS = ");
      const fimCSS = MOD.indexOf("function injetarCSS", iCSS);
      const bloco = MOD.slice(MOD.indexOf(String.fromCharCode(96), iCSS) + 1, fimCSS);
      const ultimo = bloco.lastIndexOf(String.fromCharCode(96));
      t("o bloco de CSS tem exatamente um backtick de fechamento",
        ultimo >= 0 && bloco.indexOf(String.fromCharCode(96)) === ultimo);
    }
    t("e a injecao e idempotente por id", /doc\.getElementById\(CSS_ID\)\) return false/.test(MOD));
    /* A REGRA DO `[hidden]`, que e o pior defeito que esta frente teve: o atributo
       vale por uma regra do proprio navegador, e QUALQUER `display` de autor a
       vence — o cartaz de som ficava por cima do video para sempre, comendo todos
       os cliques, com o DOM dizendo `hidden`. Se o CSS for mexido, esta linha e a
       que nao pode sair com ele. */
    t("o CSS leva a regra que faz o `[hidden]` valer",
      /\.tut-som\[hidden\], \.tut-mid\[hidden\] \{ display: none; \}/.test(MOD));
    /* O `--accent-txt` cru sobre o `--accent-soft` reprova o AA no tema escuro:
       medido 4,0397 a 12px. A receita da casa e o `color-mix` a 72%. */
    t("e a receita de contraste do botao de som",
      /color-mix\(in srgb, var\(--accent-txt\) 72%, var\(--txt\)\)/.test(MOD));
    /* NENHUM OUVINTE DE TECLA PROPRIO fora do slider da trilha: o contrato e
       `teclado()` devolver `true` e a PAGINA decidir a ordem. */
    const fora = (MOD.match(/addEventListener\("keydown"/g) || []).length;
    t("o modulo registra exatamente um keydown, e ele e o da trilha", fora === 1);
    t("e ele so age com o alvo dentro da trilha",
      /closest\(".tut-trilha"\)[\s\S]{0,120}if \(!tr\) return;/.test(MOD));
  }

  /* TRES estados, nao dois. Um pulo e uma asserção que NAO RODOU, e imprimir
     "passou" sobre ela seria exatamente a mentira que este arquivo existe para nao
     contar. O codigo de saida 2 e o que o `testar.cmd` le para fechar em "passou,
     com pulos": verde e vermelho nao cobrem "faltou estado por checkout". */
  console.log("\n" + (bad ? "FALHOU" : pulados ? "passou COM PULOS" : "passou")
    + ": " + ok + " ok, " + bad + " falha(s)"
    + (pulados ? ", " + pulados + " PULADO(S) por falta de arquivo gitignorado" : ""));
  if (bad) process.exitCode = 1;
  else if (pulados) process.exitCode = 2;
} catch (e) {
  console.error("\nEXPLODIU: " + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* melhor deixar lixo que mascarar o erro */ }
}
})();
