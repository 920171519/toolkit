import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("发布队列即时搜索、列筛选和切换每页条数，详情展示验收结论", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial");

  const release = page.getByRole("region", { name: "待发布试制", exact: true });
  const rows = release.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(release.getByRole("button", { name: "应用筛选" })).toHaveCount(0);

  const pagination = release.getByRole("navigation", { name: "待发布试制分页" });
  await pagination.getByLabel("每页条数").selectOption("25");
  await expect(page).toHaveURL(/release_size=25/);
  await expect(pagination.getByLabel("每页条数")).toHaveValue("25");

  const batchSort = release.getByRole("link", { name: "按转测批次排序" });
  await batchSort.click();
  await expect(release.locator('th[aria-sort="ascending"]')).toContainText("转测批次");
  await expect(rows.first().getByRole("link", { name: "B119" })).toBeVisible();
  await batchSort.click();
  await expect(release.locator('th[aria-sort="descending"]')).toContainText("转测批次");
  await expect(rows.first().getByRole("link", { name: "B124" })).toBeVisible();

  const batch = release.getByRole("searchbox", { name: "筛选转测批次" });
  await batch.pressSequentially("b11");
  await expect(rows).toHaveCount(1);
  await expect(batch).toBeFocused();
  await batch.pressSequentially("9");
  await expect(page).toHaveURL(/release_batch=b119/);
  await expect(rows.getByRole("link", { name: "B119" })).toHaveAttribute("href", /^\/integration\/\d+$/);
  await expect(rows.getByRole("cell", { name: "王磊", exact: true })).toBeVisible();
  await expect(rows.getByRole("button")).toHaveText(["发布", "放弃"]);

  await rows.getByRole("link", { name: "详情", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1001OTA 1.6.0" })).toBeVisible();
  const evidence = page.getByRole("region", { name: "验收结论" });
  await expect(evidence.getByText("测试通过", { exact: true })).toBeVisible();
  await expect(evidence.getByRole("link", { name: "验证报告" })).toHaveAttribute("href", /\/B119$/);
  await page.getByRole("link", { name: "返回试制队列" }).click();
  await expect(batch).toHaveValue("b119");
  await expect(pagination.getByLabel("每页条数")).toHaveValue("25");

  await release.getByRole("searchbox", { name: "搜索待发布试制" }).fill("1006KEY");
  await expect(release.getByText("没有匹配的版本")).toBeVisible();
  await release.getByRole("link", { name: "清除筛选" }).click();
  await expect(rows).toHaveCount(4);
  await expect(batch).toHaveValue("");
  await expect(pagination.getByLabel("每页条数")).toHaveValue("25");
});

test("两个队列连续筛选时保留条件及项目范围，绑定详情返回后还原", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial?project=1");

  const release = page.getByRole("region", { name: "待发布试制", exact: true });
  const binding = page.getByRole("region", { name: "试制版本绑定验证", exact: true });
  const releaseSearch = release.getByRole("searchbox", { name: "搜索待发布试制" });
  const bindingSearch = binding.getByRole("searchbox", { name: "筛选提交人" });
  await releaseSearch.fill("1001ota 1.6.0");
  await bindingSearch.fill("赵敏");

  await expect(page).toHaveURL(url =>
    url.searchParams.get("project") === "1" &&
    url.searchParams.get("release_q") === "1001ota 1.6.0" &&
    url.searchParams.get("binding_submitter") === "赵敏",
  );
  await expect(release.locator("tbody tr")).toHaveCount(1);
  const bindingRows = binding.locator("tbody tr");
  await expect(bindingRows).toHaveCount(1);
  await expect(bindingRows.getByRole("cell", { name: "赵敏", exact: true })).toBeVisible();
  await expect(bindingRows.getByRole("cell", { name: "未关联转测批次", exact: true })).toBeVisible();
  await bindingRows.getByRole("link", { name: "处理" }).click();
  await page.getByRole("link", { name: "返回试制队列" }).click();

  await expect(bindingSearch).toHaveValue("赵敏");
  await expect(releaseSearch).toHaveValue("1001ota 1.6.0");
  await expect(release.locator("tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(/\/trial\?project=1/);
});
