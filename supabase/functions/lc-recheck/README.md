# lc-recheck Edge Function

Periodically scans LegiScan for LC number changes on every bill any
user is tracking (personal `tracked_bill_ids` ∪ `team_bills`) and
writes detected changes into the global `bill_lc_history` table, so
notifications fire for every teammate without anyone clicking Sync.

## Required secrets

Set these on the function (Supabase Dashboard → Edge Functions →
lc-recheck → Secrets, or `supabase secrets set --env-file ...`):

| Secret              | Required | Purpose                                                |
| ------------------- | -------- | ------------------------------------------------------ |
| `LEGISCAN_API_KEY`  | Yes      | Same key the client uses                               |
| `LC_RECHECK_SECRET` | No       | If set, requests must send `x-recheck-secret: <value>` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

## Deploy

```sh
supabase functions deploy lc-recheck --no-verify-jwt
supabase secrets set LEGISCAN_API_KEY=... LC_RECHECK_SECRET=...
```

`--no-verify-jwt` is required because pg_cron / external schedulers
call the function without a user session. The `LC_RECHECK_SECRET`
header is the actual auth check.

## Manual test

```sh
curl -X POST \
  -H "x-recheck-secret: $LC_RECHECK_SECRET" \
  https://<project-ref>.supabase.co/functions/v1/lc-recheck
```

Response: `{ "checked": N, "changed": M, "billNumbers": K, "changes": [...] }`.

## Schedule

See `supabase/migrations/025_schedule_lc_recheck.sql` for a pg_cron
template that runs the function on a fixed interval.
