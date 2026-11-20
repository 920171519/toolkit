import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";

test("软件包配置正确显示旧编码及名称，保留旧编码并校验修改", async ({ page }) => {
  await login(page, "OWNER001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/packages");
  await page.getByRole("searchbox", { name: "搜索软件包" }).fill("１００１ｏｔａ");
  await page.getByLabel("每页条数").selectOption("10");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  const list = page.getByRole("region", { name: "软件包列表", exact: true });
  await expect(list.getByRole("columnheader", { name: "软件包编码", exact: true })).toBeVisible();
  await expect(list.getByRole("rowheader", { name: "1001OTA", exact: true })).toBeVisible();
  await expect(list.getByRole("cell", { name: "OTA", exact: true })).toBeVisible();
  await expect(list.getByRole("rowheader", { name: "1002CFG", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await list.getByRole("link", { name: "1001OTA", exact: true }).click();
  const form = page.getByTestId("package-meta-form");
  const code = form.getByRole("textbox", { name: "软件包编码" });
  await expect(code).toHaveValue("1001OTA");
  await expect(form.getByRole("textbox", { name: "软件包名称" })).toHaveValue("OTA");
  await code.fill("1234BAD");
  await form.getByRole("button", { name: "保存责任信息" }).click();
  await expect(form.getByRole("alert")).toContainText("需要 5 位数字加 3 位字母");

  await code.fill("1001OTA");
  await form.getByRole("button", { name: "保存责任信息" }).click();
  await expectFlash(page, "软件包信息已更新");
  await expect(form.getByRole("textbox", { name: "软件包编码" })).toHaveValue("1001OTA");
  await page.goto("/packages?project=1");
  await expect(page.getByText("1001OTA", { exact: true }).first()).toBeVisible();
});
