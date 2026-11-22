"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import styles from "./info-tooltip.module.css";

export function InfoTooltip({ label, children }: { label: string; children: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);

  function show() {
    const panel = tooltip.current;
    if (!panel || panel.matches(":popover-open")) return;
    pinned.current = false;
    panel.showPopover();
  }

  useEffect(() => {
    const button = trigger.current;
    const panel = tooltip.current;
    if (!open || !button || !panel) return;
    const viewport = window.visualViewport;

    function reposition() {
      if (!button || !panel || !panel.matches(":popover-open")) return;
      const rect = button.getBoundingClientRect();
      const edge = 8;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? document.documentElement.clientWidth;
      const bottomEdge = topEdge + (viewport?.height ?? document.documentElement.clientHeight);
      if (rect.bottom <= topEdge || rect.top >= bottomEdge) {
        panel.hidePopover();
        return;
      }
      panel.style.maxWidth = `${Math.min(280, width - edge * 2)}px`;
      const left = Math.min(rect.left, leftEdge + width - panel.offsetWidth - edge);
      const above = rect.top - topEdge;
      const below = bottomEdge - rect.bottom;
      const top = below >= panel.offsetHeight || below >= above ? rect.bottom : rect.top - panel.offsetHeight;
      panel.style.left = `${Math.max(leftEdge + edge, left)}px`;
      panel.style.top = `${Math.max(topEdge + edge, top)}px`;
    }

    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    viewport?.addEventListener("resize", reposition);
    viewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      viewport?.removeEventListener("resize", reposition);
      viewport?.removeEventListener("scroll", reposition);
    };
  }, [open]);

  return (
    <span className={styles.help}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") show(); }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !pinned.current && !trigger.current?.matches(":focus-visible")) tooltip.current?.hidePopover();
      }}>
      <button ref={trigger} type="button" className={styles.trigger} aria-label={label} aria-describedby={id} popoverTarget={id}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) show(); }}
        onBlur={() => tooltip.current?.hidePopover()}
        onClick={(event) => {
          event.preventDefault();
          if (pinned.current && tooltip.current?.matches(":popover-open")) {
            tooltip.current.hidePopover();
          } else {
            show();
            pinned.current = true;
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !tooltip.current?.matches(":popover-open")) return;
          event.preventDefault();
          event.stopPropagation();
          tooltip.current.hidePopover();
        }}>
        <Info size={16} aria-hidden="true" />
      </button>
      <span ref={tooltip} id={id} role="tooltip" popover="auto" className={styles.tooltip}
        onToggle={(event) => setOpen(event.newState === "open")}>
        <span className={styles.text}>{children}</span>
      </span>
    </span>
  );
}
