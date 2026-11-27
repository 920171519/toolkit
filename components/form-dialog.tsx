"use client";

import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { useModalDialog } from "./use-modal-dialog";

export function DialogSurface({ title, description, children, onClose, returnFocus, wide = false, alert = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
  alert?: boolean;
}) {
  const dialog = useModalDialog(onClose, returnFocus);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog {...dialog} className={`workspace-dialog modal-panel ${wide ? "modal-panel-wide" : ""}`}
      role={alert ? "alertdialog" : undefined} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="drawer-close" aria-label="关闭弹窗" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="modal-body">
        {description && <p id={descriptionId} className="workspace-dialog-description">{description}</p>}
        {children}
      </div>
    </dialog>
  );
}

export function FormDialog({
  label,
  title,
  description,
  children,
  triggerClassName = "button button-primary",
  testId,
  wide = false,
  fallbackHref,
  cancelLabel,
  closeOnLinkClick = false,
}: {
  label: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  triggerClassName?: string;
  testId?: string;
  wide?: boolean;
  fallbackHref?: string;
  cancelLabel?: string;
  closeOnLinkClick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const invoker = useRef<HTMLElement | null>(null);

  function show(trigger: HTMLElement) {
    invoker.current = trigger;
    setOpen(true);
  }

  return (
    <>
      {fallbackHref ? (
        <a href={fallbackHref} className={triggerClassName} aria-haspopup="dialog" onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          show(event.currentTarget);
        }} data-testid={testId}>
          {label}
        </a>
      ) : (
        <button type="button" className={triggerClassName} aria-haspopup="dialog" onClick={(event) => show(event.currentTarget)} data-testid={testId}>
          {label}
        </button>
      )}
      {open && (
        <DialogSurface title={title} description={description} wide={wide} returnFocus={invoker} onClose={() => setOpen(false)}>
          {closeOnLinkClick ? <div onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (event.target instanceof Element && event.target.closest("a[href]")) setOpen(false);
          }}>{children}</div> : children}
          {cancelLabel && <div className="workspace-dialog-cancel">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>{cancelLabel}</button>
          </div>}
        </DialogSurface>
      )}
    </>
  );
}
