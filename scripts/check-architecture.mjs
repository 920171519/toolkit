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

function isTypeOnlyReference(node) {
  const importClause = ts.isImportDeclaration(node) ? node.importClause : undefined;
  if (ts.isImportTypeNode(node) || node.isTypeOnly || importClause?.isTypeOnly) return true;
  // Verbatim syntax can emit a side-effect import for a list of named type imports.
  if (options.verbatimModuleSyntax || importClause?.name) return false;

  const bindings = importClause?.namedBindings ?? (ts.isExportDeclaration(node) ? node.exportClause : undefined);
  return bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
    && bindings.elements.length > 0 && bindings.elements.every((binding) => binding.isTypeOnly);
}

function importSpecifiers(source) {
  const specifiers = new Map();
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
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const runtime = !isTypeOnlyReference(node);
      specifiers.set(specifier.text, runtime || specifiers.get(specifier.text) === true);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

const entrypointDirectories = ["app/", "components/", "lib/actions/"];
const workflowMutationCallers = new Map([
  ["lib/batch-workflow.ts", ["lib/actions/batch.ts"]],
  ["lib/binding-barcode-writer.ts", ["lib/binding-workflow.ts", "lib/db.ts", "lib/seed.ts"]],
  ["lib/binding-workflow.ts", ["lib/actions/binding.ts"]],
  ["lib/release-workflow.ts", ["lib/actions/release.ts", "lib/actions/risk-trial.ts"]],
  ["lib/transfer-workflow.ts", ["lib/actions/transfer.ts"]],
  ["lib/trial-risk-admissions.ts", ["lib/batch-workflow.ts", "lib/release-workflow.ts", "lib/version-void-workflow.ts"]],
  ["lib/version-void-workflow.ts", ["lib/batch-workflow.ts", "lib/release-workflow.ts"]],
]);
const workflowPageQueries = new Set([
  "lib/workbench-queries.ts",
  "lib/version-trace-queries.ts",
  "lib/binding-queries.ts",
  "lib/batch-queries.ts",
  "lib/pending-transfer-queries.ts",
  "lib/release-queue-queries.ts",
  "lib/package-queries.ts",
  "lib/organization-queries.ts",
]);
const settingsMutationCallers = new Map([
  ["lib/area-settings.ts", "lib/actions/area-settings.ts"],
  ["lib/package-settings.ts", "lib/actions/package-settings.ts"],
  ["lib/project-settings.ts", "lib/actions/project-settings.ts"],
  ["lib/user-settings.ts", "lib/actions/user-settings.ts"],
]);
const sessionStoreCallers = new Set(["lib/auth.ts", "lib/user-settings.ts"]);
const workspacePagePattern = /^app\/\(workspace\)\/(.+\/)?page\.[jt]sx?$/;
const graph = new Map();
const routeSources = new Map();
const dependencyBoundaryErrors = [];
for (const file of files.sort()) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const name = displayPath(file);
  if (name === "proxy.ts" || name === "lib/return-to.ts") routeSources.set(name, source);
  const dependencies = new Set();
  const isEntrypoint = name === "proxy.ts" || entrypointDirectories.some((directory) => name.startsWith(directory));
  const isApplicationModule = isEntrypoint || name.startsWith("lib/");
  for (const [specifier, runtime] of importSpecifiers(source)) {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule;
    const dependency = resolved && ownedFiles.get(canonicalPath(resolved.resolvedFileName));
    if (dependency) dependencies.add(dependency);
    if (isEntrypoint && (dependency === "lib/db.ts" || specifier === "node:sqlite" || specifier === "sqlite")) {
      dependencyBoundaryErrors.push(
        `${name} imports ${specifier} directly. Use the corresponding server-side service or query module.`,
      );
    }
    if (runtime && isApplicationModule) {
      const workflowCallers = workflowMutationCallers.get(dependency);
      if (workflowCallers && !workflowCallers.includes(name)) {
        dependencyBoundaryErrors.push(
          `${name} imports the workflow mutation module directly (${dependency}). Use its owning Action or domain command.`,
        );
      }
      const settingsCaller = settingsMutationCallers.get(dependency);
      if (settingsCaller && name !== settingsCaller) {
        dependencyBoundaryErrors.push(
          `${name} imports the settings mutation module directly (${dependency}). Use settings actions for writes and settings queries for reads.`,
        );
      }
    }
    if (dependency === "lib/session-store.ts" && isApplicationModule && !sessionStoreCallers.has(name)) {
      dependencyBoundaryErrors.push(
        `${name} imports session storage directly. Use authentication or account settings.`,
      );
    }
    if (workflowMutationCallers.has(name) && workflowPageQueries.has(dependency)) {
      dependencyBoundaryErrors.push(
        `${name} depends on a page query. Read transaction facts from their owning domain module.`,
      );
    }
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
    const match = workspacePagePattern.exec(file);
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
const architectureErrors = [...workspaceRouteErrors(), ...dependencyBoundaryErrors];
if (showGraph) console.log(JSON.stringify(Object.fromEntries(graph), null, 2));
if (cycles.length || architectureErrors.length) {
  for (const cycle of cycles) console.error(`Circular dependency: ${cycle.join(" -> ")}`);
  for (const error of architectureErrors) console.error(error);
  process.exitCode = 1;
} else if (!showGraph) {
  const edges = [...graph.values()].reduce((sum, dependencies) => sum + dependencies.length, 0);
  console.log(`Architecture check: ${graph.size} modules, ${edges} dependencies, no cycles.`);
  console.log("Workspace route coverage matches the return path policy.");
  console.log("Application entrypoints access the database through services and queries.");
}
