import { expect, test } from "@playwright/test";
import { login } from "./helpers";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(viewport.width + "px 下筛选项目联系人时编辑表单宽度保持稳定", async ({ page }) => {
    await login(page, "ADMIN001");
    await page.setViewportSize(viewport);
    await page.goto("/settings/projects");

    await page.getByRole("link", { name: "配置星云 N1", exact: true }).click();
    await page.getByTestId("edit-project-trigger").click();
    const form = page.getByTestId("edit-project-form-1");
    const pm = form.getByRole("group", { name: /^PM/ });
    const manager = form.getByRole("group", { name: /^软件经理/ });
    const initial = await form.boundingBox();
    expect(initial).not.toBeNull();

    await pm.getByRole("searchbox", { name: "搜索PM" }).fill("p");
    await expect(pm.getByRole("checkbox", { name: /王磊/ })).toBeChecked();
    await expect(pm.getByRole("checkbox", { name: /许言/ })).toBeHidden();
    expect(await form.boundingBox()).toMatchObject({ x: initial!.x, width: initial!.width });

    await manager.getByRole("searchbox", { name: "搜索软件经理" }).fill("m");
    await expect(manager.getByRole("checkbox", { name: /林澈/ })).toBeChecked();
    expect(await form.boundingBox()).toMatchObject({ x: initial!.x, width: initial!.width });

    await page.getByRole("link", { name: "取消编辑", exact: true }).click();
    await expect(form).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
