import { expect, test } from "@playwright/test";
import { login } from "./helpers";

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
  await page.getByRole("link", { name: "查看 1001OTA 详情" }).click();
  const drawer = page.getByRole("dialog", { name: "软件包详情" });
  const edit = drawer.getByRole("button", { name: "编辑责任信息" });
  await edit.click();
  const search = drawer.getByRole("searchbox", { name: "搜索责任人" });
  await expect(search).toBeFocused();
  await search.fill("MGR001");
  await expect(drawer.getByRole("radio", { name: /MGR001/ })).toBeVisible();
  await expect(drawer.getByRole("tablist")).toHaveCount(0);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(drawer.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
});
