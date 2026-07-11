-- Problem (#719 item 2): fn_close_accounting_period does an `exists(... overlap ...)` check then a
--   separate INSERT, with no DB-level uniqueness/exclusion on the locked ranges. Two concurrent
--   closes on overlapping ranges can BOTH pass the exists() check and both INSERT — leaving two
--   overlapping `status='locked'` rows for the same org. Harmless to money (the dates stay locked),
--   but it corrupts the period ledger (a date belongs to two locked periods) and the app's
--   overlap invariant is then already violated for any later close.
--
-- Intent: enforce the invariant in Postgres so it holds under concurrency regardless of the app
--   check — no two LOCKED periods for the same org may have overlapping [period_start, period_end]
--   ranges. Reopened periods (status='open') are intentionally excluded (a reopened range may be
--   re-closed, and an open period is not part of the locked ledger).
--
-- Security implications: none. No RLS/permission/grant change; purely an additive table constraint.
--   btree_gist is a standard, trusted extension (enables the `org_id WITH =` equality inside a GiST
--   exclusion index alongside the range `&&` operator).
--
-- Rollback:
--   alter table public.accounting_periods drop constraint if exists accounting_periods_no_overlap_locked;
--   -- (btree_gist may be left installed; it is harmless and possibly used elsewhere.)
--
-- Idempotent: `create extension if not exists` + a guarded ADD CONSTRAINT (skipped if already present),
--   so a later file replay (or MCP apply under its own version) is a safe no-op. Pre-req verified before
--   apply: no existing overlapping locked periods (the app-level check has always prevented them), so
--   the constraint validates cleanly against current data.

create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'accounting_periods_no_overlap_locked'
       and conrelid = 'public.accounting_periods'::regclass
  ) then
    alter table public.accounting_periods
      add constraint accounting_periods_no_overlap_locked
      exclude using gist (
        org_id with =,
        daterange(period_start, period_end, '[]') with &&
      ) where (status = 'locked');
  end if;
end $$;
