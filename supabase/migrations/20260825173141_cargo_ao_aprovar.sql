-- O teto de vagas também vale quando o cargo é dado DEPOIS.
--
-- O BURACO, achado pelo Kauan olhando a tela: `cobrar_teto_vagas` cobra no
-- INSERT em `convites`. Quem se cadastra sozinho não passa por convite nenhum —
-- entra `pendente`, o super admin aprova, e se essa aprovação também desse o
-- cargo de operador, a vaga seria criada por um caminho que não conta vaga.
-- Três aprovações e a organização teria 6 operadores com `vagas_usadas = 3`.
--
-- Não dá para mover a cobrança para `perfis` e tirar de `convites`: o convite
-- existe justamente para reservar a vaga ANTES de a pessoa existir, senão o
-- admin convida 5 e descobre no terceiro login que só cabiam 3. Então são duas
-- portas para a mesma vaga, e as duas cobram do mesmo contador.
--
-- O QUE IMPEDE A COBRANÇA DOBRADA: este gatilho é de UPDATE e só dispara quando
-- `papel` PASSA A SER operador. Quem veio por convite já nasce com
-- `papel = 'operador'` no INSERT — nunca passa por aqui, e a vaga dele foi
-- cobrada no convite. Quem foi aprovado da fila muda de NULL para operador, e é
-- cobrado aqui, uma vez só: uma segunda atualização com o mesmo papel não
-- satisfaz `old.papel is distinct from`.
--
-- Continua MONOTÔNICO. Rebaixar alguém de operador para NULL não devolve vaga —
-- o teto é "3 para sempre", decisão do Kauan de 25/08/2026.

create function private.cobrar_teto_no_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizacoes%rowtype;
begin
  if new.papel is distinct from 'operador'::public.papel_tipo
     or old.papel is not distinct from 'operador'::public.papel_tipo
     or new.organizacao_id is null then
    return new;
  end if;

  select * into org from public.organizacoes o where o.id = new.organizacao_id for update;
  if org.id is null then
    raise exception 'organização % não existe', new.organizacao_id;
  end if;

  if org.vagas_usadas >= org.teto_operadores then
    raise exception 'a organização % já usou as % vagas de operador', org.nome, org.teto_operadores
      using errcode = 'check_violation';
  end if;

  update public.organizacoes set vagas_usadas = vagas_usadas + 1 where id = org.id;
  return new;
end;
$$;

/* ORDEM entre os dois gatilhos de UPDATE em `perfis`: o Postgres dispara em
   ordem ALFABÉTICA do nome. `cobrar_teto_no_perfil` < `guardar_colunas_de_perfil`,
   então a vaga seria cobrada ANTES de o guarda recusar a mudança de cargo — e
   uma exceção do guarda desfaz a transação inteira, incluindo o incremento.
   Ou seja: a ordem é indiferente aqui porque a recusa é uma exceção, não um
   `return null`. Fica escrito porque a próxima pessoa vai se perguntar. */
create trigger cobrar_teto_no_perfil
  before update on public.perfis
  for each row execute function private.cobrar_teto_no_perfil();
