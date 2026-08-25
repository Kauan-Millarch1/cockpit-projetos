"use strict";
/* ambiente-test.js — a cerca de ambiente das sessoes headless.
 *
 * O defeito que este arquivo existe para travar foi MEDIDO em 24/08/2026: o
 * `claude-fix.js` montava o ambiente do filho com `{ ...process.env,
 * N8N_API_KEY: "" }`. O ambiente desta maquina tem 87 variaveis e o espalhamento
 * deixava passar 69 -- inclusive `CLAUDE_CODE_MESSAGING_TOKEN`, que e credencial
 * VIVA, e a cadeia `GIT_ASKPASS`, que aponta para o script que o git chama para
 * pedir senha. E a sessao que escreve patch em fluxo de producao.
 *
 * DUAS METADES, e a segunda e a que o handoff de 24/08 diz que costuma faltar:
 *   - a funcao faz a coisa certa (blocos 1 a 4)
 *   - o PRODUTO CHAMA a funcao (bloco 5)
 * "Teste que exercita a funcao e nao a ligacao: o produto deixa de passar o
 * argumento e nada fica vermelho."
 *
 * E a COMPANHEIRA POSITIVA de cada negativa (a licao que o `mutex-test.js` pagou):
 * provar que uma variavel NAO entra nao vale nada sem provar que as necessarias
 * ENTRAM -- senao `envLimpo` podia devolver `{}` e passar em tudo.
 *
 * De graca: nenhum spawn, nenhuma rede, nada escrito. `node ambiente-test.js`.
 */

const fs = require("node:fs");
const path = require("node:path");
const ambiente = require("./ambiente.js");

let ok = 0, falhas = 0;
function t(nome, cond) {
  if (cond) { ok++; console.log("  ok   " + nome); }
  else { falhas++; console.log("  FALHA " + nome); }
}

/* Fonte de ambiente sintetica. Nao usa `process.env` de proposito nos blocos de
   regra: o teste tem de valer numa maquina que nao tem `GIT_ASKPASS` setado. */
function ambienteFalso() {
  return {
    PATH: "C:\\Windows\\system32",
    APPDATA: "C:\\Users\\alguem\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\alguem\\AppData\\Local",
    USERPROFILE: "C:\\Users\\alguem",
    SYSTEMROOT: "C:\\Windows",
    TEMP: "C:\\Temp",
    /* as que vazavam */
    CLAUDE_CODE_MESSAGING_TOKEN: "88397e1b3ff8aaaabbbbccccddddeeee",
    GIT_ASKPASS: "c:\\Users\\alguem\\vscode\\askpass.sh",
    VSCODE_GIT_ASKPASS_MAIN: "c:\\Users\\alguem\\vscode\\askpass-main.js",
    VSCODE_GIT_ASKPASS_NODE: "C:\\Users\\alguem\\node.exe",
    VSCODE_GIT_ASKPASS_EXTRA_ARGS: "",
    COMPUTERNAME: "MAQUINA-DA-PESSOA",
    USERNAME: "alguem",
    N8N_API_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb",
    ANTHROPIC_API_KEY: "sk-ant-naodeveriaestaraqui0000000000",
    AWS_SECRET_ACCESS_KEY: "naodeveriaestaraqui",
    OPENAI_API_KEY: "sk-naodeveriaestaraqui00000000"
  };
}

/* ══════════════ 1. as 69 nao atravessam, e a lista e por NOME ═══════════════
 *
 * Confere QUAIS, nunca quantas. Contar seria a assercao errada: uma variavel
 * troca de lugar com outra e a contagem nao muda. */
console.log("\n── 1. o que NAO pode atravessar");

{
  const amb = ambiente.envLimpo({ entrada: ambienteFalso() });

  t("`CLAUDE_CODE_MESSAGING_TOKEN` nao atravessa — e credencial viva",
    !("CLAUDE_CODE_MESSAGING_TOKEN" in amb));
  t("`GIT_ASKPASS` nao atravessa", !("GIT_ASKPASS" in amb));
  t("`VSCODE_GIT_ASKPASS_MAIN` nao atravessa", !("VSCODE_GIT_ASKPASS_MAIN" in amb));
  t("`VSCODE_GIT_ASKPASS_NODE` nao atravessa", !("VSCODE_GIT_ASKPASS_NODE" in amb));
  t("`VSCODE_GIT_ASKPASS_EXTRA_ARGS` nao atravessa (vazia tambem e presenca)",
    !("VSCODE_GIT_ASKPASS_EXTRA_ARGS" in amb));
  t("`COMPUTERNAME` nao atravessa — identidade da maquina", !("COMPUTERNAME" in amb));
  t("`USERNAME` nao atravessa", !("USERNAME" in amb));
  t("`N8N_API_KEY` nao atravessa", !("N8N_API_KEY" in amb));

  /* Nenhum VALOR de segredo pode aparecer em lugar nenhum do objeto, nem como
     valor de outra chave. Varre serializado, que e o jeito de nao depender de
     acertar em qual chave o vazamento apareceria. */
  const texto = JSON.stringify(amb);
  t("nenhum valor de segredo aparece no objeto montado",
    !/88397e1b3ff8|sk-ant-|eyJhbGciOi|naodeveriaestaraqui/.test(texto));
}

/* ═══════════════ 2. a AUSENCIA de chave de API, que e a garantia ════════════
 *
 * "Uma variavel que nao existe nao precisa ser lembrada." Cegar com string vazia
 * seria outra coisa: a variavel existiria e bastaria alguem preenche-la. */
console.log("\n── 2. ausente, nao vazia");

{
  const amb = ambiente.envLimpo({ entrada: ambienteFalso() });
  t("`ANTHROPIC_API_KEY` esta AUSENTE do objeto", !("ANTHROPIC_API_KEY" in amb));
  t("...e nao presente-e-vazia, que e coisa diferente", amb.ANTHROPIC_API_KEY === undefined);
  t("`AWS_SECRET_ACCESS_KEY` ausente", !("AWS_SECRET_ACCESS_KEY" in amb));
  t("`OPENAI_API_KEY` ausente", !("OPENAI_API_KEY" in amb));
  t("`CLAUDE_CODE_USE_BEDROCK` nunca entra nem por allowlist",
    ambiente.ENV_NUNCA.test("CLAUDE_CODE_USE_BEDROCK"));
  t("`CLAUDE_CODE_USE_VERTEX` idem", ambiente.ENV_NUNCA.test("CLAUDE_CODE_USE_VERTEX"));
}

/* ═════════ 3. A COMPANHEIRA POSITIVA — sem ela, `{}` passaria em tudo ═══════
 *
 * Esta e a licao que o `mutex-test.js` pagou e que o relatorio de testes cegos
 * cobrou: uma assercao "X nao entra" sozinha e verde para uma funcao que nao
 * devolve nada. E aqui o preco de errar e concreto: a credencial OAuth do Claude
 * sai de `APPDATA`/`USERPROFILE`, entao uma allowlist estreita demais troca
 * "gasta o plano" por "nao autentica", e o sintoma nao nomeia o ambiente. */
console.log("\n── 3. o que TEM de atravessar");

{
  const fonte = ambienteFalso();
  const amb = ambiente.envLimpo({ entrada: fonte });

  t("`PATH` atravessa — sem ele o CLI nao roda", amb.PATH === fonte.PATH);
  t("`APPDATA` atravessa — e de onde sai a credencial OAuth", amb.APPDATA === fonte.APPDATA);
  t("`LOCALAPPDATA` atravessa", amb.LOCALAPPDATA === fonte.LOCALAPPDATA);
  t("`USERPROFILE` atravessa", amb.USERPROFILE === fonte.USERPROFILE);
  t("`SYSTEMROOT` atravessa", amb.SYSTEMROOT === fonte.SYSTEMROOT);
  t("`TEMP` atravessa", amb.TEMP === fonte.TEMP);
  t("o objeto nao esta vazio — a negativa acima nao passa por omissao",
    Object.keys(amb).length >= 6);

  /* E o inverso da allowlist tambem e fato observavel, para a medicao do
     cabecalho poder ser refeita noutra maquina sem reescrever a conta. */
  const fora = ambiente.vazariam(fonte);
  t("`vazariam()` nomeia o que ficou de fora", fora.includes("CLAUDE_CODE_MESSAGING_TOKEN"));
  t("...e nao acusa o que entrou", !fora.includes("APPDATA"));
}

/* ═════════════════ 4. a segunda camada, e o `extra` como porta ══════════════ */
console.log("\n── 4. a segunda camada");

{
  t("o entrypoint chega pelo `extra`",
    ambiente.envLimpo({ entrada: ambienteFalso(), extra: { CLAUDE_CODE_ENTRYPOINT: "cockpit" } })
      .CLAUDE_CODE_ENTRYPOINT === "cockpit");

  /* `extra` nao pode virar a porta dos fundos que a allowlist fechou na frente. */
  let lancou = false;
  try {
    ambiente.envLimpo({ entrada: ambienteFalso(), extra: { ANTHROPIC_API_KEY: "sk-ant-xxx" } });
  } catch (e) { lancou = /ANTHROPIC_API_KEY/.test(String(e.message)); }
  t("`extra` com nome proibido LANCA, e a mensagem nomeia a variavel", lancou);

  let lancou2 = false;
  try {
    ambiente.envLimpo({ entrada: ambienteFalso(), extra: { GIT_ASKPASS: "x" } });
  } catch { lancou2 = true; }
  t("`extra` com `GIT_ASKPASS` LANCA", lancou2);

  /* A prova de que a segunda camada e independente da primeira: mesmo que alguem
     acrescente um nome proibido a `ENV_ALLOW`, ele nao sai. Exercitado sobre a
     lista de verdade, temporariamente, e restaurado em `finally`. */
  const antes = ambiente.ENV_ALLOW.slice();
  try {
    ambiente.ENV_ALLOW.push("ANTHROPIC_API_KEY");
    const amb = ambiente.envLimpo({ entrada: ambienteFalso() });
    t("nome proibido acrescentado a `ENV_ALLOW` AINDA ASSIM nao sai",
      !("ANTHROPIC_API_KEY" in amb));
  } finally {
    ambiente.ENV_ALLOW.length = 0;
    for (const k of antes) ambiente.ENV_ALLOW.push(k);
  }
  t("a lista foi restaurada", ambiente.ENV_ALLOW.length === antes.length);

  /* E o caso acima nao dispensa este. Descoberto mutando: por `ANTHROPIC_API_KEY`
     dentro do `ENV_ALLOW` literal NAO muda comportamento nenhum, porque a segunda
     camada barra -- entao o mutante volta VERDE, e com razao. So que a lista e uma
     declaracao de INTENCAO: um nome proibido escrito ali significa que alguem
     tentou, e isso tem de ficar vermelho enquanto a intencao ainda esta na cabeca
     de quem escreveu, nao dois meses depois quando a segunda camada for mexida por
     outro motivo. As duas camadas continuam independentes; o que este caso trava e
     a lista deixar de ser coerente com ela mesma. */
  const proibidosNaLista = ambiente.ENV_ALLOW.filter(k => ambiente.ENV_NUNCA.test(k));
  t("nenhuma entrada da allowlist casa com `ENV_NUNCA`: "
    + (proibidosNaLista.join(", ") || "(nenhuma)"),
    proibidosNaLista.length === 0);
}

/* ══════════════════════ 5. A LIGACAO — o produto CHAMA ══════════════════════
 *
 * Medido sobre o fonte com os COMENTARIOS FORA. A licao e do `dossie-tela-test.js`:
 * um mutante apagou uma guarda inteira e dois casos continuaram verdes porque o
 * comentario que explicava a guarda carregava o nome que eles procuravam. Um teste
 * que casa dentro de comentario aprova a AUSENCIA da decisao que ele acha que esta
 * conferindo -- e aqui a decisao e a cerca de uma sessao que escreve em producao. */
console.log("\n── 5. a ligacao nos sitios de spawn");

function semComentario(arquivo) {
  return fs.readFileSync(path.join(__dirname, arquivo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* REESCRITO na fiacao do `ia.js`, e reescrito em vez de apagado.
 *
 * Ate aqui, os tres sitios de spawn chamavam `ambiente.envLimpo` diretamente, e
 * era isso que este bloco media. Eles nao chamam mais: quem monta o ambiente do
 * filho e o `ia.ambienteDaRodada`, que monta EM CIMA desta allowlist e e o unico
 * ponto do repositorio autorizado a acrescentar uma chave de API a uma sessao
 * headless (no modo `chave`, para um provedor de cada vez).
 *
 * Entao a cadeia ganhou um elo, e o que este bloco fixa agora e a cadeia
 * INTEIRA: os tres montam pelo adaptador, o adaptador monta pelo `ambiente.js`, e
 * nenhum dos tres monta por conta propria ao lado dele. Apagar o bloco teria
 * trocado uma garantia por nada; afrouxar a regex para aceitar os dois caminhos
 * teria deixado passar exatamente a volta da copia. */
for (const arq of ["claude-fix.js", "tester.js", "upgrade.js"]) {
  const s = semComentario(arq);
  t(arq + " monta o ambiente do filho pelo `ia.js`",
    /require\s*\(\s*["']\.\/ia(\.js)?["']\s*\)/.test(s));
  t(arq + " NAO monta o ambiente por conta propria, ao lado do adaptador",
    !/ambiente\s*\.\s*envLimpo\s*\(/.test(s));
  t(arq + " NAO espalha `process.env` no ambiente de um spawn",
    !/env\s*:\s*\{\s*\.\.\.\s*process\s*\.\s*env/.test(s));
  t(arq + " NAO redeclara a allowlist",
    !/const\s+ENV_ALLOW\s*=/.test(s));
}

{
  /* O elo do meio: o adaptador tem de continuar lendo ESTA lista. Sem este caso,
     o bloco acima passaria com um `ia.js` que montasse o ambiente do zero -- que
     e a copia de volta, so que num arquivo novo. */
  const s = semComentario("ia.js");
  t("ia.js requer o `ambiente.js`",
    /require\s*\(\s*["']\.\/ambiente(\.js)?["']\s*\)/.test(s));
  t("ia.js monta o ambiente do filho com `envLimpo`",
    /ambiente\s*\.\s*envLimpo\s*\(/.test(s));
  t("ia.js NAO redeclara a allowlist",
    !/const\s+ENV_ALLOW\s*=\s*\[/.test(s));
}

{
  /* E cada `spawn` do CLI tem de receber ambiente montado, nao heranca implicita.
     `spawn` sem a opcao `env` herda `process.env` INTEIRO -- que e o defeito
     original com outra roupa, e ele nao casaria com nenhuma regex acima. */
  for (const arq of ["claude-fix.js", "tester.js", "upgrade.js"]) {
    const s = semComentario(arq);
    const spawns = [...s.matchAll(/spawn\s*\(\s*CLAUDE_BIN[\s\S]{0,600}?\)\s*;/g)].map(m => m[0]);
    t(arq + " tem ao menos um spawn do CLI para conferir", spawns.length > 0);
    t(arq + ": todo spawn do CLI declara `env:`",
      spawns.every(b => /\benv\s*:/.test(b)));
    t(arq + ": e o `env:` de todo spawn sai de `ia.ambienteDaRodada`",
      spawns.every(b => /env\s*:\s*ia\s*\.\s*ambienteDaRodada\s*\(/.test(b)));
  }
}

/* ═══════════ 6. quantas copias da lista sobraram, e quais ═══════════════════
 *
 * Nao e assercao de contagem: e a lista NOMEADA do que ainda nao migrou, para a
 * divida ser visivel em vez de virar surpresa. `ia.js` nasceu nesta mesma leva e
 * `iso-check.js` e portao de build, nao produto. */
console.log("\n── 6. copias que sobraram, por nome");

{
  const todos = fs.readdirSync(__dirname).filter(f => f.endsWith(".js") && !f.endsWith("-test.js"));
  const comCopia = todos.filter(f => /const\s+ENV_ALLOW\s*=/.test(semComentario(f))).sort();
  const esperado = ["ambiente.js", "ia.js", "iso-check.js"];
  t("nenhum arquivo de produto fora do esperado redeclara a allowlist: "
    + (comCopia.join(", ") || "(nenhum)"),
    comCopia.every(f => esperado.includes(f)));
  t("o `ambiente.js` e um deles — ele e a fonte", comCopia.includes("ambiente.js"));
}

console.log("\n" + (falhas === 0
  ? "ambiente-test.js — " + ok + " ok, 0 falha(s)"
  : "ambiente-test.js — " + ok + " ok, " + falhas + " FALHA(S)"));
process.exit(falhas === 0 ? 0 : 1);
