/* integracoes-test.js — cada caso recusa um defeito com nome.
 *
 * GRÁTIS e FECHADO: nenhum modelo, nenhuma rede, nada escrito no repositório,
 * nada chegando à instância viva. O módulo é exercido com FALSOS injetados —
 * `colher({ n8n, fix })` — que é o motivo de `integracoes.js` não fazer
 * `require("./n8n.js")` no topo. Só carregar o `n8n.js` executaria
 * `loadConfig()`, que lê o `.env` do diretório e VENCE `process.env`: um teste
 * que apenas importa o módulo passaria a ler a chave de produção, e foi assim
 * que `mutex-test.js` pagou um `PUT` de verdade contra a instância.
 *
 * A chave plantada aqui é SINTÉTICA. Este arquivo vai para o git, então o que
 * viaja é um JWT com o FORMATO da chave real e conteúdo inventado — mesma
 * disciplina do `licoes-test.js`, que afere a ausência de telefone e token
 * contra valores com cara de verdade em vez de contra a chave verdadeira.
 *
 *   node integracoes-test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const it = require("./integracoes.js");

let ok = 0, falhou = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(e && e.message)); }
};
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
const falso = (v, m) => { if (v) throw new Error(m || "esperava falso"); };

/* Um relógio de mentira, para o teste do cache não dormir trinta segundos e
   para `ms` ser medido em vez de ser sorteado. */
function relogio(inicio) {
  let t0 = inicio;
  return { agora: () => t0, andar: d => { t0 += d; } };
}

/* JWT sintético, no formato da chave desta instância (três segmentos base64url,
   prefixo `eyJ`). Nada aqui é uma credencial de verdade. */
const JWT_FALSO = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  + ".eyJzdWIiOiJjaGF2ZS1pbnZlbnRhZGEtZGUtdGVzdGUiLCJpc3MiOiJuOG4ifQ"
  + ".YXNzaW5hdHVyYS1pbnZlbnRhZGEtc28tcGFyYS1lc3RlLXRlc3RlLXNlbS12YWxvcg";

const fluxo = i => ({ id: "w" + i, name: "fluxo " + i, active: true, updatedAt: null, nodeCount: 3, tags: [] });
const linhas = n => Array.from({ length: n }, (_, i) => fluxo(i));

/* Falso do `n8n.js`, com a MESMA superfície que este módulo consome: as três
   coisas exportadas de lá que ele toca são `configured`, `instance` e
   `listWorkflows`. Nada mais. */
function n8nFalso(over = {}) {
  const f = {
    configured: true,
    instance: "https://ecommercepuro.app.n8n.cloud",
    chamadas: 0,
    ultimoOpts: undefined,
    async listWorkflows(opts) { f.chamadas++; f.ultimoOpts = opts; return linhas(75); }
  };
  return Object.assign(f, over);
}
function n8nQueQuebra(err, over = {}) {
  const f = {
    configured: true,
    instance: "https://ecommercepuro.app.n8n.cloud",
    chamadas: 0,
    async listWorkflows() { f.chamadas++; throw err; }
  };
  return Object.assign(f, over);
}
const fixFalso = (over = {}) => Object.assign({
  claudeFound: true,
  claudeBin: "C:\\Users\\alguem\\.local\\bin\\claude.exe",
  sandboxEnabled: false
}, over);

(async () => {

console.log("\n1. a chave nunca atravessa — aferida, não presumida");

await ta("JWT na mensagem de erro não sobrevive em NENHUM campo da resposta", async () => {
  it.limparCache();
  /* O erro real do `n8n.js` numa escrita carrega o corpo da resposta, e um proxy
     mal configurado ecoa o cabeçalho recebido. É por aí que a chave sai. */
  const err = Object.assign(
    new Error("n8n 401 em /api/v1/workflows: {\"message\":\"unauthorized\",\"X-N8N-API-KEY\":\"" + JWT_FALSO + "\"}"),
    { status: 401 }
  );
  const r = await it.colher({ n8n: n8nQueQuebra(err), fix: fixFalso() });
  const todo = JSON.stringify(r);
  falso(todo.includes(JWT_FALSO), "o JWT inteiro atravessou");
  falso(/eyJ/.test(todo), "sobrou prefixo `eyJ` na resposta: " + todo);
  falso(/X-N8N-API-KEY/i.test(todo), "o nome do cabeçalho atravessou: " + todo);
  /* E a mensagem não pode ter virado `null` por acidente: sem esta linha o caso
     passaria com a varredura apagando tudo, o que provaria nada sobre a
     varredura e esconderia a causa da falha do Kauan. */
  verdade(r.n8n.erro && r.n8n.erro.includes(it.SEM_SEGREDO), "o placeholder não aparece: " + r.n8n.erro);
  verdade(/401/.test(r.n8n.erro), "o status foi apagado junto com o segredo: " + r.n8n.erro);
});

t("`X-N8N-API-KEY: <valor>` sai inteiro, nome e valor", () => {
  const s = it.varrer("headers: X-N8N-API-KEY: " + JWT_FALSO + " accept: application/json");
  falso(s.includes(JWT_FALSO), "o valor ficou: " + s);
  falso(/X-N8N-API-KEY/i.test(s), "o nome ficou: " + s);
  verdade(/accept/.test(s), "a varredura comeu o resto da linha: " + s);
});

t("prefixo de JWT sem os três segmentos também sai — meio JWT já é vazamento", () => {
  falso(/eyJ/.test(it.varrer("token comeca com eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 e para aqui")));
});

t("corrida longa de base64 sem nome nenhum também sai", () => {
  const bruta = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGh";
  falso(it.varrer("recusado: " + bruta).includes(bruta));
});

t("host, URL e caminho do Windows sobrevivem à varredura", () => {
  /* Se a varredura comesse host ou caminho, `instancia` e `caminho` virariam
     `«segredo removido»` e a tela perderia as duas únicas informações que ela
     tem para identificar contra o que está falando. */
  igual(it.varrer("ecommercepuro.app.n8n.cloud"), "ecommercepuro.app.n8n.cloud");
  igual(it.varrer("C:\\Users\\alguem\\.local\\bin\\claude.exe"), "C:\\Users\\alguem\\.local\\bin\\claude.exe");
  verdade(/n8n\.cloud/.test(it.varrer("ligando em https://ecommercepuro.app.n8n.cloud/api/v1/workflows")));
});

t("`apiKey recusada` NÃO é apagada — separador explícito é exigido", () => {
  /* Sem essa exigência a varredura come a próxima palavra portuguesa e a linha
     de erro perde a única parte útil. */
  igual(it.varrer("apiKey recusada"), "apiKey recusada");
  falso(it.varrer("apiKey=" + JWT_FALSO).includes(JWT_FALSO));
});

t("mensagem gigante é cortada, e o corte vem DEPOIS da varredura", () => {
  const s = it.varrer("x".repeat(3000) + " " + JWT_FALSO);
  verdade(s.length <= it.MSG_CAP + 1, "não cortou: " + s.length);
  falso(s.includes("eyJ"), "o segredo estava depois do corte e escapou da varredura");
});

console.log("\n2. `null` não é `false` — três estados, nunca dois");

await ta("não configurado: `respondeu` é `null` e a instância NÃO é perguntada", async () => {
  it.limparCache();
  const n = n8nFalso({ configured: false });
  const r = await it.colher({ n8n: n, fix: fixFalso() });
  igual(r.n8n.configurado, false);
  igual(r.n8n.checado, false, "disse que checou:");
  igual(r.n8n.respondeu, null, "colheita que não perguntou:");
  igual(r.n8n.fluxos, null);
  igual(r.n8n.httpStatus, null);
  igual(n.chamadas, 0, "perguntou para uma instância não configurada:");
});

await ta("perguntou e não respondeu: `respondeu` é `false`, e é distinguível do `null`", async () => {
  it.limparCache();
  const semPerguntar = await it.colher({ n8n: n8nFalso({ configured: false }), fix: fixFalso() });
  it.limparCache();
  const perguntou = await it.colher({ n8n: n8nQueQuebra(new Error("n8n 503 em /api/v1/workflows")), fix: fixFalso() });
  igual(perguntou.n8n.respondeu, false);
  igual(perguntou.n8n.checado, true);
  verdade(semPerguntar.n8n.respondeu !== perguntou.n8n.respondeu,
    "os dois estados colapsaram no mesmo valor — a página não consegue distinguir `conferindo` de `quebrou`");
});

t("`booleanoOuNulo` é a regra mecanizada: só booleano vira booleano", () => {
  igual(it.booleanoOuNulo(true), true);
  igual(it.booleanoOuNulo(false), false);
  igual(it.booleanoOuNulo(undefined), null);
  igual(it.booleanoOuNulo(null), null);
  igual(it.booleanoOuNulo(0), null, "`0` caiu no ramo negativo:");
  igual(it.booleanoOuNulo(""), null);
  igual(it.booleanoOuNulo("false"), null, "a string `false` virou booleano:");
});

console.log("\n3. campo ausente nunca cai no ramo negativo");

await ta("`fix` SEM `claudeFound` não reporta `cliAchada: false`", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: n8nFalso(), fix: {} });
  igual(r.claude.cliAchada, null,
    "um campo que ninguém checou foi anunciado como checado e negativo — o defeito do `docAgentes`:");
  igual(r.claude.sandbox, null);
  igual(r.claude.caminho, null);
});

await ta("`fix` ausente por inteiro também é `null`, não `false`", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: n8nFalso() });
  igual(r.claude.cliAchada, null);
});

await ta("`claudeFound: false` de verdade é `false` — o estado negativo existe", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: n8nFalso(), fix: fixFalso({ claudeFound: false }) });
  igual(r.claude.cliAchada, false, "o negativo real foi apagado junto com o desconhecido:");
});

await ta("`configured` ausente: `configurado` é `null` e a instância NÃO é perguntada", async () => {
  it.limparCache();
  const n = n8nFalso();
  delete n.configured;
  const r = await it.colher({ n8n: n, fix: fixFalso() });
  igual(r.n8n.configurado, null);
  igual(r.n8n.respondeu, null);
  igual(n.chamadas, 0, "perguntou sem saber se estava configurado — `respondeu: false` acusaria a instância de um desconhecimento nosso:");
});

await ta("módulo n8n sem `listWorkflows` é defeito NOSSO: `respondeu` fica `null`", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: { configured: true, instance: "https://x.app.n8n.cloud" }, fix: fixFalso() });
  igual(r.n8n.respondeu, null, "acusou a instância de um erro de fiação do cockpit:");
  verdade(r.n8n.erro && /listWorkflows/.test(r.n8n.erro), "não disse qual era o problema: " + r.n8n.erro);
});

await ta("entrada vazia não estoura e não inventa nada", async () => {
  it.limparCache();
  const r = await it.colher({});
  igual(r.n8n.configurado, null);
  igual(r.n8n.respondeu, null);
  igual(r.claude.cliAchada, null);
  igual(r.codex.integrado, false);
});

console.log("\n4. erro NÃO entra no cache");

await ta("duas colheitas seguidas com a primeira falhando perguntam DUAS vezes", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nQueQuebra(new Error("n8n 503 em /api/v1/workflows"));
  await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  c.andar(200);
  const r2 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(n.chamadas, 2,
    "o erro entrou no cache: trinta segundos dizendo `não respondeu` mantêm a tela acusando uma instância que já voltou");
  igual(r2.doCache, false);
});

await ta("colheita que não perguntou também não entra no cache", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso({ configured: false });
  await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  n.configured = true;
  c.andar(200);
  const r2 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(r2.n8n.respondeu, true, "ficou preso num `null` cacheado depois de a configuração aparecer:");
});

console.log("\n5. sucesso entra no cache, e o cache diz a idade em vez de se fingir fresco");

await ta("dentro da janela: uma pergunta só, e `em` é o da colheita ORIGINAL", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso();
  const r1 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  c.andar(12_000);
  const r2 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(n.chamadas, 1, "não usou o cache:");
  igual(r2.em, r1.em, "o cache reescreveu `em` como agora — uma resposta velha se apresentando como fresca:");
  igual(r2.doCache, true);
  igual(r2.idadeMs, 12_000, "não disse a idade:");
  igual(r1.doCache, false);
  igual(r1.idadeMs, 0);
  igual(r2.n8n.fluxos, 75);
});

await ta("passada a janela de 30s, pergunta de novo", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso();
  const r1 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  c.andar(it.CACHE_MS + 1);
  const r2 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(n.chamadas, 2, "o cache não expirou:");
  verdade(r2.em !== r1.em, "`em` não andou numa colheita nova");
});

await ta("`refazer` ignora o cache — é o que o botão `Conferir de novo` precisa", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso();
  await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  c.andar(1000);
  const r2 = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora, refazer: true });
  igual(n.chamadas, 2, "um botão que devolve cache é um botão que não faz nada:");
  igual(r2.doCache, false);
});

await ta("o cache é da instância a que pertence — outro host pergunta de novo", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const a = n8nFalso();
  const b = n8nFalso({ instance: "https://outra.app.n8n.cloud" });
  await it.colher({ n8n: a, fix: fixFalso(), agora: c.agora });
  c.andar(1000);
  const r2 = await it.colher({ n8n: b, fix: fixFalso(), agora: c.agora });
  igual(b.chamadas, 1, "serviu a resposta de um host para outro:");
  igual(r2.n8n.instancia, "outra.app.n8n.cloud");
});

await ta("`ms` é medido em cima da chamada, não sorteado", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso();
  n.listWorkflows = async () => { n.chamadas++; c.andar(1400); return linhas(75); };
  const r = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(r.n8n.ms, 1400);
});

await ta("por padrão o ping ignora o cache de 5 min do próprio `n8n.js`", async () => {
  /* `getWorkflows` tem cache próprio de `WORKFLOWS_TTL_MS` (5 min). Sem `force`,
     `respondeu: true` podia sair sem tocar a rede sobre uma instância que caiu
     há quatro minutos — o defeito simétrico do erro cacheado, e maior. */
  it.limparCache();
  const n = n8nFalso();
  await it.colher({ n8n: n, fix: fixFalso() });
  igual(n.ultimoOpts, { force: true });
  it.limparCache();
  const m = n8nFalso();
  await it.colher({ n8n: m, fix: fixFalso(), ignorarCacheDoN8n: false });
  igual(m.ultimoOpts, undefined, "a opção de não forçar não foi respeitada:");
});

console.log("\n6. `fluxos` é PISO, nunca total");

t("leitura no teto é anunciada como parcial", () => {
  igual(it.contarFluxos(linhas(it.TETO_LEITURA)), { fluxos: it.TETO_LEITURA, parcial: true });
  igual(it.contarFluxos(linhas(it.TETO_LEITURA + 5)).parcial, true);
});

t("leitura abaixo do teto não é parcial", () => {
  igual(it.contarFluxos(linhas(75)), { fluxos: 75, parcial: false });
});

t("zero fluxos é uma contagem de verdade; forma desconhecida é `null`, nunca `0`", () => {
  /* `0` e "não consegui contar" levam a decisões opostas, e `0` é o ramo negativo
     onde o desconhecido não pode cair. `listWorkflows` devolve array hoje; se um
     dia devolver `{data}`, isto tem de virar `null` e não uma instância vazia. */
  igual(it.contarFluxos([]), { fluxos: 0, parcial: false });
  igual(it.contarFluxos({ data: [] }), { fluxos: null, parcial: null });
  igual(it.contarFluxos(undefined), { fluxos: null, parcial: null });
});

await ta("a resposta carrega `parcial` e o teto, para a página poder dizer `piso`", async () => {
  it.limparCache();
  const n = n8nFalso();
  n.listWorkflows = async () => linhas(it.TETO_LEITURA);
  const r = await it.colher({ n8n: n, fix: fixFalso() });
  igual(r.n8n.fluxos, it.TETO_LEITURA);
  igual(r.n8n.parcial, true, "a página não tem como saber que a leitura foi parcial:");
  igual(r.n8n.teto, it.TETO_LEITURA);
});

console.log("\n7. `httpStatus` é fato, e o 5xx do `n8n.js` não vem com `.status`");

t("`err.status` é lido quando existe", () => {
  igual(it.statusDoErro(Object.assign(new Error("n8n 401 em /api/v1/workflows"), { status: 401 })), 401);
});

t("5xx depois das três tentativas: o status sai da MENSAGEM, porque `.status` não é setado lá", () => {
  /* `request()` só faz `err.status = res.status` no ramo `!res.ok`. No ramo de
     429/5xx ele lança `new Error("n8n 503 em ...")` pelado — e é exatamente o
     caso de "instância fora do ar" que a tela mais precisa nomear. */
  igual(it.statusDoErro(new Error("n8n 503 em /api/v1/workflows")), 503);
  igual(it.statusDoErro(new Error("n8n 429 em /api/v1/workflows")), 429);
});

t("erro de rede não inventa status", () => {
  igual(it.statusDoErro(new TypeError("fetch failed")), null);
  igual(it.statusDoErro(new Error("The operation was aborted")), null);
  igual(it.statusDoErro(null), null);
});

t("número fora da faixa HTTP não é aceito como status", () => {
  igual(it.statusDoErro(Object.assign(new Error("x"), { status: 0 })), null);
  igual(it.statusDoErro(Object.assign(new Error("x"), { status: 9999 })), null);
});

await ta("sucesso reporta 200 e nenhum erro", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: n8nFalso(), fix: fixFalso() });
  igual(r.n8n.httpStatus, 200);
  igual(r.n8n.erro, null);
  igual(r.n8n.respondeu, true);
});

await ta("o status atravessa junto com a falha", async () => {
  it.limparCache();
  const err = Object.assign(new Error("n8n 401 em /api/v1/workflows"), { status: 401 });
  const r = await it.colher({ n8n: n8nQueQuebra(err), fix: fixFalso() });
  igual(r.n8n.httpStatus, 401);
  igual(r.n8n.fluxos, null, "contou fluxos numa leitura que falhou:");
});

console.log("\n8. a instância é o host, nunca a chave");

t("URL completa vira host; userinfo não atravessa", () => {
  igual(it.hostDe("https://ecommercepuro.app.n8n.cloud"), "ecommercepuro.app.n8n.cloud");
  igual(it.hostDe("https://ecommercepuro.app.n8n.cloud/"), "ecommercepuro.app.n8n.cloud");
  igual(it.hostDe("http://localhost:5678"), "localhost:5678");
  igual(it.hostDe("https://usuario:senha@interno.n8n.local"), "interno.n8n.local",
    "userinfo atravessou — a senha da base viraria campo de resposta:");
});

t("host pelado (o `.env` sem esquema) também é lido", () => {
  igual(it.hostDe("ecommercepuro.app.n8n.cloud"), "ecommercepuro.app.n8n.cloud");
  igual(it.hostDe(""), null);
  igual(it.hostDe(null), null);
});

console.log("\n9. nada de leitura crua, rota nova, escrita — aferido sobre a fonte SEM comentário");

/* Medir sobre a fonte com comentário aprovaria a AUSÊNCIA da decisão: o
   `dossie-tela-test.js` teve dois casos ficarem verdes porque o comentário que
   explicava a guarda carregava o nome que eles procuravam, e num dos mutantes a
   guarda tinha sido deletada. Aqui é pior ainda: o cabeçalho deste módulo
   PROMETE não chamar `getRawWorkflow`, então procurar a palavra no arquivo
   inteiro casaria com a própria promessa. */
const bruta = fs.readFileSync(path.join(__dirname, "integracoes.js"), "utf8");
const fonte = bruta.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

t("o desmonte de comentário funcionou (senão os casos abaixo aprovam qualquer coisa)", () => {
  verdade(/function colher/.test(fonte), "o desmonte comeu o código");
  verdade(/SEGREDO_RE/.test(fonte), "o desmonte comeu as regras de varredura");
  falso(/CONTRATO/.test(fonte), "sobrou comentário na fonte desmontada");
});

t("nenhuma menção a `getRawWorkflow` no código", () => {
  falso(/getRawWorkflow/.test(fonte), "o buraco deliberado da whitelist não entra nesta fatia");
});

t("nenhuma escrita: nem `putWorkflow`, nem `createWorkflow`, nem `retryExecution`", () => {
  falso(/putWorkflow|createWorkflow|retryExecution/.test(fonte));
});

t("nenhuma rota HTTP nova: sem `fetch`, sem `http`, sem `URL` de saída própria", () => {
  /* O ping é `n8n.listWorkflows()`, que já passa pela whitelist e pelo teto de
     concorrência. Um `fetch` aqui seria um segundo cliente de n8n, com uma
     segunda definição do que atravessa. */
  falso(/\bfetch\s*\(/.test(fonte), "abriu conexão própria");
  falso(/require\s*\(\s*["']node:https?["']\s*\)/.test(fonte));
  falso(/\bXMLHttpRequest\b/.test(fonte));
});

t("nenhuma escrita em disco e nenhum `require` — nem de `n8n.js`, nem de `claude-fix.js`", () => {
  /* O `require` no topo é o que este módulo NÃO faz: `loadConfig()` do `n8n.js`
     roda por carregamento e lê o `.env`. Injeção de dependência é o que mantém
     este teste incapaz de tocar a instância viva. */
  falso(/require\s*\(/.test(fonte), "apareceu um `require` — a injeção de dependência foi desfeita");
  falso(/writeFile|appendFile|mkdir|rename|unlink/.test(fonte), "escreveu em disco");
});

t("a varredura NÃO é injetável", () => {
  /* Se `varrer` chegasse por parâmetro, um chamador (ou um teste) poderia passar
     a identidade e desligar a única defesa contra o vazamento da chave. Ela é
     definida aqui e chamada aqui. */
  verdade(/function varrer\s*\(/.test(fonte), "`varrer` não é definida neste módulo");
  const assinatura = (fonte.match(/async function colher\s*\(\{[\s\S]*?\}\s*=\s*\{\}\s*\)/) || [""])[0];
  verdade(assinatura, "não achei a assinatura de `colher`");
  falso(/varrer|scrub|sanitiz/i.test(assinatura), "a varredura entra por parâmetro: " + assinatura);
});

t("o campo `erro` passa pela varredura no ponto de saída", () => {
  /* Estrutural além do semântico: o caso do bloco 1 pega a ausência da varredura,
     e este pega a linha, para o mutante que troca `varrer(...)` por `String(...)`
     ficar vermelho com o motivo na tela em vez de só com um diff de JSON. */
  verdade(/erro\s*=\s*varrer\(/.test(fonte), "`erro` sai sem varrer");
});

t("nenhum caractere de controle no arquivo", () => {
  /* `integracoes.js` NÃO está na lista de `caractere-test.js` (aquele arquivo tem
     a lista cravada, e mexer nele está fora desta fatia). Enquanto não entrar
     lá, a rede é esta. */
  const m = bruta.match(/[^\t\r\n\x20-\x7e\u00a0-\uffff]/);
  falso(m, "achei caractere de controle: U+" + (m ? m[0].charCodeAt(0).toString(16) : ""));
});

console.log("\n10. o módulo emite fato, não juízo");

await ta("nenhum nome de estado nem cor sai daqui", async () => {
  it.limparCache();
  const err = Object.assign(new Error("n8n 401 em /api/v1/workflows"), { status: 401 });
  const r = await it.colher({ n8n: n8nQueQuebra(err), fix: fixFalso() });
  const todo = JSON.stringify(r);
  /* `quebrou`/`nunca`/`conferindo`/`ok` e a frase da causa são decisão do bloco
     de juízo de `integracoes.html`. Duas definições de "quebrou" divergiriam na
     primeira correção feita de um lado só. */
  for (const p of ["quebrou", "conferindo", "chave recusada", "fora do ar", "risk", "warn"]) {
    falso(new RegExp(p, "i").test(todo), "o módulo julgou: achei `" + p + "` em " + todo);
  }
});

await ta("Codex é fato sobre o nosso código, com a frase do contrato", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: n8nFalso(), fix: fixFalso() });
  igual(r.codex.integrado, false, "`integrado` aqui é `false` de verdade, não `null`:");
  igual(r.codex.porque, it.CODEX_PORQUE);
  verdade(/spawn/.test(r.codex.porque) && /vari/.test(r.codex.porque),
    "a frase não diz POR QUE não existe caminho de Codex");
});

await ta("`em` é ISO e a forma da resposta é a do contrato", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const r = await it.colher({ n8n: n8nFalso(), fix: fixFalso(), agora: c.agora });
  igual(r.em, new Date(1_700_000_000_000).toISOString());
  /* `ia` entrou aqui em 24/08/2026, e este caso ficou VERMELHO no instante em que
     entrou -- que e o contrato de forma fazendo o trabalho dele. Sem ele, um campo
     novo nasceria sem ninguem confirmar que era para nascer.
     Ele carrega os fatos do `ia.js` (quais provedores, qual e recusado e por que,
     quais modos de credencial, qual o padrao). Foi acrescentado porque a tela
     transcrevia esses fatos a mao -- segunda copia de um fato que diz a uma pessoa
     QUAL IA ela pode usar e QUEM PAGA a conta dela. */
  igual(Object.keys(r).sort(), ["claude", "codex", "doCache", "em", "ia", "idadeMs", "n8n"]);
  igual(Object.keys(r.n8n).sort(),
    ["checado", "configurado", "erro", "fluxos", "httpStatus", "instancia", "ms", "parcial", "respondeu", "teto"]);
  igual(Object.keys(r.claude).sort(),
    ["caminho", "cliAchada", "conta", "logado", "org", "plano", "porqueNaoSei", "rota", "sandbox"]);
  igual(Object.keys(r.codex).sort(), ["integrado", "porque"]);

  /* Sem adaptador injetado, `ia` e `null` -- e `null` aqui e "este cockpit subiu
     antes de o adaptador existir", NUNCA "nao ha escolha de IA". O Node nao
     recarrega o `server.js`, entao esse estado e real numa maquina que ficou com
     a janela aberta, e a tela tem de mandar reabrir em vez de esconder a escolha. */
  igual(r.ia, null, "sem adaptador injetado, `ia` tem de ser null:");
});

await ta("`ia` viaja como fato quando o adaptador e injetado, e nunca derruba a rota", async () => {
  it.limparCache();
  const r = await it.colher({
    n8n: n8nFalso(), fix: fixFalso(),
    ia: { capacidades: () => ({ provedores: [{ id: "claude", aceito: true }], padrao: { provedor: "claude", modo: "plano" } }) }
  });
  verdade(r.ia && Array.isArray(r.ia.provedores), "o bloco `ia` nao atravessou");
  igual(r.ia.padrao.modo, "plano");

  /* Um adaptador quebrado nao pode derrubar a rota inteira: ele e uma das cinco
     coisas que esta tela mostra, e as outras quatro continuam validas. Mesma
     disciplina do `perguntarLogin`, que tambem nunca lanca. */
  it.limparCache();
  const r2 = await it.colher({
    n8n: n8nFalso(), fix: fixFalso(),
    ia: { capacidades: () => { throw new Error("adaptador hostil"); } }
  });
  igual(r2.ia, null, "adaptador que lanca tinha de virar null:");
  verdade(r2.n8n && r2.claude, "o resto da colheita morreu junto com o adaptador");

  /* E o valor nao pode ser qualquer coisa: um adaptador que devolve string faria a
     tela iterar sobre caracteres. */
  it.limparCache();
  const r3 = await it.colher({ n8n: n8nFalso(), fix: fixFalso(), ia: { capacidades: () => "claro que sim" } });
  igual(r3.ia, null, "capacidades() devolvendo string tinha de virar null:");
});

/* ─────────────────────────────────────────────────────────────────────────────
   11. `checado` é sobre ESTA colheita, não sobre a que encheu o cache

   Defeito achado com a rota rodando contra a instância de verdade, depois de o
   módulo já ter 47 casos verdes: o retorno do cache era
   `{...cache.corpo, doCache:true}`, e o corpo guardado carrega o `checado:true`
   da colheita que o encheu. A resposta afirmava "perguntei nesta colheita" ao
   lado de "vim do cache" — duas frases que se contradizem dentro do mesmo
   objeto. E `checado` é exatamente o campo que a página lê para escolher entre
   "conferido agora" e "colhido há N s", então a contradição não era acadêmica:
   ela faria a tela dizer que acabou de perguntar quando não perguntou. */
console.log("");
console.log("11. `checado` é sobre ESTA colheita, não sobre a que encheu o cache");

await ta("acerto de cache reporta checado:false, e o respondeu guardado continua valendo", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso();

  const primeira = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(primeira.n8n.checado, true, "quem perguntou reporta checado:true —");
  igual(primeira.doCache, false, "e nao e do cache —");
  igual(n.chamadas, 1, "uma chamada ate aqui —");

  c.andar(12_000);
  const segunda = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
  igual(n.chamadas, 1, "o cache evitou a segunda chamada —");
  igual(segunda.doCache, true, "e a resposta se declara do cache —");
  igual(segunda.n8n.checado, false, "ESTA colheita nao perguntou, entao checado:false —");
  igual(segunda.n8n.respondeu, true, "mas o respondeu guardado vale: e a resposta que temos —");
  igual(segunda.idadeMs, 12_000, "com a idade declarada —");
  igual(segunda.em, primeira.em, "e `em` e o instante da colheita ORIGINAL —");
});

await ta("checado e doCache nunca sao os dois verdadeiros na mesma resposta", async () => {
  it.limparCache();
  const c = relogio(1_700_000_000_000);
  const n = n8nFalso();
  for (const passo of [0, 5_000, 11_000, 29_000]) {
    c.andar(passo);
    const r = await it.colher({ n8n: n, fix: fixFalso(), agora: c.agora });
    falso(r.n8n.checado && r.doCache,
      "aos " + passo + "ms a resposta afirma as duas coisas ao mesmo tempo");
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   12. o login do Claude: perguntado ao CLI, e os três estados de novo

   O defeito que este bloco fecha existia desde o primeiro dia: `claudeFound` é
   `fs.existsSync(binário)`, e na máquina do Kauan "existe" e "está logado" são a
   mesma coisa. Na máquina de um estranho não são — instalado e nunca logado
   virava "conectada" na tela, e a primeira construção morria com um erro que não
   nomeava nada. Aqui `logado:false` e `logado:null` são obrigados a ser
   distinguíveis, porque mandam a pessoa para lugares diferentes: uma faz login,
   a outra descobre por que a pergunta não pôde ser feita. */
console.log("");
console.log("12. o login do Claude é perguntado ao CLI, com os três estados");

/* O buraco que um mutante encontrou: todos os casos abaixo montam o proprio
   objeto com `logado: null`, entao o valor de NASCIMENTO — o que o `colher`
   escreve antes de perguntar qualquer coisa — nao estava coberto. Trocar aquele
   `null` por `false` na fonte passava com 57 casos verdes. E aquele valor e a
   disciplina inteira: e o que a tela le quando a pergunta nao pode ser feita. */
await ta("no corpo que o colher monta, logado NASCE null — nao false", async () => {
  it.limparCache();
  const r = await it.colher({ n8n: n8nFalso(), fix: fixFalso(), agora: relogio(1).agora });
  /* sem `autenticar` injetado, ninguem pergunta nada: e exatamente o caso em que
     um `false` de nascimento viraria "ela nao esta logada" na tela. */
  igual(r.claude.logado, null, "sem checagem ligada, logado e desconhecido —");
  igual(r.claude.rota, null);
  igual(r.claude.plano, null);
  verdade(r.claude.porqueNaoSei, "e o motivo diz por que nao perguntou —");
});

await ta("com autenticar injetado, o colher preenche o bloco inteiro", async () => {
  it.limparCache();
  const r = await it.colher({
    n8n: n8nFalso(), fix: fixFalso(), agora: relogio(1).agora,
    autenticar: async () => ({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" })
  });
  igual(r.claude.logado, true);
  igual(r.claude.rota, "claude.ai");
  igual(r.claude.plano, "max");
});

await ta("logado sai do CLI, junto da rota e do plano", async () => {
  const c = { cliAchada: true, logado: null, rota: null, plano: null, conta: null, org: null, porqueNaoSei: null };
  await it.perguntarLogin(c, async () => ({
    loggedIn: true, authMethod: "claude.ai", subscriptionType: "team",
    email: "alguem@exemplo.com", orgName: "Exemplo"
  }));
  igual(c.logado, true);
  igual(c.rota, "claude.ai", "a rota diz de qual cota sai o gasto —");
  igual(c.plano, "team");
  igual(c.porqueNaoSei, null, "deu para perguntar, entao nao ha motivo a dar —");
});

await ta("CLI ausente NAO e 'nao esta logada' — e 'nao perguntei', com o motivo", async () => {
  const c = { cliAchada: false, logado: null, porqueNaoSei: null };
  let chamou = false;
  await it.perguntarLogin(c, async () => { chamou = true; return { loggedIn: true }; });
  falso(chamou, "sem CLI no disco nao ha o que perguntar, entao nao spawna —");
  igual(c.logado, null, "e logado fica null, nunca false —");
  verdade(/não perguntei/.test(c.porqueNaoSei), "e o motivo diz que nao perguntou: " + c.porqueNaoSei);
});

await ta("cliAchada null tambem nao pergunta, e diz outra frase", async () => {
  const c = { cliAchada: null, logado: null, porqueNaoSei: null };
  await it.perguntarLogin(c, async () => ({ loggedIn: true }));
  igual(c.logado, null);
  verdade(c.porqueNaoSei && c.porqueNaoSei !== "", "tem motivo —");
});

await ta("logado:false e logado:null sao frases DIFERENTES", async () => {
  const nao = { cliAchada: true, logado: null, porqueNaoSei: null };
  await it.perguntarLogin(nao, async () => ({ loggedIn: false, authMethod: "claude.ai" }));
  igual(nao.logado, false, "perguntei e ela nao esta logada —");
  igual(nao.porqueNaoSei, null, "e isso NAO e um 'nao sei' —");

  const naoSei = { cliAchada: true, logado: null, porqueNaoSei: null };
  await it.perguntarLogin(naoSei, async () => { throw new Error("spawn ENOENT"); });
  igual(naoSei.logado, null, "aqui nao deu para perguntar —");
  verdade(naoSei.porqueNaoSei, "e o motivo existe —");
  verdade(nao.porqueNaoSei !== naoSei.porqueNaoSei, "as duas situacoes nao podem ler igual");
});

await ta("loggedIn ausente na resposta do CLI nao vira false", async () => {
  const c = { cliAchada: true, logado: null, porqueNaoSei: null };
  await it.perguntarLogin(c, async () => ({ authMethod: "claude.ai" }));
  igual(c.logado, null, "undefined do CLI e desconhecido, nao negativo —");
  verdade(c.porqueNaoSei, "e diz que a resposta nao respondeu isso —");
});

await ta("a checagem desligada acusa a NOSSA fiacao, nao a instalacao dela", async () => {
  const c = { cliAchada: true, logado: null, porqueNaoSei: null };
  await it.perguntarLogin(c, null);
  igual(c.logado, null);
  verdade(/cockpit/i.test(c.porqueNaoSei), "a frase culpa o cockpit: " + c.porqueNaoSei);
});

await ta("erro do CLI passa pela varredura antes de virar frase", async () => {
  const c = { cliAchada: true, logado: null, porqueNaoSei: null };
  await it.perguntarLogin(c, async () => { throw new Error("falhou com token " + JWT_FALSO); });
  falso(/eyJ/.test(c.porqueNaoSei || ""), "nada com cara de token sobra no motivo");
  falso(/eyJ/.test(JSON.stringify(c)), "nem em campo nenhum do objeto");
});

await ta("perguntarLogin nunca lanca, mesmo com dublê hostil", async () => {
  for (const f of [async () => null, async () => 42, async () => { throw null; }, () => "nao e promessa"]) {
    const c = { cliAchada: true, logado: null, porqueNaoSei: null };
    await it.perguntarLogin(c, f);   /* se lançar, o caso falha por exceção */
    igual(c.logado, null, "nenhum dublê hostil produz um logado inventado —");
  }
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exitCode = falhou ? 1 : 0;

})();
