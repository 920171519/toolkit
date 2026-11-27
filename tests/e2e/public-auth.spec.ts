import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("公开项目联系人与账号", () => {
  test("未登录可以访问公开首页，只展示项目 PM 与软件经理", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".public-header .brand-sub")).toHaveText("软件工程部");
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
    await expect(page.getByLabel("工号", { exact: true })).toHaveValue("MGR001");
    await expect(page).toHaveURL(/\/login/);
  });

  test("窄屏可按项目代号和工号查找，登录表单支持键盘操作", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "搜索项目联系人" });
    await search.fill("ｍ２ mgr002");
    await expect(page.getByRole("status")).toContainText("1 个项目");
    await expect(page.getByRole("heading", { name: "极光 M2" })).toBeVisible();
    await page.getByRole("button", { name: "清除搜索" }).click();
    await expect(search).toBeFocused();
    await expect(page.getByRole("status")).toContainText("3 个项目");
    await page.getByRole("link", { name: "内部登录" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "登录", exact: true })).toBeVisible();
    const password = page.getByLabel("密码", { exact: true });
    await password.fill("Demo@1234");
    await password.press("Tab");
    await expect(page.getByRole("button", { name: "显示密码" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("link", { name: "项目联系人", exact: true }).click();
    await expect(search).toBeVisible();
  });

  test("注册后获得普通账号身份，可以登录并退出", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/register");
    const help = page.getByRole("button", { name: "账号权限说明" });
    const tooltip = page.getByRole("tooltip");
    await page.getByRole("link", { name: "项目联系人", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(help).toBeFocused();
    await expect(tooltip).toContainText("新账号默认为普通账号");
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(help).toBeFocused();
    const form = page.getByTestId("register-form");
    await form.locator('input[name="name"]').fill("测试成员");
    await form.locator('input[name="employeeId"]').fill("E2EUSER01");
    await form.locator('input[name="password"]').fill("StrongPass123");
    await form.locator('input[name="confirmPassword"]').fill("Different123");
    await form.getByRole("button", { name: /注册并进入工作台/ }).click();
    await expect(form.getByLabel("确认密码", { exact: true })).toHaveAccessibleDescription("两次输入的密码不一致。");
    await expect(form.getByLabel("姓名", { exact: true })).toHaveValue("测试成员");
    await expect(form.getByLabel("工号", { exact: true })).toHaveValue("E2EUSER01");
    await form.locator('input[name="password"]').fill("StrongPass123");
    await form.locator('input[name="confirmPassword"]').fill("StrongPass123");
    await form.getByRole("button", { name: /注册并进入工作台/ }).click();
    await page.waitForURL("**/dashboard**");
    await expect(page.locator(".sidebar-user-name")).toContainText("测试成员");
    await expect(page.locator(".sidebar-user-role")).toContainText("普通账号");
    await expect(page.getByRole("heading", { name: "我的工作台" })).toBeVisible();
    await expect(page.locator("main")).toContainText("测试成员");

    const transferEntry = page.getByRole("link", { name: "提交转测申请", exact: true });
    await transferEntry.click();
    const transferConditions = page.getByRole("dialog", { name: "提交转测条件", exact: true });
    await expect(transferConditions).toContainText("账号尚未分配责任田职责");
    await expect(transferConditions.getByRole("link", { name: "查看责任田分工" })).toHaveAttribute("href", "/settings/areas");
    await page.keyboard.press("Escape");
    await expect(transferEntry).toBeFocused();
    await page.goto("/settings/users");
    await expect(page.locator(".flash")).toHaveAttribute("data-tone", "error");
    await expect(page.locator(".flash")).toContainText("请联系系统管理员核对权限");

    await page.goto("/settings/areas");
    await expect(page).toHaveURL(/\/settings\/areas/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("责任田配置");
    await expect(page.getByTestId("new-area-trigger")).toHaveCount(0);

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

  test("登录后品牌副标题显示当前账号的责任田，切换项目不改变", async ({ page }) => {
    const subtitle = page.locator(".sidebar .brand-sub");
    await login(page, "OWNER001");
    await expect(subtitle).toHaveText("安全可信、系统底座");
    await expect(subtitle).toHaveAttribute("title", "安全可信、系统底座");
    await page.goto("/projects/1");
    await expect(subtitle).toHaveText("安全可信、系统底座");
    await page.goto("/");
    await expect(page.locator(".public-header .brand-sub")).toHaveText("安全可信、系统底座");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".public-header .brand-sub")).toBeVisible();
    await page.goto("/dashboard");
    const menu = page.locator(".workspace-mobile-menu");
    await menu.locator("summary").click();
    await expect(menu.locator(".workspace-mobile-area")).toHaveText("安全可信、系统底座");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await login(page, "VALID001");
    await expect(subtitle).toHaveText("系统底座");
    await login(page, "MGR001");
    await expect(subtitle).toHaveText("未分配责任田");
  });

  test("桌面侧栏在一行内完整显示角色和账号编号", async ({ page }) => {
    await login(page, "OWNER001");
    const account = page.locator(".sidebar-user-role");
    await expect(account).toContainText(" · OWNER001");
    await page.evaluate(() => document.fonts.ready);

    for (const width of [1440, 901]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await account.evaluate((element) => {
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
        return {
          singleLine: element.getBoundingClientRect().height <= lineHeight,
          fullyVisible: element.scrollWidth <= element.clientWidth,
        };
      });
      expect(layout, `${width}px`).toEqual({ singleLine: true, fullyVisible: true });
    }
  });

  test("移动端工作台保留可见的退出登录入口", async ({ page }) => {
    await login(page, "MEMBER001");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("登录后回到原项目筛选页面", async ({ page }) => {
    await page.goto("/versions?project=1&q=1001OTA");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.locator('input[name="employeeId"]').fill("MGR001");
    await page.locator('input[name="password"]').fill("Demo@1234");
    await page.getByRole("button", { name: "登录并继续", exact: true }).click();
    await expect(page).toHaveURL(/\/versions\?project=1&q=1001OTA$/);
    await expect(page.getByRole("searchbox", { name: "软件包或版本" })).toHaveValue("1001OTA");
  });

  test("登录后可继续前往多级详情和独立账号页面", async ({ page }) => {
    const destinations = [
      { path: "/settings/projects/1/nodes/1?listQ=N1&listPage=2", heading: "配置节点 EVT" },
      { path: "/account/password", heading: "修改密码" },
    ];
    for (const { path, heading } of destinations) {
      await page.context().clearCookies();
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      await page.locator('input[name="employeeId"]').fill("MGR001");
      await page.locator('input[name="password"]').fill("Demo@1234");
      await page.getByRole("button", { name: "登录并继续", exact: true }).click();
      await expect(page).toHaveURL(new URL(path, page.url()).href);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
  });
});
