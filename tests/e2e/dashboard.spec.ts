import { expect, test } from "@playwright/test";
import { login } from "./helpers";

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
