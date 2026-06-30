-- Farm OS — performance-advisor remediation (Supabase linter, 2026-06-30 prod run).
--
-- Two safe, decision-free fixes from the live performance advisor. No schema/data semantics change.
--
-- (1) auth_rls_initplan (WARN) on public.purchase_requests policy `pr_update`:
--     the WITH CHECK re-evaluated `current_setting('app.posting_receipt', true)` per row. Every
--     `auth.uid()` / `user_org_ids()` call in this policy is already wrapped in `(select ...)`; only this
--     one setting read was left bare. Wrapping it in a scalar subselect makes Postgres evaluate it once
--     as an InitPlan instead of once per row. `app.posting_receipt` is a per-transaction GUC (set by the
--     receipt-posting RPC), constant across rows in a statement, so the wrap is semantically identical.
--     The policy predicate is otherwise re-emitted BYTE-FOR-BYTE from migration 0070 (F2/H4 SoD gate +
--     receipt-status gate + plan-org clause). pgTAP PR write-gate / receipt-status tests cover regressions.
--
-- (2) unindexed_foreign_keys (INFO) on plan_operation_assignees.org_id and residue_test_results.org_id:
--     these tables were created after the one-time 0096 catalog sweep, so their FK covering indexes were
--     never added. Re-run the SAME generic, idempotent catalog-driven pass from 0096 — it self-heals these
--     and any other FK a later migration left uncovered. Only ADDS indexes; never drops/alters.
--
-- Deliberately NOT done: the ~80 `unused_index` INFO findings. On the current near-empty pilot DB "unused"
--     means "not yet exercised", not "dead" — dropping org_id/FK indexes now would remove future-needed
--     access paths. Revisit after real usage data exists. Also out of scope: auth connection-strategy and
--     leaked-password (Auth-config/dashboard, tracked under #229(iii)).
--
-- Rollback: re-emit pr_update from 0070 (bare current_setting); drop the indexes this pass created.
-- Validation: local pgTAP harness (RLS + PR gates), then prod re-probe of the two advisors.

-- (1) Re-emit pr_update with the receipt GUC read wrapped as an InitPlan scalar subselect.
drop policy if exists pr_update on public.purchase_requests;
create policy pr_update on public.purchase_requests for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (
      status <> 'approved'
      or ( public.authorize('pr.approve', org_id)
           and requested_by is distinct from (select auth.uid()) )
    )
    and (
      status not in ('partially_received', 'received')
      or (select auth.uid()) is null
      or coalesce((select current_setting('app.posting_receipt', true)), '') = '1'
    )
    and (plan_id is null
         or exists (select 1 from public.plans p where p.id = purchase_requests.plan_id and p.org_id = purchase_requests.org_id))
  );

-- (2) Covering index for every public FK that lacks one (idempotent catalog-driven sweep; mirrors 0096).
do $$
declare
  r record;
  v_idx text;
begin
  for r in
    select c.conrelid::regclass as tbl,
           left(c.conname, 56) as base,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
      )
  loop
    v_idx := r.base || '_idx';
    execute format('create index if not exists %I on %s (%s)', v_idx, r.tbl, r.cols);
  end loop;
end $$;
