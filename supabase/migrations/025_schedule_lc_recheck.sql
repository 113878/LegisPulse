-- ============================================================
-- Schedule the lc-recheck Edge Function via pg_cron + pg_net
-- ============================================================
-- This migration is a TEMPLATE. You must fill in your project
-- ref and the LC_RECHECK_SECRET before applying, because both
-- are project-specific.
--
-- Requirements (already available on Supabase-hosted projects):
--   • extension `pg_cron`  (Database → Extensions → enable)
--   • extension `pg_net`   (Database → Extensions → enable)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any prior schedule with the same name so re-running this
-- migration replaces the schedule rather than duplicating it.
do $$
declare
  job_id integer;
begin
  select jobid into job_id from cron.job where jobname = 'lc-recheck-hourly';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

-- ─── Schedule ─────────────────────────────────────────────────
-- Default: hourly during business-ish hours (every hour, on the
-- hour). Adjust the cron expression if you want more/less often:
--   '*/30 * * * *'  every 30 min
--   '0 */2 * * *'   every 2 hours
--   '0 9-21 * * *'  hourly 9am-9pm UTC
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'lc-recheck-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://htadeogmutogvnoyvunl.supabase.co/functions/v1/lc-recheck',
    headers := jsonb_build_object(
      'Content-Type',       'application/json',
      'x-recheck-secret',   '4bf5407b84a16bf9d82f90e5e547d98299a0805c7af19bc6'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To check the schedule:
--   select * from cron.job where jobname = 'lc-recheck-hourly';
-- To inspect recent runs:
--   select * from cron.job_run_details order by start_time desc limit 20;
-- To see http responses:
--   select * from net._http_response order by created desc limit 20;
