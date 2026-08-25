-- Perfil, aprovação de entrada e super admin.
-- Contrato: CONTRATO-PERFIL.md §4, §5, §6.
--
-- Duas metades do mesmo mecanismo: convite existe -> o perfil nasce `aprovado`;
-- convite não existe -> nasce `pendente` e cai na fila do super admin. "Eu
-- adiciono o e-mail dela" e "ela pede e eu aprovo" não são dois caminhos de
-- código.

create type public.perfil_status as enum ('pendente', 'aprovado', 'recusado');

-- ─────────────────────────────────────────────────────────────────── convites
--
-- Quem já pode entrar ANTES de existir. Não pode ser uma linha em `perfis`:
-- `perfis.id` referencia `auth.users`, que só existe depois do primeiro login.
create table public.convites (
  email       text primary key,
  super_admin boolean not null default false,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users (id) on delete set null,
  usado_em    timestamptz
);

comment on table public.convites is
  'E-mails liberados antes do primeiro login. O gatilho ao_criar_usuario lê daqui.';
comment on column public.convites.super_admin is
  'Único caminho de aplicação para criar um super admin. Ver a nota de privilégio no fim deste arquivo.';

-- ───────────────────────────────────────────────────────────────────── perfis

create table public.perfis (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  nome         text,
  avatar_url   text,
  status       public.perfil_status not null default 'pendente',
  super_admin  boolean not null default false,
  papel        text,
  pedido_em    timestamptz not null default now(),
  decidido_em  timestamptz,
  decidido_por uuid references auth.users (id) on delete set null,
  motivo       text,
  visto_em     timestamptz
);

-- `papel` nasce NULL de propósito: pedido explícito do Kauan, "toda pessoa entra
-- sem cargo/tag". `super_admin` é coluna própria e não um valor de `papel`
-- porque `papel` vai crescer, e a permissão mais perigosa do sistema não pode
-- ficar pendurada no campo que mais muda.
comment on column public.perfis.papel is
  'Cargo. NULL até a fatia de permissões existir. Nunca use para super admin.';
comment on column public.perfis.motivo is
  'Por que foi recusado. Vai para a tela DELA — escreva pensando nisso.';

-- A fila do super admin é sempre a mesma consulta.
create index perfis_fila on public.perfis (pedido_em) where status = 'pendente';

-- ──────────────────────────────────────────────── quem é super admin, sem recursão
--
-- A política óbvia ("super admin lê todos os perfis") precisaria consultar
-- `perfis` para saber se você é super admin, e isso é
-- `infinite recursion detected in policy for relation "perfis"`.
-- `security definer` lê a tabela FORA da política e corta o ciclo.
--
-- `set search_path = ''` não é formalidade: a função roda como dono do banco, e
-- sem isso quem conseguir criar um `perfis` num schema que venha antes no
-- search_path faz o dono do banco ler a tabela dele.
--
-- `coalesce(..., false)`: ausente nunca cai no ramo positivo. Numa permissão o
-- silêncio é "não".
--
-- `(select auth.uid())` entre parênteses, não `auth.uid()` pelado: o Postgres
-- avalia o subselect uma vez por consulta em vez de uma vez por linha.
create function public.eh_super_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select p.super_admin from public.perfis p where p.id = (select auth.uid())),
    false
  );
$$;

revoke execute on function public.eh_super_admin() from public;
grant execute on function public.eh_super_admin() to authenticated;

-- ──────────────────────────────────────────── o perfil nasce com o usuário
--
-- `security definer` porque roda em `auth.users`, que o usuário não alcança.
create function public.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite public.convites%rowtype;
begin
  select * into convite from public.convites c where c.email = new.email;

  insert into public.perfis (id, email, nome, avatar_url, status, super_admin)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    case when convite.email is null
         then 'pendente'::public.perfil_status
         else 'aprovado'::public.perfil_status end,
    coalesce(convite.super_admin, false)
  )
  on conflict (id) do nothing;

  if convite.email is not null then
    update public.convites set usado_em = now() where email = convite.email;
  end if;

  return new;
end;
$$;

revoke execute on function public.ao_criar_usuario() from public;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- ───────────────────────────────────────────────────────────────────────── RLS

alter table public.perfis enable row level security;
alter table public.convites enable row level security;

-- `perfis`: a pessoa lê a própria linha; o super admin lê e decide todas.
-- Não existe política de `insert` nem de `delete`: quem cria é o gatilho, quem
-- apaga é a cascata de `auth.users`.
create policy "perfil proprio, leitura" on public.perfis
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "super admin le todos" on public.perfis
  for select to authenticated
  using (public.eh_super_admin());

create policy "super admin decide" on public.perfis
  for update to authenticated
  using (public.eh_super_admin())
  with check (public.eh_super_admin());

-- `convites` é informação sobre TERCEIROS: quem foi convidado, e quando. Nem
-- `select` para quem não é super admin.
create policy "so super admin ve convites" on public.convites
  for select to authenticated using (public.eh_super_admin());

create policy "so super admin cria convite" on public.convites
  for insert to authenticated with check (public.eh_super_admin());

create policy "so super admin apaga convite" on public.convites
  for delete to authenticated using (public.eh_super_admin());

-- ─────────────────────────────── privilégio de COLUNA, que a RLS não sabe fazer
--
-- RLS decide LINHA. Ela não impede que um `update` autorizado escreva qualquer
-- coluna daquela linha. Então `super_admin` sai do `grant`: NENHUMA rota da
-- aplicação, com qualquer sessão, consegue promover alguém que já existe.
--
-- O único caminho de aplicação para criar um super admin é `convites.super_admin`
-- antes do primeiro login — que é ato de um super admin e fica gravado com autor
-- e data. Promover alguém que JÁ existe é ato de banco, deliberadamente.
revoke all on public.perfis from anon, authenticated;
grant select on public.perfis to authenticated;
grant update (status, motivo, decidido_em, decidido_por, papel, visto_em)
  on public.perfis to authenticated;

revoke all on public.convites from anon, authenticated;
grant select, insert, delete on public.convites to authenticated;

-- ──────────────────────────────────────────────────────────── o primeiro super admin
--
-- Não pode nascer de um clique: não existe tela para clicar antes de existir
-- super admin. E "o primeiro que logar vira super admin" é corrida — quem chegar
-- primeiro na instância recém-criada leva o painel inteiro.
--
-- Nasce aqui, por extenso, versionado: quem ler o repositório sabe quem manda e
-- desde quando.
insert into public.convites (email, super_admin)
values ('kauan.millarch@ecommercepuro.com.br', true)
on conflict (email) do update set super_admin = true;
