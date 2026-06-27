-- Farm OS — STRUCT-1: editable farm structure, part 1 — soft-delete + audit.
-- See docs/RESEARCH-farm-structure-crud-2026-06-26.md (D2, D5).
--
-- The structure CRUD feature lets the tenant add/edit/REMOVE sectors, hawshat, lines and palms.
-- "Remove" must be a SOFT delete (archived=true) that CASCADES to descendants, never a hard DELETE
-- (already revoked from clients in 0027) — a hard delete would cascade-destroy palm_status_history
-- and orphan recorded farm_events. `assets` already carries `archived` (0003); this adds the same
-- flag to the parent levels so a whole sector/hawsha/line can be archived while every row + its
-- event history is preserved and restorable.
--
-- It also adds the audit triggers that were MISSING on the structure tables: farm_event/expenses/etc.
-- are audited (0008) but farms/sectors/hawshat/lines/assets were not, so structural changes left no
-- audit_log trail. fn_audit (0008) is SECURITY DEFINER and keyed on tg_argv[0] = entity_type; every
-- one of these tables has org_id + id, which is all fn_audit reads.

-- ── 1) soft-delete flag on the parent levels (assets already has `archived`) ──────────────────────
alter table public.farms    add column if not exists archived boolean not null default false;
alter table public.sectors  add column if not exists archived boolean not null default false;
alter table public.hawshat  add column if not exists archived boolean not null default false;
alter table public.lines    add column if not exists archived boolean not null default false;

-- `archived_at` stamps WHEN a row was archived. fn_archive_structure (0052) stamps now() on the node
-- and the descendants it cascades, so on RESTORE it can un-archive ONLY the rows archived by that same
-- cascade (matching timestamp) — and NOT resurrect a child that was independently removed earlier. This
-- is the documented soft-delete-cascade restore hazard (a parent restore must not bring back a child
-- that was separately deleted before the parent was). NULL ⇔ live.
alter table public.farms    add column if not exists archived_at timestamptz;
alter table public.sectors  add column if not exists archived_at timestamptz;
alter table public.hawshat  add column if not exists archived_at timestamptz;
alter table public.lines    add column if not exists archived_at timestamptz;
alter table public.assets   add column if not exists archived_at timestamptz;

-- Partial indexes: the file/grid reads filter `archived = false`, so index the live rows by parent.
create index if not exists sectors_live_farm_idx  on public.sectors(farm_id)   where archived = false;
create index if not exists hawshat_live_sector_idx on public.hawshat(sector_id) where archived = false;
create index if not exists lines_live_hawsha_idx   on public.lines(hawsha_id)   where archived = false;
create index if not exists assets_live_hawsha_idx  on public.assets(hawsha_id)  where archived = false;

-- Integrity (review L3): line_no is the human identifier for a row within a hawsha, so an ACTIVE hawsha
-- can't have two of the same. PARTIAL unique (where not archived) so a removed line's number can be
-- reused after archival. Verified no live row violates this on prod before adding.
create unique index if not exists lines_hawsha_lineno_uniq
  on public.lines(hawsha_id, line_no) where archived = false;

-- ── 2) audit triggers on the structure tables (mirrors 0008) ──────────────────────────────────────
drop trigger if exists audit_farm   on public.farms;
drop trigger if exists audit_sector on public.sectors;
drop trigger if exists audit_hawsha on public.hawshat;
drop trigger if exists audit_line   on public.lines;
drop trigger if exists audit_asset  on public.assets;

create trigger audit_farm   after insert or update or delete on public.farms
  for each row execute function public.fn_audit('farm');
create trigger audit_sector after insert or update or delete on public.sectors
  for each row execute function public.fn_audit('sector');
create trigger audit_hawsha after insert or update or delete on public.hawshat
  for each row execute function public.fn_audit('hawsha');
create trigger audit_line   after insert or update or delete on public.lines
  for each row execute function public.fn_audit('line');
create trigger audit_asset  after insert or update or delete on public.assets
  for each row execute function public.fn_audit('asset');
