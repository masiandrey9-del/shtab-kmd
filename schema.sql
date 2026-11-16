-- Штаб КМД: одна таблица для всех данных CRM.
-- Вставить целиком в Supabase → SQL Editor → Run.
create table if not exists public.docs (
  col text not null,          -- clients | deals | tasks | videos | plan | config
  id  text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs enable row level security;
-- Читать и менять данные может только вошедший пользователь (вы). Без входа — ничего.
drop policy if exists "owner all" on public.docs;
create policy "owner all" on public.docs for all to authenticated using (true) with check (true);
-- Живые обновления: изменения, которые вносит Claude, сразу видны на открытом сайте.
alter publication supabase_realtime add table public.docs;
