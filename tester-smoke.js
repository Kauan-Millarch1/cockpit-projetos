/* tester-smoke.js — a fatia vertical, sem interface.
 *
 * Roda uma ideia pela esteira inteira e imprime o que acontece. Existe porque o
 * que decide se o Tester presta não é a tela: é se o fluxo que sai da ponta é
 * bom. Uma tela bonita em cima de um fluxo errado é pior que nenhuma tela.
 *
 * Uso: node tester-smoke.js ["a ideia"] [--nivel "sou técnico"]
 * ATENÇÃO: gasta cota do plano de verdade. Não é um teste unitário.
 */

"use strict";

const tester = require("./tester");

const args = process.argv.slice(2);
const iNivel = args.indexOf("--nivel");
const nivel = iNivel >= 0 ? args[iNivel + 1] : "sou técnico";
const ideia = args.filter((a, i) => a !== "--nivel" && i !== iNivel + 1)[0]
  || "todo dia às 9h da manhã, pegar as tarefas abertas do ClickUp e mandar um resumo no Slack";

const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";

(async () => {
  const st = tester.status();
  console.log("CLI: " + (st.cliEncontrado ? "ok" : "NÃO ENCONTRADO") + "   n8n: " + (st.n8nConfigurado ? "ok" : "NÃO CONFIGURADO"));
  console.log("modelos: conversa=" + st.modelos.conversa + " construção=" + st.modelos.construcao + "   auth: " + st.autenticacao);
  console.log("sandbox: " + (st.sandbox ? "ligado" : "desligado") + "   teto: US$" + st.tetoUsd);
  console.log("\nideia: «" + ideia + "»   nível: " + nivel + "\n");

  const { id } = await tester.iniciar({ ideia, nivel });

  let esperou1 = false, fim = false;
  tester.assinar(id, (tipo, d) => {
    if (tipo === "etapa")     console.log(seg() + "  [" + String(d.etapa).padStart(2, "0") + "] " + d.estado + (d.nota ? " — " + d.nota : ""));
    else if (tipo === "atividade") process.stdout.write("\r" + seg() + "       " + String(d.atividade).slice(0, 90).padEnd(92) + "\r");
    else if (tipo === "custo") { const t = d.custo.reduce((a, c) => a + (c.usd || 0), 0); process.stdout.write(seg() + "       custo acumulado US$" + t.toFixed(3) + "\n"); }
    else if (tipo === "fim")  fim = true;
  });

  const ate = async cond => { while (!cond()) await new Promise(r => setTimeout(r, 400)); };

  // ---- etapa 01: o portão de intenção
  await ate(() => { const s = tester.pegar(id); return s.status !== "correndo"; });
  let s = tester.pegar(id);
  if (s.status === "falhou") { console.log("\nFALHOU na etapa 1: " + s.erro); process.exit(1); }

  console.log("\n--- o que ele entendeu ---");
  for (const [k, v] of Object.entries(s.entendi || {})) console.log("  " + k.padEnd(11) + v);
  if (s.perguntas.length) {
    console.log("--- perguntas ---");
    s.perguntas.forEach(q => console.log("  ? " + q.q + "   [" + (q.opcoes || []).join(" | ") + "]"));
  }
  if (s.achados.length) {
    console.log("--- achados ---");
    s.achados.forEach(a => console.log("  " + String(a.tipo).toUpperCase().padEnd(6) + a.texto + "   (" + a.fonte + ")"));
  }
  console.log("  serviços detectados: " + (s.servicos || []).join(", "));

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
  s.custo.forEach(c => console.log("  " + c.sessao.padEnd(16) + "US$" + (c.usd || 0).toFixed(3) + "   " + (c.ms / 1000).toFixed(1) + "s" + (c.comRede ? "   (com rede)" : "")));
  console.log("  TOTAL US$" + s.custoTotal + "   parede " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  if (s.erro) console.log("\nERRO: " + s.erro);
  process.exit(0);
})().catch(e => { console.error("\nquebrou: " + (e && e.stack || e)); process.exit(1); });
