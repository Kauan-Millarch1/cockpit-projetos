/* tester-smoke.js — a fatia vertical, sem interface.
 *
 * Roda uma ideia pela esteira inteira e imprime o que acontece. Existe porque o
 * que decide se o Tester presta não é a tela: é se o fluxo que sai da ponta é
 * bom. Uma tela bonita em cima de um fluxo errado é pior que nenhuma tela.
 *
 * Uso: node tester-smoke.js ["a ideia"] [--nivel "sou técnico"] [--rodadas N]
 *
 * `--rodadas N` responde a entrevista sozinho, escolhendo a PRIMEIRA opção de
 * cada pergunta, até N rodadas ou até o modelo parar de perguntar. Sem isso o
 * smoke manda "pode seguir" na primeira parada — o que testa o caminho das
 * suposições, e não o da entrevista. Num agente a entrevista é a metade que
 * importa: são doze decisões, e pular todas produz um fluxo montado em cima de
 * palpites. Use `--rodadas 4` para medir o que o Kauan vai ver de verdade.
 *
 * ATENÇÃO: gasta cota do plano de verdade. Não é um teste unitário.
 */

"use strict";

const tester = require("./tester");

const args = process.argv.slice(2);
const iNivel = args.indexOf("--nivel");
const nivel = iNivel >= 0 ? args[iNivel + 1] : "sou técnico";
const iRod = args.indexOf("--rodadas");
const maxRodadas = iRod >= 0 ? Number(args[iRod + 1]) || 0 : 0;
const consumidos = new Set([iNivel, iNivel + 1, iRod, iRod + 1].filter(i => i >= 0));
const ideia = args.filter((a, i) => !consumidos.has(i) && !a.startsWith("--"))[0]
  || "todo dia às 9h da manhã, pegar as tarefas abertas do ClickUp e mandar um resumo no Slack";

const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";

(async () => {
  const st = tester.status();
  console.log("CLI: " + (st.cliEncontrado ? "ok" : "NÃO ENCONTRADO") + "   n8n: " + (st.n8nConfigurado ? "ok" : "NÃO CONFIGURADO"));
  console.log("modelos: conversa=" + st.modelos.conversa + " construção=" + st.modelos.construcao + "   auth: " + st.autenticacao);
  console.log("sandbox: " + (st.sandbox ? "ligado" : "desligado") + "   teto: US$" + st.tetoUsd);
  const da = st.docAgentes || {};
  console.log("doc de agentes: " + (da.encontrado ? da.chars + " chars, blocos [" + (da.blocos || []).join(", ") + "]" : "NÃO ENCONTRADO")
    + (da.faltando && da.faltando.length ? "   FALTANDO: " + da.faltando.join(", ") : ""));
  console.log("\nideia: «" + ideia + "»   nível: " + nivel + (maxRodadas ? "   entrevista: até " + maxRodadas + " rodadas" : "   entrevista: pulada") + "\n");

  const { id } = await tester.iniciar({ ideia, nivel });

  let esperou1 = false, fim = false;
  tester.assinar(id, (tipo, d) => {
    if (tipo === "etapa")     console.log(seg() + "  [" + String(d.etapa).padStart(2, "0") + "] " + d.estado + (d.nota ? " — " + d.nota : ""));
    else if (tipo === "atividade") process.stdout.write("\r" + seg() + "       " + String(d.atividade).slice(0, 90).padEnd(92) + "\r");
    /* Warning e erro TÊM que aparecer. Sem isto uma rodada morta por tempo é
       invisível: o smoke mostrava a etapa 04 "correndo" por dez minutos enquanto
       a construção era morta, recomeçada e morta de novo — e o único sinal era o
       custo acumulado que não subia. */
    else if (tipo === "log" && d.nivel && d.nivel !== "info") {
      process.stdout.write("\n" + seg() + "  " + (d.nivel === "erro" ? "ERRO" : "AVISO") + ": " + d.texto + "\n");
    }
    else if (tipo === "custo") {
      const t = d.custo.reduce((a, c) => a + (c.usd || 0), 0);
      const cegos = d.custo.filter(c => c.usdDesconhecido).length;
      process.stdout.write(seg() + "       custo medido US$" + t.toFixed(3) +
        (cegos ? "  (+" + cegos + " rodada(s) sem custo medido — interrompidas antes de reportar)" : "") + "\n");
    }
    else if (tipo === "fim")  fim = true;
  });

  const ate = async cond => { while (!cond()) await new Promise(r => setTimeout(r, 400)); };

  // ---- etapa 01: o portão de intenção
  await ate(() => { const s = tester.pegar(id); return s.status !== "correndo"; });
  let s = tester.pegar(id);
  if (s.status === "falhou") { console.log("\nFALHOU na etapa 1: " + s.erro); process.exit(1); }

  const mostrarEntendimento = s => {
    console.log("\n--- o que ele entendeu (rodada " + (s.rodadaEntrevista || 1) + ") ---");
    console.log("  " + "classificação".padEnd(16) + (s.ehAgente === null ? "?" : s.ehAgente ? "AGENTE CONVERSACIONAL" : "automação")
      + (s.ehAgentePorque ? "   (" + s.ehAgentePorque + ")" : ""));
    for (const [k, v] of Object.entries(s.entendi || {})) console.log("  " + k.padEnd(16) + v);
    if (s.perguntas.length) {
      console.log("--- perguntas (" + s.perguntas.length + ") ---");
      s.perguntas.forEach(q => console.log("  ? " + q.q + "\n      [" + (q.opcoes || []).join(" | ") + "]"));
    } else console.log("--- sem perguntas: o portão está liberado ---");
  };

  mostrarEntendimento(s);
  console.log("  serviços detectados: " + (s.servicos || []).join(", "));

  /* A entrevista, respondida escolhendo sempre a primeira opção. Não é uma
   * resposta boa — é uma resposta CONSISTENTE, que é o que um teste precisa. O
   * que se mede aqui é se as rodadas convergem e se as perguntas mudam de
   * assunto, não se o fluxo final é o ideal. */
  let rodada = 1;
  while (maxRodadas && rodada < maxRodadas && s.perguntas.length) {
    const respostas = s.perguntas.map(q => ({ q: q.q, r: (q.opcoes && q.opcoes[0]) || "tanto faz" }));
    console.log("\n>>> respondendo a rodada " + rodada + " com a primeira opção de cada:");
    respostas.forEach(r => console.log("    " + r.q.slice(0, 62).padEnd(64) + "-> " + r.r));
    await tester.responder(id, { respostas });
    await ate(() => { const x = tester.pegar(id); return x.status !== "correndo"; });
    s = tester.pegar(id);
    if (s.status === "falhou") { console.log("\nFALHOU na entrevista: " + s.erro); process.exit(1); }
    rodada++;
    mostrarEntendimento(s);
  }

  if (s.achados.length) {
    console.log("\n--- achados ---");
    s.achados.forEach(a => console.log("  " + String(a.tipo).toUpperCase().padEnd(6) + a.texto + "   (" + a.fonte + ")"));
  }
  if (s.respostas && s.respostas.length) console.log("\n  respostas acumuladas: " + s.respostas.length);

  console.log("\n>>> respondendo 'pode seguir' e soltando a esteira\n");
  esperou1 = true;
  await tester.responder(id, { seguir: true });

  // ---- até a parada da etapa 06 (ou falha)
  await ate(() => { const x = tester.pegar(id); return x.status === "aguardando" || x.status === "falhou" || fim; });
  s = tester.pegar(id);

  console.log("\n--- portões ---");
  if (!s.gates) console.log("  (não chegou a validar)");
  else if (s.gates.passou) console.log("  passou na rodada " + s.gates.rodada);
  else s.gates.falhas.forEach(f => console.log("  ! " + f));

  if (s.wf) {
    console.log("\n--- fluxo (" + s.wf.nodes.length + " nós) ---");
    for (const n of s.wf.nodes) {
      const pv = (s.provenance || {})[n.name] || {};
      console.log("  " + n.name.padEnd(26) + String(n.type).replace("n8n-nodes-base.", "").padEnd(18) + "v" + n.typeVersion + "   origem:" + pv.origem);
    }
    console.log("  conexões: " + Object.keys(s.wf.connections || {}).length + " nós com saída");
    console.log("  chaves de topo: " + Object.keys(s.wf).join(", "));
    console.log("  tem `credentials`? " + (JSON.stringify(s.wf).includes('"credentials"') ? "SIM (BUG)" : "não"));
    console.log("  tem `active`? " + (JSON.stringify(s.wf).includes('"active"') ? "SIM (BUG)" : "não"));

    /* O checklist das sete camadas. É a única medida honesta de se o doc de
     * agentes serviu para alguma coisa: os portões já garantem modelo, memória,
     * parser e as portas ai_*, então o que sobra aqui é o que NÃO é obrigatório
     * e mostra se o conhecimento chegou — triagem de mídia, transcrição, bolhas
     * com pausa, gravação protegida. Um "não" não é reprovação; é o que ler no
     * `report.md` para saber se foi decisão ou esquecimento. */
    if (s.ehAgente) {
      const tipos = s.wf.nodes.map(n => String(n.type));
      const nomes = s.wf.nodes.map(n => String(n.name).toLowerCase()).join(" ");
      const bruto = JSON.stringify(s.wf);
      const tem = re => tipos.some(t => re.test(t));
      const sim = b => b ? "  sim" : "  NÃO";
      console.log("\n--- as sete camadas ---");
      console.log(sim(tem(/\.webhook$|Trigger$/)) + "  ① porta de entrada");
      console.log(sim(tem(/\.respondToWebhook$/)) + "       └ responde o webhook antes de processar");
      console.log(sim(tem(/\.(switch|if|filter)$/)) + "  ② triagem (switch/if/filter)");
      console.log(sim(/audio|imagem|image|midia|m[ií]dia/.test(nomes)) + "       └ roteia por tipo de mídia");
      console.log(sim(tem(/langchain\.openAi$/) && /transcribe|analyze/.test(bruto)) + "       └ transcreve áudio ou lê imagem");
      console.log(sim(tem(/\.wait$/) && tem(/\.redis$/)) + "  ③ buffer (wait + redis)");
      console.log(sim(/lock|processing/.test(bruto)) + "  ④ lock de processamento");
      console.log(sim(tem(/langchain\.memory/)) + "       └ memória");
      console.log(sim(tem(/langchain\.agent$/)) + "  ⑤ cérebro");
      console.log(sim(tem(/langchain\.outputParserStructured$/)) + "       └ structured output");
      console.log(sim(/"messages"/.test(bruto)) + "       └ campo `messages` no schema");
      console.log(sim(tem(/langchain\.tool/)) + "       └ tools");
      console.log(sim(tem(/\.(whatsApp|telegram)$/) || /send/i.test(bruto)) + "  ⑥ entrega");
      console.log(sim(s.wf.nodes.filter(n => /\.wait$/.test(String(n.type))).length > 1) + "       └ pausa entre bolhas (2º wait)");
      const grava = s.wf.nodes.filter(n => /\.(supabase|redis|googleSheets)$/.test(String(n.type)));
      const protegidos = grava.filter(n => n.onError === "continueRegularOutput").length;
      console.log(sim(grava.length > 0) + "  ⑦ persistência (" + grava.length + " nós)");
      console.log(sim(grava.length > 0 && protegidos >= grava.length - 2) + "       └ " + protegidos + "/" + grava.length + " com onError:continueRegularOutput");
      const retry = s.wf.nodes.filter(n => n.retryOnFail).length;
      console.log(sim(retry > 0) + "       └ " + retry + " nós com retryOnFail");
      const preencher = (bruto.match(/\[PREENCHER/g) || []).length;
      console.log("       " + preencher + " marcações [PREENCHER] no fluxo");
    }
  }

  console.log("\n--- sandbox ---");
  console.log("  " + JSON.stringify(s.sandbox));

  console.log("\n--- fantasma ---");
  if (!s.fantasma) console.log("  (não simulou)");
  else if (!s.fantasma.ok) console.log("  RECUSA: " + s.fantasma.recusa);
  else {
    s.fantasma.superficies.forEach(sf => console.log("  [" + sf.superficie + "] " + JSON.stringify(sf.envio)));
    s.fantasma.pendencias.forEach(p => console.log("  ! " + (p.no || "-") + (p.expr ? " {{" + p.expr + "}}" : "") + ": " + p.motivo));
  }
  console.log("  sementes: " + (s.sementesOrigem || "-"));

  console.log("\n--- custo ---");
  s.custo.forEach(c => console.log("  " + c.sessao.padEnd(16) +
    (c.usdDesconhecido ? "não medido" : "US$" + (c.usd || 0).toFixed(3)).padEnd(11) +
    (c.ms / 1000).toFixed(1) + "s" + (c.comRede ? "   (com rede)" : "") +
    (c.motivo ? "   " + c.motivo : "")));
  console.log("  TOTAL US$" + s.custoTotal + "   parede " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  if (s.erro) console.log("\nERRO: " + s.erro);
  process.exit(0);
})().catch(e => { console.error("\nquebrou: " + (e && e.stack || e)); process.exit(1); });
