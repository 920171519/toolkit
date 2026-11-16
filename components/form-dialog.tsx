"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function FormDialog({
  label,
  title,
  description,
  children,
  triggerClassName = "button button-primary",
  testId,
  wide = false,
}: {
  label: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  triggerClassName?: string;
  testId?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)} data-testid={testId}>
        {label}
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <div className={`modal-panel ${wide ? "modal-panel-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
            <header className="modal-header">
              <div>
                <h2>{title}</h2>
                {description && <p className="small muted">{description}</p>}
              </div>
              <button type="button" className="drawer-close" aria-label="关闭弹窗" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
