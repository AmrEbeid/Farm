import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "../auth";
import {
  IMPORT_BODY_MISMATCH_AR,
  IMPORT_COMMIT_FORBIDDEN_AR,
  IMPORT_DESCRIPTOR_UNKNOWN_AR,
  IMPORT_MODES,
  IMPORT_MODE_INVALID_AR,
  IMPORT_ROLE_DENIED_AR,
  VALIDATION_ONLY_TEMPLATE_NOTES_AR,
  commitDenial,
  descriptorRoleDenial,
  importBodyDisagreement,
  importRequestFromQuery,
  type DescriptorLookup,
} from "./access";
import { planCommit } from "./commit-plan";
import { listDescriptors } from "./registry";
import { isValidationOnly, type ImportDescriptor, type ValidationOnlyImportDescriptor } from "./types";
import { buildTemplateSpec } from "./workbook-spec";
import "./descriptors"; // side-effect: registers all descriptors

/**
 * The import framework's two server-side gates.
 *
 * These exist because UI hiding is not a control: a validation-only descriptor must be unable to
 * commit, and a role-gated descriptor must be unable to read a template, when the request is made
 * directly against `/api/import` with no page involved. The behavioural half is asserted against the
 * pure functions; the ORDERING half — that both gates run before the request body is parsed at all —
 * is pinned against the route source, because nothing else in the toolchain can see it.
 *
 * The ordering claim only holds because the routing metadata is PRE-BODY. `descriptor` and `mode`
 * are query parameters, so `importRequestFromQuery` can answer "which descriptor, which mode" from
 * the request line; reading them from the multipart body would force `req.formData()` — and the
 * whole upload into memory — ahead of the gates that exist to stop it. Two things are therefore
 * asserted together below: that the resolver itself fails closed on absent/invalid metadata (real
 * behavioural tests, no request needed), and that the route calls it, and both gates, before
 * `req.formData()` appears at all.
 */

const ALL_ROLES: Role[] = [
  "owner",
  "farm_manager",
  "agri_engineer",
  "accountant",
  "supervisor",
  "storekeeper",
];

const ROUTE = join(process.cwd(), "app", "api", "import", "route.ts");
const PANEL = join(process.cwd(), "components", "import", "ImportPanel.tsx");
const routeSource = readFileSync(ROUTE, "utf8");
const panelSource = readFileSync(PANEL, "utf8");
const postSource = routeSource.slice(routeSource.indexOf("export async function POST"));
const getSource = routeSource.slice(
  routeSource.indexOf("export async function GET"),
  routeSource.indexOf("export async function POST"),
);

/** Index of the first occurrence, asserted present so a rename fails loudly instead of passing. */
function indexOfRequired(source: string, needle: string): number {
  const index = source.indexOf(needle);
  expect(index, `route source no longer contains "${needle}"`).toBeGreaterThan(-1);
  return index;
}

const gated: ValidationOnlyImportDescriptor = {
  key: "test-validation-only",
  titleAr: "اختبار",
  validationOnly: true,
  role: "payroll.read",
  allowedRoles: ["owner", "accountant"],
  columns: [{ key: "a", labelAr: "أ", type: "string", required: true, example: "مثال" }],
};

const ungated: ImportDescriptor = {
  key: "test-open",
  titleAr: "اختبار",
  rpc: "fn_test",
  role: "plan.write",
  columns: [{ key: "a", labelAr: "أ", type: "string", required: true, example: "مثال" }],
  toRpcArgs: (r) => ({ p_a: r.a }),
};

describe("descriptor role gate", () => {
  it("allows exactly the declared roles and denies every other one", () => {
    for (const role of ALL_ROLES) {
      const denial = descriptorRoleDenial(gated, role);
      if (role === "owner" || role === "accountant") {
        expect(denial, role).toBeNull();
      } else {
        expect(denial, role).toEqual({ error: IMPORT_ROLE_DENIED_AR, status: 403 });
      }
    }
  });

  it("leaves a descriptor without allowedRoles completely unchanged", () => {
    for (const role of ALL_ROLES) {
      expect(descriptorRoleDenial(ungated, role), role).toBeNull();
    }
  });

  it("never echoes the role or the descriptor back in the refusal", () => {
    const denial = descriptorRoleDenial(gated, "supervisor");
    expect(denial?.error).toBe(IMPORT_ROLE_DENIED_AR);
    expect(denial?.error).not.toContain("supervisor");
    expect(denial?.error).not.toContain(gated.key);
  });
});

describe("no-commit-path gate", () => {
  it("refuses a commit for a validation-only descriptor", () => {
    expect(commitDenial(gated, "commit")).toEqual({
      error: IMPORT_COMMIT_FORBIDDEN_AR,
      status: 403,
    });
  });

  it("still allows its dry-run (that is the whole point of the descriptor)", () => {
    expect(commitDenial(gated, "dry-run")).toBeNull();
  });

  it("takes a validated mode, so a non-commit value cannot be an unparsed one", () => {
    // `mode` is typed as ImportMode: `commitDenial(gated, "")` no longer compiles. The empty and
    // misspelled cases are refused earlier, by importRequestFromQuery, and are asserted there.
    expect(IMPORT_MODES).toEqual(["dry-run", "commit"]);
  });

  it("does not touch a descriptor that has a commit path", () => {
    expect(commitDenial(ungated, "commit")).toBeNull();
    expect(commitDenial(ungated, "dry-run")).toBeNull();
  });

  it("says in the message that a clean dry-run still writes nothing", () => {
    expect(IMPORT_COMMIT_FORBIDDEN_AR).toContain("للتحقق فقط");
    expect(IMPORT_COMMIT_FORBIDDEN_AR).toContain("لا يكتب");
  });
});

describe("commit planning is unreachable for a validation-only descriptor", () => {
  it("planCommit throws rather than building a plan", () => {
    expect(() => planCommit(gated, [{ a: "x" }])).toThrow(/no commit path/);
  });

  it("…for every registered validation-only descriptor", () => {
    const validationOnly = listDescriptors().filter(isValidationOnly);
    expect(validationOnly.length).toBeGreaterThan(0);
    for (const d of validationOnly) {
      expect(() => planCommit(d, [{}]), d.key).toThrow(/no commit path/);
    }
  });

  it("…and none of them carries an rpc, a table, an archive type or a match key at runtime", () => {
    for (const d of listDescriptors().filter(isValidationOnly)) {
      const loose = d as unknown as Record<string, unknown>;
      for (const forbidden of ["rpc", "toRpcArgs", "table", "archiveType", "matchKey", "fromRow", "dedupeKey"]) {
        expect(loose[forbidden], `${d.key}.${forbidden}`).toBeUndefined();
      }
    }
  });
});

describe("pre-body request metadata (resolved from the query, fail-closed)", () => {
  // A registry stand-in: same shape as getDescriptor, so the resolver is exercised exactly as the
  // route calls it, without registering fixtures globally.
  const fixtures = new Map<string, ImportDescriptor>([
    [gated.key, gated],
    [ungated.key, ungated],
  ]);
  const lookup: DescriptorLookup = (key) => fixtures.get(key);
  const q = (search: string) => new URLSearchParams(search);

  it("resolves a well-formed request for each mode", () => {
    for (const mode of IMPORT_MODES) {
      expect(importRequestFromQuery(q(`descriptor=${ungated.key}&mode=${mode}`), lookup), mode).toEqual({
        descriptor: ungated,
        mode,
      });
    }
  });

  it("refuses an absent or unknown descriptor with a fixed Arabic 400", () => {
    for (const search of ["", "mode=commit", "descriptor=&mode=commit", "descriptor=nope&mode=commit"]) {
      expect(importRequestFromQuery(q(search), lookup), search).toEqual({
        error: IMPORT_DESCRIPTOR_UNKNOWN_AR,
        status: 400,
      });
    }
  });

  it("refuses an absent, misspelled or near-miss mode with a fixed Arabic 400 — never a default", () => {
    // "commit " and "COMMIT" must NOT reach commit; "dry" and "" must NOT be coerced to a dry-run.
    for (const mode of ["", "dry", "DRY-RUN", "COMMIT", "commit ", " commit", "dry-run\n", "true", "1"]) {
      const params = new URLSearchParams({ descriptor: ungated.key, mode });
      expect(importRequestFromQuery(params, lookup), JSON.stringify(mode)).toEqual({
        error: IMPORT_MODE_INVALID_AR,
        status: 400,
      });
    }
    expect(importRequestFromQuery(q(`descriptor=${ungated.key}`), lookup)).toEqual({
      error: IMPORT_MODE_INVALID_AR,
      status: 400,
    });
  });

  it("checks the descriptor before the mode, so an unknown descriptor is never confirmed by a mode error", () => {
    expect(importRequestFromQuery(q("descriptor=nope&mode=bogus"), lookup)).toEqual({
      error: IMPORT_DESCRIPTOR_UNKNOWN_AR,
      status: 400,
    });
  });

  it("survives URL-encoded and duplicated parameters", () => {
    // %2D is "-", so an encoded mode still resolves; URLSearchParams decodes before we compare.
    expect(importRequestFromQuery(q(`descriptor=${ungated.key}&mode=dry%2Drun`), lookup)).toEqual({
      descriptor: ungated,
      mode: "dry-run",
    });
    // A duplicated parameter takes the FIRST value (URLSearchParams.get), not the last — pinned so a
    // "?mode=dry-run&mode=commit" smuggling attempt can't silently pick the write mode.
    expect(importRequestFromQuery(q(`descriptor=${ungated.key}&mode=dry-run&mode=commit`), lookup)).toEqual({
      descriptor: ungated,
      mode: "dry-run",
    });
  });

  it("never echoes the submitted descriptor or mode back in the refusal", () => {
    const denial = importRequestFromQuery(q("descriptor=secret-probe&mode=secret-mode"), lookup);
    expect(JSON.stringify(denial)).not.toContain("secret-probe");
    expect(JSON.stringify(denial)).not.toContain("secret-mode");
  });
});

describe("the body is never a routing input", () => {
  it("accepts a body that omits the metadata (the panel sends neither)", () => {
    expect(
      importBodyDisagreement({ descriptor: null, mode: null }, { descriptorKey: "sectors", mode: "commit" }),
    ).toBeNull();
  });

  it("accepts a body that agrees", () => {
    expect(
      importBodyDisagreement(
        { descriptor: "sectors", mode: "commit" },
        { descriptorKey: "sectors", mode: "commit" },
      ),
    ).toBeNull();
  });

  it("refuses a body that contradicts the gated metadata, on either field", () => {
    const gatedOn = { descriptorKey: "sectors", mode: "dry-run" } as const;
    for (const body of [
      { descriptor: "lines", mode: null },
      { descriptor: null, mode: "commit" },
      { descriptor: "lines", mode: "commit" },
      { descriptor: "", mode: null },
    ]) {
      expect(importBodyDisagreement(body, gatedOn), JSON.stringify(body)).toEqual({
        error: IMPORT_BODY_MISMATCH_AR,
        status: 400,
      });
    }
  });
});

/**
 * These are INTENT-level regexes, not exact literals. What the panel must do is put the routing
 * metadata in the query string and keep it out of the body; a Prettier rewrap or an added argument
 * changes neither, and an exact-literal assertion would fail on both. (The route-ordering checks
 * below stay exact-ish for the opposite reason: nothing else in the suite can see ordering, so the
 * call spellings there ARE the contract.)
 */
describe("the panel speaks the pre-body contract", () => {
  it("sends descriptor and mode in the query string, encoded", () => {
    expect(panelSource).toMatch(
      /new URLSearchParams\(\s*\{\s*descriptor:\s*descriptorKey\s*,\s*mode\s*,?\s*\}\s*\)/,
    );
    expect(panelSource).toMatch(/fetch\(\s*`\/api\/import\?\$\{query\}`/);
  });

  it("puts neither descriptor nor mode in the POST body", () => {
    // Tolerant of quote style and spacing, so a reformat cannot smuggle either one into the body.
    expect(panelSource).not.toMatch(/fd\.set\(\s*["']mode["']/);
    expect(panelSource).not.toMatch(/fd\.set\(\s*["']descriptor["']/);
  });

  it("encodes the descriptor in the GET template link too", () => {
    expect(panelSource).toMatch(
      /templateHref\s*=\s*`\/api\/import\?\$\{\s*new URLSearchParams\(\s*\{\s*descriptor:\s*descriptorKey\s*,?\s*\}\s*\)\s*\}`/,
    );
    expect(panelSource).not.toMatch(/\/api\/import\?descriptor=\$\{/);
  });
});

describe("route ordering (the gates run before the body is parsed at all)", () => {
  /**
   * THE load-bearing assertion. `req.formData()` parses the entire multipart upload into memory; a
   * gate that runs after it has already done the work it was meant to prevent. Asserting only
   * `form.get("file")` was not enough — that passes even when the body has already been parsed.
   */
  it("POST runs BOTH gates before req.formData() — the body is not parsed to decide them", () => {
    const bodyParse = indexOfRequired(postSource, "req.formData()");
    expect(indexOfRequired(postSource, "descriptorRoleDenial(")).toBeLessThan(bodyParse);
    expect(indexOfRequired(postSource, "commitDenial(")).toBeLessThan(bodyParse);
    // …and the metadata they need is itself resolved pre-body, from the query string.
    expect(indexOfRequired(postSource, "importRequestFromQuery(")).toBeLessThan(bodyParse);
    expect(indexOfRequired(postSource, "searchParams")).toBeLessThan(bodyParse);
  });

  it("POST never derives the descriptor or the mode from the body", () => {
    // A body value could only be read post-parse, which would defeat the ordering above. The route
    // may cross-check the body afterwards, but must never route on it.
    expect(postSource).not.toContain('form.get("descriptor")');
    expect(postSource).not.toContain('form.get("mode")');
    expect(postSource).not.toContain("getDescriptor(String(");
    // The one permitted use of the body's copy is the post-parse agreement check.
    const bodyParse = indexOfRequired(postSource, "req.formData()");
    expect(indexOfRequired(postSource, "importBodyDisagreement(")).toBeGreaterThan(bodyParse);
  });

  it("POST gates the role before the file is taken from the form or parsed", () => {
    const roleGate = indexOfRequired(postSource, "descriptorRoleDenial(");
    expect(roleGate).toBeLessThan(indexOfRequired(postSource, "req.formData()"));
    expect(roleGate).toBeLessThan(indexOfRequired(postSource, 'form.get("file")'));
    expect(roleGate).toBeLessThan(indexOfRequired(postSource, "arrayBuffer()"));
    expect(roleGate).toBeLessThan(indexOfRequired(postSource, "parseUpload("));
    expect(roleGate).toBeLessThan(indexOfRequired(postSource, "createClient()"));
  });

  it("POST refuses a validation-only commit before parsing, ref lookups and commit planning", () => {
    const commitGate = indexOfRequired(postSource, "commitDenial(");
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "req.formData()"));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, 'form.get("file")'));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "arrayBuffer()"));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "parseUpload("));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "resolveRefs("));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "fetchExistingRows("));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "planCommit("));
    expect(commitGate).toBeLessThan(indexOfRequired(postSource, "sb.rpc"));
  });

  it("GET gates the role before the existing-rows read and the template render", () => {
    const roleGate = indexOfRequired(getSource, "descriptorRoleDenial(");
    expect(roleGate).toBeLessThan(indexOfRequired(getSource, "createClient()"));
    expect(roleGate).toBeLessThan(indexOfRequired(getSource, "fetchExistingRows("));
    expect(roleGate).toBeLessThan(indexOfRequired(getSource, "generateTemplate("));
  });

  it("both gates come after membership and descriptor resolution (they need both)", () => {
    // Auth stays first: an anonymous caller is refused before the request is even interpreted.
    const membership = indexOfRequired(postSource, "getActiveMembership()");
    const descriptor = indexOfRequired(postSource, "importRequestFromQuery(");
    expect(membership).toBeLessThan(descriptor);
    expect(descriptor).toBeLessThan(indexOfRequired(postSource, "descriptorRoleDenial("));
    expect(descriptor).toBeLessThan(indexOfRequired(postSource, "commitDenial("));
  });
});

describe("validation-only template instructions", () => {
  it("state no-write and synthetic-only, in the workbook itself", () => {
    const spec = buildTemplateSpec(gated);
    const flat = spec.sheets[0].rows.flat().join("\n");
    for (const note of VALIDATION_ONLY_TEMPLATE_NOTES_AR) {
      expect(flat).toContain(note);
    }
    expect(flat).toContain("قاعدة البيانات");
    expect(flat).toContain("المرحلة M");
  });

  it("are absent from a normal descriptor's template (behavior preserved)", () => {
    const flat = buildTemplateSpec(ungated).sheets[0].rows.flat().join("\n");
    for (const note of VALIDATION_ONLY_TEMPLATE_NOTES_AR) {
      expect(flat).not.toContain(note);
    }
  });
});
