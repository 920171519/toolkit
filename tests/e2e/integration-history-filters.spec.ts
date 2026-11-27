import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

async function openFilter(page: Page, label: string) {
  const name = "筛选" + label;
  await page.getByRole("button", { name, exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
}

test("历史批次先按项目和列筛选，再分页，较早的详情返回后仍保留页码", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = openE2eDatabase();
  const prefix = "E2E-HISTORY-";
  const target = prefix + "TARGET-";
  const activePrefix = prefix + "ACTIVE-";
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN");
    try {
      db.prepare(
        `WITH RECURSIVE numbers(n) AS (
           SELECT 1
           UNION ALL SELECT n + 1 FROM numbers WHERE n < 505
         )
         INSERT INTO integration_batches (code, project_id, title, status, created_at, conclusion)
         SELECT ? || printf('%03d', n), 1, '新历史批次', 'COMPLETED', '2026-12-01T00:00:00.000Z', 'PASS'
         FROM numbers`,
      ).run(prefix + "RECENT-");
      db.prepare(
        `WITH RECURSIVE numbers(n) AS (
           SELECT 1
           UNION ALL SELECT n + 1 FROM numbers WHERE n < 11
         )
         INSERT INTO integration_batches (code, project_id, title, status, created_at)
         SELECT ? || n, 1, '分页在测批次', 'IN_TEST', '2020-01-01T00:00:00.000Z'
         FROM numbers`,
      ).run(activePrefix);
      const insert = db.prepare(
        `INSERT INTO integration_batches (code, project_id, title, status, created_at, terminated_at)
         VALUES (?, ?, '旧历史批次', 'TERMINATED', '2020-01-01T15:50:00.000Z', ?)`,
      );
      for (let n = 1; n <= 11; n++) insert.run(target + n, 1, "2020-01-01T16:05:00.000Z");
      insert.run(target + "PREVIOUS-DAY", 1, "2020-01-01T15:59:00.000Z");
      const otherProject = insert.run(target + "OTHER-PROJECT", 2, "2020-01-01T16:05:00.000Z");
      db.exec("COMMIT");

      await page.goto(`/integration?project=1&pageSize=10&q=${activePrefix}`);
      const activePages = page.getByRole("navigation", { name: "批次列表分页" });
      const activeRows = page.getByRole("region", { name: "在测批次列表", exact: true }).locator("tbody tr");
      const activeFilters = (url: URL) => url.searchParams.get("project") === "1" &&
        url.searchParams.get("pageSize") === "10" && url.searchParams.get("q") === activePrefix;
      await expect(activeRows).toHaveCount(10);
      await expect(activePages.getByRole("link", { name: "上一页", exact: true })).toHaveCount(0);
      await activePages.getByRole("link", { name: "下一页", exact: true }).click();
      await expect(page).toHaveURL((url) => activeFilters(url) && url.searchParams.get("page") === "2");
      await expect(activeRows).toHaveCount(1);
      await expect(activePages.getByRole("link", { name: "下一页", exact: true })).toHaveCount(0);
      await activePages.getByRole("link", { name: "上一页", exact: true }).click();
      await expect(page).toHaveURL((url) => activeFilters(url) && !url.searchParams.has("page"));
      await expect(activeRows).toHaveCount(10);

      await page.goto("/integration?project=1&pageSize=10");
      const active = page.getByText("B120", { exact: true });
      await expect(active).toBeVisible();
      const history = page.locator("#integration-history");
      await page.getByRole("navigation", { name: "集成测试队列" }).getByRole("link", { name: /历史批次/ }).click();
      const table = page.getByRole("region", { name: "历史批次表格" });
      const rows = table.locator("tbody tr");
      await expect(rows).toHaveCount(10);
      await expect(rows.first()).toContainText(prefix + "RECENT-");

      const batchFilter = await openFilter(page, "批次");
      await batchFilter.getByRole("textbox", { name: "批次号", exact: true }).fill(target);
      await batchFilter.getByRole("button", { name: "应用", exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("f_batch") === target);
      await expect(history.getByRole("status")).toContainText("共 12 个批次");

      const dateFilter = await openFilter(page, "时间");
      await dateFilter.getByLabel("时间起始日期").fill("2020-01-02");
      await dateFilter.getByLabel("时间截止日期").fill("2020-01-02");
      await dateFilter.getByRole("button", { name: "应用", exact: true }).click();
      await expect(history.getByRole("status")).toContainText("共 11 个批次");
      await expect(rows).toHaveCount(10);
      await expect(active).toHaveCount(0);
      await expect(table.getByText(target + "OTHER-PROJECT", { exact: true })).toHaveCount(0);

      await history.getByRole("link", { name: "下一页", exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("page") === "2");
      await expect(rows).toHaveCount(1);

      const filteredHistoryUrl = new URL(page.url());
      filteredHistoryUrl.searchParams.set("page", "1.5");
      await page.goto(filteredHistoryUrl.toString());
      await expect(rows).toHaveCount(10);
      filteredHistoryUrl.searchParams.set("page", "999");
      await page.goto(filteredHistoryUrl.toString());
      await expect(rows).toHaveCount(1);
      await expect(history.getByRole("link", { name: "下一页", exact: true })).toHaveCount(0);
      await history.getByRole("link", { name: "上一页", exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("page") === "1" && url.searchParams.get("f_batch") === target);
      await history.getByRole("link", { name: "下一页", exact: true }).click();
      await expect(rows).toHaveCount(1);

      await table.getByRole("link", { name: target + "1", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: target + "1 · 旧历史批次" })).toBeVisible();
      await page.getByRole("link", { name: "返回历史批次", exact: true }).click();
      await expect(page).toHaveURL((url) =>
        url.searchParams.get("project") === "1" &&
        url.searchParams.get("page") === "2" &&
        url.searchParams.get("f_batch") === target &&
        url.searchParams.get("f_date_min") === "2020-01-02" &&
        url.searchParams.get("f_date_max") === "2020-01-02");
      await expect(rows).toHaveCount(1);

      await login(page, "MGR001");
      await page.goto("/integration?history=1&f_project=2");
      await expect(page.getByText("没有匹配的历史批次", { exact: true })).toBeVisible();
      await page.goto("/integration/" + otherProject.lastInsertRowid);
      await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    try {
      db.prepare("DELETE FROM integration_batches WHERE code LIKE ?").run(prefix + "%");
    } finally {
      db.close();
    }
  }
});
