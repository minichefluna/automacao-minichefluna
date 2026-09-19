-- =============================================================
-- FASE 1 / ARQUIVO 8: CENTRAL DO INSTAGRAM (rode depois do 07)
--
-- O que este arquivo cria:
--   1. ig_events: tudo o que acontece com cada pessoa (comentou, respondeu,
--      tocou no botão, recebeu link, clicou...). É a base da linha do tempo
--      do lead, da aba Interações, do funil e da atividade recente.
--   2. ig_links: links rastreados. O botão de link aponta para o sistema,
--      que registra o clique e redireciona na hora para o destino.
--   3. Cache das métricas do Instagram (por dia e por conteúdo).
--   4. As views e funções que o painel consulta.
-- =============================================================


-- 1) EVENTOS -----------------------------------------------------
create table if not exists public.ig_events (
  id            bigint generated always as identity primary key,
  ts            timestamptz not null default now(),
  -- comentario | story_reply | novo_lead | resposta | botao | dado |
  -- link_enviado | link_clicado
  tipo          text not null,
  ig_user_id    text,
  automation_id uuid,
  media_id      text,
  texto         text,
  detalhe       text
);
create index if not exists ig_events_ts_idx         on public.ig_events (ts desc);
create index if not exists ig_events_user_idx       on public.ig_events (ig_user_id, ts desc);
create index if not exists ig_events_automacao_idx  on public.ig_events (automation_id, ts desc);
create index if not exists ig_events_tipo_idx       on public.ig_events (tipo, ts desc);

alter table public.ig_events enable row level security;
drop policy if exists ig_events_admin on public.ig_events;
create policy ig_events_admin on public.ig_events for all to authenticated using (true) with check (true);


-- 2) LINKS RASTREADOS --------------------------------------------
create table if not exists public.ig_links (
  codigo        text primary key,
  ig_user_id    text,
  automation_id uuid,
  step_id       text,
  titulo        text,
  url           text not null,
  created_at    timestamptz not null default now()
);
alter table public.ig_links enable row level security;
drop policy if exists ig_links_admin on public.ig_links;
create policy ig_links_admin on public.ig_links for all to authenticated using (true) with check (true);


-- 3) CACHE DAS MÉTRICAS DO INSTAGRAM -----------------------------
create table if not exists public.ig_insights_diario (
  dia           date not null,
  metrica       text not null,
  valor         bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, metrica)
);
alter table public.ig_insights_diario enable row level security;
drop policy if exists ig_insights_diario_admin on public.ig_insights_diario;
create policy ig_insights_diario_admin on public.ig_insights_diario for all to authenticated using (true) with check (true);

create table if not exists public.ig_media_insights (
  media_id      text primary key,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.ig_media_insights enable row level security;
drop policy if exists ig_media_insights_admin on public.ig_media_insights;
create policy ig_media_insights_admin on public.ig_media_insights for all to authenticated using (true) with check (true);


-- 4) AJUSTES NO HISTÓRICO ----------------------------------------
-- Envio barrado pela regra das 24 horas não é falha: é cancelamento.
update public.ig_deliveries set status = 'cancelado'
 where status = 'erro' and motivo = 'regra do 1 por dia';

-- Eventos dos leads que já existiam (entrada e o comentário ou story que trouxe cada um).
insert into public.ig_events (ts, tipo, ig_user_id, automation_id, media_id)
select l.created_at, 'novo_lead', l.ig_user_id, l.automation_id, l.last_media_id
  from public.ig_leads l
 where not exists (select 1 from public.ig_events e where e.tipo = 'novo_lead' and e.ig_user_id = l.ig_user_id);

insert into public.ig_events (ts, tipo, ig_user_id, automation_id, media_id, texto)
select l.created_at,
       case when l.last_source = 'story_reply' then 'story_reply' else 'comentario' end,
       l.ig_user_id, l.automation_id, l.last_media_id, l.last_keyword
  from public.ig_leads l
 where l.last_keyword is not null
   and not exists (select 1 from public.ig_events e
                    where e.tipo in ('comentario', 'story_reply') and e.ig_user_id = l.ig_user_id);


-- 5) VIEW: TODA A ATIVIDADE (eventos + envios de DM) --------------
create or replace view public.ig_atividade
with (security_invoker = true) as
with base as (
  select 'e' || e.id as id, e.ts, e.tipo, e.ig_user_id, e.automation_id, e.media_id,
         e.texto, e.detalhe, null::text as status
    from public.ig_events e
  union all
  select 'd' || d.id, d.ts, 'dm', d.ig_user_id, d.automation_id, null,
         null, d.motivo, d.status
    from public.ig_deliveries d
)
select b.*, l.username, l.nome, l.foto_url, l.tags, l.ultima_interacao,
       a.nome as automacao_nome, a.tipo as automacao_tipo
  from base b
  left join public.ig_leads l on l.ig_user_id = b.ig_user_id
  left join public.ig_automations a on a.id = b.automation_id;

grant select on public.ig_atividade to authenticated;
revoke all on public.ig_atividade from anon;


-- 6) VIEW: A PLANILHA DE LEADS, COM O CAMINHO DE CADA UM ----------
drop view if exists public.ig_leads_painel;
create view public.ig_leads_painel
with (security_invoker = true) as
select
  l.*,
  a.nome as automacao_nome,
  a.tipo as automacao_tipo,
  (select count(*) from public.ig_deliveries d where d.ig_user_id = l.ig_user_id and d.status in ('ok', 'erro'))::int as dms_enviadas,
  (select count(*) from public.ig_deliveries d where d.ig_user_id = l.ig_user_id and d.status = 'ok')::int as dms_entregues,
  (select count(*) from public.ig_deliveries d where d.ig_user_id = l.ig_user_id and d.status = 'erro')::int as dms_falhas,
  exists (select 1 from public.ig_events e where e.ig_user_id = l.ig_user_id and e.tipo in ('resposta', 'botao', 'dado')) as respondeu,
  (select count(*) from public.ig_events e where e.ig_user_id = l.ig_user_id and e.tipo = 'link_enviado')::int as links_enviados,
  (select count(*) from public.ig_events e where e.ig_user_id = l.ig_user_id and e.tipo = 'link_clicado')::int as cliques,
  (select e.detalhe from public.ig_events e
    where e.ig_user_id = l.ig_user_id and e.tipo in ('comentario', 'story_reply') and e.detalhe is not null
    order by e.ts desc limit 1) as palavra_chave
from public.ig_leads l
left join public.ig_automations a on a.id = l.automation_id;

grant select on public.ig_leads_painel to authenticated;
revoke all on public.ig_leads_painel from anon;


-- 7) RESUMO DO PERÍODO (visão geral: leads, DMs, cliques, funil e saúde) ----
create or replace function public.ig_painel_resumo(p_inicio timestamptz, p_fim timestamptz)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with
  dur as (select p_fim - p_inicio as d),
  ent as (select * from ig_events where ts >= p_inicio and ts < p_fim),
  dlv as (select * from ig_deliveries where ts >= p_inicio and ts < p_fim),
  ent_ant as (select * from ig_events, dur where ts >= p_inicio - dur.d and ts < p_inicio),
  dlv_ant as (select * from ig_deliveries, dur where ts >= p_inicio - dur.d and ts < p_inicio)
  select jsonb_build_object(
    'leads',              (select count(*) from ig_leads where created_at >= p_inicio and created_at < p_fim),
    'leads_anterior',     (select count(*) from ig_leads, dur where created_at >= p_inicio - dur.d and created_at < p_inicio),
    'mensagens',          (select count(*) from dlv where status = 'ok'),
    'mensagens_anterior', (select count(*) from dlv_ant where status = 'ok'),
    'cliques',            (select count(*) from ent where tipo = 'link_clicado'),
    'cliques_anterior',   (select count(*) from ent_ant where tipo = 'link_clicado'),
    'primeiro_clique',    (select min(ts) from ig_events where tipo = 'link_clicado'),
    'links_desde',        (select min(created_at) from ig_links),
    'funil', jsonb_build_object(
      'entradas',     (select count(distinct ig_user_id) from ent where tipo in ('comentario', 'story_reply')),
      'enviadas',     (select count(distinct ig_user_id) from dlv where status in ('ok', 'erro')),
      'entregues',    (select count(distinct ig_user_id) from dlv where status = 'ok'),
      'responderam',  (select count(distinct ig_user_id) from ent where tipo in ('resposta', 'botao', 'dado')),
      'link_enviado', (select count(distinct ig_user_id) from ent where tipo = 'link_enviado'),
      'clicaram',     (select count(distinct ig_user_id) from ent where tipo = 'link_clicado')
    ),
    'saude', jsonb_build_object(
      'entregues',  (select count(*) from dlv where status = 'ok'),
      'falharam',   (select count(*) from dlv where status = 'erro'),
      'cancelados', (select count(*) from dlv where status = 'cancelado'),
      'na_fila',    (select count(*) from dlv where status = 'na_fila'),
      'motivos', coalesce((
        select jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', qtd) order by qtd desc)
          from (select coalesce(nullif(motivo, ''), 'sem detalhe') as motivo, count(*) as qtd
                  from dlv where status in ('erro', 'cancelado') group by 1 order by 2 desc limit 6) m
      ), '[]'::jsonb),
      'automacoes', coalesce((
        select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd) order by qtd desc)
          from (select coalesce(a.nome, 'automação apagada') as nome, count(*) as qtd
                  from dlv d left join ig_automations a on a.id = d.automation_id
                 where d.status = 'erro' group by 1 order by 2 desc limit 6) x
      ), '[]'::jsonb)
    )
  );
$$;


-- 8) MÉTRICAS DE CADA AUTOMAÇÃO (cards e visão detalhada) --------
create or replace function public.ig_automacoes_metricas()
returns table (
  automation_id uuid, entradas bigint, pessoas bigint, enviadas bigint, entregues bigint,
  falhas bigint, cancelados bigint, cliques bigint, leads bigint, responderam bigint,
  links bigint, ultima timestamptz
)
language sql stable security invoker set search_path = public
as $$
  select a.id,
    (select count(*) from ig_events e where e.automation_id = a.id and e.tipo in ('comentario', 'story_reply')),
    (select count(distinct e.ig_user_id) from ig_events e where e.automation_id = a.id and e.tipo in ('comentario', 'story_reply')),
    (select count(*) from ig_deliveries d where d.automation_id = a.id and d.status in ('ok', 'erro')),
    (select count(*) from ig_deliveries d where d.automation_id = a.id and d.status = 'ok'),
    (select count(*) from ig_deliveries d where d.automation_id = a.id and d.status = 'erro'),
    (select count(*) from ig_deliveries d where d.automation_id = a.id and d.status = 'cancelado'),
    (select count(*) from ig_events e where e.automation_id = a.id and e.tipo = 'link_clicado'),
    (select count(*) from ig_events e where e.automation_id = a.id and e.tipo = 'novo_lead'),
    (select count(distinct e.ig_user_id) from ig_events e where e.automation_id = a.id and e.tipo in ('resposta', 'botao', 'dado')),
    (select count(*) from ig_events e where e.automation_id = a.id and e.tipo = 'link_enviado'),
    greatest(
      (select max(ts) from ig_events e where e.automation_id = a.id),
      (select max(ts) from ig_deliveries d where d.automation_id = a.id)
    )
  from ig_automations a;
$$;


-- 9) ANÁLISES DO PERÍODO (aba Análises) ---------------------------
create or replace function public.ig_analise(p_inicio timestamptz, p_fim timestamptz)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with
  ent as (select * from ig_events where ts >= p_inicio and ts < p_fim),
  dlv as (select * from ig_deliveries where ts >= p_inicio and ts < p_fim),
  entradas as (select * from ent where tipo in ('comentario', 'story_reply'))
  select jsonb_build_object(
    'leads_dia', coalesce((select jsonb_agg(jsonb_build_object('data', dia, 'valor', n) order by dia) from (
        select (created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
          from ig_leads where created_at >= p_inicio and created_at < p_fim group by 1) x), '[]'::jsonb),
    'dms_dia', coalesce((select jsonb_agg(jsonb_build_object('data', dia, 'valor', n) order by dia) from (
        select (ts at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
          from dlv where status = 'ok' group by 1) x), '[]'::jsonb),
    'cliques_dia', coalesce((select jsonb_agg(jsonb_build_object('data', dia, 'valor', n) order by dia) from (
        select (ts at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
          from ent where tipo = 'link_clicado' group by 1) x), '[]'::jsonb),
    'palavras', coalesce((select jsonb_agg(jsonb_build_object('palavra', p, 'qtd', n) order by n desc) from (
        select lower(detalhe) as p, count(*) as n from entradas
         where detalhe is not null group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'origem', jsonb_build_object(
        'post',  (select count(distinct ig_user_id) from entradas where tipo = 'comentario'),
        'story', (select count(distinct ig_user_id) from entradas where tipo = 'story_reply')),
    'horas', coalesce((select jsonb_agg(jsonb_build_object('hora', h, 'qtd', n) order by h) from (
        select extract(hour from ts at time zone 'America/Sao_Paulo')::int as h, count(*) as n
          from entradas group by 1) x), '[]'::jsonb),
    'conteudos', coalesce((select jsonb_agg(jsonb_build_object('media_id', media_id, 'pessoas', n) order by n desc) from (
        select media_id, count(distinct ig_user_id) as n from entradas
         where media_id is not null group by 1 order by 2 desc limit 8) x), '[]'::jsonb),
    'pessoas', coalesce((select jsonb_agg(p order by (p->>'qtd')::int desc) from (
        select jsonb_build_object('ig_user_id', e.ig_user_id, 'username', l.username, 'nome', l.nome,
                                  'foto_url', l.foto_url, 'qtd', count(*)) as p
          from ent e left join ig_leads l on l.ig_user_id = e.ig_user_id
         where e.ig_user_id is not null
         group by e.ig_user_id, l.username, l.nome, l.foto_url
         order by count(*) desc limit 8) x), '[]'::jsonb),
    'automacoes', coalesce((select jsonb_agg(r order by (r->>'entradas')::int desc) from (
        select jsonb_build_object(
          'id', a.id, 'nome', a.nome, 'tipo', a.tipo,
          'entradas',    (select count(distinct ig_user_id) from entradas x where x.automation_id = a.id),
          'enviadas',    (select count(*) from dlv d where d.automation_id = a.id and d.status in ('ok', 'erro')),
          'entregues',   (select count(*) from dlv d where d.automation_id = a.id and d.status = 'ok'),
          'falhas',      (select count(*) from dlv d where d.automation_id = a.id and d.status = 'erro'),
          'responderam', (select count(distinct ig_user_id) from ent x where x.automation_id = a.id and x.tipo in ('resposta', 'botao', 'dado')),
          'cliques',     (select count(*) from ent x where x.automation_id = a.id and x.tipo = 'link_clicado'),
          'leads',       (select count(*) from ent x where x.automation_id = a.id and x.tipo = 'novo_lead')
        ) as r
        from ig_automations a) y), '[]'::jsonb)
  );
$$;

revoke all on function public.ig_painel_resumo(timestamptz, timestamptz) from anon, public;
revoke all on function public.ig_automacoes_metricas() from anon, public;
revoke all on function public.ig_analise(timestamptz, timestamptz) from anon, public;
grant execute on function public.ig_painel_resumo(timestamptz, timestamptz) to authenticated;
grant execute on function public.ig_automacoes_metricas() to authenticated;
grant execute on function public.ig_analise(timestamptz, timestamptz) to authenticated;


-- 10) LIMPEZA: eventos e links com mais de 24 meses (mesmo prazo da política).
select cron.unschedule(jobid) from cron.job where jobname = 'ig_limpeza_eventos';
select cron.schedule(
  'ig_limpeza_eventos',
  '15 4 * * *',
  $cron$
  delete from public.ig_events where ts < now() - interval '24 months';
  delete from public.ig_links  where created_at < now() - interval '24 months';
  delete from public.ig_insights_diario where dia < (now() - interval '24 months')::date;
  $cron$
);
