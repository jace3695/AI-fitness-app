import type { ReactNode } from 'react';

/** Keep optional tools within reach without distracting from the current action. */
export default function PracticeOptions({ simple, title, children }: { simple: boolean; title: string; children: ReactNode }) {
  if (!simple) return <>{children}</>;
  return <details className="drawing-options"><summary>{title}</summary><div className="mt-3">{children}</div></details>;
}
