import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
it("defines density + radius scope blocks", () => {
  const css = fs.readFileSync(path.join(__dirname, "../styles/theme.css"), "utf8");
  expect(css).toContain('[data-density="compact"]');
  expect(css).toContain("--control-h:");
  expect(css).toContain('[data-radius="sharp"]');
  expect(css).toContain("--radius-control:");
});
