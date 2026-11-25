import { expect, test, type Locator } from "@playwright/test";
import { login } from "./helpers";

const versionList = "/versions?pageSize=10&sort=package";
const routes = [
  versionList,
  "/overview",
  "/settings/areas",
  "/settings/areas/1",
  "/settings/packages",
  "/settings/users",
  "/packages?project=1",
  "/integration?project=1",
  "/integration?project=1&view=history",
  "/submissions?project=1",
  "/submissions?project=1&view=drafts",
  "/trial?project=1",
  "/trial?project=1&view=binding",
  "/formal?project=1",
];

async function expectInlinePageSize(select: Locator, minHeight: number) {
  await expect(select).toBeVisible();
  const geometry = await select.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error("每页条数控件缺少下拉框");
    const label = element.labels?.[0];
    const caption = label && (Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      ?? label.querySelector("span"));
    if (!label || !caption) throw new Error("每页条数控件缺少可见标签");
    const range = document.createRange();
    range.selectNodeContents(caption);
    const control = element.getBoundingClientRect();
    const text = range.getBoundingClientRect();
    const group = label.getBoundingClientRect();
    return {
      controlHeight: control.height,
      controlWidth: control.width,
      labelReadsBeforeSelect: text.width > 0 && text.right <= control.left,
      centerOffset: Math.abs(text.top + text.height / 2 - control.top - control.height / 2),
      groupFits: group.left >= 0 && group.right <= document.documentElement.clientWidth + 1 && control.right <= group.right + 1,
    };
  });
  expect(geometry.labelReadsBeforeSelect).toBe(true);
  expect(geometry.centerOffset).toBeLessThanOrEqual(2);
  expect(geometry.controlWidth).toBeLessThanOrEqual(96);
  expect(geometry.controlHeight).toBeGreaterThanOrEqual(minHeight);
  expect(geometry.groupFits).toBe(true);
}

for (const width of [1440, 320]) {
  test(`${width}px 下每页条数标签与下拉框同行，分页控件保持对齐`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, "ADMIN001");

    for (const path of routes) {
      await test.step(path, async () => {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const label = path.startsWith("/packages") ? "每页行数" : "每页条数";
        const select = page.getByRole("main").getByRole("combobox", { name: label, exact: true });
        await expectInlinePageSize(select, width === 320 ? 44 : 32);

        if (path === versionList) {
          const navigation = page.getByRole("navigation", { name: "版本列表分页" });
          const summary = navigation.getByText(/^第 1 页 \/ 共 \d+ 页$/);
          const next = navigation.getByRole("link", { name: "下一页", exact: true });
          await expect(summary).toBeVisible();
          await expect(next).toBeVisible();
          const [selectBox, summaryBox, nextBox] = await Promise.all([select.boundingBox(), summary.boundingBox(), next.boundingBox()]);
          if (!selectBox || !summaryBox || !nextBox) throw new Error("版本列表分页控件缺少可测量的边界");
          const center = (box: typeof selectBox) => box.y + box.height / 2;
          expect(Math.abs(center(summaryBox) - center(nextBox))).toBeLessThanOrEqual(2);
          if (width === 1440) {
            expect(Math.abs(center(selectBox) - center(nextBox))).toBeLessThanOrEqual(2);
          } else {
            const total = await page.getByText(/^共 \d+ 条$/, { exact: true }).boundingBox();
            if (!total) throw new Error("版本列表分页缺少总条数");
            expect(Math.abs(center(total) - center(selectBox))).toBeLessThanOrEqual(2);
            expect(summaryBox.y).toBeGreaterThan(selectBox.y + selectBox.height);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}
