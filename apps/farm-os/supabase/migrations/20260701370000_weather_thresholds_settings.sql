-- Farm OS — SPEC-0007 §3 slice 2: make the weather operation-gate thresholds ACTUALLY editable.
--
-- PROBLEM: `lib/weather.ts` / `WeatherCard` have accepted a `thresholds` prop since Stage 9 (PR #350),
-- and SPEC-0007 §3 documents "thresholds owner/farm_manager-writable via authorize('plan.write')" —
-- but no page ever passed anything except DEFAULT_THRESHOLDS, and there was no write path or storage
-- for a per-org override. This closes that gap.
--
-- STORAGE DECISION: `organization.settings jsonb not null default '{}'::jsonb` has existed since the
-- very first migration (20260622000001) and has never been used by any code path (grepped: zero reads/
-- writes). Rather than add a new table for one small settings blob, this reuses that pre-existing
-- extensible-settings column — the override lives at `settings->'weather_thresholds'`, a jsonb object
-- shaped exactly like `lib/weather.ts`'s `WeatherThresholds` (sprayMaxWindKph, pollinateMaxRainMm,
-- pollinateMaxWindKph, harvestMaxRainMm, heatStressC, frostBelowC). Any OTHER future settings key can
-- reuse the same column without another migration.
--
-- SECURITY: writes go ONLY through this SECURITY DEFINER RPC (organization INSERT/UPDATE/DELETE is
-- already revoked from `authenticated`, migration 0010 HIGH-1 — direct client DML can't touch it
-- anyway). Gated on `authorize('plan.write', p_org)` — the SAME permission SPEC-0007 §3 names, already
-- granted to owner/farm_manager by the current authorize(text, uuid) (re-emitted as recently as
-- migration 20260629150000) — so NO authorize() re-emit is needed here (the re-emit footgun only bites
-- when a NEW permission is added; this reuses an existing one verbatim). Every field is independently
-- range-checked server-side (mirrors the client-side `RANGE` envelopes in lib/weather.ts) so a corrupt/
-- hostile payload can never wedge a gate into an absurd always-on/always-off state. Audited directly
-- (organization has no org_id column, so the generic fn_audit trigger doesn't apply — same pattern as
-- migration 20260701090000's org-settings audit).
--
-- Validation: pgTAP 112_weather_thresholds_test.sql; lib/weather.test.ts covers the pure gate/merge
-- logic. Owner-gated apply (draft only) — never touches a remote database from this session.

create or replace function public.fn_update_weather_thresholds(
  p_org uuid,
  p_thresholds jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_keys text[] := array[
    'sprayMaxWindKph', 'pollinateMaxRainMm', 'pollinateMaxWindKph',
    'harvestMaxRainMm', 'heatStressC', 'frostBelowC'
  ];
  v_key text;
  v_val numeric;
  v_new jsonb;
begin
  if not public.authorize('plan.write', p_org) then
    raise exception 'forbidden: plan.write is required to edit weather thresholds' using errcode = '42501';
  end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and p_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org settings change' using errcode = '42501';
  end if;

  if p_thresholds is null or jsonb_typeof(p_thresholds) <> 'object' then
    raise exception 'thresholds payload must be a json object' using errcode = '22023';
  end if;

  -- exactly the known keys, each a finite number within a plausible envelope (mirrors lib/weather.ts
  -- RANGE — tempC [-40,60], windKph [0,400], rainMm [0,2000]). Anything else is rejected, not clamped.
  foreach v_key in array v_keys loop
    if not (p_thresholds ? v_key) then
      raise exception 'missing threshold: %', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(p_thresholds -> v_key) <> 'number' then
      raise exception 'threshold % must be numeric', v_key using errcode = '22023';
    end if;
    v_val := (p_thresholds ->> v_key)::numeric;
    if v_key in ('sprayMaxWindKph', 'pollinateMaxWindKph') and (v_val < 0 or v_val > 400) then
      raise exception 'threshold % out of range', v_key using errcode = '22023';
    elsif v_key in ('pollinateMaxRainMm', 'harvestMaxRainMm') and (v_val < 0 or v_val > 2000) then
      raise exception 'threshold % out of range', v_key using errcode = '22023';
    elsif v_key in ('heatStressC', 'frostBelowC') and (v_val < -40 or v_val > 60) then
      raise exception 'threshold % out of range', v_key using errcode = '22023';
    end if;
  end loop;

  if (p_thresholds ->> 'frostBelowC')::numeric >= (p_thresholds ->> 'heatStressC')::numeric then
    raise exception 'frostBelowC must be less than heatStressC' using errcode = '22023';
  end if;

  -- rebuild as a clean object (only the 6 known keys, coerced to numeric) — never store whatever
  -- extra keys/shape the caller sent, even if validation above passed.
  v_new := jsonb_build_object(
    'sprayMaxWindKph',     (p_thresholds ->> 'sprayMaxWindKph')::numeric,
    'pollinateMaxRainMm',  (p_thresholds ->> 'pollinateMaxRainMm')::numeric,
    'pollinateMaxWindKph', (p_thresholds ->> 'pollinateMaxWindKph')::numeric,
    'harvestMaxRainMm',    (p_thresholds ->> 'harvestMaxRainMm')::numeric,
    'heatStressC',         (p_thresholds ->> 'heatStressC')::numeric,
    'frostBelowC',         (p_thresholds ->> 'frostBelowC')::numeric
  );

  select settings -> 'weather_thresholds' into v_before from public.organization where id = p_org;

  update public.organization
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{weather_thresholds}', v_new, true)
    where id = p_org;

  select settings -> 'weather_thresholds' into v_after from public.organization where id = p_org;

  insert into public.audit_log(org_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (
    p_org, (select auth.uid()), 'UPDATE', 'organization_weather_thresholds', p_org::text,
    jsonb_build_object('weather_thresholds', v_before),
    jsonb_build_object('weather_thresholds', v_after)
  );
end;
$$;

revoke all     on function public.fn_update_weather_thresholds(uuid, jsonb) from public;
revoke execute on function public.fn_update_weather_thresholds(uuid, jsonb) from anon;
grant  execute on function public.fn_update_weather_thresholds(uuid, jsonb) to authenticated;
