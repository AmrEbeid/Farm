-- Farm OS MVP-0 — gate plan_*_requirements writes on plan.write (#235 RLS role-gate gap).
--
-- THE GAP. `plan_material_requirements` and `plan_labor_requirements` carried only the org-scoped
-- `tenant_all` policy (migration 0010): `using (org)` / `with check (org AND parent-org EXISTS)` —
-- but NO role gate. The 0025/0035 AUTHZ-1 sweep re-gated `plan_operations` on `authorize('plan.write')`
-- yet missed these two child tables. INSERT/UPDATE are granted to `authenticated` via the 0009 blanket
-- grant (DELETE was revoked in 0027). So any authenticated org member WITHOUT plan.write — supervisor,
-- agri_engineer, accountant, storekeeper — can insert/inflate/zero a requirement's `qty` directly via
-- PostgREST. Since `fn_stock_coverage` reads `sum(qty)` as demand, zeroing it can MASK A SHORTAGE (the
-- engine's cardinal sin); inflating it over-flags. Intra-tenant privilege gap (RLS still scopes to org).
--
-- THE FIX. Re-emit the `tenant_all` policy adding `and public.authorize('plan.write', org_id)` to the
-- WITH CHECK only — mirroring 0035's `plan_operations` gate. Deliberately:
--   * USING stays org-only, so fn_stock_coverage's reads of demand are UNAFFECTED.
--   * The RLS-H1 parent-org EXISTS predicate (0010) is PRESERVED verbatim.
--   * Uses the org-scoped 2-arg authorize overload (0035, AUTHZ-2) — `authorize('plan.write', org_id)`.
--   * DELETE remains revoked (0027); grants unchanged.
-- The legitimate app write path is the SECURITY DEFINER `fn_add_plan_operation` (0038), which runs as
-- the function owner and so bypasses table RLS — it already enforces plan.write itself (test 38). This
-- migration is therefore defense-in-depth: it closes the DIRECT PostgREST write hole without changing
-- the app/RPC path. plan.write = owner / farm_manager (migration 0001).

do $$
declare t text;
begin
  foreach t in array array['plan_material_requirements','plan_labor_requirements'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (
        org_id in (select public.user_org_ids())
        and public.authorize('plan.write', org_id)
        and exists (select 1 from public.plan_operations po
                    where po.id = %I.plan_op_id and po.org_id = %I.org_id)
      )$p$, t, t, t);
  end loop;
end $$;
