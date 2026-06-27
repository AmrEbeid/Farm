# test-shims — run the pgTAP suite without Docker

A Docker-free way to run the Farm OS database tests (`supabase/tests/*.sql`) against a
throwaway local PostgreSQL. With the local Docker/Supabase stack removed, this is the
primary local DB-test path, and the same harness is the authoritative automated database
gate in CI (`.github/workflows/db-tests.yml`).

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

## Coverage caveat

This harness is the authoritative **automated** DB gate (CI runs it on every PR/push), but a
plain local Postgres can't cover everything:

- A local **superuser bypasses RLS**, so it cannot verify `FORCE ROW LEVEL SECURITY`.
- It does **not** run PostgREST or GoTrue, so it cannot exercise the HTTP API or the
  Playwright e2e (the wedge-loop integration test).

With the local Docker stack removed, those full-stack checks (`supabase test db` + the
Playwright e2e) are verified against the remote (or a Supabase branch) project, managed via
the Supabase MCP — see `docs/DEPLOY-RUNBOOK.md`.
