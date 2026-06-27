# SPEC-0010 — Activity / event recording (Stage 3 remainder)

*Status: **DRAFT for Owner review** — design + the build that lands with it. Stage 3's data spine was
built in MVP-0; this spec covers the **remainder**: ad-hoc recording of operations/observations against
any node, status transitions, and follow-ups. No prod apply here (Owner-gated). Companion to
[`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 3 and [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md).*

## 1. Why now
The 360 node pages (SPEC-0003) **read** each node's event timeline (`event_locations → farm_event`), but
the only way to *create* a `farm_event` today is `fn_execute_operation` — executing a **planned**
operation. A field user cannot record an inspection ("checked الخطارة — RPW trap high"), an ad-hoc
operation ("watered line 5"), or a note/observation directly against a node. Stage 3's acceptance is
exactly this. Medium risk, Owner gate only — no external blocker.

## 2. What already exists (migration 0004 / 0008 / 0025)
`farm_event` (partitioned) + `event_assets` + `event_locations` + `quantities` + `event_status_history` +
`event_followups` + `event_attachments`, all RLS deny-by-default; `farm_event` audited (0008); the
operation tables gated to `op.execute` in RLS (0025). So Stage 3 is a **write-path + UI** stage, not a
schema stage.

## 3. Scope (allowed)
1. **`fn_record_event`** — a SECURITY DEFINER, `op.execute`-gated, ATOMIC RPC that inserts a `farm_event`
   (type ∈ operation/inspection/issue/note; free subtype), its `event_locations` row (farm/sector/hawsha/
   line/palm), the opening `event_status_history` row, and — optionally — one `quantities` row. Resolves
   the org from the target node (not trusted from the client). Status ∈ planned/in_progress/done/…
2. **`fn_set_event_status`** — `op.execute`-gated, appends `event_status_history` and flips
   `farm_event.status` in one transaction (pending → done, etc.). Never a silent flip without history.
3. **`fn_add_event_followup`** — `op.execute`-gated, records an `event_followups` row (due date + note +
   optional assignee). Closing a follow-up reuses `fn_set_event_status`'s pattern.
4. **UI** — a **RecordEventForm** on every node 360 page (sector/hawsha/line/palm) + an event timeline that
   shows status and offers "mark done" + add-follow-up to `op.execute` roles. Arabic-RTL, mobile.

## 4. Forbidden / deferred
- No stock movement from ad-hoc events (that stays the planned-execution path `fn_execute_operation`, which
  already handles inventory atomically). `fn_record_event`'s optional quantity is **descriptive** (a count/
  weight observation), `inventory_adjustment = 0`.
- PostGIS geometry, photo capture on events beyond the existing `attachments` table, bulk import — deferred.
- No real-data import (Owner / Stage M).

## 5. Acceptance (the oracle)
- **Record → roll-up:** `fn_record_event` against a hawsha → the event appears in that hawsha's file AND
  rolls up to its sector and the farm (the `event_locations` spine). pgTAP asserts the event + its location
  + its status-history row all exist in one transaction.
- **Role gate:** a non-`op.execute` member (accountant/storekeeper) calling any of the three RPCs → `42501`.
- **Status:** `fn_set_event_status` flips status AND appends history atomically; a bad status → `22023`.
- **Cross-org:** recording against another org's node → `42501` (org resolved from the node).

## 6. Slices
1. `fn_record_event` + `fn_set_event_status` + `fn_add_event_followup` (migration) + pgTAP. *(Medium.)*
2. RecordEventForm + actions + wiring on the 4 node pages; mark-done + follow-up surfaces. *(Low/Med — UI.)*
3. *(Deferred)* event photo attachments via the `attachments` table on events; bulk timeline filters.

## 7. Enforcement
Each RPC: pinned `search_path`, schema-qualified, `authorize('op.execute', v_org)` IN the DB, cross-org
guard, revoked from public+anon, granted to authenticated. The local pgTAP harness must stay green.
Applying to prod is the Owner-gated apply layer. **Gate: Owner** (independent review not required — no
money/PII; the event spine is structural).
