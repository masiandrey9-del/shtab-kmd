-- Вечерняя сводка в Телеграм в 20:00 МСК: что не сделано, что завтра, кто должен денег, новые запросы, голосовые заметки.
-- Токен берётся из Supabase Vault (tg_token), как у напоминаний.
create or replace function public.crm_evening_digest() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text; chat bigint := 1171488687;
  d date := (now() at time zone 'Europe/Moscow')::date;
  msg text; part text; n int; total numeric;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'tg_token' limit 1;
  if tok is null or tok = '' then return -1; end if;
  msg := '🌙 Вечерняя сводка, ' || to_char(d, 'DD.MM');

  -- Не сделано: сегодня и просрочено
  select count(*), string_agg('• ' || coalesce(t.data->>'due','') || ' ' || coalesce(c.data->>'name' || ': ', '') || (t.data->>'title'), E'\n' order by t.data->>'due')
    filter (where rn <= 10)
    into n, part
  from (select *, row_number() over (order by data->>'due') rn from docs
        where col='tasks' and coalesce(data->>'done','false') <> 'true'
          and coalesce(data->>'due','') ~ '^\d{4}-\d{2}-\d{2}$' and (data->>'due')::date <= d) t
  left join docs c on c.col='clients' and c.id = t.data->>'clientId';
  msg := msg || E'\n\n❗ Не сделано (сегодня и раньше): ' || n || coalesce(E'\n' || part, '');
  if n > 10 then msg := msg || E'\n…и ещё ' || (n-10); end if;

  -- Завтра
  select count(*), string_agg('• ' || coalesce(t.data->>'time' || ' ', '') || coalesce(c.data->>'name' || ': ', '') || (t.data->>'title'), E'\n' order by coalesce(t.data->>'time','99'))
    into n, part
  from docs t left join docs c on c.col='clients' and c.id = t.data->>'clientId'
  where t.col='tasks' and coalesce(t.data->>'done','false') <> 'true' and t.data->>'due' = to_char(d + 1, 'YYYY-MM-DD');
  msg := msg || E'\n\n📅 Завтра: ' || n || coalesce(E'\n' || part, '');

  -- Деньги: ждём оплату (предоплата, в работе, сдано)
  select coalesce(sum(greatest(coalesce((data->>'amount')::numeric,0) - coalesce((data->>'paid')::numeric,0), 0)),0),
         string_agg('• ' || (data->>'title') || ': ' || to_char(greatest(coalesce((data->>'amount')::numeric,0) - coalesce((data->>'paid')::numeric,0),0), 'FM999G999G999') || ' ₽', E'\n')
    into total, part
  from docs where col='deals' and data->>'stage' in ('prepay','work','done')
    and coalesce((data->>'amount')::numeric,0) > coalesce((data->>'paid')::numeric,0);
  msg := msg || E'\n\n💰 Ждём оплату: ' || to_char(total, 'FM999G999G990') || ' ₽' || coalesce(E'\n' || left(part, 800), '');

  -- Новые запросы сегодня
  select count(*) into n from docs where col='clients' and data->>'kind' <> 'cold' and data->>'firstContact' = to_char(d, 'YYYY-MM-DD');
  msg := msg || E'\n\n📥 Новых запросов сегодня: ' || n;

  -- Голосовые заметки, которые ещё не разобраны
  select count(*) into n from docs where col='notes' and coalesce(data->>'processed','false') <> 'true';
  if n > 0 then msg := msg || E'\n🎙 Голосовых заметок не разобрано: ' || n; end if;

  msg := msg || E'\n\nhttps://masiandrey9-del.github.io/shtab-kmd/#today';
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', left(msg, 4000), 'disable_web_page_preview', true),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return 1;
end $$;
revoke all on function public.crm_evening_digest() from public, anon, authenticated;

select cron.unschedule('crm-evening') where exists (select 1 from cron.job where jobname = 'crm-evening');
select cron.schedule('crm-evening', '0 17 * * *', 'select public.crm_evening_digest()');   -- 17:00 UTC = 20:00 МСК

select public.crm_evening_digest() as sent, (select schedule from cron.job where jobname='crm-evening') as cron;
