import { expect, type Locator, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Demo@1234";

export async function login(page: Page, employeeId: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator('input[name="employeeId"]').fill(employeeId);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /登录工作台/ }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.locator(".sidebar-user-name")).toBeVisible();
}

export async function expectFlash(page: Page, text: string | RegExp) {
  await expect(page.locator(".flash")).toBeVisible();
  await expect(page.locator(".flash")).toContainText(text);
}

export async function selectOptionContaining(select: Locator, text: string) {
  const options = await select.locator("option").evaluateAll((items) =>
    items.map((item) => ({
      value: (item as HTMLOptionElement).value,
      text: item.textContent ?? "",
    })),
  );
  const option = options.find((item) => item.text.includes(text));
  if (!option) {
    throw new Error(`未找到包含“${text}”的选项，当前选项：${options.map((item) => item.text).join(" | ")}`);
  }
  await select.selectOption(option.value);
}

export function cardByHeading(page: Page, name: string): Locator {
  return page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .first();
}
