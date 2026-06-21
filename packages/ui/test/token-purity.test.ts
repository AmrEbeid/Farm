import { it, expect, describe } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runOn(css: string): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purity-"));
  const f = path.join(dir, "components.css");
  fs.writeFileSync(f, css);
  try { execFileSync("node", ["scripts/token-purity.mjs", f], { stdio: "pipe" }); return 0; }
  catch (e: any) { return e.status ?? 1; }
}
describe("token-purity", () => {
  it("passes clean token-only CSS", () => {
    expect(runOn(".fos-btn{background:var(--brand);color:var(--brand-contrast);padding:var(--space-2)}")).toBe(0);
  });
  it("fails on a hardcoded hex color", () => {
    expect(runOn(".fos-btn{background:#2f7d49}")).not.toBe(0);
  });
  it("fails on rgb()", () => {
    expect(runOn(".x{color:rgb(0,0,0)}")).not.toBe(0);
  });
});
