"use client";

import { createContext, useContext, type ReactNode } from 'react';
import type { AuthenticatedStorageOwner } from '../data/authenticatedStorageOwner.ts';

const OwnerContext = createContext<AuthenticatedStorageOwner | null>(null);

/** AuthGate places this inside its owner-keyed and PIN-checked subtree. */
export function AuthenticatedStorageOwnerProvider({ lease, children }: { lease: AuthenticatedStorageOwner; children: ReactNode }) {
  return <OwnerContext.Provider value={lease}>{children}</OwnerContext.Provider>;
}

export function useAuthenticatedStorageOwner(): AuthenticatedStorageOwner | null {
  return useContext(OwnerContext);
}
