"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { DialogSurface } from "@/components/form-dialog";
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
  preserveValuesOnSubmit?: boolean;
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
  preserveValuesOnSubmit = false,
  title,
  submitName,
  submitValue,
  testId,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [confirmation, setConfirmation] = useState<{ text: string; danger: boolean } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const submitter = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const confirmed = useRef(false);
  const resettingAfterSuccess = useRef(false);
  const fieldErrors = Object.entries(state?.fieldErrors ?? {});

  useEffect(() => {
    if (pending) return;
    if (state?.error) {
      errorSummary.current?.focus();
    } else if (state?.success && !preserveValuesOnSubmit) {
      resettingAfterSuccess.current = true;
      form.current?.reset();
      resettingAfterSuccess.current = false;
    }
  }, [pending, preserveValuesOnSubmit, state]);

  function focusField(name: string) {
    const control = Array.from(form.current?.elements ?? []).find((element) =>
      element instanceof HTMLElement && element.getAttribute("name") === name && element.getAttribute("type") !== "hidden");
    if (control instanceof HTMLElement) control.focus();
  }

  function submitConfirmed() {
    setConfirmation(null);
    confirmed.current = true;
    try {
      const button = submitter.current;
      form.current?.requestSubmit(button?.form === form.current ? button : undefined);
    } finally {
      confirmed.current = false;
    }
  }

  return (
    <>
    <form
      ref={form}
      action={formAction}
      className={className}
      data-testid={testId}
      onReset={(event) => {
        // React resets uncontrolled inputs when an action returns, including on validation errors.
        if (!resettingAfterSuccess.current) event.preventDefault();
      }}
      onSubmit={(event) => {
        if (!confirmMessage || confirmed.current) return;
        event.preventDefault();
        const nativeSubmitter = (event.nativeEvent as SubmitEvent).submitter;
        submitter.current = nativeSubmitter instanceof HTMLButtonElement || nativeSubmitter instanceof HTMLInputElement ? nativeSubmitter : null;
        const button = submitter.current;
        const secondary = secondarySubmit && button?.name === "decision" && button.value === secondarySubmit.value;
        setConfirmation({
          text: secondary ? secondarySubmit.text : submitText,
          danger: (secondary ? secondarySubmit.variant : submitVariant)?.includes("danger") ?? false,
        });
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
        <div className="form-error" role="alert" ref={errorSummary} tabIndex={-1}>
          <AlertCircle size={14} strokeWidth={2} style={{ marginTop: 1, flex: "none" }} aria-hidden="true" />
          <div>
            <span>{state.error}</span>
            {fieldErrors.length > 0 && <ul>
              {fieldErrors.map(([name, message]) => <li key={name}>
                <button className="archive-link" type="button" onClick={() => focusField(name)}>{message}</button>
              </li>)}
            </ul>}
          </div>
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
              aria-haspopup={confirmMessage ? "dialog" : undefined}
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
            aria-haspopup={confirmMessage ? "dialog" : undefined}
          >
            {pending && (
              <LoaderCircle size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
            )}
            {pending ? pendingText : submitText}
          </button>
        </div>
      )}
    </form>
    {confirmation && confirmMessage && (
      <DialogSurface alert title={confirmation.text} description={confirmMessage} returnFocus={submitter} onClose={() => setConfirmation(null)}>
        <div className="form-footer">
          <button type="button" className="button button-secondary" data-dialog-autofocus onClick={() => setConfirmation(null)}>取消</button>
          <button type="button" className={variantClass[confirmation.danger ? "danger" : "primary"]} onClick={submitConfirmed}>确认{confirmation.text}</button>
        </div>
      </DialogSurface>
    )}
    </>
  );
}
