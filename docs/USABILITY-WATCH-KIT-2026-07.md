# USABILITY-WATCH KIT — one hour watching real users (2026-07)

*The cheapest, highest-signal validation nobody has done: watch the actual farm manager and a supervisor use the live app on their own phones. Run BEFORE building Lane 1 — one hour of observation validates/kills half the OPS-PLAN priorities. Protocol below is ready to run; the Owner (or the manager himself, self-recorded) facilitates. Owner: Amr Ebeid.*

## Rules (read first)

1. **Their phone, their SIM, in the field or the farm office** — not your laptop, not WiFi, not over their shoulder pre-logged-in.
2. **Don't help.** Count every time you almost do — each one is a finding. Only rescue after 2 minutes of stuck.
3. Ask them to **think aloud in their own words** («قول اللي في دماغك وانت بتعمل»). Record screen+voice if permitted (phone screen-record is fine).
4. One session per person, ≤30 min each. Manager + supervisor minimum; storekeeper if possible.
5. Log format per task: time-to-complete · completed? (yes/with-help/no) · wrong turns · what they SAID · Arabic terms THEY used for things (vocabulary harvest).

## Session A — the supervisor/field user (المشرف) — on /m

| # | Task (say it in Arabic, exactly) | Watch for |
|---|---|---|
| A1 | «افتح النظام وشوف شغلك النهارده» | Login friction (password entry on phone!), finds /m buckets? understands مهامي فقط toggle? |
| A2 | «سجّل إنك خلصت العملية دي» (pick a real due op) | ExecuteForm: do the prefilled quantities make sense to him? Does he change them or trust them? The qty units — does he speak in شيكارة/جركن while the app says kg/L? |
| A3 | «العملية التانية مش هتتعمل النهارده — الطلمبة بايظة. سجّل ده» | **There is no button for this** (known gap L0-3). Watch what he tries. His improvisation = the design. |
| A4 | «امبارح رشّيتوا حوشة ٣ — إمتى ممكن حد يدخلها تاني؟» | Does he find/understand the REI/PHI banner? Does the concept exist in his head at all? |
| A5 | Airplane mode ON, then: «سجّل عملية» | What does he think happened when it fails? Does the Arabic error make sense? (Validates the offline-outbox priority.) |

## Session B — the manager (مدير المزرعة) — planning

| # | Task | Watch for |
|---|---|---|
| B1 | «اعمل خطة الأسبوع الجاي: ريّ لحوشة ٥ يوم التلات» | **He cannot scope to a hawsha** (known L0-1) — does he notice? What does he do instead? |
| B2 | «نفس العملية دي عايزها تاني الخميس» | No duplicate action (L0-4) — count his clicks re-authoring. |
| B3 | «مين فاضي الخميس؟» | Workload invisible (gap #10) — where does he look? (Probably: his head. Ask what he'd need to see.) |
| B4 | «الدنيا هتمطر بكرة — أجّل عمليات بكرة كلها» | No reschedule (L0-2) — his reaction is the priority evidence. |
| B5 | «وريني إيه اللي اتعمل فعلاً الأسبوع اللي فات وإيه اللي وقع» | PvA/dashboards: can he find it? Does "slipped" even render? |
| B6 | End: «لو النظام ده هيعمللك حاجة واحدة بس كل يوم الصبح — تكون إيه؟» | The dispatch-screen hypothesis test, in his words. |

## Session C — the storekeeper (أمين المخزن) — optional but valuable

C1 receive a delivery («وصلك ١٠ شكاير سماد من المورد — سجّلهم») — does he find /inventory receiving from a phone (known: no phone surface, F6)? C2 «حد عايز ياخد ٢ جركن مبيد دلوقتي — اعمل إيه؟» (no ad-hoc issue flow — watch the improvisation). C3 «لو المالك سألك دلوقتي: عندك قد إيه بوتاسيوم؟» — time-to-answer.

## Vocabulary harvest sheet (fill during all sessions)

App term → what THEY said: عملية → ? · حوشة → ? · مخزون → ? · عهدة → ? · تنفيذ → ? · خطة → ? (feeds the Arabic-register review; the UI has never been checked against field vocabulary).

## Output → decisions

Write one page: top 5 observed failures (with timestamps), the vocabulary deltas, and a KEEP/KILL/RE-RANK verdict on: offline outbox (F1) · dispatch screen (L1-1) · reschedule/cancel (L0-2/3) · scope picker (L0-1) · duplicate-op (L0-4) · storekeeper surface (F6). File as an issue; it re-ranks the ops lanes with evidence instead of inference.
