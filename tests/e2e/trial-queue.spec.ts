import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("发布队列表头筛选、排序及分页，详情返回保留筛选条件", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial");

  const release = page.getByRole("region", { name: "待发布试制", exact: true });
  const rows = release.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(release.getByRole("searchbox")).toHaveCount(0);

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

  const batchFilter = release.getByRole("button", { name: "筛选转测批次", exact: true });
  await batchFilter.press("Enter");
  const batchMenu = release.getByRole("dialog", { name: "筛选转测批次", exact: true });
  const batch = batchMenu.getByRole("textbox", { name: "转测批次", exact: true });
  await batchMenu.getByRole("combobox", { name: "转测批次匹配方式", exact: true }).selectOption("exact");
  await batch.fill("b119");
  await batchMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL(/f_release_batch=b119/);
  await expect(rows).toHaveCount(1);
  await expect(rows.getByRole("link", { name: "B119" })).toHaveAttribute("href", /^\/integration\/\d+\?project=1$/);
  await expect(rows.getByRole("cell", { name: "王磊", exact: true })).toBeVisible();
  await expect(rows.getByRole("button")).toHaveText(["发布", "放弃"]);

  await rows.getByRole("link", { name: "详情", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1001OTA 1.6.0" })).toBeVisible();
  const evidence = page.getByRole("region", { name: "验收结论" });
  await expect(evidence.getByText("测试通过", { exact: true })).toBeVisible();
  await expect(evidence.getByRole("link", { name: "验证报告" })).toHaveAttribute("href", /\/B119$/);
  await page.getByRole("link", { name: "返回试制队列" }).click();
  await expect(page).toHaveURL(/f_release_batch=b119/);
  await expect(release.locator('th[aria-sort="descending"]')).toContainText("转测批次");
  await expect(pagination.getByLabel("每页条数")).toHaveValue("25");
  await batchFilter.click();
  await expect(batch).toHaveValue("b119");
  await batchMenu.getByRole("link", { name: "清除本列", exact: true }).click();
  await expect(rows).toHaveCount(2);

  await page.goto("/trial?release_q=1006KEY&release_batch=B119&release_size=25&release_sort=batch&release_direction=desc");
  await expect(release.getByText("没有匹配的版本", { exact: true })).toBeVisible();
  await expect(release.getByRole("link", { name: "清除搜索条件 1006KEY" })).toBeVisible();
  await batchFilter.click();
  await expect(batch).toHaveValue("B119");
  await page.keyboard.press("Escape");
  await release.getByRole("link", { name: "清除搜索条件 1006KEY" }).click();
  await expect(rows).toHaveCount(1);
  await release.getByRole("link", { name: "清除全部筛选" }).click();
  await expect(rows).toHaveCount(2);
  await batchFilter.click();
  await expect(batch).toHaveValue("");
  await expect(pagination.getByLabel("每页条数")).toHaveValue("25");
});

test("两个队列各自筛选时保留条件及项目范围，绑定详情返回后还原", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial?project=1");

  const release = page.getByRole("region", { name: "待发布试制", exact: true });
  const binding = page.getByRole("region", { name: "试制版本绑定验证", exact: true });
  await release.getByRole("button", { name: "筛选版本", exact: true }).click();
  const versionMenu = release.getByRole("dialog", { name: "筛选版本", exact: true });
  await versionMenu.getByRole("textbox", { name: "版本", exact: true }).fill("1.6.0");
  await versionMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL(/f_release_version=1\.6\.0/);
  await expect(release.locator("tbody tr")).toHaveCount(1);
  const tabs = page.getByRole("navigation", { name: "试制与绑定队列" });
  await tabs.getByRole("link", { name: /节点绑定/ }).click();

  const projectFilter = binding.getByRole("button", { name: "筛选项目", exact: true });
  await projectFilter.click();
  const projectMenu = binding.getByRole("dialog", { name: "筛选项目", exact: true });
  await expect(projectMenu.getByRole("checkbox", { name: "星云 N1" })).toBeVisible();
  await expect(projectMenu.getByRole("checkbox", { name: "极光 M2" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const statusFilter = binding.getByRole("button", { name: "筛选绑定状态", exact: true });
  await statusFilter.click();
  const statusMenu = binding.getByRole("dialog", { name: "筛选绑定状态", exact: true });
  await statusMenu.getByRole("checkbox", { name: "风险发布", exact: true }).check();
  await statusMenu.getByRole("checkbox", { name: "绑定中", exact: true }).check();
  await statusMenu.getByRole("button", { name: "应用", exact: true }).click();

  await expect(page).toHaveURL(url =>
    url.searchParams.get("project") === "1" &&
    url.searchParams.get("f_release_version") === "1.6.0" &&
    url.searchParams.get("f_binding_status") === "RISK,PUSHED",
  );
  const bindingRows = binding.locator("tbody tr");
  await expect(bindingRows).toHaveCount(1);
  await expect(bindingRows.filter({ hasText: "1004NET" })).toHaveCount(0);
  const validatingRow = bindingRows.filter({ hasText: "1006KEY" });
  await expect(validatingRow.getByRole("cell", { name: "赵敏", exact: true })).toBeVisible();
  await expect(validatingRow.getByRole("cell", { name: "未关联转测批次", exact: true })).toBeVisible();
  await validatingRow.getByRole("link", { name: "查看节点与审批" }).click();
  await page.getByRole("link", { name: "返回节点绑定" }).click();

  await expect(page).toHaveURL(/\/trial\?project=1/);
  await statusFilter.click();
  await expect(statusMenu.getByRole("checkbox", { name: "风险发布", exact: true })).toBeChecked();
  await expect(statusMenu.getByRole("checkbox", { name: "绑定中", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");

  const pendingFilter = binding.getByRole("button", { name: "筛选待审批", exact: true });
  await pendingFilter.click();
  const pendingMenu = binding.getByRole("dialog", { name: "筛选待审批", exact: true });
  await pendingMenu.getByRole("spinbutton", { name: "待审批最小值" }).fill("9");
  await pendingMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(binding.getByText("没有匹配的版本", { exact: true })).toBeVisible();
  await binding.getByRole("link", { name: "清除全部筛选", exact: true }).click();
  await expect(bindingRows).toHaveCount(1);
  await tabs.getByRole("link", { name: /待发布试制/ }).click();
  await expect(page).toHaveURL(/f_release_version=1\.6\.0/);
  await expect(release.locator("tbody tr")).toHaveCount(1);
});

test("旧版待转正筛选值退出节点绑定筛选，仍可使用同一链接中的有效条件", async ({ page }) => {
  await login(page, "ADMIN001");
  const path = "/trial?project=1&view=binding";
  const binding = page.getByRole("region", { name: "试制版本绑定验证", exact: true });
  const rows = binding.locator("tbody tr");
  const statusFilter = binding.getByRole("button", { name: "筛选绑定状态", exact: true });
  const statusMenu = binding.getByRole("dialog", { name: "筛选绑定状态", exact: true });

  await page.goto(path + "&f_binding_status=PENDING_FORMAL,PUSHED");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1006KEY");
  await statusFilter.click();
  await expect(statusMenu.getByRole("checkbox", { name: "绑定中", exact: true })).toBeChecked();
  await expect(statusMenu.getByRole("checkbox", { name: "待转正", exact: true })).toHaveCount(0);
  await statusMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL(url =>
    url.searchParams.get("project") === "1" &&
    url.searchParams.get("view") === "binding" &&
    url.searchParams.get("f_binding_status") === "PUSHED",
  );

  await page.goto(path + "&binding_status=" + encodeURIComponent("待转正"));
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1006KEY");
  await page.goto(path + "&f_binding_status=PENDING_FORMAL");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1006KEY");
});

test("绑定队列翻页保留项目、筛选、另一个队列的条件及定位锚点", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = openE2eDatabase();
  const versionPrefix = "e2e-binding-page-";
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    db.prepare(
      `WITH RECURSIVE numbers(n) AS (
         SELECT 1
         UNION ALL SELECT n + 1 FROM numbers WHERE n < 11
       )
       INSERT INTO package_versions
         (package_id, version, change_summary, archive_url, status, binding_mode, submitted_at, updated_at)
       SELECT 6, ? || n, '节点绑定分页验证', 'https://example.com/archive', 'TRIAL', 'PUSHED', datetime('now'), datetime('now')
       FROM numbers`,
    ).run(versionPrefix);
    db.prepare(
      `INSERT INTO version_transfer_requests (package_version_id, project_id, status, integration_status, submitted_at, updated_at)
       SELECT id, 1, 'TRIAL', 'PASSED', datetime('now'), datetime('now') FROM package_versions WHERE version LIKE ?`,
    ).run(versionPrefix + "%");

    await page.goto(`/trial?project=1&view=binding&f_binding_version=${versionPrefix}&f_release_version=1.6.0&binding_sort=version#binding-queue`);
    const binding = page.getByRole("region", { name: "试制版本绑定验证", exact: true });
    const rows = binding.locator("tbody tr");
    const pagination = binding.getByRole("navigation", { name: "试制版本绑定验证分页", exact: true });
    const filtersRetained = (url: URL) => url.searchParams.get("project") === "1" &&
      url.searchParams.get("view") === "binding" && url.searchParams.get("f_binding_version") === versionPrefix &&
      url.searchParams.get("f_release_version") === "1.6.0" && url.searchParams.get("binding_sort") === "version" &&
      url.hash === "#binding-queue";

    await expect(rows).toHaveCount(10);
    await expect(pagination.getByRole("link", { name: "上一页", exact: true })).toHaveCount(0);
    await pagination.getByRole("link", { name: "下一页", exact: true }).click();
    await expect(page).toHaveURL((url) => filtersRetained(url) && url.searchParams.get("binding_page") === "2" && !url.searchParams.has("page"));
    await expect(rows).toHaveCount(1);
    await expect(pagination.getByRole("link", { name: "下一页", exact: true })).toHaveCount(0);
    await pagination.getByRole("link", { name: "上一页", exact: true }).click();
    await expect(page).toHaveURL((url) => filtersRetained(url) && !url.searchParams.has("binding_page"));
    await expect(rows).toHaveCount(10);
  } finally {
    try {
      db.prepare("DELETE FROM package_versions WHERE version LIKE ?").run(versionPrefix + "%");
    } finally {
      db.close();
    }
  }
});
