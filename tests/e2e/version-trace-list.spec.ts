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

  const table = page.getByRole("region", { name: "版本记录表格" });
  const body = table.locator("tbody");
  await expect(body.getByRole("row")).toHaveCount(2);
  await expect(page).toHaveURL(/(?:\?|&)to=2026-11-12(?:&|$)/);
  await expect(page.getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
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

  const pageSize = pagination.getByRole("combobox", { name: "每页条数" });
  await pageSize.selectOption("25");
  await expect(pagination).toContainText("第 1 / 1 页");
  await expect(body.getByRole("row")).toHaveCount(17);
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

test("快速切换列筛选时保留最后输入、焦点和项目范围", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/versions?project=1&tabs=2");
  const body = page.getByRole("region", { name: "版本记录表格" }).locator("tbody");
  const packageFilter = page.getByRole("textbox", { name: "筛选软件包" });
  const versionFilter = page.getByRole("textbox", { name: "筛选版本号" });
  let releaseEarlierRequest!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseEarlierRequest = resolve; });
  const matchesEarlier = (url: URL) => url.pathname === "/versions" && url.searchParams.get("pkg") === "10";
  await page.route(matchesEarlier, async (route) => {
    await blocked;
    await route.continue();
  });

  const earlier = page.waitForRequest((request) => matchesEarlier(new URL(request.url())), { timeout: 5_000 });
  try {
    await packageFilter.fill("10");
    await earlier;
    await packageFilter.fill("1001OTA");
    await versionFilter.fill("1.6");
    await expect(page).toHaveURL(/(?:\?|&)ver=1.6(?:&|$)/);
  } finally {
    releaseEarlierRequest();
  }
  const earlierRequest = await earlier;
  const earlierResponse = await earlierRequest.response();
  await earlierResponse?.finished();
  await expect(body.getByRole("link", { name: /^1\.6\./ })).toHaveText(["1.6.2", "1.6.1", "1.6.0"]);
  await expect(body.getByRole("row")).toHaveCount(3);
  await expect(versionFilter).toBeFocused();
  await expect(packageFilter).toHaveValue("1001OTA");
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ project: "1", tabs: "2", pkg: "1001OTA", ver: "1.6" });

  await page.getByRole("link", { name: "清除筛选" }).click();
  await expect(packageFilter).toHaveValue("");
  await expect(versionFilter).toHaveValue("");
  await expect(body.getByRole("row")).not.toHaveCount(3);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ project: "1", tabs: "2" });
});
