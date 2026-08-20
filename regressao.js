"use strict";
/* regressao.js — as checagens 5a e 5b da bateria do §5 do `PLAN-UPGRADE.md`.
 *
 * As duas respondem à mesma pergunta por caminhos opostos: **o que já funcionava
 * continua funcionando?** A 5a mede o encanamento contra execuções que de fato
 * aconteceram; a 5b deriva o conteúdo que sairia, antes e depois, pelo fantasma.
 *
 * NADA AQUI BUSCA NADA. As duas recebem o que já foi respondido e devolvem uma
 * linha. É a mesma disciplina de `resolverAlvo` no `upgrade.js`: o veredito é
 * função pura sobre a evidência, e o invólucro que fala com a rede fica do lado
 * de fora. Sem isso os cinco estados de cor só seriam testáveis com uma
 * instância viva na frente — que é o mesmo que dizer não testáveis.
 *
 * Nenhuma das duas monta a bateria: cada uma produz UMA linha, no formato
 *
 *   { n, nome, cor: "ok"|"warn"|"risk"|"cold", frase, detalhe: null | ["…"] }
 *
 * e quem decide o que fazer com a cor é o `bateria.js`, e quem a pinta é a
 * página. Este arquivo emite fatos.
 */

const agentes = require("./agentes.js");
const { simulate, NAO_SIMULADA } = require("./simulate.js");

/* A amostra do §5.5: todas as execuções com erro da janela mais as N mais
 * recentes bem-sucedidas. `N_INICIAL` é pequeno de propósito — cada detalhe com
 * `runData` é multi-MB, e `WhatsApp API Oficial` fez 751 execuções em 24h nesta
 * instância. Buscar todas não é uma opção que exista.
 *
 * `N_EXPANDIDO` é a segunda e ÚLTIMA tentativa. Não há terceira: uma expansão
 * que insiste vira a busca de 751 execuções por outro nome. */
const N_INICIAL = 5;
const N_EXPANDIDO = 20;

/* Quantas execuções bastam para uma cobertura deixar de ser magra. Abaixo disto
   a linha passa, mas com ressalva: um nó visto uma vez só não prova rotina. */
const COBERTURA_MAGRA = 2;

/* Chave composta é SEMPRE `JSON.stringify` de um array. Concatenar à mão já
   falhou em silêncio três vezes neste repositório (U+0000 no `nodeOrigin`,
   U+001F no `n8n.js`, U+0000 no `catalog.js`), e um nome de nó pode conter
   qualquer coisa — inclusive o separador que alguém escolhesse. */
const arestaKey = (de, para) => JSON.stringify([String(de), String(para)]);

const nosDe = wf => new Map(((wf && wf.nodes) || []).map(n => [String(n.name), n]));

/* Todas as arestas do documento, como pares origem→destino.
 *
 * A porta e o índice do ramo NÃO entram na chave, e isso é calibração, não
 * descuido: `previousNodeOutput` do `runData` é o índice da saída, mas o payload
 * não registra o NOME da porta, então um nó de agente (`ai_tool`, `ai_memory`)
 * casaria contra `main` e sairia vermelho sem nada ter quebrado. Um vermelho
 * falso aqui é pior que um verde generoso: ele ensina a ignorar a bateria, e é
 * a bateria que decide se o botão de aplicar aparece. */
function arestas(wf) {
  const out = new Set();
  for (const [de, portas] of Object.entries((wf && wf.connections) || {})) {
    for (const ramos of Object.values(portas || {})) {
      for (const ramo of ramos || []) {
        for (const c of ramo || []) {
          if (c && c.node) out.add(arestaKey(de, c.node));
        }
      }
    }
  }
  return out;
}

/* O que o patch TOCA, separado em duas listas que têm destinos diferentes.
 *
 * `preexistentes` é o que a cobertura exige ver na amostra. `criados` fica de
 * fora dessa exigência pelo motivo mais simples possível: um nó que nasce neste
 * patch nunca executou, então nenhuma amostra do mundo o conteria, e cobrá-lo
 * deixaria a 5a cinza para sempre em todo patch que acrescenta nó. Que ele possa
 * ser inserido no meio de um caminho preservado sem a 5a notar é verdade — e é
 * uma das três coisas que a linha diz que ela não pega. */
function tocados(patch, antes) {
  const existe = nosDe(antes);
  const preexistentes = new Set();
  const criados = new Set();

  for (const u of (patch && patch.updateNodes) || []) {
    const nome = String((u && u.name) || "");
    if (nome) (existe.has(nome) ? preexistentes : criados).add(nome);
  }
  for (const a of (patch && patch.addNodes) || []) {
    const nome = String((a && a.name) || "");
    if (nome) criados.add(nome);
  }
  /* A origem de um `rewire` tem as saídas SUBSTITUÍDAS INTEIRAS — não é merge.
     Então ela é o nó cujo tráfego mais precisa ter sido olhado. */
  for (const de of Object.keys((patch && patch.rewire) || {})) {
    if (de) (existe.has(de) ? preexistentes : criados).add(de);
  }
  return { preexistentes, criados };
}

/* O que a amostra viu: quais nós rodaram e quais arestas carregaram item.
 *
 * A aresta trafegada é derivada do `src` de quem RECEBEU (`task.source[0]`,
 * primeiro não-nulo — o array vem com buracos numa entrada múltipla). É a aresta
 * de verdade, registrada pelo n8n, e não o vizinho na ordem de execução: com um
 * `Wait` dentro de laço os dois são nós diferentes, e essa lição este repositório
 * já pagou no resumo da execução.
 *
 * Um único conjunto de arestas serve às duas exigências do §5.4 — "mesma aresta
 * alimentadora" e "as saídas que carregavam tráfego seguem ligadas" — porque são
 * o mesmo conjunto visto de cada ponta. Derivar duas vezes seria abrir espaço
 * para as duas divergirem. */
function oQueRodou(amostra) {
  const nos = new Map();        // nome -> quantas execuções o viram
  const ares = new Map();       // arestaKey -> { de, para, vezes }
  let lidas = 0;

  for (const ex of amostra || []) {
    if (!ex || !Array.isArray(ex.nodeRuns)) continue;
    lidas++;
    const vistosNesta = new Set();
    for (const r of ex.nodeRuns) {
      const nome = String((r && r.name) || "");
      if (!nome) continue;
      if (!vistosNesta.has(nome)) {
        vistosNesta.add(nome);
        nos.set(nome, (nos.get(nome) || 0) + 1);
      }
      const de = r.src && r.src.no ? String(r.src.no) : null;
      if (!de) continue;
      const k = arestaKey(de, nome);
      const t = ares.get(k) || { de, para: nome, vezes: 0 };
      t.vezes++;
      ares.set(k, t);
    }
  }
  return { nos, ares, lidas };
}

/* O que a 5a estruturalmente não alcança. Isto vai para a tela SEMPRE, inclusive
 * no verde, e não é modéstia: é o que impede alguém de ler "5a verde" como "o
 * fluxo continua fazendo a mesma coisa". Ela prova que o encanamento continua
 * ligado; nunca que a água que passa por ele é a mesma. */
const NAO_PEGA = [
  "não pega: mudança de parâmetro dentro de um nó que continuou no mesmo lugar",
  "não pega: nó novo inserido no meio de um caminho que foi preservado",
  "não pega: troca de semântica sob o mesmo `type` e o mesmo `typeVersion`"
];

/* ───────────────────────────────────────── 5a — regressão de caminho ──────── */

/* Continuidade estrutural mínima, MEDIDA contra execuções que aconteceram. Roda
 * no Iago de 179 nós, onde o fantasma nunca rodou — é o piso que existe
 * justamente onde a 5b não alcança.
 *
 * `expandir` é opcional e vem de quem chama: `async ({ n, vizinhos }) => [execuções]`.
 * Ela é chamada NO MÁXIMO UMA VEZ, e só quando a amostra inicial não cobriu algum
 * alvo. Sem ela, a falta de cobertura vai direto para o cinza — que é a resposta
 * certa, só que sem a segunda chance. */
async function regressaoCaminho({ antes, depois, patch, amostra, expandir } = {}) {
  const linha = { n: "5a", nome: "Regressão de caminho", cor: "cold", frase: "", detalhe: null };

  const alvos = tocados(patch, antes);
  let visto = oQueRodou(amostra);

  /* Falta de cobertura é o que dispara a expansão, e ela é medida contra os nós
     PREEXISTENTES tocados: são os únicos sobre os quais faz sentido afirmar
     continuidade. */
  let fora = [...alvos.preexistentes].filter(nome => !visto.nos.has(nome));

  /* UMA tentativa, e o código diz isso em vez de deixar o `if` insinuar. A
     diferença não é estilo: o `try` abaixo fica DENTRO desta região, então um
     laço aqui engoliria a própria falha da expansão e giraria para sempre — e um
     laço infinito não volta vermelho no teste, ele pendura, que é CI parado e
     ninguém lê isso como defeito. Com a trava explícita, a segunda tentativa é
     recusada mesmo que alguém troque a condição. */
  let jaExpandiu = false;
  if (fora.length && typeof expandir === "function" && !jaExpandiu) {
    jaExpandiu = true;
    try {
      const mais = await expandir({ n: N_EXPANDIDO, vizinhos: vizinhosDe(antes, alvos.preexistentes) });
      if (Array.isArray(mais) && mais.length) {
        visto = oQueRodou([...(amostra || []), ...mais]);
        fora = [...alvos.preexistentes].filter(nome => !visto.nos.has(nome));
      }
    } catch (e) {
      /* Uma expansão que falhou não é uma expansão que não achou nada: o cinza
         abaixo é o mesmo, mas o motivo escrito muda, e o motivo é o que decide
         se ele tenta de novo ou vai olhar no n8n. */
      linha.detalhe = ["a busca por mais execuções falhou: " + String((e && e.message) || e).slice(0, 160)];
    }
  }

  if (!visto.lidas) {
    linha.cor = "cold";
    linha.frase = "não li execução nenhuma deste fluxo na janela, então não tenho caminho para comparar.";
    linha.detalhe = (linha.detalhe || []).concat(NAO_PEGA);
    return linha;
  }

  /* §5.5 — a regra que fecha o verde falso. Se um alvo não apareceu na amostra,
     a checagem não olhou o caminho que está sendo mexido, e "não olhei" não pode
     se vestir de "está bom". CINZA, nunca verde, com os nomes na tela. */
  if (fora.length) {
    linha.cor = "cold";
    linha.frase = "li " + visto.lidas + " execução(ões) e nenhuma passou por "
      + fora.map(n => "`" + n + "`").join(", ")
      + " — não olhei o caminho que este patch mexe, então não posso dizer que ele continua de pé.";
    linha.detalhe = (linha.detalhe || []).concat(
      ["alvos fora da amostra: " + fora.join(", ")],
      NAO_PEGA
    );
    return linha;
  }

  const depoisNos = nosDe(depois);
  const antesNos = nosDe(antes);
  const depoisAres = arestas(depois);

  const quebras = [];
  const ressalvas = [];

  for (const [nome, vezes] of visto.nos) {
    const a = antesNos.get(nome);
    const d = depoisNos.get(nome);
    if (!a) continue;   // rodou mas não está no documento de hoje: não é deste patch

    if (!d) { quebras.push("`" + nome + "` sumiu, e ele rodou em " + vezes + " execução(ões) da amostra"); continue; }
    if (String(a.type) !== String(d.type)) {
      quebras.push("`" + nome + "` trocou de `type` (" + a.type + " → " + d.type + "), com tráfego na amostra");
    }
    if (String(a.typeVersion) !== String(d.typeVersion)) {
      quebras.push("`" + nome + "` trocou de `typeVersion` (" + a.typeVersion + " → " + d.typeVersion + "), com tráfego na amostra");
    }
    /* Desligar é o mecanismo que substitui o delete aqui (§4.2), então não é
       defeito — mas desligar um nó com tráfego é a definição de "passou, mas
       você precisa saber disso". A contagem medida é o que torna a ressalva
       acionável em vez de genérica. */
    if (!a.disabled && d.disabled) {
      ressalvas.push("`" + nome + "` foi DESLIGADO e rodou em " + vezes + " execução(ões) da amostra");
    }
    if (vezes < COBERTURA_MAGRA && alvos.preexistentes.has(nome)) {
      ressalvas.push("`" + nome + "` apareceu em " + vezes + " execução só — cobertura magra para afirmar rotina");
    }
  }

  for (const [, t] of visto.ares) {
    if (!antesNos.has(t.de) || !antesNos.has(t.para)) continue;
    if (!depoisAres.has(arestaKey(t.de, t.para))) {
      quebras.push("a ligação `" + t.de + "` → `" + t.para + "` carregou item em "
        + t.vezes + " run(s) da amostra e não existe mais");
    }
  }

  /* Uma saída REMOVIDA que não carregou nada na amostra não é vermelho: pode ser
     ramo morto, e reprovar por isso seria reprovar limpeza legítima. Mas também
     não é nada: a amostra é pequena por construção, e "não trafegou no que eu li"
     está a um passo de virar "não trafega" na cabeça de quem lê. */
  const antesAres = arestas(antes);
  for (const k of antesAres) {
    if (depoisAres.has(k)) continue;
    const [de, para] = JSON.parse(k);
    if (!alvos.preexistentes.has(de)) continue;
    if (visto.ares.has(k)) continue;   // trafegou: já virou quebra acima
    ressalvas.push("a ligação `" + de + "` → `" + para + "` foi removida e não trafegou na amostra "
      + "— pode ser ramo morto, mas eu só li " + visto.lidas + " execução(ões)");
  }

  if (quebras.length) {
    linha.cor = "risk";
    linha.frase = "o caminho que roda hoje não sobrevive a este patch: " + quebras.length + " quebra(s) medida(s).";
    linha.detalhe = (linha.detalhe || []).concat(quebras, NAO_PEGA);
    return linha;
  }

  const base = "li " + visto.lidas + " execução(ões) e o caminho trafegado continua de pé: "
    + visto.nos.size + " nó(s) e " + visto.ares.size + " ligação(ões) conferidos.";

  if (ressalvas.length) {
    linha.cor = "warn";
    linha.frase = base + " Com ressalva.";
    linha.detalhe = (linha.detalhe || []).concat(ressalvas, NAO_PEGA);
    return linha;
  }

  linha.cor = "ok";
  linha.frase = base + " Isto prova que o encanamento continua ligado, não que a água que passa por ele é a mesma.";
  linha.detalhe = (linha.detalhe || []).concat(NAO_PEGA);
  return linha;
}

/* Vizinhos de um salto dos alvos — a dica que `expandir` usa para preferir
   execuções que passaram por perto, em vez de trazer mais 20 quaisquer. */
function vizinhosDe(wf, alvos) {
  const out = new Set();
  for (const [de, portas] of Object.entries((wf && wf.connections) || {})) {
    for (const ramos of Object.values(portas || {})) {
      for (const ramo of ramos || []) {
        for (const c of ramo || []) {
          if (!c || !c.node) continue;
          if (alvos.has(de)) out.add(String(c.node));
          if (alvos.has(String(c.node))) out.add(de);
        }
      }
    }
  }
  for (const a of alvos) out.delete(a);
  return [...out];
}

/* ──────────────────────────────────────── 5b — regressão de conteúdo ──────── */

/* O fantasma antes e depois: o que o fluxo MANDARIA muda?
 *
 * O cinza é o caso comum aqui, e o número é a razão de ele não bloquear. Medido
 * 2026-08-13 na instância viva: dos 73 fluxos, 46 (63%) contêm tipo que o
 * fantasma recusa por princípio; dos 32 fluxos com 10+ nós, 29 recusam (91%).
 * Uma regra literal de "todos os sete verdes" faria esta aba não aplicar em
 * agente nenhum, e a cobertura restante seriam três fluxos descartáveis. */
function regressaoConteudo({ antes, depois, seeds } = {}) {
  const linha = { n: "5b", nome: "Regressão de conteúdo", cor: "cold", frase: "", detalhe: null };

  /* §5.6 — a interceptação vem ANTES do `simulate`, e a diferença é o que a
     frase diz. O fantasma recusaria de qualquer jeito (um agente é feito dos
     tipos que ele declina por princípio), mas diria "expressão fora do
     subconjunto" — que manda o Kauan caçar um problema de expressão que não
     existe. E rodar para descobrir isso gastaria sementes que ninguém leria. */
  const ag = agentes.recusaFantasma(depois) || agentes.recusaFantasma(antes);
  if (ag) {
    linha.cor = "cold";
    linha.frase = ag.recusa + ".";
    linha.detalhe = [ag.detalhe];
    return linha;
  }

  const opc = seeds ? { seeds } : {};
  const a = simulate(antes, opc);
  const d = simulate(depois, opc);

  if (!a.ok || !d.ok) {
    linha.cor = "cold";
    linha.frase = "o fantasma não consegue derivar este fluxo, então não tenho antes e depois para comparar.";
    linha.detalhe = [(!a.ok ? "antes: " + a.recusa : null), (!d.ok ? "depois: " + d.recusa : null)].filter(Boolean);
    return linha;
  }

  const porNo = s => new Map((s.superficies || []).map(x => [String(x.no), x]));
  const A = porNo(a), D = porNo(d);

  const sumiram = [...A.keys()].filter(k => !D.has(k));
  const nasceram = [...D.keys()].filter(k => !A.has(k));
  const mudaram = [];
  const quebraram = [];

  for (const [no, sa] of A) {
    const sd = D.get(no);
    if (!sd) continue;
    const ea = JSON.stringify(sa.envio || {});
    const ed = JSON.stringify(sd.envio || {});
    if (ea === ed) continue;

    /* Um campo que resolvia e passou a sair como `⟨não simulada⟩` é expressão
       quebrada — a única diferença aqui que é defeito por si, e não intenção. */
    const quebrou = Object.entries(sd.envio || {}).some(([campo, valor]) =>
      String(valor).includes(NAO_SIMULADA)
      && !String((sa.envio || {})[campo] ?? "").includes(NAO_SIMULADA));

    (quebrou ? quebraram : mudaram).push({ no, antes: sa.envio, depois: sd.envio });
  }

  if (quebraram.length) {
    linha.cor = "risk";
    linha.frase = "depois do patch, " + quebraram.length + " envio(s) deixaram de resolver: uma expressão quebrou.";
    linha.detalhe = quebraram.map(q => "`" + q.no + "` passou a mandar " + JSON.stringify(q.depois));
    return linha;
  }

  if (sumiram.length || nasceram.length || mudaram.length) {
    linha.cor = "warn";
    linha.frase = "o fluxo continua derivável e o que ele manda MUDOU — confira se a mudança é a que você pediu.";
    linha.detalhe = [
      ...sumiram.map(n => "`" + n + "` deixou de mandar"),
      ...nasceram.map(n => "`" + n + "` passou a mandar"),
      ...mudaram.map(m => "`" + m.no + "`: antes " + JSON.stringify(m.antes) + " · depois " + JSON.stringify(m.depois))
    ];
    return linha;
  }

  linha.cor = "ok";
  linha.frase = "o que este fluxo manda não mudou: " + A.size + " destino(s) derivados, idênticos antes e depois.";
  linha.detalhe = null;
  return linha;
}

module.exports = {
  regressaoCaminho, regressaoConteudo,
  // exportados para teste e para quem for calibrar
  tocados, oQueRodou, arestas, vizinhosDe, arestaKey,
  N_INICIAL, N_EXPANDIDO, COBERTURA_MAGRA, NAO_PEGA
};
