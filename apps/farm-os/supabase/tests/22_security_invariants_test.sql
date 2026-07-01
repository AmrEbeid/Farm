-- 22 — generic regression-pin oracles for the security invariants the prod-push assurance
-- flagged as un-pinned. The earlier tests (05, 19) pin SPECIFIC functions/findings by name;
-- these are CATALOG-LEVEL invariants that hold no matter which migration is added next, so a
-- future migration cannot silently regress them (e.g. add a new public SECURITY DEFINER fn that
-- inherits the Supabase default anon/authenticated EXECUTE grant, or add a table/partition that
-- forgets RLS).
--
-- All checks are pg_catalog / has_function_privilege based — independent of RLS, so they are valid
-- even on the local superuser cluster where FORCE ROW LEVEL SECURITY cannot be exercised. The
-- assertions are built DYNAMICALLY (count of violations = 0), so they auto-extend to new objects.
-- Run via `supabase test db` or the local shim (test-shims/run-pgtap-local.sh).

begin;
select plan(12);

-- ============================================================================================
-- Invariant 1 — anon may EXECUTE no public SECURITY DEFINER function except the RLS helpers.
-- Generalises migration 0021. authorize(text,uuid)/user_org_ids() are the intentional helpers anon
-- needs so RLS policies can evaluate for an unauthenticated request; every other definer fn is a
-- privileged code path that must never be reachable from the anon (unauthenticated) JWT.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('authorize', 'user_org_ids', 'user_member_org_ids')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'INV-1: no public SECURITY DEFINER fn (other than authorize/user_org_ids) is EXECUTE-able by anon');

-- Pin the positive side too: the two intended helpers MUST stay anon-executable (so a future
-- over-zealous revoke that breaks anonymous RLS evaluation is also caught).
select ok(has_function_privilege('anon', 'public.authorize(text, uuid)', 'EXECUTE'),
  'INV-1: authorize(text, uuid) remains EXECUTE-able by anon (RLS helper; AUTHZ-2 #181 org-scoped overload)');
select ok(has_function_privilege('anon', 'public.user_org_ids()', 'EXECUTE'),
  'INV-1: user_org_ids() remains EXECUTE-able by anon (RLS helper)');

-- ============================================================================================
-- Invariant 2 — authenticated may EXECUTE only the intended API surface of public SECURITY
-- DEFINER functions. The allow-list is the RLS helpers + the deliberate write/read RPCs. In
-- particular the trigger functions (pr_guard_approval, fn_audit, fn_audit_org_member, and any
-- other `returns trigger` definer fn) are never invoked directly and must hold no client EXECUTE.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in (
        'authorize', 'user_org_ids',             -- RLS helpers
        'user_member_org_ids',                    -- RLS helper: full membership set (active-org, 0085)
        'fn_set_active_org',                       -- active-org switcher RPC (migration 0085)
        'fn_update_org_settings',                 -- owner-gated org settings RPC (migration 0086)
        'fn_stock_coverage',                      -- read RPC
        'fn_execute_operation',                   -- intended authenticated RPC surface
        'fn_post_receipt',                        -- atomic PR receipt RPC (migration 0024)
        'fn_reserve_stock',                       -- gated reserve wrapper (AUTHZ-3 #182, migration 0036)
        'fn_add_plan_operation',                  -- atomic plan-operation authoring RPC (CREATE-3 #196, migration 0038)
        'fn_add_plan_operation_multi',            -- atomic multi-line op authoring (materials+labour+assignees+multi-day, #398 slice 2, migration 0093)
        'fn_unassign_plan_operation',              -- gated un-assign RPC for plan_operation_assignees (#398 follow-up, migration 20260701220000)
        'fn_update_palm_status',                  -- gated + atomic palm status RPC (PALM-STATUS-1 #238, migration 0039)
        'fn_save_sector', 'fn_save_hawsha',       -- gated structure CRUD RPCs (STRUCT-1, migration 0081)
        'fn_save_line', 'fn_save_palm',           -- gated structure CRUD RPCs (STRUCT-1, migration 0081)
        'fn_archive_structure',                   -- gated cascade soft-delete/restore (STRUCT-1, migration 0081)
        'fn_add_attachment', 'fn_archive_attachment', -- gated node-media RPCs (STRUCT-1, migration 0082)
        'fn_record_event', 'fn_set_event_status',  -- gated ad-hoc event RPCs (STAGE 3 / SPEC-0010, migration 0083)
        'fn_add_event_followup',                   -- gated event follow-up RPC (STAGE 3 / SPEC-0010, migration 0083)
        'fn_create_plan', 'fn_set_plan_status',    -- gated plan-builder RPCs (STAGE 4 / SPEC-0011, migration 0084)
        'fn_assign_plan_operation', 'fn_add_plan_labor', -- gated plan-builder RPCs (STAGE 4 / SPEC-0011, migration 0084)
        'fn_save_academy_content', 'fn_signoff_academy_content', -- gated Care Academy RPCs (STAGE 10 / SPEC-0008, migration 20260701230000)
        'fn_archive_academy_content',              -- gated Care Academy RPC (STAGE 10 / SPEC-0008, migration 20260701230000)
        'fn_save_custody_account', 'fn_record_custody_movement', 'fn_set_expense_payment_status', -- gated custody/expense RPCs (SPEC-0018)
        'fn_custody_balance', 'fn_set_expense_kind', -- derived custody read + #6 drawings split helpers (SPEC-0018)
        'fn_create_payment_request', 'fn_add_expense_to_request', -- payment-request RPCs (SPEC-0018)
        'fn_submit_payment_request', 'fn_approve_request_operational', 'fn_approve_request_final', -- lifecycle through final approval
        'fn_payment_request_totals',               -- derived request totals read RPC (SPEC-0018)
        'fn_accounting_trial_balance',             -- standalone accounting read RPC (cash-method custody slice)
        'fn_record_payment_request_funding',       -- owner funds received as custody after final approval
        'fn_confirm_request_expense_paid',         -- cash-method request-line payment confirmation
        'fn_close_payment_request',                -- close funded request after every line is confirmed paid
        'fn_instantiate_operation_template',       -- gated template-instantiate RPC (SPEC-0019 P1-3, migration 20260701260000)
        'fn_owner_pnl_summary',                    -- gated owner P&L period-summary read RPC (migration 20260701270000)
        'fn_update_weather_thresholds',             -- gated weather-thresholds settings RPC (SPEC-0007 §3, migration 20260701370000)
        'fn_save_trap', 'fn_update_trap',          -- gated pest-scouting trap RPCs (RPW-1, migration 20260701380000)
        'fn_log_trap_catch', 'fn_report_pest_incident', -- gated pest-scouting catch/incident RPCs (RPW-1)
        'fn_sign_off_plan_operation'                -- agronomy.signoff-gated sign-off RPC (agronomist-signoff-gate)
        -- NB: fn_post_movement and fn_bin_rebuild are deliberately NOT here — AUTHZ-3 (migration
        -- 0036) and #430 (migration 20260622000098) make them INTERNAL primitives. Pinned negatively below.
      )
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'INV-2: no unexpected public SECURITY DEFINER fn is EXECUTE-able by authenticated (trigger fns + fn_post_movement locked)');

-- AUTHZ-3 (#182, migration 0036): fn_post_movement is an INTERNAL primitive — `authenticated` must
-- NOT hold EXECUTE on it (the bug was that any org member could POST it to move stock). Pin the
-- revoke directly so a future migration that re-grants it is caught.
select ok(
  not has_function_privilege('authenticated',
    'public.fn_post_movement(uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz)',
    'EXECUTE'),
  'INV-2: authenticated can NO LONGER EXECUTE fn_post_movement directly (AUTHZ-3 #182 — now internal)');
select ok(
  not has_function_privilege('authenticated', 'public.fn_bin_rebuild(uuid, text)', 'EXECUTE'),
  'INV-2: authenticated can NO LONGER EXECUTE fn_bin_rebuild directly (#430 — now internal)');

-- Pin the trigger functions explicitly — these are the ones 0021 had to claw back from PUBLIC/
-- authenticated, so guard the regression directly as well as via the dynamic count above.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
      and p.prosecdef
      and t.typname = 'trigger'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'INV-2: no public SECURITY DEFINER trigger function is EXECUTE-able by anon or authenticated');

-- ============================================================================================
-- Invariant 3 — every base table in schema public has row-level security ENABLED (deny-by-
-- default, generalised). relkind 'r' = ordinary table; relispartition excluded here because
-- partition children are covered separately by INV-4. There are no pgTAP-owned tables in public
-- (pgTAP installs into the pg_catalog/extension schema), so no name exclusions are needed; if
-- that ever changes, exclude them here by name with a comment rather than weakening the count.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and not c.relrowsecurity),
  0,
  'INV-3: every non-partition base table in public has RLS enabled');

-- ============================================================================================
-- Invariant 4 — every partition CHILD has RLS enabled. A child queried directly does NOT inherit
-- the parent partitioned table's RLS, so each child must carry its own (see migration 0004 for
-- farm_event). This covers all partition children, and explicitly the farm_event children.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relispartition
      and not c.relrowsecurity),
  0,
  'INV-4: every partition child in public has RLS enabled');

-- Sanity floor: there is at least one partition child (otherwise INV-4 is vacuously true and a
-- future change that drops partitioning would silently stop testing this surface).
select cmp_ok(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_inherits i on i.inhrelid = c.oid
     join pg_class parent on parent.oid = i.inhparent
    where n.nspname = 'public' and parent.relname = 'farm_event'),
  '>=', 1,
  'INV-4: farm_event still has partition children (the invariant is not vacuous)');

-- ============================================================================================
-- Invariant 5 — every public SECURITY DEFINER function PINS search_path (proconfig carries a
-- search_path entry). A definer fn that leaves search_path unset runs with the CALLER's
-- search_path, so a malicious user who creates a same-named table/function in an earlier schema
-- can hijack an unqualified reference inside the definer body and have it execute with the owner's
-- (elevated) privileges — the classic CVE-2018-1058 / search_path privilege-escalation vector. All
-- of Farm's definer fns use `set search_path = ''` (forcing fully-qualified names); this pins that
-- so a future definer fn that forgets it is caught at CI rather than shipping exploitable.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not (array_to_string(coalesce(p.proconfig, '{}'), ',') ilike '%search_path%')),
  0,
  'INV-5: every public SECURITY DEFINER fn pins search_path (no caller-search_path hijack)');

-- Sanity floor: there are many definer fns (so INV-5 is not vacuously true if a refactor ever
-- removed prosecdef from all of them).
select cmp_ok(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  '>=', 10,
  'INV-5: there are many SECURITY DEFINER fns (the search_path invariant is not vacuous)');

select * from finish();
rollback;
