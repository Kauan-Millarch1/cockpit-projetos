"use strict";
/* preencher-test.js — o portão `[PREENCHER]`, e cada caso recusa um defeito com nome.
 *
 * De graça: nenhum modelo, nenhum spawn, nenhuma chamada ao n8n.
 *
 * O GRUPO 3 É O PONTO DESTE ARQUIVO, e ele é a lista ao contrário: o que o portão
 * NÃO pode pegar. Cada caso ali é um patch CORRETO que seria rejeitado, e um portão
 * que rejeita patch correto é pior que portão nenhum — some da tela como sinal e
 * ensina a clicar em "ignorar". Mesma função do grupo 3 do `esquema-test.js`.
 *
 *   node preencher-test.js
 */
const p = require("./preencher.js");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const bad = m => { total++; falhas++; console.log("  FALHA " + m); };
const t = (nome, cond) => cond ? ok(nome) : bad(nome);

/* Um patch mínimo que só carrega o valor em teste, no campo em teste. */
const up = (valor, chave) => ({ updateNodes: [{ name: "supabase_gravar_lead", [chave || "parameters"]: valor }] });
const pega = (valor, chave) => !p.portaPreencher(up(valor, chave)).ok;
const passa = (valor, chave) => p.portaPreencher(up(valor, chave)).ok;

console.log("\n1. o que o portão PEGA");
t("`[PREENCHER]` seco", pega({ tableId: "[PREENCHER]" }));
t("`[PREENCHER: nome da tabela]` — a forma explicada, que é a mais comum",
  pega({ tableId: "[PREENCHER: nome da tabela]" }));
t("`[FILL]`", pega({ canal: "[FILL]" }));
t("`[PLACEHOLDER]`", pega({ canal: "[PLACEHOLDER]" }));
t("caixa baixa `[preencher]` também", pega({ canal: "[preencher]" }));
t("`TODO:` solto", pega({ texto: "TODO: confirmar o canal com o Kauan" }));
t("`FIXME:` solto", pega({ texto: "FIXME: isso quebra com lead sem telefone" }));
t("`<...>` literal", pega({ corpo: "Olá <...>, seu pedido chegou" }));
t("`<SEU_CANAL>` em caixa alta", pega({ channel: "<SEU_CANAL>" }));
t("`<seu-canal>` em caixa baixa com hífen", pega({ channel: "<seu-canal>" }));
/* `table_id` não carrega nenhuma palavra de preenchimento nem caixa alta: só o
   separador o distingue de um nome de tag. Sem este caso a regra do separador
   podia ser apagada sem nenhum teste ficar vermelho. */
t("`<table_id>` — separador é a ÚNICA coisa que o marca", pega({ tableId: "<table_id>" }));
t("`<SEUCANAL>` — caixa alta sem separador nem palavra: só a regra de caixa alta pega",
  pega({ channel: "<SEUCANAL>" }));
t("`< SEU_CANAL >` com padding ainda é marcador — o trim é de propósito",
  pega({ channel: "envie para < SEU_CANAL > agora" }));
t("`<nome da tabela>` com espaço dentro", pega({ tableId: "<nome da tabela>" }));
t("marcador FUNDO num objeto aninhado",
  pega({ columns: { value: [{ nome: "telefone", valor: "[PREENCHER]" }] } }));
t("marcador dentro de array de string", pega({ ids: ["ok", "<ID_DO_EVENTO>"] }));

console.log("\n2. ONDE ele olha");
t("`notes` também é varrido — `applyPatch` escreve qualquer chave permitida no nó",
  pega("TODO: revisar isso depois", "notes"));
t("`addNodes.parameters` é varrido",
  !p.portaPreencher({ addNodes: [{ name: "novo", type: "n8n-nodes-base.slack", parameters: { channel: "[PREENCHER]" } }] }).ok);
t("`addNodes.name` é varrido — nó chamado `[PREENCHER]` entra no documento e vira nome de verdade",
  !p.portaPreencher({ addNodes: [{ name: "[PREENCHER]", type: "n8n-nodes-base.slack", parameters: {} }] }).ok);
t("`rewire` NÃO é varrido: só carrega topologia, não tem parâmetro para deixar por preencher",
  p.portaPreencher({ rewire: { "no_a": { main: [[{ node: "<SEU_DESTINO>", type: "main", index: 0 }]] } } }).ok);
t("patch vazio não reprova nada", p.portaPreencher({}).ok);
t("patch que não é objeto não explode", p.portaPreencher(null).ok && p.portaPreencher([1, 2]).ok);
t("o nome do nó NÃO é varrido em updateNodes — ele é chave de busca, não valor escrito",
  p.portaPreencher({ updateNodes: [{ name: "no_com_TODO: no nome", parameters: { a: "ok" } }] }).ok);

console.log("\n3. O QUE ELE NÃO PODE PEGAR — cada caso é um patch correto que seria rejeitado");
t("`<br>` num corpo de e-mail", passa({ html: "Linha um<br>Linha dois" }));
t("`<br/>` auto-fechado", passa({ html: "Linha um<br/>Linha dois" }));
t("`<BR>` em caixa alta ainda é tag", passa({ html: "Linha um<BR>Linha dois" }));
t("`<p>` e `</p>`", passa({ html: "<p>Olá</p>" }));
t("`<a href=\"...\">` com atributo", passa({ html: '<a href="https://ecommercepuro.com.br">clique</a>' }));
t("`<div class=\"x\">` com classe", passa({ html: '<div class="wrap"><span>oi</span></div>' }));
t("XML inventado num corpo de httpRequest — fechado, logo é markup",
  passa({ body: "<pedido><id>1</id><total>99</total></pedido>" }));
t("tag de seção num system prompt de agente — o do agente vivo tem 71.705 caracteres",
  passa({ systemMessage: "<exemplo>lead pergunta o preço</exemplo>\n<regra>nunca invente valor</regra>" }));
t("comparação numa expressão n8n", passa({ v: "={{ $json.total < 5 }}" }));
t("comparação dos dois lados", passa({ v: "={{ $json.a < 5 && $json.b > 3 }}" }));
t("comparação COLADA, sem espaço — `x<y && z>w`", passa({ v: "={{ x<y && z>w }}" }));
/* Comparação sem operador nenhum entre os dois sinais. O que salva este caso hoje
   é a regra de alta confiança: `$json.preco` é palavra em caixa baixa sem
   separador, logo não é marcador. Houve aqui uma regra dedicada a comparação e ela
   foi removida por estar morta — este caso é o que prova que a remoção foi segura. */
t("comparação com espaço e SEM operador continua passando sem regra dedicada",
  passa({ v: "={{ $json.total < $json.preco > 0 }}" }));
t("`<=` e `>=`", passa({ v: "={{ $json.a <= 5 && $json.b >= 3 }}" }));
t("índice de array não é marcador de colchete", passa({ v: "={{ $json.itens[0].nome }}" }));
t("acesso por chave com aspas não é marcador", passa({ v: '={{ $json["telefone_normalizado"] }}' }));
t("a palavra portuguesa `todo:` em caixa baixa NÃO reprova — `todo` é palavra comum",
  passa({ texto: "Enviado para todo: cliente ativo" }));
/* Os três abaixo NÃO são inventados: saíram de varrer 3.649 nós de 32 fluxos de
   produção desta instância. Cada um foi um falso positivo de verdade antes da
   regra de alta confiança, e os três juntos eram 3 dos 4 marcadores distintos que
   o portão achava — 75% de ruído. */
t("MEDIDO: regex de HTML dentro de `jsCode` — `<\\/(p|div|li)>`",
  passa({ jsCode: "html.replace(/<\\/(p|div|li)>/gi, '\\n').replace(/<[^>]*>/g, '')" }));
t("MEDIDO: tag SSML CITADA em prosa num system prompt de agente",
  passa({ systemMessage: "NUNCA use tags SSML (<break>, <prosody>, etc) — o ElevenLabs não aceita" }));
t("MEDIDO: template de instrução dentro do prompt do agente",
  passa({ systemMessage: 'motivo: "<verbatim of what the lead asked>", urgencia: 3' }));
t("o preço declarado da inversão: `<canal>`, palavra única em caixa baixa, NÃO é pega",
  passa({ channel: "<canal>" }));
t("XML de tag em CAIXA ALTA mas FECHADA — só a regra do fechamento salva",
  passa({ body: "<NOME>João</NOME><ID_PEDIDO>42</ID_PEDIDO>" }));
t("`<!-- comentário -->` é markup", passa({ html: "<!-- não mexer -->" }));
t("`<!DOCTYPE html>`", passa({ html: "<!DOCTYPE html>" }));
t("valor que não é string passa direto", passa({ n: 42, b: true, z: null }));
t("string vazia passa", passa({ v: "" }));
t("um `[` sozinho sem palavra de marcador passa", passa({ v: "faixa [1..10] de preço" }));
t("seta e sinal de menor sem par passam", passa({ v: "preço < 100 reais" }));

console.log("\n4. a recusa NOMEIA o nó e o caminho — senão o modelo reescreve o documento inteiro");
{
  const r = p.portaPreencher(up({ columns: { value: [{ nome: "telefone", valor: "[PREENCHER]" }] } }));
  t("o achado carrega o nome do nó", r.achados[0].no === "supabase_gravar_lead");
  t("o caminho é o do n8n: `parameters.columns.value[0].valor`",
    r.achados[0].caminho === "parameters.columns.value[0].valor");
  t("o caminho aparece na frase que volta para o modelo",
    /parameters\.columns\.value\[0\]\.valor/.test(r.erros[0]));
  t("a frase nomeia o nó", /supabase_gravar_lead/.test(r.erros[0]));
  t("a frase diz que o destino é produção", /produção/.test(r.erros[0]));
  t('a frase manda PERGUNTAR com `tipo: "resposta"` em vez de deixar o marcador',
    /tipo: "resposta"/.test(r.erros[0]) && /pergunte/.test(r.erros[0]));
  t("o verbo do patch viaja no achado", r.achados[0].verbo === "updateNodes");
}
{
  const r = p.portaPreencher(up({ p: "x".repeat(5000) + "[PREENCHER]" + "y".repeat(5000) }));
  t("o trecho é CORTADO — um system prompt de 71.705 caracteres não viaja dentro de outro prompt",
    r.erros[0].length < 600);
}

console.log("\n5. tetos: quem desiste diz que desistiu");
{
  /* Um portão que parou de olhar e devolve `ok` é pior que portão nenhum: a tela
     fica verde e ninguém sabe que a varredura não terminou. */
  const fundo = (n) => n ? { a: fundo(n - 1) } : "[PREENCHER]";
  const r = p.portaPreencher(up(fundo(p.PROF_MAX + 5)));
  t("aninhamento fundo demais vira AVISO, não silêncio", r.avisos.length > 0 && /aninhamento/.test(r.avisos.join(" ")));

  const muitas = {};
  for (let i = 0; i < p.STRINGS_MAX + 50; i++) muitas["k" + i] = "valor limpo";
  const r2 = p.portaPreencher(up(muitas));
  t("string demais vira AVISO nomeando o teto", r2.avisos.length > 0 && /strings/.test(r2.avisos.join(" ")));
}

console.log("\n6. o portão julga o que o PATCH escreve, nunca o documento");
t("um fluxo cheio de `[PREENCHER]` antigo não é problema deste portão: ele só recebe o patch",
  p.portaPreencher({ updateNodes: [{ name: "no_limpo", parameters: { a: "valor certo" } }] }).ok);

console.log("\n" + (falhas ? "FALHOU " + falhas + " de " + total : "tudo verde: " + total + " casos"));
process.exit(falhas ? 1 : 0);
