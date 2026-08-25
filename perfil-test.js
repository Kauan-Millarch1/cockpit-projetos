/* perfil-test.js — o login, o cargo e as vagas, sem rede e sem navegador.
 *
 * Cada caso recusa um defeito com nome. Os quatro que carregam o arquivo:
 *
 *   1. NENHUM TOKEN ATRAVESSA para o browser. Asseverado contra JWT de verdade
 *      plantado em mensagem de erro, e sobre a fonte da rota `/api/perfil/eu`.
 *   2. CAMPO AUSENTE NUNCA CAI NO RAMO NEGATIVO. Este repositório já pagou seis
 *      vezes por isso; aqui o erro seria a tela de login piscando em toda
 *      abertura para quem já está logado.
 *   3. AS FRASES DE ESTADO SÃO DISTINTAS. Uma frase repetida em dois estados
 *      ensina a ignorar os dois — e "esperando" lido como "recusado" deixa a
 *      pessoa esperando para sempre.
 *   4. PLURAL POR EXTENSO. O português não flexiona só o último termo, e a
 *      primeira medição desta tela saiu com "2 nunca foi vista" e "2 operador".
 *
 * O bloco de juízo é EXTRAÍDO do `entrar.html` em tempo de execução. Reimplementá-lo
 * aqui provaria a cópia, não a página — a disciplina que o `audio-test.js`
 * estabeleceu neste repositório.
 *
 * Grátis: sem modelo, sem rede, sem servidor, sem escrever nada no repositório.
 * `node perfil-test.js`
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
const perfil = require("./perfil.js");
const HTML = fs.readFileSync(path.join(RAIZ, "entrar.html"), "utf8");
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");

/* Comentário fora antes de qualquer verificação de fiação. O `dossie-tela-test.js`
   pagou por isto: dois casos ficaram verdes porque um comentário carregava o nome
   que eles procuravam, e o código tinha sido apagado. */
const semComentario = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* ─────────────────────── extrai o bloco de juízo da página, e o executa ───── */

function juizo() {
  const i = HTML.indexOf("function estadoConta(f)");
  const f = HTML.indexOf("/* ══════════════════════════ fim do bloco de juízo");
  if (i < 0 || f < 0) throw new Error("não achei o bloco de juízo em entrar.html");
  const src = HTML.slice(i, f);
  return new Function(src + `
    return { estadoConta, FRASE_ESTADO, podeEntrar, ehSuperAdmin, ehAdmin, ehOperador,
             cargoDe, CARGO_NOME, podeIntegrar, INTEGRA_TETO, vagas, FRASE_VAGAS,
             VAGA_AVISO, TETO_FRASE, SESSAO_FRASE, ESTADO_TAG, PORTAS,
             PRESENCA_DIAS, contarPessoas, FRASE_ATIVOS };`)();
}
const J = juizo();

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n1. NENHUM token atravessa — a asseveração, não a confiança");

/* Um JWT de formato real plantado onde uma mensagem de erro do Supabase chegaria. */
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiJhYmMiLCJyb2xlIjoiYW5vbiIsImV4cCI6OTk5OTk5OTk5OX0.s3cr3tS1gnatur3XYZabcdef";
const varrido = perfil.varrer("falhou ao chamar com " + JWT + " no cabeçalho");
nao(varrido.includes(JWT), "um JWT inteiro não sobrevive à varredura");
nao(varrido.includes("eyJhbGci"), "nem o prefixo dele");
sim(varrido.includes("<token>"), "e a varredura DIZ que apagou, em vez de sumir em silêncio");

const chave = "sb_publishable_z5F1JGgDR9TW6AX9i4ef8A_BMK3cF54";
nao(perfil.varrer("apikey " + chave + " recusada").includes(chave), "a chave publicável não atravessa");
nao(perfil.varrer("Bearer sb_secret_ABCDEFGHIJKLMNOPQRSTUVWX").includes("sb_secret_ABCDEFGH"),
  "nem uma chave secreta, se alguém colar uma por engano");

/* A rota `/api/perfil/eu` é a única que a página consulta sobre a sessão. O corpo
   dela é construído campo a campo, e nenhum desses campos é token. */
const rotaEu = SERVER.slice(
  SERVER.indexOf('if (p === "/api/perfil/eu"'),
  SERVER.indexOf('if (p === "/api/perfil/entrar/google"')
);
sim(rotaEu.length > 100, "achei a rota /api/perfil/eu na fonte");
for (const proibido of ["t.access", "access_token", "refresh", ".refresh"]) {
  nao(new RegExp("json\\(res[^;]*" + proibido.replace(".", "\\.")).test(rotaEu),
    "a resposta de /api/perfil/eu não carrega «" + proibido + "»");
}
sim(/sessao: true,\s*\n?\s*perfil: r\.perfil/.test(rotaEu) || rotaEu.includes("perfil: r.perfil"),
  "ela devolve o perfil, e o perfil vem do banco — não do token");

/* O `CAMPOS` é a lista branca do que sai do Supabase. Um token não está nela, e
   nenhum campo com cara de segredo pode entrar sem alguém ver. */
for (const suspeito of ["token", "senha", "password", "secret", "chave"]) {
  nao(perfil.CAMPOS.toLowerCase().includes(suspeito),
    "CAMPOS não pede «" + suspeito + "» ao PostgREST");
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n2. PKCE — o verificador nasce e morre no processo");

const k1 = perfil.pkce(Buffer.alloc(32, 7));
const k2 = perfil.pkce(Buffer.alloc(32, 7));
eq(k1.verificador, k2.verificador, "mesmo aleatório, mesmo verificador (é determinístico e testável)");
eq(k1.desafio, k2.desafio, "e mesmo desafio");
nao(/[+/=]/.test(k1.verificador + k1.desafio), "base64url puro: sem +, / ou = para escapar na URL");
eq(k1.verificador.length, 43, "verificador de 43 caracteres (32 bytes em base64url)");
sim(perfil.pkce().verificador !== perfil.pkce().verificador, "sem semente, dois PKCE são diferentes");

const url = perfil.urlAutorizacao({
  base: "https://x.supabase.co", provedor: "google",
  redirectTo: "http://127.0.0.1:4317/api/perfil/callback?s=ABC", desafio: k1.desafio
});
sim(url.includes("code_challenge_method=s256"), "o método do desafio viaja");
sim(url.includes(encodeURIComponent("?s=ABC")), "o state viaja DENTRO do redirect_to");
nao(url.includes(k1.verificador), "o VERIFICADOR nunca entra na URL — é o ponto do PKCE");

/* MEDIDO em 25/08/2026: o Supabase gera o `state` dele e não devolve o nosso, então
   o nosso tem que viajar no `redirect_to`. Sem isso o login quebra em 100%. */
eq(perfil.comStateNaVolta("http://a/b", "S1"), "http://a/b?s=S1", "state entra com ? quando não há query");
eq(perfil.comStateNaVolta("http://a/b?x=1", "S1"), "http://a/b?x=1&s=S1", "e com & quando já há");
sim(perfil.comStateNaVolta("http://a/b", "a b&c").includes("a%20b%26c"),
  "um state torto é escapado, nunca concatenado cru");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n3. Os estados da conta — e ausente NUNCA cai no ramo negativo");

eq(J.estadoConta(null), "conferindo", "fato ausente é «conferindo», não «deslogado»");
eq(J.estadoConta(undefined), "conferindo", "undefined também");
eq(J.estadoConta("404"), "conferindo", "um corpo que não é objeto (o 404 que vira número) não vira sessão");
eq(J.estadoConta({ sessao: false }), "deslogado", "sem sessão é deslogado");
eq(J.estadoConta({ sessao: true, perfil: null }), "conferindo",
  "sessão sem perfil ainda é «conferindo» — não é recusado");
eq(J.estadoConta({ sessao: true, perfil: { status: "pendente" } }), "pendente", "pendente");
eq(J.estadoConta({ sessao: true, perfil: { status: "aprovado" } }), "aprovado", "aprovado");
eq(J.estadoConta({ sessao: true, perfil: { status: "recusado" } }), "recusado", "recusado");
eq(J.estadoConta({ sessao: true, perfil: { status: "arquivado" } }), "conferindo",
  "um status que ninguém previu NÃO libera por não estar na lista");
eq(J.estadoConta({ erro: "boom" }), "erro", "falha de leitura é o seu próprio estado");

nao(J.podeEntrar({ sessao: true, perfil: { status: "pendente" } }), "pendente não entra");
nao(J.podeEntrar(null), "sem fato não entra");
sim(J.podeEntrar({ sessao: true, perfil: { status: "aprovado" } }), "aprovado entra");

console.log("\n3b. as frases são DISTINTAS — repetida, ensina a ignorar as duas");
const frases = Object.entries(J.FRASE_ESTADO);
eq(new Set(frases.map(f => f[1])).size, frases.length, frases.length + " frases, todas diferentes");
sim(J.FRASE_ESTADO.pendente !== J.FRASE_ESTADO.recusado,
  "«esperando» e «recusado» nunca leem igual — a primeira espera, a segunda acabou");
sim(/ningu[ée]m decidiu|esperando/i.test(J.FRASE_ESTADO.pendente),
  "a de pendente diz que ninguém decidiu, e não que foi negado");
const tags = Object.values(J.ESTADO_TAG).map(t => t.txt);
eq(new Set(tags).size, tags.length, "as etiquetas também são distintas");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n4. Cargo — e o admin é as TRÊS condições, como no banco");

const aprovado = s => ({ sessao: true, perfil: Object.assign({ status: "aprovado" }, s) });
sim(J.ehAdmin(aprovado({ papel: "admin", organizacao_id: "o1" })), "admin aprovado com org é admin");
nao(J.ehAdmin(aprovado({ papel: "admin" })), "admin SEM organização não gerencia ninguém");
nao(J.ehAdmin({ sessao: true, perfil: { status: "pendente", papel: "admin", organizacao_id: "o1" } }),
  "admin não aprovado não é admin");
sim(J.ehAdmin(aprovado({ super_admin: true })), "super admin conta como admin");
nao(J.ehAdmin(aprovado({ papel: "operador", organizacao_id: "o1" })), "operador não é admin");
nao(J.ehAdmin(null), "sem fato, não é admin");

eq(J.cargoDe(aprovado({ super_admin: true })), "SUPER ADMIN", "super admin tem etiqueta própria");
eq(J.cargoDe(aprovado({ papel: null })), null, "sem cargo é null, e a tela é quem escreve a frase");
eq(J.cargoDe(aprovado({ papel: "operador" })), "OPERADOR", "operador");
sim(/DESCONHECIDO/.test(J.cargoDe(aprovado({ papel: "gerente" })) || ""),
  "um cargo que a tela não conhece DIZ que não conhece, em vez de virar operador");

console.log("\n4b. integração é do admin, e o teto disso está escrito");
sim(J.podeIntegrar(aprovado({ papel: "admin", organizacao_id: "o1" })), "admin mexe em integração");
nao(J.podeIntegrar(aprovado({ papel: "operador", organizacao_id: "o1" })), "operador não");
nao(J.podeIntegrar(aprovado({ papel: null })), "sem cargo, não");
sim(/por fora do navegador|n[ãa]o impede o determinado/i.test(J.INTEGRA_TETO),
  "o teto da regra está escrito, e não implícito");
sim(/n[ãa]o tranca/i.test(J.TETO_FRASE), "a tela diz que o login não é cadeado");
sim(/reiniciar/i.test(J.SESSAO_FRASE), "e diz que reiniciar o cockpit desloga");

/* A porta de integrações não pode estar na cápsula: lá ela seria uma sexta porta
   travada pelo nav-sync-test, e não teria como sumir por cargo. */
eq(J.PORTAS.length, 1, "a lista de portas do cartão tem só a que a cápsula não tem");
eq(J.PORTAS[0].href, "/integracoes", "e ela é integrações");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n5. Vagas — «3 para sempre», e ausente é «não sei», nunca zero");

eq(J.vagas(null), null, "sem organização, não sei quantas vagas");
eq(J.vagas({ teto_operadores: 3 }), null, "faltando `vagas_usadas`, não sei — e não invento");
eq(J.vagas({ vagas_usadas: 1 }), null, "faltando o teto, também não");
const v0 = J.vagas({ teto_operadores: 3, vagas_usadas: 0 });
eq(v0.restam, 3, "nenhuma usada, três restam");
const v3 = J.vagas({ teto_operadores: 3, vagas_usadas: 3 });
eq(v3.restam, 0, "três usadas, nenhuma resta");
const v9 = J.vagas({ teto_operadores: 3, vagas_usadas: 9 });
eq(v9.restam, 0, "mais usadas que o teto não vira número negativo na tela");

sim(/n[ãa]o sei|n[ãa]o consegui/i.test(J.FRASE_VAGAS(null)),
  "sem dado, a frase DIZ que não sabe — nunca «0 vagas», que é a decisão oposta");
sim(J.FRASE_VAGAS(v0).includes("3 vagas disponíveis"), "três: plural");
sim(J.FRASE_VAGAS(J.vagas({ teto_operadores: 3, vagas_usadas: 2 })).startsWith("1 vaga disponível"),
  "uma: SINGULAR, escrito por extenso e não derivado com «s»");
sim(/nenhuma vaga/i.test(J.FRASE_VAGAS(v3)), "esgotado tem frase própria");
sim(/n[ãa]o volta|para sempre|se perde/i.test(J.VAGA_AVISO),
  "o aviso diz ANTES do clique que a vaga não volta — a decisão do Kauan, escrita");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n6. Quem está usando ≠ quem está aprovado");

const AGORA = Date.parse("2026-08-25T12:00:00Z");
const povo = [
  { status: "aprovado", visto_em: "2026-08-25T11:00:00Z" },  /* hoje */
  { status: "aprovado", visto_em: "2026-08-01T10:00:00Z" },  /* fora da janela */
  { status: "aprovado", visto_em: null },                    /* nunca visto */
  { status: "pendente" },
  { status: "recusado" }
];
const c = J.contarPessoas(povo, AGORA);
eq(c.total, 5, "conta todo mundo");
eq(c.aprovados, 3, "três aprovados");
eq(c.ativos, 1, "UM ativo — aprovado não é usando, e é isso que o contador existe para separar");
eq(c.nuncaVistos, 1, "um nunca visto");
eq(c.pendentes, 1, "um esperando");
eq(c.recusados, 1, "um recusado");
eq(J.contarPessoas(null, AGORA).total, 0, "lista ausente não estoura");
eq(J.contarPessoas([], AGORA).ativos, 0, "lista vazia é zero, e aí zero é verdade");

/* A janela é de dias, então alguém visto exatamente no limite conta. */
const limite = [{ status: "aprovado", visto_em: new Date(AGORA - J.PRESENCA_DIAS * 86400000).toISOString() }];
eq(J.contarPessoas(limite, AGORA).ativos, 1, "quem foi visto exatamente no limite ainda conta");
const passou = [{ status: "aprovado", visto_em: new Date(AGORA - J.PRESENCA_DIAS * 86400000 - 1000).toISOString() }];
eq(J.contarPessoas(passou, AGORA).ativos, 0, "um segundo além do limite, não");

console.log("\n6b. plural por extenso — a armadilha que já saiu na tela");
const f2 = J.FRASE_ATIVOS(J.contarPessoas([
  { status: "aprovado", visto_em: "2026-08-25T11:00:00Z" },
  { status: "aprovado", visto_em: null },
  { status: "aprovado", visto_em: null }
], AGORA));
sim(f2.includes("2 nunca foram vistas"), "dois no plural: «foram vistas»");
nao(f2.includes("2 nunca foi vista"), "e NÃO «2 nunca foi vista», que foi o defeito medido");
const f1 = J.FRASE_ATIVOS(J.contarPessoas([
  { status: "aprovado", visto_em: "2026-08-25T11:00:00Z" },
  { status: "aprovado", visto_em: null }
], AGORA));
sim(f1.includes("1 nunca foi vista"), "um no singular");
sim(J.FRASE_ATIVOS(J.contarPessoas([{ status: "aprovado", visto_em: "2026-08-25T11:00:00Z" }], AGORA))
  .startsWith("1 pessoa abriu"), "uma pessoa: singular");
sim(/antes de o cockpit começar a anotar/.test(f1),
  "«nunca visto» admite que a medição começou depois — não acusa o passado");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n7. A fiação do servidor — medida na fonte, sem comentário");

const S = semComentario(SERVER);

sim(S.includes('p === "/conta" || p === "/entrar"'), "a aba e o endereço de login servem o mesmo arquivo");
sim(/PAGINAS_COM_LOGIN[\s\S]{0,200}"\/integracoes"/.test(S), "integrações está atrás do portão de login");
sim(/LOGIN_EXIGIDO\s*&&\s*PAGINAS_COM_LOGIN\.has\(p\)/.test(S), "o portão é consultado antes de servir a página");
sim(/if \(!g\.admin\) return json\(res, 403/.test(S), "a ROTA /api/integracoes recusa por cargo, não só a tela");

/* O cargo só do super admin: se `SUPER` sumisse desta condição, um admin poderia
   promover a si mesmo pela rota de decidir. O banco recusaria, mas isso viraria um
   500 na tela em vez de uma regra. */
sim(/if \(SUPER && corpo\.aprovar\)/.test(S), "papel/organização só viajam quando quem decide é o super admin");
sim(S.includes('papel: "operador"'), "o convite do admin é operador por construção, nunca vindo do corpo");
nao(/corpo\.papel[\s\S]{0,120}equipe\/convidar/.test(S), "a rota da equipe não lê cargo do corpo");
sim(/alvo === t\.sub/.test(S), "ninguém decide sobre a própria conta");

/* `super_admin` fora do grant é a defesa do banco; aqui a defesa é não aceitar do
   corpo em rota nenhuma. */
nao(/corpo\.super_admin/.test(S), "nenhuma rota lê `super_admin` do corpo");

console.log("\n7b. o cookie da sessão");
sim(/HttpOnly/.test(S), "o cookie é HttpOnly — o token não chega no JavaScript da página");
sim(/SameSite=Lax/.test(S), "SameSite=Lax deixa a volta do login funcionar e barra POST cruzado");
nao(/cockpit_sessao=\$\{[^}]*\}[^"]*Secure/.test(S),
  "sem `Secure`: é http no loopback, e com ele o cookie seria descartado em silêncio");

console.log("\n7c. os dois 429 do Supabase não leem igual");
sim(S.includes("over_email_send_rate_limit"), "o teto do e-mail EMBUTIDO é reconhecido pelo código");
sim(/doProjeto[\s\S]{0,400}SMTP/.test(S), "e a frase dele manda configurar SMTP, não esperar");
sim(/usarGoogle/.test(S), "a tela recebe o sinal para oferecer a outra porta");

/* ══════════════════════════════════════════════════════════════════════════ */
console.log("\n8. A página não redireciona para fora, e não injeta HTML de fora");

const P = semComentario(HTML);
sim(/\/\^\\\/\(disco\|tester\|upgrade\|integracoes\)\?\$\//.test(P) ||
    P.includes("/^\\/(disco|tester|upgrade|integracoes)?$/"),
  "o `?volta=` é lista de permissão de caminho interno — não filtro de proibição");
/* APERTADO depois de acusar em falso: a primeira versão procurava as palavras
   soltas e casava com `autocomplete="email"`, que é atributo constante. O que
   importa não é a palavra, é a LEITURA DE PROPRIEDADE — `p.email`, `x.motivo`,
   `e.message` —, porque é ela que traz texto de fora para dentro da string. */
const acessoExterno = /innerHTML\s*=\s*[^;]*[\w\]]\.(email|nome|motivo|message|erro|texto|nomeArquivo)\b/;
nao(acessoExterno.test(P), "nenhum dado de fora entra por innerHTML");
/* Mutante: prova que a regra ainda MORDE. Sem isto, apertar a regex poderia ter
   trocado um falso positivo por um caso que não pega nada. */
sim(acessoExterno.test('el.innerHTML = "<b>" + p.email + "</b>";'),
  "e a regra ainda pega o defeito de verdade (mutante verificado)");
sim(acessoExterno.test('x.innerHTML = `<i>${linha.motivo}</i>`;'),
  "inclusive dentro de template string");
sim(P.includes("tx.textContent = texto"), "o aviso é montado por textContent");

/* ══════════════════════════════════════════════════════════════════════════
 *
 * 9. O TETO ABSOLUTO DE VIDA DA SESSÃO — conferido pelo SERVIDOR, não pelo cookie
 *
 * O DEFEITO: `podar()` só roda dentro de `comecarGoogle`/`comecarEmail`, ou seja
 * quando alguém COMEÇA um login. Numa máquina onde o dono loga uma vez e não loga
 * mais — que é o caso normal deste painel — `podar()` nunca mais roda, e
 * `tokenValido` conferia unicamente o vencimento do access token, que ele mesmo
 * renova sozinho para sempre. O id de sessão passava a valer pelo tempo de vida
 * do processo.
 *
 * O `Max-Age` de 12h do cookie NÃO É a tranca, e é fácil confundir os dois: é uma
 * instrução ao BROWSER, e quem copia o valor do cookie para um `curl` não a
 * obedece. A única tranca é a que o servidor confere.
 *
 * Este bloco dirige o `tokenValido` DE VERDADE, plantando a sessão pelo
 * `_sessoes()` que o módulo já expõe para o teste. Reimplementar a conta aqui
 * provaria a cópia, não o módulo.
 *
 * ASSÍNCRONO, então o relatório final espera por ele — sem isso o `process.exit`
 * sairia antes, e um caso vermelho aqui viraria uma suíte verde.
 * ══════════════════════════════════════════════════════════════════════════ */

async function tetoDeSessao() {
  console.log("\n9. O teto de vida da sessão é do SERVIDOR — o Max-Age do cookie não tranca nada");

  /* A FIAÇÃO VEM PRIMEIRO, e a ordem foi paga por um mutante. Estes dois casos
     moram antes do bloco que dirige o módulo porque o espião de rede lá embaixo
     LANÇA: com a trava apagada, a exceção sobe e tudo o que estivesse depois dela
     nunca rodaria — dois casos que parecem existir e não são exercidos, que é a
     forma mais silenciosa de um teste não provar nada.

     E eles medem o CORPO do `tokenValido`, não o arquivo: o defeito nunca foi a
     constante faltar (ela sempre esteve no `podar()`), foi ela não ser conferida
     NESTE caminho, que é o único por onde toda requisição autenticada passa. Um
     caso que procurasse o nome no arquivo inteiro ficaria verde com a trava
     apagada. Fonte SEM COMENTÁRIO, porque o comentário desta trava cita os dois
     nomes procurados — casar dentro dele aprovaria a ausência da decisão. */
  const FONTE = semComentario(fs.readFileSync(path.join(RAIZ, "perfil.js"), "utf8"));
  const iTV = FONTE.indexOf("async function tokenValido");
  const fTV = FONTE.indexOf("function encerrar", iTV);
  sim(iTV > 0 && fTV > iTV, "achei o corpo do `tokenValido` na fonte");
  const corpoTV = FONTE.slice(iTV, fTV);
  sim(/SESSAO_VIDA_MS/.test(corpoTV),
    "o teto é conferido DENTRO do `tokenValido` — não só no `podar()`, que quase nunca roda");
  sim(/criadaEm/.test(corpoTV), "e a conta é contra `criadaEm`, não contra o vencimento do access token");

  const VIDA = perfil.SESSAO_VIDA_MS;
  const cfg = { url: "http://nao-deve-ser-chamado.invalido", chave: "x" };
  const T0 = 1_000_000_000;

  /* O espião de rede. Uma sessão que já venceu não pode gastar uma ida ao
     Supabase para renovar o que este processo já decidiu recusar — e sem o espião
     "recusou" e "recusou depois de bater na rede" ficam indistinguíveis. */
  const fetchReal = global.fetch;
  let idas = 0;
  global.fetch = async () => { idas++; throw new Error("a rede foi tocada por uma sessão vencida"); };

  const planta = (id, criadaEm, extra) => {
    perfil._sessoes().set(id, Object.assign({
      access: "acc-" + id, refresh: "ref-" + id,
      expiraEm: criadaEm + 3600_000, sub: "sub-" + id, criadaEm
    }, extra || {}));
  };

  try {
    /* Dentro do teto e com token novo: passa, e é o caso que prova que a trava
       não fecha a porta para quem tem direito de entrar. */
    planta("viva", T0);
    const viva = await perfil.tokenValido(cfg, "viva", T0 + 60_000);
    sim(viva.ok === true, "uma sessão dentro do teto continua valendo");

    /* O caso do defeito: token de acesso LONGE de vencer (logo, o ramo antigo
       devolvia `ok` sem olhar mais nada), sessão nascida antes do teto. */
    planta("velha", T0, { expiraEm: T0 + VIDA * 10 });
    const velha = await perfil.tokenValido(cfg, "velha", T0 + VIDA + 1);
    nao(velha.ok, "uma sessão mais velha que o teto é RECUSADA, mesmo com access token válido");
    eq(velha.motivo, "sessão vencida: passou do teto de "
      + Math.round(VIDA / 3600000) + "h desde o login",
      "o motivo diz o teto, e o prazo sai derivado da constante");

    /* Três motivos, três frases. Um motivo repetido em dois estados ensina a
       ignorar os dois — e aqui "id que nunca existiu" e "passou de 12h" levam a
       telas diferentes: uma é "o cockpit reiniciou", a outra é "entre de novo". */
    const desconhecida = await perfil.tokenValido(cfg, "nunca-existiu", T0);
    nao(desconhecida.ok, "um id que não existe é recusado");
    sim(velha.motivo !== desconhecida.motivo,
      "«vencida pelo teto» e «desconhecida» são frases DISTINTAS");
    sim(velha.motivo !== "sessão vencida e sem renovação",
      "e distinta também da recusa por falta de refresh_token");

    /* Apagar, e não só recusar: manter a linha no Map deixaria o `refresh_token`
       — que é segredo — vivo em memória depois de o processo já ter decidido que
       ele não serve. E a exclusão é OBSERVÁVEL, senão a asserção seria sobre nada. */
    nao(perfil._sessoes().has("velha"), "a sessão vencida sai do Map, com o refresh_token dentro dela");
    const denovo = await perfil.tokenValido(cfg, "velha", T0 + VIDA + 2);
    eq(denovo.motivo, "sessão desconhecida", "e a segunda tentativa já cai como desconhecida");

    /* O pior caso do espião: sessão vencida pelo teto E com o access token
       expirado E com refresh_token no lugar. Antes da trava isto renovava. */
    planta("renovavel", T0, { expiraEm: T0 + 1000 });
    const renovavel = await perfil.tokenValido(cfg, "renovavel", T0 + VIDA + 1);
    nao(renovavel.ok, "vencida pelo teto não renova, nem tendo refresh_token");
    eq(idas, 0, "e NENHUMA ida ao Supabase foi gasta por uma sessão que este processo já recusou");

    /* A borda, fixada nos dois lados: `>` e não `>=`. Sem os dois casos, trocar o
       operador passaria despercebido em um dos sentidos. */
    planta("borda", T0, { expiraEm: T0 + VIDA * 10 });
    sim((await perfil.tokenValido(cfg, "borda", T0 + VIDA)).ok === true,
      "exatamente no teto ainda vale (a trava é `>`, não `>=`)");
    planta("borda2", T0, { expiraEm: T0 + VIDA * 10 });
    nao((await perfil.tokenValido(cfg, "borda2", T0 + VIDA + 1)).ok,
      "um milissegundo além do teto, não vale mais");
  } finally {
    global.fetch = fetchReal;
    for (const k of ["viva", "velha", "renovavel", "borda", "borda2"]) perfil._sessoes().delete(k);
  }
}

tetoDeSessao().then(() => {
  console.log("\n" + (falhas
    ? "FALHOU: " + falhas + " de " + total
    : "passou: " + total + " casos, e nenhum token atravessa"));
  process.exit(falhas ? 1 : 0);
}, e => {
  console.log("\nFALHOU: o bloco 9 explodiu — " + ((e && e.stack) || e));
  process.exit(1);
});
