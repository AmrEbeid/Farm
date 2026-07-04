import { describe, it, expect } from "vitest";
import { sniffImage, galleryMediaPaths } from "./site-media";
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

describe("galleryMediaPaths — only site-media objects (never placeholders/external)", () => {
  const content = (images: string[]): SiteContent =>
    ({ gallery: { items: images.map((image) => ({ image, caption: { ar: "", en: "" } })) } } as unknown as SiteContent);

  it("extracts the object path from a site-media public URL", () => {
    expect(
      galleryMediaPaths(
        content(["https://x.supabase.co/storage/v1/object/public/site-media/gallery/abc.png"]),
      ),
    ).toEqual(["gallery/abc.png"]);
  });
  it("ignores bundled placeholders, external URLs, and empties", () => {
    expect(
      galleryMediaPaths(
        content([
          "/site/gallery/placeholder-1.svg",
          "https://example.com/some-photo.jpg",
          "",
          "https://x.supabase.co/storage/v1/object/public/site-media/gallery/keep.webp",
        ]),
      ),
    ).toEqual(["gallery/keep.webp"]);
  });
  it("returns [] for null / undefined / no gallery", () => {
    expect(galleryMediaPaths(null)).toEqual([]);
    expect(galleryMediaPaths(undefined)).toEqual([]);
    expect(galleryMediaPaths({} as SiteContent)).toEqual([]);
  });
});
