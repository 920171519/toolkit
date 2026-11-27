import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("批次对比默认使用前一批次，按方向显示版本变化，并可在窄屏查看全部", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/integration/4?project=1");
  await page.getByRole("link", { name: "对比批次", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "批次对比", exact: true })).toBeVisible();

  const ota = page.getByRole("row", { name: /1001OTA/ });
  await expect(ota.getByRole("cell")).toHaveText(["1.6.0", "1.5.2", "版本变化"]);
  await expect(page.getByRole("row", { name: /1007DIA/ }).getByRole("cell")).toHaveText(["3.0.0", "3.0.1", "版本变化"]);
  const unchanged = page.getByRole("row", { name: /1002CFG/ });
  await expect(unchanged).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "查看全部", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("show") === "all");
  await expect(unchanged.getByRole("cell")).toHaveText(["2.2.0", "2.2.0", "相同"]);
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1);
  await page.getByRole("link", { name: "仅看差异", exact: true }).click();
  await expect(unchanged).toHaveCount(0);
});

test("从历史分页打开后可按标题更换基准，返回时恢复列表条件", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
  const fixturePrefix = "E2E-COMPARE-HISTORY-";
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `WITH RECURSIVE numbers(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 10
       )
       INSERT INTO integration_batches (code, project_id, title, status, created_at, completed_at)
       SELECT ? || n, 1, '临时 OTA 历史记录', 'COMPLETED', '2026-11-20T00:00:00.000Z', '2026-11-20T01:00:00.000Z'
       FROM numbers`,
    ).run(fixturePrefix);

    await page.goto("/integration?project=1&view=history&page=2&pageSize=10&f_title=OTA");
    await page.getByRole("link", { name: "B123", exact: true }).click();
    await page.getByRole("link", { name: "对比批次", exact: true }).click();
    const ota = page.getByRole("row", { name: /1001OTA/ });
    await expect(ota.getByRole("cell")).toHaveText(["1.5.2", "1.6.2", "版本变化"]);
    await page.getByText("更换基准批次", { exact: true }).click();
    await page.getByLabel("批次号或标题", { exact: true }).fill("星云 N1 配套回归");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("link", { name: /B119/ }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("base") === "2");
    await expect(ota.getByRole("cell")).toHaveText(["1.6.0", "1.6.2", "版本变化"]);

    await page.getByRole("link", { name: "返回批次详情", exact: true }).click();
    await page.getByRole("link", { name: "返回历史批次", exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname === "/integration" && url.searchParams.get("project") === "1" &&
      url.searchParams.get("page") === "2" && url.searchParams.get("pageSize") === "10" &&
      url.searchParams.get("f_title") === "OTA");
    await expect(page.getByRole("link", { name: "B123", exact: true })).toBeVisible();
  } finally {
    try {
      db.prepare("DELETE FROM integration_batches WHERE code LIKE ?").run(fixturePrefix + "%");
    } finally {
      db.close();
    }
  }
});

test("草稿与历史快照可核对新增和移出，缺失快照与不允许的基准各自处理", async ({ page }) => {
  await login(page, "MGR001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
  const fixturePrefix = "E2E-COMPARE-SNAPSHOT-";
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
    const insertBatch = db.prepare(
      `INSERT INTO integration_batches (code, project_id, title, status, created_at, sent_at)
       VALUES (?, 1, ?, ?, '2026-11-20T00:00:00.000Z', ?)`,
    );
    const terminated = Number(insertBatch.run(
      fixturePrefix + "TERMINATED", "已终止配套", "TERMINATED", "2026-11-19T09:00:00.000Z",
    ).lastInsertRowid);
    const empty = Number(insertBatch.run(
      fixturePrefix + "EMPTY", "旧批次缺少配套快照", "COMPLETED", "2026-11-09T08:00:00.000Z",
    ).lastInsertRowid);
    const draft = Number(insertBatch.run(fixturePrefix + "DRAFT", "待核对配套", "DRAFT", null).lastInsertRowid);
    const copyItem = db.prepare(
      `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url)
       SELECT ?, bi.package_id, bi.package_version_id, bi.version, bi.archive_url
       FROM batch_items bi JOIN packages p ON p.id = bi.package_id
       WHERE bi.batch_id = 2 AND p.code = ?`,
    );
    copyItem.run(terminated, "OTA");
    copyItem.run(draft, "CFG");

    const comparison = `/integration/${draft}/compare?project=1`;
    await page.goto(comparison);
    await expect(page.getByRole("region", { name: "基准批次" }).getByText("B123", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /1001OTA/ })).toContainText("移出配套");

    await page.goto(`${comparison}&base=${terminated}`);
    await expect(page.getByRole("region", { name: "基准批次" }).getByText("已终止", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /1001OTA/ }).getByRole("cell")).toHaveText(["1.6.0", "—", "移出配套"]);
    await expect(page.getByRole("row", { name: /1002CFG/ }).getByRole("cell")).toHaveText(["—", "2.2.0", "新增配套"]);

    await page.goto(`${comparison}&base=${empty}`);
    await expect(page.getByText("缺少配套版本快照", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /100[12]/ })).toHaveCount(0);
    await page.goto("/integration/2/compare?project=1");
    await expect(page.getByText("没有更早发起的批次", { exact: true })).toBeVisible();

    await login(page, "TEST001");
    await page.goto("/integration/4/compare?project=1");
    await expect(page.getByRole("heading", { level: 1, name: "批次对比", exact: true })).toBeVisible();
    await page.goto(comparison);
    await expect(page.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();

    await login(page, "ADMIN001");
    await page.goto(`${comparison}&base=3`);
    await expect(page.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
  } finally {
    try {
      db.prepare("DELETE FROM integration_batches WHERE code LIKE ?").run(fixturePrefix + "%");
    } finally {
      db.close();
    }
  }
});
