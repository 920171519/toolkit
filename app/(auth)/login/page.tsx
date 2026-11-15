import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : undefined;

  return (
    <div className="auth-form-wrap">
      <div className="auth-heading">
        <div className="eyebrow">Internal workspace</div>
        <h2 style={{ marginTop: 9 }}>欢迎回来</h2>
        <p>登录后查看部门项目、软件包版本与转测流程。</p>
      </div>
      <LoginForm next={next} />
      <details className="demo-accounts">
        <summary>查看演示账号（仅用于本地体验）</summary>
        <div className="demo-grid">
          <span>管理员 · ADMIN001</span>
          <span>软件经理 · MGR001</span>
          <span>集成测试 · TEST001</span>
          <span>评审专家 · REVIEW001</span>
          <span>责任人 · OWNER001</span>
          <span>绑定验证 · VALID001</span>
          <span style={{ gridColumn: "1 / -1", color: "var(--brand)" }}>
            统一演示密码：Demo@1234
          </span>
        </div>
      </details>
    </div>
  );
}
