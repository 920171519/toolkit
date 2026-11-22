import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth-forms";
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
        <h1 id="register-title">创建协作账号</h1>
        <p>填写姓名、工号与密码。账号默认属于软件工程部，后续由管理员配置角色与责任田。</p>
      </header>
      <RegisterForm />
    </section>
  );
}
