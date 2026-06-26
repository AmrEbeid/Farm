-- Farm OS — PII-1 (#173), WAGE slice: move people.rate into a role-gated people_compensation table.
--
-- THE BUG. `people.rate` (wages) lives on `public.people`, whose only RLS policy is `tenant_all`
-- (migration 0002): org-scoped, NO role gate. So ANY authenticated member of the org — supervisor,
-- storekeeper, field roles — can `select rate from people` and read everyone's pay. MASTER-PLAN.md
-- requires "payroll visible only to owner/accountant". `people.rate` is read by NO app code (only the
-- generated database.types.ts references it), so the blast radius of moving it is nil.
--
-- THE FIX. Add a `payroll.read` permission (owner/accountant only) to the org-scoped authorize()
-- overload, create a separate `people_compensation` table whose RLS gates SELECT/write on
-- authorize('payroll.read', org_id), backfill it from people.rate, then DROP people.rate. Wages are
-- now readable only by owner/accountant, per-org.
--
-- ADR-0006 conventions: SECURITY DEFINER + `set search_path = ''`; fully schema-qualified; auth.uid()
-- wrapped in (select …); create-or-replace functions; drop-then-create policies. This is the WAGE
-- (`rate`) slice ONLY — phone/email are untouched (open Owner PII-access decision).

-- ── 1) Add a `payroll.read` permission to the org-scoped authorize() overload (re-emitted VERBATIM
-- from migration 0035 with ONE added branch). All other branches, the m.org_id = p_org scoping, and
-- the function attributes are byte-for-byte identical. ──────────────────────────────────────────────
create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'      and m.role = 'owner')
         or (perm = 'plan.write'      and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'      and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write' and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'    and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'    and m.role in ('owner','accountant')) )
  )
$$;

-- ── 2) The role-gated compensation table. SELECT and write are BOTH gated on payroll.read
-- (owner/accountant), per-org. enable + force RLS (force mirrors migration 0028 so the owner-context
-- /definer paths obey RLS too). ────────────────────────────────────────────────────────────────────
create table public.people_compensation (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organization(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  rate       numeric,
  created_at timestamptz not null default now()
);

-- FK-index convention (migration 0036): cover the FK columns used by joins / ON DELETE cascade.
create index people_compensation_person_id_org_id_idx
  on public.people_compensation(person_id, org_id);

alter table public.people_compensation enable row level security;
alter table public.people_compensation force  row level security;

create policy comp_rw on public.people_compensation
  for all to authenticated
  using (
    org_id in (select public.user_org_ids())
    and public.authorize('payroll.read', org_id)
  )
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('payroll.read', org_id)
  );

-- Client grant for the privilege layer to let RLS run (migration 0009's blanket grant covered only the
-- tables that existed THEN, and sets no default privileges, so a new table needs its own grant). NOT
-- granted to anon: payroll is authenticated-only. DELETE is deliberately WITHHELD, matching the 0027
-- delete-posture remediation (no tenant table except plan_checks is client-deletable) — wages are
-- never directly deleted by a client. The comp_rw policy further gates every row to owner/accountant;
-- force RLS (above) is the real boundary.
grant select, insert, update on public.people_compensation to authenticated;

-- ── 3) Data migration: copy every non-null wage from people into people_compensation. On a fresh
-- `db reset` people is empty here (seed runs after migrations), so this is a no-op then; against
-- existing data it preserves every rate. Runs BEFORE the audit trigger is attached, so the historical
-- backfill is not recorded as user INSERT events. ─────────────────────────────────────────────────
insert into public.people_compensation (org_id, person_id, rate)
  select org_id, id, rate from public.people where rate is not null;

-- ── 4) Drop the leaky column. people.rate is gone; wages live only in the role-gated table. ─────────
alter table public.people drop column rate;

-- ── 5) Audit: payroll changes are sensitive — record every INSERT/UPDATE/DELETE in the append-only
-- audit_log via the generic fn_audit (migration 0008). people_compensation has an `id` column, so the
-- generic trigger (which keys the audit row on new.id) applies directly — no dedicated function needed
-- (unlike organization_member, which has a composite PK; migration 0019). ──────────────────────────
create trigger audit_people_compensation
  after insert or update or delete on public.people_compensation
  for each row execute function public.fn_audit('people_compensation');
