import { expect, test } from "@playwright/test";
import { expectFlash, login } from "./helpers";

test("软件包配置正确显示旧编码及名称，保留旧编码并校验修改", async ({ page }) => {
  await login(page, "OWNER001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/packages");
  const list = page.getByRole("region", { name: "软件包列表", exact: true });
  const areaFilter = list.getByRole("button", { name: "筛选责任田 / 责任人", exact: true });
  await areaFilter.click();
  const areaMenu = page.getByRole("dialog", { name: "筛选责任田 / 责任人", exact: true });
  await expect(areaMenu.getByRole("checkbox", { name: "系统底座", exact: true })).toBeVisible();
  await expect(areaMenu.getByRole("checkbox", { name: "通信互联", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(areaMenu).toBeHidden();
  await expect(areaFilter).toBeFocused();
  await page.getByLabel("每页条数").selectOption("10");
  await expect(page).toHaveURL(/pageSize=10/);
  const codeFilter = list.getByRole("button", { name: "筛选软件包编码", exact: true });
  await codeFilter.press("Enter");
  const codeMenu = page.getByRole("dialog", { name: "筛选软件包编码", exact: true });
  await codeMenu.getByRole("combobox", { name: "软件包编码匹配方式" }).selectOption("exact");
  await codeMenu.getByRole("textbox", { name: "软件包编码", exact: true }).fill("１００１ｏｔａ");
  await codeMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(list.getByRole("rowheader", { name: "1001OTA", exact: true })).toBeVisible();
  const nameToggle = list.getByRole("switch", { name: "显示软件包名称" });
  await expect(nameToggle).not.toBeChecked();
  await expect(list.getByRole("columnheader", { name: "软件包名称", exact: true })).toHaveCount(0);
  await expect(list.getByRole("cell", { name: "OTA", exact: true })).toHaveCount(0);
  await nameToggle.press("Space");
  await expect(nameToggle).toBeChecked();
  await expect(list.getByRole("columnheader", { name: "软件包名称", exact: true })).toBeVisible();
  await expect(list.getByRole("cell", { name: "OTA", exact: true })).toBeVisible();
  await nameToggle.press("Space");
  await expect(list.getByRole("cell", { name: "OTA", exact: true })).toHaveCount(0);
  await expect(list.getByRole("rowheader", { name: "1002CFG", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await list.getByRole("link", { name: "1001OTA", exact: true }).click();
  const form = page.getByTestId("package-meta-form");
  const code = form.getByRole("textbox", { name: "软件包编码" });
  await expect(code).toHaveValue("1001OTA");
  await expect(form.getByRole("textbox", { name: "软件包名称" })).toHaveValue("OTA");
  await code.fill("1234BAD");
  await form.getByRole("button", { name: "保存责任信息" }).click();
  await expect(form.getByRole("alert")).toContainText("需要 5 位数字加 3 位字母");

  await code.fill("1001OTA");
  await form.getByRole("button", { name: "保存责任信息" }).click();
  await expectFlash(page, "软件包信息已更新");
  await expect(form.getByRole("textbox", { name: "软件包编码" })).toHaveValue("1001OTA");
  await page.getByRole("link", { name: "返回软件包配置" }).click();
  await expect(page).toHaveURL(/f_code=/);
  await expect(page.getByLabel("每页条数")).toHaveValue("10");
  await expect(list.getByRole("rowheader", { name: "1001OTA", exact: true })).toBeVisible();
  await expect(list.getByRole("rowheader", { name: "1002CFG", exact: true })).toHaveCount(0);
  await page.goto("/packages?project=1");
  await expect(page.getByText("1001OTA", { exact: true }).first()).toBeVisible();
});

test("软件包配置按列多选及组合，零结果后仍可调整筛选", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/settings/packages?area=1");
  const list = page.getByRole("region", { name: "软件包列表", exact: true });
  const packageRow = (code: string) => list.getByRole("rowheader", { name: code, exact: true });
  await expect(packageRow("1001OTA")).toBeVisible();
  await expect(packageRow("1003COM")).toHaveCount(0);

  await list.getByRole("button", { name: "筛选责任田 / 责任人", exact: true }).click();
  const areaMenu = page.getByRole("dialog", { name: "筛选责任田 / 责任人", exact: true });
  await expect(areaMenu.getByRole("checkbox", { name: "系统底座", exact: true })).toBeChecked();
  await areaMenu.getByRole("checkbox", { name: "通信互联", exact: true }).check();
  await areaMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(packageRow("1001OTA")).toBeVisible();
  await expect(packageRow("1003COM")).toBeVisible();
  await expect(packageRow("1005SEC")).toHaveCount(0);

  const versionFilter = list.getByRole("button", { name: "筛选版本记录", exact: true });
  await versionFilter.click();
  const versionMenu = page.getByRole("dialog", { name: "筛选版本记录", exact: true });
  await versionMenu.getByRole("spinbutton", { name: "版本记录最小值" }).fill("9999");
  await versionMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(list.getByRole("heading", { name: "没有匹配的软件包" })).toBeVisible();
  await expect(packageRow("1001OTA")).toHaveCount(0);
  await versionFilter.click();
  await versionMenu.getByRole("link", { name: "清除本列", exact: true }).click();
  await expect(packageRow("1003COM")).toBeVisible();
  await expect(packageRow("1005SEC")).toHaveCount(0);

  await list.getByRole("link", { name: "清除全部筛选" }).click();
  await expect(packageRow("1005SEC")).toBeVisible();

  await list.getByRole("button", { name: "筛选软件包状态", exact: true }).click();
  const statusMenu = page.getByRole("dialog", { name: "筛选软件包状态", exact: true });
  await statusMenu.getByRole("checkbox", { name: "启用", exact: true }).check();
  await statusMenu.getByRole("checkbox", { name: "待发试制", exact: true }).check();
  await statusMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(packageRow("1001OTA")).toBeVisible();
  await expect(packageRow("1002CFG")).toHaveCount(0);

  await page.goto("/settings/packages/1?historyPage=2&f_nodes_min=1&f_enabled=active&f_versions_min=1&state=active&area=1&pageSize=10&unused=ignore");
  await expect(page.getByRole("link", { name: "返回软件包配置" })).toHaveAttribute(
    "href",
    "/settings/packages?pageSize=10&area=1&state=active&f_enabled=active&f_versions_min=1&f_nodes_min=1&historyPage=2",
  );
});
