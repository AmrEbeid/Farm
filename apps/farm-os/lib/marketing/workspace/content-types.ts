// SPEC-0032 — the block model the authenticated Marketing workspace renders.
//
// The legacy 2026 marketing HTML is NOT shipped as markup. `scripts/build-marketing-workspace-content.mjs`
// reads the owner-supplied source file once and converts every section into the reviewed, structured
// blocks below; `content.generated.ts` is the checked-in result and the only thing the UI renders.
// Consequences that are deliberate:
//   * no `dangerouslySetInnerHTML` anywhere in the workspace — inline emphasis/links are typed spans;
//   * no inline contact dataset, no base64 assets, no legacy <script> (see OMITTED_* below);
//   * every control keeps its exact legacy DOM id, so the workspace is checkable against the source.

/** Inline run inside a paragraph, list item, table cell, callout or checklist item. */
export type WorkspaceInline =
  | { t: "text"; v: string }
  | { t: "b"; c: WorkspaceInline[] }
  | { t: "i"; c: WorkspaceInline[] }
  | { t: "small"; c: WorkspaceInline[] }
  | { t: "code"; v: string }
  | { t: "br" }
  | { t: "badge"; tone: string; c: WorkspaceInline[] }
  | { t: "a"; href: string; c: WorkspaceInline[] };

/** Why a piece of the source is represented rather than reproduced. */
export type WorkspaceOmission =
  | "inline_contacts"      // the 1,513-row directory — loads through the paginated authenticated RPC
  | "binary_asset"         // base64 image/pdf embedded in the source file
  | "remote_script"        // CDN chart/pdf libraries
  | "auto_send"            // the Apps Script auto-send endpoint (removed, replaced by manual compose)
  | "disputed_data";       // CLAUDE.md #5 — the approximate palm count

export type WorkspaceControlKind = "input" | "select" | "textarea" | "button" | "checkbox";

export interface WorkspaceControl {
  /** The exact legacy DOM id. Kept so the source can be diffed against the workspace. */
  id: string;
  kind: WorkspaceControlKind;
  /** Native input type for `kind: "input"` (text/number/date/time/url/email/file). */
  type?: string;
  label?: string;
  placeholder?: string;
  options?: string[];
  /** Default body of a template textarea / default value of an input. */
  value?: string;
  /** Legacy handler name — mapped to a reviewed workspace behaviour, never executed as source JS. */
  action?: string;
  /** Literal arguments the legacy markup passed to the handler. */
  args?: string[];
  /** `data-task` / `data-platform-task` / `data-key` attributes the legacy JS keyed state by. */
  dataKey?: string;
  /** Set when the control is disabled in the workspace and why. */
  omitted?: WorkspaceOmission;
}

export interface WorkspaceTableCell {
  c: WorkspaceInline[];
  controls?: WorkspaceControl[];
  colSpan?: number;
  header?: boolean;
}

export type WorkspaceBlock =
  | { t: "heading"; level: 2 | 3; text: string; id: string }
  | { t: "p"; tone?: "desc" | "small" | "quote"; c: WorkspaceInline[] }
  | { t: "list"; ordered: boolean; items: WorkspaceInline[][] }
  | { t: "callout"; tone: "good" | "danger" | "warn" | "note" | "source"; c: WorkspaceInline[] }
  | { t: "kpis"; items: { label: WorkspaceInline[]; value: WorkspaceInline[]; note: WorkspaceInline[]; valueId?: string }[] }
  | { t: "card"; tone?: string; blocks: WorkspaceBlock[] }
  | { t: "grid"; cols: "two" | "three"; blocks: WorkspaceBlock[] }
  | { t: "steps"; items: { n: string; c: WorkspaceInline[] }[] }
  | { t: "table"; id?: string; bodyId?: string; columns: WorkspaceTableCell[]; rows: WorkspaceTableCell[][] }
  | { t: "checklist"; group?: string; items: { c: WorkspaceInline[]; control: WorkspaceControl }[] }
  | { t: "controls"; layout: "toolbar" | "form3" | "search" | "pager" | "inline"; controls: WorkspaceControl[] }
  /** A div the legacy JS wrote computed output into; the workspace renders a live value instead. */
  | { t: "output"; id: string; tone?: string; c: WorkspaceInline[] }
  | { t: "omitted"; reason: WorkspaceOmission; note: string }
  | { t: "detail"; summary: string; blocks: WorkspaceBlock[] };

export interface WorkspaceAreaContent {
  /** Legacy tab id — the source order is the array order. */
  id: string;
  label: string;
  order: number;
  blocks: WorkspaceBlock[];
}
