import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("管理员只看到一条需要提交结论的在测批次任务", async ({ page }) => {
  await login(page, "ADMIN001");
  const tasks = page.getByRole("region", { name: "待我处理", exact: true });
  const batch = tasks.getByRole("link").filter({ hasText: "B120" });
  await expect(batch).toHaveCount(1);
  await expect(batch).toContainText("提交测试结论");
  await batch.click();
  await expect(page).toHaveURL(/\/integration\/\d+\?project=1$/);
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
