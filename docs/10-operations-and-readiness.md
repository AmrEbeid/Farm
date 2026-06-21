# 10 — Operations & Commercial Readiness
*The implementation/operational/commercial layer the master plan was missing. Each section maps to a numbered gap from the review. `[I]` = recommended.*

---

## 1. Data Import / Onboarding system (gap #5)
Real farms arrive with messy Excel, paper, and WhatsApp. Import is part of the **paid onboarding package**, not an afterthought.

**Pipeline (staging → validate → approve → commit → rollback):**
```
raw_import_files   (uploaded original, checksum, uploaded_by)
import_batches     (type, status: uploaded→mapped→validated→approved→committed/rolled_back, org_id)
import_staging_*   (typed staging rows per import type, with row_status + error[])
import_mappings    (source column → target field; reusable per customer)
import_errors      (batch_id, row, field, rule, message)
import_dedup       (matched existing entity, action: merge/skip/replace)
```
**Flow:** upload → auto-map (saved mapping) → **validate** (required fields, types, FK existence, ranges) → **dedupe** → list errors → importer resolves/skips → **Owner/admin approves the batch** → commit to live tables → **reconciliation report** → batch is **rollback-able as a unit**. Nothing reaches live tables before approval (tests IM-1…IM-4 in [09](09-acceptance-tests.md)).

**Import types:** farm-hierarchy · palm-registry · opening-stock · people · expense-history · sales-history · supplier/buyer · operation-history. **Ebeid first import:** the Nov-2025 palm registry (reconcile to 4,380/299), opening stock, the 7-year accounting (with مسحوبات split + typo cleanup), offshoot jard.

---

## 2. Offline / weak-internet policy (gap #6)
No full offline sync in MVP — **drafts + sync**, with a hard rule on what must be online.
```
Offline DRAFT support:   operation reports · issue/notes · photos · stock requests · palm inspections
Online REQUIRED:         approvals · final stock posting · financial posting · permission changes · AI assistant
```
Mobile saves drafts locally (IndexedDB) with a visible "pending sync" badge; syncs when connectivity returns; conflicts resolved last-write-with-review. Online-only actions are clearly disabled offline (tests OF-1, OF-2).

---

## 3. Photo & attachment policy (gap #7)
**Storage design (Supabase Storage):**
```
buckets:        farm-media (private), receipts (private), reports (private)
path:           {org_id}/{entity_type}/{entity_id}/{uuid}.{ext}
access:         RLS on storage.objects — first path segment must be in auth.user_org_ids(); signed URLs only (TTL ~15 min)
image rules:    compress on upload; max 10 MB; allowed jpg/png/webp/pdf; strip EXIF GPS unless op needs it
metadata:       attachment table (org_id, entity, path, kind, checksum, uploaded_by, created_at)
delete:         soft-delete; only owner/admin (or uploader within 24h) can delete; deletions audited
sensitive:      receipts/invoices/vouchers visible to A/O only
backup:         storage included in nightly backup; 30-day version retention
```
**Attachment types:** operation photo · issue photo · receipt · invoice · voucher · inspection photo · palm photo · harvest photo · stock-delivery photo.

---

## 4. Financial correction rules (gap #8)
Trust depends on immutability of approved records.
```
Draft records      → freely editable.
Approved records   → never silently edited.
Corrections        → a reversing/correction entry, original retained.
Deletions          → soft-delete or reverse, NEVER hard-delete financial data.
Every approve / reject / edit / correction → an immutable audit_log event (actor, before, after, time).
```
(Tests FC-1, FC-2.) Applies to expenses, sales, vouchers, ledger entries, budgets.

---

## 5. Tenant data export & deletion / ownership (gap #9)
SaaS customers will ask "can I export, can I leave, who owns the data?" — answer up front.
```
Export:        full-tenant export (JSON/CSV bundle) · Excel export per module · PDF reports · media export (zip of storage)
Self-service:  export available to Owner at any time
Deletion:      data-deletion request honored within [30] days; soft-delete then purge after retention
Retention:     active data retained while subscribed; [90]-day grace after cancellation, then export-or-purge
Backups:       backup retention [35] days (rolling); deletion requests also purge from backups after the cycle
Ownership:     "the customer owns their data" stated in the DPA/ToS; we are processor, not owner
```

---

## 6. Backup & disaster recovery (gap #10)
```
Database:      daily automated backup; point-in-time recovery (Supabase paid tier) where available
Storage:       nightly file-storage backup, offsite copy
Restore test:  monthly restore drill to a scratch project; record RTO/RPO
Pre-change:    a fresh backup BEFORE every production deploy and before real-data migration (Stage M, Stage P)
Rollback:      every High/Critical stage documents its rollback path before apply
Incident:      written incident-response runbook (detect → contain → communicate → recover → post-mortem); a kill-switch threshold for the AI route and external sends
```
Targets `[I]`: **RPO ≤ 24h** (≤ minutes with PITR), **RTO ≤ 4h** for the pilot; tighten for production.

---

## 7. Weather provider strategy (gap #11)
```
Providers (evaluate): Open-Meteo (free, no key, good MENA coverage) → primary candidate;
                      OpenWeather / Tomorrow.io / WeatherAPI as paid fallbacks
Selection axes:       cost · forecast horizon · location accuracy · Arabic display · rate limits · historical data
Fallback:             if primary fails or rate-limits → secondary; if both fail → last-cached + "stale" label
Arabic:               translate condition strings; RTL display
Confidence labeling:  1–7 days = operational (gate operations)
                      8–14 days = medium confidence (warn only)
                      monthly/quarterly = planning estimate only (never blocks an operation)
                      annual = historical assumption
Treat provider responses as untrusted input (injection surface); key server-side only; ingest agent has no outbound send.
```
*(Post-MVP-0; in MVP-0 the weather check always passes.)*

---

## 8. Agronomy content ownership (gap #12)
Prevents the Academy from becoming risky/outdated.
```
Author:            a named agronomist (contracted) writes/curates care content
Approver:          a qualified reviewer signs off; numbers never ship unsigned
Per recommendation: version number · last-reviewed date · applicable region · author · approver
Update cadence:    review at least [annually] and on any pesticide-registration change
Disclaimer:        "editable template, not a prescription; confirm with a local agronomist"
Pesticide check:   doses only from currently-registered Egyptian products (Agricultural Pesticide Committee); re-checked each review
```
Maps to Stage 10 in the [MASTER-PLAN](MASTER-PLAN.md).

---

## 9. Template system (gap #13)
Farms differ — templates make the system flexible without code changes.
```
Template types: operation · annual palm-care-plan · young-palm · mature-palm · spray · fertilization ·
                approval-workflow · budget · stock-rule · responsibility · report
Each template:  default values · editable fields · customer-specific overrides · version · created_by · approved_by · status
Scope:          global seed templates (org_id NULL) that orgs clone and override
```
Stored as `templates(id, org_id|null, type, name, body jsonb, version, created_by, approved_by, status)`.

---

## 10. Commercial pilot gates (gap #14)
Defined in [06-MVP-0-BUILD-SPEC §10](06-MVP-0-BUILD-SPEC.md): 5 farms interviewed · 2 share data · 1 builds a plan · 1 validates stock coverage · 1 owner confirms WTP · 1 accountant confirms reports · 1 supervisor confirms mobile. **<5/7 → pause, don't build full MVP.**

---

## 11. Pricing validation (gap #15)
**Interview questions:** Would you pay a setup fee? Would you pay monthly? Which module is worth paying for first? Per farm / per feddan / per user / per package? Would you pay more for onboarding? Would you pay for private deployment?
**Metrics to test:** per-farm · per-feddan band · per-user · per-module · setup + subscription · enterprise private deployment.
**Default hypothesis** (from [05-GTM](05-gtm-pricing.md)): **per-farm in EGP** (not per-seat) + free entry tier + paid onboarding ≤15% of year-one value — *but treat as a hypothesis to confirm in the pilot interviews, not a decision.*

---

## 12. Support & onboarding operations (gap #16)
This won't sell as pure self-service — support is part of the business model.
```
Onboarding checklist · Arabic training sessions (1–2) · WhatsApp support channel · data-migration service ·
monthly review meeting · customer-success dashboard (activation, core-loop usage, last login) ·
support SLA (e.g. P1 4h / P2 1 business day) · bug-reporting flow · feature-request flow
```

---

## 13. Integration roadmap (gap #17)
```
MVP-0 / MVP:   Excel import-export · QR-code printing · WhatsApp approval link (stub→real)
Phase 2:       WhatsApp Business notifications · weather API · Google Maps/GPS · email reports
Phase 3:       accounting-system export · IoT/weather stations (Phytech) · RPW acoustic (Palmear) · SMS · payment systems
Rejected (now): full IoT platform · drone/satellite analytics in-house (integrate Zr3i/Farmonaut instead) · marketplace
```
Each integration is sandboxed, fails safe, and treats external content as untrusted (lethal-trifecta rule).

---

## 14. Legal / privacy (gap #18)
For SaaS holding financial + employee data:
```
Privacy policy · Terms of Service · Data Processing Agreement (DPA) · customer-data-ownership statement ·
employee-data handling (PII minimization, access-scoped) · financial-data handling ·
AI data-usage policy + explicit "no training on customer data" commitment ·
PII never sent to a third-party model without a privacy review (already a CLAUDE.md hard stop)
```
Anchor to NIST AI RMF + OWASP (already in the [MASTER-PLAN §9](MASTER-PLAN.md)). Egypt: align with the Personal Data Protection Law (Law 151/2020) `[I]`.

---

## 15. Performance & scale assumptions (gap #19)
Design targets (drive DB/index/partition decisions in [03 §6](03-architecture-and-data-model.md)):
```
palms per organization:        up to 50,000
farms per organization:        up to 20
users per organization:        up to 100
farm events per year:          up to 500,000 (event table partitioned by month + BRIN on time)
photos per month:              thousands (storage, signed URLs)
inventory items:               up to ~2,000
financial transactions/year:   up to ~100,000
report generation:             owner monthly report < 5s; dashboards < 2s; coverage fn < 300ms
```
Keep `inventory_bin` materialized so stock reads never re-sum the ledger; paginate all file timelines.

---

## 16. Definition of Done (per stage) (gap #20)
A stage is **Done** only when **all** are true:
```
☐ Code complete (the approved slice, nothing extra)
☐ Acceptance tests written-first and passing (evidence attached)
☐ RLS verified (cross-tenant test returns zero rows)
☐ Arabic-RTL UI checked
☐ Mobile behavior checked (where the screen is field-facing)
☐ Audit events written for every state change
☐ No secrets committed (secret-scan passed)
☐ Owner reviewed and gated
☐ Independent reviewer approved (if High/Critical)
☐ Tracker + spec + session brief updated
☐ Rollback path documented (High/Critical)
```
This is the gate checklist; paste it into the [PROJECT-TRACKER](PROJECT-TRACKER.md) per stage.

---
*All of the above is planning/documentation (Low risk). None of it authorizes a build — each stage is started only with an Owner-approved execution prompt and its own gate, per the OS.*
