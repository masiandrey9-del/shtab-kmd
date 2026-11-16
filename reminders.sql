-- Напоминания в Телеграм: база сама раз в минуту ищет задачи, у которых наступило время, и пишет в бот.
-- Токен бота хранится в Supabase Vault под именем tg_token (вносится владельцем вручную, в репозитории его нет).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.crm_send_reminders() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record; tok text; n int := 0; cname text; msg text; fire_at timestamptz;
  chat bigint := 1171488687;   -- личный чат владельца с ботом
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'tg_token' limit 1;
  if tok is null or tok = '' then return -1; end if;
  for r in
    select id, data from public.docs
    where col = 'tasks'
      and coalesce(data->>'done','false') <> 'true'
      and coalesce(data->>'remindedAt','') = ''
      and coalesce(data->>'due','')  ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(data->>'time','') ~ '^\d{2}:\d{2}$'
  loop
    fire_at := ((r.data->>'due') || ' ' || (r.data->>'time'))::timestamp at time zone 'Europe/Moscow';
    continue when fire_at > now() or fire_at < now() - interval '12 hours';
    select data->>'name' into cname from public.docs where col = 'clients' and id = r.data->>'clientId';
    msg := '⏰ ' || (r.data->>'time') || ' · ' || coalesce(cname || ': ', '') || (r.data->>'title');
    if coalesce(r.data->>'note','') <> '' then msg := msg || E'\n' || left(r.data->>'note', 600); end if;
    if coalesce(r.data->>'draft','') <> '' then msg := msg || E'\n\nЧерновик клиенту:\n' || left(r.data->>'draft', 2500); end if;
    msg := msg || E'\n\nhttps://masiandrey9-del.github.io/shtab-kmd/#today';
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
      body := jsonb_build_object('chat_id', chat, 'text', msg, 'disable_web_page_preview', true),
      headers := '{"Content-Type":"application/json"}'::jsonb);
    update public.docs
      set data = data || jsonb_build_object('remindedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          updated_at = now()
      where col = 'tasks' and id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.crm_send_reminders() from public, anon, authenticated;

select cron.unschedule('crm-reminders') where exists (select 1 from cron.job where jobname = 'crm-reminders');
select cron.schedule('crm-reminders', '* * * * *', 'select public.crm_send_reminders()');

select jobname, schedule, active from cron.job where jobname = 'crm-reminders';
