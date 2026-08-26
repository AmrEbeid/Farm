# SPEC — Ebeid Farm public website, search pages, and OS-editable content

_Date: 2026-07-03 · Owner: Amr Ebeid · Author: Claude (brainstorming → spec)_
_Standing mandate this session: proceed on my own recommendations, don't wait for inputs._

## 1. Problem & goal

Farm OS originally served a thin unauthenticated landing whose only job was a login link. Ebeid
Farm is a **real Barhi date farm that supplies export companies** and holds published
certification/approval records (GlobalGAP, China GACC, QCAP, CAPQ). It needs a credibility website
that:

1. Tells the export story to **buyers/importers** (China, Gulf, Asia, EU) — certifications,
   supply reliability, specs, contact.
2. Is **balanced** (decision "C"): a real marketing site _and_ a persistent employee
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
- **Disputed legacy stats:** the original source recorded ~115 feddans, ~4,380 Barhi palms, 5 blocks and
  28 hawshat, while later owner content and the 2026 workbook disagree. These are not canonical facts and the
  focused Farm-facts page must not republish them until the field registry is reconciled.
- **Legacy blocks (not publicly displayed as canonical facts):** الـ22 فدان (22f, 7 hawsha, 948, 2018/2019) ·
  الحصوة (30f, 8, 1,165, 2022/2025) · حوض البابور (30.5f, 5, 1,485, 2023/2025) · الشفعة (9.5f, 4, 269, 2023) · الخطارة (23f, 4, 513, 2010–2024).
- **Supply/specs:** Fresh Barhi (Khalal) · 202 t CAPQ-approved · season Aug–Oct · packaging to
  buyer spec · air + reefer sea · destinations CHN/ARE/SAU/KWT/EU.
- **Contact:** Eng. Abdelglil Ebeid · abdoebaid2016@gmail.com · +20 100 217 4773 · +20 121 014 1019.

### Certification proofs (real files, in `public/site/proofs/`)

| Proof                       | Detail                                                                                                                    | Live verification                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **GlobalGAP**               | GGN 4059883915303 · Cert 00151VPHHN0003 · HEIACert · IFA v6 SMART · valid → 2026-10-06 · 9.24 ha · ARE/CHN/EGY/EU/KWT/SAU | database.globalgap.org/search              |
| **China GACC**              | Obaid Company for Dates · Reg QEGY1425102400002 · overseas code 55.09.30.03.DAF · Fresh fruits/Dates · valid → 2999       | scintl.chinaport.gov.cn (APR company list) |
| **QCAP residue**            | Cert Dokki-182904 · Barhi · EN 15662:2018 · clean (Hexythiazox 0.01 mg/kg)                                                | Ministry of Agriculture Central Lab        |
| **CAPQ farm approval 2025** | Code 55.09.30.03.DAF · Barhi · 202 t · destination China · issued 2025-08-27                                              | Egyptian Plant Quarantine                  |

**Excluded:** `certificate.pdf-20250619-…` provided in Downloads is a **DocuSign completion
for "ZEAL IO LTD — Grant to Yasmin Abdelmagid"** (Omar Ebeid / getzeal.io) — an unrelated Zeal
corporate document. It is NOT used on the farm site.

## 3. Architecture

- The public route groups render Arabic at `/` and English at `/en` (unauthenticated, SSR/ISR).
  `app/(app)/**` and the authentication routes remain separate and protected.
- **Header:** brand + language toggle + persistent **«تسجيل الدخول / Login»** → `/login`
  (already wired into the OS). No auth changes.
- Same repo, same Vercel deploy, same domain (ebeidfarm.business). No new hosting.
- **Bilingual:** Arabic-primary (RTL) with a real crawlable AR⇄EN link; every editable field stores
  both AR and EN. Language is selected by URL, never by client-only state.

### Search acquisition extension (2026-08-26)

The website adds six focused buyer intents, each with an Arabic route and an English `/en/...`
equivalent:

| Intent                          | Arabic                         | English                           |
| ------------------------------- | ------------------------------ | --------------------------------- |
| Fresh Barhi product             | `/fresh-barhi-dates`           | `/en/fresh-barhi-dates`           |
| Supply to export companies      | `/barhi-dates-export-supply`   | `/en/barhi-dates-export-supply`   |
| Published China records         | `/egyptian-dates-china-supply` | `/en/egyptian-dates-china-supply` |
| Certifications and traceability | `/date-farm-certifications`    | `/en/date-farm-certifications`    |
| Wholesale specifications        | `/barhi-dates-wholesale`       | `/en/barhi-dates-wholesale`       |
| Canonical farm identity         | `/ebeid-farm-facts`            | `/en/ebeid-farm-facts`            |

`lib/site-public-pages.ts` is the typed route/content registry. Metadata, reciprocal canonical and
hreflang links, sitemap entries, proxy indexability, analytics allowlisting, homepage internal
links, and website-save revalidation all consume that registry. Adding a public route in only one
of those surfaces is therefore a test failure rather than a silent discovery gap.

Each focused page reorganizes the existing owner-managed `SiteContent`; it does not create a second
store. Page-specific headings and concise metadata contain no mutable quantity, price, availability,
rating, review, or certificate status. Mutable facts and proof links remain owner-managed. Product,
export-supply and wholesale pages label specifications as published owner-managed information, not a
quote or confirmation of quantity, current capacity or export entitlement. Quantity, China-approval
and certified-destination rows are excluded from those focused commercial pages. The China page shows only
matching published China certificate records and never repeats the general specification table. The
farm facts page deliberately excludes disputed palm counts and areas. Product/Offer/review structured
data remains prohibited until visible, current and verified commerce data exists.

These pages are unauthenticated marketing content rather than Farm OS operating workflows, so the
authenticated `pageMeta` Help drawer does not render on them. Every definition in the typed registry
still carries non-empty bilingual `what`, `why`, `when`, `how`, and `commonMistakes` fields plus this
spec path and `public` permission. The contract is buyer information only; enquiry before any price,
quantity, capacity or availability assumption; certificate links distinguished as registry vs
issuing authority; and the Farm must not be described as the direct exporter when it supplies export
companies.

Each focused route renders two bilingual buyer FAQs as visible native disclosure controls, without FAQ rich-result
markup. Product, export-supply and wholesale pages also render `brand.season` as the **last published season**
with an explicit warning that it is not live availability. This field remains owner-editable in `/website`.
No genuine gallery photographs were present in the local Farm archive at the 2026-08-26 release review; the
generated hero must not be represented as documentary farm photography, and placeholders remain hidden.

### Sections (fixed set)

Hero (name + badges + Login) → About → Why Barhi → Supply & Specs → **Certifications & Proof**
(badges + proof thumbnails + live-registry links) → Why Partner → Contact (+ optional future
scenery gallery, empty until photos exist). Production-block records remain owner-managed in the
content model but are not displayed on the public website.

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

#### Editor sections (as built)

`components/site/SiteEditor.tsx` edits a working copy of the FULL `SiteContent` and saves the
whole object, so sections without a form keep their stored values. Covered today: tagline, hero,
headline stats, contact, the photo gallery, and — since 2026-08-22 — the **certifications**
section (its heading/intro plus add / edit / remove of each card: AR+EN title and detail, image
URL or in-OS upload, verify URL, verify label, and the registry-vs-issuing-authority flag). A new
card is created blank — never a copy of a real certificate. Blocks, specs and why-partner rows
are still edited only in `lib/site-content.ts` defaults / the DB row.

**Uploads.** One owner-gated server action path (`uploadSiteImage`) backs both
`uploadGalleryImage` and `uploadCertificateImage`; it caps at 5 MB, derives the real type from
magic bytes (client `file.type`/name untrusted), and writes a server-generated object name —
`<org-id>/gallery/<uuid>.<ext>` or `<org-id>/certificates/<uuid>.<ext>`.

**Orphan cleanup.** On save, `galleryMediaPaths()` collects the bucket object paths referenced by the
OLD and NEW gallery content. After the content RPC succeeds, it deletes what the save dropped. It
accepts this project's exact public bucket prefix and requires the caller's organization prefix, so
bundled `/site/…` assets, external URLs, lookalike bucket paths, and other organizations' objects can
never be passed to `storage.remove()`. Certificate scans are retained instead of auto-deleted so a
stale editor tab cannot restore a reference to a proof that another tab removed.

**Certificate validation (enforced server-side).** `lib/site-certificates.ts` →
`validateCertifications()` runs in `saveSiteContent` **before** cleanup discovery and the RPC, so a
rejected payload deletes nothing and writes nothing. Rules: 1–12 cards; heading, intro, both
languages of title and detail, and the verify label required and length-bounded; `image` must be a
`/site/…` path or this Farm project's exact public `site-media` storage prefix (no credentials,
query, fragment, `data:`, `javascript:`, `//host`, traversal or arbitrary third-party host);
`verifyUrl` must parse as HTTPS; `verifyIsRegistry` must be an explicit boolean. The four shipped
defaults pass unchanged. This is defence in depth — the public render still goes through
`safeHref` in `SiteLanding.tsx`.

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
- **Feature-freeze exception** — logged deliberately (STATUS.md freezes farm-OS _modules_;
  this is the public front door + a thin content model, greenlit by the Owner's request).
- **Storage** — `site-media` bucket public-read is intentional (marketing images); write
  policy owner-only.

## 8. Changelog

- **2026-08-26 — crawlable Arabic and English routes:** Arabic remains at `/`; English now has
  its own server-rendered `/en` URL. Both pages publish reciprocal `hreflang` links (`ar`, `en`,
  `x-default`), localized canonical metadata, one shared Organization/WebSite entity and a
  language-specific WebPage entity. Separate root layouts set the initial Arabic and English HTML
  language/direction correctly before hydration. The sitemap lists only the two public URLs; robots
  permits crawling so non-public responses can enforce no-index without exposing authenticated data. The header language
  control is a normal link instead of client-only state. Saving website content revalidates both
  public routes, including their owner-managed search titles, descriptions and contact JSON-LD.
  Owner text is escaped before inline JSON-LD insertion; structured addresses come from the same
  owner-managed content as the visible page. Non-public responses carry `X-Robots-Tag: noindex,
nofollow, noarchive`; authentication remains the access boundary and those routes are absent from
  the sitemap. No schema or authentication change is
  involved.

- **2026-08-26 — Location destination correction:** replaced the initial map destination with
  the exact Google Maps link associated with support ticket
  `0629f281-ca8c-401f-80b6-f1ef29ce6f32`,
  `https://maps.app.goo.gl/G9XhCj1xLHWW3zgu9`. No content row, schema, access rule or analytics
  payload changed.
- **2026-08-26 — Farm location link:** the Owner can maintain a public Google Maps/directions
  URL with the other contact fields. The public contact section shows a bilingual “open farm
  location” action in a new tab. Empty links hide the action; non-empty links are normalized and
  accepted only as bounded, credential-free absolute HTTPS URLs before save and again at render.
  Analytics records only the action and language (never the location), and older saved content
  inherits the approved default URL without a database migration.
