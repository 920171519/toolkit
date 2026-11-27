import { expect, test, type Page } from "@playwright/test";
import { confirmAction, expectFlash, login } from "./helpers";
import { openE2eDatabase } from "./storage";

async function submitActivation(page: Page, action: "启用账号" | "停用账号") {
  await page.getByRole("button", { name: action, exact: true }).click();
  await confirmAction(page);
}

test("管理员资格和登录状态一起保护最后一名启用的管理员", async ({ browser, page }) => {
  await login(page, "ADMIN001");
  const db = openE2eDatabase();
  const employeeId = "QAADMINFLOOR001";
  const lastAdminError = "系统至少需要保留一名启用状态的管理员。";
  db.exec("PRAGMA busy_timeout = 5000");
  const id = Number(db.prepare(
    `INSERT INTO users (name, employee_id, password_hash, role, is_active, created_at)
     SELECT '事务校验管理员', ?, password_hash, 'ADMIN', 0, created_at
     FROM users WHERE employee_id = 'ADMIN001'`,
  ).run(employeeId).lastInsertRowid);
  const target = () => db.prepare("SELECT role, is_active FROM users WHERE id = ?").get(id);
  const activeAdmins = () => db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1").get()?.count;
  const href = `/settings/users/${id}?q=QAADMINFLOOR001`;
  const roleForm = page.getByTestId(`user-role-form-${id}`);
  const otherTab = await page.context().newPage();
  const targetSession = await browser.newContext();
  try {
    expect(activeAdmins()).toBe(1);
    await page.goto(href);
    await roleForm.getByLabel("系统角色").selectOption("MEMBER");
    await roleForm.getByRole("button", { name: "更新角色", exact: true }).click();
    await expect(roleForm.getByRole("alert")).toHaveText(lastAdminError);
    await expect(roleForm.getByLabel("系统角色")).toHaveValue("MEMBER");
    expect(target()).toMatchObject({ role: "ADMIN", is_active: 0 });

    await submitActivation(page, "启用账号");
    await expectFlash(page, "账号已启用。");
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === employeeId);
    expect(activeAdmins()).toBe(2);
    const accountPage = await targetSession.newPage();
    await login(accountPage, employeeId);
    expect(db.prepare("SELECT 1 FROM sessions WHERE user_id = ?").get(id)).toBeTruthy();

    await page.getByRole("button", { name: "停用账号", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await otherTab.goto(href);
    await submitActivation(otherTab, "停用账号");
    await expectFlash(otherTab, "账号已停用。");
    expect(db.prepare("SELECT 1 FROM sessions WHERE user_id = ?").get(id)).toBeUndefined();
    expect(activeAdmins()).toBe(1);
    await accountPage.goto("/dashboard");
    await accountPage.waitForURL("**/login**");

    await confirmAction(page);
    await expect(page.getByRole("alert").filter({ hasText: lastAdminError })).toBeVisible();
    expect(target()).toMatchObject({ role: "ADMIN", is_active: 0 });

    await submitActivation(otherTab, "启用账号");
    await expectFlash(otherTab, "账号已启用。");
    const otherRoleForm = otherTab.getByTestId(`user-role-form-${id}`);
    await otherRoleForm.getByLabel("系统角色").selectOption("MEMBER");
    await otherRoleForm.getByRole("button", { name: "更新角色", exact: true }).click();
    await expectFlash(otherTab, "人员角色已更新。");
    expect(target()).toMatchObject({ role: "MEMBER", is_active: 1 });
    expect(activeAdmins()).toBe(1);
  } finally {
    await targetSession.close();
    await otherTab.close();
    db.prepare("DELETE FROM audit_logs WHERE entity_type = 'USER' AND entity_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    db.close();
  }
});

test("角色和停用表单对已移除的同一账号保留明确错误", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = openE2eDatabase();
  db.exec("PRAGMA busy_timeout = 5000");
  const id = Number(db.prepare(
    `INSERT INTO users (name, employee_id, password_hash, role, created_at)
     SELECT '已移除验收账号', 'QAADMINMISSING001', password_hash, 'MEMBER', created_at
     FROM users WHERE employee_id = 'ADMIN001'`,
  ).run().lastInsertRowid);
  const otherTab = await page.context().newPage();
  const href = `/settings/users/${id}`;
  try {
    await page.goto(href);
    await otherTab.goto(href);
    await otherTab.getByRole("button", { name: "停用账号", exact: true }).click();
    await expect(otherTab.getByRole("alertdialog")).toBeVisible();
    db.prepare("DELETE FROM users WHERE id = ?").run(id);

    const roleForm = page.getByTestId(`user-role-form-${id}`);
    await roleForm.getByLabel("系统角色").selectOption("ADMIN");
    await roleForm.getByRole("button", { name: "更新角色", exact: true }).click();
    await expect(roleForm.getByRole("alert")).toHaveText("人员不存在。");
    await confirmAction(otherTab);
    await expect(otherTab.getByRole("alert").filter({ hasText: "人员不存在。" })).toBeVisible();
  } finally {
    await otherTab.close();
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    db.close();
  }
});
