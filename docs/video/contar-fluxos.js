/* contar-fluxos.js — a coluna `≈s` do roteiro da aba FLUXOS.
 *
 * A conta inteira mora em `contar-roteiro.js` desde que o roteiro do Tester
 * apareceu: o que muda entre um roteiro e outro e o ARQUIVO e o PREFIXO do id
 * da cena, e a regua e a mesma porque a voz e a mesma. Duas copias da mesma
 * conta divergiriam na primeira correcao feita num lado so.
 *
 * Este arquivo continua existindo porque o comando dele esta escrito no handoff
 * e nas notas de gravacao. Apagar tambem seria certo; deixar um atalho de uma
 * linha custa menos do que caçar onde o comando antigo foi citado.
 *
 *   node docs/video/contar-fluxos.js            confere e reclama
 *   node docs/video/contar-fluxos.js --escrever reescreve a coluna e o total
 */
"use strict";
require("./contar-roteiro.js").contar("02-roteiro-fluxos.md", "f", process.argv.includes("--escrever"));
