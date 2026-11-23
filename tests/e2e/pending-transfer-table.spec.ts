import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";

test("待转测表头筛选保留互斥选择和暂缓项，核对完整配套后详情可返回原行", async ({ page }) => {
  await login(page, "OWNER002");
  await page.goto("/submissions?project=1");
  await page.getByTestId("submit-transfer-trigger").click();
  const transfer = page.getByTestId("transfer-form");
  await transfer.getByLabel("搜索软件包").fill("1003COM");
  await transfer.getByTestId(/transfer-package-/).filter({ hasText: "1003COM" }).click();
  await transfer.locator('input[name="version"]').fill("2.9.70");
  await transfer.locator('textarea[name="changeSummary"]').fill("验证同一软件包有两个待测版本。");
  await transfer.locator('input[name="archiveUrl"]').fill("https://packages.example.com/issue7/com-2.9.70.tar.gz");
  await transfer.locator('input[name="buildUrl"]').fill("https://ci.example.com/issue7/com-2.9.70");
  await transfer.getByRole("button", { name: "提交申请" }).click();
  await expectFlash(page, "转测申请已提交");

  await login(page, "MGR001");
  await page.goto("/submissions?project=1");
  const pending = page.getByRole("region", { name: "星云 N1待转测申请表格" });
  await expect(pending.getByRole("columnheader")).toHaveCount(7);
  for (const label of ["本轮转测", "软件包编码", "版本", "提交人", "提交时间", "归档地址"]) {
    await expect(pending.getByRole("button", { name: "筛选" + label, exact: true })).toBeVisible();
  }
  const oldRequest = pending.getByRole("row").filter({ hasText: "1003COM" }).filter({ hasText: "2.1.0" });
  const newRequest = pending.getByRole("row").filter({ hasText: "1003COM" }).filter({ hasText: "2.9.70" });
  await expect(oldRequest.getByRole("cell", { name: "陈曦", exact: true })).toBeVisible();
  await expect(oldRequest.locator("time")).toHaveAttribute("datetime", /2026-11-12/);
  await expect(oldRequest.getByRole("rowheader")).toHaveText("1003COM");
  await expect(oldRequest.getByRole("link", { name: "归档包", exact: true })).toHaveAttribute("href", /^https?:\/\//);
  const archiveUrl = "https://packages.example.com/issue7/com-2.9.70.tar.gz";
  const archiveLink = newRequest.getByRole("link", { name: "归档包", exact: true });
  await expect(archiveLink).toHaveAttribute("href", archiveUrl);
  await expect(newRequest.getByRole("cell").filter({ hasText: archiveUrl })).toHaveCount(0);
  await page.context().route(archiveUrl, (route) => route.fulfill({ contentType: "text/plain", body: "归档包" }));
  const [archivePage] = await Promise.all([page.waitForEvent("popup"), archiveLink.click()]);
  await expect(archivePage).toHaveURL(archiveUrl);
  await archivePage.close();

  const oldChoice = oldRequest.getByRole("checkbox", { name: "本轮转测 1003COM 2.1.0" });
  const newChoice = newRequest.getByRole("checkbox", { name: "本轮转测 1003COM 2.9.70" });
  await expect(newChoice).toBeChecked();
  await oldChoice.check();
  await expect(newChoice).not.toBeChecked();

  await pending.getByRole("button", { name: "筛选版本", exact: true }).click();
  const versionMenu = pending.getByRole("dialog", { name: "筛选版本", exact: true });
  await versionMenu.getByRole("textbox", { name: "版本号", exact: true }).fill("2.9.70");
  await versionMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(newChoice).not.toBeChecked();
  await expect(oldChoice).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "个已勾选版本被筛选隐藏，仍计入本轮" })).toBeVisible();
  await page.getByTestId("open-batch-1").click();
  await expect(page.getByRole("heading", { name: "完整配套清单" })).toBeVisible();
  const batch = page.getByTestId("batch-builder-form");
  const batchVersion = batch.getByRole("combobox", { name: "1003COM 本次转测版本" });
  await expect(batchVersion.locator("option:checked")).toContainText("2.1.0");
  await expect(batch.getByRole("row").filter({ hasText: "1003COM" })).toContainText("筛选隐藏但已纳入");
  await page.getByRole("link", { name: "返回转测申请" }).click();

  const search = page.getByRole("search", { name: "软件包、版本、项目或人员" });
  await search.getByRole("searchbox").fill("1003COM 2.9.70");
  await search.getByRole("button", { name: "搜索" }).click();
  await page.reload();
  await expect(oldChoice).toHaveCount(0);
  await expect(newChoice).not.toBeChecked();
  await page.getByTestId("open-batch-1").click();
  await expect(batchVersion.locator("option:checked")).toContainText("2.1.0");
  await page.getByRole("link", { name: "返回转测申请" }).click();
  await expect(search.getByRole("searchbox")).toHaveValue("1003COM 2.9.70");

  await search.getByRole("searchbox").fill("1003COM");
  await search.getByRole("button", { name: "搜索" }).click();
  await oldChoice.uncheck();
  const details = oldRequest.getByRole("link", { name: "查看 1003COM 详情" });
  await details.click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("heading", { name: "1003COM", exact: true })).toBeVisible();
  await expect(drawer).toContainText("通信框架");
  await drawer.getByRole("tab", { name: "使用范围" }).click();
  await expect(drawer.getByRole("tabpanel")).toContainText("星云 N1");
  await drawer.getByRole("tab", { name: "版本历史" }).click();
  await expect(drawer.getByRole("tabpanel")).toContainText("2.0.3");
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await expect(details).toBeFocused();

  await page.getByTestId("open-batch-1").click();
  const reviewChoice = batch.getByRole("checkbox", { name: "本轮转测 1003COM", exact: true });
  await expect(reviewChoice).toBeChecked();
  await expect(batchVersion.locator("option:checked")).toContainText("2.0.3");
  await expect(batch.getByRole("row").filter({ hasText: "1003COM" })).toContainText("暂缓新版，沿用上轮");
  expect(JSON.parse(await batch.locator('input[name="items"]').inputValue())).toContainEqual(expect.objectContaining({
    packageVersionId: Number(await batchVersion.inputValue()),
    carryPrevious: true,
  }));
  await reviewChoice.uncheck();
  await expect(batchVersion).toBeDisabled();
  await batch.getByLabel("批次号").fill("B970");
  await batch.getByRole("button", { name: "保存草稿并核对" }).click();
  await expectFlash(page, "转测草稿已保存");
  await expect(page.getByRole("row").filter({ hasText: "1003COM" })).toHaveCount(0);
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  const deleteDraft = page.getByRole("dialog", { name: "删除 B970 草稿" });
  await expect(deleteDraft).toHaveAccessibleDescription("草稿将被删除，本批次占用的版本会退回待安排申请。");
  await deleteDraft.getByRole("button", { name: "删除草稿" }).click();
  await expectFlash(page, "草稿已删除");
  await page.goto("/submissions?project=1");
  await expect(oldRequest).toBeVisible();
  await expect(newChoice).toBeChecked();
  await newRequest.getByRole("button", { name: "撤回申请" }).click();
  await page.getByRole("dialog", { name: /撤回 1003COM 2.9.70/ }).getByRole("button", { name: "确认撤回" }).click();
  await expectFlash(page, "转测申请已撤回");
  await expect(newRequest).toHaveCount(0);

  await login(page, "TEST001");
  await page.goto("/submissions?project=1");
  await expect(oldRequest).toBeVisible();
  await expect(pending.getByRole("checkbox")).toHaveCount(0);
  await expect(details).toBeVisible();
});
