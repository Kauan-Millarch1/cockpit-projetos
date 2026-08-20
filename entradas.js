/* entradas.js — as duas entradas que não são o teclado: falar e anexar.
 *
 * ARQUIVO SERVIDO, e isso é a decisão que o arquivo existe para tomar. O bloco
 * de voz + anexo nasceu dentro do `tester.html` já parametrizado por
 * `idPrefixo`, ou seja quem o escreveu previu reuso. Quando o compositor da aba
 * Upgrade pediu as mesmas entradas, havia dois caminhos: copiar o bloco (o
 * quarto desta base — topbar, `.aviso` e modo gravação já são três cópias, e uma
 * delas já produziu um `Illegal return statement` no `flows.html` porque alguém
 * INSERIU em vez de SUBSTITUIR), ou seguir o precedente do `aba.js`: um arquivo
 * servido às páginas que precisam. É o segundo.
 *
 * O CSS vem junto. Ele não pode ficar nas páginas: seriam duas folhas para um
 * desenho, e a que divergisse seria a que ninguém olhou. `injetarCSS()` põe o
 * bloco uma vez por documento, marcado por id, e o id é o que faz a segunda
 * chamada não fazer nada.
 *
 * TRÊS COISAS QUE NÃO MUDAM AO SAIR DA PÁGINA:
 *
 * 1. NÃO EXISTE PARSER NOSSO. O CLI do Claude lê imagem e PDF nativamente com
 *    `Read`. Escrever OCR, extrator de PDF ou leitor de planilha aqui seria
 *    manter para sempre uma versão pior do que a sessão já faz. Este arquivo põe
 *    o arquivo onde a sessão alcança e mostra o que aconteceu com ele.
 *
 * 2. O DITADO É DO NAVEGADOR, e isso é decisão de segurança. Transcrever no
 *    servidor significaria uma chave de terceiro dentro deste processo, que é
 *    exatamente o que este projeto evitou até hoje. O preço está dito na tela:
 *    depende do Chrome e a transcrição passa pelo Google. Sem `SpeechRecognition`
 *    o botão NÃO RENDERIZA — um botão que não faz nada é pior que botão nenhum.
 *
 * 3. RECUSA CARREGA INSTRUÇÃO, e um lote de recusas é UM aviso agrupado por
 *    categoria. `anexos.gravar()` devolve `categoria` justamente para isso: o
 *    número de categorias é fixo, o de arquivos não.
 *
 * O QUE ELE NÃO SABE: qual é a rota, como se avisa, e onde mora o estado. Isso é
 * da página, e chega por `configurar()`. O módulo não conhece `S.snap` nem
 * `S.conv` — ele chama `aoSnapshot`, e cada página guarda no lugar dela.
 *
 * CARREGA EM NODE também, sem DOM: aí ele não injeta nada e só exporta as
 * decisões puras, que é o que `entradas-test.js` prova. Regra que decide se um
 * arquivo entra tem que ser testável sem navegador.
 */

(function (raiz, fabrica) {
  "use strict";
  const api = fabrica();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.__entradas = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const temDOM = typeof document !== "undefined" && !!document.createElement;
  const doc = temDOM ? document : null;
  const janela = typeof window !== "undefined" ? window : null;

  /* `esc` é definido AQUI e não injetado. Ele é uma linha e não é julgamento —
     injetar obrigaria toda página a ter uma, e o `flows.html` não tem. */
  const esc = s => String(s == null ? "" : s)
    .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ═══════════════════════════════════════════════════════ o que a página dá ══
   *
   * `configurar()` é obrigatório antes de qualquer coisa que fale com o
   * servidor. Sem ele as funções de DOM ainda desenham (o HTML é puro), mas
   * subir um arquivo lança por NOME em vez de morrer num `undefined is not a
   * function` — que é o erro que manda quem lê caçar o bug na página errada. */
  let cfg = null;

  function configurar(c) {
    if (!c || !c.estado || typeof c.callApi !== "function" || typeof c.avisar !== "function") {
      throw new Error("entradas.configurar precisa de { estado, callApi, avisar, rotas }");
    }
    if (!c.rotas || !c.rotas.bandeja || !c.rotas.bandejaRemover
      || typeof c.rotas.sessao !== "function" || typeof c.rotas.sessaoRemover !== "function") {
      throw new Error("entradas.configurar: `rotas` precisa de bandeja, bandejaRemover, sessao(id) e sessaoRemover(id)");
    }
    cfg = c;
    injetarCSS();
    return api;
  }
  const exigir = () => {
    if (!cfg) throw new Error("entradas.js: a página não chamou `configurar()` — sem rota não há para onde mandar o arquivo");
    return cfg;
  };

  /* ════════════════════════════════════════════════════════════════ o CSS ════
   *
   * O microfone GRAVANDO é a única coisa aqui que pulsa, e pulsa porque é estado
   * perigoso de esquecer: um microfone aberto que ninguém percebeu é pior que um
   * botão feio. `--risk` está reservado para status de fluxo, então a gravação
   * usa `--accent` com um ponto batendo, igual ao modo gravação da tela. */
  const CSS = `
.iobar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.iob{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--txt-faint);
  border:1px solid var(--line);background:var(--surface-2);border-radius:999px;padding:5px 11px;
  line-height:1.3;cursor:pointer;min-height:30px;flex:0 0 auto}
.iob:hover:not(:disabled){color:var(--txt);border-color:var(--accent-line)}
.iob:disabled{opacity:.45;cursor:default}
.iob.ouvindo{color:var(--accent-txt);border-color:var(--accent-line);background:var(--accent-soft)}
.iob.ouvindo .pt{animation:ouvepulse 1.2s ease-in-out infinite}
@keyframes ouvepulse{0%,100%{opacity:1}50%{opacity:.25}}
.iob .pt{font-size:9px;line-height:1}

/* O texto que o navegador ainda está adivinhando. Ele aparece esmaecido e em
   itálico enquanto não é final, porque a Web Speech reescreve a frase inteira
   várias vezes antes de fechar — mostrar isso como texto normal dá a impressão
   de que a transcrição está errando, quando ela só não terminou. */
.ditando{font-style:italic;color:var(--txt-faint)}

.anexos{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.anx{display:inline-flex;align-items:center;gap:7px;max-width:100%;font-size:11px;
  border:1px solid var(--line);background:var(--surface-2);border-radius:8px;padding:4px 6px 4px 8px;
  color:var(--txt-dim);line-height:1.35}
.anx .ic{font-size:11px;opacity:.8;flex:0 0 auto}
.anx .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:26ch}
.anx .sz{font-family:var(--font-num);font-size:9.5px;color:var(--txt-faint);flex:0 0 auto}
/* Lido é FATO OBSERVADO, não promessa: sai do "tool_use" da sessão. Por isso
   ganha marca própria — um anexo que a sessão nunca abriu tem que ser
   distinguível de um que ela leu, senão anexar é um ato de fé. */
.anx.lido{border-color:var(--accent-line);color:var(--txt)}
.anx.lido .ic{opacity:1;color:var(--accent-txt)}
.anx .x{border:none;background:none;color:var(--txt-faint);cursor:pointer;font-size:13px;
  line-height:1;padding:2px 4px;border-radius:5px;flex:0 0 auto}
.anx .x:hover{color:var(--txt);background:var(--raised)}
.anx.subindo{opacity:.6}
.anx.ruim{border-color:var(--warn-line,var(--line));color:var(--warn-txt)}
.anxnota{font-size:10.5px;color:var(--txt-faint);margin-top:6px;line-height:1.5}
.anxnota b{color:var(--txt-dim);font-weight:600}
/* Recusa de anexo usa ".aviso.alerta" (ver o bloco AVISOS de cada página). Não
   há classe de erro própria aqui de propósito: era uma das quatro que o
   vocabulário único substituiu. */
/* Arrastar para cima da caixa. O alvo é a caixa inteira, não um retângulo
   pontilhado separado: uma segunda área de soltar seria um lugar a mais para
   errar, e a caixa já é o lugar onde a conversa acontece.
   Os três nomes de caixa são os três lugares onde este bloco é usado hoje:
   ".bigbox" (abertura do Tester), ".composer" (conversa do Tester) e
   ".compositor" (conversa do Upgrade). ".compzone" é o invólucro dos chips + a
   caixa, e o realce vai na CAIXA: ele tem que aparecer onde a borda existe. */
.bigbox.sobre,.composer.sobre,.compositor.sobre{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.compzone.sobre .composer{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
@media (prefers-reduced-motion: reduce){ .iob.ouvindo .pt{animation:none} }
`;

  const CSS_ID = "entradas-css";
  function injetarCSS() {
    if (!temDOM || doc.getElementById(CSS_ID)) return false;
    const st = doc.createElement("style");
    st.id = CSS_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
    return true;
  }

  /* ══════════════════════════════════════════════════════════ o que desenha ══ */

  const VOZ_OK = !!(janela && (janela.SpeechRecognition || janela.webkitSpeechRecognition));

  const ICONE_ANEXO = { imagem: "▣", pdf: "▤", texto: "▥", dados: "▦" };
  const kb = n => n < 1024 * 1024
    ? Math.max(1, Math.round(n / 1024)) + "KB"
    : (n / (1024 * 1024)).toFixed(1).replace(".", ",") + "MB";

  /* Um chip por anexo. `lidos` vem do servidor e é observação do `tool_use` da
     sessão — não é "o prompt pediu para ler", é "ela abriu este arquivo". A
     distinção é o que faz o chip valer alguma coisa.

     O NOME é `sens`: "clientes-2026.csv" identifica cliente, e o modo gravação
     existe para isso. O tipo e o tamanho ficam legíveis — eles não identificam
     ninguém e são o que permite conferir que o anexo certo subiu. */
  function chipsAnexos(lista, lidos, podeRemover) {
    const arr = (lista || []).filter(Boolean);
    if (!arr.length) return "";
    const set = new Set(lidos || []);
    return '<div class="anexos">' + arr.map(a => {
      const lido = set.has(a.arquivo);
      return '<span class="anx' + (lido ? " lido" : "") + '"' +
        (lido ? ' title="a sessão abriu este arquivo"' : ' title="anexado — a sessão decide se precisa abrir"') + ">" +
        '<span class="ic" aria-hidden="true">' + (ICONE_ANEXO[a.tipo] || "▧") + "</span>" +
        '<span class="nm sens">' + esc(a.dePasta ? String(a.arquivo || "").replace(/^anexos\//, "") : a.nome) + "</span>" +
        '<span class="sz">' + kb(a.bytes || 0) + "</span>" +
        (podeRemover
          ? '<button type="button" class="x" data-tirar="' + esc(a.arquivo) + '" aria-label="tirar ' + esc(a.nome) + '">×</button>'
          : "") +
        "</span>";
    }).join("") + "</div>";
  }

  /* A nota embaixo dos chips. Ela diz três coisas que ninguém adivinha: que o
     custo do anexo é token quando a sessão abre, que texto passou por limpeza de
     segredo, e que imagem e PDF NÃO passaram — não dá para varrer pixel. Dizer o
     que não foi feito é a parte que costuma faltar. */
  function notaAnexos(lista) {
    const arr = (lista || []).filter(Boolean);
    if (!arr.length) return "";
    const limpos = arr.reduce((a, x) => a + (x.segredosRemovidos || 0), 0);
    const visuais = arr.filter(x => x.tipo === "imagem" || x.tipo === "pdf").length;
    const partes = ["<b>" + arr.length + " anexo(s)</b> — a sessão lê o que precisar e ignora o resto"];
    if (limpos) partes.push("em texto, " + limpos + " valor(es) com cara de token foram trocados por «segredo removido»");
    if (visuais) partes.push(visuais + " imagem/PDF não passa por essa limpeza — o cockpit não varre pixel");
    return '<div class="anxnota">' + partes.join(" · ") + "</div>";
  }

  /* A fileira de botões. `pasta` é o mesmo `<input type=file>` com
     `webkitdirectory`, que é como o navegador entrega uma árvore inteira: cada
     arquivo chega com `webkitRelativePath`, e é isso que o servidor usa para
     preservar a estrutura em vez de achatar tudo num diretório só.

     `travado` desabilita os botões SEM tirá-los da tela, e isso é a mesma lição
     que fez o compositor "conferindo" do Upgrade manter o campo no lugar: sumir
     e voltar em meio segundo é a tela saltando duas vezes, e o segundo salto é o
     que lê como "algo deu errado". */
  function barraIO(idPrefixo, travado) {
    const dis = travado ? " disabled" : "";
    return '<span class="iobar">' +
      (VOZ_OK
        ? '<button type="button" class="iob" id="' + idPrefixo + '-mic" aria-pressed="false"' + dis + ' ' +
          'title="ditar em vez de digitar — a transcrição é feita pelo navegador">' +
          '<span class="pt" aria-hidden="true">●</span> falar</button>'
        : "") +
      /* Glifo geométrico, nunca emoji: medido na captura, `📎` e `🗀` saem como
         caixa vazia nesta fonte — e o resto do produto já é monocromático por
         decisão (o canvas proíbe emoji e logo de terceiro no mesmo espírito). */
      '<button type="button" class="iob" id="' + idPrefixo + '-arq"' + dis + ' ' +
        'title="print, PDF, .md, .txt, CSV — a sessão abre e usa o que servir">' +
        '<span aria-hidden="true">⊕</span> anexar</button>' +
      '<button type="button" class="iob" id="' + idPrefixo + '-pasta"' + dis + ' ' +
        'title="uma pasta inteira: a sessão explora e escolhe o que importa">' +
        '<span aria-hidden="true">⊞</span> pasta</button>' +
      '<input type="file" id="' + idPrefixo + '-fi" multiple hidden ' +
        'accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.md,.markdown,.txt,.rst,.adoc,.log,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.js,.mjs,.ts,.jsx,.tsx,.py,.sql,.css">' +
      '<input type="file" id="' + idPrefixo + '-fp" webkitdirectory directory multiple hidden>' +
      "</span>";
  }

  /* ═══════════════════════════════════════════════════════════════ o ditado ══
   *
   * Uma instância por vez, `continuous` ligado, `interimResults` ligado.
   * `interim` é o que torna o ditado utilizável no palco: o texto aparece
   * enquanto a pessoa fala em vez de surgir de uma vez no fim.
   * O parcial vive FORA do textarea (num nó irmão), porque escrevê-lo dentro
   * destruiria o que já estava digitado a cada reescrita da frase. */
  function ligarVoz(botao, textarea, ondePreview) {
    if (!VOZ_OK) return;
    const S = exigir().estado;
    const Rec = janela.SpeechRecognition || janela.webkitSpeechRecognition;

    const pinta = () => {
      botao.classList.toggle("ouvindo", S.ouvindo);
      botao.setAttribute("aria-pressed", String(!!S.ouvindo));
      botao.lastChild.textContent = S.ouvindo ? " ouvindo — clique para parar" : " falar";
      if (ondePreview) ondePreview.textContent = S.parcial ? S.parcial : "";
    };

    const parar = () => {
      S.ouvindo = false; S.parcial = "";
      if (S.rec) { try { S.rec.stop(); } catch { /* já parou */ } S.rec = null; }
      pinta();
    };

    botao.addEventListener("click", () => {
      if (S.ouvindo) { parar(); return; }
      const rec = new Rec();
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = ev => {
        let parcial = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const t = r[0] ? r[0].transcript : "";
          if (r.isFinal) {
            // Fecha a frase DENTRO do textarea, respeitando o que já havia: o
            // ditado é uma segunda mão escrevendo no mesmo campo, não um modo que
            // toma conta dele.
            const sep = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
            textarea.value += sep + t.trim();
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            parcial += t;
          }
        }
        S.parcial = parcial.trim();
        pinta();
      };
      // `no-speech` e `aborted` são rotina (silêncio, ou parar pelo botão) e não
      // merecem alarme. Permissão negada, sim: sem dizer isso o botão parece
      // quebrado quando o que falta é um clique no cadeado do navegador.
      rec.onerror = ev => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          cfg.avisar("Libere o microfone no cadeado ao lado do endereço e clique em «falar» de novo.",
            "alerta", "O navegador bloqueou o microfone");
        } else if (ev.error === "network") {
          // A Web Speech transcreve no servidor do navegador: sem rede ela não
          // funciona, e dizer isso evita a caça a um defeito que não é nosso.
          cfg.avisar("O ditado do Chrome precisa de internet para transcrever. Pode digitar normalmente.",
            "alerta", "Sem conexão para o ditado");
        }
        parar();
      };
      rec.onend = () => { if (S.ouvindo) { try { rec.start(); } catch { parar(); } } };

      S.rec = rec; S.ouvindo = true; S.parcial = "";
      try { rec.start(); pinta(); } catch { parar(); }
    });

    pinta();
  }

  /* ═══════════════════════════════════════════════════════════════ os anexos ══ */

  const b64De = arquivo => new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onerror = () => falha(new Error("não consegui ler o arquivo"));
    // `readAsDataURL` devolve "data:tipo;base64,XXXX" — só a cauda interessa.
    fr.onload = () => { const s = String(fr.result || ""); ok(s.slice(s.indexOf(",") + 1)); };
    fr.readAsDataURL(arquivo);
  });

  /* O RESUMO das recusas de um lote, em uma frase.
     Medido arrastando uma pasta de projeto: `.env`, `.env.example` e uma chave
     `.pem` foram recusados de uma vez, e cada um virou um aviso — três cartões
     empilhados para um único fato ("esta pasta tem segredos, que não entram"). Numa
     pasta de 50 arquivos isso cobre a tela e o último esconde o primeiro.
     Agrupar por CATEGORIA é o que faz a frase escalar: o número de categorias é
     fixo, o de arquivos não. */
  /* Singular e plural escritos, não derivados. O primeiro jeito era concatenar um
     "s" quando havia mais de um, e saiu "3 chave ou segredos" na tela — em
     português a flexão não cai no fim da frase. Duas strings custam menos que uma
     regra de flexão que erra em metade dos rótulos. */
  const RECUSA_ROTULO = {
    segredo: ["chave ou segredo", "chaves e segredos"],
    converter: ["formato que precisa ser exportado", "formatos que precisam ser exportados"],
    formato: ["tipo que eu não abro", "tipos que eu não abro"],
    teto: ["acima do teto", "acima do teto"],
    vazio: ["arquivo vazio", "arquivos vazios"],
    ilegivel: ["não chegou legível", "não chegaram legíveis"]
  };

  const MSG_SEGREDO_CURTA = "chave e segredo não entram, e não é limitação de formato: " +
    "a sessão não faz nenhuma chamada, então nunca precisa deles.";

  /* O agrupamento, PURO. Ele saiu de dentro do `avisarRecusas` para poder ser
     medido sem navegador: é a frase que decide se um lote de recusas é entendido
     ou é uma pilha de cartões em que o último esconde o primeiro. */
  function agruparRecusas(recusas) {
    const lista = (recusas || []).filter(Boolean);
    if (!lista.length) return null;
    if (lista.length === 1) return { titulo: lista[0].nome, corpo: lista[0].motivo, categorias: 1 };
    // Agrupa por categoria preservando a ordem em que apareceram.
    const porCat = new Map();
    for (const r of lista) {
      const c = r.categoria || "formato";
      if (!porCat.has(c)) porCat.set(c, []);
      porCat.get(c).push(r.nome);
    }
    const partes = [...porCat.entries()].map(([c, nomes]) => {
      const par = RECUSA_ROTULO[c] || [c, c];
      return nomes.length + " " + par[nomes.length > 1 ? 1 : 0];
    });
    const nomes = lista.map(r => r.nome).slice(0, 6).join(", ") +
      (lista.length > 6 ? " e mais " + (lista.length - 6) : "");
    /* A frase de segredo é dita por inteiro mesmo no resumo: é a única recusa cuja
       razão a pessoa precisa entender, porque a mensagem antiga ("não sei abrir")
       convidava a converter a chave para um formato aceito — ou seja, a insistir. */
    return {
      titulo: lista.length + " arquivos não entraram: " + partes.join(", "),
      corpo: nomes + (porCat.has("segredo") ? " — " + MSG_SEGREDO_CURTA : ""),
      categorias: porCat.size
    };
  }

  function avisarRecusas(recusas) {
    const r = agruparRecusas(recusas);
    if (!r) return;
    exigir().avisar(r.corpo, "alerta", r.titulo);
  }

  /* O texto do campo ANCORADO. Ele guarda o RESUMO e não a última recusa: antes
     ele guardava a última, então numa pasta com três problemas ela lia um terço e
     concluía que o resto entrou. */
  function textoAncorado(recusas) {
    const lista = (recusas || []).filter(Boolean);
    if (!lista.length) return null;
    return lista.length === 1
      ? lista[0].nome + ": " + lista[0].motivo
      : lista.length + " arquivos não entraram — " + lista.map(r => r.nome).slice(0, 6).join(", ") +
        (lista.length > 6 ? " e mais " + (lista.length - 6) : "");
  }

  /* Manda UM arquivo por requisição. Sequencial de propósito: o corpo fica
     pequeno, cada recusa é atribuída ao arquivo certo, e a tela mostra progresso
     real em vez de uma barra que representa 40 arquivos como se fossem um. */
  async function subirArquivos(files, sessaoId, repintar) {
    const c = exigir(), S = c.estado;
    const lista = [...files].slice(0, 40);
    if (!lista.length) return;
    S.anexoErro = null;
    const recusas = [];
    for (const f of lista) {
      S.subindo = (S.subindo || 0) + 1;
      if (repintar) repintar();
      try {
        const b64 = await b64De(f);
        // `webkitRelativePath` só existe quando veio de pasta. É ele que preserva
        // a árvore; sem ele o servidor grava plano, o que é o certo para um print.
        const rel = f.webkitRelativePath || null;
        const corpo = { nome: f.name, rel, b64 };
        if (sessaoId) {
          const snap = await c.callApi(c.rotas.sessao(sessaoId), {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(corpo)
          });
          if (c.aoSnapshot) c.aoSnapshot(snap);
        } else {
          const r = await c.callApi(c.rotas.bandeja, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...corpo, bandeja: S.bandeja })
          });
          S.bandeja = r.bandeja; S.anexosPre = r.anexos || [];
        }
      } catch (err) {
        /* A recusa é do arquivo, não do lote: os outros continuam. Ela nomeia o
           arquivo, porque "não aceito .docx" sem dizer qual dos oito não ajuda.
           E vai para a PILHA, uma por arquivo: o campo ancorado guarda só a última,
           então numa pasta com três arquivos recusados ela veria um terço do
           problema e concluiria que o resto entrou. */
        const motivo = String(err && err.message || err);
        recusas.push({ nome: f.name, motivo, categoria: err && err.categoria || null });
        /* A BANDEJA VOLTA MESMO NA RECUSA. O servidor cria o diretório antes de
           validar o arquivo, então uma recusa também tem id — e sem trazê-lo de
           volta um lote cujo PRIMEIRO arquivo é recusado deixa uma bandeja vazia
           órfã e o segundo arquivo abre outra. O `callApi` das duas páginas copia
           `bandeja` para o Error justamente para isto. */
        if (!S.bandeja && err && err.bandeja) S.bandeja = err.bandeja;
      } finally {
        S.subindo--;
        if (repintar) repintar();
      }
    }

    /* Um aviso por LOTE, não por arquivo, e só depois que o lote terminou. */
    if (recusas.length) {
      S.anexoErro = textoAncorado(recusas);
      avisarRecusas(recusas);
      if (repintar) repintar();
    }
  }

  async function tirarAnexo(arquivo, sessaoId, repintar) {
    const c = exigir(), S = c.estado;
    try {
      if (sessaoId) {
        const snap = await c.callApi(c.rotas.sessaoRemover(sessaoId), {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ arquivo })
        });
        if (c.aoSnapshot) c.aoSnapshot(snap);
      } else {
        const r = await c.callApi(c.rotas.bandejaRemover, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ bandeja: S.bandeja, arquivo })
        });
        S.anexosPre = r.anexos || [];
      }
    } catch (err) { S.anexoErro = String(err && err.message || err); }
    if (repintar) repintar();
  }

  /* Liga tudo num par (caixa, textarea): clique nos botões, colar print, arrastar
     arquivo ou pasta para cima da caixa, e tirar um chip.

     Colar é o caminho mais curto que existe para um print — Win+Shift+S e Ctrl+V,
     sem passar por arquivo — e é por isso que ele está aqui e não só o botão.
     O item colado não tem nome, então ganha um com carimbo de hora: dois prints
     colados em sequência viram dois arquivos, não um sobrescrito. */
  function ligarIO(idPrefixo, caixa, textarea, sessaoId, repintar) {
    if (!temDOM || !caixa) return;
    const $$ = id => doc.getElementById(idPrefixo + "-" + id);
    const mic = $$("mic"), arq = $$("arq"), pasta = $$("pasta"), fi = $$("fi"), fp = $$("fp");

    if (mic && textarea) {
      let prev = caixa.querySelector(".ditando");
      if (!prev) {
        prev = doc.createElement("div");
        prev.className = "ditando";
        textarea.insertAdjacentElement("afterend", prev);
      }
      ligarVoz(mic, textarea, prev);
    }

    if (arq && fi) {
      arq.addEventListener("click", () => fi.click());
      fi.addEventListener("change", () => { subirArquivos(fi.files, sessaoId, repintar); fi.value = ""; });
    }
    if (pasta && fp) {
      /* O diálogo que vem em seguida é do NAVEGADOR, não nosso: "Fazer upload de N
         arquivos para este site?". Ele é obrigatório em `webkitdirectory`, não tem
         API para customizar nem para suprimir, e chega com a fonte e a ordem de
         botões do sistema — a mesma feiura que o `confirm()` tinha, só que esta não
         dá para substituir.
         O que dá para fazer é a pessoa não ser pega de surpresa. Um aviso ANTES,
         que não bloqueia (o seletor abre junto), explicando de quem é a caixa e em
         que clicar. Isso transforma um susto num passo esperado — e é melhor que um
         `confirmar()` nosso na frente, que empilharia dois diálogos para uma ação. */
      pasta.addEventListener("click", () => {
        exigir().avisar("O Chrome vai perguntar se pode enviar os arquivos da pasta — a caixa é dele, não nossa. " +
          "Clique em «Fazer upload» para continuar.", "info", "A próxima caixa é do navegador");
        fp.click();
      });
      fp.addEventListener("change", () => { subirArquivos(fp.files, sessaoId, repintar); fp.value = ""; });
    }

    if (textarea) {
      textarea.addEventListener("paste", ev => {
        const itens = [...((ev.clipboardData && ev.clipboardData.files) || [])];
        if (!itens.length) return;          // texto normal segue o caminho normal
        ev.preventDefault();
        subirArquivos(itens.map(nomearPrint), sessaoId, repintar);
      });
    }

    // Arrastar. `dragover` precisa de `preventDefault` senão o navegador abre o
    // arquivo numa aba nova e a conversa é perdida.
    const solta = ev => { ev.preventDefault(); caixa.classList.remove("sobre"); };
    caixa.addEventListener("dragover", ev => { ev.preventDefault(); caixa.classList.add("sobre"); });
    caixa.addEventListener("dragleave", () => caixa.classList.remove("sobre"));
    caixa.addEventListener("drop", ev => {
      solta(ev);
      const fs = (ev.dataTransfer && ev.dataTransfer.files) || [];
      if (fs.length) subirArquivos(fs, sessaoId, repintar);
    });

    caixa.querySelectorAll("[data-tirar]").forEach(b =>
      b.addEventListener("click", () => tirarAnexo(b.dataset.tirar, sessaoId, repintar)));
  }

  /* Dois prints colados em sequência chegam os dois como `image.png`. Sem nome
     próprio o segundo sobrescreveria o primeiro — e `anexos.js` só renomeia
     colisão, o que resolveria no disco mas deixaria dois chips com o mesmo nome
     na tela. O carimbo de hora é o que separa os dois na origem. */
  function nomearPrint(f) {
    if (f.name && f.name !== "image.png") return f;
    const marca = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    return new File([f], "print-" + marca + ".png", { type: f.type });
  }

  const api = {
    configurar, injetarCSS, CSS, CSS_ID,
    VOZ_OK, ICONE_ANEXO, RECUSA_ROTULO, MSG_SEGREDO_CURTA,
    kb, esc,
    chipsAnexos, notaAnexos, barraIO,
    agruparRecusas, textoAncorado, avisarRecusas,
    ligarVoz, ligarIO, subirArquivos, tirarAnexo, b64De, nomearPrint
  };
  return api;
});
