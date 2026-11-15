import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth-forms";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "注册账号" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="auth-form-wrap">
      <div className="auth-heading">
        <div className="eyebrow">Join the workspace</div>
        <h2 style={{ marginTop: 9 }}>创建协作账号</h2>
        <p>填写姓名、工号与密码。账号默认属于软件工程部，后续由管理员配置角色与责任田。</p>
      </div>
      <RegisterForm />
    </div>
  );
}
