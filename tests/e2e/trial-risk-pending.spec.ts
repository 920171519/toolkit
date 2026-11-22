import { expect, test } from "@playwright/test";
import { confirmAction, expectFlash, login } from "./helpers";

test("待转测版本经软件经理登记才进入风险试制，放弃后仍能转测", async ({ page }) => {
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
  await release.getByRole("button", { name: "放弃", exact: true }).click();
  const abandon = page.getByRole("dialog");
  await abandon.locator('textarea[name="conclusion"]').fill("联调改期，等待当前版本完成集成测试。");
  await abandon.getByRole("button", { name: "提交结论并放弃试制" }).click();
  await confirmAction(page);
  await expectFlash(page, "已放弃本次风险试制");
  await expect(page).toHaveURL(/\/trial\?project=1&release_q=2\.1\.0/);
  await expect(release).toHaveCount(0);
  await page.goto(pendingPath);
  await expect(request.getByRole("checkbox")).toBeEnabled();
});
