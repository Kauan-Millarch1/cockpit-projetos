# Instalar o Cockpit

Quatro passos. **Um deles não pode ser automatizado** — a chave da API do n8n sai da sua
conta, e nenhum agente cria isso por você. Os outros três um agente faz sozinho.

Cada passo abaixo diz **como saber que deu certo** e **qual é o sintoma quando falha**, porque
o modo de falhar é sempre mais útil que o passo em si.

---

## Antes de começar

| precisa | por quê | como conferir |
|---|---|---|
| **Node 22 ou mais novo** | `package.json` declara `engines: ">=22"`. Não há dependência para instalar — não rode `npm install`, não há o que baixar. | `node --version` |
| **Claude Code CLI** (opcional) | Sem ele o cockpit **funciona**, mas a correção automática, o Tester e o Upgrade degradam — e **dizem por quê** na tela, nunca fingem que rodaram. | `claude --version` |
| **Uma instância n8n** | É o que o painel lê. Cloud ou self-hosted, tanto faz. | você já tem, ou não precisa do painel de fluxos |

Windows, mac e Linux rodam. A única coisa **só de Windows** é o botão *"abrir a pasta"* da aba
Disco (usa `explorer.exe`); num mac aquele botão falha e o resto da tela funciona igual.

---

## 1. Clonar — num caminho curto

```bash
git clone https://github.com/Kauan-Millarch1/cockpit-projetos.git
cd cockpit-projetos
```

**Caminho curto importa.** O arquivo com o nome mais longo do repositório tem 86 caracteres e o
Windows corta em 260, então uma pasta muito funda faz o clone terminar em
`fatal: unable to checkout working tree` — **medido**, num destino de 170 caracteres.
`C:\Projects\cockpit-projetos` está folgado.

O pior desse erro é que o git diz **"Clone succeeded"** na mesma respiração: os arquivos
aparecem pela metade e `git ls-files` responde `0`, o que não se parece nada com problema de
caminho. Se acontecer: `git config --global core.longpaths true` e clone de novo.

**Deu certo se:** `git ls-files | wc -l` responde **219**, e `git status` diz limpo.

> O download tem ~130MB porque os três vídeos de tutorial vêm versionados. É de propósito —
> sem eles o botão "assistir a introdução" existiria sem vídeo.

---

## 2. Onde a pasta fica muda uma tela

A aba **Disco** varre a pasta **irmã** do cockpit. Clonado em `C:\Projects\cockpit-projetos`,
ela varre `C:\Projects` e lista os projetos que estão lá. Solto na Área de Trabalho, ela varre a
Área de Trabalho.

As outras três abas não dependem disso. Se você não usa a Disco, ignore.

---

## 3. O `.env` — e o passo que é seu

```bash
cp .env.example .env
```

Abra o `.env` e preencha as **duas** primeiras:

```ini
N8N_BASE_URL=https://sua-instancia.app.n8n.cloud
N8N_API_KEY=<a chave>
```

**A chave sai da sua instância n8n:** Settings → **n8n API** → *Create an API key*. É a API
**pública** do n8n, não a senha da conta.

Ela nunca sai da sua máquina: nenhuma rota do cockpit a serve, e o processo filho que roda o
Claude tem `N8N_API_KEY` numa lista de **negação** — ele não a vê.

O `.env.example` é a lista completa das outras **19** variáveis, todas opcionais, com o padrão de
cada uma **lido do código** e o motivo de cada decisão. Não precisa tocar em nenhuma para
começar. (São 21 no total, e o código lê exatamente 21 — a paridade é conferida nas duas
direções: nenhuma variável real fica de fora do arquivo, e o arquivo não documenta nome que o
código não lê.)

**Deu certo se:** o passo 4 imprime a URL da sua instância em vez de `n8n: NÃO configurado`.

---

## 4. Subir

```bash
npm start
```

ou `node server.js`, ou duplo clique em **`start-cockpit.cmd`** (esse confere o Node, avisa se
falta o `.env` e abre o navegador). `npm run dev` também existe, e é **apelido** de `start` —
não é modo watch, de propósito: uma construção do Tester leva minutos e um reinício no
`Ctrl+S` mataria o trabalho no meio.

Abre em **http://localhost:4317**, só em `127.0.0.1`.

O boot diz o estado em voz alta, e é aqui que você confere tudo de uma vez:

```
Cockpit em http://localhost:4317
Raiz: C:\Projects
n8n: https://sua-instancia.app.n8n.cloud — poll a cada 20s
```

| o que aparece | o que significa |
|---|---|
| `n8n: <sua url> — poll a cada 20s` | passos 3 e 4 certos. Está no ar. |
| `n8n: NÃO configurado (falta .env com N8N_BASE_URL e N8N_API_KEY)` | o `.env` não foi lido ou está incompleto. A aba Fluxos mostra um erro honesto; `/disco` funciona. |

**O estado do CLI do Claude não aparece no boot, de propósito** — ele só importa no clique. Quem
responde é a tela, em `/api/claude/status`, e a aba diz se encontrou ou não. Se o executável
estiver fora do lugar padrão, aponte com `CLAUDE_BIN=<caminho absoluto>` no `.env`.

> **Não suba o servidor como tarefa de fundo de um agente.** Esses processos morrem quando o
> harness os recolhe, e o cockpit cai no meio da sessão. Use um terminal de verdade ou o `.cmd`.

---

## As quatro abas

| aba | rota | o que ela responde |
|---|---|---|
| **Fluxos** | `/` | o que rodou nas últimas 24h, o que falhou e em qual nó — com replay da execução sobre o grafo real |
| **Tester** | `/tester` | "como construo o fluxo que está na minha cabeça?" Você descreve em português e sai o JSON |
| **Upgrade** | `/upgrade` | "como mexo num fluxo que já existe?" Conversa sobre um fluxo vivo e termina num diff |
| **Disco** | `/disco` | a varredura dos projetos em disco: o que está vivo e o que está apodrecendo |

Não há login e não há tela de configuração — o cockpit é de uma pessoa, na máquina dela.

---

## Opcional: o portão de parâmetro

Duas coisas ficam fora do git porque são **derivadas e regeneráveis por comando**. Sem elas o
Cockpit funciona; o que muda é que o Tester roda **sem conferir o schema dos nós**, e duas
baterias de teste se declaram `PULADA` em vez de passar caladas.

```bash
node esquema.js --baixar      # minutos: ~26 mil arquivos para descompactar
node esquema.js --construir   # gera .cache-esquema.json (~9,5MB)
node catalog.js --refresh     # precisa do .env com a chave: lê os SEUS fluxos
```

---

## Testes

```bash
testar.cmd            # duplo clique no Windows
cmd /c .\testar.cmd   # pela linha de comando: o `.\` é obrigatório
```

59 invocações, **nenhuma custa nada** — nenhuma chama modelo, toca a rede ou gasta cota. Ele
fecha em **três** estados, e o do meio existe porque dizer "tudo passou" sobre bateria que não
rodou é a única saída errada:

- `RESULTADO: tudo passou`
- `RESULTADO: passou, COM PULOS` — falta estado por checkout (a seção acima); role para cima e a
  linha `PULADA` diz qual arquivo e qual comando o cria
- `RESULTADO: alguma coisa falhou`

Termina com `pause`, então espera uma tecla no fim. Não é travamento.

---

## Quanto custa usar

**Nada de cartão.** O que o Tester, o Upgrade e a correção consomem sai da **cota do plano** do
seu login do Claude Code — `ANTHROPIC_API_KEY` está numa lista de negação, então o processo filho
não a vê nem se ela existir no ambiente.

Medido em construções reais: um fluxo de notificação sai por **~US$1 em ~3 minutos**; um agente
conversacional de 65 nós, por **US$3,19 em 13,6 minutos**.

---

## O que ele escreve no seu n8n

Leia antes de clicar em qualquer coisa verde. **Duas coisas saem da sua máquina, e uma não tem
desfazer.**

- **Escreve num fluxo de verdade em um caminho só:** um diff que passou por todos os portões,
  **renderizado na tela antes do clique**, aprovado por você, com backup antes e **↺ Desfazer**
  depois.
- **Reexecuta a execução que falhou — e isso manda mensagem real, sem desfazer.** Existe porque
  consertar o nó não responde a quem já estava esperando na execução quebrada. A tela classifica
  o caso e **falha fechado**: erro que ela não reconhece é tratado como ambíguo, nunca como
  limpo.
- **A rodada do patch grava uma cópia inativa** `[SANDBOX upgrade]`, sem credencial e que não
  executa, para o n8n dizer se aceita o schema. É a única escrita antes de qualquer aprovação, e
  vem ligada por padrão (`COCKPIT_UPGRADE_SANDBOX=0` desliga).
- **Não aplica nada sozinho.** Sem auto-aplicar, sem "aplicar todos", sem correção agendada, e
  sem apagar nada.

---

## Se algo der errado

| sintoma | causa provável |
|---|---|
| `Missing script: "dev"` ou `"start"` | você está fora da pasta do clone |
| Uma rota que existe no código responde **404** | o Node **não recarrega** o `server.js`. Feche a janela e abra de novo — o processo velho segue servindo as rotas velhas |
| `fatal: unable to checkout working tree` no clone | caminho longo demais (passo 1) |
| A aba Fluxos vazia com o boot dizendo `NÃO configurado` | `.env` (passo 3) |
| Tester/Upgrade dizendo que não encontraram o CLI | Claude Code não instalado, ou fora do lugar padrão — use `CLAUDE_BIN` |

O `README.md` explica **o que** cada aba faz e por quê. O `CLAUDE.md` é a memória do projeto:
cada decisão, cada armadilha medida e o motivo de cada invariante — é o arquivo para ler antes de
mexer em qualquer coisa.
