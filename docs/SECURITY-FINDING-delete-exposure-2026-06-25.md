# Security Finding — broad direct-DELETE exposure across tenant tables   (2026-06-25)

Reviewer: independent adversarial pass (DB layer, live local Supabase stack). Owner: Amr Ebeid.
Scope: `apps/farm-os` RLS + grants. Status: **📝 documented — Owner decision required** (tied to the
already-open "role model" gate). One concrete sub-case (the inventory ledger) is **already fixed** in
PR #42 (B2.1).

## Summary

The same root cause that left the stock ledger directly DELETE-able (B2.1, PR #42) applies
**schema-wide**: with the current grants + policies, **any authenticated org member can DELETE rows
directly via PostgREST on 28 tenant tables** — including financial (`expenses`, `budgets`,
`budget_lines`), operational (`farm_event*`, `quantities`, `plan_operations`, `plans`), structural
(`farms`, `sectors`, `hawshat`, `lines`, `assets`), and PII (`people`) tables — bypassing the app
entirely. RLS scopes deletes to the member's own org, so this is **not** a cross-tenant leak; within
a single tenant it is a **data-integrity / insider-authorization** gap (any low-privilege member can
erase another's financial or operational records).

This is the DELETE dimension of the authorization posture the B2 review already flagged for the
write path ("acceptable for the single-tenant pilot; tighten before multi-tenant"). It is recorded
here so the deferred **role-model decision** is made with the delete surface explicit.

## Root cause

1. Migration `0009` grants `select, insert, update, delete on all tables in schema public to …
   authenticated` (a blanket grant).
2. Tenant tables use a single `tenant_all` policy `FOR ALL … USING (org_id in user_org_ids())`.
3. A `FOR ALL` policy governs **DELETE by `USING` alone** (there is no `WITH CHECK` for DELETE), and
   `USING` is org-membership only — so no role/ownership check ever applies to a delete.

The hardening done so far closes this only for specific tables: `audit_log` (0008/0009), the org
spine `organization`/`organization_member` (0010 HIGH-1), and — in PR #42 — `inventory_movements`/
`inventory_bin` (0016). Every other tenant table remains open.

## Evidence (live local stack, `supabase db reset` @ migration 0016)

Per-table delete exposure = (`authenticated` holds the DELETE grant) AND (a permissive DELETE/ALL
policy exists):

| Exposure | Tables |
|---|---|
| **Org member CAN direct-DELETE (28)** | `assets`, `budget_lines`, `budgets`, `event_assets`, `event_attachments`, `event_followups`, `event_locations`, `event_status_history`, `expenses`, `farm_event_*` (partitions), `farms`, `hawshat`, `inventory_items`, `lines`, `palm_status_history`, `people`, `plan_checks`, `plan_labor_requirements`, `plan_material_requirements`, `plan_operations`, `plans`, `purchase_request_items`, `purchase_requests` (`pr_delete` policy), `quantities`, `responsibility_assignments`, `sectors`, `suppliers` |
| **Locked (DELETE denied to authenticated)** | `audit_log`, `organization`, `organization_member`, `inventory_movements`, `inventory_bin` (last two via PR #42) |

**What the app actually deletes as the authenticated user:** exactly **one** table — `plan_checks`
(`app/(app)/plans/[planId]/actions.ts:84`, the plan builder recomputes checks via delete + re-insert).
Every other delete in the codebase runs through the **service_role** admin client (e2e cleanup in
`e2e/global-setup.ts`), which is unaffected by client grants. So the direct-DELETE surface on the
other 27 tables is **open but unused by the product** — pure attack surface.

## Why this was NOT auto-remediated

- It is an **access-control / role-model change** — reserved to the Owner per `docs/CLAUDE.md`
  ("access-control changes: Owner only, and not the actor that produced the change").
- A blanket "lock all tables" migration would be **wrong**: `plan_checks` legitimately needs
  authenticated DELETE, and the correct gate for the rest (deny entirely vs. gate to a write role vs.
  owner-only) differs per table and depends on the pending role model.
- B2.1 (PR #42) was different and *was* fixed: the inventory ledger is append-only by design, nothing
  legitimately deletes it as a client, and B2's own commit claimed to have closed that forge-stock
  surface — so the open DELETE was a **bug in a shipped fix**, not a posture choice.

## Recommendation (for the Owner, with the role-model decision)

1. **Tier A — append-only by nature → deny client DELETE now** (same treatment as the inventory
   ledger and `audit_log`), once each is confirmed unused by a legit client flow:
   `expenses` (financial record of truth), `farm_event*` + `quantities` (operational ledger the
   coverage/PVA engine reconciles against), `event_status_history` + `palm_status_history`
   (audit history — currently unwritten placeholders). Corrections become reversing entries, not
   row deletions.
2. **Tier B — gate DELETE to an explicit role** (owner/manager) when the role model lands:
   `plans`, `plan_operations`, `budgets`, `budget_lines`, `purchase_requests`,
   `purchase_request_items`, structural tables. Use a grant `REVOKE` + a role-scoped policy, **not**
   a `tenant_all` split (the B2 review proved splitting `tenant_all` regresses the PostgREST
   nested-embed reads the wedge loop depends on).
3. **Keep** `plan_checks` deletable by authenticated (the builder needs it), or move its
   recompute behind a SECURITY DEFINER RPC if it is later locked down.
4. Add a pgTAP regression per locked table (mirroring `tests/11_inventory_ledger_append_only_test.sql`).

## Verification method (reproducible)

```sql
-- as a supervisor (no inventory.write) in one transaction:
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', <supervisor_uuid>, 'role','authenticated')::text, true);
delete from public.expenses;   -- succeeds today (rolls back in the test tx)
```
The exposure map above is produced by joining `information_schema.role_table_grants` (grantee
`authenticated`, `DELETE`) with `pg_policy.polcmd in ('*','d')` over `pg_class.relrowsecurity` tables.
