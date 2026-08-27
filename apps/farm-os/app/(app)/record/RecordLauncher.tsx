import Link from "next/link";
import type { Role } from "@/lib/auth";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { NavIcon } from "@/components/NavIcon";
import { groupVisibleActions } from "@/lib/record-actions";

export function RecordLauncher({ role }: { role: Role }) {
  const visibleGroups = groupVisibleActions(role);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageHeader title="ماذا تريد أن تسجّل؟" subtitle="احكِ ما حدث — والنظام يتولى الدفاتر والتصنيف والتوجيه." />
      <div className="flex flex-col gap-6">
        {visibleGroups.map((group) => (
          <section key={group.id} aria-labelledby={`record-group-${group.id}`}>
            <div className="mb-2">
              <h2 id={`record-group-${group.id}`} className="text-base font-bold" style={{ color: "var(--ink)" }}>
                {group.title}
              </h2>
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                {group.hint}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.actions.map((action) => (
                <Link key={action.title} href={action.href} className="block h-full">
                  <Card className="h-full">
                    <div className="flex items-start gap-3 p-1">
                      <span aria-hidden style={{ color: "var(--ink-muted)" }}>
                        <NavIcon name={action.icon} size={20} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold" style={{ color: "var(--ink)" }}>
                          {action.title}
                        </div>
                        <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                          {action.hint}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
