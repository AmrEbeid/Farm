import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Probe() { const t = useTheme(); return <span data-testid="p">{t.scheme}-{t.density}</span>; }

describe("ThemeProvider", () => {
  it("applies scope attributes and brand vars", () => {
    const { container } = render(
      <ThemeProvider scheme="dark" density="compact" radius="rounded" brand="#2f7d49">
        <Probe />
      </ThemeProvider>
    );
    const scope = container.querySelector(".fos") as HTMLElement;
    expect(scope.getAttribute("data-theme")).toBe("dark");
    expect(scope.getAttribute("data-density")).toBe("compact");
    expect(scope.getAttribute("data-radius")).toBe("rounded");
    expect(scope.style.getPropertyValue("--brand")).toBe("#2f7d49");
    expect(screen.getByTestId("p").textContent).toBe("dark-compact");
  });
  it("defaults to light/comfortable/default and no brand override", () => {
    const { container } = render(<ThemeProvider><Probe /></ThemeProvider>);
    const scope = container.querySelector(".fos") as HTMLElement;
    expect(scope.getAttribute("data-theme")).toBe("light");
    expect(scope.style.getPropertyValue("--brand")).toBe("");
  });

  // HIGH-2: a malformed tenant brand must NOT crash the subtree (brandVars throws).
  it("ignores a malformed brand value instead of throwing", () => {
    expect(() =>
      render(
        <ThemeProvider brand={"red;} :root{display:none" as string}>
          <Probe />
        </ThemeProvider>
      )
    ).not.toThrow();
    // children still render; no brand var applied (fell back to default theme)
    expect(screen.getByTestId("p")).toBeTruthy();
  });

  // HIGH-1: the resolved brand vars are exposed via context so portals can re-apply them.
  it("exposes resolved brand vars via useTheme().brandStyle", () => {
    function BrandProbe() {
      const t = useTheme();
      return <span data-testid="b">{String(t.brandStyle["--brand" as keyof typeof t.brandStyle])}</span>;
    }
    render(<ThemeProvider brand="#2f7d49"><BrandProbe /></ThemeProvider>);
    expect(screen.getByTestId("b").textContent).toBe("#2f7d49");
  });
});
