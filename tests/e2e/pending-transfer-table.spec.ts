import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";

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
  await expect(pending.getByRole("columnheader")).toHaveText([
    "本轮转测", "软件包编码", "版本", "提交人", "提交时间", "固定地址", "操作",
  ]);
  const request = pending.getByRole("row").filter({ hasText: "1003COM" }).filter({ hasText: "2.1.0" });
  const newRequest = pending.getByRole("row").filter({ hasText: "1003COM" }).filter({ hasText: "2.9.70" });
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
  await page.getByRole("button", { name: "关闭弹窗" }).click();

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
  await batch.getByLabel("批次号").fill("B970");
  await batch.getByRole("button", { name: "创建整套配套批次" }).click();
  await expectFlash(page, "整套配套转测草稿已创建");
  await expect(request).toBeVisible();
  await expect(newRequest).toBeVisible();
  const draft = page.getByRole("row").filter({ hasText: "B970" });
  await draft.getByRole("link", { name: "查看 B970 配套" }).click();
  await expect(page.getByRole("row").filter({ hasText: "1003COM" })).toHaveCount(0);
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
