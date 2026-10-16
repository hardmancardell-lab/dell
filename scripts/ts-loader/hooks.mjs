// Module-loader hooks that let plain Node run the project's TypeScript for the scripts/*.test.mts checks:
//   - resolves the "@/..." alias to src/
//   - resolves extensionless relative imports (./foo -> ./foo.ts)
//   - transpiles .ts/.tsx with the project's own TypeScript (no type checking; `npm run build` and tsc do that)
// Used through scripts/ts-loader/register.mjs, for example:
//   node --import ./scripts/ts-loader/register.mjs scripts/vwap-band-engine.test.mts
import { existsSync, statSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = ROOT + "src/";
const ts = createRequire(ROOT + "package.json")("typescript");

function withExt(p) {
  for (const c of [p, p + ".ts", p + ".tsx", p + "/index.ts", p + "/index.tsx"]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const f = withExt(SRC + specifier.slice(2));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const f = withExt(fileURLToPath(new URL(specifier, context.parentURL)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  // Next ships CommonJS entry points without an exports map ("next/server" -> next/server.js), which ESM resolution will not guess.
  if (/^next\/[a-z-]+$/.test(specifier)) return next(specifier + ".js", context);
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("file:") && /\.(ts|tsx)$/.test(url) && !url.includes("node_modules")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return next(url, context);
}
