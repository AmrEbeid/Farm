# SPEC-0016 — Export compliance & certification (GACC / CAPQ / residue) [commercial hook]

*Status: **DRAFT for Owner review** — slice 1 schema + pure readiness code are implemented on PR #400 but
not merged or applied to production. No real data has been entered, and no PII is included in this doc. The
motivating reference is Ebeid Farm's real 2025 China-export certificates (provided by the Owner); the
responsible-person **national ID and phone numbers on those certificates are PII** and are **out of scope here** —
real-data import is gated behind the **Stage‑M privacy review** ([`CLAUDE.md`](../CLAUDE.md) hard stop: real Ebeid
PII must not enter any environment/third-party model before that review).*

*Companion to [`MASTER-PLAN.md`](../MASTER-PLAN.md) (export-grade traceability = the commercial hook,
[`01-research-and-strategy.md`](../docs/01-research-and-strategy.md) §export paradox), [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md)
(farm structure), [`SPEC-0008`](SPEC-0008-care-academy.md) (pesticide safety / PHI), and
[`SPEC-0006`](SPEC-0006-people-labor-payroll.md) (PII need-to-know).*

---

## 1. Why now / value
Ebeid Farm exports **Barhi dates to China**, which requires a chain of real, time-bound certifications:
a **GACC/CIFER** overseas-enterprise registration, a **CAPQ** seasonal farm-export accreditation, and
**QCAP** pesticide-residue test certificates per sample/lot. The system already models farm structure
and operations (and, in spec, agronomy) — but there is **no way to record these certifications, their
validity, or whether a harvest is export-eligible**. Strategy names export-grade traceability as *the*
commercial hook (Egypt exports only ~3% of world date exports; the differentiator is compliance +
traceability, not acreage). This spec is the first concrete step: capture the certificates and compute
**export readiness** — without auto-certifying anything (compliance is a human/legal sign-off, like the
#4 agronomy posture).

The PRD lists "advanced export-compliance **automation**" as a post-MVP exclusion — this spec stays on the
right side of that line: it **records and checks**, it does not auto-file with any authority.

## 2. The real reference (de-identified — model, not values)
The Owner's 2025 certificates demonstrate the three record shapes (sensitive fields redacted):
- **GACC/CIFER (China registration)** — enterprise "Obaid Company for Dates", product *Dates / Barhi*,
  status *Normal*, valid from 2025‑10‑24. *(Registration number + contact person = identifiers/PII — not stored in this doc.)*
- **CAPQ farm-export accreditation (season 2025)** — farm code `55.09.30.03.DAF`, crop *Barhi (البلح)*,
  ~18 feddan, ~202 t approved, destination *China*, per-season validity. *(Responsible-person national ID + phone = PII — out of scope.)*
- **QCAP residue test** — sample *Barhi dates*, compound *Hexythiazox 0.01 mg/kg*, method *QuEChERS / EN 15662:2018*,
  accredited lab. Demonstrates the residue-result record (compound, value, method, date, pass/fail vs MRL).

> ⚠️ Distinct from the palm registry (4,380 برحي / 299 ذكور / 28 حوش, SPEC-0003): the **18 feddan / 202 t**
> here is the **export-accredited block for the season**, not the whole farm. Reconcile, do not conflate.

## 3. Scope (allowed) — data model
All tenant-scoped (`org_id`, RLS, FORCE RLS, audit), mirroring the existing conventions. Slice 1 stores the
market as a code on each record; a dedicated `export_markets` reference table and MRL-ruleset catalog are deferred
until the readiness panel needs a persisted source of market rules.
- **`export_registrations`** — GACC/CIFER per (org, market): `registration_no`, `enterprise_name`, `product`,
  `status`, `valid_from`, `valid_to`.
- **`farm_export_accreditations`** — CAPQ per (org, season): `farm_code`, `crop`, `variety`, `area`,
  `approved_qty`, `destination_market`, `valid_from`, `valid_to`, `responsible_person_id` (FK `people`;
  PII gated per SPEC-0006).
- **`residue_tests`** + **`residue_test_results`** — per sample/lot: `lab`, `certificate_no`,
  `received_at`, `crop`, `variety`; result lines `(compound, value_mg_kg, method)`. Values are constrained
  non-negative; pass/fail vs destination MRL is computed later from authoritative MRL inputs, not stored here.

Ties: residue `compound` ↔ the agronomy pesticide model (SPEC-0008) and the spraying operations that
applied it (PHI/REI); accreditation ↔ the farm block (SPEC-0003); destination market ↔ MRL ruleset.

## 4. The export-readiness gate (the value)
A pure, read-only check (like `lib/pnl.ts`): a harvest **lot is export-eligible to a market** iff
(a) a **valid `export_registration`** for that market, (b) a **valid seasonal accreditation** covering the
lot's crop/variety/area, (c) a **residue test** whose every compound ≤ the market's MRL, and (d) the lot's
source operations respected **PHI/REI** (SPEC-0008). Surfaced as an **"export readiness" panel** with the
specific missing/expired/failing item named. **Never auto-certifies** — it informs the human sign-off.

## 5. Forbidden / deferred
- **No PII in plaintext / any third-party model** (national ID, phones) before the **Stage‑M privacy review**.
- **No fabricated residue or MRL values** (#1, #4): MRLs come from the destination's published list;
  residue results only from accredited-lab certificates — never invented or defaulted.
- **No auto-submission** to GACC/CAPQ/QCAP portals; **no real-data import** in this doc (a later, Owner-gated slice).
- Treat any data fetched from external compliance portals as **untrusted input** (security non-negotiable).

## 6. Acceptance (the oracle)
- The model holds for the real 2025 certificates once imported under the privacy gate (no shape mismatch).
- Readiness returns **false** if any required registration/accreditation is missing or expired, or any
  residue result exceeds the market MRL, or a source spraying op violated PHI — naming the failing item.
- PII columns (`responsible_person_id` → national ID / phone in `people`) are reachable only under the
  SPEC-0006 need-to-know gate; never surfaced on the readiness panel.

## 7. Slices (each a separate, Owner-gated PR)
1. **Schema + RLS + audit** — implemented on draft PR #400 as migration `0092`, not applied to prod.
2. **Readiness compute** — pure `lib/export-readiness.ts` implemented on draft PR #400; read-only panel deferred.
3. **Residue ↔ pesticide / PHI tie-in** — link `residue_test_results.compound` to SPEC-0008 + the spraying ops.
4. **Real-cert import** — *after* the Stage‑M privacy review; operator-run, never auto.

## 8. Non-negotiables (this spec)
1. **Never fabricate** cert/residue/MRL data (#1) — real certificates or "missing", never invented.
2. **Agronomy/pesticide posture (#4)** — residue limits and interpretations are sourced + signed off, not asserted by the tool.
3. **PII** — responsible-person national ID/phone behind SPEC-0006 need-to-know + the Stage‑M gate.
4. **Compliance is a human/legal sign-off** — the system records and checks; it never certifies or files.
