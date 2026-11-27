import { expect, test, type Locator } from "@playwright/test";
import { confirmAction, expectFlash, login, selectOptionContaining } from "./helpers";

async function viewRiskEntry(row: Locator, stage: string) {
  await row.getByRole("button", { name: "登记风险原因", exact: true }).click();
  const dialog = row.getByRole("dialog", { name: /风险试制原因$/ });
  await expect(dialog.getByText(stage, { exact: false })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "风险试制原因" })).toBeVisible();
  return dialog;
}

test("在测、未通过和缺少验收证据的风险入口按当前项目权限显示", async ({ page }) => {
  await login(page, "TEST001");
  await page.goto("/integration/4?project=1");
  const activeItem = page.getByRole("row").filter({ hasText: "1007DIA" }).filter({ hasText: "3.0.1" });
  await expect(activeItem).toBeVisible();
  await expect(activeItem.getByRole("button", { name: "登记风险原因" })).toHaveCount(0);

  await login(page, "MGR001");
  await page.goto("/integration/4?project=1");
  let dialog = await viewRiskEntry(activeItem, "集成测试中");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const unchanged = page.getByRole("row").filter({ hasText: "1003COM" });
  await expect(unchanged).toBeVisible();
  await expect(unchanged.getByRole("button", { name: "登记风险原因" })).toHaveCount(0);

  await login(page, "ADMIN001");
  await page.goto("/integration/1?project=3");
  const failed = page.getByRole("row").filter({ hasText: "1008MED" }).filter({ hasText: "4.2.0" });
  dialog = await viewRiskEntry(failed, "测试未通过");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.goto("/integration/2?project=1");
  await expect(page.getByRole("button", { name: "登记风险原因" })).toHaveCount(0);

  await login(page, "MGR001");
  await page.goto("/versions?project=1&q=1001OTA+1.6.1");
  await page.getByRole("row").filter({ hasText: "1.6.1" }).getByRole("link", { name: "全链路追溯" }).click();
  const withoutEvidence = page.getByRole("row").filter({ hasText: "星云 N1" }).filter({ hasText: "无关联批次" });
  dialog = await viewRiskEntry(withoutEvidence, "缺少正式验收记录");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
});

test("在测风险登记后遇到未通过结论，重新登记时按本次结论说明风险", async ({ page }) => {
  const packageCode = "90017RQA";
  const packageName = "项目验收回归组件";
  const version = "1.0.17";

  await login(page, "ADMIN001");
  await page.goto("/settings/packages");
  await page.getByTestId("new-package-trigger").click();
  const packageForm = page.getByTestId("new-package-form");
  await packageForm.getByRole("textbox", { name: "软件包名称" }).fill(packageName);
  await packageForm.getByRole("textbox", { name: "软件包编码" }).fill(packageCode);
  await selectOptionContaining(packageForm.locator('select[name="areaId"]'), "系统底座");
  await selectOptionContaining(packageForm.locator('select[name="ownerId"]'), "OWNER001");
  await packageForm.getByRole("button", { name: "创建并配置使用范围" }).click();
  await expectFlash(page, "软件包已创建");
  const packageSettings = new URL(page.url()).pathname;
  const usageForm = page.getByTestId("package-usage-form");
  const n1Project = usageForm.locator("details").filter({ hasText: "星云 N1" });
  await n1Project.locator("summary").click();
  const n1Usage = n1Project.getByRole("checkbox").first();
  await n1Usage.check();
  await usageForm.getByRole("button", { name: "保存使用范围" }).click();
  await expectFlash(page, "项目使用范围已更新");

  await page.goto("/submissions?project=1");
  await page.getByTestId("submit-transfer-trigger").click();
  const transfer = page.getByTestId("transfer-form");
  await transfer.getByLabel("搜索软件包").fill(packageCode);
  await transfer.getByTestId(/transfer-package-/).filter({ hasText: packageName }).click();
  await transfer.locator('input[name="version"]').fill(version);
  await transfer.locator('textarea[name="changeSummary"]').fill("验证进行中与不通过风险登记来源。");
  await transfer.locator('input[name="archiveUrl"]').fill("https://packages.example.com/test/risk-rqa.tar.gz");
  await transfer.locator('input[name="buildUrl"]').fill("https://ci.example.com/test/risk-rqa");
  await transfer.getByRole("button", { name: "提交申请" }).click();
  await expectFlash(page, "转测申请已提交");

  await login(page, "MGR001");
  await page.goto("/submissions?project=1");
  await page.getByTestId("open-batch-1").click();
  const builder = page.getByTestId("batch-builder-form");
  const includedLabel = `本轮转测 ${packageCode}`;
  await expect(builder.getByRole("checkbox", { name: includedLabel, exact: true })).toBeChecked();
  for (const checkbox of await builder.getByRole("checkbox").all()) {
    if ((await checkbox.getAttribute("aria-label")) !== includedLabel) await checkbox.uncheck();
  }
  await expect(builder.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await builder.getByLabel("批次号").fill("B117");
  await builder.getByRole("button", { name: "保存草稿并核对" }).click();
  await expectFlash(page, "转测草稿已保存");
  const batchUrl = new URL(page.url()).pathname + "?project=1";
  await page.getByRole("button", { name: "发起转测", exact: true }).click();
  await confirmAction(page);
  await expectFlash(page, "B117 已发起集成测试");
  await page.goto(batchUrl!);

  const changed = page.getByRole("row").filter({ hasText: packageName });
  let dialog = await viewRiskEntry(changed, "集成测试中");
  const earlyReason = "冒烟验证通过，断电恢复验证安排在下一轮。";
  await dialog.getByRole("textbox", { name: "风险试制原因" }).fill(earlyReason);
  await dialog.getByRole("button", { name: "纳入待发布试制" }).click();
  await expect(page).toHaveURL(/\/trial\?project=1/);
  await expectFlash(page, "风险试制原因已登记");
  const ready = page.getByRole("row").filter({ hasText: packageName });
  await ready.getByRole("link", { name: "详情", exact: true }).click();
  await expect(page.getByRole("heading", { name: "风险发布原因" })).toBeVisible();
  await expect(page.getByText(earlyReason, { exact: true })).toBeVisible();
  await page.goto(batchUrl!);
  await expect(changed.getByText("已登记风险原因")).toBeVisible();
  await expect(changed.getByRole("button", { name: "登记风险原因" })).toHaveCount(0);

  await login(page, "TEST001");
  await page.goto(batchUrl!);
  await page.getByRole("button", { name: "提交测试结论", exact: true }).click();
  const conclusion = page.getByTestId("complete-test-form");
  await conclusion.getByLabel("测试结论").selectOption("FAIL");
  await conclusion.getByLabel("问题归属").selectOption("NOT_PACKAGE_RELATED");
  await conclusion.getByLabel("测试总结").fill("断电恢复验证依赖外部台架，已记录外部原因。");
  await conclusion.locator('input[name="reportFile"]').setInputFiles({
    name: "risk-rqa-verification.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Risk admission regression report"),
  });
  await conclusion.getByRole("button", { name: "提交验证结论" }).click();
  await expectFlash(page, "验证报告已上传");

  await login(page, "MGR001");
  await page.goto("/trial?project=1");
  await expect(page.getByRole("row").filter({ hasText: packageName })).toHaveCount(0);
  await page.goto(batchUrl!);
  dialog = await viewRiskEntry(changed, "测试未通过");
  const failureReason = "已核对外部台架故障对试制的影响，本轮可复测。";
  await dialog.getByRole("textbox", { name: "风险试制原因" }).fill(failureReason);
  await dialog.getByRole("button", { name: "纳入待发布试制" }).click();
  await expect(page).toHaveURL(/\/trial\?project=1/);
  await expectFlash(page, "风险试制原因已登记");
  await ready.getByRole("link", { name: "详情", exact: true }).click();
  await expect(page.getByText(failureReason, { exact: true })).toBeVisible();
  await expect(page.getByText(earlyReason, { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "返回试制队列" }).click();
  await ready.getByRole("button", { name: "撤回风险试制", exact: true }).click();
  const abandonDialog = ready.getByRole("dialog", { name: /^撤回/ });
  await abandonDialog.getByRole("textbox", { name: "撤回原因" }).fill("本次回归验证完成，关闭测试版本的登记。");
  await abandonDialog.getByRole("button", { name: "确认撤回风险试制" }).click();
  await confirmAction(page);
  await expect(ready).toHaveCount(0);

  await login(page, "ADMIN001");
  await page.goto(packageSettings);
  await n1Usage.uncheck();
  await usageForm.getByRole("button", { name: "保存使用范围" }).click();
  await expectFlash(page, "项目使用范围已更新");
});
