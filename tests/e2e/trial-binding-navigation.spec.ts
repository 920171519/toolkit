import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("从试制页跳到绑定验证列表，聚焦并保留项目和筛选条件", async ({ page }) => {
  await login(page, "MGR001");
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/trial?project=1&binding_q=1001OTA");
  const queue = page.locator("#binding-queue");
  const heading = queue.getByRole("heading", { name: "试制版本绑定验证" });
  await expect(heading).not.toBeInViewport();

  const jumpLink = page.getByRole("link", { name: "跳到绑定验证列表" });
  await jumpLink.focus();
  await jumpLink.press("Enter");

  await expect(page).toHaveURL(/project=1&binding_q=1001OTA#binding-queue$/);
  await expect(queue).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(queue.getByRole("searchbox", { name: "搜索试制版本绑定验证" })).toHaveValue("1001OTA");
});
