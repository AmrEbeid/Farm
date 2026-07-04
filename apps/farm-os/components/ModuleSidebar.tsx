"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AppModule } from "@/lib/nav";

export function ModuleSidebar({
  modules,
  activeNavId,
  onNavigate,
}: {
  modules: AppModule[];
  activeNavId: string;
  onNavigate: () => void;
}) {
  const initialOpen = useMemo(
    () => new Set(modules.filter((m) => m.pages.some((p) => p.id === activeNavId)).map((m) => m.id)),
    [modules, activeNavId],
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
      <ul className="fos-sidebarnav__list">
        {modules.map((module, idx) => {
          const moduleOpen = open.has(module.id) || module.pages.some((p) => p.id === activeNavId);
          const pagesId = `module-nav-${module.id}`;
          // SPEC-0025 U-5: one «الإدارة» section header before the first admin-group module.
          const firstAdmin =
            (module.group ?? "admin") === "admin" &&
            (idx === 0 || (modules[idx - 1].group ?? "admin") === "tasks");
          return (
            <li key={module.id} className="farm-module-nav__module">
              {firstAdmin && (
                <div
                  className="px-3 pb-1 pt-3 text-xs font-bold"
                  style={{ color: "var(--ink-muted)", borderTop: "1px solid var(--line)", marginTop: "8px" }}
                >
                  الإدارة
                </div>
              )}
              <button
                type="button"
                className="farm-module-nav__toggle"
                aria-expanded={moduleOpen}
                aria-controls={pagesId}
                onClick={() => toggle(module.id)}
              >
                <span className="fos-navitem__icon" aria-hidden="true">
                  {module.icon}
                </span>
                <span className="farm-module-nav__label">{module.label}</span>
                <span className="farm-module-nav__chevron" aria-hidden="true">
                  {moduleOpen ? "▾" : "◂"}
                </span>
              </button>
              {moduleOpen && (
                <ul id={pagesId} className="farm-module-nav__pages">
                  {module.pages.map((page) => {
                    const active = page.id === activeNavId;
                    return (
                      <li key={page.id}>
                        <Link
                          href={page.href}
                          className={`fos-navitem farm-module-nav__page${active ? " fos-navitem--active" : ""}`}
                          aria-current={active ? "page" : undefined}
                          onClick={onNavigate}
                        >
                          <span className="fos-navitem__icon" aria-hidden="true">
                            {page.icon}
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
