import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectFlash, login } from "./helpers";

const testVersion = "2.0.0-binding-controls-e2e";

function setupBindingFixture(db: DatabaseSync, version = testVersion, projectCodes = ["N1", "M2"]) {
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
         SELECT r.id, r.package_version_id, r.project_id, n.id, 1, owner.id, approver.id,
                datetime('now'), datetime('now'), datetime('now')
         FROM version_transfer_requests r JOIN project_nodes n ON n.project_id = r.project_id
         JOIN users owner ON owner.employee_id = 'VALID001'
         JOIN users approver ON approver.employee_id = 'OWNER001'
         WHERE r.id = ? ORDER BY n.sort_order, n.id LIMIT 1`,
      ).run(requestId);
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

async function submitFlow(page: Page, barcode: string) {
  await page.getByRole("button", { name: "新增绑定电子流", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /提交绑定电子流/ });
  await dialog.getByLabel("设备条码").fill(barcode);
  await dialog.getByLabel("网页电子流地址").fill("https://example.com/binding/" + barcode);
  await dialog.getByRole("button", { name: "提交绑定电子流", exact: true }).click();
  await expectFlash(page, "绑定电子流已提交");
  await expect(flowRow(page, barcode)).toBeVisible();
}

async function approveFlow(page: Page, barcode: string) {
  await flowRow(page, barcode).getByRole("button", { name: "审批电子流", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /审批 BF-/ });
  await dialog.getByLabel("审批意见").fill("已核对本次绑定的设备条码。");
  await dialog.getByRole("button", { name: "审批通过", exact: true }).click();
  await expectFlash(page, /绑定电子流已通过|绑定电子流审批通过/);
  await expect(flowRow(page, barcode)).toContainText("实际审批人 张启明");
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

test("管理员审批、达标后新增和撤销电子流正确联动共享转正", async ({ page }) => {
  await login(page, "VALID001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { versionId, requestIds: [n1Request, m2Request] } = setupBindingFixture(db);
  const n1 = `/trial/${n1Request}?project=1`;
  const m2 = `/trial/${m2Request}?project=2`;
  const formal = `/formal/${versionId}?project=1`;
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
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
    await page.goto(formal);
    await expect(page.getByText(/还有 1 条绑定电子流待审批/)).toBeVisible();
    await expect(page.getByRole("button", { name: "发布正式版本", exact: true })).toHaveCount(0);

    await page.goto("/trial?view=binding&project=1");
    const bindingRow = page.getByRole("row").filter({ hasText: testVersion });
    await expect(bindingRow).toContainText("待转正");
    await bindingRow.getByRole("link", { name: "查看节点与审批" }).click();
    await approveFlow(page, "CONTROL-N1-SECOND");
    await expect(page.getByText("2/1 条码通过")).toBeVisible();
    await withdrawFlow(page, "CONTROL-N1-SECOND");
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
    await expect(page.getByText("1/1 条码通过")).toBeVisible();
    await page.goto(formal);
    await expect(page.getByRole("button", { name: "发布正式版本", exact: true })).toBeVisible();

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
    await expectFlash(page, "绑定电子流已通过");
    expect(statuses()).toEqual(["PENDING_FORMAL", "PENDING_FORMAL"]);
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

test("归档节点不阻塞共享版本转正，恢复项目后重新校验绑定", async ({ page }) => {
  await login(page, "VALID001");
  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
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
    expect(versionStatus()).toBe("TRIAL");
    await page.goto(`/trial/${m2Request}`);
    await approveFlow(page, "ARCHIVE-QA-M2");
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
