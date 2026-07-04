import type { SiteContent } from "@/lib/site-content";

// Pure, testable helpers for the public-site media (gallery upload + orphan cleanup). Kept out of
// the "use server" actions file so they can be unit-tested directly — this is security-relevant
// logic (the upload type sniffer decides what lands in the public bucket).

/** Public-URL segment that marks an object stored in the `site-media` bucket. */
export const SITE_MEDIA_PREFIX = "/site-media/";

/** Image content-types the gallery upload accepts. */
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

/** Stored file extension per accepted content-type (derived server-side, never from the client). */
export const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Determine the real image type from magic bytes. NEVER trust the client-declared file.type/name.
 * Returns the content-type for JPEG/PNG/WebP/AVIF, or null for anything else (incl. SVG/HTML/short).
 */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

/**
 * Object paths of gallery images stored in the `site-media` bucket. Bundled placeholders (under
 * /site/gallery) and external URLs are ignored — so orphan-cleanup only ever deletes objects we
 * uploaded.
 */
export function galleryMediaPaths(content: SiteContent | null | undefined): string[] {
  const paths: string[] = [];
  for (const it of content?.gallery?.items ?? []) {
    const url = it?.image ?? "";
    const idx = url.indexOf(SITE_MEDIA_PREFIX);
    if (idx >= 0) paths.push(url.slice(idx + SITE_MEDIA_PREFIX.length));
  }
  return paths;
}
