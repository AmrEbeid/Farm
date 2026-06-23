/**
 * Neutralize dangerous URL schemes before they reach an <a href>/<img src>.
 *
 * Components take consumer-supplied href/src strings; if a host app builds those from
 * untrusted content (CMS, user input), a value like a `javascript:` or `data:text/html,`
 * URL becomes a script-execution / phishing vector that TypeScript's `string` type can't
 * catch. Returns the original value when it is a relative URL, an anchor, or an
 * allow-listed scheme (http/https/mailto/tel); otherwise `undefined` (the link renders
 * but does not navigate).
 */
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

export function safeHref(href: string | undefined | null): string | undefined {
  if (!href) return undefined;
  // Strip whitespace (incl. tabs/newlines) so obfuscated schemes like "java\nscript:"
  // are still detected, then read the leading URL scheme if any.
  const cleaned = href.replace(/\s+/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (scheme && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return undefined;
  // No scheme (relative/anchor/protocol-relative) or an allow-listed scheme: keep as-is.
  return href;
}
