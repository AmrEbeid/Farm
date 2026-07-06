-- Farm OS — execute-operation legacy sector guard.
--
-- fn_execute_operation now supports multi-material execution (20260701230000). This migration
-- re-emits that current five-argument function and changes only the legacy NULL target_type
-- location path: old operations may carry an untyped target_id, but that UUID must resolve to a
-- same-org sector before it is written to event_locations.sector_id. If it does not, the execution
-- remains valid and records a location warning on farm_event.data, but the location columns stay
-- null rather than trusting or cross-org-attributing the UUID.

drop function if exists public.fn_execute_operation(uuid, numeric, int, text);

create or replace function public.fn_execute_operation(
  p_op_id uuid,
  p_actual_qty numeric,
  p_labor_count int,
  p_note text default null,
  p_material_actuals jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_plan uuid; v_subtype text; v_target uuid; v_est numeric; v_status text;
  v_target_type text;
  v_person uuid; v_event uuid; v_actual_cost numeric; v_now timestamptz := now();
  v_claimed int;
  v_mat_count int;
  v_actuals jsonb;
  v_weight_sum numeric := 0;
  v_result_actuals jsonb := '[]'::jsonb;
  v_legacy_actual_qty numeric;
  v_rec record;
  v_actual_i numeric;
  v_weight_i numeric;
  v_share_i numeric;
  v_est_i numeric;
  v_cost_i numeric;
  v_mat_json jsonb;
  v_item_i uuid;
  v_farm uuid; v_sector uuid; v_hawsha uuid; v_line uuid; v_asset uuid;
  v_location_warning jsonb;
begin
  -- B4: range-check inputs (a negative actual_qty would otherwise RAISE on_hand via the issue path).
  -- Validated unconditionally for input hygiene, even though its value is only authoritative in the
  -- 0/1-material (legacy) path once p_material_actuals is supplied — see header comment.
  if p_actual_qty is null or p_actual_qty < 0 then
    raise exception 'invalid actual_qty: %', p_actual_qty using errcode = '22023';
  end if;
  if p_labor_count is null or p_labor_count < 0 then
    raise exception 'invalid labor_count: %', p_labor_count using errcode = '22023';
  end if;

  -- the operation (material requirements are loaded separately below, AFTER the claim, so the
  -- LIMIT-1 masking bug cannot recur: every row on the op is read, not just one).
  select po.org_id, po.plan_id, po.subtype, po.target_id, po.target_type, po.est_cost, po.status
    into v_org, v_plan, v_subtype, v_target, v_target_type, v_est, v_status
    from public.plan_operations po
    where po.id = p_op_id;
  if v_org is null then
    raise exception 'operation % not found', p_op_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): enforce op.execute SCOPED TO THE OP'S ORG, now that v_org is resolved. authorize()
  -- reads auth.uid() from the JWT GUC, which SECURITY DEFINER does NOT change, so it evaluates the
  -- *caller's* permission IN v_org even though the body runs as the definer.
  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to execute operations'
      using errcode = '42501';
  end if;

  -- org guard: the op must belong to one of the caller's orgs (defence in depth alongside RLS).
  if (select auth.uid()) is not null and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org operation %', p_op_id using errcode = '42501';
  end if;

  -- EXE-STATUS (#235): only an ACTIVE operation is executable. A terminal op (blocked /
  -- abandoned / skipped) must NOT be executed — doing so would issue stock and flip a cancelled
  -- op to done. ('done' is handled by the claim-first guard below, with the clearer
  -- "already executed" error; planned / reserved / ready / in_progress proceed normally.)
  if v_status in ('blocked', 'abandoned', 'skipped') then
    raise exception 'operation % is not executable in status %', p_op_id, v_status
      using errcode = '22023';
  end if;

  -- EXE-1: claim-first. Flip → done only if not already done; abort if another caller won the race.
  update public.plan_operations set status = 'done'
    where id = p_op_id and status <> 'done';
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'operation % already executed', p_op_id using errcode = '23505';
  end if;

  -- how many materials does this op actually carry?
  select count(*) into v_mat_count from public.plan_material_requirements where plan_op_id = p_op_id;

  -- Resolve the per-material actuals to use, honouring the backward-compatibility contract above.
  if p_material_actuals is not null and jsonb_typeof(p_material_actuals) = 'array'
     and jsonb_array_length(p_material_actuals) > 0 then
    v_actuals := p_material_actuals;
  elsif v_mat_count = 0 then
    v_actuals := '[]'::jsonb;
  elsif v_mat_count = 1 then
    -- legacy fallback: the op's one material takes the scalar p_actual_qty (unchanged behaviour).
    -- requirement_id is still populated (= that one row's id) so this flows through the SAME
    -- requirement_id-keyed matching loop below as the explicit multi-material path.
    select jsonb_build_array(jsonb_build_object(
        'requirement_id', pmr.id, 'item_id', pmr.item_id, 'actual_qty', p_actual_qty))
      into v_actuals
      from public.plan_material_requirements pmr
      where pmr.plan_op_id = p_op_id;
  else
    -- >1 materials and no per-material actuals supplied: refuse rather than guess which material the
    -- bare scalar belongs to (never silently mis-issue any of them).
    raise exception 'operation % has % materials; p_material_actuals is required', p_op_id, v_mat_count
      using errcode = '22023';
  end if;

  -- a supplied array must cover EXACTLY the op's materials (catches a stray/mismatched requirement_id
  -- loudly rather than silently under-consuming one material or over-consuming a wrong one; a length
  -- mismatch alone isn't sufficient on its own — the per-row match below also rejects a same-length
  -- array whose requirement_ids don't correspond 1:1 to this op's rows).
  if jsonb_array_length(v_actuals) <> v_mat_count then
    raise exception 'operation % expects % material actuals, got %',
      p_op_id, v_mat_count, jsonb_array_length(v_actuals)
      using errcode = '22023';
  end if;

  -- actual cost = actual qty × the plan's unit rate (est_cost ÷ planned qty); B3. When the op has
  -- multiple materials, est_cost is split across them first (see the COST-SPLIT ASSUMPTION above);
  -- for 0/1 materials this reduces to the pre-existing formula exactly (share = 1). Default (0
  -- materials) mirrors the original: the full est_cost, unattached to any consumption.
  v_actual_cost := coalesce(v_est, 0);

  if v_mat_count > 0 then
    -- pass 1: the pricing weight sum, so every material's share can be computed in pass 2.
    select coalesce(sum(pmr.qty * coalesce(ii.unit_cost, 0)), 0)
      into v_weight_sum
      from public.plan_material_requirements pmr
      join public.inventory_items ii on ii.id = pmr.item_id
      where pmr.plan_op_id = p_op_id;

    v_actual_cost := 0;

    -- pass 2: one iteration per material — validate, price, consume (quantities + fn_post_movement).
    -- Ordered by pmr.id (the row's own identity), not item_id — deterministic even when two rows
    -- share an item_id (see the MATCH KEY note in the header).
    for v_rec in
      select pmr.id as req_id, pmr.item_id, pmr.qty, pmr.unit
        from public.plan_material_requirements pmr
        where pmr.plan_op_id = p_op_id
        order by pmr.id
    loop
      -- Match this REQUIREMENT ROW (not this item) to its actuals entry by requirement_id. `id` is
      -- plan_material_requirements' primary key, so `limit 1` is safe here (at most one row in
      -- v_actuals can carry a given requirement_id, unlike item_id which can repeat across rows).
      select (elem->>'actual_qty')::numeric into v_actual_i
        from jsonb_array_elements(v_actuals) elem
        where (elem->>'requirement_id')::uuid = v_rec.req_id
        limit 1;

      if v_actual_i is null or v_actual_i < 0 or v_actual_i = 'NaN'::numeric then
        -- No actuals entry has THIS row's requirement_id — either it was simply omitted, or the
        -- caller supplied a stale/mismatched/cross-op requirement_id that (correctly) cannot match
        -- any row here. Either way: refuse loudly rather than silently skipping/mis-issuing.
        raise exception 'invalid actual_qty % for material requirement %', v_actual_i, v_rec.req_id
          using errcode = '22023';
      end if;

      -- this material's share of est_cost: proportional by qty×unit_cost when priced, else even split.
      v_weight_i := v_rec.qty * coalesce((select unit_cost from public.inventory_items where id = v_rec.item_id), 0);
      v_share_i := case when v_weight_sum > 0 then v_weight_i / v_weight_sum else 1.0 / v_mat_count end;
      v_est_i := coalesce(v_est, 0) * v_share_i;
      v_cost_i := case when coalesce(v_rec.qty, 0) > 0
                    then trim_scale(v_actual_i * (v_est_i / v_rec.qty))
                    else trim_scale(v_est_i)
                  end;
      v_actual_cost := v_actual_cost + v_cost_i;

      -- the done farm_event is inserted AFTER this loop (needs v_event); the consumption row below
      -- references v_event, so materials are recorded once v_event exists — see below.
      v_result_actuals := v_result_actuals || jsonb_build_array(jsonb_build_object(
        'requirement_id', v_rec.req_id, 'item_id', v_rec.item_id, 'unit', v_rec.unit,
        'planned_qty', v_rec.qty, 'actual_qty', v_actual_i, 'actual_cost', v_cost_i));
    end loop;

    v_actual_cost := trim_scale(v_actual_cost);
  end if;

  -- legacy scalar mirror of actual_qty on the farm_event: coherent only for 0/1 materials (matches the
  -- pre-existing single-value shape the PvA report already reads); null for >1 (no single number is
  -- meaningful across different materials/units) — the report reads `material_actuals` for those.
  v_legacy_actual_qty := case when v_mat_count <= 1 then p_actual_qty else null end;

  -- the actor's person row (nullable), for performed_by_person_id
  select id into v_person from public.people
    where user_id = (select auth.uid()) and org_id = v_org limit 1;

  -- 1) the done farm_event (actuals embedded for the PvA report). occurred_at = now() → routes to the
  --    farm_event_default partition for dates outside the seed months.
  insert into public.farm_event (org_id, type, subtype, status, occurred_at, planned_at,
                                 performed_by_person_id, plan_id, notes, data)
  values (v_org, 'operation', v_subtype, 'done', v_now, v_now, v_person, v_plan, p_note,
          jsonb_build_object('labor_count', p_labor_count, 'actual_qty', v_legacy_actual_qty,
                             'actual_cost', v_actual_cost, 'op_id', p_op_id,
                             'material_actuals', v_result_actuals))
  returning id into v_event;

  -- event_locations: resolve the operation target into the same ancestor chain that
  -- fn_record_event writes. Detail pages filter by their own id (sector/hawsha/line), so a palm
  -- operation must also carry its line/hawsha/sector/farm ancestors; otherwise it disappears from
  -- the parent 360 pages and field dashboards. NULL target_type keeps the legacy sector-only
  -- interpretation only when target_id is a same-org sector. Otherwise, record an explicit warning
  -- and leave the event unlocated instead of writing an unchecked UUID into sector_id.
  case
    when v_target_type is null then
      if v_target is not null then
        select s.id, s.farm_id into v_sector, v_farm
          from public.sectors s
          where s.id = v_target and s.org_id = v_org;
        if v_sector is null then
          v_location_warning := jsonb_build_object(
            'code', 'legacy_target_id_not_sector',
            'target_id', v_target);
        end if;
      end if;
    when v_target_type = 'farm' then
      if v_target is not null then
        select f.id into v_farm
          from public.farms f
          where f.id = v_target and f.org_id = v_org;
        if v_farm is null then
          raise exception 'operation % farm target % not found', p_op_id, v_target
            using errcode = 'P0002';
        end if;
      end if;
    when v_target_type = 'sector' then
      if v_target is not null then
        select s.id, s.farm_id into v_sector, v_farm
          from public.sectors s
          where s.id = v_target and s.org_id = v_org;
        if v_sector is null then
          raise exception 'operation % sector target % not found', p_op_id, v_target
            using errcode = 'P0002';
        end if;
      end if;
    when v_target_type = 'hawsha' then
      if v_target is not null then
        select h.id, h.sector_id, s.farm_id into v_hawsha, v_sector, v_farm
          from public.hawshat h
          join public.sectors s on s.id = h.sector_id
          where h.id = v_target and h.org_id = v_org;
        if v_hawsha is null then
          raise exception 'operation % hawsha target % not found', p_op_id, v_target
            using errcode = 'P0002';
        end if;
      end if;
    when v_target_type = 'line' then
      if v_target is not null then
        select l.id, l.hawsha_id, h.sector_id, s.farm_id into v_line, v_hawsha, v_sector, v_farm
          from public.lines l
          join public.hawshat h on h.id = l.hawsha_id
          join public.sectors s on s.id = h.sector_id
          where l.id = v_target and l.org_id = v_org;
        if v_line is null then
          raise exception 'operation % line target % not found', p_op_id, v_target
            using errcode = 'P0002';
        end if;
      end if;
    when v_target_type = 'palm' then
      if v_target is not null then
        select a.id, a.line_id, a.hawsha_id, a.sector_id into v_asset, v_line, v_hawsha, v_sector
          from public.assets a
          where a.id = v_target and a.org_id = v_org and a.type = 'palm';
        if v_asset is null then
          raise exception 'operation % palm target % not found', p_op_id, v_target
            using errcode = 'P0002';
        end if;
        if v_hawsha is null and v_line is not null then
          select l.hawsha_id into v_hawsha
            from public.lines l
            where l.id = v_line and l.org_id = v_org;
        end if;
        if v_hawsha is not null then
          select h.sector_id, s.farm_id into v_sector, v_farm
            from public.hawshat h
            join public.sectors s on s.id = h.sector_id
            where h.id = v_hawsha and h.org_id = v_org;
        elsif v_sector is not null then
          select s.farm_id into v_farm
            from public.sectors s
            where s.id = v_sector and s.org_id = v_org;
        end if;
      end if;
    else
      raise exception 'operation % has unrecognized target_type %', p_op_id, v_target_type
        using errcode = '22023';
  end case;

  if v_location_warning is not null then
    update public.farm_event
       set data = data || jsonb_build_object('location_warning', v_location_warning)
     where id = v_event and org_id = v_org and occurred_at = v_now;
  end if;

  insert into public.event_locations (event_id, org_id, farm_id, sector_id, hawsha_id, line_id, asset_id)
  values (v_event, v_org, v_farm, v_sector, v_hawsha, v_line, v_asset);

  if v_asset is not null then
    insert into public.event_assets(event_id, asset_id, org_id)
    values (v_event, v_asset, v_org)
    on conflict do nothing;
  end if;

  -- 2) consume EVERY material: one quantities row PER material + one fn_post_movement issue PER
  --    material against ITS OWN item_id (never combined/summed across items). Sourced straight from
  --    v_result_actuals (already validated + priced in pass 2 above) rather than re-parsing v_actuals,
  --    so there is exactly one place that maps the caller's input onto per-material actuals. Each call
  --    is transactional and part of THIS transaction, so any failure rolls the whole execution back.
  -- #512: NO `release` here. Execute owns no per-op reservation (reserves are item-level coverage
  -- earmarks under SEED_PLAN), so a blind bin-wide release wiped unrelated ops' earmarks → masked their
  -- shortage. The earmark is released by an attributed release-on-receipt, NOT here.
  for v_mat_json in select value from jsonb_array_elements(v_result_actuals)
  loop
    v_item_i := (v_mat_json->>'item_id')::uuid;
    v_actual_i := (v_mat_json->>'actual_qty')::numeric;

    insert into public.quantities (org_id, event_id, measure, value_num, label, material_id,
                                   inventory_adjustment)
    values (v_org, v_event, 'weight', v_actual_i, 'كمية مستخدمة', v_item_i, -v_actual_i);

    perform public.fn_post_movement(v_item_i, 'issue', v_actual_i, 'main',
                                    coalesce(v_mat_json->>'unit', 'kg'), null, v_event, v_plan);
  end loop;

  return jsonb_build_object('event_id', v_event, 'actual_cost', v_actual_cost,
                           'op_id', p_op_id, 'plan_id', v_plan);
end $$;

-- Grants: unchanged intent (authenticated only, no anon/public), re-stated for the new 5-arg
-- signature (the OLD 4-arg overload was explicitly DROPPED above, so it cannot linger with its
-- stale LIMIT-1 body and stale grants).
revoke all     on function public.fn_execute_operation(uuid, numeric, int, text, jsonb) from public;
revoke execute on function public.fn_execute_operation(uuid, numeric, int, text, jsonb) from anon;
grant  execute on function public.fn_execute_operation(uuid, numeric, int, text, jsonb) to authenticated;
