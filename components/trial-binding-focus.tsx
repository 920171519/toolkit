"use client";

import { useEffect } from "react";

export function TrialBindingFocus() {
  useEffect(() => {
    if (window.location.hash !== "#binding-queue") return;
    const frame = requestAnimationFrame(() => document.getElementById("binding-queue")?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
