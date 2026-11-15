import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("公开项目联系人与账号", () => {
  test("未登录可以访问公开首页，只展示项目 PM 与软件经理", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("项目联系人");
    await expect(page.getByText("星云 N1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("王磊", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("林澈", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /内部登录/ })).toBeVisible();
    await expect(page.locator(".project-contact-card")).toHaveCount(3);
    await expect(page.locator("body")).not.toContainText("责任田接口人");
    await expect(page.locator("body")).not.toContainText("工程流程");

    await page.getByLabel("搜索项目联系人").fill("陈曦");
    await expect(page.locator(".project-contact-card")).toHaveCount(1);
    await expect(page.locator(".project-contact-card")).toContainText("极光 M2");

    await page.getByLabel("搜索项目联系人").fill("林澈");
    await expect(page.locator(".project-contact-card")).toHaveCount(1);
    await expect(page.locator(".project-contact-card")).toContainText("星云 N1");

    await page.getByLabel("搜索项目联系人").fill("沈清");
    await expect(page.locator(".project-contact-card")).toHaveCount(1);
    await expect(page.locator(".project-contact-card")).toContainText("极光 M2");

    await page.getByLabel("搜索项目联系人").fill("唐雅");
    await expect(page.locator(".project-contact-card")).toHaveCount(1);
    await expect(page.locator(".project-contact-card")).toContainText("磐石 T3");

    await page.getByLabel("搜索项目联系人").fill("不存在的项目");
    await expect(page.getByText("没有匹配的项目联系人")).toBeVisible();
  });

  test("未登录访问内部页面会跳转登录，错误密码有明确提示", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("login-form")).toBeVisible();

    await page.locator('input[name="employeeId"]').fill("MGR001");
    await page.locator('input[name="password"]').fill("wrong-password");
    await page.getByRole("button", { name: /登录工作台/ }).click();
    await expect(page.locator(".form-error")).toContainText("工号或密码不正确");
    await expect(page).toHaveURL(/\/login/);
  });

  test("注册后获得部门成员身份，可以登录并退出", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/register");
    const form = page.getByTestId("register-form");
    await form.locator('input[name="name"]').fill("测试成员");
    await form.locator('input[name="employeeId"]').fill("E2EUSER01");
    await form.locator('input[name="password"]').fill("StrongPass123");
    await form.locator('input[name="confirmPassword"]').fill("StrongPass123");
    await form.getByRole("button", { name: /注册并进入工作台/ }).click();
    await page.waitForURL("**/dashboard**");
    await expect(page.locator(".sidebar-user-name")).toContainText("测试成员");
    await expect(page.locator(".sidebar-user-role")).toContainText("部门成员");
    await expect(page.locator("h1")).toContainText("测试成员");

    await page.goto("/settings/areas");
    await expect(page).toHaveURL(/\/dashboard\?flash=/);
    await expect(page.locator(".flash")).toContainText("当前角色无权访问该页面");

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: /内部登录/ })).toBeVisible();

    await page.goto("/login");
    await page.locator('input[name="employeeId"]').fill("E2EUSER01");
    await page.locator('input[name="password"]').fill("StrongPass123");
    await page.getByRole("button", { name: /登录工作台/ }).click();
    await page.waitForURL("**/dashboard**");
    await expect(page.locator(".sidebar-user-name")).toContainText("测试成员");
  });

  test("内部账号登录后从公开首页可以进入工作台", async ({ page }) => {
    await login(page, "OWNER001");
    await page.goto("/");
    await expect(page.getByRole("link", { name: /进入工作台/ }).first()).toBeVisible();
    await page.getByRole("link", { name: /进入工作台/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("移动端工作台保留可见的退出登录入口", async ({ page }) => {
    await login(page, "MEMBER001");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
