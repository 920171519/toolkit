import { expect, type Locator, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Demo@1234";

export async function login(page: Page, employeeId: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator('input[name="employeeId"]').fill(employeeId);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /登录工作台/ }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.getByRole("heading", { name: "我的工作台", exact: true })).toBeVisible();
}

export async function expectFlash(page: Page, text: string | RegExp) {
  await expect(page.locator(".flash")).toBeVisible();
  await expect(page.locator(".flash")).toContainText(text);
}

export async function confirmAction(page: Page) {
  await page.getByRole("alertdialog").getByRole("button", { name: /^确认/ }).click();
}

export async function confirmBindingNode(page: Page, node: Locator) {
  const summary = node.locator("summary").first();
  await expect(summary).toContainText("待确认");
  if ((await node.getAttribute("open")) === null) await summary.click();
  await node.getByRole("button", { name: "确认节点通过", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expectFlash(page, "已确认节点通过");
  await expect(summary).toContainText("绑定通过");
}

export function bindingBarcodeResult(flow: Locator, barcode: string, includeHidden = false) {
  return flow.getByRole("combobox", { name: `条码 ${barcode} 验证结果`, exact: true, includeHidden });
}

export async function saveBindingBarcodeResults(page: Page, flow: Locator, results: Record<string, "PASS" | "FAIL" | "UNREVIEWED">) {
  const details = flow.locator("details.barcode-details");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  for (const [barcode, result] of Object.entries(results)) {
    await bindingBarcodeResult(flow, barcode).selectOption(result);
  }
  await flow.getByRole("button", { name: "保存条码判定", exact: true }).click();
  await expectFlash(page, "已保存条码判定");
  for (const [barcode, result] of Object.entries(results)) {
    await expect(bindingBarcodeResult(flow, barcode, true)).toHaveValue(result);
  }
}

export async function savePassedBindingBarcodes(page: Page, barcodes: string[]) {
  const flow = page.locator(".binding-flow-row").filter({ hasText: barcodes[0] }).filter({
    has: page.getByText("审批通过", { exact: true }),
  });
  await saveBindingBarcodeResults(page, flow, Object.fromEntries(barcodes.map((barcode) => [barcode, "PASS" as const])));
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
