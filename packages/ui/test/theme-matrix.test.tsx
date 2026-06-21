import { it, expect, describe } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider, Button, Tag, KpiCard, Alert, VerdictBanner } from "../src";

const schemes = ["light", "dark"] as const;
const densities = ["comfortable", "compact"] as const;

function Sample() {
  return (<>
    <Button>اعتماد</Button>
    <Tag tone="ok">معتمدة</Tag>
    <KpiCard label="صافي" value="2.71" unit="م" />
    <Alert tone="warning" title="مخزون منخفض" />
    <VerdictBanner tone="danger">نقص حرج</VerdictBanner>
  </>);
}

describe("theme matrix", () => {
  for (const scheme of schemes) for (const density of densities) {
    it(`renders without throwing: ${scheme}/${density}`, () => {
      const { container } = render(<ThemeProvider scheme={scheme} density={density}><Sample /></ThemeProvider>);
      expect(container.querySelector(".fos-btn")).toBeInTheDocument();
    });
  }
  it("default theme has no axe violations", async () => {
    const { container } = render(<ThemeProvider><Sample /></ThemeProvider>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
