-- Farm OS — STAGE 10 (SPEC-0008): Care Academy content store + #4 sign-off gate.
-- Owner-ratified 2026-06-27; build on SYNTHETIC content, gated. Agronomy figures (NPK / irrigation /
-- pesticide doses) are EDITABLE TEMPLATES — advisory until a NAMED local agronomist signs off AND
-- confirms a CURRENT Egyptian pesticide registration (non-negotiable #4). This migration stores the
-- content + the sign-off record (who / when / registration-expiry); the engineering gate
-- (apps/farm-os/lib/academy.ts, PR #355) decides authoritativeness from these fields. The sign-off
-- itself is a LEGAL act by a licensed external agronomist — the system RECORDS it, never substitutes it.
--
-- Safety property enforced here: EDITING content RESETS the sign-off (changed figures must be
-- re-reviewed) → content cannot stay "authoritative" after its numbers change. Pattern mirrors the
-- structure write RPCs (0081) + attachments (0082): SECURITY DEFINER, pinned empty search_path,
-- schema-qualified, authorize(perm, org) gate, anon + cross-org guard, exec to authenticated only.
-- Reads open to all org members (shared agronomy knowledge); soft-delete (0027); audited (0008).
-- Rollback: additive-only (new table + 3 RPCs; no authorize() re-emit, no existing object altered) —
-- revert = drop function fn_save/fn_signoff/fn_archive_academy_content + drop table academy_content.

-- ── 1) academy.write is ALREADY in prod's/main's authorize() union — a co-maintainer pinned it in
-- main (20260629150000: "in-flight academy.write … so a later re-emit can't drop them"; verified present
-- in the function body). So this migration deliberately does NOT re-emit authorize(): re-emitting a
-- snapshot here would risk CLOBBERING newer permissions when applied out-of-order to an already-ahead
-- prod (the apply-time re-emit footgun — local pgTAP applies in version order and can't catch it). The
-- RPCs below call authorize('academy.write', org) against the live function; there is nothing to add.

-- ── 2) the content table ────────────────────────────────────────────────────────────────────────────
create table public.academy_content (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'general'
    check (category in ('npk','irrigation','pesticide','pollination','general')),
  has_chemical boolean not null default false,        -- names a pesticide/chemical → needs registration
  -- #4 integrity: pesticide-category content is ALWAYS chemical → it can never be saved has_chemical=false
  -- and thereby slip past the registration gate in fn_signoff_academy_content.
  constraint academy_content_pesticide_chemical check (category <> 'pesticide' or has_chemical),
  -- sign-off record (#4): all NULL ⇒ advisory. The gate (lib/academy.ts) reads agronomist/signed_at/expiry.
  agronomist_name text,
  signed_at timestamptz,
  pesticide_reg_valid_until date,
  pesticide_reg_number text,        -- #4 audit trail: WHICH Egyptian registration (not just WHEN it lapses)
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived boolean not null default false
);
create index academy_content_org_idx on public.academy_content(org_id) where archived = false;

alter table public.academy_content enable row level security;
alter table public.academy_content force row level security;

-- reads: any org member (shared knowledge). writes: academy.write (defense-in-depth; app uses the RPCs).
create policy tenant_all on public.academy_content for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('academy.write', org_id)
  );

-- TABLE privileges for PostgREST (created after the 0009 blanket grant → grant explicitly; required by
-- the audit-leak invariant — academy content carries no PII, so full authenticated read is safe).
-- #4 integrity (independent review): the sign-off columns (agronomist_name, signed_at,
-- pesticide_reg_valid_until) must be RPC-ONLY. A table-wide UPDATE/INSERT grant let any academy.write
-- holder PATCH them directly via PostgREST, forging an "approved" pesticide sign-off with no valid
-- registration � bypassing every check in fn_signoff_academy_content. Scope the client grant to the
-- editable columns; the SECURITY DEFINER sign-off RPC (runs as table owner) still writes the sign-off cols.
grant select on public.academy_content to authenticated;
grant insert (org_id, title, body, category, has_chemical) on public.academy_content to authenticated;
grant update (title, body, category, has_chemical, archived) on public.academy_content to authenticated;
revoke delete on public.academy_content from authenticated, anon;

create trigger audit_academy after insert or update or delete on public.academy_content
  for each row execute function public.fn_audit('academy_content');

-- ── 3a) fn_save_academy_content — upsert. EDIT RESETS THE SIGN-OFF (#4: changed figures must be
-- re-reviewed before they can be authoritative again). ──────────────────────────────────────────────
create or replace function public.fn_save_academy_content(
  p_id uuid,
  p_org uuid,
  p_title text,
  p_body text default '',
  p_category text default 'general',
  p_has_chemical boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_has_chemical boolean;
begin
  if p_id is not null then
    select org_id into v_org from public.academy_content where id = p_id;
    if v_org is null then raise exception 'academy content % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_org is null then raise exception 'org required to create content' using errcode = '23502'; end if;
    v_org := p_org;
  end if;

  if not public.authorize('academy.write', v_org) then
    raise exception 'forbidden: academy.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org academy change' using errcode = '42501'; end if;

  if p_title is null or btrim(p_title) = '' then raise exception 'title required' using errcode = '23502'; end if;
  if coalesce(p_category, '') not in ('npk','irrigation','pesticide','pollination','general') then
    raise exception 'invalid category: %', p_category using errcode = '22023'; end if;
  -- #4 integrity: pesticide content is ALWAYS chemical → force the flag so it can never be saved false
  -- and slip past the registration gate in sign-off (mirrors the table CHECK as defense-in-depth).
  v_has_chemical := coalesce(p_has_chemical, false) or p_category = 'pesticide';

  if p_id is not null then
    -- editing the figures invalidates any prior sign-off → back to advisory until re-signed.
    update public.academy_content
       set title = btrim(p_title), body = coalesce(p_body, ''), category = p_category,
           has_chemical = v_has_chemical,
           agronomist_name = null, signed_at = null, pesticide_reg_valid_until = null, pesticide_reg_number = null,
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  else
    insert into public.academy_content(org_id, title, body, category, has_chemical, created_by)
    values (v_org, btrim(p_title), coalesce(p_body, ''), p_category, v_has_chemical, (select auth.uid()))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'authoritative', false);
end $$;

-- ── 3b) fn_signoff_academy_content — record a named agronomist's sign-off. For chemical content a
-- future-dated Egyptian pesticide registration is MANDATORY (#4). ───────────────────────────────────
create or replace function public.fn_signoff_academy_content(
  p_id uuid,
  p_agronomist_name text,
  p_signed_at timestamptz default now(),
  p_pesticide_reg_valid_until date default null,
  p_pesticide_reg_number text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_has_chemical boolean;
begin
  select org_id, has_chemical into v_org, v_has_chemical from public.academy_content where id = p_id;
  if v_org is null then raise exception 'academy content % not found', p_id using errcode = 'P0002'; end if;

  if not public.authorize('academy.write', v_org) then
    raise exception 'forbidden: academy.write is required to sign off' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org sign-off' using errcode = '42501'; end if;

  if p_agronomist_name is null or btrim(p_agronomist_name) = '' then
    raise exception 'agronomist name required for sign-off' using errcode = '23502'; end if;
  -- chemical content MUST carry a current (future-dated) Egyptian pesticide registration (#4) AND its
  -- registration REFERENCE (which registration, not just when it lapses) — the liability audit trail.
  if v_has_chemical then
    if p_pesticide_reg_valid_until is null then
      raise exception 'chemical content requires an Egyptian pesticide registration expiry' using errcode = '23502'; end if;
    if p_pesticide_reg_valid_until < current_date then
      raise exception 'pesticide registration already expired (%)', p_pesticide_reg_valid_until using errcode = '22023'; end if;
    if p_pesticide_reg_number is null or btrim(p_pesticide_reg_number) = '' then
      raise exception 'chemical content requires the Egyptian pesticide registration number' using errcode = '23502'; end if;
  end if;

  update public.academy_content
     set agronomist_name = btrim(p_agronomist_name), signed_at = coalesce(p_signed_at, now()),
         pesticide_reg_valid_until = p_pesticide_reg_valid_until,
         pesticide_reg_number = nullif(btrim(coalesce(p_pesticide_reg_number, '')), ''), updated_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'agronomist_name', btrim(p_agronomist_name));
end $$;

-- ── 3c) fn_archive_academy_content — soft delete/restore ────────────────────────────────────────────
create or replace function public.fn_archive_academy_content(
  p_id uuid,
  p_archived boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.academy_content where id = p_id;
  if v_org is null then raise exception 'academy content % not found', p_id using errcode = 'P0002'; end if;

  if not public.authorize('academy.write', v_org) then
    raise exception 'forbidden: academy.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org academy change' using errcode = '42501'; end if;

  update public.academy_content set archived = p_archived, updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'archived', p_archived);
end $$;

revoke all     on function public.fn_save_academy_content(uuid, uuid, text, text, text, boolean) from public;
revoke execute on function public.fn_save_academy_content(uuid, uuid, text, text, text, boolean) from anon;
grant  execute on function public.fn_save_academy_content(uuid, uuid, text, text, text, boolean) to authenticated;
revoke all     on function public.fn_signoff_academy_content(uuid, text, timestamptz, date, text) from public;
revoke execute on function public.fn_signoff_academy_content(uuid, text, timestamptz, date, text) from anon;
grant  execute on function public.fn_signoff_academy_content(uuid, text, timestamptz, date, text) to authenticated;
revoke all     on function public.fn_archive_academy_content(uuid, boolean) from public;
revoke execute on function public.fn_archive_academy_content(uuid, boolean) from anon;
grant  execute on function public.fn_archive_academy_content(uuid, boolean) to authenticated;
