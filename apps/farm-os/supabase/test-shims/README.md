# test-shims — run the pgTAP suite without Docker

A Docker-free way to run the Farm OS database tests (`supabase/tests/*.sql`) against a
throwaway local PostgreSQL. Built when the Docker/Supabase stack was unavailable; kept as a
fast inner-loop check and a reproducible way to verify the security-remediation suite.

```bash
# from anywhere; needs PostgreSQL 15+ and pgTAP installed (see the script header)
apps/farm-os/supabase/test-shims/run-pgtap-local.sh
# => applies bootstrap.sql + all migrations + seed, runs every test, prints a TAP summary,
#    exits 0 iff all pass. Currently: 46/46 (12 RLS + 5 audit + 8 seed + 11 engine + 10 security).
```

- `bootstrap.sql` — the minimal Supabase objects the schema depends on (the
  `anon`/`authenticated`/`service_role` roles, the `auth` schema + `auth.users`, and
  `auth.uid()`/`auth.role()`), so the unmodified migrations/seed/tests run on plain Postgres.
- `run-pgtap-local.sh` — spins an ephemeral cluster, applies shims → migrations → seed →
  tests, and tears it down.

## Not a replacement for `supabase test db`

This is a **local convenience**, not the authoritative gate:

- A local **superuser bypasses RLS**, so this cannot verify `FORCE ROW LEVEL SECURITY`.
- It does **not** run PostgREST or GoTrue, so it cannot exercise the HTTP API or the
  Playwright e2e (the wedge-loop integration test).

For the authoritative run use the Docker stack:

```bash
cd apps/farm-os
supabase start && supabase db reset && supabase test db && npx playwright test
```
