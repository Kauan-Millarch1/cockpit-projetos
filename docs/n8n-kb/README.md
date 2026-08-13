# n8n-kb — a base de conhecimento portátil

Este diretório é autossuficiente. Copie a pasta inteira para qualquer projeto e ela funciona.

```
n8n-kb/
├── SKILL.md              a porta de entrada — o que fazer, em que ordem
├── GRAMATICA.md          a gramática: forma do documento, parâmetros compostos, erro, topologia
├── FONTES.md             de onde vem cada fato e como extrair de novo (com as pegadinhas)
├── extrair-esquema.js    CÓPIA GERADA de `esquema.js`. Zero dependência, Node 22
└── sync.js               regenera a cópia acima. Rode depois de mexer no `esquema.js`
```

## Usar em outro projeto

**Como skill do Claude Code** — o `SKILL.md` já tem o frontmatter certo:

```bash
cp -r docs/n8n-kb ~/.claude/skills/n8n-kb
```

Depois disso, qualquer sessão em qualquer projeto carrega a base quando a tarefa é escrever ou
consertar fluxo de n8n.

**Como pasta de um projeto** — copie para lá e aponte o `CLAUDE.md` daquele projeto para
`n8n-kb/SKILL.md`.

**Só o extrator** — `extrair-esquema.js` roda sozinho, sem o resto:

```bash
node extrair-esquema.js --baixar        # uma vez (baixa ~10MB, descompacta em minutos)
node extrair-esquema.js --construir     # destila para .cache-esquema.json (~9MB, 810 tipos)
node extrair-esquema.js --ver n8n-nodes-base.redis
node extrair-esquema.js --conferir meu-fluxo.json
```

## Manter

`GRAMATICA.md` aqui é **cópia editorial** do `n8n-gramatica.md` da raiz do Cockpit, que é a canônica —
lá ela é lida em runtime e injetada nos prompts do Tester. Mudança de fato entra na canônica primeiro.

`extrair-esquema.js` é **cópia gerada** e não deve ser editada: `node sync.js` a reescreve. O `sync.js`
falha de propósito se o `esquema.js` passar a requerer um módulo local, porque nesse dia a cópia
deixaria de funcionar fora daqui e entregar um arquivo quebrado é pior que não entregar.

`FONTES.md` é o único arquivo sem par: o que ele documenta é como o conhecimento foi obtido, e isso não
vive em código.

## O limite, dito de frente

Nada aqui prova que um fluxo **funciona**. A API pública do n8n não tem endpoint de execução, e não
valida `parameters`. O que este pacote prova é que o fluxo está **estruturalmente válido contra a
definição real dos nós na versão declarada** — que é piso, não teto, e quem mostra o resultado na tela
tem que dizer isso.
