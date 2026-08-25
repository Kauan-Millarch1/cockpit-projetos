"use strict";
/* O cofre da chave do n8n.
 *
 * Hoje a chave mora em `.env`, em texto puro, ao lado do `server.js`. Isso é
 * defensável enquanto o painel é do Kauan na máquina do Kauan. Deixa de ser no
 * minuto em que outra pessoa baixa o cockpit: ela teria que abrir um arquivo de
 * configuração com um editor de texto e reiniciar o programa — que é exatamente
 * a fricção que o passo a passo de download promete não existir.
 *
 * Aqui ela cola numa tela, e o valor é cifrado pelo DPAPI do Windows.
 *
 * ─────────────────────────────────────────────────────────────── por que DPAPI
 *
 * Cifrar com uma chave guardada ao lado do arquivo cifrado é teatro: quem pega
 * um pega o outro. As saídas honestas são duas — uma senha que só a pessoa sabe
 * (e que, esquecida, perde a chave) ou uma chave-mestra amarrada em algo que não
 * viaja com o arquivo. O Windows já tem a segunda pronta e é para isso que ela
 * existe: o DPAPI amarra o segredo na CONTA DE WINDOWS de quem cifrou. O arquivo
 * copiado para outra máquina, ou aberto por outro usuário da mesma máquina, não
 * decifra.
 *
 * ─────────────────────────────────────────── O TETO DISTO, escrito e não implícito
 *
 * DPAPI de escopo de usuário **não protege contra outro processo rodando na
 * MESMA conta de Windows**. Qualquer coisa que rode como ela decifra este
 * arquivo — inclusive um programa que ela mesma instalou sem querer.
 *
 * Isso não é defeito deste desenho, é o teto da primitiva, e está escrito aqui
 * porque a frase acima ("copiado para outra máquina não decifra") é verdadeira e
 * sugere mais proteção do que existe. O que este cofre resolve é o segredo em
 * TEXTO PURO num arquivo que viaja: `.env` copiado, pasta zipada, backup na
 * nuvem, print da tela, commit por engano. Contra malware que já roda como ela,
 * não resolve — e nada guardado nesta máquina resolveria, porque a chave tem que
 * estar decifrável para o painel usar.
 *
 * Quem quiser subir esse teto sai do DPAPI e entra em senha que só ela sabe,
 * digitada a cada sessão. Aí a proteção é real contra processo local e o preço é
 * que esquecer a senha perde a chave. É decisão do Kauan, não default meu.
 *
 * Sem dependência nova: `ConvertFrom-SecureString` e `ConvertTo-SecureString` do
 * PowerShell são a fachada do DPAPI. É por isso que este módulo abre um processo
 * em vez de chamar uma biblioteca — o projeto inteiro é "Node 22, zero
 * dependência", e um pacote nativo para cifrar uma linha torraria isso.
 *
 * MEDIDO nesta máquina, antes de escrever qualquer coisa aqui:
 *   - ida e volta devolve o valor idêntico;
 *   - o blob começa com `01000000d08c9ddf`, o cabeçalho do DPAPI;
 *   - a cifra em si custa 6 ms (o custo é abrir o PowerShell, ~800 ms);
 *   - e as QUATRO formas de corromper falham ALTO, nenhuma devolve valor errado
 *     em silêncio: adulterado no meio, truncado, lixo que não é hex, e vazio.
 *
 * Essa última é a que decide se isto presta. Um cofre que devolve chave errada
 * manda uma credencial inválida para o n8n e a tela acusa "chave revogada" —
 * mandando a pessoa trocar uma chave que estava certa.
 *
 * ───────────────────────────────────────────────────────── onde o arquivo mora
 *
 * FORA da pasta do cockpit, no perfil da pessoa. O passo a passo de atualização
 * promete que trocar de versão não toca na chave dela — e a atualização
 * substitui a pasta do programa. Guardar dentro seria quebrar essa promessa na
 * primeira atualização.
 *
 * ──────────────────────────────────────────────────────────────── o que NÃO faz
 *
 * Não valida a chave (isso é com o n8n), não a registra em log nenhum, e nunca
 * a põe numa mensagem de erro. Toda função aqui que falha diz o que falhou sem
 * citar o valor.
 *
 * ─────────────────────── O QUE ELE COBRE E O QUE ELE NÃO COBRE
 *
 * Ele cobre a cópia do segredo QUE MORA NESTE PROJETO — o `.env` ao lado do
 * `server.js`, que é a que viaja quando a pasta é zipada, copiada ou commitada.
 *
 * Ele NÃO cobre nenhuma outra cópia da mesma chave espalhada pela máquina.
 * Auditoria de segurança rodada em paralelo mediu, nesta máquina, a chave da
 * API do n8n replicada em DEZENAS de arquivos dentro de `~/.claude` — incluindo
 * o `CLAUDE.md` global, que TODA sessão de TODO projeto carrega. Cifrar aqui e
 * deixar aquilo lá é fechar uma porta com a janela aberta ao lado.
 *
 * Está escrito porque um módulo chamado `cofre` lê como se o segredo estivesse
 * contido, e ele não está. Se as chaves forem rotacionadas, **a nova tem que
 * nascer direto aqui**, sem passar pelo `.env` em momento nenhum.
 *
 * ────────────────────────────────── ISTO É SUBSTITUIÇÃO, NÃO ROTAÇÃO
 *
 * `guardar()` sobrescreve o arquivo e zera a memória. Não existe histórico, e
 * isso é deliberado: credencial velha guardada é um segundo alvo, com o
 * agravante de que ninguém a monitora.
 *
 * Mas trocar aqui **não revoga nada do lado do n8n**. A chave antiga continua
 * válida na instância para sempre, até alguém ir lá apagá-la. E o motivo de
 * trocar uma chave é quase sempre vazamento — caso em que trocar só aqui não
 * fecha porta nenhuma: quem tem a antiga continua entrando.
 *
 * Então **a tela que chamar `guardar()` tem obrigação de dizer isso**: a nova
 * está valendo aqui, a antiga continua ativa no n8n, e onde revogar (Settings →
 * n8n API, na instância). Sem essa frase a tela ensina que trocar resolveu, e a
 * pessoa sai dela achando que fechou uma porta que ficou aberta.
 *
 * É o mesmo defeito que o `APPLY_CAVEAT` do `flows.html` existe para não
 * cometer: aplicar não é prova de que a falha sumiu.
 *
 * O passo seguinte honesto — e que ainda NÃO existe — é o painel bater na
 * instância com a chave antiga e dizer se ela ainda responde. A frase paga a
 * maior parte; a verificação paga o resto.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

/* Só Windows por enquanto, e o módulo diz isso em vez de fingir. Num Mac o
   `chegou` responde `false` com motivo, e quem chama cai no `.env` de sempre. */
const EH_WINDOWS = process.platform === "win32";

const PASTA = path.join(os.homedir(), "AppData", "Roaming", "Cockpit");
const ARQUIVO = path.join(PASTA, "n8n.dat");

/* Teto de leitura: o blob de uma chave de 207 caracteres deu 876 chars. 64 KB é
   folga de sobra e barra um arquivo trocado por lixo grande. */
const TETO_ARQUIVO = 64 * 1024;

/* Abrir o PowerShell custa ~800ms. Um teto de 20s é generoso para isso e ainda
   mata uma máquina em que ele pendurou — sem teto, a rota que lê a chave
   penduraria junto. */
const TETO_MS = 20000;

/* Caminho ABSOLUTO, não `"powershell.exe"` solto. Sem caminho, o Windows resolve
   pelo `PATH` — e num processo cujo `PATH` a pessoa controla isso é vetor. O teto
   é o mesmo do DPAPI declarado acima (quem mexe no seu `PATH` de usuário já roda
   como você), então não é buraco novo; mas fechar custa uma constante, e também
   tira a chance de pegar um `powershell.exe` que esteja no diretório de trabalho.
   Sugestão da auditoria de segurança que rodou em paralelo. */
const POWERSHELL = path.join(process.env.SystemRoot || "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

/* O valor decifrado vive em memória pelo tempo do processo. Sem isto toda
   chamada ao n8n pagaria 800ms de PowerShell, o que é inaceitável num painel que
   consulta a instância a cada 20 segundos. */
let memoria = null;

/* ------------------------------------------------------------------ mecânica
   Uma observação que vale a leitura: o segredo NUNCA vai na linha de comando.
   Argumento de processo é visível para qualquer um que liste os processos da
   máquina — e num painel que existe para não vazar credencial, mandar a chave
   por ali seria o mesmo defeito que ele evita em todo lugar. Vai pelo stdin. */
function ps(script, entrada) {
  /* `spawn` e não `execFile`: a opção `input` do `child_process` só existe nas
     versões SÍNCRONAS. No `execFile` assíncrono ela é ignorada em silêncio — o
     script lê stdin vazio e o PowerShell recusa a string vazia, com um erro que
     não menciona stdin nem `input` e manda procurar defeito no script. Medido
     aqui: foi exatamente assim que a primeira versão deste arquivo quebrou. */
  return new Promise((resolve, reject) => {
    const ch = spawn(POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    let out = "", err = "", pronto = false;
    const fim = (e, r) => { if (pronto) return; pronto = true; clearTimeout(t); e ? reject(e) : resolve(r); };
    const t = setTimeout(() => {
      try { ch.kill(); } catch { /* já morreu */ }
      fim(new Error("o PowerShell não respondeu em " + Math.round(TETO_MS / 1000) + "s"));
    }, TETO_MS);

    ch.stdout.on("data", d => { out += d.toString("utf8"); });
    ch.stderr.on("data", d => { err += d.toString("utf8"); });
    ch.on("error", e => fim(new Error("não consegui abrir o PowerShell: " + (e && e.message))));
    ch.on("close", code => {
      if (code !== 0) {
        /* A mensagem do PowerShell entra porque ela nomeia a causa (blob
           inválido, conta errada). Ela NUNCA contém o segredo: o valor foi por
           stdin e o script não o imprime em erro nenhum. */
        return fim(new Error("o cofre recusou (código " + code + "): " + err.trim().split("\n")[0]));
      }
      fim(null, { stdout: out });
    });

    ch.stdin.on("error", () => { /* fechado do outro lado; o `close` decide */ });
    ch.stdin.end(entrada, "utf8");
  });
}

async function cifrar(valor) {
  const { stdout } = await ps(
    "$s = [Console]::In.ReadToEnd();" +
    "ConvertTo-SecureString $s -AsPlainText -Force | ConvertFrom-SecureString",
    valor);
  const blob = String(stdout).trim();
  if (!/^[0-9a-fA-F]{32,}$/.test(blob)) {
    throw new Error("a cifra não devolveu um blob no formato esperado");
  }
  return blob;
}

async function decifrar(blob) {
  const { stdout } = await ps(
    "$b = [Console]::In.ReadToEnd().Trim();" +
    "$ss = ConvertTo-SecureString $b;" +
    "$p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss);" +
    "[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringAuto($p));" +
    "[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)",
    blob);
  return String(stdout);
}

/* --------------------------------------------------------------------- porta */

/* Fato, nunca juízo: o cofre existe nesta máquina? há algo guardado? A tela
   decide o que dizer com isso. */
/* Fato sobre a FORMA, não veredito sobre a validade: quem diz se a chave vale é
   o n8n, e este módulo nunca finge saber isso. */
function pareceChave(v) {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
}

function estado() {
  if (!EH_WINDOWS) {
    return { disponivel: false, porque: "o cofre usa o DPAPI do Windows, e esta máquina não é Windows.", temChave: false, onde: null };
  }
  let temChave = false;
  try { temChave = fs.statSync(ARQUIVO).size > 0; } catch { /* não existe: temChave fica false */ }
  return { disponivel: true, porque: null, temChave, onde: ARQUIVO };
}

async function guardar(chave) {
  if (!EH_WINDOWS) throw new Error("o cofre só existe no Windows por enquanto");
  /* String e só string, e isto é defeito achado por teste, não zelo.
     A primeira versão fazia `String(chave)`, e `String({})` é `"[object
     Object]"` — não-vazio, dentro do teto, então o cofre CIFRAVA isso como se
     fosse a chave. Depois ela sairia para o n8n, voltaria 401, e a tela acusaria
     "chave revogada": exatamente o pior caso que o cabeçalho deste arquivo
     descreve, mandando a pessoa trocar uma chave que estava certa.
     Um objeto chegando aqui é bug de quem chamou, e bug de chamador tem que
     falhar alto no lugar onde nasceu. */
  if (typeof chave !== "string") {
    throw new Error("a chave tem que ser texto, veio " + (chave === null ? "null" : typeof chave));
  }
  const v = chave.trim();
  if (!v) throw new Error("chave vazia");

  /* Branco NO MEIO é recusado, branco nas PONTAS é aparado — e as duas coisas
     têm causas diferentes, então têm tratamentos diferentes.
     Ponta é o colar: copiar de página web ou de e-mail traz `\n` ou espaço no
     fim com frequência alta. Aparar é a única leitura possível do que a pessoa
     quis, então aparar em silêncio aqui é seguro.
     Meio é outra coisa. Nenhum espaço em branco é válido dentro de um JWT, em
     posição nenhuma — então um `\n` no meio é quebra de linha do editor, chave
     colada pela metade, ou dois valores grudados. MEDIDO: o cofre guarda isso
     INTEIRO e sem reclamar (o `ReadToEnd` do PowerShell não trunca, ao contrário
     do que se poderia supor de um protocolo de linha), e a ida e volta bate —
     então nenhum teste de round-trip pega. O defeito só aparece no n8n, como
     401, e a tela acusa "chave revogada": a pessoa troca uma chave que estava
     certa. É o mesmo desfecho do `[object Object]`, por outra porta. */
  if (/\s/.test(v)) {
    throw new Error("a chave tem espaço ou quebra de linha no meio — uma chave do n8n não tem. Confira se ela veio colada inteira.");
  }
  if (v.length > 8000) throw new Error("chave com tamanho fora do razoável");
  /* O valor não aparece nesta mensagem, nem no log, nem em lugar nenhum. */
  const blob = await cifrar(v);
  await fsp.mkdir(PASTA, { recursive: true });
  /* Temporário + rename, como todo write deste projeto: um processo morto no
     meio deixaria o arquivo pela metade, e um blob pela metade não decifra —
     a pessoa perderia a chave por causa de uma queda de energia. */
  const tmp = ARQUIVO + ".tmp";
  /* `mode: 0o600` é INERTE no Windows — provado com sonda pela auditoria, não
     deduzido. O arquivo NÃO ganha ACL restritiva com isto; quem protege é o
     DPAPI, sozinho. A linha fica porque num dia em que este módulo rodar noutro
     sistema ela vale, e porque removê-la não adiciona proteção nenhuma — mas
     está escrito aqui que ela não é uma segunda camada, para o próximo leitor
     não contar duas onde existe uma. Endurecer a ACL de verdade seria
     `icacls /inheritance:r`, e é decisão separada. */
  await fsp.writeFile(tmp, blob, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(tmp, ARQUIVO);
  memoria = v;
  /* A FORMA é aviso, nunca recusa. Uma chave do n8n é um JWT — três segmentos
     base64url separados por ponto, começando em `eyJ`. Recusar por forma seria
     apostar que esse formato nunca muda, e o dia em que mudasse o painel travaria
     a pessoa fora da própria instância. Então guarda e AVISA: a tela transforma
     isso em "isso não tem cara de chave do n8n — confere se você não colou a URL
     por engano", que é infinitamente mais útil que esperar o 401. */
  /* `revogacaoManual` existe para a obrigação abaixo deixar de ser prosa.
     O cabeçalho diz que a tela TEM que avisar que a chave antiga segue ativa no
     n8n — e prosa apodrece em silêncio, porque nada fica vermelho quando alguém
     esquece. Como campo do contrato, a ausência do consumidor é aferível por
     teste, que é a disciplina que o `dono-test.js` já usa para os pontos de
     escrita em vez de confiar no comentário. */
  return {
    onde: ARQUIVO, bytes: blob.length,
    forma: pareceChave(v) ? "jwt" : "estranha",
    revogacaoManual: true
  };
}

/* Devolve a chave ou `null`. NUNCA lança por ausência — não ter chave guardada é
   um estado normal, não um erro. Lança só quando existe um arquivo e ele não
   decifra, que é a situação em que ficar calado seria pior: a tela precisa poder
   dizer "tem um cofre aqui e ele não abre" em vez de "não tem chave". */
async function ler() {
  if (memoria !== null) return memoria;
  if (!EH_WINDOWS) return null;
  let blob;
  try {
    const st = await fsp.stat(ARQUIVO);
    if (st.size === 0) return null;
    if (st.size > TETO_ARQUIVO) throw new Error("o arquivo do cofre está maior que o teto");
    blob = (await fsp.readFile(ARQUIVO, "utf8")).trim();
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  if (!blob) return null;
  const v = (await decifrar(blob)).trim();
  if (!v) throw new Error("o cofre abriu e veio vazio");
  memoria = v;
  return v;
}

async function apagar() {
  memoria = null;
  try { await fsp.unlink(ARQUIVO); return true; }
  catch (err) { if (err && err.code === "ENOENT") return false; throw err; }
}

/* Para o teste e para quem trocar a chave: esquece o que está em memória sem
   apagar o arquivo. */
function esquecer() { memoria = null; }

module.exports = {
  estado, guardar, ler, apagar, esquecer, pareceChave,
  /* expostos para o teste medir sem adivinhar caminho */
  ARQUIVO, PASTA, TETO_ARQUIVO, EH_WINDOWS
};
