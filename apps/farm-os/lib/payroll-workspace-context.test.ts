// R4b — the payroll workspace's URL contract.
//
// Mirrors lib/inventory-list-context.test.ts: it keeps the workspace's paging state in the URL so
// opening a run never loses it, and it makes the `?from=` return path SAFE — validated, restricted to
// the payroll workspace, and REBUILT from validated parts, so a hostile string can never become an
// off-site link or an open redirect.

import { describe, expect, it } from "vitest";
import {
  EMPTY_PAYROLL_WORKSPACE_CONTEXT,
  PAYROLL_WORKSPACE_MAX_PAGE,
  PAYROLL_WORKSPACE_PATH,
  parsePayrollReturnTo,
  parsePayrollWorkspaceContext,
  parsePayrollWorkspacePage,
  payrollPageCount,
  payrollRunHref,
  payrollRunLineHref,
  payrollWorkspaceHref,
  payrollWorkspaceOffset,
  readPayrollRunLineRequest,
  readPayrollWorkspaceRequest,
} from "./payroll-workspace-context";

const RUN_ID = "22222222-2222-4222-8222-222222222221";

describe("payroll workspace url state", () => {
  it("reads a page number and refuses anything that is not one", () => {
    expect(parsePayrollWorkspacePage("3")).toBe(3);
    expect(parsePayrollWorkspacePage(String(PAYROLL_WORKSPACE_MAX_PAGE))).toBe(PAYROLL_WORKSPACE_MAX_PAGE);
    for (const raw of [undefined, "", "0", "-1", "1.5", "abc", "1e3", " 2", "99999999"]) {
      expect(parsePayrollWorkspacePage(raw), String(raw)).toBe(1);
    }
    expect(parsePayrollWorkspacePage(String(PAYROLL_WORKSPACE_MAX_PAGE + 1))).toBe(1);
  });

  it("parses a whole context", () => {
    expect(parsePayrollWorkspaceContext({ page: "2" })).toEqual({ page: 2 });
    expect(parsePayrollWorkspaceContext({})).toEqual(EMPTY_PAYROLL_WORKSPACE_CONTEXT);
  });

  it("builds one canonical url, omitting the default page", () => {
    expect(payrollWorkspaceHref()).toBe(PAYROLL_WORKSPACE_PATH);
    expect(payrollWorkspaceHref({ page: 1 })).toBe(PAYROLL_WORKSPACE_PATH);
    expect(payrollWorkspaceHref({ page: 3 })).toBe("/people/payroll?page=3");
  });

  it("carries the workspace page into the run link, and nothing else", () => {
    expect(payrollRunHref(RUN_ID, EMPTY_PAYROLL_WORKSPACE_CONTEXT)).toBe(`/people/payroll/${RUN_ID}`);
    expect(payrollRunHref(RUN_ID, { page: 2 }))
      .toBe(`/people/payroll/${RUN_ID}?from=%2Fpeople%2Fpayroll%3Fpage%3D2`);
  });

  it("normalises a request to exactly one canonical url", () => {
    expect(readPayrollWorkspaceRequest({})).toEqual({ context: EMPTY_PAYROLL_WORKSPACE_CONTEXT, redirectTo: null });
    expect(readPayrollWorkspaceRequest({ page: "2" })).toEqual({ context: { page: 2 }, redirectTo: null });
    for (const params of [{ page: "1" }, { page: "0" }, { page: "abc" }]) {
      expect(readPayrollWorkspaceRequest(params).redirectTo, JSON.stringify(params)).toBe(PAYROLL_WORKSPACE_PATH);
    }
  });

  it("never loops: the url it redirects to is itself canonical", () => {
    for (const params of [{ page: "0" }, { page: "abc" }, { page: "99999999" }]) {
      const first = readPayrollWorkspaceRequest(params);
      const target = first.redirectTo ?? payrollWorkspaceHref(first.context);
      const search = new URLSearchParams(target.split("?")[1] ?? "");
      const second = readPayrollWorkspaceRequest({ page: search.get("page") ?? undefined });
      expect(second.redirectTo, target).toBeNull();
    }
  });

  it("turns a page number into the offset the RPC is asked for, and pages an exact total exactly", () => {
    expect(payrollWorkspaceOffset(1, 20)).toBe(0);
    expect(payrollWorkspaceOffset(3, 20)).toBe(40);
    expect(payrollPageCount("0", 20)).toBe(1);
    expect(payrollPageCount("20", 20)).toBe(1);
    expect(payrollPageCount("21", 20)).toBe(2);
    expect(payrollPageCount("9007199254740993", 1)).toBe(9007199254740993);
  });
});

describe("payroll return path", () => {
  it("accepts the payroll workspace and rebuilds it from validated parts", () => {
    expect(parsePayrollReturnTo("/people/payroll")).toBe("/people/payroll");
    expect(parsePayrollReturnTo("/people/payroll?page=2")).toBe("/people/payroll?page=2");
    expect(parsePayrollReturnTo("/people/payroll?page=0&evil=1#x")).toBe("/people/payroll");
  });

  it("never leaves the site, whatever it is handed", () => {
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "http://evil.example/people/payroll",
      "javascript:alert(1)",
      "mailto:a@b.example",
      "//evil.example/people/payroll",
      "/people/payroll\\@evil.example",
      " /people/payroll",
      "\t/people/payroll",
      "people/payroll",
      "",
      undefined,
    ]) {
      expect(parsePayrollReturnTo(hostile), String(hostile)).toBe(PAYROLL_WORKSPACE_PATH);
    }
  });

  it("refuses to become a general-purpose internal redirector", () => {
    for (const other of [
      "/people/payroll/compensation",
      "/people/payroll/readiness",
      `/people/payroll/${RUN_ID}`,
      "/people/dashboard",
      "/dashboard",
      "/people/payroll/",
    ]) {
      expect(parsePayrollReturnTo(other), other).toBe(PAYROLL_WORKSPACE_PATH);
    }
    expect(parsePayrollReturnTo(`/people/payroll?page=${"9".repeat(400)}`)).toBe(PAYROLL_WORKSPACE_PATH);
  });

  it("is idempotent, so a link built from it never drifts", () => {
    for (const raw of ["/people/payroll", "/people/payroll?page=4", "/people/payroll?page=9"]) {
      const once = parsePayrollReturnTo(raw);
      expect(parsePayrollReturnTo(once)).toBe(once);
    }
  });
});

describe("payroll run line page url state", () => {
  it("builds a canonical run url, omitting defaults", () => {
    expect(payrollRunLineHref(RUN_ID, 1, null)).toBe(`/people/payroll/${RUN_ID}`);
    expect(payrollRunLineHref(RUN_ID, 2, null)).toBe(`/people/payroll/${RUN_ID}?lines=2`);
    expect(payrollRunLineHref(RUN_ID, 2, "/people/payroll?page=3"))
      .toBe(`/people/payroll/${RUN_ID}?lines=2&from=%2Fpeople%2Fpayroll%3Fpage%3D3`);
  });

  it("normalises a run line request to one canonical url", () => {
    expect(readPayrollRunLineRequest(RUN_ID, {})).toEqual({ page: 1, from: PAYROLL_WORKSPACE_PATH, redirectTo: null });
    expect(readPayrollRunLineRequest(RUN_ID, { lines: "2" })).toEqual({ page: 2, from: PAYROLL_WORKSPACE_PATH, redirectTo: null });
    for (const params of [{ lines: "1" }, { lines: "0" }, { lines: "abc" }]) {
      expect(readPayrollRunLineRequest(RUN_ID, params).redirectTo, JSON.stringify(params))
        .toBe(`/people/payroll/${RUN_ID}`);
    }
  });

  it("never loops on its own canonical url", () => {
    for (const params of [{ lines: "0" }, { lines: "abc" }, { from: "/dashboard" }]) {
      const first = readPayrollRunLineRequest(RUN_ID, params);
      const target = first.redirectTo ?? payrollRunLineHref(RUN_ID, first.page, null);
      const search = new URLSearchParams(target.split("?")[1] ?? "");
      const second = readPayrollRunLineRequest(RUN_ID, {
        lines: search.get("lines") ?? undefined,
        from: search.get("from") ?? undefined,
      });
      expect(second.redirectTo, target).toBeNull();
    }
  });
});
