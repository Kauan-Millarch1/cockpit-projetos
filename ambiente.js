"use strict";
/* ambiente.js — o ambiente que um filho headless recebe, em UM lugar só.
 *
 * POR QUE ESTE ARQUIVO NASCEU, medido e não raciocinado. O `tester.js` monta o
 * ambiente do filho por allowlist desde sempre (`ENV_ALLOW`, 22 entradas). O
 * `claude-fix.js` NÃO: ele espalhava `{ ...process.env }` e cegava só a
 * `N8N_API_KEY`. Medição de 24/08/2026 nesta máquina: o ambiente tem **87**
 * variáveis e o espalhamento deixava passar **69**. Cinco com cara de segredo ou
 * de provedor, e uma delas é credencial VIVA:
 *
 *   CLAUDE_CODE_MESSAGING_TOKEN     token de verdade, 32 caracteres
 *   GIT_ASKPASS                     script que o git chama para pedir credencial
 *   VSCODE_GIT_ASKPASS_MAIN         idem
 *   VSCODE_GIT_ASKPASS_NODE         idem
 *   VSCODE_GIT_ASKPASS_EXTRA_ARGS   (vazia)
 *
 * mais `COMPUTERNAME` e `USERNAME`, que atravessam a identidade da máquina.
 *
 * O `claude-fix.js` é a sessão que ESCREVE PATCH EM FLUXO DE PRODUÇÃO, e o
 * `03-subprocesso-e-prompt.md` mediu que mensagem de WhatsApp de um estranho chega
 * íntegra ao prompt dela. Então o ambiente dessa sessão é superfície de ataque, e
 * não configuração.
 *
 * A cadeia `GIT_ASKPASS` é a mais interessante e a menos óbvia: hoje ela é inerte
 * porque a sessão não tem `Bash` — o que significa que a cerca de FERRAMENTA é a
 * única coisa entre esse ambiente e as credenciais de git da máquina. E este
 * repositório já mediu que `--allowedTools` não restringe nada, só aprova. Uma
 * cerca só não é uma cerca.
 *
 * ───────────────────────────────────────────── por que UM arquivo, e não dois
 *
 * O `CLAUDE.md` já escreveu a regra a propósito de outra coisa e ela vale inteira
 * aqui: "uma segunda cópia dessas flags em outro arquivo divergiria na primeira
 * correção feita num lado só, e o lado que divergisse seria uma sessão sem cerca".
 * Copiar `ENV_ALLOW` para o `claude-fix.js` teria fechado o buraco de hoje e criado
 * o de amanhã.
 *
 * Não dá para importar do `tester.js`: ele requer o `claude-fix.js`, seria ciclo.
 * Então a lista desce para uma FOLHA — este arquivo não requer nada do projeto,
 * então qualquer um pode lê-lo sem risco de ciclo.
 *
 * ────────────────────────────────────────── o que a ausência de chave garante
 *
 * `ANTHROPIC_API_KEY` e os interruptores de Bedrock/Vertex NÃO estão na lista, e
 * essa ausência é a garantia de que o custo fica no plano: **uma variável que não
 * existe não precisa ser lembrada**. Cegar com string vazia seria outra coisa —
 * a variável existiria, e bastaria alguém preenchê-la em qualquer ponto do caminho.
 *
 * Quando a distribuição ligar o modo "chave de API", quem monta a exceção é o
 * adaptador de provedor, EXPLICITAMENTE, e para um provedor de cada vez. A base
 * continua sendo esta, sem chave nenhuma.
 */

/* A allowlist. Cada entrada existe por um motivo, e o motivo é sempre o mesmo:
   sem ela o CLI não roda ou não acha a própria credencial de login.

   `APPDATA`/`LOCALAPPDATA`/`USERPROFILE` são de onde sai a credencial OAuth do
   Claude — tirar qualquer uma delas troca "gasta o plano" por "não autentica".
   `PATH` aparece nas duas grafias porque o Windows não distingue caixa no
   ambiente e o Node preserva a que veio; ler só uma perde a outra em máquina que
   escreve diferente. */
const ENV_ALLOW = [
  "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME",
  "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE", "LANG", "LC_ALL"
];

/* Nomes que NUNCA podem entrar, nem por allowlist nem por acréscimo de quem
   chama. É uma segunda camada e é de propósito: `nomeSeguro` mais `dentro()` é a
   disciplina desta casa, e aqui a primeira camada é a allowlist e esta é a prova
   depois. Se um dia alguém acrescentar "ANTHROPIC_API_KEY" ao `ENV_ALLOW` por
   engano, isto barra — e barra com nome, em vez de deixar o custo sair do plano
   em silêncio. */
const ENV_NUNCA = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|AWS_[A-Z_]*|GOOGLE_APPLICATION_CREDENTIALS|OPENAI_API_KEY|N8N_API_KEY|.*_ASKPASS.*|CLAUDE_CODE_MESSAGING_TOKEN)$/i;

/* O ambiente de um filho headless.
 *
 * `entrada` é para teste: sem ela lê `process.env`. Não é ponto de extensão de
 * produção — quem precisa acrescentar algo usa `extra`, que passa pela mesma
 * peneira do `ENV_NUNCA`.
 *
 * `extra` existe para o `CLAUDE_CODE_ENTRYPOINT`, que cada caminho preenche com o
 * próprio nome, e para o adaptador de provedor acrescentar a chave de API quando
 * a pessoa escolheu esse modo. Passar pela peneira é o que impede "acrescentar
 * extra" de virar a porta dos fundos que a allowlist fechou na frente. */
function envLimpo({ entrada = null, extra = null } = {}) {
  const fonte = entrada || process.env;
  const out = {};
  for (const k of ENV_ALLOW) {
    if (ENV_NUNCA.test(k)) continue;            // a segunda camada, sobre a lista
    if (fonte[k] != null) out[k] = fonte[k];
  }
  for (const [k, v] of Object.entries(extra || {})) {
    if (ENV_NUNCA.test(k)) {
      throw new Error("`" + k + "` não pode entrar no ambiente de uma sessão headless");
    }
    if (v != null) out[k] = String(v);
  }
  return out;
}

/* O que a allowlist DEIXOU de fora de um ambiente concreto. Fato, para teste e
   para quem quiser medir de novo numa máquina diferente sem reescrever a conta —
   a medição do cabeçalho envelhece, o jeito de refazê-la não. */
function vazariam(entrada = process.env) {
  const dentro = new Set(ENV_ALLOW);
  return Object.keys(entrada).filter(k => !dentro.has(k)).sort();
}

module.exports = { ENV_ALLOW, ENV_NUNCA, envLimpo, vazariam };
