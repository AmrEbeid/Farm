-- Farm OS — bulk-import idempotency backstop (#512-adjacent import audit, Finding 1).
--
-- The sectors/hawshat import descriptors hardcode p_id = null, so fn_save_sector / fn_save_hawsha always
-- INSERT, and there was NO unique constraint on sectors.code / hawshat.code. A client-side timeout on a
-- commit (the server may already have written rows) followed by a retry — or simply re-uploading the
-- corrected file — silently DOUBLE-imports every sector/hawsha. The commit-plan dedupe only covers one
-- file, not across requests.
--
-- FIX: a partial unique index on (org_id, code) for ACTIVE (non-archived) rows. A duplicate active code now
-- fails with 23505, which the import route already reports per-row (turning silent duplication into a clean
-- "already exists" row error). Archived rows are excluded so a code can be reused after archiving. Prod was
-- verified to have no existing duplicate active (org_id, code) before adding. Additive/idempotent; NULL
-- codes stay distinct (unaffected). Rollback: drop the two indexes.
-- Validation: pgTAP 106 (both indexes present, unique + partial); authoritative check is prod apply.

create unique index if not exists sectors_org_code_active_uniq
  on public.sectors (org_id, code) where archived is not true;

create unique index if not exists hawshat_org_code_active_uniq
  on public.hawshat (org_id, code) where archived is not true;
