import fs from "node:fs";
// Files passed as args, else default to component stylesheet(s).
const files = process.argv.slice(2);
const targets = files.length ? files : ["src/styles/components.css"];
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC = /\b(rgb|rgba|hsl|hsla)\s*\(/g;
let bad = 0;
for (const f of targets) {
  const css = fs.readFileSync(f, "utf8");
  css.split("\n").forEach((line, i) => {
    // allow comments
    const code = line.replace(/\/\*.*?\*\//g, "");
    const hits = [...code.matchAll(HEX), ...code.matchAll(FUNC)];
    if (hits.length) { bad++; console.error(`${f}:${i + 1}  hardcoded color → use a role token: ${line.trim()}`); }
  });
}
if (bad) { console.error(`\n✗ token-purity: ${bad} hardcoded value(s). Components must use role tokens only.`); process.exit(1); }
console.log("✓ token-purity: clean");
