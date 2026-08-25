"use strict";
/* perfil.js — quem é a pessoa, e se ela pode entrar. FATO, nunca juízo.
 *
 * Contrato: `CONTRATO-PERFIL.md`. Este módulo diz *tem sessão*, *o e-mail é
 * este*, *o status gravado é `pendente`*, *o Supabase respondeu 401*, *existem 3
 * pedidos*. Ele NUNCA diz que a conta está travada, nunca escolhe cor e nunca
 * escreve a frase em português sobre o que fazer a seguir. Quem faz isso é o
 * bloco de juízo no topo de `entrar.html`, pelo mesmo motivo de sempre: a
 * definição de "pode entrar" é a parte que o Kauan ajusta mais, e espalhá-la
 * pelo servidor faz cada ajuste exigir reinício.
 *
 * ──────────────────────────────────────── O TETO, escrito e não implícito
 *
 * Login em `127.0.0.1:4317` é IDENTIDADE, NÃO CADEADO. Quem tem a máquina abre
 * este arquivo num editor, chama a rota com `curl` ou edita o `server.js`. O
 * próprio `guarda.decidir()` já escolhe isso de propósito: cliente local sem
 * `origin`, com o agente não pareado, passa sem token.
 *
 * O que esta fatia impede é a pessoa errada usar o painel pela porta da frente.
 * Onde a aprovação vira tranca de verdade é na porta hospedada — sem aprovação
 * não sai pacote e não sai pareamento, e isso é outra fatia.
 *
 * ─────────────────────────────────────────── ZERO DEPENDÊNCIA, como o resto
 *
 * Não entra `@supabase/supabase-js`, nem por npm nem por CDN. O fluxo é feito à
 * mão contra a API REST do Supabase Auth, do mesmo jeito que `guarda.js`
 * verifica JWT com o `crypto` do Node em vez de puxar o `jose`.
 *
 * ──────────────────────────────────── por que um leitor de `.env` PRÓPRIO aqui
 *
 * `n8n.js` tem `loadConfig()` e ele não é exportado — e, mais importante, um
 * `require("./n8n.js")` no topo EXECUTA esse `loadConfig()` só por carregar o
 * arquivo, que é exatamente o alerta que o `integracoes.js` já registrou: um
 * teste que apenas importa o módulo passaria a ler a chave de produção. Sete
 * linhas próprias custam menos que essa dependência.
 *
 * ───────────────────────────────────────── O TOKEN NUNCA CHEGA NO BROWSER
 *
 * A troca do código acontece aqui, no processo. O browser recebe um cookie
 * `HttpOnly` com um id OPACO. Motivo: este painel renderiza texto que vem do
 * n8n — conversa de lead, mensagem de erro, nome de nó — e a regra da casa é
 * que payload do n8n é hostil. Um token de sessão em `localStorage` seria a
 * primeira coisa a vazar num XSS.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/* Sessão em MEMÓRIA, e isso é uma decisão declarada, não um esquecimento.
 *
 * Persistir exigiria gravar o `refresh_token` — que é segredo — em disco, e o
 * `cofre.js` (DPAPI) é de uma vaga só, hoje reservada à chave do n8n. Guardar um
 * segredo novo em texto puro para poupar um login seria trocar a única coisa que
 * esta fatia protege por conveniência.
 *
 * A CONSEQUÊNCIA, que a tela tem que dizer: reiniciar o cockpit encerra a
 * sessão. Está registrado como dívida no §14 do contrato. */
const sessoes = new Map();      /* id opaco -> { access, refresh, expiraEm, sub, criadaEm } */
const pkceAbertos = new Map();  /* state -> { verificador, criadoEm, destino } */

const PKCE_VIDA_MS = 10 * 60 * 1000;   /* o tempo entre clicar e voltar do Google */
const SESSAO_VIDA_MS = 12 * 60 * 60 * 1000;
const MARGEM_RENOVACAO_MS = 60 * 1000; /* renova antes de vencer, não depois */
const TEMPO_LIMITE_MS = 15 * 1000;

/* ──────────────────────────────────────────────────────────────── configuração */

function lerEnv(dir) {
  const cfg = {};
  let txt = "";
  try { txt = fs.readFileSync(path.join(dir, ".env"), "utf8"); } catch { return cfg; }
  for (const linha of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return cfg;
}

function configurado(dir = __dirname) {
  const env = lerEnv(dir);
  const url = (env.SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const chave = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, chave, ok: Boolean(url && chave) };
}

/* ─────────────────────────────────────────────────────────────────── PKCE
 *
 * O `code_verifier` nasce e morre AQUI DENTRO e nunca vai ao browser. É o que
 * faz um código interceptado na barra de endereços não virar sessão: quem
 * troca o código é quem tem o verificador, e o browser não tem. */

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkce(aleatorio = crypto.randomBytes(32)) {
  const verificador = b64url(aleatorio);
  const desafio = b64url(crypto.createHash("sha256").update(verificador).digest());
  return { verificador, desafio };
}

/* PURA de propósito, pelo mesmo motivo de `resolverAlvo` e `custoDaRodada`: a
   montagem da URL tem que ser testável sem rede e sem browser. */
function urlAutorizacao({ base, provedor, redirectTo, desafio }) {
  const q = new URLSearchParams({
    provider: provedor,
    redirect_to: redirectTo,
    code_challenge: desafio,
    code_challenge_method: "s256"
  });
  return `${base}/auth/v1/authorize?${q}`;
}

/* ──────────────────────────────────────────────────────── chamadas ao Supabase */

async function chamar(cfg, caminho, { metodo = "GET", corpo = null, token = null, cabecalhos = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  try {
    const r = await fetch(`${cfg.url}${caminho}`, {
      method: metodo,
      signal: ctrl.signal,
      headers: {
        apikey: cfg.chave,
        authorization: `Bearer ${token || cfg.chave}`,
        "content-type": "application/json",
        ...cabecalhos
      },
      body: corpo === null ? undefined : JSON.stringify(corpo)
    });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    return { ok: r.ok, status: r.status, dados, bruto: dados === null ? texto : null };
  } finally {
    clearTimeout(t);
  }
}

/* ─────────────────────────────────────────────────────────── as duas entradas */

/* O `state` VIAJA DENTRO DO `redirect_to`, e isso não é gosto — é a única forma
 * que funciona. MEDIDO em 25/08/2026 contra a instância: o Supabase gera um
 * `state` PRÓPRIO para falar com o Google e NÃO devolve o nosso; a volta chega
 * só com `?code=`. Um `state` passado como parâmetro solto ao `/authorize`
 * simplesmente some, e `trocarCodigo` procuraria para sempre um pedido que
 * nunca é identificado — login quebrado em 100% das tentativas.
 *
 * Medido também que o query do `redirect_to` ATRAVESSA inteiro: mandando
 * `…/callback?s=ABC123`, o Google recebe `redirect_to=…%3Fs%3DABC123`.
 *
 * A alternativa era um cookie de curta vida com o `state`. Foi recusada por
 * causa do link por e-mail: ele pode ser aberto num navegador diferente daquele
 * onde o endereço foi digitado (cliente de e-mail abre o navegador padrão), e
 * ali o cookie não existe. No `redirect_to` tudo é do servidor e independe de
 * qual navegador abriu.
 *
 * O `state` não é segredo e não precisa ser: quem protege a troca é o
 * `code_verifier`, que fica neste processo e nunca sai. */
function comStateNaVolta(voltaBase, state) {
  return voltaBase + (voltaBase.includes("?") ? "&" : "?") + "s=" + encodeURIComponent(state);
}

function comecarGoogle(cfg, voltaBase, agora = Date.now()) {
  const { verificador, desafio } = pkce();
  const state = b64url(crypto.randomBytes(18));
  const redirectTo = comStateNaVolta(voltaBase, state);
  podar(agora);
  pkceAbertos.set(state, { verificador, criadoEm: agora, destino: redirectTo });
  return {
    state,
    url: urlAutorizacao({ base: cfg.url, provedor: "google", redirectTo, desafio })
  };
}

/* O magic link também é PKCE: o `verificador` fica aqui e o link que chega no
   e-mail dela carrega só o código. */
async function comecarEmail(cfg, email, voltaBase, agora = Date.now()) {
  const { verificador, desafio } = pkce();
  const state = b64url(crypto.randomBytes(18));
  const redirectTo = comStateNaVolta(voltaBase, state);
  podar(agora);
  pkceAbertos.set(state, { verificador, criadoEm: agora, destino: redirectTo });

  const r = await chamar(cfg, "/auth/v1/otp", {
    metodo: "POST",
    corpo: {
      email,
      create_user: true,
      code_challenge: desafio,
      code_challenge_method: "s256"
    },
    cabecalhos: { "redirect-to": redirectTo }
  });

  /* FATO, não juízo: devolve o que aconteceu. Quem decide que a tela diz a MESMA
     frase para e-mail conhecido e desconhecido é a rota — e ela decide isso
     porque respostas diferentes transformariam a tela de login num oráculo de
     "esta pessoa tem conta aqui". */
  /* `error_code` atravessa porque os 429 do Supabase NÃO são o mesmo problema e
     não têm a mesma saída. Medido em 25/08/2026 contra a instância:
     `over_email_send_rate_limit` é o teto do serviço de e-mail EMBUTIDO, que é
     do projeto inteiro e por hora; `over_request_rate_limit` é o intervalo de
     segundos entre dois pedidos da mesma pessoa. Um manda configurar SMTP, o
     outro manda esperar — e a rota é quem escreve a frase. */
  return {
    ok: r.ok, status: r.status, state,
    codigo: (r.dados && r.dados.error_code) || null,
    erro: r.ok ? null : mensagem(r)
  };
}

function podar(agora) {
  for (const [k, v] of pkceAbertos) if (agora - v.criadoEm > PKCE_VIDA_MS) pkceAbertos.delete(k);
  for (const [k, v] of sessoes) if (agora - v.criadaEm > SESSAO_VIDA_MS) sessoes.delete(k);
}

async function trocarCodigo(cfg, code, state, agora = Date.now()) {
  const aberto = pkceAbertos.get(state);
  if (!aberto) return { ok: false, status: 400, erro: "não encontrei o pedido de login que gerou este código" };
  if (agora - aberto.criadoEm > PKCE_VIDA_MS) {
    pkceAbertos.delete(state);
    return { ok: false, status: 400, erro: "o pedido de login expirou" };
  }
  pkceAbertos.delete(state);

  const r = await chamar(cfg, "/auth/v1/token?grant_type=pkce", {
    metodo: "POST",
    corpo: { auth_code: code, code_verifier: aberto.verificador }
  });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };

  const d = r.dados || {};
  if (!d.access_token) return { ok: false, status: 502, erro: "o Supabase respondeu sem access_token" };

  const id = b64url(crypto.randomBytes(24));
  sessoes.set(id, {
    access: d.access_token,
    refresh: d.refresh_token || null,
    expiraEm: agora + (Number(d.expires_in) || 3600) * 1000,
    sub: d.user && d.user.id ? d.user.id : null,
    criadaEm: agora
  });
  return { ok: true, id, destino: aberto.destino };
}

/* Renova ANTES de vencer, com margem. Renovar depois significa uma requisição
   que já falhou, e o painel mostraria "não consegui" por um erro nosso. */
async function tokenValido(cfg, id, agora = Date.now()) {
  const s = sessoes.get(id);
  if (!s) return { ok: false, motivo: "sessão desconhecida" };

  /* O TETO ABSOLUTO DE VIDA DA SESSÃO, conferido AQUI e não só no `podar()`.
   *
   * O DEFEITO: `podar()` só roda dentro de `comecarGoogle` e `comecarEmail` —
   * ou seja, quando alguém COMEÇA um login. Numa máquina onde o dono loga uma
   * vez e não loga mais (que é o caso normal deste painel), `podar()` nunca mais
   * roda, e `tokenValido` conferia unicamente o vencimento do access token, que
   * ele mesmo renova sozinho para sempre. Resultado: o id de sessão valia pelo
   * tempo de vida do processo.
   *
   * O `Max-Age` de 12h do cookie NÃO É a tranca, e é fácil confundir os dois: um
   * `Max-Age` é uma instrução ao browser, e quem copia o valor do cookie para um
   * `curl` (ou qualquer cliente que não seja browser) simplesmente não a obedece.
   * A única tranca real é a que o servidor confere, e é esta linha.
   *
   * CONFERIDO ANTES DE QUALQUER COISA — antes do ramo do access token e antes do
   * refresh — porque uma sessão vencida não pode gastar uma ida ao Supabase para
   * renovar o que já não vale: seria a rede sendo tocada por uma credencial que
   * este processo já decidiu recusar.
   *
   * A SESSÃO É APAGADA, e não só recusada: mantê-la no `Map` deixaria um segredo
   * (o `refresh_token`) vivo em memória depois de o processo já ter decidido que
   * ele não serve mais.
   *
   * O MOTIVO É DISTINTO dos outros dois de propósito. "sessão desconhecida" é
   * um id que nunca existiu (ou o cockpit reiniciou) e "sessão vencida e sem
   * renovação" é o Supabase que não deu refresh; este é o teto DELA, e leva a
   * uma frase diferente na tela: entrar de novo resolve, e vai resolver. Um
   * motivo repetido em dois estados ensina a ignorar os dois. O prazo sai
   * DERIVADO de `SESSAO_VIDA_MS` e não escrito à mão: uma frase com "12h"
   * literal ao lado de uma constante diverge no primeiro ajuste. */
  if (agora - s.criadaEm > SESSAO_VIDA_MS) {
    sessoes.delete(id);
    return {
      ok: false,
      motivo: "sessão vencida: passou do teto de "
        + Math.round(SESSAO_VIDA_MS / 3600000) + "h desde o login"
    };
  }

  if (agora < s.expiraEm - MARGEM_RENOVACAO_MS) return { ok: true, access: s.access, sub: s.sub };
  if (!s.refresh) { sessoes.delete(id); return { ok: false, motivo: "sessão vencida e sem renovação" }; }

  const r = await chamar(cfg, "/auth/v1/token?grant_type=refresh_token", {
    metodo: "POST",
    corpo: { refresh_token: s.refresh }
  });
  if (!r.ok || !r.dados || !r.dados.access_token) {
    sessoes.delete(id);
    return { ok: false, motivo: "não consegui renovar a sessão" };
  }
  s.access = r.dados.access_token;
  s.refresh = r.dados.refresh_token || s.refresh;
  s.expiraEm = agora + (Number(r.dados.expires_in) || 3600) * 1000;
  return { ok: true, access: s.access, sub: s.sub };
}

function encerrar(id) { return sessoes.delete(id); }

/* ────────────────────────────────────────────────────────────── o perfil e a fila
 *
 * Tudo abaixo passa pela RLS: a consulta vai com o token DELA, então o banco é
 * quem decide o que ela enxerga. A rota checar `superAdmin` no servidor é a
 * segunda camada, não a única — e as duas são reais, porque a tela esconder o
 * botão é conveniência e o banco recusar é a regra. */

const CAMPOS = "id,email,nome,avatar_url,status,super_admin,papel,organizacao_id,pedido_em,decidido_em,motivo,visto_em";
const CAMPOS_ORG = "id,nome,teto_operadores,vagas_usadas,criada_em";

async function eu(cfg, access) {
  const r = await chamar(cfg, `/rest/v1/perfis?select=${CAMPOS}`, { token: access });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  const linha = Array.isArray(r.dados) ? r.dados.find(l => l && l.id) || null : null;
  /* A RLS já devolve só a própria linha (mais todas, se for super admin — daí o
     `find` e não o `[0]` cego não bastar: ver `meuPerfil` na rota). */
  return { ok: true, perfil: linha, quantas: Array.isArray(r.dados) ? r.dados.length : 0 };
}

async function perfilDe(cfg, access, sub) {
  const r = await chamar(cfg, `/rest/v1/perfis?select=${CAMPOS}&id=eq.${encodeURIComponent(sub)}`, { token: access });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, perfil: (Array.isArray(r.dados) && r.dados[0]) || null };
}

async function pedidos(cfg, access) {
  const r = await chamar(
    cfg,
    `/rest/v1/perfis?select=${CAMPOS}&status=eq.pendente&order=pedido_em.asc`,
    { token: access }
  );
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, linhas: Array.isArray(r.dados) ? r.dados : [] };
}

async function todos(cfg, access) {
  const r = await chamar(cfg, `/rest/v1/perfis?select=${CAMPOS}&order=pedido_em.desc`, { token: access });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, linhas: Array.isArray(r.dados) ? r.dados : [] };
}

/* `papel` e `orgId` só viajam quando quem decide é o super admin — a rota é quem
 * sabe disso e é quem os passa ou omite. Aqui eles são opcionais e `undefined`
 * significa NÃO MEXER, que não é a mesma coisa que `null` (tirar o cargo). Duas
 * coisas diferentes precisam de dois valores diferentes, senão um admin tirando
 * alguém da equipe apagaria o cargo dessa pessoa sem ter pedido. */
async function decidir(cfg, access, { id, aprovar, motivo, porQuem, papel, orgId }) {
  const corpo = {
    status: aprovar ? "aprovado" : "recusado",
    motivo: motivo || null,
    decidido_em: new Date().toISOString(),
    decidido_por: porQuem || null
  };
  if (papel !== undefined) corpo.papel = papel;
  if (orgId !== undefined) corpo.organizacao_id = orgId;

  const r = await chamar(cfg, `/rest/v1/perfis?id=eq.${encodeURIComponent(id)}`, {
    metodo: "PATCH",
    token: access,
    cabecalhos: { prefer: "return=representation" },
    corpo
  });
  if (!r.ok) {
    const semVaga = /vagas de operador/i.test(mensagem(r));
    return { ok: false, status: semVaga ? 409 : r.status, semVaga, erro: mensagem(r) };
  }
  /* Zero linhas com 200 é RLS recusando em silêncio — o PostgREST não erra, ele
     simplesmente não encontra a linha. Sem esta checagem, recusar alguém sem
     permissão pintaria como sucesso na tela. */
  const linhas = Array.isArray(r.dados) ? r.dados : [];
  if (!linhas.length) return { ok: false, status: 403, erro: "nenhuma linha foi alterada" };
  return { ok: true, perfil: linhas[0] };
}

async function convidar(cfg, access, { email, porQuem }) {
  const r = await chamar(cfg, "/rest/v1/convites", {
    metodo: "POST",
    token: access,
    cabecalhos: { prefer: "return=representation,resolution=merge-duplicates" },
    corpo: { email, criado_por: porQuem || null }
  });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, convite: (Array.isArray(r.dados) && r.dados[0]) || null };
}

/* ─────────────────────────────────────────────────── organização e equipe
 *
 * Tudo aqui passa pela RLS com o token DELA. Um admin lê a organização dele e
 * mais nenhuma; um operador lê a dele e não lê a equipe. Este módulo não
 * verifica cargo nenhum — quem verifica é o banco, e a rota checa de novo antes
 * de deixar chamar. As duas camadas existem de verdade. */

/* Marca presença na própria linha. Só `visto_em` — o gatilho do banco recusa
 * qualquer outra coluna aqui, e é ele que impede a auto-aprovação que abrir esta
 * escrita criaria.
 *
 * NUNCA LANÇA e nunca é esperado com `await` na rota: falhar em anotar presença
 * não pode transformar "quem sou eu" em erro. Um contador que não subiu é uma
 * estatística errada; uma tela de conta que não abre é o painel fechado. */
async function marcarPresenca(cfg, access, sub) {
  try {
    await chamar(cfg, `/rest/v1/perfis?id=eq.${encodeURIComponent(sub)}`, {
      metodo: "PATCH",
      token: access,
      cabecalhos: { prefer: "return=minimal" },
      corpo: { visto_em: new Date().toISOString() }
    });
  } catch { /* ver o comentário acima */ }
}

async function organizacao(cfg, access, id) {
  if (!id) return { ok: true, org: null };
  const r = await chamar(cfg, `/rest/v1/organizacoes?select=${CAMPOS_ORG}&id=eq.${encodeURIComponent(id)}`, { token: access });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, org: (Array.isArray(r.dados) && r.dados[0]) || null };
}

async function organizacoes(cfg, access) {
  const r = await chamar(cfg, `/rest/v1/organizacoes?select=${CAMPOS_ORG}&order=criada_em.desc`, { token: access });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, linhas: Array.isArray(r.dados) ? r.dados : [] };
}

async function equipe(cfg, access, orgId) {
  if (!orgId) return { ok: true, linhas: [] };
  const r = await chamar(
    cfg,
    `/rest/v1/perfis?select=${CAMPOS}&organizacao_id=eq.${encodeURIComponent(orgId)}&order=pedido_em.asc`,
    { token: access }
  );
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, linhas: Array.isArray(r.dados) ? r.dados : [] };
}

async function criarOrganizacao(cfg, access, { nome, porQuem }) {
  const r = await chamar(cfg, "/rest/v1/organizacoes", {
    metodo: "POST",
    token: access,
    cabecalhos: { prefer: "return=representation" },
    corpo: { nome, criada_por: porQuem || null }
  });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, org: (Array.isArray(r.dados) && r.dados[0]) || null };
}

/* O convite com cargo e organização. O TETO NÃO É COBRADO AQUI — quem cobra é o
 * gatilho `cobrar_teto_vagas` no banco, e a recusa dele chega como um erro
 * `check_violation` que este módulo repassa. Cobrar aqui seria uma segunda
 * definição do teto, e a que divergisse seria a que ninguém olhou. */
async function convidarComCargo(cfg, access, { email, papel, orgId, porQuem }) {
  const r = await chamar(cfg, "/rest/v1/convites", {
    metodo: "POST",
    token: access,
    cabecalhos: { prefer: "return=representation" },
    corpo: { email, papel, organizacao_id: orgId || null, criado_por: porQuem || null }
  });
  if (!r.ok) {
    /* `23514` é o `check_violation` que o gatilho levanta quando as vagas
       acabaram. Vira um status próprio para a rota poder dizer a frase certa em
       vez de "erro no banco". */
    const semVaga = r.status === 400 && /vagas de operador/i.test(mensagem(r));
    return { ok: false, status: semVaga ? 409 : r.status, semVaga, erro: mensagem(r) };
  }
  return { ok: true, convite: (Array.isArray(r.dados) && r.dados[0]) || null };
}

async function convites(cfg, access) {
  const r = await chamar(cfg, "/rest/v1/convites?select=email,super_admin,criado_em,usado_em&order=criado_em.desc", { token: access });
  if (!r.ok) return { ok: false, status: r.status, erro: mensagem(r) };
  return { ok: true, linhas: Array.isArray(r.dados) ? r.dados : [] };
}

/* ───────────────────────────────────────────────────────────────── a varredura
 *
 * Mesma disciplina do `CONTRATO-INTEGRACOES.md` §4: a chave não pode aparecer em
 * campo nenhum da resposta, nem dentro de uma mensagem de erro. Aqui vale para a
 * chave do Supabase E para qualquer JWT, porque um `access_token` numa mensagem
 * de erro que a tela imprime é sessão vazando por um caminho que ninguém olha. */
function varrer(txt) {
  return String(txt == null ? "" : txt)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "<token>")
    .replace(/sb_(publishable|secret)_[A-Za-z0-9_-]+/g, "<chave>")
    .replace(/[A-Za-z0-9_-]{40,}/g, "<longo>");
}

function mensagem(r) {
  const d = r.dados || {};
  const bruta = d.error_description || d.msg || d.message || d.error || d.hint || r.bruto || `HTTP ${r.status}`;
  return varrer(bruta);
}

module.exports = {
  configurado, comecarGoogle, comecarEmail, trocarCodigo, tokenValido, encerrar,
  eu, perfilDe, pedidos, todos, decidir, convidar, convites,
  organizacao, organizacoes, equipe, criarOrganizacao, convidarComCargo, marcarPresenca,
  /* puras, expostas para o teste */
  pkce, urlAutorizacao, comStateNaVolta, varrer, lerEnv,
  /* estado, só para o teste inspecionar */
  _sessoes: () => sessoes,
  _pkce: () => pkceAbertos,
  PKCE_VIDA_MS, SESSAO_VIDA_MS, MARGEM_RENOVACAO_MS, CAMPOS
};
