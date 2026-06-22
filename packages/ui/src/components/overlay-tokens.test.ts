import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
it("defines overlay role tokens in light + dark", () => {
  const css = fs.readFileSync(path.join(__dirname, "../styles/theme.css"), "utf8");
  const light = css.split('[data-theme="dark"]')[0];
  const dark = css.split('[data-theme="dark"]')[1] ?? "";
  for (const t of ["--shadow-overlay", "--scrim"]) {
    expect(light).toContain(t + ":");
    expect(dark).toContain(t + ":");
  }
});
