# SPEC-0032 — Marketing module (export-marketing workspace)

*Status: **BUILT** (this branch, not yet reviewed/deployed). Consolidates the 25 legacy export-marketing
tracking areas (spreadsheets/Sheets: dashboard, prices, markets, CRM, campaigns, …) into one compact
Farm OS nav module for owner/accountant/farm_manager, dashboard-first, Arabic-RTL, ≤5 nav pages.*

## 0. Thesis

The legacy marketing tracker lived outside Farm OS in 25 loosely-related sheets. This spec brings it inside
the OS's existing security model (RLS + gated RPCs + audit) without inventing 16 near-identical tables for
the 16 editable record types the task lists — one polymorphic `marketing_record` (type + validated-object
payload) covers all of them, plus a `marketing_contact` master kept **deliberately separate** from the
accounting `buyers` table (no FK — marketing prospecting can never taint accounting), and an append-only
`marketing_contact_activity` log for the call/follow-up history a contact accumulates.

## 1. What shipped

### 1.1 Database — migration `20260820090000_marketing_module.sql`

- **Tables**: `marketing_contact`, `marketing_contact_activity` (append-only), `marketing_record`
  (polymorphic; `record_type` CHECK-constrained to the 16 types below; `payload` CHECK'd to a JSON object).
- **Security model** (mirrors `site_content`, 20260701420000):
  - FORCE RLS on all three tables. **No `authorize()` re-emit** — per the task instruction, the
    owner/accountant/farm_manager gate is an **explicit inline check** against `organization_member`
    (the `fn_update_org_settings` pattern), so this ships with zero risk of silently dropping an existing
    `authorize()` permission.
  - Reads are **role-scoped**, not just org-scoped: the `tenant_role_read` policy filters on
    `role in ('owner','accountant','farm_manager')`, so a supervisor/storekeeper/agri_engineer session
    reads **zero rows**, not just a hidden write button (pgTAP-pinned, test 100 §2).
  - Writes are **RPC-only**: client INSERT/UPDATE/DELETE revoked on all three tables. Hard DELETE is
    revoked forever — archive (`archived` boolean) is the only removal path.
  - `marketing_contact_activity` has **no update/delete RPC at all** — `fn_log_marketing_contact_activity`
    is the only writer, ever (append-only, mirrors `audit_log`'s immutability-by-omission).
  - Edit-in-place RPCs authorize against the **row's own org**, not the caller-supplied org (the
    `fn_save_academy_content` "authz-by-row-org" invariant) — an org-B owner cannot edit an org-A row.
  - A linked contact must be **same-org** (`23503` on cross-org link).
  - Every definer RPC also requires the target org to be the caller's active org. Imported rows persist a
    bounded `source_key` under a per-org unique index, so reruns update the same row instead of duplicating it.
    Text fields and JSON payloads are bounded in the database; the migration is transactional.
  - `marketing_record.amount` is market intelligence only (an observed price / bid / target) — **never**
    a mirror of sales/collections/harvest/scale/offshoot/accounting figures, which stay sourced from their
    own authoritative tables. This module reads none of them.
- **RPCs**: `fn_save_marketing_contact`, `fn_archive_marketing_contact`,
  `fn_log_marketing_contact_activity`, `fn_save_marketing_record`, `fn_archive_marketing_record` — all
  `SECURITY DEFINER`, `search_path = ''`, revoked from `public`/`anon`, granted to `authenticated` only.
- **Audit**: `fn_audit` triggers on all three tables (`marketing_contact`, `marketing_contact_activity`,
  `marketing_record`).
- **Indexes**: `org_id` (partial, non-archived), `org_id+category`/`org_id+record_type`, `contact_id`,
  `contact_id+occurred_at`, and a partial index on pending follow-ups.

### 1.2 The 16 editable record types → 5 nav pages

One `marketing_record.record_type` per legacy concept, grouped into the task's 5 views:

| View (nav page) | Legacy areas | record_type(s) |
|---|---|---|
| **نظرة عامة** `/marketing` | dashboard, dailyreport, reports | *(aggregation only — no dedicated table)* |
| **المنتج** `/marketing/product` | farm, offshoots, quality, materials | `quality_batch`, `weekly_availability` |
| **الأسواق** `/marketing/markets` | prices, markets, local, shipping, logistics, kuwait, china, competitors, socialprices | `price_observation`, `competitor`, `task` (Kuwait-distributor follow-up, linked to a `kuwait_distributor` contact) |
| **خط المبيعات** `/marketing/pipeline` | crm, exw, linkedin, brokers | `lead_local`, `lead_offshoot`, `lead_social`, `lead_linkedin`, `hot_lead`, `exw_bid`, `broker_state` |
| **الحملات** `/marketing/campaigns` | exportletter, gmail-drafts-only, campaign, platforms, contact | `marketing_contact` (+ activity), `task` (campaign, non-Kuwait), `platform_state`, `certificate`, `channel_target`, `message_template` |

The Markets/Campaigns `task` split (Kuwait-linked vs. not) avoids showing the same row on two pages while
still reusing one generic type instead of a one-off "kuwait_status" table.

### 1.3 UI

- `components/marketing/MarketingRecordTable.tsx` — one generic add/edit/archive/search component reused
  for all 16 record types; type-specific shape lives in `lib/marketing/fields.ts` (payload sub-fields per
  type). Writes go through `app/(app)/marketing/actions.ts` server actions → the gated RPCs (role
  re-checked in the DB; `canWrite` only hides the affordance).
- `components/marketing/MarketingContactTable.tsx` — the contact master (add/edit/archive/search) + a
  per-contact activity drawer (call/email/meeting/note/followup, with a follow-up date).
- `components/marketing/SourceStagingPreview.tsx` — accepts the original JSON file or pasted content,
  previews the accepted rows and rejected keys in the browser, then sends only the compact reviewed rows
  to the server action. The action validates again and upserts through the same gated RPCs. Partial imports
  can be rerun safely because provenance keys are persisted and unique per org.
- No `dangerouslySetInnerHTML` anywhere in the module. No automated email/send — `message_template` is
  copy-to-clipboard text for a manual mail/WhatsApp send, matching the no-automated-send constraint.
- Arabic-RTL, compact (≤5 nav pages), mobile-tolerant (reuses the existing `FilterableTable`/`Field`/
  `Drawer` responsive primitives — no new breakpoints needed).

### 1.4 Source-staging parser (`lib/marketing/source-staging.ts`)

Pure, deterministic, framework-free — no I/O, no `Date.now()`/`Math.random()`. It reads the original
string-encoded `ep_*` export directly and accepts only these nine marketing keys:

- `ep_prices`, `ep_finance`, `ep_tasks`, `ep_platform_tasks`, `ep_kuwait_dist_status`, `ep_csel`,
  `ep_owner_whatsapp`, `ep_harvest_log`, and `ep_li`.
- Static source inventory remains **counts only** (75 exporters / 1,513 contacts / 14 Kuwait distributors /
  28 platforms / 12 freight references). The raw lists are never committed or imported automatically.
- The verified saved state maps to 25 editable rows: 3 prices, 3 Kuwait contacts plus linked follow-up
  tasks, 2 selected exporters, 6 daily tasks, 6 platform-readiness tasks, channel target 0, and the farm URL.
  The owner's WhatsApp is reported in preview but deliberately not converted into a marketing contact.

The nine unrelated top-level application keys are dropped and reported. Non-empty legacy harvest is rejected
because harvest remains authoritative in Farm OS. Each accepted row carries a deterministic provenance key;
the database stores it under a unique per-org index. Same input produces the same preview and the same rows.
The two save RPCs are also registered in the canonical import framework through `marketing.ts` descriptors,
with the same three-role gate. This keeps templates, dry-run validation, prefill/re-upload, and convention tests
available without weakening the dedicated 2026-file restore path.

## 2. Non-negotiables held

- **No fabricated data** — the parser only stages what a manifest actually contains; counts above are the
  task's own example, not invented figures.
- **Arabic-RTL / mobile-tolerant** — every screen uses the existing RTL-first component set.
- **No duplication of authoritative money** — `marketing_record.amount` is market intelligence, never a
  mirror of sales/harvest/accounting; farm_manager gets no new path to finance-authoritative figures.
- **No disputed palm counts, no automated email, no whole-browser backup, no `dangerouslySetInnerHTML`.**

## 3. Tests

- **pgTAP** `supabase/tests/100_marketing_module_test.sql` (42 assertions): role gate (owner/accountant/
  farm_manager only), role-scoped reads, direct-REST DML revoked, append-only activity log, cross-org
  contact-link guard, authz-by-row-org, hard-DELETE revoked (archive/restore), audit coverage, anon
  lockdown. `supabase/tests/22_security_invariants_test.sql` (INV-2 allowlist) updated with the 5 new RPC
  names. Full local pgTAP suite: **3288 ok / 0 not_ok / 0 file_failures** (Docker-free,
  `test-shims/run-pgtap-local.sh`).
- **Vitest** `lib/marketing/source-staging.test.ts` (7 tests): the actual `ep_*` encoding, inventory counts,
  exact saved-state mapping, entity-index mapping, determinism/provenance uniqueness, malformed input,
  non-empty harvest rejection, and bounded import validation. `lib/page-help.test.ts`
  / nav completeness cover the 5 new pages (drift-guarded, so a future page addition without help fails CI).
- **tsc --noEmit**: clean. **ESLint** on every touched/new file: clean. **`next build`**: succeeds, all 5
  `/marketing*` routes registered as dynamic server routes.

## 4. Known follow-ups (not required for this compact release)

- The static source inventories remain manifest-only. Importing the full 1,513-contact archive would need a
  separate reviewed dedupe/data-quality project; this release intentionally imports only the saved shortlist.
- The Overview page's follow-up/KPI aggregation is computed in Next.js from the full row set (no dedicated
  read RPC) — fine at this data volume; a read-RPC would be the next step if the row count grows large.
