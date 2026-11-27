import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

test("软件包详情接口校验登录和项目参数，成功响应禁用缓存", async ({ page }) => {
  const detailUrl = "/api/packages/7?project=1";
  const anonymous = await page.request.get(detailUrl);
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "请先登录。" });

  await login(page, "MGR001");
  const invalidPackage = await page.request.get("/api/packages/unknown?project=1");
  expect(invalidPackage.status()).toBe(400);
  expect(await invalidPackage.json()).toEqual({ error: "软件包参数无效。" });

  const duplicateProject = await page.request.get(`${detailUrl}&project=1`);
  expect(duplicateProject.status()).toBe(404);
  expect(await duplicateProject.json()).toEqual({ error: "项目不存在或不可查看。" });

  const detail = await page.request.get(detailUrl);
  expect(detail.status()).toBe(200);
  expect(detail.headers()["cache-control"]).toBe("no-store");
  expect(await detail.json()).toMatchObject({ package: { id: 7 }, canEdit: false });
});

test("软件包详情按资料分类，版本和节点可以搜索，关闭后保留当前筛选", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/packages?project=1&q=1001OTA");
  await page.getByRole("link", { name: "查看 1001OTA 使用范围" }).click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("tab", { name: "使用范围" })).toHaveAttribute("aria-selected", "true");
  const scope = drawer.getByRole("searchbox", { name: "搜索项目或节点" });
  await scope.fill("Ｍ２");
  await expect(drawer.getByText("极光 M2", { exact: false })).toBeVisible();
  await expect(drawer.getByText("星云 N1", { exact: false })).toHaveCount(0);
  await drawer.getByRole("tab", { name: "使用范围" }).press("ArrowLeft");
  await expect(drawer.getByRole("tab", { name: "版本历史" })).toBeFocused();
  await expect(drawer.getByRole("tab", { name: "版本历史" })).toHaveAttribute("aria-selected", "true");
  await drawer.getByRole("searchbox", { name: "搜索版本" }).fill("1.6.0");
  await expect(drawer.getByRole("heading", { name: "1.6.0", exact: true })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "1.6.1", exact: true })).toHaveCount(0);
  await drawer.getByRole("searchbox", { name: "搜索版本" }).fill("查无版本");
  await expect(drawer.getByText("没有匹配的版本", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "清除搜索" }).click();
  await expect(drawer.getByRole("searchbox", { name: "搜索版本" })).toHaveValue("");
  await drawer.getByRole("searchbox", { name: "搜索版本" }).fill("1.6.0");
  await drawer.getByRole("searchbox", { name: "搜索版本" }).press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "搜索软件包" })).toHaveValue("1001OTA");
  await expect(page.getByRole("link", { name: "查看 1001OTA 使用范围" })).toBeFocused();
});

test("责任信息编辑使用独立面板，并能搜索人员和返回原位置", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/packages?project=1");
  const trigger = page.getByRole("link", { name: "查看 1001OTA 详情" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  const edit = drawer.getByRole("button", { name: "编辑责任信息" });
  await edit.click();
  const search = drawer.getByRole("searchbox", { name: "搜索责任人" });
  await expect(search).toBeFocused();
  await search.fill("林澈　ｍｇｒ００１");
  await expect(drawer.getByRole("radio", { name: /MGR001/ })).toBeVisible();
  await expect(drawer.getByRole("tablist")).toHaveCount(0);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(drawer.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");

  await edit.press("Enter");
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(edit).toBeFocused();
  await expect(drawer).toBeVisible();
  await edit.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("责任田项目负责人可编辑软件包责任信息，项目软件经理仅可读取", async ({ page }) => {
  const detailUrl = "/api/packages/7?project=1";
  await login(page, "TEST001");
  const baseline = await page.request.get(detailUrl);
  expect(baseline.ok()).toBeTruthy();
  const { package: pkg, audits } = await baseline.json();
  const description = "责任田项目负责人验证诊断工具链说明的保存。";
  let auditId: number | undefined;

  try {
    await page.goto("/packages?project=1&open=7");
    const drawer = page.getByRole("dialog", { name: "软件包详情" });
    await drawer.getByRole("button", { name: "编辑责任信息" }).click();
    await drawer.getByLabel("软件包说明").fill(description);
    await drawer.getByRole("button", { name: "保存责任信息" }).click();
    await expect(drawer.getByText(description, { exact: true })).toBeVisible();

    const saved = await page.request.get(detailUrl);
    expect(saved.ok()).toBeTruthy();
    const detail = await saved.json();
    expect(detail.canEdit).toBe(true);
    const [latestAudit] = detail.audits;
    expect(latestAudit?.action).toBe("UPDATE_PACKAGE_RESPONSIBILITY");
    expect(audits.map(({ id }: { id: number }) => id)).not.toContain(latestAudit.id);
    auditId = latestAudit.id;

    await login(page, "MGR001");
    const reader = await page.request.get(detailUrl);
    expect(reader.ok()).toBeTruthy();
    expect(await reader.json()).toMatchObject({ canEdit: false, package: { description }, audits: [] });
  } finally {
    const db = openE2eDatabase();
    try {
      db.prepare("UPDATE packages SET description = ? WHERE id = ? AND description = ?").run(pkg.description, pkg.id, description);
      if (auditId !== undefined) db.prepare("DELETE FROM audit_logs WHERE id = ?").run(auditId);
    } finally {
      db.close();
    }
  }
});
