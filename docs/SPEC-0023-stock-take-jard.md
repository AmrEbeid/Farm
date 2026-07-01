# SPEC-0023 — Stock-take / الجرد (the anti-leakage keystone)

*Status: DRAFT — Owner review required. Created 2026-07-02 from the inventory 360 (`INVENTORY-360-2026-07-02.md`) + primary-source practice research (the 1983 لائحة مخازن الحكومة — Egyptian Government Stores Regulation, Ch.13 جرد + Ch.14 تفتيش — the DNA of every Egyptian count ritual; Cassation doctrine; FAO pesticide-store manual; EAS 2). Build order: Slice 1 can start any time (independent of Stage M); it is the highest-leverage anti-leakage build in the product.*

## 1. Why

The product's anti-leakage promise currently lives only on the DIGITAL ledger. Physical stock has **no reconciliation loop** — no count workflow exists anywhere (verified: zero hits for جرد/stock-take/variance in app+migrations). So leakage moves to the physical/book boundary, exactly where the storekeeper's documented paper fraud modes live (forged إذن صرف signatures; the Girga "system zero, store full" ghost-issue case). The جرد converts the storekeeper from an information monopolist into an auditable custodian — **and protects the honest one**: Cassation doctrine holds a bare عجز proves nothing without intent, so a continuous signed count record is HIS defence. UI framing: **«الجرد يحميك»**.

## 2. Design rules (each grounded in the 1983 regulation / sources — see research doc)

1. **Blind count, non-negotiable**: the counter NEVER sees book quantity (counting "per the books" is a disciplinable offense in the regulation; the committee signs a physical-count declaration). Book balance revealed only at variance review.
2. **Counter ≠ custodian, ever** ("من غير أمناء المخازن") — but the storekeeper attends, gives per-line إيضاحات, and co-signs.
3. **Hard cut-off snapshot at session open** (digitized "تقطع البواقي": freeze book qty + record last movement ids, like the paper محضر records the last إذن serials); movements during the session blocked except committee-approved urgent issues.
4. **Variances are ledger events, never edits** — gross per item, NO netting of shortage against surplus, no old surplus covering new shortage. Approved count posts explicit movements via internal `fn_post_movement` (`loss`/`adjustment` types exist in the CHECK).
5. **Per-category tolerances (نسب السماح) + recount-before-accusation**: diesel ~2–3% of throughput, sealed pesticide packs = zero, sacks = zero, bulk/opened = small allowance. Owner-configurable per category (no published Egyptian table for farm inputs — don't hardcode). Beyond threshold → mandatory second blind recount before approval.
6. **Phone-first for a semi-literate counter**: big-numeral entry in natural units (شيكارة/جركن/عبوة — system does pack-size conversion), photo per count line (stack/gauge photo, timestamped) — the Girga fraud was proven by photographing a full store against a zero system balance.
7. **Treat زيادة as seriously as عجز** — surplus is the signature of ghost issues or short deliveries, not good news; surface both symmetrically.
8. **Handover count is mandatory on storekeeper change** (regulation: handover may never substitute for a جرد) + a storekeeper-facing «سجل ذمتي» clean-history screen.

## 3. Model (one migration; every primitive exists)

- `stock_counts`: id, org_id, location, **type** (`annual`/`partial`/`surprise`/`handover`), status CHECK (`draft/counting/submitted/approved/posted/cancelled`) — status UPDATE revoked from authenticated (transitions via RPC only), snapshot_at, last_movement_id (cut-off anchor), created_by/submitted_by/approved_by + timestamps, note. RLS org-scoped + FORCE.
- `stock_count_lines`: count_id, item_id, book_qty (frozen at open), counted_qty, unit, photo attachment ref, **storekeeper_note (إيضاح)**, reason; unique(count_id, item_id). Variance computed, not stored.
- RPCs (SECURITY DEFINER, `search_path=''`, EXECUTE locked): `fn_count_open(location, type, item_sample?)` — snapshots book qty per bin; `fn_count_submit(count, lines)` — blind (the counter-facing read path omits book_qty); `fn_count_approve(count)` — owner/farm_manager, **approver ≠ submitter** (reuse the PR SoD pattern + version lock), drift guard (reject if movements after snapshot_at → re-snapshot), then per nonzero-variance line posts `adjustment`/`loss` via internal `fn_post_movement` with `p_event_id = count_id`, status → posted.
- Output: auto-generated **محضر جرد PDF in the government format** (نموذج 6/7 columns: كود/اسم الصنف/الوحدة/سعر الوحدة/الرصيد الدفتري/الموجود فعلياً/العجز/الزيادة/القيمة/إيضاحات أمين المخزن + signature blocks + the last-voucher-serial cut-off anchor) — deliberately shaped like the legally familiar document.

## 4. The surprise-count playbook (the absentee-owner feature)

Owner-side scheduler, invisible farm-side: N random partial counts/month; the assigned counter (supervisor/agronomist — never the storekeeper) is notified **only at count time** («في مواعيد غير معينة وبغير إعلان سابق»). Risk-weighted sampling: always diesel (dip + photo) + rotation weighted by value, movement volume since last count, past variance; floor = every item ≥1×/year. Verdict to the owner in minutes: matched/عجز/زيادة per item with photos, in units AND EGP AND as % of issues since last count (the regulation's rate metric). Escalation: repeated variance on same item/person → suggest full surprise جرد; clean streak → «عُهدة سليمة» badge. Dashboard KPI: **«أيام منذ آخر جرد» per location — the owner's single trust dial.**

## 5. Build slices (one PR each)

1. Migration + RPCs + pgTAP (variance posts reconcile fn_bin_rebuild; approver≠submitter; drift guard; blind read path).
2. Count-sheet UI (open → blind entry with photos → submit; printable).
3. Approval screen (variance report qty+EGP, إيضاح capture, approve→post) + محضر PDF.
4. Owner surfaces: days-since-count KPI, variance trend, CSV; surprise scheduler.
5. Handover-count flow + «سجل ذمتي».

## 6. Companion decisions (Owner)

- Tolerance defaults per category (proposal in §2.5) — confirm with the accountant.
- **Valuation: weighted average (moving)** per EAS 2 (LIFO not recognized in Egypt; WAC is what Arabic SME tools default to; farm inputs are fungible) — while keeping **FIFO as the PHYSICAL rotation rule for pesticides** (FAO shelf-life mandate). Two different concerns; never conflate.
- Charging rule for confirmed shortages (the regulation: higher of book/market +10% admin — adopt or simplify).

## 7. Dependencies / pairs with

Actor-on-row for movements (`created_by`) + ad-hoc `fn_post_adjustment` (wastage/spoilage with reason) — INVENTORY-360 gaps #2/#3 — should land with or before Slice 1; receipt price/invoice capture (gap #4) makes variance EGP values real. Never re-grant `fn_post_movement`/direct INSERT to authenticated; the count posts through the internal path only.
