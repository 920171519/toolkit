import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  cardByHeading,
  expectFlash,
  login,
  selectOptionContaining,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const areaName = "E2E 显示责任田";
const projectName = "E2E 项目维度验证";
const projectCode = "E2EP4";
let otaTrialUrl = "";

function acceptDialogs(page: Page) {
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
}

async function chooseByText(select: Locator, text: string) {
  const options = await select.locator("option").evaluateAll((items) =>
    items.map((item) => ({ value: (item as HTMLOptionElement).value, text: item.textContent ?? "" })),
  );
  const option = options.find((item) => item.text.includes(text));
  if (!option) throw new Error("未找到选项 " + text);
  await select.selectOption(option.value);
}

async function approveAllBindingFlows(page: Page) {
  for (let index = 0; index < 8; index += 1) {
    const summary = page.locator("summary").filter({ hasText: "审批电子流" }).first();
    if ((await summary.count()) === 0) break;
    await summary.click();
    const details = summary.locator("..");
    await details.locator('textarea[name="comment"]').fill("自动化验证：设备条码与试制版本匹配，审批通过。");
    await details.getByRole("button", { name: "审批通过" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    if (page.url().includes("/formal")) break;
  }
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

    await expect(page.getByRole("heading", { level: 1, name: areaName })).toBeVisible();
    const areaPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "添加主管", exact: true }).click();
    const leaderDialog = page.getByRole("dialog", { name: "添加责任田主管" });
    await leaderDialog.getByRole("searchbox").fill("OWNER004");
    await leaderDialog.getByRole("radio", { name: /郑一/ }).check();
    await leaderDialog.getByRole("button", { name: "设置主管" }).click();
    await expectFlash(page, "责任田主管已设置");
    await expect(page.getByRole("region", { name: "责任田主管", exact: true })).toContainText("郑一");

    await login(page, "OWNER004");
    await page.goto(areaPath);
    await expect(page.getByRole("button", { name: "添加主管", exact: true })).toHaveCount(0);
    const n1Row = page.locator('[data-testid^="area-project-"]').filter({ hasText: "星云 N1" }).first();
    await n1Row.getByRole("button", { name: "添加负责人", exact: true }).click();
    const leadDialog = page.getByRole("dialog", { name: /星云 N1 · 添加负责人/ });
    await leadDialog.getByRole("searchbox").fill("王磊");
    await leadDialog.getByRole("radio", { name: /王磊/ }).check();
    await leadDialog.getByRole("button", { name: "设置项目负责人" }).click();
    await expectFlash(page, "项目负责人已设置");

    await login(page, "OWNER001");
    await page.goto(areaPath);
    await expect(n1Row.getByRole("button", { name: "移除负责人", exact: true })).toHaveCount(0);
    await n1Row.getByRole("button", { name: "添加成员", exact: true }).click();
    const memberDialog = page.getByRole("dialog", { name: /星云 N1 · 添加成员/ });
    await memberDialog.getByRole("searchbox").fill("陈曦");
    await memberDialog.getByRole("radio", { name: /陈曦/ }).check();
    await memberDialog.getByRole("button", { name: "添加项目成员" }).click();
    await expectFlash(page, "项目成员已添加");
    await expect(memberDialog).toBeHidden();
    await expect(n1Row).toContainText("王磊");
    await n1Row.getByRole("button", { name: "1 人", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /星云 N1 · 项目成员/ })).toContainText("陈曦");

    await login(page, "ADMIN001");
    await page.goto("/settings/users");
    const area = page.getByRole("combobox", { name: "责任田", exact: true });
    await area.selectOption({ label: areaName });
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    const rows = page.getByRole("table", { name: "人员列表" }).locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "郑一" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "王磊" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "陈曦" })).toHaveCount(1);
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

    const projectCard = cardByHeading(page, projectName);
    await expect(projectCard).toContainText("许言");
    await expect(projectCard).toContainText("王磊");
    await expect(projectCard).toContainText("林澈");
    await expect(projectCard).toContainText("沈清");
    await projectCard.locator("summary").filter({ hasText: "编辑项目" }).click();
    const editForm = projectCard.locator('form[data-testid^="edit-project-form-"]').first();
    await expect(editForm).toBeVisible();
    await expect(editForm.locator('input[name="sortOrder"]')).toHaveCount(0);
    await projectCard.getByText("取消编辑", { exact: true }).click();
    await projectCard.locator("summary").filter({ hasText: "添加节点" }).click();
    const addForm = projectCard.locator('form[data-testid^="add-node-form-"]').first();
    await expect(addForm).toBeVisible();
    const cardBox = await projectCard.boundingBox();
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

    const nodeRow = page.locator(".node-config-row").filter({ hasText: "SIT" }).first();
    await expect(nodeRow).toContainText("绑定责任人 韩松");
    await nodeRow.locator("summary").filter({ hasText: "配置节点" }).click();
    await nodeRow.locator('input[name="requiredBindingCount"]').fill("2");
    await nodeRow.getByRole("button", { name: "保存节点配置" }).click();
    await expectFlash(page, "项目节点绑定配置已更新");
    await expect(page.locator(".node-config-row").filter({ hasText: "SIT" }).first()).toContainText("通过数量要求 2");
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
    await expect(page.getByRole("heading", { level: 1 })).toContainText("林澈");
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
    await expect(page.locator("article.card").filter({ hasText: "极光 M2" }).first()).toBeVisible();
    await expect(page.locator("article.card").filter({ hasText: "星云 N1" })).toHaveCount(0);

    await page.goto("/overview");
    await expect(page.locator(".project-overview-row").filter({ hasText: "极光 M2" })).toHaveCount(1);
    await expect(page.locator(".project-overview-row").filter({ hasText: "星云 N1" })).toHaveCount(1);
    await page.goto("/projects/1");
    await expect(page.getByRole("region", { name: "项目基本资料" })).toContainText("需要项目流程权限");
    await expect(page.locator("#batches")).toHaveCount(0);

    await login(page, "TEST001");
    await page.goto("/submissions");
    await expect(page.locator(".project-request-group").filter({ hasText: "星云 N1" }).first()).toBeVisible();
    await expect(page.locator(".project-request-group").filter({ hasText: "极光 M2" }).first()).toBeVisible();
    await expect(page.locator(".project-request-group").filter({ hasText: "磐石 T3" }).first()).toBeVisible();

    await login(page, "OWNER001");
    await expect(page.locator(".personal-alert").filter({ hasText: "1008MED 4.2.0" })).toContainText("测试异常");
    await login(page, "VALID001");
    await expect(page.locator(".personal-task").filter({ hasText: "1006KEY" }).first()).toBeVisible();
    await page.goto("/trial");
    await expect(page.getByRole("heading", { name: "试制版本绑定验证" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "待发布试制" })).toHaveCount(0);

    await login(page, "MGR001");
    await page.goto("/trial");
    await expect(page.getByRole("heading", { name: "待发布试制" })).toBeVisible();
  });

  test("试制超期在项目工作区和试制页提示", async ({ page }) => {
    await login(page, "MGR001");
    await page.goto("/projects/1");
    await expect(page.locator("#trials")).toContainText("已超期");
    await page.goto("/trial");
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

  test("待转测申请通过弹窗提交，并可撤回", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "OWNER001");
    await page.goto("/submissions");
    await page.getByTestId("submit-transfer-trigger").click();
    const form = page.getByTestId("transfer-form");
    await expect(form).toBeVisible();
    await form.getByLabel("搜索软件包").fill("1003COM");
    await expect(form.getByText("没有匹配的软件包")).toBeVisible();
    await form.getByLabel("搜索软件包").fill("1002CFG");
    await form.getByTestId(/transfer-package-/).filter({ hasText: "1002CFG" }).click();
    await form.locator('input[name="version"]').fill("2.3.0");
    await form.locator('textarea[name="changeSummary"]').fill("自动化验证：通过待转测申请弹窗提交新版本。");
    await form.locator('input[name="archiveUrl"]').fill("https://packages.example.com/e2e/1002cfg-2.3.0.tar.gz");
    await form.locator('input[name="buildUrl"]').fill("https://ci.example.com/e2e/1002cfg-2.3.0");
    await expect(form.getByRole("button", { name: "提交申请" })).toBeEnabled();
    await form.getByRole("button", { name: "提交申请" }).click();
    await expectFlash(page, "转测申请已提交，并发送至 2 个项目");
    await expect(page.locator(".project-request-group").filter({ hasText: "1002CFG" }).first()).toBeVisible();
    await page.locator(".project-request-group").filter({ hasText: "1002CFG" }).first().getByRole("button", { name: "撤回申请" }).click();
    await expectFlash(page, "转测申请已撤回");
    await expect(page.locator(".project-request-group").filter({ hasText: "1002CFG" })).toHaveCount(0);
  });

  test("整套配套转测在待转测申请页完成，集成测试页只保留在测批次", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/submissions");
    await page.getByTestId("open-batch-1").click();
    const builder = page.getByTestId("batch-builder-form");
    await expect(builder).toBeVisible();
    await expect(page.locator('input[name="code"]')).toHaveValue("B123");
    await expect(builder.getByRole("checkbox")).toHaveCount(8);
    await expect(builder.locator(".compact-batch-table tbody tr")).toHaveCount(8);
    await expect(builder.locator(".compact-batch-table select")).toHaveCount(8);
    const otaRow = builder.locator(".compact-batch-table tbody tr").filter({ hasText: "1001OTA" }).first();
    await expect(otaRow.locator("select option:checked")).toContainText("1.5.2");
    const comRow = builder.locator(".compact-batch-table tbody tr").filter({ hasText: "1003COM" }).first();
    await expect(comRow.locator("select option:checked")).toContainText("2.1.0");
    await chooseByText(comRow.locator("select"), "2.0.3");
    await expect(comRow.locator("select option:checked")).toContainText("2.0.3");
    await builder.getByRole("checkbox", { name: "本轮转测 1003COM" }).uncheck();
    await expect(comRow.locator("select")).toBeDisabled();
    await page.locator('input[name="code"]').fill("B950");
    await page.locator('input[name="title"]').fill("星云 N1 整套配套自动化验证");
    await page.getByRole("button", { name: "创建整套配套批次" }).click();
    await expectFlash(page, "整套配套转测草稿已创建");
    const draftRow = page.locator(".data-table tbody tr").filter({ hasText: "B950" }).first();
    await expect(draftRow).toBeVisible();
    await expect(draftRow).toContainText("星云 N1");
    await expect(page.locator(".project-request-group").getByText("1003COM", { exact: true })).toBeVisible();
    await draftRow.getByRole("link", { name: "查看 B950 配套" }).click();
    await expect(page.getByRole("row", { name: /1003COM/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /1001OTA/ })).toBeVisible();
    await page.goBack();
    await draftRow.getByRole("button", { name: "发起转测" }).click();
    await expectFlash(page, "B950 已发起集成测试");

    await page.goto("/integration");
    const activeCard = page.locator("article.card").filter({ hasText: "B950" }).first();
    await expect(activeCard).toContainText("集成测试中");
    await expect(page.getByText("待组织转测", { exact: false })).toHaveCount(0);
    await activeCard.getByRole("link", { name: /查看批次/ }).click();
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);
    await page.locator("summary").filter({ hasText: "填写原因并终止" }).click();
    await page.locator('textarea[name="reason"]').fill("验证完成");
    await page.getByRole("button", { name: "确认终止测试" }).click();
    await expectFlash(page, "本批次已终止");
  });

  test("集成测试责任田负责人提交结论并上传验证报告", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/integration/4");
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);

    await login(page, "TEST002");
    await page.goto("/integration/4");
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);

    await login(page, "TEST001");
    await page.goto("/integration/4");
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(1);
    await page.locator('[data-testid="add-batch-progress-form"] textarea[name="content"]').fill("N1 配置专项已完成第一轮验证，配置下发、回读和异常断电场景均通过，准备提交最终结论。");
    await page.getByRole("button", { name: "提交进展说明" }).click();
    await expectFlash(page, "进展说明已提交");
    await expect(page.locator(".timeline-title").filter({ hasText: "第一轮验证" })).toBeVisible();
    await page.locator('textarea[name="testSummary"]').fill("集成测试责任田验证：N1 配置专项全部通过，无新增阻塞问题。");
    await page.locator('input[name="reportFile"]').setInputFiles({
      name: "B120-verification-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 automated verification report"),
    });
    await page.getByRole("button", { name: "提交验证结论" }).click();
    await expectFlash(page, "验证报告已上传");
    await expect(page.locator("a.archive-link").filter({ hasText: "B120-verification-report.pdf" })).toBeVisible();
  });

  test("项目试制、多个设备条码电子流审批与项目转正", async ({ page }) => {
    test.setTimeout(240_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/trial");
    const readyRow = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row")
      .filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.0" }).filter({ hasText: "星云 N1" });
    await expect(readyRow).toContainText("待发试制");
    await readyRow.getByRole("button", { name: "发布全项目共享试制", exact: true }).click();
    const publication = page.getByRole("dialog", { name: "发布 1001OTA 1.6.0 试制" });
    await publication.locator('input[name="trialFormNo"]').fill("EF-TRIAL-N1-OTA-160");
    await publication.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await expectFlash(page, "试制版本已发布");
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

    // N1 绑定完成后，共享试制版本还等待 M2 完成绑定。
    await login(page, "VALID001");
    await page.goto("/trial");
    const m2Row = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).filter({ hasText: "极光 M2" }).filter({ hasText: "1.6.0" }).first();
    await expect(m2Row).toBeVisible();
    const m2Href = await m2Row.getByRole("link", { name: /处理/ }).getAttribute("href");
    expect(m2Href).toBeTruthy();
    await page.goto(new URL(m2Href!, page.url()).toString());
    await expect(page).toHaveURL(/\/trial\/\d+$/);
    const m2TrialUrl = page.url().split("?")[0];
    await submitBindingFlow(page, "PVT", ["M2-OTA-PVT-001"], "陈曦");
    await login(page, "OWNER002");
    await page.goto(m2TrialUrl);
    await approveAllBindingFlows(page);
    await page.waitForTimeout(300);
    expect(page.url()).toContain("/formal");

    await login(page, "MGR001");
    await page.goto("/formal");
    const formalCard = page.locator("article.card").filter({ hasText: "1001OTA" }).filter({ hasText: "星云 N1" }).first();
    await expect(formalCard).toContainText("待转正");
    await expect(formalCard).toContainText("极光 M2");
    const bindingDetails = formalCard.locator("details.formal-binding-details");
    await bindingDetails.locator("summary").click();
    await expect(bindingDetails).toContainText("N1-OTA");
    await expect(bindingDetails.locator("a").filter({ hasText: "网页电子流" }).first()).toBeVisible();
    await formalCard.locator('input[name="flowNo"]').fill("EF-OTA-160");
    await formalCard.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expectFlash(page, "同步发布正式版本");

    await page.goto("/packages?project=1");
    const otaRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).first();
    await expect(otaRow).toContainText("1.6.0");

    await login(page, "VALID001");
    await expect(page.locator(".side-list-item").filter({ hasText: "1001OTA" }).first()).toBeVisible();
  });

  test("作废项目试制版本后提醒绑定责任人撤销电子流", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/trial");
    const keyRow = page.locator(".data-table tbody tr").filter({ hasText: "1006KEY" }).filter({ hasText: "星云 N1" }).first();
    await keyRow.getByRole("link", { name: /处理/ }).click();
    await page.getByText("填写原因并作废").click();
    await page.locator('textarea[name="reason"]').fill("自动化验证：绑定验证不通过，作废本项目试制版本。");
    await page.getByRole("button", { name: "确认作废共享试制版本" }).click();
    await expectFlash(page, "试制版本已作废");

    await page.goto("/submissions");
    await page.getByTestId("open-batch-1").click();
    const keySelect = page.locator(".compact-batch-table tbody tr").filter({ hasText: "1006KEY" }).first().locator("select");
    await chooseByText(keySelect, "1.3.0");
    await expect(page.locator(".void-version-warning").first()).toContainText("已作废");
    await page.getByRole("button", { name: "关闭弹窗" }).click();

    await login(page, "VALID001");
    const voidAlert = page.locator(".personal-alert").filter({ hasText: "试制版本已作废" }).first();
    await expect(voidAlert).toContainText("1006KEY");
    await voidAlert.click();
    await page.getByRole("button", { name: "撤销电子流" }).first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await page.goto("/dashboard");
    await expect(page.locator(".personal-alert").filter({ hasText: "试制版本已作废" })).toHaveCount(0);
  });

  test("软件包使用范围跨项目展示，项目总览进入项目工作区", async ({ page }) => {
    await login(page, "OWNER001");
    await page.goto("/packages");
    await expect(page.locator(".data-table")).not.toContainText("远山 X0");
    await page.goto("/packages?project=1");
    await expect(page.getByRole("combobox", { name: "查看范围" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "项目工作区" })).toHaveAttribute("href", "/projects/1");
    const table = page.locator(".data-table");
    await expect(table).toContainText("1001OTA");
    await expect(table).not.toContainText("远山 X0");
    await expect(table).toContainText("极光 M2");

    await page.getByRole("link", { name: "1001OTA", exact: true }).click();
    await expect(page.getByTestId("package-drawer")).toBeVisible();
    await expect(page.getByTestId("package-drawer")).toContainText("1001OTA");
    const traceLink = page.getByTestId("package-drawer").getByRole("link", { name: "全链路追溯" }).first();
    await expect(traceLink).toBeVisible();
    const traceHref = await traceLink.getAttribute("href");
    expect(traceHref).toBeTruthy();
    await page.goto(new URL(traceHref!, page.url()).toString());
    await expect(page).toHaveURL(/\/versions\/\d+\?project=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("1001OTA");
    await expect(page.getByText("项目版本与验收联动").first()).toBeVisible();
    await expect(page.getByText("绑定验证证据链").first()).toBeVisible();

    await page.goto("/overview");
    await page.locator(".project-overview-row").filter({ hasText: "极光 M2" }).getByRole("link", { name: "极光 M2", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/2$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("极光 M2");
    await expect(page.locator(".card").filter({ hasText: "软件包与全局使用范围" })).toContainText("星云 N1");
    await expect(page.getByText("项目版本流程记录").first()).toBeVisible();

    await page.goto("/overview");
    await page.locator(".project-overview-row").filter({ hasText: "远山 X0" }).getByRole("link", { name: "远山 X0", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/4$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("远山 X0");
    await expect(page.locator(".card").filter({ hasText: "软件包与全局使用范围" })).toContainText("1001OTA");
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
    acceptDialogs(page);
    await login(page, "MGR002");
    await page.goto("/trial");
    const risk = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row")
      .filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" });
    await expect(risk).toContainText("风险发布");
    await expect(risk).toContainText("未关联转测批次");
    await risk.getByRole("button", { name: "验收依据" }).click();
    const evidence = page.getByRole("dialog", { name: "1001OTA 1.6.1 验收依据" });
    await expect(evidence).toContainText("风险结论：");
    await evidence.getByRole("button", { name: "关闭弹窗" }).click();
    await risk.getByText("发布全项目共享试制", { exact: true }).click();
    const publication = page.getByRole("dialog", { name: /发布 1001OTA 1.6.1 试制/ });
    await publication.getByRole("button", { name: "取消", exact: true }).click();
    await expect(publication).toBeHidden();
    await risk.getByText("发布全项目共享试制", { exact: true }).click();
    await expect(publication.locator('textarea[name="riskConclusion"]')).toBeVisible();
    await publication.locator('input[name="trialFormNo"]').fill("EF-TRIAL-M2-OTA-161");
    await publication.locator('textarea[name="riskConclusion"]').fill("集成测试资源不足，按历史回归结论和风险评估结果发布共享试制。");
    await publication.getByRole("button", { name: "发布全项目共享试制版本" }).click();
    await expectFlash(page, "试制版本已发布");
    await page.goto("/trial");
    const trialRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" }).filter({ hasText: "极光 M2" }).first();
    await expect(trialRow).toContainText("风险发布");
    await expect(trialRow).toContainText("EF-TRIAL-M2-OTA-161");
  });

  test("集成测试中可风险试制，节点免绑后仍保留测试，失败时作废并提醒撤销", async ({ page }) => {
    test.setTimeout(150_000);
    acceptDialogs(page);
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
    await builder.getByRole("button", { name: "创建整套配套批次" }).click();
    await expectFlash(page, "转测草稿已创建");
    const draft = page.getByRole("row").filter({ hasText: "B953" });
    const batchUrl = await draft.getByRole("link", { name: "查看 B953 配套" }).getAttribute("href");
    if (!batchUrl) throw new Error("找不到待发起批次快照链接");
    await draft.getByRole("button", { name: "发起转测" }).click();
    await expectFlash(page, "B953 已发起集成测试");
    await page.goto("/trial?project=1");
    const pending = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row").filter({ hasText: version });
    await expect(pending).toContainText("风险发布");
    await expect(pending).toContainText("B953");
    await pending.getByRole("button", { name: "发布全项目共享试制", exact: true }).click();
    const publish = page.getByRole("dialog", { name: /发布 1001OTA/ });
    await publish.locator('input[name="trialFormNo"]').fill("EF-TRIAL-PARALLEL-E2E");
    await publish.locator('textarea[name="riskConclusion"]').fill("现场先行试制，集成测试同步继续，发现问题即撤回。");
    await publish.getByRole("button", { name: "发布全项目共享试制版本" }).click();
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
    await dvt.getByText("审批电子流", { exact: true }).click();
    await dvt.locator('textarea[name="comment"]').fill("已核对设备条码和网页电子流。");
    await dvt.getByRole("button", { name: "审批通过" }).click();
    await expect(dvt).toContainText("绑定通过");

    await login(page, "TEST001");
    await page.goto(batchUrl);
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
    await dvt.getByRole("button", { name: "撤销电子流" }).click();
    await expect(dvt.getByRole("button", { name: "撤销电子流" })).toHaveCount(0);
    await expect(dvt).toContainText("已核对设备条码和网页电子流");
  });


  test("项目配置多个软件经理均能获得项目流程权限", async ({ page }) => {
    test.setTimeout(90_000);
    acceptDialogs(page);
    await login(page, "ADMIN001");
    await page.goto("/settings/projects");
    const projectCard = cardByHeading(page, "星云 N1");
    await projectCard.locator("summary").filter({ hasText: "编辑项目" }).click();
    const editForm = projectCard.locator('form[data-testid^="edit-project-form-"]').first();
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
    await page.goto("/settings/projects");
    const revertCard = cardByHeading(page, "星云 N1");
    await revertCard.locator("summary").filter({ hasText: "编辑项目" }).click();
    const revertForm = revertCard.locator('form[data-testid^="edit-project-form-"]').first();
    await revertForm.locator('label.person-check').filter({ hasText: "沈清" }).locator('input[name="softwareManagerIds"]').uncheck();
    await revertForm.getByRole("button", { name: "保存项目配置" }).click();
    await expectFlash(page, "项目配置已更新");
  });
  test("集成测试结束后可以提交结论放弃发布试制", async ({ page }) => {
    test.setTimeout(90_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/trial");
    const abandonedRow = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row")
      .filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.2" }).filter({ hasText: "星云 N1" });
    await abandonedRow.getByRole("button", { name: "放弃发布试制", exact: true }).click();
    const abandonment = page.getByRole("dialog", { name: "放弃发布 1001OTA 1.6.2 试制" });
    await abandonment.locator('textarea[name="conclusion"]').fill("集成测试已完成，评估该临时版本不需要发布试制，计划直接废弃。");
    await abandonment.getByRole("button", { name: "提交结论并放弃试制" }).click();
    await expectFlash(page, "已提交放弃发布试制结论");
    await expect(abandonedRow).toHaveCount(0);
    await page.goto("/packages?project=1&open=1");
    const drawer = page.getByTestId("package-drawer");
    await expect(drawer).toContainText("1.6.2");
    await expect(drawer).toContainText("放弃试制");
  });

  test("试制可确认无需绑定直接转正，正式版本仍可作废", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/trial");
    const trialRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" }).filter({ hasText: "星云 N1" }).first();
    await expect(trialRow).toBeVisible();
    const href = await trialRow.getByRole("link", { name: /处理/ }).getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(new URL(href!, page.url()).toString());
    const versionHref = await page.getByRole("main").getByRole("link", { name: "版本全链路" }).getAttribute("href");
    expect(versionHref).toBeTruthy();
    await expect(page.getByRole("heading", { name: "绑定推送决策" })).toBeVisible();
    await page.getByText("无需绑定，直接进入待转正", { exact: true }).click();
    await page.getByPlaceholder(/该版本仅修复配置项/).fill("该版本只修复配置项，已完成整机集成验证，无需重复绑定设备条码。");
    await page.getByRole("button", { name: "确认无需绑定" }).click();
    await expectFlash(page, "全部使用项目进入待转正");
    await expect(page).toHaveURL(/\/formal/);
    const formalCard = page.locator("article.card").filter({ hasText: "1001OTA" }).filter({ hasText: "1.6.1" }).first();
    await expect(formalCard).toContainText("无需绑定");
    await formalCard.locator('input[name="flowNo"]').fill("EF-OTA-161");
    await formalCard.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expectFlash(page, "同步发布正式版本");

    await page.goto(new URL(versionHref!, page.url()).toString());
    await page.getByText("填写作废原因", { exact: true }).click();
    await page.locator('textarea[name="reason"]').fill("正式发布后发现该版本不再适用，按流程作废并停止使用。");
    await page.getByRole("button", { name: "确认作废该版本" }).click();
    await expectFlash(page, "该软件包版本已作废");
  });

  test("软件包总览支持按列筛选，详情展示说明与构建地址", async ({ page }) => {
    await login(page, "OWNER001");
    await page.goto("/packages?project=1");
    await expect(page.locator(".package-filter-row")).toBeVisible();
    await page.locator('select[aria-label="筛选使用项目"]').selectOption({ label: "极光 M2" });
    await page.locator('select[aria-label="筛选使用节点"]').selectOption({ label: "EVT" });
    const rows = page.locator(".data-table tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText("EVT");
    await page.goto("/packages?project=1&open=1");
    const drawer = page.getByTestId("package-drawer");
    await expect(drawer).toContainText("OTA 升级服务");
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
    const importedVersion = page.getByRole("dialog", { name: "软件包详情" })
      .locator(".drawer-version").filter({ hasText: "9.9.1" });
    await importedVersion.getByRole("link", { name: "全链路追溯" }).click();
    await expect(page.getByText("转正电子流 EF-LEGACY-CFG-991")).toBeVisible();
    await expect(page.getByText("暂无项目转测记录。")).toBeVisible();
    await page.goto("/versions?project=1&q=1002CFG+9.9.1");
    await expect(page.getByRole("link", { name: "9.9.1" })).toBeVisible();
    await page.goto("/versions?project=2&q=1002CFG+9.9.1");
    await expect(page.getByText("未找到版本", { exact: true })).toBeVisible();
  });

});
