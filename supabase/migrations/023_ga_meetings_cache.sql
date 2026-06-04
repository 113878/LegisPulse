-- ============================================================
-- GA Meetings Cache
-- Mirrors meetings fetched from legis.ga.gov's private API so that
-- past meetings remain visible after the upstream API drops them and
-- so that reschedules update in-place across all users.
-- ============================================================

create table if not exists public.ga_meetings_cache (
  id              text primary key,            -- e.g. "legis-12345"
  legis_id        bigint,                      -- original numeric meeting id
  title           text not null,
  description     text,
  start_time      timestamptz not null,
  end_time        timestamptz,
  all_day         boolean default false,
  color           text,
  location        text,
  classification  text,
  chamber         smallint,                    -- 1 = House, 2 = Senate, 3 = Joint
  video_url       text,
  agenda_url      text,
  schedule_url    text,
  will_broadcast  boolean default false,
  is_vimeo        boolean default false,
  data            jsonb,                       -- full normalized meeting object
  first_seen_at   timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index if not exists idx_ga_meetings_cache_start_time
  on public.ga_meetings_cache (start_time);

create index if not exists idx_ga_meetings_cache_chamber_start
  on public.ga_meetings_cache (chamber, start_time);

alter table public.ga_meetings_cache enable row level security;

-- Any authenticated user may read the cache (this is public data).
drop policy if exists "Authed users can read ga meetings cache" on public.ga_meetings_cache;
create policy "Authed users can read ga meetings cache"
  on public.ga_meetings_cache for select
  using (auth.uid() is not null);

-- Any authenticated user may write/refresh the cache.
drop policy if exists "Authed users can insert ga meetings cache" on public.ga_meetings_cache;
create policy "Authed users can insert ga meetings cache"
  on public.ga_meetings_cache for insert
  with check (auth.uid() is not null);

drop policy if exists "Authed users can update ga meetings cache" on public.ga_meetings_cache;
create policy "Authed users can update ga meetings cache"
  on public.ga_meetings_cache for update
  using (auth.uid() is not null);

-- Maintain updated_at on every row update.
create or replace function public.update_ga_meetings_cache_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ga_meetings_cache_updated_at on public.ga_meetings_cache;
create trigger set_ga_meetings_cache_updated_at
  before update on public.ga_meetings_cache
  for each row execute procedure public.update_ga_meetings_cache_timestamp();
