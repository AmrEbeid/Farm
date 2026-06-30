-- Farm OS — audit the event-detail child tables (#494 remainder; completes the audit-coverage workstream).
--
-- The parent `farm_event` is audited (0008), but its detail children are independently member-writable
-- (INSERT/UPDATE under org-scoped policies; DELETE revoked, 0027) and carried no fn_audit trigger, so an
-- edit to a recorded event's asset/location/follow-up/attachment left no trail. All four have a NOT NULL
-- org_id, so the generic fn_audit trigger attaches cleanly.
--
-- Scope: event_locations, event_followups, event_attachments.
--   EXCLUDED:
--     * event_status_history — an append-only status-transition log written only by fn_record_event /
--       fn_set_event_status (0083) with changed_by, i.e. it IS already an audit trail; redundant to audit.
--     * event_assets — a junction table (event_id + asset_id, NO `id` column). fn_audit logs
--       coalesce(new.id, old.id), so a trigger on it raises "record new has no field id" and would break
--       every event_assets write (caught by pgTAP 83/24/75). It is a low-value link table; skip it.
--     (quantities, the load-bearing event child, was audited in 0701100000.)
--   Verified no mass delete+reinsert churn on these tables.
--
-- Security: additive only (append-only audit_log via SECURITY DEFINER fn_audit). Idempotent. Rollback:
-- drop the three triggers. Validation: pgTAP 100_audit_event_children_test.sql; prod re-probe.

drop trigger if exists audit_event_location on public.event_locations;
create trigger audit_event_location
  after insert or update or delete on public.event_locations
  for each row execute function public.fn_audit('event_location');

drop trigger if exists audit_event_followup on public.event_followups;
create trigger audit_event_followup
  after insert or update or delete on public.event_followups
  for each row execute function public.fn_audit('event_followup');

drop trigger if exists audit_event_attachment on public.event_attachments;
create trigger audit_event_attachment
  after insert or update or delete on public.event_attachments
  for each row execute function public.fn_audit('event_attachment');
