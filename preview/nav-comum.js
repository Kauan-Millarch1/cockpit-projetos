/* nav-comum.js — o que os geradores de preview da navegação compartilham.
 *
 * Existe porque a segunda tela (a da variante D, escolhida) precisava dos mesmos
 * ícones e das mesmas três portas. Copiar era garantir que um dia o ícone do
 * Tester seria um no comparativo e outro na tela aprovada.
 *
 * Não é código de produção: nada aqui é servido. É a matéria-prima dos previews.
 */

"use strict";

/* Ícones das portas. Mesma linguagem do ICONS de flows.html: viewBox 24, traço
   1.9, ponta redonda, DESENHADO — sem emoji e sem logo de terceiro. A diferença
   é que aqui a cor é currentColor: no canvas a cor do ícone é o serviço; na
   navegação não há serviço nenhum, e três matizes arbitrários na barra seriam
   cor gasta sem informação. */
const ICONES = {
  fluxos: ["M3.5 5.5h4.2v4.2H3.5z", "M16.3 14.3h4.2v4.2h-4.2z",
           "M7.7 7.6h3.6a2.2 2.2 0 0 1 2.2 2.2v4.6a2.2 2.2 0 0 0 2.2 2.2h.6",
           "M7.7 7.6h.01"],
  disco:  ["M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2z",
           "M12 9.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z",
           "M17.3 7.2l-3.6 3.4"],
  tester: ["M9.3 3.8h5.4",
           "M10.4 3.8v5.1l-3.9 7.6a2.1 2.1 0 0 0 1.9 3.1h7.2a2.1 2.1 0 0 0 1.9-3.1l-3.9-7.6V3.8",
           "M7.6 14.6h8.8"]
};

const ico = (k, s = 15) =>
  '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
  + ICONES[k].map(d => '<path d="' + d + '" stroke="currentColor" stroke-width="1.9"'
      + ' stroke-linecap="round" stroke-linejoin="round"/>').join("")
  + "</svg>";

/* As três portas. `fato` e `sinal` são AMOSTRA, e cada preview que os mostrar
   tem que dizer isso na tela: eles provam que a barra aguenta a informação, não
   afirmam o estado de agora. */
const PORTAS = [
  { id: "fluxos", href: "#fluxos", rot: "Fluxos", sufixo: "fluxos n8n",
    desc: "o que rodou, o que quebrou e em qual nó",
    fato: "2 falhas · 24h", sinal: "risk", tecla: "1" },
  { id: "disco", href: "#disco", rot: "Disco", sufixo: "disco",
    desc: "os projetos no disco: vivos, parados, apodrecendo",
    fato: "21 projetos", sinal: "cold", tecla: "2" },
  { id: "tester", href: "#tester", rot: "Tester", sufixo: "tester",
    desc: "descreve a ideia, sai o fluxo desenhado",
    fato: "1 construindo", sinal: "accent", tecla: "3" }
];

/* A chama sai do arquivo real. Redesenhá-la no preview era o jeito mais fácil de
   a tela mostrar uma marca que o produto não tem. */
function chamaDe(html) {
  const m = html.match(/<svg width="16" height="18"[\s\S]*?<\/svg>/);
  if (!m) throw new Error("wordmark/chama não encontrada no arquivo de origem");
  return m[0];
}

/* O bloco <style> do arquivo de origem, inteiro. Tokens, topbar, .btn, .beam,
   .livedot, modo gravação — tudo o que faz a barra do preview ser a barra real. */
function cssDe(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("bloco <style> não encontrado no arquivo de origem");
  return m[1];
}

module.exports = { ICONES, ico, PORTAS, chamaDe, cssDe };
