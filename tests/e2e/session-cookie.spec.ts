import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "./helpers";

test("登录会话按反代协议设置 Secure，保留根路径及 Cookie 属性", async ({ context, page }) => {
  for (const fixture of [
    { label: "直接 HTTP", forwardedProto: "", secure: false },
    { label: "HTTPS 反代", forwardedProto: " HTTPS, http", secure: true },
    { label: "HTTP 在协议列表首位", forwardedProto: "http, https", secure: false },
  ]) {
    await test.step(fixture.label, async () => {
      await context.clearCookies();
      await page.setExtraHTTPHeaders(fixture.forwardedProto ? { "X-Forwarded-Proto": fixture.forwardedProto } : {});
      await page.goto("/login");
      const form = page.getByTestId("login-form");
      await form.getByLabel("工号", { exact: true }).fill("MEMBER001");
      await form.getByLabel("密码", { exact: true }).fill(DEMO_PASSWORD);

      const loginResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/login");
      await form.getByRole("button", { name: "登录工作台", exact: true }).click();

      const response = await loginResponse;
      const session = (await response.headerValues("set-cookie"))
        .find((cookie) => cookie.startsWith("toolkit_session="));
      const attributes = (session?.split(";").slice(1) ?? []).map((attribute) => attribute.trim().toLowerCase());
      expect(attributes).toEqual(expect.arrayContaining(["path=/", "httponly", "samesite=lax"]));
      expect(attributes.some((attribute) => attribute.startsWith("expires="))).toBe(true);
      expect(attributes.includes("secure")).toBe(fixture.secure);
    });
  }
});
