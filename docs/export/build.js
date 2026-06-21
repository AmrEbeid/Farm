const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, LevelFormat, TableOfContents, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak } = require("docx");

const GREEN = "236138", GREEN_D = "11301B", GOLD = "C8922A", GREY = "6B7D72", LINE = "CCD6CD", HEAD_BG = "E6F3EA";
const CW = 9360; // content width US Letter 1" margins

// ---- helpers ----
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P = (t, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: typeof t === "string" ? [new TextRun(t)] : t, ...opts });
const lead = (label, t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: label + " ", bold: true, color: GREEN }), new TextRun(t)] });
const B = (t) => new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 40 }, children: typeof t === "string" ? [new TextRun(t)] : t });
const N = (t) => new Paragraph({ numbering: { reference: "n", level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] });
const space = (a = 120) => new Paragraph({ spacing: { after: a }, children: [new TextRun("")] });
const pb = () => new Paragraph({ children: [new PageBreak()] });

function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const mk = (text, w, opts = {}) => new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: opts.head ? { fill: HEAD_BG, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 }, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: String(text), bold: !!opts.head, size: opts.head ? 18 : 18, color: opts.head ? GREEN_D : "18241D" })] })]
  });
  const headRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => mk(h, widths[i], { head: true })) });
  const bodyRows = rows.map(r => new TableRow({ children: r.map((c, i) => mk(c, widths[i])) }));
  return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: widths, rows: [headRow, ...bodyRows] });
}
const callout = (t) => new Paragraph({
  spacing: { before: 80, after: 160 }, shading: { fill: "F4E6C8", type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: GOLD, space: 8 } },
  children: [new TextRun({ text: t, italics: true, size: 19, color: "7A5A13" })]
});

const styles = {
  default: { document: { run: { font: "Arial", size: 20, color: "18241D" } } },
  paragraphStyles: [
    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal",
      run: { size: 56, bold: true, color: GREEN_D, font: "Arial" }, paragraph: { spacing: { after: 120 } } },
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 30, bold: true, color: GREEN, font: "Arial" }, paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 24, bold: true, color: GREEN_D, font: "Arial" }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 21, bold: true, color: GREY, font: "Arial" }, paragraph: { spacing: { before: 140, after: 60 }, outlineLevel: 2 } },
  ]
};
const numbering = { config: [
  { reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
  { reference: "n", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
]};

// ================= COVER =================
const cover = [
  new Paragraph({ spacing: { before: 1800, after: 0 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "🌴", size: 96 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 0 }, children: [new TextRun({ text: "Farm Operating System", bold: true, size: 60, color: GREEN_D })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "نظام تشغيل المزارع", bold: true, size: 40, color: GREEN, rightToLeft: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "Product Master Plan, Build Spec & Operational Readiness", size: 24, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: "Arabic-first planning, stock-coverage & budget control for date-palm and fruit farms", italics: true, size: 19, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 6 }, bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 6 } }, spacing: { before: 200, after: 200 }, children: [
    new TextRun({ text: "Design partner & reference tenant: ", size: 19 }), new TextRun({ text: "Ebeid Farm (مزارع عبيد)", bold: true, size: 19, color: GREEN }) ]}),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: "Version 1.0  ·  June 2026", size: 19 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: "Owner: Amr Ebeid", size: 19 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Governed under the AI Project Operating System v3", size: 17, italics: true, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400 }, children: [new TextRun({ text: "CONFIDENTIAL — for the Owner, design-partner farms, and prospective partners", size: 16, color: GREY })] }),
  pb(),
];

// ================= TOC =================
const toc = [ H1("Contents"), new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }), pb() ];

// ================= CONTENT =================
const body = [];

// 1. Executive Summary
body.push(H1("1. Executive Summary"));
body.push(lead("The product.", "An Arabic-first, multi-tenant Farm Operating System that connects a forward operations plan to live stock-coverage intelligence, budget-gated approvals, people/responsibility, and a tree-level activity history — for medium and large date-palm and fruit farms in Egypt and MENA."));
body.push(lead("The promise.", "Plan the season, control the budget, track every palm, and never lose a farm record again. (خطّط الموسم، راقب الميزانية، وتتبّع كل نخلة.)"));
body.push(lead("The wedge (validated by research).", "No competitor combines stock-coverage-vs-plan run-out forecasting + Arabic/RTL + tree-level records + budget-gated approvals. Conservis proves farms pay for plan + budget + inventory (English, row-crop); FarmERP and Zr3i prove Arabic and date-palm demand (no planning-intelligence core). This product sits in the intersection; Arabic, tree-level and approvals form the moat."));
body.push(P("The headline loop, and the single most defensible feature, is: a plan drives a live stock-coverage forecast (“at the current plan you run out of potassium sulphate in 4 days — inside your 5-day supplier lead time; order 300 kg today”), which gates a purchase request against the budget through an Arabic-native, mobile, offline-tolerant approval workflow."));
body.push(lead("Who it is for.", "Owner-managed farms with the Ebeid profile: an owner, a manager, an agri-engineer, an accountant, supervisors and a storekeeper; multiple sectors; running today on Excel, paper and WhatsApp. Ebeid Farm (5 sectors, 28 hawshat, 4,380 Barhi palms + 299 males, mixed crops, 7 years of records) is the design partner."));
body.push(lead("Where we are.", "Deep market/technical/customer research is complete; the product, data model, UX, GTM, an MVP-0 build spec, screen map, user stories, acceptance tests and operational readiness are all documented; three interactive prototypes exist. No production code is built yet. The next step is a small, validated MVP-0 pilot, not a full ERP."));

// 2. Market & Strategy
body.push(H1("2. Market & Strategy"));
body.push(H2("2.1 The competitive white-space"));
body.push(P("Across 25+ products, capabilities cluster into the common (mapping, weather, mobile, inventory, planning), the rare (tree-level records, purchase-approval workflow) and the almost-absent. The two almost-absent capabilities are exactly our wedge:"));
body.push(table(
  ["Capability", "Scarcity across the market", "Who has it"],
  [
    ["Field/block mapping, weather, mobile, inventory, planning", "Near-universal", "Most tools"],
    ["Real accounting; budget + variance", "ERP-class only", "FarmERP, Traction, AgriERP, ERPNext, Odoo"],
    ["Tree / plant-level records", "Rare", "Croptracker, Phytech (sensors)"],
    ["Purchase-request approval workflow", "Rare", "ERP-class + Conservis POs"],
    ["Stock-coverage-vs-plan run-out forecasting", "Almost nobody (Conservis flags shortages reactively)", "— the wedge"],
    ["Arabic / RTL", "Almost nobody", "FarmERP, Zr3i, some Odoo/ERPNext"],
  ], [3400, 3360, 2600]));
body.push(callout("Conclusion: nobody combines forward stock-coverage intelligence + Arabic + tree-level + budget-gated approvals. That intersection is the product."));
body.push(H2("2.2 Egypt / MENA opportunity"));
body.push(B("Egypt is the world’s #1 date producer (~1.8M tonnes/yr, ~19–20% of global output; ~16M+ palms) yet exports only ~3% of world date exports — a quality/traceability/yield gap a Farm OS can attach to."));
body.push(B("Government tailwind: FAO + Ministry of Agriculture ICT-extension with date palm + citrus as named pilot themes; UNDP/SAIL programs; Gulf MEWA/PIF agritech push."));
body.push(B("Connectivity reality: ~98% LTE coverage but a 21-point urban–rural gap — design offline-tolerant and voice/photo-friendly capture."));
body.push(H2("2.3 Top customer pains (ranked)"));
body.push(P("From reviews, aggregators and the McKinsey adoption survey (Arabic-specific pains to be confirmed in pilot interviews):"));
[["Steep onboarding → abandonment", "the #1 churn cause industry-wide"],
 ["No Arabic / RTL field experience", "disqualifies incumbents for this buyer"],
 ["Tedious data entry; weak mobile / not field-real", "supervisors won’t use it"],
 ["Weak, rigid, non-exportable reporting; no cost-per-block", "owners can’t see profit per sector"],
 ["No tree/block-level records for perennials", "structural gap for date palms"],
 ["Lost pest/disease (RPW) follow-up", "validated by Palmear existing for RPW alone"],
 ["Stock leakage / missed expenses / unclear responsibility / weak budget control", "the daily operational pain"]
].forEach(r => body.push(B([new TextRun({ text: r[0] + " — ", bold: true }), new TextRun({ text: r[1] })])));

// 3. Product
body.push(pb(), H1("3. The Product"));
body.push(H2("3.1 The nine pillars (+ AI)"));
body.push(table(["Pillar", "What it does"], [
  ["1. Planning", "Weekly/monthly/quarterly/annual operation plans at palm/tree level"],
  ["2. Stock Coverage (the wedge)", "Forward run-out forecasting vs the plan; reorder & purchase recommendations"],
  ["3. Budget & Approvals", "Budget by farm/sector/crop/category; budget-gated purchase requests; owner approval"],
  ["4. People & Responsibility", "One part ↔ many responsible people; auto-routing of alerts"],
  ["5. Palm/Tree Mapping", "Grid + GPS + croquis; per-palm code, status, file"],
  ["6. Activity & Follow-up Files", "Every event rolls up palm → line → hawsha → sector → farm"],
  ["7. Weather Intelligence", "Operation-vs-weather gating (spray/pollinate/harvest, heat stress)"],
  ["8. Care Academy", "Age-based care + disease library (RPW-first), tied to the plan"],
  ["9. Accounting & Reports", "Expenses/sales/vouchers; cost allocation; P&L by farm/sector/crop/operation"],
  ["+ عبدالجليل (AI)", "Permission-aware assistant grounded in farm data; named after Ebeid’s farm manager"],
], [3000, 6360]));
body.push(H2("3.2 Personas & jobs-to-be-done"));
body.push(table(["Persona", "Primary job-to-be-done"], [
  ["Owner", "See profit per block; approve spending; spot risks remotely; prevent leakage"],
  ["Farm manager", "Plan operations; assign people; track execution & delays; monitor stock/labor"],
  ["Agri-engineer", "Plan care; track disease/treatment; link advice to palm age"],
  ["Accountant", "Record & allocate expenses; vouchers; budgets; exportable reports"],
  ["Supervisor", "Know today’s work; record done/issues on mobile; request materials; photos"],
  ["Storekeeper", "Know stock; reserve for plans; record in/out; reorder alerts"],
], [2400, 6960]));

// 4. MVP-0
body.push(pb(), H1("4. MVP-0 Build Spec (the first build)"));
body.push(callout("MVP-0 is the proof-of-value prototype — deliberately smaller than the full MVP. It answers one question before investing in the full ERP: will farms actually use planning + stock coverage + farm files?"));
body.push(H2("4.1 Goal & hypotheses"));
body.push(P("Prove the wedge loop end-to-end on one reference tenant (Ebeid): plan a month → see stock coverage → hit a budget gate → draft a purchase request → record the operation → see planned-vs-actual in the farm file."));
body.push(B("H1 — a manager will build a monthly plan in the tool instead of paper/WhatsApp."));
body.push(B("H2 — the stock-coverage forecast changes a purchasing decision (catches a shortage early)."));
body.push(B("H3 — the farm/palm file is something the owner/engineer opens repeatedly."));
body.push(B("H4 — an owner confirms willingness to pay a setup fee after seeing it."));
body.push(P("If H1–H4 do not hold in the pilot, we do not build the full ERP yet.", { children: [new TextRun({ text: "If H1–H4 do not hold in the pilot, we do not build the full ERP yet.", bold: true })] }));
body.push(H2("4.2 MVP-0 scope (14 screens)"));
body.push(P("Login + role; Owner & Manager dashboards (lite); Supervisor mobile home; Farm map/structure; Farm/Sector/Hawsha/Palm file; Monthly plan; Operation builder; Operation execution form (mobile); Inventory list; Stock-coverage screen; Budget-check screen; Purchase-request draft; Planned-vs-actual report."));
body.push(lead("Excluded from MVP-0:", "full payroll, full accounting, AI assistant, full weather engine, full academy, production billing, advanced multi-tenant customer management, export/traceability, sales CRM, offline sync (drafts only), native app."));
body.push(H2("4.3 The core workflow (must work end-to-end)"));
[ "Manager opens the monthly plan for الحصوة → Operation Builder → adds a potassium fertilization (needs 500 kg next week, est. cost 42,000).",
  "System runs plan checks: stock ⛔ shortage, budget ⚠ low, weather/labor/responsibility ✅.",
  "Manager opens Stock Coverage → available 300, coverage ~4 days < 5-day lead → shortage; recommends ~300 kg, order today.",
  "Manager/storekeeper creates a Purchase Request (draft) linked to the shortage; reserves 500 kg (available drops, on-hand unchanged).",
  "Budget Check shows the fertilizer category over its comfort threshold → routes to owner approval.",
  "Owner approves (writes the audit log; WhatsApp link).",
  "Storekeeper records the receipt; supervisor logs the actual operation on mobile with a photo and marks it done; inventory issues and cost allocates.",
  "Farm/palm files update automatically; the Planned-vs-Actual report shows the variance."
].forEach(s => body.push(N(s)));

// 5. Acceptance tests sample
body.push(H2("4.4 Acceptance tests (sample — the check suite)"));
body.push(P("Every critical feature ships with executable Given/When/Then tests; the engine is never weakened to make a test pass. Examples:"));
body.push(table(["Feature", "Given / When / Then"], [
  ["Stock — covered", "Given stock 100, reserved 20, planned 50 → available 80, operation covered, remaining 30"],
  ["Stock — shortage", "Given stock 40, planned 70 → blocked by stock; recommend ≥ 30 + safety stock; order today if coverage < lead time"],
  ["Budget gate", "Given available 60,000 and a 42,000 plan in a category at 87% → approval-needed; PR cannot leave draft without owner approval"],
  ["Tenant isolation", "A user in org A querying any table returns only org A rows; an org B id returns zero rows"],
  ["Farm-file rollup", "An operation on palm #2481 appears in the palm, line, hawsha, sector and farm files"],
  ["Financial correction", "An approved record is never silently edited; corrections create a reversing entry; deletes are soft/reversed"],
], [2200, 7160]));
body.push(H2("4.5 Pilot validation gates"));
body.push(P("MVP-0 is a PASS only if ≥ 5 of 7 hold: 5 farms interviewed; 2 share real data; 1 builds a monthly plan unaided; 1 validates the stock-coverage workflow; 1 owner confirms willingness to pay; 1 accountant confirms the reports are useful; 1 supervisor confirms the mobile flow is easy (<60s). If fewer than 5 pass, pause — do not start the full MVP."));

// 6. Roadmap & risk
body.push(pb(), H1("5. Roadmap & Risk-Tiered Stages"));
body.push(P("The build runs through the AI Project Operating System: each stage is scored on impact × probability × reversibility (highest tier wins) and earns the evidence, review and rollback its tier requires. Stages never advance automatically; the Owner gates each one."));
body.push(table(["Stage", "Risk", "What & why the tier"], [
  ["0 Security remediation & data cleanup", "Critical/High", "Rotate exposed key, purge secret, reconcile counts, split owner drawings — live breach surface"],
  ["MVP-0 Proof-of-value pilot", "Low/Med", "The wedge loop on one reference tenant; validates H1–H4"],
  ["1 SaaS foundation (orgs/RLS/roles/audit)", "High", "RLS bugs = cross-tenant data leak"],
  ["2 Structure + palm registry import", "Medium", "Real data import; reversible"],
  ["3 Activity/event model + operations", "Medium", "The asset+event+quantity spine"],
  ["4 Planning workspace", "Low/Med", "Internal logic/UI"],
  ["5 Inventory + stock-coverage engine", "Medium", "The wedge; checks-first"],
  ["6 Budget + approvals + purchase requests", "High", "Approval/entitlement logic"],
  ["7 Accounting (expenses/sales/vouchers)", "High", "Financial integrity"],
  ["8 People & labor/payroll", "High", "PII / regulated data"],
  ["9 Weather integration", "Medium", "External API = untrusted content + key"],
  ["10 Care Academy content", "Med/High", "Agronomy liability → expert sign-off"],
  ["11 AI assistant عبدالجليل", "High", "Lethal-trifecta control required"],
  ["M Real-data migration", "High", "Real financial/PII data"],
  ["P Production deploy", "Critical", "Staged rollout + rollback + post-apply evidence"],
], [3300, 1500, 4560]));

// 7. Architecture
body.push(pb(), H1("6. Architecture & the Stock-Coverage Engine"));
body.push(P("Stack: Next.js + Supabase (Postgres + PostGIS + Auth + Storage + Realtime + RLS) + Vercel. Arabic-RTL-first, mobile/offline-tolerant PWA. Heavy logic (the stock-coverage simulation, budget checks) runs in Postgres functions close to the data; the AI and any secret-bearing call are server-side only."));
body.push(H2("6.1 The data spine: Asset + Event + Quantity"));
body.push(P("Adopted from farmOS’s proven triad: thin assets (palms, equipment, materials) hold almost no history; an append-only event log carries every dated event; quantities hang off events. One event status (planned → reserved → done) makes plan, reservation and actual the same row at different stages — which is exactly what the stock-coverage simulation iterates over. Multi-tenancy is enforced in Postgres Row-Level Security (org_id on every table, deny-by-default), never only in the app layer."));
body.push(H2("6.2 The stock-coverage engine (the wedge), in plain terms"));
body.push(B("Available = on-hand − reserved − expired."));
body.push(B("Reorder point = demand during lead time + safety stock; safety stock = Z × σ × √lead-time (Z = 1.65 at 95% service)."));
body.push(B("Coverage = available ÷ planned consumption rate; projected stock-out = today + coverage; flag when coverage < lead time."));
body.push(B("Projected balance per period = previous − planned issues + expected receipts; flag the first period that goes negative; the shortfall drives the recommended purchase quantity."));
body.push(callout("Worked example: on-hand 300 kg, plan needs 500 kg next week, 5-day lead, 95% service → safety stock ~74 kg, shortage 200 kg in week 1, coverage ~4 days < 5-day lead → recommend ordering ~300 kg today. (نقص متوقّع: 200 كجم الأسبوع القادم — اطلب 300 كجم اليوم.)"));

// 8. Operations & readiness
body.push(pb(), H1("7. Operational & Commercial Readiness"));
body.push(P("The implementation layer that makes this sellable and trustworthy, summarized:"));
body.push(table(["Area", "Policy"], [
  ["Data import / onboarding", "Staging → validate → dedupe → owner-approve → commit → reconcile → rollback-able batch. Part of the paid onboarding."],
  ["Offline / weak internet", "Drafts (operations, issues, photos, stock requests, inspections) sync on reconnect; approvals, financial & stock posting, permissions and AI require a connection."],
  ["Photos & attachments", "Private buckets, path {org_id}/..., signed URLs, compression, size/type limits, soft-delete only, sensitive docs limited to accountant/owner."],
  ["Financial corrections", "Draft editable; approved records never silently edited; corrections are reversing entries; deletes are soft/reversed; every change audited."],
  ["Data export & deletion", "Full-tenant export (JSON/CSV/Excel/PDF/media); deletion honored within 30 days; customer owns the data (processor, not owner)."],
  ["Backup & DR", "Daily DB backup + PITR; nightly storage backup; monthly restore test; fresh backup before deploy and migration; incident runbook + kill-switch."],
  ["Weather provider", "Open-Meteo primary (free, MENA coverage) + paid fallback; 1–7 days operational, monthly+ planning-estimate only; treated as untrusted input."],
  ["Agronomy ownership", "Named agronomist authors; qualified reviewer signs off; versioned, region-tagged, last-reviewed dated; pesticide doses only from registered Egyptian products."],
  ["Templates", "Operation/care/spray/fertilization/approval/budget/stock/responsibility/report templates; global seed + customer overrides; versioned."],
  ["Support & onboarding ops", "Onboarding checklist, Arabic training, WhatsApp support, data-migration service, monthly review, success dashboard, SLA, bug/feature flows."],
  ["Legal / privacy", "Privacy policy, ToS, DPA, data-ownership statement, no-training-on-customer-data, Egypt PDPL (Law 151/2020) alignment."],
  ["Performance & scale", "Targets: 50,000 palms, 100 users, 500,000 events/yr per org; event table partitioned by month + BRIN; materialized stock snapshot."],
], [2600, 6760]));

// 9. GTM & pricing
body.push(pb(), H1("8. Go-to-Market & Pricing"));
body.push(P("Sell control, not software: “we help farms plan operations, control stock and budget, assign responsibility, and keep a full history for every farm part and palm.” Lead with the wedge — tell us your plan, we tell you what you’ll run out of and what to buy, before you’re short in the field."));
body.push(H2("8.1 Pricing posture"));
body.push(P("Per-farm in EGP (not per-seat — per-seat punishes the multi-persona team and reads badly in MENA), with a free entry tier for land-grab and a productized paid onboarding capped at ~15% of year-one value. Treated as a hypothesis to confirm in pilot interviews."));
body.push(table(["Tier", "Includes", "Indicative EGP/mo"], [
  ["Core", "Structure, palm registry + grid map, operations log, expenses, sales, basic reports, 3–5 users", "1,500–3,000"],
  ["Pro (main)", "+ planning, stock-coverage, budgets + approvals, purchase requests, farm/palm files, weather, accountant exports, 10–25 users", "4,000–8,000"],
  ["Enterprise", "+ multi-farm, advanced permissions, export/packhouse traceability, AI assistant, custom reports, API", "10,000–30,000+"],
], [1700, 5660, 2000]));
body.push(P("Setup/onboarding (by farm size): Small 15,000–30,000 · Medium 30,000–75,000 · Large 75,000–200,000+ EGP. Anchor to a ≥3:1 ROI story (leakage recovered + yield/quality uplift + offshoot revenue captured)."));
body.push(H2("8.2 Go-to-market motion"));
body.push(B("Phase 1 — design partners: Ebeid + 2–4 similar farms, in exchange for feedback, a case study and the Arabic customer-voice interviews."));
body.push(B("Phase 2 — channel: agronomist/consultant seats that pull farms onto the platform; co-ops and export companies wanting traceable supply."));
body.push(B("Phase 3 — institutional: FAO/MoALR extension and Gulf MEWA/PIF programs; integrate (don’t fight) point-solutions — be the book-of-record they plug into."));

// 10. Governance
body.push(pb(), H1("9. Governance & How We Build Safely"));
body.push(P("The build is governed by the AI Project Operating System: the Owner decides and gates every change; a planning tool plans and writes execution prompts; an execution tool works inside a defined scope and reports with evidence; an independent reviewer (never the author) checks every high-risk change; an apply layer handles deploys/migrations/sends with server-enforced limits and rollback."));
body.push(H2("9.1 Enforced controls (not requested)"));
body.push(B("Tenant isolation via Row-Level Security, deny-by-default; org_id indexed; cross-tenant test must return zero rows."));
body.push(B("Secret scanning blocks a leak before commit (a live exposed credential was already found and is the first remediation)."));
body.push(B("Server-side approval gate for money/irreversible/deploy actions; only the owner role can approve."));
body.push(B("The AI assistant gets read-only, RLS-scoped functions only — no raw data, no mass outbound — so it never holds the lethal trifecta (private data + untrusted input + outbound send)."));
body.push(B("Agronomy numbers are editable templates requiring an agronomist + Egyptian pesticide-registration sign-off before they are authoritative."));
body.push(B("Real financial/PII data never enters a third-party model without a privacy review; migration is a gated, evidence-first stage."));
body.push(H2("9.2 Definition of Done (per stage)"));
body.push(P("Code complete · acceptance tests written-first and passing (evidence attached) · RLS verified · Arabic-RTL checked · mobile checked · audit events written · no secrets committed · owner reviewed and gated · independent reviewer approved (High/Critical) · tracker/spec/session updated · rollback path documented."));

// 11. Next steps
body.push(pb(), H1("10. Immediate Next Steps"));
[ "Owner: approve Stage 0 (security remediation + data cleanup) — the only Critical-priority item.",
  "Owner: sign off the canonical palm count (4,380 / 299 / 28 hawshat) and sector labels.",
  "Run the 5-farm pilot interviews and validate EGP pricing & setup-fee willingness (closes the research gap and the MVP-0 hypotheses).",
  "Engage a local agronomist for the Care Academy + Egyptian pesticide-registration sign-off.",
  "Lock the data model (asset + event + quantity + org RLS) as ADR-0001.",
  "Build the stock-coverage engine first (checks-first) to prove the wedge.",
  "Build the MVP-0 loop end-to-end on the Ebeid reference tenant.",
  "Stand up the independent-reviewer practice for every High/Critical gate.",
].forEach(s => body.push(N(s)));
body.push(space(200));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 6 } }, spacing: { before: 200 }, children: [new TextRun({ text: "The planning tool plans and protects the work. The execution tool executes inside its scope. The Owner decides. Controls are enforced, not requested.", italics: true, size: 19, color: GREEN })] }));

// ================= ASSEMBLE =================
const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } }, children: [new TextRun({ text: "Farm OS — Product Master Plan", size: 16, color: GREY })] })] });
const footer = new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } }, children: [
  new TextRun({ text: "CONFIDENTIAL", size: 15, color: GREY }),
  new TextRun({ text: "\tPage ", size: 15, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 15, color: GREY }),
  new TextRun({ text: " of ", size: 15, color: GREY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: GREY }),
], tabStops: [{ type: "right", position: 9360 }] })] });

const doc = new Document({
  styles, numbering, creator: "Farm OS", title: "Farm OS — Product Master Plan",
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: header }, footers: { default: footer },
    children: [...cover, ...toc, ...body],
  }]
});
Packer.toBuffer(doc).then(buf => { fs.writeFileSync("Farm-OS-Master-Plan.docx", buf); console.log("WROTE Farm-OS-Master-Plan.docx", buf.length, "bytes"); });
