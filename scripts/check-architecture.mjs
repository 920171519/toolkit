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
const routeSources = new Map();
for (const file of files.sort()) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const name = displayPath(file);
  if (name === "proxy.ts" || name === "lib/return-to.ts") routeSources.set(name, source);
  const dependencies = new Set();
  for (const specifier of importSpecifiers(source)) {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule;
    const dependency = resolved && ownedFiles.get(canonicalPath(resolved.resolvedFileName));
    if (dependency) dependencies.add(dependency);
  }
  graph.set(name, [...dependencies].sort());
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

function variableInitializer(source, name, exported = false) {
  for (const statement of source?.statements ?? []) {
    if (!ts.isVariableStatement(statement)) continue;
    if (exported && !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const declaration = statement.declarationList.declarations.find((node) => ts.isIdentifier(node.name) && node.name.text === name);
    if (declaration) return declaration.initializer;
  }
}

function literalStrings(node) {
  if (node && ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteral)) {
    return node.elements.map((element) => element.text);
  }
}

function workspaceRouteErrors() {
  const policy = routeSources.get("lib/return-to.ts");
  const prefixes = literalStrings(variableInitializer(policy, "workspacePathPrefixes"));
  const exactPaths = literalStrings(variableInitializer(policy, "workspaceExactPaths"));
  if (!prefixes || !exactPaths) return ["lib/return-to.ts must declare literal workspace path lists."];
  const config = variableInitializer(routeSources.get("proxy.ts"), "config", true);
  const matcher = config && ts.isObjectLiteralExpression(config) && config.properties.find((property) =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "matcher");
  const matchers = matcher && literalStrings(matcher.initializer);
  if (!matchers) return ["proxy.ts must export config with a literal matcher array."];

  const problems = [];
  const expected = [...prefixes.map((path) => `${path}/:path*`), ...exactPaths];
  for (const path of expected) if (!matchers.includes(path)) problems.push(`Missing proxy matcher ${path}.`);
  for (const path of matchers) if (!expected.includes(path)) problems.push(`Proxy matcher is outside the workspace path policy: ${path}.`);

  const pages = [...graph.keys()].flatMap((file) => {
    const match = /^app\/\(workspace\)\/(.+\/)?page\.[jt]sx?$/.exec(file);
    return match ? ["/" + (match[1] ?? "").split("/").filter((segment) => segment && !segment.startsWith("(") && !segment.startsWith("@")).join("/")] : [];
  });
  const inSection = (page, prefix) => page === prefix || page.startsWith(`${prefix}/`);
  for (const page of pages) {
    if (!exactPaths.includes(page) && !prefixes.some((prefix) => inSection(page, prefix))) {
      problems.push(`Workspace page has no return path or proxy coverage: ${page}.`);
    }
  }
  for (const prefix of prefixes) if (!pages.some((page) => inSection(page, prefix))) problems.push(`Workspace path prefix has no page: ${prefix}.`);
  for (const path of exactPaths) if (!pages.includes(path)) problems.push(`Exact workspace path has no page: ${path}.`);
  if (new Set(expected).size !== expected.length || new Set(matchers).size !== matchers.length) problems.push("Duplicate workspace path policy or proxy matchers.");
  return problems;
}

const showGraph = process.argv.includes("--graph");
const routeErrors = workspaceRouteErrors();
if (showGraph) console.log(JSON.stringify(Object.fromEntries(graph), null, 2));
if (cycles.length || routeErrors.length) {
  for (const cycle of cycles) console.error(`Circular dependency: ${cycle.join(" -> ")}`);
  for (const error of routeErrors) console.error(error);
  process.exitCode = 1;
} else if (!showGraph) {
  const edges = [...graph.values()].reduce((sum, dependencies) => sum + dependencies.length, 0);
  console.log(`Architecture check: ${graph.size} modules, ${edges} dependencies, no cycles.`);
  console.log("Workspace route coverage matches the return path policy.");
}
