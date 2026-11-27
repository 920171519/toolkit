import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("手动作废共享试制同时关闭归档项目绑定，并提醒已通过电子流提交人", async ({ page }) => {
  await login(page, "ADMIN001");
  const database = openE2eDatabase();
  database.exec("PRAGMA busy_timeout = 5000");
  let fixtureVersionId: number | undefined;
  try {
    const release = "9.90.15";
    const now = new Date().toISOString();
    const versionId = Number(database.prepare(
      `INSERT INTO package_versions
        (package_id, version, change_summary, archive_url, status, submitted_at, trial_form_no, trial_released_at, binding_mode, updated_at)
       VALUES (6, ?, '验证共享试制作废联动', 'https://packages.example.com/9.90.15', 'TRIAL', ?,
               'https://eflow.example.com/trial/9.90.15', ?, 'PUSHED', ?)`,
    ).run(release, now, now, now).lastInsertRowid);
    fixtureVersionId = versionId;
    const validator = database.prepare("SELECT id FROM users WHERE employee_id = 'VALID001'").get()!.id as number;
    const projects = database.prepare(
      `SELECT p.id, n.id AS nodeId FROM projects p
       JOIN project_nodes n ON n.id = (SELECT MIN(id) FROM project_nodes WHERE project_id = p.id)
       WHERE p.code IN ('N1', 'X0') ORDER BY p.code`,
    ).all() as Array<{ id: number; nodeId: number }>;
    expect(projects).toHaveLength(2);

    const fixtures = projects.map(({ id: projectId, nodeId }) => {
      const requestId = Number(database.prepare(
        `INSERT INTO version_transfer_requests
           (package_version_id, project_id, status, integration_status, trial_released_at, submitted_at, updated_at)
         VALUES (?, ?, 'TRIAL', 'PASSED', ?, ?, ?)`,
      ).run(versionId, projectId, now, now, now).lastInsertRowid);
      const requirementId = Number(database.prepare(
        `INSERT INTO binding_requirements
           (request_id, package_version_id, project_id, node_id, status, pushed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PASSED', ?, ?, ?)`,
      ).run(requestId, versionId, projectId, nodeId, now, now, now).lastInsertRowid);
      const flowNo = `BF-VOID-QA-${projectId}`;
      const flowId = Number(database.prepare(
        `INSERT INTO binding_flows
           (flow_no, requirement_id, package_version_id, project_id, node_id, device_barcode,
            web_url, submitted_by, status, submitted_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'https://eflow.example.com/binding/9.90.15', ?, 'APPROVED', ?, ?)`,
      ).run(flowNo, requirementId, versionId, projectId, nodeId, flowNo, validator, now, now).lastInsertRowid);
      database.prepare("INSERT INTO binding_flow_barcodes (flow_id, barcode, created_at) VALUES (?, ?, ?)")
        .run(flowId, flowNo, now);
      return { projectId, requestId, flowNo };
    });

    await page.goto(`/trial/${fixtures[0].requestId}?project=${fixtures[0].projectId}`);
    await page.getByRole("button", { name: /作废.*版本/ }).click();
    const dialog = page.getByRole("dialog", { name: /作废/ });
    await dialog.getByRole("textbox", { name: "作废原因" }).fill("主机试制失败，版本在所有关联项目中停止使用。");
    await dialog.getByRole("button", { name: /确认作废/ }).click();
    await expectFlash(page, /已作废/);

    expect(database.prepare("SELECT status FROM package_versions WHERE id = ?").get(versionId)?.status).toBe("VOID");
    expect(database.prepare(
      "SELECT status, integration_status AS integrationStatus FROM version_transfer_requests WHERE package_version_id = ? ORDER BY project_id",
    ).all(versionId)).toEqual([
      { status: "VOID", integrationStatus: "PASSED" },
      { status: "VOID", integrationStatus: "PASSED" },
    ]);
    expect(database.prepare(
      "SELECT status FROM binding_requirements WHERE package_version_id = ? ORDER BY project_id",
    ).all(versionId).map((row) => row.status)).toEqual(["CANCELLED", "CANCELLED"]);
    expect(database.prepare(
      "SELECT status FROM binding_flows WHERE package_version_id = ? ORDER BY project_id",
    ).all(versionId).map((row) => row.status)).toEqual(["APPROVED", "APPROVED"]);

    await login(page, "VALID001");
    for (const { flowNo } of fixtures) {
      const reminder = page.locator(".personal-alert").filter({ hasText: flowNo });
      await expect(reminder).toContainText(release);
      await expect(reminder).toContainText("撤销");
    }
  } finally {
    if (fixtureVersionId !== undefined) {
      database.prepare("DELETE FROM audit_logs WHERE entity_type = 'PACKAGE_VERSION' AND entity_id = ?").run(fixtureVersionId);
      database.prepare("DELETE FROM package_versions WHERE id = ?").run(fixtureVersionId);
    }
    database.close();
  }
});
