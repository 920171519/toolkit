import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth-forms";
import { InfoTooltip } from "@/components/info-tooltip";
import { getCurrentUser } from "@/lib/auth";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "注册账号" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="register-title">
      <header className={styles.heading}>
        <h1 id="register-title">注册账号</h1>
        <InfoTooltip label="账号权限说明">新账号默认为普通账号，工作权限按实际分工授予。</InfoTooltip>
      </header>
      <RegisterForm />
    </section>
  );
}
