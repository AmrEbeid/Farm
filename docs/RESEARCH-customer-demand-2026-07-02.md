# RESEARCH — customer demand side: who buys Farm OS and why (2026-07-02)

*Web research, EN+AR sources, 2023–2026 preferred. Confidence: **[2+]** ≥2 independent sources · **[1]** single source · **[inf]** labeled inference. Honesty note: formal pains (pests, inputs, export) are well-sourced; the informal pains the product bets on (leakage, absentee-owner control) are structurally under-documented — real cases end in private reconciliation (صلح), not press archives. That asymmetry is why the design-partner interviews (§f) matter most. Feeds `BOOM-PLAN-2026-07.md` §2–3.*

## (a) Personas

| Role | JTBD | Core fear | What wins them |
|---|---|---|---|
| **Owner** (absentee, diversified businessman; a whole plant-and-manage industry exists because he's expected NOT to farm [2+]) | "See and control my money from Cairo/Riyadh" | Being stolen from at distance — his current instruments: farm-management POA (توكيل بإدارة مزرعة) with big commitments **reserved to his written approval** [1], watchdog site accountants, surprise counts | A **trust instrument, not a farm tool**: budget-gated approvals + variance/run-out alerts = the digitized POA. Pitch in EGP/ton and % leakage caught, never agronomy features |
| **Farm manager** (runs the calendar AND the cash; ~10–20k EGP/mo EG, ~19k SAR/mo KSA [2+]) | "Prove I ran the season right and handled the money clean" | Missing an irreversible window (pollination ~4 weeks; Barhi must sell at khalal) [2+ facts]; being *suspected* of skimming (he's operator + treasurer) [inf]; RPW on his watch [2+] | **The system as his alibi** — timestamped completion + clean custody settlement = protection from suspicion, not surveillance. He is the make-or-break adoption node |
| **Agronomist** (resident role on New Valley farms, housing included [2+]) | "Catch the outbreak early; prove I follow the program" | A visible outbreak with his name on it (KSA makes early RPW reporting an obligation) [2+ env] | Scouting/spray records proving diligence; tree-level history as his professional record |
| **Accountant** (mega-farms recruit resident site accountants [2+]) | "Settle every عهدة clean; explain every variance before the owner asks" | Unexplained variance lands on him first [inf] | Custody accounting matching how he already works — **the عهدة screen is a first-class feature in every Arabic ERP (Orchida, Qoyod, Plugin-soft): direct validation that custody-cash is THE money primitive [2+]** — plus e-invoice-ready output |
| **Supervisor** (owns the handwritten attendance sheet + cash-envelope payroll — an information monopoly [1]) | "Get the crew through the season without blame" | Blame for shrinkage; digitized attendance removes his discretionary power — **the most likely quiet saboteur** [1+inf, thinnest evidence — validate in interviews] | Make HIS sheet the system of record he controls; crew-level accounts; near-zero typing |

## (b) Evidence-ranked pain list vs the product's bet

1. **Price realization / post-harvest / weak value chain [2+]** — Egypt #1 producer, ~2% exported; Barhi swings 3–4× intra-season. *Farm OS doesn't solve this — don't claim it.*
2. **Pests, above all RPW [2+]** — existential (kills the asset). *Adjacent (scouting), not core.*
3. **Input cost control [2+]** — fertilizer +564% (2015→22). ***Directly Farm OS territory** (coverage + approvals).*
4. Labor cost/scarcity [2+ KSA, 1 EG]. 5. Water [2+ macro; palm-tolerant [inf]]. 6. **Farm-management/planning [2+ as constraint, 0 as PAID category — no evidence anyone pays for planning software].** 7. Export/GlobalGAP records [2+ as gate, only for exporters — growing fast under the $250M strategy]. 8. **Theft/leakage/absentee control [1+inf]** — real pattern (insider harvest thefts 2026, New Valley farm-asset thefts, Qassim trading fraud [1]) but **zero published date-farm embezzlement cases** (informal-economy blind spot).

**Verdict on the bet** ("plan+coverage+budget-approvals = top pain"): **PARTIALLY SUPPORTED — wrong framing, right mechanism.** Planning is the weakest, least-funded pain; coverage + budget-gated approvals ride two real ones (input volatility [2+], leakage [1+inf]) and digitize instruments owners already buy. **Reposition as spend-control/anti-leakage for the absentee owner**, planning as the vehicle. The leakage thesis is the linchpin with no published confirmation → interview questions 1–2.

## (c) Top adoption barriers → mitigations

1. **Tax-fear/trust** — farmers refused Farmer-Card registration believing data = future tax (Deputy Ag Minister) [1]; formalization-fear is THE blocker (ILO/OECD) [2+] → sell as *internal control against cash fraud*; owner-controlled export; don't volunteer ETA integration until asked.
2. **Field digital literacy** — 20.3% rural illiteracy; CGIAR/IFPRI Egypt RCT: training raised uptake +20pp [1, high quality] → **white-glove onboarding IS the mitigation** (validates paid onboarding); only ~6–8 literate roles need full UI.
3. **Connectivity/power at desert sites** (New Valley towers still building; load shedding) [2+] → offline-first for field roles is a hard requirement.
4. **Seasonal cash flow** — harvest Aug–Oct; بدل advance-sale pre-commits the crop [1–2] → sell/renew **Sept–Dec**; harvest-aligned billing.
5. **Surveillance politics** — supervisor/manager sabotage risk [1 + 2+ global] → manager's-alibi framing; manager buy-in before owner announcement; interview Q7.
6. **Messy ground truth** — >15% holdings are frozen inheritance (حيازة ورثة) [2+] → tolerate fuzzy ownership, incremental data entry.
7. **Labor seasonality** — 200→1,000+ at harvest, informal, cash-paid [2+] → crew-under-supervisor model, never per-seat.
8. **Literacy floor below Arabic UI** [2+] → icons/photo/voice for supervisor tier.

## (d) Willingness-to-pay anchors

Agronomist FTE EG ~120–160k EGP/yr [2+] · farm manager EG ~128k [2] · accountant ~74k [2+] · **Daftra top tier 23.5k EGP/yr [2+]** (the local generic-ERP ceiling) · Odoo implementations 125–350k [1] · FarmERP ~$2,400+/yr [1] · GlobalGAP initial ~$7.5k [1] · ETA compliance spend 1–50k [1–2] · per-palm opex ~600–900 EGP/yr inflation-adjusted [inf on 2].

**For a ~4,000-palm farm [inf]:** 20–40k EGP/yr = **0.3–0.9% of opex, 0.1–0.3% of revenue, 2–4 months of one agronomist** — "less than one junior hire." 1.0–1.7× Daftra's ceiling, defensible IF the anti-leakage story lands (catching 1–2% leakage on a ~5M spend base pays 2–5×). KSA: 40k EGP ≈ 3,150 SAR — headroom to price 2–4× higher. Gaps to fill in interviews: Egypt GlobalGAP cost, consultant retainers, dealer markup %.

## (e) Buying triggers (evidence × urgency)

1. **Export coding (تكويد المزارع) [2+] — strongest, dated, external**: legal precondition for export, revocable, live enforcement; national $250M strategy = a wave of first-time exporters. Champion: commercial manager.
2. **Tax deadlines [DISPUTED — downgraded 2026-07-02]**: the "Egypt VAT/e-invoicing threshold cut to 250k EGP + 31 Mar 2026 deadline" claim failed independent verification (SEO-blog provenance; tier-1 vendors describe Resolution 281/2025 as a B2C e-receipt expansion). What stands [2+]: Egypt's e-invoicing/e-receipt system is expanding, wholesale B2B e-invoicing mandates already phased in, and KSA ZATCA Wave 24 (>375k SAR) integrates by 30 Jun 2026. Champion: accountant. **Use as a discovery question, not a fear pitch, until the accountant determination.**
3. **Expansion/new farm [2+]**: Toshka 2.3M-tree mega-farm; the target = the private second ring, greenfield, no paper legacy. Highest WTP, least behavior change.
4. **Financing/subsidy [2+ KSA]**: NCPD subsidies + ADF loans require the agricultural record — records literally gate money.
5. **Generational handover [2+ structural]**: software as the neutral ledger between heirs [inf].
6. **Theft/leakage incident [2+ pattern, 0 published cases]**: emotional, surfaces in sales conversations. The closer, not the ad.

Playbook: market on 1–2 (dated, legible), close on 6 (the wound), target 3 (greenfield) for friction-free wins.

## (f) The 10-question design-partner interview guide

*Interview owner and manager **separately** — their Q2/Q7 divergence is data. Ordered by assumption risk: A1 leakage ranking → A2 sabotage → A3 price band → A4 عهدة fit → A5 planning value.*

1. **[A1 unprompted ranking]** «لو معاك مبلغ تصرفه على حل مشكلة واحدة بس في المزرعة السنة دي — تحل إيه؟ وليه دي قبل غيرها؟» ثم ترتيب 7 كروت: سرقة/تسريب، سعر البيع، السوسة والآفات، أسعار مستلزمات، المياه، العمالة، سجلات التصدير. **Pass: leakage/control in the owner's top 2. If price/pests dominate → reframe.**
2. **[A1 critical incident]** «احكيلي عن آخر مرة اكتشفت فيها فرق بين اللي اتصرف فعلًا واللي كان المفروض يتصرف — فلوس، مخزن، أو محصول. اكتشفته إزاي، وحصل إيه بعدها؟»
3. **[A4 عهدة flow]** «إمشي معايا بالتفصيل: الفلوس بتوصل المزرعة إزاي؟ مين بيمسك العهدة، بتتقفل إزاي وكل قد إيه، ومين بيراجعها؟»
4. **[A4 approval gate]** «لو المدير محتاج يشتري سماد بـ100 ألف جنيه بكرة الصبح — إيه اللي بيحصل خطوة بخطوة من الطلب لحد ما الفلوس تتدفع؟ وفيه حد يقدر يشتري من غير ما يرجع لك؟»
5. **[A5 window pain]** «السنة اللي فاتت، هل فيه شغلانة حرجة اتأخرت عن وقتها — تلقيح، خف، تكييس، رش، جمع؟ كلفتكم إيه؟ ومين عرف بالتأخير إمتى؟»
6. **[coverage]** «آخر مرة حاجة خلصت من المخزن في وقت حرج — سماد، سولار، كراتين جمع — كان إمتى؟ وعرفتوا قبلها بقد إيه؟»
7. **[A2 surveillance — ask manager AND owner separately]** «لو نظام بيسجل كل مهمة وكل قرش اتركب بكرة — مين في المزرعة هيتضايق؟ ليه؟ وإيه اللي يخلي المشرف يسجل بصدق بدل ما يكتب اللي يريح؟»
8. **[A3 WTP anchored]** «بتدفعوا كام دلوقتي للمحاسب، للمهندس الاستشاري، لأي برامج أو دفاتر؟ ولو نظام وراك كل قرش بيتصرف وبينبهك قبل ما حاجة تخلص أو تتسرب — يستاهل كام في السنة؟» (their number FIRST, then react to 20–40k + onboarding fee)
9. **[trigger + timing]** «إيه اللي ممكن يخليك تشتري نظام زي ده السنة دي مش بعد سنتين؟ (تكويد للتصدير؟ الفاتورة الإلكترونية؟ حادثة سرقة؟ مزرعة جديدة؟ الولاد داخلين الشغل؟) — وإمتى في السنة بيبقى فيه سيولة تسمح بمصروف زي ده؟»
10. **[trust/data — ask LAST, it primes tax anxiety]** «بيانات فلوس المزرعة هتتخزن عند شركة على الإنترنت — إيه اللي يخليك مرتاح لده؟ وهل بييجي في بالك موضوع الضرائب لما تفكر في كده؟»

**Bottom line:** the evidence supports Farm OS as a **control/anti-leakage product sold to the absentee owner**, priced at 0.1–0.3% of revenue, sold on the 2026 export-coding + e-invoicing deadlines — but the linchpin (leakage outranks price and pests for this buyer) must be validated in interviews before doubling down.
