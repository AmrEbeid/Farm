// Inlines src/styles/index.css @imports into a single dist/styles.css (no external deps).
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("src/styles");
const OUT = path.resolve("dist/styles.css");

function inline(file, seen = new Set()) {
  const abs = path.resolve(SRC, file);
  if (seen.has(abs)) return "";
  seen.add(abs);
  const css = fs.readFileSync(abs, "utf8");
  return css.replace(/@import\s+["']([^"']+)["'];?/g, (_, imp) => inline(imp, seen));
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const bundled = `/* Farm OS UI — bundled styles (tokens + components). Generated. */\n` + inline("index.css");
fs.writeFileSync(OUT, bundled);
console.log("Wrote dist/styles.css", bundled.length, "bytes");
