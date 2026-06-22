import * as React from "react";
import { it, expect, describe } from "vitest";
import { render } from "@testing-library/react";
import { useChartTokens, type ChartTokens } from "./useChartTokens";

function Probe({ onResolve }: { onResolve: (t: ChartTokens) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const tokens = useChartTokens(ref);
  React.useEffect(() => { onResolve(tokens); }, [tokens, onResolve]);
  return (
    <div
      ref={ref}
      style={{
        // stub resolved role tokens so getComputedStyle returns real values
        ["--brand" as any]: "#2f7d49",
        ["--ink" as any]: "#18241d",
        ["--ink-muted" as any]: "#6b7d72",
        ["--line" as any]: "#e3e9e4",
        ["--surface" as any]: "#ffffff",
        ["--info-fg" as any]: "#2b6cb0",
        ["--warning-fg" as any]: "#e08a1e",
        ["--danger-fg" as any]: "#c0392b",
        ["--success-fg" as any]: "#2f7d49",
        ["--accent-fg" as any]: "#7e57c2",
      }}
    />
  );
}

describe("useChartTokens", () => {
  it("resolves role tokens off the scope element", () => {
    let resolved: ChartTokens | undefined;
    render(<Probe onResolve={(t) => { resolved = t; }} />);
    expect(resolved!.brand).toBe("#2f7d49");
    expect(resolved!.ink).toBe("#18241d");
    expect(resolved!.inkMuted).toBe("#6b7d72");
    expect(resolved!.line).toBe("#e3e9e4");
    expect(resolved!.surface).toBe("#ffffff");
  });

  it("derives a non-empty categorical palette led by brand", () => {
    let resolved: ChartTokens | undefined;
    render(<Probe onResolve={(t) => { resolved = t; }} />);
    expect(resolved!.palette.length).toBeGreaterThanOrEqual(5);
    expect(resolved!.palette[0]).toBe("#2f7d49");
    expect(resolved!.palette).toContain("#2b6cb0");
  });

  it("reports a direction (defaults to ltr in jsdom)", () => {
    let resolved: ChartTokens | undefined;
    render(<Probe onResolve={(t) => { resolved = t; }} />);
    expect(["rtl", "ltr"]).toContain(resolved!.dir);
  });
});
