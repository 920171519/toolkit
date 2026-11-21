"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { trialDefaultPageSize, trialQueueFilterKeys, trialQueueKey, trialQueueParams, type TrialQueueKind } from "@/lib/trial-queue";
import { workflowHref } from "@/lib/workflow-links";
import styles from "./trial-queue-table.module.css";

function queueForms(container: HTMLDivElement) {
  return [...container.querySelectorAll<HTMLFormElement>("form[data-trial-filters]")].flatMap<{ form: HTMLFormElement; kind: TrialQueueKind }>((form) => {
    const kind = form.dataset.trialFilters;
    return kind === "release" || kind === "binding" ? [{ form, kind }] : [];
  });
}

function fieldValue(query: Record<string, string>, kind: TrialQueueKind, name: string) {
  return query[name] ?? (name === trialQueueKey(kind, "size") ? String(trialDefaultPageSize) : "");
}

export function TrialQueueFilters({ projectId, query, children }: {
  projectId?: number;
  query: Record<string, string>;
  children: ReactNode;
}) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const submittedHref = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const currentHref = workflowHref("/trial", projectId, query);

  useEffect(() => {
    if (root.current) root.current.dataset.enhanced = "true";
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    // URL changes from links or browser history reset the controls. Keep the
    // live draft while typing or when its own navigation completes.
    if (!root.current || pending || timer.current !== null) return;
    if (submittedHref.current !== currentHref) {
      for (const { form, kind } of queueForms(root.current)) {
        for (const name of trialQueueFilterKeys(kind)) {
          const input = form.elements.namedItem(name);
          if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
            input.value = fieldValue(query, kind, name);
          }
        }
      }
    }
    submittedHref.current = null;
  }, [currentHref, pending, query]);

  function cancelScheduledNavigation() {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }

  function applyFilters(container: HTMLDivElement) {
    const current = trialQueueParams(Object.fromEntries(new URLSearchParams(window.location.search)));
    const next = { ...current };
    // Both sets of controls can change within a debounce window. Read them
    // together and reset pagination only for the queues whose filters changed.
    for (const { form, kind } of queueForms(container)) {
      const fields = trialQueueFilterKeys(kind);
      const data = new FormData(form);
      const filters = trialQueueParams(Object.fromEntries(fields.map((name) => {
        const value = data.get(name);
        return [name, typeof value === "string" ? value : undefined];
      })));
      for (const name of fields) {
        if (filters[name] === current[name]) continue;
        if (filters[name]) next[name] = filters[name];
        else delete next[name];
        delete next[trialQueueKey(kind, "page")];
      }
    }
    const href = workflowHref("/trial", projectId, trialQueueParams(next));
    if (href === currentHref && submittedHref.current === null) return;
    submittedHref.current = href;
    startTransition(() => router.replace(href + window.location.hash, { scroll: false }));
  }

  return (
    <div
      className={styles.filters}
      ref={root}
      aria-busy={pending}
      onClickCapture={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
            event.target instanceof Element && event.target.closest("a[href]")) {
          cancelScheduledNavigation();
        }
      }}
      onChange={({ currentTarget, target }) => {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) ||
            !target.form?.hasAttribute("data-trial-filters")) return;
        cancelScheduledNavigation();
        if (target instanceof HTMLSelectElement) {
          applyFilters(currentTarget);
          return;
        }
        timer.current = window.setTimeout(() => {
          timer.current = null;
          applyFilters(currentTarget);
        }, 180);
      }}
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement) || !event.target.hasAttribute("data-trial-filters")) return;
        event.preventDefault();
        cancelScheduledNavigation();
        applyFilters(event.currentTarget);
      }}
    >
      {children}
    </div>
  );
}
