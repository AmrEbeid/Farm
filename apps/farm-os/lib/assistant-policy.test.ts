import { describe, it, expect } from "vitest";
import { assistantMayCall, assertRlsScopedClient } from "./assistant-policy";

describe("assistant capability boundary (SPEC-0005 §2 / lethal-trifecta)", () => {
  it("allows an explicitly allow-listed read RPC", () => {
    expect(assistantMayCall("fn_stock_coverage").allowed).toBe(true);
  });

  it("§2.2 refuses EVERY write RPC (read-only)", () => {
    for (const w of [
      "fn_save_sector",
      "fn_archive_structure",
      "fn_execute_operation",
      "fn_record_event",
      "fn_create_plan",
      "fn_post_receipt",
      "fn_reserve_stock",
      "fn_update_palm_status",
    ]) {
      const d = assistantMayCall(w);
      expect(d.allowed, w).toBe(false);
    }
  });

  it("§2.2 refuses compensation / payroll / PII (SPEC-0006 parity)", () => {
    for (const s of ["people_compensation", "get_payroll", "fn_read_salary", "people_phone", "export_email"]) {
      expect(assistantMayCall(s).allowed, s).toBe(false);
    }
  });

  it("§2.3 refuses any outbound / send tool", () => {
    for (const o of ["send_whatsapp", "email_report", "sms_alert", "notify_owner", "post_webhook"]) {
      expect(assistantMayCall(o).allowed, o).toBe(false);
    }
  });

  it("§2.1 refuses privileged / service-role tools", () => {
    for (const p of ["service_role_query", "admin_reset", "set_role_postgres", "bypassrls_read"]) {
      expect(assistantMayCall(p).allowed, p).toBe(false);
    }
  });

  it("deny-by-default: an unknown or empty tool is refused", () => {
    expect(assistantMayCall("fn_some_new_thing").allowed).toBe(false);
    expect(assistantMayCall("").allowed).toBe(false);
    expect(assistantMayCall("random_table").allowed).toBe(false);
  });

  it("§2.1 the data client must be the RLS-scoped session client", () => {
    expect(() => assertRlsScopedClient("session")).not.toThrow();
    expect(() => assertRlsScopedClient("service_role")).toThrow();
    expect(() => assertRlsScopedClient("admin")).toThrow();
  });
});
