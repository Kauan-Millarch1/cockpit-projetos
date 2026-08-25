-- As duas funções saem de `public` e vão para um schema que a API não expõe.
--
-- MEDIDO com `get_advisors` logo depois da migration anterior: quatro avisos,
-- todos com a mesma causa. `revoke execute on function ... from public` NÃO tira
-- o privilégio de `anon` nem de `authenticated` — o Supabase concede a esses dois
-- papéis explicitamente, e um `revoke from public` não alcança concessão
-- nominal. Resultado: `public.eh_super_admin()` e `public.ao_criar_usuario()`
-- ficaram chamáveis por qualquer um em `/rest/v1/rpc/<nome>`.
--
-- Chamar `ao_criar_usuario()` direto quebra sozinho (o Postgres recusa função de
-- gatilho fora de gatilho), e `eh_super_admin()` devolveria `false` para o `anon`.
-- Ou seja: o risco medido hoje é baixo. **Não é por isso que fica.** Uma função
-- `security definer` exposta na API é superfície que só precisa de um refactor
-- distraído para virar buraco, e a correção custa uma migration.
--
-- `revoke` nominal de `anon`/`authenticated` seria a correção mínima. O schema
-- privado é melhor porque é ESTRUTURAL: o PostgREST expõe `public` e
-- `graphql_public`, e nada mais. Uma função criada em `private` amanhã nasce
-- fora da API sem ninguém lembrar de revogar nada.

create schema if not exists private;

revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated, supabase_auth_admin;

-- ─────────────────────────────────────────────────── eh_super_admin -> private
--
-- As políticas dependem da função, então a ordem é: derruba as políticas,
-- derruba a função, recria no lugar certo, recria as políticas.

drop policy "super admin le todos"       on public.perfis;
drop policy "super admin decide"         on public.perfis;
drop policy "so super admin ve convites" on public.convites;
drop policy "so super admin cria convite" on public.convites;
drop policy "so super admin apaga convite" on public.convites;

drop function public.eh_super_admin();

create function private.eh_super_admin()
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

-- A expressão de uma política é avaliada COMO O USUÁRIO QUE CONSULTA, então
-- `authenticated` precisa de EXECUTE aqui. Este `grant` não é descuido: é o que
-- faz as políticas abaixo funcionarem. O que muda em relação a antes é que a
-- função não está mais num schema que a API publica.
grant execute on function private.eh_super_admin() to authenticated;

create policy "super admin le todos" on public.perfis
  for select to authenticated
  using (private.eh_super_admin());

create policy "super admin decide" on public.perfis
  for update to authenticated
  using (private.eh_super_admin())
  with check (private.eh_super_admin());

create policy "so super admin ve convites" on public.convites
  for select to authenticated using (private.eh_super_admin());

create policy "so super admin cria convite" on public.convites
  for insert to authenticated with check (private.eh_super_admin());

create policy "so super admin apaga convite" on public.convites
  for delete to authenticated using (private.eh_super_admin());

-- ───────────────────────────────────────────────── ao_criar_usuario -> private

drop trigger ao_criar_usuario on auth.users;
drop function public.ao_criar_usuario();

create function private.ao_criar_usuario()
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

-- Quem dispara o gatilho é o `supabase_auth_admin`, no insert em `auth.users`.
-- Sem este grant o cadastro falha inteiro — e falharia no PRIMEIRO login, que é
-- o pior lugar para descobrir.
revoke execute on function private.ao_criar_usuario() from public;
grant execute on function private.ao_criar_usuario() to supabase_auth_admin;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function private.ao_criar_usuario();
