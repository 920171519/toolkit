import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("发布队列支持搜索、列筛选、排序和分页", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial");

  const release = page.getByRole("region", { name: "待发布试制", exact: true });
  const rows = release.locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await release.getByRole("link", { name: "下一页" }).click();
  await expect(release.getByText("第 2 / 2 页，显示 11–18 条")).toBeVisible();
  await expect(rows).toHaveCount(8);
  await release.getByRole("link", { name: "上一页" }).click();
  await expect(rows).toHaveCount(10);
  await release.getByLabel("每页条数").selectOption("25");
  await release.getByRole("button", { name: "应用筛选" }).click();
  await expect(rows).toHaveCount(18);

  const packageSort = release.getByRole("link", { name: "按软件包排序" });
  await packageSort.click();
  await expect(release.locator('th[aria-sort="ascending"]')).toContainText("软件包");
  await expect(rows.first().getByRole("cell").first()).toHaveText("1001OTA");
  await packageSort.click();
  await expect(release.locator('th[aria-sort="descending"]')).toContainText("软件包");
  await expect(rows.first().getByRole("cell").first()).toHaveText("1008MED");

  await release.getByRole("searchbox", { name: "筛选转测批次" }).fill("b119");
  await release.getByRole("button", { name: "应用筛选" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.getByRole("link", { name: "B119" })).toHaveAttribute("href", /^\/integration\/\d+$/);
  await expect(rows.getByRole("cell", { name: "王磊", exact: true })).toBeVisible();

  await release.getByRole("searchbox", { name: "搜索待发布试制" }).fill("1006KEY");
  await release.getByRole("button", { name: "应用筛选" }).click();
  await expect(release.getByText("没有匹配的版本")).toBeVisible();
  await release.getByRole("link", { name: "清除筛选" }).click();
  await expect(rows).toHaveCount(18);
});

test("两个队列各自保留当前条件，绑定详情返回后还原", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial?project=1");

  const release = page.getByRole("region", { name: "待发布试制", exact: true });
  const binding = page.getByRole("region", { name: "试制版本绑定验证", exact: true });
  await release.getByRole("searchbox", { name: "搜索待发布试制" }).fill("1001ota 1.6.0");
  await release.getByRole("button", { name: "应用筛选" }).click();
  await expect(release.locator("tbody tr")).toHaveCount(1);

  await binding.getByRole("searchbox", { name: "筛选提交人" }).fill("赵敏");
  await binding.getByRole("button", { name: "应用筛选" }).click();
  const bindingRows = binding.locator("tbody tr");
  await expect(bindingRows).toHaveCount(1);
  await expect(bindingRows.getByRole("cell", { name: "赵敏", exact: true })).toBeVisible();
  await expect(bindingRows.getByRole("cell", { name: "未关联转测批次", exact: true })).toBeVisible();
  await bindingRows.getByRole("link", { name: "处理" }).click();
  await page.getByRole("link", { name: "返回试制队列" }).click();

  await expect(binding.getByRole("searchbox", { name: "筛选提交人" })).toHaveValue("赵敏");
  await expect(release.getByRole("searchbox", { name: "搜索待发布试制" })).toHaveValue("1001ota 1.6.0");
  await expect(release.locator("tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(/\/trial\?project=1/);
});
