// @ts-nocheck -- run with the project loader, not compiled by the app build
// Parses src/app/page.tsx with the TypeScript compiler and returns every tab it renders, as a flat list of
// { path, label, components } where path is the chain of tab ids ("trading/equities/backtest").
// Used by study-reachability.test.mts, and (with --write) to regenerate the frozen baseline of what was reachable
// before the navigation rework:  node scripts/quality/study-reachability-parse.mts --write
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function propValue(init: any, sf: any): string | boolean {
  if (!init) return true; // bare attribute, e.g. `crypto`
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    if (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) return init.expression.text;
    if (init.expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (init.expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    return `{${init.expression.getText(sf)}}`;
  }
  return init.getText(sf);
}

function tagName(el: any, sf: any): string {
  return el.tagName.getText(sf);
}

function attrsOf(el: any, sf: any): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a)) continue;
    const name = a.name.getText(sf);
    if (name === "key") continue;
    out[name] = propValue(a.initializer, sf);
  }
  return out;
}

// Collect the component tags directly rendered by a tab body, not descending into nested <Tabs>.
function collectLeaf(node: any, sf: any, out: any[], wrappers: string[]) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const el = ts.isJsxElement(node) ? node.openingElement : node;
    const name = tagName(el, sf);
    if (name === "Tabs") return; // handled as a child tab level
    if (/^[A-Z]/.test(name)) {
      const attrs = attrsOf(el, sf);
      if (name === "RequiresPlacementTier") wrappers.push(`RequiresPlacementTier:${attrs.minTier}`);
      else out.push({ component: name, props: attrs });
    }
  } else if (ts.isIdentifier(node) && node.parent && ts.isPropertyAssignment(node.parent) && node.parent.initializer === node) {
    out.push({ component: `{${node.text}}`, props: {} });
    return;
  }
  ts.forEachChild(node, (c) => collectLeaf(c, sf, out, wrappers));
}

function findTabsElements(node: any, sf: any, acc: any[]) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const el = ts.isJsxElement(node) ? node.openingElement : node;
    if (tagName(el, sf) === "Tabs") {
      acc.push(el);
      return; // nested Tabs are discovered through each tab's content
    }
  }
  ts.forEachChild(node, (c) => findTabsElements(c, sf, acc));
}

function walkTabs(tabsEl: any, sf: any, parentPath: string, rows: any[]) {
  const tabsAttr = tabsEl.attributes.properties.find((a: any) => ts.isJsxAttribute(a) && a.name.getText(sf) === "tabs");
  const arr = tabsAttr?.initializer?.expression;
  if (!arr || !ts.isArrayLiteralExpression(arr)) return;
  for (const obj of arr.elements) {
    if (!ts.isObjectLiteralExpression(obj)) continue;
    let id = "", label = "", content: any = null;
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const k = p.name.getText(sf);
      if (k === "id") id = p.initializer.text;
      else if (k === "label") label = p.initializer.text ?? p.initializer.getText(sf);
      else if (k === "content") content = p.initializer;
    }
    const path = parentPath ? `${parentPath}/${id}` : id;
    const leaves: any[] = [];
    const wrappers: string[] = [];
    if (content) collectLeaf(content, sf, leaves, wrappers);
    const nested: any[] = [];
    if (content) findTabsElements(content, sf, nested);
    rows.push({ path, label, components: leaves, wrappers, hasChildren: nested.length > 0 });
    for (const t of nested) walkTabs(t, sf, path, rows);
  }
}

export function parsePage(source: string): any[] {
  const sf = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const rows: any[] = [];
  const top: any[] = [];
  findTabsElements(sf, sf, top);
  for (const t of top) walkTabs(t, sf, "", rows);
  return rows;
}

export function parsePageFile(): any[] {
  return parsePage(readFileSync(ROOT + "src/app/page.tsx", "utf8"));
}

if (process.argv.includes("--write")) {
  const rows = parsePageFile();
  const out = ROOT + "scripts/quality/study-reachability.baseline.json";
  writeFileSync(out, JSON.stringify({ note: "Frozen from src/app/page.tsx at commit c8cb756 (before the navigation rework). Every leaf here must stay reachable.", tabs: rows }, null, 1) + "\n");
  console.log(`wrote ${rows.length} tabs to ${out}`);
}
