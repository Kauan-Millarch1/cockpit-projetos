# O que saiu quando o Cockpit deixou de ser produto

**Data da decisão: 09/09/2026.** O cockpit voltou a ser o que era antes de alguém
imaginar vendê-lo: um painel local, de uma pessoa, na máquina dela. A camada que
existia para servir *outras* pessoas — login, aprovação de entrada, cargos,
organizações, cofre de chave por tela e a cerimônia de pareamento com um site
hospedado — saiu inteira.

**24 arquivos, 754.008 bytes (≈736 KB), medidos em `d9efd67` com `git cat-file -s`.**

Este documento existe por um motivo só: **aquele trabalho estava certo e foi
medido.** Sete migrations com RLS ligada, um cofre DPAPI, 47 casos de teste só na
tela de integrações, uma cerimônia de pareamento desenhada para que nada
distinguisse mal "o dono pareou" de "alguém pareou". Nada disso foi apagado por
estar errado. Foi apagado por não ter mais para quem servir. Apagar sem escrever
o motivo transformaria a decisão em amnésia, e a próxima pessoa que precisasse de
login reimplementaria pior o que já existia.

---

## Por que a camada saiu, e não só ficou desligada

Ela **já era opcional**: sem `SUPABASE_URL` e `SUPABASE_ANON_KEY` o portão se
desligava e dizia isso no boot. Desligada, então, ela custava pouco — em execução.
O que ela custava era em outro lugar:

- **Duas telas servidas** (`entrar.html` 111.579 B, `integracoes.html` 205.687 B)
  que participavam do "one product, one chrome": toda mudança de topbar, de
  `.aviso`, de tema ou de modo gravação tinha que ser repetida em **seis** páginas
  em vez de quatro, e o `nav-sync-test.js` cobrava isso a cada mudança.
- **Um banco de produção com escalada aberta.** Duas das sete migrations existem
  para fechar um CRÍTICO, e elas **nunca foram aplicadas** (medido abaixo). Uma
  camada de login cuja porta está aberta no banco hospedado não é uma feature
  desligada — é uma dívida que só cresce, porque o buraco está no serviço
  hospedado e não no código que se desliga por variável de ambiente.
- **Um contrato inteiro para manter em duas leituras** (`CONTRATO-PERFIL.md`),
  que é exatamente a coisa que esta casa evita: duas leituras divergem na primeira
  correção feita de um lado só.

Manter isso ligado por hipótese ("um dia alguém pode querer") é o oposto do que
este repositório faz em todo lugar: **nada aqui é mantido por hipótese.** A tag
abaixo é o preço que se paga em vez disso — barato, e reversível a qualquer
momento.

---

## Como voltar

Todo o código continua alcançável pela tag de preservação
**`arquivo/produtizacao-20260909`**, que aponta para `d9efd67` — o commit
imediatamente anterior à remoção. Ela já foi criada e publicada.

```bash
# ver o commit inteiro daquele ponto
git show arquivo/produtizacao-20260909

# listar tudo o que existia lá
git ls-tree -r --name-only arquivo/produtizacao-20260909

# ler um arquivo sem restaurá-lo (é assim que este documento foi escrito)
git show arquivo/produtizacao-20260909:perfil.js

# restaurar UM arquivo para o disco e para o índice
git checkout arquivo/produtizacao-20260909 -- perfil.js

# restaurar a camada inteira
git checkout arquivo/produtizacao-20260909 -- entrar.html integracoes.html \
  perfil.js integracoes.js cofre.js pareamento.js \
  CONTRATO-PERFIL.md docs/ENTREGA-ANDRE.md supabase/
```

### Restaurar o arquivo NÃO restaura a fiação

Isto é a parte que morde. Os módulos foram removidos, mas o que os **chamava**
também foi: as rotas em `server.js`, os `require`, a leitura da chave a partir do
cofre em `n8n.js`, o portão de admin de `/api/pareamento`, e a porta na cápsula de
navegação das quatro páginas que sobraram. Um `git checkout` traz `perfil.js` de
volta como arquivo morto: nenhuma rota o alcança e nenhuma tela o consulta.

Restaurar de verdade é abrir `git show arquivo/produtizacao-20260909:server.js` ao
lado do `server.js` atual e trazer de volta os trechos com nome — que naquele
arquivo são blocos delimitados e comentados. **Faça isso antes de acreditar que a
camada voltou:** o sintoma de meia restauração é uma tela de login que abre e um
botão que responde 404, e isso manda quem for depurar procurar defeito no lugar
errado.

---

## AVISO DE SEGURANÇA — leia antes de restaurar qualquer coisa

Três fatos sobre `d9efd67`. Os dois primeiros são segredo em texto puro **dentro
do histórico**, e o terceiro é uma escalada de privilégio **aberta no banco
hospedado**. Restaurar sem tratar os três é reabrir tudo.

### 1. A `SUPABASE_ANON_KEY` real está em `perfil-test.js`

Medido em 09/09/2026: o valor `sb_publishable_…` na linha 73 daquele arquivo é
**byte a byte idêntico** ao `SUPABASE_ANON_KEY` do `.env` desta máquina. O
docblock do arquivo vizinho (`integracoes-test.js`) declara que a chave plantada
lá é *sintética*, e no `perfil-test.js` isso vale para o JWT — que é inventado —
e **não** vale para a chave publicável três linhas abaixo dele.

É uma chave `sb_publishable_*`, publicável por desenho: ela vai para o navegador
de qualquer jeito e não abre nada sozinha. O que ela faz é **identificar o
projeto**, e é aí que ela se junta ao item 3 — com a porta do convite aberta,
saber qual projeto é e qual e-mail usar basta.

### 2. O e-mail do dono está em texto puro na migration do bootstrap

`supabase/migrations/20260825140856_perfil_super_admin.sql`, linha 188:

```sql
values ('kauan.millarch@ecommercepuro.com.br', true)
```

Não é descuido, é como o bootstrap por convite funciona — e é também o que
estreita o ataque do item 3 a **um endereço publicado**.

### 3. As duas migrations que fecham a porta do convite NÃO estavam aplicadas

Medido em 09/09/2026 com `supabase migration list --linked` contra o projeto
hospedado. Cinco das sete aplicadas; as duas de remediação com a coluna `Remote`
vazia:

```
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260825140856 | 20260825140856 | 2026-08-25 14:08:56
   20260825141019 | 20260825141019 | 2026-08-25 14:10:19
   20260825150814 | 20260825150814 | 2026-08-25 15:08:14
   20260825173141 | 20260825173141 | 2026-08-25 17:31:41
   20260825174425 | 20260825174425 | 2026-08-25 17:44:25
   20260825190000 |                | 2026-08-25 19:00:00
   20260826120000 |                | 2026-08-26 12:00:00
```

Sem elas, `private.ao_criar_usuario` dispara em `after insert on auth.users` e
casa o convite por `new.email` **sozinho** — sem conferir `email_confirmed_at`,
sem conferir provedor, sem exigir `usado_em is null`. Com a confirmação de e-mail
desligada no projeto hospedado, o GoTrue carimba `email_confirmed_at` no próprio
`INSERT` e devolve `access_token` na mesma resposta. Ou seja:

> **Uma única requisição `POST /auth/v1/signup`** com o e-mail do item 2 e seis
> caracteres de senha nascia `status = aprovado, super_admin = true`. Painel
> inteiro, todas as organizações. Não precisa de nenhuma falha de lógica SQL.

O `config.toml` em `d9efd67` **já** traz `enable_confirmations = true` no bloco
`[auth.email]`, com o comentário explicando que a linha é carregada. Isso não
fecha o buraco hospedado: **`config.toml` governa o Supabase local, não o
hospedado.** A virada tem que ser repetida à mão no painel, em
Auth → Providers → Email.

### O que quem restaurar precisa fazer, na ordem

1. **Girar a `SUPABASE_ANON_KEY` e a chave do n8n.** Limpar o arquivo não desfaz
   o histórico: a chave continua em `d9efd67`, e o `CLAUDE.md` registra que ela
   também está em transcripts e snapshots de `file-history` do perfil. Tratar as
   duas como comprometidas é o único pressuposto defensável.
2. **Ligar a confirmação de e-mail no painel hospedado** (Auth → Providers →
   Email). É a primeira camada, e sem ela a checagem SQL do passo 3 não checa
   nada.
3. **Aplicar as duas migrations** (`supabase db push`). É escrita em banco de
   produção: precisa de autorização por ato, com o diff na frente — a regra desta
   casa. Enquanto não rodar, o CRÍTICO segue aberto.

Nada disso é ato de código, e é por isso que continua pendente: são três atos de
painel que dependem de autorização que um agente não tem.

---

## Inventário

Tamanhos em bytes, lidos de `d9efd67`. A descrição de cada um saiu do docblock do
próprio arquivo, não de memória.

### Telas servidas

| arquivo | bytes | o que fazia |
|---|---|---|
| `entrar.html` | 111.579 | A tela `/conta` · `/entrar`: entrar por Google ou por e-mail, a fila de pedidos de acesso, quem está dentro, cargos e o teto de 3 vagas. Todo o juízo sobre "pode entrar" vivia no bloco no topo dela, nunca no servidor. |
| `integracoes.html` | 205.687 | A tela `/integracoes`: colar a chave da API do n8n, ver o estado da conexão, conduzir o pareamento com um site hospedado e escolher qual IA usa. Favicon próprio e deliberadamente **sem** `aba.js` — não havia trabalho longo nesta tela, e um botão prometendo avisar sobre um build que não está aqui seria controle sem assunto. |

### Módulos

| arquivo | bytes | o que fazia |
|---|---|---|
| `perfil.js` | 24.680 | Quem é a pessoa e se ela pode entrar, como **fato**. Fluxo OAuth e OTP feito à mão contra a API REST do Supabase Auth, sem `@supabase/supabase-js` — zero dependência como o resto. O token nunca chegava ao browser: a troca acontecia no processo e o navegador recebia um cookie `HttpOnly` com um id opaco. Tinha leitor de `.env` **próprio** de propósito, porque um `require("./n8n.js")` no topo executaria `loadConfig()` só por carregar o arquivo, e um teste que apenas importasse o módulo passaria a ler a chave de produção. |
| `integracoes.js` | 19.341 | Os fatos da tela `/integracoes`: configurado, respondeu, status HTTP, quantos fluxos, achei a CLI. Somente leitura, com **injeção de dependência** (`colher({ n8n, fix })`) em vez de `require` no topo — pelo mesmo motivo acima, e para o teste exercer a lógica de verdade com falsos, sem cirurgia em `require.cache`. |
| `cofre.js` | 17.756 | O cofre da chave do n8n em `%APPDATA%\Cockpit\n8n.dat`, cifrada pelo **DPAPI do Windows**, atada à conta de Windows de quem cifrou — copiada para outra máquina, não decifra. Existia para a chave não morar em texto puro num `.env` que viaja: pasta zipada, backup na nuvem, print da tela, commit por engano. O teto estava escrito no próprio cabeçalho, porque a frase acima sugere mais proteção do que existe: DPAPI de escopo de usuário **não** protege contra outro processo rodando na mesma conta de Windows. |
| `pareamento.js` | 47.374 | A cerimônia que vinculava este agente a um site hospedado, escrevendo `.agente/pareamento.json`. Antes dela, o único jeito de parear era escrever o JSON à mão — e um arquivo escrito à mão não tem cerimônia nenhuma, então nada distinguia "o dono pareou" de "alguém pareou". Era o arquivo mais perigoso do sistema (quem escreve ali decide **qual site** pode mandar este agente escrever em fluxo de produção e disparar `POST /retry`, que manda mensagem real para um lead e não tem undo), e por isso era o mais chato. |

### Documentos

| arquivo | bytes | o que era |
|---|---|---|
| `CONTRATO-PERFIL.md` | 14.721 | A costura entre `perfil.js` (fatos) e as telas (juízo): perfil, aprovação, cargos, super admin. Abria declarando o teto — *login em `127.0.0.1:4317` é identidade, não cadeado* — porque quem tem a máquina contorna por `curl` ou pelo editor, e o próprio `guarda.decidir()` permite isso de propósito para não travar automação local. |
| `docs/ENTREGA-ANDRE.md` | 8.098 | O que faltava no login e dependia de autorização de painel: SMTP, DNS e publicar o app no Google. Nada disso era código. Carrega o Client ID do OAuth do Google. |

### Banco (`supabase/`)

| arquivo | bytes | o que fazia |
|---|---|---|
| `config.toml` | 15.619 | Configuração do stack **local** do Supabase. Governa `supabase start`, nunca o projeto hospedado — ver o item 3 do aviso. |
| `.gitignore` | 72 | Ignorava o estado por checkout do CLI (`supabase/.temp/`). |
| `20260825140856_perfil_super_admin.sql` | 8.442 | Perfil, aprovação de entrada e super admin. É a migration com o e-mail do dono em texto puro. |
| `20260825141019_perfil_funcoes_fora_da_api.sql` | 4.953 | Tirou duas funções de `public` para um schema que a API não expõe, atendendo quatro avisos que o `get_advisors` deu logo depois da migration anterior. |
| `20260825150814_cargos_e_organizacoes.sql` | 12.118 | Cargos, organizações e o teto de 3 vagas — três níveis, cada um por um motivo diferente. |
| `20260825173141_cargo_ao_aprovar.sql` | 2.872 | O teto de vagas passou a valer também quando o cargo é dado **depois**; buraco achado pelo Kauan olhando a tela. |
| `20260825174425_marcar_presenca.sql` | 3.414 | `visto_em` passou a ser escrito, e pela própria pessoa, para responder "quantos usuários estão ativos". |
| `20260825190000_fechar_a_porta_do_convite.sql` | 14.883 | **Remediação de segurança**, da auditoria adversarial sobre as cinco migrations anteriores: fecha o casamento cego do convite, a vaga queimada sem linha, o convite reexecutável, o casamento sensível a caixa, a autoria falsificável, o `with check` mais fraco que o `using` e o `execute to public` que o Postgres dá de graça a toda função nova. **Não aplicada.** |
| `20260826120000_o_convite_vale_no_clique_do_link.sql` | 12.251 | Corrige uma regressão que a anterior introduzia, encontrada antes de ela ser aplicada em lugar nenhum. **Não aplicada.** |

---

## Rotas que deixaram de existir

Páginas:

| rota | servia |
|---|---|
| `/conta` · `/entrar` | `entrar.html` |
| `/integracoes` | `integracoes.html` |

API — 21 manipuladores, lidos de `d9efd67:server.js`:

| prefixo | rotas |
|---|---|
| `/api/perfil/` | `eu` (GET), `entrar/google` (POST), `entrar/email` (POST), `callback` (GET), `sair` (POST), `equipe` (GET), `equipe/convidar` (POST), `organizacoes` (GET e POST), `pedidos` (GET), `decidir` (POST), `convite` (POST) |
| `/api/cofre` | escrevia a chave do n8n no cofre DPAPI. Exigia admin. |
| `/api/integracoes` | os fatos da tela de integrações. Exigia admin. |
| `/api/pareamento` | GET (estado), DELETE (desparear), `iniciar` (POST), `confirmar` (POST), `cancelar` (POST) — todas atrás do portão de admin acrescentado na varredura de 25/08, que é o degrau que faltava: a tela já exigia admin, o motor dela não. |

Sobraram as quatro portas do cockpit: `/` (Fluxos), `/disco`, `/tester` e
`/upgrade`.

---

## As sete baterias de teste

Todas gratuitas — sem modelo, sem rede, sem servidor. Uma linha por arquivo: o
que ele **provava**, não o que ele exercitava.

| arquivo | bytes | o que provava |
|---|---|---|
| `perfil-test.js` | 27.089 | Que **nenhum token atravessa** para o browser — aferido contra um JWT de formato real plantado onde uma mensagem de erro do Supabase chegaria, e sobre a fonte da rota `/api/perfil/eu`; que campo ausente não cai no ramo negativo (aqui o defeito seria a tela de login piscando em toda abertura para quem já está logado); que as frases de estado são todas distintas, porque "esperando" lido como "recusado" deixa a pessoa esperando para sempre; e que o plural é escrito por extenso, porque a primeira medição desta tela saiu com "2 nunca foi vista" e "2 operador". |
| `integracoes-test.js` | 35.354 | 47 casos, e o que carrega o arquivo é uma **ausência**: `integracoes.js` não tem `getRawWorkflow`, não tem rota nova para o n8n e não tem caminho de escrita — aferido sobre a fonte **sem comentário**, em vez de confiar na frase do cabeçalho. Mais a chave plantada ser sintética, porque o arquivo vai para o git. |
| `cofre-test.js` | 22.019 | 24 casos sobre o DPAPI **de verdade** (um dublê provaria o dublê, então roda só no Windows e diz isso em vez de fingir que passou): a chave nunca aparece em texto — nem no arquivo, nem em mensagem de erro, nem em argumento de processo, aferido contra um valor com cara de chave real e não contra "abc" — e arquivo corrompido **lança** enquanto ausência devolve `null`, porque "não tem chave guardada" convida a colar uma e "tem um cofre aqui e ele não abre" é outro problema e outra frase. Salvava e devolvia o arquivo real do Kauan byte a byte. |
| `cofre-n8n-test.js` | 26.482 | 39 casos sobre a **precedência** entre cofre, `.env` e ambiente, o cache e os três estados. Cada bloco montava a própria pasta com uma cópia de `n8n.js` conferida byte a byte, porque `loadConfig()` lê o `.env` do diretório e **vence** `process.env` — a armadilha que já custou um `PUT` real contra a instância no `mutex-test.js`. E instrumentava e **contava** o `fetch` no fim: confiar em "não deve sair requisição" é o que faz um teste ficar verde falando com produção. |
| `cofre-tela-test.js` | 13.192 | A **fiação**, que era o que não existia: medido por grep em 25/08/2026, havia zero chamadas a `cofre.guardar` fora dos testes do próprio cofre. Provava que a chave nunca volta — nem truncada, porque um prefixo publicado deixa conferir um palpite e o painel vira oráculo de credencial; que `revogacaoManual` tem consumidor de verdade, transformando uma obrigação de prosa em campo aferível; e que `abriu === false` não é lido como "não tem chave", porque as duas frases mandam para lugares diferentes. |
| `pareamento-test.js` | 46.720 | A cerimônia, com todo teto (prazo, tentativa) exercido contra um **relógio injetado** — a lição do `mutex-test.js`: um teto que não corta não falha, ele *para*, e teste pendurado lê como "rodando". Dois casos eram integração real e carregavam o arquivo: o que foi gravado é lido de volta pelo `guarda.lerPareamento()` **real**, e o `agenteId` é rederivado da chave pública do próprio arquivo. O `.agente/` do repositório não era tocado em caso nenhum — trocar o pareamento vivo por um de mentira teria como única pista o painel parar de funcionar. |
| `pareamento-tela-test.js` | 59.292 | A tela do pareamento e da escolha de IA, com o bloco de juízo e as funções de desenho **extraídos da página em tempo de execução** — e a extração **lançando** quando não acha a âncora, porque uma fatia vazia devolvida em silêncio faria o arquivo inteiro passar sobre string vazia. Provava que `nao-pareado` e `ilegivel` têm frases distintas (as duas são "não está funcionando" e mandam para lugares opostos: uma manda parear, a outra manda **desparear antes** de parear) e que `idConfere` tem três saídas, com `null` nunca caindo em `false`. |

---

## O que ficou de fora da remoção, e por que

### `guarda.js` (26.019 B) e `guarda-test.js` (36.809 B) ficam

**`guarda.js` não é login.** É a porta que classifica toda requisição HTTP —
origem, preflight, CORS — e é o que protege
`POST /api/claude/run/:id/approve`, que escreve em fluxo de produção, e
`POST /api/claude/run/:id/retry`, que manda mensagem real para um lead e não tem
desfazer, de requisição cross-site. Remover junto seria confundir *quem é a
pessoa* com *de onde veio o clique*, e trocaria a proteção de CSRF do caminho mais
perigoso do repositório pela limpeza de uma camada que não tem nada a ver com ela.

Ele sobrevive sozinho por construção, e isso é medido, não esperado:

- requer só builtins — `crypto`, `fs`, `path`;
- lê `.agente/pareamento.json` por `lerPareamento()`, **dentro de um `try/catch`
  que devolve `null`**. Sem o arquivo — que ninguém mais escreve, porque
  `pareamento.js` saiu — a lista de origens permitidas fica vazia e só cliente
  local entra, que é exatamente o desejado num painel de `127.0.0.1`.

O `server.js` atual documenta isso no topo, ao lado do `require`. O nome
`pareamento` que aparece na linha do classificador é uma **variável local** com o
resultado dessa leitura, não o módulo removido — vale saber antes de sair
caçando um `require` fantasma.

### `docs/seguranca/` continua no disco e fora do git

Não é parte desta remoção, mas é vizinha dela e vale dizer para ninguém procurar:
são oito relatórios da varredura de 24–25/08 com achados **não corrigidos** sobre
o código que descrevem, mais o `ref` do projeto Supabase e os passos de
exploração. Publicar o mapa ao lado da fechadura é exposição maior do que as
linhas que ele descreve, então o diretório é gitignorado. Ele fica no disco, que é
onde serve.
