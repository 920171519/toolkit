import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { FlashMessage } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { safeWorkspacePath } from "@/lib/return-to";
import { shouldSeedDemoData } from "@/lib/runtime-config";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; passwordChanged?: string | string[] }>;
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
      {params.passwordChanged === "1" && (
        <FlashMessage notice={{ tone: "success", message: "密码已修改，请使用新密码登录。" }} />
      )}
      <LoginForm next={next} />
      {shouldSeedDemoData() && <details className={styles.demo}>
        <summary>本地演示账号</summary>
        <div className={styles.demoAccounts}>
          <span>系统管理员 · ADMIN001</span>
          <span>项目软件经理 · MGR001</span>
          <span>集成测试责任田主管 · TEST001</span>
          <span>软件包责任人 · OWNER001</span>
          <span>节点绑定责任人 · VALID001</span>
          <span>普通账号 · MEMBER001</span>
          <strong>统一演示密码 <code>Demo@1234</code></strong>
        </div>
      </details>}
    </section>
  );
}
