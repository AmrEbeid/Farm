import { describe, it, expect } from "vitest";
import { galleryMediaPaths, sniffImage, siteMediaPaths } from "./site-media";
import type { SiteContent } from "./site-content";

/** Build a byte array from a list of numbers, padded to at least `len` bytes. */
function bytes(head: number[], len = 12): Uint8Array {
  const a = new Uint8Array(Math.max(len, head.length));
  a.set(head);
  return a;
}
/** ASCII string → byte codes. */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("sniffImage — trusts content, not the declared type", () => {
  it("recognizes JPEG magic bytes", () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });
  it("recognizes PNG magic bytes", () => {
    expect(sniffImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });
  it("recognizes WebP (RIFF….WEBP)", () => {
    expect(sniffImage(bytes([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]))).toBe("image/webp");
  });
  it("recognizes AVIF (ftyp avif brand)", () => {
    expect(sniffImage(bytes([0, 0, 0, 0, ...ascii("ftyp"), ...ascii("avif")]))).toBe("image/avif");
  });
  it("rejects SVG (the XSS vector) — not an allowed raster type", () => {
    expect(sniffImage(bytes(ascii("<svg xmlns"), 16))).toBeNull();
  });
  it("rejects HTML / arbitrary text", () => {
    expect(sniffImage(bytes(ascii("<!doctype html"), 16))).toBeNull();
  });
  it("rejects a too-short buffer", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
  it("rejects a RIFF container that is not WEBP (e.g. WAV)", () => {
    expect(sniffImage(bytes([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]))).toBeNull();
  });
  it("rejects an ftyp box with a non-image brand", () => {
    expect(sniffImage(bytes([0, 0, 0, 0, ...ascii("ftyp"), ...ascii("mp42")]))).toBeNull();
  });
});

describe("siteMediaPaths — only site-media objects (never placeholders/external)", () => {
  const OBJ = "https://x.supabase.co/storage/v1/object/public/site-media/";
  const ORG = "00000000-0000-0000-0000-000000000001";
  const paths = (value: SiteContent | null | undefined) => siteMediaPaths(value, OBJ, ORG);
  const content = (gallery: string[], certs: string[] = []): SiteContent =>
    ({
      gallery: { items: gallery.map((image) => ({ image, caption: { ar: "", en: "" } })) },
      certifications: { items: certs.map((image) => ({ image })) },
    } as unknown as SiteContent);

  it("extracts the object path from a site-media public URL", () => {
    expect(paths(content([`${OBJ}${ORG}/gallery/abc.png`]))).toEqual([
      `${ORG}/gallery/abc.png`,
    ]);
  });
  it("ignores bundled placeholders, external URLs, and empties", () => {
    expect(
      paths(
        content([
          "/site/gallery/placeholder-1.svg",
          "https://example.com/some-photo.jpg",
          "",
          `${OBJ}${ORG}/gallery/keep.webp`,
        ]),
      ),
    ).toEqual([`${ORG}/gallery/keep.webp`]);
  });
  it("includes UPLOADED certificate images alongside gallery images", () => {
    expect(
      paths(content([`${OBJ}${ORG}/gallery/a.jpg`], [`${OBJ}${ORG}/certificates/b.png`])),
    ).toEqual([`${ORG}/gallery/a.jpg`, `${ORG}/certificates/b.png`]);
  });
  it("never returns a bundled /site/proofs cert image or an external cert URL", () => {
    expect(
      paths(
        content([], [
          "/site/proofs/globalgap-registry.jpeg",
          "https://database.globalgap.org/cert.png",
          "",
        ]),
      ),
    ).toEqual([]);
  });
  it("ignores a lookalike external URL containing the bucket path", () => {
    expect(
      paths(content(["https://evil.test/site-media/gallery/do-not-delete.jpg"])),
    ).toEqual([]);
  });
  it("ignores objects owned by another organization", () => {
    const otherOrg = "00000000-0000-0000-0000-000000000002";
    expect(paths(content([`${OBJ}${otherOrg}/gallery/private.jpg`]))).toEqual([]);
  });
  it("can limit cleanup discovery to gallery objects", () => {
    const value = content(
      [`${OBJ}${ORG}/gallery/a.jpg`],
      [`${OBJ}${ORG}/certificates/b.png`],
    );
    expect(galleryMediaPaths(value, OBJ, ORG)).toEqual([`${ORG}/gallery/a.jpg`]);
  });
  it("returns [] for null / undefined / no gallery or certifications", () => {
    expect(paths(null)).toEqual([]);
    expect(paths(undefined)).toEqual([]);
    expect(paths({} as SiteContent)).toEqual([]);
  });
});
