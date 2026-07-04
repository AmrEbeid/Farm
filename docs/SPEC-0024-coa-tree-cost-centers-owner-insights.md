# SPEC-0024 — شجرة الحسابات (editable COA tree) + مراكز التكلفة (cost centers) + Owner Insights

*Status: **DRAFT for Owner review** — design only; no schema applied, no code, no import. Written 2026-07-04
from the Owner's directive ("build the tree of the accounts, flexible to edit or adjust; build the concept of
the cost center; keep everything in the product linked") plus a review of two Owner-provided sources:
the farm's **real accounting workbook** (`شيت محاسبي للمزارع0 (1).xlsx`) and the **EBD Farm Insights** Lovable
app (curated real-economics dashboard). This spec fills the **chart-of-accounts gate that SPEC-0018-EXT §10
explicitly blocks its revenue slice on**, and realizes SPEC-0004 §7.1's drafted COA as a living, editable tree.*

*Companions: [`SPEC-0004`](SPEC-0004-accounting-and-pnl.md) (P&L + §3.1 kernel + §7.1 draft COA),
[`SPEC-0018`](SPEC-0018-custody-and-payment-requests.md) / [`SPEC-0018-EXT`](SPEC-0018-EXT-custody-transfer-and-revenue.md)
(custody, requests, revenue), [`SPEC-0021`](SPEC-0021-season-cycle-engine.md) (season dimension),
[`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md) + #239 (physical structure),
[`SPEC-0020`](SPEC-0020-import-template-prefill-and-upsert.md) (import framework), issue **#595** (intercropping),
[`SPEC-0017`](SPEC-0017-frontend-admin-and-table-patterns.md) (UI patterns), [`SPEC-0005`](SPEC-0005-ai-assistant-abduljalil.md) (Ask-عبدالجليل, Stage-11).*

---

## 0. Source-material review — what the two files actually contain (verified)

### 0.1 The real accounting workbook (`شيت محاسبي للمزارع0 (1).xlsx`) — **the farm's actual books, 2019→2026**
| Sheet | Contents (verified by inspection) |
|---|---|
| **الدليل** | The accountant's dictionary: **18 cost centers with areas** (الحصوه 30ف، الخطاره 23ف، حوض البابور 23ف، الشفعه 9.5ف، الكمثري 7.5ف، مزرعة 4/18 فدان، then *enterprise sub-centers*: موالح الحصوه 16 / نخيل الحصوه 14 / نخيل الخطاره 10 / قشطة الخطاره 13 / موالح حوض البابور 11 / نخيل حوض البابور 12 / نخيل 9.5 / نخيل 7.5 / نخيل 22 (14ف) / قشطة 22 (8ف)) · **~19 expense types** (incl. مسحوبات; and *crop-named* types: البنجر/الثوم/القمح/الأرز/النخيل/أبراج الحمام/جنينة البلد) · **~35 labor task types** with day rates · field-year list (تأسيس، 2018-2019، …) |
| **المصروفات** | **~10,200 real expense transactions** (2019→2026). Schema: سنة/شهر/يوم → **قطاع (top center)** → **مزرعة (sub-center)** → **العام الحقلي (season, incl. تأسيس)** → نوع المصروف → بيان → نوع العمالة/عدد العمال → اسم السماد/المبيد + وحدة/كمية/سعر → **typed amounts** (عام / عمالة / أسمدة-ومبيدات) → إجمالي |
| **المبيعات** | **166 real sales**: قطاع → مزرعة → season → **crop** (خوخ، تفاح، رمان، كمثرى، ليمون، حتى خردة المخازن) → طريقة البيع (نقدي/…) → كمية × سعر → إجمالي → عمالة/عمولة وكالة |
| **التقارير** | The Owner's target report, already real: **expense-category × year (2019–2026) matrix per cost center** with totals |
| **اذونات الصرف** | Salary list by person/role (م. عبد الجليل أسامة — مهندس ومدير المزرعة; أحمد ماهر — محاسب; …) **⚠ plus a plaintext Gmail address + password embedded in cells** |
| مصروفات 2017و2018 / pt المصاريف / Report Calc | Pre-2019 aggregates; pivot; report helper |

**Three structural insights this workbook proves:**
1. **The real cost-center model is 2-level: land قطاع → enterprise مركز** (نخيل الحصوه vs موالح الحصوه = same land, different crop business). This is *exactly* the intercropping fact (#595) expressed in accounting form — and it is **not** the same tree as the physical sector/hawsha structure.
2. **The accountant's category list mixes two dimensions**: true expense types (أسمدة، عمالة، مرتبات…) *and* crops (البنجر، الثوم، القمح، الأرز) used as categories. The new model must split these: **account = what the money was for; cost center/enterprise = which business it served.**
3. **العام الحقلي (field season, incl. تأسيس/establishment)** is a first-class dimension on every transaction — this maps to SPEC-0021's season engine (and تأسيس maps to `kind='capex'` bearer-plant treatment, SPEC-0004 §7.5).

**⚠ Data-quality / privacy flags (non-negotiable #6 names this exact file class):** the embedded **Gmail+password must never be copied forward** (and the Owner should rotate that password — the file circulates); the salary rows are **PII** (payroll.read domain); category typos/splits exist. Import must redact/exclude, never mirror.

### 0.2 EBD Farm Insights (Lovable app) — the Owner-level reporting blueprint
Static-data React/recharts app carrying **real 2025 figures + modeled 2018–24 history** (its own comments say so):
P&L J-curve (2025: sales ≈7.68M / profit ≈3.24M / cum. ≈5.19M), revenue mix (برحي 62.6%، بنجر 30%، ذرة 5.7%، مانجو، **فسائل**),
cost breakdown (مرتبات 1.12M، عمالة 764k، أسمدة/مبيدات 735k…), per-sector per-feddan economics, offshoot pipeline+valuation,
scorecard, forecast/scenarios, annual report, and an "Ask Omar" AI page. **Use:** (a) the UI/UX blueprint for Part C;
(b) a **validation oracle for 2025 actuals**; (c) NOT an import source for the modeled 2018–24 series (non-negotiable #1).

### 0.3 What already exists on `main` (do NOT rebuild — verified @ `c951f9e`)
- **`accounts` table + double-entry kernel** (migration `20260701220000`, PR #568): org-scoped `accounts(code, name_ar,
  account_type ∈ asset/liability/equity/revenue/expense, normal_balance, active)`, `journal_entries`/`journal_lines(account_id,
  custody_account_id)`, RPC-only writes, audited, `finance.read`-gated reads. **Flat — no `parent_id`, no editing RPCs/UI.**
  Accounts are **created lazily on first posting** via `fn_ensure_account` (codes `3000` تمويل المالك، `3100` مسحوبات المالك
  [account_type=**equity**]، `1500`، `5000` appear on demand) — the §A.3 seed must **reconcile with these lazily-created codes**,
  not assume an empty table.
- `expenses.kind ∈ {operating, drawing, capex}` enforced structurally (#6) — note: **the drawings/opex separation lives on
  `expenses.kind` + `fn_account_for_expense_kind` today; `accounts` has NO `kind` column** (adding one is a §A.1 proposal).
- Custody + payment-request lifecycle live (SPEC-0018).
- Import framework live (SPEC-0020: descriptors, staged commit, gated RPC path; `lib/import/registry.test.ts` — the
  `rpcsWithoutDescriptor` test — enforces descriptor coverage).
- SPEC-0018-EXT §10: *"Slice 5 (revenue) should wait until the roadmap's chart-of-accounts gate clears."* **This spec is that gate's fill.**
- No cost-center concept anywhere in code (only a mention in the legacy architecture doc).

---

## 1. Part A — شجرة الحسابات: the editable chart-of-accounts tree

### A.1 Model (extends the live `accounts` — no parallel table)
Add to `public.accounts` (all NEW columns — today the table has none of these):
- `parent_id uuid null references public.accounts(id)` — the tree. NULL = root. **Cycle-guarded** in the RPC (walk-up check) + a depth cap (≤ 4 levels; the farm's reality needs 3).
- `kind text null check (kind in ('operating','drawing','capex'))` — for expense-type accounts only. **New:** today this
  separation lives on `expenses.kind` + `fn_account_for_expense_kind`; lifting it onto the tree makes #6 structural at the
  account level (drawings subtree ≠ opex, ever). The live `3100 مسحوبات المالك` is `account_type='equity'` — it stays the
  drawings **routing target**; the `kind='drawing'` marker applies to the expense-side branch.
- `is_system boolean not null default false` — kernel-critical nodes (the lazily-created `3000/3100/1500/5000`): **rename-allowed, re-parent/archive-forbidden**.
- `sort_order int`. Archiving **reuses the existing `active` flag** (no new `archived` column — avoid a colliding duplicate).
- Keep `code` unique per org (path-style codes e.g. `5-1-2` allowed but not required — display order via `sort_order`).

### A.2 Editing rules ("flexible to edit or adjust" — with accounting safety)
| Action | Rule |
|---|---|
| Add account/branch | Anywhere under a same-`account_type` parent; `kind` inherited from parent by default, overridable |
| Rename | Always allowed (history keeps `account_id`, so reports re-label cleanly) |
| Re-parent (move subtree) | Allowed **within the same `account_type`**; forbidden for `is_system`; cycle-guard |
| Archive | Allowed anytime (hides from pickers; history intact). **Hard-delete: only if zero `journal_lines`/`expenses` reference it — otherwise archive** |
| Merge (typo-split repair) | `fn_merge_accounts(src, dst)` — repoints references, archives src, audited. (The workbook's typo-splits are why this exists) |
- All writes via SECURITY-DEFINER RPCs (`fn_save_account`, `fn_archive_account`, `fn_merge_accounts`), **gated on the existing `budget.write`** (owner/accountant) — deliberately **no new permission**, avoiding an `authorize()` re-emit (the union footgun). Server-side `fn_audit` covers every change. RLS/FORCE RLS unchanged.
- Rollups are **computed** (recursive CTE view `v_account_rollup`), never stored — reports sum a subtree live, so re-organizing the tree instantly re-shapes every report, past and future.

### A.3 Seed tree — SPEC-0004 §7.1 draft × the workbook's real 19 categories (the reconciliation)
Proposed mapping for Owner/accountant ratification (**this table IS SPEC-0004's "Owner reconciles to the real Excel" step**):

| Workbook category (real) | → Seed account (tree) | kind |
|---|---|---|
| أسمدة ومبيدات | مستلزمات زراعية → أسمدة · مبيدات ومكافحة | operating |
| عمالة (+35 task types) | عمالة → موسمية/يومية (task = line detail, not account) | operating |
| مرتبات | عمالة → مرتبات دائمة | operating |
| صيانة وإيجار ميكنة · تموين وإيجار مكينة | معدات → صيانة · وقود وطاقة · إيجار معدات | operating |
| مشتريات · ضيافة · أخرى · كهرباء · صيانة للمزرعة | تشغيل عام → مشتريات · ضيافة · كهرباء ومياه · صيانة منشآت · أخرى | operating |
| **مسحوبات** | **مسحوبات (root `3100`, is_system)** — excluded from opex | drawing |
| مباني | أصول → مباني ومنشآت (+ إنشاء بساتين for تأسيس rows) | capex |
| **البنجر / الثوم / القمح / الأرز / النخيل / أبراج الحمام / جنينة البلد** | **NOT accounts** → these become **cost-center/enterprise** values (Part B); their rows re-code to a true expense account + the matching center | — |
| Revenue (from المبيعات + Insights) | إيرادات → تمور برحي · فسائل · موالح/فاكهة · بنجر · محاصيل حقلية · أخرى (نواتج/خردة) | revenue |

### A.4 UI
A **tree editor page** under the Finance module (`/finance/accounts`): indented tree with drag/re-parent (or move-to picker),
add/rename/archive/merge actions, Arabic-first, `MasterTable`/Drawer patterns per SPEC-0017. Every expense/revenue entry
picker shows **active leaf accounts only**, grouped by branch.

---

## 2. Part B — مراكز التكلفة: the cost-center dimension

### B.1 Model (new table — the genuinely new concept)
`public.cost_centers`: `id, org_id, parent_id (2-level tree, same guard pattern as A), code, name_ar, sector_id uuid null → sectors`
(link to the physical structure where one exists), `enterprise text null` (نخيل/موالح/بنجر/قشطة/قمح/عام…), `area_feddan numeric null`,
`active/archived, is_system` (a protected **إدارة عامة/غير موزَّع** center for unallocatable overhead — SPEC-0004 §7.1 says overhead
is pooled, **not force-allocated**). RLS + FORCE RLS + audit + RPC-only writes (`fn_save_cost_center`, `fn_archive_cost_center`,
`fn_merge_cost_centers`), gated on `budget.write`, same editability rules as Part A.

**Cost center ≠ physical structure.** It's **land × enterprise** (workbook-proven: نخيل الحصوه vs موالح الحصوه). `sector_id`
links, not equates; a center may span or subdivide sectors. This is the accounting answer to intercropping #595.

### B.2 Where the dimension attaches
- `expenses.cost_center_id uuid null` · the revenue/sales table of SPEC-0018-EXT §4 gets `cost_center_id` **from day one** ·
  `journal_lines.cost_center_id uuid null` (kernel pass-through for center-level P&L).
- **Season** stays SPEC-0021's dimension (referenced, not duplicated); تأسيس-season spend maps to `kind='capex'` (§7.5 bearer-plant).
- Default-derivation helper: sector + enterprise → suggested center (editable at entry). Existing rows: `cost_center_id` stays
  NULL until the historical mapping (Part D) — **reports must show NULL as «غير موزَّع», never guess** (#1).

### B.3 Seed + the reports it unlocks
Seed = **the real 18 centers from الدليل, with their areas**, linked to matching sectors; area/name mismatches vs the physical
registry (#239) are **flagged as reconciliation items, not silently adopted**. Unlocked reports (= the workbook's التقارير +
the Insights sector pages, live): cost/revenue/**profit per center**, **per feddan** (center has area), per season, category×year
matrix per center — i.e., **#219's two-tier costing lands here**.

---

## 3. Part C — Owner Insights (the reporting layer, from the EBD Insights blueprint)
A `/finance/insights` (or `/insights`) module computing the zip's pages **live** from journal/expenses/revenue × A × B × season:
1. **P&L trajectory (J-curve)** + cumulative profit — real posted years only; historical years appear **only after Part D**; the
   zip's *modeled* 2018–24 series is never imported as fact (#1) — if shown pre-import, labeled «تقديري (غير مرحَّل)» or omitted.
2. **Revenue mix by crop/enterprise** (برحي/بنجر/فسائل/…) — from revenue accounts × centers.
3. **Cost waterfall by account rollup** (`v_account_rollup`).
4. **Center economics** — table/scatter/radar of profit-per-feddan by center (the Insights SectorScatter/RadarComparison, live).
5. **Offshoots (فسائل) pipeline & valuation** — needs offshoot revenue as a first-class crop line (SPEC-0018-EXT already requires it).
6. **Scorecard / Annual report** — assembled from 1–5.
7. "Ask Omar" → **SPEC-0005 عبدالجليل**, Stage-11 gated; reference only, not in scope here.
UI: recharts patterns portable from the zip (respect the repo's recharts **code-split guard**); Arabic-Indic digits via `lib/money`.

---

## 4. Part D — Historical import + the reconciliation oracle (Stage-M gated)
- **Source of truth for backfill = the workbook** (~10.2k expenses + 166 sales, 2019→2026): imported via the **live SPEC-0020
  framework** (descriptors + staged commit through gated RPCs — `lib/import/registry.test.ts`'s `rpcsWithoutDescriptor` test requires an `ImportDescriptor` per new RPC).
- **Mapping tables first** (Owner/accountant ratify): workbook category→account (per §A.3), قطاع/مزرعة→cost_center, العام الحقلي→season,
  typed sub-amounts (عمالة/أسمدة)→line detail. Unmappable rows land in «غير موزَّع» + a review queue — never dropped, never guessed.
- **The oracle (define-the-check-first):** after import, Farm OS must **reproduce the workbook's own التقارير matrix**
  (category × year × center totals) within rounding — that sheet is the farm's hand-built truth, so it *is* the acceptance test.
  A pgTAP/report test asserts the totals; discrepancies list row-level diffs.
- **Gates:** Stage-M privacy review (real financials + salary PII); **redact the embedded Gmail/password** (and recommend the Owner
  rotates it); salary rows go to the payroll domain (SPEC-0006), not to expenses import; money data is non-authoritative until the
  oracle passes (matches the import framework's existing money-gate posture).

---

## 5. Owner decisions needed (exact)
1. **Ratify the seed COA mapping** (§A.3 table) — esp. splitting crop-named categories into centers, and the revenue branch
   (this simultaneously satisfies SPEC-0004 decision #1 *and* unblocks SPEC-0018-EXT slice 5).
2. **Ratify the seed center list** (§B.3) incl. the flagged area/name mismatches vs #239.
3. **Permission choice**: reuse `budget.write` for COA/center editing (proposed — avoids the authorize() re-emit) vs a new
   `finance.admin` perm (needs the union re-emit + tests 22/97-class updates).
4. Edit-rule confirmations: depth cap 4; merge allowed for both trees; `is_system` protection list.
5. Part D timing (Stage-M) + confirmation that the Gmail password in the workbook gets rotated.

## 6. Slices (each an independently gated PR; define-the-check-first)
| # | Slice | Contents | Depends on |
|---|---|---|---|
| 1 | COA tree schema + RPCs + seed (draft) | A.1–A.3 + pgTAP (cycle, archive-vs-delete, merge, rollup view, #6 drawings-never-in-opex rollup) | decision 1,3 |
| 2 | Tree editor UI | A.4 + page-help + drift-guards | 1 |
| 3 | Cost centers schema + seed + dimension columns | B.1–B.3 + pgTAP (org-consistency center↔sector, per-feddan math, «غير موزَّع») | decision 2,3 |
| 4 | Reports v1 | center economics + rollup P&L (التقارير matrix live) | 1,3 |
| 5 | Owner Insights pages | Part C (charts; labeled-or-omitted pre-import history) | 4 |
| 6 | Historical import + oracle | Part D descriptors + mapping tables + the التقارير reconciliation test | 1,3 + Stage-M gate |

## 7. Non-negotiables carried
#1 never fabricate — «غير موزَّع»/«غير متوفر» over guessing; modeled series never shown as fact. #6 drawings ≠ opex, now
structural at tree level; **flag the workbook's embedded credentials + typos, never copy forward**. #2 Arabic-RTL-first; Arabic-Indic
digits. RLS/FORCE-RLS + RPC-only writes + server-side audit (kernel conventions). authorize() re-emit avoided by perm reuse.
Import via gated framework only; money non-authoritative until the oracle passes. Independent review required (money + access-control).
