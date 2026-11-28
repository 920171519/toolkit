import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

async function holdNavigationResponse(page: Page, matches: (url: URL) => boolean) {
  const responseGate = Promise.withResolvers<void>();
  let requested = false;
  await page.route((url) => url.searchParams.has("_rsc") && matches(url), async (route) => {
    requested = true;
    await responseGate.promise;
    await route.continue();
  }, { times: 1 });
  return {
    waitForRequest: () => expect.poll(() => requested).toBe(true),
    release: () => responseGate.resolve(),
  };
}

test("侧栏切页等待时保留当前内容，只提示被选中的入口", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/overview");
  const sidebar = page.locator("aside.sidebar");
  const current = sidebar.getByRole("link", { name: "项目总览", exact: true });
  const destination = sidebar.getByRole("link", { name: "项目配置", exact: true });
  const main = page.getByRole("main");
  const request = await holdNavigationResponse(page, (url) => url.pathname === "/settings/projects");
  try {
    await destination.click();
    await request.waitForRequest();
    await expect(main.getByRole("heading", { name: "项目总览", level: 1 })).toBeVisible();
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(destination).not.toHaveAttribute("aria-current");
    const status = destination.locator("[data-navigation-pending]").and(destination.getByRole("status"));
    await expect(status).toHaveText("正在加载页面");
    await expect(sidebar.locator("[data-navigation-pending]")).toHaveCount(1);
  } finally {
    request.release();
  }
  await expect(main.getByRole("heading", { name: "项目与测试节点", level: 1 })).toBeVisible();
  await expect(destination).toHaveAttribute("aria-current", "page");
  await expect(current).not.toHaveAttribute("aria-current");
  await expect(sidebar.locator("[data-navigation-pending]")).toHaveCount(0);
});

test("从项目深链可返回上次的项目筛选，等待时显示反馈", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/projects/1");
  await page.evaluate(() => sessionStorage.setItem("toolkit.lastProjectCatalogView", "/overview?pageSize=10"));
  const back = page.locator(".topbar").getByRole("link", { name: "项目总览", exact: true });
  await expect(back).toHaveAttribute("href", "/overview");
  const request = await holdNavigationResponse(page, (url) => url.pathname === "/overview" && url.searchParams.get("pageSize") === "10");
  try {
    await back.press("Enter");
    await request.waitForRequest();
    await expect(page.getByRole("heading", { name: "星云 N1", level: 1 })).toBeVisible();
    await expect(back.getByRole("status")).toHaveText("正在加载页面");
  } finally {
    request.release();
  }
  await expect(page).toHaveURL(/\/overview\?pageSize=10$/);
  await expect(back).toHaveCount(0);
});

test("项目总览与独立项目工作区分别显示对应入口，流程保留项目范围", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/overview");
  const sidebar = page.locator("aside.sidebar");
  const sidebarDestinations = () => sidebar.locator("nav").getByRole("link").evaluateAll((links) => links.map((link) => [link.textContent?.trim(), link.getAttribute("href")]));
  const globalLinks = [
    ["我的工作台", "/dashboard"],
    ["项目总览", "/overview"],
    ["责任田", "/settings/areas"],
    ["项目配置", "/settings/projects"],
    ["软件包配置", "/settings/packages"],
    ["人员与角色", "/settings/users"],
  ];
  expect(await sidebarDestinations()).toEqual(globalLinks);
  await page.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const navigation = sidebar.getByRole("navigation", { name: "软件包流程" });
  const workflowLinks = [
    ["软件版本总览", "packages"],
    ["待转测申请", "submissions"],
    ["集成测试", "integration"],
    ["试制与绑定验证", "trial"],
    ["转正发布", "formal"],
    ["版本全链路", "versions"],
  ].map(([label, route]) => [label, `/${route}?project=${projectId}`]);
  expect(await sidebarDestinations()).toEqual(workflowLinks);

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
  await page.locator("main").getByRole("link", { name: /查看批次进展|处理测试批次/ }).click();
  await expect(page).toHaveURL(new RegExp(`/integration/\\d+\\?project=${projectId}$`));
  await page.getByRole("link", { name: "返回在测批次" }).click();
  await expect(page).toHaveURL(new RegExp(`/integration\\?project=${projectId}$`));

  await navigation.getByRole("link", { name: "试制与绑定验证" }).click();
  await expect(page).toHaveURL(new RegExp(`/trial\\?project=${projectId}$`));
  await navigation.getByRole("link", { name: "转正发布" }).click();
  await expect(page).toHaveURL(new RegExp(`/formal\\?project=${projectId}$`));

  await page.locator(".topbar").getByRole("link", { name: "项目总览" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(navigation).toHaveCount(0);
  expect(await sidebarDestinations()).toEqual(globalLinks);
  await page.goBack();
  await expect(navigation).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/formal\\?project=${projectId}$`));
  expect(await sidebarDestinations()).toEqual(workflowLinks);
});

test("可按列筛选版本全链路，项目追溯按项目范围展示证据", async ({ page }) => {
  async function filterVersionTrace() {
    await page.getByRole("button", { name: "筛选软件包", exact: true }).click();
    const packages = page.getByRole("dialog", { name: "筛选软件包", exact: true });
    await packages.getByRole("textbox", { name: "软件包名称或编码" }).fill("1001OTA");
    await packages.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("f_package") === "1001OTA");
    await page.getByRole("button", { name: "筛选版本", exact: true }).click();
    const version = page.getByRole("dialog", { name: "筛选版本", exact: true });
    await version.getByRole("textbox", { name: "版本号" }).fill("1.6.0");
    await version.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
  }

  await login(page, "ADMIN001");
  await page.goto("/packages");
  await page.locator("main").getByRole("link", { name: "版本全链路", exact: true }).click();
  await expect(page).toHaveURL(/\/versions$/);
  await filterVersionTrace();
  await page.getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(page.locator("main").getByRole("link", { name: "星云 N1" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "极光 M2" })).toBeVisible();

  await page.locator("main").getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/\d+$/);
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const navigation = page.locator("aside.sidebar").getByRole("navigation", { name: "软件包流程" });
  await navigation.getByRole("link", { name: "版本全链路" }).click();
  await filterVersionTrace();
  await page.getByRole("link", { name: "全链路追溯", exact: true }).click();
  await expect(page).toHaveURL((url) => /^\/versions\/\d+$/.test(url.pathname) && url.searchParams.get("project") === projectId);
  await expect(page.locator("main").getByRole("link", { name: "极光 M2", exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("星云 N1", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "返回版本列表" }).click();
  await expect(page).toHaveURL((url) =>
    url.pathname === "/versions" &&
    url.searchParams.get("project") === projectId &&
    url.searchParams.get("f_package") === "1001OTA" &&
    url.searchParams.get("f_version") === "1.6.0",
  );

  await login(page, "MGR001");
  await page.goto(`/versions?project=${projectId}`);
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});

test("登录后可看全部项目、按阶段筛选，未分配项目只展示基本资料", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/overview");
  const list = page.getByRole("region", { name: "项目列表", exact: true });
  const stageFilter = list.getByRole("button", { name: "筛选产品阶段", exact: true });
  await expect(stageFilter).toBeVisible();
  await expect(list.getByRole("columnheader", { name: "状态", exact: true })).toHaveCount(0);
  await expect(list.locator(".project-overview-name")).toHaveText(["星云 N1", "极光 M2", "磐石 T3", "远山 X0"]);
  await list.getByRole("combobox", { name: "每页条数", exact: true }).selectOption("10");
  await expect(page).toHaveURL(/pageSize=10/);
  await stageFilter.click();
  await page.getByRole("checkbox", { name: "已结束", exact: true }).check();
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(list.locator(".project-overview-row")).toHaveCount(1);
  await expect(list.locator(".project-overview-row")).toContainText("远山 X0");
  await expect(list.locator(".project-overview-row")).toContainText("已结束");
  await list.getByRole("link", { name: "清除全部筛选", exact: true }).click();
  await expect(list.getByRole("combobox", { name: "每页条数", exact: true })).toHaveValue("10");
  await list.getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "项目访问范围" })).toContainText("项目流程需要分配权限");
  await expect(page.locator("aside.sidebar nav a")).toHaveCount(0);
  await expect(page.locator("#packages")).toHaveCount(0);
  await expect(page.locator("#batches")).toHaveCount(0);
  await page.goto("/integration?project=2");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
});

test("项目列筛选可组合多位 PM，并从项目详情恢复列表条件", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/overview?stage=TR1&pageSize=10");
  const list = page.getByRole("region", { name: "项目列表", exact: true });
  const projects = list.locator(".project-overview-name");
  const apply = page.getByRole("button", { name: "应用", exact: true });
  const projectFilter = list.getByRole("button", { name: "筛选项目", exact: true });
  const projectCode = page.getByRole("textbox", { name: "项目编码", exact: true });

  await list.getByRole("button", { name: /^筛选\s*PM$/ }).click();
  await page.getByRole("checkbox", { name: "王磊", exact: true }).check();
  await page.getByRole("checkbox", { name: "陈曦", exact: true }).check();
  await apply.click();
  await expect(projects).toHaveText(["星云 N1", "极光 M2"]);
  await expect(page).toHaveURL(/f_stage=TR1/);

  await projectFilter.click();
  await projectCode.fill("M2");
  await apply.click();
  await expect(projects).toHaveText(["极光 M2"]);
  const overviewParams = new URL(page.url()).searchParams;
  overviewParams.sort();
  await projects.first().click();
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toBeVisible();
  const projectMenu = page.locator("aside.sidebar").getByRole("navigation", { name: "软件包流程" });
  const packagesHref = await projectMenu.getByRole("link", { name: "软件版本总览" }).getAttribute("href");
  const packagesUrl = new URL(packagesHref ?? "", page.url());
  expect(packagesUrl.pathname).toBe("/packages");
  expect(packagesUrl.searchParams.get("project")).toBe("2");
  expect(packagesUrl.searchParams.get("returnTo")).toContain("f_pm=");
  await page.locator(".topbar").getByRole("link", { name: "项目总览", exact: true }).click();
  await expect(page).toHaveURL((url) => {
    url.searchParams.sort();
    return url.pathname === "/overview" && url.searchParams.toString() === overviewParams.toString();
  });
  await expect(projects).toHaveText(["极光 M2"]);

  await projectFilter.click();
  await projectCode.fill("no-matching-project");
  await apply.click();
  await expect(list.getByText("没有匹配的项目", { exact: true })).toBeVisible();
  await expect(projectFilter).toBeVisible();
  await projectFilter.click();
  await page.getByRole("link", { name: "清除本列", exact: true }).click();
  await expect(projects).toHaveText(["星云 N1", "极光 M2"]);
  await expect(list.getByRole("combobox", { name: "每页条数" })).toHaveValue("10");

  const crafted = new URLSearchParams({ returnTo: "/overview?f_stage=TR1&f_unknown=1&project=4&flash=notice" });
  await page.goto(`/projects/2?${crafted}`);
  const back = page.locator(".topbar").getByRole("link", { name: "项目总览", exact: true });
  await expect(back).toHaveAttribute("href", "/overview?f_stage=TR1");
  await page.goto(`/projects/2?${new URLSearchParams({ returnTo: "//example.invalid/overview?f_stage=TR1" })}`);
  await expect(back).toHaveAttribute("href", "/overview");
});

test("项目经理在配置中保存本项目阶段，项目总览按该阶段筛选", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/settings/projects");
  await expect(page.getByRole("heading", { name: "极光 M2", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "配置星云 N1", exact: true }).click();
  await page.getByTestId("edit-project-trigger").click();
  const form = page.getByTestId("edit-project-form-1");
  await form.getByRole("combobox", { name: "项目阶段", exact: true }).selectOption("TR4");
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expect(page.getByText("项目配置已更新。")).toBeVisible();
  await page.goto("/overview?stage=TR4");
  await expect(page.locator(".project-overview-name")).toHaveText(["星云 N1"]);
  await page.goto("/settings/projects/1");
  await page.getByTestId("edit-project-trigger").click();
  await expect(form.locator("select[name=status]")).toHaveValue("ACTIVE");
  await form.getByRole("combobox", { name: "项目阶段", exact: true }).selectOption("TR1");
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expect(page.getByText("项目配置已更新。")).toBeVisible();
});

test("窄屏菜单随项目切换，支持键盘操作和返回项目总览", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/overview");
  await page.locator("main").getByRole("link", { name: "极光 M2", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/2$/);
  const menu = page.locator(".workspace-mobile-menu");
  const menuButton = menu.getByLabel("主导航", { exact: true });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("link", { name: "我的工作台" })).toHaveCount(0);
  await expect(menu.getByRole("link")).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(menuButton).toBeFocused();
  await expect(menu).not.toHaveAttribute("open", "");
  await menuButton.click();
  const request = await holdNavigationResponse(page, (url) => url.pathname === "/packages" && url.searchParams.get("project") === "2");
  const menuSpinnerVisible = () => menuButton.evaluate((button) => {
    const styles = getComputedStyle(button, "::after");
    return styles.content !== "none" && styles.opacity === "1";
  });
  try {
    await menu.getByRole("link", { name: "软件版本总览" }).click();
    await request.waitForRequest();
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(menuButton).toBeFocused();
    await expect(page.getByRole("heading", { name: "极光 M2", level: 1 })).toBeVisible();
    await expect(page.locator(".workspace-navigation").getByRole("status").filter({ hasText: "正在加载页面" })).toHaveCount(1);
    await expect.poll(menuSpinnerVisible).toBe(true);
  } finally {
    request.release();
  }
  await expect(page).toHaveURL(/\/packages\?project=2$/);
  await expect.poll(menuSpinnerVisible).toBe(false);
  await expect(page.locator(".workspace-navigation").getByRole("status").filter({ hasText: "正在加载页面" })).toHaveCount(0);
  await expect(menu).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator(".topbar").getByRole("link", { name: "项目总览" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(menu).not.toHaveAttribute("open", "");
  await menuButton.click();
  await expect(menu.getByRole("link", { name: "项目总览" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "集成测试" })).toHaveCount(0);
});

test("软件包空结果仍可清除筛选，关闭详情会回到同一列表", async ({ page }) => {
  await login(page, "OWNER001");
  await page.goto("/packages?project=1");
  const search = page.getByRole("searchbox", { name: "搜索软件包" });
  await search.fill("查无此包");
  await expect(page.getByRole("heading", { name: "没有匹配的软件包" })).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(search).toHaveValue("");
  await page.getByRole("combobox", { name: "每页行数" }).selectOption("10");
  await expect(page).toHaveURL(/pageSize=10$/);
  await search.fill("1001OTA");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  const details = page.getByRole("link", { name: "查看 1001OTA 详情" });
  await details.click();
  await expect(page.getByRole("dialog", { name: "软件包详情" })).toBeVisible();
  await expect(page.getByTestId("package-drawer")).toContainText("1001OTA");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "软件包详情" })).toHaveCount(0);
  await expect(search).toHaveValue("1001OTA");
  await expect(details).toBeFocused();
  await expect(page).toHaveURL(/\/packages\?project=1&pageSize=10&q=1001OTA$/);
});

test("项目详情保留历史数字链接，草稿参数只接受未补零十进制", async ({ page }) => {
  await login(page, "ADMIN001");
  const database = openE2eDatabase({ readOnly: true });
  let projectId: number;
  let batchId: number;
  try {
    const project = database.prepare("SELECT id FROM projects WHERE code = 'N1'").get() as { id: number };
    projectId = project.id;
    const batch = database.prepare("SELECT id FROM integration_batches WHERE project_id = ? AND code = 'B119'").get(projectId) as { id: number };
    batchId = batch.id;
  } finally {
    database.close();
  }

  for (const id of [String(projectId), `0${projectId}`]) {
    const response = await page.goto(`/projects/${id}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "星云 N1", exact: true })).toBeVisible();
  }
  for (const id of [`${projectId}e0`, "9007199254740992"]) {
    const invalid = await page.goto(`/projects/${id}`);
    expect(invalid?.status()).toBe(404);
  }
  const settings = await page.goto(`/settings/projects/${projectId}e0`);
  expect(settings?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "星云 N1", exact: true })).toBeVisible();

  await page.goto(`/submissions/batch/new?project=${projectId}&draft=${batchId}`);
  await expect(page).toHaveURL((url) => url.pathname === `/integration/${batchId}`);
  await expect(page.getByRole("heading", { name: /B119/, level: 1 })).toBeVisible();
  for (const draft of [`0${batchId}`, `${batchId}e0`]) {
    await page.goto(`/submissions/batch/new?project=${projectId}&draft=${draft}`);
    await expect(page.getByRole("heading", { name: "草稿当前不可用", exact: true })).toBeVisible();
  }
});
