import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(__dirname, "../app/(app)/support/page.tsx"), "utf8");
const actions = readFileSync(resolve(__dirname, "../app/(app)/support/actions.ts"), "utf8");
const nav = readFileSync(resolve(__dirname, "./nav.ts"), "utf8");
const migration = readFileSync(resolve(__dirname, "../supabase/migrations/20260825120000_system_tickets.sql"), "utf8");

describe("system support tickets", () => {
  it("lets every authenticated role open and submit from the support page", () => {
    expect(page).toContain("requireMembership()");
    expect(page).not.toContain("requireRole(");
    expect(nav).toContain('{ id: "support", label: "الدعم والتطوير"');
    expect(nav).not.toMatch(/id: "support"[^\n]*roles:/);
    expect(actions).toContain("await requireMembership()");
  });

  it("limits queue management to the owner", () => {
    expect(actions).toContain('await requireRole(["owner"])');
    expect(migration).toContain("created_by = auth.uid() or public.authorize('site.write', org_id)");
    expect(migration).toContain("create policy system_tickets_owner_update");
  });

  it("keeps tickets org-scoped, immutable by submitters, and out of the shared audit log", () => {
    expect(migration).toContain("org_id in (select public.user_org_ids())");
    expect(migration).toContain("revoke delete, truncate");
    expect(migration).not.toContain("fn_audit");
    expect(migration).not.toContain("audit_log(");
  });
});
