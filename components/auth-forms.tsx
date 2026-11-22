"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { loginAction, registerAction } from "@/app/(auth)/actions";
import styles from "@/app/(auth)/auth.module.css";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className={`form-error ${styles.formError}`} role="alert">
      <AlertCircle size={16} aria-hidden="true" /> {message}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className={styles.fieldError}>{message}</p>;
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  error,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const details = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.passwordControl}>
        <input
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          name={name}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={details}
          required
        />
        <button
          type="button"
          className={styles.passwordToggle}
          onClick={() => setVisible((value) => !value)}
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          aria-controls={id}
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className={styles.fieldHint}>{hint}</p>}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  const [employeeId, setEmployeeId] = useState("");
  const submitLabel = next && next !== "/dashboard" ? "登录并继续" : "登录工作台";
  return (
    <form action={formAction} className={styles.form} data-testid="login-form" aria-busy={pending}>
      {next && <input type="hidden" name="next" value={next} />}
      <FormError message={state?.error} />
      <div className={styles.field}>
        <label htmlFor="login-employee-id">工号</label>
        <input id="login-employee-id" className="input" name="employeeId" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} required />
      </div>
      <PasswordField id="login-password" name="password" label="密码" autoComplete="current-password" />
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending && <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />}
        {pending ? "正在登录…" : submitLabel}
      </button>
      <Link href="/register" prefetch={false} className={styles.alternate}>注册账号</Link>
    </form>
  );
}

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initial);
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const errors = state?.fieldErrors;
  return (
    <form action={formAction} className={styles.form} data-testid="register-form" aria-busy={pending}>
      <FormError message={state?.error} />
      <div className={styles.field}>
        <label htmlFor="register-name">姓名</label>
        <input id="register-name" className="input" name="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} maxLength={30} aria-invalid={Boolean(errors?.name) || undefined} aria-describedby={errors?.name ? "register-name-error" : undefined} required />
        <FieldError id="register-name-error" message={errors?.name} />
      </div>
      <div className={styles.field}>
        <label htmlFor="register-employee-id">工号</label>
        <input id="register-employee-id" className="input" name="employeeId" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} minLength={3} maxLength={32} aria-invalid={Boolean(errors?.employeeId) || undefined} aria-describedby={errors?.employeeId ? "register-employee-id-error" : undefined} required />
        <FieldError id="register-employee-id-error" message={errors?.employeeId} />
      </div>
      <PasswordField id="register-password" name="password" label="密码" autoComplete="new-password" hint="8–72 个字符" error={errors?.password} />
      <PasswordField id="register-confirm-password" name="confirmPassword" label="确认密码" autoComplete="new-password" error={errors?.confirmPassword} />
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending && <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />}
        {pending ? "正在注册…" : "注册并进入工作台"}
      </button>
      <Link href="/login" prefetch={false} className={styles.alternate}>返回登录</Link>
    </form>
  );
}
