#!/usr/bin/env node
// SPEC-0032 — one-way converter: legacy marketing HTML  ->  reviewed workspace content blocks.
//
//   MARKETING_SOURCE_HTML=<file> node scripts/build-marketing-workspace-content.mjs [--check]
//
// Writes lib/marketing/workspace/content.generated.ts (what the workspace renders) and
// lib/marketing/workspace/source-oracle.generated.ts (an INDEPENDENT regex tally of the same file:
// tab order, heading order, table signatures, control ids, template bodies — the numbers the
// deterministic tests pin the workspace against). With --check it only verifies the checked-in files
// are current, so the conversion can never silently drift from the source.
//
// It never emits raw markup, the inline 1,513-contact dataset, base64 assets or the legacy scripts.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CONTENT = resolve(HERE, "../lib/marketing/workspace/content.generated.ts");
const OUT_ORACLE = resolve(HERE, "../lib/marketing/workspace/source-oracle.generated.ts");

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "col"]);
const RAW = new Set(["script", "style", "textarea"]);

/* ------------------------------------------------------------------ parser */

function decode(text) {
  return text
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

/** Minimal, dependency-free HTML -> tree. Good enough for this one reviewed file. */
function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const push = (node) => stack[stack.length - 1].children.push(node);
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { const text = html.slice(i); if (text.trim()) push({ tag: "#text", value: decode(text) }); break; }
    if (lt > i) { const text = html.slice(i, lt); if (text.trim()) push({ tag: "#text", value: decode(text) }); }
    if (html.startsWith("<!--", lt)) { i = html.indexOf("-->", lt) + 3; continue; }
    if (html.startsWith("<!", lt)) { i = html.indexOf(">", lt) + 1; continue; }
    if (html.startsWith("</", lt)) {
      const gt = html.indexOf(">", lt);
      const tag = html.slice(lt + 2, gt).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
      i = gt + 1;
      continue;
    }
    const gt = html.indexOf(">", lt);
    const inner = html.slice(lt + 1, gt);
    const selfClosing = inner.endsWith("/");
    const spaceAt = inner.search(/[\s/]/);
    const tag = (spaceAt < 0 ? inner : inner.slice(0, spaceAt)).toLowerCase();
    const attrs = parseAttrs(spaceAt < 0 ? "" : inner.slice(spaceAt).replace(/\/$/, ""));
    const node = { tag, attrs, children: [] };
    push(node);
    i = gt + 1;
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      const raw = html.slice(i, close < 0 ? html.length : close);
      node.children.push({ tag: "#text", value: decode(raw) });
      i = close < 0 ? html.length : html.indexOf(">", close) + 1;
      continue;
    }
    if (!VOID.has(tag) && !selfClosing) stack.push(node);
  }
  return root;
}

const classesOf = (node) => String(node.attrs?.class || "").split(/\s+/).filter(Boolean);
const hasClass = (node, name) => classesOf(node).includes(name);
const elements = (node) => node.children.filter((c) => c.tag !== "#text");

function plainText(node) {
  if (node.tag === "#text") return node.value;
  if (node.tag === "br") return "\n";
  return (node.children || []).map(plainText).join("");
}
const squash = (text) => text.replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ inline */

const BADGE_CLASSES = ["confidence", "status", "pill", "grade", "tag", "n"];

function inlineOf(nodes) {
  const out = [];
  const pushText = (value) => {
    const v = value.replace(/[ \t\r\n]+/g, " ");
    if (!v.trim() && out.length === 0) return;
    if (!v.trim() && v === " " && out[out.length - 1]?.t === "text" && out[out.length - 1].v.endsWith(" ")) return;
    out.push({ t: "text", v });
  };
  for (const node of nodes) {
    if (node.tag === "#text") { pushText(node.value); continue; }
    switch (node.tag) {
      case "b": case "strong": out.push({ t: "b", c: inlineOf(node.children) }); break;
      case "i": case "em": out.push({ t: "i", c: inlineOf(node.children) }); break;
      case "small": out.push({ t: "small", c: inlineOf(node.children) }); break;
      case "code": out.push({ t: "code", v: squash(plainText(node)) }); break;
      case "br": out.push({ t: "br" }); break;
      case "a": out.push({ t: "a", href: node.attrs.href || "", c: inlineOf(node.children) }); break;
      case "span": {
        const badge = classesOf(node).find((c) => BADGE_CLASSES.includes(c));
        if (badge) out.push({ t: "badge", tone: classesOf(node).join(" "), c: inlineOf(node.children) });
        else out.push(...inlineOf(node.children));
        break;
      }
      case "div": case "p": case "label": out.push(...inlineOf(node.children)); break;
      default: out.push(...inlineOf(node.children));
    }
  }
  // Trim leading/trailing whitespace-only runs.
  while (out.length && out[0].t === "text" && !out[0].v.trim()) out.shift();
  while (out.length && out[out.length - 1].t === "text" && !out[out.length - 1].v.trim()) out.pop();
  return out;
}

/* ------------------------------------------------------------------ controls */

function actionOf(node) {
  const handler = node.attrs.onclick || node.attrs.onchange || node.attrs.oninput || "";
  const m = handler.match(/^([A-Za-z_$][\w$]*)\((.*)\)\s*;?$/s);
  if (!m) return {};
  const args = m[2].trim() === "" ? [] : m[2].split(",").map((a) => a.trim().replace(/^['"]|['"]$/g, ""));
  return { action: m[1], args };
}

function controlOf(node, labelHint) {
  const { action, args } = actionOf(node);
  const dataKey = node.attrs["data-key"] ?? node.attrs["data-task"] ?? node.attrs["data-platform-task"];
  const base = {
    id: node.attrs.id || "",
    kind: node.tag === "input" && node.attrs.type === "checkbox" ? "checkbox" : node.tag,
  };
  if (node.tag === "input") {
    base.type = node.attrs.type || "text";
    if (node.attrs.placeholder) base.placeholder = node.attrs.placeholder;
    if (node.attrs.value) base.value = node.attrs.value;
  }
  if (node.tag === "select") {
    base.options = elements(node).filter((o) => o.tag === "option").map((o) => squash(plainText(o)));
    if (node.attrs.placeholder) base.placeholder = node.attrs.placeholder;
  }
  if (node.tag === "textarea") {
    base.value = plainText(node).replace(/^\n/, "");
    if (node.attrs.placeholder) base.placeholder = node.attrs.placeholder;
  }
  if (node.tag === "button") base.label = squash(plainText(node));
  if (labelHint && !base.label) base.label = labelHint;
  if (action) { base.action = action; base.args = args; }
  if (dataKey !== undefined) base.dataKey = dataKey || "";
  return base;
}

const CONTROL_TAGS = new Set(["input", "select", "textarea", "button"]);

function collectControls(node, sink) {
  if (CONTROL_TAGS.has(node.tag)) { sink.push(controlOf(node)); return; }
  for (const child of node.children || []) if (child.tag !== "#text") collectControls(child, sink);
}

/** True if `node` (at any depth) contains an input/select/textarea/button. Used to keep a
 *  container's `collectControls()` sweep (which already recurses through wrapper `<div>`s around a
 *  `<label>`) from ALSO handing that same wrapper to the sibling "textish" convert() pass below —
 *  without this guard a `<div class="formGrid3"><div><label>…<input></label></div></div>` shape
 *  emits the control twice (once from the sweep, once from re-converting the wrapping `<div>`). */
function hasControlDescendant(node) {
  if (CONTROL_TAGS.has(node.tag)) return true;
  return (node.children || []).some((child) => child.tag !== "#text" && hasControlDescendant(child));
}

/* ------------------------------------------------------------------ blocks */

const CALLOUT_TONES = {
  goodbox: "good", dangerbox: "danger", warn: "warn", note: "note",
  src: "source", srcList: "source", quote: "note", logbox: "note",
  gscript: "note", "email-box": "note", window: "note", metric: "note",
};

let headingSeq = 0;
const slug = (text) => text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();

function tableCell(node) {
  const controls = [];
  collectControls(node, controls);
  const cell = { c: inlineOf(node.children.filter((c) => !CONTROL_TAGS.has(c.tag))) };
  if (controls.length) cell.controls = controls;
  if (node.attrs.colspan) cell.colSpan = Number(node.attrs.colspan);
  if (node.tag === "th") cell.header = true;
  return cell;
}

function tableBlock(node) {
  const rows = [];
  let columns = [];
  let bodyId;
  const walkRows = (parent, into) => {
    for (const child of elements(parent)) {
      if (child.tag === "tr") into.push(elements(child).filter((c) => c.tag === "td" || c.tag === "th").map(tableCell));
      else if (["thead", "tbody", "tfoot"].includes(child.tag)) {
        if (child.tag === "thead") { const head = []; walkRows(child, head); columns = head[0] ?? []; }
        else { if (child.attrs.id) bodyId = child.attrs.id; walkRows(child, into); }
      }
    }
  };
  walkRows(node, rows);
  if (!columns.length && rows.length && rows[0].every((c) => c.header)) columns = rows.shift();
  const block = { t: "table", columns, rows };
  if (node.attrs.id) block.id = node.attrs.id;
  if (bodyId) block.bodyId = bodyId;
  return block;
}

function checklistBlock(node) {
  const items = [];
  for (const label of elements(node)) {
    const box = [];
    collectControls(label, box);
    const control = box[0] ?? { id: "", kind: "checkbox" };
    items.push({ c: inlineOf(label.children.filter((c) => c.tag !== "input")), control });
  }
  const group = items[0]?.control?.dataKey !== undefined ? "task" : undefined;
  return group ? { t: "checklist", group, items } : { t: "checklist", items };
}

function stepsBlock(nodes) {
  return {
    t: "steps",
    items: nodes.map((step) => {
      const n = elements(step).find((c) => hasClass(c, "n"));
      return {
        n: n ? squash(plainText(n)) : "",
        c: inlineOf(step.children.filter((c) => c !== n)),
      };
    }),
  };
}

function convert(node, ctx) {
  const out = [];
  const cls = classesOf(node);

  switch (node.tag) {
    case "#text":
      if (node.value.trim()) out.push({ t: "p", c: inlineOf([node]) });
      return out;
    case "h2": case "h3": {
      const text = squash(plainText(node));
      headingSeq += 1;
      out.push({ t: "heading", level: node.tag === "h2" ? 2 : 3, text, id: `${ctx.area}-h${headingSeq}-${slug(text)}` });
      return out;
    }
    case "p": {
      const controls = [];
      collectControls(node, controls);
      const tone = cls.includes("desc") ? "desc" : cls.includes("quote") ? "quote" : undefined;
      const c = inlineOf(node.children.filter((child) => !CONTROL_TAGS.has(child.tag)));
      if (c.length) out.push(tone ? { t: "p", tone, c } : { t: "p", c });
      if (controls.length) out.push({ t: "controls", layout: "inline", controls });
      return out;
    }
    case "ul": case "ol":
      out.push({
        t: "list",
        ordered: node.tag === "ol",
        items: elements(node).filter((li) => li.tag === "li").map((li) => inlineOf(li.children)),
      });
      return out;
    case "table": out.push(tableBlock(node)); return out;
    case "input": case "select": case "textarea": case "button":
      out.push({ t: "controls", layout: "inline", controls: [controlOf(node)] });
      return out;
    case "img":
      out.push({ t: "omitted", reason: "binary_asset", note: node.attrs.alt || "صورة مضمّنة في الملف المصدر" });
      return out;
    case "canvas":
      out.push({ t: "omitted", reason: "remote_script", note: "الرسم البياني للأسعار — يُرسم داخل التطبيق من سجل الأسعار" });
      return out;
    case "details": {
      const summary = elements(node).find((c) => c.tag === "summary");
      out.push({
        t: "detail",
        summary: summary ? squash(plainText(summary)) : "",
        blocks: elements(node).filter((c) => c !== summary).flatMap((c) => convert(c, ctx)),
      });
      return out;
    }
    case "datalist": return out;
    case "small":
      out.push({ t: "p", tone: "small", c: inlineOf(node.children) });
      return out;
    case "label": {
      const controls = [];
      collectControls(node, controls);
      if (controls.length) {
        out.push({ t: "controls", layout: "inline", controls: controls.map((c) => ({ ...c, label: c.label || squash(plainText(node)) })) });
        return out;
      }
      out.push({ t: "p", c: inlineOf(node.children) });
      return out;
    }
    default: break;
  }

  if (node.tag !== "div" && node.tag !== "section" && node.tag !== "span" && node.tag !== "a") {
    ctx.unknown.add(node.tag);
  }

  // div-family, mapped by class.
  if (hasClass(node, "tablewrap")) return elements(node).flatMap((c) => convert(c, ctx));
  if (hasClass(node, "checklist")) { out.push(checklistBlock(node)); return out; }
  if (hasClass(node, "kpis")) {
    const items = elements(node).filter((c) => hasClass(c, "kpi")).map((kpi) => {
      const pick = (name) => elements(kpi).find((c) => hasClass(c, name));
      const label = pick("label"), value = pick("value"), note = pick("note");
      const item = {
        label: label ? inlineOf(label.children) : [],
        value: value ? inlineOf(value.children) : [],
        note: note ? inlineOf(note.children) : [],
      };
      if (value?.attrs.id) item.valueId = value.attrs.id;
      return item;
    });
    if (items.length) { out.push({ t: "kpis", items }); return out; }
    // an empty `.grid.kpis` with an id is a JS-filled output row
    out.push({ t: "output", id: node.attrs.id || "", tone: "kpis", c: [] });
    return out;
  }
  if (hasClass(node, "grid")) {
    const cols = hasClass(node, "three") ? "three" : "two";
    out.push({ t: "grid", cols, blocks: elements(node).flatMap((c) => convert(c, ctx)) });
    return out;
  }
  if (hasClass(node, "timeline") || elements(node).some((c) => hasClass(c, "step"))) {
    const steps = elements(node).filter((c) => hasClass(c, "step"));
    if (steps.length) {
      out.push(stepsBlock(steps));
      const rest = elements(node).filter((c) => !hasClass(c, "step"));
      out.push(...rest.flatMap((c) => convert(c, ctx)));
      return out;
    }
  }
  if (hasClass(node, "card") || hasClass(node, "contact")) {
    const tone = cls.find((c) => ["story", "gold", "kuwaitPlan"].includes(c));
    const blocks = elements(node).flatMap((c) => convert(c, ctx));
    out.push(tone ? { t: "card", tone, blocks } : { t: "card", blocks });
    return out;
  }
  const calloutClass = cls.find((c) => CALLOUT_TONES[c]);
  if (calloutClass) {
    const controls = [];
    collectControls(node, controls);
    const nested = elements(node).filter((c) => ["table", "ul", "ol"].includes(c.tag));
    const c = inlineOf(node.children.filter((child) => !CONTROL_TAGS.has(child.tag) && !nested.includes(child)));
    if (c.length || (!controls.length && !nested.length)) out.push({ t: "callout", tone: CALLOUT_TONES[calloutClass], c });
    out.push(...nested.flatMap((child) => convert(child, ctx)));
    if (controls.length) out.push({ t: "controls", layout: "inline", controls });
    return out;
  }
  if (hasClass(node, "toolbar") || hasClass(node, "formGrid3") || hasClass(node, "searchbar") || hasClass(node, "pager")) {
    const layout = hasClass(node, "formGrid3") ? "form3" : hasClass(node, "searchbar") ? "search" : hasClass(node, "pager") ? "pager" : "toolbar";
    const controls = [];
    collectControls(node, controls);
    const textish = elements(node).filter((c) => !CONTROL_TAGS.has(c.tag) && !["label"].includes(c.tag) && !hasControlDescendant(c));
    if (controls.length) out.push({ t: "controls", layout, controls });
    out.push(...textish.flatMap((c) => convert(c, ctx)));
    return out;
  }
  if (node.tag === "a") {
    out.push({ t: "p", c: inlineOf([node]) });
    return out;
  }

  // A bare div: an output target when it has an id and no element children, otherwise a passthrough.
  const kids = elements(node);
  if (node.attrs.id && kids.length === 0) {
    const block = { t: "output", id: node.attrs.id, c: inlineOf(node.children) };
    if (cls.length) block.tone = cls.join(" ");
    out.push(block);
    return out;
  }
  const inlineOnly = node.children.length > 0 && kids.every((c) => ["b", "i", "em", "strong", "span", "a", "br", "small", "code"].includes(c.tag));
  if (inlineOnly) {
    const c = inlineOf(node.children);
    if (c.length) out.push({ t: "p", c });
    return out;
  }
  out.push(...node.children.flatMap((c) => convert(c, ctx)));
  return out;
}

/* ------------------------------------------------------------------ oracle */

function buildOracle(html) {
  const start = html.indexOf('<section id="dashboard"');
  const end = html.lastIndexOf("</section>") + "</section>".length;
  const body = html.slice(start, end);
  const tabs = [...html.matchAll(/<button\b[^>]*\bdata-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi)]
    .map((m) => ({ id: m[1], label: squash(decode(m[2].replace(/<[^>]+>/g, ""))) }));
  const sections = [...body.matchAll(/<section id="([^"]+)" class="section/g)].map((m) => m[1]);
  const headings = [];
  const tables = [];
  const controls = [];
  const templates = [];
  const sectionRanges = sections.map((id, index, all) => {
    const from = body.indexOf(`<section id="${id}" class="section`);
    const to = index + 1 < all.length ? body.indexOf(`<section id="${all[index + 1]}" class="section`) : body.length;
    return { id, html: body.slice(from, to) };
  });
  for (const { id, html: chunk } of sectionRanges) {
    for (const m of chunk.matchAll(/<(h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      headings.push({ area: id, level: Number(m[1][1]), text: squash(decode(m[2].replace(/<[^>]+>/g, ""))) });
    }
    for (const m of chunk.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)) {
      const head = m[1].match(/<thead>([\s\S]*?)<\/thead>/);
      const cols = head ? [...head[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((c) => squash(decode(c[1].replace(/<[^>]+>/g, "")))) : [];
      const bodyId = m[1].match(/<tbody[^>]*\bid="([^"]+)"/);
      tables.push({ area: id, columns: cols, bodyId: bodyId ? bodyId[1] : null });
    }
    for (const m of chunk.matchAll(/<(input|select|textarea|button)\b([^>]*)>/g)) {
      const attrs = parseAttrs(m[2]);
      controls.push({ area: id, tag: m[1], id: attrs.id ?? null, type: attrs.type ?? null });
    }
    for (const m of chunk.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
      const attrs = parseAttrs(m[1]);
      templates.push({ area: id, id: attrs.id ?? null, body: decode(m[2]).replace(/^\n/, "") });
    }
  }
  const stateKeys = [...new Set([...html.matchAll(/\b(?:load|save)\(\s*'([^']+)'/g)].map((m) => m[1]))].sort();
  const keyConsts = Object.fromEntries([...html.matchAll(/const\s+([A-Z_]+_KEY|SOCIAL_PRICE_KEY|WA_KEY|HOT_KEY|OFF_KEY|DSR_KEY|LOCAL_KEY|REPEAT_KEY|QC_KEY|CERT_KEY|FIN_KEY|HARVEST_KEY)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  const indirect = [...new Set([...html.matchAll(/\b(?:load|save)\(\s*([A-Z_]+)\s*,/g)].map((m) => keyConsts[m[1]]).filter(Boolean))];
  return {
    tabs,
    sections,
    headings,
    tables,
    controls,
    templates,
    stateKeys: [...new Set([...stateKeys, ...indirect])].sort(),
    counts: {
      tabs: tabs.length,
      headings: headings.length,
      tables: tables.length,
      controls: controls.length,
      controlIds: new Set(controls.filter((c) => c.id).map((c) => c.id)).size,
      templates: templates.length,
    },
  };
}

/* ------------------------------------------------------------------ emit */

function emit(sourcePath) {
  const html = readFileSync(sourcePath, "utf8");
  const oracle = buildOracle(html);
  const tree = parseHtml(html);
  const sections = [];
  const collect = (node) => {
    if (node.tag === "section" && hasClass(node, "section")) sections.push(node);
    for (const child of node.children || []) if (child.tag !== "#text") collect(child);
  };
  collect(tree);

  const labels = new Map(oracle.tabs.map((t) => [t.id, t.label]));
  const ctx = { unknown: new Set() };
  headingSeq = 0;
  const areas = sections.map((section, index) => {
    ctx.area = section.attrs.id;
    return {
      id: section.attrs.id,
      label: labels.get(section.attrs.id) ?? section.attrs.id,
      order: index + 1,
      blocks: elements(section).flatMap((child) => convert(child, ctx)),
    };
  });

  const banner = (extra) => `// GENERATED FILE — do not edit by hand.
// Source: the owner-supplied 2026 marketing HTML, converted by scripts/build-marketing-workspace-content.mjs.
// ${extra}
`;

  const content = `${banner("Reviewed structured blocks only: no raw markup, no inline contacts, no base64 assets, no legacy scripts.")}
import type { WorkspaceAreaContent } from "./content-types";

export const MARKETING_WORKSPACE_CONTENT: readonly WorkspaceAreaContent[] = ${JSON.stringify(areas, null, 1)};
`;

  const oracleTs = `${banner("An independent regex tally of the same source file — the oracle the deterministic tests pin against.")}
export interface MarketingSourceOracle {
  readonly tabs: readonly { readonly id: string; readonly label: string }[];
  readonly headings: readonly { readonly area: string; readonly level: number; readonly text: string }[];
  readonly tables: readonly { readonly area: string; readonly columns: readonly string[]; readonly bodyId: string | null }[];
  readonly controls: readonly { readonly area: string; readonly tag: string; readonly id: string | null; readonly type: string | null }[];
  readonly templates: readonly { readonly area: string; readonly id: string | null; readonly body: string }[];
  readonly stateKeys: readonly string[];
  readonly counts: {
    readonly tabs: number; readonly headings: number; readonly tables: number;
    readonly controls: number; readonly controlIds: number; readonly templates: number;
  };
}

export const MARKETING_SOURCE_ORACLE: MarketingSourceOracle = ${JSON.stringify({
    tabs: oracle.tabs, headings: oracle.headings, tables: oracle.tables,
    controls: oracle.controls, templates: oracle.templates,
    stateKeys: oracle.stateKeys, counts: oracle.counts,
  }, null, 1)};
`;

  return { content, oracleTs, oracle, unknown: [...ctx.unknown] };
}

const sourcePath = process.env.MARKETING_SOURCE_HTML;
if (!sourcePath) {
  console.error("MARKETING_SOURCE_HTML is required (path to the owner-supplied marketing HTML).");
  process.exit(2);
}
const { content, oracleTs, oracle, unknown } = emit(sourcePath);
const check = process.argv.includes("--check");
if (check) {
  const same = readFileSync(OUT_CONTENT, "utf8") === content && readFileSync(OUT_ORACLE, "utf8") === oracleTs;
  console.log(same ? "marketing workspace content is up to date" : "OUT OF DATE — re-run without --check");
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT_CONTENT, content);
writeFileSync(OUT_ORACLE, oracleTs);
console.log("counts", oracle.counts, "stateKeys", oracle.stateKeys.length);
if (unknown.length) console.log("unmapped tags:", unknown.join(", "));
