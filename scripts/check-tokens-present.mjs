import fs from "node:fs";
const css = fs.readFileSync(new URL("../src/styles/primitives.css", import.meta.url), "utf8");
const required = [
  "--green-500","--green-700","--gold-500","--gray-0","--gray-900",
  "--red-500","--amber-500","--blue-500","--purple-500",
  "--space-1","--space-4","--space-10","--radius-1","--radius-3",
  "--text-xs","--text-3xl","--shadow-1","--dur-fast","--ease",
];
const missing = required.filter((t) => !css.includes(t + ":"));
if (missing.length) { console.error("MISSING primitives:", missing.join(", ")); process.exit(1); }
console.log("primitives present:", required.length);

const theme = fs.readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
const roles = ["--brand","--surface","--surface-raised","--ink","--ink-muted","--line","--focus-ring","--success-bg","--success-fg","--warning-bg","--danger-fg","--info-bg"];
const light = theme.split('[data-theme="dark"]')[0];
const darkParts = theme.split('[data-theme="dark"]');
const dark = darkParts.length > 1 ? darkParts[1] : "";
const missLight = roles.filter((t) => !light.includes(t + ":"));
const missDark = roles.filter((t) => !dark.includes(t + ":"));
if (missLight.length) { console.error("MISSING role tokens (light):", missLight.join(", ")); process.exit(1); }
if (missDark.length) { console.error("MISSING role tokens (dark):", missDark.join(", ")); process.exit(1); }
console.log("role tokens present in light + dark:", roles.length);
