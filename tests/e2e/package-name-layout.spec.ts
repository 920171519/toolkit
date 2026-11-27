import { expect, test, type Locator } from "@playwright/test";
import { login } from "./helpers";
import { openE2eDatabase } from "./storage";

async function horizontalOverflow(box: Locator) {
  return box.evaluate((element) => element.scrollWidth - element.clientWidth);
}

test("新建软件包的责任田与责任人控件等高且支持搜索", async ({ page }) => {
  await login(page, "ADMIN001");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings/packages");
    await page.getByTestId("new-package-trigger").click();
    const dialog = page.getByRole("dialog", { name: "新建软件包" });
    const area = dialog.getByRole("combobox", { name: "责任田", exact: true });
    const owner = dialog.getByRole("combobox", { name: "责任人", exact: true });
    const areaBox = (await area.boundingBox())!;
    const ownerBox = (await owner.boundingBox())!;
    expect(areaBox.height).toBe(ownerBox.height);
    if (width === 1440) expect(areaBox.y).toBe(ownerBox.y);
    expect(await horizontalOverflow(dialog)).toBeLessThanOrEqual(1);

    const searchTrigger = dialog.getByRole("button", { name: "搜索责任人", exact: true });
    await searchTrigger.press("Enter");
    const picker = dialog.getByRole("dialog", { name: "搜索责任人" });
    const search = picker.getByRole("searchbox", { name: "搜索责任人" });
    await expect(search).toBeFocused();
    await search.fill(" ｔｅｓｔ００１ ");
    await search.press("Enter");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /周宁.*TEST001/ }).click();
    await expect(picker).toBeHidden();
    await expect(owner.locator("option:checked")).toContainText("周宁");
    await expect(searchTrigger).toBeFocused();
    await searchTrigger.click();
    await picker.getByRole("searchbox").press("Escape");
    await expect(dialog).toBeVisible();
    await expect(owner.locator("option:checked")).toContainText("周宁");
  }
});

test("项目软件包编码和风险弹窗操作不被长名称挤出", async ({ page }) => {
  await login(page, "ADMIN001");
  const db = openE2eDatabase();
  const original = db.prepare("SELECT id, name, code FROM packages WHERE id IN (1, 5)").all() as { id: number; name: string; code: string }[];
  const update = db.prepare("UPDATE packages SET name = ?, code = ? WHERE id = ?");
  const chineseName = "整车多域协同网关及设备诊断服务软件组件".repeat(5);
  const unbrokenName = "UnifiedVehiclePlatformRealtimeGatewayCompatibilityService".repeat(3);
  try {
    update.run("1001OTA", chineseName, 1);
    update.run(unbrokenName, "99005SEC", 5);
    await page.goto("/projects/1#packages");
    const table = page.getByRole("region", { name: "项目软件包表，可横向滚动" });
    await expect(table.getByRole("columnheader", { name: "软件包编码" })).toBeVisible();
    await expect(table.getByRole("link", { name: "1001OTA", exact: true })).toBeVisible();
    expect(await horizontalOverflow(table)).toBeLessThanOrEqual(1);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/packages?project=1&open=1");
      const drawer = page.getByRole("dialog", { name: "软件包详情" });
      await expect(drawer.getByText(chineseName, { exact: true })).toBeVisible();
      expect(await horizontalOverflow(drawer)).toBeLessThanOrEqual(1);
      await expect(drawer.getByRole("button", { name: "关闭详情" })).toBeInViewport();

      await page.goto("/submissions?project=1");
      const row = page.getByRole("row").filter({ hasText: "99005SEC" });
      await row.getByRole("button", { name: "登记风险原因" }).click();
      const dialog = page.getByRole("dialog", { name: "登记风险试制原因", exact: true });
      await expect(dialog.getByText(/99005SEC 1\.4\.0/)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "关闭弹窗" })).toBeInViewport();
      await expect(dialog.getByRole("button", { name: "纳入待发布试制" })).toBeInViewport();
      expect(await horizontalOverflow(dialog)).toBeLessThanOrEqual(1);
      await dialog.getByText("查看完整软件包名称", { exact: true }).click();
      await expect(dialog.getByText(unbrokenName, { exact: true })).toBeVisible();
      expect(await horizontalOverflow(dialog)).toBeLessThanOrEqual(1);
    }
    await page.goto("/versions/14?project=1");
    await expect(page.getByRole("heading", { name: "99005SEC 1.4.0", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "关闭 99005SEC 1.4.0 标签页" })).toBeVisible();
    expect(await horizontalOverflow(page.locator("html"))).toBeLessThanOrEqual(1);
  } finally {
    for (const { id, name, code } of original) update.run(name, code, id);
    db.close();
  }
});
