-- =============================================================
-- FASE 1 / ARQUIVO 4: AGENDAMENTO (os robôs que rodam sozinhos)
--
-- ANTES DE RODAR, troque os três placeholders abaixo:
--   SEU_PROJETO_AQUI  = o id do seu projeto Supabase (aparece na URL,
--                       ex: https://abcdefgh.supabase.co  ->  abcdefgh)
--   SEU_SCHED_SECRET_AQUI = a mesma senha que você colocou no segredo
--                       SCHED_SECRET das Edge Functions
--
-- Dois robôs:
--   ig-scheduler      a cada 1 minuto  (esvazia a fila e manda os
--                                       passos com atraso)
--   ig-token-refresh  1x por semana    (renova o token do Instagram)
--
-- Detalhe técnico: pra o pg_cron chamar uma URL, o Postgres precisa
-- da extensão pg_net (é ela que faz o net.http_post).
-- =============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- Remove agendamentos antigos com o mesmo nome (pra poder rodar de novo).
select cron.unschedule(jobid) from cron.job where jobname in ('ig_scheduler_1min','ig_token_refresh_semanal');


-- -------------------------------------------------------------
-- ROBÔ 1: ig-scheduler, a cada 1 minuto.
-- -------------------------------------------------------------
select cron.schedule(
  'ig_scheduler_1min',
  '* * * * *',
  $cron$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-scheduler',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
               ),
    body    := '{}'::jsonb
  );
  $cron$
);


-- -------------------------------------------------------------
-- ROBÔ 2: ig-token-refresh, toda segunda-feira às 03:00 (UTC).
-- -------------------------------------------------------------
select cron.schedule(
  'ig_token_refresh_semanal',
  '0 3 * * 1',
  $cron$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-token-refresh',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
               ),
    body    := '{}'::jsonb
  );
  $cron$
);


-- -------------------------------------------------------------
-- CONFERIR SE FUNCIONOU:
--   select * from cron.job;                                  -- os robôs agendados
--   select * from cron.job_run_details order by start_time desc limit 10;  -- as últimas execuções
-- -------------------------------------------------------------
