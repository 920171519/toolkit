"use client";

import { useActionState, type ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import type { ActionState } from "@/lib/action-state";

type Action = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

 type Props = {
  action: Action;
  children?: ReactNode;
  submitText?: string;
  pendingText?: string;
  submitVariant?: "primary" | "secondary" | "ghost" | "danger" | "outline-danger";
  secondarySubmit?: { text: string; value: string; variant?: "secondary" | "danger" | "outline-danger" };
  className?: string;
  submitClassName?: string;
  hidden?: Record<string, string | number | undefined | null>;
  confirmMessage?: string;
  footerNote?: ReactNode;
  hideSubmit?: boolean;
  disabled?: boolean;
  title?: string;
  submitName?: string;
  submitValue?: string;
  testId?: string;
};

const initialState: ActionState = {};
const variantClass: Record<string, string> = {
  primary: "button button-primary",
  secondary: "button button-secondary",
  ghost: "button button-ghost",
  danger: "button button-danger",
  "outline-danger": "button button-outline-danger",
};

export function ActionForm({
  action,
  children,
  submitText = "提交",
  pendingText = "处理中…",
  submitVariant = "primary",
  secondarySubmit,
  className = "",
  submitClassName = "",
  hidden,
  confirmMessage,
  footerNote,
  hideSubmit = false,
  disabled = false,
  title,
  submitName,
  submitValue,
  testId,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      className={className}
      data-testid={testId}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      title={title}
    >
      {hidden &&
        Object.entries(hidden).map(([key, value]) =>
          value === undefined || value === null ? null : (
            <input key={key} type="hidden" name={key} value={String(value)} />
          ),
        )}
      {children}
      {state?.error && (
        <div className="form-error" role="alert">
          <AlertCircle size={14} strokeWidth={2} style={{ marginTop: 1, flex: "none" }} />
          <span>{state.error}</span>
        </div>
      )}
      {!hideSubmit && (
        <div className="form-footer">
          {footerNote && <span className="form-note">{footerNote}</span>}
          {secondarySubmit && (
            <button
              type="submit"
              name="decision"
              value={secondarySubmit.value}
              className={`${variantClass[secondarySubmit.variant ?? "secondary"]} ${submitClassName}`}
              disabled={pending || disabled}
            >
              {pending ? pendingText : secondarySubmit.text}
            </button>
          )}
          <button
            type="submit"
            name={submitName}
            value={submitValue}
            className={`${variantClass[submitVariant]} ${submitClassName}`}
            disabled={pending || disabled}
          >
            {pending && (
              <LoaderCircle size={14} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
            )}
            {pending ? pendingText : submitText}
          </button>
        </div>
      )}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </form>
  );
}
