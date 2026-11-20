import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("版本表头可以排序和组合筛选，多个证据标签切换时保留列表条件", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/versions");

  await page.getByRole("textbox", { name: "软件包或版本" }).fill("1001OTA");
  await page.getByRole("textbox", { name: "筛选软件包" }).fill("OTA");
  await page.getByRole("textbox", { name: "筛选版本号" }).fill("1.6");
  await page.getByRole("combobox", { name: "筛选版本状态" }).selectOption("PENDING_TRIAL");
  await page.getByLabel("提交起始日期").fill("2026-11-05");
  await page.getByLabel("提交截止日期").fill("2026-11-12");
  await page.getByRole("combobox", { name: "每页条数" }).selectOption("10");
  await page.getByRole("button", { name: "搜索", exact: true }).click();

  const table = page.getByRole("region", { name: "版本记录表格" });
  const body = table.locator("tbody");
  await expect(body.getByRole("row")).toHaveCount(2);
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.1", "1.6.0"]);

  await table.getByRole("link", { name: "按版本升序", exact: true }).click();
  await expect(table.locator('th[aria-sort="ascending"]')).toContainText("版本");
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.0", "1.6.1"]);

  const tabs = page.getByRole("navigation", { name: "版本全链路标签页" });
  await body.getByRole("row").filter({ hasText: "1.6.0" }).getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(tabs.getByRole("link", { name: "1001OTA 1.6.0", exact: true })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "返回版本列表", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "软件包或版本" })).toHaveValue("1001OTA");
  await expect(page.getByRole("combobox", { name: "筛选版本状态" })).toHaveValue("PENDING_TRIAL");
  await expect(page.getByLabel("提交截止日期")).toHaveValue("2026-11-12");
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.0", "1.6.1"]);

  await body.getByRole("row").filter({ hasText: "1.6.1" }).getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(tabs.getByRole("link", { name: "1001OTA 1.6.1", exact: true })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "1001OTA 1.6.0", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "1001OTA 1.6.0" })).toBeVisible();
  await tabs.getByRole("link", { name: "关闭 1001OTA 1.6.1 标签页", exact: true }).click();
  await expect(tabs.getByRole("link", { name: "1001OTA 1.6.1", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "1001OTA 1.6.0", exact: true })).toHaveAttribute("aria-current", "page");
});

test("分页状态随证据标签保留，无关项目的版本不显示为标签", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/versions?pageSize=10&sort=package");
  const body = page.getByRole("region", { name: "版本记录表格" }).locator("tbody");
  const pagination = page.getByRole("navigation", { name: "版本列表分页" });
  await expect(body.getByRole("row")).toHaveCount(10);
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  await expect(pagination).toContainText("第 2 / 2 页");
  const secondPageRows = await body.getByRole("row").allTextContents();
  expect(secondPageRows).toHaveLength(7);
  await body.getByRole("link", { name: "全链路追溯", exact: true }).first().click();
  await page.getByRole("link", { name: "返回版本列表", exact: true }).click();
  await expect(pagination).toContainText("第 2 / 2 页");
  await expect(body.getByRole("row")).toHaveText(secondPageRows);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/versions?project=2&tabs=2,1");
  const tabs = page.getByRole("navigation", { name: "版本全链路标签页" });
  await expect(tabs.getByRole("link", { name: "1001OTA 1.5.2", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "1002CFG 2.2.0", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto("/versions/2?project=2");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});
