import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { AppShell } from "./AppShell";
import type { NavItemData } from "./NavItem";

const navItems: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

function shell(extra?: Partial<React.ComponentProps<typeof AppShell>>) {
  return (
    <AppShell
      navItems={navItems}
      activeNavId="palms"
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      brand={<span>مزرعة عبيد</span>}
      topbar={<span>الشريط العلوي</span>}
      {...extra}
    >
      <h1>المحتوى</h1>
    </AppShell>
  );
}

describe("AppShell", () => {
  it("renders banner, sidebar nav, and main landmarks", () => {
    render(shell());
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("filters sidebar items by role and marks the active one", () => {
    render(shell({ role: "worker" }));
    expect(screen.queryByText("الإعدادات")).not.toBeInTheDocument();
    expect(screen.getByText("النخيل").closest("a")).toHaveAttribute("aria-current", "page");
  });

  it("toggles the mobile drawer via the menu button and reports state", async () => {
    const onSidebarOpenChange = vi.fn();
    render(shell({ onSidebarOpenChange }));
    const btn = screen.getByRole("button", { name: "فتح القائمة" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(onSidebarOpenChange).toHaveBeenCalledWith(true);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the drawer on Escape when open", async () => {
    const onSidebarOpenChange = vi.fn();
    render(shell({ sidebarOpen: true, onSidebarOpenChange }));
    await userEvent.keyboard("{Escape}");
    expect(onSidebarOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no axe violations", async () => {
    const { container } = render(shell());
    expect(await axe(container)).toHaveNoViolations();
  });
});
