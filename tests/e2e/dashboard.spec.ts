import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("待安排转测显示完整数量和按时间排列的四个版本", async ({ page }) => {
  await page.goto("/");
  const db = openE2eDatabase();
  const name = "工作台转测预览项目";
  const submittedAt = "2026-11-28T00:00:00.000Z";
  const packageRow = db.prepare("SELECT id FROM packages WHERE name = '1002CFG' AND code = 'CFG'").get() as { id: number };
  const manager = db.prepare("SELECT id FROM users WHERE employee_id = 'MGR001'").get() as { id: number };
  const versionIds: number[] = [];
  let projectId: number | undefined;
  try {
    projectId = Number(db.prepare("INSERT INTO projects (name, code, created_at) VALUES (?, ?, ?)")
      .run(name, "PW-WB-TRANSFER", submittedAt).lastInsertRowid);
    const nodeId = Number(db.prepare("INSERT INTO project_nodes (project_id, name) VALUES (?, 'EVT')")
      .run(projectId).lastInsertRowid);
    db.prepare("INSERT INTO project_software_managers (project_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(projectId, manager.id, submittedAt);
    db.prepare("INSERT INTO package_usages (package_id, project_id, node_id) VALUES (?, ?, ?)")
      .run(packageRow.id, projectId, nodeId);
    const insertVersion = db.prepare(
      `INSERT INTO package_versions (package_id, version, change_summary, archive_url, submitted_at, updated_at)
       VALUES (?, ?, '待转测预览验证', 'https://example.test/archive', ?, ?)`,
    );
    const insertRequest = db.prepare(
      `INSERT INTO version_transfer_requests (package_version_id, project_id, status, integration_status, submitted_at, updated_at)
       VALUES (?, ?, 'PENDING', 'PENDING', ?, ?)`,
    );
    for (const [version, day] of [["91.0.4", "28"], ["91.0.2", "27"], ["91.0.5", "28"], ["91.0.3", "27"], ["91.0.1", "26"]]) {
      const at = `2026-11-${day}T00:00:00.000Z`;
      const versionId = Number(insertVersion.run(packageRow.id, version, at, at).lastInsertRowid);
      versionIds.push(versionId);
      insertRequest.run(versionId, projectId, at, at);
    }

    const task = page.getByRole("region", { name: "转测与集成测试", exact: true }).getByRole("link", { name: /工作台转测预览项目/ });
    await login(page, "MGR002");
    await expect(task).toHaveCount(0);
    for (const account of ["ADMIN001", "MGR001"]) {
      await login(page, account);
      await expect(task.locator("strong")).toHaveText(`${name} · 5 项待安排转测`);
      await expect(task.locator("strong + span")).toHaveText("1002CFG 91.0.5、1002CFG 91.0.4、1002CFG 91.0.3、1002CFG 91.0.2 等");
      await expect(task).toHaveAttribute("href", `/submissions?project=${projectId}`);
    }
    await task.click();
    const queue = page.getByRole("region", { name: `${name}待转测申请表格`, exact: true });
    await expect(queue.getByRole("row").filter({ hasText: "91.0.1" })).toBeVisible();
  } finally {
    try {
      for (const versionId of versionIds) db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
      if (projectId !== undefined) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    } finally {
      db.close();
    }
  }
});

test("管理员只看到一条需要提交结论的在测批次任务", async ({ page }) => {
  await login(page, "ADMIN001");
  const tasks = page.getByRole("region", { name: "待我处理", exact: true });
  const batch = tasks.getByRole("link").filter({ hasText: "B120" });
  await expect(batch).toHaveCount(1);
  await expect(batch).toContainText("提交测试结论");
  await batch.click();
  await expect(page).toHaveURL(/\/integration\/\d+\?project=1$/);
});

test("兼任软件经理和集成测试负责人时按项目区分核对、跟踪和提交结论", async ({ page }) => {
  await page.goto("/");
  const db = openE2eDatabase();
  const account = db.prepare("SELECT id FROM users WHERE employee_id = 'TEST002'").get() as { id: number };
  const n1 = db.prepare("SELECT id FROM projects WHERE code = 'N1'").get() as { id: number };
  const m2 = db.prepare("SELECT id FROM projects WHERE code = 'M2'").get() as { id: number };
  const t3 = db.prepare("SELECT id FROM projects WHERE code = 'T3'").get() as { id: number };
  const now = "2026-11-28T00:00:00.000Z";
  const assignments: number[] = [];
  const drafts: number[] = [];

  try {
    const assign = db.prepare("INSERT INTO project_software_managers (project_id, user_id, created_at) VALUES (?, ?, ?)");
    for (const projectId of [n1.id, m2.id]) {
      assign.run(projectId, account.id, now);
      assignments.push(projectId);
    }
    const draft = db.prepare("INSERT INTO integration_batches (code, project_id, created_at) VALUES (?, ?, ?)");
    for (const [code, projectId] of [["PW-WB-N1", n1.id], ["PW-WB-M2", m2.id], ["PW-WB-T3", t3.id]] as const) {
      drafts.push(Number(draft.run(code, projectId, now).lastInsertRowid));
    }
    db.prepare(
      `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url, is_changed)
       SELECT ?, package_id, MIN(id), 'qa', 'https://example.test/archive', 0
       FROM package_versions GROUP BY package_id ORDER BY package_id LIMIT 2`,
    ).run(drafts[1]);

    await login(page, "TEST002");
    const batchTasks = page.getByRole("region", { name: "转测与集成测试", exact: true })
      .getByRole("link").filter({ hasText: /PW-WB-|B120|B121/ });
    await expect(batchTasks.locator("strong")).toHaveText([
      "核对待发起批次：PW-WB-M2 · 极光 M2",
      "核对待发起批次：PW-WB-N1 · 星云 N1",
      "跟踪测试进度：B120 · 星云 N1",
      "提交测试结论：B121 · 极光 M2",
    ]);
    await expect(batchTasks.nth(0)).toContainText("2 个配套软件包");
    await expect(batchTasks.nth(0)).toHaveAttribute("href", `/integration/${drafts[1]}?project=${m2.id}`);
    await expect(batchTasks.nth(2)).toContainText("待集成测试负责人出结论");
    await batchTasks.nth(3).click();
    await expect(page.getByRole("heading", { level: 1, name: /B121/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/integration/\\d+\\?project=${m2.id}$`));
  } finally {
    try {
      for (const draft of drafts) {
        db.prepare("DELETE FROM batch_items WHERE batch_id = ?").run(draft);
        db.prepare("DELETE FROM integration_batches WHERE id = ?").run(draft);
      }
      for (const projectId of assignments) {
        db.prepare("DELETE FROM project_software_managers WHERE project_id = ? AND user_id = ?").run(projectId, account.id);
      }
    } finally {
      db.close();
    }
  }
});

test("设备绑定责任人可从窄屏工作台直达待处理节点", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "VALID001");
  const tasks = page.getByRole("region", { name: "待我处理", exact: true });
  const task = tasks.getByRole("link", { name: /提交绑定电子流/ }).first();
  await expect(task).toBeInViewport();
  const target = await task.getAttribute("href");
  expect(target).toMatch(/#binding-node-\d+$/);
  await task.click();
  await expect(page).toHaveURL(/\/trial\/\d+#binding-node-\d+$/);
  await expect(page.locator(new URL(page.url()).hash)).toBeVisible();
});

test("已有足量待审批条码时工作台指向电子流审批记录", async ({ page }) => {
  await login(page, "VALID001");
  const tasks = page.getByRole("region", { name: "待我处理", exact: true });
  const task = tasks.getByRole("link", { name: /跟进电子流审批：1006KEY 1\.3\.0/ });
  await expect(task).toContainText("星云 N1 / PVT");
  await expect(task).toContainText("已登记足量条码，等待审批");
  await task.click();
  await expect(page).toHaveURL(/#binding-flow-\d+$/);
  await expect(page.locator(new URL(page.url()).hash)).toContainText("BF-2026-0005");
});

test("重复打开通知保留首次已读时间，每个账号单独记录", async ({ page }) => {
  const key = "e2e-notification-read-marker";
  const next = "/trial/32?project=1#binding-flow-5";
  const href = `/api/notifications/read?${new URLSearchParams({ key, next })}`;
  await page.goto("/");
  const db = openE2eDatabase();
  const readRecords = () => db.prepare(
    `SELECT u.employee_id AS employeeId, n.read_at AS readAt FROM notification_reads n
     JOIN users u ON u.id = n.user_id WHERE n.notification_key = ? ORDER BY u.employee_id`,
  ).all(key);
  const openNotification = () => page.request.get(href, { maxRedirects: 0 });

  try {
    const anonymous = await openNotification();
    expect(anonymous.status()).toBe(303);
    expect(anonymous.headers().location).toBe("/login");
    expect(readRecords()).toHaveLength(0);

    await login(page, "VALID001");
    const opened = await openNotification();
    expect(opened.status()).toBe(303);
    expect(opened.headers().location).toBe(next);
    expect(readRecords()).toEqual([{ employeeId: "VALID001", readAt: expect.any(String) }]);

    const firstRead = "2000-01-01T00:00:00.000Z";
    db.prepare("UPDATE notification_reads SET read_at = ? WHERE notification_key = ?").run(firstRead, key);
    expect((await openNotification()).status()).toBe(303);
    expect(readRecords()).toEqual([{ employeeId: "VALID001", readAt: firstRead }]);

    await login(page, "MGR001");
    expect((await openNotification()).status()).toBe(303);
    expect(readRecords()).toEqual([
      { employeeId: "MGR001", readAt: expect.any(String) },
      { employeeId: "VALID001", readAt: firstRead },
    ]);
  } finally {
    try {
      db.prepare("DELETE FROM notification_reads WHERE notification_key = ?").run(key);
    } finally {
      db.close();
    }
  }
});

test("工作台兼容旧驳回通知的已读键，并保留其他通知", async ({ page }) => {
  await login(page, "VALID001");
  const inbox = page.getByRole("region", { name: "通知与提醒", exact: true });
  const rejected = inbox.getByRole("link", { name: /BF-2026-0006 被驳回/ });
  const approved = inbox.getByRole("link", { name: /BF-2026-0004 已通过/ });
  await expect(rejected).toBeVisible();
  await expect(approved).toBeVisible();

  const rejectedHref = new URL((await rejected.getAttribute("href"))!, page.url());
  const currentKey = rejectedHref.searchParams.get("key")!;
  expect(currentKey).toMatch(/^rejected-flow-\d+$/);
  const legacyKey = currentKey.replace("rejected-flow-", "flow-notice-");
  const approvedHref = new URL((await approved.getAttribute("href"))!, page.url());
  const approvedKey = approvedHref.searchParams.get("key")!;
  const root = openE2eDatabase();
  const user = root.prepare("SELECT id FROM users WHERE employee_id = 'VALID001'").get() as { id: number };

  try {
    rejectedHref.searchParams.set("key", legacyKey);
    const response = await page.request.get(rejectedHref.toString(), { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(rejectedHref.searchParams.get("next"));

    await page.reload();
    await expect(rejected).toHaveCount(0);
    await expect(approved).toBeVisible();
    await approved.click();
    await expect(page).toHaveURL(/#binding-flow-\d+$/);

    await page.goto("/dashboard");
    await expect(rejected).toHaveCount(0);
    await expect(approved).toHaveCount(0);
    const reads = root.prepare(
      "SELECT notification_key AS key FROM notification_reads WHERE user_id = ? AND notification_key IN (?, ?, ?)",
    ).all(user.id, currentKey, legacyKey, approvedKey);
    expect(reads).toHaveLength(2);
    expect(reads).toEqual(expect.arrayContaining([{ key: legacyKey }, { key: approvedKey }]));
  } finally {
    try {
      root.prepare("DELETE FROM notification_reads WHERE user_id = ? AND notification_key IN (?, ?)").run(user.id, legacyKey, approvedKey);
    } finally {
      root.close();
    }
  }
});

test("通知跳转保留站内路径，拒绝含糊或站外的地址", async ({ page }) => {
  await login(page, "VALID001");
  const cases = [
    { next: "/trial/32?project=1#binding-flow-5", location: "/trial/32?project=1#binding-flow-5" },
    { next: "/?q=M2#contacts", location: "/?q=M2#contacts" },
    { next: "https://example.invalid/", location: "/dashboard" },
    { next: "/projects/..//", location: "/dashboard" },
  ];

  for (const { next, location } of cases) {
    const response = await page.request.get(`/api/notifications/read?${new URLSearchParams({ next })}`, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(location);
  }
});
