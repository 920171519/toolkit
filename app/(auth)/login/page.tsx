import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { getCurrentUser } from "@/lib/auth";
import { safeWorkspacePath } from "@/lib/return-to";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = safeWorkspacePath(params.next);
  if (user) redirect(next ?? "/dashboard");

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="login-title">
      <header className={styles.heading}>
        <h1 id="login-title">登录</h1>
      </header>
      <LoginForm next={next} />
      {process.env.TOOLKIT_SKIP_SEED !== "1" && <details className={styles.demo}>
        <summary>本地演示账号</summary>
        <div className={styles.demoAccounts}>
          <span>管理员 · ADMIN001</span>
          <span>软件经理 · MGR001</span>
          <span>集成测试 · TEST001</span>
          <span>评审专家 · REVIEW001</span>
          <span>软件包责任人 · OWNER001</span>
          <span>绑定验证 · VALID001</span>
          <span>部门成员 · MEMBER001</span>
          <strong>统一演示密码 <code>Demo@1234</code></strong>
        </div>
      </details>}
    </section>
  );
}
