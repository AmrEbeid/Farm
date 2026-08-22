"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { NavIcon } from "@/components/NavIcon";
import type { AppModule, PrimaryNavItem } from "@/lib/nav";

export function ModuleSidebar({
  primaryItems,
  workspaces,
  activeNavId,
  activePrimaryNavId,
  activePrimaryIsExact,
  onNavigate,
}: {
  primaryItems: PrimaryNavItem[];
  workspaces: AppModule[];
  activeNavId: string;
  activePrimaryNavId: string | null;
  activePrimaryIsExact: boolean;
  onNavigate: () => void;
}) {
  const initialOpen = useMemo(
    () => new Set(workspaces.filter((m) => m.pages.some((p) => p.id === activeNavId)).map((m) => m.id)),
    [workspaces, activeNavId],
  );
  const [open, setOpen] = useState<Set<string>>(initialOpen);

  function toggle(moduleId: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  return (
    <nav className="fos-sidebarnav farm-module-nav" aria-label="التنقل الرئيسي">
      <div className="farm-module-nav__section-label">العمل اليومي</div>
      <ul className="fos-sidebarnav__list farm-module-nav__primary">
        {primaryItems.map((item) => {
          const active = item.id === activePrimaryNavId;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className={`fos-navitem farm-module-nav__primary-link${active ? " fos-navitem--active" : ""}`}
                aria-current={active ? (activePrimaryIsExact ? "page" : "location") : undefined}
                onClick={onNavigate}
              >
                <span className="fos-navitem__icon">
                  <NavIcon name={item.icon} />
                </span>
                <span className="fos-navitem__label">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="farm-module-nav__section-label farm-module-nav__workspace-label">مساحات العمل</div>
      <ul className="fos-sidebarnav__list">
        {workspaces.map((module) => {
          const moduleOpen = open.has(module.id) || module.pages.some((p) => p.id === activeNavId);
          const pagesId = `module-nav-${module.id}`;
          return (
            <li key={module.id} className="farm-module-nav__module">
              <button
                type="button"
                className="farm-module-nav__toggle"
                aria-expanded={moduleOpen}
                aria-controls={pagesId}
                onClick={() => toggle(module.id)}
              >
                <span className="fos-navitem__icon">
                  <NavIcon name={module.icon} />
                </span>
                <span className="farm-module-nav__label">{module.label}</span>
                <span className="farm-module-nav__chevron" aria-hidden="true">
                  {moduleOpen ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                </span>
              </button>
              {moduleOpen && (
                <ul id={pagesId} className="farm-module-nav__pages">
                  {module.pages.map((page, index) => {
                    const active = page.id === activeNavId;
                    const showSection =
                      page.section &&
                      (index === 0 || module.pages[index - 1]?.section !== page.section);
                    return (
                      <li key={page.id}>
                        {showSection && <div className="farm-module-nav__page-section">{page.section}</div>}
                        <Link
                          href={page.href}
                          className={`fos-navitem farm-module-nav__page${active ? " fos-navitem--active" : ""}`}
                          aria-current={active ? "page" : undefined}
                          onClick={onNavigate}
                        >
                          <span className="fos-navitem__icon">
                            <NavIcon name={page.icon} size={16} />
                          </span>
                          <span className="fos-navitem__label">{page.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
