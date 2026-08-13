/* aba.js — o aviso que chega quando a pessoa não está olhando.
 *
 * Um build do Tester leva minutos (medido: 818s para um agente de 65 nós). O
 * comportamento normal é sair da página — ir arrumar um fluxo em `/`, trocar de
 * aba, ir fazer outra coisa. A sessão sempre sobreviveu a isso; o que não existia
 * era o caminho de volta. A entrevista parada numa pergunta é o pior caso: é o
 * estado mais fácil de esquecer, e ela espera para sempre.
 *
 * Quatro camadas, e cada uma cobre um lugar onde a pessoa pode estar:
 *
 *   1. FAVICON ANIMADO — quando ela está em outra aba do navegador. Desenhado
 *      quadro a quadro num canvas e trocado no `<link rel=icon>`.
 *   2. TÍTULO PISCANDO — o que o olho realmente pega numa fileira de doze abas.
 *   3. NOTIFICAÇÃO DO SO — quando ela está fora do navegador.
 *   4. O `.aviso` da própria página — quando ela está em outra página do cockpit.
 *
 * O QUE NÃO DÁ, e não se promete: animar a barra da aba. Aquilo é chrome do
 * navegador; nenhum CSS e nenhuma API alcançam. Favicon e título são o que existe
 * naquela área, e juntos leem como "essa aba está te chamando" — que é o efeito
 * pedido, por um caminho que de fato funciona. Mesma regra que este projeto já
 * segue sobre o diálogo nativo: não prometer o que não se pode entregar.
 *
 * ARQUIVO ÚNICO, servido às três páginas. O topbar e o bloco `.aviso` são três
 * cópias, com a dívida registrada no CLAUDE.md; este não entra nessa fila.
 *
 * JULGAMENTO AQUI DENTRO, de propósito: o servidor emite `andamento` como fato
 * (etapas com estado, atividade) e é este arquivo que decide o que merece
 * interromper alguém. Mesmo princípio do bloco de julgamento do `flows.html`.
 *
 * Carrega em Node também — sem DOM ele não liga nada e só exporta as decisões
 * puras, que é o que `aba-test.js` prova. Regra que decide se alguém é
 * interrompido tem que ser testável sem navegador.
 */

(function (raiz, fabrica) {
  "use strict";
  const api = fabrica();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.__aba = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const temDOM = typeof document !== "undefined" && !!document.createElement;
  const doc = temDOM ? document : null;
  const janela = typeof window !== "undefined" ? window : null;

  /* ------------------------------------------------------- o que se decide */

  /* Quatro estados que valem aviso, e é por isso que `aguardando` existe
   * separado: um build que acabou é uma boa notícia, um build que espera
   * resposta é uma cobrança, e um que quebrou é outra coisa ainda. Copy igual
   * para os três ensinaria a ignorar todos. */
  const ESTADOS = {
    pronto:     { icone: "pronto",     titulo: "PRONTO",    aviso: "ok",     som: true,
                  frase: "o fluxo ficou pronto no Tester", corpo: "Abra para ver o desenho, a simulação e o JSON." },
    aguardando: { icone: "aguardando", titulo: "TE ESPERA", aviso: "alerta", som: true,
                  frase: "o Tester está te esperando", corpo: "A entrevista parou numa pergunta e não anda sem você." },
    falhou:     { icone: "falhou",     titulo: "FALHOU",    aviso: "erro",   som: false,
                  frase: "o build do Tester falhou", corpo: "Nada foi escrito no n8n. Abra para ver onde parou." },
    cancelada:  { icone: "falhou",     titulo: "PARADO",    aviso: "info",   som: false,
                  frase: "o build do Tester foi parado", corpo: "O que já foi pago continua na tela." }
  };

  /* 6s é o intervalo em que um humano não percebe atraso e o servidor não sente
   * carga — e essa conta só fecha porque `/api/tester/status` custa ~5ms. Ele
   * custava 190ms (um `JSON.parse` de 9,4MB por chamada) e nesse mundo esta
   * feature seria irresponsável. Se aquele custo voltar, este número está
   * errado. */
  const POLL_MS = 6000;
  const POLL_MS_OCULTA = 10000;

  /* A animação para sozinha. Favicon girando para sempre deixa de ser aviso e
   * passa a ser decoração — e decoração que se move é a primeira coisa que o
   * olho aprende a ignorar. */
  const ANIM_MAX_MS = 3 * 60 * 1000;
  const QUADRO_MS = 90;

  const CHAVE_DONO = "cockpit.aba.dono.v1";
  const CHAVE_VISTO = "cockpit.aba.visto.v1";
  const CHAVE_PERM = "cockpit.aba.notificar.v1";
  const ARRENDO_MS = 15000;

  /* ------------------------------------------------------------- guardados */

  /* Indireção sobre o `localStorage`, e ela ganha o lugar por dois motivos que
   * valem sozinhos: em aba anônima com armazenamento bloqueado o `localStorage`
   * LANÇA em vez de devolver nulo — e uma exceção aqui mataria o aviso inteiro —
   * e em Node ele não existe, o que impediria testar a eleição entre abas. O
   * fallback em memória degrada exatamente onde deve: cada aba passa a se achar
   * dona, e o pior caso é uma notificação repetida em vez de nenhuma. */
  const memoria = new Map();
  const guardado = {
    ler(k) {
      try { if (janela && janela.localStorage) return janela.localStorage.getItem(k); } catch {}
      return memoria.has(k) ? memoria.get(k) : null;
    },
    gravar(k, v) {
      try { if (janela && janela.localStorage) { janela.localStorage.setItem(k, v); return; } } catch {}
      memoria.set(k, v);
    }
  };

  const paradaDeMovimento = () => !!(janela && janela.matchMedia && janela.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const escuro = () => !!(janela && janela.matchMedia && janela.matchMedia("(prefers-color-scheme: dark)").matches);

  /* A cor sai do CSS da página, não de constante daqui: as três páginas dividem
   * os mesmos tokens, e um `--accent` escrito à mão aqui viraria a quarta
   * definição da mesma cor. */
  function token(nome, alternativa) {
    if (!temDOM || !janela.getComputedStyle) return alternativa;
    try {
      const v = janela.getComputedStyle(doc.documentElement).getPropertyValue(nome).trim();
      return v || alternativa;
    } catch { return alternativa; }
  }

  /* ------------------------------------------------------------- o favicon */

  /* Um fluxo, que é o que este produto faz: um nó à esquerda, dois à direita,
   * duas arestas. Ramificar em vez de enfileirar não é enfeite — em 32px uma
   * fileira de três quadrados lê como três quadrados, e um ramo lê como fluxo.
   *
   * Desenhado em 2× (64px de canvas num espaço de 32) para o traço não serrar: o
   * navegador aceita qualquer tamanho no `rel=icon` e reduz com suavização,
   * enquanto um ícone desenhado em 32 real fica sujo em tela retina. */
  const N = 32, ESC = 2, LADO = 9, R = 2.5;
  const NOS = [{ x: 2, y: 11.5 }, { x: 21, y: 3 }, { x: 21, y: 20 }];
  /* A ordem em que acendem é a ordem em que um fluxo executa — origem, depois os
   * ramos. É isso que faz a animação dizer "rodou" em vez de "está bonito". */
  const ARESTAS = [[0, 1], [0, 2]];

  let link = null;

  function acharLink() {
    if (link && link.parentNode) return link;
    link = doc.querySelector('link[rel="icon"]');
    if (!link) {
      link = doc.createElement("link");
      link.rel = "icon";
      doc.head.appendChild(link);
    }
    return link;
  }

  const centro = n => ({ x: n.x + LADO / 2, y: n.y + LADO / 2 });

  function bezier(t, p0, p1, p2, p3) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  }

  /* Em qual aresta o pulso está, e onde nela. Fora de `pintar` de propósito: foi
   * aqui que morava um defeito que a tela não denunciava.
   *
   * `passo` vai de 0 a `NOS.length + 1`. Entre 0 e 1 a ORIGEM está acendendo e
   * aresta nenhuma é percorrida — a versão original testava `passo > 0`, então
   * `Math.floor(passo) - 1` dava −1, `ARESTAS[-1]` era `undefined`, e a
   * desestruturação lançava `undefined is not iterable` DENTRO do tick. O quadro
   * seguinte redesenhava, a animação parecia funcionar, e o erro só apareceu no
   * `pageerror` do navegador. Função pura, testável sem canvas, com teste de
   * fronteira — porque a próxima vez tem que falhar num teste e não em silêncio. */
  function arestaDoPasso(passo, animando) {
    if (!animando || typeof passo !== "number" || !Number.isFinite(passo)) return null;
    if (passo < 1 || passo >= NOS.length) return null;
    const idx = Math.max(0, Math.min(ARESTAS.length - 1, Math.floor(passo) - 1));
    return { idx, t: passo - Math.floor(passo) };
  }

  function cores(estado) {
    const neutra = escuro() ? "#c9d1e4" : "#3a4256";
    return {
      idle:       { linha: neutra, no: neutra, aceso: neutra },
      correndo:   { linha: neutra, no: neutra, aceso: token("--accent", "#5b6cff") },
      pronto:     { linha: token("--accent", "#5b6cff"), no: neutra, aceso: token("--accent", "#5b6cff") },
      aguardando: { linha: token("--warn", "#d9a13a"),   no: neutra, aceso: token("--warn", "#d9a13a") },
      falhou:     { linha: token("--risk", "#d6455b"),   no: neutra, aceso: token("--risk", "#d6455b") }
    }[estado] || { linha: neutra, no: neutra, aceso: neutra };
  }

  /* `fase` de 0 a 1 anima; `null` é quadro estático — nada aceso, nada viajando.
   * Devolve o data URL para o gerador de preview poder desenhar grande o mesmo
   * quadro que vai para a aba, em vez de reimplementar o desenho e divergir. */
  function pintar(estado, fase, alvo) {
    if (!temDOM) return null;
    const c = alvo || doc.createElement("canvas");
    c.width = c.height = N * ESC;
    const g = c.getContext("2d");
    if (!g) return null;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.scale(c.width / N, c.height / N);

    const cor = cores(estado);
    const animando = typeof fase === "number";
    const passo = animando ? fase * (NOS.length + 1) : -1;

    g.lineWidth = 1.6;
    g.lineCap = "round";
    g.strokeStyle = cor.linha;
    g.globalAlpha = animando ? 0.55 : 0.8;
    for (const [a, b] of ARESTAS) {
      const de = centro(NOS[a]), para = centro(NOS[b]);
      const mx = (de.x + para.x) / 2;
      g.beginPath();
      g.moveTo(de.x + LADO / 2 - 0.5, de.y);
      /* Bezier com o mesmo desenho do palco do `flows.html`: sai na horizontal,
       * entra na horizontal. É o que faz o ícone e a tela falarem a mesma
       * língua. */
      g.bezierCurveTo(mx, de.y, mx, para.y, para.x - LADO / 2 + 0.5, para.y);
      g.stroke();
    }
    g.globalAlpha = 1;

    NOS.forEach((n, i) => {
      g.beginPath();
      /* `roundRect` é recente; o fallback é um retângulo reto, que em 32px
       * ninguém distingue — e vale muito mais que não desenhar nada. */
      if (g.roundRect) g.roundRect(n.x, n.y, LADO, LADO, R);
      else g.rect(n.x, n.y, LADO, LADO);
      if (animando && passo > i) { g.fillStyle = cor.aceso; g.fill(); }
      else { g.strokeStyle = cor.no; g.lineWidth = 1.8; g.stroke(); }
    });

    const emAresta = arestaDoPasso(passo, animando);
    if (emAresta) {
      const { idx, t } = emAresta;
      const [a, b] = ARESTAS[idx];
      const de = centro(NOS[a]), para = centro(NOS[b]);
      const mx = (de.x + para.x) / 2;
      const p = bezier(t,
        { x: de.x + LADO / 2 - 0.5, y: de.y }, { x: mx, y: de.y },
        { x: mx, y: para.y }, { x: para.x - LADO / 2 + 0.5, y: para.y });
      g.beginPath();
      g.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      g.fillStyle = cor.aceso;
      g.fill();
    }

    let url = null;
    try { url = c.toDataURL("image/png"); } catch { /* canvas bloqueado */ }
    /* Sem alvo explícito é a aba que recebe. Com alvo, quem chamou desenha onde
     * quiser e o favicon não é tocado — é assim que o preview mostra o quadro
     * real sem sequestrar o ícone da própria página. */
    if (!alvo && url) { try { acharLink().href = url; } catch {} }
    return url;
  }

  /* ------------------------------------------------- animação e título */

  const tituloOriginal = temDOM ? doc.title : "";
  let timer = null, inicioAnim = 0, piscaLigado = false;

  function pararAnimacao() {
    if (timer) { clearInterval(timer); timer = null; }
    if (temDOM) doc.title = tituloOriginal;
    piscaLigado = false;
  }

  function desenhoEstatico(estado) { pintar(estado, null); }

  function animar(estado) {
    const cfg = ESTADOS[estado];
    if (!cfg || !temDOM) return;

    /* `prefers-reduced-motion` derruba o movimento e MANTÉM o estado: o ícone
     * muda de cor, o título muda de texto uma vez, e a notificação do SO chega
     * igual. Nenhuma informação mora na animação. */
    if (paradaDeMovimento()) {
      desenhoEstatico(cfg.icone);
      doc.title = "● " + cfg.titulo + " · " + tituloOriginal;
      return;
    }

    pararAnimacao();
    inicioAnim = Date.now();
    let q = 0;
    timer = setInterval(() => {
      /* Para sozinha, e para quando a pessoa volta. Voltar para a aba É a
       * resposta ao aviso; continuar piscando depois disso é o defeito clássico
       * do toast que foge do cursor. */
      if (Date.now() - inicioAnim > ANIM_MAX_MS || !doc.hidden) {
        pararAnimacao();
        desenhoEstatico("idle");
        return;
      }
      q++;
      /* Um ciclo do pulso a cada ~1,4s com uma pausa curta entre ciclos: sem a
       * pausa a animação vira um moinho e perde a leitura de "aconteceu algo". */
      const periodo = 16;
      const fase = (q % periodo) / (periodo - 4);
      pintar(cfg.icone, fase > 1 ? null : fase);
      if (q % 8 === 0) {
        piscaLigado = !piscaLigado;
        doc.title = piscaLigado ? "● " + cfg.titulo + " · " + tituloOriginal : tituloOriginal;
      }
    }, QUADRO_MS);
  }

  /* --------------------------------------------------- notificação do SO */

  /* A permissão é pedida NUM CLIQUE, nunca no carregamento. Pedida no load, o
   * navegador ignora ou bloqueia de vez — e queima a única chance que existe. */
  function estadoPermissao() {
    if (!janela || !("Notification" in janela)) return "ausente";
    return janela.Notification.permission;          // default | granted | denied
  }

  const querAvisar = () => guardado.ler(CHAVE_PERM) === "1" && estadoPermissao() === "granted";

  async function pedirPermissao() {
    if (estadoPermissao() === "ausente") return "ausente";
    let p = janela.Notification.permission;
    if (p === "default") { try { p = await janela.Notification.requestPermission(); } catch { p = "denied"; } }
    guardado.gravar(CHAVE_PERM, p === "granted" ? "1" : "0");
    return p;
  }

  function notificarSO(estado, extra) {
    if (!querAvisar()) return false;
    const cfg = ESTADOS[estado];
    try {
      const n = new janela.Notification("Cockpit · Tester", {
        body: cfg.frase + (extra ? " — " + extra : "") + "\n" + cfg.corpo,
        tag: "cockpit-tester",              // substitui a anterior em vez de empilhar
        silent: !cfg.som
      });
      n.onclick = () => {
        try { janela.focus(); } catch {}
        janela.location.href = "/tester";
        n.close();
      };
      return true;
    } catch { return false; }
  }

  /* ------------------------------------------------ a eleição entre abas */

  /* Sem isto, três abas abertas viram três notificações do SO para um evento — e
   * o produto parece quebrado exatamente no momento em que devia brilhar. A aba
   * dona é a única que notifica; as outras animam o próprio favicon, que é
   * correto: cada aba é uma aba. Arrendamento com vencimento, e não posse fixa,
   * porque a aba dona pode ser fechada — e aí ninguém avisaria nunca mais. */
  const eu = String(Math.random()).slice(2) + "-" + Date.now().toString(36);

  function souDono(agora) {
    const t = typeof agora === "number" ? agora : Date.now();
    let d = null;
    try { d = JSON.parse(guardado.ler(CHAVE_DONO) || "null"); } catch { d = null; }
    if (!d || !d.id || t - (d.em || 0) > ARRENDO_MS) {
      guardado.gravar(CHAVE_DONO, JSON.stringify({ id: eu, em: t }));
      return true;
    }
    if (d.id === eu) {
      guardado.gravar(CHAVE_DONO, JSON.stringify({ id: eu, em: t }));
      return true;
    }
    return false;
  }

  /* Um evento já anunciado não se anuncia de novo — nem nesta aba nem noutra. A
   * chave é `sessão + estado`, então o mesmo build avisando "te espera" e depois
   * "pronto" são dois avisos, e não um repetido. */
  function jaAnunciado(assinatura) {
    let v = null;
    try { v = JSON.parse(guardado.ler(CHAVE_VISTO) || "null"); } catch { v = null; }
    return !!(v && v.assinatura === assinatura);
  }
  const marcarAnunciado = a => guardado.gravar(CHAVE_VISTO, JSON.stringify({ assinatura: a, em: Date.now() }));

  /* ------------------------------------------------ a leitura do servidor */

  /* O servidor emite fatos: as etapas com estado e a atividade. A tradução para
   * "isto merece interromper alguém" é julgamento, e é aqui.
   *
   * `andamento` só existe enquanto a sessão está viva (`correndo` ou
   * `aguardando`). Quando o build acaba, ela sai da lista — então "acabou" é
   * inferido pela TRANSIÇÃO: eu vi uma sessão viva e agora não vejo mais. Sem
   * guardar o último visto, o fim de um build seria indistinguível de "nunca
   * houve build", que é o estado de quem acabou de abrir a página.
   *
   * Fábrica, e não estado de módulo, para o teste poder criar um observador
   * limpo por caso — a regra que decide se alguém é interrompido é a última que
   * deveria depender de ordem de execução. */
  function criarObservador() {
    let ultimoVivo = null;
    return function derivar(status) {
      const a = status && status.andamento;
      if (a && a.id) {
        ultimoVivo = { id: a.id, etapa: a.etapa || null };
        return a.estado === "aguardando" ? { estado: "aguardando", id: a.id, extra: a.etapa || null } : null;
      }
      if (ultimoVivo) {
        const antes = ultimoVivo;
        ultimoVivo = null;
        return { estado: "pronto", id: antes.id, extra: null };
      }
      /* Nunca vi sessão viva: quem abriu a página agora não recebe aviso de um
       * build que terminou antes dele chegar. */
      return null;
    };
  }

  const derivar = criarObservador();

  async function olhar() {
    if (!temDOM) return;
    let status = null;
    try {
      const r = await janela.fetch("/api/tester/status", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      /* Corpo que não é objeto é a rota velha respondendo `404` como número —
       * `JSON.parse("404")` dá 404, e este projeto já foi enganado por isso.
       * Silêncio é a resposta certa: um aviso é opcional, e inventar um estado a
       * partir de um corpo errado é pior que não avisar. */
      if (!j || typeof j !== "object" || Array.isArray(j)) return;
      status = j;
    } catch { return; }

    const ev = derivar(status);
    if (!ev) return;
    const assinatura = ev.id + "|" + ev.estado;
    if (jaAnunciado(assinatura)) return;

    /* Na aba em foco não se pisca nada: a pessoa está olhando. O que ela recebe
     * é o `.aviso` da página, que é o vocabulário certo para "aconteceu algo
     * aqui do lado". */
    if (doc.hidden) animar(ev.estado);
    avisarNaPagina(ev);

    if (souDono()) {
      marcarAnunciado(assinatura);
      notificarSO(ev.estado, ev.extra);
    }
  }

  /* ----------------------------------------------------- o aviso da página */

  /* Reusa o `avisar()` que as três páginas já têm — um quinto jeito de avisar é
   * exatamente o que o CLAUDE.md proíbe. Sem ele, cai no `console`: melhor um
   * aviso invisível que um vocabulário novo. */
  function avisarNaPagina(ev) {
    const cfg = ESTADOS[ev.estado];
    const texto = cfg.frase + (ev.extra ? " (" + ev.extra + ")" : "") + ". " + cfg.corpo;
    if (janela && typeof janela.avisar === "function") {
      try { janela.avisar(texto, cfg.aviso); return; } catch {}
    }
    try { console.info("[cockpit] " + texto); } catch {}
  }

  /* ------------------------------------------------------------- o botão */

  /* No topbar, e ele diz o estado em que está — porque "avisar" tem três
   * respostas e duas não são o que a pessoa quer: concedida, recusada (e aí nada
   * vai chegar, e calar sobre isso é pior) e inexistente no navegador. Sem
   * `Notification` o botão não renderiza: botão que não faz nada é pior que
   * botão nenhum, mesma regra do ditado.
   *
   * Glifos, não emoji: medido neste projeto que `📎` e `🗀` viram quadrado vazio
   * nesta fonte, e o vocabulário do topbar já é `◐` e `⏺`. */
  function montarBotao() {
    if (!temDOM || estadoPermissao() === "ausente") return null;
    const barra = doc.querySelector("header.topbar");
    if (!barra || barra.querySelector("#avisar")) return null;

    const b = doc.createElement("button");
    b.type = "button";
    b.id = "avisar";

    /* VESTE-SE COMO O VIZINHO, em vez de fixar uma classe.
     *
     * `className = "iconbtn"` era a outra metade da lição do `#tema`/`#theme`
     * lá embaixo, e ela passou batida: o topbar é "um chrome só" nas três
     * páginas, mas a CLASSE do botão também difere — `iconbtn` no tester e no
     * disco, `btn ghost` no flows. Com a classe fixa o botão saía no flows com
     * o estilo PADRÃO DO NAVEGADOR: caixa cinza clara, texto preto, 13.3px,
     * 41px de altura ao lado de um vizinho de 33. Medido nas três páginas, nos
     * dois temas.
     *
     * Copiar a classe do botão de tema resolve as duas metades de uma vez, e
     * continua certo no dia em que uma quarta página aparecer com um terceiro
     * nome. O `iconbtn` fica só como rede: página sem botão de tema é uma
     * página que este chrome ainda não alcançou. */
    const tema = barra.querySelector("#tema, #theme");
    b.className = (tema && tema.className) || "iconbtn";
    b.classList.add("avisarbtn");

    const pintarBotao = () => {
      const p = estadoPermissao();
      const on = querAvisar();
      b.innerHTML = "";
      const glifo = doc.createElement("span");
      /* `dot` é a mesma classe do `⏺ Gravar`: dois botões de preferência lado a
       * lado com estruturas diferentes é o tipo de detalhe que faz um painel
       * parecer montado por duas pessoas. O espaço entre glifo e rótulo é
       * `gap`, não um espaço no texto — com espaço no texto o rótulo herdava a
       * largura do glifo e a caixa mudava de tamanho ao alternar ○/◉/⊘. */
      glifo.className = "dot";
      glifo.setAttribute("aria-hidden", "true");
      glifo.textContent = on ? "◉" : (p === "denied" ? "⊘" : "○");
      const lbl = doc.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = "Avisar";
      b.appendChild(glifo); b.appendChild(lbl);
      /* O estado ligado não pode depender só de o círculo estar preenchido:
       * `○` e `◉` a 11px são quase a mesma mancha, e é a única informação que
       * este botão carrega. Ligado ganha o tratamento de acento; bloqueado pelo
       * navegador fica apagado, porque ali não há nada a fazer na página. */
      b.classList.toggle("on", on);
      b.classList.toggle("bloq", !on && p === "denied");
      b.title = on
        ? "O sistema te avisa quando o Tester terminar, mesmo com o navegador minimizado. Clique para desligar."
        : (p === "denied"
          ? "O navegador bloqueou as notificações deste site: nada vai chegar pelo sistema. Libere no cadeado da barra de endereço › Notificações. O favicon e o título da aba continuam avisando."
          : "Avisar pelo sistema operacional quando o Tester terminar, mesmo fora do navegador.");
      b.setAttribute("aria-pressed", on ? "true" : "false");
    };
    b.onclick = async () => {
      if (querAvisar()) { guardado.gravar(CHAVE_PERM, "0"); pintarBotao(); return; }
      const p = await pedirPermissao();
      pintarBotao();
      if (p === "denied" && janela && typeof janela.avisar === "function") {
        janela.avisar("O navegador bloqueou as notificações deste site, então nada vai chegar pelo sistema. O favicon e o título da aba continuam avisando. Para liberar: cadeado na barra de endereço › Notificações.", "alerta");
      }
    };
    pintarBotao();
    /* Antes do tema, para os dois botões de preferência ficarem juntos no fim da
     * barra em vez de o novo cair depois do modo gravação.
     *
     * Os DOIS ids, e isto é um achado: o topbar é "um chrome só" nas três
     * páginas, mas o botão de tema é `#tema` no `tester.html` e `#theme` no
     * `flows.html` e no `cockpit.html`. Procurar um só põe o botão no lugar certo
     * numa página e no fim da barra nas outras duas — medido no navegador. */
    if (tema) barra.insertBefore(b, tema); else barra.appendChild(b);
    if (janela) janela.addEventListener("storage", e => { if (e.key === CHAVE_PERM) pintarBotao(); });
    return b;
  }

  /* ------------------------------------------------------------- ligar */

  let intervalo = null;

  function agendar() {
    if (intervalo) clearInterval(intervalo);
    intervalo = setInterval(olhar, doc.hidden ? POLL_MS_OCULTA : POLL_MS);
  }

  function iniciar() {
    desenhoEstatico("idle");
    montarBotao();
    olhar();
    agendar();

    doc.addEventListener("visibilitychange", () => {
      agendar();
      if (!doc.hidden) { pararAnimacao(); desenhoEstatico("idle"); olhar(); }
    });

    /* O tema muda a cor do ícone. Sem isto, trocar de tema deixa um favicon
     * desenhado para o tema anterior — e no tema claro ele some no branco. */
    if (janela && janela.matchMedia) {
      try {
        janela.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
          if (!timer) desenhoEstatico("idle");
        });
      } catch { /* navegador antigo: o ícone só troca no reload */ }
    }
  }

  if (temDOM) {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
  }

  return {
    ESTADOS, POLL_MS, POLL_MS_OCULTA, ANIM_MAX_MS, ARRENDO_MS,
    NOS, ARESTAS, N,
    pintar, animar, pararAnimacao, desenhoEstatico, arestaDoPasso,
    criarObservador, derivar,
    souDono, jaAnunciado, marcarAnunciado, estadoPermissao, querAvisar, pedirPermissao,
    montarBotao, guardado, CHAVE_DONO, CHAVE_VISTO, CHAVE_PERM
  };
});
