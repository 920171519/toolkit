import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("试制版本保留转正入口，按当前权限定位实际的节点与电子流", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial?view=binding&binding_q=1006KEY");
  const keyRow = page.getByRole("row").filter({ hasText: "1006KEY" }).filter({ hasText: "星云 N1" });
  await keyRow.getByRole("link", { name: "查看节点与审批" }).click();
  await expect(page.getByRole("heading", { name: /1006KEY 1\.3\.0.*绑定验证/ })).toBeVisible();
  const initialPath = new URL(page.url()).pathname;
  const legacyNode = page.locator(".binding-requirement").filter({ has: page.locator("summary").filter({ hasText: "EVT" }) });
  await expect(legacyNode).toContainText("按原规则确认");
  const formalEntry = page.getByRole("button", { name: "前往转正发布", exact: true });
  await formalEntry.click();
  const guidance = page.getByRole("dialog", { name: "转正发布条件" });
  await expect(guidance).toContainText("已完成 1/6 个节点");
  await expect(guidance).toContainText("星云 N1 · PVT · BF-2026-0005 待审批");
  await expect(guidance).toContainText("极光 M2 · EVT · 待提交或补充绑定电子流");
  await expect(guidance.getByRole("link", { name: "查看节点", exact: true })).toHaveCount(4);
  const approval = guidance.getByRole("link", { name: "去审批", exact: true });
  const approvalTarget = new URL((await approval.getAttribute("href"))!, page.url());
  expect(approvalTarget.pathname).toBe(initialPath);
  expect(approvalTarget.searchParams.get("binding_q")).toBe("1006KEY");
  await approval.click();
  await expect(guidance).toHaveCount(0);
  await expect(page.locator(approvalTarget.hash)).toBeFocused();
  await expect(page.locator(approvalTarget.hash).getByRole("button", { name: "审批电子流", exact: true })).toBeVisible();

  await formalEntry.click();
  const polarNode = guidance.getByRole("listitem").filter({ hasText: "极光 M2 · EVT" }).getByRole("link", { name: "查看节点" });
  const nodeTarget = new URL((await polarNode.getAttribute("href"))!, page.url());
  expect(nodeTarget.pathname).not.toBe(initialPath);
  await polarNode.click();
  await expect(page).toHaveURL(nodeTarget.href);
  await expect(page.locator(nodeTarget.hash)).toBeFocused();
  await expect(page.locator(nodeTarget.hash)).toHaveAttribute("open", "");

  const db = openE2eDatabase();
  const node = db.prepare(`SELECT br.id, br.required_count AS requiredCount,
      (SELECT COUNT(DISTINCT b.barcode) FROM binding_flow_barcodes b
       JOIN binding_flows f ON f.id = b.flow_id AND f.status IN ('PENDING','APPROVED')
       WHERE f.requirement_id = br.id) AS submittedCount
    FROM binding_requirements br JOIN binding_flows f ON f.requirement_id = br.id
    WHERE f.flow_no = 'BF-2026-0005'`).get() as { id: number; requiredCount: number; submittedCount: number };
  try {
    db.prepare("UPDATE binding_requirements SET required_count = ? WHERE id = ?").run(node.submittedCount + 1, node.id);
    await page.goto(initialPath);
    await formalEntry.click();
    await expect(guidance).toContainText("BF-2026-0005 待审批");
    const shortage = guidance.getByRole("listitem").filter({ hasText: "星云 N1 · PVT · 待提交或补充绑定电子流" });
    await expect(shortage).toContainText("还需补充 1 个");
    await expect(shortage.getByRole("link", { name: "查看节点" })).toHaveAttribute("href", new RegExp(`#binding-node-${node.id}$`));
  } finally {
    db.prepare("UPDATE binding_requirements SET required_count = ? WHERE id = ?").run(node.requiredCount, node.id);
    db.close();
  }

  await login(page, "MGR001");
  await page.goto(initialPath);
  await formalEntry.click();
  await expect(guidance).toContainText("其他使用项目还有绑定条件待核对");
  await expect(guidance).not.toContainText("极光 M2 · EVT");
  await expect(guidance.getByRole("link", { name: "查看节点", exact: true })).toHaveCount(0);
});

test("已转正历史保留绑定电子流参与者的只读入口", async ({ page }) => {
  await login(page, "VALID001");
  const database = openE2eDatabase();
  let versionId: number | bigint | undefined;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const scope = database.prepare(
      `SELECT p.id AS packageId, pr.id AS projectId, n.id AS nodeId, u.id AS approverId
       FROM packages p JOIN projects pr ON pr.code = 'N1'
       JOIN project_nodes n ON n.project_id = pr.id AND n.name = 'EVT'
       JOIN users u ON u.employee_id = 'VALID001'
       WHERE p.name = '1006KEY' OR p.code = '1006KEY'`,
    ).get() as { packageId: number; projectId: number; nodeId: number; approverId: number };
    const timestamp = "2026-11-07T01:00:00.000Z";
    versionId = database.prepare(
      `INSERT INTO package_versions (package_id, version, status, binding_mode, change_summary, archive_url, submitted_at, updated_at)
       VALUES (?, '988.1.0', 'FORMAL', 'PUSHED', '历史转正入口验收', 'https://example.test/formal', ?, ?)`,
    ).run(scope.packageId, timestamp, timestamp).lastInsertRowid;
    const requestId = database.prepare(
      `INSERT INTO version_transfer_requests (package_version_id, project_id, status, trial_released_at, submitted_at, updated_at)
       VALUES (?, ?, 'FORMAL', ?, ?, ?)`,
    ).run(versionId, scope.projectId, timestamp, timestamp, timestamp).lastInsertRowid;
    const requirementId = database.prepare(
      `INSERT INTO binding_requirements (request_id, package_version_id, project_id, node_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(requestId, versionId, scope.projectId, scope.nodeId, timestamp, timestamp).lastInsertRowid;
    database.prepare(
      `INSERT INTO binding_flows (flow_no, requirement_id, package_version_id, project_id, node_id, device_barcode, approver_id, status, submitted_at)
       VALUES ('HISTORICAL-CLOSED-FLOW', ?, ?, ?, ?, 'HISTORICAL-DEVICE', ?, 'REJECTED', ?)`,
    ).run(requirementId, versionId, scope.projectId, scope.nodeId, scope.approverId, timestamp);

    const href = `/formal/${versionId}`;
    expect((await page.goto(href))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "该版本已转正" })).toBeVisible();
    await expect(page.getByRole("link", { name: "查看版本记录" })).toHaveAttribute("href", `/versions/${versionId}?from=formal`);
    await expect(page.getByText("HISTORICAL-CLOSED-FLOW")).toHaveCount(0);
    expect((await page.goto(`${href}?project=${scope.projectId}`))?.status()).toBe(404);

    await login(page, "MEMBER001");
    expect((await page.goto(href))?.status()).toBe(404);
    await login(page, "MGR001");
    expect((await page.goto(`${href}?project=${scope.projectId}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "该版本已转正" })).toBeVisible();
  } finally {
    try {
      if (versionId !== undefined) database.prepare("DELETE FROM package_versions WHERE id = ?").run(versionId);
    } finally {
      database.close();
    }
  }
});
