# Histórico de conversas no `/upgrade` — três lugares possíveis

Fase de escolha de desenho. **Nada de produção foi tocado**: `upgrade.html`, `upgrade.js`,
`server.js`, `evidencia.js` e `dossie.js` estão como estavam. O que existe é `preview/gen-historico-preview.js`,
o `preview/historico.html` que ele escreve, e 17 PNG.

```
node preview/gen-historico-preview.js         # escreve o HTML
node preview/gen-historico-preview.js --png   # escreve o HTML e captura os PNG
```

O HTML abre com dois cliques. `?so=<painel>` isola um painel do tamanho da janela (é o que a captura
usa), `?theme=light|dark`, `?rec=1` liga o modo gravação, e `?layout=duas|pilha|foco` continua
valendo porque `LAYOUT` é extraído do arquivo real. Clicar numa linha troca a conversa aberta
daquele painel — é o que o `?c=` da URL vai fazer.

**O CSS e todo render que já existe são extraídos do `upgrade.html` na hora de gerar**, nunca
copiados: tokens, `.tela`, `faixaDossie`, `blocosConversa`, `faixaAlvo`, `bandaEstado`, `linhaCusto`,
`palco`, `telaFluxo` e as três funções de câmera. O desenho também não é maquete — são as
**posições reais dos 179 nós** do `Agente Iago Comercial`, lidas de `preview/canvas-n8n.html`
(189 nós lá, 10 deles sticky). Escrito à mão só o que não existe para extrair: a lista. Nenhuma
rota do cockpit é chamada, nem na geração nem na página.

## Olhe nesta ordem

| PNG | o que é |
|---|---|
| `historico-Z-hoje-escuro.png` | **a linha de base** — a tela de hoje, sem lista nenhuma |
| `historico-A-trilha-escuro.png` · `-claro` · `-vazio` · `-390` | opção A |
| `historico-B-faixa-escuro.png` · `-claro` · `-vazio` · `-390` · `-gravando` | opção B |
| `historico-C-gaveta-escuro.png` · `-claro` · `-fechada` · `-vazio` · `-390` · `-gravando` | opção C |
| `historico-Z-hoje-390.png` | a linha de base no telefone |

Os 17 PNG ficam só no disco: `*.png` está no `.gitignore` deste repositório, como os outros
prints de preview. Verificado num navegador de verdade: os 8 painéis juntos renderizam sem erro
de página, com os 8 palcos enquadrados, nenhum id repetido e nenhuma rolagem horizontal.

## O que custa cada uma, medido

Caixa de 1440×798 — que é a `.tela` numa janela de 1440×900, porque ela é
`calc(100vh - 58px - 44px)`. Números lidos no DOM pelo próprio gerador, não estimados.

| | caixa do desenho | Δ | rolagem da conversa | Δ | itens inteiros na vista | rolagem da lista |
|---|---|---|---|---|---|---|
| **hoje** | `818×508` | — | `563×236` | — | — | — |
| **A · trilha** | `695×508` | **−123px de largura** (−15,0% de área) | `478×202` | −85px de largura e −34 de altura (**−27,6%** de área) | 5 de 6 | vertical |
| **B · faixa** | `818×465` | **−43px de altura** (−8,5% de área) | `563×193` | −43px de altura (−18,2% de área) | 3 de 6 | **horizontal** |
| **C · gaveta** | `818×508` | **zero** | `563×236` | **zero** | 6 de 6 | nenhuma |

Duas coisas que só apareceram na medição:

- **A cobra duas vezes da conversa.** Perde 85px de largura, e por causa disso os blocos presos
  (alvo, confirma, compositor) embrulham mais alto e comem outros 34px da rolagem. O custo total na
  conversa é 27,6% da área, quase o dobro do que o desenho perde.
- **A régua de "largura rende mais que altura" do `CLAUDE.md` não se aplica aqui.** Ela vale para
  o desenho *cabendo inteiro* (razão 7,96 no Iago). Mas num fluxo desse tamanho a câmera abre em
  `ESC_NOME`, ou seja a caixa é uma **janela** — e numa janela os dois eixos valem o mesmo por pixel.
  A comparação honesta é por área, e é o que está na tabela.

Em 390px, com todos os painéis medidos lado a lado:

| | caixa do desenho | rolagem da conversa | rolagem horizontal da página |
|---|---|---|---|
| **hoje** | `201×221` | `138×104` | não |
| **A** | `201×174` | `138×104` | não |
| **B** | `201×178` | `138×104` | não |
| **C** | `201×221` | `138×104` | não |

A conversa tem **138px de largura em todas** — inclusive hoje. Ver "Achados sobre a tela de hoje".

---

## A · TRILHA — uma terceira coluna

**Resolve:** a lista inteira na tela, sem clique, sem rolagem horizontal, com título em duas linhas.
Rola no eixo que lista pede (vertical) e escala para 30 conversas sem mudar de forma. É a resposta
da barra lateral do Claude, e é a que o `flows.html` já usa para projetos (`.rail`) — vocabulário
que existe.

**Custa:** 208px de largura, para sempre, tirados exatamente das duas colunas que já disputavam a
tela: −15,0% de área no desenho e −27,6% na conversa. O título recebe 155px em duas linhas (~48
caracteres). Cinco linhas cabem sem rolar.

**1440px:** funciona, é a mais legível das três, e é a mais cara. **390px:** uma coluna de 208px não
existe ali, então a trilha vira tira horizontal — o que faz de A e B a mesma tela no telefone.

## B · FAIXA — uma tira atravessando a largura

**Resolve:** nenhuma das duas colunas perde largura; as duas perdem 43px de altura. Tudo visível
sem clique, e a pastilha selecionada some da tela nunca (a tira rola a selecionada para o centro
ao renderizar). É a única que não é nem coluna nem diálogo, e a mais barata das duas permanentes.

**Custa:** o título. A pastilha é de uma linha e comporta ~24 caracteres (237px na selecionada, menos
nas outras), e com seis conversas **só três aparecem inteiras** — o resto fica atrás de uma rolagem
horizontal, que é o pior eixo para varrer títulos. Some daí que **título de conversa não pode ter
tooltip**: `title=` é hover, e o borrão do modo gravação nunca abre no hover — um tooltip que revela
o que o borrão esconde não protege nada. Então cortado é cortado. Ela também empilha uma segunda
fita abaixo da faixa do dossiê, que já está cheia; por isso ela é transparente com um fio embaixo,
não tingida.

**1440px:** boa até ~4 conversas, vira rolador depois. **390px:** é o desenho nativo dela, custa 43px.

## C · GAVETA — chamada pelo cabeçalho

**Resolve:** não tira **um pixel** de nenhuma das duas colunas — medido idêntico à linha de base.
Espaço temporário é grátis, então é a única em que o título **não trunca** e ainda cabe a última
mensagem, a hora, o estado, a evidência, o alvo e o custo na mesma linha. Escala para qualquer
número, com filtro por palavra. E é quase toda vocabulário que esta casa já tem: o véu e o desfoque
são os mesmos números do `.hoff-scrim`/`.fmod-scrim`, a busca é o `.fbusca` da telinha de escolher
fluxo, o rodapé é o `.fmod-ft`.

**Custa:** um clique, e um botão no cabeçalho: o ícone desenhado da pilha de conversas mais
`6 conversas · 1 espera` (ícone desenhado, não glifo — `⌸` não está provado nesta fonte). Com a gaveta fechada,
aquele botão é a única coisa na tela que diz que existe história, e é o que chama quando uma conversa
parou numa pergunta. Qual conversa está aberta é respondido pelo título em `[ 01 ] A conversa · «…»`,
uma fatia daquele cabeçalho que hoje está vazia. Enquanto aberta, ela cobre a conversa — o que é
aceitável pela mesma razão que a telinha de escolher fluxo é modal e não popover: escolher e ler não
acontecem no mesmo instante.

**1440px:** as 6 conversas inteiras, sem rolar. **390px:** custo zero na tela, gaveta a 92% da largura.

---

## Recomendação

**C, a gaveta** — é a única que não cobra nada das duas coisas para as quais esta tela existe, é a
única que mostra o título inteiro (que importa mais aqui do que em qualquer outro lugar, porque
título de conversa não pode ter tooltip), e é a que reaproveita um diálogo que este painel já sabe
fazer certo.

> Escolhida pelo Kauan no meio da revisão, antes de este relatório ficar pronto — o que quer dizer
> que o resto daqui vale como lista de implementação, não como argumento.

### O que a gaveta precisa ter quando for construída

- **Diálogo de verdade**, como o `confirmar()` e a telinha de fluxo já fazem: `role="dialog"`,
  `aria-modal`, `inert` em todo irmão enquanto aberta (sem isso o Tab anda por trás do véu — defeito
  já corrigido uma vez no `flows.html`), Esc e véu fecham, ↑↓ andam, Enter abre, e o foco volta para
  o botão que abriu.
- **Redesenhar a barra ANTES de fechar.** Na ordem inversa o foco volta para um botão que o render
  seguinte destrói e cai no `body` — exatamente o bug documentado na telinha de escolher fluxo.
- **`?c=<conversa>` na URL**, ao lado do `?f=`. Uma conversa que custa minutos precisa de endereço,
  e um refresh no meio tem que voltar para ela.
- **A gaveta e o véu vivem DENTRO da `.tela`**, o que exige `position: relative` nela. O topbar e a
  vitrine atrás não têm nada a ver com escolher conversa.

## O que as três compartilham (e vale para qualquer uma)

- **Sete estados, sete frases, e nenhum verde.** `correndo agora` · `esperando você` · `alvo na mesa`
  · `alvo confirmado` · `parada por você` · `quebrou` · `terminou sem alvo`. Confirmar o alvo não
  aplicou nada (a etapa do patch não existe), então `--ok` afirmaria um resultado que não houve;
  `--accent` é movimento, `--warn` é o que pede ação, `--cold` o que parou, `--risk` só o que quebrou
  sozinho. A legenda das sete está no topo do `historico.html`.
- **`esperando você` é o único estado com pílula no cabeçalho.** É o estado mais fácil de esquecer —
  este repositório já escreveu isso duas vezes sobre o Tester. E o aviso é **palavra, nunca só um
  ponto colorido**.
- **Ordem é recência, e nada mais.** Subir o que espera por ele reordenaria a lista embaixo do olho
  a cada rodada que termina; quem acha o que espera é a pílula. Mesma disciplina do `#feed-sel`, que
  só rola quando a *seleção* muda.
- **Evidência é ícone desenhado; alvo reusa o glifo que a tela já tem** (`◇` proposto, `✓`
  confirmado, os mesmos de `faixaAlvo`). Nada de emoji — `⌕`, `📎` e `🗀` já saíram como quadrado
  vazio nesta fonte.
- **O título é `sens`.** Ele nasce do que o Kauan escreveu, e ele escreve *"a Ana foi chamada de
  outro nome no meio da conversa"*. Em `historico-C-gaveta-gravando.png` dá para ver o corte certo:
  título e última mensagem borram, estado / hora / evidência / custo continuam legíveis — dá para
  saber **qual** conversa é sem publicar o nome do lead.
- **A porta aparece vazia.** Trilha, faixa e botão existem com zero conversas e dizem que estão
  vazios. Porta que só aparece quando tem algo atrás é porta que ninguém acha.
- **Controle que não faz nada sai de cena.** Com a lista vazia a gaveta esconde o filtro e o
  `↑↓ escolher · enter abrir`, e mantém só o `+ nova conversa` — que vazia é a única coisa que importa.
- **A forma que o servidor precisaria emitir** (fato, o juízo fica na página): por conversa,
  `{ id, titulo, status, em, evidencias: n, alvo: "proposto"|"confirmado"|null, rodadas, usd, usdDesconhecido, ultima }`.
  `ultima` é a última mensagem em texto, e é o campo que faz a linha rica da gaveta valer a pena.

## Decisões de produto que o desenho não resolve

1. **O que dá título a uma conversa.** Nos mockups o título é a primeira frase do Kauan, cortada — é
   o que existe de graça e é o que ele reconhece. Mas *"às vezes ele manda que o ingresso está
   R$0,00"* funciona e *"e aquilo que a gente falou ontem"* não. Alternativas: a sessão propõe um
   título junto do primeiro `resposta.json` (a entrevista do Tester já propõe `titulo`, então o
   caminho existe e custa zero rodada extra); ou ele renomeia à mão. **Precisa de decisão antes de
   persistir, porque o título é a chave de identidade na lista.**
2. **Conversa antiga é retomável ou só leitura?** Hoje a sessão do CLI é reatada por `--resume` com o
   `session_id` — mas ele expira, e o fluxo pode ter mudado depois (o dossiê inclusive detecta isso).
   Retomar uma conversa de segunda contra um fluxo de quinta pode produzir um alvo em cima de nó que
   não existe mais. As três formas desenham a lista igual nos dois casos; o que muda é se abrir uma
   antiga habilita o compositor ou mostra "esta conversa é histórico, abra uma nova".
3. **Quanto tempo o histórico guarda, e quem apaga.** `blueprints.json`, `fixes.json` e `licoes.json`
   são rastreados em git e nunca expiram. Uma conversa carrega texto de execução (a evidência
   resumida) e o nome do lead no título — o que faz dela o primeiro arquivo deste projeto com dado de
   cliente dentro E vontade de estar no git. Precisa decidir: rastreado ou `.gitignore`; teto de
   conversas por fluxo; e se apagar é apagar ou é a lixeira que o Tester já tem (`projetos/.lixeira/`
   existe porque `unlink` num projeto nunca comitado é definitivo — a mesma armadilha vale aqui).
4. **Uma conversa roda por vez em todo o cockpit** (`409` na segunda). Então a lista de um fluxo pode
   mostrar `correndo agora` e a de outro fluxo também querer rodar. Falta decidir se o botão
   `+ nova conversa` fica desabilitado dizendo qual conversa está rodando (e em qual fluxo), ou se o
   409 aparece depois do clique. A primeira é melhor e precisa de um campo novo no `status`.
5. **A vitrine não conta conversas.** O cartão de cada fluxo em `[ 01 ] Qual fluxo você quer melhorar`
   mostra execuções e peso; não mostra "3 conversas, 1 esperando você". Sem isso, uma conversa parada
   numa pergunta só é encontrada por quem já abriu aquele fluxo. **É provavelmente mais valioso que a
   própria lista**, e é fora do escopo desenhado aqui.
6. **Quantas conversas por fluxo, de verdade.** Todo o custo comparado acima muda de sinal se o número
   típico for 3 ou 30. Nos mockups são 6, que é o que uma semana produziu. Se for 3, a faixa fica
   barata e boa; se for 30, só a gaveta sobrevive.

## Achados sobre a tela de hoje (não consertados — produção não se toca nesta fase)

1. **O bloco de 390px do `upgrade.html` é código morto.** `@media (max-width: 900px) { .duas {
   grid-template-columns: 1fr } }` nunca vale, porque `.tela[data-layout="duas"] .duas` vence por
   especificidade. Medido: em 390 a tela mantém **duas colunas**, a rolagem da conversa fica com
   **138px de largura** e o desenho com 201px. Quem consertar o telefone tem que consertar essa regra
   no mesmo commit — e cuidado: empilhar dentro de uma `.tela` de altura fixa leva o desenho a **zero
   de altura** (também medido, na primeira versão deste preview).
2. **A câmera pode voar para um lugar onde não há nada.** `extentoAcesos()` junta `.pn.on` (o alvo) com
   `.pn.falhou` (o nó que quebrou em 24h). No Iago o alvo desta conversa está a ~9.000 unidades do
   `Convert text to speech`; a região fica enorme, `camRegiao` bate no piso de `ESC_NOME` e a câmera
   para num meio de caminho que **não mostra nem o alvo nem a falha**. Foi o que aconteceu na primeira
   captura. O preview enquadra só `.pn.on` e diz isso no comentário; a tela real ainda faz o voo
   inútil.
3. **`.secao` precisa de `flex-wrap: nowrap`** para receber qualquer coisa à direita do rótulo: com o
   título da conversa aberta ali, `[ 01 ]` e `A conversa` quebraram em três linhas antes de eu pôr o
   guarda. Vale para a opção C, que é justamente a que usa aquela fatia.

O detector mecânico do `impeccable` roda limpo sobre o que é novo: as quatro marcas que ele acha
(`border-left: 2px solid var(--risk)`, `transition: max-width`, a malha do `.backdrop` e o `.gbeam`)
estão todas no CSS **extraído** de produção, e as duas últimas são identidade que o `CLAUDE.md`
declara de propósito.
