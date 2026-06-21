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
});
