-- =============================================================
-- FASE 1 / ARQUIVO 6: INTERAÇÕES E STORIES (rode depois do 05)
--
-- ANTES DE RODAR, troque os placeholders, como nos arquivos 04 e 05:
--   SEU_PROJETO_AQUI       = o id do seu projeto Supabase
--   SEU_SCHED_SECRET_AQUI  = o mesmo valor do segredo SCHED_SECRET
-- =============================================================


-- 1) AUTOMAÇÕES: tipo de gatilho e etiquetas.
--    tipo = 'post'  -> alguém comenta a palavra num post
--    tipo = 'story' -> alguém responde um story com a palavra, pelo direct
--    Em automações de story, media_ids guarda os stories escolhidos (vazio = qualquer story).
alter table public.ig_automations add column if not exists tipo text not null default 'post';
alter table public.ig_automations add column if not exists tags text[] not null default '{}';


-- 2) LEADS: o que alimenta a aba Interações.
alter table public.ig_leads add column if not exists interacoes       int not null default 0;
alter table public.ig_leads add column if not exists ultima_interacao timestamptz;
alter table public.ig_leads add column if not exists last_media_id    text;
alter table public.ig_leads add column if not exists nome             text;
alter table public.ig_leads add column if not exists foto_url         text;
-- Última vez que o SISTEMA mandou mensagem para a pessoa. A busca ativa usa esse
-- horário para saber quais respostas no direct são novas. (Separado de updated_at,
-- que muda também quando você edita as etiquetas no painel.)
alter table public.ig_leads add column if not exists ultimo_envio     timestamptz;

create index if not exists ig_leads_ultima_idx on public.ig_leads (ultima_interacao desc);


-- 3) Registra uma interação da pessoa (comentário, resposta ao story ou mensagem).
--    p_criar = true cria o lead se ainda não existir.
create or replace function public.registrar_interacao(
  p_user     text,
  p_username text,
  p_origem   text,
  p_media    text,
  p_criar    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_criar then
    insert into public.ig_leads (ig_user_id, username, last_source, interacoes, ultima_interacao, last_media_id)
    values (p_user, nullif(p_username, ''), p_origem, 1, now(), nullif(p_media, ''))
    on conflict (ig_user_id) do update set
      interacoes       = public.ig_leads.interacoes + 1,
      ultima_interacao = now(),
      username         = coalesce(nullif(p_username, ''), public.ig_leads.username),
      last_source      = p_origem,
      last_media_id    = coalesce(nullif(p_media, ''), public.ig_leads.last_media_id);
  else
    update public.ig_leads set
      interacoes       = interacoes + 1,
      ultima_interacao = now()
    where ig_user_id = p_user;
  end if;
end;
$$;

revoke all on function public.registrar_interacao(text, text, text, text, boolean) from anon, public;
grant execute on function public.registrar_interacao(text, text, text, text, boolean) to service_role;


-- 4) A planilha da aba Interações: cada lead com a automação e o total de mensagens enviadas.
--    security_invoker = as regras de acesso (RLS) valem para quem consulta.
create or replace view public.ig_leads_painel
with (security_invoker = true) as
select
  l.*,
  a.nome as automacao_nome,
  a.tipo as automacao_tipo,
  (select count(*) from public.ig_deliveries d
     where d.ig_user_id = l.ig_user_id and d.status = 'ok')::int as mensagens_enviadas
from public.ig_leads l
left join public.ig_automations a on a.id = l.automation_id;

grant select on public.ig_leads_painel to authenticated;
revoke all on public.ig_leads_painel from anon;


-- 5) Os leads que já existem ganham a contagem inicial.
update public.ig_leads set
  interacoes       = greatest(interacoes, 1),
  ultima_interacao = coalesce(ultima_interacao, updated_at),
  ultimo_envio     = coalesce(ultimo_envio, updated_at);


-- 6) Robô dos stories: a cada 20 segundos olha o direct atrás de respostas a stories,
--    mas SÓ quando existe automação de story ligada.
select cron.unschedule(jobid) from cron.job where jobname = 'ig_story_20s';
select cron.schedule(
  'ig_story_20s',
  '20 seconds',
  $cron$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-scheduler?so=stories',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
               ),
    body    := '{}'::jsonb
  )
  where exists (select 1 from public.ig_automations where active and tipo = 'story');
  $cron$
);
