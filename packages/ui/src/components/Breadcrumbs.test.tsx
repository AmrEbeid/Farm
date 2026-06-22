import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

const items: Crumb[] = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "palms", label: "النخيل", href: "/palms" },
  { id: "p-12", label: "نخلة ١٢" },
];

describe("Breadcrumbs", () => {
  it("renders a labeled nav with an ordered list", () => {
    const { container } = render(<Breadcrumbs items={items} ariaLabel="مسار التنقل" />);
    expect(screen.getByRole("navigation", { name: "مسار التنقل" })).toBeInTheDocument();
    expect(container.querySelector("ol")).toBeInTheDocument();
  });

  it("marks the last crumb as the current page and renders it as text (no link)", () => {
    render(<Breadcrumbs items={items} ariaLabel="مسار" />);
    const current = screen.getByText("نخلة ١٢");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.closest("a")).toBeNull();
    expect(screen.getByText("الرئيسية").closest("a")).toHaveAttribute("href", "/");
  });

  it("calls onSelect when a linked crumb is activated", async () => {
    const onSelect = vi.fn();
    render(<Breadcrumbs items={items} ariaLabel="مسار" onSelect={onSelect} />);
    await userEvent.click(screen.getByText("النخيل"));
    expect(onSelect).toHaveBeenCalledWith("palms");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Breadcrumbs items={items} ariaLabel="مسار" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
