"use strict";
/* ia-test.js — o adaptador que decide QUAL IA e COM QUAL CREDENCIAL a rodada roda.
 *
 * De graça: nenhum modelo, nenhuma rede, nenhum spawn, nada escrito no
 * repositório, nada que alcance o n8n. `node ia-test.js`.
 *
 * O CASO QUE CARREGA O ARQUIVO é o bloco 5: um provedor SEM equivalente de flag
 * de cerca tem que ser RECUSADO, nunca spawnado sem cerca. Todo o resto deste
 * arquivo é sobre não vazar chave e não deixar o gasto sair do lugar escolhido;
 * esse é sobre a sessão não ganhar shell nem a configuração global de quem
 * instalou o painel.
 *
 * TRÊS DISCIPLINAS QUE ESTE ARQUIVO SEGUE POR LIÇÃO JÁ PAGA NESTE REPOSITÓRIO:
 *
 * 1. AUSÊNCIA DE PROPRIEDADE, não valor falso. O caso 1.1 afere
 *    `!("ANTHROPIC_API_KEY" in amb)`. Um `assert.strictEqual(amb.X, undefined)`
 *    passaria com a propriedade presente e vazia, que é justamente o defeito.
 *
 * 2. CONFERIR QUAIS, NUNCA QUANTAS. O bloco 6 afere flag por flag, por nome.
 *    Contar argumentos é a asserção errada: a cerca migra de posição, ou uma flag
 *    é trocada por outra, e a contagem não muda.
 *
 * 3. FIAÇÃO MEDIDA SOBRE FONTE SEM COMENTÁRIO. `dossie-tela-test.js` já teve dois
 *    casos ficarem VERDES porque um comentário carregava o nome que o `includes`
 *    procurava — um teste que casa dentro de comentário aprova a AUSÊNCIA da
 *    decisão. Aqui os comentários são exatamente onde os nomes das flags mais
 *    aparecem, então medir o fonte cru seria garantir o falso verde.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ia = require("./ia.js");

let ok = 0;
const falhas = [];
function t(nome, fn) {
  try { fn(); ok++; }
  catch (e) { falhas.push(nome + "\n      " + String((e && e.message) || e).split("\n")[0]); }
}

/* Fonte sem comentário. Tira `/* … *​/` e `// …`. */
function fonteLimpa(arquivo) {
  const bruto = fs.readFileSync(path.join(__dirname, arquivo), "utf8");
  return bruto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* Busca no fonte que FALHA ALTO. Sem isto, renomear o alvo transforma todo caso
   seguinte em asserção sobre nada — o defeito que o `cofre-test.js` pagou. */
function precisa(fonte, agulha, onde) {
  if (fonte.indexOf(agulha) < 0) {
    throw new Error("não achei `" + agulha + "` em " + onde
      + " — ou a fiação sumiu, ou o alvo foi renomeado e este teste ficou cego");
  }
  return true;
}

/* Uma chave de API DE VERDADE na forma, e falsa no valor. Ela é o "valor com cara
   de credencial" que os casos 8.x empurram por todo lugar onde um eco existe. */
const CHAVE_FALSA = "sk-ant-api03-" + "Zx9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890abcdefGHIJKL";
const JWT_FALSO = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.aaaaaaaaaaaa";

/* Um ambiente base plausível: tem o que o allowlist deixa passar e tem também o
   que ele NÃO pode deixar passar. Se o segundo grupo não estivesse aqui, os casos
   1.x e 2.x passariam trivialmente por o objeto de origem estar limpo. */
function baseSuja(extra) {
  return Object.assign({
    PATH: "C:\\bin", TEMP: "C:\\tmp", USERPROFILE: "C:\\Users\\x", LANG: "pt_BR",
    ANTHROPIC_API_KEY: CHAVE_FALSA,
    OPENAI_API_KEY: "sk-proj-" + "0123456789abcdef0123456789abcdef0123",
    ANTHROPIC_AUTH_TOKEN: JWT_FALSO,
    ANTHROPIC_BASE_URL: "https://proxy.exemplo/v1",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    N8N_API_KEY: JWT_FALSO
  }, extra || {});
}

/* Tudo que a rodada devolve e que PODE ser impresso. `args` fica de fora de
   propósito e com um caso próprio (8.2): o prompt está lá porque é o que o spawn
   recebe, e o que se imprime é `argumentosParaLog`. */
function textosDe(o) {
  const fora = [];
  const anda = (v, cam) => {
    if (typeof v === "string") { fora.push(cam + " = " + v); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => anda(x, cam + "[" + i + "]")); return; }
    if (v && typeof v === "object") { for (const k of Object.keys(v)) anda(v[k], cam + "." + k); }
  };
  anda(o, "");
  return fora;
}

/* ══════════ bloco 1 — modo plano: a chave está AUSENTE, não vazia ═══════════ */

t("1.1 modo plano: a propriedade da chave não existe no objeto de ambiente", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  assert.strictEqual(e.ok, true, e.porque || "");
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  /* A asserção é `in`, não `=== undefined`. Presente-e-vazia é uma variável que
     existe: pode ser lida, logada e herdada, e faz um CLI achar que foi
     configurado com chave em branco em vez de usar o login. */
  assert.ok(!("ANTHROPIC_API_KEY" in amb),
    "ANTHROPIC_API_KEY existe como propriedade do ambiente do filho");
  assert.ok(!Object.prototype.hasOwnProperty.call(amb, "ANTHROPIC_API_KEY"));
  assert.ok(!Object.keys(amb).includes("ANTHROPIC_API_KEY"));
});

t("1.2 modo plano: nenhuma variável de chave de NENHUM provedor entra", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  for (const p of Object.keys(ia.PROVEDORES)) {
    const v = ia.PROVEDORES[p].envChave;
    assert.ok(!(v in amb), "modo plano deixou passar " + v);
  }
});

t("1.3 modo plano: os interruptores de Bedrock/Vertex e o proxy ficam de fora", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  for (const k of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
                   "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
    assert.ok(!(k in amb), k + " chegou ao filho — o gasto sairia do lugar errado");
  }
});

t("1.4 a chave do n8n nunca vai para a sessão", () => {
  /* Não é sobre custo: é a chave que o `iso-check.js` mediu no CLAUDE.md global.
     A sessão não faz chamada nenhuma ao n8n — o cockpit faz. */
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  assert.ok(!("N8N_API_KEY" in amb));
  assert.ok(!Object.values(amb).some(v => String(v).includes(JWT_FALSO)));
});

t("1.5 modo plano é o PADRÃO quando ninguém disse, e o retorno declara isso", () => {
  const e = ia.escolher({ provedor: "claude", env: baseSuja() });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.modo, "plano");
  assert.strictEqual(e.padrao.modo, true, "o padrão tem de ser visível no retorno");
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  assert.ok(!("ANTHROPIC_API_KEY" in amb), "o padrão caiu no lado que gasta cartão");
});

t("1.6 provedor ausente também cai num padrão EXPLÍCITO, nunca em silêncio", () => {
  const e = ia.escolher({ env: baseSuja() });
  assert.strictEqual(e.ok, true, e.porque || "");
  assert.strictEqual(e.provedor, ia.PADRAO_PROVEDOR);
  assert.strictEqual(e.padrao.provedor, true);
  /* E o padrão é o único provedor com as três cercas — errar aqui teria de
     errar para o lado cercado. */
  assert.deepStrictEqual(ia.cercasQueFaltam(e.provedor), []);
});

/* ═══════ bloco 2 — modo chave: entra a do provedor, e SÓ a do provedor ══════ */

t("2.1 modo chave: a variável do provedor escolhido entra", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: baseSuja() });
  assert.strictEqual(e.ok, true, e.porque || "");
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  assert.strictEqual(amb.ANTHROPIC_API_KEY, CHAVE_FALSA);
});

t("2.2 modo chave: a variável dos OUTROS provedores NÃO entra", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: baseSuja() });
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  const outros = Object.keys(ia.PROVEDORES)
    .filter(p => p !== "claude").map(p => ia.PROVEDORES[p].envChave);
  assert.ok(outros.length > 0, "o teste só prova algo se houver outro provedor na tabela");
  for (const v of outros) {
    assert.ok(!(v in amb), "a chave de outro provedor (" + v + ") foi entregue a este binário");
  }
});

t("2.3 modo chave: os interruptores de Bedrock/Vertex continuam fora", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: baseSuja() });
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  for (const k of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_BASE_URL"]) {
    assert.ok(!(k in amb), k + " entrou junto com a chave");
  }
});

t("2.4 modo chave: a chave passada por parâmetro vence a do ambiente", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: baseSuja() });
  const outra = "sk-ant-api03-" + "OUTRAoutraOUTRAoutraOUTRAoutra1234567890abcd";
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e, chave: outra });
  assert.strictEqual(amb.ANTHROPIC_API_KEY, outra);
});

t("2.5 a base do ambiente vem do ambiente.js, nao de uma copia local", () => {
  /* Medido 24/08/2026: a allowlist chegou a existir em CINCO arquivos identicos.
     Este seria o sexto. O `ambiente.js` e folha e ja e a fonte dos quatro sitios
     de spawn; se `ia.js` mantivesse a propria lista, a divergencia apareceria na
     primeira correcao feita de um lado so, e o lado que divergisse seria uma
     sessao sem cerca. */
  const f = fonteLimpa("ia.js");
  precisa(f, 'require("./ambiente.js")', "ia.js");
  precisa(f, "ambiente.envLimpo(", "ia.js");
  assert.ok(!/const\s+ENV_ALLOW\s*=/.test(f), "ia.js criou uma copia local da allowlist");

  /* E o resultado tem de ser mesmo o de la, chave por chave, tirando o que este
     modulo acrescenta de proposito. */
  const amb = require("./ambiente.js");
  const base = baseSuja();
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: base });
  const meu = ia.ambienteDaRodada({ base, escolha: e });
  const dele = amb.envLimpo({ entrada: base });
  for (const k of Object.keys(dele)) {
    assert.strictEqual(meu[k], dele[k], "divergiu em " + k);
  }
  const aMais = Object.keys(meu).filter(k => !(k in dele));
  assert.deepStrictEqual(aMais, ["CLAUDE_CODE_ENTRYPOINT"],
    "ia.js acrescentou algo ao ambiente alem do carimbo de quem spawnou: " + aMais.join(", "));
});

t("2.6 no modo chave, o UNICO acrescimo alem do carimbo e a chave do provedor", () => {
  const amb = require("./ambiente.js");
  const base = baseSuja();
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: base });
  const meu = ia.ambienteDaRodada({ base, escolha: e });
  const dele = amb.envLimpo({ entrada: base });
  const aMais = Object.keys(meu).filter(k => !(k in dele)).sort();
  assert.deepStrictEqual(aMais, ["ANTHROPIC_API_KEY", "CLAUDE_CODE_ENTRYPOINT"].sort(), aMais.join(", "));
});

t("2.7 a chave NAO entra pelo `extra` do ambiente.js (ele lanca, e faz bem)", () => {
  /* `extra` e o ponto por onde QUALQUER caminho acrescenta coisa; uma excecao
     generica ali valeria para todos eles. Este caso fixa que a recusa de la
     continua de pe, para que o buraco deliberado siga sendo esta uma linha. */
  const amb = require("./ambiente.js");
  assert.throws(() => amb.envLimpo({ entrada: { PATH: "x" }, extra: { ANTHROPIC_API_KEY: CHAVE_FALSA } }),
    /ANTHROPIC_API_KEY/);
});

/* ═════ bloco 3 — modo chave sem chave: recusa que NOMEIA a variável ═════════ */

t("3.1 modo chave sem a variável no ambiente: recusa", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: { PATH: "C:\\bin" } });
  assert.strictEqual(e.ok, false);
});

t("3.2 a mensagem NOMEIA a variável que falta", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: { PATH: "C:\\bin" } });
  assert.ok(/ANTHROPIC_API_KEY/.test(e.porque),
    "a recusa não nomeia a variável, então não há o que fazer com ela: " + e.porque);
  assert.strictEqual(e.envChave, "ANTHROPIC_API_KEY");
});

t("3.3 chave presente mas só com espaço é igual a ausente", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: { ANTHROPIC_API_KEY: "   " } });
  assert.strictEqual(e.ok, false);
  assert.ok(/ANTHROPIC_API_KEY/.test(e.porque));
});

t("3.4 ambienteDaRodada RECUSA montar ambiente para uma escolha recusada", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: {} });
  assert.throws(() => ia.ambienteDaRodada({ base: baseSuja(), escolha: e }),
    /recusada/, "montou ambiente em cima de uma escolha que não passou");
});

t("3.5 a recusa por falta de chave não repete o valor de chave nenhuma", () => {
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: { ANTHROPIC_API_KEY: "" } });
  for (const linha of textosDe(e)) {
    assert.ok(!linha.includes(CHAVE_FALSA) && !linha.includes(JWT_FALSO), linha);
  }
});

/* ═════════ bloco 4 — provedor desconhecido: recusa e ZERO ida ao disco ══════ */

t("4.1 provedor desconhecido é recusado", () => {
  const e = ia.escolher({ provedor: "gemini", modo: "plano", env: baseSuja() });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.provedor, null);
});

t("4.2 a recusa cita o valor CRU", () => {
  const e = ia.escolher({ provedor: "gemini", modo: "plano", env: baseSuja() });
  assert.ok(/gemini/.test(e.porque), "sem o valor cru a tela não pode dizer o que ignorou: " + e.porque);
  assert.strictEqual(e.cru.provedor, "gemini");
});

t("4.3 descobrir() NUNCA consulta o disco para um provedor desconhecido", () => {
  /* O `existe` injetado é o espião. Um provedor de fora que virasse caminho de
     arquivo é o primeiro passo para virar spawn, que é execução de código
     arbitrário na máquina de quem instalou o painel. */
  const vistos = [];
  const r = ia.descobrir("gemini", { existe: p => { vistos.push(p); return true; } });
  assert.strictEqual(vistos.length, 0, "consultou o disco: " + vistos.join(", "));
  assert.strictEqual(r.achado, null, "não-procurei tem de ser null, nunca false");
  assert.strictEqual(r.caminho, null);
  assert.deepStrictEqual(r.candidatos, []);
});

t("4.4 nem com um caminho absoluto disfarçado de provedor", () => {
  const vistos = [];
  const r = ia.descobrir("C:\\Users\\x\\malware.exe", { existe: p => { vistos.push(p); return true; } });
  assert.strictEqual(vistos.length, 0);
  assert.strictEqual(r.achado, null);
});

t("4.5 provedor não-string é recusado sem virar `[object Object]`", () => {
  const e = ia.escolher({ provedor: { toString: () => "claude" }, modo: "plano", env: baseSuja() });
  assert.strictEqual(e.ok, false, "um objeto com toString() entrou como se fosse o nome");
  assert.ok(/object/.test(e.porque), e.porque);
});

t("4.6 descobrir(): os três estados existem e são distinguíveis", () => {
  const cfg = ia.PROVEDORES.claude;
  const achei = ia.descobrir("claude", { existe: () => true, plataforma: "win32", env: {}, casa: "C:\\h" });
  assert.strictEqual(achei.achado, true);
  assert.ok(achei.caminho);

  /* Apontou e não está lá: `false` de verdade, porque houve afirmação medida. */
  const naoTem = ia.descobrir("claude", {
    existe: () => false, plataforma: "win32", casa: "C:\\h",
    env: { [cfg.envBin]: "C:\\nada\\claude.exe" }
  });
  assert.strictEqual(naoTem.achado, false);
  assert.ok(new RegExp(cfg.envBin).test(naoTem.porque), naoTem.porque);

  /* Nada achado e sem apontamento: sobra o PATH, sobre o qual `existsSync` não
     responde. Hoje o claude-fix.js devolve `false` neste caso — uma afirmação
     que ninguém mediu. */
  const soPath = ia.descobrir("claude", { existe: () => false, plataforma: "win32", env: {}, casa: "C:\\h" });
  assert.strictEqual(soPath.achado, null, "o caso do PATH não pode virar `não está nesta máquina`");
  assert.ok(/PATH/.test(soPath.porque), soPath.porque);
});

/* ── 4.8 a 4.14: o valor de `CLAUDE_BIN`/`CODEX_BIN` é um CAMINHO, e é validado
 *
 * O DEFEITO: esse valor vem do ambiente OU do `.env` do diretório — e neste
 * projeto o `.env` GANHA do `process.env` (medido, já custou um `PUT` real na
 * instância de produção). Ele entrava PRIMEIRO em `candidatos`, e o que sai
 * daqui é o primeiro argumento do `spawn()` no `claude-fix.js`, no `upgrade.js` e
 * no `tester.js`. Quem escrevesse UMA linha num `.env` escolhia o executável que
 * o cockpit roda — com a conta que pode gravar num fluxo vivo do n8n. */

t("4.8 um NOME NU em CLAUDE_BIN não vira candidato — quem resolve nome nu é o PATH", () => {
  const vistos = [];
  const r = ia.descobrir("claude", {
    existe: p => { vistos.push(p); return true; },
    plataforma: "win32", casa: "C:\\h", env: { CLAUDE_BIN: "claude.exe" }
  });
  assert.strictEqual(r.achado, false, "aceitou um nome nu como caminho de executável");
  assert.strictEqual(r.caminho, null, "um caminho recusado não pode sair como caminho");
  /* O espião é o que separa "recusei" de "recusei depois de olhar": a validação
     tem de vir ANTES do disco, que é o passo anterior ao spawn. */
  assert.strictEqual(vistos.length, 0, "consultou o disco mesmo assim: " + vistos.join(", "));
});

t("4.9 um caminho RELATIVO também não — o cwd do processo é escolhido por quem abre o painel", () => {
  for (const mau of [".\\evil.exe", "..\\..\\evil.exe", "bin/claude"]) {
    const r = ia.descobrir("claude", {
      existe: () => true, plataforma: "win32", casa: "C:\\h", env: { CLAUDE_BIN: mau }
    });
    assert.strictEqual(r.achado, false, "aceitou o relativo " + JSON.stringify(mau));
    assert.strictEqual(r.caminho, null, "devolveu caminho para " + JSON.stringify(mau));
  }
});

t("4.10 caractere de controle é recusado, e o valor NÃO é ecoado de volta", () => {
  const r = ia.descobrir("claude", {
    existe: () => true, plataforma: "win32", casa: "C:\\h",
    env: { CLAUDE_BIN: "C:\\ok\\claude\u0000.exe" }
  });
  assert.strictEqual(r.achado, false);
  assert.strictEqual(r.caminho, null);
  /* Repetir o byte invisível na frase é levar o defeito para o console e para a
     tela em vez de relatá-lo. Mesma lição dos três bytes invisíveis que este
     repositório já perdeu tempo caçando. */
  assert.ok(!/[\u0000-\u001f\u007f]/.test(r.porque), "o byte invisível voltou dentro da frase");
  assert.ok(/controle/i.test(r.porque), r.porque);
});

t("4.11 a recusa NOMEIA a variável e o conserto — configuração ignorada tem de dizer que foi ignorada", () => {
  const r = ia.descobrir("claude", {
    existe: () => true, plataforma: "win32", casa: "C:\\h", env: { CLAUDE_BIN: "claude.exe" }
  });
  assert.ok(/CLAUDE_BIN/.test(r.porque), "não nomeia a variável: " + r.porque);
  assert.ok(/absoluto/i.test(r.porque), "não diz a regra: " + r.porque);
  const c = ia.descobrir("codex", {
    existe: () => true, plataforma: "linux", casa: "/h", env: { CODEX_BIN: "codex" }
  });
  assert.ok(/CODEX_BIN/.test(c.porque), "o outro provedor nomeia a variável errada: " + c.porque);
});

t("4.12 um valor recusado NÃO cai para os candidatos padrão", () => {
  /* Cair acharia o binário de sempre, `porque` voltaria `null`, e a tela não
     teria como dizer que a configuração dele foi recusada: ele editaria o
     `.env`, o painel continuaria funcionando, e ele concluiria que a linha
     pegou. `existe: () => true` é o pior caso — todo candidato padrão existe. */
  const r = ia.descobrir("claude", {
    existe: () => true, plataforma: "win32", casa: "C:\\h", env: { CLAUDE_BIN: "claude.exe" }
  });
  assert.strictEqual(r.achado, false, "achou um binário depois de recusar a configuração");
  assert.deepStrictEqual(r.candidatos, [], "listou candidatos que nunca foram consultados");
  assert.ok(typeof r.porque === "string" && r.porque, "recusou em silêncio");
});

t("4.13 um caminho ABSOLUTO continua passando — nas duas plataformas", () => {
  const w = ia.descobrir("claude", {
    existe: () => true, plataforma: "win32", casa: "C:\\h", env: { CLAUDE_BIN: "C:\\bin\\claude.exe" }
  });
  assert.strictEqual(w.achado, true);
  assert.strictEqual(w.caminho, "C:\\bin\\claude.exe");
  const u = ia.descobrir("codex", {
    existe: () => true, plataforma: "linux", casa: "/h", env: { CODEX_BIN: "/usr/local/bin/codex" }
  });
  assert.strictEqual(u.achado, true);
  assert.strictEqual(u.caminho, "/usr/local/bin/codex");
});

t("4.14 a absolutez é medida contra a PLATAFORMA DECLARADA, não contra a do processo", () => {
  /* `C:\...` não é absoluto para o `path` do POSIX e `/usr/bin/x` não é absoluto
     do jeito que o Windows entende um caminho com unidade. Medir com o `path` do
     processo faria a regra mudar de resposta conforme a máquina que roda isto —
     e o teste passaria no Windows e reprovaria no CI, ou o contrário. */
  assert.strictEqual(ia.caminhoExplicitoAceitavel("C:\\bin\\x.exe", true).ok, true);
  assert.strictEqual(ia.caminhoExplicitoAceitavel("C:\\bin\\x.exe", false).ok, false);
  assert.strictEqual(ia.caminhoExplicitoAceitavel("/usr/bin/x", false).ok, true);
  /* `\\servidor\share\x.exe` é UNC e É absoluto no Windows: recusá-lo travaria
     quem instala em rede, e isso seria apertar por apertar. */
  assert.strictEqual(ia.caminhoExplicitoAceitavel("\\\\servidor\\share\\x.exe", true).ok, true);
  /* A regra volta NOMEADA, para a frase de recusa poder ser diferente em cada
     caso: "não é caminho" e "tem byte invisível" levam a consertos diferentes. */
  assert.strictEqual(ia.caminhoExplicitoAceitavel("claude.exe", true).regra, "relativo");
  assert.strictEqual(ia.caminhoExplicitoAceitavel("C:\\a\u0001b.exe", true).regra, "controle");
});

t("4.7 um existsSync que LANÇA não vira `não existe`", () => {
  const r = ia.descobrir("claude", {
    existe: () => { throw new Error("EPERM"); }, plataforma: "win32", env: {}, casa: "C:\\h"
  });
  assert.strictEqual(r.achado, null);
  assert.ok(/EPERM/.test(r.porque), r.porque);
});

/* ════ bloco 5 — O CASO QUE CARREGA O ARQUIVO: sem cerca, não roda ══════════ */

t("5.1 codex está na lista fechada (é reconhecido, não é desconhecido)", () => {
  /* A diferença importa: "não conheço esse nome" e "conheço e não sei cercar"
     levam a consertos opostos, e a tela precisa poder dizer qual dos dois é. */
  assert.ok(Object.prototype.hasOwnProperty.call(ia.PROVEDORES, "codex"));
});

t("5.2 um provedor sem equivalente de flag de cerca é RECUSADO", () => {
  const e = ia.escolher({ provedor: "codex", modo: "plano", env: baseSuja({ OPENAI_API_KEY: "x" }) });
  assert.strictEqual(e.ok, false, "spawnou um provedor sem cerca");
});

t("5.3 a recusa NOMEIA quais cercas faltam", () => {
  const e = ia.escolher({ provedor: "codex", modo: "plano", env: baseSuja() });
  assert.ok(e.faltando.includes("negadas"), "faltando: " + JSON.stringify(e.faltando));
  assert.ok(e.faltando.includes("settings"));
  assert.ok(/disallowedTools/.test(e.porque), e.porque);
  assert.ok(/setting-sources/.test(e.porque), e.porque);
});

t("5.4 a recusa por cerca vem ANTES da recusa por modo/chave", () => {
  /* Ordem é decisão: sem cerca não interessa de quem é a conta, porque não vai
     rodar. E uma frase sobre chave faltando esconderia a causa real. */
  const e = ia.escolher({ provedor: "codex", modo: "chave", env: {} });
  assert.strictEqual(e.ok, false);
  assert.ok(/cerca|disallowedTools|setting-sources/.test(e.porque), e.porque);
  assert.ok(!/não está no ambiente/.test(e.porque), "a frase de chave escondeu a de cerca");
});

t("5.5 argumentosDaRodada também recusa, mesmo recebendo a escolha na mão", () => {
  /* Cinto e suspensório: alguém pode chamar isto direto, e é aqui que a cerca é
     montada. Um `ok: true` forjado não pode virar um array sem cerca. */
  const forjada = { ok: true, provedor: "codex", modo: "plano", envChave: "OPENAI_API_KEY" };
  const r = ia.argumentosDaRodada({ escolha: forjada, prompt: "oi", ferramentas: "Read" });
  assert.strictEqual(r.ok, false, "montou argumentos para um provedor sem cerca");
  assert.strictEqual(r.args, null);
});

t("5.6 ambienteDaRodada não monta ambiente para um provedor sem cerca", () => {
  const e = ia.escolher({ provedor: "codex", modo: "plano", env: baseSuja() });
  assert.throws(() => ia.ambienteDaRodada({ base: baseSuja(), escolha: e }), /recusada/);
});

t("5.7 a cerca é DADO, não `if` — tirar a flag da tabela recusa o claude também", () => {
  /* É isto que faz "habilitar o Codex" ser preencher um campo em vez de editar
     uma recusa escrita à mão noutro lugar. Prova pela simetria, sem tocar no
     módulo: a mesma função que reprova o codex reprova qualquer um. */
  const semCerca = { cercas: { negadas: null, settings: ["--setting-sources", ""], mcp: ["--strict-mcp-config"] } };
  const original = ia.PROVEDORES.claude.cercas.negadas;
  try {
    ia.PROVEDORES.claude.cercas.negadas = semCerca.cercas.negadas;
    const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
    assert.strictEqual(e.ok, false, "com a cerca fora da tabela, o claude passou");
    assert.ok(e.faltando.includes("negadas"));
  } finally {
    ia.PROVEDORES.claude.cercas.negadas = original;
  }
});

t("5.8 capacidades() diz quais cercas faltam, como fato", () => {
  const c = ia.capacidades();
  assert.strictEqual(c.provedores.claude.utilizavel, true);
  assert.strictEqual(c.provedores.codex.utilizavel, false);
  assert.ok(c.provedores.codex.cercasQueFaltam.length > 0);
  /* Fato, nunca juízo: nada de cor, nada de "quebrado". */
  const txt = JSON.stringify(c);
  assert.ok(!/"cor"|risk|warn|quebr/.test(txt), "capacidades() virou juízo: " + txt.slice(0, 200));
});

/* ═══════ bloco 6 — TODAS as flags de cerca do claude, uma por asserção ══════ */

function argsClaude(extra) {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const r = ia.argumentosDaRodada(Object.assign({
    escolha: e, prompt: "arrume o nó X", ferramentas: "Read,Write,Edit,Grep"
  }, extra || {}));
  assert.strictEqual(r.ok, true, r.erro || "");
  return r;
}

/* O par flag+valor, procurado por NOME e por adjacência. Contar não pega o
   mutante que troca um valor; identificar pega. */
function par(args, flag) {
  const i = args.indexOf(flag);
  return i < 0 ? null : { i, valor: args[i + 1] };
}

t("6.1 --disallowedTools está presente e traz a lista fechada", () => {
  const { args } = argsClaude();
  const p = par(args, "--disallowedTools");
  assert.ok(p, "a cerca que de fato restringe sumiu do comando");
  assert.strictEqual(p.valor, ia.NEGADAS_SEM_REDE);
  for (const f of ["Bash", "PowerShell", "Task", "WebFetch", "WebSearch"]) {
    assert.ok(p.valor.split(",").includes(f), "faltou negar " + f);
  }
});

t("6.2 --setting-sources está presente e o valor é a string VAZIA", () => {
  const { args } = argsClaude();
  const i = args.indexOf("--setting-sources");
  assert.ok(i >= 0, "sem isto a sessão carrega o CLAUDE.md global de quem instalou o painel");
  assert.strictEqual(args[i + 1], "", "o valor tem de ser \"\": qualquer outra coisa é uma fonte de settings");
});

t("6.3 --strict-mcp-config está presente", () => {
  const { args } = argsClaude();
  assert.ok(args.includes("--strict-mcp-config"));
});

t("6.4 --mcp-config está presente e é o objeto vazio na forma que o CLI aceita", () => {
  const { args } = argsClaude();
  const p = par(args, "--mcp-config");
  assert.ok(p, "--mcp-config sumiu");
  /* Medido neste repositório: `--mcp-config '{}'` é RECUSADO pelo CLI; ele
     precisa de `{"mcpServers":{}}`. */
  assert.strictEqual(p.valor, '{"mcpServers":{}}');
  assert.deepStrictEqual(JSON.parse(p.valor), { mcpServers: {} });
});

t("6.5 --permission-mode acceptEdits está presente", () => {
  const { args } = argsClaude();
  const p = par(args, "--permission-mode");
  assert.ok(p);
  assert.strictEqual(p.valor, "acceptEdits");
});

t("6.6 --output-format stream-json e --verbose estão presentes", () => {
  const { args } = argsClaude();
  const p = par(args, "--output-format");
  assert.ok(p);
  assert.strictEqual(p.valor, "stream-json");
  assert.ok(args.includes("--verbose"), "sem --verbose o stream-json não traz os eventos");
});

t("6.7 --allowedTools carrega o que quem chamou pediu", () => {
  const { args } = argsClaude();
  const p = par(args, "--allowedTools");
  assert.ok(p);
  assert.strictEqual(p.valor, "Read,Write,Edit,Grep");
});

t("6.8 o prompt viaja em -p, e iPrompt aponta para ele", () => {
  const r = argsClaude();
  assert.strictEqual(r.args[r.args.indexOf("-p")], "-p");
  assert.strictEqual(r.args[r.iPrompt], "arrume o nó X");
  assert.strictEqual(r.args[r.iPrompt - 1], "-p");
});

t("6.9 --model, --effort e --resume só entram quando pedidos", () => {
  const semNada = argsClaude();
  assert.ok(!semNada.args.includes("--model"));
  assert.ok(!semNada.args.includes("--effort"), "--effort ausente = o padrão do CLI, dito de propósito");
  assert.ok(!semNada.args.includes("--resume"));

  const com = argsClaude({ modelo: "sonnet", esforco: "low", resumeId: "abc-123" });
  assert.strictEqual(par(com.args, "--model").valor, "sonnet");
  assert.strictEqual(par(com.args, "--effort").valor, "low");
  assert.strictEqual(par(com.args, "--resume").valor, "abc-123");
});

t("6.10 a sessão COM rede continua negando shell", () => {
  /* O Tester tem uma sessão de pesquisa com rede. Ela perde WebFetch/WebSearch da
     lista de negadas e NÃO pode perder Bash junto. */
  const r = argsClaude({ negadas: ia.NEGADAS_SEMPRE });
  const p = par(r.args, "--disallowedTools");
  const lista = p.valor.split(",");
  assert.ok(lista.includes("Bash"), "uma sessão com rede ficou com shell");
  assert.ok(lista.includes("PowerShell"));
  assert.ok(!lista.includes("WebFetch"), "esta é a sessão que precisa de rede");
});

t("6.11 o default de negadas é o FECHADO: quem quer rede pede rede", () => {
  const { args } = argsClaude();
  assert.strictEqual(par(args, "--disallowedTools").valor, ia.NEGADAS_SEM_REDE);
  assert.ok(par(args, "--disallowedTools").valor.includes("WebFetch"));
});

t("6.12 os quatro spawns montam POR AQUI — nenhum escreve as cercas à mão ao lado", () => {
  /* REESCRITO na fiação, e reescrito em vez de apagado. Enquanto os quatro sítios
     tinham o array escrito à mão, este caso conferia que as três flags apareciam
     no fonte de cada um. Elas não aparecem mais, e essa é a mudança: as cercas
     viraram DADO na tabela de provedor deste arquivo, e um provedor sem as três é
     recusado por nome antes de virar spawn.

     Uma cerca que sumiu e uma cerca que se mudou são coisas diferentes, e este
     caso passou a medir a segunda: os três requerem o adaptador, montam por ele,
     e nenhum reescreve o nome de uma flag ao lado dele — que é como as duas
     metades divergiriam. Que as flags CHEGAM ao `spawn` é o `ia-fiacao-test.js`
     que prova, por execução, com um dublê capturando os argumentos.

     Fiação medida sobre FONTE SEM COMENTÁRIO: os nomes dessas flags aparecem em
     comentário nos três arquivos, exatamente para explicar por que saíram de lá,
     e casar dentro de comentário aprovaria a ausência da decisão. */
  for (const arq of ["claude-fix.js", "tester.js", "upgrade.js"]) {
    const f = fonteLimpa(arq);
    precisa(f, "ia.argumentosDaRodada", arq);
    precisa(f, "ia.ambienteDaRodada", arq);
    for (const flag of ["--disallowedTools", "--setting-sources", "--strict-mcp-config", "--mcp-config"]) {
      assert.ok(!new RegExp('["\'`]' + flag + '["\'`]').test(f),
        arq + " ainda escreve `" + flag + "` como literal — é uma segunda definição da cerca");
    }
  }
});

/* ══════════ bloco 7 — teto de prompt: recusa por NOME antes do spawn ════════ */

t("7.1 prompt acima do teto é recusado", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const r = ia.argumentosDaRodada({ escolha: e, prompt: "x".repeat(ia.PROMPT_MAX + 1), ferramentas: "Read" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.args, null, "montou o array mesmo assim — o spawn morreria com ENAMETOOLONG");
});

t("7.2 a recusa NOMEIA o tamanho e o teto", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const n = ia.PROMPT_MAX + 500;
  const r = ia.argumentosDaRodada({ escolha: e, prompt: "x".repeat(n), ferramentas: "Read" });
  assert.ok(r.erro.includes(String(n)), "sem o tamanho, a frase não diz o que cortar: " + r.erro);
  assert.ok(r.erro.includes(String(ia.PROMPT_MAX)), r.erro);
  assert.strictEqual(r.tamanho, n);
});

t("7.3 o teto de quem chamou vence o default (as duas abas têm folgas diferentes)", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const p = "x".repeat(ia.PROMPT_MAX + 100);
  assert.strictEqual(ia.argumentosDaRodada({ escolha: e, prompt: p, tetoPrompt: ia.PROMPT_MAX_TESTER }).ok, true);
  assert.strictEqual(ia.argumentosDaRodada({ escolha: e, prompt: p }).ok, false);
});

t("7.4 os dois tetos são os que já existem no repositório, nenhum inventado", () => {
  const up = fonteLimpa("upgrade.js").match(/PROMPT_MAX\s*=\s*(\d+)/);
  const te = fonteLimpa("tester.js").match(/PROMPT_MAX\s*=\s*(\d+)/);
  assert.ok(up && te, "não achei os PROMPT_MAX de origem");
  assert.strictEqual(ia.PROMPT_MAX, Number(up[1]), "o default divergiu do upgrade.js");
  assert.strictEqual(ia.PROMPT_MAX_TESTER, Number(te[1]), "divergiu do tester.js");
  assert.ok(ia.PROMPT_MAX < ia.PROMPT_MAX_TESTER,
    "o default tem de ser o MENOR: errar apertado custa uma frase, errar largo custa um ENAMETOOLONG");
});

t("7.5 prompt vazio é recusado antes de qualquer spawn", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const r = ia.argumentosDaRodada({ escolha: e, prompt: "   ", ferramentas: "Read" });
  assert.strictEqual(r.ok, false);
});

t("7.6 exatamente no teto ainda passa", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const r = ia.argumentosDaRodada({ escolha: e, prompt: "x".repeat(ia.PROMPT_MAX), ferramentas: "Read" });
  assert.strictEqual(r.ok, true, r.erro || "");
});

/* ═══════ bloco 8 — nada com cara de chave sai em retorno nem em erro ════════ */

t("8.1 uma chave empurrada como PROMPT não aparece na recusa por teto", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const recheio = (CHAVE_FALSA + " ").repeat(Math.ceil((ia.PROMPT_MAX + 100) / (CHAVE_FALSA.length + 1)));
  const r = ia.argumentosDaRodada({ escolha: e, prompt: recheio, ferramentas: "Read" });
  assert.strictEqual(r.ok, false);
  for (const linha of textosDe(r)) {
    assert.ok(!linha.includes(CHAVE_FALSA), "vazou na recusa: " + linha.slice(0, 120));
  }
  /* Nem truncada: metade de uma credencial já é material vazado. */
  for (const linha of textosDe(r)) {
    assert.ok(!linha.includes(CHAVE_FALSA.slice(0, 24)), linha.slice(0, 120));
  }
});

t("8.2 o prompt aceito vai em args (é o spawn) mas NÃO em argumentosParaLog", () => {
  const e = ia.escolher({ provedor: "claude", modo: "plano", env: baseSuja() });
  const r = ia.argumentosDaRodada({ escolha: e, prompt: "a chave é " + CHAVE_FALSA, ferramentas: "Read" });
  assert.strictEqual(r.ok, true);
  assert.ok(r.args.some(a => String(a).includes(CHAVE_FALSA)),
    "o prompt tem de chegar inteiro ao spawn, senão a rodada é outra");
  const log = ia.argumentosParaLog(r);
  for (const a of log) {
    assert.ok(!String(a).includes(CHAVE_FALSA), "o que se imprime vazou: " + String(a).slice(0, 80));
  }
  assert.ok(log.some(a => String(a).includes(ia.MARCA_PROMPT)), "o log perdeu a marca do prompt");
  assert.strictEqual(log.length, r.args.length, "mascarar não pode mudar o comando de forma");
});

t("8.3 uma chave empurrada como PROVEDOR não é repetida na recusa", () => {
  const e = ia.escolher({ provedor: CHAVE_FALSA, modo: "plano", env: baseSuja() });
  assert.strictEqual(e.ok, false);
  assert.ok(!e.porque.includes(CHAVE_FALSA), "vazou: " + e.porque);
  assert.ok(!e.porque.includes(CHAVE_FALSA.slice(0, 20)), "vazou truncada: " + e.porque);
  assert.ok(/credencial/.test(e.porque), "a frase tem de dizer o que ela viu: " + e.porque);
});

t("8.4 uma chave empurrada como MODO não é repetida na recusa", () => {
  const e = ia.escolher({ provedor: "claude", modo: JWT_FALSO, env: baseSuja() });
  assert.strictEqual(e.ok, false);
  assert.ok(!e.porque.includes(JWT_FALSO), e.porque);
  assert.ok(!e.porque.includes(JWT_FALSO.slice(0, 12)), e.porque);
});

t("8.5 `cru` guarda o valor bruto para a tela, mas a FRASE não o repete", () => {
  /* O `cru` existe porque o CLAUDE.md exige que o valor ignorado viaje. Ele fica
     num campo próprio, que a tela pode decidir borrar (modo gravação), em vez de
     estar costurado dentro de uma frase que vai para log e ledger. */
  const e = ia.escolher({ provedor: CHAVE_FALSA, env: baseSuja() });
  assert.strictEqual(e.cru.provedor, CHAVE_FALSA);
  assert.ok(!e.porque.includes(CHAVE_FALSA));
});

t("8.6 um valor cru longo e inofensivo é cortado, não ecoado inteiro", () => {
  const lixo = "nao-sou-chave ".repeat(400);
  const e = ia.escolher({ provedor: lixo, env: baseSuja() });
  assert.strictEqual(e.ok, false);
  assert.ok(e.porque.length < 500, "a frase virou o valor: " + e.porque.length + " caracteres");
});

t("8.7 pareceSegredo reconhece cada família POR SUA REGRA, não pelo apanhador", () => {
  /* A primeira versão deste caso ficou VERDE com um mutante que apagava as regras
     do `sk-`. Motivo: todos os exemplares dela eram longos, e o apanhador
     genérico (40+ caracteres sem espaço) casava sozinho — o caso provava o
     apanhador e nada mais, com o nome de provar seis famílias.
     Agora cada exemplar é CURTO demais para o apanhador (menos de 40, ou com um
     ponto no meio, que o apanhador não aceita), então só a regra da família pode
     pegá-lo. É a mesma disciplina de "conferir quais, nunca quantas". */
  const porFamilia = {
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig",   // 35, e tem ponto
    "sk-": "sk-abcdefghijklmnop",                    // 19
    "sk-ant-": "sk-ant-x",                           // 8
    "xox": "xoxb-12345",                             // 10
    "ghp_": "ghp_" + "a".repeat(16),                 // 20
    "AIza": "AIza" + "b".repeat(16),                 // 20
    "apanhador": "a".repeat(44)
  };
  for (const [familia, v] of Object.entries(porFamilia)) {
    if (familia !== "apanhador") {
      assert.ok(v.length < 40 || v.includes("."),
        familia + ": o exemplar é longo e o apanhador o pegaria sozinho — o caso voltaria a ser cego");
    }
    assert.ok(ia.pareceSegredo(v), "a família `" + familia + "` deixou de ser reconhecida");
  }
  /* E as duas de verdade que o resto do arquivo usa. */
  assert.ok(ia.pareceSegredo(CHAVE_FALSA));
  assert.ok(ia.pareceSegredo(JWT_FALSO));
});

t("8.8 pareceSegredo NÃO come palavra comum (o falso positivo tem preço)", () => {
  /* Um falso positivo aqui torna uma mensagem de erro ilegível — barato. Mas se
     ele comer `claude` ou `plano`, a recusa deixa de dizer o que foi ignorado. */
  for (const v of ["claude", "codex", "plano", "chave", "gemini", "sonnet", "opus",
                   "C:\\Users\\x\\claude.exe", "não sei"]) {
    assert.ok(!ia.pareceSegredo(v), "comeu um valor legítimo: " + v);
  }
});

t("8.9 rotular() nunca devolve um pedaço do valor quando ele parece credencial", () => {
  const r = ia.rotular(CHAVE_FALSA);
  assert.ok(!r.includes(CHAVE_FALSA));
  for (let n = 8; n <= 32; n += 4) assert.ok(!r.includes(CHAVE_FALSA.slice(0, n)), "vazou " + n + " chars");
  assert.ok(r.includes(String(CHAVE_FALSA.length)), "o tamanho é fato e pode viajar: " + r);
});

/* ═══════════════ bloco 9 — pureza, higiene e os invariantes do arquivo ══════ */

t("9.1 escolher/ambiente/argumentos não leem process.env quando recebem base", () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = CHAVE_FALSA;
  try {
    const e = ia.escolher({ provedor: "claude", modo: "chave", env: { PATH: "x" } });
    assert.strictEqual(e.ok, false, "leu process.env em vez do env recebido");
  } finally {
    if (antes === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = antes;
  }
});

t("9.2 ambienteDaRodada não muta a base que recebeu", () => {
  const base = baseSuja();
  const copia = JSON.parse(JSON.stringify(base));
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: base });
  ia.ambienteDaRodada({ base, escolha: e });
  assert.deepStrictEqual(base, copia, "mutou o ambiente do processo que chamou");
});

t("9.3 nenhum caractere de controle em ia.js nem em ia-test.js", () => {
  /* O byte invisível é o pior defeito deste repositório: U+0000 numa chave de
     cache já falhou em silêncio três vezes. `caractere-test.js` varre a lista
     dele; este caso é a rede enquanto ia.js não entrar naquela lista. */
  for (const arq of ["ia.js", "ia-test.js"]) {
    const txt = fs.readFileSync(path.join(__dirname, arq), "utf8");
    const linhas = txt.split(/\r?\n/);
    linhas.forEach((l, i) => {
      const m = l.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
      if (m) throw new Error(arq + ":" + (i + 1) + ":" + (l.indexOf(m[0]) + 1)
        + " caractere de controle U+" + m[0].charCodeAt(0).toString(16).padStart(4, "0"));
    });
  }
});

t("9.4 ia.js não spawna, não escreve em disco e não fala com o n8n", () => {
  /* Procura a CHAMADA, não a palavra. A primeira versão deste caso buscava
     `"spawn"` cru e ficava vermelha em cima de `"não spawno uma rodada sem
     pedido"` — uma frase de recusa, não uma execução; e `".env"` casava dentro
     de `process.env` e de `cfg.envChave`. Um teste que erra assim não é rigor:
     ele obriga a próxima pessoa a torcer o texto para agradá-lo, e no dia em que
     alguém torcer o texto errado ele para de pegar o que importa. */
  const f = fonteLimpa("ia.js");
  for (const proibido of ["spawn(", "spawnSync(", "execFile", "exec(",
                          "writeFile", "appendFile", "mkdir", "rename",
                          "child_process", "node:http", "require(\"http",
                          "require(\"./n8n"]) {
    assert.ok(f.indexOf(proibido) < 0, "ia.js contém `" + proibido + "` fora de comentário");
  }
  /* Disco só de leitura, e só em `descobrir`: `fs` só pode aparecer via
     `existsSync`, que é a única pergunta que este arquivo faz ao filesystem. */
  const usosFs = f.match(/fs\.[A-Za-z]+/g) || [];
  assert.deepStrictEqual([...new Set(usosFs)], ["fs.existsSync"],
    "ia.js usa fs além do existsSync: " + usosFs.join(", "));
});

t("9.5 ia.js nao le arquivo de configuracao, e so cita a chave do n8n para APAGA-LA", () => {
  const f = fonteLimpa("ia.js");

  /* O `readEnv()` que os outros modulos tem le `.env` do diretorio e VENCE
     `process.env` — o que ja custou um `PUT` real na instancia de producao
     durante o `mutex-test.js`. Aqui o ambiente entra por parametro; um
     `readFileSync(".env")` escondido faria a decisao desta rodada depender de um
     arquivo que o teste nao controla. Casa o LITERAL entre aspas, nao a
     substring: `process.env` contem `.env`. */
  assert.ok(!/["'][^"']*\.env["']/.test(f), "ia.js abre um arquivo .env");
  assert.ok(f.indexOf("readFileSync") < 0);

  /* `N8N_API_KEY` aparece uma vez, e a primeira versao deste caso proibia a
     palavra — o que estava errado na direcao pior: ela esta em `NUNCA_ESCREVO`,
     que e a lista do que este modulo APAGA do ambiente. Proibir a mencao teria
     obrigado a proxima pessoa a tirar a chave do n8n da lista de apagados para
     agradar o teste. Entao o caso identifica o USO, nao a palavra. */
  const ocorrencias = (f.match(/N8N_API_KEY/g) || []).length;
  assert.strictEqual(ocorrencias, 1, "N8N_API_KEY aparece " + ocorrencias + " vezes fora de comentario");
  assert.ok(/NUNCA_ESCREVO\s*=\s*\[[^\]]*N8N_API_KEY/.test(f),
    "a unica mencao a N8N_API_KEY tem de ser na lista do que e apagado");
  /* A unica ESCRITA de variavel de ambiente e a do provedor escolhido — o buraco
     deliberado. A busca e recortada ao corpo de `ambienteDaRodada`, porque
     `capacidades()` tambem monta um objeto chamado `out` e a primeira versao
     deste caso ficou vermelha em cima dele. E ela e por SUBSTRING, sem regex: foi
     montando o regex deste caso que um U+0008 entrou no arquivo, e o caso 9.3
     pegou — que e exatamente o defeito para o qual o `caractere-test.js` existe. */
  precisa(f, "function ambienteDaRodada", "ia.js");
  const corpo = f.slice(f.indexOf("function ambienteDaRodada"),
                        f.indexOf("function argumentosDaRodada"));
  const escritas = corpo.split("out[").slice(1)
    /* `delete out[k]` fica de fora, e a distincao e o ponto: APAGAR e a segunda
       camada de defesa (o `NUNCA_ESCREVO`), ESCREVER e o buraco. Um caso que
       confundisse os dois reprovaria a propria defesa. */
    .map(p => ({ chave: p.slice(0, p.indexOf("]")), depois: p.slice(p.indexOf("]") + 1, p.indexOf("]") + 4) }))
    .filter(o => /^\s*=[^=]/.test(o.depois))
    .map(o => "out[" + o.chave + "] =");
  assert.deepStrictEqual(escritas, ["out[cfg.envChave] ="],
    "ia.js escreve variavel de ambiente fora do buraco deliberado: " + escritas.join(" | "));

  /* E a prova de comportamento, que e a que vale mais que qualquer regex. */
  const e = ia.escolher({ provedor: "claude", modo: "chave", env: baseSuja() });
  const amb = ia.ambienteDaRodada({ base: baseSuja(), escolha: e });
  assert.ok(!("N8N_API_KEY" in amb));
});

t("9.6 a lista de provedores é fechada e cada um declara as três cercas", () => {
  for (const p of Object.keys(ia.PROVEDORES)) {
    const cfg = ia.PROVEDORES[p];
    assert.ok(cfg.envChave, p + " sem variável de chave declarada");
    assert.ok(cfg.envBin, p + " sem variável de binário declarada");
    assert.ok(Array.isArray(cfg.comandoLogin), p + " sem comando de login");
    for (const c of ia.CERCAS_OBRIGATORIAS) {
      assert.ok(c in cfg.cercas, p + " não declara a cerca `" + c + "` (nem para dizer que não tem)");
    }
  }
});

t("9.7 duas variáveis de chave iguais em provedores diferentes seriam bug", () => {
  const vs = Object.keys(ia.PROVEDORES).map(p => ia.PROVEDORES[p].envChave);
  assert.strictEqual(new Set(vs).size, vs.length,
    "dois provedores compartilhando variável fariam o modo chave entregar a conta errada");
});

t("9.8 as frases de recusa são distintas E cada uma nomeia o próprio assunto", () => {
  /* Mesma disciplina de `fraseMorte` e das quatro frases da banda do dossiê: duas
     causas com a mesma frase ensinam a ignorar as duas.
     MAS a distinção por string não basta, e isso foi medido: um mutante que
     trocava a frase do MODO pela frase do PROVEDOR ficou VERDE, porque as duas
     interpolam valores diferentes (`cartao` contra `gemini`) e o `Set` continuava
     com quatro elementos. Contar strings distintas é a asserção errada; o que
     identifica é cada frase carregar o SEU assunto e a SUA lista de valores
     válidos — que é o que a pessoa precisa para consertar. */
  const desconhecido = ia.escolher({ provedor: "gemini", env: {} });
  const semCerca = ia.escolher({ provedor: "codex", env: {} });
  const modoMau = ia.escolher({ provedor: "claude", modo: "cartao", env: {} });
  const semChave = ia.escolher({ provedor: "claude", modo: "chave", env: {} });
  const fs_ = [desconhecido, semCerca, modoMau, semChave].map(r => r.porque);

  assert.strictEqual(new Set(fs_).size, fs_.length, "duas causas com a mesma frase");
  for (const f of fs_) assert.ok(f && f.length > 20, "frase curta demais: " + f);

  assert.ok(/provedor/.test(desconhecido.porque) && /claude/.test(desconhecido.porque)
    && /codex/.test(desconhecido.porque),
    "a recusa de provedor tem de dizer `provedor` e listar os que existem: " + desconhecido.porque);
  assert.ok(/modo/.test(modoMau.porque) && /plano/.test(modoMau.porque) && /chave/.test(modoMau.porque),
    "a recusa de modo tem de dizer `modo` e listar os que existem: " + modoMau.porque);
  assert.ok(!/provedor/.test(modoMau.porque),
    "a frase do modo virou a frase do provedor — o valor interpolado mudou e o assunto não: " + modoMau.porque);
  assert.ok(/cerca|disallowedTools|setting-sources/.test(semCerca.porque), semCerca.porque);
  assert.ok(/ANTHROPIC_API_KEY/.test(semChave.porque), semChave.porque);
});

t("9.9 codex declara o que foi MEDIDO, não o que seria conveniente", () => {
  const c = ia.PROVEDORES.codex;
  /* `-p` no codex é `--profile`, não prompt. Portar por analogia mandaria o
     prompt inteiro como nome de perfil de config. */
  assert.notStrictEqual(c.flagPrompt, "-p");
  /* Ele é um shim `.cmd` do npm: `spawn` sem `shell:true` devolve EINVAL no
     Node 22, e com `shell:true` o teto da linha cai para os 8191 do cmd.exe. */
  assert.strictEqual(c.precisaShell, true);
  /* `codex login status` não tem `--json`. */
  assert.ok(!c.comandoLogin.includes("--json"));
});

t("9.10 o teto do SO está declarado e é maior que os dois PROMPT_MAX", () => {
  assert.strictEqual(ia.TETO_CMD_WINDOWS, 32767);
  assert.ok(ia.PROMPT_MAX_TESTER < ia.TETO_CMD_WINDOWS);
});

/* ═══════════════════════════════════ resultado ══════════════════════════════ */

console.log("\nia-test.js — " + ok + " ok, " + falhas.length + " falha(s)");
for (const f of falhas) console.log("  ✗ " + f);
process.exit(falhas.length ? 1 : 0);
