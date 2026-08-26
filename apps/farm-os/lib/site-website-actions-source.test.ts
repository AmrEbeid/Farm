import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(
  new URL("../app/(app)/website/actions.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/(app)/website/page.tsx", import.meta.url),
  "utf8",
);

describe("website server-action safety contract", () => {
  it("authorizes and validates before privileged storage or database work", () => {
    const auth = actions.indexOf('m.role !== "owner" || input.orgId !== m.orgId');
    const mapValidation = actions.indexOf("normalizeSiteMapUrl(");
    const certValidation = actions.indexOf("validateCertifications(");
    const admin = actions.indexOf("createAdminClient();", certValidation);
    const rpc = actions.indexOf('sb.rpc("fn_save_site_content"');

    expect(auth).toBeGreaterThan(-1);
    expect(mapValidation).toBeGreaterThan(auth);
    expect(certValidation).toBeGreaterThan(mapValidation);
    expect(admin).toBeGreaterThan(certValidation);
    expect(rpc).toBeGreaterThan(admin);
  });

  it("deletes gallery orphans only after a successful content RPC", () => {
    const rpc = actions.indexOf('sb.rpc("fn_save_site_content"');
    const errorReturn = actions.indexOf("if (error) return", rpc);
    const remove = actions.indexOf('.from("site-media").remove(', errorReturn);

    expect(rpc).toBeGreaterThan(-1);
    expect(errorReturn).toBeGreaterThan(rpc);
    expect(remove).toBeGreaterThan(errorReturn);
  });

  it("namespaces uploads and cleanup by the authenticated organization", () => {
    expect(actions).toContain('galleryMediaPaths(content, publicBucketPrefix, m.orgId)');
    expect(actions).toContain('`${m.orgId}/${folder}/${crypto.randomUUID()}.${IMAGE_EXT[type]}`');
  });

  it("fails closed when stored website content cannot be loaded", () => {
    expect(page).toContain('.eq("org_id", m.orgId)');
    expect(page).toContain("if (error) throw error");
    expect(page).toContain("لم يتم فتح المحرر لحماية بيانات الموقع");
  });

  it("revalidates every public route from the shared registry after a successful save", () => {
    const errorReturn = actions.indexOf("if (error) return");
    const revalidation = actions.indexOf(
      "for (const path of SITE_PUBLIC_PATHS) revalidatePath(path);",
    );

    expect(actions).toContain('import { SITE_PUBLIC_PATHS } from "@/lib/site-public-pages";');
    expect(revalidation).toBeGreaterThan(errorReturn);
  });
});
