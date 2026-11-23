import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { confirmAction, expectFlash, login } from "./helpers";

const packageId = 2;
const settingsUrl = `/settings/packages/${packageId}`;

test.afterEach(() => {
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const fixtures = db.prepare(
      "SELECT id FROM package_versions WHERE package_id = ? AND version IN ('9.8.31', '9.8.32')",
    ).all(packageId);
    for (const { id } of fixtures) {
      db.prepare("DELETE FROM audit_logs WHERE entity_type = 'PACKAGE_VERSION' AND entity_id = ?").run(id);
      db.prepare("DELETE FROM package_versions WHERE id = ?").run(id);
    }
  } finally {
    db.close();
  }
});

async function importRelease(page: Page, version: string, status: "TRIAL" | "FORMAL") {
  await page.goto(`/settings/packages/import?package=${packageId}`);
  const form = page.locator("main form");
  await form.locator('input[name="version"]').fill(version);
  await form.getByLabel("版本说明/修复内容").fill("从旧系统补录软件包版本。");
  await form.getByLabel("归档地址").fill("https://packages.example.com/legacy/original.tar.gz");
  await form.getByLabel("构建地址").fill("https://ci.example.com/legacy/original");
  await form.getByLabel("历史状态").selectOption(status);
  if (status === "TRIAL") {
    await form.getByLabel("试制电子流").fill("EF-LEGACY-TRIAL");
    await form.getByLabel("试制发布日期").fill("2026-11-01");
  } else {
    await form.getByLabel("转正电子流").fill("EF-LEGACY-FORMAL");
    await form.getByLabel("转正日期").fill("2026-11-02");
  }
  await form.getByRole("button", { name: "导入历史版本" }).click();
  await expectFlash(page, "历史版本已导入");
}

test("历史试制不阻挡项目范围编辑，允许管理员更正并保留作废追溯", async ({ page }) => {
  const version = "9.8.31";
  const correctedArchive = "https://packages.example.com/legacy/corrected.tar.gz";
  const correctionReason = "原补录将构建记录指向了错误的归档。";
  await login(page, "ADMIN001");
  await importRelease(page, version, "TRIAL");

  const usageForm = page.getByTestId("package-usage-form");
  await expect(usageForm).toBeVisible();
  await usageForm.getByRole("button", { name: "保存使用范围" }).click();
  await expectFlash(page, "项目使用范围已更新");

  await page.goto("/settings/packages");
  const pkgRow = page.getByRole("row").filter({ hasText: "1002CFG" });
  await expect(pkgRow).not.toContainText(/启用|停用|试制验证中/);
  await pkgRow.getByRole("link", { name: "配置 1002CFG" }).click();

  const history = page.getByRole("region", { name: "历史补录版本表格" });
  const imported = history.getByRole("row").filter({ hasText: version });
  await expect(imported).toContainText("试制记录");
  await imported.getByRole("link", { name: "更正补录" }).click();
  await expect(page).toHaveURL(/\/settings\/packages\/2\/history\/\d+/);
  const correctionUrl = page.url();
  const form = page.getByTestId("correct-legacy-version-form");
  await expect(form.locator('input[name="version"]')).toHaveCount(0);
  await expect(form.getByLabel("历史状态")).toHaveCount(0);
  await expect(form.getByLabel("试制电子流")).toHaveValue("EF-LEGACY-TRIAL");
  await form.getByLabel("归档地址").fill(correctedArchive);
  await form.getByLabel("更正原因").fill(correctionReason);
  await form.getByRole("button", { name: "保存更正" }).click();
  await confirmAction(page);
  await expectFlash(page, "历史版本已更正");

  const traceLink = await imported.getByRole("link", { name: "全链路追溯" }).getAttribute("href");
  const versionId = Number(traceLink?.split("/").at(-1));
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"), { readOnly: true });
  try {
    const entry = db.prepare("SELECT actor_id, detail FROM audit_logs WHERE entity_type = 'PACKAGE_VERSION' AND entity_id = ? AND action = 'CORRECT_LEGACY_VERSION'")
      .get(versionId) as { actor_id: number; detail: string };
    expect(entry.actor_id).toBeGreaterThan(0);
    expect(JSON.parse(entry.detail)).toMatchObject({
      packageId,
      version,
      status: "TRIAL",
      reason: correctionReason,
      before: { archiveUrl: "https://packages.example.com/legacy/original.tar.gz" },
      after: { archiveUrl: correctedArchive },
    });
  } finally {
    db.close();
  }

  await login(page, "OWNER001");
  await page.goto(settingsUrl);
  await expect(imported).toBeVisible();
  await expect(imported.getByRole("link", { name: "更正补录" })).toHaveCount(0);
  await expect(imported.getByRole("button", { name: "作废版本" })).toHaveCount(0);
  await page.goto(correctionUrl);
  await expect(page.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
  await expect(page.getByTestId("correct-legacy-version-form")).toHaveCount(0);

  await login(page, "ADMIN001");
  await page.goto(settingsUrl);
  await imported.getByRole("button", { name: "作废版本", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: `作废 1002CFG ${version}` });
  await confirmation.getByLabel("作废原因").fill("旧试制记录已确认不可继续使用。");
  await confirmation.getByRole("button", { name: "确认作废该版本" }).click();
  await expectFlash(page, "该软件包版本已作废");
  await expect(imported).toContainText("已作废");
  await expect(imported.getByRole("link", { name: "更正补录" })).toHaveCount(0);
  await expect(imported.getByRole("button", { name: "作废版本" })).toHaveCount(0);

  await page.goto(`${traceLink}?project=1`);
  await expect(page.getByRole("heading", { level: 1, name: `1002CFG ${version}` })).toBeVisible();
  await expect(page.getByText("已作废 · 旧试制记录已确认不可继续使用。", { exact: true })).toBeVisible();
  await page.goto(`/versions?project=1&q=1002CFG+${version}`);
  await expect(page.getByRole("row").filter({ hasText: version })).toBeVisible();
});

test("导入的正式版本可以从项目追溯作废并保留发布证据", async ({ page }) => {
  const version = "9.8.32";
  await login(page, "ADMIN001");
  await importRelease(page, version, "FORMAL");
  const imported = page.getByRole("region", { name: "历史补录版本表格" }).getByRole("row").filter({ hasText: version });
  const traceLink = await imported.getByRole("link", { name: "全链路追溯" }).getAttribute("href");
  await page.goto(`${traceLink}?project=1`);
  await page.getByRole("button", { name: "作废版本", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: `作废 1002CFG ${version}` });
  await confirmation.getByLabel("作废原因").fill("旧正式发布记录已经确认失效。");
  await confirmation.getByRole("button", { name: "确认作废该版本" }).click();
  await expectFlash(page, "该软件包版本已作废");
  await expect(page.getByText("转正电子流 EF-LEGACY-FORMAL")).toBeVisible();
  await page.goto("/packages?project=1");
  const packageRow = page.getByRole("row").filter({ hasText: "1002CFG" });
  await expect(packageRow).not.toContainText(version);
});
