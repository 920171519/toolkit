import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("项目总览按联系人和产品阶段筛选，并保留每页条数", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/overview?q=m2+mgr002");
  const catalog = page.getByRole("region", { name: "项目列表", exact: true });
  const searchChip = catalog.getByRole("link", { name: "清除搜索条件 m2 mgr002" });
  const stage = catalog.getByRole("button", { name: "筛选产品阶段", exact: true });
  const stageMenu = page.getByRole("dialog", { name: "筛选产品阶段", exact: true });
  const pageSize = catalog.getByRole("combobox", { name: "每页条数" });

  await pageSize.selectOption("10");
  await expect(page).toHaveURL(/pageSize=10/);
  await stage.click();
  await stageMenu.getByRole("checkbox", { name: "TR1", exact: true }).check();
  await stageMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "m2 mgr002" && url.searchParams.get("f_stage") === "TR1" && url.searchParams.get("pageSize") === "10");
  await expect(catalog.getByRole("link", { name: "极光 M2", exact: true })).toBeVisible();
  await expect(catalog.getByRole("link", { name: "星云 N1", exact: true })).toHaveCount(0);

  await stage.click();
  await stageMenu.getByRole("checkbox", { name: "TR1", exact: true }).uncheck();
  await stageMenu.getByRole("checkbox", { name: "已结束", exact: true }).check();
  await stageMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(searchChip).toBeVisible();
  await expect(catalog.getByRole("heading", { name: "没有匹配的项目" })).toBeVisible();
  await catalog.getByRole("link", { name: "清除全部筛选" }).click();
  await expect(searchChip).toHaveCount(0);
  await expect(stage).toHaveAttribute("aria-label", "筛选产品阶段");
  await expect(pageSize).toHaveValue("10");

  await page.goto("/projects?status=ARCHIVED&pageSize=10");
  await expect(page).toHaveURL(/\/overview\?pageSize=10&stage=ENDED$/);
  await stage.click();
  await expect(stageMenu.getByRole("checkbox", { name: "已结束", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(catalog.getByRole("link", { name: "星云 N1", exact: true })).toHaveCount(0);
  await catalog.getByRole("link", { name: "远山 X0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "远山 X0", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "当前流程" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "软件包与全局使用范围", exact: true })).toContainText("1001OTA");
});

test("窄屏打开无流程权限的项目后可以返回筛选结果", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "MGR001");
  await page.goto("/overview?q=M2&stage=TR1&pageSize=10");
  const catalog = page.getByRole("region", { name: "项目列表", exact: true });
  await catalog.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/2\?returnTo=/);
  const returnTo = new URL(new URL(page.url()).searchParams.get("returnTo") ?? "", page.url());
  expect(returnTo.pathname).toBe("/overview");
  expect(returnTo.searchParams.get("q")).toBe("M2");
  expect(returnTo.searchParams.get("f_stage")).toBe("TR1");
  expect(returnTo.searchParams.get("pageSize")).toBe("10");
  await page.locator("main").getByRole("link", { name: "返回项目总览" }).click();
  await expect(catalog.getByRole("link", { name: "清除搜索条件 M2" })).toBeVisible();
  await expect(catalog.getByRole("combobox", { name: "每页条数" })).toHaveValue("10");
  await catalog.getByRole("button", { name: "筛选产品阶段", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "筛选产品阶段", exact: true }).getByRole("checkbox", { name: "TR1", exact: true })).toBeChecked();
});

test("项目目录展示所有项目，未获分配的项目仅提供基本信息", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/overview");
  const catalog = page.getByRole("region", { name: "项目列表", exact: true });
  const n1 = catalog.getByRole("row").filter({ hasText: "星云 N1" });
  const m2 = catalog.getByRole("row").filter({ hasText: "极光 M2" });
  await expect(n1).toBeVisible();
  await expect(m2).toContainText("仅基本资料");
  await expect(catalog.getByRole("link", { name: "磐石 T3", exact: true })).toBeVisible();
  await expect(catalog.getByRole("link", { name: "远山 X0", exact: true })).toBeVisible();
  await m2.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/2$/);
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目流程需要分配权限" })).toBeVisible();
  await expect(page.getByRole("region", { name: "当前流程" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "软件包与全局使用范围" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("link", { name: /返回项目总览/ })).toHaveAttribute("href", "/overview");
  await page.goto("/submissions?project=2");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});

test("授权项目的流程入口保留项目范围，试制内容按角色显示", async ({ page }) => {
  await login(page, "VALID001");
  await page.goto("/overview");
  const catalog = page.getByRole("region", { name: "项目列表", exact: true });
  await catalog.getByRole("link", { name: "星云 N1", exact: true }).click();
  const workflow = page.getByRole("region", { name: "当前流程", exact: true });
  const binding = workflow.getByRole("link", { name: /节点绑定/ });
  await expect(workflow.getByRole("link", { name: /待发布试制/ })).toHaveCount(0);
  await expect(binding).toHaveAttribute("href", "/trial?project=1&view=binding");
  await expect(workflow.getByRole("link", { name: /集成测试/ })).toHaveAttribute("href", "/integration?project=1");
  await expect(workflow.getByRole("link", { name: /转正/ })).toHaveAttribute("href", "/formal?project=1");
});
