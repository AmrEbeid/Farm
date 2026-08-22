import type { SiteContent } from "@/lib/site-content";

// Pure, testable helpers for the public-site media (gallery + certificate uploads, orphan cleanup).
// Kept out of
// the "use server" actions file so they can be unit-tested directly — this is security-relevant
// logic (the upload type sniffer decides what lands in the public bucket).

/** Image content-types the site-media uploads (gallery + certificates) accept. */
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
 * Object paths of images we uploaded to the `site-media` bucket — across BOTH owner-editable image
 * lists (gallery items and certificate cards). Used for orphan cleanup on save.
 *
 * SAFETY: the caller supplies this project's exact public bucket prefix. A path is returned only
 * when the URL begins with that prefix, so a lookalike external URL cannot nominate an object for
 * deletion.
 */
function mediaPaths(
  urls: string[],
  publicBucketPrefix: string,
  orgId: string,
): string[] {
  const orgPrefix = `${orgId}/`;
  const paths: string[] = [];
  for (const url of urls) {
    if (typeof url === "string" && url.startsWith(publicBucketPrefix)) {
      const path = url.slice(publicBucketPrefix.length);
      if (path.startsWith(orgPrefix)) paths.push(path);
    }
  }
  return paths;
}

export function siteMediaPaths(
  content: SiteContent | null | undefined,
  publicBucketPrefix: string,
  orgId: string,
): string[] {
  return mediaPaths(
    [
      ...(content?.gallery?.items ?? []).map((item) => item?.image ?? ""),
      ...(content?.certifications?.items ?? []).map((item) => item?.image ?? ""),
    ],
    publicBucketPrefix,
    orgId,
  );
}

/** Gallery-only paths eligible for automatic orphan cleanup. */
export function galleryMediaPaths(
  content: SiteContent | null | undefined,
  publicBucketPrefix: string,
  orgId: string,
): string[] {
  return mediaPaths(
    (content?.gallery?.items ?? []).map((item) => item?.image ?? ""),
    publicBucketPrefix,
    orgId,
  );
}
