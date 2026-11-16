-- Штаб КМД: одна таблица для всех данных CRM.
-- Вставить целиком в Supabase → SQL Editor → Run. Повторный запуск безопасен.
create table if not exists public.docs (
  col text not null,          -- clients | deals | tasks | videos | plan | config | inbox
  id  text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs enable row level security;
revoke all on public.docs from anon;

-- Кто может работать с данными: только перечисленные пользователи (сейчас один — владелец).
create table if not exists public.crm_owners (user_id uuid primary key);
alter table public.crm_owners enable row level security;   -- без политик: с сайта не читается и не меняется
revoke all on public.crm_owners from anon, authenticated;
-- Владелец добавляется один раз вручную: insert into public.crm_owners values ('<UID из Authentication → Users>');

create or replace function public.crm_allowed() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.crm_owners o where o.user_id = auth.uid())
     and (
       -- если включён вход с кодом из приложения (2FA), без кода данных не видно
       (auth.jwt()->>'aal') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     );
$$;
revoke all on function public.crm_allowed() from public, anon;
grant execute on function public.crm_allowed() to authenticated;

drop policy if exists "owner all" on public.docs;
create policy "owner all" on public.docs for all to authenticated
  using (public.crm_allowed()) with check (public.crm_allowed());

-- Живые обновления: изменения, которые вносит Claude, сразу видны на открытом сайте.
do $$ begin alter publication supabase_realtime add table public.docs; exception when duplicate_object then null; end $$;

select 'ok' as status, (select count(*) from public.docs) as docs, (select count(*) from public.crm_owners) as owners;
