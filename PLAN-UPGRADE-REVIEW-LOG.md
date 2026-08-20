# Plan Review Log: aba Upgrade

Act 1 (grill) complete — plan locked with Kauan on 2026-08-13.
`PLAN_FILE=PLAN-UPGRADE.md`, `LOG_FILE=PLAN-UPGRADE-REVIEW-LOG.md`, `MAX_ROUNDS=5`.

Nomes distintos de propósito: `PLAN.md` e `PLAN-REVIEW-LOG.md` já pertencem ao Tester e não podem
ser sobrescritos.

## Decisões que o grill resolveu, e o que foi medido para resolvê-las

| Ponto | Decisão | Evidência |
|---|---|---|
| Alvo da escrita | fluxo vivo, direto | escolha de Kauan contra a recomendação de cópia `[UPGRADE]` |
| "Testes internos" | não existem; bateria de 7 checagens no lugar | API pública sem endpoint de execução; `n8n execute` lê o banco da instância |
| Todos verdes? | toda checagem **aplicável** verde | 46/73 fluxos (63%) o fantasma recusa; 29/32 (91%) entre os de 10+ nós |
| Estados de cor | 5 (cinza, indigo, verde, laranja, vermelho) | laranja reservado para "passou com ressalva"; movimento é `--accent` |
| Entrada da ideia | conversa, com direito de perguntar de volta | contrato `resposta`/`patch` do modo `edicao` já existe |
| Achar onde plugar | duas etapas, índice antes do documento | 13KB contra 285KB, 22× |
| Vitrine | ideia C, forma real do fluxo | escolhida por Kauan em PNG entre 4 opções |
| Dossiê | cache por nó, semáforo por divergência | Iago e eContrate editados no mesmo dia da medição |
| Custo no cartão | faixa, não dólar | consumo é cota de plano, não cobrança |

## Round 1 — Codex (`gpt-5.4`, effort high)

**Achados**

- [PLAN-UPGRADE.md:200](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L200), [PLAN-UPGRADE.md:300](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L300): o 5a pode dar verde falso com facilidade, porque “todos os erros + 5 sucessos recentes” não cobre ramos raros, e o próprio plano aceita ficar verde mesmo quando o patch toca nós fora da amostra. Fix: se qualquer nó/aresta tocado não aparecer na amostra, 5a não pode ficar verde; tem de virar cinza ou exigir expansão automática da amostra.

- [PLAN-UPGRADE.md:70](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L70), [PLAN-UPGRADE.md:87](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L87): invalidar o dossiê só por hash do JSON do nó falha em mudanças só de conexão, porta, ramo, ordem/topologia e `settings`; nesses casos o texto fica semanticamente falso e ainda pode continuar verde. Fix: o fingerprint de cada parágrafo tem de incluir assinatura de adjacência/portas do nó e um hash global dos `settings`/contexto do workflow.

- [PLAN-UPGRADE.md:217](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L217), [n8n.js:875](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L875), [claude-fix.js:1323](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L1323): escrever em workflow vivo com gates só estruturais continua permitindo erro semântico grave em produção, e ainda permite mutação colateral escondida via `pickSettings()` descartando chaves no `PUT`. Fix: bloqueie apply quando houver `settings` descartado e exija sandbox inativo obrigatório ou revisão humana extra para mudanças em caminhos trafegados.

- [PLAN-UPGRADE.md:231](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L231), [claude-fix.js:965](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L965), [tester.js:2512](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/tester.js#L2512), [server.js:882](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/server.js#L882): a “trava compartilhada” prometida não existe hoje; `claude-fix` só serializa corridas dele e o Tester só serializa sessões dele, mas não há mutex único envolvendo todos os `PUT/POST` no n8n. Fix: mova a trava para um mutex process-wide no caminho de escrita de [n8n.js](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js).

- [PLAN-UPGRADE.md:165](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L165), [catalog.js:267](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/catalog.js#L267), [catalog.js:359](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/catalog.js#L359), [tester.js:1382](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/tester.js#L1382): o check 4 superestima o que sabe; `credenciaisConhecidas` é só o subconjunto referenciado por fluxos existentes, e `ligacaoCredenciais()` só escolhe candidatos por tipo/uso, sem provar que a credencial existe na conta inteira, está autorizada ou é a conta certa. Fix: rebaixe esse gate para “credencial referenciável pelos fluxos atuais”, com estado cinza/seleção humana quando a evidência do catálogo for incompleta.

- [PLAN-UPGRADE.md:236](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L236), [claude-fix.js:391](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L391), [claude-fix.js:953](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L953): a justificativa para criar `upgrades.json` está errada; `estimate()` não depende da assinatura `wfId|nó|tipo`, ele só lê tempos de corrida, então separar ledger aqui fragmenta histórico/ETA sem necessidade. Fix: reutilize `proposals.json` com um campo `kind`, ou mude `estimate()` para ler ambos antes de separar arquivos.

- [PLAN-UPGRADE.md:217](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L217), [claude-fix.js:817](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L817), [claude-fix.js:1297](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L1297): “reusa `approve` inteiro” não bate com o código real, porque `approve()` depende de `runId`, `patch.json` em `.claude-runs/<run>`, `capturedUpdatedAt`, snapshot/store de `claude-fix` e do ciclo de vida de proposta pronta. Fix: extraia um primitivo compartilhado de escrita/aprovação e faça o upgrade montar sua própria máquina de estado em cima dele.

- [PLAN-UPGRADE.md:149](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L149), [claude-fix.js:129](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L129), [claude-fix.js:225](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L225), [tester.js:2205](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/tester.js#L2205): o plano trata `[PREENCHER]` como se já fosse barrado pelo caminho atual, mas nem `validate()` nem `applyPatch()` rejeitam placeholders em parâmetros alterados. Fix: adicione um gate explícito que varra parâmetros tocados e reprove qualquer marcador `[PREENCHER]`.

- [PLAN-UPGRADE.md:317](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L317), [claude-fix.js:1095](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L1095), [n8n.js:653](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L653): subfluxo ficou como “aberto”, mas aqui isso não é detalhe de UX; é seleção de alvo, e um upgrade pode perfeitamente remendar o pai errado sem nunca tocar o filho real. Fix: torne obrigatória uma etapa de resolução de alvo pai/filho antes de gerar patch, recusando continuar enquanto o workflow correto não estiver explicitado.

- [PLAN-UPGRADE.md:197](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L197), [n8n.js:383](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L383): o critério “mesma aresta alimentadora (`task.source[0]`, primeiro não-nulo)” é estreito demais para ser vendido como proteção principal, porque preserva feeder edge e ainda deixa passar regressão dentro do caminho, inserção de nó no meio e troca de semântica no mesmo `type`/`typeVersion`. Fix: descreva 5a como continuidade estrutural mínima e nunca como proteção principal; ele precisa ser combinado com um bloqueio explícito para edits internos em caminho trafegado sem prova adicional.

- [PLAN-UPGRADE.md:66](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L66), [tester.js:2883](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/tester.js#L2883): o plano pressupõe `rodarAvulso` como padrão pronto para dossiê “sem ledger de custo”, mas isso piora observabilidade justamente na parte que você está introduzindo como custo recorrente novo. Fix: meça e grave custo/tempo do dossiê em ledger próprio ou no ledger unificado, mesmo se a UI não usar SSE.

VERDICT: REVISE
### Claude's response — Round 1

**Verifiquei no código os dois achados que acusavam erro de leitura meu. Codex está certo nos dois:**
`estimate()` (claude-fix.js:953) só lê `startedAt`/`finishedAt` e nunca toca a assinatura — minha
justificativa para `upgrades.json` era falsa. E `approve()` (claude-fix.js:1297) depende de
`runs.get(runId)`, `status === "ready"`, `run.capturedUpdatedAt`, `buildProposal(run, current)` e
`backupPath(run)` — "reusa inteiro" era falso.

**Aceitos, com o plano alterado:**

| # | Achado | O que mudou |
|---|---|---|
| 1 | 5a dá verde falso fora da amostra | §5.5: alvo ausente da amostra → expansão automática até 20 execuções; se ainda ausente, **cinza, nunca verde** |
| 2 | hash por nó não pega topologia | §2.4.1: impressão = nó + **assinatura de adjacência com porta e ramo** + hash global de `connections`/`settings`; divergência global invalida o dossiê inteiro (vermelho) |
| 4 | trava compartilhada não existe | §6.5: mutex process-wide em `putWorkflow`/`createWorkflow`, **reentrante por dono** (senão a checagem 7 trava contra o próprio approve), com teste; `retryExecution` fora |
| 5 | check 4 superestima o que sabe | §5.7: rebaixado a "credencial referenciável pelos fluxos atuais", três estados, dois candidatos é **cinza com desempate** |
| 6 | justificativa do ledger errada | §7.1: linha única em `proposals.json` com `kind`, **e `estimate(kind)` filtrando** — sem o filtro, juntar troca um defeito por outro |
| 7 | "reusa approve inteiro" é falso | §6.1: extrai `escreverAprovado()`; `claude-fix.js` passa a chamar o mesmo primitivo — duas cópias do único caminho de escrita em produção é inaceitável |
| 8 | `[PREENCHER]` não é barrado hoje | §4.3: `portaPreencher()` é **portão novo**, varre só parâmetros tocados |
| 9 | sub-fluxo é seleção de alvo, não UX | §4.5: resolução pai/filho **obrigatória antes do patch**; ambíguo **recusa** (sem assinatura de erro não há `lastNodeExecuted` para desempatar) |
| 10 | 5a vendido como proteção principal | §5.4: rebaixado a "continuidade estrutural mínima", com o que ele não pega escrito na tela |
| 11 | dossiê sem ledger piora observabilidade | §2.3.1: custo medido e gravado como `kind: "dossie"` |

**Aceito em parte, e a parte recusada está registrada — achado 3.**
Aceito: chave de `settings` descartada por `pickSettings()` é mutação colateral silenciosa, e agora
aparece **no diff como remoção explícita** (§5.9). Aceito também endurecer o sandbox: a checagem 7
passa a ser **ligada por padrão** nesta aba, ao contrário do caminho de correção, pela assimetria dos
alvos (§5.8).
**Recusado:** bloquear o apply quando houver `settings` descartado. `timeSavedMode` está presente em
**5 dos 10 fluxos ativos** (medição já registrada no `CLAUDE.md`), então bloquear tornaria a aba
inaplicável em metade deles. O defeito nunca foi a perda da chave — é ela ser silenciosa; mostrar no
diff ataca a causa, bloquear troca um defeito de honestidade por um de cobertura.

**Risco irredutível promovido ao topo da lista (§1 de Risks):** um upgrade semanticamente errado passa
por todas as sete checagens. Não há portão estrutural que pegue nem endpoint de execução que prove.
Contra esse caso sobra o diff e o clique — decisão consciente de Kauan em `[01]`, contra a recomendação
de promover a partir de cópia.

**Ordem de construção que virou obrigatória:** extrair `escreverAprovado()` e o mutex **primeiro**,
provar que a correção e o Tester seguem passando, e só então construir a aba.

## Round 2 — Codex

Dos 11 achados anteriores, a maior parte foi tratada de forma material: 5a agora fecha o verde falso por amostra, o dossiê ganhou fingerprint topológico, `[PREENCHER]` virou portão novo, `approve()` deixou de ser “reuso inteiro”, o ledger foi unificado com `kind`, e a trava compartilhada foi promovida a mutex process-wide no plano. Ainda restam problemas materiais, e há alguns novos.

- [PLAN-UPGRADE.md:286](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L286), [n8n.js:875](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L875), [n8n.js:865](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L865): eu discordo da recusa do bloqueio por `pickSettings()` descartado; a “medição” registrada prova só prevalência (`timeSavedMode` em 5/10 fluxos ativos), não prova inocuidade, e em um `PUT` que substitui `settings` inteiro prevalência alta aumenta o raio de explosão, não reduz o risco. Fix: `droppedSettings` precisa bloquear o apply em fluxo vivo, ou no mínimo exigir uma confirmação destrutiva separada e explícita fora do botão principal.

- [PLAN-UPGRADE.md:267](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L267), [PLAN-UPGRADE.md:273](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L273), [tester.js:1382](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/tester.js#L1382), [claude-fix.js:251](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L251): a linha 4 ainda está incoerente para nó novo que exige credencial, porque `ligacaoCredenciais()` só relata candidatos e o caminho de upgrade não tem nenhum mecanismo equivalente ao `escolherCredencial` do Tester para anexar credencial em produção, enquanto `applyPatch()` proíbe `credentials`; com cinza não bloqueando, isso ainda permite aplicar fluxo vivo que vai falhar na primeira execução. Fix: qualquer dependência de credencial introduzida por nó novo tem de ser vermelha por padrão, salvo se o plano explicitamente colocar o nó fora de tráfego.

- [PLAN-UPGRADE.md:183](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L183), [n8n.js:640](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L640), [n8n.js:667](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/n8n.js#L667): a resolução obrigatória pai/filho melhorou o plano, mas ele ainda trata `locateNode`/`callers` como se fossem exaustivos, e não são: `locateNode` só faz um salto e para em `SUBFLOW_SCAN_CAP = 6`, então pode dar “não achei” ou “local” em árvore maior sem evidência suficiente. Fix: qualquer cap/falha/incompletude em resolução de subfluxo tem de cair para seleção manual bloqueante, nunca para decisão automática.

- [PLAN-UPGRADE.md:344](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L344), [claude-fix.js:401](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L401), [claude-fix.js:403](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L403), [claude-fix.js:1250](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/claude-fix.js#L1250): unificar `dossie` em `proposals.json` com `kind` resolveu o erro conceitual do ledger, mas o plano só fala em filtrar `estimate()`; não fala do `STORE_CAP = 60`, nem de `rehydrate()`, nem de outros consumidores do store, então regenerações de dossiê podem expulsar histórico/propostas reais ou poluir reidratação se o filtro por `kind` não for total. Fix: todo consumidor de `proposals.json` tem de filtrar por `kind`, e `dossie` não pode contar no mesmo cap das propostas aplicáveis/reidratáveis.

- [PLAN-UPGRADE.md:369](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L369), [PLAN-UPGRADE.md:371](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L371), [PLAN-UPGRADE.md:327](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L327): os testes listados ainda não cobrem três pontos que viraram críticos nesta revisão: reentrância do mutex no approve com sandbox 7 ligado, filtragem por `kind` em `proposals.json`, e comportamento de nó novo com credencial necessária. Fix: adicione testes explícitos para esses três casos antes de considerar a implementação segura.

- [CLAUDE.md:2071](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/CLAUDE.md#L2071), [PLAN-UPGRADE.md:299](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit Projetos/PLAN-UPGRADE.md#L299): o plano agora pressupõe uma segunda máquina de escrita em produção além de `POST /api/claude/run/:id/approve`, mas não registra a atualização correspondente do invariante duro em `CLAUDE.md`; isso deixa o documento de fronteira mentindo sobre onde o cockpit pode escrever. Fix: inclua atualização explícita de `CLAUDE.md` como parte do plano, antes do código.

VERDICT: REVISE
### Claude's response — Round 2

**Aceitei os seis, e num deles revertendo minha própria recusa da rodada 1.**

| # | Achado | O que mudou |
|---|---|---|
| 3 | recusa do bloqueio por `settings` descartado | **Revertida.** O contra-argumento é certo: prevalência prova prevalência, não inocuidade, e meu argumento era sobre cobertura, não segurança. §5.9.1: chave descartada é **classificada** — lista de conhecido-inócuo com exatamente **um** membro medido (`timeSavedMode`, métrica de painel); **qualquer outra bloqueia**; e mesmo a inócua exige `confirmar()` com `perigo: true`, separado do botão principal. Entrar na lista exige **medir o que a chave faz**, nunca observar que ela é comum |
| 5 | linha 4 incoerente para nó novo | §5.7.1: nó novo que exige credencial é **vermelho**; única saída é `✓ Aplicar com o nó novo desligado` (`disabled: true` **sem** `rewire`). `applyPatch()` proíbe `credentials` e essa proibição **não** será afrouxada. É o "aplicar desligado" de `[02]` voltando restringido ao único caso em que é a resposta certa |
| 7 | `locateNode`/`callers` tratados como exaustivos | §4.5.1: um salto, `SUBFLOW_SCAN_CAP = 6`, `callers.falhas` existe. Cap batido, falha ou incompletude → **seleção manual bloqueante** |
| 9 | `STORE_CAP`, `rehydrate` e outros consumidores | §7.1.1: filtro por `kind` em **todo** consumidor e cap **por kind** — 60 upgrades não podem expulsar histórico de correção. §7.1.2: custo de dossiê sai de `proposals.json` e vai para `dossies.json` — dossiê não é proposta (sem portão, sem diff, sem decisão, nada a reidratar) |
| 11 | três casos críticos sem teste | §9: `mutex-test.js` (reentrância com checagem 7 ligada), `ledger-kind-test.js` (filtro e cap por kind), `credencial-nova-test.js` (nó novo com credencial) — cada um com o mutante que tem de falhar |
| 13 | `CLAUDE.md` ficaria mentindo sobre a fronteira de escrita | §8, seção nova e **antes do código**: o bloco "Write boundary" ganha três itens (upgrade em fluxo vivo, cópia `[SANDBOX upgrade]` agora ligada por padrão, aplicar com nó desligado), mais o mutex, `escreverAprovado()` e as linhas de `dossies.json` e `.cache-fluxos/` |

Zero recusas nesta rodada.

## Round 3 — Codex (sessão nova)

> A sessão retomada da rodada 2 parou de funcionar: `codex exec resume` morre antes de gerar turno com
> `unknown variant "max", expected one of ... "xhigh"` ao decodificar a lista de modelos — skew entre
> codex-cli 0.112.0 e o servidor, não conteúdo. Rodada 3 rodou em **sessão nova**, apontada para este log,
> então ele conferiu os próprios achados por escrito em vez de por memória.

A maior parte dos achados anteriores foi tratada de forma material no texto do plano: 5a agora fecha o verde falso por amostra, o dossiê ganhou fingerprint topológico + hash global, a resolução pai/filho agora bloqueia em caso incompleto, a queda de `settings` foi classificada, e a linha de credencial do nó novo deixou de passar como cinza. O que ainda está quebrado é o seguinte:

- Crítico: [PLAN-UPGRADE.md](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md) §5.7.1 cria o caminho `Aplicar com o nó novo desligado`, mas o repositório hoje só tem um fluxo coerente de “patch -> diff mostrado -> write exato” ([claude-fix.js:225](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L225), [claude-fix.js:1297](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1297), [CLAUDE.md:2071](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/CLAUDE.md#L2071)); o plano nunca define um segundo artefato explícito para esse apply alternativo, então esse botão ou aplicará algo diferente do diff revisado, ou reaproveitará gates rodados sobre o patch errado. Fix: modele o caminho alternativo como um segundo patch explícito (`patchDisabled`) com diff próprio e bateria própria antes de exibir o botão.

- Alto: [PLAN-UPGRADE.md](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md) continua internamente contraditório sobre o ledger do dossiê: em §2.3.1 o custo “entra em `proposals.json` como `kind: "dossie"`”, mas em §7.1.2 o custo “NÃO entra em `proposals.json`” e vai para `dossies.json`; isso significa que o achado da rodada 2 não foi realmente fechado, só ficou duplicado com duas regras incompatíveis. Fix: remova totalmente o caminho `kind: "dossie"` e deixe `dossies.json` como único ledger do dossiê.

- Alto: [PLAN-UPGRADE.md](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md) §6.5 manda pôr um mutex process-wide reentrante “por dono” em `putWorkflow`/`createWorkflow`, mas essas funções hoje não recebem nenhum token de dono ([n8n.js:903](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/n8n.js#L903), [n8n.js:913](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/n8n.js#L913)) e já são chamadas por caminhos em produção distintos ([claude-fix.js:929](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L929), [claude-fix.js:1324](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1324), [claude-fix.js:1360](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1360), [tester.js:998](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/tester.js#L998), [tester.js:1001](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/tester.js#L1001)); do jeito escrito, “extrair mutex primeiro” não é uma etapa segura, porque ainda falta o encanamento de ownership nos call sites reais. Fix: a primeira etapa tem de ser adicionar `writeOwner` a todo call site existente e testá-lo, e só depois ligar o mutex compartilhado.

- Médio: [PLAN-UPGRADE.md](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md) §7.1.1 exige filtro por `kind` em `estimate`, `rehydrate` e cap por kind, mas o store real hoje persiste linhas sem `kind` nenhum ([claude-fix.js:401](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L401), [claude-fix.js:953](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L953), [claude-fix.js:1012](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1012), [claude-fix.js:1250](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1250)); sem regra de migração, o plano ou perde todo o histórico já existente de correção, ou mistura legado de forma arbitrária. Fix: defina explicitamente que `kind` ausente é lido como `"fix"` antes de qualquer filtro, ETA ou cap por tipo.

VERDICT: REVISE
### Claude's response — Round 3

**Quatro achados, quatro aceitos. Zero recusas.** O segundo é uma contradição que eu mesmo plantei entre
duas seções — o tipo de defeito que só um leitor adversário encontra.

| # | Achado | O que mudou |
|---|---|---|
| Crítico | `Aplicar com o nó novo desligado` aplicaria algo diferente do diff revisado | §5.7.2, seção nova: `patchDesligado` é derivado **por código** e tratado como **proposta independente** — `applyPatch` próprio, **bateria de sete rodando de novo** (a 5a em especial, porque nó que não religa tem impacto diferente), `diffWorkflow` próprio, e `escreverAprovado()` recebe esse patch. Os dois **nunca compartilham veredito de portão**, e a tela mostra um de cada vez |
| Alto | contradição: §2.3.1 dizia `proposals.json`, §7.1.2 dizia `dossies.json` | Real e minha. A rodada 2 mudou o destino e deixou as duas regras convivendo. §2.3.1 reescrita: existe **um** ledger de dossiê, `dossies.json`, e **`kind: "dossie"` não existe em lugar nenhum** |
| Alto | "extrair o mutex primeiro" não era etapa segura | §6.5.1: `putWorkflow`/`createWorkflow` não recebem dono hoje e já têm **cinco call sites** em produção. Ligar mutex "por dono" antes de existir dono é ligar um mutex que não distingue reentrância de disputa — o deadlock introduzido pela etapa que deveria ser a segura. Virou **etapa 0** (encanamento de `writeOwner`, sem trava) e **etapa 1** (ligar a fila) |
| Médio | linhas antigas do store não têm `kind` | §7.1.1.1: `kindDe(p) = p.kind || "fix"` na leitura, **antes** de qualquer filtro, ETA ou cap. Sem migração de arquivo. É a regra de "campo ausente nunca cai no ramo negativo" que este repo já pagou três vezes, aplicada agora a arquivo em vez de tela |

**A ordem de construção virou quatro etapas reversíveis** (Risks §7): `writeOwner` → `kind` + filtros →
`escreverAprovado()` com correção e Tester passando → fila reentrante. A aba nova só depois das quatro.

## Round 4 — Codex

Achados:

- Médio: [PLAN-UPGRADE.md:527](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md#L527) ainda contradiz o próprio corpo do plano ao dizer que a alternativa “aplicar desligado” foi rejeitada, enquanto [PLAN-UPGRADE.md:310](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md#L310) já a reintroduz como `patchDesligado` no caso restrito de nó novo com credencial. Fix: reescreva o tradeoff para dizer que a política geral foi rejeitada, mas o caminho restrito voltou como segundo artefato independente.
- Médio: [PLAN-UPGRADE.md:410](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md#L410) e [PLAN-UPGRADE.md:416](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/PLAN-UPGRADE.md#L416) subcontam a superfície do passo `writeOwner`: o plano fala em 5 call sites atuais, mas o código hoje tem 6, em [claude-fix.js:929](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L929), [claude-fix.js:931](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L931), [claude-fix.js:1324](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1324), [claude-fix.js:1360](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/claude-fix.js#L1360), [tester.js:998](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/tester.js#L998) e [tester.js:1001](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/tester.js#L1001). Fix: corrija o plano para 6 call sites e enumere-os.

O resto está materialmente fechado, não só reescrito. O achado crítico da rodada 3 foi resolvido de verdade: `patchDesligado` virou segundo artefato com `applyPatch`, bateria, diff e escrita próprios, então não há mais o problema de aplicar algo diferente do diff revisado. Também não achei mais contradição no ledger do dossiê: o plano agora converge em `dossies.json`, e a migração de `kind` ausente para `"fix"` é necessária e compatível com o estado real de [proposals.json](/C:/Users/kauan.millarch_ecomm/Desktop/Projects/Cockpit%20Projetos/proposals.json), que hoje de fato não tem `kind`.

Sobre a ordem `writeOwner -> kind+filters -> escreverAprovado -> fila reentrante`: ela é segura em princípio para os caminhos já em produção, justamente porque adia o mutex até depois do encanamento de ownership e adia a aba nova até depois da extração do caminho único de escrita. O único problema aí é a subcontagem dos call sites; corrigido isso, a ordem faz sentido.

VERDICT: REVISE
### Claude's response — Round 4

Dois achados, dois aceitos. Ambos de precisão, e o revisor declarou o resto materialmente fechado —
inclusive que o crítico da rodada 3 foi resolvido de verdade e que a ordem de quatro etapas é segura
para os caminhos que já estão em produção.

- **Tradeoff 2 contradizia §5.7.2.** Real. Reescrito: a **política geral** de aplicar desligado segue
  rejeitada (é por isso que o caminho normal aplica ligado), e o que voltou é o **caso restrito** de nó
  novo que exige credencial, como segundo artefato. Ambiguidade de conta em nó que já tinha credencial
  é outra coisa e não usa esse caminho.
- **Call sites subcontados: 6, não 5.** Conferido por `grep` antes de aceitar. §6.5.1 agora enumera os
  seis (`claude-fix.js` 929, 931, 1324, 1360; `tester.js` 998, 1001) numa tabela dizendo o que cada um
  escreve, e registra que a aba nova acrescenta duas — então a etapa 0 fecha as seis antes de existir a
  sétima.

## Round 5 — Codex

Revisei `PLAN-UPGRADE.md` e `PLAN-UPGRADE-REVIEW-LOG.md` contra o código real do repositório. Os dois achados da rodada 4 estão de fato fechados: o tradeoff 2 agora distingue corretamente a política geral rejeitada do caminho restrito `patchDesligado`, em linha com §5.7.2, e a etapa de `writeOwner` agora fala em **seis** call sites, o que bate com o código atual (`claude-fix.js`: 929, 931, 1324, 1360; `tester.js`: 998, 1001) e com as assinaturas reais de `putWorkflow`/`createWorkflow` em `n8n.js`, que hoje ainda não recebem owner.

Também procurei regressões de consistência introduzidas por essas correções e não achei uma falha material remanescente. O plano continua coerente no que antes estava mais frágil: `patchDesligado` segue tratado como artefato independente com bateria/diff/escrita próprios; o ledger do dossiê converge só em `dossies.json`, sem sobra operacional de `kind: "dossie"`; e a regra de legado `kind` ausente => `"fix"` continua necessária e compatível com o estado real do store. Não há contradição nova relevante que impeça implementação.

VERDICT: APPROVED
---

## Convergiu

**APROVADO na rodada 5 de 5.** Nenhuma revisão foi necessária nesta rodada.

Contagem: **22 achados** ao longo de 5 rodadas, **21 aceitos**, **1 recusado e depois revertido por
mim** na rodada 2 quando o contra-argumento se mostrou melhor que o meu (o bloqueio por `settings`
descartado — prevalência prova prevalência, não inocuidade).

Quatro coisas que a revisão cruzada pegou e que o grill sozinho não teria pego, todas verificadas por
mim no código antes de aceitar:

1. **Duas afirmações minhas sobre o código eram falsas.** `estimate()` não depende da assinatura de
   erro, e `approve()` é acoplado ao ciclo de vida do `claude-fix` — "reusa inteiro" era mentira.
2. **Uma contradição que eu plantei entre duas seções** (ledger do dossiê em `proposals.json` na §2.3.1
   e em `dossies.json` na §7.1.2), sobrevivente de uma revisão minha.
3. **A etapa que eu chamei de segura podia travar produção**: ligar mutex "por dono" antes de existir
   dono, em seis call sites que hoje não passam nenhum.
4. **`patchDesligado` aplicaria algo diferente do diff revisado** — o achado mais grave, e quebraria a
   única garantia que o approve dá.

Nota operacional: `codex exec resume` parou de funcionar depois da rodada 2 por skew de versão
(codex-cli 0.112.0 não decodifica a lista de modelos que o servidor anuncia). As rodadas 3–5 rodaram em
sessão nova apontada para este log — ele confere os próprios achados por escrito em vez de por memória,
que para um verificador é igual ou melhor.
