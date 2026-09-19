"use client";

import { useEffect, useRef } from 'react';
import { setEditorDirty } from '@/app/lib/unsavedChanges';

export function useUnsavedChanges(dirty: boolean) {
  const editor = useRef(Symbol('editor'));
  useEffect(() => {
    const id = editor.current;
    setEditorDirty(id, dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', beforeUnload);
    return () => {
      setEditorDirty(id, false);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);
}
