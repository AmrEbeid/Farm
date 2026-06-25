# Farm OS — Path to Finish (2026-06-25)

*A single, dependency-ordered plan tying the open SPECs, remaining stages, the pending prod push, and
the external sign-offs into one actionable sequence. Decision-support for the Owner — nothing here is
built or applied by this doc. Reconciles [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 to today's state.*

## Where we are (reconciled to `main`)

- **MVP-0 wedge: DONE + LIVE + re-audited.** Prod at migration `0031` (live-verified 2026-06-26 via
  `list_migrations`); repo `main` at `0033` — `0032`/`0033` verified on `main`, pending the Owner prod
  push. pgTAP 287/287 (Docker-free harness). 8-agent re-audit complete.
- **Foundation/security hardened:** AUTHZ-1 RLS (`0025`), delete-posture (`0027`), FORCE RLS (`0028`),
  ledger INSERT-locked (`0030`), stock floor + **CONC-1** concurrency fix (`0031`/`0033`), PR-line
  freeze + AP-3 (`0032`), org-member audit (`0019`). `@amrebeid/ui` 1.2.0.
- **Completion:** MVP-0 ≈ **98%**; full product ≈ **~45%** (back-half pillars are the bulk).

## The critical path is NOT the build — it's 3 decisions + 3 external sign-offs

The autonomous pipeline builds fast; what gates the finish:

| Gate | Type | Blocks |
|---|---|---|
| **Prod push `0032`/`0033`** (incl. CONC-1; `0030`/`0031` already live) | Owner apply | live hardening |
| **Ratify SPEC-0002** (authz enforcement) | Owner decision | closing AUTHZ-1 fully |
| **HIGH product forks** #155 partial-receipts · #157 budget-as-hard-cap · #89 pricing · #181 AUTHZ-2 org-scoping | Owner decision | engine/budget correctness + GTM (#156 guard-scope now CLOSED) |
| **Agronomist sign-off** (Stage 10) | External | Care Academy content |
| **Accounting reconciliation vs the 7-yr Excel** (Stage 7) | External + privacy | the P&L |
| **Real-data privacy review** (Stage M) | External | real reference tenant |

## Recommended sequence (each stage: ratify SPEC → build in slices → Owner gate; never auto-advance)

1. **Apply the pending hardening to prod** (`0032`/`0033`; `0030`/`0031` already live) once ratified — `DEPLOY-RUNBOOK §1a`. Ratify
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
   slice closes **PII-1 (#173)** — wages/PII org-readable today. **Weather** — ratify
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
| SPEC-0006 people, labor & payroll | 8 | DRAFT — awaiting ratification (filed PII-1 #173) |
| SPEC-0007 weather integration | 9 | DRAFT — awaiting ratification |
| SPEC-0008 Care Academy | 10 | DRAFT — awaiting ratification |

**Every stage is now specced (SPEC-0001..0008 + the Stage-0 runbook).** The planning corpus is
complete; the project is decision-bound, not design-bound — see the gates above.

## Immediate next actions (Owner)

1. Push `0032`/`0033` to prod (`0030`/`0031` already live; ratify CONC-1 `0033` engine change). 2. Ratify SPEC-0002 → build.
3. Decide the HIGH forks (#155/#156/#157, #89). 4. Confirm 4-vs-5 sectors to unblock SPEC-0003.
Everything else sequences behind these + the external sign-offs.
