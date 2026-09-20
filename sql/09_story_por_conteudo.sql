-- =============================================================
-- FASE 1 / ARQUIVO 9: STORY, UMA MENSAGEM POR STORY (rode depois do 08)
--
-- As automações de story deixam de usar a regra das 24 horas. No lugar,
-- vale um limite por conteúdo: cada pessoa recebe uma automação de story
-- uma vez por story respondido. Respondeu o story seguinte, recebe de novo.
--
-- Para isso, cada envio passa a guardar a qual post ou story ele se refere.
-- =============================================================

alter table public.ig_deliveries add column if not exists media_id text;

create index if not exists ig_deliveries_conteudo_idx
  on public.ig_deliveries (ig_user_id, automation_id, media_id);

-- Preenche o histórico: cada envio herda o conteúdo da entrada que o gerou.
update public.ig_deliveries d set media_id = e.media_id
  from public.ig_events e
 where d.media_id is null
   and e.ig_user_id = d.ig_user_id
   and e.automation_id = d.automation_id
   and e.tipo in ('comentario', 'story_reply')
   and e.media_id is not null
   and abs(extract(epoch from (d.ts - e.ts))) < 120;
