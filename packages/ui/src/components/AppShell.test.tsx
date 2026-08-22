import { beforeEach, it, expect, describe, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppShell } from "./AppShell";
import type { NavItemData } from "./NavItem";

const navItems: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

let mobileViewport = true;
const viewportListeners = new Set<() => void>();

function setMobileViewport(matches: boolean) {
  mobileViewport = matches;
  act(() => viewportListeners.forEach((listener) => listener()));
}

vi.stubGlobal("matchMedia", (query: string) => ({
  get matches() { return query === "(max-width: 48rem)" ? mobileViewport : false; },
  media: query,
  addEventListener: (_type: string, listener: () => void) => viewportListeners.add(listener),
  removeEventListener: (_type: string, listener: () => void) => viewportListeners.delete(listener),
}));

beforeEach(() => {
  mobileViewport = true;
  viewportListeners.clear();
});

function shell(extra?: Partial<React.ComponentProps<typeof AppShell>>) {
  return (
    <AppShell
      navItems={navItems}
      activeNavId="palms"
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      brand={<span>مزرعة عبيد</span>}
      topbar={<span>الشريط العلوي</span>}
      skipLink={<a href="#content">تخطّي إلى المحتوى</a>}
      mobileNavigation={<nav aria-label="التنقل السفلي">التنقل السفلي</nav>}
      {...extra}
    >
      <div id="content">
        <h1>المحتوى</h1>
      </div>
    </AppShell>
  );
}

/** Stand-in for the app-owned sidebar R1b will pass: its own nav, links and a non-link toggle. */
function CustomSidebar() {
  return (
    <nav aria-label="تنقل التطبيق">
      <button type="button">المزرعة</button>
      <a href="/palms">النخيل</a>
    </nav>
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

  it("renders the generated nav with no navItems supplied", () => {
    render(shell({ navItems: undefined }));
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    expect(nav).toBeInTheDocument();
    expect(nav.querySelectorAll("a")).toHaveLength(0);
  });

  it("preserves legacy empty-aside consumers without trapping or inerting their main content", () => {
    render(shell({ navItems: undefined, sidebarOpen: true }));
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("banner")).not.toHaveAttribute("inert");
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(document.querySelector(".fos-appshell__sidebar-panel")).not.toHaveAttribute("role");
  });

  it("does not activate a modal drawer when role filtering leaves no generated items", () => {
    render(shell({ navItems: [navItems[2]], role: "worker", sidebarOpen: true }));
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(document.querySelector(".fos-appshell__sidebar-panel")).not.toHaveAttribute("role");
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

  it("points the menu button's aria-controls at the sidebar element", () => {
    const { container } = render(shell());
    const btn = screen.getByRole("button", { name: "فتح القائمة" });
    const aside = container.querySelector("aside");
    expect(btn.getAttribute("aria-controls")).toBe(aside?.id);
    expect(aside?.id).toBeTruthy();
  });

  it("closes the drawer on Escape when open", async () => {
    const onSidebarOpenChange = vi.fn();
    render(shell({ sidebarOpen: true, onSidebarOpenChange }));
    await userEvent.keyboard("{Escape}");
    expect(onSidebarOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the drawer when the overlay is clicked", async () => {
    const onSidebarOpenChange = vi.fn();
    const { container } = render(shell({ sidebarOpen: true, onSidebarOpenChange }));
    const overlay = container.querySelector(".fos-appshell__overlay") as HTMLElement;
    expect(overlay).not.toHaveAttribute("hidden");
    await userEvent.click(overlay);
    expect(onSidebarOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the shell and aside open so the drawer stacks above the overlay", () => {
    const { container } = render(shell({ sidebarOpen: true }));
    expect(container.querySelector(".fos-appshell")).toHaveClass("fos-appshell--drawer-open");
    expect(container.querySelector("aside")).toHaveAttribute("data-open", "true");
  });

  it("keeps shell layers below modals, hides the closed mobile drawer, and preserves a 44px menu target", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");
    expect(css).toMatch(
      /\.fos-appshell__overlay\s*\{[^}]*position:fixed;[^}]*inset:0;[^}]*z-index:calc\(var\(--z-modal\) - 2\);/s
    );
    expect(css).toMatch(
      /\.fos-appshell__sidebar\s*\{[^}]*z-index:calc\(var\(--z-modal\) - 1\);[^}]*visibility:hidden;[^}]*pointer-events:none;/s
    );
    expect(css).toMatch(/\.fos-appshell__sidebar\[data-open\]\s*\{[^}]*visibility:visible;[^}]*pointer-events:auto;/s);
    expect(css).toMatch(
      /\.fos-appshell__menu-btn\s*\{[^}]*min-inline-size:44px;[^}]*min-block-size:44px;/s
    );
    expect(css).toMatch(
      /@media \(max-width:48rem\)[\s\S]*?\.fos-appshell\s*\{[^}]*grid-template-columns:minmax\(0,1fr\);/s
    );
    expect(css).toMatch(/\.fos-appshell__topbar-content\s*\{[^}]*min-inline-size:0;/s);
    expect(css).toMatch(
      /@media \(max-width:48rem\)[\s\S]*?\.fos-appshell__topbar-content\s*\{[^}]*flex:1 1 0;[^}]*flex-wrap:wrap;/s
    );
    expect(css).toMatch(
      /\.fos-appshell\s*\{[^}]*block-size:100dvh;[^}]*overflow:hidden;[^}]*grid-template-columns:240px minmax\(0,1fr\);[^}]*grid-template-rows:auto minmax\(0,1fr\);/s
    );
    expect(css).toMatch(/\.fos-appshell__sidebar\s*\{[^}]*min-block-size:0;[^}]*overflow-y:auto;/s);
    expect(css).toMatch(/\.fos-appshell__main\s*\{[^}]*min-inline-size:0;[^}]*min-block-size:0;[^}]*overflow:auto;/s);
  });

  it("moves focus into an opened drawer, traps it, and restores the menu trigger on Escape", async () => {
    render(shell({ sidebar: <CustomSidebar /> }));
    const menu = screen.getByRole("button", { name: "فتح القائمة" });
    await userEvent.click(menu);
    const first = screen.getByRole("button", { name: "المزرعة" });
    const last = screen.getByRole("link", { name: "النخيل" });
    expect(first).toHaveFocus();
    last.focus();
    await userEvent.tab();
    expect(first).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(menu).toHaveFocus();
  });

  it("marks background regions inert only while the mobile drawer is active", () => {
    const { container } = render(shell({ sidebarOpen: true }));
    expect(screen.getByRole("dialog", { name: "التنقل الرئيسي" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("banner")).toHaveAttribute("inert");
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    for (const slot of container.querySelectorAll(".fos-appshell__background-slot")) {
      expect(slot).toHaveAttribute("inert");
    }
    setMobileViewport(false);
    expect(container.querySelector(".fos-appshell__sidebar-panel")).not.toHaveAttribute("role");
    expect(screen.getByRole("banner")).not.toHaveAttribute("inert");
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    for (const slot of container.querySelectorAll(".fos-appshell__background-slot")) {
      expect(slot).not.toHaveAttribute("inert");
    }
  });

  it("releases focus trapping and body scroll lock when resizing an open drawer to desktop", () => {
    render(shell({ sidebarOpen: true }));
    expect(document.body.style.overflow).toBe("hidden");
    setMobileViewport(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the RTL mobile drawer contract: open aside plus a dismissible overlay", async () => {
    const onSidebarOpenChange = vi.fn();
    const { container } = render(
      <div dir="rtl">{shell({ sidebarOpen: true, onSidebarOpenChange })}</div>
    );
    expect(container.querySelector("aside")).toHaveAttribute("data-open", "true");
    const overlay = container.querySelector(".fos-appshell__overlay") as HTMLElement;
    expect(overlay).not.toHaveAttribute("hidden");
    await userEvent.click(overlay);
    expect(onSidebarOpenChange).toHaveBeenCalledWith(false);
  });

  describe("custom slots", () => {
    it("replaces the generated nav with the supplied sidebar", () => {
      render(shell({ sidebar: <CustomSidebar /> }));
      expect(screen.getByRole("navigation", { name: "تنقل التطبيق" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "التنقل الرئيسي" })).not.toBeInTheDocument();
      expect(screen.queryByText("لوحة التحكم")).not.toBeInTheDocument();
    });

    it("closes the drawer when a custom sidebar link is followed, but not on a toggle button", async () => {
      const onSidebarOpenChange = vi.fn();
      render(shell({ sidebar: <CustomSidebar />, sidebarOpen: true, onSidebarOpenChange }));
      await userEvent.click(screen.getByRole("button", { name: "المزرعة" }));
      expect(onSidebarOpenChange).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("link", { name: "النخيل" }));
      expect(onSidebarOpenChange).toHaveBeenCalledWith(false);
    });

    it("renders the fallback glyph, or a supplied menu icon, inside the labelled button", () => {
      const { unmount } = render(shell());
      const btn = screen.getByRole("button", { name: "فتح القائمة" });
      expect(btn.querySelector(".fos-appshell__menu-icon")).toHaveTextContent("☰");
      unmount();

      render(shell({ menuIcon: <svg data-testid="menu-svg" /> }));
      const custom = screen.getByRole("button", { name: "فتح القائمة" });
      expect(custom).toContainElement(screen.getByTestId("menu-svg"));
      expect(custom).not.toHaveTextContent("☰");
    });
  });

  it("has no axe violations", async () => {
    const { container } = render(shell());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a custom sidebar and an open RTL drawer", async () => {
    const { container } = render(
      <div dir="rtl">
        {shell({ sidebar: <CustomSidebar />, menuIcon: <svg />, sidebarOpen: true })}
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
