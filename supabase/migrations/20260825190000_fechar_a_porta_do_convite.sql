-- Remediação de segurança, 2026-08-25. Auditoria adversarial sobre as cinco
-- migrations anteriores.
--
-- O que ESTAVA certo, dito primeiro para o resto ficar em proporção: RLS ligado
-- nas três tabelas, `set search_path = ''` nas oito funções `security definer`,
-- nenhuma política com `using (true)`, todo predicado de inquilino comparando
-- contra o CHAMADOR (`private.minha_org()` / `auth.uid()`) e nunca contra valor
-- vindo do cliente, e `super_admin` fora de todo `grant` de coluna. Não há
-- leitura cruzada entre organizações neste esquema.
--
-- A escalada não estava na camada de política. Estava na PORTA DE ENTRADA.

-- ═══════════════════════════════════════════ 1. o convite de e-mail não provado
--
-- CRÍTICO. `ao_criar_usuario` disparava `after insert on auth.users` e casava o
-- convite por `new.email` SOZINHO — sem `email_confirmed_at`, sem provedor, sem
-- `usado_em is null`. E `config.toml` trazia `enable_confirmations = false` com
-- `enable_signup = true` e senha mínima de 6.
--
-- O ataque não precisava de nenhuma falha de lógica SQL: um POST em
-- `/auth/v1/signup` com o e-mail do dono — que está EM TEXTO PURO NESTE
-- REPOSITÓRIO, na migration do bootstrap — e seis caracteres de senha. O GoTrue
-- insere em `auth.users` e devolve access_token na mesma resposta. O gatilho lia
-- `convites` e o perfil nascia `status='aprovado', super_admin=true`. Dali o
-- atacante passa em `private.eh_super_admin()` e é dono de todas as políticas:
-- lê o perfil de todas as organizações, lê todos os convites, cria organização,
-- levanta `teto_operadores`, atribui `papel`. O mesmo vale para QUALQUER convite
-- que um admin criar — registrar o e-mail do colega primeiro entra no inquilino
-- dele.
--
-- É exatamente a corrida que o `CONTRATO-PERFIL.md` §6 diz ter recusado ("não
-- vale 'o primeiro que logar vira super admin'"). O bootstrap por convite a
-- reintroduziu, estreitada a um endereço — publicado.
--
-- A virada em `config.toml` é CARREGADA, não opcional: com confirmação
-- desligada o GoTrue carimba `email_confirmed_at` no próprio INSERT e a
-- checagem abaixo não checa nada. O SQL aqui é a segunda camada, não a primeira.

create or replace function private.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite  public.convites%rowtype;
  provedor text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
begin
  /* `lower()` nos dois lados: o GoTrue minúsculiza o e-mail no cadastro e a rota
     de convite grava o que o admin digitou. `Maria@Empresa.com` nunca casava — a
     pessoa caía em `pendente` COM A VAGA JÁ COBRADA, e o contador é monotônico
     de propósito. O teto de 3 era esgotável por erro de digitação.

     `usado_em is null`: o convite serve UMA vez. Sem isso ele era reexecutável —
     `perfis.id` é `on delete cascade` de `auth.users`, então apagar o usuário
     largava o convite intacto e ainda casando, e recadastrar devolvia
     `aprovado` + `papel` + `organizacao_id` de graça. Para a linha semeada,
     devolvia `super_admin = true`. */
  select * into convite
    from public.convites c
   where lower(c.email) = lower(new.email)
     and c.usado_em is null;

  /* E-MAIL NÃO PROVADO NÃO HERDA NADA. Provado é: confirmado por clique, ou
     vindo de um provedor externo que já provou. Um endereço conhecido mais uma
     senha de seis caracteres não é prova de coisa nenhuma. */
  if convite.email is not null
     and provedor = 'email'
     and new.email_confirmed_at is null then
    convite := null;
  end if;

  /* E super admin não nasce de senha, nem com o e-mail confirmado: o caminho
     dele é provedor externo. Recusar aqui é ruidoso de propósito — cair em
     `pendente` em silêncio esconderia a tentativa de quem precisa vê-la. */
  if coalesce(convite.super_admin, false) and provedor = 'email' then
    raise exception 'super admin só entra por provedor externo'
      using errcode = '42501';
  end if;

  insert into public.perfis (
    id, email, nome, avatar_url, status, super_admin, papel, organizacao_id, convidado_por
  )
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    case when convite.email is null
         then 'pendente'::public.perfil_status
         else 'aprovado'::public.perfil_status end,
    coalesce(convite.super_admin, false),
    convite.papel,
    convite.organizacao_id,
    convite.criado_por
  )
  on conflict (id) do nothing;

  if convite.email is not null then
    update public.convites set usado_em = now()
     where lower(email) = lower(convite.email) and usado_em is null;
  end if;

  return new;
end;
$$;

/* O predicado novo do `select` acima, indexado — e ÚNICO por `lower(email)` nos
   abertos, que é o que impede duas linhas diferindo só na caixa de cobrarem duas
   vagas para a mesma pessoa. */
create unique index if not exists convites_abertos
  on public.convites (lower(email)) where usado_em is null;

-- ═══════════════════════════════════════════════ 2. a vaga queimada sem linha
--
-- `cobrar_teto_vagas` era BEFORE INSERT. O PostgREST traduz
-- `Prefer: resolution=ignore-duplicates` para `on conflict do nothing`: o gatilho
-- BEFORE dispara e comita `vagas_usadas + 1`, e então a linha é descartada em
-- silêncio. O contador nunca é devolvido, por desenho. Um duplo clique ou um
-- convite reenviado destruía uma das três vagas PARA SEMPRE, sem linha nenhuma e
-- sem erro nenhum — que é a pior forma: o teto some e nada na tela diz por quê.
--
-- AFTER não dispara em linha pulada por `do nothing`, e o `raise exception`
-- continua abortando a instrução — o teto segue sendo invariante da tabela.
drop trigger if exists cobrar_teto_vagas on public.convites;
create trigger cobrar_teto_vagas
  after insert on public.convites
  for each row execute function private.cobrar_teto_vagas();

-- ═══════════════════════════════════════ 3. a autoria, carimbada e não declarada
--
-- Dois `grant` sem lista de coluna deixavam a PROCEDÊNCIA falsificável, num
-- esquema cuja premissa inteira é "quem ler sabe quem manda e desde quando":
--
--   · `grant insert on convites` — a política restringe `organizacao_id`,
--     `papel` e `super_admin`, e deixava `criado_por`, `criado_em` e `usado_em`
--     abertos. O admin A criava convite com `criado_por = <uuid do admin B>`, e o
--     gatilho copia isso para `perfis.convidado_por`: o registro de quem deixou
--     a pessoa entrar no inquilino nomeia um colega inocente.
--
--   · `grant update (decidido_em, decidido_por)` — nada forçava
--     `decidido_por = auth.uid()`, então A aprovava alguém assinando B, com data
--     retroativa.
--
-- Também em `organizacoes`: `grant insert` largo deixava `vagas_usadas`
-- escrevível na criação, contradizendo o comentário que diz "nem o super admin a
-- escreve pela API". Código e prosa discordavam; a prosa é a que estava certa.

revoke insert on public.convites from authenticated;
grant  insert (email, super_admin, papel, organizacao_id) on public.convites to authenticated;

revoke insert on public.organizacoes from authenticated;
grant  insert (nome, teto_operadores) on public.organizacoes to authenticated;

revoke update (decidido_por, decidido_em) on public.perfis from authenticated;

create or replace function private.carimbar_autoria_convite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.criado_por := (select auth.uid());
  new.usado_em   := null;   -- nasce aberto, sempre; quem fecha é o gatilho do cadastro
  return new;
end;
$$;
revoke execute on function private.carimbar_autoria_convite() from public;

drop trigger if exists carimbar_autoria_convite on public.convites;
create trigger carimbar_autoria_convite
  before insert on public.convites
  for each row execute function private.carimbar_autoria_convite();

create or replace function private.carimbar_decisao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decidido_por := (select auth.uid());
    new.decidido_em  := now();
  end if;
  return new;
end;
$$;
revoke execute on function private.carimbar_decisao() from public;

/* O NOME FOI ESCOLHIDO PELA ORDEM ALFABÉTICA, que é a ordem em que o Postgres
   dispara gatilhos do mesmo evento: `carimbar_decisao` < `cobrar_teto_no_perfil`
   < `guardar_colunas_de_perfil`. O guarda continua vendo o valor final, então a
   comparação da própria linha segue válida. Renomear este gatilho muda a ordem e
   quebra essa garantia EM SILÊNCIO — não há teste que pegue isso. */
drop trigger if exists carimbar_decisao on public.perfis;
create trigger carimbar_decisao
  before update on public.perfis
  for each row execute function private.carimbar_decisao();

-- ═══════════════════════════════ 4. a saída de emergência que não existia
--
-- `140856` promete que promover alguém que já existe "é ato de banco,
-- deliberadamente". Esse ato era IMPOSSÍVEL: `private.meu_perfil()` chaveia em
-- `auth.uid()`, que é NULL no psql, no editor SQL do Supabase e para
-- `service_role`. Então `coalesce(eu.super_admin,false)` dava false, `new.id =
-- auth.uid()` dava NULL, e caía direto no `raise exception`.
--
-- A única rota que sobrava era `alter table ... disable trigger`, que remove o
-- guarda de coluna para TODA sessão concorrente enquanto estiver desligado —
-- transformando a saída de emergência numa janela em que qualquer admin
-- reescreve `papel` e `organizacao_id`. A saída de emergência empurrava para a
-- coisa perigosa, e é sob pressão que alguém a usa.
--
-- `session_user` e NÃO `current_user`: dentro de um `security definer`
-- `current_user` é sempre o dono da função, e a checagem passaria SEMPRE. O
-- PostgREST conecta como `authenticator` e faz `set local role` — inclusive com a
-- service key — então este ramo é inalcançável por HTTP. `service_role` fica
-- deliberadamente de fora: ela é alcançável por cliente se a chave vazar, e a
-- auditoria de hoje encontrou exatamente essa chave em texto puro.
--
-- E `convidado_por` entra na tupla da própria linha. Não é escrevível hoje
-- (nenhum grant a nomeia), mas o guarda É a lista: no dia em que alguém
-- acrescentar o grant, nada ficaria vermelho.

create or replace function private.guardar_colunas_de_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  eu record;
begin
  if (select auth.uid()) is null and session_user = 'postgres' then
    return new;   -- sessão de banco, não requisição da API
  end if;

  select * into eu from private.meu_perfil();

  if coalesce(eu.super_admin, false) then
    return new;   -- o super admin move tudo
  end if;

  if new.id = (select auth.uid()) then
    if (new.email, new.nome, new.avatar_url, new.status, new.super_admin, new.papel,
        new.organizacao_id, new.convidado_por, new.pedido_em, new.decidido_em,
        new.decidido_por, new.motivo)
       is distinct from
       (old.email, old.nome, old.avatar_url, old.status, old.super_admin, old.papel,
        old.organizacao_id, old.convidado_por, old.pedido_em, old.decidido_em,
        old.decidido_por, old.motivo)
    then
      raise exception 'na sua própria linha você só pode marcar presença'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.super_admin is distinct from old.super_admin then
    raise exception 'só o super admin muda super_admin' using errcode = '42501';
  end if;
  if new.papel is distinct from old.papel then
    raise exception 'só o super admin muda o cargo' using errcode = '42501';
  end if;
  if new.organizacao_id is distinct from old.organizacao_id then
    raise exception 'só o super admin move alguém de organização' using errcode = '42501';
  end if;
  if new.convidado_por is distinct from old.convidado_por then
    raise exception 'convidado_por não muda' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ═══════════════════════════════ 5. o `with check` mais fraco que o `using`
--
-- `admin decide a equipe` levava quatro predicados no `using` e dois no
-- `with check` — largava `id <> auth.uid()` e `super_admin = false`. Hoje o
-- gatilho fecha o buraco, e é por isso que não é explorável agora. Passa a ser no
-- instante em que o gatilho for desligado (o que o item 4 acima justamente
-- deixava de empurrar) ou em que uma coluna entrar no grant. Uma política não
-- pode depender de um gatilho para ter a forma certa.

drop policy if exists "admin decide a equipe" on public.perfis;
create policy "admin decide a equipe" on public.perfis
  for update to authenticated
  using (
    private.eh_admin()
    and organizacao_id = private.minha_org()
    and id <> (select auth.uid())
    and super_admin = false
  )
  with check (
    private.eh_admin()
    and organizacao_id = private.minha_org()
    and id <> (select auth.uid())
    and super_admin = false
  );

-- ═══════════════════════════════ 6. o `execute` que o Postgres dá de graça
--
-- `141019` afirma que o schema `private` é proteção ESTRUTURAL — "uma função
-- criada em `private` amanhã nasce fora da API sem ninguém lembrar de revogar
-- nada". Metade disso é verdade: ela nasce fora da lista de schemas do
-- PostgREST. A outra metade não: o Postgres concede `execute` a `PUBLIC` em toda
-- função nova por padrão, e só `ao_criar_usuario` tinha o `revoke`.
--
-- Não é explorável hoje (o PostgREST expõe só `public` e `graphql_public`), e é
-- por isso que é MÉDIO e não ALTO. Mas a afirmação era mais forte do que a
-- realidade — e uma `private.aprovar(uuid)` criada amanhã nasceria com
-- `execute to public`, que é o caso que a prosa promete impossível.

alter default privileges in schema private revoke execute on functions from public;

revoke execute on function
  private.eh_super_admin(), private.meu_perfil(), private.eh_admin(),
  private.minha_org(), private.cobrar_teto_vagas(),
  private.cobrar_teto_no_perfil(), private.guardar_colunas_de_perfil()
from public;

grant execute on function
  private.eh_super_admin(), private.meu_perfil(), private.eh_admin(), private.minha_org()
to authenticated;
