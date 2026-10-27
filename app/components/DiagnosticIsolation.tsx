'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isSpeechBoundaryPath } from '@/lib/speech-boundary-path';

/** Children are composed by server layouts, but never mounted on diagnostics. */
export default function DiagnosticIsolation({ children, diagnostic = null }: { children: ReactNode; diagnostic?: ReactNode }) {
  const pathname = usePathname();
  if (pathname === null) return null;
  return isSpeechBoundaryPath(pathname) ? diagnostic : children;
}
