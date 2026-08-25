import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(__dirname, "../app/(app)/support/page.tsx"), "utf8");
const actions = readFileSync(resolve(__dirname, "../app/(app)/support/actions.ts"), "utf8");
const component = readFileSync(resolve(__dirname, "../components/SupportTickets.tsx"), "utf8");
const nav = readFileSync(resolve(__dirname, "./nav.ts"), "utf8");
const migration = readFileSync(resolve(__dirname, "../supabase/migrations/20260825120000_system_tickets.sql"), "utf8");
const attachmentMigration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260825130000_system_ticket_attachments.sql"),
  "utf8",
);
const storagePolicies = readFileSync(
  resolve(__dirname, "../supabase/support-attachments-storage-policies.sql"),
  "utf8",
);

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

  it("shows and updates the request workflow status", () => {
    expect(component).toContain('in_progress: "جارٍ العمل"');
    expect(component).toContain('done: "مكتمل"');
    expect(component).toContain('blocked: "متوقف"');
    expect(component).toContain('name="status"');
    expect(actions).toContain("updateSystemTicket");
  });

  it("accepts bounded screenshots and documents without executable formats", () => {
    expect(component).toContain("MAX_FILES = 5");
    expect(component).toContain("MAX_FILE_BYTES = 26214400");
    expect(component).toContain(".pdf,.doc,.docx");
    expect(component).not.toContain(".svg");
    expect(actions).toContain("addSystemTicketAttachment");
    expect(attachmentMigration).toContain("size_bytes between 1 and 26214400");
    expect(attachmentMigration).not.toContain("image/svg+xml");
  });

  it("keeps attachment metadata and bytes private to the submitter or owner", () => {
    expect(attachmentMigration).toContain("alter table public.system_ticket_attachments force row level security");
    expect(attachmentMigration).toContain("ticket.created_by = auth.uid() or public.authorize('site.write', ticket.org_id)");
    expect(attachmentMigration).toContain("revoke update, delete, truncate");
    expect(storagePolicies).toContain("'support-attachments'");
    expect(storagePolicies).toContain("false,");
    expect(storagePolicies).toContain("support_attachments_read_ticket");
    expect(storagePolicies).toContain("support_attachments_insert_ticket");
    expect(storagePolicies).toContain("support_attachments_delete_unregistered");
    expect(storagePolicies).not.toMatch(/for update/i);
    expect(storagePolicies).toContain("attachment.storage_path = storage.objects.name");
    expect(page).toContain('createSignedUrls(attachmentPaths, 300)');
    expect(component.indexOf("validateAttachments(attachments)")).toBeLessThan(
      component.indexOf("createSystemTicket(formData)"),
    );
    expect(actions).toContain("supportAttachmentMatchesSignature");
    expect(actions).toContain('sb.storage.from("support-attachments").remove([input.storagePath])');
    expect(actions).not.toContain('admin.storage.from("support-attachments").remove');
    expect(component).toContain("outcome.uploaded} من ${outcome.total}");
  });
});
