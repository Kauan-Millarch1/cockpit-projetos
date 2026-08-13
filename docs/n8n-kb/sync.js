/* sync.js — regenera a cópia portátil do extrator.
 *
 * `docs/n8n-kb/extrair-esquema.js` NÃO é um segundo código: é uma cópia gerada de
 * `esquema.js`, com um cabeçalho dizendo isso. Escrever uma segunda
 * implementação "mais simples" para o pacote portátil garantiria que as duas
 * divergissem — e a que fica errada é justo a que sai deste repositório para
 * outro projeto, onde ninguém tem o teste para pegar.
 *
 * Dá para copiar porque `esquema.js` já é autossuficiente: só requer módulos
 * embutidos do Node (`fs`, `fs/promises`, `path`, `child_process`). O dia em que
 * ele passar a requerer algo do cockpit, este script falha em vez de gerar uma
 * cópia quebrada.
 *
 * Uso:  node docs/n8n-kb/sync.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const FONTE = path.join(RAIZ, "esquema.js");
const DESTINO = path.join(__dirname, "extrair-esquema.js");

const texto = fs.readFileSync(FONTE, "utf8");

/* A cerca: se aparecer um require relativo, a cópia não funciona fora daqui e o
 * honesto é falhar em vez de entregar um arquivo que quebra na casa de outro
 * projeto. */
const relativos = [...texto.matchAll(/require\("(\.[^"]+)"\)/g)].map(m => m[1]);
if (relativos.length) {
  console.error("esquema.js passou a requerer módulo local: " + relativos.join(", "));
  console.error("A cópia portátil não funcionaria. Extraia essa dependência ou adapte este script.");
  process.exit(1);
}

const cabecalho = [
  "/* extrair-esquema.js — CÓPIA GERADA. Não edite aqui.",
  " *",
  " * Gerado de `esquema.js` do Cockpit de Projetos por `docs/n8n-kb/sync.js`.",
  " * A canônica é a de lá; mudança feita aqui é perdida na próxima sincronização.",
  " *",
  " * Autossuficiente: só módulos embutidos do Node 22. Sem `npm install`.",
  " *",
  " *   node extrair-esquema.js --baixar       # npm pack dos pacotes de nó",
  " *   node extrair-esquema.js --construir    # destila para .cache-esquema.json",
  " *   node extrair-esquema.js --ver <tipo> [--versao <v>]",
  " *   node extrair-esquema.js --conferir <fluxo.json>",
  " */",
  ""
].join("\n");

fs.writeFileSync(DESTINO, cabecalho + texto, "utf8");
console.log("gerado " + path.relative(RAIZ, DESTINO) + " (" + (cabecalho.length + texto.length) + " chars)");
