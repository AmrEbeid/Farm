-- Seed invariants: the FF palm-count reconciliation, the potassium shortage, the budget
-- breach, and the SC-6 ledger reconciliation. Run as superuser (no RLS) against the seed.

begin;
select plan(8);

-- FF-1: Σ(hawsha.palm_count_barhi) per sector == the canonical sector total.
select is((select sum(palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id=h.sector_id where s.code='HSW'), 1165::bigint,
  'الحصوة hawshat برحي sum == 1165');
select is((select sum(palm_count_barhi) from public.hawshat h
  join public.sectors s on s.id=h.sector_id where s.code='BAB'), 1485::bigint,
  'حوض البابور hawshat برحي sum == 1485');

-- Canonical registry totals across all 28 hawshat.
select is((select sum(palm_count_barhi) from public.hawshat), 4380::bigint,
  'total برحي across 28 hawshat == 4,380 (registry)');
select is((select sum(palm_count_male) from public.hawshat), 299::bigint,
  'total ذكور across 28 hawshat == 299 (registry)');
select is((select count(*) from public.hawshat), 28::bigint, '28 hawshat (registry)');

-- The deliberate potassium-sulfate shortage: available 300 < planned need 500.
select ok((
  select (b.on_hand - b.reserved) < pmr.qty
  from public.inventory_items i
  join public.inventory_bin b on b.item_id=i.id
  join public.plan_material_requirements pmr on pmr.item_id=i.id
  where i.name='سلفات بوتاسيوم'
), 'potassium shortage exists: available 300 < planned need 500');

-- The deliberate أسمدة budget breach: the 42,000 op exceeds the 60,000 available comfortably
-- enough to trip the comfort threshold (available is low: < 10% of planned).
select ok((
  select (planned - actual - committed) = 60000
  from public.budget_lines where category='أسمدة'
), 'أسمدة budget available == 60,000 (the breach setup)');

-- SC-6: Σ(movements) per item×location == inventory_bin.on_hand (never drifts).
select is((
  select count(*) from public.inventory_bin b
  left join (
    select item_id, location, sum(qty) as s
    from public.inventory_movements group by item_id, location
  ) m on m.item_id=b.item_id and m.location=b.location
  where b.on_hand <> coalesce(m.s, 0)
), 0::bigint, 'SC-6: every bin reconciles with Σ(movements)');

select * from finish();
rollback;
