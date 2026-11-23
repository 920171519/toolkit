import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectFlash, login } from "./helpers";

const testVersion = "2.0.0-binding-controls-e2e";

function setupBindingFixture(db: DatabaseSync) {
  const versionId = Number(db.prepare(
    `INSERT INTO package_versions
       (package_id, version, change_summary, archive_url, status, binding_mode, trial_form_no,
        trial_released_at, submitted_at, updated_at)
     SELECT id, ?, '绑定流程回归专用', 'https://example.com/archive', 'TRIAL', 'PUSHED',
            'https://example.com/trial', datetime('now'), datetime('now'), datetime('now')
     FROM packages WHERE name = '1004NET'`,
  ).run(testVersion).lastInsertRowid);
  try {
    const requestIds = ["N1", "M2"].map((projectCode) => {
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
