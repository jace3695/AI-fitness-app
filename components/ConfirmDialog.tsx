"use client";
import { useEffect, useId, useRef } from 'react';
import { useDialogFocus } from './useDialogFocus';

export default function ConfirmDialog({ open, title, description, busy = false, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; busy?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', close);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', close); };
  }, [open, busy, onCancel]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-950/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="w-full max-w-md rounded-3xl bg-white p-5 text-gray-900 shadow-xl">
      <h2 id={`${id}-title`} className="text-lg font-bold">{title}</h2><p id={`${id}-description`} className="mt-3 whitespace-pre-line text-sm leading-6 text-gray-600">{description}</p>
      <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl bg-gray-100 font-bold disabled:opacity-50">취소</button><button type="button" disabled={busy} onClick={onConfirm} className="min-h-11 rounded-xl bg-red-600 font-bold text-white disabled:opacity-50">{busy ? '처리 중…' : '삭제'}</button></div>
    </div>
  </div>;
}
