-- Farm OS — SPEC public-website: let the owner manage the enquiry inbox (mark read / archived).
--
-- Adds one owner-gated RPC to set an enquiry's status. Client UPDATE stays revoked (migration
-- 20260701430000) — this SECURITY DEFINER RPC is the only status-write path, gated by
-- authorize('site.write', org) = owner. No new permission (reuses site.write), so no authorize()
-- re-emit. tests/22 INV-2 allowlist gains the new fn.
--
-- ROLLBACK. drop function public.fn_set_enquiry_status(uuid, text).

create or replace function public.fn_set_enquiry_status(p_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  if p_status not in ('new', 'read', 'archived') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select org_id into v_org from public.site_enquiries where id = p_id;
  if v_org is null then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if not public.authorize('site.write', v_org) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.site_enquiries set status = p_status where id = p_id;
end;
$$;

revoke execute on function public.fn_set_enquiry_status(uuid, text) from public, anon;
grant execute on function public.fn_set_enquiry_status(uuid, text) to authenticated;
