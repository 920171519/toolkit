import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const configPath = resolve(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));

const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if (errors.length) throw new Error(errors.map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, "\n")).join("\n"));
const canonicalPath = (file) => ts.sys.useCaseSensitiveFileNames ? resolve(file) : resolve(file).toLowerCase();
const displayPath = (file) => relative(root, file).replaceAll("\\", "/");
const cache = ts.createModuleResolutionCache(root, canonicalPath, options);
const files = ts.sys.readDirectory(
  root,
  [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  [".git", "node_modules", ".next", "data", "out", "coverage", "test-results", "playwright-report", "next-env.d.ts"],
);
const ownedFiles = new Map(files.map((file) => [canonicalPath(file), displayPath(file)]));

function importSpecifiers(source) {
  const specifiers = new Set();
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifier = node.moduleReference.expression;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(callee) && callee.text === "require")
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && callee.expression.text === "module" && callee.name.text === "require")) {
        specifier = node.arguments[0];
      }
    }
    if (specifier && ts.isStringLiteralLike(specifier)) specifiers.add(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

const graph = new Map();
for (const file of files.sort()) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const dependencies = new Set();
  for (const specifier of importSpecifiers(source)) {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule;
    const dependency = resolved && ownedFiles.get(canonicalPath(resolved.resolvedFileName));
    if (dependency) dependencies.add(dependency);
  }
  graph.set(displayPath(file), [...dependencies].sort());
}

const complete = new Set();
const active = new Set();
const stack = [];
const cycles = [];
function visit(file) {
  if (complete.has(file)) return;
  if (active.has(file)) {
    cycles.push([...stack.slice(stack.indexOf(file)), file]);
    return;
  }

  active.add(file);
  stack.push(file);
  for (const dependency of graph.get(file)) visit(dependency);
  stack.pop();
  active.delete(file);
  complete.add(file);
}
for (const file of graph.keys()) visit(file);

const showGraph = process.argv.includes("--graph");
if (showGraph) console.log(JSON.stringify(Object.fromEntries(graph), null, 2));
if (cycles.length) {
  for (const cycle of cycles) console.error(`Circular dependency: ${cycle.join(" -> ")}`);
  process.exitCode = 1;
} else if (!showGraph) {
  const edges = [...graph.values()].reduce((sum, dependencies) => sum + dependencies.length, 0);
  console.log(`Architecture check: ${graph.size} modules, ${edges} dependencies, no cycles.`);
}
