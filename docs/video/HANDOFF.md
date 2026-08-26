# Handoff — vídeo tutorial do Cockpit + onboarding de credenciais

**Cole isto numa sessão nova.** Escrito em 2026-08-26 com 72% de contexto usado, na sessão que fez a
auditoria de segurança, corrigiu o tema da aba Conta, e produziu o roteiro e a narração do vídeo.

---

## Onde parei, em uma frase

O roteiro do tour está fechado e **os 53 áudios estão gerados**. O que falta é **gravar as 53 cenas**
com Playwright contra os fixtures, e montar com ffmpeg. Nada foi gravado ainda.

---

## Leia estes quatro arquivos primeiro — eles são a autoridade, não este handoff

| arquivo | é a autoridade sobre |
|---|---|
| `.video/voz.js` | voz, tom, pronúncia e a régua de fala. Cada número tem o motivo escrito, incluindo dois defeitos meus que ele corrige |
| `docs/video/01-roteiro-tour.md` | as 53 cenas: tela, ação, fala, duração. Toda duração é **derivada**, nunca digitada |
| `docs/video/contar.js` | recalcula a coluna `≈s`, as janelas de tempo dos atos e o bloco "Contas". Rode depois de qualquer edição no roteiro |
| `.video/fixtures.js` + `.video/gravar-lib.js` | os dados falsos e o interceptador do Playwright. **Produzidos por um subagente que nunca me reportou — verifique antes de confiar** |

`docs/video/gerar-audio.js` gera a narração e é **retomável**: arquivo que existe é pulado.

---

## Decisões do Kauan, já tomadas — não reabra

**A primeira tela de quem entra pela primeira vez é a de credenciais**, e "primeira entrada" é
**derivada do estado das conexões**, nunca de cargo nem de coluna no banco. Isso é o que o
`.design/login/BRIEF.md §8` já dizia ("quem já conectou volta direto ao painel"). Consequência boa:
numa máquina que o admin já configurou o n8n está `ok`, então não é primeira entrada — o operador vai
direto ao painel e não há chave para sobrescrever. Borda combinada: operador em máquina sem nada
conectado vê o que falta e a instrução de chamar o admin, **não** um campo que o `POST /api/cofre`
(restrito a admin) vai recusar.

**A gravação é com fixture, não ao vivo.** Medido em 26/08: a instância tem 776 execuções e **zero
erros**, então a cena da correção pelo Claude — a mais importante — não tem botão para clicar ao vivo.
Além disso três cliques escrevem no n8n por padrão e um deles gasta cota sozinho minutos depois.

**Voz `kPzsL2i3teMYv0FxEYQ6`, style 0.55, stability 0.40.** Escolhida ouvindo, contra outra voz e
contra style 0.35/0.75. Pronúncia: `Supabase` → `supabeise`, `Claude` → `cláude`, confirmadas por ele
de ouvido. Todo o resto do vocabulário técnico foi ouvido e sai certo — não acrescente troca "por
segurança".

**Duração: ele pediu 5:30 e disse que quer assistir antes de cortar.** A narração medida é **346s
(5:46) de fala pura**, então 5:30 é impossível sem cortar ~60s. Confortável fica em 7:00–7:30 (82% e
77% de densidade). **Ele ainda não decidiu isso** — mostre o vídeo montado e deixe ele cortar. Se
mandar cortar, os atos 6, 9 e 11 têm 8, 9 e 8 falas e aguentam 5, 6 e 6 sem perder cena.

---

## O que já está pronto

- **53 MP3** em `.video/audio/falas/`, nomeados `ato-cena.mp3` (ex. `06-6.5.mp3`). 5,5MB, 4.769
  caracteres de cota gastos.
- **Gravação de footage provada:** Playwright 1.62.1 em `.claude/skills/playwright/node_modules`,
  gravou 1920×1080 do cockpit real com zero erro de página.
- **ffmpeg 8.1** existe e funciona (via WinGet, não está no PATH como link — use `ffmpeg` direto, que
  resolveu).
- **`.video/` é gitignorado**; `docs/video/` é versionado. Binário grande fora do git, roteiro dentro.

## O próximo passo, concreto

1. **Verifique os fixtures.** O subagente escreveu `fixtures.js` (88KB) e `gravar-lib.js` (20KB) e
   nunca reportou. Antes de gravar, cheque que `interceptar()` **falha alto** em qualquer `/api/**`
   não mapeado (responder 500 nomeando o path). Fallthrough silencioso para o servidor real põe dado
   de cliente na gravação — é o único defeito inaceitável aqui.
2. **O login barra o Playwright.** Contexto limpo leva 302 para `/conta?volta=/`. Peça ao Kauan para
   subir o cockpit com `COCKPIT_LOGIN=0`, ou confirme se a interceptação sozinha resolve.
3. **Grave cena por cena**, seguindo a coluna `ação` do roteiro. Depois monte casando `NN-N.N.mp3`
   com o plano de mesmo id.

---

## A ordem: ÁUDIO É O MESTRE, imagem se corta nele

Pergunta do Kauan em 26/08, e ela protege o problema certo pela alavanca errada. O medo é a voz
dizer uma coisa e a tela mostrar outra. A resposta:

**Áudio primeiro, e o motivo é assimetria de elasticidade.** A duração de uma fala é fixa e já
medida. A duração de um plano é elástica — segura o quadro, arrasta o scroll, alonga o zoom. Cortar
imagem para o som funciona; o contrário obrigaria a reescrever a narração para caber em durações, e
narração escrita para bater segundo perde a pausa onde ela importava.

**O que impede o descasamento são três coisas, e não a ordem:**

1. **O id compartilhado.** A cena 6.5 tem fala em `06-6.5.mp3` e o clipe deve ser `06-6.5.webm`.
   Mesmo id, mesma linha do roteiro, nenhuma tabela intermediária para dessincronizar. Foi por isso
   que os MP3 receberam o id da cena em vez de `fala-01`.
2. **A linha do roteiro.** As colunas `ação` e `fala` estão na MESMA linha. Gravar a cena 6.5 é
   executar a ação daquela linha — não há como cruzar a ação de uma com a fala de outra.
3. **O plano é preenchido até a duração MEDIDA do áudio**, nunca até um número escolhido. Fala de
   10,5s, plano de 10,5s, por construção.

### O risco de verdade, e a guarda que você precisa escrever

Não é ordem de produção. É a narração descrever algo que **o fixture não mostra** — a voz diz "olha
o chip do sub-fluxo" e o fixture não gerou aquela assinatura. Aí o clipe sai bonito e errado, e
nenhuma ordem protege disso.

**Antes de gravar cada cena, afira que o elemento que a narração cita está na tela.** Se a cena 5.4
fala do chip `⤷`, o seletor dele tem de existir naquele instante; se não existir, **pare com o nome
da cena** em vez de gravar. Um clipe errado é pior que gravação interrompida, porque ele só é
descoberto na montagem — ou pior, depois de publicado.

Sugestão de forma: uma coluna `seletor` no roteiro, ou um mapa `cena -> seletor` ao lado do
`gravar-lib.js`. Só as cenas que citam um elemento específico precisam de entrada; as que dizem
"segurar" não citam nada e não têm o que aferir.

## Armadilhas de gravação — todas medidas, nenhuma suposta

1. **As animações de entrada disparam UMA vez.** `seenCardIds`, `seenErrKeys`, `S.fantasmaVisto`,
   `S.desenhado`, `S.batAssin`, o contador que sobe. Refazer uma tomada sem **recarga forte** dá tela
   paralisada.
2. **A lente da navegação só viaja entre portas diferentes** (`sessionStorage`). F5 na mesma porta não
   anima nada. Os atos 8, 9 e 11 dependem de navegar.
3. **SSE repinta colunas inteiras várias vezes por segundo.** Para qualquer plano que precise ficar
   parado, use `?static=1`.
4. **O compositor do Upgrade nasce travado em 72 dos 75 fluxos** — sem dossiê não há campo para
   digitar. O fixture do ato 11 **precisa** de um dossiê verde, senão a cena 11.5 não existe.
5. **Barra sem histórico é listrada, não percentual.** A do dossiê incremental tem **zero** amostras
   medidas — nunca mostre número nela.
6. **`prefers-reduced-motion` mata metade da camada de movimento.** Confira na máquina de gravação.
7. **A régua erra até 1,2s em 9 das 53 falas**, sempre para mais. Corte contra o MP3 medido, nunca
   contra a estimativa.

## O que NUNCA pode entrar em quadro com clique

- `✓ Aprovar e aplicar` (fluxos) e `✓ aplicar` (upgrade) — escrevem em fluxo de produção.
- `▷ Reexecutar a execução` — manda mensagem real para lead real, **sem desfazer**.
- Ao vivo, `✓ é isso` no Upgrade escreve uma cópia inativa **antes** de qualquer aprovação, e aplicar
  dispara escrita de dossiê paga sozinha minutos depois. Com fixture nada disso acontece.

---

## Pendências que são do Kauan, não nossas

**Rotacionar duas chaves.** A `service_role` do Supabase e a do n8n estavam em texto puro em 77
arquivos de `~/.claude/`. Limpei os arquivos ativos (257 regras de `permissions.allow` → 0, mais o
`CLAUDE.md` global), **mas limpar não desfaz**: 40 transcripts e 28 snapshots de `file-history` ainda
têm o valor, a do Supabase vale até 2036 e a do n8n **não tem `exp`**. Apagar também
`~/.claude/*.bak-seg-20260825-162052`, que são cópias novas do segredo criadas por mim.

**`supabase db push`.** Duas migrations novas e não aplicadas:
`20260825190000_fechar_a_porta_do_convite.sql` (fecha o CRÍTICO: qualquer um virava super admin
sabendo um e-mail) e `20260826120000_o_convite_vale_no_clique_do_link.sql` (corrige uma regressão da
primeira — o convite era avaliado no pedido do link, não no clique). Enquanto não rodarem, o CRÍTICO
segue aberto no banco hospedado. E `enable_confirmations` precisa ser ligado **no painel** (Auth →
Providers → Email): o `config.toml` governa só o Supabase local.

**A chave do ElevenLabs não tem `user_read`.** Não há como consultar saldo de cota — o primeiro sinal
de esgotamento é um HTTP de erro numa fala. Se ele criar uma chave com essa permissão, dá para avisar
antes.

---

## Achados que eu não consertei, com o motivo

- **`bateria.js:546` emite uma linha `8 Destino de rede`** que nenhum vocabulário de tela nomeia
  (`TODAS_LINHAS`, `ORDEM_LINHA`, `VER_ETAPAS` não a têm) — renderiza com nome vazio e ordena em 99.
  Inferência de fonte; não foi vista na tela, porque ver exigiria rodar uma rodada de patch, que
  escreve no n8n.
- **`upgrade.html` tem blocos `.dnode` e `@media (max-width:900px)` duplicados**, o segundo vencendo
  por cascata. Colapsar tem risco real de layout; ficou de fora.
- **O `?volta=` está morto.** O portão o define (`server.js:1254`), o callback o descarta
  (redireciona para `/entrar?ok=1` fixo, `:1473`) e quem o lê nunca roda (`entrar.html:1023`). Então
  **todo login novo cai na tela de conta**. O mecanismo do conserto já existe e é jogado fora:
  `trocarCodigo` devolve `destino` (`perfil.js:245`) e a rota ignora. **Isso é pré-requisito do
  onboarding** — é o que faz um `?ir=integracoes` sobreviver ao login.
- **`entrar.html:1349` mente para quem está na fila:** diz *"esta tela muda sozinha — não precisa
  entrar de novo"* e não há poll nem SSE. `:1350` é código morto (`p.querySelectorAll && null;`).
- **A fila de aprovação mistura duas coisas:** o magic link cria a linha no **pedido** do link, não no
  clique, então digitar qualquer endereço cria um `pendente`. Nada na tela diz quem confirmou o e-mail.
- **`/integracoes` não tem link para `Settings → n8n API`, nem valida a chave.** A tela diz
  literalmente *"O cockpit não valida a chave"*, e depois de salvar recarrega **sem forçar** — o cache
  de 30s é chaveado pelo host, que não muda quando a chave muda, então pode mostrar `CONECTADA`
  medido com a chave antiga. `GET /workflows?limit=1` devolve 200 e é a validação que falta (medido).
- **`avisoFormaChave` é código morto:** lê `n8n.cofre`, que `/api/integracoes` nunca emite. Não
  roteirize essa notificação — ela não pode aparecer.

---

## Fatos medidos que valem mais que opinião

- **MCP do n8n consegue** criar e modificar workflow (`update_workflow` com `addNode`,
  `updateNodeParameters`, `addConnection`…) e **tem OAuth de verdade**. Mas um fluxo só entra no MCP
  se estiver publicado e tiver gatilho de webhook/formulário/agenda/chat — **um sub-fluxo nunca pode**,
  e corrigir o filho é o caminho mais valioso do cockpit. Então: **login-based e capaz de corrigir
  sub-fluxo são excludentes.** A API fica. O MCP soma depois, para `execute_workflow`/`test_workflow`,
  que a API não tem.
- **`GET /credentials` devolve 405 nesta conta.** A documentação diz que passou a existir; medi na
  instância e não existe. Não atualize o `CLAUDE.md` por causa disso.
- **O Claude Code não precisa de chave de API** — usa OAuth de assinatura, e os quatro spawn sites do
  cockpit usam o modo `plano`. O galho de `chave` existe no código e nenhum chamador o alcança.
- **Segurança do repositório:** 369 blobs de toda a história varridos em 15 classes de segredo.
  **Nenhuma credencial em nenhum commit, nunca** — o `.env` jamais entrou. O dado de lead que estava
  na história foi redigido e a história foi reescrita desde a raiz (`git filter-repo`), com force-push
  nas duas branches. Backup completo em
  `%TEMP%\cockpit-antes-reescrita-20260825.bundle` — **ele contém a história NÃO redigida**, apague
  quando não precisar.

## Regras da casa que eu quebrei e você não deve

1. **Número derivado, nunca digitado.** Digitei a coluna de duração do roteiro à mão e errei 31%. Pior:
   o mesmo defeito apareceu em dois lugares do mesmo arquivo. Se um artefato vai ser editado dez vezes,
   qualquer número dentro dele precisa sair de uma função.
2. **Duas amostras não são uma medição.** Fixei a régua em 14,8 car/s com duas amostras; com 53 a taxa
   real é 13,8, e o erro foi sempre para o mesmo lado.
3. **Comentário que promete proteção inexistente é pior que comentário nenhum.** Escrevi que `\b`
   protegia nome de arquivo na troca fonética. Não protege — `-` e `.` são borda de palavra.
4. **Teste que afere que a chave é LIDA não afere que ela é APLICADA.** Meu primeiro teste do tema
   passava com o `setAttribute` apagado. Ler e aplicar são dois fatos e precisam de dois casos.
