"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Eye, EyeOff, LoaderCircle, LogIn, UserPlus } from "lucide-react";
import { loginAction, registerAction } from "@/app/(auth)/actions";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span style={{ color: "var(--danger)", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
      <AlertCircle size={11} /> {message}
    </span>
  );
}

function PasswordInput({
  name,
  placeholder,
  autoComplete,
  error,
}: {
  name: string;
  placeholder: string;
  autoComplete: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <div style={{ position: "relative" }}>
        <input
          className="input"
          type={visible ? "text" : "password"}
          name={name}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          style={{ paddingRight: 38 }}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            border: 0,
            background: "transparent",
            color: "var(--muted-light)",
            padding: 4,
          }}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      <FieldError message={error} />
    </>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  return (
    <form action={formAction} className="auth-form" data-testid="login-form">
      {next && <input type="hidden" name="next" value={next} />}
      {state?.error && (
        <div className="form-error" role="alert">
          <AlertCircle size={14} style={{ marginTop: 1, flex: "none" }} /> {state.error}
        </div>
      )}
      <label className="field">
        <span className="label">工号</span>
        <input className="input" name="employeeId" placeholder="请输入工号，例如 MGR001" autoComplete="username" required />
      </label>
      <label className="field">
        <span className="label">密码</span>
        <PasswordInput name="password" placeholder="请输入登录密码" autoComplete="current-password" />
      </label>
      <div className="form-footer" style={{ paddingTop: 4 }}>
        <button type="submit" className="button button-primary" style={{ width: "100%" }} disabled={pending}>
          {pending ? <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} /> : <LogIn size={14} />}
          {pending ? "正在登录…" : "登录工作台"}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="auth-footer">
        还没有账号？<Link href="/register">使用姓名与工号注册</Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initial);
  return (
    <form action={formAction} className="auth-form" data-testid="register-form">
      {state?.error && (
        <div className="form-error" role="alert">
          <AlertCircle size={14} style={{ marginTop: 1, flex: "none" }} /> {state.error}
        </div>
      )}
      <label className="field">
        <span className="label">姓名</span>
        <input className="input" name="name" placeholder="请输入真实姓名" autoComplete="name" required minLength={2} maxLength={30} />
        <FieldError message={state?.fieldErrors?.name} />
      </label>
      <label className="field">
        <span className="label">
          工号 <span className="hint">用于登录与协作身份识别</span>
        </span>
        <input className="input" name="employeeId" placeholder="例如 OWNER005" autoComplete="username" required />
        <FieldError message={state?.fieldErrors?.employeeId} />
      </label>
      <label className="field">
        <span className="label">
          密码 <span className="hint">至少 8 位</span>
        </span>
        <PasswordInput name="password" placeholder="设置登录密码" autoComplete="new-password" error={state?.fieldErrors?.password} />
      </label>
      <label className="field">
        <span className="label">确认密码</span>
        <PasswordInput name="confirmPassword" placeholder="再次输入密码" autoComplete="new-password" error={state?.fieldErrors?.confirmPassword} />
      </label>
      <div className="form-footer" style={{ paddingTop: 4 }}>
        <button type="submit" className="button button-primary" style={{ width: "100%" }} disabled={pending}>
          {pending ? <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} /> : <UserPlus size={14} />}
          {pending ? "正在创建账号…" : "注册并进入工作台"}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="auth-footer">
        已有账号？<Link href="/login">返回登录</Link>
        <span style={{ color: "var(--muted-light)", margin: "0 7px" }}>·</span>
        新注册账号默认角色为部门成员，管理员可后续调整。
      </div>
    </form>
  );
}
