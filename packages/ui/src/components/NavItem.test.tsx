import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavItem, type NavItemData } from "./NavItem";

const item: NavItemData = { id: "plans", label: "الخطط", href: "/plans" };

describe("NavItem", () => {
  it("renders an anchor with the href and label", () => {
    render(<NavItem item={item} />);
    const a = screen.getByRole("link", { name: "الخطط" });
    expect(a).toHaveAttribute("href", "/plans");
  });

  it("marks the active item with aria-current=page", () => {
    render(<NavItem item={item} active />);
    expect(screen.getByRole("link", { name: "الخطط" })).toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect with the item id on click", async () => {
    const onSelect = vi.fn();
    render(<NavItem item={item} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("link", { name: "الخطط" }));
    expect(onSelect).toHaveBeenCalledWith("plans");
  });

  it("neutralizes an unsafe javascript: href (renders '#')", () => {
    render(<NavItem item={{ id: "x", label: "خطر", href: "javascript:alert(1)" }} />);
    expect(screen.getByRole("link", { name: "خطر" })).toHaveAttribute("href", "#");
  });

  it("forwards a ref to the anchor", () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(<NavItem item={item} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });
});
