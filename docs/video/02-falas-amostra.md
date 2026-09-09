# Falas do vídeo de amostra — aba Fluxos

**Este arquivo é gerado** (`node .video/falas-md.js`). O texto sai de
`02-roteiro-fluxos.md`, a duração sai do MP3 medido com ffprobe, e a lista de cenas sai do
manifesto da gravação — então ele não pode discordar do vídeo. Um número digitado aqui
seria uma quarta fonte, e ela divergiria na primeira regravação.

Vídeo: `.video/fluxos-amostra.mp4` — 21,94s (0:22), 3840×2160, tema claro.

**3 de 14 cenas do roteiro.** Esta é a amostra que existe para julgar o *jeito*
do movimento antes de as outras serem gravadas: uma cena de câmera (f1), uma de clique com
consequência na tela (f6), e uma que muda o estado do produto (f13).

---

## f1 — 8,08s

> Olá! Bem-vindo à aba Fluxos. É aqui que você vê tudo o que as suas automações fizeram, sem precisar abrir o n8n.

| | |
|---|---|
| tela | `/` recém-carregada, tema claro |
| animação | abre em plano geral, zoom lento para a tira do topo |
| áudio | `.video/audio/falas-fluxos/f1.mp3` |
| caracteres | 112 |

## f6 — 8,88s

> Dois botões filtram essa lista: só o que deu certo, ou só o que deu erro. É por esse que você vai começar numa segunda-feira.

| | |
|---|---|
| tela | os dois filtros |
| animação | cursor clica `deu erro`, a lista filtra |
| áudio | `.video/audio/falas-fluxos/f6.mp3` |
| caracteres | 125 |

## f13 — 4,96s

> Ah — e esse botão troca entre tema claro e escuro, se você preferir o outro.

| | |
|---|---|
| tela | topbar, botão `◐` |
| animação | cursor clica, a tela troca de tema |
| áudio | `.video/audio/falas-fluxos/f13.mp3` |
| caracteres | 76 |

---

## Contas

| | |
|---|---|
| falas | 3 |
| caracteres | 313 |
| soma das falas | 21,92s (0:22) |
| duração do arquivo | 21,94s |
| diferença | 0,02s |

A diferença entre a soma das falas e a duração do arquivo é o teste de sincronismo: cada
segmento é cortado exatamente na duração medida do seu MP3, então um desvio maior que ~0,1s
significaria que algum segmento não saiu do tamanho pedido — e esse tipo de erro **cresce**
ao longo do vídeo em vez de aparecer numa cena só.

## Voz

`eleven_v3` com `language_code: "pt"`, voz `kPzsL2i3teMYv0FxEYQ6`, ajustes de `.video/voz.js`.

**O modelo não é a causa do sotaque, e isso foi medido.** Cinco configurações
(`multilingual_v2` com e sem `language_code`, `turbo_v2_5`, `flash_v2_5`, `v3`) foram
transcritas de volta e comparadas com o texto original: **as cinco deram 100% de
inteligibilidade e as cinco foram detectadas como português**, com 98,8% a 99,3% de
confiança. A medição empatou, e escolher pelo terceiro decimal seria inventar precisão.

O sotaque mora na **voz**, não no modelo — e a voz atual é a que foi escolhida de ouvido
para o tour, entre duas candidatas, nenhuma verificada como nativa de pt-BR. Trocar o
modelo não conserta isso. As amostras da comparação estão em `.video/audio/comparar-voz/`.
