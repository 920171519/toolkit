"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { readTraceListState, traceHref } from "@/lib/version-trace-list";

export function TraceFilterForm({ currentHref, projectId, children }: {
  currentHref: string;
  projectId?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<number | null>(null);
  const submittedHref = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Keep the input values while an edit is queued or navigating.
    if (pending || timer.current !== null) return;
    if (submittedHref.current !== currentHref) formRef.current?.reset();
    submittedHref.current = null;
  }, [currentHref, pending]);

  useEffect(() => {
    if (formRef.current) formRef.current.dataset.enhanced = "true";
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  function cancelScheduledNavigation() {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }

  function submit(form: HTMLFormElement) {
    const state = readTraceListState(Object.fromEntries(new FormData(form)));
    const href = traceHref(state, projectId);
    if (href === currentHref && submittedHref.current === null) return;
    submittedHref.current = href;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return (
    <form
      action="/versions"
      method="get"
      ref={formRef}
      role="search"
      aria-label="查询版本"
      aria-busy={pending}
      onClickCapture={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
            event.target instanceof Element && event.target.closest("a[href]")) {
          cancelScheduledNavigation();
        }
      }}
      onChange={({ currentTarget, target }) => {
        cancelScheduledNavigation();
        if (target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type === "date")) {
          submit(currentTarget);
        } else {
          const form = currentTarget;
          timer.current = window.setTimeout(() => {
            timer.current = null;
            submit(form);
          }, 180);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        cancelScheduledNavigation();
        submit(event.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
