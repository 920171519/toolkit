import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(new URL("../scripts/check-architecture.mjs", import.meta.url));

const sources = {
  "proxy.ts": 'export const config = { matcher: ["/dashboard/:path*"] };',
  "app/(workspace)/dashboard/page.tsx": "export default null;",
  "lib/return-to.ts": 'const workspacePathPrefixes = ["/dashboard"]; const workspaceExactPaths = [];',
  "lib/db.ts": "export const db = null;",
  "lib/session-store.ts": "export const session = null;",
  "lib/auth.ts": 'export { session } from "./session-store";',
  "lib/area-settings.ts": "export function deleteArea() {}",
  "lib/actions/settings.ts": 'export { deleteArea } from "../area-settings";',
  "lib/batch-workflow.ts": 'export { voidVersionRecords } from "./version-void-workflow"; export type BatchInput = string;',
  "lib/actions/workflow.ts": 'export { voidVersionRecords } from "../batch-workflow";',
  "lib/version-void-workflow.ts": "export function voidVersionRecords() {}",
  "lib/batch-queries.ts": "export function getBatch() {}",
};

function checkFixture(t, overrides = {}, compilerOptions = {}) {
  const tempParent = realpathSync(tmpdir());
  const root = mkdtempSync(join(tempParent, "toolkit-check-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: { "@/*": ["./*"] },
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "preserve",
      ...compilerOptions,
    },
  }));
  for (const [file, source] of Object.entries({ ...sources, ...overrides })) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }

  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8", timeout: 15_000 });
  assert.ifError(result.error);
  return result;
}

test("allows registered runtime owners and explicit type-only dependencies", (t) => {
  const result = checkFixture(t, {
    "components/example.ts": [
      'import type { BatchInput } from "@/lib/batch-workflow";',
      'import { type BatchInput as NamedBatchInput } from "@/lib/batch-workflow";',
      'export type Input = BatchInput | NamedBatchInput | import("@/lib/batch-workflow").BatchInput;',
      'export { deleteArea } from "@/lib/actions/settings";',
    ].join("\n"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Workspace route coverage matches/);
});

test("rejects invalid workflow, settings, SQLite and session-store dependencies", (t) => {
  const result = checkFixture(t, {
    "app/api/example/route.ts": 'export const batch = import("@/lib/batch-workflow");',
    "lib/wrapper.ts": [
      'import type { BatchInput } from "./batch-workflow";',
      'export { voidVersionRecords } from "./batch-workflow";',
      "export type Input = BatchInput;",
    ].join("\n"),
    "lib/actions/other.ts": 'export const area = require("../area-settings");',
    "components/example.ts": 'import "@/lib/db"; import "node:sqlite";',
    "lib/other.ts": 'export { session } from "./session-store";',
    "lib/batch-workflow.ts": sources["lib/batch-workflow.ts"] + ' export { getBatch } from "./batch-queries";',
  });

  assert.equal(result.status, 1, result.stdout);
  for (const diagnostic of [
    "app/api/example/route.ts imports the workflow mutation module directly (lib/batch-workflow.ts)",
    "lib/wrapper.ts imports the workflow mutation module directly (lib/batch-workflow.ts)",
    "lib/actions/other.ts imports the settings mutation module directly (lib/area-settings.ts)",
    "components/example.ts imports @/lib/db directly",
    "components/example.ts imports node:sqlite directly",
    "lib/other.ts imports session storage directly",
    "lib/batch-workflow.ts depends on a page query",
  ]) {
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
  }
});

test("rejects emitted runtime imports under verbatim module syntax", (t) => {
  const result = checkFixture(t, {
    "components/example.ts": 'import { type BatchInput } from "@/lib/batch-workflow"; export type Input = BatchInput;',
  }, { verbatimModuleSyntax: true });

  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("components/example.ts imports the workflow mutation module directly"), result.stderr);
});

test("reports route policy drift and cycles in type dependencies", (t) => {
  const result = checkFixture(t, {
    "proxy.ts": 'export const config = { matcher: ["/login/:path*"] };',
    "app/(workspace)/new-section/page.tsx": "export default null;",
    "lib/first.ts": 'import type { Second } from "./second"; export type First = Second;',
    "lib/second.ts": 'import type { First } from "./first"; export type Second = First;',
  });

  assert.equal(result.status, 1, result.stdout);
  for (const diagnostic of [
    "Circular dependency: lib/first.ts -> lib/second.ts -> lib/first.ts",
    "Missing proxy matcher /dashboard/:path*",
    "Proxy matcher is outside the workspace path policy: /login/:path*",
    "Workspace page has no return path or proxy coverage: /new-section",
  ]) {
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
  }
});
