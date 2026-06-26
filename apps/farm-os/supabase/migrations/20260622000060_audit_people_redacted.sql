-- Farm OS MVP-0 — #235: audit the people registry WITH PII redaction.
--
-- THE GAP. people was the one #235 audit-coverage table left UNAUDITED (deliberately, in 0059) because
-- the generic fn_audit logs to_jsonb(NEW) — the full row — and people.phone/email are CONFIDENTIAL
-- (0048 column-grant lockdown: authenticated cannot SELECT them). Auditing people via fn_audit would
-- leak phone/email to any org member through the org-scoped audit_read — the exact H2/PII class. So
-- registry changes (a staff member added/removed, a user_id relinked, active toggled — all integrity-
-- relevant under non-negotiable #5) currently leave NO trail.
--
-- THE FIX. A dedicated SECURITY DEFINER trigger fn, fn_audit_people, identical to fn_audit EXCEPT it
-- strips the confidential keys from the logged jsonb (`- 'phone' - 'email'`). So people changes are
-- audited (who/when/what non-PII field) without ever writing phone/email into audit_log.
--
-- INVARIANT INTERACTION. tests/56's column arm scans tables audited via the GENERIC `fn_audit('<type>')`
-- trigger (regex-matched) and forbids any with a column authenticated cannot read. fn_audit_people is a
-- DISTINCT function (no quoted entity_type arg), so people is intentionally NOT in that set — the generic
-- invariant cannot vouch for a redacting fn, so the dedicated fn carries its OWN guarantee, pinned by
-- tests/61: it asserts that EVERY column authenticated cannot SELECT is absent from the people audit row
-- (so if a future migration restricts another people column, tests/61 fails until fn_audit_people is
-- updated to redact it). EXECUTE is revoked (forging audit rows via a direct call is the threat; the
-- trigger fires in the table-owner context regardless).

create or replace function public.fn_audit_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.audit_log(org_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (
    coalesce(new.org_id, old.org_id),
    (select auth.uid()),
    tg_op,
    'people',
    coalesce(new.id::text, old.id::text),
    -- redact the 0048-confidential contact columns from the audit mirror
    case when tg_op <> 'INSERT' then (to_jsonb(old) - 'phone' - 'email') end,
    case when tg_op <> 'DELETE' then (to_jsonb(new) - 'phone' - 'email') end
  );
  return coalesce(new, old);
end
$fn$;

revoke execute on function public.fn_audit_people() from public, anon, authenticated;

create trigger audit_people
  after insert or update or delete on public.people
  for each row execute function public.fn_audit_people();
