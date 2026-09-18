-- =============================================================
-- FASE 1 / ARQUIVO 2: AS FUNÇÕES DO FREIO (OBRIGATÓRIAS)
--
-- ATENÇÃO, LEIA ISTO:
-- Sem estas duas funções, o freio "falha fechado": NENHUMA DM por
-- comentário sai. Tudo vai pra fila e a fila nunca anda, sem dar
-- erro nenhum na tela. É o passo que não pode faltar.
--
-- O que elas fazem: um "balde de fichas" (token bucket) atômico.
-- Antes de cada envio o sistema pede uma ficha. Se não tem ficha,
-- o envio espera na fila. Assim a conta nunca estoura o teto do
-- Instagram (que gira em torno de 200 a 300 respostas privadas por
-- dia). Os tetos padrão aqui são conservadores de propósito.
-- =============================================================


-- -------------------------------------------------------------
-- take_send_slot(chave): tenta pegar uma ficha de envio.
-- Retorna true se pode enviar agora, false se tem que esperar.
--
-- Regras:
--  - conta envios por minuto, por hora e por dia (janelas que zeram sozinhas)
--  - respeita os tetos cap_minute / cap_hour / cap_day
--  - respeita o disjuntor (paused_until)
--  - trava a linha com FOR UPDATE, então duas chamadas ao mesmo tempo
--    nunca contam errado
-- -------------------------------------------------------------
create or replace function public.take_send_slot(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ig_send_budget%rowtype;
  agora timestamptz := now();
begin
  -- Garante que a linha do contador existe (com os tetos padrão).
  insert into public.ig_send_budget (id) values (p_key)
  on conflict (id) do nothing;

  -- Trava a linha: ninguém mais mexe até esta transação terminar.
  select * into b from public.ig_send_budget where id = p_key for update;

  -- Disjuntor ligado? Então nada sai por enquanto.
  if b.paused_until is not null and b.paused_until > agora then
    return false;
  end if;

  -- Vira o minuto? Zera o contador do minuto.
  if agora - b.min_start >= interval '1 minute' then
    b.min_count := 0;
    b.min_start := agora;
  end if;

  -- Vira a hora? Zera o contador da hora.
  if agora - b.hour_start >= interval '1 hour' then
    b.hour_count := 0;
    b.hour_start := agora;
  end if;

  -- Vira o dia? Zera o contador do dia.
  if agora - b.day_start >= interval '1 day' then
    b.day_count := 0;
    b.day_start := agora;
  end if;

  -- Estourou algum teto? Salva as janelas zeradas e recusa a ficha.
  if b.min_count >= b.cap_minute
     or b.hour_count >= b.cap_hour
     or b.day_count >= b.cap_day then
    update public.ig_send_budget
       set min_count = b.min_count, min_start = b.min_start,
           hour_count = b.hour_count, hour_start = b.hour_start,
           day_count = b.day_count, day_start = b.day_start,
           updated_at = agora
     where id = p_key;
    return false;
  end if;

  -- Tem ficha: consome uma e libera o envio.
  update public.ig_send_budget
     set min_count = b.min_count + 1, min_start = b.min_start,
         hour_count = b.hour_count + 1, hour_start = b.hour_start,
         day_count = b.day_count + 1, day_start = b.day_start,
         updated_at = agora
   where id = p_key;

  return true;
end;
$$;


-- -------------------------------------------------------------
-- record_send_result(chave, deu_certo, foi_falha_dura)
--
-- Registra como terminou o envio, pra alimentar o disjuntor.
--  - deu certo: zera a sequência de falhas
--  - falha "dura" (bloqueio, permissão negada, limite da plataforma):
--    soma na sequência. Com 3 seguidas, pausa os envios por 3 horas.
--  - falha "mole" (erro de rede, timeout): não pausa nada.
-- -------------------------------------------------------------
create or replace function public.record_send_result(
  p_key  text,
  p_ok   boolean,
  p_hard boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  streak int;
begin
  insert into public.ig_send_budget (id) values (p_key)
  on conflict (id) do nothing;

  if p_ok then
    -- Deu certo: limpa a sequência de falhas e solta o disjuntor.
    update public.ig_send_budget
       set err_streak = 0, paused_until = null, updated_at = now()
     where id = p_key;
    return;
  end if;

  if not p_hard then
    -- Falha mole: não conta pro disjuntor.
    update public.ig_send_budget set updated_at = now() where id = p_key;
    return;
  end if;

  -- Falha dura: soma na sequência.
  update public.ig_send_budget
     set err_streak = err_streak + 1, updated_at = now()
   where id = p_key
  returning err_streak into streak;

  -- Três falhas duras seguidas: pausa tudo por 3 horas.
  if streak >= 3 then
    update public.ig_send_budget
       set paused_until = now() + interval '3 hours',
           err_streak = 0,
           updated_at = now()
     where id = p_key;
  end if;
end;
$$;


-- -------------------------------------------------------------
-- TESTE RÁPIDO (opcional): rode as linhas abaixo pra ver o freio de pé.
--   select public.take_send_slot('private_reply');   -- deve dar true
--   select public.record_send_result('private_reply', true, false);
--   select * from public.ig_send_budget;
-- -------------------------------------------------------------
