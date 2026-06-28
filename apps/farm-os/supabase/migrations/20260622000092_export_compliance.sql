-- Farm OS — SPEC-0016 slice 1 (schema): export compliance & certification.
-- Records the three real export-certificate types (GACC/CIFER China registration, CAPQ seasonal farm
-- accreditation, QCAP pesticide-residue test) so the system can later compute harvest export-readiness.
-- Owner-gated apply (migration not pushed). NO PII values here — responsible_person_id is an FK to
-- people; the national ID / phone behind it stay under the SPEC-0006 need-to-know gate, and real-cert
-- import is a later slice behind the Stage-M privacy review (CLAUDE.md hard stop).
--
-- Conventions: ADR-0006 (force RLS, org-scoped 2-arg authorize, fn_audit/0008, FK-index/0036,
-- delete-posture/0027). Adds a new `export.write` permission (owner/farm_manager) to the authorize()
-- map — the one access-control change here; reviewed at the gate.

-- ── 1) Extend authorize() with export.write (re-emitted VERBATIM from 0081 + the new clause) ──────────
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
         or (perm = 'payroll.read'    and m.role in ('owner','accountant'))
         or (perm = 'structure.write' and m.role in ('owner','farm_manager'))
         or (perm = 'export.write'    and m.role in ('owner','farm_manager')) )
  )
$$;

-- ── 2) GACC/CIFER overseas-enterprise registration (per org, per destination market) ─────────────────
create table public.export_registrations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organization(id) on delete cascade,
  market           text not null,          -- destination market code, e.g. 'CN'
  registration_no  text,                   -- GACC/CIFER number (business identifier, not PII)
  enterprise_name  text,
  product          text,
  status           text,
  valid_from       date,
  valid_to         date,
  created_at       timestamptz not null default now()
);

-- ── 3) CAPQ seasonal farm-export accreditation ───────────────────────────────────────────────────────
create table public.farm_export_accreditations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organization(id) on delete cascade,
  season                int,
  farm_code             text,              -- e.g. CAPQ code
  crop                  text,
  variety               text,
  area_feddan           numeric,
  approved_qty_ton      numeric,
  destination_market    text,
  valid_from            date,
  valid_to              date,
  responsible_person_id uuid references public.people(id) on delete set null, -- PII behind SPEC-0006
  created_at            timestamptz not null default now()
);

-- ── 4) QCAP residue test (header) + its result lines ─────────────────────────────────────────────────
create table public.residue_tests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organization(id) on delete cascade,
  lab             text,
  certificate_no  text,
  received_at     date,
  crop            text,
  variety         text,
  sample_ref      text,
  created_at      timestamptz not null default now()
);
create table public.residue_test_results (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organization(id) on delete cascade,
  residue_test_id  uuid not null references public.residue_tests(id) on delete cascade,
  compound         text not null,
  value_mg_kg      numeric,
  method           text,
  created_at       timestamptz not null default now()
);

-- ── FK indexes (migration 0036 convention) ───────────────────────────────────────────────────────────
create index export_registrations_org_idx        on public.export_registrations(org_id);
create index farm_export_accreditations_org_idx   on public.farm_export_accreditations(org_id);
create index farm_export_accreditations_person_idx on public.farm_export_accreditations(responsible_person_id, org_id);
create index residue_tests_org_idx                on public.residue_tests(org_id);
create index residue_test_results_test_idx        on public.residue_test_results(residue_test_id, org_id);

-- ── RLS: org-scoped reads; writes gated on export.write; member-writable cross-org FKs validated in
--    WITH CHECK (cross-org FK invariant, test 74). force RLS is the real boundary. ────────────────────
alter table public.export_registrations        enable row level security;
alter table public.export_registrations        force  row level security;
alter table public.farm_export_accreditations  enable row level security;
alter table public.farm_export_accreditations  force  row level security;
alter table public.residue_tests               enable row level security;
alter table public.residue_tests               force  row level security;
alter table public.residue_test_results         enable row level security;
alter table public.residue_test_results         force  row level security;

create policy tenant_all on public.export_registrations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()) and public.authorize('export.write', org_id));

create policy tenant_all on public.farm_export_accreditations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('export.write', org_id)
    and (farm_export_accreditations.responsible_person_id is null
         or exists (select 1 from public.people pe
                    where pe.id = farm_export_accreditations.responsible_person_id
                      and pe.org_id = farm_export_accreditations.org_id)));

create policy tenant_all on public.residue_tests for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()) and public.authorize('export.write', org_id));

create policy tenant_all on public.residue_test_results for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('export.write', org_id)
    and exists (select 1 from public.residue_tests rt
                where rt.id = residue_test_results.residue_test_id
                  and rt.org_id = residue_test_results.org_id));

-- ── Client grants: authenticated only; NO anon; DELETE withheld (0027 delete-posture) ────────────────
grant select, insert, update on public.export_registrations       to authenticated;
grant select, insert, update on public.farm_export_accreditations  to authenticated;
grant select, insert, update on public.residue_tests               to authenticated;
grant select, insert, update on public.residue_test_results        to authenticated;

-- ── Audit: every write recorded in the append-only audit_log via the generic fn_audit (0008) ─────────
create trigger audit_export_registrations
  after insert or update or delete on public.export_registrations
  for each row execute function public.fn_audit('export_registration');
create trigger audit_farm_export_accreditations
  after insert or update or delete on public.farm_export_accreditations
  for each row execute function public.fn_audit('farm_export_accreditation');
create trigger audit_residue_tests
  after insert or update or delete on public.residue_tests
  for each row execute function public.fn_audit('residue_test');
create trigger audit_residue_test_results
  after insert or update or delete on public.residue_test_results
  for each row execute function public.fn_audit('residue_test_result');
