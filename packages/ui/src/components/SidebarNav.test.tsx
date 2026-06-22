import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";

const items: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

describe("SidebarNav", () => {
  it("renders a labeled nav landmark with all items for an unrestricted role", () => {
    render(<SidebarNav items={items} ariaLabel="التنقل الرئيسي" />);
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText("المخزون")).toBeInTheDocument();
    expect(screen.getByText("الإعدادات")).toBeInTheDocument();
  });

  it("marks only the active item with aria-current=page", () => {
    render(<SidebarNav items={items} activeId="inventory" ariaLabel="التنقل" />);
    expect(screen.getByText("المخزون").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("لوحة التحكم").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("filters items the role may not see", () => {
    render(<SidebarNav items={items} role="worker" ariaLabel="التنقل" />);
    expect(screen.queryByText("الإعدادات")).not.toBeInTheDocument();
    expect(screen.getByText("المخزون")).toBeInTheDocument();
  });

  it("calls onSelect with the item id and is keyboard reachable", async () => {
    const onSelect = vi.fn();
    render(<SidebarNav items={items} ariaLabel="التنقل" onSelect={onSelect} />);
    await userEvent.tab();
    expect(screen.getByText("لوحة التحكم").closest("a")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("dashboard");
  });

  it("has no axe violations", async () => {
    const { container } = render(<SidebarNav items={items} activeId="inventory" ariaLabel="التنقل" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
