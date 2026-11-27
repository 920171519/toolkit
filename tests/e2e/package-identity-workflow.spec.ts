import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";

test("新建软件包和旧演示包在转测选择、批次配套、试制及转正中沿用正确编码", async ({ page }) => {
  test.setTimeout(120_000);
  const code = "99991ZQA";
  const name = "000 多域网关校验服务";
  const version = "1.0.0-identity";
  const batchCode = "B99991";
  await login(page, "ADMIN001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
  const removeDraft = () => {
    db.prepare("DELETE FROM audit_logs WHERE entity_type = 'BATCH' AND entity_id IN (SELECT id FROM integration_batches WHERE code = ?)").run(batchCode);
    db.prepare("DELETE FROM integration_batches WHERE code = ?").run(batchCode);
  };
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
    await page.goto("/settings/packages");
    await page.getByTestId("new-package-trigger").click();
    const create = page.getByTestId("new-package-form");
    await create.getByRole("textbox", { name: "软件包编码" }).fill(code.toLowerCase());
    await create.getByRole("textbox", { name: "软件包名称" }).fill(name);
    await create.getByRole("combobox", { name: "责任田", exact: true }).selectOption({ label: "系统底座" });
    await create.getByRole("combobox", { name: "责任人", exact: true }).selectOption({ label: "王磊 · OWNER001" });
    await create.getByRole("button", { name: "创建并配置使用范围" }).click();
    await expectFlash(page, "软件包已创建");
    const packageForm = page.getByTestId("package-meta-form");
    await expect(packageForm.getByRole("textbox", { name: "软件包编码" })).toHaveValue(code);
    await expect(packageForm.getByRole("textbox", { name: "软件包名称" })).toHaveValue(name);
    const usage = page.getByTestId("package-usage-form");
    const n1 = usage.locator("details").filter({ hasText: "星云 N1" });
    await n1.locator("summary").click();
    await n1.getByRole("checkbox", { name: /^EVT/ }).check();
    await usage.getByRole("button", { name: "保存使用范围" }).click();
    await expectFlash(page, "项目使用范围已更新");

    await page.goto("/submissions/transfer?project=1");
    const transfer = page.getByTestId("transfer-form");
    const search = transfer.getByRole("searchbox", { name: "搜索软件包" });
    await search.fill("1001OTA");
    await expect(transfer.getByRole("button", { name: /^1001OTA\b/ })).toBeVisible();
    await search.fill(name);
    const choice = transfer.getByRole("button", { name: new RegExp("^" + code) });
    await expect(choice.getByText(name, { exact: false })).toBeHidden();
    const showTransferNames = transfer.getByRole("switch", { name: "显示软件包名称" });
    await expect(showTransferNames).not.toBeChecked();
    await showTransferNames.press("Space");
    await expect(showTransferNames).toBeChecked();
    await expect(choice.getByText(name, { exact: false })).toBeVisible();
    await choice.click();
    const selected = transfer.getByRole("group", { name: "软件包" });
    await expect(selected.locator("strong")).toHaveText(code);
    await expect(selected.getByText(name, { exact: false })).toBeVisible();
    await transfer.locator('input[name="version"]').fill(version);
    await transfer.locator('textarea[name="changeSummary"]').fill("验证软件包编码及名称显示");
    await transfer.locator('input[name="archiveUrl"]').fill("https://packages.example.com/e2e/package-identity");
    await transfer.locator('input[name="buildUrl"]').fill("https://ci.example.com/e2e/package-identity");
    await transfer.getByRole("button", { name: "提交申请" }).click();
    await expectFlash(page, "转测申请已提交");

    await page.goto("/submissions/batch/new?project=1");
    const builder = page.getByTestId("batch-builder-form");
    await expect(builder.getByRole("checkbox", { name: "本轮转测 1001OTA", exact: true })).toBeVisible();
    const newOption = builder.getByRole("row").filter({ hasText: code });
    await expect(newOption.getByText(name, { exact: false })).toBeHidden();
    await builder.getByRole("switch", { name: "显示软件包名称" }).check();
    await expect(newOption.getByText(name, { exact: false })).toBeVisible();
    await expect(newOption.getByRole("checkbox", { name: "本轮转测 " + code, exact: true })).toBeChecked();
    await expect(newOption.getByRole("combobox", { name: code + " 本次转测版本", exact: true }).locator("option:checked")).toContainText(version);
    await builder.locator('input[name="code"]').fill(batchCode);
    await builder.locator('input[name="title"]').fill("核对软件包编码和名称");
    await builder.getByRole("button", { name: "保存草稿并核对" }).click();
    await expectFlash(page, "转测草稿已保存");
    const snapshot = page.getByRole("region", { name: "配套版本快照表格" });
    const packageRow = snapshot.getByRole("row").filter({ hasText: code });
    await expect(packageRow.getByRole("link", { name: code, exact: true })).toBeVisible();
    await expect(packageRow.getByText(name, { exact: false })).toBeHidden();
    await page.getByRole("switch", { name: "显示软件包名称" }).check();
    await expect(packageRow.getByText(name, { exact: false })).toBeVisible();
    await expect(packageRow.getByRole("link", { name: "查看 " + code + " " + version + " 版本全链路", exact: true })).toBeVisible();

    await page.goto("/trial?project=1");
    const release = page.getByRole("region", { name: "待发布试制", exact: true });
    await release.getByRole("button", { name: "筛选软件包", exact: true }).click();
    const menu = release.getByRole("dialog", { name: "筛选软件包", exact: true });
    await menu.getByRole("combobox", { name: "软件包编码或名称匹配方式" }).selectOption("exact");
    await menu.getByRole("textbox", { name: "软件包编码或名称", exact: true }).fill("OTA");
    await menu.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page).toHaveURL(/f_release_package=OTA/);
    await expect(release.getByRole("link", { name: "1001OTA", exact: true }).first()).toBeVisible();

    // Use status fixtures for the queue display checks after exercising real transfer and draft creation.
    const { id: versionId } = db.prepare(
      "SELECT v.id FROM package_versions v JOIN packages p ON p.id = v.package_id WHERE p.code = ? AND v.version = ?",
    ).get(code, version) as { id: number };
    removeDraft();
    const setVersionStatus = db.prepare("UPDATE package_versions SET status = ? WHERE id = ?");
    const setRequestStatus = db.prepare(
      "UPDATE version_transfer_requests SET status = ?, integration_status = 'PASSED' WHERE package_version_id = ?",
    );
    setVersionStatus.run("TRIAL", versionId);
    setRequestStatus.run("TRIAL", versionId);
    await page.goto("/trial?project=1&view=binding");
    const binding = page.getByRole("region", { name: "试制版本绑定验证", exact: true });
    const sort = binding.getByRole("link", { name: "按软件包编码排序" });
    const bindingRows = binding.locator("tbody tr");
    const trialPackage = bindingRows.filter({ hasText: code });
    await expect(trialPackage.getByRole("link", { name: code, exact: true })).toBeVisible();
    await expect(trialPackage).not.toContainText(name);
    await sort.click();
    await expect(binding.locator('th[aria-sort="ascending"]')).toContainText("软件包");
    await expect(bindingRows.first().getByRole("link", { name: "1006KEY", exact: true })).toBeVisible();
    await sort.click();
    await expect(bindingRows.first().getByRole("link", { name: code, exact: true })).toBeVisible();
    await page.goto("/trial?project=1&view=binding&f_binding_package=" + code + "&f_binding_package_mode=exact");
    await expect(bindingRows).toHaveCount(1);
    await expect(trialPackage).toBeVisible();

    setVersionStatus.run("PENDING_FORMAL", versionId);
    setRequestStatus.run("PENDING_FORMAL", versionId);
    await page.goto("/formal?project=1&q=" + encodeURIComponent(name));
    const formal = page.getByRole("region", { name: "待转正版本列表" });
    await expect(formal.getByRole("link", { name: code + " " + version, exact: true })).toBeVisible();
    await expect(formal.getByRole("row").filter({ hasText: code })).not.toContainText(name);
  } finally {
    try {
      removeDraft();
      db.prepare("DELETE FROM audit_logs WHERE entity_type = 'PACKAGE' AND entity_id IN (SELECT id FROM packages WHERE code = ?)").run(code);
      db.prepare("DELETE FROM packages WHERE code = ?").run(code);
    } finally {
      db.close();
    }
  }
});
