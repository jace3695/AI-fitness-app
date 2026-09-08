"use client";
import { useEffect, type RefObject } from 'react';

const dialogs: symbol[] = [];
const controls = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const id = Symbol('dialog');
    dialogs.push(id);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(controls)).filter(el => el.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? dialog).focus();
    focusFirst();
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== id || event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (dialogs.at(-1) === id && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      const top = dialogs.at(-1) === id;
      dialogs.splice(dialogs.indexOf(id), 1);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocus);
      if (top && previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
