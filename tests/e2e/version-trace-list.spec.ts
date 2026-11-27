import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

async function openFilter(page: Page, label: string) {
  const name = `筛选${label}`;
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("版本表头可以排序和组合筛选，多个证据标签切换时保留列表条件", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/versions?q=1001OTA");
  const table = page.getByRole("region", { name: "版本记录表格" });
  const body = table.locator("tbody");
  const statusFilter = await openFilter(page, "版本状态");
  await statusFilter.getByRole("checkbox", { name: "待发试制", exact: true }).check();
  await statusFilter.getByRole("checkbox", { name: "正式版本", exact: true }).check();
  await statusFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("f_status") === "PENDING_TRIAL,FORMAL");
  await expect(body).toContainText("1.5.2");
  await expect(body).toContainText("1.6.0");

  const packageFilter = await openFilter(page, "软件包");
  await packageFilter.getByRole("textbox", { name: "软件包名称或编码" }).fill("OTA");
  await packageFilter.getByRole("combobox", { name: "软件包名称或编码匹配方式" }).selectOption("exact");
  await packageFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("f_package_mode") === "exact");

  const versionFilter = await openFilter(page, "版本");
  await versionFilter.getByRole("textbox", { name: "版本号" }).fill("1.6");
  await versionFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("f_version") === "1.6");

  const dateFilter = await openFilter(page, "提交时间");
  await dateFilter.getByLabel("提交时间起始日期").fill("2026-11-05");
  await dateFilter.getByLabel("提交时间截止日期").fill("2026-11-12");
  await dateFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(body.getByRole("row")).toHaveCount(2);
  await expect(page).toHaveURL((url) => url.searchParams.get("f_submitted_max") === "2026-11-12");
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.1", "1.6.0"]);
  await page.getByRole("combobox", { name: "每页条数" }).selectOption("10");
  await expect(page).toHaveURL((url) => url.searchParams.get("pageSize") === "10");

  await table.getByRole("link", { name: "按版本升序", exact: true }).click();
  await expect(table.locator('th[aria-sort="ascending"]')).toContainText("版本");
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.0", "1.6.1"]);

  const tabs = page.getByRole("navigation", { name: "版本全链路标签页" });
  await body.getByRole("row").filter({ hasText: "1.6.0" }).getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(tabs.getByRole("link", { name: "1001OTA 1.6.0", exact: true })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "返回版本列表", exact: true }).click();
  await expect(page.getByRole("link", { name: "清除搜索条件 1001OTA", exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("f_status") === "PENDING_TRIAL,FORMAL");
  const restoredDate = await openFilter(page, "提交时间");
  await expect(restoredDate.getByLabel("提交时间起始日期")).toHaveValue("2026-11-05");
  await expect(restoredDate.getByLabel("提交时间截止日期")).toHaveValue("2026-11-12");
  await page.keyboard.press("Escape");
  await expect(restoredDate).toBeHidden();
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
  const firstPageRows = await body.getByRole("row").allTextContents();
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  await expect(pagination).toContainText("第 2 页 / 共 2 页");
  const secondPageRows = await body.getByRole("row").allTextContents();
  expect(secondPageRows.length).toBeGreaterThan(0);
  expect(secondPageRows.length).toBeLessThanOrEqual(10);

  await page.goto("/versions?pageSize=10&sort=package&page=2e0");
  await expect(body.getByRole("row")).toHaveText(firstPageRows);
  await page.goto("/versions?pageSize=10&sort=package&page=999");
  await expect(pagination).toContainText("第 2 页 / 共 2 页");
  await expect(body.getByRole("row")).toHaveText(secondPageRows);

  await body.getByRole("link", { name: "全链路追溯", exact: true }).first().click();
  await page.getByRole("link", { name: "返回版本列表", exact: true }).click();
  await expect(pagination).toContainText("第 2 页 / 共 2 页");
  await expect(body.getByRole("row")).toHaveText(secondPageRows);

  const pageSize = page.getByRole("combobox", { name: "每页条数" });
  await pageSize.selectOption("25");
  await expect(body.getByRole("row")).toHaveText([...firstPageRows, ...secondPageRows]);
  await expect(page.getByRole("link", { name: "上一页", exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/(?:\?|&)page=2(?:&|$)/);
  await expect(page).toHaveURL(/(?:\?|&)sort=package(?:&|$)/);
  await pageSize.selectOption("10");
  await expect(body.getByRole("row")).toHaveCount(10);
  await expect(page).toHaveURL(/(?:\?|&)pageSize=10(?:&|$)/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/versions?project=2&tabs=2,1");
  const tabs = page.getByRole("navigation", { name: "版本全链路标签页" });
  await expect(tabs.getByRole("link", { name: "1001OTA 1.5.2", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "1002CFG 2.2.0", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto("/versions/2?project=2");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});

test("旧链接恢复列筛选，空结果仍可清除单列并保留项目和标签", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/versions?project=1&tabs=2&package=1&pkg=1001OTA&ver=1.6&status=PENDING_TRIAL&from=2026-11-05&to=2026-11-12");
  const table = page.getByRole("region", { name: "版本记录表格" });
  const body = table.locator("tbody");
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.1", "1.6.0"]);

  const versionFilter = await openFilter(page, "版本");
  const version = versionFilter.getByRole("textbox", { name: "版本号", exact: true });
  await expect(version).toHaveValue("1.6");
  await version.fill("1");
  await version.fill("1.6.999");
  await expect(body.getByRole("row")).toHaveCount(2);
  await versionFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByText("没有匹配的版本", { exact: true })).toBeVisible();
  await expect(table.getByRole("button", { name: "筛选版本", exact: true })).toBeFocused();
  await expect(page).toHaveURL((url) => url.searchParams.get("f_version") === "1.6.999");

  await (await openFilter(page, "版本")).getByRole("link", { name: "清除本列" }).click();
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.1", "1.6.0"]);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
    project: "1", tabs: "2", package: "1", f_package: "1001OTA", f_status: "PENDING_TRIAL",
  });
  await page.getByRole("link", { name: "清除全部筛选", exact: true }).click();
  await expect(page).toHaveURL((url) => ![...url.searchParams.keys()].some((key) => key.startsWith("f_")));
  await expect(page.getByRole("link", { name: "全部软件包", exact: true })).toBeVisible();
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({ project: "1", tabs: "2", package: "1" });
  await page.getByRole("link", { name: "全部软件包", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("project") === "1" && !url.searchParams.has("package"));
});
