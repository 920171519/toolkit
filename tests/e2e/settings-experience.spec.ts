import { expect, test } from "@playwright/test";
import { confirmAction, expectFlash, login } from "./helpers";

test("设置页的角色权限和项目删除可用鼠标与键盘展开", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/users");
  const roles = page.locator("summary").filter({ hasText: "角色权限说明" });
  const permissions = roles.locator("..").locator("dl");
  const indicator = roles.locator('svg[aria-hidden="true"]');
  await expect(roles).toHaveCSS("cursor", "pointer", { timeout: 2_000 });
  await expect(indicator).toBeVisible();
  const collapsedIcon = await indicator.evaluate((icon) => getComputedStyle(icon).transform);
  await expect(permissions).toBeHidden();
  await roles.click();
  await expect(permissions.getByText("系统管理员", { exact: true })).toBeVisible();
  await expect(indicator).not.toHaveCSS("transform", collapsedIcon);
  await roles.press("Enter");
  await expect(permissions).toBeHidden();
  await expect(roles).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/projects/1");
  const deletion = page.locator("summary").filter({ hasText: "项目删除" });
  const deleteButton = page.getByRole("button", { name: "删除项目", exact: true });
  await expect(deletion).toHaveCSS("cursor", "pointer");
  await expect(deletion.locator('svg[aria-hidden="true"]')).toBeVisible();
  await expect(deleteButton).toBeHidden();
  await deletion.press("Space");
  await expect(deleteButton).toBeVisible();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.press("Enter");
  const blockers = page.getByRole("dialog", { name: "删除项目" });
  await expect(blockers.getByRole("link", { name: "前往项目资料" })).toHaveAttribute("href", "/settings/projects/1?edit=project#project-profile");
  await expect(blockers.getByRole("link", { name: "查看使用范围" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deleteButton).toBeFocused();
  await deletion.press("Enter");
  await expect(deleteButton).toBeHidden();
  await expect(deletion).toBeFocused();
});

test("项目配置列出负责的项目，并保留归档配置入口", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/settings/projects");
  await expect(page.getByRole("row", { name: /星云 N1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /远山 X0/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /极光 M2/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /磐石 T3/ })).toHaveCount(0);
  await page.goto("/settings/projects/2");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
  await expect(page.getByTestId("edit-project-form-2")).toHaveCount(0);

  await page.goto("/settings/projects");
  await page.getByLabel("流程状态").selectOption("ARCHIVED");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByRole("row", { name: /星云 N1/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /远山 X0/ }).getByRole("cell", { name: "已结束", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "配置远山 X0" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "远山 X0" })).toBeVisible();
  await page.getByTestId("edit-project-trigger").click();
  await expect(page.getByTestId("edit-project-form-4")).toBeVisible();
});

test("新建项目校验失败后保留录入并可补齐重试", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/projects");
  await page.getByTestId("new-project-trigger").click();
  const form = page.getByTestId("new-project-form");
  const name = form.getByLabel("项目名称");
  const code = form.getByLabel("项目编码");
  const stage = form.getByLabel("项目阶段", { exact: true });
  const description = form.getByLabel("项目说明");
  const pm = form.getByRole("group", { name: /^PM/ }).getByRole("checkbox", { name: /王磊/ });
  const manager = form.getByRole("group", { name: /^软件经理/ }).getByRole("checkbox", { name: /林澈/ });
  const submit = form.getByRole("button", { name: "创建项目" });
  await name.fill("保留录入验收项目");
  await code.fill("DRAFTQA");
  await stage.selectOption("TR4");
  await description.fill("保留已填写的项目说明");
  await pm.check();

  await submit.click();
  await expect(form.getByRole("alert")).toContainText("请至少为项目指定一位软件经理。");
  await expect(name).toHaveValue("保留录入验收项目", { timeout: 2_000 });
  await expect(code).toHaveValue("DRAFTQA");
  await expect(stage).toHaveValue("TR4");
  await expect(description).toHaveValue("保留已填写的项目说明");
  await expect(pm).toBeChecked();

  await manager.check();
  await code.fill("N1");
  await submit.click();
  await expect(form.getByRole("alert")).toContainText("项目编码已存在。");
  await expect(code).toHaveValue("N1");
  await expect(pm).toBeChecked();
  await expect(manager).toBeChecked();

  await code.fill("DRAFTQA");
  await submit.click();
  await expect(page).toHaveURL(/\/settings\/projects\/\d+/);
  await expectFlash(page, "项目已创建");
  await expect(page.getByRole("heading", { level: 1, name: "保留录入验收项目" })).toBeVisible();
  await expect(page.getByText("保留已填写的项目说明", { exact: true })).toBeVisible();
  await expect(page.getByText("TR4", { exact: true })).toBeVisible();
  await expect(page.getByText("王磊", { exact: true })).toBeVisible();
  await expect(page.getByText("林澈", { exact: true })).toBeVisible();
  await page.goto("/settings/projects");
  await expect(page.getByRole("row", { name: /保留录入验收项目/ })).toHaveCount(1);
});

test("项目阶段可在新建和编辑时保存，独立于流程状态", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/projects");
  await page.getByTestId("new-project-trigger").click();
  const form = page.getByTestId("new-project-form");
  await form.getByLabel("项目名称").fill("阶段验收项目");
  await form.getByLabel("项目编码").fill("STAGEQA");
  await form.getByRole("group", { name: /^PM/ }).getByRole("checkbox", { name: /王磊/ }).check();
  await form.getByRole("group", { name: /^软件经理/ }).getByRole("checkbox", { name: /林澈/ }).check();
  const newStage = form.getByLabel("项目阶段", { exact: true });
  await expect(newStage.locator("option")).toHaveText(["TR1", "TR2", "TR3", "TR4", "TR5", "TR6", "已结束"]);
  await expect(newStage).toHaveValue("TR1");
  await newStage.selectOption("TR4");
  await form.getByRole("button", { name: "创建项目" }).click();
  await expectFlash(page, "项目已创建");
  const settingsPath = new URL(page.url()).pathname;

  await login(page, "MGR001");
  await page.goto(settingsPath);
  await page.getByTestId("edit-project-trigger").click();
  const editForm = page.getByTestId(/^edit-project-form-/);
  const editStage = editForm.getByLabel("项目阶段", { exact: true });
  await expect(editStage).toHaveValue("TR4");
  await editStage.selectOption("ENDED");
  await editForm.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(page, "项目配置已更新");

  await page.goto("/settings/projects");
  const row = page.getByRole("row", { name: /阶段验收项目/ });
  await expect(row.getByRole("cell", { name: "已结束", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "进行中", exact: true })).toBeVisible();

  await page.goto(settingsPath);
  await page.getByTestId("edit-project-trigger").click();
  await expect(editStage).toHaveValue("ENDED");
  await editStage.selectOption("TR5");
  await editForm.getByLabel("流程状态", { exact: true }).selectOption("ARCHIVED");
  await editForm.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(page, "项目配置已更新");
  await page.goto("/settings/projects");
  await expect(row.getByRole("cell", { name: "已结束", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "已归档", exact: true })).toBeVisible();

  await page.goto(settingsPath);
  await page.getByTestId("edit-project-trigger").click();
  await expect(editStage).toHaveValue("TR5");
  await editForm.getByLabel("流程状态", { exact: true }).selectOption("ACTIVE");
  await editForm.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(page, "项目配置已更新");
  await page.goto("/settings/projects");
  await expect(row.getByRole("cell", { name: "TR5", exact: true })).toBeVisible();
  await page.goto(settingsPath);
  await page.getByText("项目删除", { exact: true }).click();
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await confirmAction(page);
  await expectFlash(page, "项目已删除");
});

test("人员配置支持在手机上按身份查找并进入账号详情", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/users");
  await page.getByRole("button", { name: "筛选工号", exact: true }).click();
  const employeeIdFilter = page.getByRole("dialog", { name: "筛选工号", exact: true });
  await employeeIdFilter.getByRole("textbox", { name: "工号", exact: true }).fill("MGR001");
  await employeeIdFilter.getByRole("button", { name: "应用", exact: true }).click();
  await page.getByRole("button", { name: "筛选系统角色", exact: true }).click();
  const roleFilter = page.getByRole("dialog", { name: "筛选系统角色", exact: true });
  await roleFilter.getByRole("checkbox", { name: "软件经理", exact: true }).check();
  await roleFilter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("row", { name: /林澈/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /沈清/ })).toHaveCount(0);
  await page.getByRole("link", { name: "管理林澈的账号" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "林澈" })).toBeVisible();
  await expect(page.getByLabel("系统角色")).toHaveValue("SOFTWARE_MANAGER");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("筛选软件包使用范围时保留其他项目的已选节点", async ({ page }) => {
  await login(page, "OWNER001");
  await page.goto("/settings/packages/2");
  const usage = page.getByTestId("package-usage-form");
  await expect(usage.getByText("已选择 5 个节点")).toBeVisible();
  await usage.getByRole("searchbox", { name: "查找项目节点" }).fill("T3");
  await expect(usage.getByText("星云 N1", { exact: true })).toBeHidden();
  await expect(usage.getByText("磐石 T3", { exact: true })).toBeVisible();
  await usage.getByRole("button", { name: "保存使用范围" }).click();
  await expectFlash(page, "项目使用范围已更新");
  await expect(usage.getByText("已选择 5 个节点")).toBeVisible();
});

test("责任田成员选择在窄屏对话框中完成并保留项目筛选", async ({ page }) => {
  await login(page, "OWNER001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/areas/1");
  const areaProjects = page.getByRole("region", { name: "项目负责人和成员" });
  await areaProjects.getByRole("searchbox", { name: "搜索", exact: true }).fill("N1");
  await areaProjects.getByLabel("每页条数").selectOption("10");
  await areaProjects.getByRole("button", { name: "筛选", exact: true }).click();
  const row = areaProjects.getByTestId("area-project-1");
  await expect(row).toBeVisible();
  await expect(areaProjects.getByTestId("area-project-2")).toHaveCount(0);
  await expect(row.locator("form")).toHaveCount(0);
  const trigger = row.getByRole("button", { name: "添加成员" });
  const height = await row.evaluate((element) => element.getBoundingClientRect().height);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /添加成员/ });
  const search = dialog.getByRole("searchbox", { name: "搜索项目成员" });
  await expect(search).toBeFocused();
  expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBe(height);
  await search.fill("MEMBER");
  await search.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.fill("MEMBER001");
  const candidate = dialog.getByRole("radio", { name: /许言/ });
  await candidate.check();
  await search.fill("找不到人员");
  await expect(dialog.getByRole("status")).toHaveText("没有匹配的人员。");
  await expect(candidate).toBeChecked();
  await dialog.getByRole("button", { name: "添加项目成员" }).click();
  await expectFlash(page, "项目成员已添加");
  await expect(dialog).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("q")).toBe("N1");
  expect(new URL(page.url()).searchParams.get("pageSize")).toBe("10");
  await row.getByRole("button", { name: "2 人" }).click();
  const members = page.getByRole("dialog", { name: /项目|成员/ });
  await members.getByRole("button", { name: "移除 许言" }).click();
  await confirmAction(page);
  await expectFlash(page, "项目成员已移除");
  await expect(row.getByRole("button", { name: "1 人" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await areaProjects.getByRole("link", { name: "清除筛选" }).click();
  await expect(areaProjects.getByRole("searchbox", { name: "搜索", exact: true })).toHaveValue("");
  await expect(areaProjects.getByLabel("每页条数")).toHaveValue("10");

  await login(page, "MEMBER001");
  await page.goto("/settings/areas/1");
  await expect(row.getByRole("button", { name: "添加成员" })).toHaveCount(0);
  await row.getByRole("button", { name: "1 人" }).click();
  await expect(page.getByRole("dialog")).toContainText("韩松");
  await expect(page.getByRole("dialog").getByRole("button", { name: /移除/ })).toHaveCount(0);
});

test("窄屏项目配置仅打开选中的节点，拒绝跨项目节点地址", async ({ page }) => {
  await login(page, "MGR001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/projects/1#nodes");
  const nodes = page.getByRole("region", { name: "测试节点" });
  await expect(nodes.getByRole("listitem")).toHaveCount(3);
  await expect(nodes.locator("form")).toHaveCount(0);
  await nodes.getByRole("link", { name: "配置节点 EVT" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "配置节点 EVT" })).toBeVisible();
  await expect(page.getByTestId("edit-node-form").getByLabel("节点名称")).toHaveValue("EVT");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "返回测试节点" }).click();
  await nodes.getByRole("link", { name: "配置节点 DVT" }).click();
  await expect(page.getByTestId("edit-node-form").getByLabel("节点名称")).toHaveValue("DVT");
  await page.goto("/settings/projects/1/nodes/4");
  await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
  await expect(page.getByTestId("edit-node-form")).toHaveCount(0);
});

test("历史版本导入检查责任田权限并保留选中的软件包", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/settings/packages/import?package=2");
  await expect(page).toHaveURL(/\/dashboard\?flash=/);
  await expectFlash(page, "当前角色无权访问该页面");

  await login(page, "OWNER001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/packages/2");
  await page.getByRole("link", { name: "导入历史版本" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "导入历史版本" })).toBeVisible();
  await expect(page.locator('select[name="packageId"]')).toHaveValue("2");
  await page.getByLabel("历史状态").selectOption("TRIAL");
  await expect(page.getByLabel(/试制电子流/)).toBeVisible();
  await expect(page.getByLabel(/转正电子流/)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
