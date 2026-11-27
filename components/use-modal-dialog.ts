"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";

export function useModalDialog(onDismiss: () => void, returnFocus?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = returnFocus?.current ?? document.activeElement;
    // The package drawer is rendered open for pages that load without JavaScript.
    if (dialog.open) dialog.close();
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();

    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  function dismiss(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    dismiss(event);
  }

  return { ref, onCancel: dismiss, onKeyDown };
}
