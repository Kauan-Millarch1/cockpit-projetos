"use strict";
/* upgrade-test.js — o contrato da conversa, e cada caso recusa um defeito com nome.
 *
 * De graça: nenhum modelo, nenhum spawn, nenhuma chamada ao n8n. O que se testa
 * aqui é a fronteira por onde a resposta de um modelo entra e vira interface —
 * `validarResposta` — mais o orçamento do prompt, que é o que separa uma rodada
 * que roda de um `spawn ENAMETOOLONG`.
 *
 *   node upgrade-test.js
 */
const u = require("./upgrade.js");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const bad = m => { total++; falhas++; console.log("  FALHA " + m); };
const t = (nome, cond) => cond ? ok(nome) : bad(nome);

const NOMES = new Set(["trigger_webhook_formulario", "verificador_numero", "fim_lead_duplicado", "criar_lead_supabase"]);
/* As bases de uma sessão que tem dossiê e já pediu duas evidências. É o conjunto
   que `basesDaSessao` monta; passá-lo aqui é o que faz a checagem ser sobre ESTA
   sessão em vez de uma lista global. */
const BASES = new Set(["fluxo", "indice", "dossie", "evidencia/1-execucoes.json", "evidencia/2-saida.json"]);
const V = (j, bases) => u.validarResposta(JSON.stringify(j), NOMES, bases || BASES);
const Vbruto = s => u.validarResposta(s, NOMES, BASES);
/* Uma resposta mínima válida: o `base` passou a ser obrigatório, então todo caso
   que não é sobre `base` carrega um que existe. */
const resp = extra => Object.assign({ tipo: "resposta", texto: "o noOp não manda nada", base: ["fluxo"] }, extra);

console.log("\n1. o que NÃO é resposta válida");
t("JSON quebrado é recusado dizendo que é JSON",
  !Vbruto("{nao é json").ok && /não é JSON válido/.test(Vbruto("{nao é json").erros[0]));
t("array no lugar de objeto é recusado", !Vbruto("[1,2]").ok);
/* O exemplo de tipo desconhecido ERA "patch", e deixou de servir quando o §4.1
   tornou `patch` um tipo de verdade: o caso passaria a provar o oposto do que o
   contrato diz. Trocado por um nome que nunca vai existir. */
t("`tipo` desconhecido é recusado NOMEANDO o que veio",
  !V({ tipo: "remendo" }).ok && /"remendo"/.test(V({ tipo: "remendo" }).erros[0]));
t("`tipo` ausente é recusado", !V({ texto: "oi" }).ok);

console.log("\n2. tipo `resposta`");
t("resposta sem texto é recusada", !V(resp({ texto: "  " })).ok);
t("resposta com texto e base passa", V(resp()).ok);
t("perguntas viram no máximo 3",
  V(resp({ perguntas: ["a", "b", "c", "d", "e"] })).valor.perguntas.length === 3);
t("pergunta vazia é descartada, não vira item em branco",
  V(resp({ perguntas: ["a", "  ", ""] })).valor.perguntas.length === 1);
t("`perguntas` que não é lista não derruba",
  V(resp({ perguntas: "a,b" })).ok);

console.log("\n2b. o teto do `texto` — o que ele impede é uma rodada de reescrita");
/* Medido no teste de conversa de 2026-08-19: uma resposta de investigação foi
   recusada por tamanho e a sessão gastou uma rodada inteira reescrevendo o que já
   estava certo. As cinco respostas reais deram 988–1307 caracteres, e com
   `execIds` uma resposta passa a poder relatar até 4 execuções. */
t("o teto subiu de 2000", u.TEXTO_MAX > 2000);
t("...e cabe uma resposta que relata as 4 execuções do teto de `execIds`",
  u.TEXTO_MAX >= 4 * 435 + 988);
t("uma resposta do tamanho medido de uma real passa", V(resp({ texto: "z".repeat(1307) })).ok);
t("uma resposta de 3 mil caracteres passa", V(resp({ texto: "z".repeat(3000) })).ok);
t("acima do teto é recusado", !V(resp({ texto: "z".repeat(u.TEXTO_MAX + 1) })).ok);
/* Recusa que não diz o tamanho manda resumir no escuro: a sessão corta por
   palpite e pode gastar uma segunda rodada errando de novo. */
t("...e a recusa diz o teto E quanto veio",
  (() => { const e = V(resp({ texto: "z".repeat(u.TEXTO_MAX + 500) })).erros.join(" ");
    return e.includes(String(u.TEXTO_MAX)) && e.includes(String(u.TEXTO_MAX + 500)); })());
/* O teto que cabe numa resposta e estoura a conversa não é conserto: a pior janela
   de cinco mensagens é 3 dela no teto + 2 dele no teto de `mensagem()` (2000). */
t("cinco mensagens no teto cabem no orçamento da conversa",
  3 * u.TEXTO_MAX + 2 * 2000 <= u.ORC_CONVERSA);
/* Se o corte por mensagem ficar abaixo do teto, uma resposta longa é truncada na
   rodada seguinte — e um modelo que não sabe o que perdeu reafirma o que já tinha
   corrigido. */
t("o corte por mensagem não fica abaixo do teto da resposta", u.MSG_SLICE >= u.TEXTO_MAX);
t("e quando um corte acontece, ele se ANUNCIA no prompt",
  /cortado aqui: mais 500 caracteres/.test(
    u.ultimasAteCaber([{ de: "ele", texto: "z".repeat(u.MSG_SLICE + 500) }], u.ORC_CONVERSA).texto));

console.log("\n2c. procedência — de que a resposta se apoia, e isso é verificado");
/* O achado mais grave do teste de conversa: duas perguntas pediam comportamento
   observado ("confere numa execução se…") e foram respondidas do DOSSIE.md e do
   fluxo.json, afirmando coisas sobre o mundo — "nenhuma execução passa por ele" —
   sem abrir execução nenhuma. E nada no formato separava isso de uma resposta com
   execução real atrás: as duas chegavam com a mesma confiança. */
t("resposta SEM `base` é recusada", !V(resp({ base: undefined })).ok);
/* Ausência é estado próprio: cair no ramo de "base inválida" mandaria procurar
   erro de digitação onde o que houve foi não declarar nada. */
t("...e a recusa ENSINA o campo em vez de só negar",
  /exige o campo .base./.test(V(resp({ base: undefined })).erros[0]));
t("...listando o que existe NESTA sessão",
  /evidencia\/2-saida\.json/.test(V(resp({ base: undefined })).erros[0]));
t("...e dizendo que o dossiê não prova comportamento",
  /não prova comportamento/.test(V(resp({ base: undefined })).erros[0]));

/* Verificável, não promessa: um arquivo de evidência que não existe na sessão é
   fonte inventada — e é o único jeito de o campo virar teatro. */
const inventada = V(resp({ base: ["evidencia/9-saida.json"] }));
t("citar arquivo de evidência que NÃO existe é recusado", !inventada.ok);
t("...e a recusa lista os que existem", /evidencia\/1-execucoes\.json/.test(inventada.erros[0]));
t("citar arquivo de evidência que existe passa", V(resp({ base: ["evidencia/2-saida.json"] })).ok);
t("aceita sem o prefixo da pasta, para um prefixo não custar uma rodada",
  V(resp({ base: ["2-saida.json"] })).valor.base[0] === "evidencia/2-saida.json");
t("string solta também vale, não só lista", V(resp({ base: "dossie" })).valor.base.join() === "dossie");
t("base repetida não duplica", V(resp({ base: ["fluxo", "fluxo"] })).valor.base.length === 1);
t("valor fora do conjunto fechado é recusado", !V(resp({ base: ["achismo"] })).ok);

/* Numa sessão SEM dossiê utilizável (vermelho ou cinza não escrevem o arquivo),
   citar o dossiê é citar um arquivo que não está lá. */
const semDossie = new Set(["fluxo", "indice"]);
t("citar `dossie` numa sessão sem DOSSIE.md é recusado", !V(resp({ base: ["dossie"] }), semDossie).ok);
/* E sem evidência nenhuma a recusa tem de dizer ISSO, não "arquivo não encontrado":
   as duas frases mandam para lados opostos. */
t("...e sem evidência nenhuma a recusa manda pedir evidência primeiro",
  /peça .tipo: "pedido"/.test(V(resp({ base: undefined }), semDossie).erros[0]));
t("...e o exemplo não cita um arquivo de evidência que não existe",
  !/evidencia\//.test(V(resp({ base: undefined }), semDossie).erros[0].split("Exemplo:")[1].split("`.")[0]));

/* A distinção que tem de aparecer: as três procedências não podem ler igual. */
t("evidência de execução → procedencia `evidencia`",
  V(resp({ base: ["evidencia/2-saida.json"] })).valor.procedencia === "evidencia");
t("leitura de JSON → procedencia `codigo`", V(resp({ base: ["fluxo"] })).valor.procedencia === "codigo");
t("só o dossiê → procedencia `dossie`", V(resp({ base: ["dossie"] })).valor.procedencia === "dossie");
t("dossiê MAIS execução conta como evidência, e a lista inteira fica visível",
  (() => { const r = V(resp({ base: ["dossie", "evidencia/2-saida.json"] })).valor;
    return r.procedencia === "evidencia" && r.base.length === 2; })());
t("as três frases são distintas", new Set(Object.values(u.PROC_FRASE)).size === 3);
/* O nível do log é o que se lê como confiança. Uma resposta que não verificou nada
   entrando como `good` é o mesmo defeito do grafo vazio anunciado em verde. */
t("resposta só do dossiê NÃO entra no log como `good`", u.PROC_NIVEL.dossie === "warn");
t("...e resposta com execução atrás entra como `good`", u.PROC_NIVEL.evidencia === "good");
t("...e os três níveis são distintos", new Set(Object.values(u.PROC_NIVEL)).size === 3);

/* `basesDaSessao` é o que faz a checagem existir: ela monta o conjunto a partir do
   que REALMENTE está no diretório. */
t("sessão nova só tem o fluxo e o índice",
  [...u.basesDaSessao({})].sort().join() === "fluxo,indice");
t("dossiê utilizável entra", u.basesDaSessao({ dossie: { usa: true } }).has("dossie"));
t("dossiê vermelho NÃO entra", !u.basesDaSessao({ dossie: { usa: false, cor: "vermelho" } }).has("dossie"));
t("evidência buscada entra",
  u.basesDaSessao({ evidencias: [{ arquivo: "evidencia/1-saida.json" }] }).has("evidencia/1-saida.json"));
/* Uma busca que FALHOU tem `arquivo: null` e não deixou arquivo nenhum. Deixá-la
   entrar daria à sessão uma fonte que ela não pode abrir. */
t("evidência que FALHOU não entra como base",
  u.basesDaSessao({ evidencias: [{ arquivo: null, resumo: "FALHOU: execução não encontrada" }] }).size === 2);
/* Sem o conjunto, o padrão tem de ser o mínimo — nunca "aceita tudo", que
   transformaria a checagem em promessa no caminho que ela existe para verificar. */
t("sem o conjunto, o padrão não aceita evidência inventada",
  !u.validarResposta(JSON.stringify(resp({ base: ["evidencia/1-saida.json"] })), NOMES).ok);

/* A procedência viaja no chat, então entra no snapshot — é o que permite a tela
   nunca desenhar as duas iguais. */
t("o snapshot recebe a procedência pelo chat",
  /procedencia: v\.procedencia/.test(require("fs").readFileSync(require("path").join(__dirname, "upgrade.js"), "utf8")));

console.log("\n3. tipo `alvo` — a fronteira que importa");
const alvoBom = { tipo: "alvo", resumo: "avisa no slack", nos: [{ nome: "fim_lead_duplicado", oque: "ganha saída" }] };
t("alvo com nó existente passa", V(alvoBom).ok);
t("alvo sem resumo é recusado", !V({ tipo: "alvo", nos: alvoBom.nos }).ok);
t("alvo com lista vazia é recusado", !V({ tipo: "alvo", resumo: "x", nos: [] }).ok);

/* O defeito que este caso existe para pegar: um nó INVENTADO passando como se
 * existisse no fluxo. Sem isso, a etapa seguinte escreve um patch contra um nome
 * que não está no documento — e o erro só aparece no fim, longe da causa. */
const inventado = V({ tipo: "alvo", resumo: "x", nos: [{ nome: "no_que_nao_existe" }] });
t("nó inventado é recusado", !inventado.ok);
t("...e a recusa manda ler o nodes-index.md", /nodes-index\.md/.test(inventado.erros[0]));
t("...e ela ENSINA a marcar `novo` em vez de só negar", /"novo": true/.test(inventado.erros[0]));

t("nó novo declarado passa mesmo não existindo",
  V({ tipo: "alvo", resumo: "x", nos: [{ nome: "slack_avisar", novo: true, tipoNo: "n8n-nodes-base.slack" }] }).ok);

/* O inverso, e ele é mais perigoso: marcar como NOVO um nó que já existe faria a
 * etapa seguinte criar um segundo nó com o mesmo nome, o que o n8n aceita e
 * quebra as ligações de quem apontava para o original. */
const jaExiste = V({ tipo: "alvo", resumo: "x", nos: [{ nome: "verificador_numero", novo: true }] });
t("nó marcado `novo` que JÁ existe é recusado", !jaExiste.ok);
t("...e a recusa diz que ele já existe", /já existe/.test(jaExiste.erros[0]));

t("mistura de existente e novo passa",
  V({ tipo: "alvo", resumo: "x", nos: [{ nome: "fim_lead_duplicado" }, { nome: "novo_slack", novo: true }] }).ok);
t("lista é limitada a 24 nós",
  V({ tipo: "alvo", resumo: "x", nos: Array.from({ length: 40 }, (_, i) => ({ nome: "n" + i, novo: true })) }).valor.nos.length === 24);
t("`tipoNo` só sobrevive em nó novo",
  V({ tipo: "alvo", resumo: "x", nos: [{ nome: "fim_lead_duplicado", tipoNo: "n8n-nodes-base.slack" }] }).valor.nos[0].tipoNo === null);
t("nota acima de 500 é cortada, não recusa",
  V({ tipo: "alvo", resumo: "x", nos: alvoBom.nos, nota: "y".repeat(900) }).valor.nota.length === 500);
t("nota vazia vira null em vez de string vazia",
  V({ tipo: "alvo", resumo: "x", nos: alvoBom.nos, nota: "   " }).valor.nota === null);

/* Medido na PRIMEIRA rodada real, 2026-08-13: o alvo veio válido e a `nota` dizia
   "falta decidir o canal: reaproveita o de slack_notificar_novo_lead ou um
   separado?". Isso é decisão pendente escondida dentro de um alvo que a tela
   apresenta como pronto para confirmar — e confirmar faria a etapa seguinte
   escolher sozinha, ou marcar `[PREENCHER]`, e nenhum dos dois é o que ele pediu.
   Pergunta pertence a `tipo: "resposta"`, que existe exatamente para isso. */
const notaPergunta = V({ tipo: "alvo", resumo: "x", nos: alvoBom.nos, nota: "falta decidir o canal: reaproveita ou separado?" });
t("nota com PERGUNTA é recusada", !notaPergunta.ok);
t("...e a recusa manda usar tipo resposta", /"resposta"/.test(notaPergunta.erros[0]));
t("...e ela cita o trecho, para o modelo saber qual frase", /falta decidir o canal/.test(notaPergunta.erros[0]));
t("nota sem pergunta continua passando",
  V({ tipo: "alvo", resumo: "x", nos: alvoBom.nos, nota: "esse noOp esta no caminho de execucao" }).ok);
t("REGRAS avisa sobre pergunta na nota", /Pergunta NUNCA vai em/.test(u.REGRAS));

console.log("\n4. o orçamento da conversa — o que separa rodar de `spawn ENAMETOOLONG`");
const msgs = Array.from({ length: 40 }, (_, i) => ({ de: i % 2 ? "ele" : "eu", texto: "m" + i + " " + "z".repeat(400) }));
const r = u.ultimasAteCaber(msgs, u.ORC_CONVERSA);
t("cabe no orçamento", r.texto.length <= u.ORC_CONVERSA + 400);
t("diz quantas caíram", r.cortadas > 0);
/* Cair a mais NOVA seria perder a decisão em vigor: a última mensagem é o que ele
   acabou de mandar, e uma velha costuma já estar refletida no que foi decidido. */
t("a mensagem mais NOVA sobrevive", r.texto.includes("m39"));
t("a mais antiga é a que cai", !r.texto.includes("m0 "));
t("conversa curta não corta nada", u.ultimasAteCaber(msgs.slice(0, 2), u.ORC_CONVERSA).cortadas === 0);

console.log("\n5. o prompt do pior caso cabe na linha de comando do Windows");
const s = {
  chat: msgs, wfNome: "[ECONTRATE] Hook — Cadastro Lead Formulário com nome bem longo para o pior caso",
  nos: 189, correcoes: ["um motivo de recusa bem comprido ".repeat(8), "outro motivo ".repeat(10)]
};
const p = u.prompt(s);
console.log("        pior caso: " + p.length + " caracteres (teto " + u.PROMPT_MAX + ")");
t("o prompt do pior caso cabe no teto", p.length <= u.PROMPT_MAX);
t("o prompt AVISA que cortou mensagens", /não couberam/.test(p));
t("o prompt repassa as recusas literalmente", /motivo de recusa/.test(p));

console.log("\n6. gasto: rodada cega nunca conta como zero");
t("sem rodada nenhuma, gasto zero e não estimado",
  u.gastoAte({ custo: [] }).usd === 0 && u.gastoAte({ custo: [] }).estimado === false);
const g = u.gastoAte({ custo: [{ usd: 0.10 }, { usd: 0.20 }, { usdDesconhecido: true }] });
t("a rodada cega é cobrada pela média das medidas", Math.abs(g.usd - 0.45) < 1e-9);
t("...e o total se declara estimado", g.estimado === true && g.cegas === 1);
/* Se TODAS forem cegas não há média para cobrar. O honesto é zero medido com a
   cegueira declarada — nunca um número inventado. */
const g2 = u.gastoAte({ custo: [{ usdDesconhecido: true }, { usdDesconhecido: true }] });
t("só cegas: zero, mas com a cegueira dita", g2.usd === 0 && g2.cegas === 2 && g2.estimado === true);

console.log("\n7. as REGRAS que a sessão lê dizem as coisas que não podem faltar");
t("nomeia os dois tipos de resposta", /"alvo"/.test(u.REGRAS) && /"resposta"/.test(u.REGRAS));
t("proíbe apagar nó", /Nunca proponha apagar/.test(u.REGRAS));
t("manda NÃO ler o fluxo.json inteiro", /Não leia inteiro/.test(u.REGRAS));
t("diz que perguntar é mais barato que errar", /mais barato que errar/.test(u.REGRAS));
t("autoriza contestar", /pode contestar/.test(u.REGRAS));
/* ESTE CASO FOI REESCRITO, NÃO APAGADO. Ele fixava a frase literal "Nada do que
   você escrever aqui vai para o n8n", e a GARANTIA que ele protegia continua
   legítima — a sessão tem de saber que não é ela quem aplica. O que mudou é o
   FATO: o §6 aplica de verdade, por `fix.escreverAprovado`, e a `checagem7` grava a
   cópia inativa `[SANDBOX upgrade]` já DURANTE a rodada, antes de qualquer
   aprovação. Uma prosa dizendo "nada sai do processo" não engana só quem lê o
   código: ela engana o modelo que está escrevendo o patch, e engana na direção de
   baixar a guarda.

   MEDIDO COM O ESPAÇO EM BRANCO NORMALIZADO, e isso foi pago: a prosa é quebrada
   em 80 colunas e a frase velha estava em DOIS lugares — num deles "escrever /
   aqui" caía numa quebra de linha, então o regex antigo pegava um só, e a mesma
   mentira ficava verde três parágrafos adiante. */
const regrasPlano = u.REGRAS.replace(/\s+/g, " ");
t("diz à sessão que não é ela quem aplica", /Quem aplica não é você/.test(regrasPlano));
t("...que escrever no vivo depende de um clique do Kauan sobre o diff",
  /clique do Kauan sobre esse diff/.test(regrasPlano) && /clique do Kauan sobre o diff/.test(regrasPlano));
t("...e avisa da cópia INATIVA que a checagem 7 grava ANTES da aprovação",
  /checagem 7 grava o documento numa/.test(regrasPlano) && /cópia INATIVA/.test(regrasPlano)
  && /\[SANDBOX upgrade\]/.test(regrasPlano));
t("...e NÃO afirma mais que nada do que ela escrever sai do processo",
  !/Nada do que você escrever aqui vai para o n8n/.test(regrasPlano));

/* `base` é obrigatório em toda resposta, então o REGRAS.md TEM de ensinar com
   exemplo — senão a primeira rodada de toda pergunta vira uma recusa paga. */
t("REGRAS ensina o campo `base`", /### .base. é obrigatório/.test(u.REGRAS));
t("...com exemplo dentro do JSON da forma 2", /"base": \["evidencia\/1-saida\.json"\]/.test(u.REGRAS));
t("...nomeando os quatro valores possíveis",
  /"dossie"/.test(u.REGRAS) && /"fluxo"/.test(u.REGRAS) && /"indice"/.test(u.REGRAS)
  && /evidencia\/2-saida\.json/.test(u.REGRAS));
t("...dizendo que o dossiê é prosa de modelo e não prova comportamento",
  /modelo citando outro modelo/.test(u.REGRAS));
t("...e que afirmação sobre execução exige arquivo de evidência",
  /exige um arquivo de .evidencia/.test(u.REGRAS));

/* A sessão usou `contem` ZERO vezes em cinco perguntas de investigação, inclusive
   na que procurava um ramo — o que aponta para a documentação, não para ela. */
t("REGRAS diz qual dos dois serve para cada situação", /Qual dos dois: .contem. ou .comNos./.test(u.REGRAS));
t("...com a regra curta de bolso", /por onde passou.*é .comNos/.test(u.REGRAS));
/* Os dois tetos são de NATUREZAS diferentes, e as REGRAS têm de dizer isso: o do
   `comNos` é de tamanho de resposta (6 execuções), o do `contem` é de relógio — ele
   varre a retenção inteira. Um "abre até 40" aqui foi exatamente o que fez uma
   sessão responder "não achei" tendo olhado 2% do que existe. */
t("...e diz o teto do `comNos`, que é de tamanho de resposta", /Abre até\s+6 execuções/.test(u.REGRAS));
t("...e que o `contem` varre FUNDO, com o número medido",
  /varre FUNDO/.test(u.REGRAS) && /1941/.test(u.REGRAS));
t("...e não promete mais um teto de 40 execuções", !/[Aa]bre até 40/.test(u.REGRAS));

/* O defeito principal da conversa real do Kauan: ele colou um telefone, e as REGRAS
   diziam que contato vem mascarado sem dizer que a BUSCA funciona. A sessão concluiu
   — com razão, pelo que estava escrito — que não valia tentar. */
t("REGRAS diz, com estas palavras, que buscar por telefone e e-mail FUNCIONA",
  /Sim, você PODE buscar por telefone e por e-mail/.test(u.REGRAS));
t("...explicando que o cockpit mascara a AGULHA, os dois lados",
  /mascara a AGULHA também/.test(u.REGRAS));
/* As frases quebram linha no meio, porque o molde é markdown escrito à mão — as
   asserções casam com `\s+` em vez de espaço literal por isso. */
t("...e que a CAUDA precisa de confirmação em cada casamento",
  /confira CADA casamento com\s+`saida`/i.test(u.REGRAS));
t("...sem prometer que o número inteiro aparece",
  /ver o número\s*\n?inteiro, não/.test(u.REGRAS));

/* O segundo defeito: ela não tinha como andar para trás, e nem sabia que precisava. */
t("REGRAS ensina a apontar a janela com `desde`/`ate`", /Com `desde`\/`ate`/.test(u.REGRAS));
t("...com o preço medido dos dois caminhos, para a escolha ser informada",
  /~12 segundos/.test(u.REGRAS) && /~3 minutos/.test(u.REGRAS));
t("...e diz que sem fuso o instante é UTC, senão a janela desloca em silêncio",
  /sem fuso é lido como UTC/.test(u.REGRAS));
t("...e manda LER a cobertura antes de concluir", /Leia isso antes de concluir/.test(u.REGRAS));
/* "Não achei" lido como "não existe" é a mentira que este painel não conta. */
t("...e separa 'não achei' de 'não existe' explicitamente",
  /"não achei" NÃO é "não existe"/.test(u.REGRAS));
t("...dizendo como continuar de onde parou", /`janela.continuar`/.test(u.REGRAS));

/* A cauda saiu do padrão por MEDIÇÃO: ela casou um epoch mascarado numa varredura
   real de 1913 execuções. As REGRAS têm de carregar o exemplo, senão a sessão liga o
   `frouxo` achando que é só "buscar melhor". */
t("REGRAS separa os graus de casamento, e diz em qual confiar",
  /`variante`/.test(u.REGRAS) && /o mesmo contato gravado sem/.test(u.REGRAS));
t("...e apresenta o `frouxo` como o que quase nunca se deve usar",
  /`frouxo: true` existe e você quase nunca deve usar/.test(u.REGRAS));
t("...com o falso positivo REAL, nomeado", /um epoch\s+mascarado, não um contato/.test(u.REGRAS));
t("...e o campo está na tabela dos pedidos, senão ela não saberia que existe",
  /`cursor`, `frouxo`/.test(u.REGRAS));
t("REGRAS ensina `execIds` para pergunta sobre várias execuções",
  /execIds/.test(u.REGRAS) && /gastam o orçamento inteiro/.test(u.REGRAS));


/* ═══════════════════════════════════════════════════════════════════════════
   7b. O ANEXO NO INVENTÁRIO QUE A SESSÃO LÊ PRIMEIRO.

   MEDIDO numa conversa real (`umt7kj5cc69ib`, 24/08, `Agente eContrate`): o print
   chegou ao disco — `.upgrade-runs/umt7kj5cc69ib/anexos/print-182748.png`, 66KB,
   adotado da bandeja, com `INDICE.md` escrito ao lado — e ainda assim o
   `REGRAS.md` daquela pasta não continha a palavra "anexo". O prompt manda ler
   esse arquivo ANTES DE QUALQUER COISA e a seção dele se chama "Os arquivos
   aqui": um inventário que se apresenta como completo e omite o material do
   pedido é prosa que o MODELO lê afirmando o que o código contradiz — a mesma
   classe que este repositório já documentou em `REGRAS_MOLDE` ("nada do que você
   escrever vai para o n8n") e no contrato morto `escreveNoN8n`. A direção do erro
   é a pior possível: ensina a sessão a não procurar o que ele acabou de mandar.

   O SEGUNDO DEFEITO ESTAVA NO MESMO PARÁGRAFO e é de sinal contrário: o molde
   prometia `Glob` SEMPRE, e `ferramentasDaRodada` concede `Glob` só quando existe
   anexo. Sem anexo, a sessão lia a promessa, chamava `Glob` e levava recusa — e
   "uma ferramenta negada custa uma rodada, em silêncio" é lição paga aqui.

   Cada caso abaixo recusa um desses defeitos por nome, nas DUAS direções: prometer
   o que não existe é tão ruim quanto omitir o que existe. */
console.log("\n7b. o anexo dentro do REGRAS.md, e a lista de ferramentas que não pode mentir");

const R_SEM = u.regras(null, false);
const R_ANX = u.regras(null, true);
const R_ANX_DOS = u.regras({ usa: true }, true);
const planar = txt => txt.replace(/\s+/g, " ");

/* O defeito medido, em uma linha. */
t("com anexo, o REGRAS.md NOMEIA `anexos/INDICE.md`", /anexos\/INDICE\.md/.test(R_ANX));
t("...e diz que aquilo é o que o Kauan anexou nesta conversa",
  /o que o Kauan anexou nesta conversa/.test(planar(R_ANX)));
/* A direção oposta: um inventário que promete uma pasta que não existe faria a
   sessão gastar uma leitura recusada procurando o que ninguém mandou. */
t("SEM anexo, ele não promete pasta de anexo nenhuma", !/anexos\//.test(R_SEM));

/* A ORDEM. `ARQ_COM_DOSSIE` diz "comece por aqui", e com anexo há duas
   instruções de primeira leitura no mesmo arquivo. Contradição num prompt é
   resolvida por quem lê — que é o modelo. O bloco do anexo tem de vir antes E
   tem de dizer qual é qual. */
t("com anexo E dossiê, o bloco do anexo vem ANTES do dossiê na lista",
  R_ANX_DOS.indexOf("anexos/INDICE.md") < R_ANX_DOS.indexOf("`DOSSIE.md`"));
t("...e a prosa resolve o «comece por aqui» do dossiê: anexo é o PEDIDO, dossiê é o FLUXO",
  /este índice é o \*\*pedido\*\*, o dossiê é o \*\*fluxo\*\*/.test(planar(R_ANX_DOS)));

/* O que o anexo serve para fazer, e a única razão de o arquivo viajar em disco em
   vez de no prompt. */
t("diz que imagem e PDF abrem com `Read`, nativamente",
  /Imagem e PDF você abre com `Read`, nativamente/.test(planar(R_ANX)));
t("repete «não leia tudo» — sem isso o modelo abre os 40 em ordem",
  /\*\*Não leia tudo\*\*/.test(R_ANX));

/* A FRASE DAS FERRAMENTAS É DERIVADA, e é isso que impede as duas listas de
   divergirem no primeiro ajuste feito num lado só. Os dois casos abaixo medem a
   frase contra a MESMA função que monta o spawn — não contra um literal. */
const ferrDe = txt => (planar(txt).match(/Você tem ([^.]+)\./) || [null, ""])[1];
for (const [rot, txt, temAnexo] of [["sem anexo", R_SEM, false], ["com anexo", R_ANX, true]]) {
  const concedidas = u.ferramentasDaRodada({ anexos: temAnexo ? [1] : [] }).split(",");
  const frase = ferrDe(txt);
  t(rot + ": a frase cita exatamente as ferramentas concedidas",
    concedidas.every(f => frase.includes("`" + f + "`"))
    && (frase.match(/`/g) || []).length === concedidas.length * 2);
}
/* O defeito exato que existia: `Glob` prometido numa rodada que não o tem. */
t("SEM anexo, a frase NÃO promete `Glob`", !/`Glob`/.test(ferrDe(R_SEM)));
t("COM anexo, ela promete `Glob`", /`Glob`/.test(ferrDe(R_ANX)));

/* Um molde com placeholder sobrando é um arquivo que a sessão lê com `{{...}}`
   dentro, e nada estoura — ela simplesmente não sabe quais arquivos existem. */
t("nenhum placeholder do molde fica sem substituir",
  !/\{\{[A-Z_]+\}\}/.test(R_SEM) && !/\{\{[A-Z_]+\}\}/.test(R_ANX_DOS));

/* O PROMPT tem a mesma contradição em miniatura: ele manda ler o dossiê PRIMEIRO.
   Com anexo, a ressalva tem de estar lá; sem anexo, ela não pode aparecer — uma
   frase sobre um arquivo ausente é a mesma promessa vazia de cima. */
const promptCom = u.prompt({ wfNome: "X", nos: 3, chat: [{ de: "eu", texto: "olha o print" }],
  dossie: { usa: true, cor: "verde" },
  anexos: [{ arquivo: "anexos/p.png", nome: "p.png", tipo: "imagem", bytes: 100 }] });
const promptSem = u.prompt({ wfNome: "X", nos: 3, chat: [{ de: "eu", texto: "oi" }],
  dossie: { usa: true, cor: "verde" }, anexos: [] });
t("no prompt COM anexo, o dossiê deixa de ser o primeiro a ler",
  /ANTES dele, leia `anexos\/INDICE\.md`/.test(planar(promptCom)));
t("no prompt SEM anexo, essa ressalva não aparece",
  !/ANTES dele/.test(promptSem) && /LEIA ELE PRIMEIRO/.test(promptSem));

/* OS CINCO PONTOS QUE REESCREVEM O ARQUIVO, lidos da FONTE.
   `prepararDir` roda antes de a bandeja ser adotada — é ele que cria o diretório
   onde o `rename` cai — então um `REGRAS.md` escrito só ali nunca poderia
   mencionar o anexo, que é literalmente o defeito medido. Medido sobre a fonte SEM
   COMENTÁRIO: um caso que casa dentro de um comentário aprova a ausência da
   decisão, e este repositório já pagou isso no `dossie-tela-test.js`. */
const fonteUp = require("fs").readFileSync(require("path").join(__dirname, "upgrade.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
t("`escreverRegras` é chamada nos CINCO pontos em que o inventário muda",
  (fonteUp.match(/await escreverRegras\(s\)/g) || []).length === 5);
/* UMA escrita, e ela mora dentro de `escreverRegras`. Uma segunda, solta em
   qualquer outro lugar, seria a volta do defeito: o arquivo nasceria antes de a
   bandeja ser adotada e ficaria sem o anexo — e quem colasse essa linha não teria
   nada vermelho para avisá-lo. */
t("...e existe UMA única escrita de REGRAS.md em todo o arquivo",
  (fonteUp.match(/writeFile\([\s\S]{0,40}?"REGRAS\.md"/g) || []).length === 1);
t("...e ela está dentro de `escreverRegras`",
  /async function escreverRegras\(s\)[\s\S]{0,300}?writeFile\([\s\S]{0,40}?"REGRAS\.md"/.test(fonteUp));
/* Desanexar entra pelos mesmos motivos dos outros e por um a mais: a lista pode
   voltar a ZERO, e aí a frase das ferramentas tem de parar de prometer `Glob`. */
t("desanexar também reescreve — a lista pode voltar a zero",
  /async function desanexar[\s\S]{0,600}?await escreverRegras\(s\)/.test(fonteUp));
t("adotar a bandeja reescreve — é o caminho da conversa que nasce com print",
  /anexos\.adotar\([\s\S]{0,500}?await escreverRegras\(s\)/.test(fonteUp));

console.log("\n8. a máquina não conhece caminho de escrita");
const fonte = require("fs").readFileSync(require("path").join(__dirname, "upgrade.js"), "utf8");
/* Procurar a PALAVRA falhava por causa do comentário no topo do arquivo, que
   promete justamente não chamá-las. O que importa é a CHAMADA — e é ela que um
   dia vai aparecer por descuido, num `n8n.putWorkflow(...)` colado de outro
   módulo. Casar `n8n.` na frente é o teste honesto. */
/* ESTE BLOCO MUDOU COM O §6, E A MUDANÇA É DELIBERADA — leia antes de mexer.
 *
 * Até o §4 a afirmação era absoluta: `upgrade.js` não chamava `putWorkflow` nem
 * `createWorkflow`, ponto. O §6 acrescentou a escrita em produção, então aquela
 * afirmação deixou de ser verdade — e apagá-la seria trocar uma garantia por
 * nada, que é o pior desfecho possível para um teste que ficou inconveniente.
 *
 * O que ele protegia era *nenhuma escrita não auditada*. Essa garantia continua,
 * e agora é afirmada de forma MAIS forte: existe um número exato de chamadas de
 * escrita, cada uma no lugar nomeado, e o fluxo VIVO só é escrito através de
 * `escreverAprovado` — a sequência que re-busca, recusa por `updatedAt`, roda a
 * bateria de novo e grava o backup antes do `PUT`.
 *
 * Se algum destes casos ficar vermelho, a pergunta certa NÃO é "como faço passar":
 * é "quem acrescentou uma escrita, e ela passa pela sequência?". */
const escritas = (fonte.match(/n8n\s*\.\s*(putWorkflow|createWorkflow)\s*\(/g) || []);
t("existem EXATAMENTE três escritas diretas em `upgrade.js`", escritas.length === 3,
  "achei " + escritas.length + ": " + escritas.join(", "));

/* As três, e por que cada uma é legítima:
   - a cópia `[SANDBOX upgrade]` da checagem 7, num `PUT` (cópia já existia)
   - a mesma cópia num `POST` (primeira vez)
   - o `↺ Desfazer`, que restaura um backup literal e por isso não passa pela
     sequência: não há patch para reaplicar nem portão para rodar. */
t("duas delas são a cópia sandbox, dentro de `checagem7`",
  /async function checagem7[\s\S]{0,2200}?n8n\.putWorkflow[\s\S]{0,600}?n8n\.createWorkflow/.test(fonte));
t("a terceira é o desfazer, restaurando o backup",
  /async function desfazer[\s\S]{0,1800}?n8n\.putWorkflow/.test(fonte));

/* A garantia que carrega o §6 inteiro: o fluxo vivo é escrito pela sequência
   compartilhada, nunca por um `putWorkflow` solto dentro de `aplicar`. */
t("`aplicar` escreve pelo primitivo compartilhado, não por `putWorkflow` direto",
  /async function aplicar[\s\S]{0,3000}?fix\.escreverAprovado\s*\(/.test(fonte));
t("...e `aplicar` NÃO contém nenhuma escrita direta",
  !/async function aplicar[\s\S]{0,3000}?n8n\.(putWorkflow|createWorkflow)\s*\(/.test(fonte));

/* A bateria é injetada como `revalidar`. Um default silencioso ali faria um
   upgrade ser aprovado pelos dez portões de um CONSERTO — a divergência exata
   que a extração do primitivo existe para impedir. */
t("a bateria de sete é o `revalidar` que o approve recebe",
  /revalidar:\s*\([^)]*\)\s*=>\s*rodarBateria/.test(fonte));

/* `active` nunca sobe no corpo (§6.2): aplicar um upgrade não pode acordar fluxo
   dormente, e o corpo é montado campo por campo em vez de espalhado. */
t("nenhuma escrita daqui manda `active`", !/\bactive\s*:/.test(fonte));
/* AS TRÊS CERCAS, REESCRITAS — e a razão de reescrever em vez de apagar é a que
   este repositório já pagou uma vez: o `escreveNoM8n === false` logo abaixo era um
   caso que fixava um fato que deixou de ser verdade, e ele foi REESCRITO para
   fixar o novo. Aqui é o mesmo: até a fiação do `ia.js`, estas quatro linhas
   casavam o array de argumentos escrito à mão neste arquivo. Ele não existe mais —
   as cercas viraram DADO na tabela de provedor do `ia.js`, e um provedor sem as
   três é recusado por nome antes de virar spawn.

   O que se fixa agora é o que passou a ser a garantia: a rodada monta pelo
   adaptador, e não ao lado dele. Que as flags CHEGAM ao `spawn` é o
   `ia-fiacao-test.js` que prova, por execução, com um dublê capturando os
   argumentos — aqui é fonte, e fonte não sabe o que chegou. */
t("a rodada monta os argumentos pelo adaptador (as cercas moram lá)",
  /const\s+mont\s*=\s*ia\s*\.\s*argumentosDaRodada\s*\(/.test(fonte));
t("...e o spawn recebe o array QUE ELE MONTOU, nunca um array local",
  /spawn\(CLAUDE_BIN,\s*mont\.args/.test(fonte));
t("...e a montagem recusada não vira spawn",
  /if\s*\(\s*!mont\.ok\s*\)\s*\{[\s\S]{0,200}?resolve\(/.test(fonte));
t("o ambiente do filho também sai do adaptador, com o carimbo desta aba",
  /env:\s*ia\.ambienteDaRodada\(\s*\{[^}]*carimbo/.test(fonte));
t("rede negada na lista", /WebFetch,WebSearch/.test(fonte));
t("Bash negado na lista", /NEGADAS = "Bash/.test(fonte));
/* O literal de `NEGADAS` ficou aqui de propósito (os dois casos acima o fixam), e
   por isso ele é uma SEGUNDA definição da mesma lista. O `ia-fiacao-test.js` afere
   que o valor que chega ao spawn é byte a byte o `ia.NEGADAS_SEM_REDE` — então o
   dia em que as duas divergirem é vermelho, em vez de ser uma sessão com uma
   cerca a menos que ninguém notou. */
t("e a lista daqui é IDÊNTICA à do adaptador — uma cópia fixada, não uma cópia solta",
  /const\s+NEGADAS\s*=\s*"([^"]+)"/.test(fonte)
  && fonte.match(/const\s+NEGADAS\s*=\s*"([^"]+)"/)[1] === require("./ia.js").NEGADAS_SEM_REDE);
t("stdin fechado no spawn", /stdio: \["ignore", "pipe", "pipe"\]/.test(fonte));
/* TAMBÉM REESCRITO. Ele fixava `escreveNoN8n === false`, e isso era falso: esta
   aba escreve nos TRÊS lugares que os casos acima deste contam por regex. O campo
   virou objeto em vez de ser apagado porque o ramo negativo de um booleano ausente
   diria "nada é escrito" — o lado que engana — e um objeto não tem esse ramo.
   Medido: nada consumia o campo antigo além desta linha, e é exatamente por isso
   que a mentira durou. Contrato morto é onde ninguém procura. */
const cap = require("./upgrade.js").capacidades();
t("capacidades não afirma mais que nada é escrito", !("escreveNoN8n" in cap));
t("...diz que o fluxo vivo só é escrito depois da aprovação",
  !!cap.escreve && cap.escreve.fluxoVivo === "apenasAposAprovacao");
/* A cópia inativa DESLIGA, então o campo tem de reportar o estado de agora e não
   uma constante: "não perguntei ao n8n" e "perguntei e ele aceitou" levam a
   decisões opostas, e a decisão aqui é escrever num fluxo que está rodando. */
t("...e diz se a cópia inativa da checagem 7 está ligada AGORA",
  !!cap.escreve && typeof cap.escreve.copiaInativa === "boolean"
  && cap.escreve.copiaInativa === u.SANDBOX_LIGADO);

console.log("\n9. §4.5 — em qual fluxo o alvo mora, e o que isso autoriza");
/* A forma que `n8n.locateNode` devolve, fabricada aqui em vez de chamada. O
   veredito é puro de propósito, e é isso que permite provar os cinco estados e as
   quatro agregações sem abrir uma conexão.

   `hasNode` tem TRÊS valores e o terceiro é o que importa: `null` é o filho que
   não abriu (apagado, ou sem permissão), e ele não é `false`. */
const loc = o => Object.assign({
  wfId: "PAI", workflowName: "Agente Iago Comercial", node: "n",
  inWorkflow: false, subflows: [], candidatos: 0, truncado: false
}, o);
const sub = (childId, childName, hasNode, viaNode) =>
  ({ viaNode: viaNode || ("chama_" + childId), childId, childName, hasNode });
/* `candidatos` é quantos sub-fluxos distintos o pai chama; `truncado` é
   `candidatos > subflows.length`. Fabricar os dois juntos evita fixture que o
   `n8n.js` nunca produziria. */
const lidos = subs => loc({ subflows: subs, candidatos: subs.length, truncado: false });
const cortado = (subs, quantos) => loc({ subflows: subs, candidatos: quantos, truncado: true });
const R = (nos, locais, wfId, wfNome) =>
  u.resolverAlvo(wfId || "PAI", wfNome || "Agente Iago Comercial", nos, locais);
const noNo = (r, nome) => r.porNo.find(p => p.nome === nome);

/* --- os cinco estados por nó --- */

const rLocal = R([{ nome: "buffer_wait" }], new Map([["buffer_wait", loc({ inWorkflow: true })]]));
t("nó no fluxo aberto é `local`", noNo(rLocal, "buffer_wait").onde === "local");
t("...e a agregação libera com o fluxo aberto como alvo",
  rLocal.estado === "local" && rLocal.wfIdAlvo === "PAI" && rLocal.redirecionado === null);

const rFilho = R([{ nome: "Convert text to speech" }], new Map([
  ["Convert text to speech", lidos([sub("IAGO", "Agente Iago Comercial", true, "Call Iago")])]
]));
t("um casamento com leitura completa é `filho`", noNo(rFilho, "Convert text to speech").onde === "filho");
t("...e a agregação TROCA de alvo", rFilho.estado === "trocar" && rFilho.wfIdAlvo === "IAGO");

/* A ambiguidade MEDIDA nesta instância: o mesmo nome existe nos dois agentes.
   Sem assinatura de erro não há `lastNodeExecuted` para desempatar, então
   escolher um seria escrever no fluxo errado. */
const rAmb = R([{ nome: "Convert text to speech" }], new Map([
  ["Convert text to speech", lidos([
    sub("IAGO", "Agente Iago Comercial", true),
    sub("ECON", "Agente eContrate", true)
  ])]
]));
t("o mesmo nome em dois filhos é `ambiguo`", noNo(rAmb, "Convert text to speech").onde === "ambiguo");
t("...e BLOQUEIA, nunca escolhe", rAmb.estado === "bloqueado" && rAmb.bloqueio.motivo === "ambiguo");
t("...carregando os dois candidatos para ele desempatar à mão",
  noNo(rAmb, "Convert text to speech").candidatos.length === 2);
t("...e sem alvo nenhum, para ninguém a jusante achar que dá para seguir",
  rAmb.wfIdAlvo === null && rAmb.redirecionado === null);

/* LOAD-BEARING #1. Achou UM, mas um filho não abriu: esse "um" pode ser o primeiro
   de dois, e a ambiguidade de cima é exatamente o que ficaria escondido atrás da
   leitura incompleta — some sem deixar sintoma. */
const rParcial = R([{ nome: "Convert text to speech" }], new Map([
  ["Convert text to speech", lidos([
    sub("IAGO", "Agente Iago Comercial", true),
    sub("XXXX", null, null)
  ])]
]));
t("um casamento MAIS um filho não lido é `incompleto`, nunca `filho`",
  noNo(rParcial, "Convert text to speech").onde === "incompleto");
t("...e bloqueia em vez de trocar de alvo", rParcial.estado === "bloqueado");
t("...dizendo onde achou e quantos não abriram, que é o que permite desempatar",
  /Agente Iago Comercial/.test(noNo(rParcial, "Convert text to speech").porque)
  && /não abriram/.test(noNo(rParcial, "Convert text to speech").porque));
t("...e guardando o casamento parcial em vez de jogá-lo fora",
  noNo(rParcial, "Convert text to speech").parcial.id === "IAGO");

/* LOAD-BEARING #2. O teto do scan pesa igual: bateu `SUBFLOW_SCAN_CAP`, a leitura
   não foi exaustiva, e o filho não olhado pode ter o mesmo nome. */
const rTrunc = R([{ nome: "Convert text to speech" }], new Map([
  ["Convert text to speech", cortado([sub("IAGO", "Agente Iago Comercial", true)], 9)]
]));
t("um casamento com o scan truncado também é `incompleto`",
  noNo(rTrunc, "Convert text to speech").onde === "incompleto");
t("...e a frase conta a proporção lida, não só que parou",
  /1 de 9/.test(noNo(rTrunc, "Convert text to speech").porque));

/* LOAD-BEARING #3. Zero casamentos COM leitura completa é `sumido` — e `sumido`
   bloqueia. "Não achei" tratado como "então é aqui" remenda o pai e nunca toca o
   filho: é o defeito que este bloco inteiro existe para impedir. */
const rSumido = R([{ nome: "no_que_nao_existe" }], new Map([
  ["no_que_nao_existe", lidos([sub("IAGO", "Agente Iago Comercial", false)])]
]));
t("zero casamentos com leitura completa é `sumido`", noNo(rSumido, "no_que_nao_existe").onde === "sumido");
t("...e `sumido` BLOQUEIA — não vira `local` por descarte", rSumido.estado === "bloqueado");
t("...e não inventa alvo", rSumido.wfIdAlvo === null);

/* Ignorância e ausência não podem sair iguais: zero casamentos com leitura
   incompleta é `incompleto`, não `sumido`. A frase que ele lê muda por causa
   disso — uma diz "não está", a outra diz "não sei". */
const rZeroCego = R([{ nome: "no_que_nao_existe" }], new Map([
  ["no_que_nao_existe", lidos([sub("IAGO", "Agente Iago Comercial", false), sub("XXXX", null, null)])]
]));
t("zero casamentos com filho não lido é `incompleto`, não `sumido`",
  noNo(rZeroCego, "no_que_nao_existe").onde === "incompleto");

const rZeroTrunc = R([{ nome: "no_que_nao_existe" }], new Map([
  ["no_que_nao_existe", cortado([sub("IAGO", "Agente Iago Comercial", false)], 8)]
]));
t("zero casamentos com scan truncado é `incompleto`",
  noNo(rZeroTrunc, "no_que_nao_existe").onde === "incompleto");

/* #9. `locateNode` que estourou é um estado previsto, não uma exceção: falha de
   leitura vira `incompleto` naquele nó em vez de derrubar a rodada inteira. */
const rErro = R([{ nome: "buffer_wait" }], new Map([["buffer_wait", { erro: "503 do n8n" }]]));
t("`locateNode` que estourou vira `incompleto`", noNo(rErro, "buffer_wait").onde === "incompleto");
t("...nomeando o erro, para não virar 'não achei'", /503 do n8n/.test(noNo(rErro, "buffer_wait").porque));
t("...e bloqueia", rErro.estado === "bloqueado");

/* Resultado que simplesmente não veio é o mesmo caso: silêncio não é resposta. */
const rVazio = R([{ nome: "buffer_wait" }], new Map());
t("nó sem resultado nenhum é `incompleto`, nunca `local`",
  noNo(rVazio, "buffer_wait").onde === "incompleto" && rVazio.estado === "bloqueado");

/* --- nós novos --- */

/* #4. Um nó `novo` ainda não existe em lugar nenhum, então não há o que localizar:
   ele nasce no fluxo que o patch acabar mirando. Localizá-lo daria `sumido` e
   bloquearia todo alvo que cria nó — que é a maioria deles. */
const rNovo = R(
  [{ nome: "buffer_wait" }, { nome: "slack_avisar", novo: true }],
  new Map([["buffer_wait", loc({ inWorkflow: true })]])
);
t("nó `novo` não é localizado", noNo(rNovo, "slack_avisar").onde === "novo");
t("...e não bloqueia o alvo", rNovo.estado === "local");
t("...mas continua aparecendo em `porNo`, para a tela poder desenhá-lo",
  rNovo.porNo.length === 2);

/* #5. Alvo que só cria nós não tem o que resolver — e o destino é o fluxo aberto,
   nunca `null`, senão o patch não teria onde nascer. */
const rSoNovos = R([{ nome: "a", novo: true }, { nome: "b", novo: true }], new Map());
t("alvo só com nós novos libera no fluxo aberto",
  rSoNovos.estado === "local" && rSoNovos.wfIdAlvo === "PAI");

/* --- as agregações --- */

/* #6. Um patch escreve num documento só. Alvo espalhado entre pai e filho seriam
   dois patches, em dois documentos, e o botão diria "aplicar" sem dizer onde. */
const rDividido = R([{ nome: "buffer_wait" }, { nome: "Convert text to speech" }], new Map([
  ["buffer_wait", loc({ inWorkflow: true })],
  ["Convert text to speech", lidos([sub("IAGO", "Agente Iago Comercial", true)])]
]));
t("nós em fluxos diferentes bloqueiam", rDividido.estado === "bloqueado");
t("...com motivo `dividido`, que é diagnóstico diferente de leitura incompleta",
  rDividido.bloqueio.motivo === "dividido");
t("...e a frase diz que um patch escreve num documento só",
  /um documento só/.test(rDividido.bloqueio.frase));

/* Dois nós no MESMO filho não é divisão — é um alvo só, que mora fora. */
const rMesmoFilho = R([{ nome: "tts" }, { nome: "stt" }], new Map([
  ["tts", lidos([sub("IAGO", "Agente Iago Comercial", true)])],
  ["stt", lidos([sub("IAGO", "Agente Iago Comercial", true)])]
]));
t("dois nós no mesmo filho trocam de alvo, sem falar em divisão",
  rMesmoFilho.estado === "trocar" && rMesmoFilho.wfIdAlvo === "IAGO");

/* #7. A tarja da tela é construída deste objeto. Um campo faltando ali é uma tarja
   que não diz para onde a escrita vai — e o clique de aprovar escreveria num fluxo
   que ele não abriu, em silêncio. */
t("`trocar` carrega o `redirecionado` inteiro", (() => {
  const r = rFilho.redirecionado;
  return r && r.deId === "PAI" && r.deNome === "Agente Iago Comercial"
    && r.viaNode === "Call Iago" && r.paraId === "IAGO" && r.paraNome === "Agente Iago Comercial";
})());
t("...e `wfNomeAlvo` acompanha, para a tarja não citar um id cru",
  rFilho.wfNomeAlvo === "Agente Iago Comercial");
t("estado liberado nunca traz bloqueio junto",
  rLocal.bloqueio === null && rFilho.bloqueio === null);

/* Um nó travado contamina o alvo inteiro mesmo com outro nó resolvido: seguir com
   metade do alvo provado é escrever sem saber onde. */
const rMisto = R([{ nome: "buffer_wait" }, { nome: "sumiu" }], new Map([
  ["buffer_wait", loc({ inWorkflow: true })],
  ["sumiu", lidos([sub("IAGO", "Agente Iago Comercial", false)])]
]));
t("um nó travado bloqueia o alvo inteiro", rMisto.estado === "bloqueado");
t("...e o `porNo` mantém o que foi resolvido, para a tela mostrar o que falta",
  noNo(rMisto, "buffer_wait").onde === "local" && noNo(rMisto, "sumiu").onde === "sumido");

/* Ambíguo vence incompleto no motivo: os dois bloqueiam, mas a pergunta que ele
   tem de responder é diferente — um pede escolha, o outro pede espera. */
const rAmbEIncompleto = R([{ nome: "amb" }, { nome: "cego" }], new Map([
  ["amb", lidos([sub("A", "Fluxo A", true), sub("B", "Fluxo B", true)])],
  ["cego", lidos([sub("C", null, null)])]
]));
t("com ambíguo e incompleto juntos, o motivo é `ambiguo`",
  rAmbEIncompleto.bloqueio.motivo === "ambiguo");

/* --- a forma da entrada --- */

t("aceita objeto simples além de Map, porque a assinatura promete os dois",
  R([{ nome: "buffer_wait" }], { buffer_wait: loc({ inWorkflow: true }) }).estado === "local");
t("nó sem nome é ignorado em vez de derrubar",
  R([{ nome: "" }, { nome: "buffer_wait" }], new Map([["buffer_wait", loc({ inWorkflow: true })]])).porNo.length === 1);
t("lista de nós vazia não explode", R([], new Map()).estado === "local");

/* --- a frase --- */

/* #8. "Não consegui decidir" sem a lista é um beco sem saída: ele não tem como
   desempatar o que não foi nomeado. */
const fAmb = u.fraseBloqueio(rAmb.bloqueio.nos);
t("a frase de ambiguidade nomeia os dois sub-fluxos",
  /Agente Iago Comercial/.test(fAmb) && /Agente eContrate/.test(fAmb));
t("...e nomeia o nó em disputa", /Convert text to speech/.test(fAmb));
t("...e diz POR QUE não escolhe, em vez de só dizer que não escolheu",
  /evidência/.test(fAmb) && /fluxo errado/.test(fAmb));
t("a frase de leitura incompleta carrega o motivo apurado do nó",
  /não abriram/.test(u.fraseBloqueio(rParcial.bloqueio.nos)));
t("um candidato sem nome cai no id, nunca em `null` na frase",
  /`SEMNOME`/.test(u.fraseBloqueio([
    { nome: "x", onde: "ambiguo", candidatos: [{ id: "SEMNOME", nome: null }, { id: "B", nome: "Fluxo B" }] }
  ])));


console.log("\n10. tipo `patch` — a forma que vira escrita em produção");

/* Um patch mínimo válido. Todo caso que não é sobre um campo específico carrega
   o resto completo, para que a recusa que aparecer seja sobre o que o caso testa
   e não sobre o que ele esqueceu. */
const pat = extra => Object.assign({
  tipo: "patch",
  resumo: "põe retry no nó que chama a API de preço",
  patch: { updateNodes: [{ name: "verificador_numero", parameters: { retry: true } }] },
  base: ["fluxo"]
}, extra);
/* Só o miolo muda: o envelope (resumo/base) fica igual, então uma recusa aqui é
   sempre sobre o verbo. */
const pp = corpo => pat({ patch: corpo });
const err = r => (r.erros || []).join(" | ");

/* ── 10.1 o campo `patch` ─────────────────────────────────────────────────── */
t("`patch` ausente é recusado NOMEANDO o campo",
  !V(pat({ patch: undefined })).ok && /`patch`/.test(err(V(pat({ patch: undefined })))));
t("`patch: null` é recusado", !V(pat({ patch: null })).ok);
/* Array passa em `typeof x === "object"`, então é a forma que escapa de uma
   checagem descuidada — e `Object.entries` de um array devolve índices, o que
   faria "0" virar nome de verbo. */
t("`patch` como array é recusado", !V(pat({ patch: [] })).ok);
t("`patch` como string é recusado", !V(pat({ patch: "updateNodes" })).ok);

/* ── 10.2 pelo menos um verbo, e não vazio ────────────────────────────────── */
/* Patch que não muda nada não é patch: é uma resposta que se apresentou como
   escrita, e a tela seguinte mostraria um diff em branco com botão de aplicar. */
t("`patch: {}` é recusado — não muda nada", !V(pp({})).ok);
t("os três verbos presentes e VAZIOS são recusados",
  !V(pp({ updateNodes: [], addNodes: [], rewire: {} })).ok);
t("...e a recusa diz que nada muda, não que falta campo",
  /nada|vazio|nenhum/i.test(err(V(pp({ updateNodes: [], addNodes: [], rewire: {} })))));

/* ── 10.3 verbo de delete NÃO EXISTE, e essa é a garantia de produção ─────── */
/* §4.2: `claude-fix.js` não tem verbo de delete porque o alvo é produção. O
   `removeNodes` do Tester existe porque LÁ o alvo é rascunho do Kauan. Tirar nó
   do caminho aqui é `disabled: true` mais o `rewire` que costura o buraco.
   A recusa tem de NOMEAR o verbo: "patch inválido" manda o modelo adivinhar. */
t("`removeNodes` é recusado NOMEANDO o verbo",
  !V(pp({ removeNodes: ["verificador_numero"] })).ok
  && /removeNodes/.test(err(V(pp({ removeNodes: ["verificador_numero"] })))));
t("`deleteNodes` é recusado nomeando o verbo",
  !V(pp({ deleteNodes: ["x"] })).ok && /deleteNodes/.test(err(V(pp({ deleteNodes: ["x"] })))));
/* `active` nunca é enviado no PUT, mas um verbo que promete mexer nisso não pode
   nem ser aceito e ignorado em silêncio — seria um patch cujo diff mente. */
t("`setActive` é recusado nomeando o verbo",
  !V(pp({ setActive: true })).ok && /setActive/.test(err(V(pp({ setActive: true })))));
t("um verbo desconhecido não é aceito junto com um válido",
  !V(pp({ updateNodes: [{ name: "verificador_numero", parameters: {} }], removeNodes: ["x"] })).ok);

/* ── 10.4 updateNodes ─────────────────────────────────────────────────────── */
t("`updateNodes` com nome inventado é recusado",
  !V(pp({ updateNodes: [{ name: "no_que_nao_existe", parameters: {} }] })).ok);
t("...e a recusa aponta o `nodes-index.md`",
  /nodes-index\.md/.test(err(V(pp({ updateNodes: [{ name: "no_que_nao_existe", parameters: {} }] })))));
t("`updateNodes` sem `name` é recusado",
  !V(pp({ updateNodes: [{ parameters: {} }] })).ok);
/* Trocar o `type` de um nó de produção não é remendo: é outro nó com o mesmo
   nome, herdando conexões que foram desenhadas para o antigo. */
t("trocar o `type` num `updateNodes` é recusado",
  !V(pp({ updateNodes: [{ name: "verificador_numero", type: "n8n-nodes-base.noOp" }] })).ok);
t("...e a recusa nomeia `type`",
  /type/.test(err(V(pp({ updateNodes: [{ name: "verificador_numero", type: "n8n-nodes-base.noOp" }] })))));

/* ── 10.5 addNodes ────────────────────────────────────────────────────────── */
const add = a => pp({ addNodes: [a] });
t("`addNodes` com nome que JÁ existe é recusado",
  !V(add({ name: "verificador_numero", type: "n8n-nodes-base.set", position: [0, 0] })).ok);
t("`addNodes` sem `type` é recusado",
  !V(add({ name: "no_novo", position: [0, 0] })).ok);
t("`addNodes` sem `position` é recusado",
  !V(add({ name: "no_novo", type: "n8n-nodes-base.set" })).ok);
t("`position` com um número só é recusada",
  !V(add({ name: "no_novo", type: "n8n-nodes-base.set", position: [10] })).ok);
t("`position` com string é recusada",
  !V(add({ name: "no_novo", type: "n8n-nodes-base.set", position: ["10", "20"] })).ok);

/* ── 10.6 credentials, nas três profundidades ─────────────────────────────── */
/* Proibição de produção, e ela não está coberta por `applyPatch`: lá o teste é
   `CRED_KEY.test(k)` sobre as chaves de PRIMEIRO nível do verbo, então uma
   credencial escondida dentro de `parameters` passa reto. Nó novo que precise de
   credencial é configurado por humano no n8n — nunca escrito por um patch. */
t("`credentials` em `updateNodes` é recusado",
  !V(pp({ updateNodes: [{ name: "verificador_numero", credentials: { slackApi: { id: "1" } } }] })).ok);
t("`credentials` em `addNodes` é recusado",
  !V(add({ name: "no_novo", type: "n8n-nodes-base.slack", position: [0, 0], credentials: { slackApi: { id: "1" } } })).ok);
t("`credentials` ANINHADO dentro de `parameters` é recusado",
  !V(pp({ updateNodes: [{ name: "verificador_numero", parameters: { opcoes: { credentials: { id: "1" } } } }] })).ok);
/* A recusa localiza pelo CAMINHO (`patch.updateNodes[0].credentials`), nao pelo
   nome do no. Fica registrado como esta: o resto do arquivo nomeia o no, e num
   patch com varios `updateNodes` o modelo tem de contar posicao de array para
   saber de qual se trata. Se um dia passar a nomear o no, este caso continua
   valendo — o que ele exige e que a recusa DIGA ONDE. */
t("a recusa de credencial diz exatamente ONDE ela está",
  (m => m.includes("credentials") && (m.includes("updateNodes") || m.includes("verificador_numero")))(
    err(V(pp({ updateNodes: [{ name: "verificador_numero", credentials: {} }] })))));

/* ── 10.7 rewire ──────────────────────────────────────────────────────────── */
t("`rewire` com origem que não existe é recusado",
  !V(pp({ rewire: { no_fantasma: { main: [[]] } } })).ok);
/* `applyPatch` faz `out.connections[from] = outs` — substituição inteira. Um
   array ali produz um `connections` que o n8n aceita e que não liga nada. */
t("`rewire` com array como valor é recusado",
  !V(pp({ rewire: { verificador_numero: [[{ node: "fim_lead_duplicado" }]] } })).ok);
t("`rewire` com string como valor é recusado",
  !V(pp({ rewire: { verificador_numero: "fim_lead_duplicado" } })).ok);

/* ── 10.8 o portão [PREENCHER] (§4.3) ─────────────────────────────────────── */
/* Portão NOVO: nem `validate()` nem `applyPatch()` pegam marcador. No Tester o
   marcador é inofensivo num JSON importado à mão; aqui vai escrito para dentro
   de produção — nó que roda e faz a coisa errada em silêncio. */
const comMarcador = pp({ updateNodes: [{ name: "criar_lead_supabase", parameters: { tabela: { id: "[PREENCHER]" } } }] });
t("`[PREENCHER]` aninhado reprova o patch inteiro", !V(comMarcador).ok);
t("...e a recusa nomeia o nó", /criar_lead_supabase/.test(err(V(comMarcador))));
t("...e a recusa nomeia o caminho da chave", /tabela/.test(err(V(comMarcador))));
t("`[PREENCHER]` em `notes` também reprova — `notes` vai escrito igual ao resto",
  !V(pp({ updateNodes: [{ name: "verificador_numero", notes: "TODO: [PREENCHER] o motivo" }] })).ok);

/* ── 10.9 o envelope ──────────────────────────────────────────────────────── */
t("`resumo` ausente é recusado", !V(pat({ resumo: "  " })).ok);
/* Mesma regra que a `nota` do `tipo: "alvo"` já tem, e pelo mesmo motivo medido:
   decisão pendente escondida dentro de algo que a tela apresenta como pronto. Só
   que aqui é pior — o que está pronto é uma ESCRITA. */
t("pergunta escondida no `resumo` é recusada",
  !V(pat({ resumo: "troco o canal, mas reaproveito o do outro fluxo ou crio um novo?" })).ok);
t("...e a recusa manda usar `tipo: \"resposta\"`",
  /resposta/.test(err(V(pat({ resumo: "mudo o canal ou não?" })))));
/* Ausência é estado PRÓPRIO, com frase própria — a mesma regra que o ramo de
   `resposta` já escreve no código. Testar só "foi recusado" não bastava: com o
   ramo da ausência desligado, o `else if` seguinte ainda recusa, e o patch sai
   barrado com a frase de "nenhum valor sobreviveu" — que manda procurar erro de
   digitação onde o que houve foi não declarar nada. O mutante sobrevivia a um
   caso que olhasse apenas `ok`. */
t("`base` ausente é recusado", !V(pat({ base: undefined })).ok);
t("...com a frase da AUSÊNCIA, não com a de valor inválido",
  (m => m.includes("exige `base`") && !m.includes("sobreviveu"))(err(V(pat({ base: undefined })))));
t("`base` que cita fonte inexistente tem a OUTRA frase",
  (m => m.includes("não existe nesta sessão"))(err(V(pat({ base: ["evidencia/9-nada.json"] })))));

/* ── 10.10 o valor que sai ────────────────────────────────────────────────── */
const vOk = V(pat());
t("um patch válido sai com `tipo: \"patch\"`", vOk.ok && vOk.valor.tipo === "patch");
t("...carregando o `patch` inteiro", vOk.ok && !!vOk.valor.patch.updateNodes);
t("...e o `resumo`", vOk.ok && /retry/.test(vOk.valor.resumo));

console.log("\n10b. o que a validação NÃO pode recusar — cada um custaria uma rodada");

t("só `updateNodes` passa", V(pat()).ok);
t("só `addNodes` passa",
  V(add({ name: "no_novo", type: "n8n-nodes-base.set", typeVersion: 3, position: [100, 200], parameters: {} })).ok);
t("só `rewire` passa",
  V(pp({ rewire: { verificador_numero: { main: [[{ node: "fim_lead_duplicado", type: "main", index: 0 }]] } } })).ok);
t("`addNodes` com `parameters` vazio passa",
  V(add({ name: "no_novo", type: "n8n-nodes-base.noOp", position: [0, 0], parameters: {} })).ok);
/* Medido nesta instância: `x` de −27632 a −4592. Uma checagem que exija número
   positivo recusaria a maioria dos fluxos reais daqui. */
t("`position` negativa passa — medido, x vai de −27632 a −4592",
  V(add({ name: "no_novo", type: "n8n-nodes-base.set", position: [-27632, -1200] })).ok);
t("`typeVersion` decimal (4.2) passa",
  V(add({ name: "no_novo", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [0, 0] })).ok);
/* O portão [PREENCHER] foi calibrado contra 3.649 nós reais justamente para não
   pegar isto: HTML dentro de parâmetro é normal num corpo de e-mail ou num Set. */
t("HTML dentro de um parâmetro passa — não é marcador",
  V(pp({ updateNodes: [{ name: "verificador_numero", parameters: { corpo: "Olá<br>tudo bem?</div>" } }] })).ok);
t("`notes` sem marcador passa",
  V(pp({ updateNodes: [{ name: "verificador_numero", notes: "retry porque a API cai em pico" }] })).ok);
/* É assim que se tira um nó do caminho sem verbo de delete — se isto fosse
   recusado, o §4.2 não teria saída nenhuma. */
t("`disabled: true` passa — é como se tira nó do caminho sem delete",
  V(pp({ updateNodes: [{ name: "fim_lead_duplicado", disabled: true }] })).ok);
t("dois verbos juntos passam",
  V(pp({
    updateNodes: [{ name: "verificador_numero", parameters: { a: 1 } }],
    rewire: { verificador_numero: { main: [[{ node: "criar_lead_supabase", type: "main", index: 0 }]] } }
  })).ok);
/* Um nó novo referenciado por um rewire ainda não está em `nomesValidos` — a
   checagem de origem tem de olhar o documento DEPOIS do `addNodes`, senão o par
   "cria e liga", que é o caso mais comum, é impossível. */
t("`rewire` que aponta PARA um nó recém-criado passa",
  V(pp({
    addNodes: [{ name: "no_novo", type: "n8n-nodes-base.noOp", position: [0, 0] }],
    rewire: { verificador_numero: { main: [[{ node: "no_novo", type: "main", index: 0 }]] } }
  })).ok);

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + total
  : "passou: " + total + " casos, e cada um recusa um defeito com nome"));
process.exit(falhas ? 1 : 0);
