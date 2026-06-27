-- Farm OS — Stage 1: active-org / multi-org switching (the "consultant in two orgs" criterion).
--
-- Until now public.user_org_ids() returned EVERY org the user belongs to, so RLS granted all of
-- them simultaneously — there was no "active org". A consultant in orgs A and B saw a merged view.
--
-- This adds an active-org concept at the RLS layer with ZERO churn to the ~36 tenant policies:
-- every tenant policy already filters on `org_id in (select public.user_org_ids())`, so narrowing
-- that ONE helper narrows them all (and any future tenant table that follows the pattern inherits
-- the narrowing for free — no per-table change, no collision with parallel feature work).
--
-- Design:
--   * public.user_member_org_ids()  — NEW: the user's FULL membership set (the OLD user_org_ids
--       semantics). Used by the organization / organization_member READ policies so the org
--       switcher can still enumerate every org the user belongs to, and as the membership boundary.
--   * public.user_org_ids()         — REDEFINED: the ACTIVE org only, when a valid `active_org_id`
--       claim is present in the request JWT; otherwise the FULL set. Backward-compatible: the
--       single-org pilot and every existing pgTAP test (none of which set the claim) behave exactly
--       as before. The claim is membership-validated INSIDE the helper (org_id must be one the user
--       actually belongs to), so a forged/stale claim can only ever NARROW to a real membership —
--       never escalate. A claim for a non-member org yields the empty set: it FAILS CLOSED.
--   * public.user_active_org        — NEW pref table: the user's chosen active org (server-set only).
--   * public.fn_set_active_org(uuid)— SECURITY DEFINER setter: validates membership, upserts the pref.
--   * public.custom_access_token_hook(jsonb) — Supabase auth hook: injects active_org_id into the
--       JWT at mint from the pref (falling back to the sole/oldest membership). Enable it on the
--       project (config.toml [auth.hook.custom_access_token] / dashboard → Auth → Hooks).
--
-- INV-1 (test 22): both helpers stay anon-EXECUTE-able and SECURITY DEFINER STABLE — unchanged.

-- 1. Full membership set — old user_org_ids() semantics, for the switcher + the boundary. -------
create or replace function public.user_member_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.organization_member where user_id = (select auth.uid())
$$;

-- 2. Active-org-narrowed set — every tenant policy already calls this, so this is the whole gate. -
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with claim as (
    select nullif(
      (current_setting('request.jwt.claims', true)::jsonb) ->> 'active_org_id', ''
    )::uuid as active
  )
  select m.org_id
  from public.organization_member m, claim c
  where m.user_id = (select auth.uid())
    and (c.active is null or m.org_id = c.active)
$$;

-- 3. Organization / membership READ policies use the FULL set so the switcher lists every org. ---
-- (The organization row carries only name/locale/currency/settings; a user legitimately needs the
--  names of all orgs they belong to in order to switch. Tenant DATA stays narrowed via user_org_ids.)
drop policy if exists org_read on public.organization;
create policy org_read on public.organization
  for select to authenticated
  using (id in (select public.user_member_org_ids()));

drop policy if exists member_read on public.organization_member;
create policy member_read on public.organization_member
  for select to authenticated
  using (org_id in (select public.user_member_org_ids()));

-- 4. The active-org preference (one row per user; writes only via fn_set_active_org). ------------
create table if not exists public.user_active_org (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references public.organization(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.user_active_org enable row level security;
alter table public.user_active_org force row level security;

-- a user may read their own active-org pref; nobody writes it directly.
drop policy if exists own_active_org_read on public.user_active_org;
create policy own_active_org_read on public.user_active_org
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.user_active_org from authenticated, anon;

-- 5. Setter: validate membership, then upsert the pref. -----------------------------------------
create or replace function public.fn_set_active_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_member
    where user_id = (select auth.uid()) and org_id = p_org
  ) then
    raise exception 'not a member of org %', p_org using errcode = '42501';
  end if;

  insert into public.user_active_org (user_id, org_id, updated_at)
  values ((select auth.uid()), p_org, now())
  on conflict (user_id) do update
    set org_id = excluded.org_id, updated_at = now();
end;
$$;
revoke all on function public.fn_set_active_org(uuid) from public;
grant execute on function public.fn_set_active_org(uuid) to authenticated;

-- 6. Auth hook: inject the active_org_id claim at token mint (validated; falls back to membership).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid  := (event ->> 'user_id')::uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_active uuid;
begin
  -- prefer the stored pref, but only if it is still a valid membership (fails closed otherwise)
  select a.org_id into v_active
  from public.user_active_org a
  join public.organization_member m
    on m.user_id = a.user_id and m.org_id = a.org_id
  where a.user_id = v_uid;

  -- fall back to the sole / oldest membership so single-org users get a stable active org
  if v_active is null then
    select org_id into v_active
    from public.organization_member
    where user_id = v_uid
    order by created_at
    limit 1;
  end if;

  if v_active is not null then
    v_claims := jsonb_set(v_claims, '{active_org_id}', to_jsonb(v_active::text));
    event    := jsonb_set(event, '{claims}', v_claims);
  end if;

  return event;
end;
$$;

-- The Supabase auth admin role runs the hook. Guard the grant so the Docker-free test harness
-- (which has no supabase_auth_admin role) still applies this migration cleanly.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin';
    execute 'revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public';
  end if;
end
$$;
