"use strict";
/* O cofre ligado ao `n8n.js`: a precedência, o cache, os três estados.
 *
 *   node cofre-n8n-test.js
 *
 * De graça — nenhum modelo, nenhuma rede, nenhum PowerShell, nada escrito no
 * repositório e nada escrito no cofre de verdade do Kauan.
 *
 * ─────────────────────────────── COMO ELE NÃO FALA COM A INSTÂNCIA DE PRODUÇÃO
 *
 * `loadConfig()` lê o `.env` DO DIRETÓRIO e ele VENCE `process.env`. Um teste
 * descuidado aqui, rodado da pasta do projeto, mandaria a chave de verdade para
 * a instância de verdade. A saída é a que o `mutex-test.js` já usa e está
 * escrita no `CLAUDE.md`: COPIAR `n8n.js` para um diretório SEM `.env` e
 * exercitar a cópia — e conferir a cópia BYTE A BYTE, senão o teste prova outro
 * arquivo. Cada bloco monta a sua própria pasta, porque a coisa que ele está
 * medindo é justamente qual `.env` existe ali.
 *
 * Além disso, `fetch` é instrumentado e CONTADO no fim (bloco 7). Confiar em
 * "não deve sair requisição" é o que faz um teste ficar verde falando com
 * produção.
 *
 * ──────────────────────────────────── O QUE ESTE ARQUIVO NÃO TESTA, DE PROPÓSITO
 *
 * O DPAPI. A ida e volta, as quatro formas de corromper e o segredo nunca
 * aparecer em texto são os 39 casos do `cofre-test.js`, contra o DPAPI de
 * verdade. Aqui o `cofre.js` da CÓPIA é substituído por um dublê, porque o
 * objeto de medida é outro: a LIGAÇÃO. Precedência, cache, invalidação, e o
 * terceiro estado.
 *
 * Um dublê poderia provar o dublê, então duas travas:
 *   - o bloco 8 confere que o `cofre.js` REAL expõe exatamente as funções que o
 *     `n8n.js` chama, com a aridade certa. O dia em que o cofre mudar de forma,
 *     este arquivo fica vermelho em vez de continuar provando um contrato que
 *     não existe mais;
 *   - o dublê CONTA suas chamadas, então "o n8n consultou o cofre" é medido, e
 *     não suposto.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/* ── a rede, contada ─────────────────────────────────────────────────────── */
let chamadasFetch = 0;
const urlsFetch = [];
const fetchOriginal = global.fetch;
global.fetch = function (...args) {
  chamadasFetch++;
  urlsFetch.push(String(args[0]));
  throw new Error("TESTE: saiu uma requisição HTTP — " + String(args[0]));
};

let ok = 0, bad = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log("  ok    " + nome); }
  else { bad++; console.log("  FALHOU " + nome); }
};
const recusa = async fn => { try { await fn(); return null; } catch (e) { return e; } };

/* Com cara de chave de verdade, e inventadas: os três segmentos não são
   credencial nenhuma. Medir vazamento contra `"abc"` não mede nada. */
const CHAVE_COFRE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  + ".eyJzdWIiOiJjb2ZyZS1uOG4tdGVzdGUtY29mcmUiLCJpc3MiOiJuOG4ifQ"
  + ".YXNzaW5hdHVyYS1pbnZlbnRhZGEtcGFyYS1vLXRlc3RlLWRvLWNvZnJl";
const CHAVE_ENV = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  + ".eyJzdWIiOiJjb2ZyZS1uOG4tdGVzdGUtZG90ZW52IiwiaXNzIjoibjhuIn0"
  + ".YXNzaW5hdHVyYS1pbnZlbnRhZGEtcGFyYS1vLXRlc3RlLWRvLWRvdGVudg";

const BASE = "https://instancia-de-teste.invalido";

const temporarias = [];

/* Monta uma pasta com uma CÓPIA de `n8n.js` (mais o que ele exige), sem `.env`
   por padrão, e devolve o módulo já com o cofre trocado por um dublê.
   `simulate.js` entra porque `n8n.js` o exige no topo; `cofre.js` entra porque
   o dublê é instalado NO `require.cache` DA CÓPIA — trocar o `cofre.js` do
   projeto não teria efeito nenhum sobre um `n8n.js` que mora noutro lugar. */
function montar({ env = null, cofre: dubleCofre = {}, semCofre = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cofre-n8n-"));
  temporarias.push(dir);

  const arquivos = semCofre ? ["n8n.js", "simulate.js"] : ["n8n.js", "simulate.js", "cofre.js"];
  for (const f of arquivos) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
  for (const f of arquivos) {
    if (!fs.readFileSync(path.join(dir, f)).equals(fs.readFileSync(path.join(__dirname, f)))) {
      throw new Error("a cópia de " + f + " divergiu — o teste provaria outro arquivo");
    }
  }
  if (env) fs.writeFileSync(path.join(dir, ".env"), env, "utf8");

  const alvoCofre = path.join(dir, "cofre.js");
  const contagem = { ler: 0, estado: 0, esquecer: 0 };
  let mod = null;

  if (!semCofre) {
    /* O arquivo do dublê aponta para um caminho DESTA pasta: `n8n.js` faz
       `statSync(cofre.ARQUIVO)` para montar a assinatura do cache, e apontar
       para o arquivo real do Kauan faria a invalidação depender da máquina de
       quem rodar. */
    const arquivoFalso = path.join(dir, "cofre.dat");
    /* Carrega o módulo de verdade só para o `require.cache` ficar com a chave
       certa, e então SUBSTITUI os exports pelo dublê. Mesma técnica do
       `escrever-test.js` e do `entradas-test.js`. */
    mod = require(alvoCofre);
    const dubleBase = {
      ARQUIVO: arquivoFalso,
      PASTA: dir,
      EH_WINDOWS: true,
      pareceChave: mod.pareceChave,
      estado() { contagem.estado++; return { disponivel: true, porque: null, temChave: false, onde: arquivoFalso }; },
      async ler() { contagem.ler++; return null; },
      esquecer() { contagem.esquecer++; },
      async guardar() { throw new Error("o dublê não guarda"); },
      async apagar() { return false; }
    };
    for (const k of Object.keys(mod)) delete mod[k];
    Object.assign(mod, dubleBase, dubleCofre);
    /* Envolve o que veio de fora para a contagem continuar valendo. */
    if (dubleCofre.estado) {
      const f = dubleCofre.estado;
      mod.estado = (...a) => { contagem.estado++; return f(...a); };
    }
    if (dubleCofre.ler) {
      const f = dubleCofre.ler;
      mod.ler = async (...a) => { contagem.ler++; return f(...a); };
    }
    if (dubleCofre.esquecer) {
      const f = dubleCofre.esquecer;
      mod.esquecer = (...a) => { contagem.esquecer++; return f(...a); };
    }
  }

  const n8n = require(path.join(dir, "n8n.js"));
  return { dir, n8n, cofre: mod, contagem, arquivoCofre: mod && mod.ARQUIVO };
}

/* Varredura RECURSIVA: a chave não pode aparecer em string nenhuma, em
   profundidade nenhuma, de retorno nenhum. Um vazamento no terceiro nível de um
   objeto de estado é exatamente o que uma conferência rasa deixa passar. */
function varrer(v, proibidas, caminho = "$", achados = []) {
  if (typeof v === "string") {
    for (const p of proibidas) {
      if (!p) continue;
      if (v.includes(p)) achados.push(caminho + " (inteira)");
      /* Truncada é PIOR que nada: um prefixo publicado deixa conferir um
         palpite. 16 chars de um JWT já identificam o valor. */
      else if (p.length > 24 && v.includes(p.slice(0, 24))) achados.push(caminho + " (prefixo)");
      else if (p.length > 24 && v.includes(p.slice(-24))) achados.push(caminho + " (sufixo)");
    }
    return achados;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => varrer(x, proibidas, caminho + "[" + i + "]", achados)); return achados; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) varrer(x, proibidas, caminho + "." + k, achados);
    return achados;
  }
  return achados;
}

(async () => {
try {

/* ═════════════ 1. cofre com chave, `.env` ausente ═════════════════════════ */
console.log("\n[ 01 ] cofre com chave e NENHUM .env — a chave vem do cofre");
{
  const { n8n, contagem } = montar({
    env: null,
    cofre: {
      estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
      ler: async () => CHAVE_COFRE
    }
  });
  /* Sem `.env` não há `N8N_BASE_URL`, então `configured` seria falso pela base e
     não pela chave — o que mediria outra coisa. A base entra pelo ambiente, que
     é a única fonte que sobra quando não há arquivo. */
  process.env.N8N_BASE_URL = BASE;
  delete process.env.N8N_API_KEY;

  t("configured é verdadeiro", n8n.configured === true);
  t("instance vem da base", n8n.instance === BASE);

  const st = await n8n.estadoChave();
  t("a fonte declarada é o cofre", st.fonte === "cofre");
  t("...e `abriu` é true", st.cofre.abriu === true);
  t("...e o `.env` diz que não tem chave", st.env.temChave === false);
  t("a ordem de precedência viaja no retorno", st.ordem.join(">") === "cofre>env");
  t("o cofre foi de fato consultado (medido, não suposto)", contagem.ler >= 1);

  /* A prova de que a chave USADA é a do cofre: a requisição é interceptada e o
     cabeçalho é lido. Nada sai — `fetch` lança de propósito. */
  let cabecalho = null;
  global.fetch = (u, o) => { chamadasFetch++; cabecalho = o.headers["X-N8N-API-KEY"]; throw new Error("TESTE: interceptado"); };
  await recusa(() => n8n.getGraph("abc"));
  t("a chave que iria no X-N8N-API-KEY é a DO COFRE", cabecalho === CHAVE_COFRE);
  global.fetch = () => { chamadasFetch++; throw new Error("TESTE: saiu requisição"); };

  delete process.env.N8N_BASE_URL;
}

/* ═════════════ 2. cofre vazio, `.env` com chave ═══════════════════════════ */
console.log("\n[ 02 ] cofre VAZIO e .env com chave — o caminho do dono hoje");
{
  const { n8n, contagem } = montar({
    env: "N8N_BASE_URL=" + BASE + "\nN8N_API_KEY=" + CHAVE_ENV + "\n"
    /* dublê padrão: disponível, sem chave */
  });

  t("configured é verdadeiro", n8n.configured === true);
  t("instance vem do .env", n8n.instance === BASE);

  const st = await n8n.estadoChave();
  t("a fonte declarada é o .env", st.fonte === "env");
  t("...e o .env sabe que a chave veio de ARQUIVO", st.env.deArquivo === true);
  t("...e `abriu` é null: não havia o que abrir", st.cofre.abriu === null);
  t("...e isso NÃO é `abriu: false`", st.cofre.abriu !== false);
  t("o cofre com arquivo vazio não foi aberto (statSync basta)", contagem.ler === 0);

  let cabecalho = null;
  global.fetch = (u, o) => { chamadasFetch++; cabecalho = o.headers["X-N8N-API-KEY"]; throw new Error("TESTE: interceptado"); };
  await recusa(() => n8n.getGraph("abc"));
  t("a chave que iria no X-N8N-API-KEY é a DO .env", cabecalho === CHAVE_ENV);
  global.fetch = () => { chamadasFetch++; throw new Error("TESTE: saiu requisição"); };
}

console.log("\n[ 02b ] o arquivo .env VENCE o process.env — a invariante do isolamento");
{
  /* Este caso não é sobre o cofre. Ele existe porque a precedência
     "arquivo `.env` vence `process.env`" é o que faz `mutex-test.js` e este
     arquivo conseguirem isolar a cópia numa pasta sem `.env`. Inverter isso
     não deixa nenhum outro caso vermelho: os testes continuariam passando,
     falando com a instância de produção do dono.
     MEDIDO: sem este caso, o mutante que troca `env[m[1]] = ...` por
     `if (!(m[1] in process.env))` sobrevive aos outros 74. */
  const { n8n } = montar({
    env: "N8N_BASE_URL=" + BASE + "\nN8N_API_KEY=" + CHAVE_ENV + "\n"
  });
  process.env.N8N_BASE_URL = "https://ambiente-nao-pode-ganhar.invalido";
  process.env.N8N_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbWJpZW50ZSJ9.bmFvLXBvZGUtZ2FuaGFy";

  t("a base vem do ARQUIVO, não do ambiente", n8n.instance === BASE);
  let cabecalho = null;
  global.fetch = (u, o) => { chamadasFetch++; cabecalho = o.headers["X-N8N-API-KEY"]; throw new Error("TESTE: interceptado"); };
  await recusa(() => n8n.getGraph("abc"));
  global.fetch = () => { chamadasFetch++; throw new Error("TESTE: saiu requisição"); };
  t("...e a chave também: o arquivo vence o process.env", cabecalho === CHAVE_ENV);
  t("...e `deArquivo` diz de onde veio", (await n8n.estadoChave()).env.deArquivo === true);

  delete process.env.N8N_BASE_URL;
  delete process.env.N8N_API_KEY;
}

/* ═════════════ 3. os dois, e o cofre ganha ════════════════════════════════ */
console.log("\n[ 03 ] cofre COM chave e .env COM chave — o cofre ganha, e o retorno diz");
{
  const { n8n } = montar({
    env: "N8N_BASE_URL=" + BASE + "\nN8N_API_KEY=" + CHAVE_ENV + "\n",
    cofre: {
      estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
      ler: async () => CHAVE_COFRE
    }
  });

  const st = await n8n.estadoChave();
  t("a fonte declarada é o cofre", st.fonte === "cofre");
  t("...e o retorno NÃO esconde que o .env também tem uma", st.env.temChave === true);
  t("...e a ordem que explica quem ganhou está no retorno", st.ordem[0] === "cofre");

  let cabecalho = null;
  global.fetch = (u, o) => { chamadasFetch++; cabecalho = o.headers["X-N8N-API-KEY"]; throw new Error("TESTE: interceptado"); };
  await recusa(() => n8n.getGraph("abc"));
  t("a chave usada é a do cofre, não a do .env", cabecalho === CHAVE_COFRE);
  t("...e definitivamente não a do .env", cabecalho !== CHAVE_ENV);
  global.fetch = () => { chamadasFetch++; throw new Error("TESTE: saiu requisição"); };
}

/* ═════════════ 4. cofre presente e ILEGÍVEL ═══════════════════════════════ */
console.log("\n[ 04 ] cofre presente e ILEGÍVEL — o terceiro estado");
{
  /* Sem `.env`: é o caso em que não há para onde cair, e portanto o caso em que
     confundir "não abriu" com "não tem" faz o dano máximo. */
  const { n8n } = montar({
    cofre: {
      estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
      ler: async () => { throw new Error("o cofre recusou (código 1): Key not valid for use in specified state."); }
    }
  });
  process.env.N8N_BASE_URL = BASE;
  delete process.env.N8N_API_KEY;

  t("NÃO é `configured: false` — existe chave configurada", n8n.configured === true);

  const st = await n8n.estadoChave();
  t("`abriu` é false, e isso é distinguível de null", st.cofre.abriu === false);
  t("...o cofre continua dizendo que TEM chave", st.cofre.temChave === true);
  t("...o motivo viaja", typeof st.cofre.erro === "string" && st.cofre.erro.length > 0);
  t("...e a fonte é NENHUMA, não `env`", st.fonte === null);

  const e = await recusa(() => n8n.getGraph("abc"));
  t("a requisição falha", !!e);
  t("...e a mensagem NOMEIA o cofre", /cofre/i.test(e.message));
  t("...e diz que não é o mesmo que não ter chave", /não é o mesmo que não ter chave/i.test(e.message));
  t("...e NÃO manda editar o .env como se faltasse a chave lá",
    !/falta N8N_API_KEY/.test(e.message));

  /* A frase que a tela precisa: outra máquina / outra conta do Windows. */
  t("...e explica por que um cofre de outra máquina não abre", /outra máquina|outra conta/i.test(e.message));

  delete process.env.N8N_BASE_URL;
}

console.log("\n[ 04b ] cofre ilegível MAS .env bom — o dono continua funcionando");
{
  const { n8n } = montar({
    env: "N8N_BASE_URL=" + BASE + "\nN8N_API_KEY=" + CHAVE_ENV + "\n",
    cofre: {
      estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
      ler: async () => { throw new Error("o cofre recusou (código 1): blob inválido"); }
    }
  });
  const st = await n8n.estadoChave();
  t("cai para o .env em vez de travar", st.fonte === "env");
  t("...e o problema do cofre continua sendo relatado", st.cofre.abriu === false && !!st.cofre.erro);

  let cabecalho = null;
  global.fetch = (u, o) => { chamadasFetch++; cabecalho = o.headers["X-N8N-API-KEY"]; throw new Error("TESTE: interceptado"); };
  await recusa(() => n8n.getGraph("abc"));
  t("...e a requisição sai com a chave do .env", cabecalho === CHAVE_ENV);
  global.fetch = () => { chamadasFetch++; throw new Error("TESTE: saiu requisição"); };
}

console.log("\n[ 04c ] nada em lugar nenhum — aí sim é `não configurado`");
{
  const { n8n } = montar({});
  process.env.N8N_BASE_URL = BASE;
  delete process.env.N8N_API_KEY;
  t("configured é falso", n8n.configured === false);
  const st = await n8n.estadoChave();
  t("a fonte é nenhuma", st.fonte === null);
  t("...e `abriu` é null, nunca false", st.cofre.abriu === null);
  const e = await recusa(() => n8n.getGraph("abc"));
  t("a recusa fala de colar a chave, não de cofre quebrado",
    /falta N8N_API_KEY/.test(e.message) && !/NÃO abriu/.test(e.message));
  delete process.env.N8N_BASE_URL;
}

/* ═════════════ 5. troca de chave: o cache invalida ════════════════════════ */
console.log("\n[ 05 ] troca de chave — DUAS leituras, não uma");
{
  let atual = CHAVE_ENV;
  const arq = { mtimeMs: 1, size: 10 };
  const { n8n, contagem, arquivoCofre } = montar({
    cofre: {
      estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
      ler: async () => atual
    }
  });
  process.env.N8N_BASE_URL = BASE;
  delete process.env.N8N_API_KEY;
  /* O arquivo do dublê precisa EXISTIR: a assinatura do cache é mtime+tamanho. */
  fs.writeFileSync(arquivoCofre, "blob-1", "utf8");

  const ler = async () => {
    let cab = null;
    global.fetch = (u, o) => { chamadasFetch++; cab = o.headers["X-N8N-API-KEY"]; throw new Error("TESTE: interceptado"); };
    await recusa(() => n8n.getGraph("abc"));
    global.fetch = () => { chamadasFetch++; throw new Error("TESTE: saiu requisição"); };
    return cab;
  };

  t("primeira leitura traz a chave velha", (await ler()) === CHAVE_ENV);
  const depoisDaPrimeira = contagem.ler;

  t("a segunda leitura NÃO reabre o cofre (o cache existe)",
    (await ler()) === CHAVE_ENV && contagem.ler === depoisDaPrimeira);

  /* A troca: valor novo + invalidação explícita, que é o que a rota de troca
     faz. Sem o `esquecerChave()` o processo grudaria na chave velha. */
  atual = CHAVE_COFRE;
  n8n.esquecerChave();
  t("depois de esquecerChave(), a chamada seguinte usa a NOVA", (await ler()) === CHAVE_COFRE);
  t("...e o cofre foi reaberto de verdade", contagem.ler > depoisDaPrimeira);
  t("...e a memória do próprio cofre também foi zerada", contagem.esquecer >= 1);

  /* E o caso em que NINGUÉM chamou `esquecerChave()`: outro processo troca o
     arquivo. A assinatura é mtime+tamanho, então a divergência decide. */
  const antes = contagem.ler;
  atual = CHAVE_ENV;
  fs.writeFileSync(arquivoCofre, "blob-2-com-tamanho-diferente", "utf8");
  t("arquivo trocado POR FORA também invalida (divergência, não relógio)",
    (await ler()) === CHAVE_ENV && contagem.ler > antes);

  delete process.env.N8N_BASE_URL;
}

/* ═════════════ 6. a chave nunca aparece ═══════════════════════════════════ */
console.log("\n[ 06 ] a chave não aparece em retorno nenhum nem em erro nenhum");
{
  const PROIBIDAS = [CHAVE_COFRE, CHAVE_ENV];

  /* 6a — estado com tudo presente */
  {
    const { n8n } = montar({
      env: "N8N_BASE_URL=" + BASE + "\nN8N_API_KEY=" + CHAVE_ENV + "\n",
      cofre: {
        estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
        ler: async () => CHAVE_COFRE
      }
    });
    const st = await n8n.estadoChave();
    const vazou = varrer(st, PROIBIDAS);
    t("estadoChave() não vaza a chave em profundidade nenhuma", vazou.length === 0);
    if (vazou.length) console.log("        vazou em: " + vazou.join(", "));
    t("...e não devolve nenhum campo com nome de chave",
      !("chave" in st) && !("apiKey" in st) && !("key" in st));
  }

  /* 6b — o pior caso: o cofre lança um erro QUE CARREGA a chave. Não deveria
     acontecer (o `cofre.js` não põe o valor em erro nenhum), e é exatamente por
     isso que a varredura de saída existe: ela não confia no vizinho. */
  {
    const { n8n } = montar({
      cofre: {
        estado: () => ({ disponivel: true, porque: null, temChave: true, onde: "x" }),
        ler: async () => { throw new Error("falhou lendo " + CHAVE_COFRE + " do disco"); }
      }
    });
    process.env.N8N_BASE_URL = BASE;
    delete process.env.N8N_API_KEY;

    const st = await n8n.estadoChave();
    const vazou = varrer(st, PROIBIDAS);
    t("um erro do cofre que carrega a chave é limpo antes de viajar", vazou.length === 0);
    if (vazou.length) console.log("        vazou em: " + vazou.join(", "));

    const e = await recusa(() => n8n.getGraph("abc"));
    t("...e a mensagem da recusa também está limpa",
      varrer({ m: e.message, s: String(e) }, PROIBIDAS).length === 0);
    t("...substituída por um marcador, não apagada em silêncio", /«chave»/.test(st.cofre.erro));

    delete process.env.N8N_BASE_URL;
  }

  /* 6c — `estado()` do cofre também é entrada não confiável: o `porque` é
     texto que atravessa para a tela. */
  {
    const { n8n } = montar({
      cofre: { estado: () => { throw new Error("explodiu com " + CHAVE_ENV + " dentro"); } }
    });
    const st = await n8n.estadoChave();
    t("um `estado()` que lança não derruba, e não vaza",
      st.cofre.disponivel === false && varrer(st, PROIBIDAS).length === 0);
  }

  /* 6d — a varredura de saída é a DO MÓDULO, medida aqui, não reescrita. */
  {
    const { n8n } = montar({});
    t("semSegredo apaga o valor literal", !n8n.semSegredo("x " + CHAVE_ENV + " y", CHAVE_ENV).includes(CHAVE_ENV));
    t("...e a FORMA de JWT mesmo sem ter o valor para comparar",
      !n8n.semSegredo("vazou " + CHAVE_COFRE).includes(CHAVE_COFRE));
    t("...e não come o texto em volta", /vazou/.test(n8n.semSegredo("vazou " + CHAVE_COFRE)));
  }
}

/* ═════════════ 7. nenhuma requisição HTTP saiu ════════════════════════════ */
console.log("\n[ 07 ] nada saiu para a rede — contado, não suposto");
t("o `fetch` real nunca foi chamado (todas as tentativas foram interceptadas)",
  global.fetch !== fetchOriginal);
t("nenhuma tentativa apontou para um host que não seja o de teste",
  urlsFetch.every(u => u.includes("instancia-de-teste.invalido")));
console.log("        (tentativas interceptadas: " + chamadasFetch + ", nenhuma completou)");

/* ═════════════ 8. o dublê não pode divergir do cofre de verdade ═══════════ */
console.log("\n[ 08 ] o contrato que o n8n.js usa existe no cofre.js DE VERDADE");
{
  const real = require("./cofre.js");
  for (const f of ["ler", "estado", "esquecer"]) {
    t("cofre.js exporta `" + f + "`", typeof real[f] === "function");
  }
  t("cofre.js exporta ARQUIVO (a assinatura do cache o usa)", typeof real.ARQUIVO === "string");

  const fonte = fs.readFileSync(path.join(__dirname, "n8n.js"), "utf8");
  /* Medido em fonte SEM COMENTÁRIO: este repositório já teve dois casos ficarem
     verdes porque o comentário carregava o nome que o teste procurava. */
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  /* O caminho do `require` casa com o mesmo padrão (`cofre.js`) e não é uma
     chamada — sai antes, senão o caso reprova por si mesmo. */
  const semRequire = codigo.replace(/require\([^)]*\)/g, "require()");
  /* `(?<![.\w])` porque `c.cofre.erro` é um campo do objeto local de
     configuração, não uma chamada ao módulo — sem isso o caso reprova por
     acidente e ensina a ignorá-lo. */
  const usados = [...new Set((semRequire.match(/(?<![.\w])cofre\.(\w+)/g) || []).map(s => s.split(".")[1]))];
  t("o n8n.js só chama do cofre o que foi conferido acima (usa: " + usados.join(",") + ")",
    usados.length > 0 && usados.every(f => ["ler", "estado", "esquecer", "ARQUIVO"].includes(f)));
  t("`configured` é getter no export, não valor congelado",
    /get configured\(\)/.test(codigo));
  t("`instance` é getter no export, não valor congelado",
    /get instance\(\)/.test(codigo));
  t("não sobrou nenhum `cfg.` congelado", !/\bcfg\./.test(codigo));
  t("a precedência está declarada em código, não só em prosa",
    /ORDEM_DA_CHAVE\s*=\s*\["cofre",\s*"env"\]/.test(codigo));
  t("o require do cofre é guardado (o mutex-test copia n8n.js sem ele)",
    /try\s*\{\s*cofre\s*=\s*require\("\.\/cofre\.js"\)/.test(codigo));
}

/* ═════════════ 9. a porta de teste declarada ══════════════════════════════ */
console.log("\n[ 09 ] o setter que o entradas-test.js usa, e que ele torna visível");
{
  const { n8n } = montar({});
  /* `entradas-test.js:39` faz exatamente isto, em modo estrito. Com um getter
     puro, lançaria TypeError e aquele arquivo inteiro morreria. */
  let quebrou = null;
  try { n8n.configured = true; } catch (e) { quebrou = e; }
  t("atribuir `n8n.configured` não lança em modo estrito", quebrou === null);
  t("...e o valor forçado vale", n8n.configured === true);
  const st = await n8n.estadoChave();
  t("...e ele VIAJA como `forcado`, para não ser mentira invisível", st.forcado === true);
  n8n.configured = null;
  t("...e dá para soltar", st.forcado === true && n8n.configured === false);
}

/* ═════════════ 10. cópia sem o cofre — o mutex-test.js continua vivo ══════ */
console.log("\n[ 10 ] n8n.js copiado SEM cofre.js — o cliente não cai");
{
  const { n8n } = montar({
    env: "N8N_BASE_URL=" + BASE + "\nN8N_API_KEY=" + CHAVE_ENV + "\n",
    semCofre: true
  });
  t("o módulo carrega", typeof n8n.overview === "function");
  t("...e configured continua verdadeiro pelo .env", n8n.configured === true);
  const st = await n8n.estadoChave();
  t("...com a fonte no .env", st.fonte === "env");
  t("...e o cofre indisponível COM MOTIVO, nunca em silêncio",
    st.cofre.disponivel === false && typeof st.cofre.porque === "string" && st.cofre.porque.length > 0);
  t("...e `abriu` é null, não false", st.cofre.abriu === null);
}

} finally {
  global.fetch = fetchOriginal;
  for (const d of temporarias) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* já foi */ } }
}

console.log("\n" + (bad ? "FALHOU" : "passou") + ": " + ok + " ok, " + bad + " falha(s)\n");
process.exitCode = bad ? 1 : 0;

})();
