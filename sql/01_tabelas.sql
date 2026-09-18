-- =============================================================
-- FASE 1 / ARQUIVO 1: TABELAS
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- Ele cria todas as tabelas do sistema. Pode rodar de novo sem medo:
-- tudo usa "if not exists".
-- =============================================================

-- Extensão pra gerar ids aleatórios (uuid).
create extension if not exists pgcrypto;


-- -------------------------------------------------------------
-- 1) ig_automations: as automações (o "ManyChat").
--    Cada linha é uma automação: uma palavra-chave que dispara
--    uma conversa de DM.
-- -------------------------------------------------------------
create table if not exists public.ig_automations (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null default 'Nova automação',
  -- palavras que ativam, separadas por vírgula (ex: "quero,eu quero,link")
  keyword               text not null default '',
  -- quando true, QUALQUER comentário no post ativa (ignora as palavras)
  match_any             boolean not null default false,
  active                boolean not null default true,
  -- posts em que a automação vale. Array vazio = vale pra todos os posts.
  media_ids             text[] not null default '{}',
  -- texto público que responde o comentário
  public_reply          text not null default '',
  -- variações A/B da resposta pública (o sistema alterna entre elas)
  public_reply_variants text[] not null default '{}',
  -- A CONVERSA INTEIRA mora aqui (formato descrito no LEIA-ME, seção "flow").
  -- O primeiro item de flow.steps é sempre a Mensagem 1.
  flow                  jsonb not null default '{"steps":[]}'::jsonb,
  -- arquivos anexados (ids da tabela ig_assets)
  asset_ids             text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists ig_automations_active_idx on public.ig_automations (active);


-- -------------------------------------------------------------
-- 2) ig_leads: as pessoas que interagiram (os contatos captados).
--    A chave é o id do usuário no Instagram.
-- -------------------------------------------------------------
create table if not exists public.ig_leads (
  ig_user_id    text primary key,
  username      text,
  -- de onde veio a última interação: comment / dm / story_reply
  last_source   text,
  last_keyword  text,
  automation_id uuid references public.ig_automations(id) on delete set null,
  -- em que passo da conversa a pessoa parou (id do passo, como texto)
  flow_step     text,
  link_sent     boolean not null default false,
  -- quando um passo pede um dado (ex: {"field":"email","next":3})
  expecting     jsonb,
  tags          text[] not null default '{}',
  -- campos livres capturados na conversa
  email         text,
  telefone      text,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ig_leads_created_idx on public.ig_leads (created_at desc);


-- -------------------------------------------------------------
-- 3) ig_deliveries: o log de cada envio (pra auditar e pra métrica).
-- -------------------------------------------------------------
create table if not exists public.ig_deliveries (
  id            uuid primary key default gen_random_uuid(),
  ig_user_id    text,
  automation_id uuid,
  -- private_reply (resposta privada a um comentário) ou dm (dentro da conversa)
  canal         text,
  -- flow / link / text
  tipo          text,
  -- ok / erro / na_fila
  status        text,
  motivo        text,
  ts            timestamptz not null default now()
);

create index if not exists ig_deliveries_ts_idx on public.ig_deliveries (ts desc);
create index if not exists ig_deliveries_user_idx on public.ig_deliveries (ig_user_id, ts desc);


-- -------------------------------------------------------------
-- 4) ig_send_queue: a fila de envios segurados pelo freio.
--    Quando não tem ficha de envio, o comentário entra aqui e o
--    robô ig-scheduler manda depois.
-- -------------------------------------------------------------
create table if not exists public.ig_send_queue (
  id            uuid primary key default gen_random_uuid(),
  comment_id    text unique not null,
  automation_id uuid,
  ig_user_id    text,
  username      text,
  -- pendente / enviado / erro / expirado
  status        text not null default 'pendente',
  tentativas    int not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  last_error    text
);

create index if not exists ig_send_queue_status_idx on public.ig_send_queue (status, created_at);


-- -------------------------------------------------------------
-- 5) ig_send_budget: O CONTADOR DO FREIO.
--    Tabela de UMA linha por chave (usamos a chave "private_reply").
--    SEM ESTA TABELA O FREIO NÃO TEM ONDE CONTAR e nenhuma DM sai.
-- -------------------------------------------------------------
create table if not exists public.ig_send_budget (
  id            text primary key,
  min_count     int not null default 0,
  hour_count    int not null default 0,
  day_count     int not null default 0,
  min_start     timestamptz not null default now(),
  hour_start    timestamptz not null default now(),
  day_start     timestamptz not null default now(),
  -- falhas "duras" seguidas (alimenta o disjuntor)
  err_streak    int not null default 0,
  -- tetos conservadores, BEM abaixo do limite do Instagram
  cap_minute    int not null default 6,
  cap_hour      int not null default 60,
  cap_day       int not null default 180,
  -- quando preenchido, os envios ficam pausados até esta hora
  paused_until  timestamptz,
  updated_at    timestamptz not null default now()
);

-- Semente: cria a linha do contador com os tetos padrão.
insert into public.ig_send_budget (id) values ('private_reply')
on conflict (id) do nothing;


-- -------------------------------------------------------------
-- 6) ig_scheduled: passos da conversa com atraso ("envie em X segundos").
-- -------------------------------------------------------------
create table if not exists public.ig_scheduled (
  id            uuid primary key default gen_random_uuid(),
  ig_user_id    text not null,
  automation_id uuid,
  step_id       text not null,
  send_at       timestamptz not null,
  sent          boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists ig_scheduled_pending_idx on public.ig_scheduled (sent, send_at);


-- -------------------------------------------------------------
-- 7) ig_assets: a biblioteca de arquivos (PDF, áudio, foto, vídeo).
-- -------------------------------------------------------------
create table if not exists public.ig_assets (
  id            text primary key,
  nome          text not null,
  -- image / audio / video / file
  tipo          text not null default 'file',
  public_url    text not null,
  -- cache do id que o Instagram devolve ao subir o arquivo
  attachment_id text,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);


-- -------------------------------------------------------------
-- 8) ig_token_status: a saúde do token do Instagram.
-- -------------------------------------------------------------
create table if not exists public.ig_token_status (
  id                 text primary key,
  expires_at         timestamptz,
  last_ok            boolean,
  last_error         text,
  last_refreshed_at  timestamptz,
  updated_at         timestamptz not null default now()
);

insert into public.ig_token_status (id) values ('main')
on conflict (id) do nothing;


-- -------------------------------------------------------------
-- 9) ig_bot_sends: os ids (mid) das mensagens que o PRÓPRIO sistema
--    enviou. Serve pra ignorar os "echos" e não confundir um envio
--    automático com uma resposta manual sua.
-- -------------------------------------------------------------
create table if not exists public.ig_bot_sends (
  mid        text primary key,
  ig_user_id text,
  created_at timestamptz not null default now()
);

create index if not exists ig_bot_sends_created_idx on public.ig_bot_sends (created_at);


-- -------------------------------------------------------------
-- 10) ig_processed: eventos já processados (evita processar duas vezes
--     quando o Meta reenvia o mesmo evento).
-- -------------------------------------------------------------
create table if not exists public.ig_processed (
  event_id   text primary key,
  created_at timestamptz not null default now()
);


-- -------------------------------------------------------------
-- Gatilho pra manter o updated_at sempre certo.
-- -------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ig_automations_touch on public.ig_automations;
create trigger ig_automations_touch before update on public.ig_automations
  for each row execute function public.touch_updated_at();

drop trigger if exists ig_leads_touch on public.ig_leads;
create trigger ig_leads_touch before update on public.ig_leads
  for each row execute function public.touch_updated_at();
