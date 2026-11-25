"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export function TrialBindingFocus({ detail = false }: { detail?: boolean }) {
  const search = useSearchParams().toString();
  useEffect(() => {
    let frame = 0;
    const focus = (hash: string) => {
      if (detail ? !/^#binding-(?:node-\d+|flow-\d+|barcodes-\d+|nodes|decision|formal)$/.test(hash) : hash !== "#binding-queue") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = document.getElementById(hash.slice(1));
        if (!target) return;
        for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      });
    };
    const handleHash = () => focus(window.location.hash);
    const handleLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const target = new URL(link.href);
      if (target.origin === window.location.origin && target.pathname === window.location.pathname) focus(target.hash);
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    document.addEventListener("click", handleLink, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", handleHash);
      document.removeEventListener("click", handleLink, true);
    };
  }, [detail, search]);

  return null;
}
