import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("软件包详情接口校验账号和项目，失败及成功响应均禁用缓存", async ({ page }) => {
  const detailUrl = "/api/packages/7?project=1";
  async function expectError(path: string, status: number, error: string) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(status);
    expect(response.headers()["cache-control"], path).toBe("no-store");
    expect(await response.json(), path).toEqual({ error });
  }
  await expectError(detailUrl, 401, "请先登录。");

  await login(page, "MEMBER001");
  await expectError(detailUrl, 404, "项目不存在或不可查看。");
  await login(page, "MGR001");
  await expectError("/api/packages/unknown?project=1", 400, "软件包参数无效。");
  await expectError("/api/packages/9876543?project=1", 404, "软件包不存在。");

  for (const path of ["/api/packages/7?project=", "/api/packages/7?project=1&project=1"]) {
    await expectError(path, 404, "项目不存在或不可查看。");
  }

  const detail = await page.request.get(detailUrl);
  expect(detail.status()).toBe(200);
  expect(detail.headers()["cache-control"]).toBe("no-store");
  const payload = await detail.json();
  expect(payload).toMatchObject({ package: { id: 7 }, canEdit: false });

  const alternateProject = await page.request.get("/api/packages/7?project=1e0");
  expect(alternateProject.status()).toBe(200);
  expect(await alternateProject.json()).toEqual(payload);

  await page.goto("/packages?project=");
  await expect(page.getByRole("heading", { name: "软件版本总览", exact: true })).toBeVisible();
  await page.goto("/packages?project=1&project=1");
  await expect(page.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
});

test("只可访问旧版本的账号仍能看到软件包，始终隐藏未授权的最新版本", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  const code = "PW-PACKAGE-VERSION-SCOPE";
  const older = "1.0.0";
  const latest = "2.0.0";
  const olderAt = "2026-11-26T01:00:00Z";
  const latestAt = "2026-11-27T01:00:00Z";
  let packageId: number | undefined;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const submitter = db.prepare("SELECT id FROM users WHERE employee_id = 'VALID001'").get() as { id: number };
    packageId = Number(db.prepare("INSERT INTO packages (name, code, created_at) VALUES (?, ?, ?)")
      .run("版本可见范围回归软件包", code, olderAt).lastInsertRowid);
    const insertVersion = db.prepare(
      `INSERT INTO package_versions
        (package_id, version, change_summary, archive_url, status, submitted_by, submitted_at, trial_released_at, updated_at)
       VALUES (?, ?, '版本可见范围回归', 'https://example.test/archive', 'TRIAL', ?, ?, ?, ?)`,
    );
    insertVersion.run(packageId, older, submitter.id, olderAt, olderAt, olderAt);
    insertVersion.run(packageId, latest, null, latestAt, latestAt, latestAt);

    await page.goto(`/packages?q=${code}`);
    const link = page.getByRole("link", { name: `查看 ${code} 详情`, exact: true });
    const row = page.getByRole("row").filter({ has: link });
    await expect(row.getByText(older, { exact: true })).toBeVisible();
    await expect(row.getByText(latest, { exact: true })).toHaveCount(0);

    const detailUrl = `/api/packages/${packageId}`;
    const restricted = await page.request.get(detailUrl);
    expect(restricted.ok()).toBeTruthy();
    expect(await restricted.json()).toMatchObject({
      package: { id: packageId, currentVersion: null, currentVersionId: null, currentStatus: null, trialVersion: null, trialVersions: [older] },
      versions: [{ version: older }],
    });

    await link.click();
    const drawer = page.getByRole("dialog", { name: "软件包详情" });
    await drawer.getByRole("tab", { name: "版本历史" }).click();
    await expect(drawer.getByRole("heading", { name: older, exact: true })).toBeVisible();
    await expect(drawer.getByRole("heading", { name: latest, exact: true })).toHaveCount(0);

    await login(page, "ADMIN001");
    const unrestricted = await page.request.get(detailUrl);
    expect(unrestricted.ok()).toBeTruthy();
    expect(await unrestricted.json()).toMatchObject({
      package: { id: packageId, currentVersion: latest, trialVersion: latest },
      versions: [{ version: latest }, { version: older }],
    });
  } finally {
    try {
      if (packageId !== undefined) db.prepare("DELETE FROM packages WHERE id = ?").run(packageId);
    } finally {
      db.close();
    }
  }
});

test("软件包详情按资料分类，版本和节点可以搜索，关闭后保留当前筛选", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/packages?project=1&q=1001OTA");
  await page.getByRole("link", { name: "查看 1001OTA 使用范围" }).click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("tab", { name: "使用范围" })).toHaveAttribute("aria-selected", "true");
  const scope = drawer.getByRole("searchbox", { name: "搜索项目或节点" });
  await scope.fill("Ｍ２");
  await expect(drawer.getByText("极光 M2", { exact: false })).toBeVisible();
  await expect(drawer.getByText("星云 N1", { exact: false })).toHaveCount(0);
  await drawer.getByRole("tab", { name: "使用范围" }).press("ArrowLeft");
  await expect(drawer.getByRole("tab", { name: "版本历史" })).toBeFocused();
  await expect(drawer.getByRole("tab", { name: "版本历史" })).toHaveAttribute("aria-selected", "true");
  await drawer.getByRole("searchbox", { name: "搜索版本" }).fill("1.6.0");
  await expect(drawer.getByRole("heading", { name: "1.6.0", exact: true })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "1.6.1", exact: true })).toHaveCount(0);
  await drawer.getByRole("searchbox", { name: "搜索版本" }).fill("查无版本");
  await expect(drawer.getByText("没有匹配的版本", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "清除搜索" }).click();
  await expect(drawer.getByRole("searchbox", { name: "搜索版本" })).toHaveValue("");
  await drawer.getByRole("searchbox", { name: "搜索版本" }).fill("1.6.0");
  await drawer.getByRole("searchbox", { name: "搜索版本" }).press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "搜索软件包" })).toHaveValue("1001OTA");
  await expect(page.getByRole("link", { name: "查看 1001OTA 使用范围" })).toBeFocused();
});

test("责任信息编辑使用独立面板，并能搜索人员和返回原位置", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/packages?project=1");
  const trigger = page.getByRole("link", { name: "查看 1001OTA 详情" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  const edit = drawer.getByRole("button", { name: "编辑责任信息" });
  await edit.click();
  const search = drawer.getByRole("searchbox", { name: "搜索责任人" });
  await expect(search).toBeFocused();
  await search.fill("林澈　ｍｇｒ００１");
  await expect(drawer.getByRole("radio", { name: /MGR001/ })).toBeVisible();
  await expect(drawer.getByRole("tablist")).toHaveCount(0);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(drawer.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");

  await edit.press("Enter");
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(edit).toBeFocused();
  await expect(drawer).toBeVisible();
  await edit.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("责任田项目负责人可编辑软件包责任信息，项目软件经理仅可读取", async ({ page }) => {
  const detailUrl = "/api/packages/7?project=1";
  await login(page, "TEST001");
  const baseline = await page.request.get(detailUrl);
  expect(baseline.ok()).toBeTruthy();
  const { package: pkg, audits } = await baseline.json();
  const description = "责任田项目负责人验证诊断工具链说明的保存。";
  let auditId: number | undefined;

  try {
    await page.goto("/packages?project=1&open=7");
    const drawer = page.getByRole("dialog", { name: "软件包详情" });
    await drawer.getByRole("button", { name: "编辑责任信息" }).click();
    await drawer.getByLabel("软件包说明").fill(description);
    await drawer.getByRole("button", { name: "保存责任信息" }).click();
    await expect(drawer.getByText(description, { exact: true })).toBeVisible();

    const saved = await page.request.get(detailUrl);
    expect(saved.ok()).toBeTruthy();
    const detail = await saved.json();
    expect(detail.canEdit).toBe(true);
    const [latestAudit] = detail.audits;
    expect(latestAudit?.action).toBe("UPDATE_PACKAGE_RESPONSIBILITY");
    expect(audits.map(({ id }: { id: number }) => id)).not.toContain(latestAudit.id);
    auditId = latestAudit.id;

    await login(page, "MGR001");
    const reader = await page.request.get(detailUrl);
    expect(reader.ok()).toBeTruthy();
    expect(await reader.json()).toMatchObject({ canEdit: false, package: { description }, audits: [] });
  } finally {
    const db = openE2eDatabase();
    try {
      db.prepare("UPDATE packages SET description = ? WHERE id = ? AND description = ?").run(pkg.description, pkg.id, description);
      if (auditId !== undefined) db.prepare("DELETE FROM audit_logs WHERE id = ?").run(auditId);
    } finally {
      db.close();
    }
  }
});
