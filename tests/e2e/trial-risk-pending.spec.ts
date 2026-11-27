import { expect, test } from "@playwright/test";
import { confirmAction, expectFlash, login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("待转测版本经软件经理登记才进入风险试制，撤回风险试制后仍能转测", async ({ page }) => {
  await login(page, "MGR001");
  const pendingPath = "/submissions?project=1";
  const trialPath = "/trial?project=1&release_q=2.1.0";
  const releases = page.getByRole("region", { name: "待发布试制表格" });
  const release = releases.getByRole("row").filter({ hasText: "2.1.0" });
  await page.goto(trialPath);
  await expect(release).toHaveCount(0);

  await page.goto(pendingPath);
  const request = page.getByRole("region", { name: "星云 N1待转测申请表格" }).getByRole("row").filter({ hasText: "2.1.0" });
  await expect(request).toHaveCount(1);
  await request.getByRole("button", { name: "登记风险原因", exact: true }).click();
  const admission = page.getByRole("dialog");
  const reason = "设备联调需要提前试制，完整集成测试按计划安排。";
  await admission.getByRole("textbox", { name: "风险试制原因" }).fill(reason);
  await admission.getByRole("button", { name: "纳入待发布试制" }).click();
  await expectFlash(page, "风险试制原因已登记");
  await expect(release).toContainText("风险发布");

  await page.goto(trialPath);
  await release.getByRole("button", { name: "撤回风险试制", exact: true }).click();
  const abandon = page.getByRole("dialog");
  await abandon.locator('textarea[name="conclusion"]').fill("联调改期，等待当前版本完成集成测试。");
  await abandon.getByRole("button", { name: "确认撤回风险试制" }).click();
  await confirmAction(page);
  await expectFlash(page, "已撤回本次风险试制");
  await expect(page).toHaveURL(/\/trial\?project=1&release_q=2\.1\.0/);
  await expect(release).toHaveCount(0);
  await page.goto(pendingPath);
  await expect(request.getByRole("checkbox")).toBeEnabled();
});

test.afterEach(() => {
  const db = openE2eDatabase();
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const fixture = db.prepare("SELECT id FROM package_versions WHERE package_id = 2 AND version = '6.6.41'").get();
    if (fixture) {
      db.prepare("DELETE FROM audit_logs WHERE entity_type = 'PACKAGE_VERSION' AND entity_id = ?").run(fixture.id);
      db.prepare("DELETE FROM package_versions WHERE id = ?").run(fixture.id);
    }
  } finally {
    db.close();
  }
});

test("显式作废待发布的风险试制会同步作废全部项目转测申请", async ({ page }) => {
  const version = "6.6.41";
  const characterization = "共享联调安排变更，该软件包版本不再使用。";
  await login(page, "ADMIN001");
  await page.goto("/submissions/transfer?project=1&package=2");
  const form = page.getByTestId("transfer-form");
  await form.locator('input[name="version"]').fill(version);
  await form.locator('textarea[name="changeSummary"]').fill("验证待发布风险试制作废和共享项目转测联动。");
  await form.locator('input[name="archiveUrl"]').fill("https://packages.example.com/cfg/6.6.41.tar.gz");
  await form.locator('input[name="buildUrl"]').fill("https://ci.example.com/cfg/6.6.41");
  await form.getByRole("button", { name: "提交申请" }).click();
  await expectFlash(page, "并发送至 2 个项目");

  const transferRow = page.getByRole("row").filter({ hasText: version });
  await transferRow.getByRole("button", { name: "登记风险原因" }).click();
  const admission = page.getByRole("dialog");
  await admission.getByRole("textbox", { name: "风险试制原因" }).fill("当前设备联调需要提前安排试制。");
  await admission.getByRole("button", { name: "纳入待发布试制" }).click();
  await expectFlash(page, "风险试制原因已登记");

  const trialPath = `/trial?project=1&release_q=${version}`;
  await page.goto(trialPath);
  const trialRow = page.getByRole("row").filter({ hasText: version });
  await trialRow.getByRole("button", { name: "作废版本", exact: true }).click();
  const voidDialog = page.getByRole("dialog", { name: `作废 1002CFG ${version}` });
  await voidDialog.getByRole("textbox", { name: "作废原因" }).fill(characterization);
  await voidDialog.getByRole("button", { name: "确认作废该版本" }).click();
  await expectFlash(page, "该软件包版本及各项目转测申请已作废");
  await expect(trialRow).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`release_q=${version.replaceAll(".", "\\.")}`));

  for (const project of [1, 3]) {
    await page.goto(`/submissions?project=${project}`);
    await expect(transferRow).toHaveCount(0);
  }
  await page.goto(`/versions?project=1&q=${version}`);
  const traceRow = page.getByRole("row").filter({ hasText: version });
  await expect(traceRow).toContainText("作废");
  await traceRow.getByRole("link", { name: "全链路追溯" }).click();
  await expect(page.getByText(characterization, { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: "查看跨项目版本证据" }).click();
  await expect(page.getByRole("row").filter({ hasText: /星云 N1|磐石 T3/ }).filter({ hasText: "已作废" })).toHaveCount(2);
});
