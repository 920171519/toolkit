import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectFlash, login } from "./helpers";

async function openFilter(page: Page, table: Locator, column: string) {
  const name = `筛选${column}`;
  await table.getByRole("button", { name, exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
}

test("项目待转测表格保留暂缓版本，并按勾选结果生成批次快照", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page, "OWNER002");
  await page.goto("/submissions?project=1");
  await page.getByTestId("submit-transfer-trigger").click();
  const transfer = page.getByTestId("transfer-form");
  await transfer.getByLabel("搜索软件包").fill("1003COM");
  await transfer.getByTestId(/transfer-package-/).filter({ hasText: "1003COM" }).click();
  await transfer.locator('input[name="version"]').fill("2.9.70");
  await transfer.locator('textarea[name="changeSummary"]').fill("自动化验证同一软件包的两个待测版本。");
  await transfer.locator('input[name="archiveUrl"]').fill("https://packages.example.com/issue7/com-2.9.70.tar.gz");
  await transfer.locator('input[name="buildUrl"]').fill("https://ci.example.com/issue7/com-2.9.70");
  await transfer.getByRole("button", { name: "提交申请" }).click();
  await expectFlash(page, "转测申请已提交");

  await login(page, "MGR001");
  await page.goto("/submissions?project=1");

  const pending = page.getByRole("region", { name: "星云 N1待转测申请表格" });
  await expect(pending.getByRole("columnheader")).toHaveCount(7);
  for (const column of ["本轮转测", "软件包编码", "版本", "提交人", "提交时间", "固定地址"]) {
    await expect(pending.getByRole("button", { name: `筛选${column}`, exact: true })).toBeVisible();
  }
  await expect(pending.getByRole("columnheader", { name: "操作", exact: true })).toBeVisible();
  const request = pending.getByRole("row").filter({ hasText: "1003COM" }).filter({ hasText: "2.1.0" });
  const newRequest = pending.getByRole("row").filter({ hasText: "1003COM" }).filter({ hasText: "2.9.70" });
  await expect(request.getByRole("cell").nth(1).locator("strong")).toHaveText("1003COM");
  await expect(request.getByRole("cell").nth(3)).toHaveText("陈曦");
  await expect(request.locator("time")).toHaveAttribute("datetime", /2026-11-12/);
  await expect(request.getByRole("link").first()).toHaveAttribute("href", /^https?:\/\//);

  const include = request.getByRole("checkbox", { name: "本轮转测 1003COM 2.1.0" });
  const includeNew = newRequest.getByRole("checkbox", { name: "本轮转测 1003COM 2.9.70" });
  await expect(includeNew).toBeChecked();
  await expect(include).not.toBeChecked();
  await include.check();
  await expect(include).toBeChecked();
  await expect(includeNew).not.toBeChecked();

  await page.getByTestId("open-batch-1").click();
  const batch = page.getByTestId("batch-builder-form");
  const batchVersion = batch.getByRole("combobox", { name: "1003COM 本次转测版本" });
  await expect(batchVersion.locator("option:checked")).toContainText("2.1.0");
  const initialPayload = await batch.locator("input[name=items]").inputValue();
  await page.getByRole("button", { name: "关闭弹窗" }).click();

  const versionFilter = await openFilter(page, pending, "版本");
  await versionFilter.getByRole("textbox", { name: "版本号", exact: true }).fill("2.9.70");
  await versionFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(request).toHaveCount(0);
  await expect(includeNew).not.toBeChecked();
  await page.getByTestId("open-batch-1").click();
  const reviewRow = batch.getByRole("table", { name: "完整配套清单" }).getByRole("row").filter({ hasText: "1003COM" });
  await expect(reviewRow.getByText("在申请列表中已筛选隐藏")).toBeVisible();
  await expect(batchVersion.locator("option:checked")).toContainText("2.1.0");
  await expect(batch.locator("input[name=items]")).toHaveValue(initialPayload);
  await batchVersion.selectOption({ label: "2.9.70 · 本次待转测" });
  await expect(reviewRow.getByText("在申请列表中已筛选隐藏")).toBeHidden();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("button", { name: "清除全部筛选", exact: true }).click();
  await expect(include).toBeChecked();
  await expect(includeNew).not.toBeChecked();

  await include.uncheck();
  const details = request.getByRole("link", { name: "查看 1003COM 详情" });
  await details.click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("heading", { name: "1003COM" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "使用范围" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "版本历史" })).toBeVisible();
  await expect(drawer).toContainText("2.0.3");
  await expect(drawer).toContainText("通信框架");
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await expect(details).toBeFocused();
  await expect(include).not.toBeChecked();

  await page.getByTestId("open-batch-1").click();
  await expect(batch.getByRole("checkbox", { name: "本轮转测 1003COM", exact: true })).not.toBeChecked();
  await expect(batchVersion).toBeDisabled();
  await expect(batchVersion.locator("option:checked")).toContainText("2.0.3");
  await expect(page.getByRole("dialog", { name: "星云 N1 · 发起整套转测" })).toBeVisible();
  await batch.getByLabel("批次号").fill("B970");
  await batch.getByRole("button", { name: "创建整套配套批次" }).click();
  await expectFlash(page, "整套配套转测草稿已创建");
  await expect(request).toBeVisible();
  await expect(newRequest).toBeVisible();
  const draft = page.getByRole("row").filter({ hasText: "B970" });
  await expect(draft).toBeVisible();
  const buttonTops = await draft.locator("a, button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(buttonTops).toHaveLength(3);
  expect(Math.max(...buttonTops) - Math.min(...buttonTops)).toBeLessThan(1);
  await draft.getByRole("link", { name: "查看 B970 配套" }).click();
  const carried = page.getByRole("row").filter({ hasText: "1003COM" });
  await expect(carried.getByRole("cell").nth(4)).toContainText("2.0.3");
  await expect(carried.getByText("无变化")).toBeVisible();
  await expect(carried.getByText("本次变更包")).toHaveCount(0);
  await page.goBack();
  await draft.getByRole("button", { name: "删除", exact: true }).click();
  await expect(draft).toHaveCount(0);
  await expect(request).toBeVisible();
  await newRequest.getByRole("button", { name: "撤回申请" }).click();
  await expectFlash(page, "转测申请已撤回");
  await expect(newRequest).toHaveCount(0);

  await login(page, "TEST001");
  await page.goto("/submissions?project=1");
  await expect(request).toBeVisible();
  await expect(pending.getByRole("checkbox")).toHaveCount(0);
  await expect(details).toBeVisible();
});

test("待转测表格无匹配项时仍保留已勾选版本，提交快照与完整清单一致", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page, "MGR001");
  await page.goto("/submissions?project=1");
  const group = page.getByRole("region", { name: "星云 N1待转测申请", exact: true });
  const pending = group.getByRole("region", { name: "星云 N1待转测申请表格", exact: true });
  const include = pending.getByRole("checkbox", { name: "本轮转测 1003COM 2.1.0", exact: true });
  await include.check();
  const selectedCount = await pending.locator("tbody input[type=checkbox]:checked").count();

  const dates = await openFilter(page, pending, "提交时间");
  await dates.getByLabel("提交时间起始日期", { exact: true }).fill("2026-11-12");
  await dates.getByLabel("提交时间截止日期", { exact: true }).fill("2026-11-12");
  await dates.getByRole("button", { name: "应用", exact: true }).click();
  await expect(include).toBeChecked();

  const archive = await openFilter(page, pending, "固定地址");
  await archive.getByRole("textbox", { name: "固定地址", exact: true }).fill("not-a-real-archive-address");
  await archive.getByRole("button", { name: "应用", exact: true }).click();
  await expect(group.getByText("没有匹配的待转测申请", { exact: true })).toBeVisible();
  await expect(pending.locator("tbody tr")).toHaveCount(0);
  await expect(group.getByRole("status")).toContainText(`其中 ${selectedCount} 个已勾选版本被筛选隐藏，仍计入本轮。`);
  await expect(pending.getByRole("button", { name: "筛选固定地址", exact: true })).toBeVisible();

  await group.getByTestId("open-batch-1").click();
  const batch = page.getByTestId("batch-builder-form");
  const review = batch.getByRole("table", { name: "完整配套清单" });
  const com = review.getByRole("row").filter({ hasText: "1003COM" });
  await expect(com.getByRole("checkbox", { name: "本轮转测 1003COM", exact: true })).toBeChecked();
  await expect(com.getByRole("combobox").locator("option:checked")).toContainText("2.1.0");
  await expect(review.getByText("在申请列表中已筛选隐藏")).toHaveCount(selectedCount);
  await batch.getByLabel("批次号").fill("B971");
  await batch.getByRole("button", { name: "创建整套配套批次" }).click();
  await expectFlash(page, "整套配套转测草稿已创建");
  const draft = page.getByRole("row").filter({ hasText: "B971" });
  await draft.getByRole("link", { name: "查看 B971 配套" }).click();
  const snapshot = page.getByRole("row").filter({ hasText: "1003COM" });
  await expect(snapshot.getByRole("cell").nth(4)).toContainText("2.1.0");
  await expect(snapshot.getByText("本次变更包")).toBeVisible();
  await page.goBack();
  await draft.getByRole("button", { name: "删除", exact: true }).click();
  await expect(draft).toHaveCount(0);
});
