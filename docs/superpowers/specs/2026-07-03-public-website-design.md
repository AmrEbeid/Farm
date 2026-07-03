# SPEC — Ebeid Farm public website (`/`), OS-editable content

*Date: 2026-07-03 · Owner: Amr Ebeid · Author: Claude (brainstorming → spec)*
*Standing mandate this session: proceed on my own recommendations, don't wait for inputs.*

## 1. Problem & goal

Farm OS currently serves a thin unauthenticated landing at `app/page.tsx` ("Direction A —
The Registry") whose only job is a login link. Ebeid Farm is a **real, certified date
exporter** (GlobalGAP, China GACC, QCAP, CAPQ) and needs a **credibility website** that:

1. Tells the export story to **buyers/importers** (China, Gulf, Asia, EU) — certifications,
   supply reliability, specs, contact.
2. Is **balanced** (decision "C"): a real marketing site *and* a persistent employee
   **«تسجيل الدخول / Login»** into the Farm OS.
3. Has its **content editable from inside the OS** — an owner-only screen where the text,
   numbers, links, and images are changed without a code deploy.

Look = **premium export brand ("A")**: deep palm-green `#2e6b3e` + gold `#c79a3a` + cream
`#f7f4ec` (from the owner's `profile.html`), big type, cert badges front-and-centre; shares
the OS fonts (Readex/Tajawal) so the seam into `/login` is smooth. **Stitch MCP** is used to
generate the visual mockups/variants in this direction; the chosen direction is then built in
code on the app's own stack (Next.js + `@amrebeid/ui` + RTL).

**Non-goals (YAGNI):** no page-builder / arbitrary sections (fixed section set, decision
"1"); no blog/news; no e-commerce/cart; no multi-farm theming (single org for now); no
scenery photo gallery until the owner supplies real farm photos (rendered empty, never
fabricated — non-negotiable #1).

## 2. Content is REAL and sourced (non-negotiable #1)

Every figure/claim comes from owner-provided documents, not invented:

- **Brand:** مزرعة عُبيد للتمور / **Ebeid Farm** — Premium Fresh Barhi Dates. Registered
  export name on the official registries: **"Obaid Company for Dates" / شركة عبيد للتمور**
  (shown on the proofs so a buyer cross-checking the registry finds the match).
- **Location:** Abou Shalaby (سوادة/أبو شلبي), Faqous, El-Sharkia, Egypt 44641.
- **Stats:** ~115 feddans · ~4,380 Barhi palms · 202 tons approved (CN, 2025) · 5 blocks · 28 hawshat.
- **Blocks:** الـ22 فدان (22f, 7 hawsha, 948, 2018/2019) · الحصوة (30f, 8, 1,165, 2022/2025) ·
  حوض البابور (30.5f, 5, 1,485, 2023/2025) · الشفعة (9.5f, 4, 269, 2023) · الخطارة (23f, 4, 513, 2010–2024).
- **Supply/specs:** Fresh Barhi (Khalal) · 202 t CAPQ-approved · season Aug–Oct · packaging to
  buyer spec · air + reefer sea · destinations CHN/ARE/SAU/KWT/EU.
- **Contact:** Eng. Abdelglil Ebeid · ebeidfarm@gmail.com · +20 100 217 4773 · +20 121 014 1019.

### Certification proofs (real files, in `public/site/proofs/`)

| Proof | Detail | Live verification |
|---|---|---|
| **GlobalGAP** | GGN 4059883915303 · Cert 00151VPHHN0003 · HEIACert · IFA v6 SMART · valid → 2026-10-06 · 9.24 ha · ARE/CHN/EGY/EU/KWT/SAU | database.globalgap.org/search |
| **China GACC** | Obaid Company for Dates · Reg QEGY1425102400002 · overseas code 55.09.30.03.DAF · Fresh fruits/Dates · valid → 2999 | scintl.chinaport.gov.cn (APR company list) |
| **QCAP residue** | Cert Dokki-182904 · Barhi · EN 15662:2018 · clean (Hexythiazox 0.01 mg/kg) | Ministry of Agriculture Central Lab |
| **CAPQ farm approval 2025** | Code 55.09.30.03.DAF · Barhi · 202 t · destination China · issued 2025-08-27 | Egyptian Plant Quarantine |

**Excluded:** `certificate.pdf-20250619-…` provided in Downloads is a **DocuSign completion
for "ZEAL IO LTD — Grant to Yasmin Abdelmagid"** (Omar Ebeid / getzeal.io) — an unrelated Zeal
corporate document. It is NOT used on the farm site.

## 3. Architecture

- New **public route group** `app/(marketing)/page.tsx` renders `/` (unauthenticated, SSR).
  The old `app/page.tsx` is removed/replaced. `app/(app)/**` and `app/login/**` untouched.
- **Header:** brand + language toggle + persistent **«تسجيل الدخول / Login»** → `/login`
  (already wired into the OS). No auth changes.
- Same repo, same Vercel deploy, same domain (ebeidfarm.business). No new hosting.
- **Bilingual:** Arabic-primary (RTL) with an **AR⇄EN toggle** in the header; every editable
  field stores both AR and EN. Toggle chosen over both-inline (cleaner on screen).

### Sections (fixed set)

Hero (name + badges + Login) → About → Why Barhi → Production Blocks (table) → Supply & Specs
(table) → **Certifications & Proof** (badges + proof thumbnails + live-registry links) → Why
Partner → Contact (+ optional future scenery gallery, empty until photos exist).

## 4. The OS-editable content model (touches the DB — migration required)

### Table `public.site_content` (one row per org)

- `org_id uuid` (PK/unique per org), `updated_at`, `updated_by`.
- Typed columns for the small, stable fields (brand names, contact, stats), **plus JSONB**
  blocks for the repeating/structured parts (blocks table rows, specs rows, cert list,
  gallery image keys) — each stored as `{ ar, en }` where text is bilingual.
- **RLS + FORCE RLS, deny-by-default.** Standard Farm OS posture.

### Reads — PUBLIC (site is unauthenticated)

- `fn_get_site_content(p_org uuid)` — `SECURITY DEFINER`, `set search_path = ''`, returns
  **only** the whitelisted marketing fields (no sensitive columns, no other tables).
  `GRANT EXECUTE … TO anon, authenticated`. This is the ONLY anon-reachable surface; it
  exposes nothing but content the owner has explicitly published.
- Org resolution for MVP: single default org (env `NEXT_PUBLIC_SITE_ORG_ID` or the sole org),
  since there is one real farm. (Domain→org mapping is a later multi-tenant concern.)

### Writes — OWNER-ONLY

- `fn_save_site_content(p_org uuid, …payload)` — `SECURITY DEFINER`, guarded by
  **`authorize('site.write', p_org)`**, `REVOKE EXECUTE FROM public, anon`, `GRANT` to
  `authenticated` only. Server-side `fn_audit` trigger records the change.
- ⚠️ **`authorize()` re-emit footgun.** Adding `site.write` means re-emitting `authorize()`
  **from the current highest-numbered definition** carrying the FULL union of existing perms,
  and updating `tests/22` (INV-2 allowlist) + `tests/97` (permission-completeness). Re-emit
  from the wrong base silently drops perms — run the full pgTAP harness.
- Editor UI at `app/(app)/website/page.tsx`, nav label **«الموقع»** (owner/admin section),
  role-gated. A server action calls `fn_save_site_content`. Images upload to a public
  Supabase Storage bucket **`site-media`** (public read; owner-only write policy).

### Migration

- **One append-only migration** (next free number; check in-flight PR branches #632/#628 for
  collisions before assigning). Comment block: problem / intent / security / rollback.
- **Draft until the Owner applies it.** MIGRATE-FIRST then MERGE — `main` auto-deploys via
  Vercel, so the content-model PR must NOT merge until the migration is applied to prod
  (`veezkmytervjnpxcrbkw`). Claude cannot apply it (connector reaches only the Zeal org).

## 5. Build order (phased; respects the gates)

**Phase 1 — public site, static content (mergeable now, no DB):**
Build `(marketing)/` with the content from §2 baked into a typed `lib/site-content.ts`
default (so the page renders identically before and after the DB exists). Proof images +
registry links. Header login + language toggle. This ships and auto-deploys safely — no
schema, no live-data dependency. Validated by `tsc`/`eslint`/`vitest`/`next build` +
recharts/help drift guards.

**Phase 2 — OS-editable (migration-gated):**
Add `site_content` + RPCs + `site-media` bucket (migration DRAFT), the `(app)/website` editor,
and switch the page to read via `fn_get_site_content` with the §2 defaults as fallback. Opens
as a PR that **waits for the Owner to apply the migration**, then merge.

**Phase 3 (optional/later):** real scenery gallery once photos exist; domain→org mapping for
true multi-tenant sites.

## 6. Success criteria

- A buyer landing on `/` sees the certified export story, can verify each cert on the live
  registry, and can contact/enquire — Arabic or English.
- An employee logs in from the header into the OS unchanged.
- The Owner edits every visible field/number/image/link from `(app)/website` — no deploy.
- Zero fabricated data; every number traces to §2. No Western-digit leaks (use `lib/money`).
- No regression to the `(app)` OS or `/login`. Public read exposes only whitelisted content.

## 7. Risks

- **Public read surface** — `fn_get_site_content` must be tightly column-scoped; a `select *`
  would leak. Mitigated by explicit column list + a pgTAP test asserting the anon grant
  returns only whitelisted fields.
- **authorize() re-emit** — see §4; guarded by tests/22 + tests/97 and full-harness run.
- **Feature-freeze exception** — logged deliberately (STATUS.md freezes farm-OS *modules*;
  this is the public front door + a thin content model, greenlit by the Owner's request).
- **Storage** — `site-media` bucket public-read is intentional (marketing images); write
  policy owner-only.
