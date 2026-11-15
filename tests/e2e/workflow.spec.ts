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

async function areaCard(page: Page, name: string): Promise<Locator> {
  return page.locator("section.card").filter({ has: page.getByRole("heading", { name, exact: true }) }).first();
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
    const details = page.locator("details[open]").first();
    await details.locator('textarea[name="comment"]').fill("自动化验证：设备条码与试制版本匹配，审批通过。");
    await details.getByRole("button", { name: "审批通过" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    if (page.url().includes("/formal")) break;
  }
}

async function submitBindingFlow(page: Page, nodeName: string, barcodes: string[]) {
  const requirement = page.locator(".binding-requirement").filter({ hasText: nodeName }).first();
  const addButton = requirement.getByRole("button", { name: "添加条码" });
  let inputs = requirement.locator('input[placeholder="输入或扫描设备条码"]');
  while ((await inputs.count()) < barcodes.length) {
    await addButton.click();
    inputs = requirement.locator('input[placeholder="输入或扫描设备条码"]');
  }
  for (let index = 0; index < barcodes.length; index += 1) {
    await inputs.nth(index).fill(barcodes[index]);
  }
  await requirement.getByRole("button", { name: "提交绑定电子流" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

test.describe("工程协同台项目维度流程", () => {
  test("责任田主管、项目负责人、项目成员三级管理", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "ADMIN001");
    await page.goto("/settings/areas");
    const newAreaForm = page.getByTestId("new-area-form");
    await newAreaForm.locator('input[name="name"]').fill(areaName);
    await newAreaForm.locator('textarea[name="description"]').fill("验证责任田主管负责制与项目成员分级维护。");
    await newAreaForm.getByRole("button", { name: "创建责任田" }).click();
    await expectFlash(page, "责任田已创建");

    let card = await areaCard(page, areaName);
    const leaderPanel = card.locator(".inset-panel").first();
    await leaderPanel.locator("summary").filter({ hasText: "添加主管" }).click();
    await chooseByText(leaderPanel.locator('select[name="userId"]'), "郑一");
    await leaderPanel.getByRole("button", { name: "设置主管" }).click();
    await expectFlash(page, "责任田主管已设置");
    await expect(await areaCard(page, areaName)).toContainText("郑一");

    await login(page, "OWNER004");
    await page.goto("/settings/areas");
    await expect(page.getByTestId("new-area-form")).toHaveCount(0);
    card = await areaCard(page, areaName);
    let n1Row = card.locator(".area-project-row").filter({ hasText: "星云 N1" }).first();
    await n1Row.locator("summary").filter({ hasText: "添加负责人" }).click();
    let openDetails = n1Row.locator("details[open]").first();
    await chooseByText(openDetails.locator('select[name="userId"]'), "王磊");
    await openDetails.getByRole("button", { name: "设置项目负责人" }).click();
    await expectFlash(page, "项目负责人已设置");

    await login(page, "OWNER001");
    await page.goto("/settings/areas");
    card = await areaCard(page, areaName);
    n1Row = card.locator(".area-project-row").filter({ hasText: "星云 N1" }).first();
    await n1Row.locator("summary").filter({ hasText: "添加成员" }).click();
    openDetails = n1Row.locator("details[open]").first();
    await chooseByText(openDetails.locator('select[name="userId"]'), "陈曦");
    await openDetails.getByRole("button", { name: "添加项目成员" }).click();
    await expectFlash(page, "项目成员已添加");
    card = await areaCard(page, areaName);
    await expect(card).toContainText("王磊");
    await expect(card).toContainText("陈曦");
  });

  test("项目节点绑定配置排版正常且可修改通过数量", async ({ page }) => {
    acceptDialogs(page);
    await login(page, "ADMIN001");
    await page.goto("/settings/projects");
    const projectForm = page.getByTestId("new-project-form");
    await projectForm.locator('input[name="name"]').fill(projectName);
    await projectForm.locator('input[name="code"]').fill(projectCode);
    await projectForm.locator('textarea[name="description"]').fill("验证项目节点绑定责任和配置表单布局。");
    await selectOptionContaining(projectForm.locator('select[name="pmUserId"]'), "许言");
    await selectOptionContaining(projectForm.locator('select[name="softwareManagerId"]'), "林澈");
    await projectForm.getByRole("button", { name: "创建项目" }).click();
    await expectFlash(page, "项目已创建");

    const projectCard = cardByHeading(page, projectName);
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

    await login(page, "OWNER001");
    await expect(page.locator(".personal-alert").filter({ hasText: "1008MED 4.2.0" })).toContainText("测试异常");
    await login(page, "VALID001");
    await expect(page.locator(".personal-task").filter({ hasText: "1006KEY" }).first()).toBeVisible();
  });

  test("整套配套转测不提供可选框，允许并行批次，软件经理不能提交测试结论", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/integration/new?project=1");
    const builder = page.getByTestId("batch-builder-form");
    await expect(builder).toBeVisible();
    await expect(builder.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(builder.locator(".compact-batch-table tbody tr")).toHaveCount(8);
    await page.locator('input[name="code"]').fill("B950");
    await page.locator('input[name="title"]').fill("星云 N1 整套配套自动化验证");
    await page.getByRole("button", { name: "创建整套配套批次" }).click();
    await expectFlash(page, "整套配套转测草稿已创建");
    await expect(page.locator("h1")).toContainText("B950");
    await expect(page.locator(".data-table tbody tr")).toHaveCount(8);
    await page.getByRole("button", { name: "发起转测" }).click();
    await expectFlash(page, "B950 已发起集成测试");
    await expect(page.locator('input[name="reportFile"]')).toHaveCount(0);
    await page.locator("summary").filter({ hasText: "填写原因并终止" }).click();
    await page.locator('textarea[name="reason"]').fill("自动化验证：整套配套草稿与并发批次流程验证完成。");
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
    const readyCard = page.locator("article.card").filter({ hasText: "1001OTA" }).filter({ hasText: "星云 N1" }).first();
    await expect(readyCard).toContainText("待发试制");
    await readyCard.getByText("提交本项目试制电子流", { exact: true }).click();
    await readyCard.locator('input[name="trialFormNo"]').fill("EF-TRIAL-N1-OTA-160");
    await readyCard.getByRole("button", { name: "发布本项目试制版本" }).click();
    await expectFlash(page, "试制版本已发布");
    otaTrialUrl = page.url().split("?")[0];
    expect(otaTrialUrl).toMatch(/\/trial\/\d+$/);
    await expect(page.locator(".binding-requirement")).toHaveCount(3);

    await login(page, "VALID001");
    await page.goto(otaTrialUrl);
    await submitBindingFlow(page, "EVT", ["N1-OTA-EVT-001", "N1-OTA-EVT-002"]);
    await submitBindingFlow(page, "EVT", ["N1-OTA-EVT-003"]);
    await submitBindingFlow(page, "DVT", ["N1-OTA-DVT-001"]);
    await submitBindingFlow(page, "PVT", ["N1-OTA-PVT-001"]);
    await expect(page.getByText("N1-OTA-EVT-003")).toHaveCount(1);

    await login(page, "OWNER001");
    await page.goto(otaTrialUrl);
    await approveAllBindingFlows(page);
    await page.waitForTimeout(300);
    expect(page.url()).toContain("/formal");

    await login(page, "MGR001");
    await page.goto("/formal");
    const formalCard = page.locator("article.card").filter({ hasText: "1001OTA" }).filter({ hasText: "星云 N1" }).first();
    await expect(formalCard).toContainText("待转正");
    await formalCard.locator('input[name="flowNo"]').fill("EF-OTA-160");
    await formalCard.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expectFlash(page, "正式版本已发布");

    await page.goto("/packages?project=1");
    const otaRow = page.locator(".data-table tbody tr").filter({ hasText: "1001OTA" }).first();
    await expect(otaRow).toContainText("1.6.0");
    await expect(otaRow).not.toContainText("待发试制");

    await login(page, "VALID001");
    await expect(page.locator(".side-list-item").filter({ hasText: "1001OTA" }).first()).toBeVisible();
  });

  test("作废项目试制版本后提醒绑定责任人撤销电子流", async ({ page }) => {
    test.setTimeout(120_000);
    acceptDialogs(page);
    await login(page, "MGR001");
    await page.goto("/trial");
    const keyCard = page.locator("article.card").filter({ hasText: "1006KEY" }).filter({ hasText: "星云 N1" }).first();
    await keyCard.getByRole("link", { name: /处理/ }).click();
    await page.getByText("填写原因并作废").click();
    await page.locator('textarea[name="reason"]').fill("自动化验证：绑定验证不通过，作废本项目试制版本。");
    await page.getByRole("button", { name: "确认作废本项目试制版本" }).click();
    await expectFlash(page, "试制版本已作废");

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

  test("软件包总览按项目查看并排除存档项目使用范围", async ({ page }) => {
    await login(page, "OWNER001");
    await page.goto("/packages");
    await expect(page.locator(".data-table")).not.toContainText("远山 X0");
    await page.goto("/packages?project=1");
    await expect(page.locator('select[name="project"]')).toHaveValue("1");
    const table = page.locator(".data-table");
    await expect(table).toContainText("1001OTA");
    await expect(table).not.toContainText("远山 X0");
    await expect(table).not.toContainText("极光 M2");

    await page.goto("/projects");
    await page.getByRole("button", { name: "存档项目" }).click();
    await expect(page.getByRole("heading", { name: "远山 X0" })).toBeVisible();
    await expect(page.locator(".data-table")).toContainText("1001OTA");
    await expect(page.locator(".data-table")).toContainText("1008MED");
  });
});
