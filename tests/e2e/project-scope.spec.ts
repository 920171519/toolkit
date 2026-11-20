import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("项目总览和项目工作区分别显示对应侧栏，退出和返回保留正确范围", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/overview");
  const sidebar = page.locator("aside.sidebar");
  const mainMenu = ["我的工作台", "项目总览", "责任田", "项目配置", "软件包配置", "人员与角色"];
  const projectMenu = ["软件版本总览", "待转测申请", "集成测试", "试制与绑定验证", "转正发布", "版本全链路"];
  await expect(sidebar.locator("nav a")).toHaveText(mainMenu);
  await page.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const navigation = page.getByRole("navigation", { name: "极光 M2 · 项目流程" });
  const projectNavigation = page.getByRole("navigation", { name: "项目导航", exact: true });
  await expect(projectNavigation.locator("strong")).toHaveText("极光 M2");
  await expect(sidebar.locator("nav a")).toHaveText(projectMenu);

  await navigation.getByRole("link", { name: "软件版本总览" }).click();
  await expect(page).toHaveURL(new RegExp(`/packages\\?project=${projectId}$`));
  await expect(page.getByText("1002CFG", { exact: true })).toHaveCount(0);
  await expect(page.locator("tbody").getByText("星云 N1", { exact: true }).first()).toBeVisible();

  await navigation.getByRole("link", { name: "待转测申请" }).click();
  await expect(page).toHaveURL(new RegExp(`/submissions\\?project=${projectId}$`));
  await expect(page.locator(".project-request-group").filter({ hasText: "星云 N1" })).toHaveCount(0);

  await navigation.getByRole("link", { name: "集成测试" }).click();
  await expect(page.getByText("B121", { exact: true })).toBeVisible();
  await expect(page.getByText("B120", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "查看批次并提交测试结论" }).click();
  await expect(page).toHaveURL(new RegExp(`/integration/\\d+\\?project=${projectId}$`));
  await page.getByRole("link", { name: "返回列表" }).click();
  await expect(page).toHaveURL(new RegExp(`/integration\\?project=${projectId}$`));

  await navigation.getByRole("link", { name: "试制与绑定验证" }).click();
  await expect(page).toHaveURL(new RegExp(`/trial\\?project=${projectId}$`));
  await navigation.getByRole("link", { name: "转正发布" }).click();
  await expect(page).toHaveURL(new RegExp(`/formal\\?project=${projectId}$`));

  await expect(sidebar.locator("nav a")).toHaveText(projectMenu);
  await expect(projectNavigation.getByRole("link", { name: "极光 M2" })).toHaveAttribute("href", "/projects/" + projectId);
  await projectNavigation.getByRole("link", { name: "返回项目总览", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(sidebar.locator("nav a")).toHaveText(mainMenu);
  await page.goBack();
  await expect(page).toHaveURL(/\/formal\?project=2$/);
  await expect(sidebar.locator("nav a")).toHaveText(projectMenu);
});

test("可直接搜索版本全链路，项目追溯按项目范围展示证据", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/packages");
  await page.locator("main").getByRole("link", { name: "版本全链路", exact: true }).click();
  await expect(page).toHaveURL(/\/versions$/);
  await page.getByRole("textbox", { name: "软件包或版本" }).fill("1001OTA 1.6.0");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(page.locator("main").getByRole("link", { name: "星云 N1" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "极光 M2" })).toBeVisible();

  await page.locator("main").getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/\d+$/);
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const navigation = page.getByRole("navigation", { name: "极光 M2 · 项目流程" });
  await navigation.getByRole("link", { name: "版本全链路" }).click();
  await page.getByRole("textbox", { name: "软件包或版本" }).fill("1001OTA 1.6.0");
  await page.getByRole("button", { name: "搜索" }).click();
  await page.getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/versions/\\d+\\?project=${projectId}$`));
  await expect(page.locator("main").getByRole("link", { name: "极光 M2", exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("星云 N1", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "返回版本列表" }).click();
  await expect(page).toHaveURL(new RegExp(`/versions\\?project=${projectId}$`));

  await login(page, "MGR001");
  await page.goto(`/versions?project=${projectId}`);
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});

test("登录后可看全部项目、按阶段筛选，未分配项目只展示基本资料", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/overview");
  const list = page.getByRole("region", { name: "项目列表", exact: true });
  await expect(list.getByRole("columnheader", { name: "阶段", exact: true })).toBeVisible();
  await expect(list.getByRole("columnheader", { name: "状态", exact: true })).toHaveCount(0);
  await expect(list.locator(".project-overview-name")).toHaveText(["星云 N1", "极光 M2", "磐石 T3", "远山 X0"]);
  await list.getByRole("combobox", { name: "项目阶段", exact: true }).selectOption("ENDED");
  await list.getByRole("combobox", { name: "每页条数", exact: true }).selectOption("10");
  await list.getByRole("button", { name: "查询", exact: true }).click();
  await expect(list.locator(".project-overview-row")).toHaveCount(1);
  await expect(list.locator(".project-overview-row")).toContainText("远山 X0");
  await expect(list.locator(".project-overview-row")).toContainText("已结束");
  await list.getByRole("link", { name: "清除筛选", exact: true }).click();
  await expect(list.getByRole("combobox", { name: "每页条数", exact: true })).toHaveValue("10");
  await list.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "项目基本资料" })).toContainText("需要项目流程权限");
  await expect(page.locator("aside.sidebar nav a")).toHaveCount(0);
  await expect(page.locator("#packages")).toHaveCount(0);
  await expect(page.locator("#batches")).toHaveCount(0);
  await page.goto("/integration?project=2");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});

test("项目经理在配置中保存本项目阶段，项目总览按该阶段筛选", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/settings/projects");
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toHaveCount(0);
  const card = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "星云 N1", exact: true }) });
  await card.getByText("编辑项目", { exact: true }).click();
  const form = card.getByTestId("edit-project-form-1");
  await form.getByRole("combobox", { name: "项目阶段", exact: true }).selectOption("TR4");
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expect(page.getByText("项目配置已更新。")).toBeVisible();
  await page.goto("/overview?stage=TR4");
  await expect(page.locator(".project-overview-name")).toHaveText(["星云 N1"]);
  await page.goto("/settings/projects");
  await card.getByText("编辑项目", { exact: true }).click();
  await expect(form.locator("select[name=status]")).toHaveValue("ACTIVE");
  await form.getByRole("combobox", { name: "项目阶段", exact: true }).selectOption("TR1");
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expect(page.getByText("项目配置已更新。")).toBeVisible();
});

test("窄屏可进入项目流程并从顶部返回全部项目", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/overview");
  await page.getByRole("link", { name: "星云 N1", exact: true }).click();
  const projectMenu = page.getByRole("navigation", { name: "星云 N1 · 项目流程" });
  await expect(projectMenu.getByRole("link")).toHaveCount(6);
  await projectMenu.getByRole("link", { name: "集成测试", exact: true }).click();
  await expect(page).toHaveURL(/\/integration\?project=1$/);
  await expect(page.locator(".project-breadcrumb-name")).toHaveText("星云 N1");
  await page.getByRole("link", { name: "返回项目总览", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
