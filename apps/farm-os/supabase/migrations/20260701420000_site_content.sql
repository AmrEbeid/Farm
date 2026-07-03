-- Farm OS — SPEC public-website: OS-editable content for the marketing site at `/`.
--
-- PROBLEM. The public website (Phase 1) renders from a typed TS default (SITE_CONTENT_DEFAULTS).
-- The Owner wants to edit that content from inside the OS without a code deploy. This adds a
-- small org-scoped content table + a gated write RPC, so an owner-only editor can persist changes.
--
-- SECURITY MODEL (deliberate, reviewed).
--  * NO anon surface. The codebase invariant is "anon reads nothing" (20260622000010). The public
--    page does NOT read this table as anon — the Next.js server reads it via the service-role
--    admin client (server-only) and bakes it into static/ISR HTML. So nothing here is granted to
--    anon; the wall stays intact.
--  * Reads: authenticated org members may SELECT (RLS-scoped) — the editor loads current content.
--  * Writes: RPC-ONLY. fn_save_site_content is SECURITY DEFINER, gated by authorize('site.write').
--    Direct client INSERT/UPDATE/DELETE is REVOKED so a stray PostgREST call can't bypass the gate.
--  * Content is public marketing data only (no PII, no financial figures) — no sensitive leak path.
--
-- authorize() RE-EMIT (the #1 footgun — handled per the playbook). This adds a new permission
-- `site.write` (owner only). authorize() is re-emitted from the CURRENT full definition
-- (20260701300000, 18 perms — the latest full re-emit; 20260701400000/academy did NOT re-emit) with
-- `site.write` appended, so NO existing permission is dropped. tests/22 (INV-2 allowlist) and
-- tests/97 (permission-completeness) are updated in the same change; run the full pgTAP harness.
--   APPLY-ORDER NOTE: this re-emits the union as of 20260701300000 + site.write. It must be applied
--   to a prod whose authorize() has not gained perms beyond that set (true as of ledger head
--   20260701400000). If prod's authorize() is ahead, reconcile the union before applying.
--
-- ROLLBACK. drop function fn_save_site_content; drop table site_content; and re-emit authorize()
-- without the `site.write` line (revert tests/22 + tests/97).

-- ── 1) authorize() re-emit: current union + site.write (owner only) ──────────────────────────────
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
      and ( (perm = 'pr.approve'             and m.role = 'owner')
         or (perm = 'plan.write'             and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'             and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write'        and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'           and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'           and m.role in ('owner','accountant'))
         or (perm = 'structure.write'        and m.role in ('owner','farm_manager'))
         or (perm = 'academy.write'          and m.role in ('owner','agri_engineer'))   -- in-flight #366 (forward-compat)
         or (perm = 'export.write'           and m.role in ('owner','farm_manager'))     -- in-flight #400 (forward-compat)
         or (perm = 'responsibility.write'   and m.role in ('owner','farm_manager'))     -- in-flight #444 (forward-compat)
         or (perm = 'finance.read'           and m.role in ('owner','accountant'))        -- SPEC-0018 confidential finance reads
         or (perm = 'custody.write'          and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only custody writes
         or (perm = 'request.prepare'        and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only payment prep
         or (perm = 'request.approve.op'     and m.role in ('owner','accountant'))        -- SPEC-0018 finance approval
         or (perm = 'request.approve.final'  and m.role = 'owner')                       -- SPEC-0018 owner final approval
         or (perm = 'agronomy.signoff'       and m.role in ('owner','agri_engineer'))    -- PR #557: non-negotiable #4 sign-off gate (REASONABLE DEFAULT, not Owner's final word)
         or (perm = 'people.write'           and m.role in ('owner','farm_manager'))                 -- SPEC-0006: onboarding
         or (perm = 'labor.write'            and m.role in ('owner','farm_manager','supervisor'))    -- SPEC-0006: attendance
         or (perm = 'site.write'             and m.role = 'owner') )                      -- public marketing site content (owner-only)
  )
$$;

-- ── 2) the content table (one row per org; content is the SiteContent JSON) ───────────────────────
create table public.site_content (
  -- surface `id` PK so the generic fn_audit trigger (audits new.id) works; one row per org via
  -- the unique(org_id) constraint (which also backs the fn_save upsert's ON CONFLICT).
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organization(id) on delete cascade,
  content jsonb not null,
  -- guard: must be a JSON object (the SiteContent shape); app-layer editor enforces full shape.
  constraint site_content_is_object check (jsonb_typeof(content) = 'object'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;
alter table public.site_content force row level security;

-- reads: any authenticated org member (the editor loads current content). The PUBLIC page does not
-- read here as anon — it reads server-side via the service-role admin client.
create policy tenant_read on public.site_content for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- TABLE privileges for PostgREST: read only. All writes go through the SECURITY DEFINER RPC below,
-- so client INSERT/UPDATE/DELETE is withheld (a stray PATCH must not bypass authorize('site.write')).
grant select on public.site_content to authenticated;
revoke insert, update, delete on public.site_content from authenticated, anon;

create trigger audit_site_content after insert or update or delete on public.site_content
  for each row execute function public.fn_audit('site_content');

-- ── 3) fn_save_site_content — upsert the org's marketing content (owner-gated) ────────────────────
create or replace function public.fn_save_site_content(p_org uuid, p_content jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'site content must be a JSON object' using errcode = '22023';
  end if;
  if not public.authorize('site.write', p_org) then
    raise exception 'not authorized to edit site content' using errcode = '42501';
  end if;

  insert into public.site_content (org_id, content, updated_by, updated_at)
  values (p_org, p_content, v_uid, now())
  on conflict (org_id) do update
    set content = excluded.content,
        updated_by = excluded.updated_by,
        updated_at = now();

  return p_content;
end;
$$;

-- EXECUTE lock-down: RPC is authenticated-only; never anon/public.
revoke execute on function public.fn_save_site_content(uuid, jsonb) from public, anon;
grant execute on function public.fn_save_site_content(uuid, jsonb) to authenticated;
