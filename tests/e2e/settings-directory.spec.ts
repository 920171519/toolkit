import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";

test("责任田目录支持搜索、筛选、排序及返回原列表", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/areas");
  const table = page.getByRole("table", { name: "责任田列表" });
  const count = table.getByRole("columnheader", { name: "软件包", exact: true });
  await count.getByRole("link").click();
  await expect(count).toHaveAttribute("aria-sort", "ascending");
  await count.getByRole("link").click();
  await expect(count).toHaveAttribute("aria-sort", "descending");
  const values = await table.locator("tbody td:last-child").allTextContents();
  const counts = values.map(Number);
  expect(counts).toEqual(counts.toSorted((left, right) => right - left));

  const headerFilters = table.locator("thead").getByRole("search");
  await headerFilters.getByLabel("责任田类型").selectOption("integration");
  await page.getByRole("searchbox", { name: "搜索" }).fill("ｔｅｓｔ００１");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.getByRole("link", { name: "集成测试", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/areas\/\d+/);
  await expect(page.getByRole("heading", { name: "项目负责人和成员" })).toBeVisible();
  await page.getByRole("link", { name: "返回责任田列表" }).click();
  await expect(page.getByLabel("责任田类型")).toHaveValue("integration");
  await expect(page.getByRole("searchbox", { name: "搜索" })).toHaveValue("ｔｅｓｔ００１");
  await expect(count).toHaveAttribute("aria-sort", "descending");
  await headerFilters.getByRole("searchbox", { name: "搜索" }).fill("没有匹配的名字999");
  await headerFilters.getByRole("button", { name: "筛选" }).click();
  await expect(table.getByRole("heading", { name: "没有匹配的责任田" })).toBeVisible();
  await headerFilters.getByRole("link", { name: "清除筛选" }).click();
  await expect(table.getByRole("link", { name: "系统底座", exact: true })).toBeVisible();
});

test("人员目录按责任田分工筛选，分页并从详情保留筛选条件", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/users?pageSize=10");
  const table = page.getByRole("table", { name: "人员列表" });
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("link", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.locator("tbody tr")).not.toHaveCount(0);

  await page.getByRole("combobox", { name: "责任田", exact: true }).selectOption({ label: "系统底座" });
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(table.getByRole("link", { name: "王磊" })).toBeVisible();
  await expect(table.getByRole("link", { name: "韩松" })).toBeVisible();
  await expect(table.getByRole("link", { name: "张启明" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "系统角色", exact: true }).selectOption("TEST_VALIDATOR");
  await page.getByRole("searchbox", { name: "搜索" }).fill("valid001");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.getByRole("link", { name: "韩松" }).click();
  await expect(page.getByRole("heading", { name: "韩松", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "系统底座" })).toBeVisible();
  await page.getByRole("button", { name: "保存资料" }).click();
  await expectFlash(page, "人员资料已更新");
  await expect(page).toHaveURL(/\/settings\/users\/\d+/);
  await page.getByRole("link", { name: "返回人员列表" }).click();
  await expect(page.getByRole("searchbox", { name: "搜索" })).toHaveValue("valid001");
  await expect(page.getByRole("combobox", { name: "系统角色", exact: true })).toHaveValue("TEST_VALIDATOR");
  await expect(page.getByRole("combobox", { name: "责任田", exact: true }).locator("option:checked")).toHaveText("系统底座");
  await expect(table.locator("tbody tr")).toHaveCount(1);

  await login(page, "MEMBER001");
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/settings/users/1");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("手机上可以打开责任田和添加成员弹窗并取消", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/areas");
  const table = page.getByRole("table", { name: "责任田列表" });
  await expect(table.getByRole("link", { name: "系统底座" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await table.getByRole("link", { name: "系统底座" }).click();
  const row = page.locator('[data-testid^="area-project-"]').filter({ hasText: "星云 N1" });
  const trigger = row.getByRole("button", { name: "添加成员", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /星云 N1 · 添加成员/ });
  const search = dialog.getByRole("searchbox", { name: "搜索项目成员" });
  await expect(search).toBeFocused();
  await search.fill("owner002");
  await expect(dialog.getByRole("radio", { name: /陈曦/ })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /韩松/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
