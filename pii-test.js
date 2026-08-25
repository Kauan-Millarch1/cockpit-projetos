"use strict";
/* A máscara de dado pessoal na fronteira do `n8n.js`.
 *
 *   node pii-test.js
 *
 * De graça — nada de rede, nada de modelo, nada tocado em disco.
 *
 * ─────────────────────────────────────────────── por que este arquivo existe
 *
 * Vazamento MEDIDO em 24/08/2026, no `.cache-n8n-exec.json` desta máquina:
 * **13 pessoas reais, 213 ocorrências de telefone CRU**, ao lado de 2282
 * corretamente mascarados. Iam para o disco e para o browser por
 * `/api/n8n/overview`.
 *
 * A causa era uma linha de ordem em `sampleValue`:
 *
 *     if (typeof v === "number" || typeof v === "boolean") return String(v);
 *     const s = maskPII(v)...
 *
 * O ramo de número devolvia e SAÍA — sem passar pela máscara. Telefone que o n8n
 * entrega como número em vez de string pulava a defesa inteira.
 *
 * ────────────────────────────── a armadilha de medição, que vai reaparecer
 *
 * Telefone brasileiro com DDI tem 13 dígitos (55 + DDD + 9). Carimbo de tempo em
 * milissegundos também tem 13. Uma varredura que classifique por COMPRIMENTO
 * acusa milhares de carimbos como telefone.
 *
 * E o inverso também aconteceu, na mesma investigação: eu contei os valores de 13
 * dígitos **que convertiam para data**, achei 6588 de 6588, e concluí que não
 * havia telefone nenhum. O conjunto total era 6602 — eu tinha medido o
 * subconjunto que eu mesmo selecionei, e os 14 que sobravam eram justamente os
 * telefones. Conclusão certa sobre a amostra errada.
 *
 * Por isso os dois casos do bloco 3: classificar por prefixo e converter para
 * data ANTES de concluir, e nunca deixar o resíduo fora da contagem.
 */

const fs = require("node:fs");
const path = require("node:path");
const n8n = require("./n8n");

let ok = 0, falhou = 0;
const ta = (nome, fn) => {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { falhou++; console.log("  FALHOU " + nome + "\n         " + String(e && e.message)); }
};
const igual = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((m || "") + " esperava " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
  }
};
const verdade = (v, m) => { if (!v) throw new Error(m || "esperava verdadeiro"); };

/* `sampleValue` não é exportada, e extrair do fonte em tempo de execução é a
   disciplina que o `audio-test.js` já usa: reimplementar aqui provaria a cópia,
   não a função que roda. Se o recorte falhar, o teste FALHA — nunca analisa uma
   fatia vazia, que é o defeito "verde e cego" que este repositório já catalogou
   quatro vezes. */
const src = fs.readFileSync(path.join(__dirname, "n8n.js"), "utf8");
const iIni = src.indexOf("function sampleValue");
const iFim = src.indexOf("function sampleOf");
if (iIni < 0 || iFim <= iIni) {
  console.error("não achei `sampleValue` no `n8n.js` — o recorte deste teste quebrou.");
  process.exit(1);
}
const corpo = src.slice(iIni, iFim);
if (corpo.length < 200) {
  console.error("a fatia de `sampleValue` ficou com " + corpo.length + " chars — recorte quebrado.");
  process.exit(1);
}
const sampleValue = new Function("maskPII", corpo + "; return sampleValue;")(n8n.maskPII);

/* Telefones inventados, no formato brasileiro. Nenhum é de gente real. */
const TEL_NUM = 5511987654346;
const TEL_STR = "5511987654346";
const TEL_FMT = "+55 11 98765-4346";

const cru = s => String(s).replace(/\D/g, "");
const vazou = (saida, original) => {
  /* Vazou se os dígitos do meio sobreviveram. As pontas são o que a máscara
     deixa de propósito — 4 na frente e 4 atrás — e é o miolo que identifica. */
  const d = cru(original);
  return String(saida).includes(d.slice(4, -4)) || String(saida).includes(d);
};

console.log("\n1. telefone em campo de CONTATO é mascarado, venha como vier");

for (const [rot, v] of [["número", TEL_NUM], ["string", TEL_STR], ["string formatada", TEL_FMT]]) {
  ta("telefone como " + rot + " sai mascarado", () => {
    const r = sampleValue(v, 180);
    verdade(!vazou(r, v), "o miolo do telefone sobreviveu: " + r);
    verdade(/\*{3}/.test(r), "não tem máscara nenhuma na saída: " + r);
  });
}

ta("o número e a string do MESMO telefone saem iguais", () => {
  /* Se as duas formas divergirem, uma das duas está passando por um caminho que
     a outra não passa — que foi exatamente o defeito. */
  igual(sampleValue(TEL_NUM, 180), sampleValue(TEL_STR, 180));
});

console.log("\n2. campo de IDENTIFICADOR fica legível");

ta("`ref` numérico longo NÃO é mascarado", () => {
  /* `SAMPLE_REF` casa com `id`, `event_id`, `external_id`, `sku` — identificador,
     não contato. Mascarar ali fecharia um vazamento que não existe e cobraria a
     legibilidade do painel: um `id` viraria `1234 ***** 7890` na tela. */
  igual(sampleValue(987654321012, 180, true), "987654321012");
  igual(sampleValue(1755432000000, 180, true), "1755432000000");
});

ta("sem o `cru`, o mesmo valor É mascarado — a isenção é do SÍTIO, não do valor", () => {
  const comMascara = sampleValue(987654321012, 180);
  verdade(/\*{3}/.test(comMascara), "o padrão sem `cru` deixou de mascarar: " + comMascara);
});

ta("`ref` curto atravessa intacto nos dois modos", () => {
  igual(sampleValue(2119, 180), "2119");
  igual(sampleValue(2119, 180, true), "2119");
});

ta("a FIAÇÃO: só o sítio de `ref` pede `cru`, e ele pede", () => {
  /* Achado por mutante cego: os casos acima chamam `sampleValue` direto com a
     flag, então provam a FUNÇÃO e não a LIGAÇÃO. Tirar o `cru` do sítio de `ref`
     dentro do `sampleOf` deixava tudo verde — o identificador voltava a ser
     mascarado e nenhum caso reclamava.
     É a quarta vez que esta família aparece nesta sessão: teste que exercita o
     módulo enquanto o produto não passa o que o módulo espera. Mesma disciplina
     do `dono-test.js`: conferir os call sites no FONTE, não confiar na prosa. */
  const chamadas = src.match(/sampleValue\([^)]*\)/g) || [];
  verdade(chamadas.length >= 5, "achei só " + chamadas.length + " chamadas — recorte quebrado");

  const comCru = chamadas.filter(c => /,\s*true\s*\)/.test(c));
  igual(comCru.length, 1,
    "exatamente UM sítio deve pedir `cru`, achei " + comCru.length + ": " + comCru.join(" | "));

  /* E tem que ser o de `ref`. Um `cru` que migrasse para `quem` reabriria o
     vazamento inteiro sem mudar a contagem acima. */
  const linhaRef = src.split("\n").find(l => /out\.ref\s*=/.test(l) && /sampleValue\(/.test(l));
  verdade(linhaRef, "não achei a linha que preenche `out.ref`");
  verdade(/,\s*true\s*\)/.test(linhaRef),
    "o sítio de `ref` não pede `cru` — o identificador vai sair mascarado: " + linhaRef.trim());

  const linhaQuem = src.split("\n").find(l => /out\.quem\s*=/.test(l) && /sampleValue\(/.test(l));
  verdade(linhaQuem, "não achei a linha que preenche `out.quem`");
  verdade(!/,\s*true\s*\)/.test(linhaQuem),
    "o sítio de `quem` pede `cru` — é o campo de CONTATO, isso reabre o vazamento: " + linhaQuem.trim());
});

console.log("\n3. o que não é dado de ninguém, e o que não passa");

ta("booleano sai direto e não vira máscara", () => {
  igual(sampleValue(true, 180), "true");
  igual(sampleValue(false, 180), "false");
});

ta("objeto e array continuam não passando", () => {
  igual(sampleValue({ a: 1 }, 180), null);
  igual(sampleValue([1, 2], 180), null);
  igual(sampleValue(null, 180), null);
});

ta("o teto de tamanho vale para número também", () => {
  const r = sampleValue(TEL_NUM, 8);
  verdade(String(r).length <= 8, "estourou o teto: " + r);
});

console.log("\n3b. `pinData` nao entra na pasta que a sessao le");

/* MEDIDO em 24/08/2026: 6 copias de fluxo na pasta que a sessao headless LE
   carregavam 8,6 KB de `pinData` — payload de execucao real, com telefone cru
   dentro. Dado de cliente entrando no contexto de um modelo, pela funcao que
   existe exatamente para impedir isso.
   As TRES portas (`claude-fix`, os dois sitios do `upgrade.js`, e o `dossie.js`)
   passam pelo mesmo `sanitizedWorkflow`, entao uma correcao resolve as tres —
   conferido no fonte, nao suposto. */
const fix = require("./claude-fix");

const FLUXO_COM_PIN = () => ({
  name: "Fluxo de teste",
  nodes: [{ name: "A", type: "n8n-nodes-base.set", typeVersion: 3,
            credentials: { slackApi: { id: "1", name: "conta" } },
            parameters: { valor: "isto tem que sobreviver" } }],
  connections: { A: { main: [[]] } },
  settings: { executionOrder: "v1" },
  pinData: { Webhook: [{ json: { telefone: "5511987654346", msg: "conversa de lead" } }] }
});

ta("`pinData` e removido, com o payload dentro dele", () => {
  const limpo = fix.sanitizedWorkflow(FLUXO_COM_PIN());
  const texto = JSON.stringify(limpo);
  verdade(!("pinData" in limpo), "`pinData` sobreviveu no topo");
  verdade(!/5511987654346/.test(texto), "o telefone do pinData sobreviveu");
  verdade(!/conversa de lead/.test(texto), "a conversa do pinData sobreviveu");
});

ta("`credentials` continua removido — a correcao nao afrouxou o que ja havia", () => {
  const texto = JSON.stringify(fix.sanitizedWorkflow(FLUXO_COM_PIN()));
  verdade(!/credentials/.test(texto), "credentials voltou a passar");
  verdade(!/slackApi/.test(texto), "o nome do tipo de credencial passou");
});

ta("a ESTRUTURA que a sessao precisa sobrevive inteira", () => {
  /* Uma limpeza que leve o `nodes` junto nao vaza nada e tambem nao serve para
     nada: a sessao precisa da estrutura para escrever o patch. */
  const limpo = fix.sanitizedWorkflow(FLUXO_COM_PIN());
  igual(limpo.name, "Fluxo de teste");
  igual(Array.isArray(limpo.nodes) && limpo.nodes.length, 1);
  igual(limpo.nodes[0].parameters.valor, "isto tem que sobreviver");
  igual(limpo.nodes[0].typeVersion, 3);
  verdade(limpo.connections && limpo.connections.A, "as conexoes sumiram");
  igual(limpo.settings.executionOrder, "v1");
});

ta("`pinData` aninhado dentro de um no tambem cai", () => {
  const f = FLUXO_COM_PIN();
  f.nodes[0].pinData = [{ json: { telefone: "5521912345678" } }];
  const texto = JSON.stringify(fix.sanitizedWorkflow(f));
  verdade(!/5521912345678/.test(texto), "pinData aninhado sobreviveu");
});

ta("a FIACAO: as tres portas passam pelo mesmo sanitizador", () => {
  /* Se cada uma montasse a sua limpeza, esta correcao valeria para uma so — e
     as outras duas continuariam escrevendo payload no disco. Conferido no
     fonte, do jeito que o `dono-test.js` confere os call sites. */
  const up = fs.readFileSync(path.join(__dirname, "upgrade.js"), "utf8");
  const dos = fs.readFileSync(path.join(__dirname, "dossie.js"), "utf8");
  verdade((up.match(/fix\.sanitizedWorkflow\(/g) || []).length >= 2,
    "o `upgrade.js` deixou de usar o sanitizador compartilhado");
  verdade(/fix\.sanitizedWorkflow\(/.test(dos),
    "o `dossie.js` deixou de usar o sanitizador compartilhado");
});

console.log("\n4. a armadilha de medição, travada como teste");

ta("telefone BR com DDI e carimbo em ms têm o MESMO comprimento", () => {
  /* Este caso não testa o produto — testa a premissa de qualquer varredura
     futura. Se um dia deixar de ser verdade, quem estiver medindo precisa saber. */
  igual(cru(TEL_NUM).length, 13);
  igual(String(1755432000000).length, 13);
});

ta("classificar por prefixo separa os dois; por comprimento, não", () => {
  const ehCarimbo = n => { const d = new Date(Number(n)); return !isNaN(d) && d.getFullYear() >= 2020 && d.getFullYear() <= 2030; };
  verdade(ehCarimbo(1755432000000), "o carimbo não foi reconhecido como carimbo");
  verdade(!ehCarimbo(TEL_NUM), "o telefone passou por carimbo — a regra de data não separa");
  verdade(/^55\d{11}$/.test(String(TEL_NUM)), "o telefone não casa o prefixo de DDI");
});

ta("contar só o subconjunto que converte esconde o resíduo", () => {
  /* O erro que eu cometi, virado teste. Dado um universo com carimbos e
     telefones, contar "quantos convertem para data" dá 100% dos que convertem —
     e zero informação sobre os que não. A contagem tem que fechar com o total. */
  const universo = [1755432000000, 1755432000001, TEL_NUM];
  const ehCarimbo = n => { const d = new Date(Number(n)); return !isNaN(d) && d.getFullYear() >= 2020 && d.getFullYear() <= 2030; };
  const carimbos = universo.filter(ehCarimbo);
  const residuo = universo.filter(n => !ehCarimbo(n));
  igual(carimbos.length, 2);
  igual(residuo.length, 1, "o resíduo desapareceu da conta —");
  igual(carimbos.length + residuo.length, universo.length,
    "a contagem não fecha com o total, e é aí que o telefone se esconde —");
});

/* ══════ A RECUSA DO PORTAO DO DOSSIE, ANTES DE SAIR DO PROCESSO ═══════════
 *
 * DEFEITO MEDIDO EM 25/08/2026, e ele ja estava no ar antes desta rodada de
 * trabalho: `anotarAuto` no `server.js` guardava as recusas com
 * `String(x).slice(0, 160)` e nada mais, e `autoUltimo` e servido em
 * `GET /api/upgrade/dossie/:id`. Entao uma escrita AUTOMATICA de dossie que
 * reprovasse no portao de vazamento mandava o trecho vazado para a tela do
 * fluxo — telefone do lead, chave de sessao montada a partir dele — que e
 * exatamente o valor que aquele portao existe para nao deixar sair. O
 * `slice(0, 160)` nunca foi protecao: 160 caracteres preservam um telefone
 * inteiro e ainda sobra espaco.
 *
 * A recusa CITA o trecho de proposito: ela volta literal para o modelo, e e
 * assim que ele sabe qual frase apagar. Isso vale dentro do diretorio da sessao,
 * que e scratch. Nao vale em nenhum dos tres destinos reais — `dossies.json`
 * (rastreado em git), a telinha de progresso, e a linha de desfecho do
 * automatico.
 *
 * POR QUE OS CASOS OLHAM AS DUAS DIRECOES: so afirmar que o telefone sumiu
 * deixaria passar um `recusaLimpa` que devolve string vazia, e uma tela que diz
 * "reprovou" sem dizer EM QUE nao decide nada — reprovar por valor vazado manda
 * consertar a prosa, reprovar por secao faltando manda escrever de novo. */
const dossie = require("./dossie");
const fonteDossie = fs.readFileSync(path.join(__dirname, "dossie.js"), "utf8");
const fonteServer = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

console.log("\n5. a recusa do dossie, limpa na origem");

ta("recusaLimpa e UMA definicao — os tres destinos usam a mesma", () => {
  verdade(typeof dossie.recusaLimpa === "function", "`recusaLimpa` nao esta exportada");
  igual((fonteDossie.match(/function recusaLimpa/g) || []).length, 1,
    "mais de uma definicao — a segunda diverge no primeiro conserto feito de um lado so:");
  verdade(!/recusas[^\n]*\.replace\(/.test(fonteServer),
    "o `server.js` voltou a limpar recusa por conta propria — essa e a segunda definicao");
});

ta("o TRECHO citado nao atravessa: telefone, chave de sessao e e-mail somem", () => {
  const casos = [
    'vazou um valor de parametro ("+55 41 99999-1395") na secao Code_montar_payload',
    'vazou um valor de parametro ("memoria:5521999990000") na secao redis_buscar',
    'vazou telefone ("(41) 99999-1395") na visao geral',
    'vazou e-mail ("kauan.millarch@ecommercepuro.com.br") na secao envio'
  ];
  for (const c of casos) {
    const limpo = dossie.recusaLimpa(c);
    verdade(!/\d{4,}/.test(limpo), "sobrou digito de telefone em: " + limpo);
    verdade(!limpo.includes("@"), "sobrou e-mail em: " + limpo);
    verdade(!limpo.includes('"'), "sobrou o trecho entre aspas em: " + limpo);
  }
});

ta("o que DECIDE alguma coisa sobrevive — qual achado e onde", () => {
  const limpo = dossie.recusaLimpa('vazou um valor de parametro ("+55 41 99999-1395") na secao X');
  verdade(limpo.includes("valor de parametro"), "o TIPO do achado sumiu: " + limpo);
  verdade(limpo.includes("secao X"), "onde o achado esta sumiu: " + limpo);
});

ta("recusa SEM trecho passa inteira — a limpeza nao pode ser uma mordaca", () => {
  const r = "faltando a secao `## no: Code_montar_payload`";
  igual(dossie.recusaLimpa(r), r, "uma recusa que nao cita valor nenhum foi mutilada —");
});

ta("varias citacoes na mesma recusa: nenhuma escapa", () => {
  const limpo = dossie.recusaLimpa('vazou ("+55 41 99999-1395") e tambem ("+55 11 98888-2222") na prosa');
  igual((limpo.match(/\(…\)/g) || []).length, 2, "uma das duas citacoes escapou — " + limpo);
  verdade(!/\d{4,}/.test(limpo), "sobrou telefone: " + limpo);
});

ta("nao-string nao derruba e nao vaza — `null` e objeto entram por engano", () => {
  verdade(typeof dossie.recusaLimpa(null) === "string", "`null` nao virou string");
  verdade(typeof dossie.recusaLimpa({ tipo: "telefone" }) === "string", "objeto nao virou string");
});

ta("o corte em 120 NAO e a protecao — quem protege e o `replace`", () => {
  /* MUTANTE PINADO. Alguem que leia o `slice` como higiene de layout e o afrouxe
     para 400 nao pode reabrir o vazamento. Uma recusa curta cabe inteira dentro
     do corte, entao se o telefone sumir aqui foi o `replace` que o tirou. */
  const curta = 'vazou ("+55 41 99999-1395")';
  verdade(curta.length < 120, "a fixture deixou de ser curta e o caso parou de provar o que promete");
  verdade(!/\d{4,}/.test(dossie.recusaLimpa(curta)),
    "com a recusa cabendo no corte, o telefone atravessou — o `slice` estava fazendo o trabalho do `replace`");
});

ta("A FIACAO: tudo que vem de `construir` e limpo ANTES de ser guardado", () => {
  /* A REGRA E SOBRE A ORIGEM, nao sobre a palavra. O que chega cru e `r.recusas`,
     devolvido pelo `construir`; depois de guardado, `dossieJob.recusas` ja passou
     pela limpeza e reler esse campo e legitimo. Uma assercao que exigisse
     `recusaLimpa` em TODA linha que fala de `recusas` reprovaria o emissor por
     fazer a coisa certa — e um caso que reprova o certo e um caso que vai ser
     afrouxado no primeiro dia util. */
  const semCom = fonteServer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const crus = semCom.split("\n").filter(l => /r\.recusas/.test(l));
  verdade(crus.length >= 2,
    "esperava pelo menos dois pontos lendo `r.recusas` no `server.js` (o job e o automatico), achei " + crus.length);
  for (const l of crus) {
    verdade(/recusaLimpa/.test(l),
      "uma leitura de `r.recusas` guarda o CRU, e e por ai que o trecho vazado volta para a tela: " + l.trim());
  }
  const semComDossie = fonteDossie.replace(/\/\*[\s\S]*?\*\//g, "");
  verdade(/porque:\s*\(recusas \|\| \[\]\)\.map\(recusaLimpa\)/.test(semComDossie),
    "o ledger `dossies.json` deixou de usar o `recusaLimpa`");
});

console.log("\n" + (falhou ? "FALHOU" : "passou") + ": " + ok + " ok, " + falhou + " falha(s)\n");
process.exitCode = falhou ? 1 : 0;
