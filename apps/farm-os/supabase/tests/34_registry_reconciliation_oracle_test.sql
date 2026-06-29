-- Stage-2 registry reconciliation oracle (SPEC-0003 §5).
-- The gate for the farm-structure import: it must hold for the canonical
-- Nov-2025 palm registry (4,380 برحي / 299 ذكور / 28 حوش across 5 sectors) and
-- fail loudly on any drift. Locks the per-sector distribution, structural
-- integrity (no orphans, no cross-org nesting), and Arabic/UTF-8 name integrity.
-- Run as superuser (no RLS) against the seeded reference tenant. Never weaken an
-- assertion to make an import pass (SPEC-0003 §7).

begin;
select plan(19);

-- ── Registry totals (the canonical source of truth, non-negotiable #5) ──────
select is((select count(*) from public.sectors
  where org_id = '00000000-0000-0000-0000-000000000001'), 5::bigint,
  'registry: 5 sectors (4-vs-5 decision ratified = 5)');
select is((select sum(palm_count_barhi) from public.hawshat), 4380::bigint,
  'registry: Σ(palm_count_barhi) == 4,380 برحي');
select is((select sum(palm_count_male) from public.hawshat), 299::bigint,
  'registry: Σ(palm_count_male) == 299 ذكور');
select is((select count(*) from public.hawshat), 28::bigint,
  'registry: 28 حوش');

-- ── Per-sector برحي distribution (a bad import that keeps the grand total but
--    shuffles palms between sectors is still wrong — lock each sector) ────────
select is((select sum(h.palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id = h.sector_id where s.code = 'S22'), 948::bigint,
  'registry: الـ22 فدان (S22) برحي == 948');
select is((select sum(h.palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id = h.sector_id where s.code = 'HSW'), 1165::bigint,
  'registry: الحصوة (HSW) برحي == 1,165');
select is((select sum(h.palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id = h.sector_id where s.code = 'BAB'), 1485::bigint,
  'registry: حوض البابور (BAB) برحي == 1,485');
select is((select sum(h.palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id = h.sector_id where s.code = 'SHF'), 269::bigint,
  'registry: الشفعة (SHF) برحي == 269');
select is((select sum(h.palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id = h.sector_id where s.code = 'KHT'), 513::bigint,
  'registry: الخطارة (KHT) برحي == 513');

-- ── Structural integrity: no orphans across the farm→sector→hawsha→line→asset
--    spine (SPEC-0003 §5) ─────────────────────────────────────────────────────
select is((select count(*) from public.hawshat h
  where not exists (select 1 from public.sectors s where s.id = h.sector_id)),
  0::bigint, 'integrity: no orphan hawshat (every حوش ∈ a sector)');
select is((select count(*) from public.lines l
  where not exists (select 1 from public.hawshat h where h.id = l.hawsha_id)),
  0::bigint, 'integrity: no orphan lines (every line ∈ a hawsha)');
select is((select count(*) from public.assets a
  where a.sector_id is not null
    and not exists (select 1 from public.sectors s where s.id = a.sector_id)),
  0::bigint, 'integrity: no asset references a missing sector');
select is((select count(*) from public.assets a
  where a.hawsha_id is not null
    and not exists (select 1 from public.hawshat h where h.id = a.hawsha_id)),
  0::bigint, 'integrity: no asset references a missing hawsha');

-- ── Tenant integrity: a hawsha never nests under a sector from another org ───
select is((select count(*) from public.hawshat h
  join public.sectors s on s.id = h.sector_id
  where h.org_id <> s.org_id), 0::bigint,
  'integrity: every hawsha.org_id == its sector.org_id (no cross-org nesting)');

-- ── Arabic / UTF-8 integrity: names render as Arabic, no mojibake/truncation;
--    codes are present (ASCII codes like S22/HSW are fine) ─────────────────────
select ok((select every(char_length(name) > 0 and name ~ '[ء-ي]')
  from public.sectors where org_id = '00000000-0000-0000-0000-000000000001'),
  'arabic: every sector.name is non-empty Arabic (no mojibake)');
select ok((select every(char_length(name) > 0 and name ~ '[ء-ي]')
  from public.hawshat), 'arabic: every hawsha.name is non-empty Arabic');
select ok((select every(code is not null and char_length(code) > 0)
  from public.sectors), 'integrity: every sector has a non-empty code');
select ok((select every(code is not null and char_length(code) > 0)
  from public.hawshat), 'integrity: every hawsha has a non-empty code');

-- ── Per-tree ↔ aggregate reconciliation (anti-tautology, issue #239) ─────────
--    The assertions above sum hawshat.palm_count_* — but seed.sql writes those
--    exact constants into those aggregate columns by hand, so they reconcile
--    fabricated columns against the same constants and CANNOT fail (tautology).
--    The real Stage-2 deliverable (SPEC-0003) is the per-tree import into
--    `assets (type='palm')`. This assertion reconciles the per-tree ROW COUNT
--    against the aggregate columns — two independent sources — so it only holds
--    once the real ~4,679-row registry is imported. Until then ~60 palm rows
--    exist, so it is wrapped in `todo` (reports but does not fail CI).
--    WHEN the Owner-gated real import lands (SPEC-0003 §5): delete the
--    todo_start/todo_end wrapper so the oracle becomes a hard gate. Never weaken
--    the assertion to make an import pass (SPEC-0003 §7).
select todo_start('per-tree palm registry import pending — SPEC-0003 / issue #239');
select is(
  (select count(*) from public.assets
     where org_id = '00000000-0000-0000-0000-000000000001' and type = 'palm'),
  (select coalesce(sum(palm_count_barhi), 0) + coalesce(sum(palm_count_male), 0)
     from public.hawshat
     where org_id = '00000000-0000-0000-0000-000000000001')::bigint,
  'reconcile: count(assets type=palm) == Σ(palm_count_barhi + palm_count_male) [4,679]');
select todo_end();

select * from finish();
rollback;
