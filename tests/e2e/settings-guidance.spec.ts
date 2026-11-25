import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("软件包保存范围和停用入口显示当前版本原因，返回表单保留录入", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/packages/6");

  const saveRange = page.getByRole("button", { name: "保存使用范围", exact: true });
  await saveRange.click();
  const scopeGuidance = page.getByRole("dialog", { name: "保存使用范围", exact: true });
  await expect(scopeGuidance.getByText(/1006KEY 1\.3\.0/)).toBeVisible();
  await expect(scopeGuidance.getByRole("link", { name: "查看版本全链路" })).toHaveAttribute("href", /\/versions\/\d+/);
  await scopeGuidance.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(saveRange).toBeFocused();

  const edit = page.getByTestId("package-meta-form");
  const description = edit.getByRole("textbox", { name: "说明", exact: true });
  await description.fill("尚未保存的软件包说明");
  const stop = edit.getByRole("button", { name: "停用软件包" });
  await stop.click();
  const stopGuidance = page.getByRole("dialog", { name: "停用软件包", exact: true });
  await expect(stopGuidance.getByText(/1\.3\.0/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stop).toBeFocused();
  await expect(description).toHaveValue("尚未保存的软件包说明");
  await expect(edit.getByRole("button", { name: "保存责任信息" })).toBeEnabled();
});

test("启用软件包的负责人可从停用条件直达转交页面", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/users");
  await page.getByRole("link", { name: "管理赵敏的账号" }).click();
  await page.getByRole("button", { name: "停用账号" }).click();
  const blockers = page.getByRole("dialog", { name: "停用 赵敏 的账号" });
  const keyPackage = blockers.getByRole("listitem").filter({ hasText: "1006KEY" });
  await expect(keyPackage.getByRole("link", { name: "转交责任人" })).toHaveAttribute("href", "/settings/packages/6#package-responsibility");
  await keyPackage.getByRole("link", { name: "转交责任人" }).click();
  await expect(page.getByRole("heading", { name: "责任信息", exact: true })).toBeVisible();
});

test("移除主审批人时可以查看条件，保存节点后返回时保留项目筛选", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/projects?q=N1&status=ACTIVE");
  await page.getByRole("link", { name: "星云 N1", exact: true }).click();
  await page.getByRole("link", { name: "配置节点 EVT", exact: true }).click();
  const approvers = page.getByRole("region", { name: "审批人范围", exact: true });
  const primary = approvers.getByRole("listitem").filter({ hasText: "主审批人" });
  await primary.getByRole("button", { name: /^移除/ }).click();
  const guidance = page.getByRole("dialog", { name: /^移除/ });
  await expect(guidance.getByText("主审批人不能从审批人范围移除，请先修改节点审批人。")).toBeVisible();
  await guidance.getByRole("link", { name: "前往节点绑定配置" }).click();
  await expect(guidance).not.toBeVisible();
  await expect(page).toHaveURL(/#node-settings$/);
  await page.getByRole("button", { name: "保存节点配置", exact: true }).click();
  await expect(page.locator(".flash")).toContainText("项目节点绑定配置已更新");
  await page.getByRole("link", { name: "返回测试节点", exact: true }).click();
  await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("N1");
  await expect(page.getByRole("combobox", { name: "流程状态", exact: true })).toHaveValue("ACTIVE");
});
