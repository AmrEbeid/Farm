import ts from "typescript";

type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal };

const DATASET_NAMES = [
  "FARM_FACTS",
  "EXPORTERS",
  "PRICE_TYPES",
  "CONTACTS",
  "B2B_PLATFORMS",
  "CERT_DEFS",
  "FIN_CHANNELS",
  "FREIGHT_RATES",
  "KUWAIT_DISTRIBUTORS",
] as const;

export interface MarketingSourceManifest {
  version: 1;
  tabs: { id: string; label: string }[];
  templates: { id: string; body: string }[];
  datasets: Record<(typeof DATASET_NAMES)[number], Literal>;
  loadDefaults: Record<string, Literal>;
  savedState: Record<string, unknown>;
  coverage: {
    tabs: number;
    templates: number;
    stateKeys: number;
    datasets: Record<string, number>;
    loadDefaults: Record<string, number>;
  };
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error(`Unsupported object key syntax: ${ts.SyntaxKind[node.kind]}`);
}

function readLiteral(node: ts.Expression): Literal {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const value = readLiteral(node.operand);
    if (typeof value !== "number") throw new Error("Unary minus requires a numeric literal");
    return -value;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => readLiteral(item as ts.Expression));
  if (ts.isObjectLiteralExpression(node)) {
    const value: { [key: string]: Literal } = {};
    for (const item of node.properties) {
      if (!ts.isPropertyAssignment(item)) {
        throw new Error(`Unsupported object member syntax: ${ts.SyntaxKind[item.kind]}`);
      }
      const key = propertyName(item.name);
      if (Object.hasOwn(value, key)) throw new Error(`Duplicate object key: ${key}`);
      value[key] = readLiteral(item.initializer);
    }
    return value;
  }
  throw new Error(`Unsupported literal syntax: ${ts.SyntaxKind[node.kind]}`);
}

function scriptsFromHtml(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

export function extractMarketingSource(html: string, stateText: string): MarketingSourceManifest {
  let savedState: unknown;
  try {
    savedState = JSON.parse(stateText);
  } catch {
    throw new Error("Marketing state is not valid JSON");
  }
  if (typeof savedState !== "object" || savedState === null || Array.isArray(savedState)) {
    throw new Error("Marketing state must be a JSON object");
  }

  const declarations = new Map<string, ts.Expression>();
  const loadCalls: { keyNode: ts.Expression; defaultNode: ts.Expression }[] = [];
  for (const [index, script] of scriptsFromHtml(html).entries()) {
    const source = ts.createSourceFile(`marketing-source-${index}.js`, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diagnostics.length > 0) throw new Error(`Marketing source script ${index} has invalid JavaScript syntax`);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const node of statement.declarationList.declarations) {
        if (!ts.isIdentifier(node.name) || !node.initializer) continue;
        if (declarations.has(node.name.text)) throw new Error(`Duplicate top-level declaration: ${node.name.text}`);
        declarations.set(node.name.text, node.initializer);
      }
    }
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "load"
        && node.arguments.length >= 2
      ) {
        loadCalls.push({
          keyNode: node.arguments[0],
          defaultNode: node.arguments[1],
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const datasets = {} as MarketingSourceManifest["datasets"];
  for (const name of DATASET_NAMES) {
    const initializer = declarations.get(name);
    if (!initializer) throw new Error(`Missing required dataset declaration: ${name}`);
    datasets[name] = readLiteral(initializer);
  }

  const loadDefaults: Record<string, Literal> = {};
  for (const { keyNode, defaultNode } of loadCalls) {
    let key: string | null = null;
    if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) key = keyNode.text;
    else if (ts.isIdentifier(keyNode)) {
      const keyValue = declarations.get(keyNode.text);
      // Generic helpers such as load(key, isMap ? {} : []) are not concrete source states.
      if (!keyValue) continue;
      const parsed = readLiteral(keyValue);
      if (typeof parsed !== "string") throw new Error(`Load key ${keyNode.text} is not a string literal`);
      key = parsed;
    }
    if (key === null) continue;

    const parsedDefault = readLiteral(defaultNode);
    if (Object.hasOwn(loadDefaults, key)) {
      if (JSON.stringify(loadDefaults[key]) !== JSON.stringify(parsedDefault)) {
        throw new Error(`Conflicting load defaults: ${key}`);
      }
      continue;
    }
    loadDefaults[key] = parsedDefault;
  }

  const tabs = [...html.matchAll(/<button\b[^>]*\bdata-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi)].map((match) => ({
    id: match[1].trim(),
    label: decodeHtml(match[2].replace(/<[^>]+>/g, "").trim()),
  }));
  const templates = [...html.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi)].map((match) => ({
    id: match[1].trim(),
    body: decodeHtml(match[2].trim()),
  }));
  if (new Set(tabs.map((tab) => tab.id)).size !== tabs.length) throw new Error("Duplicate Marketing tab id");
  if (new Set(templates.map((template) => template.id)).size !== templates.length) throw new Error("Duplicate Marketing template id");

  const datasetCount = (value: Literal): number => Array.isArray(value) ? value.length : 1;
  const stateCount = (value: Literal): number => {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
    return 1;
  };
  return {
    version: 1,
    tabs,
    templates,
    datasets,
    loadDefaults,
    savedState: savedState as Record<string, unknown>,
    coverage: {
      tabs: tabs.length,
      templates: templates.length,
      stateKeys: Object.keys(savedState).length,
      datasets: Object.fromEntries(Object.entries(datasets).map(([key, value]) => [key, datasetCount(value)])),
      loadDefaults: Object.fromEntries(Object.entries(loadDefaults).map(([key, value]) => [key, stateCount(value)])),
    },
  };
}
