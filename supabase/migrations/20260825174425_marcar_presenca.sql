-- `visto_em` passa a ser escrito, e a própria pessoa é quem escreve.
--
-- POR QUE ISTO EXISTE: o Kauan pediu um contador de "quantos usuários estão
-- usando o cockpit". A coluna `visto_em` estava na tabela desde a primeira
-- migration e NINGUÉM escrevia nela — então o único número disponível era
-- "quantos perfis existem aprovados", e chamar isso de "usando" seria número
-- inventado. Aprovado é quem PODE entrar; visto é quem entrou.
--
-- A DIFERENÇA IMPORTA porque as duas levam a decisões opostas: 12 aprovados e 2
-- vistos na semana é um produto que ninguém abre, e o painel diria "12 usuários"
-- com a mesma cara de sucesso.
--
-- ─────────────────────────────── o buraco que abrir esta escrita cria, e a cerca
--
-- Para marcar presença a pessoa precisa de um `update` na própria linha. Mas
-- `status` está no `grant update` de coluna (o super admin precisa dele), e
-- privilégio de coluna é por PAPEL do Postgres — admin, operador e super admin
-- são todos `authenticated`. Logo, uma política de `update` na própria linha,
-- sozinha, é AUTO-APROVAÇÃO: qualquer pessoa pendente escreveria
-- `status = 'aprovado'` em si mesma e entraria.
--
-- Então a política vem junto com o guarda ampliado: NA PRÓPRIA LINHA, quem não é
-- super admin só pode mexer em `visto_em`. Qualquer outra coluna diferente da
-- anterior derruba a transação.

create policy "perfil proprio, marca presenca" on public.perfis
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function private.guardar_colunas_de_perfil()
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

  /* A PRÓPRIA LINHA: só presença. Esta checagem vem ANTES das outras porque é a
     mais restritiva das duas e porque é ela que fecha a auto-aprovação — as
     comparações coluna a coluna abaixo permitem `status`, que aqui não pode. */
  if new.id = (select auth.uid()) then
    if (new.email, new.nome, new.avatar_url, new.status, new.super_admin, new.papel,
        new.organizacao_id, new.pedido_em, new.decidido_em, new.decidido_por, new.motivo)
       is distinct from
       (old.email, old.nome, old.avatar_url, old.status, old.super_admin, old.papel,
        old.organizacao_id, old.pedido_em, old.decidido_em, old.decidido_por, old.motivo)
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

  return new;
end;
$$;

/* A consulta do contador é sempre a mesma: quem foi visto desde tal data. */
create index perfis_por_presenca on public.perfis (visto_em) where visto_em is not null;
