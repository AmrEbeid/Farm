# Palm registry source reconciliation

**Date:** 2026-07-30  
**Authority state:** **BLOCKED**  
**Scope:** deterministic, read-only source evidence; no import, migration, or production change

## Result

The available farm files do not support an authoritative palm registry yet. The old
4,380 Barhi / 299 male / 28 hawsha baseline conflicts with the later workbook, and the later workbook
is internally inconsistent. Neither total is approved for import.

The committed oracle is `apps/farm-os/lib/palm-source-reconciliation.ts`. It stores only structural,
non-PII facts with relative file locators and SHA-256 hashes. Its result is always fail-closed for the
current manifest: `authorityState = blocked` and `importPayload = null`.

## Source evidence

| Source | SHA-256 | Mechanical result |
|---|---|---|
| `مزرعة عبيد 2026/بيانات مزارع وقطاعات النخيل.xlsx` | `1a74a4a4cafa40be36d7fad72899bea077c48266ab4b30eb53596844b470450d` | Stated Barhi total 4,539; row values total **4,638**; male rows total 370 |
| `مزرعة عبيد 2021/.../ترقيم نخيل ال 18 فدان بالعزبة.xlsx` | `e2536b9b4fe0a94eb948978589e689518e4cda902d39e5fa0996d47e2cfcead5` | Explicit numbering 1–759; headings total **782** |
| `مزرعة عبيد 2021/.../النخيل/ترقيم وفحص النخيل بمزرعة 18 فدان.xlsx` | `b068851b8937c2f39940311c113b99d0a4fd7baccf2fa293e4049feb50116a17` | Explicit numbering 1–759; range sizes 125/143/108/132/108/143 |

The full relative locators are pinned in the oracle. Raw workbooks are not committed.

## Blocking contradictions

1. The 2026 Barhi row sum is 4,638, which differs from its stated 4,539 total by 99.
2. Sector number 3 is assigned to both Awama and Haswa.
3. Shafaa has two Barhi columns but four male columns. Therefore 28 units are only implied by using
   unmatched columns; the paired Barhi shape contains 26 units.
4. Planting-date values include `2026-2025` and `2026`, neither a complete date.
5. The 2021 heading counts total 782, not the 759 explicitly numbered palms.
6. The 2021 headings conflict with numbered ranges in hawsha 3 (132 vs 108) and hawsha 6
   (142 vs 143).
7. The old 4,380/299/28 baseline conflicts with the later source evidence and has no corrected,
   owner-approved supporting registry.

## Exact release gate

Obtain either:

- a corrected registry signed off by the Owner and farm manager, with one row per agreed structural unit,
  valid sector identifiers and dates, and totals that reconcile mechanically; or
- a fresh field count with the same unit-level structure and dated signoff.

Then replace the evidence manifest, make every blocking oracle issue disappear, independently review the
result, and only then prepare a separate Owner-gated dry-run/import. Production palm counts and assets must
remain unchanged until that gate is complete.
