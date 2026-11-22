"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

type PendingChoices = Record<number, number | null>;

const eventName = "toolkit:batch-selection";
const empty = "{}";
const fallback = new Map<string, string>();

function readChoices(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? empty;
  } catch {
    return fallback.get(key) ?? empty;
  }
}

function writeValue(key: string, value: string) {
  try {
    if (value === empty) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    if (value === empty) fallback.delete(key);
    else fallback.set(key, value);
  }
  window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
}

function parseChoices(value: string): PendingChoices {
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([key, choice]) =>
      /^[1-9][0-9]*$/.test(key) && (choice === null || (Number.isSafeInteger(choice) && choice > 0)),
    ));
  } catch {
    return {};
  }
}

function useStoredValue(key?: string) {
  const subscribe = useCallback((notify: () => void) => {
    const onChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) notify();
    };
    window.addEventListener(eventName, onChange);
    return () => window.removeEventListener(eventName, onChange);
  }, [key]);
  const getSnapshot = useCallback(() => key ? readChoices(key) : empty, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}

function parsePendingReview(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function pendingReviewKey(selectionKey: string) {
  return `${selectionKey}:hidden-versions`;
}

export function rememberPendingReview(selectionKey: string, versionIds: number[]) {
  writeValue(pendingReviewKey(selectionKey), JSON.stringify(versionIds));
}

export function usePendingReview(selectionKey?: string) {
  const value = useStoredValue(selectionKey ? pendingReviewKey(selectionKey) : undefined);
  return useMemo(() => new Set(parsePendingReview(value)), [value]);
}

export function usePendingBatchChoices(key?: string) {
  const raw = useStoredValue(key);
  const choices = useMemo(() => parseChoices(raw), [raw]);
  return {
    choices,
    choose(packageId: number, versionId: number | null) {
      if (key) writeValue(key, JSON.stringify({ ...parseChoices(readChoices(key)), [packageId]: versionId }));
    },
    reset() {
      if (key) writeValue(key, empty);
    },
  };
}

export function ClearBatchChoices({ selectionKey, batchId }: { selectionKey: string; batchId: number }) {
  useEffect(() => {
    const marker = `${selectionKey}:reset`;
    const saved = Number(readChoices(marker));
    if (saved >= batchId) return;
    writeValue(selectionKey, empty);
    writeValue(pendingReviewKey(selectionKey), empty);
    try {
      window.sessionStorage.setItem(marker, String(batchId));
    } catch {
      fallback.set(marker, String(batchId));
    }
  }, [selectionKey, batchId]);
  return null;
}
