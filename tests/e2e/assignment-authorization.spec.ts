import { expect, test, type Page } from "@playwright/test";
import { expectFlash, login } from "./helpers";

const n1Settings = "/settings/projects/1";

async function setN1Manager(admin: Page, assigned: boolean) {
  await admin.goto(n1Settings);
  await admin.getByTestId("edit-project-trigger").click();
  const form = admin.getByTestId("edit-project-form-1");
  const managers = form.getByRole("group", { name: /^软件经理/ });
  await managers.getByRole("searchbox").fill("TEST002");
  const candidate = managers.getByRole("checkbox", { name: /何欣/ });
  if ((await candidate.isChecked()) === assigned) return;
  await candidate.setChecked(assigned);
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(admin, "项目配置已更新");
}

test("普通账号可同时承担两个项目的不同分工，撤销指派后即时收回权限", async ({ browser, page }) => {
  await login(page, "ADMIN001");
  const context = await browser.newContext();
  const staff = await context.newPage();
  try {
    await login(staff, "TEST002");
    await expect(staff.locator(".sidebar-user-role")).toContainText("普通账号");
    await staff.goto("/integration/4?project=1");
    await expect(staff.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
    await staff.goto("/integration/5?project=2");
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toBeVisible();

    await setN1Manager(page, true);
    await staff.goto(n1Settings);
    await expect(staff.getByRole("heading", { name: "星云 N1", level: 1 })).toBeVisible();
    await staff.getByTestId("edit-project-trigger").click();
    const form = staff.getByTestId("edit-project-form-1");
    await expect(form.getByLabel("项目阶段", { exact: true })).toBeVisible();
    await expect(form.locator('input[name="softwareManagerIds"]')).toHaveCount(0);
    await form.getByRole("button", { name: "保存项目配置" }).click();
    await expectFlash(staff, "项目配置已更新");

    await staff.goto("/integration/4?project=1");
    await expect(staff.getByRole("heading", { level: 1, name: /B120/ })).toBeVisible();
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toHaveCount(0);
    await staff.goto("/integration/5?project=2");
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toBeVisible();

    await setN1Manager(page, false);
    await staff.goto("/integration/4?project=1");
    await expect(staff.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
    await staff.goto("/integration/5?project=2");
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toBeVisible();
  } finally {
    try {
      await setN1Manager(page, false);
    } finally {
      await context.close();
    }
  }
});

test("无项目分工的普通账号可以看项目目录，直接流程与抽屉链接仍按业务范围校验", async ({ page }) => {
  await login(page, "MEMBER001");
  await page.goto("/overview");
  await expect(page.getByRole("link", { name: /星云 N1/ })).toBeVisible();
  for (const path of ["/submissions?project=1", "/integration/4", "/trial/32?project=1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
  }
  expect((await page.request.get("/api/packages/1?project=1")).status()).toBe(404);
  await page.goto("/submissions/transfer?package=1");
  const guidance = page.getByRole("region", { name: "转测提交条件" });
  await expect(guidance).toContainText("软件包不可用");
  await expect(guidance).not.toContainText("系统底座");

  await login(page, "OWNER001");
  expect((await page.request.get("/api/packages/1?project=1")).status()).toBe(200);
  expect((await page.request.get("/api/packages/3?project=1")).status()).toBe(404);
});

test("共享转正确认同步范围，同时只展开有权项目的原始证据", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/formal?project=1&q=1004NET");
  await page.getByRole("link", { name: "核对并转正", exact: true }).click();
  const evidence = page.getByRole("region", { name: "项目验收与绑定证据" });
  for (const project of ["星云 N1", "极光 M2", "磐石 T3"]) {
    await expect(evidence.getByText(project, { exact: true })).toBeVisible();
  }
  await expect(evidence.getByRole("link", { name: "查看绑定验证记录" })).toHaveCount(1);
  await expect(evidence.getByRole("link", { name: "查看绑定验证记录" })).toHaveAttribute("href", /project=1/);
  await page.getByRole("button", { name: "发布正式版本", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /转正 1004NET/ })).toContainText("星云 N1、极光 M2、磐石 T3 将同步使用该正式版本");
});
