-- Correção de uma regressão que a migration anterior (20260825190000) introduzia,
-- encontrada antes de ela ser aplicada em lugar nenhum.
--
-- Esta migration é IDEMPOTENTE e independente: usa `create or replace` e
-- `drop trigger if exists`, então funciona tenha a anterior sido aplicada ou não.
-- Foi escrita como arquivo novo em vez de edição da anterior justamente por isso —
-- editar uma migration que PODE já ter rodado é apostar no que não se sabe.
--
-- ═════════════════════════════════════════════════ o que estava errado, e por quê
--
-- A 20260825190000 fechou um CRÍTICO real: o convite era honrado por
-- `new.email` sozinho, sem prova de posse do endereço, então quem soubesse o
-- e-mail do dono — que está em texto puro na migration do bootstrap — nascia
-- `super_admin`. A exigência de `email_confirmed_at` está certa.
--
-- O que ela errou foi ONDE a exigência cai. `ao_criar_usuario` é
-- `after insert on auth.users`, e o login deste produto é MAGIC LINK:
-- `perfil.comecarEmail` chama `POST /auth/v1/otp` com `create_user: true`. O
-- GoTrue insere a linha NO PEDIDO DO LINK, com `email_confirmed_at` nulo; o
-- clique confirma depois, por UPDATE. Então no único instante em que o gatilho
-- rodava, a confirmação nunca podia estar lá — e não havia gatilho no UPDATE.
--
-- Resultado prático: TODO convite deixava de funcionar para magic link, que é o
-- único caminho de e-mail que existe. A pessoa liberada caía em `pendente` e o
-- convite ficava aberto para sempre, sem nunca ser aplicado. O mecanismo virava
-- enfeite, e em silêncio — a fila é um destino legítimo, então nada na tela
-- acusaria.
--
-- ═════════════════════════════════════════════════ o desenho, agora
--
-- A aplicação do convite sai do gatilho de INSERT e vira uma função chamada de
-- DOIS lugares: o insert (para quem já chega confirmado, que é o caso do OAuth)
-- e a confirmação (o clique do magic link). Uma definição, dois gatilhos — duas
-- cópias divergiriam no primeiro conserto feito de um lado só, e o lado que
-- divergisse decidiria quem entra aprovado.

create or replace function private.aplicar_convite(u auth.users)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite   public.convites%rowtype;
  /* `provedor` NAO entra aqui, e a ausencia e deliberada: a versao anterior
     decidia por ele e era isso que bloqueava o magic link. Quem decide e ter
     senha. Uma variavel lida por ninguem seria um contrato morto afirmando que
     o provedor importa. */
  tem_senha boolean := nullif(u.encrypted_password, '') is not null;
begin
  /* PROVA DE POSSE, e ela é a mesma para os dois caminhos. Sem isto o convite
     era honrado para um endereço que ninguém provou ter. */
  if u.email_confirmed_at is null then
    return;
  end if;

  /* `lower()` nos dois lados: o GoTrue minúsculiza no cadastro e a rota de
     convite grava o que o admin digitou. `usado_em is null`: o convite serve UMA
     vez — sem isso, apagar o usuário (`perfis.id` é `on delete cascade`) largava
     o convite intacto e recadastrar devolvia tudo de graça. */
  select * into convite
    from public.convites c
   where lower(c.email) = lower(u.email)
     and c.usado_em is null;

  if convite.email is null then
    return;
  end if;

  /* SUPER ADMIN NÃO NASCE DE SENHA, e o discriminador é TER SENHA — não o
     provedor.
     A versão anterior recusava por `provedor = 'email'`, e isso bloqueava o
     caminho legítimo: no magic link o provedor É `email`, então um convite de
     super admin nunca poderia ser resgatado pelo único caminho de e-mail do
     produto.
     O que o ataque precisava era de senha: cadastrar com 6 caracteres num
     endereço conhecido. Uma conta criada por OTP não tem `encrypted_password`, e
     uma criada por OAuth também não — então "tem senha" separa exatamente o
     caminho perigoso do seguro, e o magic link (que exige ler a caixa de
     entrada) passa.
     Isto é defesa em profundidade: com `enable_confirmations` ligado no projeto
     hospedado, o cadastro por senha também exige clique. Esta linha é o que
     segura se essa chave estiver desligada lá, e ela É desligável pelo painel. */
  if coalesce(convite.super_admin, false) and tem_senha then
    raise exception 'convite de super admin não se resgata com senha: entre pelo link do e-mail ou por provedor externo'
      using errcode = '42501';
  end if;

  /* ATRAVESSAR O GUARDA DE COLUNA, e isto foi MEDIDO no texto dele, não suposto.
     `guardar_colunas_de_perfil` só tem um desvio: `auth.uid() is null and
     session_user = 'postgres'`. Num UPDATE disparado pelo GoTrue o `session_user`
     é `supabase_auth_admin` e `auth.uid()` é nulo — então cai nas checagens de
     coluna e o `raise exception` de `super_admin`/`papel`/`organizacao_id`
     barraria o próprio convite. O login falharia no PRIMEIRO acesso da pessoa,
     que é o pior lugar para descobrir.
     A marca é `set_config(..., true)`: TRANSACTION-LOCAL. Ela morre no fim da
     transação e nenhum caminho da API a alcança — o PostgREST não executa SQL
     arbitrário e nenhuma função exposta a escreve. Não é uma porta nova, é o
     nome de quem já está autorizado a escrever ali. */
  perform set_config('app.convite_em_uso', '1', true);

  /* Só promove quem ainda está pendente. Um perfil já decidido não volta atrás
     por causa de um convite antigo. */
  update public.perfis set
    status         = 'aprovado'::public.perfil_status,
    super_admin    = coalesce(convite.super_admin, false),
    papel          = convite.papel,
    organizacao_id = convite.organizacao_id,
    convidado_por  = convite.criado_por
  where id = u.id
    and status = 'pendente'::public.perfil_status;

  perform set_config('app.convite_em_uso', '', true);

  update public.convites set usado_em = now()
   where lower(email) = lower(convite.email) and usado_em is null;
end;
$$;
revoke execute on function private.aplicar_convite(auth.users) from public;

-- ───────────────────────────────────────────────── o insert: nasce sempre pendente
--
-- O perfil nasce SEM privilégio, sempre, e o convite é aplicado por cima quando
-- (e se) a posse do e-mail estiver provada. Antes o `insert` decidia o `status`
-- num `case` — o que obrigava a decisão a caber num único instante, que é a
-- origem do defeito.

create or replace function private.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, email, nome, avatar_url, status, super_admin)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'pendente'::public.perfil_status,
    false
  )
  on conflict (id) do nothing;

  /* OAuth já chega confirmado, então para ele a decisão sai aqui mesmo. Magic
     link chega nulo e cai no gatilho de confirmação, abaixo. */
  perform private.aplicar_convite(new);
  return new;
end;
$$;

-- ───────────────────────────────────────────── a confirmação: o clique do link
--
-- Este é o gatilho que faltava. `after update of email_confirmed_at` dispara no
-- clique do magic link, que é o momento em que a posse do endereço passa a estar
-- provada — e portanto o único momento em que o convite pode ser honrado sem
-- confiar em quem digitou o e-mail.
--
-- A guarda `old is null and new is not null` existe para ele não reprocessar em
-- todo UPDATE da linha: o convite é de uso único e um segundo `aplicar_convite`
-- não faria mal, mas um gatilho que roda quando não precisa é um gatilho cujo
-- custo ninguém mediu.

create or replace function private.ao_confirmar_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform private.aplicar_convite(new);
  end if;
  return new;
end;
$$;
revoke execute on function private.ao_confirmar_email() from public;
grant  execute on function private.ao_confirmar_email() to supabase_auth_admin;

drop trigger if exists ao_confirmar_email on auth.users;
create trigger ao_confirmar_email
  after update of email_confirmed_at on auth.users
  for each row execute function private.ao_confirmar_email();

-- ───────────────────────────────────────────────────────────── o que NÃO mudou
--
-- O índice único `convites_abertos` por `lower(email)`, o `cobrar_teto_vagas`
-- movido para AFTER INSERT, os grants por coluna, o carimbo de autoria, a saída
-- de emergência do `session_user`, o `with check` simétrico e os revokes do
-- schema `private` seguem como a 20260825190000 os deixou. O defeito era só o
-- INSTANTE em que o convite era avaliado.

-- ─────────────────────────────── o guarda reconhece o convite, e nada mais
--
-- Sem esta releitura, o `UPDATE` de `aplicar_convite` bate no `raise exception` de
-- `super_admin`/`papel`/`organizacao_id` e o login falha no primeiro acesso da
-- pessoa. A marca é transaction-local e não é alcançável pela API: o PostgREST
-- não executa SQL arbitrário e nenhuma função exposta escreve nela.
--
-- Ela vem ANTES de tudo de propósito. Depois da leitura de `meu_perfil()` seria
-- o mesmo efeito com uma consulta a mais no caminho do login; e depois das
-- checagens de coluna não seria efeito nenhum.

create or replace function private.guardar_colunas_de_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  eu record;
begin
  if coalesce(current_setting('app.convite_em_uso', true), '') = '1' then
    return new;   -- o convite sendo aplicado por `private.aplicar_convite`
  end if;

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

-- `create or replace` PRESERVA os grants, mas reafirmar é barato e a alternativa
-- é um cadastro que falha no primeiro login por causa de um privilégio perdido
-- numa releitura futura.
revoke execute on function private.ao_criar_usuario() from public;
grant  execute on function private.ao_criar_usuario() to supabase_auth_admin;
