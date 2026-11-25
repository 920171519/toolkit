import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("试制版本保留转正入口，按当前权限定位实际的节点与电子流", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/trial?view=binding&binding_q=1006KEY");
  const keyRow = page.getByRole("row").filter({ hasText: "1006KEY" }).filter({ hasText: "星云 N1" });
  await keyRow.getByRole("link", { name: "查看节点与审批" }).click();
  await expect(page.getByRole("heading", { name: /1006KEY 1\.3\.0.*绑定验证/ })).toBeVisible();
  const initialPath = new URL(page.url()).pathname;
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

  const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
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
