/** Derive brand role variables from a single hex color. */
export function brandVars(hex: string): Record<string, string> {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`brandVars: expected a 6-digit hex, got "${hex}"`);
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const hover = "#" + [r, g, b].map((c) => Math.max(0, Math.round(c * 0.82)).toString(16).padStart(2, "0")).join("");
  // relative luminance → contrast text
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const contrast = lum > 0.6 ? "#0c1f12" : "#ffffff";
  return { "--brand": hex.toLowerCase(), "--brand-hover": hover, "--brand-contrast": contrast };
}
