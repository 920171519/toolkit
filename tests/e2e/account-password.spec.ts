import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_PASSWORD, login } from "./helpers";

const currentPassword = "OldPassword123!";
const newPassword = "NewPassword456!";

async function registerMember(page: Page) {
  const employeeId = "PW-" + randomUUID().slice(0, 8).toUpperCase();
  await page.goto("/register");
  const form = page.getByTestId("register-form");
  await form.getByLabel("姓名", { exact: true }).fill("密码测试成员");
  await form.getByLabel("工号", { exact: true }).fill(employeeId);
  await form.getByLabel("密码", { exact: true }).fill(currentPassword);
  await form.getByLabel("确认密码", { exact: true }).fill(currentPassword);
  await form.getByRole("button", { name: "注册并进入工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator(".sidebar-user-role")).toContainText(employeeId);
  return employeeId;
}

async function submitLogin(page: Page, employeeId: string, password: string, label = "登录工作台") {
  const form = page.getByTestId("login-form");
  await form.getByLabel("工号", { exact: true }).fill(employeeId);
  await form.getByLabel("密码", { exact: true }).fill(password);
  await form.getByRole("button", { name: label, exact: true }).click();
}

async function openPasswordForm(page: Page) {
  await page.getByRole("link", { name: "修改密码", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  return page.getByTestId("change-password-form");
}

test("窄屏登录后可继续访问密码页，密码输入支持键盘切换显示", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account/password");
  await expect(page).toHaveURL(url =>
    url.pathname === "/login" && url.searchParams.get("next") === "/account/password");
  await expect(page.getByTestId("change-password-form")).toHaveCount(0);
  await submitLogin(page, "MEMBER001", DEMO_PASSWORD, "登录并继续");
  await expect(page).toHaveURL(/\/account\/password$/);

  await page.getByRole("link", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const form = await openPasswordForm(page);
  const oldField = form.getByLabel("当前密码", { exact: true });
  const newField = form.getByLabel("新密码", { exact: true });
  const confirmField = form.getByLabel("确认新密码", { exact: true });
  await expect(oldField).toHaveAttribute("autocomplete", "current-password");
  await expect(newField).toHaveAttribute("autocomplete", "new-password");
  await expect(confirmField).toHaveAttribute("autocomplete", "new-password");
  await expect(oldField).toHaveAttribute("type", "password");
  await oldField.press("Tab");
  await expect(form.getByRole("button", { name: "显示当前密码", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(oldField).toHaveAttribute("type", "text");
  await expect(form.getByRole("button", { name: "隐藏当前密码", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(oldField).toHaveAttribute("type", "password");
});

test("320px 工作流页同时保留项目选择、修改密码和退出入口", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page, "ADMIN001");
  await page.goto("/packages");
  const topbar = page.locator(".topbar");
  await expect(topbar.getByRole("button", { name: "按项目查看" })).toBeVisible();
  await expect(topbar.getByRole("button", { name: "退出登录" })).toBeInViewport();
  await expect(topbar.getByRole("link", { name: "修改密码", exact: true })).toBeInViewport();
  await expect.poll(() => topbar.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(320);
  await openPasswordForm(page);
  await expect(page.getByRole("heading", { name: "修改密码", exact: true })).toBeVisible();
});

test("旧密码、重复密码、新密码长度和确认密码均由服务端校验", async ({ page }) => {
  const employeeId = await registerMember(page);
  const form = await openPasswordForm(page);
  const fields = {
    current: form.getByLabel("当前密码", { exact: true }),
    next: form.getByLabel("新密码", { exact: true }),
    confirm: form.getByLabel("确认新密码", { exact: true }),
  };
  const longPassword = "x".repeat(73);
  const invalidAttempts = [
    { current: "WrongPassword123!", next: newPassword, confirm: newPassword, field: fields.current, error: /当前密码不正确/ },
    { current: currentPassword, next: currentPassword, confirm: currentPassword, field: fields.next, error: /新密码不能与当前密码相同/ },
    { current: currentPassword, next: "short7!", confirm: "short7!", field: fields.next, error: /密码至少需要 8 个字符/ },
    { current: currentPassword, next: longPassword, confirm: longPassword, field: fields.next, error: /密码不能超过 72 个字符/ },
    { current: currentPassword, next: newPassword, confirm: "DifferentPassword789!", field: fields.confirm, error: /两次输入的新密码不一致/ },
  ];
  for (const attempt of invalidAttempts) {
    await fields.current.fill(attempt.current);
    await fields.next.fill(attempt.next);
    await fields.confirm.fill(attempt.confirm);
    await form.getByRole("button", { name: "保存新密码", exact: true }).click();
    await expect(attempt.field).toHaveAttribute("aria-invalid", "true");
    await expect(attempt.field).toHaveAccessibleDescription(attempt.error);
    await expect(page).toHaveURL(/\/account\/password$/);
  }

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.goto("/login");
  await submitLogin(page, employeeId, currentPassword);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("修改密码后当前及其他会话失效，旧密码不能登录，其他账号保持登录", async ({ page, browser, baseURL }) => {
  const employeeId = await registerMember(page);
  const otherSession = await browser.newContext({ baseURL });
  const otherAccount = await browser.newContext({ baseURL });
  try {
    const sameMember = await otherSession.newPage();
    await sameMember.goto("/login");
    await submitLogin(sameMember, employeeId, currentPassword);
    await expect(sameMember).toHaveURL(/\/dashboard$/);

    const unrelatedMember = await otherAccount.newPage();
    await login(unrelatedMember, "MEMBER001");
    const form = await openPasswordForm(page);
    await form.getByLabel("当前密码", { exact: true }).fill(currentPassword);
    await form.getByLabel("新密码", { exact: true }).fill(newPassword);
    await form.getByLabel("确认新密码", { exact: true }).fill(newPassword);
    await form.getByRole("button", { name: "保存新密码", exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("passwordChanged") === "1");
    await expect(page.getByRole("status")).toContainText("密码已修改，请使用新密码登录。");

    for (const signedOutPage of [page, sameMember]) {
      await signedOutPage.goto("/account/password");
      await expect(signedOutPage).toHaveURL(url =>
        url.pathname === "/login" && url.searchParams.get("next") === "/account/password");
    }
    await unrelatedMember.goto("/dashboard");
    await expect(unrelatedMember.getByRole("heading", { name: "我的工作台", exact: true })).toBeVisible();
    await expect(unrelatedMember.locator(".sidebar-user-role")).toContainText("MEMBER001");

    await submitLogin(page, employeeId, currentPassword, "登录并继续");
    await expect(page.locator(".form-error")).toContainText("工号或密码不正确");
    await expect(page).toHaveURL(/\/login/);
    await submitLogin(page, employeeId, newPassword, "登录并继续");
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(page.getByTestId("change-password-form")).toBeVisible();
  } finally {
    await otherSession.close();
    await otherAccount.close();
  }
});
