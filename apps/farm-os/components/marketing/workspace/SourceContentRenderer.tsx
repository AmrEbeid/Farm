// SPEC-0032 marketing workspace — renders the reviewed, structured `WorkspaceBlock` tree from
// `content.generated.ts` (itself produced once from the owner-supplied source HTML by
// scripts/build-marketing-workspace-content.mjs) as the EXACT original static copy, headings and
// tables for one area tab. This is the fidelity surface: no `dangerouslySetInnerHTML`, no executed
// script. Every safe source field persists a database-backed draft, while source action buttons
// move the operator to the normalized live workflow rendered below by `WorkspaceArea`.
//
// Two safety rules enforced here, not just documented:
//  1. `hasUnsafeControl` — any control whose legacy handler was the Google Apps Script auto-send
//     (`action === "runAppsScript"`, or the `webAppUrl`/`batchLimit` fields that fed it) is NEVER
//     rendered as an input/button. The whole controls block is replaced with `AppsScriptSafetyNotice`.
//  2. `splitDisputedClaims` (CLAUDE.md #5) — the source's repeated "~5,000 palms" claim renders
//     verbatim (fidelity) but every occurrence is wrapped in a flagged `<mark>` so it can never be
//     read as an approved Farm OS figure.
import type {
  WorkspaceAreaContent,
  WorkspaceBlock,
  WorkspaceControl,
  WorkspaceInline,
  WorkspaceTableCell,
} from "@/lib/marketing/workspace/content-types";
import type { Json } from "@/lib/database.types.ext";
import { containsDisputedClaim, splitDisputedClaims } from "@/lib/marketing/workspace/disputed-claims";
import { SourceControlInput } from "./SourceControlInput";

const LINE = "var(--line)";

interface SourceRenderContext {
  areaId: string;
  orgId: string;
  canWrite: boolean;
  values: Record<string, Json>;
  liveTargetId: string;
}

function safeHref(href: string): string | null {
  const value = href.trim();
  return /^(https?:|mailto:|tel:|#|\/(?!\/))/i.test(value) ? value : null;
}

export function hasUnsafeControl(controls: readonly WorkspaceControl[]): boolean {
  return controls.some((c) => c.action === "runAppsScript" || c.id === "webAppUrl" || c.id === "batchLimit");
}

export function sourceReferenceId(areaId: string, sourceId: string | null | undefined): string | undefined {
  return sourceId ? `source-ref-${areaId}-${sourceId}` : undefined;
}

function blockHasUnsafeControl(block: WorkspaceBlock): boolean {
  if (block.t === "controls") return hasUnsafeControl(block.controls);
  if (block.t === "card" || block.t === "grid" || block.t === "detail") return block.blocks.some(blockHasUnsafeControl);
  if (block.t === "checklist") return false;
  if (block.t === "table") return false;
  return false;
}

function AppsScriptSafetyNotice() {
  return (
    <div
      className="rounded-md p-3 text-sm"
      style={{ border: "1px solid var(--danger, #a44732)", background: "rgba(164,71,50,0.06)" }}
      data-safety-notice="apps-script-auto-send-disabled"
    >
      <b>🔒 تم تعطيل هذا القسم بالكامل.</b> النص الأصلي هنا كان يشرح إرسالاً تلقائياً لدفعة رسائل عبر
      Google Apps Script. Farm OS لا يرسل أي شيء تلقائيًا ولا يعرض رابط تطبيق ويب قابلًا للاستخدام —
      كل تواصل يتم يدويًا فقط: انسخ النص أو افتح بريدك/واتساب بنفسك من قسم «Gmail والحملة» أسفل هذه الصفحة.
    </div>
  );
}

function DisputedText({ text }: { text: string }) {
  const segments = splitDisputedClaims(text);
  if (segments.length === 1 && !segments[0].disputed) return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.disputed ? (
          <mark
            key={i}
            title="عدد النخيل متنازع عليه — راجع docs/CLAUDE.md بند ٥؛ نص أصلي غير معتمد كبيانات Farm OS"
            style={{ background: "#fde8c8", padding: "0 2px" }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function Inline({ run, keyPrefix }: { run: WorkspaceInline; keyPrefix: string }) {
  switch (run.t) {
    case "text":
      return <DisputedText text={run.v} />;
    case "b":
      return (
        <b>
          {run.c.map((c, i) => (
            <Inline key={`${keyPrefix}-${i}`} run={c} keyPrefix={`${keyPrefix}-${i}`} />
          ))}
        </b>
      );
    case "i":
      return (
        <i>
          {run.c.map((c, i) => (
            <Inline key={`${keyPrefix}-${i}`} run={c} keyPrefix={`${keyPrefix}-${i}`} />
          ))}
        </i>
      );
    case "small":
      return (
        <small>
          {run.c.map((c, i) => (
            <Inline key={`${keyPrefix}-${i}`} run={c} keyPrefix={`${keyPrefix}-${i}`} />
          ))}
        </small>
      );
    case "code":
      return <code>{run.v}</code>;
    case "br":
      return <br />;
    case "badge":
      return (
        <span className="rounded px-1 text-xs" style={{ border: `1px solid ${LINE}` }}>
          {run.c.map((c, i) => (
            <Inline key={`${keyPrefix}-${i}`} run={c} keyPrefix={`${keyPrefix}-${i}`} />
          ))}
        </span>
      );
    case "a":
      { const href = safeHref(run.href);
        const content = run.c.map((c, i) => (
          <Inline key={`${keyPrefix}-${i}`} run={c} keyPrefix={`${keyPrefix}-${i}`} />
        ));
        return href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          {content}
        </a>
        ) : <span>{content}</span>;
      }
    default:
      return null;
  }
}

function InlineRun({ runs, keyPrefix }: { runs: readonly WorkspaceInline[]; keyPrefix: string }) {
  return (
    <>
      {runs.map((r, i) => (
        <Inline key={`${keyPrefix}-${i}`} run={r} keyPrefix={`${keyPrefix}-${i}`} />
      ))}
    </>
  );
}

/** One exact source control: fields persist draft values; action buttons open the normalized workflow. */
function ControlFacsimile({ control, controlKey, ctx }: { control: WorkspaceControl; controlKey: string; ctx: SourceRenderContext }) {
  const commonId = sourceReferenceId(ctx.areaId, control.id);
  const disputed = control.kind === "textarea" && containsDisputedClaim(control.value ?? "");
  return (
    <div className="flex flex-col gap-1">
      <SourceControlInput
        control={control}
        domId={commonId}
        controlKey={controlKey}
        areaId={ctx.areaId}
        orgId={ctx.orgId}
        savedValue={ctx.values[controlKey]}
        canWrite={ctx.canWrite}
        liveTargetId={ctx.liveTargetId}
      />
      {disputed && (
        <p className="text-xs" style={{ color: "var(--danger, #a44732)" }} data-disputed-claim-warning={commonId}>
          ⚠ هذا النص الأصلي يذكر عدد نخيل تقريبي (~5,000) متنازع عليه — راجع docs/CLAUDE.md بند ٥
          قبل استخدامه في أي تواصل فعلي.
        </p>
      )}
    </div>
  );
}

function TableCellContent({ cell, keyPrefix, ctx }: { cell: WorkspaceTableCell; keyPrefix: string; ctx: SourceRenderContext }) {
  return (
    <>
      <InlineRun runs={cell.c} keyPrefix={keyPrefix} />
      {cell.controls?.map((c, i) => (
        <span key={i} className="ms-1 inline-block align-middle">
          <ControlFacsimile control={c} controlKey={`${keyPrefix}-control-${i}`} ctx={ctx} />
        </span>
      ))}
    </>
  );
}

function Block({ block, keyPrefix, ctx }: { block: WorkspaceBlock; keyPrefix: string; ctx: SourceRenderContext }) {
  switch (block.t) {
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      return (
        <Tag id={sourceReferenceId(ctx.areaId, block.id)} className={block.level === 2 ? "text-lg font-bold" : "font-bold"}>
          <DisputedText text={block.text} />
        </Tag>
      );
    }
    case "p":
      return (
        <p className={block.tone === "small" ? "text-xs" : undefined} style={block.tone === "desc" || block.tone === "quote" ? { color: "var(--ink-muted)" } : undefined}>
          <InlineRun runs={block.c} keyPrefix={keyPrefix} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`flex flex-col gap-1 ps-5 text-sm ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRun runs={item} keyPrefix={`${keyPrefix}-li${i}`} />
            </li>
          ))}
        </Tag>
      );
    }
    case "callout":
      return (
        <div
          className="rounded-md p-3 text-sm"
          style={{ border: `1px solid ${LINE}`, background: block.tone === "danger" ? "rgba(164,71,50,0.06)" : block.tone === "good" ? "rgba(23,97,61,0.06)" : "transparent" }}
        >
          <InlineRun runs={block.c} keyPrefix={keyPrefix} />
        </div>
      );
    case "kpis":
      return (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {block.items.map((item, i) => (
            <div key={i} className="rounded-md border p-2 text-sm" style={{ borderColor: LINE }}>
              <div style={{ color: "var(--ink-muted)" }}>
                <InlineRun runs={item.label} keyPrefix={`${keyPrefix}-l${i}`} />
              </div>
              <div className="font-bold" id={sourceReferenceId(ctx.areaId, item.valueId)}>
                <InlineRun runs={item.value} keyPrefix={`${keyPrefix}-v${i}`} />
              </div>
              <div className="text-xs">
                <InlineRun runs={item.note} keyPrefix={`${keyPrefix}-n${i}`} />
              </div>
            </div>
          ))}
        </div>
      );
    case "card":
      return (
        <div className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: LINE }}>
          <Blocks blocks={block.blocks} keyPrefix={`${keyPrefix}-c`} ctx={ctx} />
        </div>
      );
    case "grid":
      return (
        <div className={`grid gap-3 ${block.cols === "three" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <Blocks blocks={block.blocks} keyPrefix={`${keyPrefix}-g`} ctx={ctx} />
        </div>
      );
    case "steps":
      return (
        <ol className="flex flex-col gap-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <b>{item.n}</b>
              <span>
                <InlineRun runs={item.c} keyPrefix={`${keyPrefix}-s${i}`} />
              </span>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table id={sourceReferenceId(ctx.areaId, block.id)} className="w-full border-collapse text-sm">
            {block.columns.length > 0 && (
              <thead>
                <tr>
                  {block.columns.map((col, i) => (
                    <th key={i} className="border-b p-2 text-start" style={{ borderColor: LINE }} colSpan={col.colSpan}>
                      <TableCellContent cell={col} keyPrefix={`${keyPrefix}-col${i}`} ctx={ctx} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody id={sourceReferenceId(ctx.areaId, block.bodyId)}>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const Cell = cell.header ? "th" : "td";
                    return (
                      <Cell key={ci} className="border-b p-2 align-top" style={{ borderColor: LINE }} colSpan={cell.colSpan}>
                        <TableCellContent cell={cell} keyPrefix={`${keyPrefix}-r${ri}c${ci}`} ctx={ctx} />
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "checklist":
      return (
        <ul className="flex flex-col gap-1 text-sm">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <ControlFacsimile control={item.control} controlKey={`${keyPrefix}-item-${i}`} ctx={ctx} />
              <span>
                <InlineRun runs={item.c} keyPrefix={`${keyPrefix}-ci${i}`} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "controls":
      if (hasUnsafeControl(block.controls)) return <AppsScriptSafetyNotice />;
      return (
        <div className={`flex flex-wrap gap-2 ${block.layout === "inline" ? "items-center" : ""}`}>
          {block.controls.map((c, i) => (
            <span key={i}>
              {c.label && c.kind !== "button" && (
                <label htmlFor={sourceReferenceId(ctx.areaId, c.id)} className="me-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {c.label}
                </label>
              )}
              <ControlFacsimile control={c} controlKey={`${keyPrefix}-control-${i}`} ctx={ctx} />
            </span>
          ))}
        </div>
      );
    case "output":
      return (
        <div id={sourceReferenceId(ctx.areaId, block.id)} className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {block.c.length > 0 ? <InlineRun runs={block.c} keyPrefix={keyPrefix} /> : "—"}
        </div>
      );
    case "omitted":
      return (
        <div className="rounded-md border p-2 text-xs" style={{ borderColor: LINE, color: "var(--ink-muted)" }}>
          [{block.reason}] {block.note}
        </div>
      );
    case "detail": {
      const unsafe = block.blocks.some(blockHasUnsafeControl);
      return (
        <details className="rounded-md border p-2" style={{ borderColor: LINE }}>
          <summary className="cursor-pointer font-bold">
            <DisputedText text={block.summary} />
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {unsafe ? <AppsScriptSafetyNotice /> : <Blocks blocks={block.blocks} keyPrefix={`${keyPrefix}-d`} ctx={ctx} />}
          </div>
        </details>
      );
    }
    default:
      return null;
  }
}

function Blocks({ blocks, keyPrefix, ctx }: { blocks: readonly WorkspaceBlock[]; keyPrefix: string; ctx: SourceRenderContext }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={`${keyPrefix}-${i}`} block={b} keyPrefix={`${keyPrefix}-${i}`} ctx={ctx} />
      ))}
    </>
  );
}

/**
 * The full exact-fidelity render of one source tab: every heading, table, and control from
 * `content.generated.ts`, in source order. Source IDs are deterministically namespaced in the DOM
 * so they cannot collide with the live editors below. `data-source-content` marks the boundary so
 * tests/E2E can assert it renders distinctly from the database-backed panels below it.
 */
export function SourceContentRenderer({ area, orgId, canWrite, values }: {
  area: WorkspaceAreaContent;
  orgId: string;
  canWrite: boolean;
  values: Record<string, Json>;
}) {
  const ctx: SourceRenderContext = {
    areaId: area.id,
    orgId,
    canWrite,
    values,
    liveTargetId: `source-live-${area.id}`,
  };
  return (
    <section className="no-print flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: LINE }} data-source-content={area.id}>
      <div className="rounded-md p-2 text-xs" style={{ border: `1px dashed ${LINE}`, color: "var(--ink-muted)" }}>
        النص والجداول التالية هي المحتوى الأصلي الحرفي من ملف التسويق ٢٠٢٦ المصدر — مرجعية فقط لمطابقة
        الصياغة، وليست بيانات Farm OS معتمدة. أي رقم أو ادّعاء هنا يحتاج مراجعة قبل استخدامه (مثال:
        عدد النخيل المظلَّل أدناه متنازع عليه — راجع docs/CLAUDE.md بند ٥). الحقول الآمنة تحفظ مسوداتها
        في قاعدة البيانات، وتبقى السجلات التشغيلية المعتمدة في الأقسام الحية المرتبطة أدناه.
      </div>
      <Blocks blocks={area.blocks} keyPrefix={area.id} ctx={ctx} />
    </section>
  );
}
