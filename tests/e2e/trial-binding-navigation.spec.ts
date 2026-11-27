import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("从试制页跳到绑定验证列表，聚焦并保留项目和筛选条件", async ({ page }) => {
  await login(page, "MGR001");
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/trial?project=1&binding_q=1001OTA");
  const queue = page.locator("#binding-queue");
  const heading = queue.getByRole("heading", { name: "试制版本绑定验证" });
  await expect(heading).not.toBeInViewport();

  const jumpLink = page.getByRole("navigation", { name: "试制与绑定队列" }).getByRole("link", { name: /^节点绑定/ });
  await expect(jumpLink.getByText("1", { exact: true })).toBeVisible();
  await jumpLink.focus();
  await jumpLink.press("Enter");

  await expect(page).toHaveURL((url) => url.searchParams.get("project") === "1"
    && url.searchParams.get("binding_q") === "1001OTA"
    && url.searchParams.get("view") === "binding"
    && url.hash === "#binding-queue");
  await expect(queue).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(queue.getByRole("link", { name: "清除搜索条件 1001OTA" })).toBeVisible();
  await expect(jumpLink.getByText("1", { exact: true })).toBeVisible();
});
