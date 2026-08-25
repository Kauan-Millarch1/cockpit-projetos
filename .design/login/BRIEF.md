# BRIEF — telas de entrada do Cockpit (login, n8n, IA)

**Este arquivo é a única fonte dos tokens.** Não redeclare valores de outro lugar,
não arredonde, não "melhore" um número. Cada artboard é um arquivo `.dc.html`
autocontido que repete o bloco de tokens abaixo **byte a byte**.

Idioma da tela: **português do Brasil**. Comentários no código: inglês.

---

## 0. O que estas telas são

O Cockpit hoje é localhost, um usuário, chave do n8n em `.env` que nunca sai da
máquina. Estas telas são a porta de entrada para **outras pessoas** entrarem com
o n8n delas e a IA delas. Três coisas, nesta ordem:

1. **Entrar** — identificar a pessoa.
2. **Conectar o n8n dela** — e já puxar os fluxos para o cockpit.
3. **Conectar a IA dela** — Claude ou Codex — para as ações que gastam modelo.

O cockpit sem (2) mostra estado honesto de erro; sem (3) ele degrada para o
handoff por clipboard e **diz por quê** — nunca finge que uma sessão rodou. As
telas têm que carregar essa honestidade, não esconder.

---

## 1. Tokens — copie este bloco inteiro no `<helmet><style>` do artboard

Base do cockpit é **escura**. Os artboards são escuros de propósito (um artboard
que troca de tema conforme o SO do espectador torna o PNG de revisão
imprevisível). O tema claro tem um artboard próprio, e só ele.

```css
:root {
  --bg:#06060B; --bg-deep:#040408; --surface:#0E0F1A; --surface-2:#14162454; --raised:#171A2B;
  --line:rgba(255,255,255,.09); --line-soft:rgba(255,255,255,.05);
  --grid:rgba(255,255,255,.028); --grid-bold:rgba(255,255,255,.055);
  --txt:#E9EBF5; --txt-dim:#AAAFC2; --txt-faint:#777D92;
  --accent:#5865F5; --accent-soft:#5865F51f; --accent-line:#5865F55c;
  --brand:#FF5A1F;
  --ok:#2FD48F; --warn:#F5A524; --risk:#FF4F5E; --cold:#59617D;
  --ok-soft:#2FD48F1a; --warn-soft:#F5A5241a; --risk-soft:#FF4F5E1a; --cold-soft:#59617D1a;
  --ok-txt:#2FD48F; --warn-txt:#F5A524; --risk-txt:#FF4F5E; --cold-txt:#798096;
  --accent-txt:#606CF5; --brand-txt:#FF5A1F;
  --shadow:0 1px 0 rgba(255,255,255,.03) inset, 0 18px 40px -24px rgba(0,0,0,.9);
  --font:"Segoe UI Variable Display","Segoe UI",Inter,system-ui,-apple-system,sans-serif;
  --font-num:"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",ui-monospace,monospace;
  --r:12px;
}
```

Só para o artboard de tema claro, troque o bloco acima por:

```css
:root {
  --bg:#FAFAF9; --bg-deep:#F4F4F2; --surface:#FFFFFF; --surface-2:#00000005; --raised:#FFFFFF;
  --line:rgba(10,10,20,.11); --line-soft:rgba(10,10,20,.06);
  --grid:rgba(10,10,20,.045); --grid-bold:rgba(10,10,20,.08);
  --txt:#14151C; --txt-dim:#3F424D; --txt-faint:#666973;
  --accent:#3B48E0; --accent-soft:#3B48E014; --accent-line:#3B48E055;
  --brand:#FF5A1F;
  --ok:#0E9F6E; --warn:#B7791F; --risk:#DC2B3A; --cold:#8B90A0;
  --ok-soft:#0E9F6E14; --warn-soft:#B7791F14; --risk-soft:#DC2B3A14; --cold-soft:#8B90A014;
  --ok-txt:#0B8159; --warn-txt:#9A661A; --risk-txt:#D02937; --cold-txt:#6D717E;
  --accent-txt:#3B48E0; --brand-txt:#D04919;
  --shadow:0 1px 2px rgba(10,10,20,.04), 0 12px 28px -22px rgba(10,10,20,.28);
  --font:"Segoe UI Variable Display","Segoe UI",Inter,system-ui,-apple-system,sans-serif;
  --font-num:"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",ui-monospace,monospace;
  --r:12px;
}
```

### Regras de cor que não se negociam

- **Cor de status é reservada.** `--ok/--warn/--risk/--cold` só dizem estado.
  Nunca como enfeite, nunca como cor de serviço, nunca numa borda decorativa.
- **`--brand` (#FF5A1F) é identidade**, não status: wordmark, o `[ 01 ]` do
  eyebrow, nada mais.
- **`--accent` significa MOVIMENTO** — foco, ação primária, o que está andando.
- **Cor de status como TEXTO usa o par `-txt`**, nunca o token de preenchimento
  (medido: o token de fill reprova AA em texto pequeno). Em texto sobre um fundo
  `-soft`, a receita é `color-mix(in srgb, var(--ok-txt) 72%, var(--txt))`.
- **Zero halo colorido.** Elevação é `rgba(0,0,0,…)`. Sombra colorida é o tell
  de interface gerada.

---

## 2. Componentes — copie a anatomia, não invente uma parecida

```css
/* botão — bevel de duas camadas, altura 32, raio 8, fonte 13 */
.btn { height:32px; padding:0 13px; border-radius:8px; cursor:pointer; color:var(--txt);
  font-size:13px; display:inline-flex; align-items:center; gap:7px; border:1px solid transparent;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--txt) 4%, var(--raised)), var(--raised)) padding-box,
    linear-gradient(180deg, color-mix(in srgb, var(--txt) 14%, transparent), var(--line)) border-box;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--txt) 7%, transparent), 0 1px 2px rgba(0,0,0,.18);
  transition: background .16s, box-shadow .18s, transform .09s, color .16s; }
.btn.ghost { background: transparent padding-box,
  linear-gradient(180deg, var(--line), var(--line-soft)) border-box; box-shadow:none; }
.btn.prime { color:#fff; border-color:transparent; font-weight:600;
  background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #fff), var(--accent));
  box-shadow:0 1px 0 rgba(255,255,255,.18) inset; }
.btn.ok { color:var(--ok-txt);
  background:linear-gradient(180deg, color-mix(in srgb, var(--ok) 16%, var(--raised)), var(--ok-soft)) padding-box,
    linear-gradient(180deg, color-mix(in srgb, var(--ok) 55%, transparent), color-mix(in srgb, var(--ok) 25%, transparent)) border-box; }
.btn[disabled] { opacity:.55; cursor:default; transform:none; }

/* campo — o padrão .fbusca do painel */
.fld { display:flex; align-items:center; gap:8px; min-width:0; background:var(--surface-2);
  border:1px solid var(--line); border-radius:10px; padding:7px 11px; }
.fld:focus-within { border-color:var(--accent-line); background:var(--accent-soft); }
.fld input { flex:1; min-width:0; border:0; background:transparent; outline:none;
  font-family:var(--font); font-size:13px; color:var(--txt); padding:1px 0; }
.fld input::placeholder { color:var(--txt-faint); }

/* painel e cartão */
.panel { background:var(--surface); border:1px solid var(--line); border-radius:var(--r);
  box-shadow:var(--shadow); position:relative; }
.panel-hd { display:flex; align-items:center; gap:12px; padding:12px 15px;
  border-bottom:1px solid var(--line-soft); }

/* eyebrow — a anotação em colchete, assinatura visual do painel */
.eyebrow { display:flex; align-items:center; gap:10px; font-family:var(--font-num);
  font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--txt-faint); margin:0 0 12px; }
.eyebrow .idx { color:var(--brand-txt); white-space:nowrap; }
.eyebrow .rule { flex:1; height:1px; background:var(--line-soft); }

/* etiqueta de estado */
.tag { font-family:var(--font-num); font-size:10.5px; padding:2px 7px; border-radius:6px; white-space:nowrap; }
.tag.ok   { color:color-mix(in srgb,var(--ok-txt) 72%,var(--txt));   background:var(--ok-soft); }
.tag.warn { color:color-mix(in srgb,var(--warn-txt) 72%,var(--txt)); background:var(--warn-soft); }
.tag.risk { color:color-mix(in srgb,var(--risk-txt) 72%,var(--txt)); background:var(--risk-soft); }
.tag.cold { color:color-mix(in srgb,var(--cold-txt) 72%,var(--txt)); background:var(--cold-soft); }

/* KPI / numeral */
.kpi .lbl { font-family:var(--font-num); font-size:10px; letter-spacing:.13em;
  text-transform:uppercase; color:var(--txt-faint); }
.kpi .val { font-family:var(--font-num); font-variant-numeric:tabular-nums; font-size:30px;
  font-weight:600; letter-spacing:-.02em; margin-top:5px; line-height:1.05; }
```

Outras medidas do painel, para não serem reinventadas: topbar 58px de altura,
`padding 0 22px`, `gap 18px`, fundo `color-mix(in srgb, var(--bg) 82%, transparent)`
com `backdrop-filter: blur(14px) saturate(1.2)` e borda inferior `--line`. Diálogo
raio 16px, `max-width 460px`, `padding 18px 19px 16px`. Pílula/cápsula raio 999px.
Título de cartão 13.5px/600. Texto de diagnóstico 12.5px em `--txt-dim`.
Corpo de diálogo 12.8px, `line-height 1.6`.

**Alvo de clique:** 32px é o padrão do cockpit em desktop e vale aqui — paridade
com o app manda. A regra de 44px só entra se você desenhar um artboard de celular.

---

## 3. Ícones

**Nunca emoji, nunca dingbat.** SVG inline, `viewBox="0 0 24 24"`, `fill="none"`,
`stroke="currentColor"`, `stroke-width="1.9"`, `stroke-linecap="round"`,
`stroke-linejoin="round"`, desenhado em 15/16/20px. É o dialeto exato da
navegação do cockpit. Glifo de texto (`⧉`, `↗`, `◐`, `⏺`, `✓`, `⨯`, `⊕`) é
aceito onde o painel já usa — mas `📎`, `🗀` e `⌕` foram **medidos** e saem como
caixa vazia nesta fonte. Não use.

---

## 4. Formato do arquivo `.dc.html`

Cada artboard é um arquivo assim, **estático** — sem `{{holes}}`, sem
`data-dc-script`, sem JS. A revisão desta rodada é por imagem; interatividade
entra depois que a direção for aprovada.

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    /* tokens do bloco 1 aqui, byte a byte */
    x-dc { display:block; }
    *, *::before, *::after { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--txt); font-family:var(--font);
      -webkit-font-smoothing:antialiased; }
    a { color:var(--accent-txt); text-decoration:none; }
    a:hover { color:var(--txt); }
    /* componentes do bloco 2, e só o que a tela usa */
  </style>
</helmet>
<!-- markup da tela -->
</x-dc>
</body>
</html>
```

Regras do formato que quebram em silêncio se ignoradas:

- A linha `<script src="./support.js"></script>` fica **exatamente assim**.
- `x-dc { display:block; }` é obrigatório: sem isso o elemento é inline e o
  layout desaba.
- HTML canônico: todo elemento não-void fechado, todo atributo entre aspas.
- **Prefira `style="…"` inline** no que deveria ser reestilizável no editor; use
  classe no que repete muito (botão, campo, tag).
- Grupos de irmãos (botões, chips, linhas, cards) vão em `display:flex`/`grid`
  com `gap`, **nunca** irmãos inline espaçados por margem ou espaço em branco.
- Sem `defer`, sem CDN, sem `fetch`. Fonte externa só Google Fonts — e **não
  use**: a pilha do cockpit é a de sistema.

---

## 5. Cópia (o texto da tela)

Português do Brasil, no tom que o painel já tem: **frase que diz o que fazer, não
rótulo abstrato**. O cockpit nunca promete o que não entrega, e a tela de entrada
é onde essa reputação começa.

- Nada de "Bem-vindo ao nosso sistema", nada de lorem ipsum, nada de texto de
  marketing intercambiável.
- Onde falta um fato real (preço, domínio, prazo), escreva `[SEU VALOR]` visível
  em vez de inventar.
- Um número na tela é medido ou é exemplo declarado. Não invente estatística.
- Onde a tela não sabe algo, ela **diz** que não sabe. "Não confirmei ainda" e
  "não tem" são duas frases diferentes e nunca podem ler igual.

---

## 6. O que NÃO fazer

- Não desenhe barra de status falsa de iOS nem teclado virtual falso.
- Não encha a tela. Seção vazia é problema de composição, não desculpa para
  inventar conteúdo. Mil "não" para cada "sim".
- Não adicione seção, página ou campo que ninguém pediu. Se achar que melhora,
  **anote no relatório** em vez de desenhar.
- Não use Inter, Roboto, Arial nem Fraunces como fonte declarada.
- Não use fundo em gradiente colorido grande, nem cartão com borda-esquerda
  colorida como enfeite (a borda esquerda do `.card` do cockpit existe e
  significa **status** — usar como decoração gasta o vocabulário).

---
---

# ADENDO 2 — rodada 2 (permanência, duas IAs, logo)

O que mudou no pedido, e vale sobre tudo acima onde conflitar.

## 7. A logo da Ecommerce Puro na topbar

**Arquivo: `ep-logo.png`, já está nesta pasta.** Referencie por nome:
`<img class="eplogo" src="ep-logo.png" alt="Ecommerce Puro" width="1000" height="445">`.
As aspas duplas no `src` são obrigatórias e o nome tem que casar exato — é
substituição literal na hora de semear, e um nome errado vira imagem quebrada
sem aviso nenhum.

Posição: **primeiríssimo item da topbar**, antes da chama, seguido de um
`<div class="sep eplogo-sep"></div>`. É onde o app põe.

CSS, transcrito do `upgrade.html` linha 216 — **não recalcule, não invente
outro valor**:

```css
.eplogo { height:32px; width:auto; flex:0 0 auto; display:block; filter:invert(1); }
```

**A arte é branca**, então:
- **artboard ESCURO** → acrescente `.eplogo { filter:none; }` depois da regra base.
  Branco sobre fundo escuro já é o certo.
- **artboard CLARO** → deixe o `filter:invert(1)` da regra base. Sem ele a logo
  **desaparece** no fundo branco. Isso foi medido, não é hipótese.

O app também esconde logo e separador abaixo de 620px
(`@media (max-width:620px){ .eplogo, .eplogo-sep { display:none } }`). O quadro
aqui é fixo em 1280, então a regra não dispara — inclua de todo jeito, para o
bloco não nascer divergente do app.

## 8. Ninguém passa duas vezes pela mesma etapa

As telas `01/02/03` são **primeira entrada**. Quem já conectou volta direto ao
painel e não vê nenhuma delas. Isso significa que a integração precisa de **duas
caras**, e elas não são a mesma tela com outro título:

- **onboarding** — sequência, um passo por vez, com denominador (`02 de 03`).
  Existe uma vez.
- **painel de integrações** — permanente, sempre alcançável, tudo junto numa
  tela, sem sequência e sem denominador. É onde ela troca a chave meses depois,
  conecta a segunda IA, desconecta uma.

## 8.1 Os QUATRO estados de cada conexão

Três não bastam mais. O quarto é o que aparece meses depois e é justamente o que
um sistema "inteligente" não pode confundir com o primeiro:

| estado | o que é | cor | o que a tela oferece |
|---|---|---|---|
| `nunca` | nunca foi conectado | `cold` | conectar |
| `conferindo` | a resposta não chegou ainda | `cold`, **forma diferente** | nada, e diz que está olhando |
| `ok` | conectado e respondendo | `ok` | trocar, desconectar |
| `quebrou` | **já funcionou e agora não** | `risk` ou `warn` | reconectar, e **diz o que aconteceu** |

`quebrou` tem causas distintas e a tela precisa nomear qual: chave revogada,
instância fora do ar, CLI desinstalada, cota do plano esgotada. "Não consegui
falar com o n8n" e "sua chave foi revogada" mandam a pessoa para lugares
diferentes.

**`nunca` e `quebrou` NUNCA podem ler igual.** Um é "você ainda não fez", o
outro é "aquilo que funcionava parou" — e o segundo é urgente. Este repositório
já pagou cinco vezes por deixar desconhecido cair no branch negativo; aqui o
erro seria pior, porque some com a urgência.

## 9. Duas IAs ao mesmo tempo

Tem gente com Claude **e** Codex, e o sistema tem que usar os dois. "Usar os
dois" tem três leituras, todas legítimas, e a tela precisa deixar claro qual
está em vigor:

1. **Uma IA por tipo de trabalho.** É a forma que o app já tem: cada tarefa é um
   spawn próprio, e já existe configuração por tarefa (modelo da construção,
   esforço da conversa, esforço do patch — e o esforço do patch é
   deliberadamente diferente do da conversa porque só um foi medido). Os
   trabalhos reais: **corrigir uma falha**, **construir um fluxo**, **conversar
   sobre um upgrade**, **escrever o dossiê**, **ler o changelog do n8n**.
2. **Reserva por cota.** Cota de assinatura é 5h/7d. Estourar no meio de uma
   construção de 13 minutos é falha real. Com duas conectadas, a segunda assume.
3. **As duas no mesmo trabalho, uma criticando a outra.** Uma escreve o patch,
   a outra revisa antes de o diff chegar na tela. É caro e é para o caminho que
   escreve em fluxo de produção.

Desenhe as três, com **(1) como o padrão em vigor** e as outras duas como chaves
que se ligam. Nenhuma delas pode aparecer como já decidida por nós.

O que **não** desenhar: nada que implique que as duas rodam sempre juntas de
graça, nem qualquer medidor de "resta X% da cota" — não existe fonte medida para
isso, e inventar um número na tela de confiança é a pior mentira disponível aqui.

## 10. Google

A parte de credencial do Google o Kauan está resolvendo em outra sessão. O botão
`Continuar com Google` continua na tela com o **glifo neutro** de sempre. Não
desenhe a marca de quatro cores, não mude o rótulo, não acrescente estado de
"conectado com Google".

---
---

# ADENDO 3 — rodada 3: o passo a passo do download

O Kauan escolheu que a IA gasta o **plano da pessoa**. Isso força o painel a rodar
na máquina dela, logo **ela baixa**. Esta rodada desenha esse caminho para ele ver
como seria antes de decidir.

## 11. A verdade que estas telas carregam

**Por que baixar, em uma frase:** o Claude só gasta a assinatura dela onde ela
está logada, que é o computador dela. Num servidor seria cartão — e a Anthropic
proíbe produto hospedado usar assinatura de terceiro (está escrito na página legal
do Claude Code, com estas palavras: *"does not permit third-party developers to
(…) route requests through Free, Pro, or Max plan credentials on behalf of their
users"*).

Essa frase precisa estar na tela do site, curta, **antes** do botão de baixar. Não
como desculpa — como o motivo pelo qual ela mantém o plano que já paga em vez de
pôr cartão.

## 12. O pré-requisito aparece ANTES do download, nunca depois

Ela precisa de duas coisas que a gente não entrega:

1. **Uma assinatura Claude** (Pro, Max, Team ou Enterprise).
2. **O Claude Code instalado**, e um login (`claude login`), feito uma vez.

Esconder isso até depois do download é o padrão sujo clássico: a pessoa baixa,
descompacta, abre, e só aí descobre que falta. **A tela do site diz antes.**

O que a gente **entrega** dentro do pacote: o próprio painel e o Node. Ela não
instala Node, não ouve a palavra "PATH".

## 13. As quatro telas

| arquivo | o que é |
|---|---|
| `Baixar.dc.html` | a página do site (a porta na Vercel): o que é o cockpit, o que ela precisa ter, o botão, e o motivo de ser download |
| `DepoisDeBaixar.dc.html` | o que fazer com o arquivo: descompactar, onde, e o que tem dentro |
| `PrimeiraAbertura.dc.html` | o painel abrindo pela primeira vez na máquina dela, com o Claude ainda **sem login** e o comando na tela |
| `Atualizar.dc.html` | versão nova disponível: o aviso, o que a atualização troca e o que ela **não** toca |

`Baixar` é a única que **não** é o painel — é uma página de site, e pode ter
respiro de página de produto. As outras três são o painel, e seguem o §1 e o §2
como as onze anteriores.

## 14. Regras desta rodada

- **Nada de contagem regressiva, selo de "grátis", prova social inventada ou
  depoimento.** Não existe usuário ainda; inventar um é a primeira mentira.
- **Número na tela é medido ou é exemplo declarado**, como sempre. Os custos
  medidos que podem aparecer: corrigir uma falha ~US$ 1,16; conversar um upgrade
  ~US$ 0,73; construir um fluxo US$ 3,19; dossiê US$ 4,14. Sempre rotulados como
  rodadas que já aconteceram, nunca como tabela de preço.
- **O tamanho do download é `[TAMANHO]`** — não foi medido. Não invente "80 MB".
- **`PrimeiraAbertura` mostra o estado `SEM LOGIN` que agora existe de verdade** no
  `integracoes.html`: instalada e logada são dois fatos, e a tela diz isso. Use o
  vocabulário que já está lá, não invente outro.
- **`Atualizar` diz o que a atualização NÃO toca**: a chave do n8n dela, os
  bilhetes de correção, os projetos salvos. E que **nada se atualiza sozinho** —
  um programa que abre o Claude e escreve em fluxo de produção não se troca em
  silêncio.
- Logo da Ecommerce Puro na topbar das três telas de painel, com as regras do §7.
  Na tela do site ela também aparece, e ali pode ser maior.
