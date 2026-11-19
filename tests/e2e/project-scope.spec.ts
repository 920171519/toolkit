import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("进入部门总览项目后，业务入口继续使用项目范围，基础配置保留全局路径", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/overview");
  await page.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const navigation = page.getByRole("navigation", { name: "极光 M2 · 项目流程" });

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

  const configuration = page.getByRole("navigation", { name: "基础配置" });
  await expect(configuration.getByRole("link", { name: "责任田" })).toHaveAttribute("href", "/settings/areas");
  await expect(configuration.getByRole("link", { name: "项目配置" })).toHaveAttribute("href", "/settings/projects");
  await expect(configuration.getByRole("link", { name: "软件包配置" })).toHaveAttribute("href", "/settings/packages");
  await expect(configuration.getByRole("link", { name: "人员与角色" })).toHaveAttribute("href", "/settings/users");
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
