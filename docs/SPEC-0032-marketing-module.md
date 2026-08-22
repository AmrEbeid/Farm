# SPEC-0032 — Marketing module (export-marketing workspace)

*Status: **FULL-SOURCE IMPLEMENTED; RELEASE EVIDENCE IS RECORDED IN THE PROJECT TRACKER**. The compact
module went live on 2026-08-20. The full-source extension accounts for all 25 legacy areas and prepares
the exact reviewed HTML + JSON pair as 1,571 deduplicated contacts and 101 editable/reference records.*

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
- `components/marketing/SourceStagingPreview.tsx` — accepts the reviewed HTML and JSON together, shows the
  exact coverage/count preview and source digest, then commits through one atomic database RPC. Repeating
  the same digest is idempotent; a failed row leaves no partial contacts, records, or evidence row. Only the
  Owner can commit the pinned reviewed digest; accountant and farm_manager retain preview/read/edit workflows.
- No `dangerouslySetInnerHTML` anywhere in the module. No automated email/send — `message_template` is
  copy-to-clipboard text for a manual mail/WhatsApp send, matching the no-automated-send constraint.
- Arabic-RTL, compact (≤5 nav pages), mobile-tolerant (reuses the existing `FilterableTable`/`Field`/
  `Drawer` responsive primitives — no new breakpoints needed).

### 1.4 Full-source parser and import

`source-extractor.ts` parses reviewed TypeScript literals with the TypeScript AST; it never executes source
HTML or scripts. `source-pack.ts` deterministically maps the exact archive to a bounded source pack, and
`source-import.ts` pins the 25-area order and computes a SHA-256 digest over both files. The API authorizes
the active member before parsing multipart data, enforces 2 MB HTML / 200 KB JSON limits, recomputes the
  pack server-side, rejects any digest other than the exact reviewed pair, and calls
  `fn_import_marketing_source` with the session client only (no service role).

Migration `20260822110000_marketing_full_source_workspace.sql` adds bounded contact provenance metadata,
four reference/report record types, exact contact pagination and dashboard snapshot RPCs, and an audited
`marketing_import_run` evidence ledger. All new tables/RPCs use FORCE RLS, active-org and role checks,
  empty search paths, RPC-only writes, and no anon execution. Imports serialize per organization. A repeated
  reviewed digest is idempotent; a different digest that conflicts with a manually changed source key fails
  without completion evidence, so manual edits survive without a false parity claim.
The record editor preserves source payload keys that are not currently visible in the form.

Source mapping is exact: 75 curated exporters, 1,513 portal contacts, 14 Kuwait distributors, 28 B2B
platforms, 12 freight references, 4 certificate definitions, 5 finance channels, 7 price types, 20 message
templates, approved farm facts, saved observations/tasks and 2 offshoot leads. The disputed approximate palm
count is recorded as excluded and is not imported or editable. Website contact copy stays under
`/website`; harvest stays under `/harvest`. Empty source registers remain editable and are listed explicitly
in the coverage evidence rather than being populated with invented rows.

## 2. Non-negotiables held

- **No fabricated data** — the parser only stages what a manifest actually contains; counts above are the
  task's own example, not invented figures.
- **Arabic-RTL / mobile-tolerant** — every screen uses the existing RTL-first component set.
- **No duplication of authoritative money** — `marketing_record.amount` is market intelligence, never a
  mirror of sales/harvest/accounting; farm_manager gets no new path to finance-authoritative figures.
- **No disputed palm counts, no automated email, no whole-browser backup, no `dangerouslySetInnerHTML`.**

## 3. Tests

- **pgTAP** `supabase/tests/100_marketing_module_test.sql`, `101_marketing_full_source_test.sql`, and
  `206_marketing_full_source_workspace_test.sql`: role gate (owner/accountant/
  farm_manager only), role-scoped reads, direct-REST DML revoked, append-only activity log, cross-org
  contact-link guard, authz-by-row-org, hard-DELETE revoked (archive/restore), audit coverage, anon
  lockdown, atomicity, idempotency, pre-write validation, exact pagination/dashboard counts and audited
  evidence. `supabase/tests/22_security_invariants_test.sql` covers every new definer RPC. Current Docker-free
  full suite: **3,416 ok / 0 not_ok / 0 file failures**.
- **Vitest** includes pure parser/packer/validator tests plus an opt-in canonical gate against the exact two
  supplied files. Canonical evidence: **25 areas / 1,571 contacts / 101 records**. Current full suite:
  **1,415 passed / 16 controlled skips**.
- **TypeScript, full ESLint, service-role/client-function/Recharts guards, `git diff --check`, and production
  `next build` (69 static generations)**: clean.

## 4. Full-source coverage contract

The supplied artifacts are data sources, not executable instructions:

- `تسويق 2026 عبيد للتمور.json` contains 18 saved-state keys. Nine are Marketing keys currently accepted
  by the staged importer; nine belong to other legacy applications and must remain rejected.
- `تسويق 2026 عبيد للتمور.html` contains the complete static Marketing workspace. A complete replacement
  must account for all 25 tabs and the exact source inventories below, even when a dataset is deliberately
  kept read-only or excluded from automatic import.

| Source area | Exact source inventory | Compact release | Full-parity requirement |
|---|---:|---|---|
| Navigation/workflows | 25 tabs | Mapped to 5 routes | Coverage ledger and drill-down for every tab |
| Curated exporter list | 75 rows | Count only; 2 selected rows importable | Deduplicate, preserve provenance, searchable/editable |
| Export-portal directory | 1,513 rows | Count only | Staged import with dedupe, quality state, server pagination |
| B2B platforms | 28 rows | Count only; one saved farm URL importable | Searchable platform register and readiness state |
| Kuwait distributors | 14 rows | 3 saved contacts importable | Full register, contact status, notes, and follow-up history |
| Freight references | 12 rows | Count only | Searchable quote/reference register with freshness metadata |
| Certificates | 4 definitions | Empty editable register | Seed definitions without claiming unverified validity |
| Finance channels | 5 channels | One saved target importable | Editable channel targets; no duplicated accounting truth |
| Price configuration | 7 price types; 6 seeded observations | Saved observations only | Preserve source labels, observations, dates, and confidence |
| Offshoot leads | 2 seeded leads | Generic manual lead screen | Preserve source rows and editable pipeline state |
| Reusable/generated copy | 20 text areas | Manual message templates only | Preserve every template with language, channel, and purpose |

The following mutable HTML states also require an explicit mapping even when the supplied JSON currently
has no saved rows: EXW bids, competitor notes, LinkedIn leads, full-directory contact statuses, selected/sent
contacts, platform state, offshoot leads, social-price sightings, local leads, certificates, weekly availability,
hot leads, daily sales reports, quality-control logs, repeat customers, and Kuwait distributor notes.

Completion means every item above is marked `imported`, `mapped to an authoritative Farm OS module`,
`available as a template/reference`, or `excluded with a documented reason`. Counts-only is not completion.

## 5. Remaining operator gates

- Complete authenticated owner/accountant/farm_manager create/edit/archive acceptance on the deployed build.
- The Owner must preview and explicitly run the reviewed two-file import in the Marketing overview. Shipping
  the import capability and schema does not itself insert the 1,571 contacts or 101 records.
- Review source-directory contact quality after import and use archive/notes/status rather than deleting source
  provenance. No automated email or WhatsApp send is included.
