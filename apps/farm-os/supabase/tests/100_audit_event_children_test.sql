-- 100 — #494: the event-detail child tables carry fn_audit triggers (migration 20260701110000).
-- fn_audit's firing mechanism is proven functionally in tests 60/99; here a structural check that all
-- four event-child triggers are wired (and reference fn_audit) covers this defense-in-depth migration.
-- event_status_history is intentionally NOT audited (it is itself an append-only status-change log).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

-- event_assets is a junction table with NO `id` column; fn_audit logs new.id, so it CANNOT be audited
-- via the generic trigger (it would raise and break every event_assets write). Assert it stays untriggered.
select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'event_assets' and p.proname = 'fn_audit' and not t.tgisinternal),
  0, '#494: event_assets is NOT fn_audit-triggered (junction table, no id column)');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'event_locations' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: event_locations has an fn_audit trigger');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'event_followups' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: event_followups has an fn_audit trigger');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'event_attachments' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: event_attachments has an fn_audit trigger');

-- event_status_history must NOT be audited (it is an append-only status-change log, not member-edited data)
select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'event_status_history' and p.proname = 'fn_audit' and not t.tgisinternal),
  0, '#494: event_status_history is intentionally NOT fn_audit-triggered (it is itself a status log)');

select * from finish();
rollback;
