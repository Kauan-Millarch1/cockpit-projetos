# Agentes conversacionais no n8n — a estruturação

Este arquivo é o **conhecimento de domínio** que o Tester carrega quando alguém pede um agente
conversacional. Sem ele, o Tester trata "criar um agente que responde lead no WhatsApp" como se
fosse "avisar no Slack quando vender no Mercado Livre" — mesma entrevista de seis perguntas
genéricas, mesmo fluxo linear de cinco nós. O resultado importa e é sempre o mesmo: um fluxo que
importa no n8n, parece certo e não sobrevive ao primeiro lead que manda três áudios seguidos.

**Tudo aqui foi medido nos fluxos que rodam nesta instância**, não deduzido de tutorial. As
referências estão no fim. Onde um número aparece (15s de buffer, 30s de TTL de lock, 15min → 1h →
24h de follow-up), ele é o valor que está em produção hoje — não uma sugestão.

Está em português porque é colado dentro dos prompts do `tester.js`, que são em português. Misturar
os dois idiomas dentro de um prompt piora o resultado do modelo sem nenhum ganho.

## Como este arquivo é usado

`tester.js` lê este arquivo em runtime e usa **pedaços dele**, delimitados por âncoras de comentário
HTML que precisam estar **sozinhas na própria linha** (`BLOCO: nome` para abrir, `/BLOCO` para
fechar — a exigência de linha própria é o que impede este parágrafo de ser lido como um bloco):

| Bloco | Como chega na sessão | Para quê |
|---|---|---|
| `entrevista` | **dentro do prompt** de `promptEntender()` | As dimensões que a conversa precisa fechar antes de construir |
| `arquitetura` | escrito em `AGENTES.md`, no diretório da corrida | As camadas obrigatórias e a ordem delas |
| `receitas` | idem | Tipo, `typeVersion` e forma dos parâmetros de cada nó da receita |
| `armadilhas` | idem | Os erros que já foram cometidos aqui e custaram debugging |

**Os três blocos longos vão para arquivo, não para o prompt.** O prompt viaja no argumento `-p` do
CLI, e o Windows limita a linha de comando inteira a 32767 caracteres: somados, estes três passam de
31KB e o `spawn` morria com `ENAMETOOLONG` — medido. O prompt de construção diz o que ler e leva
apenas as regras curtas que precisam valer mesmo se a sessão ignorar o arquivo. Além de caber, sai
melhor: a sessão lê o pedaço de que precisa, pode `Grep` por um assunto, e **o que ela leu aparece no
log de atividade** — dá para ver se consultou a receita ou improvisou.

Editar este arquivo muda o comportamento do Tester **sem tocar em código e sem reiniciar o
servidor** — é lido a cada build. É o mesmo princípio do bloco de julgamento do `flows.html`: a
parte que o Kauan mais ajusta fica num lugar só, em prosa, e não espalhada por `if`s.

**Não acrescente aqui nada que não tenha sido medido.** Um número inventado neste arquivo vira um
número inventado em todo fluxo gerado a partir dele, e o Tester perde a única coisa que o torna
útil: o fluxo que sai dele pode ser confiado.

## O que conta como agente conversacional

Três coisas ao mesmo tempo:

1. **A pessoa do outro lado escreve livremente.** Não é um menu, não é um formulário, não é um botão.
2. **A resposta é gerada por um modelo**, não escolhida numa árvore de decisão.
3. **A conversa tem estado.** A quinta mensagem depende das quatro anteriores.

Se qualquer uma das três faltar, **não é um agente e não deve ser construído como um**. Um fluxo que
responde "recebemos sua mensagem, já retornamos" a qualquer texto é um autoresponder: um webhook e um
envio, dois nós, e enfiar buffer e memória nele é complexidade sem função.

O contrário também vale: se as três estão presentes, as sete camadas abaixo **não são opcionais**.
Cada uma existe porque a ausência dela produz uma falha específica e observada, listada na camada.

---
<!-- BLOCO: entrevista -->

## As decisões que a entrevista tem que arrancar

Um agente conversacional tem doze decisões que mudam **quais nós existem no fluxo**. As seis
dimensões genéricas (gatilho, origem, filtro, conteúdo, destino, vazio/erro) cobrem três delas e
deixam nove em aberto. Cada uma em aberto é um pedaço do fluxo que sai errado ou não sai.

Pergunte o que ainda estiver aberto, na ordem abaixo — ela vai do que mais muda o fluxo para o que
menos muda. **Não pergunte o que a pessoa já disse, nem o que tem padrão óbvio marcado como tal.**

### 1. Canal e quem atende — muda tudo
Qual canal (WhatsApp Business API oficial? Evolution/Z-API? Telegram? widget no site?) e, se WhatsApp
oficial, **qual número**. Um número já atendido por outro agente precisa de rota nova no fluxo de
entrada que já existe, não de um webhook novo — dois webhooks no mesmo número é o segundo nunca
receber nada.

### 2. Quem é o agente e qual o trabalho dele
Nome, função e **o objetivo único**: vender, qualificar, agendar, tirar dúvida, dar suporte. Um
agente com dois objetivos ("vende e também faz suporte") na prática não faz nenhum dos dois — a
saída é dois agentes com escalonamento entre eles, e vale dizer isso.

### 3. Áudio na saída — sim ou não, e quando
**Esta é a pergunta que nunca é feita e sempre importa.** Três respostas possíveis, e cada uma é um
fluxo diferente:
- **Só texto** — o fluxo termina no envio de texto. Mais simples, mais barato.
- **Só áudio** — precisa de humanização + TTS + upload. Some ~6 nós e uma credencial (ElevenLabs).
- **O agente decide a cada mensagem** — é o que o Iago faz: o campo `acionar_audio` no structured
  output decide, e o fluxo tem **os dois ramos**. É o mais caro e o que soa melhor.

Se for áudio, pergunte também: **qual voz** (é um id no ElevenLabs, a pessoa precisa ter escolhido) e
se o áudio substitui o texto ou vem junto.

### 4. Áudio e imagem na entrada
O lead vai mandar áudio? Vai mandar foto (print de tela, foto de produto, comprovante)? Para cada
"sim", o fluxo ganha um ramo de download + transcrição/leitura. Para cada "não", o tipo é descartado
com uma resposta honesta ("não consigo ouvir áudio, me escreve?") em vez de silêncio.

**Não pergunte se o agente deve "entender áudio" — pergunte se o lead manda áudio.** A primeira é
uma escolha de recurso, a segunda é um fato sobre o canal, e no WhatsApp a resposta é sempre sim.

### 5. Agrupar mensagens picadas (buffer)
Pergunte assim: *"quando a pessoa manda três mensagens seguidas, o agente responde três vezes ou
espera ela terminar e responde uma vez?"* Ninguém pede "buffer com debounce", e todo mundo entende a
pergunta nessa forma.

Se a resposta for "espera" — que é o certo em WhatsApp — pergunte **quantos segundos**. O padrão
medido aqui é **15s**. Menos que 8s corta a pessoa no meio do raciocínio; mais que 20s ela acha que
o agente morreu.

### 6. O que o agente precisa saber, e de onde
A base de conhecimento: catálogo de produtos, tabela de preços, agenda, FAQ, documento. E
crucialmente **onde isso vive hoje**: Supabase? Planilha? API? Na cabeça de alguém?

"Na cabeça de alguém" é uma resposta válida e importante — significa que o system prompt carrega o
conhecimento em texto, e que ele vai ficar velho. Diga isso.

### 7. O que o agente pode FAZER além de falar (tools)
Consultar preço, verificar estoque, agendar, criar tarefa no CRM, gerar link de pagamento, buscar
pedido. Cada verbo é uma tool.

E o inverso, que vale mais: **o que ele não pode fazer de jeito nenhum.** Prometer desconto? Cancelar
pedido? Emitir nota? Isso vira uma seção "NÃO PODE" no system prompt, e sem ela o modelo promete —
foi medido: um agente sem essa seção oferece coisas que não existem.

### 8. Quando chamar humano
Duas situações diferentes, e as duas precisam de resposta:
- **A pessoa pede** ("quero falar com alguém"). Vira uma tool de handoff.
- **O agente entra em terreno perigoso** sem a pessoa pedir: pediu desconto, perguntou algo fora da
  base, saiu do roteiro. Vira alerta + **decisão de pausar ou não** a IA naquela conversa.

Pergunte: *"quando o agente escalar, ele para de responder ou continua até alguém assumir?"* Pausar é
mais seguro e deixa a conversa parada se ninguém olhar; continuar é mais fluido e o humano chega em
cima de uma conversa que andou.

### 9. Follow-up quando a pessoa desaparece
Vai perseguir quem parou de responder? Se sim: **quantas vezes e com que espaçamento.** O padrão
medido aqui é **15min → 1h → 24h**, e depois marca como perdido.

Se não vai perseguir, diga que a conversa simplesmente fica aberta — não é um erro, é uma escolha.

### 10. Tom, tamanho e o que é proibido dizer
Como o agente escreve: formal ou próximo, emoji ou não, gíria ou não, uma mensagem longa ou várias
curtas. Peça **um exemplo de mensagem boa** e, se der, uma ruim — um exemplo vale mais que cinco
adjetivos, e vai direto para o system prompt como few-shot.

Duas coisas concretas para fechar: **quantas bolhas no máximo** por resposta (o padrão aqui é 2 para
texto) e **quantos caracteres por bolha** (~120).

E uma que só vale perguntar quando o tom importa muito ou quando o agente fala de preço:
**"o agente deve revisar a própria resposta antes de enviar?"** É o loop descrito na camada ⑦ — uma
verificação por código (custo zero) que pega emoji, gíria e **preço que não bate com o que a tool
devolveu**, e opcionalmente um revisor por modelo. Custa 1 a 3 chamadas de modelo a mais por mensagem e
soma ~8 nós. Vale quando errar o preço é caro; não vale num agente que só tira dúvida. O padrão é
**não**, e a verificação determinística sozinha (sem o revisor por modelo) é o meio-termo que sai de
graça.

### 11. Onde a conversa fica guardada
Toda mensagem gravada, ou só o resumo? Isso decide se existe tabela de mensagens. Existe uma resposta
padrão boa: **grave tudo** — é barato e é a única forma de descobrir depois por que o agente
respondeu o que respondeu.

### 12. Como saber se está funcionando
O que a pessoa vai querer olhar depois: quantas conversas, quantas viraram venda, onde o agente
travou, quanto custou. Isso decide os campos da tabela de decisões.

Esta é a única das doze que pode virar suposição sem prejuízo — mas diga que virou.

### Padrões que você pode assumir sem perguntar
Assuma, e **registre cada um em `achados` como `a-confirmar`**:

- buffer de **15s** com debounce por última mensagem
- lock de processamento com **TTL de 30s**
- memória de conversa no **Redis**, chaveada pelo telefone
- **máximo 2 bolhas** de texto por resposta, ~120 caracteres cada
- transcrição de áudio por **Whisper**, leitura de imagem por **GPT-4o**
- gravar **toda** mensagem, entrada e saída
- **sem emoji** (é o padrão de todos os agentes desta instância)
- responder **em português do Brasil**

### O que NUNCA é suposição
Estas quatro **têm** que ser perguntadas. Se a entrevista acabar sem elas, o fluxo sai errado de um
jeito que só aparece em produção:

1. **Áudio na saída** (item 3) — muda ~6 nós e uma credencial.
2. **Canal e número** (item 1) — errar aqui é o webhook nunca receber nada.
3. **O que ele não pode fazer** (item 7) — a ausência faz o modelo prometer o que não existe.
4. **Escalonamento pausa ou não** (item 8) — decide se um lead quente fica esperando no vácuo.

<!-- /BLOCO -->
---
<!-- BLOCO: arquitetura -->

## A anatomia: sete camadas, nesta ordem

Um agente conversacional de WhatsApp que funciona tem sete camadas. A ordem não é estética: cada uma
depende da anterior ter acontecido.

```
①  PORTA           webhook → responde 200 na hora → achata o payload
②  TRIAGEM         é mensagem? é de grupo? qual mídia? → descarta o que não trata
③  BUFFER          empilha no Redis → espera → só a última execução segue
④  CONTEXTO        lock → lead → histórico → base de conhecimento → monta o prompt
⑤  CÉREBRO         modelo + memória + tools + structured output
⑥  ENTREGA         texto em bolhas com pausa │ ou áudio: humaniza → TTS → envia
⑦  DEPOIS          grava mensagens → atualiza estado → alerta → agenda follow-up → solta o lock
```

### ① Porta de entrada

**Responda o webhook antes de processar.** A Meta reenvia o evento se não receber `200` em poucos
segundos, e um agente que demora 40s para responder recebe a mesma mensagem várias vezes. O
`respondToWebhook` fica logo depois do trigger, num ramo próprio — não no fim do fluxo.

O payload da WhatsApp Business API vem em três níveis de aninhamento
(`body.entry[].changes[].value.messages[]`) e **um evento pode carregar várias mensagens**. Achate em
dois nós de código: um abre `entry`/`changes`, o outro abre `messages`/`statuses`/`errors` e marca
cada item com `eventType`.

Se o canal é WhatsApp oficial, a porta também precisa responder ao **desafio de verificação** do
webhook (`hub.challenge`) — é um `if` no começo que devolve o token.

**Sem esta camada:** mensagem duplicada, e o agente responde duas vezes à mesma coisa.

### ② Triagem

Quatro filtros em sequência, e todos os quatro importam:

**O número está normalizado?** Telefone brasileiro chega em pelo menos quatro formatos diferentes na
mesma conta, e o nono dígito é o problema: celular de São Paulo tem, telefone antigo não, e o WhatsApp
entrega tanto `5541999999999` como `554199999999` **para o mesmo contato**. Sem normalizar, o mesmo
lead vira dois registros, duas memórias e duas conversas paralelas — e o agente cumprimenta pela
primeira vez alguém que já falou com ele.

A normalização em produção aqui: tira caracteres não numéricos, tira zero à esquerda, força o `55`,
**injeta o nono dígito quando a parte local tem 8 dígitos**, remove `9` duplicado, e exige 12 ou mais
dígitos no fim. O que sai é `{telefone_original, telefone_normalizado, telefone_valido}` — e
**`telefone_normalizado` é a chave de tudo depois**: memória, lock, buffer, tabela de leads. Nunca
misture o original com o normalizado nas chaves.

**É mensagem?** O mesmo webhook recebe `messages`, `statuses` (entregue/lido) e `errors`. Sem separar,
o agente responde ao recibo de leitura da própria mensagem que ele acabou de mandar. Loop infinito.

**É de grupo?** Se o número está em grupos, chega evento de grupo. Um agente comercial respondendo
num grupo é o pior tipo de vazamento. Filtre por presença de `group_id`.

**Qual mídia?** As duas portas de entrada desta instância roteiam **16 tipos** de mensagem: `audio`,
`button`, `contacts`, `document`, `edit`, `image`, `interactive`, `location`, `order`, `reaction`,
`revoke`, `sticker`, `system`, `text`, `unsupported`, `video`. Nas duas, **exatamente três estão
ligadas** — `text`, `audio`, `image` — e as outras **treze são becos sem saída deliberados**. Essa é a
proporção real: um agente trata três e descarta treze, e o descarte é explícito.

Trate `reaction` e `revoke` com cuidado especial: uma reação de 👍 não é uma mensagem para responder,
e uma mensagem apagada não deve ser processada.

**O switch de mídia precisa de saída de fallback.** Um `switch` com três saídas nomeadas
(`texto`/`audio`/`imagem`) e sem fallback deixa vídeo e documento entrarem no buffer, chegarem ao
switch e a execução terminar sem saída nenhuma: nenhum erro, nenhuma resposta, e o lead esperando.
Medido num agente desta instância, onde `evento-tipo` calcula `'video'`, `'documento'` e `'unknown'`
que **nenhuma saída do switch casa**. Ou o tipo tem ramo, ou tem fallback com resposta honesta.

**Sem esta camada:** loop de recibo de leitura, resposta em grupo, o mesmo lead como dois registros, e
o agente tentando ler um sticker.

### ③ Buffer — agrupar o que veio picado

O problema: em WhatsApp ninguém escreve um parágrafo. Escreve *"oi"*, *"vi o anúncio"*, *"quanto
custa?"* em oito segundos. Sem buffer o agente responde três vezes, e as três respostas são ruins
porque cada uma viu um terço da pergunta.

**O padrão que funciona aqui é debounce por última escrita**, e é mais simples do que parece:

1. **Empilha** a mensagem numa lista Redis (`RPUSH`), com o tipo e o conteúdo em JSON.
2. **Grava um timestamp** próprio numa chave Redis: `buffer_ts:{numero}:{lead}` = agora.
3. **Espera** N segundos (o padrão é 15).
4. **Lê o timestamp de novo.** Se for igual ao que você gravou, você é a última mensagem: siga. Se
   for diferente, chegou mensagem depois de você: **morra em silêncio**, porque a execução mais nova
   vai responder por todas.
5. **Lê a lista inteira**, consolida, e **apaga a lista**.

Não precisa de contador, não precisa de fila, não precisa de cron. Cada execução resolve sozinha se
ela é a que responde. É a mesma lógica do `execution_id` no follow-up (camada ⑦).

**Na consolidação, mídia não vira texto cru.** Uma mensagem de áudio na lista carrega o *id* do
áudio, e enfiar esse id no texto que vai para o modelo faz o modelo tentar interpretar
`1234567890123456` como conteúdo. Substitua por um marcador legível: `[o lead enviou um áudio]`. Só
mensagens de texto contribuem com o texto delas.

**Sem esta camada:** três respostas para uma pergunta, cada uma pior que a anterior.

### ④ Contexto — o que o modelo precisa saber antes de pensar

Ordem importa: cada passo usa o resultado do anterior.

**Lock, primeiro.** Duas execuções processando o mesmo lead ao mesmo tempo produzem duas respostas
concorrentes e corrompem a memória. Um `SET` em `processing:{lead}` com **TTL de 30s** e o valor
sendo o id da execução. Se a chave já existe, esta execução desiste. O TTL é o que garante que um
crash não trava o lead para sempre — nunca use lock sem TTL.

**O lead.** Busca no banco; se não existe, cria. É aqui que se descobre se é primeiro contato — e a
primeira mensagem de um agente é diferente de todas as outras.

**O histórico resumido.** O agente precisa saber o que já foi conversado sem reler 40 mensagens. Um
resumo estruturado (estágio, objeções já levantadas, argumentos já usados, próxima ação) guardado em
Redis e atualizado a cada volta. Isso é o que impede o agente de repetir o mesmo argumento e de pedir
uma informação que ele já tem.

**A base de conhecimento, com cache.** Se o agente consulta catálogo ou preço, isso vem de API ou
tabela — e **com cache em Redis**, TTL de 1h. Sem cache, cada mensagem de cada lead bate na API.

**Montar o prompt dinâmico.** Aqui está a parte que separa um agente bom de um genérico: o system
prompt tem uma **parte fixa** (identidade, regras, roteiro, exemplos) e uma **parte montada em código
a cada volta** com o estado desta conversa: em que etapa está, qual o perfil da pessoa, quantas
mensagens já trocaram, o que fazer agora.

A parte fixa entra no `systemMessage` do nó de agente. A parte dinâmica é montada por um nó `Code` e
injetada com uma expressão no fim do `systemMessage`. **Escrever regra de etapa dentro da parte fixa
não funciona** — o modelo lê as seis etapas e escolhe mal. O código escolhe a etapa; o prompt só
descreve como se comporta em cada uma.

**Sem esta camada:** o agente repete argumentos, esquece o nome da pessoa, e duas mensagens
simultâneas se atropelam.

### ⑤ Cérebro

O nó de agente com quatro coisas penduradas nas portas `ai_*`:

**O modelo** (`ai_languageModel`). Temperatura baixa para agente comercial — o valor em produção aqui
é **0.6** — e `maxRetries: 2`.

**A memória** (`ai_memory`). Redis, chaveada por telefone: `memoria:{telefone}`. **A chave é o
telefone e nada mais** — chave fixa mistura a conversa de todos os leads, e é o erro mais fácil de
cometer porque funciona perfeitamente enquanto só existe um lead de teste.

**As tools** (`ai_tool`, uma conexão por tool). Cada verbo do item 7 da entrevista.

**O structured output** (`ai_outputParser`). **Esta é a peça que mais muda a qualidade do fluxo, e a
que um gerador ingênuo esquece.**

Um agente que devolve texto solto obriga o resto do fluxo a adivinhar: era para mandar áudio? o lead
está interessado? precisa chamar humano? Com um schema, o modelo **declara** tudo isso junto com a
resposta, e o fluxo depois só lê campos:

```
messages           array de strings — as bolhas, na ordem
intencao_detectada enum — interesse_alto | objecao | duvida | ...
acionar_audio      bool — decide o ramo da camada ⑥
acionar_handoff    bool — decide se chama humano
status_crm         enum — o estado que vai para o banco
dados_lead         objeto — nome/e-mail que a conversa revelou
requer_atencao_humana { necessario, tipo, motivo, urgencia }
```

Os campos exatos saem do caso. Mas **`messages` como array e um booleano por ramo do fluxo são
obrigatórios**: é o que faz o `switch` da camada seguinte ler um campo em vez de interpretar texto.

Um detalhe que parece pequeno e não é: **na descrição de cada campo do schema, escreva quando ele é
`true`**. `"acionar_audio: true para perguntas sobre o produto e objeções, false para saudações"`
funciona; `"acionar_audio: se deve mandar áudio"` faz o modelo decidir aleatoriamente.

**Sem esta camada:** o resto do fluxo vira regex em cima do texto do modelo.

### ⑥ Entrega

**Texto e áudio são dois ramos**, escolhidos por `switch` no campo `acionar_audio`.

**Ramo texto — uma bolha por vez, com pausa entre elas.** O array `messages` explode em N itens, e um
laço envia um por um com espera entre os envios. Duas mensagens disparadas no mesmo segundo chegam
como um bloco e leem como robô.

A pausa medida aqui tem duas partes: uma **base aleatória** (1 a 3,5s) e um **bônus por tamanho** da
mensagem. A fórmula em produção:

```js
const base = 3 + Math.random() * 2;              // 3 a 5s
const bonus = Math.min(msg.length / 80, 4);      // até 4s a mais
const espera = Math.round(base + bonus);
```

O laço é: seleciona a mensagem do índice → envia → espera → incrementa → `if (índice < total)` volta.

**Ramo áudio — três passos, e o primeiro é o que ninguém faz.** O texto escrito para ser lido não
funciona falado: tem link, tem quebra de linha, tem número escrito como número. Então:

1. **Humaniza** — uma segunda chamada de modelo que reescreve o texto para ser falado. Regras que
   estão em produção: nada de markdown, nada de emoji, **nada de URL** (troque por *"te mando o link
   na sequência"*), números escritos em palavras, frases curtas com comprimento variado.
2. **TTS** — ElevenLabs com um id de voz fixo.
3. **Ajusta o binário e envia.** O WhatsApp aceita `audio/ogg; codecs=opus`; o que sai do TTS
   precisa desse `mimeType` e da extensão `.ogg` setados num nó `Code` antes do envio.

Guarde o áudio gerado num storage também — é a única forma de ouvir depois o que o agente falou.

**Sem esta camada:** um textão robótico, ou um áudio que lê "https dois pontos barra barra" em voz
alta.

### ⑦ Depois

Cinco coisas, e nenhuma delas pode derrubar a resposta:

**Grave as mensagens** — entrada e saída, com direção, tipo de mídia e o id da mensagem do WhatsApp
(`wamid`), que é o que permite ligar resposta a pergunta depois.

**Atualize o estado do lead** — status, etapa do funil, o que a conversa revelou.

**Registre a decisão** — o que o agente decidiu e por quê: tools chamadas, estágio, se passou pela
revisão. É o que responde "por que ele respondeu isso" três semanas depois.

**Dispare o alerta, se houver.** Combine **duas fontes**: o que o modelo declarou em
`requer_atencao_humana` **e** regras determinísticas em cima do texto do lead. As duas juntas, porque
o modelo às vezes não percebe que a pessoa pediu desconto, e um regex de `/desconto|mais barato/`
sempre percebe. Se a urgência é alta, marque a conversa como pausada.

**Agende o follow-up** e **solte o lock**.

**Todo nó desta camada tem `onError: continueRegularOutput`.** A resposta já foi enviada; uma falha
ao gravar log não pode transformar isso em erro. Foi medido: **35 dos 197 nós** do agente em produção
carregam essa configuração, e são exatamente os de persistência.

O inverso vale para modelo e API externa: `retryOnFail` com 3 tentativas.

### O follow-up, quando existe

Mesmo padrão de dono do buffer, mas persistido em tabela em vez de Redis, porque atravessa horas:

Uma linha por lead com `attempt`, `status` e **`execution_id`**. A execução espera 15min, relê a
linha e **só continua se o `execution_id` da linha for o dela**. Se o lead respondeu no meio, a nova
execução resetou a linha com um `execution_id` novo, e a antiga morre em silêncio. Se ainda é a dela,
manda a mensagem, incrementa `attempt`, e espera o próximo intervalo: 1h, depois 24h. Na quarta,
marca como perdido.

**`Wait` longo em n8n Cloud sobrevive a restart** — a execução é despausada pelo servidor. Mas cada
`Wait` é uma execução pendurada; três por lead em cima de centenas de leads é volume de execução, e
vale dizer isso.

### As duas peças que não são obrigatórias, mas mudam o resultado

**Revisão antes de enviar (o "lava jato").** Entre o cérebro e a entrega, um loop que julga a
resposta e a manda de volta se estiver ruim. Quatro estações:

1. **Verificação determinística, custo zero.** Um nó `Code` que reprova o que é objetivamente errado:
   emoji quando é proibido, gíria da lista, mais de uma pergunta, mais bolhas que o máximo, e —
   o mais valioso — **preço que não bate com o que a tool devolveu**. Erro objetivo não gasta modelo.
2. **Revisor.** Uma chamada de modelo que julga tom e conteúdo e devolve nota + problemas.
3. **Regeneração.** Se reprovou, uma chamada que reescreve com os problemas na mão. Máximo 3 ciclos.
4. **Polimento determinístico.** Espaços, capitalização, e forçar o máximo de bolhas.

**E fail-open: se estourar o limite de ciclos, envia a melhor versão que tem.** Um lead esperando é
pior que uma resposta imperfeita. Essa é a regra que faz o loop ser seguro de ligar.

**Perfil de comunicação.** Classificar o estilo da pessoa nas primeiras mensagens e adaptar o tom.
Pode ser uma tool de código puro, sem chamada de API: classifica por palavras-chave e devolve
instruções fixas de como falar com aquele perfil.

<!-- /BLOCO -->
---
<!-- BLOCO: receitas -->

## Receitas — tipo e versão do que roda nesta instância

Estes são os tipos e `typeVersion` **em uso hoje**. Use exatamente estes: `typeVersion` omitido faz o
n8n importar como v1, e parâmetro escrito no formato novo quebra em silêncio dentro do editor.

### O cérebro

| Papel | `type` | `typeVersion` | Porta de saída |
|---|---|---|---|
| Agente | `@n8n/n8n-nodes-langchain.agent` | `2.2` | `main` |
| Modelo | `@n8n/n8n-nodes-langchain.lmChatOpenAi` | `1.2` | `ai_languageModel` |
| Memória Redis | `@n8n/n8n-nodes-langchain.memoryRedisChat` | `1.5` | `ai_memory` |
| Memória em janela | `@n8n/n8n-nodes-langchain.memoryBufferWindow` | `1.3` | `ai_memory` |
| Structured output | `@n8n/n8n-nodes-langchain.outputParserStructured` | `1.3` | `ai_outputParser` |
| Tool sub-workflow | `@n8n/n8n-nodes-langchain.toolWorkflow` | `2` | `ai_tool` |
| Tool de código | `@n8n/n8n-nodes-langchain.toolCode` | `1.3` | `ai_tool` |
| Tool de raciocínio | `@n8n/n8n-nodes-langchain.toolThink` | `1.1` | `ai_tool` |
| Whisper / visão | `@n8n/n8n-nodes-langchain.openAi` | `1.8` | `main` |
| TTS | `@elevenlabs/n8n-nodes-elevenlabs.elevenLabs` | `1` | `main` |

**As portas `ai_*` são a diferença mais importante entre um fluxo de agente e qualquer outro fluxo.**
O modelo, a memória, o parser e cada tool **apontam para o nó de agente**, não o contrário, e cada um
usa a sua própria porta nomeada em `connections`. Não é `main`.

```json
"connections": {
  "modelo_openai": { "ai_languageModel": [[{ "node": "agente", "type": "ai_languageModel", "index": 0 }]] },
  "memoria_redis": { "ai_memory":        [[{ "node": "agente", "type": "ai_memory",        "index": 0 }]] },
  "parser_saida":  { "ai_outputParser":  [[{ "node": "agente", "type": "ai_outputParser",  "index": 0 }]] },
  "tool_buscar_produto": { "ai_tool":    [[{ "node": "agente", "type": "ai_tool",          "index": 0 }]] },
  "agente":        { "main":             [[{ "node": "separar_bolhas", "type": "main",      "index": 0 }]] }
}
```

O nó de agente:

```json
{
  "name": "agente_atendimento",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 2.2,
  "parameters": {
    "promptType": "define",
    "text": "={{ $('mesclar_mensagem').first().json.Mensagem }}",
    "hasOutputParser": true,
    "options": {
      "systemMessage": "=…parte fixa…\n\n{{ $('montar_contexto').first().json.contexto_dinamico }}",
      "returnIntermediateSteps": true
    }
  }
}
```

`hasOutputParser: true` é obrigatório quando existe um parser conectado — sem ele o parser é
ignorado e a saída volta a ser texto solto. `returnIntermediateSteps: true` é o que permite ver
depois quais tools o agente chamou.

A memória:

```json
{
  "name": "memoria_conversa",
  "type": "@n8n/n8n-nodes-langchain.memoryRedisChat",
  "typeVersion": 1.5,
  "parameters": {
    "sessionIdType": "customKey",
    "sessionKey": "=memoria:{{ $('parametros').first().json['contato-wpp'] }}",
    "contextWindowLength": 20
  }
}
```

`contextWindowLength` é **número de interações guardadas, não tokens**. Os dois agentes em produção
aqui usam `10000`, o que na prática significa "a conversa inteira, para sempre" — e o custo por
mensagem cresce junto com a conversa, sem teto. Para um agente novo, 20 a 30 é o que cobre uma
conversa de vendas com o resumo estruturado da camada ④ carregando o que ficou para trás. Se você
escrever um número alto, diga no `report.md` que o custo cresce com a conversa.

### Uma tool sub-workflow

O agente preenche os campos com `$fromAI(nome, descrição, tipo)`; o que **não** deve ser inventado
pelo modelo (o telefone do lead, por exemplo) vem de expressão n8n normal:

```json
{
  "name": "handoff_humano",
  "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
  "typeVersion": 2,
  "parameters": {
    "name": "handoff_humano",
    "description": "Transfere o lead para atendimento humano. Use quando o lead pedir para falar com uma pessoa, ou em assunto fora do escopo. Passe o motivo.",
    "workflowId": { "__rl": true, "value": "‹id do sub-workflow›", "mode": "list" },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": {
        "phone":  "={{ $('parametros').first().json['contato-wpp'] }}",
        "motivo": "={{ $fromAI('motivo', 'Por que está transferindo', 'string') }}"
      }
    }
  }
}
```

**A `description` da tool é um prompt, não um rótulo.** Ela é a única coisa que o modelo lê para
decidir se chama a tool. Diga o que faz, **quando usar**, e quando *não* usar. `"Busca informações
completas sobre um evento. Use quando o lead demonstrar interesse durante o discovery."` funciona;
`"buscar evento"` não.

**"Chame esta tool sempre" no prompt não garante nada.** Se uma tool tem que ser chamada exatamente uma
vez por conversa, isso é uma decisão de **código**, não uma instrução: uma chave Redis com TTL marca
que já foi chamada, um `if` decide, e quando é para chamar o fluxo **injeta a ordem no texto que entra
no agente** naquela volta. Esse mecanismo existiu num agente desta instância (chave
`temperamento:chamado:{telefone}`, TTL 30 dias) e foi **removido numa versão seguinte, virando só uma
frase no prompt** — a frase diz "chame exatamente uma vez, nunca repita", e não há nada garantindo isso.
Quando a garantia importa, ela é código.

**O retorno da tool é um lugar legítimo para dar ordem ao agente.** A tool mais bem construída daqui
devolve um campo `resultado` com markdown que carrega, junto com os dados, as regras de uso deles:
`"## LINK DE CHECKOUT (REAL — enviar EXATAMENTE este, sem encurtar ou alterar)"` e
`"(indisponível nesta consulta — NÃO invente URL de pagamento; se o lead quiser fechar, faça handoff.)"`.
Isso funciona porque chega no contexto no momento exato da decisão, e é a única defesa que existe
quando a tool não encontra o que foi pedido.

### Mídia na entrada

**Áudio** — o WhatsApp entrega um id, não o arquivo. Três nós:

```
① GET https://graph.facebook.com/v21.0/{{ id }}     credencial whatsAppApi → devolve { url }
② GET {{ url }}                                     credencial whatsAppApi
   options.response.response = { responseFormat: "file", outputPropertyName: "audio" }
③ openAi v1.8  resource: "audio", operation: "transcribe", binaryPropertyName: "audio"
                                                     → devolve { text }
```

**Imagem** — mesmos dois primeiros nós, e no lugar do Whisper:

```json
{
  "type": "@n8n/n8n-nodes-langchain.openAi",
  "typeVersion": 1.8,
  "parameters": {
    "resource": "image",
    "operation": "analyze",
    "modelId": { "__rl": true, "value": "gpt-4o", "mode": "list" },
    "text": "Analise a imagem e transcreva todo o texto presente nela.",
    "imageUrls": "={{ $json.msg.image }}"
  }
}
```

Os três ramos (texto, áudio transcrito, imagem lida) **convergem num `merge` de 3 entradas** que
unifica tudo num campo só — `Mensagem` — e é esse campo que o agente lê. Sem a convergência, cada
ramo precisa do seu próprio agente.

### Buffer, os cinco nós

```
① redis  operation: "push", tail: true
   list:  ={{ 'buffer:' + $json.metadata.phone_number_id + ':' + $json.message.from }}
   messageData: ={{ JSON.stringify({ type: $json.message?.type ?? 'text',
                                     content: $json.message?.text?.body
                                           ?? $json.message?.audio?.id
                                           ?? $json.message?.image?.id ?? '',
                                     timestamp: $json.message?.timestamp }) }}

② code   const ts = Date.now().toString();
         return $input.all().map(i => ({ json: { ...i.json, _buffer_ts: ts } }));

③ redis  operation: "set", expire: true, ttl: 120
   key:   ={{ 'buffer_ts:' + $json.metadata.phone_number_id + ':' + $json.message.from }}
   value: ={{ $json._buffer_ts }}

④ wait   amount: 15   (segundos)

⑤ redis  operation: "get"   (mesma chave do ③)
   if     ={{ $json.propertyName }} == ={{ $('buffer_set_ts').first().json._buffer_ts }}
          igual  → segue: lê a lista, consolida, apaga a lista
          diferente → noOp. Chegou mensagem depois; a execução nova responde.
```

O `redis` `operation: "get"` devolve o valor no campo **`propertyName`** — não é um nome bonito, é o
que o nó faz, e ler `$json.value` aqui devolve `undefined` sem erro nenhum.

### Lock

```
GET  processing:{{ telefone }}        → onError: continueRegularOutput
code lock_ativo = valor não vazio
if   lock_ativo == false              → segue; senão noOp
SET  processing:{{ telefone }} = {{ $executionId }}   expire: true, ttl: 30
…
DEL  processing:{{ telefone }}        → onError: continueRegularOutput
```

### O esqueleto de persistência

Três tabelas são o mínimo. Os nomes são do agente em produção; adapte ao caso, mas mantenha a forma.

| Tabela | Papel | Campos que importam |
|---|---|---|
| `leads` | uma linha por pessoa, o estado dela | `phone`, `name`, `status`, `conversation_stage`, `human_takeover`, `lead_map` |
| `messages` | toda mensagem, nas duas direções | `phone`, `direction`, `content`, `media_type`, `wamid`, `media_url` |
| `agent_decisions` | a auditoria de cada resposta | `phone`, `message_in`, `final_messages`, `tools_used`, `conversation_stage`, `approved`, `attempts` |

Mais duas quando o caso pede: `vacuum` (`phone`, `attempt`, `status`, `execution_id`) para follow-up,
e `attention_alerts` (`lead_phone`, `trigger_type`, `severity`, `detected_by`, `reason`) para
escalonamento.

Chaves Redis, todas com TTL menos a memória:

```
processing:{telefone}                 lock, TTL 30s
buffer:{numero}:{lead}                lista de mensagens do buffer
buffer_ts:{numero}:{lead}             timestamp do debounce, TTL 120s
memoria:{telefone}                    memória do chat (gerida pelo nó de memória)
cache:{recurso}                       base de conhecimento, TTL 1h
```

### O system prompt: a forma

Um agente comercial real desta instância tem **71.705 caracteres** de system prompt, em **11 seções
numeradas** (0 a 10) mais um bloco de produto e um de contexto dinâmico. O Tester **não escreve isso** e
não deve tentar — o que ele entrega é o **esqueleto com as seções nomeadas e o conteúdo que a entrevista
revelou**, deixando marcado o que o Kauan preenche:

```
SEÇÃO 0 — IDENTIDADE E REGRAS ABSOLUTAS
  quem é, o que nunca faz, formato de saída, regras de data
SEÇÃO 1 — CICLO DE PENSAMENTO
  pensar → planejar → agir → validar antes de enviar
SEÇÃO 2 — PERFIL DE QUEM ESTÁ FALANDO
  como detectar e como adaptar o tom
SEÇÃO 3 — TOOLS E QUANDO USAR CADA UMA
SEÇÃO 4 — A VOZ
  como escreve, exemplos de conversa real, o que é proibido dizer
SEÇÃO 5 — O ROTEIRO
  as etapas, e o que fazer em cada uma
SEÇÃO 6 — ESTADO / CRM
  quando muda de status
SEÇÃO 7 — REGRAS DE NEGÓCIO
SEÇÃO 8 — OBJEÇÕES
SEÇÃO 9 — CASOS ESPECIAIS
  pediu humano, já comprou, perguntou se é robô, mandou áudio
SEÇÃO 10 — LEMBRETE DO FORMATO DE SAÍDA
  campo por campo do schema, com quando cada um é true
CONTEXTO DINÂMICO   ← {{ expressão }} que injeta o estado desta conversa
```

**Exemplos de conversa real valem mais que adjetivos.** A seção 4 do agente em produção tem nove
situações com o diálogo escrito por extenso. É o que faz o modelo acertar o tom, e é a parte que a
pergunta 10 da entrevista existe para colher.

<!-- /BLOCO -->
---
<!-- BLOCO: armadilhas -->

## Armadilhas medidas

Cada uma custou debugging real nesta instância.

**A porta `ai_*` não é `main`.** Ligar o modelo ao agente por `main` faz o fluxo importar sem erro e o
agente não ter modelo. O n8n não reclama.

**`hasOutputParser: true` é separado de conectar o parser.** Sem a flag, o parser está lá, está
conectado, e é ignorado.

**Chave de memória fixa mistura todos os leads.** Funciona perfeitamente com um lead de teste. Em
produção o agente responde à pessoa errada com o contexto de outra.

**Lock sem TTL trava o lead para sempre.** Uma execução que morre no meio deixa a chave lá. TTL de
30s é o que garante que o pior caso é 30 segundos de espera, não silêncio permanente.

**Três tipos de nó terminam em "webhook", e são coisas diferentes.** O trigger (`webhook`) recebe; o
`respondToWebhook` responde. Contar o segundo como início produz "2 nós de início" num fluxo
perfeitamente válido.

**Recibo de leitura vira loop.** O `statuses` do próprio envio chega no mesmo webhook. Sem filtrar
`eventType`, o agente responde ao recibo da mensagem que ele mandou, gerando outro recibo.

**Id de mídia no texto do prompt.** O buffer guarda o id do áudio como conteúdo; se ele entrar no
texto consolidado, o modelo tenta interpretar um número de 16 dígitos. Marcador legível, sempre.

**O nó `redis` `get` devolve em `propertyName`, e ler `$json.value` mata camadas em silêncio.** Esta é
a armadilha mais cara da lista, porque não há erro nenhum e o fluxo continua verde. Verificado na
execução `#176997`, um `success`: os cinco nós de `redis get` daquele fluxo devolveram um objeto cuja
**única chave é `propertyName`** — `value` não existe. E dois nós do agente leem `value`:

- `Code_verificar_lock` faz `redisData.value !== undefined` para saber se já existe lock. Como `value`
  nunca existe, `lock_ativo` é **sempre `false`** — medido: `false` naquela execução. **O lock não
  protege contra nada**: duas mensagens simultâneas do mesmo contato passam as duas.
- `parse_conv_summary` faz `$input.first().json.value` para carregar o resumo da conversa. Medido:
  `has_summary: false` e `conversation_summary: null`. A camada ④ inteira — o histórico estruturado que
  impede o agente de repetir argumento e de pedir dado que já tem — **nunca carrega**.

No mesmo fluxo, `If_ts_match` (o buffer) compara `$json.propertyName` e funciona. Ou seja: o fluxo
contém as duas leituras, uma certa e uma errada, e só a errada é silenciosa. **Sempre `propertyName`.**

**Áudio para WhatsApp precisa de `mimeType` e extensão setados à mão.** O que sai do TTS não vem com
`audio/ogg; codecs=opus` nem com `.ogg`, e o envio falha ou chega como arquivo.

**Link dentro de texto que vai para TTS.** A voz lê a URL em voz alta. O humanizador tem que trocar o
link por uma frase e o texto ir por outro canal.

**`Set` cheio de JavaScript não é `Set`.** Preferir `Set` a `Code` só ajuda se as expressões forem
simples de verdade. Um `Set` com `.map().join()` dentro tem o mesmo efeito de um `Code` e ainda
parece simples.

**Sticky note é nó.** Conta no total, aparece na contagem, e não conecta em nada. Os gates do Tester
já a isentam; um gerador que a trate como nó executável reprova o próprio fluxo.

**Duas mensagens no mesmo segundo chegam como bloco.** A pausa entre bolhas não é enfeite: sem ela, o
array de bolhas chega no WhatsApp como uma parede.

**Persistência que derruba a resposta.** Um `insert` que falha depois do envio não é erro do fluxo.
`onError: continueRegularOutput` em tudo que grava; `retryOnFail` em tudo que chama modelo ou API.

### As sete que um agente desta instância provou, e custaram o fluxo inteiro

Um dos agentes daqui está **inativo com o caminho de envio desconectado do agente**. Cada item abaixo
foi medido nele. Não são hipóteses.

**Uma expressão que termina em quebra de linha carrega o `\n` no valor.** O campo `evento-tipo` é
montado por um ternário cujo `}}` é seguido de `\n`, então o valor é `"texto\n"` — e **os quatro
switches que leem esse campo comparam contra `'texto\n'`** para funcionar. O sintoma quando alguém
"corrige" a comparação é o fluxo parar de rotear. Compare sempre com `.trim()`, ou não deixe a
expressão terminar em quebra de linha.

**Renomear um nó pela metade quebra `$('Nome')` em silêncio.** O fluxo referencia `$('Webhook1')` em
**13 lugares** e o único nó de webhook chama-se `Webhook`. Não existe erro de importação, não existe
aviso: as 13 expressões resolvem para nada. Se você renomear um nó, o nome antigo tem que morrer em
todas as expressões no mesmo passo.

**Chave de sessão constante no agente auxiliar.** O agente que humaniza texto para áudio usa
`sessionKey: "eleven-labs"` — literal, sem expressão. **Todos os contatos compartilham essa janela de
memória.** O agente principal está certo e o auxiliar está errado, no mesmo fluxo: um agente auxiliar
geralmente não precisa de memória nenhuma, e quando precisa, a chave é do contato como qualquer outra.

**Dois contratos de saída no mesmo agente.** O system prompt manda responder
`["Mensagem 1","Mensagem 2"]` — um array puro — e o parser exige `{messages:[…]}` com cinco campos
obrigatórios. O prompt e o schema são dois documentos e ninguém os compara. **Se você escrever um
schema, o prompt tem que descrever exatamente aquele schema.**

**Enums que não se encontram.** O parser aceita `perfil_comportamental` em
`tubarao|aguia|lobo|gato|neutro`; a tool que detecta o perfil devolve `Shark|Eagle|Wolf|Cat`. Os dois
lados funcionam isolados e o campo nunca casa. Vocabulário de enum é contrato: um idioma, uma grafia.

**O prompt cita tools que não existem.** Medido nos dois agentes: um prompt menciona `resumo_lead` oito
vezes e `buscar_cupom_lote` seis, e nenhuma das duas está ligada ao agente; outro cita `base_sdr` e
`agendado`, que não existem como nó. O modelo tenta chamar, não encontra, e improvisa. **A lista de
tools no prompt tem que ser gerada da lista de nós, nunca escrita à mão.**

**Um `toolWorkflow` mapeado errado executa `success` para sempre.** A tool que deveria salvar o resumo
da conversa mapeia `"telefone": 0` — o literal zero, não uma expressão — e **não mapeia o campo
`resumo`**. O sub-workflow grava em `roberto:conv:undefined:summary`. As cinco execuções mais recentes
estão todas verdes, e o prompt do agente diz que chamá-la é *"OBRIGATÓRIO ao final de CADA interação"*.
**Nada nesta plataforma avisa que uma tool recebeu nada.** Ao escrever uma tool, confira que cada campo
que o sub-workflow lê está mapeado no pai.

<!-- /BLOCO -->
---

## O que o Tester não consegue fazer, e diz

Honestidade sobre os limites, porque um fluxo entregue com promessa falsa é pior que um fluxo
recusado.

**O fantasma não simula um agente, e não deve fingir que simula.** O `simulate.js` resolve expressões
por código; a resposta de um agente vem de um modelo. Além disso, um agente é feito exatamente dos
tipos que o simulador recusa por princípio: `code`, `merge`, `switch`. Então a etapa 6 de um build de
agente **recusa, e o motivo certo é "a resposta vem de um modelo, e eu não invento o que ele diria"**
— não "expressão fora do subconjunto". O que dá para mostrar é a **forma** do envio: quantas bolhas,
para que número, por qual canal.

**O system prompt sai como esqueleto, não pronto.** Nove seções com o que a entrevista revelou e o
resto marcado. Um agente comercial de verdade tem 70k caracteres de prompt afinados em meses de
conversa real; entregar 2k e dizer que está pronto seria mentira.

**As tools saem declaradas, não implementadas.** Cada tool é um sub-workflow separado, e o Tester
constrói **um** workflow por build. O fluxo sai com os nós de tool apontando para ids que o Kauan
preenche, e a lista do que precisa ser construído fica no relatório.

**O sandbox prova que o n8n aceita o JSON, não que o agente funciona.** É o que sempre foi, e num
agente a distância entre as duas coisas é maior: nenhuma credencial está anexada, nada executou, e a
primeira conversa real é o primeiro teste de verdade.

## De onde isto saiu

Fluxos desta instância, lidos em 2026-08-10. **A coluna de estado importa:** metade destes fluxos está
inativa, e um deles está quebrado de um jeito que o torna referência do que *não* fazer.

| Fluxo | Nós | Estado | O que ele ensina |
|---|---|---|---|
| `[ROBERTO] Agent — Iago Comercial (TESTER)` | 197 | **ativo** | **A referência.** As sete camadas completas, o loop de revisão, o follow-up de três tempos, os dois ramos de saída, o alerta de duas fontes |
| `Agente Iago Comercial` | 189 | inativo | A versão anterior do mesmo |
| `WhatsApp API Oficial` | 31 | **ativo** | A porta de entrada: achatamento, triagem dos 16 tipos (3 ligados), o buffer por timestamp, o roteamento por número |
| `WhatsApp API Oficial Gabi` | 27 | inativo | A mesma porta, do segundo número. Buffer correto; a chave `lock:` é escrita e nunca lida — não é lock, é decoração |
| `Gabi 2.0 [teste]` | 144 | inativo | **O que não fazer.** Ver abaixo |
| `Gabi 2.0 [teste]` | 153 | inativo | A versão de março da mesma, com as expressões íntegras e o cache de tool que a nova perdeu |
| `[ROBERTO] Tool - *`, `[ECONTRATE] Tool - *` | 2 a 22 | 2 de 13 ativos | A anatomia de uma tool: `executeWorkflowTrigger`, entradas declaradas, retorno como `{resultado: markdown}` |

**Sobre a Gabi, com evidência.** Ela foi indicada como referência ao lado do Iago, e não é — não porque
o desenho seja ruim (o desenho é bom: buffer, filtro de mídia, dois agentes, TTS, vácuo, métricas), mas
porque **o caminho de envio não está ligado ao agente**. `tokens e output`, que abre toda a seção de
envio, não tem conexão de entrada; o agente termina em `Insert row` e num `Code` sem saída. O vácuo, as
métricas de entrada e o classificador de encerramento são ilhas órfãs — o classificador roda, paga o
token e o resultado é descartado. Somando as sete armadilhas da seção anterior, o que a Gabi ensina é
**como um agente bem desenhado morre**: nome de nó renomeado pela metade, `\n` grudado numa expressão,
enum que não casa, prompt citando tool inexistente, tool recebendo zero.

O que **só** a Gabi ensina, e vale copiar: a normalização de telefone brasileiro (camada ②), o
enforcement de tool por cache Redis com TTL, e o perfil de comunicação detectado por código puro sem
chamada de API.

**Duas credenciais em texto plano.** Os fluxos da Gabi carregam instance id, token e `Client-Token` do
Z-API dentro dos parâmetros de quatro nós `httpRequest`, e a porta do segundo número tem o
`hub.verify_token` da Meta literal dentro de um `if`. Isso não passa pelo cofre de credenciais do n8n,
**viaja em qualquer cópia ou exportação do fluxo**, e é o motivo de o Tester nunca escrever valor de
parâmetro sensível: um fluxo gerado aqui usa credencial anexada no editor, sempre.

**Duas arquiteturas, e a diferença importa.** Em produção o Kauan tem **dois** fluxos: a porta
(`WhatsApp API Oficial`, com triagem e buffer, compartilhada entre os agentes) chamando o agente por
`executeWorkflow`. Isso é o certo quando existe mais de um agente no mesmo número, e é o motivo de a
falha de um agente aparecer na execução da porta.

O Tester constrói **um** fluxo por build, com a porta embutida. É auto-contido e importa funcionando —
mas quando o agente for para um número que já tem porta, o caminho é **tirar as camadas ① a ③ e
transformar o resto num sub-workflow**, adicionando uma rota no `switch` da porta existente.

**Isso não é detectado automaticamente**, e não finja que é: o número chega como texto livre numa
resposta da entrevista, e o Tester não cruza esse texto com os fluxos da instância. O que existe é a
primeira pergunta da entrevista — *"esse número já é usado por outro agente ou fluxo aqui?"* — e a
obrigação de o `report.md` dizer quais das sete camadas foram montadas. Com as duas coisas, quem lê o
relatório sabe o que precisa desmontar. Sem uma checagem real, afirmar mais que isso seria inventar.
