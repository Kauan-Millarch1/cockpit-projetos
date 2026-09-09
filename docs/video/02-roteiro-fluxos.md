# Roteiro — tutorial da aba Fluxos

Vídeo curto, por aba, para o botão **"como usar esta tela"** que vai dentro do cockpit. Não é o
tour de produto (`01-roteiro-tour.md`, 6:21): aquele conta a história inteira para quem nunca viu o
painel. **Este ensina a usar UMA tela**, para quem já está nela e quer saber onde clicar.

## O que este roteiro faz de diferente do tour

| | tour (`01-`) | tutorial de aba (este) |
|---|---|---|
| pergunta que responde | "o que é este produto" | "como eu uso esta tela" |
| duração | 6:21 | mira **1:40–2:00** |
| tom | argumento, com o porquê de cada decisão | instrução, direto no como |
| tema | escuro | **claro** |
| resolução | 1920×1080 | **3840×2160 (4K)** |
| imagem | gravação de tela, plano fixo | **animado**: zoom, pan, cursor, digitação |
| público | quem decide usar | **quem já está usando, e não é técnico** |

**Menos técnico, e a régua é esta:** fora `assinatura`, `sub-fluxo`, `SSE`, `portão determinístico`,
`heurística`, `fixture`, `payload`. Dentro `nó` (o Kauan pediu para manter — é a palavra do n8n e
quem usa o cockpit vê nó na tela), `automação`, `execução`, `falhou`, `onde travou`.

**O que NUNCA entra em quadro com clique:** `⧉ Mandar pro Claude` até a cena que o explica,
`✓ Aprovar e aplicar`, `▷ Reexecutar a execução`. O vídeo é gravado contra dados falsos, então
nenhum deles chegaria ao n8n — a regra vale igual, porque um tutorial que mostra o clique ensina o
clique.

---

## As cenas

`≈s` é **estimativa** (13,8 car/s, medido sobre 53 falas do tour). O corte é feito contra a duração
medida no MP3 gerado, nunca contra esta coluna — no tour a estimativa errou 1,73s numa fala só.

| # | tela | animação | fala | ≈s |
|---|---|---|---|---|
| f1 | `/` recém-carregada, tema claro | abre em plano geral, zoom lento para a tira do topo | "Olá! Bem-vindo à aba Fluxos. É aqui que você vê tudo o que as suas automações fizeram, sem precisar abrir o n8n." | 8,1 |
| f2 | tira de números do topo | zoom fechado, panorâmica da esquerda para a direita | "Começa por aqui. Quantas execuções rodaram hoje, quantas falharam, e quantas automações estão de pé agora." | 7,7 |
| f3 | coluna da esquerda | cursor desce a lista, para em `LOJA` e clica | "Do lado esquerdo estão os seus projetos. Clica num deles e a tela mostra só aquele." | 6,0 |
| f4 | um cartão de automação | zoom no cartão, o cursor circunda a frase | "Cada cartão é uma automação. E ele não te dá só um número: ele te diz numa frase o que está acontecendo com ela." | 8,1 |
| f5 | seção `Ao vivo` | panorâmica descendo até a lista | "Aqui do lado, ao vivo, é tudo o que rodou nas últimas vinte e quatro horas — a mais recente em cima." | 7,2 |
| f6 | os dois filtros | cursor clica `deu erro`, a lista filtra | "Dois botões filtram essa lista: só o que deu certo, ou só o que deu erro. É por esse que você vai começar numa segunda-feira." | 9,1 |
| f7 | clique numa execução | a execução acende, o desenho aparece | "Clica numa linha e a automação aparece desenhada, nó por nó, do jeito que ela existe no n8n." | 6,7 |
| f8 | bloco `O que aconteceu` | zoom no bloco, rola devagar | "E logo abaixo, em português: quem falou com você, o que essa pessoa mandou, e o que a automação respondeu." | 7,7 |
| f9 | `Erros agrupados` | panorâmica até a seção, zoom num cartão | "Quando algo falha, o cockpit junta as falhas iguais num cartão só. Se o mesmo nó quebrou dez vezes, é um problema, não dez." | 8,9 |
| f10 | o chip `⤷` do cartão | zoom fechado no chip | "E se o nó que quebrou não estiver na automação que você abriu, ele te diz em qual está. Isso já custou tarde de gente boa." | 8,8 |
| f11 | `⧉ Mandar pro Claude` | cursor para no botão, sem clicar | "Esse botão manda a falha para o Claude corrigir, aqui na sua máquina. Ele te mostra o que quer mudar, e **você** decide se aplica." | 9,1 |
| f12 | `✓ Correção feita` | cursor no botão, zoom no campo | "Quando você resolver, marca aqui e anota o que fez. Se a falha voltar, o cartão reaparece sozinho." | 7,1 |
| f13 | topbar, botão `◐` | cursor clica, a tela troca de tema | "Ah — e esse botão troca entre tema claro e escuro, se você preferir o outro." | 5,5 |
| f14 | volta ao plano geral | zoom out lento | "É isso. Uma tela para saber o que está vivo, o que quebrou, e o que fazer sobre isso." | 6,2 |

**Soma estimada: 106,2s (1:46).** Dentro da faixa.

---

## Notas de gravação

**Tema claro, e não é preferência.** `?theme=light` força, e o vídeo do tour é escuro — dois vídeos
no mesmo produto com o mesmo tema seriam indistinguíveis na miniatura, e este vai atrás de um botão
dentro da tela clara.

**A cena f13 é a única que MUDA a tela de propósito.** Ela clica o `◐`, então o tema muda no meio do
vídeo — e a f14 volta ao plano geral já no outro tema. Isso é intencional: a fala diz que o botão
troca, e mostrar a troca é a prova. Se a ordem das cenas mudar, f13 precisa continuar antes de f14,
senão o vídeo termina num tema que ninguém escolheu.

**f11 não clica.** O botão manda uma correção para o Claude, e um tutorial que mostra o clique
ensina o clique. A fala explica o que ele faz; o cursor para em cima dele e sai.

**O cursor é desenhado.** Chromium headless não tem ponteiro, então ele é um elemento por cima da
página — a única coisa em quadro que não é o cockpit. Está escrito aqui para ninguém descobrir
depois.

**Nada é inventado além disso.** Sem botão falso, sem tela falsa, sem número falso: o que aparece é
o cockpit real rodando contra os dados falsos de `.video/fixtures.js`, cuja forma é aferida
(`conferirForma`) contra os números que a narração cita.
