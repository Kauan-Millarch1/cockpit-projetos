# CONTRATO — `/integracoes` somente-leitura

Fatia 1 do painel de integrações. **Somente leitura**: nada aqui autentica
ninguém, guarda chave, escreve no n8n nem no disco. Ela mostra o que o cockpit
**já sabe** responder hoje.

Este arquivo é a costura entre `integracoes.js` (fatos) e `integracoes.html`
(juízo). Duas leituras dele divergiriam na primeira correção feita num lado só.

---

## 1. A invariante do repositório vale aqui inteira

**`integracoes.js` emite FATO. `integracoes.html` julga.**

O módulo nunca diz `ok`, `quebrou`, `nunca` nem `conferindo`. Ele diz
*configurado*, *respondeu*, *status HTTP*, *quantos fluxos*, *achei a CLI*. A cor,
o nome do estado, a frase e o que para em consequência são decididos num bloco
de juízo único no topo do script da página — como `BANDS`/`diagnose` no
`flows.html` e `ESTADO`/`podeConversar` no `upgrade.html`.

Motivo, o mesmo de sempre: a definição de "quebrou" é a parte que o Kauan
ajusta mais, e espalhá-la pelo servidor faz cada ajuste exigir reinício.

## 2. `GET /api/integracoes`

```js
{
  em: "2026-08-21T14:53:07.001Z",   // quando ESTES fatos foram colhidos
  doCache: false,                   // esta colheita veio do cache de 30s?
  idadeMs: 0,                       // idade dos fatos, para a tela dizer "há N s"
  n8n: {
    configurado: true,              // .env tem N8N_BASE_URL e N8N_API_KEY
    instancia: "ecommercepuro.app.n8n.cloud" | null,   // host. NUNCA a chave
    checado: true,                  // perguntei para a instância nesta colheita?
    respondeu: true | false | null,  // null = não perguntei
    fluxos: 75 | null,              // quantos leu; null se não respondeu
    httpStatus: 200 | 401 | 503 | null,
    erro: null | "string",          // mensagem crua, já varrida (ver §4)
    ms: 1412 | null,
    parcial: false | null,          // a leitura bateu no teto? null = não sei
    teto: 1000 | null               // o teto que ela usou para decidir isso
  },
  claude: {
    cliAchada: true,
    caminho: "C:\\Users\\...\\claude.exe",
    sandbox: false,                 // COCKPIT_SANDBOX_TEST
    // vindos de `claude auth status --json`, ver secao 9
    logado: true | false | null,    // null = NAO PERGUNTEI (nao e 'nao esta logada')
    rota: "claude.ai" | null,       // authMethod — de qual cota sai o gasto
    plano: "team" | null,           // subscriptionType
    conta: "…@…" | null,            // email. `sens` na tela
    org: "…" | null,                // orgName. `sens` na tela
    porqueNaoSei: null | "string"   // so quando logado === null
  },
  codex: {
    integrado: false,               // o cockpit não tem caminho de Codex nenhum
    porque: "o cockpit não sabe chamar o Codex: não existe spawn, detecção nem variável de ambiente para ele."
  }
}
```

### Regras dos campos

- **`respondeu` tem TRÊS estados e `null` não é `false`.** `null` significa *não
  perguntei nesta colheita*; `false` significa *perguntei e não respondeu*. As
  duas levam a decisões opostas e a página tem que distinguir. Este repositório
  já pagou cinco vezes por deixar ausente cair no branch negativo.
- **`checado: false` com `configurado: true`** é legítimo, mas **NÃO** implica
  `respondeu: null` — ver a correção 1 no §8. Ele vem com o `respondeu` do cache,
  mais `doCache` e `idadeMs`. `respondeu: null` sobrou para um caso só: **não deu
  para perguntar** (`configurado` não é um `true` duro, ou o módulo injetado não
  tem `listWorkflows`, que é defeito da NOSSA fiação e não culpa da instância).
- **`httpStatus` é fato, não diagnóstico.** `401` com host respondendo *é* chave
  recusada; `503` ou timeout *é* instância fora do ar. Quem diz isso em português
  é a página, não o módulo.
- **`fluxos` é PISO, nunca total.** Se a leitura foi parcial, é o que deu para
  ler. A página tem que dizer "piso" e não fingir total.

## 3. O ping do n8n

Use `n8n.listWorkflows()` — já passa pela whitelist e pelo limite de
concorrência do módulo. **Cache de 30s** com timestamp próprio, porque essa
chamada mediu 1,4s para 75 fluxos e a página pode ser recarregada à vontade.
Erro **não entra no cache**: trinta segundos dizendo "não respondeu" mantém a
tela acusando uma instância que já voltou.

Nada de rota HTTP nova para o n8n. Nada de `getRawWorkflow` aqui.

## 4. A chave nunca sai, e isso é testado e não confiado

A chave vai no cabeçalho `X-N8N-API-KEY` e **não pode aparecer em campo nenhum**
da resposta — nem em `erro`, nem em `instancia`, nem em log. Varra a mensagem de
erro antes de devolver: qualquer coisa com cara de token (`eyJ`, sequência longa
de base64, `apiKey`, `X-N8N-API-KEY`) sai substituída.

`integracoes-test.js` tem que **asseverar essa ausência**, não presumir — contra
uma chave de verdade em formato JWT plantada na mensagem de erro. Mesma
disciplina de `licoes-test.js`.

## 5. O que a página julga

Bloco de juízo no topo, com nomes próprios, e cada um destes é decisão dela:

- **Os quatro estados** — `ok` / `nunca` / `conferindo` / `quebrou` — derivados
  dos fatos acima. `conferindo` é `respondeu === null`. `nunca` é
  `configurado: false`. `quebrou` é `respondeu: false`.
- **A frase da causa**, a partir de `httpStatus`: `401`/`403` com host
  respondendo é chave recusada; `5xx`, timeout ou erro de rede é instância fora
  do ar; qualquer outro é ambíguo e **diz que é ambíguo** em vez de escolher.
- **O que para em consequência** — sem leitura do n8n a vitrine fica vazia, o
  feed para, o quadro de erros fica cego, e correção, dossiê e upgrade não abrem
  porque nenhum dos três sabe o fluxo.
- **Codex** é `nunca`, com a frase de `porque` do módulo, e **sem botão de
  conectar** — oferecer um botão para um caminho que não existe é a pretensão
  que este repositório recusa.

## 6. O que esta fatia NÃO faz, e a tela precisa dizer

- Não autentica ninguém. O que protege o painel hoje é o `127.0.0.1`.
- Não guarda chave nenhuma. A do n8n continua vindo do `.env`, uma só, do
  processo inteiro — não existe noção de pessoa no código.
- Não troca, não desconecta, não reconecta. **Nenhum botão que escreve.** O
  mockup `Integracoes.dc.html` tem `Reconectar com outra chave`, `Trocar a
  chave`, `Desconectar` e `Conectar` — nesta fatia **nenhum deles existe**. Uma
  tela somente-leitura com botão que não faz nada é pior que sem botão.
- O único controle é **`Conferir de novo`**, que refaz a colheita. Ele não
  escreve nada.

## 7. Visual

Parta do mockup aprovado `.design/login/Integracoes.dc.html`: a anatomia das
linhas, os quatro estados distinguíveis **sem cor**, a grade de três células na
linha quebrada, o rodapé honesto. Traga o `<style>` e a marcação, e troque o que
o contrato acima manda trocar (fora os botões de escrita, dentro os fatos reais).

Topbar e cápsula de navegação: **copie do `upgrade.html`**, byte a byte, incluindo
a logo (`/ep-logo.png`, servida pelo servidor) e o `.eplogo` com os filtros por
tema. Não invente uma quinta porta na cápsula — o bloco é travado por
`nav-sync-test.js` e mexer nele é outra fatia. O wordmark é
`<b>COCKPIT</b> <span>/ integrações</span>`.

Vocabulário de aviso, diálogo e tema: os mesmos blocos das outras páginas.
Nenhum `alert()`, `confirm()` ou `prompt()` nativo, nunca.

---

## 8. Correções ao contrato, achadas construindo — o módulo ganhou

Escrevi as seis primeiras seções antes de ler o `n8n.js` linha por linha. Seis
coisas saíram erradas, o `integracoes.js` resolveu certo, e este registro existe
para o contrato não ficar mentindo para o próximo leitor.

**1. O cache quente NÃO é `conferindo`.** O §2 juntava "cache quente" e "não
perguntei" numa conclusão só. Errado: no cache quente a gente **perguntou**, há
12 segundos, e tem a resposta. Devolver `null` ali faria o painel mostrar
`conferindo` por 30s depois de **toda checagem bem-sucedida** — o cache passaria a
servir só ignorância, contra a razão do próprio §3. Corrigido acima.

**2. `fluxos` não pode ser piso com o que o `listWorkflows` dá.** Ele devolve
array cru: sem `truncado`, sem `total`. O único sinal de parcialidade em todo o
caminho é a guarda interna `rows.length < 1000` do `getWorkflows`. Então `parcial`
é **inferido** de um teto declarado no módulo, e isso é acoplamento vivo: subir o
teto no `n8n.js` faz uma leitura completa de 1.100 fluxos passar a ser anunciada
como piso. **A correção honesta é o `listWorkflows` reportar a própria
truncagem**, como o `locateNode` reporta `truncado` e o `callers` reporta
`falhas`. Fica registrado, não feito — é o módulo de fronteira de segurança e
não entra numa fatia de tela.

**3. `httpStatus` de 5xx não chega por `err.status`.** O `request()` só põe
`.status` no ramo `!res.ok`; o ramo de 429/5xx, depois de esgotar três
tentativas, lança um `Error` pelado — que é exatamente o caso "instância fora do
ar" que o §5 mais quer nomear. O módulo extrai o número da mensagem como
fallback documentado. **A correção limpa é uma linha no `n8n.js`** pendurando
`.status` também nesse ramo. Também registrado e não feito, e pelo mesmo motivo.

**4. `instancia` é derivado, não exportado.** O `n8n.instance` é o `cfg.baseUrl`
cru do `.env`. O host sai de um `hostDe` no módulo, que também tira `user:pass@`
se alguém escrever a base assim.

**5. O `listWorkflows` tem cache PRÓPRIO de 5 minutos.** Uma chamada pelada
responderia `respondeu: true` **sem tocar a rede** sobre uma instância que morreu
há quatro minutos — defeito maior que o que o §3 se preocupava em evitar (um erro
preso por 30s). O módulo passa `{ force: true }` por padrão.

**6. "Conferir de novo" com cache de 30s seria um botão que não faz nada.** Daí o
`refazer`, que a rota passa **só** no clique e nunca na pintura automática —
senão o cache não serve para nada.

### Duas coisas que ficaram fora e são dívida nomeada

O `parcial` da correção 2 e o `httpStatus` da correção 3 dependem de mudança no
`n8n.js`. As duas são pequenas e as duas melhoram o painel inteiro, não só esta
tela — e é justamente por isso que não entram aqui de carona.

---

## 9. O login do Claude é perguntado ao CLI (fatia 2)

`claudeFound` sempre foi `fs.existsSync(binário)`. Na máquina do Kauan "existe" e
"está logado" são a mesma coisa e nunca incomodou. **Na máquina de um estranho
são dois fatos**: instalado e nunca logado virava `CONECTADA` na tela, e a
primeira construção morria com um erro que não nomeava nada. É o primeiro defeito
que a primeira pessoa a chegar ia encontrar.

`claude auth status --json` devolve
`{loggedIn, authMethod, apiProvider, subscriptionType, email, orgId, orgName}`.
**Medido nesta máquina: ~670ms por chamada** — daí o cache de 30s da resposta
inteira valer também para isto.

### Regras

- **A pergunta vai para o CLI, nunca para `~/.claude/.credentials.json`.** Ler o
  arquivo de credencial de alguém para saber se ele está logado atravessa uma
  fronteira que este painel não atravessa nem no n8n. A resposta oficial existe;
  usa-se a resposta oficial.
- **`logado` tem TRÊS estados, e este é o mais caro de errar.** `false` é
  *perguntei e ela não está logada* — a saída é fazer login. `null` é *não deu
  para perguntar*, e aí `porqueNaoSei` diz qual dos quatro motivos: o CLI não está
  no disco, não sei nem se está, esta versão do cockpit subiu sem a checagem, ou a
  pergunta falhou. **As duas mandam a pessoa para lugares diferentes e não podem
  ler igual.**
- **Sem CLI no disco, não spawna.** `cliAchada !== true` responde sem perguntar.
- **`loggedIn` ausente na resposta do CLI não vira `false`.**
- **`perguntarLogin` nunca lança.** Um CLI pendurado ou uma resposta hostil não
  podem virar 500 na rota inteira. O `timeout` de 15s no `execFile` é parte disso:
  sem ele a tela ficaria `conferindo` para sempre.
- **A mensagem de erro passa pela varredura** antes de virar frase.
- **`conta` e `org` atravessam, e a tela marca as duas como `sens`.** É a máquina
  dela e é como ela confere que é a conta certa; o modo gravação borra, igual ao
  host do n8n.

### O que isto destrava na tela

O mockup afirmava *"Assinatura, por OAuth — plano `team`"* e *"Nenhum cartão é
cobrado nesta rota"*, e a fatia 1 **se recusou a imprimir** porque o contrato não
carregava o fato. Agora carrega: `rota` e `plano` vêm do CLI. A tela pode dizer de
qual cota sai o gasto — sem inventar.
