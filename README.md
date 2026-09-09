# Cockpit

Painel local para os fluxos n8n. Ele responde as perguntas que o editor do n8n não
responde: **o que está rodando, o que quebrou e onde — como construir o próximo, e como
mexer num que já existe.**

Roda em `127.0.0.1`, com Node 22 e **zero dependências**. A chave da API nunca sai da
máquina.

![O painel de fluxos ao vivo](docs/img/porta-fluxos.png)

---

## Instalar

Node 22 ou mais novo, e nada além disso — não há `npm install` porque não há dependência.

```bash
git clone https://github.com/Ecommerce-Puro/cockpit-n8n.git
cd cockpit-n8n
cp .env.example .env      # e preencha N8N_BASE_URL e N8N_API_KEY
```

Depois, duplo clique em **`start-cockpit.cmd`** — ele confere o Node, avisa se falta o
`.env` e abre o navegador. Pela linha de comando, qualquer um destes:

```bash
node server.js        # o caminho direto
npm start             # o mesmo, com npm no meio
npm run dev           # apelido de `start`, e NÃO é modo watch
```

**`dev` é apelido de propósito, e não `node --watch`.** A mão vai primeiro em `npm run
dev`, então o script existe para não devolver `Missing script: "dev"` — mas ele não
reinicia sozinho ao salvar arquivo, e isso é uma decisão: uma construção do Tester leva
minutos e uma conversa do Upgrade leva rodadas de modelo pagas, então um `--watch` mataria
o trabalho em voo no meio no primeiro `Ctrl+S`. O preço é o que o aviso mais abaixo diz —
**o Node não recarrega o `server.js`**: depois de editá-lo, feche a janela e abra de novo,
senão o processo velho segue servindo as rotas velhas e o único sintoma é um 404 no que
você acabou de escrever.

**Clone num caminho curto.** O caminho mais longo do repositório tem 86 caracteres e o
Windows corta em 260, então uma pasta muito funda faz o `git clone` terminar em
`fatal: unable to checkout working tree` — **medido**, num destino de 170 caracteres.
`C:\Projects\cockpit-n8n` está folgado; `C:\Users\voce\...\Temp\...\algo\muito\fundo` não.
Se acontecer, `git config --global core.longpaths true` e clone de novo.

**Onde a pasta fica importa para uma tela só.** `/disco` varre a pasta **irmã** do
cockpit — clonado em `C:\Projects\cockpit-n8n`, a varredura é de `C:\Projects`. Solto na
Área de Trabalho, `/disco` mostra a Área de Trabalho. As outras portas não dependem de
onde ele está.

O `.env` é **opcional para o servidor subir**: sem ele `/disco` funciona e o painel de
fluxos mostra um estado de erro honesto. O boot diz em voz alta se o n8n está
configurado, em vez de deixar a ausência parecer defeito; o estado do CLI do Claude é a
tela que responde, em `/api/claude/status`, porque ele só importa no clique.

---

## As portas

| Porta | Rota | O que ela responde |
|---|---|---|
| **Fluxos** | `/` | O que rodou nas últimas 24h, o que falhou e em qual nó — com replay da execução sobre o grafo real do fluxo. |
| **Tester** | `/tester` | "Como construo o fluxo que está na minha cabeça?" Você descreve em português; ele entrevista, desenha, valida e devolve o JSON. |
| **Upgrade** | `/upgrade` | "Como mexo num fluxo que já existe?" Conversa sobre um fluxo vivo, resolve em qual workflow o nó realmente mora, e termina num diff. |
| **Disco** | `/disco` | A varredura em disco de todos os projetos: o que está vivo e o que está apodrecendo. |

**Quatro portas, e não há login.** O cockpit é de uma pessoa, na máquina dela, em
`127.0.0.1` — quem tem o computador já alcança tudo por fora do navegador, então uma
tela de sessão fecharia a porta da frente e não a casa. A camada de login, aprovação e
cofre de chave por tela existiu até 09/09/2026 e saiu inteira; o motivo, o inventário e
como voltar estão em [`docs/removido-produtizacao/`](docs/removido-produtizacao/).

O que **não** saiu é o `guarda.js`, e ele não é login: é quem classifica de onde veio a
requisição, e é o que protege o único clique que escreve em fluxo de produção de ser
disparado por outro site.

### Fluxos — do erro até o diff

O quadro agrupa as falhas por assinatura (`fluxo · nó · tipo de erro`). Cada uma pode ser
marcada como corrigida com uma nota do que foi mexido — e **volta sozinha** se o mesmo
erro acontecer de novo, comparado por id de execução, nunca por relógio.

**"⧉ Mandar pro Claude"** não para na área de transferência: o cockpit relê o fluxo e a
execução que falhou, roda o **Claude Code CLI local** em modo headless sobre o fluxo com
defeito, e o que chega na tela é uma **revisão de pull request** — os veredictos dos
portões determinísticos, o diagnóstico, e o diff nó a nó. Se um portão reprova, a mensagem
dele volta para o Claude e ele tenta de novo, até 4 rodadas. **Uma proposta que nunca passa
nunca vira botão.**

O único clique deste repositório que escreve num fluxo de verdade é o **"✓ Aprovar e
aplicar"** — e ele escreve exatamente o diff que estava na tela, com backup antes e
**↺ Desfazer** depois.

### Tester — de uma frase até o JSON

![O Tester](docs/img/porta-tester.png)

Sete etapas, parando em dois lugares: depois de entender (confirmar a intenção é o
checkpoint mais barato que existe) e no **fantasma** — a simulação do que o fluxo enviaria,
desenhada na anatomia do destino: uma bolha do Slack, uma bolha do WhatsApp, uma linha de
tabela.

O fantasma é **derivado, nunca narrado**: `simulate.js` resolve as próprias expressões do
fluxo contra uma entrada semeada, sem `eval`. Fora do subconjunto que ele sabe avaliar, ele
**recusa em voz alta** em vez de desenhar meio quadro.

Medido em construções reais: um fluxo de notificação sai por **~US$1 em ~3 minutos**; um
agente conversacional de 65 nós, por **US$3,19 em 13,6 minutos** — portões passando na
primeira rodada nos dois casos.

---

## Configurar

**`.env.example` é a lista completa**, com o padrão de cada variável lido do código e o
motivo de cada decisão. Duas listas divergem na primeira mudança feita de um lado só, e a
que divergisse seria esta — então aqui ficam só as duas que decidem se o produto tem
razão de existir:

```ini
N8N_BASE_URL=https://sua-instancia.app.n8n.cloud
N8N_API_KEY=<chave da API pública>
```

A chave sai de **Settings → n8n API → Create an API key** na sua instância. Ela nunca sai
desta máquina: nenhuma rota a serve, e o processo filho que roda o Claude tem
`N8N_API_KEY` numa lista de **negação** — ele não a vê.

**Ela vem do `.env`, e só.** `n8n.js` lê `.env` e `.env.local` deste diretório, e o
arquivo **vence** `process.env` — a ordem é declarada em `ORDEM_DA_CHAVE` e viaja em
`estadoChave()`, nunca fica implícita. A releitura é memoizada por mtime e tamanho, não
por TTL: editar o `.env` e recarregar a página basta, e um TTL faria a tela dizer "não
configurado" por alguns segundos **depois** de a chave entrar.

Essa camada responde "existe chave configurada?" e "de onde ela veio?". Ela **não**
responde se a chave vale — quem diz isso é o n8n, com um 401, e as duas perguntas mandam
você para lugares diferentes.

Sem o CLI do Claude, a correção degrada para a cópia manual do briefing — **e diz por
quê**, nunca finge que uma sessão rodou.

> **Não suba o servidor como tarefa de fundo do Claude Code.** Esses processos morrem quando
> o harness os recolhe, e o cockpit cai no meio da sessão.

### Estado por checkout: três coisas que o git não traz

Todas são **derivadas e regeneráveis por comando**, então ficam fora do git de propósito.
Um clone novo funciona sem elas — o que muda é que dois portões não rodam, e o produto diz
isso em vez de fingir.

```bash
node esquema.js --baixar      # minutos: ~26 mil arquivos para descompactar
node esquema.js --construir   # gera .cache-esquema.json (~9,5MB)
node catalog.js --refresh     # gera .cache-catalog.json, lendo os fluxos da sua instância
```

| falta | consequência |
|---|---|
| `.n8n-pkgs/` + `.cache-esquema.json` | o Tester roda **sem o portão de parâmetro**. `/api/tester/status` responde em três estados (não baixado / não destilado / pronto), porque "não baixei os pacotes" e "esse nó não existe" levam a decisões opostas. |
| `.cache-catalog.json` | duas baterias de teste se declaram **PULADAS** (elas montam o pior caso a partir do catálogo). Precisa do `.env` com a chave, porque ele é destilado dos seus fluxos. |
| `.video/` | uma asserção de `tutorial-test.js` fica **PULADA**. É o pipeline de vídeo, binário e regenerável a partir do roteiro. |

**Pulo não é verde.** O `testar.cmd` fecha em três estados — passou, passou COM PULOS, ou
falhou — porque dizer "tudo passou" sobre uma bateria que não rodou é a única saída
realmente errada aqui.

## Testes

```bash
testar.cmd            # duplo clique: 59 invocações, nenhuma custa nada
```

**Medido em 09/09/2026:** 59 invocações — os **58** arquivos `*-test.js` do disco, todos
eles, e são os mesmos 58 rastreados no git, mais `simulate.js`, que roda como
demonstração e não como teste. Nenhum chama modelo, toca a rede ou gasta cota.
`tester-smoke.js` fica de fora de propósito: esse conduz uma construção inteira e cobra
do plano. Sete baterias saíram com a camada de login em 09/09/2026 — estão listadas, uma
linha cada, em [`docs/removido-produtizacao/`](docs/removido-produtizacao/).

Ele termina com `pause`, então rodar por script (em vez de duplo clique) precisa de stdin
fechado — e o `cmd` não acha um `.cmd` do diretório atual sem o `.\`:

```bash
cmd /c .\testar.cmd     # `cmd /c testar.cmd` responde "não é reconhecido", com o arquivo ali
```

Um teste individual é `node <arquivo>-test.js`. Cada um extrai as funções reais da página
ou do módulo **em tempo de execução** — reimplementar a decisão dentro do teste provaria a
cópia, não a tela.

---

## O invariante central

**`server.js` e `n8n.js` afirmam fatos. O HTML julga.** O servidor nunca decide que um
projeto ou um fluxo está doente, parado ou arriscado: ele reporta contagens, carimbos de
tempo, saída do git, status de execução e mensagens de erro. Toda banda, agrupamento e
frase de diagnóstico mora num bloco de julgamento marcado no topo do script da página.

É por isso que a definição de "saudável" — a parte que mais muda — não exige reiniciar nada.

**O segundo invariante: o que vem do n8n é hostil.** A API traz coisas que não podem chegar
ao navegador nem a um arquivo de cache: id e nome de credencial, chaves de sessão montadas
com telefone do lead, e o payload inteiro da execução, que aqui é conversa real de cliente.
Toda resposta passa por uma lista branca explícita — **campo que não está nomeada lá não
existe daqui para a frente.**

## O que ele escreve, e o que ele não faz

Leia esta seção antes de clicar em qualquer coisa verde. **Duas coisas aqui saem desta
máquina, e uma delas não tem desfazer.**

- **Escreve num fluxo de verdade em exatamente um caminho:** um diff que passou por todos
  os portões, **renderizado na tela antes do clique**, aprovado por você, para aquela
  proposta específica, com backup gravado antes e **↺ Desfazer** depois.
- **Reexecuta a execução que falhou — e isto manda mensagem real, sem desfazer.** O n8n
  *tem* `POST /executions/{id}/retry`, e ele retoma do nó que quebrou em vez de repetir o
  fluxo. Quem estava naquela execução é um lead esperando resposta, e é por isso que
  existe: consertar o nó não responde a quem já estava lá. Mas se o nó falhou **depois** de
  causar efeito (a mensagem saiu e o timeout foi na resposta), esse envio duplica. A tela
  classifica isso e **falha fechado**: erro que ela não reconhece é tratado como ambíguo,
  nunca como limpo, e aí o botão é separado e diz o motivo.
- **Não executa um fluxo do zero.** Aí a API pública realmente não tem endpoint — não é
  escolha de escopo.
- **Não altera código de projeto e não faz deploy.** `/disco` só lê.
- **Não guarda segredo nenhum.** A chave da API do n8n vem do `.env` e fica lá; não há
  cofre, não há tela para colá-la e nenhuma rota a devolve — nem truncada, porque um
  prefixo publicado deixa conferir um palpite e o painel viraria oráculo de credencial.
  Criar credencial continua sendo no n8n, e não só por segurança: **7 dos 16 tipos**
  usados na conta medida são OAuth, que não se resolve colando um valor.
- **Não anexa credencial que exija escolha.** Uma única candidata sem ambiguidade sai
  ligada no JSON exportado; com duas, ele pergunta em vez de chutar — chutar decidiria de
  qual conta a mensagem sai, e isso importa sem avisar.
- **Não aplica nada sozinho.** Sem auto-aplicar, sem "aplicar todos", sem correção agendada,
  sem reexecução sem diff aplicado na tela, e sem apagar nada.

---

## Mapa

| Arquivo | Papel |
|---|---|
| `server.js` | Servidor HTTP local, varredura de disco, SSE. **Só fatos.** |
| `n8n.js` | Cliente da API do n8n. **Fronteira de segurança**, e a fila de escrita que serializa todo `PUT` da instância. |
| `flows.html` · `cockpit.html` · `tester.html` · `upgrade.html` | As telas. **Todo o julgamento vive nelas**, num bloco marcado no topo de cada script. |
| `claude-fix.js` | Roda o Claude CLI headless, aplica o patch, roda os portões, monta o diff — e é dono da única sequência que escreve um fluxo aprovado. |
| `upgrade.js` · `dossie.js` | A conversa sobre um fluxo vivo que termina num diff; e o dossiê em prosa que substitui ler 291KB de JSON (**~81k tokens medidos** no maior fluxo). |
| `guarda.js` | A porta: origem, preflight e CORS em toda requisição. **Não é login** — é o que impede outro site de disparar o clique que escreve num fluxo de produção. Sem `.agente/pareamento.json` (a cerimônia que o escrevia saiu junto com o login), a lista de origens fica vazia e só cliente local entra, que é o desejado num painel de `127.0.0.1`. |
| `tutorial.js` · `tutoriais/` | O vídeo "como usar esta tela", servido às três páginas. Os `.mp4` **são versionados** de propósito; sem eles a tela cai num estado honesto e inútil. |
| `estatico.js` | Compressão por mtime e cabeçalhos. **Comprimir por requisição é PERDA no loopback** — medido: 7,6ms viraram 24,0ms. |
| `tester.js` · `simulate.js` · `agentes.js` | A máquina de etapas do Tester, o fantasma e o que só vale para agente. |
| `esquema.js` | A definição autoritativa dos nós, destilada dos pacotes npm: 810 tipos, com enum, default e aplicabilidade por versão. |
| `catalog.js` | O que esta instância aceita de verdade, destilado dos fluxos vivos. **Nenhum valor de parâmetro vai para o disco.** |
| `licoes.js` | A base que aprende com a rodada reprovada, a edição aceita e o erro em produção. |
| `novidades.js` | O changelog do n8n, lido uma vez por dia, com portões e sem retry. |
| `anexos.js` · `aba.js` | Anexos e ditado; o aviso que chega quando ninguém está olhando. |
| `n8n-gramatica.md` · `tester-agentes.md` | O conhecimento em prosa, lido em tempo de execução. Editar muda o que o Tester constrói — sem mexer em código. |
| `preview/gen-*.js` | Geradores de preview. O CSS é **extraído** da página, nunca copiado — um preview não pode divergir da tela. |
| `docs/n8n-kb/` | A cópia portátil da base de n8n, já em formato de skill do Claude Code. |

## Documentos

- **`CLAUDE.md`** — a memória do projeto: cada decisão, cada armadilha medida e o motivo de
  cada invariante. É o arquivo para ler antes de mexer em qualquer coisa.
- **`PLAN.md`** e **`PLAN-REVIEW-LOG.md`** — o desenho do Tester e as cinco rodadas de
  revisão adversarial que o endureceram.
- **`PLAN-UPGRADE.md`** e **`PLAN-UPGRADE-REVIEW-LOG.md`** — o desenho da aba Upgrade e a
  revisão adversarial dela.
- **`00-research.md`** — a pesquisa que produziu as regras de layout.
- **`PLAN-CONHECIMENTO.md`** — por que o catálogo não bastava e o que o esquema resolveu.
- **`docs/removido-produtizacao/`** — a camada de login, aprovação, cofre e pareamento
  que saiu em 09/09/2026: por que saiu, o inventário com o que cada arquivo fazia, as
  rotas que deixaram de existir, e como voltar pela tag `arquivo/produtizacao-20260909`.
  **Leia o aviso de segurança dele antes de restaurar qualquer coisa** — naquele ponto do
  histórico há segredo em texto puro e uma escalada a super admin aberta no banco
  hospedado.
- **`docs/n8n-kb/`** — a base de n8n em formato portátil, já como skill do Claude Code,
  para usar em outro projeto.
