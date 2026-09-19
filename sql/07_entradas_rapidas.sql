-- =============================================================
-- FASE 1 / ARQUIVO 7: ENTRADAS RÁPIDAS (rode depois do 06)
--
-- ANTES DE RODAR, troque os placeholders, como nos arquivos anteriores:
--   SEU_PROJETO_AQUI       = o id do seu projeto Supabase
--   SEU_SCHED_SECRET_AQUI  = o mesmo valor do segredo SCHED_SECRET
--
-- Troca o robô de stories (a cada 20 segundos) por um robô de ENTRADAS, que
-- busca comentários novos E respostas a stories a cada 10 segundos. Assim a
-- primeira DM sai em segundos, tanto no feed quanto no story.
--
-- Só roda enquanto existir alguma automação ligada. Sem automação, não gasta nada.
-- =============================================================

select cron.unschedule(jobid) from cron.job where jobname in ('ig_story_20s', 'ig_entradas_10s');

select cron.schedule(
  'ig_entradas_10s',
  '10 seconds',
  $cron$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-scheduler?so=entradas',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
               ),
    body    := '{}'::jsonb
  )
  where exists (select 1 from public.ig_automations where active);
  $cron$
);

-- CONFERIR:
--   select jobname, schedule from cron.job order by jobname;
