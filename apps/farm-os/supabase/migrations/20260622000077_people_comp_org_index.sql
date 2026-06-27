-- perf (#229 unindexed-FK advisor): people_compensation.org_id had no covering index. The org-scoped
-- RLS filter (`org_id in (user_org_ids())` in comp_rw) and the FK both need it; the existing composite
-- people_compensation_person_id_org_id_idx does NOT serve an org-only lookup (org_id is the trailing
-- column). This mirrors the org_idx every other tenant table carries and matters once payroll holds
-- many rows. Purely additive — no behavior change; the index is currently "unused" only because data
-- is tiny.
create index if not exists people_compensation_org_idx on public.people_compensation(org_id);
