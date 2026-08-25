# CONTRATO — perfil, entrada e super admin

Fatia 1 da conta. **Quem é você, e você pode entrar.** Nada aqui decide o que
você pode *fazer* depois de entrar — cargo e permissão são outra fatia, e o
Kauan pediu explicitamente que toda pessoa entre **sem cargo**.

Este arquivo é a costura entre `perfil.js` (fatos) e `entrar.html` / `perfil.html`
(juízo). Duas leituras dele divergiriam na primeira correção feita num lado só —
é o mesmo motivo do `CONTRATO-INTEGRACOES.md`.

---

## 0. O TETO, escrito antes de qualquer coisa

**Login em `127.0.0.1:4317` é identidade, não cadeado.**

Quem tem a máquina abre `.agente/` com o Bloco de Notas, chama a rota com `curl`,
ou edita o `server.js`. O próprio `guarda.decidir()` já documenta e escolhe isso:
cliente local sem `origin` e agente não pareado **passa sem token, de propósito**.

Então esta fatia:

- **impede** que a pessoa errada use o painel pela porta da frente;
- **não impede** quem tem a máquina e quer contornar.

Onde a aprovação vira tranca de verdade é na porta hospedada — sem aprovação,
não sai pacote e não sai pareamento. Essa é outra fatia. **A tela tem que dizer
essa frase**, não escondê-la: um cadeado que se anuncia mais forte do que é vale
menos que nenhum, porque alguém confia nele.

---

## 1. A invariante do repositório vale aqui inteira

**`perfil.js` emite FATO. A página julga.**

O módulo diz *tem sessão*, *o e-mail é este*, *o status gravado é `pendente`*,
*o Supabase respondeu 401*, *existem 3 pedidos*. Ele **nunca** diz que a conta
está "travada", nunca escolhe cor, nunca escreve a frase em português sobre o
que fazer a seguir. Isso é o bloco de juízo no topo da página — como
`BANDS`/`diagnose` no `flows.html` e `podeConversar` no `upgrade.html`.

O mesmo motivo de sempre: a definição de "pode entrar" é a parte que o Kauan
ajusta mais, e espalhá-la pelo servidor faz cada ajuste exigir reinício.

---

## 2. Os CINCO estados de uma conta, e nenhum par pode ler igual

| estado | o que é | o que a tela oferece |
|---|---|---|
| `conferindo` | a resposta não chegou ainda | nada, e **diz que está olhando** |
| `deslogado` | não há sessão | os dois botões de entrada |
| `pendente` | logou, ninguém decidiu | "Aguardando aprovação" + como falar com o Kauan |
| `aprovado` | pode usar o painel | o painel |
| `recusado` | decidido, e foi não | a frase, e **o motivo, se houver** |

**`conferindo` não é `deslogado`.** Este repositório já pagou **seis** vezes por
deixar campo ausente cair no ramo negativo — `docAgentes`, `ingredientes.credenciais`,
o cinza do dossiê, `resolucao`, `d.incremental`, `podeConversar`. Aqui o erro seria
o painel piscar a tela de login por meio segundo em toda abertura para quem já
está logado, e o segundo pisco é o que lê como defeito.

**`pendente` e `recusado` não podem ler igual.** Um é "espera"; o outro é
"acabou". Uma pessoa em `recusado` que lê "aguardando" fica esperando para
sempre — e nunca vai perguntar, porque a tela disse que estava tudo certo.

**Ausência de `status` na resposta não é `recusado`.** É `conferindo`.

---

## 3. As duas portas de entrada, e por que são duas

O Kauan descreveu: *"a pessoa manda o e-mail dela e eu aprovo"*. Isso é e-mail.
Então **magic link é o caminho principal** e **Google é conveniência**.

MEDIDO em 2026-08-25, no projeto Google Cloud `Cockpit`:

- tipo de usuário **Externo** (gente de fora pode logar);
- status **Testando** — logo **só quem estiver na lista "Usuários de teste"
  consegue logar com Google**, teto de 100, cadastrada à mão no Google Cloud;
- publicar exige Página inicial e Política de Privacidade, que não existem hoje.

**Consequência que decide o desenho:** enquanto o app estiver em Teste, uma
pessoa de fora clicando em "Continuar com Google" **não chega** na tela de
"Aguardando aprovação" — o Google barra antes. Se o Google fosse o único caminho,
o fluxo de auto-registro que esta fatia existe para servir não funcionaria para
ninguém além dos 100 cadastrados num painel que não é o nosso.

Magic link não passa por nada disso: sem Google Cloud, sem status de teste, sem
teto, sem verificação.

**Os dois caem no MESMO usuário.** O Supabase casa por e-mail verificado, então a
mesma pessoa entrando pelos dois caminhos tem um `auth.users.id` só — um perfil,
uma aprovação. A tela não pode sugerir que são duas contas.

---

## 4. O schema

```sql
create type public.perfil_status as enum ('pendente', 'aprovado', 'recusado');

-- Quem já pode entrar ANTES de existir. É a metade "eu adiciono o e-mail" do
-- pedido do Kauan. Não pode ser uma linha em `perfis`: `perfis.id` referencia
-- `auth.users`, que só existe depois do primeiro login.
create table public.convites (
  email       text primary key,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id) on delete set null,
  usado_em    timestamptz
);

create table public.perfis (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  nome         text,
  avatar_url   text,
  status       public.perfil_status not null default 'pendente',
  super_admin  boolean not null default false,
  papel        text,          -- NULL de propósito: "entra sem cargo/tag"
  pedido_em    timestamptz not null default now(),
  decidido_em  timestamptz,
  decidido_por uuid references auth.users(id) on delete set null,
  motivo       text,          -- por que recusou. Vai para a tela DELA.
  visto_em     timestamptz
);
```

### Por que `super_admin` é coluna própria e não um valor de `papel`

`papel` é o campo que o Kauan disse que vai desenhar depois, e ele vai crescer:
`operador`, `cliente`, `leitura`. Se super admin morasse lá, cada mudança nesse
vocabulário mexeria em quem pode aprovar login — a permissão mais perigosa do
sistema pendurada no campo que mais muda. São dois fatos e ficam em duas colunas.

### O gatilho, e ele resolve as DUAS metades do pedido de uma vez

Convite existe → o perfil nasce `aprovado`. Convite não existe → nasce `pendente`
e cai na fila do super admin.

*"Eu adiciono o e-mail dela"* e *"ela pede e eu aprovo"* são o **mesmo
mecanismo** visto de dois lados. Não são dois caminhos de código.

**`security definer` + `set search_path = ''`** no gatilho é obrigatório e não é
formalidade: sem o `search_path` vazio, quem controlar o schema de busca
sequestra uma função que roda como dono do banco.

---

## 5. RLS, e a recursão que vai acontecer se ninguém avisar

A política óbvia — *"super admin lê todos os perfis"* — precisa consultar
`perfis` para saber se você é super admin. Isso é recursão infinita, e o Postgres
responde `infinite recursion detected in policy for relation "perfis"`.

A saída é uma função `security definer stable` que lê a tabela **fora** da
política, com dois detalhes que não são estilo:

- `coalesce(..., false)` — **ausente nunca cai no ramo positivo**. A mesma regra
  do §2, aqui invertida: numa permissão, o silêncio é "não".
- `(select auth.uid())` entre parênteses, não `auth.uid()` pelado. O Postgres
  avalia o subselect uma vez por consulta em vez de uma vez por linha. É a
  diferença medida entre uma política que escala e uma que não.

Políticas:

| tabela | quem | o quê |
|---|---|---|
| `perfis` | a própria pessoa | `select` só da própria linha |
| `perfis` | super admin | `select` e `update` de todas |
| `perfis` | ninguém | `insert` e `delete` — quem cria é o gatilho, quem apaga é a cascata |
| `convites` | super admin | tudo |
| `convites` | qualquer um | nada. **Nem `select`** — a lista de quem foi convidado é informação sobre outras pessoas |

**`status`, `super_admin` e `papel` não podem ser escritos pela própria pessoa**,
nem quando a política de `update` dela existir numa fatia futura. Um `update`
com RLS liberado na linha inteira é auto-aprovação. As três colunas ficam de fora
por checagem de coluna explícita, nunca por confiança na tela.

---

## 6. O bootstrap: como o Kauan vira super admin sem ter quem o aprove

O primeiro super admin não pode nascer de um clique — não existe tela para
clicar antes de existir super admin.

**Não vale "o primeiro que logar vira super admin".** É uma corrida: quem chegar
primeiro na instância recém-criada leva o painel inteiro.

Nasce na migration, com o e-mail escrito por extenso, e o gatilho marca
`super_admin = true` para esse e-mail no primeiro login. Escrito, versionado,
auditável — quem ler o repositório sabe quem manda e desde quando.

---

## 7. Sem dependência, porque essa é a regra da casa

`README`/`CLAUDE.md`: **Node 22, zero dependências.** Então **não** entra
`@supabase/supabase-js`, nem por npm nem por CDN (o `BRIEF.md` §4 já proíbe CDN).

O fluxo é feito à mão contra a API REST do Supabase Auth, do mesmo jeito que
`guarda.js` verifica JWT com o `crypto` do Node em vez de puxar o `jose`:

| passo | chamada |
|---|---|
| Google | `GET /auth/v1/authorize?provider=google&redirect_to=…&code_challenge=…&code_challenge_method=s256` |
| magic link | `POST /auth/v1/otp` `{email, create_user:true}` |
| troca do código | `POST /auth/v1/token?grant_type=pkce` `{auth_code, code_verifier}` |
| renovação | `POST /auth/v1/token?grant_type=refresh_token` |

**PKCE, não implicit.** O `code_verifier` nasce e morre no processo do agente e
nunca vai ao browser, então um código interceptado na barra de endereços não
vira sessão.

---

## 8. Onde a sessão mora, e por que não no browser

**O token nunca chega ao JavaScript da página.** O `server.js` faz a troca do
código, guarda `access_token` e `refresh_token`, e devolve ao browser um cookie
`HttpOnly; SameSite=Lax; Path=/` com um id **opaco** de sessão.

Motivo: `localStorage` é legível por qualquer script da página, e este painel
renderiza texto que vem do n8n — conversa de lead, mensagem de erro, nome de nó.
A regra do repositório já é *"payload do n8n é hostil"*. Um token de sessão ao
alcance desse texto seria a primeira coisa a vazar num XSS.

**O `refresh_token` é segredo e vai para o `cofre.js`** (DPAPI do Windows), que
existe exatamente para isso e hoje está escrito e desligado. O teto do DPAPI já
está declarado lá e vale aqui sem mudança: não protege contra outro processo
rodando na mesma conta de Windows.

---

## 9. As rotas

| rota | o que faz |
|---|---|
| `GET /entrar` | a tela. Serve mesmo sem sessão — é a única que serve. |
| `GET /api/perfil/eu` | fato: `{estado, email, nome, status, superAdmin, papel, motivo, em}`. **Nunca token.** |
| `POST /api/perfil/entrar/google` | devolve a URL de autorização. Não redireciona sozinho. |
| `POST /api/perfil/entrar/email` | dispara o magic link. Resposta **idêntica** para e-mail que existe e que não existe. |
| `GET /api/perfil/callback` | troca o código, cria a sessão, seta o cookie, redireciona. |
| `POST /api/perfil/sair` | encerra a sessão e apaga o refresh do cofre. |
| `GET /api/perfil/pedidos` | **só super admin.** A fila. |
| `POST /api/perfil/decidir` | **só super admin.** `{id, aprovar, motivo}`. |
| `POST /api/perfil/convite` | **só super admin.** Adiciona e-mail antes de a pessoa existir. |

**A resposta de `/entrar/email` é a mesma para e-mail conhecido e desconhecido.**
Respostas diferentes transformam a tela de login num oráculo de "esta pessoa tem
conta aqui", que é vazamento sobre terceiros e não sobre quem perguntou.

**`/api/perfil/pedidos` e `/decidir` são checados no SERVIDOR contra
`super_admin` do banco**, nunca contra o que a página afirmou. A tela esconder o
botão é conveniência; a rota recusar é a regra.

**Nenhuma porta nova na cápsula de navegação.** As quatro estão travadas por
`nav-sync-test.js` e mexer nelas é outra fatia — é a mesma decisão que
`/integracoes` já tomou.

---

## 10. O que a página julga

Bloco único no topo, com nomes próprios:

- `estadoConta(fato)` — os cinco do §2.
- `podeEntrar(fato)` — o verdadeiro; a tela consulta e **nunca recalcula**, mesmo
  motivo do rodapé do `/upgrade` que lê `podeAplicar` e `aplicavel` sem redefinir
  nenhum dos dois.
- `FRASE_ESTADO` — cinco frases distintas, com teste asseverando que são distintas.
- `TETO_FRASE` — a frase do §0 na tela. Não é rodapé decorativo.

---

## 11. O que esta fatia NÃO faz, e a tela precisa dizer

- **Não define cargo nem permissão.** Todo mundo entra sem `papel`, por pedido
  explícito do Kauan. A tela de super admin **não** mostra seletor de cargo — um
  controle que não faz nada é pior que nenhum.
- **Não pareia nada.** `pareamento.js` é outra cerimônia e continua sendo.
- **Não muda `guarda.js`.** O guarda decide requisição; isto decide pessoa.
- **Não protege o painel de quem tem a máquina** — §0.
- **Não manda e-mail nosso.** Quem manda o magic link é o Supabase, com o SMTP
  dele. O limite gratuito é baixo; se virar problema, é configurar SMTP próprio,
  e isso é outra fatia com nome.

---

## 12. Decisões que são do Kauan, e uma delas está bloqueando

**A. `guarda.decidirSemJwks` lança exceção hoje** (`guarda.js:346`). Precisa de
uma das três leituras que o próprio comentário lista: fail-closed puro, cache com
TTL, ou misto (fecha na escrita, abre na leitura). Ver §13.

**B. Publicar o app no Google** depende de página inicial e política de
privacidade reais. Sem isso o botão do Google serve só para quem estiver na lista
de teste. Não é bloqueio para começar.

**C. O que acontece com uma sessão `aprovado` que é rebaixada para `recusado`.**
Duas leituras: expulsa na hora (cada requisição reconsulta o banco — mais caro,
correto na hora) ou vale até a sessão vencer (mais barato, e a pessoa recusada
segue dentro por até N horas). É a mesma escolha de fundo do JWKS, e merece a
mesma resposta.

---

## 13. `decidirSemJwks` — a função que está esperando o Kauan

Arquivo `guarda.js`, linha 346. Assinatura já pronta:

```js
function decidirSemJwks({ cacheado, agora, muta }) {
  // devolve { permite: boolean, motivo: string }
}
```

`cacheado` é `{ chaves, buscadoEm } | null` — o último JWKS bom, se houver.
`agora` é ms epoch **injetado** (nunca `Date.now()` aqui dentro, ou a política
deixa de ser testável). `muta` diz se a rota escreve.

O `motivo` vai para a tela, então tem que separar **"não confirmei a
assinatura"** de **"assinatura inválida"**. São frases diferentes: a primeira
acusa a nossa rede, a segunda acusa quem chamou. Este repositório já tem três
casos em que ler igual custou tempo.
