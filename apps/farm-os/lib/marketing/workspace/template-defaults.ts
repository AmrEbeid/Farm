// SPEC-0032 marketing workspace — default template bodies, read from the checked-in
// `content.generated.ts` (itself produced once from the owner-supplied source HTML by
// scripts/build-marketing-workspace-content.mjs). Never imports the raw source file at runtime and
// never ships to the client: only the server page reads this, to seed each template's first render
// before the owner has saved an edited body as a `message_template` record.
import { MARKETING_WORKSPACE_CONTENT } from "./content.generated";
import type { WorkspaceBlock } from "./content-types";

function collectTextareaDefaults(blocks: readonly WorkspaceBlock[], out: Map<string, string>): void {
  for (const block of blocks) {
    if (block.t === "controls") {
      for (const control of block.controls) {
        if (control.kind === "textarea" && control.id && control.value !== undefined) {
          out.set(control.id, control.value);
        }
      }
    }
    if (block.t === "card" || block.t === "grid" || block.t === "detail") {
      collectTextareaDefaults(block.blocks, out);
    }
  }
}

/** legacy `<textarea id="...">` default body, by DOM id (== `MarketingTemplateSpec.id`). */
export function marketingTemplateDefaults(): Record<string, string> {
  const out = new Map<string, string>();
  for (const area of MARKETING_WORKSPACE_CONTENT) collectTextareaDefaults(area.blocks, out);
  return Object.fromEntries(out);
}
