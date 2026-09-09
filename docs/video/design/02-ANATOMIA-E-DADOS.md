# Anatomia da aba Fluxos, e os dados que aparecem em quadro

**Tudo aqui foi lido da tela rodando.** Os textos são os que a tela mostra, com a caixa que
ela mostra — vários rótulos são `text-transform: uppercase`, então o que se vê é maiúsculo
mesmo que o código escreva minúsculo.

## As regiões, de cima para baixo

**1 · Topbar** — 58px de altura, translúcida sobre o fundo.
Da esquerda: o wordmark da Ecommerce Puro, um separador, a chama e `COCKPIT / fluxos n8n`,
outro separador, a cápsula de navegação, o endereço da instância, e à direita os botões:
`⊘Avisar`, `◐`, `⏺ Gravar`, `Recarregar`.

**A cápsula de navegação** tem cinco portas, e uma delas não é porta de produto:

| rótulo | rota | é porta de produto? |
|---|---|---|
| Fluxos alt 1 | `/` | sim |
| Disco alt 2 | `/disco` | sim |
| Tester alt 3 | `/tester` | sim |
| Upgrade alt 4 | `/upgrade` | sim |
| Conta alt 5 | `/conta` | **não** — é a conta |

A porta ativa carrega uma lente de vidro que **viaja** de uma para a outra na troca de tela.
O rótulo abre na porta ativa e no foco; nas outras fica só o ícone.

**2 · Coluna dos projetos** — 250px à esquerda, cabeçalho `[ PROJETOS ]`. Cada item é um projeto, com contagem e falhas:

- `Todos 12`
- `SEM PREFIXO 7 falhas 1 fluxo · 647 exec 24h`
- `ROBERTO 4 falhas 5 fluxos · 141 exec 24h`
- `LOJA 5 5 fluxos · 102 exec 24h`
- `ECONTRATE 1 1 fluxo · 6 exec 24h`

O agrupamento vem do prefixo `[PROJETO]` no nome do fluxo — é a única forma de agrupar que
esta instância permite, então `SEM PREFIXO` é um grupo de verdade e não um erro.

**3 · Tira de KPIs** — seis cartões de 261×100px.
Cada um: rótulo pequeno em maiúsculas, numeral grande em fonte monoespaçada, e uma linha de
apoio embaixo. O que está em quadro:

| rótulo | número | apoio |
|---|---|---|
| EXECUÇÕES 24H | **896** | 11 fluxos em movimento |
| TAXA DE SUCESSO | **99%** | 11 falhas |
| FALHAS 24H | **11** | 3 assinaturas distintas |
| FLUXOS ATIVOS | **8** | de 75 no total |
| ÚLTIMA EXECUÇÃO | **3min** | às 15:16 |
| DURAÇÃO P95 | **3,6s** | mediana 430ms |

**Seis é o teto.** Mais que isso vira papel de parede e passa a ser ignorado em duas semanas.

**4 · Painéis numerados** — cinco seções, e o número faz parte do desenho:

| índice | seção | o que é |
|---|---|---|
| `[ 01 / 05 ]` | o palco | o fluxo desenhado, nó por nó, no vocabulário do n8n |
| `[ 02 / 05 ]` | Ao vivo | tudo que rodou na janela de 24h, mais recente em cima |
| `[ 03 / 05 ]` | Erros agrupados | falhas iguais juntas num cartão |
| `[ 04 / 05 ]` | marcadas como corrigidas | some quando está vazio |
| `[ 05 / 05 ]` | Fluxos com atividade | a grade de cartões |

Os cabeçalhos em quadro, literais:

- `[ 01 / 05 ] WhatsApp API Oficial SEM PREFIXO · 15 nós executáveis ⤢ Caminho ⛶ Tudo ▶ Reexecutar visual`
- `[ 02 / 05 ] Ao vivo 896 execuções`

**5 · Os três chips de filtro do Ao vivo** — 22px de altura,
cantos totalmente arredondados, texto em maiúsculas:

- `DEU CERTO 885`
- `DEU ERRO 11`
- `TODOS OS FLUXOS ▾`

Os números nos chips são **contagens da janela inteira**, não do resultado filtrado: `DEU
ERRO 11` continua dizendo 11 mesmo com um fluxo específico selecionado. É o que faz o número
servir para decidir clicar.

## Os dados que aparecem em quadro

São dados **falsos**, de `.video/fixtures.js`, e a forma deles é aferida por código contra os
números que a narração cita. Use estes valores e não outros — a narração diz alguns deles em
voz:

| fato | valor |
|---|---|
| execuções na janela de 24h | **896** |
| falhas | **11** |
| assinaturas distintas de erro | **3** |
| taxa de sucesso | **99%** |
| fluxos ativos | **8 de 75** |
| cartões na grade | **12** |
| fluxo em destaque | **WhatsApp API Oficial**, 15 nós executáveis |
| nó que falhou | **Convert text to speech** |
| sub-fluxo onde ele mora | **[ROBERTO] Agente Iago Comercial** |
| contato de exemplo | **Marcos Vinícius Aparecido Lima · +55 21 ***** 0000** |
| mensagem recebida | **"Boa noite, quero o link de pagamento"** |

O telefone aparece **mascarado**, e não é escolha de vídeo: o produto mascara telefone e
e-mail antes de o valor sair do servidor. Desenhar um número inteiro mostraria um cockpit
que não existe.
