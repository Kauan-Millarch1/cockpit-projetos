/* cofre-tela-test.js — a chave do n8n entra pela tela, e nada dela volta.
 *
 * O `cofre.js` já tinha teste próprio (`cofre-test.js`, cifra e decifra) e o
 * `n8n.js` já sabia LER dele. O que NÃO existia era a fiação: medido por grep em
 * 25/08/2026, **zero chamadas a `cofre.guardar` fora dos testes do próprio
 * cofre**. Este arquivo cobre o que essa fiação trouxe.
 *
 * Os quatro casos que carregam o arquivo:
 *
 *   1. A CHAVE NUNCA VOLTA. Nem inteira, nem truncada, em campo nenhum da
 *      resposta — prefixo publicado deixa conferir um palpite, e o painel vira
 *      oráculo de credencial.
 *   2. `revogacaoManual` TEM CONSUMIDOR. O cabeçalho do `cofre.js` obriga a tela
 *      a avisar que a chave antiga segue ativa no n8n, e transformou isso num
 *      CAMPO justamente para a ausência do consumidor ser aferível. Este é o
 *      caso que torna a obrigação real em vez de prosa.
 *   3. `abriu === false` NÃO É "não tem chave". Um cofre de outra máquina não
 *      decifra aqui por desenho, e a saída é colar de novo — não é procurar
 *      defeito. As duas frases mandam para lugares diferentes.
 *   4. O `VERDADE` DA TELA NÃO MENTE. As três frases do rodapé afirmavam "não há
 *      login", "nenhuma chave é guardada aqui" e "dois arquivos locais" — e as
 *      três ficaram falsas na mesma tarde. O comentário delas prometia que iam
 *      para o teste; não iam. Agora vão.
 *
 * Grátis: sem modelo, sem rede, sem servidor, sem PowerShell, e NADA é escrito —
 * o cofre de verdade desta máquina não é tocado em caso nenhum.
 * `node cofre-tela-test.js`
 */

"use strict";

const fs = require("fs");
const path = require("path");

let falhas = 0, total = 0;
const ok = m => { total++; console.log("  ok    " + m); };
const erro = m => { total++; falhas++; console.log("  FALHA " + m); };
const eq = (a, b, m) => (a === b ? ok(m) : erro(m + " — esperava «" + b + "», veio «" + a + "»"));
const sim = (v, m) => (v ? ok(m) : erro(m));
const nao = (v, m) => (!v ? ok(m) : erro(m));

const RAIZ = __dirname;
const HTML = fs.readFileSync(path.join(RAIZ, "integracoes.html"), "utf8");
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
const COFRE = fs.readFileSync(path.join(RAIZ, "cofre.js"), "utf8");

/* Comentário fora antes de qualquer verificação de fiação — a lição que o
   `dossie-tela-test.js` pagou: dois casos ficaram verdes porque um comentário
   carregava o nome que eles procuravam. */
const semComentario = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const S = semComentario(SERVER);
const P = semComentario(HTML);

/* O bloco de juízo do cofre, extraído da página em tempo de execução. */
function juizo() {
  /* Do começo do bloco até o FIM da última constante dele. O delimitador é o
     `;` que fecha `COFRE_TETO` — cortar por um marcador que vem antes no arquivo
     (como o `SO_UM_CONTROLE`) devolve fatia vazia, e a fatia vazia falha aqui
     dizendo que não achou o bloco, que foi o primeiro erro deste teste. */
  const i = HTML.indexOf("function estadoCofre(k)");
  const t = HTML.indexOf("const COFRE_TETO", i);
  const f = t < 0 ? -1 : HTML.indexOf(";", HTML.indexOf("mudaria isso.", t));
  if (i < 0 || f < 0) throw new Error("não achei o bloco do cofre em integracoes.html");
  return new Function(HTML.slice(i, f + 1) + `
    return { estadoCofre, COFRE_FRASE, COFRE_TAG, fonteFrase, COFRE_REVOGA, COFRE_TETO };`)();
}
const J = juizo();

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n1. A rota existe, é do admin, e a chave NUNCA volta");

const rota = S.slice(S.indexOf('if (p === "/api/cofre")'), S.indexOf('if (p === "/api/integracoes")'));
sim(rota.length > 200, "achei a rota /api/cofre na fonte");
sim(/GET|POST|DELETE/.test(rota), "ela trata os três métodos");
sim(/if \(!g\.admin\) return json\(res, 403/.test(rota), "recusa quem não é admin, no SERVIDOR");
sim(/405/.test(rota), "um método fora dos três é 405, e não silêncio");

/* A resposta é montada campo a campo. Nenhum desses campos é a chave, e nenhum
   caminho aqui devolve `corpo.chave` de volta. */
nao(/json\(res[^;]*corpo\.chave/.test(rota), "nenhuma resposta ecoa `corpo.chave`");
nao(/\bchave:\s*(v|corpo\.chave|r\.chave)\b/.test(rota), "nenhum campo `chave` na resposta");
nao(/slice\(0,\s*\d+\)/.test(rota), "não existe truncagem — prefixo publicado é pior que nada");
sim(/varrer\(/.test(rota), "a mensagem de erro passa pela varredura antes de virar resposta");

/* O corpo é pequeno de propósito: um JWT do n8n tem centenas de bytes. */
const teto = /readBody\(req,\s*(\d+)\)/.exec(rota);
sim(teto && Number(teto[1]) <= 4096, "o corpo da escrita tem teto pequeno (" + (teto ? teto[1] : "?") + " bytes)");

/* Sem isto o processo seguiria usando a chave anterior até reiniciar, e a tela
   diria "guardada" enquanto o n8n continuaria recusando. */
eq((rota.match(/n8n\.esquecerChave\(\)/g) || []).length, 2,
  "o memo do cliente é zerado depois de gravar E depois de apagar");

console.log("\n1b. o servidor não imprime corpo de requisição");
nao(/console\.log\([^)]*corpo/.test(S), "nenhum `console.log` de corpo de requisição no server.js");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n2. `revogacaoManual` — a obrigação virou campo, e o campo tem consumidor");

sim(COFRE.includes("revogacaoManual"), "o cofre.js emite o campo");
sim(/obriga[çc][ãa]o|tem obriga/.test(COFRE), "e o cabeçalho dele diz que a tela é obrigada a avisar");
sim(/revogacaoManual:\s*r\.revogacaoManual === true/.test(rota),
  "a rota repassa o campo, e como booleano estrito");
/* ESTE é o caso que torna a obrigação real: se alguém apagar o aviso da tela,
   isto fica vermelho. Prosa não fica vermelha. */
sim(/if \(r\.revogacaoManual\) avisar\(COFRE_REVOGA/.test(P),
  "a TELA consome o campo e mostra o aviso — a ausência do consumidor é aferível");
sim(/n[ãa]o revoga a chave antiga/i.test(J.COFRE_REVOGA), "o aviso diz que não revoga");
sim(/Settings|n8n API/i.test(J.COFRE_REVOGA), "e diz ONDE revogar, em vez de deixar a pessoa procurar");
sim(/vazamento/i.test(J.COFRE_REVOGA),
  "e nomeia o caso em que trocar só aqui não fecha porta nenhuma");

console.log("\n2b. o teto do DPAPI está na tela, não só no código");
sim(/mesma conta do Windows/i.test(J.COFRE_TETO),
  "a tela diz que não protege contra processo da mesma conta do Windows");
sim(/zipada|backup|commit/i.test(J.COFRE_TETO), "e diz o que ele DE FATO protege");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n3. Os estados — e `abriu: false` nunca lê como «não tem chave»");

const c = (o) => ({ cofre: Object.assign({ disponivel: true }, o) });
eq(J.estadoCofre(null), "conferindo", "fato ausente é «conferindo»");
eq(J.estadoCofre({}), "conferindo", "sem o bloco do cofre, também");
eq(J.estadoCofre("404"), "conferindo", "um corpo que não é objeto não vira estado");
eq(J.estadoCofre({ cofre: { disponivel: false } }), "indisponivel", "sem DPAPI, indisponível");
eq(J.estadoCofre(c({ temChave: false })), "vazio", "cofre vazio");
eq(J.estadoCofre(c({ temChave: true, abriu: true })), "ok", "guardada e abriu");
eq(J.estadoCofre(c({ temChave: true, abriu: false })), "quebrou",
  "existe cofre e NÃO abriu — é o seu próprio estado");
eq(J.estadoCofre(c({ temChave: true, abriu: null })), "ok",
  "`abriu: null` com chave guardada não vira «quebrou»: null é «não perguntei»");

const fr = Object.values(J.COFRE_FRASE);
eq(new Set(fr).size, fr.length, fr.length + " frases de estado, todas distintas");
sim(J.COFRE_FRASE.vazio !== J.COFRE_FRASE.quebrou,
  "«vazio» e «quebrou» nunca leem igual — um é «cole a chave», o outro é «cole de novo»");
sim(/n[ãa]o[\s<b>]*é o mesmo que n[ãa]o ter chave/i.test(J.COFRE_FRASE.quebrou.replace(/<[^>]+>/g, "")),
  "a frase de «quebrou» DIZ que não é o mesmo que não ter chave");
sim(/outra m[áa]quina|outra conta/i.test(J.COFRE_FRASE.quebrou),
  "e nomeia a causa provável, em vez de mandar procurar defeito");

console.log("\n3b. de onde a chave vem agora");
sim(/cofre/.test(J.fonteFrase({ fonte: "cofre" })), "fonte cofre");
sim(/\.env/.test(J.fonteFrase({ fonte: "env" })), "fonte env");
sim(/texto puro/i.test(J.fonteFrase({ fonte: "env" })),
  "e diz que o .env é texto puro — que é o motivo de o cofre existir");
sim(/n[ãa]o sei/i.test(J.fonteFrase(null)), "fato ausente responde «não sei», nunca «não tem»");
sim(/nenhuma/i.test(J.fonteFrase({ configurado: false })),
  "sem chave nenhuma tem frase própria");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n4. O rodapé da tela não mente sobre o que ela virou");

const verdade = new Function(HTML.slice(HTML.indexOf("const VERDADE = ["),
  HTML.indexOf("];", HTML.indexOf("const VERDADE = [")) + 2) + "; return VERDADE;")();
eq(verdade.length, 3, "as três linhas do rodapé");
const txt = verdade.map(v => v.html).join(" ");

nao(/Esta tela n[ãa]o autentica ningu[ée]m/.test(txt),
  "não diz mais «não autentica ninguém» — agora há login e esta tela é do admin");
nao(/N[ãa]o h[áa] login/.test(txt), "nem «não há login»");
nao(/Nenhuma chave de servi[çc]o é guardada aqui/.test(txt),
  "não diz mais «nenhuma chave é guardada aqui» — a do n8n pode ser");
nao(/dois arquivos locais/.test(txt), "não diz mais «dois arquivos locais» — são três");
sim(/tr[êe]s arquivos locais/.test(txt), "diz três");
sim(/cofre/i.test(txt), "e nomeia o cofre entre eles");
sim(/No n8n, nada/.test(txt),
  "e MANTÉM o que continua verdadeiro: no n8n, nada é escrito por esta tela");
sim(/n[ãa]o tranca a m[áa]quina/i.test(txt),
  "o teto do login continua dito, agora no lugar da frase que ficou falsa");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n5. A tela: o campo, os dois passos, e o valor que não fica guardado");

sim(/id="chaven8n" type="password"/.test(P), "o campo é `password` — é credencial numa tela que é filmada");
sim(/autocomplete="off"/.test(P), "sem autocomplete");
sim(/spellcheck="false"/.test(P), "sem corretor: um JWT sublinhado de vermelho parece erro");

/* O valor NÃO mora no estado da página. */
nao(/S\.chave\s*=\s*(campo|v|\$\("#chaven8n")/.test(P),
  "o valor digitado nunca é guardado em `S`");
nao(/if \(ev\.target\.id === "chaven8n"\)/.test(P),
  "e não há ouvinte de `input` copiando a chave para o estado");
sim(/if \(campo\) campo\.value = "";/.test(P), "o campo é limpo depois de guardar");

console.log("\n5b. apagar é destrutivo, então é em dois passos e diz a consequência");
/* APERTADO depois de um mutante sobreviver: procurar a string solta casava
   também com o despachante de ações (`if (a === "cofre-apagar-ok")`), então
   apagar o BOTÃO não derrubava nada. O que importa é o atributo no markup — é
   ele que existe ou não na tela. */
sim(/data-acao="cofre-apagar-ok"/.test(P), "existe o botão do segundo passo");
sim(/data-acao="cofre-apagar-nao"/.test(P), "e o botão de desistir");
sim(/if \(a === "cofre-apagar-ok"\)/.test(P), "e o despachante atende os dois");
sim(/if \(a === "cofre-apagar-nao"\)/.test(P), "inclusive o de desistir");
sim(/S\.chaveApagando/.test(P), "com estado próprio");
sim(/btn perigo/.test(P), "o botão do segundo passo é o único vermelho desta seção");
sim(/n[ãa]o guarda hist[óo]rico/i.test(P), "a consequência aparece ANTES do clique");
sim(/volta a procurar a chave no <code>\.env<\/code>/.test(P),
  "e diz o efeito colateral: o painel cai no .env, que pode não ter chave");

console.log("\n5c. a colheita do cofre é independente das outras duas");
sim(/^carregarChave\(false\);$/m.test(P), "ela roda no boot, no topo do arquivo");
nao(/await carregarPar\(false\);\s*carregarChave/.test(P),
  "e não pendurada na cerimônia de pareamento");
sim(/S\.chaveErro/.test(P), "falha de leitura tem campo próprio — não apaga o que se sabe do resto");
sim(/defeito do cockpit/i.test(P), "e a frase dela acusa o cockpit, não a configuração da pessoa");

console.log("\n" + (falhas
  ? "FALHOU: " + falhas + " de " + total
  : "passou: " + total + " casos, e a chave não volta por caminho nenhum"));
process.exit(falhas ? 1 : 0);
