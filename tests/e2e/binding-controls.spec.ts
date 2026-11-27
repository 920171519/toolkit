import type { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import { bindingBarcodeResult, confirmBindingNode, expectFlash, login, saveBindingBarcodeResults, savePassedBindingBarcodes } from "./helpers";
import { openE2eDatabase } from "./storage";

const testVersion = "2.0.0-binding-controls-e2e";

function setupBindingFixture(db: DatabaseSync, version = testVersion, projectCodes = ["N1", "M2"], requiredCount = 1) {
  const versionId = Number(db.prepare(
    `INSERT INTO package_versions
       (package_id, version, change_summary, archive_url, status, binding_mode, trial_form_no,
        trial_released_at, submitted_at, updated_at)
     SELECT id, ?, '绑定流程回归专用', 'https://example.com/archive', 'TRIAL', 'PUSHED',
            'https://example.com/trial', datetime('now'), datetime('now'), datetime('now')
     FROM packages WHERE name = '1004NET'`,
  ).run(version).lastInsertRowid);
  try {
    const requestIds = projectCodes.map((projectCode) => {
      const requestId = Number(db.prepare(
        `INSERT INTO version_transfer_requests
           (package_version_id, project_id, status, integration_status, trial_form_no, trial_released_at, submitted_at, updated_at)
         SELECT ?, id, 'TRIAL', 'PASSED', 'https://example.com/trial', datetime('now'), datetime('now'), datetime('now')
         FROM projects WHERE code = ?`,
      ).run(versionId, projectCode).lastInsertRowid);
      db.prepare(
        `INSERT INTO binding_requirements
           (request_id, package_version_id, project_id, node_id, required_count, binding_owner_id, approver_id,
            pushed_at, created_at, updated_at)
         SELECT r.id, r.package_version_id, r.project_id, n.id, ?, owner.id, approver.id,
                datetime('now'), datetime('now'), datetime('now')
         FROM version_transfer_requests r JOIN project_nodes n ON n.project_id = r.project_id
         JOIN users owner ON owner.employee_id = 'VALID001'
         JOIN users approver ON approver.employee_id = 'OWNER001'
         WHERE r.id = ? ORDER BY n.sort_order, n.id LIMIT 1`,
      ).run(requiredCount, requestId);
      return requestId;
    });
    return { versionId, requestIds };
  } catch (error) {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    throw error;
  }
}

function flowRow(page: Page, barcode: string) {
  return page.locator(".binding-flow-row").filter({ hasText: barcode });
}

async function submitFlow(page: Page, barcode: string | string[]) {
  const barcodes = typeof barcode === "string" ? [barcode] : barcode;
  await page.getByRole("button", { name: "新增绑定电子流", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /提交绑定电子流/ });
  await dialog.getByLabel("设备条码").fill(barcodes.join("\n"));
  await dialog.getByLabel("网页电子流地址").fill("https://example.com/binding/" + barcodes[0]);
  await dialog.getByRole("button", { name: "提交绑定电子流", exact: true }).click();
  await expectFlash(page, "绑定电子流已提交");
  await expect(flowRow(page, barcodes[0])).toBeVisible();
}

async function approveFlow(page: Page, barcode: string, reviewer = "张启明") {
  await flowRow(page, barcode).getByRole("button", { name: "审批电子流", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /审批 BF-/ });
  await dialog.getByLabel("审批意见").fill("已核对本次绑定的设备条码。");
  await dialog.getByRole("button", { name: "审批通过", exact: true }).click();
  await expectFlash(page, /绑定电子流已通过|绑定电子流审批通过/);
  await expect(flowRow(page, barcode)).toContainText(`实际审批人 ${reviewer}`);
}

async function withdrawFlow(page: Page, barcode: string) {
  const reason = "设备已在原电子流撤销。";
  await flowRow(page, barcode).getByRole("button", { name: "撤销电子流", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^撤销 BF-/ });
  await dialog.getByLabel("撤销原因").fill(reason);
  await dialog.getByRole("button", { name: "确认撤销电子流", exact: true }).click();
  await expectFlash(page, "绑定电子流已撤销");
  await expect(flowRow(page, barcode)).toContainText(reason);
}

test("绑定权限按节点和单据指派，审批人只查看指派给自己的电子流", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { versionId, requestIds: [requestId] } = setupBindingFixture(db, "2.0.0-binding-assignment-scope-e2e", ["N1"]);
  const trial = `/trial/${requestId}?project=1`;
  const node = page.locator(".binding-requirement");
  const newFlow = page.getByRole("button", { name: "新增绑定电子流", exact: true, includeHidden: true });
  const assignedBarcode = "BINDING-DUTY-ASSIGNED";
  const otherFlow = "BF-E2E-OTHER-APPROVER";
  try {
    db.prepare(`INSERT INTO binding_requirements
       (request_id, package_version_id, project_id, node_id, binding_owner_id, approver_id, pushed_at, created_at, updated_at)
       SELECT r.id, r.package_version_id, r.project_id, n.id, owner.id, approver.id, datetime('now'), datetime('now'), datetime('now')
       FROM version_transfer_requests r JOIN project_nodes n ON n.project_id = r.project_id
       JOIN users owner ON owner.employee_id = 'TEST001' JOIN users approver ON approver.employee_id = 'MGR001'
       WHERE r.id = ? AND NOT EXISTS (SELECT 1 FROM binding_requirements b WHERE b.request_id = r.id AND b.node_id = n.id)
       ORDER BY n.sort_order, n.id LIMIT 1`).run(requestId);
    await page.goto(trial);
    await expect(node).toHaveCount(1);
    await submitFlow(page, assignedBarcode);

    db.prepare(`INSERT INTO binding_flows
       (flow_no, requirement_id, package_version_id, project_id, node_id, device_barcode, web_url, submitted_by, approver_id, status, submitted_at)
       SELECT ?, f.requirement_id, f.package_version_id, f.project_id, f.node_id, 'BINDING-DUTY-OTHER',
              'https://example.com/other-binding', f.submitted_by, u.id, 'PENDING', datetime('now')
       FROM binding_flows f JOIN users u ON u.employee_id = 'MGR001'
       WHERE f.package_version_id = ? AND f.device_barcode = ?`).run(otherFlow, versionId, assignedBarcode);
    await login(page, "OWNER001");
    await page.goto(trial);
    await expect(node).toHaveCount(1);
    await expect(flowRow(page, assignedBarcode)).toBeVisible();
    await expect(page.getByText(otherFlow, { exact: true })).toHaveCount(0);
    await expect(newFlow).toHaveCount(0);
    await approveFlow(page, assignedBarcode, "王磊");

    await login(page, "MGR001");
    await page.goto(trial);
    await expect(node).toHaveCount(2);
    await expect(page.getByText(otherFlow, { exact: true })).toHaveCount(1);
    await expect(newFlow).toHaveCount(0);
    await login(page, "ADMIN001");
    await page.goto(trial);
    await expect(newFlow).toHaveCount(2);
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

test("只有软件包责任人、本项目软件经理和管理员可确认节点，通过记录可追溯", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const version = "2.0.0-node-confirmation-e2e";
  const { versionId, requestIds: [requestId] } = setupBindingFixture(db, version, ["N1"]);
  const trial = `/trial/${requestId}?project=1`;
  const node = page.locator(".binding-requirement");
  const confirmation = node.getByRole("button", { name: "确认节点通过", exact: true, includeHidden: true });
  const submit = node.getByRole("button", { name: "新增绑定电子流", exact: true });
  const confirmTask = page.getByRole("link", { name: /确认节点通过/ }).filter({ hasText: version });
  const statuses = () => db.prepare(
    `SELECT br.status AS nodeStatus, r.status AS requestStatus, br.confirmed_at AS confirmedAt, u.employee_id AS confirmedBy
       FROM binding_requirements br JOIN version_transfer_requests r ON r.id = br.request_id
       LEFT JOIN users u ON u.id = br.confirmed_by
      WHERE br.request_id = ?`,
  ).get(requestId);

  try {
    await page.goto(trial);
    await expect(confirmation).toHaveCount(0);
    await submitFlow(page, "NODE-CONFIRM-QA");
    await login(page, "ADMIN001");
    await page.goto(trial);
    await approveFlow(page, "NODE-CONFIRM-QA");
    await expect(node.locator("summary").first()).toContainText("0/1 条码通过");
    await expect(node.locator("summary").first()).toContainText("待判定");
    await expect(confirmation).toBeVisible();
    await expect.poll(async () => {
      const waive = node.getByRole("button", { name: "节点无需绑定", exact: true });
      const boxes = await Promise.all([confirmation, submit, waive].map((button) => button.boundingBox()));
      const centers = boxes.flatMap((box) => box ? [box.y + box.height / 2] : []);
      return centers.length === 3 ? Math.max(...centers) - Math.min(...centers) : Infinity;
    }).toBeLessThanOrEqual(1);
    expect(statuses()).toMatchObject({ nodeStatus: "PENDING", requestStatus: "TRIAL", confirmedAt: null, confirmedBy: null });
    const versionFlow = `/versions/${versionId}?project=1`;
    const evidence = page.locator("#version-binding");
    const projectEvidence = evidence.locator("summary").filter({ hasText: "星云 N1" });
    await page.goto(versionFlow);
    await projectEvidence.click();
    await expect(evidence.getByText(/0\/1.*条码|通过条码.*0\/1/)).toBeVisible();
    await expect(evidence.getByText("节点通过", { exact: true })).toHaveCount(0);
    await page.goto(`/formal?project=1&q=${version}`);
    await expect(page.getByRole("row").filter({ hasText: version })).toHaveCount(0);

    await login(page, "MGR001");
    const validationTask = page.getByRole("link", { name: /判定设备条码/ }).filter({ hasText: version });
    await expect(confirmTask).toHaveCount(0);
    await expect(validationTask).toHaveAttribute("href", new RegExp(`^/trial/${requestId}#binding-node-[0-9]+$`));
    await validationTask.click();
    await savePassedBindingBarcodes(page, ["NODE-CONFIRM-QA"]);
    await expect(node.locator("summary").first()).toContainText("1/1 条码通过");
    await page.goto("/dashboard");
    await expect(confirmTask).toBeVisible();
    await page.goto(trial);
    await expect(confirmation).toHaveCount(1);

    await login(page, "OWNER001");
    await expect(confirmTask).toHaveCount(0);
    await page.goto(trial);
    await expect(node.locator("summary").first()).toContainText("待确认");
    await expect(confirmation).toHaveCount(0);
    await expect(bindingBarcodeResult(flowRow(page, "NODE-CONFIRM-QA"), "NODE-CONFIRM-QA", true)).toHaveCount(0);

    await login(page, "MGR002");
    await expect(confirmTask).toHaveCount(0);
    await page.goto(trial);
    await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();

    await login(page, "VALID001");
    await expect(confirmTask).toHaveCount(0);
    await page.goto(trial);
    await expect(submit).toBeVisible();
    await expect(confirmation).toHaveCount(0);

    await login(page, "OWNER002");
    await expect(confirmTask).toHaveAttribute("href", new RegExp(`^/trial/${requestId}#binding-node-[0-9]+$`));
    await confirmTask.click();
    await confirmBindingNode(page, node);
    await page.reload();
    await expect(node.locator("summary").first()).toContainText("绑定通过");
    await expect(confirmation).toHaveCount(0);
    expect(statuses()).toMatchObject({ nodeStatus: "PASSED", requestStatus: "PENDING_FORMAL", confirmedAt: expect.any(String), confirmedBy: "OWNER002" });

    await login(page, "ADMIN001");
    await page.goto(versionFlow);
    await projectEvidence.click();
    await expect(evidence.getByText("节点通过", { exact: true })).toBeVisible();
    await expect(evidence.getByText(/陈曦 确认通过/)).toBeVisible();
    await page.goto(`/formal?project=1&q=${version}`);
    await expect(page.getByRole("row").filter({ hasText: version }).getByRole("link", { name: "核对并转正" })).toBeVisible();
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

test("历史重复条码不能凑足通过数量，只有不同的已审批 PASS 计入", async ({ page }) => {
  await login(page, "MGR001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { versionId, requestIds: [requestId] } = setupBindingFixture(db, "2.0.0-duplicate-barcodes-e2e", ["N1"], 2);
  const trial = `/trial/${requestId}?project=1`;
  const node = page.locator(".binding-requirement");
  const summary = node.locator("summary").first();
  const confirm = node.getByRole("button", { name: "确认节点通过", exact: true });

  try {
    const addFlow = db.prepare(`INSERT INTO binding_flows
       (flow_no, requirement_id, package_version_id, project_id, node_id, device_barcode, submitted_by, approver_id, status, submitted_at)
       SELECT ?, id, package_version_id, project_id, node_id, ?, binding_owner_id, approver_id, ?, datetime('now')
       FROM binding_requirements WHERE request_id = ?`);
    const addPass = db.prepare(`INSERT INTO binding_flow_barcodes (flow_id, barcode, validation_result, created_at)
       VALUES (?, ?, 'PASS', datetime('now'))`);
    const seedPass = (flowNo: string, barcode: string, status: string) =>
      addPass.run(addFlow.run(flowNo, barcode, status, requestId).lastInsertRowid, barcode).lastInsertRowid;
    seedPass("BF-LEGACY-CASE-1", "LEGACY-COUNT", "APPROVED");
    const second = seedPass("BF-LEGACY-CASE-2", "legacy-count", "APPROVED");
    seedPass("BF-LEGACY-CASE-3", "CANCELLED-COUNT", "CANCELLED");

    await page.goto(trial);
    await expect(summary).toContainText("2/2 条码通过");

    // Model pre-deduplication data imported without changing the flow identities or the form revision.
    db.prepare("UPDATE binding_flow_barcodes SET barcode = ? WHERE id = ?").run("LEGACY-COUNT", second);
    await confirm.click();
    await expect(node.getByRole("alert")).toContainText("有效条码数量尚未达标");
    expect(db.prepare("SELECT status FROM binding_requirements WHERE request_id = ?").get(requestId)?.status).toBe("PENDING");

    await page.goto(trial);
    await expect(summary).toContainText("1/2 条码通过");
    await confirm.click();
    await expect(page.getByRole("dialog", { name: /节点通过条件/ })).toContainText("还需 1 个通过条码");
    await login(page, "VALID001");
    await expect(page.getByRole("link", { name: /提交绑定电子流.*duplicate-barcodes/ })).toContainText("通过条码 1/2");
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

test("逐条记录混合判定，原因可先保存，补齐获批 PASS 后确认节点", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { versionId, requestIds: [requestId] } = setupBindingFixture(db, "2.0.0-mixed-barcodes-e2e", ["N1"], 2);
  const trial = `/trial/${requestId}?project=1`;
  const node = page.locator(".binding-requirement");
  const initialPass = "MIXED-PASS-01";
  const fails = ["MIXED-FAIL-01", "LONG-MIXED-FAIL-02-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"];
  const unreviewed = "MIXED-UNREVIEWED";
  const supplementalPass = "MIXED-PASS-02";
  const reasons = ["设备启动后重复重启，未完成验证。", "设备加载配置后无法接入测试网络。"];
  const summary = node.locator("summary").first();
  const confirm = node.getByRole("button", { name: "确认节点通过", exact: true });
  const reasonDialog = page.getByRole("dialog", { name: /填写条码失败原因/ });
  const reasonFor = (barcode: string) => reasonDialog.getByRole("textbox", { name: `条码 ${barcode} 失败原因`, exact: true });
  const savedBarcodes = () => db.prepare(
    `SELECT b.barcode, b.validation_result AS result, b.failure_reason AS reason,
            u.employee_id AS validatedBy, ru.employee_id AS reasonBy
     FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
     JOIN binding_requirements br ON br.id = f.requirement_id
     LEFT JOIN users u ON u.id = b.validated_by
     LEFT JOIN users ru ON ru.id = b.failure_reason_by
     WHERE br.request_id = ? ORDER BY b.id`,
  ).all(requestId);
  const nodeStatus = () => db.prepare(
    `SELECT status FROM binding_requirements WHERE request_id = ?`,
  ).get(requestId)?.status;

  try {
    await page.goto(trial);
    await submitFlow(page, [initialPass, ...fails, unreviewed]);
    await submitFlow(page, supplementalPass);
    await expect(bindingBarcodeResult(flowRow(page, initialPass), initialPass, true)).toHaveCount(0);

    await login(page, "MGR001");
    await page.goto(trial);
    await saveBindingBarcodeResults(page, flowRow(page, initialPass), {
      [initialPass]: "PASS",
      [fails[0]]: "FAIL",
      [fails[1]]: "FAIL",
    });
    await saveBindingBarcodeResults(page, flowRow(page, supplementalPass), { [supplementalPass]: "PASS" });
    await expect(summary).toContainText("0/2 条码通过");
    expect(savedBarcodes().map(({ result, validatedBy }) => [result, validatedBy])).toEqual([
      ["PASS", "MGR001"], ["FAIL", "MGR001"], ["FAIL", "MGR001"], ["UNREVIEWED", null], ["PASS", "MGR001"],
    ]);

    await login(page, "OWNER001");
    await page.goto(trial);
    await expect(bindingBarcodeResult(flowRow(page, initialPass), initialPass, true)).toHaveCount(0);
    await expect(flowRow(page, initialPass).getByRole("button", { name: "审批电子流", exact: true })).toBeVisible();

    await login(page, "ADMIN001");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(trial);
    await approveFlow(page, initialPass);
    await expect(summary).toContainText("1/2 条码通过");
    await confirm.click();
    await expect(reasonDialog).toBeVisible();
    await expect(reasonDialog.getByRole("textbox")).toHaveCount(2);
    await expect(reasonDialog.getByRole("button", { name: "保存原因并确认通过" })).toHaveCount(0);
    for (const [index, barcode] of fails.entries()) {
      const input = reasonFor(barcode);
      await expect(input).toHaveAttribute("required", "");
      await input.fill(reasons[index]);
    }
    await reasonDialog.getByRole("button", { name: "保存失败原因", exact: true }).click();
    await expectFlash(page, "已保存失败原因，节点仍待确认");
    expect(nodeStatus()).toBe("PENDING");
    expect(savedBarcodes().filter(({ result }) => result === "FAIL").map(({ reason, reasonBy }) => [reason, reasonBy])).toEqual([
      [reasons[0], "ADMIN001"], [reasons[1], "ADMIN001"],
    ]);

    await approveFlow(page, supplementalPass);
    await expect(summary).toContainText("2/2 条码通过");
    await confirm.click();
    await expect(reasonDialog.getByRole("button", { name: "保存失败原因", exact: true })).toBeVisible();
    await expect(reasonDialog.getByRole("button", { name: "保存原因并确认通过" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(confirm).toBeFocused();
    await savePassedBindingBarcodes(page, [unreviewed]);
    await expect(summary).toContainText("3/2 条码通过");
    await confirm.click();
    for (const [index, barcode] of fails.entries()) {
      await expect(reasonFor(barcode)).toHaveValue(reasons[index]);
    }
    await reasonDialog.getByRole("button", { name: "保存原因并确认通过", exact: true }).click();
    await expectFlash(page, "已确认节点通过");
    expect(nodeStatus()).toBe("PASSED");
    await expect(bindingBarcodeResult(flowRow(page, initialPass), initialPass, true)).toHaveCount(0);

    await page.goto(`/formal/${versionId}?project=1`);
    const formalEvidence = page.getByRole("region", { name: "项目验收与绑定证据" });
    await expect(formalEvidence).toContainText(reasons[0]);
    await page.goto(`/versions/${versionId}?project=1`);
    await expect(page.locator("#version-binding")).toContainText(reasons[1]);
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

test("兼任外项目经理的软件包责任人可确认本包节点，其他项目资料仍受限", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const version = "2.0.0-cross-project-owner-e2e";
  const { versionId, requestIds: [requestId] } = setupBindingFixture(db, version, ["N1"]);
  const pkg = db.prepare(`SELECT p.id, p.owner_id AS ownerId
    FROM packages p JOIN package_versions v ON v.package_id = p.id
    WHERE v.id = ?`).get(versionId) as { id: number; ownerId: number };
  const unrelated = db.prepare(`SELECT r.id FROM version_transfer_requests r
    JOIN package_versions v ON v.id = r.package_version_id
    JOIN packages p ON p.id = v.package_id
    JOIN projects pr ON pr.id = r.project_id
    WHERE p.name = '1006KEY' AND v.version = '1.3.0' AND pr.code = 'N1'`).get() as { id: number };

  try {
    db.prepare("UPDATE packages SET owner_id = (SELECT id FROM users WHERE employee_id = 'MGR002') WHERE id = ?").run(pkg.id);
    const trial = `/trial/${requestId}`;
    await page.goto(trial);
    await submitFlow(page, "CROSS-PROJECT-OWNER-QA");
    await login(page, "ADMIN001");
    await page.goto(trial);
    await approveFlow(page, "CROSS-PROJECT-OWNER-QA");

    await login(page, "MGR002");
    const validationTask = page.getByRole("link", { name: /判定设备条码/ }).filter({ hasText: version });
    await expect(validationTask).toHaveAttribute("href", new RegExp(`^/trial/${requestId}#binding-node-[0-9]+$`));
    await validationTask.click();
    await savePassedBindingBarcodes(page, ["CROSS-PROJECT-OWNER-QA"]);
    await page.goto("/dashboard");
    const task = page.getByRole("link", { name: /确认节点通过/ }).filter({ hasText: version });
    await expect(task).toHaveAttribute("href", new RegExp(`^/trial/${requestId}#binding-node-[0-9]+$`));
    await page.goto(`/trial/${unrelated.id}`);
    await expect(page.getByRole("heading", { name: "页面或记录不存在" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /1006KEY 1\.3\.0/ })).toHaveCount(0);

    await page.goto("/dashboard");
    await task.click();
    await expect(page).toHaveURL(url => url.pathname === trial && /^#binding-node-[0-9]+$/.test(url.hash));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(version + " · 绑定验证");
    await confirmBindingNode(page, page.locator(".binding-requirement"));
    const confirmation = db.prepare(`SELECT br.status, u.employee_id AS employeeId
      FROM binding_requirements br JOIN users u ON u.id = br.confirmed_by
      WHERE br.request_id = ?`).get(requestId);
    expect(confirmation).toMatchObject({ status: "PASSED", employeeId: "MGR002" });
  } finally {
    db.prepare("UPDATE packages SET owner_id = ? WHERE id = ?").run(pkg.ownerId, pkg.id);
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

test("额外审批或撤销已审批电子流后须重新确认，共享版本重新校验转正", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { versionId, requestIds: [n1Request, m2Request] } = setupBindingFixture(db);
  const n1 = `/trial/${n1Request}?project=1`;
  const m2 = `/trial/${m2Request}?project=2`;
  const formal = `/formal/${versionId}?project=1`;
  const node = page.locator(".binding-requirement");
  const bindingRow = page.getByRole("region", { name: "试制版本绑定验证表格" }).getByRole("row").filter({ hasText: testVersion });
  const formalRow = page.getByRole("region", { name: "待转正版本列表" }).getByRole("row").filter({ hasText: testVersion });
  const statuses = () => db.prepare(
    "SELECT status FROM version_transfer_requests WHERE package_version_id = ? ORDER BY project_id",
  ).all(versionId).map((row) => row.status);
  try {
    await page.goto(n1);
    await submitFlow(page, "CONTROL-N1-FIRST");
    await submitFlow(page, "CONTROL-N1-SECOND");
    await page.goto(m2);
    await submitFlow(page, "CONTROL-M2-FIRST");

    await login(page, "ADMIN001");
    const n1Tasks = page.getByRole("link", { name: /审批绑定电子流/ })
      .filter({ hasText: testVersion }).and(page.locator(`[href^="/trial/${n1Request}#"]`));
    await expect(n1Tasks).toHaveCount(2);
    await n1Tasks.first().click();
    await approveFlow(page, "CONTROL-N1-FIRST");
    await expect(flowRow(page, "CONTROL-N1-SECOND")).toContainText("待审批");
    await expect(flowRow(page, "CONTROL-N1-FIRST")).toContainText("指定审批人 王磊");
    await submitFlow(page, "CONTROL-N1-THIRD");
    await expect(flowRow(page, "CONTROL-N1-THIRD").getByRole("button", { name: "审批电子流", exact: true })).toHaveCount(0);
    await withdrawFlow(page, "CONTROL-N1-THIRD");

    await page.goto(m2);
    await approveFlow(page, "CONTROL-M2-FIRST");
    expect(statuses()).toEqual(["TRIAL", "TRIAL"]);
    await login(page, "MGR001");
    await page.goto(n1);
    await savePassedBindingBarcodes(page, ["CONTROL-N1-FIRST"]);
    await confirmBindingNode(page, node);
    expect(statuses()).toEqual(["TRIAL", "TRIAL"]);
    await login(page, "MGR002");
    await page.goto(m2);
    await savePassedBindingBarcodes(page, ["CONTROL-M2-FIRST"]);
    await confirmBindingNode(page, node);
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);

    await login(page, "ADMIN001");
    for (const projectId of [2, 1]) {
      await page.goto(`/trial?view=binding&project=${projectId}`);
      await expect(page.getByRole("region", { name: "试制版本绑定验证", exact: true })).toBeVisible();
      await expect(bindingRow).toHaveCount(0);
      await page.goto(`/formal?project=${projectId}&q=${testVersion}`);
      await expect(formalRow).toHaveCount(1);
      await expect(formalRow.getByRole("link", { name: "核对并转正" })).toHaveAttribute("href", new RegExp(`^/formal/${versionId}[?]project=${projectId}(?:&|$)`));
    }
    await formalRow.getByRole("link", { name: "核对并转正" }).click();
    await expect(page.getByText(/还有 1 条绑定电子流待审批/)).toBeVisible();
    await page.getByRole("button", { name: "发布正式版本", exact: true }).click();
    const releaseCheck = page.getByRole("dialog", { name: "转正发布条件" });
    await expect(releaseCheck.getByRole("link", { name: "去审批" })).toHaveAttribute("href", /#binding-flow-\d+$/);
    await expect(releaseCheck.getByRole("button", { name: "提交转正电子流并发布" })).toHaveCount(0);
    await releaseCheck.getByRole("button", { name: "关闭", exact: true }).click();
    const evidence = page.getByRole("region", { name: "项目验收与绑定证据" });
    const n1Evidence = evidence.locator("details").filter({ has: page.locator("summary").filter({ hasText: "星云 N1" }) });
    if ((await n1Evidence.getAttribute("open")) === null) await n1Evidence.locator(":scope > summary").click();
    const bindingRecord = n1Evidence.getByRole("link", { name: "查看绑定验证记录" });
    await expect(bindingRecord).toHaveAttribute("href", n1);
    await bindingRecord.click();
    await expect(page.getByRole("heading", { name: "已进入待转正" })).toBeVisible();
    await expect(page.getByText(/还有 1 条绑定电子流待审批/)).toBeVisible();
    const formalLink = page.getByRole("link", { name: "前往转正发布" });
    await page.getByRole("button", { name: "前往转正发布" }).click();
    await expect(releaseCheck.getByRole("link", { name: "去审批" })).toHaveAttribute("href", /#binding-flow-\d+$/);
    await releaseCheck.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByRole("heading", { name: "已进入待转正" })).toBeVisible();
    await approveFlow(page, "CONTROL-N1-SECOND");
    await expect(node.locator("summary").first()).toContainText("1/1 条码通过");
    await expect(node.locator("summary").first()).toContainText("待判定");
    await savePassedBindingBarcodes(page, ["CONTROL-N1-SECOND"]);
    await expect(page.getByText("2/1 条码通过")).toBeVisible();
    await expect(node.locator("summary").first()).toContainText("待确认");
    expect(statuses()).toEqual(["TRIAL", "TRIAL"]);
    await confirmBindingNode(page, node);
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
    await expect(page.locator("#binding-formal")).toBeFocused();
    await page.goto(n1);
    await withdrawFlow(page, "CONTROL-N1-SECOND");
    await expect(page.getByText("1/1 条码通过")).toBeVisible();
    await expect(node.locator("summary").first()).toContainText("待确认");
    expect(statuses()).toEqual(["TRIAL", "TRIAL"]);
    await expectFlash(page, "版本已回到绑定验证");
    await expect(formalLink).toHaveCount(0);
    for (const projectId of [1, 2]) {
      await page.goto(`/formal?project=${projectId}&q=${testVersion}`);
      await expect(page.getByText("没有匹配的版本", { exact: true })).toBeVisible();
      await expect(formalRow).toHaveCount(0);
      await page.goto(`/trial?view=binding&project=${projectId}`);
      await expect(bindingRow).toHaveCount(1);
      await expect(bindingRow).toContainText("绑定中");
    }

    await page.goto(n1);
    await confirmBindingNode(page, node);
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
    await expect(page.getByRole("heading", { name: "已满足转正条件" })).toBeVisible();
    await expect(formalLink).toHaveAttribute("href", formal);
    await formalLink.click();
    await expect(page.getByRole("button", { name: "发布正式版本", exact: true })).toBeVisible();

    const staleFormalPage = await page.context().newPage();
    try {
      await staleFormalPage.goto(formal);
      await staleFormalPage.getByRole("button", { name: "发布正式版本", exact: true }).click();
      const releaseDialog = staleFormalPage.getByRole("dialog", { name: /^转正/ });
      await releaseDialog.getByLabel("转正电子流网址").fill("https://example.com/formal/stale-check");
      await releaseDialog.getByLabel("转正评审纪要").fill("核对另一个页面中补交的绑定电子流。");
      await page.goto(n1);
      await submitFlow(page, "CONTROL-N1-LATE");
      expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
      await releaseDialog.getByRole("button", { name: "提交转正电子流并发布" }).click();
      await expect(releaseDialog.getByRole("alert")).toContainText("仍有绑定电子流待审批");
      expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
      await withdrawFlow(page, "CONTROL-N1-LATE");
    } finally {
      await staleFormalPage.close();
    }

    await page.goto(n1);
    await withdrawFlow(page, "CONTROL-N1-FIRST");
    expect(statuses()).toEqual(["TRIAL", "TRIAL"]);
    await expectFlash(page, "版本已回到绑定验证");
    await expect(page.getByText("0/1 条码通过")).toBeVisible();
    await login(page, "VALID001");
    await page.goto(n1);
    await page.getByRole("button", { name: "新增绑定电子流", exact: true }).click();
    const retry = page.getByRole("dialog", { name: /提交绑定电子流/ });
    await retry.getByLabel("设备条码").fill("CONTROL-N1-FIRST");
    await retry.getByLabel("网页电子流地址").fill("https://example.com/binding/retry");
    await retry.getByRole("button", { name: "提交绑定电子流", exact: true }).click();
    await expectFlash(page, "绑定电子流已提交");
    await login(page, "ADMIN001");
    await page.goto(n1);
    await flowRow(page, "CONTROL-N1-FIRST").filter({ hasText: "待审批" }).getByRole("button", { name: "审批电子流" }).click();
    const approval = page.getByRole("dialog", { name: /审批 BF-/ });
    await approval.getByLabel("审批意见").fill("已重新核对撤销后补交的设备。");
    await approval.getByRole("button", { name: "审批通过" }).click();
    await expectFlash(page, "绑定电子流审批通过");
    expect(statuses()).toEqual(["TRIAL", "TRIAL"]);
    await savePassedBindingBarcodes(page, ["CONTROL-N1-FIRST"]);
    await confirmBindingNode(page, node);
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

test("已确认节点可立即判定新提交的待审批条码，审批后保留判定并重新确认", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { versionId, requestIds: [requestId] } = setupBindingFixture(db, "2.0.0-append-barcode-result-e2e", ["N1"]);
  const trial = `/trial/${requestId}?project=1`;
  const initial = "APPEND-BASE-01";
  const pass = "APPEND-PASS-01";
  const fail = "APPEND-FAIL-01";
  const initialFlow = flowRow(page, initial);
  const supplementalFlow = flowRow(page, pass);
  const node = page.locator(".binding-requirement");
  const summary = node.locator("summary").first();
  const status = () => db.prepare(
    `SELECT br.status AS nodeStatus, br.confirmed_at AS confirmedAt, r.status AS requestStatus
     FROM binding_requirements br JOIN version_transfer_requests r ON r.id = br.request_id
     WHERE br.request_id = ?`,
  ).get(requestId);

  try {
    await page.goto(trial);
    await submitFlow(page, initial);
    await login(page, "ADMIN001");
    await page.goto(trial);
    await approveFlow(page, initial);
    await savePassedBindingBarcodes(page, [initial]);
    await confirmBindingNode(page, node);
    const confirmation = status();
    expect(confirmation).toMatchObject({ nodeStatus: "PASSED", requestStatus: "PENDING_FORMAL", confirmedAt: expect.any(String) });

    await submitFlow(page, [pass, fail]);
    await expect(supplementalFlow).toContainText("待审批");
    await expect(bindingBarcodeResult(supplementalFlow, pass)).toBeVisible();
    await expect(bindingBarcodeResult(supplementalFlow, fail)).toHaveValue("UNREVIEWED");
    await expect(supplementalFlow.getByRole("button", { name: "保存条码判定", exact: true })).toBeDisabled();
    await expect(bindingBarcodeResult(initialFlow, initial, true)).toHaveCount(0);
    await saveBindingBarcodeResults(page, supplementalFlow, { [pass]: "PASS", [fail]: "FAIL" });
    await expect(summary).toContainText("1/1 条码通过");
    await expect(summary).toContainText("绑定通过");
    await expect(bindingBarcodeResult(initialFlow, initial, true)).toHaveCount(0);
    expect(status()).toEqual(confirmation);

    await login(page, "OWNER001");
    await page.goto(trial);
    await approveFlow(page, pass, "王磊");
    expect(status()).toMatchObject({ nodeStatus: "PENDING", requestStatus: "TRIAL", confirmedAt: null });

    await login(page, "ADMIN001");
    await page.goto(trial);
    await expect(summary).toContainText("2/1 条码通过");
    await expect(bindingBarcodeResult(initialFlow, initial, true)).toHaveValue("PASS");
    await expect(bindingBarcodeResult(supplementalFlow, pass, true)).toHaveValue("PASS");
    await expect(bindingBarcodeResult(supplementalFlow, fail, true)).toHaveValue("FAIL");
    await node.getByRole("button", { name: "确认节点通过", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /填写条码失败原因/ });
    await expect(dialog.getByRole("textbox", { name: `条码 ${fail} 失败原因`, exact: true })).toBeVisible();
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.close();
  }
});

async function setProjectStatus(page: Page, projectId: number, status: "ACTIVE" | "ARCHIVED") {
  await page.goto(`/settings/projects/${projectId}?edit=project`);
  const form = page.getByTestId(`edit-project-form-${projectId}`);
  await form.getByLabel("流程状态", { exact: true }).selectOption(status);
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(page, "项目配置已更新");
}

test("项目归档后旧页面不能登记节点免绑，恢复后可办理", async ({ page }) => {
  await login(page, "ADMIN001");
  const settingsPage = await page.context().newPage();
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const project = db.prepare("SELECT id, status FROM projects WHERE code = 'X0'").get() as { id: number; status: string };
  let versionId: number | undefined;
  try {
    await setProjectStatus(settingsPage, project.id, "ACTIVE");
    const fixture = setupBindingFixture(db, "2.0.0-archive-waive-check", ["X0"]);
    versionId = fixture.versionId;
    const [requestId] = fixture.requestIds;
    const trialHref = `/trial/${requestId}?project=${project.id}`;
    const barcode = "ARCHIVE-WAIVER-QA";
    const reason = "隔离数据验证归档前已打开的节点免绑表单。";
    const node = page.locator(".binding-requirement");
    const flow = flowRow(page, barcode);
    const waiveButton = node.getByRole("button", { name: "节点无需绑定", exact: true });
    const dialog = page.getByRole("dialog", { name: /确认免绑/ });
    const submit = dialog.getByRole("button", { name: "确认节点免绑", exact: true });

    await page.goto(trialHref);
    await submitFlow(page, barcode);
    await waiveButton.click();
    await dialog.getByLabel(/免绑原因/).fill(reason);
    await setProjectStatus(settingsPage, project.id, "ARCHIVED");
    await expect(settingsPage.getByRole("link", { name: "查看归档版本" })).toBeVisible();

    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText("项目已归档，不能登记节点免绑。");
    await page.goto(trialHref);
    await expect(waiveButton).toHaveCount(0);
    await expect(node.getByText("节点免绑", { exact: true })).toHaveCount(0);
    await node.locator(":scope > summary").click();
    await expect(flow.getByText("待审批", { exact: true })).toBeVisible();

    await setProjectStatus(settingsPage, project.id, "ACTIVE");
    await page.goto(trialHref);
    await waiveButton.click();
    await dialog.getByLabel(/免绑原因/).fill(reason);
    await submit.click();
    await expectFlash(page, "已登记此节点无需绑定");
    await expect(node.getByText("节点免绑", { exact: true })).toBeVisible();
    await node.locator(":scope > summary").click();
    await expect(flow.getByText("已撤销", { exact: true })).toBeVisible();
  } finally {
    if (versionId !== undefined) db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(project.status, project.id);
    db.close();
  }
});

test("归档节点不阻塞共享版本转正，恢复项目后重新校验绑定", async ({ page }) => {
  await login(page, "VALID001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const version = "2.0.0-archived-binding-e2e";
  const archived = db.prepare("SELECT id, status FROM projects WHERE code = 'X0'").get() as { id: number; status: string };
  const { versionId, requestIds: [n1Request, m2Request, archivedRequest] } =
    setupBindingFixture(db, version, ["N1", "M2", "X0"]);
  const versionStatus = () => db.prepare("SELECT status FROM package_versions WHERE id = ?").get(versionId)?.status;
  const activeRequests = () => db.prepare(
    "SELECT status FROM version_transfer_requests WHERE id IN (?, ?) ORDER BY id",
  ).all(n1Request, m2Request).map((row) => row.status);
  const archivedEvidence = () => db.prepare(
    `SELECT r.status AS requestStatus, r.trial_released_at AS trialReleasedAt, r.formal_released_at AS formalReleasedAt,
            br.status AS nodeStatus, f.status AS flowStatus, f.web_url AS flowUrl
     FROM version_transfer_requests r
     JOIN binding_requirements br ON br.request_id = r.id
     JOIN binding_flows f ON f.requirement_id = br.id
     WHERE r.id = ?`,
  ).get(archivedRequest);

  try {
    expect(archived.status).toBe("ARCHIVED");
    await page.goto(`/trial/${n1Request}`);
    await submitFlow(page, "ARCHIVE-QA-N1");
    await page.goto(`/trial/${m2Request}`);
    await submitFlow(page, "ARCHIVE-QA-M2");

    await login(page, "ADMIN001");
    await page.goto(`/trial/${n1Request}`);
    await approveFlow(page, "ARCHIVE-QA-N1");
    await savePassedBindingBarcodes(page, ["ARCHIVE-QA-N1"]);
    expect(versionStatus()).toBe("TRIAL");
    await page.goto(`/trial/${m2Request}`);
    await approveFlow(page, "ARCHIVE-QA-M2");
    await savePassedBindingBarcodes(page, ["ARCHIVE-QA-M2"]);
    expect(versionStatus()).toBe("TRIAL");
    await confirmBindingNode(page, page.locator(".binding-requirement"));
    await page.goto(`/trial/${n1Request}`);
    await confirmBindingNode(page, page.locator(".binding-requirement"));
    expect(versionStatus()).toBe("PENDING_FORMAL");
    expect(activeRequests()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);

    await setProjectStatus(page, archived.id, "ACTIVE");
    expect(versionStatus()).toBe("TRIAL");
    expect(activeRequests()).toEqual(["TRIAL", "TRIAL"]);
    await page.goto(`/trial/${archivedRequest}`);
    await submitFlow(page, "ARCHIVE-QA-X0");
    await setProjectStatus(page, archived.id, "ARCHIVED");
    expect(versionStatus()).toBe("PENDING_FORMAL");
    expect(activeRequests()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);

    const preserved = archivedEvidence();
    expect(preserved).toMatchObject({ nodeStatus: "PENDING", flowStatus: "PENDING", formalReleasedAt: null });
    await page.goto(`/formal?q=${version}`);
    const row = page.getByRole("row").filter({ hasText: version });
    await expect(row).toContainText("星云 N1");
    await expect(row).toContainText("极光 M2");
    await expect(row).not.toContainText("远山 X0");
    await row.getByRole("link", { name: "核对并转正" }).click();
    await page.getByRole("button", { name: "发布正式版本", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^转正/ });
    await dialog.getByRole("textbox", { name: "转正电子流网址", exact: true }).fill("https://example.com/formal/archive-qa");
    await dialog.getByRole("textbox", { name: "转正评审纪要", exact: true }).fill("在行项目节点完成，保留归档项目绑定记录。");
    await dialog.getByRole("button", { name: "提交转正电子流并发布" }).click();
    await expectFlash(page, "同步发布正式版本");
    expect(versionStatus()).toBe("FORMAL");
    expect(activeRequests()).toEqual(["FORMAL", "FORMAL"]);
    expect(archivedEvidence()).toEqual(preserved);
  } finally {
    db.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(archived.status, archived.id);
    db.close();
  }
});
