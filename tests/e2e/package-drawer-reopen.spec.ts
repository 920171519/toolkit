import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("软件包详情在关闭后可再次打开并保留项目和表格筛选", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/packages?project=1");
  const filter = page.getByRole("textbox", { name: "筛选软件包", exact: true });
  const trigger = page.getByRole("link", { name: "查看 1001OTA 详情" });
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  const heading = drawer.getByRole("heading", { name: "1001OTA" });
  await filter.fill("1001");
  await trigger.click();
  await expect(heading).toBeVisible();

  await page.locator(".drawer-backdrop").click({ position: { x: 16, y: 100 } });
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/packages\?project=1$/);
  await expect(filter).toHaveValue("1001");

  await trigger.click();
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(url => url.searchParams.get("project") === "1" && url.searchParams.get("open") === "1");
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(filter).toHaveValue("1001");
  await page.goForward();
  await expect(heading).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("link", { name: "1001OTA", exact: true }).click();
  await expect(heading).toBeVisible();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await expect(drawer).toBeHidden();
  await expect(filter).toHaveValue("1001");
});

test("软件包详情可从项目深链直接打开并切换到其他软件包", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/packages?project=1&open=1");
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("heading", { name: "1001OTA" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("link", { name: "查看 1002CFG 详情" }).click();
  await expect(drawer.getByRole("heading", { name: "1002CFG" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "1001OTA" })).toHaveCount(0);
  await expect(page).toHaveURL(url => url.searchParams.get("project") === "1" && url.searchParams.get("open") === "2");
});

test("客户端脚本加载失败时仍可通过详情链接打开软件包", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.route("**/_next/static/chunks/**", (route) => route.abort());
  await page.goto("/packages?project=1");
  await page.getByRole("link", { name: "查看 1001OTA 详情" }).click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("heading", { name: "1001OTA" })).toBeVisible();
  await page.goBack();
  await expect(drawer).toBeHidden();
});
