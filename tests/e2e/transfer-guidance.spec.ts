import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { confirmAction, expectFlash, login } from "./helpers";

test("未选待测版本时可打开保存条件并定位配套", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/submissions/batch/new?project=1");
  const builder = page.getByTestId("batch-builder-form");
  for (const row of await builder.getByRole("checkbox").all()) {
    if (await row.isChecked()) await row.uncheck();
  }
  await builder.locator('input[name="title"]').fill("应保留的配套说明");
  await page.getByRole("button", { name: "保存草稿并核对" }).click();
  const guide = page.getByRole("dialog", { name: "保存转测草稿的条件" });
  await expect(guide).toContainText("至少勾选一个软件包");
  await guide.getByRole("button", { name: "定位待测版本" }).click();
  await expect(guide).toBeHidden();
  await expect(builder.getByRole("button", { name: "显示完整配套" })).toBeVisible();
  await expect(builder.locator('input[name="title"]')).toHaveValue("应保留的配套说明");
});

test("草稿占用可直达，作废配套可在原草稿修正且过期修改被拒绝", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const packageIds: number[] = [];
  let draftId: number | undefined;
  try {
    draftId = Number(db.prepare(
      "INSERT INTO integration_batches (code, project_id, title, status, created_at) VALUES ('B9886', 1, '转测引导回归', 'DRAFT', datetime('now'))",
    ).run().lastInsertRowid);
    for (const [index, active] of [true, false].entries()) {
      const packageId = Number(db.prepare(
        "INSERT INTO packages (name, code, created_at) VALUES (?, ?, datetime('now'))",
      ).run(`草稿引导测试包 ${index + 1}`, `9828${index}TQA`).lastInsertRowid);
      packageIds.push(packageId);
      db.prepare("INSERT INTO package_usages (package_id, project_id, node_id) SELECT ?, 1, id FROM project_nodes WHERE project_id = 1 ORDER BY id LIMIT 1").run(packageId);
      const versionId = Number(db.prepare(
        `INSERT INTO package_versions (package_id, version, change_summary, archive_url, status, submitted_at, updated_at)
         VALUES (?, '9.8.6', '草稿引导测试版本', 'https://packages.example.com/draft', ?, datetime('now'), datetime('now'))`,
      ).run(packageId, active ? "PENDING_TRANSFER" : "VOID").lastInsertRowid);
      const requestId = Number(db.prepare(
        `INSERT INTO version_transfer_requests (package_version_id, project_id, status, integration_status, submitted_at, updated_at)
         VALUES (?, 1, ?, 'PENDING', datetime('now'), datetime('now'))`,
      ).run(versionId, active ? "PENDING" : "VOID").lastInsertRowid);
      db.prepare(
        `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url, is_changed, transfer_request_id)
         VALUES (?, ?, ?, '9.8.6', 'https://packages.example.com/draft', 1, ?)`,
      ).run(draftId, packageId, versionId, requestId);
    }
    await page.goto("/submissions?project=1&q=98280TQA&pageSize=10");
    const occupied = page.getByRole("link", { name: "B9886 草稿占用" });
    await occupied.click();
    await page.getByRole("link", { name: "返回待安排申请" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/submissions" && url.searchParams.get("q") === "98280TQA"
      && url.searchParams.get("pageSize") === "10" && url.searchParams.get("project") === "1");
    await occupied.click();
    await page.getByRole("link", { name: "发起转测", exact: true }).click();
    const guidance = page.getByRole("dialog", { name: "B9886 · 发起转测条件" });
    await expect(guidance).toContainText("草稿引导测试包 2 9.8.6 已作废");
    await guidance.getByRole("link", { name: "调整配套" }).click();
    const stale = await page.context().newPage();
    try {
      await stale.goto(page.url());
      const editor = page.getByTestId("batch-builder-form");
      await expect(editor.locator('input[name="code"]')).toHaveValue("B9886");
      await expect(editor.getByRole("checkbox", { name: "本轮转测 草稿引导测试包 1" })).toBeChecked();
      await expect(editor.getByRole("checkbox", { name: "本轮转测 草稿引导测试包 2" })).not.toBeChecked();
      await editor.getByRole("button", { name: "保存草稿并核对" }).click();
      await expectFlash(page, "转测草稿已更新");
      await expect(page).toHaveURL((url) => url.pathname === `/integration/${draftId}` && url.searchParams.get("project") === "1");
      await expect(page.getByRole("link", { name: "返回待安排申请" })).toHaveAttribute("href", /q=98280TQA.*pageSize=10/);
      await expect(page.getByRole("row").filter({ hasText: "草稿引导测试包 2" })).toHaveCount(0);
      await stale.getByRole("button", { name: "保存草稿并核对" }).click();
      await expect(stale.getByTestId("batch-builder-form").getByRole("alert")).toContainText("此草稿已被其他操作更新");
    } finally {
      await stale.close();
    }
    const formerEditor = await page.getByRole("link", { name: "调整配套" }).getAttribute("href");
    if (!formerEditor) throw new Error("调整配套入口缺失");
    await page.getByRole("button", { name: "发起转测", exact: true }).click();
    await confirmAction(page);
    await expectFlash(page, "B9886 已发起集成测试");
    await page.goto(formerEditor);
    await expect(page).toHaveURL((url) => url.pathname === `/integration/${draftId}`);
    await expect(page.getByRole("link", { name: "返回在测批次" })).toBeVisible();
  } finally {
    if (draftId) {
      db.prepare("DELETE FROM audit_logs WHERE entity_type = 'BATCH' AND entity_id = ?").run(draftId);
      db.prepare("DELETE FROM integration_batches WHERE id = ?").run(draftId);
    }
    for (const id of packageIds) db.prepare("DELETE FROM packages WHERE id = ?").run(id);
    db.close();
  }
});

test("不支持的测试报告就近提示，且保留测试摘要", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"), { readOnly: true });
  const active = db.prepare("SELECT id FROM integration_batches WHERE code = 'B120' AND status = 'IN_TEST'").get();
  db.close();
  if (!active) throw new Error("演示数据缺少在测批次 B120");
  await page.goto(`/integration/${active.id}?project=1`);
  await page.getByRole("button", { name: "提交测试结论" }).click();
  const form = page.getByTestId("complete-test-form");
  await form.getByLabel("测试结论").selectOption("PASS");
  const summary = form.getByLabel("测试总结");
  await summary.fill("这段集成测试结果在报告校验后应当保留。");
  const report = form.getByLabel("验证报告");
  await report.setInputFiles({ name: "unsupported.csv", mimeType: "text/csv", buffer: Buffer.from("result,pass") });
  await expect(form.getByRole("alert")).toContainText("验证报告仅支持");
  await expect(report).toHaveAttribute("aria-invalid", "true");
  await form.getByRole("button", { name: "提交验证结论" }).click();
  await expect(summary).toHaveValue("这段集成测试结果在报告校验后应当保留。");
  await expect(report).toBeFocused();
  await report.evaluate((element: HTMLInputElement) => element.setCustomValidity(""));
  await form.getByRole("button", { name: "提交验证结论" }).click();
  const fixReport = form.getByRole("button", { name: /验证报告仅支持 PDF/ });
  await expect(fixReport).toBeVisible();
  await fixReport.click();
  await expect(report).toBeFocused();
  await expect(summary).toHaveValue("这段集成测试结果在报告校验后应当保留。");
  await report.setInputFiles({ name: "supported.txt", mimeType: "text/plain", buffer: Buffer.from("PASS") });
  await expect(form.locator("#report-error")).toHaveCount(0);
});
