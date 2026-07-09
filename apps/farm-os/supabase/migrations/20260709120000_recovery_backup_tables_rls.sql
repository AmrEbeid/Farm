-- Farm OS — security-360 LOW-1: deny-by-default RLS on the _recovery backup tables.
--
-- PROBLEM. Migration 20260707130001_remove_non_sheet_expenses created three backup tables in schema
--   `_recovery` (removed_expenses / removed_journal_entries / removed_journal_lines) holding COPIES of
--   real removed financial rows. They carry no RLS, no FORCE, and no policies — their only protection
--   is that the `_recovery` schema is not PostgREST-exposed and holds no role grants. That is
--   single-layer (config-only) defense, contrary to the Farm invariant "isolation is enforced in
--   Postgres, never only the app/config layer": if `_recovery` were ever added to the exposed-schema
--   list or granted to a client role, every org's removed financial records would be readable with no
--   tenant boundary.
--
-- INTENT. Add the missing Postgres layer. Nothing client-facing should EVER read these one-time
--   recovery artifacts, so the correct policy is DENY-ALL: enable + FORCE row level security with NO
--   policy. Under RLS, "no policy" = deny for every non-superuser role; FORCE makes the table owner
--   obey it too. This needs no org_id column and no per-tenant policy — it simply makes the tables
--   unreadable via any client/definer path. `service_role` (BYPASSRLS, server-only) still reaches them
--   for a deliberate Owner-run restore (the documented recovery path in 20260707130001).
--
-- SECURITY IMPLICATIONS. Strictly tightening: converts "readable iff schema is misconfigured" into
--   "never readable by a client role, misconfiguration or not". No application table is touched. No
--   data is read, written, or deleted.
--
-- ROLLBACK. `alter table _recovery.<t> disable row level security;` on each of the three tables (or
--   simply drop the tables once the Owner confirms the removed rows are no longer needed).
--
-- IDEMPOTENT / FRESH-DB SAFE. Guarded by to_regclass so it is a no-op if a table is absent. On a clean
--   replay (CI pgTAP) 20260707130001 still CREATEs the three tables (empty — the prod ids don't match),
--   so they exist here and get RLS just the same.

begin;

do $$
declare t text;
begin
  foreach t in array array[
    '_recovery.removed_expenses_20260707',
    '_recovery.removed_journal_entries_20260707',
    '_recovery.removed_journal_lines_20260707'
  ] loop
    if to_regclass(t) is not null then
      execute format('alter table %s enable row level security', t);
      execute format('alter table %s force row level security', t);
    end if;
  end loop;
end $$;

commit;
