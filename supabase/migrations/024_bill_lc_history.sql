-- ============================================================
-- Global LC History
-- ============================================================
-- Until now, LC number change detection lived in
-- `bill_lc_tracking` keyed by (user_id, bill_number). That meant
-- only the *syncing* user got the notification; teammates following
-- the same bill stayed in the dark until they themselves synced.
--
-- `bill_lc_history` is a global, single-row-per-bill table that
-- mirrors the latest LC number for every bill any user has synced.
-- All users read from it; any user's sync can update it.
-- Per-user acknowledgment state (`change_seen`, `change_seen_at`)
-- stays in `bill_lc_tracking`.
-- ============================================================

create table if not exists public.bill_lc_history (
  bill_number     text primary key,
  current_lc      text,
  previous_lc     text,
  lc_changed_at   timestamptz,
  updated_at      timestamptz default now() not null
);

create index if not exists idx_bill_lc_history_changed_at
  on public.bill_lc_history (lc_changed_at desc);

alter table public.bill_lc_history enable row level security;

drop policy if exists "Authed users read lc history" on public.bill_lc_history;
create policy "Authed users read lc history"
  on public.bill_lc_history for select
  using (auth.uid() is not null);

drop policy if exists "Authed users insert lc history" on public.bill_lc_history;
create policy "Authed users insert lc history"
  on public.bill_lc_history for insert
  with check (auth.uid() is not null);

drop policy if exists "Authed users update lc history" on public.bill_lc_history;
create policy "Authed users update lc history"
  on public.bill_lc_history for update
  using (auth.uid() is not null);

create or replace function public.update_bill_lc_history_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_bill_lc_history_updated_at on public.bill_lc_history;
create trigger set_bill_lc_history_updated_at
  before update on public.bill_lc_history
  for each row execute procedure public.update_bill_lc_history_timestamp();

-- Backfill from existing per-user tracking so cross-user awareness
-- works immediately without waiting for every user to re-sync. For
-- each bill, pick the most recently-updated per-user row.
insert into public.bill_lc_history (bill_number, current_lc, previous_lc, lc_changed_at, updated_at)
select distinct on (bill_number)
  bill_number,
  current_lc,
  previous_lc,
  lc_changed_at,
  updated_at
from public.bill_lc_tracking
where current_lc is not null
order by bill_number, updated_at desc
on conflict (bill_number) do nothing;
