# Accounting/custody efforts — deconfliction & canonical-path recommendation (2026-07-01)

*Status: **coordination recommendation for the Owner — not a build authorization** and does not edit any other
effort's files. Several sessions worked the accounting/custody space in parallel on 2026-07-01; this is the single
place that inventories every effort and recommends which is canonical, so the Owner coordinates rather than merges
duplicates. Companion to [`ROADMAP-accounting-custody-2026-07-01.md`](ROADMAP-accounting-custody-2026-07-01.md).*

*Author: autonomous session, Owner: Amr Ebeid. Effort states verified via `gh pr view` on 2026-07-01.*

---

## 1. Why this exists

The accounting/custody pillar drew **multiple concurrent efforts** on the same day. Most are complementary and
already cross-reference each other, but there is **one genuine unreconciled overlap** (two P&L approaches) and a
few "same work, two docs" cases. Left uncoordinated, this risks merging duplicate P&L code or conflicting docs.
This memo resolves that.

## 2. Inventory of every accounting/custody effort

| Effort | PR | State | Scope | Verdict |
|---|---|---|---|---|
| Cash-method GL kernel + custody settlement | **#568** | ✅ merged, prod-applied | `accounts`/`journal_entries`/`journal_lines`, balance guard, trial balance, custody imprest + payment-request lifecycle + settlement | **Foundation — canonical.** Everything builds on this. |
| Full Stage-7 accounting framework | **#368** | ❌ **CLOSED** | `sales`, `fn_accounting_pnl_summary`, `/accounting`, `AccountingView` (drafts `0088`/`0097`) | **Superseded** by #568 + #555. Stays closed; mine any still-wanted ideas into the slices below. |
| Owner P&L period summary | **#555** | 🟡 open (draft, gated) | `/finance/pnl`, `fn_owner_pnl_summary` (migration `20260701270000`), drawings-below-the-line; explicitly *additive*, small | **Near-term canonical P&L** (see §3). |
| Custody-transfer + reporting + revenue detail | **#580** | 🟡 open (docs) | `SPEC-0018-EXT-custody-transfer-and-revenue.md`: holder-to-holder transfer RPC, payment-request PDF + report set, revenue with delivery-before-price | **Complementary** — already self-reconciled to the roadmap; its revenue slice = Slice A2 revenue. |
| Roadmap + gap analysis | **#573** | ✅ merged | Market gap analysis; Slices A–D sequencing; the 3 owner decisions | Canonical sequencing. |
| Docs-catalog reconciliation | **#574** | ✅ merged | Cataloged #568's GL objects | Done. |
| Draft chart of accounts | **#577** | ✅ merged | Proposed chart (unblocks decision #1) | For accountant red-line. |
| ETA/VAT memo | **#578** | ✅ merged | The legal question (unblocks decision #2) | For accountant. |
| Slice A implementation plan | **#579** | ✅ merged | Ordered A1–A4 build plan | Canonical build plan — **amend A1 per §3**. |

## 3. The one real overlap: P&L (#555 vs Slice A1) — recommendation

Both #555 and Slice A1 (in plan #579) produce a **P&L**. They should not both be built.

- **#555** is smaller, further along (code + migration + tests exist), correctly gated, and drawings-below-the-line.
- **Slice A1** proposed a fuller P&L **+ balance sheet** report RPC set.

**Recommendation:** let **#555 be the canonical P&L** (near-term), and **re-scope Slice A1 to only the pieces #555
doesn't cover** — the **balance sheet** RPC (`fn_accounting_balance_sheet`) and the type-based grouping — building
*on top of* #555 rather than a competing `fn_accounting_pnl` (which would then be redundant). Net: A1 shrinks to
"balance sheet + reconcile-P&L-to-#555"; A2/A3/A4 unchanged.

## 4. The "same work, two docs" cases — recommendation

- **Revenue:** #580's `SPEC-0018-EXT` revenue design (delivery-before-price: a sale posts no journal until
  `fn_finalize_sale_price`) **is** the roadmap's Slice A2 revenue line, with the pending-price mechanic filled in.
  **Recommendation:** adopt #580's revenue design as the Slice A2 spec; don't author a competing `sales` design.
- **Custody transfer + reporting:** #580's holder-transfer RPC + report set are genuinely new (not in #568) and
  don't overlap my slices. **Recommendation:** accept as a distinct custody-hardening slice (call it Slice B′ or
  fold into Slice D reporting).
- **Docs edits:** #580 also edits `ROADMAP`/`SESSION-BRIEF`/`PROJECT-TRACKER`, which my #573/#575/#576 already
  changed → **#580 will hit merge conflicts** on those three files. **Recommendation:** rebase #580 on current
  `main` and keep both entries (they're additive, different sections).

## 5. Net canonical path (after coordination)

1. **#568** (shipped) = foundation.
2. **#555** = the P&L → merge once Owner applies its migration + independent review.
3. **Slice A** (plan #579), re-scoped: A1 → **balance sheet only** (P&L is #555); A2 revenue = **#580's
   pending-price design**; A3 period close; A4 budget-vs-actual (#157).
4. **#580's** custody-transfer + reporting = a parallel custody-hardening slice.
5. All still gated on the 3 Owner decisions: **chart of accounts** (#577), **ETA/VAT** (#578), **#157 budget
   policy** — and independent money-logic review + Owner-applied migrations.

## 6. What the Owner needs to decide here

1. **Confirm #555 is the canonical P&L** (and re-scope Slice A1 to balance-sheet-only), OR prefer the fuller
   Slice-A P&L and close #555's overlap.
2. **Adopt #580's revenue (delivery-before-price) design** as Slice A2.
3. Greenlight rebasing #580 so its doc edits stop conflicting with the merged roadmap/brief/tracker.

*No code changed and no other effort's files were edited by this memo — it is coordination only. Money-logic
implementation stays gated on the decisions above + independent review + Owner-applied migrations.*
