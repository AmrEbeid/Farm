-- Farm OS — SPEC public-website: buyer enquiries from the public site, captured into the OS.
--
-- PROBLEM. The public export site should let importers submit an enquiry (name / company / country /
-- volume / message) that lands in the OS for the owner to action — alongside the existing WhatsApp /
-- email / phone contact actions.
--
-- SECURITY MODEL (no anon DB surface — the "anon writes nothing" invariant holds).
--  * WRITES: server-action-only. The public form posts to a server action that inserts via the
--    service-role admin client (server-side). No INSERT is granted to anon/authenticated, and there
--    is NO anon-callable RPC. Spam is handled app-side (honeypot + length caps + required fields).
--  * READS: OWNER only — reuse the existing `site.write` = owner gate (no new permission, no
--    authorize() re-emit). Buyer contact details are commercial data; field roles don't see them.
--  * No new SECURITY DEFINER function (so tests/22 INV-2 allowlist is unchanged). Status management
--    (mark read/archived) is deferred to a follow-up.
--  * NOT AUDITED (deliberate). The base read is owner-only but `audit_read` is org-scoped, so auditing
--    the buyer PII (name/company/message) would leak it to non-owner org members via audit_log — the
--    exact class tests/56 guards (same reason `people` phone/email stays unaudited). The row itself +
--    created_at is the record; there is no update/delete flow in this MVP.
--
-- ROLLBACK. drop table public.site_enquiries.

create table public.site_enquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  company text,
  country text,
  volume text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now()
);
create index site_enquiries_org_idx on public.site_enquiries(org_id, created_at desc);

alter table public.site_enquiries enable row level security;
alter table public.site_enquiries force row level security;

-- OWNER-only read (site.write = owner). Writes go through the server action + service-role client,
-- so client INSERT/UPDATE/DELETE is withheld — there is no anon or authenticated write path here.
create policy owner_read on public.site_enquiries for select to authenticated
  using (public.authorize('site.write', org_id));
grant select on public.site_enquiries to authenticated;
revoke insert, update, delete on public.site_enquiries from authenticated, anon;

-- Deliberately NOT audited (see header): owner-restricted PII + org-scoped audit_read = leak class.
