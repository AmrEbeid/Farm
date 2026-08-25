import { describe, expect, it } from "vitest";
import { supportAttachmentMatchesSignature, type SupportAttachmentContentType } from "./support-attachment";

const cases: Array<[SupportAttachmentContentType, number[]]> = [
  ["image/jpeg", [0xff, 0xd8, 0xff, 0x00]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ["image/heic", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]],
  ["image/heif", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31]],
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ["application/msword", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", [0x50, 0x4b, 0x03, 0x04]],
];

describe("support attachment signatures", () => {
  it.each(cases)("accepts valid %s bytes", (contentType, signature) => {
    expect(supportAttachmentMatchesSignature(contentType, new Uint8Array(signature))).toBe(true);
  });

  it.each(cases)("rejects disguised %s bytes", (contentType) => {
    expect(supportAttachmentMatchesSignature(contentType, new TextEncoder().encode("<script>alert(1)</script>"))).toBe(false);
  });
});

