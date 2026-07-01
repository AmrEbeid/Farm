# OPS-PLAN — operations modules: focused 360 + the leapfrog plan (2026-07)

*Synthesis of the operations-focused wave (2026-07-02): the ops code 360 (`OPS-360-REVIEW-2026-07-02.md`), world-class ops-UX market research (`RESEARCH-ops-market-2026-07-02.md`), and Egyptian date-farm ground-truth workflow research (`RESEARCH-ops-workflow-egypt-2026-07-02.md`). Companion to `BOOM-PLAN-2026-07.md` (whole-product strategy). Owner: Amr Ebeid. Status: proposal — every build item gated.*

## The verdict in one line

**Farm OS records work superbly and plans work poorly (ops daily-use grade: C−)** — and the three research streams agree on the same escape path: mirror the farm's real rhythm (season program → dawn dispatch → paper artifacts), unblock three small UI gaps, then leapfrog the entire market with the one combination nobody ships: **per-palm task ledger + supervisor-device/QR-badge crews + auto compliance records + offline + Arabic**.

## Why the three streams converge

- **Code (360):** operations are monostate — of 9 statuses the app can only write `done`; no reschedule/cancel/block; **hawsha-level planning is unreachable from the UI** (every plan defaults to farm scope → per-scope cost charts structurally empty); authoring a real week ≈ 150–200 serial drawer interactions; templates invisible in prod (dev-seed only); the dedup key silently swallows a second same-day op; execution can't be backdated.
- **Ground truth (Egypt):** there is **no weekly plan on a real farm** — the artifacts are the annual month×operation×dose-per-palm program (جدول خدمة النخيل) and reactive **dawn dispatch run on voice**; verification is cameras/WhatsApp photos; crews arrive via مقاول أنفار head-counts; climbers are paid day-rate + in-kind; **"sold on the tree" (بيع على النخيل) is a first-class harvest outcome**. Any dispatch flow slower than ~60 seconds loses to a voice note.
- **Market:** no product combines per-plant granularity + spray hard-block + piecework + offline + Arabic. The best patterns to copy: Hectre's supervisor-device + QR badges (workers need zero technology), per-row done-state with multi-day carryover, FarmQA's completion-emits-the-compliance-record, Agworld's warn|block compliance toggle + weather-stamp-at-completion, Croptracker's crate-tag traceability. **Nobody assigns work to named individual trees — Farm OS's palm registry makes it uniquely positioned to be first.**

## The build sequence (each item one PR; Lane 0 before real data, Lanes 1–3 with/after Stage M)

### Lane 0 — unblock the planner (small PRs; the C−→B+ path; SPEC-0021 silently depends on these)
| # | PR | What it fixes |
|---|---|---|
| L0-1 | **Hawsha/sector scope picker** in PlanCreateForm + per-op target picker in OperationBuilder (RPCs already store target columns) | "Fertilize hawsha 3 on Tuesday" becomes expressible; per-scope cost/rollup charts light up |
| L0-2 | **`fn_reschedule_plan_operation(op, date, reason)`** + date-edit UI + audit | Weather moves everything; today a rained-out op rots as "متأخرة" forever |
| L0-3 | **`fn_set_plan_operation_status`** → `blocked`/`abandoned`/`skipped` (+`in_progress`) with reason; buttons on `/m` + plan table | The statuses, guards, and Arabic labels exist as dead code; "pump broken" becomes recordable |
| L0-4 | **Duplicate-operation** action (re-call the multi RPC from an existing op with a new date) | 80% of a week is last week shifted; kills most of the 150-interaction authoring cost |
| L0-5 | **Fix the dedup swallow**: client idempotency key (or surface `deduped` loudly) | A second same-day irrigation currently reports success and doesn't exist |
| L0-6 | **Backdating**: optional bounded `p_occurred_at` on execute + date field (default today) in ExecuteForm/RecordActivity | Night-time recording of the morning's work stops corrupting PvA + REI/PHI windows |
| L0-7 | **Read-only week grid** on the plan page (7 columns by `planned_at`, spans via `ends_on`) | A manager can finally *see* Tuesday; presentation-only |
| L0-8 | **Template CRUD page + ship the 3 seed programs as prod data** (they exist only in dev seed; the picker hides itself when empty) | The templates feature becomes visible on the live farm |

### Lane 1 — the daily loop (mirror the real rhythm; needs real data to matter)
| # | PR | Pattern source |
|---|---|---|
| L1-1 | **Dawn dispatch screen**: today's ops per hawsha pre-seeded from the plan/template; manager confirms-not-composes in <60s; one tap generates the Arabic WhatsApp-shareable summary (bridge the channel, don't fight it) | Ground-truth moment #2 |
| L1-2 | **Attendance head-count**: per-contractor crew counts at muster (names optional later), offline-tolerant, feeds wage calc + owner morning KPI | Ground-truth moment #1 |
| L1-3 | **Evening digest**: structured owner summary (done/slipped/blocked + photos) replacing chat-scroll; photo-required only on owner-flagged op types | Ground-truth moment #7; rides BOOM-PLAN P5 inbox |
| L1-4 | **Ops reporting gaps**: cost/count by *subtype* chart + global awaiting-sign-off queue + slipped-this-week (needs L0-2/3 reasons) | Code-360 gap #12 |

### Lane 2 — the leapfrog (the moat; pollination season is the forcing function)
| # | PR-chain | What it is |
|---|---|---|
| L2-1 | **Per-palm task ledger**: task = (op type, scope = palm set/hawsha, pass N); per-palm done-state; auto **carryover** of the remainder to the next day; hawsha renders green/orange | Hectre row-credit + Sentinel per-plant + FarmERP per-tree QR — three proven patterns nobody combines; exact fit for pollination's 2–4-day per-palm window and 3–8-pass harvest |
| L2-2 | **Supervisor-device + laminated QR badges** (palms AND workers): مشرف scans palm = done-this-pass; scans worker badge = piece credited; anti-double-scan cooldown; zero worker phones | THE model for يومية crews (Hectre-proven) |
| L2-3 | **Piecework engine + daily-minimum top-up + printed Arabic work receipt (إيصال عمل اليوم)** | Kills pay disputes — the crew-adoption wedge; rates as per-task attributes (climbers 350–450 EGP/day Aswan; pollination 40–60 palms/climber-day; piece rates = interview gap) |
| L2-4 | **Harvest module**: multi-pass by stage (خلال/رطب/تمر), crate QR tags bound to hawsha+pass (packhouse rescan closes traceability), **"sold on the tree" as a first-class outcome**, live per-climber tallies | Croptracker tags + ground truth §3; feeds BOOM-PLAN P3 (harvest qty + revenue) |

### Lane 3 — the compliance wedge (export pull; pairs with the GlobalGAP records export)
| # | PR | What it is |
|---|---|---|
| L3-1 | **Completion auto-emits the spray record** (سجل الرش): product+active ingredient, hawsha, dose/rate, equipment, target pest, PHI, applicator, authorizer — the GlobalGAP IFA v6 Major-Must field set, written as a side effect of `/m` done; **pesticide picklist with default doses (supervisor picks, never types)** | FarmQA pattern + the export-mandated paper artifact |
| L3-2 | **REI/PHI as ambient cross-module state**: colored hawsha badge on all pickers/maps/timeline; harvest op on a locked hawsha intercepted; per-farm **warn \| block** toggle | Agworld hard-block = would be a genuine market first if enforced; also make the existing sign-off gate actually gate (org toggle) |
| L3-3 | **One-tap weather stamp at completion** (temp/wind/humidity via one API call) | GlobalGAP Major-Must FV-GFS 32.02.02, free at execute time |
| L3-4 | **RPW recurring routes**: fortnightly trap-service route, 45-day inspection cadence, lure reminders; "infested" finding auto-spawns the injection task | Highest-frequency recurring op; nobody models it well |

## What to EDIT (behavior changes to existing code, beyond the gaps)

1. Dedup key semantics (L0-5) — current natural key `(plan, subtype, planned_at)` is wrong for real farms (morning/evening ops, per-hawsha ops).
2. `occurred_at = now()` hardcode (L0-6).
3. Plan `status` gates nothing — decide: either active-only ops appear on `/m`, or drop the pretense; RPC should validate *transitions* not values.
4. `approval_needed` hardcoded `true` and rendered as decoration — wire it or remove it.
5. RecordActivity: offer the canonical subtype vocabulary (keep free text as fallback) + optional material line posting a real issue movement — ad-hoc work is half the farm's day and currently invisible to cost.
6. Template instantiation: honor scope + `ends_on` (currently hardcodes null), per-palm coefficients per SPEC-0021.
7. Template agronomic defaults must be **Egyptian commercial rates, not FAO-2002** (real practice runs 2–30× richer; FAO defaults would look wrong to any real farmer).

## Owner decision asks

1. Approve **Lane 0 as the immediate build queue** (parallel with the Stage-M/real-data track; these are small, low-risk, and SPEC-0021 depends on them).
2. Decide the **plan-status semantics** (edit #3) and the **warn|block default** for spray compliance (L3-2).
3. Approve the **supervisor-device + QR badge** direction (L2-2) before any hardware/label purchase — pilot one hawsha first.
4. In the design-partner interviews (guide in `RESEARCH-customer-demand-2026-07-02.md` + additions in `RESEARCH-ops-workflow-egypt-2026-07-02.md` §e): photograph the harvest tally + custody book, get pollination/harvest piece rates, verify the dawn-dispatch hypothesis.
5. The **date-palm operations calendar** in `RESEARCH-ops-market-2026-07-02.md` §b is the template-library content spec — route it through the agronomist sign-off gate (#366 / non-negotiable #4) before any dose ships as a default.

## The strategic footnote

The labor layer is the open flank across the whole market (NakheelLand has per-palm tracking but zero labor/attendance/custody; no Egyptian agri piecework app exists), and **palms-per-worker-per-day norms are unpublished anywhere** — the farm's own captured data can become the industry reference benchmark. That is a moat no competitor can copy without years of Egyptian field data.
