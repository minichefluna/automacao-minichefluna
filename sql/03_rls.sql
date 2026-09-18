-- =============================================================
-- FASE 1 / ARQUIVO 3: RLS (as regras de acesso)
--
-- Ideia: o banco fica trancado. Quem está logado no painel (o admin
-- criado no Authentication) lê e escreve. Quem não está logado não
-- vê nada. As Edge Functions usam a chave de service_role, que passa
-- por cima do RLS, então elas continuam escrevendo normalmente.
--
-- NUNCA libere estas tabelas pro papel "anon" (o público).
-- =============================================================

-- Liga o RLS em todas as tabelas do sistema.
alter table public.ig_automations  enable row level security;
alter table public.ig_leads        enable row level security;
alter table public.ig_deliveries   enable row level security;
alter table public.ig_send_queue   enable row level security;
alter table public.ig_send_budget  enable row level security;
alter table public.ig_scheduled    enable row level security;
alter table public.ig_assets       enable row level security;
alter table public.ig_token_status enable row level security;
alter table public.ig_bot_sends    enable row level security;
alter table public.ig_processed    enable row level security;


-- Cria, pra cada tabela, uma política única: usuário autenticado
-- pode tudo (ler, inserir, atualizar, apagar). Anônimo não pode nada.
do $$
declare
  t text;
  tabelas text[] := array[
    'ig_automations','ig_leads','ig_deliveries','ig_send_queue',
    'ig_send_budget','ig_scheduled','ig_assets','ig_token_status',
    'ig_bot_sends','ig_processed'
  ];
begin
  foreach t in array tabelas loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I
         for all
         to authenticated
         using (true)
         with check (true)',
      t || '_admin', t
    );
  end loop;
end;
$$;


-- Tira qualquer permissão do papel anônimo, por garantia.
revoke all on all tables in schema public from anon;

-- As funções do freio só interessam ao backend e ao painel logado.
revoke all on function public.take_send_slot(text) from anon, public;
revoke all on function public.record_send_result(text, boolean, boolean) from anon, public;
grant execute on function public.take_send_slot(text) to authenticated, service_role;
grant execute on function public.record_send_result(text, boolean, boolean) to authenticated, service_role;
