"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface NavTarget {
  primaryId: string;
  secondaryId?: string;
}

interface AppNavigationContextValue {
  pending: NavTarget | null;
  navigateTo: (primaryId: string, secondaryId?: string) => void;
  // Called by a Tabs instance once it has applied its matching part of
  // `pending`. "primary" clears pending only if there's no secondaryId left
  // to deliver (otherwise the secondary Tabs instance, which mounts after
  // the primary tab switches, still needs it); "secondary" always clears.
  consume: (matched: "primary" | "secondary") => void;
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<NavTarget | null>(null);

  const navigateTo = useCallback((primaryId: string, secondaryId?: string) => {
    setPending({ primaryId, secondaryId });
  }, []);

  const consume = useCallback((matched: "primary" | "secondary") => {
    setPending((current) => {
      if (!current) return current;
      if (matched === "secondary") return null;
      if (matched === "primary" && !current.secondaryId) return null;
      return current;
    });
  }, []);

  const value = useMemo(() => ({ pending, navigateTo, consume }), [pending, navigateTo, consume]);

  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

// Throws outside a Provider — use this from code that only ever renders
// inside AppNavigationProvider (e.g. the Assistant's routing button).
export function useAppNavigation() {
  const ctx = useContext(AppNavigationContext);
  if (!ctx) {
    throw new Error("useAppNavigation must be used within an AppNavigationProvider");
  }
  return ctx;
}

// Returns null outside a Provider — used by Tabs.tsx, which renders in many
// places that aren't wrapped in AppNavigationProvider and must keep working
// unchanged there.
export function useAppNavigationOptional() {
  return useContext(AppNavigationContext);
}
