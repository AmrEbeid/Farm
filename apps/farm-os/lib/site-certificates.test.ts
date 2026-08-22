import { describe, it, expect } from "vitest";
import {
  CERT_LIMITS,
  MAX_CERTIFICATES,
  isAllowedCertImage,
  isHttpsUrl,
  validateCertifications,
} from "./site-certificates";
import { SITE_CONTENT_DEFAULTS, type SiteCert, type SiteContent } from "./site-content";

/** A valid card; each test overrides only the field under test. */
const cert = (over: Partial<SiteCert> = {}): SiteCert => ({
  title: { ar: "شهادة", en: "Certificate" },
  detail: { ar: "رقم 1", en: "No. 1" },
  image: "/site/proofs/a.jpeg",
  verifyUrl: "https://example.com",
  verifyLabel: "example.com",
  verifyIsRegistry: true,
  ...over,
});

const section = (items: SiteCert[]): SiteContent["certifications"] => ({
  heading: { ar: "الشهادات", en: "Certifications" },
  intro: { ar: "مقدمة", en: "Intro" },
  items,
});

describe("validateCertifications — the shipped defaults", () => {
  it("accepts the four Owner-approved certificates unchanged", () => {
    expect(validateCertifications(SITE_CONTENT_DEFAULTS.certifications)).toEqual({ ok: true });
  });
  it("rejects an empty list so the homepage never renders an empty trust band", () => {
    expect(validateCertifications(section([])).ok).toBe(false);
  });
});

describe("validateCertifications — count and section text", () => {
  it(`accepts exactly ${MAX_CERTIFICATES} cards`, () => {
    const items = Array.from({ length: MAX_CERTIFICATES }, () => cert());
    expect(validateCertifications(section(items)).ok).toBe(true);
  });
  it(`rejects more than ${MAX_CERTIFICATES} cards`, () => {
    const items = Array.from({ length: MAX_CERTIFICATES + 1 }, () => cert());
    expect(validateCertifications(section(items)).ok).toBe(false);
  });
  it("rejects a missing section, a missing heading, and a blank intro", () => {
    expect(validateCertifications(null).ok).toBe(false);
    expect(validateCertifications(undefined).ok).toBe(false);
    const s = section([]);
    expect(validateCertifications({ ...s, heading: { ar: "", en: "C" } }).ok).toBe(false);
    expect(validateCertifications({ ...s, intro: { ar: "م", en: "   " } }).ok).toBe(false);
  });
  it("rejects an over-long heading / intro", () => {
    const s = section([]);
    expect(
      validateCertifications({ ...s, heading: { ar: "ش".repeat(CERT_LIMITS.heading + 1), en: "C" } }).ok,
    ).toBe(false);
    expect(
      validateCertifications({ ...s, intro: { ar: "م", en: "x".repeat(CERT_LIMITS.intro + 1) } }).ok,
    ).toBe(false);
  });
  it("rejects a non-array items field", () => {
    expect(
      validateCertifications({ ...section([]), items: "nope" } as unknown as SiteContent["certifications"]).ok,
    ).toBe(false);
  });
});

describe("validateCertifications — per-card required, bounded fields", () => {
  const rejects = (over: Partial<SiteCert>) =>
    expect(validateCertifications(section([cert(over)])).ok).toBe(false);

  it("requires both languages of the title and the detail", () => {
    rejects({ title: { ar: "", en: "C" } });
    rejects({ title: { ar: "ش", en: "  " } });
    rejects({ detail: { ar: "", en: "d" } });
    rejects({ detail: { ar: "ت", en: "" } });
  });
  it("bounds the title, the detail and the verify label", () => {
    rejects({ title: { ar: "ش".repeat(CERT_LIMITS.title + 1), en: "C" } });
    rejects({ detail: { ar: "ت", en: "d".repeat(CERT_LIMITS.detail + 1) } });
    rejects({ verifyLabel: "x".repeat(CERT_LIMITS.verifyLabel + 1) });
    rejects({ verifyLabel: "" });
  });
  it("requires an explicit registry-vs-issuer boolean", () => {
    rejects({ verifyIsRegistry: undefined as unknown as boolean });
  });
  it("names the offending row so the owner can find it", () => {
    const res = validateCertifications(section([cert(), cert({ verifyUrl: "javascript:alert(1)" })]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("2");
  });
});

describe("validateCertifications — image and verify URL schemes", () => {
  const rejects = (over: Partial<SiteCert>) =>
    expect(validateCertifications(section([cert(over)])).ok).toBe(false);
  const accepts = (over: Partial<SiteCert>) =>
    expect(validateCertifications(section([cert(over)])).ok).toBe(true);

  it("accepts a bundled /site/ path, an uploaded site-media URL and an https URL", () => {
    accepts({ image: "/site/proofs/capq-farm-approval.jpeg" });
    accepts({ image: "https://x.supabase.co/storage/v1/object/public/site-media/certificates/a.png" });
    rejects({ image: "http://example.com/a.png" });
  });
  it("rejects javascript:, data:, scheme-relative, traversal and other local paths", () => {
    rejects({ image: "javascript:alert(1)" });
    rejects({ image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" });
    rejects({ image: "//evil.example.com/a.png" });
    rejects({ image: "/site/../etc/passwd" });
    rejects({ image: "/uploads/a.png" });
    rejects({ image: "" });
  });
  it("requires https for the verify URL", () => {
    accepts({ verifyUrl: "https://database.globalgap.org/x" });
    rejects({ verifyUrl: "javascript:alert(1)" });
    rejects({ verifyUrl: "mailto:a@b.com" });
    rejects({ verifyUrl: "/site/proofs/a.jpeg" });
    rejects({ verifyUrl: "database.globalgap.org" });
    rejects({ verifyUrl: "" });
  });
  it("bounds the URL lengths", () => {
    rejects({ verifyUrl: `https://e.com/${"a".repeat(CERT_LIMITS.url)}` });
    rejects({ image: `/site/${"a".repeat(CERT_LIMITS.url)}` });
  });
});

describe("URL helpers", () => {
  it("isHttpsUrl accepts only parsed HTTPS URLs", () => {
    expect(isHttpsUrl("https://a.com")).toBe(true);
    expect(isHttpsUrl("  https://a.com  ")).toBe(true);
    expect(isHttpsUrl("HTTPS://A.com")).toBe(true);
    expect(isHttpsUrl("http://a.com")).toBe(false);
    expect(isHttpsUrl("ftp://a.com")).toBe(false);
    expect(isHttpsUrl("java\nscript:alert(1)")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
  it("isAllowedCertImage requires /site/<something> or HTTPS", () => {
    expect(isAllowedCertImage("/site/proofs/a.png")).toBe(true);
    expect(isAllowedCertImage("/site/")).toBe(false);
    expect(isAllowedCertImage("/sitemap.xml")).toBe(false);
    expect(isAllowedCertImage("C:\\temp\\a.png")).toBe(false);
  });
});
