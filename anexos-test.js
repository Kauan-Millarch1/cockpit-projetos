// O que a pessoa anexa vira arquivo no disco de uma sessão do Claude, com nome
// que veio do navegador. Cada teste aqui rejeita um defeito NOMEADO — a maioria
// deles é o tipo de coisa que só aparece quando já é tarde.
//
// Grátis: sem modelo, sem rede, sem escrever no n8n. `node anexos-test.js`.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

const anexos = require("./anexos");

let falhas = 0;
function caso(nome, cond, detalhe) {
  if (cond) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHOU " + nome + (detalhe ? "\n         " + detalhe : ""));
}

const b64 = txt => Buffer.from(txt, "utf8").toString("base64");
// PNG de 1x1 real: o gravador não olha o conteúdo, mas um teste que usa texto
// fingindo ser imagem esconderia qualquer coisa que passe a olhar.
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

(async () => {
  const raiz = await fsp.mkdtemp(path.join(os.tmpdir(), "anexos-test-"));
  try {
    /* ---------------------------------------------- o caminho, que é o perigo */

    // Nome vem do navegador: é payload. Um `..` que sobrevive escreve fora do
    // diretório da sessão — e o diretório vizinho guarda o backup COM
    // credenciais no caminho do claude-fix.
    caso("nomeSeguro tira travessia", anexos.nomeSeguro("../../etc/passwd") === "passwd",
      "virou: " + anexos.nomeSeguro("../../etc/passwd"));
    caso("nomeSeguro tira caminho absoluto de Windows",
      anexos.nomeSeguro("C:\\Windows\\System32\\drivers\\etc\\hosts") === "hosts");
    caso("nomeSeguro recusa dotfile virando oculto", !anexos.nomeSeguro(".env").startsWith("."));
    caso("relSeguro varre o .. do meio", anexos.relSeguro("p/../../x/y.md") === "p/x/y.md",
      "virou: " + anexos.relSeguro("p/../../x/y.md"));
    caso("relSeguro corta profundidade",
      anexos.relSeguro("a/b/c/d/e/f/g/h/i/j/k.md").split("/").length <= anexos.MAX_PROFUNDIDADE);

    // A gravação prova o guarda de verdade: se o `..` passasse, o arquivo
    // apareceria FORA de `anexos/`.
    const dirT = path.join(raiz, "s1");
    await fsp.mkdir(dirT, { recursive: true });
    const trav = await anexos.gravar(dirT, { nome: "../fuga.md", b64: b64("x") }, []);
    caso("gravar não escapa do diretório",
      trav.ok && trav.meta.arquivo === "anexos/fuga.md" && !fs.existsSync(path.join(dirT, "fuga.md")),
      JSON.stringify(trav));

    /* ------------------------------------------------------- o que entra e não */

    const okMd = await anexos.gravar(dirT, { nome: "spec.md", b64: b64("# especificação") }, []);
    caso("aceita .md como texto", okMd.ok && okMd.meta.tipo === "texto");

    const okPng = await anexos.gravar(dirT, { nome: "print.png", b64: PNG_1x1 }, []);
    caso("aceita png como imagem", okPng.ok && okPng.meta.tipo === "imagem");

    const exe = await anexos.gravar(dirT, { nome: "virus.exe", b64: b64("MZ") }, []);
    caso("recusa executável", !exe.ok, JSON.stringify(exe));

    // Recusa COM instrução: `.docx` é o formato que a pessoa mais tem na mão, e
    // um "não aceito" sem caminho de saída faz ela desistir do anexo.
    const docx = await anexos.gravar(dirT, { nome: "contrato.docx", b64: b64("PK") }, []);
    caso("recusa .docx dizendo o que fazer", !docx.ok && /PDF|CSV|cole/i.test(docx.motivo),
      JSON.stringify(docx));
    const xlsx = await anexos.gravar(dirT, { nome: "estoque.xlsx", b64: b64("PK") }, []);
    caso("recusa .xlsx apontando o CSV", !xlsx.ok && /CSV/i.test(xlsx.motivo));

    const vazio = await anexos.gravar(dirT, { nome: "nada.txt", b64: "" }, []);
    caso("recusa arquivo vazio", !vazio.ok);

    /* ---------------------------------------------------- segredo e chave
     * Medido arrastando uma pasta de projeto real: `.env`, `.env.example` e
     * `sftp_key_pem` eram recusados como "não sei abrir «sem extensão»" — o
     * `nomeSeguro` tira o ponto inicial, então `path.extname` devolve vazio e o
     * arquivo caía na peneira de FORMATO. A recusa estava certa e a razão estava
     * errada, do pior jeito: sugeria converter a chave para um tipo aceito. */
    for (const nome of [".env", ".env.example", ".env.local", "sftp_key_pem", "chave.pem",
                        "id_rsa", "servidor.key", "credentials.json", "service-account.json",
                        ".npmrc", "meu_secret.txt", "backup.p12"]) {
      const r = await anexos.gravar(dirT, { nome, b64: b64("conteudo qualquer") }, []);
      caso("recusa segredo: " + nome, !r.ok && r.categoria === "segredo",
        JSON.stringify({ ok: r.ok, cat: r.categoria }));
    }
    const env = await anexos.gravar(dirT, { nome: ".env", b64: b64("N8N_API_KEY=abc") }, []);
    caso("a razão do segredo NÃO fala de formato",
      !/sei abrir|extensão/i.test(env.motivo) && /chave|segredo/i.test(env.motivo), env.motivo);
    caso("a razão do segredo diz o que fazer no lugar", /sem os valores|ESTRUTURA/i.test(env.motivo), env.motivo);

    // Nem tudo que tem "key" no nome é chave. Um falso positivo aqui recusa
    // material legítimo — `keywords.csv` é planilha, não credencial.
    for (const nome of ["keywords.csv", "monkey.png", "chaves-de-busca.md", "turkey.json"]) {
      const r = await anexos.gravar(dirT, { nome, b64: b64("a,b\n1,2") }, []);
      caso("aceita nome parecido mas legítimo: " + nome, r.ok, JSON.stringify(r));
    }

    // A categoria existe para a tela AGRUPAR — sem ela, cada recusa vira um
    // cartão e uma pasta de projeto cobre a tela.
    const semExt = await anexos.gravar(dirT, { nome: "Makefile", b64: b64("all:") }, []);
    caso("recusa por formato traz categoria", !semExt.ok && semExt.categoria === "formato",
      JSON.stringify(semExt));
    const dcx = await anexos.gravar(dirT, { nome: "a.docx", b64: b64("PK") }, []);
    caso("recusa por conversão traz categoria", !dcx.ok && dcx.categoria === "converter");

    /* ------------------------------------------------------------- os tetos */

    const grande = Buffer.alloc(anexos.MAX_BYTES_ARQUIVO + 10, 0x41).toString("base64");
    const rg = await anexos.gravar(dirT, { nome: "enorme.txt", b64: grande }, []);
    caso("recusa acima do teto por arquivo", !rg.ok && /teto por arquivo/.test(rg.motivo));

    const cheio = Array.from({ length: anexos.MAX_ARQUIVOS }, (_, i) => ({ bytes: 10, arquivo: "anexos/x" + i }));
    const rc = await anexos.gravar(dirT, { nome: "um-mais.txt", b64: b64("x") }, cheio);
    caso("recusa acima do teto de quantidade", !rc.ok && /arquivos nesta conversa/.test(rc.motivo));

    const quaseTudo = [{ bytes: anexos.MAX_BYTES_TOTAL - 5, arquivo: "anexos/a" }];
    const rt = await anexos.gravar(dirT, { nome: "gota.txt", b64: b64("dez bytes!") }, quaseTudo);
    caso("recusa acima do teto somado", !rt.ok && /somando/.test(rt.motivo));

    /* --------------------------------------------------------- colisão de nome */

    // Dois prints colados em sequência chegam os dois como "image.png".
    // Sobrescrever perderia um anexo sem dizer nada.
    const d2 = path.join(raiz, "s2");
    await fsp.mkdir(d2, { recursive: true });
    const p1 = await anexos.gravar(d2, { nome: "image.png", b64: PNG_1x1 }, []);
    const p2 = await anexos.gravar(d2, { nome: "image.png", b64: PNG_1x1 }, [p1.meta]);
    caso("segundo arquivo de mesmo nome não sobrescreve o primeiro",
      p1.ok && p2.ok && p1.meta.nome !== p2.meta.nome &&
      fs.existsSync(path.join(d2, "anexos", p1.meta.nome)) &&
      fs.existsSync(path.join(d2, "anexos", p2.meta.nome)),
      p1.meta && p2.meta ? p1.meta.nome + " / " + p2.meta.nome : "");

    /* ------------------------------------------------------------ o segredo */

    // Um .md de especificação com token dentro é comum, e o token não serve para
    // nada aqui — a sessão não faz chamada nenhuma. O que ele faria é acabar no
    // report.md, no log e no arquivo do projeto, que são três lugares que ficam.
    const d3 = path.join(raiz, "s3");
    await fsp.mkdir(d3, { recursive: true });
    const comToken = "Use a chave sk-abcdefghijklmnopqrstuvwx no header.";
    const seg = await anexos.gravar(d3, { nome: "api.md", b64: b64(comToken) }, []);
    const gravado = await fsp.readFile(path.join(d3, seg.meta.arquivo), "utf8");
    caso("segredo em texto é trocado antes de tocar o disco",
      seg.ok && seg.meta.segredosRemovidos === 1 && !gravado.includes("sk-abcdefghijkl") && /segredo removido/.test(gravado),
      gravado);

    // E a imagem NÃO passa por isso — não dá para varrer pixel. O que importa é
    // que o número não minta dizendo que varreu.
    caso("imagem não reporta limpeza que não houve", okPng.meta.segredosRemovidos === 0);

    /* -------------------------------------------------------------- a pasta */

    const d4 = path.join(raiz, "s4");
    await fsp.mkdir(d4, { recursive: true });
    const arqs = [
      { nome: "leia.md", rel: "projeto/docs/leia.md", b64: b64("# doc") },
      { nome: "dados.csv", rel: "projeto/dados/dados.csv", b64: b64("nome,telefone\na,1") },
      { nome: "tela.png", rel: "projeto/tela.png", b64: PNG_1x1 }
    ];
    let metas = [];
    for (const a of arqs) {
      const r = await anexos.gravar(d4, a, metas);
      if (r.ok) metas.push(r.meta);
    }
    caso("pasta preserva a estrutura",
      metas.length === 3 && metas.every(m => m.dePasta && m.raiz === "projeto") &&
      fs.existsSync(path.join(d4, "anexos", "projeto", "docs", "leia.md")),
      JSON.stringify(metas.map(m => m.arquivo)));

    // O inventário sai do DISCO, não do que a tela disse ter mandado: é ele que
    // a sessão vai poder abrir de verdade.
    const inv = await anexos.inventario(d4);
    caso("inventário lê a árvore do disco", inv.length === 3 && inv.some(m => m.arquivo === "anexos/projeto/dados/dados.csv"),
      JSON.stringify(inv.map(m => m.arquivo)));

    /* -------------------------------------------------------------- o índice */

    await anexos.escreverIndice(d4, metas);
    const idx = await fsp.readFile(path.join(d4, "anexos", "INDICE.md"), "utf8");
    caso("índice existe e agrupa pela pasta", /## Pasta `projeto`/.test(idx));
    // A instrução mais importante do arquivo: sem ela o modelo abre os 40 em
    // ordem e chega na primeira pergunta com o contexto cheio de nada.
    caso("índice manda NÃO ler tudo", /Não leia tudo/i.test(idx), idx.slice(0, 200));
    caso("índice ensina a usar Glob/Grep antes de abrir", /Glob/.test(idx) && /Grep/.test(idx));
    caso("índice não vaza conteúdo de arquivo", !/nome,telefone/.test(idx));

    const idxSeg = anexos.indice([{ nome: "a.md", arquivo: "anexos/a.md", tipo: "texto", bytes: 10, segredosRemovidos: 2 }]);
    caso("índice avisa quando limpou segredo", /segredo removido pelo cockpit/.test(idxSeg) && /PREENCHER/.test(idxSeg));

    /* -------------------------------------------------------- o trecho do prompt */

    const trecho = anexos.trechoPrompt(metas);
    caso("trecho do prompt cita o índice", /anexos\/INDICE\.md/.test(trecho));
    caso("trecho manda perguntar quando o anexo contradiz", /CONTRADIZ/i.test(trecho));
    caso("trecho proíbe inventar uso para o anexo", /não invente uso/i.test(trecho.toLowerCase().replace(/ã/g, "ã")) || /Não invente uso/i.test(trecho));
    // O prompt viaja em `-p` e a linha de comando do Windows acaba em 32767. Uma
    // pasta de 40 arquivos com nome longo não pode empurrar o prompt para lá.
    const muitos = Array.from({ length: 40 }, (_, i) => ({
      nome: "arquivo-com-nome-bem-comprido-numero-" + i + ".md",
      arquivo: "anexos/arquivo-com-nome-bem-comprido-numero-" + i + ".md",
      tipo: "texto", bytes: 100, dePasta: false, raiz: null, segredosRemovidos: 0
    }));
    const grandeTrecho = anexos.trechoPrompt(muitos);
    caso("trecho do prompt tem teto", grandeTrecho.length < 3000, "tamanho: " + grandeTrecho.length);
    caso("trecho diz quando cortou nomes", /e mais \d+/.test(grandeTrecho), grandeTrecho.slice(-300));
    caso("sem anexo, trecho é vazio", anexos.trechoPrompt([]) === "");

    /* ------------------------------------------------------------- a bandeja */

    const runs = path.join(raiz, "runs");
    const bandeja = anexos.novaBandeja();
    const dirB = anexos.dirBandeja(runs, bandeja);
    await fsp.mkdir(dirB, { recursive: true });
    await anexos.gravar(dirB, { nome: "antes.md", b64: b64("veio antes da sessao") }, []);
    const dirS = path.join(runs, "t123");
    await fsp.mkdir(dirS, { recursive: true });
    const adotou = await anexos.adotar(runs, bandeja, dirS);
    caso("sessão adota a bandeja",
      adotou && fs.existsSync(path.join(dirS, "anexos", "antes.md")) && !fs.existsSync(dirB));

    // Id de bandeja vem de fora do processo. Se ele virasse caminho sem validação,
    // seria travessia direta.
    let recusou = false;
    try { anexos.dirBandeja(runs, "../../etc"); } catch { recusou = true; }
    caso("bandeja com id inválido é recusada", recusou);

    // Bandeja abandonada é lixo com arquivo de alguém dentro: abrir a tela,
    // arrastar uma pasta e fechar o navegador deixa uma para trás.
    const velha = anexos.novaBandeja();
    const dirV = anexos.dirBandeja(runs, velha);
    await fsp.mkdir(dirV, { recursive: true });
    const antigo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fsp.utimes(dirV, antigo, antigo);
    const n = await anexos.limparBandejas(runs, 24 * 60 * 60 * 1000);
    caso("bandeja velha é limpa por idade", n >= 1 && !fs.existsSync(dirV), "removidas: " + n);

    /* -------------------------------------------------------------- remover */

    const d5 = path.join(raiz, "s5");
    await fsp.mkdir(d5, { recursive: true });
    const rem = await anexos.gravar(d5, { nome: "tirar.md", b64: b64("x") }, []);
    await fsp.writeFile(path.join(d5, "workflow.json"), "{}", "utf8");
    await anexos.remover(d5, rem.meta.arquivo);
    caso("remover apaga o anexo", !fs.existsSync(path.join(d5, rem.meta.arquivo)));
    // A rota existe para tirar um chip da tela. Ela não pode ser um caminho para
    // apagar o resultado da construção.
    let barrou = false;
    try { await anexos.remover(d5, "workflow.json"); } catch { barrou = true; }
    caso("remover não alcança fora de anexos/",
      barrou || fs.existsSync(path.join(d5, "workflow.json")));

    /* --------------------------------------------------------------- resumo */

    const res = anexos.resumo(metas);
    caso("resumo conta por tipo e lista pastas",
      res.n === 3 && res.pastas.length === 1 && res.porTipo.imagem === 1 && res.bytes > 0,
      JSON.stringify(res));
  } finally {
    await fsp.rm(raiz, { recursive: true, force: true });
  }

  console.log("");
  if (falhas) {
    console.log("FALHOU: " + falhas + " caso(s).");
    process.exit(1);
  }
  console.log("passou: anexo entra validado, pasta continua pasta, e nada escapa do diretório.");
})().catch(err => { console.error(err); process.exit(1); });
