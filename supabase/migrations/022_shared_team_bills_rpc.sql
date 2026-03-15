-- ============================================================
-- Shared team bill data RPC
-- Allows team members to read bill data for bill_numbers that
-- are tracked in their teams, even if the bill row belongs to
-- another team member.  Returns one row per bill_number (the
-- most recently updated copy).
-- ============================================================

create or replace function public.get_team_bills_data(p_bill_numbers text[])
returns setof public.bills
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only return bill data for bill_numbers the caller's teams actually track.
  -- This prevents arbitrary bill reads — the caller must be an active member
  -- of a team that has the bill_number in team_bills.
  return query
    select distinct on (b.bill_number) b.*
    from public.bills b
    where b.bill_number = any(p_bill_numbers)
      -- Ensure every returned bill_number is in at least one of the caller's teams
      and exists (
        select 1
        from public.team_bills tb
        join public.team_members tm on tm.team_id = tb.team_id
        where tm.user_id = auth.uid()
          and tm.status  = 'active'
          and tb.bill_number = b.bill_number
      )
    order by b.bill_number, b.created_date desc;
end;
$$;
