-- =============================================================
-- FASE 1 / ARQUIVO 5: MELHORIAS (rode depois dos arquivos 01 a 04)
--
-- ANTES DE RODAR, troque os placeholders, como no arquivo 04:
--   SEU_PROJETO_AQUI       = o id do seu projeto Supabase
--   SEU_SCHED_SECRET_AQUI  = o mesmo valor do segredo SCHED_SECRET
--
-- O que este arquivo faz:
--   1. Marca quem está esperando a próxima mensagem da conversa.
--   2. Guarda a contagem de comentários de cada post (busca ativa econômica).
--   3. Guarda o token renovado do Instagram em lugar que só o servidor lê.
--   4. Robô rápido: olha o direct a cada 5 segundos, só enquanto alguém
--      está no meio de uma conversa.
--   5. Limpeza diária dos registros velhos.
-- =============================================================


-- 1) Até quando o sistema fica "de olho" no direct dessa pessoa.
alter table public.ig_leads add column if not exists aguardando_ate timestamptz;
create index if not exists ig_leads_aguardando_idx on public.ig_leads (aguardando_ate);


-- 2) Contagem de comentários por post, da última rodada da busca ativa.
create table if not exists public.ig_media_state (
  media_id       text primary key,
  comments_count int not null default 0,
  updated_at     timestamptz not null default now()
);
alter table public.ig_media_state enable row level security;
drop policy if exists ig_media_state_admin on public.ig_media_state;
create policy ig_media_state_admin on public.ig_media_state
  for all to authenticated using (true) with check (true);


-- 3) Token renovado do Instagram.
--    RLS ligado e NENHUMA política: nem o painel nem o público leem.
--    Só as Edge Functions (service_role) acessam.
create table if not exists public.ig_secrets (
  id         text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.ig_secrets enable row level security;
revoke all on public.ig_secrets from anon, authenticated;


-- 4) Robô rápido. Roda a cada 5 segundos, mas SÓ chama a função quando existe
--    alguém esperando a próxima mensagem. Fora disso, não gasta nada.
select cron.unschedule(jobid) from cron.job where jobname = 'ig_dm_rapido';
select cron.schedule(
  'ig_dm_rapido',
  '5 seconds',
  $cron$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-scheduler?so=conversas',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
               ),
    body    := '{}'::jsonb
  )
  where exists (select 1 from public.ig_leads where aguardando_ate > now());
  $cron$
);


-- 5) Limpeza diária (04:00 UTC): histórico do agendador e marcas antigas.
select cron.unschedule(jobid) from cron.job where jobname = 'ig_limpeza_diaria';
select cron.schedule(
  'ig_limpeza_diaria',
  '0 4 * * *',
  $cron$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  delete from public.ig_processed  where created_at < now() - interval '30 days';
  delete from public.ig_bot_sends  where created_at < now() - interval '30 days';
  $cron$
);


-- CONFERIR:
--   select jobname, schedule from cron.job order by jobname;
