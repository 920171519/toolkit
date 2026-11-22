import { expect, test, type Page } from "@playwright/test";
import { expectFlash, login } from "./helpers";

async function openFilter(page: Page, label: string) {
  const name = `筛选${label}`;
  await page.getByRole("button", { name, exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
}

test("责任田目录支持搜索、筛选、排序及返回原列表", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/areas");
  const table = page.getByRole("table", { name: "责任田列表" });
  const count = table.getByRole("columnheader", { name: /^软件包/ });
  await count.getByRole("link").click();
  await expect(count).toHaveAttribute("aria-sort", "ascending");
  await count.getByRole("link").click();
  await expect(count).toHaveAttribute("aria-sort", "descending");
  const values = await table.locator("tbody td:last-child").allTextContents();
  const counts = values.map(Number);
  expect(counts).toEqual(counts.toSorted((left, right) => right - left));

  const type = await openFilter(page, "类型");
  await type.getByRole("checkbox", { name: "集成测试责任田", exact: true }).check();
  await type.getByRole("button", { name: "应用", exact: true }).click();
  const leaders = await openFilter(page, "主管");
  await leaders.getByRole("checkbox", { name: /TEST001/ }).check();
  await leaders.getByRole("button", { name: "应用", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.getByRole("link", { name: "集成测试", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/areas\/\d+/);
  await expect(page.getByRole("heading", { name: "项目负责人和成员" })).toBeVisible();
  await page.getByRole("link", { name: "返回责任田列表" }).click();
  await expect(page).toHaveURL(/f_type=integration/);
  await expect(page).toHaveURL(/f_leaders=\d+/);
  await expect(count).toHaveAttribute("aria-sort", "descending");
  const name = await openFilter(page, "责任田");
  await name.getByLabel("责任田名称", { exact: true }).fill("没有匹配的名字999");
  await name.getByRole("button", { name: "应用", exact: true }).click();
  await expect(table.getByRole("heading", { name: "没有匹配的责任田" })).toBeVisible();
  const clearing = await openFilter(page, "责任田");
  await clearing.getByRole("link", { name: "清除本列", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByText("清除全部筛选", { exact: true }).click();
  await expect(table.getByRole("link", { name: "系统底座", exact: true })).toBeVisible();

  await page.goto("/settings/areas?type=integration&q=ｔｅｓｔ００１");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByRole("link", { name: "集成测试", exact: true })).toBeVisible();
});

test("人员目录按责任田分工筛选，分页并从详情保留筛选条件", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/users?pageSize=10");
  const table = page.getByRole("table", { name: "人员列表" });
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("link", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.locator("tbody tr")).not.toHaveCount(0);

  const area = await openFilter(page, "责任田");
  await area.getByRole("checkbox", { name: "系统底座", exact: true }).check();
  await area.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(table.getByRole("link", { name: "王磊" })).toBeVisible();
  await expect(table.getByRole("link", { name: "韩松" })).toBeVisible();
  await expect(table.getByRole("link", { name: "张启明" })).toHaveCount(0);
  const role = await openFilter(page, "系统角色");
  await role.getByRole("checkbox", { name: "绑定验证员", exact: true }).check();
  await role.getByRole("button", { name: "应用", exact: true }).click();
  const employeeId = await openFilter(page, "工号");
  await employeeId.getByLabel("工号", { exact: true }).fill("valid001");
  await employeeId.getByRole("button", { name: "应用", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.getByRole("link", { name: "韩松" }).click();
  await expect(page.getByRole("heading", { name: "韩松", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "系统底座" })).toBeVisible();
  await page.getByRole("button", { name: "保存资料" }).click();
  await expectFlash(page, "人员资料已更新");
  await expect(page).toHaveURL(/\/settings\/users\/\d+/);
  await page.getByRole("link", { name: "返回人员列表" }).click();
  await expect(page).toHaveURL(/f_employeeId=valid001/);
  await expect(page).toHaveURL(/f_role=TEST_VALIDATOR/);
  await expect(page).toHaveURL(/f_area=\d+/);
  await expect(page).toHaveURL(/pageSize=10/);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  const restoredArea = await openFilter(page, "责任田");
  await expect(restoredArea.getByRole("checkbox", { name: "系统底座", exact: true })).toBeChecked();

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
  const type = await openFilter(page, "类型");
  await expect(type.getByRole("checkbox", { name: "集成测试责任田", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(type).toBeHidden();
  await expect(page.getByRole("button", { name: "筛选类型", exact: true })).toBeFocused();
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
