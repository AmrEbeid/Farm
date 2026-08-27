import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "app/(app)/dashboard/owner/page.tsx"),
  "utf8",
);

describe("owner home surface", () => {
  it("uses one bounded snapshot and no raw table reads", () => {
    expect(source.match(/\.rpc\(/g)).toHaveLength(1);
    expect(source).toContain('.rpc("fn_owner_home_snapshot"');
    expect(source).toContain("p_detail_limit: OWNER_HOME_DETAIL_LIMIT");
    expect(source).not.toContain(".from(");
    expect(source).not.toContain("Promise.all");
  });

  it("keeps the decision story compact", () => {
    expect(source.match(/<KpiCard/g)).toHaveLength(4);
    expect(source).toContain("<AttentionInbox");
    expect(source).toContain("isAuthoritative(snapshot.authority.budgets)");
    expect(source).toContain("attention.pendingPaymentApprovals");
    expect(source).toContain("attention.pendingAgronomySignoffs");
    // SPEC-0033 visual compaction: the full-width "ما الذي تغير؟" section carried no real
    // comparison data (its only content was "not available yet") and is removed rather than
    // occupying a full-width slot for an honest-null message with nothing to drill into.
    expect(source).not.toContain("ما الذي تغير؟");
    expect(source).toContain("لماذا تحتاج هذه البنود للمتابعة؟");
    expect(source).not.toContain("QuickNav");
    expect(source).not.toContain("DashboardTabs");
    expect(source).not.toContain("FilterableTable");
    expect(source).not.toContain("@/components/charts");
  });
});
