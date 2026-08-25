"use strict";

/* O que a pessoa anexa à conversa do Tester: print, PDF, .md, planilha — e pasta
 * inteira. FATOS APENAS. Este arquivo grava, valida e descreve; quem decide o
 * que fazer com cada arquivo é a sessão do Claude, e quem decide o que aparece
 * na tela é o `tester.html`.
 *
 * A razão de existir: uma ideia escrita em duas linhas perde exatamente o que
 * decide o fluxo — o formato real do destino, os nomes verdadeiros das colunas,
 * a mensagem que a pessoa quer ver chegando. Tudo isso ela já tem em algum
 * lugar: num print do canal do Slack, numa planilha, num .md de especificação.
 *
 * TRÊS DECISÕES QUE MOLDAM O ARQUIVO INTEIRO:
 *
 * 1. NÃO EXISTE PARSER NOSSO. O CLI do Claude lê imagem e PDF nativamente com a
 *    ferramenta `Read`. Escrever OCR, extrator de PDF ou leitor de planilha aqui
 *    seria construir — e depois manter — o que a sessão já faz melhor. O que este
 *    módulo faz é pôr o arquivo onde a sessão alcança e dizer que ele está lá.
 *
 * 2. O ARQUIVO VIAJA EM DISCO, NUNCA NO PROMPT. Mesma lição já paga por
 *    `escreverContexto()`: o prompt anda em `-p` e a linha de comando do Windows
 *    acaba em 32767 caracteres. Um .md de 40KB inline mataria o spawn com
 *    `ENAMETOOLONG`, que não nomeia prompt nem tamanho. No prompt vai só o índice.
 *
 * 3. PASTA É PARA SER EXPLORADA, NÃO DESPEJADA. Uma pasta de 200 arquivos não
 *    cabe em contexto nenhum, e 90% dela não importa. A sessão recebe a árvore em
 *    `INDICE.md` e as ferramentas `Glob`/`Grep` para caçar o que serve — ela
 *    decide o que abrir. É a diferença entre ler a pasta e entender a pasta. */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

/* ------------------------------------------------------------------ o que entra
 *
 * Whitelist por extensão, e a categoria diz COMO a sessão vai ler aquilo — o que
 * muda o que o prompt pode prometer. `imagem` e `pdf` o CLI abre nativamente;
 * `texto` e `dados` são texto puro e passam pelo `scrub`. Uma extensão fora
 * daqui não existe: recusar é a resposta certa, porque um arquivo que a sessão
 * não consegue abrir viraria uma tentativa de `Read` falhando no meio da
 * entrevista, e a pessoa ficaria achando que o anexo foi considerado. */
const TIPOS = {
  ".png": "imagem", ".jpg": "imagem", ".jpeg": "imagem", ".gif": "imagem", ".webp": "imagem",
  ".pdf": "pdf",
  ".md": "texto", ".markdown": "texto", ".txt": "texto", ".rst": "texto", ".adoc": "texto", ".log": "texto",
  ".csv": "dados", ".tsv": "dados", ".json": "dados", ".yaml": "dados", ".yml": "dados",
  ".xml": "dados", ".html": "dados", ".htm": "dados",
  ".js": "dados", ".mjs": "dados", ".ts": "dados", ".jsx": "dados", ".tsx": "dados",
  ".py": "dados", ".sql": "dados", ".css": "dados"
};

/* SEGREDO tem recusa própria, e a razão importa mais que a recusa.
 *
 * Medido ao arrastar uma pasta de projeto real: `.env`, `.env.example` e
 * `sftp_key_pem` foram recusados — o que está certo — mas a tela disse "não sei
 * abrir «sem extensão»". Isso é falso e é pior que falso: sugere um problema de
 * formato e convida a pessoa a converter o arquivo para um tipo que eu aceite,
 * ou seja a insistir em mandar a chave privada.
 *
 * A recusa aqui é DE PROPÓSITO e não é sobre formato: a sessão não faz chamada
 * nenhuma (sem rede, sem Bash), então ela nunca precisa de um segredo — e o
 * arquivo iria para o diretório da corrida, com o texto podendo vazar para
 * `report.md`, para o log de atividade e para o arquivo do projeto, três lugares
 * que ficam. `.env.example` cai na mesma regra por precaução: o nome promete que
 * é exemplo, e vira o lugar preferido para colar a chave de verdade "só para
 * testar".
 *
 * Regra por NOME, não por extensão, porque a maioria destes não tem extensão
 * útil (`.env`, `id_rsa`, `known_hosts`). */
const SEGREDO_NOME = [
  /^\.?env(\..*)?$/i,            // .env, .env.local, .env.example, env
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^known_hosts$/i, /^authorized_keys$/i,
  /^\.?npmrc$/i, /^\.?netrc$/i, /^\.?git-credentials$/i, /^\.?htpasswd$/i,
  /^credentials(\..*)?$/i, /^service[-_]?account.*\.json$/i,
  /^.*\.(pem|key|ppk|p12|pfx|jks|keystore|asc|gpg|kdbx)$/i,
  /^.*_(pem|key)$/i,             // sftp_key_pem — o `.` já foi limpo do nome
  /secret|senha|password/i
];

const MSG_SEGREDO = "isto parece uma chave ou um arquivo de segredo, e ele não entra — não é " +
  "limitação de formato: a sessão não faz nenhuma chamada, então nunca precisa do segredo. " +
  "Se o que importa é a ESTRUTURA (os nomes dos campos), mande um exemplo sem os valores.";

const pareceSegredo = nome => SEGREDO_NOME.some(re => re.test(String(nome || "")));

/* Recusa COM INSTRUÇÃO, que é diferente de recusa. `.docx` e `.xlsx` são zip por
 * dentro: aceitar seria entregar à sessão um arquivo que ela abre como lixo
 * binário. Mas é o formato que a pessoa mais tem na mão, então a mensagem diz o
 * caminho em vez de só dizer não. */
const CONVERTER = {
  ".docx": "Word não abre aqui (é um zip por dentro). Salve como PDF ou cole o texto na conversa.",
  ".doc": "Word não abre aqui. Salve como PDF ou cole o texto na conversa.",
  ".xlsx": "Excel não abre aqui. Exporte a aba como CSV — e o CSV é melhor mesmo, porque mostra os nomes reais das colunas.",
  ".xls": "Excel não abre aqui. Exporte a aba como CSV.",
  ".pptx": "PowerPoint não abre aqui. Exporte como PDF.",
  ".zip": "Arquivo compactado não abre aqui. Arraste a pasta descompactada — pasta é aceita.",
  ".rar": "Arquivo compactado não abre aqui. Arraste a pasta descompactada.",
  ".7z": "Arquivo compactado não abre aqui. Arraste a pasta descompactada."
};

/* Tetos. Eles existem para o custo e para o tempo, não para o disco: cada página
 * de PDF e cada imagem que a sessão abre é token pago no plano, e uma pasta de
 * 500 arquivos faria a entrevista gastar minutos decidindo o que ler. Quando um
 * teto corta, o que foi deixado de fora é DITO — um anexo silenciosamente
 * descartado é pior que um anexo recusado, porque a pessoa segue achando que ele
 * está sendo considerado. */
const MAX_ARQUIVOS = 40;
const MAX_BYTES_ARQUIVO = 12 * 1024 * 1024;
const MAX_BYTES_TOTAL = 48 * 1024 * 1024;
const MAX_PROFUNDIDADE = 8;
const MAX_NOME = 120;

/* Segredo em anexo. Um .md de especificação com um token dentro é comum, e esse
 * token não serve para nada aqui: a sessão não faz chamada nenhuma (sem rede,
 * sem Bash). O que ele faria é aparecer no `report.md`, no log de atividade e no
 * arquivo do projeto — três lugares que ficam. Então texto passa pelo `scrub` na
 * gravação, e quando algo foi trocado isso vira número no meta e frase na tela.
 * Imagem e PDF não dão para varrer, e isso está dito em voz alta na interface. */
const SEGREDO_RE = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\bn8n_api_[A-Za-z0-9_-]{16,}/g
];

function limparSegredos(txt) {
  let t = String(txt), n = 0;
  for (const re of SEGREDO_RE) {
    t = t.replace(re, () => { n++; return "«segredo removido pelo cockpit»"; });
  }
  return { texto: t, removidos: n };
}

/* ------------------------------------------------------------------ o caminho
 *
 * O nome vem do navegador, ou seja de fora: é payload. `..`, barra, dois-pontos
 * e caractere de controle saem antes de qualquer coisa tocar o disco. Um nome
 * que fica vazio depois disso ganha um genérico em vez de virar erro — a pessoa
 * colou um print, o nome não é o assunto. */
function nomeSeguro(nome, fallback) {
  // Escapes, nunca o byte literal: um caractere de controle escrito a mao neste
  // repositorio ja falhou em silencio tres vezes, e caractere-test.js existe por isso.
  let n = String(nome == null ? "" : nome).replace(/[\u0000-\u001f\u007f]/g, "");
  n = n.split(/[/\\]/).pop() || "";
  n = n.replace(/^\.+/, "").replace(/[<>:"|?*]/g, "-").trim();
  if (n.length > MAX_NOME) {
    const ext = path.extname(n).slice(0, 12);
    n = n.slice(0, MAX_NOME - ext.length) + ext;
  }
  return n || fallback || "anexo";
}

/* O caminho DENTRO da pasta que a pessoa arrastou. O navegador entrega
 * `webkitRelativePath` como "minha-pasta/sub/arquivo.md", e preservar isso é o
 * que faz a pasta continuar sendo uma pasta para a sessão — achatar tudo num
 * diretório só destruiria a informação que mais importa, que é a organização que
 * a pessoa já deu ao material. Cada segmento é validado separadamente: um `..`
 * no meio é o que transformaria um upload em escrita fora do diretório. */
function relSeguro(rel) {
  const partes = String(rel == null ? "" : rel).split(/[/\\]/)
    .map(p => p.trim())
    .filter(p => p && p !== "." && p !== "..");
  if (!partes.length) return null;
  const limpas = partes.slice(0, MAX_PROFUNDIDADE).map((p, i, arr) =>
    nomeSeguro(p, "parte" + (i + 1)));
  return limpas.join("/");
}

/* ------------------------------------------------------------------ a gravação
 *
 * `dentro` é o mesmo guarda que o `tester.js` usa: resolve e prova que o
 * resultado continua debaixo do diretório permitido. Ele é a última linha, não a
 * primeira — `nomeSeguro` e `relSeguro` já limparam —, e é de propósito: duas
 * camadas independentes, porque esta recebe nome de arquivo de fora do processo. */
function dentro(dir, p) {
  const r = path.resolve(dir, p);
  const base = path.resolve(dir);
  if (r !== base && !r.startsWith(base + path.sep)) {
    throw new Error("caminho fora do diretório permitido");
  }
  return r;
}

// Nome livre no destino. Dois prints colados viram "image.png" e "image-2.png":
// sobrescrever o primeiro perderia um anexo sem dizer nada.
function nomeLivre(destDir, nome) {
  const ext = path.extname(nome);
  const base = nome.slice(0, nome.length - ext.length) || "anexo";
  let cand = nome, i = 2;
  while (fs.existsSync(path.join(destDir, cand))) { cand = base + "-" + i + ext; i++; }
  return cand;
}

function jaTem(metas) {
  return (metas || []).reduce((a, m) => a + (m.bytes || 0), 0);
}

/* Grava UM arquivo. Um por requisição de propósito: o corpo fica pequeno, a tela
 * mostra progresso de verdade e o servidor nunca segura 48MB de base64 em
 * memória de uma vez.
 *
 * Devolve `{ok:true, meta}` ou `{ok:false, motivo, categoria}` — nunca lança por
 * causa de conteúdo. Um anexo recusado é resposta normal desta função: quem
 * recusa explica, e a tela mostra a frase.
 *
 * `categoria` existe para a tela AGRUPAR. Arrastar uma pasta de projeto recusa
 * vários de uma vez (medido: `.env`, `.env.example` e uma chave, numa pasta só),
 * e um aviso por arquivo empilha uma coluna que esconde o primeiro. Com a
 * categoria a tela diz "3 não entraram: 2 segredos, 1 formato" e detalha embaixo. */
async function gravar(baseDir, { nome, rel, b64 }, metasAtuais) {
  const metas = metasAtuais || [];
  if (metas.length >= MAX_ARQUIVOS) {
    return { ok: false, categoria: "teto", motivo: "já são " + MAX_ARQUIVOS + " arquivos nesta conversa — o teto existe porque cada um custa token quando a sessão abre" };
  }

  const seguro = nomeSeguro(nome, "anexo");
  const ext = path.extname(seguro).toLowerCase();

  /* Segredo é checado ANTES do formato, e a ordem é a correção de um defeito
   * medido: `.env` cai na peneira de extensão (o `.` inicial sai em `nomeSeguro`,
   * então `path.extname` devolve vazio) e era recusado como "não sei abrir «sem
   * extensão»" — uma mensagem que manda a pessoa converter a chave para um
   * formato aceito, ou seja insistir. O nome original é o que vale aqui, não o
   * limpo: é nele que o ponto inicial ainda existe. */
  if (pareceSegredo(nome) || pareceSegredo(seguro)) {
    return { ok: false, categoria: "segredo", motivo: MSG_SEGREDO };
  }

  if (CONVERTER[ext]) return { ok: false, categoria: "converter", motivo: CONVERTER[ext] };
  const tipo = TIPOS[ext];
  if (!tipo) {
    return { ok: false, categoria: "formato",
      motivo: "não sei abrir «" + (ext || seguro) + "». Aceito imagem (png, jpg, webp), pdf, texto (md, txt) e dados (csv, json, yaml, xml, código)" };
  }

  let buf;
  try { buf = Buffer.from(String(b64 || ""), "base64"); }
  catch { return { ok: false, categoria: "ilegivel", motivo: "conteúdo do arquivo não chegou legível" }; }
  if (!buf.length) return { ok: false, categoria: "vazio", motivo: "arquivo vazio" };
  if (buf.length > MAX_BYTES_ARQUIVO) {
    return { ok: false, categoria: "teto", motivo: "arquivo tem " + mb(buf.length) + " e o teto por arquivo é " + mb(MAX_BYTES_ARQUIVO) };
  }
  if (jaTem(metas) + buf.length > MAX_BYTES_TOTAL) {
    return { ok: false, categoria: "teto", motivo: "passaria de " + mb(MAX_BYTES_TOTAL) + " somando os anexos desta conversa" };
  }

  const relLimpo = relSeguro(rel);
  const destRel = relLimpo
    // Veio de pasta: o último segmento é o arquivo, e o nome dele já foi limpo
    // dentro do `relSeguro`. A estrutura é preservada.
    ? relLimpo
    : seguro;

  const anexosDir = dentro(baseDir, "anexos");
  await fsp.mkdir(anexosDir, { recursive: true });

  let destino = dentro(anexosDir, destRel);
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  // Colisão só é renomeada fora de pasta. Dentro de uma pasta o caminho é único
  // por construção, e renomear ali quebraria a árvore que a pessoa mandou.
  if (!relLimpo) {
    const livre = nomeLivre(anexosDir, path.basename(destino));
    destino = dentro(anexosDir, livre);
  }

  let removidos = 0;
  if (tipo === "texto" || tipo === "dados") {
    const r = limparSegredos(buf.toString("utf8"));
    removidos = r.removidos;
    await fsp.writeFile(destino, r.texto, "utf8");
  } else {
    await fsp.writeFile(destino, buf);
  }

  const arquivo = path.relative(baseDir, destino).split(path.sep).join("/");
  return {
    ok: true,
    meta: {
      nome: path.basename(destino),
      arquivo,                                   // relativo ao dir da sessão
      raiz: relLimpo ? relLimpo.split("/")[0] : null,
      dePasta: !!relLimpo,
      tipo,
      bytes: (await fsp.stat(destino)).size,
      segredosRemovidos: removidos
    }
  };
}

async function remover(baseDir, arquivo) {
  const alvo = dentro(baseDir, String(arquivo || ""));
  // Só dentro de `anexos/`: sem isto, `arquivo: "workflow.json"` apagaria o
  // resultado da construção por uma rota que existe para tirar um chip da tela.
  dentro(dentro(baseDir, "anexos"), path.relative(dentro(baseDir, "anexos"), alvo));
  await fsp.rm(alvo, { force: true });
}

/* O CAMINHO ABSOLUTO DE UM ANEXO, para quem precisa SERVIR o arquivo — a conversa
 * do /upgrade desenha o print dentro da mensagem que o levou.
 *
 * A guarda é a MESMA do `remover`, e é dupla de propósito: `dentro` prova que o
 * caminho não escapou do diretório da sessão, e o segundo `dentro` prova que ele
 * está debaixo de `anexos/`. Sem o segundo, um `arquivo: "fluxo.json"` (ou, pior,
 * `"../_private/<id>.json"`, que é o backup COM credencial) sairia por uma rota
 * que existe para mostrar uma imagem. Duas camadas independentes, a mesma
 * disciplina de `nomeSeguro`/`dentro()`.
 *
 * NÃO checa existência: quem chama precisa distinguir "não existe" de "não pode",
 * porque as duas frases levam a decisões opostas na tela — `.upgrade-runs/` é
 * scratch e o arquivo pode ter sido limpo, o que é um fato sobre o disco, não uma
 * recusa. */
function caminhoDeAnexo(baseDir, arquivo) {
  const alvo = dentro(baseDir, String(arquivo || ""));
  const anexosDir = dentro(baseDir, "anexos");
  dentro(anexosDir, path.relative(anexosDir, alvo));
  return alvo;
}

const mb = n => (n / (1024 * 1024)).toFixed(1).replace(".", ",") + "MB";

/* ------------------------------------------------------------------- a bandeja
 *
 * Anexar acontece ANTES de a sessão existir: na tela de abertura a pessoa
 * escreve a ideia e arrasta o print junto. Sem um lugar para isso, a interface
 * teria de segurar os arquivos em memória e mandar tudo num corpo gigante no
 * clique de «Começar» — que é exatamente o corpo de 48MB que a gravação um-a-um
 * evita. A bandeja é esse lugar: um diretório com id próprio que a sessão ADOTA
 * quando nasce. */
function novaBandeja() { return "b" + crypto.randomBytes(5).toString("hex"); }
const BANDEJA_RE = /^b[a-f0-9]{6,20}$/;

function dirBandeja(runsDir, bandeja) {
  if (!BANDEJA_RE.test(String(bandeja || ""))) throw new Error("bandeja inválida");
  return path.join(runsDir, "_bandejas", bandeja);
}

/* A sessão adota a bandeja movendo o diretório — `rename` é atômico e não copia
 * 48MB. Cai para copiar-e-apagar quando a origem e o destino estão em volumes
 * diferentes (`EXDEV`), que é raro aqui mas é o erro que ninguém lembra de
 * tratar. */
async function adotar(runsDir, bandeja, dirSessao) {
  const de = dirBandeja(runsDir, bandeja);
  if (!fs.existsSync(path.join(de, "anexos"))) return false;
  const para = path.join(dirSessao, "anexos");
  try {
    await fsp.rename(path.join(de, "anexos"), para);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await fsp.cp(path.join(de, "anexos"), para, { recursive: true });
    await fsp.rm(path.join(de, "anexos"), { recursive: true, force: true });
  }
  await fsp.rm(de, { recursive: true, force: true });
  return true;
}

/* Bandeja abandonada é lixo com arquivo de alguém dentro. Quem abre a tela,
 * arrasta uma pasta e fecha o navegador deixa uma para trás — some no boot
 * seguinte, por idade. */
async function limparBandejas(runsDir, maxIdadeMs) {
  const raiz = path.join(runsDir, "_bandejas");
  let nomes = [];
  try { nomes = await fsp.readdir(raiz); } catch { return 0; }
  const limite = Date.now() - (maxIdadeMs || 24 * 60 * 60 * 1000);
  let n = 0;
  for (const nome of nomes) {
    try {
      const st = await fsp.stat(path.join(raiz, nome));
      if (st.mtimeMs < limite) { await fsp.rm(path.join(raiz, nome), { recursive: true, force: true }); n++; }
    } catch { /* sumiu no meio, tanto melhor */ }
  }
  return n;
}

/* ------------------------------------------------------------------- o índice
 *
 * O que a sessão lê primeiro. É um mapa, não o conteúdo: caminho, tipo e tamanho
 * de cada arquivo, agrupado pela pasta que a pessoa mandou.
 *
 * Ele carrega uma instrução que parece óbvia e não é: NÃO LEIA TUDO. Sem ela o
 * modelo abre os 40 arquivos em ordem, gasta a entrevista inteira lendo e chega
 * na primeira pergunta com o contexto cheio de coisa que não decidia nada. O que
 * se quer é o contrário — que ele olhe a árvore, decida o que serve e abra só
 * aquilo. É por isso que a sessão ganha `Glob` e `Grep` junto com `Read`. */
function indice(metas) {
  const lista = (metas || []).filter(Boolean);
  const L = ["# O que a pessoa anexou", ""];
  if (!lista.length) { L.push("(nada)"); return L.join("\n"); }

  L.push("São " + lista.length + " arquivo(s), " + mb(jaTem(lista)) + " no total. Os caminhos abaixo são relativos ao diretório atual.");
  L.push("");
  L.push("**Não leia tudo.** Este índice existe para você ESCOLHER. Abra o que decide o fluxo e ignore o resto —");
  L.push("um print mostra o formato real do destino, um CSV mostra os nomes verdadeiros das colunas, um .md pode");
  L.push("ser a especificação inteira. Num diretório grande use `Glob` e `Grep` para achar o arquivo certo antes");
  L.push("de abrir qualquer coisa: cada leitura custa contexto que você vai querer para as perguntas.");
  L.push("");

  const soltos = lista.filter(m => !m.dePasta);
  const pastas = new Map();
  for (const m of lista.filter(x => x.dePasta)) {
    if (!pastas.has(m.raiz)) pastas.set(m.raiz, []);
    pastas.get(m.raiz).push(m);
  }

  if (soltos.length) {
    L.push("## Arquivos soltos", "");
    for (const m of soltos) L.push("- `anexos/" + m.nome + "` — " + m.tipo + ", " + mb(m.bytes));
    L.push("");
  }

  for (const [raiz, arqs] of pastas) {
    L.push("## Pasta `" + raiz + "` — " + arqs.length + " arquivo(s), " + mb(jaTem(arqs)), "");
    // Ordenado por caminho: a árvore fica legível e arquivos irmãos ficam juntos,
    // que é o que permite decidir "esta subpasta toda não interessa".
    for (const m of [...arqs].sort((a, b) => a.arquivo.localeCompare(b.arquivo))) {
      L.push("- `" + m.arquivo + "` — " + m.tipo + ", " + mb(m.bytes));
    }
    L.push("");
  }

  const limpos = lista.filter(m => m.segredosRemovidos > 0);
  if (limpos.length) {
    L.push("## Aviso", "");
    L.push("Em " + limpos.length + " arquivo(s) de texto o cockpit substituiu o que tinha forma de token por");
    L.push("«segredo removido pelo cockpit». Se um valor que você precisaria estava ali, ele NÃO está mais:");
    L.push("trate o campo como `[PREENCHER]` em vez de inventar um valor.");
    L.push("");
  }
  return L.join("\n");
}

/* O bloco que entra no prompt — e ele é curto de propósito. O detalhe está no
 * `INDICE.md`, no disco; aqui vai só o suficiente para a sessão saber que os
 * arquivos existem, que ela deve olhar antes de perguntar, e o que fazer quando
 * o anexo contradiz o que foi escrito.
 *
 * O teto de caracteres é a mesma disciplina do `ultimosAteCaber`: a lista de
 * nomes é entrada de fora e cresce sem limite natural, e o prompt já foi para
 * 36KB uma vez neste projeto. Quando corta, diz que cortou. */
const ORC_ANEXOS = 1800;

function trechoPrompt(metas) {
  const lista = (metas || []).filter(Boolean);
  if (!lista.length) return "";

  const soltos = lista.filter(m => !m.dePasta).map(m => m.nome);
  const raizes = [...new Set(lista.filter(m => m.dePasta).map(m => m.raiz))];

  const L = [
    "",
    "ELA ANEXOU MATERIAL — " + lista.length + " arquivo(s). Isto não é decoração: quando o anexo mostra o formato",
    "real do destino, os nomes verdadeiros dos campos ou a especificação, ele vale MAIS que a descrição escrita,",
    "porque é o dado e não a lembrança do dado.",
    "",
    "Comece lendo `anexos/INDICE.md` — é a árvore do que ela mandou, com tipo e tamanho.",
    "Depois abra só o que decide o fluxo. Você tem `Read` para abrir (imagem e PDF inclusive), e `Glob`/`Grep`",
    "para caçar dentro de pasta grande sem abrir arquivo por arquivo."
  ];

  let usado = 0;
  const nomes = [];
  for (const n of soltos) {
    if (usado + n.length + 4 > ORC_ANEXOS) break;
    nomes.push(n); usado += n.length + 4;
  }
  if (nomes.length) {
    L.push("", "Arquivos soltos: " + nomes.map(n => "`" + n + "`").join(", ")
      + (nomes.length < soltos.length ? " (e mais " + (soltos.length - nomes.length) + " — todos estão no índice)" : ""));
  }
  if (raizes.length) {
    L.push("Pasta(s): " + raizes.map(r => "`" + r + "/`").join(", ")
      + " — a estrutura foi preservada como ela mandou.");
  }

  L.push(
    "",
    "COMO USAR O QUE LEU:",
    "- Print de conversa ou de canal: copie o FORMATO (quem manda, que campos aparecem, como a mensagem é escrita).",
    "- Planilha ou CSV: os nomes das colunas são os nomes reais dos campos. Use-os na expressão, não um sinônimo.",
    "- Documento de especificação: trate como requisito, e diga em `achados` o que dele você não vai conseguir atender.",
    "- Arquivo que CONTRADIZ o que ela escreveu: não escolha calado. Pergunte qual dos dois vale.",
    "- Arquivo que não serve para nada aqui: ignore e siga. Não invente uso para justificar o anexo.",
    "- Se o anexo já responde uma das dimensões da entrevista, NÃO pergunte aquela dimensão. Foi para isso que ele veio."
  );
  return L.join("\n");
}

/* Onde o índice é escrito. Fica junto dos anexos, e não na raiz do diretório da
 * sessão, para que uma pasta chamada `INDICE.md` da pessoa não colida com o
 * nosso — e para que o caminho no prompt (`anexos/INDICE.md`) seja o mesmo em
 * toda sessão. */
async function escreverIndice(baseDir, metas) {
  const anexosDir = dentro(baseDir, "anexos");
  await fsp.mkdir(anexosDir, { recursive: true });
  const txt = indice(metas);
  await fsp.writeFile(path.join(anexosDir, "INDICE.md"), txt, "utf8");
  return txt.length;
}

/* Reconstrói os metas a partir do disco. É como a sessão adota uma bandeja: a
 * tela já sabe o que mandou, mas o servidor não pode acreditar na tela — o
 * inventário verdadeiro é o que existe no diretório. */
async function inventario(baseDir) {
  const anexosDir = path.join(baseDir, "anexos");
  const out = [];
  async function anda(dir, relPrefixo, prof) {
    if (prof > MAX_PROFUNDIDADE) return;
    let entradas = [];
    try { entradas = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const rel = relPrefixo ? relPrefixo + "/" + e.name : e.name;
      if (e.isDirectory()) { await anda(path.join(dir, e.name), rel, prof + 1); continue; }
      if (!e.isFile() || e.name === "INDICE.md") continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!TIPOS[ext]) continue;
      let st; try { st = await fsp.stat(path.join(dir, e.name)); } catch { continue; }
      out.push({
        nome: e.name, arquivo: "anexos/" + rel,
        raiz: rel.includes("/") ? rel.split("/")[0] : null,
        dePasta: rel.includes("/"),
        tipo: TIPOS[ext], bytes: st.size, segredosRemovidos: 0
      });
    }
  }
  await anda(anexosDir, "", 1);
  return out.slice(0, MAX_ARQUIVOS);
}

/* O resumo que a TELA usa. Fatos: quantos, quanto, quantas pastas, se algum
 * texto foi limpo. O juízo — se vale anexar mais, se o custo é aceitável — é da
 * página, como todo juízo neste projeto. */
function resumo(metas) {
  const lista = (metas || []).filter(Boolean);
  const porTipo = {};
  for (const m of lista) porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
  return {
    n: lista.length,
    bytes: jaTem(lista),
    porTipo,
    pastas: [...new Set(lista.filter(m => m.dePasta).map(m => m.raiz))],
    segredosRemovidos: lista.reduce((a, m) => a + (m.segredosRemovidos || 0), 0),
    tetoArquivos: MAX_ARQUIVOS,
    tetoBytes: MAX_BYTES_TOTAL
  };
}

module.exports = {
  gravar, remover, indice, escreverIndice, trechoPrompt, inventario, resumo,
  novaBandeja, dirBandeja, adotar, limparBandejas, caminhoDeAnexo,
  // exportados para teste
  nomeSeguro, relSeguro, limparSegredos, pareceSegredo, TIPOS, CONVERTER, MSG_SEGREDO,
  MAX_ARQUIVOS, MAX_BYTES_ARQUIVO, MAX_BYTES_TOTAL, MAX_PROFUNDIDADE
};
