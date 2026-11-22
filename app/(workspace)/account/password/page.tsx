import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/auth-forms";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import styles from "@/app/(auth)/auth.module.css";

export const metadata: Metadata = { title: "修改密码" };

export default async function ChangePasswordPage() {
  await requireUser();

  return (
    <>
      <PageHeader title="修改密码" description="修改后，所有设备上的登录会话都会退出。请使用新密码重新登录。" />
      <div className={`card ${styles.panel} ${styles.passwordChangePanel}`}>
        <ChangePasswordForm />
      </div>
    </>
  );
}
