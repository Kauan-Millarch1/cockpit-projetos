"use strict";
/* O cofre da chave do n8n: 24 casos.
 *
 *   node cofre-test.js
 *
 * De graça — nenhum modelo, nenhuma rede, nada que toque a instância. Usa o
 * DPAPI de verdade (é o objeto do teste; um dublê provaria o dublê), então roda
 * só no Windows e diz isso em vez de fingir que passou.
 *
 * O ARQUIVO REAL DO KAUAN É SALVO E DEVOLVIDO byte a byte. Este teste escreve no
 * mesmo caminho que o cofre de verdade usa, porque testar noutro caminho testaria
 * outro caminho — então ele carrega a responsabilidade de não destruir a chave de
 * quem rodar.
 *
 * Os três casos que carregam o arquivo:
 *
 *   1. A CHAVE NUNCA APARECE EM TEXTO — nem no arquivo, nem numa mensagem de
 *      erro, nem num argumento de processo. Aferido contra um valor com cara de
 *      chave real, não contra "abc".
 *   2. ARQUIVO CORROMPIDO LANÇA, ausência devolve `null`. As duas situações
 *      levam a telas opostas: "não tem chave guardada" convida a colar uma;
 *      "tem um cofre aqui e ele não abre" é outro problema e outra frase. Um
 *      cofre que devolvesse `null` no corrompido apagaria essa diferença.
 *   3. NENHUMA CORRUPÇÃO DEVOLVE VALOR ERRADO EM SILÊNCIO. É o pior defeito
 *      possível aqui: chave errada vai para o n8n, volta 401, e a tela acusa
 *      "chave revogada" — mandando a pessoa trocar uma chave que estava certa.
 */

const fs = require("node:fs");
const path = require("node:path");
const cofre = require("./cofre");

let ok = 0, falhou = 0;
const ta = async (nome, fn) => {
  try { await fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(e && e.message)); }
};
const igual = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((m || "") + " esperava " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
  }
};
const verdade = (v, m) => { if (!v) throw new Error(m || "esperava verdadeiro"); };
const lanca = async (fn, m) => {
  try { await fn(); } catch (e) { return e; }
  throw new Error(m || "esperava que lançasse, e não lançou");
};

/* Com cara de chave de verdade: o formato JWT que esta instância usa. Nada aqui
   é credencial — os três segmentos são inventados. */
const FALSA = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  + ".eyJzdWIiOiJjaGF2ZS1kZS10ZXN0ZS1kby1jb2ZyZSIsImlzcyI6Im44biJ9"
  + ".YXNzaW5hdHVyYS1pbnZlbnRhZGEtc28tcGFyYS1lc3RlLXRlc3RlLXNlbS12YWxvcg";

(async () => {

if (!cofre.EH_WINDOWS) {
  console.log("\nesta máquina não é Windows: o cofre não existe aqui, e o teste");
  console.log("não finge que passou. Rode no Windows.\n");
  process.exitCode = 0;
  return;
}

/* ── guarda o que já existe, e devolve aconteça o que acontecer ───────────── */
const havia = fs.existsSync(cofre.ARQUIVO);
const backup = havia ? fs.readFileSync(cofre.ARQUIVO) : null;
const devolver = () => {
  try {
    if (havia) { fs.mkdirSync(cofre.PASTA, { recursive: true }); fs.writeFileSync(cofre.ARQUIVO, backup); }
    else if (fs.existsSync(cofre.ARQUIVO)) fs.unlinkSync(cofre.ARQUIVO);
  } catch (e) { console.error("\n!! NÃO CONSEGUI DEVOLVER O ARQUIVO ORIGINAL:", e.message); }
};
process.on("exit", devolver);
if (havia) console.log("\n(havia um cofre real; ele será devolvido byte a byte ao fim)");

try {

console.log("\n1. ida e volta");

await ta("guarda e devolve o valor idêntico", async () => {
  await cofre.apagar().catch(() => {});
  cofre.esquecer();
  await cofre.guardar(FALSA);
  cofre.esquecer();
  igual(await cofre.ler(), FALSA);
});

await ta("a segunda leitura vem da memória e não abre processo", async () => {
  const t = Date.now();
  igual(await cofre.ler(), FALSA);
  verdade(Date.now() - t < 50, "levou " + (Date.now() - t) + "ms — abriu PowerShell de novo?");
});

await ta("esquecer() força reler do disco, e o valor continua o mesmo", async () => {
  cofre.esquecer();
  igual(await cofre.ler(), FALSA);
});

await ta("guardar duas vezes deixa a última", async () => {
  const outra = FALSA.replace("dGVzdGU", "b3V0cm8");
  await cofre.guardar(outra);
  cofre.esquecer();
  igual(await cofre.ler(), outra);
  await cofre.guardar(FALSA);
});

console.log("\n2. a chave nunca aparece em texto");

await ta("não está em texto no arquivo cifrado", async () => {
  const bruto = fs.readFileSync(cofre.ARQUIVO, "utf8");
  verdade(!bruto.includes(FALSA), "a chave inteira está no arquivo");
  verdade(!bruto.includes(FALSA.slice(0, 24)), "um pedaço reconhecível da chave está no arquivo");
  verdade(!/eyJ/.test(bruto), "algo com cara de JWT está no arquivo");
});

await ta("o arquivo é hex do DPAPI, com o cabeçalho dele", async () => {
  const bruto = fs.readFileSync(cofre.ARQUIVO, "utf8").trim();
  verdade(/^[0-9a-fA-F]+$/.test(bruto), "não é hex puro");
  verdade(bruto.toLowerCase().startsWith("01000000d08c9ddf"),
    "não começa com o cabeçalho do DPAPI: " + bruto.slice(0, 16));
});

await ta("o segredo NÃO viaja em argumento de processo", async () => {
  /* Argumento é visível para quem listar os processos da máquina. Aferido na
     fonte porque é estrutural: o valor entra por stdin, nunca em `args`. */
  const src = fs.readFileSync(path.join(__dirname, "cofre.js"), "utf8");

  /* A primeira versão deste caso recortava a partir do literal
     `spawn("powershell.exe"`. Quando o alvo virou a constante `POWERSHELL`, o
     `indexOf` passou a devolver -1, o `slice(-1, …)` devolveu STRING VAZIA, e
     todas as asserções abaixo passaram trivialmente sobre o nada. Verde e cego
     — o pior estado possível, porque some da bandeja como se estivesse provado.
     Agora o recorte não depende de COMO o alvo está escrito, e a ausência dele
     é falha explícita em vez de fatia vazia. */
  const iSpawn = src.search(/spawn\(/);
  verdade(iSpawn > -1, "não achei a chamada de spawn — o recorte deste caso está quebrado");
  const iFim = src.indexOf("let out", iSpawn);
  verdade(iFim > iSpawn, "não achei o fim da chamada de spawn");
  const chamada = src.slice(iSpawn, iFim);
  verdade(chamada.length > 40, "a fatia analisada ficou curta demais (" + chamada.length + " chars) — recorte quebrado");

  const args = chamada.slice(0, chamada.indexOf("],") + 1);
  verdade(args.length > 20, "não isolei a lista de argumentos");
  verdade(!/valor|chave|entrada|segredo/.test(args),
    "algo com cara do segredo aparece na lista de argumentos: " + args.replace(/\s+/g, " ").slice(0, 120));
  verdade(/stdin\.end\(entrada/.test(src), "não achei a escrita do valor no stdin");
});

await ta("a mensagem de erro de um blob inválido não cita o segredo", async () => {
  fs.writeFileSync(cofre.ARQUIVO, "00".repeat(64), "utf8");
  cofre.esquecer();
  const e = await lanca(() => cofre.ler());
  verdade(!e.message.includes(FALSA), "o segredo está na mensagem");
  verdade(!/eyJ/.test(e.message), "algo com cara de JWT está na mensagem");
  verdade(e.message.length < 400, "mensagem grande demais, pode carregar carga: " + e.message.length);
});

console.log("\n3. ausência devolve null; corrompido LANÇA");

await ta("sem arquivo, ler() devolve null e não lança", async () => {
  await cofre.apagar().catch(() => {});
  cofre.esquecer();
  igual(await cofre.ler(), null);
});

await ta("sem arquivo, estado() diz que não tem chave", async () => {
  const st = cofre.estado();
  igual(st.disponivel, true);
  igual(st.temChave, false);
});

await ta("com arquivo vazio, ler() devolve null (nada guardado ainda)", async () => {
  fs.mkdirSync(cofre.PASTA, { recursive: true });
  fs.writeFileSync(cofre.ARQUIVO, "", "utf8");
  cofre.esquecer();
  igual(await cofre.ler(), null);
});

for (const [rot, conteudo] of [
  ["adulterado no meio", null],
  ["truncado pela metade", null],
  ["lixo que não é hex", "isto definitivamente nao e um blob do dpapi"],
  ["hex curto demais", "0100"]
]) {
  await ta("corrompido (" + rot + ") LANÇA, não devolve null nem valor errado", async () => {
    await cofre.guardar(FALSA);
    const bom = fs.readFileSync(cofre.ARQUIVO, "utf8").trim();
    let ruim = conteudo;
    if (ruim === null) {
      ruim = rot.startsWith("adulterado")
        ? bom.slice(0, 200) + (bom[200] === "f" ? "0" : "f") + bom.slice(201)
        : bom.slice(0, Math.floor(bom.length / 2));
    }
    fs.writeFileSync(cofre.ARQUIVO, ruim, "utf8");
    cofre.esquecer();
    const e = await lanca(() => cofre.ler(), "leu um blob corrompido sem reclamar");
    verdade(e && e.message, "lançou sem mensagem");
  });
}

await ta("arquivo acima do teto é recusado sem tentar decifrar", async () => {
  fs.writeFileSync(cofre.ARQUIVO, "aa".repeat(cofre.TETO_ARQUIVO), "utf8");
  cofre.esquecer();
  const e = await lanca(() => cofre.ler());
  verdade(/teto/i.test(e.message), "a recusa não menciona o teto: " + e.message);
});

console.log("\n4. guardar: o que ele recusa");

/* A recusa tem que NOMEAR a causa, e as duas causas sao diferentes: texto vazio
   e um erro de digitacao de quem colou; `null` e um bug de quem chamou. Juntar as
   duas numa frase so ("vazia") mandaria quem le procurar no campo da tela um
   defeito que esta no codigo. */
for (const [rot, v, esperado] of [
  ["vazia", "", /vazia/i],
  ["só espaço", "   ", /vazia/i],
  ["nula", null, /texto/i],
  ["indefinida", undefined, /texto/i],
  ["número", 42, /texto/i],
  ["objeto", { chave: "x" }, /texto/i]
]) {
  await ta("recusa chave " + rot + ", nomeando a causa", async () => {
    const e = await lanca(() => cofre.guardar(v));
    verdade(esperado.test(e.message), "a recusa não nomeia a causa: " + e.message);
  });
}

await ta("recusa chave absurdamente grande, sem citá-la", async () => {
  const enorme = "z".repeat(9000);
  const e = await lanca(() => cofre.guardar(enorme));
  verdade(!e.message.includes(enorme.slice(0, 50)), "o valor entrou na mensagem");
  verdade(/tamanho/i.test(e.message), "a recusa não fala de tamanho: " + e.message);
});

await ta("espaço em volta é aparado antes de cifrar", async () => {
  await cofre.guardar("  " + FALSA + "\n");
  cofre.esquecer();
  igual(await cofre.ler(), FALSA);
});

console.log("\n5. apagar");

await ta("apagar tira o arquivo e a memória", async () => {
  await cofre.guardar(FALSA);
  igual(await cofre.apagar(), true);
  igual(cofre.estado().temChave, false);
  igual(await cofre.ler(), null, "leu depois de apagar —");
});

await ta("apagar duas vezes não lança, só devolve false", async () => {
  igual(await cofre.apagar(), false);
});

console.log("\n6. onde o arquivo mora");

await ta("fora da pasta do cockpit — a atualização não pode levá-lo junto", async () => {
  const daqui = path.resolve(__dirname);
  const dele = path.resolve(cofre.ARQUIVO);
  verdade(!dele.startsWith(daqui + path.sep),
    "o cofre está DENTRO da pasta do cockpit: " + dele);
});

} finally {
  devolver();
  /* O `removeAllListeners("exit")` que estava aqui SAIU, e isso é a correção de um
     defeito medido em 24/08/2026, não arrumação.
   *
   * Este `finally` fecha o `try` da linha 76 — e os blocos `6b`, `6c` e `7` vêm
   * DEPOIS dele. Com o handler de saída removido aqui, o último `guardar()` desses
   * blocos (`cofre.guardar(JWT_OK)`) ficava no cofre de verdade da máquina depois
   * que o teste terminava. Conferido por hash: o cofre desta máquina carregava o
   * `JWT_OK` inventado deste arquivo, e não a chave do `.env`.
   *
   * Era inofensivo enquanto NADA lia o cofre. Deixou de ser no dia em que o
   * `n8n.js` passou a lê-lo com precedência sobre o `.env`: o cockpit mandaria uma
   * chave inventada para a instância, tomaria 401 em tudo, e a tela acusaria
   * "chave revogada" sobre uma chave que está certa — que é exatamente o pior
   * desfecho descrito no cabeçalho do `cofre.js`.
   *
   * Deixar o handler vivo é seguro porque `devolver()` é idempotente: restaura o
   * backup se havia um, apaga o arquivo se não havia. Ele roda de novo na saída do
   * processo e limpa o que os três blocos de baixo escreveram. */
}

console.log("");
console.log("6b. entrada que E string e mesmo assim nao pode ser a chave");

/* A classe do `[object Object]`, por outra porta: valor que passa no `typeof`,
   e cifrado com sucesso, volta identico na ida e volta — e mesmo assim nao e a
   chave. O n8n devolve 401 e a tela acusa "chave revogada", mandando trocar uma
   chave que estava certa.
   MEDIDO antes de escrever a regra: o `ReadToEnd` do PowerShell NAO trunca em
   `
`, ao contrario do que se poderia supor de um protocolo de linha. As cinco
   formas (LF, CRLF, espaco, tab, pontas) voltaram inteiras. Ou seja: o cofre
   guardaria a chave quebrada com fidelidade, e nenhum teste de ida e volta
   pegaria. Por isso a regra e na ENTRADA, nao na volta. */
const JWT_OK = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.YXNzaW5hdHVyYWludmVudGFkYQ";

/* Construídos por código de caractere, e não por escape numa string literal, de
   propósito: um `\n` escrito à mão neste arquivo é exatamente o tipo de coisa que
   uma ferramenta de edição transforma em quebra de linha de verdade no caminho —
   aconteceu três vezes montando este teste. `fromCharCode` não tem essa ambiguidade. */
const LF = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9);

for (const [rot, meio] of [["LF", LF], ["CRLF", CR + LF], ["espaço", " "], ["tab", TAB]]) {
  await ta("recusa " + rot + " no MEIO da chave, nomeando a causa", async () => {
    const quebrada = JWT_OK.slice(0, 20) + meio + JWT_OK.slice(20);
    const e = await lanca(() => cofre.guardar(quebrada),
      "guardou uma chave com " + rot + " no meio — o n8n vai recusar e a tela vai culpar a chave");
    verdade(/meio/i.test(e.message), "a recusa nao diz que o problema e no meio: " + e.message);
    verdade(!e.message.includes(JWT_OK.slice(0, 20)), "o valor entrou na mensagem");
  });
}

await ta("branco nas PONTAS e aparado, nao recusado — vem do colar", async () => {
  const r = await cofre.guardar(LF + "  " + JWT_OK + "  " + CR + LF);
  igual(r.forma, "jwt");
  cofre.esquecer();
  igual(await cofre.ler(), JWT_OK, "nao aparou as pontas —");
});

await ta("forma estranha AVISA e guarda, nunca recusa", async () => {
  /* Recusar por forma seria apostar que o formato do n8n nunca muda; no dia em
     que mudasse, o painel trancaria a pessoa fora da propria instancia. */
  const r = await cofre.guardar("https://ecommercepuro.app.n8n.cloud");
  igual(r.forma, "estranha", "nao avisou que a forma e estranha —");
  cofre.esquecer();
  igual(await cofre.ler(), "https://ecommercepuro.app.n8n.cloud", "recusou em vez de guardar —");
});

await ta("forma de JWT e reportada como jwt", async () => {
  const r = await cofre.guardar(JWT_OK);
  igual(r.forma, "jwt");
});

console.log("");
console.log("6c. `forma` nao pode virar contrato morto");

/* Apontado pela auditoria de seguranca, e a referencia dela e desta casa: o
   CLAUDE.md conta que `escreveNoN8n` carregou uma afirmacao falsa por muito
   tempo JUSTAMENTE porque ninguem lia o campo. Mentira em contrato morto e a
   que ninguem acha ate alguem comecar a ler.

   `forma` nasceu agora e nao tem consumidor: nenhuma tela le. Enquanto for
   assim, o aviso "isso nao tem cara de chave do n8n" NAO EXISTE — existe a
   intencao dele.

   Este caso e o alarme. Hoje ele passa de graca, porque a tela nem sabe que o
   cofre existe. No dia em que alguem ligar o cofre a tela e esquecer o aviso,
   ele fica VERMELHO — que e a unica forma de uma obrigacao sobreviver, porque
   prosa apodrece em silencio e teste nao. */
await ta("se a tela consome o cofre, ela tem que consumir `forma` junto", async () => {
  const tela = path.join(__dirname, "integracoes.html");
  let html; try { html = fs.readFileSync(tela, "utf8"); } catch { return; }
  const usaCofre = /cofre|temChave|guardarChave/.test(html);
  if (!usaCofre) return;   /* ainda nao ligado: nada a exigir */
  verdade(/\bforma\b/.test(html),
    "a tela ja le o cofre e NAO le `forma` — o aviso de chave com forma estranha "
    + "nao existe, so a intencao dele. Ou consome, ou tira o campo do modulo.");
});

await ta("o trim e explicito e nosso, nao um implicito do PowerShell", async () => {
  /* MEDIDO: `ConvertTo-SecureString` devolve o valor byte a byte, com todo o
     branco. Nao existe camada que apare sozinha, entao o `trim()` do modulo
     nao e redundante e nao pode ser removido por parecer. */
  const src = fs.readFileSync(path.join(__dirname, "cofre.js"), "utf8");
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "");
  verdade(/chave\.trim\(\)/.test(codigo), "o trim explicito sumiu do modulo");
  const iTrim = codigo.indexOf("chave.trim()");
  const iCifra = codigo.indexOf("await cifrar(");
  verdade(iTrim > -1 && iCifra > iTrim,
    "o trim tem que acontecer ANTES de cifrar, senao o blob guarda o branco e "
    + "um segundo leitor do mesmo arquivo obteria coisa diferente");
});

console.log("");
console.log("7. o cofre guarda uma CHAVE, nunca um caminho de executavel");

/* Trava recomendada pela auditoria de seguranca que rodou em paralelo, e o
   argumento dela derrubou o meu.
   Eu tinha dito que `CLAUDE_BIN` no `.env` nao e escalada, porque quem escreve
   ali ja tem a chave do n8n no mesmo arquivo. Isso confunde PERMISSAO EXIGIDA
   com CAPACIDADE GANHA: ler a chave do n8n da acesso a instancia; apontar
   `CLAUDE_BIN` para um executavel do atacante da execucao de codigo na maquina
   dela, com a credencial do Claude, o cofre decifravel e o disco inteiro junto.
   Transformar arquivo de dado em vetor de execucao e escalada de classe.
   E a cadeia se fecha na fatia seguinte: no minuto em que existir uma rota que
   escreve configuracao, um POST de outra aba poderia gravar um caminho de
   executavel que o servidor depois abre. Por isso o cofre guarda CHAVE e so
   chave, num arquivo proprio, e nunca caminho de programa. */
await ta("o modulo nao menciona CLAUDE_BIN nem caminho de executavel", async () => {
  const src = fs.readFileSync(path.join(__dirname, "cofre.js"), "utf8");
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "");   /* comentario explica a regra; nao a viola */
  verdade(!/CLAUDE_BIN/.test(codigo), "o codigo menciona CLAUDE_BIN");
  /* A invariante NAO e "a string .exe nao aparece" — o modulo abre
     `powershell.exe` de proposito, e a minha primeira versao deste caso reprovou
     por isso. A invariante e: o unico executavel aberto e um LITERAL, e nenhum
     caminho de programa vem de fora. */
  const exes = codigo.match(/["'][^"']*\.exe["']/g) || [];
  igual(exes, ['"powershell.exe"'], "abre outro executavel alem do powershell —");

  /* A invariante NAO e "o alvo do spawn e um literal" — a primeira versao deste
     caso dizia isso e reprovou quando o alvo virou uma CONSTANTE melhor: caminho
     absoluto do System32, em vez de `"powershell.exe"` solto resolvido pelo PATH.
     A invariante e: o alvo nao vem de FORA do modulo. Constante de modulo, sim;
     parametro de funcao ou entrada de chamador, nunca — porque ai um caminho de
     executavel escolhido por outro passaria a ser aberto por este processo. */
  const alvo = (codigo.match(/spawn\(\s*([A-Za-z_$][\w$]*)/) || [])[1];
  verdade(alvo, "nao achei o alvo do spawn");
  const decl = new RegExp("^const " + alvo + "\\s*=", "m");
  verdade(decl.test(codigo), "o alvo do spawn (" + alvo + ") nao e uma constante de modulo");
  verdade(/System32/i.test(codigo), "o caminho do powershell nao e absoluto — resolveria pelo PATH");

  /* E ele nao pode ser parametro de funcao nenhuma deste arquivo. */
  const comoParam = new RegExp("function[^(]*\\([^)]*\\b" + alvo + "\\b");
  verdade(!comoParam.test(codigo), alvo + " chega como parametro de alguma funcao");
});

await ta("o modulo nao escreve nada dentro da pasta do projeto", async () => {
  const src = fs.readFileSync(path.join(__dirname, "cofre.js"), "utf8");
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "");
  verdade(!/__dirname/.test(codigo), "o codigo usa __dirname — o cofre tem que morar fora do projeto");
  /* `\.env` solto casa com `process.env`, que e leitura de variavel de ambiente e
     nao tem nada a ver. A invariante e sobre o ARQUIVO `.env` — entao o padrao
     tem que excluir a propriedade. Falso positivo achado rodando o proprio teste. */
  verdade(!/(?<!process)\.env\b/.test(codigo),
    "o codigo toca o ARQUIVO .env, que e justo o que ele veio substituir");
});

await ta("guardar() so aceita string, nao objeto com caminho dentro", async () => {
  const e = await lanca(() => cofre.guardar({ chave: FALSA, bin: "C:\mal.exe" }));
  verdade(e && e.message, "aceitou um objeto sem reclamar");
});

/* A prova de que a limpeza aconteceu, e ela é um CASO, não um `console.log`.
 *
 * O defeito que este bloco existe para travar não era um teste vermelho: era um
 * teste VERDE que deixava sujeira no cofre da máquina. Nada apontava para ele, e
 * o sintoma só apareceria muito longe daqui — no dia em que o `n8n.js` começasse
 * a ler o cofre, como 401 em toda chamada, com a tela acusando a chave errada.
 *
 * Roda com `devolver()` explícito antes, porque afirmar o estado final e deixar a
 * limpeza para o handler de saída seria afirmar sobre o que ainda não aconteceu. */
devolver();
await ta("o teste NÃO deixou chave de teste no cofre da máquina", async () => {
  if (havia) {
    verdade(fs.existsSync(cofre.ARQUIVO), "o cofre que existia antes sumiu");
    verdade(Buffer.compare(fs.readFileSync(cofre.ARQUIVO), backup) === 0,
      "o cofre foi devolvido DIFERENTE do que era — byte a byte não bate");
  } else {
    verdade(!fs.existsSync(cofre.ARQUIVO),
      "não havia cofre antes e ficou um agora: " + cofre.ARQUIVO
      + " — com o `n8n.js` lendo o cofre, esta chave de teste ganharia do `.env`");
  }
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exitCode = falhou ? 1 : 0;

})();
