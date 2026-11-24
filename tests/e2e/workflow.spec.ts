import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  confirmAction,
  confirmBindingNode,
  expectFlash,
  login,
  selectOptionContaining,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const areaName = "E2E 显示责任田";
const projectName = "E2E 项目维度验证";
const projectCode = "E2EP4";
let otaTrialUrl = "";

async function registerRisk(page: Page, reason: string) {
  await page.getByRole("button", { name: "登记风险原因", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: "风险试制原因" }).fill(reason);
  await form.getByRole("button", { name: "纳入待发布试制" }).click();
  await expectFlash(page, "风险试制原因已登记");
}

function acceptDialogs(page: Page) {
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
}

async function chooseByText(select: Locator, text: string) {
  await expect(select).toBeVisible();
  const options = await select.locator("option").evaluateAll((items) =>
    items.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent ?? "" })),
  );
  const option = options.find((item) => item.text.includes(text));
  if (!option) throw new Error("未找到选项 " + text);
  await select.selectOption(option.value);
}

async function approveAllBindingFlows(page: Page) {
  for (let index = 0; index < 8; index += 1) {
    const trigger = page.getByRole("button", { name: "审批电子流", exact: true }).first();
    if ((await trigger.count()) === 0) break;
    await trigger.click();
    const details = page.getByRole("dialog", { name: /审批/ });
    await details.locator('textarea[name="comment"]').fill("自动化验证：设备条码与试制版本匹配，审批通过。");
    await details.getByRole("button", { name: "审批通过" }).click();
    await expect(details).toBeHidden();
  }
}

async function withdrawBindingFlow(page: Page, scope: Locator) {
  await scope.getByRole("button", { name: "撤销电子流", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^撤销 BF-/ });
  await dialog.getByLabel("撤销原因").fill("已在原电子流网页撤销，现登记处理结果。");
  await dialog.getByRole("button", { name: "确认撤销电子流", exact: true }).click();
  await expectFlash(page, "电子流已撤销");
}

async function submitBindingFlow(page: Page, nodeName: string, barcodes: string[], approverName?: string) {
  const requirement = page.locator(".binding-requirement").filter({ hasText: nodeName }).first();
  await requirement.getByRole("button", { name: "新增绑定电子流" }).click();
  const bindingDialog = page.getByRole("dialog", { name: /提交绑定电子流/ });
  if (approverName) {
    await chooseByText(bindingDialog.locator('select[name="approverId"]'), approverName);
  }
  await bindingDialog.locator('textarea[name="barcodes"]').fill(barcodes.join("\n"));
  await bindingDialog.locator('input[name="webUrl"]').fill("https://eflow.example.com/binding/" + barcodes[0]);
  await bindingDialog.getByRole("button", { name: "提交绑定电子流" }).click();
  await expect(bindingDialog).toBeHidden();
}

test.describe("工程协同台项目维度流程", () => {
  test("责任田主管、项目负责人、项目成员三级管理", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "ADMIN001");
    await page.goto("/settings/areas");
    await page.getByTestId("new-area-trigger").click();
    const newAreaForm = page.getByTestId("new-area-form");
    await newAreaForm.locator('input[name="name"]').fill(areaName);
    await newAreaForm.locator('textarea[name="description"]').fill("验证责任田主管负责制与项目成员分级维护。");
    await newAreaForm.getByRole("button", { name: "创建责任田" }).click();
    await expectFlash(page, "责任田已创建");

    await expect(page.getByRole("heading", { name: areaName, level: 1 })).toBeVisible();
    const areaPath = new URL(page.url()).pathname;
    const leaderPanel = page.getByRole("region", { name: "责任田主管" });
    await leaderPanel.getByRole("button", { name: "添加主管" }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("searchbox", { name: "搜索责任田主管" }).fill("郑一");
    await picker.getByRole("radio", { name: /郑一/ }).check();
    await picker.getByRole("button", { name: "设置主管" }).click();
    await expectFlash(page, "责任田主管已设置");
    await expect(leaderPanel).toContainText("郑一");

    await login(page, "OWNER004");
    await page.goto("/settings/areas");
    await expect(page.getByTestId("new-area-form")).toHaveCount(0);
    await page.getByRole("link", { name: areaName, exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === areaPath);
    const n1Row = page.locator(".area-project-row").filter({ hasText: "星云 N1" });
    await n1Row.getByRole("button", { name: "添加负责人" }).click();
    await picker.getByRole("searchbox", { name: "搜索项目负责人" }).fill("王磊");
    await picker.getByRole("radio", { name: /王磊/ }).check();
    await picker.getByRole("button", { name: "设置项目负责人" }).click();
    await expectFlash(page, "项目负责人已设置");
    await n1Row.getByRole("button", { name: "更换负责人" }).click();
    await picker.getByRole("searchbox", { name: "搜索项目负责人" }).fill("陈曦");
    await picker.getByRole("radio", { name: /陈曦/ }).check();
    await picker.getByRole("button", { name: "更换项目负责人" }).click();
    await expectFlash(page, "项目负责人已更换");
    await expect(n1Row).toContainText("陈曦");

    await login(page, "OWNER002");
    await page.goto(areaPath);
    await n1Row.getByRole("button", { name: "添加成员" }).click();
    await picker.getByRole("searchbox", { name: "搜索项目成员" }).fill("王磊");
    await picker.getByRole("radio", { name: /王磊/ }).check();
    await picker.getByRole("button", { name: "添加项目成员" }).click();
    await expectFlash(page, "项目成员已添加");
    await expect(n1Row).toContainText("陈曦");
    await n1Row.getByRole("button", { name: "1 人" }).click();
    await expect(picker).toContainText("王磊");
    await login(page, "ADMIN001");
    await page.goto("/settings/users");
    await page.getByRole("button", { name: "筛选责任田", exact: true }).click();
    const area = page.getByRole("dialog", { name: "筛选责任田", exact: true });
    await area.getByRole("checkbox", { name: areaName, exact: true }).check();
    await area.getByRole("button", { name: "应用", exact: true }).click();
    const filteredPeople = page.getByRole("table", { name: "人员列表" }).locator("tbody tr");
    await expect(filteredPeople).toHaveCount(3);
    for (const name of ["郑一", "王磊", "陈曦"]) await expect(filteredPeople.filter({ hasText: name })).toHaveCount(1);
  });

  test("项目节点绑定配置排版正常且可修改通过数量", async ({ page }) => {
    acceptDialogs(page);
    await login(page, "ADMIN001");
    await page.goto("/settings/projects");
    await page.getByTestId("new-project-trigger").click();
    const projectForm = page.getByTestId("new-project-form");
    await projectForm.locator('input[name="name"]').fill(projectName);
    await projectForm.locator('input[name="code"]').fill(projectCode);
    await projectForm.locator('textarea[name="description"]').fill("验证项目节点绑定责任和配置表单布局。");
    const pmPicker = projectForm.getByRole("group", { name: /^PM/ });
    const pmSearch = pmPicker.getByRole("searchbox", { name: "搜索PM" });
    await pmSearch.fill("member001");
    await expect(pmPicker.getByRole("checkbox", { name: /王磊/ })).toBeHidden();
    await pmPicker.getByRole("checkbox", { name: /许言/ }).check();
    await pmSearch.fill("王磊");
    await pmPicker.getByRole("checkbox", { name: /王磊/ }).check();
    await expect(pmPicker.getByRole("checkbox", { name: /许言/ })).toBeChecked();
    const managerPicker = projectForm.getByRole("group", { name: /^软件经理/ });
    const managerSearch = managerPicker.getByRole("searchbox", { name: "搜索软件经理" });
    await managerSearch.fill("mgr001");
    await managerPicker.getByRole("checkbox", { name: /林澈/ }).check();
    await managerSearch.fill("沈清");
    await managerPicker.getByRole("checkbox", { name: /沈清/ }).check();
    await expect(managerPicker.getByRole("checkbox", { name: /林澈/ })).toBeChecked();
    await projectForm.getByRole("button", { name: "创建项目" }).click();
    await expectFlash(page, "项目已创建");

    await expect(page.getByRole("heading", { name: projectName, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/projects\/\d+\?flash=/);
    const editForm = page.getByTestId(/^edit-project-form-/);
    await expect(editForm).toHaveCount(0);
    await page.getByTestId("edit-project-trigger").click();
    await expect(editForm).toBeVisible();
    await expect(editForm.locator('input[name="sortOrder"]')).toHaveCount(0);
    for (const name of ["许言", "王磊"]) {
      await expect(editForm.getByRole("group", { name: /^PM/ }).getByRole("checkbox", { name: new RegExp(name) })).toBeChecked();
    }
    for (const name of ["林澈", "沈清"]) {
      await expect(editForm.getByRole("group", { name: /^软件经理/ }).getByRole("checkbox", { name: new RegExp(name) })).toBeChecked();
    }
    const nodeSection = page.locator("#nodes");
    await page.getByRole("link", { name: "取消编辑" }).click();
    await nodeSection.getByRole("button", { name: "添加节点" }).click();
    const addForm = nodeSection.getByTestId(/^add-node-form-/);
    await expect(addForm).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "添加测试节点" });
    const cardBox = await dialog.boundingBox();
    const formBox = await addForm.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    if (cardBox && formBox) {
      expect(formBox.width).toBeGreaterThan(400);
      expect(formBox.x + formBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 2);
    }
    await addForm.locator('input[name="name"]').fill("SIT");
    await addForm.locator('input[name="description"]').fill("系统集成验证");
    await selectOptionContaining(addForm.locator('select[name="bindingOwnerId"]'), "韩松");
    await selectOptionContaining(addForm.locator('select[name="bindingApproverId"]'), "王磊");
    await addForm.locator('input[name="requiredBindingCount"]').fill("1");
    await addForm.getByRole("button", { name: "添加节点" }).click();
    await expectFlash(page, "项目测试节点已添加");

    const nodeRow = page.getByTestId(/^node-config-/).filter({ hasText: "SIT" });
    await expect(nodeRow).toContainText("韩松");
    await nodeRow.getByRole("link", { name: "配置节点 SIT" }).click();
    const nodeForm = page.getByTestId("edit-node-form");
    await nodeForm.locator('input[name="requiredBindingCount"]').fill("2");
    await nodeForm.getByRole("button", { name: "保存节点配置" }).click();
    await expectFlash(page, "项目节点绑定配置已更新");
    await expect(nodeForm.locator('input[name="requiredBindingCount"]')).toHaveValue("2");
    await page.getByRole("link", { name: "返回测试节点" }).click();
    await expect(nodeRow.locator("dd").nth(2)).toHaveText("2");
  });

  test("软件包配置只对责任田主管开放，新建项目只对管理员开放", async ({ page }) => {
    await login(page, "MGR001");
    await page.goto("/settings/packages");
    await expect(page).toHaveURL(/\/dashboard\?flash=/);
    await page.goto("/settings/projects");
    await expect(page.getByTestId("new-project-trigger")).toHaveCount(0);

    await page.goto("/packages?open=1");
    await expect(page.getByTestId("package-drawer")).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑责任信息" })).toHaveCount(0);

    await login(page, "OWNER001");
    await page.goto("/packages?open=1");
    await expect(page.getByTestId("package-drawer")).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑责任信息" })).toBeVisible();
    await page.goto("/settings/packages");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("软件包配置");
    await expect(page.locator(".data-table")).toContainText("1001OTA");
    await expect(page.locator(".data-table")).not.toContainText("1004NET");
    await expect(page.getByTestId("new-package-trigger")).toBeVisible();

    await login(page, "ADMIN001");
    await page.goto("/settings/packages");
    await expect(page.locator(".data-table")).toContainText("1004NET");
    await expect(page.getByTestId("new-package-trigger")).toBeVisible();
  });

  test("个人工作台与项目软件经理按项目隔离", async ({ page }) => {
    await login(page, "MGR001");
    await expect(page.getByRole("heading", { name: "我的工作台", level: 1 })).toBeVisible();
    const account = page.locator(".sidebar-user");
    await expect(account).toBeVisible();
    await expect(account.locator(".sidebar-user-name")).toHaveText("林澈");
    await expect(account.locator(".sidebar-user-role")).toHaveText("软件经理 · MGR001");
    await expect(page.locator(".personal-task").filter({ hasText: "星云 N1" }).first()).toBeVisible();
    await expect(page.locator(".personal-task").filter({ hasText: "极光 M2" })).toHaveCount(0);
    await expect(page.locator(".personal-task").filter({ hasText: "磐石 T3" })).toHaveCount(0);

    await login(page, "MGR002");
    await expect(page.locator(".personal-task").filter({ hasText: "极光 M2" }).first()).toBeVisible();
    await expect(page.locator(".personal-task").filter({ hasText: "星云 N1" })).toHaveCount(0);

    await login(page, "TEST002");
    await expect(page.locator(".personal-task").filter({ hasText: "极光 M2" }).filter({ hasText: "提交测试结论" }).first()).toBeVisible();
    await expect(page.locator(".personal-task").filter({ hasText: "星云 N1" })).toHaveCount(0);

    await page.goto("/submissions");
    await expect(page.locator(".project-request-group").filter({ hasText: "极光 M2" }).first()).toBeVisible();
    await expect(page.locator(".project-request-group").filter({ hasText: "星云 N1" })).toHaveCount(0);
    await page.goto("/integration");
    await expect(page.getByRole("row").filter({ hasText: "极光 M2" }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "星云 N1" })).toHaveCount(0);

    await page.goto("/overview");
    await expect(page.getByRole("heading", { name: "项目总览", level: 1 })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "极光 M2" })).toBeVisible();
    const n1 = page.getByRole("row").filter({ hasText: "星云 N1" });
    await n1.getByRole("link", { name: "星云 N1", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/1(?:\?.*)?$/);
    await expect(page.getByRole("heading", { name: "星云 N1", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "项目流程需要分配权限" })).toBeVisible();
    await expect(page.getByRole("region", { name: "当前流程" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "软件包与全局使用范围" })).toHaveCount(0);

    await login(page, "TEST001");
    await page.goto("/submissions");
    await expect(page.locator(".project-request-group").filter({ hasText: "星云 N1" }).first()).toBeVisible();
    await expect(page.locator(".project-request-group").filter({ hasText: "极光 M2" }).first()).toBeVisible();
    await expect(page.locator(".project-request-group").filter({ hasText: "磐石 T3" }).first()).toBeVisible();

    await login(page, "OWNER001");
    await expect(page.locator(".personal-alert").filter({ hasText: "1008MED 4.2.0" }).filter({ hasText: "磐石 T3" })).toContainText("测试异常");
    await login(page, "VALID001");
    await expect(page.locator(".personal-task").filter({ hasText: "1006KEY" }).first()).toBeVisible();
    await page.goto("/trial?view=binding");
    await expect(page.getByRole("heading", { name: "试制版本绑定验证" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "待发布试制" })).toHaveCount(0);

    await login(page, "MGR001");
    await page.goto("/trial");
    await expect(page.getByRole("heading", { name: "待发布试制" })).toBeVisible();
  });

  test("试制超期在项目工作区和项目试制页提示", async ({ page }) => {
    await login(page, "MGR001");
    await page.goto("/overview");
    await page.getByRole("link", { name: "星云 N1", exact: true }).click();
    const trial = page.getByRole("region", { name: "当前流程" }).getByRole("link", { name: /试制与绑定/ });
    await expect(trial).toContainText("已超期");
    await expect(trial).toHaveAttribute("href", "/trial?project=1&view=binding");
    await trial.click();
    const keyRow = page.locator(".data-table tbody tr").filter({ hasText: "1006KEY" }).filter({ hasText: "星云 N1" }).first();
    await expect(keyRow).toContainText("已超期");
  });

  test("通知点击后标记已读并从工作台消失", async ({ page }) => {
    await login(page, "VALID001");
    const alert = page.locator(".personal-alert").filter({ hasText: "被驳回" }).first();
    await expect(alert).toBeVisible();
    await alert.click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/trial/");
    await page.goto("/dashboard");
    await expect(page.locator(".personal-alert").filter({ hasText: "被驳回" })).toHaveCount(0);
  });

  test("转测申请通过专用表单提交，并可撤回", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "OWNER001");
    await page.goto("/submissions");
    await page.getByTestId("submit-transfer-trigger").click();
    await expect(page).toHaveURL(/\/submissions\/transfer$/);
    const form = page.getByTestId("transfer-form");
    await expect(form).toBeVisible();
    await form.getByLabel("搜索软件包").fill("1003COM");
    await expect(form.getByText("没有匹配的软件包")).toBeVisible();
    await form.getByLabel("搜索软件包").fill("1002CFG");
    await form.getByTestId(/transfer-package-/).filter({ hasText: "1002CFG" }).click();
    await form.locator('input[name="version"]').fill("2.3.0");
    await form.locator('textarea[name="changeSummary"]').fill("自动化验证：通过转测表单提交新版本。");
    await form.locator('input[name="archiveUrl"]').fill("https://packages.example.com/e2e/1002cfg-2.3.0.tar.gz");
    await form.locator('input[name="buildUrl"]').fill("https://ci.example.com/e2e/1002cfg-2.3.0");
    await expect(form.getByRole("button", { name: "提交申请" })).toBeEnabled();
    await form.getByRole("button", { name: "提交申请" }).click();
    await expectFlash(page, "转测申请已提交，并发送至 2 个项目");
    await expect(page.locator(".project-request-group").filter({ hasText: "1002CFG" }).first()).toBeVisible();
    await page.locator(".project-request-group").filter({ hasText: "1002CFG" }).first().getByRole("button", { name: "撤回申请" }).click();
    const withdrawal = page.getByRole("dialog", { name: /撤回 1002CFG/ });
    await expect(withdrawal).toHaveAccessibleDescription("将永久删除此版本记录及其在所有使用项目中的转测申请。");
    await withdrawal.getByRole("button", { name: "确认撤回" }).click();
    await expectFlash(page, "转测申请已撤回");
    await expect(page.locator(".project-request-group").filter({ hasText: "1002CFG" })).toHaveCount(0);
  });

  test("保存配套草稿后核对并发起，完成后可从历史队列找回", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "MGR001");
    await page.goto("/submissions");
    await page.getByTestId("open-batch-1").click();
    const builder = page.getByTestId("batch-builder-form");
    await expect(builder).toBeVisible();
    await expect(page.locator('input[name="code"]')).toHaveValue("B125");
    await expect(builder.getByRole("checkbox")).toHaveCount(8);
    await expect(builder.locator(".compact-batch-table tbody tr")).toHaveCount(8);
    await expect(builder.locator(".compact-batch-table select")).toHaveCount(8);
    const otaRow = builder.locator(".compact-batch-table tbody tr").filter({ hasText: "1001OTA" }).first();
    await expect(otaRow.locator("select option:checked")).toContainText("1.6.2");
    const comRow = builder.locator(".compact-batch-table tbody tr").filter({ hasText: "1003COM" }).first();
    await expect(comRow.locator("select option:checked")).toContainText("2.1.0");
    await chooseByText(comRow.locator("select"), "2.0.3");
    await expect(comRow.locator("select option:checked")).toContainText("2.0.3");
    await builder.getByRole("checkbox", { name: "本轮转测 1003COM" }).uncheck();
    await expect(comRow.locator("select")).toBeDisabled();
    await page.locator('input[name="code"]').fill("B950");
    await page.locator('input[name="title"]').fill("星云 N1 整套配套自动化验证");
    await page.getByRole("button", { name: "保存草稿并核对" }).click();
    await expectFlash(page, "转测草稿已保存");
    await expect(page).toHaveURL(/\/integration\/\d+\?project=1&flash=/);
    await expect(page.getByRole("row", { name: /1003COM/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /1001OTA/ })).toBeVisible();
    await page.getByRole("link", { name: "返回待发起批次" }).click();
    const draftRow = page.locator(".data-table tbody tr").filter({ hasText: "B950" }).first();
    await expect(draftRow).toContainText("星云 N1");
    await page.getByRole("navigation", { name: "转测工作队列" }).getByRole("link", { name: /待安排申请/ }).click();
    await expect(page.locator(".project-request-group").getByText("1003COM", { exact: true })).toBeVisible();
    await page.goBack();
    await draftRow.getByRole("link", { name: "核对 B950 配套" }).click();
    await page.getByRole("button", { name: "发起转测" }).click();
    await confirmAction(page);
    await expectFlash(page, "B950 已发起集成测试");
    await page.goto("/submissions?project=1");
    await expect(page.getByRole("checkbox", { name: "本轮转测 1003COM 2.1.0" })).toBeVisible();

    await page.goto("/integration");
    const activeCard = page.getByRole("row", { name: /B950/ });
    await expect(activeCard).toContainText("集成测试中");
    await expect(page.getByText("待组织转测", { exact: false })).toHaveCount(0);
    await activeCard.getByRole("link", { name: /查看批次/ }).click();
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);
    await page.getByRole("button", { name: "终止测试", exact: true }).click();
    await page.locator('textarea[name="reason"]').fill("验证完成");
    await page.getByRole("button", { name: "确认终止测试" }).click();
    await expectFlash(page, "本批次已终止");
    await page.getByRole("link", { name: "返回历史批次" }).click();
    await expect(page).toHaveURL(url => url.pathname === "/integration" && url.searchParams.get("view") === "history");
    const search = page.getByRole("search", { name: "批次号、标题或项目" });
    await search.getByRole("searchbox").fill("B950 星云");
    await search.getByRole("button", { name: "搜索" }).click();
    await expect(page).toHaveURL(url => url.searchParams.get("q") === "B950 星云");
    const pageSize = page.getByRole("combobox", { name: "每页条数" });
    await pageSize.selectOption("10");
    await expect(page).toHaveURL(url => url.searchParams.get("pageSize") === "10");
    await expect(page.locator(".data-table tbody tr")).toHaveCount(1);
    await page.getByRole("row", { name: /B950.*已终止/ }).getByRole("link", { name: "查看记录" }).click();
    await page.getByRole("link", { name: "返回历史批次" }).click();
    await expect(search.getByRole("searchbox")).toHaveValue("B950 星云");
    await expect(pageSize).toHaveValue("10");
  });

  test("集成测试责任田负责人提交结论并按项目批次归档报告", async ({ page, request }) => {
    test.setTimeout(120_000);
    await login(page, "MGR001");
    await page.goto("/integration/4");
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);

    await login(page, "TEST002");
    await page.goto("/integration/4");
    await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);

    await login(page, "TEST001");
    await page.goto("/integration/4");
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);
    await page.getByRole("button", { name: "记录进展" }).click();
    await page.locator('[data-testid="add-batch-progress-form"] textarea[name="content"]').fill("N1 配置专项已完成第一轮验证，配置下发、回读和异常断电场景均通过，准备提交最终结论。");
    await page.getByRole("button", { name: "提交进展说明" }).click();
    await expectFlash(page, "进展说明已提交");
    await expect(page.locator(".timeline-title").filter({ hasText: "第一轮验证" })).toBeVisible();
    await page.getByRole("button", { name: "提交测试结论" }).click();
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(1);
    await page.locator('select[name="conclusion"]').selectOption("PASS");
    await expect(page.getByLabel("问题归属")).toHaveCount(0);
    await page.locator('textarea[name="testSummary"]').fill("集成测试责任田验证：N1 配置专项全部通过，无新增阻塞问题。");
    const reportContents = Buffer.alloc(1100 * 1024, "N1 验证：通过。\n");
    await page.locator('input[name="reportFile"]').setInputFiles({
      name: "B120-verification-report.txt",
      mimeType: "text/plain",
      buffer: reportContents,
    });
    await page.getByRole("button", { name: "提交验证结论" }).click();
    await expectFlash(page, "验证报告已上传");
    const reportLink = page.getByRole("link", { name: "B120-verification-report.txt" });
    await expect(reportLink).toBeVisible();
    const reportPath = (await reportLink.getAttribute("href"))!;
    const report = await page.request.get(reportPath);
    expect(report.ok()).toBe(true);
    expect(await report.body()).toEqual(reportContents);
    expect((await request.get(reportPath)).status()).toBe(401);

    const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
    try {
      const stored = db.prepare("SELECT stored_path FROM report_files WHERE id = ?")
        .get(Number(reportPath.split("/").at(-1))) as { stored_path: string };
      expect(dirname(stored.stored_path).replaceAll("\\", "/")).toBe("data/uploads/reports/1-星云 N1/B120");
      expect(await readFile(resolve(stored.stored_path))).toEqual(reportContents);

      const legacyName = `legacy-${randomUUID()}.txt`;
      const legacyPath = join("data", "uploads", "reports", legacyName);
      await writeFile(legacyPath, "旧验证报告", { flag: "wx" });
      try {
        const legacy = db.prepare(
          "INSERT INTO report_files (original_name, stored_path, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(legacyName, legacyPath.replaceAll("/", "\\"), "text/plain; charset=utf-8", Buffer.byteLength("旧验证报告"), new Date().toISOString());
        try {
          const legacyDownload = await page.request.get(`/api/reports/${legacy.lastInsertRowid}`);
          expect(legacyDownload.ok()).toBe(true);
          expect(await legacyDownload.text()).toBe("旧验证报告");
        } finally {
          db.prepare("DELETE FROM report_files WHERE id = ?").run(legacy.lastInsertRowid);
        }
      } finally {
        await rm(legacyPath, { force: true });
      }
    } finally {
      db.close();
    }
  });

  test("项目试制、多个设备条码电子流审批与项目转正", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, "MGR001");
    await page.goto("/trial");
    const readyRow = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row")
      .filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.0" }).filter({ hasText: "星云 N1" });
    await expect(readyRow).toContainText("待发试制");
    await readyRow.getByRole("button", { name: "发布", exact: true }).click();
    const publication = page.getByRole("dialog", { name: "发布 1001OTA 1.6.0 试制" });
    const trialFlowUrl = "https://eflow.example.com/trial/n1-ota-160";
    const trialMinutes = "核对了 N1 与 M2 的验收报告。\n双方同意发布本次试制。";
    const trialMinutesField = publication.getByRole("textbox", { name: "试制评审纪要", exact: true });
    const trialFlowField = publication.getByRole("textbox", { name: "试制电子流网址", exact: true });
    await trialFlowField.fill("ftp://eflow.example.com/trial/n1-ota-160");
    await trialMinutesField.fill(trialMinutes);
    await publication.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await confirmAction(page);
    await expect(publication.getByRole("alert")).toContainText(/https?/i);
    await expect(page).toHaveURL(/\/trial$/);
    await trialFlowField.fill(trialFlowUrl);
    await trialMinutesField.fill("   ");
    await publication.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await confirmAction(page);
    await expect(publication.getByRole("alert")).toContainText("评审纪要");
    await expect(page).toHaveURL(/\/trial$/);
    await trialFlowField.fill(trialFlowUrl);
    await trialMinutesField.fill(trialMinutes);
    await publication.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await confirmAction(page);
    await expectFlash(page, "试制版本已发布");
    await expect(page.getByText("核对了 N1 与 M2 的验收报告。", { exact: false }).first()).toBeVisible();
    otaTrialUrl = page.url().split("?")[0];
    expect(otaTrialUrl).toMatch(/\/trial\/\d+$/);
    await expect(page.locator(".binding-requirement")).toHaveCount(3);
    await page.getByRole("button", { name: "推送绑定任务" }).click();
    await expectFlash(page, "已向全部使用项目的绑定责任人推送");
    await expect(page.locator(".binding-requirement").filter({ hasText: "未推送" })).toHaveCount(0);

    await login(page, "VALID001");
    await page.goto(otaTrialUrl);
    await page.getByRole("button", { name: "新增绑定电子流" }).first().click();
    const approverSelect = page.locator('select[name="approverId"]').first();
    await expect(approverSelect).toBeVisible();
    expect(await approverSelect.locator("option").count()).toBeGreaterThanOrEqual(2);
    await page.goto(otaTrialUrl);
    await submitBindingFlow(page, "EVT", ["N1-OTA-EVT-001", "N1-OTA-EVT-002"]);
    await submitBindingFlow(page, "EVT", ["N1-OTA-EVT-003"]);
    await submitBindingFlow(page, "DVT", ["N1-OTA-DVT-001"], "林澈");
    await submitBindingFlow(page, "PVT", ["N1-OTA-PVT-001"]);
    const bulkBarcodes = Array.from({ length: 40 }, (_, index) => `N1-OTA-BULK-${String(index + 1).padStart(3, "0")}`);
    await submitBindingFlow(page, "EVT", bulkBarcodes);
    const bulkFlow = page.locator(".binding-flow-row").filter({ hasText: "条码 40 个" }).first();
    await expect(bulkFlow).toBeVisible();
    await bulkFlow.locator("details.barcode-details summary").click();
    await expect(bulkFlow.locator(".barcode-chip")).toHaveCount(40);
    await expect(page.getByText("N1-OTA-EVT-003")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "撤销电子流" }).first()).toBeVisible();
    await expect(page.locator(".flow-web-link").first()).toBeVisible();
    await expect(page.locator(".barcode-details summary").first()).toBeVisible();

    await login(page, "OWNER001");
    await page.goto(otaTrialUrl);
    await approveAllBindingFlows(page);
    await page.waitForTimeout(300);

    await login(page, "MGR001");
    await page.goto(otaTrialUrl);
    await approveAllBindingFlows(page);
    await page.waitForTimeout(300);

    // N1 节点已达标，由绑定责任人确认后仍须等待 M2。
    await login(page, "VALID001");
    await page.goto(otaTrialUrl);
    for (const node of ["EVT", "DVT", "PVT"]) {
      await confirmBindingNode(page, page.locator(".binding-requirement").filter({ hasText: node }));
    }
    await page.goto("/trial");
    const m2Row = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).filter({ hasText: "极光 M2" }).filter({ hasText: "1.6.0" }).first();
    await expect(m2Row).toBeVisible();
    const m2Href = await m2Row.getByRole("link", { name: /查看节点与审批/ }).getAttribute("href");
    expect(m2Href).toBeTruthy();
    await page.goto(new URL(m2Href!, page.url()).toString());
    await expect(page).toHaveURL(url => /^\/trial\/\d+$/.test(url.pathname));
    const m2TrialUrl = page.url().split("?")[0];
    await submitBindingFlow(page, "PVT", ["M2-OTA-PVT-001"], "陈曦");
    await login(page, "OWNER002");
    await page.goto(m2TrialUrl);
    await approveAllBindingFlows(page);
    await expect(page.locator(".binding-requirement summary").first()).toContainText("待确认");
    await expect(page.getByRole("heading", { name: "已满足转正条件" })).toHaveCount(0);
    await login(page, "VALID001");
    await page.goto(m2TrialUrl);
    await confirmBindingNode(page, page.locator(".binding-requirement"));
    await expect(page.getByRole("heading", { name: "已满足转正条件" })).toBeVisible();

    await login(page, "MGR001");
    await page.goto("/formal");
    const formalCard = page.getByRole("row", { name: /1001OTA.*1\.6\.0.*星云 N1/ });
    await formalCard.getByRole("link", { name: "核对并转正" }).click();
    const bindingDetails = page.getByRole("region", { name: "项目验收与绑定证据" });
    await expect(bindingDetails).toContainText("极光 M2");
    const n1Evidence = bindingDetails.locator("details").filter({ hasText: "星云 N1" }).first();
    if ((await n1Evidence.getAttribute("open")) === null) await n1Evidence.locator("summary").click();
    await expect(bindingDetails).toContainText("N1-OTA");
    await expect(bindingDetails.locator("a").filter({ hasText: "网页电子流" }).first()).toBeVisible();
    await page.getByRole("button", { name: "发布正式版本" }).click();
    const formalDialog = page.getByRole("dialog", { name: /转正 1001OTA 1.6.0/ });
    const formalFlowUrl = "https://eflow.example.com/formal/ota-160";
    const formalMinutes = "核对项目验收、绑定条码和电子流。\n本次评审同意转正。";
    const formalMinutesField = formalDialog.getByRole("textbox", { name: "转正评审纪要", exact: true });
    const formalFlowField = formalDialog.getByRole("textbox", { name: "转正电子流网址", exact: true });
    await formalFlowField.fill("ftp://eflow.example.com/formal/ota-160");
    await formalMinutesField.fill(formalMinutes);
    await formalDialog.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expect(formalDialog.getByRole("alert")).toContainText(/https?/i);
    await formalFlowField.fill(formalFlowUrl);
    await formalMinutesField.fill("   ");
    await formalDialog.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expect(formalDialog.getByRole("alert")).toContainText("评审纪要");
    await expect(page).toHaveURL(/\/formal\/\d+/);
    await formalFlowField.fill(formalFlowUrl);
    await formalMinutesField.fill(formalMinutes);
    await formalDialog.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expectFlash(page, "同步发布正式版本");
    await expect(page).toHaveURL(/\/versions\/\d+/);
    for (const href of [trialFlowUrl, formalFlowUrl]) {
      await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
    }
    for (const minutes of [trialMinutes, formalMinutes]) {
      const record = page.getByText(minutes, { exact: true });
      await expect(record).toBeVisible();
      await expect(record).toHaveCSS("white-space", "pre-wrap");
      expect((await record.textContent())?.replaceAll("\r\n", "\n")).toBe(minutes);
    }

    await page.goto("/packages?project=1");
    const otaRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).first();
    await expect(otaRow).toContainText("1.6.0");

    await login(page, "VALID001");
    await expect(page.getByRole("link", { name: /1001OTA 1\.6\.0.*审批通过/ }).first()).toBeVisible();
  });

  test("作废项目试制版本后提醒绑定责任人撤销电子流", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "MGR001");
    await page.goto("/trial?view=binding");
    const keyRow = page.locator(".data-table tbody tr").filter({ hasText: "1006KEY" }).filter({ hasText: "星云 N1" }).first();
    await keyRow.getByRole("link", { name: /查看节点与审批/ }).click();
    await page.getByRole("button", { name: "作废试制版本", exact: true }).click();
    await page.locator('textarea[name="reason"]').fill("自动化验证：绑定验证不通过，作废本项目试制版本。");
    await page.getByRole("button", { name: "确认作废共享试制版本" }).click();
    await expectFlash(page, "试制版本已作废");

    await page.goto("/submissions");
    await page.getByTestId("open-batch-1").click();
    const keySelect = page.locator(".compact-batch-table tbody tr").filter({ hasText: "1006KEY" }).first().locator("select");
    await chooseByText(keySelect, "1.3.0");
    await expect(page.locator(".void-version-warning").first()).toContainText("已作废");
    await page.getByRole("link", { name: "返回转测申请" }).click();

    await login(page, "VALID001");
    const notices = page.locator(".personal-alert").filter({ hasText: "试制版本已作废" }).filter({ hasText: "1006KEY" });
    await expect(notices).toHaveCount(2);
    await notices.first().click();
    for (const flowNumber of ["BF-2026-0004", "BF-2026-0005"]) {
      await withdrawBindingFlow(page, page.locator(".binding-flow-row").filter({ hasText: flowNumber }));
    }
    await page.goto("/dashboard");
    await expect(notices).toHaveCount(0);
  });

  test("软件包使用范围跨项目展示，项目总览进入项目工作区和归档记录", async ({ page }) => {
    await login(page, "OWNER001");
    await page.goto("/packages");
    await expect(page.locator(".data-table")).not.toContainText("远山 X0");
    await page.goto("/packages?project=1");
    const projectNav = page.getByRole("complementary", { name: "主导航" }).getByRole("navigation", { name: "软件包流程" });
    await expect(projectNav.getByRole("link", { name: "软件版本总览" })).toHaveAttribute("href", "/packages?project=1");
    const table = page.locator(".data-table");
    await expect(table).toContainText("1001OTA");
    await expect(table).not.toContainText("远山 X0");
    await expect(table).toContainText("极光 M2");

    await page.getByRole("link", { name: "查看 1001OTA 详情" }).click();
    await expect(page.getByTestId("package-drawer")).toBeVisible();
    await expect(page.getByTestId("package-drawer")).toContainText("1001OTA");
    const traceLink = page.getByTestId("package-drawer").getByRole("link", { name: "全链路追溯" }).first();
    await expect(traceLink).toBeVisible();
    await traceLink.click();
    await expect(page).toHaveURL(/\/versions\/\d+\?project=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("1001OTA");
    await expect(page.getByRole("heading", { name: "项目与发布状态", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "绑定证据", exact: true })).toBeVisible();

    await page.goto("/overview");
    await page.locator(".project-overview-row").filter({ hasText: "极光 M2" }).getByRole("link", { name: "极光 M2", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/2(?:\?.*)?$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("极光 M2");
    await expect(page.getByRole("region", { name: "软件包与全局使用范围" })).toContainText("星云 N1");
    await expect(page.getByRole("heading", { name: "版本流程记录", exact: true })).toBeVisible();

    await page.goto("/overview?stage=ENDED");
    await page.getByRole("row").getByRole("link", { name: "远山 X0", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/4\?returnTo=/);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/overview?f_stage=ENDED");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("远山 X0");
    await expect(page.getByRole("region", { name: "软件包与全局使用范围" })).toContainText("1001OTA");
    await projectNav.getByRole("link", { name: "待转测申请" }).click();
    await expect(page.getByRole("heading", { name: "没有待转测的申请" })).toBeVisible();
    await expect(page.getByTestId("submit-transfer-trigger")).toHaveCount(0);
    await page.getByRole("main").getByRole("link", { name: "查看历史批次" }).click();
    await expect(page).toHaveURL(/\/integration\?project=4&view=history(?:&.*)?$/);
    await expect(page.getByRole("heading", { name: "历史批次", exact: true })).toBeVisible();
  });


  test("责任田主管可以新建软件包并进入配置页", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, "OWNER001");
    await page.goto("/settings/packages");
    await page.getByTestId("new-package-trigger").click();
    const form = page.getByTestId("new-package-form");
    await expect(form).toBeVisible();
    const packageName = form.getByRole("textbox", { name: "软件包名称" });
    const packageCode = form.getByRole("textbox", { name: "软件包编码" });
    await expect(packageName).toHaveAttribute("placeholder", "例如 OTA 升级服务");
    await expect(packageCode).toHaveAttribute("placeholder", "例如 10001OTA");
    await packageName.fill("测试辅助服务");
    await packageCode.fill("90001tst");
    await chooseByText(form.locator('select[name="ownerId"]'), "王磊");
    await form.locator('textarea[name="description"]').fill("自动化验证责任田主管新建软件包。");
    await form.getByRole("button", { name: "创建并配置使用范围" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/settings\/packages\/\d+(\?|$)/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("测试辅助服务");
    await expect(page.getByText("软件包已创建，请继续配置使用范围。")).toBeVisible();
    const editForm = page.getByTestId("package-meta-form");
    await expect(editForm.getByRole("textbox", { name: "软件包名称" })).toHaveValue("测试辅助服务");
    await expect(editForm.getByRole("textbox", { name: "软件包编码" })).toHaveValue("90001TST");
    await editForm.getByRole("textbox", { name: "软件包编码" }).fill("90002tst");
    await editForm.getByRole("button", { name: "保存责任信息" }).click();
    await expectFlash(page, "软件包信息已更新");
    await page.goto("/settings/packages");
    const packageRow = page.getByRole("row").filter({ hasText: "测试辅助服务" });
    await expect(packageRow.getByRole("cell", { name: "测试辅助服务", exact: true })).toBeVisible();
    await expect(packageRow.getByRole("rowheader", { name: "90002TST", exact: true })).toBeVisible();
  });
  test("风险发布可基于全项目共享试制发布", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "MGR002");
    await page.goto("/trial");
    const risk = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row")
      .filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" });
    await expect(risk).toHaveCount(0);
    await page.goto("/versions?project=2&q=1001OTA%201.6.1");
    await page.getByRole("link", { name: "全链路追溯", exact: true }).click();
    const reason = "集成测试资源不足，按历史回归结论和风险评估结果发布共享试制。";
    await registerRisk(page, reason);
    await expect(risk).toContainText("风险发布");
    await expect(risk).toContainText("未关联转测批次");
    await risk.getByRole("link", { name: "详情", exact: true }).click();
    await expect(page.getByText(reason, { exact: false })).toBeVisible();
    await page.goBack();
    await risk.getByRole("button", { name: "发布", exact: true }).click();
    const publication = page.getByRole("dialog", { name: /发布 1001OTA 1.6.1 试制/ });
    await expect(publication.getByText("未关联转测批次")).toBeVisible();
    await expect(publication.getByText(reason, { exact: false })).toBeVisible();
    await publication.getByRole("button", { name: "取消", exact: true }).click();
    await expect(publication).toBeHidden();
    await risk.getByRole("button", { name: "发布", exact: true }).click();
    await expect(publication.locator('textarea[name="riskConclusion"]')).toHaveCount(0);
    await publication.locator('input[name="trialFormNo"]').fill("https://eflow.example.com/trial/m2-ota-161");
    await publication.locator("textarea[name=reviewMinutes]").fill("评审同意在已登记的风险条件下发布共享试制。");
    await publication.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await confirmAction(page);
    await expectFlash(page, "试制版本已发布");
    await page.getByRole("link", { name: "返回节点绑定" }).click();
    await expect(page).toHaveURL(url => url.pathname === "/trial" && url.searchParams.get("view") === "binding");
    const trialRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" }).filter({ hasText: "极光 M2" }).first();
    await expect(trialRow).toContainText("风险发布");
    await expect(trialRow.locator('a[href="https://eflow.example.com/trial/m2-ota-161"]')).toBeVisible();
  });

  test("集成测试中可风险试制，节点免绑后仍保留测试，失败时作废并提醒撤销", async ({ page }) => {
    test.setTimeout(150_000);
    const version = "9.3.0-e2e";
    await login(page, "OWNER001");
    await page.goto("/submissions");
    await page.getByTestId("submit-transfer-trigger").click();
    const transfer = page.getByTestId("transfer-form");
    await transfer.getByLabel("搜索软件包").fill("1001OTA");
    await transfer.getByTestId(/transfer-package-/).filter({ hasText: "1001OTA" }).click();
    await transfer.locator('input[name="version"]').fill(version);
    await transfer.locator('textarea[name="changeSummary"]').fill("验证提前试制与集成测试并行，以及试制失败回退。");
    await transfer.locator('input[name="archiveUrl"]').fill("https://packages.example.com/e2e/parallel");
    await transfer.locator('input[name="buildUrl"]').fill("https://ci.example.com/e2e/parallel");
    await transfer.getByRole("button", { name: "提交申请" }).click();
    await expectFlash(page, "转测申请已提交");

    await login(page, "MGR001");
    await page.goto("/submissions?project=1");
    await page.getByTestId("open-batch-1").click();
    const builder = page.getByTestId("batch-builder-form");
    await chooseByText(builder.getByLabel("1001OTA 本次转测版本"), version);
    const otherPackages = builder.getByRole("checkbox", { name: /本轮转测 (?!1001OTA)/ });
    for (const checkbox of await otherPackages.all()) await checkbox.uncheck();
    await builder.locator('input[name="code"]').fill("B953");
    await builder.getByRole("button", { name: "保存草稿并核对" }).click();
    await expectFlash(page, "转测草稿已保存");
    const batchUrl = new URL(page.url());
    batchUrl.searchParams.delete("flash");
    await page.getByRole("button", { name: "发起转测" }).click();
    await confirmAction(page);
    await expectFlash(page, "B953 已发起集成测试");
    await page.goto(batchUrl.toString());
    await registerRisk(page, "现场先行试制，集成测试同步继续，发现问题即撤回。");
    const pending = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row").filter({ hasText: version });
    await expect(pending).toContainText("风险发布");
    await expect(pending).toContainText("B953");
    await pending.getByRole("button", { name: "发布", exact: true }).click();
    const publish = page.getByRole("dialog", { name: /发布 1001OTA/ });
    await expect(publish.getByRole("link", { name: /B953/ })).toBeVisible();
    await publish.locator('input[name="trialFormNo"]').fill("https://eflow.example.com/trial/parallel-e2e");
    await publish.locator("textarea[name=reviewMinutes]").fill("评审同意先行试制，集成测试继续进行。");
    await publish.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await confirmAction(page);
    await expectFlash(page, "试制版本已发布");
    const trialUrl = new URL(page.url());
    trialUrl.searchParams.delete("flash");
    trialUrl.searchParams.delete("tone");
    await expect(page.getByText(/完成前无法转正/)).toBeVisible();
    await page.getByRole("button", { name: "推送绑定任务" }).click();
    await expectFlash(page, "绑定责任人推送");

    await login(page, "VALID001");
    await page.goto(trialUrl.toString());
    const pvt = page.locator(".binding-requirement").filter({ hasText: "PVT" });
    await pvt.getByRole("button", { name: "节点无需绑定" }).click();
    const waiver = page.getByRole("dialog", { name: /PVT.*确认免绑/ });
    await waiver.locator('textarea[name="reason"]').fill("生产验证节点沿用已确认设备范围。");
    await waiver.getByRole("button", { name: "确认节点免绑" }).click();
    await expect(pvt).toContainText("节点免绑");
    await submitBindingFlow(page, "EVT", ["E2E-PARALLEL-OTA-001"]);
    await submitBindingFlow(page, "DVT", ["E2E-PARALLEL-OTA-002"], "王磊");
    await expect(page.getByText("网页电子流", { exact: true })).toHaveCount(2);

    await login(page, "OWNER001");
    await page.goto(trialUrl.toString());
    const dvt = page.locator(".binding-requirement").filter({ hasText: "DVT" });
    await dvt.getByRole("button", { name: "审批电子流", exact: true }).click();
    const review = page.getByRole("dialog", { name: /DVT · 审批/ });
    await expect(review.getByText("E2E-PARALLEL-OTA-002", { exact: true })).toBeVisible();
    await review.locator('textarea[name="comment"]').fill("已核对设备条码和网页电子流。");
    await review.getByRole("button", { name: "审批通过" }).click();
    await expect(dvt.locator("summary").first()).toContainText("待确认");
    await login(page, "VALID001");
    await page.goto(trialUrl.toString());
    await confirmBindingNode(page, dvt);

    await login(page, "TEST001");
    await page.goto(batchUrl.toString());
    await page.getByRole("button", { name: "提交测试结论" }).click();
    await page.locator('select[name="conclusion"]').selectOption("FAIL");
    await page.locator('select[name="issueAttribution"]').selectOption("PACKAGE_RELATED");
    await page.getByRole("checkbox", { name: /1001OTA.*9.3.0-e2e/ }).check();
    await page.locator('textarea[name="testSummary"]').fill("集成测试确认升级异常由本轮 1001OTA 版本引起。");
    await page.locator('input[name="reportFile"]').setInputFiles({
      name: "B953-rollback.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fail: OTA regression"),
    });
    await page.getByRole("button", { name: "提交验证结论" }).click();
    await expectFlash(page, "受影响的风险试制版本已作废");
    await expect(page.getByRole("link", { name: "B953-rollback.txt" })).toBeVisible();

    await login(page, "VALID001");
    await expect(page.locator(".personal-alert").filter({ hasText: version }).filter({ hasText: "撤销" }).first()).toBeVisible();
    await page.goto(trialUrl.toString());
    await expect(page.getByRole("heading", { name: "本项目试制版本已作废" })).toBeVisible();
    await expect(page.getByRole("button", { name: "撤销电子流" })).toHaveCount(2);
    await expect(dvt).toContainText("已关闭");
    await withdrawBindingFlow(page, dvt);
    await expect(dvt.getByRole("button", { name: "撤销电子流" })).toHaveCount(0);
    await expect(dvt).toContainText("已核对设备条码和网页电子流");
  });


  test("项目配置多个软件经理均能获得项目流程权限", async ({ page }) => {
    test.setTimeout(90_000);
    acceptDialogs(page);
    await login(page, "ADMIN001");
    await page.goto("/settings/projects/1");
    await page.getByTestId("edit-project-trigger").click();
    const editForm = page.getByTestId("edit-project-form-1");
    const managerPicker = editForm.getByRole("group", { name: /^软件经理/ });
    await managerPicker.getByRole("searchbox", { name: "搜索软件经理" }).fill("mgr002");
    const shenQing = managerPicker.getByRole("checkbox", { name: /沈清/ });
    await shenQing.check();
    await expect(managerPicker.getByRole("checkbox", { name: /林澈/ })).toBeChecked();
    await editForm.getByRole("button", { name: "保存项目配置" }).click();
    await expectFlash(page, "项目配置已更新");

    await login(page, "MGR002");
    await page.goto("/submissions");
    await expect(page.locator(".project-request-group").filter({ hasText: "星云 N1" }).first()).toBeVisible();

    await login(page, "ADMIN001");
    await page.goto("/settings/projects/1");
    await page.getByTestId("edit-project-trigger").click();
    const revertForm = page.getByTestId("edit-project-form-1");
    await revertForm.locator('label.person-check').filter({ hasText: "沈清" }).locator('input[name="softwareManagerIds"]').uncheck();
    await revertForm.getByRole("button", { name: "保存项目配置" }).click();
    await expectFlash(page, "项目配置已更新");
  });
  test("集成测试结束后可以提交结论放弃发布试制", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "MGR001");
    await page.goto("/trial");
    const abandonedRow = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row")
      .filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.2" }).filter({ hasText: "星云 N1" });
    await abandonedRow.getByRole("button", { name: "放弃", exact: true }).click();
    const abandonment = page.getByRole("dialog", { name: "放弃发布 1001OTA 1.6.2 试制" });
    await abandonment.locator('textarea[name="conclusion"]').fill("集成测试已完成，评估该临时版本不需要发布试制，计划直接废弃。");
    await abandonment.getByRole("button", { name: "提交结论并放弃试制" }).click();
    await confirmAction(page);
    await expectFlash(page, "已提交放弃发布试制结论");
    await expect(abandonedRow).toHaveCount(0);
    await page.goto("/packages?project=1&open=1");
    const drawer = page.getByTestId("package-drawer");
    await drawer.getByRole("tab", { name: "版本历史" }).click();
    await expect(drawer).toContainText("1.6.2");
    await expect(drawer).toContainText("放弃试制");
  });

  test("试制可确认无需绑定直接转正，正式版本仍可作废", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "MGR001");
    await page.goto("/trial?view=binding");
    const trialRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" }).filter({ hasText: "星云 N1" }).first();
    await expect(trialRow).toBeVisible();
    const href = await trialRow.getByRole("link", { name: "决定绑定方式" }).getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(new URL(href!, page.url()).toString());
    const versionHref = await page.getByRole("main").getByRole("link", { name: "版本全链路" }).getAttribute("href");
    expect(versionHref).toBeTruthy();
    await expect(page.getByRole("heading", { name: "绑定推送决策" })).toBeVisible();
    await page.getByText("无需绑定，直接进入待转正", { exact: true }).click();
    await page.getByRole("textbox", { name: "免绑原因", exact: true }).fill("该版本只修复配置项，已完成整机集成验证，无需重复绑定设备条码。");
    await page.getByRole("button", { name: "确认无需绑定" }).click();
    await expectFlash(page, "全部使用项目进入待转正");
    await expect(page).toHaveURL(/\/formal/);
    const formalCard = page.getByRole("row", { name: /1001OTA.*1\.6\.1/ });
    await expect(formalCard).toContainText("无需绑定");
    await formalCard.getByRole("link", { name: "核对并转正" }).click();
    await expect(page.getByText(/无需绑定原因/).first()).toBeVisible();
    await page.getByRole("button", { name: "发布正式版本" }).click();
    const formalDialog = page.getByRole("dialog", { name: /转正 1001OTA 1.6.1/ });
    await formalDialog.locator('input[name="flowNo"]').fill("https://eflow.example.com/formal/ota-161");
    await formalDialog.locator("textarea[name=reviewMinutes]").fill("核对免绑结论与转正条件，评审同意正式发布。");
    await formalDialog.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expectFlash(page, "同步发布正式版本");

    await page.goto(new URL(versionHref!, page.url()).toString());
    await page.getByRole("button", { name: "作废版本", exact: true }).click();
    await page.locator('textarea[name="reason"]').fill("正式发布后发现该版本不再适用，按流程作废并停止使用。");
    await page.getByRole("button", { name: "确认作废该版本" }).click();
    await expectFlash(page, "该软件包版本已作废");
  });

  test("软件包总览支持按列筛选，详情展示说明与构建地址", async ({ page }) => {
    await login(page, "OWNER001");
    await page.goto("/packages?project=1");
    const table = page.getByRole("region", { name: "软件版本总览表格" });
    const usageFilter = table.getByRole("button", { name: "筛选使用范围", exact: true });
    const otaLink = table.getByRole("link", { name: "查看 1001OTA 详情", exact: true });
    await expect(otaLink).toBeVisible();
    await usageFilter.click();
    const usage = page.getByRole("dialog", { name: "筛选使用范围", exact: true });
    await usage.getByRole("checkbox", { name: "极光 M2", exact: true }).check();
    await usage.getByRole("checkbox", { name: "EVT", exact: true }).check();
    await usage.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("project") === "1" &&
      url.searchParams.get("f_usage_project") === "2" && url.searchParams.has("f_usage_node"));

    // OTA uses EVT on N1 but only PVT on M2. COM satisfies both on M2.
    await expect(otaLink).toHaveCount(0);
    const comRow = table.getByRole("row").filter({ hasText: "1003COM" });
    await expect(comRow).toContainText("极光 M2");
    await expect(comRow).toContainText("星云 N1");
    await comRow.getByRole("link", { name: "查看 1003COM 使用范围" }).click();
    const scopeDrawer = page.getByRole("dialog", { name: "软件包详情" });
    await expect(scopeDrawer.getByRole("tab", { name: "使用范围" })).toHaveAttribute("aria-selected", "true");
    await scopeDrawer.getByRole("searchbox", { name: "搜索项目或节点" }).fill("极光 EVT");
    await expect(scopeDrawer.getByRole("tabpanel")).toContainText("EVT");
    await scopeDrawer.getByRole("button", { name: "关闭详情" }).click();
    await expect(scopeDrawer).toHaveCount(0);
    await usageFilter.click();
    await usage.getByRole("button", { name: "清除本列", exact: true }).click();
    await expect(otaLink).toBeVisible();

    const nameFilter = table.getByRole("button", { name: "筛选软件包", exact: true });
    await nameFilter.click();
    const nameMenu = page.getByRole("dialog", { name: "筛选软件包", exact: true });
    await nameMenu.getByRole("textbox", { name: "软件包名称", exact: true }).fill("没有匹配的软件包999");
    await nameMenu.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.getByRole("heading", { name: "没有匹配的软件包", exact: true })).toBeVisible();
    await expect(nameFilter).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("project") === "1" && !url.searchParams.has("f_name"));
    await otaLink.click();
    const drawer = page.getByTestId("package-drawer");
    await expect(drawer).toContainText("OTA 升级服务");
    await drawer.getByRole("tab", { name: "版本历史" }).click();
    await expect(drawer.getByRole("link", { name: /构建地址/ }).first()).toBeVisible();
  });

  test("管理员可以导入已有转正历史版本", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "ADMIN001");
    await page.goto("/settings/packages/import");
    await page.locator('select[name="packageId"]').selectOption("2");
    await page.locator('input[name="version"]').fill("9.9.1");
    await page.locator('textarea[name="changeSummary"]').fill("系统切换前已发布的历史版本，补录用于全链路追溯。");
    await page.locator('input[name="archiveUrl"]').fill("https://packages.example.com/legacy/cfg-9.9.1.tar.gz");
    await page.locator('input[name="buildUrl"]').fill("https://ci.example.com/legacy/cfg-9.9.1");
    await page.locator('select[name="status"]').selectOption("FORMAL");
    await page.locator('input[name="formFlowNo"]').fill("EF-LEGACY-CFG-991");
    await page.locator('input[name="formalReleasedAt"]').fill("2026-11-01");
    await page.getByRole("button", { name: "导入历史版本" }).click();
    await expectFlash(page, "历史版本已导入");
    await expect(page.locator("body")).toContainText("9.9.1");
    await page.goto("/packages?project=1&open=2");
    const drawer = page.getByRole("dialog", { name: "软件包详情" });
    await drawer.getByRole("tab", { name: "版本历史" }).click();
    const importedVersion = drawer.getByRole("listitem").filter({ hasText: "9.9.1" });
    await importedVersion.getByRole("link", { name: "全链路追溯" }).click();
    await expect(page.getByText("转正电子流 EF-LEGACY-CFG-991")).toBeVisible();
    await expect(page.getByText("暂无项目转测记录。")).toBeVisible();
    await page.goto("/versions?project=1&q=1002CFG+9.9.1");
    const traceStatus = page.getByRole("button", { name: "筛选版本状态", exact: true });
    const statusMenu = page.getByRole("dialog", { name: "筛选版本状态", exact: true });
    await traceStatus.click();
    await statusMenu.getByRole("checkbox", { name: /试制/ }).first().check();
    await statusMenu.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.getByRole("heading", { name: "未找到版本" })).toBeVisible();
    await traceStatus.click();
    await statusMenu.getByRole("link", { name: "清除本列" }).click();
    const version = page.getByRole("link", { name: "9.9.1", exact: true });
    await expect(version).toBeVisible();
    await version.click();
    await expect(page.getByText("转正电子流 EF-LEGACY-CFG-991")).toBeVisible();
    await page.getByRole("link", { name: "返回版本列表" }).click();
    await expect(page).toHaveURL(url => url.searchParams.get("q") === "1002CFG 9.9.1");
    await page.goto("/versions?project=2&q=1002CFG+9.9.1");
    await expect(page.getByText("未找到版本", { exact: true })).toBeVisible();
  });

});
