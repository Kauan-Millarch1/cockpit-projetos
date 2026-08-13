---
name: n8n-kb
description: Base de conhecimento para GERAR ou CORRIGIR workflow JSON de n8n. Use sempre que a tarefa for escrever, revisar, remendar ou depurar um fluxo do n8n — inclusive quando o pedido não usa a palavra "n8n" mas envolve automação com webhook, agente conversacional em WhatsApp/Telegram/Slack, ou integração entre serviços num orquestrador de nós. Traz a anatomia do documento, a forma exata dos parâmetros compostos (filter, resourceLocator, assignmentCollection, resourceMapper, fixedCollection), erro e retry, as topologias que funcionam, e um extrator sem dependências que lê o esquema autoritativo dos nós direto do pacote npm.
---

# Escrever fluxo de n8n que funciona de verdade

Um LLM erra fluxo de n8n de um jeito muito específico e muito caro: **o JSON importa limpo e não faz
o que foi pedido.** A API pública do n8n não valida `parameters`, o editor mostra o campo vazio sem
reclamar, e o defeito só aparece na primeira execução — ou nunca, porque a execução fica verde.

As três causas, em ordem de dano:

1. **Deriva de versão.** `if` v1 e v2 são documentos completamente diferentes. `set` v2 e v3.4
   também. Escrever de memória é escrever a forma de alguma versão, não a da versão declarada.
2. **Parâmetro composto.** `filter`, `resourceLocator`, `assignmentCollection`, `resourceMapper` e
   `fixedCollection` têm forma própria que não está em documentação de nó nenhuma.
3. **Discriminador inventado.** `resource`, `operation`, `mode`, `select` só aceitam valor de um
   conjunto fechado, e esse conjunto muda por versão.

Este pacote resolve os três. Ordem de uso:

## 1. Antes de escrever: pegue o esquema autoritativo

```bash
node extrair-esquema.js --baixar      # npm pack dos pacotes de nó (~10MB de tarball)
node extrair-esquema.js --construir   # destila para esquema-n8n.json
node extrair-esquema.js --ver n8n-nodes-base.redis
```

O que sai, **por (tipo, typeVersion)**: toda propriedade, o tipo, o valor padrão, o **enum completo**
de cada discriminador, se é obrigatória, e sob qual `resource`/`operation`/`@version` a chave existe.
Mais o **schema do que o nó devolve**, quando o pacote publica (≈278 versões).

Sem dependência, sem `npm install`, sem build. Funciona offline depois do primeiro download.

> Isso não é opcional para um fluxo que vai para produção. É a diferença entre "escrevi o que eu
> lembro do n8n" e "escrevi o que este n8n aceita".

## 2. Enquanto escreve: leia `GRAMATICA.md`

O que o esquema **não** consegue dizer, porque não está em descriptor: o prefixo `=`, as três camadas
de `connections`, a forma JSON de cada parâmetro composto, como erro e retry se declaram, e as
topologias que funcionam (webhook que responde antes de processar, lote, junção, sub-fluxo).

## 3. Depois de escrever: confira contra o esquema

`extrair-esquema.js --conferir fluxo.json` acusa três coisas, cada uma com o nome da chave:

- **chave desconhecida** — não existe nessa versão do nó. O n8n aceita e ignora.
- **chave inaplicável** — existe, mas só sob outro `resource`/`operation`. Mesmo silêncio.
- **valor fora do enum** — discriminador com valor que aquela versão não aceita.

Ele é **fail-open** em cinco pontos, de propósito: sem esquema, tipo desconhecido, versão
aproximada, predicado indeciso e parâmetro opaco não geram acusação. Medido em 99 fluxos publicados
que funcionam: marca 1,3% dos nós, e o que sobra é parâmetro de versão velha — achado de verdade.
Um conferidor que acusa fluxo bom é pior que nenhum, porque ensina a ignorá-lo.

## As fontes, e o que cada uma serve

Todas verificadas ao vivo. Detalhe e código em `FONTES.md`.

| Fonte | Como | Serve para |
|---|---|---|
| Pacotes npm dos nós | `npm pack n8n-nodes-base` + carregar o descriptor com dependências stubadas | o esquema autoritativo, por versão |
| `registry.npmjs.org/<pkg>/<versão>` | um GET, sem auth | o manifesto `n8n.nodes` com o caminho de cada nó |
| `cdn.jsdelivr.net/npm/<pkg>@<v>/<caminho>` | um GET por nó | um nó só, sem baixar o pacote. **Use jsdelivr, não unpkg** — unpkg deu 500 em 2 de 5 requisições |
| `api.n8n.io/templates/search?nodes=<tipo>` | sem auth | ~1850 fluxos publicados: a forma real dos parâmetros compostos |
| `api.n8n.io/templates/workflows/<id>` | sem auth | o JSON completo de um deles |
| `docs.n8n.io/<página>.md` | sufixo `.md` em qualquer URL da doc | a doc oficial em markdown |
| `docs.n8n.io/llms.txt` / `llms-full.txt` | um GET | o índice e o corpus inteiro da doc, feitos para LLM |

**Ao usar template como exemplar, confira a `typeVersion`.** O corpus tem fluxo de 2019 com
`typeVersion: 1`; um exemplar de versão errada ensina exatamente o erro que se quer evitar.

## O que não funciona, para ninguém re-derivar

- `GET /types/nodes.json` na instância n8n Cloud → **401**. `/rest/node-types` e
  `/api/v1/node-types` → **404**. O endpoint de esquema do editor não é alcançável com chave da API
  pública.
- `GET /api/v1/credentials` → **405**. Não existe inventário de credenciais pela API pública, e o
  segredo nunca sai do n8n.
- `GET /api/v1/projects` → **403** em plano sem essa feature.
- `status=crashed` no filtro de execuções → **400**. O conjunto válido é
  `success | error | waiting | running | canceled`.
- Não existe endpoint de **executar** fluxo na API pública. Nenhum conferidor pode provar que um
  fluxo funciona; ele prova que o fluxo está estruturalmente válido, que é piso e não teto.

## A regra que vale mais que todas as outras

**`[PREENCHER]` em todo parâmetro que depende de algo que a pessoa não confirmou.**

A assimetria é o argumento: o marcador falha na cara, na hora, com o campo vazio no editor. Um canal
inventado, um id de planilha plausível ou um telefone de exemplo fazem o fluxo **importar limpo e
mandar para o lugar errado**, e nada avisa. Nunca invente destino.
