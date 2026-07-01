# RESEARCH — ground-truth ops workflow on Egyptian date-palm farms (2026-07-02)

*Web research (Arabic-first sources: job postings, day-in-the-life press, أنفار labor fieldwork, agronomy calendars, export-record requirements). **[2+]** multiple sources · **[1]** single · **[analog]** nearest analog, labeled. Direct inside-the-gate digital evidence is thin by nature — the biggest gaps are marked for the design-partner interviews. Feeds `OPS-PLAN-2026-07.md`.*

## (a) The as-is workflow: plan → dispatch → do → verify → pay

1. **PLAN — a season program, not a weekly plan.** The real artifact is the **annual month×operation×dose-per-palm table** (جدول خدمة النخيل / برنامج التسميد السنوي) [2+, published examples: agriceg, Kuwait PAAF, Saudi NCPD extension guide; forum threads literally requesting "a year table"]. Manager job ads phrase the job as running "برامج الري والتسميد" on **24-on/6-off residential rotations** [2+] — the owner is structurally absent. **No evidence of a written weekly plan anywhere**; best-supported model = annual program + **reactive daily dispatch**, with "the week" emerging only in campaign seasons (pollination, harvest). *(inference)*
2. **DISPATCH — the dawn muster, run on voice.** Casual labor gathers pre-sunrise at the village pickup (سوق الأنفار); the contractor (مقاول الأنفار) allocates crews and takes a per-head cut [2+ — Siyada fieldwork, Ultrasawt; common enough for a Dar-al-Ifta fatwa]. Inside the farm: verbal توزيع المهام [analog: Arabic JDs]. WhatsApp voice notes are the channel of record in Egyptian agriculture, **voice preferred due to illiteracy** [2+ extension-analog; intra-farm dispatch unverified — interview]. **Documented failure modes of verbal relay: wrong dose ("حروق النباتات"), forbidden tank mixes, wrong timing** [2+].
3. **DO — campaign work by specialist climbers.** Pollination: climber covers **40–60 palms/day**, 1♂:~20–25♀, hard receptivity window → 4,380 palms ≈ **75–110 climber-days inside the window** *(arithmetic)* — the year's most schedule-critical race [2+]. Harvest: the **طالع النخلة** is a scarce itinerant trade (migrates across governorates); preps+harvests 6–7 palms/day [2+]. **Selling on the tree (بيع على النخيل/ضمان) is a well-established alternative** that outsources the harvest problem to the trader (standing fatwas) [2+] → the harvest module must support "trader took block X" as a first-class outcome.
4. **VERIFY — cameras, drive-bys, the foreman's word.** Remote cameras are explicitly marketed to Egyptian/Gulf farm owners for verifying that "irrigation happened on schedule and work was completed" [2+ vendor evidence] — owners already pay for pixel-based verification. Paid remote-management services advertise "monthly report + weekly WhatsApp updates + visit every 3 weeks" [1]. Photo-as-proof over WhatsApp is an existing habit, unstructured [analog]. Quantity verification happens at the scale/crate count. *(inference)*
5. **PAY — cash daily wages, contractor commission, in-kind shares.** Day-cash via the contractor [2+]; piece-rate exists (per-crate picking [1, vegetable analog]; Tunisia per-box dates [analog]); climbers day-rate **+ in-kind date share** [2+]. No paper trail beyond the attendance sheet → wage disputes rest on the foreman's tally. *(inference)*

## (b) Paper-artifact inventory (mirror these, don't invent)

| Artifact | Evidence | Columns found |
|---|---|---|
| **كشف الحضور والانصراف** | ubiquitous Arabic templates (Daftra, EdaraHR) [2+, generic] | م · اسم العامل · الوظيفة · التاريخ · حضور · انصراف · ساعات · الحالة · التوقيع · ملاحظات (+ farm adds: contractor/crew, يومية) |
| **سجل الرش** (spray log) | **mandatory for export farms**; GlobalGAP 2-yr retention [2+ requirement] | التاريخ · الحوشة · المحصول · الآفة · المبيد (تجاري + مادة فعالة) · الجرعة · طريقة الرش · القائم بالرش · PHI |
| **سجل التسميد/الري** | same export-record family [2+] | التاريخ · القطعة · نوع السماد · الكمية للنخلة · الطريقة (program side = the month×op×dose table) |
| **سجل ترقيم وفحص النخيل** | MOA's RPW "10 commandments" recommend **numbering palms for traceable inspection** [2+; 45-day cadence Gulf analog] | رقم النخلة · تاريخ الفحص · حالة الإصابة · العلاج · إعادة الفحص → **officially validates the palm registry** |
| **دفتر العهدة + إذن صرف** | evidenced via fraud cases: storekeepers **forging farmer signatures on أذون الصرف** [2] | التاريخ · الصنف · الكمية · المستلم · التوقيع · المصرح — the forged-signature scandal is the exact hole in-app acknowledged issuance closes |
| **بيان الجمع / كشف القطف** (harvest tally) | **no public template found — REAL GAP; photograph at design partners** | likely: التاريخ · الحوشة · اسم الطالع · عدد النخيل · عدد الأقفاص · الوزن · الصنف · جهة الاستلام [1/analog] |
| **دفتر اليومية** (daybook) | Arabic farm-accounting apps position against it [2+] | date · description · in/out · party |

Competitive note: **NakheelLand** (Gulf palm SaaS) does per-palm tracking + weekly schedule + harvest reports but **no labor/attendance/custody** — the labor layer is the open flank [1].

## (c) 8 moments software wins WITHOUT adding friction

| # | Moment | Today | The win | Friction risk |
|---|---|---|---|---|
| 1 | Dawn muster head-count | foreman's memory / contractor's word | one-tap crew count per contractor (names optional), feeds wages + owner KPI | per-worker entry at dawn dies; count-first; offline |
| 2 | Morning dispatch | voice orders / WhatsApp voice note | confirm-not-compose from the season calendar; auto-generates the WhatsApp-shareable summary | **<60s or it loses to a voice note**; bridge WhatsApp, don't fight it |
| 3 | Spray order | verbal dose relay → documented burns | order carries product/dose/pest/PHI; blocks harvest until PHI passes; doubles as سجل الرش (export asset) | picklist with default doses — supervisor picks, never types |
| 4 | Pollination countdown | manager's memory + climber availability | spathe log per block → "N palms in window, M climber-days needed by [date]" | keep it block-level coarse, not per-palm data entry |
| 5 | Store issuance (العهدة) | paper إذن صرف — documented forgery mode | digital voucher, recipient taps to acknowledge; live custody balance; reconciles vs task consumption | storekeeper is threatened — position as protecting HIM from accusation |
| 6 | Harvest tally | pocket-notebook crate counts; pay disputes | crates per climber per block on one screen; auto piece-pay; "sold on tree to trader X" outcome | dirty hands, time pressure — big increment-only buttons, offline |
| 7 | Owner's evening "did it happen?" | drive-by, camera feed, chat-scroll | task closure requires geotagged photo (only on owner-flagged types); structured evening digest | photo-per-task becomes theater — flag selectively |
| 8 | Importing the agronomist's program | paper/PDF table, WhatsApp voice after visits | "season program" import matching the published table shape exactly → 12 months of draft tasks | the agronomist won't use the app; the manager transcribes once/season |

## (d) Rates found (EGP unless noted)

| Item | Rate | Source year |
|---|---|---|
| Organized ag labor (union placements) | 8–9k/month, 26–30d ×10h (≈300/day) + 500 transport | 2025 [2+] |
| General field day labor (Sharqia) | 70/day 9h (outdated floor) | 2021 |
| Palm climber, harvest (Aswan) | **350–450/day** by skill | recent [2+] |
| Palm climber (Delta/Qalyubia) | 150–300/day; harness ~170 | recent |
| Climber (Minya, older) | >100/day "by agreement" **+ in-kind date share** | 2021 |
| Pollination throughput | 40–60 palms/climber-day | [2+] |
| Harvest prep throughput | 6–7 palms/climber-day | [2+] |
| Pollination piece rate (EGP/palm) | **NOT FOUND — interview gap** | — |
| Contractor commission | per-head cut, unpublished | [2] |
| Picking piece rate | 8+ TND/box | Tunisia analog |

## (e) Additional design-partner interview questions (append to the guide in `RESEARCH-customer-demand-2026-07-02.md` §f)

1. «وريني توزيعة إمبارح» — was ANYTHING written before work started? (tests the reactive-dispatch hypothesis)
2. **Photograph every paper artifact in the farm office** — especially the harvest tally + custody book (no public template exists).
3. During pollination, who decides each morning which blocks get climbers — and how do they know which spathes opened?
4. What pollination piece rate (EGP/palm) and harvest rate (EGP/palm or /crate) did you pay last season?
5. When the agronomist visits, what physically changes hands — written program, WhatsApp after, or nothing? Cadence?
6. Ever had a spray go wrong (dose/mix/block)? Where did the instruction break — could anyone prove what was actually sprayed?
7. Seasonal workers: one contractor or several? Counted by name or head-count? Who disputes the count at pay time?
8. Sold on the tree vs harvested yourselves — what tipped it, and what records did the trader's crew leave?
9. What do you already photograph and send on WhatsApp, unprompted?
10. If the storekeeper were sick a week, could anyone else say what's in the store?

**Biggest evidence gaps to close in interviews:** intra-farm WhatsApp dispatch (near-certain, unverified) · real harvest-tally columns · pollination piece rates.
