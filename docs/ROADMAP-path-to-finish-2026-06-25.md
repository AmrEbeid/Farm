# Farm OS — Path to Finish (2026-06-25)

*A single, dependency-ordered plan tying the open SPECs, remaining stages, the pending prod push, and
the external sign-offs into one actionable sequence. Decision-support for the Owner — nothing here is
built or applied by this doc. Reconciles [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 to today's state.*

## Where we are (reconciled to `main`)

- **MVP-0 wedge: DONE + LIVE + re-audited.** Prod at migration `0047`, **in sync with `main`**
  (`0032`–`0047` pushed via the Supabase MCP and verified live; incl. the ENGINE-STALE-1
  fix #197 + AUTHZ-2/3 + atomic plan-op #196 + palm-status RPC #238 + ENGINE-REC1 #184 + inventory unit_cost #89-B
  + the Owner RLS role-gate trio `0042`–`0044` (plan-req/budget/expenses) + partial receipts `0045` (#155)
  + wage-confidentiality `0046` (PII-1 #173, `payroll.read` + `people_compensation`, `people.rate` dropped)
  + engine null-date guard `0047` (#198 — `fn_stock_coverage` coalesces a NULL `planned_at` to period 1, DONE; no-op for dated ops, potassium rec unchanged at 600)).
  pgTAP 415/415 (Docker-free harness). 8-agent re-audit complete.
- **Foundation/security hardened:** AUTHZ-1 RLS (`0025`), delete-posture (`0027`), FORCE RLS (`0028`),
  ledger INSERT-locked (`0030`), stock floor + **CONC-1** concurrency fix (`0031`/`0033`), PR-line
  freeze + AP-3 (`0032`), org-member audit (`0019`). `@amrebeid/ui` 1.2.0.
- **Completion:** MVP-0 ≈ **98%**; full product ≈ **~45%** (back-half pillars are the bulk).

## The critical path is NOT the build — it's 3 decisions + 3 external sign-offs

The autonomous pipeline builds fast; what gates the finish:

| Gate | Type | Blocks |
|---|---|---|
| ~~Prod push `0032`/`0033`/`0034`~~ ✅ DONE 2026-06-26 (incl. CONC-1 + ENGINE-STALE-1) | Owner apply | ~~live hardening~~ live |
| **Ratify SPEC-0002** (authz enforcement) | Owner decision | closing AUTHZ-1 fully |
| **HIGH product forks** ~~#155 partial-receipts~~ ✅ DONE (`0045`) · #157 budget-as-hard-cap · #89 pricing · #181 AUTHZ-2 org-scoping | Owner decision | engine/budget correctness + GTM (#156 guard-scope now CLOSED; #155 partial-receipts CLOSED) |
| **Agronomist sign-off** (Stage 10) | External | Care Academy content |
| **Accounting reconciliation vs the 7-yr Excel** (Stage 7) | External + privacy | the P&L |
| **Real-data privacy review** (Stage M) | External | real reference tenant |

## Recommended sequence (each stage: ratify SPEC → build in slices → Owner gate; never auto-advance)

1. ~~**Apply the pending hardening to prod** (`0032`/`0033`/`0034`)~~ ✅ **DONE 2026-06-26** — applied via the Supabase MCP + verified live (`list_migrations` → `0038`; engine guard live). Ratify
   the core-engine `0018`/CONC-1 `0033` specifically. *(Owner apply — small, high-value.)*
2. **Close AUTHZ-1** — ratify [`SPEC-0002`](SPEC-0002-authorization-enforcement.md) (the role model
   already exists; it's a coverage gap), then the enforcement migration. *(Low/Med.)*
3. **Make the tenant real** — ratify [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md)
   (Stage 2): reconciliation oracle → import the Nov-2025 registry (4,380/299/28) → file/grid views.
   *(Med; structural data, no money/PII — the lowest-risk high-leverage step. Decide 4-vs-5 sectors.)*
4. **Finish the operational pillars** (Stages 3/4 remainders: full event timeline + planning builder).
   *(Med.)*
5. **Accounting + P&L** — ratify [`SPEC-0004`](SPEC-0004-accounting-and-pnl.md) (Stage 7). Resolves
   #157. Gated on the Excel reconciliation + (for real figures) the Stage M privacy review. *(High —
   independent review per slice.)*
6. **People & payroll** — ratify [`SPEC-0006`](SPEC-0006-people-labor-payroll.md) (Stage 8); its first
   slice — the **PII-1 (#173) wage slice — is DONE** (`0046`: `payroll.read` perm + role-gated
   `people_compensation`, `people.rate` dropped). **Still open: the phone/email half of #173** (Owner PII-access
   decision). **Weather** — ratify
   [`SPEC-0007`](SPEC-0007-weather-integration.md) (Stage 9). *(High / Med.)*
7. **Care Academy** — ratify [`SPEC-0008`](SPEC-0008-care-academy.md) (Stage 10); content as editable
   templates, **gated on the agronomist + Egyptian pesticide-registration sign-off**. *(Med/High.)*
8. **عبدالجليل AI** — ratify [`SPEC-0005`](SPEC-0005-ai-assistant-abduljalil.md) (Stage 11). Build
   last; highest-risk; security review each slice; recommend the no-ingest version first. *(High.)*
9. **Stage M real-data migration** + **Stage 0** legacy remediation + **key rotation** — the
   project-end apply-layer items (privacy review first). *(High/Critical.)*

## Specs status

| Spec | Stage | Status |
|---|---|---|
| SPEC-0001 stock-coverage engine | 5 | Built + hardened ✅ |
| SPEC-0002 authorization enforcement | 1 (AUTHZ-1) | DRAFT — awaiting ratification |
| SPEC-0003 farm structure + palm import | 2 | DRAFT — awaiting ratification |
| SPEC-0004 accounting + P&L | 7 | DRAFT — awaiting ratification |
| SPEC-0005 AI assistant عبدالجليل | 11 | DRAFT — awaiting ratification |
| SPEC-0006 people, labor & payroll | 8 | DRAFT — awaiting ratification (PII-1 #173 wage slice DONE `0046`; phone/email half still open) |
| SPEC-0007 weather integration | 9 | DRAFT — awaiting ratification |
| SPEC-0008 Care Academy | 10 | DRAFT — awaiting ratification |

**Every stage is now specced (SPEC-0001..0008 + the Stage-0 runbook).** The planning corpus is
complete; the project is decision-bound, not design-bound — see the gates above.

## Immediate next actions (Owner)

1. ~~Push `0032`/`0033`/`0034` to prod~~ ✅ DONE 2026-06-26 (prod now `0038`, in sync with `main`).
2. Ratify SPEC-0002 → build. 3. Decide the HIGH forks (#155/#157, #89; #156 closed). 4. Confirm 4-vs-5 sectors
(Stage 2 #186 merged with **5** — confirm intended). 5. 🔴 rotate the service-role key + DB password.
Everything else sequences behind these + the external sign-offs.
