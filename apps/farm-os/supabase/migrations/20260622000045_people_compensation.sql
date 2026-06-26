-- Farm OS MVP-0 — PII-1 (#173 / SPEC-0006 §2): move wages off the org-readable `people` table into a
-- role-gated `people_compensation` table.
--
-- THE GAP. `people.rate` (wage) sat on `people`, whose only policy is the org-scoped `tenant_all`
-- (0002) — so ANY authenticated org member (storekeeper/supervisor/agri_engineer) could read every
-- person's wage via `GET /rest/v1/people?select=rate`. UI-gated, not RLS-gated. Violates the
-- MASTER-PLAN ("payroll visible only to owner/accountant").
--
-- THE FIX. A separate `people_compensation` table, RLS-gated so only owner/accountant can read/write,
-- and DROP the leaking `people.rate` column. Verified clean to relocate: nothing reads `people.rate`
-- (app/lib, seed, pgTAP tests, and all SQL functions checked — no `people.rate`/`p.rate` reference).
--
-- Gate: reuse `authorize('budget.write', org_id)` — budget.write maps to owner/accountant (0001),
-- exactly the SPEC-0006 payroll audience, and avoids re-emitting the access-control core. (A future
-- authz-lane change can introduce a dedicated `payroll.read` perm; the role set is identical today,
-- so there is no behavior difference.) Mirrors the WITH CHECK pattern of 0035/0042/0043/0044.

create table public.people_compensation (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organization(id) on delete cascade,
  person_id  uuid not null unique references public.people(id) on delete cascade,
  rate       numeric,
  created_at timestamptz not null default now()
);

grant select, insert, update on public.people_compensation to authenticated;

-- Migrate any existing wage data BEFORE enabling RLS (the in-migration copy runs as the table owner;
-- with FORCE RLS active it would otherwise be evaluated against the WITH CHECK, which has no JWT here).
insert into public.people_compensation (org_id, person_id, rate)
  select org_id, id, rate from public.people where rate is not null;

alter table public.people_compensation enable  row level security;
alter table public.people_compensation force   row level security;

create policy tenant_all on public.people_compensation for all to authenticated
  using      (org_id in (select public.user_org_ids()) and public.authorize('budget.write', org_id))
  with check (org_id in (select public.user_org_ids()) and public.authorize('budget.write', org_id));

-- PII/ledger delete posture (mirror 0027): no client DELETE.
revoke delete on public.people_compensation from authenticated, anon;

-- Close the leak: drop the now-relocated wage column from the org-readable table.
alter table public.people drop column rate;
