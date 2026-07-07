-- Farm OS — fn_sector_pnl: honest per-physical-sector P&L (SPEC-0029 Phase-0 / SPEC-0031 insight arc).
--
-- PROBLEM. The insight arc (المقارنة الداخلية best-unit benchmark, أداء القطاعات per-feddan) needs profit +
-- area per PHYSICAL sector. v_cost_center_rollup is a parent_id-tree rollup and does NOT equal the sector
-- total (the tree and sector_id groupings diverge — e.g. الحصوه's rollup 3.59M ≠ its sector expenses 1.34M),
-- and revenue is never posted to cost-center journal lines (it is a reporting dimension on `sales`). Computing
-- this client-side would mean fetching ~10k expense rows. So aggregate once, correctly, in the DB.
--
-- INTENT. Group operating expenses and sales up to the physical sector via cost_centers.sector_id, and take
-- the canonical sector area from the enterprise='عام' cost center (each sector's «عام» center carries the
-- parcel area; the 5 mapped sectors sum to 107.5 fd). Returns one row per sector WITH activity:
--   { sector_id, name, area_feddan (nullable → honest-null #1), revenue, operating_expense, profit }
-- Drawings (kind='drawing') and capex (kind='capex') are excluded — only kind='operating' hits the P&L (#6).
--
-- SECURITY. Read-only, finance.read-gated, SECURITY DEFINER, search_path=''. EXECUTE revoked from public/anon;
-- granted to authenticated only. No schema/data change; fully reversible: drop function public.fn_sector_pnl(uuid).

create or replace function public.fn_sector_pnl(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org sector P&L' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with exp as (
    select cc.sector_id, sum(e.total) as operating_expense
      from public.expenses e
      join public.cost_centers cc on cc.id = e.cost_center_id
     where e.org_id = p_org and e.kind = 'operating' and cc.sector_id is not null
     group by cc.sector_id
  ),
  rev as (
    select cc.sector_id, sum(s.total) as revenue
      from public.sales s
      join public.cost_centers cc on cc.id = s.cost_center_id
     where s.org_id = p_org and cc.sector_id is not null
     group by cc.sector_id
  ),
  area as (
    -- canonical parcel area: the «عام» center's area per sector (falls back to sectors.area_feddan)
    select distinct on (cc.sector_id) cc.sector_id, cc.area_feddan
      from public.cost_centers cc
     where cc.org_id = p_org and cc.active and cc.sector_id is not null
       and cc.enterprise = 'عام' and cc.area_feddan is not null and cc.area_feddan > 0
     order by cc.sector_id, cc.area_feddan desc
  )
  select coalesce(jsonb_agg(row_obj order by profit desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'sector_id', s.id,
               'name', s.name,
               'area_feddan', coalesce(a.area_feddan, s.area_feddan),
               'revenue', coalesce(r.revenue, 0),
               'operating_expense', coalesce(x.operating_expense, 0),
               'profit', coalesce(r.revenue, 0) - coalesce(x.operating_expense, 0)
             ) as row_obj,
             coalesce(r.revenue, 0) - coalesce(x.operating_expense, 0) as profit
        from public.sectors s
        left join exp x on x.sector_id = s.id
        left join rev r on r.sector_id = s.id
        left join area a on a.sector_id = s.id
       where s.org_id = p_org and not s.archived
         and (x.operating_expense is not null or r.revenue is not null)
    ) t;

  return v_result;
end;
$$;
revoke execute on function public.fn_sector_pnl(uuid) from public, anon, authenticated;
grant execute on function public.fn_sector_pnl(uuid) to authenticated;
