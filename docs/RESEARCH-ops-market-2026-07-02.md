# RESEARCH — ops/work-management state of the art + the date-palm operations calendar (2026-07-02)

*Web research (2024–2026): how the best farm software does operations, what permanent-crop products model, and the date-palm agronomy calendar for the template library. **[2+]** ≥2 sources/official docs · **[1]** single source. Feeds `OPS-PLAN-2026-07.md`.*

## (a) The 10 interaction patterns worth copying

1. **Typed document chain Plan → Recommendation → Work Order → Actual**, each conversion pre-filled, original preserved → permanent recommended-vs-actual diff per field (Agworld [2+]). Farm OS: formalize the conversion as a state machine so the diff is stored, not recomputed.
2. **Admin-configurable "full-stop" compliance mode** — label/REI/PHI validation with per-org **warn | hard-block** choice (Agworld [2+]). *No other vendor hard-blocks* — a genuine first available to Farm OS.
3. **REI/PHI painted on the map/list as ambient state** — locked blocks render colored everywhere; harvest on a locked block intercepted; re-entry-safe notifications (Agworld [1], FarmQA [2+], Croptracker [2+]).
4. **One-tap weather stamping at completion** (temp/wind/gust/humidity/Delta-T auto-filled from an API) — GlobalG.A.P. IFA v6 makes weather-at-application a **Major Must** (FV-GFS 32.02.02) (Agworld [2+]).
5. **Supervisor-device + physical QR tokens instead of a worker app** — workers carry printed badges, zero technology; supervisor scans badge → piece credited; anti-double-scan cooldown; partial-bucket proration; manual 1–10 fallback (Hectre [2+]). THE model for Egyptian يومية crews.
6. **Per-row assignment with partial-completion carried across days** — trees-per-row credited at clock-out; rows render green=done/orange=partial; remainder persists to tomorrow; avg min/tree per worker reported (Hectre [2+], Tātou carryover [2+]).
7. **Task completion auto-creates the compliance record** as a side effect — paperwork is never a separate step (FarmQA [2+]).
8. **Bin/crate QR tags** pre-bound to block/variety/harvest-event, activated by field scan, rescanned at packhouse receiving → closed traceability loop (Croptracker [2+], Hectre tickets [2+]).
9. **Map / list / calendar as interchangeable lenses over one task set**, blocks colored by status; assign from any lens; worker GPS-guided with the right template pre-loaded (FarmQA [2+], AgriWebb map-pins + week list [2+]).
10. **Live per-worker productivity + end-of-day printed work receipt** — kills pay disputes; Hectre customers report ~90 min/day saved per crew leader [2+].

Honorable mentions: applicator signature box on the spray order (Croptracker); GPS coverage trace as proof-of-work (Farmable — see do-not-copy); crop-plan-as-task-generator with drag-reschedule that reshuffles downstream tasks (Tend — Farm OS already has the relative-scheduling half).

## (b) The date-palm annual operations calendar (the template-library content spec)

Anchored on FAO PPPP-156 (Zaid 2002) Ch. V–XI, FAO 2020 RPW Guidelines, UCCE Coachella cost study, KSA/UAE/Egyptian extension. Stages: حبابوك → كمري → خلال → رطب → تمر. **Route all dose defaults through the agronomist sign-off gate before shipping (non-negotiable #4).**

| # | Operation | Window (N. hemisphere) | Trigger rule | Labor | Materials/notes |
|---|---|---|---|---|---|
| 1 | التقليم/التوريق pruning | Feb–Mar + Apr–May | remove fronds >3yr; keep 100–120 green leaves/crown | ≈0.8 hr/palm [1]; whole-orchard ≈170 wd/ha/yr [2+] | burn/remove fronds (RPW sanitation) |
| 2 | التكريب/التشويك | Feb; de-spine Apr–May | de-spine outer 20–25 fronds pre-pollination | n/p | copper oxychloride on cuts |
| 3 | **التلقيح pollination** | **Egypt Mar–Apr** (KSA/UAE Feb–Mar) | spathe splits → pollinate within **2–4 days**, 10:00–15:00, ≥18°C | ≥2 passes, 2–3 climbs/palm; peak ≈28 man-days/ha [1] | 2–3 male strands/bunch; 1♂:~25♀; 1g pollen ≈10 spathes |
| 4 | خف الثمار thinning | Apr–Jun | 6–8 wk post-pollination (Medjool 3–4 wk); remove 50–60% | skilled only (folded into a climb) | cut strand tips ~¼, remove center strands |
| 5 | Bunch-load regulation | at set; adjust Sep | 8–10 leaves/bunch; ~10 bunches (yr4=1–2, yr5=3–4) | part of thinning | rule engine: bunches = f(age, leaves) |
| 6 | التذليل tie-down | May–Jun | 4–8 wk post-pollination while rachis flexible | ~0.4 hr/palm [1] | 2 ropes/bunch |
| 7 | التكميم bagging | paper Jul–Aug; Gulf net Oct–Nov | late كمري → color-break; MUST cover before رطب | in prune+bag ≈$10.5/tree [1] | net (birds/wasps) vs kraft (rain) vs cotton (Medjool) — cultivar variants |
| 8 | الري irrigation | peak Jul–Sep; low Dec–Feb | Egypt basin: 10–15d summer / 30–40d winter; right after spathe emergence; reduce pre-harvest | — | measured 59–95 m³/palm/yr [2+]; summer ≈2× winter |
| 9 | السباخ manure | Nov–Dec | annual dose | n/p | Egypt commercial ~100 kg FYM/palm (+0.5–1 kg superphosphate); FAO's 3 kg is NOT practice |
| 10 | NPK program | N split Feb/Mar→Aug; P,K quarterly | fertigation preferred | n/p | Egyptian commercial ≈0.8 kg N + ~5 kg K₂SO₄/palm — default to these, not FAO-2002 |
| 11 | **RPW monitoring** | year-round; peaks Mar–May, Sep–Nov | 1 trap/ha; **service fortnightly**; lure 2–3 mo; inspect palms <20yr **every 45d**; inspector 200–300 palms/day | route-based recurring | bucket trap + ferrugineol + date bait |
| 12 | RPW injection | on detection | early = recoverable; severe = cut & destroy | drill+inject, repeat +15d | triggered task off an inspection finding |
| 13 | الدوباس Dubas bug | ~Feb + ~Aug (GCC) | treat at 3–6 nymphs/leaflet | 1 round/gen | threshold-triggered |
| 14 | العنكبوت الغباري dust mite | Jun–Jul (كمري) | before webbing coats bunches | 1–2 rounds | sulphur/abamectin |
| 15 | Lesser date moth | first larvae ~Apr | spray at first larvae | pheromone traps 2/ha; read weekly | Bt + sanitation |
| 16 | **الحصاد harvest** | Jul→Dec by cultivar/stage | **3–8 passes/palm @ 5–7d** (Medjool 2–3); خلال Barhi Jul–Sep, رطب Aug–Oct, تمر Sep–Dec | ~8–10 crown visits/palm/season total; **palms/worker/day UNPUBLISHED — capture it** | crates/bins; climbers or platforms |
| 17 | Sorting/grading | immediate | grades A–D | ~400 kg/8h/worker [1] | — |
| 18 | Fumigation | pre-storage | stored-product pests | — | phosphine main; record it (EU-rejection hazard class) |
| 19 | Drying/storage | post-sort | ≤50–55°C; <20% moisture; تمر 0–4°C | — | — |
| 20 | الفسائل offshoots | Mar–Apr + Sep–Oct | rooted, 3–5 yr attached, 10–25 kg | 2 skilled/offshoot [1] | 20–30/palm lifetime; revenue line |
| 21 | Basin/weeding/mulch | monthly | maintenance | n/p | shallow near roots |

**Planning backbone [2+]:** ~8–10 crown visits/palm/season. **Key data gap:** palms-per-worker-per-day norms for pruning/thinning/bagging/harvest are unpublished anywhere — the farm's own captured data can become the industry benchmark. (Also: FAO Ch.XI's Jul–Sep pollination line is a known contradiction — spring/spathe-triggered is correct.)

## (c) Competitor ops-feature comparison

| Capability | Agworld | AgriWebb | Croptracker | Hectre | FarmQA | Farmable | Tend |
|---|---|---|---|---|---|---|---|
| Week view | list+season plan | **map-pins**+week list | plan-list | job dashboard | **map+cal+grid** | map-first | **calendar** |
| Task→worker | in-app WO | in-app+push | printable signed WO | **supervisor device + QR badge** | in-app, GPS-to-field | task sheet+GPS trace | checklist |
| Worker confirms | weather+qty+photo | done + 3 photos + GPS | applicator signature | badge scan = piece | auto spray record | GPS track | qty→inventory |
| REI/PHI | **hard-block option** (unique) | WHP livestock only | warn+color+email | auto WHP alert | warn banners | warn | none |
| Weather@apply | **auto + Delta-T** | no | semi-auto | on plan | manual | tank-mix calc | no |
| Seasonal generation | season plans | feed planner | spray templates | spray diary | follow-ups | programs | **crop plan→task chain** |
| Piecework/crew | none | none | QR+piece+top-up | **best-in-class** | none | time only | time only |
| Offline | **full** | yes | **yes** | yes | yes | in-field | weak |

**Read:** nobody combines per-plant granularity + hard-block + piecework + offline + Arabic. Nobody assigns work to named individual trees (Hectre reaches rows; Sentinel named vines is a vineyard niche; per-tree QR only in plantation ERP). **Farm OS's palm registry makes it uniquely positioned to be first.** NakheelLand (Gulf palm SaaS): per-palm tracking + weekly schedule but **zero labor/attendance/custody** — the labor layer is the open flank [1].

## (d) Top 8 recommendations (ranked, daily-use × differentiation)

1. Per-palm task ledger with per-palm done-state + multi-day carryover (pollination/harvest fit).
2. Supervisor-device + laminated QR palm/worker badges (zero worker phones).
3. Compliance-grade spray record auto-emitted at completion + per-farm warn|block toggle (market first).
4. REI/PHI ambient cross-module state (colored hawshas; harvest interception).
5. Template library seeded from §(b) with stage-anchored triggers + Egyptian commercial defaults + cultivar variants.
6. RPW recurring routes (fortnightly trap service, 45-day inspections, finding→injection task).
7. Piecework + daily-minimum top-up + printed Arabic work receipt.
8. Hawsha map as a third task lens colored by status.

## (e) Do-NOT-copy list (fails in low-connectivity/low-literacy MENA)

- Worker apps / per-user logins for field workers (Farmable/Traction/AgriWebb assume literate phone-owners) — use supervisor-device + tokens.
- GPS-trace-as-proof (needs continuous signal + worker phones).
- Abstract line icons / pure-white backgrounds (sun glare; low-literacy) — literal solid-fill illustrations, off-white surfaces.
- Compliance paperwork as a separate screen — emit on completion or it never happens.
- Cloud-only flows — offline+sync is table stakes for the grove.
- Deep menu trees (USSD/IVR lesson) — `/m` stays 1–2 taps to action.
- Text-heavy calendar/kanban as *worker*-facing (those are owner/manager lenses).
- FAO-2002 agronomic defaults (2–30× under real practice — visibly wrong to any farmer).

**Named gaps found:** no non-overridable PHI block exists anywhere (all warn) — Farm OS could be first · Egypt's APC pesticide registry has no API (UAE MOCCAE's directory is integration-friendly) · no Egyptian agri daily-wage/piecework app exists — open white space · palms/worker/day norms unpublished — benchmark opportunity.
