import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("软件包详情在关闭后可再次打开并保留项目和表格筛选", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.goto("/packages?project=1");
  const filter = page.getByRole("button", { name: "筛选软件包", exact: true });
  const filterMenu = page.getByRole("dialog", { name: "筛选软件包", exact: true });
  const trigger = page.getByRole("link", { name: "查看 1001OTA 详情" });
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  const heading = drawer.getByRole("heading", { name: "1001OTA" });
  const hasFilterWithoutDrawer = (url: URL) => url.searchParams.get("project") === "1" &&
    url.searchParams.get("f_code") === "1001" && !url.searchParams.has("open");
  await filter.click();
  await filterMenu.getByRole("textbox", { name: "软件包编码", exact: true }).fill("1001");
  await filterMenu.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL(hasFilterWithoutDrawer);
  await expect(page.getByRole("link", { name: "查看 1002CFG 详情" })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(hasFilterWithoutDrawer);
  await expect(filter).toHaveAttribute("data-filtered", "true");
  await trigger.click();
  await expect(heading).toBeVisible();

  await page.mouse.click(16, 100);
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(hasFilterWithoutDrawer);

  await trigger.click();
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(url => url.searchParams.get("project") === "1" &&
    url.searchParams.get("open") === "1" && url.searchParams.get("f_code") === "1001");
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(hasFilterWithoutDrawer);
  await page.goForward();
  await expect(heading).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("link", { name: "查看 1001OTA 详情", exact: true }).click();
  await expect(heading).toBeVisible();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(hasFilterWithoutDrawer);
  await filter.click();
  await expect(filterMenu.getByRole("textbox", { name: "软件包编码", exact: true })).toHaveValue("1001");
});

test("软件包详情可从项目深链直接打开并切换到其他软件包", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/packages/1?project=1&f_code=100");
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("heading", { name: "1001OTA" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("link", { name: "查看 1002CFG 详情" }).click();
  await expect(drawer.getByRole("heading", { name: "1002CFG" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "1001OTA" })).toHaveCount(0);
  await expect(page).toHaveURL(url => url.searchParams.get("project") === "1" &&
    url.searchParams.get("open") === "2" && url.searchParams.get("f_code") === "100");
});

test("客户端脚本加载失败时仍可通过详情链接打开软件包", async ({ page }) => {
  await login(page, "ADMIN001");
  await page.route("**/_next/static/chunks/**", (route) => route.abort());
  await page.goto("/packages?project=1&f_code=1001");
  await page.getByRole("link", { name: "查看 1001OTA 详情" }).click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  await expect(drawer.getByRole("heading", { name: "1001OTA" })).toBeVisible();
  await expect(page).toHaveURL(url => url.searchParams.get("project") === "1" &&
    url.searchParams.get("open") === "1" && url.searchParams.get("f_code") === "1001");
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name: "查看 1002CFG 详情" })).toHaveCount(0);
});

test("旧软件包的表头筛选按显示的编码和名称分别匹配", async ({ page }) => {
  await login(page, "ADMIN001");
  const trigger = page.getByRole("link", { name: "查看 1001OTA 详情" });
  await page.goto("/packages?project=1&f_code=1001OTA&f_code_mode=exact&f_name=OTA&f_name_mode=exact");
  await expect(trigger).toBeVisible();
  await page.goto("/packages?project=1&f_code=OTA&f_code_mode=exact");
  await expect(trigger).toHaveCount(0);
  await page.goto("/packages?project=1&f_name=1001OTA&f_name_mode=exact");
  await expect(trigger).toHaveCount(0);
});
