import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("工作区宽屏铺开，手机只在表格内横向滚动，项目表单保持限宽", async ({ page }) => {
  await login(page, "ADMIN001");
  const routes = [
    "/submissions?project=1",
    "/packages?project=1",
    "/settings/projects",
  ];
  for (const width of [2200, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await page.goto(route);
      const main = page.getByRole("main");
      const table = main.getByRole("table").first();
      await expect(table).toBeVisible();
      const dimensions = await table.evaluate((element) => {
        const tableWrap = element.parentElement!;
        const workspace = element.closest("main")!;
        const bounds = workspace.getBoundingClientRect();
        const shell = workspace.parentElement!.getBoundingClientRect();
        const style = getComputedStyle(workspace);
        return {
          left: Math.round(bounds.left - shell.left + parseFloat(style.paddingLeft)),
          right: Math.round(shell.right - bounds.right + parseFloat(style.paddingRight)),
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tableOverflow: tableWrap.scrollWidth - tableWrap.clientWidth,
        };
      });
      expect(dimensions.right, route).toBe(dimensions.left);
      expect(dimensions.documentOverflow, route).toBeLessThanOrEqual(1);
      if (width === 2200) expect(dimensions.tableOverflow, route).toBeLessThanOrEqual(1);
      else expect(dimensions.tableOverflow, route).toBeGreaterThan(0);

      if (width === 2200 && route.startsWith("/submissions")) {
        const actions = await table.locator("tbody tr").first().locator("td").last().evaluate((cell) =>
          [...cell.querySelectorAll("a, button")].filter((control) => control.getClientRects().length > 0)
            .map((control) => control.getBoundingClientRect().top)
        );
        expect(actions.length).toBeGreaterThan(1);
        expect(new Set(actions).size).toBe(1);
      }
    }
  }

  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto("/settings/projects/1?edit=project");
  const editor = page.getByTestId("edit-project-form-1");
  await expect(editor).toBeVisible();
  expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(768);

  await page.goto("/settings/projects");
  await page.getByTestId("new-project-trigger").click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(560);
});
