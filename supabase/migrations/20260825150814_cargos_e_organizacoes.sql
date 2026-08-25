-- Cargos, organizações e o teto de 3 vagas.
--
-- Três níveis, e cada um existe por um motivo diferente:
--
--   super_admin  o Kauan. Aprova ADMIN, cria organização, mexe no teto, vê tudo.
--   admin        o gerente da empresa cliente. Convida OPERADOR da org dele,
--                até o teto. Mexe em integração e chave.
--   operador     usa o painel para trabalhar. Não vê chave, não vê integração.
--
-- DECISÃO DO KAUAN, 25/08/2026, depois de eu recomendar o contrário: o teto é de
-- **3 PARA SEMPRE**, não 3 ao mesmo tempo. Então `vagas_usadas` é MONOTÔNICO —
-- ele sobe quando um convite de operador é criado e NUNCA desce. Apagar um
-- convite não usado, ou recusar um operador, não devolve vaga: devolver seria
-- transformar "para sempre" em "ao mesmo tempo" pela porta dos fundos.
--
-- A consequência está escrita porque é real: um e-mail digitado errado queima
-- uma vaga em definitivo. A tela avisa disso ANTES do clique, e a válvula é o
-- super admin subir `teto_operadores` da organização.
--
-- ADMIN NÃO CRIA ADMIN. Se pudesse, o teto de 3 vazaria numa linha: promove um
-- operador a admin e ele convida mais 3. Criar admin é ato do super admin.

create type public.papel_tipo as enum ('admin', 'operador');

-- ─────────────────────────────────────────────────────────────── organizações

create table public.organizacoes (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  teto_operadores int  not null default 3 check (teto_operadores >= 0),
  vagas_usadas    int  not null default 0 check (vagas_usadas >= 0),
  criada_em       timestamptz not null default now(),
  criada_por      uuid references auth.users (id) on delete set null
);

comment on column public.organizacoes.vagas_usadas is
  'MONOTÔNICO. Sobe a cada convite de operador e nunca desce — o teto é "3 para sempre".';
comment on column public.organizacoes.teto_operadores is
  'A válvula: só o super admin muda. É o caminho oficial quando um cliente precisa da quarta vaga.';

alter table public.organizacoes enable row level security;

-- ────────────────────────────────────────────────── perfis e convites crescem

-- `papel` era `text` e nascia NULL. Vira enum, e NULL continua sendo um valor
-- válido: quem entrou antes desta migration, e o próprio super admin, não têm
-- cargo de empresa nenhum. NULL aqui significa "sem cargo", não "cargo perdido".
alter table public.perfis
  alter column papel type public.papel_tipo using (nullif(papel, '')::public.papel_tipo);

alter table public.perfis
  add column organizacao_id uuid references public.organizacoes (id) on delete set null,
  add column convidado_por  uuid references auth.users (id) on delete set null;

alter table public.convites
  add column papel          public.papel_tipo,
  add column organizacao_id uuid references public.organizacoes (id) on delete cascade;

comment on column public.perfis.organizacao_id is
  'A empresa. NULL para o super admin e para quem entrou sem convite de uma org.';

create index perfis_por_org on public.perfis (organizacao_id) where organizacao_id is not null;

-- ──────────────────────────────────────────── quem sou eu, fora da política
--
-- Mesmo motivo do `eh_super_admin`: consultar `perfis` dentro de uma política de
-- `perfis` é recursão infinita. Uma leitura só, devolvendo o que as políticas
-- precisam, em vez de três funções que consultam a mesma linha três vezes.

create function private.meu_perfil()
returns table (uid uuid, super_admin boolean, papel public.papel_tipo, org uuid, status public.perfil_status)
language sql
security definer
stable
set search_path = ''
as $$
  select p.id, p.super_admin, p.papel, p.organizacao_id, p.status
  from public.perfis p
  where p.id = (select auth.uid());
$$;

grant execute on function private.meu_perfil() to authenticated;

-- Admin É admin, aprovado, e com organização. As três coisas juntas: um admin
-- recusado ou sem org não gerencia ninguém, e `coalesce(..., false)` mantém a
-- regra de que, numa permissão, ausente é "não".
create function private.eh_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select p.papel = 'admin'::public.papel_tipo
            and p.status = 'aprovado'::public.perfil_status
            and p.organizacao_id is not null
     from public.perfis p where p.id = (select auth.uid())),
    false
  );
$$;

grant execute on function private.eh_admin() to authenticated;

create function private.minha_org()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select p.organizacao_id from public.perfis p where p.id = (select auth.uid());
$$;

grant execute on function private.minha_org() to authenticated;

-- ─────────────────────────────────── o gatilho de nascimento aprende cargo e org

create or replace function private.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite public.convites%rowtype;
begin
  select * into convite from public.convites c where c.email = new.email;

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
    update public.convites set usado_em = now() where email = convite.email;
  end if;

  return new;
end;
$$;

-- ──────────────────────────────────── o teto, cobrado no banco e não na tela
--
-- Cobrar só na rota deixaria o teto valer enquanto ninguém chamar a API por
-- fora. Aqui ele é uma invariante da tabela: nenhum caminho cria a quarta vaga.

create function private.cobrar_teto_vagas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizacoes%rowtype;
begin
  if new.papel is distinct from 'operador'::public.papel_tipo or new.organizacao_id is null then
    return new;   -- convite de admin, ou convite sem org: não consome vaga
  end if;

  select * into org from public.organizacoes o where o.id = new.organizacao_id for update;
  if org.id is null then
    raise exception 'organização % não existe', new.organizacao_id;
  end if;

  if org.vagas_usadas >= org.teto_operadores then
    raise exception 'a organização % já usou as % vagas de operador', org.nome, org.teto_operadores
      using errcode = 'check_violation';
  end if;

  -- MONOTÔNICO: sobe aqui e não desce em lugar nenhum deste esquema.
  update public.organizacoes set vagas_usadas = vagas_usadas + 1 where id = org.id;
  return new;
end;
$$;

create trigger cobrar_teto_vagas
  before insert on public.convites
  for each row execute function private.cobrar_teto_vagas();

-- ───────────────────────── o que um `update` NÃO pode mudar, por quem não é você
--
-- `grant update (colunas)` é por PAPEL do Postgres, e admin e super admin são os
-- dois `authenticated` — então privilégio de coluna não separa os dois. Uma
-- política também não serve: `using` enxerga o OLD, `with check` enxerga o NEW, e
-- nenhuma das duas compara os dois. Sobra o gatilho, e é ele quem carrega a
-- regra: um admin move `status` da equipe dele e mais nada.

create function private.guardar_colunas_de_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  eu record;
begin
  select * into eu from private.meu_perfil();

  if coalesce(eu.super_admin, false) then
    return new;   -- o super admin move tudo
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

  return new;
end;
$$;

create trigger guardar_colunas_de_perfil
  before update on public.perfis
  for each row execute function private.guardar_colunas_de_perfil();

-- ─────────────────────────────────────────────────────────────────────── RLS

-- perfis: o admin enxerga e decide sobre a equipe DELE, e sobre mais ninguém.
create policy "admin le a equipe" on public.perfis
  for select to authenticated
  using (private.eh_admin() and organizacao_id = private.minha_org());

create policy "admin decide a equipe" on public.perfis
  for update to authenticated
  using (
    private.eh_admin()
    and organizacao_id = private.minha_org()
    and id <> (select auth.uid())          -- ninguém decide sobre a própria conta
    and super_admin = false
  )
  with check (
    private.eh_admin()
    and organizacao_id = private.minha_org()
  );

-- convites: o admin vê e cria os da org dele. NÃO apaga — apagar não devolveria
-- vaga (o teto é "para sempre") e daria a impressão de que devolve.
create policy "admin ve convites da org" on public.convites
  for select to authenticated
  using (private.eh_admin() and organizacao_id = private.minha_org());

create policy "admin convida operador da org" on public.convites
  for insert to authenticated
  with check (
    private.eh_admin()
    and organizacao_id = private.minha_org()
    and papel = 'operador'::public.papel_tipo
    and super_admin = false
  );

-- organizações: cada um lê a sua; só o super admin cria e mexe no teto.
create policy "leio a minha organizacao" on public.organizacoes
  for select to authenticated
  using (id = private.minha_org() or private.eh_super_admin());

create policy "super admin cria organizacao" on public.organizacoes
  for insert to authenticated with check (private.eh_super_admin());

create policy "super admin mexe na organizacao" on public.organizacoes
  for update to authenticated
  using (private.eh_super_admin()) with check (private.eh_super_admin());

revoke all on public.organizacoes from anon, authenticated;
grant select on public.organizacoes to authenticated;
grant insert, update (nome, teto_operadores) on public.organizacoes to authenticated;

-- `vagas_usadas` fica FORA do grant: nem o super admin a escreve pela API. Quem
-- move esse número é o gatilho do teto, e só ele. Um contador que a aplicação
-- pode reescrever não é um teto, é uma sugestão.

-- `papel` e `organizacao_id` PRECISAM estar no grant, e a razão é a mesma que já
-- obrigou o gatilho acima a existir: privilégio de coluna é por PAPEL do
-- Postgres, e admin e super admin são os dois `authenticated`. Tirar do grant
-- para barrar o admin barraria o super admin junto, e ele não teria como dar
-- cargo a ninguém pela API.
--
-- Então quem separa os dois é `guardar_colunas_de_perfil`, e não este grant.
-- `super_admin` continua fora do grant porque ali NINGUÉM precisa escrever pela
-- API: super admin nasce de `convites.super_admin`, que é ato de banco.
grant update (organizacao_id, papel) on public.perfis to authenticated;
